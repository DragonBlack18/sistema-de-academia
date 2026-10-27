'use client';

import { useEffect, useState } from 'react';
import { Copy, History, Pencil, Plus, Save } from 'lucide-react';
import { api, ApiError, errorMessage, notify } from '@/lib/api';
import { type AppearanceSettings, type AppearanceTheme, type GymSettings, type PersonalizationPage, type SettingsHistoryEntry, appearanceOf } from '@/lib/personalization';
import { Button, EmptyState, ErrorState, Field, Input, LoadingState, Modal, Pagination, Select } from '../ui';
import { ChangesComparison, PERSONALIZATION_LABELS } from './shared';

const date = (value: string) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(value));

export function ThemeLibrary({ draft, disabled, onLoad }: { draft: GymSettings; disabled: boolean; onLoad: (settings: AppearanceSettings, name: string) => void }) {
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<PersonalizationPage<AppearanceTheme> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<'new' | AppearanceTheme | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'theme' | 'draft'>('theme');
  const [replaceSettings, setReplaceSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const [conflict, setConflict] = useState<AppearanceTheme | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    // Pagination/retry refresh only the saved collection; the academy editor retains its draft.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true); setError('');
    api<PersonalizationPage<AppearanceTheme>>(`/settings/themes?page=${page}&pageSize=8`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(errorMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, revision]);
  function openEditor(theme: 'new' | AppearanceTheme) { setEditor(theme); setName(theme === 'new' ? '' : theme.name); setKind(theme === 'new' ? 'theme' : theme.kind); setReplaceSettings(false); setMutationError(''); setConflict(null); }
  async function save() {
    if (busy || !editor) return;
    if (name.trim().length < 2) { setMutationError('Dê um nome com pelo menos dois caracteres.'); return; }
    setBusy(true); setMutationError('');
    try {
      if (editor === 'new') await api('/settings/themes', { method: 'POST', body: { name: name.trim(), kind, settings: appearanceOf(draft) } });
      else await api(`/settings/themes/${editor.id}`, { method: 'PATCH', body: { version: editor.version, name: name.trim(), kind, ...(replaceSettings ? { settings: appearanceOf(draft) } : {}) } });
      setEditor(null); setRevision(value => value + 1); notify(kind === 'draft' ? 'Rascunho salvo. A aparência publicada continua igual.' : 'Tema salvo na sua biblioteca.');
    } catch (cause: unknown) {
      setMutationError(errorMessage(cause));
      if (cause instanceof ApiError && cause.status === 409 && editor !== 'new') {
        try { setConflict(await api<AppearanceTheme>(`/settings/themes/${editor.id}`)); setRevision(value => value + 1); }
        catch { /* Preserve the editable form and original conflict if the follow-up read fails. */ }
      }
    }
    finally { setBusy(false); }
  }
  return <section className="vg-panel vg-settings-section"><div className="vg-p-section-heading"><div><h2>Temas e rascunhos</h2><p>Guarde a prévia com um nome e continue em outro momento. Salvar aqui não altera as telas da equipe.</p></div><Button icon={<Plus size={16} />} disabled={disabled} onClick={() => openEditor('new')}>Guardar prévia</Button></div>
    {loading ? <LoadingState label="Carregando temas salvos..." /> : error ? <ErrorState message={error} onRetry={() => setRevision(value => value + 1)} /> : !data?.data.length ? <EmptyState title="Sua biblioteca começa com um tema" description="Ajuste a aparência e use Guardar prévia para salvar um tema ou rascunho reutilizável." icon={<Copy size={26} />} /> : <><div className="vg-p-theme-list">{data.data.map(theme => <article key={theme.id} className="vg-p-theme-card"><div className="vg-p-theme-swatches" aria-hidden="true"><span style={{ background: theme.settings.backgroundColor }} /><span style={{ background: theme.settings.lightBackgroundColor }} /><span style={{ background: theme.settings.accentColor }} /></div><div className="vg-p-theme-info"><span className="vg-p-small-label">{theme.kind === 'draft' ? 'RASCUNHO' : 'TEMA'} · v{theme.version}</span><h3>{theme.name}</h3><p>Atualizado em {date(theme.updated_at)}</p></div><div className="vg-p-theme-actions"><Button disabled={disabled} onClick={() => onLoad(theme.settings, theme.name)}>Abrir na prévia</Button><Button variant="ghost" disabled={disabled} onClick={() => openEditor(theme)} aria-label={`Editar tema ${theme.name}`} title="Editar tema"><Pencil size={16} /></Button></div></article>)}</div><Pagination total={data.total} page={page} pageSize={8} onPageChange={setPage} /></>}
    <Modal open={!!editor} onClose={() => setEditor(null)} title={editor === 'new' ? 'Guardar esta prévia' : 'Editar tema salvo'} description="O tema guarda marca, cores, ícones, imagens e login. Regras da academia e preferências pessoais permanecem separadas." busy={busy} footer={<><Button disabled={busy} onClick={() => setEditor(null)}>Cancelar</Button><Button variant="primary" busy={busy} onClick={save} icon={<Save size={16} />}>Salvar {kind === 'draft' ? 'rascunho' : 'tema'}</Button></>}>
      <form noValidate onSubmit={event => { event.preventDefault(); void save(); }} className="vg-p-dialog-form"><Field label="Nome" required><Input autoFocus value={name} maxLength={70} onChange={event => setName(event.target.value)} disabled={busy} placeholder="Ex.: Identidade de verão" /></Field><Field label="Guardar como"><Select value={kind} onChange={event => setKind(event.target.value as 'theme' | 'draft')} disabled={busy}><option value="theme">Tema reutilizável</option><option value="draft">Rascunho para continuar depois</option></Select></Field>{editor && editor !== 'new' && <label className="vg-p-check"><input type="checkbox" checked={replaceSettings} disabled={busy} onChange={event => setReplaceSettings(event.target.checked)} /><span><strong>Substituir a aparência deste tema pela prévia atual</strong><small>Sem esta opção, somente o nome e a classificação serão alterados.</small></span></label>}{mutationError && <ErrorState message={mutationError} compact />}
        {conflict && <div><p className="vg-p-muted">Este tema já está na versão {conflict.version}, com o nome “{conflict.name}”. Escolha como continuar; nada será salvo automaticamente.</p><ChangesComparison before={{ name: conflict.name, kind: conflict.kind, ...conflict.settings }} after={{ name, kind, ...(replaceSettings ? appearanceOf(draft) : conflict.settings) }} beforeLabel="Salva em outra sessão" afterLabel="Sua edição" /><div className="vg-p-theme-actions"><Button disabled={busy} onClick={() => openEditor(conflict)}>Usar versão atual</Button><Button disabled={busy} onClick={() => { setEditor(conflict); setConflict(null); setMutationError(''); }}>Manter minhas edições para revisão</Button></div></div>}
      </form>
    </Modal>
  </section>;
}

export function AppearanceHistory({ current, currentVersion, revision, busy, onRestore }: {
  current: GymSettings; currentVersion: number; revision: number; busy: boolean;
  onRestore: (entry: SettingsHistoryEntry) => void;
}) {
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<PersonalizationPage<SettingsHistoryEntry> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [compare, setCompare] = useState<SettingsHistoryEntry | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    // Historic reads never replace the active draft.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true); setError('');
    api<PersonalizationPage<SettingsHistoryEntry>>(`/settings/history?page=${page}&pageSize=8`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(errorMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, retry, revision]);
  return <section className="vg-panel vg-settings-section"><div className="vg-p-section-heading"><div><h2>Histórico da academia</h2><p>Veja quem salvou, compare aparências e restaure uma versão. A restauração cria uma nova versão e preserva as anteriores.</p></div><History size={22} /></div>
    {loading ? <LoadingState label="Carregando histórico..." /> : error ? <ErrorState message={error} onRetry={() => setRetry(value => value + 1)} /> : !data?.data.length ? <EmptyState title="O histórico aparecerá aqui" description="Cada personalização salva passa a ter uma versão recuperável." icon={<History size={26} />} /> : <><ol className="vg-p-history">{data.data.map(entry => <li key={entry.version}><div className="vg-p-history-marker" aria-hidden="true">{entry.version}</div><div className="vg-p-history-detail"><div><h3>Versão {entry.version}</h3>{entry.version === currentVersion && <span className="vg-p-history-current">Publicada</span>}</div><p>{entry.user_name || 'Configuração inicial'} · <time dateTime={entry.created_at}>{date(entry.created_at)}</time></p><p>{entry.restored_from ? `Restaurada a partir da versão ${entry.restored_from}.` : entry.changed_keys.length ? entry.changed_keys.map(key => PERSONALIZATION_LABELS[key] || key).join(' · ') : 'Configuração inicial preservada.'}</p><div className="vg-p-theme-actions"><Button onClick={() => setCompare(entry)}>Comparar</Button><Button disabled={busy || entry.version === currentVersion} onClick={() => onRestore(entry)}>Restaurar aparência</Button></div></div></li>)}</ol><Pagination total={data.total} page={page} pageSize={8} onPageChange={setPage} /></>}
    <Modal open={!!compare} onClose={() => setCompare(null)} title={`Comparar versão ${compare?.version || ''}`} description="Comparação somente da aparência. Dias de carência e preferências por perfil não são restaurados junto com a marca." wide footer={<Button onClick={() => setCompare(null)}>Fechar comparação</Button>}>
      {compare && <ChangesComparison before={appearanceOf(current)} after={appearanceOf(compare.settings)} beforeLabel="Publicada agora" afterLabel={`Versão ${compare.version}`} />}
    </Modal>
  </section>;
}
