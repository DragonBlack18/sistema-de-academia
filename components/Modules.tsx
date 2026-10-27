"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Eye, LayoutList, ListFilter, LogIn, Pencil, Plus, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import { api, notify, useApi, errorMessage } from "@/lib/api";
import { can, getModule, methodOptions, writePermission, type ColumnDef, type ModuleDef } from "@/lib/modules";
import { Badge, Button, DateText, EmptyState, ErrorState, InfoStrip, LoadingState, Money, Pagination, statusLabel } from "@/components/ui";
import { EntityForm, type Options, type Row, type Viewer } from "./modules/EntityForm";
import { ActionDialog, recordActions, type RecordAction } from "./modules/ActionDialog";
import { BookingsDialog, DetailDialog } from "./modules/Details";
import { ReportsPage } from "./modules/Reports";
import "./modules/modules.css";

type PageData = { data: Row[]; total: number; page: number; pageSize: number };
type Overlay = { kind: "form"; row?: Row | null } | { kind: "detail"; id: string } | { kind: "action"; row?: Row | null; action: RecordAction } | { kind: "bookings"; row: Row } | null;
export function ModulePage({ module, user, onNavigate }: { module: string; user: Viewer; onNavigate?: (module: string) => void }) {
  if (module === "reports") return <ReportsPage user={user} />;
  const definition = getModule(module);
  if (!definition) return <ErrorState message="Este módulo não foi encontrado. Volte ao painel e escolha uma opção do menu." />;
  return <EntityPage key={module} definition={definition} user={user} onNavigate={onNavigate} />;
}
export default ModulePage;
function EntityPage({ definition: module, user, onNavigate }: { definition: ModuleDef; user: Viewer; onNavigate?: (module: string) => void }) {
 const [draftQuery,setDraftQuery]=useState("");const [query,setQuery]=useState("");const [status,setStatus]=useState("");const [page,setPage]=useState(1);const [pageSize,setPageSize]=useState(20);const [ready,setReady]=useState(false);const [composing,setComposing]=useState(false);const [compact,setCompact]=useState(false);
 const [overlay,setOverlay]=useState<Overlay>(null);const [editLoading,setEditLoading]=useState("");
 const searchRef=useRef<HTMLInputElement>(null);const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const canRead=can(user,module.permission);const canWrite=can(user,writePermission(module));
 useEffect(()=>{
   function restore(){const p=new URLSearchParams(window.location.search);const q=p.get("list_q")||"";setQuery(q);setDraftQuery(q);setStatus(p.get("list_status")||"");setPage(Math.max(1,Number(p.get("list_page"))||1));const size=Number(p.get("list_size"))||20;setPageSize([10,20,50].includes(size)?size:20);setReady(true);}
   // Restore browser-owned URL/storage state after hydration, then subscribe to history changes.
   // eslint-disable-next-line react-hooks/set-state-in-effect
   restore();window.addEventListener("popstate",restore);try{setCompact(localStorage.getItem("vg-table-density")==="compact");}catch{}
   return()=>window.removeEventListener("popstate",restore);
 },[]);
 useEffect(()=>{if(!ready||composing)return;if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>{if(query!==draftQuery){setQuery(draftQuery);setPage(1);}},300);return()=>{if(timer.current)clearTimeout(timer.current);};},[draftQuery,composing,ready,query]);
 useEffect(()=>{if(!ready)return;const u=new URL(window.location.href);for(const [key,value]of Object.entries({list_q:query,list_status:status,list_page:page>1?String(page):"",list_size:pageSize!==20?String(pageSize):""})){if(value)u.searchParams.set(key,value);else u.searchParams.delete(key);}window.history.replaceState(window.history.state,"",u);},[query,status,page,pageSize,ready]);
 const path=`/${module.key}?q=${encodeURIComponent(query)}&status=${encodeURIComponent(status)}&page=${page}&pageSize=${pageSize}`;
 const {data,loading,error,reload}=useApi<PageData>(canRead?path:null);
 const optionsState=useApi<Options>(canRead?"/options":null);
 const options=optionsState.data||{};
 // Reconcile an existing page only after the server reports fewer records (for example after deletion).
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{if(data&&page>1&&data.total<=(page-1)*pageSize)setPage(Math.max(1,Math.ceil(data.total/pageSize)));},[data,page,pageSize]);
 function saved(){setOverlay(null);reload();optionsState.reload();window.dispatchEvent(new CustomEvent("vg:data-changed",{detail:{module:module.key}}));}
 function clearSearch(){if(timer.current)clearTimeout(timer.current);setDraftQuery("");setQuery("");setPage(1);searchRef.current?.focus();}
 async function edit(row:Row){if(editLoading)return;setEditLoading(row.id);try{const fresh=await api<Row>(`/${module.key}/${row.id}`);setOverlay({kind:"form",row:fresh});}catch(err:unknown){notify(errorMessage(err,"Não foi possível abrir o registro."),"error");}finally{setEditLoading("");}}
 function create(){if(optionsState.error){notify("Não foi possível carregar os vínculos. Atualize a página e tente novamente.","error");return;}setOverlay({kind:"form"});}
 if(!canRead)return <div className="vg-module-page"><ErrorState message="Seu perfil não tem permissão para consultar este módulo."/>{onNavigate&&<Button onClick={()=>onNavigate("dashboard")}>Voltar ao painel</Button>}</div>;
 const rows=data?.data||[];
 const titleCreate=module.key==="attendance"?"Registrar entrada":module.createLabel||`Novo ${module.singular}`;
 function primaryCreate(){if(module.key==="attendance")setOverlay({kind:"action",action:{key:"check-in",label:"Registrar entrada",description:"Escolha o aluno para verificar as regras e registrar a presença."}});else create();}
 const canCreate=canWrite&&(!module.readOnly||module.key==="attendance");
 return <section className="vg-module-page" aria-label={module.label}>
  <header className="vg-page-header"><div><span className="vg-eyebrow">{module.group.toUpperCase()}</span><h1>{module.label}<span className="vg-heading-dot">.</span></h1><p>{module.description}</p></div><div className="vg-header-actions"><Button onClick={()=>{reload();optionsState.reload();}} aria-label={`Atualizar ${module.label.toLowerCase()}`} icon={<RefreshCw size={16}/>} disabled={loading}/>{canCreate&&<Button variant="primary" icon={module.key==="attendance"?<LogIn size={17}/>:<Plus size={17}/>} onClick={primaryCreate} disabled={optionsState.loading}>{titleCreate}</Button>}</div></header>
  {onNavigate&&<RelatedTabs module={module.key} user={user} onNavigate={onNavigate}/>}
  {module.key==="attendance"&&<div className="vg-reception-banner"><span className="vg-reception-icon"><LogIn size={25}/></span><div><strong>Uma recepção que flui.</strong><p>Confirme a entrada, acompanhe a permanência e registre a saída.</p></div><span className="vg-live"><i/>Controle de acesso ativo</span></div>}
  {module.key==="users"&&<div className="vg-permission-guide"><ShieldCheck size={22}/><div><strong>O acesso certo para cada pessoa.</strong><p>Administradores organizam a operação. Recepção e financeiro têm funções próprias. Professores e personais acompanham os alunos vinculados.</p></div></div>}
  {module.key==="workouts"&&user.role!=="super_admin"&&["personal","trainer"].includes(user.role)&&<InfoStrip>Você pode consultar e alterar as fichas dos alunos vinculados à sua conta.</InfoStrip>}
  <div className="vg-panel vg-list-panel">
   <div className="vg-list-topline"><div><h2>{module.key==="audit"?"Histórico de operações":module.key==="attendance"?"Registros de presença":module.key==="notifications"?"Caixa de entrada":`Todos os registros`}</h2><span className="vg-count">{data?.total??"—"}</span></div><span className="vg-list-note">{query||status?"Resultados filtrados":"Dados salvos no sistema"}</span></div>
   <div className="vg-toolbar"><div className="vg-search"><Search size={17}/><input ref={searchRef} type="search" aria-label={`Buscar em ${module.label.toLowerCase()}`} placeholder={module.key==="students"?"Buscar por nome, e-mail ou telefone…":`Buscar ${module.label.toLowerCase()}…`} value={draftQuery} onChange={e=>setDraftQuery(e.target.value)} onCompositionStart={()=>setComposing(true)} onCompositionEnd={()=>setComposing(false)} onKeyDown={e=>{if(e.key==="Enter"&&!composing){e.preventDefault();if(timer.current)clearTimeout(timer.current);setQuery(draftQuery);setPage(1);}}}/>{draftQuery&&<button type="button" aria-label="Limpar busca" onClick={clearSearch}><X size={15}/></button>}</div><div className="vg-toolbar-filters">{module.statuses&&<label className="vg-status-select"><ListFilter size={15}/><select aria-label="Filtrar por situação" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">Todas as situações</option>{module.statuses.map(s=><option key={s} value={s}>{statusLabel(s)}</option>)}</select></label>}<button type="button" className="vg-icon-button" aria-label={compact?"Usar linhas confortáveis":"Usar linhas compactas"} title={compact?"Linhas confortáveis":"Linhas compactas"} aria-pressed={compact} onClick={()=>{setCompact(!compact);try{localStorage.setItem("vg-table-density",!compact?"compact":"comfortable");}catch{}}}><LayoutList size={17}/></button></div></div>
   {(query||status)&&<div className="vg-active-filters">{query&&<button type="button" onClick={clearSearch}>Busca: {query}<X size={12}/></button>}{status&&<button type="button" onClick={()=>{setStatus("");setPage(1);}}>Situação: {statusLabel(status)}<X size={12}/></button>}{query&&status&&<button type="button" className="vg-clear-all" onClick={()=>{clearSearch();setStatus("");}}>Limpar filtros</button>}</div>}
   {error?<ErrorState message={String(error)} onRetry={reload}/>:loading&&!data?<LoadingState/>:rows.length?<><div className={`vg-table-scroll ${compact?"vg-density-compact":""}`} aria-busy={loading}><table className="vg-table"><thead><tr>{module.columns.map(column=><th key={column.key} scope="col">{column.label}</th>)}<th scope="col" className="vg-actions-col"><span className="sr-only">Ações</span></th></tr></thead><tbody>{rows.map(row=><tr key={row.id} className={module.key==="notifications"&&!row.is_read?"vg-row-unread":""}>{module.columns.map(column=><td key={column.key}><Cell column={column} row={row} module={module}/></td>)}<td className="vg-row-actions"><div>{module.key==="classes"?<Button variant="ghost" className="vg-row-primary" onClick={()=>setOverlay({kind:"bookings",row})}>Reservas</Button>:recordActions(module,row,user).filter(a=>!a.danger).slice(0,1).map(action=><Button key={action.key} variant="ghost" className="vg-row-primary" onClick={()=>setOverlay({kind:"action",row,action})}>{shortAction(action.key)}</Button>)}{!module.readOnly&&<button type="button" className="vg-icon-button" aria-label={`Ver detalhes de ${row.name||row.student_name||row.title||module.singular}`} onClick={()=>setOverlay({kind:"detail",id:row.id})}><Eye size={16}/></button>}{module.readOnly&&module.key!=="attendance"&&<button type="button" className="vg-icon-button" aria-label="Ver detalhes do registro" onClick={()=>setOverlay({kind:"detail",id:row.id})}><Eye size={16}/></button>}{canWrite&&!module.noEdit&&!module.readOnly&&!(module.key==="users"&&user.role!=="super_admin"&&["super_admin","admin"].includes(row.role || ""))&&(module.key!=="invoices"||row.status==="open")&&(module.key!=="leads"||row.status!=="converted")&&(module.key!=="workouts"||row.status!=="archived")&&<button type="button" className="vg-icon-button" disabled={!!editLoading} aria-label={`Editar ${row.name||row.student_name||module.singular}`} onClick={()=>edit(row)}>{editLoading===row.id?<RefreshCw size={16} className="vg-spin"/>:<Pencil size={16}/>}</button>}</div></td></tr>)}</tbody></table></div>{loading&&<div role="status" className="vg-refreshing">Atualizando registros…</div>}</>:<EmptyState title={query||status?"Nenhum resultado encontrado":emptyTitle(module)} description={query||status?"Tente outro termo ou remova os filtros para ampliar a busca.":emptyDescription(module)} action={query||status?<Button onClick={()=>{clearSearch();setStatus("");}}>Limpar filtros</Button>:canCreate?<Button variant="primary" onClick={primaryCreate} icon={<Plus size={16}/>}>{titleCreate}</Button>:undefined}/>}
   <Pagination total={data?.total||0} page={page} pageSize={pageSize} busy={loading} onPageChange={setPage} onPageSizeChange={n=>{setPageSize(n);setPage(1);}}/>
  </div>
  {optionsState.error&&<div className="vg-options-error"><ErrorState compact message="Os dados dos seletores não puderam ser carregados. Atualize antes de cadastrar vínculos." onRetry={optionsState.reload}/></div>}
  {module.key==="audit"&&<p className="vg-bottom-note"><ShieldCheck size={14}/>O histórico de auditoria é somente leitura. As operações identificam autor e data.</p>}
  {module.key==="products"&&<p className="vg-bottom-note">O saldo é alterado por movimentações justificadas, recebimentos e vendas.</p>}
  {overlay?.kind==="form"&&<EntityForm key={overlay.row?.id||"new"} module={module} row={overlay.row} options={options} user={user} onClose={()=>setOverlay(null)} onSaved={saved}/>}
  {overlay?.kind==="detail"&&<DetailDialog module={module} id={overlay.id} user={user} onClose={()=>setOverlay(null)} onEdit={row=>setOverlay({kind:"form",row})} onAction={(row,action)=>setOverlay({kind:"action",row,action})} onBookings={row=>setOverlay({kind:"bookings",row})}/>}
  {overlay?.kind==="action"&&<ActionDialog module={module} row={overlay.row} action={overlay.action} options={options} user={user} onClose={()=>setOverlay(null)} onSaved={saved}/>}
  {overlay?.kind==="bookings"&&<BookingsDialog row={overlay.row} options={options} user={user} onClose={()=>setOverlay(null)} onChanged={()=>{reload();optionsState.reload();}}/>}
 </section>;
}
function shortAction(key:string){return({pay:"Receber",read:"Ler",renew:"Renovar",activate:"Ativar",adjust:"Ajustar",resume:"Retomar",complete:"Registrar",receive:"Receber",convert:"Converter","check-out":"Saída"}as Record<string,string>)[key]||"Abrir";}
function emptyTitle(module:ModuleDef){return({students:"O próximo aluno começa aqui",workouts:"Cada aluno, um caminho",notifications:"Tudo em dia por aqui",attendance:"Pronto para a primeira entrada",audit:"O histórico começa com a operação",classes:"Sua agenda está livre",leads:"Novas conexões começam aqui"}as Record<string,string>)[module.key]||`Nenhum registro de ${module.singular}`;}
function emptyDescription(module:ModuleDef){return module.readOnly?"Os registros aparecerão conforme as operações forem realizadas.":module.key==="notifications"?"Os comunicados enviados à sua conta aparecerão nesta lista.":`Use “${module.createLabel||`Novo ${module.singular}`}” para cadastrar e acompanhar o primeiro registro.`;}
function Cell({column,row,module}:{column:ColumnDef;row:Row;module:ModuleDef}){
 const value=row[column.key];
 if(column.key==="occupancy")return <Badge status={row.check_out?"outside":"inside"}/>;
 if(column.key==="places")return <span className="vg-places"><strong>{row.booked_count||0}</strong> / {row.capacity} vagas</span>;
 if(column.key==="read_state")return <Badge tone={row.is_read?"neutral":"info"}>{row.is_read?"Lido":"Não lido"}</Badge>;
 if(column.key==="access_hours")return row.access_start&&row.access_end?`${row.access_start}–${row.access_end}`:<span className="vg-muted">Livre</span>;
 if(column.key==="status"&&module.key==="invoices"&&row.is_overdue&&row.status==="open")return <Badge status="overdue"/>;
 if(["payment_method","method"].includes(column.key))return methodOptions.find(o=>o.value===value)?.label||<span className="vg-muted">—</span>;
 if(column.key==="video_url")return typeof value==="string"&&/^https:\/\//.test(value)?<a href={value} target="_blank" rel="noopener noreferrer" className="vg-text-link">Assistir <ArrowRight size={12}/></a>:<span className="vg-muted">Sem vídeo</span>;
 if(column.type==="person"){
   const name=value||(module.key==="sales"?"Venda no balcão":"—");const secondary=column.secondary?row[column.secondary]:null;
   return <div className="vg-person-cell"><span className={`vg-avatar vg-avatar--${String(name).length%4}`}>{String(name).split(" ").filter(Boolean).slice(0,2).map(w=>w[0]).join("")}</span><span><strong>{String(name)}</strong>{Boolean(secondary)&&<small title={String(secondary)}>{String(secondary)}</small>}</span></div>;
 }
 if(column.type==="money")return <Money value={value}/>;
 if(column.type==="date"||column.type==="datetime")return <DateText value={value} time={column.type==="datetime"}/>;
 if(column.type==="status")return <Badge status={value}/>;
 if(column.type==="boolean")return <Badge status={value?"active":"inactive"}/>;
 if(column.key==="stock")return <span className={Number(value)<=Number(row.min_stock)?"vg-stock-low":"vg-number"}>{String(value??0)} un.{Number(value)<=Number(row.min_stock)&&<span className="vg-cell-secondary">Estoque baixo</span>}</span>;
 if(column.type==="number")return value==null?<span className="vg-muted">—</span>:new Intl.NumberFormat("pt-BR",{maximumFractionDigits:1}).format(Number(value));
 if(column.key==="recipient_name"&&!value)return "Toda a equipe";
 return value==null||value===""?<span className="vg-muted">—</span>:<span className={column.key==="summary"?"vg-long-cell":undefined}>{String(value)}</span>;
}
function RelatedTabs({module,user,onNavigate}:{module:string;user:Viewer;onNavigate:(module:string)=>void}){
 const groups=[["invoices","expenses"],["attendance","access-events"],["workouts","exercises","assessments"],["products","purchases","sales","suppliers"]];const group=groups.find(g=>g.includes(module));if(!group)return null;
 const choices=group.map(getModule).filter((m):m is ModuleDef=>!!m&&can(user,m.permission));
 return <nav className="vg-tabs vg-module-tabs" aria-label="Módulos relacionados">{choices.map(m=><button type="button" key={m.key} aria-current={module===m.key?"page":undefined} className={module===m.key?"is-active":""} onClick={()=>onNavigate(m.key)}>{m.key==="invoices"?"Contas a receber":m.key==="attendance"?"Presenças":m.label}</button>)}</nav>;
}
