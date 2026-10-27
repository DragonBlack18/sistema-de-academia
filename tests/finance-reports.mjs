import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { requireTestEnvironment } from './http-client.mjs';

requireTestEnvironment();

const base = new URL(process.env.VG_TEST_BASE_URL || 'http://127.0.0.1:8799');
const previous = JSON.parse(readFileSync('outputs/integration-report.json', 'utf8'));
assert.equal(previous.status, 'PASS', 'Execute a integração completa antes deste gate complementar.');
async function login(login, password) {
  const response = await fetch(new URL('/api/login', base), { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base.origin }, body: JSON.stringify({ login, password }), signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200);
  return response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ');
}
async function report(cookie) {
  const response = await fetch(new URL('/api/reports?days=30', base), { headers: { Cookie: cookie }, signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200);
  return response.json();
}
let status = 'PASS', error = null;
try {
  const owner = await login(process.env.VG_TEST_LOGIN, process.env.VG_TEST_PASSWORD);
  const finance = await login(`qa-${previous.runId}-finance@example.invalid`, `QA-${previous.runId}-!9`);
  const [ownerReport, financeReport] = await Promise.all([report(owner), report(finance)]);
  assert.ok(ownerReport.totals.sales_cents >= 3000, 'Receita de vendas sintéticas deve estar contabilizada.');
  for (const key of ['received_cents', 'refunded_cents', 'expenses_cents', 'net_cents', 'sales_cents']) assert.equal(financeReport.totals[key], ownerReport.totals[key], `Financeiro deve visualizar o mesmo agregado autorizado: ${key}`);
  console.log('PASS FINANCE_ROLE_SALES_AND_REFUNDS_AGGREGATE');
} catch (caught) {
  status = 'FAIL'; error = caught instanceof Error ? caught.message : String(caught); console.error(`FAIL ${error}`); process.exitCode = 1;
} finally {
  writeFileSync('outputs/finance-report.json', JSON.stringify({ name: 'FINANCE_ROLE_SALES_AND_REFUNDS_AGGREGATE', status, error, executedAt: new Date().toISOString(), baseUrl: base.origin }, null, 2) + '\n');
}
