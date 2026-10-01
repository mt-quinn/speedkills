# Crew comms recording manifest

**18 scripts · 77 recommended recordings.** Record the exact same words for every take of a script. The takes provide vocal variation; there are no alternate-wording lists.

Keep one consistent character voice within each script. Change emphasis, pace, breath and the amount of strain slightly. Aim for usable performances of the same intent, rather than different impressions or exaggerated moods. One shared comms pack works across the roster; separate character packs can come later.

Measured on 12 unfiltered fights (22.8 match minutes). Counts reflect emitted subtitles at 30 Hz after radio spacing and conscious-speaker checks. Frequent cues get 8 takes (3+ plays/fight) or 6 (1+); occasional cues get 4 (0.25+), and rare cues get 3. Zero observed plays means rare on this sample, not unused.

| Exact script | Speaker | Plays/fight | Plays/min | Record this many takes |
|---|---|---:|---:|---:|
| “Going in.” | pilot | 5.33 | 2.8 | **8** |
| “Breaking hard.” | pilot | 1.5 | 0.79 | **6** |
| “Opening the range.” | pilot | 0.42 | 0.22 | **4** |
| “Holding range.” | pilot | 0.5 | 0.26 | **4** |
| “Torpedo inbound. Breaking!” | pilot | 0.08 | 0.04 | **3** |
| “Ramming. Brace for impact.” | pilot | 0 | 0 | **3** |
| “Overcharging the rail.” | gunner | 0.92 | 0.48 | **4** |
| “Torpedoes away.” | gunner | 3.92 | 2.06 | **8** |
| “Railgun firing.” | gunner | 2.33 | 1.23 | **6** |
| “Railgun back online.” | engineer | 0 | 0 | **3** |
| “Railgun offline.” | engineer | 0 | 0 | **3** |
| “Main drive back online.” | engineer | 0.08 | 0.04 | **3** |
| “Main drive offline.” | engineer | 0 | 0 | **3** |
| “Crew member down.” | ops | 0.33 | 0.18 | **4** |
| “Pilot blacked out.” | ops | 0 | 0 | **3** |
| “Point defence out of ammo.” | ops | 0.17 | 0.09 | **3** |
| “Point defence overheated.” | ops | 1.58 | 0.83 | **6** |
| “High-g burn.” | pilot | 0 | 0 | **3** |

## Recording workflow

Use a quiet room and keep the phone distance consistent. Record clean speech and save the originals before applying your comms treatment in Audacity. Aim for 0.5–2.5 seconds per take, with a short pause between takes. Clarity comes first: keep urgent lines intelligible and avoid long improvised additions, crew names or ship names.

Each numbered file is another performance of the same script. Export individual mono WAV files to `viewer2/sfx/voices/`, then run `node --experimental-default-type=module viewer2/tools/register-voices.mjs`. WAV, MP3, OGG, Opus and M4A are supported when the browser can decode them. Extra numbered takes are welcome; partial sets work too. The subtitle stays identical whichever take plays.

Speech follows the effects toggle, stays at normal pitch during slow motion, and ducks the music. Missing recordings leave subtitles. Only conscious crew speak; any conscious survivor can report a crew casualty.

Start with the frequent calls: “Going in,” “Torpedoes away,” “Railgun firing,” and “Breaking hard.” Then record the remaining scripts. Generic system-loss and repair calls have been removed: engineering speech identifies the railgun or main drive. Other component changes remain visible in the HUD.

## attack — 8 takes

**Say every time: “Going in.”**

Delivery: Decisive; committing to the attack.

Trigger: Enter attack run or punish. Observed 64 times on this card.

- [ ] Take 1: `attack_take_01.wav`
- [ ] Take 2: `attack_take_02.wav`
- [ ] Take 3: `attack_take_03.wav`
- [ ] Take 4: `attack_take_04.wav`
- [ ] Take 5: `attack_take_05.wav`
- [ ] Take 6: `attack_take_06.wav`
- [ ] Take 7: `attack_take_07.wav`
- [ ] Take 8: `attack_take_08.wav`

## evade — 6 takes

**Say every time: “Breaking hard.”**

Delivery: Sharp, focused; under physical strain.

Trigger: Enter juke. Observed 18 times on this card.

- [ ] Take 1: `evade_take_01.wav`
- [ ] Take 2: `evade_take_02.wav`
- [ ] Take 3: `evade_take_03.wav`
- [ ] Take 4: `evade_take_04.wav`
- [ ] Take 5: `evade_take_05.wav`
- [ ] Take 6: `evade_take_06.wav`

## extend — 4 takes

**Say every time: “Opening the range.”**

Delivery: Controlled; making room for another pass.

Trigger: Enter extend. Observed 5 times on this card.

- [ ] Take 1: `extend_take_01.wav`
- [ ] Take 2: `extend_take_02.wav`
- [ ] Take 3: `extend_take_03.wav`
- [ ] Take 4: `extend_take_04.wav`

## hold_range — 4 takes

**Say every time: “Holding range.”**

Delivery: Steady and watchful.

Trigger: Enter Counter holding range; opposing rail has no reload opening. Observed 6 times on this card.

- [ ] Take 1: `hold_range_take_01.wav`
- [ ] Take 2: `hold_range_take_02.wav`
- [ ] Take 3: `hold_range_take_03.wav`
- [ ] Take 4: `hold_range_take_04.wav`

## torpedo_break — 3 takes

**Say every time: “Torpedo inbound. Breaking!”**

Delivery: Urgent warning, then a firm action call.

Trigger: Enter torpedo break. Observed 1 times on this card.

- [ ] Take 1: `torpedo_break_take_01.wav`
- [ ] Take 2: `torpedo_break_take_02.wav`
- [ ] Take 3: `torpedo_break_take_03.wav`

## ram — 3 takes

**Say every time: “Ramming. Brace for impact.”**

Delivery: Grim resolve; clear enough for the whole crew.

Trigger: Enter ramming; ranged weapons unavailable. Observed 0 times on this card.

- [ ] Take 1: `ram_take_01.wav`
- [ ] Take 2: `ram_take_02.wav`
- [ ] Take 3: `ram_take_03.wav`

## overcharge — 4 takes

**Say every time: “Overcharging the rail.”**

Delivery: Deliberate; a dangerous choice, not a celebration.

Trigger: Rail enters overcharge. Observed 11 times on this card.

- [ ] Take 1: `overcharge_take_01.wav`
- [ ] Take 2: `overcharge_take_02.wav`
- [ ] Take 3: `overcharge_take_03.wav`
- [ ] Take 4: `overcharge_take_04.wav`

## launch — 8 takes

**Say every time: “Torpedoes away.”**

Delivery: Crisp launch confirmation.

Trigger: Torpedo launch; salvo grouped by cooldown. Observed 47 times on this card.

- [ ] Take 1: `launch_take_01.wav`
- [ ] Take 2: `launch_take_02.wav`
- [ ] Take 3: `launch_take_03.wav`
- [ ] Take 4: `launch_take_04.wav`
- [ ] Take 5: `launch_take_05.wav`
- [ ] Take 6: `launch_take_06.wav`
- [ ] Take 7: `launch_take_07.wav`
- [ ] Take 8: `launch_take_08.wav`

## fire — 6 takes

**Say every time: “Railgun firing.”**

Delivery: Short and matter-of-fact.

Trigger: Rail fired. Observed 28 times on this card.

- [ ] Take 1: `fire_take_01.wav`
- [ ] Take 2: `fire_take_02.wav`
- [ ] Take 3: `fire_take_03.wav`
- [ ] Take 4: `fire_take_04.wav`
- [ ] Take 5: `fire_take_05.wav`
- [ ] Take 6: `fire_take_06.wav`

## rail_restored — 3 takes

**Say every time: “Railgun back online.”**

Delivery: Brief relief, still working.

Trigger: Railgun repaired. Observed 0 times on this card.

- [ ] Take 1: `rail_restored_take_01.wav`
- [ ] Take 2: `rail_restored_take_02.wav`
- [ ] Take 3: `rail_restored_take_03.wav`

## rail_lost — 3 takes

**Say every time: “Railgun offline.”**

Delivery: Immediate, clear damage report.

Trigger: Railgun destroyed. Observed 0 times on this card.

- [ ] Take 1: `rail_lost_take_01.wav`
- [ ] Take 2: `rail_lost_take_02.wav`
- [ ] Take 3: `rail_lost_take_03.wav`

## drive_restored — 3 takes

**Say every time: “Main drive back online.”**

Delivery: Relieved but composed.

Trigger: Main drive repaired. Observed 1 times on this card.

- [ ] Take 1: `drive_restored_take_01.wav`
- [ ] Take 2: `drive_restored_take_02.wav`
- [ ] Take 3: `drive_restored_take_03.wav`

## drive_lost — 3 takes

**Say every time: “Main drive offline.”**

Delivery: Serious; the ship has lost its thrust.

Trigger: Main drive destroyed. Observed 0 times on this card.

- [ ] Take 1: `drive_lost_take_01.wav`
- [ ] Take 2: `drive_lost_take_02.wav`
- [ ] Take 3: `drive_lost_take_03.wav`

## crew_lost — 4 takes

**Say every time: “Crew member down.”**

Delivery: Restrained shock; keep it intelligible.

Trigger: Crew killed; another conscious survivor reports. Observed 4 times on this card.

- [ ] Take 1: `crew_lost_take_01.wav`
- [ ] Take 2: `crew_lost_take_02.wav`
- [ ] Take 3: `crew_lost_take_03.wav`
- [ ] Take 4: `crew_lost_take_04.wav`

## pilot_out — 3 takes

**Say every time: “Pilot blacked out.”**

Delivery: Urgent status report.

Trigger: Pilot blacked out. Observed 0 times on this card.

- [ ] Take 1: `pilot_out_take_01.wav`
- [ ] Take 2: `pilot_out_take_02.wav`
- [ ] Take 3: `pilot_out_take_03.wav`

## defence_dry — 3 takes

**Say every time: “Point defence out of ammo.”**

Delivery: Plain warning; no panic.

Trigger: All working PDC mounts exhausted, once per ship. Observed 2 times on this card.

- [ ] Take 1: `defence_dry_take_01.wav`
- [ ] Take 2: `defence_dry_take_02.wav`
- [ ] Take 3: `defence_dry_take_03.wav`

## defence_hot — 6 takes

**Say every time: “Point defence overheated.”**

Delivery: Tense but precise.

Trigger: All loaded working PDC mounts overheated; at least 15s between warnings. Observed 19 times on this card.

- [ ] Take 1: `defence_hot_take_01.wav`
- [ ] Take 2: `defence_hot_take_02.wav`
- [ ] Take 3: `defence_hot_take_03.wav`
- [ ] Take 4: `defence_hot_take_04.wav`
- [ ] Take 5: `defence_hot_take_05.wav`
- [ ] Take 6: `defence_hot_take_06.wav`

## g_limit — 3 takes

**Say every time: “High-g burn.”**

Delivery: Strained breath; every word must remain clear.

Trigger: Pilot conscious and felt acceleration reaches 7 g; rearm below 6 g. Observed 0 times on this card.

- [ ] Take 1: `g_limit_take_01.wav`
- [ ] Take 2: `g_limit_take_02.wav`
- [ ] Take 3: `g_limit_take_03.wav`
