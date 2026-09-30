//! The duel: two crewed ships, their torpedoes and railgun rounds, and whatever rocks share the
//! space. Fixed timestep, deterministic for a given seed.
use crate::params::*;
use crate::ship::*;
use sk_sim::math::{Quat, Rng, Vec3};

/// What a ship's crew asks for this step.
#[derive(Clone, Copy, Debug, Default)]
pub struct Input {
    /// Main drive, in g along the nose (0..DRIVE_MAX_G).
    pub thrust_g: f64,
    /// RCS translation per body axis, -1..1.
    pub strafe: Vec3,
    /// Desired body rotation rates (rad/s): x pitch, y yaw, z roll.
    pub rate: Vec3,
    pub fire_torpedo: bool,
    /// How many torpedoes to send (1..tubes; 0 = as many as are loaded), and the gap between
    /// launches (s; 0 = all at once, a ripple otherwise).
    pub torp_count: u32,
    pub torp_ripple: f64,
    /// Charge the railgun (hold); fire when charged.
    pub charge_rail: bool,
    pub fire_rail: bool,
    /// Charge with the safeties off (see RAIL_OVERCHARGE_*).
    pub overcharge: bool,
    /// Point defence holds fire on the enemy ship (saving ammunition for torpedoes).
    pub pdc_hold: bool,
}

#[derive(Clone, Debug)]
pub struct Torpedo {
    pub id: u32,
    pub owner: usize,
    pub pos: Vec3,
    pub vel: Vec3,
    pub dv: f64,
    pub acc: Vec3,
    /// This torpedo's approach axis offset (world, perpendicular to the launch line of sight).
    pub bias: Vec3,
    pub born: f64,
    pub alive: bool,
}

/// What's left of a torpedo the PDCs broke up: a spreading cloud on the torpedo's old course.
#[derive(Clone, Debug)]
pub struct Debris {
    pub id: u32,
    /// The ship it was aimed at.
    pub target: usize,
    pub pos: Vec3,
    pub vel: Vec3,
    /// Distance travelled since the break-up (sets the spread).
    pub travelled: f64,
    pub alive: bool,
}

#[derive(Clone, Debug)]
pub struct Slug {
    pub id: u32,
    pub owner: usize,
    /// Damage multiplier (overcharged rounds hit harder).
    pub power: f64,
    pub pos: Vec3,
    pub vel: Vec3,
    pub born: f64,
    pub alive: bool,
}

#[derive(Clone, Debug)]
pub struct Rock {
    pub pos: Vec3,
    pub radius: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    TorpedoLaunched { ship: usize, id: u32 },
    TorpedoDown { id: u32, by: usize, mount: usize, range: f64 },
    TorpedoHit { id: u32, victim: usize, pos: Vec3 },
    /// A broken-up torpedo's debris reached its target; `share` of the cloud struck it.
    DebrisHit { id: u32, victim: usize, share: f64, pos: Vec3 },
    RailFired { ship: usize, id: u32 },
    /// A held charge ran out the capacitors' limit and was dumped.
    RailVented { ship: usize },
    /// An overcharged shot; `burned` if it cooked the ship's own gun and reactor.
    Overcharged { ship: usize, burned: bool },
    RailHit { id: u32, victim: usize, pos: Vec3 },
    PdcHitShip { victim: usize, pos: Vec3 },
    Ram { speed: f64 },
    PartDestroyed { ship: usize, part: Part },
    Repaired { ship: usize, part: Part },
    CrewKilled { ship: usize, crew: usize, by_g: bool },
    /// Any damage: its cause (railgun, torpedo, pdc, ram, rock), hull lost, total component
    /// health lost (1.0 = one part's worth), crew killed.
    Damage { ship: usize, cause: &'static str, hull: f64, parts: f64, crew: u32 },
    BlackedOut { ship: usize, crew: usize },
    End { winner: Option<usize>, reason: &'static str },
}

pub struct World {
    pub ships: [Ship; 2],
    pub inputs: [Input; 2],
    pub torps: Vec<Torpedo>,
    pub debris: Vec<Debris>,
    pub slugs: Vec<Slug>,
    pub rocks: Vec<Rock>,
    pub t: f64,
    pub tick: u64,
    pub events: Vec<Event>,
    pub finished: bool,
    pub winner: Option<usize>,
    pub end_reason: &'static str,
    pub rng: Rng,
    /// The disengagement rule is on (off only in tests).
    pub bounded: bool,
    /// Fire-control dispersion on (tests of pure geometry turn it off).
    pub rail_scatter: bool,
    /// Seconds the ships have been beyond DISENGAGE_RANGE (0 when inside).
    pub disengage: f64,
    /// Each ship's recent burning away from the other (m/s, decaying over DISENGAGE_MEMORY).
    pub opening: [f64; 2],
    next_id: u32,
}

/// Fraction along p0→p1 where the segment first enters the sphere (c, r), if it does.
pub fn segment_sphere(p0: Vec3, p1: Vec3, c: Vec3, r: f64) -> Option<f64> {
    let d = p1 - p0;
    let f = p0 - c;
    let a = d.len_sq();
    if a < 1e-12 {
        return if f.len() <= r { Some(0.0) } else { None };
    }
    let b = 2.0 * f.dot(d);
    let cc = f.len_sq() - r * r;
    if cc <= 0.0 {
        return Some(0.0);
    }
    let disc = b * b - 4.0 * a * cc;
    if disc < 0.0 {
        return None;
    }
    let s = (-b - disc.sqrt()) / (2.0 * a);
    (0.0..=1.0).contains(&s).then_some(s)
}

impl World {
    /// Two ships 8–10 km apart, noses roughly toward each other, drifting slowly, with a few
    /// rocks between them.
    pub fn new(seed: u64) -> World {
        World::with_classes(seed, [STANDARD, STANDARD])
    }

    pub fn with_classes(seed: u64, classes: [ShipClass; 2]) -> World {
        let mut rng = Rng::new(seed);
        let sep = rng.range(START_SEPARATION.0, START_SEPARATION.1);
        let axis = rng.unit_vec();
        let mk = |side: usize, rng: &mut Rng| {
            let pos = axis * (if side == 0 { -0.5 } else { 0.5 } * sep);
            let face = (-pos).normalized();
            let jitter = rng.unit_vec() * 0.25;
            let vel = rng.unit_vec() * rng.range(0.0, 40.0);
            Ship::new(side, classes[side], pos, vel, Quat::from_to(Vec3::Z, (face + jitter).normalized()), rng)
        };
        let a = mk(0, &mut rng);
        let b = mk(1, &mut rng);
        let mut rocks = Vec::new();
        for _ in 0..rng.range(3.0, 9.0) as usize {
            let along = rng.range(-0.35, 0.35) * sep;
            let off = rng.unit_vec() * rng.range(300.0, 2500.0);
            rocks.push(Rock { pos: axis * along + off, radius: rng.range(30.0, 140.0) });
        }
        World { ships: [a, b], inputs: [Input::default(); 2], torps: Vec::new(), debris: Vec::new(), slugs: Vec::new(), rocks, t: 0.0, tick: 0, events: Vec::new(), finished: false, winner: None, end_reason: "", rng, bounded: true, rail_scatter: true, disengage: 0.0, opening: [0.0; 2], next_id: 1 }
    }

    fn id(&mut self) -> u32 {
        self.next_id += 1;
        self.next_id
    }

    pub fn step(&mut self) {
        if self.finished {
            return;
        }
        let dt = DT;
        // Weapons first: a trigger pulled acts on the ship as the crew saw it, before this
        // step's turn moves the nose.
        for i in 0..2 {
            self.weapons(i, dt);
        }
        for i in 0..2 {
            self.fly(i, dt);
        }
        self.guide_torpedoes(dt);
        for i in 0..2 {
            self.point_defence(i, dt);
        }
        self.move_slugs(dt);
        self.move_debris(dt);
        for s in self.ships.iter_mut() {
            s.pos += s.vel * dt;
        }
        self.collisions();
        for i in 0..2 {
            self.repair(i, dt);
        }
        self.t += dt;
        self.tick += 1;
        self.check_end();
    }

    /// Flight: rotation (limited by working RCS clusters), translation, the drive; then the
    /// crew's bodies pay for the acceleration.
    fn fly(&mut self, i: usize, dt: f64) {
        let inp = self.inputs[i];
        let s = &mut self.ships[i];
        if !s.alive {
            s.g = 0.0;
            return;
        }
        let powered = s.powered();
        let pilot = s.crew_at(Station::Pilot).clone();
        let mut inp = inp;
        // A blacked-out pilot's hands come off the controls: the flight computer holds course at
        // a survivable burn. With no pilot, it flies within what the crew can take.
        if pilot.state == CrewState::BlackedOut {
            inp.thrust_g = inp.thrust_g.min(3.0);
            inp.strafe = Vec3::ZERO;
            inp.rate = Vec3::ZERO;
        } else if pilot.state == CrewState::Dead {
            inp.thrust_g = inp.thrust_g.min(4.0);
        }
        let (bp, bs, sp, ss) = (s.part(Part::RcsBowPort), s.part(Part::RcsBowStbd), s.part(Part::RcsSternPort), s.part(Part::RcsSternStbd));
        let drive_health = s.part(Part::Drive);
        let all = (bp + bs + sp + ss) / 4.0 * if powered { 1.0 } else { 0.0 };
        // Yaw to starboard pushes the bow with the port-bow and stern-starboard clusters.
        let yaw_pos = (bp + ss) / 2.0;
        let yaw_neg = (bs + sp) / 2.0;
        let mut want = inp.rate;
        let (max_rate, rot_accel, rcs_accel) = (s.class.max_rate, s.class.rot_accel, s.class.rcs_accel);
        let lim = |x: f64, f: f64| x.clamp(-max_rate * f, max_rate * f);
        want.x = lim(want.x, all);
        want.z = lim(want.z, all);
        want.y = want.y.clamp(-max_rate * yaw_neg * powered as u8 as f64, max_rate * yaw_pos * powered as u8 as f64);
        let step = |cur: f64, target: f64, f: f64| cur + (target - cur).clamp(-rot_accel * f * dt, rot_accel * f * dt);
        s.rate.x = step(s.rate.x, want.x, all);
        s.rate.z = step(s.rate.z, want.z, all);
        let yf = if want.y > s.rate.y { yaw_pos } else { yaw_neg } * powered as u8 as f64;
        s.rate.y = step(s.rate.y, want.y, yf);
        s.orient = s.orient.integrate(s.orient.rotate(s.rate), dt);
        let drive = if powered { drive_health } else { 0.0 };
        let thrust = inp.thrust_g.clamp(0.0, DRIVE_MAX_G * drive) * G;
        // The thrusters have one total budget: a diagonal command gets no more than a straight one.
        let sv = if inp.strafe.len() > 1.0 { inp.strafe.normalized_or(Vec3::ZERO) } else { inp.strafe };
        let strafe = sv * (rcs_accel * all);
        let a = s.orient.rotate(Vec3::Z * thrust + strafe);
        s.vel += a * dt;
        s.accel = a;
        s.accel_avg += (a - s.accel_avg) * (dt / 1.0);
        s.g = a.len() / G;
        let (killed, out) = s.endure_g(dt, &mut self.rng);
        for k in killed {
            self.events.push(Event::CrewKilled { ship: i, crew: k, by_g: true });
        }
        for k in out {
            self.events.push(Event::BlackedOut { ship: i, crew: k });
        }
    }

    /// Torpedo launches and the railgun.
    fn weapons(&mut self, i: usize, dt: f64) {
        let inp = self.inputs[i];
        let (gunner_eff, powered) = {
            let s = &self.ships[i];
            (s.crew_at(Station::Gunner).efficiency(), s.powered())
        };
        // Without a working gunner the fire-control computer is slower (half speed).
        let pace = if gunner_eff > 0.0 { gunner_eff } else { 0.5 };
        let s = &mut self.ships[i];
        if !s.alive {
            return;
        }
        for tube in s.tubes.iter_mut() {
            *tube = (*tube - dt * pace).max(0.0);
        }
        s.rail_cooldown = (s.rail_cooldown - dt).max(0.0);
        let ready = s.tubes.iter().filter(|&&r| r <= 0.0).count() as u32;
        s.torp_reload = s.tubes.iter().cloned().fold(f64::MAX, f64::min);
        // A salvo: n loaded tubes, all at once or rippled; each tube then reloads on its own.
        if inp.fire_torpedo && s.launch_queue.is_empty() && s.torpedoes > 0 && ready > 0 && s.part(Part::Launcher) > 0.0 && powered {
            let want = if inp.torp_count == 0 { ready } else { inp.torp_count };
            let n = want.min(ready).min(s.torpedoes);
            s.torpedoes -= n;
            let mut left = n;
            for tube in s.tubes.iter_mut() {
                if left > 0 && *tube <= 0.0 { *tube = s.class.torp_reload; left -= 1; }
            }
            let turn = self.rng.f64() * std::f64::consts::TAU;
            let gap = inp.torp_ripple.max(0.0);
            let s = &mut self.ships[i];
            for k in 0..n {
                s.launch_queue.push((self.t + k as f64 * gap, k, n, turn));
            }
        }
        // Launch what's due (a ripple leaves from wherever the ship is at the moment).
        let s = &self.ships[i];
        if !s.launch_queue.is_empty() {
            if s.part(Part::Launcher) <= 0.0 || !powered {
                // Launcher lost mid-ripple: the rest stay in the magazine.
                let back = s.launch_queue.len() as u32;
                let s = &mut self.ships[i];
                s.torpedoes += back;
                s.launch_queue.clear();
            } else {
                let now = self.t;
                let due: Vec<(f64, u32, u32, f64)> = s.launch_queue.iter().cloned().filter(|q| q.0 <= now + 1e-9).collect();
                self.ships[i].launch_queue.retain(|q| q.0 > now + 1e-9);
                for (_, k, n, turn) in due {
                    let s = &self.ships[i];
                    let (pos, vel, fwd) = (s.to_world(Part::Launcher.pos()), s.vel, s.forward());
                    let los = (self.ships[1 - i].pos - pos).normalized_or(fwd);
                    let (a, b) = (los.any_perp(), los.cross(los.any_perp()));
                    let ang = turn + k as f64 * std::f64::consts::TAU / n as f64;
                    let side = a * ang.cos() + b * ang.sin();
                    let bias = if n > 1 { side * TORP_SPREAD } else { Vec3::ZERO };
                    let id = self.id();
                    let v = vel + (fwd + side * 0.3).normalized() * TORP_EJECT;
                    self.torps.push(Torpedo { id, owner: i, pos, vel: v, dv: TORP_DV, acc: Vec3::ZERO, bias, born: self.t, alive: true });
                    self.events.push(Event::TorpedoLaunched { ship: i, id });
                }
            }
        }
        let s = &mut self.ships[i];
        let rail = s.part(Part::Railgun);
        if rail > 0.0 && powered && s.rail_cooldown <= 0.0 && s.rail_ammo > 0 {
            if inp.charge_rail || s.rail_charge >= 1.0 {
                let over = if inp.overcharge { RAIL_OVERCHARGE_RATE } else { 1.0 };
                if inp.overcharge && inp.charge_rail && s.rail_charge < 1.0 {
                    s.rail_overcharged = true;
                }
                s.rail_charge = (s.rail_charge + dt * pace * rail * over / s.class.rail_charge).min(1.0);
            } else {
                s.rail_charge = (s.rail_charge - dt / s.class.rail_charge).max(0.0);
            }
            if s.rail_charge >= 1.0 {
                s.rail_held += dt;
            }
            if s.rail_held > RAIL_HOLD && !inp.fire_rail {
                s.rail_charge = 0.0;
                s.rail_held = 0.0;
                s.rail_overcharged = false;
                s.rail_cooldown = RAIL_VENT_COOLDOWN;
                self.events.push(Event::RailVented { ship: i });
            } else if inp.fire_rail && s.rail_charge >= 1.0 {
                s.rail_charge = 0.0;
                s.rail_held = 0.0;
                s.rail_cooldown = s.class.rail_cooldown;
                s.rail_ammo -= 1;
                // (The round leaves along the nose, scattered by fire-control dispersion.)
                let sigma = if self.rail_scatter { s.rail_sigma() } else { 0.0 };
                let f = s.forward();
                let (u, v) = (f.any_perp(), f.cross(f.any_perp()));
                // (Box–Muller: two independent normals.)
                let (ra, rb) = (self.rng.f64().max(1e-12), self.rng.f64());
                let rr = (-2.0 * ra.ln()).sqrt();
                let (g1, g2) = (rr * (std::f64::consts::TAU * rb).cos(), rr * (std::f64::consts::TAU * rb).sin());
                let s = &mut self.ships[i];
                let dir = (f + u * (g1 * sigma) + v * (g2 * sigma)).normalized_or(f);
                let (pos, vel) = (s.to_world(Vec3::Z * (s.class.radius + 1.0)), s.vel + dir * RAIL_SPEED);
                let power = if s.rail_overcharged { RAIL_OVERCHARGE_POWER } else { 1.0 };
                let was_over = s.rail_overcharged;
                s.rail_overcharged = false;
                let id = self.id();
                self.slugs.push(Slug { id, owner: i, power, pos, vel, born: self.t, alive: true });
                self.events.push(Event::RailFired { ship: i, id });
                if was_over {
                    let burned = self.rng.f64() < RAIL_OVERCHARGE_RISK;
                    self.events.push(Event::Overcharged { ship: i, burned });
                    if burned {
                        let before = self.ships[i].parts;
                        let s = &mut self.ships[i];
                        let (g, r) = (PARTS.iter().position(|&p| p == Part::Railgun).unwrap(), PARTS.iter().position(|&p| p == Part::Reactor).unwrap());
                        s.parts[g] = (s.parts[g] - RAIL_OVERCHARGE_BURN.0).max(0.0);
                        s.parts[r] = (s.parts[r] - RAIL_OVERCHARGE_BURN.1).max(0.0);
                        self.after_damage(i, before, Vec::new(), 0.0, "overcharge");
                    }
                }
            }
        } else if rail <= 0.0 || !powered {
            s.rail_charge = 0.0;
            s.rail_held = 0.0;
        }
    }

    /// Proportional navigation with a steering lag and a delta-v budget; fuze on proximity.
    fn guide_torpedoes(&mut self, dt: f64) {
        for k in 0..self.torps.len() {
            if !self.torps[k].alive {
                continue;
            }
            let tg = 1 - self.torps[k].owner;
            let (tp, tv, talive, trad) = (self.ships[tg].pos, self.ships[tg].vel, self.ships[tg].alive, self.ships[tg].class.radius);
            let t = &mut self.torps[k];
            // Steer for the approach axis until the last stretch, then for the ship itself.
            let range = (tp - t.pos).len();
            let w = ((range - TORP_CONVERGE.0) / (TORP_CONVERGE.1 - TORP_CONVERGE.0)).clamp(0.0, 1.0);
            let r = tp + t.bias * w - t.pos;
            let v = tv - t.vel;
            let rl = r.len().max(1e-3);
            let rh = r / rl;
            let vc = -v.dot(rh);
            let mut cmd = Vec3::ZERO;
            if talive && t.dv > 0.0 {
                let omega = r.cross(v) / (rl * rl);
                cmd = omega.cross(rh) * (TORP_PN * vc.max(50.0)) + rh * TORP_ACCEL;
                if cmd.len() > TORP_ACCEL {
                    cmd = cmd * (TORP_ACCEL / cmd.len());
                }
            }
            t.acc += (cmd - t.acc) * (dt / TORP_LAG).min(1.0);
            let used = (t.acc.len() * dt).min(t.dv);
            if t.acc.len() * dt > 0.0 {
                t.vel += t.acc * (used / (t.acc.len() * dt).max(1e-12)) * dt;
            }
            t.dv -= used;
            let p0 = t.pos;
            t.pos += t.vel * dt;
            let p1 = t.pos;
            let (id, born) = (t.id, t.born);
            if self.t - born > TORP_LIFE {
                self.torps[k].alive = false;
                continue;
            }
            // Rocks stop torpedoes.
            if self.rocks.iter().any(|rk| segment_sphere(p0, p1, rk.pos, rk.radius).is_some()) {
                self.torps[k].alive = false;
                continue;
            }
            if talive && self.t - born > TORP_ARM {
                // Closest approach within this step.
                let rel0 = p0 - tp;
                let rel1 = p1 - (tp + tv * dt);
                let d = rel1 - rel0;
                let s = (-rel0.dot(d) / d.len_sq().max(1e-12)).clamp(0.0, 1.0);
                let gap = (rel0 + d * s).len() - trad;
                if gap < TORP_FUZE && s < 1.0 {
                    let at = p0 + (p1 - p0) * s;
                    self.torps[k].alive = false;
                    self.events.push(Event::TorpedoHit { id, victim: tg, pos: at });
                    // The warhead: hull damage, and a blast into the ship from the near side.
                    let ship = &self.ships[tg];
                    let entry = ship.pos + (at - ship.pos).normalized_or(Vec3::Z) * (trad * 0.8);
                    let f = 1.0 - 0.5 * (gap.max(0.0) / TORP_FUZE);
                    self.damage(tg, entry, TORP_BLAST.0 * f, TORP_BLAST.1, TORP_HULL * f, "torpedo");
                }
            }
        }
        self.torps.retain(|t| t.alive);
    }

    /// Point defence: each working mount engages the most urgent torpedo in its arc (or, with
    /// nothing inbound, the enemy ship at close range).
    fn point_defence(&mut self, i: usize, dt: f64) {
        let e = 1 - i;
        let (pos, vel, orient, powered, alive) = {
            let s = &self.ships[i];
            (s.pos, s.vel, s.orient, s.powered(), s.alive)
        };
        for p in self.ships[i].pdcs.iter_mut() {
            p.target = None;
            p.at_ship = false;
        }
        if !alive || !powered {
            return;
        }
        // Threats: enemy torpedoes in range, soonest first.
        let mut threats: Vec<(f64, usize)> = self
            .torps
            .iter()
            .enumerate()
            .filter(|(_, t)| t.alive && t.owner == e && (t.pos - pos).len() < PDC_RANGE)
            .map(|(k, t)| {
                let rel = t.pos - pos;
                let closing = -(t.vel - vel).dot(rel.normalized_or(Vec3::Z));
                (if closing > 1.0 { rel.len() / closing } else { 1e9 }, k)
            })
            .collect();
        threats.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        let mut taken: Vec<usize> = Vec::new();
        for m in 0..PDC_MOUNTS {
            let health = self.ships[i].part(Part::pdc(m));
            let mount = &self.ships[i].pdcs[m];
            if health <= 0.0 || mount.ammo <= 0.0 || mount.overheated {
                let mm = &mut self.ships[i].pdcs[m];
                mm.heat = (mm.heat - PDC_COOL * dt).max(0.0);
                if mm.overheated && mm.heat < 0.5 {
                    mm.overheated = false;
                }
                continue;
            }
            let normal = orient.rotate(pdc_normal(m));
            let in_arc = |p: Vec3| (p - pos).normalized_or(Vec3::Z).dot(normal) > PDC_ARC_COS;
            let pick = threats.iter().find(|(_, k)| !taken.contains(k) && in_arc(self.torps[*k].pos)).or_else(|| threats.iter().find(|(_, k)| in_arc(self.torps[*k].pos))).map(|x| x.1);
            let mut fired = false;
            if let Some(k) = pick {
                taken.push(k);
                fired = true;
                let r = (self.torps[k].pos - pos).len();
                let hazard = PDC_KILL_RATE * self.ships[i].class.pdc_rate * health / (1.0 + (r / PDC_FALLOFF).powi(2));
                let tid = self.torps[k].id;
                self.ships[i].pdcs[m].target = Some(tid);
                if self.rng.f64() < 1.0 - (-hazard * dt).exp() {
                    let at = self.torps[k].pos;
                    self.torps[k].alive = false;
                    self.events.push(Event::TorpedoDown { id: tid, by: i, mount: m, range: r });
                    // Broken up, not deleted: the debris carries on along its course.
                    let tv = self.torps[k].vel;
                    self.debris.push(Debris { id: tid, target: i, pos: at, vel: tv, travelled: 0.0, alive: true });
                }
            } else {
                // Nothing inbound in this arc: the enemy ship, if close and in the arc.
                let (ep, ealive, eacc) = (self.ships[e].pos, self.ships[e].alive, self.ships[e].accel);
                let r = (ep - pos).len();
                if ealive && r < PDC_SHIP_RANGE && in_arc(ep) && !self.inputs[i].pdc_hold {
                    fired = true;
                    self.ships[i].pdcs[m].at_ship = true;
                    // Erratic manoeuvring (acceleration across the line of fire) spoils the aim.
                    let los = (ep - pos).normalized_or(Vec3::Z);
                    let jink = (eacc - los * eacc.dot(los)).len();
                    let rate = PDC_SHIP_RATE * self.ships[i].class.pdc_rate * health / (1.0 + (r / PDC_SHIP_FALLOFF).powi(2)) / (1.0 + jink / 15.0);
                    if self.rng.f64() < 1.0 - (-rate * dt).exp() {
                        let er = self.ships[e].class.radius;
                        let jitter = self.rng.unit_vec() * (er * 0.6);
                        let at = ep + ((pos - ep).normalized_or(Vec3::Z) * er + jitter).normalized_or(Vec3::Z) * (er * 0.85);
                        self.events.push(Event::PdcHitShip { victim: e, pos: at });
                        self.damage(e, at, PDC_SHIP_HIT.0, PDC_SHIP_HIT.1, PDC_SHIP_HULL, "pdc");
                        // Some rounds get inside: a line from the hit in toward the spine.
                        if pdc_pen_p() > 0.0 && self.ships[e].alive && self.rng.f64() < pdc_pen_p() {
                            let inward = (ep - at).normalized_or(Vec3::Z);
                            let depth = self.ships[e].class.radius * (0.9 + 0.5 * self.rng.f64());
                            let end = at + (inward + self.rng.unit_vec() * 0.35).normalized_or(inward) * depth;
                            self.pen_line(e, at, end, pdc_pen_dmg(), PDC_PEN_R, "pdc");
                        }
                    }
                }
            }
            let mm = &mut self.ships[i].pdcs[m];
            if fired {
                mm.ammo = (mm.ammo - dt).max(0.0);
                mm.heat += PDC_HEAT * dt;
                if mm.heat >= 1.0 {
                    mm.overheated = true;
                }
            } else {
                mm.heat = (mm.heat - PDC_COOL * dt).max(0.0);
            }
        }
        self.torps.retain(|t| t.alive);
    }

    /// Railgun rounds: fast, straight; through whatever they meet.
    /// Debris clouds fly on; when one passes its target, the target takes the share of the
    /// cloud that its cross-section intercepts.
    fn move_debris(&mut self, dt: f64) {
        for k in 0..self.debris.len() {
            let (tg, p0, v) = (self.debris[k].target, self.debris[k].pos, self.debris[k].vel);
            let p1 = p0 + v * dt;
            self.debris[k].pos = p1;
            self.debris[k].travelled += (v * dt).len();
            let s = &self.ships[tg];
            let rel_v = v - s.vel;
            let rel = p1 - s.pos;
            // Passed the ship (or given up): settle it now.
            if rel.dot(rel_v) >= 0.0 || self.debris[k].travelled > 20000.0 {
                self.debris[k].alive = false;
                if !s.alive || rel.dot(rel_v) < 0.0 {
                    continue;
                }
                let miss = (rel - rel_v.normalized_or(Vec3::Z) * rel.dot(rel_v.normalized_or(Vec3::Z))).len();
                let sigma = DEBRIS_SPREAD * self.debris[k].travelled + 2.0;
                let r2 = s.class.radius * s.class.radius;
                let share = (r2 / (r2 + 2.0 * sigma * sigma)) * (-(miss * miss) / (2.0 * sigma * sigma + r2)).exp();
                if share > 0.01 {
                    let id = self.debris[k].id;
                    let entry = s.pos + (-rel_v).normalized_or(Vec3::Z) * (s.class.radius * 0.8);
                    self.events.push(Event::DebrisHit { id, victim: tg, share, pos: entry });
                    let f = DEBRIS_WEIGHT * share;
                    self.damage(tg, entry, TORP_BLAST.0 * f, TORP_BLAST.1, TORP_HULL * f, "torpedo");
                }
            }
        }
        self.debris.retain(|d| d.alive);
    }

    fn move_slugs(&mut self, dt: f64) {
        for k in 0..self.slugs.len() {
            if !self.slugs[k].alive {
                continue;
            }
            let (p0, v, owner, sid, power) = (self.slugs[k].pos, self.slugs[k].vel, self.slugs[k].owner, self.slugs[k].id, self.slugs[k].power);
            let p1 = p0 + v * dt;
            self.slugs[k].pos = p1;
            if self.t - self.slugs[k].born > 5.0 || self.rocks.iter().any(|rk| segment_sphere(p0, p1, rk.pos, rk.radius).is_some()) {
                self.slugs[k].alive = false;
                continue;
            }
            let tg = 1 - owner;
            let s = &self.ships[tg];
            if !s.alive {
                continue;
            }
            // In the target's frame over this step.
            let (a, b) = (p0 - s.pos, p1 - (s.pos + s.vel * dt));
            if let Some(f) = segment_sphere(a, b, Vec3::ZERO, s.class.radius) {
                self.slugs[k].alive = false;
                let entry = s.pos + a + (b - a) * f;
                let dir = (b - a).normalized_or(Vec3::Z);
                let exit = entry + dir * (2.0 * s.class.radius);
                self.events.push(Event::RailHit { id: sid, victim: tg, pos: entry });
                self.hit_line(tg, entry, exit, power, owner);
            }
        }
        self.slugs.retain(|s| s.alive);
    }

    fn collisions(&mut self) {
        let (a, b) = (&self.ships[0], &self.ships[1]);
        if a.alive && b.alive && (a.pos - b.pos).len() < a.class.radius + b.class.radius {
            let n = (b.pos - a.pos).normalized_or(Vec3::X);
            let rel = (a.vel - b.vel).dot(n);
            if rel > 0.0 {
                let mid = (a.pos + b.pos) * 0.5;
                self.events.push(Event::Ram { speed: rel });
                // Striking prow-first into the other's flank: the rammer's nose takes the blow
                // along its length, the rammed ship across its side (half and one and a half).
                // Head-on (both prows) or glancing, it's even.
                let prow = [a.forward().dot(n) > 0.8, b.forward().dot(-n) > 0.8];
                let k = match prow { [true, false] => [0.5, 1.5], [false, true] => [1.5, 0.5], _ => [1.0, 1.0] };
                self.damage(0, mid, rel * 2.0 * k[0], 10.0, rel * 2.0 * k[0], "ram");
                self.damage(1, mid, rel * 2.0 * k[1], 10.0, rel * 2.0 * k[1], "ram");
                self.ships[0].vel -= n * rel;
                self.ships[1].vel += n * rel;
            }
        }
        for i in 0..2 {
            let s = &self.ships[i];
            if !s.alive {
                continue;
            }
            if let Some(rk) = self.rocks.iter().find(|rk| (rk.pos - s.pos).len() < rk.radius + s.class.radius).cloned() {
                let n = (s.pos - rk.pos).normalized_or(Vec3::X);
                let into = -s.vel.dot(n);
                if into > 0.0 {
                    let at = s.pos - n * s.class.radius;
                    self.damage(i, at, into * 3.0, 12.0, into * 3.0, "rock");
                    self.ships[i].vel += n * (into * 1.5);
                }
            }
        }
    }

    /// The engineer patches the most important broken part, one at a time, when the g allows.
    fn repair(&mut self, i: usize, dt: f64) {
        let s = &mut self.ships[i];
        let eng = s.crew_at(Station::Engineer).efficiency();
        // Repairs go on at any g, as long as the engineer is alive and conscious.
        if !s.alive || eng <= 0.0 {
            return;
        }
        // Priority: power, then drive, guns, thrusters. Anything nearly gone first.
        let order = [Part::Reactor, Part::Drive, Part::Railgun, Part::Pdc0, Part::Pdc1, Part::Pdc2, Part::Launcher, Part::RcsBowPort, Part::RcsBowStbd, Part::RcsSternPort, Part::RcsSternStbd, Part::Sensors];
        if s.repair.is_none() {
            let pick = order.iter().find(|&&p| s.part(p) < 0.25).or_else(|| order.iter().find(|&&p| s.part(p) < REPAIR_CEILING - 0.01));
            if let Some(p) = pick {
                s.repair = Some((PARTS.iter().position(|x| x == p).unwrap(), 0.0));
            }
        }
        if let Some((k, prog)) = s.repair {
            if s.parts[k] <= 0.0 {
                // Destroyed: rebuild before it works at all.
                let prog = prog + dt * eng;
                if prog >= REPAIR_TIME {
                    s.parts[k] = REPAIR_RESTORED;
                    s.repair = None;
                    self.events.push(Event::Repaired { ship: i, part: PARTS[k] });
                } else {
                    s.repair = Some((k, prog));
                }
            } else {
                s.parts[k] = (s.parts[k] + REPAIR_RATE * eng * dt).min(REPAIR_CEILING);
                if s.parts[k] >= REPAIR_CEILING - 1e-9 {
                    s.repair = None;
                }
            }
        }
    }

    /// Apply a blast to a ship: hull loss plus components and crew near the point.
    fn damage(&mut self, i: usize, at: Vec3, dmg: f64, reach: f64, hull: f64, cause: &'static str) {
        let before = self.ships[i].parts;
        let s = &mut self.ships[i];
        if !s.alive {
            return;
        }
        s.hull -= hull;
        let killed = s.blast(at, dmg, reach);
        self.after_damage(i, before, killed, hull, cause);
    }

    fn hit_line(&mut self, i: usize, a: Vec3, b: Vec3, power: f64, shooter: usize) {
        let (rail_hull, rail_pen) = (self.ships[shooter].class.rail_hull, self.ships[shooter].class.rail_pen);
        let before = self.ships[i].parts;
        let s = &mut self.ships[i];
        s.hull -= rail_hull * power;
        let killed = s.penetrate(a, b, rail_pen * power, RAIL_PEN.1, rail_spall());
        self.after_damage(i, before, killed, rail_hull * power, "railgun");
    }

    /// A round inside the ship along a line (no hull loss of its own).
    fn pen_line(&mut self, i: usize, a: Vec3, b: Vec3, dmg: f64, radius: f64, cause: &'static str) {
        let before = self.ships[i].parts;
        let killed = self.ships[i].penetrate(a, b, dmg, radius, 0.0);
        self.after_damage(i, before, killed, 0.0, cause);
    }

    fn after_damage(&mut self, i: usize, before: [f64; 12], killed: Vec<usize>, hull: f64, cause: &'static str) {
        let parts_lost: f64 = (0..12).map(|k| before[k] - self.ships[i].parts[k]).sum();
        self.events.push(Event::Damage { ship: i, cause, hull, parts: parts_lost, crew: killed.len() as u32 });
        for k in 0..12 {
            if before[k] > 0.0 && self.ships[i].parts[k] <= 0.0 {
                self.events.push(Event::PartDestroyed { ship: i, part: PARTS[k] });
                if self.ships[i].repair.is_some_and(|(r, _)| r == k) {
                    self.ships[i].repair = None;
                }
            }
        }
        for c in killed {
            self.events.push(Event::CrewKilled { ship: i, crew: c, by_g: false });
        }
    }

    fn check_end(&mut self) {
        let bounded = self.bounded;
        let lost = |s: &Ship| -> Option<&'static str> {
            if s.hull <= 0.0 {
                Some("destroyed")
            } else if s.crew.iter().all(|c| !c.alive()) {
                Some("crew dead")
            } else if s.part(Part::Reactor) <= 0.0 && s.repair.is_none() && !s.crew_at(Station::Engineer).working() {
                Some("dead in space")
            } else {
                None
            }
        };
        let mut l = [lost(&self.ships[0]), lost(&self.ships[1])];
        // Both disabled: neither can hurt the other any more (no weapon with ammunition, no way
        // to ram). Decided on condition, as a draw if it's close.
        if l == [None, None] && !self.ships[0].can_hurt() && !self.ships[1].can_hurt() {
            let (a, b) = (self.ships[0].health_index(), self.ships[1].health_index());
            self.finished = true;
            self.winner = if (a - b).abs() < 0.05 { None } else if a > b { Some(0) } else { Some(1) };
            self.end_reason = "both disabled";
            self.events.push(Event::End { winner: self.winner, reason: "both disabled" });
            return;
        }
        // Broken off: too far apart for too long. Whoever was burning away forfeits; if both
        // were (or neither clearly), nobody wins.
        let sep = self.ships[1].pos - self.ships[0].pos;
        let u = sep.normalized_or(Vec3::X);
        let away = [-self.ships[0].accel.dot(u), self.ships[1].accel.dot(u)];
        for i in 0..2 {
            self.opening[i] += (away[i] - self.opening[i] / DISENGAGE_MEMORY) * DT;
        }
        self.disengage = if sep.len() > DISENGAGE_RANGE { self.disengage + DT } else { 0.0 };
        if bounded && self.disengage > DISENGAGE_TIME && l == [None, None] {
            let (a, b) = (self.opening[0].max(0.0), self.opening[1].max(0.0));
            if a > 1.5 * b {
                l[0] = Some("broke off");
            } else if b > 1.5 * a {
                l[1] = Some("broke off");
            } else {
                l = [Some("broke off"), Some("broke off")];
            }
        }
        for i in 0..2 {
            if l[i].is_some() {
                self.ships[i].alive = self.ships[i].hull > 0.0 && l[i] != Some("crew dead");
            }
        }
        let (winner, reason) = match l {
            [Some(r), None] => (Some(1), r),
            [None, Some(r)] => (Some(0), r),
            [Some(r), Some(_)] => (None, r),
            [None, None] if self.t >= time_limit() => {
                let score = |s: &Ship| s.hull / s.class.hull + s.crew.iter().filter(|c| c.alive()).count() as f64 / 4.0 + s.parts.iter().sum::<f64>() / 12.0;
                let (a, b) = (score(&self.ships[0]), score(&self.ships[1]));
                (if (a - b).abs() < 0.05 { None } else if a > b { Some(0) } else { Some(1) }, "time")
            }
            _ => return,
        };
        self.finished = true;
        self.winner = winner;
        self.end_reason = reason;
        self.events.push(Event::End { winner, reason });
    }
}
