'use client';
/* Authenticated R2 URLs must be requested directly with the visitor's cookies. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from 'react';
import { Image as ImageIcon, Images, Upload, X } from 'lucide-react';
import { api, errorMessage, notify } from '@/lib/api';
import { Button, EmptyState, ErrorState, LoadingState, Modal, Pagination } from '../ui';

type Asset = { id: string; name: string; kind: 'logo' | 'wallpaper'; mime: string; size: number; url: string; created_at: string; inUse: boolean };
type AssetPage = { data: Asset[]; total: number; page: number; pageSize: number };

export function AssetPicker({ open, kind, title, onClose, onSelect }: {
  open: boolean; kind: 'logo' | 'wallpaper'; title: string; onClose: () => void; onSelect: (id: string) => void;
}) {
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<AssetPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    // The library is refreshed each time it opens so recently uploaded images are available.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true); setError('');
    api<AssetPage>(`/assets?kind=${kind}&page=${page}&pageSize=12`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(errorMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, kind, page, revision]);
  return <Modal open={open} onClose={onClose} title={title} description="Reutilize uma imagem já enviada. A escolha só aparece para a academia depois de salvar a personalização." wide>
    {loading ? <LoadingState label="Carregando suas imagens..." /> : error ? <ErrorState message={error} onRetry={() => setRevision(value => value + 1)} /> : !data?.data.length ? <EmptyState title="Nenhuma imagem nesta biblioteca" description="Envie uma imagem no campo da marca ou do fundo. Ela ficará disponível aqui para reutilizar." icon={<Images size={26} />} /> : <>
      <div className="vg-p-assets">
        {data.data.map(asset => <button type="button" key={asset.id} className="vg-p-asset" onClick={() => { onSelect(asset.id); onClose(); }}>
          <span className={`vg-p-asset-image vg-p-asset-image--${kind}`}><img src={asset.url} alt="" loading="lazy" /></span>
          <strong>{asset.name}</strong>
          <span>{Math.max(1, Math.round(asset.size / 1024))} KB · {asset.inUse ? 'Em uso na academia' : 'Disponível'}</span>
          <span className="vg-p-asset-action">Escolher imagem</span>
        </button>)}
      </div>
      <Pagination total={data.total} page={page} pageSize={12} onPageChange={setPage} />
    </>}
  </Modal>;
}

export function ImageSlot({ label, help, assetId, kind, slot, busy, uploading, setUploading, onChange, onError, fallback }: {
  label: string; help: string; assetId: string | null; kind: 'logo' | 'wallpaper'; slot: string;
  busy: boolean; uploading: string; setUploading: (slot: string) => void;
  onChange: (id: string | null) => void; onError: (message: string) => void; fallback?: string;
}) {
  const [library, setLibrary] = useState(false);
  async function upload(file: File | undefined) {
    if (!file || busy || uploading) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) {
      onError('Selecione uma imagem PNG, JPEG ou WebP de até 5 MB.'); return;
    }
    setUploading(slot); onError('');
    const form = new FormData(); form.append('file', file); form.append('kind', kind);
    try {
      const response = await api<{ id: string }>('/assets', { method: 'POST', body: form });
      onChange(response.id);
      notify('Imagem enviada. Salve a personalização para aplicar.', 'info');
    } catch (cause: unknown) { onError(errorMessage(cause)); }
    finally { setUploading(''); }
  }
  return <div className="vg-p-image-slot">
    <div className={`vg-p-image-thumb vg-p-image-thumb--${kind}`}>
      {assetId || fallback ? <img src={assetId ? `/api/assets/${assetId}` : fallback} alt={`Prévia: ${label.toLocaleLowerCase('pt-BR')}`} /> : <ImageIcon size={25} aria-hidden="true" />}
    </div>
    <div className="vg-p-image-info"><strong>{label}</strong><p>{help}</p><div className="vg-p-image-actions">
      <label className={`vg-button vg-button--secondary vg-upload-button ${busy || uploading ? 'is-disabled' : ''}`}>
        <Upload size={14} aria-hidden="true" />{uploading === slot ? 'Enviando...' : 'Enviar imagem'}
        <input type="file" accept="image/png,image/jpeg,image/webp" aria-label={`Enviar ${label.toLocaleLowerCase('pt-BR')}`} disabled={busy || !!uploading} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void upload(file); }} />
      </label>
      <Button disabled={busy || !!uploading} onClick={() => setLibrary(true)} icon={<Images size={14} />}>Biblioteca</Button>
      {assetId && <Button variant="ghost" disabled={busy || !!uploading} onClick={() => onChange(null)} icon={<X size={14} />}>Remover</Button>}
    </div></div>
    <AssetPicker key={kind} open={library} kind={kind} title={`Escolher ${label.toLocaleLowerCase('pt-BR')}`} onClose={() => setLibrary(false)} onSelect={onChange} />
  </div>;
}
