"use client";
import { useId, useRef, useState, type FormEvent } from "react";
import { api, notify, errorMessage } from "@/lib/api";
import { can, methodOptions, type ModuleDef } from "@/lib/modules";
import { Button, ErrorState, Field, InfoStrip, Input, Modal, Select, Textarea, formatMoney } from "@/components/ui";
import type { Options, Row, Viewer } from "./EntityForm";

export type RecordAction = { key: string; label: string; danger?: boolean; description: string };
export function recordActions(module: ModuleDef, row: Row, user: Viewer): RecordAction[] {
  const writable = can(user, module.permission.replace(/\.read$/, ".write"));
  if (module.key === "notifications") return !row.is_read ? [{key:"read",label:"Marcar como lido",description:"O comunicado será marcado como lido apenas para a sua conta."}] : [];
  if (!writable) return [];
  if (module.key === "memberships") return [...(row.status === "suspended" ? [{key:"resume",label:"Retomar matrícula",description:"A matrícula volta ao estado ativo, mantendo as datas do contrato e o histórico financeiro."}] : []),...(row.status === "active" || row.status === "expired" || row.status === "suspended" ? [{key:"renew",label:"Renovar matrícula",description:"O próximo período será calculado a partir do contrato e uma nova cobrança será gerada."}] : []),...(row.status === "active" ? [{key:"suspend",label:"Suspender matrícula",description:"O acesso do aluno será suspenso. O histórico financeiro permanece disponível.",danger:true}] : []),...(["active","suspended"].includes(row.status || "") ? [{key:"cancel",label:"Cancelar matrícula",description:"O contrato será cancelado e não autorizará novas entradas. Cobranças e pagamentos existentes são preservados.",danger:true}] : [])];
  if (module.key === "invoices") return row.status === "paid" ? [{key:"refund",label:"Estornar pagamento",description:"O recebimento será estornado no sistema e a operação ficará registrada no histórico. Faça o reembolso ao aluno pelo meio utilizado.",danger:true}] : row.status === "open" || row.status === "overdue" || row.status === "refunded" ? [{key:"pay",label:"Registrar pagamento",description:`Confirme o recebimento integral de ${formatMoney(row.amount_cents)}. O sistema registra um pagamento manual.`},{key:"cancel",label:"Cancelar cobrança",description:"A cobrança deixará de estar em aberto. O histórico será preservado.",danger:true}] : [];
  if (module.key === "attendance" && !row.check_out) return [{key:"check-out",label:"Registrar saída",description:"O aluno deixará de aparecer na ocupação atual da academia."}];
  if (module.key === "workouts") return [...(row.status === "draft" ? [{key:"activate",label:"Ativar ficha",description:"Esta ficha passa a ser o treino ativo do aluno. A ficha anterior será preservada no histórico."}] : []), ...(row.status === "active" ? [{key:"complete",label:"Registrar execução",description:"Registre que o aluno concluiu uma sessão desta ficha. O registro será adicionado ao histórico."}] : []), ...(["draft", "active"].includes(row.status || "") ? [{key:"archive",label:"Arquivar ficha",description:"A ficha será preservada no histórico e deixará de estar disponível para novas execuções.",danger:true}] : [])];
  if (module.key === "products") return [{key:"adjust",label:"Ajustar estoque",description:"Registre a entrada ou saída e o motivo da movimentação. Use números negativos para retirar unidades."}];
  if (module.key === "purchases" && row.status === "draft") return [{key:"receive",label:"Receber compra",description:"Os produtos desta compra serão adicionados ao estoque. Confira as quantidades antes de confirmar."}];
  if (module.key === "sales" && row.status === "completed") return [{key:"refund",label:"Estornar venda",description:"Os produtos retornam ao estoque e o valor recebido será estornado no registro financeiro.",danger:true}];
  if (module.key === "leads" && !["converted","lost"].includes(row.status || "")) return [{key:"convert",label:"Converter em aluno",description:"Um cadastro de aluno será criado com os dados deste contato. Depois você poderá criar a matrícula."}];
  return [];
}
export function ActionDialog({ module, row, action, options, user, onClose, onSaved }: { module: ModuleDef; row?: Row | null; action: RecordAction; options: Options; user: Viewer; onClose: () => void; onSaved: () => void }) {
  const [method, setMethod] = useState("pix");
  const [reason, setReason] = useState("");
  const [quantity, setQuantity] = useState("");
  const [student, setStudent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string,string>>({});
  const idempotencyKey = useRef(crypto.randomUUID());
  const formId = useId();
  const reasonRequired = ["refund","cancel","suspend","adjust"].includes(action.key);
  const checkIn = action.key === "check-in";
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const errors: Record<string,string> = {};
    if (reasonRequired && reason.trim().length < 3) errors.reason = "Descreva o motivo com pelo menos 3 caracteres.";
    if (action.key === "adjust" && (!Number.isInteger(Number(quantity)) || Number(quantity) === 0 || Math.abs(Number(quantity)) > 100000)) errors.quantity = "Informe uma quantidade inteira diferente de zero (até 100.000).";
    if (checkIn && !student) errors.student = "Selecione o aluno que está entrando.";
    if (Object.keys(errors).length) { setFieldErrors(errors); setTimeout(()=>document.getElementById(formId)?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),20); return; }
    const payload: Record<string, unknown> = checkIn || action.key === "complete" || action.key === "read" || action.key === "check-out" ? {} : (row?.version != null ? {version:row.version} : {});
    if (module.key === "invoices" && ["pay", "refund"].includes(action.key)) payload.idempotencyKey = idempotencyKey.current;
    if (reasonRequired) payload.reason = reason.trim();
    if (action.key === "complete" && reason.trim()) payload.notes = reason.trim();
    if (action.key === "pay") payload.method = method;
    if (action.key === "adjust") payload.quantity = Number(quantity);
    if (checkIn) { payload.student_id = student; if (reason.trim() && can(user,"attendance.override")) payload.override_reason = reason.trim(); }
    const path = checkIn ? "/attendance/check-in" : `/${module.key}/${row?.id}/${action.key}`;
    setBusy(true);setError("");
    try { await api(path, {method:"POST",body:JSON.stringify(payload)}); notify(action.key === "check-in" ? "Entrada registrada." : action.key === "check-out" ? "Saída registrada." : "Operação registrada com sucesso.","success");onSaved(); }
    catch (err: unknown) { setError(errorMessage(err, "A operação não foi registrada. Tente novamente.")); }
    finally { setBusy(false); }
  }
  return <Modal open title={action.label} description={action.description} onClose={onClose} busy={busy} footer={<><Button onClick={onClose} disabled={busy} autoFocus={!!action.danger}>Voltar</Button><Button variant={action.danger ? "danger" : "primary"} type="submit" form={formId} busy={busy}>{action.label}</Button></>}>
    <form id={formId} noValidate onSubmit={submit}>
      <fieldset disabled={busy} className="vg-form-fieldset vg-form-stack">
      {error && <ErrorState message={error} compact />}
      {row && <div className="vg-action-record"><strong>{row.student_name || row.name || row.supplier_name || row.title || row.description || "Registro selecionado"}</strong>{row.plan_name && <span>{row.plan_name}</span>}{(row.amount_cents != null || row.total_cents != null) && <span className="vg-action-value">{formatMoney(row.amount_cents ?? row.total_cents)}</span>}</div>}
      {action.key === "pay" && <Field label="Como o pagamento foi recebido?" required><Select value={method} onChange={e=>setMethod(e.target.value)}>{methodOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</Select></Field>}
      {checkIn && <Field label="Aluno" required error={fieldErrors.student}><Select value={student} onChange={e=>{setStudent(e.target.value);setFieldErrors({});}}><option value="">Selecione o aluno…</option>{(options.students||[]).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>}
      {action.key === "adjust" && <Field label="Quantidade a movimentar" required error={fieldErrors.quantity} help="Ex.: 10 adiciona dez unidades; -2 retira duas unidades."><Input value={quantity} type="number" step="1" min="-100000" max="100000" onChange={e=>setQuantity(e.target.value)} /></Field>}
      {(reasonRequired || action.key === "complete" || (checkIn && can(user,"attendance.override"))) && <Field label={checkIn ? "Justificativa de liberação excepcional" : action.key === "complete" ? "Observações da execução" : "Motivo da operação"} required={reasonRequired} error={fieldErrors.reason} help={checkIn ? "Opcional. Ao preencher, você autoriza uma exceção às regras de acesso, registrada na auditoria." : "Esta justificativa ficará vinculada ao histórico."}><Textarea className="resize-none" value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)} /></Field>}
      {action.key === "refund" && <InfoStrip tone="warning">Este é um registro interno. O envio do dinheiro ao cliente deve ser realizado no meio de pagamento utilizado.</InfoStrip>}
      {checkIn && <InfoStrip>O acesso considera matrícula, horário e carência financeira definidos pela academia.</InfoStrip>}
      </fieldset>
    </form>
  </Modal>;
}
