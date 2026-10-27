import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'outputs');
mkdirSync(output, { recursive: true });
const compiled = mkdtempSync(path.join(output, 'domain-hardening-'));
writeFileSync(path.join(compiled, 'package.json'), '{"type":"commonjs"}');
function compile(directory) {
  for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) { compile(relative); continue; }
    if (!entry.name.endsWith('.ts')) continue;
    const target = path.join(compiled, relative.replace(/\.ts$/, '.js'));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, ts.transpileModule(readFileSync(path.join(root, relative), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: relative,
    }).outputText);
  }
}
compile('server');
const require = createRequire(import.meta.url);
const { handleDomain } = require(path.join(compiled, 'server/domain.js'));
const { rolePermissions } = require(path.join(compiled, 'server/auth.js'));
const { DEFAULT_SETTINGS, readSettings, updateSettings, uploadAsset } = require(path.join(compiled, 'server/settings.js'));
const { inspectImage } = require(path.join(compiled, 'server/image-metadata.js'));
const { addMonths, today } = require(path.join(compiled, 'server/domain/common.js'));
const migrations = readdirSync(path.join(root, 'drizzle')).filter(name => name.endsWith('.sql')).sort();
const results = [];
let maxBindings = 0;
const startedAt = new Date().toISOString();

function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  for (const migration of migrations) sql.exec(readFileSync(path.join(root, 'drizzle', migration), 'utf8'));
  let hook;
  class Query {
    constructor(text, values = []) { this.text = text; this.values = values; }
    bind(...values) { maxBindings = Math.max(maxBindings, values.length); assert.ok(values.length <= 100, 'Uma consulta deve respeitar o limite D1 de 100 parâmetros'); return new Query(this.text, values); }
    execute() {
      const statement = sql.prepare(this.text);
      if (/^\s*(SELECT|WITH|PRAGMA)/i.test(this.text)) return { success: true, results: statement.all(...this.values), meta: { changes: 0 } };
      const result = statement.run(...this.values);
      return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
    }
    async all() { return this.execute(); }
    async first(column) { const row = sql.prepare(this.text).get(...this.values) || null; return column ? row?.[column] ?? null : row; }
    async run() { return this.execute(); }
  }
  const db = {
    prepare(text) { return new Query(text); },
    async batch(queries) {
      if (hook) { const before = hook; hook = undefined; before(sql); }
      sql.exec('BEGIN IMMEDIATE');
      try { const values = queries.map(query => query.execute()); sql.exec('COMMIT'); return values; }
      catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  };
  const stamp = new Date().toISOString();
  function account(id, role) {
    sql.prepare('INSERT INTO users (id,name,login,password_hash,role,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,1)').run(id, id, `${id}@example.invalid`, 'test-only-no-login', role, stamp, stamp);
    return { id, name: id, login: `${id}@example.invalid`, role, version: 1, active: true, permissions: rolePermissions(role) };
  }
  const owner = account('owner', 'super_admin'), trainer = account('trainer', 'trainer'), other = account('other', 'trainer');
  sql.prepare("INSERT INTO settings(id,value,version,updated_at) VALUES ('gym',?,1,?)").run(JSON.stringify(DEFAULT_SETTINGS), stamp);
  for (const [id, trainerId] of [['student', trainer.id], ['second', trainer.id], ['third', other.id]]) {
    sql.prepare('INSERT INTO students(id,name,trainer_id,created_at,updated_at,version) VALUES (?,?,?,?,?,1)').run(id, id, trainerId, stamp, stamp);
  }
  sql.prepare('INSERT INTO exercises(id,name,muscle_group,created_at,updated_at,version) VALUES (?,?,?,?,?,1)').run('exercise', 'Exercise', 'Geral', stamp, stamp);
  const item = { exercise_id: 'exercise', day: 'A', sets: 3, reps: '12', rest_seconds: 60 };
  async function call(route, method = 'GET', data, actor = owner, expected = 200) {
    const request = new Request(`https://example.invalid/api/${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
    const response = await handleDomain(request, new URL(request.url), db, actor);
    assert.ok(response, `Rota precisa existir: ${route}`);
    const result = await response.json();
    assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(result)}`);
    return result;
  }
  const createClass = (instructor = trainer.id, capacity = 5) => call('classes', 'POST', { name: 'Aula', modality: 'Geral', instructor_id: instructor, starts_at: new Date(Date.now() + 86400000).toISOString(), duration_minutes: 45, capacity }, owner, 201);
  const createWorkout = (name = 'Ficha', student = 'student') => call('workouts', 'POST', { student_id: student, name, items: [item] }, owner, 201);
  async function membership() {
    const plan = await call('plans', 'POST', { name: 'Plano', price_cents: 10000, duration_months: 1 }, owner, 201);
    const record = await call('memberships', 'POST', { student_id: 'student', plan_id: plan.id, start_date: today() }, owner, 201);
    return { plan, record };
  }
  const beforeBatch = fn => { assert.equal(hook, undefined); hook = fn; };
  return { db, sql, owner, trainer, other, item, stamp, call, beforeBatch, createClass, createWorkout, membership };
}

async function check(name, fn) {
  const fixture = database();
  const start = performance.now();
  try {
    await fn(fixture);
    assert.equal(fixture.sql.prepare('SELECT count(*) n FROM transaction_guards').get().n, 0, 'Nenhum guard pode permanecer após commit/rollback');
    assert.equal(fixture.sql.prepare('PRAGMA foreign_key_check').all().length, 0, 'Referências devem permanecer íntegras');
    results.push({ name, status: 'PASS', durationMs: Math.round(performance.now() - start) });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error.message });
    throw error;
  } finally { fixture.sql.close(); }
}

const validPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGPU2GLEwMDAxMDAgKAAFFQBFLnXnXwAAAAASUVORK5CYII=', 'base64');
const validJpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAADAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCKiiivmz4s/9k=', 'base64');
const validWebp = Buffer.from('UklGRjoAAABXRUJQVlA4IC4AAADQAQCdASoCAAMAAUAmJaACdLoB+AADsAD+y7f/zBK/IN2of/WV/Mr+ZX+7sAAA', 'base64');
function settingsRequest(data) { return new Request('https://example.invalid/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); }
function assetRequest(bytes = validPng, mime = 'image/png') {
  const form = new FormData(); form.set('kind', 'logo'); form.set('file', new File([bytes], 'fixture.png', { type: mime }));
  return new Request('https://example.invalid/api/assets', { method: 'POST', body: form });
}

let failed;
try {
  await check('CLASS_PATCH_CANNOT_TAKE_OVER_ANOTHER_INSTRUCTOR', async f => {
    const cls = await f.createClass(f.other.id);
    await f.call(`classes/${cls.id}`, 'PATCH', { version: cls.version, instructor_id: f.trainer.id, name: 'Takeover' }, f.trainer, 403);
    assert.equal((await f.call(`classes/${cls.id}`)).instructor_id, f.other.id);
  });
  await check('CLASS_PATCH_REVALIDATES_OWNER_AT_COMMIT', async f => {
    const cls = await f.createClass();
    f.beforeBatch(sql => sql.prepare('UPDATE classes SET instructor_id=?,version=version+1 WHERE id=?').run(f.other.id, cls.id));
    await f.call(`classes/${cls.id}`, 'PATCH', { version: cls.version, name: 'Stale' }, f.trainer, 409);
    assert.equal((await f.call(`classes/${cls.id}`)).name, 'Aula');
  });
  await check('BOOKING_REVALIDATES_STUDENT_ASSIGNMENT', async f => {
    const cls = await f.createClass();
    f.beforeBatch(sql => sql.prepare('UPDATE students SET trainer_id=?,version=version+1 WHERE id=?').run(f.other.id, 'student'));
    await f.call(`classes/${cls.id}/book`, 'POST', { student_id: 'student' }, f.trainer, 409);
    assert.equal(f.sql.prepare('SELECT count(*) n FROM bookings').get().n, 0);
  });
  await check('BOOKING_REVALIDATES_INSTRUCTOR_ASSIGNMENT', async f => {
    const cls = await f.createClass();
    f.beforeBatch(sql => sql.prepare('UPDATE classes SET instructor_id=?,version=version+1 WHERE id=?').run(f.other.id, cls.id));
    await f.call(`classes/${cls.id}/book`, 'POST', { student_id: 'student' }, f.trainer, 409);
    assert.equal(f.sql.prepare('SELECT count(*) n FROM bookings').get().n, 0);
  });
  await check('INACTIVE_STUDENT_CAN_CANCEL_EXISTING_BOOKING', async f => {
    const cls = await f.createClass();
    await f.call(`classes/${cls.id}/book`, 'POST', { student_id: 'student' }, f.trainer, 201);
    f.sql.prepare("UPDATE students SET status='inactive',version=version+1 WHERE id='student'").run();
    await f.call(`classes/${cls.id}/unbook`, 'POST', { student_id: 'student' }, f.trainer);
    assert.equal((await f.call(`classes/${cls.id}`)).booked_count, 0);
  });
  await check('CAPACITY_REJECTS_A_SECOND_BOOKING_WITH_NO_PARTIAL_WRITES', async f => {
    const cls = await f.createClass(f.trainer.id, 1);
    await f.call(`classes/${cls.id}/book`, 'POST', { student_id: 'student' }, f.owner, 201);
    const auditBefore = f.sql.prepare('SELECT count(*) n FROM audit_logs').get().n;
    await f.call(`classes/${cls.id}/book`, 'POST', { student_id: 'second' }, f.owner, 409);
    assert.equal(f.sql.prepare('SELECT count(*) n FROM bookings').get().n, 1);
    assert.equal(f.sql.prepare('SELECT count(*) n FROM audit_logs').get().n, auditBefore);
  });
  await check('REVOKED_ACCOUNT_CANNOT_COMMIT_DOMAIN_MUTATION', async f => {
    f.beforeBatch(sql => sql.prepare('UPDATE users SET active=0,version=version+1 WHERE id=?').run(f.owner.id));
    await f.call('students', 'POST', { name: 'Must not exist' }, f.owner, 409);
    assert.equal(f.sql.prepare("SELECT count(*) n FROM students WHERE name='Must not exist'").get().n, 0);
  });
  await check('WORKOUT_ACTIVATION_PRESERVES_CONCURRENTLY_EDITED_PREVIOUS_PRESCRIPTION', async f => {
    let first = await f.createWorkout('Anterior');
    first = await f.call(`workouts/${first.id}/activate`, 'POST', { version: first.version });
    const second = await f.createWorkout('Nova');
    f.beforeBatch(sql => sql.prepare('UPDATE workouts SET name=?,version=version+1 WHERE id=?').run('Revisão concorrente', first.id));
    await f.call(`workouts/${second.id}/activate`, 'POST', { version: second.version }, f.owner, 409);
    assert.equal((await f.call(`workouts/${first.id}`)).status, 'active');
    assert.equal((await f.call(`workouts/${second.id}`)).status, 'draft');
    await f.call(`workouts/${second.id}/activate`, 'POST', { version: second.version });
    const previous = await f.call(`workouts/${first.id}`);
    assert.equal(previous.status, 'archived');
    assert.ok(previous.history.some(row => JSON.parse(row.snapshot).name === 'Revisão concorrente'));
  });
  await check('WORKOUT_ACTIVATION_REJECTS_NEW_UNOBSERVED_ACTIVE_PRESCRIPTION', async f => {
    const first = await f.createWorkout('Primeira'), second = await f.createWorkout('Segunda');
    f.beforeBatch(sql => sql.prepare("UPDATE workouts SET status='active',version=version+1 WHERE id=?").run(second.id));
    await f.call(`workouts/${first.id}/activate`, 'POST', { version: first.version }, f.owner, 409);
    assert.equal((await f.call(`workouts/${second.id}`)).status, 'active');
    assert.equal(f.sql.prepare('SELECT count(*) n FROM workout_history').get().n, 0);
  });
  await check('WORKOUT_HISTORY_DOES_NOT_RECURSIVELY_EMBED_ITS_HISTORY', async f => {
    let workout = await f.createWorkout('Histórico');
    for (let index = 0; index < 40; index++) workout = await f.call(`workouts/${workout.id}`, 'PATCH', { version: workout.version, student_id: 'student', name: `Revisão ${index}`, items: [{ ...f.item, reps: String(index + 1) }] });
    const histories = f.sql.prepare('SELECT snapshot FROM workout_history WHERE workout_id=?').all(workout.id);
    assert.equal(histories.length, 40);
    assert.ok(histories.every(row => row.snapshot.length < 4000));
    assert.ok(histories.every(row => !Object.hasOwn(JSON.parse(row.snapshot), 'history')));
    assert.ok(histories.every(row => JSON.parse(row.snapshot).items.length === 1));
  });
  await check('WORKOUT_REVALIDATES_EXERCISE_STATE_AT_COMMIT', async f => {
    f.beforeBatch(sql => sql.prepare("UPDATE exercises SET status='inactive',version=version+1 WHERE id='exercise'").run());
    await f.call('workouts', 'POST', { student_id: 'student', name: 'Inválido', items: [f.item] }, f.owner, 409);
    assert.equal(f.sql.prepare('SELECT count(*) n FROM workouts').get().n, 0);
  });
  await check('WORKOUT_REVALIDATES_STUDENT_SCOPE_AT_COMMIT', async f => {
    f.beforeBatch(sql => sql.prepare("UPDATE students SET trainer_id=?,version=version+1 WHERE id='student'").run(f.other.id));
    await f.call('workouts', 'POST', { student_id: 'student', name: 'Inválido', items: [f.item] }, f.trainer, 409);
    assert.equal(f.sql.prepare('SELECT count(*) n FROM workouts').get().n, 0);
  });
  await check('MEMBERSHIP_RENEWAL_REVALIDATES_ACTIVE_STUDENT', async f => {
    const { record } = await f.membership();
    f.beforeBatch(sql => sql.prepare("UPDATE students SET status='inactive',version=version+1 WHERE id='student'").run());
    await f.call(`memberships/${record.id}/renew`, 'POST', { version: record.version }, f.owner, 409);
    assert.equal(f.sql.prepare('SELECT count(*) n FROM invoices').get().n, 1);
    assert.equal((await f.call(`memberships/${record.id}`)).end_date, record.end_date);
  });
  await check('ATTENDANCE_REVALIDATES_PLAN_RULES_AT_COMMIT', async f => {
    const { plan } = await f.membership();
    f.beforeBatch(sql => sql.prepare("UPDATE plans SET access_start='01:01',access_end='01:02',version=version+1 WHERE id=?").run(plan.id));
    await f.call('attendance/check-in', 'POST', { student_id: 'student' }, f.owner, 409);
    assert.equal(f.sql.prepare('SELECT count(*) n FROM attendance').get().n, 0);
  });
  await check('ATTENDANCE_REVALIDATES_SETTINGS_AT_COMMIT', async f => {
    await f.membership();
    f.beforeBatch(sql => sql.prepare("UPDATE settings SET value=?,version=version+1 WHERE id='gym'").run(JSON.stringify({ ...DEFAULT_SETTINGS, accessGraceDays: 0 })));
    await f.call('attendance/check-in', 'POST', { student_id: 'student' }, f.owner, 409);
    assert.equal(f.sql.prepare('SELECT count(*) n FROM attendance').get().n, 0);
  });
  await check('ZERO_VALUE_INVOICE_DOES_NOT_DENY_ACTIVE_MEMBERSHIP_ACCESS', async f => {
    const date = new Date(`${today()}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - 10);
    const plan = await f.call('plans', 'POST', { name: 'Cortesia', price_cents: 0, duration_months: 1 }, f.owner, 201);
    await f.call('memberships', 'POST', { student_id: 'student', plan_id: plan.id, start_date: date.toISOString().slice(0, 10) }, f.owner, 201);
    const invoice = (await f.call('invoices?student_id=student')).data[0];
    assert.equal(invoice.amount_cents, 0); assert.equal(invoice.is_overdue, false);
    assert.equal((await f.call('invoices?status=overdue')).total, 0);
    await f.call('attendance/check-in', 'POST', { student_id: 'student' }, f.owner, 201);
  });
  await check('MONEY_AND_QUANTITY_REJECT_BOOLEAN_NULL_AND_ARRAY_VALUES', async f => {
    for (const invalid of [true, false, null, [], [10]]) await f.call('products', 'POST', { name: 'Inválido', price_cents: invalid }, f.owner, 422);
    const valid = await f.call('products', 'POST', { name: 'Produto', price_cents: '1234' }, f.owner, 201);
    assert.equal(valid.price_cents, 1234);
  });
  await check('LONG_UTF8_SEARCH_IS_LITERAL_AND_AVOIDS_D1_LIKE_LIMIT', async f => {
    const name = `${'á'.repeat(80)}%_ O'Neil`;
    const student = await f.call('students', 'POST', { name }, f.owner, 201);
    const found = await f.call(`students?q=${encodeURIComponent(name)}`);
    assert.equal(found.total, 1); assert.equal(found.data[0].id, student.id);
    assert.equal((await f.call(`students?q=${encodeURIComponent("%' OR 1=1 --")}`)).total, 0);
    assert.equal((await f.call('students?q=%25')).total, 1, 'Percentual deve ser literal, nunca wildcard');
  });
  await check('CALENDAR_EDGE_DATES_FAIL_VALIDATION_WITHOUT_500', async f => {
    assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
    assert.equal(addMonths('0099-01-31', 1), '0099-02-28');
    const plan = await f.call('plans', 'POST', { name: 'Plano', price_cents: 1000, duration_months: 36 }, f.owner, 201);
    await f.call('memberships', 'POST', { student_id: 'student', plan_id: plan.id, start_date: '9999-12-01' }, f.owner, 422);
    assert.equal(f.sql.prepare('SELECT count(*) n FROM memberships').get().n, 0);
  });
  await check('SALE_100_PRODUCTS_RESPECTS_D1_PARAMETER_LIMIT_AND_STOCK_LEDGER', async f => {
    const items = [];
    for (let index = 0; index < 100; index++) {
      const id = `bulk-${index}`;
      f.sql.prepare('INSERT INTO products(id,name,price_cents,stock,created_at,updated_at,version) VALUES (?,?,1000,2,?,?,1)').run(id, id, f.stamp, f.stamp);
      items.push({ product_id: id, quantity: 1 });
    }
    const sale = await f.call('sales', 'POST', { method: 'pix', items, idempotencyKey: 'bulk-sale-key' }, f.owner, 201);
    assert.equal(sale.total_cents, 100000);
    assert.equal(sale.items.length, 100);
    assert.equal(f.sql.prepare('SELECT sum(stock) n FROM products').get().n, 100);
    assert.equal(f.sql.prepare('SELECT count(*) n FROM stock_movements').get().n, 100);
  });
  await check('SALE_IDEMPOTENCY_INCLUDES_NOTES_AND_ACCEPTS_COMPATIBLE_LEGACY_KEYS', async f => {
    let product = await f.call('products', 'POST', { name: 'Produto', price_cents: 1500 }, f.owner, 201);
    product = await f.call(`products/${product.id}/adjust`, 'POST', { version: product.version, quantity: 5, reason: 'Saldo inicial' });
    const input = { method: 'cash', notes: 'Original', items: [{ product_id: product.id, quantity: 1 }], idempotencyKey: 'sale-replay-test' };
    const sale = await f.call('sales', 'POST', input, f.owner, 201);
    assert.equal((await f.call('sales', 'POST', input)).id, sale.id);
    await f.call('sales', 'POST', { ...input, notes: 'Outra informação' }, f.owner, 409);
    f.sql.prepare('UPDATE operation_keys SET fingerprint=? WHERE id=?').run(JSON.stringify({ method: input.method, items: input.items }), 'sale:sale-replay-test');
    assert.equal((await f.call('sales', 'POST', input)).id, sale.id);
    await f.call('sales', 'POST', { ...input, notes: 'Outro legado' }, f.owner, 409);
    assert.equal((await f.call(`products/${product.id}`)).stock, 4);
  });
  await check('SALE_REFUND_REPLAY_CANNOT_REPLACE_ORIGINAL_JUSTIFICATION', async f => {
    let product = await f.call('products', 'POST', { name: 'Produto', price_cents: 1000 }, f.owner, 201);
    product = await f.call(`products/${product.id}/adjust`, 'POST', { version: product.version, quantity: 1, reason: 'Saldo inicial' });
    const sale = await f.call('sales', 'POST', { method: 'pix', items: [{ product_id: product.id, quantity: 1 }] }, f.owner, 201);
    const input = { version: sale.version, reason: 'Devolução original' };
    await f.call(`sales/${sale.id}/refund`, 'POST', input);
    assert.equal((await f.call(`sales/${sale.id}/refund`, 'POST', input)).replayed, true);
    await f.call(`sales/${sale.id}/refund`, 'POST', { ...input, reason: 'Justificativa alterada' }, f.owner, 409);
    assert.equal((await f.call(`products/${product.id}`)).stock, 1);
    assert.equal((await f.call(`sales/${sale.id}`)).refund_reason, input.reason);
  });
  await check('PURCHASE_REVALIDATES_ACTIVE_SUPPLIER_AT_COMMIT', async f => {
    const supplier = await f.call('suppliers', 'POST', { name: 'Fornecedor' }, f.owner, 201);
    const product = await f.call('products', 'POST', { name: 'Produto', price_cents: 1000 }, f.owner, 201);
    f.beforeBatch(sql => sql.prepare("UPDATE suppliers SET status='inactive',version=version+1 WHERE id=?").run(supplier.id));
    await f.call('purchases', 'POST', { supplier_id: supplier.id, items: [{ product_id: product.id, quantity: 1, unit_cost_cents: 500 }] }, f.owner, 409);
    assert.equal(f.sql.prepare('SELECT count(*) n FROM purchases').get().n, 0);
  });
  await check('FAILED_AUDIT_ROLLS_BACK_SALE_PAYMENT_ITEMS_AND_STOCK', async f => {
    const product = await f.call('products', 'POST', { name: 'Produto', price_cents: 1000 }, f.owner, 201);
    await f.call(`products/${product.id}/adjust`, 'POST', { version: product.version, quantity: 2, reason: 'Saldo inicial' });
    f.sql.exec("CREATE TRIGGER reject_test_audit BEFORE INSERT ON audit_logs WHEN NEW.entity='sales' BEGIN SELECT RAISE(ABORT,'test_failure'); END;");
    await f.call('sales', 'POST', { method: 'pix', items: [{ product_id: product.id, quantity: 1 }], idempotencyKey: 'rollback-sale' }, f.owner, 500);
    assert.equal(f.sql.prepare('SELECT count(*) n FROM sales').get().n, 0);
    assert.equal(f.sql.prepare('SELECT count(*) n FROM sale_items').get().n, 0);
    assert.equal(f.sql.prepare('SELECT count(*) n FROM operation_keys').get().n, 0);
    assert.equal((await f.call(`products/${product.id}`)).stock, 2);
  });
  await check('SETTINGS_STRICT_ENVELOPE_AND_STALE_UPDATE_PRESERVE_VALUES', async f => {
    await assert.rejects(updateSettings(settingsRequest({ version: 1 }), f.db, f.owner));
    await assert.rejects(updateSettings(settingsRequest({ version: 1, settings: { font: 'inter' }, unexpected: true }), f.db, f.owner));
    await updateSettings(settingsRequest({ version: 1, settings: { font: 'inter' } }), f.db, f.owner);
    await assert.rejects(updateSettings(settingsRequest({ version: 1, settings: { font: 'system' } }), f.db, f.owner), error => error.status === 409);
    assert.equal((await readSettings(f.db)).settings.font, 'inter');
  });
  await check('SETTINGS_REVALIDATES_ACTOR_AT_COMMIT', async f => {
    f.beforeBatch(sql => sql.prepare("UPDATE users SET role='reception',version=version+1 WHERE id=?").run(f.owner.id));
    await assert.rejects(updateSettings(settingsRequest({ version: 1, settings: { font: 'inter' } }), f.db, f.owner), error => error.status === 409);
    assert.equal((await readSettings(f.db)).settings.font, DEFAULT_SETTINGS.font);
  });
  await check('PNG_JPEG_WEBP_STRUCTURE_AND_DIMENSIONS', async () => {
    for (const [bytes, mime] of [[validPng, 'image/png'], [validJpeg, 'image/jpeg'], [validWebp, 'image/webp']]) {
      assert.deepEqual(inspectImage(bytes, mime), { mime, width: 2, height: 3 });
      assert.throws(() => inspectImage(bytes.subarray(0, bytes.length - 4), mime));
      assert.throws(() => inspectImage(Buffer.concat([bytes, Buffer.from('trailing')]), mime));
    }
    const corruptPng = Buffer.from(validPng); corruptPng[45] ^= 1;
    assert.throws(() => inspectImage(corruptPng, 'image/png'));
    assert.throws(() => inspectImage(validPng, 'image/jpeg'));
    const bigPng = Buffer.from(validPng); bigPng.writeUInt32BE(10001, 16);
    assert.throws(() => inspectImage(bigPng, 'image/png'), error => error.status === 400);
    const bigJpeg = Buffer.from(validJpeg), frame = bigJpeg.indexOf(Buffer.from([0xff, 0xc0])); bigJpeg.writeUInt16BE(10001, frame + 7);
    assert.throws(() => inspectImage(bigJpeg, 'image/jpeg'), error => error.status === 400);
    const bigWebp = Buffer.from(validWebp); bigWebp.writeUInt16LE(10001, 26);
    assert.throws(() => inspectImage(bigWebp, 'image/webp'), error => error.status === 400);
  });
  await check('UPLOAD_COMPENSATES_R2_WHEN_DB_OR_AUTH_COMMIT_FAILS', async f => {
    const objects = new Map();
    const bucket = { async put(key, value) { objects.set(key, value); }, async delete(key) { objects.delete(key); } };
    const response = await uploadAsset(assetRequest(), f.db, bucket, f.owner);
    assert.equal(response.status, 201);
    assert.equal(objects.size, 1);
    f.beforeBatch(sql => sql.prepare('UPDATE users SET active=0,version=version+1 WHERE id=?').run(f.owner.id));
    await assert.rejects(uploadAsset(assetRequest(), f.db, bucket, f.owner), error => error.status === 409);
    assert.equal(objects.size, 1, 'Upload sem commit SQL deve ser removido de R2');
    assert.equal(f.sql.prepare('SELECT count(*) n FROM assets').get().n, 1);
  });
} catch (error) {
  failed = error;
  console.error(error);
  process.exitCode = 1;
} finally {
  writeFileSync(path.join(output, 'domain-hardening-report.json'), `${JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), status: failed ? 'FAIL' : 'PASS', passed: results.filter(row => row.status === 'PASS').length, failed: results.filter(row => row.status === 'FAIL').length, migrations, maxBindings, results }, null, 2)}\n`);
  rmSync(compiled, { recursive: true, force: true });
}
