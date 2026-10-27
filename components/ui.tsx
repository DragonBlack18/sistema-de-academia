"use client";

import { Children, cloneElement, isValidElement, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { AlertCircle, Check, ChevronLeft, ChevronRight, Inbox, LoaderCircle, RefreshCw, X } from "lucide-react";

export type Tone = "primary" | "secondary" | "ghost" | "danger";
export function Button({ variant = "secondary", busy, icon, children, className = "", disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Tone; busy?: boolean; icon?: ReactNode }) {
  return <button type="button" {...props} disabled={disabled || busy} aria-busy={busy || undefined} className={`vg-button vg-button--${variant} ${className}`}>
    {busy ? <LoaderCircle className="vg-spin" size={16} aria-hidden="true" /> : icon}{children}
  </button>;
}

function attachFirstControl(node: ReactNode, attributes: Record<string, unknown>): { node: ReactNode; attached: boolean } {
  if (!isValidElement(node)) return { node, attached: false };
  const el = node as ReactElement<Record<string, unknown>>;
  const control = el.type === "input" || el.type === "select" || el.type === "textarea" || el.type === Input || el.type === Select || el.type === Textarea;
  if (control) return { node: cloneElement(el, attributes), attached: true };
  const children: ReactNode[] = [];
  let attached = false;
  for (const child of Children.toArray(el.props.children as ReactNode)) {
    const result: { node: ReactNode; attached: boolean } = attached ? { node: child, attached: true } : attachFirstControl(child, attributes);
    children.push(result.node);
    attached = result.attached;
  }
  return { node: attached ? cloneElement(el, {}, children) : el, attached };
}
export function Field({ label, id, required, error, help, children, className = "" }: { label: string; id?: string; required?: boolean; error?: string; help?: string; children: ReactNode; className?: string }) {
  const autoId = useId();
  const child = Children.only(children);
  const childProps = isValidElement(child) ? child.props as Record<string, unknown> : {};
  const fieldId = id || String(childProps.id || autoId);
  const descriptions = [help && `${fieldId}-help`, error && `${fieldId}-error`].filter(Boolean).join(" ") || undefined;
  const field = attachFirstControl(child, { id: fieldId, "aria-invalid": !!error, "aria-describedby": descriptions, "aria-required": required || undefined });
  return <div className={`vg-field ${className}`}>
    <label htmlFor={fieldId}>{label}{required && <span className="vg-required" aria-hidden="true"> *</span>}</label>
    {field.node}
    {help && <span className="vg-field-help" id={`${fieldId}-help`}>{help}</span>}
    {error && <span className="vg-field-error" id={`${fieldId}-error`}>{error}</span>}
  </div>;
}
export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={`vg-input ${className}`} />; }
export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className={`vg-input vg-select ${className}`}>{children}</select>; }
export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea rows={4} {...props} style={{ resize: "none", ...props.style }} className={`vg-input vg-textarea resize-none ${className}`} />; }

export function Modal({ open, onClose, title, description, children, footer, wide = false, busy = false, className = "" }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer?: ReactNode; wide?: boolean; busy?: boolean; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    return () => { if (dialog.open) dialog.close(); };
  }, [open]);
  return <dialog ref={ref} aria-labelledby={titleId} aria-describedby={description ? descId : undefined} className={`vg-modal ${wide ? "vg-modal--wide" : ""} ${className}`} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="vg-modal-head"><div><h2 id={titleId}>{title}</h2>{description && <p id={descId}>{description}</p>}</div><button type="button" className="vg-icon-button" aria-label="Fechar janela" onClick={onClose} disabled={busy}><X size={19} /></button></header>
    <div className="vg-modal-body">{children}</div>
    {footer && <footer className="vg-modal-footer">{footer}</footer>}
  </dialog>;
}

export function ConfirmDialog({ open, title, description, confirmLabel = "Confirmar", onConfirm, onCancel, busy, error, danger = false, children }: { open: boolean; title: string; description: string; confirmLabel?: string; onConfirm: () => void; onCancel: () => void; busy?: boolean; error?: string; danger?: boolean; children?: ReactNode }) {
  return <Modal open={open} onClose={onCancel} title={title} description={description} busy={busy} footer={<><Button onClick={onCancel} disabled={busy} autoFocus>Voltar</Button><Button variant={danger ? "danger" : "primary"} busy={busy} onClick={onConfirm}>{confirmLabel}</Button></>}>
    {children}{error && <ErrorState message={error} compact />}
  </Modal>;
}

const statuses: Record<string, [string, string]> = {
  active: ["Ativo", "success"], inactive: ["Inativo", "neutral"], suspended: ["Suspenso", "warning"], cancelled: ["Cancelado", "neutral"], canceled: ["Cancelado", "neutral"], expired: ["Encerrado", "neutral"], archived: ["Arquivado", "neutral"],
  paid: ["Pago", "success"], pending: ["Pendente", "warning"], open: ["Em aberto", "warning"], overdue: ["Em atraso", "danger"], refunded: ["Estornado", "neutral"], received: ["Recebido", "success"], completed: ["Concluído", "success"], draft: ["Rascunho", "neutral"],
  scheduled: ["Agendada", "info"], new: ["Novo", "info"], contacted: ["Em contato", "info"], trial: ["Experimental", "warning"], qualified: ["Qualificado", "warning"], converted: ["Convertido", "success"], lost: ["Perdido", "neutral"],
  allowed: ["Permitido", "success"], denied: ["Negado", "danger"], inside: ["Na academia", "success"], outside: ["Finalizado", "neutral"], info: ["Informação", "info"], warning: ["Atenção", "warning"], success: ["Sucesso", "success"], urgent: ["Urgente", "danger"],
  super_admin: ["Proprietário", "success"], admin: ["Administrador", "info"], manager: ["Gerente", "info"], reception: ["Recepção", "neutral"], finance: ["Financeiro", "neutral"], trainer: ["Professor", "neutral"], personal: ["Personal", "neutral"],
};
export function statusLabel(value: unknown) { const v = String(value ?? ""); return statuses[v]?.[0] || v || "—"; }
export function Badge({ status, children, tone, className = "" }: { status?: unknown; children?: ReactNode; tone?: string; className?: string }) {
  const match = statuses[String(status ?? "")];
  return <span className={`vg-badge vg-badge--${tone || match?.[1] || "neutral"} ${className}`}><span className="vg-badge-dot" aria-hidden="true" />{children ?? match?.[0] ?? String(status ?? "—")}</span>;
}
export function EmptyState({ title = "Nada por aqui ainda", description = "Os registros aparecerão aqui assim que forem cadastrados.", action, icon }: { title?: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return <div className="vg-empty"><div className="vg-empty-icon">{icon || <Inbox size={25} />}</div><h3>{title}</h3><p>{description}</p>{action}</div>;
}
export function LoadingState({ label = "Carregando informações…", compact = false }: { label?: string; compact?: boolean }) {
  return <div role="status" className={`vg-loading ${compact ? "vg-loading--compact" : ""}`}><LoaderCircle size={21} className="vg-spin" aria-hidden="true" /><span>{label}</span></div>;
}
export function ErrorState({ message, onRetry, compact = false }: { message: string; onRetry?: () => void; compact?: boolean }) {
  return <div role="alert" className={`vg-error ${compact ? "vg-error--compact" : ""}`}><AlertCircle size={19} aria-hidden="true" /><div><strong>Não foi possível concluir</strong><p>{message}</p>{onRetry && <Button onClick={onRetry} icon={<RefreshCw size={14} />}>Tentar novamente</Button>}</div></div>;
}
export function formatMoney(value: unknown) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0) / 100); }
export function formatDate(value: unknown, withTime = false) {
  if (!value) return "—";
  const raw = String(value);
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00-03:00` : raw);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "short", year: withTime ? undefined : "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(date);
}
export function Money({ value }: { value: unknown }) { return <span className="vg-number">{formatMoney(value)}</span>; }
export function DateText({ value, time }: { value: unknown; time?: boolean }) { return <span>{formatDate(value, time)}</span>; }
export function Pagination({ total, page, pageSize, onPageChange, onPageSizeChange, busy }: { total: number; page: number; pageSize: number; onPageChange: (page: number) => void; onPageSizeChange?: (size: number) => void; busy?: boolean }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <footer className="vg-pagination"><p>{total ? `${(page - 1) * pageSize + 1}–${Math.min(total, page * pageSize)} de ${total} registros` : "0 registros"}</p><div>{onPageSizeChange && <label className="vg-page-size">Por página <select className="vg-input" value={pageSize} onChange={e => onPageSizeChange(Number(e.target.value))}><option value={10}>10</option><option value={20}>20</option><option value={50}>50</option></select></label>}<button type="button" className="vg-icon-button" onClick={() => onPageChange(page - 1)} disabled={busy || page <= 1} aria-label="Página anterior"><ChevronLeft size={17} /></button><span className="vg-page-number">{page} / {pages}</span><button type="button" className="vg-icon-button" onClick={() => onPageChange(page + 1)} disabled={busy || page >= pages} aria-label="Próxima página"><ChevronRight size={17} /></button></div></footer>;
}
export function SectionHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) { return <div className="vg-section-heading"><div><h3>{title}</h3>{description && <p>{description}</p>}</div>{action}</div>; }
export function InfoStrip({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warning" | "success" }) { return <div className={`vg-info-strip vg-info-strip--${tone}`}>{tone === "success" ? <Check size={17} /> : <AlertCircle size={17} />}<span>{children}</span></div>; }
