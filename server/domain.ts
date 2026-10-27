import type {Actor} from './auth';
import {DomainError,mapDbError,json} from './domain/common';
import {entities,listEntity,getEntity,createSimple,updateSimple} from './domain/entities';
import {createMembership,membershipAction,createInvoice,invoiceAction} from './domain/billing';
import {createWorkout,updateWorkout,workoutAction,checkIn,checkOut,bookingAction} from './domain/training';
import {createPurchase,purchaseAction,createSale,refundSale,adjustStock,convertLead,readNotification} from './domain/commerce';
import {options,dashboard,reports} from './domain/reporting';

/** Domain route boundary. Authentication, CSRF and security headers are applied by the outer API handler. */
export async function handleDomain(request:Request,url:URL,db:D1Database,actor:Actor):Promise<Response|null>{
 try{
  const parts=url.pathname.replace(/^\/api\/?/,'').split('/').filter(Boolean);const[entity,id,action]=parts;const method=request.method.toUpperCase();
  if(parts.length>3)return null;
  if(method==='GET'&&parts.length===1){if(entity==='options')return await options(db,actor);if(entity==='dashboard')return await dashboard(db,actor,url);if(entity==='reports')return await reports(db,actor,url);}
  if(!entities[entity])return null;
  if(method==='GET'){if(!id)return await listEntity(db,actor,entity,url);if(!action)return json(await getEntity(db,actor,entity,id));}
  if(method==='POST'){
   if(!id){if(entity==='memberships')return await createMembership(db,actor,request);if(entity==='invoices')return await createInvoice(db,actor,request);if(entity==='workouts')return await createWorkout(db,actor,request);if(entity==='purchases')return await createPurchase(db,actor,request);if(entity==='sales')return await createSale(db,actor,request);return await createSimple(db,actor,entity,request);}
   if(entity==='attendance'&&id==='check-in'&&!action)return await checkIn(db,actor,request);
   if(entity==='attendance'&&action==='check-out')return await checkOut(db,actor,id);
   if(entity==='memberships'&&action)return await membershipAction(db,actor,id,action,request);
   if(entity==='invoices'&&action)return await invoiceAction(db,actor,id,action,request);
   if(entity==='workouts'&&action)return await workoutAction(db,actor,id,action,request);
   if(entity==='classes'&&(action==='book'||action==='unbook'))return await bookingAction(db,actor,id,action,request);
   if(entity==='purchases'&&action)return await purchaseAction(db,actor,id,action,request);
   if(entity==='sales'&&action==='refund')return await refundSale(db,actor,id,request);
   if(entity==='products'&&action==='adjust')return await adjustStock(db,actor,id,request);
   if(entity==='leads'&&action==='convert')return await convertLead(db,actor,id,request);
   if(entity==='notifications'&&action==='read')return await readNotification(db,actor,id);
  }
  if(method==='PATCH'&&id&&!action){if(entity==='workouts')return await updateWorkout(db,actor,id,request);return await updateSimple(db,actor,entity,id,request);}
  return json({error:'Método ou operação indisponível. Use as ações do módulo.'},405);
 }catch(error){const mapped=mapDbError(error);if(mapped instanceof DomainError)return json({error:mapped.message,code:mapped.code,fields:mapped.fields},mapped.status);console.error(JSON.stringify({event:'domain.error',type:mapped instanceof Error?mapped.name:'UnknownError'}));return json({error:'Não foi possível concluir a operação. Tente novamente; os dados foram preservados.',code:'INTERNAL_ERROR'},500);}
}
