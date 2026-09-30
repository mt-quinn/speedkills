//! The numbers that define the duel. Units: metres, seconds, m/s, m/s².

pub const DT: f64 = 1.0 / 120.0;
pub const G: f64 = 9.81;

/// Arena: ships start this far apart; leaving the engagement sphere forfeits.
pub const START_SEPARATION: (f64, f64) = (8000.0, 10000.0);
/// No walls: space is open. A fight is broken off when the ships stay more than this far apart
/// for DISENGAGE_TIME; the side that was burning away from the other forfeits.
pub const DISENGAGE_RANGE: f64 = 15000.0;
pub const DISENGAGE_TIME: f64 = 10.0;
/// Memory (s) of who has been burning away from whom, for deciding who broke it off.
pub const DISENGAGE_MEMORY: f64 = 30.0;
pub const TIME_LIMIT: f64 = 180.0;

// ---- the ship (one design, one loadout) ----
/// Drawn and collided as a sphere of this radius; components sit inside it (ship frame:
/// +Z nose, +Y dorsal, +X starboard).
pub const SHIP_RADIUS: f64 = 12.0;
/// Weapon roles, by share of all damage: railgun the haymaker (~40%), PDC streams the grinder
/// (~30%), torpedoes the opener and the closer (~25%).
/// Damage economy: a healthy ship takes ~10–12 meaningful hits of similar size to kill (so a
/// fight is a back-and-forth of many exchanges, and one early hit is not a decisive lead), and a
/// full magazine carries ~1.2× what a kill needs (~720 hull by railgun, ~250 each by torpedo
/// and PDC): fights end in kills, but late, with ammunition running short. A railgun round holes it
/// (RAIL_HULL) and wrecks what's on its line; a torpedo blasts the side it hits; PDC streams at
/// close range grind (many small hits). No single hit is fatal except a lucky one.
pub const HULL: f64 = 1250.0;
/// Hull lost per PDC round that finds the ship.
pub const PDC_SHIP_HULL: f64 = 5.0;
/// The drive can overburn far past what the crew survives.
pub const DRIVE_MAX_G: f64 = 25.0;
/// Strafe (RCS translation) per body axis, m/s².
/// Maneuvering thrusters strong enough (2 g) that a ship holding its aim can still jink:
/// aimed ships are hard to hit beyond ~5 km and exposed inside ~3 km.
pub const RCS_ACCEL: f64 = 2.0 * G;
/// Rotation: fastest turn rate (rad/s) and angular acceleration (rad/s²) with all RCS working.
pub const MAX_RATE: f64 = 0.9;
pub const ROT_ACCEL: f64 = 1.5;

// ---- torpedoes ----
pub const TORPEDOES: u32 = 12;
/// Three tubes fire together as a salvo; the tubes reload together.
pub const TORP_TUBES: u32 = 3;
pub const TORP_RELOAD: f64 = 12.0;
/// A salvo flies spread apart (m off the line of sight, so one burst's shrapnel can't take two)
/// and closes up before entering PDC range, so all of it arrives together, at full speed.
pub const TORP_SPREAD: f64 = 350.0;
pub const TORP_CONVERGE: (f64, f64) = (2300.0, 4500.0);
pub const TORP_EJECT: f64 = 40.0;
pub const TORP_ACCEL: f64 = 100.0;
pub const TORP_DV: f64 = 2200.0;
pub const TORP_LAG: f64 = 0.35;
pub const TORP_PN: f64 = 4.0;
pub const TORP_FUZE: f64 = 15.0;
pub const TORP_ARM: f64 = 1.0;
pub const TORP_LIFE: f64 = 45.0;
/// Warhead: hull damage at the surface, and the blast's reach through the ship (m).
pub const TORP_HULL: f64 = 200.0;
pub const TORP_BLAST: (f64, f64) = (80.0, 8.0);

// ---- point defence ----
pub const PDC_MOUNTS: usize = 3;
pub const PDC_RANGE: f64 = 2000.0;
/// Kill hazard against a torpedo (per second) at zero range; falls off as 1/(1+(r/PDC_FALLOFF)²).
pub const PDC_KILL_RATE: f64 = 1.6;
pub const PDC_FALLOFF: f64 = 700.0;
/// Each mount covers a cone of this half-angle (cosine) around its outward normal.
pub const PDC_ARC_COS: f64 = -0.17;
/// Seconds of fire in each mount's magazine; heat per second of fire, cooling per second idle.
/// Seconds of fire per mount. Scarce on purpose: every second spent grinding the enemy's hull
/// at close range is a second not there for the next salvo.
pub const PDC_AMMO: f64 = 22.0;
pub const PDC_HEAT: f64 = 1.0 / 7.0;
pub const PDC_COOL: f64 = 1.0 / 10.0;
/// A torpedo shot down isn't deleted: it breaks up and the debris carries on along its path,
/// spreading in a cone (DEBRIS_SPREAD rad). The ship takes the share of the cloud its cross-
/// section intercepts, times DEBRIS_WEIGHT of a full hit (mass, no warhead). Killed far out, the
/// cloud has spread thin; killed close, most of it still arrives. How well the PDCs did is how far
/// out they got it.
/// (Fragments separate sideways at ~50 m/s from a torpedo doing ~1.5 km/s: ~0.03 rad.)
pub const DEBRIS_SPREAD: f64 = 0.03;
pub const DEBRIS_WEIGHT: f64 = 0.7;
/// Against a ship: hit rate (per second) at zero range, falloff, damage per hit.
pub const PDC_SHIP_RANGE: f64 = 1500.0;
pub const PDC_SHIP_RATE: f64 = 12.0;
pub const PDC_SHIP_FALLOFF: f64 = 600.0;
pub const PDC_SHIP_HIT: (f64, f64) = (12.0, 5.0);

// ---- railgun (spinal: fires along the nose) ----
pub const RAIL_CHARGE: f64 = 2.5;
pub const RAIL_COOLDOWN: f64 = 4.0;
/// Capacitors hold a full charge this long; then the gunner must fire or the charge vents
/// (and the gun is down for RAIL_VENT_COOLDOWN before it can charge again).
pub const RAIL_HOLD: f64 = 4.0;
/// Overcharge: safeties off. Charges RAIL_OVERCHARGE_RATE× as fast and the round hits
/// RAIL_OVERCHARGE_POWER× as hard, but each overcharged shot may burn the ship's own railgun and
/// reactor (RAIL_OVERCHARGE_RISK). A risk a leader has no reason to take and a trailer does: the
/// comeback lives in a choice, not a handicap (Sirlin, "perpetual comeback").
pub const RAIL_OVERCHARGE_RATE: f64 = 2.0;
pub const RAIL_OVERCHARGE_POWER: f64 = 1.5;
pub const RAIL_OVERCHARGE_RISK: f64 = 0.3;
pub const RAIL_OVERCHARGE_BURN: (f64, f64) = (0.4, 0.15);
pub const RAIL_VENT_COOLDOWN: f64 = 2.0;
/// Rounds in the magazine: enough for a typical fight, not a long one (ships fire a median of 6,
/// so this binds in the longer fights and every late round is a decision).
pub const RAIL_AMMO: u32 = 11;
/// Slow enough that time of flight matters: at 3 km a ship burning 8 g sideways can be ~40 m
/// from where it would have been, so medium-range shots are a guess and close ones are certain.
pub const RAIL_SPEED: f64 = 2400.0;
/// A crew sees the muzzle flash and reverses their jink after this long.
pub const FLASH_REACTION: f64 = 0.25;
pub const RAIL_HULL: f64 = 100.0;
/// Everything within this distance of the round's path through the ship takes this damage.
pub const RAIL_PEN: (f64, f64) = (120.0, 1.5);
/// Spall: a round through the hull throws fragments, so what it wrecks widens behind the entry
/// hole — the damage radius grows by this much per metre travelled inside the ship.
pub fn rail_spall() -> f64 { tune("RAIL_SPALL", 0.0) }
/// Crew take this fraction of a hit's damage as health points (100 = dead).
pub fn crew_harm() -> f64 { tune("CREW_HARM", 1.0) }
/// A PDC round that strikes the hull gets inside with this chance, and then does `PDC_PEN_DMG`
/// to everything within `PDC_PEN_R` of its path in toward the ship's spine.
pub fn pdc_pen_p() -> f64 { tune("PDC_PEN_P", 0.06) }
pub fn pdc_pen_dmg() -> f64 { tune("PDC_PEN_DMG", 60.0) }
pub const PDC_PEN_R: f64 = 1.2;
/// A component loses dmg / PART_ARMOR of its health from a hit (1.0 = destroyed).
pub fn part_armor() -> f64 { tune("PART_ARMOR", 120.0) }

/// Experiment knob: a value from the environment (SK_<NAME>), else the default. Read once.
pub fn tune(name: &str, default: f64) -> f64 {
    use std::sync::OnceLock;
    use std::collections::HashMap;
    use std::sync::Mutex;
    static CACHE: OnceLock<Mutex<HashMap<String, f64>>> = OnceLock::new();
    let m = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut g = m.lock().unwrap();
    *g.entry(name.to_string()).or_insert_with(|| std::env::var(format!("SK_{name}")).ok().and_then(|v| v.parse().ok()).unwrap_or(default))
}

// ---- crew ----
/// g-dose: rises at DOSE_K·(g/4)⁴ per second, recovers at DOSE_RECOVER per second. Each crew
/// member's thresholds scale by a personal tolerance in TOLERANCE.
pub const DOSE_K: f64 = 0.005;
pub const DOSE_RECOVER: f64 = 0.02;
pub const BLACKOUT: f64 = 1.0;
pub const WAKE: f64 = 0.7;
pub const INJURY: f64 = 2.0;
pub const DEATH: f64 = 4.0;
pub const TOLERANCE: (f64, f64) = (0.85, 1.15);
/// Engineer: seconds to patch a component back to half health (not under heavy g).
/// Damage is partly temporary (a limited slippery slope): the engineer patches damaged parts at
/// REPAIR_RATE health/s up to REPAIR_CEILING (a combat patch, never good as new); a destroyed part
/// takes REPAIR_TIME to bring back to REPAIR_RESTORED. Any g, while the engineer is awake.
pub const REPAIR_TIME: f64 = 8.0;
pub const REPAIR_RATE: f64 = 0.08;
pub const REPAIR_CEILING: f64 = 0.8;
pub const REPAIR_RESTORED: f64 = 0.3;

/// A ship class: the same systems in different amounts (one weight class; differences are
/// character, not size). STANDARD is the reference design every rule test uses.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ShipClass {
    pub name: &'static str,
    /// Collision/target radius (m); the internal layout scales with it.
    pub radius: f64,
    pub hull: f64,
    /// Turn rate limit (rad/s) and angular acceleration (rad/s²).
    pub max_rate: f64,
    pub rot_accel: f64,
    /// Maneuvering thrusters (m/s²).
    pub rcs_accel: f64,
    pub torpedoes: u32,
    pub tubes: u32,
    pub torp_reload: f64,
    /// PDC ammunition per mount (s of fire) and a multiplier on the mounts' rate of fire.
    pub pdc_ammo: f64,
    pub pdc_rate: f64,
    pub rail_charge: f64,
    pub rail_cooldown: f64,
    pub rail_ammo: u32,
    /// Hull damage of a railgun hit, and damage along its path.
    pub rail_hull: f64,
    pub rail_pen: f64,
}

pub const STANDARD: ShipClass = ShipClass {
    name: "standard",
    radius: SHIP_RADIUS,
    hull: HULL,
    max_rate: MAX_RATE,
    rot_accel: ROT_ACCEL,
    rcs_accel: RCS_ACCEL,
    torpedoes: TORPEDOES,
    tubes: TORP_TUBES,
    torp_reload: TORP_RELOAD,
    pdc_ammo: PDC_AMMO,
    pdc_rate: 1.0,
    rail_charge: RAIL_CHARGE,
    rail_cooldown: RAIL_COOLDOWN,
    rail_ammo: RAIL_AMMO,
    rail_hull: RAIL_HULL,
    rail_pen: RAIL_PEN.0,
};

/// The Striker: agile and quick on the gun. Smaller, turns and jinks harder, fast charge and a
/// deep railgun magazine; less hull, few torpedoes, a lighter PDC screen. Wins in the merge.
pub const STRIKER: ShipClass = ShipClass {
    name: "striker",
    radius: 11.0,
    hull: 1450.0,
    max_rate: 1.2,
    rot_accel: 2.1,
    rcs_accel: 2.4 * G,
    torpedoes: 9,
    tubes: 3,
    torp_reload: 12.0,
    pdc_ammo: 20.0,
    pdc_rate: 1.0,
    rail_charge: 2.0,
    rail_cooldown: 3.5,
    rail_ammo: 13,
    rail_hull: 90.0,
    rail_pen: 110.0,
};

/// The Warden: sturdy and patient. Bigger, more hull, a deep torpedo magazine and a heavy PDC
/// screen, a slow but heavy railgun; turns and jinks sluggishly. Wins at range.
pub const WARDEN: ShipClass = ShipClass {
    name: "warden",
    radius: 12.0,
    hull: 1300.0,
    max_rate: 0.85,
    rot_accel: 1.4,
    rcs_accel: 1.9 * G,
    torpedoes: 12,
    tubes: 3,
    torp_reload: 10.0,
    pdc_ammo: 24.0,
    pdc_rate: 1.1,
    rail_charge: 3.0,
    rail_cooldown: 4.5,
    rail_ammo: 9,
    rail_hull: 115.0,
    rail_pen: 140.0,
};
