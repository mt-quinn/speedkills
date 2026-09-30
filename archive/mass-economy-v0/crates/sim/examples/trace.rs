//! Trace one bot match: prints ship state whenever something notable happens.
//! Usage: cargo run --release -p sk-sim --example trace -- <a> <b> <seed>
use sk_sim::bot::{Bot, Personality};
use sk_sim::{preset, Event, MatchConfig, Rng, World};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let pa = preset(a.get(1).map(|s| s.as_str()).unwrap_or("Skater")).unwrap();
    let pb = preset(a.get(2).map(|s| s.as_str()).unwrap_or("Skater")).unwrap();
    let seed: u64 = a.get(3).and_then(|s| s.parse().ok()).unwrap_or(3);
    let mut w = World::new(MatchConfig::standard(seed, vec![pa, pb]));
    let mut r = Rng::new(seed);
    let mut bots = [Bot::new(Personality::for_design(pa.name, &mut r), 1), Bot::new(Personality::for_design(pb.name, &mut r), 2)];
    let mut prev_speed = [0.0f64; 2];
    while !w.finished {
        for i in 0..2 { let inp = bots[i].act(&w, i); w.set_input(i, inp); }
        w.step();
        for i in 0..2 {
            let sp = w.bodies[i].vel.len();
            let jump = sp - prev_speed[i];
            if jump.abs() > 15.0 || (w.tick % 120 == 0) {
                println!("t={:6.2} ship{} {:>10} speed {:6.1} (d {:+6.1}) |pos| {:5.0} mass {:5.0} tether {:?} tension {:.0} thrust {:.2} field {:.2}",
                    w.t, i, bots[i].mode_name(), sp, jump, w.bodies[i].pos.len(), w.bodies[i].mass,
                    std::mem::discriminant(&w.ships[i].tether), w.ships[i].tension, w.ships[i].thrust_level, w.ships[i].field_level);
            }
            prev_speed[i] = sp;
        }
        for e in w.events.drain(..) {
            if !matches!(e, Event::TetherFire{..}) { println!("t={:6.2}   EVENT {:?}", w.t, e); }
        }
    }
    println!("winner {:?} at {:.1}s", w.winner, w.t);
}
