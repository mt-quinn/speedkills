//! Scripted bots: a baseline opponent and rating anchor for RL, and a sanity check that the
//! sim plays. They solve orbital firing lines, dodge predicted hits, and keep their orbits safe.
//! Expensive predictions are cached and refreshed a few times per second.

use crate::control::{aim_error, apsides, rate_torque, steer_torque, Approach};
use crate::math::{Rng, Vec3};
use crate::world::{Input, Kind, World, FORWARD, UP};

#[derive(Clone, Copy, Debug)]
pub struct Personality {
    /// 0..1: chance of reacting to each incoming round predicted to hit.
    pub dodge_skill: f64,
    /// Extra predicted miss distance (m) the bot will still take a shot at.
    pub trigger_slack: f64,
    /// Longest predicted flight time (s) it will shoot at.
    pub max_flight: f64,
    /// Propellant fraction kept in reserve for orbit safety.
    pub fuel_reserve: f64,
    /// Seconds without a firing line before it burns to reposition.
    pub patience: f64,
    /// On seeing the enemy's muzzle flash, slip sideways across the line of fire before the
    /// (dark) round arrives, instead of waiting to see it.
    pub flash_dodge: bool,
    /// Dodge on the strafe thrusters only (quiet): never light the main engine to dodge.
    pub quiet: bool,
    /// Break against an incoming missile at this time-to-go (s).
    pub break_tgo: f64,
    /// Launch when the (believed) target is within this range (m).
    pub launch_range: f64,
    /// While out of the enemy's sight (beyond visual range, not loud), drift: random quiet strafe
    /// impulses across the line of sight (Poisson rate per second), so blind fire misses.
    pub drift_rate: f64,
}

impl Personality {
    pub fn random(rng: &mut Rng) -> Personality {
        Personality {
            dodge_skill: rng.range(0.3, 0.9),
            trigger_slack: rng.range(0.0, 6.0),
            max_flight: rng.range(6.0, 18.0),
            fuel_reserve: rng.range(0.3, 0.55),
            patience: rng.range(4.0, 12.0),
            flash_dodge: false,
            quiet: false,
            drift_rate: 0.0,
            break_tgo: rng.range(1.2, 3.5),
            launch_range: rng.range(500.0, 900.0),
        }
    }

    pub fn for_design(name: &str, rng: &mut Rng) -> Personality {
        let mut p = Personality::random(rng);
        match name {
            "Lancer" => p.max_flight = rng.range(10.0, 22.0),
            "Hornet" => p.dodge_skill = rng.range(0.6, 0.95),
            _ => {}
        }
        p
    }
}

#[derive(Clone, Copy, Debug)]
enum Mode {
    Fight,
    Dodge { until: f64, dir: Vec3 },
    Burn { until: f64, dir: Vec3 },
}

pub struct Bot {
    pub personality: Personality,
    /// Fire nothing (curriculum: early learners face bots that don't shoot back).
    pub passive: bool,
    mode: Mode,
    rng: Rng,
    aim: Option<(Vec3, Approach)>,
    aim_at: f64,
    seen: Vec<u32>,
    last_line: f64,
    drift_until: f64,
    drift_dir: Vec3,
}

impl Bot {
    pub fn new(personality: Personality, seed: u64) -> Bot {
        Bot { personality, passive: false, mode: Mode::Fight, rng: Rng::new(seed), aim: None, aim_at: -1.0, seen: Vec::new(), last_line: 0.0, drift_until: -1.0, drift_dir: Vec3::ZERO }
    }

    pub fn mode_name(&self) -> &'static str {
        match self.mode {
            Mode::Fight => "fight",
            Mode::Dodge { .. } => "dodge",
            Mode::Burn { .. } => "burn",
        }
    }

    pub fn act(&mut self, w: &World, me: usize) -> Input {
        let mut inp = Input::default();
        let s = &w.ships[me];
        if !s.alive {
            return inp;
        }
        let Some(enemy) = (0..w.ships.len()).find(|&j| j != me && w.ships[j].alive) else {
            inp.torque = steer_torque(w, me, w.forward(me));
            return inp;
        };
        let p = self.personality;
        let t = w.t;
        let mb = &w.bodies[me];
        let eb = &w.bodies[enemy];
        let fuel = s.propellant / s.params.propellant;

        // Refresh the firing solution a few times a second.
        if t - self.aim_at > 0.25 || self.aim.is_none() {
            // Missiles steer themselves: point at the (believed) target.
            let rel = eb.pos - mb.pos;
            let dist = rel.len();
            let blocked = !crate::sense::line_of_sight(w, mb.pos, eb.pos);
            self.aim = Some((rel.normalized_or(w.forward(me)), Approach { dist, time: dist / w.arena.missile_cruise, miss: Vec3::ZERO, rel_speed: 0.0, blocked }));
            self.aim_at = t;
        }
        let (aim_dir, aim) = self.aim.unwrap();
        inp.torque = steer_torque(w, me, aim_dir);

        // Orbit safety: low point off the ground, high point inside the zone. In the air, fly
        // the skip (nose into the airflow, belly to the planet); low on propellant, dive for it.
        if let Some((pc, gm, pr)) = w.planet() {
            let rv = mb.pos - pc;
            let r = rv.len();
            let radial = rv / r;
            let vr = mb.vel.dot(radial);
            let tang = (mb.vel - radial * vr).normalized_or(radial.any_perp());
            let (rp, ra) = apsides(rv, mb.vel, gm);
            let alt = r - pr - mb.radius;
            let air_top = pr + mb.radius + w.arena.atmo_height;
            let hungry = fuel < 0.3 && fuel > 0.0;
            // Line up for the skip on the way down; in the air, hold it. Nose-first, thrust is
            // prograde: use it when too slow for lift to carry the ship out, or when full.
            // A course into the ground is fixed with the engine before the air, if it can be.
            let crash = rp < pr + mb.radius - 5.0 && s.propellant > 0.0 && alt > w.arena.atmo_height;
            if !crash && (alt < w.arena.atmo_height + 5.0 || (rp < air_top && vr < 0.0 && alt < 150.0)) {
                inp.torque = skip_torque(w, me, radial);
                if alt < w.arena.atmo_height && s.propellant > 0.0 && aim_error(w, me, mb.vel.normalized_or(tang)) < 0.3 {
                    let v_circ = (gm / r).sqrt();
                    if mb.vel.len() < 1.05 * v_circ || fuel > 0.95 {
                        inp.thrust = 1.0;
                    }
                }
                return inp;
            }
            let skim = pr + mb.radius + 8.0;
            // Dip into the air when refuelling; otherwise keep the low point above it.
            let floor = if fuel < 0.9 { pr + mb.radius } else { air_top + 10.0 };
            let fix = if hungry && rp > skim + 15.0 && ra < w.safe_radius - 60.0 {
                Some(-tang)
            } else if rp < floor && vr < 0.0 {
                Some((radial + tang).normalized())
            } else if r > w.safe_radius - 20.0 {
                Some(-radial)
            } else if ra > w.safe_radius - 60.0 && vr > 0.0 {
                Some(-mb.vel.normalized_or(-radial))
            } else {
                None
            };
            if let (Some(dir), true) = (fix, s.propellant > 0.0) {
                inp.torque = steer_torque(w, me, dir);
                inp.thrust = if aim_error(w, me, dir) < 0.35 { 1.0 } else { 0.0 };
                return inp;
            }
        }

        // Missiles it can see: break with the main engine across the line of sight when one is
        // this bot's fixed time-to-go out (the scripted benchmark: one timing rule).
        if !matches!(self.mode, Mode::Burn { .. }) {
            for x in w.bodies.iter().filter(|x| x.alive) {
                let Kind::Round { owner, .. } = x.kind else { continue };
                if owner == me || self.seen.contains(&x.id) {
                    continue;
                }
                let rel = mb.pos - x.pos;
                let closing = -(mb.vel - x.vel).dot(rel.normalized_or(Vec3::X));
                if closing < 1.0 || rel.len() / closing > p.break_tgo {
                    continue;
                }
                self.seen.push(x.id);
                if self.seen.len() > 64 {
                    self.seen.remove(0);
                }
                if self.rng.f64() < p.dodge_skill && fuel > 0.02 {
                    let los = rel.normalized_or(Vec3::X);
                    let side = mb.vel - los * mb.vel.dot(los);
                    let dir = side.normalized_or(los.any_perp());
                    self.mode = Mode::Burn { until: t + 2.5, dir };
                    break;
                }
            }
        }

        // A muzzle flash: the round is dark, but its origin is known. Slip across the line of fire.
        if p.flash_dodge && !matches!(self.mode, Mode::Dodge { .. }) && w.events.iter().any(|e| matches!(e, crate::world::Event::Fire { ship, .. } if *ship == enemy)) {
            let los = (mb.pos - eb.pos).normalized_or(Vec3::X);
            let side = los.cross(mb.vel).normalized_or(los.any_perp());
            let dir = if self.rng.f64() < 0.5 { side } else { -side };
            let flight = ((mb.pos - eb.pos).len() / 150.0).clamp(1.0, 6.0);
            self.mode = Mode::Dodge { until: t + flight, dir };
        }

        // Drift while unseen: short quiet strafe impulses across the line of sight.
        let unseen = (eb.pos - mb.pos).len() > crate::sense::VISUAL_RANGE && s.thrust_level < 0.05;
        if p.drift_rate > 0.0 && unseen && matches!(self.mode, Mode::Fight) && fuel > 0.15 {
            let dt = w.arena.dt;
            if t >= self.drift_until && self.rng.f64() < p.drift_rate * dt {
                let los = (eb.pos - mb.pos).normalized_or(Vec3::X);
                let r = self.rng.unit_vec();
                self.drift_dir = (r - los * r.dot(los)).normalized_or(los.any_perp());
                self.drift_until = t + self.rng.range(0.5, 1.5);
            }
            if t < self.drift_until {
                inp.strafe = s.orient.inv_rotate(self.drift_dir);
            }
        }

        match self.mode {
            Mode::Dodge { until, dir } if t < until => {
                // Strafe out of the way; a real burn if already pointed right and fuel allows.
                // Low on propellant, keep the last of it for the refuelling dive.
                if fuel > 0.12 {
                    inp.strafe = s.orient.inv_rotate(dir);
                }
                if !p.quiet && fuel > 0.3 && aim_error(w, me, dir) < 0.5 {
                    inp.thrust = 1.0;
                }
            }
            Mode::Burn { until, dir } if t < until => {
                inp.torque = steer_torque(w, me, dir);
                inp.thrust = if aim_error(w, me, dir) < 0.3 { 1.0 } else { 0.0 };
                return inp;
            }
            Mode::Dodge { .. } | Mode::Burn { .. } => self.mode = Mode::Fight,
            Mode::Fight => {}
        }

        // Launch when the target is in range, in the clear, and near the nose.
        let good_line = !aim.blocked && aim.dist < p.launch_range;
        if good_line {
            self.last_line = t;
        }
        inp.fire = !self.passive && good_line && aim_error(w, me, aim_dir) < 0.3;

        // No line for a while: burn to change the geometry (toward the enemy's altitude).
        if matches!(self.mode, Mode::Fight) && t - self.last_line > p.patience && fuel > p.fuel_reserve.max(0.3) {
            if let Some((pc, _, _)) = w.planet() {
                let (rm, re) = ((mb.pos - pc).len(), (eb.pos - pc).len());
                let radial = (mb.pos - pc).normalized();
                let toward = (eb.pos - mb.pos).normalized();
                let dir = (toward + radial * ((re - rm) / 200.0).clamp(-0.7, 0.7)).normalized();
                self.mode = Mode::Burn { until: t + 0.4, dir };
                self.last_line = t;
            }
        }
        inp
    }
}

/// Torque that turns the nose onto the airflow and rolls the belly toward the planet: the skip.
pub fn skip_torque(w: &World, me: usize, radial_out: Vec3) -> Vec3 {
    let s = &w.ships[me];
    let v = w.bodies[me].vel.normalized_or(radial_out.any_perp());
    let up = (radial_out - v * radial_out.dot(v)).normalized_or(v.any_perp());
    let (vb, ub) = (s.orient.inv_rotate(v), s.orient.inv_rotate(up));
    let rate = (FORWARD.cross(vb) + UP.cross(ub)) * 3.0;
    let max = s.params.max_rate;
    let rate = if rate.len() > max { rate * (max / rate.len()) } else { rate };
    rate_torque(w, me, rate)
}
