import { spawn } from 'node:child_process';
import { parseLocalArgs, prepareLocalRuntime } from './local-runtime.mjs';

try {
  const options = parseLocalArgs();
  const runtime = prepareLocalRuntime(options);
  const server = spawn(process.execPath, ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'dev', '--config', runtime.configPath, '--local', '--persist-to', runtime.persistTo, '--ip', '127.0.0.1', '--port', String(options.port), '--inspector-port', '0'], { cwd: runtime.projectRoot, stdio: 'inherit' });
  const terminate = (signal) => { if (!server.killed) server.kill(signal); };
  process.on('SIGINT', () => terminate('SIGINT'));
  process.on('SIGTERM', () => terminate('SIGTERM'));
  server.once('error', (error) => { console.error(`[start] ${error.message}`); process.exitCode = 1; });
  server.once('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 0 : 1); });
} catch (error) {
  console.error(`[start] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
