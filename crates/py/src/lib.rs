//! Python binding: a vectorized batch of RL environments stepped in parallel.
//!
//! Arrays cross the boundary as little-endian f32 bytes (numpy `tobytes` / `frombuffer`),
//! so there is no numpy dependency on the Rust side.

use pyo3::prelude::*;
use pyo3::types::PyBytes;
use rayon::prelude::*;
use serde_json::{json, Value};
use sk_sim::rl::{skip_teacher, EpisodeInfo, Recorder, RewardCfg, RlEnv, ShipDiag, ACT_DIM, OBS_DIM, REWARD_PARTS};
use sk_sim::{Event, World, PRESETS};

fn diag_json(d: &ShipDiag) -> Value {
    json!({
        "burn_main": d.burn_main, "burn_rcs": d.burn_rcs, "burn_rcs_calm": d.burn_rcs_calm,
        "thrust_time": d.thrust_time, "strafe_time": d.strafe_time, "strafe_calm_time": d.strafe_calm_time,
        "fuel_at": d.fuel_at, "t_dry": d.t_dry, "death_t": d.death_t,
        "zone_exits": d.zone_exits, "fuel_at_last_exit": d.fuel_at_last_exit, "safe_at_last_exit": d.safe_at_last_exit,
        "orbit_out_at_dry": d.orbit_out_at_dry, "fires_after_dry": d.fires_after_dry, "hits_after_dry": d.hits_after_dry, "zone_reason": d.zone_reason,
        "air_entries": d.air_entries, "air_time": d.air_time, "facing_mean": if d.air_time > 0.0 { d.facing_sum / d.air_time } else { 0.0 },
        "nose_first_time": d.nose_first_time, "lift_up_time": d.lift_up_time, "lift_down_time": d.lift_down_time,
        "died_in_air": d.died_in_air, "first_pass_scooped": d.first_pass_scooped, "rp_start": d.rp_start, "rp_at_entry": d.rp_at_entry,
        "launch_close": d.launch_close, "launch_mid": d.launch_mid, "launch_far": d.launch_far, "launch_blocked": d.launch_blocked,
        "close_landed": d.close_landed, "close_missed": d.close_missed, "far_landed": d.far_landed, "dodged": d.dodged, "missiles_locked": d.missiles_locked,
        "enemy_visible_time": d.enemy_visible_time, "shots_blind": d.shots_blind,
        "reward": REWARD_PARTS.iter().zip(d.reward.iter()).map(|(k, v)| (k.to_string(), *v)).collect::<std::collections::BTreeMap<_, _>>(),
    })
}

fn info_json(i: &EpisodeInfo) -> Value {
    json!({
        "presets": [PRESETS[i.presets[0]].name, PRESETS[i.presets[1]].name],
        "winner": i.winner, "decision": i.decision, "duration": i.duration,
        "kill_cause": i.kill_cause, "returns": i.returns,
        "hits": i.hits, "bursts": i.bursts, "shots": i.shots, "rams": i.rams,
        "near_misses": i.near_misses, "shot_quality": i.shot_quality, "aim_quality": i.aim_quality, "good_shots": i.good_shots, "lead_changes": i.lead_changes,
        "first_blood": i.first_blood, "close_frac": i.close_frac, "comeback": i.comeback,
        "atmo_time": i.atmo_time, "zone_time": i.zone_time, "fuel_left": i.fuel_left, "fuel_scooped": i.fuel_scooped,
        "kill_credited": i.kill_credited, "root_cause": i.root_cause,
        "damage_by": [
            sk_sim::rl::DAMAGE_SOURCES.iter().zip(i.damage_by[0].iter()).map(|(k, v)| (k.to_string(), *v)).collect::<std::collections::BTreeMap<_, _>>(),
            sk_sim::rl::DAMAGE_SOURCES.iter().zip(i.damage_by[1].iter()).map(|(k, v)| (k.to_string(), *v)).collect::<std::collections::BTreeMap<_, _>>(),
        ],
        "excitement": i.excitement,
        "drill": i.drill, "drill_outcome": i.drill_outcome,
        "diag": [diag_json(&i.diag[0]), diag_json(&i.diag[1])],
    })
}

/// Serializes frames straight to the shared wire format.
struct JsonRecorder {
    labels: Vec<String>,
    frames: Vec<String>,
    done: Option<String>,
}

impl Recorder for JsonRecorder {
    fn frame(&mut self, w: &World, events: &[Event]) {
        let first = self.frames.is_empty();
        self.frames.push(Value::Object(sk_wire::state(w, &self.labels, events, first)).to_string());
    }
    fn end(&mut self, info: &EpisodeInfo) {
        let meta = json!({ "labels": self.labels, "info": info_json(info), "fps": 15 });
        let mut out = String::with_capacity(self.frames.iter().map(|f| f.len() + 1).sum::<usize>() + 512);
        out.push_str("{\"meta\":");
        out.push_str(&meta.to_string());
        out.push_str(",\"frames\":[");
        out.push_str(&self.frames.join(","));
        out.push_str("]}");
        self.frames.clear();
        self.done = Some(out);
    }
    fn take(&mut self) -> Option<String> {
        self.done.take()
    }
}

#[pyclass(module = "speedkills")]
struct VecEnv {
    envs: Vec<RlEnv>,
}

fn to_f32(bytes: &[u8]) -> Vec<f32> {
    bytes.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
}
fn f32_bytes(v: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(v.len() * 4);
    for x in v {
        out.extend_from_slice(&x.to_le_bytes());
    }
    out
}

#[pymethods]
impl VecEnv {
    #[new]
    #[pyo3(signature = (n, seed, action_repeat=6, dealt=1.0, taken=0.3, kill=3.0, death=1.0, decision=0.2, stalemate=0.5, engage=0.005, engage_range=500.0, shot=0.2, shot_radius=50.0, shot_wide=600.0, aim=0.0, safety=0.0, scoop=0.0, fuel=0.0, calm_burn=0.0, gamma=0.999))]
    #[allow(clippy::too_many_arguments)]
    fn new(n: usize, seed: u64, action_repeat: usize, dealt: f32, taken: f32, kill: f32, death: f32, decision: f32, stalemate: f32, engage: f32, engage_range: f32, shot: f32, shot_radius: f32, shot_wide: f32, aim: f32, safety: f32, scoop: f32, fuel: f32, calm_burn: f32, gamma: f32) -> Self {
        let reward = RewardCfg { dealt, taken, kill, death, decision, stalemate, engage, engage_range, shot, shot_radius, shot_wide, aim, safety, scoop, fuel, calm_burn, gamma };
        let envs = (0..n)
            .into_par_iter()
            .map(|i| RlEnv::new(seed.wrapping_mul(1_000_003).wrapping_add(i as u64 * 7919 + 1), action_repeat, reward))
            .collect();
        VecEnv { envs }
    }

    #[getter]
    fn n(&self) -> usize {
        self.envs.len()
    }
    #[getter]
    fn obs_dim(&self) -> usize {
        OBS_DIM
    }
    #[getter]
    fn act_dim(&self) -> usize {
        ACT_DIM
    }
    /// Named observation sections: [(name, start, length)].
    #[staticmethod]
    fn obs_layout() -> Vec<(&'static str, usize, usize)> {
        let mut at = 0;
        sk_sim::rl::OBS_LAYOUT.iter().map(|&(n, l)| { let s = at; at += l; (n, s, l) }).collect()
    }

    #[staticmethod]
    fn presets() -> Vec<&'static str> {
        PRESETS.iter().map(|p| p.name).collect()
    }

    /// Observations for every env and both ships: shape (n, 2, OBS_DIM) as f32 bytes.
    /// Skip teacher for every ship: (n, 2, 4) f32 = three body rates (action units) + a mask
    /// (1 when the ship is low over the planet and the teacher applies).
    fn teacher<'py>(&self, py: Python<'py>) -> Bound<'py, PyBytes> {
        let mut out = Vec::with_capacity(self.envs.len() * 8);
        for e in &self.envs {
            for i in 0..2 {
                match skip_teacher(&e.world, i) {
                    Some(r) => out.extend_from_slice(&[r[0], r[1], r[2], 1.0]),
                    None => out.extend_from_slice(&[0.0, 0.0, 0.0, 0.0]),
                }
            }
        }
        PyBytes::new(py, &f32_bytes(&out))
    }

    fn observe<'py>(&self, py: Python<'py>) -> Bound<'py, PyBytes> {
        let obs = py.allow_threads(|| self.collect_obs());
        PyBytes::new(py, &f32_bytes(&obs))
    }

    /// Step all envs with actions of shape (n, 2, ACT_DIM). Returns (obs, rewards (n,2),
    /// dones (n) as u8, [(env index, episode info json)]). Finished envs auto-reset.
    fn step<'py>(&mut self, py: Python<'py>, actions: &[u8]) -> PyResult<(Bound<'py, PyBytes>, Bound<'py, PyBytes>, Bound<'py, PyBytes>, Vec<(usize, String)>)> {
        let a = to_f32(actions);
        let n = self.envs.len();
        if a.len() != n * 2 * ACT_DIM {
            return Err(pyo3::exceptions::PyValueError::new_err(format!("expected {} action floats, got {}", n * 2 * ACT_DIM, a.len())));
        }
        let (obs, rew, done, infos) = py.allow_threads(|| {
            // Step and observe in one parallel pass (better cache locality).
            let mut obs = vec![0.0f32; n * 2 * OBS_DIM];
            let results: Vec<([f32; 2], Option<EpisodeInfo>)> = self
                .envs
                .par_iter_mut()
                .zip(obs.par_chunks_mut(2 * OBS_DIM))
                .enumerate()
                .map(|(i, (e, chunk))| {
                    let r = e.step(&a[i * 2 * ACT_DIM..(i + 1) * 2 * ACT_DIM]);
                    let (o0, o1) = chunk.split_at_mut(OBS_DIM);
                    e.observe(0, o0);
                    e.observe(1, o1);
                    r
                })
                .collect();
            let mut rew = Vec::with_capacity(n * 2);
            let mut done = Vec::with_capacity(n);
            let mut infos = Vec::new();
            for (i, (r, info)) in results.into_iter().enumerate() {
                rew.extend_from_slice(&r);
                done.push(info.is_some() as u8);
                if let Some(info) = info {
                    infos.push((i, info_json(&info).to_string()));
                }
            }
            (obs, rew, done, infos)
        });
        Ok((PyBytes::new(py, &f32_bytes(&obs)), PyBytes::new(py, &f32_bytes(&rew)), PyBytes::new(py, &done), infos))
    }

    /// Put a scripted bot in control of `ship` in env `env` (takes effect at the next reset).
    /// A passive bot flies but never fires (curriculum).
    #[pyo3(signature = (env, ship, on, passive=false))]
    fn set_bot(&mut self, env: usize, ship: usize, on: bool, passive: bool) {
        self.envs[env].bot_mask[ship] = on;
        self.envs[env].bot_passive[ship] = passive;
    }

    /// Set the aiming-scaffold weight for every env (annealed by the trainer).
    fn set_aim_weight(&mut self, w: f32) {
        for e in self.envs.iter_mut() {
            e.reward.aim = w;
        }
    }

    /// Set the skip-drill probability for every env (start-state curriculum).
    fn set_skip_drill(&mut self, p: f32) {
        for e in self.envs.iter_mut() {
            e.skip_drill = p;
        }
    }

    /// Set the refuelling-scaffold weight for every env (annealed by the trainer).
    fn set_scoop_weight(&mut self, w: f32) {
        for e in self.envs.iter_mut() {
            e.reward.scoop = w;
        }
    }

    /// Set the orbit-safety-scaffold weight for every env (annealed by the trainer).
    fn set_safety_weight(&mut self, w: f32) {
        for e in self.envs.iter_mut() {
            e.reward.safety = w;
        }
    }

    /// Fix the ship designs for env `env` (-1 = random each episode).
    fn set_presets(&mut self, env: usize, a: i64, b: i64) {
        let f = |x: i64| if x < 0 { None } else { Some(x as usize % PRESETS.len()) };
        self.envs[env].presets = [f(a), f(b)];
    }

    /// Audit scenario: env `env` becomes a dry dive into the air (see RlEnv::setup_skip_dive).
    fn setup_skip_dive(&mut self, env: usize, alt: f64) {
        self.envs[env].setup_skip_dive(alt);
    }

    fn reset_env(&mut self, env: usize) {
        self.envs[env].reset();
    }

    fn reset_all(&mut self, py: Python<'_>) {
        py.allow_threads(|| self.envs.par_iter_mut().for_each(|e| e.reset()));
    }

    /// Record env `env`'s episodes as replays; `labels` name what flies each ship.
    #[pyo3(signature = (env, on, labels=None))]
    fn set_record(&mut self, env: usize, on: bool, labels: Option<Vec<String>>) {
        let e = &mut self.envs[env];
        e.recorder = if on {
            Some(Box::new(JsonRecorder { labels: labels.unwrap_or_default(), frames: Vec::new(), done: None }))
        } else {
            None
        };
    }

    /// The most recent finished replay for env `env` (JSON), if any.
    fn take_replay(&mut self, env: usize) -> Option<String> {
        self.envs[env].recorder.as_mut().and_then(|r| r.take())
    }

    /// Bot style bits for a ship (1 = flash-dodge, 2 = quiet dodging); applies at the next reset.
    fn set_bot_style(&mut self, env: usize, ship: usize, style: u8) {
        self.envs[env].bot_style[ship] = style;
    }

    fn is_drill(&self, env: usize) -> bool {
        self.envs[env].is_drill()
    }

    fn match_time(&self, env: usize) -> f64 {
        self.envs[env].world.t
    }
}

impl VecEnv {
    fn collect_obs(&self) -> Vec<f32> {
        let mut obs = vec![0.0f32; self.envs.len() * 2 * OBS_DIM];
        obs.par_chunks_mut(2 * OBS_DIM).zip(self.envs.par_iter()).for_each(|(chunk, e)| {
            let (a, b) = chunk.split_at_mut(OBS_DIM);
            e.observe(0, a);
            e.observe(1, b);
        });
        obs
    }
}

#[pymodule]
fn speedkills(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<VecEnv>()?;
    m.add("OBS_DIM", OBS_DIM)?;
    m.add("ACT_DIM", ACT_DIM)?;
    Ok(())
}
