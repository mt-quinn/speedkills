//! Speed Kills v2: a crewed ship duel in open 3D space (see DESIGN-v2.md).
//!
//! Ships are sets of components and crew. Torpedoes are answered by point defence, point
//! defence by saturation, and everything close by the spinal railgun. Hard burns are paid for by
//! the crew's bodies. Deterministic for a given seed; fixed timestep.
pub mod diag;
pub mod gee;
pub mod league;
pub mod trace;
pub mod params;
pub mod pilot;
pub mod ship;
pub mod world;

pub use sk_sim::math::{Quat, Rng, Vec3};
pub use world::{Event, Input, World};

#[cfg(test)]
mod tests;
