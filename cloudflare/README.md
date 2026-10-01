# Cloudflare league

Hard Burn keeps its static frontend on Vercel. The backend implements accounts, wallets, ownership, matchmaking, settlement, chat, live subscriptions and private recordings on Cloudflare. Production cutover status is recorded in `docs/cutover-report.json` and `docs/CUTOVER.md`.

Comparison preview: https://hardburn-cf-preview-thegameband.vercel.app (isolated test data, existing Vercel preview protection). Production frontend: https://hardburn.vercel.app . The original development-Convex baseline is https://hardburn-6r7uzy07f-thegameband.vercel.app .

| Resource | Preview | Production |
| --- | --- | --- |
| API | hardburn-api-preview.quinn-a19.workers.dev | hardburn-api-prod.quinn-a19.workers.dev |
| Private simulator | hardburn-simulator-preview | hardburn-simulator-prod |
| D1 | hardburn-preview | hardburn-prod |
| R2 | hardburn-traces-preview | hardburn-traces-prod |
| Preparation Queue | hardburn-preparations-preview | hardburn-preparations-prod |
| Coordinator | Separate League namespace, live | Separate League namespace, live |

The simulator has no public route. Buckets have no public access or deletion lifecycle. Recordings become available through the API at combat start; historical playback unlocks after the result window and settlement. Retained completed recordings are kept indefinitely. Older Convex recordings already deleted by the old backend remain explicitly unavailable.

## Checks and deployment

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

Generated types/WASM are ignored. The simulator build extracts the exact committed `convex/simBinary.ts` payload. Better Auth is isolated from the static frontend install.

```sh
npx wrangler d1 migrations apply hardburn-preview --remote --config cloudflare/wrangler.jsonc
npx wrangler deploy --config cloudflare/simulator.wrangler.jsonc
npx wrangler secret bulk /path/to/private-secrets.json --config cloudflare/wrangler.jsonc
npx wrangler deploy --config cloudflare/wrangler.jsonc
```

For production use `production.wrangler.jsonc`, `simulator.production.wrangler.jsonc` and `hardburn-prod` explicitly. On first setup deploy the simulator without its completion service binding, then the API, then the queue consumer with the completion binding; on updates deploy the API before the consumer. Schema creation starts paused; deploying code does not reopen a paused league.

Secrets are `AUTH_SECRET` and `BENCHMARK_KEY`, with optional `AUTH_RESEND_KEY` and `AUTH_EMAIL_FROM` for password reset. Keep credential files mode 0600 outside the checkout. Operator routes `/internal/status`, `/internal/control`, `/internal/prepare` and `/internal/benchmark` require the operator bearer secret; never put it in a URL. Production CORS and socket origins allow only the production Vercel origin. Preview origins are explicitly listed.

The Vercel build selects `VITE_CLOUDFLARE_URL` when configured; Convex remains supported for the frozen baseline. No production Cloudflare data is used in previews. Sessions must be reissued by signing in with the existing email/password; account IDs, credential hashes, player IDs and progress are preserved by import.

## Reliability and measurements

D1 is authoritative. The Durable Object explicitly serializes mutations, with revision guards and atomic command/effect deduplication. Preparation stores seeds, inputs, generation and a five-minute lease before enqueueing a job ID. A separate Queues invocation runs the private simulator and calls the private Completion entrypoint; heavy WASM never executes in the coordinator request tree. Alarms drive advancement and paged settlement; a minute cron repairs missed alarms. Hibernating sockets revalidate session IDs and share public snapshot reads during fan-out.

Runtime tests cover imported password compatibility, legacy claims, multi-device revocation/reset, concurrent command retries, ownership/crew operations, 60-wager settlement interruption, stale preparation, duplicate queue delivery and private completion, parity at 1/128/400 samples, compression/HTTP decoding, replay privacy, database rollback and alarm repair. Reports in `docs/` contain deployed simulator CPU samples, local conservative memory bounds and the deployed viewer-load measurement. Memory checkpoints are not a continuous production peak measurement.
