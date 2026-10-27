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
let serverClosed;
let serverError;
let logStream;
let stage = 'preparation';
let failure = null;
const startedAt = new Date().toISOString();
for (const name of ['integration-report.json', 'restart-report.json', 'finance-report.json', 'backend-flows-report.json', 'backend-restart-report.json', 'security-hardening-report.json', 'domain-hardening-report.json', 'operations-hardening-report.json']) writeFileSync(path.join(projectRoot, 'outputs', name), JSON.stringify({ status: 'NOT_RUN', startedAt }) + '\n');
writeFileSync(path.join(projectRoot, 'outputs/worker-test.log'), '');

function run(args, env = testEnv) {
  // Keep the parent's event loop available to drain runtime logs during tests.
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: projectRoot, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 ? resolve() : reject(new Error(`Falha em ${args[0]} (código ${code}, sinal ${signal || 'nenhum'}).`)));
  });
}
async function start() {
  const runtime = prepareLocalRuntime({ runtimeDir: working, persistTo, envFile });
  logStream = createWriteStream(path.join(projectRoot, 'outputs/worker-test.log'), { flags: 'a' });
  server = spawn(process.execPath, ['--import', './scripts/sites-env.mjs', './scripts/test-worker.mjs', runtime.configPath, persistTo, String(port)], { cwd: projectRoot, env: testEnv, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], detached: process.platform !== 'win32' });
  server.stdout.pipe(logStream, { end: false }); server.stderr.pipe(logStream, { end: false });
  serverError = undefined;
  server.on('error', (error) => { serverError = error; });
  serverClosed = new Promise((resolve) => server.once('close', (code, signal) => resolve({ code, signal })));
  const target = server;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('Worker não iniciou em 45 segundos. Confira outputs/worker-test.log.')), 45000);
    const finish = (error) => {
      clearTimeout(timeout);
      target.off('message', onMessage); target.off('error', onError); target.off('exit', onExit);
      if (error) reject(error); else resolve();
    };
    const onMessage = (message) => {
      if (message?.type === 'ready') finish(message.origin === baseUrl ? null : new Error('O Worker iniciou em uma origem inesperada.'));
    };
    const onError = (error) => finish(error);
    const onExit = () => finish(new Error('Worker encerrou antes de iniciar; confira outputs/worker-test.log.'));
    target.once('message', onMessage); target.once('error', onError); target.once('exit', onExit);
  });
  // The child confirms mf.ready first. A real health failure now fails the run;
  // no startup sleep, HTTP retry or mutation retry can hide a regression.
  const health = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(5000) });
  await health.arrayBuffer();
  if (!health.ok) throw new Error(`Healthcheck do Worker retornou ${health.status}.`);
}
async function stop() {
  const target = server;
  const closed = serverClosed;
  server = undefined;
  serverClosed = undefined;
  try {
    if (target) {
      if (target.exitCode === null && target.signalCode === null) {
        // IPC allows dispose() to finish on Windows too, where SIGTERM is forceful.
        if (target.connected) target.send({ type: 'shutdown' }, (error) => { if (error) target.kill('SIGTERM'); });
        else target.kill('SIGTERM');
      }
      const result = await Promise.race([closed, delay(5000, undefined, { ref: false }).then(() => null)]);
      if (!result) {
        if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(target.pid), '/t', '/f'], { stdio: 'ignore' });
        else { try { process.kill(-target.pid, 'SIGKILL'); } catch { target.kill('SIGKILL'); } }
        await Promise.race([closed, delay(5000, undefined, { ref: false }).then(() => { throw new Error('Não foi possível encerrar o Worker de teste.'); })]);
        throw new Error('O Worker precisou de encerramento forçado; a execução não será aprovada.');
      }
      if (serverError) throw serverError;
      if (result.code !== 0) throw new Error(`O Worker encerrou com falha (código ${result.code}, sinal ${result.signal || 'nenhum'}).`);
    }
  } finally {
    if (logStream) { const stream = logStream; logStream = undefined; await new Promise((resolve, reject) => { stream.once('error', reject); stream.end(resolve); }); }
  }
}

try {
  stage = 'typecheck';
  console.log('[ci] Verificando tipos.');
  await run(['node_modules/typescript/bin/tsc', '--noEmit']);
  stage = 'lint';
  console.log('[ci] Verificando qualidade estática.');
  await run(['node_modules/eslint/bin/eslint.js', '.', '--ignore-pattern', 'dist', '--ignore-pattern', '.next']);
  stage = 'deterministic-backend';
  console.log('[ci] Verificando concorrência, segurança e operação em bases determinísticas.');
  await run(['tests/security-hardening.mjs']);
  await run(['tests/domain-hardening.mjs']);
  await run(['tests/operations-hardening.mjs']);
  if (!process.argv.includes('--skip-build')) { stage = 'build'; console.log('[ci] Compilando Worker e frontend.'); await run(['scripts/run-framework.mjs', 'build']); }
  stage = 'migrations';
  console.log('[ci] Preparando banco isolado.');
  await run(['scripts/setup-local.mjs', '--skip-build', '--runtime-dir', working, '--persist-to', persistTo, '--env-file', envFile]);
  stage = 'start';
  await start();
  stage = 'integration';
  await run(['tests/integration.mjs']);
  await run(['tests/finance-reports.mjs']);
  stage = 'backend-flows';
  await run(['tests/backend-flows.mjs']);
  await stop();
  stage = 'restart';
  console.log('[ci] Reiniciando o mesmo ambiente para verificar persistência.');
  await start();
  await run(['tests/integration.mjs', '--persistence'], { ...testEnv, VG_TEST_REPORT: 'outputs/restart-report.json' });
  await run(['tests/backend-flows.mjs', '--persistence']);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  console.error(`[ci] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  try { await stop(); } catch (error) {
    const cleanupFailure = `Falha ao encerrar: ${error instanceof Error ? error.message : String(error)}`;
    failure = failure ? `${failure} ${cleanupFailure}` : cleanupFailure;
    console.error(`[ci] FAIL: ${cleanupFailure}`);
    process.exitCode = 1;
  }
  writeFileSync(path.join(projectRoot, 'outputs/ci-report.json'), JSON.stringify({ status: failure ? 'FAIL' : 'PASS', stage, sourceCommit: process.env.GITHUB_SHA || null, nodeVersion: process.version, startedAt, finishedAt: new Date().toISOString(), error: failure }, null, 2) + '\n');
  if (!failure) console.log('[ci] PASS: build, integração, reinicialização e persistência.');
}
