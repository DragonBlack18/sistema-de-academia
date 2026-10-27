import { ApiError, randomToken, digest, verifyPassword, hashPassword, timestamp, uuid, json, bodyJson, matchTotpCounter, decryptSecret, safeEqual, guardedAuthWrite, reserveAuthAttempt } from './security';

export const ROLES = ['super_admin','admin','manager','reception','finance','trainer','personal'] as const;
export type Role=typeof ROLES[number];
export type Actor={id:string;name:string;login:string;role:string;active:boolean;permissions:string[];mustChangePassword?:boolean;version?:number;totpEnabled?:boolean};
export type AuthSession={user:Actor;csrfToken:string;sessionId:string};
export type AuthEnv={ADMIN_LOGIN?:string;ADMIN_PASSWORD?:string;ENABLE_DEMO_DATA?:string;TOTP_ENCRYPTION_KEY?:string;APP_ENV?:string};
const rw=(...domains:string[])=>domains.flatMap(d=>[`${d}.read`,`${d}.write`]);
const permissions:Record<string,string[]>={
 super_admin:['*'],
 admin:[...rw('students','staff','plans','memberships','finance','attendance','workouts','assessments','classes','inventory','crm','notifications','users','settings'),'dashboard.read','reports.read','audit.read','attendance.override'],
 manager:[...rw('students','staff','plans','memberships','finance','attendance','workouts','assessments','classes','inventory','crm','notifications'),'dashboard.read','reports.read'],
 reception:[...rw('students','memberships','attendance','classes','crm'),'plans.read','workouts.read','notifications.read','dashboard.read'],
 finance:[...rw('finance'),'students.read','plans.read','memberships.read','reports.read','notifications.read','dashboard.read'],
 trainer:[...rw('workouts','assessments','classes'),'students.read','attendance.read','notifications.read','dashboard.read'],
 personal:[...rw('workouts','assessments'),'students.read','classes.read','attendance.read','notifications.read','dashboard.read']
};
export const rolePermissions=(role:string)=>[...(permissions[role]??[])];
export const can=(actor:Actor,permission:string)=>actor.active&&(actor.permissions.includes('*')||actor.permissions.includes(permission));
export function requirePermission(actor:Actor,permission:string){if(!can(actor,permission))throw new ApiError(403,'Seu perfil não tem permissão para esta operação.');}
export function publicUser(row:Record<string,unknown>):Actor {return {id:String(row.id),name:String(row.name),login:String(row.login),role:String(row.role),active:Boolean(row.active),permissions:rolePermissions(String(row.role)),mustChangePassword:Boolean(row.must_change_password),version:Number(row.version),totpEnabled:Boolean(row.totp_enabled)};}
// This association stays server-side and never adds a session identifier to JSON users.
const authenticatedSessions=new WeakMap<Actor,string>();
/** Authorization must remain true at the instant a mutation is committed. */
export function actorGuard(actor:Actor){
 const sessionId=authenticatedSessions.get(actor);
 const sql='EXISTS(SELECT 1 FROM users WHERE id=? AND role=? AND version=? AND active=1)'+(sessionId?" AND EXISTS(SELECT 1 FROM sessions WHERE id=? AND user_id=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND last_seen_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 minutes'))":'');
 return {sql,values:[actor.id,actor.role,Number.isSafeInteger(actor.version)?actor.version:-1,...(sessionId?[sessionId,actor.id]:[])]};
}
export function audit(db:D1Database,userId:string|null,action:string,entity:string,entityId:string|null,summary:string){return db.prepare('INSERT INTO audit_logs (id,user_id,action,entity,entity_id,summary,created_at) VALUES (?,?,?,?,?,?,?)').bind(uuid(),userId,action,entity,entityId,summary,timestamp());}

const cookieName='vg_session';
export const SESSION_ABSOLUTE_MS=12*60*60*1000;
export const SESSION_IDLE_MS=30*60*1000;
export function cookie(token:string,request:Request,maxAge=SESSION_ABSOLUTE_MS/1000){return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
export function sessionCookie(request:Request){
 const matches=request.headers.get('cookie')?.split(';').map(x=>x.trim()).filter(x=>x.startsWith(`${cookieName}=`))??[];
 // Ambiguous cookie paths/domains must not select whichever credential happens to occur first.
 return matches.length===1?matches[0].slice(cookieName.length+1):'';
}
export async function authenticate(request:Request,db:D1Database):Promise<AuthSession>{
 const expired=()=>new ApiError(401,'Sua sessão expirou. Entre novamente para continuar.');
 const token=sessionCookie(request);if(!/^[0-9a-f]{64}$/.test(token))throw expired();
 const now=timestamp(),idleSince=new Date(Date.now()-SESSION_IDLE_MS).toISOString();
 const row=await db.prepare('SELECT u.*,s.id AS session_id,s.csrf_token,s.last_seen_at,s.expires_at AS session_expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND s.last_seen_at>? AND u.active=1').bind(digest(token),now,idleSince).first<Record<string,unknown>>();
 if(!row)throw expired();
 const validatedAt=timestamp(),validatedIdleSince=new Date(Date.now()-SESSION_IDLE_MS).toISOString();
 if(String(row.session_expires_at)<=validatedAt||String(row.last_seen_at)<=validatedIdleSince)throw expired();
 // Updating at most once a minute avoids a write on every dashboard fetch.
 if(String(row.last_seen_at)<=new Date(Date.now()-60*1000).toISOString()){
  const result=await db.prepare('UPDATE sessions SET last_seen_at=? WHERE id=? AND token_hash=? AND expires_at>? AND last_seen_at>? AND EXISTS(SELECT 1 FROM users WHERE id=? AND active=1 AND version=?)').bind(validatedAt,row.session_id,digest(token),validatedAt,validatedIdleSince,row.id,row.version).run();
  if(result.meta.changes!==1)throw expired();
 }
 const user=publicUser(row);authenticatedSessions.set(user,String(row.session_id));
 return {user,csrfToken:String(row.csrf_token),sessionId:String(row.session_id)};
}
export function checkCsrf(request:Request,token:string){const supplied=request.headers.get('x-csrf-token')||'';if(!token||!safeEqual(token,supplied))throw new ApiError(403,'A sessão de segurança mudou. Recarregue a página antes de salvar.');}

export async function signIn(request:Request,db:D1Database,env:AuthEnv,settings:unknown){
 const input=await bodyJson(request);
 if(typeof input.login!=='string'||typeof input.password!=='string'||(input.otp!==undefined&&typeof input.otp!=='string'))throw new ApiError(400,'Informe seu acesso e sua senha.');
 const login=input.login.trim().toLowerCase(),password=input.password;
 if(!login||login.length>180||!password||password.length>256)throw new ApiError(400,'Informe seu acesso e sua senha.');
 const ipKey=`login-ip:${digest(request.headers.get('cf-connecting-ip')||'local')}`,loginKey=`login:${digest(login)}`;
 const attempt=await reserveAuthAttempt(db,{key:loginKey,ipKey,limit:12,ipLimit:60});
 const row=await db.prepare('SELECT * FROM users WHERE lower(login)=?').bind(login).first<Record<string,unknown>>();
 // Inactive and missing users receive the same error and still perform password work.
 const passwordValid=row?verifyPassword(password,String(row.password_hash)):(hashPassword(password),false);
 if(!row||!row.active||!passwordValid){await audit(db,row?.id?String(row.id):null,'login.failed','auth',row?.id?String(row.id):null,'Tentativa de autenticação recusada').run();throw new ApiError(401,'Acesso ou senha incorretos.');}
 let counter:number|null=null;
 if(row.totp_enabled){
  const code=typeof input.otp==='string'?input.otp:'';
  if(!code)return json({error:'Informe o código do seu aplicativo autenticador.',code:'MFA_REQUIRED'},401);
  counter=matchTotpCounter(decryptSecret(String(row.totp_secret),env.TOTP_ENCRYPTION_KEY||''),code);
  if(counter===null||counter<=Number(row.totp_last_counter))throw new ApiError(401,'Código inválido ou já utilizado. Aguarde o próximo código do autenticador.');
 }
 const token=randomToken(),csrfToken=randomToken(),id=uuid(),now=timestamp();
 const predicate="EXISTS(SELECT 1 FROM users WHERE id=? AND version=? AND password_hash=? AND active=1"+(counter===null?'':' AND totp_enabled=1 AND totp_secret=? AND totp_last_counter<?')+')';
 const values:unknown[]=[row.id,row.version,row.password_hash,...(counter===null?[]:[row.totp_secret,counter])];
 await guardedAuthWrite(db,predicate,values,[
  ...(counter===null?[]:[db.prepare('UPDATE users SET totp_last_counter=? WHERE id=?').bind(counter,row.id)]),
  db.prepare('INSERT INTO sessions (id,user_id,token_hash,csrf_token,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?)').bind(id,row.id,digest(token),csrfToken,new Date(Date.now()+SESSION_ABSOLUTE_MS).toISOString(),now,now),
  db.prepare('DELETE FROM login_attempts WHERE id=?').bind(attempt),
  db.prepare('DELETE FROM sessions WHERE id IN (SELECT id FROM sessions WHERE expires_at<=? OR last_seen_at<=? LIMIT 256)').bind(now,new Date(Date.now()-SESSION_IDLE_MS).toISOString()),
  audit(db,String(row.id),'login.success','auth',String(row.id),'Sessão iniciada')
 ]);
 return json({user:publicUser(row),csrfToken,settings},200,{'Set-Cookie':cookie(token,request)});
}

export async function changePassword(request:Request,db:D1Database,actor:Actor){
 const input=await bodyJson(request);
 const old=typeof input.currentPassword==='string'?input.currentPassword:'',next=typeof input.newPassword==='string'?input.newPassword:'';
 if(next.length<10||next.length>128)throw new ApiError(400,'Use uma senha de 10 a 128 caracteres.',{newPassword:'Use pelo menos 10 caracteres.'});
 if(!old||old.length>256)throw new ApiError(403,'A senha atual está incorreta.');
 const attempt=await reserveAuthAttempt(db,{key:`password-change:${actor.id}`});
 const row=await db.prepare('SELECT password_hash,version FROM users WHERE id=?').bind(actor.id).first<{password_hash:string;version:number}>();
 if(!row||!verifyPassword(old,row.password_hash))throw new ApiError(403,'A senha atual está incorreta.');
 if(old===next)throw new ApiError(400,'A nova senha deve ser diferente da senha atual.',{newPassword:'Escolha uma senha diferente da atual.'});
 const actorPredicate=actorGuard(actor);
 await guardedAuthWrite(db,`${actorPredicate.sql} AND EXISTS(SELECT 1 FROM users WHERE id=? AND version=? AND password_hash=? AND active=1)`,[...actorPredicate.values,actor.id,row.version,row.password_hash],[
  db.prepare('UPDATE users SET password_hash=?,must_change_password=0,version=version+1,updated_at=? WHERE id=?').bind(hashPassword(next),timestamp(),actor.id),
  db.prepare('DELETE FROM sessions WHERE user_id=?').bind(actor.id),
  db.prepare('DELETE FROM login_attempts WHERE id=?').bind(attempt),
  audit(db,actor.id,'password.changed','users',actor.id,'Senha alterada e sessões encerradas')
 ]);
 return json({message:'Senha alterada. Entre novamente com a nova senha.'},200,{'Set-Cookie':cookie('',request,0)});
}
