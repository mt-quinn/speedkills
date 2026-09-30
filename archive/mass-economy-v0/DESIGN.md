# Speed Kills — Design

A 3D ship-duel simulator built for reinforcement-learning agents to fight each other,
presented as a live spectator sport (play-money betting, sponsor-designed ships).

## Two laws

1. **Momentum is real and every force has a reaction.** That is the only physics promise.
   Ships may be as strange as we like, as long as every push pushes back.
2. **If a viewer can't read it, it doesn't exist.** Every meaningful state is visible as
   motion, shape, size, or light. No hidden stats.

## Core mechanic: mass is everything

A ship is a lump of mass. That mass is simultaneously **health, fuel, and ammunition**.

- **Thrust** ejects mass out the back (rocket equation; exhaust velocity per design).
- **Throw** — charge a slug of your own mass at the nose and hurl it. Recoil is real.
- **Damage** is dissipated collision energy. It knocks chunks off you, which become debris.
- **Scoop** — touch debris or a slug gently (low relative speed) and you absorb its mass.
  Catching an enemy slug by matching its velocity is a legal (and glorious) play.
- **Death** — when damage exceeds your reserve mass (mass above your core), you burst.

Radius is derived from mass, so **size is health** and is readable at a glance.
Fights have a natural arc: heavy, sluggish openings; small, frantic endings; and
comebacks through scavenging the debris the fight has created.

Damage scales with relative kinetic energy, so **speed = danger**, visibly.

## Verbs (every ship has all of them; designs differ in strength)

| Verb | What it does | Reaction |
|---|---|---|
| Main engine | Thrust along nose, burns mass | — |
| Torque | Rotate (isotropic inertia) | Small mass cost |
| Arms | Extend/retract to change moment of inertia (skater effect, angular momentum conserved) | — |
| Throw | Charge & hurl a slug of own mass | Recoil |
| Tether | Harpoon anything; rope constraint; reel in/out; snaps under excess tension | Pulls both ends |
| Field | Cone that pulls or pushes — produces a fixed *relative* acceleration, split by mass | Pull an asteroid and *you* move |

## Arena: the planet (standard layout)

A fight around one planet. Everything orbits.

- **Planet**: radius 150 m, immovable, GM 640,000 (surface gravity ≈ 28 m/s² — stronger than
  any engine, so diving low is a commitment). Circular orbit at 400 m ≈ 40 m/s, period ≈ 1 min.
  Hitting the surface hurts; slugs and debris that hit it are gone.
- **Safe zone**: 800 m from the centre — generous room to fight.
- **Burn zones** beyond it, in 200 m bands: amber 4 kg/s, red 15 kg/s, black 60 kg/s of mass
  burned. Burning out there can kill.
- **Sudden death**: from 2:30 the safe zone contracts to 320 m by 4:00; at the bell, highest
  reserve fraction wins.
- **Ships** start in circular orbits a few hundred metres apart, in different planes.
- **Asteroids** (10) and **scrap fields** (5–7 clusters) sit in their own orbits: moving cover,
  moving tether anchors, a moving economy.
- Slugs fall with you: in free fall, relative aim is barely affected by gravity at short
  range, but long throws and orbital separations curve.

Viewer: lit planet (day/night gives depth), each ship's full predicted orbit, zone boundaries
drawn as true silhouettes, per-ship altitude gauge (planet → safe → amber → red, with orbit
low/high points), a ring where an orbit will leave the safe zone.

The older walled "hazards" layout (wells, nebulae, streams) remains available as
`Layout::Hazards` for variety.

## Archetypes (presets of one parameter vector)

- **Slinger** — long, strong tether, fast reel. Swings around rocks and flings.
- **Anchor** — heavy, slow to turn, powerful field. Sumo: drags you into things.
- **Skater** — light, high torque, big arm inertia swing. Spin-throws, sudden stops.
- *(later)* **Shedder** — sheds armor plates deliberately as reactive thrust/shrapnel.

Sponsors will eventually edit designs within a fixed point budget — money buys
influence, not power. Cosmetics are unlimited.

## Spectator layer (future)

- Live win-probability graph from the agents' critics (doubles as in-play odds).
- Telegraphed wind-ups (charge glow, harpoon aim) → anticipation + counterplay.
- Ghost trajectories, director camera driven by danger (closing speed, tension, swings).
- Agents as characters: lineages, Elo, rivalries, auto scouting reports, highlights.

## Integrity (future)

Matches computed live, seed committed (hash) before bets close and revealed after.
Designs and coaching lock before betting opens. Play money only, always.

## Training plan (future)

- One design-conditioned policy trained across randomized designs (domain randomization),
  then per-design fine-tunes ("training camp").
- League self-play (main agents, exploiters, historical snapshots).
- Personality-conditioned rewards (small style bonuses; winning dominates).
- Quality-diversity archive over behavior descriptors.
- Hardware: M1 Mac (8 cores, 8 GB). Sim must be fast on CPU; policy nets small.

## Sim-health findings so far (bot batches)

- Early: speed exploits (field against asteroids = free drive; winch spin-up; tether attach
  bug injecting energy) — fixed in physics (force-capped field with mass cost, winch force
  limit, solver bias cap).
- Engines were so mass-hungry that flying was suicide → exhaust velocity ~1100–1300 m/s.
- Dominant death was **starvation** (spend reserve to zero, die to a tap) → scrap fields.
- 50% draws → sudden death + decisions.
- Remaining: scripted bots are passive and inaccurate (≈1.5 slug hits/match). That's a bot
  limitation, not a sim one; RL should fix it. Watch for it anyway.

## Roadmap

0. **Sim sandbox** (now): physics core, viewer, scripted bots, human control, batch stats.
   Goal: be confident the sim is fun to watch *with dumb bots* before any RL.
1. Python bindings + vectorized env; first PPO self-play.
2. League, design conditioning, personality.
3. Broadcast/platform.
