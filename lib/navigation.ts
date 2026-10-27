import type { AppUser } from './api';
import { MODULES } from './modules';
import { PAGE_KEYS, type PageKey, type Role } from './personalization';

export const SLUGS: Record<string, string> = { dashboard: 'dashboard', students: 'alunos', staff: 'equipe', plans: 'planos', memberships: 'matriculas', invoices: 'financeiro', expenses: 'despesas', attendance: 'frequencia', workouts: 'treinos', exercises: 'exercicios', assessments: 'avaliacoes', classes: 'aulas', products: 'estoque', suppliers: 'fornecedores', purchases: 'compras', sales: 'vendas', leads: 'crm', notifications: 'notificacoes', users: 'acessos', audit: 'auditoria', 'access-events': 'controle-de-acesso', reports: 'relatorios', settings: 'configuracoes' };
export const NAV_NAMES: Record<string, string> = { dashboard: 'Visão geral', reports: 'Relatórios', settings: 'Configurações', ...Object.fromEntries(MODULES.map(m => [m.key, m.label])) };
export const NAV_ICONS: Record<string, string> = { dashboard: 'LayoutDashboard', reports: 'ChartNoAxesCombined', settings: 'Settings2', ...Object.fromEntries(MODULES.map(m => [m.key, m.icon])) };
export const NAV_GROUPS = [{ label: 'VISÃO GERAL', keys: ['dashboard', 'reports'] }, { label: 'OPERAÇÃO', keys: ['students', 'memberships', 'plans', 'attendance', 'classes'] }, { label: 'TREINAMENTO', keys: ['workouts', 'exercises', 'assessments', 'staff'] }, { label: 'NEGÓCIO', keys: ['invoices', 'expenses', 'products', 'sales', 'purchases', 'suppliers', 'leads'] }, { label: 'ADMINISTRAÇÃO', keys: ['notifications', 'users', 'access-events', 'audit', 'settings'] }];
export function canVisit(user: AppUser, key: string): boolean {
  if (!Object.hasOwn(SLUGS, key)) return false;
  if (key === 'settings') return true;
  const permission = key === 'dashboard' ? 'dashboard.read' : key === 'reports' ? 'reports.read' : MODULES.find(m => m.key === key)?.permission;
  return !!permission && (user.permissions.includes('*') || user.permissions.includes(permission));
}
/** Presentation filter only. The API independently enforces the authoritative role permissions. */
export function roleAllowedPages(role: Role): PageKey[] {
  if (role === 'super_admin' || role === 'admin') return [...PAGE_KEYS];
  const pages: Record<Exclude<Role, 'super_admin' | 'admin'>, string[]> = {
    manager: PAGE_KEYS.filter(key => !['users', 'audit'].includes(key)),
    reception: ['dashboard', 'settings', 'students', 'plans', 'memberships', 'attendance', 'classes', 'workouts', 'exercises', 'leads', 'notifications', 'access-events'],
    finance: ['dashboard', 'settings', 'students', 'plans', 'memberships', 'invoices', 'expenses', 'reports', 'notifications'],
    trainer: ['dashboard', 'settings', 'students', 'workouts', 'exercises', 'assessments', 'classes', 'attendance', 'notifications', 'access-events'],
    personal: ['dashboard', 'settings', 'students', 'workouts', 'exercises', 'assessments', 'classes', 'attendance', 'notifications', 'access-events'],
  };
  return PAGE_KEYS.filter(key => pages[role].includes(key));
}
export function fromPath(): PageKey {
  if (typeof window === 'undefined') return 'dashboard';
  const slug = window.location.pathname.split('/')[1];
  return (Object.keys(SLUGS) as PageKey[]).find(key => SLUGS[key] === slug) || 'dashboard';
}
export function landingPage(user: AppUser, preferred: PageKey): PageKey {
  if (typeof window !== 'undefined') {
    const page = fromPath();
    if (window.location.pathname !== '/' && window.location.pathname !== '/login' && canVisit(user, page)) return page;
  }
  return canVisit(user, preferred) ? preferred : 'dashboard';
}
