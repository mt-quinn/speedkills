# Gee resistance and incidents

Crew have an integer **gee resistance** score from 1 to 10. It reduces the probability of an incident; it is not a guaranteed burn duration. Names, skills, paid candidates and ship ownership persist through the conversion.

| Felt acceleration | Resistance 1 | Resistance 5 | Resistance 10 |
| --- | ---: | ---: | ---: |
| Below 7 g | 0% | 0% | 0% |
| 7 g | 1% | 0.5% | 0.2% |
| 10 g | 2.5% | 1.25% | 0.5% |
| 14 g | 5% | 2.5% | 1% |

These are per-person probabilities over one second. Acceleration and resistance interpolate between anchors. Above 14 g the acceleration slope continues, capped at a 10% base probability (20% at resistance 1). All high-g probabilities remain nonzero at resistance 10.

The simulator converts each one-second probability to a continuous hazard: `1 - (1 - p)^dt`. There is no exposure grace period, accumulated injury dose, or guaranteed immunity. RNG comes from the fight seed, making fights reproducible and allowing the odds simulator to use the same rules.

An incident is 98% blackout and 2% death. A blackout suspends station effectiveness for a uniformly sampled 4–8 seconds, then the crew member returns to work. Further nonfatal incidents while unconscious do not restart that timer; a fatal incident can still occur. Gee does not gradually remove health. Ship and crew restore after each fight as before.

Routine pilot maneuvers budget a 1.5% per-person incident chance across their planned burn, with RCS included in felt acceleration. Desperation maneuvers can exceed that budget. This limits routine exposure without guaranteeing safety. Existing handling/scatter effects retain a small resistance-dependent coefficient.

Existing threshold multipliers convert by `round(1 + (tolerance - 0.88) * 9 / 0.27)`, clamped to 1–10. Migration preserves existing names and skills, updates paid candidates, and regenerates unannounced queued matches. The already announced match retains its original recording and locked odds.

Odds caches use `wasm-gee-v2`; the old precomputed matrix is not used. New baseline matchups receive 400 simulations and sponsored matchups 128, as before. Current traces mark `params.g_model = random-v1`; crew state tuples contain `[state, health, blackout seconds remaining]`.

## Tuning check

Run `node tools/verify-gee.mjs` to reproduce the 500-fight batch against the committed WASM engine (seeds 880000–880499, mixed baseline pairings). The tuned run recorded:

- 121 fights with at least one blackout: **24.2%**.
- 159 blackout events across those fights.
- Four fights with a gee death: **0.8%**; four deaths total.
- Mean combat duration: **102.2 seconds**.

These frequencies describe this batch, not a guarantee for every crew composition. The per-incident fatal outcome remains 2%.

The pilot warning script is now **“High-g burn.”**, triggered on crossing 7 g and rearmed below 6 g. It reports acceleration rather than claiming to predict a random blackout.
