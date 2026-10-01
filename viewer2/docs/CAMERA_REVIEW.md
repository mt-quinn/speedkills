# Camera review

Implementation branch: `codex/drone-broadcast`.

## What to review

Run `npm run camera:demo` with the native `target/release/league` binary available. Four current-model recordings are generated locally; the command prints links. With the viewer served on port 8095, start here:

http://127.0.0.1:8095/broadcast.html?studio=1&file=camera-review/8000.json&cameraLab=1&t=0.1&paused=1

Collapse CAMERA CONTROL for the broadcast. Expand it to monitor a drone, inspect focus depth, tune its limits, audit the full fight or export a trace. Record full fight starts from zero; the resulting WebM has an explicit Download recording link. Recording contains the rendered simulation; DOM scoreboard and control-room overlays are excluded.

## Numerical review

The saved `camera-review-results.json` contains all 180 full-fight audits: every one of the 45 roster pairings, two independent seed sets (8100–8144 and 9000–9044), each in desktop and portrait framing.

| Measure | Result |
|---|---:|
| Audits passing all gates | 180 / 180 |
| Mean required-subject coverage | 99.997% |
| Mean key-event visibility | 99.988% |
| Minimum impact visibility | 100% |
| Maximum cut rate | 10.953 / minute |

Gates require 97% required coverage, 98% pair-shot coverage, 95% impact visibility, at most 18 cuts/minute and at most two shots shorter than two seconds per minute. Focus sharpness, emergency cuts and individual camera usage are also reported. Future impact locations are used to audit visibility, never to select shots.

The unit suite separately checks physical acceleration, speed, body turning, vector gimbal acceleration, pan speed, zoom and focus travel; deterministic replay at different frame rates, late joins and rewinds; prepared shots; bounded optics; and bounded diagnostic memory. The complete Node suite passes 38 tests.

## Rendered review and resulting corrections

Reviewed complete playback and samples of mixed doctrines and mirrors, alongside desktop and phone layouts. Corrections made during review include stable on-air lenses, slow coverage-hemisphere movement, retaining both ships during simultaneous exchanges, a prepared high-angle emergency fallback, foreground blur dilation, full-resolution focused detail, and HUD re-anchoring at cuts. Manual dragging into the control panel now releases the pointer correctly and returns to the director.

Distinct views establish geography, show low-angle crossings, follow one ship during a readable interval, and return to wide coverage for simultaneous action. Off-air cameras prepare rather than teleport into place. Focus switches between the tracked ship and an incoming torpedo, with finite acquisition and travel. Overview and reserve shots stay in deep focus.

Observed rendering without shader or console errors on the local browser. Blur uses a half-resolution intermediate while focused detail retains full resolution. Render telemetry exposes frame rate, CPU submission time and total composer draw calls; it is not GPU timing or a claim of performance across a hardware matrix.

## Scope and practical limits

Observer drones have physical flight limits but are not combat entities. Blur is art-directed for this game's enhanced ship silhouettes and kilometre-scale engagements, capped at nine CSS pixels rather than claiming literal lens optics. Unsupported depth textures disable optical blur. The editor anticipates recorded weapon firing by 2.2 seconds; it does not anticipate damage or winners. The global live clock and fight simulation are unchanged.

Coverage gates prevent identifiable broadcast failures. Subjective pacing, depth and camera character still need a human viewing judgment; the lab and saved review fixtures make that judgment repeatable.
