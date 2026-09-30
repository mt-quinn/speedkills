//! Python binding: a vectorized batch of RL environments stepped in parallel.
//!
//! Arrays cross the boundary as little-endian f32 bytes (numpy `tobytes` / `frombuffer`),
//! so there is no numpy dependency on the Rust side.

use pyo3::prelude::*;
use pyo3::types::PyBytes;
use rayon::prelude::*;
use serde_json::{json, Value};
use sk_sim::rl::{observe, EpisodeInfo, Recorder, RewardCfg, RlEnv, ACT_DIM, OBS_DIM};
use sk_sim::{Event, World, PRESETS};

fn info_json(i: &EpisodeInfo) -> Value {
    json!({
        "presets": [PRESETS[i.presets[0]].name, PRESETS[i.presets[1]].name],
        "winner": i.winner, "decision": i.decision, "duration": i.duration,
        "kill_cause": i.kill_cause, "returns": i.returns, "hits": i.hits, "throws": i.throws,
        "rams": i.rams, "near_misses": i.near_misses, "lead_changes": i.lead_changes,
        "first_blood": i.first_blood, "close_frac": i.close_frac, "comeback": i.comeback,
        "tether_attaches": i.tether_attaches, "scooped": i.scooped, "zone_time": i.zone_time,
        "excitement": i.excitement,
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
    #[pyo3(signature = (n, seed, action_repeat=6, dealt=1.0, taken=0.6, scoop=0.15, kill=1.0, decision=0.3, engage=0.0))]
    #[allow(clippy::too_many_arguments)]
    fn new(n: usize, seed: u64, action_repeat: usize, dealt: f32, taken: f32, scoop: f32, kill: f32, decision: f32, engage: f32) -> Self {
        let reward = RewardCfg { dealt, taken, scoop, kill, decision, engage };
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
    #[staticmethod]
    fn presets() -> Vec<&'static str> {
        PRESETS.iter().map(|p| p.name).collect()
    }

    /// Observations for every env and both ships: shape (n, 2, OBS_DIM) as f32 bytes.
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
            let results: Vec<([f32; 2], Option<EpisodeInfo>)> = self
                .envs
                .par_iter_mut()
                .enumerate()
                .map(|(i, e)| e.step(&a[i * 2 * ACT_DIM..(i + 1) * 2 * ACT_DIM]))
                .collect();
            let obs = self.collect_obs();
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
    fn set_bot(&mut self, env: usize, ship: usize, on: bool) {
        self.envs[env].bot_mask[ship] = on;
    }

    /// Fix the ship designs for env `env` (-1 = random each episode).
    fn set_presets(&mut self, env: usize, a: i64, b: i64) {
        let f = |x: i64| if x < 0 { None } else { Some(x as usize % PRESETS.len()) };
        self.envs[env].presets = [f(a), f(b)];
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

    fn match_time(&self, env: usize) -> f64 {
        self.envs[env].world.t
    }
}

impl VecEnv {
    fn collect_obs(&self) -> Vec<f32> {
        let mut obs = vec![0.0f32; self.envs.len() * 2 * OBS_DIM];
        obs.par_chunks_mut(2 * OBS_DIM).zip(self.envs.par_iter()).for_each(|(chunk, e)| {
            let (a, b) = chunk.split_at_mut(OBS_DIM);
            observe(&e.world, 0, a);
            observe(&e.world, 1, b);
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
