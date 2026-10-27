import { z } from 'zod';
import { ApiError, json, bodyJson, readBodyBytes, timestamp, uuid } from './security';
import { Actor, requirePermission, audit, actorGuard, can, rolePermissions } from './auth';
import { inspectImage } from './image-metadata';
import { DEFAULT_SETTINGS, ASSET_FIELDS, ICON_NAMES, PAGE_KEYS, ROLES, appearanceOf, type AppearanceSettings, type GymSettings, type UserPreferences, type PageKey } from '../lib/personalization';

export { DEFAULT_SETTINGS };
const fontSchema = z.enum(['manrope', 'inter', 'system']);
const themeModeSchema = z.enum(['dark', 'light', 'system']);
const colorSchema = z.string().regex(/^#[\da-fA-F]{6}$/);
const assetIdSchema = z.string().min(1).max(100).nullable();
const positionSchema = z.enum(['top', 'center', 'bottom']);
export const preferencesSchema = z.object({
  themeMode: themeModeSchema, font: fontSchema, sidebarPosition: z.enum(['left', 'right']),
  sidebarMode: z.enum(['expanded', 'compact']), tableDensity: z.enum(['comfortable', 'compact']),
  textScale: z.union([z.literal(100), z.literal(110), z.literal(120)]),
  reducedMotion: z.enum(['system', 'reduce']), reducedTransparency: z.boolean(), homePage: z.enum(PAGE_KEYS),
  favorites: z.array(z.enum(PAGE_KEYS)).max(8).refine(value => new Set(value).size === value.length, 'Escolha cada favorito apenas uma vez.'),
}).strict().partial();
export const settingsSchema = z.object({
  gymName: z.string().trim().min(2).max(70), tagline: z.string().max(140), font: fontSchema,
  sidebarPosition: z.enum(['left', 'right']), iconStyle: z.enum(['outline', 'solid']),
  iconOverrides: z.partialRecord(z.enum(PAGE_KEYS), z.enum(ICON_NAMES)),
  accentColor: colorSchema, backgroundColor: colorSchema, lightBackgroundColor: colorSchema, themeMode: themeModeSchema,
  cornerStyle: z.enum(['soft', 'square']),
  logoAssetId: assetIdSchema, logoDarkAssetId: assetIdSchema, logoLightAssetId: assetIdSchema,
  faviconAssetId: assetIdSchema, logoLayout: z.enum(['symbol', 'horizontal']), showGymName: z.boolean(),
  wallpaperAssetId: assetIdSchema, wallpaperPosition: positionSchema,
  wallpaperOpacity: z.number().min(0).max(.35), accessGraceDays: z.number().int().min(0).max(30),
  loginImageAssetId: assetIdSchema, loginImagePosition: positionSchema, loginLayout: z.enum(['split', 'centered']),
  loginTitle: z.string().trim().min(1).max(160), loginSubtitle: z.string().max(240),
  loginWelcomeTitle: z.string().trim().min(1).max(100), loginWelcomeMessage: z.string().max(240),
  roleDefaults: z.partialRecord(z.enum(ROLES), preferencesSchema),
}).strict();
export const appearanceSchema = settingsSchema.omit({ accessGraceDays: true, roleDefaults: true });

export function storedObject(value: string, label = 'As configurações armazenadas') {
  let stored: unknown;
  try { stored = JSON.parse(value); } catch { throw new ApiError(503, `${label} precisam de revisão pelo administrador.`); }
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new ApiError(503, 'As configurações armazenadas precisam de revisão pelo administrador.');
  return stored;
}
export function parseStoredSettings(value: string): GymSettings {
  const stored = storedObject(value);
  const parsed = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...stored });
  if (!parsed.success) throw new ApiError(503, 'As configurações armazenadas precisam de revisão pelo administrador.');
  return parsed.data;
}
export function parseStoredAppearance(value: string): AppearanceSettings {
  const parsed = appearanceSchema.safeParse({ ...appearanceOf(DEFAULT_SETTINGS), ...storedObject(value, 'Os temas armazenados') });
  if (!parsed.success) throw new ApiError(503, 'Os temas armazenados precisam de revisão pelo administrador.');
  return parsed.data;
}
export async function readSettings(db: D1Database) {
  const row = await db.prepare("SELECT value,version FROM settings WHERE id='gym'").first<{ value: string; version: number }>();
  return { settings: parseStoredSettings(row?.value ?? '{}'), version: row?.version ?? 1 };
}

// Preference navigation never grants access: the same server permission policy
// applies before a chosen home page or shortcut can be saved.
const pagePermissions: Record<PageKey, string | null> = {
  dashboard: 'dashboard.read', students: 'students.read', staff: 'staff.read', plans: 'plans.read', memberships: 'memberships.read',
  invoices: 'finance.read', expenses: 'finance.read', attendance: 'attendance.read', workouts: 'workouts.read', exercises: 'workouts.read',
  assessments: 'assessments.read', classes: 'classes.read', products: 'inventory.read', suppliers: 'inventory.read', purchases: 'inventory.read',
  sales: 'inventory.read', leads: 'crm.read', notifications: 'notifications.read', users: 'users.read', audit: 'audit.read',
  'access-events': 'attendance.read', reports: 'reports.read', settings: null,
};
export function validatePreferencesAccess(preferences: UserPreferences, actor: Actor) {
  if (!actor.active) throw new ApiError(403, 'Seu perfil não tem permissão para esta operação.');
  for (const page of [...(preferences.homePage ? [preferences.homePage] : []), ...(preferences.favorites ?? [])]) {
    const permission = pagePermissions[page];
    if (permission && !can(actor, permission)) throw new ApiError(422, 'Escolha uma página disponível para este perfil.', { preferences: 'A página inicial e os favoritos devem respeitar o acesso do perfil.' });
  }
}
function validateRoleDefaults(settings: GymSettings) {
  for (const [role, preferences] of Object.entries(settings.roleDefaults)) validatePreferencesAccess(preferences, { id: '', name: '', login: '', role, active: true, permissions: rolePermissions(role) });
}

export type PersonalizationGuard = { sql: string; values: unknown[] };
export async function commitPersonalization(db: D1Database, actor: Actor, predicates: PersonalizationGuard[], statements: D1PreparedStatement[]) {
  const auth = actorGuard(actor);
  const guards = [auth, ...predicates], guard = uuid();
  try {
    await db.batch([
      db.prepare(`INSERT INTO transaction_guards(id,ok) VALUES (?,CASE WHEN (${guards.map(item => `(${item.sql})`).join(' AND ')}) THEN 1 ELSE 0 END)`).bind(guard, ...guards.flatMap(item => item.values)),
      ...statements,
      db.prepare('DELETE FROM transaction_guards WHERE id=?').bind(guard),
    ]);
  } catch (error) {
    if (String(error).includes('transaction_guard')) throw new ApiError(409, 'As configurações ou seu acesso foram alterados em outra sessão. Atualize os dados antes de tentar novamente.');
    throw error;
  }
}
export async function assetGuards(db: D1Database, settings: AppearanceSettings): Promise<PersonalizationGuard[]> {
  const guards: PersonalizationGuard[] = [];
  for (const field of ASSET_FIELDS) {
    if (settings[field]) {
      const kind = field === 'wallpaperAssetId' || field === 'loginImageAssetId' ? 'wallpaper' : 'logo';
      if (!await db.prepare('SELECT id FROM assets WHERE id=? AND kind=?').bind(settings[field], kind).first()) {
        throw new ApiError(400, 'A imagem selecionada não está disponível. Envie o arquivo novamente.');
      }
      guards.push({ sql: 'EXISTS(SELECT 1 FROM assets WHERE id=? AND kind=?)', values: [settings[field], kind] });
    }
  }
  return guards;
}
export async function commitSettings(db: D1Database, actor: Actor, version: number, settings: GymSettings, restoredFrom: number | null = null) {
  requirePermission(actor, 'settings.write');
  const parsed = settingsSchema.parse(settings);
  validateRoleDefaults(parsed);
  const predicates = [{ sql: "EXISTS(SELECT 1 FROM settings WHERE id='gym' AND version=?)", values: [version] }, ...await assetGuards(db, parsed)];
  const now = timestamp(), value = JSON.stringify(parsed);
  await commitPersonalization(db, actor, predicates, [
    // Old installs or direct administrative imports can lack the initial entry.
    // Capture the committed predecessor inside the same guarded transaction.
    db.prepare("INSERT OR IGNORE INTO settings_history(version,value,created_by,created_at,source,restored_from) SELECT version,value,NULL,updated_at,'initial',NULL FROM settings WHERE id='gym'"),
    db.prepare("UPDATE settings SET value=?,version=version+1,updated_at=? WHERE id='gym'").bind(value, now),
    db.prepare('INSERT INTO settings_history(version,value,created_by,created_at,source,restored_from) VALUES (?,?,?,?,?,?)').bind(version + 1, value, actor.id, now, restoredFrom === null ? 'update' : 'restore', restoredFrom),
    audit(db, actor.id, restoredFrom === null ? 'settings.updated' : 'settings.restored', 'settings', 'gym', restoredFrom === null ? 'Identidade visual e configurações atualizadas' : `Aparência restaurada da versão ${restoredFrom}; regras da academia preservadas`),
  ]);
  return { settings: parsed, version: version + 1 };
}
export async function updateSettings(request: Request, db: D1Database, actor: Actor) {
  requirePermission(actor, 'settings.write');
  const input = z.object({ version: z.number().int().positive(), settings: settingsSchema.partial() }).strict().parse(await bodyJson(request));
  if (!Object.keys(input.settings).length) throw new ApiError(422, 'Informe pelo menos uma configuração para alterar.');
  const current = await readSettings(db);
  if (current.version !== input.version) throw new ApiError(409, 'As configurações foram alteradas em outra sessão. Atualize os dados antes de salvar.');
  return json(await commitSettings(db, actor, input.version, { ...current.settings, ...input.settings }));
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
