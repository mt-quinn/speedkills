//! Rule tests: each checks one promise of DESIGN-v2.md.
use crate::params::*;
use crate::ship::*;
use crate::world::*;
use sk_sim::math::{Quat, Vec3};

/// Two ships at rest `d` apart along x, BLUE (0) facing RED (1); no rocks.
fn duel(d: f64) -> World {
    let mut w = World::new(1);
    w.rocks.clear();
    w.bounded = false;
    w.ships[0].pos = Vec3::ZERO;
    w.ships[1].pos = Vec3::new(d, 0.0, 0.0);
    for s in w.ships.iter_mut() {
        s.vel = Vec3::ZERO;
        s.rate = Vec3::ZERO;
    }
    w.ships[0].orient = Quat::from_to(Vec3::Z, Vec3::X);
    w.ships[1].orient = Quat::from_to(Vec3::Z, -Vec3::X);
    w
}

fn run(w: &mut World, secs: f64) {
    for _ in 0..(secs / DT) as usize {
        w.step();
    }
}

/// No point defence, and no engineer to patch it back up mid-test.
fn disable_pdcs(s: &mut Ship) {
    no_engineer(s);
    for k in 0..PDC_MOUNTS {
        let idx = PARTS.iter().position(|&p| p == Part::pdc(k)).unwrap();
        s.parts[idx] = 0.0;
    }
}

fn no_engineer(s: &mut Ship) {
    for c in s.crew.iter_mut().filter(|c| c.station == Station::Engineer) {
        c.state = CrewState::Dead;
    }
}

// ---------------- crew and g ----------------

/// Crew bodies alone under a steady `g` for `secs` (no flight computer in the loop): time of the
/// first blackout, first death, and survivors.
fn g_test(g: f64, secs: f64) -> (Option<f64>, Option<f64>, usize) {
    let w = duel(5000.0);
    let mut ship = w.ships[0].clone();
    let mut rng = sk_sim::math::Rng::new(3);
    ship.g = g;
    let (mut out, mut dead) = (None, None);
    let mut t = 0.0;
    while t < secs {
        let (killed, blacked) = ship.endure_g(DT, &mut rng);
        t += DT;
        if out.is_none() && !blacked.is_empty() {
            out = Some(t);
        }
        if dead.is_none() && !killed.is_empty() {
            dead = Some(t);
        }
    }
    (out, dead, ship.crew.iter().filter(|c| c.alive()).count())
}

#[test]
fn crew_survive_what_they_should_and_die_at_realistic_g() {
    let (out, dead, _) = g_test(3.0, 60.0);
    assert!(out.is_none() && dead.is_none(), "3 g for a minute is safe");
    let (out, dead, _) = g_test(10.0, 15.0);
    assert!(out.is_some_and(|t| t < 12.0) && dead.is_none(), "10 g: blackouts within seconds, no deaths in 15 s ({out:?}, {dead:?})");
    let (_, dead, _) = g_test(16.0, 8.0);
    assert!(dead.is_some_and(|t| t < 6.0), "16 g: deaths within a few seconds ({dead:?})");
    let (_, dead, alive) = g_test(25.0, 2.5);
    assert!(dead.is_some_and(|t| t < 1.5) && alive == 0, "25 g: the whole crew dies within a second or two ({dead:?}, {alive} alive)");
}

#[test]
fn a_blacked_out_pilot_lets_go_of_the_throttle() {
    let mut w = duel(1e5);
    w.inputs[0] = Input { thrust_g: 10.0, ..Default::default() };
    run(&mut w, 15.0);
    assert!(w.ships[0].crew_at(Station::Pilot).state != CrewState::Fit || w.ships[0].g < 3.1);
    assert!(w.ships[0].crew.iter().all(|c| c.alive()), "the flight computer's hold keeps a blacked-out crew alive");
}

// ---------------- torpedoes and point defence ----------------

/// Fire `n` torpedoes from BLUE at RED from `d`; returns how many hit.
fn salvo(seed: u64, n: u32, d: f64, pdcs: bool, from: Vec3) -> u32 {
    let mut w = duel(d);
    w.rng = sk_sim::math::Rng::new(seed);
    w.ships[0].pos = w.ships[1].pos - from.normalized() * d;
    w.ships[0].orient = Quat::from_to(Vec3::Z, from.normalized());
    if !pdcs {
        disable_pdcs(&mut w.ships[1]);
    }
    // A magazine of `n`: one pull of the trigger fires them as a salvo (up to the tube count).
    w.ships[0].torpedoes = n;
    let mut launched = 0;
    let mut hits = 0;
    for _ in 0..(40.0 / DT) as usize {
        w.inputs[0].fire_torpedo = launched < n;
        w.step();
        for e in w.events.drain(..) {
            match e {
                Event::TorpedoLaunched { .. } => launched += 1,
                Event::TorpedoHit { victim: 1, .. } => hits += 1,
                _ => {}
            }
        }
        if w.finished || (launched == n && w.torps.is_empty()) {
            break;
        }
    }
    hits
}

#[test]
fn a_torpedo_kills_a_ship_with_no_point_defence() {
    let hits: u32 = (0..6).map(|s| salvo(s, 1, 8000.0, false, Vec3::X)).sum();
    assert!(hits >= 5, "undefended: {hits}/6 hit");
}

#[test]
fn point_defence_stops_single_torpedoes_but_salvos_saturate_it() {
    let n = 20;
    let single: u32 = (0..n).map(|s| salvo(s, 1, 8000.0, true, Vec3::X)).sum();
    let three: Vec<u32> = (0..n).map(|s| salvo(100 + s, TORP_TUBES, 8000.0, true, Vec3::X)).collect();
    let through = three.iter().filter(|&&h| h > 0).count();
    eprintln!("single torpedo: {single}/{n} hit; salvo: at least one through in {through}/{n}");
    assert!(single * 100 <= 20 * n as u32, "one torpedo should rarely beat three PDCs ({single}/{n})");
    assert!(through * 100 >= 40 * n as usize, "a full salvo should often get one through ({through}/{n})");
}

#[test]
fn a_lost_mount_leaves_a_blind_arc() {
    // RED's dorsal mount destroyed: a salvo from above (RED's +Y) gets through more than from below.
    let n = 16;
    let count = |from: Vec3, base: u64| -> u32 {
        (0..n)
            .map(|s| {
                let mut w_hits = 0;
                let mut w = duel(8000.0);
                let idx = PARTS.iter().position(|&p| p == Part::Pdc0).unwrap();
                w.ships[1].parts[idx] = 0.0;
                no_engineer(&mut w.ships[1]);
                w.rng = sk_sim::math::Rng::new(base + s);
                // RED's +Y in world frame is its orient * Y.
                let up = w.ships[1].orient.rotate(from);
                w.ships[0].pos = w.ships[1].pos + up * 8000.0;
                w.ships[0].orient = Quat::from_to(Vec3::Z, -up);
                w.ships[0].torpedoes = 2;
                let mut launched = 0;
                for _ in 0..(40.0 / DT) as usize {
                    w.inputs[0].fire_torpedo = launched < 2;
                    w.step();
                    for e in w.events.drain(..) {
                        match e {
                            Event::TorpedoLaunched { .. } => launched += 1,
                            Event::TorpedoHit { victim: 1, .. } => w_hits += 1,
                            _ => {}
                        }
                    }
                    if w.finished || (launched == 2 && w.torps.is_empty()) {
                        break;
                    }
                }
                w_hits
            })
            .sum()
    };
    let above = count(Vec3::Y, 500);
    let below = count(-Vec3::Y, 700);
    eprintln!("blind arc: from above {above}, from below {below} (of {} torpedoes)", 2 * n);
    assert!(above > below + 3, "the dead dorsal mount must open the top ({above} vs {below})");
}

// ---------------- railgun ----------------

fn rail_shot(offset: f64) -> (bool, World) {
    let mut w = duel(2000.0);
    w.rail_scatter = false; // (geometry of the hit, not the gunnery)
    w.ships[1].pos.y = offset;
    w.inputs[0] = Input { charge_rail: true, ..Default::default() };
    run(&mut w, RAIL_CHARGE + 0.1);
    w.inputs[0].fire_rail = true;
    let mut hit = false;
    for _ in 0..(2.0 / DT) as usize {
        w.step();
        w.inputs[0].fire_rail = false;
        hit |= w.events.drain(..).any(|e| matches!(e, Event::RailHit { victim: 1, .. }));
    }
    (hit, w)
}

#[test]
fn the_railgun_hits_along_its_axis_and_knocks_out_what_it_passes_through() {
    let (hit, w) = rail_shot(0.0);
    assert!(hit, "an on-axis shot hits");
    // BLUE's round goes down RED's spine (RED faces BLUE): it holes the hull and damages what's
    // on the axis (the drive at the stern) but spares the vitals and crew set off the centreline.
    let red = &w.ships[1];
    assert!(red.hull < HULL - RAIL_HULL + 1.0 && red.hull > HULL - 2.0 * RAIL_HULL);
    // A round straight through a component knocks it out (the engineer can bring it back).
    assert!(red.part(Part::Drive) <= 0.0, "a round through the drive knocks it out ({})", red.part(Part::Drive));
    assert!(red.part(Part::Reactor) > 0.99 && red.part(Part::Railgun) > 0.99, "off-axis vitals untouched");
    assert!(red.crew.iter().all(|c| c.health > 99.0), "crew compartments sit off the spine");
    let (miss, _) = rail_shot(30.0);
    assert!(!miss, "30 m off the axis misses");
}

#[test]
fn the_railgun_telegraphs_by_needing_a_charge() {
    let mut w = duel(2000.0);
    w.inputs[0] = Input { charge_rail: true, fire_rail: true, ..Default::default() };
    run(&mut w, RAIL_CHARGE * 0.8);
    assert!(w.slugs.is_empty() && w.ships[0].rail_ammo == RAIL_AMMO, "no shot before the charge completes");
    run(&mut w, RAIL_CHARGE * 0.4);
    assert_eq!(w.ships[0].rail_ammo, RAIL_AMMO - 1);
}

// ---------------- damage by location ----------------

#[test]
fn where_a_ship_is_hit_decides_what_breaks_and_who_dies() {
    // The same blast at RED's stern and at its bow.
    let hit = |local: Vec3| {
        let mut w = duel(5000.0);
        let at = w.ships[1].to_world(local);
        let s = &mut w.ships[1];
        s.blast(at, TORP_BLAST.0, TORP_BLAST.1);
        (s.part(Part::Drive), s.part(Part::Sensors), s.crew_at(Station::Engineer).health, s.crew_at(Station::Ops).health)
    };
    let stern = hit(Vec3::new(0.0, 0.0, -11.0));
    let bow = hit(Vec3::new(0.0, 0.0, 11.0));
    assert!(stern.0 < bow.0 && stern.1 > bow.1, "stern hit hurts the drive, bow hit the sensors: {stern:?} vs {bow:?}");
    assert!(stern.2 < bow.2 && stern.3 > bow.3, "stern hit hurts the engineer, bow hit ops: {stern:?} vs {bow:?}");
}

#[test]
fn losing_one_side_of_the_rcs_makes_turning_lopsided() {
    let turn_time = |target_yaw: f64| {
        let mut w = duel(1e5);
        no_engineer(&mut w.ships[0]);
        for p in [Part::RcsBowPort, Part::RcsSternStbd] {
            let idx = PARTS.iter().position(|&x| x == p).unwrap();
            w.ships[0].parts[idx] = 0.0;
        }
        w.inputs[0].rate = Vec3::new(0.0, target_yaw, 0.0);
        run(&mut w, 1.0);
        w.ships[0].rate.y.abs()
    };
    let starboard = turn_time(MAX_RATE);
    let port = turn_time(-MAX_RATE);
    assert!(starboard < 0.05 && port > 0.5, "clusters for starboard yaw lost: {starboard:.2} vs {port:.2} rad/s");
}

// ---------------- repair and endings ----------------

#[test]
fn engineers_patch_parts_but_not_under_heavy_g() {
    // A destroyed part is rebuilt (REPAIR_TIME), then patched up to the combat ceiling.
    let mut w = duel(1e5);
    let idx = PARTS.iter().position(|&x| x == Part::Drive).unwrap();
    w.ships[0].parts[idx] = 0.0;
    run(&mut w, REPAIR_TIME * 0.9);
    assert!(w.ships[0].part(Part::Drive) <= 0.0, "not back yet");
    run(&mut w, REPAIR_TIME * 0.2);
    assert!(w.ships[0].part(Part::Drive) >= REPAIR_RESTORED, "rebuilt");
    run(&mut w, 15.0);
    assert!((w.ships[0].part(Part::Drive) - REPAIR_CEILING).abs() < 1e-6, "patched to the ceiling, never good as new");
    // Repairs go on under heavy g, but not with the engineer blacked out.
    let mut w = duel(1e5);
    let idx = PARTS.iter().position(|&x| x == Part::Railgun).unwrap();
    w.ships[0].parts[idx] = 0.3;
    w.inputs[0].thrust_g = 6.0;
    run(&mut w, 3.0);
    assert!(w.ships[0].part(Part::Railgun) > 0.4, "patching at 6 g");
    let mut w = duel(1e5);
    w.ships[0].parts[idx] = 0.3;
    for c in w.ships[0].crew.iter_mut().filter(|c| c.station == Station::Engineer) {
        c.state = CrewState::BlackedOut;
        c.dose = 10.0;
    }
    run(&mut w, 3.0);
    assert!(w.ships[0].part(Part::Railgun) <= 0.3, "no repairs with the engineer out");
}

#[test]
fn matches_end_on_destruction_crew_death_or_time() {
    let mut w = duel(5000.0);
    w.ships[1].hull = 1.0;
    let at = w.ships[1].pos;
    w.ships[1].hull -= 5.0;
    let _ = at;
    w.step();
    assert!(w.finished && w.winner == Some(0) && w.end_reason == "destroyed");
    let mut w = duel(5000.0);
    for c in w.ships[0].crew.iter_mut() {
        c.state = CrewState::Dead;
    }
    w.step();
    assert!(w.finished && w.winner == Some(1) && w.end_reason == "crew dead");
    // No clock: two idle ships 5 km apart are still fighting after ten minutes.
    let mut w = duel(5000.0);
    run(&mut w, 600.0);
    assert!(!w.finished, "no time-out ending ({})", w.end_reason);
}

#[test]
#[ignore]
fn torpedo_debug() {
    for seed in 0..6 {
        let mut w = duel(8000.0);
        w.rng = sk_sim::math::Rng::new(seed);
        disable_pdcs(&mut w.ships[1]);
        w.inputs[0].fire_torpedo = true;
        w.step();
        w.inputs[0].fire_torpedo = false;
        let mut min_gap = f64::INFINITY;
        let mut hit = false;
        for _ in 0..(40.0 / DT) as usize {
            if let Some(t) = w.torps.first() { min_gap = min_gap.min((t.pos - w.ships[1].pos).len() - SHIP_RADIUS); }
            w.step();
            hit |= w.events.drain(..).any(|e| matches!(e, Event::TorpedoHit { .. }));
            if w.torps.is_empty() { break; }
        }
        eprintln!("seed {seed}: hit {hit} min gap {min_gap:.1} t {:.1}", w.t);
    }
}

// ---------------- the sanity gate ----------------

use crate::pilot::{Pilot, Style};

/// Play a match between two styles; returns (winner, reason, duration, per-side hull).
#[test]
#[ignore]
fn sanity_gate_table() {
    use crate::diag::{run_match, MatchDiag};
    use std::io::Write;
    let n: u64 = std::env::var("GATE_N").ok().and_then(|v| v.parse().ok()).unwrap_or(400);
    std::fs::create_dir_all("../../runs/duel").unwrap();
    let mut log = std::fs::File::create("../../runs/duel/gate.jsonl").unwrap();
    for style in [Style::Reference, Style::Dump, Style::Kite, Style::Run, Style::Turtle, Style::Brawl] {
        let ms: Vec<(usize, MatchDiag)> = (0..n)
            .map(|k| {
                // Reference on side 0 for even seeds, side 1 for odd.
                let (a, b, r) = if k % 2 == 0 { (Style::Reference, style, 0) } else { (style, Style::Reference, 1) };
                (r, run_match(1000 + k, a, b))
            })
            .collect();
        for (_, m) in &ms { writeln!(log, "{}", m.to_json()).unwrap(); }
        let (mut w, mut l, mut d) = (0, 0, 0);
        let mut rc: Vec<(String, usize)> = Vec::new();
        for (r, m) in &ms {
            match m.winner { Some(x) if x == *r => w += 1, Some(_) => l += 1, None => d += 1 }
            if let Some(x) = rc.iter_mut().find(|x| x.0 == m.reason) { x.1 += 1 } else { rc.push((m.reason.clone(), 1)) }
        }
        let avg = |f: &dyn Fn(&MatchDiag, usize) -> f64, me: bool| ms.iter().map(|(r, m)| f(m, if me { *r } else { 1 - *r })).sum::<f64>() / n as f64;
        println!("reference vs {style:?}: {w}/{l}/{d} (won/lost/drawn) · avg {:.0} s · endings {rc:?}", avg(&|m, _| m.duration, true));
        println!("   min dist {:.0} m · t<4km {:.0} s · t<1.2km {:.0} s", avg(&|m, _| m.min_dist, true), avg(&|m, _| m.time_within_4km, true), avg(&|m, _| m.time_within_1200m, true));
        for (lab, me) in [("ref ", true), ("opp ", false)] {
            let g = |f: fn(&crate::diag::SideDiag) -> f64| avg(&|m, i| f(&m.sides[i]), me);
            println!(
                "   {lab} torps {:.1} fired / {:.1} downed / {:.1} hit · rail {:.1} fired / {:.2} hit · pdc→ship {:.1} · hull {:.0} · parts {:.2} · crew {:.2} (hit {:.2}, g {:.2}) · blackouts {:.2} · peak g {:.1} · >8g {:.1}s · maxR {:.0}",
                g(|s| s.torps_fired as f64), g(|s| s.torps_downed as f64), g(|s| s.torps_hit as f64), g(|s| s.rail_fired as f64), g(|s| s.rail_hits as f64),
                g(|s| s.pdc_hits_dealt as f64), g(|s| s.final_hull), g(|s| s.final_parts_mean), g(|s| s.crew_alive as f64), g(|s| s.crew_killed_by_hits as f64),
                g(|s| s.crew_killed_by_g as f64), g(|s| s.blackouts as f64), g(|s| s.peak_g), g(|s| s.time_over_8g), g(|s| s.max_radius),
            );
        }
    }
}

#[test]
#[ignore]
fn rail_debug() {
    // Why the railgun rarely fires: while ready and in range, how far off is the solution?
    let (mut ready, mut charging, mut near, mut buckets) = (0u64, 0u64, 0u64, [0u64; 6]);
    let mut aim_err = [0u64; 5];
    for seed in 0..40 {
        let mut w = World::new(1000 + seed);
        let mut p = [Pilot::new(Style::Reference), Pilot::new(Style::Reference)];
        while !w.finished {
            for i in 0..2 { w.inputs[i] = p[i].act(&w, i); }
            for i in 0..2 {
                let (s, e) = (&w.ships[i], &w.ships[1 - i]);
                let rel = e.pos - s.pos;
                if rel.len() > 4000.0 { continue; }
                near += 1;
                let a = s.forward().dot(crate::pilot::lead(s, e, RAIL_SPEED));
                aim_err[if a > 0.999 { 0 } else if a > 0.99 { 1 } else if a > 0.9 { 2 } else if a > 0.0 { 3 } else { 4 }] += 1;
                if w.inputs[i].charge_rail { charging += 1; }
                if s.rail_charge >= 1.0 {
                    ready += 1;
                    let t = rel.len() / RAIL_SPEED;
                    let f = rel + (e.vel - s.vel) * t;
                    let miss = (f - s.forward() * f.dot(s.forward())).len();
                    buckets[[10.0, 25.0, 50.0, 100.0, 300.0].iter().position(|&b| miss < b).unwrap_or(5)] += 1;
                }
            }
            w.step();
            w.events.clear();
        }
    }
    println!("ticks within 4km {near} · charging {charging} · ready {ready}");
    println!("aim cos buckets [>.999, >.99, >.9, >0, behind] {aim_err:?}");
    println!("miss while ready [<10,<25,<50,<100,<300,more] {buckets:?}");
}

#[test]
#[ignore]
fn weapon_value() {
    use crate::diag::run_pilots;
    // Reference with torpedoes vs the same pilot without them, sides alternating.
    let (mut w, mut l, mut d) = (0, 0, 0);
    for k in 0..400u64 {
        let mut a = Pilot::new(Style::Reference);
        let mut b = Pilot::new(Style::Reference);
        let r = (k % 2) as usize;
        if r == 0 { b.torps = false } else { a.torps = false }
        let m = run_pilots(1000 + k, [a, b]);
        match m.winner { Some(x) if x == r => w += 1, Some(_) => l += 1, None => d += 1 }
    }
    println!("with torpedoes vs without: {w}/{l}/{d}");
    // Railgun: hit rate by range, over the gate log.
}

#[test]
#[ignore]
fn salvo_debug() {
    let (mut down, mut hit, mut expired, mut dvout, mut miss_near) = (0, 0, 0, 0, Vec::new());
    for seed in 0..20 {
        let mut w = duel(8000.0);
        w.rng = sk_sim::math::Rng::new(100 + seed);
        w.ships[0].torpedoes = 3;
        w.inputs[0].fire_torpedo = true;
        let mut closest = std::collections::HashMap::new();
        let mut downs = Vec::new();
        for _ in 0..(40.0 / DT) as usize {
            w.step();
            w.inputs[0].fire_torpedo = false;
            for t in &w.torps {
                if t.alive {
                    let d = (t.pos - w.ships[1].pos).len();
                    let e = closest.entry(t.id).or_insert((f64::MAX, 0.0, 0.0));
                    if d < e.0 { *e = (d, t.dv, w.t); }
                }
            }
            for e in w.events.drain(..) {
                match e {
                    Event::TorpedoDown { range, .. } => { down += 1; downs.push(range as i64); }
                    Event::TorpedoHit { .. } => hit += 1,
                    _ => {}
                }
            }
            if w.torps.iter().all(|t| !t.alive) && w.t > 1.0 { break; }
        }
        for (_, (d, dv, t)) in &closest {
            if *dv <= 0.0 { dvout += 1; }
            if *d > 30.0 { miss_near.push((*d as i64, *dv as i64, (*t * 10.0) as i64)); }
        }
        let _ = &mut expired;
        eprintln!("seed {seed}: downs at {downs:?}");
    }
    eprintln!("down {down} hit {hit} dv-out {dvout} · closest approach of survivors (m, dv left, t×10) {miss_near:?}");
}

#[test]
#[ignore]
fn juke_trace() {
    let seed: u64 = std::env::var("SEED").ok().and_then(|v| v.parse().ok()).unwrap_or(1003);
    let other = if std::env::var("VS").map_or(false, |v| v == "brawl") { Style::Brawl } else { Style::Reference };
    let cross = std::env::var("CROSS").is_ok();
    let warden_seat = std::env::var("CROSS").map_or(false, |v| v == "warden");
    let (c0, c1, s0, s1) = if warden_seat { (crate::params::WARDEN, crate::params::STRIKER, Style::Warden, Style::Striker) } else { (crate::params::STRIKER, crate::params::WARDEN, Style::Striker, Style::Warden) };
    let mut w = if cross { World::with_classes(seed, [c0, c1]) } else { World::new(seed) };
    let mut p = if cross {
        [Pilot::seeded(s0, seed * 2), Pilot::seeded(s1, seed * 2 + 1)]
    } else {
        [Pilot::seeded(Style::Reference, seed * 2), Pilot::seeded(other, seed * 2 + 1)]
    };
    let from: f64 = std::env::var("FROM").ok().and_then(|v| v.parse().ok()).unwrap_or(0.0);
    let mut last = "";
    while !w.finished && w.t < 180.0 {
        for i in 0..2 { w.inputs[i] = p[i].act(&w, i); }
        let (s, e) = (&w.ships[0], &w.ships[1]);
        if w.t >= from && (from > 0.0 || (e.pos - s.pos).len() < 5000.0) {
            if w.tick % if from > 0.0 { 120 } else { 30 } == 0 || (from == 0.0 && p[0].mode != last) {
                let pc = s.crew_at(Station::Pilot);
                let gc = s.crew_at(Station::Gunner);
                print!("dose p {:.2}/{:.2} {:?} gun {:.2}/{:.2} {:?} budget {:.1} | ", pc.dose, pc.tolerance, pc.state, gc.dose, gc.tolerance, gc.state, crate::pilot::g_budget(s, 1.5));
                println!("t {:6.2} {:>12} fwd·juke {:5.2} thr {:4.1} g {:4.1} ours {:.2}/{:.1} | enemy charge {:.2} held {:.1} cd {:.1} | dist {:5.0} closing {:4.0} | p ours {:.2} theirs {:.2}",
                    w.t, p[0].mode, s.forward().dot(p[0].juke_dir), w.inputs[0].thrust_g, s.g, s.rail_charge, s.rail_cooldown, e.rail_charge, e.rail_held, e.rail_cooldown, (e.pos - s.pos).len(),
                    -(e.vel - s.vel).dot((e.pos - s.pos).normalized()), crate::pilot::shot(s, e).p_hit, crate::pilot::shot(e, s).p_hit);
                let sh = crate::pilot::shot(s, e);
                println!("        gun: charge {:.2} held {:.1} cd {:.1} · nose·lead {:.3} · aim miss {:.1} · escape {:.1} · p_env {:.2} p_hit {:.2}", s.rail_charge, s.rail_held, s.rail_cooldown, s.forward().dot(crate::pilot::lead(s, e, RAIL_SPEED)), sh.aim_miss.min(999.0), sh.escape, sh.p_env, sh.p_hit);
                println!("        ammo us {} rail / {} torp / {:.0} pdc · them {} / {} / {:.0} · hull {:.0} vs {:.0} · their mode {} · their charge {:.2}", s.rail_ammo, s.torpedoes, s.pdcs.iter().map(|q| q.ammo).sum::<f64>(), e.rail_ammo, e.torpedoes, e.pdcs.iter().map(|q| q.ammo).sum::<f64>(), s.hull, e.hull, p[1].mode, e.rail_charge);
            }
        }
        last = p[0].mode;
        w.step();
        for ev in w.events.drain(..) {
            match ev {
                Event::RailFired { ship, .. } => println!("   >>> ship {ship} FIRES"),
                Event::RailHit { victim, .. } => println!("   >>> ship {victim} HIT"),
                Event::RailVented { ship } => println!("   >>> ship {ship} vents"),
                Event::BlackedOut { ship: 0, crew } => println!("   >>> BLACKOUT {:?}", w.ships[0].crew[crew].station),
                _ => {}
            }
        }
    }
}

#[test]
#[ignore]
fn budget_debug() {
    let mut w = duel(8000.0);
    let mut outs = 0;
    for k in 0..(30.0 / DT) as usize {
        let g = 8.0f64.min(crate::pilot::g_budget(&w.ships[0], 1.5));
        w.inputs[0] = Input { thrust_g: g, strafe: Vec3::new(1.0, 0.0, 0.0), ..Default::default() };
        w.step();
        for e in w.events.drain(..) { if matches!(e, Event::BlackedOut { ship: 0, .. }) { outs += 1; } }
        if k % 120 == 0 {
            let c = w.ships[0].crew_at(Station::Pilot);
            println!("t {:4.1} cmd {:4.1} felt {:4.1} pilot dose {:.2} (tol {:.2})", w.t, g, w.ships[0].g, c.dose, c.tolerance);
        }
    }
    println!("blackouts {outs}");
}

#[test]
fn running_away_forfeits_but_drifting_apart_is_nobodys_win() {
    // RED burns straight away from BLUE: once they've been past the range long enough, RED loses.
    let mut w = duel(9000.0);
    w.bounded = true;
    w.ships[1].orient = Quat::from_to(Vec3::Z, Vec3::X);
    for _ in 0..(120.0 / DT) as usize {
        w.inputs[1] = Input { thrust_g: 3.0, ..Default::default() };
        w.step();
        if w.finished { break; }
    }
    assert_eq!((w.winner, w.end_reason), (Some(0), "broke off"), "the runner forfeits");
    // Both drifting apart without burning: a draw.
    let mut w = duel(14000.0);
    w.bounded = true;
    w.ships[0].vel = Vec3::new(-40.0, 0.0, 0.0);
    w.ships[1].vel = Vec3::new(40.0, 0.0, 0.0);
    run(&mut w, 30.0);
    assert!(w.finished && w.winner.is_none() && w.end_reason == "broke off", "{:?} {}", w.winner, w.end_reason);
}

/// The spectacle gate: a round-robin of the tactical styles (every pairing, both sides), every
/// fight logged to runs/duel/spectacle.jsonl for python/duel/spectacle.py to score.
#[test]
#[ignore]
fn spectacle_round_robin() {
    use crate::diag::run_pilots;
    use std::io::Write;
    let n: u64 = std::env::var("GATE_N").ok().and_then(|v| v.parse().ok()).unwrap_or(200);
    std::fs::create_dir_all("../../runs/duel").unwrap();
    let mut log = std::fs::File::create("../../runs/duel/spectacle.jsonl").unwrap();
    let styles = crate::pilot::TACTICAL;
    for (i, &a) in styles.iter().enumerate() {
        for &b in &styles[i..] {
            for k in 0..n {
                let seed = 5000 + k;
                let m = run_pilots(seed, [Pilot::seeded(a, seed * 2), Pilot::seeded(b, seed * 2 + 1)]);
                writeln!(log, "{}", m.to_json()).unwrap();
            }
        }
    }
}

#[test]
#[ignore]
fn salvo_vs_closing_speed() {
    // Hull damage a full salvo does (direct hits and debris) by launch range, against a fresh,
    // stationary defender with an engineer (so what's measured is the salvo, not attrition).
    for d in [1500.0, 2500.0, 3500.0, 4500.0, 6000.0, 7500.0] {
        let n = 80;
        let mut dmg = 0.0;
        let mut direct = 0;
        for seed in 0..n {
            let mut w = duel(d);
            w.rng = sk_sim::math::Rng::new(700 + seed);
            w.ships[0].torpedoes = TORP_TUBES;
            w.inputs[0].fire_torpedo = true;
            for _ in 0..(40.0 / DT) as usize {
                w.step();
                w.inputs[0].fire_torpedo = false;
                for e in w.events.drain(..) { if matches!(e, Event::TorpedoHit { victim: 1, .. }) { direct += 1; } }
                if w.t > 2.0 && w.torps.is_empty() && w.debris.is_empty() { break; }
            }
            dmg += HULL - w.ships[1].hull;
        }
        println!("salvo from {d:.0} m: hull damage {:.0} per salvo ({:.2} of a full hit), direct hits {:.2}", dmg / n as f64, dmg / n as f64 / TORP_HULL, direct as f64 / n as f64);
    }
}

#[test]
fn a_torpedo_shot_down_close_still_hurts_one_shot_down_far_out_barely_does() {
    // Debris on a collision course with RED, released at `d` metres at 1500 m/s.
    let loss = |d: f64, jink: bool| {
        let mut w = duel(8000.0);
        no_engineer(&mut w.ships[1]);
        let p = w.ships[1].pos + Vec3::new(-d, 0.0, 0.0);
        w.debris.push(crate::world::Debris { id: 99, target: 1, pos: p, vel: Vec3::new(1500.0, 0.0, 0.0), travelled: 0.0, alive: true });
        if jink {
            w.inputs[1].strafe = Vec3::new(0.0, 1.0, 0.0);
        }
        run(&mut w, d / 1500.0 + 0.5);
        HULL - w.ships[1].hull
    };
    let (close, mid, far) = (loss(60.0, false), loss(400.0, false), loss(1500.0, false));
    assert!(close > 0.5 * TORP_HULL * DEBRIS_WEIGHT, "killed at 60 m, most of it still lands ({close:.0})");
    assert!(mid < 0.4 * close && mid > 1.0, "killed at 400 m, a fraction lands ({mid:.0})");
    assert!(far < 0.1 * close, "killed at 1.5 km, almost nothing ({far:.0})");
    assert!(loss(1500.0, true) <= far, "a jink can take you out of the thinning cloud");
}

/// Two ship classes, each with its own doctrine: the cross matchup, the mirrors, and the swap
/// test (each hull flown with the other's doctrine). Logged to runs/duel/classes.jsonl for
/// python/duel/classes.py.
#[test]
#[ignore]
fn class_matchup() {
    use crate::diag::run_classes;
    use crate::params::{STRIKER, WARDEN};
    use std::io::Write;
    let n: u64 = std::env::var("GATE_N").ok().and_then(|v| v.parse().ok()).unwrap_or(500);
    std::fs::create_dir_all("../../runs/duel").unwrap();
    let mut log = std::fs::File::create("../../runs/duel/classes.jsonl").unwrap();
    let s = (STRIKER, Style::Striker);
    let w = (WARDEN, Style::Warden);
    let s_swapped = (STRIKER, Style::Warden);
    let w_swapped = (WARDEN, Style::Striker);
    let pairings: Vec<(&str, (crate::params::ShipClass, Style), (crate::params::ShipClass, Style), u64)> = vec![
        ("cross", s, w, 2 * n), ("striker mirror", s, s, n), ("warden mirror", w, w, n),
        ("swap: striker hull flies warden doctrine", s_swapped, w, n), ("swap: warden hull flies striker doctrine", s, w_swapped, n),
    ];
    for (label, a, b, count) in pairings {
        for k in 0..count {
            let seed = 9000 + k;
            // Alternate sides so neither class always starts on side 0.
            let (x, y) = if k % 2 == 0 { (a, b) } else { (b, a) };
            let m = run_classes(seed, [Pilot::seeded(x.1, seed * 2), Pilot::seeded(y.1, seed * 2 + 1)], [x.0, y.0]);
            let j = m.to_json();
            writeln!(log, "{{\"pairing\":\"{label}\",{}", &j[1..]).unwrap();
        }
    }
}
