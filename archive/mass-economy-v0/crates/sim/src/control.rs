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
    let rate = (2.0 * alpha_max * angle * 0.7).sqrt().min(8.0);
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
