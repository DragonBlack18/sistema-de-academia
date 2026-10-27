import {z} from 'zod';
import type {Actor} from '../auth';
import {DomainError,requirePermission,body,parse,studentAccess,exists,metadata,uid,now,today,insert,audit,atomic,statement,first,versionGuard,versionSchema,methodSchema,reasonSchema,addMonths,dayOffset,actionVersion,ensureVersion} from './common';
import {schemas} from './schemas';
import {getEntity} from './entities';
import {json} from './common';

export async function createMembership(db:D1Database,actor:Actor,request:Request){
 requirePermission(actor,'memberships.write');const data=parse(schemas.memberships,await body(request));
 const student=await studentAccess(db,actor,data.student_id,true);const plan=await exists(db,'plans',data.plan_id,true);
 if(data.discount_cents>plan.price_cents)throw new DomainError(422,'O desconto não pode ultrapassar o preço do plano.');
 if(data.discount_cents>0&&!actor.permissions.includes('*')&&!actor.permissions.includes('finance.write'))throw new DomainError(403,'Seu perfil não pode conceder descontos.');
 const m={...metadata(),...data,contracted_price_cents:plan.price_cents,duration_months:plan.duration_months,end_date:dayOffset(addMonths(data.start_date,plan.duration_months),-1),due_date:data.start_date,status:'active'};
 const invoice={...metadata(),student_id:student.id,membership_id:m.id,description:`${plan.name} · ${data.start_date} a ${m.end_date}`,amount_cents:plan.price_cents-data.discount_cents,due_date:data.start_date,status:'open'};
 await atomic(db,actor,[insert(db,'memberships',m),insert(db,'invoices',invoice),insert(db,'membership_events',{id:uid(),membership_id:m.id,user_id:actor.id,event:'created',reason:null,snapshot:JSON.stringify(m),created_at:now()}),audit(db,actor,'create','memberships',m.id,`Matrícula criada para ${student.name}; cobrança de ${(invoice.amount_cents/100).toFixed(2)} BRL.`)],{sql:'EXISTS(SELECT 1 FROM plans WHERE id=? AND version=? AND status=\'active\') AND EXISTS(SELECT 1 FROM students WHERE id=? AND status=\'active\')',values:[plan.id,plan.version,student.id]});
 return json(await getEntity(db,actor,'memberships',m.id),201);
}
export async function membershipAction(db:D1Database,actor:Actor,id:string,action:string,request:Request){
 requirePermission(actor,'memberships.write');const current=await getEntity(db,actor,'memberships',id,false);
 if(!['renew','suspend','cancel','resume'].includes(action))return null;
 const data=action==='renew'||action==='resume'?parse(actionVersion,await body(request)):parse(z.object({version:versionSchema,reason:reasonSchema}).strict(),await body(request));
 ensureVersion(current.version,data.version);
 if(action==='renew'){
  if(current.status==='cancelled')throw new DomainError(409,'A matrícula foi cancelada. Crie uma nova matrícula.');
  await studentAccess(db,actor,current.student_id,true);
  const next=dayOffset(current.end_date,1);const start_date=next<today()?today():next;
  const end_date=dayOffset(addMonths(start_date,current.duration_months),-1);
  const amount=current.contracted_price_cents-current.discount_cents;
  const invoice={...metadata(),student_id:current.student_id,membership_id:id,description:`Renovação ${current.plan_name} · ${start_date} a ${end_date}`,amount_cents:amount,due_date:start_date,status:'open'};
  await atomic(db,actor,[insert(db,'membership_events',{id:uid(),membership_id:id,user_id:actor.id,event:'renewed',reason:'Renovação de período',snapshot:JSON.stringify(current),created_at:now()}),statement(db,"UPDATE memberships SET start_date=?,end_date=?,due_date=?,status='active',reason=NULL,version=version+1,updated_at=? WHERE id=?",[current.end_date>=today()?current.start_date:start_date,end_date,start_date,now(),id]),insert(db,'invoices',invoice),audit(db,actor,'renew','memberships',id,`Matrícula renovada até ${end_date}; preço contratado preservado.`)],versionGuard('memberships',id,data.version,"status!='cancelled' AND EXISTS(SELECT 1 FROM students WHERE id=memberships.student_id AND status='active')"));
 }else{
  const target=action==='suspend'?'suspended':action==='resume'?'active':'cancelled';
  if(action==='suspend'&&current.status!=='active')throw new DomainError(409,'Somente uma matrícula ativa pode ser suspensa.');
  if(action==='resume'&&current.status!=='suspended')throw new DomainError(409,'Somente uma matrícula suspensa pode ser retomada.');
  if(action==='resume')await studentAccess(db,actor,current.student_id,true);
  if(action==='cancel'&&current.status==='cancelled')throw new DomainError(409,'Esta matrícula já está cancelada.');
  const reason='reason' in data?data.reason:'Retomada da matrícula';
  await atomic(db,actor,[insert(db,'membership_events',{id:uid(),membership_id:id,user_id:actor.id,event:action,reason,snapshot:JSON.stringify(current),created_at:now()}),statement(db,'UPDATE memberships SET status=?,reason=?,version=version+1,updated_at=? WHERE id=?',[target,reason,now(),id]),audit(db,actor,action,'memberships',id,`${current.student_name}: ${reason}. Histórico e cobranças preservados.`)],versionGuard('memberships',id,data.version,`status=? ${action==='resume'?"AND EXISTS(SELECT 1 FROM students WHERE id=memberships.student_id AND status='active')":''}`,[current.status]));
 }
 return json(await getEntity(db,actor,'memberships',id));
}
export async function createInvoice(db:D1Database,actor:Actor,request:Request){
 requirePermission(actor,'finance.write');const data=parse(schemas.invoices,await body(request));await studentAccess(db,actor,data.student_id);
 if(data.membership_id){const membership=await exists(db,'memberships',data.membership_id);if(membership.student_id!==data.student_id)throw new DomainError(422,'A matrícula deve pertencer ao aluno da cobrança.');}
 const row={...metadata(),...data,status:'open'};await atomic(db,actor,[insert(db,'invoices',row),audit(db,actor,'create','invoices',row.id,`Cobrança criada: ${data.description}.`)]);
 return json(await getEntity(db,actor,'invoices',row.id),201);
}
const keySchema=z.string().trim().min(8).max(120).regex(/^[\w.:-]+$/);
async function replay(db:D1Database,key:string,scope:string,id:string,fingerprint:string){
 const operation=await first(db,'SELECT * FROM operation_keys WHERE id=?',[key]);if(!operation)return false;
 if(operation.scope!==scope||operation.entity_id!==id||operation.fingerprint!==fingerprint)throw new DomainError(409,'Esta chave de operação já foi usada com outros dados.','IDEMPOTENCY_CONFLICT');return true;
}
export async function invoiceAction(db:D1Database,actor:Actor,id:string,action:string,request:Request){
 requirePermission(actor,'finance.write');if(!['pay','refund','cancel'].includes(action))return null;
 const raw=await body(request);
 const data=action==='pay'?parse(z.object({version:versionSchema,method:methodSchema,idempotencyKey:keySchema}).strict(),raw):action==='refund'?parse(z.object({version:versionSchema,reason:reasonSchema,idempotencyKey:keySchema}).strict(),raw):parse(z.object({version:versionSchema,reason:reasonSchema}).strict(),raw);
 const scope=`invoice.${action}:${actor.id}`;const fingerprint=JSON.stringify({id,method:'method'in data?data.method:undefined,reason:'reason'in data?data.reason:undefined});
 if('idempotencyKey'in data&&await replay(db,data.idempotencyKey,scope,id,fingerprint))return json({...await getEntity(db,actor,'invoices',id),replayed:true});
 const invoice=await getEntity(db,actor,'invoices',id,false);const queries:D1PreparedStatement[]=[];
 ensureVersion(invoice.version,data.version);
 if('idempotencyKey'in data)queries.push(insert(db,'operation_keys',{id:data.idempotencyKey,scope,entity_id:id,fingerprint,created_at:now()}));
 let statusGuard='';
 if(action==='pay'){
  if(!['open','refunded'].includes(invoice.status))throw new DomainError(409,'Somente cobranças abertas ou estornadas podem receber pagamento.');
  const payment={id:uid(),invoice_id:id,amount_cents:invoice.amount_cents,method:'method'in data?data.method:'cash',status:'completed',idempotency_key:'idempotencyKey'in data?data.idempotencyKey:uid(),created_by:actor.id,created_at:now()};
  queries.push(insert(db,'payments',payment),statement(db,"UPDATE invoices SET status='paid',payment_method=?,paid_at=?,version=version+1,updated_at=? WHERE id=?",[payment.method,payment.created_at,now(),id]));statusGuard="status IN ('open','refunded')";
 }else if(action==='refund'){
  if(invoice.status!=='paid')throw new DomainError(409,'Somente uma cobrança paga pode ser estornada.');
  const payment=await first(db,"SELECT * FROM payments WHERE invoice_id=? AND status='completed'",[id]);if(!payment)throw new DomainError(409,'O pagamento confirmado não foi encontrado.');
  queries.push(insert(db,'refunds',{id:uid(),payment_id:payment.id,invoice_id:id,amount_cents:payment.amount_cents,reason:'reason'in data?data.reason:'',idempotency_key:'idempotencyKey'in data?data.idempotencyKey:uid(),created_by:actor.id,created_at:now()}),statement(db,"UPDATE payments SET status='refunded' WHERE id=?",[payment.id]),statement(db,"UPDATE invoices SET status='refunded',paid_at=NULL,payment_method=NULL,version=version+1,updated_at=? WHERE id=?",[now(),id]));statusGuard="status='paid'";
 }else{
  if(!['open','refunded'].includes(invoice.status))throw new DomainError(409,'Cancele apenas cobranças sem pagamento vigente.');
  queries.push(statement(db,"UPDATE invoices SET status='cancelled',cancel_reason=?,version=version+1,updated_at=? WHERE id=?",['reason'in data?data.reason:'',now(),id]));statusGuard="status IN ('open','refunded')";
 }
 queries.push(audit(db,actor,action,'invoices',id,`${invoice.description}: ${action==='pay'?'pagamento confirmado':action==='refund'?'estorno registrado':'cobrança cancelada'}${'reason'in data?'. Motivo: '+data.reason:''}.`));
 try{await atomic(db,actor,queries,versionGuard('invoices',id,data.version,statusGuard));}catch(e){if('idempotencyKey'in data&&await replay(db,data.idempotencyKey,scope,id,fingerprint))return json({...await getEntity(db,actor,'invoices',id),replayed:true});throw e;}
 return json(await getEntity(db,actor,'invoices',id));
}
