const TOKEN_KEY = 'thermavax-api-token';
const REFRESH_TOKEN_KEY = 'thermavax-refresh-token';

let token = sessionStorage.getItem(TOKEN_KEY);
let refreshToken = sessionStorage.getItem(REFRESH_TOKEN_KEY);
let apiOrigin = '';

function storeSession(session) {
  token = session?.token || null;
  refreshToken = session?.refreshToken || null;
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
  if (refreshToken) sessionStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  else sessionStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function hasSession() {
  return Boolean(token);
}

export function apiUrl(path) {
  return `${apiOrigin}${path}`;
}

export async function discoverApiOrigin() {
  async function isThermaVaxApi(origin) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return false;
      const health = await response.json();
      return health.status === 'ok' && health.service === 'ThermaVax API';
    } catch {
      return false;
    }
  }

  if (await isThermaVaxApi('')) return;
  if (['localhost', '127.0.0.1', ''].includes(location.hostname)) {
    for (const origin of ['http://localhost:3000', 'http://localhost:3001']) {
      if (origin.endsWith(`:${location.port}`)) continue;
      if (await isThermaVaxApi(origin)) {
        apiOrigin = origin;
        return;
      }
    }
  }
}

export async function api(path, options = {}, allowRefresh = true) {
  const headers = { ...(options.headers || {}) };
  const publicRequest = path.startsWith('/api/tracking/') || path.startsWith('/api/qr/');
  if (token && !publicRequest) headers.Authorization = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(apiUrl(path), { ...options, headers });
  } catch {
    throw new Error('ThermaVax API is unavailable. Start the Express server with npm.cmd start.');
  }

  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && allowRefresh && refreshToken && !path.startsWith('/api/auth/')) {
      const refreshResponse = await fetch(apiUrl('/api/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken })
      }).catch(() => null);
      if (refreshResponse?.ok) {
        storeSession(await refreshResponse.json());
        return api(path, options, false);
      }
    }
    if (response.status === 401 && path !== '/api/auth/login') {
      storeSession(null);
      window.dispatchEvent(new Event('thermavax:unauthorized'));
    }
    throw new Error(data?.error || `Request failed (${response.status})`);
  }
  return data;
}

export async function login(email, password) {
  const session = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  storeSession(session);
  return session.user;
}

export async function logout() {
  if (token) {
    await api('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken })
    }).catch(() => {});
  }
  storeSession(null);
}

export function clearSession() {
  storeSession(null);
}
