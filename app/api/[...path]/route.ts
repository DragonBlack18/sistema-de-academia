import { env } from 'cloudflare:workers';
import { ZodError } from 'zod';
import { authenticate, checkCsrf, signIn, changePassword, audit, cookie, requirePermission } from '@/server/auth';
import { ApiError, json, requireOrigin, secureResponse, uuid } from '@/server/security';
import { readSettings, updateSettings, uploadAsset } from '@/server/settings';
import { readPreferences, updatePreferences, readSettingsHistory, restoreSettings, handleThemes, listAssets } from '@/server/personalization';
import { appearanceOf, ASSET_FIELDS } from '@/lib/personalization';
import { handleUsers } from '@/server/users';
import { handleMfa } from '@/server/mfa';
import { handleDomain } from '@/server/domain';
import { bootstrap, verifyDatabaseSchema } from '@/server/bootstrap';
import { validateRuntimeConfig, type RuntimeConfig } from '@/server/config';
import { productionReadiness } from '@/server/readiness';

export const dynamic = 'force-dynamic';

function methodAllowed(request: Request, methods: string[]): Response | undefined {
  if (methods.includes(request.method)) return;
  return json({ error: 'Método não permitido para este recurso.' }, 405, { Allow: methods.join(', ') });
}

async function route(request: Request, requestId: string): Promise<Response> {
  try {
    const db = env.DB;
    if (!db) throw new ApiError(503, 'O banco de dados não está disponível.');
    const config = env as unknown as RuntimeConfig;
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '');
    if (path === '/api/health') {
      const invalid = methodAllowed(request, ['GET', 'HEAD']);
      if (invalid) return invalid;
      try { await verifyDatabaseSchema(db); }
      catch { throw new ApiError(503, 'O banco precisa estar disponível e atualizado antes de iniciar.'); }
      return json({ status: 'ok', app: 'Vitality Gym' });
    }
    const mode = validateRuntimeConfig(config);
    if (mode === 'production' && url.protocol !== 'https:') throw new ApiError(403, 'Use HTTPS para acessar o ambiente de produção.');
    if (request.method !== 'GET' && request.method !== 'HEAD') requireOrigin(request);
    await bootstrap(db, config);
    const settings = await readSettings(db);

    if (path === '/api/branding') {
      const invalid = methodAllowed(request, ['GET']);
      if (invalid) return invalid;
      return json({ settings: appearanceOf(settings.settings) });
    }
    if (path === '/api/login') {
      const invalid = methodAllowed(request, ['POST']);
      return invalid || await signIn(request, db, config, settings.settings);
    }
    if (/^\/api\/assets\/[^/]+$/.test(path)) {
      const invalid = methodAllowed(request, ['GET']);
      if (invalid) return invalid;
      const id = path.split('/')[3];
      const isPublic = ASSET_FIELDS.some(field => settings.settings[field] === id);
      if (!isPublic) { const auth = await authenticate(request, db); requirePermission(auth.user, 'settings.read'); }
      const row = await db.prepare('SELECT object_key,mime FROM assets WHERE id=?').bind(id).first<{ object_key: string; mime: string }>();
      if (!row || !env.BUCKET) throw new ApiError(404, 'Imagem não encontrada.');
      const asset = await env.BUCKET.get(row.object_key);
      if (!asset) throw new ApiError(404, 'Imagem não encontrada.');
      return new Response(asset.body, { headers: { 'Content-Type': row.mime, 'Content-Disposition': 'inline', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
    }

    const auth = await authenticate(request, db);
    if (request.method !== 'GET' && request.method !== 'HEAD') checkCsrf(request, auth.csrfToken);
    if (path === '/api/me') {
      const invalid = methodAllowed(request, ['GET']);
      if (invalid) return invalid;
      const preferences = await readPreferences(db, auth.user);
      return json({ user: auth.user, csrfToken: auth.csrfToken, settings: settings.settings, settingsVersion: settings.version, preferences: preferences.preferences, preferencesVersion: preferences.version });
    }
    if (path === '/api/logout') {
      const invalid = methodAllowed(request, ['POST']);
      if (invalid) return invalid;
      await db.batch([db.prepare('DELETE FROM sessions WHERE id=?').bind(auth.sessionId), audit(db, auth.user.id, 'logout', 'auth', auth.user.id, 'Sessão encerrada')]);
      return json({ message: 'Sessão encerrada.' }, 200, { 'Set-Cookie': cookie('', request, 0) });
    }
    if (path === '/api/password') {
      const invalid = methodAllowed(request, ['POST']);
      return invalid || await changePassword(request, db, auth.user);
    }
    if (path === '/api/settings') {
      const invalid = methodAllowed(request, ['GET', 'PATCH']);
      if (invalid) return invalid;
      if (request.method === 'GET') { requirePermission(auth.user, 'settings.read'); return json(settings); }
      return await updateSettings(request, db, auth.user);
    }
    if (path === '/api/preferences') {
      const invalid = methodAllowed(request, ['GET', 'PATCH']);
      if (invalid) return invalid;
      return request.method === 'GET' ? json(await readPreferences(db, auth.user)) : await updatePreferences(request, db, auth.user);
    }
    if (path === '/api/settings/history') {
      const invalid = methodAllowed(request, ['GET']);
      return invalid || await readSettingsHistory(url, db, auth.user);
    }
    const restoreMatch = path.match(/^\/api\/settings\/history\/(\d+)\/restore$/);
    if (restoreMatch) {
      const invalid = methodAllowed(request, ['POST']);
      return invalid || await restoreSettings(request, db, auth.user, Number(restoreMatch[1]));
    }
    if (path === '/api/settings/themes' || path.startsWith('/api/settings/themes/')) return await handleThemes(request, url, db, auth.user);
    if (path === '/api/assets') {
      const invalid = methodAllowed(request, ['GET', 'POST']);
      if (invalid) return invalid;
      return request.method === 'GET' ? await listAssets(url, db, auth.user) : await uploadAsset(request, db, env.BUCKET, auth.user);
    }
    if (path === '/api/users' || path.startsWith('/api/users/')) return await handleUsers(request, url, db, auth.user);
    if (path.startsWith('/api/mfa/')) {
      const invalid = methodAllowed(request, ['POST']);
      return invalid || await handleMfa(request, db, config, auth);
    }
    if (path === '/api/system/readiness') {
      const invalid = methodAllowed(request, ['GET']);
      return invalid || await productionReadiness(request, db, env.BUCKET, config, auth.user);
    }
    return await handleDomain(request, url, db, auth.user) ?? json({ error: 'Recurso não encontrado.' }, 404);
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message, fields: error.fields }, error.status);
    if (error instanceof ZodError) return json({ error: 'Confira os campos informados.', fields: Object.fromEntries(error.issues.map(issue => [issue.path.join('.'), issue.message])) }, 422);
    const message = String(error);
    if (message.includes('UNIQUE constraint')) return json({ error: 'Já existe um registro com estes dados. Verifique a lista antes de tentar novamente.' }, 409);
    if (message.includes('FOREIGN KEY')) return json({ error: 'Um dos registros vinculados não está mais disponível. Recarregue a página.' }, 409);
    if (message.includes('transaction_guard')) return json({ error: 'O registro foi alterado por outra operação. Recarregue e tente novamente.' }, 409);
    if (message.includes('CHECK constraint')) return json({ error: 'A operação viola uma regra de integridade dos dados.' }, 422);
    // Never log SQL bind values, credentials, payloads or raw exception messages.
    console.error(JSON.stringify({ event: 'api.error', requestId, type: error instanceof Error ? error.name : 'UnknownError' }));
    return json({ error: 'Não foi possível concluir a operação. Seus dados não foram confirmados. Tente novamente.' }, 500);
  }
}

async function handler(request: Request) {
  const requestId = uuid();
  const startedAt = Date.now();
  let response = await route(request, requestId);
  if (response.status >= 400 && response.headers.get('Content-Type')?.includes('application/json')) {
    const body = await response.json() as Record<string, unknown>;
    response = json({ ...body, requestId }, response.status, response.headers);
  }
  const secured = secureResponse(response, request);
  secured.headers.set('X-Request-ID', requestId);
  if (secured.status === 429) secured.headers.set('Retry-After', '900');
  if (secured.status >= 500) console.error(JSON.stringify({ event: 'api.response', requestId, status: secured.status, durationMs: Date.now() - startedAt }));
  if (request.method === 'HEAD') return new Response(null, { status: secured.status, headers: secured.headers });
  return secured;
}

export { handler as GET, handler as HEAD, handler as POST, handler as PATCH, handler as DELETE, handler as PUT, handler as OPTIONS };
