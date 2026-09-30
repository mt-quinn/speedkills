use crate::bot::{Bot, Personality};
use crate::math::{Quat, Vec3};
use crate::params::{ANCHOR, SKATER, SLINGER};
use crate::world::*;
use crate::world::Layout;

fn empty_world(ships: Vec<crate::ShipParams>) -> World {
    World::new(MatchConfig { seed: 7, ships, asteroids: 0, layout: Layout::Empty })
}

fn place(w: &mut World, i: usize, pos: Vec3, facing: Vec3) {
    w.bodies[i].pos = pos;
    w.bodies[i].vel = Vec3::ZERO;
    w.ships[i].orient = Quat::from_to(FORWARD, facing.normalized());
    w.ships[i].ang_mom = Vec3::ZERO;
}

#[test]
fn throw_conserves_momentum() {
    let mut w = empty_world(vec![SLINGER, SLINGER]);
    place(&mut w, 0, Vec3::new(-200.0, 0.0, 0.0), Vec3::Y);
    place(&mut w, 1, Vec3::new(200.0, 0.0, 0.0), Vec3::Y);
    let p0 = w.momentum();
    w.set_input(0, Input { charge: true, ..Default::default() });
    for _ in 0..120 {
        w.step();
    }
    w.set_input(0, Input::default());
    w.step();
    assert!(w.bodies.iter().any(|b| matches!(b.kind, Kind::Slug { .. })), "slug thrown");
    let p1 = w.momentum();
    assert!((p1 - p0).len() < 1e-6, "momentum drift {:?}", p1 - p0);
    // Recoil pushes the thrower backward.
    assert!(w.bodies[0].vel.y < -1.0);
}

#[test]
fn tether_is_equal_and_opposite() {
    let mut w = empty_world(vec![SLINGER, SKATER]);
    place(&mut w, 0, Vec3::new(-100.0, 0.0, 0.0), Vec3::X);
    place(&mut w, 1, Vec3::new(100.0, 0.0, 0.0), Vec3::X);
    w.set_input(0, Input { tether: true, reel: 1.0, ..Default::default() });
    w.set_input(1, Input { tether: false, ..Default::default() });
    let p0 = w.momentum();
    let mut attached = false;
    for _ in 0..240 {
        w.step();
        attached |= matches!(w.ships[0].tether, Tether::Attached { .. });
    }
    assert!(attached, "harpoon should hit the other ship");
    // They were pulled toward each other.
    assert!(w.bodies[0].vel.x > 0.5 && w.bodies[1].vel.x < -0.5);
    // Momentum is conserved up to collision damage (chunks get a kick); none should occur yet.
    let p1 = w.momentum();
    assert!((p1 - p0).len() < 1e-6, "momentum drift {:?}", p1 - p0);
}

#[test]
fn slug_hit_damages_and_spawns_debris() {
    let mut w = empty_world(vec![SLINGER, ANCHOR]);
    place(&mut w, 0, Vec3::new(-100.0, 0.0, 0.0), Vec3::X);
    place(&mut w, 1, Vec3::new(100.0, 0.0, 0.0), Vec3::X);
    let m1 = w.bodies[1].mass;
    w.set_input(0, Input { charge: true, ..Default::default() });
    for _ in 0..60 {
        w.step();
    }
    w.set_input(0, Input::default());
    let mut hit = false;
    for _ in 0..240 {
        w.step();
        hit |= w.events.iter().any(|e| matches!(e, Event::Hit { victim: 1, .. }));
    }
    assert!(hit);
    assert!(w.bodies[1].mass < m1 - 10.0);
    assert!(w.bodies.iter().any(|b| b.kind == Kind::Debris));
}

#[test]
fn gentle_contact_scoops() {
    let mut w = empty_world(vec![SLINGER, SLINGER]);
    place(&mut w, 0, Vec3::ZERO, Vec3::X);
    place(&mut w, 1, Vec3::new(300.0, 0.0, 0.0), Vec3::X);
    let m0 = w.bodies[0].mass;
    let id = 999;
    w.bodies.push(Body {
        id,
        kind: Kind::Debris,
        pos: Vec3::new(12.0, 0.0, 0.0),
        vel: Vec3::new(-5.0, 0.0, 0.0),
        mass: 30.0,
        radius: radius_for(30.0, w.arena.density),
        alive: true,
        born: 0.0,
        no_scoop_until: 0.0,
    });
    for _ in 0..240 {
        w.step();
    }
    assert!(w.body_index(id).is_none(), "debris absorbed");
    assert!((w.bodies[0].mass - (m0 + 30.0)).abs() < 1e-6);
}

#[test]
fn tucking_arms_spins_up() {
    let mut w = empty_world(vec![SKATER, SKATER]);
    place(&mut w, 0, Vec3::ZERO, Vec3::X);
    w.ships[0].arms = 1.0;
    w.ships[0].ang_mom = Vec3::new(0.0, 0.0, 5000.0);
    let w0 = w.ang_vel(0).len();
    w.set_input(0, Input { arms: 0.0, ..Default::default() });
    for _ in 0..120 {
        w.step();
    }
    let w1 = w.ang_vel(0).len();
    assert!(w1 > w0 * 5.0, "spin {w0} -> {w1}");
}

#[test]
fn deterministic() {
    let run = || {
        let mut w = World::new(MatchConfig { seed: 42, ships: vec![SLINGER, ANCHOR], asteroids: 6, layout: Layout::Planet });
        let mut bots = [
            Bot::new(Personality::for_design("Slinger", &mut crate::Rng::new(1)), 1),
            Bot::new(Personality::for_design("Anchor", &mut crate::Rng::new(2)), 2),
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
fn well_bends_and_nebula_ablates() {
    let mut w = empty_world(vec![SLINGER, SLINGER]);
    w.hazards.push(Hazard::Well { pos: Vec3::new(0.0, 100.0, 0.0), gm: 3.0e5, core: 40.0 });
    place(&mut w, 0, Vec3::ZERO, Vec3::X);
    place(&mut w, 1, Vec3::new(0.0, -600.0, 0.0), Vec3::X);
    w.step();
    assert!(w.bodies[0].vel.y > 0.0, "pulled toward the well");

    let mut w = empty_world(vec![SLINGER, SLINGER]);
    w.hazards.push(Hazard::Nebula { pos: Vec3::ZERO, radius: 200.0, drag: 0.003 });
    place(&mut w, 0, Vec3::ZERO, Vec3::X);
    place(&mut w, 1, Vec3::new(0.0, -600.0, 0.0), Vec3::X);
    w.bodies[0].vel = Vec3::new(80.0, 0.0, 0.0);
    let m0 = w.bodies[0].mass;
    for _ in 0..60 {
        w.step();
    }
    assert!(w.bodies[0].vel.x < 75.0, "drag slows: {:?}", w.bodies[0].vel);
    assert!(w.bodies[0].mass < m0 - 1.0, "speed ablates");
}

#[test]
fn planet_orbits_and_zones_burn() {
    let mut w = World::new(MatchConfig::standard(5, vec![SLINGER, SKATER]));
    // A ship with no input in its starting circular orbit stays near its radius.
    let r0 = w.bodies[0].pos.len();
    for _ in 0..(120 * 20) {
        w.step();
    }
    let r1 = w.bodies[0].pos.len();
    assert!((r1 - r0).abs() < 25.0, "orbit drifted {r0} -> {r1}");

    // Beyond the safe radius, mass burns.
    let mut w = World::new(MatchConfig::standard(5, vec![SLINGER, SKATER]));
    w.bodies[0].pos = Vec3::new(w.safe_radius + 250.0, 0.0, 0.0);
    w.bodies[0].vel = Vec3::ZERO;
    let m0 = w.bodies[0].mass;
    for _ in 0..120 {
        w.step();
    }
    assert!(w.bodies[0].mass < m0 - 10.0, "zone burns");
}
