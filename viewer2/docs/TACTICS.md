# Pilot tactics

The live simulator uses `continuous-v3`. All three league doctrines use the same controller. Doctrine and persistent, identity-seeded temperament influence range, initiative, crossing geometry and ammunition discipline. The names displayed on the ship cards describe the resulting motion; they do not select mutually exclusive flight routines.

Movement, rail tracking, salvo timing and screen management run together. The spinal gun and main drive must choose a physically useful heading: averaging incompatible directions stranded ships at gun range. The controller now commits to a useful orientation with hysteresis while RCS and weapon decisions continue. A charged gun gets time to acquire a shot while existing inertial motion persists; charging no longer requires already aiming at the target. Pilots compare reload windows, relative velocity, predicted closest approach, available PDC arcs, screen heat, ammunition and the arrival of their own torpedoes. Crossing lanes retain some momentum while competing on the opponent's geometry. An empty rail magazine changes the desired position to a useful missile launch range; a stale fight progressively closes toward a decisive engagement.

Trailing pilots release reserve missiles sooner, accept lower rail shot probabilities, and can hold a charged gun briefly to combine its shot with an arriving salvo. Overcharge requires both a disadvantage and a credible attack opportunity. Pilots can roll working PDCs toward a threat without giving up the spinal gun's aim.

## Engagement geometry

The controller requests relative velocity rather than restoring a preferred distance. Closing requests depend on charge/reload readiness, enemy readiness and facing, missile pressure, health disadvantage, existing momentum and separation. Curvature thrust is accounted for before changing radial velocity: otherwise lateral motion creates an accidental equilibrium orbit.

- **Knife** pursues close crossings and cuts off a withdrawing target. It uses tighter lateral offsets, can launch during a close approach, and carries speed through a safe merge instead of stopping at 1.1 km.
- **Counter** closes for an opportunity and changes separation more strongly while recovering. It uses wider offsets and more cautious shot selection, but no longer continually maintains one firing radius.
- **Reference** combines stronger crossing movement with pursuit and attack pressure. Existing velocity, enemy facing, weapon availability and threats determine its next approach.

A charged gun gets an aiming window near readiness rather than owning the nose through most of its charge. Brief shot stabilization preserves inertial velocity; RCS resumes during a prolonged hold. Collision avoidance overrides ordinary aiming. Neither passing through an opponent nor reaching point-blank range mandates a timed retreat/return cycle.

Missile-only ships still try to create launch separation, but can spend a last torpedo on a close-range attempt rather than become permanently trapped against an empty-magazine pursuer. Fuse arming still applies: the attempt can fail. Exhausted ships retain the physical ramming fallback.

## Hard evasive burns

Enemy gun readiness and tracking create advance pressure to change course. After a muzzle flash reaches the pilot, a rail round's relative trajectory is checked against the ship's predicted position. A probable hit can trigger a short 10–20 g burn even with a healthy hull, provided the available thrust and turning time can plausibly clear the hull before impact. A point-blank round that arrives too soon no longer causes an impossible high-g dodge. Its direction creates transverse acceleration without requiring an immediate ninety-degree turn, and its requested acceleration scales with the displacement needed before closest approach. The commitment ends just after the round passes. Clear misses do not trigger this emergency response.

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

## Release measurements — continuous-v3

The release sample is 1,200 unfiltered fights, 200 seeds per doctrine pairing. All six existing spectacle gates pass: median 91 seconds, p95 155 seconds, 5% under 40 seconds, no unfinished fights; Counter/Knife/Reference win rates 53%/48%/50%; lead reversals 52%, winner previously behind 51%; median 12 meaningful hits; dangerous burns or gee deaths in 10% of fights. Finish causes are railgun 32%, torpedo 31%, ram 14%, PDC 14%, mutual ram 9%. No physics damage, accuracy or crew hazard rates were changed.

The earlier stationary metric missed slowly changing orbits and excluded all ranges below 1.2 km. It is retained as an observation, not accepted as proof of lively fights. New `range_history` diagnostics sample actual range and radial velocity each second. `python/duel/engagements.py --check` measures substantial reversals after first contact and prolonged range holds at every distance, including point blank.

An excursion requires 700 metres from an extremum; small dodges do not count. A held window spans 20 seconds with less than 500 metres of total range change. The check requires frequent close contact and substantial reversals, bounds range holds globally and per pairing, checks Knife mirrors separately, and rejects unfinished fights. These proxies catch the reported failure but cannot decide whether a broadcast is enjoyable.

Matched 600-fight comparison against the released continuous-v2 (same six pairings, seeds 5000–5099): held windows decrease 40% → 9%; fights with 2+ excursions after contact increase 56% → 98%. Knife mirrors decrease 64% → 1% held windows and increase 1% → 100% for 2+ excursions. Every new Knife mirror reaches below 1 km. The full 1,200-fight sample reaches below 1 km in 91% of fights and has 2+ excursions in 98%. Counter mirrors retain more tactical pauses (27% held windows), versus 1% for Knife mirrors.

A separate persistent-roster test uses all 45 pairings, actual crew stats, persistent pilot identities, 20 seeds per pairing with sides alternated: 900 unfiltered fights. It passes the motion checks: 96% below 1 km, 99% with 2+ excursions, 6% held windows; Knife mirrors have 100% close contact and reversals, with no held windows after rounding.

Reproduce with:

```sh
GATE_N=200 cargo test -p sk-duel --release spectacle_round_robin -- --ignored
python3 python/duel/spectacle.py
python3 python/duel/engagements.py --check
GATE_N=20 cargo test -p sk-duel --release league_engagements -- --ignored
python3 python/duel/engagements.py runs/duel/league-engagements.jsonl --check
```

28 ordinary Rust tests and 33 JavaScript tests pass. The new regression requires Knife mirrors to close, reopen past 1.8 km, and reengage below 1 km. Native and WebAssembly persistent Knife/Knife and Counter/Counter recordings agree exactly at seed 8000. TypeScript and web/WASM builds pass. Odds cache version is `wasm-tactics-v5`; announced recordings and bets remain unchanged when future fights are refreshed.
