import { z } from "zod";
import type { Actor } from "../auth";
import { actorGuard } from '../auth';
import type { TableRows } from './types';
export type Row = Record<string, unknown>;
export class DomainError extends Error { constructor(public status:number, message:string, public code?:string, public fields?:Record<string,string>){super(message);} }
export const now = () => new Date().toISOString();
export const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const uid = () => crypto.randomUUID();
export const json = (data:unknown,status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export function permission(actor:Actor, name:string){return actor.permissions.includes('*')||actor.permissions.includes(name);}
export function requirePermission(actor:Actor,name:string){if(!permission(actor,name))throw new DomainError(403,'Seu perfil não tem permissão para esta operação.','FORBIDDEN');}
export function scoped(actor:Actor){return actor.role==='trainer'||actor.role==='personal';}
export function statement(db:D1Database, sql:string, values:unknown[]=[]){return db.prepare(sql).bind(...values.map(v=>v===undefined?null:typeof v==='boolean'?Number(v):v));}
export async function all<T = Row>(db:D1Database,sql:string,values:unknown[]=[]):Promise<T[]>{return (await statement(db,sql,values).all<T>()).results;}
export async function first<T = Row>(db:D1Database,sql:string,values:unknown[]=[]):Promise<T|null>{return statement(db,sql,values).first<T>();}
export async function count(db:D1Database,sql:string,values:unknown[]=[]){return Number((await first(db,sql,values))?.n??0);}
export function insert(db:D1Database,table:string,row:Row){const keys=Object.keys(row);return statement(db,`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,keys.map(k=>row[k]));}
export function metadata(id:string=uid()){const time=now();return{id,created_at:time,updated_at:time,version:1};}
export function audit(db:D1Database,actor:Actor,action:string,entity:string,entityId:string,summary:string){return insert(db,'audit_logs',{id:uid(),user_id:actor.id,action,entity,entity_id:entityId,summary,created_at:now()});}
export type Predicate={sql:string;values:unknown[]};
export function combineGuards(...guards:(Predicate|undefined)[]):Predicate {const present=guards.filter((guard):guard is Predicate=>Boolean(guard));return{sql:present.map(guard=>`(${guard.sql})`).join(' AND ')||'1',values:present.flatMap(guard=>guard.values)};}
export async function atomic(db:D1Database,actor:Actor,statements:D1PreparedStatement[],predicate?:Predicate){
 // A revoked or demoted account must not commit work authorized by an earlier read.
 const guard=combineGuards(actorGuard(actor),predicate);
 const id=uid();const queries=[statement(db,`INSERT INTO transaction_guards(id,ok) VALUES (?,CASE WHEN (${guard.sql}) THEN 1 ELSE 0 END)`,[id,...guard.values]),...statements,statement(db,'DELETE FROM transaction_guards WHERE id=?',[id])];
 try{return await db.batch(queries);}catch(e){throw mapDbError(e);}
}
export function mapDbError(e:unknown):Error{
 if(e instanceof DomainError)return e;
 const message=e instanceof Error?e.message:String(e);
 if(/transaction_guard/i.test(message))return new DomainError(409,'Este registro mudou ou a operação não está mais disponível. Atualize a tela e tente novamente.','CONFLICT');
 if(/one_active_membership/i.test(message)||/memberships.student_id/i.test(message))return new DomainError(409,'Este aluno já tem uma matrícula ativa ou suspensa. Renove ou cancele a matrícula existente.','MEMBERSHIP_EXISTS');
 if(/one_open_attendance|attendance.student_id/i.test(message))return new DomainError(409,'Este aluno já está dentro da academia. Registre a saída antes de uma nova entrada.','ALREADY_INSIDE');
 if(/capacity_exceeded/i.test(message))return new DomainError(409,'Esta aula está lotada. Atualize a agenda para ver as vagas disponíveis.','CLASS_FULL');
 if(/insufficient_stock|product_stock_nonnegative/i.test(message))return new DomainError(409,'Estoque insuficiente para concluir esta operação.','INSUFFICIENT_STOCK');
 if(/payment_state_invalid|refund_state_invalid/i.test(message))return new DomainError(409,'O estado financeiro mudou. Atualize a cobrança antes de continuar.','PAYMENT_STATE');
 if(/class_unavailable/i.test(message))return new DomainError(409,'Esta aula não está disponível para reservas.','CLASS_UNAVAILABLE');
 if(/student_inactive/i.test(message))return new DomainError(409,'O aluno foi desativado. Atualize o cadastro antes de continuar.','STUDENT_INACTIVE');
 if(/bookings.class_id|booking_unique/i.test(message))return new DomainError(409,'O aluno já está inscrito nesta aula.','ALREADY_BOOKED');
 if(/one_completed_payment|payments.invoice_id/i.test(message))return new DomainError(409,'Esta cobrança já possui pagamento confirmado.','ALREADY_PAID');
 if(/UNIQUE constraint|unique constraint/i.test(message))return new DomainError(409,'Já existe um registro com esses dados. Atualize a tela antes de repetir a operação.','DUPLICATE');
 if(/FOREIGN KEY/i.test(message))return new DomainError(422,'Um dos registros vinculados não existe mais. Atualize as opções do formulário.','INVALID_REFERENCE');
 if(/CHECK constraint/i.test(message))return new DomainError(422,'A operação viola uma regra de integridade dos dados.','INTEGRITY');
 return e instanceof Error?e:new Error(message);
}
export async function body(request:Request):Promise<Row>{
 const max=256*1024;
 if(request.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/json')throw new DomainError(415,'Envie os dados no formato JSON.','CONTENT_TYPE');
 if(Number(request.headers.get('content-length')||0)>max)throw new DomainError(413,'O formulário excede o limite de 256 KiB.','PAYLOAD_TOO_LARGE');
 const reader=request.body?.getReader();if(!reader)throw new DomainError(400,'Envie um objeto JSON válido.','INVALID_JSON');
 let length=0;const chunks:Uint8Array[]=[];
 while(true){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>max){await reader.cancel();throw new DomainError(413,'O formulário excede o limite de 256 KiB.','PAYLOAD_TOO_LARGE');}chunks.push(value);}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{const data=JSON.parse(new TextDecoder().decode(bytes));if(!data||typeof data!=='object'||Array.isArray(data))throw 0;return data as Row;}catch{throw new DomainError(400,'Envie um objeto JSON válido.','INVALID_JSON');}
}
export function parse<T extends z.ZodType>(schema:T,data:unknown):z.infer<T>{const result=schema.safeParse(data);if(result.success)return result.data;const fields:Record<string,string>={};for(const issue of result.error.issues){fields[issue.path.join('.')||'form']=issue.message;}throw new DomainError(422,'Revise os campos destacados.', 'VALIDATION',fields);}
export async function studentAccess(db:D1Database,actor:Actor,id:string,active=false){const row=await first<TableRows['students']>(db,'SELECT * FROM students WHERE id=?',[id]);if(!row)throw new DomainError(404,'Aluno não encontrado.');if(scoped(actor)&&row.trainer_id!==actor.id)throw new DomainError(403,'Este aluno não está sob sua responsabilidade.','STUDENT_SCOPE');if(active&&row.status!=='active')throw new DomainError(422,'O aluno está inativo. Ative o cadastro antes de continuar.');return row;}
export async function exists<Name extends keyof TableRows>(db:D1Database,table:Name,id:string,active=false){const row=await first<TableRows[Name] & Row>(db,`SELECT * FROM ${table} WHERE id=?`,[id]);if(!row)throw new DomainError(422,'O registro selecionado não foi encontrado.','INVALID_REFERENCE');if(active&&row.status!=='active')throw new DomainError(422,'O registro selecionado está inativo.');return row;}
export function versionGuard(table:string,id:string,version:number,extra='1',values:unknown[]=[]){return {sql:`EXISTS(SELECT 1 FROM ${table} WHERE id=? AND version=? AND (${extra}))`,values:[id,version,...values]};}
export function ensureVersion(current:number,submitted:number){if(current!==submitted)throw new DomainError(409,'Este registro foi atualizado. Recarregue antes de salvar.','CONFLICT');}
function checkedDate(date:Date){const year=date.getUTCFullYear();if(Number.isNaN(date.getTime())||year<1||year>9999)throw new DomainError(422,'O período informado excede o intervalo de datas suportado.','INVALID_DATE');return date.toISOString().slice(0,10);}
export function addMonths(date:string,months:number){const [y,m,d]=date.split('-').map(Number);const base=new Date(date+'T12:00:00Z');base.setUTCDate(1);base.setUTCFullYear(y,m-1+months,1);const last=new Date(base);last.setUTCMonth(last.getUTCMonth()+1,0);base.setUTCDate(Math.min(d,last.getUTCDate()));return checkedDate(base);}
export function dayOffset(date:string,days:number){const dt=new Date(date+'T12:00:00Z');dt.setUTCDate(dt.getUTCDate()+days);return checkedDate(dt);}
export const textRequired=(max=160)=>z.string().trim().min(1,'Preencha este campo.').max(max,`Use no máximo ${max} caracteres.`);
export const textOptional=(max=500)=>z.preprocess(v=>v===''||v===undefined?null:v,z.string().trim().max(max).nullable()).optional();
export const ref=z.string().min(1).max(100);
export const optionalRef=z.preprocess(v=>v===''||v===undefined?null:v,ref.nullable()).optional();
// Form inputs may be numeric strings, but booleans/null/arrays are never valid money or quantities.
export const numeric=z.union([z.number(),z.string().trim().min(1)]).pipe(z.coerce.number());
export const int=(min=0,max=100_000_000)=>numeric.pipe(z.number().int('Informe um número inteiro.').min(min).max(max));
export const versionSchema=int(1);
export const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/,'Informe uma data válida.').refine(v=>{const d=new Date(v+'T12:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;},'Informe uma data válida.');
export const optionalDate=z.preprocess(v=>v===''||v===undefined?null:v,dateSchema.nullable()).optional();
export const optionalNumber=(min:number,max:number)=>z.preprocess(v=>v===''||v===undefined?null:v,numeric.pipe(z.number().min(min).max(max)).nullable()).optional();
export const email=z.preprocess(v=>v===''||v===undefined?null:v,z.string().trim().email('Informe um e-mail válido.').max(254).nullable()).optional();
export const activeStatus=z.enum(['active','inactive']).default('active');
export const methodSchema=z.enum(['pix','cash','card','transfer']);
export const reasonSchema=textRequired(500).min(3,'Descreva o motivo com pelo menos 3 caracteres.');
export const actionVersion=z.object({version:versionSchema}).strict();
export function safeCsv(rows:Row[],columns:[string,string][]) {const cell=(v:unknown)=>{let str=String(v??'');if(/^[=+\-@\t\r]/.test(str.trimStart()))str="\t"+str;return '"'+str.replaceAll('"','""')+'"';};return '\ufeff'+[columns.map(c=>cell(c[1])).join(';'),...rows.map(row=>columns.map(([k])=>cell(row[k])).join(';'))].join('\r\n');}
