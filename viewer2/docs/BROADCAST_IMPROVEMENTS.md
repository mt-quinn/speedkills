# Broadcast pass — September 2026

The live scoreboard measures **condition** (hull, systems and crew), not win probability. A destroyed ship is OUT, and the recorded winner overrides the condition comparison at the finish. Crew portraits remain on the live plates, with station/state/gee-resistance and blackout recovery time accessible by hover or keyboard focus. Casualty news explains what happens to that station.

The tactical line uses current state only: available point defence, overheated mounts, a charged rail against a reload, and crew approaching blackout. Fight-wide news temporarily takes its place. Rail reload time and total PDC firing-second reserves remain on each ship plate. PDC reserve is summed across working mounts; three firing mounts spend three seconds of reserve per second. Burst accuracy percentages were removed because tracer counts were estimates.

Counter now uses RCS to slow the approach while the opponent has no rail reload opening. It preserves an eight-second minimum PDC reserve against torpedoes and does not make outward drive burns to escape indefinitely. The viewer identifies this as “holding range.” Knife retains its pressure; Duelist retains its slashing passes.

The decisive-sequence button plays a short excerpt before the finish, labelled REPLAY, and returns to the result. Full replay remains available. Finish explanations state recorded facts, including exhausted/disabled defence before a final torpedo and collision survival. “Crew alive at finish” reports the simulation’s crew state; it does not imply rescue from a destroyed hull.

Scene reference geometry fades during dense fire. Hull brightness follows hull condition, failed drives have no plume, failed rails have no nose light, overcharged guns have red nose lights, and disabling hits get an additional ring. Scene changes and seeks dispose obsolete GPU resources.

Picks lock at the beginning, including choosing Just watch. Settlement and history are idempotent across replay. Form and prior meetings are **completed fights watched on this device**, not an invented league career.

## Voice recording

Start with [VOICE_RECORDING_MANIFEST.md](VOICE_RECORDING_MANIFEST.md). It gives exact scripts, filenames, station, trigger, observed frequency and recommended vocal take count. The JSON companion contains the full measurement and per-fight counts. No voice recordings are shipped yet. Each cue has one fixed script. Multiple vocal takes rotate with the same subtitle; partial packs work and missing cues remain text.

```sh
node --experimental-default-type=module viewer2/tools/register-voices.mjs
node --experimental-default-type=module viewer2/tools/voice-manifest.mjs
```

The first registers processed files from `viewer2/sfx/voices/`; the second remeasures the current card. Radio speech requires conscious crew, is spaced globally and per ship, stops on seek/pause/casualty, ducks music and effects, and keeps normal pitch in slow motion. The common pack can later be extended to distinct character voices.

## Fresh cards and odds

```sh
python3 viewer2/tools/fresh-card.py
python3 viewer2/tools/fresh-card.py --refresh-odds
```

The first generates twelve unique random pairings with fresh seeds and cached odds. The second recomputes all45 pairings at400 fights each after simulation changes. Neither filters wins, durations or spectacle. Previous index files are saved in `viewer2/cards/`; recordings remain available. A source fingerprint blocks reuse of stale odds. Reload the viewer after generating a card. This is an authoring command for the static viewer, not server-side match generation on a deployed site.

## Validation

- Rust duel tests:13 passed,11 diagnostic tests ignored.
- Accepted policy:1,200 unfiltered standard-crew fights; allG1–G6 PASS. Median84s, no unfinished fights,63% condition swings,70% winners previously behind,7% lethal-g action.
- Counter versus Knife49%; versus Duelist57%; overall52%. Counter averages15.4 seconds holding range per fight; the other styles zero. Average closest approach450m, compared with232m for the first reserve-only experiment. Shot ranges remain broadly similar; this change establishes a defensive phase rather than distinct weapon ranges.
- League odds refreshed:18,000 fights. Card authoring tool verified by generating L51000–L51011 using those cached odds.
- Desktop card audit: all eight criteria pass12/12. At390×844, all pass12/12 except frame-fill11/12; L51006 has ships smaller than the target for3.1% of its runtime. More aggressive phone camera recovery did not justify its extra movement, so this remains a known limit.
- Ten pure broadcast tests pass and cover dead/unconscious speakers, disabled PDCs, radio spacing and same-script vocal takes, warning rearming, replay bounds, finish explanation, deduplicated history/picks and partial voice packs.

The spectacle gate uses standard crews. An individual random league card may include very long fights or several similar finishes. The camera uses a little more desktop margin and responsive approach/recovery settings. The viewer audit’s FPS result uses synthetic time steps and is not a hardware performance benchmark.
