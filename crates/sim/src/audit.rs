//! Instrumentation audit: every observation field, action channel, reward term and episode stat
//! is checked against ground truth from the world. If any of these fail, agents are learning
//! from (or being scored on) something other than what we think.

use crate::control::{apsides, closest_approach};
use crate::math::{Quat, Rng, Vec3};
use crate::params::WARDEN;
use crate::rl::*;
use crate::world::*;

const TOL: f64 = 1e-3;

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

fn obs(env: &RlEnv, ship: usize) -> Vec<f32> {
    let mut o = vec![0.0f32; OBS_DIM];
    env.observe(ship, &mut o);
    o
}

fn v(o: &[f32], at: usize) -> Vec3 {
    Vec3::new(o[at] as f64, o[at + 1] as f64, o[at + 2] as f64)
}

fn close(a: f64, b: f64, what: &str) {
    assert!((a - b).abs() <= TOL * (1.0 + b.abs()), "{what}: observed {a}, truth {b}");
}

fn close3(a: Vec3, b: Vec3, what: &str) {
    assert!((a - b).len() <= TOL * (1.0 + b.len()), "{what}: observed {a:?}, truth {b:?}");
}

/// A planet match with ship 0 given an arbitrary attitude, spin and some spent resources.
fn scene(seed: u64) -> RlEnv {
    let mut env = RlEnv::new(seed, 6, RewardCfg::default());
    env.presets = [Some(2), Some(2)];
    env.reset();
    let mut rng = Rng::new(seed);
    let w = &mut env.world;
    w.ships[0].orient = Quat::from_axis_angle(rng.unit_vec(), rng.range(0.0, 6.0));
    w.ships[0].ang_mom = rng.unit_vec() * 3000.0;
    w.ships[0].hull = 600.0;
    w.ships[0].propellant = 200.0;
    w.ships[0].ammo = 17;
    w.ships[0].reload = 1.5;
    w.ships[1].hull = 400.0;
    w.ships[1].ammo = 9;
    let m = w.ship_mass(0);
    w.bodies[0].mass = m;
    // Refresh the cached fire-control after editing the state.
    env.resync_knowledge();
    env
}

#[test]
fn self_section_matches_world() {
    for seed in 1..8 {
        let env = scene(seed);
        let o = obs(&env, 0);
        let w = &env.world;
        let (s, b) = (&w.ships[0], &w.bodies[0]);
        let q = s.orient;
        let (pc, gm, pr) = w.planet().unwrap();
        let at = section("self");
        close3(v(&o, at) * 100.0, q.inv_rotate(b.vel), "self velocity (body)");
        close3(v(&o, at + 3) * 6.0, q.inv_rotate(w.ang_vel(0)), "self angular velocity (body)");
        close3(v(&o, at + 6), q.inv_rotate(pc - b.pos).normalized(), "direction to planet (body)");
        let r = (b.pos - pc).len();
        close(o[at + 9] as f64 * 500.0, r - pr, "altitude");
        close(o[at + 11] as f64, r / w.safe_radius, "r / safe radius");
        close(o[at + 13] as f64 * 100.0, b.vel.dot((b.pos - pc) / r), "radial velocity");
        let (rp, ra) = apsides(b.pos - pc, b.vel, gm);
        close(o[at + 14] as f64 * 500.0, (rp - pr).clamp(-500.0, 2000.0), "periapsis altitude");
        if ra.is_finite() {
            close(o[at + 15] as f64 * 500.0, (ra - w.safe_radius).clamp(-2000.0, 2000.0), "apoapsis vs safe radius");
        }
        close3(v(&o, at + 16), q.inv_rotate((b.pos - pc).cross(b.vel).normalized()), "orbit normal (body)");
        close(o[at + 21] as f64, s.hull / s.params.hull, "hull fraction");
        close(o[at + 22] as f64, s.propellant / s.params.propellant, "propellant fraction");
        close(o[at + 24] as f64, s.ammo as f64 / s.params.driver.ammo as f64, "ammo fraction");
        close(o[at + 25] as f64, s.reload / s.params.driver.reload, "reload fraction");
        close(o[at + 26] as f64, 0.0, "not loaded while reloading");
    }
}

#[test]
fn enemy_section_matches_world() {
    for seed in 1..8 {
        let env = scene(seed);
        let o = obs(&env, 0);
        let w = &env.world;
        let q = w.ships[0].orient;
        let (b, e) = (&w.bodies[0], &w.bodies[1]);
        let at = section("enemy");
        let rel = e.pos - b.pos;
        close3(v(&o, at) * 500.0, q.inv_rotate(rel), "enemy position (body)");
        close(o[at + 3] as f64 * 500.0, rel.len(), "enemy distance");
        close3(v(&o, at + 4) * 100.0, q.inv_rotate(e.vel - b.vel), "enemy relative velocity (body)");
        close(o[at + 7] as f64 * 100.0, -(e.vel - b.vel).dot(rel.normalized()), "closing speed (+ = closing)");
        let efwd = w.forward(1);
        close3(v(&o, at + 8), q.inv_rotate(efwd), "enemy nose (body)");
        close(o[at + 11] as f64, efwd.dot(-rel.normalized()), "enemy nose toward me");
        close(o[at + 12] as f64, w.forward(0).dot(rel.normalized()), "my nose toward enemy");
        close(o[at + 14] as f64, w.ships[1].hull / w.ships[1].params.hull, "enemy hull");
        close(o[at + 16] as f64, w.ships[1].ammo as f64 / w.ships[1].params.driver.ammo as f64, "enemy ammo");
    }
}

/// The gunsight in the observation is the gunsight of the current nose, and it agrees with the
/// real flight of a round fired from a non-rotating ship.
#[test]
fn gunsight_section_is_the_true_launch_geometry() {
    // Missile fire control: off-axis distance of the target from the nose, time to intercept, and
    // the believed range, all matching the (fully known) geometry.
    for seed in 1..8 {
        let mut env = scene(seed);
        env.resync_knowledge();
        let o = obs(&env, 0);
        let (at, aim) = (section("gunsight"), section("aim_hint"));
        let w = &env.world;
        let rel = w.bodies[1].pos - w.bodies[0].pos;
        let fwd = w.forward(0);
        let off = (rel - fwd * rel.dot(fwd)).len();
        close(o[at] as f64 * 50.0, off.min(1000.0), "off-axis distance");
        close(o[aim + 3] as f64 * 50.0, rel.len().min(1000.0), "range");
    }
}

#[test]
fn observation_is_rotation_invariant() {
    for seed in 1..6 {
        let env = scene(seed);
        let before = obs(&env, 0);
        let mut env2 = scene(seed);
        let rot = Quat::from_axis_angle(Vec3::new(0.3, 1.0, -0.4), 1.234);
        let (pc, _, _) = env2.world.planet().unwrap();
        for b in env2.world.bodies.iter_mut() {
            b.pos = pc + rot.rotate(b.pos - pc);
            b.vel = rot.rotate(b.vel);
        }
        for s in env2.world.ships.iter_mut() {
            s.orient = rot.mul(s.orient).normalized();
            s.ang_mom = rot.rotate(s.ang_mom);
        }
        env2.resync_knowledge();
        let after = obs(&env2, 0);
        for i in 0..OBS_DIM {
            assert!((before[i] - after[i]).abs() < 2e-3 * (1.0 + before[i].abs()), "obs[{i}] changed under rotation: {} vs {}", before[i], after[i]);
        }
    }
}

/// Threat predictions agree with what the round actually does.
#[test]
fn threat_section_shows_incoming_missiles() {
    let mut env = scene(3);
    let w = &mut env.world;
    let dir = (w.bodies[0].pos - w.bodies[1].pos).normalized();
    w.ships[1].orient = Quat::from_to(FORWARD, dir);
    w.ships[1].ang_mom = Vec3::ZERO;
    w.ships[1].reload = 0.0;
    w.set_input(1, Input { fire: true, ..Default::default() });
    w.step();
    w.set_input(1, Input::default());
    env.resync_knowledge();
    let at = section("threats");
    let o = obs(&env, 0);
    let w = &env.world;
    let m = w.bodies.iter().find(|b| b.alive && matches!(b.kind, Kind::Round { owner: 1, .. })).unwrap();
    // A burning missile is seen at any range: range and burning flag must be right.
    close(o[at + 7] as f64 * 300.0, (m.pos - w.bodies[0].pos).len(), "missile range");
    assert!(o[at + 9] > 0.5, "burning flag");
    // Burnt out and beyond ROUND_RANGE, it goes dark.
    let id = m.id;
    let k = env.world.missiles.iter().position(|x| x.id == id).unwrap();
    env.world.missiles[k].dv = 0.0;
    env.world.missiles[k].burning = false;
    let kb = env.world.bodies.iter().position(|b| b.id == id).unwrap();
    let p0 = env.world.bodies[0].pos;
    env.world.bodies[kb].pos = p0 + Vec3::new(0.0, 0.0, crate::sense::ROUND_RANGE + 80.0);
    env.resync_knowledge();
    assert!(obs(&env, 0)[at..at + 12].iter().all(|x| *x == 0.0), "a burnt-out missile beyond range must be dark");
}

// ---------------- actions ----------------

fn quiet_world() -> World {
    let mut w = World::new(MatchConfig { seed: 1, ships: vec![WARDEN, WARDEN], asteroids: 0, layout: Layout::Empty });
    w.bodies[1].pos = Vec3::new(5000.0, 0.0, 0.0);
    w.ships[0].orient = Quat::from_axis_angle(Vec3::new(1.0, 2.0, 0.5), 0.9);
    w
}

fn act(thrust: f32, strafe: [f32; 3], rate: [f32; 3], fire: f32) -> [f32; ACT_DIM] {
    [thrust, strafe[0], strafe[1], strafe[2], rate[0], rate[1], rate[2], fire]
}

#[test]
fn engine_dead_zone_and_direction() {
    let mut w = quiet_world();
    let p0 = w.ships[0].propellant;
    for _ in 0..30 {
        let i = decode_action(&w, 0, &act(-0.7, [0.0; 3], [0.0; 3], 0.0));
        w.set_input(0, i);
        w.step();
    }
    assert_eq!(w.ships[0].propellant, p0, "thrust <= 0 must burn nothing");
    let fwd = w.forward(0);
    let v0 = w.bodies[0].vel;
    let i = decode_action(&w, 0, &act(1.0, [0.0; 3], [0.0; 3], 0.0));
    w.set_input(0, i);
    w.step();
    let dv = w.bodies[0].vel - v0;
    assert!(dv.normalized().dot(fwd) > 0.999, "engine pushes along the nose");
    assert!(w.ships[0].propellant < p0);
}

#[test]
fn strafe_dead_zone_and_axes() {
    let mut w = quiet_world();
    let p0 = w.ships[0].propellant;
    let i = decode_action(&w, 0, &act(-1.0, [0.45, -0.45, 0.45], [0.0; 3], 0.0));
    w.set_input(0, i);
    w.step();
    assert_eq!(w.ships[0].propellant, p0, "strafe inside the dead zone must burn nothing");
    for (k, axis) in [Vec3::X, Vec3::Y, Vec3::Z].into_iter().enumerate() {
        let mut w = quiet_world();
        let mut s = [0.0f32; 3];
        s[k] = 1.0;
        let v0 = w.bodies[0].vel;
        let i = decode_action(&w, 0, &act(-1.0, s, [0.0; 3], 0.0));
        w.set_input(0, i);
        w.step();
        let dv = w.ships[0].orient.inv_rotate(w.bodies[0].vel - v0);
        assert!(dv.normalized().dot(axis) > 0.999, "strafe channel {k} pushes along body axis {k}");
    }
}

#[test]
fn rate_channels_turn_the_right_way() {
    for (k, axis) in [Vec3::X, Vec3::Y, Vec3::Z].into_iter().enumerate() {
        let mut w = quiet_world();
        let mut r = [0.0f32; 3];
        r[k] = 0.5;
        for _ in 0..240 {
            let i = decode_action(&w, 0, &act(-1.0, [0.0; 3], r, 0.0));
            w.set_input(0, i);
            w.step();
        }
        let wb = w.ships[0].orient.inv_rotate(w.ang_vel(0));
        let want = axis * (0.5 * WARDEN.max_rate);
        assert!((wb - want).len() < 0.05 * WARDEN.max_rate, "rate channel {k}: body rate {wb:?}, wanted {want:?}");
    }
    // Rate 0 holds attitude steady.
    let mut w = quiet_world();
    w.ships[0].ang_mom = Vec3::new(0.0, 2000.0, 0.0);
    for _ in 0..240 {
        let i = decode_action(&w, 0, &act(-1.0, [0.0; 3], [0.0; 3], 0.0));
        w.set_input(0, i);
        w.step();
    }
    assert!(w.ang_vel(0).len() < 0.02, "zero rate command damps spin");
}

#[test]
fn trigger_fires_only_when_loaded() {
    let mut w = quiet_world();
    let mut fired = 0;
    for _ in 0..(120 * 5) {
        let i = decode_action(&w, 0, &act(-1.0, [0.0; 3], [0.0; 3], 1.0));
        w.set_input(0, i);
        w.step();
        fired += w.events.iter().filter(|e| matches!(e, Event::Fire { ship: 0, .. })).count();
        w.events.clear();
    }
    // 5 s held with a 6 s reload: exactly one shot.
    assert_eq!(fired, 1);
    let mut w = quiet_world();
    let i = decode_action(&w, 0, &act(-1.0, [0.0; 3], [0.0; 3], 0.4));
    w.set_input(0, i);
    w.step();
    assert_eq!(w.ships[0].stats.shots, 0, "trigger below 0.5 does not fire");
}

// ---------------- rewards ----------------

/// With only the scaffolds on, the discounted return of an episode is exactly -phi(s0):
/// potential-based shaping cannot change which policy is best.
#[test]
fn scaffolds_are_potential_based() {
    let rc = RewardCfg { dealt: 0.0, taken: 0.0, kill: 0.0, death: 0.0, decision: 0.0, stalemate: 0.0, engage: 0.0, shot: 0.0, aim: 0.5, safety: 0.5, gamma: 0.99, ..Default::default() };
    let mut env = RlEnv::new(11, 6, rc);
    env.presets = [Some(2), Some(2)];
    env.reset();
    let phi0 = env.potential_for_audit(0);
    let mut rng = Rng::new(5);
    let mut ret = 0.0;
    let mut disc = 1.0;
    for _ in 0..3000 {
        let mut a = [0.0f32; 2 * ACT_DIM];
        for x in a.iter_mut() {
            *x = rng.range(-1.0, 1.0) as f32;
        }
        let (r, info) = env.step(&a);
        ret += disc * r[0] as f64;
        disc *= rc.gamma as f64;
        if info.is_some() {
            break;
        }
    }
    // If the episode is still running, add the bootstrap term gamma^T * phi(s_T).
    let tail = if env.world.t > 0.1 { disc * env.potential_for_audit(0) } else { 0.0 };
    assert!((ret - (tail - phi0)).abs() < 1e-3, "shaped return {ret} should equal gamma^T phi(s_T) - phi(s0) = {}", tail - phi0);
}

#[test]
fn damage_rewards_match_hull_changes() {
    let rc = RewardCfg { kill: 0.0, death: 0.0, decision: 0.0, stalemate: 0.0, engage: 0.0, shot: 0.0, ..Default::default() };
    let mut env = RlEnv::new(2, 6, rc);
    env.presets = [Some(2), Some(2)];
    env.reset();
    let (h0, h1) = (env.world.ships[0].hull, env.world.ships[1].hull);
    env.world.ships[1].stats.damage_dealt += 170.0; // pretend ship 1 dealt 170 to ship 0
    env.world.ships[0].stats.damage_taken += 170.0;
    env.world.ships[0].hull = h0 - 170.0;
    let (r, _) = env.step(&[0.0f32; 2 * ACT_DIM]);
    let _ = h1;
    close(r[0] as f64, -(rc.taken as f64) * 170.0 / WARDEN.hull, "taken reward");
    close(r[1] as f64, rc.dealt as f64 * 170.0 / WARDEN.hull, "dealt reward");
}

#[test]
fn proximity_reward_scales_with_distance() {
    let rc = RewardCfg { dealt: 0.0, taken: 0.0, kill: 0.0, death: 0.0, decision: 0.0, stalemate: 0.0, shot: 0.0, ..Default::default() };
    let mut per_sec = Vec::new();
    for d in [30.0, 200.0, 450.0, 900.0] {
        let mut env = RlEnv::new(1, 6, rc);
        env.world = World::new(MatchConfig { seed: 1, ships: vec![WARDEN, WARDEN], asteroids: 0, layout: Layout::Empty });
        env.world.bodies[1].pos = env.world.bodies[0].pos + Vec3::new(d, 0.0, 0.0);
        let (r, _) = env.step(&[-1.0f32; 2 * ACT_DIM]);
        per_sec.push(r[0] as f64 / (env.world.arena.dt * 6.0));
    }
    assert!(per_sec[0] > per_sec[1] && per_sec[1] > per_sec[2] && per_sec[3] == 0.0, "proximity per second {per_sec:?}");
    assert!(per_sec[0] <= rc.engage as f64 + 1e-9);
}

// ---------------- episode stats ----------------

/// Counts events independently of the stats counters, through the replay hook.
struct Counter {
    shots: std::sync::Arc<std::sync::Mutex<[u32; 2]>>,
    hits: std::sync::Arc<std::sync::Mutex<[u32; 2]>>,
}
impl Recorder for Counter {
    fn frame(&mut self, _w: &World, events: &[Event]) {
        for e in events {
            match *e {
                Event::Fire { ship, .. } => self.shots.lock().unwrap()[ship] += 1,
                Event::Hit { victim, attacker: Some(a), cause: Cause::Slug, .. } if a != victim => self.hits.lock().unwrap()[a] += 1,
                _ => {}
            }
        }
    }
    fn end(&mut self, _info: &EpisodeInfo) {}
    fn take(&mut self) -> Option<String> {
        None
    }
}

/// Episode summaries agree with an independent count of the event stream.
#[test]
fn episode_stats_match_events() {
    for seed in [21u64, 22, 23] {
        let mut env = RlEnv::new(seed, 6, RewardCfg::default());
        env.bot_mask = [true, true];
        env.presets = [Some(2), Some(2)];
        let shots = std::sync::Arc::new(std::sync::Mutex::new([0u32; 2]));
        let hits = std::sync::Arc::new(std::sync::Mutex::new([0u32; 2]));
        env.recorder = Some(Box::new(Counter { shots: shots.clone(), hits: hits.clone() }));
        env.record_every = 1;
        env.reset();
        *shots.lock().unwrap() = [0; 2];
        *hits.lock().unwrap() = [0; 2];
        let a = [0.0f32; 2 * ACT_DIM];
        let info = loop {
            if let (_, Some(info)) = env.step(&a) {
                break info;
            }
        };
        assert_eq!(info.shots, *shots.lock().unwrap(), "shots in summary vs events (seed {seed})");
        assert_eq!(info.hits, *hits.lock().unwrap(), "hits in summary vs events (seed {seed})");
    }
}
