# Findings

- Viewer is static playback of Rust sk-duel traces; 30 Hz frames include PDC ammo/heat, rail cooldown, crew health and normalized g-dose.
- Composite integrity weights hull 40%, systems 40%, living crew 20%; a destroyed ship can retain a substantial index. End-state presentation must override it without treating it as win probability.
- Existing HUD chatter ignores speaker survival; Fairweather spoke after death in L40000.
- L40000 finishes after Halcyon's screen runs dry. L40009 ends when Sable's ram destroys Sable, with Vesper surviving at 2% hull.
- Saved 1,200-fight sample: Counter/Knife rail median 1.3/1.4 km. Reference attack-run/extend behaviour is distinct.
- Current league is ten ships, 45 pairings × 400 simulations, 12 fixed unfiltered recordings. Fresh card generation can reuse unchanged odds.
- Existing code and generated league files are uncommitted; preserve them.

## Implemented broadcast pass
- Live opening analysis reads only current raw frames; rail reload, PDC seconds/heat and g-dose warnings are visible.
- Condition is labelled separately from win odds; destroyed ships show OUT and final winner takes precedence.
- Portraits persist into live ship plates. Speech requires conscious crew; casualty flags state station consequences.
- Optional decisive replay is 4–12 seconds before finish, labelled REPLAY, returns to the result, and cannot duplicate history/pick settlement.
- Voice catalog in js/voices.js feeds subtitles and docs/VOICE_RECORDING_MANIFEST.md. Optional recorded clips use sfx/voices/index.json; speech ducks music/effects, does not pitch-shift in slow motion, and stops on seek/casualty.
- Form and head-to-head derive solely from completed fights on this device. Just-watch closes later picks.

## Counter experiment
- First reserve-only candidate passed gates but barely changed range. Added explicit RCS braking against a ready opposing rail; no outward drive burn.
- Accepted candidate: 1,200 unfiltered default-crew fights, all six gates PASS. Median84s, unfinished0, short0%, condition swings63%, winner previously behind70%, lethal-g7%.
- Counter vs Knife49%, vs Reference57%; overall52%. Holding-range state averages15.4s for Counter and0 for other doctrines. Average closest approach450m versus232m on reserve-only candidate.
- Full400-fight odds for each45pairings are being refreshed; static viewer card is12 unfiltered matchups.

## Final status
- Voice catalog16cues; measured72 recommended clips on1370s current card. Optional variations beyond the recommended set are scripted; partial audio packs select matching subtitles.
- Desktop audit all12/12 after conservative framing margin. Phone all12/12 except frame fill11/12 (L51006 small for3.1% runtime); farther zoom experiments did not produce enough benefit and were reverted.
- Full odds and fresh unfiltered card complete; source fingerprint validates cached odds. Current cardL51000–L51011, prior50000card index archived.
- Recordings are not present; speech pipeline still needs listening validation with actual phone/Audacity clips.

## Voice catalog revision
The current manifest supersedes the earlier alternate-wording catalog:18 fixed scripts,77 recommended vocal takes. Multiple takes use identical words. Engineering speech reports railgun/main-drive outages and restorations explicitly. Current frequencies are remeasured after removing generic component chatter. Tests cover extra takes beyond the recommended count and invariant subtitles.

## Live league foundation
Existing Vercel config serves viewer2 as static output with no build step. No package or Convex configuration exists. Current Rust CLI generates real matches; viewer uses full traces and local picks. Production needs server authority and must not disclose a future fight trace/winner before betting closes.

## Cloudflare migration discovery — 2026-10-01
- main tracks origin/main (GitHub mt-quinn/speedkills); scope file untracked at start.
- Vercel project hardburn is already linked. Build selects production/preview Convex endpoints; add explicit backend selection rather than replacing defaults.
- Existing simulator WASM artifact is available. Cloudflare CLI not installed; Vercel CLI available. Need verify provider authentication and Worker runtime before remote preview.
- Current auth uses Convex Password provider; hash compatibility and session migration require proof, not assumptions.
- Cloudflare authorization succeeded; user enabled Workers Paid and R2. Created isolated D1 hardburn-preview and private R2 hardburn-traces-preview; deployed private Simulator RPC service and protected API/coordinator scaffold.
- Deployed simulator parity passed three fixtures (128/400/customized 128 samples). Round trips 14.982s, 30.151s, 8.828s; WASM linear memory 7.6–14.1 MiB. These are not billed CPU or peak isolate measurements. Report saved in cloudflare/docs/compute-report.json.
- Better Auth 1.7.7 verifies Convex/Lucia scrypt hashes in Node and workerd, including NFKC normalization and wrong-password rejection. Actual exported credential inventory and full session/reset integration remain pending.
- Miniflare 5 changed its constructor API; use convertV4MiniflareOptions with the current runtime. Stable Miniflare 4 was too old for the compatibility date and introduced advisories, so it was removed.
- Better Auth optional frontend peers conflicted with the root Vite/Vitest graph. Isolated cloudflare/package.json installs without that conflict and audits clean. Existing root package versions did not change; two pre-existing moderate Vitest advisories remain.
