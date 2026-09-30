//! Full match recordings for the broadcast viewer: every ship state, projectile, debris cloud and
//! pilot mode at 30 Hz, and every event with its time. Hand-written JSON (compact arrays), read by
//! viewer2/.
use crate::diag::MatchDiag;
use crate::params::*;
use crate::pilot::{Pilot, Style};
use crate::ship::*;
use crate::world::{Event, World};
use sk_sim::math::{Quat, Vec3};
use std::fmt::Write;

/// Frames per second in the recording (the sim runs at 120).
pub const TRACE_HZ: u64 = 30;

/// Ship names for the broadcast, picked by seed.
const SHIP_NAMES: [&str; 16] = [
    "Tachi", "Kestrel", "Marrow", "Sable", "Harrow", "Vesper", "Corvid", "Lantern",
    "Ironbark", "Solace", "Morrigan", "Halcyon", "Talon", "Ember", "Quietus", "Wick",
];

fn v3(o: &mut String, v: Vec3, prec: usize) {
    let _ = write!(o, "[{:.p$},{:.p$},{:.p$}]", v.x, v.y, v.z, p = prec);
}
fn quat(o: &mut String, q: Quat) {
    let _ = write!(o, "[{:.4},{:.4},{:.4},{:.4}]", q.w, q.x, q.y, q.z);
}
fn js(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "'"))
}

fn event_json(e: &Event) -> Option<String> {
    let mut o = String::new();
    match *e {
        Event::TorpedoLaunched { ship, id } => { let _ = write!(o, "\"k\":\"torp_launch\",\"ship\":{ship},\"id\":{id}"); }
        Event::TorpedoDown { id, by, mount, range } => { let _ = write!(o, "\"k\":\"torp_down\",\"id\":{id},\"by\":{by},\"mount\":{mount},\"range\":{range:.0}"); }
        Event::TorpedoHit { id, victim, pos } => { let _ = write!(o, "\"k\":\"torp_hit\",\"id\":{id},\"victim\":{victim},\"pos\":"); v3(&mut o, pos, 1); }
        Event::DebrisHit { id, victim, share, pos } => { let _ = write!(o, "\"k\":\"debris_hit\",\"id\":{id},\"victim\":{victim},\"share\":{share:.3},\"pos\":"); v3(&mut o, pos, 1); }
        Event::RailFired { ship, id } => { let _ = write!(o, "\"k\":\"rail_fire\",\"ship\":{ship},\"id\":{id}"); }
        Event::RailVented { ship } => { let _ = write!(o, "\"k\":\"rail_vent\",\"ship\":{ship}"); }
        Event::Overcharged { ship, burned } => { let _ = write!(o, "\"k\":\"overcharge\",\"ship\":{ship},\"burned\":{burned}"); }
        Event::RailHit { id, victim, pos } => { let _ = write!(o, "\"k\":\"rail_hit\",\"id\":{id},\"victim\":{victim},\"pos\":"); v3(&mut o, pos, 1); }
        Event::PdcHitShip { victim, pos } => { let _ = write!(o, "\"k\":\"pdc_hit\",\"victim\":{victim},\"pos\":"); v3(&mut o, pos, 1); }
        Event::Ram { speed } => { let _ = write!(o, "\"k\":\"ram\",\"speed\":{speed:.0}"); }
        Event::PartDestroyed { ship, part } => { let _ = write!(o, "\"k\":\"part_lost\",\"ship\":{ship},\"part\":{}", js(part.name())); }
        Event::Repaired { ship, part } => { let _ = write!(o, "\"k\":\"repaired\",\"ship\":{ship},\"part\":{}", js(part.name())); }
        Event::CrewKilled { ship, crew, by_g } => { let _ = write!(o, "\"k\":\"crew_killed\",\"ship\":{ship},\"crew\":{crew},\"by_g\":{by_g}"); }
        Event::Damage { ship, cause, hull, parts, crew } => { let _ = write!(o, "\"k\":\"damage\",\"ship\":{ship},\"cause\":{},\"hull\":{hull:.1},\"parts\":{parts:.3},\"crew\":{crew}", js(cause)); }
        Event::BlackedOut { ship, crew } => { let _ = write!(o, "\"k\":\"blackout\",\"ship\":{ship},\"crew\":{crew}"); }
        Event::End { winner, reason } => { let _ = write!(o, "\"k\":\"end\",\"winner\":{},\"reason\":{}", winner.map_or("null".into(), |w| w.to_string()), js(reason)); }
    }
    Some(o)
}

fn ship_frame(o: &mut String, s: &Ship, p: &Pilot) {
    o.push_str("{\"p\":");
    v3(o, s.pos, 1);
    o.push_str(",\"v\":");
    v3(o, s.vel, 1);
    o.push_str(",\"a\":");
    v3(o, s.accel, 2);
    o.push_str(",\"q\":");
    quat(o, s.orient);
    let _ = write!(o, ",\"hull\":{:.1},\"g\":{:.2},\"alive\":{}", s.hull.max(0.0), s.g, s.alive);
    o.push_str(",\"parts\":[");
    for (k, v) in s.parts.iter().enumerate() {
        let _ = write!(o, "{}{:.3}", if k > 0 { "," } else { "" }, v);
    }
    o.push_str("],\"crew\":[");
    for (k, c) in s.crew.iter().enumerate() {
        let st = match c.state { CrewState::Fit => 0, CrewState::BlackedOut => 1, CrewState::Dead => 2 };
        let _ = write!(o, "{}[{},{:.0},{:.3}]", if k > 0 { "," } else { "" }, st, c.health, c.dose / (BLACKOUT * c.tolerance));
    }
    let _ = write!(
        o,
        "],\"rail\":[{:.3},{:.2},{:.2},{},{}],\"torps\":[{},{:.2}],\"pdc\":[",
        s.rail_charge, s.rail_held, s.rail_cooldown, s.rail_ammo, s.rail_overcharged as u8, s.torpedoes, s.torp_reload
    );
    for (k, m) in s.pdcs.iter().enumerate() {
        let _ = write!(o, "{}[{:.2},{:.2},{},{},{}]", if k > 0 { "," } else { "" }, m.ammo, m.heat, m.target.map_or(-1, |t| t as i64), m.at_ship as u8, m.overheated as u8);
    }
    let _ = write!(o, "],\"mode\":{}}}", js(p.mode));
}

/// Record a whole match. `summary` is the diagnostics of the same match (same seed and pilots),
/// embedded so the viewer knows the story up front (lead changes, finishing cause…).
pub fn record(seed: u64, styles: [Style; 2], classes: [ShipClass; 2], summary: &MatchDiag) -> String {
    let mut w = World::with_classes(seed, classes);
    let mut p = [Pilot::seeded(styles[0], seed * 2), Pilot::seeded(styles[1], seed * 2 + 1)];
    let mut frames = String::new();
    let mut events = String::new();
    let mut nframes = 0;
    let every = 120 / TRACE_HZ;
    loop {
        let finished = w.finished || w.t >= 3600.0; // (watchdog, as in diag)
        if w.tick % every == 0 || finished {
            if nframes > 0 {
                frames.push(',');
            }
            nframes += 1;
            let _ = write!(frames, "{{\"t\":{:.3},\"s\":[", w.t);
            ship_frame(&mut frames, &w.ships[0], &p[0]);
            frames.push(',');
            ship_frame(&mut frames, &w.ships[1], &p[1]);
            frames.push_str("],\"tp\":[");
            for (k, t) in w.torps.iter().filter(|t| t.alive).enumerate() {
                let _ = write!(frames, "{}[{},{},", if k > 0 { "," } else { "" }, t.id, t.owner);
                v3(&mut frames, t.pos, 1);
                frames.push(',');
                v3(&mut frames, t.vel, 1);
                frames.push(']');
            }
            frames.push_str("],\"sl\":[");
            for (k, sl) in w.slugs.iter().filter(|s| s.alive).enumerate() {
                let _ = write!(frames, "{}[{},{},", if k > 0 { "," } else { "" }, sl.id, sl.owner);
                v3(&mut frames, sl.pos, 1);
                frames.push(',');
                v3(&mut frames, sl.vel, 1);
                let _ = write!(frames, ",{:.2}]", sl.power);
            }
            frames.push_str("],\"db\":[");
            for (k, d) in w.debris.iter().filter(|d| d.alive).enumerate() {
                let _ = write!(frames, "{}[{},{},", if k > 0 { "," } else { "" }, d.id, d.target);
                v3(&mut frames, d.pos, 1);
                let _ = write!(frames, ",{:.1}]", DEBRIS_SPREAD * d.travelled + 2.0);
            }
            frames.push_str("]}");
        }
        if finished {
            break;
        }
        for i in 0..2 {
            w.inputs[i] = p[i].act(&w, i);
        }
        w.step();
        let t = w.t;
        for e in w.events.drain(..) {
            if let Some(j) = event_json(&e) {
                if !events.is_empty() {
                    events.push(',');
                }
                let _ = write!(events, "{{\"t\":{t:.3},{j}}}");
            }
        }
    }
    // Header.
    let mut o = String::new();
    let names = [SHIP_NAMES[(seed % 16) as usize], SHIP_NAMES[((seed / 16 + seed * 7 + 5) % 16) as usize]];
    let names = if names[0] == names[1] { [names[0], SHIP_NAMES[((seed + 3) % 16) as usize]] } else { names };
    let _ = write!(o, "{{\"version\":1,\"seed\":{seed},\"hz\":{TRACE_HZ},\"ships\":[");
    for i in 0..2 {
        let c = &classes[i];
        let s = &w.ships[i];
        let _ = write!(
            o,
            "{}{{\"name\":{},\"style\":{},\"class\":{},\"radius\":{},\"hull\":{},\"torpedoes\":{},\"rail_ammo\":{},\"pdc_ammo\":{},\"crew\":[{}]}}",
            if i > 0 { "," } else { "" },
            js(names[i]),
            js(&format!("{:?}", styles[i])),
            js(c.name),
            c.radius,
            c.hull,
            c.torpedoes,
            c.rail_ammo,
            c.pdc_ammo,
            s.crew.iter().map(|cr| format!("{{\"name\":{},\"station\":{}}}", js(cr.name), js(cr.station.name()))).collect::<Vec<_>>().join(",")
        );
    }
    o.push_str("],\"parts\":[");
    o.push_str(&PARTS.iter().map(|p| {
        let q = p.pos();
        format!("{{\"name\":{},\"pos\":[{},{},{}]}}", js(p.name()), q.x, q.y, q.z)
    }).collect::<Vec<_>>().join(","));
    o.push_str("],\"stations\":[");
    o.push_str(&STATIONS.iter().map(|s| {
        let q = s.pos();
        format!("{{\"name\":{},\"pos\":[{},{},{}]}}", js(s.name()), q.x, q.y, q.z)
    }).collect::<Vec<_>>().join(","));
    o.push_str("],\"pdc_normals\":[");
    o.push_str(&(0..PDC_MOUNTS).map(|k| { let n = pdc_normal(k); format!("[{},{},{}]", n.x, n.y, n.z) }).collect::<Vec<_>>().join(","));
    o.push_str("],\"rocks\":[");
    o.push_str(&w.rocks.iter().map(|r| format!("[{:.0},{:.0},{:.0},{:.0}]", r.pos.x, r.pos.y, r.pos.z, r.radius)).collect::<Vec<_>>().join(","));
    let _ = write!(
        o,
        "],\"params\":{{\"rail_speed\":{},\"rail_charge\":{},\"rail_hold\":{},\"pdc_range\":{},\"pdc_ship_range\":{},\"blackout\":{},\"drive_max_g\":{},\"time_limit\":{},\"disengage_range\":{}}},",
        RAIL_SPEED, RAIL_CHARGE, RAIL_HOLD, PDC_RANGE, PDC_SHIP_RANGE, BLACKOUT, DRIVE_MAX_G, if time_limit().is_finite() { format!("{}", time_limit()) } else { "null".into() }, DISENGAGE_RANGE
    );
    let _ = write!(o, "\"winner\":{},\"end_reason\":{},", w.winner.map_or("null".into(), |x| x.to_string()), js(w.end_reason));
    let _ = write!(o, "\"summary\":{},", summary.to_json());
    let _ = write!(o, "\"events\":[{events}],\"frames\":[{frames}]}}");
    o
}
