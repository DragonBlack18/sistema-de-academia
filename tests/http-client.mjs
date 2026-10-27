import assert from 'node:assert/strict';

export const baseUrl = new URL(process.env.VG_TEST_BASE_URL || 'http://127.0.0.1:8799');
const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'terminal.local']);

export function requireTestEnvironment() {
  assert.equal(process.env.VG_TEST_ALLOW_WRITES, '1', 'Esta suíte altera dados sintéticos; autorize somente uma base de teste com VG_TEST_ALLOW_WRITES=1.');
  assert.ok(localHosts.has(baseUrl.hostname), 'Esta suíte de backend aceita somente um ambiente local isolado. Não use o banco publicado.');
  assert.ok(process.env.VG_TEST_LOGIN && process.env.VG_TEST_PASSWORD, 'Forneça VG_TEST_LOGIN e VG_TEST_PASSWORD do ambiente de teste; credenciais não são mantidas no código.');
}

export class HttpClient {
  cookie = '';
  csrf = '';
  user = null;

  async request(route, { method = 'GET', body, headers = {}, csrf = true } = {}) {
    const requestHeaders = { Accept: 'application/json', Origin: baseUrl.origin, ...headers };
    if (this.cookie) requestHeaders.Cookie = this.cookie;
    if (csrf && this.csrf && !['GET', 'HEAD'].includes(method)) requestHeaders['X-CSRF-Token'] = this.csrf;
    let payload = body;
    if (body !== undefined && !(body instanceof FormData)) {
      requestHeaders['Content-Type'] ??= 'application/json';
      payload = JSON.stringify(body);
    }
    const response = await fetch(new URL(`/api${route}`, baseUrl), {
      method, headers: requestHeaders, body: payload, redirect: 'manual', signal: AbortSignal.timeout(30000),
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) this.cookie = cookies.map(value => value.split(';')[0]).join('; ');
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data, headers: response.headers };
  }

  async ok(route, options = {}) {
    const response = await this.request(route, options);
    assert.ok(response.status >= 200 && response.status < 300,
      `${options.method || 'GET'} ${route}: HTTP ${response.status}; ${typeof response.data?.error === 'string' ? response.data.error : 'resposta inesperada'}`);
    return response.data;
  }

  async login(login = process.env.VG_TEST_LOGIN, password = process.env.VG_TEST_PASSWORD) {
    assert.ok(login && password, 'Credenciais de teste não fornecidas.');
    const response = await this.ok('/login', { method: 'POST', body: { login, password } });
    this.csrf = response.csrfToken;
    this.user = response.user;
    assert.ok(this.csrf && this.user?.id, 'Login precisa retornar sessão e identidade.');
    return response;
  }
}

export function expectDenied(response, statuses = [403, 404]) {
  assert.ok(statuses.includes(response.status), `Esperava ${statuses.join('/')} e recebeu ${response.status}: ${response.data?.error || 'resposta inesperada'}`);
}

export function dateOffset(days = 0) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const date = new Date(`${today}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
