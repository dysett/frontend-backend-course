export const testAuth = { sessionSecret: 'test-only-session-secret-with-at-least-32-characters' };
export const testCredentials = { username: 'test_admin', password: 'TestLibrary!2026' };
export function browserClient(baseUrl) {
  let cookie = '', csrf = '';
  return {
    get cookie() { return cookie; },
    get csrf() { return csrf; },
    async request(method, url, body, headers = {}) {
      const response = await fetch(`${baseUrl}${url}`, {
        method, headers: { Cookie: cookie, 'X-CSRF-Token': csrf, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const json = await response.json();
      if (json.data?.csrfToken) csrf = json.data.csrfToken;
      return { status: response.status, headers: response.headers, ...json };
    },
    async login() {
      await this.request('GET', '/api/auth/session');
      const result = await this.request('POST', '/api/auth/login', testCredentials);
      if (result.status !== 200) throw new Error(JSON.stringify(result));
      return result;
    },
  };
}
