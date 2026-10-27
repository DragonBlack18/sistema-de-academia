'use client';

import { useEffect, useRef, useState } from 'react';
import { Building2, History, Image as ImageIcon, LogIn, Palette, PanelLeft, RefreshCw, RotateCcw, Save, ShieldCheck, SlidersHorizontal, UserRound, Users } from 'lucide-react';
import { api, ApiError, errorMessage, notify, hasPermission, type AppUser, type GymSettings } from '@/lib/api';
import { DEFAULT_SETTINGS, appearanceOf, type AppearanceSettings, type Role, type SettingsHistoryEntry, type UserPreferences } from '@/lib/personalization';
import { Button, ConfirmDialog, ErrorState, LoadingState, Modal } from './ui';
import { AcademyFields, type AcademySection } from './personalization/AcademyFields';
import { PreferencesPanel } from './personalization/PreferencesPanel';
import { Security } from './personalization/Security';
import { AppearanceHistory, ThemeLibrary } from './personalization/ThemeLibrary';
import { ThemePreview } from './personalization/ThemePreview';
import { ChangesComparison, changedKeys, mergeDraft, useUnsavedPersonalization } from './personalization/shared';
import './personalization/personalization.css';

type SettingsEnvelope = { settings: GymSettings; version: number };
const academySections: { key: AcademySection; label: string; icon: typeof Palette }[] = [
  { key: 'brand', label: 'Marca', icon: ImageIcon }, { key: 'theme', label: 'Tema', icon: Palette },
  { key: 'navigation', label: 'Menu e ícones', icon: PanelLeft }, { key: 'login', label: 'Login', icon: LogIn },
  { key: 'profiles', label: 'Por perfil', icon: Users }, { key: 'themes', label: 'Temas salvos', icon: Save },
  { key: 'history', label: 'Histórico', icon: History }, { key: 'rules', label: 'Regras', icon: SlidersHorizontal },
];

export function Settings({ user, settings, preferences, preferencesVersion, onSaved, onPreferencesSaved, onPasswordChanged, onUserChanged }: {
  user: AppUser; settings: GymSettings; preferences: UserPreferences; preferencesVersion: number;
  onSaved: (settings: GymSettings, version: number) => void; onPreferencesSaved: (preferences: UserPreferences, version: number) => void;
  onPasswordChanged: () => void; onUserChanged: () => void;
}) {
  const canCustomize = hasPermission(user, 'settings.write');
  const [tab, setTab] = useState(canCustomize ? 'academy' : 'preferences');
  const [section, setSection] = useState<AcademySection>('brand');
  const [previewRole, setPreviewRole] = useState<Role>('reception');
  const [draft, setDraft] = useState(settings);
  const [baseline, setBaseline] = useState(settings);
  const [version, setVersion] = useState(1);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(canCustomize ? 'loading' : 'ready');
  const [loadError, setLoadError] = useState('');
  const [loadRevision, setLoadRevision] = useState(0);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState('');
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [reset, setReset] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [restore, setRestore] = useState<SettingsHistoryEntry | null>(null);
  const [restoreError, setRestoreError] = useState('');
  const [stageTheme, setStageTheme] = useState<{ settings: AppearanceSettings; name: string } | null>(null);
  const [conflict, setConflict] = useState<SettingsEnvelope | null>(null);
  const [remoteNotice, setRemoteNotice] = useState(false);
  const previousSettings = useRef(settings);
  const editorRef = useRef<HTMLDivElement>(null);
  const ready = canCustomize && status === 'ready';
  const changes = changedKeys(baseline, draft);
  const dirty = ready && changes.length > 0;
  const disabled = busy || !!uploading;
  useUnsavedPersonalization(dirty);

  useEffect(() => {
    if (!canCustomize) return;
    const controller = new AbortController();
    // A read establishes the authoritative version. Switching tabs never reloads this resource.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus('loading'); setLoadError('');
    api<SettingsEnvelope>('/settings', { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      setDraft(result.settings); setBaseline(result.settings); setVersion(result.version); setStatus('ready');
    }).catch((cause: unknown) => { if (!controller.signal.aborted) { setLoadError(errorMessage(cause)); setStatus('error'); } });
    return () => controller.abort();
  }, [canCustomize, user.id, loadRevision]);

  useEffect(() => {
    if (previousSettings.current === settings) return;
    previousSettings.current = settings;
    // A cross-session refresh may update the live shell, but must not replace editor input.
    setRemoteNotice(changedKeys(baseline, settings).length > 0);
  }, [settings, baseline]);

  useEffect(() => {
    if (Object.keys(fields).length) editorRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [fields, section]);

  function change(patch: Partial<GymSettings>) {
    if (!ready || busy) return;
    setDraft(current => ({ ...current, ...patch }));
    setFields(current => Object.fromEntries(Object.entries(current).filter(([key]) => !Object.keys(patch).some(field => key === field || key === `settings.${field}`))));
  }
  function accepted(result: SettingsEnvelope) {
    setDraft(result.settings); setBaseline(result.settings); setVersion(result.version); setError(''); setFields({});
    setRemoteNotice(false); setHistoryRevision(value => value + 1); onSaved(result.settings, result.version);
  }
  async function readConflict() {
    try { setConflict(await api<SettingsEnvelope>('/settings')); }
    catch (cause: unknown) { setError(errorMessage(cause)); }
  }
  async function compareLatest() { if (disabled) return; setBusy(true); await readConflict(); setBusy(false); }

  function validate() {
    const errors: Record<string, string> = {};
    if (draft.gymName.trim().length < 2) errors.gymName = 'Informe um nome com pelo menos dois caracteres.';
    if (!draft.loginTitle.trim()) errors.loginTitle = 'Informe o título que acompanha a imagem.';
    if (!draft.loginWelcomeTitle.trim()) errors.loginWelcomeTitle = 'Informe um título de boas-vindas.';
    if (Object.keys(errors).length) {
      setFields(errors); setSection(errors.gymName ? 'brand' : 'login'); setError('Confira os campos destacados antes de salvar.'); return false;
    }
    return true;
  }
  async function save() {
    if (!ready || disabled || !dirty || !validate()) return;
    setBusy(true); setError(''); setFields({});
    try {
      const patch = Object.fromEntries(changes.map(key => [key, draft[key as keyof GymSettings]]));
      const result = await api<SettingsEnvelope>('/settings', { method: 'PATCH', body: { version, settings: patch } });
      accepted(result); notify('Personalização salva para toda a academia.');
    } catch (cause: unknown) {
      setError(errorMessage(cause));
      if (cause instanceof ApiError) {
        setFields(cause.fields || {});
        if (cause.status === 409) await readConflict();
      }
    } finally { setBusy(false); }
  }
  async function restoreVersion() {
    if (!restore || disabled) return;
    setBusy(true); setRestoreError('');
    try {
      const result = await api<SettingsEnvelope>(`/settings/history/${restore.version}/restore`, { method: 'POST', body: { version } });
      accepted(result); setRestore(null); notify('Aparência restaurada. Uma nova versão foi criada no histórico.');
    } catch (cause: unknown) {
      setRestoreError(errorMessage(cause));
      if (cause instanceof ApiError && cause.status === 409) { setRestore(null); setError(errorMessage(cause)); await readConflict(); }
    } finally { setBusy(false); }
  }

  return <section className="vg-personalization">
    <div className="vg-page-header"><div><p className="vg-eyebrow">DO SEU JEITO</p><h1>Configurações</h1><p>A identidade da academia. Um espaço de trabalho para cada pessoa.</p></div>{canCustomize && tab === 'academy' && <Button variant="primary" busy={busy} disabled={!ready || !dirty || !!uploading} icon={<Save size={16} />} onClick={save}>Salvar personalização</Button>}</div>
    <nav className="vg-settings-tabs vg-p-main-tabs" aria-label="Áreas de configurações">
      {canCustomize && <button type="button" aria-pressed={tab === 'academy'} className={tab === 'academy' ? 'is-active' : ''} onClick={() => setTab('academy')}><Building2 size={17} />Personalizar academia{dirty && <span className="vg-p-unsaved-dot" aria-label="Alterações não salvas" />}</button>}
      <button type="button" aria-pressed={tab === 'preferences'} className={tab === 'preferences' ? 'is-active' : ''} onClick={() => setTab('preferences')}><UserRound size={17} />Minhas preferências</button>
      <button type="button" aria-pressed={tab === 'security'} className={tab === 'security' ? 'is-active' : ''} onClick={() => setTab('security')}><ShieldCheck size={17} />Segurança</button>
    </nav>
    {canCustomize && <div className="vg-p-tab-panel" hidden={tab !== 'academy'}>
      <div className="vg-p-scope"><Building2 size={20} /><div><strong>Identidade compartilhada</strong><p>A marca e as opções desta área valem para toda a academia. Ajustes individuais ficam em Minhas preferências.</p></div><span className="vg-p-version">Versão {version}</span></div>
      <nav className="vg-p-section-nav" aria-label="Personalização da academia">{academySections.map(item => <button type="button" key={item.key} aria-pressed={section === item.key} className={section === item.key ? 'is-active' : ''} onClick={() => setSection(item.key)}><item.icon size={15} />{item.label}</button>)}</nav>
      {status === 'loading' ? <LoadingState label="Carregando personalização salva..." /> : status === 'error' ? <ErrorState message={loadError} onRetry={() => setLoadRevision(value => value + 1)} /> : <>
        {remoteNotice && <div className="vg-p-update-notice" role="status"><p>A academia foi atualizada em outra sessão. Suas edições nesta tela continuam preservadas.</p><Button disabled={disabled} onClick={compareLatest}>Comparar atualização</Button></div>}
        {error && <ErrorState message={error} compact />}
        <div className="vg-p-save-row"><p aria-live="polite">{uploading ? 'Enviando imagem. Aguarde para salvar.' : dirty ? `${changes.length} ${changes.length === 1 ? 'configuração alterada' : 'configurações alteradas'} na prévia.` : 'A prévia corresponde à versão carregada.'}</p><Button variant="ghost" disabled={!dirty || disabled} onClick={() => setDiscard(true)}>Descartar alterações</Button></div>
        <div ref={editorRef} className={`vg-p-editor-layout ${['history', 'themes'].includes(section) ? 'vg-p-editor-layout--wide' : ''}`}>
          <div className="vg-p-editor-content">{section === 'themes' ? <ThemeLibrary draft={draft} disabled={disabled} onLoad={(appearance, name) => setStageTheme({ settings: appearance, name })} /> : section === 'history' ? <AppearanceHistory current={baseline} currentVersion={version} revision={historyRevision} busy={disabled} onRestore={entry => { setRestoreError(''); setRestore(entry); }} /> : <AcademyFields section={section} draft={draft} user={user} onChange={change} busy={busy} uploading={uploading} setUploading={setUploading} onError={setError} fields={fields} role={previewRole} onRoleChange={setPreviewRole} />}</div>
          {!['history', 'themes'].includes(section) && <ThemePreview settings={draft} role={section === 'profiles' ? previewRole : undefined} />}
        </div>
        <div className="vg-p-bottom-actions"><Button variant="ghost" icon={<RotateCcw size={16} />} disabled={disabled} onClick={() => setReset(true)}>Restaurar aparência original</Button><Button variant="primary" icon={<Save size={16} />} disabled={!dirty || !!uploading} busy={busy} onClick={save}>Salvar personalização</Button></div>
      </>}
    </div>}
    <div className="vg-p-tab-panel" hidden={tab !== 'preferences'}><PreferencesPanel user={user} settings={settings} preferences={preferences} preferencesVersion={preferencesVersion} onSaved={onPreferencesSaved} /></div>
    <div className="vg-p-tab-panel" hidden={tab !== 'security'}><Security user={user} onPasswordChanged={onPasswordChanged} onUserChanged={onUserChanged} /></div>
    <ConfirmDialog open={reset} onCancel={() => setReset(false)} onConfirm={() => { setDraft(current => ({ ...current, ...appearanceOf(DEFAULT_SETTINGS), gymName: current.gymName, tagline: current.tagline })); setReset(false); }} title="Restaurar aparência original?" description="Cores, fonte, ícones, imagens e login voltarão ao padrão Vitality na prévia. O nome, a mensagem da marca, as regras e os padrões por perfil serão preservados. Salve depois para aplicar." confirmLabel="Restaurar na prévia" />
    <ConfirmDialog open={discard} onCancel={() => setDiscard(false)} onConfirm={() => { setDraft(baseline); setFields({}); setError(''); setDiscard(false); }} title="Descartar alterações da academia?" description="A prévia voltará à versão carregada por último. As imagens enviadas continuam disponíveis na biblioteca." confirmLabel="Descartar alterações" />
    <Modal open={!!stageTheme} onClose={() => setStageTheme(null)} title={`Abrir ${stageTheme?.name || 'tema'} na prévia?`} description="A aparência deste tema substituirá as escolhas visuais da prévia. Regras da academia e padrões por perfil serão preservados. Salve a personalização depois para aplicar." wide footer={<><Button onClick={() => setStageTheme(null)}>Cancelar</Button><Button variant="primary" onClick={() => { if (!stageTheme) return; setDraft(current => ({ ...current, ...stageTheme.settings })); setStageTheme(null); setSection('theme'); notify('Tema carregado na prévia. Revise antes de salvar.', 'info'); }}>Abrir na prévia</Button></>}>
      {stageTheme && <ChangesComparison before={appearanceOf(draft)} after={stageTheme.settings} beforeLabel="Prévia atual" afterLabel="Tema selecionado" />}
    </Modal>
    <ConfirmDialog open={!!restore} onCancel={() => setRestore(null)} onConfirm={restoreVersion} busy={busy} error={restoreError} title={`Restaurar aparência da versão ${restore?.version || ''}?`} description={`A aparência será aplicada à academia e registrada como uma nova versão. Regras de acesso e padrões por perfil serão preservados.${dirty ? ' Suas alterações ainda não salvas nesta tela serão descartadas.' : ''}`} confirmLabel="Restaurar e aplicar">
      {restore && <ChangesComparison before={appearanceOf(baseline)} after={appearanceOf(restore.settings)} afterLabel={`Versão ${restore.version}`} />}
    </ConfirmDialog>
    <Modal open={!!conflict} onClose={() => setConflict(null)} title="A configuração mudou em outra sessão" description="Compare a versão atual com suas edições. Nenhuma escolha desta tela foi perdida." wide footer={<><Button onClick={() => setConflict(null)}>Continuar revisando</Button><Button icon={<RefreshCw size={15} />} onClick={() => { if (!conflict) return; accepted(conflict); setConflict(null); }}>Usar versão publicada</Button><Button variant="primary" onClick={() => { if (!conflict) return; setDraft(mergeDraft(baseline, draft, conflict.settings)); setBaseline(conflict.settings); setVersion(conflict.version); onSaved(conflict.settings, conflict.version); setConflict(null); setError(''); setRemoteNotice(false); notify('Edições combinadas com a versão atual. Revise a prévia e salve.', 'info'); }}>Combinar minhas edições</Button></>}>
      {conflict && <><ChangesComparison before={conflict.settings} after={mergeDraft(baseline, draft, conflict.settings)} /><p className="vg-p-muted">A combinação mantém os campos que você alterou. Se um mesmo campo mudou nas duas sessões, sua escolha nesta tela prevalece na prévia. Nada é publicado automaticamente.</p></>}
    </Modal>
  </section>;
}
