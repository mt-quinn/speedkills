//! A ship: components and crew laid out inside the hull, so where it's hit decides what breaks
//! and who dies.
use crate::params::*;
use sk_sim::math::{Quat, Rng, Vec3};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Part {
    Drive,
    RcsBowPort,
    RcsBowStbd,
    RcsSternPort,
    RcsSternStbd,
    Reactor,
    Sensors,
    Pdc0,
    Pdc1,
    Pdc2,
    Launcher,
    Railgun,
}

pub const PARTS: [Part; 12] = [
    Part::Drive,
    Part::RcsBowPort,
    Part::RcsBowStbd,
    Part::RcsSternPort,
    Part::RcsSternStbd,
    Part::Reactor,
    Part::Sensors,
    Part::Pdc0,
    Part::Pdc1,
    Part::Pdc2,
    Part::Launcher,
    Part::Railgun,
];

impl Part {
    pub fn name(self) -> &'static str {
        match self {
            Part::Drive => "drive",
            Part::RcsBowPort => "rcs_bow_port",
            Part::RcsBowStbd => "rcs_bow_stbd",
            Part::RcsSternPort => "rcs_stern_port",
            Part::RcsSternStbd => "rcs_stern_stbd",
            Part::Reactor => "reactor",
            Part::Sensors => "sensors",
            Part::Pdc0 => "pdc_dorsal",
            Part::Pdc1 => "pdc_port",
            Part::Pdc2 => "pdc_stbd",
            Part::Launcher => "launcher",
            Part::Railgun => "railgun",
        }
    }
    /// Where it sits, ship frame (m). The vitals sit off the centreline, so a shot straight down
    /// the axis (the usual nose-on shot) holes the ship without gutting it; the railgun runs
    /// along the keel; only the drive has to sit on the thrust axis.
    pub fn pos(self) -> Vec3 {
        match self {
            Part::Drive => Vec3::new(0.0, 0.0, -10.0),
            Part::RcsBowPort => Vec3::new(-4.5, 0.0, 7.0),
            Part::RcsBowStbd => Vec3::new(4.5, 0.0, 7.0),
            Part::RcsSternPort => Vec3::new(-4.5, 0.0, -7.0),
            Part::RcsSternStbd => Vec3::new(4.5, 0.0, -7.0),
            Part::Reactor => Vec3::new(0.0, 3.0, -4.0),
            Part::Sensors => Vec3::new(0.0, 4.0, 9.0),
            Part::Pdc0 => Vec3::new(0.0, 5.5, 1.0),
            Part::Pdc1 => Vec3::new(-4.8, -2.8, 1.0),
            Part::Pdc2 => Vec3::new(4.8, -2.8, 1.0),
            Part::Launcher => Vec3::new(0.0, -4.0, -1.0),
            Part::Railgun => Vec3::new(0.0, -4.0, 3.0),
        }
    }
    pub fn pdc(k: usize) -> Part {
        [Part::Pdc0, Part::Pdc1, Part::Pdc2][k]
    }
}

/// Each PDC mount's outward normal (ship frame): dorsal, port-ventral, starboard-ventral.
pub fn pdc_normal(k: usize) -> Vec3 {
    match k {
        0 => Vec3::new(0.0, 1.0, 0.0),
        1 => Vec3::new(-0.866, -0.5, 0.0),
        _ => Vec3::new(0.866, -0.5, 0.0),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Station {
    Pilot,
    Gunner,
    Engineer,
    Ops,
}

pub const STATIONS: [Station; 4] = [Station::Pilot, Station::Gunner, Station::Engineer, Station::Ops];

impl Station {
    pub fn name(self) -> &'static str {
        match self {
            Station::Pilot => "pilot",
            Station::Gunner => "gunner",
            Station::Engineer => "engineer",
            Station::Ops => "ops",
        }
    }
    /// The compartment it sits in (ship frame): a ring round the spine, so one round rarely
    /// passes through two of them.
    pub fn pos(self) -> Vec3 {
        match self {
            Station::Pilot => Vec3::new(2.5, 1.5, 6.0),
            Station::Gunner => Vec3::new(-2.5, -1.5, 5.0),
            Station::Engineer => Vec3::new(2.5, -2.0, -6.0),
            Station::Ops => Vec3::new(-2.5, 2.0, 4.0),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum CrewState {
    Fit,
    BlackedOut,
    Dead,
}

#[derive(Clone, Debug)]
pub struct Crew {
    pub station: Station,
    pub name: &'static str,
    /// 0..100; dead at 0.
    pub health: f64,
    /// Seconds remaining until a blacked-out crew member recovers.
    pub blackout_remaining: f64,
    /// Personal resistance: thresholds are multiplied by it.
    pub resistance: f64,
    /// Skill at their station (1 = league average): pilot — handling (rotation authority and
    /// thruster jinks); gunner — railgun scatter and charge speed; engineer — repair speed;
    /// ops — point-defence fire control.
    pub skill: f64,
    pub state: CrewState,
    /// Died of g (rather than a hit).
    pub g_death: bool,
}

impl Crew {
    pub fn alive(&self) -> bool {
        self.state != CrewState::Dead
    }
    /// Awake and alive: able to do their job.
    pub fn working(&self) -> bool {
        self.state == CrewState::Fit
    }
    /// Injured crew work slower (1 = unhurt).
    pub fn efficiency(&self) -> f64 {
        if !self.working() {
            0.0
        } else {
            0.4 + 0.6 * (self.health / 100.0)
        }
    }
}

#[derive(Clone, Debug)]
pub struct Pdc {
    /// Seconds of fire left.
    pub ammo: f64,
    /// 0..1; at 1 the mount stops until it cools to 0.5.
    pub heat: f64,
    pub overheated: bool,
    /// What it's shooting at this step (a torpedo id, or the enemy ship), for the broadcast.
    pub target: Option<u32>,
    pub at_ship: bool,
}

#[derive(Clone, Debug)]
pub struct Ship {
    pub class: ShipClass,
    pub pos: Vec3,
    pub vel: Vec3,
    pub orient: Quat,
    /// Angular velocity, body frame (rad/s).
    pub rate: Vec3,
    pub hull: f64,
    /// Component health 0..1, indexed like PARTS.
    pub parts: [f64; 12],
    pub crew: Vec<Crew>,
    pub pdcs: Vec<Pdc>,
    pub torpedoes: u32,
    /// Time until the next tube is loaded (for the trace); each tube's own reload is in `tubes`.
    pub torp_reload: f64,
    pub tubes: Vec<f64>,
    /// Launches of a rippled salvo still to go: (when, index in salvo, salvo size, ring turn).
    pub launch_queue: Vec<(f64, u32, u32, f64)>,
    pub rail_ammo: u32,
    /// 0..1 while charging (1 = ready); cooldown after a shot.
    pub rail_charge: f64,
    pub rail_cooldown: f64,
    /// This charge was built with the safeties off.
    pub rail_overcharged: bool,
    /// Seconds the full charge has been held (vents at RAIL_HOLD).
    pub rail_held: f64,
    /// Acceleration felt last step (m/s², excluding nothing: there's no gravity here).
    pub accel: Vec3,
    /// The same, averaged over about a second: what an observer can predict from (a jink that
    /// flips every half second averages out; a steady burn doesn't).
    pub accel_avg: Vec3,
    pub g: f64,
    pub alive: bool,
    /// The engineer's current repair: which part, and progress (s).
    pub repair: Option<(usize, f64)>,
}

const NAMES: [[&str; 4]; 2] = [["Vasquez", "Okoye", "Brandt", "Liang"], ["Moreau", "Tanaka", "Reyes", "Sørensen"]];

/// A crew member as the league knows them: name, skill at their station, and 1–10 gee resistance.
#[derive(Clone, Copy, Debug)]
pub struct CrewSpec {
    pub name: &'static str,
    pub skill: f64,
    pub resistance: f64,
}

impl Ship {
    /// Put a named crew aboard (station order: pilot, gunner, engineer, ops).
    pub fn apply_crew(&mut self, spec: &[CrewSpec; 4]) {
        for (c, sp) in self.crew.iter_mut().zip(spec.iter()) {
            c.name = sp.name;
            c.skill = sp.skill;
            c.resistance = sp.resistance.round().clamp(1.0, 10.0);
        }
    }

    pub fn new(side: usize, class: ShipClass, pos: Vec3, vel: Vec3, orient: Quat, rng: &mut Rng) -> Ship {
        let crew = STATIONS
            .iter()
            .enumerate()
            .map(|(k, &st)| Crew {
                station: st,
                name: NAMES[side % 2][k],
                health: 100.0,
                blackout_remaining: 0.0,
                resistance: rng.range(3.0, 8.0).round(),
                skill: 1.0,
                state: CrewState::Fit,
                g_death: false,
            })
            .collect();
        Ship {
            class,
            pos,
            vel,
            orient,
            rate: Vec3::ZERO,
            hull: class.hull,
            parts: [1.0; 12],
            crew,
            pdcs: (0..PDC_MOUNTS).map(|_| Pdc { ammo: class.pdc_ammo, heat: 0.0, overheated: false, target: None, at_ship: false }).collect(),
            torpedoes: class.torpedoes,
            torp_reload: 0.0,
            tubes: vec![0.0; class.tubes as usize],
            launch_queue: Vec::new(),
            rail_ammo: class.rail_ammo,
            rail_charge: 0.0,
            rail_cooldown: 0.0,
            rail_held: 0.0,
            rail_overcharged: false,
            accel: Vec3::ZERO,
            accel_avg: Vec3::ZERO,
            g: 0.0,
            alive: true,
            repair: None,
        }
    }

    pub fn part(&self, p: Part) -> f64 {
        self.parts[PARTS.iter().position(|&x| x == p).unwrap()]
    }
    pub fn crew_at(&self, st: Station) -> &Crew {
        self.crew.iter().find(|c| c.station == st).unwrap()
    }
    pub fn forward(&self) -> Vec3 {
        self.orient.rotate(Vec3::Z)
    }
    pub fn to_world(&self, local: Vec3) -> Vec3 {
        self.pos + self.orient.rotate(local)
    }
    /// One number for how intact the ship is (0..1): hull, components and crew. The scoreboard
    /// the broadcast shows, and what a pilot judges "ahead" or "behind" by.
    pub fn health_index(&self) -> f64 {
        let crew = self.crew.iter().filter(|c| c.alive()).count() as f64 / 4.0;
        0.4 * (self.hull.max(0.0) / self.class.hull) + 0.4 * (self.parts.iter().sum::<f64>() / 12.0) + 0.2 * crew
    }
    /// The internal layout scales with the hull's size.
    pub fn scale(&self) -> f64 {
        self.class.radius / SHIP_RADIUS
    }
    /// Handling, from the pilot's skill (the flight computer flies at league average when the
    /// pilot is out: blackouts and deaths have their own limits in the world step).
    pub fn handling(&self) -> f64 {
        let p = self.crew_at(Station::Pilot);
        if p.working() { p.skill.powf(1.5) } else { 1.0 }
    }
    /// How fast the pilot reacts to the enemy's muzzle flash (s).
    pub fn flash_reaction(&self) -> f64 { FLASH_REACTION / self.handling() }
    /// The weakest conscious crew member's g-resistance: how hard the whole crew can be pushed.
    pub fn crew_tolerance(&self) -> f64 {
        self.crew.iter().filter(|c| c.working()).map(|c| 0.88 + (c.resistance - 1.0) * 0.27 / 9.0).fold(1.15, f64::min)
    }
    /// Power management, from the engineer (league average without a working one).
    pub fn power(&self) -> f64 {
        let e = self.crew_at(Station::Engineer);
        if e.working() { e.skill } else { 1.0 }
    }
    pub fn rcs_accel(&self) -> f64 { self.class.rcs_accel * self.handling() }
    pub fn rot_accel(&self) -> f64 { self.class.rot_accel * self.handling() }
    /// Point-defence fire control, from ops (without a working ops officer the mounts run on
    /// their own, at 0.7).
    pub fn pdc_control(&self) -> f64 {
        let o = self.crew_at(Station::Ops);
        if o.working() { o.skill.sqrt() } else { 0.7 }
    }
    /// A broken part can come back while there's a live engineer (repairs run at any g).
    pub fn fixable(&self, p: Part) -> bool {
        self.part(p) > 0.0 || self.crew_at(Station::Engineer).alive()
    }
    /// Has a ranged weapon it can still use: railgun rounds, or torpedoes (with a launcher).
    pub fn has_ranged(&self) -> bool {
        (self.rail_ammo > 0 && self.fixable(Part::Railgun)) || ((self.torpedoes > 0 || !self.launch_queue.is_empty()) && self.fixable(Part::Launcher))
    }
    /// Can still hurt the enemy at all: a ranged weapon, PDC ammunition on a mount, or a ship
    /// that can still steer itself into them.
    pub fn can_hurt(&self) -> bool {
        if !self.alive { return false; }
        let pdc = (0..PDC_MOUNTS).any(|m| self.pdcs[m].ammo > 0.0 && self.fixable(Part::pdc(m)));
        let ram = self.fixable(Part::Drive) && self.fixable(Part::Reactor) && self.crew_at(Station::Pilot).alive();
        self.has_ranged() || pdc || ram
    }
    /// The railgun's aim scatter right now (rad, per axis): see `rail_disp_*`.
    pub fn rail_sigma(&self) -> f64 {
        let f = self.forward();
        let lat = (self.accel - f * self.accel.dot(f)).len() / G;
        let sensors = if self.part(Part::Sensors) <= 0.0 { 2.0 } else { 1.0 };
        let gc = self.crew_at(Station::Gunner);
        let gunner = if gc.working() { 1.0 / gc.skill } else { 1.5 };
        // (The pilot holds the gun platform steady — rotation and g scatter over their handling —
        // and a crew that takes g well aims better under it.)
        let steady = self.handling();
        let tol = self.crew_tolerance().min(1.5);
        (rail_disp_base() + (rail_disp_rate() * self.rate.len() + rail_disp_lat() * lat / tol) / steady) * sensors * gunner
    }
    pub fn powered(&self) -> bool {
        self.part(Part::Reactor) > 0.0
    }

    /// Damage everything near a point inside or on the hull (world frame): `dmg` at the point,
    /// falling off linearly to nothing at `reach`. Components lose health (1.0 = destroyed), crew
    /// lose health points. Returns the crew members killed.
    pub fn blast(&mut self, at: Vec3, dmg: f64, reach: f64) -> Vec<usize> {
        let local = self.orient.inv_rotate(at - self.pos);
        let sc = self.scale();
        for (k, p) in PARTS.iter().enumerate() {
            let f = (1.0 - (p.pos() * sc - local).len() / reach).max(0.0);
            self.parts[k] = (self.parts[k] - dmg * f / part_armor()).max(0.0);
        }
        self.hurt_crew(|pos| (1.0 - (pos - local).len() / reach).max(0.0) * dmg)
    }

    /// A round through the ship along a line (world frame): everything within `radius` of it.
    /// `spall` widens the radius with distance travelled from `a` (m per m).
    pub fn penetrate(&mut self, a: Vec3, b: Vec3, dmg: f64, radius: f64, spall: f64) -> Vec<usize> {
        let (la, lb) = (self.orient.inv_rotate(a - self.pos), self.orient.inv_rotate(b - self.pos));
        let sc = self.scale();
        // Distance from the path, less the spall widening at that depth.
        let near = |p: Vec3| {
            let d = lb - la;
            let s = ((p - la).dot(d) / d.len_sq().max(1e-9)).clamp(0.0, 1.0);
            (p - (la + d * s)).len() - spall * s * d.len()
        };
        for (k, p) in PARTS.iter().enumerate() {
            if near(p.pos() * sc) < radius {
                self.parts[k] = (self.parts[k] - dmg / part_armor()).max(0.0);
            }
        }
        self.hurt_crew(|pos| if near(pos) < radius { dmg } else { 0.0 })
    }

    fn hurt_crew(&mut self, dmg_at: impl Fn(Vec3) -> f64) -> Vec<usize> {
        let sc = self.scale();
        let mut killed = Vec::new();
        for (k, c) in self.crew.iter_mut().enumerate() {
            if !c.alive() {
                continue;
            }
            let d = dmg_at(c.station.pos() * sc);
            if d <= 0.0 {
                continue;
            }
            c.health -= d * crew_harm();
            if c.health <= 0.0 {
                c.health = 0.0;
                c.state = CrewState::Dead;
                killed.push(k);
            }
        }
        killed
    }

    /// A seeded gee incident is 98% temporary blackout, 2% death. Unconscious
    /// crew can still suffer a fatal incident, but do not restart their recovery timer.
    pub fn endure_g(&mut self, dt: f64, rng: &mut Rng) -> (Vec<usize>, Vec<usize>) {
        let (mut killed, mut out) = (Vec::new(), Vec::new());
        for (k, c) in self.crew.iter_mut().enumerate() {
            if !c.alive() { continue; }
            if c.state == CrewState::BlackedOut {
                c.blackout_remaining = (c.blackout_remaining - dt).max(0.0);
                if c.blackout_remaining <= 0.0 { c.state = CrewState::Fit; }
            }
            let chance = crate::gee::step_probability(self.g, c.resistance, dt);
            if chance <= 0.0 || rng.f64() >= chance { continue; }
            if rng.f64() < 0.02 {
                c.state = CrewState::Dead;
                c.health = 0.0;
                c.blackout_remaining = 0.0;
                c.g_death = true;
                killed.push(k);
            } else if c.working() {
                c.state = CrewState::BlackedOut;
                c.blackout_remaining = rng.range(4.0, 8.0);
                out.push(k);
            }
        }
        (killed, out)
    }
}
