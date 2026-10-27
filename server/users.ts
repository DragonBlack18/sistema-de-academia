import { z } from 'zod';
import { Actor, ROLES, publicUser, requirePermission, audit, actorGuard } from './auth';
import { ApiError,bodyJson,hashPassword,json,timestamp,uuid,guardedAuthWrite } from './security';

const createSchema=z.object({name:z.string().trim().min(2).max(100),login:z.string().trim().toLowerCase().min(3).max(180),password:z.string().min(10).max(128),role:z.enum(ROLES),active:z.boolean().default(true)}).strict();
const patchSchema=createSchema.omit({password:true,active:true}).partial().extend({active:z.boolean().optional(),password:z.string().min(10).max(128).optional(),version:z.number().int().positive()}).strict();
function pagination(value:string|null,fallback:number,max:number){if(value===null)return fallback;if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<1||Number(value)>max)throw new ApiError(400,'Paginação inválida.');return Number(value);}

export async function handleUsers(request:Request,url:URL,db:D1Database,actor:Actor){
 const path=url.pathname.match(/^\/api\/users(?:\/([^/]+))?\/?$/);if(!path)throw new ApiError(404,'Recurso não encontrado.');
 const id=path[1];if(id&&id.length>100)throw new ApiError(404,'Acesso não encontrado.');
 requirePermission(actor,request.method==='GET'?'users.read':'users.write');
 if(request.method==='GET'){
  if(id){const row=await db.prepare('SELECT * FROM users WHERE id=?').bind(id).first<Record<string,unknown>>();if(!row)throw new ApiError(404,'Acesso não encontrado.');return json(publicUser(row));}
  const page=pagination(url.searchParams.get('page'),1,1_000_000),pageSize=pagination(url.searchParams.get('pageSize'),20,100);
  const q=(url.searchParams.get('q')||'').slice(0,100);
  // D1 caps LIKE/GLOB patterns at 50 bytes; instr also treats % and _ literally.
  const result=await db.prepare('SELECT * FROM users WHERE instr(lower(name),lower(?))>0 OR instr(lower(login),lower(?))>0 ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').bind(q,q,pageSize,(page-1)*pageSize).all<Record<string,unknown>>();
  const total=await db.prepare('SELECT count(*) AS n FROM users WHERE instr(lower(name),lower(?))>0 OR instr(lower(login),lower(?))>0').bind(q,q).first<{n:number}>();
  return json({data:result.results.map(row=>({...publicUser(row),created_at:row.created_at,updated_at:row.updated_at})),total:total?.n||0,page,pageSize});
 }
 if(request.method==='POST'&&!id){
  const b=createSchema.parse(await bodyJson(request));
  if(actor.role!=='super_admin'&&['admin','super_admin'].includes(b.role))throw new ApiError(403,'Somente o proprietário pode criar administradores.');
  const newId=uuid(),now=timestamp(),guard=actorGuard(actor);
  await guardedAuthWrite(db,guard.sql,guard.values,[
   db.prepare('INSERT INTO users (id,name,login,password_hash,role,active,must_change_password,created_at,updated_at,version) VALUES (?,?,?,?,?,?,1,?,?,1)').bind(newId,b.name,b.login,hashPassword(b.password),b.role,b.active?1:0,now,now),
   audit(db,actor.id,'user.created','users',newId,`Acesso ${b.name} criado com perfil ${b.role}`)
  ]);
  const result=await db.prepare('SELECT * FROM users WHERE id=?').bind(newId).first<Record<string,unknown>>();
  return json(publicUser(result!),201);
 }
 if(request.method==='PATCH'&&id){
  const b=patchSchema.parse(await bodyJson(request));
  const row=await db.prepare('SELECT * FROM users WHERE id=?').bind(id).first<Record<string,unknown>>();
  if(!row)throw new ApiError(404,'Acesso não encontrado.');
  if(Number(row.version)!==b.version)throw new ApiError(409,'O acesso foi alterado em outra sessão. Recarregue a lista.');
  if(actor.role!=='super_admin'&&(['admin','super_admin'].includes(String(row.role))||['admin','super_admin'].includes(b.role||'')))throw new ApiError(403,'Somente o proprietário pode alterar acessos administrativos.');
  if(id===actor.id&&(b.active===false||(b.role&&b.role!==actor.role)))throw new ApiError(400,'Use outro proprietário para alterar seu próprio nível de acesso.');
  if(b.password&&row.role==='super_admin')throw new ApiError(403,'O proprietário altera a própria senha em Segurança.');
  const update={name:b.name??row.name,login:b.login??row.login,role:b.role??row.role,active:b.active===undefined?row.active:b.active?1:0,hash:b.password?hashPassword(b.password):row.password_hash};
  const demote=row.role==='super_admin'&&(update.role!=='super_admin'||!update.active);
  const guard=actorGuard(actor),predicate=`${guard.sql} AND EXISTS(SELECT 1 FROM users WHERE id=? AND version=?)${demote?" AND (SELECT COUNT(*) FROM users WHERE role='super_admin' AND active=1)>1":''}`;
  await guardedAuthWrite(db,predicate,[...guard.values,id,b.version],[
   db.prepare('UPDATE users SET name=?,login=?,role=?,active=?,password_hash=?,must_change_password=?,updated_at=?,version=version+1 WHERE id=?').bind(update.name,update.login,update.role,update.active,update.hash,b.password?1:row.must_change_password,timestamp(),id),
   db.prepare('DELETE FROM sessions WHERE user_id=?').bind(id),
   audit(db,actor.id,'user.updated','users',id,`Acesso ${update.name} atualizado; sessões revogadas`)
  ]);
  return json(publicUser((await db.prepare('SELECT * FROM users WHERE id=?').bind(id).first<Record<string,unknown>>())!));
 }
 throw new ApiError(405,'Operação não disponível para acessos.');
}
