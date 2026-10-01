# Pilot tactics

The live simulator uses `continuous-v2`. All three league doctrines use the same controller. Doctrine and persistent, identity-seeded temperament influence range, initiative, crossing geometry and ammunition discipline. The names displayed on the ship cards describe the resulting motion; they do not select mutually exclusive flight routines.

Movement, rail tracking, salvo timing and screen management run together. The spinal gun and main drive must choose a physically useful heading: averaging incompatible directions stranded ships at gun range. The controller now commits to a useful orientation with hysteresis while RCS and weapon decisions continue. A charged gun gets time to acquire a shot while existing inertial motion persists; charging no longer requires already aiming at the target. Pilots compare reload windows, relative velocity, predicted closest approach, available PDC arcs, screen heat, ammunition and the arrival of their own torpedoes. Crossing lanes retain some momentum while competing on the opponent's geometry. An empty rail magazine changes the desired position to a useful missile launch range; a stale fight progressively closes toward a decisive engagement.

Trailing pilots release reserve missiles sooner, accept lower rail shot probabilities, and can hold a charged gun briefly to combine its shot with an arriving salvo. Overcharge requires both a disadvantage and a credible attack opportunity. Pilots can roll working PDCs toward a threat without giving up the spinal gun's aim.

## Engagement geometry

- **Knife** pursues roughly 1.1–1.4 km engagements, cuts across a withdrawing target's predicted path, and uses close lateral movement rather than stopping at the common gun range.
- **Counter** sustains a broad moving firing position with centripetal thrust, then contracts range when behind or running out of time. An approaching opponent can justify an earlier rail shot and missile launch.
- **Reference** carries an existing fast approach through a crossing rather than braking at its preferred range. An extension depends on separation, relative motion, threats and weapon readiness; it is not a mandatory flyby cycle.

Quiet geometry increases the value of changing velocity. Real incoming shots retain priority for hard evasion, but merely having an enemy gun ready no longer repeatedly spoils the pilot's own firing solution. Empty rail magazines lead to missile launch range; missile-only ships launch before closing further. PDC reserves are retained against missile threats rather than indefinitely denying useful close fire.

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

## Release measurements — continuous-v2

The unfiltered release sample contains 1,200 fights: 200 seeds for each of the six doctrine pairings. All six unchanged spectacle gates pass. Median duration is 74 seconds, p95 153 seconds, with no unfinished fights and 9% ending before 40 seconds. Overall doctrine win rates are Counter 53%, Knife 56%, Reference 41%; no doctrine beats both alternatives above 55%. Reference remains weaker in these matchups, so this is not a claim of perfect balance.

Lead reversals occur in 52% of fights and the winner was behind in 54%. Finish causes are railgun 39%, PDC 26%, torpedo 16%, ram 14%, mutual ram 6%. Median meaningful hits are 12. Dangerous burns or gee deaths occur in 18% of fights. Median rail shot ranges are Knife 1.3 km and Counter/Reference 2.8/2.9 km.

New diagnostics measure actual stationary exchange time, longest stationary stretch, fast passes and spatial reentries. Run `python3 python/duel/geometry.py` after the spectacle batch. Stationary means range 1.2–5 km, closing speed below 40 m/s and line-of-sight rotation below 0.04 rad/s. These are geometric proxies, not a complete measure of viewer excitement.

In the matched 600-fight comparison against the published continuous-v1 model (same pairings and seeds 5000–5099), stationary time falls from 52.9 to 13.7 seconds per fight; its share of total combat time falls from 38.0% to 15.0%. The median longest stationary stretch falls from 18.2 to 3.3 seconds. Passes decrease from 1.48 to 1.13 per fight: the improvement is not simply more flybys. The full release sample has 1.07 passes and 0.10 reentries per fight; Reference mirrors cross more often, while Knife mirrors largely stay close.

The 27 ordinary Rust tests cover the inherited physical combat checks plus charging during maneuver, transverse velocity, doctrine range separation and missile-only ammunition use. The 33 JavaScript tests also include the tactic-change voice hotfix. TypeScript, web and WebAssembly builds are checked before release. Native and WebAssembly recordings are compared for deterministic finish agreement. `npm run test:backend` currently discovers Node test files with Vitest and reports no Vitest suites; it is not a successful backend suite.
