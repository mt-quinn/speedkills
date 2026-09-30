//! Minimal f64 vector / quaternion math. No dependencies, deterministic.

use std::ops::{Add, AddAssign, Div, Mul, MulAssign, Neg, Sub, SubAssign};

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Vec3 {
    pub const ZERO: Vec3 = Vec3 { x: 0.0, y: 0.0, z: 0.0 };
    pub const X: Vec3 = Vec3 { x: 1.0, y: 0.0, z: 0.0 };
    pub const Y: Vec3 = Vec3 { x: 0.0, y: 1.0, z: 0.0 };
    pub const Z: Vec3 = Vec3 { x: 0.0, y: 0.0, z: 1.0 };

    pub const fn new(x: f64, y: f64, z: f64) -> Self {
        Vec3 { x, y, z }
    }
    pub fn dot(self, o: Vec3) -> f64 {
        self.x * o.x + self.y * o.y + self.z * o.z
    }
    pub fn cross(self, o: Vec3) -> Vec3 {
        Vec3::new(
            self.y * o.z - self.z * o.y,
            self.z * o.x - self.x * o.z,
            self.x * o.y - self.y * o.x,
        )
    }
    pub fn len_sq(self) -> f64 {
        self.dot(self)
    }
    pub fn len(self) -> f64 {
        self.len_sq().sqrt()
    }
    pub fn normalized(self) -> Vec3 {
        let l = self.len();
        if l > 1e-12 {
            self / l
        } else {
            Vec3::ZERO
        }
    }
    /// Normalized, or `fallback` if (near) zero.
    pub fn normalized_or(self, fallback: Vec3) -> Vec3 {
        let l = self.len();
        if l > 1e-12 {
            self / l
        } else {
            fallback
        }
    }
    pub fn clamp_len(self, max: f64) -> Vec3 {
        let l = self.len();
        if l > max && l > 0.0 {
            self * (max / l)
        } else {
            self
        }
    }
    /// Any unit vector perpendicular to self.
    pub fn any_perp(self) -> Vec3 {
        let a = if self.x.abs() < 0.9 { Vec3::X } else { Vec3::Y };
        self.cross(a).normalized()
    }
    pub fn to_array(self) -> [f64; 3] {
        [self.x, self.y, self.z]
    }
}

impl Add for Vec3 {
    type Output = Vec3;
    fn add(self, o: Vec3) -> Vec3 {
        Vec3::new(self.x + o.x, self.y + o.y, self.z + o.z)
    }
}
impl Sub for Vec3 {
    type Output = Vec3;
    fn sub(self, o: Vec3) -> Vec3 {
        Vec3::new(self.x - o.x, self.y - o.y, self.z - o.z)
    }
}
impl Mul<f64> for Vec3 {
    type Output = Vec3;
    fn mul(self, s: f64) -> Vec3 {
        Vec3::new(self.x * s, self.y * s, self.z * s)
    }
}
impl Mul<Vec3> for f64 {
    type Output = Vec3;
    fn mul(self, v: Vec3) -> Vec3 {
        v * self
    }
}
impl Div<f64> for Vec3 {
    type Output = Vec3;
    fn div(self, s: f64) -> Vec3 {
        Vec3::new(self.x / s, self.y / s, self.z / s)
    }
}
impl Neg for Vec3 {
    type Output = Vec3;
    fn neg(self) -> Vec3 {
        Vec3::new(-self.x, -self.y, -self.z)
    }
}
impl AddAssign for Vec3 {
    fn add_assign(&mut self, o: Vec3) {
        *self = *self + o;
    }
}
impl SubAssign for Vec3 {
    fn sub_assign(&mut self, o: Vec3) {
        *self = *self - o;
    }
}
impl MulAssign<f64> for Vec3 {
    fn mul_assign(&mut self, s: f64) {
        *self = *self * s;
    }
}

/// Unit quaternion (w, x, y, z). Rotates body-frame vectors into world frame.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Quat {
    pub w: f64,
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Default for Quat {
    fn default() -> Self {
        Quat::IDENTITY
    }
}

impl Quat {
    pub const IDENTITY: Quat = Quat { w: 1.0, x: 0.0, y: 0.0, z: 0.0 };

    pub fn from_axis_angle(axis: Vec3, angle: f64) -> Quat {
        let a = axis.normalized();
        let (s, c) = (angle * 0.5).sin_cos();
        Quat { w: c, x: a.x * s, y: a.y * s, z: a.z * s }
    }

    /// Shortest rotation taking unit vector `from` to unit vector `to`.
    pub fn from_to(from: Vec3, to: Vec3) -> Quat {
        let d = from.dot(to);
        if d < -0.999999 {
            return Quat::from_axis_angle(from.any_perp(), std::f64::consts::PI);
        }
        let c = from.cross(to);
        Quat { w: 1.0 + d, x: c.x, y: c.y, z: c.z }.normalized()
    }

    pub fn mul(self, o: Quat) -> Quat {
        Quat {
            w: self.w * o.w - self.x * o.x - self.y * o.y - self.z * o.z,
            x: self.w * o.x + self.x * o.w + self.y * o.z - self.z * o.y,
            y: self.w * o.y - self.x * o.z + self.y * o.w + self.z * o.x,
            z: self.w * o.z + self.x * o.y - self.y * o.x + self.z * o.w,
        }
    }

    pub fn conj(self) -> Quat {
        Quat { w: self.w, x: -self.x, y: -self.y, z: -self.z }
    }

    pub fn normalized(self) -> Quat {
        let l = (self.w * self.w + self.x * self.x + self.y * self.y + self.z * self.z).sqrt();
        Quat { w: self.w / l, x: self.x / l, y: self.y / l, z: self.z / l }
    }

    /// Rotate a body-frame vector into world frame.
    pub fn rotate(self, v: Vec3) -> Vec3 {
        let u = Vec3::new(self.x, self.y, self.z);
        let t = u.cross(v) * 2.0;
        v + t * self.w + u.cross(t)
    }

    /// Rotate a world-frame vector into body frame.
    pub fn inv_rotate(self, v: Vec3) -> Vec3 {
        self.conj().rotate(v)
    }

    /// Integrate by world-frame angular velocity `w` over `dt`.
    pub fn integrate(self, w: Vec3, dt: f64) -> Quat {
        let ang = w.len() * dt;
        if ang < 1e-12 {
            return self;
        }
        Quat::from_axis_angle(w, ang).mul(self).normalized()
    }

    pub fn to_array(self) -> [f64; 4] {
        [self.x, self.y, self.z, self.w]
    }
}

/// Small deterministic RNG (xorshift64*).
#[derive(Clone, Debug)]
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng(seed.wrapping_mul(0x9E3779B97F4A7C15) | 1)
    }
    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545F4914F6CDD1D)
    }
    /// Uniform in [0, 1).
    pub fn f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }
    pub fn range(&mut self, lo: f64, hi: f64) -> f64 {
        lo + (hi - lo) * self.f64()
    }
    pub fn unit_vec(&mut self) -> Vec3 {
        loop {
            let v = Vec3::new(self.range(-1.0, 1.0), self.range(-1.0, 1.0), self.range(-1.0, 1.0));
            let l = v.len_sq();
            if l > 1e-4 && l <= 1.0 {
                return v / l.sqrt();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotate_roundtrip() {
        let q = Quat::from_axis_angle(Vec3::new(1.0, 2.0, 3.0), 0.7);
        let v = Vec3::new(0.3, -1.0, 2.0);
        let r = q.inv_rotate(q.rotate(v));
        assert!((r - v).len() < 1e-12);
    }

    #[test]
    fn from_to_works() {
        let a = Vec3::new(1.0, 0.5, -0.2).normalized();
        let b = Vec3::new(-0.3, 1.0, 0.9).normalized();
        assert!((Quat::from_to(a, b).rotate(a) - b).len() < 1e-9);
    }
}
