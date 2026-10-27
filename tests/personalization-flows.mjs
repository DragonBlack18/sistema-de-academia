import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpClient, baseUrl, expectDenied, requireTestEnvironment } from './http-client.mjs';

requireTestEnvironment();
const root = fileURLToPath(new URL('../', import.meta.url));
const restart = process.argv.includes('--persistence');
const reportPath = path.resolve(root, process.env.VG_PERSONALIZATION_REPORT || (restart ? 'outputs/personalization-restart-report.json' : 'outputs/personalization-flows-report.json'));
const statePath = path.resolve(root, process.env.VG_PERSONALIZATION_STATE || 'outputs/personalization-state.json');
const startedAt = new Date().toISOString();
const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
const tag = `Personalização QA ${runId}`;
const roles = ['super_admin', 'admin', 'manager', 'reception', 'finance', 'trainer', 'personal'];
const owner = new HttpClient();
const anonymous = new HttpClient();
const clients = { super_admin: owner };
const users = {};
const fixtures = {};
const results = [];
let checks = 0;
let originalSettings;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGPU2GLEwMDAxMDAgKAAFFQBFLnXnXwAAAAASUVORK5CYII=', 'base64');

// Recreate test-only passwords from the ephemeral CI secret; snapshots contain no passwords or cookies.
const fixturePassword = id => `QA-${createHmac('sha256', process.env.VG_TEST_PASSWORD).update(id).digest('hex')}-9!`;
const equal = (actual, expected, label) => { checks += 1; assert.deepEqual(actual, expected, label); };
const denied = (response, statuses) => { checks += 1; expectDenied(response, statuses); };
const appearance = settings => Object.fromEntries(Object.entries(settings).filter(([key]) => !['accessGraceDays', 'roleDefaults'].includes(key)));
const getSettings = () => owner.ok('/settings');
const getPreferences = (client = owner) => client.ok('/preferences');
const saveSettings = async settings => {
  const current = await getSettings();
  return owner.ok('/settings', { method: 'PATCH', body: { version: current.version, settings } });
};
const savePreferences = async (preferences, client = owner) => {
  const current = await getPreferences(client);
  return client.ok('/preferences', { method: 'PATCH', body: { version: current.version, preferences } });
};
function imageForm(kind, name = `QA-${kind}-${runId}.png`) {
  const form = new FormData();
  form.set('kind', kind);
  form.set('file', new File([png], name, { type: 'image/png' }));
  return form;
}
async function step(name, run) {
  const start = performance.now();
  try {
    await run();
    results.push({ name, status: 'PASS', durationMs: Math.round(performance.now() - start) });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function main() {
  await step('PERSONALIZATION_AUTHENTICATION_AND_METHOD_BOUNDARIES', async () => {
    for (const route of ['/preferences', '/settings/history', '/settings/themes', '/assets']) denied(await anonymous.request(route), [401]);
    await owner.login();
    originalSettings = (await getSettings()).settings;
    for (const [route, method] of [['/preferences', 'DELETE'], ['/settings/history', 'PATCH'], ['/settings/themes', 'DELETE'], ['/assets', 'PATCH']]) {
      denied(await owner.request(route, { method, body: {} }), [405]);
    }
    denied(await owner.request(`/preferences/${owner.user.id}`), [404]);
  });

  await step('PERSONALIZATION_SEVEN_IDENTITIES_AND_PRIVATE_PREFERENCES', async () => {
    for (const role of roles.slice(1)) {
      users[role] = await owner.ok('/users', { method: 'POST', body: { name: `${tag} ${role}`, login: `personalization-${runId}-${role}@example.invalid`, password: fixturePassword(`${runId}:${role}`), role, active: true } });
      clients[role] = new HttpClient();
      await clients[role].login(users[role].login, fixturePassword(`${runId}:${role}`));
      const preferences = await getPreferences(clients[role]);
      equal(preferences.preferences, {});
      equal(preferences.version, 0);
    }
    for (const role of roles) {
      const client = clients[role];
      const settingsAccess = ['super_admin', 'admin'].includes(role);
      for (const resource of ['/settings', '/settings/history', '/settings/themes', '/assets']) {
        equal((await client.request(resource)).status, settingsAccess ? 200 : 403, `${role}: ${resource}`);
      }
      if (!settingsAccess) {
        denied(await client.request('/settings', { method: 'PATCH', body: {} }), [403]);
        denied(await client.request('/settings/themes', { method: 'POST', body: {} }), [403]);
        denied(await client.request('/assets', { method: 'POST', body: imageForm('logo') }), [403]);
      }
    }
  });

  await step('PERSONALIZATION_USER_VALUES_REPLACE_AND_RESET_IN_DATABASE', async () => {
    fixtures.ownerPreferences = { themeMode: 'light', font: 'inter', sidebarPosition: 'right', sidebarMode: 'compact', tableDensity: 'compact', textScale: 120, reducedMotion: 'reduce', reducedTransparency: true, homePage: 'settings', favorites: ['dashboard', 'students', 'settings'] };
    const first = await savePreferences(fixtures.ownerPreferences);
    equal(first.preferences, fixtures.ownerPreferences);
    equal((await getPreferences()).preferences, fixtures.ownerPreferences);
    equal((await getPreferences(clients.admin)).preferences, {}, 'Preferências de uma conta não podem vazar para outra.');
    const replacement = await savePreferences({ font: 'system' });
    equal(replacement.preferences, { font: 'system' }, 'Campos omitidos devem voltar à herança, não conservar a edição anterior.');
    const reset = await savePreferences({});
    equal(reset.preferences, {});
    equal(reset.version, replacement.version + 1);
    fixtures.ownerPreferences = (await savePreferences(fixtures.ownerPreferences)).preferences;
    equal((await getSettings()).settings, originalSettings, 'Preferência individual não altera a identidade global.');
  });

  await step('PERSONALIZATION_CONCURRENT_FIRST_WRITE_HAS_ONE_WINNER', async () => {
    const client = clients.personal;
    const first = await getPreferences(client);
    equal(first.version, 0);
    const writes = await Promise.all(['dark', 'light'].map(themeMode => client.request('/preferences', { method: 'PATCH', body: { version: 0, preferences: { themeMode } } })));
    equal(writes.map(value => value.status).sort(), [200, 409]);
    const persisted = await getPreferences(client);
    equal(persisted.version, 1);
    equal(persisted.preferences, writes.find(value => value.status === 200).data.preferences);
    denied(await client.request('/preferences', { method: 'PATCH', body: { version: 0, preferences: { font: 'inter' } } }), [409]);
    equal(await getPreferences(client), persisted);
  });

  await step('PERSONALIZATION_PREFERENCE_VALIDATION_AND_IDOR', async () => {
    const current = await getPreferences(clients.finance);
    const malformed = [
      { textScale: 125 }, { reducedMotion: 'disable-everything' }, { reducedTransparency: 'true' },
      { themeMode: 'url(javascript:bad)' }, { font: 'remote-font' }, { sidebarMode: 'floating' },
      { favorites: ['dashboard', 'dashboard'] }, { favorites: ['unknown-page'] }, { homePage: 'https://other.invalid/' },
      { user_id: owner.user.id }, { role: 'super_admin' }, { themeMode: null },
    ];
    for (const preferences of malformed) {
      denied(await clients.finance.request('/preferences', { method: 'PATCH', body: { version: current.version, preferences } }), [422]);
    }
    denied(await clients.finance.request('/preferences', { method: 'PATCH', body: { version: current.version, preferences: {}, user_id: owner.user.id } }), [422]);
    denied(await clients.finance.request('/preferences', { method: 'PATCH', body: { version: current.version, preferences: { homePage: 'users' } } }), [403, 422]);
    denied(await clients.personal.request('/preferences', { method: 'PATCH', body: { version: 1, preferences: { favorites: ['invoices'] } } }), [403, 422]);
    equal(await getPreferences(clients.finance), current);
    const queryAttempt = await clients.finance.request(`/preferences?user_id=${owner.user.id}`);
    if (queryAttempt.status === 200) equal(queryAttempt.data.preferences, current.preferences);
    else denied(queryAttempt, [400, 422]);
    equal((await getPreferences()).preferences, fixtures.ownerPreferences);
    fixtures.financePreferences = (await savePreferences({ themeMode: 'system', homePage: 'invoices', favorites: ['invoices', 'expenses', 'reports'], tableDensity: 'comfortable' }, clients.finance)).preferences;
  });

  await step('PERSONALIZATION_CSRF_AND_CROSS_ORIGIN_REJECTIONS', async () => {
    const prefs = await getPreferences();
    const settings = await getSettings();
    for (const [route, method, body] of [
      ['/preferences', 'PATCH', { version: prefs.version, preferences: {} }],
      ['/settings', 'PATCH', { version: settings.version, settings: { gymName: 'Sem CSRF' } }],
      ['/settings/themes', 'POST', { name: tag, kind: 'draft', settings: appearance(settings.settings) }],
    ]) {
      denied(await owner.request(route, { method, body, csrf: false }), [403]);
      denied(await owner.request(route, { method, body, headers: { Origin: 'https://other.invalid' } }), [403]);
    }
    equal((await getSettings()).version, settings.version);
    equal((await getPreferences()).version, prefs.version);
  });

  await step('PERSONALIZATION_ROLE_DEFAULTS_AND_PUBLIC_DATA_MINIMIZATION', async () => {
    fixtures.roleDefaults = { reception: { sidebarMode: 'compact', homePage: 'students', favorites: ['students', 'attendance'] }, finance: { textScale: 110, homePage: 'invoices', tableDensity: 'compact' } };
    const changed = await saveSettings({ roleDefaults: fixtures.roleDefaults, accessGraceDays: 12, themeMode: 'system', loginTitle: 'Sua academia, sua identidade.', loginWelcomeMessage: 'Entre com seu acesso individual.' });
    equal(changed.settings.roleDefaults, fixtures.roleDefaults);
    const publicBranding = await anonymous.ok('/branding');
    equal(publicBranding.settings.roleDefaults, undefined);
    equal(publicBranding.settings.accessGraceDays, undefined);
    equal(publicBranding.settings.loginTitle, 'Sua academia, sua identidade.');
    equal((await getPreferences(clients.reception)).preferences, {}, 'Padrões de perfil não podem criar escolhas individuais artificiais.');
    denied(await owner.request('/settings', { method: 'PATCH', body: { version: changed.version, settings: { roleDefaults: { finance: { homePage: 'users' } } } } }), [403, 422]);
    equal((await getSettings()).version, changed.version);
    fixtures.restoreVersion = changed.version;
    fixtures.restoreAppearance = appearance(changed.settings);
  });

  await step('PERSONALIZATION_GLOBAL_CONFLICT_WRITES_SINGLE_HISTORY', async () => {
    const before = await getSettings();
    const history = await owner.ok('/settings/history?page=1&pageSize=50');
    const writes = await Promise.all(['#2363bf', '#714ebd'].map(accentColor => owner.request('/settings', { method: 'PATCH', body: { version: before.version, settings: { accentColor } } })));
    equal(writes.map(row => row.status).sort(), [200, 409]);
    const current = await getSettings();
    equal(current.version, before.version + 1);
    equal(current.settings.accentColor, writes.find(row => row.status === 200).data.settings.accentColor);
    const after = await owner.ok('/settings/history?page=1&pageSize=50');
    equal(after.total, history.total + 1);
    const snapshot = after.data.find(row => row.version === current.version);
    assert.ok(snapshot); checks += 1;
    equal(snapshot.settings, current.settings);
    assert.ok(snapshot.changed_keys.includes('accentColor')); checks += 1;
  });

  await step('PERSONALIZATION_ASSET_LIBRARY_DRAFTS_ARE_PRIVATE', async () => {
    fixtures.logo = await owner.ok('/assets', { method: 'POST', body: imageForm('logo') });
    fixtures.wallpaper = await owner.ok('/assets', { method: 'POST', body: imageForm('wallpaper') });
    for (const asset of [fixtures.logo, fixtures.wallpaper]) {
      denied(await anonymous.request(`/assets/${asset.id}`), [401]);
      denied(await clients.personal.request(`/assets/${asset.id}`), [403]);
      equal((await owner.request(`/assets/${asset.id}`)).status, 200);
    }
    const library = await owner.ok('/assets?kind=logo&page=1&pageSize=50');
    assert.ok(library.data.every(asset => asset.kind === 'logo')); checks += 1;
    const found = library.data.find(asset => asset.id === fixtures.logo.id);
    assert.ok(found); checks += 1;
    equal(found.inUse, false);
    equal(found.object_key, undefined);
    equal(found.url, `/api/assets/${fixtures.logo.id}`);
    const current = await getSettings();
    fixtures.draft = await owner.ok('/settings/themes', { method: 'POST', body: { name: `${tag} Rascunho`, kind: 'draft', settings: { ...appearance(current.settings), gymName: 'Marca em rascunho', logoAssetId: fixtures.logo.id, loginImageAssetId: fixtures.wallpaper.id } } });
    equal(fixtures.draft.kind, 'draft');
    equal((await getSettings()).version, current.version);
    equal((await anonymous.ok('/branding')).settings.gymName, current.settings.gymName);
    denied(await anonymous.request(`/assets/${fixtures.logo.id}`), [401]);
  });

  await step('PERSONALIZATION_NAMED_THEME_UPDATE_AND_CONFLICT', async () => {
    const current = await getSettings();
    fixtures.theme = await owner.ok('/settings/themes', { method: 'POST', body: { name: `${tag} Tema`, kind: 'theme', settings: { ...appearance(current.settings), themeMode: 'light', lightBackgroundColor: '#f5f7fa' } } });
    const writes = await Promise.all(['Versão A', 'Versão B'].map(suffix => owner.request(`/settings/themes/${fixtures.theme.id}`, { method: 'PATCH', body: { version: fixtures.theme.version, name: `${tag} ${suffix}` } })));
    equal(writes.map(row => row.status).sort(), [200, 409]);
    fixtures.theme = writes.find(row => row.status === 200).data;
    equal(fixtures.theme.version, 2);
    equal((await getSettings()).version, current.version, 'Editar um tema salvo não o publica automaticamente.');
    denied(await owner.request('/settings/themes', { method: 'POST', body: { name: tag, kind: 'theme', settings: { ...appearance(current.settings), accessGraceDays: 0 } } }), [422]);
    denied(await owner.request('/settings/themes', { method: 'POST', body: { name: tag, kind: 'theme', settings: { ...appearance(current.settings), roleDefaults: {} } } }), [422]);
    denied(await owner.request(`/settings/themes/${fixtures.theme.id}`, { method: 'PATCH', body: { version: 1, name: 'Escrita antiga' } }), [409]);
    denied(await clients.finance.request(`/settings/themes/${fixtures.theme.id}`, { method: 'PATCH', body: { version: 2, name: 'Sem acesso' } }), [403]);
  });

  await step('PERSONALIZATION_PUBLISH_ASSET_VARIANTS_AND_REUSE', async () => {
    const published = await saveSettings({ logoAssetId: fixtures.logo.id, logoDarkAssetId: fixtures.logo.id, logoLightAssetId: fixtures.logo.id, faviconAssetId: fixtures.logo.id, wallpaperAssetId: fixtures.wallpaper.id, loginImageAssetId: fixtures.wallpaper.id, logoLayout: 'horizontal', showGymName: false, loginLayout: 'centered', wallpaperPosition: 'bottom', loginImagePosition: 'top' });
    for (const asset of [fixtures.logo, fixtures.wallpaper]) {
      const response = await anonymous.request(`/assets/${asset.id}`);
      equal(response.status, 200);
      equal(response.headers.get('Content-Type'), 'image/png');
      assert.match(response.headers.get('Content-Security-Policy'), /sandbox/); checks += 1;
    }
    const assets = await owner.ok('/assets?page=1&pageSize=50');
    equal(assets.data.find(asset => asset.id === fixtures.logo.id).inUse, true);
    equal(assets.data.find(asset => asset.id === fixtures.wallpaper.id).inUse, true);
    denied(await owner.request('/settings', { method: 'PATCH', body: { version: published.version, settings: { faviconAssetId: fixtures.wallpaper.id } } }), [400, 422]);
    denied(await owner.request('/settings', { method: 'PATCH', body: { version: published.version, settings: { loginImageAssetId: fixtures.logo.id } } }), [400, 422]);
    equal((await getSettings()).version, published.version);
  });

  await step('PERSONALIZATION_HISTORY_RESTORE_PRESERVES_RULES_AND_ROLE_DEFAULTS', async () => {
    const rules = { finance: { sidebarPosition: 'right', textScale: 120, homePage: 'expenses' } };
    const current = await saveSettings({ accessGraceDays: 17, roleDefaults: rules });
    const restored = await owner.ok(`/settings/history/${fixtures.restoreVersion}/restore`, { method: 'POST', body: { version: current.version } });
    equal(restored.version, current.version + 1);
    equal(appearance(restored.settings), fixtures.restoreAppearance);
    equal(restored.settings.accessGraceDays, 17);
    equal(restored.settings.roleDefaults, rules);
    const history = await owner.ok('/settings/history?page=1&pageSize=50');
    const record = history.data.find(row => row.version === restored.version);
    equal(record.source, 'restore');
    equal(record.restored_from, fixtures.restoreVersion);
    equal(record.settings, restored.settings);
    denied(await owner.request(`/settings/history/${fixtures.restoreVersion}/restore`, { method: 'POST', body: { version: current.version } }), [409]);
    denied(await clients.reception.request(`/settings/history/${fixtures.restoreVersion}/restore`, { method: 'POST', body: { version: restored.version } }), [403]);
    denied(await anonymous.request(`/assets/${fixtures.logo.id}`), [401]);
    equal((await owner.request(`/assets/${fixtures.logo.id}`)).status, 200, 'Uma imagem histórica continua reutilizável por administrador.');
    equal((await getPreferences()).preferences, fixtures.ownerPreferences);
  });

  await step('PERSONALIZATION_PAGINATION_AND_FIELD_LIMITS', async () => {
    for (const route of ['/settings/history', '/settings/themes', '/assets']) {
      const first = await owner.ok(`${route}?page=1&pageSize=1`);
      equal(first.page, 1); equal(first.pageSize, 1); assert.ok(first.data.length <= 1); checks += 1;
      if (first.total > 1) {
        const second = await owner.ok(`${route}?page=2&pageSize=1`);
        assert.notEqual(first.data[0].id ?? first.data[0].version, second.data[0].id ?? second.data[0].version); checks += 1;
      }
      denied(await owner.request(`${route}?pageSize=500`), [400, 422]);
    }
    const current = await getSettings();
    for (const settings of [{ themeMode: 'arbitrary' }, { loginTitle: 'x'.repeat(1001) }, { loginWelcomeMessage: 'x'.repeat(1001) }, { iconOverrides: { unknownPage: 'Activity' } }, { cornerStyle: 'url(bad)' }, { showGymName: 'false' }, { logoDarkAssetId: randomUUID() }, { roleDefaults: { unknownRole: {} } }]) {
      denied(await owner.request('/settings', { method: 'PATCH', body: { version: current.version, settings } }), [400, 422]);
      equal((await getSettings()).version, current.version);
    }
    denied(await owner.request('/settings/themes', { method: 'POST', body: { name: 'x'.repeat(1001), kind: 'theme', settings: appearance(current.settings) } }), [422]);
    denied(await owner.request('/assets', { method: 'POST', body: imageForm('avatar') }), [400]);
  });

  await step('PERSONALIZATION_RESTART_SNAPSHOT_WITHOUT_SECRETS', async () => {
    await saveSettings(originalSettings);
    const canonical = await getSettings();
    equal(canonical.settings, originalSettings);
    fixtures.draft = (await owner.ok('/settings/themes?kind=draft&page=1&pageSize=50')).data.find(row => row.id === fixtures.draft.id);
    assert.ok(fixtures.draft); checks += 1;
    const preferences = {};
    for (const [role, client] of Object.entries(clients)) preferences[role] = await getPreferences(client);
    const state = { runId, users: Object.fromEntries(Object.entries(users).map(([role, user]) => [role, { id: user.id, login: user.login }])), preferences, canonical, draft: fixtures.draft, theme: fixtures.theme, logoId: fixtures.logo.id, wallpaperId: fixtures.wallpaper.id, restoreVersion: fixtures.restoreVersion };
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  });
}

async function persistence() {
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  await owner.login();
  await step('PERSONALIZATION_RESTART_GLOBAL_SETTINGS_AND_HISTORY', async () => {
    equal(await getSettings(), state.canonical);
    const history = await owner.ok('/settings/history?page=1&pageSize=50');
    equal(history.data.find(row => row.version === state.canonical.version).settings, state.canonical.settings);
    assert.ok(history.data.some(row => row.version === state.restoreVersion)); checks += 1;
  });
  await step('PERSONALIZATION_RESTART_NAMED_THEME_AND_DRAFT', async () => {
    const themes = await owner.ok('/settings/themes?page=1&pageSize=50');
    equal(themes.data.find(row => row.id === state.theme.id), state.theme);
    equal(themes.data.find(row => row.id === state.draft.id), state.draft);
  });
  await step('PERSONALIZATION_RESTART_R2_IMAGES_AND_PRIVATE_VISIBILITY', async () => {
    for (const id of [state.logoId, state.wallpaperId]) {
      const asset = await owner.request(`/assets/${id}`);
      equal(asset.status, 200); equal(asset.headers.get('Content-Type'), 'image/png');
      denied(await anonymous.request(`/assets/${id}`), [401]);
    }
  });
  for (const role of roles) {
    await step(`PERSONALIZATION_RESTART_${role.toUpperCase()}_PREFERENCES`, async () => {
      const client = role === 'super_admin' ? owner : new HttpClient();
      if (role !== 'super_admin') await client.login(state.users[role].login, fixturePassword(`${state.runId}:${role}`));
      equal(await getPreferences(client), state.preferences[role]);
    });
  }
}

let failure;
try { if (restart) await persistence(); else await main(); }
catch (error) { failure = error instanceof Error ? error.message : String(error); console.error(`FAIL ${failure}`); process.exitCode = 1; }
finally {
  mkdirSync(path.dirname(reportPath), { recursive: true });
  const report = { status: failure ? 'FAIL' : 'PASS', startedAt, finishedAt: new Date().toISOString(), mode: restart ? 'restart' : 'personalization', baseUrl: baseUrl.origin, runId, checks, passed: results.filter(row => row.status === 'PASS').length, failed: results.filter(row => row.status === 'FAIL').length, results };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${report.status}: ${report.passed} gates; ${checks} verificações; ${report.failed} falhas.`);
}
