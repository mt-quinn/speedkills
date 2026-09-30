# Speed Kills — Design

A 3D gunship-duel sport around a planet, flown by reinforcement-learning agents and presented
as a live spectator sport (play-money betting, sponsor-designed ships).

## Laws

1. **Momentum is real and every force has a reaction** — recoil included.
2. **If a viewer can't read it, it doesn't exist.** Every meaningful state is visible.
3. **Killing is the point.** Survival is only a tool for getting the kill.

## The arena: one planet

- Planet radius 150 m, immovable, inverse-square gravity (GM 640,000; surface g ≈ 28 m/s²).
  A circular orbit at 400 m is ≈ 40 m/s with a period of about a minute.
- **Hitting the planet is lethal.** A thin **atmosphere** (45 m, exponential density, 12 m scale
  height) brakes (drag ∝ ρv²), heats the hull (∝ ρv³), and barely slows slugs.
- **Skipping is the refuel.** Ships are lifting bodies: flown nose-first into the airflow, the
  belly makes lift across it (lift/drag ≈ 4). Belly to the planet and the ship skips back out,
  even from a dive aimed below the air's floor; belly away and it digs in; broadside there's no
  lift and 2.5× drag, and a deep pass goes into the ground. While in the air the ship **scoops
  propellant** ∝ ρv (4× nose-first vs broadside), up to a full tank. A good skip from a 500 m
  high point returns 25–35% of a tank for ~4% hull and drops the high point (aerobraking) — the
  only way to get propellant back, and a predictable, low, slow line an enemy can shoot at.
- **Safe zone** 800 m; beyond it three 200 m bands burn hull at 8 / 30 / 120 per second.
- **Sudden death** from 2:30: the safe zone contracts to 320 m by 4:00. At the bell the higher
  hull fraction wins on points (a much smaller prize than a kill).
- Ships start on eccentric orbits (low point 230–360 m, high point 620–760 m) a quarter-orbit
  apart, in different planes: every lap has a slow high stretch and a fast swoop low.
- Ten asteroids in their own orbits: moving cover that blocks rounds.

## Sensing: information is the contested resource

- **Seen** means line of sight past the planet, and either within **300 m**, or at any range
  while **loud**: main engine lit, firing (the muzzle flash), glowing in the air, or being hit.
  **Strafe thrusters are quiet**: a cold ship can bend its trajectory unseen, slowly (~0.65 g).
- **Out of sight**, a ship knows only where the enemy would be had it coasted since its last
  sighting, inside an uncertainty bubble of ½·a·t² (strafe acceleration while in line of sight;
  the main engine too once it has been behind the planet). Enemy fuel, ammo and attitude are as
  last seen; its hull is always known.
- **Rounds are dark**: an enemy round is visible only within 300 m of you. The flash shows who
  fired and from where, not which of the orbital firing solutions (short hop, long lob, the way
  round the planet) the round is on — so dodging is a read, and salvos can close every exit.
- Everything a ship decides from (observation, fire control, the scripted bot) is computed from
  the world *as it perceives it*; physics and rewards use the truth. Audit tests check that
  moving a hidden enemy leaves the observation bit-for-bit unchanged.

## Ships: uncrewed robot gunships

Robots survive violent acceleration, so engines pull 5–8 g — but propellant is scarce (~350 m/s
of delta-v, a few seconds of full burn per match). Fights are coasting orbits punctuated by
short decisive burns; burning makes you unpredictable, coasting makes you a target.

Resources are separate and readable: **hull**, **propellant** (the ship lightens as it burns;
rotation is free), **ammunition** per weapon (part of the ship's mass).

Verbs: main engine (dead-zoned: off unless deliberately on), strafing thrusters (~1 g, for
dodging), attitude via a flight computer (per-design turn-rate limit), and one weapon:

- **Mass driver: orbital bullets.** Slow, heavy slugs (90–150 m/s muzzle speed, comparable to
  orbital speed ~40 m/s) that become orbital bodies of their own: every shot curves around the
  planet and lives 90 s — long enough to come all the way round, onto its owner too. Few rounds
  (8–16), multi-second reloads, real recoil (1–3 m/s: firing changes your own orbit).
- **Damage is the relative impact energy** (½ m v², 400 J per hull point, minus armour), so a
  shot into an opposing orbit is devastating and a stern chase is a glancing blow.
- **Proximity fuze.** A round passing within 15 m of a hull bursts at its closest point, for
  0.6 × (1 − gap/15 m)² of a direct hit's energy (armour still applies). Near misses matter, and
  a dodge has to buy real distance — a flick of the strafe thrusters isn't enough.
- Rounds give seconds of warning, so an alert target can dodge — but every dodge costs
  propellant. Fights become a war of attrition on fuel: force dodges, then kill — or catch the
  enemy on the skip it needs to refuel.

| Design | Identity |
|---|---|
| **Lancer** | Heavy, armoured (40/hit), slow to turn; 30 kg slugs at 150 m/s, 8 rounds, 4 s reload |
| **Hornet** | Light, agile (6 rad/s), thin hull; 12 kg slugs at 90 m/s, 16 rounds, 1.5 s reload |
| **Warden** (the one design in training) | Balanced; 14 kg slugs at 180 m/s, 30 rounds, 6 s reload; 700 kg propellant (~600 m/s), 4.6 g engine, 0.65 g strafe |

Ships see a **true orbital gunsight** (the predicted pass of a shot fired along the nose now:
distance, time, miss direction, impact speed), an **aim hint** (an iterated orbital firing
solution), both orbits, and the **predicted closest approach of every incoming round**.

## Rewards (built around the kill)

| Event | Reward |
|---|---|
| Kill | +3 (full credit for the killing blow or a forced error — enemy damaged in the last 15 s; a quarter for an unforced crash) |
| Being killed | −1 |
| Damage dealt / taken | +1.0 / −0.3 per fraction of hull |
| Every shot, by its closest pass to the enemy hull | +0.3 × (1 − d/50 m)² — a hit earns the full 0.3 on top of damage; 5 m ≈ 0.24, 15 m ≈ 0.15, 30 m ≈ 0.05 |
| Win on points at the bell | +0.2 (paid by the loser) |
| No kill by the bell | −0.5 to both |
| Aiming scaffold (early training only) | potential-based on the gunsight, 0.5 → 0 over 20 M steps |
| Refuelling scaffold (early training only) | +1 per full tank scooped from the air, 1 → 0 over 30 M steps |

## Training

- PPO, one design-conditioned policy for all three ships; observations in the body frame.
- Opponents: scripted bots (60% → 10%; they don't shoot at first and get their guns over
  15 M steps), self-play, and a pool of past generations.
- Discount 0.999 (~50 s horizon at 20 decisions/s), GAE λ 0.97.
- Every `gen_every` updates a **generation** is frozen, evaluated (vs bots + earlier
  generations), rated (Bradley–Terry on the Elo scale, bot = 1000), scored for excitement,
  and recorded as replays. Generations are permanent: promote any one as the **champion**
  (`models/champion.pt`), or fork a new run from it (it inherits the league up to that point).
- Hardware: M1 Mac, 8 cores. ~11–13k learner decisions/s. Fire-control predictions are
  computed once per decision and shared by observations and rewards; the aim hint refreshes
  every 0.5 s; at most 3 past generations are active opponents per update.

## Spectator layer (in the viewer today)

Hull/fuel/ammo HUD, each loaded ship's firing line, every slug's predicted orbital path, ghost trajectories with per-second ticks, full
orbit loops, zone silhouettes, altitude gauges, hull-advantage graph, commentary feed, stable
director camera, replays with scrubbing.

## Excitement score (0–100, per match)

Hits and near-misses, lead changes, time within 400 m, decisive endings,
comebacks, atmosphere use and rams; unforced zone deaths are penalized. Deliberately simple and
documented in `crates/sim/src/rl.rs` so it can be argued with.

## History

An earlier mass-economy design (throwing your own mass, tethers, fields, scooping) is archived
in `archive/mass-economy-v0/`.
