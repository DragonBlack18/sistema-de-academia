'use client';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { api, ApiError, errorMessage, AppUser, GymSettings, DEFAULT_THEME, setCsrfToken, notify } from '@/lib/api';
import { resolvePreferences, type UserPreferences } from '@/lib/personalization';
import { buildTheme } from '@/lib/theme';
import { PreferenceContext } from '@/lib/preference-context';
import { SLUGS, NAV_NAMES, fromPath, landingPage } from '@/lib/navigation';
import { Shell } from './Shell';
import { Login } from './Login';
import { Dashboard } from './Dashboard';
import { Settings } from './Settings';
import { ModulePage } from './Modules';
import { LoadingState, ErrorState, ConfirmDialog, Button } from './ui';

type Session = { user: AppUser; settings: GymSettings; settingsVersion: number; preferences: UserPreferences; preferencesVersion: number };
const EMPTY_PREFERENCES: UserPreferences = {};
const subscribeTheme = (changed: () => void) => { const media = window.matchMedia('(prefers-color-scheme: dark)'); media.addEventListener('change', changed); return () => media.removeEventListener('change', changed); };
const getSystemTheme = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [branding, setBranding] = useState({ settings: DEFAULT_THEME, version: 0 });
  const [module, setModule] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingNavigation, setPending] = useState<string | null>(null);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [preferencesBusy, setPreferencesBusy] = useState(false);
  const systemDark = useSyncExternalStore(subscribeTheme, getSystemTheme, () => true);
  const preferenceLock = useRef<symbol | null>(null);
  const historyIndex = useRef(0);
  const correctingHistory = useRef(false);
  const acceptedHistory = useRef(false);
  const pendingHistory = useRef<{ index: number; module: string } | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const refreshRequest = useRef<AbortController | null>(null);
  const user = session?.user ?? null;
  const settings = session?.settings ?? branding.settings;
  const userId = user?.id;
  const preferences = session?.preferences ?? EMPTY_PREFERENCES;
  const resolved = useMemo(() => resolvePreferences(settings, user?.role, preferences), [settings, user?.role, preferences]);
  const theme = useMemo(() => buildTheme(settings, resolved, systemDark), [settings, resolved, systemDark]);

  const expireSession = useCallback(() => {
    refreshRequest.current?.abort(); preferenceLock.current = null; setPreferencesBusy(false);
    pendingHistory.current = null; acceptedHistory.current = false; correctingHistory.current = false;
    setPending(null); setLogoutConfirm(false); setLogoutBusy(false);
    setSession(null); setCsrfToken('');
    setNotice('Sua sessão terminou. Entre novamente para continuar.');
  }, []);
  const initialize = useCallback(async () => {
    const controller = new AbortController();
    refreshRequest.current?.abort(); refreshRequest.current = controller;
    try {
      const b = await api<{ settings: Partial<GymSettings> }>('/branding', { signal: controller.signal });
      if (controller.signal.aborted) return;
      setBranding({ settings: { ...DEFAULT_THEME, ...b.settings }, version: 0 });
      try {
        const r = await api<Session>('/me', { signal: controller.signal });
        if (controller.signal.aborted) return;
        const complete = { ...r, settings: { ...DEFAULT_THEME, ...r.settings }, preferences: r.preferences ?? {}, preferencesVersion: r.preferencesVersion ?? 0 };
        setSession(complete); setBranding({ settings: complete.settings, version: complete.settingsVersion });
        const preferred = resolvePreferences(complete.settings, r.user.role, complete.preferences).homePage;
        const page = landingPage(r.user, preferred); setModule(page);
        if (['/', '/login'].includes(window.location.pathname)) window.history.replaceState({ ...window.history.state }, '', `/${SLUGS[page]}`);
      } catch (e: unknown) {
        if (controller.signal.aborted) return;
        if (!(e instanceof ApiError) || e.status !== 401) throw e;
        setSession(null); setCsrfToken('');
      }
    } catch (e: unknown) { if (!controller.signal.aborted) setError(errorMessage(e)); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    // Initial state is populated only by awaited server responses.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void initialize();
    historyIndex.current = Number.isInteger(window.history.state?.vgIndex) ? window.history.state.vgIndex : 0;
    window.history.replaceState({ ...window.history.state, vgIndex: historyIndex.current }, '', window.location.href);
    const onPop = () => {
      if (correctingHistory.current) { correctingHistory.current = false; return; }
      const nextIndex = Number.isInteger(window.history.state?.vgIndex) ? window.history.state.vgIndex : historyIndex.current - 1;
      const nextModule = fromPath();
      if (!acceptedHistory.current) {
        const event = new Event('vg:before-navigate', { cancelable: true }); window.dispatchEvent(event);
        if (event.defaultPrevented && nextIndex !== historyIndex.current) {
          pendingHistory.current = { index: nextIndex, module: nextModule }; setPending(nextModule);
          correctingHistory.current = true; window.history.go(historyIndex.current - nextIndex); return;
        }
      }
      acceptedHistory.current = false; historyIndex.current = nextIndex; pendingHistory.current = null;
      setPending(null); setModule(nextModule);
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('vg:unauthorized', expireSession);
    return () => { refreshRequest.current?.abort(); window.removeEventListener('popstate', onPop); window.removeEventListener('vg:unauthorized', expireSession); };
  }, [initialize, expireSession]);

  useEffect(() => {
    if (!userId) return;
    const refresh = async () => {
      if (document.visibilityState !== 'visible' || preferenceLock.current) return;
      refreshRequest.current?.abort();
      const controller = new AbortController(); refreshRequest.current = controller;
      try {
        const r = await api<Session>('/me', { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (r.user.id !== userId) { expireSession(); return; }
        setSession(current => current && current.user.id === userId ? {
          ...current, user: r.user.version && r.user.version >= (current.user.version ?? 0) ? r.user : current.user,
          ...(r.settingsVersion >= current.settingsVersion ? { settings: { ...DEFAULT_THEME, ...r.settings }, settingsVersion: r.settingsVersion } : {}),
          ...(r.preferencesVersion >= current.preferencesVersion ? { preferences: r.preferences ?? {}, preferencesVersion: r.preferencesVersion ?? 0 } : {}),
        } : current);
        setBranding(current => r.settingsVersion >= current.version ? { settings: { ...DEFAULT_THEME, ...r.settings }, version: r.settingsVersion } : current);
      } catch (e) { if (!controller.signal.aborted && e instanceof ApiError && e.status === 401) expireSession(); }
    };
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    let broadcast: BroadcastChannel | null = null;
    try {
      broadcast = new BroadcastChannel('vg-personalization'); channel.current = broadcast;
      broadcast.onmessage = event => { if (event.data === 'logout') expireSession(); else if (event.data === 'refresh') void refresh(); };
    } catch { /* Focus refresh is available when BroadcastChannel is unavailable. */ }
    // Deliberately no polling: idle sessions must still expire.
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); broadcast?.close(); if (channel.current === broadcast) channel.current = null; refreshRequest.current?.abort(); };
  }, [userId, expireSession]);

  useEffect(() => {
    document.title = `${user ? (NAV_NAMES[module] || 'Academia') : 'Entrar'} · ${settings.gymName}`;
    let favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!favicon) { favicon = document.createElement('link'); favicon.rel = 'icon'; document.head.appendChild(favicon); }
    favicon.href = settings.faviconAssetId ? `/api/assets/${encodeURIComponent(settings.faviconAssetId)}` : '/favicon.svg';
  }, [user, module, settings.gymName, settings.faviconAssetId]);
  useEffect(() => {
    for (const [key, value] of Object.entries(theme.style)) {
      if (key.startsWith('--')) document.documentElement.style.setProperty(key, String(value));
    }
    document.documentElement.style.colorScheme = theme.mode;
    document.documentElement.dataset.theme = theme.mode;
  }, [theme.mode, theme.style]);

  function go(key: string, force = false) {
    if (!Object.hasOwn(SLUGS, key)) return;
    if (key === module && !(force && pendingHistory.current)) return;
    if (!force) {
      const event = new Event('vg:before-navigate', { cancelable: true }); window.dispatchEvent(event);
      if (event.defaultPrevented) { setPending(key); return; }
    }
    if (force && pendingHistory.current) {
      const target = pendingHistory.current; pendingHistory.current = null; acceptedHistory.current = true;
      setPending(null); window.history.go(target.index - historyIndex.current); return;
    }
    historyIndex.current += 1;
    window.history.pushState({ vgIndex: historyIndex.current }, '', `/${SLUGS[key as keyof typeof SLUGS]}`);
    setModule(key); window.scrollTo({ top: 0, behavior: 'instant' }); setPending(null);
  }
  function settingsSaved(value: GymSettings, version: number) {
    refreshRequest.current?.abort();
    setSession(current => current && current.user.id === userId && version >= current.settingsVersion ? { ...current, settings: value, settingsVersion: version } : current);
    setBranding(current => version >= current.version ? { settings: value, version } : current); channel.current?.postMessage('refresh');
  }
  function preferencesSaved(value: UserPreferences, version: number) {
    refreshRequest.current?.abort();
    setSession(current => current && current.user.id === userId && version >= current.preferencesVersion ? { ...current, preferences: value, preferencesVersion: version } : current);
    channel.current?.postMessage('refresh');
  }
  async function savePreferences(value: UserPreferences) {
    if (!session || preferenceLock.current) return;
    const operation = Symbol('preference-save'); preferenceLock.current = operation; setPreferencesBusy(true); refreshRequest.current?.abort();
    try {
      const result = await api<{ preferences: UserPreferences; version: number }>('/preferences', { method: 'PATCH', body: { preferences: value, version: session.preferencesVersion } });
      preferencesSaved(result.preferences, result.version); notify('Preferência salva na sua conta.');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const fresh = await api<{ preferences: UserPreferences; version: number }>('/preferences');
        preferencesSaved(fresh.preferences, fresh.version);
        throw new ApiError('Suas preferências mudaram em outra sessão. A versão atual foi carregada; confira antes de tentar novamente.', 409);
      }
      throw e;
    } finally { if (preferenceLock.current === operation) { preferenceLock.current = null; setPreferencesBusy(false); } }
  }
  async function loggedIn() {
    const r = await api<Session>('/me');
    const complete = { ...r, settings: { ...DEFAULT_THEME, ...r.settings }, preferences: r.preferences ?? {}, preferencesVersion: r.preferencesVersion ?? 0 };
    setSession(complete); setBranding({ settings: complete.settings, version: complete.settingsVersion }); setNotice('');
    const page = landingPage(r.user, resolvePreferences(complete.settings, r.user.role, complete.preferences).homePage);
    setModule(page); window.history.replaceState({ ...window.history.state }, '', `/${SLUGS[page]}`); channel.current?.postMessage('refresh');
  }
  async function logout() {
    setLogoutBusy(true);
    try {
      await api('/logout', { method: 'POST', body: {} });
      channel.current?.postMessage('logout'); refreshRequest.current?.abort(); preferenceLock.current = null; setPreferencesBusy(false);
      pendingHistory.current = null; acceptedHistory.current = false; correctingHistory.current = false; setPending(null);
      setSession(null); setCsrfToken(''); setNotice('Você saiu da conta com segurança.'); setLogoutConfirm(false);
      window.history.replaceState({ ...window.history.state }, '', '/login');
    } catch (e) { notify(errorMessage(e), 'error'); }
    finally { setLogoutBusy(false); }
  }
  const workspaceSettings = { ...settings, sidebarPosition: resolved.sidebarPosition };
  return <div className="vg-app-root" data-theme={theme.mode} data-reduced-motion={resolved.reducedMotion} data-reduced-transparency={resolved.reducedTransparency} data-corners={settings.cornerStyle} style={theme.style}>
    {settings.wallpaperAssetId && user && !resolved.reducedTransparency && <><div className="vg-app-wallpaper" style={{ backgroundImage: `url(/api/assets/${encodeURIComponent(settings.wallpaperAssetId)})`, backgroundPosition: settings.wallpaperPosition, opacity: settings.wallpaperOpacity }}/><div className="vg-background-contrast" aria-hidden="true"/></>}
    {loading ? <div className="vg-initial-loading"><LoadingState label="Preparando sua academia..."/></div> : error ? <div className="vg-initial-loading"><ErrorState message={error} onRetry={() => { setLoading(true); setError(''); void initialize(); }}/></div> : !user ? <Login settings={settings} mode={theme.mode} notice={notice} onLogin={loggedIn}/> : <PreferenceContext.Provider value={{ preferences, resolved, busy: preferencesBusy, save: savePreferences }}>
      <Shell user={user} settings={workspaceSettings} mode={theme.mode} module={module} onNavigate={go} onLogout={() => setLogoutConfirm(true)}>
        {user.mustChangePassword && <div className="vg-password-notice"><span>Seu acesso está usando uma senha inicial. Defina uma senha pessoal em Segurança.</span><Button variant="ghost" onClick={() => go('settings')}>Alterar senha</Button></div>}
        {module === 'dashboard' ? <Dashboard user={user} onNavigate={go}/> : module === 'settings' ? <Settings key={user.id} user={user} settings={settings} preferences={preferences} preferencesVersion={session?.preferencesVersion ?? 0} onPreferencesSaved={preferencesSaved} onSaved={settingsSaved} onPasswordChanged={() => { channel.current?.postMessage('logout'); expireSession(); setNotice('Senha alterada. Entre com sua nova senha.'); }} onUserChanged={() => { void api<Session>('/me').then(r => setSession(current => current && current.user.id === userId && r.user.id === userId && (r.user.version ?? 0) >= (current.user.version ?? 0) ? { ...current, user: r.user } : current)).catch(e => { if (!(e instanceof DOMException && e.name === 'AbortError')) notify(errorMessage(e), 'error'); }); }}/> : <ModulePage key={module} module={module} user={user} onNavigate={go}/>}
      </Shell>
    </PreferenceContext.Provider>}
    <Toasts/>
    <ConfirmDialog open={!!pendingNavigation} title="Sair sem salvar?" description="Você tem alterações de personalização que ainda não foram salvas." confirmLabel="Descartar e continuar" onCancel={() => { pendingHistory.current = null; setPending(null); }} onConfirm={() => pendingNavigation && go(pendingNavigation, true)}/>
    <ConfirmDialog open={logoutConfirm} title="Sair da sua conta?" description="Sua sessão será encerrada neste navegador. Alterações ainda não salvas serão descartadas." confirmLabel="Sair da conta" onCancel={() => setLogoutConfirm(false)} onConfirm={logout} busy={logoutBusy} danger={false}/>
  </div>;
}
function Toasts(){const [messages,setMessages]=useState<{id:number;message:string;type:string}[]>([]);useEffect(()=>{const timers:ReturnType<typeof setTimeout>[]=[];const listener=(e:Event)=>{const detail=(e as CustomEvent).detail;const id=Date.now()+Math.random();setMessages(prev=>[...prev.filter(m=>m.message!==detail.message).slice(-2),{...detail,id}]);timers.push(setTimeout(()=>setMessages(prev=>prev.filter(m=>m.id!==id)),6000));};window.addEventListener('vg:toast',listener);return()=>{window.removeEventListener('vg:toast',listener);timers.forEach(clearTimeout);};},[]);return <div className="vg-toast-region" aria-live="polite" aria-atomic="false">{messages.map(m=><div key={m.id} className={`vg-toast vg-toast--${m.type}`} role="status">{m.type==='error'?<AlertCircle size={18}/>:m.type==='info'?<Info size={18}/>:<CheckCircle2 size={18}/>}<span>{m.message}</span><button aria-label="Fechar mensagem" onClick={()=>setMessages(prev=>prev.filter(x=>x.id!==m.id))}><X size={15}/></button></div>)}</div>;}
