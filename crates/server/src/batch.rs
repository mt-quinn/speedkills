//! Headless bot-vs-bot batch runner: plays many matches at full speed and prints how fights
//! unfold, using the same episode metrics (and excitement score) the RL trainer records.
//!
//! Usage: batch [matches_per_pairing] [seed]

use sk_sim::rl::{EpisodeInfo, RewardCfg, RlEnv, ACT_DIM};
use sk_sim::PRESETS;
use std::collections::BTreeMap;
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let per: usize = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(30);
    let seed: u64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(1);
    let start = Instant::now();
    let mut sim_time = 0.0;
    let act = vec![0.0f32; 2 * ACT_DIM];

    for a in 0..PRESETS.len() {
        for b in a..PRESETS.len() {
            let mut env = RlEnv::new(seed * 7919 + (a * 3 + b) as u64, 6, RewardCfg::default());
            env.bot_mask = [true, true];
            env.presets = [Some(a), Some(b)];
            env.reset();
            let mut eps: Vec<EpisodeInfo> = Vec::new();
            while eps.len() < per {
                if let (_, Some(info)) = env.step(&act) {
                    sim_time += info.duration;
                    eps.push(info);
                }
            }
            let n = eps.len() as f64;
            let mean = |f: &dyn Fn(&EpisodeInfo) -> f64| eps.iter().map(f).sum::<f64>() / n;
            let wins = |i: usize| eps.iter().filter(|e| e.winner == Some(i)).count();
            let decisions = eps.iter().filter(|e| e.decision).count();
            let draws = eps.iter().filter(|e| e.winner.is_none()).count();
            let mut causes: BTreeMap<&str, usize> = BTreeMap::new();
            for e in &eps {
                *causes.entry(e.kill_cause.unwrap_or(if e.decision { "decision" } else { "draw" })).or_default() += 1;
            }
            let (pa, pb) = (PRESETS[a].name, PRESETS[b].name);
            println!("== {pa} vs {pb} ({per} matches)");
            println!(
                "   wins {pa}:{}  {pb}:{}  draws:{draws}  decisions:{decisions}   length {:.0}s   first blood {:.0}s   excitement {:.0}",
                wins(0),
                wins(1),
                mean(&|e| e.duration),
                mean(&|e| e.first_blood.unwrap_or(e.duration)),
                mean(&|e| e.excitement)
            );
            println!(
                "   per match: hits/shots {:.1}/{:.1}  near-misses {:.1}  lead changes {:.1}  close {:.0}%  air time {:.1}s  fuel left {:.0}%",
                mean(&|e| (e.hits[0] + e.hits[1]) as f64),
                mean(&|e| (e.shots[0] + e.shots[1]) as f64),
                mean(&|e| e.near_misses as f64),
                mean(&|e| e.lead_changes as f64),
                100.0 * mean(&|e| e.close_frac),
                mean(&|e| e.atmo_time[0] + e.atmo_time[1]),
                50.0 * mean(&|e| e.fuel_left[0] + e.fuel_left[1]),
            );
            let c: Vec<String> = causes.iter().map(|(k, v)| format!("{k} {v}")).collect();
            println!("   endings: {}", c.join("  "));
        }
    }
    let secs = start.elapsed().as_secs_f64();
    println!("\n{:.0} s of matches in {:.1} s = {:.0}x realtime (single thread)", sim_time, secs, sim_time / secs);
}
