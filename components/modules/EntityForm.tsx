"use client";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { api, notify, ApiError, errorMessage } from "@/lib/api";
import { currencyToCents, type FieldDef, type ModuleDef } from "@/lib/modules";
import { Button, ErrorState, Field, InfoStrip, Input, Modal, Select, Textarea, formatMoney } from "@/components/ui";

import type { EntityItem, EntityRecord, LookupOption } from "@/lib/contracts";
export type Row = EntityRecord;
export type Options = Record<string, LookupOption[]>;
type FormValues = Record<string, string>;
type EditableItem = Omit<EntityItem, "unit_cost_cents" | "sets" | "rest_seconds" | "quantity"> & { unit_cost_cents?: string | number; sets?: string | number; rest_seconds?: string | number; quantity?: string | number };
export type Viewer = { id: string; name?: string; role: string; permissions: string[] };
export function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function datetimeInput(value: unknown) { if (!value) return ""; const d = new Date(String(value)); if (!Number.isFinite(d.getTime())) return ""; const f = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d); return f.replace(" ", "T"); }
export function optionsFor(field: FieldDef, options: Options, user?: Viewer) {
  if (field.key === "role" && user?.role !== "super_admin") return (field.options || []).filter(o => !["super_admin", "admin"].includes(o.value));
  if (field.options) return field.options;
  const data = field.source === "trainers" ? (options.users || []).filter(u => ["trainer", "personal", "admin", "super_admin"].includes(u.role || "")) : options[field.source || ""] || [];
  return data.map(item => ({ value: item.id, label: item.name + (field.source === "plans" ? ` · ${formatMoney(item.price_cents)}` : "") }));
}
function initialValues(module: ModuleDef, row?: Row | null) {
  const values: FormValues = {};
  for (const f of module.fields) {
    const val = row?.[f.key] ?? f.default ?? "";
    values[f.key] = f.key === "active" ? (val === true || val === 1 || val === "1" ? "1" : "0") : f.type === "money" ? val === "" ? "" : (Number(val) / 100).toFixed(2).replace(".", ",") : f.type === "datetime" ? datetimeInput(val) : val === "today" ? today() : String(val ?? "");
  }
  return values;
}
export function EntityForm({ module, row, options, user, onClose, onSaved }: { module: ModuleDef; row?: Row | null; options: Options; user: Viewer; onClose: () => void; onSaved: () => void }) {
  const [values, setValues] = useState<FormValues>(() => initialValues(module, row));
  const [items, setItems] = useState<EditableItem[]>(() => row?.items?.map((i: EntityItem) => ({ ...i, unit_cost_cents: i.unit_cost_cents != null ? (Number(i.unit_cost_cents) / 100).toFixed(2).replace(".", ",") : "" })) || (module.items ? [newItem(module.items)] : []));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [review, setReview] = useState(false);
  const formId = useId();
  const saleKey = useRef(crypto.randomUUID());
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  const fields: FieldDef[] = module.fields.filter(f => (row ? !f.createOnly : !f.editOnly) && !(f.key === "password" && row?.role === "super_admin"));
  if (row && module.key === "expenses" && (row.status === "paid" || values.status === "cancelled")) fields.push({ key: "reason", label: "Motivo da alteração", type: "textarea", required: true, span: true, help: "Explique a alteração financeira. O motivo será preservado na auditoria." });
  function update(key: string, value: string) { setValues(v => ({ ...v, [key]: value })); setDirty(true); setErrors(e => { const next = { ...e }; delete next[key]; return next; }); setError(""); }
  function close() { if (busy) return; if (dirty) setDiscard(true); else onClose(); }
  function buildPayload() {
    const next: Record<string, unknown> = row ? { version: row.version } : module.key === "sales" ? { idempotencyKey: saleKey.current } : {};
    const errs: Record<string, string> = {};
    for (const f of fields) {
      const v = String(values[f.key] ?? "").trim();
      if (f.required && !v) { errs[f.key] = "Preencha este campo."; continue; }
      if (f.type === "password" && !f.required && !v) continue;
      if (f.key === "reason" && v.length < 3) errs[f.key] = "Descreva o motivo com pelo menos 3 caracteres.";
      if (f.type === "password" && v && v.length < 10) errs[f.key] = "Use pelo menos 10 caracteres.";
      if (f.type === "email" && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errs[f.key] = "Informe um e-mail completo, como nome@exemplo.com.";
      if (f.type === "money") {
        if (!v && !f.required) { next[f.key] = null; continue; }
        const cents = currencyToCents(v);
        if (cents === null || cents < (f.min || 0)) errs[f.key] = `Informe um valor válido${f.min ? " maior que zero" : ""}, com até 2 casas decimais.`;
        else next[f.key] = cents;
      } else if (f.type === "number") {
        if (!v) next[f.key] = null;
        else { const n = Number(v.replace(",", ".")); if (!Number.isFinite(n) || (f.min != null && n < f.min) || (f.max != null && n > f.max) || (!f.step && !Number.isInteger(n))) errs[f.key] = `Informe ${f.step ? "um número" : "um número inteiro"}${f.min != null ? ` a partir de ${f.min}` : ""}${f.max != null ? ` e até ${f.max}` : ""}.`; else next[f.key] = n; }
      } else if (f.type === "datetime") {
        const parsed = new Date(v + "-03:00");
        if (v && !Number.isFinite(parsed.getTime())) errs[f.key] = "Informe data e horário válidos.";
        else next[f.key] = v ? parsed.toISOString() : null;
      } else if (f.type === "date") {
        if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errs[f.key] = "Informe uma data válida.";
        next[f.key] = v || null;
      } else if (f.key === "active") next[f.key] = v === "1";
      else if (f.source) next[f.key] = v || null;
      else next[f.key] = v;
    }
    if (module.items) {
      if (!items.length) errs.items = "Adicione pelo menos um item.";
      next.items = items.map((item, index) => {
        const i = index + 1;
        if (module.items === "workout") {
          if (!item.exercise_id || !String(item.reps || "").trim() || !String(item.day || "").trim()) errs.items = `Complete exercício, dia e repetições do item ${i}.`;
          if (!Number.isInteger(Number(item.sets)) || Number(item.sets) < 1 || Number(item.sets) > 20 || !Number.isInteger(Number(item.rest_seconds)) || Number(item.rest_seconds) < 0 || Number(item.rest_seconds) > 1200) errs.items = `Confira séries e descanso do item ${i}.`;
          return { exercise_id: item.exercise_id, day: String(item.day || "").toUpperCase(), sets: Number(item.sets), reps: String(item.reps || ""), load: String(item.load || ""), rest_seconds: Number(item.rest_seconds), notes: String(item.notes || "") };
        }
        if (!item.product_id || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1) errs.items = `Selecione o produto e uma quantidade inteira positiva no item ${i}.`;
        if (module.items === "purchase") {
          const cents = currencyToCents(String(item.unit_cost_cents ?? ""));
          if (cents === null) errs.items = `Informe o custo unitário do item ${i}.`;
          return { product_id: item.product_id, quantity: Number(item.quantity), unit_cost_cents: cents };
        }
        return { product_id: item.product_id, quantity: Number(item.quantity) };
      });
      if (module.items !== "workout" && new Set(items.map(item => item.product_id)).size !== items.length) errs.items = "Cada produto deve aparecer uma vez. Ajuste a quantidade na mesma linha.";
    }
    return { payload: next, errors: errs };
  }
  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    const result = buildPayload();
    if (Object.keys(result.errors).length) {
      setErrors(result.errors);
      setError("Revise os campos destacados para continuar.");
      setTimeout(() => document.getElementById(formId)?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 30);
      return;
    }
    const sensitive = module.key === "users" || module.key === "sales" || (row && module.key === "expenses" && values.status !== row.status) || (row && module.key === "classes" && values.status === "cancelled" && row.status !== "cancelled") || (row && values.status === "inactive" && row.status !== "inactive");
    if (sensitive && !review) { setReview(true); return; }
    setBusy(true); setError("");
    try {
      await api(`/${module.key}${row ? `/${row.id}` : ""}`, { method: row ? "PATCH" : "POST", body: JSON.stringify(result.payload) });
      setDirty(false); notify(`${module.singular.charAt(0).toUpperCase() + module.singular.slice(1)} ${row ? "atualizado" : "cadastrado"} com sucesso.`, "success"); onSaved();
    } catch (err: unknown) {
      setError(errorMessage(err, "A alteração não foi salva. Confira os dados e tente novamente."));
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setReview(false);
    } finally { setBusy(false); }
  }
  const modalTitle = row ? `Editar ${module.singular}` : module.createLabel || `Novo ${module.singular}`;
  return <>
    <Modal open title={modalTitle} description={row ? "As alterações serão aplicadas ao registro existente." : "Preencha os dados para salvar um novo registro."} onClose={close} wide={!!module.items || fields.length > 7} busy={busy} footer={<><span className="vg-form-footnote">* Campos obrigatórios</span><Button onClick={close} disabled={busy}>Cancelar</Button><Button type="submit" form={formId} variant="primary" busy={busy}>Salvar {module.singular}</Button></>}>
      <form id={formId} noValidate onSubmit={save}>
        <fieldset disabled={busy} className="vg-form-fieldset">
        {error && <ErrorState message={error} compact />}
        {module.key === "memberships" && !row && <InfoStrip>A matrícula preserva o preço do plano contratado e gera a primeira cobrança automaticamente.</InfoStrip>}
        {module.key === "products" && !row && <InfoStrip>O produto começa com estoque zero. Use “Ajustar estoque” ou receba uma compra para adicionar unidades.</InfoStrip>}
        {module.key === "users" && <InfoStrip>As permissões são determinadas pelo perfil. Alterações de perfil ou desativação encerram as sessões dessa conta.</InfoStrip>}
        {module.key === "assessments" && <InfoStrip>Registre medições verificadas pelo profissional responsável. O sistema organiza o histórico do aluno.</InfoStrip>}
        {module.key === "sales" && <InfoStrip>A confirmação registra o recebimento e baixa os produtos do estoque. O preço utilizado é o preço atual do cadastro.</InfoStrip>}
        <div className="vg-form-grid">
          {fields.map(f => <Field key={f.key} label={f.label} required={f.required} error={errors[f.key]} help={f.help} className={f.span ? "vg-span-full" : ""}>
            {f.type === "textarea" ? <Textarea className="resize-none" name={f.key} value={values[f.key] || ""} onChange={e => update(f.key, e.target.value)} maxLength={4000} /> : f.type === "select" ? <Select name={f.key} value={values[f.key] ?? ""} onChange={e => update(f.key, e.target.value)} disabled={!!row && (f.immutable || ((module.key === "workouts" || module.key === "assessments") && f.key === "student_id") || (module.key === "users" && row.id === user.id && ["role", "active"].includes(f.key)))}>
              <option value="">{f.required ? "Selecione…" : "Não informado"}</option>{optionsFor(f, options, user).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              {values[f.key] && !optionsFor(f, options, user).some(o => o.value === String(values[f.key])) && <option value={values[f.key]}>{String(row?.[f.key.replace("_id", "_name")] || "Vínculo atual")}</option>}
            </Select> : f.type === "password" ? <div className="vg-password-wrap"><Input name={f.key} type={reveal ? "text" : "password"} value={values[f.key] || ""} autoComplete="new-password" onChange={e => update(f.key, e.target.value)} /><button type="button" aria-label={reveal ? "Ocultar senha" : "Mostrar senha"} aria-pressed={reveal} onClick={() => setReveal(!reveal)} className="vg-password-toggle">{reveal ? <EyeOff size={17} /> : <Eye size={17} />}</button></div> : <Input name={f.key} type={f.type === "datetime" ? "datetime-local" : f.type === "money" ? "text" : f.type || "text"} inputMode={f.type === "money" ? "decimal" : undefined} value={values[f.key] ?? ""} onChange={e => update(f.key, e.target.value)} min={f.min} max={f.max} step={f.step || (f.type === "number" ? "1" : undefined)} maxLength={f.type === "email" ? 254 : 500} autoComplete={f.key === "email" ? "email" : f.key === "name" ? "name" : f.type === "tel" ? "tel" : "off"} />}
          </Field>)}
        </div>
        {module.items && <ItemsEditor kind={module.items} items={items} options={options} error={errors.items} onChange={value => { setItems(value); setDirty(true); setErrors(e => { const n = { ...e }; delete n.items; return n; }); }} />}
        </fieldset>
      </form>
    </Modal>
    <Modal open={discard} title="Descartar alterações?" description="Os campos que você alterou ainda não foram salvos." onClose={() => setDiscard(false)} footer={<><Button onClick={() => setDiscard(false)} autoFocus>Continuar editando</Button><Button variant="danger" onClick={onClose}>Descartar alterações</Button></>}><p className="vg-muted">O registro no sistema será mantido como estava.</p></Modal>
    <Modal open={review} title={module.key === "users" ? "Confirmar acesso" : module.key === "sales" ? "Confirmar venda" : "Confirmar alteração"} description={module.key === "users" ? `O perfil selecionado para ${values.name} será aplicado após a confirmação.` : module.key === "sales" ? "Esta operação registra a venda e movimenta o estoque." : "Esta alteração afeta o estado do registro."} onClose={() => !busy && setReview(false)} busy={busy} footer={<><Button onClick={() => setReview(false)} disabled={busy} autoFocus>Revisar</Button><Button variant="primary" busy={busy} onClick={() => save()}>Confirmar e salvar</Button></>}>
      <div className="vg-review"><strong>{module.key === "users" ? optionsFor({key:"role",label:"",options:[{value:"super_admin",label:"Proprietário"},{value:"admin",label:"Administrador"},{value:"manager",label:"Gerente"},{value:"reception",label:"Recepção"},{value:"trainer",label:"Professor"},{value:"personal",label:"Personal"},{value:"finance",label:"Financeiro"}]},options).find(o=>o.value===values.role)?.label : module.key === "sales" ? `${items.length} produto(s)` : values.description || values.name}</strong><p>{module.key === "users" ? values.login : "A operação ficará registrada na auditoria."}</p></div>
    </Modal>
  </>;
}
function newItem(kind: string): EditableItem { return kind === "workout" ? { exercise_id: "", day: "A", sets: 3, reps: "12", load: "", rest_seconds: 60, notes: "" } : { product_id: "", quantity: 1, unit_cost_cents: "" }; }
function ItemsEditor({ kind, items, options, error, onChange }: { kind: "workout" | "purchase" | "sale"; items: EditableItem[]; options: Options; error?: string; onChange: (items: EditableItem[]) => void }) {
  function update(index: number, key: string, value: string) {
    onChange(items.map((item, i) => {
      if (i !== index) return item;
      const updated = { ...item, [key]: value };
      if (key === "product_id" && kind === "purchase") { const product = options.products?.find(p => p.id === value); if (product?.cost_cents != null) updated.unit_cost_cents = (Number(product.cost_cents) / 100).toFixed(2).replace(".", ","); }
      return updated;
    }));
  }
  const total = kind === "workout" ? 0 : items.reduce((sum, item) => sum + (kind === "purchase" ? currencyToCents(String(item.unit_cost_cents)) || 0 : Number(options.products?.find(p => p.id === item.product_id)?.price_cents || 0)) * Number(item.quantity || 0), 0);
  return <section className="vg-items-editor"><div className="vg-section-heading"><div><h3>{kind === "workout" ? "Exercícios da ficha" : "Produtos da operação"}</h3><p>{kind === "workout" ? "Organize a sequência por dia de treino." : "Selecione produtos já cadastrados no estoque."}</p></div><Button onClick={() => onChange([...items, newItem(kind)])} disabled={items.length >= 100} icon={<Plus size={15} />}>Adicionar item</Button></div>
    {error && <p role="alert" className="vg-field-error">{error}</p>}
    {items.map((item, index) => <div className="vg-item-editor" key={index}><div className="vg-item-editor-head"><span>{kind === "workout" ? "Exercício" : "Produto"} {index + 1}</span><button type="button" className="vg-icon-button" onClick={() => onChange(items.filter((_, i) => i !== index))} aria-label={`Remover item ${index + 1}`}><Trash2 size={15} /></button></div><div className={kind === "workout" ? "vg-workout-item-grid" : "vg-commerce-item-grid"}>
      <Field label={kind === "workout" ? "Exercício" : "Produto"} required><Select value={kind === "workout" ? item.exercise_id : item.product_id} onChange={e => update(index, kind === "workout" ? "exercise_id" : "product_id", e.target.value)}><option value="">Selecione…</option>{(kind === "workout" ? options.exercises || [] : options.products || []).map(o => <option value={o.id} key={o.id}>{o.name}{kind === "sale" ? ` · ${formatMoney(o.price_cents)} · ${o.stock} un.` : ""}</option>)}</Select></Field>
      {kind === "workout" ? <><Field label="Dia" required><Input value={item.day} maxLength={12} onChange={e => update(index, "day", e.target.value)} /></Field><Field label="Séries" required><Input type="number" min="1" max="20" value={item.sets} onChange={e => update(index,"sets",e.target.value)} /></Field><Field label="Repetições" required><Input value={item.reps} maxLength={40} onChange={e => update(index,"reps",e.target.value)} /></Field><Field label="Carga"><Input placeholder="Ex.: 20 kg" value={item.load} maxLength={40} onChange={e => update(index,"load",e.target.value)} /></Field><Field label="Descanso (s)" required><Input type="number" min="0" max="1200" value={item.rest_seconds} onChange={e => update(index,"rest_seconds",e.target.value)} /></Field><Field label="Orientação" className="vg-span-full"><Input value={item.notes || ""} onChange={e => update(index,"notes",e.target.value)} maxLength={500} /></Field></> : <><Field label="Quantidade" required><Input type="number" min="1" max="10000" value={item.quantity} onChange={e => update(index,"quantity",e.target.value)} /></Field>{kind === "purchase" ? <Field label="Custo unitário (R$)" required><Input inputMode="decimal" value={item.unit_cost_cents} onChange={e => update(index,"unit_cost_cents",e.target.value)} /></Field> : <div className="vg-item-subtotal"><span>Subtotal</span><strong>{formatMoney(Number(options.products?.find(p => p.id === item.product_id)?.price_cents || 0) * Number(item.quantity || 0))}</strong></div>}</>}
    </div></div>)}
    {kind !== "workout" && <div className="vg-operation-total"><span>Total da operação</span><strong>{formatMoney(total)}</strong></div>}
  </section>;
}
