# Crew comms recording manifest

Record the recommended number first; the remaining scripted alternatives are optional. One reusable comms voice pack works across the roster. Separate character performances can come later.

Measured on 12 unfiltered fights (22.8 match minutes). Counts reflect emitted subtitles at 30 Hz, after radio spacing and conscious-speaker checks—not raw trigger counts. Actual display timing may change totals slightly. Rare lines still need 3 takes because their repetition is conspicuous.

| Cue | Speaker | Plays/fight | Plays/min | Recommended variations |
|---|---|---:|---:|---:|
| attack | pilot | 5.33 | 2.8 | 8 |
| evade | pilot | 1.5 | 0.79 | 6 |
| extend | pilot | 0.42 | 0.22 | 4 |
| hold_range | pilot | 0.5 | 0.26 | 4 |
| torpedo_break | pilot | 0.08 | 0.04 | 3 |
| ram | pilot | 0 | 0 | 3 |
| overcharge | gunner | 0.83 | 0.44 | 4 |
| launch | gunner | 3.83 | 2.01 | 8 |
| fire | gunner | 2.08 | 1.09 | 6 |
| repaired | engineer | 0.67 | 0.35 | 4 |
| system_lost | engineer | 0.17 | 0.09 | 3 |
| crew_lost | ops | 0.42 | 0.22 | 4 |
| pilot_out | ops | 0 | 0 | 3 |
| defence_dry | ops | 0.17 | 0.09 | 3 |
| defence_hot | ops | 1.42 | 0.74 | 6 |
| g_limit | pilot | 0 | 0 | 3 |

## Recording workflow

Use a quiet room and keep the phone distance consistent. Record clean, dry speech; keep the originals before applying your comms treatment in Audacity. Aim for 0.5–2.5 seconds per line, with about half a second of silence between takes. Avoid saying crew or ship names: these clips are reusable, and the subtitle identifies the speaker.

Export individual mono WAV files named below. Put processed clips in `viewer2/sfx/voices/`, then run `node --experimental-default-type=module viewer2/tools/register-voices.mjs`. The player accepts WAV, MP3, OGG, Opus or M4A files that the browser can decode. Speech follows the effects toggle, stays at normal pitch during slow motion, and ducks the music. Missing recordings simply leave subtitles.

Suggested recording order: attack, evade, fire, launch, extend, then damage and emergency cues. Deliver routine calls clearly and tightly; emergencies more strained, never long speeches. Leave system names and casualty names to the visual broadcast. Only conscious crew speak; crew-lost may be reported by any conscious survivor.

## attack — 8 recommended variations

Trigger: Enter attack run or punish. Observed 64 times on this card.

- [ ] `attack_01.wav` — “Going in.”
- [ ] `attack_02.wav` — “Taking the opening.”
- [ ] `attack_03.wav` — “Closing for the shot.”
- [ ] `attack_04.wav` — “Pressing the attack.”
- [ ] `attack_05.wav` — “Moving in.”
- [ ] `attack_06.wav` — “We have an opening.”
- [ ] `attack_07.wav` — “Commit to the run.”
- [ ] `attack_08.wav` — “Taking the fight to them.”

## evade — 6 recommended variations

Trigger: Enter juke. Observed 18 times on this card.

- [ ] `evade_01.wav` — “Breaking!”
- [ ] `evade_02.wav` — “Changing vector.”
- [ ] `evade_03.wav` — “Hard break.”
- [ ] `evade_04.wav` — “Rolling clear.”
- [ ] `evade_05.wav` — “Hold on.”
- [ ] `evade_06.wav` — “Jinking now.”
- [ ] `evade_07.wav` — “Off their line.” (optional extra)
- [ ] `evade_08.wav` — “Burning clear.” (optional extra)

## extend — 4 recommended variations

Trigger: Enter extend. Observed 5 times on this card.

- [ ] `extend_01.wav` — “Extending.”
- [ ] `extend_02.wav` — “Opening the range.”
- [ ] `extend_03.wav` — “Resetting the run.”
- [ ] `extend_04.wav` — “Pulling clear.”
- [ ] `extend_05.wav` — “Making room.” (optional extra)
- [ ] `extend_06.wav` — “Coming around.” (optional extra)

## hold_range — 4 recommended variations

Trigger: Enter Counter holding range; opposing rail has no reload opening. Observed 6 times on this card.

- [ ] `hold_range_01.wav` — “Holding the range.”
- [ ] `hold_range_02.wav` — “Bleeding closing speed.”
- [ ] `hold_range_03.wav` — “Keeping our distance.”
- [ ] `hold_range_04.wav` — “Hold here. Wait for the shot.”
- [ ] `hold_range_05.wav` — “Braking the approach.” (optional extra)
- [ ] `hold_range_06.wav` — “Keeping room to move.” (optional extra)

## torpedo_break — 3 recommended variations

Trigger: Enter torpedo break. Observed 1 times on this card.

- [ ] `torpedo_break_01.wav` — “Torpedo — hard over!”
- [ ] `torpedo_break_02.wav` — “Incoming. Breaking hard!”
- [ ] `torpedo_break_03.wav` — “Torpedo inbound. Hold on.”
- [ ] `torpedo_break_04.wav` — “Missile closing. Hard break!” (optional extra)
- [ ] `torpedo_break_05.wav` — “Burning off the intercept.” (optional extra)
- [ ] `torpedo_break_06.wav` — “Incoming. Changing vector!” (optional extra)

## ram — 3 recommended variations

Trigger: Enter ramming; ranged weapons exhausted. Observed 0 times on this card.

- [ ] `ram_01.wav` — “Weapons are out. Ramming speed!”
- [ ] `ram_02.wav` — “Ranged weapons lost. Going through them.”
- [ ] `ram_03.wav` — “Weapons unavailable. Brace for collision.”
- [ ] `ram_04.wav` — “Cannot fire. Taking her in.” (optional extra)

## overcharge — 4 recommended variations

Trigger: Rail enters overcharge. Observed 10 times on this card.

- [ ] `overcharge_01.wav` — “Safeties off.”
- [ ] `overcharge_02.wav` — “Overcharging the rail.”
- [ ] `overcharge_03.wav` — “Pushing the capacitors.”
- [ ] `overcharge_04.wav` — “Taking the overload shot.”
- [ ] `overcharge_05.wav` — “Running the gun hot.” (optional extra)
- [ ] `overcharge_06.wav` — “One hard shot.” (optional extra)

## launch — 8 recommended variations

Trigger: Torpedo launch; salvo grouped by cooldown. Observed 46 times on this card.

- [ ] `launch_01.wav` — “Birds away.”
- [ ] `launch_02.wav` — “Torpedoes away.”
- [ ] `launch_03.wav` — “Salvo out.”
- [ ] `launch_04.wav` — “Launch confirmed.”
- [ ] `launch_05.wav` — “Fish in the water.”
- [ ] `launch_06.wav` — “Tubes clear.”
- [ ] `launch_07.wav` — “Sending the salvo.”
- [ ] `launch_08.wav` — “Torpedoes running.”

## fire — 6 recommended variations

Trigger: Rail fired. Observed 25 times on this card.

- [ ] `fire_01.wav` — “Firing.”
- [ ] `fire_02.wav` — “Shot away.”
- [ ] `fire_03.wav` — “Rail away.”
- [ ] `fire_04.wav` — “Round out.”
- [ ] `fire_05.wav` — “Taking the shot.”
- [ ] `fire_06.wav` — “Gun fired.”
- [ ] `fire_07.wav` — “Sending it.” (optional extra)
- [ ] `fire_08.wav` — “Rail fired.” (optional extra)

## repaired — 4 recommended variations

Trigger: Destroyed component repaired. Observed 8 times on this card.

- [ ] `repaired_01.wav` — “System back online.”
- [ ] `repaired_02.wav` — “Repairs holding.”
- [ ] `repaired_03.wav` — “We have that system back.”
- [ ] `repaired_04.wav` — “Back in service.”
- [ ] `repaired_05.wav` — “Restored. Keep fighting.” (optional extra)
- [ ] `repaired_06.wav` — “Repair complete.” (optional extra)

## system_lost — 3 recommended variations

Trigger: Component destroyed. Observed 2 times on this card.

- [ ] `system_lost_01.wav` — “System down!”
- [ ] `system_lost_02.wav` — “Lost a system!”
- [ ] `system_lost_03.wav` — “Damage control, on it.”
- [ ] `system_lost_04.wav` — “We have a system failure.” (optional extra)
- [ ] `system_lost_05.wav` — “That system is out.” (optional extra)
- [ ] `system_lost_06.wav` — “Working on the damage.” (optional extra)

## crew_lost — 4 recommended variations

Trigger: Crew killed; another conscious survivor reports. Observed 5 times on this card.

- [ ] `crew_lost_01.wav` — “Crew member down.”
- [ ] `crew_lost_02.wav` — “We lost someone.”
- [ ] `crew_lost_03.wav` — “Station casualty.”
- [ ] `crew_lost_04.wav` — “No response from that station.”

## pilot_out — 3 recommended variations

Trigger: Pilot blacked out. Observed 0 times on this card.

- [ ] `pilot_out_01.wav` — “Pilot is out. Holding steady.”
- [ ] `pilot_out_02.wav` — “Pilot unconscious. Hold course.”
- [ ] `pilot_out_03.wav` — “Pilot blacked out. Stay steady.”
- [ ] `pilot_out_04.wav` — “No response from the pilot.” (optional extra)

## defence_dry — 3 recommended variations

Trigger: All working PDC mounts exhausted, once per ship. Observed 2 times on this card.

- [ ] `defence_dry_01.wav` — “Point defence dry.”
- [ ] `defence_dry_02.wav` — “No defence rounds left.”
- [ ] `defence_dry_03.wav` — “PDC ammunition exhausted.”
- [ ] `defence_dry_04.wav` — “Defence guns are empty.” (optional extra)

## defence_hot — 6 recommended variations

Trigger: All loaded working PDC mounts overheated; at least 15s between warnings. Observed 17 times on this card.

- [ ] `defence_hot_01.wav` — “Defence guns too hot.”
- [ ] `defence_hot_02.wav` — “PDCs overheated. Cooling.”
- [ ] `defence_hot_03.wav` — “Defence needs to cool.”
- [ ] `defence_hot_04.wav` — “Point defence is cooling down.”
- [ ] `defence_hot_05.wav` — “Defence cooling. Keep clear.”
- [ ] `defence_hot_06.wav` — “Hot mounts. Need a moment.”

## g_limit — 3 recommended variations

Trigger: Pilot conscious and normalized g dose crosses 0.75; rearm below 0.4. Observed 0 times on this card.

- [ ] `g_limit_01.wav` — “Near my limit.”
- [ ] `g_limit_02.wav` — “Need to ease this burn.”
- [ ] `g_limit_03.wav` — “Vision closing in.”
- [ ] `g_limit_04.wav` — “Too much gee. Easing off.” (optional extra)
