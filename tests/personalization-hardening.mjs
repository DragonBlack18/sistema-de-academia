import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { createD1Harness, readMigrations } from './support/sqlite-d1.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'outputs');
mkdirSync(output, { recursive: true });
const compiled = mkdtempSync(path.join(output, 'personalization-suite-'));
writeFileSync(path.join(compiled, 'package.json'), '{"type":"commonjs"}\n');
function compile(directory) {
  for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) { compile(relative); continue; }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) continue;
    const destination = path.join(compiled, relative.replace(/\.ts$/, '.js'));
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, ts.transpileModule(readFileSync(path.join(root, relative), 'utf8'), { fileName: relative, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
  }
}
compile('server'); compile('lib');
const require = createRequire(import.meta.url);
const auth = require(path.join(compiled, 'server/auth.js'));
const security = require(path.join(compiled, 'server/security.js'));
const settingsService = require(path.join(compiled, 'server/settings.js'));
const service = require(path.join(compiled, 'server/personalization.js'));
const { bootstrap } = require(path.join(compiled, 'server/bootstrap.js'));
const { DEFAULT_SETTINGS, resolvePreferences, appearanceOf } = require(path.join(compiled, 'lib/personalization.js'));
const { contrastRatio, relativeLuminance, readableAccent, buildTheme } = require(path.join(compiled, 'lib/theme.js'));
const clientApi = require(path.join(compiled, 'lib/api.js'));
const migrations = readMigrations(root);
const migrationJournal = JSON.parse(readFileSync(path.join(root, 'drizzle/meta/_journal.json'), 'utf8'));
const personalizationMigration = migrationJournal.entries.findIndex(entry => entry.tag === '0003_personalization');
assert.ok(personalizationMigration >= 0, 'A migração de personalização deve estar registrada.');
const results = [];
const startedAt = new Date().toISOString();
let numericalPairs = 0;
let maxBindings = 0;
const request = (route, body, method = 'PATCH') => new Request(`https://vitality.test/api/${route}`, { method, headers: { 'Content-Type': 'application/json', Origin: 'https://vitality.test' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const url = route => new URL(`https://vitality.test/api/${route}`);
const expectedError = status => error => error instanceof security.ApiError && error.status === status;
const validationError = error => error.name === 'ZodError' || error.status === 422;

function account(h, id, role = 'super_admin') {
  const stamp = new Date().toISOString();
  h.sql.prepare('INSERT INTO users(id,name,login,password_hash,role,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,1)').run(id, id, `${id}@example.invalid`, 'synthetic-no-password-login', role, stamp, stamp);
  return auth.publicUser(h.sql.prepare('SELECT * FROM users WHERE id=?').get(id));
}
function fixture() {
  const h = createD1Harness(migrations);
  const prepare = h.db.prepare;
  h.db.prepare = text => {
    const statement = prepare(text);
    const bind = statement.bind.bind(statement);
    statement.bind = (...args) => { maxBindings = Math.max(maxBindings, args.length); assert.ok(args.length <= 100, 'A consulta deve respeitar o limite D1 de parâmetros.'); return bind(...args); };
    return statement;
  };
  h.owner = account(h, 'owner');
  h.finance = account(h, 'finance', 'finance');
  h.personal = account(h, 'personal', 'personal');
  const stamp = new Date().toISOString();
  h.sql.prepare("INSERT INTO settings(id,value,version,updated_at) VALUES ('gym',?,1,?)").run(JSON.stringify(DEFAULT_SETTINGS), stamp);
  h.sql.prepare("INSERT INTO settings_history(version,value,created_by,created_at,source) VALUES (1,?,NULL,?,'initial')").run(JSON.stringify(DEFAULT_SETTINGS), stamp);
  h.patchSettings = async (value, version, actor = h.owner) => {
    const current = await settingsService.readSettings(h.db);
    return (await settingsService.updateSettings(request('settings', { version: version ?? current.version, settings: value }), h.db, actor)).json();
  };
  h.patchPreferences = async (value, version, actor = h.owner) => {
    const current = await service.readPreferences(h.db, actor);
    return (await service.updatePreferences(request('preferences', { version: version ?? current.version, preferences: value }), h.db, actor)).json();
  };
  h.theme = async (body, method = 'POST', id = '', actor = h.owner) => {
    const route = `settings/themes${id ? `/${id}` : ''}`;
    return (await service.handleThemes(request(route, body, method), url(route), h.db, actor)).json();
  };
  h.count = table => Number(h.sql.prepare(`SELECT count(*) AS n FROM ${table}`).get().n);
  h.insertAsset = (id, kind = 'logo') => h.sql.prepare('INSERT INTO assets(id,object_key,mime,size,name,kind,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id, `branding/${id}`, 'image/png', 10, `${id}.png`, kind, h.owner.id, stamp);
  return h;
}
async function step(name, run) {
  const h = fixture();
  const start = performance.now();
  try {
    await run(h);
    assert.equal(h.count('transaction_guards'), 0, 'Guardas temporárias não podem permanecer após commit ou rollback.');
    assert.deepEqual(h.sql.prepare('PRAGMA foreign_key_check').all(), []);
    results.push({ name, status: 'PASS', durationMs: Math.round(performance.now() - start) });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally { h.sql.close(); }
}

// Independent test oracle, with W3C black/white and red luminance reference vectors.
function measuredContrast(a, b) {
  function luminance(hex) {
    const number = Number.parseInt(hex.slice(1), 16);
    return [number >> 16, (number >> 8) & 255, number & 255].map(channel => channel / 255).map(value => value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  }
  const first = luminance(a), second = luminance(b);
  numericalPairs += 1;
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

async function clientFixture(run) {
  const priorFetch = globalThis.fetch;
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const events = new EventTarget();
  const requests = [];
  let unauthorized = 0;
  events.addEventListener('vg:unauthorized', () => { unauthorized += 1; });
  Object.defineProperty(globalThis, 'window', { value: events, configurable: true, writable: true });
  globalThis.fetch = (address, options) => new Promise((resolve, reject) => requests.push({ address, options, resolve, reject }));
  try { await run({ requests, unauthorized: () => unauthorized }); }
  finally {
    clientApi.setCsrfToken(''); globalThis.fetch = priorFetch;
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow);
    else delete globalThis.window;
  }
}

const aborted = error => error instanceof DOMException && error.name === 'AbortError';

let failure;
try {
  await step('PERSONALIZATION_MIGRATION_PRESERVES_EXISTING_SETTINGS_AND_ACCOUNTS', async () => {
    const migrated = createD1Harness([]);
    const old = migrated.sql;
    try {
      old.exec('PRAGMA foreign_keys=ON');
      for (const migration of migrations.slice(0, personalizationMigration)) old.exec(migration);
      const stamp = '2026-10-01T10:00:00.000Z';
      const legacy = { gymName: 'Academia existente', tagline: 'Nome preservado', font: 'inter', sidebarPosition: 'right', iconStyle: 'solid', iconOverrides: { students: 'Users' }, accentColor: '#123abc', backgroundColor: '#111111', logoAssetId: 'legacy-logo', wallpaperAssetId: null, wallpaperOpacity: 0.12, accessGraceDays: 9 };
      old.prepare("INSERT INTO users(id,name,login,password_hash,role,created_at,updated_at,version) VALUES ('legacy','Legacy','legacy','preserved-hash','super_admin',?,?,4)").run(stamp, stamp);
      old.prepare("INSERT INTO assets(id,object_key,mime,size,name,kind,created_by,created_at) VALUES ('legacy-logo','branding/legacy','image/png',10,'logo.png','logo','legacy',?)").run(stamp);
      old.prepare("INSERT INTO settings(id,value,version,updated_at) VALUES ('gym',?,8,?)").run(JSON.stringify(legacy), stamp);
      old.exec(migrations[personalizationMigration]);
      assert.equal(old.prepare("SELECT value FROM settings WHERE id='gym'").get().value, JSON.stringify(legacy));
      assert.equal(old.prepare('SELECT count(*) AS n FROM settings_history').get().n, 0, 'A migração hospedada deve conter apenas mudanças de schema.');
      await bootstrap(migrated.db, { APP_ENV: 'test', ENABLE_DEMO_DATA: 'false' });
      const snapshot = old.prepare('SELECT * FROM settings_history WHERE version=8').get();
      assert.equal(snapshot.value, JSON.stringify(legacy));
      assert.equal(snapshot.source, 'initial');
      assert.equal(old.prepare("SELECT password_hash FROM users WHERE id='legacy'").get().password_hash, 'preserved-hash');
      assert.equal(old.prepare("SELECT object_key FROM assets WHERE id='legacy-logo'").get().object_key, 'branding/legacy');
      const owner = auth.publicUser(old.prepare("SELECT * FROM users WHERE id='legacy'").get());
      const saved = await (await settingsService.updateSettings(request('settings', { version: 8, settings: { tagline: 'Nova mensagem' } }), migrated.db, owner)).json();
      assert.equal(saved.version, 9);
      assert.equal(old.prepare('SELECT value FROM settings_history WHERE version=8').get().value, JSON.stringify(legacy), 'A primeira gravação não pode substituir o snapshot legado.');
      assert.deepEqual(JSON.parse(old.prepare('SELECT value FROM settings_history WHERE version=9').get().value), saved.settings);
      assert.deepEqual(old.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { old.close(); }
  });

  await step('PERSONALIZATION_LEGACY_DEFAULTS_ARE_ADDITIVE_AT_READ', async h => {
    h.sql.prepare("UPDATE settings SET value=? WHERE id='gym'").run(JSON.stringify({ gymName: 'Legada', font: 'system', accessGraceDays: 14 }));
    const before = h.sql.prepare("SELECT value FROM settings WHERE id='gym'").get().value;
    const current = await settingsService.readSettings(h.db);
    assert.equal(current.settings.gymName, 'Legada'); assert.equal(current.settings.font, 'system');
    assert.equal(current.settings.accessGraceDays, 14); assert.equal(current.settings.themeMode, 'dark');
    assert.equal(h.sql.prepare("SELECT value FROM settings WHERE id='gym'").get().value, before, 'Leitura não reescreve configuração legada.');
    assert.deepEqual(await service.readPreferences(h.db, h.finance), { preferences: {}, version: 0 });
    assert.equal(h.count('user_preferences'), 0);
  });

  await step('PERSONALIZATION_FIRST_PREFERENCE_RACE_IS_ATOMIC', async h => {
    const race = await Promise.allSettled(['light', 'dark'].map(themeMode => h.patchPreferences({ themeMode }, 0, h.finance)));
    assert.equal(race.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(race.find(row => row.status === 'rejected').reason.status, 409);
    assert.equal(h.count('user_preferences'), 1); assert.equal(h.count('audit_logs'), 1);
    assert.deepEqual(await service.readPreferences(h.db, h.finance), race.find(row => row.status === 'fulfilled').value);
  });

  await step('PERSONALIZATION_PREFERENCE_REPLACEMENT_RESET_AND_ACCOUNT_ISOLATION', async h => {
    await h.patchPreferences({ themeMode: 'light', tableDensity: 'compact', favorites: ['dashboard', 'settings'] }, 0, h.finance);
    await h.patchPreferences({ font: 'inter' }, 1, h.finance);
    assert.deepEqual((await service.readPreferences(h.db, h.finance)).preferences, { font: 'inter' });
    assert.deepEqual(await service.readPreferences(h.db, h.owner), { preferences: {}, version: 0 });
    assert.deepEqual(await h.patchPreferences({}, 2, h.finance), { preferences: {}, version: 3 });
    assert.equal((await settingsService.readSettings(h.db)).version, 1);
  });

  await step('PERSONALIZATION_STALE_PREFERENCE_WRITE_PRESERVES_AUDIT_AND_VALUE', async h => {
    await h.patchPreferences({ font: 'inter' }, 0);
    await assert.rejects(h.patchPreferences({ font: 'system' }, 0), expectedError(409));
    assert.deepEqual(await service.readPreferences(h.db, h.owner), { preferences: { font: 'inter' }, version: 1 });
    assert.equal(h.count('audit_logs'), 1);
  });

  await step('PERSONALIZATION_PREFERENCE_REVALIDATES_ACCOUNT_AT_COMMIT', async h => {
    h.hooks.beforeBatch = () => { h.hooks.beforeBatch = null; h.sql.prepare("UPDATE users SET active=0,version=version+1 WHERE id='finance'").run(); };
    await assert.rejects(h.patchPreferences({ font: 'inter' }, 0, h.finance), expectedError(409));
    assert.equal(h.count('user_preferences'), 0); assert.equal(h.count('audit_logs'), 0);
  });

  await step('PERSONALIZATION_AUTHENTICATED_SESSION_REVOKED_BEFORE_COMMIT', async h => {
    const token = security.randomToken(), stamp = new Date().toISOString();
    h.sql.prepare('INSERT INTO sessions(id,user_id,token_hash,csrf_token,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?)').run('session', h.owner.id, security.digest(token), 'test-csrf', new Date(Date.now() + 60_000).toISOString(), stamp, stamp);
    const session = await auth.authenticate(new Request('https://vitality.test/api/me', { headers: { Cookie: `vg_session=${token}` } }), h.db);
    h.hooks.beforeBatch = () => { h.hooks.beforeBatch = null; h.sql.prepare("DELETE FROM sessions WHERE id='session'").run(); };
    await assert.rejects(h.patchPreferences({ sidebarMode: 'compact' }, 0, session.user), expectedError(409));
    assert.equal(h.count('user_preferences'), 0); assert.equal(h.count('audit_logs'), 0);
  });

  await step('PERSONALIZATION_NAVIGATION_CANNOT_GRANT_FORBIDDEN_PAGES', async h => {
    await assert.rejects(h.patchPreferences({ homePage: 'users' }, 0, h.finance), expectedError(422));
    await assert.rejects(h.patchPreferences({ favorites: ['invoices'] }, 0, h.personal), expectedError(422));
    await assert.rejects(h.patchSettings({ roleDefaults: { finance: { homePage: 'audit' } } }), expectedError(422));
    assert.equal(h.count('user_preferences'), 0); assert.equal(h.count('audit_logs'), 0);
    await h.patchPreferences({ homePage: 'invoices', favorites: ['expenses', 'reports'] }, 0, h.finance);
  });

  await step('PERSONALIZATION_STRICT_SCHEMA_REJECTS_CODE_AND_ACCOUNT_SELECTION', async h => {
    for (const preferences of [{ user_id: 'owner' }, { role: 'super_admin' }, { themeMode: '<script>' }, { textScale: 119 }, { reducedTransparency: 'false' }, { favorites: ['dashboard', 'dashboard'] }, { favorites: ['dashboard', 'students', 'plans', 'memberships', 'settings', 'invoices', 'expenses', 'reports', 'notifications'] }]) {
      await assert.rejects(h.patchPreferences(preferences, 0, h.finance), validationError);
    }
    await assert.rejects(service.updatePreferences(request('preferences', { version: 0, preferences: {}, user_id: 'owner' }), h.db, h.finance), validationError);
    assert.equal(h.count('user_preferences'), 0);
  });

  await step('PERSONALIZATION_CORRUPT_STORED_VALUES_FAIL_CLOSED', async h => {
    h.sql.prepare("INSERT INTO user_preferences(user_id,value,version,updated_at) VALUES ('finance',?,1,?)").run(JSON.stringify({ textScale: 500 }), new Date().toISOString());
    await assert.rejects(service.readPreferences(h.db, h.finance), expectedError(503));
    h.sql.prepare("UPDATE settings SET value=? WHERE id='gym'").run(JSON.stringify({ font: 'remote-css' }));
    await assert.rejects(settingsService.readSettings(h.db), expectedError(503));
    assert.equal(h.count('audit_logs'), 0);
  });

  await step('PERSONALIZATION_GLOBAL_CONCURRENT_WRITE_HAS_SINGLE_SNAPSHOT', async h => {
    const race = await Promise.allSettled(['#3333ff', '#ff3333'].map(accentColor => h.patchSettings({ accentColor }, 1)));
    assert.equal(race.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(race.find(row => row.status === 'rejected').reason.status, 409);
    const latest = await settingsService.readSettings(h.db);
    assert.equal(latest.version, 2); assert.equal(h.count('settings_history'), 2); assert.equal(h.count('audit_logs'), 1);
    assert.deepEqual(JSON.parse(h.sql.prepare('SELECT value FROM settings_history WHERE version=2').get().value), latest.settings);
  });

  await step('PERSONALIZATION_SNAPSHOT_FAILURE_ROLLS_BACK_SETTING_AND_AUDIT', async h => {
    h.sql.exec("CREATE TRIGGER qa_history_failure BEFORE INSERT ON settings_history WHEN NEW.version=2 BEGIN SELECT RAISE(ABORT,'synthetic history storage failure'); END");
    await assert.rejects(h.patchSettings({ gymName: 'Must roll back' }, 1), /synthetic history storage failure/);
    assert.deepEqual(await settingsService.readSettings(h.db), { settings: DEFAULT_SETTINGS, version: 1 });
    assert.equal(h.count('settings_history'), 1); assert.equal(h.count('audit_logs'), 0);
  });

  await step('PERSONALIZATION_GLOBAL_WRITE_REVALIDATES_ADMIN_ROLE', async h => {
    h.hooks.beforeBatch = () => { h.hooks.beforeBatch = null; h.sql.prepare("UPDATE users SET role='finance',version=version+1 WHERE id='owner'").run(); };
    await assert.rejects(h.patchSettings({ gymName: 'Unauthorized race' }, 1), expectedError(409));
    assert.equal((await settingsService.readSettings(h.db)).version, 1);
    assert.equal(h.count('settings_history'), 1); assert.equal(h.count('audit_logs'), 0);
  });

  await step('PERSONALIZATION_ASSET_REFERENCE_REVALIDATED_INSIDE_TRANSACTION', async h => {
    h.insertAsset('test-logo');
    h.hooks.beforeBatch = () => { h.hooks.beforeBatch = null; h.sql.prepare("DELETE FROM assets WHERE id='test-logo'").run(); };
    await assert.rejects(h.patchSettings({ logoLightAssetId: 'test-logo' }, 1), expectedError(409));
    assert.equal((await settingsService.readSettings(h.db)).settings.logoLightAssetId, null);
    assert.equal(h.count('settings_history'), 1); assert.equal(h.count('audit_logs'), 0);
  });

  await step('PERSONALIZATION_ALL_ASSET_SLOTS_VALIDATE_KIND', async h => {
    h.insertAsset('logo'); h.insertAsset('wallpaper', 'wallpaper');
    for (const key of ['logoAssetId', 'logoDarkAssetId', 'logoLightAssetId', 'faviconAssetId']) await assert.rejects(h.patchSettings({ [key]: 'wallpaper' }, 1), expectedError(400));
    for (const key of ['wallpaperAssetId', 'loginImageAssetId']) await assert.rejects(h.patchSettings({ [key]: 'logo' }, 1), expectedError(400));
    await h.patchSettings({ logoAssetId: 'logo', logoDarkAssetId: 'logo', logoLightAssetId: 'logo', faviconAssetId: 'logo', wallpaperAssetId: 'wallpaper', loginImageAssetId: 'wallpaper' }, 1);
    assert.equal((await settingsService.readSettings(h.db)).version, 2);
  });

  await step('PERSONALIZATION_HISTORY_RESTORES_APPEARANCE_WITH_CURRENT_RULES', async h => {
    await h.patchSettings({ gymName: 'First visual', accessGraceDays: 5, roleDefaults: { finance: { tableDensity: 'comfortable' } } }, 1);
    const defaults = { finance: { tableDensity: 'compact', homePage: 'invoices' } };
    await h.patchSettings({ gymName: 'Second visual', accessGraceDays: 22, roleDefaults: defaults }, 2);
    const restored = await (await service.restoreSettings(request('settings/history/2/restore', { version: 3 }, 'POST'), h.db, h.owner, 2)).json();
    assert.equal(restored.version, 4); assert.equal(restored.settings.gymName, 'First visual');
    assert.equal(restored.settings.accessGraceDays, 22); assert.deepEqual(restored.settings.roleDefaults, defaults);
    const row = h.sql.prepare('SELECT source,restored_from,value FROM settings_history WHERE version=4').get();
    assert.equal(row.source, 'restore'); assert.equal(row.restored_from, 2);
    assert.deepEqual(JSON.parse(row.value), restored.settings);
    await assert.rejects(service.restoreSettings(request('settings/history/2/restore', { version: 3 }, 'POST'), h.db, h.owner, 2), expectedError(409));
    assert.equal(h.count('settings_history'), 4);
  });

  await step('PERSONALIZATION_RESTORE_REVALIDATES_CURRENT_VERSION_AT_COMMIT', async h => {
    await h.patchSettings({ gymName: 'New visual' }, 1);
    h.hooks.beforeBatch = () => { h.hooks.beforeBatch = null; h.sql.prepare("UPDATE settings SET version=3 WHERE id='gym'").run(); };
    await assert.rejects(service.restoreSettings(request('settings/history/1/restore', { version: 2 }, 'POST'), h.db, h.owner, 1), expectedError(409));
    assert.equal((await settingsService.readSettings(h.db)).settings.gymName, 'New visual');
    assert.equal(h.count('settings_history'), 2); assert.equal(h.count('audit_logs'), 1);
  });

  await step('PERSONALIZATION_HISTORY_PERMISSIONS_PAGINATION_AND_DIFF', async h => {
    await h.patchSettings({ tagline: 'Different tagline' }, 1);
    await assert.rejects(service.readSettingsHistory(url('settings/history'), h.db, h.personal), expectedError(403));
    const page = await (await service.readSettingsHistory(url('settings/history?page=1&pageSize=1'), h.db, h.owner)).json();
    assert.equal(page.total, 2); assert.equal(page.data.length, 1);
    assert.deepEqual(page.data[0].changed_keys, ['tagline']); assert.equal(page.data[0].user_name, h.owner.name);
    await assert.rejects(service.readSettingsHistory(url('settings/history?pageSize=51'), h.db, h.owner), expectedError(422));
  });

  await step('PERSONALIZATION_THEMES_AND_DRAFTS_DO_NOT_PUBLISH', async h => {
    h.insertAsset('private-logo');
    const draft = await h.theme({ name: 'Private draft', kind: 'draft', settings: { ...appearanceOf(DEFAULT_SETTINGS), gymName: 'Private appearance', logoAssetId: 'private-logo' } });
    const theme = await h.theme({ name: 'Saved theme', kind: 'theme', settings: appearanceOf(DEFAULT_SETTINGS) });
    assert.equal(draft.kind, 'draft'); assert.equal(theme.kind, 'theme');
    assert.deepEqual(await settingsService.readSettings(h.db), { settings: DEFAULT_SETTINGS, version: 1 });
    const library = await (await service.listAssets(url('assets'), h.db, h.owner)).json();
    assert.equal(library.data.find(row => row.id === 'private-logo').inUse, false);
    const themes = await (await service.handleThemes(request('settings/themes', undefined, 'GET'), url('settings/themes?kind=draft'), h.db, h.owner)).json();
    assert.equal(themes.total, 1); assert.equal(themes.data[0].id, draft.id);
    assert.equal(h.count('settings_history'), 1);
  });

  await step('PERSONALIZATION_THEME_CONCURRENT_EDIT_AND_STRICT_OPERATIONAL_BOUNDARY', async h => {
    const theme = await h.theme({ name: 'Theme', kind: 'theme', settings: appearanceOf(DEFAULT_SETTINGS) });
    const edits = await Promise.allSettled(['First', 'Second'].map(name => h.theme({ version: 1, name }, 'PATCH', theme.id)));
    assert.equal(edits.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(edits.find(row => row.status === 'rejected').reason.status, 409);
    assert.equal(h.count('audit_logs'), 2);
    for (const extra of [{ accessGraceDays: 0 }, { roleDefaults: {} }]) await assert.rejects(h.theme({ name: 'Wrong scope', kind: 'theme', settings: { ...appearanceOf(DEFAULT_SETTINGS), ...extra } }), validationError);
    await assert.rejects(h.theme({ name: 'Denied', kind: 'theme', settings: appearanceOf(DEFAULT_SETTINGS) }, 'POST', '', h.finance), expectedError(403));
    assert.equal(h.count('appearance_presets'), 1);
  });

  await step('PERSONALIZATION_THEME_REVOKED_WRITER_AND_MISSING_ASSET_ROLL_BACK', async h => {
    h.insertAsset('candidate');
    h.hooks.beforeBatch = () => { h.hooks.beforeBatch = null; h.sql.prepare("DELETE FROM assets WHERE id='candidate'").run(); };
    await assert.rejects(h.theme({ name: 'Candidate', kind: 'draft', settings: { ...appearanceOf(DEFAULT_SETTINGS), logoDarkAssetId: 'candidate' } }), expectedError(409));
    assert.equal(h.count('appearance_presets'), 0); assert.equal(h.count('audit_logs'), 0);
    h.hooks.beforeBatch = () => { h.hooks.beforeBatch = null; h.sql.prepare("UPDATE users SET active=0,version=2 WHERE id='owner'").run(); };
    await assert.rejects(h.theme({ name: 'Denied candidate', kind: 'draft', settings: appearanceOf(DEFAULT_SETTINGS) }), expectedError(409));
    assert.equal(h.count('appearance_presets'), 0); assert.equal(h.count('audit_logs'), 0);
  });

  await step('PERSONALIZATION_THEME_CORRUPTION_AND_PAGINATION_FAIL_CLOSED', async h => {
    const draft = await h.theme({ name: 'Invalid stored fixture', kind: 'draft', settings: appearanceOf(DEFAULT_SETTINGS) });
    h.sql.prepare('UPDATE appearance_presets SET value=? WHERE id=?').run(JSON.stringify({ themeMode: 'unexpected' }), draft.id);
    await assert.rejects(h.theme(undefined, 'GET', draft.id), expectedError(503));
    await assert.rejects(service.listAssets(url('assets?kind=private-data'), h.db, h.owner), expectedError(422));
    await assert.rejects(service.listAssets(url('assets?page=0'), h.db, h.owner), expectedError(422));
    await assert.rejects(service.listAssets(url('assets'), h.db, h.finance), expectedError(403));
  });

  await step('PERSONALIZATION_CLIENT_LATE_401_CANNOT_EXPIRE_NEW_SESSION', async () => {
    await clientFixture(async f => {
      clientApi.setCsrfToken('old-session-token');
      const pending = clientApi.api('/settings');
      const rejected = assert.rejects(pending, aborted);
      clientApi.setCsrfToken('new-session-token');
      f.requests[0].resolve(Response.json({ error: 'Old session expired' }, { status: 401 }));
      await rejected;
      assert.equal(f.unauthorized(), 0);
      const live = clientApi.api('/preferences', { method: 'PATCH', body: { version: 0, preferences: {} } });
      assert.equal(f.requests[1].options.headers.get('X-CSRF-Token'), 'new-session-token');
      f.requests[1].resolve(Response.json({ preferences: {}, version: 1 }));
      assert.deepEqual(await live, { preferences: {}, version: 1 });
    });
  });

  await step('PERSONALIZATION_CLIENT_LATE_ME_CANNOT_REPLACE_NEW_CSRF', async () => {
    await clientFixture(async f => {
      clientApi.setCsrfToken('old-session-token');
      const pending = clientApi.api('/me');
      const rejected = assert.rejects(pending, aborted);
      clientApi.setCsrfToken('new-session-token');
      f.requests[0].resolve(Response.json({ user: { id: 'old' }, csrfToken: 'old-session-token' }));
      await rejected;
      const live = clientApi.api('/preferences', { method: 'PATCH', body: { version: 0, preferences: {} } });
      assert.equal(f.requests[1].options.headers.get('X-CSRF-Token'), 'new-session-token');
      f.requests[1].resolve(Response.json({ preferences: {}, version: 1 }));
      await live;
      assert.equal(f.unauthorized(), 0);
    });
  });

  await step('PERSONALIZATION_CLIENT_ABORT_DURING_JSON_AND_NORMAL_SESSION_FLOW', async () => {
    await clientFixture(async f => {
      clientApi.setCsrfToken('same-session');
      const controller = new AbortController();
      let completeJson;
      const content = new Promise(resolve => { completeJson = resolve; });
      const pending = clientApi.api('/settings', { signal: controller.signal });
      const rejected = assert.rejects(pending, aborted);
      f.requests[0].resolve({ ok: true, status: 200, json: () => content });
      await Promise.resolve();
      controller.abort(); completeJson({ csrfToken: 'should-not-be-used', settings: {} });
      await rejected;
      const current = clientApi.api('/me');
      f.requests[1].resolve(Response.json({ csrfToken: 'same-session', user: { id: 'current' } }));
      assert.equal((await current).user.id, 'current');
      const write = clientApi.api('/preferences', { method: 'PATCH', body: { version: 0, preferences: {} } });
      assert.equal(f.requests[2].options.headers.get('X-CSRF-Token'), 'same-session');
      f.requests[2].resolve(Response.json({ error: 'This active session expired' }, { status: 401 }));
      await assert.rejects(write, error => error instanceof clientApi.ApiError && error.status === 401);
      assert.equal(f.unauthorized(), 1, 'Uma401 da sessão atual ainda precisa acionar a saída normal.');
    });
  });

  await step('PERSONALIZATION_ROLE_INHERITANCE_AND_USER_PRECEDENCE', async () => {
    const academy = { ...DEFAULT_SETTINGS, font: 'inter', sidebarPosition: 'right', themeMode: 'light', roleDefaults: { finance: { font: 'system', sidebarMode: 'compact', textScale: 110 } } };
    const effective = resolvePreferences(academy, 'finance', { font: 'manrope', textScale: 120 });
    assert.equal(effective.themeMode, 'light'); assert.equal(effective.sidebarPosition, 'right');
    assert.equal(effective.sidebarMode, 'compact'); assert.equal(effective.font, 'manrope'); assert.equal(effective.textScale, 120);
    const inherited = resolvePreferences(academy, 'finance', {});
    assert.equal(inherited.font, 'system'); assert.equal(inherited.textScale, 110);
    assert.equal(resolvePreferences(academy, 'personal', {}).font, 'inter');
    assert.deepEqual(academy.roleDefaults.finance, { font: 'system', sidebarMode: 'compact', textScale: 110 }, 'Resolver não pode alterar padrões armazenados.');
  });

  await step('PERSONALIZATION_WCAG_LUMINANCE_KNOWN_VECTORS', async () => {
    assert.equal(relativeLuminance('#000000'), 0);
    assert.equal(relativeLuminance('#ffffff'), 1);
    assert.equal(relativeLuminance('#ff0000'), 0.2126);
    assert.equal(contrastRatio('#000000', '#ffffff'), 21);
    assert.equal(contrastRatio('#123456', '#123456'), 1);
    assert.ok(contrastRatio('#777777', '#ffffff') < 4.5, 'Não arredondar contraste inferior a4,5 para aprovação.');
    assert.equal(readableAccent('#ffffff', ['#101211', '#181b19']), '#ffffff');
  });

  await step('PERSONALIZATION_THEME_MATRIX_READABLE_TEXT_ACCENTS_AND_STATES', async () => {
    const accents = ['#000000', '#ffffff', '#777777', '#888888', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#b9f36b', '#123abc', '#714ebd'];
    const canvases = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff'];
    for (const mode of ['dark', 'light']) {
      for (const accentColor of accents) {
        for (const canvas of canvases) {
          const settings = { ...DEFAULT_SETTINGS, accentColor, backgroundColor: canvas, lightBackgroundColor: canvas };
          const themed = buildTheme(settings, { ...resolvePreferences(settings), themeMode: mode }, mode === 'dark');
          const tokens = themed.style;
          const surfaces = ['--bg', '--surface', '--surface-raised', '--surface-hover', '--input', '--sidebar-bg'];
          assert.ok(themed.accentContrast >= 4.5, `${mode}/${accentColor}/${canvas}: destaque legível`);
          for (const surface of surfaces) {
            for (const text of ['--text', '--muted', '--accent-visible']) assert.ok(measuredContrast(tokens[text], tokens[surface]) >= 4.5, `${mode}: ${text} em ${surface}`);
          }
          assert.ok(measuredContrast(tokens['--accent-text'], tokens['--accent']) >= 4.5, `${accentColor}: texto do botão primário`);
          for (const semantic of ['danger', 'warning', 'success', 'info']) assert.ok(measuredContrast(tokens[`--${semantic}`], tokens[`--${semantic}-surface`]) >= 4.5, `${mode}: estado ${semantic}`);
          for (const surface of ['--input', '--surface', '--surface-raised']) assert.ok(measuredContrast(tokens['--border-strong'], tokens[surface]) >= 3, `${mode}: borda identificável em ${surface}`);
        }
      }
    }
  });

  await step('PERSONALIZATION_SYSTEM_MODE_AND_TYPE_RADIUS_VALUES', async () => {
    const preferences = { ...resolvePreferences(DEFAULT_SETTINGS), themeMode: 'system', font: 'inter', textScale: 120 };
    const light = buildTheme(DEFAULT_SETTINGS, preferences, false);
    const dark = buildTheme(DEFAULT_SETTINGS, preferences, true);
    assert.equal(light.mode, 'light'); assert.equal(dark.mode, 'dark');
    assert.equal(light.style.colorScheme, 'light'); assert.equal(dark.style.colorScheme, 'dark');
    assert.equal(light.style['--text-scale'], 1.2); assert.match(light.style['--font-body'], /^Inter,/);
    const square = buildTheme({ ...DEFAULT_SETTINGS, cornerStyle: 'square' }, { ...preferences, themeMode: 'dark' }, false);
    assert.equal(square.mode, 'dark'); assert.equal(square.style['--radius-control'], '3px');
    assert.equal(buildTheme(DEFAULT_SETTINGS, { ...preferences, themeMode: 'light' }, true).mode, 'light');
  });
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  console.error(`FAIL ${failure}`); process.exitCode = 1;
} finally {
  const report = { status: failure ? 'FAIL' : 'PASS', startedAt, finishedAt: new Date().toISOString(), numericalContrastPairs: numericalPairs, maxBindings, passed: results.filter(row => row.status === 'PASS').length, failed: results.filter(row => row.status === 'FAIL').length, results };
  writeFileSync(path.join(output, 'personalization-hardening-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  rmSync(compiled, { recursive: true, force: true });
  console.log(`${report.status}: ${report.passed} gates; ${numericalPairs} pares de contraste; ${report.failed} falhas.`);
}
