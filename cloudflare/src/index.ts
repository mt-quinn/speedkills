import type { SimulationInput } from './simulator';
import { timingSafeEqual } from 'node:crypto';
export { League } from './league';

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
    const respond = (response: Response) => {
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
    if (url.pathname === '/health' && request.method === 'GET') {
      return respond(json({ ok: true, backend: 'cloudflare', environment: env.ENVIRONMENT, stage: 'compute-prototype', gameplayReady: false }));
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
    return respond(json({ error: 'Not found' }, 404));
  },
  async scheduled(_event, env) {
    await env.LEAGUE.getByName('live').reconcile();
  },
} satisfies ExportedHandler<Env>;
