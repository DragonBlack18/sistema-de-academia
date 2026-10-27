import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const base = new URL(process.env.VG_TEST_BASE_URL || 'http://127.0.0.1:8799');
const reportPath = path.resolve(projectRoot, process.env.VG_TEST_REPORT || 'outputs/integration-report.json');
const statePath = path.resolve(projectRoot, process.env.VG_TEST_STATE || 'outputs/integration-state.json');
const ownerLogin = process.env.VG_TEST_LOGIN;
const ownerPassword = process.env.VG_TEST_PASSWORD;
const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
const tag = `QA ${runId}`;
const userPassword = `QA-${runId}-!9`;
const results = [];
const startedAt = new Date().toISOString();
const allowedHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'terminal.local']);
if (process.env.VG_TEST_ALLOW_WRITES !== '1') throw new Error('Suíte escreve dados de teste. Execute via npm run test:ci ou defina VG_TEST_ALLOW_WRITES=1 em uma base de homologação.');
if (!ownerLogin || !ownerPassword) throw new Error('Forneça VG_TEST_LOGIN e VG_TEST_PASSWORD da base de teste. Nenhuma credencial real é armazenada no código.');
if (!allowedHosts.has(base.hostname) && process.env.VG_TEST_ALLOW_REMOTE !== '1') throw new Error('Testes remotos exigem VG_TEST_ALLOW_REMOTE=1 e uma base de homologação separada.');

class Client {
  cookie = '';
  csrf = '';
  user = null;
  async request(route, { method = 'GET', body, headers = {}, csrf = true } = {}) {
    const requestHeaders = { Accept: 'application/json', Origin: base.origin, ...headers };
    if (this.cookie) requestHeaders.Cookie = this.cookie;
    if (csrf && this.csrf && !['GET', 'HEAD'].includes(method)) requestHeaders['X-CSRF-Token'] = this.csrf;
    let payload = body;
    if (body !== undefined && !(body instanceof FormData)) {
      requestHeaders['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const response = await fetch(new URL(`/api${route}`, base), { method, headers: requestHeaders, body: payload, redirect: 'manual', signal: AbortSignal.timeout(30000) });
    const cookieHeaders = response.headers.getSetCookie?.() || (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : []);
    if (cookieHeaders.length) this.cookie = cookieHeaders.map((item) => item.split(';')[0]).join('; ');
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data, headers: response.headers };
  }
  async ok(route, options = {}) {
    const result = await this.request(route, options);
    assert.ok(result.status >= 200 && result.status < 300, `${options.method || 'GET'} ${route}: HTTP ${result.status}; ${JSON.stringify(result.data).slice(0, 600)}`);
    return result.data;
  }
  async requestStream(route, content, contentType = 'application/json') {
    const headers = { Accept: 'application/json', Origin: base.origin, 'Content-Type': contentType };
    if (this.cookie) headers.Cookie = this.cookie;
    if (this.csrf) headers['X-CSRF-Token'] = this.csrf;
    const payload = Buffer.isBuffer(content) ? content : Buffer.from(content);
    async function* chunks() {
      for (let index = 0; index < payload.length; index += 65536) yield payload.subarray(index, index + 65536);
    }
    const response = await fetch(new URL(`/api${route}`, base), { method: 'POST', headers, body: chunks(), duplex: 'half', redirect: 'manual', signal: AbortSignal.timeout(30000) });
    const responseText = await response.text();
    let data;
    try { data = JSON.parse(responseText); } catch { data = responseText; }
    return { status: response.status, data, headers: response.headers };
  }
  async login(login = ownerLogin, password = ownerPassword, otp) {
    const result = await this.request('/login', { method: 'POST', body: { login, password, ...(otp ? { otp } : {}) } });
    assert.equal(result.status, 200, `Login deveria funcionar: ${JSON.stringify(result.data)}`);
    assert.ok(result.headers.get('set-cookie')?.includes('HttpOnly'), 'Cookie deve ser HttpOnly');
    assert.match(result.headers.get('set-cookie') || '', /SameSite=Strict/i, 'Cookie deve ter SameSite=Strict');
    if (base.protocol === 'https:') assert.match(result.headers.get('set-cookie') || '', /;\s*Secure/i);
    this.csrf = result.data.csrfToken;
    this.user = result.data.user;
    assert.ok(this.csrf?.length >= 16, 'Resposta de login precisa de token CSRF');
    assert.ok(this.user?.id, 'Resposta de login precisa de usuário');
    return result.data;
  }
}

const owner = new Client();
const state = {};
async function step(name, fn) {
  const start = performance.now();
  try {
    await fn();
    results.push({ name, status: 'PASS', durationMs: Math.round(performance.now() - start) });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: 'FAIL', durationMs: Math.round(performance.now() - start), error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
function denied(result, statuses = [403, 404]) { assert.ok(statuses.includes(result.status), `Esperava ${statuses.join('/')} e recebeu ${result.status}: ${JSON.stringify(result.data)}`); }
function cleanUser(user) {
  for (const key of ['password', 'password_hash', 'totp_secret', 'token_hash', 'csrf_token']) assert.equal(user[key], undefined, `Campo sensível exposto: ${key}`);
}
function isoDate(days = 0) { const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); const date = new Date(`${local}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function totp(secret, window = Math.floor(Date.now() / 30000)) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.toUpperCase().replace(/=+$/, '')) { const number = alphabet.indexOf(char); assert.ok(number >= 0); bits += number.toString(2).padStart(5, '0'); }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(parseInt(bits.slice(index, index + 8), 2));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(window));
  const hash = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = hash[hash.length - 1] & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}

async function runPersistence() {
  const saved = JSON.parse(readFileSync(statePath, 'utf8'));
  await step('RESTART_AUTH', async () => { await owner.login(); });
  await step('RESTART_SQL_RECORDS', async () => {
    const student = await owner.ok(`/students/${saved.studentId}`);
    assert.equal(student.name, saved.studentName);
    const invoice = await owner.ok(`/invoices/${saved.invoiceId}`);
    assert.equal(invoice.status, saved.invoiceStatus);
    const product = await owner.ok(`/products/${saved.productId}`);
    assert.equal(Number(product.stock), saved.productStock);
  });
  await step('RESTART_MEDIA_R2', async () => {
    const result = await owner.request(`/assets/${saved.assetId}`);
    assert.equal(result.status, 200);
    assert.match(result.headers.get('content-type') || '', /^image\/png/);
  });
  await step('RESTART_THEME', async () => {
    const response = await owner.ok('/settings');
    assert.equal(response.settings.gymName, saved.gymName);
    assert.equal(response.settings.font, saved.font);
  });
}

async function runFull() {
  await step('HEALTH_AND_PROTECTED_API', async () => {
    assert.equal((await owner.request('/health')).status, 200);
    denied(await owner.request('/students'), [401]);
    denied(await owner.request('/settings'), [401]);
  });
  await step('AUTH_LOGIN_COOKIE_CSRF', async () => {
    denied(await owner.requestStream('/login', JSON.stringify({ login: ownerLogin, password: 'x'.repeat(270000) })), [413]);
    denied(await owner.request('/login', { method: 'POST', headers: { Origin: 'https://untrusted.example' }, body: { login: ownerLogin, password: ownerPassword } }), [403]);
    denied(await owner.request('/login', { method: 'POST', body: { login: ownerLogin, password: 'wrong-password' } }), [401]);
    await owner.login();
    assert.equal(owner.user.role, 'super_admin');
    cleanUser(owner.user);
    const me = await owner.ok('/me');
    cleanUser(me.user);
    denied(await owner.request('/students', { method: 'POST', body: { name: `${tag} Sem CSRF` }, csrf: false }), [403]);
    denied(await owner.request('/students', { method: 'POST', body: { name: `${tag} Origem inválida` }, headers: { Origin: 'https://untrusted.example' } }), [403]);
  });
  await step('OWNER_GUARD_AND_ROLE_CREATION', async () => {
    const users = await owner.ok('/users?pageSize=100');
    users.data.forEach(cleanUser);
    const me = users.data.find((user) => user.id === owner.user.id);
    assert.ok(me);
    denied(await owner.request(`/users/${me.id}`, { method: 'PATCH', body: { version: me.version, active: false } }), [400, 403, 409]);
    for (const role of ['personal', 'reception', 'finance', 'admin']) {
      state[role] = await owner.ok('/users', { method: 'POST', body: { name: `${tag} ${role}`, login: `qa-${runId}-${role}@example.invalid`, password: userPassword, role, active: true } });
      cleanUser(state[role]);
      state[`${role}Client`] = new Client();
      await state[`${role}Client`].login(state[role].login, userPassword);
    }
    denied(await state.receptionClient.request('/users', { method: 'POST', body: { name: `${tag} Escalação`, login: `qa-${runId}-escalation@example.invalid`, password: userPassword, role: 'super_admin' } }), [403]);
    denied(await state.adminClient.request('/users', { method: 'POST', body: { name: `${tag} Outro admin`, login: `qa-${runId}-escalation2@example.invalid`, password: userPassword, role: 'super_admin' } }), [403]);
    denied(await state.personalClient.request('/invoices'), [403]);
    denied(await state.financeClient.request('/users'), [403]);
  });
  await step('STUDENT_VALIDATION_CREATE_EDIT_CONFLICT', async () => {
    denied(await owner.request('/students', { method: 'POST', headers: { 'Content-Type': 'text/plain' } }), [415]);
    denied(await owner.request('/students', { method: 'POST', body: { name: 'Payload de teste', notes: 'x'.repeat(270000) } }), [413]);
    denied(await owner.requestStream('/students', JSON.stringify({ name: 'Payload em fluxo', notes: 'x'.repeat(270000) })), [413]);
    denied(await owner.request('/students', { method: 'POST', body: { name: '' } }), [400, 422]);
    state.student = await owner.ok('/students', { method: 'POST', body: { name: `${tag} Aluno A`, email: `qa-${runId}@example.invalid`, phone: '49999990000', trainer_id: state.personal.id, status: 'active' } });
    state.otherStudent = await owner.ok('/students', { method: 'POST', body: { name: `${tag} Aluno B`, status: 'active' } });
    const originalVersion = state.student.version;
    state.student = await owner.ok(`/students/${state.student.id}`, { method: 'PATCH', body: { name: `${tag} Aluno atualizado`, notes: 'Persistência real verificada pela suíte.', version: originalVersion } });
    denied(await owner.request(`/students/${state.student.id}`, { method: 'PATCH', body: { notes: 'Escrita obsoleta', version: originalVersion } }), [409]);
    const persisted = await owner.ok(`/students/${state.student.id}`);
    assert.equal(persisted.name, state.student.name);
    assert.equal(persisted.notes, 'Persistência real verificada pela suíte.');
    assert.ok(persisted.version > originalVersion);
    const page = await owner.ok(`/students?q=${encodeURIComponent(tag)}&page=1&pageSize=1`);
    assert.equal(page.data.length, 1);
    assert.ok(page.total >= 2);
    assert.equal(page.pageSize, 1);
    state.otherStudent = await owner.ok(`/students/${state.otherStudent.id}`, { method: 'PATCH', body: { version: state.otherStudent.version, status: 'inactive' } });
    state.otherStudent = await owner.ok(`/students/${state.otherStudent.id}`, { method: 'PATCH', body: { version: state.otherStudent.version, name: `${tag} Aluno B atualizado` } });
    assert.equal(state.otherStudent.status, 'inactive', 'PATCH de nome não pode restaurar o status padrão do schema');
    state.otherStudent = await owner.ok(`/students/${state.otherStudent.id}`, { method: 'PATCH', body: { version: state.otherStudent.version, status: 'active' } });
  });
  await step('TRAINER_ROW_SCOPE_AND_STAFF', async () => {
    const own = await state.personalClient.ok(`/students/${state.student.id}`);
    assert.equal(own.id, state.student.id);
    denied(await state.personalClient.request(`/students/${state.otherStudent.id}`), [403, 404]);
    const list = await state.personalClient.ok(`/students?q=${encodeURIComponent(tag)}`);
    assert.ok(list.data.every((row) => row.trainer_id === state.personal.id));
    const staff = await owner.ok('/staff', { method: 'POST', body: { name: `${tag} Profissional`, position: 'Personal trainer', specialty: 'Musculação', user_id: state.personal.id, status: 'active' } });
    assert.equal(staff.user_id, state.personal.id);
  });
  await step('MEMBERSHIP_INVOICE_AND_PRICE_SNAPSHOT', async () => {
    state.plan = await owner.ok('/plans', { method: 'POST', body: { name: `${tag} Plano`, price_cents: 19900, duration_months: 1, modalities: 'Musculação', status: 'active' } });
    state.membership = await owner.ok('/memberships', { method: 'POST', body: { student_id: state.student.id, plan_id: state.plan.id, start_date: isoDate(), discount_cents: 0 } });
    assert.equal(Number(state.membership.contracted_price_cents), 19900);
    const invoices = await owner.ok('/invoices?pageSize=100');
    state.invoice = invoices.data.find((invoice) => invoice.membership_id === state.membership.id);
    assert.ok(state.invoice, 'Matrícula deve gerar cobrança');
    assert.equal(Number(state.invoice.amount_cents), 19900);
    denied(await owner.request('/memberships', { method: 'POST', body: { student_id: state.student.id, plan_id: state.plan.id, start_date: isoDate() } }), [400, 409]);
    state.plan = await owner.ok(`/plans/${state.plan.id}`, { method: 'PATCH', body: { price_cents: 29900, version: state.plan.version } });
    assert.equal(Number((await owner.ok(`/memberships/${state.membership.id}`)).contracted_price_cents), 19900);
  });
  await step('ATTENDANCE_DENIAL_IS_AUDITED', async () => {
    denied(await owner.request('/attendance/check-in', { method: 'POST', body: { student_id: state.otherStudent.id } }), [403]);
    state.overdueInvoice = await owner.ok('/invoices', { method: 'POST', body: { student_id: state.student.id, description: `${tag} Débito vencido`, amount_cents: 1000, due_date: isoDate(-10) } });
    denied(await owner.request('/attendance/check-in', { method: 'POST', body: { student_id: state.student.id } }), [403]);
    const events = await owner.ok('/access-events?pageSize=100');
    assert.ok(events.data.some((event) => event.student_id === state.student.id && event.decision === 'denied'));
  });
  await step('PAYMENT_IDEMPOTENCY_AND_CONCURRENCY', async () => {
    const repeated = { method: 'pix', version: state.overdueInvoice.version, idempotencyKey: randomUUID() };
    state.overdueInvoice = await owner.ok(`/invoices/${state.overdueInvoice.id}/pay`, { method: 'POST', body: repeated });
    const again = await owner.ok(`/invoices/${state.overdueInvoice.id}/pay`, { method: 'POST', body: repeated });
    assert.equal(again.status, 'paid');
    assert.equal((await owner.ok(`/invoices/${state.overdueInvoice.id}`)).payments.length, 1);
    const racing = await Promise.all([1, 2].map(() => owner.request(`/invoices/${state.invoice.id}/pay`, { method: 'POST', body: { method: 'cash', version: state.invoice.version, idempotencyKey: randomUUID() } })));
    assert.equal(racing.filter((result) => result.status >= 200 && result.status < 300).length, 1, 'Só um pagamento concorrente pode ser aplicado');
    denied(racing.find((result) => result.status >= 400), [400, 409]);
    state.invoice = await owner.ok(`/invoices/${state.invoice.id}`);
    assert.equal(state.invoice.status, 'paid');
    assert.equal(state.invoice.payments.length, 1);
  });
  await step('ATTENDANCE_CHECKIN_DUPLICATE_CHECKOUT', async () => {
    state.attendance = await owner.ok('/attendance/check-in', { method: 'POST', body: { student_id: state.student.id } });
    assert.ok(state.attendance.id);
    assert.equal(state.attendance.check_out, null);
    denied(await owner.request('/attendance/check-in', { method: 'POST', body: { student_id: state.student.id } }), [400, 409]);
    const exited = await owner.ok(`/attendance/${state.attendance.id}/check-out`, { method: 'POST', body: {} });
    assert.ok(exited.check_out);
  });
  await step('WORKOUT_PRESCRIPTION_SCOPE_HISTORY', async () => {
    state.exercise = await owner.ok('/exercises', { method: 'POST', body: { name: `${tag} Exercício`, muscle_group: 'Pernas', equipment: 'Máquina', instructions: 'Ficha sintética para verificação de software.', status: 'active' } });
    const payload = { student_id: state.student.id, name: `${tag} Treino`, objective: 'Verificação de prescrição', items: [{ exercise_id: state.exercise.id, day: 'A', sets: 3, reps: '12', load: '10 kg', rest_seconds: 60, notes: '' }] };
    state.workout = await state.personalClient.ok('/workouts', { method: 'POST', body: payload });
    denied(await state.personalClient.request('/workouts', { method: 'POST', body: { ...payload, student_id: state.otherStudent.id } }), [403, 404]);
    state.workout = await state.personalClient.ok(`/workouts/${state.workout.id}/activate`, { method: 'POST', body: { version: state.workout.version } });
    assert.equal(state.workout.status, 'active');
    state.workout = await state.personalClient.ok(`/workouts/${state.workout.id}`, { method: 'PATCH', body: { ...payload, items: [{ ...payload.items[0], reps: '15' }], version: state.workout.version } });
    const detail = await state.personalClient.ok(`/workouts/${state.workout.id}`);
    assert.equal(detail.items[0].reps, '15');
    assert.ok(detail.history.length >= 1, 'Treino antigo deve ser preservado');
  });
  await step('ASSESSMENT_AND_CLASS_CAPACITY', async () => {
    const assessment = await state.personalClient.ok('/assessments', { method: 'POST', body: { student_id: state.student.id, assessed_at: isoDate(), weight_kg: 80, height_cm: 180, notes: 'Dados sintéticos de teste.' } });
    assert.equal(Number(assessment.weight_kg), 80);
    state.otherMembership = await owner.ok('/memberships', { method: 'POST', body: { student_id: state.otherStudent.id, plan_id: state.plan.id, start_date: isoDate() } });
    state.class = await owner.ok('/classes', { method: 'POST', body: { name: `${tag} Aula`, modality: 'Funcional', instructor_id: state.personal.id, starts_at: `${isoDate(1)}T18:00:00.000Z`, duration_minutes: 45, capacity: 1, location: 'Sala QA', status: 'scheduled' } });
    const bookings = await Promise.all([state.student.id, state.otherStudent.id].map((student_id) => owner.request(`/classes/${state.class.id}/book`, { method: 'POST', body: { student_id } })));
    assert.equal(bookings.filter((result) => result.status >= 200 && result.status < 300).length, 1);
    denied(bookings.find((result) => result.status >= 400), [400, 409]);
    const detail = await owner.ok(`/classes/${state.class.id}`);
    assert.equal(Number(detail.booked_count), 1);
    assert.equal(detail.bookings.length, 1);
    await owner.ok(`/classes/${state.class.id}/unbook`, { method: 'POST', body: { student_id: detail.bookings[0].student_id } });
    assert.equal(Number((await owner.ok(`/classes/${state.class.id}`)).booked_count), 0);
  });
  await step('STOCK_PURCHASE_RECEIPT_AND_SALE', async () => {
    state.product = await owner.ok('/products', { method: 'POST', body: { name: `${tag} Produto`, sku: `QA-${runId}`, category: 'Teste', price_cents: 1500, cost_cents: 900, min_stock: 1, status: 'active' } });
    assert.equal(Number(state.product.stock), 0);
    state.product = await owner.ok(`/products/${state.product.id}`, { method: 'PATCH', body: { version: state.product.version, name: `${tag} Produto atualizado` } });
    assert.equal(Number(state.product.cost_cents), 900, 'PATCH de nome deve preservar custo não enviado');
    assert.equal(Number(state.product.min_stock), 1, 'PATCH de nome deve preservar estoque mínimo não enviado');
    state.supplier = await owner.ok('/suppliers', { method: 'POST', body: { name: `${tag} Fornecedor`, status: 'active' } });
    state.purchase = await owner.ok('/purchases', { method: 'POST', body: { supplier_id: state.supplier.id, items: [{ product_id: state.product.id, quantity: 5, unit_cost_cents: 900 }] } });
    await owner.ok(`/purchases/${state.purchase.id}/receive`, { method: 'POST', body: { version: state.purchase.version } });
    await owner.request(`/purchases/${state.purchase.id}/receive`, { method: 'POST', body: { version: state.purchase.version } });
    assert.equal(Number((await owner.ok(`/products/${state.product.id}`)).stock), 5, 'Recebimento repetido não pode duplicar estoque');
    state.sale = await owner.ok('/sales', { method: 'POST', body: { student_id: state.student.id, method: 'cash', items: [{ product_id: state.product.id, quantity: 2 }] } });
    assert.equal(Number(state.sale.total_cents), 3000);
    assert.equal(Number((await owner.ok(`/products/${state.product.id}`)).stock), 3);
    denied(await owner.request('/sales', { method: 'POST', body: { method: 'cash', items: [{ product_id: state.product.id, quantity: 4 }] } }), [400, 409]);
    assert.equal(Number((await owner.ok(`/products/${state.product.id}`)).stock), 3);
  });
  await step('SALE_REFUND_STOCK_AND_NEGATIVE_GUARD', async () => {
    await owner.ok(`/sales/${state.sale.id}/refund`, { method: 'POST', body: { version: state.sale.version, reason: 'Estorno de verificação' } });
    await owner.request(`/sales/${state.sale.id}/refund`, { method: 'POST', body: { version: state.sale.version, reason: 'Repetição controlada' } });
    state.product = await owner.ok(`/products/${state.product.id}`);
    assert.equal(Number(state.product.stock), 5);
    denied(await owner.request(`/products/${state.product.id}/adjust`, { method: 'POST', body: { version: state.product.version, quantity: -6, reason: 'Teste saldo negativo' } }), [400, 409]);
    state.product = await owner.ok(`/products/${state.product.id}`);
    assert.equal(Number(state.product.stock), 5);
    state.product = await owner.ok(`/products/${state.product.id}/adjust`, { method: 'POST', body: { version: state.product.version, quantity: 3, reason: 'Ajuste de verificação' } });
    assert.equal(Number(state.product.stock), 8);
  });
  await step('REFUND_FINANCIAL_HISTORY_AND_EXPENSE', async () => {
    state.overdueInvoice = await owner.ok(`/invoices/${state.overdueInvoice.id}`);
    const payload = { version: state.overdueInvoice.version, reason: 'Estorno da cobrança de teste', idempotencyKey: randomUUID() };
    await owner.ok(`/invoices/${state.overdueInvoice.id}/refund`, { method: 'POST', body: payload });
    await owner.ok(`/invoices/${state.overdueInvoice.id}/refund`, { method: 'POST', body: payload });
    const refunded = await owner.ok(`/invoices/${state.overdueInvoice.id}`);
    assert.equal(refunded.status, 'refunded');
    assert.equal(refunded.payments.length, 1);
    assert.equal(refunded.refunds.length, 1);
    state.expense = await owner.ok('/expenses', { method: 'POST', body: { description: `${tag} Despesa`, category: 'Outros', amount_cents: 500, due_date: isoDate(), status: 'paid', paid_at: isoDate() } });
    assert.equal(Number(state.expense.amount_cents), 500);
    denied(await owner.request(`/expenses/${state.expense.id}`, { method: 'PATCH', body: { version: state.expense.version, amount_cents: 600 } }), [400, 422]);
    state.expense = await owner.ok(`/expenses/${state.expense.id}`, { method: 'PATCH', body: { version: state.expense.version, amount_cents: 600, reason: 'Correção justificada no teste financeiro' } });
    assert.equal(Number(state.expense.amount_cents), 600);
  });
  await step('CRM_CONVERSION_AND_RECIPIENT_NOTICES', async () => {
    state.lead = await owner.ok('/leads', { method: 'POST', body: { name: `${tag} Interessado`, source: 'Teste', status: 'trial', email: `qa-${runId}-lead@example.invalid` } });
    await owner.ok(`/leads/${state.lead.id}/convert`, { method: 'POST', body: { version: state.lead.version } });
    await owner.request(`/leads/${state.lead.id}/convert`, { method: 'POST', body: { version: state.lead.version } });
    const matching = await owner.ok(`/students?q=${encodeURIComponent(`${tag} Interessado`)}`);
    assert.equal(matching.data.length, 1, 'Conversão não deve criar aluno duplicado');
    state.notice = await owner.ok('/notifications', { method: 'POST', body: { title: `${tag} Aviso`, message: 'Aviso persistente restrito ao personal de teste.', severity: 'info', recipient_id: state.personal.id } });
    assert.ok((await state.personalClient.ok('/notifications?pageSize=100')).data.some((notice) => notice.id === state.notice.id));
    assert.ok(!(await state.financeClient.ok('/notifications?pageSize=100')).data.some((notice) => notice.id === state.notice.id));
    await state.personalClient.ok(`/notifications/${state.notice.id}/read`, { method: 'POST', body: {} });
    const notice = (await state.personalClient.ok('/notifications?pageSize=100')).data.find((item) => item.id === state.notice.id);
    assert.ok(notice.is_read === true || notice.is_read === 1);
  });
  await step('SETTINGS_PERSISTENCE_CONFLICT_AND_UPLOAD', async () => {
    const original = await owner.ok('/settings');
    state.originalSettings = original.settings;
    denied(await state.receptionClient.request('/settings', { method: 'PATCH', body: { version: original.version, settings: { gymName: 'Sem permissão' } } }), [403]);
    const changed = await owner.ok('/settings', { method: 'PATCH', body: { version: original.version, settings: { font: 'system', sidebarPosition: 'right', backgroundColor: '#111111' } } });
    assert.equal(changed.settings.sidebarPosition, 'right');
    denied(await owner.request('/settings', { method: 'PATCH', body: { version: original.version, settings: { font: 'inter' } } }), [409]);
    const secondBrowser = new Client(); await secondBrowser.login();
    assert.equal((await secondBrowser.ok('/settings')).settings.sidebarPosition, 'right');
    const invalid = new FormData(); invalid.set('kind', 'logo'); invalid.set('file', new Blob(['<svg onload="x"></svg>'], { type: 'image/png' }), 'pretend.png');
    denied(await owner.request('/assets', { method: 'POST', body: invalid }), [400, 415, 422]);
    const boundary = `qa-upload-${runId}`;
    const oversizedMultipart = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nlogo\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="oversized.png"\r\nContent-Type: image/png\r\n\r\n`), Buffer.alloc(6 * 1024 * 1024, 0x61), Buffer.from(`\r\n--${boundary}--\r\n`)]);
    denied(await owner.requestStream('/assets', oversizedMultipart, `multipart/form-data; boundary=${boundary}`), [413]);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
    const valid = new FormData(); valid.set('kind', 'logo'); valid.set('file', new Blob([png], { type: 'image/png' }), 'qa-logo.png');
    state.asset = await owner.ok('/assets', { method: 'POST', body: valid });
    assert.ok(state.asset.id);
    const themed = await owner.ok('/settings', { method: 'PATCH', body: { version: changed.version, settings: { logoAssetId: state.asset.id } } });
    const anonymous = new Client();
    const publicLogo = await anonymous.request(`/assets/${state.asset.id}`);
    assert.equal(publicLogo.status, 200);
    assert.match(publicLogo.headers.get('content-type') || '', /^image\/png/);
    await owner.ok('/settings', { method: 'PATCH', body: { version: themed.version, settings: original.settings } });
    const restored = await owner.ok('/settings');
    assert.equal(restored.settings.sidebarPosition, original.settings.sidebarPosition);
  });
  await step('DASHBOARD_REPORTS_CSV_AUDIT', async () => {
    const dashboard = await owner.ok('/dashboard?days=30');
    for (const key of ['activeStudents', 'monthlyRevenue', 'openInvoices', 'todayAttendance']) assert.equal(typeof dashboard.metrics[key], 'number');
    assert.ok(Array.isArray(dashboard.revenue));
    assert.ok(Array.isArray(dashboard.attendance));
    const reports = await owner.ok('/reports?days=30');
    assert.equal(typeof reports.totals.received_cents, 'number');
    assert.ok(reports.totals.received_cents >= 19900);
    await owner.ok('/students', { method: 'POST', body: { name: `=2+2 ${tag}`, status: 'active' } });
    const csv = await owner.request('/reports?format=csv&type=students&days=30');
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type') || '', /text\/csv/);
    assert.ok(csv.data.includes(tag));
    assert.ok(csv.data.includes("'=2+2") || csv.data.includes('\t=2+2'), 'CSV deve neutralizar célula iniciada por =');
    const audit = await owner.ok('/audit?pageSize=100');
    assert.ok(audit.data.length > 0);
    assert.ok(audit.data.some((row) => row.entity_id === state.student.id));
    denied(await state.personalClient.request('/audit'), [403]);
  });
  await step('MFA_ENROLL_LOGIN_DISABLE', async () => {
    const user = state.adminClient;
    const previousSession = new Client(); await previousSession.login(state.admin.login, userPassword);
    const enrollment = await user.ok('/mfa/setup', { method: 'POST', body: { password: userPassword } });
    assert.ok(enrollment.secret && enrollment.uri?.startsWith('otpauth://'));
    // Test three distinct monotonically increasing windows within the supported ±1
    // tolerance. Avoid a boundary so this sequence stays valid on a slow CI runner.
    if (Date.now() % 30000 > 20000) await delay(30050 - Date.now() % 30000);
    const window = Math.floor(Date.now() / 30000);
    await user.ok('/mfa/enable', { method: 'POST', body: { code: totp(enrollment.secret, window - 1) } });
    denied(await previousSession.request('/me'), [401]);
    assert.equal((await user.ok('/me')).user.totpEnabled, true);
    const attempt = new Client();
    denied(await attempt.request('/login', { method: 'POST', body: { login: state.admin.login, password: userPassword } }), [401]);
    denied(await attempt.request('/login', { method: 'POST', body: { login: state.admin.login, password: userPassword, otp: totp(enrollment.secret, window - 1) } }), [401]);
    await attempt.login(state.admin.login, userPassword, totp(enrollment.secret, window));
    assert.equal((await attempt.ok('/me')).user.totpEnabled, true);
    await attempt.ok('/mfa/disable', { method: 'POST', body: { password: userPassword, code: totp(enrollment.secret, window + 1) } });
    denied(await user.request('/me'), [401]);
    assert.equal((await attempt.ok('/me')).user.totpEnabled, false);
    const normal = new Client(); await normal.login(state.admin.login, userPassword);
    assert.equal((await normal.ok('/me')).user.totpEnabled, false);
  });
  await step('MEMBERSHIP_RENEW_SUSPEND_RESUME_CANCEL_HISTORY', async () => {
    const current = await owner.ok(`/memberships/${state.membership.id}`);
    const renewed = await owner.ok(`/memberships/${current.id}/renew`, { method: 'POST', body: { version: current.version } });
    assert.equal(Number(renewed.contracted_price_cents), 19900);
    assert.equal(renewed.start_date, current.start_date, 'Renovação antecipada deve preservar início vigente');
    assert.ok(renewed.end_date > current.end_date);
    const suspended = await owner.ok(`/memberships/${current.id}/suspend`, { method: 'POST', body: { version: renewed.version, reason: 'Suspensão temporária de teste' } });
    assert.equal(suspended.status, 'suspended');
    denied(await owner.request('/attendance/check-in', { method: 'POST', body: { student_id: state.student.id } }), [403]);
    const resumed = await owner.ok(`/memberships/${current.id}/resume`, { method: 'POST', body: { version: suspended.version } });
    assert.equal(resumed.status, 'active');
    const cancelled = await owner.ok(`/memberships/${current.id}/cancel`, { method: 'POST', body: { version: resumed.version, reason: 'Cancelamento de verificação' } });
    assert.equal(cancelled.status, 'cancelled');
    assert.ok(cancelled.history.length >= 5);
    const invoices = await owner.ok(`/invoices?student_id=${state.student.id}&pageSize=100`);
    assert.ok(invoices.data.filter((invoice) => invoice.membership_id === current.id).length >= 2);
    assert.equal((await owner.ok(`/invoices/${state.invoice.id}`)).status, 'paid');
  });
  await step('ROLE_CHANGE_REVOKES_SESSION', async () => {
    const allUsers = await owner.ok('/users?pageSize=100');
    const user = allUsers.data.find((row) => row.id === state.personal.id);
    await owner.ok(`/users/${user.id}`, { method: 'PATCH', body: { version: user.version, role: 'trainer' } });
    denied(await state.personalClient.request('/me'), [401]);
  });
  await step('PASSWORD_CHANGE_AND_LOGOUT_REVOKE', async () => {
    const first = new Client(); const second = new Client();
    await first.login(state.reception.login, userPassword); await second.login(state.reception.login, userPassword);
    const updatedPassword = `${userPassword}-changed`;
    await first.ok('/password', { method: 'POST', body: { currentPassword: userPassword, newPassword: updatedPassword } });
    denied(await second.request('/me'), [401]);
    await first.login(state.reception.login, updatedPassword);
    const oldCookie = first.cookie;
    await first.ok('/logout', { method: 'POST', body: {} });
    first.cookie = oldCookie;
    denied(await first.request('/me'), [401]);
    let reception = await owner.ok(`/users/${state.reception.id}`);
    reception = await owner.ok(`/users/${reception.id}`, { method: 'PATCH', body: { version: reception.version, active: false } });
    reception = await owner.ok(`/users/${reception.id}`, { method: 'PATCH', body: { version: reception.version, name: `${tag} Recepção desativada` } });
    assert.equal(reception.active, false, 'PATCH de nome não pode reativar usuário pelo default do schema');
  });
  const settings = await owner.ok('/settings');
  mkdirSync(path.dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify({ studentId: state.student.id, studentName: state.student.name, invoiceId: state.invoice.id, invoiceStatus: 'paid', productId: state.product.id, productStock: 8, assetId: state.asset.id, gymName: settings.settings.gymName, font: settings.settings.font }, null, 2)}\n`);
}

let failed = null;
try {
  if (process.argv.includes('--persistence')) await runPersistence(); else await runFull();
} catch (error) {
  failed = error;
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  const report = { startedAt, finishedAt: new Date().toISOString(), baseUrl: base.origin, mode: process.argv.includes('--persistence') ? 'restart' : 'full', runId, status: failed ? 'FAIL' : 'PASS', passed: results.filter((item) => item.status === 'PASS').length, failed: results.filter((item) => item.status === 'FAIL').length, results };
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${report.status}: ${report.passed} gates aprovados, ${report.failed} falhas. Relatório: ${path.relative(projectRoot, reportPath)}`);
}
