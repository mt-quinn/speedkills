//! Record duel matches for the broadcast viewer.
//!
//!   record --seed 5001 --a reference --b knife --out viewer2/matches/5001.json
//!   record --card 12 --pool 400 --out-dir viewer2/matches
//!
//! A card simulates a pool of mirror matches (standard hull, the tactical styles), scores each
//! for broadcast value from its diagnostics, picks a varied top set, records them and writes
//! index.json for the viewer.
use sk_duel::diag::{run_classes, MatchDiag};
use sk_duel::params::STANDARD;
use sk_duel::pilot::{Pilot, Style, TACTICAL};
use sk_duel::trace::record;
use std::collections::HashMap;

fn arg(args: &[String], k: &str) -> Option<String> {
    args.iter().position(|a| a == k).and_then(|i| args.get(i + 1).cloned())
}

fn play(seed: u64, a: Style, b: Style) -> MatchDiag {
    run_classes(seed, [Pilot::seeded(a, seed * 2), Pilot::seeded(b, seed * 2 + 1)], [STANDARD, STANDARD])
}

/// How much a match promises on paper: back-and-forth, a sensible length, a real ending, and the
/// odd defining moment (a lethal burn, an overcharge that burned, a comeback).
fn score(m: &MatchDiag) -> f64 {
    let mut s = 0.0;
    s += (m.lead_changes.min(4) as f64) * 1.0;
    if m.winner_trailed { s += 1.5; }
    if (60.0..150.0).contains(&m.duration) { s += 1.0; }
    if m.reason == "time" { s -= 2.0; }
    let juice = m.sides.iter().any(|x| x.time_over_14g > 0.3 || x.crew_killed_by_g > 0);
    if juice { s += 1.0; }
    let burns: u32 = m.sides.iter().map(|x| x.overcharge_burns).sum();
    if burns > 0 { s += 0.5; }
    let hits: u32 = m.sides.iter().map(|x| x.hits_taken.values().sum::<u32>()).sum();
    s += (hits as f64 / 6.0).min(2.0);
    s
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if let Some(n) = arg(&args, "--card") {
        let n: usize = n.parse().unwrap();
        let pool: u64 = arg(&args, "--pool").and_then(|v| v.parse().ok()).unwrap_or(400);
        let from: u64 = arg(&args, "--from").and_then(|v| v.parse().ok()).unwrap_or(20000);
        let dir = arg(&args, "--out-dir").unwrap_or("viewer2/matches".into());
        std::fs::create_dir_all(&dir).unwrap();
        // Candidate pool: every pairing of the tactical styles, mirror hull.
        let mut cands: Vec<(f64, u64, Style, Style, MatchDiag)> = Vec::new();
        for k in 0..pool {
            let seed = from + k;
            let a = TACTICAL[(k as usize) % TACTICAL.len()];
            let b = TACTICAL[(k as usize / TACTICAL.len()) % TACTICAL.len()];
            let m = play(seed, a, b);
            cands.push((score(&m), seed, a, b, m));
        }
        cands.sort_by(|x, y| y.0.partial_cmp(&x.0).unwrap());
        // Variety: no more than a third of the card from one pairing or one finishing cause.
        let mut picked = Vec::new();
        let mut by_pair: HashMap<String, usize> = HashMap::new();
        let mut by_cause: HashMap<String, usize> = HashMap::new();
        let cap = (n + 2) / 3;
        for c in &cands {
            if picked.len() >= n { break; }
            // (A pairing is the same whichever side each style starts on.)
            let (x, y) = (format!("{:?}", c.2), format!("{:?}", c.3));
            let pair = if x <= y { format!("{x}-{y}") } else { format!("{y}-{x}") };
            let cause = c.4.finish_cause.clone();
            if *by_pair.get(&pair).unwrap_or(&0) >= cap || *by_cause.get(&cause).unwrap_or(&0) >= cap { continue; }
            *by_pair.entry(pair).or_insert(0) += 1;
            *by_cause.entry(cause).or_insert(0) += 1;
            picked.push(c);
        }
        let mut index = Vec::new();
        for (i, c) in picked.iter().enumerate() {
            let file = format!("{}.json", c.1);
            std::fs::write(format!("{dir}/{file}"), record(c.1, [c.2, c.3], [STANDARD, STANDARD], &c.4)).unwrap();
            index.push(format!(
                "{{\"file\":\"{file}\",\"seed\":{},\"a\":\"{:?}\",\"b\":\"{:?}\",\"score\":{:.2},\"duration\":{:.1},\"lead_changes\":{},\"finish\":\"{}\",\"winner\":{}}}",
                c.1, c.2, c.3, c.0, c.4.duration, c.4.lead_changes, c.4.finish_cause, c.4.winner.map_or("null".into(), |w| w.to_string())
            ));
            eprintln!("{:2}. seed {} {:?} v {:?} · score {:.1} · {:.0}s · {} lead changes · {}", i + 1, c.1, c.2, c.3, c.0, c.4.duration, c.4.lead_changes, c.4.finish_cause);
        }
        std::fs::write(format!("{dir}/index.json"), format!("[{}]", index.join(","))).unwrap();
        return;
    }
    // Find and record a match that ends a particular way (e.g. "crew dead"), for testing.
    if let Some(reason) = arg(&args, "--find-reason") {
        let out = arg(&args, "--out").unwrap_or("viewer2/matches/special.json".into());
        for k in 0..5000u64 {
            let seed = 40000 + k;
            let (a, b) = (TACTICAL[(k as usize) % 3], TACTICAL[(k as usize / 3) % 3]);
            let m = play(seed, a, b);
            if m.reason == reason && m.winner.is_some() {
                std::fs::write(&out, record(seed, [a, b], [STANDARD, STANDARD], &m)).unwrap();
                eprintln!("wrote {out}: seed {seed} {:?} v {:?}, {:.0}s, {}", a, b, m.duration, m.reason);
                return;
            }
        }
        eprintln!("none found");
        return;
    }
    let seed: u64 = arg(&args, "--seed").and_then(|v| v.parse().ok()).unwrap_or(5001);
    let a = Style::from_name(&arg(&args, "--a").unwrap_or("reference".into())).expect("style");
    let b = Style::from_name(&arg(&args, "--b").unwrap_or("reference".into())).expect("style");
    let out = arg(&args, "--out").unwrap_or(format!("viewer2/matches/{seed}.json"));
    let m = play(seed, a, b);
    std::fs::write(&out, record(seed, [a, b], [STANDARD, STANDARD], &m)).unwrap();
    eprintln!("wrote {out}: {:.0}s, winner {:?}, {}", m.duration, m.winner, m.finish_cause);
}
