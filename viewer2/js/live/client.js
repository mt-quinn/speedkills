import { ConvexClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
const ref = name => makeFunctionReference(name);
export async function connect() {
  const cfg = await fetch('/live-config.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : {});
  if (!cfg.convexUrl) throw new Error('The live league is not connected yet.');
  const client = new ConvexClient(cfg.convexUrl);
  let token = localStorage.getItem('hb-session');
  if (!/^[a-f0-9]{64}$/.test(token || '')) { const bytes = crypto.getRandomValues(new Uint8Array(32)); token = [...bytes].map(x => x.toString(16).padStart(2, '0')).join(''); localStorage.setItem('hb-session', token); }
  await client.mutation(ref('game:join'), { token });
  return {
    subscribe(name, args, fn, error) { return client.onUpdate(ref(name), { token, ...args }, fn, error); },
    publicSubscribe(name, args, fn, error) { return client.onUpdate(ref(name), args, fn, error); },
    call(name, args = {}) { return client.mutation(ref(name), { token, ...args }); },
    query(name, args = {}) { return client.query(ref(name), args); },
    action(name, args = {}) { return client.action(ref(name), args); },
    connected() { return client.connectionState().isWebSocketConnected; },
    close() { client.close(); },
  };
}
