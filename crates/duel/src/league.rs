//! The league: a persistent roster of named ships and crews, and the odds between them.
//!
//! Crews are balanced on purpose. Each crew member's skill is drawn around league average
//! (character: a crack gunner, a shaky engineer), then the whole crew is nudged so the ship's
//! overall strength lands on a planned, narrow spread — enough variance for favourites and
//! underdogs, never a lock. Odds come from simulating the matchup, not from a formula.
use crate::diag::run_spec;
use crate::params::STANDARD;
use crate::pilot::{Pilot, Style};
use crate::ship::CrewSpec;
use sk_sim::math::Rng;

#[derive(Clone, Debug)]
pub struct ShipEntry {
    pub name: &'static str,
    pub style: Style,
    /// Pilot, gunner, engineer, ops.
    pub crew: [CrewSpec; 4],
    /// Who the pilot is (their habits come from this).
    pub identity: u64,
}

const SHIP_NAMES: [&str; 10] = ["Kestrel", "Marrow", "Sable", "Vesper", "Corvid", "Lantern", "Ironbark", "Solace", "Halcyon", "Quietus"];
const CREW_NAMES: [&str; 40] = [
    "Vasquez", "Okoye", "Brandt", "Liang", "Moreau", "Tanaka", "Reyes", "Sørensen", "Adeyemi", "Kowalski",
    "Nakamura", "Duarte", "Haddad", "Lindqvist", "Mbeki", "Petrov", "Castellanos", "Ito", "Fairweather", "Osei",
    "Novak", "Achebe", "Rourke", "Salazar", "Varga", "Chen", "Delacroix", "Oyelaran", "Brennan", "Sato",
    "Hollis", "Amari", "Voss", "Iyer", "Kaplan", "Mendez", "Quist", "Abara", "Lindgren", "Kwan",
];
const STYLES: [Style; 10] = [
    Style::Reference, Style::Knife, Style::Counter, Style::Reference, Style::Knife,
    Style::Counter, Style::Reference, Style::Knife, Style::Counter, Style::Reference,
];

/// Win-probability points per unit of each stat above league average, measured by
/// `tests::crew_stat_effects` (+0.2 skill: pilot +4.5, gunner +7, engineer +5, ops +5 points;
/// +0.15 g-tolerance for the whole crew: +4.7).
pub const WEIGHTS: [f64; 4] = [22.5, 35.0, 25.0, 25.5];
pub const W_TOL: f64 = 31.0;

/// A crew's planned strength, in win-probability points over a league-average crew.
pub fn strength(c: &[CrewSpec; 4]) -> f64 {
    let skill: f64 = (0..4).map(|k| WEIGHTS[k] * (c[k].skill - 1.0)).sum();
    let tol = c.iter().map(|x| x.tolerance).fold(f64::MAX, f64::min);
    skill + W_TOL * (tol - 1.0)
}

/// The roster (deterministic). Strength targets spread evenly over ±SPREAD points, assigned in
/// shuffled order.
pub fn roster() -> Vec<ShipEntry> {
    const SPREAD: f64 = 7.0;
    let mut rng = Rng::new(0x4841_5244_4255_524E); // "HARDBURN"
    let n = SHIP_NAMES.len();
    let mut targets: Vec<f64> = (0..n).map(|i| -SPREAD + 2.0 * SPREAD * i as f64 / (n - 1) as f64).collect();
    for i in (1..n).rev() { let j = (rng.f64() * (i + 1) as f64) as usize; targets.swap(i, j.min(i)); }
    let mut names: Vec<&'static str> = CREW_NAMES.to_vec();
    for i in (1..names.len()).rev() { let j = (rng.f64() * (i + 1) as f64) as usize; names.swap(i, j.min(i)); }
    (0..n).map(|i| {
        // Character first: each station on its own, around average.
        let mut crew: [CrewSpec; 4] = std::array::from_fn(|k| CrewSpec {
            name: names[i * 4 + k],
            skill: (1.0 + 0.11 * (rng.f64() + rng.f64() + rng.f64() - 1.5) * 2.0).clamp(0.8, 1.25),
            tolerance: rng.range(0.88, 1.15),
        });
        // Then the whole crew nudged (same shift for all four skills) onto the planned strength.
        for _ in 0..4 {
            let d = (targets[i] - strength(&crew)) / WEIGHTS.iter().sum::<f64>();
            for c in crew.iter_mut() { c.skill = (c.skill + d).clamp(0.78, 1.28); }
        }
        ShipEntry { name: SHIP_NAMES[i], style: STYLES[i], crew, identity: 1000 + i as u64 }
    }).collect()
}

/// One league fight: ship `a` on side 0, `b` on side 1.
pub fn fight(seed: u64, a: &ShipEntry, b: &ShipEntry) -> crate::diag::MatchDiag {
    let p = [Pilot::league(a.style, seed * 2, a.identity), Pilot::league(b.style, seed * 2 + 1, b.identity)];
    run_spec(seed, p, [STANDARD, STANDARD], Some([a.crew, b.crew]))
}

/// P(a beats b), from `n` simulated fights with sides alternated (draws count half), run on
/// all cores.
pub fn odds(a: &ShipEntry, b: &ShipEntry, n: u64, base: u64) -> f64 {
    let threads = std::thread::available_parallelism().map_or(4, |x| x.get()) as u64;
    let per = (n + threads - 1) / threads;
    let total: f64 = std::thread::scope(|sc| {
        (0..threads).map(|t| sc.spawn(move || {
            let mut w = 0.0;
            for k in (t * per)..((t + 1) * per).min(n) {
                let seed = base + k;
                let (m, me) = if k % 2 == 0 { (fight(seed, a, b), 0) } else { (fight(seed, b, a), 1) };
                w += match m.winner { Some(x) if x == me => 1.0, Some(_) => 0.0, None => 0.5 };
            }
            w
        })).collect::<Vec<_>>().into_iter().map(|h| h.join().unwrap()).sum()
    });
    total / n as f64
}
