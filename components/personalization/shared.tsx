'use client';
/* Historic assets require the authenticated visitor's direct request. */
/* eslint-disable @next/next/no-img-element */

import { useEffect } from 'react';
import { roleLabels } from '@/lib/api';
import { NAV_NAMES } from '@/lib/navigation';
import { DynamicIcon } from '../Shell';

export const PERSONALIZATION_LABELS: Record<string, string> = {
  name: 'Nome do tema', kind: 'Classificação',
  gymName: 'Nome da academia', tagline: 'Mensagem da marca', font: 'Fonte', sidebarPosition: 'Posição do menu',
  iconStyle: 'Traço dos ícones', iconOverrides: 'Ícones das páginas', accentColor: 'Cor de destaque', backgroundColor: 'Fundo do tema escuro',
  lightBackgroundColor: 'Fundo do tema claro', themeMode: 'Tema', cornerStyle: 'Formato dos cantos', logoAssetId: 'Logo principal',
  logoDarkAssetId: 'Logo para tema escuro', logoLightAssetId: 'Logo para tema claro', logoLayout: 'Formato da logo', showGymName: 'Exibir nome junto da logo',
  faviconAssetId: 'Ícone da aba', wallpaperAssetId: 'Papel de parede', wallpaperOpacity: 'Intensidade do papel de parede', wallpaperPosition: 'Enquadramento do papel de parede',
  loginImageAssetId: 'Imagem do login', loginImagePosition: 'Enquadramento do login', loginLayout: 'Layout do login', loginTitle: 'Título da imagem no login',
  loginSubtitle: 'Mensagem da imagem no login', loginWelcomeTitle: 'Boas-vindas do login', loginWelcomeMessage: 'Descrição do login', accessGraceDays: 'Dias de carência',
  roleDefaults: 'Preferências por perfil', sidebarMode: 'Largura do menu', tableDensity: 'Espaçamento das tabelas', textScale: 'Tamanho dos textos',
  reducedMotion: 'Movimento na interface', reducedTransparency: 'Reduzir transparências', homePage: 'Página ao entrar', favorites: 'Páginas favoritas',
};

export function useUnsavedPersonalization(dirty: boolean) {
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    const beforeNavigate = (event: Event) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('vg:before-navigate', beforeNavigate);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('vg:before-navigate', beforeNavigate); };
  }, [dirty]);
}

export function changedKeys(before: object, after: object) {
  const left = before as Record<string, unknown>, right = after as Record<string, unknown>;
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].filter(key => JSON.stringify(left[key]) !== JSON.stringify(right[key]));
}

export function mergeDraft<T extends object>(baseline: T, draft: T, latest: T): T {
  const merged = { ...latest } as Record<string, unknown>;
  const source = draft as Record<string, unknown>;
  for (const key of changedKeys(baseline, draft)) {
    if (source[key] === undefined) delete merged[key]; else merged[key] = source[key];
  }
  return merged as T;
}

function humanValue(key: string, value: unknown): string {
  if (value === undefined) return 'Seguir padrão';
  if (value === null) return 'Imagem padrão / nenhuma seleção';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (key.endsWith('AssetId')) return 'Imagem personalizada';
  if (key === 'favorites' && Array.isArray(value)) return value.length ? value.map(page => NAV_NAMES[String(page)] || page).join(', ') : 'Nenhuma favorita';
  if (key === 'homePage') return NAV_NAMES[String(value)] || String(value);
  if (key === 'textScale') return `${value}%`;
  if (key === 'wallpaperOpacity') return `${Math.round(Number(value) * 100)}%`;
  if (key === 'iconOverrides' && value && typeof value === 'object') return `${Object.keys(value).length} ícone(s) personalizado(s)`;
  if (key === 'roleDefaults' && value && typeof value === 'object') return `${Object.keys(value).length} perfil(is) configurado(s)`;
  const labels: Record<string, string> = { theme: 'Tema reutilizável', draft: 'Rascunho', dark: 'Escuro', light: 'Claro', system: 'Dispositivo', left: 'Esquerda', right: 'Direita', expanded: 'Expandido', compact: 'Compacto', comfortable: 'Confortável', reduce: 'Reduzido', outline: 'Traço leve', solid: 'Traço marcante', soft: 'Suaves', square: 'Retos', symbol: 'Símbolo', horizontal: 'Horizontal', split: 'Imagem e formulário', centered: 'Formulário centralizado', top: 'Topo', center: 'Centro', bottom: 'Base', manrope: 'Manrope', inter: 'Inter' };
  return labels[String(value)] || String(value);
}

function ComparedValue({ name, value }: { name: string; value: unknown }) {
  if (name.endsWith('AssetId') && typeof value === 'string') return <span className="vg-p-compared-image"><img src={`/api/assets/${value}`} alt="Imagem desta versão" loading="lazy" /><span>Imagem personalizada</span></span>;
  if (name === 'iconOverrides' && value && typeof value === 'object') return <span>{Object.keys(value).length ? Object.entries(value).map(([page, icon]) => <span className="vg-p-compared-item vg-p-compared-icon" key={page}><DynamicIcon name={String(icon)} size={14} />{NAV_NAMES[page] || page}</span>) : 'Ícones originais'}</span>;
  if (name === 'roleDefaults' && value && typeof value === 'object') return <span>{Object.keys(value).length ? Object.entries(value).map(([role, preferences]) => <span className="vg-p-compared-item" key={role}><strong>{roleLabels[role] || role}</strong>{preferences && typeof preferences === 'object' && Object.entries(preferences).map(([key, current]) => <span className="vg-p-compared-item" key={key}>{PERSONALIZATION_LABELS[key] || key}: {humanValue(key, current)}</span>)}</span>) : 'Todos seguem a academia'}</span>;
  return <span>{humanValue(name, value)}</span>;
}

export function ChangesComparison({ before, after, beforeLabel = 'Publicada agora', afterLabel = 'Sua escolha' }: {
  before: object; after: object; beforeLabel?: string; afterLabel?: string;
}) {
  const keys = changedKeys(before, after);
  return keys.length ? <div className="vg-p-comparison"><div className="vg-p-comparison-head"><span>Configuração</span><span>{beforeLabel}</span><span>{afterLabel}</span></div>{keys.map(key => <div className="vg-p-comparison-row" key={key}><strong>{PERSONALIZATION_LABELS[key] || key}</strong><ComparedValue name={key} value={(before as Record<string, unknown>)[key]} /><ComparedValue name={key} value={(after as Record<string, unknown>)[key]} /></div>)}</div> : <p className="vg-p-muted">As configurações comparadas são iguais.</p>;
}
