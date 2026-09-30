//! Headless bot-vs-bot batch runner: plays many matches at full speed and prints statistics
//! about how fights unfold. This is the "is the sim healthy?" instrument.
//!
//! Usage: batch [matches_per_pairing] [seed]

use sk_sim::bot::{Bot, Personality};
use sk_sim::world::{Cause, Event, Kind};
use sk_sim::{MatchConfig, Rng, World, PRESETS};
use std::collections::BTreeMap;
use std::time::Instant;

#[derive(Default)]
struct Agg {
    matches: u32,
    wins: [u32; 2],
    draws: u32,
    decisions: u32,
    duration: f64,
    hits_by_cause: BTreeMap<&'static str, u32>,
    kills_by_cause: BTreeMap<String, u32>,
    burned: f64,
    thrown: f64,
    throws: u32,
    scoops: u32,
    scooped_mass: f64,
    tether_attach: u32,
    tether_snaps: u32,
    max_speed: f64,
    first_blood: f64,
    lead_changes: u32,
}

fn cause_name(c: Cause) -> &'static str {
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

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let per: u32 = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(50);
    let seed: u64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(1);
    let mut rng = Rng::new(seed);
    let start = Instant::now();
    let mut total_steps: u64 = 0;

    for a in 0..PRESETS.len() {
        for b in a..PRESETS.len() {
            let (pa, pb) = (PRESETS[a], PRESETS[b]);
            let mut agg = Agg::default();
            for _ in 0..per {
                let mseed = rng.next_u64();
                let mut w = World::new(MatchConfig::standard(mseed, vec![pa, pb]));
                let mut bots = [
                    Bot::new(Personality::for_design(pa.name, &mut rng), rng.next_u64()),
                    Bot::new(Personality::for_design(pb.name, &mut rng), rng.next_u64()),
                ];
                let mut first_blood = None;
                let mut last_cause = [String::new(), String::new()];
                let mut leader: Option<usize> = None;
                while !w.finished {
                    for (i, bot) in bots.iter_mut().enumerate() {
                        let inp = bot.act(&w, i);
                        w.set_input(i, inp);
                    }
                    w.step();
                    total_steps += 1;
                    for e in w.events.drain(..) {
                        match e {
                            Event::Hit { cause, attacker, victim, lost, .. } => {
                                last_cause[victim] = if lost < 15.0 { format!("{}(starved)", cause_name(cause)) } else { cause_name(cause).to_string() };
                                *agg.hits_by_cause.entry(cause_name(cause)).or_default() += 1;
                                if first_blood.is_none() && attacker.is_some_and(|a| a != victim) {
                                    first_blood = Some(w.t);
                                }
                            }
                            Event::Kill { victim, .. } => {
                                *agg.kills_by_cause.entry(last_cause[victim].clone()).or_default() += 1;
                            }
                            Event::Throw { .. } => agg.throws += 1,
                            Event::Scoop { mass, .. } => {
                                agg.scoops += 1;
                                agg.scooped_mass += mass;
                            }
                            Event::TetherAttach { .. } => agg.tether_attach += 1,
                            Event::TetherSnap { .. } => agg.tether_snaps += 1,
                            _ => {}
                        }
                    }
                    // Lead = larger reserve fraction, with hysteresis.
                    if w.tick % 60 == 0 {
                        let f = |i: usize| w.reserve(i) / w.ships[i].params.reserve_capacity();
                        let diff = f(0) - f(1);
                        let now = if diff > 0.08 { Some(0) } else if diff < -0.08 { Some(1) } else { leader };
                        if leader.is_some() && now != leader {
                            agg.lead_changes += 1;
                        }
                        leader = now;
                    }
                }
                // Kill cause: last hit on the loser.
                if w.t >= w.arena.time_limit - 1e-6 && w.winner.is_some() {
                    agg.decisions += 1;
                }
                if let Some(wi) = w.winner {
                    agg.wins[wi] += 1;
                } else {
                    agg.draws += 1;
                }
                let _ = Kind::Debris;
                agg.matches += 1;
                agg.burned += w.ships.iter().map(|s| s.stats.mass_burned).sum::<f64>() / 2.0;
                agg.thrown += w.ships.iter().map(|s| s.stats.mass_thrown).sum::<f64>() / 2.0;
                agg.duration += w.t;
                agg.first_blood += first_blood.unwrap_or(w.t);
                agg.max_speed = agg.max_speed.max(w.ships.iter().map(|s| s.stats.max_speed).fold(0.0, f64::max));
            }
            let n = agg.matches as f64;
            println!("== {} vs {} ({} matches)", pa.name, pb.name, agg.matches);
            println!(
                "   wins {}:{}  {}:{}  draws:{} (decisions {})   avg length {:.1}s   first blood {:.1}s   lead changes/match {:.2}",
                pa.name, agg.wins[0], pb.name, agg.wins[1], agg.draws, agg.decisions, agg.duration / n, agg.first_blood / n,
                agg.lead_changes as f64 / n
            );
            println!(
                "   per match: throws {:.1}  scoops {:.1} ({:.0} kg)  tether attaches {:.1}  snaps {:.2}   top speed {:.0} m/s",
                agg.throws as f64 / n,
                agg.scoops as f64 / n,
                agg.scooped_mass / n,
                agg.tether_attach as f64 / n,
                agg.tether_snaps as f64 / n,
                agg.max_speed
            );
            let hits: Vec<String> = agg.hits_by_cause.iter().map(|(k, v)| format!("{k} {:.1}", *v as f64 / n)).collect();
            println!("   damaging hits/match: {}", hits.join("  "));
            let kills: Vec<String> = agg.kills_by_cause.iter().map(|(k, v)| format!("{k} {v}")).collect();
            println!("   killing blows: {}", kills.join("  "));
            println!("   per ship: burned {:.0} kg  thrown {:.0} kg", agg.burned / n, agg.thrown / n);
        }
    }
    let secs = start.elapsed().as_secs_f64();
    println!(
        "\n{} sim steps in {:.2}s = {:.0} steps/s ({:.0}x realtime, single thread)",
        total_steps,
        secs,
        total_steps as f64 / secs,
        total_steps as f64 / secs / 120.0
    );
}
