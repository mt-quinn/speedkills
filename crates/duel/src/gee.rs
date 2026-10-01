//! Seeded per-second gee hazards. Resistance reduces risk but never grants immunity.
pub fn resistance_multiplier(resistance: f64) -> f64 {
    let r = resistance.round().clamp(1.0, 10.0);
    if r <= 5.0 { 2.0 - (r - 1.0) / 4.0 } else { 1.0 - (r - 5.0) * 0.12 }
}
/// Probability of an incident in one second: interpolate 7/10/14 g anchors.
pub fn incident_probability(g: f64, resistance: f64) -> f64 {
    if g < 7.0 { return 0.0; }
    let base = if g <= 10.0 { 0.005 + (g - 7.0) * 0.0075 / 3.0 }
        else { 0.0125 + (g - 10.0) * 0.0125 / 4.0 };
    (base.min(0.1) * resistance_multiplier(resistance)).min(0.2)
}
/// Convert a one-second probability to a timestep-independent continuous hazard.
pub fn step_probability(g: f64, resistance: f64, dt: f64) -> f64 {
    1.0 - (1.0 - incident_probability(g, resistance)).powf(dt.max(0.0))
}
/// Routine maneuvers budget a 1.5% per-person incident risk over their planned burn.
/// This is a tactical limit, never a guarantee that the crew stays conscious.
pub fn budget_g(resistance: f64, horizon: f64) -> f64 {
    let probability = 1.0 - 0.985_f64.powf(1.0 / horizon.max(0.1));
    let base = probability / resistance_multiplier(resistance);
    if base <= 0.005 { 7.0 }
    else if base <= 0.0125 { 7.0 + (base - 0.005) * 3.0 / 0.0075 }
    else { 10.0 + (base - 0.0125) * 4.0 / 0.0125 }
}
