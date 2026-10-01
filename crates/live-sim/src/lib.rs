//! Small WebAssembly ABI around the exact duel simulator. Names are applied by the service.
use sk_duel::{league::{fight, ShipEntry}, pilot::Style, ship::CrewSpec, trace::record_league};
use std::cell::RefCell;
thread_local! {
    static INPUT: RefCell<[f64; 16]> = const { RefCell::new([1.0; 16]) };
    static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}
#[no_mangle]
pub extern "C" fn hb_input() -> *mut f64 { INPUT.with(|x| x.borrow_mut().as_mut_ptr()) }
fn ship(side: usize, style: u32, identity: u32) -> ShipEntry {
    let styles = [Style::Reference, Style::Knife, Style::Counter];
    INPUT.with(|x| { let stats = x.borrow(); ShipEntry {
        name: if side == 0 { "Amber" } else { "Blue" }, style: styles[style.min(2) as usize], identity: identity as u64,
        crew: std::array::from_fn(|k| CrewSpec { name: "Crew", skill: stats[side * 8 + k * 2].clamp(0.70, 1.35), resistance: stats[side * 8 + k * 2 + 1].round().clamp(1.0, 10.0) }),
    }})
}
#[no_mangle]
pub extern "C" fn hb_fight(seed: u32, a_style: u32, a_id: u32, b_style: u32, b_id: u32) -> usize {
    let a = ship(0, a_style, a_id); let b = ship(1, b_style, b_id);
    let m = fight(seed as u64, &a, &b);
    OUTPUT.with(|x| { *x.borrow_mut() = record_league(seed as u64, &a, &b, &m).into_bytes(); x.borrow().len() })
}
#[no_mangle]
pub extern "C" fn hb_output() -> *const u8 { OUTPUT.with(|x| x.borrow().as_ptr()) }
#[no_mangle]
pub extern "C" fn hb_odds(seed: u32, n: u32, a_style: u32, a_id: u32, b_style: u32, b_id: u32) -> f64 {
    let a = ship(0, a_style, a_id); let b = ship(1, b_style, b_id);
    let mut wins = 0.0;
    for k in 0..n.max(1) {
        let (m, me) = if k % 2 == 0 { (fight(seed as u64 + k as u64, &a, &b), 0) } else { (fight(seed as u64 + k as u64, &b, &a), 1) };
        wins += match m.winner { Some(w) if w == me => 1.0, Some(_) => 0.0, None => 0.5 };
    }
    wins / n.max(1) as f64
}
