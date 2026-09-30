//! Wire format shared by the live server and recorded replays: one JSON "state" frame.

use serde_json::{json, Map, Value};
use sk_sim::world::{Cause, Event, Hazard, Kind, Weapon};
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
            json!({
                "i": i, "id": b.id, "name": p.name, "alive": s.alive,
                "p": v3(b.pos), "v": v3(b.vel),
                "q": s.orient.to_array().iter().map(|x| (x * 10000.0).round() / 10000.0).collect::<Vec<_>>(),
                "w": v3(w.ang_vel(i)),
                "r": p.radius, "hull": r2(s.hull), "hull_max": p.hull,
                "fuel": r2(s.propellant), "fuel_max": p.propellant,
                "ammo": s.ammo, "ammo_max": p.driver.ammo,
                "reload": r2(s.reload / p.driver.reload), "reload_s": r2(s.reload), "ready": s.reload <= 0.0 && s.ammo > 0,
                "muzzle": p.driver.speed,
                "thrust": r2(s.thrust_level), "strafe": v3(s.strafe_level),
                "zone_burn": r2(s.zone_burn), "heating": r2(s.heating),
                "scoop": r2(s.scoop), "lift": v3(s.lift), "scooped": r2(s.stats.propellant_scooped),
                // What this ship knows of the other: where it believes it is, how sure, seen now?
                "knows": w.know.as_ref().map(|k| {
                    let c = &k.contacts[i];
                    json!({"p": v3(c.pos), "unc": r2(c.uncertainty), "visible": c.visible, "age": r2(w.t - c.seen_t),
                           "flash": c.flash.map(|(fp, ft)| json!({"p": v3(fp), "age": r2(w.t - ft)}))})
                }),
                "mode": modes.get(i).cloned().unwrap_or_default(),
                "stats": {
                    "dealt": r2(s.stats.damage_dealt), "taken": r2(s.stats.damage_taken),
                    "hits": s.stats.hits, "shots": s.stats.shots,
                }
            })
        })
        .collect();
    let bodies: Vec<Value> = w.bodies[w.ships.len()..]
        .iter()
        .filter(|b| b.alive)
        .map(|b| {
            let (k, o) = match b.kind {
                Kind::Round { owner, .. } => ("slug", owner as i64),
                Kind::Asteroid => ("asteroid", -1),
                Kind::Ship(_) => ("ship", -1),
            };
            // A round is "dark" to its target until it comes within range.
            let seen = o >= 0 && w.know.as_ref().is_some_and(|kn| kn.rounds_seen[1 - o as usize].contains(&b.id));
            let m = w.missiles.iter().find(|m| m.id == b.id);
            json!({"id": b.id, "k": k, "o": o, "p": v3(b.pos), "v": v3(b.vel), "r": r2(b.radius), "born": r2(b.born), "seen": seen,
                   "burn": m.is_some_and(|m| m.burning), "lock": m.is_some_and(|m| m.locked)})
        })
        .collect();
    let mut m = Map::new();
    m.insert("type".into(), json!("state"));
    m.insert("t".into(), json!(r2(w.t)));
    m.insert("tick".into(), json!(w.tick));
    m.insert("finished".into(), json!(w.finished));
    m.insert("winner".into(), json!(w.winner));
    m.insert("arena".into(), json!(r2(w.arena.arena_radius)));
    m.insert("arena_base".into(), json!(w.arena.arena_radius));
    m.insert("safe".into(), if w.safe_radius.is_finite() { json!(r2(w.safe_radius)) } else { Value::Null });
    m.insert("safe_base".into(), json!(w.arena.safe_radius));
    m.insert("zone_width".into(), json!(w.arena.zone_width));
    m.insert("zone_rates".into(), json!(w.arena.zone_rates));
    m.insert("atmo".into(), json!(w.arena.atmo_height));
    m.insert("sudden_death_at".into(), json!(w.arena.sudden_death_at));
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
                Hazard::Planet { pos, gm, radius } => json!({"k": "planet", "p": v3(pos), "gm": r2(gm), "core": r2(radius)}),
            })
            .collect(),
    )
}

pub fn cause(c: Cause) -> &'static str {
    sk_sim::rl::cause_name(c)
}

fn weapon(wp: Weapon) -> &'static str {
    match wp {
        Weapon::Driver => "driver",
        Weapon::Missile => "missile",
    }
}

pub fn event(e: &Event) -> Value {
    match *e {
        Event::Fire { ship, weapon: wp, pos } => json!({"type": "fire", "ship": ship, "weapon": weapon(wp), "p": v3(pos)}),
        Event::Hit { victim, attacker, cause: c, damage, pos } => json!({
            "type": "hit", "victim": victim, "attacker": attacker, "cause": cause(c), "damage": r2(damage), "p": v3(pos)
        }),
        Event::Impact { weapon: wp, pos } => json!({"type": "impact", "weapon": weapon(wp), "p": v3(pos)}),
        Event::Burst { weapon: wp, pos, victim, dist } => json!({"type": "burst", "weapon": weapon(wp), "p": v3(pos), "victim": victim, "dist": r2(dist)}),
        Event::Kill { victim, attacker, cause: c, pos } => json!({"type": "kill", "victim": victim, "attacker": attacker, "cause": cause(c), "p": v3(pos)}),
        Event::MatchEnd { winner, decision } => json!({"type": "end", "winner": winner, "decision": decision}),
    }
}
