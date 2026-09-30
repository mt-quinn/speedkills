use crate::bot::{Bot, Personality};
use crate::math::{Quat, Rng, Vec3};
use crate::params::{HORNET, LANCER, WARDEN};
use crate::world::*;

fn duel(a: crate::ShipParams, b: crate::ShipParams) -> World {
    let mut w = World::new(MatchConfig { seed: 7, ships: vec![a, b], asteroids: 0, layout: Layout::Empty });
    w.bodies[0].pos = Vec3::new(-150.0, 0.0, 0.0);
    w.bodies[1].pos = Vec3::new(150.0, 0.0, 0.0);
    w.ships[0].orient = Quat::from_to(FORWARD, Vec3::X);
    w.ships[1].orient = Quat::from_to(FORWARD, Vec3::Y);
    w
}

#[test]
fn firing_conserves_momentum() {
    // The launch kick conserves momentum; after that the missile's own motor adds some.
    let mut w = duel(WARDEN, WARDEN);
    let p0 = w.momentum();
    w.set_input(0, Input { fire: true, ..Default::default() });
    w.step();
    assert!(w.ships[0].stats.shots >= 1);
    let m = w.bodies.iter().find(|b| matches!(b.kind, Kind::Round { .. })).unwrap();
    let motor = w.missiles[0].acc * (w.arena.dt * m.mass);
    assert!((w.momentum() - p0 - motor).len() < 1e-6, "launch momentum drift");
    assert!(w.bodies[0].vel.x < 0.0, "the launch kick pushes back");
}

#[test]
fn thrust_burns_propellant_and_lightens() {
    let mut w = duel(HORNET, HORNET);
    w.set_input(0, Input { thrust: 1.0, ..Default::default() });
    for _ in 0..120 {
        w.step();
    }
    let s = &w.ships[0];
    assert!(s.propellant < HORNET.propellant - 50.0);
    assert!((w.bodies[0].mass - w.ship_mass(0)).abs() < 1e-9);
    // 1 s at ~8 g.
    assert!(w.bodies[0].vel.len() > 60.0);
}

#[test]
fn planet_orbit_is_stable_and_crash_is_lethal() {
    // Starting orbits are eccentric: the coasting orbit's energy is what must hold.
    let mut w = World::new(MatchConfig::standard(5, vec![WARDEN, HORNET]));
    let energy = |w: &World| 0.5 * w.bodies[0].vel.len_sq() - PLANET_GM / w.bodies[0].pos.len();
    let e0 = energy(&w);
    for _ in 0..(120 * 20) {
        w.step();
    }
    assert!(((energy(&w) - e0) / e0).abs() < 0.01, "orbit drifted");

    let mut w = World::new(MatchConfig::standard(5, vec![WARDEN, HORNET]));
    w.bodies[0].pos = Vec3::new(PLANET_RADIUS + 100.0, 0.0, 0.0);
    w.bodies[0].vel = Vec3::new(-30.0, 0.0, 0.0);
    for _ in 0..(120 * 6) {
        w.step();
    }
    assert!(!w.ships[0].alive, "planet impact kills");
}

#[test]
fn atmosphere_brakes_and_heats() {
    let mut w = World::new(MatchConfig::standard(5, vec![WARDEN, HORNET]));
    let alt = 15.0;
    let r = PLANET_RADIUS + WARDEN.radius + alt;
    w.bodies[0].pos = Vec3::new(r, 0.0, 0.0);
    let v_circ = (PLANET_GM / r).sqrt();
    w.bodies[0].vel = Vec3::new(0.0, 0.0, v_circ * 1.2);
    let h0 = w.ships[0].hull;
    let v0 = w.bodies[0].vel.len();
    for _ in 0..12 {
        w.step();
    }
    assert!(w.bodies[0].vel.len() < v0, "drag slows");
    assert!(w.ships[0].hull < h0, "heating hurts");
}

#[test]
fn zones_burn_hull() {
    let mut w = World::new(MatchConfig::standard(5, vec![WARDEN, HORNET]));
    w.bodies[0].pos = Vec3::new(w.safe_radius + 250.0, 0.0, 0.0);
    w.bodies[0].vel = Vec3::ZERO;
    let h0 = w.ships[0].hull;
    for _ in 0..120 {
        w.step();
    }
    assert!(w.ships[0].hull < h0 - 20.0);
}

#[test]
fn deterministic() {
    let run = || {
        let mut w = World::new(MatchConfig::standard(42, vec![LANCER, HORNET]));
        let mut bots = [
            Bot::new(Personality::for_design("Lancer", &mut Rng::new(1)), 1),
            Bot::new(Personality::for_design("Hornet", &mut Rng::new(2)), 2),
        ];
        for _ in 0..(120 * 30) {
            for (i, b) in bots.iter_mut().enumerate() {
                let inp = b.act(&w, i);
                w.set_input(i, inp);
            }
            w.step();
            w.events.clear();
        }
        w.fingerprint()
    };
    assert_eq!(run(), run());
}

#[test]
fn gunsight_matches_reality() {
    use crate::control::{gunsight, orbital_aim};
    let mut hits = 0;
    for seed in 1..6u64 {
        let mut w = World::new(MatchConfig::standard(seed, vec![WARDEN, WARDEN]));
        let (dir, pred) = orbital_aim(&w, 0, 1, 25.0);
        w.ships[0].orient = Quat::from_to(FORWARD, dir);
        w.ships[0].ang_mom = Vec3::ZERO;
        let sight = gunsight(&w, 0, 1, w.forward(0), 25.0);
        w.set_input(0, Input { fire: true, ..Default::default() });
        w.step();
        w.set_input(0, Input::default());
        let mut best = f64::INFINITY;
        let mut hit = false;
        for _ in 0..(120 * 30) {
            w.step();
            for e in w.events.drain(..) {
                if let Event::Hit { victim: 1, cause: Cause::Slug, .. } = e {
                    hit = true;
                }
            }
            for b in &w.bodies {
                if matches!(b.kind, Kind::Round { owner: 0, .. }) && b.alive {
                    best = best.min((b.pos - w.bodies[1].pos).len());
                }
            }
        }
        println!("seed {seed}: aim predicted {:.1} m at {:.1}s, sight {:.1} m, actual closest {:.1} m, hit {hit}", pred.dist, pred.time, sight.dist, best);
        hits += hit as u32;
        assert!(best < WARDEN.radius + 3.0, "an aimed shot at a coasting target passes within the hull + 3 m (was {best:.1})");
    }
    assert!(hits >= 4, "aimed shots at a coasting target should almost always hit ({hits}/5)");
}

/// Fly one pass from a 500 m high point to a low point `alt` above the air's floor, holding an
/// attitude, dry. Returns (alive, kg scooped, hull lost).
fn skim_pass(alt: f64, attitude: fn(Vec3, Vec3) -> Quat) -> (bool, f64, f64) {
    let mut w = World::new(MatchConfig { seed: 3, ships: vec![WARDEN, WARDEN], asteroids: 0, layout: Layout::Planet });
    w.bodies[1].pos = Vec3::new(-600.0, 0.0, 0.0);
    w.bodies[1].vel = Vec3::new(0.0, 0.0, (PLANET_GM / 600.0).sqrt());
    w.ships[0].propellant = 0.0;
    w.bodies[0].mass = w.ship_mass(0);
    let (ra, rp) = (500.0, PLANET_RADIUS + WARDEN.radius + alt);
    let a = 0.5 * (ra + rp);
    w.bodies[0].pos = Vec3::new(ra, 0.0, 0.0);
    w.bodies[0].vel = Vec3::new(0.0, (PLANET_GM * (2.0 / ra - 1.0 / a)).sqrt(), 0.0);
    let mut low = false;
    for _ in 0..(120 * 60) {
        w.ships[0].orient = attitude(w.bodies[0].vel, w.bodies[0].pos.normalized());
        w.step();
        let r = w.bodies[0].pos.len();
        low |= r < 250.0;
        if !w.ships[0].alive || (low && r > 250.0) {
            break;
        }
    }
    (w.ships[0].alive, w.ships[0].stats.propellant_scooped, WARDEN.hull - w.ships[0].hull)
}

#[test]
fn skipping_off_the_air_is_the_safe_refuel() {
    let skip = |v: Vec3, out: Vec3| Quat::look(FORWARD, UP, v, out);
    let flat = |v: Vec3, _: Vec3| Quat::look(FORWARD, UP, v, Vec3::Z);
    let side = |_: Vec3, _: Vec3| Quat::from_to(FORWARD, Vec3::Z);
    // Belly to the planet: lift carries the ship back out even from the air's floor.
    for alt in [20.0, 5.0, 0.0] {
        let (alive, kg, hull) = skim_pass(alt, skip);
        assert!(alive, "skip from {alt} m should survive");
        assert!(kg > 40.0 && hull < 60.0, "skip from {alt} m: {kg:.0} kg for {hull:.0} hp");
    }
    // The same dive without lift, or broadside, goes into the ground.
    assert!(!skim_pass(5.0, flat).0, "no-lift pass at 5 m should crash");
    assert!(!skim_pass(20.0, side).0, "broadside pass at 20 m should crash");
    // Nose-first scoops several times what broadside does (shallow enough for both to live).
    let (fwd, side_kg) = (skim_pass(35.0, flat).1, skim_pass(35.0, side).1);
    assert!(fwd > 2.0 * side_kg, "nose-first {fwd:.0} kg vs broadside {side_kg:.0} kg");
    // Scooping stops at a full tank.
    let mut w = World::new(MatchConfig { seed: 3, ships: vec![WARDEN, WARDEN], asteroids: 0, layout: Layout::Planet });
    let r = PLANET_RADIUS + WARDEN.radius + 5.0;
    w.bodies[0].pos = Vec3::new(r, 0.0, 0.0);
    w.bodies[0].vel = Vec3::new(0.0, (PLANET_GM / r).sqrt(), 0.0);
    w.step();
    assert!(w.ships[0].propellant <= WARDEN.propellant + 1e-9);
}

/// One pass through the air from a 500 m apoapsis: what a skim costs and what it scoops.
/// `cargo test -p sk-sim skim_table -- --ignored --nocapture`
#[test]
#[ignore]
fn skim_table() {
    let drags: Vec<f64> = std::env::var("DRAGS").map(|s| s.split(',').map(|x| x.parse().unwrap()).collect()).unwrap_or(vec![crate::params::ARENA.atmo_drag]);
    for drag in drags {
    println!("drag {drag}\nperi alt  mode  | scooped kg  hull lost  dv lost  new apo  outcome");
    for alt in [40.0, 30.0, 20.0, 15.0, 10.0, 5.0, 0.0, -3.0] {
        for mode in ["skip", "flat", "dive", "side"] {
            let mut w = World::new(MatchConfig { seed: 3, ships: vec![WARDEN, WARDEN], asteroids: 0, layout: Layout::Planet });
            w.arena.atmo_drag = drag;
            w.bodies[1].pos = Vec3::new(-600.0, 0.0, 0.0);
            w.bodies[1].vel = Vec3::new(0.0, (PLANET_GM / 600.0).sqrt(), 0.0);
            w.ships[0].propellant = 0.0;
            w.bodies[0].mass = w.ship_mass(0);
            let (ra, rp) = (500.0, PLANET_RADIUS + WARDEN.radius + alt);
            let a = 0.5 * (ra + rp);
            w.bodies[0].pos = Vec3::new(ra, 0.0, 0.0);
            w.bodies[0].vel = Vec3::new(0.0, (PLANET_GM * (2.0 / ra - 1.0 / a)).sqrt(), 0.0);
            let h0 = w.ships[0].hull;
            let mut vmax: f64 = 0.0;
            let mut low = false;
            let mut out = "back";
            for _ in 0..(120 * 60) {
                let v = w.bodies[0].vel;
                let radial = w.bodies[0].pos.normalized();
                w.ships[0].orient = match mode {
                    "skip" => Quat::look(FORWARD, UP, v, radial),
                    "dive" => Quat::look(FORWARD, UP, v, -radial),
                    "flat" => Quat::look(FORWARD, UP, v, Vec3::Z),
                    _ => Quat::from_to(FORWARD, Vec3::Z),
                };
                w.step();
                let r = w.bodies[0].pos.len();
                vmax = vmax.max(w.bodies[0].vel.len());
                if !w.ships[0].alive {
                    out = if w.bodies[0].pos.len() < PLANET_RADIUS + 10.0 { "CRASH" } else { "BURNT" };
                    break;
                }
                if r < 250.0 {
                    low = true;
                }
                if low && r > 250.0 && w.bodies[0].pos.dot(w.bodies[0].vel) > 0.0 {
                    break;
                }
            }
            let (p, v) = (w.bodies[0].pos, w.bodies[0].vel);
            let (_, apo) = crate::control::apsides(p, v, PLANET_GM);
            let v_ideal = (PLANET_GM * (2.0 / p.len() - 1.0 / a)).sqrt();
            println!(
                "{alt:>6.0} m  {:>5} | {:>10.0}  {:>9.0}  {:>7.1}  {:>7.0}  {out}",
                mode,
                w.ships[0].stats.propellant_scooped,
                h0 - w.ships[0].hull,
                v_ideal - v.len(),
                apo
            );
            let _ = vmax;
        }
    }
    }
}

#[test]
#[ignore]
fn missile_break_table() {
    for lag in [0.4, 0.7, 1.0] {
        let row = |main: bool| -> String {
            (1..=40).map(|k| { let (_, d) = missile_break(k as f64 * 0.2, main, lag); if d > 0.0 { format!("{:>4.0}", d) } else { "  ··".into() } }).collect()
        };
        println!("lag {lag}: break at t_go = 0.2 … 8.0 s (every 0.2 s); damage taken (·· = escaped)");
        println!("  main  {}", row(true));
        println!("  strafe{}", row(false));
    }
    let (g, d) = missile_break(-1.0, true, 0.7);
    println!("never breaking: gap {g:.1} m, damage {d:.0}");
}

/// The missile gate, from the break sweep: strafing never escapes; a main-engine break escapes
/// only if started early enough, and how early depends on the missile's (hidden) steering lag.
#[test]
fn breaking_from_a_missile_is_a_matter_of_timing() {
    let hit = |tgo: f64, main: bool, lag: f64| missile_break(tgo, main, lag).1 > 0.0;
    assert!(missile_break(-1.0, true, 0.7).1 > 0.4 * WARDEN.hull.min(435.0), "a target that never breaks is hit");
    for tgo in [0.4, 1.0, 2.0, 3.0, 5.0] {
        assert!(hit(tgo, false, 0.7), "strafing at t_go {tgo} must not escape");
    }
    for lag in [0.4, 0.7, 1.0] {
        assert!(hit(0.4, true, lag), "a break 0.4 s out is too late (lag {lag})");
    }
    assert!(!hit(1.4, true, 1.0) && hit(1.4, true, 0.4), "at 1.4 s out, escape depends on the missile's lag");
    assert!(!hit(3.6, true, 0.4), "an early break escapes even an agile missile");
}

#[test]
#[ignore]
fn missile_debug() {
    let mut w = World::new(MatchConfig { seed: 5, ships: vec![WARDEN, WARDEN], asteroids: 0, layout: Layout::Empty });
    w.bodies[0].pos = Vec3::ZERO;
    w.bodies[0].vel = Vec3::ZERO;
    w.bodies[1].pos = Vec3::new(600.0, 0.0, 0.0);
    w.bodies[1].vel = Vec3::new(0.0, 40.0, 0.0);
    w.ships[0].orient = Quat::from_to(FORWARD, Vec3::X);
    w.resync_knowledge();
    w.set_input(0, Input { fire: true, ..Default::default() });
    w.step();
    w.set_input(0, Input::default());
    println!("missiles {} bodies {}", w.missiles.len(), w.bodies.len());
    for k in 0..(120 * 12) {
        for e in &w.events { if !matches!(e, Event::Fire { .. }) { println!("t {:.2} {:?}", w.t, e); } }
        if k % 60 == 0 {
            if let Some(m) = w.bodies.iter().find(|b| matches!(b.kind, Kind::Round { .. })) {
                let st = w.missiles.first();
                println!("t {:.1} missile pos {:?} vel {:.0} dist {:.0} locked {:?} dv {:?} acc {:?}", w.t, m.pos, m.vel.len(), (w.bodies[1].pos - m.pos).len(), st.map(|s| s.locked), st.map(|s| s.dv as i32), st.map(|s| s.acc.len() as i32));
            }
        }
        w.step();
    }
}

/// Missile vs a target that breaks at a chosen time-to-go (negative: never). Returns (min hull
/// gap, missile damage taken).
fn missile_break(break_tgo: f64, main_engine: bool, lag: f64) -> (f64, f64) {
    let mut w = World::new(MatchConfig { seed: 5, ships: vec![WARDEN, WARDEN], asteroids: 0, layout: Layout::Empty });
    w.bodies[0].pos = Vec3::ZERO;
    w.bodies[0].vel = Vec3::ZERO;
    w.bodies[1].pos = Vec3::new(600.0, 0.0, 0.0);
    w.bodies[1].vel = Vec3::new(0.0, 40.0, 0.0);
    w.ships[0].orient = Quat::from_to(FORWARD, Vec3::X);
    w.ships[1].orient = Quat::from_to(FORWARD, Vec3::Y);
    w.resync_knowledge();
    w.set_input(0, Input { fire: true, ..Default::default() });
    w.step();
    w.set_input(0, Input::default());
    w.missiles[0].lag = lag;
    let mut dmg = 0.0;
    let mut min_gap = f64::INFINITY;
    let mut breaking = false;
    let mut break_t = 0.0;
    for _ in 0..(120 * 30) {
        for e in w.events.drain(..) {
            if let Event::Hit { victim: 1, cause: Cause::Slug, damage, .. } = e {
                dmg += damage;
            }
        }
        if breaking && w.t - break_t > 12.0 {
            w.set_input(1, Input::default());
        }
        let Some(m) = w.bodies.iter().find(|b| b.alive && matches!(b.kind, Kind::Round { .. })).cloned() else { break };
        let rel = w.bodies[1].pos - m.pos;
        let vc = -(w.bodies[1].vel - m.vel).dot(rel.normalized());
        min_gap = min_gap.min(rel.len() - w.bodies[1].radius);
        if !breaking && break_tgo >= 0.0 && vc > 1.0 && rel.len() / vc <= break_tgo {
            breaking = true;
            break_t = w.t;
            // Break hard across the line of sight (the beam turn), nose along the break.
            let los = rel.normalized();
            let dir = (w.bodies[1].vel - los * w.bodies[1].vel.dot(los)).normalized_or(Vec3::Z);
            if main_engine {
                w.ships[1].orient = Quat::from_to(FORWARD, dir);
                w.ships[1].ang_mom = Vec3::ZERO;
                w.set_input(1, Input { thrust: 1.0, ..Default::default() });
            } else {
                let body = w.ships[1].orient.inv_rotate(dir);
                w.set_input(1, Input { strafe: body, ..Default::default() });
            }
        }
        w.step();
    }
    (min_gap, dmg)
}
