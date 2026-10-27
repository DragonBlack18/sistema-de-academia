import { z } from 'zod';
import type { Actor } from '../auth';
import {DomainError,Row,all,first,body,parse,json,permission,requirePermission,scoped,studentAccess,exists,metadata,now,insert,audit,atomic,versionGuard,versionSchema,statement,today,reasonSchema} from './common';
import {schemas} from './schemas';
import type { EntityRows, EntityDetail, TableRows } from './types';

// Both schema-validated mutations and database records use nullable string references.
type RelatedRow = Row & Partial<Pick<TableRows['students'],'trainer_id'> & Pick<TableRows['assessments'],'student_id'> & Pick<TableRows['staff'],'user_id'> & Pick<TableRows['classes'],'instructor_id'> & Pick<TableRows['notifications'],'recipient_id'>>;

type Config={table:string;domain:string;select:string;join?:string;search:string[];order?:string;scope?:string;readonly?:boolean};
export const entities:Record<string,Config>={
 students:{table:'students',domain:'students',select:`t.*,u.name trainer_name,(SELECT p.name FROM memberships m JOIN plans p ON p.id=m.plan_id WHERE m.student_id=t.id AND m.status IN ('active','suspended') ORDER BY m.created_at DESC LIMIT 1) plan_name,(SELECT m.status FROM memberships m WHERE m.student_id=t.id AND m.status IN ('active','suspended') LIMIT 1) membership_status,(SELECT max(a.check_in) FROM attendance a WHERE a.student_id=t.id) last_attendance`,join:'LEFT JOIN users u ON u.id=t.trainer_id',search:['t.name','t.email','t.phone'],scope:'t.trainer_id'},
 staff:{table:'staff',domain:'staff',select:'t.*,u.name user_name',join:'LEFT JOIN users u ON u.id=t.user_id',search:['t.name','t.position','t.email']},
 plans:{table:'plans',domain:'plans',select:'t.*,(SELECT count(*) FROM memberships m WHERE m.plan_id=t.id AND m.status=\'active\') active_memberships',search:['t.name','t.modalities']},
 memberships:{table:'memberships',domain:'memberships',select:'t.*,s.name student_name,p.name plan_name',join:'JOIN students s ON s.id=t.student_id JOIN plans p ON p.id=t.plan_id',search:['s.name','p.name'],scope:'s.trainer_id'},
 invoices:{table:'invoices',domain:'finance',select:'t.*,s.name student_name',join:'JOIN students s ON s.id=t.student_id',search:['t.description','s.name'],scope:'s.trainer_id'},
 expenses:{table:'expenses',domain:'finance',select:'t.*',search:['t.description','t.category']},
 exercises:{table:'exercises',domain:'workouts',select:'t.*',search:['t.name','t.muscle_group','t.equipment']},
 workouts:{table:'workouts',domain:'workouts',select:'t.*,s.name student_name,u.name trainer_name,(SELECT count(*) FROM workout_items wi WHERE wi.workout_id=t.id) item_count',join:'JOIN students s ON s.id=t.student_id LEFT JOIN users u ON u.id=t.trainer_id',search:['t.name','s.name','t.objective'],scope:'s.trainer_id'},
 assessments:{table:'assessments',domain:'assessments',select:'t.*,s.name student_name,u.name assessor_name',join:'JOIN students s ON s.id=t.student_id LEFT JOIN users u ON u.id=t.created_by',search:['s.name','t.notes'],scope:'s.trainer_id'},
 classes:{table:'classes',domain:'classes',select:'t.*,u.name instructor_name,(SELECT count(*) FROM bookings b WHERE b.class_id=t.id) booked_count',join:'LEFT JOIN users u ON u.id=t.instructor_id',search:['t.name','t.modality','t.location'],order:'t.starts_at DESC'},
 products:{table:'products',domain:'inventory',select:'t.*',search:['t.name','t.sku','t.category']},
 suppliers:{table:'suppliers',domain:'inventory',select:'t.*',search:['t.name','t.contact_name','t.email']},
 purchases:{table:'purchases',domain:'inventory',select:'t.*,s.name supplier_name',join:'JOIN suppliers s ON s.id=t.supplier_id',search:['s.name','t.notes']},
 sales:{table:'sales',domain:'inventory',select:'t.*,s.name student_name',join:'LEFT JOIN students s ON s.id=t.student_id',search:['s.name','t.notes']},
 leads:{table:'leads',domain:'crm',select:'t.*',search:['t.name','t.email','t.phone','t.source']},
 notifications:{table:'notifications',domain:'notifications',select:'t.*,u.name recipient_name',join:'LEFT JOIN users u ON u.id=t.recipient_id',search:['t.title','t.message']},
 audit:{table:'audit_logs',domain:'audit',select:'t.*,u.name user_name',join:'LEFT JOIN users u ON u.id=t.user_id',search:['t.summary','t.entity','t.action','u.name'],readonly:true},
 attendance:{table:'attendance',domain:'attendance',select:'t.*,s.name student_name,u.name user_name',join:'JOIN students s ON s.id=t.student_id LEFT JOIN users u ON u.id=t.created_by',search:['s.name'],order:'t.check_in DESC',scope:'s.trainer_id',readonly:true},
 'access-events':{table:'access_events',domain:'attendance',select:'t.*,s.name student_name,u.name user_name',join:'JOIN students s ON s.id=t.student_id LEFT JOIN users u ON u.id=t.user_id',search:['s.name','t.reason'],scope:'s.trainer_id',readonly:true},
};
function scopedWhere(config:Config,actor:Actor){const where:string[]=[];const values:unknown[]=[];if(scoped(actor)&&config.scope){where.push(config.scope+'=?');values.push(actor.id);}if(config.table==='notifications'){where.push('(t.recipient_id IS NULL OR t.recipient_id=? OR t.created_by=?)');values.push(actor.id,actor.id);}return{where,values};}
function shape(entity:string,row:Row,actor:Actor){
 if(entity==='invoices'){const invoice=row as TableRows['invoices'];row.is_overdue=invoice.amount_cents>0&&(invoice.status==='open'||invoice.status==='refunded')&&invoice.due_date<today();}
 if(entity==='assessments'){const assessment=row as TableRows['assessments'];row.bmi=Math.round(assessment.weight_kg/((assessment.height_cm/100)**2)*10)/10;}
 if(entity==='students'&&actor.role==='finance')return Object.fromEntries(['id','name','email','phone','status','version'].map(k=>[k,row[k]]));
 return row;
}
export async function listEntity(db:D1Database,actor:Actor,entity:string,url:URL){
 const config=entities[entity];requirePermission(actor,config.domain+'.read');
 const page=Math.max(1,Math.min(100000,Math.floor(Number(url.searchParams.get('page'))||1)));
 const pageSize=Math.max(1,Math.min(100,Math.floor(Number(url.searchParams.get('pageSize'))||20)));
 const {where,values}=scopedWhere(config,actor);const q=(url.searchParams.get('q')||'').trim().slice(0,160);
 // D1 limits LIKE/GLOB patterns to 50 bytes. INSTR keeps long, literal search terms safe.
 if(q){where.push('('+config.search.map(s=>`instr(lower(coalesce(${s},'')),lower(?))>0`).join(' OR ')+')');values.push(...config.search.map(()=>q));}
 const status=url.searchParams.get('status');
 if(status){if(entity==='attendance'&&status==='inside')where.push('t.check_out IS NULL');else if(entity==='invoices'&&status==='overdue'){where.push("t.status IN ('open','refunded') AND t.amount_cents>0 AND t.due_date<?");values.push(today());}else if(entity==='access-events'){where.push('t.decision=?');values.push(status);}else if(!config.readonly&&entity!=='assessments'&&entity!=='notifications'){where.push('t.status=?');values.push(status);}}
 const parent=url.searchParams.get('student_id');if(parent&&['memberships','invoices','workouts','assessments','attendance','access-events'].includes(entity)){await studentAccess(db,actor,parent);where.push('t.student_id=?');values.push(parent);}
 const from=`FROM ${config.table} t ${config.join||''} ${where.length?'WHERE '+where.join(' AND '):''}`;
 const total=Number((await first(db,`SELECT count(*) n ${from}`,values))?.n||0);
 const actualPage=Math.min(page,Math.max(1,Math.ceil(total/pageSize)));
 let select=config.select;const selects:unknown[]=[];
 if(entity==='notifications'){select+=',EXISTS(SELECT 1 FROM notification_reads nr WHERE nr.notification_id=t.id AND nr.user_id=?) is_read';selects.push(actor.id);}
 const data=(await all(db,`SELECT ${select} ${from} ORDER BY ${config.order||'t.created_at DESC'},t.id DESC LIMIT ? OFFSET ?`,[...selects,...values,pageSize,(actualPage-1)*pageSize])).map(row=>shape(entity,row,actor));
 return json({data,total,page:actualPage,pageSize});
}
export function getEntity<Name extends keyof EntityRows>(db:D1Database,actor:Actor,entity:Name,id:string,withRelations:false):Promise<EntityRows[Name]>;
export function getEntity<Name extends keyof EntityRows>(db:D1Database,actor:Actor,entity:Name,id:string,withRelations?:true):Promise<EntityDetail<Name>>;
export function getEntity(db:D1Database,actor:Actor,entity:string,id:string,withRelations?:boolean):Promise<Row>;
export async function getEntity(db:D1Database,actor:Actor,entity:string,id:string,withRelations=true):Promise<Row>{
 const config=entities[entity];if(!config)throw new DomainError(404,'Módulo não encontrado.');requirePermission(actor,config.domain+'.read');
 const{where,values}=scopedWhere(config,actor);where.unshift('t.id=?');values.unshift(id);
 let select=config.select;const selects:unknown[]=[];if(entity==='notifications'){select+=',EXISTS(SELECT 1 FROM notification_reads nr WHERE nr.notification_id=t.id AND nr.user_id=?) is_read';selects.push(actor.id);}
 const row=await first(db,`SELECT ${select} FROM ${config.table} t ${config.join||''} WHERE ${where.join(' AND ')}`,[...selects,...values]);if(!row)throw new DomainError(404,'Registro não encontrado ou indisponível para seu perfil.');
 const result=shape(entity,row,actor);if(!withRelations)return result;
 if(entity==='students'){
  result.memberships=permission(actor,'memberships.read')?await all(db,'SELECT m.*,p.name plan_name FROM memberships m JOIN plans p ON p.id=m.plan_id WHERE m.student_id=? ORDER BY m.created_at DESC LIMIT 25',[id]):[];
  result.invoices=permission(actor,'finance.read')?(await all(db,'SELECT * FROM invoices WHERE student_id=? ORDER BY created_at DESC LIMIT 25',[id])).map(v=>shape('invoices',v,actor)):[];
  result.attendance=permission(actor,'attendance.read')?await all(db,'SELECT * FROM attendance WHERE student_id=? ORDER BY check_in DESC LIMIT 25',[id]):[];
  result.workouts=permission(actor,'workouts.read')?await all(db,'SELECT * FROM workouts WHERE student_id=? ORDER BY created_at DESC LIMIT 25',[id]):[];
  result.assessments=permission(actor,'assessments.read')?await all(db,'SELECT * FROM assessments WHERE student_id=? ORDER BY assessed_at DESC LIMIT 25',[id]):[];
 }
 if(entity==='memberships')result.history=await all(db,'SELECT * FROM membership_events WHERE membership_id=? ORDER BY created_at DESC LIMIT 50',[id]);
 if(entity==='invoices'){result.payments=await all(db,'SELECT * FROM payments WHERE invoice_id=? ORDER BY created_at DESC',[id]);result.refunds=await all(db,'SELECT * FROM refunds WHERE invoice_id=? ORDER BY created_at DESC',[id]);}
 if(entity==='workouts'){result.items=await all(db,'SELECT wi.*,e.name exercise_name,e.muscle_group FROM workout_items wi JOIN exercises e ON e.id=wi.exercise_id WHERE wi.workout_id=? ORDER BY wi.position',[id]);result.history=await all(db,'SELECT * FROM workout_history WHERE workout_id=? ORDER BY version DESC LIMIT 25',[id]);result.sessions=await all(db,'SELECT * FROM workout_sessions WHERE workout_id=? ORDER BY completed_at DESC LIMIT 25',[id]);}
 if(entity==='classes'){result.bookings=await all(db,`SELECT b.*,s.name student_name FROM bookings b JOIN students s ON s.id=b.student_id WHERE b.class_id=? ${scoped(actor)?'AND s.trainer_id=?':''} ORDER BY b.created_at`,scoped(actor)?[id,actor.id]:[id]);}
 if(entity==='products')result.movements=await all(db,'SELECT sm.*,u.name user_name FROM stock_movements sm LEFT JOIN users u ON u.id=sm.created_by WHERE sm.product_id=? ORDER BY sm.created_at DESC LIMIT 100',[id]);
 if(entity==='purchases')result.items=await all(db,'SELECT pi.*,p.name product_name FROM purchase_items pi JOIN products p ON p.id=pi.product_id WHERE pi.purchase_id=?',[id]);
 if(entity==='sales')result.items=await all(db,'SELECT si.*,p.name product_name FROM sale_items si JOIN products p ON p.id=si.product_id WHERE si.sale_id=?',[id]);
 return result;
}
export async function validateRelations(db:D1Database,actor:Actor,entity:string,data:RelatedRow){
 if(data.student_id)await studentAccess(db,actor,data.student_id);
 for(const key of ['trainer_id','user_id','instructor_id','recipient_id'] as const)if(data[key]){const user=await exists(db,'users',data[key]);if(!user.active)throw new DomainError(422,'Selecione uma conta ativa.');}
 if(scoped(actor)){
  if(entity==='students'&&data.trainer_id&&data.trainer_id!==actor.id)throw new DomainError(403,'Você não pode transferir a responsabilidade de um aluno.');
  if(entity==='classes'&&data.instructor_id!==actor.id)throw new DomainError(403,'Você só pode gerenciar aulas sob sua responsabilidade.');
 }
 if(entity==='plans'&&((data.access_start&&!data.access_end)||(!data.access_start&&data.access_end)))throw new DomainError(422,'Informe os dois horários de acesso ou deixe ambos em branco.');
}
export async function createSimple(db:D1Database,actor:Actor,entity:string,request:Request){
 const config=entities[entity];requirePermission(actor,config.domain+'.write');
 const schema=schemas[entity as keyof typeof schemas];if(!schema||['memberships','invoices'].includes(entity))throw new DomainError(405,'Use a operação específica deste módulo.');
 const data=parse(schema,await body(request)) as Row;await validateRelations(db,actor,entity,data);
 if(scoped(actor)&&entity==='students')data.trainer_id=actor.id;
 if(entity==='classes')data.starts_at=new Date(data.starts_at as z.infer<typeof schemas.classes>['starts_at']).toISOString();
 if(entity==='assessments')data.created_by=actor.id;
 if(entity==='notifications')data.created_by=actor.id;
 if(entity==='products')data.stock=0;
 if(entity==='expenses')data.paid_at=data.status==='paid'?(data.paid_at||today()):null;
 const row={...metadata(),...data};await atomic(db,actor,[insert(db,config.table,row),audit(db,actor,'create',entity,row.id,`Cadastro criado: ${data.name||data.title||data.description||entity}.`)],scoped(actor)&&data.student_id?{sql:'EXISTS(SELECT 1 FROM students WHERE id=? AND trainer_id=?)',values:[data.student_id,actor.id]}:undefined);
 return json(await getEntity(db,actor,entity,row.id),201);
}
export async function updateSimple(db:D1Database,actor:Actor,entity:string,id:string,request:Request){
 const config=entities[entity];requirePermission(actor,config.domain+'.write');
 if(config.readonly||['sales','purchases','workouts','notifications'].includes(entity))throw new DomainError(405,'Este registro usa ações específicas e preserva seu histórico.');
 const current=await getEntity(db,actor,entity,id,false);
 // Authorization must use the stored owner, never a replacement owner supplied in PATCH.
 if(entity==='classes'&&scoped(actor)&&current.instructor_id!==actor.id)throw new DomainError(403,'Você só pode alterar aulas sob sua responsabilidade.','CLASS_SCOPE');
 let schema: z.ZodObject<Record<string,z.ZodType>, z.core.$ZodObjectConfig>;
 if(entity==='memberships')schema=z.object({notes:z.string().max(2000).nullable().optional()});
 else if(entity==='invoices'){if(current.status!=='open')throw new DomainError(409,'Somente cobranças em aberto podem ser editadas.');schema=schemas.invoices.pick({description:true,due_date:true}).partial();}
 else schema=schemas[entity as keyof typeof schemas].partial();
 if(entity==='expenses')schema=schema.extend({reason:reasonSchema.optional()});
 const submitted=await body(request);
 const parsed=parse(schema.extend({version:versionSchema}).strict(),submitted);const{version,reason,...validated}=parsed;
 // Zod 4 applies defaults inside optional properties. PATCH changes only explicitly submitted keys.
 const data:Row=Object.fromEntries(Object.entries(validated).filter(([key])=>Object.prototype.hasOwnProperty.call(submitted,key)));
 if(Number(current.version)!==version)throw new DomainError(409,'Este registro foi atualizado. Recarregue antes de salvar.','CONFLICT');
 if(!Object.keys(data).length)throw new DomainError(422,'Informe pelo menos uma alteração.');
 if(entity==='assessments'&&data.student_id&&data.student_id!==current.student_id)throw new DomainError(422,'O aluno de uma avaliação registrada não pode ser alterado.');
 if(entity==='leads'&&current.status==='converted')throw new DomainError(409,'Este contato já foi convertido. Edite o cadastro do aluno.');
 await validateRelations(db,actor,entity,{...current,...data});
 if(entity==='classes'&&data.starts_at)data.starts_at=new Date(data.starts_at as z.infer<typeof schemas.classes>['starts_at']).toISOString();
 if(entity==='expenses'&&(current.status==='paid'||data.status==='cancelled')&&!reason)throw new DomainError(422,'Descreva o motivo da alteração financeira.','VALIDATION',{reason:'Informe uma justificativa com pelo menos 3 caracteres.'});
 if(entity==='expenses'){data.paid_at=(data.status??current.status)==='paid'?(data.paid_at||current.paid_at||today()):null;}
 const fields=Object.keys(data);const extra:string[]=[];const extraValues:unknown[]=[];
 if(entity==='classes'){extra.push('(SELECT count(*) FROM bookings WHERE class_id=?) <= ?');extraValues.push(id,data.capacity??current.capacity);if(scoped(actor)){extra.push('instructor_id=?');extraValues.push(actor.id);}}
 if(entity==='invoices')extra.push("status='open'");
 if(config.scope&&scoped(actor)){if(entity==='students'){extra.push('trainer_id=?');extraValues.push(actor.id);}else{extra.push('EXISTS(SELECT 1 FROM students s WHERE s.id='+config.table+'.student_id AND s.trainer_id=?)');extraValues.push(actor.id);}}
 await atomic(db,actor,[statement(db,`UPDATE ${config.table} SET ${fields.map(k=>k+'=?').join(',')},version=version+1,updated_at=? WHERE id=?`,[...fields.map(k=>data[k]),now(),id]),audit(db,actor,'update',entity,id,`Registro atualizado: ${current.name||current.description||entity}. Campos: ${fields.join(', ')}.${data.amount_cents!==undefined?' Valor: '+current.amount_cents+' → '+data.amount_cents+' centavos.':''}${reason?' Motivo: '+reason+'.':''}`)],versionGuard(config.table,id,version,extra.join(' AND ')||'1',extraValues));
 return json(await getEntity(db,actor,entity,id));
}
