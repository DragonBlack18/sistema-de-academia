import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ensureLocalEnvironment, parseLocalArgs, prepareLocalRuntime, projectRoot } from './local-runtime.mjs';

try {
  const options = parseLocalArgs();
  if (!existsSync(path.join(projectRoot, 'node_modules/wrangler/bin/wrangler.js'))) throw new Error('Dependências ausentes. Execute npm ci primeiro.');
  ensureLocalEnvironment(options.envFile);
  if (!options.skipBuild) {
    console.log('[setup] Compilando a aplicação.');
    const built = spawnSync(process.execPath, ['scripts/run-framework.mjs', 'build'], { cwd: projectRoot, stdio: 'inherit' });
    if (built.error || built.status !== 0) throw new Error('Build falhou; nenhuma migração foi aplicada.');
  }
  const runtime = prepareLocalRuntime(options);
  console.log('[setup] Aplicando somente migrações locais ainda pendentes.');
  const migrated = spawnSync(process.execPath, ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'd1', 'migrations', 'apply', 'DB', '--local', '--config', runtime.configPath, '--persist-to', runtime.persistTo], { cwd: projectRoot, env: { ...process.env, CI: 'true' }, stdio: ['ignore', 'inherit', 'inherit'] });
  if (migrated.error || migrated.status !== 0) throw new Error('Migração falhou. A aplicação não foi iniciada. Confira a saída; não apague o banco.');
  console.log('[setup] Ambiente pronto. Dados existentes preservados. Execute npm start.');
  console.log('[setup] Para uma instalação nova, consulte ADMIN_LOGIN e ADMIN_PASSWORD no arquivo local de ambiente. A senha não é exibida nos logs nem redefine uma conta existente.');
} catch (error) {
  console.error(`[setup] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
