import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectRoot } from './local-runtime.mjs';

const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const inside = (parent, child) => { const relative = path.relative(parent, child); return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };

function filesIn(directory, prefix = '') {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Backup recusado: links simbólicos não são aceitos no estado local.');
    if (entry.isDirectory()) result.push(...filesIn(absolute, relative));
    else if (entry.isFile()) result.push(relative);
    else throw new Error('Backup recusado: arquivo especial encontrado no estado local.');
  }
  return result.sort();
}

export function createLocalBackup({ root = projectRoot, output, stopped = false }) {
  if (!stopped) throw new Error('Encerre todas as instâncias e confirme com --app-stopped. Banco e imagens precisam permanecer sem escrita durante a cópia.');
  if (!output || !path.isAbsolute(output)) throw new Error('Informe --output com um caminho absoluto fora do projeto.');
  const sourceRoot = realpathSync(root);
  const destination = path.resolve(output);
  if (inside(sourceRoot, destination)) throw new Error('Salve o backup fora do projeto, para impedir sua inclusão no Git ou na publicação.');
  if (existsSync(destination)) throw new Error('O destino já existe. Escolha uma pasta nova; backups nunca são sobrescritos.');
  const parent = path.dirname(destination);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (inside(sourceRoot, path.join(realpathSync(parent), path.basename(destination)))) throw new Error('O destino real do backup está dentro do projeto.');
  const state = path.join(sourceRoot, '.wrangler/state');
  const environment = path.join(sourceRoot, '.dev.vars');
  if (!existsSync(state) || !existsSync(environment)) throw new Error('Estado local e arquivo .dev.vars precisam existir antes do backup.');
  if (lstatSync(state).isSymbolicLink() || lstatSync(environment).isSymbolicLink()) throw new Error('Links simbólicos não são aceitos como origem.');
  const stateFiles = filesIn(state);
  if (!stateFiles.length) throw new Error('O diretório de estado está vazio.');
  const sources = stateFiles.map(relative => ({ source: path.join(state, relative), relative: `state/${relative.split(path.sep).join('/')}` }));
  sources.push({ source: environment, relative: '.dev.vars' });
  for (const file of ['package.json', 'package-lock.json']) if (existsSync(path.join(sourceRoot, file))) sources.push({ source: path.join(sourceRoot, file), relative: file });
  const before = sources.map(file => ({ ...file, sha256: hash(file.source), bytes: lstatSync(file.source).size }));
  mkdirSync(destination, { mode: 0o700 });
  for (const file of before) {
    const target = path.join(destination, file.relative);
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    copyFileSync(file.source, target);
    chmodSync(target, 0o600);
    if (hash(target) !== file.sha256 || hash(file.source) !== file.sha256) throw new Error('Uma origem mudou durante o backup. Cópia incompleta: encerre as instâncias e repita em outra pasta.');
  }
  if (JSON.stringify(filesIn(state)) !== JSON.stringify(stateFiles) || before.some(file => hash(file.source) !== file.sha256)) throw new Error('O estado mudou durante o backup. A cópia não foi marcada como concluída.');
  const manifest = { format: 'vitality-local-backup-v1', createdAt: new Date().toISOString(), mode: 'offline', encrypted: false, files: before.map(({ relative, sha256, bytes }) => ({ path: relative, sha256, bytes })) };
  writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  verifyLocalBackup(destination);
  return { path: destination, fileCount: manifest.files.length };
}

export function verifyLocalBackup(directory) {
  const root = realpathSync(directory);
  const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  if (manifest.format !== 'vitality-local-backup-v1' || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Manifesto de backup inválido.');
  const names = new Set();
  for (const entry of manifest.files) {
    if (typeof entry.path !== 'string' || path.isAbsolute(entry.path) || entry.path.includes('\\') || entry.path.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('Caminho inválido no manifesto.');
    if (names.has(entry.path)) throw new Error('Arquivo duplicado no manifesto.');
    names.add(entry.path);
    const file = path.join(root, entry.path);
    if (!inside(root, realpathSync(file)) || lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile()) throw new Error('Origem inválida no backup.');
    if (hash(file) !== entry.sha256 || lstatSync(file).size !== entry.bytes) throw new Error(`Integridade inválida no arquivo ${entry.path}.`);
  }
  if (!names.has('.dev.vars') || ![...names].some(name => name.startsWith('state/'))) throw new Error('Backup incompleto: ambiente ou estado ausente.');
  return { valid: true, fileCount: manifest.files.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === '--verify' && args.length === 2) console.log(JSON.stringify(verifyLocalBackup(args[1])));
    else if (args[0] === '--output' && args[1] && args[2] === '--app-stopped' && args.length === 3) console.log(JSON.stringify(createLocalBackup({ output: args[1], stopped: true })));
    else throw new Error('Use: npm run backup:local -- --output CAMINHO_ABSOLUTO --app-stopped ou npm run backup:local -- --verify CAMINHO_ABSOLUTO');
  } catch (error) { console.error(`[backup] ${error instanceof Error ? error.message : 'Falha no backup.'}`); process.exitCode = 1; }
}
