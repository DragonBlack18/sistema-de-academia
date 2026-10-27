import type {Actor} from '../auth';
import {DomainError,Row,all,count,json,permission,requirePermission,scoped,today,dayOffset,now,safeCsv} from './common';
import type {TableRows} from './types';

export async function options(db:D1Database,actor:Actor){
 const allowed=(domain:string)=>permission(actor,domain+'.read')||permission(actor,domain+'.write');
 const studentSql=`SELECT id,name,trainer_id,status FROM students WHERE status='active' ${scoped(actor)?'AND trainer_id=?':''} ORDER BY name LIMIT 1000`;
 const [students,plans,users,exercises,products,suppliers,classes,staff]=await Promise.all([
  allowed('students')?all(db,studentSql,scoped(actor)?[actor.id]:[]):[],
  allowed('plans')||allowed('memberships')?all(db,"SELECT id,name,price_cents,duration_months FROM plans WHERE status='active' ORDER BY name LIMIT 1000"):[],
  ['staff','students','classes','workouts','notifications'].some(allowed)?all(db,`SELECT id,name,role FROM users WHERE active=1 ${scoped(actor)?'AND id=?':''} ORDER BY name LIMIT 1000`,scoped(actor)?[actor.id]:[]):[],
  allowed('workouts')?all(db,"SELECT id,name,muscle_group FROM exercises WHERE status='active' ORDER BY name LIMIT 1000"):[],
  allowed('inventory')?all(db,"SELECT id,name,price_cents,cost_cents,stock FROM products WHERE status='active' ORDER BY name LIMIT 1000"):[],
  allowed('inventory')?all(db,"SELECT id,name FROM suppliers WHERE status='active' ORDER BY name LIMIT 1000"):[],
  allowed('classes')?all(db,"SELECT c.id,c.name,c.starts_at,c.capacity,(SELECT count(*) FROM bookings b WHERE b.class_id=c.id) booked_count FROM classes c WHERE c.status='scheduled' AND c.starts_at>? ORDER BY c.starts_at LIMIT 1000",[now()]):[],
  allowed('staff')?all(db,"SELECT id,name,position FROM staff WHERE status='active' ORDER BY name LIMIT 1000"):[],
 ]);
 return json({students,plans,users,exercises,products,suppliers,classes,staff});
}
function period(url:URL){const days=Math.max(7,Math.min(366,Math.floor(Number(url.searchParams.get('days'))||30)));const to=today(),from=dayOffset(to,1-days);return{days,from,to};}
async function aggregates(db:D1Database,actor:Actor,url:URL){
 const p=period(url);const financial=permission(actor,'finance.read');const inventory=financial||permission(actor,'inventory.read');const studentScope=scoped(actor)?'AND s.trainer_id=?':'';const scopeVals=scoped(actor)?[actor.id]:[];
 const since=p.from+'T03:00:00.000Z',until=dayOffset(p.to,1)+'T03:00:00.000Z';
 const [receipts,refunds,expenses,sales,open,overdue,attendance_count,new_students,revenues,refundSeries,expenseSeries,salesSeries,attendanceSeries,planDistribution,saleRefunds,saleRefundSeries]=await Promise.all([
  financial?count(db,'SELECT coalesce(sum(amount_cents),0) n FROM payments WHERE created_at>=? AND created_at<?',[since,until]):0,
  financial?count(db,'SELECT coalesce(sum(amount_cents),0) n FROM refunds WHERE created_at>=? AND created_at<?',[since,until]):0,
  financial?count(db,"SELECT coalesce(sum(amount_cents),0) n FROM expenses WHERE status='paid' AND substr(paid_at,1,10)>=? AND substr(paid_at,1,10)<=?",[p.from,p.to]):0,
  inventory?count(db,"SELECT coalesce(sum(total_cents),0) n FROM sales WHERE created_at>=? AND created_at<?",[since,until]):0,
  financial?count(db,"SELECT coalesce(sum(amount_cents),0) n FROM invoices WHERE status IN ('open','refunded')"):0,
  financial?count(db,"SELECT coalesce(sum(amount_cents),0) n FROM invoices WHERE status IN ('open','refunded') AND due_date<?",[p.to]):0,
  permission(actor,'attendance.read')?count(db,`SELECT count(*) n FROM attendance a JOIN students s ON s.id=a.student_id WHERE a.check_in>=? AND a.check_in<? ${studentScope}`,[since,until,...scopeVals]):0,
  permission(actor,'students.read')?count(db,`SELECT count(*) n FROM students s WHERE s.created_at>=? AND s.created_at<? ${studentScope}`,[since,until,...scopeVals]):0,
  financial?all(db,"SELECT date(created_at,'-3 hours') date,sum(amount_cents) amount FROM payments WHERE created_at>=? AND created_at<? GROUP BY date(created_at,'-3 hours')",[since,until]):[],
  financial?all(db,"SELECT date(created_at,'-3 hours') date,sum(amount_cents) amount FROM refunds WHERE created_at>=? AND created_at<? GROUP BY date(created_at,'-3 hours')",[since,until]):[],
  financial?all(db,"SELECT substr(paid_at,1,10) date,sum(amount_cents) amount FROM expenses WHERE status='paid' AND substr(paid_at,1,10)>=? AND substr(paid_at,1,10)<=? GROUP BY substr(paid_at,1,10)",[p.from,p.to]):[],
  inventory?all(db,"SELECT date(created_at,'-3 hours') date,sum(total_cents) amount FROM sales WHERE created_at>=? AND created_at<? GROUP BY date(created_at,'-3 hours')",[since,until]):[],
  permission(actor,'attendance.read')?all(db,`SELECT date(a.check_in,'-3 hours') date,count(*) count FROM attendance a JOIN students s ON s.id=a.student_id WHERE a.check_in>=? AND a.check_in<? ${studentScope} GROUP BY date(a.check_in,'-3 hours')`,[since,until,...scopeVals]):[],
  (permission(actor,'plans.read')||permission(actor,'students.read'))?all(db,`SELECT p.name,count(*) value FROM memberships m JOIN plans p ON p.id=m.plan_id JOIN students s ON s.id=m.student_id WHERE m.status='active' AND m.start_date<=? AND m.end_date>=? AND s.status='active' ${studentScope} GROUP BY p.id,p.name ORDER BY value DESC`,[p.to,p.to,...scopeVals]):[],
  inventory?count(db,"SELECT coalesce(sum(total_cents),0) n FROM sales WHERE status='refunded' AND refunded_at>=? AND refunded_at<?",[since,until]):0,
  inventory?all(db,"SELECT date(refunded_at,'-3 hours') date,sum(total_cents) amount FROM sales WHERE status='refunded' AND refunded_at>=? AND refunded_at<? GROUP BY date(refunded_at,'-3 hours')",[since,until]):[],
 ]);
 const map=(rows:Row[])=>new Map(rows.map(row=>[row.date,Number(row.amount??row.count)]));const rev=map(revenues),ref=map(refundSeries),exp=map(expenseSeries),sale=map(salesSeries),att=map(attendanceSeries),saleRef=map(saleRefundSeries);
 const revenue=[];const attendance=[];for(let i=0;i<p.days;i++){const date=dayOffset(p.from,i);revenue.push({date,revenue:(rev.get(date)||0)+(sale.get(date)||0)-(ref.get(date)||0)-(saleRef.get(date)||0),expenses:exp.get(date)||0});attendance.push({date,count:att.get(date)||0});}
 return{period:p,totals:{received_cents:receipts,refunded_cents:refunds+saleRefunds,invoice_refunded_cents:refunds,sales_refunded_cents:saleRefunds,expenses_cents:expenses,net_cents:receipts-refunds-saleRefunds+sales-expenses,open_cents:open,overdue_cents:overdue,sales_cents:sales,attendance_count,new_students},revenue,attendance,planDistribution};
}
export async function dashboard(db:D1Database,actor:Actor,url:URL){
 requirePermission(actor,'dashboard.read');const report=await aggregates(db,actor,url);const date=today(),since=date+'T03:00:00.000Z',until=dayOffset(date,1)+'T03:00:00.000Z';const scope=scoped(actor)?'AND s.trainer_id=?':'',values=scoped(actor)?[actor.id]:[];
 const [activeStudents,todayAttendance,occupancy,openInvoices,recentActivity,upcomingClasses,pendingInvoices]=await Promise.all([
  permission(actor,'students.read')?count(db,`SELECT count(*) n FROM students s WHERE s.status='active' AND EXISTS(SELECT 1 FROM memberships m WHERE m.student_id=s.id AND m.status='active' AND m.start_date<=? AND m.end_date>=?) ${scope}`,[date,date,...values]):0,
  permission(actor,'attendance.read')?count(db,`SELECT count(*) n FROM attendance a JOIN students s ON s.id=a.student_id WHERE a.check_in>=? AND a.check_in<? ${scope}`,[since,until,...values]):0,
  permission(actor,'attendance.read')?count(db,`SELECT count(*) n FROM attendance a JOIN students s ON s.id=a.student_id WHERE a.check_out IS NULL ${scope}`,values):0,
  permission(actor,'finance.read')?count(db,"SELECT count(*) n FROM invoices WHERE status IN ('open','refunded')"):0,
  permission(actor,'audit.read')?all(db,'SELECT a.*,u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 7'):all(db,'SELECT a.*,u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE a.user_id=? ORDER BY a.created_at DESC LIMIT 7',[actor.id]),
  permission(actor,'classes.read')?all(db,`SELECT c.*,u.name instructor_name,(SELECT count(*) FROM bookings b WHERE b.class_id=c.id) booked_count FROM classes c LEFT JOIN users u ON u.id=c.instructor_id WHERE c.status='scheduled' AND c.starts_at>? ${scoped(actor)?'AND c.instructor_id=?':''} ORDER BY c.starts_at LIMIT 5`,scoped(actor)?[now(),actor.id]:[now()]):[],
  permission(actor,'finance.read')?all(db,"SELECT i.*,s.name student_name FROM invoices i JOIN students s ON s.id=i.student_id WHERE i.status IN ('open','refunded') ORDER BY i.due_date LIMIT 5"):[],
 ]);
 return json({metrics:{activeStudents,monthlyRevenue:report.totals.received_cents-report.totals.refunded_cents+report.totals.sales_cents,openInvoices,todayAttendance,overdueAmount:report.totals.overdue_cents,occupancy},revenue:report.revenue,attendance:report.attendance,planDistribution:report.planDistribution,recentActivity,upcomingClasses,pendingInvoices,period:report.period});
}
export async function reports(db:D1Database,actor:Actor,url:URL){
 requirePermission(actor,'reports.read');if(url.searchParams.get('format')!=='csv')return json(await aggregates(db,actor,url));
 const type=url.searchParams.get('type')||'financial';let rows:Row[],columns:[string,string][];
 if(type==='students'){
  requirePermission(actor,'students.read');rows=await all(db,`SELECT id,name,email,phone,status,created_at FROM students ${scoped(actor)?'WHERE trainer_id=?':''} ORDER BY name LIMIT 10000`,scoped(actor)?[actor.id]:[]);columns=[['id','Código'],['name','Nome'],['email','E-mail'],['phone','Telefone'],['status','Situação'],['created_at','Cadastro']];
 }else if(type==='attendance'){
  requirePermission(actor,'attendance.read');const p=period(url);rows=await all(db,`SELECT a.id,s.name student_name,a.check_in,a.check_out,a.override_reason FROM attendance a JOIN students s ON s.id=a.student_id WHERE a.check_in>=? AND a.check_in<? ${scoped(actor)?'AND s.trainer_id=?':''} ORDER BY a.check_in DESC LIMIT 10000`,[p.from+'T03:00:00.000Z',dayOffset(p.to,1)+'T03:00:00.000Z',...(scoped(actor)?[actor.id]:[])]);columns=[['id','Código'],['student_name','Aluno'],['check_in','Entrada'],['check_out','Saída'],['override_reason','Exceção autorizada']];
 }else if(type==='financial'){
  requirePermission(actor,'finance.read');const financialRows=await all<Pick<TableRows['invoices'],'id'|'description'|'amount_cents'|'due_date'|'status'|'paid_at'|'payment_method'> & {student_name:string}>(db,'SELECT i.id,s.name student_name,i.description,i.amount_cents,i.due_date,i.status,i.paid_at,i.payment_method FROM invoices i JOIN students s ON s.id=i.student_id ORDER BY i.due_date DESC LIMIT 10000');rows=financialRows.map(r=>({...r,amount_brl:(r.amount_cents/100).toFixed(2).replace('.',',')}));columns=[['id','Código'],['student_name','Aluno'],['description','Descrição'],['amount_brl','Valor (BRL)'],['due_date','Vencimento'],['status','Situação'],['paid_at','Pagamento'],['payment_method','Forma']];
 }else throw new DomainError(422,'Selecione um relatório válido.');
 return new Response(safeCsv(rows,columns),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="vitality-${type}-${today()}.csv"`,'Cache-Control':'no-store','X-Export-Limit':'10000'}});
}
