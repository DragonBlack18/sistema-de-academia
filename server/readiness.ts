import type { Actor } from './auth';
import type { RuntimeConfig } from './config';
import { environmentName } from './config';
import { ApiError, decryptSecret, json, verifyPassword } from './security';
import { verifyDatabaseSchema } from './bootstrap';

type Check = { id: string; status: 'pass' | 'fail'; message: string };

export async function productionReadiness(request: Request, db: D1Database, bucket: R2Bucket | undefined, config: RuntimeConfig, actor: Actor) {
  if (actor.role !== 'super_admin') throw new ApiError(403, 'Somente o proprietário pode consultar a prontidão do ambiente.');
  await verifyDatabaseSchema(db);
  const owners = (await db.prepare("SELECT u.id,u.password_hash,u.must_change_password,u.totp_enabled,u.totp_secret,EXISTS(SELECT 1 FROM audit_logs a WHERE a.user_id=u.id AND a.entity_id=u.id AND a.action='password.changed' AND a.created_at>=u.created_at) AS password_changed FROM users u WHERE u.role='super_admin' AND u.active=1").all<{ id: string; password_hash: string; must_change_password: number; totp_enabled: number; totp_secret: string | null; password_changed: number }>()).results;
  const demo = await db.prepare("SELECT id FROM seed_runs WHERE id='demo-v1'").first();
  const initialPassword = config.ADMIN_PASSWORD;
  const credentialUnchanged = !!initialPassword && owners.some(owner => verifyPassword(initialPassword, owner.password_hash));
  const checks: Check[] = [];
  const add = (id: string, passed: boolean, message: string) => checks.push({ id, status: passed ? 'pass' : 'fail', message });
  add('schema', true, 'Migrações de autenticação e configuração disponíveis.');
  add('production_mode', environmentName(config) === 'production', 'APP_ENV deve ser production no ambiente operacional.');
  add('https', new URL(request.url).protocol === 'https:', 'O acesso operacional deve usar HTTPS.');
  add('r2_binding', !!bucket, 'O armazenamento persistente de imagens deve estar configurado.');
  add('totp_key', /^[a-f0-9]{64}$/i.test(config.TOTP_ENCRYPTION_KEY || ''), 'A chave TOTP deve conter 64 caracteres hexadecimais e ser preservada em restaurações.');
  add('demo_disabled', config.ENABLE_DEMO_DATA === 'false' && !demo, 'Produção deve usar uma base sem carga demonstrativa; desligar o seed não apaga os dados existentes.');
  add('owner_password', owners.length > 0 && owners.every(owner => !owner.must_change_password && !!owner.password_changed) && !credentialUnchanged, 'Os proprietários devem trocar suas credenciais iniciais na área de segurança, com registro de auditoria.');
  add('owner_mfa', owners.length > 0 && owners.every(owner => !!owner.totp_enabled), 'Ative o autenticador nas contas proprietárias antes da abertura operacional.');
  add('totp_decryption', owners.length > 0 && owners.every(owner => {
    try { return !!owner.totp_enabled && !!decryptSecret(owner.totp_secret || '', config.TOTP_ENCRYPTION_KEY || ''); }
    catch { return false; }
  }), 'A chave configurada deve conseguir abrir os segredos MFA já cadastrados.');
  const ready = checks.every(check => check.status === 'pass');
  return json({ ready, scope: 'application_configuration', checks, manualVerification: ['Restauração do banco e das imagens em ambiente separado.', 'Destino de backup, monitoramento, responsáveis e política de retenção.', 'Homologação de carga e integrações externas contratadas.'] }, ready ? 200 : 503);
}
