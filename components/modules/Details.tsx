"use client";
import { useState } from "react";
import { Download, Plus, Trash2, UserRound } from "lucide-react";
import { api, notify, useApi, errorMessage, isRecord } from "@/lib/api";
import { can, methodOptions, type ModuleDef } from "@/lib/modules";
import { Badge, Button, DateText, EmptyState, ErrorState, Field, InfoStrip, LoadingState, Modal, Money, Select, formatDate, formatMoney, statusLabel } from "@/components/ui";
import type { Options, Row, Viewer } from "./EntityForm";
import type { EntityItem, BookingRecord } from "@/lib/contracts";
import { recordActions, type RecordAction } from "./ActionDialog";

function display(field: string, value: unknown, data: Row): React.ReactNode {
  if (value == null || value === "") return <span className="vg-muted">Não informado</span>;
  if (field.endsWith("_cents")) return <Money value={value} />;
  if (["status","role","severity","decision"].includes(field)) return <Badge status={value} />;
  if (field === "active") return <Badge status={value ? "active" : "inactive"} />;
  if (field.endsWith("_date") || ["birth_date","valid_until","assessed_at"].includes(field)) return <DateText value={value} />;
  if (field.endsWith("_at") || field === "check_in" || field === "check_out") return <DateText value={value} time />;
  if (field.endsWith("_id")) return String(data[field.replace(/_id$/, "_name")] || "Vinculado");
  if (["method","payment_method"].includes(field)) return methodOptions.find(o=>o.value===value)?.label || String(value);
  if (field === "video_url" && /^https:\/\//.test(String(value))) return <a className="vg-text-link" href={String(value)} target="_blank" rel="noopener noreferrer">Abrir demonstração</a>;
  return String(value);
}
const extraLabels: Record<string,string> = { contracted_price_cents:"Preço contratado",start_date:"Início do contrato",end_date:"Fim do contrato",status:"Situação",stock:"Saldo em estoque",total_cents:"Total",received_at:"Recebida em",paid_at:"Pagamento em",payment_method:"Forma de pagamento",bmi:"IMC calculado",check_in:"Entrada",check_out:"Saída",decision:"Decisão",reason:"Justificativa",summary:"Descrição",action:"Operação",entity:"Módulo",user_name:"Responsável",created_at:"Criado em",updated_at:"Última atualização",version:"Versão"};
export function DetailDialog({module,id,user,onClose,onEdit,onAction,onBookings}:{module:ModuleDef;id:string;user:Viewer;onClose:()=>void;onEdit:(row:Row)=>void;onAction:(row:Row,action:RecordAction)=>void;onBookings?:(row:Row)=>void}) {
  const {data,loading,error,reload} = useApi<Row>(`/${module.key}/${id}`);
  const editable = can(user,module.permission.replace(/\.read$/,".write")) && !module.readOnly && !module.noEdit && !(module.key === "workouts" && data?.status === "archived") && !(module.key === "leads" && data?.status === "converted") && !(module.key === "users" && user.role !== "super_admin" && ["super_admin","admin"].includes(data?.role || ""));
  const fields = data ? [...module.fields.filter(f=>f.key!=="password").map(f=>({key:f.key,label:f.label})),...Object.entries(extraLabels).filter(([key])=>data[key]!=null&&!module.fields.some(f=>f.key===key)).map(([key,label])=>({key,label}))] : [];
  return <Modal open title={data?.name || data?.title || data?.student_name || `Detalhes de ${module.singular}`} description={module.key==="students"?"Cadastro e histórico do aluno.":"Informações salvas no sistema."} onClose={onClose} wide footer={<><Button onClick={onClose}>Fechar</Button>{data&&module.key==="invoices"&&data.status==="paid"&&<Button icon={<Download size={16}/>} onClick={()=>downloadReceipt(data)}>Baixar recibo</Button>}{data&&editable&&(!(module.key==="invoices")||data.status==="open")&&<Button variant="primary" onClick={()=>onEdit(data)}>Editar {module.singular}</Button>}</>}>
    {loading ? <LoadingState/> : error ? <ErrorState message={String(error)} onRetry={reload}/> : data && <>
      <div className="vg-detail-heading"><div className="vg-avatar vg-avatar--large">{String(data.name||data.student_name||data.title||module.label).split(" ").filter(Boolean).slice(0,2).map(w=>w[0]).join("")}</div><div><h3>{data.name||data.student_name||data.title||data.description||module.label}</h3><p>{data.email||data.plan_name||module.label}</p></div>{data.status&&<Badge status={data.status}/>}</div>
      <div className="vg-detail-grid">{fields.map(f=><div key={f.key} className={f.key==="notes"||f.key==="description"||f.key==="message"||f.key==="instructions"?"vg-span-full":""}><dt>{f.label}</dt><dd>{display(f.key,data[f.key],data)}</dd></div>)}</div>
      <div className="vg-record-actions">{recordActions(module,data,user).map(action=><Button key={action.key} variant={action.danger?"ghost":"secondary"} className={action.danger?"vg-danger-text":""} onClick={()=>onAction(data,action)}>{action.label}</Button>)}{module.key==="classes"&&onBookings&&<Button onClick={()=>onBookings(data)}>Gerenciar reservas</Button>}</div>
      {module.key==="students"&&<StudentHistory data={data} user={user}/>}
      {Array.isArray(data.items)&&<ItemsTable kind={module.items} items={data.items}/>}
      {Array.isArray(data.sessions)&&<HistorySection title="Execuções registradas" rows={data.sessions} columns={[{key:"completed_at",label:"Data",type:"datetime"},{key:"notes",label:"Observações"}]}/>}
      {Array.isArray(data.payments)&&<HistorySection title="Pagamentos registrados" rows={data.payments} columns={[{key:"created_at",label:"Data",type:"datetime"},{key:"amount_cents",label:"Valor",type:"money"},{key:"method",label:"Meio de pagamento"},{key:"status",label:"Situação",type:"status"}]}/>}
      {Array.isArray(data.refunds)&&data.refunds.length>0&&<HistorySection title="Estornos registrados" rows={data.refunds} columns={[{key:"created_at",label:"Data",type:"datetime"},{key:"amount_cents",label:"Valor",type:"money"},{key:"reason",label:"Motivo"}]}/>}
      {Array.isArray(data.movements)&&<HistorySection title="Movimentações do estoque" rows={data.movements} columns={[{key:"created_at",label:"Data",type:"datetime"},{key:"quantity",label:"Movimento"},{key:"reason",label:"Motivo"},{key:"user_name",label:"Responsável"}]}/>}
      {Array.isArray(data.history)&&data.history.length>0&&<section className="vg-history-section"><h3>Histórico de versões</h3>{data.history.map((history:Row,index:number)=><details className="vg-history-version" key={history.id||index}><summary><span>{history.event ? statusLabel(history.event) : `Versão ${history.version??index+1}`}</span><span>{formatDate(history.created_at,true)}</span></summary><Snapshot snapshot={history.snapshot} summary={history.summary||history.reason}/></details>)}</section>}
      {module.key==="notifications"&&<InfoStrip>{data.is_read?"Você já leu este comunicado.":"Este comunicado ainda está marcado como não lido."}</InfoStrip>}
    </>}
  </Modal>;
}
function Snapshot({snapshot,summary}:{snapshot:unknown;summary?:string}) {
  let data:Partial<Row>|null=null;
  try { const parsed:unknown=typeof snapshot==="string"?JSON.parse(snapshot):snapshot;if(isRecord(parsed))data=parsed as Partial<Row>; }catch{}
  return <div className="vg-snapshot">{summary&&<p>{summary}</p>}{data?.name&&<p><strong>{data.name}</strong>{data.objective?` · ${data.objective}`:""}</p>}{Array.isArray(data?.items)?<ItemsTable kind="workout" items={data!.items}/>:<p className="vg-muted">Alteração preservada no histórico do registro.</p>}</div>;
}
type HistoryColumn={key:string;label:string;type?:"money"|"date"|"datetime"|"status"};
type StudentHistoryKey="memberships"|"invoices"|"attendance"|"workouts"|"assessments";
function StudentHistory({data,user}:{data:Row;user:Viewer}) {
  const definitions:{key:StudentHistoryKey;label:string;permission:string}[]=[{key:"memberships",label:"Matrículas",permission:"memberships.read"},{key:"invoices",label:"Financeiro",permission:"finance.read"},{key:"attendance",label:"Presenças",permission:"attendance.read"},{key:"workouts",label:"Treinos",permission:"workouts.read"},{key:"assessments",label:"Avaliações",permission:"assessments.read"}];
  const tabs=definitions.filter(t=>can(user,t.permission));
  const [selected,setSelected]=useState<StudentHistoryKey|null>(tabs[0]?.key??null);
  const columns: Record<StudentHistoryKey,HistoryColumn[]>={memberships:[{key:"plan_name",label:"Plano"},{key:"start_date",label:"Início",type:"date"},{key:"end_date",label:"Término",type:"date"},{key:"status",label:"Situação",type:"status"}],invoices:[{key:"description",label:"Cobrança"},{key:"amount_cents",label:"Valor",type:"money"},{key:"due_date",label:"Vencimento",type:"date"},{key:"status",label:"Situação",type:"status"}],attendance:[{key:"check_in",label:"Entrada",type:"datetime"},{key:"check_out",label:"Saída",type:"datetime"}],workouts:[{key:"name",label:"Ficha"},{key:"objective",label:"Objetivo"},{key:"status",label:"Situação",type:"status"}],assessments:[{key:"assessed_at",label:"Data",type:"date"},{key:"weight_kg",label:"Peso (kg)"},{key:"height_cm",label:"Altura (cm)"},{key:"body_fat_pct",label:"Gordura (%)"}]};
  if(!tabs.length)return null;
  return <section className="vg-history-section"><h3>Histórico do aluno</h3><div className="vg-tabs" role="group" aria-label="Histórico do aluno">{tabs.map(t=><button key={t.key} type="button" className={selected===t.key?"is-active":""} aria-pressed={selected===t.key} onClick={()=>setSelected(t.key)}>{t.label}</button>)}</div><HistorySection rows={selected?data[selected]||[]:[]} columns={selected?columns[selected]:[]} compact/></section>;
}
function HistorySection({title,rows,columns,compact=false}:{title?:string;rows:Row[];columns:HistoryColumn[];compact?:boolean}) { return <section className={compact?"":"vg-history-section"}>{title&&<h3>{title}</h3>}{!rows.length?<EmptyState title="Nenhum registro neste histórico" description="As novas operações do aluno serão exibidas aqui."/>:<div className="vg-table-scroll"><table className="vg-table vg-table--detail"><thead><tr>{columns.map(c=><th key={c.key} scope="col">{c.label}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={row.id||i}>{columns.map(c=><td key={c.key}>{c.type==="money"?<Money value={row[c.key]}/>:c.type==="date"||c.type==="datetime"?<DateText value={row[c.key]} time={c.type==="datetime"}/>:c.type==="status"?<Badge status={row[c.key]}/>:String(row[c.key]??"—")}</td>)}</tr>)}</tbody></table></div>}</section>; }
export function ItemsTable({kind,items}:{kind?:string;items:EntityItem[]}) { return <section className="vg-history-section"><h3>{kind==="workout"?"Prescrição de exercícios":"Itens registrados"}</h3><div className="vg-table-scroll"><table className="vg-table vg-table--detail"><thead><tr>{(kind==="workout"?["Dia","Exercício","Séries × repetições","Carga","Descanso"]:["Produto","Quantidade","Valor unitário","Subtotal"]).map(label=><th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{items.map((item,i)=><tr key={item.id||i}>{kind==="workout"?<><td><span className="vg-workout-day">{item.day}</span></td><td><strong>{item.exercise_name||item.name||"Exercício"}</strong>{item.notes&&<span className="vg-cell-secondary">{item.notes}</span>}</td><td>{item.sets} × {item.reps}</td><td>{item.load||"Livre"}</td><td>{item.rest_seconds} s</td></>:<><td>{item.product_name||item.name||"Produto"}</td><td>{item.quantity}</td><td><Money value={item.unit_price_cents??item.unit_cost_cents}/></td><td><Money value={Number(item.unit_price_cents??item.unit_cost_cents)*Number(item.quantity)}/></td></>}</tr>)}</tbody></table></div></section>; }

export function BookingsDialog({row,options,user,onClose,onChanged}:{row:Row;options:Options;user:Viewer;onClose:()=>void;onChanged:()=>void}) {
  const {data,loading,error,reload}=useApi<Row>(`/classes/${row.id}`);
  const [student,setStudent]=useState("");
  const [busy,setBusy]=useState(false);
  const [failure,setFailure]=useState("");
  const [cancel,setCancel]=useState<BookingRecord|null>(null);
  const writable=can(user,"classes.write") && (!["personal","trainer"].includes(user.role) || row.instructor_id === user.id);
  async function book(studentId:string,remove=false){
    if(busy)return;
    if(!studentId){setFailure("Selecione o aluno para reservar uma vaga.");return;}
    setBusy(true);setFailure("");
    try{await api(`/classes/${row.id}/${remove?"unbook":"book"}`,{method:"POST",body:JSON.stringify({student_id:studentId})});notify(remove?"Reserva cancelada.":"Reserva confirmada.","success");setStudent("");setCancel(null);reload();onChanged();}
    catch(err:unknown){setFailure(errorMessage(err,"A reserva não foi alterada."));setCancel(null);}
    finally{setBusy(false);}
  }
  const bookings:BookingRecord[]=data?.bookings||[];
  const bookedCount=Number(data?.booked_count ?? bookings.length);
  const remaining=Math.max(0,Number(data?.capacity||0)-bookedCount);
  return <><Modal open title={row.name||"Reservas da turma"} description={`${formatDate(row.starts_at,true)} · ${row.location||"Academia"}`} onClose={onClose} busy={busy} footer={<Button onClick={onClose} disabled={busy}>Fechar</Button>}>
    {loading?<LoadingState/>:error?<ErrorState message={String(error)} onRetry={reload}/>:<>
      <div className="vg-capacity"><div><strong>{bookedCount}</strong><span>reservas confirmadas</span></div><div><strong>{remaining}</strong><span>vagas disponíveis</span></div></div>
      <div className="vg-capacity-bar"><span style={{width:`${Math.min(100,bookedCount/Math.max(1,Number(data?.capacity))*100)}%`}}/></div>
      {["personal","trainer"].includes(user.role)&&<InfoStrip>A lista mostra as reservas dos alunos vinculados à sua conta. A contagem considera todas as vagas ocupadas.</InfoStrip>}
      {failure&&<ErrorState message={failure} compact/>}
      {writable&&data?.status==="scheduled"&&<form noValidate className="vg-booking-form" onSubmit={e=>{e.preventDefault();book(student);}}><Field label="Reservar para um aluno"><Select value={student} onChange={e=>setStudent(e.target.value)} disabled={busy||!remaining}><option value="">Selecione o aluno…</option>{(options.students||[]).filter(s=>!bookings.some(b=>b.student_id===s.id)).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field><Button type="submit" variant="primary" busy={busy} disabled={!remaining} icon={<Plus size={15}/>}>Reservar</Button></form>}
      {!remaining&&<InfoStrip tone="warning">A turma atingiu a capacidade de {data?.capacity} alunos.</InfoStrip>}
      {bookings.length?<ul className="vg-bookings-list">{bookings.map(booking=><li key={booking.id||booking.student_id}><span className="vg-avatar"><UserRound size={17}/></span><div><strong>{booking.student_name||"Aluno"}</strong><span>Reserva confirmada</span></div>{writable&&<Button variant="ghost" onClick={()=>setCancel(booking)} disabled={busy} aria-label={`Cancelar reserva de ${booking.student_name}`} icon={<Trash2 size={15}/>}>Cancelar</Button>}</li>)}</ul>:<EmptyState title="A turma está aberta" description="Reserve a primeira vaga para um aluno."/>}
    </>}
  </Modal><Modal open={!!cancel} title="Cancelar reserva?" description={`A vaga de ${cancel?.student_name||"este aluno"} voltará a ficar disponível.`} onClose={()=>setCancel(null)} busy={busy} footer={<><Button onClick={()=>setCancel(null)} autoFocus disabled={busy}>Manter reserva</Button><Button variant="danger" busy={busy} onClick={()=>cancel&&book(cancel.student_id,true)}>Cancelar reserva</Button></>}><p className="vg-muted">O aluno poderá reservar novamente enquanto houver vagas.</p></Modal></>;
}
function downloadReceipt(invoice:Row){
 const esc=(s:unknown)=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));
 const html=`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Recibo de pagamento</title><style>body{font:16px system-ui;color:#171a16;max-width:700px;margin:60px auto;padding:24px}h1{font-size:30px}dl{display:grid;grid-template-columns:160px 1fr;gap:18px;border-block:1px solid #ddd;padding:24px 0}dd{margin:0}small{color:#666}</style><h1>Recibo de pagamento</h1><p>Comprovante de recebimento registrado pela academia.</p><dl><dt>Aluno</dt><dd>${esc(invoice.student_name)}</dd><dt>Descrição</dt><dd>${esc(invoice.description)}</dd><dt>Valor recebido</dt><dd><strong>${esc(formatMoney(invoice.amount_cents))}</strong></dd><dt>Pagamento</dt><dd>${esc(formatDate(invoice.paid_at,true))}</dd><dt>Meio de pagamento</dt><dd>${esc(methodOptions.find(m=>m.value===invoice.payment_method)?.label||invoice.payment_method)}</dd><dt>Identificador</dt><dd>${esc(invoice.id)}</dd></dl><small>Comprovante interno. Não substitui documento fiscal. Para imprimir ou salvar em PDF, use a impressão do navegador.</small></html>`;
 const url=URL.createObjectURL(new Blob([html],{type:"text/html;charset=utf-8"}));const link=document.createElement("a");link.href=url;link.download=`recibo-${String(invoice.id).replace(/[^a-zA-Z0-9-]/g,"").slice(0,36)}.html`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify("Recibo gerado.","success");
}
