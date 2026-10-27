import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unstable_getMiniflareWorkerOptions } from 'wrangler';

// Resolve Wrangler's own, lockfile-pinned runtime so its configuration adapter and
// Miniflare always agree. This does not install a second Workers runtime.
const requireWrangler = createRequire(import.meta.resolve('wrangler/package.json'));
const { Miniflare, Log, LogLevel, compileModuleRules, testRegExps } = requireWrangler('miniflare');

function compiledModules(main, modulesRoot, rules) {
  const compiledRules = compileModuleRules(rules);
  const modules = [{ type: 'ESModule', path: main }];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) { visit(filename); continue; }
      if (!entry.isFile() || filename === main) continue;
      const relative = path.relative(modulesRoot, filename).split(path.sep).join('/');
      const rule = compiledRules.find((candidate) => testRegExps(candidate.include, relative));
      if (rule) modules.push({ type: rule.type, path: filename });
    }
  };
  visit(modulesRoot);
  return modules;
}

export function compiledWorkerOptions(configPath, persistTo, port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Porta de teste inválida.');
  const configuration = JSON.parse(readFileSync(configPath, 'utf8'));
  const { main, workerOptions, externalWorkers } = unstable_getMiniflareWorkerOptions(configPath);
  if (!main || !path.isAbsolute(main)) throw new Error('O CI exige o entrypoint absoluto do build compilado.');
  if (workerOptions.bindings?.APP_ENV !== 'test') throw new Error('O runner aceita somente APP_ENV=test.');
  if (!workerOptions.d1Databases?.DB || !workerOptions.r2Buckets?.BUCKET || !workerOptions.assets?.directory) throw new Error('O build precisa preservar DB, BUCKET e assets.');
  const modulesRoot = configuration.base_dir || path.dirname(main);
  return {
    host: '127.0.0.1',
    port,
    // Wrangler migrations --persist-to uses this same versioned storage root.
    defaultPersistRoot: path.join(path.resolve(persistTo), 'v3'),
    cf: false,
    telemetry: { enabled: false },
    log: new Log(LogLevel.INFO),
    logRequests: true,
    workers: [
      {
        name: configuration.name,
        ...workerOptions,
        // Match Wrangler's no_bundle mode: attach the build's files by its module
        // rules. Auto-discovery rejects legitimate dynamic imports in this build.
        // No module is transpiled, mocked or replaced by the test runner.
        modules: compiledModules(main, modulesRoot, workerOptions.modulesRules),
        modulesRoot,
      },
      ...externalWorkers,
    ],
  };
}

async function main() {
  if (process.argv.length !== 5) throw new Error('Uso: node scripts/test-worker.mjs <config> <persist-to> <port>');
  const options = compiledWorkerOptions(path.resolve(process.argv[2]), process.argv[3], Number(process.argv[4]));
  // No file watchers, development proxy, alternate handler or HTTP retries:
  // requests go directly to workerd serving the actual compiled application.
  // https://developers.cloudflare.com/workers/testing/miniflare/get-started/
  const worker = new Miniflare(options);
  let closing;
  const close = () => closing ??= worker.dispose();
  const shutdown = () => { void close().then(() => process.exit(0), () => process.exit(1)); };
  process.on('message', (message) => { if (message?.type === 'shutdown') shutdown(); });
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  process.once('disconnect', shutdown);
  try {
    const address = await worker.ready;
    console.log(`[ci-worker] Ready on ${address.origin}`);
    process.send?.({ type: 'ready', origin: address.origin });
  } catch (error) {
    await close();
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Configuration errors can carry binding values; never print their payloads.
    console.error(`[ci-worker] Falha no runtime (${error instanceof Error ? error.name : 'Error'}). Consulte as mensagens do workerd acima.`);
    process.exit(1);
  });
}
