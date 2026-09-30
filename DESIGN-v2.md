# Speed Kills v2 — combat and broadcast design (draft for review)

A clean-sheet design. The physics core, the scripted-pilot approach and the broadcast tooling
carry over; the orbital stage, the gunsight contest and the current missile/fog rules do not.
Inspiration: the ship combat of *Leviathan Wakes* — torpedoes against point defence, keel guns,
high-g burns, stealth and sensor games, ships that come apart system by system.

---

## 1. Pillars

1. **Every exchange asks one clear question**, with a countdown to the answer. *Will the salvo
   get through the point defence? Can she get off his gun's axis before it charges? Who fires
   first at knife range?*
2. **Every tool has a job and a counter.** Tactics matter because the counters are mechanical,
   so a pilot's choices genuinely decide fights — nothing on screen is decoration.
3. **Fights change as ships break.** Damage takes out specific systems, and a wounded ship
   fights differently. Comebacks and cripple-hunts come from the rules, not a script.
4. **Big moves cost something.** Hard burns punish the crew; torpedoes are few; point defence
   runs dry; going loud gives you away.
5. **Legible above all.** A viewer who has never seen the game should know, at any moment, who
   is hunting whom, what is about to happen, and why it happened. Full 3D, made readable.

---

## 2. The arena

- **Open 3D space, no orbital gravity.** High-thrust Newtonian flight: momentum is conserved,
  turning your nose doesn't turn your velocity, and burns are the only way to change course.
- **Scale compressed for drama:** matches are **1–3 minutes**. Ships start about 8–10 km apart;
  torpedo flights last 10–20 s; knife range is under 1 km. Something decisive happens every
  10–20 s.
- **Terrain gives the space shape** (one arena type per match, varied across a broadcast):
  - *Station:* large, armed or neutral; blocks fire and sensors; "can't shoot here without
    hitting the station" is a real tactic.
  - *Asteroid field:* clusters of rocks for cover, ambush and breaking locks.
  - *Wreck field:* debris that blocks torpedoes and hides cold ships.
  - *Open space:* pure manoeuvre.
- **No walls.** Space is open and the camera follows the pair. A fight is local, though: if the
  ships stay more than 15 km apart for 10 s the fight is **broken off**. The side that has been
  burning away from the other (over the last ~30 s) forfeits; if both were, nobody wins. The
  broadcast shows it as a countdown ("disengaging… 8… 7…"). Scripted pilots are kill-seeking and
  never run, so in practice this only catches crippled ships drifting away.

---

## 3. Ships

**One ship design and one loadout for now** (sponsor variants later). Each ship is a set of
**components**, each with its own health and a clear effect when damaged or destroyed:

| Component | Does | Damaged → | Destroyed → |
|---|---|---|---|
| **Drive** | main thrust along the nose (sustained ~3 g, burst to ~10 g) | lower max thrust | no main thrust (manoeuvre on RCS only) |
| **RCS thrusters** (4 clusters) | rotation and translation | a cluster lost = slower turning / strafing that way | — (each cluster independent) |
| **Reactor** | power for everything | reduced PDC rate, slower railgun charge | ship dead in space (mission kill) |
| **Sensors** | radar/ladar (active) and IR (passive) | shorter range, worse tracks | blind beyond visual range |
| **PDC mounts** (3, fixed arcs) | automated close defence and close attack | lower rate/accuracy | that arc undefended |
| **Torpedo launcher** + magazine (4–6) | long-range guided attack | slower reload | no torpedoes |
| **Railgun** (spinal, fires along the nose) | the big close-range gun | longer charge | no railgun |
| **Hull** | structure; everything's container | — | breakup: kill |

- Hits land where they land: a torpedo from below and astern hurts the drive; a railgun round
  through the bow may take the railgun itself.
- **Kill** = hull destroyed, or the whole crew dead. **Mission kill** = no drive and no weapons,
  or reactor lost; the match ends in the attacker's favour.

### 3.1 Crew
Ships are **crewed, and crew can die.** Four named crew per ship, each at a station in a
compartment of the hull:

| Station | Does | If injured | If killed |
|---|---|---|---|
| **Pilot** (the captain) | flies, chooses the plan | slower, sloppier manoeuvres | the ship flies on autopilot: competent but predictable and never takes risks |
| **Gunner** | railgun and torpedo launches | slower charge and launch decisions | weapons fire only on the autopilot's rules |
| **Engineer** | damage control and the reactor | slower repairs | no repairs; reactor damage can't be managed |
| **Ops** | sensors, jamming, chaff, dazzle | weaker electronic warfare | no electronic warfare |

- **Hits kill crew by location:** a round through a compartment can kill whoever is in it, so
  where a ship is hit matters twice.
- **The juice and g-tolerance:** crash couches and drugs let crews survive what would otherwise
  kill them, but the body still has limits, and they follow real physiology: the danger is
  **g × duration**, and it climbs steeply with g.

  | Sustained acceleration | On the juice |
  |---|---|
  | up to ~4 g | safe indefinitely |
  | 4–8 g | safe for tens of seconds; fatigue builds, reactions slow |
  | 8–12 g | seconds to tens of seconds; blackouts likely, injury risk rising |
  | 12–20 g | a few seconds; strokes, hemorrhage, injury likely, **deaths begin** |
  | above 20 g | lethal to most of the crew within a second or two |

  Each crew member tracks a **g-dose** (how much punishment they've absorbed and how recently),
  with some variation person to person, and recovers slowly at low thrust. Blackouts make the
  ship briefly predictable; coming down off the juice leaves crew slower for a while.
- **Choosing to go past it:** the drive can overburn well beyond what the crew survives (to
  ~25 g, at a risk to the drive itself). A captain may **deliberately order a lethal burn** —
  when it's the only way to escape a torpedo, get off a railgun's axis, or save the ship from
  destruction — knowing it may kill some or all of the crew. Pilots decide by character: some
  never will, some do it to save the ship, some would do it to win. The broadcast shows the g
  climbing against the crew's limits in real time, and the cost when it's paid.
- **Engineers repair mid-fight:** a damaged component can be patched over seconds (not while
  under heavy g), which gives wounded ships a way back and makes killing the engineer a target.
- Crew deaths are announced on the broadcast with the crew member's name. It keeps the stakes
  human and gives every match a story.

---

## 4. Weapons and their counters

### Torpedoes — the long arm
- Six in the magazine, fired by **three tubes as a salvo**: the tubes reload together (12 s).
  **Guided** by proportional navigation; they home on the target and manoeuvre hard at the end.
- A salvo flies spread a few hundred metres apart (so one burst's shrapnel can't take two), and
  closes up *before* PDC range, so it all arrives together and at full speed. A single torpedo
  rarely beats three PDCs (~5%); a full salvo gets at least one through ~45% of the time against a
  fresh defender.
- **Launch is loud** (plume + motor). The target knows one is coming and from where.
- **Countered by:** point defence (the main answer), jamming (weakens their guidance at range),
  chaff and decoys (a torpedo may take the bait), terrain (a rock between you and it), and
  cold running (it may lose you).
- **Win by:** saturation, surprise (launch close, from behind cover, or from a cold ship), or
  timing (while the PDCs are busy or damaged).

### Point defence cannons (PDCs) — the curtain
- Automated turrets on three fixed arcs; engage incoming torpedoes and anything close.
- **Limited:** each mount engages one threat at a time, has finite ammunition, and overheats on
  long bursts. A torpedo destroyed close still sprays shrapnel.
- **As offence:** at knife range PDC streams shred a ship's systems.
- **Countered by:** saturation, attacking through an undefended arc (after a mount is lost, or
  from the angle the ship's own hull blocks), and erratic manoeuvring when they're shooting at
  *you* at close range (their tracking must keep adjusting).

### Railgun — the knife
- Fires only along the ship's nose. A **2.5 s charge** that everyone can see; the capacitors
  **hold a full charge for only 4 s**, after which the gunner must fire or the charge vents
  (and the gun is down ~4.5 s). Every charge is a countdown with one question: *fire, or lose it?*
- The round is fast but **not instant: 3 km/s**, so ~1 s of flight per 3 km. A crew sees the
  flash and reacts after ~0.25 s. That makes range the decision:
  - **Aiming means pointing the drive along the line of fire**, so a ship holding its aim can
    only jink on RCS (2 g). Beyond ~4 km an aimed, jinking ship is a guess; inside ~2 km anything
    aimed is a sure kill.
  - A **full drive juke** (8–11 g sideways) makes a ship very hard to hit down to ~2.3 km — but
    it gives up its own aim and spends the crew's g-dose.
- **Pointing is a threat:** to use it you must aim your whole ship, telegraphing it.
- **Countered by:** jinking and juking (above), timing (make them fire or vent at a juking target,
  then go in while their gun is down), cover, and killing it (it's a component).
- **Win by:** initiative — being charged, settled and aimed when they're exposed (nose-on, not
  juking, or turning back) — and punishing the reload window after they miss.

Measured in the sanity gate (400 reference-vs-reference fights): 2.7 shots per fight; hits 99% under
1 km, 90% at 1–2 km, 68% at 2–3 km, 61% at 3–4 km, 33% at 4–5 km.

### The web
Torpedoes force PDC use and defensive manoeuvring → which spends ammo, heat and the crew's g-dose → which
opens the ship to the railgun at close range → which forces closing distance → which makes
torpedoes launched close unstoppable. Every link has a counter; no single tool wins alone.

---

## 5. Sensors and signature

- **Signature has three states**, always shown:
  - **Loud:** drive burning (the plume is visible across the arena) or weapons firing.
  - **Warm:** reactor up, drive off (detectable at moderate range by IR).
  - **Cold:** reactor idled, heat stored in sinks. Hard to see. Weapons and PDCs can't fire;
    manoeuvre is RCS only; heat sinks fill over time, forcing you to come back up.
- **Active sensors** (radar/ladar) give precise tracks and weapon locks — and light you up for
  everyone.
- **Painting:** a lock is visible to the target. You always know when you're being targeted,
  and so does the audience.
- **Electronic warfare:** jamming (degrades locks and torpedo guidance at range), chaff (breaks
  locks, lures torpedoes), comm-laser dazzle (blinds a targeting system for a few seconds at
  close range).
- **Stealth is a tactic, not a mode of play:** go cold behind a rock, let them lose you, come
  up loud behind them. Coming back online is a reveal — a great broadcast moment.

---

## 6. The cost of hard manoeuvres

- The drive can deliver far more than the crew can take (see 3.1). Every hard burn adds to
  the crew's g-dose: fatigue, blackouts, injury, and at realistically high g, death. Sustained
  overburn can also damage the drive (tearing a strut).
- The ultimate trade is a burn that kills crew to save the ship, and it's always available.
- So evasion is a decision: dodge this torpedo hard now, or keep the crew fresh for the railgun
  duel you know is coming.
- Propellant is plentiful enough that fights aren't decided by running dry, but not infinite.

---

## 7. How a match flows

No fixed rhythm — phases emerge from the pilots' choices:

1. **Contact:** ships enter from different points; sensors, signatures and terrain decide who
   sees whom first.
2. **The long game:** torpedo exchanges at range, jamming, PDCs working, pilots positioning.
   Usually survivable — it spends resources and damages systems.
3. **The approach:** someone decides to close. Through PDC fire, on a line that stays off the
   enemy's gun axis, maybe using a rock.
4. **The knife fight:** railgun charges, PDC streams, close torpedo launches, desperate turns on
   damaged thrusters. Decisive and fast.
5. **Resolution:** a kill, a mission kill, or a disengagement that resets to the long game with
   both ships worse off.

A match lasts **1–3 minutes** and ends with a kill, a mission kill, or a points decision at the
time limit (crew alive, systems working, hull remaining). The only objective is winning the
duel.

---

## 8. Scripted pilots

- Pilots choose **plans** that exploit specific mechanics, each with a visible label and radio
  callouts: *saturation strike, cold ambush, torpedo bait, knife run, gun duel, disengage and
  repair, cripple hunt, finishing run*.
- **Character** comes from preferences and flaws: aggression, patience, risk appetite with
  the juice, torpedo discipline, preferred range, precision of timing, how damage changes their
  behaviour.
- **Every tactic must earn its place:** before it goes in, a minimal version must show it changes
  fight outcomes in the situations it's for. Anything that doesn't is decoration and stays out
  (or reveals a rule that needs fixing).
- **Sanity gate for the rules themselves:** before pilots are built, the laziest strategies
  (fire everything at once, never close, always stay cold, always run) must all lose to a
  sensible opponent.

---

## 9. Presentation: a stylized broadcast in full 3D

Realistic physics underneath; a designed presentation on top — the ships' own tactical displays
made into television. (The novel tells its fights this way: threat boards, red dots,
highlighted PDC streams.)

### 9.1 Visual language
- **Two team colours** for ships and everything they own. **One threat colour** (red) reserved
  for anything about to hurt someone.
- **Ships** drawn at a constant, generous size, with a clear silhouette that shows orientation;
  the real distance is shown by range rings and numbers.
- **Torpedoes:** bright motes with short ribbon trails; red when locked and inbound.
- **PDC fire:** streams of glowing beads from each mount; the chains show direction and spread.
- **Railgun:** when charging, a thin line along the ship's nose extending through space (so you
  see whether the target sits on it), brightening with the charge; firing is a flash and a
  streak.
- **Signature:** loud ships pulse with a plume glow; warm is steady; cold ships are drawn as a
  faint outline with a frost-blue edge.
- **Painted:** a lock is a thin line from hunter to target plus a ring on the target.

### 9.2 Depth, made legible
1. **The fight plane with drop lines:** a faint grid through the fight (best-fit through both
   ships, drifting slowly). Every ship and torpedo has a stalk to the plane ending in a
   footprint — footprint = where on the plane, stalk = how far above or below.
2. **Always-moving camera:** a slow, steady drift around the fight, so objects at different depths
   slide past each other. Never spinning; never still.
3. **Director framing:** never looks along the line between the ships; frames the fight across
   it, both ships always in frame, widening to include inbound torpedoes. No zoom-ins.
4. **Depth styling:** nearer things brighter, crisper, more saturated; farther ones hazier.
5. **Geometry callouts for key moments:** inbound torpedo — range, closing speed, above/below
   chevrons with metres; gun lining up — its axis through space and the target's miss distance
   from it; salvo vs point defence — the PDC arcs drawn around the ship.
6. **Inset side view:** a small elevation projection, brought up by the director for moments
   where height matters, hidden otherwise.
7. **A fixed key light** so ships' shading shows their orientation.

### 9.3 Broadcast furniture
- **Ship cards** (one per side): a silhouette with each component coloured by health, the four
  crew by name with their state (fit, injured, blacked out, dead), torpedo count, PDC ammo, the
  crew g-dose meters, and the live g against their limits, signature state, current plan.
- **Clock and match phase**; a hull and systems tug-of-war.
- **Radio chatter** as captions: short callouts from each crew member by name ("one away", "fast
  movers", "going defensive", "PDCs dry", the engineer calling a patch).
- **Slow-motion** for the defining moments — a salvo entering the PDC envelope, a railgun charge
  completing — plus kill replays from a second angle. No zoom.
- **What it's doing and why:** the current plan is always shown, and a one-line explanation
  appears when a tactic pays off ("RED's saturation: 4 torpedoes vs 2 working PDCs — one
  through").

---

## 10. Three fights on paper

**A. The saturation strike.** BLUE hangs back at 8 km and fires single torpedoes; RED's three
PDCs swat them down while RED closes. At 4 km BLUE fires the rest of its magazine at once,
angled from below, where RED's ventral PDC was damaged by the second torpedo's shrapnel. Two
of four get through; one takes RED's drive. RED is now on RCS only — slow to turn — and BLUE
comes in for the railgun. RED's answer: go cold, drift, and wait for BLUE to overshoot inside
PDC range. The viewer sees each step coming: the PDC arcs with the hole in them, the salvo's
geometry, the drive going red on RED's card.

**B. The cold ambush.** In an asteroid field, RED burns loud into the rocks, then goes cold behind
a large one. BLUE loses the track and sweeps with radar, lighting itself up. RED waits, heat
sinks filling, until BLUE passes the rock's edge, comes up hot, and launches two torpedoes at
1.5 km — too close for BLUE's PDCs to stop both. The broadcast shows RED's frost outline, the
heat-sink meter filling (tension), BLUE's radar sweep, and the reveal.

**C. The gun duel.** Both ships out of torpedoes, closing at 400 m/s. Each tries to get the other
onto its axis while staying off theirs; railgun charges telegraph every commitment. BLUE's
port RCS was shot out, so it turns slowly to the left — RED knows it and circles that way.
BLUE bets on a hard burn to flip the geometry; its pilot takes the juice past the limit and
blacks out for two seconds just as the gunner fires on RED's charging gun. The inset side view shows BLUE diving 60 m below RED's axis with half
a second to spare.

---

## 11. What carries over, what goes

- **Keep:** the deterministic sim core and fixed timestep, the component-free ship physics as a
  base, the recording/replay tape and moment detection, the broadcast director (pacing, slow-mo,
  replays), the dashboard and diagnostics, scripted-bot infrastructure.
- **Drop:** the planet, orbits, atmosphere and skipping, zones, the orbital-bullet driver, the
  gunsight and current missile guidance, the current fog-of-war rules (replaced by §5), the RL
  training loop as the engine (kept on the shelf).

---

## 12. Decisions

1. **Loadout:** one design, one loadout for now.
2. **Crews:** crewed ships, and crew can die (§3.1).
3. **Objectives:** none beyond winning the duel, for now.
4. **Match length:** 1–3 minutes.
5. **Design authority:** design choices are made against the goal (a dynamic, thrilling,
   legible broadcast duel), backed by gate data, and reported rather than put up for sign-off.
6. **Pilots want the kill more than survival.** Scripted pilots never run and never back off;
   at most they hold their range while the enemy's gun is up.
