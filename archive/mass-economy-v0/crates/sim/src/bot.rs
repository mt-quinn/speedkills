//! Scripted bots. Not the goal — they exist to exercise every verb, sanity-check the sim,
//! and serve as early curriculum opponents. Personality parameters make them varied.

use crate::control::{aim_error, intercept, steer_torque};
use crate::math::{Rng, Vec3};
use crate::world::{BodyId, Hazard, Input, Kind, Tether, World};

#[derive(Clone, Copy, Debug)]
pub struct Personality {
    /// Preferred fighting distance (m).
    pub preferred_range: f64,
    /// 0..1: how big a slug to charge within the design's min..max.
    pub charge_frac: f64,
    /// 0..1: chance of reacting to each incoming threat.
    pub dodge_skill: f64,
    /// Reserve fraction below which scavenging becomes the priority.
    pub scoop_threshold: f64,
    /// 0..1: appetite for tether plays.
    pub tether_love: f64,
    /// 0..1: appetite for field plays.
    pub field_love: f64,
    /// Aim tolerance before throwing, radians.
    pub aim_tol: f64,
}

impl Personality {
    pub fn random(rng: &mut Rng) -> Personality {
        Personality {
            preferred_range: rng.range(80.0, 240.0),
            charge_frac: rng.range(0.2, 1.0),
            dodge_skill: rng.range(0.3, 0.9),
            scoop_threshold: rng.range(0.25, 0.55),
            tether_love: rng.range(0.0, 1.0),
            field_love: rng.range(0.0, 1.0),
            aim_tol: rng.range(1.5, 4.0).to_radians(),
        }
    }

    /// Random personality nudged toward what the design is good at.
    pub fn for_design(name: &str, rng: &mut Rng) -> Personality {
        let mut p = Personality::random(rng);
        match name {
            "Slinger" => p.tether_love = rng.range(0.6, 1.0),
            "Anchor" => {
                p.field_love = rng.range(0.6, 1.0);
                p.preferred_range = rng.range(60.0, 150.0);
            }
            "Skater" => {
                p.dodge_skill = rng.range(0.6, 0.95);
                p.charge_frac = rng.range(0.1, 0.6);
            }
            _ => {}
        }
        p
    }
}

#[derive(Clone, Copy, Debug)]
enum Mode {
    Fight,
    Dodge { until: f64, dir: Vec3 },
    Reposition { until: f64, dir: Vec3 },
    SlingAim { target: BodyId, until: f64, fired: bool },
    Swing { target: BodyId, until: f64 },
    Harpoon { until: f64, fired: bool },
    Scoop { target: BodyId, until: f64 },
}

pub struct Bot {
    pub personality: Personality,
    mode: Mode,
    rng: Rng,
    seen_threats: Vec<BodyId>,
    tether_blocked_until: f64,
}

struct Ctx {
    me: usize,
    enemy: usize,
    pos: Vec3,
    vel: Vec3,
    rel: Vec3,
    dist: f64,
    rel_vel: Vec3,
    closing: f64,
    reserve_frac: f64,
    t: f64,
}

impl Bot {
    pub fn new(personality: Personality, seed: u64) -> Bot {
        Bot {
            personality,
            mode: Mode::Fight,
            rng: Rng::new(seed),
            seen_threats: Vec::new(),
            tether_blocked_until: 0.0,
        }
    }

    pub fn mode_name(&self) -> &'static str {
        match self.mode {
            Mode::Fight => "fight",
            Mode::Dodge { .. } => "dodge",
            Mode::Reposition { .. } => "reposition",
            Mode::SlingAim { .. } => "sling-aim",
            Mode::Swing { .. } => "swing",
            Mode::Harpoon { .. } => "harpoon",
            Mode::Scoop { .. } => "scoop",
        }
    }

    pub fn act(&mut self, w: &World, me: usize) -> Input {
        self.act_depth(w, me, 0)
    }

    fn act_depth(&mut self, w: &World, me: usize, depth: u32) -> Input {
        let mut inp = Input::default();
        if !w.ships[me].alive {
            return inp;
        }
        let Some(enemy) = (0..w.ships.len()).find(|&j| j != me && w.ships[j].alive) else {
            inp.torque = steer_torque(w, me, w.forward(me));
            return inp;
        };
        let (mb, eb) = (&w.bodies[me], &w.bodies[enemy]);
        let s = &w.ships[me];
        let rel = eb.pos - mb.pos;
        let dist = rel.len();
        let rel_vel = eb.vel - mb.vel;
        let c = Ctx {
            me,
            enemy,
            pos: mb.pos,
            vel: mb.vel,
            rel,
            dist,
            rel_vel,
            closing: -rel_vel.dot(rel / dist.max(1e-6)),
            reserve_frac: w.reserve(me) / s.params.reserve_capacity(),
            t: w.t,
        };

        // Orbit keeping around a planet: don't let the orbit's low point hit the surface or
        // its high point leave the safe zone.
        let swinging = matches!(self.mode, Mode::Swing { .. });
        if let Some((ppos, gm, pr)) = w.hazards.iter().find_map(|h| match *h {
            Hazard::Planet { pos, gm, radius } => Some((pos, gm, radius)),
            _ => None,
        }) {
            let rv = c.pos - ppos;
            let r = rv.len();
            let radial = rv / r.max(1e-6);
            let vr = c.vel.dot(radial);
            let tang = (c.vel - radial * vr).normalized_or(radial.any_perp());
            let (rp, ra) = apsides(rv, c.vel, gm);
            let safe = w.safe_radius;
            let dir = if rp < pr + mb.radius + 30.0 && vr < 0.0 {
                Some((radial + tang).normalized()) // climb: up and prograde
            } else if r > safe - 15.0 {
                Some(-radial) // get back inside, now
            } else if ra > safe - 50.0 && vr > 0.0 && !swinging {
                Some(-c.vel.normalized_or(-radial)) // bleed energy
            } else {
                None
            };
            if let Some(dir) = dir {
                inp.torque = steer_torque(w, me, dir);
                inp.arms = 0.0;
                inp.thrust = if aim_error(w, me, dir) < 0.6 { 1.0 } else { 0.0 };
                inp.tether = matches!(s.tether, Tether::Attached { .. }) && r < safe;
                inp.charge = s.charge > 0.0;
                return inp;
            }
        }

        // Wall avoidance trumps everything: if our straight-line path meets the wall sooner
        // than we could turn around and stop, brake retrograde.
        let r_arena = w.arena.arena_radius;
        let speed = c.vel.len();
        let accel = s.params.max_thrust / mb.mass;
        if speed > 8.0 && !swinging {
            let t_hit = time_to_sphere(c.pos, c.vel, r_arena - mb.radius - 15.0);
            let t_turn = 1.2;
            let t_stop = speed / accel;
            if t_hit < t_turn + t_stop * 1.2 {
                let dir = -c.vel / speed;
                inp.torque = steer_torque(w, me, dir);
                inp.arms = 0.0;
                inp.thrust = if aim_error(w, me, dir) < 0.6 { 1.0 } else { 0.0 };
                inp.tether = matches!(s.tether, Tether::Attached { .. });
                inp.charge = s.charge > 0.0;
                return inp;
            }
        }
        // Hazards: steer off a collision course with a well core; don't race through dust.
        if !swinging {
            for h in &w.hazards {
                match *h {
                    Hazard::Well { pos, core, .. } => {
                        let rp = pos - c.pos;
                        let v2 = c.vel.len_sq().max(1e-6);
                        let tc = rp.dot(c.vel) / v2;
                        let miss = c.pos + c.vel * tc - pos;
                        if tc > 0.0 && tc < 1.5 + speed / accel && miss.len() < core + mb.radius + 30.0 {
                            let dir = miss.normalized_or(c.vel.any_perp());
                            inp.torque = steer_torque(w, me, dir);
                            inp.thrust = if aim_error(w, me, dir) < 0.7 { 1.0 } else { 0.0 };
                            inp.tether = matches!(s.tether, Tether::Attached { .. });
                            inp.charge = s.charge > 0.0;
                            return inp;
                        }
                    }
                    Hazard::Nebula { pos, radius, .. } => {
                        if (c.pos - pos).len() < radius && speed > 45.0 && !matches!(self.mode, Mode::Reposition { .. }) {
                            self.mode = Mode::Reposition { until: c.t + 1.0, dir: -c.vel / speed };
                        }
                    }
                    _ => {}
                }
            }
        }

        // Speed discipline in every mode except a deliberate swing.
        if speed > 110.0 && !swinging && !matches!(self.mode, Mode::Reposition { .. } | Mode::Dodge { .. }) {
            self.mode = Mode::Reposition { until: c.t + 1.5, dir: -c.vel / speed };
        }

        self.detect_threats(w, &c);

        match self.mode {
            Mode::Dodge { until, dir } => {
                if c.t < until {
                    inp.torque = steer_torque(w, me, dir);
                    inp.thrust = if aim_error(w, me, dir) < 1.0 { 1.0 } else { 0.15 };
                    inp.arms = 0.0;
                    inp.charge = s.charge > 0.0;
                    return inp;
                }
                self.mode = Mode::Fight;
            }
            Mode::Reposition { until, dir } => {
                if c.t < until {
                    inp.torque = steer_torque(w, me, dir);
                    inp.thrust = if aim_error(w, me, dir) < 0.6 { 1.0 } else { 0.0 };
                    inp.charge = s.charge > 0.0;
                    return inp;
                }
                self.mode = Mode::Fight;
            }
            Mode::SlingAim { .. } | Mode::Swing { .. } => {
                if let Some(i) = self.sling(w, &c) {
                    return i;
                }
            }
            Mode::Harpoon { .. } => {
                if let Some(i) = self.harpoon(w, &c) {
                    return i;
                }
            }
            Mode::Scoop { .. } => {
                if let Some(i) = self.scoop(w, &c) {
                    return i;
                }
            }
            Mode::Fight => {}
        }

        self.maybe_switch(w, &c);
        if !matches!(self.mode, Mode::Fight) && depth == 0 {
            return self.act_depth(w, me, 1);
        }
        self.fight(w, &c)
    }

    fn detect_threats(&mut self, w: &World, c: &Ctx) {
        if matches!(self.mode, Mode::Dodge { .. }) {
            return;
        }
        let my_r = w.bodies[c.me].radius;
        for b in &w.bodies {
            let Kind::Slug { owner } = b.kind else { continue };
            if !b.alive || (owner == c.me && c.t - b.born < 1.0) || self.seen_threats.contains(&b.id) {
                continue;
            }
            let rp = b.pos - c.pos;
            let rv = b.vel - c.vel;
            let rv2 = rv.len_sq();
            if rv2 < 1.0 {
                continue;
            }
            let tc = -rp.dot(rv) / rv2;
            if !(0.0..1.6).contains(&tc) {
                continue;
            }
            let miss = rp + rv * tc;
            if miss.len() > my_r + b.radius + 4.0 {
                continue;
            }
            self.seen_threats.push(b.id);
            if self.seen_threats.len() > 64 {
                self.seen_threats.remove(0);
            }
            if self.rng.f64() < self.personality.dodge_skill {
                let away = (-miss).normalized_or(rv.any_perp());
                // Dodge perpendicular to the slug's path.
                let rvn = rv.normalized();
                let dir = (away - rvn * away.dot(rvn)).normalized_or(rv.any_perp());
                self.mode = Mode::Dodge { until: c.t + 0.7, dir };
                return;
            }
        }
    }

    fn maybe_switch(&mut self, w: &World, c: &Ctx) {
        let p = self.personality;
        let s = &w.ships[c.me];
        let sp = s.params;

        // Scavenge when low, or opportunistically.
        if c.reserve_frac < p.scoop_threshold || self.rng.f64() < 0.01 {
            if let Some(target) = best_debris(w, c, if c.reserve_frac < p.scoop_threshold { 2000.0 } else { 120.0 }) {
                self.mode = Mode::Scoop { target, until: c.t + 15.0 };
                return;
            }
        }

        let tether_free = matches!(s.tether, Tether::None) && c.t > self.tether_blocked_until && s.tether_cd <= 0.0;

        // Harpoon the enemy when it's lined up and in reach.
        if tether_free && p.tether_love > 0.3 && c.dist < sp.tether_len * 0.7 {
            let aim = intercept(c.rel, c.rel_vel, sp.tether_speed).map(|(d, _)| d).unwrap_or(c.rel);
            if aim_error(w, c.me, aim) < 0.05 && self.rng.f64() < p.tether_love * 0.2 {
                self.mode = Mode::Harpoon { until: c.t + 6.0, fired: false };
                return;
            }
        }

        // Sling around a rock when the enemy is far.
        if tether_free && p.tether_love > 0.5 && c.dist > 160.0 && self.rng.f64() < 0.02 * p.tether_love {
            if let Some(target) = nearest_asteroid(w, c.pos, sp.tether_len * 0.85) {
                self.mode = Mode::SlingAim { target, until: c.t + 3.0, fired: false };
                return;
            }
        }

        // Too close and closing: break off.
        if c.dist < p.preferred_range * 0.45 && c.closing > 5.0 && self.rng.f64() < 0.05 {
            let perp = c.rel.cross(c.rel_vel).normalized_or(c.rel.any_perp());
            let dir = (perp + c.rel_vel.normalized() * 0.7).normalized_or(perp);
            self.mode = Mode::Reposition { until: c.t + 1.2, dir };
        }

        // Going too fast to control: bleed off speed.
        let speed = c.vel.len();
        if speed > 70.0 && self.rng.f64() < 0.05 {
            self.mode = Mode::Reposition { until: c.t + 1.2, dir: -c.vel / speed };
            return;
        }

        // Closing too fast: match velocity.
        if c.closing > 50.0 && c.dist < 220.0 && self.rng.f64() < 0.1 {
            let dir = c.rel_vel.normalized_or(c.rel.any_perp());
            self.mode = Mode::Reposition { until: c.t + 1.0, dir };
        }
    }

    fn fight(&mut self, w: &World, c: &Ctx) -> Input {
        let p = self.personality;
        let s = &w.ships[c.me];
        let sp = s.params;
        let mut inp = Input::default();

        let aim = intercept(c.rel, c.rel_vel, sp.throw_speed).map(|(d, _)| d).unwrap_or(c.rel.normalized());
        let err = aim_error(w, c.me, aim);
        inp.torque = steer_torque(w, c.me, aim);
        inp.arms = if err > 0.4 { 0.0 } else { 1.0 };

        // Range management: thrust when roughly pointed at the enemy.
        let want_closing = ((c.dist - p.preferred_range) * 0.2).clamp(-20.0, 40.0);
        if c.closing < want_closing - 8.0 && aim_error(w, c.me, c.rel) < 0.5 && c.reserve_frac > 0.2 {
            inp.thrust = 0.8;
        }

        // Charge and throw.
        let target_charge = sp.throw_min + (sp.throw_max - sp.throw_min) * p.charge_frac;
        // Don't spend yourself to death: throws get pickier as the reserve drains.
        let max_range = 150.0 + 250.0 * c.reserve_frac.clamp(0.0, 1.0);
        let can_attack = c.dist < max_range && c.reserve_frac > 0.2;
        if s.charge > 0.0 {
            inp.charge = !(s.charge >= target_charge && err < p.aim_tol);
        } else if can_attack && err < p.aim_tol * 3.0 {
            inp.charge = true;
        }

        // Field plays (Anchor's bread and butter).
        if p.field_love > 0.5 && c.dist < sp.field_range * 0.9 && aim_error(w, c.me, c.rel) < sp.field_cone_deg.to_radians() {
            inp.field = if hazard_behind(w, c) { -1.0 } else if c.dist > 40.0 { 1.0 } else { 0.0 };
            if c.dist < 60.0 && inp.field >= 0.0 {
                inp.thrust = 1.0; // ram
            }
        }
        inp
    }

    fn sling(&mut self, w: &World, c: &Ctx) -> Option<Input> {
        let s = &w.ships[c.me];
        let mut inp = Input::default();
        match self.mode {
            Mode::SlingAim { target, until, fired } => {
                let Some(ai) = w.body_index(target) else {
                    self.mode = Mode::Fight;
                    return None;
                };
                if let Tether::Attached { target: t, .. } = s.tether {
                    if t == target {
                        self.mode = Mode::Swing { target, until: c.t + 7.0 };
                        return self.sling(w, c);
                    }
                }
                if c.t > until || (fired && matches!(s.tether, Tether::None)) {
                    self.tether_blocked_until = c.t + 4.0;
                    self.mode = Mode::Fight;
                    return None;
                }
                let a = &w.bodies[ai];
                let aim = intercept(a.pos - c.pos, a.vel - c.vel, s.params.tether_speed)
                    .map(|(d, _)| d)
                    .unwrap_or((a.pos - c.pos).normalized());
                inp.torque = steer_torque(w, c.me, aim);
                inp.arms = 0.0;
                let fire = fired || aim_error(w, c.me, aim) < 0.04;
                inp.tether = fire;
                self.mode = Mode::SlingAim { target, until, fired: fire };
                Some(inp)
            }
            Mode::Swing { target, until } => {
                let attached = matches!(s.tether, Tether::Attached { target: t, .. } if t == target);
                let Some(ai) = w.body_index(target).filter(|_| attached) else {
                    self.mode = Mode::Fight;
                    return None;
                };
                let a = &w.bodies[ai];
                let rn = (c.pos - a.pos).normalized_or(Vec3::X);
                let vrel = c.vel - a.vel;
                let tang = vrel - rn * vrel.dot(rn);
                let to_enemy = c.rel.normalized();
                let tdir = if tang.len() < 3.0 {
                    (to_enemy - rn * to_enemy.dot(rn)).normalized_or(rn.any_perp())
                } else {
                    tang.normalized()
                };
                inp.torque = steer_torque(w, c.me, tdir);
                inp.thrust = if aim_error(w, c.me, tdir) < 0.5 { 1.0 } else { 0.0 };
                inp.reel = 0.35;
                inp.arms = 0.0;
                // Fling: let go when our velocity (relative to the enemy) points at them.
                let flight = -c.rel_vel;
                let lined_up = flight.len() > 30.0 && flight.normalized().dot(to_enemy) > 10f64.to_radians().cos();
                let release = lined_up || c.t > until || c.dist < 60.0;
                inp.charge = flight.len() > 25.0 && !release;
                inp.tether = !release;
                if release {
                    self.tether_blocked_until = c.t + 3.0;
                    self.mode = Mode::Fight;
                }
                Some(inp)
            }
            _ => None,
        }
    }

    fn harpoon(&mut self, w: &World, c: &Ctx) -> Option<Input> {
        let Mode::Harpoon { until, fired } = self.mode else { return None };
        let s = &w.ships[c.me];
        let mut inp = Input::default();
        let enemy_id = w.bodies[c.enemy].id;
        let on_enemy = matches!(s.tether, Tether::Attached { target, .. } if target == enemy_id);
        if c.t > until || (fired && matches!(s.tether, Tether::None)) || (fired && !on_enemy && matches!(s.tether, Tether::Attached { .. })) {
            self.tether_blocked_until = c.t + 3.0;
            self.mode = Mode::Fight;
            return None;
        }
        let aim = intercept(c.rel, c.rel_vel, s.params.throw_speed).map(|(d, _)| d).unwrap_or(c.rel.normalized());
        inp.torque = steer_torque(w, c.me, aim);
        inp.tether = true;
        self.mode = Mode::Harpoon { until, fired: true };
        if on_enemy {
            // Reel them in and hit them with everything.
            inp.reel = 1.0;
            inp.thrust = if aim_error(w, c.me, c.rel) < 0.4 { 0.6 } else { 0.0 };
            let err = aim_error(w, c.me, aim);
            inp.charge = !(s.charge >= s.params.throw_min && err < 0.08 && c.dist < 90.0);
            if c.dist < 35.0 {
                inp.tether = false;
                self.mode = Mode::Fight;
            }
        }
        Some(inp)
    }

    fn scoop(&mut self, w: &World, c: &Ctx) -> Option<Input> {
        let Mode::Scoop { target, until } = self.mode else { return None };
        let Some(di) = w.body_index(target) else {
            self.mode = Mode::Fight;
            return None;
        };
        if c.t > until {
            self.mode = Mode::Fight;
            return None;
        }
        let d = &w.bodies[di];
        let to = d.pos - c.pos;
        let dist = to.len();
        let approach = (dist * 0.25).clamp(2.0, if dist > 150.0 { 35.0 } else { 9.0 });
        let v_des = d.vel + to.normalized() * approach;
        let dv = v_des - c.vel;
        let mut inp = Input::default();
        if dv.len() > 1.5 {
            inp.torque = steer_torque(w, c.me, dv);
            if aim_error(w, c.me, dv) < 0.3 {
                inp.thrust = (dv.len() / 6.0).min(1.0);
            }
        } else {
            inp.torque = steer_torque(w, c.me, c.rel);
        }
        inp.arms = 0.0;
        Some(inp)
    }
}

fn best_debris(w: &World, c: &Ctx, radius: f64) -> Option<BodyId> {
    let enemy_pos = w.bodies[c.enemy].pos;
    w.bodies
        .iter()
        .filter(|b| b.alive && matches!(b.kind, Kind::Debris) && b.mass > 8.0)
        .filter(|b| (b.pos - c.pos).len() < radius)
        .filter(|b| (b.pos - enemy_pos).len() > 60.0)
        .map(|b| {
            let d = (b.pos - c.pos).len();
            let rv = (b.vel - c.vel).len();
            (b.mass / (d + rv * 3.0 + 10.0), b.id)
        })
        .max_by(|a, b| a.0.partial_cmp(&b.0).unwrap())
        .map(|(_, id)| id)
}

fn nearest_asteroid(w: &World, pos: Vec3, max: f64) -> Option<BodyId> {
    w.bodies
        .iter()
        .filter(|b| b.alive && b.kind == Kind::Asteroid)
        .map(|b| ((b.pos - pos).len() - b.radius, b.id))
        .filter(|(d, _)| *d < max && *d > 30.0)
        .min_by(|a, b| a.0.partial_cmp(&b.0).unwrap())
        .map(|(_, id)| id)
}

/// Is there a wall or asteroid just beyond the enemy (so pushing slams them into it)?
fn hazard_behind(w: &World, c: &Ctx) -> bool {
    let e = &w.bodies[c.enemy];
    let push_dir = c.rel.normalized();
    let wall_gap = w.arena.arena_radius - e.pos.len();
    if wall_gap < 120.0 && e.pos.normalized().dot(push_dir) > 0.5 {
        return true;
    }
    w.bodies.iter().any(|b| {
        if b.kind != Kind::Asteroid {
            return false;
        }
        let d = b.pos - e.pos;
        d.len() - b.radius < 90.0 && d.normalized().dot(push_dir) > 0.6
    })
}

/// Time until a point moving from `p` with velocity `v` leaves a sphere of radius `r`.
fn time_to_sphere(p: Vec3, v: Vec3, r: f64) -> f64 {
    let a = v.len_sq();
    let b = 2.0 * p.dot(v);
    let c = p.len_sq() - r * r;
    if c >= 0.0 {
        return 0.0;
    }
    (-b + (b * b - 4.0 * a * c).sqrt()) / (2.0 * a)
}

/// Periapsis and apoapsis distances of the orbit through `r`, `v` around a mass `gm`.
/// Apoapsis is infinite on an escape trajectory.
pub fn apsides(r: Vec3, v: Vec3, gm: f64) -> (f64, f64) {
    let rl = r.len().max(1e-6);
    let energy = v.len_sq() / 2.0 - gm / rl;
    let h = r.cross(v).len();
    let e = (1.0 + 2.0 * energy * h * h / (gm * gm)).max(0.0).sqrt();
    let rp = h * h / (gm * (1.0 + e));
    if energy >= 0.0 {
        return (rp, f64::INFINITY);
    }
    let a = -gm / (2.0 * energy);
    (rp, a * (1.0 + e))
}
