declare namespace Cloudflare {
  interface Env {
    APP_ENV?: string;
    ADMIN_LOGIN?: string;
    ADMIN_PASSWORD?: string;
    ENABLE_DEMO_DATA?: string;
    TOTP_ENCRYPTION_KEY?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
