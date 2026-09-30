# Broadcast viewer (viewer2/) — iteration log

## Pipeline
- `cargo run -p sk-duel --release --bin record -- --card 12 --pool 900 --out-dir viewer2/matches`
  simulates a pool of mirror matches (standard hull, the three doctrines). It scores each one's broadcast value from its diagnostics, picks a varied card, and records 30 Hz traces plus every event, with the fight summary embedded.
- `python3 viewer2/serve.py 8095` serves the viewer and accepts frame captures (POST `/capture`), which land in `runs/viewer/captures/`.
- Viewer URL parameters:
  - `?match=N` — pick a fight
  - `&t=` — start at a time
  - `&paused=1`
  - `&critic=1` — live critic panel
  - `&audit=1` — one fight, headless
  - `?auditall=1` — the whole card
  - `&story=1` — storyboard captures of the key moments; `&at=t1,t2` for specific times
- Keys: space pause · ← → seek · [ ] speed · n / p next or previous fight · c critic.

## Watchability gate (the critic, `viewer2/js/critic.js`)

| # | Criterion | Pass |
|---|---|---|
| V1 | Framing | both ships in the safe area in ≥98% of frames; looking along the ships' line *while they're stacked on screen* in ≤1% |
| V2 | Events seen | ≥95% of key events on screen when they happen |
| V3 | Smooth camera | no jerks; 99th-percentile pan ≤20°/s; peak ≤45°/s |
| V4 | Depth | ships closer than 6% of screen height in <2% of frames; tag overlap <1% |
| V5 | Text | ≤2 callouts at once; none shorter than 1.5 s (the result may clear the board) |
| V6 | Slow-mo | ≤12% of watching time; ≤3 per minute |
| V8 | Frame rate | ≥50 at the 5th percentile. The audit can't measure this; frame cost is measured directly. |
| V9 | Fills the frame | ships more than 400 m apart span ≥15% of screen width in ≥98% of frames |

The storyboard review uses these questions: can a viewer tell who is where in depth, what's about to happen, what just happened, and who's winning?

## Iterations (2026-09-29)
- **First frames.**
  - NaN camera: the recorder writes nested arrays, and the parser expected a flat list.
  - White screen: pooled line materials kept the default 1×1 resolution, so a 3 px line was three screens wide. Every line now shares one resolution vector.
  - Blank 3D in captures: html2canvas painted the page background over the WebGL frame.
- **Storyboard review 1** (realistic glare).
  - Ships were thin, illegible lozenges; plumes and flashes were huge bloomed glows.
  - Railgun charge lines ran 7 km off-screen.
  - Callouts were ambiguous ("SABLE · RAILGUN HIT", with Sable the victim).
  - The grid papered the screen.
- **User note: stylised legibility over realism.**
  - Ships became solid team-coloured dart icons that shrink so they never overlap.
  - Bloom cut from 0.85 to 0.35.
  - Hits became crisp rings with burst marks.
  - Plume length now shows g, and turns threat red above 11 g.
  - Charge lines end just past the target.
  - Torpedoes became chevrons with a pulsing threat ring near the target.
  - The confusing velocity lines were removed.
  - The grid became adaptive and fades with distance.
  - Callouts name the attacker first.
- **Audit 1.**
  - V5 fail: 14.5 callouts a minute, some shown for 0 s. Now hits are shown by the ring in the scene, text covers only consequences (part out, crew killed, blackout, overcharge burn), plus a "takes the lead" beat. Routine news only appears when nothing else is fresh; a young callout is never bumped; high-priority callouts wait for a slot.
  - V6 fail: 18% slow-mo, because the budget counted fight seconds, not watching time. Now watching time, with shorter windows.
- **Audit 2.**
  - V3: merges made the camera chase the ships' line round the fight at ~25°/s for 3 s. Now azimuth is capped at 12°/s, with an elevation lift so height separates the ships during a pass.
  - A lift that read the camera's own view fed back and oscillated; it now uses the azimuth target.
  - V1 refined to what actually hurts: along-axis views count only when the ships are also stacked on screen.
- **Audit 3.**
  - V4 exposed a new failure: the fight shrank to a speck because the camera framed missed rounds flying off for 12 km. Now ordnance counts for framing only while it's still closing on its target and near the fight; it's still drawn (user's rule). Threats may widen the frame only to about the ships' own separation.
  - Added V9 (fills the frame) to catch this directly.
- **Audit 4.**
  - Framing slipped when ships separated after merges; the camera's pull-back lagged behind a 2.5 s spring. Now it pulls back briskly (1 s, 80%/s) and eases in gently (1.6 s, 35%/s).
  - Added look-ahead: the director frames the ships' positions 0.8 s ahead.

## State
- Audit of the 12-fight card: V1–V6 and V8 pass 12/12; V9 passes 10/12 (worst 5.3% of frames).
- Frame cost: median 0.9 ms, 95th percentile 4.1 ms at 3200×1800.
- Storyboards read well at the fights' key moments: salvos against PDCs, charge lines on target, railgun strikes, lead changes, the kill.

## Round 2: the critiques, plus the user's destruction rule
- **Rocks:** flat dark silhouettes with a thin cool outline, low-poly (the first outline pass was too busy).
- **The kill:**
  - a double ring (threat red, then white) on the killing blow and a brief flash frame;
  - playback continues 6 s past the end, with ships and ordnance coasting and ordnance fading over 2 s;
  - after the end the guns go quiet: no PDC fire, charge lines or plumes.
- **Death by cause** (user):
  - destroyed by weapons fire (hull 0): the icon breaks into its facets, which drift and tumble;
  - crew dead or dead in space: intact, a slow derelict tumble.
  - Checked with a dead-in-space recording (`--find-reason`, `?file=derelict.json`).
  - Found: non-destruction endings are now very rare (dead in space about 1 in 700 fights; crew dead 0 in 5,000). A simulation-side note.
- **Result card**, 1.4 s after the end, under the scoreboard so the wreck stays in view. Winner, "X destroyed by railgun · 2:08", and hits / torpedoes through / crew lost per side. Cards change to "victory" / "destroyed" / "adrift" / "crew lost", and the loser's card dims.
- **Compact ship card:** name / plan / g on one line; hull; weapons on one row; systems as labelled pips; crew as a 2×2 of chips coloured by state, with the g dose as an underline.
- **Radio chatter:**
  - short crew lines above each card, from plan changes (going in, breaking, extending, torpedo break, safeties off) and events (birds away, firing, lost the drive, drive's back, crew lost, pilot out);
  - at most one line per ship every 6 s, shown for 2.6 s, stopping at the end.
- **Storyboard fixes:** seeking clears running effects; the result card keys off the recorded end; frames can be looked up past the end; CSS animations are disabled in storyboard mode (a hidden pane doesn't advance them); the capture label uses the file actually loaded.
- **Kill slow-mo window capped** at 1.2 s of lead-in (a long flight alone overran a short fight's budget).
- **Audit:** V1–V6 and V8 pass 12/12; V9 9/12 (worst 5.3%).

## Round 3: sound (`viewer2/js/audio.js`, files in `viewer2/sfx/`, opus with an m4a fallback)
- **Starting and stopping:** sound starts on the first click or key; M toggles it. Audit, storyboard and seek are silent.
- **Buses:** the effects bus and the music bed feed a master compressor. Each sound is panned by where it sits on screen and quietened by its distance from the camera.
- **Events:**
  - torpedo launch: once per salvo;
  - railgun fire;
  - one explosion recording, treated per use: rail hit (a thin, sped-up crack); torpedo hit (full); debris (a bright patter scaled by the share that hit); torpedo shot down (a distant pop); kill (slowed and deepened, its top end closing, with a second layer); derelict (a dull thud);
  - capacitor vent.
- **Continuous layers:**
  - Railgun charge: a crossfaded loop. Pitch rises from 0.85× to 1.30× with charge, and volume rises with it. A held full charge wavers (7 Hz tremolo).
  - PDC: the single shot retriggered on the audio clock for each mount firing, with pitch jitter.
  - Engines: a low-pass that opens with g. Steady burns sit low and the sound swells when thrust rises (0.6 s decay). The louder engine leads and the other sits at 55%. Measured on fight 0: summed engine level median 0.29 → 0.17 after the change; swells in 27 s of the 128 s fight.
- **Slow motion:** new sounds pitched to 0.72× and the effects bus low-passed to 1.7 kHz. The music ducks under slow motion and swells for the result.
- **Instrumentation:** `window.__app.audio.log` records every one-shot as [t, name, gain]; `.levels` holds the live layer levels.

## Round 4: user feedback (projectiles, scale, motion, time, shrapnel, scorekeeping)
- **PDC tracers:** individual rounds replace the dashed beam. Each round is re-derived from the frame it was fired in, so seeking and slow motion are exact. It leads its target, flies ballistically at 1.4 km/s, and fades out past the target. One tracer every other frame per mount (15 a second); two a frame blurred into a beam.
- **Ships 20% smaller:** icon at most 8% of screen height (was 10%).
- **Absolute motion:**
  - world-fixed dust in 3D (lattice octaves blended by camera distance, sized by depth);
  - world-fixed ticks on the fight plane (the rings follow the fight, the ticks don't);
  - an 8 s path behind each ship.
- **Time scale:** a badge whenever playback isn't 1× (factor, "slow motion" / "fast forward" / "paused", log meter), and a blue edge treatment in slow motion.
- **Shrapnel:** the wireframe sphere is replaced by 40 sparking fragments per cloud, spread by the recorded dispersion and streaking along the cloud's course. A small SHRAPNEL tag rides each cloud still closing within 3.5 km (nearby clouds share one tag). Consequences read "X shrapnel ▸ Y".
- **Railgun charge was inaudible:** the file sat about 14 dB under the music. Now every file is normalized to gated RMS −20 dBFS on load, charge gain is 0.3–0.8 (was 0.1–0.4), and the music ducks up to 45% while a gun charges.
- **PDC burst accuracy:** a live tally under the shooter's tag. Against a ship: "PDC hits/rounds · %", with rounds at a 60 rounds/s cyclic rate and each recorded PDC hit counted as one round landing. Against torpedoes: "PDC · downed/engaged torps".
- **Exchanges:**
  - Split by activity (shots, launches, kills, damage, PDC fire on a ship); a 4 s lull ends one. Under 3 points total is a skirmish and isn't scored.
  - Scored in integrity points (the scoreboard's 0.4 hull / 0.4 components / 0.2 crew weighting) and named by the dominant weapon (≥60%): torpedo trade, gun duel, close-in brawl.
  - The live score sits in the scoreboard's lead line; won exchanges show as pips; the result is called 1.5 s after the exchange ends, including "X leads" when it swung the lead; the result card has an exchanges row.
- **Text density:** the new damage made callouts spike to 11–20 a minute, so V5 now also requires ≤8 a minute.
  - Text only for deaths, drive / reactor / railgun losses, exchange results, lead changes outside exchanges, and the result. Repairs and launches moved to radio chatter.
  - Consequence callouts are spaced ≥5 s apart; news that waits over 3 s is dropped.
  - Now 3–8 a minute, shortest 2.6 s.
- **Card re-recorded** on the new damage model (old card in runs/viewer/card-pre-damage). Crew killed by fire in 11 of 12 fights; 3–11 systems lost per fight; one crew-dead ending.
- **Audit:** V2–V6 and V8 12/12. V1 11/12 (one fight looks along the ships' line in 1.2% of frames, limit 1%). V9 8/12 (the known small-ships issue).

## Round 5: overlay rebuilt around the ships; a 3D compass (user: hard to tell what you're looking at, dense, small and far from the action; the field too flat)
- **Ship plates** replace the corner cards and name tags. Each plate sits beside its ship, on the side away from the other, joined by a leader line; it stays on screen and clear of the scoreboard and the other plate, and eases so it doesn't jitter. It shows:
  - name and railgun state ("RAIL 64%", a pulsing red "RAIL READY");
  - plan, plus g once it's hard;
  - a 9 px hull bar;
  - crew as four dots (hurt amber, blacked out as an amber ring, dead as a grey ring) and "rail 8 · torps 9";
  - systems out, a row that lights red for 2.5 s when something new goes out;
  - the PDC burst tally ("PDC on target 9/84 · 11%", "PDC vs torpedoes · 1/3 down");
  - a flag for deaths, pilot blackouts and a burned-out gun (red for deaths);
  - the radio line under the plate.
- **Scene labels:** torpedo salvos ("2 TORPEDOES", range in red once within 2.5 km) and shrapnel. The railgun charge moved onto the plate.
- **Opening legend** (first 7 s, bottom): ship and flame, railgun charge, torpedo, PDC rounds, shrapnel, height stalk.
- **Fight-wide news** (exchange results, lead changes, the result) sits under the scoreboard at 24 px. The side-view inset is gone; the gimbal does its job in the scene.
- **3D compass:**
  - Sky: a sphere at infinity fixed to the fight's frame, with the horizon, ±30° rings, the cardinal meridians, heading labels every 30°, zenith and nadir. Kept faint: the first pass (every 30° meridian, ±60° rings, 5° ticks) cluttered low camera angles.
  - Gimbal around the fight: a horizon ring with heading ticks, two vertical rings (000/180 and 090/270) with elevation ticks, and a height axis. It eases to 1.12× the farther ship's distance. The gimbal and the horizon disc are depth-cued: bright in front of the fight's middle, dim behind.
- **Text:** system losses now show in the outs row instead of flags; plate flags start ≥4 s apart (deaths exempt) and are never cut short. V5 12/12 at 2.7–6.9 lines a minute.
- **Audit:** V2–V6 and V8 12/12; V1 11/12 and V9 8/12 unchanged. Live playback 60 fps (p95 frame 17.5 ms); the HUD update is 0.9 ms at p95.

## Round 6: mobile (portrait first), touch controls
- **Stage-fit framing (all screens):** the director now fits the subjects into the stage, the screen area the overlay leaves clear (measured from the DOM every 10 frames). It fits each screen axis separately (margin 0.74) instead of a bounding sphere against the narrower field of view, and shifts the projection centre to the stage's middle (`setViewOffset`). On a tall screen the old sphere fit let the narrow horizontal field set the distance, and the ships shrank.
- **Portrait camera:**
  - Blended by aspect: the camera sits closer to the ships' line and higher (elevation 42°+), so separation runs up the screen.
  - The offset from the line (25 / 45 / 65 / 90°) is the most upright one that still shows ≥55% of the separation, judged from the candidate view; it steps back down once a smaller one shows ≥65%.
  - Candidate sides are filtered by what they show. With the ships' line tilted 35° below the plane, a view pitched down 42° from one side looked almost along it (the cause of the first portrait V1/V4/V9 misses).
- **Portrait layout:**
  - compact full-width scoreboard (names, pips, clock, tug, exchange line);
  - news under it, wrapping;
  - plates docked at the bottom as mirrored team panels (radio lines above them), with name tags on the ships;
  - legend as a 3-column grid;
  - result card full-width, with the stage moving below it so the winner stays in view;
  - scene labels flip left at the right edge;
  - safe-area insets, `100dvh`, no pinch or double-tap zoom, no tap highlight.
- **Short landscape (height ≤ 520 px):** compact scoreboard, plates, callouts, result and controls.
- **Touch controls:**
  - a tap shows or hides a bottom sheet (auto-hides after 4 s while playing), holding: title and fight count, a scrubber with exchanges as blocks in the winner's colour and the kill as a red tick (preview while dragging, seek on release), previous / −5 s / play (64 px) / +5 s / next, speed (1 → 2 → 4 → ½), sound;
  - every target ≥48 px;
  - a double tap on the left or right third skips 5 s (the same as the buttons, so nothing is gesture-only);
  - the dock fades while the sheet is open.
- **Phones:** pixel ratio capped at 1.5 and bloom at half resolution.
- **Critic:** V1 now tests the stage (inset 4%) rather than fixed NDC bounds; V9 tests separation against 0.3 × the stage's shorter side (≈ the old 15% of a 16:9 width).
- **Audit, 375×812 portrait:** V2–V6 and V8 12/12, V1 11/12 (worst 1.6% along-axis), V9 9/12 (worst 3.2%). **1600×900 landscape:** V1 12/12 (was 11), V9 10/12 (was 8), the rest 12/12.
- Not yet measured on a real phone: frame rate and battery (the emulator runs on the desktop GPU).

## Round 7: the numbers explained; measurement lines
- **User:** the exchange numbers were unclear. They were integrity points dealt (100 = a whole ship) with no unit, and the tug showed relative health, so nothing anchored them.
- **Scoreboard:** the tug is replaced by an integrity bar per ship (the 0.4 hull / 0.4 systems / 0.2 crew index, 0–100%), with its percentage, draining toward the centre (the fighting-game convention). During an exchange each ship's loss in it so far is a white chunk at the bar's inner end, labelled "−12%"; the chunk drains when the exchange is called. The live line reads "● EXCHANGE 4"; the bars carry the numbers.
- **Exchange calls** are two lines, by loss, winner first: "IRONBARK WINS GUN DUEL 2 / IRONBARK LOST 17% · SOLACE LOST 20%".
- **Plate bars** are labelled HULL, since they're hull only while the scoreboard shows overall condition.
- **Legend:** one more entry, "top bars: ship condition · white = lost this exchange".
- **Measurement lines** (|—N m—|, end ticks facing the camera, label = true distance), all from the recording (`Match.findMeasures`):
  - Railgun misses: closest approach to the target, refined between frames, drawn from the icon's edge out along the miss direction (never shorter than 6% of screen height, since icons are far larger than ships), with the round's path dashed in the shooter's colour. Shown for 2.4 s of match time, riding with the target.
  - Close passes: separation minima under 300 m, ≥4 s apart. "closest N m" spans the ships' positions at closest approach, carried with the fight's middle so it stays by them, for 1.8 s.
- **Observation:** the railgun hits 88% of shots on this card (107/121), so misses are rare (14; 13–55 m). Pilots only fire when a hit is likely. Worth a design look if misses should be part of the show.
- **Audit:** landscape V1–V8 12/12, V9 10/12; portrait V1 11/12, V9 9/12, the rest 12/12 (unchanged).

## Round 8: hybrid camera; the new endings
- **Hybrid camera** (`viewer2/js/camctl.js`): the viewer's input becomes offsets on the director's view (azimuth and elevation around its look point, clamped −80° to +84°; a factor on its distance, 0.3–3×), applied last in `Director.update`, so the director's framing never sees them.
  - 2.5 s after the last input the offsets ease back (0.9 s time constant) and the director has the shot again.
  - Desktop: drag to orbit (0.0045 rad/px), wheel or trackpad pinch to zoom (ctrl+wheel; gesture events on Safari), double-click to hand back at once.
  - Touch: one finger orbits, two fingers pinch-zoom and orbit by their midpoint. An 8 px threshold separates a drag from a tap, so tap-for-controls and double-tap-to-skip still work.
  - A "FREE CAMERA · DIRECTOR IN n S" pill with a Director button (≥44 px on touch) shows while the viewer has the camera. Inactive in audit and storyboard.
  - Tested with synthetic pointer and wheel events: drag orbits without toggling the controls, a tap still shows them, a two-finger spread zooms in, and the offsets return after the hold.
- **Endings:** the plate shows RAMMING! with a radio line ("Guns are dry. Ramming speed!"); the result card reads "by ramming" or "both disabled · decided on condition".
- **Audit, new card:** V1 10/12 (worst: both-in 96.8%; along-axis 2%), V4 11/12 (2.0% too close), V9 11/12, the rest 12/12. These fights are new; none of the three misses involves a ram.

## Next
- V9: ships looking small in some frames (3–5% in three fights), during fast convergence.
- Watching full fights live, not just stills.
