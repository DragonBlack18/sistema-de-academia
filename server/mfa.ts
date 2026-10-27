import { actorGuard, audit, type AuthEnv, type AuthSession } from './auth';
import { ApiError, bodyJson, createTotpSecret, decryptSecret, encryptSecret, guardedAuthWrite, json, matchTotpCounter, reserveAuthAttempt, timestamp, verifyPassword } from './security';

/** MFA state changes remain separate from routing and use the existing frontend contract. */
export async function handleMfa(request:Request,db:D1Database,config:AuthEnv,auth:AuthSession):Promise<Response>{
 const action=new URL(request.url).pathname.replace(/\/$/,'').split('/')[3];
 if(!['setup','enable','disable'].includes(action)||new URL(request.url).pathname.replace(/\/$/,'').split('/').length!==4)throw new ApiError(404,'Recurso não encontrado.');
 if(request.method!=='POST')throw new ApiError(405,'Operação não disponível para o autenticador.');
 const data=await bodyJson(request),row=await db.prepare('SELECT * FROM users WHERE id=?').bind(auth.user.id).first<Record<string,unknown>>();
 if(!row||!row.active)throw new ApiError(401,'Entre novamente.');
 const key=config.TOTP_ENCRYPTION_KEY||'';
 const attempt=await reserveAuthAttempt(db,{key:`mfa-actions:${auth.user.id}`});
 const actor=actorGuard(auth.user);
 const password=typeof data.password==='string'?data.password:'';
 if(action==='setup'){
  if(row.totp_enabled)throw new ApiError(409,'O autenticador já está ativo.');
  if(!password||password.length>256||!verifyPassword(password,String(row.password_hash)))throw new ApiError(403,'A senha atual está incorreta.');
  const secret=createTotpSecret(),encrypted=encryptSecret(secret,key);
  await guardedAuthWrite(db,`${actor.sql} AND EXISTS(SELECT 1 FROM users WHERE id=? AND version=? AND password_hash=? AND totp_enabled=0 AND active=1)`,[...actor.values,auth.user.id,row.version,row.password_hash],[
   db.prepare('UPDATE users SET totp_secret=?,totp_last_counter=-1,updated_at=?,version=version+1 WHERE id=?').bind(encrypted,timestamp(),auth.user.id),
   db.prepare('DELETE FROM login_attempts WHERE id=?').bind(attempt),
   audit(db,auth.user.id,'mfa.setup','users',auth.user.id,'Configuração do autenticador iniciada')
  ]);
  return json({secret,uri:`otpauth://totp/Vitality%20Gym:${encodeURIComponent(auth.user.login)}?secret=${secret}&issuer=Vitality%20Gym&algorithm=SHA1&digits=6&period=30`});
 }
 if(!row.totp_secret)throw new ApiError(400,'Configure o autenticador antes de continuar.');
 if(action==='enable'&&row.totp_enabled)throw new ApiError(409,'O autenticador já está ativo.');
 if(action==='disable'&&!row.totp_enabled)throw new ApiError(409,'O autenticador já está desativado.');
 if(action==='disable'&&(!password||password.length>256||!verifyPassword(password,String(row.password_hash))))throw new ApiError(403,'A senha atual está incorreta.');
 const counter=matchTotpCounter(decryptSecret(String(row.totp_secret),key),typeof data.code==='string'?data.code:'');
 if(counter===null||counter<=Number(row.totp_last_counter))throw new ApiError(400,'Código inválido ou já utilizado. Aguarde o próximo código do autenticador.');
 const enabled=action==='enable';
 await guardedAuthWrite(db,`${actor.sql} AND EXISTS(SELECT 1 FROM users WHERE id=? AND version=? AND password_hash=? AND totp_secret=? AND totp_enabled=? AND totp_last_counter<? AND active=1)`,[...actor.values,auth.user.id,row.version,row.password_hash,row.totp_secret,enabled?0:1,counter],[
  enabled?
   db.prepare('UPDATE users SET totp_enabled=1,totp_last_counter=?,updated_at=?,version=version+1 WHERE id=?').bind(counter,timestamp(),auth.user.id):
   db.prepare('UPDATE users SET totp_enabled=0,totp_secret=NULL,totp_last_counter=-1,updated_at=?,version=version+1 WHERE id=?').bind(timestamp(),auth.user.id),
  db.prepare('DELETE FROM sessions WHERE user_id=? AND id<>?').bind(auth.user.id,auth.sessionId),
  db.prepare('DELETE FROM login_attempts WHERE id=?').bind(attempt),
  audit(db,auth.user.id,enabled?'mfa.enabled':'mfa.disabled','users',auth.user.id,enabled?'Autenticador ativado':'Autenticador desativado')
 ]);
 return json({enabled});
}
