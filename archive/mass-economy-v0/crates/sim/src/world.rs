//! The world: bodies, ships, and the fixed-step simulation.
//!
//! Invariant: `bodies[i]` for `i < ships.len()` is ship `i`'s body. Ship bodies are never
//! removed (a destroyed ship's body stays with `alive == false`), and cleanup uses order-
//! preserving `retain`, so ship indices are stable.

use crate::math::{Quat, Rng, Vec3};
use crate::params::{ArenaParams, ShipParams, ARENA};

pub type BodyId = u32;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    Ship(usize),
    /// A thrown slug. Becomes `Debris` after its first collision.
    Slug { owner: usize },
    Debris,
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
    /// Ships cannot scoop this body before this time (fresh chunks fly off first).
    pub no_scoop_until: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Input {
    /// Main engine, 0..1.
    pub thrust: f64,
    /// Body-frame torque command, each axis -1..1.
    pub torque: Vec3,
    /// Target arm extension, 0..1.
    pub arms: f64,
    /// Hold to charge a slug; release to throw.
    pub charge: bool,
    /// Hold to keep a tether out (fires if none); release to let go.
    pub tether: bool,
    /// Positive reels in, negative pays out, -1..1.
    pub reel: f64,
    /// Positive pulls, negative pushes, -1..1.
    pub field: f64,
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
        self.thrust = c(self.thrust, 0.0, 1.0);
        self.torque = Vec3::new(
            c(self.torque.x, -1.0, 1.0),
            c(self.torque.y, -1.0, 1.0),
            c(self.torque.z, -1.0, 1.0),
        );
        self.arms = c(self.arms, 0.0, 1.0);
        self.reel = c(self.reel, -1.0, 1.0);
        self.field = c(self.field, -1.0, 1.0);
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Tether {
    None,
    Flying { pos: Vec3, vel: Vec3 },
    Attached { target: BodyId, rest: f64 },
}

#[derive(Clone, Copy, Debug, Default)]
pub struct ShipStats {
    pub damage_dealt: f64,
    pub damage_taken: f64,
    pub hits_landed: u32,
    pub throws: u32,
    pub mass_thrown: f64,
    pub mass_scooped: f64,
    pub mass_burned: f64,
    pub tether_attaches: u32,
    pub tether_snaps: u32,
    pub wall_hits: u32,
    pub rams: u32,
    pub max_speed: f64,
}

#[derive(Clone, Debug)]
pub struct Ship {
    pub params: ShipParams,
    pub orient: Quat,
    /// World-frame angular momentum. Angular velocity is derived: w = L / I.
    pub ang_mom: Vec3,
    pub arms: f64,
    /// kg currently charged at the nose (still part of ship mass).
    pub charge: f64,
    pub input: Input,
    pub tether: Tether,
    /// Low-pass filtered tether tension (N).
    pub tension: f64,
    pub tether_cd: f64,
    pub throw_cd: f64,
    /// Actual thrust fraction applied last step (for rendering).
    pub thrust_level: f64,
    /// Actual field level applied last step (for rendering).
    pub field_level: f64,
    /// Mass ablated per second by nebula dust last step (for rendering).
    pub ablation: f64,
    /// Mass burned per second by the zones last step (for rendering).
    pub zone_burn: f64,
    pub alive: bool,
    pub stats: ShipStats,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Cause {
    Slug,
    Ram,
    Debris,
    Asteroid,
    Wall,
    Well,
    Nebula,
    Planet,
    /// Burned by the zones beyond the safe radius.
    Zone,
}

/// Static arena features. Asteroids are bodies; these are fields and fixtures.
/// Hazards act on ships, slugs and debris alike (so they bend throws too), but not asteroids.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Hazard {
    /// Immovable core with real inverse-square gravity. Hitting the core hurts.
    Well { pos: Vec3, gm: f64, core: f64 },
    /// The centre of the planet layout: a well that also pulls asteroids, so everything
    /// orbits. Slugs and debris that hit it are gone.
    Planet { pos: Vec3, gm: f64, radius: f64 },
    /// Dust cloud: quadratic drag (free braking, stops slugs) that ablates ship mass
    /// in proportion to speed cubed. Denser toward the centre.
    Nebula { pos: Vec3, radius: f64, drag: f64 },
    /// A current: constant acceleration along segment a->b, within `radius` of it.
    Stream { a: Vec3, b: Vec3, radius: f64, accel: f64 },
}

impl Hazard {
    /// Acceleration this hazard imposes on a body at `p` moving at `v` (drag included).
    /// Returns (acceleration, nebula density factor 0..1).
    pub fn accel(&self, p: Vec3, v: Vec3) -> (Vec3, f64) {
        match *self {
            Hazard::Well { pos, gm, core } | Hazard::Planet { pos, gm, radius: core } => {
                let d = pos - p;
                let r2 = d.len_sq().max(core * core);
                (d.normalized() * (gm / r2), 0.0)
            }
            Hazard::Nebula { pos, radius, drag } => {
                let q = (p - pos).len_sq() / (radius * radius);
                if q >= 1.0 {
                    return (Vec3::ZERO, 0.0);
                }
                let k = 1.0 - q;
                (-v * (v.len() * drag * k), k)
            }
            Hazard::Stream { a, b, radius, accel } => {
                let ab = b - a;
                let t = ((p - a).dot(ab) / ab.len_sq()).clamp(0.0, 1.0);
                let d = (a + ab * t - p).len();
                if d >= radius || t <= 0.0 || t >= 1.0 {
                    return (Vec3::ZERO, 0.0);
                }
                let k = 1.0 - (d / radius).powi(2);
                (ab.normalized() * (accel * k), 0.0)
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Event {
    Throw { ship: usize, mass: f64, pos: Vec3 },
    Hit { victim: usize, attacker: Option<usize>, cause: Cause, lost: f64, energy: f64, pos: Vec3 },
    Scoop { ship: usize, mass: f64, pos: Vec3 },
    TetherFire { ship: usize },
    TetherAttach { ship: usize, target: BodyId },
    TetherSnap { ship: usize, pos: Vec3 },
    TetherRelease { ship: usize },
    TetherMiss { ship: usize },
    Kill { victim: usize, attacker: Option<usize>, pos: Vec3 },
    /// `decision` is true when the time limit forced a result (winner on reserve fraction).
    MatchEnd { winner: Option<usize>, decision: bool },
}

pub struct MatchConfig {
    pub seed: u64,
    pub ships: Vec<ShipParams>,
    pub asteroids: usize,
    pub layout: Layout,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Layout {
    /// Nothing but the ships (and any asteroids): for tests.
    Empty,
    /// Walled arena with wells, nebulae, streams and scrap.
    Hazards,
    /// A fight around one planet: everything orbits; burn zones beyond a safe radius.
    Planet,
}

impl MatchConfig {
    /// The standard match: the planet.
    pub fn standard(seed: u64, ships: Vec<ShipParams>) -> MatchConfig {
        MatchConfig { seed, ships, asteroids: 10, layout: Layout::Planet }
    }
}

pub const PLANET_RADIUS: f64 = 150.0;
/// GM chosen so a circular orbit at 400 m runs ~40 m/s (period ~1 min).
pub const PLANET_GM: f64 = 640_000.0;

/// Velocity for a circular orbit at `pos` around a body at the origin, in a random plane
/// containing `pos`.
fn circular_velocity(pos: Vec3, gm: f64, rng: &mut Rng) -> Vec3 {
    let r = pos.len();
    let radial = pos / r;
    let t = (rng.unit_vec() - radial * rng.unit_vec().dot(radial)).normalized_or(radial.any_perp());
    let tangent = (t - radial * t.dot(radial)).normalized_or(radial.any_perp());
    tangent * (gm / r).sqrt()
}

#[derive(Clone)]
pub struct World {
    pub arena: ArenaParams,
    /// Arena radius before sudden death shrinks it.
    pub base_radius: f64,
    pub layout: Layout,
    /// Current safe radius (planet layout); shrinks in sudden death.
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
}

pub fn radius_for(mass: f64, density: f64) -> f64 {
    (3.0 * mass.max(0.0) / (4.0 * std::f64::consts::PI * density)).cbrt()
}

pub const FORWARD: Vec3 = Vec3::Z;

struct Damage {
    victim: usize,
    attacker: Option<usize>,
    cause: Cause,
    energy: f64,
    /// Unit vector from ship centre toward the impact.
    dir: Vec3,
}

impl World {
    pub fn new(cfg: MatchConfig) -> World {
        let hazards_on = cfg.layout == Layout::Hazards;
        let planet = cfg.layout == Layout::Planet;
        let mut arena = ARENA;
        if planet {
            // Hard backstop far beyond the burn zones; the zones do the real work.
            arena.arena_radius = 2000.0;
        }
        let mut w = World {
            arena,
            base_radius: arena.arena_radius,
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
        };

        // Ships on a random axis, facing each other, with some jitter.
        let n = cfg.ships.len();
        let axis = w.rng.unit_vec();
        for (i, p) in cfg.ships.iter().enumerate() {
            let ang = i as f64 / n as f64 * std::f64::consts::TAU;
            let side = axis.any_perp();
            let up = axis.cross(side);
            let pos = (side * ang.cos() + up * ang.sin()) * 350.0 + w.rng.unit_vec() * 30.0;
            let look = (-pos + w.rng.unit_vec() * 40.0).normalized();
            let orient = Quat::from_to(FORWARD, look);
            let id = w.alloc_id();
            w.bodies.push(Body {
                id,
                kind: Kind::Ship(i),
                pos,
                vel: Vec3::ZERO,
                mass: p.start_mass,
                radius: radius_for(p.start_mass, arena.density),
                alive: true,
                born: 0.0,
                no_scoop_until: 0.0,
            });
            w.ships.push(Ship {
                params: *p,
                orient,
                ang_mom: Vec3::ZERO,
                arms: 0.0,
                charge: 0.0,
                input: Input::default(),
                tether: Tether::None,
                tension: 0.0,
                tether_cd: 0.0,
                throw_cd: 0.0,
                thrust_level: 0.0,
                field_level: 0.0,
                ablation: 0.0,
                zone_burn: 0.0,
                alive: true,
                stats: ShipStats::default(),
            });
        }

        if planet {
            w.generate_planet(&cfg);
            return w;
        }

        if hazards_on {
            w.generate_hazards();
        }

        // Asteroids, kept clear of each other, the ships, and hazard fixtures.
        let mut placed = 0;
        let mut attempts = 0;
        while placed < cfg.asteroids && attempts < 1000 {
            attempts += 1;
            let r = w.rng.range(16.0, 42.0);
            let pos = w.rng.unit_vec() * w.rng.range(0.0, arena.arena_radius * 0.8);
            let clear = w.bodies.iter().all(|b| (b.pos - pos).len() > b.radius + r + 45.0)
                && w.hazards.iter().all(|h| match *h {
                    Hazard::Well { pos: hp, core, .. } => (hp - pos).len() > core + r + 150.0,
                    _ => true,
                });
            if !clear {
                continue;
            }
            let mass = arena.asteroid_density * 4.0 / 3.0 * std::f64::consts::PI * r * r * r;
            let id = w.alloc_id();
            let vel = w.rng.unit_vec() * w.rng.range(0.0, 3.0);
            w.bodies.push(Body {
                id,
                kind: Kind::Asteroid,
                pos,
                vel,
                mass,
                radius: r,
                alive: true,
                born: 0.0,
                no_scoop_until: 0.0,
            });
            placed += 1;
        }

        if hazards_on {
            w.generate_scrap();
        }
        w
    }

    fn generate_planet(&mut self, cfg: &MatchConfig) {
        let gm = PLANET_GM;
        self.hazards.push(Hazard::Planet { pos: Vec3::ZERO, gm, radius: PLANET_RADIUS });

        // Ships start in circular orbits a few hundred metres apart on the same side of the
        // planet, in different planes: their paths cross and separate as they go round.
        let axis = self.rng.unit_vec();
        let n = self.ships.len();
        for i in 0..n {
            let r = self.rng.range(380.0, 560.0);
            let offset = axis.any_perp() * (if i % 2 == 0 { 0.3 } else { -0.3 });
            let pos = (axis + offset + self.rng.unit_vec() * 0.08).normalized() * r;
            let vel = circular_velocity(pos, gm, &mut self.rng);
            self.bodies[i].pos = pos;
            self.bodies[i].vel = vel;
            self.ships[i].orient = Quat::from_to(FORWARD, vel.normalized());
        }

        // Asteroids in circular orbits of their own: moving cover and moving anchors.
        let mut placed = 0;
        let mut attempts = 0;
        while placed < cfg.asteroids && attempts < 1000 {
            attempts += 1;
            let r = self.rng.range(14.0, 34.0);
            let orbit = self.rng.range(PLANET_RADIUS + 90.0, self.arena.safe_radius - 60.0);
            let pos = self.rng.unit_vec() * orbit;
            if !self.bodies.iter().all(|b| (b.pos - pos).len() > b.radius + r + 45.0) {
                continue;
            }
            let mass = self.arena.asteroid_density * 4.0 / 3.0 * std::f64::consts::PI * r * r * r;
            let vel = circular_velocity(pos, gm, &mut self.rng);
            let id = self.alloc_id();
            self.bodies.push(Body { id, kind: Kind::Asteroid, pos, vel, mass, radius: r, alive: true, born: 0.0, no_scoop_until: 0.0 });
            placed += 1;
        }

        // Scrap clusters, each sharing one orbit.
        let fields = 5 + (self.rng.f64() * 3.0) as usize;
        for _ in 0..fields {
            let orbit = self.rng.range(PLANET_RADIUS + 80.0, self.arena.safe_radius - 40.0);
            let centre = self.rng.unit_vec() * orbit;
            let vel = circular_velocity(centre, gm, &mut self.rng);
            let count = 10 + (self.rng.f64() * 10.0) as usize;
            for _ in 0..count {
                let mass = self.rng.range(10.0, 35.0);
                let pos = centre + self.rng.unit_vec() * self.rng.range(0.0, 50.0);
                if self.bodies.iter().any(|b| (b.pos - pos).len() < b.radius + 5.0) {
                    continue;
                }
                let id = self.alloc_id();
                self.bodies.push(Body {
                    id,
                    kind: Kind::Debris,
                    pos,
                    vel: vel + self.rng.unit_vec() * self.rng.range(0.0, 1.0),
                    mass,
                    radius: radius_for(mass, self.arena.density),
                    alive: true,
                    born: 0.0,
                    no_scoop_until: 0.0,
                });
            }
        }
    }

    /// Mass burned per second at distance `r` from the planet.
    pub fn zone_rate(&self, r: f64) -> f64 {
        let over = r - self.safe_radius;
        if over <= 0.0 {
            return 0.0;
        }
        let band = ((over / self.arena.zone_width) as usize).min(2);
        self.arena.zone_rates[band]
    }

    /// Scrap fields: clusters of loose, scoopable mass. The arena's economy — worth
    /// contesting, a route back from the brink, and dangerous to fly through fast.
    fn generate_scrap(&mut self) {
        let big_r = self.arena.arena_radius;
        let fields = 4 + (self.rng.f64() * 3.0) as usize;
        for _ in 0..fields {
            let centre = self.rng.unit_vec() * self.rng.range(150.0, big_r * 0.8);
            let drift = self.rng.unit_vec() * self.rng.range(0.0, 4.0);
            let n = 10 + (self.rng.f64() * 10.0) as usize;
            for _ in 0..n {
                let mass = self.rng.range(10.0, 35.0);
                let pos = centre + self.rng.unit_vec() * self.rng.range(0.0, 60.0);
                let inside_well = self.hazards.iter().any(|h| matches!(*h, Hazard::Well { pos: q, core, .. } if (q - pos).len() < core + 30.0));
                let inside_rock = self.bodies.iter().any(|b| (b.pos - pos).len() < b.radius + 5.0);
                if inside_well || inside_rock {
                    continue;
                }
                let id = self.alloc_id();
                self.bodies.push(Body {
                    id,
                    kind: Kind::Debris,
                    pos,
                    vel: drift + self.rng.unit_vec() * self.rng.range(0.0, 1.5),
                    mass,
                    radius: radius_for(mass, self.arena.density),
                    alive: true,
                    born: 0.0,
                    no_scoop_until: 0.0,
                });
            }
        }
    }

    fn generate_hazards(&mut self) {
        let big_r = self.arena.arena_radius;
        let spawns: Vec<Vec3> = self.bodies.iter().map(|b| b.pos).collect();
        let clear_of_spawns = |p: Vec3, m: f64| spawns.iter().all(|s| (*s - p).len() > m);
        let wells = 1 + (self.rng.f64() * 2.0) as usize;
        let mut tries = 0;
        while self.hazards.iter().filter(|h| matches!(h, Hazard::Well { .. })).count() < wells && tries < 500 {
            tries += 1;
            let pos = self.rng.unit_vec() * self.rng.range(0.0, big_r * 0.6);
            let core = self.rng.range(30.0, 55.0);
            let far = self.hazards.iter().all(|h| match *h {
                Hazard::Well { pos: q, .. } => (q - pos).len() > 450.0,
                _ => true,
            });
            if far && clear_of_spawns(pos, 260.0) {
                // Surface gravity near/above engine authority: the core is a trap, the
                // outskirts are a slingshot.
                let surface_g = self.rng.range(15.0, 30.0);
                let gm = surface_g * core * core;
                self.hazards.push(Hazard::Well { pos, gm, core });
            }
        }
        let nebulae = 2 + (self.rng.f64() * 2.0) as usize;
        tries = 0;
        let mut placed = 0;
        while placed < nebulae && tries < 500 {
            tries += 1;
            let radius = self.rng.range(120.0, 260.0);
            let pos = self.rng.unit_vec() * self.rng.range(0.0, big_r * 0.8);
            let ok = clear_of_spawns(pos, radius + 60.0)
                && pos.len() + radius < big_r
                && self.hazards.iter().all(|h| match *h {
                    Hazard::Well { pos: q, core, .. } => (q - pos).len() > radius + core + 40.0,
                    Hazard::Nebula { pos: q, radius: r, .. } => (q - pos).len() > radius + r,
                    _ => true,
                });
            if ok {
                let drag = self.rng.range(0.002, 0.004);
                self.hazards.push(Hazard::Nebula { pos, radius, drag });
                placed += 1;
            }
        }
        let streams = 1 + (self.rng.f64() * 2.0) as usize;
        for _ in 0..streams {
            let mid = self.rng.unit_vec() * self.rng.range(0.0, big_r * 0.5);
            let dir = self.rng.unit_vec();
            let half = self.rng.range(250.0, 450.0);
            let (a, b) = (mid - dir * half, mid + dir * half);
            let radius = self.rng.range(40.0, 70.0);
            let accel = self.rng.range(12.0, 20.0);
            self.hazards.push(Hazard::Stream { a, b, radius, accel });
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

    pub fn inertia(&self, i: usize) -> f64 {
        let b = &self.bodies[i];
        let s = &self.ships[i];
        0.4 * b.mass * b.radius * b.radius * (1.0 + s.params.arm_gain * s.arms)
    }

    pub fn ang_vel(&self, i: usize) -> Vec3 {
        self.ships[i].ang_mom / self.inertia(i)
    }

    pub fn forward(&self, i: usize) -> Vec3 {
        self.ships[i].orient.rotate(FORWARD)
    }

    pub fn reserve(&self, i: usize) -> f64 {
        (self.bodies[i].mass - self.ships[i].params.core_mass).max(0.0)
    }

    pub fn set_input(&mut self, i: usize, input: Input) {
        self.ships[i].input = input.sanitized();
    }

    /// Advance one fixed step. Events from this step are appended to `self.events`.
    pub fn step(&mut self) {
        let dt = self.arena.dt;
        // Sudden death: the wall closes in, forcing a climax. No sport should end in a stall.
        let a = self.arena;
        if self.t > a.sudden_death_at {
            let u = ((self.t - a.sudden_death_at) / (a.time_limit - a.sudden_death_at)).clamp(0.0, 1.0);
            if self.layout == Layout::Planet {
                // The safe zone contracts toward the planet.
                self.safe_radius = a.safe_radius + (a.final_radius - a.safe_radius) * u;
            } else {
                self.arena.arena_radius = self.base_radius + (a.final_radius - self.base_radius) * u;
            }
        }
        for i in 0..self.ships.len() {
            self.update_ship(i, dt);
        }
        self.apply_hazards(dt);
        for b in self.bodies.iter_mut().filter(|b| b.alive) {
            b.pos += b.vel * dt;
        }
        for i in 0..self.ships.len() {
            self.solve_tether(i, dt);
        }
        let mut damage = Vec::new();
        self.collide(&mut damage);
        self.boundary(&mut damage);
        self.well_cores(&mut damage);
        for d in damage {
            self.apply_damage(d);
        }
        self.cleanup();
        self.t += dt;
        self.tick += 1;
        self.check_end();
    }

    fn update_ship(&mut self, i: usize, dt: f64) {
        if !self.ships[i].alive {
            return;
        }
        let p = self.ships[i].params;
        let inp = self.ships[i].input;

        // Arms move toward target at a limited rate. Angular momentum is conserved,
        // so tucking in spins you up.
        {
            let s = &mut self.ships[i];
            let step = p.arm_rate * dt;
            s.arms += (inp.arms - s.arms).clamp(-step, step);
        }

        let avail =|w: &World| (w.bodies[i].mass - p.core_mass - w.ships[i].charge - 1.0).max(0.0);

        // Attitude.
        let t_amount = (inp.torque.x.abs() + inp.torque.y.abs() + inp.torque.z.abs()) / 3.0;
        let rcs_dm = p.rcs_cost * t_amount * dt;
        if rcs_dm <= avail(self) {
            let s = &mut self.ships[i];
            s.ang_mom += s.orient.rotate(inp.torque * p.max_torque) * dt;
            self.bodies[i].mass -= rcs_dm;
            self.ships[i].stats.mass_burned += rcs_dm;
        }
        let w = self.ang_vel(i);
        let s = &mut self.ships[i];
        s.orient = s.orient.integrate(w, dt);
        let fwd = s.orient.rotate(FORWARD);

        // Main engine: rocket equation, dv = ve * dm / m.
        let mut dm = inp.thrust * p.max_thrust / p.exhaust_vel * dt;
        dm = dm.min(avail(self));
        {
            let b = &mut self.bodies[i];
            b.vel += fwd * (p.exhaust_vel * dm / b.mass);
            b.mass -= dm;
        }
        self.ships[i].thrust_level = dm * p.exhaust_vel / dt / p.max_thrust;
        self.ships[i].stats.mass_burned += dm;

        // Field: fixed relative acceleration between ship and each body in the cone, split
        // by mass. Pull a rock and you fly to it; pull a slug and it flies to you. Total force
        // is capped, and mass is burned in proportion to the impulse delivered.
        let field = inp.field;
        self.ships[i].field_level = 0.0;
        if field.abs() > 0.01 {
            let cos_cone = p.field_cone_deg.to_radians().cos();
            let (spos, smass) = (self.bodies[i].pos, self.bodies[i].mass);
            let mut pulls: Vec<(usize, Vec3, f64)> = Vec::new();
            let mut total = 0.0;
            for j in 0..self.bodies.len() {
                let bj = &self.bodies[j];
                if j == i || !bj.alive {
                    continue;
                }
                let d = bj.pos - spos;
                let dist = d.len();
                let reach = p.field_range + bj.radius;
                if dist > reach || dist < 1e-6 {
                    continue;
                }
                let dir = d / dist;
                if dir.dot(fwd) < cos_cone {
                    continue;
                }
                let a_rel = p.field_accel * field.abs() * (1.0 - dist / reach);
                let mu = smass * bj.mass / (smass + bj.mass);
                let f = mu * a_rel;
                total += f;
                pulls.push((j, dir, f));
            }
            let scale = if total > p.field_max_force { p.field_max_force / total } else { 1.0 };
            let applied = total * scale;
            let f_dm = applied * dt / p.field_ve;
            if applied > 0.0 && f_dm <= avail(self) {
                let mut ship_dv = Vec3::ZERO;
                for (j, dir, f) in pulls {
                    let f = f * scale * field.signum(); // + pulls
                    let bj = &mut self.bodies[j];
                    bj.vel -= dir * (f / bj.mass * dt);
                    ship_dv += dir * (f / smass * dt);
                }
                self.bodies[i].vel += ship_dv;
                self.bodies[i].mass -= f_dm;
                self.ships[i].stats.mass_burned += f_dm;
                self.ships[i].field_level = field * (applied / p.field_max_force).max(0.15);
            }
        }

        // Throw.
        self.ships[i].throw_cd -= dt;
        if inp.charge && self.ships[i].throw_cd <= 0.0 {
            let room = (p.throw_max - self.ships[i].charge).max(0.0);
            let add = (p.charge_rate * dt).min(room).min(avail(self));
            self.ships[i].charge += add;
        } else if !inp.charge && self.ships[i].charge > 0.0 {
            let c = self.ships[i].charge;
            self.ships[i].charge = 0.0;
            if c >= p.throw_min {
                self.throw_slug(i, c, fwd);
            }
        }

        // Tether.
        self.update_tether(i, fwd, dt);
    }

    fn apply_hazards(&mut self, dt: f64) {
        if self.hazards.is_empty() {
            return;
        }
        let abl = self.arena.ablation;
        for s in self.ships.iter_mut() {
            s.ablation = 0.0;
        }
        let mut burned_out: Vec<(usize, Cause)> = Vec::new();
        let planet_centre = self.hazards.iter().find_map(|h| match *h {
            Hazard::Planet { pos, .. } => Some(pos),
            _ => None,
        });
        let safe = self.safe_radius;
        let zone_rates = self.arena.zone_rates;
        let zone_width = self.arena.zone_width;
        for s in self.ships.iter_mut() {
            s.zone_burn = 0.0;
        }
        for b in self.bodies.iter_mut() {
            if !b.alive {
                continue;
            }
            let asteroid = b.kind == Kind::Asteroid;
            let mut acc = Vec3::ZERO;
            let mut density: f64 = 0.0;
            for h in &self.hazards {
                // Asteroids only feel the planet.
                if asteroid && !matches!(h, Hazard::Planet { .. }) {
                    continue;
                }
                let (a, k) = h.accel(b.pos, b.vel);
                acc += a;
                density = density.max(k);
            }
            b.vel += acc * dt;
            if let (Kind::Ship(i), Some(c)) = (b.kind, planet_centre) {
                let s = &mut self.ships[i];
                let over = (b.pos - c).len() - safe;
                if over > 0.0 && s.alive {
                    let rate = zone_rates[((over / zone_width) as usize).min(2)];
                    let lost = rate * dt;
                    let reserve = b.mass - s.params.core_mass;
                    s.zone_burn = rate;
                    s.stats.damage_taken += lost.min(reserve.max(0.0));
                    if lost >= reserve {
                        burned_out.push((i, Cause::Zone));
                        continue;
                    }
                    b.mass -= lost;
                }
            }
            if let Kind::Ship(i) = b.kind {
                let s = &mut self.ships[i];
                if density > 0.0 && s.alive {
                    let rate = abl * density * b.vel.len().powi(3);
                    let lost = rate * dt;
                    let reserve = b.mass - s.params.core_mass;
                    s.ablation = rate;
                    s.stats.damage_taken += lost.min(reserve.max(0.0));
                    if lost >= reserve {
                        burned_out.push((i, Cause::Nebula));
                    } else {
                        b.mass -= lost;
                    }
                }
            }
        }
        for (i, cause) in burned_out {
            // Burned up: route through the normal damage path so it bursts.
            let e = (self.reserve(i) + 1.0) * self.arena.joules_per_kg + self.arena.damage_threshold;
            let dir = self.bodies[i].vel.normalized_or(Vec3::X);
            self.apply_damage(Damage { victim: i, attacker: None, cause, energy: e, dir });
        }
    }

    fn throw_slug(&mut self, i: usize, c: f64, fwd: Vec3) {
        let p = self.ships[i].params;
        let w = self.ang_vel(i);
        let (spos, svel, smass, srad) = {
            let b = &self.bodies[i];
            (b.pos, b.vel, b.mass, b.radius)
        };
        let rs = radius_for(c, self.arena.density);
        let offset = fwd * (srad + rs + 0.3);
        // Spin adds tangential velocity: a spinning ship throws curveballs.
        let rel = fwd * p.throw_speed + w.cross(offset);
        let ship_vel = svel - rel * (c / smass);
        let slug_vel = ship_vel + rel;
        {
            let b = &mut self.bodies[i];
            b.vel = ship_vel;
            b.mass -= c;
        }
        // Angular momentum carried away by the slug about the ship centre.
        self.ships[i].ang_mom -= offset.cross(w.cross(offset) * c);
        let id = self.alloc_id();
        let t = self.t;
        self.bodies.push(Body {
            id,
            kind: Kind::Slug { owner: i },
            pos: spos + offset,
            vel: slug_vel,
            mass: c,
            radius: rs,
            alive: true,
            born: t,
            no_scoop_until: t + 0.3,
        });
        let s = &mut self.ships[i];
        s.throw_cd = p.throw_cooldown;
        s.stats.throws += 1;
        s.stats.mass_thrown += c;
        self.events.push(Event::Throw { ship: i, mass: c, pos: spos + offset });
    }

    fn update_tether(&mut self, i: usize, fwd: Vec3, dt: f64) {
        let p = self.ships[i].params;
        let want = self.ships[i].input.tether;
        self.ships[i].tether_cd -= dt;
        let (spos, svel, srad) = {
            let b = &self.bodies[i];
            (b.pos, b.vel, b.radius)
        };
        match self.ships[i].tether {
            Tether::None => {
                if want && self.ships[i].tether_cd <= 0.0 {
                    self.ships[i].tether = Tether::Flying {
                        pos: spos + fwd * (srad + 0.5),
                        vel: svel + fwd * p.tether_speed,
                    };
                    self.events.push(Event::TetherFire { ship: i });
                }
            }
            Tether::Flying { pos, vel } => {
                if !want {
                    self.ships[i].tether = Tether::None;
                    self.ships[i].tether_cd = p.tether_cooldown * 0.5;
                    return;
                }
                let next = pos + vel * dt;
                // First body the harpoon segment passes through.
                let mut best: Option<(f64, usize)> = None;
                for (j, b) in self.bodies.iter().enumerate() {
                    if j == i || !b.alive {
                        continue;
                    }
                    if let Some(s) = segment_sphere(pos, next, b.pos, b.radius) {
                        if best.map_or(true, |(bs, _)| s < bs) {
                            best = Some((s, j));
                        }
                    }
                }
                if let Some((_, j)) = best {
                    let target = self.bodies[j].id;
                    // The harpoon can strike the far edge of a big rock: rope length is the
                    // true centre distance, so the constraint starts satisfied.
                    let rest = (self.bodies[j].pos - spos).len();
                    self.ships[i].tether = Tether::Attached { target, rest };
                    self.ships[i].stats.tether_attaches += 1;
                    self.events.push(Event::TetherAttach { ship: i, target });
                } else if (next - spos).len() > p.tether_len {
                    self.ships[i].tether = Tether::None;
                    self.ships[i].tether_cd = p.tether_cooldown;
                    self.events.push(Event::TetherMiss { ship: i });
                } else {
                    self.ships[i].tether = Tether::Flying { pos: next, vel };
                }
            }
            Tether::Attached { target, rest } => {
                let j = self.body_index(target);
                if !want || j.is_none() {
                    self.ships[i].tether = Tether::None;
                    self.ships[i].tension = 0.0;
                    self.ships[i].tether_cd = p.tether_cooldown;
                    self.events.push(Event::TetherRelease { ship: i });
                    return;
                }
                let j = j.unwrap();
                let min_len = srad + self.bodies[j].radius + 1.0;
                let mut reel = self.ships[i].input.reel;
                // The winch can't out-pull its motor: under heavy tension it holds.
                if reel > 0.0 && self.ships[i].tension > p.winch_force {
                    reel = 0.0;
                }
                let max_len = p.tether_len + self.bodies[j].radius;
                let rest = (rest - reel * p.reel_speed * dt).clamp(min_len.min(max_len), max_len);
                self.ships[i].tether = Tether::Attached { target, rest };
            }
        }
    }

    /// Rope constraint: inextensible, tension only. Equal and opposite impulses.
    fn solve_tether(&mut self, i: usize, dt: f64) {
        let Tether::Attached { target, rest } = self.ships[i].tether else {
            self.ships[i].tension = 0.0;
            return;
        };
        let Some(j) = self.body_index(target) else { return };
        let (pa, va, ma) = (self.bodies[i].pos, self.bodies[i].vel, self.bodies[i].mass);
        let (pb, vb, mb) = (self.bodies[j].pos, self.bodies[j].vel, self.bodies[j].mass);
        let d = pb - pa;
        let dist = d.len();
        let mut inst = 0.0;
        if dist > rest && dist > 1e-6 {
            let n = d / dist;
            let vrel = (vb - va).dot(n);
            // Positional correction, capped so the solver can never inject real energy.
            let bias = (0.2 * (dist - rest) / dt).min(3.0);
            let lambda = (vrel + bias) / (1.0 / ma + 1.0 / mb);
            if lambda > 0.0 {
                self.bodies[i].vel += n * (lambda / ma);
                self.bodies[j].vel -= n * (lambda / mb);
                inst = lambda / dt;
            }
        }
        let s = &mut self.ships[i];
        s.tension += (inst - s.tension) * (dt / 0.08).min(1.0);
        if s.tension > s.params.tether_break {
            s.tether = Tether::None;
            s.tension = 0.0;
            s.tether_cd = s.params.tether_cooldown;
            s.stats.tether_snaps += 1;
            self.events.push(Event::TetherSnap { ship: i, pos: (pa + pb) * 0.5 });
        }
    }

    fn collide(&mut self, damage: &mut Vec<Damage>) {
        let scoop_speed = self.arena.scoop_speed;
        // Sort-and-sweep broadphase on x. Stable sort keeps this deterministic.
        let mut order: Vec<usize> = (0..self.bodies.len()).filter(|&i| self.bodies[i].alive).collect();
        order.sort_by(|&i, &j| {
            let (bi, bj) = (&self.bodies[i], &self.bodies[j]);
            (bi.pos.x - bi.radius).partial_cmp(&(bj.pos.x - bj.radius)).unwrap_or(std::cmp::Ordering::Equal)
        });
        for oi in 0..order.len() {
            let a = order[oi];
            for &b in &order[oi + 1..] {
                if !self.bodies[a].alive {
                    break;
                }
                if self.bodies[b].pos.x - self.bodies[b].radius > self.bodies[a].pos.x + self.bodies[a].radius {
                    break;
                }
                if !self.bodies[b].alive {
                    continue;
                }
                let d = self.bodies[b].pos - self.bodies[a].pos;
                let rsum = self.bodies[a].radius + self.bodies[b].radius;
                let dist_sq = d.len_sq();
                if dist_sq >= rsum * rsum {
                    continue;
                }
                let dist = dist_sq.sqrt();
                let nrm = if dist > 1e-9 { d / dist } else { Vec3::Y };
                let vrel = self.bodies[b].vel - self.bodies[a].vel;
                let vn = vrel.dot(nrm);
                let (ka, kb) = (self.bodies[a].kind, self.bodies[b].kind);

                if vn < 0.0 {
                    // Scoop: gentle contact between a live ship and loose mass.
                    if let Some((s, o)) = scoop_pair(a, ka, b, kb) {
                        let can = self.ships[s].alive
                            && vrel.len() < scoop_speed
                            && self.t >= self.bodies[o].no_scoop_until
                            && self.bodies[s].mass < self.ships[s].params.max_mass;
                        if can {
                            self.scoop(s, o);
                            continue;
                        }
                    }

                    let e = restitution(ka, kb);
                    let (ma, mb) = (self.bodies[a].mass, self.bodies[b].mass);
                    let mu = ma * mb / (ma + mb);
                    let j = -(1.0 + e) * vn * mu;
                    self.bodies[a].vel -= nrm * (j / ma);
                    self.bodies[b].vel += nrm * (j / mb);
                    let energy = 0.5 * mu * vn * vn * (1.0 - e * e);
                    self.queue_damage(damage, ka, kb, energy, nrm);
                    for (x, k) in [(a, ka), (b, kb)] {
                        if let Kind::Slug { .. } = k {
                            self.bodies[x].kind = Kind::Debris;
                        }
                    }
                }

                // Separate overlap by inverse mass.
                let overlap = rsum - dist;
                let (wa, wb) = (1.0 / self.bodies[a].mass, 1.0 / self.bodies[b].mass);
                let s = overlap / (wa + wb);
                self.bodies[a].pos -= nrm * (s * wa);
                self.bodies[b].pos += nrm * (s * wb);
            }
        }
    }

    fn queue_damage(&self, out: &mut Vec<Damage>, ka: Kind, kb: Kind, energy: f64, nrm: Vec3) {
        // nrm points from a to b.
        match (ka, kb) {
            (Kind::Ship(sa), Kind::Ship(sb)) => {
                out.push(Damage { victim: sa, attacker: Some(sb), cause: Cause::Ram, energy: energy * 0.5, dir: nrm });
                out.push(Damage { victim: sb, attacker: Some(sa), cause: Cause::Ram, energy: energy * 0.5, dir: -nrm });
            }
            (Kind::Ship(s), other) => out.push(self.hit_by(s, other, energy, nrm)),
            (other, Kind::Ship(s)) => out.push(self.hit_by(s, other, energy, -nrm)),
            _ => {}
        }
    }

    fn hit_by(&self, s: usize, other: Kind, energy: f64, dir: Vec3) -> Damage {
        let (cause, attacker) = match other {
            Kind::Slug { owner } => (Cause::Slug, Some(owner)),
            Kind::Asteroid => (Cause::Asteroid, None),
            _ => (Cause::Debris, None),
        };
        Damage { victim: s, attacker, cause, energy, dir }
    }

    fn scoop(&mut self, s: usize, o: usize) {
        let room = self.ships[s].params.max_mass - self.bodies[s].mass;
        let take = self.bodies[o].mass.min(room);
        let (ms, vs) = (self.bodies[s].mass, self.bodies[s].vel);
        let vo = self.bodies[o].vel;
        self.bodies[s].vel = (vs * ms + vo * take) / (ms + take);
        self.bodies[s].mass += take;
        self.bodies[o].mass -= take;
        if self.bodies[o].mass < self.arena.min_chunk {
            self.bodies[o].alive = false;
        }
        self.ships[s].stats.mass_scooped += take;
        let pos = self.bodies[o].pos;
        self.events.push(Event::Scoop { ship: s, mass: take, pos });
    }

    fn boundary(&mut self, damage: &mut Vec<Damage>) {
        let r_arena = self.arena.arena_radius;
        let e = self.arena.wall_restitution;
        for i in 0..self.bodies.len() {
            let b = &mut self.bodies[i];
            if !b.alive {
                continue;
            }
            let dist = b.pos.len();
            if dist + b.radius <= r_arena || dist < 1e-9 {
                continue;
            }
            let n = b.pos / dist;
            let vn = b.vel.dot(n);
            b.pos = n * (r_arena - b.radius);
            if vn <= 0.0 {
                continue;
            }
            b.vel -= n * (vn * (1.0 + e));
            let energy = 0.5 * b.mass * vn * vn * (1.0 - e * e);
            match b.kind {
                Kind::Ship(s) => {
                    self.ships[s].stats.wall_hits += 1;
                    damage.push(Damage { victim: s, attacker: None, cause: Cause::Wall, energy, dir: n });
                }
                Kind::Slug { .. } => b.kind = Kind::Debris,
                _ => {}
            }
        }
    }

    fn well_cores(&mut self, damage: &mut Vec<Damage>) {
        for h in self.hazards.clone() {
            let (pos, core, is_planet) = match h {
                Hazard::Well { pos, core, .. } => (pos, core, false),
                Hazard::Planet { pos, radius, .. } => (pos, radius, true),
                _ => continue,
            };
            for b in self.bodies.iter_mut() {
                if !b.alive || (b.kind == Kind::Asteroid && !is_planet) {
                    continue;
                }
                let d = b.pos - pos;
                let dist = d.len();
                if dist >= core + b.radius || dist < 1e-9 {
                    continue;
                }
                let n = d / dist;
                b.pos = pos + n * (core + b.radius);
                let vn = b.vel.dot(n);
                if vn >= 0.0 {
                    continue;
                }
                let e = 0.3;
                b.vel -= n * (vn * (1.0 + e));
                let energy = 0.5 * b.mass * vn * vn * (1.0 - e * e);
                let cause = if is_planet { Cause::Planet } else { Cause::Well };
                match b.kind {
                    Kind::Ship(s) => damage.push(Damage { victim: s, attacker: None, cause, energy, dir: -n }),
                    // Loose mass that hits the planet is lost to it.
                    Kind::Slug { .. } | Kind::Debris if is_planet => b.alive = false,
                    Kind::Slug { .. } => b.kind = Kind::Debris,
                    _ => {}
                }
            }
        }
    }

    fn apply_damage(&mut self, d: Damage) {
        let s = d.victim;
        if !self.ships[s].alive {
            return;
        }
        let lost = (d.energy - self.arena.damage_threshold) / self.arena.joules_per_kg;
        if lost <= 0.0 {
            return;
        }
        let pos = self.bodies[s].pos;
        let reserve = self.reserve(s);
        if let Some(a) = d.attacker.filter(|&a| a != s) {
            self.ships[a].stats.damage_dealt += lost.min(reserve);
            self.ships[a].stats.hits_landed += 1;
            if d.cause == Cause::Ram {
                self.ships[a].stats.rams += 1;
            }
        }
        self.ships[s].stats.damage_taken += lost.min(reserve);
        let hit_pos = pos + d.dir * self.bodies[s].radius;
        self.events.push(Event::Hit {
            victim: s,
            attacker: d.attacker,
            cause: d.cause,
            lost: lost.min(reserve),
            energy: d.energy,
            pos: hit_pos,
        });

        if lost >= reserve {
            // Destroyed: most of the ship bursts into debris.
            let total = self.bodies[s].mass * 0.7;
            self.ships[s].alive = false;
            self.ships[s].tether = Tether::None;
            self.ships[s].charge = 0.0;
            self.bodies[s].alive = false;
            let n = 8;
            for _ in 0..n {
                let dir = self.rng.unit_vec();
                let speed = self.rng.range(10.0, 40.0);
                self.spawn_chunk(s, total / n as f64, dir, speed);
            }
            let killer = d.attacker.filter(|&a| a != s);
            self.events.push(Event::Kill { victim: s, attacker: killer, pos });
            return;
        }

        self.bodies[s].mass -= lost;
        let k = if lost < 25.0 { 1 } else if lost < 70.0 { 2 } else { 3 };
        for _ in 0..k {
            let dir = (d.dir + self.rng.unit_vec() * 0.7).normalized_or(d.dir);
            let speed = self.rng.range(8.0, 25.0);
            self.spawn_chunk(s, lost / k as f64, dir, speed);
        }
        // Spin kick: hard hits knock you tumbling (less so with arms out).
        let kick_axis = (d.dir.any_perp() + self.rng.unit_vec() * 0.5).normalized_or(Vec3::X);
        self.ships[s].ang_mom += kick_axis * (lost * self.arena.spin_kick);
    }

    fn spawn_chunk(&mut self, s: usize, mass: f64, dir: Vec3, speed: f64) {
        if mass < self.arena.min_chunk {
            return;
        }
        let r = radius_for(mass, self.arena.density);
        let b = &self.bodies[s];
        let pos = b.pos + dir * (b.radius + r + 0.3);
        let vel = b.vel + dir * speed;
        let id = self.alloc_id();
        let t = self.t;
        self.bodies.push(Body {
            id,
            kind: Kind::Debris,
            pos,
            vel,
            mass,
            radius: r,
            alive: true,
            born: t,
            no_scoop_until: t + 0.6,
        });
    }

    fn cleanup(&mut self) {
        let n_ships = self.ships.len();
        // Cap debris by evaporating the oldest.
        let debris: Vec<usize> = (n_ships..self.bodies.len())
            .filter(|&i| self.bodies[i].alive && self.bodies[i].kind == Kind::Debris)
            .collect();
        if debris.len() > self.arena.max_debris {
            let excess = debris.len() - self.arena.max_debris;
            for &i in debris.iter().take(excess) {
                self.bodies[i].alive = false;
            }
        }
        let density = self.arena.density;
        let mut idx = 0;
        self.bodies.retain(|b| {
            let keep = idx < n_ships || b.alive;
            idx += 1;
            keep
        });
        for b in self.bodies.iter_mut() {
            if !matches!(b.kind, Kind::Asteroid) {
                b.radius = radius_for(b.mass, density);
            }
            if let Kind::Ship(s) = b.kind {
                let sp = b.vel.len();
                let st = &mut self.ships[s].stats;
                st.max_speed = st.max_speed.max(sp);
            }
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
            // Decision: highest remaining reserve fraction wins.
            self.finished = true;
            let frac = |i: usize| self.reserve(i) / self.ships[i].params.reserve_capacity();
            let best = alive.iter().copied().max_by(|&a, &b| frac(a).partial_cmp(&frac(b)).unwrap());
            let tie = alive.iter().filter(|&&i| (frac(i) - frac(best.unwrap())).abs() < 1e-9).count() > 1;
            self.winner = if tie { None } else { best };
            self.events.push(Event::MatchEnd { winner: self.winner, decision: true });
        }
    }

    /// Order-independent-enough fingerprint for determinism tests.
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

fn scoop_pair(a: usize, ka: Kind, b: usize, kb: Kind) -> Option<(usize, usize)> {
    let loose = |k: Kind| matches!(k, Kind::Slug { .. } | Kind::Debris);
    match (ka, kb) {
        (Kind::Ship(_), k) if loose(k) => Some((a, b)),
        (k, Kind::Ship(_)) if loose(k) => Some((b, a)),
        _ => None,
    }
}

fn restitution(ka: Kind, kb: Kind) -> f64 {
    use Kind::*;
    match (ka, kb) {
        (Ship(_), Ship(_)) => 0.3,
        (Ship(_), Slug { .. }) | (Slug { .. }, Ship(_)) => 0.2,
        (Ship(_), Asteroid) | (Asteroid, Ship(_)) => 0.4,
        _ => 0.5,
    }
}

/// Fraction along segment p0->p1 where it first enters the sphere, if it does.
fn segment_sphere(p0: Vec3, p1: Vec3, c: Vec3, r: f64) -> Option<f64> {
    let d = p1 - p0;
    let f = p0 - c;
    let a = d.len_sq();
    let cc = f.len_sq() - r * r;
    if cc <= 0.0 {
        return Some(0.0);
    }
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
