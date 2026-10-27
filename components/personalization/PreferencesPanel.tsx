'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, RotateCcw, Save, UserRound } from 'lucide-react';
import { api, ApiError, errorMessage, notify, roleLabels, type AppUser } from '@/lib/api';
import { type GymSettings, type UserPreferences } from '@/lib/personalization';
import { Button, ConfirmDialog, ErrorState, LoadingState, Modal } from '../ui';
import { PreferenceControls } from './PreferenceControls';
import { ThemePreview } from './ThemePreview';
import { ChangesComparison, changedKeys, mergeDraft, useUnsavedPersonalization } from './shared';

type PreferencesEnvelope = { preferences: UserPreferences; version: number };

export function PreferencesPanel({ user, settings, preferences, preferencesVersion, onSaved }: {
  user: AppUser; settings: GymSettings; preferences: UserPreferences; preferencesVersion: number;
  onSaved: (preferences: UserPreferences, version: number) => void;
}) {
  const [draft, setDraft] = useState(preferences);
  const [baseline, setBaseline] = useState(preferences);
  const [version, setVersion] = useState(preferencesVersion);
  const [ready, setReady] = useState(false);
  const [loadingError, setLoadingError] = useState('');
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reset, setReset] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [conflict, setConflict] = useState<PreferencesEnvelope | null>(null);
  const dirty = changedKeys(baseline, draft).length > 0;
  useUnsavedPersonalization(dirty);
  useEffect(() => {
    const controller = new AbortController();
    // Initial/retry reads establish the account-specific edit version; tab switches keep drafts mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(false); setLoadingError('');
    api<PreferencesEnvelope>('/preferences', { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      setDraft(result.preferences); setBaseline(result.preferences); setVersion(result.version); setReady(true);
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setLoadingError(errorMessage(cause)); });
    return () => controller.abort();
  }, [user.id, revision]);

  async function save() {
    if (!ready || busy || !dirty) return;
    setBusy(true); setError('');
    try {
      const result = await api<PreferencesEnvelope>('/preferences', { method: 'PATCH', body: { version, preferences: draft } });
      setDraft(result.preferences); setBaseline(result.preferences); setVersion(result.version);
      onSaved(result.preferences, result.version); notify('Suas preferências foram salvas na sua conta.');
    } catch (cause: unknown) {
      setError(errorMessage(cause));
      if (cause instanceof ApiError && cause.status === 409) {
        try { setConflict(await api<PreferencesEnvelope>('/preferences')); }
        catch { /* The original error remains visible; no edit is discarded. */ }
      }
    } finally { setBusy(false); }
  }

  async function compareLatest() {
    setBusy(true); setError('');
    try { setConflict(await api<PreferencesEnvelope>('/preferences')); }
    catch (cause: unknown) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  if (!ready) return loadingError ? <ErrorState message={loadingError} onRetry={() => setRevision(value => value + 1)} /> : <LoadingState label="Carregando suas preferências..." />;
  return <>
    <div className="vg-p-scope"><UserRound size={20} /><div><strong>Seu espaço, na sua conta</strong><p>Estas escolhas acompanham {user.name} em outros dispositivos. O padrão do perfil {roleLabels[user.role] || user.role} é usado nos campos que você deixar sem alteração.</p></div></div>
    {preferencesVersion > version && <div className="vg-p-update-notice" role="status"><p>Há preferências mais recentes salvas em outra sessão. Suas edições nesta tela continuam preservadas.</p><Button disabled={busy} onClick={compareLatest}>Comparar atualização</Button></div>}
    <div className="vg-p-save-row"><p aria-live="polite">{dirty ? 'Você tem preferências para salvar.' : 'Suas preferências estão salvas.'}</p><div><Button variant="ghost" disabled={busy || !dirty} onClick={() => setDiscard(true)}>Descartar alterações</Button><Button variant="primary" disabled={!dirty} busy={busy} icon={<Save size={16} />} onClick={save}>Salvar minhas preferências</Button></div></div>
    {error && <ErrorState message={error} compact />}
    <div className="vg-p-editor-layout"><section className="vg-panel vg-settings-section"><div className="vg-p-section-heading"><div><h2>Como você trabalha</h2><p>Conforto visual, navegação e atalhos. A identidade da academia continua preservada.</p></div></div>
      <PreferenceControls value={draft} onChange={setDraft} settings={settings} user={user} role={user.role} disabled={busy} />
      <Button variant="ghost" icon={<RotateCcw size={15} />} disabled={busy || !Object.keys(draft).length} onClick={() => setReset(true)}>Voltar aos padrões do meu perfil</Button>
    </section><ThemePreview settings={settings} preferences={draft} role={user.role} /></div>
    <ConfirmDialog open={reset} onCancel={() => setReset(false)} onConfirm={() => { setDraft({}); setReset(false); }} title="Usar os padrões do seu perfil?" description="Suas escolhas pessoais serão retiradas da prévia. Salve suas preferências depois para confirmar." confirmLabel="Usar padrões" />
    <ConfirmDialog open={discard} onCancel={() => setDiscard(false)} onConfirm={() => { setDraft(baseline); setError(''); setDiscard(false); }} title="Descartar alterações pessoais?" description="A prévia voltará às preferências que você carregou por último. Nada será alterado na academia." confirmLabel="Descartar alterações" />
    <Modal open={!!conflict} onClose={() => setConflict(null)} title="Suas preferências mudaram em outra sessão" description="Compare as escolhas antes de continuar. Suas edições continuam preservadas nesta tela." wide footer={<><Button onClick={() => setConflict(null)}>Continuar revisando</Button><Button icon={<RefreshCw size={15} />} onClick={() => { if (!conflict) return; setDraft(conflict.preferences); setBaseline(conflict.preferences); setVersion(conflict.version); onSaved(conflict.preferences, conflict.version); setConflict(null); setError(''); }}>Usar preferências salvas</Button><Button variant="primary" onClick={() => { if (!conflict) return; setDraft(mergeDraft(baseline, draft, conflict.preferences)); setBaseline(conflict.preferences); setVersion(conflict.version); setConflict(null); setError(''); notify('Suas edições foram combinadas com a versão atual. Revise e salve.', 'info'); }}>Combinar minhas edições</Button></>}>
      {conflict && <><ChangesComparison before={conflict.preferences} after={mergeDraft(baseline, draft, conflict.preferences)} beforeLabel="Salva em outra sessão" /><p className="vg-p-muted">Se o mesmo campo mudou nas duas sessões, sua escolha nesta tela prevalece na prévia. Nenhuma combinação é salva automaticamente.</p></>}
    </Modal>
  </>;
}
