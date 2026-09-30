//! Ship designs and arena constants. Units: metres, kilograms, seconds, newtons.
//!
//! A design is a parameter vector; archetypes are presets. Every ship has the same verbs:
//! main engine, strafing thrusters, attitude control, and a mass driver.
//!
//! The ships are uncrewed robots, so accelerations are violent (5–8 g) — but propellant is
//! scarce (~350 m/s of delta-v, a few seconds of full burn per match). Fights are coasting
//! orbits punctuated by short, decisive burns; gravity still governs the arena.

/// The mass driver: slow, heavy slugs that become orbital bodies of their own. Muzzle speeds
/// are comparable to orbital speed, so every shot curves around the planet; rounds live long
/// enough to come all the way round (onto their owner, too).
#[derive(Clone, Copy, Debug)]
pub struct Driver {
    /// Muzzle speed relative to the ship (m/s).
    pub speed: f64,
    pub slug_mass: f64,
    pub ammo: u32,
    /// Seconds between shots.
    pub reload: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct ShipParams {
    pub name: &'static str,
    pub radius: f64,
    pub dry_mass: f64,
    pub propellant: f64,
    pub hull: f64,
    /// Hit points subtracted from every hit (glancing blows do little to heavy armour).
    pub armor: f64,
    pub max_thrust: f64,
    /// Strafing thrust on each body axis (N).
    pub rcs_thrust: f64,
    pub exhaust_vel: f64,
    pub max_torque: f64,
    /// Flight-computer limit on commanded rotation rate (rad/s).
    pub max_rate: f64,
    pub driver: Driver,
}

impl ShipParams {
    pub fn start_mass(&self) -> f64 {
        self.dry_mass + self.propellant
    }
}

pub const LANCER: ShipParams = ShipParams {
    name: "Lancer",
    radius: 6.0,
    dry_mass: 640.0, // + 600 kg of rounds
    propellant: 400.0,
    hull: 1000.0,
    armor: 40.0,
    max_thrust: 70_000.0,
    rcs_thrust: 12_000.0,
    exhaust_vel: 1_000.0,
    max_torque: 60_000.0,
    max_rate: 2.5,
    driver: Driver { speed: 60.0, slug_mass: 25.0, ammo: 5, reload: 7.0 },
};

pub const HORNET: ShipParams = ShipParams {
    name: "Hornet",
    radius: 4.0,
    dry_mass: 212.0, // + 480 kg of rounds
    propellant: 250.0,
    hull: 600.0,
    armor: 0.0,
    max_thrust: 60_000.0,
    rcs_thrust: 8_000.0,
    exhaust_vel: 900.0,
    max_torque: 60_000.0,
    max_rate: 6.0,
    driver: Driver { speed: 60.0, slug_mass: 25.0, ammo: 8, reload: 5.0 },
};

pub const WARDEN: ShipParams = ShipParams {
    name: "Warden",
    radius: 5.0,
    dry_mass: 400.0, // + 420 kg of rounds
    propellant: 700.0,
    hull: 850.0,
    armor: 15.0,
    max_thrust: 70_000.0,
    rcs_thrust: 10_000.0,
    exhaust_vel: 1_000.0,
    max_torque: 50_000.0,
    max_rate: 4.0,
    // The launcher: missiles kicked out at 60 m/s, 25 kg each, 6 aboard, one every 6 s.
    driver: Driver { speed: 60.0, slug_mass: 25.0, ammo: 6, reload: 6.0 },
};

pub const PRESETS: [ShipParams; 3] = [LANCER, HORNET, WARDEN];

pub fn preset(name: &str) -> Option<ShipParams> {
    PRESETS.iter().copied().find(|p| p.name.eq_ignore_ascii_case(name))
}

/// World-level constants.
#[derive(Clone, Copy, Debug)]
pub struct ArenaParams {
    pub dt: f64,
    /// Hard backstop radius (the burn zones do the real work).
    pub arena_radius: f64,
    /// Joules of relative kinetic energy per hit point, for collisions (rams, rocks).
    pub joules_per_hp: f64,
    /// Joules per hit point for driver slugs: dense penetrators, far more lethal per joule.
    pub slug_joules_per_hp: f64,
    /// Collision energy absorbed without damage (bumps).
    pub collision_threshold: f64,
    /// Angular impulse per hit point (hard hits knock you tumbling).
    pub spin_kick: f64,
    /// Slugs expire after this long (long enough to come round the planet).
    pub slug_life: f64,
    pub time_limit: f64,
    /// Safe zone radius around the planet.
    pub safe_radius: f64,
    pub zone_width: f64,
    /// Hull damage per second in each band beyond the safe radius.
    pub zone_rates: [f64; 3],
    /// Sudden death: the safe zone starts contracting here...
    pub sudden_death_at: f64,
    /// ...down to this radius at the time limit.
    pub final_radius: f64,
    pub asteroid_density: f64,
    /// Atmosphere: thickness above the surface, and density e-folding height.
    pub atmo_height: f64,
    pub atmo_scale: f64,
    /// Drag: deceleration = drag * density * v^2 (density 1 at the surface).
    pub atmo_drag: f64,
    /// Heating: hull lost per second = heat * density * v^3.
    pub atmo_heat: f64,
    /// Scooping: propellant gained per second = scoop * density * v * intake, where intake
    /// is 1 nose-first into the airflow and SCOOP_SIDEWAYS broadside or tail-first.
    pub atmo_scoop: f64,
    /// Lift: acceleration = lift * density * v^2 * facing^2, across the airflow along the
    /// ship's up axis (facing = nose alignment with the airflow). Lift / drag is the skip.
    pub atmo_lift: f64,
    /// Extra drag broadside: drag * (1 + broadside * (1 - facing)).
    pub atmo_broadside_drag: f64,
    /// Proximity fuze: a round that passes within this of a ship's hull bursts at its closest
    /// point, for burst_max * (1 - gap / fuze_radius)^2 of a direct hit's energy.
    pub fuze_radius: f64,
    pub burst_max: f64,
    /// Missiles (the only weapon): acceleration, delta-v budget, steering lag range (random and
    /// hidden per missile), proportional-navigation gain, cruise closing speed, seeker range and
    /// cone (cosine), warhead damage at contact, life.
    pub missile_accel: f64,
    pub missile_dv: f64,
    pub missile_lag: (f64, f64),
    pub pn_gain: f64,
    pub missile_cruise: f64,
    pub seeker_range: f64,
    pub seeker_cos: f64,
    pub warhead: f64,
    pub missile_life: f64,
}

/// Intake efficiency when not pointed into the airflow (scales up to 1 nose-first).
pub const SCOOP_SIDEWAYS: f64 = 0.25;

pub const ARENA: ArenaParams = ArenaParams {
    dt: 1.0 / 120.0,
    arena_radius: 2000.0,
    joules_per_hp: 4_000.0,
    slug_joules_per_hp: 400.0,
    collision_threshold: 15_000.0,
    spin_kick: 25.0,
    slug_life: 90.0,
    time_limit: 240.0,
    safe_radius: 800.0,
    zone_width: 200.0,
    zone_rates: [8.0, 30.0, 120.0],
    sudden_death_at: 150.0,
    final_radius: 320.0,
    asteroid_density: 60.0,
    atmo_height: 45.0,
    atmo_scale: 12.0,
    atmo_drag: 0.002,
    atmo_heat: 1.5e-4,
    atmo_scoop: 5.0,
    atmo_lift: 0.008,
    atmo_broadside_drag: 1.5,
    fuze_radius: 8.0,
    burst_max: 1.0,
    missile_accel: 200.0,
    missile_dv: 400.0,
    missile_lag: (0.4, 1.0),
    pn_gain: 3.0,
    missile_cruise: 150.0,
    seeker_range: 300.0,
    seeker_cos: 0.7071,
    warhead: 450.0,
    missile_life: 40.0,
};
