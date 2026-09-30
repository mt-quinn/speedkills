//! Wire format shared by the live server and recorded replays: one JSON "state" frame.

use serde_json::{json, Map, Value};
use sk_sim::world::{Cause, Event, Hazard, Kind, Tether};
use sk_sim::{Vec3, World};

pub fn r2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}
pub fn v3(v: Vec3) -> Value {
    json!([r2(v.x), r2(v.y), r2(v.z)])
}

/// A state frame. `modes` labels what is flying each ship (bot mode, "human", "policy g12"...).
/// `with_hazards` can be false for replay frames after the first (hazards are static).
pub fn state(w: &World, modes: &[String], events: &[Event], with_hazards: bool) -> Map<String, Value> {
    let ships: Vec<Value> = w
        .ships
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let b = &w.bodies[i];
            let p = &s.params;
            let tether = match s.tether {
                Tether::None => json!({"k": "none"}),
                Tether::Flying { pos, .. } => json!({"k": "flying", "p": v3(pos)}),
                Tether::Attached { target, rest } => json!({"k": "attached", "target": target, "rest": r2(rest)}),
            };
            json!({
                "i": i, "id": b.id, "name": p.name, "alive": s.alive,
                "p": v3(b.pos), "v": v3(b.vel),
                "q": s.orient.to_array().iter().map(|x| (x * 10000.0).round() / 10000.0).collect::<Vec<_>>(),
                "w": v3(w.ang_vel(i)),
                "r": r2(b.radius), "mass": r2(b.mass), "core": p.core_mass, "start": p.start_mass, "max": p.max_mass,
                "arms": r2(s.arms), "charge": r2(s.charge), "throw_min": p.throw_min, "throw_max": p.throw_max,
                "thrust": r2(s.thrust_level), "field": r2(s.field_level), "ablation": r2(s.ablation), "zone_burn": r2(s.zone_burn),
                "field_range": p.field_range, "field_cone": p.field_cone_deg,
                "tether": tether, "tension": r2(s.tension), "tether_break": p.tether_break, "tether_len": p.tether_len,
                "mode": modes.get(i).cloned().unwrap_or_default(),
                "stats": {
                    "dealt": r2(s.stats.damage_dealt), "taken": r2(s.stats.damage_taken),
                    "hits": s.stats.hits_landed, "throws": s.stats.throws,
                    "scooped": r2(s.stats.mass_scooped), "burned": r2(s.stats.mass_burned),
                }
            })
        })
        .collect();
    let bodies: Vec<Value> = w.bodies[w.ships.len()..]
        .iter()
        .filter(|b| b.alive)
        .map(|b| {
            let (k, o) = match b.kind {
                Kind::Slug { owner } => ("slug", owner as i64),
                Kind::Debris => ("debris", -1),
                Kind::Asteroid => ("asteroid", -1),
                Kind::Ship(_) => ("ship", -1),
            };
            json!({"id": b.id, "k": k, "o": o, "p": v3(b.pos), "v": v3(b.vel), "r": r2(b.radius), "m": r2(b.mass)})
        })
        .collect();
    let mut m = Map::new();
    m.insert("type".into(), json!("state"));
    m.insert("t".into(), json!(r2(w.t)));
    m.insert("tick".into(), json!(w.tick));
    m.insert("finished".into(), json!(w.finished));
    m.insert("winner".into(), json!(w.winner));
    m.insert("arena".into(), json!(r2(w.arena.arena_radius)));
    m.insert("arena_base".into(), json!(w.base_radius));
    m.insert("safe".into(), if w.safe_radius.is_finite() { json!(r2(w.safe_radius)) } else { Value::Null });
    m.insert("safe_base".into(), json!(w.arena.safe_radius));
    m.insert("zone_width".into(), json!(w.arena.zone_width));
    m.insert("zone_rates".into(), json!(w.arena.zone_rates));
    m.insert("time_limit".into(), json!(w.arena.time_limit));
    m.insert("ships".into(), Value::Array(ships));
    m.insert("bodies".into(), Value::Array(bodies));
    if with_hazards {
        m.insert("hazards".into(), hazards(w));
    }
    m.insert("events".into(), Value::Array(events.iter().map(event).collect()));
    m
}

pub fn hazards(w: &World) -> Value {
    Value::Array(
        w.hazards
            .iter()
            .map(|h| match *h {
                Hazard::Well { pos, gm, core } => json!({"k": "well", "p": v3(pos), "gm": r2(gm), "core": r2(core)}),
                Hazard::Nebula { pos, radius, drag } => json!({"k": "nebula", "p": v3(pos), "r": r2(radius), "drag": drag}),
                Hazard::Planet { pos, gm, radius } => json!({"k": "planet", "p": v3(pos), "gm": r2(gm), "core": r2(radius)}),
                Hazard::Stream { a, b, radius, accel } => json!({"k": "stream", "a": v3(a), "b": v3(b), "r": r2(radius), "accel": r2(accel)}),
            })
            .collect(),
    )
}

pub fn cause(c: Cause) -> &'static str {
    match c {
        Cause::Slug => "slug",
        Cause::Ram => "ram",
        Cause::Debris => "debris",
        Cause::Asteroid => "asteroid",
        Cause::Wall => "wall",
        Cause::Well => "well",
        Cause::Nebula => "nebula",
        Cause::Planet => "planet",
        Cause::Zone => "zone",
    }
}

pub fn event(e: &Event) -> Value {
    match *e {
        Event::Throw { ship, mass, pos } => json!({"type": "throw", "ship": ship, "mass": r2(mass), "p": v3(pos)}),
        Event::Hit { victim, attacker, cause: c, lost, energy, pos } => json!({
            "type": "hit", "victim": victim, "attacker": attacker, "cause": cause(c),
            "lost": r2(lost), "energy": r2(energy), "p": v3(pos)
        }),
        Event::Scoop { ship, mass, pos } => json!({"type": "scoop", "ship": ship, "mass": r2(mass), "p": v3(pos)}),
        Event::TetherFire { ship } => json!({"type": "tether_fire", "ship": ship}),
        Event::TetherAttach { ship, target } => json!({"type": "tether_attach", "ship": ship, "target": target}),
        Event::TetherSnap { ship, pos } => json!({"type": "tether_snap", "ship": ship, "p": v3(pos)}),
        Event::TetherRelease { ship } => json!({"type": "tether_release", "ship": ship}),
        Event::TetherMiss { ship } => json!({"type": "tether_miss", "ship": ship}),
        Event::Kill { victim, attacker, pos } => json!({"type": "kill", "victim": victim, "attacker": attacker, "p": v3(pos)}),
        Event::MatchEnd { winner, decision } => json!({"type": "end", "winner": winner, "decision": decision}),
    }
}
