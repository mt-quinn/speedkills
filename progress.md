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
