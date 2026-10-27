import type { AuthEnv } from './auth';
import { ApiError } from './security';

export type RuntimeConfig = AuthEnv & { APP_ENV?: string };

export function environmentName(config: RuntimeConfig): 'development' | 'test' | 'production' {
  const value = config.APP_ENV || 'development';
  if (value !== 'development' && value !== 'test' && value !== 'production') {
    throw new ApiError(503, 'O ambiente do servidor está configurado incorretamente.');
  }
  return value;
}

export function validateRuntimeConfig(config: RuntimeConfig) {
  const mode = environmentName(config);
  if (mode === 'production') {
    if (config.ENABLE_DEMO_DATA !== 'false') {
      throw new ApiError(503, 'Desative a carga de demonstração antes de operar em produção.');
    }
    if (!/^[a-f0-9]{64}$/i.test(config.TOTP_ENCRYPTION_KEY || '')) {
      throw new ApiError(503, 'Configure a chave de proteção do servidor antes de operar em produção.');
    }
  }
  return mode;
}

// Bootstrap secrets never reach the client or reset an existing account.
export function bootstrapCredentials(config: RuntimeConfig) {
  const login = (config.ADMIN_LOGIN || '').trim().toLowerCase();
  const password = config.ADMIN_PASSWORD || '';
  const minimum = environmentName(config) === 'production' ? 16 : 8;
  if (!login || login.length > 180 || /[\s\u0000-\u001f\u007f]/u.test(login) || password.length < minimum || password.length > 128) {
    throw new ApiError(503, 'Configure um acesso inicial válido e uma senha forte no servidor antes de iniciar.');
  }
  return { login, password };
}
