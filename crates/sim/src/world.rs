//! The world: ships, kinetic rounds, orbiting asteroids, and one planet.
//!
//! Invariant: `bodies[i]` for `i < ships.len()` is ship `i`'s body. Ship bodies are never
//! removed (a destroyed ship stays with `alive == false`), and cleanup is order-preserving,
//! so ship indices are stable.

use crate::math::{Quat, Rng, Vec3};
use crate::params::{ArenaParams, ShipParams, ARENA, SCOOP_SIDEWAYS};

pub type BodyId = u32;

pub const FORWARD: Vec3 = Vec3::Z;
/// Body "up": out of the canopy, away from the belly. Lift acts along it.
pub const UP: Vec3 = Vec3::Y;
pub const PLANET_RADIUS: f64 = 150.0;
/// GM chosen so a circular orbit at 400 m runs ~40 m/s (period ~1 min).
pub const PLANET_GM: f64 = 640_000.0;

/// One weapon today (the mass driver); an enum so designs can grow more.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Weapon {
    Driver,
    /// Guided missile: the only weapon in play.
    Missile,
}

/// A missile's guidance state (its body is a Kind::Round with weapon Missile).
#[derive(Clone, Copy, Debug)]
pub struct Missile {
    pub id: BodyId,
    pub owner: usize,
    /// Delta-v left (m/s); at zero the motor is out and it coasts, dark.
    pub dv: f64,
    /// Acceleration actually applied (the command, lagged).
    pub acc: Vec3,
    /// Steering lag (s): random per missile, hidden from the target.
    pub lag: f64,
    /// Its own seeker has the target (else it steers by the launcher's track).
    pub locked: bool,
    pub burning: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    Ship(usize),
    Round { owner: usize, weapon: Weapon },
    Asteroid,
}

#[derive(Clone, Debug)]
pub struct Body {
    pub id: BodyId,
    pub kind: Kind,
    pub pos: Vec3,
    pub vel: Vec3,
    pub mass: f64,
    pub radius: f64,
    pub alive: bool,
    pub born: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Input {
    /// Main engine, 0..1.
    pub thrust: f64,
    /// Strafing thrusters on each body axis, -1..1.
    pub strafe: Vec3,
    /// Body-frame torque command, each axis -1..1.
    pub torque: Vec3,
    /// Fire the mass driver (when loaded).
    pub fire: bool,
}

impl Input {
    fn sanitized(mut self) -> Input {
        fn c(v: f64, lo: f64, hi: f64) -> f64 {
            if v.is_finite() {
                v.clamp(lo, hi)
            } else {
                0.0
            }
        }
        let cv = |v: Vec3| Vec3::new(c(v.x, -1.0, 1.0), c(v.y, -1.0, 1.0), c(v.z, -1.0, 1.0));
        self.thrust = c(self.thrust, 0.0, 1.0);
        self.strafe = cv(self.strafe);
        self.torque = cv(self.torque);
        self
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct ShipStats {
    pub damage_dealt: f64,
    pub damage_taken: f64,
    pub shots: u32,
    /// Direct hits.
    pub hits: u32,
    /// Proximity bursts that damaged the enemy.
    pub bursts: u32,
    pub rams: u32,
    pub propellant_used: f64,
    /// Propellant scooped from the atmosphere.
    pub propellant_scooped: f64,
    pub max_speed: f64,
}

#[derive(Clone, Debug)]
pub struct Ship {
    pub params: ShipParams,
    pub orient: Quat,
    /// World-frame angular momentum. Angular velocity is derived: w = L / I.
    pub ang_mom: Vec3,
    pub input: Input,
    pub alive: bool,
    pub hull: f64,
    pub propellant: f64,
    pub ammo: u32,
    /// Seconds until the driver can fire again.
    pub reload: f64,
    /// Applied levels last step (for rendering).
    pub thrust_level: f64,
    pub strafe_level: Vec3,
    /// Hull lost per second to the zones last step.
    pub zone_burn: f64,
    /// Hull lost per second to atmospheric heating last step.
    pub heating: f64,
    /// Propellant scooped per second (kg/s) last step.
    pub scoop: f64,
    /// Aerodynamic lift acceleration (m/s², world frame) last step.
    pub lift: Vec3,
    pub stats: ShipStats,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Cause {
    Slug,
    Ram,
    Asteroid,
    Planet,
    /// Heating from skimming the atmosphere.
    Atmosphere,
    Zone,
    Wall,
}

/// Static arena features.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Hazard {
    /// Immovable, inverse-square gravity; everything else orbits it.
    Planet { pos: Vec3, gm: f64, radius: f64 },
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Event {
    Fire { ship: usize, weapon: Weapon, pos: Vec3 },
    Hit { victim: usize, attacker: Option<usize>, cause: Cause, damage: f64, pos: Vec3 },
    /// A round struck something that isn't a ship.
    Impact { weapon: Weapon, pos: Vec3 },
    /// A round's proximity fuze fired `dist` metres off a ship's hull (the Hit follows).
    Burst { weapon: Weapon, pos: Vec3, victim: usize, dist: f64 },
    Kill { victim: usize, attacker: Option<usize>, cause: Cause, pos: Vec3 },
    /// `decision` is true when the time limit forced a result (winner on hull fraction).
    MatchEnd { winner: Option<usize>, decision: bool },
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Layout {
    /// Nothing but the ships (and any asteroids), no gravity: for tests.
    Empty,
    /// A fight around one planet: everything orbits; burn zones beyond a safe radius.
    Planet,
}

pub struct MatchConfig {
    pub seed: u64,
    pub ships: Vec<ShipParams>,
    pub asteroids: usize,
    pub layout: Layout,
}

impl MatchConfig {
    /// The standard match: the planet.
    pub fn standard(seed: u64, ships: Vec<ShipParams>) -> MatchConfig {
        MatchConfig { seed, ships, asteroids: 10, layout: Layout::Planet }
    }
}

#[derive(Clone)]
pub struct World {
    pub arena: ArenaParams,
    pub layout: Layout,
    /// Current safe radius; shrinks in sudden death. Infinite without a planet.
    pub safe_radius: f64,
    pub t: f64,
    pub tick: u64,
    pub bodies: Vec<Body>,
    pub ships: Vec<Ship>,
    pub hazards: Vec<Hazard>,
    pub events: Vec<Event>,
    pub finished: bool,
    pub winner: Option<usize>,
    pub rng: Rng,
    next_id: BodyId,
    /// What each ship knows (duels only); updated every step. See sense.rs.
    pub know: Option<crate::sense::Knowledge>,
    /// Guidance state of every missile in flight.
    pub missiles: Vec<Missile>,
}

struct Damage {
    victim: usize,
    attacker: Option<usize>,
    cause: Cause,
    hp: f64,
    pos: Vec3,
    /// Unit vector from ship centre toward the impact.
    dir: Vec3,
}

/// Velocity for a circular orbit at `pos` (around the origin) in a random plane containing `pos`.
pub fn circular_velocity(pos: Vec3, gm: f64, rng: &mut Rng) -> Vec3 {
    let r = pos.len();
    let radial = pos / r;
    let t = rng.unit_vec();
    let tangent = (t - radial * t.dot(radial)).normalized_or(radial.any_perp());
    tangent * (gm / r).sqrt()
}

/// Velocity at `pos` for an orbit with low point `rp` and high point `ra` (rp <= |pos| <= ra),
/// in a random plane containing `pos`; climbing or descending.
pub fn eccentric_velocity(pos: Vec3, rp: f64, ra: f64, gm: f64, climbing: bool, rng: &mut Rng) -> Vec3 {
    let r = pos.len();
    let radial = pos / r;
    let t = rng.unit_vec();
    let tangent = (t - radial * t.dot(radial)).normalized_or(radial.any_perp());
    let a = 0.5 * (rp + ra);
    let v = (gm * (2.0 / r - 1.0 / a)).sqrt();
    let vt = (2.0 * gm * ra * rp / (ra + rp)).sqrt() / r;
    let vr = (v * v - vt * vt).max(0.0).sqrt();
    tangent * vt + radial * if climbing { vr } else { -vr }
}

impl World {
    pub fn new(cfg: MatchConfig) -> World {
        let planet = cfg.layout == Layout::Planet;
        let arena = ARENA;
        let mut w = World {
            arena,
            layout: cfg.layout,
            safe_radius: if planet { arena.safe_radius } else { f64::INFINITY },
            t: 0.0,
            tick: 0,
            bodies: Vec::new(),
            ships: Vec::new(),
            hazards: Vec::new(),
            events: Vec::new(),
            finished: false,
            winner: None,
            rng: Rng::new(cfg.seed),
            next_id: 1,
            know: None,
            missiles: Vec::new(),
        };
        for (i, p) in cfg.ships.iter().enumerate() {
            let id = w.alloc_id();
            let pos = Vec3::new(if i % 2 == 0 { -200.0 } else { 200.0 }, 0.0, 0.0);
            let mass = p.start_mass() + p.driver.ammo as f64 * p.driver.slug_mass;
            w.bodies.push(Body { id, kind: Kind::Ship(i), pos, vel: Vec3::ZERO, mass, radius: p.radius, alive: true, born: 0.0 });
            w.ships.push(Ship {
                params: *p,
                orient: Quat::from_to(FORWARD, -pos.normalized()),
                ang_mom: Vec3::ZERO,
                input: Input::default(),
                alive: true,
                hull: p.hull,
                propellant: p.propellant,
                ammo: p.driver.ammo,
                reload: 0.0,
                thrust_level: 0.0,
                strafe_level: Vec3::ZERO,
                zone_burn: 0.0,
                heating: 0.0,
                scoop: 0.0,
                lift: Vec3::ZERO,
                stats: ShipStats::default(),
            });
        }
        if planet {
            w.generate_planet(cfg.asteroids);
        } else {
            w.generate_asteroids(cfg.asteroids, 600.0, Vec3::ZERO, None);
        }
        if w.ships.len() == 2 {
            w.know = Some(crate::sense::Knowledge::new(&w));
        }
        w
    }

    /// Re-derive both ships' knowledge from the current state (after editing the world).
    pub fn resync_knowledge(&mut self) {
        if self.ships.len() == 2 {
            self.know = Some(crate::sense::Knowledge::new(self));
        }
    }

    /// The world as ship `me` knows it (the whole truth if nothing is tracked).
    pub fn perceived(&self, me: usize) -> World {
        match &self.know {
            Some(k) => k.perceived(self, me),
            None => self.clone(),
        }
    }

    /// What ship `me` knows of the other ship.
    pub fn contact(&self, me: usize) -> crate::sense::Contact {
        match &self.know {
            Some(k) => k.contacts[me],
            None => crate::sense::Knowledge::new(self).contacts[me],
        }
    }

    fn generate_planet(&mut self, asteroids: usize) {
        let gm = PLANET_GM;
        self.hazards.push(Hazard::Planet { pos: Vec3::ZERO, gm, radius: PLANET_RADIUS });
        // Ships start on eccentric orbits a quarter-orbit apart, in different planes: every lap
        // has a slow high stretch and a fast swoop low, and matches open with manoeuvring for a
        // firing line.
        let axis = self.rng.unit_vec();
        let side = axis.any_perp();
        for i in 0..self.ships.len() {
            let r = self.rng.range(400.0, 560.0);
            let ang = if i % 2 == 0 { 0.0 } else { self.rng.range(80.0f64, 110.0).to_radians() };
            let dir = axis * ang.cos() + side * ang.sin();
            let pos = (dir + self.rng.unit_vec() * 0.05).normalized() * r;
            let (rp, ra) = (self.rng.range(230.0, 360.0), self.rng.range(620.0, 760.0));
            let vel = eccentric_velocity(pos, rp, ra, gm, self.rng.f64() < 0.5, &mut self.rng);
            self.bodies[i].pos = pos;
            self.bodies[i].vel = vel;
            self.ships[i].orient = Quat::from_to(FORWARD, vel.normalized());
        }
        self.generate_asteroids(asteroids, self.arena.safe_radius - 60.0, Vec3::ZERO, Some(gm));
    }

    fn generate_asteroids(&mut self, n: usize, max_r: f64, centre: Vec3, gm: Option<f64>) {
        let mut placed = 0;
        let mut attempts = 0;
        while placed < n && attempts < 2000 {
            attempts += 1;
            let r = self.rng.range(12.0, 30.0);
            let orbit = self.rng.range(PLANET_RADIUS + 90.0, max_r);
            let pos = centre + self.rng.unit_vec() * orbit;
            if !self.bodies.iter().all(|b| (b.pos - pos).len() > b.radius + r + 45.0) {
                continue;
            }
            let mass = self.arena.asteroid_density * 4.0 / 3.0 * std::f64::consts::PI * r * r * r;
            let vel = match gm {
                Some(gm) => circular_velocity(pos, gm, &mut self.rng),
                None => self.rng.unit_vec() * self.rng.range(0.0, 3.0),
            };
            let id = self.alloc_id();
            self.bodies.push(Body { id, kind: Kind::Asteroid, pos, vel, mass, radius: r, alive: true, born: 0.0 });
            placed += 1;
        }
    }

    fn alloc_id(&mut self) -> BodyId {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    pub fn body_index(&self, id: BodyId) -> Option<usize> {
        self.bodies.iter().position(|b| b.id == id && b.alive)
    }

    pub fn planet(&self) -> Option<(Vec3, f64, f64)> {
        self.hazards.iter().map(|h| match *h {
            Hazard::Planet { pos, gm, radius } => (pos, gm, radius),
        }).next()
    }

    /// Ship mass: structure + remaining propellant + remaining ammunition.
    pub fn ship_mass(&self, i: usize) -> f64 {
        let s = &self.ships[i];
        let p = &s.params;
        p.dry_mass + s.propellant + s.ammo as f64 * p.driver.slug_mass
    }

    pub fn inertia(&self, i: usize) -> f64 {
        let b = &self.bodies[i];
        0.4 * b.mass * b.radius * b.radius
    }

    pub fn ang_vel(&self, i: usize) -> Vec3 {
        self.ships[i].ang_mom / self.inertia(i)
    }

    pub fn forward(&self, i: usize) -> Vec3 {
        self.ships[i].orient.rotate(FORWARD)
    }

    pub fn hull_frac(&self, i: usize) -> f64 {
        (self.ships[i].hull / self.ships[i].params.hull).max(0.0)
    }

    /// Hull lost per second at distance `r` from the planet.
    pub fn zone_rate(&self, r: f64) -> f64 {
        let over = r - self.safe_radius;
        if over <= 0.0 {
            return 0.0;
        }
        self.arena.zone_rates[((over / self.arena.zone_width) as usize).min(2)]
    }

    pub fn set_input(&mut self, i: usize, input: Input) {
        self.ships[i].input = input.sanitized();
    }

    /// Advance one fixed step. Events from this step are appended to `self.events`.
    pub fn step(&mut self) {
        let dt = self.arena.dt;
        let a = self.arena;
        if self.layout == Layout::Planet && self.t > a.sudden_death_at {
            let u = ((self.t - a.sudden_death_at) / (a.time_limit - a.sudden_death_at)).clamp(0.0, 1.0);
            self.safe_radius = a.safe_radius + (a.final_radius - a.safe_radius) * u;
        }
        for i in 0..self.ships.len() {
            self.update_ship(i, dt);
        }
        let mut damage = Vec::new();
        self.guide_missiles(dt);
        self.gravity(dt, &mut damage);
        self.sweep_rounds(dt, &mut damage);
        for b in self.bodies.iter_mut().filter(|b| b.alive) {
            b.pos += b.vel * dt;
        }
        self.collide(&mut damage);
        self.planet_contacts(&mut damage);
        self.boundary(&mut damage);
        self.zones(dt, &mut damage);
        for d in damage {
            self.apply_damage(d);
        }
        self.cleanup();
        self.t += dt;
        self.tick += 1;
        if let Some(mut k) = self.know.take() {
            k.update(self, dt);
            self.know = Some(k);
        }
        self.check_end();
    }

    fn update_ship(&mut self, i: usize, dt: f64) {
        if !self.ships[i].alive {
            self.ships[i].thrust_level = 0.0;
            self.ships[i].strafe_level = Vec3::ZERO;
            return;
        }
        let p = self.ships[i].params;
        let inp = self.ships[i].input;

        // Attitude (reaction wheels: free).
        {
            let s = &mut self.ships[i];
            s.ang_mom += s.orient.rotate(inp.torque * p.max_torque) * dt;
        }
        let w = self.ang_vel(i);
        let s = &mut self.ships[i];
        s.orient = s.orient.integrate(w, dt);
        let orient = s.orient;

        // Propulsion burns propellant: dm = |F| / ve * dt. The ship lightens as it burns.
        let fb = Vec3::new(inp.strafe.x * p.rcs_thrust, inp.strafe.y * p.rcs_thrust, inp.thrust * p.max_thrust + inp.strafe.z * p.rcs_thrust);
        let f_total = inp.thrust * p.max_thrust + (inp.strafe.x.abs() + inp.strafe.y.abs() + inp.strafe.z.abs()) * p.rcs_thrust;
        let mut dm = f_total / p.exhaust_vel * dt;
        let scale = if dm > s.propellant && dm > 0.0 { s.propellant / dm } else { 1.0 };
        dm *= scale;
        s.propellant -= dm;
        s.stats.propellant_used += dm;
        s.thrust_level = inp.thrust * scale;
        s.strafe_level = inp.strafe * scale;
        let b = &mut self.bodies[i];
        b.vel += orient.rotate(fb * scale) * (dt / b.mass);
        self.bodies[i].mass = self.ship_mass(i);

        // Mass driver.
        let s = &mut self.ships[i];
        s.reload = (s.reload - dt).max(0.0);
        if inp.fire && s.reload <= 0.0 && s.ammo > 0 {
            s.reload = p.driver.reload;
            self.fire(i, Weapon::Missile);
            let id = self.bodies.last().map(|b| b.id).unwrap_or(0);
            let (lo, hi) = self.arena.missile_lag;
            let lag = self.rng.range(lo, hi);
            self.missiles.push(Missile { id, owner: i, dv: self.arena.missile_dv, acc: Vec3::ZERO, lag, locked: false, burning: true });
        }
    }

    fn fire(&mut self, i: usize, weapon: Weapon) {
        let p = self.ships[i].params;
        let (speed, mass) = (p.driver.speed, p.driver.slug_mass);
        let fwd = self.forward(i);
        let dir = fwd;
        let w = self.ang_vel(i);
        let (spos, svel, smass, srad) = {
            let b = &self.bodies[i];
            (b.pos, b.vel, b.mass, b.radius)
        };
        let offset = fwd * (srad + 1.0);
        // Launch velocity relative to the ship. The ship's spin is deliberately not added: the
        // gunsight predicts a shot along the nose, and a spinning muzzle would throw rounds
        // tens of metres wide over an orbital flight. Recoil conserves momentum exactly:
        // M v = (M - m) v' + m (v' + rel).
        let _ = w;
        let rel = dir * speed;
        let ship_vel = svel - rel * (mass / smass);
        self.bodies[i].vel = ship_vel;
        let id = self.alloc_id();
        let t = self.t;
        self.bodies.push(Body {
            id,
            kind: Kind::Round { owner: i, weapon },
            pos: spos + offset,
            vel: ship_vel + rel,
            mass,
            radius: 0.0,
            alive: true,
            born: t,
        });
        let s = &mut self.ships[i];
        s.ammo -= 1;
        s.stats.shots += 1;
        self.bodies[i].mass = self.ship_mass(i);
        self.events.push(Event::Fire { ship: i, weapon, pos: spos + offset });
    }

    /// Missile guidance: proportional navigation on the target (its own seeker's view once
    /// locked, else the launcher's track of it), plus a push toward cruise closing speed, with a
    /// first-order steering lag and a delta-v budget.
    fn guide_missiles(&mut self, dt: f64) {
        let a = self.arena;
        for k in 0..self.missiles.len() {
            let m = self.missiles[k];
            let Some(bi) = self.bodies.iter().position(|b| b.id == m.id && b.alive) else { continue };
            let tgt = 1 - m.owner;
            let mut m2 = m;
            if tgt >= self.ships.len() || !self.ships[tgt].alive || m.dv <= 0.0 {
                m2.acc = Vec3::ZERO;
                m2.burning = false;
                self.missiles[k] = m2;
                continue;
            }
            let (mp, mv) = (self.bodies[bi].pos, self.bodies[bi].vel);
            let rel = self.bodies[tgt].pos - mp;
            let clear = crate::sense::line_of_sight(self, mp, self.bodies[tgt].pos);
            m2.locked = clear && rel.len() < a.seeker_range && mv.normalized_or(rel.normalized()).dot(rel.normalized()) > a.seeker_cos;
            let (tp, tv) = if m2.locked {
                (self.bodies[tgt].pos, self.bodies[tgt].vel)
            } else {
                let c = self.contact(m.owner);
                (c.pos, c.vel)
            };
            let r = tp - mp;
            let v = tv - mv;
            let rl = r.len().max(1e-3);
            let rh = r / rl;
            let vc = -v.dot(rh);
            let omega = r.cross(v) / (rl * rl);
            let mut cmd = omega.cross(rh) * (a.pn_gain * vc.max(1.0)) + rh * (a.missile_cruise - vc).clamp(0.0, a.missile_accel);
            if cmd.len() > a.missile_accel {
                cmd = cmd * (a.missile_accel / cmd.len());
            }
            m2.acc += (cmd - m2.acc) * (dt / m2.lag).min(1.0);
            let dv = m2.acc.len() * dt;
            if dv >= m2.dv {
                m2.acc = m2.acc * (m2.dv / dv.max(1e-9));
            }
            self.bodies[bi].vel += m2.acc * dt;
            m2.dv = (m2.dv - m2.acc.len() * dt).max(0.0);
            m2.burning = m2.acc.len() > 0.5 && m2.dv > 0.0;
            self.missiles[k] = m2;
        }
    }

    /// Planet gravity on everything, plus atmospheric drag and heating near the surface.
    /// Skimming the atmosphere is free braking (aerobraking) paid for in hull, and refuels:
    /// ships scoop propellant from the air, best nose-first into the airflow.
    fn gravity(&mut self, dt: f64, damage: &mut Vec<Damage>) {
        for s in self.ships.iter_mut() {
            s.heating = 0.0;
            s.scoop = 0.0;
            s.lift = Vec3::ZERO;
        }
        let Some((pc, gm, pr)) = self.planet() else { return };
        let a = self.arena;
        for b in self.bodies.iter_mut().filter(|b| b.alive) {
            let d = pc - b.pos;
            let r = d.len();
            let r2 = (r * r).max(pr * pr);
            b.vel += d.normalized() * (gm / r2 * dt);
            let alt = r - pr - b.radius;
            if alt < a.atmo_height && b.kind != Kind::Asteroid {
                let rho = (-alt.max(0.0) / a.atmo_scale).exp();
                let v = b.vel.len();
                if v < 1e-9 {
                    continue;
                }
                let vhat = b.vel / v;
                if let Kind::Ship(s) = b.kind {
                    // Ships are lifting bodies. Flown nose-first, the belly (body -Y) makes lift
                    // across the airflow: roll the belly toward the planet and the ship skips back
                    // out; roll it away and it digs in. Broadside, no lift and extra drag.
                    let sh = &mut self.ships[s];
                    let fwd = sh.orient.rotate(FORWARD);
                    let facing = fwd.dot(vhat).max(0.0);
                    let up = sh.orient.rotate(UP);
                    let across = up - vhat * up.dot(vhat);
                    let q = rho * v * v;
                    let drag = (a.atmo_drag * q * (1.0 + a.atmo_broadside_drag * (1.0 - facing)) * dt).min(v * 0.5);
                    let lift = across * (a.atmo_lift * q * facing * facing);
                    b.vel += lift * dt - vhat * drag;
                    sh.lift = lift;
                    let rate = a.atmo_heat * rho * v * v * v;
                    sh.heating = rate;
                    let intake = SCOOP_SIDEWAYS + (1.0 - SCOOP_SIDEWAYS) * facing;
                    let room = (sh.params.propellant - sh.propellant).max(0.0);
                    let dm = (a.atmo_scoop * rho * v * intake * dt).min(room);
                    if dm > 0.0 {
                        sh.propellant += dm;
                        sh.scoop = dm / dt;
                        sh.stats.propellant_scooped += dm;
                        b.mass = sh.params.dry_mass + sh.propellant + sh.ammo as f64 * sh.params.driver.slug_mass;
                    }
                    damage.push(Damage { victim: s, attacker: None, cause: Cause::Atmosphere, hp: rate * dt, pos: b.pos, dir: Vec3::ZERO });
                } else {
                    // Dense slugs punch through the thin air.
                    let dv = (a.atmo_drag * 0.2 * rho * v * v * dt).min(v * 0.5);
                    b.vel -= vhat * dv;
                }
            }
        }
    }

    /// Rounds are points moving fast enough to tunnel, so hits are swept in each target's
    /// frame over the step.
    fn sweep_rounds(&mut self, dt: f64, damage: &mut Vec<Damage>) {
        let targets: Vec<usize> = (0..self.bodies.len())
            .filter(|&j| self.bodies[j].alive && matches!(self.bodies[j].kind, Kind::Ship(_) | Kind::Asteroid))
            .collect();
        let planet = self.planet();
        for ri in 0..self.bodies.len() {
            let Kind::Round { owner, weapon } = self.bodies[ri].kind else { continue };
            if !self.bodies[ri].alive {
                continue;
            }
            let r = self.bodies[ri].clone();
            let mut best: Option<(f64, usize)> = None;
            for &j in &targets {
                let t = &self.bodies[j];
                if !t.alive || (j == owner && self.t - r.born < 1.0) {
                    continue;
                }
                let start = r.pos - t.pos;
                let end = start + (r.vel - t.vel) * dt;
                if let Some(s) = segment_sphere(start, end, Vec3::ZERO, t.radius) {
                    if best.map_or(true, |(bs, _)| s < bs) {
                        best = Some((s, j));
                    }
                }
            }
            if let Some((pc, _, pr)) = planet {
                if let Some(s) = segment_sphere(r.pos, r.pos + r.vel * dt, pc, pr) {
                    if best.map_or(true, |(bs, _)| s < bs) {
                        self.bodies[ri].alive = false;
                        self.events.push(Event::Impact { weapon, pos: r.pos + r.vel * (dt * s) });
                        continue;
                    }
                }
            }
            // No contact: the proximity fuze bursts at the closest pass within `fuze_radius` of a
            // ship's hull (armed after the same second of flight), throwing fragments.
            let mut burst: Option<(f64, f64, usize)> = None;
            if best.is_none() && self.t - r.born >= 1.0 {
                for &j in &targets {
                    let t = &self.bodies[j];
                    if !t.alive || !matches!(t.kind, Kind::Ship(_)) {
                        continue;
                    }
                    let start = r.pos - t.pos;
                    let dv = (r.vel - t.vel) * dt;
                    let s = if dv.len_sq() > 1e-12 { (-start.dot(dv) / dv.len_sq()).clamp(0.0, 1.0) } else { 1.0 };
                    let gap = (start + dv * s).len() - t.radius;
                    // Burst only once the pass is at its closest (inside this step, not still closing).
                    if s < 1.0 && gap < self.arena.fuze_radius && burst.map_or(true, |(_, g, _)| gap < g) {
                        burst = Some((s, gap, j));
                    }
                }
            }
            let (s, j, falloff) = match (best, burst) {
                (Some((s, j)), _) => (s, j, 1.0),
                // Warhead burst: full at contact, 40% at the edge of the fuze.
                (None, Some((s, gap, j))) => (s, j, self.arena.burst_max * (1.0 - 0.6 * gap.max(0.0) / self.arena.fuze_radius)),
                _ => continue,
            };
            self.bodies[ri].alive = false;
            let tgt_vel = self.bodies[j].vel;
            let hit_pos = r.pos + r.vel * (dt * s);
            let vrel = r.vel - tgt_vel;
            // The round's momentum (the fragments' share, for a burst) goes into what it hits.
            let tm = self.bodies[j].mass;
            self.bodies[j].vel += vrel * (falloff * r.mass / tm);
            match self.bodies[j].kind {
                Kind::Ship(v) => {
                    let hp = if weapon == Weapon::Missile {
                        (self.arena.warhead * falloff - self.ships[v].params.armor).max(0.0)
                    } else {
                        // Slugs: damage is the relative impact energy.
                        let energy = 0.5 * r.mass * vrel.len_sq();
                        (energy / self.arena.slug_joules_per_hp * falloff - self.ships[v].params.armor).max(0.0)
                    };
                    let dir = (hit_pos - self.bodies[j].pos).normalized_or(-vrel.normalized());
                    if falloff < 1.0 {
                        let dist = (hit_pos - self.bodies[j].pos).len() - self.bodies[j].radius;
                        self.events.push(Event::Burst { weapon, pos: hit_pos, victim: v, dist: dist.max(0.0) });
                        if hp <= 0.0 {
                            continue; // fragments that armour stops
                        }
                    }
                    // A hit is any slug that does damage: direct, or a burst (also counted apart).
                    if owner != v {
                        self.ships[owner].stats.hits += 1;
                        if falloff < 1.0 {
                            self.ships[owner].stats.bursts += 1;
                        }
                    }
                    damage.push(Damage { victim: v, attacker: Some(owner), cause: Cause::Slug, hp, pos: hit_pos, dir });
                }
                _ => self.events.push(Event::Impact { weapon, pos: hit_pos }),
            }
        }
    }

    /// Ships and asteroids: inelastic sphere collisions; dissipated energy is damage.
    fn collide(&mut self, damage: &mut Vec<Damage>) {
        let solid: Vec<usize> = (0..self.bodies.len())
            .filter(|&j| self.bodies[j].alive && matches!(self.bodies[j].kind, Kind::Ship(_) | Kind::Asteroid))
            .collect();
        for (k, &a) in solid.iter().enumerate() {
            for &b in &solid[k + 1..] {
                let d = self.bodies[b].pos - self.bodies[a].pos;
                let rsum = self.bodies[a].radius + self.bodies[b].radius;
                let dist = d.len();
                if dist >= rsum {
                    continue;
                }
                let n = if dist > 1e-9 { d / dist } else { Vec3::Y };
                let vn = (self.bodies[b].vel - self.bodies[a].vel).dot(n);
                let (ka, kb) = (self.bodies[a].kind, self.bodies[b].kind);
                if vn < 0.0 {
                    let e = match (ka, kb) {
                        (Kind::Ship(_), Kind::Ship(_)) => 0.3,
                        (Kind::Asteroid, Kind::Asteroid) => 0.5,
                        _ => 0.4,
                    };
                    let (ma, mb) = (self.bodies[a].mass, self.bodies[b].mass);
                    let mu = ma * mb / (ma + mb);
                    let j = -(1.0 + e) * vn * mu;
                    self.bodies[a].vel -= n * (j / ma);
                    self.bodies[b].vel += n * (j / mb);
                    let energy = (0.5 * mu * vn * vn * (1.0 - e * e) - self.arena.collision_threshold).max(0.0);
                    let hp = energy / self.arena.joules_per_hp;
                    let contact = self.bodies[a].pos + n * self.bodies[a].radius;
                    match (ka, kb) {
                        (Kind::Ship(sa), Kind::Ship(sb)) => {
                            self.ships[sa].stats.rams += 1;
                            self.ships[sb].stats.rams += 1;
                            let armor = |s: usize| self.ships[s].params.armor;
                            damage.push(Damage { victim: sa, attacker: Some(sb), cause: Cause::Ram, hp: hp * 0.5 - armor(sa), pos: contact, dir: n });
                            damage.push(Damage { victim: sb, attacker: Some(sa), cause: Cause::Ram, hp: hp * 0.5 - armor(sb), pos: contact, dir: -n });
                        }
                        (Kind::Ship(s), Kind::Asteroid) => {
                            damage.push(Damage { victim: s, attacker: None, cause: Cause::Asteroid, hp: hp - self.ships[s].params.armor, pos: contact, dir: n })
                        }
                        (Kind::Asteroid, Kind::Ship(s)) => {
                            damage.push(Damage { victim: s, attacker: None, cause: Cause::Asteroid, hp: hp - self.ships[s].params.armor, pos: contact, dir: -n })
                        }
                        _ => {}
                    }
                }
                let overlap = rsum - dist;
                let (wa, wb) = (1.0 / self.bodies[a].mass, 1.0 / self.bodies[b].mass);
                let s = overlap / (wa + wb);
                self.bodies[a].pos -= n * (s * wa);
                self.bodies[b].pos += n * (s * wb);
            }
        }
    }

    fn planet_contacts(&mut self, damage: &mut Vec<Damage>) {
        let Some((pc, _, pr)) = self.planet() else { return };
        for i in 0..self.bodies.len() {
            let b = &mut self.bodies[i];
            if !b.alive || matches!(b.kind, Kind::Round { .. }) {
                continue;
            }
            let d = b.pos - pc;
            let dist = d.len();
            if dist >= pr + b.radius || dist < 1e-9 {
                continue;
            }
            let n = d / dist;
            b.pos = pc + n * (pr + b.radius);
            let vn = b.vel.dot(n);
            if vn >= 0.0 {
                continue;
            }
            let e = 0.3;
            b.vel -= n * (vn * (1.0 + e));
            let energy = (0.5 * b.mass * vn * vn * (1.0 - e * e) - self.arena.collision_threshold).max(0.0);
            let _ = energy;
            if let Kind::Ship(s) = b.kind {
                // Hitting the planet is lethal, at any speed.
                let hp = self.ships[s].hull + 1.0;
                damage.push(Damage { victim: s, attacker: None, cause: Cause::Planet, hp, pos: b.pos - n * b.radius, dir: -n });
            }
        }
    }

    fn boundary(&mut self, damage: &mut Vec<Damage>) {
        let r_arena = self.arena.arena_radius;
        for i in 0..self.bodies.len() {
            let b = &mut self.bodies[i];
            if !b.alive {
                continue;
            }
            let dist = b.pos.len();
            if dist + b.radius <= r_arena {
                continue;
            }
            if matches!(b.kind, Kind::Round { .. }) {
                b.alive = false;
                continue;
            }
            let n = b.pos / dist;
            let vn = b.vel.dot(n);
            b.pos = n * (r_arena - b.radius);
            if vn > 0.0 {
                b.vel -= n * (vn * 1.5);
                if let Kind::Ship(s) = b.kind {
                    let hp = (0.5 * b.mass * vn * vn * 0.75) / self.arena.joules_per_hp;
                    damage.push(Damage { victim: s, attacker: None, cause: Cause::Wall, hp, pos: b.pos, dir: n });
                }
            }
        }
    }

    fn zones(&mut self, dt: f64, damage: &mut Vec<Damage>) {
        let Some((pc, _, _)) = self.planet() else { return };
        for i in 0..self.ships.len() {
            let rate = if self.ships[i].alive { self.zone_rate((self.bodies[i].pos - pc).len()) } else { 0.0 };
            self.ships[i].zone_burn = rate;
            if rate > 0.0 {
                let pos = self.bodies[i].pos;
                damage.push(Damage { victim: i, attacker: None, cause: Cause::Zone, hp: rate * dt, pos, dir: Vec3::ZERO });
            }
        }
    }

    fn apply_damage(&mut self, d: Damage) {
        let s = d.victim;
        if !self.ships[s].alive || d.hp <= 0.0 {
            return;
        }
        let hp = d.hp.min(self.ships[s].hull);
        self.ships[s].hull -= hp;
        self.ships[s].stats.damage_taken += hp;
        if let Some(a) = d.attacker.filter(|&a| a != s) {
            self.ships[a].stats.damage_dealt += hp;
        }
        // Zone burn is continuous: no event spam and no tumbling.
        if !matches!(d.cause, Cause::Zone | Cause::Atmosphere) {
            self.events.push(Event::Hit { victim: s, attacker: d.attacker, cause: d.cause, damage: hp, pos: d.pos });
            let axis = (d.dir.any_perp() + self.rng.unit_vec() * 0.5).normalized_or(Vec3::X);
            self.ships[s].ang_mom += axis * (hp * self.arena.spin_kick * self.bodies[s].radius);
        }
        if self.ships[s].hull <= 0.0 {
            self.ships[s].alive = false;
            self.bodies[s].alive = false;
            let attacker = d.attacker.filter(|&a| a != s);
            self.events.push(Event::Kill { victim: s, attacker, cause: d.cause, pos: self.bodies[s].pos });
        }
    }

    fn cleanup(&mut self) {
        let n_ships = self.ships.len();
        let (t, life, mlife) = (self.t, self.arena.slug_life, self.arena.missile_life);
        let mut idx = 0;
        self.bodies.retain(|b| {
            let expired = match b.kind {
                Kind::Round { weapon: Weapon::Missile, .. } => t - b.born > mlife,
                Kind::Round { .. } => t - b.born > life,
                _ => false,
            };
            let keep = idx < n_ships || (b.alive && !expired);
            idx += 1;
            keep
        });
        let bodies = &self.bodies;
        self.missiles.retain(|m| bodies.iter().any(|b| b.id == m.id && b.alive));
        for i in 0..n_ships {
            let sp = self.bodies[i].vel.len();
            let st = &mut self.ships[i].stats;
            st.max_speed = st.max_speed.max(sp);
        }
    }

    fn check_end(&mut self) {
        if self.finished {
            return;
        }
        let alive: Vec<usize> = (0..self.ships.len()).filter(|&i| self.ships[i].alive).collect();
        if alive.len() <= 1 {
            self.finished = true;
            self.winner = alive.first().copied();
            self.events.push(Event::MatchEnd { winner: self.winner, decision: false });
        } else if self.t >= self.arena.time_limit {
            // Decision at the bell: highest hull fraction wins.
            self.finished = true;
            let f = |i: usize| self.hull_frac(i);
            let best = alive.iter().copied().max_by(|&a, &b| f(a).partial_cmp(&f(b)).unwrap()).unwrap();
            let tie = alive.iter().filter(|&&i| (f(i) - f(best)).abs() < 1e-9).count() > 1;
            self.winner = if tie { None } else { Some(best) };
            self.events.push(Event::MatchEnd { winner: self.winner, decision: true });
        }
    }

    /// Fingerprint for determinism tests.
    pub fn fingerprint(&self) -> u64 {
        let mut h: u64 = 0xcbf29ce484222325;
        for b in &self.bodies {
            for v in [b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.mass] {
                h ^= v.to_bits();
                h = h.wrapping_mul(0x100000001b3);
            }
        }
        h
    }

    /// Total linear momentum of all live bodies (exhaust excluded).
    pub fn momentum(&self) -> Vec3 {
        self.bodies.iter().filter(|b| b.alive).fold(Vec3::ZERO, |acc, b| acc + b.vel * b.mass)
    }
}

/// Fraction along segment p0->p1 where it first enters the sphere, if it does.
pub fn segment_sphere(p0: Vec3, p1: Vec3, c: Vec3, r: f64) -> Option<f64> {
    let d = p1 - p0;
    let f = p0 - c;
    let cc = f.len_sq() - r * r;
    if cc <= 0.0 {
        return Some(0.0);
    }
    let a = d.len_sq();
    if a < 1e-12 {
        return None;
    }
    let b = f.dot(d);
    let disc = b * b - a * cc;
    if disc < 0.0 {
        return None;
    }
    let t = (-b - disc.sqrt()) / a;
    if (0.0..=1.0).contains(&t) {
        Some(t)
    } else {
        None
    }
}
