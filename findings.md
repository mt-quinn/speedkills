# Findings

- Viewer is static playback of Rust sk-duel traces; 30 Hz frames include PDC ammo/heat, rail cooldown, crew health and normalized g-dose.
- Composite integrity weights hull 40%, systems 40%, living crew 20%; a destroyed ship can retain a substantial index. End-state presentation must override it without treating it as win probability.
- Existing HUD chatter ignores speaker survival; Fairweather spoke after death in L40000.
- L40000 finishes after Halcyon's screen runs dry. L40009 ends when Sable's ram destroys Sable, with Vesper surviving at 2% hull.
- Saved 1,200-fight sample: Counter/Knife rail median 1.3/1.4 km. Reference attack-run/extend behaviour is distinct.
- Current league is ten ships, 45 pairings × 400 simulations, 12 fixed unfiltered recordings. Fresh card generation can reuse unchanged odds.
- Existing code and generated league files are uncommitted; preserve them.

## Implemented broadcast pass
- Live opening analysis reads only current raw frames; rail reload, PDC seconds/heat and g-dose warnings are visible.
- Condition is labelled separately from win odds; destroyed ships show OUT and final winner takes precedence.
- Portraits persist into live ship plates. Speech requires conscious crew; casualty flags state station consequences.
- Optional decisive replay is 4–12 seconds before finish, labelled REPLAY, returns to the result, and cannot duplicate history/pick settlement.
- Voice catalog in js/voices.js feeds subtitles and docs/VOICE_RECORDING_MANIFEST.md. Optional recorded clips use sfx/voices/index.json; speech ducks music/effects, does not pitch-shift in slow motion, and stops on seek/casualty.
- Form and head-to-head derive solely from completed fights on this device. Just-watch closes later picks.

## Counter experiment
- First reserve-only candidate passed gates but barely changed range. Added explicit RCS braking against a ready opposing rail; no outward drive burn.
- Accepted candidate: 1,200 unfiltered default-crew fights, all six gates PASS. Median84s, unfinished0, short0%, condition swings63%, winner previously behind70%, lethal-g7%.
- Counter vs Knife49%, vs Reference57%; overall52%. Holding-range state averages15.4s for Counter and0 for other doctrines. Average closest approach450m versus232m on reserve-only candidate.
- Full400-fight odds for each45pairings are being refreshed; static viewer card is12 unfiltered matchups.

## Final status
- Voice catalog16cues; measured72 recommended clips on1370s current card. Optional variations beyond the recommended set are scripted; partial audio packs select matching subtitles.
- Desktop audit all12/12 after conservative framing margin. Phone all12/12 except frame fill11/12 (L51006 small for3.1% runtime); farther zoom experiments did not produce enough benefit and were reverted.
- Full odds and fresh unfiltered card complete; source fingerprint validates cached odds. Current cardL51000–L51011, prior50000card index archived.
- Recordings are not present; speech pipeline still needs listening validation with actual phone/Audacity clips.
