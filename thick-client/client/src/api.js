let csrfToken;
export async function api(path, { method = 'GET', body } = {}) {
  let response;
  try { response = await fetch(`/api${path}`, {
    method, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000),
    headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(!['GET', 'HEAD'].includes(method) ? { 'X-CSRF-Token': csrfToken ?? '' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }); } catch {
    throw new Error('Немає зв’язку із сервером. Перевірте підключення та повторіть дію.');
  }
  const json = await response.json();
  if (!response.ok) {
    const error = new Error(json.error?.message ?? 'Не вдалося виконати запит.');
    error.code = json.error?.code;
    error.status = response.status;
    if (response.status === 401 && path !== '/auth/login') window.dispatchEvent(new Event('session-expired'));
    throw error;
  }
  if (json.data?.csrfToken) csrfToken = json.data.csrfToken;
  return json.data;
}
