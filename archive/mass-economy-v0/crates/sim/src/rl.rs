//! Reinforcement-learning interface: ego-centric observations, a flight-computer action space,
//! shaped rewards, and per-match "excitement" metrics. Dependency-free; the Python binding
//! (`crates/py`) vectorizes `RlEnv`.
//!
//! Observations are in the ship's body frame (forward = +Z) so the policy learns one skill
//! regardless of where in the arena it is.

use crate::bot::{apsides, Bot, Personality};
use crate::control::rate_torque;
use crate::math::{Rng, Vec3};
use crate::params::PRESETS;
use crate::world::{BodyId, Cause, Event, Hazard, Input, Kind, MatchConfig, Tether, World};

pub use crate::world::FORWARD;

pub const OBS_DIM: usize = 164;
/// [thrust 0..1, pitch/yaw/roll rate -1..1, arms 0..1, reel -1..1, field -1..1, charge 0/1, tether 0/1]
pub const ACT_DIM: usize = 9;
pub const MAX_RATE: f64 = 3.0;

const POS: f64 = 500.0;
const VEL: f64 = 100.0;
const K_SLUGS: usize = 4;
const K_DEBRIS: usize = 4;
const K_ROCKS: usize = 3;

#[derive(Clone, Copy, Debug)]
pub struct RewardCfg {
    /// Per fraction of the enemy's reserve capacity knocked off.
    pub dealt: f32,
    /// Per fraction of own reserve capacity lost to anything (hits, zones, planet...).
    pub taken: f32,
    /// Per fraction of own reserve capacity scooped.
    pub scoop: f32,
    /// Terminal reward for a win by destruction (negated for the loser).
    pub kill: f32,
    /// Terminal reward for a win on decision at the bell.
    pub decision: f32,
    /// Per second spent within 250 m of the enemy (engagement pressure; 0 disables).
    pub engage: f32,
}

impl Default for RewardCfg {
    fn default() -> Self {
        RewardCfg { dealt: 1.0, taken: 0.6, scoop: 0.15, kill: 1.0, decision: 0.3, engage: 0.0 }
    }
}

/// Map a policy action to sim input. Rates go through the ship's flight computer.
pub fn decode_action(w: &World, me: usize, a: &[f32]) -> Input {
    let f = |k: usize| a[k] as f64;
    let rate = Vec3::new(f(1).clamp(-1.0, 1.0), f(2).clamp(-1.0, 1.0), f(3).clamp(-1.0, 1.0)) * MAX_RATE;
    Input {
        thrust: f(0).clamp(0.0, 1.0),
        torque: rate_torque(w, me, rate),
        arms: f(4).clamp(0.0, 1.0),
        reel: f(5).clamp(-1.0, 1.0),
        field: f(6).clamp(-1.0, 1.0),
        charge: f(7) > 0.5,
        tether: f(8) > 0.5,
    }
}

fn planet(w: &World) -> Option<(Vec3, f64, f64)> {
    w.hazards.iter().find_map(|h| match *h {
        Hazard::Planet { pos, gm, radius } => Some((pos, gm, radius)),
        _ => None,
    })
}

fn preset_index(name: &str) -> usize {
    PRESETS.iter().position(|p| p.name == name).unwrap_or(0)
}

/// Write ship `me`'s observation into `out` (length OBS_DIM).
pub fn observe(w: &World, me: usize, out: &mut [f32]) {
    let mut o = Obs { buf: out, i: 0 };
    let s = &w.ships[me];
    let b = &w.bodies[me];
    let q = s.orient;
    let body = |v: Vec3| q.inv_rotate(v);
    let p = &s.params;
    let enemy = 1 - me;
    let e = &w.bodies[enemy];
    let es = &w.ships[enemy];

    // --- self ---
    o.v3(body(b.vel) / VEL);
    o.v3(body(w.ang_vel(me)) / MAX_RATE);
    let (pc, gm, pr) = planet(w).unwrap_or((Vec3::ZERO, 1.0, 0.0));
    let rv = b.pos - pc;
    let r = rv.len();
    o.v3(body(-rv).normalized());
    o.f((r - pr) / POS);
    let safe = if w.safe_radius.is_finite() { w.safe_radius } else { w.arena.arena_radius };
    o.f(r / safe);
    o.f(((safe - r) / 200.0).clamp(-3.0, 3.0));
    o.f(b.vel.dot(rv.normalized()) / VEL);
    let (rp, ra) = apsides(rv, b.vel, gm);
    o.f(((rp - pr) / POS).clamp(-1.0, 4.0));
    o.f(if ra.is_finite() { ((ra - safe) / POS).clamp(-4.0, 4.0) } else { 4.0 });
    o.f(s.zone_burn / 15.0);
    o.f(w.reserve(me) / p.reserve_capacity());
    o.f(b.mass / p.start_mass);
    o.f(s.charge / p.throw_max);
    o.f(if s.throw_cd > 0.0 { 1.0 } else { 0.0 });
    o.f((s.tether_cd / p.tether_cooldown).clamp(0.0, 1.0));
    let (tk, tpos, tension, rest, on_enemy) = tether_info(w, me);
    o.onehot(tk, 3);
    o.f(tension);
    o.f(rest);
    o.v3(body(tpos - b.pos) / POS);
    o.flag(on_enemy);
    o.f(s.arms);
    o.f(s.thrust_level);
    o.f(s.field_level);

    // --- own design ---
    o.f(p.core_mass / 1000.0);
    o.f(p.start_mass / 1000.0);
    o.f(p.max_thrust / p.start_mass / 20.0);
    o.f(p.max_torque / 30_000.0);
    o.f(p.arm_gain / 6.0);
    o.f(p.throw_speed / 200.0);
    o.f(p.throw_min / 100.0);
    o.f(p.throw_max / 100.0);
    o.f(p.tether_len / 300.0);
    o.f(p.tether_speed / 300.0);
    o.f(p.reel_speed / 50.0);
    o.f(p.tether_break / 100_000.0);
    o.f(p.field_range / 200.0);
    o.f(p.field_accel / 20.0);
    o.f(p.field_max_force / 30_000.0);
    o.f(p.exhaust_vel / 1300.0);

    // --- enemy ---
    let rel = e.pos - b.pos;
    let dist = rel.len().max(1e-6);
    let relv = e.vel - b.vel;
    o.v3(body(rel) / POS);
    o.f(dist / POS);
    o.v3(body(relv) / VEL);
    o.f(-relv.dot(rel / dist) / VEL);
    let efwd = es.orient.rotate(crate::world::FORWARD);
    o.v3(body(efwd));
    o.f(efwd.dot(-rel / dist));
    o.f(w.forward(me).dot(rel / dist));
    o.flag(es.alive);
    o.f(w.reserve(enemy) / es.params.reserve_capacity());
    o.f(e.mass / 1000.0);
    o.f(es.charge / es.params.throw_max);
    let (etk, _, _, _, e_on_me) = tether_info(w, enemy);
    o.onehot(etk, 3);
    o.flag(e_on_me);
    o.flag(on_enemy);
    o.f(es.thrust_level);
    o.f(es.field_level);
    o.f(w.ang_vel(enemy).len() / MAX_RATE);
    o.onehot(preset_index(es.params.name), 3);

    // --- nearest slugs (by distance) ---
    let mut slugs: Vec<(f64, usize)> = w
        .bodies
        .iter()
        .enumerate()
        .filter(|(_, x)| x.alive && matches!(x.kind, Kind::Slug { .. }))
        .map(|(j, x)| ((x.pos - b.pos).len(), j))
        .collect();
    slugs.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
    for k in 0..K_SLUGS {
        if let Some(&(_, j)) = slugs.get(k) {
            let x = &w.bodies[j];
            o.v3(body(x.pos - b.pos) / POS);
            o.v3(body(x.vel - b.vel) / VEL);
            o.f(x.mass / 50.0);
            o.flag(matches!(x.kind, Kind::Slug { owner } if owner == me));
        } else {
            o.zeros(8);
        }
    }

    // --- best debris (mass over distance) ---
    let mut debris: Vec<(f64, usize)> = w
        .bodies
        .iter()
        .enumerate()
        .filter(|(_, x)| x.alive && x.kind == Kind::Debris)
        .map(|(j, x)| (-(x.mass / ((x.pos - b.pos).len() + 20.0)), j))
        .collect();
    debris.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
    for k in 0..K_DEBRIS {
        if let Some(&(_, j)) = debris.get(k) {
            let x = &w.bodies[j];
            o.v3(body(x.pos - b.pos) / POS);
            o.v3(body(x.vel - b.vel) / VEL);
            o.f(x.mass / 50.0);
        } else {
            o.zeros(7);
        }
    }

    // --- nearest asteroids (by surface distance) ---
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
            o.f(x.radius / 40.0);
        } else {
            o.zeros(7);
        }
    }

    // --- global ---
    o.f(w.t / w.arena.time_limit);
    o.f(safe / 800.0);
    o.flag(w.t > w.arena.sudden_death_at);
    o.onehot(preset_index(p.name), 3);
    debug_assert_eq!(o.i, OBS_DIM);
    // Non-finite guard: never hand NaNs to the learner.
    for v in out.iter_mut() {
        if !v.is_finite() {
            *v = 0.0;
        }
    }
}

/// (kind 0 none/1 flying/2 attached, point, tension frac, rest frac, attached-to-enemy)
fn tether_info(w: &World, me: usize) -> (usize, Vec3, f64, f64, bool) {
    let s = &w.ships[me];
    let b = &w.bodies[me];
    let enemy_id = w.bodies[1 - me].id;
    match s.tether {
        Tether::None => (0, b.pos, 0.0, 0.0, false),
        Tether::Flying { pos, .. } => (1, pos, 0.0, 0.0, false),
        Tether::Attached { target, rest } => {
            let tp = w.body_index(target).map(|j| w.bodies[j].pos).unwrap_or(b.pos);
            (2, tp, s.tension / s.params.tether_break, rest / s.params.tether_len, target == enemy_id)
        }
    }
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
    pub hits: [u32; 2],
    pub throws: [u32; 2],
    pub rams: u32,
    pub near_misses: u32,
    pub lead_changes: u32,
    pub first_blood: Option<f64>,
    pub close_frac: f64,
    pub comeback: bool,
    pub tether_attaches: u32,
    pub scooped: [f64; 2],
    pub zone_time: [f64; 2],
    pub excitement: f64,
}

#[derive(Default)]
struct Tracker {
    returns: [f64; 2],
    last_dealt: [f64; 2],
    last_taken: [f64; 2],
    last_scooped: [f64; 2],
    near: Vec<(BodyId, f64, bool)>,
    near_misses: u32,
    lead: Option<usize>,
    lead_changes: u32,
    max_deficit: [f64; 2],
    first_blood: Option<f64>,
    close_time: f64,
    zone_time: [f64; 2],
    last_hit_cause: [Option<Cause>; 2],
    kill_cause: Option<&'static str>,
    tether_attaches: u32,
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
    /// Per ship: scripted bot in control instead of the policy.
    pub bot_mask: [bool; 2],
    bots: [Option<Bot>; 2],
    /// Fixed preset per ship, or random each episode.
    pub presets: [Option<usize>; 2],
    rng: Rng,
    tracker: Tracker,
    /// Recording: every `record_every` sim steps a frame is captured.
    pub recorder: Option<Box<dyn Recorder>>,
    pub record_every: u64,
    pending_events: Vec<Event>,
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
            bots: [None, None],
            presets: [None, None],
            rng,
            tracker: Tracker::default(),
            recorder: None,
            record_every: 8,
            pending_events: Vec::new(),
        };
        env.reset();
        env
    }

    pub fn reset(&mut self) {
        let pick = |rng: &mut Rng, fixed: Option<usize>| fixed.unwrap_or((rng.f64() * PRESETS.len() as f64) as usize % PRESETS.len());
        let a = pick(&mut self.rng, self.presets[0]);
        let b = pick(&mut self.rng, self.presets[1]);
        self.world = World::new(MatchConfig::standard(self.rng.next_u64(), vec![PRESETS[a], PRESETS[b]]));
        for i in 0..2 {
            self.bots[i] = if self.bot_mask[i] {
                let name = PRESETS[if i == 0 { a } else { b }].name;
                Some(Bot::new(Personality::for_design(name, &mut self.rng), self.rng.next_u64()))
            } else {
                None
            };
        }
        self.tracker = Tracker::default();
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
                    Some(bot) => bot.act(&self.world, i),
                    None => decode_action(&self.world, i, &actions[i * ACT_DIM..(i + 1) * ACT_DIM]),
                };
                self.world.set_input(i, inp);
            }
            self.world.step();
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

        let mut r = [0.0f64; 2];
        for i in 0..2 {
            let st = self.world.ships[i].stats;
            let cap = self.world.ships[i].params.reserve_capacity();
            let ecap = self.world.ships[1 - i].params.reserve_capacity();
            let t = &mut self.tracker;
            r[i] += self.reward.dealt as f64 * (st.damage_dealt - t.last_dealt[i]) / ecap;
            r[i] -= self.reward.taken as f64 * (st.damage_taken - t.last_taken[i]) / cap;
            r[i] += self.reward.scoop as f64 * (st.mass_scooped - t.last_scooped[i]) / cap;
            t.last_dealt[i] = st.damage_dealt;
            t.last_taken[i] = st.damage_taken;
            t.last_scooped[i] = st.mass_scooped;
        }
        if self.reward.engage != 0.0 && (self.world.bodies[0].pos - self.world.bodies[1].pos).len() < 250.0 {
            let v = self.reward.engage as f64 * dt * self.action_repeat as f64;
            r[0] += v;
            r[1] += v;
        }

        let mut info = None;
        if self.world.finished {
            if let Some(wi) = self.world.winner {
                let decision = self.world.t >= self.world.arena.time_limit - 1e-6;
                let v = if decision { self.reward.decision } else { self.reward.kill } as f64;
                r[wi] += v;
                r[1 - wi] -= v;
            }
            self.tracker.returns[0] += r[0];
            self.tracker.returns[1] += r[1];
            let summary = self.summarize();
            if let Some(r) = self.recorder.as_mut() {
                r.end(&summary);
            }
            info = Some(summary);
            self.reset();
        } else {
            self.tracker.returns[0] += r[0];
            self.tracker.returns[1] += r[1];
        }
        ([r[0] as f32, r[1] as f32], info)
    }

    fn observe_step(&mut self, dt: f64) {
        let w = &self.world;
        let t = &mut self.tracker;
        for e in &w.events {
            match *e {
                Event::Hit { victim, attacker, cause, .. } => {
                    t.last_hit_cause[victim] = Some(cause);
                    if t.first_blood.is_none() && attacker.is_some_and(|a| a != victim) {
                        t.first_blood = Some(w.t);
                    }
                }
                Event::Kill { victim, .. } => {
                    t.kill_cause = Some(t.last_hit_cause[victim].map(cause_name).unwrap_or("burn"));
                }
                Event::TetherAttach { .. } => t.tether_attaches += 1,
                _ => {}
            }
        }
        // Near misses: a slug passes within 8 m of the other ship's hull and moves away.
        let mut seen = Vec::new();
        for x in w.bodies.iter().filter(|x| x.alive) {
            let Kind::Slug { owner } = x.kind else { continue };
            let target = &w.bodies[1 - owner];
            if !w.ships[1 - owner].alive {
                continue;
            }
            let d = (x.pos - target.pos).len() - target.radius - x.radius;
            seen.push(x.id);
            match t.near.iter_mut().find(|n| n.0 == x.id) {
                Some(n) => {
                    if d < n.1 {
                        n.1 = d;
                    } else if n.1 < 8.0 && !n.2 && d > n.1 + 2.0 {
                        n.2 = true;
                        t.near_misses += 1;
                    }
                }
                None => t.near.push((x.id, d, false)),
            }
        }
        t.near.retain(|n| seen.contains(&n.0));

        if (w.bodies[0].pos - w.bodies[1].pos).len() < 250.0 {
            t.close_time += dt;
        }
        for i in 0..2 {
            if w.ships[i].zone_burn > 0.0 {
                t.zone_time[i] += dt;
            }
        }
        if w.tick % 60 == 0 {
            let f = |i: usize| w.reserve(i) / w.ships[i].params.reserve_capacity();
            let diff = f(0) - f(1);
            t.max_deficit[0] = t.max_deficit[0].max(-diff);
            t.max_deficit[1] = t.max_deficit[1].max(diff);
            let now = if diff > 0.08 { Some(0) } else if diff < -0.08 { Some(1) } else { t.lead };
            if t.lead.is_some() && now != t.lead {
                t.lead_changes += 1;
            }
            t.lead = now;
        }
    }

    fn summarize(&self) -> EpisodeInfo {
        let w = &self.world;
        let t = &self.tracker;
        let st = |i: usize| w.ships[i].stats;
        let winner = w.winner;
        let decision = winner.is_some() && w.t >= w.arena.time_limit - 1e-6;
        let comeback = winner.is_some_and(|wi| t.max_deficit[wi] > 0.25);
        let hits = [st(0).hits_landed, st(1).hits_landed];
        let throws = [st(0).throws, st(1).throws];
        let close_frac = t.close_time / w.t.max(1.0);
        let mut info = EpisodeInfo {
            presets: [preset_index(w.ships[0].params.name), preset_index(w.ships[1].params.name)],
            winner,
            decision,
            duration: w.t,
            kill_cause: if winner.is_some() && !decision { t.kill_cause.or(Some("burn")) } else { None },
            returns: t.returns,
            hits,
            throws,
            rams: st(0).rams + st(1).rams,
            near_misses: t.near_misses,
            lead_changes: t.lead_changes,
            first_blood: t.first_blood,
            close_frac,
            comeback,
            tether_attaches: t.tether_attaches,
            scooped: [st(0).mass_scooped, st(1).mass_scooped],
            zone_time: t.zone_time,
            excitement: 0.0,
        };
        info.excitement = excitement(&info);
        info
    }
}

/// A 0..100 spectator score. Deliberately simple and documented so it can be argued with:
/// hard-won hits, close calls, swings, closeness, decisive endings, comebacks, variety.
pub fn excitement(i: &EpisodeInfo) -> f64 {
    let hits = (i.hits[0] + i.hits[1]) as f64;
    let mut s = 0.0;
    s += 20.0 * (hits / 8.0).min(1.0);
    s += 15.0 * (i.near_misses as f64 / 6.0).min(1.0);
    s += 15.0 * (i.lead_changes as f64 / 3.0).min(1.0);
    s += 15.0 * (i.close_frac * 2.0).min(1.0);
    s += if i.winner.is_some() && !i.decision { 15.0 } else if i.winner.is_some() { 5.0 } else { 0.0 };
    s += if i.comeback { 10.0 } else { 0.0 };
    let variety = [i.tether_attaches > 0, i.rams > 0, i.scooped[0] + i.scooped[1] > 40.0, hits > 0.0]
        .iter()
        .filter(|&&b| b)
        .count() as f64;
    s += 10.0 * variety / 4.0;
    // Burning out in the zones or dying to the planet unforced is dull.
    if matches!(i.kill_cause, Some("zone") | Some("burn")) {
        s -= 10.0;
    }
    s.clamp(0.0, 100.0)
}

fn cause_name(c: Cause) -> &'static str {
    match c {
        Cause::Slug => "slug",
        Cause::Ram => "ram",
        Cause::Debris => "debris",
        Cause::Asteroid => "asteroid",
        Cause::Wall => "wall",
        Cause::Well => "well",
        Cause::Nebula => "nebula",
        Cause::Planet => "planet",
        Cause::Zone => "zone",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn obs_is_finite_and_sized() {
        let mut env = RlEnv::new(3, 6, RewardCfg::default());
        let mut obs = vec![0.0f32; OBS_DIM];
        let act = vec![0.0f32; 2 * ACT_DIM];
        for _ in 0..200 {
            env.step(&act);
            for i in 0..2 {
                observe(&env.world, i, &mut obs);
                assert!(obs.iter().all(|v| v.is_finite()));
            }
        }
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
