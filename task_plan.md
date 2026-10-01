# Hard Burn broadcast and combat improvements

User approved the seven recommendations from the high-level review, plus a phone-recording voice-line manifest. Preserve existing uncommitted work. No economy, new ship designs, or outcome filtering.

## Phases
1. Broadcast state, tactical openings, and crew continuity — complete.
2. Decisive replay and factual finish explanations — complete.
3. Visual emphasis and persistent damage — complete.
4. Counter doctrine experiment, statistical gates, refreshed odds/card — complete.
5. Competitor history, fresh unfiltered cards, pick integrity — complete.
6. Voice catalog, measured trigger counts, variation recommendations and recording manifest — complete.
7. Browser verification, sim/tests and documentation — complete with documented phone frame-fill limitation.

## Validation
Pure state/narrative tests must cover destroyed ships, dead speakers, no future outcome leakage, resource warnings, replay settlement and history deduplication. Run duel tests, doctrine experiment and spectacle scoring. Verify desktop/mobile and decisive replay, then audit refreshed card. Voice frequencies describe emitted lines on the generated card, not available audio recordings.

## Errors
Browser button locator initially used uppercased rendered text. Corrected to source accessible name. No application errors observed.

## Final verification
13 Rust tests and8 Node tests pass. All6 sim spectacle gates pass across1200 fights. Desktop audit12/12 on allcriteria. Phone390×844 audit12/12 except frame-fill11/12 (L51006 tiny3.1% of runtime); faster zoom experiments were rejected. Voice manifest measures1370s over12 fights and recommends72clips across16cues. Full45pairing×400 odds refreshed; cached fresh-card authoring verified. No recorded voice files yet.

## Voice revision — complete
User requested fewer, stronger scripts with repeated performances of identical words. Catalog and runtime now use one script per cue; manifest recommends vocal takes rather than wording variations.18 scripts/77 takes, measured on the same12 fights. Ten broadcast tests pass.

# Hangar and continuous live league — active

## Agreed product
Hangar is home. Empty berth teaches sponsorship goal. Credits from betting fund a new named ship; 1% of winning bettors’ profit is owner income. Paid single-station candidate tryouts can be accepted/rejected; pending candidates survive navigation/reload. Rename costs a fee. Crews/ships reset between duels. One global stream:60s betting, real-time fight,15s results. Past fights expose stats only. Optional global viewer chat with remembered visibility, mute/report/rate limits. Vercel hosts hardburn.vercel.app; Convex is the target shared backend.

## Implementation phases
1. Inspect deployment/sim boundaries, record interaction and backend design — in progress.
2. Authoritative league/economy/chat backend with meaningful state/settlement tests.
3. Hangar, ownership, betting, results archive, optional chat; preserve pending decisions.
4. Integrate synchronized broadcast with no public playback controls or archives of traces.
5. Desktop/mobile and multi-client validation; setup/deployment documentation.

Economy values are initial tuning defaults, clearly centralized. No production deployment or git push requested in this turn. Preserve uncommitted voice revision.

# Cloudflare migration — approved 2026-10-01

User approved CLOUDFLARE_MIGRATION_SCOPE.md and requested a branch-based live comparison. Keep the Vercel frontend and isolated Cloudflare preview. Production cutover was subsequently authorized; preserve accounts during cutover; preview uses independent test accounts/data.

## Migration phases
1. Branch, deployment access, simulator feasibility and auth compatibility — complete.
2. D1 schema, transactional command/settlement layer, Durable Object lifecycle and private R2 — complete.
3. Account/auth parity, chat/moderation, client transport and paginated archives — complete.
4. Runtime integration, fault/security/parity/load checks and deployment docs — complete.
5. Push branch and publish isolated Vercel/Cloudflare comparison preview — complete.
6. Production data inventory/rehearsal/cutover — complete. Production/main now uses Cloudflare, with the Vercel frontend retained and production accounts, IDs, balances, ships and history preserved.

## Migration issues
- Initial git branch creation denied by filesystem sandbox; retry with approved escalation for Git metadata.

## Migration checkpoint: compute prototype verified
- Phase 1 initial feasibility and access milestone complete: branch, paid provider access, isolated resources, deployed deterministic benchmark and disposable credential compatibility.
- Remaining phase-1 production readiness evidence: actual auth/storage inventory, billed CPU/peak-memory profiling, workload/pass thresholds. These do not block isolated game implementation.
- Phase 2 next: durable game commands, lifecycle, preparation acceptance and settlement. Phase 3–6 remain pending as above.
- Resolved tooling issues: Miniflare 5 API via supported converter; old runtime removed; auth dependencies isolated to avoid optional framework peer conflict. Deployed resources and current limitations documented in cloudflare/README.md.

## Full implementation checkpoint
- Account, game/economy, durable preparation/settlement, chat, replay and frontend adapter implemented.
- Full runtime suite: 16 passing; existing backend: 8 passing; frontend/shared: 71 passing; both TypeScript projects pass.
- Final import rehearsal matches counts, balances, per-player ledgers and references. Available traces retain checksums; missing historical recordings are explicit.
- Production resources prepared in maintenance; guarded Convex production remains unfrozen until final capacity gate passes.

## Final migration checkpoint — complete
- Frozen export verified against 1,010 imported records; original credential hashes and IDs preserved. Two surviving recordings copied and checksummed.
- Production reopened; four subsequent fights settled and five preparation jobs completed. Aggregate wallet and ledger totals match; completed fights have no unsettled wagers.
- Main integrated and production Vercel configuration points to Cloudflare. Isolated comparison preview retained.
- Corrected private Vercel source-upload incident before reopening: excluded backups, verified replacement upload, rotated Cloudflare secrets and removed affected deployment. Details and limits are in the cutover report.
- Frozen Convex and protected export retained for recovery; no endpoint-only rollback after reopening.
