//! Trace one bot match: ship state each second plus every notable event.
//! Usage: cargo run --release -p sk-sim --example trace -- <a> <b> <seed>
use sk_sim::bot::{Bot, Personality};
use sk_sim::{preset, Event, MatchConfig, Rng, World};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let pa = preset(a.get(1).map(|s| s.as_str()).unwrap_or("Lancer")).unwrap();
    let pb = preset(a.get(2).map(|s| s.as_str()).unwrap_or("Hornet")).unwrap();
    let seed: u64 = a.get(3).and_then(|s| s.parse().ok()).unwrap_or(3);
    let mut w = World::new(MatchConfig::standard(seed, vec![pa, pb]));
    let mut r = Rng::new(seed);
    let mut bots = [Bot::new(Personality::for_design(pa.name, &mut r), 1), Bot::new(Personality::for_design(pb.name, &mut r), 2)];
    while !w.finished {
        for i in 0..2 {
            let inp = bots[i].act(&w, i);
            w.set_input(i, inp);
        }
        w.step();
        if w.tick % 120 == 0 {
            let d = (w.bodies[0].pos - w.bodies[1].pos).len();
            for i in 0..2 {
                let s = &w.ships[i];
                println!(
                    "t={:6.1} ship{} {:>6} r {:5.0} v {:5.1} hull {:5.0} fuel {:4.0} ammo {:2} dist {:5.0}",
                    w.t, i, bots[i].mode_name(), w.bodies[i].pos.len(), w.bodies[i].vel.len(), s.hull, s.propellant, s.ammo, d
                );
            }
        }
        for e in w.events.drain(..) {
            if !matches!(e, Event::Fire { .. }) {
                println!("t={:6.2}   {:?}", w.t, e);
            }
        }
    }
    println!("winner {:?} at {:.1}s", w.winner, w.t);
}
