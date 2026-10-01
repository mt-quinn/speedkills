# Progress

2026-09-30: Started approved implementation. Reviewed frame data, HUD, replay, pilot and existing league generation. Plan and findings recorded before edits.
- Added broadcast.js, voices.js, history.js; integrated current-state tactics, crew portraits/consequences, truthful result scoreboard, decisive replay, optional voice audio and local history.
- Added six meaningful Node tests: conscious speakers, PDC availability, radio spacing/variation, g/dry warnings, replay bounds/explanation, deduplicated history/picks. All pass.
- Rust tests13 pass; Counter spectacle1200 fights passesG1–G6. First candidate logged then refined to create measurable holding-range behaviour.
- Browser checked defeated ship OUT, winner override, factual torpedo explanation and decisive replay returns to result. A button locator used uppercase CSS rendering instead of source name; corrected locator, no app error.
- League400×45 odds rebuild is in progress; recording manifest will be remeasured on refreshed card.

- Finished18,000-fight league odds build, then verified cached-odds fresh-card authoring with12 unique unfiltered L51000–L51011 fights. Sources fingerprinted; previous card index archived.
- Final voice manifest measured22.8 match minutes and recommends72 clips across16 cues. Optional registration tool verified with empty pack. Actual recorded-voice listening validation awaits user recordings.
- Desktop camera margin resolves previous framing failure: all audit criteria12/12. Phone390×844 passes all except frame-fill11/12; one fight tiny3.1% of runtime. More aggressive zoom candidates rejected and limitation documented.
- Phone prematch has no horizontal overflow, all pick/watch controls reachable. Verified pick1–0 settlement, winner override, dead crew state and short replay returning to result. No console errors observed.
- AddedREADME navigation to current viewer and recording manifest; implementation/validation details in viewer2/docs/BROADCAST_IMPROVEMENTS.md. Eight pure Node tests pass, JavaScript parses, diff whitespace clean.

## Voice script revision
- User prefers vocal performances of the same words over alternate wording. Replaced synonym lists with18 fixed, concise scripts; engineering calls explicitly name railgun/main-drive status and minor component chatter is omitted.
- Remeasured current12-fight card:77 recommended takes total, with3/4/6/8 takes per script based on emitted frequency. Manifest uses cue_take_01.wav filenames and gives delivery notes.
- Player rotates loaded vocal takes with identical subtitles, including partial packs and extra numbered takes. Registration accepts new take filenames. Ten broadcast tests pass, including fixed-script rotation and manifest consistency; diff whitespace clean.

## Live league implementation
- Built exact Rust sim WebAssembly ABI and backend wrapper, candidate/economy rules, Convex schema and scheduled global cycle, wagers/ledger, ownership/tryouts/renaming, archive and optional chat.
- CLI login initially lacked supplied project access. User logged in; development functions deployed successfully to resolute-crocodile-221 and league initialized. Production untouched.
- New hangar/betting/chat shell implemented, Vercel static build now bundles Convex client. Typecheck, syntax checks and15 Node tests pass. Browser verification underway.

### Broadcast terminology and test fixtures
- Unified the hangar CTA, navigation, waiting screen and chat under “Live broadcast”; removed competing arena destination labels.
- Kept phase-specific actions (Watch & bet, Watch live, View result) under the same broadcast destination.
- Marked verification-owned ships as testing on the development backend and excluded them from preparation and promotion. Already opened matches remain locked.
- Verified the updated hangar labels and primary Watch live CTA against the development cloud in the browser.
- There is no separate firing-range mode implemented; the previously visible Cloud Test Ship was verification data in the league.

### Owner panel overhaul
- Replaced the oversized earnings-only summary with a compact league status console: waiting/live status, opponent and broadcast link, career figures, recent completed results, hull at finish and payouts.
- Added completed ship activity and a dedicated last-owner-payment lookup to the cloud home query. No queued or live outcomes are exposed.
- Added lifetime/average income, sponsorship earned-back progress and a plain payout explanation with a worked example; explicitly identifies simulated spectator betting in the prototype.
- Kept transaction history and paid rename as secondary actions. Crew reset after each fight is explained next to combat history.
- Development Convex deploy succeeded; browser confirmed the actual Lantern loss and expanded payout rules.

### Persistent queue, sponsored priority and whole credits
- Added saved future pairings to the channel. Random pairing happens when booking rotations, not when a booked fight opens. Active matches retain their locked crews/odds.
- Owner panel shows next opponent and “Up next” / “In N fights,” including next appearance during the owner's current match.
- Sponsored matchups precede background-only matches. Existing sponsored bookings retain relative order; unannounced background slots can be replaced to book new or returning sponsored ships.
- Crew/name changes invalidate prepared simulation data while retaining the booked pairing. Simulation stage checks the current queue head and ship revision before publishing.
- Monetary values use whole credits: stake validation rejects fractional credits, winnings and owner shares round at source, and all existing balances/wagers/ledger/earnings/crowd amounts were rounded with an idempotent cloud migration. Legacy storage scale remains 100 units per credit with no non-multiple-of-100 money values.
- Cloud credit audit found zero fractional values across players, ships, wagers, ledger and fights. Cloud queue audit after a live transition confirmed sponsored priority and prepared matchup matching queue head. Browser verified live ship status, next appearance and whole-credit balance/income.

### Production release
- New accounts start with 500 cr. Spectator wagers are capped server-side at 100 cr; ownership removes the cap. The input uses the same maximum.
- Zero balances receive an automatic 50 cr stipend after unsettled wagers are resolved, at most once per hour. Settlement, reconnect and the minute watchdog check eligibility.
- Development cloud economy verification passed cap boundaries, owner exemption, unsettled-bet protection, first refill and hourly interval.
- Convex production functions/schema deployed successfully. Updated Vercel project from direct viewer2 hosting to the root build and configured the production Convex URL.

### Chat name save feedback
- Fixed live-combat rendering leaving the chat profile summary stale after a successful name save.
- Added saving/saved feedback, preserved the open profile form through updates, and cleared the saved indicator when editing again.
- Verified against the cloud development backend using an isolated localhost browser account during combat; the updated name appeared immediately and persisted after reload. No chat messages were sent.

### Betting-to-broadcast transition
- Preserve the current match's iframe during cloud updates, including while it is still joining. Previously updates could detach the iframe while a load promise was pending and leave the mount permanently blocked.
- Added an origin/source-checked readiness and mounted acknowledgement protocol. The parent no longer treats the initial about:blank document as viewer readiness or hides loading before the renderer starts.
- Mount attempts are tied to their iframe and fight, discarded after navigation/phase changes, and safely retried. Duplicate mount requests acknowledge without rebuilding the renderer.
- Removed both unplaced-draft expiry notifications; stale draft selections clear silently.
- End-to-end transition verification exposed a second cause: the time-gated trace query had cached null during betting and had no database write at combat start to invalidate it. Added an idempotent scheduled start mutation (with watchdog recovery) that updates the current fight and refreshes trace/home subscriptions at startsAt.
- Deployed the start event to development and production and scheduled it for existing current matches.
- Verified cloud match 27 with a locked one-credit test wager in an isolated account: betting changed to the live renderer without reload, loading was hidden only after mount acknowledgement, and no expiry notice appeared.

## 2026-09-30 — Audio activation and balance-based wager limits
- Persistent capture listeners retry audio on pointer, touch, keyboard, form, focus and scroll interactions, plus focus/visibility recovery. Suspended/interrupted contexts also attempt immediate recovery.
- One parent-owned Web Audio context survives the hangar, betting and per-fight viewer frames. Trusted shell gestures resume it synchronously; frame initialization is guarded while assets load. Removed viewers stop/disconnect their sources without discarding the unlocked context.
- Live sound status requires loaded sources and a running context. The broadcast sound control reports actual playback; explicit mute persists across fights and ordinary interactions.
- Wager caps now apply to all players based on available balance: <1,000 cr = 100; 1,000–1,999 cr = 250; >=2,000 cr = 500, bounded by available funds. Server validation and UI use the same cap.
- Validation: 19 unit checks passed, TypeScript passed, development economy check confirmed all tiers and stipend rules. Cloud-connected UI confirmed sound activation from a hangar navigation gesture, mute persistence after chat toggle, and successful unmute. Convex development and production deployed.

## 2026-09-30 — Hold the final combat view before results
- Added a shared four-second finish hold to the live match schedule. The existing viewer continues rendering the final state and effects before the results screen replaces it.
- Results still receive their full 15 seconds; settlement and the next match follow the same server schedule for every viewer. Already scheduled matches retain their original timing; newly opened fights use the hold.
