//! One steering solution combines initiative, range geometry, evasion and weapon work.
//! Modes describe the resulting flight; they never select an exclusive behavior tree branch.
use super::*;

pub(super) struct Motion {
    last_t: f64,
    next_lane: f64,
    lane: Vec3,
    nose: Vec3,
    acceleration: Vec3,
    last_enemy_charge: f64,
    last_own_charge: f64,
    enemy_fired: f64,
    own_fired: f64,
    label_until: f64,
    defensive: Option<(u32, &'static str)>,
    escape_until: f64,
    escape_direction: Vec3,
    escape_g: f64,
    rail_pending: Option<(u32, f64)>,
    aiming: bool,
    quiet_geometry: f64,
}
impl Default for Motion {
    fn default() -> Self {
        Self {
            last_t: 0.0,
            next_lane: 0.0,
            lane: Vec3::ZERO,
            nose: Vec3::ZERO,
            acceleration: Vec3::ZERO,
            last_enemy_charge: 0.0,
            last_own_charge: 0.0,
            enemy_fired: -99.0,
            own_fired: -99.0,
            label_until: 0.0,
            defensive: None,
            escape_until: 0.0,
            escape_direction: Vec3::ZERO,
            escape_g: 0.0,
            rail_pending: None,
            aiming: false,
            quiet_geometry: 0.0,
        }
    }
}
fn sat(x: f64) -> f64 {
    x.clamp(0.0, 1.0)
}
fn limited(v: Vec3, length: f64) -> Vec3 {
    if v.len() > length {
        v.normalized_or(Vec3::ZERO) * length
    } else {
        v
    }
}
fn lane_fallback(los: Vec3) -> Vec3 {
    los.any_perp()
}
fn ready_in(s: &Ship) -> f64 {
    if s.rail_ammo == 0 || s.part(Part::Railgun) <= 0.0 || !s.powered() {
        30.0
    } else {
        s.rail_cooldown + s.class.rail_charge * (1.0 - s.rail_charge)
    }
}

impl Pilot {
    pub(super) fn reference(&mut self, w: &World, me: usize, inp: &mut Input) {
        let s = &w.ships[me];
        let e = &w.ships[1 - me];
        let rel = e.pos - s.pos;
        let dist = rel.len().max(1.0);
        let los = rel / dist;
        let rv = e.vel - s.vel;
        let closing = -rv.dot(los);
        let lateral_velocity = rv + los * closing;
        let dt = (w.t - self.tactics.last_t).clamp(DT, 0.1);
        self.tactics.last_t = w.t;
        let doc = self.style.doctrine();
        let advantage = s.health_index() - e.health_index();
        let hulls = [s.hull, e.hull];
        if hulls[0] < self.last_health[0] - 1.0 || hulls[1] < self.last_health[1] - 1.0 {
            self.last_change = w.t;
            self.last_health = hulls;
        }
        let urgency = sat((w.t - self.last_change - 12.0) / 15.0) * sat((w.t - 20.0) / 15.0);
        let ours = ready_in(s);
        let theirs = ready_in(e);
        if self.tactics.last_enemy_charge > 0.8 && e.rail_charge < 0.1 {
            self.tactics.enemy_fired = w.t;
        }
        if self.tactics.last_own_charge > 0.8 && s.rail_charge < 0.1 {
            self.tactics.own_fired = w.t;
        }
        self.tactics.last_enemy_charge = e.rail_charge;
        self.tactics.last_own_charge = s.rail_charge;
        let initiative = sat((theirs - ours + 0.5) / 4.0);
        let shot_now = shot(s, e);
        let their_shot = shot(e, s);
        let enemy_open = sat((w.t - self.tactics.enemy_fired) / 0.5)
            * sat((4.0 - w.t + self.tactics.enemy_fired) / 3.0);
        let own_recovery = if w.t > 1.0 {
            sat((2.0 - w.t + self.tactics.own_fired) / 2.0)
        } else {
            0.0
        };

        // Coordinate the rail approach with our torpedoes reaching their screen, rather than
        // treating a launch as a movement mode that gives up the gun.
        let mut torp_pressure: f64 = 0.0;
        let mut danger: f64 = 0.0;
        let mut threat_bearing = los;
        let mut escape = Vec3::ZERO;
        for tp in w.torps.iter().filter(|t| t.alive) {
            let target = if tp.owner == me { e } else { s };
            let r = target.pos - tp.pos;
            let v = tp.vel - target.vel;
            let tgo = r.len() / v.dot(r.normalized_or(los)).max(1.0);
            if tp.intercept.is_some() {
                continue;
            }
            if tp.owner == me {
                torp_pressure = torp_pressure.max(sat((6.0 - tgo) / 4.0));
            } else if tgo < 5.0 && v.dot(r) > 0.0 {
                let bearing = -r.normalized_or(los);
                let cover = (0..PDC_MOUNTS)
                    .filter(|&m| {
                        s.part(Part::pdc(m)) > 0.0
                            && s.pdcs[m].ammo > 0.0
                            && !s.pdcs[m].overheated
                            && s.orient.rotate(pdc_normal(m)).dot(bearing) > PDC_ARC_COS
                    })
                    .count();
                let risk = sat((5.0 - tgo) / 3.0) * (if cover == 0 { 1.0 } else { 0.15 });
                if risk > danger {
                    danger = risk;
                    threat_bearing = bearing;
                }
                escape += bearing.cross(v).normalized_or(los.any_perp()) * risk;
            }
        }
        // A rail flash matters only if the round actually threatens our trajectory. Missed
        // rounds no longer trigger a whole scripted juke just because they are in flight.
        let mut incoming: f64 = 0.0;
        for sl in w
            .slugs
            .iter()
            .filter(|sl| sl.alive && sl.owner != me && w.t - sl.born >= s.flash_reaction())
        {
            let r = s.pos - sl.pos;
            let v = sl.vel - s.vel;
            let eta = r.dot(v) / v.len_sq().max(1.0);
            if !(0.0..2.8).contains(&eta) {
                continue;
            }
            let miss = r - v * eta;

            let predicted = miss + s.accel * (0.5 * eta * eta);
            let risk =
                sat(1.0 - predicted.len() / (2.0 * s.class.radius)) * sat(eta / s.flash_reaction());
            if risk > 0.25 {
                let side =
                    (miss - s.accel_avg * (0.5 * eta * eta)).normalized_or(self.tactics.lane);
                let side = (side - v.normalized_or(los) * side.dot(v.normalized_or(los)))
                    .normalized_or(lane_fallback(los));
                // The required displacement sets the burn, not a fixed maneuver timer. The
                // slight forward cant makes useful transverse thrust possible before a full
                // ninety-degree rotation. Stop after the round's closest approach.
                let required = 2.0 * (s.class.radius * 1.2 - predicted.len()).max(0.0)
                    / (eta * eta).max(0.001) / G;
                // Don't spend crew lives on a dodge that cannot clear the hull before
                // impact. At point blank the pilot must fight through the shot instead.
                let escape_direction = (los * 0.65 + side * 0.76).normalized_or(side);
                let turn_delay = s.forward().dot(escape_direction).clamp(-1.0,1.0).acos()
                    / s.class.max_rate.max(0.1);
                let usable = (eta - turn_delay).max(0.0);
                let reachable = 0.5 * s.rcs_accel() * eta * eta
                    + 0.5 * 20.0 * G * usable * usable;
                let need = (s.class.radius * 1.2 - predicted.len()).max(0.0);
                if reachable > need && required <= 20.0 {
                    self.tactics.escape_direction = escape_direction;
                    self.tactics.escape_g = required.clamp(10.0, 20.0);
                    self.tactics.escape_until = w.t + eta + 0.1;
                }
            }
            incoming = incoming.max(risk);
            // Change the acceleration that their fire control observed; do not always reverse
            // on every muzzle flash irrespective of the shot's actual line.
            escape +=
                (miss - s.accel_avg * (0.5 * eta * eta)).normalized_or(self.tactics.lane) * risk;
        }
        let flight = (dist / RAIL_SPEED - s.flash_reaction()).max(0.0);
        let can_evade = sat(
            (0.5 * (s.rcs_accel() + 8.0 * G) * flight * flight - s.class.radius)
                / (2.0 * s.class.radius),
        );
        let loaded_threat =
            sat((1.8 - theirs) / 1.8) * sat((their_shot.p_env - 0.18) / 0.5) * can_evade;
        let attack = sat(0.2
            + (0.3 + 0.3 * self.temper.initiative) * initiative
            + 0.25 * enemy_open
            + 0.35 * torp_pressure
            + 0.45 * urgency
            - 1.2 * advantage);
        let evade = sat(
            (loaded_threat * (0.25 + 0.2 * sat(advantage * 3.0)) + incoming + danger)
                * (1.0 - 0.65 * sat((shot_now.p_hit - 0.2) * 2.0) * sat(s.rail_charge))
                * (1.0 - 0.65 * urgency),
        );
        let launch = self.torpedo_request(w, me, inp, advantage);
        self.intent = [
            attack,
            evade.max(if w.t < self.tactics.escape_until {
                1.0
            } else {
                0.0
            }),
            torp_pressure,
            own_recovery,
        ];
        self.fire_odds = (doc.odds.min(0.4) + self.temper.odds_shift + 0.6 * advantage
            - 0.3 * initiative
            - 0.15 * torp_pressure
            - 0.25 * urgency)
            .clamp(0.12, 0.85);
        // A fast closer is committing to a predictable approach. Counterpunchers spend
        // ammunition to disrupt it before the fight enters the opponent's PDC envelope.
        if self.style == Style::Counter && closing > 80.0 && dist < 4500.0 && shot_now.p_env > 0.15 {
            self.fire_odds = self.fire_odds.min(0.3);
        }
        if urgency > 0.6 && advantage < 0.06 {
            self.fire_odds = 0.12;
        }
        self.overcharge = advantage < -0.12
            && (initiative > 0.4 || torp_pressure > 0.5)
            && shot_now.p_hit > 0.35
            && !std::env::var("OVERCHARGE").map_or(false, |v| v == "off");

        // Persistent crossing lanes compete on geometry, enemy tracking, PDC arcs and drift.
        // Changing the lane is a spatial decision, not a timed sequence of maneuver names.
        if self.tactics.lane.len_sq() < 0.1
            || w.t > self.tactics.next_lane
            || self.tactics.lane.dot(los).abs() > 0.4
        {
            let u = los.any_perp();
            let v = los.cross(u).normalized_or(Vec3::Y);
            let mut best = (f64::MIN, u);
            for k in 0..12 {
                let angle = (k as f64 / 12.0) * std::f64::consts::TAU;
                let lane = u * angle.cos() + v * angle.sin();
                let prospective = (-los + lane * 0.45).normalized_or(-los);
                let cover = (0..PDC_MOUNTS)
                    .filter(|&m| {
                        e.part(Part::pdc(m)) > 0.0
                            && e.pdcs[m].ammo > 0.0
                            && !e.pdcs[m].overheated
                            && e.orient.rotate(pdc_normal(m)).dot(prospective) > PDC_ARC_COS
                    })
                    .count() as f64;
                let carry = lane.dot(self.tactics.lane);
                let angular = lane.dot(e.orient.rotate(Vec3::X)) * self.temper.orbit_sign;
                let score = 0.25 * carry + 0.4 * angular - 0.3 * cover
                    + lane.dot(lateral_velocity) / 360.0
                    + self.rng.range(-0.25, 0.25);
                if score > best.0 {
                    best = (score, lane);
                }
            }
            self.tactics.lane = best.1;
            self.tactics.next_lane = w.t + self.rng.range(2.5, 5.5) * self.temper.rhythm;
        }
        let lane =
            (self.tactics.lane - los * self.tactics.lane.dot(los)).normalized_or(los.any_perp());
        // Request relative motion, not a distance spring. An attack carries through its
        // firing opportunity; recovery spends the opponent's reload window changing the
        // next approach. There is no preferred range at which the request vanishes.
        let readiness = sat((3.5 - ours) / 3.5);
        let enemy_readiness = sat((3.5 - theirs) / 3.5);
        let vulnerable = sat(-advantage * 3.0);
        let pressure = (0.55 * readiness + 0.3 * initiative + 0.35 * torp_pressure
            + 0.25 * enemy_open + 0.2 * vulnerable - 0.45 * danger).clamp(0.0, 1.0);
        let reload = sat((ours - 2.0) / 4.0);
        let close = sat((2200.0 - dist) / 1800.0);
        let chase = sat((dist - 4500.0) / 1800.0);
        let enemy_turning_away = sat((0.5 - e.forward().dot(-los)) / 1.5);
        let mut want_close = match self.style {
            Style::Knife => 220.0 + 300.0 * pressure + 120.0 * enemy_turning_away
                - close * (280.0 * reload + 280.0 * enemy_readiness + 160.0 * danger),
            Style::Counter => 40.0 + 420.0 * pressure + 150.0 * enemy_open
                - (140.0 + 360.0 * reload + 200.0 * enemy_readiness) * sat((3800.0-dist)/2300.0),
            _ => 150.0 + 360.0 * pressure + 120.0 * enemy_turning_away
                - close * (400.0 * reload + 240.0 * enemy_readiness + 180.0 * danger),
        };
        // Momentum is useful through a safe merge; don't brake merely because the
        // capacitor is cycling. On a separating trajectory, choose whether to chase
        // immediately or use that separation to reset a depleted attack.
        let tca = (-rel.dot(rv) / rv.len_sq().max(1.0)).clamp(0.0, 8.0);
        let miss = rel + rv * tca;
        let pass = 180.0 + 320.0 * self.temper.crossing;
        if closing > 180.0 && dist < 2400.0 && miss.len() > 100.0 {
            want_close = want_close.max(closing * (0.65 + 0.25 * pressure));
        }
        if closing < -100.0 && dist < 2400.0 && reload > 0.25 {
            want_close = want_close.min(-160.0 - 180.0 * reload);
        }
        want_close += chase * 400.0;
        if s.rail_ammo == 0 {
            want_close = if s.torpedoes > 0 && dist < 1800.0 { -260.0 }
                else { 220.0 + 200.0 * chase };
        }
        if w.t > 170.0 { want_close = want_close.max(180.0); }
        self.extending = want_close < -100.0;
        let radial = (want_close - closing) * 0.55;
        // Knife cuts across the target at close quarters; ranged doctrines move on
        // wider offsets. Neither tries to match the target's velocity at a fixed range.
        let travel = match self.style {
            Style::Knife => 100.0 + 120.0 * self.temper.crossing + 120.0 * close,
            Style::Counter => 170.0 + 140.0 * self.temper.crossing + 160.0 * evade,
            _ => 220.0 + 230.0 * self.temper.crossing + 100.0 * pressure,
        };
        let transverse = lane * travel;
        let mut desired = los * radial + (lateral_velocity - transverse) * 0.35;
        // Curvature must be paid for before radial acceleration changes separation.
        // Otherwise transverse speed creates an accidental equilibrium orbit.
        desired += los * (lateral_velocity.len_sq() / dist).min(180.0);
        if want_close > 100.0 && dist > 1500.0 {
            let intercept = (rel + rv * (dist / 700.0).min(3.0)).normalized_or(los);
            desired += (intercept - los) * radial.max(0.0);
        }
        if tca > 0.0 && tca < 3.0 && miss.len() < pass {
            desired += (-miss).normalized_or(lane) * (pass - miss.len()) / (tca*tca).max(0.25);
        }
        desired += escape * 250.0 + lane * (evade * 250.0);
        // Don't loop round an engagement forever. Far separation and stale exchanges supply
        // progressively stronger pursuit, based on the opponent's future position.
        if dist > 7500.0 {
            desired += (rel + rv * 2.0).normalized_or(los) * sat((dist - 7500.0) / 2000.0) * 35.0;
        }
        let collision =
            if tca > 0.0 && tca < 3.0 && miss.len() < 3.0 * (s.class.radius + e.class.radius) {
                sat((3.0 - tca) / 2.0)
            } else {
                0.0
            };
        desired += (-miss).normalized_or(lane) * collision * 60.0;
        // Inertial coast is a consequence of already having the right velocity, not a scripted
        // exit state. Commands blend smoothly while an imminent threat can demand faster change.
        let blend = (dt / (0.45 - 0.25 * evade)).min(1.0);
        self.tactics.acceleration += (desired - self.tactics.acceleration) * blend;
        let fatal = s.hull < TORP_HULL * 1.2 && danger > 0.7;
        let desired = if fatal {
            escape.normalized_or(lane) * 150.0
        } else {
            self.tactics.acceleration
        };
        let motion_dir = desired.normalized_or(los);
        // The spinal gun and drive cannot both point in different directions. Select the
        // useful orientation, with hysteresis, rather than averaging into a useless heading.
        // Weapons and RCS still run throughout; a drive turn can also supply a real shot.
        let angular_rate = rel.cross(rv).len() / rel.len_sq().max(1.0);
        if dist < 5500.0 && closing.abs() < 60.0 && angular_rate < 0.04 {
            self.tactics.quiet_geometry += dt;
        } else {
            self.tactics.quiet_geometry = (self.tactics.quiet_geometry - dt * 0.5).max(0.0);
        }
        let positional_pressure = sat((self.tactics.quiet_geometry - 3.0) / 5.0);
        let gun_value = sat((4.0 - ours) / 4.0) * (0.8 + 0.9 * sat(shot_now.p_env / 0.4))
            + if launch { 1.1 } else { 0.0 };
        let drive_value = (desired.len() / 55.0).min(1.35)
            + 0.7 * evade
            + 1.4 * positional_pressure
            + if self.extending { 0.3 } else { 0.0 };
        let gun_value = gun_value + if self.tactics.aiming { 0.25 } else { 0.0 };
        let drive_value = drive_value + if !self.tactics.aiming { 0.25 } else { 0.0 };
        self.tactics.aiming = gun_value > drive_value || launch;
        if dist < 1800.0 && s.rail_charge > 0.95 && incoming < 0.25 && !self.extending {
            self.tactics.aiming = true;
        }
        if ((s.rail_charge > 0.95 && s.rail_held > 0.7 && shot_now.p_env > 0.1 && incoming < 0.25)
            || w.t - self.last_change > 25.0)
            && dist < 6500.0
            && s.rail_ammo > 0
            && s.part(Part::Railgun) > 0.0
        {
            self.tactics.aiming = true;
        }
        if collision > 0.15 { self.tactics.aiming = false; }
        let aim_weight = if self.tactics.aiming { 1.0 } else { 0.0 };
        let firing_window = self.tactics.aiming && s.rail_charge > 0.98;
        let emergency = w.t < self.tactics.escape_until;
        let wanted = if emergency {
            self.tactics.escape_direction
        } else if fatal {
            motion_dir
        } else {
            (lead(s, e, RAIL_SPEED) * aim_weight + motion_dir * (1.0 - aim_weight))
                .normalized_or(los)
        };
        if self.tactics.nose.len_sq() < 0.1 {
            self.tactics.nose = s.forward();
        }
        self.tactics.nose = (self.tactics.nose
            + (wanted - self.tactics.nose) * (dt / 0.22).min(1.0))
        .normalized_or(wanted);
        let feed_forward = los.cross(lateral_velocity / dist);
        inp.rate = if aim_weight > 0.95 && !fatal && !emergency {
            track(s, e)
        } else {
            turn_toward(s, self.tactics.nose) + s.orient.inv_rotate(feed_forward) * aim_weight
        };
        // Roll toward a working PDC mount while keeping the gun's nose solution: defensive
        // screen management no longer needs to abandon an otherwise good rail shot.
        if danger > 0.05 {
            let local = s.orient.inv_rotate(threat_bearing);
            let mut best = (f64::MIN, 0.0);
            for roll in [-0.8_f64, 0.0, 0.8] {
                let rotated = Vec3::new(
                    local.x * roll.cos() + local.y * roll.sin(),
                    -local.x * roll.sin() + local.y * roll.cos(),
                    local.z,
                );
                let cover = (0..PDC_MOUNTS)
                    .filter(|&m| {
                        s.part(Part::pdc(m)) > 0.0 && s.pdcs[m].ammo > 0.0 && !s.pdcs[m].overheated
                    })
                    .map(|m| pdc_normal(m).dot(rotated))
                    .fold(-1.0, f64::max);
                let score = cover - roll.abs() * 0.08;
                if score > best.0 {
                    best = (score, roll);
                }
            }
            inp.rate.z = best.1 * danger;
        }

        let max_g = if emergency {
            self.tactics.escape_g.min(DRIVE_MAX_G)
        } else if fatal {
            12.0
        } else {
            g_budget(
                s,
                if emergency || danger > 0.65 {
                    0.5
                } else {
                    3.0
                },
            )
            .min(6.0 + 10.0 * attack + 15.0 * evade)
        };
        let forward = s.forward();
        let thrust = (desired.dot(forward) / G).clamp(0.0, max_g);
        inp.thrust_g = if fatal && forward.dot(motion_dir) > 0.5 {
            max_g
        } else {
            thrust
        };
        if emergency && forward.dot(self.tactics.escape_direction) > 0.85 {
            inp.thrust_g = max_g;
        }
        inp.strafe = limited(
            s.orient.inv_rotate(desired - forward * (thrust * G)) / s.rcs_accel().max(1.0),
            1.0,
        );
        if firing_window && s.rail_held < 0.5 && s.forward().dot(lead(s, e, RAIL_SPEED)) > 0.98 {
            // Briefly steady the rail platform while retaining its existing inertial motion.
            inp.strafe = Vec3::ZERO;
        }
        self.gun(inp, s, e);
        if (w.t - self.last_change > 25.0 || s.rail_held > RAIL_HOLD - 1.0) && dist < 6500.0 {
            inp.fire_rail = shot_now.p_hit > 0.08;
        }
        // Charging does not require already pointing at the target. That coupling stranded
        // maneuvering ships with an empty capacitor and no reason ever to turn back to aim.
        inp.charge_rail = s.rail_ammo > 0 && s.part(Part::Railgun) > 0.0 && dist < 6500.0;
        // When trailing, spend a little of the loaded gun's safe hold window to make the
        // target handle a rail shot and an arriving salvo together. Never hold into a vent.
        if advantage < -0.05 && torp_pressure > 0.2 && torp_pressure < 0.95 && s.rail_held < 2.5 {
            inp.fire_rail = false;
        }
        // A launch request only fires after the nose is on target; steering and rail fire keep
        // running. Holding a charged gun when a salvo arrives is allowed, but not mandatory.
        if launch {
            inp.fire_torpedo = s.forward().dot(los) > 0.95;
        }
        if !emergency {
            self.last_ditch_defence(w, me, inp, shot_now.p_hit);
        } else {
            self.tactics.defensive = None;
        }
        self.juke_dir = lane;
        if w.t > self.tactics.label_until {
            self.mode = if let Some((_, weapon)) = self.tactics.defensive {
                if weapon == "railgun" {
                    "rail defence"
                } else {
                    "counter torpedo"
                }
            } else if emergency {
                "juke"
            } else if danger > 0.65 {
                "torpedo break"
            } else if evade > 0.65 {
                "juke"
            } else if torp_pressure > 0.5 && attack > 0.5 {
                "pressing"
            } else if own_recovery > 0.5 && closing < 0.0 {
                "extend"
            } else if closing > 180.0 && dist < 2400.0 {
                "attack run"
            } else if closing < -80.0 {
                "opening"
            } else if s.vel.len() > 100.0 && thrust < 0.5 {
                "coasting"
            } else if transverse.len() > 70.0 && dist < 6000.0 {
                "crossing"
            } else if attack > 0.6 {
                "punish"
            } else {
                "guns"
            };
            self.tactics.label_until = w.t + 1.2;
        }
    }

    /// Spend offensive ammunition only when the normal screen is unlikely to stop a real
    /// ship-bound threat and a physical interception can still arrive in time.
    fn last_ditch_defence(&mut self, w: &World, me: usize, inp: &mut Input, attack_quality: f64) {
        let s = &w.ships[me];
        let current = self.tactics.defensive;
        let mut best: Option<(f64, u32, Vec3, f64, f64)> = None;
        for tp in w
            .torps
            .iter()
            .filter(|t| t.alive && t.owner != me && t.intercept.is_none())
        {
            if self
                .tactics
                .rail_pending
                .map_or(false, |(id, until)| id == tp.id && w.t < until)
            {
                continue;
            }
            if w.torps
                .iter()
                .any(|t| t.alive && t.owner == me && t.intercept == Some(tp.id))
            {
                continue;
            }
            let r = tp.pos - s.pos;
            let rv = tp.vel - s.vel;
            let range = r.len();
            let bearing = r.normalized_or(s.forward());
            let closing = -rv.dot(bearing);
            if closing <= 0.0 {
                continue;
            }
            let eta = range / closing.max(1.0);
            if !(0.45..6.0).contains(&eta) {
                continue;
            }
            let cover: f64 = (0..PDC_MOUNTS)
                .filter(|&m| {
                    s.part(Part::pdc(m)) > 0.0
                        && s.pdcs[m].ammo > 0.0
                        && !s.pdcs[m].overheated
                        && s.orient.rotate(pdc_normal(m)).dot(bearing) > PDC_ARC_COS
                })
                .map(|m| s.part(Part::pdc(m)) * s.pdcs[m].ammo.min(eta) / eta)
                .sum();
            let screen_success = 1.0
                - (-cover * PDC_KILL_RATE * (eta - 0.35).max(0.0)
                    / (1.0 + (range / PDC_FALLOFF).powi(2)))
                .exp();
            let threat =
                (1.0 - screen_success) * (0.45 + 2.0 * TORP_HULL / s.hull.max(TORP_HULL * 0.5));
            let score = threat
                + if current.map_or(false, |c| c.0 == tp.id) {
                    0.3
                } else {
                    0.0
                }
                - 0.08 * eta;
            if threat < 0.45 + 0.3 * attack_quality {
                continue;
            }
            let mut flight = range / RAIL_SPEED;
            for _ in 0..4 {
                flight = (r + rv * flight + tp.acc * (0.5 * flight * flight)).len() / RAIL_SPEED;
            }
            let lead = (r + rv * flight + tp.acc * (0.5 * flight * flight)).normalized_or(bearing);
            if best.map_or(true, |b| score > b.0) {
                best = Some((score, tp.id, lead, eta, flight));
            }
        }
        let Some((_, id, aim, eta, flight)) = best else {
            self.tactics.defensive = None;
            return;
        };
        let angle = s.forward().dot(aim).clamp(-1.0, 1.0).acos();
        let turn =
            (angle / s.class.max_rate.max(0.1)).max((2.0 * angle / s.rot_accel().max(0.1)).sqrt());
        let rail_possible = ready_in(s) < eta - turn - flight - 0.15
            && s.part(Part::Railgun) > 0.0
            && s.rail_ammo > 0;
        // Defensive torpedoes need arming time plus acceleration/run-up. They are most useful
        // against a depleted screen with a little warning; a point-blank launch is futile.
        let tp = w.torps.iter().find(|t| t.id == id).unwrap();
        let range = (tp.pos - s.pos).len();
        let inbound_speed = -(tp.vel - s.vel).dot((tp.pos - s.pos).normalized_or(aim));
        let torp_flight = (-inbound_speed
            + (inbound_speed * inbound_speed + 2.0 * TORP_ACCEL * range).sqrt())
            / TORP_ACCEL;
        let already_assigned = w
            .torps
            .iter()
            .any(|t| t.alive && t.owner == me && t.intercept == Some(id));
        let torp_possible = angle < 0.5
            && !already_assigned
            && s.torpedoes > 0
            && s.tubes.iter().any(|&t| t <= 0.0)
            && s.launch_queue.is_empty()
            && s.part(Part::Launcher) > 0.0
            && torp_flight > TORP_ARM + 0.15
            && torp_flight + turn + 0.3 < eta;
        let weapon = if rail_possible && (s.rail_charge > 0.6 || !torp_possible) {
            "railgun"
        } else if torp_possible {
            "torpedo"
        } else {
            self.tactics.defensive = None;
            return;
        };
        self.tactics.defensive = Some((id, weapon));
        inp.fire_torpedo = false;
        inp.fire_rail = false;
        inp.overcharge = false;
        let r = tp.pos - s.pos;
        let rv = tp.vel - s.vel;
        inp.rate = turn_toward(
            s,
            if weapon == "railgun" {
                aim
            } else {
                r.normalized_or(aim)
            },
        ) + s.orient.inv_rotate(r.cross(rv) / r.len_sq().max(1.0));
        // Quiet the platform enough to make a two-metre rail target hittable. Momentum and
        // defensive roll can continue; no magic accuracy bonus is granted to this shot.
        if weapon == "railgun" {
            inp.thrust_g = 0.0;
            inp.strafe = inp.strafe * 0.15;
            inp.charge_rail = true;
            let miss = (aim - s.forward() * aim.dot(s.forward())).len() * range;
            let sigma = s.rail_sigma() * range;
            let probability = 1.0 - (-4.0 / (2.0 * sigma * sigma).max(1e-9)).exp();
            inp.fire_rail = s.rail_charge >= 1.0 && miss < 1.4 && probability > 0.18;
            inp.rail_intercept = Some(id);
            if inp.fire_rail {
                self.tactics.rail_pending = Some((id, w.t + flight + 0.15));
            }
        } else {
            inp.fire_torpedo = s.forward().dot((tp.pos - s.pos).normalized_or(aim)) > 0.96;
            inp.torp_count = 1;
            inp.torp_ripple = 0.0;
            inp.torp_intercept = Some(id);
        }
    }

    fn torpedo_request(&mut self, w: &World, me: usize, inp: &mut Input, advantage: f64) -> bool {
        let s = &w.ships[me];
        let e = &w.ships[1 - me];
        let rel = e.pos - s.pos;
        let range = rel.len();
        let los = rel.normalized_or(s.forward());
        let ready = s.tubes.iter().filter(|&&t| t <= 0.0).count() as u32;
        let mounts = (0..PDC_MOUNTS)
            .filter(|&m| {
                e.part(Part::pdc(m)) > 0.0 && e.pdcs[m].ammo > 0.0 && !e.pdcs[m].overheated
            })
            .count();
        let cover = (0..PDC_MOUNTS)
            .filter(|&m| {
                e.part(Part::pdc(m)) > 0.0
                    && e.pdcs[m].ammo > 0.0
                    && !e.pdcs[m].overheated
                    && e.orient.rotate(pdc_normal(m)).dot(-los) > PDC_ARC_COS
            })
            .count();
        let ammo = e.pdcs.iter().map(|p| p.ammo).sum::<f64>();
        let heat = e.pdcs.iter().map(|p| p.heat).sum::<f64>() / 3.0;
        let weak = mounts <= 1 || ammo < 25.0;
        let follow_up = w.t - self.last_salvo_t < 12.0 && heat > 0.4;
        let finish = weak || e.health_index() < 0.4 || w.t > 90.0 || s.rail_ammo < 3;
        let last = s.torpedoes <= s.class.tubes;
        let counter_approach = self.style == Style::Counter && -(e.vel - s.vel).dot(los) > 80.0;
        let min_range = if weak || e.hull < TORP_HULL || w.t > 120.0 {
            200.0
        } else if self.style == Style::Knife || counter_approach {
            1800.0
        } else {
            3200.0
        };
        let spacing = if follow_up {
            4.0
        } else {
            6.0 + 3.0 * self.temper.launch_depth
        };
        let on = self.torps
            && s.torpedoes > 0
            && ready > 0
            && s.launch_queue.is_empty()
            && s.part(Part::Launcher) > 0.0
            && s.powered()
            && range >= min_range
            && range < 8500.0
            && w.t - self.last_salvo_t > spacing
            && (!last || finish || advantage < -0.12);
        if !on {
            self.salvo_since = None;
            return false;
        }
        let since = *self.salvo_since.get_or_insert(w.t);
        if w.t - since < self.temper.reaction {
            return false;
        }
        let size = if weak {
            1
        } else if follow_up || counter_approach || advantage < -0.12 {
            ready
        } else {
            (cover as i32 + self.temper.salvo_bias + 1).max(1) as u32
        };
        inp.torp_count = size.min(ready).min(s.torpedoes);
        inp.torp_ripple =
            if inp.torp_count > 1 && (heat > 0.4 - self.temper.ripple_lean || follow_up) {
                0.65
            } else {
                0.0
            };
        inp.fire_torpedo = s.forward().dot(los) > 0.95;
        self.salvo_why = if weak {
            "weak screen"
        } else if follow_up {
            "follow-up"
        } else if advantage < -0.12 {
            "behind"
        } else {
            "crossfire"
        };
        if inp.fire_torpedo {
            self.last_salvo_t = w.t;
            self.salvo_since = None;
        }
        true
    }
}
