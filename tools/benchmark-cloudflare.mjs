import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { simulator } from '../shared/simulator.js';

const [endpoint, secretFile] = process.argv.slice(2);
if (!endpoint || !secretFile) throw new Error('Usage: node tools/benchmark-cloudflare.mjs <preview-api-url> <private-secret-file>');
const { BENCHMARK_KEY } = JSON.parse(await readFile(secretFile, 'utf8'));
const source = await readFile('convex/roster.ts', 'utf8');
const roster = JSON.parse(source.slice(source.indexOf('=') + 1).trim().replace(/;$/, ''));
const nodeSim = await simulator(await readFile('cloudflare/generated/sim.wasm'));
const cases = [
  { pair: [0, 1], samples: 128 },
  { pair: [4, 5], samples: 400 },
  { pair: [7, 8], samples: 128, customized: true },
];
const measurements = [];
for (const [i, fixture] of cases.entries()) {
  const ships = fixture.pair.map(index => {
    const s = roster.ships[index];
    return { id: `benchmark-ship-${index}`, name: s.name, style: s.style, identity: 1000 + index,
      revision: 1, crew: structuredClone(s.crew) };
  });
  if (fixture.customized) ships[0].crew[0] = { ...ships[0].crew[0], skill: 1.3, resistance: 9 };
  const seed = 73421 + i, oddsSeed = 51283 + i;
  const input = { ships, seed, oddsSeed, samples: fixture.samples, fightId: `benchmark-${i}` };
  const expectedHash = createHash('sha256').update(JSON.stringify(nodeSim.fight(ships, seed))).digest('hex');
  const expectedOdds = Math.max(0.05, Math.min(0.95, nodeSim.odds(ships, oddsSeed, fixture.samples)));
  const started = performance.now();
  const response = await fetch(new URL('/internal/benchmark', endpoint), {
    method: 'POST', headers: { Authorization: `Bearer ${BENCHMARK_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input), signal: AbortSignal.timeout(90_000),
  });
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json();
  assert.equal(result.sha256, expectedHash, 'Deployed fight differs from existing runtime');
  assert.equal(result.odds[0], expectedOdds, 'Deployed odds differ from existing runtime');
  const row = { pair: fixture.pair, customized: !!fixture.customized, samples: fixture.samples,
    roundTripMs: Math.round(performance.now() - started), sha256: result.sha256,
    rawBytes: result.rawBytes, compressedBytes: result.compressedBytes, wasmMemoryBytes: result.wasmMemoryBytes };
  measurements.push(row);
  console.log(JSON.stringify(row));
}
await writeFile('cloudflare/docs/compute-report.json', JSON.stringify({
  recordedAt: new Date().toISOString(), endpoint, runtime: 'deployed-cloudflare',
  simulator: JSON.parse(await readFile('cloudflare/generated/sim-manifest.json', 'utf8')),
  measurements,
  limitations: ['Round-trip times include network latency; they are not billed CPU measurements.',
    'WASM memory is linear memory after execution, not peak total isolate memory.',
    'Passing a small fixture set does not establish load capacity or full gameplay parity.'],
}, null, 2) + '\n');
console.log('Deployed simulator parity report saved.');
