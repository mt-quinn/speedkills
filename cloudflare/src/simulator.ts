import { WorkerEntrypoint } from 'cloudflare:workers';
import binary from '../generated/sim.wasm';
import { simulator, oddsKey } from '../../shared/simulator.js';
import { fightStats } from '../../shared/rules.js';

export type Crew = { name: string; station: string; skill: number; resistance?: number; tolerance?: number };
export type ShipSnapshot = { id: string; name: string; style: string; identity: number; revision: number; crew: Crew[]; owner?: string };
export type SimulationInput = { ships: ShipSnapshot[]; seed: number; oddsSeed: number; samples: number; probability?: number; fightId: string };
type FightStats = { name: string; railShots: number; railHits: number; torpedoes: number; intercepts: number; crewSurvived: number; hull: number };
export type SimulationMetadata = {
  ships: ShipSnapshot[]; seed: number; odds: number[]; oddsSamples: number; oddsKey: string;
  duration: number; winner: number | null; stats: FightStats[]; story: string;
};
export type SimulationMetrics = { sha256: string; rawBytes: number; compressedBytes: number; wasmMemoryBytes: number };
export type PreparedSimulation = SimulationMetadata & SimulationMetrics & { traceKey: string };
type ComputeEnv = Omit<SimulatorEnv, 'COMPLETION'> & { COMPLETION: Service<import('./index').Completion> };

function validate(input: SimulationInput) {
  if (input.ships.length !== 2 || !Number.isSafeInteger(input.seed) || input.seed < 1 || input.seed > 0xffffffff ||
      !Number.isSafeInteger(input.oddsSeed) || input.oddsSeed < 1 || input.oddsSeed > 0xffffffff ||
      ![1, 128, 400].includes(input.samples) || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.fightId)) {
    throw new Error('Invalid simulation input');
  }
  for (const ship of input.ships) {
    if (!['Reference', 'Knife', 'Counter'].includes(ship.style) || ship.crew.length !== 4 ||
        !Number.isSafeInteger(ship.identity) || ship.identity < 0 || ship.identity > 0xffffffff ||
        ship.crew.some(c => !Number.isFinite(c.skill) || c.skill < 0.7 || c.skill > 1.35 ||
          (c.resistance !== undefined && (!Number.isFinite(c.resistance) || c.resistance < 1 || c.resistance > 10)))) {
      throw new Error('Invalid ship snapshot');
    }
  }
  if (input.probability !== undefined && (!Number.isFinite(input.probability) || input.probability < 0 || input.probability > 1)) {
    throw new Error('Invalid cached probability');
  }
}

// No module-level mutable WASM instance: each job has private input/output memory.
async function run(input: SimulationInput): Promise<{ compressed: ArrayBuffer; metadata: SimulationMetadata; metrics: SimulationMetrics }> {
  validate(input);
  const sim = await simulator(binary);
  const probability = Math.max(0.05, Math.min(0.95, input.probability ?? sim.odds(input.ships, input.oddsSeed, input.samples)));
  const raw = sim.fight(input.ships, input.seed);
  const json = JSON.stringify(raw);
  const bytes = new TextEncoder().encode(json);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const compressed = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const cause = raw.summary.finish_cause;
  const story = raw.winner === null ? 'Neither ship secured the win.' : cause === 'torpedo' ?
    'The final torpedo strike decided the duel.' : cause === 'railgun' ?
      'The final railgun strike decided the duel.' : 'The surviving ship takes the win.';
  return {
    compressed,
    metadata: {
      ships: input.ships, seed: input.seed, odds: [probability, 1 - probability], oddsSamples: input.samples,
      oddsKey: oddsKey(input.ships), duration: raw.frames.at(-1).t, winner: raw.winner,
      stats: fightStats(raw), story,
    },
    metrics: { sha256, rawBytes: bytes.byteLength, compressedBytes: compressed.byteLength, wasmMemoryBytes: sim.memoryBytes() },
  };
}

async function prepare(input: SimulationInput, env: ComputeEnv): Promise<PreparedSimulation> {
  const { metadata, metrics, compressed } = await run(input);
  const key = `traces/${input.fightId}/${metrics.sha256}.json.gz`;
  await env.TRACES.put(key, compressed, {
    httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' },
    customMetadata: { sha256: metrics.sha256, rawBytes: String(metrics.rawBytes) },
  });
  return { ...metadata, traceKey: key, ...metrics };
}

export class Simulator extends WorkerEntrypoint<ComputeEnv> {
  async benchmark(input: SimulationInput): Promise<SimulationMetadata & SimulationMetrics> {
    const { metadata, metrics } = await run(input);
    return { ...metadata, ...metrics };
  }

  prepare(input: SimulationInput) { return prepare(input, this.env); }
}

// Only the coordinator's service binding can invoke simulation RPC methods.
export default {
  fetch() { return new Response('Not found', { status: 404 }); },
  async queue(batch: MessageBatch<{ jobId: string }>, env: ComputeEnv) {
    for (const message of batch.messages) {
      try {
        const input = await env.COMPLETION.job(message.body.jobId);
        if (input) await env.COMPLETION.complete(message.body.jobId, await prepare(input, env));
        message.ack();
      } catch {
        try { await env.COMPLETION.fail(message.body.jobId); message.ack(); }
        catch { message.retry({ delaySeconds: 30 }); }
      }
    }
  },
} satisfies ExportedHandler<ComputeEnv, { jobId: string }>;
