//! Per-match diagnostics: every match played through `run_match` produces a full account of
//! what each side did and what happened to it, so no result ever needs re-simulating to explain.
use crate::params::*;
use crate::pilot::{shot, Pilot, Style};
use sk_sim::math::Vec3;
use crate::world::{Event, World};

/// One railgun round: what fire control thought, and what happened.
#[derive(Clone, Debug, Default)]
pub struct RailShot {
    pub t: f64,
    pub range: f64,
    /// Fire control's estimates at the trigger: miss against present motion, escape envelope, p(hit).
    pub aim_miss: f64,
    pub escape: f64,
    pub p_est: f64,
    /// Target's mean sideways acceleration (across the round's path) during the flight, m/s².
    pub target_lateral: f64,
    pub closest: f64,
    pub hit: bool,
    /// The target pilot's mode and g at the trigger.
    pub target_mode: String,
    pub target_g: f64,
    /// Flight time until the round was gone (hit, rock, or expiry), vs range / speed.
    pub flight: f64,
    lat_sum: f64,
    lat_n: u32,
}

#[derive(Clone, Debug, Default)]
pub struct SideDiag {
    pub style: String,
    pub class: String,
    pub torps_fired: u32,
    /// Our torpedoes that the enemy's PDCs shot down / that hit / that expired or missed.
    pub torps_downed: u32,
    pub torps_hit: u32,
    pub defensive_rail_fired: u32,
    pub defensive_torps_fired: u32,
    pub rail_intercepts: u32,
    pub torp_intercepts: u32,
    pub concurrent_intent_time: f64,
    /// Debris from our torpedoes that the enemy broke up but still took (count, summed share).
    pub debris_hits: u32,
    pub debris_share: f64,
    pub rail_fired: u32,
    pub rail_hits: u32,
    pub rail_vents: u32,
    pub overcharges: u32,
    pub overcharge_burns: u32,
    /// Range at each railgun shot (m).
    pub rail_ranges: Vec<f64>,
    pub shots: Vec<RailShot>,
    pub pdc_hits_dealt: u32,
    pub parts_lost: Vec<String>,
    /// When each part was lost and each crew member killed by a hit (s), and the component
    /// damage taken (sum of part health lost, destroyed or not) — for how often the fight
    /// reaches inside the ship before the end.
    pub part_loss_t: Vec<f64>,
    pub crew_hit_death_t: Vec<f64>,
    pub parts_damage: f64,
    pub repairs: u32,
    pub crew_killed_by_hits: u32,
    pub crew_killed_by_g: u32,
    pub blackouts: u32,
    /// Pilot mode, g and crew station at each blackout.
    pub blackout_log: Vec<String>,
    pub peak_g: f64,
    /// Seconds above 8 g (hard) and above 12 g (dangerous).
    pub time_over_8g: f64,
    pub time_over_12g: f64,
    pub max_speed: f64,
    pub max_radius: f64,
    pub final_hull: f64,
    pub final_parts_mean: f64,
    pub crew_alive: u32,
    pub torps_left: u32,
    /// PDC ammunition left (s of fire, summed over mounts) and working mounts at the end.
    pub pdc_ammo_left: f64,
    pub pdc_mounts_left: u32,
    /// When each salvo went out (s).
    pub salvo_times: Vec<f64>,
    /// Each salvo: (first launch, torpedoes, rippled), and the last launch time (to group a
    /// ripple's launches into one salvo).
    pub salvos: Vec<(f64, u32, bool, &'static str)>,
    pub last_launch: f64,
    pub rail_left: u32,
    pub first_damage_dealt_t: Option<f64>,
    /// Meaningful hits taken (≥50 hull, a quarter of a part, or a crew member), by cause.
    pub hits_taken: std::collections::BTreeMap<String, u32>,
    /// Damage taken by cause (hull + 200 × component health lost).
    pub damage_taken: std::collections::BTreeMap<String, f64>,
    /// Seconds above 14 g (past what the crew can take for long: the juice used to save the ship).
    pub time_over_14g: f64,
    /// Where the >14 g time was spent, by pilot mode.
    pub over14_by_mode: std::collections::BTreeMap<String, f64>,
    /// Weakest g tolerance among the crew (sets how hard the ship can juke without a blackout).
    pub min_resistance: f64,
    /// Seconds spent in each pilot mode.
    pub mode_time: std::collections::BTreeMap<String, f64>,
}

#[derive(Clone, Debug, Default)]
pub struct MatchDiag {
    pub seed: u64,
    pub winner: Option<usize>,
    pub reason: String,
    pub duration: f64,
    pub min_dist: f64,
    pub start_dist: f64,
    /// Seconds spent within railgun charging range (4 km) and within ship-PDC range (1.2 km).
    pub time_within_4km: f64,
    pub time_within_1200m: f64,
    /// The killing blow: what actually took the loser over the line (hull to zero, last crew
    /// member, reactor) — railgun / torpedo / pdc / ram / rock / g / overcharge — or broke off / time.
    pub finish_cause: String,
    /// The weapon that did the most damage to the loser in the final 10 s (for comparison).
    pub finish_last10: String,
    /// Times the lead (by health index) changed hands after first damage, and whether the
    /// eventual winner was ever behind.
    pub lead_changes: u32,
    pub winner_trailed: bool,
    /// Each merge (a close approach under 2.5 km): time, pass distance, peak line-of-sight rate
    /// (rad/s), and rail shots fired by each side within ±3 s of it.
    pub merges: Vec<(f64, f64, f64, [u32; 2])>,
    /// Health index (0..1) per side, sampled once a second.
    pub health: Vec<[f64; 2]>,
    pub sides: [SideDiag; 2],
}

pub fn health_index(s: &crate::ship::Ship) -> f64 {
    s.health_index()
}

impl MatchDiag {
    pub fn to_json(&self) -> String {
        let side = |s: &SideDiag| {
            format!(
                "{{\"defensive_rail_fired\":{},\"defensive_torps_fired\":{},\"rail_intercepts\":{},\"torp_intercepts\":{},\"concurrent_intent_time\":{:.2},\"style\":\"{}\",\"class\":\"{}\",\"torps_fired\":{},\"torps_downed\":{},\"torps_hit\":{},\"debris_hits\":{},\"debris_share\":{:.2},\"rail_fired\":{},\"rail_hits\":{},\"rail_vents\":{},\"overcharges\":{},\"overcharge_burns\":{},\"rail_ranges\":[{}],\"shots\":[{}],\"pdc_hits_dealt\":{},\"parts_lost\":[{}],\"repairs\":{},\"crew_killed_by_hits\":{},\"crew_killed_by_g\":{},\"blackouts\":{},\"blackout_log\":[{}],\"peak_g\":{:.2},\"time_over_8g\":{:.2},\"time_over_12g\":{:.2},\"max_speed\":{:.1},\"max_radius\":{:.0},\"final_hull\":{:.1},\"final_parts_mean\":{:.3},\"crew_alive\":{},\"torps_left\":{},\"pdc_ammo_left\":{:.1},\"pdc_mounts_left\":{},\"salvo_times\":[{}],\"rail_left\":{},\"first_damage_dealt_t\":{},\"hits_taken\":{{{}}},\"damage_taken\":{{{}}},\"time_over_14g\":{:.2},\"over14_by_mode\":{{{}}},\"min_resistance\":{:.3},\"mode_time\":{{{}}},\"part_loss_t\":[{}],\"crew_hit_death_t\":[{}],\"parts_damage\":{:.3},\"salvos\":[{}]}}",
                s.defensive_rail_fired,s.defensive_torps_fired,s.rail_intercepts,s.torp_intercepts,s.concurrent_intent_time,s.style, s.class, s.torps_fired, s.torps_downed, s.torps_hit, s.debris_hits, s.debris_share, s.rail_fired, s.rail_hits, s.rail_vents, s.overcharges, s.overcharge_burns, s.rail_ranges.iter().map(|r| format!("{r:.0}")).collect::<Vec<_>>().join(","),
                s.shots.iter().map(|x| format!("{{\"t\":{:.2},\"range\":{:.0},\"aim_miss\":{:.1},\"escape\":{:.1},\"p_est\":{:.2},\"target_lateral\":{:.1},\"closest\":{:.1},\"hit\":{},\"flight\":{:.3},\"target_mode\":\"{}\",\"target_g\":{:.1}}}", x.t, x.range, x.aim_miss.min(9999.0), x.escape, x.p_est, x.target_lateral, x.closest, x.hit, x.flight, x.target_mode, x.target_g)).collect::<Vec<_>>().join(","), s.pdc_hits_dealt,
                s.parts_lost.iter().map(|p| format!("\"{p}\"")).collect::<Vec<_>>().join(","),
                s.repairs, s.crew_killed_by_hits, s.crew_killed_by_g, s.blackouts, s.blackout_log.iter().map(|b| format!("\"{b}\"")).collect::<Vec<_>>().join(","), s.peak_g, s.time_over_8g, s.time_over_12g,
                s.max_speed, s.max_radius, s.final_hull, s.final_parts_mean, s.crew_alive, s.torps_left, s.pdc_ammo_left, s.pdc_mounts_left, s.salvo_times.iter().map(|t| format!("{t:.1}")).collect::<Vec<_>>().join(","), s.rail_left,
                s.first_damage_dealt_t.map_or("null".into(), |t| format!("{t:.2}")),
                s.hits_taken.iter().map(|(k, v)| format!("\"{k}\":{v}")).collect::<Vec<_>>().join(","),
                s.damage_taken.iter().map(|(k, v)| format!("\"{k}\":{v:.0}")).collect::<Vec<_>>().join(","),
                s.time_over_14g,
                s.over14_by_mode.iter().map(|(k, v)| format!("\"{k}\":{v:.2}")).collect::<Vec<_>>().join(","),
                s.min_resistance,
                s.mode_time.iter().map(|(k, v)| format!("\"{k}\":{v:.1}")).collect::<Vec<_>>().join(","),
                s.part_loss_t.iter().map(|t| format!("{t:.1}")).collect::<Vec<_>>().join(","),
                s.crew_hit_death_t.iter().map(|t| format!("{t:.1}")).collect::<Vec<_>>().join(","),
                s.parts_damage,
                s.salvos.iter().map(|(t, n, r, y)| format!("[{t:.1},{n},{},\"{y}\"]", *r as u8)).collect::<Vec<_>>().join(","),
            )
        };
        format!(
            "{{\"seed\":{},\"winner\":{},\"reason\":\"{}\",\"finish_cause\":\"{}\",\"finish_last10\":\"{}\",\"lead_changes\":{},\"merges\":[{}],\"winner_trailed\":{},\"health\":[{}],\"duration\":{:.2},\"start_dist\":{:.0},\"min_dist\":{:.0},\"time_within_4km\":{:.1},\"time_within_1200m\":{:.1},\"sides\":[{},{}]}}",
            self.seed, self.winner.map_or("null".into(), |w| w.to_string()), self.reason, self.finish_cause, self.finish_last10, self.lead_changes, self.merges.iter().map(|m| format!("[{:.1},{:.0},{:.2},{},{}]", m.0, m.1, m.2, m.3[0], m.3[1])).collect::<Vec<_>>().join(","), self.winner_trailed,
            self.health.iter().map(|h| format!("[{:.3},{:.3}]", h[0], h[1])).collect::<Vec<_>>().join(","), self.duration, self.start_dist,
            self.min_dist, self.time_within_4km, self.time_within_1200m, side(&self.sides[0]), side(&self.sides[1]),
        )
    }
}

/// The weapon that did the most damage to a ship in the last 10 s of the fight (the finisher,
/// rather than whichever scratch happened to land last). g deaths count as "g".
fn finisher<'a>(log: &[(f64, &'a str, f64)], end: f64) -> Option<&'a str> {
    let mut by: Vec<(&str, f64)> = Vec::new();
    for &(t, c, v) in log.iter().filter(|x| x.0 > end - 10.0) {
        match by.iter_mut().find(|x| x.0 == c) {
            Some(x) => x.1 += v,
            None => by.push((c, v)),
        }
    }
    by.into_iter().max_by(|a, b| a.1.partial_cmp(&b.1).unwrap()).map(|x| x.0)
}

/// Play one match between two scripted styles, recording everything.
pub fn run_match(seed: u64, a: Style, b: Style) -> MatchDiag {
    run_pilots(seed, [Pilot::seeded(a, seed * 2), Pilot::seeded(b, seed * 2 + 1)])
}

pub fn run_pilots(seed: u64, p: [Pilot; 2]) -> MatchDiag {
    run_classes(seed, p, [crate::params::STANDARD, crate::params::STANDARD])
}

pub fn run_classes(seed: u64, p: [Pilot; 2], classes: [crate::params::ShipClass; 2]) -> MatchDiag {
    run_spec(seed, p, classes, None)
}

/// A match with named crews aboard (the league's rosters).
pub fn run_spec(seed: u64, mut p: [Pilot; 2], classes: [crate::params::ShipClass; 2], crews: Option<[[crate::ship::CrewSpec; 4]; 2]>) -> MatchDiag {
    let (a, b) = (p[0].style, p[1].style);
    let mut w = World::with_classes(seed, classes);
    if let Some(c) = crews {
        for i in 0..2 { w.ships[i].apply_crew(&c[i]); }
    }
    let mut d = MatchDiag { seed, min_dist: f64::MAX, ..Default::default() };
    d.sides[0].style = format!("{a:?}");
    d.sides[1].style = format!("{b:?}");
    d.sides[0].class = classes[0].name.to_string();
    d.sides[1].class = classes[1].name.to_string();
    d.start_dist = (w.ships[0].pos - w.ships[1].pos).len();
    for i in 0..2 {
        d.sides[i].min_resistance = w.ships[i].crew.iter().map(|c| c.resistance).fold(f64::MAX, f64::min);
    }
    // Torpedo id → owner, to credit shoot-downs and hits.
    let mut owner = std::collections::HashMap::new();
    let mut merge_now: Option<(f64, f64, f64, [u32; 2])> = None;
    let mut last_cause: [&str; 2] = ["", ""];
    let mut recent: [Vec<(f64, &str, f64)>; 2] = [Vec::new(), Vec::new()];
    let mut slug_of: std::collections::HashMap<u32, (usize, usize)> = std::collections::HashMap::new();
    // (A batch-run watchdog, not a game rule: a fight still going after an hour is recorded as
    // unfinished so the gate sees it, rather than hanging the run.)
    while !w.finished && w.t < 3600.0 {
        for i in 0..2 {
            w.inputs[i] = p[i].act(&w, i);
        }
        // Fire control's view at the moment of decision (the step fires on this state).
        let pre = [shot(&w.ships[0], &w.ships[1]), shot(&w.ships[1], &w.ships[0])];
        let modes = [p[0].mode, p[1].mode];
        let why = [p[0].salvo_why, p[1].salvo_why];
        let gs = [w.ships[0].g, w.ships[1].g];
        for i in 0..2 {
            *d.sides[i].mode_time.entry(modes[i].to_string()).or_insert(0.0) += DT;
        }
        let before: Vec<(u32, Vec3, Vec3)> = w.slugs.iter().map(|sl| (sl.id, sl.pos, w.ships[1 - sl.owner].pos)).collect();
        w.step();
        let dist = (w.ships[0].pos - w.ships[1].pos).len();
        {
            let rel = w.ships[1].pos - w.ships[0].pos;
            let rv = w.ships[1].vel - w.ships[0].vel;
            let los_rate = rel.cross(rv).len() / rel.len_sq().max(1.0);
            // Track the current approach; close it out as the range opens again.
            if dist < 2500.0 {
                match merge_now.as_mut() {
                    Some(m) => { if dist < m.1 { m.0 = w.t; m.1 = dist; } m.2 = f64::max(m.2, los_rate); }
                    None => merge_now = Some((w.t, dist, los_rate, [0, 0])),
                }
            }
            if let Some(m) = merge_now {
                if dist > m.1 + 400.0 || dist >= 2500.0 {
                    d.merges.push(m);
                    merge_now = None;
                }
            }
        }
        d.min_dist = d.min_dist.min(dist);
        if dist < 4000.0 { d.time_within_4km += DT; }
        if dist < 1200.0 { d.time_within_1200m += DT; }
        for i in 0..2 {
            let s = &w.ships[i];
            let sd = &mut d.sides[i];
            sd.peak_g = sd.peak_g.max(s.g);
            if p[i].intent.iter().filter(|&&x|x>0.2).count()>=2 {sd.concurrent_intent_time+=DT;}
            if s.g > 8.0 { sd.time_over_8g += DT; }
            if s.g > 12.0 { sd.time_over_12g += DT; }
            if s.g > 14.0 {
                sd.time_over_14g += DT;
                *sd.over14_by_mode.entry(modes[i].to_string()).or_insert(0.0) += DT;
            }
            sd.max_speed = sd.max_speed.max(s.vel.len());
            sd.max_radius = sd.max_radius.max(s.pos.len());
        }
        let t = w.t;
        if w.tick % 120 == 0 {
            d.health.push([health_index(&w.ships[0]), health_index(&w.ships[1])]);
        }
        // Rounds in flight: exact closest approach to their target within this step, and how
        // hard the target is jinking across the round's path.
        for sl in &w.slugs {
            if let Some(&(o, k)) = slug_of.get(&sl.id) {
                let tg = &w.ships[1 - o];
                let rs = &mut d.sides[o].shots[k];
                let (p0, t0) = before.iter().find(|b| b.0 == sl.id).map(|b| (b.1, b.2)).unwrap_or((sl.pos - sl.vel * DT, tg.pos - tg.vel * DT));
                let (a, b) = (p0 - t0, sl.pos - tg.pos);
                let dd = b - a;
                let f = (-a.dot(dd) / dd.len_sq().max(1e-12)).clamp(0.0, 1.0);
                rs.closest = rs.closest.min((a + dd * f).len());
                let dir = sl.vel.normalized_or(Vec3::Z);
                let acc = tg.accel;
                rs.lat_sum += (acc - dir * acc.dot(dir)).len();
                rs.lat_n += 1;
            }
        }
        for (id, _, _) in &before {
            if !w.slugs.iter().any(|sl| sl.id == *id) {
                if let Some(&(o, k)) = slug_of.get(id) {
                    let rs = &mut d.sides[o].shots[k];
                    rs.flight = t - rs.t;
                }
            }
        }
        let events: Vec<Event> = w.events.drain(..).collect();
        for e in events {
            let dealt = |d: &mut MatchDiag, by: usize| {
                let f = &mut d.sides[by].first_damage_dealt_t;
                if f.is_none() { *f = Some(t); }
            };
            match e {
                Event::TorpedoLaunched { ship, id } => {
                    d.sides[ship].torps_fired += 1;
                    owner.insert(id, ship);
                    let sd = &mut d.sides[ship];
                    let same = sd.salvos.last().map_or(false, |sv| t - sv.0 <= 5.0) && t - sd.last_launch <= 1.6;
                    if same {
                        let sv = sd.salvos.last_mut().unwrap();
                        sv.1 += 1;
                        if t - sv.0 > 0.15 { sv.2 = true; }
                    } else {
                        sd.salvos.push((t, 1, false, why[ship]));
                        sd.salvo_times.push(t);
                    }
                    sd.last_launch = t;
                }
                Event::TorpedoDown { id, .. } => { if let Some(&o) = owner.get(&id) { d.sides[o].torps_downed += 1; } }
                Event::DefensiveShot { ship,weapon,.. } => {if weapon=="railgun" {d.sides[ship].defensive_rail_fired+=1;}else{d.sides[ship].defensive_torps_fired+=1;}}
                Event::TorpedoIntercepted {id,by,weapon,..} => {if let Some(&o)=owner.get(&id){d.sides[o].torps_downed+=1;}if weapon=="railgun" {d.sides[by].rail_intercepts+=1;}else{d.sides[by].torp_intercepts+=1;}}
                Event::DebrisHit { victim, share, .. } => { d.sides[1 - victim].debris_hits += 1; d.sides[1 - victim].debris_share += share; }
                Event::TorpedoHit { victim, .. } => { d.sides[1 - victim].torps_hit += 1; dealt(&mut d, 1 - victim); }
                Event::RailFired { ship, id } => {
                    d.sides[ship].rail_fired += 1;
                    d.sides[ship].rail_ranges.push(dist);
                    let sh = &pre[ship];
                    slug_of.insert(id, (ship, d.sides[ship].shots.len()));
                    d.sides[ship].shots.push(RailShot { t, range: dist, aim_miss: sh.aim_miss, escape: sh.escape, p_est: sh.p_hit, closest: f64::MAX, target_mode: modes[1 - ship].into(), target_g: gs[1 - ship], ..Default::default() });
                }
                Event::RailHit { id, victim, .. } => {
                    d.sides[1 - victim].rail_hits += 1;
                    dealt(&mut d, 1 - victim);
                    if let Some(&(o, k)) = slug_of.get(&id) { d.sides[o].shots[k].hit = true; }
                }
                Event::PdcHitShip { victim, .. } => { d.sides[1 - victim].pdc_hits_dealt += 1; dealt(&mut d, 1 - victim); }
                Event::PartDestroyed { ship, part } => { d.sides[ship].parts_lost.push(part.name().into()); d.sides[ship].part_loss_t.push(t); }
                Event::Repaired { ship, .. } => d.sides[ship].repairs += 1,
                Event::CrewKilled { ship, by_g, .. } => {
                    if by_g {
                        d.sides[ship].crew_killed_by_g += 1;
                        last_cause[ship] = "g";
                        recent[ship].push((t, "g", 400.0));
                    } else {
                        d.sides[ship].crew_killed_by_hits += 1;
                        d.sides[ship].crew_hit_death_t.push(t);
                    }
                }
                Event::Damage { ship, cause, hull, parts, crew } => {
                    last_cause[ship] = cause;
                    d.sides[ship].parts_damage += parts;
                    recent[ship].push((t, cause, hull + 200.0 * parts + 50.0 * crew as f64));
                    *d.sides[ship].damage_taken.entry(cause.to_string()).or_insert(0.0) += hull + 200.0 * parts;
                    if hull >= 50.0 || parts >= 0.25 || crew > 0 {
                        *d.sides[ship].hits_taken.entry(cause.to_string()).or_insert(0) += 1;
                    }
                }
                Event::RailVented { ship } => d.sides[ship].rail_vents += 1,
                Event::Overcharged { ship, burned } => {
                    d.sides[ship].overcharges += 1;
                    if burned { d.sides[ship].overcharge_burns += 1; }
                }
                Event::BlackedOut { ship, crew } => {
                    d.sides[ship].blackouts += 1;
                    d.sides[ship].blackout_log.push(format!("{}@{:.0}g:{}", modes[ship], gs[ship], w.ships[ship].crew[crew].station.name()));
                }
                _ => {}
            }
        }
    }
    for sd in d.sides.iter_mut() {
        for x in sd.shots.iter_mut() {
            x.target_lateral = x.lat_sum / x.lat_n.max(1) as f64;
            if x.closest == f64::MAX { x.closest = -1.0; }
        }
    }
    d.winner = w.winner;
    d.health.push([health_index(&w.ships[0]), health_index(&w.ships[1])]);
    // Finishing cause: what last hurt the loser (or how the fight ended without a kill).
    let loser = match w.winner { Some(x) => Some(1 - x), None => None };
    d.finish_cause = match (w.end_reason, loser) {
        ("time", _) | ("broke off", _) => w.end_reason.to_string(),
        (_, Some(l)) => last_cause[l].to_string(),
        (_, None) => format!("mutual {}", last_cause[0]),
    };
    d.finish_last10 = match (w.end_reason, loser) {
        ("time", _) | ("broke off", _) => w.end_reason.to_string(),
        (_, Some(l)) => finisher(&recent[l], w.t).unwrap_or(last_cause[l]).to_string(),
        (_, None) => format!("mutual {}", finisher(&recent[0], w.t).unwrap_or(last_cause[0])),
    };
    // Lead changes after first damage (with a small deadband so noise doesn't count).
    let mut lead = 0i32;
    for h in &d.health {
        let diff = h[0] - h[1];
        let now = if diff > 0.03 { 1 } else if diff < -0.03 { -1 } else { lead };
        if now != lead && lead != 0 {
            d.lead_changes += 1;
        }
        if let Some(wi) = w.winner {
            let behind = if wi == 0 { diff < -0.03 } else { diff > 0.03 };
            d.winner_trailed |= behind;
        }
        lead = now;
    }
    d.reason = if w.finished { w.end_reason.into() } else { "unfinished".into() };
    d.duration = w.t;
    for i in 0..2 {
        let s = &w.ships[i];
        let sd = &mut d.sides[i];
        sd.final_hull = s.hull;
        sd.final_parts_mean = s.parts.iter().sum::<f64>() / s.parts.len() as f64;
        sd.crew_alive = s.crew.iter().filter(|c| c.alive()).count() as u32;
        sd.torps_left = s.torpedoes;
        sd.pdc_ammo_left = s.pdcs.iter().map(|p| p.ammo).sum();
        sd.pdc_mounts_left = (0..PDC_MOUNTS).filter(|&m| s.part(crate::ship::Part::pdc(m)) > 0.0).count() as u32;
        sd.rail_left = s.rail_ammo;
    }
    let _ = HULL;
    d
}
