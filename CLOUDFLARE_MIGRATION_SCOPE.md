# Hard Burn Cloudflare Migration Scope

## Purpose

This document scopes a future migration of Hard Burn's live-league backend from Convex to Cloudflare Workers, a Durable Object, D1, and R2. It is a planning and handoff document only; it does not authorize a production migration or code change by itself.

## Executive assessment

This is a medium-to-large backend and authentication rewrite. Allow a provisional **12–20 focused engineering days** for functional parity, account/data migration, load and fault testing, operational visibility, and a rehearsed cutover. This is a planning estimate, not a delivery commitment; re-estimate after the authentication compatibility investigation, deployed simulator benchmark, and production-data inventory. Credential incompatibility, archive partitioning, or rollback after accepting new writes may add work.

Reviewed against the repository on **October 1, 2026**. The current system has email/password accounts through Convex Auth, not anonymous-only browser accounts. Preserving those accounts and their progress is the migration default; a reset or a change in authentication/product behavior requires an explicit product decision. Implementation can begin with isolated prototypes once authorized, but production cutover requires the readiness gates below.

The current Rust/WASM simulator prevents a completely free Cloudflare deployment without redesigning or relocating simulation. Local benchmarks against the committed simulator measured:

| Operation | Measured time |
| --- | ---: |
| One detailed fight plus JSON trace | ~163 ms |
| One odds sample | ~161 ms |
| 128-sample odds calculation | ~7.5 s |

Cloudflare Workers Free allows 10 ms CPU per invocation. The existing server-authoritative simulator therefore requires Workers Paid, a different compute host, or substantial simulation redesign. Workers Paid has a $5/month minimum, includes 30 million CPU-ms per month, and defaults to a 30-second CPU limit per invocation.

R2 removes replay-file egress charges. Verify Convex billing before attributing the current bill to replay delivery. The $5/month Workers minimum is not an all-in cost ceiling: include Durable Object usage, D1 reads/writes/storage, R2 storage/operations, authentication/email, and simulator cache misses in a workload-based forecast.

## Goals

- Preserve the live-league rules and public UX.
- Preserve server authority: the global future queue, seeds, outcomes, and replay access remain private before their release boundary. Preserve the existing authenticated owner's preview of their own next opponent and queue position; it does not grant betting or replay access.
- Replace Convex reactive queries, scheduled functions, storage, and database behavior with explicit Cloudflare equivalents.
- Make replay delivery inexpensive and access-controlled.
- Preserve all existing safe fight-history records, all surviving imported replays, and every new completed replay indefinitely; make the Results tab an effectively unbounded, paginated fight archive. Already deleted recordings cannot be promised without a verified recovery source.
- Support a rehearsed production cutover with rollback before new writes reopen and a defined recovery procedure afterward.
- Make costs, error modes, and capacity observable before public launch.

## Non-goals

- Changing game economy or match rules.
- Changing the current account model, guest permissions, or password-reset behavior beyond necessary provider/session migration.
- Rebuilding the visual broadcast UI.
- Moving the static frontend off Vercel; the existing website URL and Vercel frontend deployment workflow are retained.
- Assuming a zero-dollar Cloudflare bill while retaining the current WASM simulator.

## Existing system to migrate

The relevant implementation is concentrated in:

- `convex/game.ts` — authoritative game state, economy, queue, scheduling, settlement, migrations.
- `convex/simulation.ts` — WASM simulation, odds calculation, trace storage.
- `convex/chat.ts` — chat, mute, and report behavior.
- `convex/schema.ts` — current persistent tables and indexes.
- `convex/auth.ts`, `convex/identity.ts`, `convex/passwordReset.ts`, `convex/http.ts`, and `convex/auth.config.ts` — accounts, session validation, legacy claims, reset delivery, and auth endpoints.
- `convex/accounts.test.ts` and `README.md` — account acceptance tests and current account/deployment behavior.
- `convex/crons.ts` — minute watchdog.
- `viewer2/js/live/client.js` — Convex client adapter.
- `viewer2/js/live/main.js` — subscriptions, mutation calls, trace loading, and client clock sync.
- `viewer2/docs/LIVE_LEAGUE.md` — product semantics and deployment notes.

The existing architecture has one global match cycle: 60 seconds of betting, a real-time fight, four seconds holding the final combat view, then 15 seconds of results. It uses Convex subscriptions for personalized home state, global archive state, temporary trace URLs, and optional chat.

Guests can watch, browse results, and read chat without receiving a wallet. Signed-in users can bet, sponsor and manage a ship, and send/moderate chat. Accounts support cross-device login, token refresh, sign-out revocation, case-insensitively unique usernames, optional Resend password recovery, and one-time claiming of legacy browser progress. Device preferences remain browser-local.

## Target architecture

```text
Browser
  ├─ Static game client
  ├─ Account API → Worker-compatible auth service → account/session store
  ├─ WebSocket / API → Cloudflare Worker
  │                     └─ League Durable Object (“live” singleton)
  │                         ├─ authoritative current match / queue / timers
  │                         ├─ WebSocket fan-out and command serialization
  │                         ├─ alarm-driven phase transitions
  │                         └─ D1 transactions for durable game records
  └─ Trace request → Worker authorization gate → private R2 object

Simulator Worker / service binding
  ├─ loads the Rust WASM module
  ├─ calculates odds and one deterministic fight
  ├─ writes the raw trace to R2
  └─ returns private preparation metadata to the coordinator only
```

### Responsibility boundaries

**Durable Object**

- One named global object owns every state-changing live-league operation.
- It explicitly serializes game commands and alarm commits. A single instance alone does not prevent events interleaving while awaiting D1 or simulator calls; correctness requires the commit rules below.
- It holds short-lived coordination state and its one scheduled alarm in Durable Object storage.
- It pushes explicit realtime events to connected WebSocket clients.

**D1**

- Holds durable player, ship, fight, ledger, wager, message, mute, report, and odds-cache data.
- Is the source for recovery, archive views, audit trails, and migration verification.
- Game tables are never mutated directly by public HTTP routes; game writes pass through the global Durable Object. Auth handlers may own credential/session tables, but creating or claiming a player and awarding welcome credits must enter the coordinator through a trusted internal interface.

**R2**

- Stores private raw fight traces only.
- Never exposes a permanent public object URL.
- Retains every completed trace indefinitely under a durable, private object key.
- Applies no automatic replay deletion lifecycle unless a future product decision explicitly changes the retention policy.

**Simulator service**

- Packages the existing Rust ABI as a Worker-compatible `.wasm` module.
- Generates deterministic odds and raw traces.
- Returns seed, result, stats, duration, and trace key through a private service binding to the coordinator; the public API exposes only phase-appropriate fields. The coordinator needs private metadata to settle and recover.
- Must run on Workers Paid unless simulation design changes materially.

**Authentication service**

- Uses a maintained Worker-compatible authentication implementation or managed provider selected during discovery; do not invent password cryptography.
- Owns credential verification, refresh, revocation, and password recovery; supplies a verified user/session identity to the game coordinator.
- Preserves user-to-player ownership and prevents clients from selecting another player's identity.

## Product behavior that must be preserved

- One shared global match stream and queue.
- Only the current matchup is bettable.
- The global future queue remains private. An authenticated owner can see their own next opponent and fights remaining, matching the current hangar. Seeds, pre-release outcomes, and replay keys remain private.
- Server-authoritative wagers, balances, settlement, owner income, queue priority, crew locking, sponsorship, tryouts, rename/profile changes, and hourly recovery.
- Email/password accounts with cross-device progress, unique usernames, session refresh/revocation, optional password recovery, and atomic one-time legacy-progress claiming. Legacy browser tokens never authorize game or chat actions.
- Current replay only becomes available in the allowed live/results window.
- The Results tab exposes safe summaries and statistics for an effectively unbounded number of completed fights through cursor pagination; completed raw replays are preserved privately and made available through an authorized historical-replay path.
- Optional chat with a three-second send rate limit, mutes, and reports.
- Development lab tools are either rebuilt behind a real admin/dev guard or intentionally excluded.

## Work packages

| Work package | Scope | Estimate |
| --- | --- | ---: |
| Architecture decisions | Select auth approach; configure Vercel-to-Cloudflare integration; confirm paid simulation, viewer target, replay access, and cutover policy. | 1 day |
| Cloudflare scaffold | Wrangler config, local Miniflare setup, bindings, migrations, environments, secrets, and deploy pipeline. | 0.5–1 day |
| D1 data layer | Translate schema/indexes, preserve IDs, implement atomic batches and audit/deduplication records. | 1.5–2 days |
| League Durable Object | Explicit serialization, sockets, alarms, reconnect snapshots, idempotency, and recovery. | 2–3 days |
| Authentication migration | Account/credential compatibility, sessions, reset delivery, guest gates, legacy claims, client integration. | 2–4 days |
| Simulation service | WASM packaging, Node-runtime removal, odds cache, R2 trace writing, secret metadata flow. | 1–2 days |
| Client replacement | Replace Convex client/subscriptions with reconnecting WebSocket and API client. | 1–1.5 days |
| Trace delivery | Private R2 authorization, compression, archive pagination/replay access, abandoned-preparation cleanup. | 0.5–1 day |
| Data migration/cutover | Auth/game/storage export, import, checksums, rehearsal, maintenance controls, rollback. | 1–2 days |
| Verification/operations | Parity, account, load/fault tests, metrics, alerting, runbook. | 1.5–2 days |

## D1 schema and data migration design

The game model can be translated to D1, but Convex transactions, IDs, auth tables, and storage references require explicit handling. Preserve frequently read snapshots as JSON rather than over-normalizing them. Keep existing Convex IDs as opaque text primary keys to preserve references; use collision-safe IDs for new records. If IDs must change, provide a complete mapping for relational references, queue entries, candidates, fight snapshots, and client references.

| Current concept | Proposed D1 representation |
| --- | --- |
| `users`, Convex Auth tables | Stable user identity mapping; normalized email/username, credentials or provider mapping, sessions/refresh/recovery records as required by the chosen auth implementation |
| `players` | Stable text ID, nullable unique user ID for unclaimed legacy rows, unique nullable legacy-token hash for claims only, name, balance, timestamps, candidate JSON |
| `ships` | Stable text ID, nullable owner player ID, style/identity/revision, crew JSON, career stats |
| `channel` | `league_state`: one durable state row; Durable Object storage holds live coordination cache |
| `fights` | `fights`: safe public fields, private seed/R2 trace key, timestamps, status, stats and snapshots JSON |
| `wagers` | `wagers`: player/fight unique constraint, stake/payout/returned/net |
| `ledger` | `ledger`: immutable transaction rows indexed by player and fight |
| `messages`, `mutes`, `reports` | Direct relational tables with player/message indexes |
| `odds` | `odds_cache`: unique odds key, probability, sample count, version metadata |
| New command/transition records | Durable command result and payload hash keyed by actor/command ID; unique transition/settlement keys and state versions |

Preserve monetary values as safe integers in the current scaled units: **100 stored units = 1 credit**, and transfers are multiples of 100. Add foreign keys, ownership/wager uniqueness constraints, and indexed archive/ledger access. Do not convert balances to floating-point credits during import.

### Commit, deduplication, and recovery rules

1. Serialize all authoritative game commits, including commands, alarms, and preparation completion, through an explicit coordinator queue or equivalent concurrency guard. Keep slow simulation outside that critical section; accept its result only if its durable generation and ship revisions still match.
2. Use D1 prepared-statement `batch()` transactions for related writes. Do not assume an interactive transaction spans separate awaited queries. Guard state versions and enforce database constraints inside the batch; a failed precondition must abort the batch or make every dependent write a no-op. A zero-row conditional update alone does not roll back later statements.
3. Persist the actor, command ID, payload hash, result, ledger changes, and game state in the same atomic commit. A duplicate returns its stored result; reuse of an ID with a different payload is rejected. Define the retry/deduplication retention window so an expired command cannot silently become a new action.
4. Settlement credits, owner income, career stats, and the settled marker must be atomic. If the viewer/wager target makes a single batch too large, use a durable settlement job with per-wager and per-owner unique payout keys, resumable bounded batches, and a final marker only after every effect completes. Do not publish completed results or promote the next fight before settlement completion.
5. D1 `league_state` is authoritative for phase, generation, revision, and next deadline. Durable Object storage contains the alarm and reconstructible coordination cache; it is not a second independent truth. Commit D1 first, repair the alarm from that row, then acknowledge/publish. A lost acknowledgement is recovered through command deduplication.
6. Construction and the independent watchdog reconcile D1 state with the alarm. Test a crash after D1 commit but before alarm creation, and a crash after commit but before WebSocket publication. Replay committed snapshots on reconnect; never repeat economic effects.

### Account and credential migration

- Inventory `users`, all populated Convex Auth tables, user-to-player links, and remaining unclaimed legacy players. Treat export files containing credentials or tokens as secrets; restrict access and remove temporary copies after verification.
- Select the target auth implementation and prove its compatibility with the actual exported password-hash format using disposable test accounts. Never export plaintext passwords or promise that Convex credentials can simply be copied into another provider.
- Preserve existing email/password login if compatible. If incompatible, design a verified recovery/onboarding path that preserves player ownership and requires explicit agreement before cutover. Do not silently reset accounts or grant a second welcome balance.
- Plan to invalidate Convex sessions at cutover and require sign-in to the new service; do not reinterpret old JWTs or refresh tokens as anonymous capabilities. Document the user-facing sign-in transition and session-key/cookie changes.
- Preserve case-insensitive username uniqueness, normalized email behavior, password validation, cross-device identity, sign-out revocation, and password-reset revocation of other sessions. Password reset remains optional when email delivery is unconfigured; when enabled, preserve eight-digit codes and ten-minute expiry. Signup email verification is currently disabled.
- Hash remaining legacy browser tokens for a claim-only lookup. Signup may atomically attach one unclaimed player to the new user, erase the claim hash, and preserve ship, wagers, ledger, and candidate without a welcome grant. Login never merges another browser's wallet. A legacy token cannot authorize a game mutation.
- Revalidate active sessions for protected commands and personalized snapshots, including sockets resumed after hibernation. Store only the minimum socket identity metadata; expiry/revocation must remove access without waiting for socket reconnect. Apply abuse limits to signup, login, reset, claims, and command traffic.

## Durable Object lifecycle

Use a single named object, such as `live`, with one authoritative lifecycle state machine:

1. Recover authoritative state from D1 and reconstruct the Durable Object cache on construction.
2. Ensure an alarm exists for the next phase boundary.
3. Prepare a pending fight before it needs promotion.
4. Promote the pending fight to betting.
5. At the betting deadline, publish combat availability.
6. At the fight end, settle once and publish results.
7. At the next-match deadline, advance the queue and repeat.

Durable Object alarms are at-least-once and a Durable Object has only one alarm. Store intended transitions, preparation retries, recovery deadlines, and state version durably; schedule the earliest due event. On every alarm, re-read state, confirm the expected transition is still valid, perform an idempotent commit, and schedule the next event. Preserve the four-second combat hold separately from the results duration. After an outage, reconcile overdue phases without opening betting on an already expired matchup or repeatedly settling it.

Do not rely on incoming browser traffic to advance the league. Replace the current Convex minute watchdog with an independent Worker Cron Trigger that invokes a trusted coordinator reconciliation method. It repairs missing alarms and stalled preparation and preserves hourly zero-balance recovery for eligible accounts even without client activity. Define timeout, bounded retry/backoff, and visible recovering status when simulation fails; never publish an unverified fight.

## Realtime protocol

Convex’s dependency-tracked subscriptions should not be reimplemented. Use explicit snapshot and update messages.

```text
Client → join { clientVersion } [authenticated session established by the selected auth transport; guests allowed]
Server → snapshot { home, archivePage, serverNow, revision }

Client → command { id, type, payload }
Server → command-result { id, ok, error? }

Server → home-changed { home, revision }
Server → archive-changed { latestSequence }
Server → chat-changed { messages }
Server → trace-ready { fightId }
```

Requirements:

- `command.id` is durably idempotent per actor across reconnects under the defined retry window.
- A reconnect always gets a complete snapshot.
- The server validates origin, payload shape, active session, and operation permissions. Never put bearer credentials in logged WebSocket URLs. For cookie auth, specify cookie/CORS/CSRF protections, including cross-origin hosting behavior.
- The client retries only commands designed to be idempotent.
- Personalized home data is sent only to that authenticated user's sockets. Public broadcasts contain no wallets, transactions, candidates, or owner-only queue previews. Session expiry/revocation removes personalized access.
- The socket protocol never contains private future-fight data beyond the owner's permitted next-opponent preview.
- A revision gap triggers a fresh snapshot. Bound message sizes, command rates, reconnect backoff, and slow-client buffering; coalesce public updates rather than running a full personalized D1 query per viewer on every wager.
- Archive pages are fetched through a bounded cursor API; socket events invalidate or append the latest summary, never resend the entire history.
- Use the hibernating WebSocket API so idle connections do not keep the Durable Object resident.

## Simulation migration

### Required code changes

- Keep the Rust source and deterministic ABI.
- Change the build to emit/import a `.wasm` module directly for Workers.
- Remove the current Node-specific `Buffer` use in `convex/simulation.ts`.
- Adapt Worker module initialization: runtime byte-buffer instantiation is not the supported Workers route.
- Move all simulation calls behind a simulator service boundary.
- Persist cache keys and odds in D1.
- Compress and write traces to private R2, then return private preparation metadata to the coordinator through the service binding. Public serializers enforce the embargo.

### Cost and performance constraints

The local measurements above are preliminary timing observations, not deployed Worker CPU or peak-memory measurements. A full 400-sample baseline calculation may approach the default 30-second Paid HTTP Worker CPU limit. Paid HTTP CPU limits can be configured up to 300 seconds; the appropriate limit must be measured. Workers have a 128 MB per-isolate memory limit that includes WASM allocations, JSON parsing, and compression. Do not infer production feasibility from the local benchmarks alone.

**Early implementation gate:** deploy an isolated simulator prototype using the actual WASM module before building the full backend. Measure cold/warm execution, CPU, peak memory, serialized trace size, compression, and 128/400-sample odds across baseline and customized crews. Compare fixed-seed fight outputs and odds against the existing runtime. Exercise failed/duplicate jobs and concurrent invocations; mutable WASM input/output memory must not be shared unsafely. The coordinator must stay responsive during simulation. If this fails, revise the compute design and estimate before proceeding.

Recommended pattern:

1. Seed or calculate baseline odds once and store them in `odds_cache`.
2. Reuse those odds for unchanged baseline matchups.
3. Calculate 128-sample odds only when a crew composition changes.
4. Generate exactly one raw trace per announced fight.
5. Set a paid Worker CPU limit based on Cloudflare-runtime measurements, with an explicit safe maximum.

Persist preparation generation/job identity before dispatch and reject stale completion. Recover a lost service response without promoting duplicate fights; reuse an already committed trace where possible. Delete only abandoned/stale preparation objects after proving no retained fight references them. Include cache-miss frequency, crew-change abuse limits, retries, and compression CPU in the forecast.

## R2 trace delivery

Current local traces average approximately 3.07 MiB. Use a private R2 bucket and object keys such as:

```text
traces/<fight-id>/<random-version>.json
```

The simulator writes trace objects. Serve them through a Worker gate, never a public bucket or permanent object URL. The current-match route checks that the fight is current and `startsAt <= serverNow < nextAt`; live playback does not require settlement. The historical route permits a retained, settled fight only after its live window has ended (`serverNow >= nextAt`); guests may browse historical replays just as they browse public results. Future/pending fights are denied by both routes, and unsettled fights are denied by the historical route. Keep R2 keys and seeds out of archive summaries.

Authorize before reading a cached object, and do not cache denial responses across release boundaries. Prefer internal caching of immutable replay bytes after authorization; explicitly test that browser/CDN cache behavior cannot bypass the gate. Correctly forward gzip metadata and avoid accidental decompression/recompression. Full JSON playback is the default; advertise range support only if implemented and verified for the compressed representation.

R2’s lack of egress fees addresses the main replay-delivery cost problem. Unlike the current Convex implementation, do **not** delete predecessor traces: indefinite history and replay retention are required migration outcomes.

### Required: indefinite fight history and replay retention

Cloudflare makes indefinite history materially more feasible than the present Convex design.

- **Fight history metadata:** the current backend already keeps `fights` records; the UI query intentionally returns only the most recent 30. Retain safe fight summaries indefinitely and use indexed keyset pagination by sequence plus a stable ID tie-breaker, with a bounded page size and a cursor that remains valid as new fights arrive. Search/filtering is separately prioritized.
- **Full raw replays:** keep them in R2 rather than D1. Repository samples average 3.09 MiB raw but only 0.37 MiB when gzip-compressed, an 88% reduction. Store compressed JSON with the correct `Content-Encoding: gzip` and `Content-Type: application/json` metadata so browsers transparently decode it.
- **Cost shape:** R2 Standard includes 10 GB-month of storage, 1 million Class A operations, 10 million Class B operations per month, and no egress fee. At 0.37 MiB compressed per fight, 10 decimal GB holds approximately **25,800 fights**, about **54 days** at a continuous three-minute cycle. That illustrative cadence produces roughly 480 fights/day and **68 GB/year** of retained replay data; actual fight duration changes the rate. Storage is billed by monthly average, so crossing 10 GB of stored bytes is not the same date as exceeding the monthly free allowance. Growth, reads, and other bucket usage determine the bill.
- **Product policy:** retain every new completed trace and every surviving imported completed trace indefinitely. Existing deleted recordings may be unrecoverable; preserve their summaries with an explicit `replayUnavailable` state rather than a broken replay link. Access remains gated by the Worker.
- **Database growth:** a paid D1 database has a hard 10 GB maximum. Measure fight snapshots, wagers, ledger rows, messages, and indexes against the expected workload. Define warning thresholds and an archive partition/export-and-query strategy before that limit is approached; an unbounded UI archive does not imply an unlimited single database. Preserve player/fight references and cursor behavior across any future partitions.

Required implementation additions:

1. Replace the current predecessor-trace deletion with a durable `r2_key` on each completed fight.
2. Add paginated fight-history and historical-replay endpoints.
3. Replace the fixed 30-fight Results tab subscription with cursor pagination, progressive loading, and an archive query that supports an effectively unbounded history; add filtering/search only if separately prioritized.
4. Add compression at simulation-output time and verify client decoding/range behavior.
5. Add retention, storage-growth, and R2-read metrics to the operations dashboard.

### Existing replay migration

Inventory Convex storage and fight references during rehearsal. The current settlement code deletes predecessor traces; a stored `_storage` ID does not prove the bytes still exist. Copy every surviving completed recording into private R2, gzip it, compare a checksum of the uncompressed content, and verify sample client decoding before writing its new durable key. Record missing recordings explicitly. Reconstruct a deleted replay only if an exact simulator version, seed, snapshots, and deterministic output can be verified; do not promise reconstruction as the default. Migration is resumable and must never classify a transient copy failure as a historically missing recording.

## Frontend and deployment decision

**Confirmed: keep the static frontend on Vercel.** The backend, live WebSocket/API connections, simulator, and replay storage move to Cloudflare. Preserve the existing website URL and Vercel frontend deployment workflow.

- Point the live client at environment-specific Cloudflare HTTPS and WSS endpoints through `live-config.json`.
- Configure explicit HTTP CORS and WebSocket Origin allowlists for the production Vercel frontend and approved development/preview origins. Keep previews connected to isolated backend data; do not allow arbitrary preview origins to access production credentials.
- Select and test authentication transport for the actual Vercel and Cloudflare domains. If cookie auth is selected, account for cross-site cookie restrictions, credentialed CORS, and CSRF protections; do not assume third-party cookies will work in every browser. If a bearer/session-ticket transport is selected, keep credentials out of logged URLs and preserve refresh/revocation behavior.
- Verify signup, login, refresh, reset, sign-out, reconnect, and replay fetching from the deployed Vercel origin, including supported browsers with restrictive cookie settings.

Replace `viewer2/js/live/client.js` and the Convex-specific calls in `viewer2/js/live/main.js`. Preserve the UI-facing client interface where practical to minimize rendering changes.

Update account UI/session storage integration and `live-config.json` as part of the switch. Define API/protocol version compatibility and server-side maintenance enforcement so old cached clients cannot keep writing to Convex. Preserve the current guest and owner UI behavior; historical replay controls and progressive archive loading are deliberate additions.

## Cutover plan

A safe migration is a maintenance-window migration, not live replication.

1. Complete the readiness gates and rehearse export/import, replay copies, account sign-in, and rollback using isolated data. Record expected downtime, responsible operator, exact commands, verification reports, and backups.
2. Arm a server-side maintenance gate before the selected boundary: let the current fight finish and settle, but prevent the next promotion. Block new bets once betting ends and block other public/auth writes during the final export. Stop scheduled preparation/watchdog activity and verify that no writer remains; hiding buttons is insufficient.
3. Export a frozen snapshot of users, populated auth tables, players/candidates, ships, fights, wagers, ledger, chat/moderation, odds, and channel/queue state, plus available storage files. Include a manifest with schema/simulator versions, counts, checksums, and the last committed sequence.
4. Run a resumable transform/import preserving IDs, monetary units, ownership, and private metadata. Migrate credentials according to the proven auth plan and reissue sessions on sign-in. Import surviving completed replays and record historical unavailability separately from failures.
5. Verify all row counts and references, per-player balances and ledger reconciliation, owned ships/candidates, queue order, archive summaries, credential mapping, and replay checksums. Require zero unsettled announced fights/wagers at this boundary. Discard or regenerate unannounced preparation with preserved queue order and current crew revisions.
6. Keep public writes, auth writes, and automatic league advancement disabled on Cloudflare while switching the frontend and checking read-only production snapshots. Prepare the next fight without promoting it. Convex remains frozen.
7. If validation fails before Cloudflare writes reopen, restore the endpoint and resume Convex from its frozen boundary. If validation passes, explicitly reopen Cloudflare writes and start the coordinator; record this as the point after which an endpoint-only rollback is unsafe.
8. Monitor against agreed error, latency, settlement, and alarm thresholds. Keep the frozen Convex snapshot and exports for the defined recovery window. Prefer a forward fix for issues discovered after Cloudflare accepts new activity.
9. Retire Convex only after production verification and the agreed recovery-window expiry.

### Rollback after new writes

The default plan guarantees rollback **before Cloudflare accepts new writes**. A read-only Convex copy becomes stale once Cloudflare accepts wagers, account changes, chat, or fight settlements. Switching the endpoint back at that point would lose activity and is not an approved recovery procedure.

If rollback after writes is required, add and rehearse a separate reverse migration: freeze Cloudflare at a settled boundary, export all new/changed game and auth records, reconcile balances/ledger/ownership/queue, map credentials or require secure reauthentication, and restore storage references or a compatible replay gate. Validate the restored system before reopening Convex. Define allowable downtime and data loss explicitly; otherwise the default is zero intentional data loss and forward repair from Cloudflare backups. This additional scope must be estimated before claiming a reversible post-launch cutover.

## Verification and acceptance criteria

The migration is complete only when it demonstrates all of the following:

- Concurrent or duplicate wager commands cannot double-debit.
- Concurrent economic commands, alarm commits, and preparation completions remain correct when D1/service awaits interleave. Command-ID payload conflicts are rejected, and retries after a lost acknowledgement return the original result.
- Settlement has exactly-once economic effects even after alarm retries or interruption partway through a bounded settlement job; owner payouts and career stats also cannot repeat.
- Hibernation, redeploy, or restart preserves phase and schedules the correct next alarm.
- Failure between D1 commit and alarm creation is repaired by the independent watchdog without browser traffic. Preparation failures and hourly recovery remain recoverable with the single alarm.
- Reconnect always receives an accurate snapshot and does not miss a phase transition.
- Future trace URLs, results, and seeds cannot be fetched before combat.
- All new completed replays and surviving imported replays remain retrievable through the gate after release; retention is indefinite. Missing legacy recordings display an explicit unavailable state. Cache behavior cannot expose future recordings.
- Guests receive only public state; the owner-only upcoming preview is visible only to that owner, including after socket hibernation and session revocation.
- Signup/login, refresh, sign-out revocation, username uniqueness, reset expiry/revocation, and cross-device identity preserve the cases in `convex/accounts.test.ts`. Legacy claims preserve progress once, erase the claim secret, and cannot grant credits twice or authorize game actions.
- Existing economic rules match the current shared-rule tests exactly.
- The Results tab can progressively browse an effectively unbounded archive without loading all fights or replay metadata at once; chat, mute, and report behavior remain compatible with the current UI.
- A rehearsed migration reconciles all imported counts, references, balances, ownership, candidates, and ledger totals; sampled UI checks cover accounts, recent/old fights, and replay decoding. Credential import or recovery is proven before cutover.
- Load tests meet the expected concurrent-viewer target without socket, D1, Durable Object, or CPU failures.
- Define numeric load-test pass criteria before implementation: concurrent viewers, simultaneous bettors/peak commands, reconnect burst, test duration, p95 command latency, transition lateness, and acceptable error rate. Include personalized fan-out, slow clients, and archive reads; a singleton is a capacity constraint to measure.
- Fixed-seed simulation and odds match the existing runtime; the deployed benchmark passes CPU/memory limits with measured headroom.
- A maintenance/rollback rehearsal proves old clients and scheduled jobs cannot mutate the frozen source, and no activity is silently lost on rollback.
- Production metrics distinguish Worker CPU, Durable Object requests/duration, D1 operations, R2 operations, and errors.

## Operational requirements

- Configure Worker CPU limits explicitly; do not leave expensive WASM execution unbounded.
- Monitor and alert on Worker CPU errors, Durable Object alarm failures, socket failures, D1 daily limit errors, and R2 operation errors.
- Also alert on transition lateness, stalled settlement/preparation, deduplication conflicts, auth/reset failures, and D1/R2 storage growth. Set plan-appropriate usage/budget thresholds from the forecast.
- Document a manual recovery command/runbook for a stalled league state.
- Keep a development environment entirely separate from production data and the production `live` object name.
- Implement privileged development/admin diagnostics without relying on the existing production-URL string check.
- Document backup/restore procedures for D1, auth data, and the replay manifest. Test restore and protect migration exports; retaining R2 objects alone is not a complete recovery plan.

## Readiness gates

1. **Discovery complete:** record the choices below, production data/storage inventory, credential compatibility result, explicit protocol/API contracts, and measured workload/cost forecast.
2. **Compute feasible:** deployed WASM prototype passes deterministic parity, CPU, memory, concurrency, and failure tests. Revise architecture if it fails.
3. **Staging parity:** account, economy, replay embargo, archive, lifecycle/recovery, and load criteria pass in a separate environment using migration-shaped data.
4. **Cutover rehearsed:** import/verification and maintenance/rollback runbooks succeed; define downtime, recovery window, operator, and abort thresholds. Re-estimate remaining work from this evidence.
5. **Production authorized:** approval applies to the concrete cutover plan and any user-visible credential recovery or data-loss policy. Editing this scope does not authorize changing production.

## Decisions required before implementation

1. Is Workers Paid acceptable, and what monthly budget/alert threshold should cover the full workload rather than only the $5 minimum?
2. Which Cloudflare API/WebSocket domains and approved Vercel development/preview origins should be configured? The frontend hosting decision is settled: Vercel.
3. Which Worker-compatible auth implementation/provider will preserve email/password accounts, and is its credential import compatible? Preserving accounts, balances, ownership, and durable history is the default; any reset or forced credential recovery must be explicitly agreed.
4. What viewer/bettor target, reconnect burst, latency, transition-lateness, and error thresholds should drive load testing?
5. Is the current raw-trace quality and exact simulation frequency mandatory, or may the simulator be optimized/reworked for a lower-cost execution model?
6. Which development/admin tools should ship in the new backend?
7. What maintenance downtime, backup/recovery window, and operational ownership are acceptable? Is rollback before reopening writes sufficient, or must a reverse migration after new writes also be delivered?

Confirmed hosting decision: retain the frontend on Vercel. Scope defaults: preserve the existing owner-only opponent preview; allow guests to view released historical replays; require indefinite retention for new and surviving imported completed traces; keep search/filtering optional. Record any intentional changes before implementation.

## Source material

- Cloudflare Workers limits: <https://developers.cloudflare.com/workers/platform/limits/>
- Cloudflare Workers pricing: <https://developers.cloudflare.com/workers/platform/pricing/>
- Durable Object alarms: <https://developers.cloudflare.com/durable-objects/api/alarms/>
- Durable Object concurrency/state: <https://developers.cloudflare.com/durable-objects/api/state/>
- Durable Object WebSocket hibernation: <https://developers.cloudflare.com/durable-objects/best-practices/websockets/>
- D1 pricing: <https://developers.cloudflare.com/d1/platform/pricing/>
- D1 limits and database growth: <https://developers.cloudflare.com/d1/platform/limits/>
- D1 atomic batches: <https://developers.cloudflare.com/d1/worker-api/d1-database/>
- R2 pricing: <https://developers.cloudflare.com/r2/pricing/>
- Workers WebAssembly: <https://developers.cloudflare.com/workers/runtime-apis/webassembly/>
- WASM modules in Workers: <https://developers.cloudflare.com/workers/runtime-apis/webassembly/javascript/>

Repository evidence: `README.md` (Player accounts), `convex/auth.ts`, `convex/identity.ts`, `convex/passwordReset.ts`, `convex/accounts.test.ts`, `convex/schema.ts`, `convex/game.ts` (owner preview and trace deletion), and `shared/rules.js` (monetary units and phase timing). Local benchmark figures and trace compression averages still require reproduction in the deployed prototype; they are not guarantees.

## Implementation and production authorization update — October 1, 2026

Quinn approved the isolated comparison and then explicitly approved transferring production/main to Cloudflare. The frontend stays on Vercel. The account/game/chat/socket/replay backend and data import tooling are implemented. Runtime parity, imported password compatibility, transactional settlement/recovery, privacy and import reconciliation have passed. Deployment steps and conditional recovery are in `cloudflare/docs/CUTOVER.md`; measurement reports and capacity assumptions are in `cloudflare/docs/`. Actual completion is recorded separately in `cloudflare/docs/cutover-report.json` after the production switch. Original estimates above describe planning assumptions, not a guarantee of the resulting bill or throughput.
