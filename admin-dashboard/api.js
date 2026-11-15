export class ApiError extends Error {
  constructor(status, data) {
    super(typeof data.error === 'string' ? data.error : 'The request failed.');
    this.status = status;
    this.code = data.code;
    this.requestId = data.requestId;
  }
}

export function createApi(fetcher = globalThis.fetch) {
  let session;
  let rotating;
  let epoch = 0;
  function clear() { session = undefined; rotating = undefined; epoch++; }
  async function send(path, options, token) {
    const response = await fetcher(path.startsWith('/api/') || path === '/ready' ? path : '/api/v1' + path, {
      method: options.method || 'GET',
      cache: 'no-store',
      redirect: 'error',
      credentials: 'same-origin',
      headers: { ...(options.body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: 'Bearer ' + token }) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(response.status, data);
    return data;
  }
  function rotate() {
    if (rotating) return rotating;
    if (!session?.refreshToken) return Promise.reject(new ApiError(401, { error: 'Sign in again.' }));
    const credential = session.refreshToken;
    const version = epoch;
    session = { ...session, refreshToken: undefined };
    rotating = send('/auth/refresh', { method: 'POST', body: { refreshToken: credential } })
      .then(next => {
        if (version !== epoch) throw new ApiError(401, { error: 'Sign in again.' });
        session = next;
        return next;
      }).catch(error => {
        if (version === epoch) clear();
        throw error;
      }).finally(() => { if (version === epoch) rotating = undefined; });
    return rotating;
  }
  async function request(path, options = {}) {
    const token = session?.accessToken;
    const version = epoch;
    try { return await send(path, options, token); } catch (error) {
      if (!token || error.status !== 401 || version !== epoch || options.noRefresh) throw error;
      if (session?.accessToken === token || !session) await rotate();
      return send(path, options, session?.accessToken);
    }
  }
  return {
    async login(body) {
      clear();
      const version = epoch;
      const next = await send('/auth/login', { method: 'POST', body });
      if (version === epoch) session = next;
      return next.user;
    },
    async logout() {
      try { if (session) await request('/auth/logout', { method: 'POST' }); }
      finally { clear(); }
    },
    clear, request,
    token: () => session?.accessToken,
  };
}
