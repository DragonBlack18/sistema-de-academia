import {z} from 'zod';
import type {Actor} from '../auth';
import {DomainError,Row,Predicate,first,body,parse,json,requirePermission,permission,scoped,studentAccess,metadata,now,today,uid,insert,audit,atomic,statement,versionGuard,versionSchema,actionVersion,reasonSchema,ref,dayOffset,combineGuards,ensureVersion} from './common';
import {workoutSchema} from './schemas';
import {getEntity} from './entities';
import type {TableRows} from './types';

async function validateItems(db:D1Database,items:Row[]){const guard=exerciseGuard(items);if(!await first(db,`SELECT 1 AS valid WHERE ${guard.sql}`,guard.values))throw new DomainError(422,'Um exercício selecionado está indisponível. Atualize o catálogo.');}
function exerciseGuard(items:Row[]):Predicate {const ids=[...new Set(items.map(item=>item.exercise_id))];return{sql:`(SELECT count(*) FROM exercises WHERE id IN (SELECT value FROM json_each(?)) AND status='active')=?`,values:[JSON.stringify(ids),ids.length]};}
function studentGuard(actor:Actor,id:string,active=false):Predicate{return{sql:`EXISTS(SELECT 1 FROM students WHERE id=? ${active?"AND status='active'":''} ${scoped(actor)?'AND trainer_id=?':''})`,values:scoped(actor)?[id,actor.id]:[id]};}
function itemRows(db:D1Database,id:string,items:Row[]){return items.map((item,index)=>insert(db,'workout_items',{id:uid(),workout_id:id,...item,position:index}));}
function workoutSnapshot(workout:Row){return JSON.stringify(Object.fromEntries(Object.entries(workout).filter(([key])=>key!=='history'&&key!=='sessions')));}
export async function createWorkout(db:D1Database,actor:Actor,request:Request){
 requirePermission(actor,'workouts.write');const{items,...data}=parse(workoutSchema,await body(request));await studentAccess(db,actor,data.student_id,true);await validateItems(db,items);
 const row={...metadata(),...data,trainer_id:actor.id,status:'draft'};
 await atomic(db,actor,[insert(db,'workouts',row),...itemRows(db,row.id,items),audit(db,actor,'create','workouts',row.id,`Ficha de treino criada: ${row.name}.`)],combineGuards(studentGuard(actor,data.student_id,true),exerciseGuard(items)));
 return json(await getEntity(db,actor,'workouts',row.id),201);
}
export async function updateWorkout(db:D1Database,actor:Actor,id:string,request:Request){
 requirePermission(actor,'workouts.write');const current=await getEntity(db,actor,'workouts',id);
 if(current.status==='archived')throw new DomainError(409,'Fichas arquivadas preservam o histórico. Crie uma nova ficha.');
 const{version,items,...data}=parse(workoutSchema.extend({version:versionSchema}).strict(),await body(request));
 ensureVersion(current.version,version);
 if(current.student_id!==data.student_id)throw new DomainError(422,'O aluno de uma ficha existente não pode ser alterado.');await validateItems(db,items);
 const fields=Object.keys(data);const queries=[insert(db,'workout_history',{id:uid(),workout_id:id,snapshot:workoutSnapshot(current),version:current.version,created_by:actor.id,created_at:now()}),statement(db,`UPDATE workouts SET ${fields.map(k=>k+'=?').join(',')},updated_at=?,version=version+1 WHERE id=?`,[...fields.map(k=>(data as Row)[k]),now(),id]),statement(db,'DELETE FROM workout_items WHERE workout_id=?',[id]),...itemRows(db,id,items),audit(db,actor,'update','workouts',id,`Treino revisado: ${current.name}. Versão anterior preservada.`)];
 await atomic(db,actor,queries,combineGuards(versionGuard('workouts',id,version,"status!='archived'"),studentGuard(actor,current.student_id),exerciseGuard(items)));
 return json(await getEntity(db,actor,'workouts',id));
}
export async function workoutAction(db:D1Database,actor:Actor,id:string,action:string,request:Request){
 requirePermission(actor,'workouts.write');const current=await getEntity(db,actor,'workouts',id);
 if(action==='complete'){
  const data=parse(z.object({notes:z.string().max(2000).optional()}).strict(),await body(request));
  if(current.status!=='active')throw new DomainError(409,'Registre a execução de uma ficha ativa.');
  await studentAccess(db,actor,current.student_id,true);
  const session={id:uid(),workout_id:id,student_id:current.student_id,notes:data.notes||null,created_by:actor.id,completed_at:now()};
  await atomic(db,actor,[insert(db,'workout_sessions',session),audit(db,actor,'complete','workouts',id,`Execução registrada: ${current.name}.`)],combineGuards(versionGuard('workouts',id,current.version,"status='active'"),studentGuard(actor,current.student_id,true)));return json(session,201);
 }
 if(!['activate','archive'].includes(action))return null;
 const data=parse(actionVersion,await body(request));
 ensureVersion(current.version,data.version);
 if(current.status==='archived')throw new DomainError(409,'A ficha está arquivada. Crie uma nova ficha para preservar o histórico.');
 const queries:D1PreparedStatement[]=[];
 let previousGuard:Predicate|undefined;
 if(action==='activate'){
  if(current.status==='active')throw new DomainError(409,'Este treino já está ativo.');
  await studentAccess(db,actor,current.student_id,true);
  await validateItems(db,current.items);
  const other=await first<TableRows['workouts']>(db,"SELECT * FROM workouts WHERE student_id=? AND status='active' AND id!=?",[current.student_id,id]);
  if(other){const full=await getEntity(db,actor,'workouts',other.id);previousGuard=versionGuard('workouts',other.id,full.version,"status='active' AND student_id=?",[current.student_id]);queries.push(insert(db,'workout_history',{id:uid(),workout_id:other.id,snapshot:workoutSnapshot(full),version:full.version,created_by:actor.id,created_at:now()}),statement(db,"UPDATE workouts SET status='archived',updated_at=?,version=version+1 WHERE id=?",[now(),other.id]));}
  else previousGuard={sql:"NOT EXISTS(SELECT 1 FROM workouts WHERE student_id=? AND status='active' AND id!=?)",values:[current.student_id,id]};
 }
 queries.push(insert(db,'workout_history',{id:uid(),workout_id:id,snapshot:workoutSnapshot(current),version:current.version,created_by:actor.id,created_at:now()}),statement(db,'UPDATE workouts SET status=?,updated_at=?,version=version+1 WHERE id=?',[action==='activate'?'active':'archived',now(),id]),audit(db,actor,action,'workouts',id,`Ficha ${action==='activate'?'ativada':'arquivada'}: ${current.name}.`));
 await atomic(db,actor,queries,combineGuards(versionGuard('workouts',id,data.version,"status!='archived'"),studentGuard(actor,current.student_id,action==='activate'),previousGuard,action==='activate'?exerciseGuard(current.items):undefined));return json(await getEntity(db,actor,'workouts',id));
}
export async function checkIn(db:D1Database,actor:Actor,request:Request){
 requirePermission(actor,'attendance.write');const data=parse(z.object({student_id:ref,override_reason:reasonSchema.optional()}).strict(),await body(request));
 const student=await studentAccess(db,actor,data.student_id);const date=today();
 const settings=await first<Pick<TableRows['settings'],'value'|'version'>>(db,"SELECT value,version FROM settings WHERE id='gym'");let grace=3;try{const value=JSON.parse(settings?.value||'{}');const configured=Number(value.accessGraceDays??3);if(Number.isInteger(configured)&&configured>=0&&configured<=30)grace=configured;}catch{}
 const cutoff=dayOffset(date,-grace);
 const membership=await first<TableRows['memberships'] & Pick<TableRows['plans'],'access_start'|'access_end'> & {plan_version:number}>(db,"SELECT m.*,p.access_start,p.access_end,p.version plan_version FROM memberships m JOIN plans p ON p.id=m.plan_id WHERE m.student_id=? AND m.status='active' AND m.start_date<=? AND m.end_date>=? LIMIT 1",[student.id,date,date]);
 let reason=student.status!=='active'?'Cadastro do aluno inativo.':!membership?'Matrícula ativa não encontrada para esta data.':'';
 if(!reason&&await first(db,"SELECT id FROM invoices WHERE student_id=? AND amount_cents>0 AND status IN ('open','refunded') AND due_date<? LIMIT 1",[student.id,cutoff]))reason=`Mensalidade em atraso além da carência de ${grace} dias.`;
 const time=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());
 if(!reason&&membership?.access_start&&membership?.access_end){const a=membership.access_start,b=membership.access_end;const allowed=a<=b?time>=a&&time<=b:time>=a||time<=b;if(!allowed)reason='Fora do horário de acesso contratado.';}
 if(data.override_reason&&!permission(actor,'attendance.override'))throw new DomainError(403,'Seu perfil não pode conceder exceções de acesso.');
 if(reason&&!data.override_reason){await atomic(db,actor,[insert(db,'access_events',{id:uid(),student_id:student.id,user_id:actor.id,decision:'denied',reason,created_at:now()}),audit(db,actor,'access.denied','attendance',student.id,reason)]);throw new DomainError(403,reason,'ACCESS_DENIED');}
 const record={id:uid(),student_id:student.id,check_in:now(),check_out:null,created_by:actor.id,override_reason:data.override_reason||null};
 const condition=data.override_reason?{sql:'EXISTS(SELECT 1 FROM students WHERE id=?)',values:[student.id]}:{sql:"EXISTS(SELECT 1 FROM students WHERE id=? AND status='active') AND EXISTS(SELECT 1 FROM memberships WHERE id=? AND version=? AND status='active' AND start_date<=? AND end_date>=?) AND EXISTS(SELECT 1 FROM plans WHERE id=? AND version=?) AND EXISTS(SELECT 1 FROM settings WHERE id='gym' AND version=?) AND NOT EXISTS(SELECT 1 FROM invoices WHERE student_id=? AND amount_cents>0 AND status IN ('open','refunded') AND due_date<?)",values:[student.id,membership?.id,membership?.version,date,date,membership?.plan_id,membership?.plan_version,settings?.version,student.id,cutoff]};
 await atomic(db,actor,[insert(db,'attendance',record),insert(db,'access_events',{id:uid(),student_id:student.id,user_id:actor.id,decision:'allowed',reason:data.override_reason?'Exceção autorizada: '+data.override_reason:'Matrícula e política de acesso válidas.',created_at:now()}),audit(db,actor,'check-in','attendance',record.id,`Entrada registrada: ${student.name}${data.override_reason?'. Exceção: '+data.override_reason:''}.`)],condition);
 return json({...record,student_name:student.name},201);
}
export async function checkOut(db:D1Database,actor:Actor,id:string){
 requirePermission(actor,'attendance.write');const current=await getEntity(db,actor,'attendance',id,false);if(current.check_out)throw new DomainError(409,'A saída já foi registrada.');
 await atomic(db,actor,[statement(db,'UPDATE attendance SET check_out=? WHERE id=?',[now(),id]),audit(db,actor,'check-out','attendance',id,`Saída registrada: ${current.student_name}.`)],{sql:'EXISTS(SELECT 1 FROM attendance WHERE id=? AND check_out IS NULL)',values:[id]});return json(await getEntity(db,actor,'attendance',id));
}
export async function bookingAction(db:D1Database,actor:Actor,id:string,action:string,request:Request){
 requirePermission(actor,'classes.write');const cls=await getEntity(db,actor,'classes',id,false);const data=parse(z.object({student_id:ref}).strict(),await body(request));const student=await studentAccess(db,actor,data.student_id,action==='book');
 if(scoped(actor)&&cls.instructor_id!==actor.id)throw new DomainError(403,'Você só pode gerenciar reservas de suas aulas.');
 const classGuard=versionGuard('classes',id,cls.version,scoped(actor)?'instructor_id=?':'1',scoped(actor)?[actor.id]:[]);
 if(action==='book'){
  if(cls.status!=='scheduled'||cls.starts_at<now())throw new DomainError(409,'A aula não está disponível para novas reservas.');
  const booking={id:uid(),class_id:id,student_id:data.student_id,created_by:actor.id,created_at:now()};
  await atomic(db,actor,[insert(db,'bookings',booking),audit(db,actor,'book','classes',id,`${student.name} inscrito em ${cls.name}.`)],combineGuards(classGuard,studentGuard(actor,student.id,true),{sql:"EXISTS(SELECT 1 FROM classes WHERE id=? AND status='scheduled' AND starts_at>?)",values:[id,now()]}));return json({...booking,student_name:student.name},201);
 }
 if(action==='unbook'){
  const booking=await first(db,'SELECT * FROM bookings WHERE class_id=? AND student_id=?',[id,data.student_id]);if(!booking)throw new DomainError(404,'Reserva não encontrada.');
  await atomic(db,actor,[statement(db,'DELETE FROM bookings WHERE id=?',[booking.id]),audit(db,actor,'unbook','classes',id,`Reserva de ${student.name} cancelada em ${cls.name}.`)],combineGuards(classGuard,studentGuard(actor,student.id),{sql:'EXISTS(SELECT 1 FROM bookings WHERE id=?)',values:[booking.id]}));return json({ok:true});
 }
 return null;
}
