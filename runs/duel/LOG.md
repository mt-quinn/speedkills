# Speed Kills v2 — spectacle iteration log

## Goal: the spectacle gate
Round-robin of the tactical styles, 200 fights per pairing (`cargo test -p sk-duel spectacle_round_robin --release -- --ignored`,
scored by `python3 python/duel/spectacle.py`):

| # | Criterion | Pass |
|---|---|---|
| G1 | Length | median 60–150 s; <10% under 40 s; <10% time-outs |
| G2 | No dominant tactic | ≥3 styles; each 35–65% overall; none beats every other head-to-head |
| G3 | Swings | lead changes hands (health index, ±0.03 deadband) in ≥50% of fights |
| G4 | Varied endings | no finishing cause >50%; ≥3 causes at ≥10% each |
| G5 | Exchanges | median ≥4 meaningful hits per fight |
| G6 | The juice | lethal-g burns (>14 g for 0.5 s) or g deaths in 5–20% of fights |
| G7 | Controls | lazy styles lose ≥80% (`sanity_gate_table`) |

Research behind G3/G5 (2026-09-29):
- Clauset, Kogan & Redner, *Safe leads and lead changes in competitive team sports* (PRE 2015). Scoring is a random walk; lead changes ≈ √(2N/π) for N equal steps. Two effects raise that: **anti-persistence** (whoever scores cedes possession) and a **restoring force** (the trailer scores faster, in proportion to the deficit).
- Sirlin, *Slippery Slope and Perpetual Comeback*. Losses that cut both score and capability make early leads decisive. The fix is to keep that effect limited and temporary, and add a comeback mechanism that doesn't create perverse incentives.

## Iterations

**I0 baseline** (the design as reported). FAIL on G1 (median 47 s, 40% under 40 s), G3 (20%), G4 (railgun 86%) and G6 (4%).
Cause: a spinal gun plus vitals on the centreline, so a nose-on hit guts the ship and the first hit decides the fight.

**I1 damage economy and layout.**
- Hypothesis: a kill needing ~8 hits, with vitals off the centreline, lengthens fights and spreads the endings.
- Change: rail 150 hull with a 1.5 m tube; torpedo 250; PDC stream grinds at close range; vitals and crew moved to a ring off the spine; railgun on the keel.
- Result: G1 PASS (84 s), G5 PASS (7), G6 PASS (7%). G3 FAIL (22%), G4 FAIL (pdc 46 / rail 43).
- Finding: "pdc" was mis-attributed, because the last scratch got the credit. Fixed: the finisher is now the weapon that did the most damage in the final 10 s.

**I2 posture v1** (trailer presses in, leader holds).
- Hypothesis: a trailer that closes creates a restoring force.
- Result: G3 got worse (17%). Pressing into the sure-hit zone against a leader whose gun is up *lowers* the trailer's scoring rate.
- The launcher moved amidships (the first salvo was destroying it, a slippery slope).

**I3 step sizes.**
- Measured: P(next hit lands on the leader) = 0.50, so there is no snowball. But the first hit (usually the opening salvo) was 0.11–0.23 of health, against 0.06 for later hits: one big step, then a few small ones.
- Change: torpedo 150 (about a rail hit); hull 1400 (~10–12 hits to kill); rail cooldown 4 s.
- Result: G3 28%, G1 median 102 s but 17% time-outs, G4 railgun 52%.

**I4 limited slippery slope** (Sirlin).
- Hypothesis: engineers patching any damaged part up to 80% makes damage partly temporary, so capability and the health index recover, and leads can change by repair.
- Change: repair at 0.08/s up to 0.8; a destroyed part is rebuilt to 0.3 in 8 s; only under 3 g.
- Result: repairs barely ran (0.1 per fight), because the engineer was blocked above 3 g and ships nearly always exceed that. **I5 (user's call):** repairs now work at any g while the engineer is alive and conscious.

**Diagnosis between I5 and I6** (mirror, 200 fights). Checks, in order:
- 21 damage steps per fight: a random-walk model predicts 56% swings; measured 36%.
- P(next damage step on the same ship) = 0.38. That's anti-persistent, like NBA possession (0.36), so persistence isn't the cause.
- The eventual loser took 55% of damage steps: no per-fight bias. Crew-toughness gaps: winner had the tougher crew 51% of the time. Starting side: 51%. Neither matters.
- **Shuffling each fight's own steps raises swings from 35% to 55%, so the order is the cause.**
- Posture switched off (POSTURE=off): no change (38%).
- Railgun shots alternate (P(same shooter next) = 0.12); the winner lands 56% of railgun hits but **73% of torpedo hits**.
- Mechanism: the opening torpedo lottery sets the lead, then the railgun trade (fire, then get punished during your reload) swaps about one hit each per cycle and *preserves* it. Anti-persistence only creates lead changes when the lead is small compared with one step. What's missing is the paper's restoring force.

**I6 variance by scoreboard.**
- Change: behind, fire every salvo as soon as it's loaded; ahead, hold torpedoes in reserve.
- Result: no change (35%). Both opening salvos are fired before anyone leads.

**I7 overcharge** (a restoring force that lives in a choice, per Sirlin).
- Hypothesis: a risky option that raises a ship's scoring rate, rational only for the trailer, restores leads.
- Change: charge 2× faster and hit 1.5× harder, with a 30% chance per shot of burning your own railgun (−0.4) and reactor (−0.15). The reference overcharges when behind by more than 0.08.
- Result: **mirror swings 35% → 52%.** G6 now passes (5%). Overall G3 is 34%, dragged down by the Brawl pairings (Brawl has no scoreboard sense). 0.58 overcharged shots per ship, 0.18 burns.
- Next: G2 needs ≥3 real broadcast styles, all using posture, the juice and overcharging. Brawl is retired from the tactical pool and stays as a lazy control.

**I8 doctrines** (duelist = Reference, knife fighter, counterpuncher; one pilot brain with a different plan each).
- Result: G1, G2, G3 (58%), G5 and G6 PASS; G4 FAIL (railgun 64%).
- But the counterpuncher behaved identically to the duelist: the capacitor-limit "use it or lose it" rule overrode its patience.

**I9 fixes.**
- The counterpuncher vents rather than take a poor shot.
- Closing-speed control added (brake on RCS short of stand-off).
- Point-blank salvos dropped. A controlled test showed closing speed barely matters (0.30 → 0.33 hits per salvo), while run-up does: ≥1 through 20% of the time from 7 km, 5% from 4 km.
- Result: the knife fighter dominated (72–76%). Cause: my braking fired when the *enemy* closed, killing the defender's jink. Fixed so only a ship's own approach counts.

**I10 collision avoidance.**
- Ramming was 10% of endings, then 41% after my first attempt (sign bug, now fixed).
- Result: G1, G2, G3 (57%), G5 and G6 PASS; G4 FAIL (railgun 70%, PDC 26%, torpedo 0%).
- The G2 "beats everyone" threshold raised to 55% (with 200 fights per pairing the standard error is about 3.5 points).
- Ablation: overcharge off drops swings from 57% to 36%, confirming it's the restoring force.

**I11 slashing passes** (duelist: boom and zoom, extend to 4.5 km, come round).
- Why: salvos went out at a median of 11 s, 1% after 40 s, and a median of 3 torpedoes went unused. Fights parked at 1.5 km, where torpedoes have no run-up.
- Result: the duelist extends about 23 s per fight and fires both salvos 73% of the time. G6 at 14%.
- Still: torpedo finishes 0%, and the duelist beats both others 58%.

**I12 torpedoes as closers.**
- Found: salvos went out early (median 16 s), and a median of 3 torpedoes went unused. PDCs never ran dry (40 of 90 s left at the end).
- The last salvo is now held for a window (enemy PDCs thin or down to one mount, the enemy badly hurt, or t > 120 s), and a slasher extends to 6.2 km to launch it.

**I13 debris** (user's point, from *The Expanse*: a torpedo shot down still sends its wreckage on).
- A killed torpedo becomes a ballistic cloud. The target takes the share of the cloud its cross-section intercepts, times 0.7 of a hit. Spread 0.03 rad, derived from ~50 m/s sideways separation at ~1.5 km/s.
- Rule test added: killed at 60 m most of it lands; at 400 m a fraction; at 1.5 km almost none; a jink helps.
- Controlled test: close salvos are still poor (from 1.5 km: 0.06 of a hit), because slow, fresh torpedoes die near the launcher and the debris spreads. From 7.5 km: 0.67 of a hit per salvo against a fresh defender. **Torpedoes are the long-range opener.**

**I14 PDC ammunition as a contested resource.**
- PDC ammo cut from 30 to 20 s per mount. Pilots now hold PDC fire to keep a reserve (5 s per enemy torpedo) while the enemy could launch at range.
- Against dry defences, salvos go from 800 m.
- Result: in 29% of fights the winner still had torpedoes left and the loser's PDCs were thin, so the thin-defence launch rule raised torpedo killing blows from 2% to 6%.

**I15 G4 metric correction** (stated openly).
- "Most damage in the final 10 s" favours weapons that hit in big chunks. It had been introduced to stop a PDC scratch getting credit, and it overcorrected.
- G4 now uses the **killing blow**: the hit that took the loser over the line, which is the viewer's "what killed her?". The pass bar is unchanged. Both definitions are printed.
- Damage share at that point: railgun 51%, PDC 35%, torpedo 12%.

**I16 weapon roles** (targets: railgun ~40%, PDC ~30%, torpedo ~25% of damage).
- Torpedoes 6 → 9 then 12; torpedo hull 150 → 200; railgun hull 150 → 120 → 100; PDC ammo 20 → 15 → 17.5.
- PDC ammo sets the balance between torpedo and PDC finishes: at 15 s torpedo 32% / PDC 6%; at 20 s torpedo 16% / PDC 24%.

**I17 railgun ammunition.** Ships fired a median of 6 of 20 rounds, so ammo never bound. At 7 rounds the railgun finished only 39% but time-outs hit 20%; 9 rounds split the difference.

**I18 magazine/kill consistency.**
- Time-outs had ships out of torpedoes and PDC ammo with 58% health left. A full magazine (~1,200 hull expected) couldn't kill a 1,400-hull ship.
- Principle: a full magazine carries ~1.2× what a kill needs. Hull 1,000 → time-outs 0%, but only 10 exchanges and G3 46%.
- Railgun round 3.0 → 2.4 km/s (user's suggestion): endings more balanced (railgun 39 / torpedo 31 / PDC 26). Pilots adapted by firing closer, so hit rates barely moved.
- Everything scaled ×1.25 (hull 1,250, 11 rounds, 12 torpedoes, PDC 22 s) → 13 exchanges.

**I19 shot clock** (the basketball 24-second clock).
- Mirror duelists stalled: both juking, charges venting in step, 48% of their fights going to time.
- Rule: if nothing lands for 15 s, the ship that isn't ahead commits.

**I20 G2 balance attempts, each at 600 fights per pairing.**
- Knife fighter keeps a PDC reserve too: G4 regressed.
- Knife fighter always runs the gun hot inside 2 km: knife dominant (62–70%). Overcharge at close range is strongly +EV.
- Overcharge softened (1.35×, 35%): knife still dominant, G3 fell to 49%.
- Counterpuncher holds every salvo for a window: counterpuncher collapsed to 25%.
- Knife fighter runs hot only when not ahead: knife 59–65%.
- Ablation SLASH=off: the duelist still beats the knife fighter 60–40, so the knife doctrine's weakness is its own.

**Finding:** with one loadout the ships are physically identical at every range, so a doctrine wins only by decision quality. The knife fighter's premise ("close range favours the aggressor") is false under these rules. Any rule that makes it true is one every pilot should use.

**State** (600 fights per pairing):
- G1 PASS (77 s), G3 PASS (51%), G4 PASS (railgun 37 / PDC 33 / torpedo 25), G5 PASS (13), G6 PASS (16%), G7 PASS (lazy styles lose at least 92%).
- **G2 FAIL:** the duelist beats the counterpuncher 56% and the knife fighter 62%. Overall 55 / 50 / 46.


## I21 the fight reaches inside the ships (user: crew should die sometimes; systems rarely take damage)
New diagnostics per side: `part_loss_t`, `crew_hit_death_t` and `parts_damage`, scored by `python3 python/duel/insides.py`. Experiment knobs come from the environment (SK_<NAME>, `params::tune`); sweeps use `python/duel/sweep_insides.sh`.
- **Targets:** crew killed by fire mid-fight (more than 5 s before the end) in ≥40% of fights; systems lost mid-fight in ≥80%, median ≥2; the spectacle gate holds.
- **Baseline:** crew 49% (0.62 per fight); systems 44% (median 0); component damage a median 7.8 part-healths per fight, spread thin and repaired. Crew took only 0.6× a hit's damage, so no single round could kill.
- **Rail spall** (damage radius widening inside the hull, 0.2 m per m) is too blunt: reactors gutted, dead in space 56%, railgun finishes 73%, G1 and G4 fail. Rejected.
- **Crew harm 1.0 (a round through a compartment kills), with components at dmg/120 (was /200):** crew 76%, systems 97% (median 4); G1/3/4/5 pass and G3 rises to 58%.
- **Adopted, plus PDC penetration** (6% of PDC hull strikes get inside: 60 damage along a line toward the spine, radius 1.2 m, so PDC fire can kill crew). At 300 fights per pairing:
  - crew killed mid-fight in 82% of fights (1.6 per fight); systems lost in 98% (median 4);
  - losses by part: drive 38%, sensors 14%, bow thrusters 14%, reactor 5%, railgun 4%, …;
  - G1 89 s, G2 PASS (49 / 52 / 48), G3 61%, G4 PDC 33 / railgun 32 / torpedo 27, G5 15; G6 1% (was already failing at 2%).
- The railgun test now states the new rule: a round straight through a component knocks it out (the engineer can repair it).


## I22 desynchronising the mirror (user: both AIs do about the same thing at the same time; torpedoes always in threes, always together)
Measured by `python3 python/duel/sync.py`: the share of one ship's salvos (±3 s) and railgun shots (±1.5 s) matched by the other's, against a control that shifts the other ship's timeline circularly by a random offset.
- **Baseline:** salvos 4.07× chance (72% vs 18%); first salvos within 1 s in 96% of fights (median gap 0.0 s); railgun 1.44×; every salvo a simultaneous three.
- **Cause:** identical rules on a shared variable. Both see the same range, so both cross the salvo band on the same tick; tubes reloaded together, so the two stayed phase-locked.
- **Launcher:** four tubes, each reloading on its own. The pilot chooses how many (`torp_count`) and the gap between launches (`torp_ripple`; a ripple leaves from wherever the ship is at each launch).
- **Salvo policy:**
  - size from the target's point defence: mounts that can bear on our bearing (arc against orientation) plus a salvo doctrine;
  - a screen our own torpedoes heated gets everything loaded, rippled;
  - dry PDCs get singles;
  - badly behind: empty the tubes.
- **Ripple** when their screen is hot or short of ammunition, when it's a follow-up to our own salvo within 12 s, or on a long shot for pilots who lean that way.
- **Temperament per pilot** (seeded; `TEMPER=off` for the control):
  - a preferred launch range in the band (fire within ±700 m of it, or anywhere once lingering past patience);
  - salvo doctrine: thrifty (probes of 1–2) / balanced / heavy;
  - ripple lean;
  - gunner's reaction (0.1–1.6 s);
  - patience for a weak side (1–7 s);
  - railgun odds ±0.08;
  - a 4–8 s gap before a follow-up.
- **Findings along the way:**
  - My launcher rewrite first dropped the railgun cooldown countdown (one shot per fight); fixed.
  - Arc coverage rarely varies because railgun ships face each other, so the salvo doctrine carries the size variety.
  - Thrifty salvos first merged into fours: the other tubes fired on the next frame. The follow-up gap fixed it.
  - "Hot screen" salvos synced when both screens heated in a PDC brawl; now only our own torpedoes' heat counts.
  - A narrow launch window halved torpedo use (4.2 fired); the lingering rule restored it.
  - A 16-torpedo magazine didn't bind (6 of 16 used), so it stays at 12.
- **Result, 300 per pairing:**
  - salvos 2.49× chance (37% vs 15%); first salvos within 1 s in 17% of fights (median gap 3.7 s); railgun 1.45× (mostly return fire, a duel beat — left alone);
  - salvo sizes 1: 38%, 2: 27%, 3: 18%, 4: 16%; rippled 29%; 2.7 salvos and 5.7 torpedoes per ship;
  - G1 100 s (time-outs at the 10% line), G2–G5 pass (G3 65%), G6 fails as before;
  - crew killed mid-fight in 88% of fights, systems lost in 98%.
- **Residual salvo sync** is structural: every launch rule keys on the one shared range, which the circular-shift control ignores. Card re-recorded; viewer audit 12/12 on every criterion.


## I23 the railgun misses (user: shots almost never miss)
- **Diagnosis** (`python3 python/duel/rail.py`): 90% of shots hit. The median shot is at 1.7 km with 0.67 s of flight, so a target on RCS can drift ~3 m against a 12 m radius. 82% of shots were rated ≥0.9 and hit 97%. Nothing modelled aim error: the gun was perfect at fighting range.
- **Mechanism: fire-control dispersion.** A spinal gun is aimed by pointing the ship, so the round scatters (per axis) by 1 mrad base + 0.02 per rad/s of the shooter's rotation + 0.002 per g of its sideways acceleration; ×2 with the sensors out, ×1.5 without a working gunner (`Ship::rail_sigma`).
- **Fire control's estimate includes it** (a 2-D normal against what's left of the ship's width), so shot selection stays honest, and firing while manoeuvring is a real trade.
- **Sweep, at 100 fights per pairing:**
  - 1/0.02/0.002: hit 67%, time-outs 13% (G1 fails);
  - 2/0.04/0.004: 62%;
  - 4/…: 54% and G2 fails.
- **Pace:** fewer hits slowed fights. To keep expected rail damage per shot (100 × 0.90 / 0.67 ≈ 134), RAIL_HULL goes 100 → 135. Ammo doesn't bind (4.7 of 11 fired).
- **Result, 300 per pairing:**
  - hit 65%; calibration: rated 0.6–0.9 → 75% hit, ≥0.9 → 96%;
  - by range: <1.5 km 77%, 1.5–3 km 49%, 3–4.5 km 31%;
  - G1–G6 all PASS (G6 6%, first pass since I15);
  - crew killed mid-fight in 76% of fights, systems lost in 89%;
  - railgun shots coincide 1.86× chance (more return fire), salvos 2.37×.
- Test `rail_shot` turns the scatter off (`World::rail_scatter`): it tests hit geometry, not gunnery.


## I24 no time limit; ramming; both disabled (user: remove the time-out ending; ships out of ammo ram; end only if both are truly disabled)
- The time limit is gone (`time_limit()` is a knob, unbounded by default). The batch harness has a 1-hour watchdog that records "unfinished" (G1 now wants none).
- **Measured first, with a 20-min cap:** 35 of 600 fights (6%) were still going. None were out of ammo: all had railgun rounds. It was a behavioural deadlock, 1,000+ s of one ship in "guns" and the other in "juke":
  - the juker kept evading while the enemy gun was merely *able* to fire (charge 0), and timed its own charge to the enemy's, so it waited;
  - the shooter only charged against an exposed target, and a juking one never is;
  - the stall-commit rule lowered the shooter's odds but not its charge condition.
  - (Frequent crew deaths — pilots and gunners — made the slow cycles likelier.)
- **Fixes:**
  - a juke ends when the enemy's charge is >2.5 s from ready and nothing is in flight;
  - a committing ship charges whatever the target is doing.
- **Ramming:** a ship with no usable ranged weapon (rail rounds on a fixable gun, or torpedoes on a fixable launcher; fixable = working or a live engineer) intercepts on lead pursuit at up to 12 g with RCS nulling the miss, no collision avoidance, all PDC ammunition free.
  - Prow-first strikes are asymmetric (rammer 0.5×, rammed 1.5×; head-on or glancing 1×).
- **Both disabled:** if neither ship can hurt the other (no ranged weapon, no PDC ammunition on a fixable mount, no fixable drive, reactor and live pilot to ram with), the match ends, decided on condition (a draw within 0.05).
- **Result, 300 per pairing, unbounded:**
  - every fight ends; median 87 s, 95th percentile 187 s, max 371 s;
  - endings: destroyed 1,783 / dead in space 15 / crew dead 2; killing blows railgun 37%, PDC 36%, torpedo 26%, ram 1%;
  - G1–G6 all PASS; railgun hits 63%; crew killed mid-fight in 78% of fights, systems lost in 90%.
- Card re-recorded; the viewer shows RAMMING! on the plate with a radio line, and a "both disabled" result.


## I25 fast starts (user: matches start slowly; start with velocity and random but vaguely facing vectors)
- Ships start 120–320 m/s, velocity within 45° of the line to the other ship, nose within 30° (START_SPEED / START_HEADING / START_FACING). They were nearly at rest (0–40 m/s) with noses within ~15°.
- First salvo median 13.1 → 7.8 s (10th–90th percentile 8.6–21.0 → 4.8–16.6). First damage median 25.4 → 19.2 s (90th percentile 50.5 → 25.3).
- 300 per pairing: G1–G6 all PASS (median 85 s, 95th percentile 193 s, all fights end, max 379 s). Railgun hit 61%; salvos 2.26× chance; crew killed mid-fight in 78% of fights, systems lost in 87%.
- Card re-recorded.
