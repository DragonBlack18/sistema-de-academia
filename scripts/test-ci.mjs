import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { projectRoot, prepareLocalRuntime } from './local-runtime.mjs';

const requestedPort = process.env.VG_TEST_PORT ? Number(process.env.VG_TEST_PORT) : 0;
if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535 || (requestedPort > 0 && requestedPort < 1024)) throw new Error('VG_TEST_PORT inválida.');
// Probe before spawning so tests never attach to an unrelated running application.
const port = await new Promise((resolve, reject) => { const probe = createServer(); probe.once('error', reject); probe.listen(requestedPort, '127.0.0.1', () => { const selected = probe.address().port; probe.close((error) => error ? reject(error) : resolve(selected)); }); });
const baseUrl = `http://127.0.0.1:${port}`;
mkdirSync(path.join(projectRoot, '.sites-runtime'), { recursive: true });
mkdirSync(path.join(projectRoot, 'outputs'), { recursive: true });
const working = mkdtempSync(path.join(projectRoot, '.sites-runtime/qa-'));
const envFile = path.join(working, '.dev.vars');
const persistTo = path.join(working, 'state');
const fixtureLogin = 'qa.owner@example.invalid';
const fixturePassword = randomBytes(32).toString('base64url');
writeFileSync(envFile, `APP_ENV="test"\nADMIN_LOGIN="${fixtureLogin}"\nADMIN_PASSWORD="${fixturePassword}"\nENABLE_DEMO_DATA="false"\nTOTP_ENCRYPTION_KEY="${randomBytes(32).toString('hex')}"\n`, { mode: 0o600 });
const testEnv = { ...process.env, CI: 'true', VG_TEST_ALLOW_WRITES: '1', VG_TEST_BASE_URL: baseUrl, VG_TEST_LOGIN: fixtureLogin, VG_TEST_PASSWORD: fixturePassword };
let server;
let logStream;
let lastServerError;
let stage = 'preparation';
let failure = null;
const startedAt = new Date().toISOString();
for (const name of ['integration-report.json', 'restart-report.json', 'finance-report.json', 'backend-flows-report.json', 'backend-restart-report.json', 'security-hardening-report.json', 'domain-hardening-report.json', 'operations-hardening-report.json']) writeFileSync(path.join(projectRoot, 'outputs', name), JSON.stringify({ status: 'NOT_RUN', startedAt }) + '\n');
writeFileSync(path.join(projectRoot, 'outputs/worker-test.log'), '');

function run(args, env = testEnv) {
  const child = spawnSync(process.execPath, args, { cwd: projectRoot, env, stdio: 'inherit' });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`Falha em ${args[0]} (código ${child.status}).`);
}
async function start() {
  const runtime = prepareLocalRuntime({ runtimeDir: working, persistTo, envFile });
  logStream = createWriteStream(path.join(projectRoot, 'outputs/worker-test.log'), { flags: 'a' });
  server = spawn(process.execPath, ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'dev', '--config', runtime.configPath, '--local', '--persist-to', persistTo, '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', '0'], { cwd: projectRoot, env: testEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  server.stdout.pipe(logStream, { end: false }); server.stderr.pipe(logStream, { end: false });
  server.once('error', (error) => { lastServerError = error; });
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (lastServerError) throw lastServerError;
    if (server.exitCode !== null) throw new Error('Worker encerrou antes do healthcheck; confira outputs/worker-test.log.');
    try { const health = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1500) }); if (health.ok) return; } catch { /* readiness, never counted as test pass */ }
    await delay(500);
  }
  throw new Error('Worker não respondeu em 45 segundos. Confira outputs/worker-test.log.');
}
async function stop() {
  if (!server || server.exitCode !== null) { logStream?.end(); return; }
  const target = server;
  const exited = new Promise((resolve) => target.once('exit', resolve));
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(target.pid), '/t', '/f'], { stdio: 'ignore' });
  else { try { process.kill(-target.pid, 'SIGTERM'); } catch { target.kill('SIGTERM'); } }
  await Promise.race([exited, delay(5000)]);
  if (target.exitCode === null && target.signalCode === null) {
    if (process.platform === 'win32') target.kill('SIGKILL');
    else { try { process.kill(-target.pid, 'SIGKILL'); } catch { target.kill('SIGKILL'); } }
  }
  logStream?.end(); server = undefined;
}

try {
  stage = 'typecheck';
  console.log('[ci] Verificando tipos.');
  run(['node_modules/typescript/bin/tsc', '--noEmit']);
  stage = 'lint';
  console.log('[ci] Verificando qualidade estática.');
  run(['node_modules/eslint/bin/eslint.js', '.', '--ignore-pattern', 'dist', '--ignore-pattern', '.next']);
  stage = 'deterministic-backend';
  console.log('[ci] Verificando concorrência, segurança e operação em bases determinísticas.');
  run(['tests/security-hardening.mjs']);
  run(['tests/domain-hardening.mjs']);
  run(['tests/operations-hardening.mjs']);
  if (!process.argv.includes('--skip-build')) { stage = 'build'; console.log('[ci] Compilando Worker e frontend.'); run(['scripts/run-framework.mjs', 'build']); }
  stage = 'migrations';
  console.log('[ci] Preparando banco isolado.');
  run(['scripts/setup-local.mjs', '--skip-build', '--runtime-dir', working, '--persist-to', persistTo, '--env-file', envFile]);
  stage = 'start';
  await start();
  stage = 'integration';
  run(['tests/integration.mjs']);
  run(['tests/finance-reports.mjs']);
  stage = 'backend-flows';
  run(['tests/backend-flows.mjs']);
  await stop();
  stage = 'restart';
  console.log('[ci] Reiniciando o mesmo ambiente para verificar persistência.');
  await start();
  run(['tests/integration.mjs', '--persistence'], { ...testEnv, VG_TEST_REPORT: 'outputs/restart-report.json' });
  run(['tests/backend-flows.mjs', '--persistence']);
  console.log('[ci] PASS: build, integração, reinicialização e persistência.');
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  console.error(`[ci] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await stop();
  writeFileSync(path.join(projectRoot, 'outputs/ci-report.json'), JSON.stringify({ status: failure ? 'FAIL' : 'PASS', stage, sourceCommit: process.env.GITHUB_SHA || null, nodeVersion: process.version, startedAt, finishedAt: new Date().toISOString(), error: failure }, null, 2) + '\n');
}
