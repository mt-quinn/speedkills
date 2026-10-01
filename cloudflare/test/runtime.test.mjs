import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { gunzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { simulator } from '../../shared/simulator.js';
import { Scrypt } from 'lucia';
import { verifyPassword } from '../node_modules/better-auth/dist/crypto/index.mjs';

const key = 'local-test-key-not-a-deployment-secret';
let mf, nodeSim, ships;
const call = (path, options = {}) => mf.dispatchFetch(`http://localhost${path}`, options);
const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
function job(samples = 1, overrides = {}) {
  return { ships, seed: 73421, oddsSeed: 51283, samples, fightId: 'test-fight', ...overrides };
}

before(async () => {
  await Promise.all([
    build({ entryPoints: ['cloudflare/src/index.ts'], bundle: true, format: 'esm', platform: 'neutral',
      outfile: 'cloudflare/generated/index.mjs', external: ['cloudflare:workers', 'node:*'] }),
    build({ entryPoints: ['cloudflare/src/simulator.ts'], bundle: true, format: 'esm', platform: 'neutral',
      outfile: 'cloudflare/generated/simulator.mjs', external: ['cloudflare:workers', '*.wasm'] }),
    build({ entryPoints: ['cloudflare/test/password-worker.ts'], bundle: true, format: 'esm', platform: 'neutral',
      outfile: 'cloudflare/generated/password-worker.mjs', external: ['node:*'] }),
  ]);
  const source = await readFile('convex/roster.ts', 'utf8');
  const roster = JSON.parse(source.slice(source.indexOf('=') + 1).trim().replace(/;$/, ''));
  ships = roster.ships.slice(0, 2).map((s, i) => ({ id: `ship-${i}`, name: s.name, style: s.style,
    identity: 1000 + i, revision: 1, crew: s.crew }));
  nodeSim = await simulator(await readFile('cloudflare/generated/sim.wasm'));
  mf = new Miniflare(convertV4MiniflareOptions({ workers: [
    { name: 'api', compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat'],
      modules: [{ type: 'ESModule', path: resolve('cloudflare/generated/index.mjs') }],
      bindings: { ENVIRONMENT: 'preview', ALLOWED_ORIGINS: 'http://localhost:3000', BENCHMARK_KEY: key },
      d1Databases: { DB: 'preview-test' }, r2Buckets: { TRACES: 'trace-test' },
      durableObjects: { LEAGUE: { className: 'League', useSQLite: true } },
      serviceBindings: { SIMULATOR: { name: 'simulator', entrypoint: 'Simulator' } } },
    { name: 'simulator', compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat'],
      modules: [
        { type: 'ESModule', path: resolve('cloudflare/generated/simulator.mjs') },
        { type: 'CompiledWasm', path: resolve('cloudflare/generated/sim.wasm') },
      ], r2Buckets: { TRACES: 'trace-test' } },
    { name: 'password-test', compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat'],
      modules: [{ type: 'ESModule', path: resolve('cloudflare/generated/password-worker.mjs') }] },
  ] }));
  const db = await mf.getD1Database('DB', 'api');
  const sql = await readFile('cloudflare/migrations/0001_league.sql', 'utf8');
  const statements = sql.replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean);
  await db.batch(statements.map(s => db.prepare(s)));
});
after(async () => { await mf?.dispose(); });

test('health is honest about prototype readiness; benchmark is protected and simulator has no public endpoint', async () => {
  assert.equal((await (await call('/health')).json()).gameplayReady, false);
  assert.equal((await call('/internal/benchmark', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(job()) })).status, 401);
  assert.equal((await call('/health', { headers: { Origin: 'https://untrusted.example' } })).status, 403);
  const preflight = await call('/internal/benchmark', { method: 'OPTIONS', headers: { Origin: 'http://localhost:3000' } });
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'http://localhost:3000');
  const worker = await mf.getWorker('simulator');
  assert.equal((await worker.fetch('http://simulator/')).status, 404);
});

test('compiled-module Worker produces exactly the current Node fight and odds, including 400 samples', { timeout: 120_000 }, async () => {
  const raw = JSON.stringify(nodeSim.fight(ships, 73421));
  const expectedHash = createHash('sha256').update(raw).digest('hex');
  for (const samples of [1, 128, 400]) {
    const started = performance.now();
    const response = await call('/internal/benchmark', { method: 'POST', headers, body: JSON.stringify(job(samples)) });
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    const workerWallMs = Math.round(performance.now() - started);
    assert.equal(result.sha256, expectedHash);
    assert.equal(result.rawBytes, Buffer.byteLength(raw));
    assert.equal(result.odds[0], Math.max(0.05, Math.min(0.95, nodeSim.odds(ships, 51283, samples))));
    assert.ok(result.compressedBytes < result.rawBytes);
    assert.ok(result.wasmMemoryBytes < 128 * 1024 * 1024);
    console.log(JSON.stringify({ runtime: 'local-workerd', samples, workerWallMs, ...result,
      ships: undefined, stats: undefined, seed: undefined, oddsKey: undefined, story: undefined }));
  }
});

test('cached-odds jobs remain deterministic under concurrent invocations; invalid jobs are rejected', async () => {
  const [a, b] = await Promise.all([73421, 83422].map(seed => call('/internal/benchmark', {
    method: 'POST', headers, body: JSON.stringify(job(1, { seed, probability: 0.6 })),
  })));
  for (const [response, seed] of [[a, 73421], [b, 83422]]) {
    const result = await response.json();
    assert.equal(result.sha256, createHash('sha256').update(JSON.stringify(nodeSim.fight(ships, seed))).digest('hex'));
    assert.equal(result.odds[0], 0.6);
  }
  assert.equal((await call('/internal/benchmark', { method: 'POST', headers, body: JSON.stringify(job(9999)) })).status, 422);
});

test('D1 enforces monetary and ownership invariants and failed batches roll back', async () => {
  const db = await mf.getD1Database('DB', 'api');
  await assert.rejects(db.batch([
    db.prepare("INSERT INTO players(id, name, balance, created_at) VALUES ('atomic-one', 'One', 50000, 1)"),
    db.prepare("INSERT INTO players(id, name, balance, created_at) VALUES ('bad-units', 'Bad', 51, 1)"),
  ]));
  assert.equal(await db.prepare("SELECT id FROM players WHERE id = 'atomic-one'").first(), null);
  await db.prepare("INSERT INTO players(id, user_id, name, balance, created_at) VALUES ('owned-one', 'user-one', 'One', 50000, 1)").run();
  await assert.rejects(db.prepare("INSERT INTO players(id, user_id, name, balance, created_at) VALUES ('owned-two', 'user-one', 'Two', 50000, 1)").run());
});

test('private preparation persists a gzip trace with verified checksum and decoding metadata', async () => {
  const response = await call('/internal/prepare', { method: 'POST', headers,
    body: JSON.stringify(job(128, { probability: 0.6, fightId: 'retained-test' })) });
  assert.equal(response.status, 200);
  const result = await response.json();
  const bucket = await mf.getR2Bucket('TRACES', 'api');
  const object = await bucket.get(result.traceKey);
  assert.ok(object);
  assert.equal(object.httpMetadata.contentType, 'application/json');
  assert.equal(object.httpMetadata.contentEncoding, 'gzip');
  const raw = gunzipSync(Buffer.from(await object.arrayBuffer()));
  assert.equal(createHash('sha256').update(raw).digest('hex'), result.sha256);
  assert.equal(JSON.parse(raw.toString()).winner, result.winner);
  assert.equal((await call('/internal/prepare', { method: 'POST', body: '{}' })).status, 401);
});

test('Better Auth verifies current Convex/Lucia scrypt hashes in Node and Workers, including normalization', async () => {
  const worker = await mf.getWorker('password-test');
  const old = new Scrypt();
  for (const password of ['disposable-test-passphrase-123', 'Ｔｅｓｔ-password-123']) {
    const hash = await old.hash(password);
    assert.equal(await verifyPassword({ hash, password }), true);
    const verify = async value => (await (await worker.fetch('http://password-test/', {
      method: 'POST', body: JSON.stringify({ hash, password: value }),
    })).json()).valid;
    assert.equal(await verify(password), true);
    assert.equal(await verify('incorrect-password'), false);
  }
});

test('coordinator reads authoritative D1 state and repairs alarm changes without game traffic', async () => {
  const db = await mf.getD1Database('DB', 'api');
  const before = await (await call('/internal/status', { headers })).json();
  assert.equal(before.maintenance, true);
  const deadline = Date.now() + 3600_000;
  await db.prepare('UPDATE league_state SET revision = 7, maintenance = 0, next_at = ? WHERE id = ?').bind(deadline, 'live').run();
  const after = await (await call('/internal/status', { headers })).json();
  assert.equal(after.revision, 7);
  assert.equal(after.nextAt, deadline);
  assert.equal(after.alarmAt, deadline);
  await db.prepare("UPDATE league_state SET maintenance = 1 WHERE id = 'live'").run();
  const stopped = await (await call('/internal/status', { headers })).json();
  assert.equal(stopped.maintenance, true);
  assert.equal(stopped.alarmAt, null);
});
