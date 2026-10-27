'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

let csrfToken = '';
let authEpoch = 0;
export const setCsrfToken = (token: string) => { if (csrfToken !== token) authEpoch += 1; csrfToken = token; };
export class ApiError extends Error {
  constructor(message: string, public status: number, public fields?: Record<string, string>, public code?: string) { super(message); }
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function errorMessage(error: unknown, fallback = 'Não foi possível concluir a operação. Tente novamente.'): string {
  if (error instanceof Error && error.message) return error.message;
  if (isRecord(error) && typeof error.message === 'string' && error.message) return error.message;
  return fallback;
}
function errorFields(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return entries.length ? Object.fromEntries(entries) : undefined;
}
export async function api<T = unknown>(path: string, options: Omit<RequestInit, 'body'> & { body?: unknown } = {}): Promise<T> {
  const requestEpoch = authEpoch;
  const url = path.startsWith('/api/') ? path : `/api${path.startsWith('/') ? '' : '/'}${path}`;
  const headers = new Headers(options.headers);
  const body = options.body;
  let payload: BodyInit | undefined;
  if (body instanceof FormData || typeof body === 'string' || body instanceof Blob) payload = body;
  else if (body !== undefined) payload = JSON.stringify(body);
  if (payload !== undefined && !(body instanceof FormData) && !(body instanceof Blob)) headers.set('Content-Type', 'application/json');
  if (options.method && options.method.toUpperCase() !== 'GET' && csrfToken) headers.set('X-CSRF-Token', csrfToken);
  let response: Response;
  try {
    response = await fetch(url, { ...options, headers, body: payload, credentials: 'same-origin', cache: 'no-store' });
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('Sem conexão com o servidor. Verifique sua internet e tente novamente.', 0);
  }
  const content: unknown = await response.json().catch(() => ({ error: 'O servidor retornou uma resposta inesperada.' }));
  // Ignore late data/401s from a former session, including after a different account signs in.
  if (options.signal?.aborted || requestEpoch !== authEpoch) throw new DOMException('A sessão desta solicitação foi substituída.', 'AbortError');
  const envelope = isRecord(content) ? content : {};
  if (!response.ok) {
    if (response.status === 401 && !url.endsWith('/login') && !url.endsWith('/me')) window.dispatchEvent(new Event('vg:unauthorized'));
    throw new ApiError(typeof envelope.error === 'string' ? envelope.error : 'Não foi possível concluir a operação.', response.status, errorFields(envelope.fields), typeof envelope.code === 'string' ? envelope.code : undefined);
  }
  if (typeof envelope.csrfToken === 'string') setCsrfToken(envelope.csrfToken);
  return content as T;
}
export function useApi<T = unknown>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const sequence = useRef(0);
  const reload = useCallback(() => setRevision(n => n + 1), []);
  useEffect(() => {
    const seq = ++sequence.current;
    if (!path) {
      // A disabled permission-scoped resource must discard its previous result immediately.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setData(null);
      setError(null); setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true); setError(null);
    api<T>(path, { signal: controller.signal })
      .then(value => { if (seq === sequence.current && !controller.signal.aborted) setData(value); })
      .catch((error: unknown) => { if (seq === sequence.current && !controller.signal.aborted) setError(errorMessage(error)); })
      .finally(() => { if (seq === sequence.current && !controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, revision]);
  return { data, loading, error, reload, setData };
}
export function notify(message:string,type:'success'|'error'|'info'='success'){if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('vg:toast',{detail:{message,type}}));}
export type AppUser={id:string;name:string;login:string;role:string;active:boolean;permissions:string[];mustChangePassword?:boolean;totpEnabled?:boolean;version?:number};
export type { GymSettings } from './personalization';
export { DEFAULT_SETTINGS as DEFAULT_THEME } from './personalization';
export function hasPermission(user:AppUser,permission:string){return user.permissions.includes('*')||user.permissions.includes(permission);}
export const roleLabels:Record<string,string>={super_admin:'Proprietário',admin:'Administrador',manager:'Gerente',reception:'Recepção',finance:'Financeiro',trainer:'Professor',personal:'Personal trainer'};
