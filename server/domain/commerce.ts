import {z} from 'zod';
import type {Actor} from '../auth';
import {DomainError,body,parse,json,requirePermission,studentAccess,exists,metadata,uid,now,insert,audit,atomic,statement,first,all,versionGuard,versionSchema,reasonSchema,int,actionVersion,ensureVersion} from './common';
import {purchaseSchema,saleSchema} from './schemas';
import {getEntity} from './entities';
import type {TableRows} from './types';
type SaleItem = z.infer<typeof saleSchema>['items'][number] & {unit_price_cents:number};
function uniqueItems(items:{product_id:string}[]){if(new Set(items.map(i=>i.product_id)).size!==items.length)throw new DomainError(422,'Adicione cada produto apenas uma vez e ajuste sua quantidade.');}
async function activeProducts(db:D1Database,items:{product_id:string}[]){const products=await all<TableRows['products']>(db,"SELECT * FROM products WHERE id IN (SELECT value FROM json_each(?)) AND status='active'",[JSON.stringify(items.map(item=>item.product_id))]);if(products.length!==items.length)throw new DomainError(422,'Um produto selecionado está indisponível. Atualize o catálogo.','INVALID_REFERENCE');return new Map(products.map(product=>[product.id,product]));}
function total<Cost extends string>(items:({quantity:number}&Record<Cost,number>)[],cost:Cost){const sum=items.reduce((n,item)=>n+item.quantity*item[cost],0);if(!Number.isSafeInteger(sum)||sum>100_000_000_000)throw new DomainError(422,'O total excede o limite suportado por operação.');return sum;}
export async function createPurchase(db:D1Database,actor:Actor,request:Request){
 requirePermission(actor,'inventory.write');const data=parse(purchaseSchema,await body(request));uniqueItems(data.items);await exists(db,'suppliers',data.supplier_id,true);
 await activeProducts(db,data.items);
 const row={...metadata(),supplier_id:data.supplier_id,notes:data.notes,total_cents:total(data.items,'unit_cost_cents'),status:'draft',created_by:actor.id};
 await atomic(db,actor,[insert(db,'purchases',row),...data.items.map(item=>insert(db,'purchase_items',{id:uid(),purchase_id:row.id,...item})),audit(db,actor,'create','purchases',row.id,'Compra registrada. Estoque será atualizado no recebimento.')],{sql:"EXISTS(SELECT 1 FROM suppliers WHERE id=? AND status='active') AND (SELECT count(*) FROM products WHERE id IN (SELECT value FROM json_each(?)) AND status='active')=?",values:[data.supplier_id,JSON.stringify(data.items.map(item=>item.product_id)),data.items.length]});return json(await getEntity(db,actor,'purchases',row.id),201);
}
export async function purchaseAction(db:D1Database,actor:Actor,id:string,action:string,request:Request){
 requirePermission(actor,'inventory.write');if(!['receive','cancel'].includes(action))return null;
 const data=parse(actionVersion,await body(request));const purchase=await getEntity(db,actor,'purchases',id);
 if(action==='receive'&&purchase.status==='received')return json({...purchase,replayed:true});
 ensureVersion(purchase.version,data.version);
 if(purchase.status!=='draft')throw new DomainError(409,'Somente compras ainda não recebidas podem ser alteradas.');
 const queries:D1PreparedStatement[]=[];
 if(action==='receive'){
  for(const item of purchase.items){queries.push(statement(db,'UPDATE products SET stock=stock+?,cost_cents=?,version=version+1,updated_at=? WHERE id=?',[item.quantity,item.unit_cost_cents,now(),item.product_id]),insert(db,'stock_movements',{id:uid(),product_id:item.product_id,quantity:item.quantity,kind:'purchase',reason:'Recebimento de compra',reference_id:id,created_by:actor.id,created_at:now()}));}
  queries.push(statement(db,"UPDATE purchases SET status='received',received_at=?,version=version+1,updated_at=? WHERE id=?",[now(),now(),id]));
 }else queries.push(statement(db,"UPDATE purchases SET status='cancelled',version=version+1,updated_at=? WHERE id=?",[now(),id]));
 queries.push(audit(db,actor,action,'purchases',id,action==='receive'?'Compra recebida e estoque atualizado.':'Compra cancelada antes do recebimento.'));
 await atomic(db,actor,queries,versionGuard('purchases',id,data.version,"status='draft'"));return json(await getEntity(db,actor,'purchases',id));
}
export async function createSale(db:D1Database,actor:Actor,request:Request){
 requirePermission(actor,'inventory.write');const data=parse(saleSchema.extend({idempotencyKey:z.string().min(8).max(120).regex(/^[\w.:-]+$/).optional()}).strict(),await body(request));uniqueItems(data.items);if(data.student_id)await studentAccess(db,actor,data.student_id);
 const fingerprint=JSON.stringify({student_id:data.student_id,method:data.method,items:data.items,notes:data.notes??null});
 const legacyFingerprint=JSON.stringify({student_id:data.student_id,method:data.method,items:data.items});
 // Existing keys remain replayable after the fingerprint gained the notes field.
 const matchesReplay=async(op:TableRows['operation_keys'])=>{if(op.scope!==actor.id)return false;if(op.fingerprint===fingerprint)return true;if(op.fingerprint!==legacyFingerprint)return false;const previous=await first<Pick<TableRows['sales'],'notes'>>(db,'SELECT notes FROM sales WHERE id=?',[op.entity_id]);return Boolean(previous&&(previous.notes??null)===(data.notes??null));};
 const key=data.idempotencyKey?`sale:${data.idempotencyKey}`:null;
 if(key){const op=await first<TableRows['operation_keys']>(db,'SELECT * FROM operation_keys WHERE id=?',[key]);if(op){if(!await matchesReplay(op))throw new DomainError(409,'A chave de venda já foi usada com outros dados.','IDEMPOTENCY_CONFLICT');return json({...await getEntity(db,actor,'sales',op.entity_id),replayed:true});}}
 const catalog=await activeProducts(db,data.items);
 const products:TableRows['products'][]=[];const items:SaleItem[]=[];
 for(const item of data.items){const product=catalog.get(item.product_id)!;if(product.stock<item.quantity)throw new DomainError(409,`Estoque insuficiente: ${product.name}.`,'INSUFFICIENT_STOCK');if(item.unit_price_cents!==undefined&&item.unit_price_cents!==product.price_cents)throw new DomainError(409,`O preço de ${product.name} mudou. Atualize o catálogo.`);products.push(product);items.push({...item,unit_price_cents:product.price_cents});}
 const row={...metadata(),student_id:data.student_id||null,method:data.method,total_cents:total(items,'unit_price_cents'),notes:data.notes,status:'completed',created_by:actor.id};
 const queries=[insert(db,'sales',row)];
 if(key)queries.push(insert(db,'operation_keys',{id:key,scope:actor.id,entity_id:row.id,fingerprint,created_at:now()}));
 for(const item of items){queries.push(insert(db,'sale_items',{id:uid(),sale_id:row.id,...item}),statement(db,'UPDATE products SET stock=stock-?,version=version+1,updated_at=? WHERE id=?',[item.quantity,now(),item.product_id]),insert(db,'stock_movements',{id:uid(),product_id:item.product_id,quantity:-item.quantity,kind:'sale',reason:'Venda de produto',reference_id:row.id,created_by:actor.id,created_at:now()}));}
 queries.push(audit(db,actor,'create','sales',row.id,`Venda concluída: ${(row.total_cents/100).toFixed(2)} BRL. Estoque baixado.`));
 const stockGuard={sql:"NOT EXISTS(SELECT 1 FROM json_each(?) expected LEFT JOIN products p ON p.id=json_extract(expected.value,'$.id') WHERE p.id IS NULL OR p.version!=json_extract(expected.value,'$.version') OR p.status!='active')",values:[JSON.stringify(products.map(product=>({id:product.id,version:product.version})))]};
 try{await atomic(db,actor,queries,stockGuard);}catch(e){if(key){const op=await first<TableRows['operation_keys']>(db,'SELECT * FROM operation_keys WHERE id=?',[key]);if(op&&await matchesReplay(op))return json({...await getEntity(db,actor,'sales',op.entity_id),replayed:true});}throw e;}
 return json(await getEntity(db,actor,'sales',row.id),201);
}
export async function refundSale(db:D1Database,actor:Actor,id:string,request:Request){
 requirePermission(actor,'inventory.write');const data=parse(z.object({version:versionSchema,reason:reasonSchema}).strict(),await body(request));const sale=await getEntity(db,actor,'sales',id);
 if(sale.status==='refunded'){if(sale.refund_reason!==data.reason)throw new DomainError(409,'Esta venda já foi estornada com outra justificativa. O histórico original foi preservado.','IDEMPOTENCY_CONFLICT');return json({...sale,replayed:true});}if(sale.status!=='completed')throw new DomainError(409,'A venda não pode ser estornada.');
 ensureVersion(sale.version,data.version);
 const queries:D1PreparedStatement[]=[];
 for(const item of sale.items){queries.push(statement(db,'UPDATE products SET stock=stock+?,version=version+1,updated_at=? WHERE id=?',[item.quantity,now(),item.product_id]),insert(db,'stock_movements',{id:uid(),product_id:item.product_id,quantity:item.quantity,kind:'refund',reason:data.reason,reference_id:id,created_by:actor.id,created_at:now()}));}
 queries.push(statement(db,"UPDATE sales SET status='refunded',refund_reason=?,refunded_at=?,version=version+1,updated_at=? WHERE id=?",[data.reason,now(),now(),id]),audit(db,actor,'refund','sales',id,`Venda estornada, estoque recomposto. Motivo: ${data.reason}.`));await atomic(db,actor,queries,versionGuard('sales',id,data.version,"status='completed'"));return json(await getEntity(db,actor,'sales',id));
}
export async function adjustStock(db:D1Database,actor:Actor,id:string,request:Request){
 requirePermission(actor,'inventory.write');const data=parse(z.object({version:versionSchema,quantity:int(-100000,100000).refine(v=>v!==0,'A quantidade deve ser diferente de zero.'),reason:reasonSchema}).strict(),await body(request));const product=await getEntity(db,actor,'products',id,false);
 ensureVersion(product.version,data.version);
 if(product.stock+data.quantity<0)throw new DomainError(409,'O ajuste deixaria o estoque negativo.','INSUFFICIENT_STOCK');
 await atomic(db,actor,[statement(db,'UPDATE products SET stock=stock+?,version=version+1,updated_at=? WHERE id=?',[data.quantity,now(),id]),insert(db,'stock_movements',{id:uid(),product_id:id,quantity:data.quantity,kind:'adjustment',reason:data.reason,reference_id:null,created_by:actor.id,created_at:now()}),audit(db,actor,'adjust','products',id,`Ajuste de estoque ${data.quantity>0?'+':''}${data.quantity} em ${product.name}. Motivo: ${data.reason}.`)],versionGuard('products',id,data.version));return json(await getEntity(db,actor,'products',id));
}
export async function convertLead(db:D1Database,actor:Actor,id:string,request:Request){
 requirePermission(actor,'crm.write');requirePermission(actor,'students.write');const data=parse(actionVersion,await body(request));const lead=await getEntity(db,actor,'leads',id,false);
 if(lead.status==='converted'&&lead.student_id)return json({...lead,replayed:true});
 ensureVersion(lead.version,data.version);
 const student={...metadata(),name:lead.name,email:lead.email,phone:lead.phone,notes:lead.notes,trainer_id:null,status:'active'};
 await atomic(db,actor,[insert(db,'students',student),statement(db,"UPDATE leads SET status='converted',student_id=?,version=version+1,updated_at=? WHERE id=?",[student.id,now(),id]),audit(db,actor,'convert','leads',id,`Contato convertido em aluno: ${lead.name}.`)],versionGuard('leads',id,data.version,"status!='converted'"));return json(await getEntity(db,actor,'leads',id));
}
export async function readNotification(db:D1Database,actor:Actor,id:string){
 requirePermission(actor,'notifications.read');const note=await getEntity(db,actor,'notifications',id,false);if(note.is_read)return json(note);
 await atomic(db,actor,[statement(db,'INSERT OR IGNORE INTO notification_reads(notification_id,user_id,read_at) VALUES (?,?,?)',[id,actor.id,now()]),audit(db,actor,'read','notifications',id,'Notificação marcada como lida.')]);return json(await getEntity(db,actor,'notifications',id));
}
