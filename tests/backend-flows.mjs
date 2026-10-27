import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpClient, baseUrl, requireTestEnvironment, expectDenied, dateOffset } from './http-client.mjs';

requireTestEnvironment();
const root = fileURLToPath(new URL('../', import.meta.url));
const restart = process.argv.includes('--persistence');
const reportPath = path.resolve(root, process.env.VG_BACKEND_REPORT || (restart ? 'outputs/backend-restart-report.json' : 'outputs/backend-flows-report.json'));
const statePath = path.resolve(root, process.env.VG_BACKEND_STATE || 'outputs/backend-flows-state.json');
const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
const tag = `Backend ${runId}`;
const password = `Fixture-${runId}-!9`;
const owner = new HttpClient();
const clients = { super_admin: owner };
const users = {};
const fixture = {};
const results = [];
let checks = 0;
const startedAt = new Date().toISOString();

// This is a business-policy expectation, kept independently of server/auth.ts.
// A server permission change must be reviewed against this matrix deliberately.
const allEntities = ['students', 'staff', 'plans', 'memberships', 'invoices', 'expenses', 'exercises', 'workouts', 'assessments', 'classes', 'products', 'suppliers', 'purchases', 'sales', 'leads', 'notifications', 'users', 'audit', 'attendance', 'access-events'];
const readPolicy = {
  super_admin: allEntities,
  admin: allEntities,
  manager: allEntities.filter(value => !['users', 'audit'].includes(value)),
  reception: ['students', 'plans', 'memberships', 'exercises', 'workouts', 'classes', 'leads', 'notifications', 'attendance', 'access-events'],
  finance: ['students', 'plans', 'memberships', 'invoices', 'expenses', 'notifications'],
  trainer: ['students', 'exercises', 'workouts', 'assessments', 'classes', 'notifications', 'attendance', 'access-events'],
  personal: ['students', 'exercises', 'workouts', 'assessments', 'classes', 'notifications', 'attendance', 'access-events'],
};
const writePolicy = {
  super_admin: allEntities,
  admin: allEntities,
  manager: allEntities.filter(value => !['users', 'audit'].includes(value)),
  reception: ['students', 'memberships', 'classes', 'leads', 'attendance'],
  finance: ['invoices', 'expenses'],
  trainer: ['exercises', 'workouts', 'assessments', 'classes'],
  personal: ['exercises', 'workouts', 'assessments'],
};

async function step(name, action) {
  const started = performance.now();
  try {
    await action();
    results.push({ name, status: 'PASS', durationMs: Math.round(performance.now() - started) });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: 'FAIL', durationMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

function equal(actual, expected, message) { checks += 1; assert.deepEqual(actual, expected, message); }
function denied(response, statuses) { checks += 1; expectDenied(response, statuses); }
const create = (entity, body, client = owner) => client.ok(`/${entity}`, { method: 'POST', body });
const patch = (entity, row, body, client = owner) => client.ok(`/${entity}/${row.id}`, { method: 'PATCH', body: { version: row.version, ...body } });
const act = (entity, row, action, body = {}, client = owner) => client.ok(`/${entity}/${row.id}/${action}`, { method: 'POST', body: { version: row.version, ...body } });
const get = (entity, row, client = owner) => client.ok(`/${entity}/${row.id}`);
function cleanObject(object) {
  for (const key of ['password', 'password_hash', 'totp_secret', 'totp_last_counter', 'token_hash', 'csrf_token']) equal(object[key], undefined, `Campo confidencial não pode ser exposto: ${key}`);
}

async function main() {
  await step('FIXTURES_AND_SEVEN_REAL_IDENTITIES', async () => {
    await owner.login();
    equal(owner.user.role, 'super_admin');
    for (const role of ['admin', 'manager', 'reception', 'finance', 'trainer', 'personal']) {
      users[role] = await create('users', { name: `${tag} ${role}`, login: `backend-${runId}-${role}@example.invalid`, password, role, active: true });
      cleanObject(users[role]);
      clients[role] = new HttpClient();
      await clients[role].login(users[role].login, password);
      equal(clients[role].user.role, role);
    }
    fixture.student = await create('students', { name: `${tag} Aluno personal`, trainer_id: users.personal.id, email: `backend-${runId}@example.invalid`, phone: '49999990000', address: 'Endereço sintético', emergency_name: 'Contato sintético', emergency_phone: '49999990001', birth_date: '2000-01-02', notes: 'Registro apenas para testes', status: 'active' });
    fixture.trainerStudent = await create('students', { name: `${tag} Aluno professor`, trainer_id: users.trainer.id, status: 'active' });
    fixture.otherStudent = await create('students', { name: `${tag} Aluno sem vínculo`, status: 'active' });
    fixture.plan = await create('plans', { name: `${tag} Plano`, price_cents: 12345, duration_months: 1, modalities: 'Musculação', description: 'Plano sintético', status: 'active' });
    fixture.membership = await create('memberships', { student_id: fixture.student.id, plan_id: fixture.plan.id, start_date: dateOffset(), notes: 'Contrato sintético' });
    const invoices = await owner.ok(`/invoices?student_id=${fixture.student.id}&pageSize=100`);
    fixture.invoice = invoices.data.find(row => row.membership_id === fixture.membership.id);
    assert.ok(fixture.invoice);
  });

  await step('READ_PERMISSION_MATRIX_ALL_MODULES_SEVEN_ROLES', async () => {
    for (const [role, client] of Object.entries(clients)) {
      for (const entity of allEntities) {
        const response = await client.request(`/${entity}?page=1&pageSize=1`);
        equal(response.status, readPolicy[role].includes(entity) ? 200 : 403, `${role}: GET ${entity}`);
        if (response.status === 200) { assert.ok(Array.isArray(response.data.data), `${entity} deve ser paginado`); equal(response.data.pageSize, 1); }
      }
      equal((await client.request('/dashboard')).status, 200, `${role}: dashboard`);
      equal((await client.request('/reports')).status, ['super_admin', 'admin', 'manager', 'finance'].includes(role) ? 200 : 403, `${role}: reports`);
      equal((await client.request('/settings')).status, ['super_admin', 'admin'].includes(role) ? 200 : 403, `${role}: settings`);
    }
  });

  await step('WRITE_PERMISSION_MATRIX_REJECTS_BEFORE_VALIDATION', async () => {
    const writable = allEntities.filter(entity => !['audit', 'attendance', 'access-events'].includes(entity));
    for (const [role, client] of Object.entries(clients)) {
      for (const entity of writable.filter(value => !writePolicy[role].includes(value))) {
        denied(await client.request(`/${entity}`, { method: 'POST', body: {} }), [403]);
      }
    }
    denied(await clients.manager.request('/attendance/check-in', { method: 'POST', body: { student_id: fixture.otherStudent.id, override_reason: 'Exceção indevida' } }), [403]);
    denied(await clients.reception.request('/memberships', { method: 'POST', body: { student_id: fixture.otherStudent.id, plan_id: fixture.plan.id, start_date: dateOffset(), discount_cents: 1 } }), [403]);
    denied(await clients.admin.request(`/users/${owner.user.id}`, { method: 'PATCH', body: { version: owner.user.version, name: 'Alteração indevida' } }), [403]);
  });

  await step('STUDENT_FIELDS_FINANCE_MINIMIZATION_AND_OPTIONS_SCOPE', async () => {
    const student = await get('students', fixture.student);
    for (const key of ['email', 'phone', 'address', 'emergency_name', 'emergency_phone', 'birth_date', 'notes']) equal(student[key], fixture.student[key], `Persistência do campo ${key}`);
    const finance = await get('students', fixture.student, clients.finance);
    for (const key of ['cpf', 'birth_date', 'address', 'emergency_name', 'emergency_phone', 'notes', 'trainer_id']) equal(finance[key], undefined, `Financeiro não precisa de ${key}`);
    equal(finance.assessments.length, 0);
    equal(finance.workouts.length, 0);
    for (const role of ['trainer', 'personal']) {
      const options = await clients[role].ok('/options');
      assert.ok(options.students.every(student => student.trainer_id === users[role].id)); checks += 1;
      assert.ok(options.users.every(user => user.id === users[role].id)); checks += 1;
      equal(options.products.length, 0);
      equal(options.suppliers.length, 0);
      denied(await clients[role].request(`/students/${fixture.otherStudent.id}`), [403, 404]);
    }
    const other = await clients.reception.ok('/options');
    equal(other.products.length, 0);
    equal(other.suppliers.length, 0);
    denied(await owner.request('/students', { method: 'POST', body: { name: `${tag} Campos extras`, role: 'super_admin' } }), [422]);
    denied(await owner.request(`/students/${fixture.student.id}`, { method: 'PATCH', body: { version: fixture.student.version, id: fixture.otherStudent.id } }), [422]);
    denied(await owner.request('/students', { method: 'POST', headers: { 'Content-Type': 'text/application/json' }, body: { name: `${tag} Tipo falso` } }), [415]);
    const longName = `${tag} Ação %_ ${'Ç'.repeat(35)}`;
    const literal = await create('students', { name: longName, status: 'active' });
    const found = await owner.ok(`/students?q=${encodeURIComponent(longName)}`);
    equal(found.total, 1, 'Busca literal UTF-8 longa não pode falhar nem tratar % e _ como curingas.');
    equal(found.data[0].id, literal.id);
    denied(await owner.request('/plans', { method: 'POST', body: { name: `${tag} Tipo numérico inválido`, price_cents: false, duration_months: 1 } }), [422]);
  });

  await step('STAFF_SUPPLIER_PLAN_AND_EXERCISE_FULL_CRUD', async () => {
    fixture.staff = await create('staff', { name: `${tag} Colaborador`, position: 'Professor', specialty: 'Musculação', email: `staff-${runId}@example.invalid`, phone: '49999990002', user_id: users.trainer.id, status: 'active' });
    fixture.staff = await patch('staff', fixture.staff, { specialty: 'Força e condicionamento' });
    equal((await get('staff', fixture.staff)).specialty, 'Força e condicionamento');
    fixture.supplier = await create('suppliers', { name: `${tag} Fornecedor`, contact_name: 'Contato sintético', email: `supplier-${runId}@example.invalid`, phone: '49999990003', document: 'Documento sintético', notes: 'Somente QA', status: 'active' });
    fixture.supplier = await patch('suppliers', fixture.supplier, { contact_name: 'Contato atualizado' });
    equal((await get('suppliers', fixture.supplier)).contact_name, 'Contato atualizado');
    fixture.plan = await patch('plans', fixture.plan, { description: 'Condições atualizadas', access_start: '05:00', access_end: '23:00' });
    equal((await get('plans', fixture.plan)).access_start, '05:00');
    equal((await get('memberships', fixture.membership)).contracted_price_cents, 12345);
    denied(await owner.request(`/plans/${fixture.plan.id}`, { method: 'PATCH', body: { version: fixture.plan.version, access_end: null } }), [422]);
    fixture.plan = await patch('plans', fixture.plan, { access_start: null, access_end: null });
    fixture.exercise = await create('exercises', { name: `${tag} Exercício`, muscle_group: 'Pernas', equipment: 'Máquina', video_url: 'https://example.invalid/demo', instructions: 'Instruções sintéticas', status: 'active' });
    fixture.exercise = await patch('exercises', fixture.exercise, { instructions: 'Orientações atualizadas' }, clients.trainer);
    equal((await get('exercises', fixture.exercise)).video_url, 'https://example.invalid/demo');
    denied(await owner.request('/exercises', { method: 'POST', body: { name: `${tag} Vídeo inseguro`, muscle_group: 'Pernas', video_url: 'javascript:alert(1)' } }), [422]);
    denied(await owner.request(`/suppliers/${fixture.supplier.id}`, { method: 'PATCH', body: { version: 1, notes: 'Versão antiga' } }), [409]);
  });

  await step('ASSESSMENT_EDIT_IMMUTABILITY_AND_OBJECT_AUTHORIZATION', async () => {
    fixture.assessment = await create('assessments', { student_id: fixture.student.id, assessed_at: dateOffset(), weight_kg: 80, height_cm: 180, body_fat_pct: 18, waist_cm: 80, chest_cm: 100, hip_cm: 95, notes: 'Medidas sintéticas' }, clients.personal);
    equal(fixture.assessment.bmi, 24.7);
    fixture.assessment = await patch('assessments', fixture.assessment, { weight_kg: 81, waist_cm: 81, notes: 'Revisão das medidas' }, clients.personal);
    equal((await get('assessments', fixture.assessment, clients.personal)).weight_kg, 81);
    equal(fixture.assessment.height_cm, 180);
    denied(await clients.personal.request(`/assessments/${fixture.assessment.id}`, { method: 'PATCH', body: { version: fixture.assessment.version, student_id: fixture.otherStudent.id } }), [422]);
    denied(await clients.trainer.request(`/assessments/${fixture.assessment.id}`), [403, 404]);
    denied(await clients.trainer.request(`/assessments/${fixture.assessment.id}`, { method: 'PATCH', body: { version: fixture.assessment.version, weight_kg: 90 } }), [403, 404]);
    denied(await clients.personal.request('/assessments', { method: 'POST', body: { student_id: fixture.otherStudent.id, assessed_at: dateOffset(), weight_kg: 80, height_cm: 180 } }), [403, 404]);
  });

  await step('WORKOUT_ACTIVATION_EXECUTION_REPLACEMENT_AND_ARCHIVE', async () => {
    const payload = { student_id: fixture.student.id, name: `${tag} Ficha A`, objective: 'Teste de fluxo completo', items: [{ exercise_id: fixture.exercise.id, day: 'A', sets: 3, reps: '12', load: '10 kg', rest_seconds: 60, notes: 'Execução sintética' }] };
    fixture.workout = await create('workouts', payload, clients.personal);
    denied(await clients.personal.request(`/workouts/${fixture.workout.id}/complete`, { method: 'POST', body: {} }), [409]);
    fixture.workout = await act('workouts', fixture.workout, 'activate', {}, clients.personal);
    const session = await clients.personal.ok(`/workouts/${fixture.workout.id}/complete`, { method: 'POST', body: { notes: 'Sessão concluída em teste' } });
    equal(session.workout_id, fixture.workout.id);
    equal((await get('workouts', fixture.workout, clients.personal)).sessions.length, 1);
    const next = await create('workouts', { ...payload, name: `${tag} Ficha B` }, clients.personal);
    fixture.currentWorkout = await act('workouts', next, 'activate', {}, clients.personal);
    const previous = await get('workouts', fixture.workout, clients.personal);
    equal(previous.status, 'archived');
    assert.ok(previous.history.length >= 2); checks += 1;
    equal(previous.sessions.length, 1);
    denied(await clients.personal.request(`/workouts/${previous.id}`, { method: 'PATCH', body: { ...payload, version: previous.version } }), [409]);
    denied(await clients.personal.request(`/workouts/${previous.id}/complete`, { method: 'POST', body: {} }), [409]);
    fixture.currentWorkout = await act('workouts', fixture.currentWorkout, 'archive', {}, clients.personal);
    equal(fixture.currentWorkout.status, 'archived');
    denied(await clients.personal.request(`/workouts/${fixture.currentWorkout.id}/activate`, { method: 'POST', body: { version: fixture.currentWorkout.version } }), [409]);
  });

  await step('CLASSES_BOOK_UNBOOK_CAPACITY_AND_INSTRUCTOR_SCOPE', async () => {
    fixture.class = await create('classes', { name: `${tag} Aula`, modality: 'Funcional', instructor_id: users.trainer.id, starts_at: `${dateOffset(2)}T18:00:00.000Z`, duration_minutes: 45, capacity: 2, location: 'Sala sintética', status: 'scheduled' }, clients.trainer);
    await clients.trainer.ok(`/classes/${fixture.class.id}/book`, { method: 'POST', body: { student_id: fixture.trainerStudent.id } });
    denied(await clients.trainer.request(`/classes/${fixture.class.id}/book`, { method: 'POST', body: { student_id: fixture.student.id } }), [403, 404]);
    await owner.ok(`/classes/${fixture.class.id}/book`, { method: 'POST', body: { student_id: fixture.student.id } });
    denied(await owner.request(`/classes/${fixture.class.id}/book`, { method: 'POST', body: { student_id: fixture.student.id } }), [409]);
    denied(await owner.request(`/classes/${fixture.class.id}`, { method: 'PATCH', body: { version: fixture.class.version, capacity: 1 } }), [409]);
    equal((await get('classes', fixture.class)).capacity, 2);
    equal((await get('classes', fixture.class, clients.trainer)).bookings.length, 1, 'Professor só visualiza os alunos vinculados.');
    denied(await clients.personal.request(`/classes/${fixture.class.id}/unbook`, { method: 'POST', body: { student_id: fixture.student.id } }), [403]);
    await owner.ok(`/classes/${fixture.class.id}/unbook`, { method: 'POST', body: { student_id: fixture.student.id } });
    denied(await owner.request(`/classes/${fixture.class.id}/unbook`, { method: 'POST', body: { student_id: fixture.student.id } }), [404]);
    await clients.trainer.ok(`/classes/${fixture.class.id}/unbook`, { method: 'POST', body: { student_id: fixture.trainerStudent.id } });
    fixture.class = await patch('classes', fixture.class, { status: 'cancelled', capacity: 1 });
    denied(await owner.request(`/classes/${fixture.class.id}/book`, { method: 'POST', body: { student_id: fixture.otherStudent.id } }), [409]);
    equal((await get('classes', fixture.class)).bookings.length, 0);
  });

  await step('INACTIVE_STUDENT_BOOKING_CAN_BE_CANCELLED', async () => {
    const cls = await create('classes', { name: `${tag} Limpeza de reserva`, modality: 'Funcional', instructor_id: users.trainer.id, starts_at: `${dateOffset(3)}T18:00:00.000Z`, duration_minutes: 45, capacity: 1, status: 'scheduled' });
    await owner.ok(`/classes/${cls.id}/book`, { method: 'POST', body: { student_id: fixture.otherStudent.id } });
    fixture.otherStudent = await patch('students', fixture.otherStudent, { status: 'inactive' });
    await owner.ok(`/classes/${cls.id}/unbook`, { method: 'POST', body: { student_id: fixture.otherStudent.id } });
    equal((await get('classes', cls)).bookings.length, 0);
    fixture.otherStudent = await patch('students', fixture.otherStudent, { status: 'active' });
  });

  await step('BILLING_REFUND_REPAY_CANCEL_AND_EXACT_LEDGER', async () => {
    const before = await owner.ok('/reports?days=30');
    let invoice = await create('invoices', { student_id: fixture.student.id, description: `${tag} Ciclo financeiro`, amount_cents: 777, due_date: dateOffset() });
    const paymentKey = randomUUID();
    const payload = { version: invoice.version, method: 'pix', idempotencyKey: paymentKey };
    invoice = await owner.ok(`/invoices/${invoice.id}/pay`, { method: 'POST', body: payload });
    equal((await owner.ok(`/invoices/${invoice.id}/pay`, { method: 'POST', body: payload })).payments.length, 1);
    denied(await owner.request(`/invoices/${fixture.invoice.id}/pay`, { method: 'POST', body: { ...payload, version: fixture.invoice.version } }), [409]);
    invoice = await act('invoices', invoice, 'refund', { reason: 'Reembolso sintético', idempotencyKey: randomUUID() });
    equal(invoice.refunds.length, 1);
    invoice = await act('invoices', invoice, 'pay', { method: 'card', idempotencyKey: randomUUID() });
    equal(invoice.payments.length, 2);
    equal(invoice.payments.filter(row => row.status === 'completed').length, 1);
    invoice = await act('invoices', invoice, 'refund', { reason: 'Segundo reembolso sintético', idempotencyKey: randomUUID() });
    invoice = await act('invoices', invoice, 'cancel', { reason: 'Encerramento da cobrança sintética' });
    equal(invoice.status, 'cancelled');
    equal(invoice.refunds.length, 2);
    denied(await owner.request(`/invoices/${invoice.id}/pay`, { method: 'POST', body: { version: invoice.version, method: 'cash', idempotencyKey: randomUUID() } }), [409]);
    const after = await owner.ok('/reports?days=30');
    equal(after.totals.received_cents - before.totals.received_cents, 1554);
    equal(after.totals.invoice_refunded_cents - before.totals.invoice_refunded_cents, 1554);
    equal(after.totals.net_cents, before.totals.net_cents);
    fixture.cancelledInvoice = invoice;
  });

  await step('EXPENSE_PAID_EDIT_REASON_AND_CANCELLATION_PERSIST', async () => {
    fixture.expense = await create('expenses', { description: `${tag} Despesa`, category: 'Outros', amount_cents: 500, due_date: dateOffset(), status: 'open' }, clients.finance);
    fixture.expense = await patch('expenses', fixture.expense, { status: 'paid' }, clients.finance);
    equal(fixture.expense.paid_at, dateOffset());
    denied(await clients.finance.request(`/expenses/${fixture.expense.id}`, { method: 'PATCH', body: { version: fixture.expense.version, amount_cents: 600 } }), [422]);
    fixture.expense = await patch('expenses', fixture.expense, { amount_cents: 600, reason: 'Correção documentada' }, clients.finance);
    fixture.expense = await patch('expenses', fixture.expense, { status: 'cancelled', reason: 'Cancelamento documentado' }, clients.finance);
    equal(fixture.expense.paid_at, null);
    equal((await get('expenses', fixture.expense, clients.finance)).status, 'cancelled');
  });

  await step('FREE_CONTRACT_OVERDUE_ZERO_INVOICE_DOES_NOT_BLOCK_ACCESS', async () => {
    const student = await create('students', { name: `${tag} Contrato gratuito`, status: 'active' });
    const plan = await create('plans', { name: `${tag} Plano gratuito`, price_cents: 0, duration_months: 1, status: 'active' });
    const membership = await create('memberships', { student_id: student.id, plan_id: plan.id, start_date: dateOffset(-10) });
    equal(membership.contracted_price_cents, 0);
    const invoices = await owner.ok(`/invoices?student_id=${student.id}`);
    equal(invoices.total, 1);
    equal(invoices.data[0].amount_cents, 0);
    const entrance = await owner.ok('/attendance/check-in', { method: 'POST', body: { student_id: student.id } });
    equal(entrance.student_id, student.id);
    await owner.ok(`/attendance/${entrance.id}/check-out`, { method: 'POST', body: {} });
  });

  await step('PRODUCT_VALIDATION_AND_CONCURRENT_ADJUSTMENT', async () => {
    fixture.product = await create('products', { name: `${tag} Produto principal`, sku: `BE-${runId}`, category: 'Teste', price_cents: 333, cost_cents: 111, min_stock: 2, status: 'active' });
    fixture.emptyProduct = await create('products', { name: `${tag} Produto sem saldo`, price_cents: 555, status: 'active' });
    denied(await owner.request(`/products/${fixture.product.id}`, { method: 'PATCH', body: { version: fixture.product.version, stock: 100 } }), [422]);
    const adjusted = await Promise.all([1, 2].map(() => owner.request(`/products/${fixture.product.id}/adjust`, { method: 'POST', body: { version: fixture.product.version, quantity: 5, reason: 'Ajuste concorrente de teste' } })));
    equal(adjusted.filter(row => row.status === 200).length, 1);
    equal(adjusted.filter(row => row.status === 409).length, 1);
    fixture.product = await get('products', fixture.product);
    equal(fixture.product.stock, 5);
    equal(fixture.product.movements.length, 1);
    denied(await owner.request(`/products/${fixture.product.id}/adjust`, { method: 'POST', body: { version: fixture.product.version, quantity: 0, reason: 'Quantidade inválida' } }), [422]);
  });

  await step('PURCHASE_CANCEL_RECEIVE_RACE_AND_IMMUTABLE_ITEMS', async () => {
    const payload = { supplier_id: fixture.supplier.id, notes: tag, items: [{ product_id: fixture.product.id, quantity: 2, unit_cost_cents: 120 }] };
    const cancelled = await create('purchases', payload);
    await act('purchases', cancelled, 'cancel');
    denied(await owner.request(`/purchases/${cancelled.id}/receive`, { method: 'POST', body: { version: cancelled.version } }), [409]);
    equal((await get('products', fixture.product)).stock, 5);
    fixture.purchase = await create('purchases', payload);
    const receipt = await Promise.all([1, 2].map(() => owner.request(`/purchases/${fixture.purchase.id}/receive`, { method: 'POST', body: { version: fixture.purchase.version } })));
    assert.ok(receipt.some(response => response.status === 200)); checks += 1;
    assert.ok(receipt.every(response => [200, 409].includes(response.status))); checks += 1;
    fixture.purchase = await get('purchases', fixture.purchase);
    equal(fixture.purchase.status, 'received');
    equal(fixture.purchase.total_cents, 240);
    equal((await get('products', fixture.product)).stock, 7);
    equal((await get('products', fixture.product)).movements.filter(row => row.kind === 'purchase').length, 1);
    denied(await owner.request(`/purchases/${fixture.purchase.id}`, { method: 'PATCH', body: { version: fixture.purchase.version, notes: 'Alteração indevida' } }), [405]);
    denied(await owner.request('/purchases', { method: 'POST', body: { ...payload, items: [...payload.items, ...payload.items] } }), [422]);
  });

  await step('MULTI_ITEM_SALE_REJECTION_PRICE_AND_IDEMPOTENCY', async () => {
    const before = await owner.ok(`/sales?q=${encodeURIComponent(tag)}`);
    denied(await owner.request('/sales', { method: 'POST', body: { method: 'cash', notes: tag, items: [{ product_id: fixture.product.id, quantity: 1 }, { product_id: fixture.emptyProduct.id, quantity: 1 }] } }), [409]);
    equal((await get('products', fixture.product)).stock, 7);
    equal((await owner.ok(`/sales?q=${encodeURIComponent(tag)}`)).total, before.total);
    denied(await owner.request('/sales', { method: 'POST', body: { method: 'cash', items: [{ product_id: fixture.product.id, quantity: 1, unit_price_cents: 1 }] } }), [409]);
    const payload = { method: 'pix', student_id: fixture.student.id, notes: tag, idempotencyKey: randomUUID(), items: [{ product_id: fixture.product.id, quantity: 2, unit_price_cents: 333 }] };
    const raced = await Promise.all([1, 2].map(() => owner.request('/sales', { method: 'POST', body: payload })));
    assert.ok(raced.every(response => [200, 201].includes(response.status))); checks += 1;
    equal(raced[0].data.id, raced[1].data.id);
    fixture.sale = raced[0].data;
    equal(fixture.sale.total_cents, 666);
    equal((await get('products', fixture.product)).stock, 5);
    denied(await owner.request('/sales', { method: 'POST', body: { ...payload, items: [{ product_id: fixture.product.id, quantity: 1 }] } }), [409]);
    fixture.sale = await act('sales', fixture.sale, 'refund', { reason: 'Estorno sintético' });
    await act('sales', fixture.sale, 'refund', { reason: 'Estorno sintético' });
    equal((await get('products', fixture.product)).stock, 7);
    equal((await get('products', fixture.product)).movements.filter(row => row.kind === 'refund').length, 1);
  });

  await step('CRM_STAGES_CONCURRENT_CONVERSION_AND_IMMUTABILITY', async () => {
    fixture.lead = await create('leads', { name: `${tag} Contato`, email: `lead-${runId}@example.invalid`, phone: '49999990004', source: 'Site', interest: 'Musculação', notes: 'Contato sintético', status: 'new' }, clients.reception);
    fixture.lead = await patch('leads', fixture.lead, { status: 'contacted' }, clients.reception);
    fixture.lead = await patch('leads', fixture.lead, { status: 'trial' }, clients.reception);
    const converted = await Promise.all([1, 2].map(() => clients.reception.request(`/leads/${fixture.lead.id}/convert`, { method: 'POST', body: { version: fixture.lead.version } })));
    assert.ok(converted.some(response => response.status === 200)); checks += 1;
    assert.ok(converted.every(response => [200, 409].includes(response.status))); checks += 1;
    fixture.lead = await get('leads', fixture.lead);
    equal(fixture.lead.status, 'converted');
    const matching = await owner.ok(`/students?q=${encodeURIComponent(fixture.lead.email)}`);
    equal(matching.total, 1);
    equal(matching.data[0].id, fixture.lead.student_id);
    denied(await owner.request(`/leads/${fixture.lead.id}`, { method: 'PATCH', body: { version: fixture.lead.version, status: 'lost' } }), [409]);
  });

  await step('NOTIFICATION_INDIVIDUAL_READ_MARKERS_AND_IDOR', async () => {
    fixture.notice = await create('notifications', { title: `${tag} Comunicado geral`, message: 'Mensagem sintética', severity: 'warning' });
    const directed = await create('notifications', { title: `${tag} Comunicado pessoal`, message: 'Mensagem privada sintética', severity: 'info', recipient_id: users.personal.id });
    denied(await clients.trainer.request(`/notifications/${directed.id}`), [403, 404]);
    denied(await clients.trainer.request(`/notifications/${directed.id}/read`, { method: 'POST', body: {} }), [403, 404]);
    await clients.personal.ok(`/notifications/${fixture.notice.id}/read`, { method: 'POST', body: {} });
    equal(Boolean((await get('notifications', fixture.notice, clients.personal)).is_read), true);
    equal(Boolean((await get('notifications', fixture.notice, clients.trainer)).is_read), false);
    equal(Boolean((await get('notifications', fixture.notice)).is_read), false);
    await clients.personal.ok(`/notifications/${fixture.notice.id}/read`, { method: 'POST', body: {} });
    equal(Boolean((await get('notifications', fixture.notice, clients.personal)).is_read), true);
  });

  await step('SETTINGS_REJECT_UNSAFE_VALUES_AND_PRESERVE_VERSION', async () => {
    const original = await owner.ok('/settings');
    for (const invalid of [{ font: 'https://remote.invalid/font.css' }, { backgroundColor: 'url(javascript:bad)' }, { wallpaperOpacity: 1 }, { iconOverrides: { students: 'ArbitraryComponent' } }, { logoAssetId: randomUUID() }]) {
      denied(await owner.request('/settings', { method: 'PATCH', body: { version: original.version, settings: invalid } }), [400, 404, 422]);
      equal((await owner.ok('/settings')).version, original.version);
    }
    const branding = await new HttpClient().ok('/branding');
    equal(branding.settings.accessGraceDays, undefined);
    equal(branding.settings.gymName, original.settings.gymName);
  });

  await step('ROUTE_BOUNDARIES_READONLY_TABLES_AND_SECURITY_HEADERS', async () => {
    for (const route of ['/users-not-a-module', `/users/${owner.user.id}/not-an-action`, '/students/not/a/valid/path']) denied(await owner.request(route), [404, 405]);
    for (const entity of ['audit', 'attendance', 'access-events']) {
      denied(await owner.request(`/${entity}`, { method: 'POST', body: {} }), [403, 405]);
      denied(await owner.request(`/${entity}/${randomUUID()}`, { method: 'DELETE', body: {} }), [403, 405]);
    }
    const response = await owner.request('/students?page=999999&pageSize=500');
    equal(response.status, 200);
    equal(response.data.pageSize, 100);
    equal(response.headers.get('cache-control'), 'no-store');
    equal(response.headers.get('x-content-type-options'), 'nosniff');
    equal(response.headers.get('x-frame-options'), 'DENY');
    assert.match(response.headers.get('x-request-id') || '', /^[0-9a-f-]{36}$/); checks += 1;
    denied(await clients.finance.request('/reports?format=csv&type=attendance'), [403]);
    denied(await owner.request('/reports?format=csv&type=not-a-report'), [422]);
  });

  await step('HEALTH_METHODS_READINESS_RESTRICTION_AND_REQUEST_IDS', async () => {
    const anonymous = new HttpClient();
    const healthy = await anonymous.request('/health');
    equal(healthy.status, 200);
    equal(healthy.data.status, 'ok');
    const head = await anonymous.request('/health', { method: 'HEAD' });
    equal(head.status, 200);
    equal(head.data, '');
    const method = await anonymous.request('/health', { method: 'POST', body: {} });
    equal(method.status, 405);
    assert.match(method.headers.get('allow') || '', /GET/); checks += 1;
    equal(method.data.requestId, method.headers.get('x-request-id'));
    denied(await anonymous.request('/system/readiness'), [401]);
    denied(await clients.trainer.request('/system/readiness'), [403]);
    const readiness = await owner.request('/system/readiness');
    equal(readiness.status, 503, 'Ambiente local de teste não pode ser anunciado como pronto para produção.');
    equal(readiness.data.ready, false);
    equal(readiness.data.scope, 'application_configuration');
    assert.ok(readiness.data.checks.some(check => check.id === 'schema' && check.status === 'pass')); checks += 1;
    assert.ok(readiness.data.checks.some(check => check.id === 'production_mode' && check.status === 'fail')); checks += 1;
    assert.ok(readiness.data.checks.some(check => check.id === 'owner_mfa' && check.status === 'fail')); checks += 1;
    const serialized = JSON.stringify(readiness.data);
    assert.ok(!serialized.includes('password_hash') && !serialized.includes(process.env.VG_TEST_PASSWORD)); checks += 1;
  });

  await step('ACCESS_OVERRIDE_AND_CHECKOUT_WITH_PERSISTED_AUDIT', async () => {
    denied(await clients.reception.request('/attendance/check-in', { method: 'POST', body: { student_id: fixture.otherStudent.id, override_reason: 'Exceção sem autorização' } }), [403]);
    fixture.attendance = await owner.ok('/attendance/check-in', { method: 'POST', body: { student_id: fixture.otherStudent.id, override_reason: 'Acesso excepcional sintético autorizado' } });
    equal(fixture.attendance.override_reason, 'Acesso excepcional sintético autorizado');
    fixture.attendance = await owner.ok(`/attendance/${fixture.attendance.id}/check-out`, { method: 'POST', body: {} });
    assert.ok(fixture.attendance.check_out); checks += 1;
    denied(await owner.request(`/attendance/${fixture.attendance.id}/check-out`, { method: 'POST', body: {} }), [409]);
    const audit = await owner.ok(`/audit?q=${encodeURIComponent('Acesso excepcional sintético autorizado')}&pageSize=100`);
    assert.ok(audit.data.some(row => row.entity_id === fixture.attendance.id)); checks += 1;
    const events = await owner.ok(`/access-events?student_id=${fixture.otherStudent.id}&pageSize=100`);
    assert.ok(events.data.some(row => row.decision === 'allowed' && row.reason.includes('Exceção'))); checks += 1;
  });

  await step('REALLOCATION_REMOVES_OLD_TRAINER_ACCESS_IMMEDIATELY', async () => {
    fixture.student = await patch('students', fixture.student, { trainer_id: users.trainer.id });
    denied(await clients.personal.request(`/students/${fixture.student.id}`), [403, 404]);
    denied(await clients.personal.request(`/assessments/${fixture.assessment.id}`), [403, 404]);
    denied(await clients.personal.request(`/workouts/${fixture.workout.id}`), [403, 404]);
    equal((await get('students', fixture.student, clients.trainer)).id, fixture.student.id);
    equal((await get('assessments', fixture.assessment, clients.trainer)).id, fixture.assessment.id);
    equal((await get('workouts', fixture.workout, clients.trainer)).id, fixture.workout.id);
  });

  await step('USER_DUPLICATE_LOGIN_DEACTIVATION_AND_SESSION_REVOCATION', async () => {
    denied(await owner.request('/users', { method: 'POST', body: { name: `${tag} Duplicado`, login: users.manager.login.toUpperCase(), password, role: 'reception' } }), [409]);
    let manager = await owner.ok(`/users/${users.manager.id}`);
    manager = await patch('users', manager, { active: false });
    equal(manager.active, false);
    denied(await clients.manager.request('/me'), [401]);
    denied(await new HttpClient().request('/login', { method: 'POST', body: { login: manager.login, password } }), [401]);
    cleanObject(manager);
    for (const value of (await owner.ok(`/users?q=${encodeURIComponent(tag)}&pageSize=100`)).data) cleanObject(value);
  });

  await step('RESTART_SNAPSHOTS_FOR_ALL_WRITABLE_MODULES', async () => {
    const entries = [
      ['students', fixture.student, ['name', 'trainer_id', 'status', 'version']],
      ['staff', fixture.staff, ['name', 'specialty', 'user_id', 'version']],
      ['plans', fixture.plan, ['name', 'price_cents', 'access_start', 'version']],
      ['memberships', fixture.membership, ['student_id', 'contracted_price_cents', 'status']],
      ['invoices', fixture.cancelledInvoice, ['amount_cents', 'status', 'version']],
      ['expenses', fixture.expense, ['amount_cents', 'status', 'paid_at', 'version']],
      ['exercises', fixture.exercise, ['name', 'video_url', 'instructions', 'version']],
      ['workouts', fixture.workout, ['student_id', 'status', 'version']],
      ['assessments', fixture.assessment, ['student_id', 'weight_kg', 'height_cm', 'notes', 'version']],
      ['classes', fixture.class, ['name', 'status', 'capacity', 'version']],
      ['products', fixture.product, ['name', 'stock', 'cost_cents', 'version']],
      ['suppliers', fixture.supplier, ['name', 'contact_name', 'version']],
      ['purchases', fixture.purchase, ['status', 'total_cents', 'received_at', 'version']],
      ['sales', fixture.sale, ['status', 'total_cents', 'refund_reason', 'version']],
      ['leads', fixture.lead, ['status', 'student_id', 'version']],
      ['notifications', fixture.notice, ['title', 'message', 'severity']],
      ['attendance', fixture.attendance, ['check_in', 'check_out', 'override_reason']],
      ['users', users.manager, ['name', 'role', 'active', 'version']],
    ];
    const records = [];
    for (const [entity, row, fields] of entries) {
      const current = await get(entity, row);
      const expected = Object.fromEntries(fields.map(key => [key, current[key]]));
      records.push({ entity, id: row.id, expected });
    }
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify({ runId, records }, null, 2) + '\n', { mode: 0o600 });
    equal(records.length, 18);
  });
}

async function persistence() {
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  await owner.login();
  for (const row of state.records) {
    await step(`RESTART_${row.entity.toUpperCase().replaceAll('-', '_')}`, async () => {
      const current = await owner.ok(`/${row.entity}/${row.id}`);
      equal(Object.fromEntries(Object.keys(row.expected).map(key => [key, current[key]])), row.expected);
    });
  }
}

let failure;
try { if (restart) await persistence(); else await main(); }
catch (error) { failure = error instanceof Error ? error.message : String(error); console.error(`FAIL ${failure}`); process.exitCode = 1; }
finally {
  mkdirSync(path.dirname(reportPath), { recursive: true });
  const report = { status: failure ? 'FAIL' : 'PASS', startedAt, finishedAt: new Date().toISOString(), baseUrl: baseUrl.origin, mode: restart ? 'restart' : 'backend', runId, checks, passed: results.filter(value => value.status === 'PASS').length, failed: results.filter(value => value.status === 'FAIL').length, results };
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.status}: ${report.passed} gates; ${checks} verificações; ${report.failed} falhas.`);
}
