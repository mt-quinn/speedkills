//! Flight-control helpers that turn intentions into raw `Input` torque commands.
//! Agents will eventually drive raw torque; bots and humans use these assists.

use crate::math::Vec3;
use crate::world::World;

/// Body-frame torque command that swings the nose toward `desired` (world, unit) and
/// kills residual spin. Roll about the nose is damped to zero.
pub fn steer_torque(w: &World, i: usize, desired: Vec3) -> Vec3 {
    let s = &w.ships[i];
    let inertia = w.inertia(i);
    let omega = w.ang_vel(i);
    let fwd = w.forward(i);
    let desired = desired.normalized_or(fwd);
    let axis = fwd.cross(desired);
    let sin = axis.len();
    let cos = fwd.dot(desired);
    let angle = sin.atan2(cos);
    let axis_n = if sin > 1e-6 {
        axis / sin
    } else if cos < 0.0 {
        fwd.any_perp()
    } else {
        Vec3::ZERO
    };
    let alpha_max = s.params.max_torque / inertia;
    // Bang-bang-ish profile: the fastest rate we can still stop from in the remaining angle.
    let rate = (2.0 * alpha_max * angle * 0.7).sqrt().min(s.params.max_rate);
    let w_des = axis_n * rate;
    torque_for_rate(w, i, w_des, omega, inertia)
}

/// Body-frame torque command that tracks a desired *body-frame* angular velocity.
/// Used for human fly-by-wire: keys map to pitch/yaw/roll rates.
pub fn rate_torque(w: &World, i: usize, desired_body_rate: Vec3) -> Vec3 {
    let s = &w.ships[i];
    let w_des = s.orient.rotate(desired_body_rate);
    torque_for_rate(w, i, w_des, w.ang_vel(i), w.inertia(i))
}

fn torque_for_rate(w: &World, i: usize, w_des: Vec3, omega: Vec3, inertia: f64) -> Vec3 {
    let s = &w.ships[i];
    let react = 0.1;
    let torque_world = (w_des - omega) * (inertia / react);
    let body = s.orient.inv_rotate(torque_world) / s.params.max_torque;
    Vec3::new(body.x.clamp(-1.0, 1.0), body.y.clamp(-1.0, 1.0), body.z.clamp(-1.0, 1.0))
}

/// Angle (radians) between the nose and `dir`.
pub fn aim_error(w: &World, i: usize, dir: Vec3) -> f64 {
    let fwd = w.forward(i);
    fwd.dot(dir.normalized_or(fwd)).clamp(-1.0, 1.0).acos()
}

/// Direction to fire a projectile of relative speed `speed` to hit a target at relative
/// position `rel_pos` moving with relative velocity `rel_vel`. Returns (direction, time).
pub fn intercept(rel_pos: Vec3, rel_vel: Vec3, speed: f64) -> Option<(Vec3, f64)> {
    let a = rel_vel.len_sq() - speed * speed;
    let b = 2.0 * rel_pos.dot(rel_vel);
    let c = rel_pos.len_sq();
    let t = if a.abs() < 1e-9 {
        if b.abs() < 1e-9 {
            return None;
        }
        -c / b
    } else {
        let disc = b * b - 4.0 * a * c;
        if disc < 0.0 {
            return None;
        }
        let sq = disc.sqrt();
        let t1 = (-b - sq) / (2.0 * a);
        let t2 = (-b + sq) / (2.0 * a);
        let lo = t1.min(t2);
        let hi = t1.max(t2);
        if lo > 0.0 {
            lo
        } else if hi > 0.0 {
            hi
        } else {
            return None;
        }
    };
    if t <= 0.0 {
        return None;
    }
    Some(((rel_pos + rel_vel * t).normalized(), t))
}

/// Periapsis and apoapsis distances of the orbit through `r`, `v` around a mass `gm`.
/// Apoapsis is infinite on an escape trajectory.
pub fn apsides(r: Vec3, v: Vec3, gm: f64) -> (f64, f64) {
    let rl = r.len().max(1e-6);
    let energy = v.len_sq() / 2.0 - gm / rl;
    let h = r.cross(v).len();
    let e = (1.0 + 2.0 * energy * h * h / (gm * gm)).max(0.0).sqrt();
    let rp = h * h / (gm * (1.0 + e));
    if energy >= 0.0 {
        return (rp, f64::INFINITY);
    }
    let a = -gm / (2.0 * energy);
    (rp, a * (1.0 + e))
}

/// Fire-control solution: the direction to fire a projectile of muzzle speed `speed` from
/// ship `me` at ship `target`, if the shot leaves after `delay` seconds (a railgun's charge).
/// Accounts for both ships' motion and planet gravity on ships and projectile (ballistic,
/// constant-acceleration approximation). Returns (direction, flight time).
pub fn fire_solution(w: &World, me: usize, target: usize, speed: f64, delay: f64) -> Option<(Vec3, f64)> {
    let (s, t) = (&w.bodies[me], &w.bodies[target]);
    let g = |p: Vec3| match w.planet() {
        Some((pc, gm, pr)) => {
            let d = pc - p;
            d.normalized() * (gm / d.len_sq().max(pr * pr))
        }
        None => Vec3::ZERO,
    };
    let (gs, gt) = (g(s.pos), g(t.pos));
    let shooter = s.pos + s.vel * delay + gs * (0.5 * delay * delay);
    let launch_vel = s.vel + gs * delay;
    let g_round = (gs + gt) * 0.5;
    let mut tof = ((t.pos - s.pos).len() / speed).max(0.0);
    let mut dir = (t.pos - s.pos).normalized();
    for _ in 0..6 {
        let tt = delay + tof;
        let target_at = t.pos + t.vel * tt + gt * (0.5 * tt * tt);
        // Where the round would be with zero muzzle velocity; the muzzle must cover the rest.
        let drift = shooter + launch_vel * tof + g_round * (0.5 * tof * tof);
        let need = target_at - drift;
        let new_tof = need.len() / speed;
        dir = need.normalized();
        if (new_tof - tof).abs() < 1e-4 {
            tof = new_tof;
            break;
        }
        tof = new_tof;
    }
    if !tof.is_finite() || tof > 10.0 {
        return None;
    }
    Some((dir, tof))
}

/// Planet gravity at a point (zero without a planet).
pub fn gravity_at(w: &World, p: Vec3) -> Vec3 {
    match w.planet() {
        Some((pc, gm, pr)) => {
            let d = pc - p;
            d.normalized() * (gm / d.len_sq().max(pr * pr))
        }
        None => Vec3::ZERO,
    }
}

/// Closest approach between two coasting bodies under planet gravity.
#[derive(Clone, Copy, Debug)]
pub struct Approach {
    /// Closest distance between centres (m).
    pub dist: f64,
    /// Seconds from now.
    pub time: f64,
    /// Position of `a` relative to `b` at closest approach.
    pub miss: Vec3,
    /// Relative speed at closest approach.
    pub rel_speed: f64,
    /// `a` hit the planet before closest approach.
    pub blocked: bool,
}

/// Prediction step. Coarse, with an in-step linear closest-approach so fast passes still count.
pub const PREDICT_DT: f64 = 0.2;

/// Propagate two coasting bodies (semi-implicit Euler, planet gravity only) and report their
/// closest approach within `horizon` seconds.
pub fn closest_approach(w: &World, mut pa: Vec3, mut va: Vec3, mut pb: Vec3, mut vb: Vec3, horizon: f64) -> Approach {
    let planet = w.planet();
    let mut best = Approach { dist: (pa - pb).len(), time: 0.0, miss: pa - pb, rel_speed: (va - vb).len(), blocked: false };
    let steps = (horizon / PREDICT_DT) as usize;
    for k in 1..=steps {
        va += gravity_at(w, pa) * PREDICT_DT;
        vb += gravity_at(w, pb) * PREDICT_DT;
        let (pa0, pb0) = (pa, pb);
        pa += va * PREDICT_DT;
        pb += vb * PREDICT_DT;
        // Closest point within this step (linear), so fast passes aren't missed.
        let d0 = pa0 - pb0;
        let dd = (pa - pb) - d0;
        let u = if dd.len_sq() > 1e-12 { (-d0.dot(dd) / dd.len_sq()).clamp(0.0, 1.0) } else { 1.0 };
        let m = d0 + dd * u;
        if m.len() < best.dist {
            best = Approach { dist: m.len(), time: (k as f64 - 1.0 + u) * PREDICT_DT, miss: m, rel_speed: (va - vb).len(), blocked: false };
        }
        if let Some((pc, _, pr)) = planet {
            if (pa - pc).len() < pr {
                best.blocked = best.time >= (k as f64 - 1.0) * PREDICT_DT;
                break;
            }
        }
    }
    best
}

/// The gunsight: where a mass-driver shot fired along `dir` right now would pass the target.
pub fn gunsight(w: &World, me: usize, target: usize, dir: Vec3, horizon: f64) -> Approach {
    let (s, t) = (&w.bodies[me], &w.bodies[target]);
    let p = &w.ships[me].params;
    let muzzle = s.pos + dir * (s.radius + 1.0);
    let shot_vel = s.vel + dir * p.driver.speed;
    closest_approach(w, muzzle, shot_vel, t.pos, t.vel, horizon)
}

/// Iterative orbital aim: refine a firing direction until the predicted shot passes through the
/// target (or give up). Returns (direction, predicted approach).
pub fn orbital_aim(w: &World, me: usize, target: usize, horizon: f64) -> (Vec3, Approach) {
    let (s, t) = (&w.bodies[me], &w.bodies[target]);
    let speed = w.ships[me].params.driver.speed;
    let mut dir = fire_solution(w, me, target, speed, 0.0).map(|(d, _)| d).unwrap_or((t.pos - s.pos).normalized());
    let mut best = (dir, gunsight(w, me, target, dir, horizon));
    for _ in 0..6 {
        let a = best.1;
        if a.dist < 1.0 || a.time <= 0.0 {
            break;
        }
        // Steer the muzzle against the miss, scaled by how far the shot has flown.
        let lever = (speed * a.time).max(1.0);
        let cand = (dir - a.miss / lever).normalized();
        let ca = gunsight(w, me, target, cand, horizon);
        if ca.dist < a.dist {
            dir = cand;
            best = (cand, ca);
        } else {
            break;
        }
    }
    best
}
