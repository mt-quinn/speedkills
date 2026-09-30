//! Ship design parameters and arena constants.
//!
//! Every ship has every verb; a design is just a parameter vector. Archetypes are presets.
//! Units: metres, kilograms, seconds, newtons.

#[derive(Clone, Copy, Debug)]
pub struct ShipParams {
    pub name: &'static str,

    // Mass economy
    /// Mass below which the ship is destroyed. Never burned or thrown.
    pub core_mass: f64,
    pub start_mass: f64,
    /// Scooping stops at this mass.
    pub max_mass: f64,

    // Main engine
    pub max_thrust: f64,
    pub exhaust_vel: f64,

    // Attitude
    pub max_torque: f64,
    /// Mass burned per second at full torque on all three axes.
    pub rcs_cost: f64,
    /// Inertia multiplier added at full arm extension (I = I0 * (1 + arm_gain * arms)).
    pub arm_gain: f64,
    /// Arm extension change per second.
    pub arm_rate: f64,

    // Throw
    pub throw_speed: f64,
    pub throw_min: f64,
    pub throw_max: f64,
    /// kg of charge per second.
    pub charge_rate: f64,
    pub throw_cooldown: f64,

    // Tether
    pub tether_len: f64,
    pub tether_speed: f64,
    pub reel_speed: f64,
    /// Smoothed tension (N) above which the tether snaps.
    pub tether_break: f64,
    pub tether_cooldown: f64,

    // Field
    pub field_range: f64,
    /// Relative acceleration (m/s^2) the field imposes between ship and target at point blank.
    pub field_accel: f64,
    /// Half-angle of the field cone, degrees.
    pub field_cone_deg: f64,
    /// Maximum total force the field can exert (N). Caps the "pull yourself to a rock" drive.
    pub field_max_force: f64,
    /// Effective exhaust velocity of the field: mass burned = impulse delivered / field_ve.
    pub field_ve: f64,
    /// Winch can only reel in while tension is below this (N). Caps swing spin-up.
    pub winch_force: f64,
}

impl ShipParams {
    pub fn reserve_capacity(&self) -> f64 {
        self.start_mass - self.core_mass
    }
}

pub const SLINGER: ShipParams = ShipParams {
    name: "Slinger",
    core_mass: 300.0,
    start_mass: 1000.0,
    max_mass: 1200.0,
    max_thrust: 20_000.0,
    exhaust_vel: 1200.0,
    max_torque: 30_000.0,
    rcs_cost: 1.5,
    arm_gain: 2.0,
    arm_rate: 1.5,
    throw_speed: 150.0,
    throw_min: 20.0,
    throw_max: 50.0,
    charge_rate: 60.0,
    throw_cooldown: 0.4,
    tether_len: 320.0,
    tether_speed: 260.0,
    reel_speed: 40.0,
    tether_break: 90_000.0,
    tether_cooldown: 1.5,
    field_range: 80.0,
    field_accel: 4.0,
    field_cone_deg: 25.0,
    field_max_force: 6_000.0,
    field_ve: 500.0,
    winch_force: 40_000.0,
};

pub const ANCHOR: ShipParams = ShipParams {
    name: "Anchor",
    core_mass: 500.0,
    start_mass: 1600.0,
    max_mass: 1900.0,
    max_thrust: 26_000.0,
    exhaust_vel: 1300.0,
    max_torque: 32_000.0,
    rcs_cost: 2.0,
    arm_gain: 1.5,
    arm_rate: 1.0,
    throw_speed: 140.0,
    throw_min: 30.0,
    throw_max: 80.0,
    charge_rate: 50.0,
    throw_cooldown: 0.6,
    tether_len: 160.0,
    tether_speed: 220.0,
    reel_speed: 30.0,
    tether_break: 120_000.0,
    tether_cooldown: 2.0,
    field_range: 220.0,
    field_accel: 22.0,
    field_cone_deg: 30.0,
    field_max_force: 30_000.0,
    field_ve: 600.0,
    winch_force: 50_000.0,
};

pub const SKATER: ShipParams = ShipParams {
    name: "Skater",
    core_mass: 220.0,
    start_mass: 700.0,
    max_mass: 850.0,
    max_thrust: 17_000.0,
    exhaust_vel: 1100.0,
    max_torque: 35_000.0,
    rcs_cost: 1.2,
    arm_gain: 6.0,
    arm_rate: 3.0,
    throw_speed: 190.0,
    throw_min: 15.0,
    throw_max: 35.0,
    charge_rate: 80.0,
    throw_cooldown: 0.25,
    tether_len: 200.0,
    tether_speed: 280.0,
    reel_speed: 50.0,
    tether_break: 60_000.0,
    tether_cooldown: 1.0,
    field_range: 60.0,
    field_accel: 5.0,
    field_cone_deg: 25.0,
    field_max_force: 5_000.0,
    field_ve: 500.0,
    winch_force: 25_000.0,
};

pub const PRESETS: [ShipParams; 3] = [SLINGER, ANCHOR, SKATER];

pub fn preset(name: &str) -> Option<ShipParams> {
    PRESETS.iter().copied().find(|p| p.name.eq_ignore_ascii_case(name))
}

/// World-level constants.
#[derive(Clone, Copy, Debug)]
pub struct ArenaParams {
    pub dt: f64,
    pub arena_radius: f64,
    /// Density used to derive radius from mass for ships, slugs and debris (kg/m^3).
    pub density: f64,
    pub asteroid_density: f64,
    /// Below this relative speed, a ship absorbs debris/slugs it touches.
    pub scoop_speed: f64,
    /// Collision energy (J) absorbed without damage.
    pub damage_threshold: f64,
    /// Joules of dissipated energy per kg of mass knocked off.
    pub joules_per_kg: f64,
    /// Angular impulse per kg lost (spin kick from hits).
    pub spin_kick: f64,
    pub wall_restitution: f64,
    pub time_limit: f64,
    pub max_debris: usize,
    /// Debris chunks lighter than this evaporate instead of spawning.
    pub min_chunk: f64,
    /// When the arena wall starts closing in (sudden death).
    pub sudden_death_at: f64,
    /// Arena radius at the time limit.
    pub final_radius: f64,
    /// Planet layout: radius of the safe zone around the planet.
    pub safe_radius: f64,
    /// Width of each burn zone beyond the safe zone.
    pub zone_width: f64,
    /// Mass burned per second in each zone beyond the safe radius (last applies outward).
    pub zone_rates: [f64; 3],
    /// Nebula ablation: kg/s lost per (m/s)^3 of speed at the cloud's centre.
    pub ablation: f64,
}

pub const ARENA: ArenaParams = ArenaParams {
    dt: 1.0 / 120.0,
    arena_radius: 1000.0,
    density: 1.91,
    asteroid_density: 60.0,
    scoop_speed: 14.0,
    damage_threshold: 15_000.0,
    joules_per_kg: 4_000.0,
    spin_kick: 150.0,
    wall_restitution: 0.5,
    time_limit: 240.0,
    max_debris: 300,
    min_chunk: 4.0,
    ablation: 1.4e-5,
    sudden_death_at: 150.0,
    final_radius: 320.0,
    safe_radius: 800.0,
    zone_width: 200.0,
    zone_rates: [4.0, 15.0, 60.0],
};
