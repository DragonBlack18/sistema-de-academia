'use client';

import { useState, useSyncExternalStore } from 'react';
import { Monitor, Smartphone, ShieldCheck } from 'lucide-react';
import { type GymSettings, type UserPreferences, resolvePreferences } from '@/lib/personalization';
import { NAV_ICONS, NAV_NAMES } from '@/lib/navigation';
import { buildTheme } from '@/lib/theme';
import { Brand } from '../Brand';
import { DynamicIcon } from '../Shell';

function subscribeTheme(callback: () => void) {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}

export function ThemePreview({ settings, preferences = {}, role, compact = false }: {
  settings: GymSettings; preferences?: UserPreferences; role?: string; compact?: boolean;
}) {
  const [screen, setScreen] = useState<'dashboard' | 'table' | 'login'>('dashboard');
  const [mobile, setMobile] = useState(false);
  const systemDark = useSyncExternalStore(subscribeTheme, () => window.matchMedia('(prefers-color-scheme: dark)').matches, () => true);
  const resolved = resolvePreferences(settings, role, preferences);
  const theme = buildTheme(settings, resolved, systemDark);
  const image = settings.loginImageAssetId ? `/api/assets/${settings.loginImageAssetId}` : '/assets/gym.jpg';
  return <aside className={`vg-p-preview-wrap ${compact ? 'vg-p-preview-wrap--compact' : ''}`} aria-label="Prévia da personalização">
    <div className="vg-p-preview-heading"><span className="vg-eyebrow">ANTES DE APLICAR</span><div className="vg-p-device-options"><button type="button" onClick={() => setMobile(false)} aria-pressed={!mobile} aria-label="Prévia no computador" title="Computador"><Monitor size={16} /></button><button type="button" onClick={() => setMobile(true)} aria-pressed={mobile} aria-label="Prévia no celular" title="Celular"><Smartphone size={16} /></button></div></div>
    <div className="vg-p-preview-screens" aria-label="Tela da prévia">{[{ key: 'dashboard', label: 'Visão geral' }, { key: 'table', label: 'Tabela' }, { key: 'login', label: 'Login' }].map(item => <button type="button" key={item.key} aria-pressed={screen === item.key} onClick={() => setScreen(item.key as typeof screen)}>{item.label}</button>)}</div>
    <div className={`vg-p-preview ${mobile ? 'vg-p-preview--mobile' : ''} ${resolved.sidebarMode === 'compact' ? 'vg-p-preview--compact-menu' : ''}`} data-theme={theme.mode} style={theme.style}>
      {settings.wallpaperAssetId && !resolved.reducedTransparency && screen !== 'login' && <div className="vg-p-preview-wallpaper" style={{ backgroundImage: `url(/api/assets/${settings.wallpaperAssetId})`, backgroundPosition: settings.wallpaperPosition, opacity: settings.wallpaperOpacity }} />}
      {screen === 'login' ? <div className={`vg-p-preview-login ${settings.loginLayout === 'centered' ? 'is-centered' : ''}`} style={settings.loginLayout === 'centered' ? { backgroundImage: `linear-gradient(0deg, #10121199, #10121155), url(${image})`, backgroundPosition: settings.loginImagePosition } : undefined}>
        {settings.loginLayout === 'split' && !mobile && <div className="vg-p-preview-story" style={{ backgroundImage: `linear-gradient(0deg, #101211ed, #10121150), url(${image})`, backgroundPosition: settings.loginImagePosition }}><Brand settings={settings} compact mode="dark" /><strong>{settings.loginTitle}</strong><p>{settings.loginSubtitle}</p></div>}
        <div className="vg-p-preview-login-form"><Brand settings={settings} mode={theme.mode} /><h3>{settings.loginWelcomeTitle}</h3><p>{settings.loginWelcomeMessage}</p><span>E-mail ou acesso</span><div className="vg-p-preview-input">seu.acesso@exemplo.com</div><span>Senha</span><div className="vg-p-preview-input">••••••••••</div><span className="vg-p-preview-submit">Entrar na academia</span><small><ShieldCheck size={11} /> Acesso protegido</small></div>
      </div> : <div className={`vg-p-preview-shell vg-p-preview-shell--${resolved.sidebarPosition}`}>
        <div className="vg-p-preview-sidebar"><Brand settings={settings} compact={mobile || resolved.sidebarMode === 'compact'} mode={theme.mode} />{(['dashboard', 'students', 'workouts', 'invoices', 'settings'] as const).map((key, index) => <div className={index === (screen === 'table' ? 1 : 0) ? 'is-active' : ''} key={key}><DynamicIcon name={settings.iconOverrides[key] || NAV_ICONS[key]} solid={settings.iconStyle === 'solid'} size={15} /><span>{NAV_NAMES[key]}</span></div>)}</div>
        <div className="vg-p-preview-main"><span className="vg-p-preview-context">{settings.gymName}</span><h3>{screen === 'table' ? 'Alunos' : 'Visão geral'}</h3><p>{settings.tagline}</p>{screen === 'table' ? <div className={`vg-p-preview-table ${resolved.tableDensity === 'compact' ? 'is-compact' : ''}`}><div><strong>Aluno</strong><strong>Situação</strong></div>{['Aluno exemplo 01', 'Aluno exemplo 02', 'Aluno exemplo 03'].map(name => <div key={name}><span>{name}</span><span className="vg-p-preview-status">Ativo</span></div>)}</div> : <><div className="vg-p-preview-cards"><div><span>Alunos ativos</span><strong>128</strong></div><div><span>Na academia</span><strong>24</strong></div></div><div className="vg-p-preview-chart"><span>Frequência da semana</span><svg viewBox="0 0 220 85" role="img" aria-label="Exemplo ilustrativo de gráfico de frequência"><path d="M0 75 L31 57 L63 62 L95 29 L126 42 L158 17 L190 30 L220 8" fill="none" stroke="var(--accent-visible)" strokeWidth="3" /></svg></div></>}</div>
      </div>}
    </div>
    <p className="vg-p-preview-caption">Prévia com dados ilustrativos · tema {theme.mode === 'dark' ? 'escuro' : 'claro'}. Nenhuma alteração foi aplicada ainda.</p>
    {!compact && <div className="vg-p-preview-notes"><ShieldCheck size={16} /><p>Contraste dos textos e ícones de destaque nos painéis: <strong>{theme.accentContrast.toFixed(2)}:1</strong>.{theme.accentAdjusted ? ' O tom foi ajustado para manter a leitura.' : ' Cores de texto e painéis acompanham o tema.'}</p></div>}
  </aside>;
}
