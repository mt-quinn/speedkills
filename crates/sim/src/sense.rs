//! Sensing: what each ship knows. Information is the contested resource.
//!
//! - A ship is seen (with line of sight past the planet) inside VISUAL_RANGE, or at any range
//!   while it is loud: main engine lit, firing (the muzzle flash), glowing in the air, or
//!   being hit (the impact flash).
//!   Strafe thrusters are quiet. Out of sight, the enemy is where its last sighting coasts to,
//!   inside an uncertainty bubble that grows with the acceleration it could have used unseen
//!   (strafe only while in line of sight; the main engine too once it has been out of sight).
//! - Rounds are dark: an enemy missile is seen within ROUND_RANGE of the observer (with line
//!   of sight), or at any range while its motor burns. A shot's flash shows who fired and from where, not where the round is going.
//! - Enemy status (propellant, ammunition, reload, attitude) is known as of the last sighting;
//!   its hull is always known (you see your hits land).
//!
//! Everything a ship decides from (its observation, its fire control, a bot's logic) is computed
//! from `perceived`: the world rebuilt from its knowledge. Physics and rewards use the truth.
use crate::math::Vec3;
use crate::world::{segment_sphere, Event, Kind, World};

pub const VISUAL_RANGE: f64 = 300.0;
pub const ROUND_RANGE: f64 = 300.0;
const UNC_CAP: f64 = 3000.0;

#[derive(Clone, Copy, Debug)]
pub struct Contact {
    /// Believed position and velocity (the last sighting, coasted forward).
    pub pos: Vec3,
    pub vel: Vec3,
    pub seen_t: f64,
    pub visible: bool,
    /// Line of sight has been kept since the last sighting (so no unseen main-engine burn).
    pub los_kept: bool,
    pub uncertainty: f64,
    /// Status as of the last sighting.
    pub propellant: f64,
    pub ammo: u32,
    pub reload: f64,
    pub orient: crate::math::Quat,
    /// The enemy's last muzzle flash seen: where and when.
    pub flash: Option<(Vec3, f64)>,
}

#[derive(Clone, Debug)]
pub struct Knowledge {
    /// contacts[i] = what ship i knows about ship 1 - i.
    pub contacts: [Contact; 2],
    /// Enemy rounds each ship can currently see (ids).
    pub rounds_seen: [Vec<u32>; 2],
}

fn contact_of(w: &World, j: usize) -> Contact {
    let (b, s) = (&w.bodies[j], &w.ships[j]);
    Contact { pos: b.pos, vel: b.vel, seen_t: w.t, visible: true, los_kept: true, uncertainty: 0.0, propellant: s.propellant, ammo: s.ammo, reload: s.reload, orient: s.orient, flash: None }
}

/// Line of sight between two points, past the planet.
pub fn line_of_sight(w: &World, a: Vec3, b: Vec3) -> bool {
    match w.planet() {
        Some((pc, _, pr)) => segment_sphere(a, b, pc, pr).is_none(),
        None => true,
    }
}

/// The ship is loud this step: main engine, a shot, glowing in the air, or being hit (the
/// impact flash).
pub fn loud(w: &World, j: usize) -> bool {
    let s = &w.ships[j];
    s.thrust_level > 0.05
        || s.heating > 0.5
        || s.scoop > 0.0
        || w.events.iter().any(|e| match e {
            Event::Fire { ship, .. } => *ship == j,
            Event::Hit { victim, .. } | Event::Burst { victim, .. } => *victim == j,
            _ => false,
        })
}

impl Knowledge {
    /// Start of a match: both ships know where the other starts.
    pub fn new(w: &World) -> Knowledge {
        let mut k = Knowledge { contacts: [contact_of(w, 1), contact_of(w, 0)], rounds_seen: [Vec::new(), Vec::new()] };
        k.update(w, 0.0);
        k
    }

    /// Advance by one sim step (`dt`, already applied to the world).
    pub fn update(&mut self, w: &World, dt: f64) {
        for i in 0..2.min(w.ships.len()) {
            let j = 1 - i;
            let (me, them) = (&w.bodies[i], &w.bodies[j]);
            let los = line_of_sight(w, me.pos, them.pos);
            let seen = w.ships[j].alive && los && ((them.pos - me.pos).len() < VISUAL_RANGE || loud(w, j));
            let c = &mut self.contacts[i];
            if los && w.events.iter().any(|e| matches!(e, Event::Fire { ship, .. } if *ship == j)) {
                c.flash = Some((them.pos, w.t));
            }
            if seen || !w.ships[j].alive {
                let flash = c.flash;
                *c = contact_of(w, j);
                c.flash = flash;
                c.visible = seen;
            } else {
                // Coast the belief with the same gravity the world uses.
                if dt > 0.0 {
                    if let Some((pc, gm, pr)) = w.planet() {
                        let d = pc - c.pos;
                        let r2 = d.len_sq().max(pr * pr);
                        c.vel += d.normalized() * (gm / r2 * dt);
                    }
                    c.pos += c.vel * dt;
                }
                c.visible = false;
                c.los_kept &= los;
                let p = &w.ships[j].params;
                let mass = p.start_mass();
                let a = if c.los_kept { 3.0f64.sqrt() * p.rcs_thrust / mass } else { p.max_thrust / mass + 3.0f64.sqrt() * p.rcs_thrust / mass };
                let tau = w.t - c.seen_t;
                c.uncertainty = (0.5 * a * tau * tau).min(UNC_CAP);
            }
            self.rounds_seen[i] = w
                .bodies
                .iter()
                // Dark within ROUND_RANGE; a missile with its motor burning is seen at any range.
                .filter(|x| {
                    x.alive
                        && matches!(x.kind, Kind::Round { owner, .. } if owner == j)
                        && ((x.pos - me.pos).len() < ROUND_RANGE || w.missiles.iter().any(|m| m.id == x.id && m.burning))
                        && line_of_sight(w, me.pos, x.pos)
                })
                .map(|x| x.id)
                .collect();
        }
    }

    /// The world as ship `me` knows it: the enemy at its believed state, only the enemy rounds
    /// it can see, enemy status as of the last sighting.
    pub fn perceived(&self, w: &World, me: usize) -> World {
        let mut p = w.clone();
        p.know = None;
        let j = 1 - me;
        let c = &self.contacts[me];
        p.bodies[j].pos = c.pos;
        p.bodies[j].vel = c.vel;
        let s = &mut p.ships[j];
        s.propellant = c.propellant;
        s.ammo = c.ammo;
        s.reload = c.reload;
        s.orient = c.orient;
        if !c.visible {
            s.ang_mom = Vec3::ZERO;
            s.thrust_level = 0.0;
            s.strafe_level = Vec3::ZERO;
            s.heating = 0.0;
            s.scoop = 0.0;
            s.zone_burn = 0.0;
        }
        let seen = &self.rounds_seen[me];
        p.bodies.retain(|x| !matches!(x.kind, Kind::Round { owner, .. } if owner == j) || seen.contains(&x.id));
        p.events.retain(|e| match e {
            Event::Fire { ship, .. } => *ship == me || c.visible,
            _ => true,
        });
        p
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::params::WARDEN;
    use crate::rl::{RewardCfg, RlEnv, OBS_DIM};
    use crate::world::{Input, PLANET_GM};

    /// Ship 0 at 400 m, ship 1 far across the sky, both on circular orbits, in line of sight.
    fn env_far() -> RlEnv {
        let mut env = RlEnv::new(11, 6, RewardCfg::default());
        env.presets = [Some(2), Some(2)];
        env.reset();
        let w = &mut env.world;
        for b in w.bodies.iter_mut().skip(2) {
            b.alive = false;
        }
        let v = |r: f64| (PLANET_GM / r).sqrt();
        w.bodies[0].pos = Vec3::new(400.0, 0.0, 0.0);
        w.bodies[0].vel = Vec3::new(0.0, v(400.0), 0.0);
        w.bodies[1].pos = Vec3::new(300.0, 520.0, 0.0);
        w.bodies[1].vel = Vec3::new(-v(600.0) * 520.0 / 600.0, v(600.0) * 300.0 / 600.0, 0.0);
        env.resync_knowledge();
        env
    }
    fn obs(env: &RlEnv) -> Vec<f32> {
        let mut o = vec![0.0; OBS_DIM];
        env.observe(0, &mut o);
        o
    }

    #[test]
    fn a_hidden_enemy_leaks_nothing() {
        let mut env = env_far();
        let d = (env.world.bodies[1].pos - env.world.bodies[0].pos).len();
        assert!(d > VISUAL_RANGE && line_of_sight(&env.world, env.world.bodies[0].pos, env.world.bodies[1].pos));
        env.world.resync_knowledge();
        assert!(!env.world.contact(0).visible, "quiet enemy {d:.0} m away must be unseen");
        env.refresh_sight(false);
        let before = obs(&env);
        // Move and turn the enemy (quietly): nothing ship 0 sees may change.
        let w = &mut env.world;
        w.bodies[1].pos += Vec3::new(40.0, -25.0, 10.0);
        w.bodies[1].vel += Vec3::new(3.0, 1.0, -2.0);
        w.ships[1].orient = crate::math::Quat::from_axis_angle(Vec3::new(0.3, 1.0, 0.2), 1.1);
        w.ships[1].propellant *= 0.3;
        w.ships[1].ammo = 3;
        env.refresh_sight(false);
        assert_eq!(obs(&env), before, "the observation changed with the hidden enemy's true state");
        // Negative control: the same enemy firing is seen (its flash gives it away).
        env.world.ships[1].reload = 0.0;
        env.world.set_input(1, Input { fire: true, ..Default::default() });
        env.world.step();
        
        assert!(env.world.contact(0).visible && env.world.contact(0).flash.is_some(), "a shot must reveal the shooter");
        env.refresh_sight(false);
        assert_ne!(obs(&env), before);
    }

    #[test]
    fn the_planet_hides_and_range_reveals() {
        let mut env = env_far();
        let w = &mut env.world;
        // Close, but with the planet between: unseen.
        w.bodies[1].pos = Vec3::new(-230.0, 0.0, 0.0);
        env.world.resync_knowledge();
        assert!(!env.world.contact(0).visible, "the planet must block the view");
        // Close and in the open: seen.
        env.world.bodies[1].pos = Vec3::new(400.0, 200.0, 0.0);
        env.world.resync_knowledge();
        assert!(env.world.contact(0).visible);
    }

    #[test]
    fn rounds_are_dark_beyond_round_range() {
        let mut env = env_far();
        let w = &mut env.world;
        w.ships[1].reload = 0.0;
        w.set_input(1, Input { fire: true, ..Default::default() });
        w.step();
        w.set_input(1, Input::default());
        let id = w.bodies.iter().find(|b| matches!(b.kind, Kind::Round { owner: 1, .. })).unwrap().id;
        // Motor out: a missile is only dark once it stops burning.
        for m in w.missiles.iter_mut() {
            m.dv = 0.0;
            m.burning = false;
        }
        let place = |env: &mut RlEnv, d: f64| {
            let p0 = env.world.bodies[0].pos;
            let k = env.world.bodies.iter().position(|b| b.id == id).unwrap();
            env.world.bodies[k].pos = p0 + Vec3::new(0.0, 0.0, d);
            env.world.resync_knowledge();
            env.world.perceived(0).bodies.iter().any(|b| b.id == id)
        };
        assert!(!place(&mut env, ROUND_RANGE + 50.0), "a round beyond range must be invisible");
        assert!(place(&mut env, ROUND_RANGE - 50.0), "a round inside range must be visible");
        // Its owner always knows its own round.
        assert!(env.world.perceived(1).bodies.iter().any(|b| b.id == id));
    }

    #[test]
    fn the_bubble_grows_with_what_could_have_been_done_unseen() {
        let mut env = env_far();
        env.world.resync_knowledge();
        let t0 = env.world.contact(0).seen_t;
        for _ in 0..(120 * 5) {
            env.world.step();
            
        }
        let c = env.world.contact(0);
        assert!(!c.visible && c.los_kept);
        let a = 3.0f64.sqrt() * WARDEN.rcs_thrust / WARDEN.start_mass();
        let tau = env.world.t - t0;
        assert!((c.uncertainty - 0.5 * a * tau * tau).abs() < 1.0, "bubble {} vs {}", c.uncertainty, 0.5 * a * tau * tau);
        // The belief coasts with the truth when nothing happened.
        assert!((c.pos - env.world.bodies[1].pos).len() < 2.0, "belief drifted {:.1} m", (c.pos - env.world.bodies[1].pos).len());
    }
}
