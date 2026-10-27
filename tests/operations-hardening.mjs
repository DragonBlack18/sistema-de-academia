import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync, cpSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import ts from 'typescript';
import { createD1Harness, readMigrations } from './support/sqlite-d1.mjs';
import { ensureLocalEnvironment } from '../scripts/local-runtime.mjs';
import { createLocalBackup, verifyLocalBackup } from '../scripts/backup-local.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
mkdirSync(path.join(root, 'outputs'), { recursive: true });
const compiled = mkdtempSync(path.join(root, 'outputs/operations-suite-'));
writeFileSync(path.join(compiled, 'package.json'), '{"type":"commonjs"}\n');
function compileDirectory(source, output) {
  mkdirSync(output, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.isDirectory()) compileDirectory(path.join(source, entry.name), path.join(output, entry.name));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) writeFileSync(path.join(output, entry.name.replace(/\.ts$/, '.js')), ts.transpileModule(readFileSync(path.join(source, entry.name), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText);
  }
}
compileDirectory(path.join(root, 'server'), path.join(compiled, 'server'));
compileDirectory(path.join(root, 'lib'), path.join(compiled, 'lib'));
const require = createRequire(import.meta.url);
const { bootstrap, verifyDatabaseSchema } = require(path.join(compiled, 'server/bootstrap.js'));
const { environmentName, validateRuntimeConfig, bootstrapCredentials } = require(path.join(compiled, 'server/config.js'));
const { productionReadiness } = require(path.join(compiled, 'server/readiness.js'));
const { hashPassword, verifyPassword, createTotpSecret, encryptSecret } = require(path.join(compiled, 'server/security.js'));
const { publicUser } = require(path.join(compiled, 'server/auth.js'));
const config = { APP_ENV: 'test', ADMIN_LOGIN: 'operations-owner@example.invalid', ADMIN_PASSWORD: 'Synthetic-bootstrap-password-93!', ENABLE_DEMO_DATA: 'false', TOTP_ENCRYPTION_KEY: '7'.repeat(64) };
const databases = [];
const database = () => { const h = createD1Harness(readMigrations(root)); databases.push(h); return h; };
const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'vitality-operations-'));
const results = [];
async function step(name, fn) { const start = Date.now(); try { await fn(); results.push({ name, status: 'PASS', durationMs: Date.now() - start }); console.log(`PASS ${name}`); } catch (error) { results.push({ name, status: 'FAIL', error: error.message }); throw error; } }

try {
  await step('PRODUCTION_CONFIGURATION_FAILS_CLOSED', async () => {
    assert.equal(environmentName({}), 'development');
    assert.throws(() => environmentName({ APP_ENV: 'unknown' }), error => error.status === 503);
    for (const bad of [{ ENABLE_DEMO_DATA: 'true' }, { ENABLE_DEMO_DATA: undefined }, { TOTP_ENCRYPTION_KEY: '' }, { TOTP_ENCRYPTION_KEY: 'z'.repeat(64) }]) assert.throws(() => validateRuntimeConfig({ ...config, APP_ENV: 'production', ...bad }), error => error.status === 503);
    assert.equal(validateRuntimeConfig({ ...config, APP_ENV: 'production' }), 'production');
    for (const bad of [{ ADMIN_PASSWORD: 'short' }, { ADMIN_LOGIN: 'bad\nlogin' }, { ADMIN_PASSWORD: 'x'.repeat(129) }]) assert.throws(() => bootstrapCredentials({ ...config, APP_ENV: 'production', ...bad }), error => error.status === 503);
  });
  const initial = database();
  await step('BOOTSTRAP_CONCURRENT_IDEMPOTENT_AND_NO_PASSWORD_RESET', async () => {
    await Promise.all(Array.from({ length: 12 }, () => bootstrap(initial.db, config)));
    assert.equal(initial.sql.prepare('SELECT count(*) n FROM users').get().n, 1);
    assert.equal(initial.sql.prepare('SELECT count(*) n FROM settings').get().n, 1);
    const owner = initial.sql.prepare('SELECT * FROM users').get();
    assert.equal(owner.must_change_password, 1); assert.equal(verifyPassword(config.ADMIN_PASSWORD, owner.password_hash), true);
    await bootstrap(initial.db, { ...config, ADMIN_PASSWORD: 'Changed-environment-not-account-42!' });
    assert.equal(initial.sql.prepare('SELECT password_hash FROM users').get().password_hash, owner.password_hash);
    assert.equal(initial.sql.prepare('SELECT count(*) n FROM seed_runs').get().n, 0);
  });
  await step('BOOTSTRAP_ISOLATED_BINDINGS_AND_FAILURE_RETRY', async () => {
    const second = database();
    await assert.rejects(bootstrap(second.db, { ...config, ADMIN_PASSWORD: '' }), error => error.status === 503);
    await bootstrap(second.db, { ...config, ADMIN_LOGIN: 'different-owner@example.invalid' });
    assert.equal(second.sql.prepare('SELECT login FROM users').get().login, 'different-owner@example.invalid');
    assert.equal(initial.sql.prepare('SELECT login FROM users').get().login, config.ADMIN_LOGIN);
  });
  await step('BOOTSTRAP_CANNOT_CREATE_OWNER_OVER_EXISTING_ACCOUNTS', async () => {
    const db = database(); const stamp = new Date().toISOString();
    db.sql.prepare("INSERT INTO users(id,name,login,password_hash,role,active,created_at,updated_at) VALUES('existing','Existing','existing@example.invalid',?,'admin',1,?,?)").run(hashPassword('Different-existing-password-42!'), stamp, stamp);
    await assert.rejects(bootstrap(db.db, config), error => error.status === 503);
    assert.equal(db.sql.prepare('SELECT count(*) n FROM users').get().n, 1);
    assert.equal(db.sql.prepare('SELECT role FROM users').get().role, 'admin');
  });
  await step('HEALTH_CHECK_REQUIRES_APPLIED_SCHEMA', async () => {
    const empty = createD1Harness([]); databases.push(empty);
    await assert.rejects(verifyDatabaseSchema(empty.db)); await verifyDatabaseSchema(initial.db);
    assert.deepEqual(initial.sql.prepare('PRAGMA foreign_key_check').all(), []);
  });
  await step('READINESS_REPORT_AUTHORIZATION_AND_REAL_BLOCKERS', async () => {
    const request = new Request('https://vitality.test/api/system/readiness');
    let owner = publicUser(initial.sql.prepare('SELECT * FROM users').get());
    await assert.rejects(productionReadiness(request, initial.db, {}, config, { ...owner, role: 'admin' }), error => error.status === 403);
    const incomplete = await productionReadiness(request, initial.db, {}, config, owner);
    assert.equal(incomplete.status, 503); const value = await incomplete.json(); assert.equal(value.ready, false);
    assert.equal(JSON.stringify(value).includes(config.ADMIN_PASSWORD), false);
    initial.sql.prepare('UPDATE users SET password_hash=?,must_change_password=0,totp_enabled=1,totp_secret=? WHERE id=?').run(hashPassword('A-different-operational-password-55!'), encryptSecret(createTotpSecret(), config.TOTP_ENCRYPTION_KEY), owner.id);
    owner = publicUser(initial.sql.prepare('SELECT * FROM users').get());
    const operational = { ...config, APP_ENV: 'production' };
    const legacy = await (await productionReadiness(request, initial.db, {}, { ...operational, ADMIN_PASSWORD: undefined }, owner)).json();
    assert.equal(legacy.checks.find(check => check.id === 'owner_password').status, 'fail', 'Remover a variável de bootstrap não libera senha legada sem auditoria de troca.');
    initial.sql.prepare("INSERT INTO audit_logs(id,user_id,action,entity,entity_id,summary,created_at) VALUES('password-change-proof',?,'password.changed','users',?,'Troca sintética para homologação',?)").run(owner.id, owner.id, new Date().toISOString());
    assert.equal((await productionReadiness(request, initial.db, {}, operational, owner)).status, 200);
    const invalidKey = await (await productionReadiness(request, initial.db, {}, { ...operational, TOTP_ENCRYPTION_KEY: '9'.repeat(64) }, owner)).json();
    assert.equal(invalidKey.checks.find(check => check.id === 'totp_decryption').status, 'fail');
    initial.sql.prepare("INSERT INTO seed_runs(id,created_at) VALUES('demo-v1',?)").run(new Date().toISOString());
    const demo = await (await productionReadiness(request, initial.db, {}, operational, owner)).json();
    assert.equal(demo.checks.find(check => check.id === 'demo_disabled').status, 'fail');
    assert.equal((await productionReadiness(new Request('http://vitality.test/api/system/readiness'), initial.db, undefined, operational, owner)).status, 503);
  });
  await step('LOCAL_SETUP_GENERATES_AND_PRESERVES_SECRETS', async () => {
    const file = path.join(fixtureRoot, 'bootstrap/.dev.vars');
    ensureLocalEnvironment(file); const before = readFileSync(file, 'utf8'); const values = parseEnv(before);
    assert.ok(values.ADMIN_PASSWORD.length >= 32); assert.match(values.TOTP_ENCRYPTION_KEY, /^[a-f0-9]{64}$/); assert.equal(values.ENABLE_DEMO_DATA, 'false');
    ensureLocalEnvironment(file); assert.equal(readFileSync(file, 'utf8'), before);
    if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
    const commented = path.join(fixtureRoot, 'commented/.dev.vars'); mkdirSync(path.dirname(commented));
    writeFileSync(commented, `ADMIN_PASSWORD="" # gerar\nTOTP_ENCRYPTION_KEY="${'5'.repeat(64)}" # preservar\n`);
    ensureLocalEnvironment(commented); const preserved = parseEnv(readFileSync(commented, 'utf8'));
    assert.ok(preserved.ADMIN_PASSWORD.length >= 32); assert.equal(preserved.TOTP_ENCRYPTION_KEY, '5'.repeat(64));
  });
  await step('OFFLINE_BACKUP_RESTORE_SQL_IMAGES_AND_ENVIRONMENT', async () => {
    const fixture = path.join(fixtureRoot, 'application'); const state = path.join(fixture, '.wrangler/state');
    mkdirSync(state, { recursive: true });
    const sqliteFile = path.join(state, 'fixture.sqlite'); initial.sql.exec(`VACUUM INTO '${sqliteFile.replaceAll("'", "''")}'`);
    writeFileSync(path.join(state, 'sample-image.bin'), Buffer.from([137, 80, 78, 71, 1, 2, 3]));
    writeFileSync(path.join(fixture, '.dev.vars'), 'TOTP_ENCRYPTION_KEY="synthetic-key-only"\n');
    const destination = path.join(fixtureRoot, 'backup'); const backup = createLocalBackup({ root: fixture, output: destination, stopped: true });
    assert.equal(backup.fileCount, 3); assert.equal(verifyLocalBackup(destination).valid, true);
    const restored = path.join(fixtureRoot, 'restored'); cpSync(destination, restored, { recursive: true });
    const sql = new DatabaseSync(path.join(restored, 'state/fixture.sqlite'), { readOnly: true });
    assert.equal(sql.prepare('SELECT login FROM users').get().login, config.ADMIN_LOGIN);
    assert.equal(sql.prepare('PRAGMA quick_check').get().quick_check, 'ok'); assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []); sql.close();
    assert.deepEqual(readFileSync(path.join(restored, 'state/sample-image.bin')), readFileSync(path.join(state, 'sample-image.bin')));
    assert.equal(readFileSync(path.join(restored, '.dev.vars'), 'utf8'), readFileSync(path.join(fixture, '.dev.vars'), 'utf8'));
    assert.throws(() => createLocalBackup({ root: fixture, output: destination, stopped: true }), /já existe/);
    assert.throws(() => createLocalBackup({ root: fixture, output: path.join(fixture, 'unsafe'), stopped: true }), /fora do projeto/);
    assert.throws(() => createLocalBackup({ root: fixture, output: path.join(fixtureRoot, 'not-stopped') }), /app-stopped/);
    writeFileSync(path.join(destination, 'state/sample-image.bin'), 'tampered'); assert.throws(() => verifyLocalBackup(destination), /Integridade/);
  });
} catch (error) { console.error(`FAIL ${error.message}`); process.exitCode = 1; }
finally {
  for (const db of databases) db.sql.close();
  writeFileSync(path.join(root, 'outputs/operations-hardening-report.json'), JSON.stringify({ status: process.exitCode ? 'FAIL' : 'PASS', passed: results.filter(row => row.status === 'PASS').length, failed: results.filter(row => row.status === 'FAIL').length, results }, null, 2) + '\n');
  rmSync(compiled, { recursive: true, force: true }); rmSync(fixtureRoot, { recursive: true, force: true });
}
