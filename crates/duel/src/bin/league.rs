//! The league: roster, odds, and a card of fights for the viewer.
//!
//!   league roster                         print the roster and each crew's planned strength
//!   league build --odds 400 --card 12     odds for every pairing (simulated), then a card of
//!                                         random matchups, each a genuinely random run
//!                                         (no filtering for drama, so outcomes match the odds);
//!                                         writes viewer2/league.json and viewer2/matches/
use sk_duel::league::{fight, odds, roster, strength, ShipEntry};
use sk_duel::params::*;
use sk_duel::trace::record_league;
use sk_sim::math::Rng;
use std::fmt::Write;

fn arg(args: &[String], k: &str) -> Option<String> {
    args.iter().position(|a| a == k).and_then(|i| args.get(i + 1).cloned())
}

fn js(s: &str) -> String { format!("\"{}\"", s.replace('"', "'")) }

fn ship_json(e: &ShipEntry) -> String {
    let stations = ["pilot", "gunner", "engineer", "ops"];
    format!(
        "{{\"name\":{},\"style\":{},\"strength\":{:.2},\"crew\":[{}]}}",
        js(e.name), js(&format!("{:?}", e.style)), strength(&e.crew),
        e.crew.iter().enumerate().map(|(k, c)| format!("{{\"name\":{},\"station\":{},\"skill\":{:.3},\"tolerance\":{:.3}}}", js(c.name), js(stations[k]), c.skill, c.tolerance)).collect::<Vec<_>>().join(",")
    )
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let ships = roster();
    let n = ships.len();
    match args.get(1).map(|s| s.as_str()) {
        Some("roster") => {
            for e in &ships {
                println!("{:9} {:10} strength {:+5.1}  {}", e.name, format!("{:?}", e.style), strength(&e.crew),
                    e.crew.iter().map(|c| format!("{} {:.2}/{:.2}", c.name, c.skill, c.tolerance)).collect::<Vec<_>>().join("  "));
            }
        }
        Some("fight") => {
            let a: usize = arg(&args, "--a").expect("--a roster index").parse().unwrap();
            let b: usize = arg(&args, "--b").expect("--b roster index").parse().unwrap();
            let seed: u64 = arg(&args, "--seed").expect("--seed").parse().unwrap();
            let out = arg(&args, "--out").expect("--out");
            let m = fight(seed, &ships[a], &ships[b]);
            std::fs::write(out, record_league(seed, &ships[a], &ships[b], &m)).unwrap();
        }
        Some("build") => {
            let on: u64 = arg(&args, "--odds").and_then(|v| v.parse().ok()).unwrap_or(400);
            let cards: usize = arg(&args, "--card").and_then(|v| v.parse().ok()).unwrap_or(12);
            let from: u64 = arg(&args, "--from").and_then(|v| v.parse().ok()).unwrap_or(40_000);
            let viewer = arg(&args, "--viewer").unwrap_or("viewer2".into());
            // Odds for every pairing.
            let mut p = vec![vec![0.5; n]; n];
            let mut worst: f64 = 0.0;
            for i in 0..n {
                for j in (i + 1)..n {
                    let x = odds(&ships[i], &ships[j], on, 100_000 + (i * n + j) as u64 * 10_000);
                    p[i][j] = x; p[j][i] = 1.0 - x;
                    worst = worst.max(x.max(1.0 - x));
                }
                eprintln!("odds: {} done", ships[i].name);
            }
            println!("odds matrix (row beats column):");
            for i in 0..n {
                println!("{:9} {}", ships[i].name, (0..n).map(|j| if i == j { "  -  ".into() } else { format!("{:4.0}%", 100.0 * p[i][j]) }).collect::<Vec<_>>().join(" "));
            }
            println!("most lopsided pairing: {:.0}%", 100.0 * worst);
            // The card: random distinct pairings, a random run of each.
            let mut rng = Rng::new(from ^ 0xCA2D);
            let mut pairs: Vec<(usize, usize)> = (0..n).flat_map(|i| ((i + 1)..n).map(move |j| (i, j))).collect();
            for i in (1..pairs.len()).rev() { let j = (rng.f64() * (i + 1) as f64) as usize; pairs.swap(i, j.min(i)); }
            let dir = format!("{viewer}/matches");
            std::fs::create_dir_all(&dir).unwrap();
            let mut index = Vec::new();
            for (k, &(i, j)) in pairs.iter().take(cards).enumerate() {
                let (a, b) = if rng.f64() < 0.5 { (i, j) } else { (j, i) };
                let seed = from + k as u64;
                let m = fight(seed, &ships[a], &ships[b]);
                let file = format!("L{seed}.json");
                std::fs::write(format!("{dir}/{file}"), record_league(seed, &ships[a], &ships[b], &m)).unwrap();
                println!("{:2}. {} v {} · odds {:.0}–{:.0} · {} {:.0}s", k + 1, ships[a].name, ships[b].name, 100.0 * p[a][b], 100.0 * p[b][a],
                    m.winner.map_or("draw".into(), |w| format!("{} wins", if w == 0 { ships[a].name } else { ships[b].name })), m.duration);
                index.push(format!("{{\"file\":{},\"seed\":{seed},\"ships\":[{a},{b}],\"odds\":[{:.3},{:.3}]}}", js(&file), p[a][b], p[b][a]));
            }
            std::fs::write(format!("{dir}/index.json"), format!("[{}]", index.join(","))).unwrap();
            // The league for the viewer: roster, the odds table, and what the stats mean.
            let mut o = String::new();
            let _ = write!(o, "{{\"version\":1,\"ships\":[{}],\"odds\":[{}],", ships.iter().map(ship_json).collect::<Vec<_>>().join(","),
                p.iter().map(|r| format!("[{}]", r.iter().map(|x| format!("{x:.3}")).collect::<Vec<_>>().join(","))).collect::<Vec<_>>().join(","));
            let _ = write!(o, "\"odds_fights\":{on},\"g\":{{\"dose_k\":{DOSE_K},\"dose_recover\":{DOSE_RECOVER},\"blackout\":{BLACKOUT}}}}}");
            std::fs::write(format!("{viewer}/league.json"), o).unwrap();
            println!("wrote {viewer}/league.json and {cards} fights to {dir}");
        }
        _ => eprintln!("usage: league roster | league fight --a I --b J --seed N --out PATH | league build [--odds N] [--card N] [--from SEED]"),
    }
}
