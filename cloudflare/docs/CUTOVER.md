# Production cutover — October 1, 2026

Operator: Codex acting on Quinn's explicit production/main migration approval. The frontend remains on Vercel. Allow roughly 5–15 minutes of maintenance for a small final export/import and verification; the current fight finishes before the window starts. Queues provide separate compute invocations, with a private completion callback.

1. Pass runtime, existing backend/frontend, import and staging capacity checks. Create isolated production schema/bucket/private simulator/API, with fresh secrets. Confirm zero users, players and fights, maintenance=1.
2. Deploy the guarded Convex functions while gameplay continues. Arm `npx convex run migration:requestFreeze --prod '{}'`. Poll `migration:status` until frozen at promotion, after the current fight settles. All game, chat, recovery, scheduler and actual auth-store writes then stop.
3. Export with `npx convex export --prod --include-file-storage --path /private/tmp/hardburn-production-frozen-20261001.zip`; restrict permissions to 0600. Transform with `python3 tools/prepare-cloudflare-import.py SNAPSHOT PRIVATE_BUNDLE --require-frozen`.
4. Upload the trace manifest's gzip files to private production R2 with content type application/json and content encoding gzip. Execute PRIVATE_BUNDLE/import.sql on the empty production D1 database, still paused. Never log user records or credential hashes.
5. Run `python3 tools/verify-cloudflare-import.py PRIVATE_BUNDLE cloudflare/production.wrangler.jsonc hardburn-prod`. Compare every imported field, stable ID and credential hash. Verify counts, per-player ledger/balance equality, foreign keys, no unsettled wagers, queue order and available replay checksums. Preserve a valid unannounced pending fight only when the identical simulator and current crew revisions match.
6. Set Vercel production VITE_CLOUDFLARE_URL to the production API. Publish/merge the tested branch onto main and deploy Vercel production. Verify static configuration, read-only snapshots and private replay gates while both backends remain paused.
7. Reopen Cloudflare with the authenticated control action resume. Record reopenedAt and sourceHash. Verify the imported pending fight promotes, new preparation completes, settlement and subsequent advancement occur without visitors. Keep Convex frozen.

## Recovery

Before reopening, restore the previous Vercel deployment and run `migration:cancelFreeze` on Convex if verification fails. The untouched frozen source and private export remain available. Reopening schedules new fights immediately, so after reopening use forward repair or a fully reconciled reverse migration; an endpoint-only rollback would discard activity. The newWrites marker additionally identifies account/session/command activity, but it is not a guarantee that no automatic advancement occurred.

Keep the frozen Convex deployment and the protected export for at least seven days. Persistent backups and production operator secrets are stored under the ignored, owner-only `.migration-backups/2026-10-01/` directory; a temporary export alone is not the recovery copy. Do not delete either automatically. Retiring that recovery copy is a separate explicit operation. Password reset was unconfigured in production before migration and remains unavailable until an email provider is configured.

## Operational checks

Use authenticated `/internal/status` for phase, revision, alarm, maintenance, sourceHash and reopening/write markers. Use `/health` for backend/readiness only. Pause via the operator control route before any repair requiring a stable snapshot. Investigate simulation exceptions, a running preparation lease older than five minutes, a missing alarm, unsettled wagers after the result window, repeat credits, or sustained command latency above two seconds. Secrets and private dumps must stay out of Git, logs and public artifacts.

## Executed cutover

Completed October 1, 2026. Convex froze at settled fight 471; the verified import preserved the pending fight 472. Cloudflare reopened at 2026-10-01T23:15:10.871Z. The maintenance window lasted approximately 27 minutes, longer than estimated because a private Vercel build-source upload of migration backups required replacement, secret rotation and deployment removal before reopening. `.vercelignore` now explicitly excludes those files. See `cutover-report.json` for incident scope and verification limits. Production subsequently completed four fights with matching aggregate balances/ledger and no unsettled wagers on completed fights. The frontend remains on Vercel at https://www.hardburn.fun.
