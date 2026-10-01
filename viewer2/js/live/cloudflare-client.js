export async function connectCloudflare(cfg) {
  const base = new URL(cfg.cloudflareUrl).origin, key = `hb-auth:${base}`;
  const token = () => localStorage.getItem(key);
  const subscriptions = new Map();
  let socket, ready = false, closed = false, reconnect, failures = 0;
  async function request(path, body, retry = false) {
    const before = token();
    let response;
    try {
      response = await fetch(base + path, { method: 'POST', credentials: 'omit',
        headers: { 'Content-Type': 'application/json', ...(before ? { Authorization: `Bearer ${before}` } : {}) },
        body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    } catch (error) { if (retry) return request(path, body, false); throw error; }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || data.error || data.message || 'Request failed');
    const next = response.headers.get('set-auth-token');
    if (next && token() === before) localStorage.setItem(key, next);
    return data;
  }
  const query = async (name, args = {}) => (await request('/rpc', { kind: 'query', name, args })).value;
  const call = async (name, args = {}) => (await request('/rpc', { kind: 'command', name, args, commandId: crypto.randomUUID() }, true)).value;
  function hello() { ready = false; if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'hello', token: token() })); }
  function open() {
    if (closed) return;
    socket = new WebSocket(base.replace(/^http/, 'ws') + '/socket');
    socket.onopen = hello;
    socket.onmessage = event => {
      let data; try { data = JSON.parse(event.data); } catch { return; }
      if (data.type === 'ready') {
        ready = true; failures = 0;
        for (const [id, sub] of subscriptions) socket.send(JSON.stringify({ type: 'subscribe', id, name: sub.name, args: sub.args }));
      } else if (data.type === 'session-expired') { localStorage.removeItem(key); }
      else if (data.type === 'snapshot') {
        const sub = subscriptions.get(data.id); if (!sub) return;
        const encoded = JSON.stringify(data.value);
        if (encoded !== sub.last) { sub.last = encoded; sub.fn(data.value); }
      } else if (data.type === 'error') subscriptions.get(data.id)?.error?.(new Error(data.error));
    };
    socket.onclose = () => { ready = false; if (!closed) reconnect = setTimeout(open, Math.min(20000, 500 * 2 ** failures++)); };
    socket.onerror = () => socket.close();
  }
  function subscribe(name, args, fn, error) {
    const id = crypto.randomUUID(), sub = { name, args, fn, error, last: null };
    subscriptions.set(id, sub);
    if (ready) socket.send(JSON.stringify({ type: 'subscribe', id, name, args }));
    return () => { subscriptions.delete(id); if (ready) socket.send(JSON.stringify({ type: 'unsubscribe', id })); };
  }
  const sync = event => { if (event.key === key) hello(); };
  window.addEventListener('storage', sync); open();
  return {
    archivePages: true,
    subscribe, publicSubscribe: subscribe, call, query, action: query,
    async signIn(params) {
      if (params.flow === 'reset') {
        await request('/auth/email-otp/request-password-reset', { email: params.email }); return false;
      }
      if (params.flow === 'reset-verification') {
        await request('/auth/email-otp/reset-password', { email: params.email, otp: params.code, password: params.newPassword });
        await request('/auth/sign-in/email', { email: params.email, password: params.newPassword });
      } else {
        const legacyToken = params.flow === 'signUp' && params.claimProgress ? localStorage.getItem('hb-session') : null;
        await request(params.flow === 'signUp' ? '/auth/sign-up/email' : '/auth/sign-in/email',
          { email: params.email, password: params.password, ...(params.flow === 'signUp' ? { username: params.username, ...(legacyToken ? { legacyToken } : {}) } : {}) });
        if (legacyToken) localStorage.removeItem('hb-session');
      }
      if (!token()) throw new Error('Could not verify your session. Please sign in again.');
      await call('game:join'); hello(); return true;
    },
    async signOut() { await request('/auth/sign-out', {}); localStorage.removeItem(key); hello(); },
    connected: () => ready,
    close() { closed = true; clearTimeout(reconnect); window.removeEventListener('storage', sync); socket?.close(); },
  };
}
