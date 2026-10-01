import type { SimulationInput } from './simulator';
import { timingSafeEqual } from 'node:crypto';
import { WorkerEntrypoint } from 'cloudflare:workers';
export { League } from './league';

/** Private queue-consumer callback; no public HTTP route exposes these methods. */
export class Completion extends WorkerEntrypoint<Env> {
  job(jobId: string) { return this.env.LEAGUE.getByName('live').simulationJob(jobId); }
  complete(jobId: string, data: import('./simulator').PreparedSimulation) {
    return this.env.LEAGUE.getByName('live').completeSimulation(jobId, data);
  }
  fail(jobId: string) { return this.env.LEAGUE.getByName('live').failSimulation(jobId); }
}

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
async function authorized(request: Request, secret: string) {
  if (!secret) return false;
  const supplied = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(supplied)),
    crypto.subtle.digest('SHA-256', encoder.encode(secret)),
  ]);
  return timingSafeEqual(new Uint8Array(left), new Uint8Array(right));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const allowed = env.ALLOWED_ORIGINS.split(',').filter(Boolean);
    if (origin && !allowed.includes(origin)) return json({ error: 'Origin is not allowed' }, 403);
    const respond = (result: Response) => {
      // R2 recordings already contain gzip bytes. Preserve their encoding rather
      // than asking Workers to compress those bytes a second time.
      const response = new Response(result.body, { status: result.status, statusText: result.statusText,
        headers: result.headers, encodeBody: 'manual' });
      if (origin) {
        response.headers.set('Access-Control-Allow-Origin', origin);
        response.headers.set('Vary', 'Origin');
      }
      return response;
    };
    if (request.method === 'OPTIONS') {
      return respond(new Response(null, { status: 204, headers: {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '600',
      } }));
    }
    if (url.pathname === '/socket') return env.LEAGUE.getByName('live').fetch(request);
    if (url.pathname.startsWith('/auth/') || url.pathname === '/rpc') {
      if (Number(request.headers.get('Content-Length') ?? 0) > 16_384) return respond(json({ error: 'Payload too large' }, 413));
      return respond(await env.LEAGUE.getByName('live').fetch(request));
    }
    if ((url.pathname.startsWith('/replay/') || url.pathname.startsWith('/archive/replay/')) && request.method === 'GET') {
      const historical = url.pathname.startsWith('/archive/replay/');
      const key = await env.LEAGUE.getByName('live').replayAccess(decodeURIComponent(url.pathname.slice(historical ? 16 : 8)), historical);
      if (!key) return respond(json({ error: 'Replay is not available' }, 404));
      const object = await env.TRACES.get(key);
      if (!object) return respond(json({ error: 'Recording is unavailable' }, 404));
      return respond(new Response(object.body, { encodeBody: 'manual', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Cache-Control': 'private, no-store' } }));
    }
    if (url.pathname === '/health' && request.method === 'GET') {
      const state = await env.DB.prepare("SELECT maintenance,current_id FROM league_state WHERE id = 'live'").first<{maintenance:number;current_id:string|null}>();
      return respond(json({ ok: !!state, backend: 'cloudflare', environment: env.ENVIRONMENT,
        stage: 'league', maintenance: !!state?.maintenance, gameplayReady: !!state?.current_id && !state.maintenance }));
    }
    if (['/internal/benchmark', '/internal/prepare'].includes(url.pathname) && request.method === 'POST') {
      if (!await authorized(request, env.BENCHMARK_KEY)) return respond(json({ error: 'Unauthorized' }, 401));
      if (!request.headers.get('Content-Type')?.startsWith('application/json')) return respond(json({ error: 'Expected JSON' }, 415));
      const text = await request.text();
      if (text.length > 16_384) return respond(json({ error: 'Payload too large' }, 413));
      try {
        const input = JSON.parse(text) as SimulationInput;
        const result = url.pathname === '/internal/prepare' ? await env.SIMULATOR.prepare(input) : await env.SIMULATOR.benchmark(input);
        return respond(json(result));
      } catch {
        return respond(json({ error: 'Simulation benchmark failed' }, 422));
      }
    }
    if (url.pathname === '/internal/status' && request.method === 'GET') {
      if (!await authorized(request, env.BENCHMARK_KEY)) return respond(json({ error: 'Unauthorized' }, 401));
      return respond(json(await env.LEAGUE.getByName('live').reconcile()));
    }
    if (url.pathname === '/internal/control' && request.method === 'POST') {
      if (!await authorized(request, env.BENCHMARK_KEY)) return respond(json({ error: 'Unauthorized' }, 401));
      const text = await request.text();
      if (text.length > 1024) return respond(json({ error: 'Payload too large' }, 413));
      try { return respond(json(await env.LEAGUE.getByName('live').control(JSON.parse(text).action))); }
      catch { return respond(json({ error: 'Invalid control request' }, 400)); }
    }
    return respond(json({ error: 'Not found' }, 404));
  },
  async scheduled(_event, env) {
    await env.LEAGUE.getByName('live').watchdog();
  },
} satisfies ExportedHandler<Env>;
