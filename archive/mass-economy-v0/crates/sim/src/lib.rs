//! Speed Kills simulation core. Dependency-free and deterministic for a given seed.

pub mod bot;
pub mod control;
pub mod math;
pub mod params;
pub mod rl;
pub mod world;

pub use math::{Quat, Rng, Vec3};
pub use params::{preset, ShipParams, PRESETS};
pub use world::{Body, Event, Input, Kind, MatchConfig, Ship, Tether, World};

#[cfg(test)]
mod tests;
