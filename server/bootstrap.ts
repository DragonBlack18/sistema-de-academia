import type { RuntimeConfig } from './config';
import { bootstrapCredentials, validateRuntimeConfig } from './config';
import { ApiError, hashPassword, timestamp, uuid } from './security';
import { DEFAULT_SETTINGS } from './settings';
import { seedDemo } from './seed';

const initialized = new WeakSet<D1Database>();
const initializing = new WeakMap<D1Database, Promise<void>>();

export async function bootstrap(db: D1Database, config: RuntimeConfig): Promise<void> {
  validateRuntimeConfig(config);
  if (initialized.has(db)) return;
  const pending = initializing.get(db);
  if (pending) return pending;
  const work = (async () => {
    let owner = await db.prepare("SELECT id FROM users WHERE role='super_admin' AND active=1 LIMIT 1").first<{ id: string }>();
    if (!owner) {
      const { login, password } = bootstrapCredentials(config);
      const now = timestamp();
      await db.prepare("INSERT INTO users (id,name,login,password_hash,role,active,must_change_password,created_at,updated_at,version) SELECT ?,?,?,?,'super_admin',1,1,?,?,1 WHERE NOT EXISTS (SELECT 1 FROM users)")
        .bind(uuid(), 'Proprietário', login, hashPassword(password), now, now).run();
      owner = await db.prepare("SELECT id FROM users WHERE role='super_admin' AND active=1 LIMIT 1").first<{ id: string }>();
      if (!owner) throw new ApiError(503, 'Não há um proprietário ativo. Solicite a recuperação administrativa do ambiente.');
    }
    await db.prepare("INSERT OR IGNORE INTO settings (id,value,version,updated_at) VALUES ('gym',?,1,?)")
      .bind(JSON.stringify(DEFAULT_SETTINGS), timestamp()).run();
    if (config.ENABLE_DEMO_DATA === 'true') {
      try { await seedDemo(db, owner.id); }
      catch (error) {
        // Accept only the exact seed already committed by another isolate.
        if (!/seed_runs\.id|seed_runs.*UNIQUE|UNIQUE.*seed_runs/i.test(String(error)) ||
          !await db.prepare("SELECT id FROM seed_runs WHERE id='demo-v1'").first()) throw error;
      }
    }
    initialized.add(db);
  })();
  initializing.set(db, work);
  try { await work; } finally { initializing.delete(db); }
}

export async function verifyDatabaseSchema(db: D1Database) {
  // SELECT 1 also succeeds before migrations: check required schema instead.
  await db.prepare('SELECT u.id,u.totp_last_counter,s.last_seen_at FROM users u LEFT JOIN sessions s ON s.user_id=u.id LIMIT 0').all();
  await db.prepare('SELECT id,version FROM settings LIMIT 0').all();
}
