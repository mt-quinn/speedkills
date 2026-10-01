# Pilot tactics

The live simulator uses `continuous-v1`. All three league doctrines use the same controller. Doctrine and persistent, identity-seeded temperament influence range, initiative, crossing geometry and ammunition discipline. The names displayed on the ship cards describe the resulting motion; they do not select mutually exclusive flight routines.

Movement, rail tracking, salvo timing and screen management run together. Pilots compare reload windows, relative velocity, predicted closest approach, available PDC arcs, screen heat, ammunition and the arrival of their own torpedoes. Crossing lanes retain some momentum while competing on the opponent's geometry. An empty rail magazine changes the desired position to a useful missile launch range; a stale fight progressively closes toward a decisive engagement.

Trailing pilots release reserve missiles sooner, accept lower rail shot probabilities, and can hold a charged gun briefly to combine its shot with an arriving salvo. Overcharge requires both a disadvantage and a credible attack opportunity. Pilots can roll working PDCs toward a threat without giving up the spinal gun's aim.

## Hard evasive burns

Enemy gun readiness and tracking create advance pressure to change course. After a muzzle flash reaches the pilot, a rail round's relative trajectory is checked against the ship's predicted position. A probable hit can trigger a short 10–20 g burn even with a healthy hull. Its direction creates transverse acceleration without requiring an immediate ninety-degree turn, and its requested acceleration scales with the displacement needed before closest approach. The commitment ends just after the round passes. Clear misses do not trigger this emergency response.

Routine burns still budget crew risk. An imminent hit can justify exceeding that routine budget: the existing resistance model continues to roll blackout and death hazards, with no immunity or accuracy bonus. Main drive direction, rotation limits and RCS authority remain physical constraints, so some shots arrive too late to evade.

## Emergency interceptions

Pilots may divert an already charging railgun or sacrifice one torpedo when a ship-bound missile threatens to get through the screen. Threat severity, PDC coverage and reserve, turning time, arming time and remaining interception time compete with the offensive shot being surrendered.

- A rail round must physically intersect a hostile torpedo's two-metre body. Scatter and ordinary flight apply. The closest collision wins, so a ship in front of the missile absorbs the shot first.
- A counter-torpedo guides onto a designated hostile missile with the ordinary acceleration, guidance lag, delta-v limit, proximity fuse and one-second arming delay. If its target disappears, it coasts; it does not get a free offensive retarget.
- Both use real magazine ammunition. A missile breakup still creates moving debris. An interceptor already assigned to a threat prevents duplicate defensive launches; a rail shot already en route gets time to arrive before spending another munition.

The broadcast labels counter-torpedoes separately from incoming attack salvos, shows defensive firing and successful interception calls on the ship card, and includes these interceptions in result statistics. Two optional gunner recordings are listed in `VOICE_RECORDING_MANIFEST.md`.

## Instrumentation and verification

Traces carry the pilot model and four concurrent intent weights: attack, evasion, torpedo pressure and recovery. Diagnostics count defensive rail and missile shots, successful interceptions by weapon, and time with multiple significant intentions. `Pilot.adaptive = false` retains the previous controller for diagnostic comparisons; live pilots default to the new controller.

Run `cargo test -p sk-duel --release` for physical interception, arming, collision ordering, deterministic controls and healthy-ship hard evasion checks. The existing spectacle batch remains `GATE_N=200 cargo test -p sk-duel --release spectacle_round_robin -- --ignored`, scored by `python3 python/duel/spectacle.py`. Its thresholds are unchanged.

The WebAssembly engine is rebuilt with `npm run build:sim`. Odds use a new cache version. `game:refreshSimulation` discards only unpublished prepared recordings and schedules their replacements; announced fights keep their original odds, recording and bets.

## Release measurements

The final unfiltered sample contains 2,400 fights: 400 seeds for each of the six doctrine pairings. All six existing spectacle gates pass. Median duration is 144 seconds, p95 191 seconds, with no unfinished fights and 3% ending before 40 seconds. Overall doctrine win rates are Counter 49%, Knife 50%, Reference 50%; no doctrine beats both alternatives above 55%.

Lead reversals occur in 51% of fights and the winner was behind in 53%. Finish causes are railgun 34%, PDC 28%, ram 16%, torpedo 14%, mutual ram 6%. Median meaningful hits are 13. Dangerous burns or gee deaths occur in 18% of fights.

The original 1,200-fight comparison has more lead reversals than this pass. This remains a tradeoff to watch when judging the broadcast: the new controller passes the existing reversal floor, but does not improve that metric over the previous controller. The first 1,200 seeds of the final controller had 595 reversals (49.6%); the expanded sample is reported rather than hiding that borderline result.

The 23 ordinary Rust tests and 32 JavaScript tests pass, as do TypeScript checking, the web build and the WebAssembly build. A generated WebAssembly fight was checked for agreement between the recorded finish and settlement summary. The simple negative controls (dump all missiles, flee, sit still, or charge using only the gun) lose to the new controller in the 30-seed sanity sample. `npm run test:backend` currently discovers Node test files with Vitest and reports no Vitest suites; it is not a successful backend suite.
