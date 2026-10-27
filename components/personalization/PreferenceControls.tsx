'use client';

import { ArrowDown, ArrowUp, Star, X } from 'lucide-react';
import { type AppUser } from '@/lib/api';
import { type GymSettings, type PageKey, type PreferenceValues, type Role, type UserPreferences, resolvePreferences } from '@/lib/personalization';
import { NAV_NAMES, canVisit, roleAllowedPages } from '@/lib/navigation';
import { Button, Field, Select } from '../ui';

export function PreferenceControls({ value, onChange, settings, user, role, disabled = false, roleDefaults = false }: {
  value: UserPreferences; onChange: (value: UserPreferences) => void; settings: GymSettings;
  user: AppUser; role: string; disabled?: boolean; roleDefaults?: boolean;
}) {
  const inherited = resolvePreferences(settings, roleDefaults ? undefined : role);
  const resolved = { ...inherited, ...value };
  const pages = roleDefaults ? roleAllowedPages(role as Role) : (Object.keys(NAV_NAMES) as PageKey[]).filter(key => canVisit(user, key));
  const unavailable = resolved.favorites.filter(key => !pages.includes(key));
  const invalidHome = !pages.includes(resolved.homePage);
  const inheritLabel = roleDefaults ? 'Usar padrão da academia' : 'Seguir padrão do meu perfil';
  function set<K extends keyof PreferenceValues>(key: K, next: PreferenceValues[K] | undefined) {
    const updated = { ...value };
    if (next === undefined) delete updated[key]; else updated[key] = next;
    onChange(updated);
  }
  function moveFavorite(index: number, direction: number) {
    const next = [...resolved.favorites];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    set('favorites', next);
  }
  return <fieldset className="vg-p-fieldset" disabled={disabled}>
    {(unavailable.length > 0 || invalidHome) && <div className="vg-p-update-notice" role="status"><p>Algumas páginas escolhidas antes não estão mais disponíveis para este perfil. Retire esses atalhos antes de salvar novas preferências.</p><Button onClick={() => { const next = { ...value, favorites: resolved.favorites.filter(key => pages.includes(key)) }; if (invalidHome) delete next.homePage; onChange(next); }}>Ajustar páginas disponíveis</Button></div>}
    <div className="vg-settings-field-grid">
      <Field label="Tema"><Select value={value.themeMode ?? ''} onChange={e => set('themeMode', e.target.value ? e.target.value as PreferenceValues['themeMode'] : undefined)}><option value="">{inheritLabel}</option><option value="dark">Escuro</option><option value="light">Claro</option><option value="system">Automático · acompanhar dispositivo</option></Select></Field>
      <Field label="Fonte"><Select value={value.font ?? ''} onChange={e => set('font', e.target.value ? e.target.value as PreferenceValues['font'] : undefined)}><option value="">{inheritLabel}</option><option value="manrope">Manrope</option><option value="inter">Inter</option><option value="system">Fonte do dispositivo</option></Select></Field>
      <Field label="Posição do menu"><Select value={value.sidebarPosition ?? ''} onChange={e => set('sidebarPosition', e.target.value ? e.target.value as PreferenceValues['sidebarPosition'] : undefined)}><option value="">{inheritLabel}</option><option value="left">Esquerda</option><option value="right">Direita</option></Select></Field>
      <Field label="Largura do menu"><Select value={value.sidebarMode ?? ''} onChange={e => set('sidebarMode', e.target.value ? e.target.value as PreferenceValues['sidebarMode'] : undefined)}><option value="">{inheritLabel}</option><option value="expanded">Expandido · ícones e nomes</option><option value="compact">Compacto · mais espaço de trabalho</option></Select></Field>
      <Field label="Espaçamento das tabelas"><Select value={value.tableDensity ?? ''} onChange={e => set('tableDensity', e.target.value ? e.target.value as PreferenceValues['tableDensity'] : undefined)}><option value="">{inheritLabel}</option><option value="comfortable">Confortável</option><option value="compact">Compacto</option></Select></Field>
      <Field label="Tamanho dos textos"><Select value={value.textScale ?? ''} onChange={e => set('textScale', e.target.value ? Number(e.target.value) as PreferenceValues['textScale'] : undefined)}><option value="">{inheritLabel}</option><option value={100}>Padrão · 100%</option><option value={110}>Maior · 110%</option><option value={120}>Ampliado · 120%</option></Select></Field>
      <Field label="Movimento na interface"><Select value={value.reducedMotion ?? ''} onChange={e => set('reducedMotion', e.target.value ? e.target.value as PreferenceValues['reducedMotion'] : undefined)}><option value="">{inheritLabel}</option><option value="system">Respeitar preferência do dispositivo</option><option value="reduce">Reduzir animações</option></Select></Field>
      <Field label="Transparências e papel de parede"><Select value={value.reducedTransparency === undefined ? '' : value.reducedTransparency ? 'reduce' : 'normal'} onChange={e => set('reducedTransparency', e.target.value === '' ? undefined : e.target.value === 'reduce')}><option value="">{inheritLabel}</option><option value="normal">Manter aparência da academia</option><option value="reduce">Reduzir · priorizar leitura</option></Select></Field>
      <Field label="Página ao entrar"><Select value={value.homePage ?? ''} onChange={e => set('homePage', e.target.value ? e.target.value as PageKey : undefined)}><option value="">{inheritLabel}</option>{pages.map(key => <option key={key} value={key}>{NAV_NAMES[key]}</option>)}</Select></Field>
    </div>
    <div className="vg-p-favorites">
      <div className="vg-p-section-heading"><div><h3><Star size={16} /> Páginas favoritas</h3><p>Até oito atalhos. Use as setas para definir a ordem no menu.</p></div>{value.favorites !== undefined && <Button variant="ghost" onClick={() => set('favorites', undefined)}>Seguir padrão</Button>}</div>
      {!resolved.favorites.length && <p className="vg-p-muted">Nenhuma favorita selecionada.</p>}
      <ol>{resolved.favorites.map((key, index) => <li key={key}><span>{NAV_NAMES[key]}{!pages.includes(key) ? ' · indisponível' : ''}</span><div>
        <Button variant="ghost" aria-label={`Mover ${NAV_NAMES[key]} para cima`} title="Mover para cima" disabled={index === 0} onClick={() => moveFavorite(index, -1)}><ArrowUp size={15} /></Button>
        <Button variant="ghost" aria-label={`Mover ${NAV_NAMES[key]} para baixo`} title="Mover para baixo" disabled={index === resolved.favorites.length - 1} onClick={() => moveFavorite(index, 1)}><ArrowDown size={15} /></Button>
        <Button variant="ghost" aria-label={`Remover ${NAV_NAMES[key]} das favoritas`} title="Remover favorita" onClick={() => set('favorites', resolved.favorites.filter(item => item !== key))}><X size={15} /></Button>
      </div></li>)}</ol>
      <Field label="Adicionar página favorita"><Select value="" disabled={resolved.favorites.length >= 8} onChange={e => { if (e.target.value) set('favorites', [...resolved.favorites, e.target.value as PageKey]); }}><option value="">{resolved.favorites.length >= 8 ? 'Limite de oito favoritas atingido' : 'Escolha uma página'}</option>{pages.filter(key => !resolved.favorites.includes(key)).map(key => <option key={key} value={key}>{NAV_NAMES[key]}</option>)}</Select></Field>
      <p className="vg-p-muted">As preferências não concedem acesso a páginas. Cada pessoa continua vendo somente o que seu perfil permite.</p>
    </div>
  </fieldset>;
}
