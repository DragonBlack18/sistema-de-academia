import { z } from 'zod';
import { ApiError, json, bodyJson, readBodyBytes, timestamp, uuid } from './security';
import { Actor, requirePermission, audit, actorGuard } from './auth';
import { inspectImage } from './image-metadata';

export const DEFAULT_SETTINGS = { gymName: 'Vitality Gym', tagline: 'Movimento que transforma.', font: 'manrope', sidebarPosition: 'left', iconStyle: 'outline', iconOverrides: {} as Record<string, string>, accentColor: '#b9f36b', backgroundColor: '#101211', logoAssetId: null as string | null, wallpaperAssetId: null as string | null, wallpaperOpacity: 0.12, accessGraceDays: 3 };
export const settingsSchema = z.object({
  gymName: z.string().trim().min(2).max(70), tagline: z.string().max(140), font: z.enum(['manrope', 'inter', 'system']),
  sidebarPosition: z.enum(['left', 'right']), iconStyle: z.enum(['outline', 'solid']),
  iconOverrides: z.record(z.string().max(80), z.enum(['Activity', 'BarChart3', 'Users', 'Dumbbell', 'CalendarDays', 'Wallet', 'LayoutDashboard', 'Package', 'Bell', 'Settings', 'ShieldCheck', 'UserRound', 'HeartPulse', 'ClipboardList', 'TrendingUp', 'Building2', 'CreditCard', 'Target', 'ShoppingBag', 'Zap'])).refine(value => Object.keys(value).length <= 30),
  accentColor: z.string().regex(/^#[\da-fA-F]{6}$/), backgroundColor: z.string().regex(/^#[\da-fA-F]{6}$/),
  logoAssetId: z.string().min(1).max(100).nullable(), wallpaperAssetId: z.string().min(1).max(100).nullable(),
  wallpaperOpacity: z.number().min(0).max(.35), accessGraceDays: z.number().int().min(0).max(30),
}).strict();

export async function readSettings(db: D1Database) {
  const row = await db.prepare("SELECT * FROM settings WHERE id='gym'").first<{ value: string; version: number }>();
  let stored: unknown = {};
  if (row) {
    try { stored = JSON.parse(row.value); } catch { throw new ApiError(503, 'As configurações armazenadas precisam de revisão pelo administrador.'); }
  }
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new ApiError(503, 'As configurações armazenadas precisam de revisão pelo administrador.');
  const parsed = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...stored });
  if (!parsed.success) throw new ApiError(503, 'As configurações armazenadas precisam de revisão pelo administrador.');
  return { settings: parsed.data, version: row?.version ?? 1 };
}

export async function updateSettings(request: Request, db: D1Database, actor: Actor) {
  requirePermission(actor, 'settings.write');
  const input = z.object({ version: z.number().int().positive(), settings: settingsSchema.partial() }).strict().parse(await bodyJson(request));
  if (!Object.keys(input.settings).length) throw new ApiError(422, 'Informe pelo menos uma configuração para alterar.');
  const current = await readSettings(db);
  const parsed = settingsSchema.parse({ ...current.settings, ...input.settings });
  const auth = actorGuard(actor);
  const predicates = [auth.sql, "EXISTS(SELECT 1 FROM settings WHERE id='gym' AND version=?)"];
  const values = [...auth.values, input.version];
  for (const field of ['logoAssetId', 'wallpaperAssetId'] as const) {
    if (parsed[field]) {
      const kind = field === 'logoAssetId' ? 'logo' : 'wallpaper';
      if (!await db.prepare('SELECT id FROM assets WHERE id=? AND kind=?').bind(parsed[field], kind).first()) {
        throw new ApiError(400, 'A imagem selecionada não está disponível. Envie o arquivo novamente.');
      }
      predicates.push('EXISTS(SELECT 1 FROM assets WHERE id=? AND kind=?)');
      values.push(parsed[field], kind);
    }
  }
  const guard = uuid();
  try {
    await db.batch([
      db.prepare(`INSERT INTO transaction_guards(id,ok) VALUES (?,CASE WHEN (${predicates.map(value => `(${value})`).join(' AND ')}) THEN 1 ELSE 0 END)`).bind(guard, ...values),
      db.prepare("UPDATE settings SET value=?,version=version+1,updated_at=? WHERE id='gym'").bind(JSON.stringify(parsed), timestamp()),
      audit(db, actor.id, 'settings.updated', 'settings', 'gym', 'Identidade visual e configurações atualizadas'),
      db.prepare('DELETE FROM transaction_guards WHERE id=?').bind(guard),
    ]);
  } catch (error) {
    if (String(error).includes('transaction_guard')) throw new ApiError(409, 'As configurações ou seu acesso foram alterados em outra sessão. Recarregue e tente novamente.');
    throw error;
  }
  return json(await readSettings(db));
}

export async function uploadAsset(request: Request, db: D1Database, bucket: R2Bucket | undefined, actor: Actor) {
  requirePermission(actor, 'settings.write');
  if (!bucket) throw new ApiError(503, 'O armazenamento de imagens não está disponível.');
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) throw new ApiError(415, 'Envie a imagem como formulário multipart.');
  const bounded = await readBodyBytes(request, Math.floor(5.5 * 1024 * 1024));
  let form: FormData;
  try { form = await new Response(bounded, { headers: { 'Content-Type': contentType } }).formData(); }
  catch { throw new ApiError(400, 'O formulário de imagem é inválido. Envie o arquivo novamente.'); }
  if (form.getAll('file').length !== 1 || form.getAll('kind').length !== 1 || [...form.keys()].some(key => key !== 'file' && key !== 'kind')) throw new ApiError(400, 'Envie exatamente uma imagem e sua finalidade.');
  const file = form.get('file'), kind = form.get('kind');
  if (!(file instanceof File) || !file.size || file.size > 5 * 1024 * 1024) throw new ApiError(400, 'Selecione uma imagem PNG, JPEG ou WebP de até 5 MB.');
  if (kind !== 'logo' && kind !== 'wallpaper') throw new ApiError(400, 'Defina se a imagem é logo ou papel de parede.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { mime } = inspectImage(bytes, file.type);
  const id = uuid(), key = `branding/${id}`, name = file.name.replace(/[\\/\u0000-\u001f\u007f]/g, '_').slice(0, 140) || 'imagem';
  const auth = actorGuard(actor), guard = uuid();
  await bucket.put(key, bytes, { httpMetadata: { contentType: mime } });
  try {
    await db.batch([
      db.prepare(`INSERT INTO transaction_guards(id,ok) VALUES (?,CASE WHEN (${auth.sql}) THEN 1 ELSE 0 END)`).bind(guard, ...auth.values),
      db.prepare('INSERT INTO assets (id,object_key,mime,size,name,kind,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(id, key, mime, file.size, name, kind, actor.id, timestamp()),
      audit(db, actor.id, 'asset.uploaded', 'assets', id, kind === 'logo' ? 'Logo enviada' : 'Papel de parede enviado'),
      db.prepare('DELETE FROM transaction_guards WHERE id=?').bind(guard),
    ]);
  } catch (error) {
    try { await bucket.delete(key); } catch { console.error('asset.cleanup_failed', { assetId: id }); }
    if (String(error).includes('transaction_guard')) throw new ApiError(409, 'Seu acesso mudou durante o envio. Entre novamente antes de tentar.');
    throw error;
  }
  return json({ id, url: `/api/assets/${id}`, kind, name }, 201);
}
