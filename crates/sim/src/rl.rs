//! Reinforcement-learning interface: ego-centric observations, a flight-computer action space,
//! kill-first rewards, and per-match "excitement" metrics. Dependency-free; the Python binding
//! (`crates/py`) vectorizes `RlEnv`.
//!
//! Observations are in the ship's body frame (forward = +Z). They include a true orbital
//! gunsight (where a shot fired along the nose now would pass the enemy), an aim hint, both
//! orbits, and predicted closest approaches of incoming rounds — so learning goes into
//! positioning, timing and dodging rather than orbital mechanics homework.

use crate::bot::{Bot, Personality};
use crate::control::{apsides, rate_torque, Approach};
use crate::math::{Rng, Vec3};
use crate::params::{ShipParams, PRESETS};
use crate::sense::{Contact, Knowledge};
use crate::world::{Cause, Event, Input, Kind, MatchConfig, World, FORWARD};

pub const OBS_DIM: usize = 179;
/// Named sections of the observation, in order (sizes sum to OBS_DIM).
pub const OBS_LAYOUT: &[(&str, usize)] = &[
    ("self", 28), ("design", 14), ("enemy", 29), ("contact", 8), ("gunsight", 8), ("aim_hint", 5), ("threats", 60), ("asteroids", 21), ("global", 6),
];
/// [thrust -1..1 (<=0 off), strafe x/y/z -1..1, pitch/yaw/roll rate -1..1, fire 0/1]
pub const ACT_DIM: usize = 8;

const POS: f64 = 500.0;
const VEL: f64 = 100.0;
const K_THREATS: usize = 5;
const K_ROCKS: usize = 3;
/// How far ahead the gunsight and aim hint look (s).
pub const SIGHT_HORIZON: f64 = 25.0;

/// Rewards are built around the kill. Survival is only worth something because it lets you
/// get the kill: dying costs less than killing earns, taking damage costs less than dealing
/// it, and reaching the bell without a kill is a loss for both ships.
#[derive(Clone, Copy, Debug)]
pub struct RewardCfg {
    /// Per fraction of the enemy's hull knocked off.
    pub dealt: f32,
    /// Per fraction of own hull lost to anything (hits, zones, heating...).
    pub taken: f32,
    /// For destroying the enemy. Full credit if you landed the killing blow or damaged them in
    /// the last `KILL_CREDIT_WINDOW` seconds (a forced error); a quarter if they just crashed.
    pub kill: f32,
    /// Penalty for being destroyed.
    pub death: f32,
    /// For winning on hull at the bell (paid by the loser).
    pub decision: f32,
    /// Penalty to both ships when the bell rings with no kill.
    pub stalemate: f32,
    /// Proximity, per second: engage * (1 - d / engage_range)^2 — scaling up as the ships
    /// close (excitement pressure; 0 disables).
    pub engage: f32,
    /// Distance (m) beyond which proximity earns nothing.
    pub engage_range: f32,
    /// Per shot, paid the moment it's fired, by how close its predicted pass comes to the
    /// enemy (against the enemy's current course): shot * q(d), where
    /// q(d) = 0.5 (1 - d/shot_wide)^2 + 0.5 (1 - d/shot_radius)^2 (each term floored at 0).
    /// The wide term gives a gradient from hundreds of metres out; the tight term rewards the
    /// last few. Real hits still earn damage and kill rewards when they land.
    pub shot: f32,
    /// Tight radius (m) of the closeness score.
    pub shot_radius: f32,
    /// Wide radius (m) of the closeness score.
    pub shot_wide: f32,
    /// Aiming scaffold: potential-based shaping on the gunsight (keeps the optimal policy;
    /// annealed to 0 by the trainer). Potential = aim * closeness of the predicted pass.
    pub aim: f32,
    /// Orbit-safety scaffold: potential-based shaping on the orbit's margins (high point inside
    /// the safe zone, low point above the air). Keeps the optimal policy; annealed to 0.
    pub safety: f32,
    /// Refuelling scaffold: per full tank of propellant scooped from the air (annealed to 0 by
    /// the trainer; skimming pays for itself in survival once learned).
    pub scoop: f32,
    /// Propellant potential: phi = fuel * sqrt(propellant fraction). Permanent and potential-based:
    /// running low costs as it happens, refuelling (skipping) pays back what fuel is worth.
    pub fuel: f32,
    /// Per full tank of propellant spent on the strafe thrusters while no enemy round is near
    /// (within CALM_RANGE): always-on jinking that empties the tank.
    pub calm_burn: f32,
    /// Discount used for the potential-based shaping terms (match the learner's gamma).
    pub gamma: f32,
}

pub const KILL_CREDIT_WINDOW: f64 = 15.0;

impl Default for RewardCfg {
    fn default() -> Self {
        RewardCfg { dealt: 1.0, taken: 0.3, kill: 3.0, death: 1.0, decision: 0.2, stalemate: 0.5, engage: 0.005, engage_range: 500.0, shot: 0.2, shot_radius: 50.0, shot_wide: 600.0, aim: 0.0, safety: 0.0, scoop: 0.0, fuel: 0.0, calm_burn: 0.0, gamma: 0.999 }
    }
}

/// Map a policy action to sim input. Thrust and strafe have dead zones so "off" is the easy
/// default: propellant is spent only on purpose.
pub fn decode_action(w: &World, me: usize, a: &[f32]) -> Input {
    let f = |k: usize| (a[k] as f64).clamp(-1.0, 1.0);
    let dz = |v: f64| if v.abs() < 0.5 { 0.0 } else { (v.abs() - 0.5) / 0.5 * v.signum() };
    let rate = Vec3::new(f(4), f(5), f(6)) * w.ships[me].params.max_rate;
    Input {
        thrust: f(0).max(0.0),
        strafe: Vec3::new(dz(f(1)), dz(f(2)), dz(f(3))),
        torque: rate_torque(w, me, rate),
        fire: a[7] > 0.5,
    }
}

fn preset_index(name: &str) -> usize {
    PRESETS.iter().position(|p| p.name == name).unwrap_or(0)
}

fn slug_hp(p: &ShipParams, v: f64) -> f64 {
    0.5 * p.driver.slug_mass * v * v / 400.0
}

/// Orbit normal (unit) of a body around the planet.
fn orbit_normal(r: Vec3, v: Vec3) -> Vec3 {
    r.cross(v).normalized_or(Vec3::Y)
}

/// Expensive fire-control predictions for one ship, computed once per decision (the sight)
/// or refreshed periodically (the aim hint) and shared by observations and rewards.
#[derive(Clone, Copy, Debug)]
pub struct Sight {
    /// Gunsight along the nose.
    pub sight: Approach,
    /// Iterated orbital firing solution (direction, predicted pass).
    pub aim: (Vec3, Approach),
    /// Sim time the aim hint was computed.
    pub aim_t: f64,
}

/// How often the (costly) aim hint is refreshed, seconds.

impl Sight {
    /// Missile fire control from what `me` knows: where the target is relative to the nose and
    /// how long a missile would take. (No ballistic prediction: missiles steer themselves.)
    pub fn compute(w: &World, me: usize, _prev: Option<&Sight>) -> Sight {
        let enemy = 1 - me;
        let (b, e) = (&w.bodies[me], &w.bodies[enemy]);
        let rel = e.pos - b.pos;
        let range = rel.len().max(1e-6);
        let dir = rel / range;
        let fwd = w.forward(me);
        let off = rel - fwd * rel.dot(fwd);
        let closing = -(e.vel - b.vel).dot(dir);
        let t_go = range / (w.arena.missile_cruise * 0.8).max(1.0);
        let blocked = !crate::sense::line_of_sight(w, b.pos, e.pos);
        let sight = Approach { dist: off.len(), time: t_go, miss: off, rel_speed: closing, blocked };
        let aim = Approach { dist: range, time: t_go, miss: Vec3::ZERO, rel_speed: closing, blocked };
        Sight { sight, aim: (dir, aim), aim_t: w.t }
    }

    /// Aiming potential in 0..1. Half is alignment of the nose with the fire-control solution,
    /// smooth from any heading (warmer as it turns toward it); half is how close a shot along
    /// the nose would actually pass the enemy (the last few metres).
    fn potential(&self, w: &World, me: usize) -> f64 {
        let s = &w.ships[me];
        if !s.alive || !w.ships[1 - me].alive || s.ammo == 0 {
            return 0.0;
        }
        let align = ((w.forward(me).dot(self.aim.0) + 1.0) * 0.5).powi(8);
        let close = if self.sight.blocked { 0.0 } else { (1.0 - self.sight.dist / 60.0).max(0.0) };
        0.5 * align + 0.5 * close
    }
}

/// Write ship `me`'s observation into `out` (length OBS_DIM), computing predictions fresh.
/// (Full knowledge of the enemy: for tests and tools.)
pub fn observe(w: &World, me: usize, out: &mut [f32]) {
    let k = Knowledge::new(w);
    observe_with(w, me, &Sight::compute(w, me, None), &k.contacts[me], out);
}

/// Write ship `me`'s observation using precomputed fire-control predictions.
/// `w` is the world as `me` perceives it (Knowledge::perceived); `contact` is what it knows of
/// the enemy.
pub fn observe_with(w: &World, me: usize, fc: &Sight, contact: &Contact, out: &mut [f32]) {
    let mut o = Obs { buf: out, i: 0 };
    let s = &w.ships[me];
    let b = &w.bodies[me];
    let q = s.orient;
    let body = |v: Vec3| q.inv_rotate(v);
    let p = &s.params;
    let enemy = 1 - me;
    let e = &w.bodies[enemy];
    let es = &w.ships[enemy];
    let (pc, gm, pr) = w.planet().unwrap_or((Vec3::ZERO, 1.0, 0.0));
    let safe = if w.safe_radius.is_finite() { w.safe_radius } else { w.arena.arena_radius };

    // --- self (28) ---
    o.v3(body(b.vel) / VEL);
    o.v3(body(w.ang_vel(me)) / 6.0);
    let rv = b.pos - pc;
    let r = rv.len().max(1e-6);
    o.v3(body(-rv) / r);
    o.f((r - pr) / POS);
    let alt = r - pr - b.radius;
    o.f(if alt < w.arena.atmo_height { (-alt.max(0.0) / w.arena.atmo_scale).exp() } else { 0.0 });
    o.f(r / safe);
    o.f(((safe - r) / 200.0).clamp(-3.0, 3.0));
    o.f(b.vel.dot(rv / r) / VEL);
    let (rp, ra) = apsides(rv, b.vel, gm);
    o.f(((rp - pr) / POS).clamp(-1.0, 4.0));
    o.f(if ra.is_finite() { ((ra - safe) / POS).clamp(-4.0, 4.0) } else { 4.0 });
    o.v3(body(orbit_normal(rv, b.vel)));
    o.f(s.zone_burn / 30.0);
    o.f((s.heating / 30.0).min(3.0));
    o.f(s.hull / p.hull);
    o.f(s.propellant / p.propellant);
    o.f(b.mass / p.start_mass());
    o.f(s.ammo as f64 / p.driver.ammo as f64);
    o.f(s.reload / p.driver.reload);
    o.flag(s.reload <= 0.0 && s.ammo > 0);
    o.f(s.thrust_level);

    // --- own design (14) ---
    let i0 = 0.4 * p.start_mass() * p.radius * p.radius;
    o.f(p.radius / 6.0);
    o.f(p.start_mass() / 1500.0);
    o.f(p.max_thrust / p.start_mass() / 80.0);
    o.f(p.rcs_thrust / p.start_mass() / 15.0);
    let loaded = p.start_mass() + p.driver.ammo as f64 * p.driver.slug_mass;
    o.f(p.exhaust_vel * (loaded / (loaded - p.propellant)).ln() / 400.0);
    o.f(p.max_torque / i0 / 10.0);
    o.f(p.max_rate / 6.0);
    o.f(p.hull / 1000.0);
    o.f(p.armor / 40.0);
    o.f(p.driver.speed / 150.0);
    o.f(p.driver.slug_mass / 30.0);
    o.f(p.driver.ammo as f64 / 40.0);
    o.f(p.driver.reload / 9.0);
    o.f(slug_hp(p, p.driver.speed) / 1000.0);

    // --- enemy (29) ---
    let rel = e.pos - b.pos;
    let dist = rel.len().max(1e-6);
    let relv = e.vel - b.vel;
    o.v3(body(rel) / POS);
    o.f(dist / POS);
    o.v3(body(relv) / VEL);
    o.f(-relv.dot(rel / dist) / VEL);
    let efwd = es.orient.rotate(FORWARD);
    o.v3(body(efwd));
    o.f(efwd.dot(-rel / dist));
    o.f(w.forward(me).dot(rel / dist));
    o.flag(es.alive);
    o.f(es.hull / es.params.hull);
    o.f(es.propellant / es.params.propellant);
    o.f(es.ammo as f64 / es.params.driver.ammo as f64);
    o.flag(es.reload <= 0.0 && es.ammo > 0);
    o.f(es.thrust_level);
    o.f(w.ang_vel(enemy).len() / 6.0);
    o.onehot(preset_index(es.params.name), 3);
    o.f(es.params.radius / 6.0);
    let erv = e.pos - pc;
    o.v3(body(orbit_normal(erv, e.vel)));
    let (erp, era) = apsides(erv, e.vel, gm);
    o.f(((erp - pr) / POS).clamp(-1.0, 4.0));
    o.f(if era.is_finite() { ((era - safe) / POS).clamp(-4.0, 4.0) } else { 4.0 });

    // --- contact (8): what is known of the enemy, and how well ---
    o.flag(contact.visible);
    o.f(((w.t - contact.seen_t) / 30.0).min(2.0));
    o.f((contact.uncertainty / 500.0).min(4.0));
    o.flag(contact.los_kept);
    match contact.flash {
        Some((fp, ft)) => {
            o.f(((w.t - ft) / 10.0).min(2.0));
            o.v3(body(fp - b.pos) / POS);
        }
        None => {
            o.f(2.0);
            o.v3(Vec3::ZERO);
        }
    }

    // --- gunsight along the nose (8) and aim hint (5) ---
    let sight = fc.sight;
    approach_obs(&mut o, &sight, &body, es.params.hull, w.arena.warhead - es.params.armor);
    let (aim_dir, aim) = fc.aim;
    o.v3(body(aim_dir));
    o.f((aim.dist / 50.0).min(20.0));
    o.f(aim.time / SIGHT_HORIZON);

    // --- incoming missiles it can see, soonest first (60) ---
    let mut threats: Vec<(f64, usize)> = Vec::new();
    for (j, x) in w.bodies.iter().enumerate() {
        let Kind::Round { owner, .. } = x.kind else { continue };
        if !x.alive || owner == me {
            continue;
        }
        let rel = x.pos - b.pos;
        let closing = -(x.vel - b.vel).dot(rel.normalized_or(Vec3::X));
        let t_go = if closing > 1.0 { rel.len() / closing } else { 99.0 };
        threats.push((t_go, j));
    }
    threats.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
    for k in 0..K_THREATS {
        if let Some(&(t_go, j)) = threats.get(k) {
            let x = &w.bodies[j];
            let m = w.missiles.iter().find(|m| m.id == x.id);
            o.v3(body(x.pos - b.pos) / POS);
            o.v3(body(x.vel - b.vel) / 200.0);
            o.f((t_go / 10.0).min(2.0));
            o.f((x.pos - b.pos).len() / 300.0);
            o.flag(m.is_some_and(|m| m.locked));
            o.flag(m.is_some_and(|m| m.burning));
            o.f(m.map_or(0.0, |m| m.dv / w.arena.missile_dv));
            o.flag(true);
        } else {
            o.zeros(12);
        }
    }

    // --- nearest asteroids (21) ---
    let mut rocks: Vec<(f64, usize)> = w
        .bodies
        .iter()
        .enumerate()
        .filter(|(_, x)| x.alive && x.kind == Kind::Asteroid)
        .map(|(j, x)| ((x.pos - b.pos).len() - x.radius, j))
        .collect();
    rocks.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
    for k in 0..K_ROCKS {
        if let Some(&(_, j)) = rocks.get(k) {
            let x = &w.bodies[j];
            o.v3(body(x.pos - b.pos) / POS);
            o.v3(body(x.vel - b.vel) / VEL);
            o.f(x.radius / 30.0);
        } else {
            o.zeros(7);
        }
    }

    // --- global (6) ---
    o.f(w.t / w.arena.time_limit);
    o.f(safe / 800.0);
    o.flag(w.t > w.arena.sudden_death_at);
    o.onehot(preset_index(p.name), 3);
    assert_eq!(o.i, OBS_DIM, "observation layout drifted");
    for v in out.iter_mut() {
        if !v.is_finite() {
            *v = 0.0;
        }
    }
}

fn approach_obs(o: &mut Obs, a: &Approach, body: &dyn Fn(Vec3) -> Vec3, target_hull: f64, hp: f64) {
    o.f((a.dist / 50.0).min(20.0));
    o.f(a.time / SIGHT_HORIZON);
    o.v3(body(a.miss) / 50.0);
    o.f(a.rel_speed / 200.0);
    o.flag(a.blocked);
    o.f((hp.max(0.0) / target_hull).min(2.0));
}

struct Obs<'a> {
    buf: &'a mut [f32],
    i: usize,
}
impl Obs<'_> {
    fn f(&mut self, v: f64) {
        self.buf[self.i] = v as f32;
        self.i += 1;
    }
    fn v3(&mut self, v: Vec3) {
        self.f(v.x);
        self.f(v.y);
        self.f(v.z);
    }
    fn flag(&mut self, b: bool) {
        self.f(if b { 1.0 } else { 0.0 });
    }
    fn onehot(&mut self, k: usize, n: usize) {
        for j in 0..n {
            self.flag(j == k);
        }
    }
    fn zeros(&mut self, n: usize) {
        for _ in 0..n {
            self.f(0.0);
        }
    }
}

/// End-of-match summary, including the spectator metrics we tune toward.
#[derive(Clone, Debug, Default)]
pub struct EpisodeInfo {
    pub presets: [usize; 2],
    pub winner: Option<usize>,
    pub decision: bool,
    pub duration: f64,
    pub kill_cause: Option<&'static str>,
    pub returns: [f64; 2],
    pub shots: [u32; 2],
    /// Slugs that did damage: direct hits plus proximity bursts.
    pub hits: [u32; 2],
    /// Of those, proximity bursts.
    pub bursts: [u32; 2],
    pub rams: u32,
    /// Slugs that passed within 15 m of the target's hull (dodged, or just missed).
    pub near_misses: u32,
    /// Sum of per-shot actual closeness (tight 50 m score; 1 = hit).
    pub shot_quality: [f64; 2],
    /// Sum of per-shot predicted closeness at the trigger (the rewarded aim quality).
    pub aim_quality: [f64; 2],
    /// Shots whose predicted pass at the trigger was within 20 m.
    pub good_shots: [u32; 2],
    pub lead_changes: u32,
    pub first_blood: Option<f64>,
    pub close_frac: f64,
    pub comeback: bool,
    pub atmo_time: [f64; 2],
    pub zone_time: [f64; 2],
    pub fuel_left: [f64; 2],
    /// Propellant scooped from the air, in tanks.
    pub fuel_scooped: [f64; 2],
    /// The kill was earned (killing blow or forced error), not an unforced crash.
    pub kill_credited: bool,
    /// Hull lost per ship, by source: [slug, ram, asteroid, planet, atmosphere, zone, wall].
    pub damage_by: [[f64; 7]; 2],
    /// The first major blow (>= 25% of hull) in the 20 s before death, by source: the root
    /// cause, which "kill_cause" (the last damage) can hide (e.g. a rock that flings you out).
    pub root_cause: Option<&'static str>,
    pub excitement: f64,
    /// Per-ship diagnostics (see ShipDiag).
    pub diag: [ShipDiag; 2],
    /// This episode opened as a skip drill (ship 0), and how the drill went.
    pub drill: bool,
    pub drill_outcome: &'static str,
}

pub const DAMAGE_SOURCES: [&str; 7] = ["slug", "ram", "asteroid", "planet", "atmosphere", "zone", "wall"];

fn source_index(c: Cause) -> usize {
    match c {
        Cause::Slug => 0,
        Cause::Ram => 1,
        Cause::Asteroid => 2,
        Cause::Planet => 3,
        Cause::Atmosphere => 4,
        Cause::Zone => 5,
        Cause::Wall => 6,
    }
}

#[derive(Default)]
struct Tracker {
    diag: [ShipDiag; 2],
    drill: bool,
    last_used: [f64; 2],
    was_out: [bool; 2],
    was_air: [bool; 2],
    pending_pred: [Vec<f64>; 2],
    /// Per live round: (id, owner, predicted hull gap at the trigger, closest actual hull gap).
    shot_recs: Vec<(u32, usize, f64, f64)>,
    locked_ids: Vec<u32>,
    returns: [f64; 2],
    last_dealt: [f64; 2],
    last_taken: [f64; 2],
    last_scooped: [f64; 2],
    last_calm: [f64; 2],
    potential: [[f64; 3]; 2],
    /// Per live slug: (id, owner, closest distance to the enemy hull, near-miss counted, scored).
    near: Vec<(u32, usize, f64, bool, bool)>,
    near_misses: u32,
    /// Shot-closeness reward waiting to be paid at the end of the decision, per ship.
    shot_pending: [f64; 2],
    shot_quality: [f64; 2],
    aim_quality: [f64; 2],
    good_shots: [u32; 2],
    lead: Option<usize>,
    lead_changes: u32,
    max_deficit: [f64; 2],
    first_blood: Option<f64>,
    close_time: f64,
    atmo_time: [f64; 2],
    zone_time: [f64; 2],
    kill_cause: Option<&'static str>,
    last_hit_by_enemy: [Option<f64>; 2],
    kill_credited: bool,
    damage_by: [[f64; 7]; 2],
    /// Recent major blows per ship: (time, source).
    blows: [Vec<(f64, usize)>; 2],
    root_cause: Option<&'static str>,
}

/// Replay capture hook, implemented by the binding that knows the wire format.
pub trait Recorder: Send + Sync {
    /// Called with the world at each captured frame and the events since the last one.
    fn frame(&mut self, w: &World, events: &[Event]);
    /// The episode ended: package the frames.
    fn end(&mut self, info: &EpisodeInfo);
    /// Take the most recently finished replay, if any.
    fn take(&mut self) -> Option<String>;
}

pub struct RlEnv {
    pub world: World,
    pub reward: RewardCfg,
    pub action_repeat: usize,
    /// Per ship: scripted bot in control instead of the policy (applied at reset).
    pub bot_mask: [bool; 2],
    /// Per ship: if a bot, it never fires (curriculum).
    pub bot_passive: [bool; 2],
    /// Per ship: bot style bits (1 = flash-dodge, 2 = quiet dodging).
    pub bot_style: [u8; 2],
    bots: [Option<Bot>; 2],
    /// Fixed preset per ship, or random each episode.
    pub presets: [Option<usize>; 2],
    /// Probability an episode opens as a skip drill: ship 0 low on propellant, already diving
    /// into the air from a random high point, attitude random (a start-state curriculum).
    pub skip_drill: f32,
    rng: Rng,
    tracker: Tracker,
    pub recorder: Option<Box<dyn Recorder>>,
    /// A frame is captured every `record_every` sim steps.
    pub record_every: u64,
    pending_events: Vec<Event>,
    /// Per-ship fire-control predictions for the current state.
    pub fc: [Sight; 2],

}

impl RlEnv {
    pub fn new(seed: u64, action_repeat: usize, reward: RewardCfg) -> RlEnv {
        let mut rng = Rng::new(seed);
        let world = World::new(MatchConfig::standard(rng.next_u64(), vec![PRESETS[0], PRESETS[1]]));
        let mut env = RlEnv {
            world,
            reward,
            action_repeat: action_repeat.max(1),
            bot_mask: [false, false],
            bot_style: [0, 0],
            bot_passive: [false, false],
            bots: [None, None],
            presets: [None, None],
            skip_drill: 0.0,
            rng,
            tracker: Tracker::default(),
            recorder: None,
            record_every: 8,
            pending_events: Vec::new(),
            fc: [Sight::compute(&world_stub(), 0, None); 2],

        };
        env.reset();
        env
    }

    /// Audit scenario: ship 0 dry at a 500 m high point, on an orbit whose low point is `alt`
    /// above the floor of the air; ship 1 parked out of the way; no rocks. A pilot that flies
    /// the skip should come back out refuelled.
    pub fn setup_skip_dive(&mut self, alt: f64) {
        use crate::world::{PLANET_GM, PLANET_RADIUS};
        let w = &mut self.world;
        for b in w.bodies.iter_mut() {
            if b.kind == Kind::Asteroid {
                b.alive = false;
            }
        }
        let (ra, rp) = (500.0, PLANET_RADIUS + w.bodies[0].radius + alt);
        let a = 0.5 * (ra + rp);
        w.bodies[0].pos = Vec3::new(ra, 0.0, 0.0);
        w.bodies[0].vel = Vec3::new(0.0, (PLANET_GM * (2.0 / ra - 1.0 / a)).sqrt(), 0.0);
        w.bodies[1].pos = Vec3::new(-650.0, 0.0, 0.0);
        w.bodies[1].vel = Vec3::new(0.0, 0.0, (PLANET_GM / 650.0).sqrt());
        w.ships[0].propellant = 0.0;
        w.bodies[0].mass = w.ship_mass(0);
        self.world.resync_knowledge();
        self.refresh_sight(false);
    }

    /// Both ships know the true state of everything they can sense right now (for tests and
    /// tools that edit the world directly).
    pub fn resync_knowledge(&mut self) {
        self.world.resync_knowledge();
        self.refresh_sight(false);
    }

    /// Fire-control predictions from what each ship knows.
    pub(crate) fn refresh_sight(&mut self, keep: bool) {
        let p = [self.world.perceived(0), self.world.perceived(1)];
        self.fc = [
            Sight::compute(&p[0], 0, if keep { Some(&self.fc[0]) } else { None }),
            Sight::compute(&p[1], 1, if keep { Some(&self.fc[1]) } else { None }),
        ];
    }

    fn start_skip_drill(&mut self) {
        use crate::math::Quat;
        use crate::world::{FORWARD, PLANET_GM, PLANET_RADIUS};
        let r = &mut self.rng;
        let (alt, ra, fuel) = (r.range(-3.0, 30.0), r.range(380.0, 620.0), r.range(0.0, 0.3));
        let q = Quat::from_axis_angle(r.unit_vec(), r.range(0.0, std::f64::consts::TAU));
        let nose = r.unit_vec();
        let w = &mut self.world;
        let rp = PLANET_RADIUS + w.bodies[0].radius + alt;
        let a = 0.5 * (ra + rp);
        // Start a random way down the dive (between the high point and a quarter-orbit out).
        let pos = q.rotate(Vec3::new(ra, 0.0, 0.0));
        let vel = q.rotate(Vec3::new(0.0, (PLANET_GM * (2.0 / ra - 1.0 / a)).sqrt(), 0.0));
        w.bodies[0].pos = pos;
        w.bodies[0].vel = vel;
        w.ships[0].orient = Quat::from_to(FORWARD, nose);
        w.ships[0].propellant = fuel * w.ships[0].params.propellant;
        w.bodies[0].mass = w.ship_mass(0);
        // Start the opponent well away (the drill is about the skip, not an ambush).
        if (w.bodies[1].pos - pos).len() < 600.0 {
            w.bodies[1].pos = -w.bodies[1].pos;
            w.bodies[1].vel = -w.bodies[1].vel;
        }
    }

    /// The current episode opened as a skip drill.
    pub fn is_drill(&self) -> bool {
        self.tracker.drill
    }

    pub fn reset(&mut self) {
        let n = PRESETS.len();
        let pick = |rng: &mut Rng, fixed: Option<usize>| fixed.unwrap_or((rng.f64() * n as f64) as usize % n);
        let a = pick(&mut self.rng, self.presets[0]);
        let b = pick(&mut self.rng, self.presets[1]);
        self.world = World::new(MatchConfig::standard(self.rng.next_u64(), vec![PRESETS[a], PRESETS[b]]));
        for i in 0..2 {
            self.bots[i] = if self.bot_mask[i] {
                let name = PRESETS[if i == 0 { a } else { b }].name;
                let mut bot = Bot::new(Personality::for_design(name, &mut self.rng), self.rng.next_u64());
                bot.passive = self.bot_passive[i];
                bot.personality.flash_dodge = self.bot_style[i] & 1 != 0;
                bot.personality.quiet = self.bot_style[i] & 2 != 0;
                if self.bot_style[i] & 4 != 0 {
                    bot.personality.drift_rate = 0.35;
                }
                Some(bot)
            } else {
                None
            };
        }
        let drill = self.skip_drill > 0.0 && (self.rng.f64() as f32) < self.skip_drill;
        if drill {
            self.start_skip_drill();
        }
        self.tracker = Tracker::default();
        self.world.resync_knowledge();
        self.refresh_sight(false);
        self.tracker.potential = [self.potential_parts(0), self.potential_parts(1)];
        self.tracker.drill = drill;
        for i in 0..2 {
            let b = &self.world.bodies[i];
            if let Some((pc, gm, pr)) = self.world.planet() {
                self.tracker.diag[i].rp_start = apsides(b.pos - pc, b.vel, gm).0 - pr;
            }
            self.tracker.last_used[i] = self.world.ships[i].stats.propellant_used;
        }
        self.pending_events.clear();
        if let Some(r) = self.recorder.as_mut() {
            r.frame(&self.world, &[]);
        }
    }

    /// Step with actions for both ships (2 * ACT_DIM). Returns rewards and, if the episode
    /// ended (and auto-reset), its summary.
    pub fn step(&mut self, actions: &[f32]) -> ([f32; 2], Option<EpisodeInfo>) {
        let dt = self.world.arena.dt;
        for _ in 0..self.action_repeat {
            for i in 0..2 {
                let inp = match self.bots[i].as_mut() {
                    Some(bot) => bot.act(&self.world.perceived(i), i),
                    None => decode_action(&self.world, i, &actions[i * ACT_DIM..(i + 1) * ACT_DIM]),
                };
                self.world.set_input(i, inp);
                // This ship fires this step: score the shot's predicted pass right now.
                let s = &self.world.ships[i];
                // Same test the world uses (it counts the reload down, then fires): a trigger held
                // through the reload fires the moment it reaches zero, and must be scored too.
                if inp.fire && s.alive && s.reload - dt <= 0.0 && s.ammo > 0 && self.world.ships[1 - i].alive {
                    // Launch quality from the truth (diagnostics and the optional shot reward):
                    // range to the target and whether it sits inside the seeker cone of the nose.
                    let rel = self.world.bodies[1 - i].pos - self.world.bodies[i].pos;
                    let range = rel.len();
                    let in_cone = self.world.forward(i).dot(rel.normalized_or(Vec3::X)) > self.world.arena.seeker_cos;
                    let hull_gap = range - self.world.bodies[1 - i].radius;
                    let a = Approach { dist: range, time: 0.0, miss: Vec3::ZERO, rel_speed: 0.0, blocked: !crate::sense::line_of_sight(&self.world, self.world.bodies[i].pos, self.world.bodies[1 - i].pos) };
                    let q = if a.blocked || !in_cone { 0.0 } else { shot_score(hull_gap, self.reward.shot_radius as f64, self.reward.shot_wide as f64) };
                    let t = &mut self.tracker;
                    t.shot_pending[i] += q;
                    t.aim_quality[i] += q;
                    let blind = !self.world.contact(i).visible;
                    let dg = &mut t.diag[i];
                    if blind {
                        dg.shots_blind += 1;
                    }
                    if a.blocked {
                        dg.launch_blocked += 1;
                    } else if range < LAUNCH_CLOSE {
                        dg.launch_close += 1;
                    } else if range < LAUNCH_MID {
                        dg.launch_mid += 1;
                    } else {
                        dg.launch_far += 1;
                    }
                    t.pending_pred[i].push(if a.blocked { f64::INFINITY } else { range });
                    if !a.blocked && range < LAUNCH_CLOSE {
                        t.good_shots[i] += 1;
                    }
                }
            }
            self.world.step();
            for i in 0..2 {
                if self.world.contact(i).visible {
                    self.tracker.diag[i].enemy_visible_time += dt;
                }
            }
            self.observe_step(dt);
            if let Some(r) = self.recorder.as_mut() {
                self.pending_events.extend(self.world.events.iter().copied());
                if self.world.tick % self.record_every == 0 || self.world.finished {
                    let ev = std::mem::take(&mut self.pending_events);
                    r.frame(&self.world, &ev);
                }
            }
            self.world.events.clear();
            if self.world.finished {
                break;
            }
        }

        let rc = self.reward;
        // Every reward component is kept apart (summed per episode for diagnostics); the reward is
        // their total. Indices follow REWARD_PARTS.
        let mut parts = [[0.0f64; 12]; 2];
        for i in 0..2 {
            let st = self.world.ships[i].stats;
            let hull = self.world.ships[i].params.hull;
            let ehull = self.world.ships[1 - i].params.hull;
            let tank = self.world.ships[i].params.propellant;
            let t = &mut self.tracker;
            parts[i][0] += rc.dealt as f64 * (st.damage_dealt - t.last_dealt[i]) / ehull;
            parts[i][1] -= rc.taken as f64 * (st.damage_taken - t.last_taken[i]) / hull;
            t.last_dealt[i] = st.damage_dealt;
            t.last_taken[i] = st.damage_taken;
            parts[i][11] += rc.scoop as f64 * (st.propellant_scooped - t.last_scooped[i]) / tank;
            t.last_scooped[i] = st.propellant_scooped;
            parts[i][5] += rc.shot as f64 * t.shot_pending[i];
            t.shot_pending[i] = 0.0;
            let calm = t.diag[i].burn_rcs_calm;
            parts[i][7] -= rc.calm_burn as f64 * (calm - t.last_calm[i]) / tank;
            t.last_calm[i] = calm;
        }
        if rc.engage != 0.0 && self.world.ships[0].alive && self.world.ships[1].alive {
            let (a, b) = (&self.world.bodies[0], &self.world.bodies[1]);
            let d = ((a.pos - b.pos).len() - a.radius - b.radius).max(0.0);
            let k = (1.0 - d / rc.engage_range as f64).max(0.0).powi(2);
            let v = rc.engage as f64 * k * dt * self.action_repeat as f64;
            parts[0][6] += v;
            parts[1][6] += v;
        }
        // Fire-control predictions for the new state: shared by the observation and the
        // aiming scaffold, computed once.
        if !self.world.finished {
            self.refresh_sight(true);
        }
        // Potential-based terms (aim, orbit safety, propellant): F = gamma * phi(s') - phi(s),
        // phi(terminal) = 0, each potential kept apart.
        if rc.aim != 0.0 || rc.safety != 0.0 || rc.fuel != 0.0 {
            for i in 0..2 {
                let phi = if self.world.finished { [0.0; 3] } else { self.potential_parts(i) };
                for c in 0..3 {
                    parts[i][8 + c] += rc.gamma as f64 * phi[c] - self.tracker.potential[i][c];
                }
                self.tracker.potential[i] = phi;
            }
        }
        if self.world.finished {
            let at_bell = self.world.t >= self.world.arena.time_limit - 1e-6;
            match self.world.winner {
                Some(wi) if at_bell => {
                    parts[wi][4] += rc.decision as f64;
                    parts[1 - wi][4] -= rc.decision as f64;
                    parts[0][4] -= rc.stalemate as f64;
                    parts[1][4] -= rc.stalemate as f64;
                }
                Some(wi) => {
                    let credit = if self.tracker.kill_credited { 1.0 } else { 0.25 };
                    parts[wi][2] += rc.kill as f64 * credit;
                    parts[1 - wi][3] -= rc.death as f64;
                }
                None if at_bell => {
                    parts[0][4] -= rc.stalemate as f64;
                    parts[1][4] -= rc.stalemate as f64;
                }
                None => {
                    parts[0][3] -= rc.death as f64;
                    parts[1][3] -= rc.death as f64;
                }
            }
        }
        let mut r = [0.0f64; 2];
        for i in 0..2 {
            for c in 0..12 {
                r[i] += parts[i][c];
                self.tracker.diag[i].reward[c] += parts[i][c];
            }
        }

        let mut info = None;
        if self.world.finished {
            self.tracker.returns[0] += r[0];
            self.tracker.returns[1] += r[1];
            let summary = self.summarize();
            if let Some(rec) = self.recorder.as_mut() {
                rec.end(&summary);
            }
            info = Some(summary);
            self.reset();
        } else {
            self.tracker.returns[0] += r[0];
            self.tracker.returns[1] += r[1];
        }
        ([r[0] as f32, r[1] as f32], info)
    }

    /// Combined, weighted scaffold potential for ship `i`.
    /// Potentials [aim, orbit safety, propellant], each already weighted.
    fn potential_parts(&self, i: usize) -> [f64; 3] {
        let rc = self.reward;
        let mut phi = [0.0; 3];
        if rc.aim != 0.0 {
            phi[0] = rc.aim as f64 * self.fc[i].potential(&self.world, i);
        }
        if rc.safety != 0.0 {
            phi[1] = rc.safety as f64 * safety_potential(&self.world, i);
        }
        if rc.fuel != 0.0 && self.world.ships[i].alive {
            let s = &self.world.ships[i];
            phi[2] = rc.fuel as f64 * (s.propellant / s.params.propellant).max(0.0).sqrt();
        }
        phi
    }

    #[cfg(test)]
    fn potential(&self, i: usize) -> f64 {
        self.potential_parts(i).iter().sum()
    }

    #[cfg(test)]
    pub fn potential_for_audit(&self, i: usize) -> f64 {
        self.potential(i)
    }

    /// Observation for ship `i` using the cached fire-control predictions.
    pub fn observe(&self, i: usize, out: &mut [f32]) {
        observe_with(&self.world.perceived(i), i, &self.fc[i], &self.world.contact(i), out);
    }

    fn observe_step(&mut self, dt: f64) {
        let w = &self.world;
        let t = &mut self.tracker;
        for e in &w.events {
            match *e {
                Event::Hit { victim, attacker, cause, damage, .. } => {
                    t.damage_by[victim][source_index(cause)] += damage;
                    if damage >= 0.25 * w.ships[victim].params.hull {
                        t.blows[victim].push((w.t, source_index(cause)));
                    }
                    if attacker.is_some_and(|a| a != victim) {
                        t.first_blood.get_or_insert(w.t);
                        t.last_hit_by_enemy[victim] = Some(w.t);
                    }
                }
                Event::Kill { victim, attacker, cause, .. } => {
                    t.kill_cause = Some(cause_name(cause));
                    t.root_cause = Some(
                        t.blows[victim].iter().find(|b| w.t - b.0 <= 20.0).map(|b| DAMAGE_SOURCES[b.1]).unwrap_or(cause_name(cause)),
                    );
                    let forced = t.last_hit_by_enemy[victim].is_some_and(|h| w.t - h <= KILL_CREDIT_WINDOW);
                    t.kill_credited = attacker.is_some_and(|a| a != victim) || forced;
                }
                _ => {}
            }
        }
        // Track each slug's closest pass to its target. A slug is scored once: when it has
        // passed and is moving away, or when it disappears (hit, impact, expiry).
        let radius = self.reward.shot_radius as f64;
        // Actual closeness is tracked for monitoring; the shot reward is paid at the trigger.
        let score = |d: f64| (1.0 - d.max(0.0) / radius).max(0.0).powi(2);
        let mut seen = Vec::new();
        for x in w.bodies.iter().filter(|x| x.alive) {
            let Kind::Round { owner, .. } = x.kind else { continue };
            let target = &w.bodies[1 - owner];
            let d = if w.ships[1 - owner].alive { (x.pos - target.pos).len() - target.radius } else { f64::INFINITY };
            seen.push(x.id);
            match t.near.iter_mut().find(|n| n.0 == x.id) {
                Some(n) => {
                    if d < n.2 {
                        n.2 = d;
                    } else if d > n.2 + 5.0 {
                        if n.2 < w.arena.fuze_radius + 15.0 && !n.3 {
                            n.3 = true;
                            t.near_misses += 1;
                        }
                        if !n.4 {
                            n.4 = true;
                            t.shot_quality[owner] += score(n.2);
                        }
                    }
                }
                None => t.near.push((x.id, owner, d, false, false)),
            }
        }
        // Slugs gone this step: a hit scores as a pass at 0 m.
        let hits: Vec<usize> = w.events.iter().filter_map(|e| match *e {
            Event::Hit { attacker: Some(a), victim, cause: Cause::Slug, .. } if a != victim => Some(a),
            _ => None,
        }).collect();
        let mut hit_credit = hits.clone();
        for n in t.near.iter().filter(|n| !seen.contains(&n.0) && !n.4) {
            let d = match hit_credit.iter().position(|&a| a == n.1) {
                Some(k) => {
                    hit_credit.remove(k);
                    0.0
                }
                None => n.2,
            };
            t.shot_quality[n.1] += score(d);
        }
        t.near.retain(|n| seen.contains(&n.0));

        if (w.bodies[0].pos - w.bodies[1].pos).len() < 400.0 {
            t.close_time += dt;
        }
        for i in 0..2 {
            if !w.ships[i].alive && w.ships[i].hull <= 0.0 {
                continue;
            }
            if w.ships[i].zone_burn > 0.0 {
                t.zone_time[i] += dt;
                t.damage_by[i][5] += w.ships[i].zone_burn * dt;
            }
            if w.ships[i].heating > 0.0 {
                t.atmo_time[i] += dt;
                t.damage_by[i][4] += w.ships[i].heating * dt;
            }
        }
        // ---- diagnostics ----
        for e in &w.events {
            match *e {
                Event::Fire { ship, .. } if t.diag[ship].t_dry >= 0.0 => t.diag[ship].fires_after_dry += 1,
                Event::Hit { victim, .. } if t.diag[victim].t_dry >= 0.0 => t.diag[victim].hits_after_dry += 1,
                _ => {}
            }
        }
        // Each round's predicted pass at the trigger, followed to its fate.
        for x in w.bodies.iter().filter(|x| x.alive) {
            let Kind::Round { owner, .. } = x.kind else { continue };
            let d = if w.ships[1 - owner].alive { (x.pos - w.bodies[1 - owner].pos).len() - w.bodies[1 - owner].radius } else { f64::INFINITY };
            match t.shot_recs.iter_mut().find(|r| r.0 == x.id) {
                Some(r) => r.3 = r.3.min(d),
                None => {
                    let pred = if t.pending_pred[owner].is_empty() { f64::NAN } else { t.pending_pred[owner].remove(0) };
                    t.shot_recs.push((x.id, owner, pred, d));
                }
            }
        }
        let mut credit: Vec<usize> = w.events.iter().filter_map(|e| match *e {
            Event::Hit { attacker: Some(a), victim, cause: Cause::Slug, .. } if a != victim => Some(a),
            _ => None,
        }).collect();
        let mut gone = Vec::new();
        for (k, r) in t.shot_recs.iter().enumerate() {
            if w.bodies.iter().any(|x| x.alive && x.id == r.0) {
                continue;
            }
            gone.push(k);
            let landed = match credit.iter().position(|&a| a == r.1) {
                Some(j) => {
                    credit.remove(j);
                    true
                }
                None => false,
            };
            let (owner, pred) = (r.1, r.2);
            if pred < LAUNCH_CLOSE {
                if landed { t.diag[owner].close_landed += 1 } else { t.diag[owner].close_missed += 1; t.diag[1 - owner].dodged += 1 }
            } else if landed {
                t.diag[owner].far_landed += 1;
            }
        }
        for k in gone.into_iter().rev() {
            t.shot_recs.remove(k);
        }
        for m in &w.missiles {
            if m.locked && !t.locked_ids.contains(&m.id) {
                t.locked_ids.push(m.id);
                t.diag[m.owner].missiles_locked += 1;
            }
        }
        let planet = w.planet();
        for i in 0..2 {
            let (s, b) = (&w.ships[i], &w.bodies[i]);
            let dg = &mut t.diag[i];
            if !s.alive {
                if dg.death_t < 0.0 {
                    dg.death_t = w.t;
                    dg.died_in_air = t.was_air[i];
                }
                continue;
            }
            let p = &s.params;
            let used = s.stats.propellant_used - t.last_used[i];
            t.last_used[i] = s.stats.propellant_used;
            let main = s.thrust_level * p.max_thrust;
            let rcs = (s.strafe_level.x.abs() + s.strafe_level.y.abs() + s.strafe_level.z.abs()) * p.rcs_thrust;
            let calm = !w.bodies.iter().any(|x| x.alive && matches!(x.kind, Kind::Round { owner, .. } if owner != i) && (x.pos - b.pos).len() < CALM_RANGE);
            if used > 0.0 && main + rcs > 0.0 {
                dg.burn_main += used * main / (main + rcs);
                let r = used * rcs / (main + rcs);
                dg.burn_rcs += r;
                if calm {
                    dg.burn_rcs_calm += r;
                }
            }
            if main > 0.0 {
                dg.thrust_time += dt;
            }
            if rcs > 0.0 {
                dg.strafe_time += dt;
                if calm {
                    dg.strafe_calm_time += dt;
                }
            }
            let frac = s.propellant / p.propellant;
            for (k, at) in [15.0, 30.0, 45.0, 60.0].iter().enumerate() {
                if dg.fuel_at[k] < 0.0 && w.t >= *at {
                    dg.fuel_at[k] = frac;
                }
            }
            let out = s.zone_burn > 0.0;
            if out && !t.was_out[i] {
                dg.zone_exits += 1;
                dg.fuel_at_last_exit = frac;
                dg.safe_at_last_exit = w.safe_radius;
            }
            t.was_out[i] = out;
            let Some((pc, gm, pr)) = planet else { continue };
            if dg.t_dry < 0.0 && frac < 0.02 {
                dg.t_dry = w.t;
                let (_, ra) = apsides(b.pos - pc, b.vel, gm);
                dg.orbit_out_at_dry = !(ra < w.safe_radius);
            }
            let alt = (b.pos - pc).len() - pr - b.radius;
            let air = alt < w.arena.atmo_height;
            if air {
                if !t.was_air[i] {
                    dg.air_entries += 1;
                    if dg.rp_at_entry < 0.0 {
                        dg.rp_at_entry = apsides(b.pos - pc, b.vel, gm).0 - pr;
                    }
                }
                dg.air_time += dt;
                let f = w.forward(i).dot(b.vel.normalized_or(Vec3::Z));
                dg.facing_sum += f * dt;
                if f > 0.9 {
                    dg.nose_first_time += dt;
                }
                if s.lift.len() > 0.2 {
                    let o = s.lift.dot((b.pos - pc).normalized()) / s.lift.len();
                    if o > 0.5 {
                        dg.lift_up_time += dt;
                    } else if o < -0.5 {
                        dg.lift_down_time += dt;
                    }
                }
            } else if t.was_air[i] && dg.first_pass_scooped < 0.0 {
                dg.first_pass_scooped = s.stats.propellant_scooped / p.propellant;
            }
            t.was_air[i] = air;
        }

        if w.tick % 60 == 0 {
            let diff = w.hull_frac(0) - w.hull_frac(1);
            t.max_deficit[0] = t.max_deficit[0].max(-diff);
            t.max_deficit[1] = t.max_deficit[1].max(diff);
            let now = if diff > 0.08 { Some(0) } else if diff < -0.08 { Some(1) } else { t.lead };
            if t.lead.is_some() && now != t.lead {
                t.lead_changes += 1;
            }
            t.lead = now;
        }
    }

    /// Diagnostics with the loose ends tied: rounds still flying count as missed, and a zone
    /// death gets its reason.
    fn final_diag(&self) -> [ShipDiag; 2] {
        let (w, t) = (&self.world, &self.tracker);
        let mut d = t.diag;
        for r in &t.shot_recs {
            if r.2 < LAUNCH_CLOSE {
                d[r.1].close_missed += 1;
                d[1 - r.1].dodged += 1;
            }
        }
        for i in 0..2 {
            if !(w.ships[i].hull <= 0.0 && t.kill_cause == Some("zone") && w.winner == Some(1 - i)) {
                continue;
            }
            let g = &mut d[i];
            g.zone_reason = if g.safe_at_last_exit >= 0.0 && g.safe_at_last_exit < w.arena.safe_radius - 1.0 {
                "caught by the shrinking zone"
            } else if g.fuel_at_last_exit > 0.05 {
                "had fuel, didn't get back"
            } else if g.orbit_out_at_dry {
                "ran dry on an orbit already leaving the zone"
            } else if g.fires_after_dry >= 2 {
                "ran dry on a safe orbit, pushed out by its own recoil"
            } else if g.hits_after_dry > 0 {
                "ran dry on a safe orbit, knocked out by hits"
            } else {
                "ran dry on a safe orbit, drifted out"
            };
        }
        d
    }

    fn summarize(&self) -> EpisodeInfo {
        let w = &self.world;
        let t = &self.tracker;
        let st = |i: usize| w.ships[i].stats;
        let winner = w.winner;
        let decision = winner.is_some() && w.t >= w.arena.time_limit - 1e-6;
        let mut info = EpisodeInfo {
            presets: [preset_index(w.ships[0].params.name), preset_index(w.ships[1].params.name)],
            winner,
            decision,
            duration: w.t,
            kill_cause: if winner.is_some() && !decision { t.kill_cause } else { None },
            returns: t.returns,
            shots: [st(0).shots, st(1).shots],
            hits: [st(0).hits, st(1).hits],
            bursts: [st(0).bursts, st(1).bursts],
            rams: st(0).rams.max(st(1).rams),
            near_misses: t.near_misses,
            shot_quality: t.shot_quality,
            aim_quality: t.aim_quality,
            good_shots: t.good_shots,
            lead_changes: t.lead_changes,
            first_blood: t.first_blood,
            close_frac: t.close_time / w.t.max(1.0),
            comeback: winner.is_some_and(|wi| t.max_deficit[wi] > 0.25),
            atmo_time: t.atmo_time,
            zone_time: t.zone_time,
            fuel_left: [w.ships[0].propellant / w.ships[0].params.propellant, w.ships[1].propellant / w.ships[1].params.propellant],
            fuel_scooped: [w.ships[0].stats.propellant_scooped / w.ships[0].params.propellant, w.ships[1].stats.propellant_scooped / w.ships[1].params.propellant],
            kill_credited: t.kill_credited && winner.is_some() && !decision,
            damage_by: t.damage_by,
            root_cause: if winner.is_some() && !decision { t.root_cause } else { None },
            excitement: 0.0,
            diag: self.final_diag(),
            drill: t.drill,
            drill_outcome: "",
        };
        if t.drill {
            let d = &info.diag[0];
            let k = t.kill_cause;
            let died = w.winner == Some(1) && !decision;
            info.drill_outcome = if d.air_entries == 0 {
                if died { if k == Some("slug") { "shot down before the air" } else { "died before the air" } } else { "avoided the air" }
            } else if d.died_in_air || (died && matches!(k, Some("planet") | Some("atmosphere")) && d.death_t >= 0.0) {
                "crashed in the air"
            } else if d.first_pass_scooped > 0.1 || (d.first_pass_scooped < 0.0 && w.ships[0].stats.propellant_scooped / w.ships[0].params.propellant > 0.1) {
                "skipped"
            } else {
                "passed through, little fuel"
            };
        }
        info.excitement = excitement(&info);
        info
    }
}

/// A 0..100 spectator score. Deliberately simple and documented so it can be argued with:
/// landed shots and near-misses, swings, closeness, decisive endings, comebacks, use of the
/// planet.
pub fn excitement(i: &EpisodeInfo) -> f64 {
    let hits = (i.hits[0] + i.hits[1]) as f64;
    let mut s = 0.0;
    s += 25.0 * (hits / 4.0).min(1.0);
    s += 15.0 * (i.near_misses as f64 / 4.0).min(1.0);
    s += 15.0 * (i.lead_changes as f64 / 2.0).min(1.0);
    s += 10.0 * (i.close_frac * 2.0).min(1.0);
    s += if i.winner.is_some() && !i.decision && i.kill_credited { 20.0 } else if i.winner.is_some() { 5.0 } else { 0.0 };
    s += if i.comeback { 10.0 } else { 0.0 };
    s += if i.atmo_time[0] + i.atmo_time[1] > 0.5 { 5.0 } else { 0.0 };
    // Unforced exits are dull.
    if matches!(i.kill_cause, Some("zone")) {
        s -= 15.0;
    }
    s.clamp(0.0, 100.0)
}

/// Shot closeness score in 0..1 (1 = dead on).
pub fn shot_score(d: f64, tight: f64, wide: f64) -> f64 {
    let t = |r: f64| (1.0 - d.max(0.0) / r).max(0.0).powi(2);
    // wide <= 0: only the tight term (no reward for loose shots).
    if wide <= 0.0 { t(tight) } else { 0.5 * t(wide) + 0.5 * t(tight) }
}

/// An enemy round within this range makes strafing a dodge rather than a waste.
pub const CALM_RANGE: f64 = 250.0;
/// Launch range brackets for diagnostics.
pub const LAUNCH_CLOSE: f64 = 400.0;
pub const LAUNCH_MID: f64 = 800.0;
/// Reward components, summed per episode for diagnostics.
pub const REWARD_PARTS: [&str; 12] = ["dealt", "taken", "kill", "death", "end", "shot", "engage", "calm_burn", "shape_aim", "shape_safety", "shape_fuel", "scoop"];

/// Per-ship diagnostics for one episode: everything needed to explain what happened without
/// re-simulating it.
#[derive(Clone, Copy, Debug)]
pub struct ShipDiag {
    /// Propellant (kg) by use: main engine, strafe thrusters, strafe with no enemy round near.
    pub burn_main: f64,
    pub burn_rcs: f64,
    pub burn_rcs_calm: f64,
    pub thrust_time: f64,
    pub strafe_time: f64,
    pub strafe_calm_time: f64,
    /// Propellant fraction at 15/30/45/60 s (-1 if the episode ended first); when it ran dry.
    pub fuel_at: [f64; 4],
    pub t_dry: f64,
    pub death_t: f64,
    /// Zone: excursions, fuel at the last exit, and what happened after running dry.
    pub zone_exits: u32,
    pub fuel_at_last_exit: f64,
    pub safe_at_last_exit: f64,
    pub orbit_out_at_dry: bool,
    pub fires_after_dry: u32,
    pub hits_after_dry: u32,
    pub zone_reason: &'static str,
    /// Atmosphere: passes, time in the air, attitude while there, what was scooped.
    pub air_entries: u32,
    pub air_time: f64,
    pub facing_sum: f64,
    pub nose_first_time: f64,
    pub lift_up_time: f64,
    pub lift_down_time: f64,
    pub died_in_air: bool,
    pub first_pass_scooped: f64,
    /// Low point at the start and at the first air entry (drill avoidance shows here).
    pub rp_start: f64,
    pub rp_at_entry: f64,
    /// Launches by range at the trigger (close < LAUNCH_CLOSE, mid < LAUNCH_MID, far; or with the
    /// planet in the way), and what became of them.
    pub launch_close: u32,
    pub launch_mid: u32,
    pub launch_far: u32,
    pub launch_blocked: u32,
    pub close_landed: u32,
    pub close_missed: u32,
    pub far_landed: u32,
    /// Enemy close-range launches at this ship that missed.
    pub dodged: u32,
    /// Own missiles whose seeker locked on.
    pub missiles_locked: u32,
    /// Fog of war: time the enemy was in sight; shots fired at an enemy out of sight.
    pub enemy_visible_time: f64,
    pub shots_blind: u32,
    pub reward: [f64; 12],
}

impl Default for ShipDiag {
    fn default() -> Self {
        ShipDiag {
            burn_main: 0.0, burn_rcs: 0.0, burn_rcs_calm: 0.0, thrust_time: 0.0, strafe_time: 0.0, strafe_calm_time: 0.0,
            fuel_at: [-1.0; 4], t_dry: -1.0, death_t: -1.0, zone_exits: 0, fuel_at_last_exit: -1.0, safe_at_last_exit: -1.0,
            orbit_out_at_dry: false, fires_after_dry: 0, hits_after_dry: 0, zone_reason: "", air_entries: 0, air_time: 0.0,
            facing_sum: 0.0, nose_first_time: 0.0, lift_up_time: 0.0, lift_down_time: 0.0, died_in_air: false,
            first_pass_scooped: -1.0, rp_start: 0.0, rp_at_entry: -1.0, launch_close: 0, launch_mid: 0, launch_far: 0,
            launch_blocked: 0, close_landed: 0, close_missed: 0, far_landed: 0, dodged: 0, missiles_locked: 0, enemy_visible_time: 0.0, shots_blind: 0, reward: [0.0; 12],
        }
    }
}

/// The scripted skip pilot's body rates (action units) for a ship low over the planet, or None:
/// nose onto the airflow, canopy away from the planet. A teacher for imitation during skips.
pub fn skip_teacher(w: &World, me: usize) -> Option<[f32; 3]> {
    let (b, s) = (&w.bodies[me], &w.ships[me]);
    let (pc, _, pr) = w.planet()?;
    if !s.alive || (b.pos - pc).len() - pr - b.radius > 60.0 || b.vel.len() < 1e-6 {
        return None;
    }
    let q = s.orient;
    let v = q.inv_rotate(b.vel.normalized());
    let out = q.inv_rotate((b.pos - pc).normalized());
    let up = (out - v * out.dot(v)).normalized_or(Vec3::Y);
    let r = (Vec3::Z.cross(v) + Vec3::Y.cross(up)) * 0.75;
    Some([r.x.clamp(-1.0, 1.0) as f32, r.y.clamp(-1.0, 1.0) as f32, r.z.clamp(-1.0, 1.0) as f32])
}

/// Orbit-safety potential in -1..1: margins of the orbit's high point to the safe radius and of
/// its low point to the top of the atmosphere.
fn safety_potential(w: &World, me: usize) -> f64 {
    let (b, s) = (&w.bodies[me], &w.ships[me]);
    let Some((pc, gm, pr)) = w.planet() else { return 0.0 };
    if !s.alive {
        return 0.0;
    }
    let (rp, ra) = apsides(b.pos - pc, b.vel, gm);
    let high = if ra.is_finite() { ((w.safe_radius - ra) / 150.0).clamp(-1.0, 1.0) } else { -1.0 };
    // Skipping off the air is fine (lift carries a well-flown ship back out); the surface isn't.
    let low = ((rp - pr) / 60.0).clamp(-1.0, 1.0);
    // In [0, 1]: potentials are non-negative, so phi(terminal) = 0 makes dying cost, never pay.
    0.25 * (high + low) + 0.5
}

/// A tiny world just to initialize caches before the first reset.
fn world_stub() -> World {
    World::new(MatchConfig { seed: 0, ships: vec![PRESETS[0], PRESETS[0]], asteroids: 0, layout: crate::world::Layout::Empty })
}

pub fn cause_name(c: Cause) -> &'static str {
    match c {
        Cause::Slug => "slug",
        Cause::Ram => "ram",
        Cause::Asteroid => "asteroid",
        Cause::Planet => "planet",
        Cause::Atmosphere => "atmosphere",
        Cause::Zone => "zone",
        Cause::Wall => "wall",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn obs_is_finite_and_sized() {
        let mut env = RlEnv::new(3, 6, RewardCfg { aim: 0.5, ..Default::default() });
        let mut obs = vec![0.0f32; OBS_DIM];
        let mut act = vec![0.0f32; 2 * ACT_DIM];
        act[7] = 1.0;
        for _ in 0..400 {
            env.step(&act);
            for i in 0..2 {
                observe(&env.world, i, &mut obs);
                assert!(obs.iter().all(|v| v.is_finite()));
            }
        }
    }

    #[test]
    fn unforced_crash_earns_little_kill_credit() {
        let rc = RewardCfg::default();
        let mut env = RlEnv::new(4, 6, rc);
        let pr = crate::world::PLANET_RADIUS;
        env.world.bodies[1].pos = Vec3::new(pr + 20.0, 0.0, 0.0);
        env.world.bodies[1].vel = Vec3::new(-40.0, 0.0, 0.0);
        let act = vec![0.0f32; 2 * ACT_DIM];
        let mut got = None;
        for _ in 0..200 {
            let (r, info) = env.step(&act);
            if let Some(info) = info {
                got = Some((r, info));
                break;
            }
        }
        let (r, info) = got.expect("crash ends the match");
        assert_eq!(info.winner, Some(0));
        assert!(!info.kill_credited);
        assert!((r[0] - rc.kill * 0.25).abs() < 0.05, "survivor gets a quarter kill, got {}", r[0]);
        assert!(r[1] <= -rc.death + 0.05);
    }

    #[test]
    fn close_shots_are_rewarded_and_hits_most() {
        use crate::math::Quat;
        let rc = RewardCfg { dealt: 0.0, taken: 0.0, engage: 0.0, ..Default::default() };
        let run = |offset: f64| {
            let mut w = World::new(MatchConfig { seed: 3, ships: vec![PRESETS[2], PRESETS[2]], asteroids: 0, layout: crate::world::Layout::Empty });
            w.bodies[0].pos = Vec3::new(-150.0, 0.0, 0.0);
            w.bodies[1].pos = Vec3::new(150.0, offset, 0.0);
            w.ships[0].orient = Quat::from_to(FORWARD, Vec3::X);
            let mut env = RlEnv::new(1, 6, rc);
            env.world = w;
            env.tracker = Tracker::default();
            let mut act = vec![0.0f32; 2 * ACT_DIM];
            act[0] = -1.0;
            act[ACT_DIM] = -1.0;
            act[7] = 1.0;
            let mut total = 0.0;
            for k in 0..120 {
                if k == 1 {
                    act[7] = 0.0;
                }
                let (r, _) = env.step(&act);
                total += r[0] as f64;
            }
            total
        };
        let hit = run(0.0);
        let near = run(15.0);
        let far = run(80.0);
        let wild = run(900.0);
        assert!(hit > near && near > far && far > wild, "hit {hit} near {near} far {far} wild {wild}");
        assert!(far > 0.01, "the wide gradient pays for getting within hundreds of metres: {far}");
    }

    fn section(name: &str) -> usize {
        let mut at = 0;
        for &(n, l) in OBS_LAYOUT {
            if n == name {
                return at;
            }
            at += l;
        }
        panic!("no section {name}");
    }

    /// The instrumentation is sufficient: a trivial pilot that only reads its own observation
    /// (turn toward the aim hint, fire when the gunsight says the shot passes close) hits a
    /// coasting target. If this fails, agents cannot learn to shoot.
    #[test]
    fn observation_only_pilot_hits_a_coasting_target() {
        let (sight, aim) = (section("gunsight"), section("aim_hint"));
        let mut hits = 0;
        let mut shots = 0;
        for seed in 0..6u64 {
            let mut env = RlEnv::new(100 + seed, 5, RewardCfg::default());
            env.presets = [Some(2), Some(2)];
            env.reset();
            let mut obs = vec![0.0f32; OBS_DIM];
            for _ in 0..1500 {
                env.observe(0, &mut obs);
                let mut act = vec![0.0f32; 2 * ACT_DIM];
                act[0] = -1.0;
                act[ACT_DIM] = -1.0;
                act[4] = (-obs[aim + 1] * 4.0).clamp(-1.0, 1.0);
                act[5] = (obs[aim] * 4.0).clamp(-1.0, 1.0);
                act[7] = if obs[sight] * 50.0 < 4.0 && obs[sight + 6] < 0.5 { 1.0 } else { 0.0 };
                let (_, info) = env.step(&act);
                if let Some(info) = info {
                    hits += info.hits[0];
                    shots += info.shots[0];
                    break;
                }
            }
        }
        assert_eq!(OBS_LAYOUT.iter().map(|x| x.1).sum::<usize>(), OBS_DIM);
        assert!(shots > 0 && hits * 5 >= shots, "pilot hit {hits}/{shots}: instrumentation or gunsight is broken");
    }

    /// The instrumentation is sufficient to skip: a trivial pilot that only reads its own
    /// observation (nose along its velocity, belly toward the planet) dives from a 500 m
    /// high point to below the surface's top 5 m of air, dry, and comes back out refuelled.
    #[test]
    fn observation_only_pilot_skips_and_refuels() {
        use crate::world::PLANET_RADIUS;
        let me = section("self");
        for seed in 0..3u64 {
            let mut env = RlEnv::new(300 + seed, 6, RewardCfg::default());
            env.presets = [Some(2), Some(2)];
            env.reset();
            env.setup_skip_dive(5.0);
            let mut obs = vec![0.0f32; OBS_DIM];
            let mut low = false;
            loop {
                env.observe(0, &mut obs);
                let v = |k: usize| Vec3::new(obs[me + k] as f64, obs[me + k + 1] as f64, obs[me + k + 2] as f64);
                let (vel, to_planet) = (v(0).normalized(), v(6));
                let up = (-to_planet - vel * (-to_planet).dot(vel)).normalized();
                // Body-frame rate that turns the nose (Z) onto the velocity and the canopy (Y) away.
                let rate = (Vec3::Z.cross(vel) * 3.0 + Vec3::Y.cross(up) * 3.0) / 4.0;
                let mut act = vec![0.0f32; 2 * ACT_DIM];
                act[0] = -1.0;
                act[ACT_DIM] = -1.0;
                act[4] = rate.x.clamp(-1.0, 1.0) as f32;
                act[5] = rate.y.clamp(-1.0, 1.0) as f32;
                act[6] = rate.z.clamp(-1.0, 1.0) as f32;
                let (_, info) = env.step(&act);
                let w = &env.world;
                // An ended episode means the dive failed (the env resets to a fresh match).
                assert!(info.is_none(), "skip pilot died (seed {seed}): {:?}", info.map(|i| i.kill_cause));
                let r = w.bodies[0].pos.len();
                low |= r < PLANET_RADIUS + 60.0;
                if low && r > PLANET_RADIUS + 120.0 {
                    break;
                }
                assert!(w.t < 60.0, "never came back out");
            }
            let s = &env.world.ships[0];
            assert!(s.alive, "skip pilot crashed (seed {seed})");
            assert!(s.stats.propellant_scooped > 60.0, "scooped only {:.0} kg", s.stats.propellant_scooped);
            assert!(s.hull > 0.9 * s.params.hull, "skip cost {:.0} hull", s.params.hull - s.hull);
        }
    }

    #[test]
    fn skip_drill_starts_low_on_fuel_diving_into_the_air() {
        use crate::control::apsides;
        use crate::world::{PLANET_GM, PLANET_RADIUS};
        let mut env = RlEnv::new(5, 6, RewardCfg { fuel: 0.5, ..Default::default() });
        env.presets = [Some(2), Some(2)];
        env.skip_drill = 1.0;
        for _ in 0..20 {
            env.reset();
            let (w, s) = (&env.world, &env.world.ships[0]);
            assert!(s.propellant <= 0.3 * s.params.propellant + 1e-9);
            let (rp, _) = apsides(w.bodies[0].pos, w.bodies[0].vel, PLANET_GM);
            let alt = rp - PLANET_RADIUS - w.bodies[0].radius;
            assert!((-3.5..30.5).contains(&alt), "low point {alt:.1} m");
            assert!((w.bodies[1].pos - w.bodies[0].pos).len() >= 250.0 || w.bodies[1].pos.len() > 0.0);
            // Potentials are non-negative (dying never pays) and include fuel.
            assert!(env.potential(0) >= 0.0 && env.potential(1) >= 0.0);
        }
    }

    /// The diagnostics are an audit trail: they must add up to what actually happened.
    #[test]
    fn episode_diagnostics_add_up() {
        let rc = RewardCfg { fuel: 1.0, safety: 0.25, aim: 0.1, calm_burn: 2.0, shot_wide: 0.0, shot_radius: 15.0, ..Default::default() };
        let mut checked = 0;
        for seed in 0..6u64 {
            let mut env = RlEnv::new(40 + seed, 6, rc);
            env.presets = [Some(2), Some(2)];
            env.bot_mask = [true, true];
            env.skip_drill = if seed % 2 == 0 { 1.0 } else { 0.0 };
            env.reset();
            let act = vec![0.0f32; 2 * ACT_DIM];
            let used0 = [env.world.ships[0].stats.propellant_used, env.world.ships[1].stats.propellant_used];
            let mut used = used0;
            let mut info = None;
            for _ in 0..(120 * 250 / 6) {
                used = [env.world.ships[0].stats.propellant_used, env.world.ships[1].stats.propellant_used];
                let (_, i) = env.step(&act);
                if i.is_some() {
                    info = i;
                    break;
                }
            }
            let info = info.expect("episode ends");
            assert_eq!(info.drill, seed % 2 == 0);
            if info.drill {
                assert!(!info.drill_outcome.is_empty());
            }
            for s in 0..2 {
                let d = &info.diag[s];
                let total: f64 = d.reward.iter().sum();
                assert!((total - info.returns[s]).abs() < 1e-6, "reward parts {total} vs return {}", info.returns[s]);
                let burned = d.burn_main + d.burn_rcs;
                // The last step's burn happens after the final snapshot of `used`; allow one step.
                assert!(burned <= used[s] - used0[s] + 60.0 && burned + 60.0 >= used[s] - used0[s] - 1.0, "burn {burned} vs used {}", used[s] - used0[s]);
                assert!(d.burn_rcs_calm <= d.burn_rcs + 1e-9);
                let binned = d.launch_close + d.launch_mid + d.launch_far + d.launch_blocked;
                assert!(binned >= info.shots[s] && binned <= info.shots[s] + 1, "binned {binned} vs shots {}", info.shots[s]);
                assert!(d.close_landed + d.close_missed <= d.launch_close + 1);
                assert!(d.close_landed + d.far_landed <= info.hits[s] + 1);
                assert_eq!(d.dodged, info.diag[1 - s].close_missed);
                if info.kill_cause == Some("zone") && info.winner == Some(1 - s) {
                    assert!(!d.zone_reason.is_empty());
                }
                checked += 1;
            }
        }
        assert_eq!(checked, 12);
    }

    #[test]
    fn bot_vs_bot_episode_completes() {
        let mut env = RlEnv::new(9, 6, RewardCfg::default());
        env.bot_mask = [true, true];
        env.reset();
        let act = vec![0.0f32; 2 * ACT_DIM];
        let mut done = None;
        for _ in 0..(120 * 250 / 6) {
            let (_, info) = env.step(&act);
            if info.is_some() {
                done = info;
                break;
            }
        }
        let info = done.expect("episode should end by the time limit");
        assert!(info.duration > 0.0);
        assert!((0.0..=100.0).contains(&info.excitement));
    }
}
