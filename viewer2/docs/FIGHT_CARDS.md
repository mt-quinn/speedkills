# Fight broadcast package

Implemented on `codex/drone-broadcast` alongside the drone cameras.

The ship strip groups identification, hull, pilot intent and crew condition, ammunition, rail charge/reload and PDC readiness. An ivory diamond identifies the viewer's locked bet consistently on the scoreboard, strip, ship brackets and off-screen bearing. The league shell sends the actual wager side when mounting the viewer; studio recordings accept `&pick=0` or `&pick=1` for visual review.

One tactical slot reports the incoming salvo, a defensive assignment, an exploitable opening, or ammunition pressure. System casualties and green restoration tags retain their own compact rows. Radio captions stay inside the strip rather than extending into unprotected space.

## Facts

- Salvos group offensive launches from the same ship within 1.2 seconds of the first launch. Totals include only launches that have happened. Counter-torpedoes are excluded through their recorded defensive-shot munition IDs.
- PDC interceptions count `torp_down`, independently of rail/counter-torpedo interceptions. Direct hits and torpedoes still flying are reported separately. Resolved counts remain visible for four seconds after the last result.
- Low reserves mean at most two rail rounds/two torpedoes, or at most six aggregate PDC firing seconds, or 15% of the initial reserve. Empty and disabled are distinct states. PDC seconds sum ammunition across working mounts; several firing mounts spend reserve simultaneously.
- A destroyed reactor removes weapon readiness while retaining displayed stored ammunition. Readiness and opportunities never use future hits or the winner.
- Openings identify depleted/disabled or cooling enemy PDC and a charged rail against a reloading opponent. Immediate danger takes precedence over an opening. The ammunition cells retain low/empty warnings even when the tactical slot reports a salvo.

## Placement

Desktop placement scores both strips together against projected ship silhouettes, incoming torpedoes, the engagement corridor and visible headline graphics. Ship and card collisions dominate proximity preferences; previous positions provide hysteresis. Interpolation is accepted only when it remains clear of ship silhouettes and the other target card. Camera cuts re-anchor immediately. Off-screen ships retain a strip and directional bearing. Phones dock both strips below the camera stage; short landscape uses narrower typography and strips.

Camera-lab trace exports include placement candidates selected, costs, obstruction flags, card rectangles and displayed facts, alongside actual render projections. The geometry sweep is repeatable:

```
node viewer2/tools/fight-card-audit.mjs viewer2/matches/camera-review/*.json
```

The four review recordings produced 2,990 sampled desktop/short-landscape camera views with zero ship obstructions and zero card overlaps in the geometry sweep. This uses declared card envelopes and camera geometry; browser review separately covers actual typography, phone docking, salvo results, reserve warnings and bet markers. It is not a guarantee for every possible viewport or future recording.

The Node suite includes six targeted tests for live-only salvo totals, interception attribution, defensive-launch exclusion, reserve states, reactor outages, tactical prerequisites and crossing/edge/off-screen placement.

Local review:

http://127.0.0.1:8095/broadcast.html?studio=1&file=camera-review/8000.json&t=12.7&paused=1&pick=0

Add `&cameraLab=1` for instrumentation. The fight simulation and economy are unchanged.
