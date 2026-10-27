import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function parseLocalArgs(args = process.argv.slice(2)) {
  const options = { port: 8787, persistTo: '.wrangler/state', runtimeDir: '.sites-runtime/local', envFile: '.dev.vars', skipBuild: false };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--skip-build') { options.skipBuild = true; continue; }
    const key = { '--port': 'port', '--persist-to': 'persistTo', '--runtime-dir': 'runtimeDir', '--env-file': 'envFile' }[flag];
    if (!key || !args[index + 1]) throw new Error(`Argumento não reconhecido ou sem valor: ${flag}`);
    options[key] = args[++index];
  }
  options.port = Number(options.port);
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error('A porta deve ser um inteiro entre 1024 e 65535.');
  return options;
}

export function ensureLocalEnvironment(envFile = '.dev.vars') {
  const destination = path.resolve(projectRoot, envFile);
  mkdirSync(path.dirname(destination), { recursive: true });
  if (!existsSync(destination)) {
    const example = path.join(projectRoot, '.dev.vars.example');
    const template = existsSync(example) ? readFileSync(example, 'utf8') : 'APP_ENV="development"\nADMIN_LOGIN="admin@example.invalid"\nADMIN_PASSWORD=""\nENABLE_DEMO_DATA="false"\n';
    writeFileSync(destination, template, { mode: 0o600, flag: 'wx' });
  }
  let contents = readFileSync(destination, 'utf8');
  const parsed = parseEnv(contents);
  const passwordPattern = /^\s*(?:export\s+)?ADMIN_PASSWORD\s*=.*$/m;
  const initialPassword = parsed.ADMIN_PASSWORD || '';
  if (!initialPassword) {
    const generated = `ADMIN_PASSWORD="${randomBytes(32).toString('base64url')}"`;
    contents = passwordPattern.test(contents) ? contents.replace(passwordPattern, generated) : `${contents.replace(/\s*$/, '')}\n${generated}\n`;
    writeFileSync(destination, contents, { mode: 0o600 });
  }
  const keyPattern = /^\s*(?:export\s+)?TOTP_ENCRYPTION_KEY\s*=.*$/m;
  const value = parsed.TOTP_ENCRYPTION_KEY || '';
  if (!value) {
    const generated = `TOTP_ENCRYPTION_KEY="${randomBytes(32).toString('hex')}"`;
    contents = keyPattern.test(contents) ? contents.replace(keyPattern, generated) : `${contents.replace(/\s*$/, '')}\n${generated}\n`;
    writeFileSync(destination, contents, { mode: 0o600 });
  } else if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error('TOTP_ENCRYPTION_KEY existente deve ter 64 caracteres hexadecimais. Preserve a chave correta; não substitua chaves de ambientes com MFA em uso.');
  }
  chmodSync(destination, 0o600);
  return destination;
}

export function prepareLocalRuntime(options = {}) {
  const runtimeDir = path.resolve(projectRoot, options.runtimeDir || '.sites-runtime/local');
  const persistTo = path.resolve(projectRoot, options.persistTo || '.wrangler/state');
  const sourceConfigPath = path.join(projectRoot, 'dist/server/wrangler.json');
  if (!existsSync(sourceConfigPath)) throw new Error('Build ausente. Execute npm run setup:local ou npm run build antes de iniciar.');
  const configuration = JSON.parse(readFileSync(sourceConfigPath, 'utf8'));
  const configBase = path.dirname(sourceConfigPath);
  if (configuration.main) configuration.main = path.resolve(configBase, configuration.main);
  if (configuration.base_dir) configuration.base_dir = path.resolve(configBase, configuration.base_dir);
  if (configuration.assets?.directory) configuration.assets.directory = path.resolve(configBase, configuration.assets.directory);
  for (const type of ['wasm_modules', 'text_blobs', 'data_blobs']) {
    if (configuration[type]) configuration[type] = Object.fromEntries(Object.entries(configuration[type]).map(([name, value]) => [name, path.resolve(configBase, value)]));
  }
  configuration.d1_databases = (configuration.d1_databases || []).map((database) => ({ ...database, migrations_dir: path.join(projectRoot, 'drizzle'), migrations_table: 'd1_migrations' }));
  if (!configuration.d1_databases.some((database) => database.binding === 'DB')) throw new Error('O build deve conter o binding D1 DB. Confira .openai/hosting.json.');
  mkdirSync(runtimeDir, { recursive: true });
  mkdirSync(persistTo, { recursive: true });
  const envSource = ensureLocalEnvironment(options.envFile || '.dev.vars');
  const envDestination = path.join(runtimeDir, '.dev.vars');
  if (envSource !== envDestination) copyFileSync(envSource, envDestination);
  chmodSync(envDestination, 0o600);
  const configPath = path.join(runtimeDir, 'wrangler.json');
  writeFileSync(configPath, `${JSON.stringify(configuration, null, 2)}\n`);
  return { projectRoot, configPath, persistTo, runtimeDir };
}
