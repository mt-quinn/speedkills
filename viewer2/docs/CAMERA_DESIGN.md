# Drone sports broadcast

Implemented on `codex/drone-broadcast`. The drones observe the recorded fight. They never affect simulation, odds, the global clock or settlements.

## Flight and operation

Five persistent cameras live in world coordinates: elevated overview, low ringside, forward-quarter tracking for each ship, and a high-angle reserve. Each has velocity and acceleration, finite body turning, a separate stabilized camera mount with angular velocity/acceleration limits, optical zoom and focus travel. Floating-origin rendering cannot move the drones. No positional teleportation occurs after initialization.

The operator leads movement and prepares shots off-air. Tracking cameras position themselves toward the incoming corridor before a launch. Focus starts on the ship, acquires the approaching torpedo after a short recognition delay, and returns to the ship when the threat resolves. Salvo targets remain stable while that torpedo exists. Focus uses optical-axis depth rather than slant distance.

The flight ceiling is 620m/s² (~63g), speed 3400m/s, body turn 110°/s; stabilized pan 95°/s with 240°/s² angular acceleration. Zoom is bounded to 11° FOV/s, tightening at half that speed. Focus has a 160ms recognition delay and finite logarithmic travel. These are initial tuned sports-camera limits, centralized in `CAMERA_DEFAULTS`.

## Editing

The director scores prepared coverage against present subjects and readable ship separation. Both ships receive coverage during gun exchanges and simultaneous incoming threats. Recently fired rails retain coverage through flight. The recorded schedule of weapon firing provides a 2.2s preparation horizon; future hits, damage, deaths and winners are never used to select shots. Approaching/closing, separation, hard burns, defense and actual coverage failures motivate cuts. There is no fixed camera rotation timer.

Ordinary shots hold at least 7 seconds. A normal edit requires an explicit present-action reason, a quality advantage of at least 18 points maintained for 0.65 seconds, and either 30° of actual viewpoint change around the fight or a 1.7× change in projected subject size. Different rig names alone do not qualify. There is no timer- or phase-change fallback. A prepared defense shot can enter after 3.5 seconds, subject to the same contrast, quality and sustained-proposal requirements. Genuine framing failures can recover immediately, including to a similar angle. Emergency recovery still prefers the ready high-angle reserve. Defense holds persist through predicted resolution.

The on-air lens holds its composition. It widens to protect an edge, and tightens gently only after a loose composition persists 3.5s. Ships have a fixed enhancement scale per rig, a small minimum readability floor and a maximum screen-size cap. They change apparent size with perspective. The reference grid uses fixed 500m spacing.

Manual camera input keeps the current drone view and disables depth of field. Returning to the director eases over 700ms. Ordinary cuts remain hard cuts. Ship cards immediately re-anchor at a cut; off-screen ships retain a named bearing and separation, plus their scoreboard status.

## Lens rendering

Overview and reserve have deep focus. Ringside and tight tracking use restrained, depth-based optical blur. A half-resolution intermediate pass and a final full-resolution pass use the scene's depth textures, preserve sharp foreground edges and spread defocused foreground subjects into neighbouring pixels. Blur is bounded to 9 CSS pixels and respects device pixel ratio. Torpedo cores/rings, rail rounds and engine plumes supply depth. Bloom precedes the lens, so emissive highlights belong to the shot. Focused pixels come from the original full-resolution image; the intermediate target only supplies blur. HTML text and controls remain sharp. Render targets and pass resources are disposed with the scene.

## Production-room instrumentation

Open `broadcast.html?studio=1&file=recording.json&cameraLab=1`. The lab supports:

- Plan-view positions and assignments of all five drones, plus optical depth/focus monitor.
- Shot timeline, clickable seeking, previous/next cuts, explicit time entry, play/pause and individual camera monitoring.
- Every candidate's score, readiness, visual contrast and editorial rejection reasons; every cut's trigger, previous duration, score gain, outgoing framing failure and angle/scale contrast. Pending proposals include their stability timer.
- Position, velocity, acceleration vector and limiting, body direction/error, gimbal quaternion/rate/error, job position/error, lens FOV and focus target/acquisition error.
- Actual render FPS, CPU submission time, total compositor draw calls, subject projections and HUD rectangles.
- Focus pulls, coverage, safety cuts, camera usage, focus errors and all decision traces.
- Live operator tuning, depth-of-field switch, JSON export, full-fight numerical audit and 30fps WebM recording of an entire rendered fight.

Numerical telemetry is sampled at 5Hz. Live render samples are bounded to 12000. Ordinary playback retains only counters and its small cut log; it does not accumulate diagnostic traces. Simulation steps are fixed at 30Hz, independently of display rate. Seeking, late joining and different refresh rates produce the same physical drones and edit.

## Reproducible validation

`npm test` includes independent flight/turn/zoom/focus limit checks, refresh-rate/seek determinism, prepared-shot selection, optics and diagnostic-memory behavior.

`node viewer 2/tools/camera-audit.mjs [--portrait] [--trace PATH] recording.json ...` exports a detailed per-recording audit.

`node viewer 2/tools/camera-suite.mjs /tmp/camera-report.json [SEED_BASE] [REPEATS]` generates all 45 actual roster pairings with seeds 8100–8144 by default and audits desktop and portrait:90 full recordings. Recordings are temporary and removed afterwards. The suite measures required-subject coverage, coverage of both ships in pair shots, event/impact visibility, optical sharpness, abbreviated shots and cut rate. Gates:97% required coverage,98% pair coverage,95% impact visibility, ≤ 18 cuts/minute and ≤ 2 abbreviated (<2s) shots/minute.

Final results and rendered-review observations are recorded in `CAMERA_REVIEW.md`. Numerical gates constrain failure modes; they do not prove subjective excitement.

`npm run camera:demo` generates four local review recordings under the ignored `matches/camera-review/` directory and prints camera-lab links. Native `target/release/league` must already be built.
