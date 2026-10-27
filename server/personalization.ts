import { z } from 'zod';
import { ASSET_FIELDS, appearanceOf, type AppearanceTheme, type BrandingAsset, type SettingsHistoryEntry } from '../lib/personalization';
import { type Actor, audit, requirePermission } from './auth';
import { ApiError, bodyJson, json, timestamp, uuid } from './security';
import { appearanceSchema, assetGuards, commitPersonalization, commitSettings, parseStoredAppearance, parseStoredSettings, preferencesSchema, readSettings, storedObject, validatePreferencesAccess } from './settings';

type PreferenceRow = { value: string; version: number };
type ThemeRow = { id: string; name: string; kind: 'theme' | 'draft'; value: string; version: number; created_by: string; created_at: string; updated_at: string };

function pagination(url: URL) {
  const integer = (key: string, fallback: number, max: number) => {
    const raw = url.searchParams.get(key);
    if (raw === null) return fallback;
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1 || Number(raw) > max) {
      throw new ApiError(422, 'Informe uma página e um tamanho de lista válidos.');
    }
    return Number(raw);
  };
  const page = integer('page', 1, 1_000_000), pageSize = integer('pageSize', 12, 50);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export async function readPreferences(db: D1Database, actor: Actor) {
  if (!actor.active) throw new ApiError(403, 'Seu perfil não tem permissão para esta operação.');
  const row = await db.prepare('SELECT value,version FROM user_preferences WHERE user_id=?').bind(actor.id).first<PreferenceRow>();
  const parsed = preferencesSchema.safeParse(row ? storedObject(row.value, 'As preferências armazenadas') : {});
  if (!parsed.success) throw new ApiError(503, 'As preferências armazenadas precisam de revisão pelo administrador.');
  return { preferences: parsed.data, version: row?.version ?? 0 };
}

export async function updatePreferences(request: Request, db: D1Database, actor: Actor) {
  const input = z.object({ version: z.number().int().nonnegative(), preferences: preferencesSchema }).strict().parse(await bodyJson(request));
  validatePreferencesAccess(input.preferences, actor);
  const current = await readPreferences(db, actor);
  if (current.version !== input.version) throw new ApiError(409, 'Suas preferências foram alteradas em outra sessão. Atualize os dados antes de salvar.');
  const guard = input.version === 0
    ? { sql: 'NOT EXISTS(SELECT 1 FROM user_preferences WHERE user_id=?)', values: [actor.id] }
    : { sql: 'EXISTS(SELECT 1 FROM user_preferences WHERE user_id=? AND version=?)', values: [actor.id, input.version] };
  const value = JSON.stringify(input.preferences), now = timestamp();
  await commitPersonalization(db, actor, [guard], [
    input.version === 0
      ? db.prepare('INSERT INTO user_preferences(user_id,value,version,updated_at) VALUES (?,?,1,?)').bind(actor.id, value, now)
      : db.prepare('UPDATE user_preferences SET value=?,version=version+1,updated_at=? WHERE user_id=?').bind(value, now, actor.id),
    audit(db, actor.id, 'preferences.updated', 'user_preferences', actor.id, 'Preferências pessoais atualizadas'),
  ]);
  return json({ preferences: input.preferences, version: input.version + 1 });
}

export async function readSettingsHistory(url: URL, db: D1Database, actor: Actor) {
  requirePermission(actor, 'settings.read');
  const { page, pageSize, offset } = pagination(url);
  const rows = await db.prepare(`SELECT h.version,h.value,h.created_by,h.created_at,h.source,h.restored_from,u.name AS user_name,
    (SELECT p.value FROM settings_history p WHERE p.version<h.version ORDER BY p.version DESC LIMIT 1) AS previous_value
    FROM settings_history h LEFT JOIN users u ON u.id=h.created_by ORDER BY h.version DESC LIMIT ? OFFSET ?`).bind(pageSize, offset).all<{
    version: number; value: string; created_by: string | null; created_at: string; source: string; restored_from: number | null; user_name: string | null; previous_value: string | null;
  }>();
  const total = Number((await db.prepare('SELECT count(*) AS total FROM settings_history').first<{ total: number }>())?.total ?? 0);
  const data: (SettingsHistoryEntry & { created_by: string | null })[] = rows.results.map(row => {
    const settings = parseStoredSettings(row.value), previous = row.previous_value ? parseStoredSettings(row.previous_value) : null;
    return {
      version: row.version, settings, created_at: row.created_at, created_by: row.created_by, user_name: row.user_name,
      source: row.source, restored_from: row.restored_from,
      changed_keys: previous ? Object.keys(settings).filter(key => JSON.stringify(settings[key as keyof typeof settings]) !== JSON.stringify(previous[key as keyof typeof previous])) : [],
    };
  });
  return json({ data, total, page, pageSize });
}

export async function restoreSettings(request: Request, db: D1Database, actor: Actor, snapshotVersion: number) {
  requirePermission(actor, 'settings.write');
  if (!Number.isSafeInteger(snapshotVersion) || snapshotVersion < 1) throw new ApiError(404, 'Versão não encontrada.');
  const input = z.object({ version: z.number().int().positive() }).strict().parse(await bodyJson(request));
  const snapshot = await db.prepare('SELECT value FROM settings_history WHERE version=?').bind(snapshotVersion).first<{ value: string }>();
  if (!snapshot) throw new ApiError(404, 'Versão não encontrada.');
  const current = await readSettings(db);
  if (current.version !== input.version) throw new ApiError(409, 'As configurações foram alteradas em outra sessão. Atualize os dados antes de restaurar.');
  const restored = { ...current.settings, ...appearanceOf(parseStoredSettings(snapshot.value)) };
  return json(await commitSettings(db, actor, input.version, restored, snapshotVersion));
}

function themeRecord(row: ThemeRow): AppearanceTheme {
  return { id: row.id, name: row.name, kind: row.kind, settings: parseStoredAppearance(row.value), version: row.version, created_by: row.created_by, created_at: row.created_at, updated_at: row.updated_at };
}

const createThemeSchema = z.object({ name: z.string().trim().min(2).max(70), kind: z.enum(['theme', 'draft']), settings: appearanceSchema }).strict();
const editThemeSchema = createThemeSchema.partial().extend({ version: z.number().int().positive() }).strict();

export async function handleThemes(request: Request, url: URL, db: D1Database, actor: Actor): Promise<Response> {
  const route = url.pathname.replace(/\/$/, '');
  const match = route.match(/^\/api\/settings\/themes(?:\/([^/]+))?$/);
  if (!match || (match[1]?.length ?? 0) > 100) throw new ApiError(404, 'Tema não encontrado.');
  const id = match[1], methods = id ? ['GET', 'PATCH'] : ['GET', 'POST'];
  if (!methods.includes(request.method)) return json({ error: 'Método não permitido para este recurso.' }, 405, { Allow: methods.join(', ') });
  requirePermission(actor, request.method === 'GET' ? 'settings.read' : 'settings.write');

  if (!id && request.method === 'GET') {
    const { page, pageSize, offset } = pagination(url);
    const kind = url.searchParams.get('kind');
    if (kind !== null && kind !== 'theme' && kind !== 'draft') throw new ApiError(422, 'Escolha temas ou rascunhos.');
    const filter = kind === null ? '' : ' WHERE kind=?', args = kind === null ? [] : [kind];
    const rows = await db.prepare(`SELECT id,name,kind,value,version,created_by,created_at,updated_at FROM appearance_presets${filter} ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?`).bind(...args, pageSize, offset).all<ThemeRow>();
    const total = Number((await db.prepare(`SELECT count(*) AS total FROM appearance_presets${filter}`).bind(...args).first<{ total: number }>())?.total ?? 0);
    return json({ data: rows.results.map(themeRecord), total, page, pageSize });
  }

  if (!id) {
    const input = createThemeSchema.parse(await bodyJson(request));
    const now = timestamp(), themeId = uuid();
    await commitPersonalization(db, actor, await assetGuards(db, input.settings), [
      db.prepare('INSERT INTO appearance_presets(id,name,kind,value,version,created_by,created_at,updated_at) VALUES (?,?,?,?,1,?,?,?)').bind(themeId, input.name, input.kind, JSON.stringify(input.settings), actor.id, now, now),
      audit(db, actor.id, input.kind === 'draft' ? 'appearance.draft_created' : 'appearance.theme_created', 'appearance_presets', themeId, input.kind === 'draft' ? 'Rascunho de aparência salvo sem publicação' : 'Tema de aparência salvo sem publicação'),
    ]);
    return json({ id: themeId, ...input, version: 1, created_by: actor.id, created_at: now, updated_at: now }, 201);
  }

  const current = await db.prepare('SELECT id,name,kind,value,version,created_by,created_at,updated_at FROM appearance_presets WHERE id=?').bind(id).first<ThemeRow>();
  if (!current) throw new ApiError(404, 'Tema não encontrado.');
  if (request.method === 'GET') return json(themeRecord(current));

  const input = editThemeSchema.parse(await bodyJson(request));
  if (input.version !== current.version) throw new ApiError(409, 'Este tema foi alterado em outra sessão. Atualize os dados antes de salvar.');
  if (Object.keys(input).length === 1) throw new ApiError(422, 'Informe uma alteração para o tema.');
  const edited = { ...themeRecord(current), ...input, updated_at: timestamp(), version: input.version + 1 };
  await commitPersonalization(db, actor, [
    { sql: 'EXISTS(SELECT 1 FROM appearance_presets WHERE id=? AND version=?)', values: [id, input.version] },
    ...await assetGuards(db, edited.settings),
  ], [
    db.prepare('UPDATE appearance_presets SET name=?,kind=?,value=?,version=version+1,updated_at=? WHERE id=?').bind(edited.name, edited.kind, JSON.stringify(edited.settings), edited.updated_at, id),
    audit(db, actor.id, 'appearance.theme_updated', 'appearance_presets', id, 'Tema ou rascunho de aparência atualizado sem publicação'),
  ]);
  return json(edited);
}

export async function listAssets(url: URL, db: D1Database, actor: Actor) {
  requirePermission(actor, 'settings.read');
  const { page, pageSize, offset } = pagination(url);
  const kind = url.searchParams.get('kind');
  if (kind !== null && kind !== 'logo' && kind !== 'wallpaper') throw new ApiError(422, 'Escolha logos ou imagens de fundo.');
  const filter = kind === null ? '' : ' WHERE kind=?', args = kind === null ? [] : [kind];
  const rows = await db.prepare(`SELECT id,name,kind,mime,size,created_at FROM assets${filter} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).bind(...args, pageSize, offset).all<Omit<BrandingAsset, 'url' | 'inUse'>>();
  const total = Number((await db.prepare(`SELECT count(*) AS total FROM assets${filter}`).bind(...args).first<{ total: number }>())?.total ?? 0);
  const { settings } = await readSettings(db);
  const active = new Set(ASSET_FIELDS.map(field => settings[field]).filter(Boolean));
  return json({ data: rows.results.map(row => ({ ...row, url: `/api/assets/${row.id}`, inUse: active.has(row.id) })), total, page, pageSize });
}
