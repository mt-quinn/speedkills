# Cloudflare migration preview

Implementation branch: `codex/cloudflare-migration`. The frontend remains on Vercel; production continues to use Convex until the migration readiness gates pass.

## Current milestone

The isolated Cloudflare stack contains a private simulator service, private R2 bucket, D1 game schema, and a Durable Object coordinator foundation. A deployed benchmark verifies exact fight checksums and odds against the committed Convex WASM for baseline/customized crews and 128/400 samples. See `docs/compute-report.json` for measurements and limitations.

The API deliberately reports `gameplayReady: false`. League transitions, economic commands, account/session endpoints, WebSocket subscriptions, and the Cloudflare frontend adapter are still to be implemented. The initial Vercel branch preview uses the existing development Convex backend as a baseline; it is not yet a playable Cloudflare migration. Never point it at production data to make the preview look populated.

## Preview resources

- API: `hardburn-api-preview`, `https://hardburn-api-preview.quinn-a19.workers.dev`
- Private service: `hardburn-simulator-preview` (named `Simulator` RPC entrypoint; no public route)
- D1: `hardburn-preview`, `1fcc95e4-748c-48d4-a36a-3075f863e108`
- R2: `hardburn-traces-preview` (private; no public URLs or deletion lifecycle)
- Coordinator: preview namespace `League`, name `live`, starts in maintenance

No production Worker configuration or production data import is included in this milestone. Preview resource names and bindings are explicit so accidental deployment cannot overwrite a production coordinator.

## Local setup and checks

Run from the repository root:

```sh
npm ci
npm ci --prefix cloudflare
npm run build:cloudflare:sim
npm run typecheck:cloudflare
npm run test:cloudflare
npm run test:backend
npm test
```

Worker types and the extracted WASM are generated/ignored. `build:cloudflare:sim` extracts the exact committed `convex/simBinary.ts` payload, rather than copying a possibly stale `target/` artifact. Changing the Rust implementation still uses the existing `npm run build:sim` workflow.

The tests use Wrangler's current Miniflare/workerd runtime with its V4 options converter. They compare fight bytes and 1/128/400-sample odds, concurrent-job isolation, compression/R2 metadata, authorization/origin gates, D1 batch rollback and ownership constraints, coordinator alarm repair, and Convex/Lucia password-hash verification by Better Auth. Auth compatibility uses disposable credentials, never production passwords or exports.

## Preview deployment

Cloudflare Workers Paid and R2 must be enabled. Authenticate with `npx wrangler login`, then:

```sh
npx wrangler d1 migrations apply hardburn-preview --remote --config cloudflare/wrangler.jsonc
npx wrangler deploy --config cloudflare/simulator.wrangler.jsonc
npx wrangler secret bulk /path/to/private-secrets.json --config cloudflare/wrangler.jsonc
npx wrangler deploy --config cloudflare/wrangler.jsonc
```

The private secrets file contains `BENCHMARK_KEY` and must have restricted permissions. Do not commit it, pass its value as a command-line argument, or put it in a URL. The benchmark/status/preparation routes require this credential. `/health` is public and contains no game data. Keep the public origin allowlist explicit; add only the actual Vercel preview origin when the client adapter is ready.

```sh
node tools/benchmark-cloudflare.mjs https://hardburn-api-preview.quinn-a19.workers.dev /path/to/private-secrets.json
```

The 60-second simulator CPU limit is explicit. The report measures round-trip latency and final WASM linear memory, not billed CPU or peak isolate memory; broader runtime profiling and load/fault tests remain required. No automatic promotion to production is configured.

## Next implementation stages

1. Implement serialized, durable command deduplication, match preparation acceptance, settlement, lifecycle/alarm recovery, and hourly recovery on the D1 schema.
2. Integrate Better Auth after password compatibility checks, with user/player mapping, one-time legacy claims, session revocation, and optional eight-digit reset codes. Authentication package dependencies are kept separate from the static frontend build.
3. Add authorized replay gates, bounded archive pagination, chat/moderation, and hibernating WebSocket fan-out.
4. Wire the Vercel branch client to this isolated backend, verify account/economy/live/archive flows, and provide a playable comparison URL.
5. Complete migration inventory, rehearsal, capacity/cost measurements, and the concrete production cutover runbook before switching production.
