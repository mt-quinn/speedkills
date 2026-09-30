//! Live sandbox server. Runs the authoritative sim in real time, streams state to viewers
//! over WebSocket, accepts human control and sandbox commands, and serves the viewer.
//!
//! http://localhost:8080  — viewer
//! ws://localhost:8081    — state stream / commands

use serde_json::{json, Value};
use sk_sim::bot::{Bot, Personality};
use sk_sim::control::rate_torque;
use sk_sim::world::Event;
use sk_sim::{preset, Input, MatchConfig, Rng, Vec3, World};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tungstenite::{Message, WebSocket};

const HTTP_PORT: u16 = 8080;
const WS_PORT: u16 = 8081;


#[derive(Default, Clone, Copy)]
struct HumanKeys {
    thrust: f64,
    pitch: f64,
    yaw: f64,
    roll: f64,
    strafe: [f64; 3],
    fire: bool,
}

struct Sandbox {
    world: World,
    bots: Vec<Bot>,
    names: [String; 2],
    seed: u64,
    rng: Rng,
    control: Option<usize>,
    keys: HumanKeys,
    paused: bool,
    speed: f64,
    ended_at: Option<Instant>,
    auto_restart: bool,
    pending_events: Vec<Event>,
    reset_flag: bool,
}

impl Sandbox {
    fn new(a: &str, b: &str, seed: u64) -> Sandbox {
        let mut s = Sandbox {
            world: World::new(MatchConfig { seed, ships: vec![], asteroids: 0, layout: sk_sim::world::Layout::Empty }),
            bots: vec![],
            names: [a.into(), b.into()],
            seed,
            rng: Rng::new(seed ^ 0xABCDEF),
            control: None,
            keys: HumanKeys::default(),
            paused: false,
            speed: 1.0,
            ended_at: None,
            auto_restart: true,
            pending_events: vec![],
            reset_flag: false,
        };
        s.reset(a, b, seed);
        s
    }

    fn reset(&mut self, a: &str, b: &str, seed: u64) {
        let pa = preset(a).unwrap_or(sk_sim::params::LANCER);
        let pb = preset(b).unwrap_or(sk_sim::params::HORNET);
        self.names = [pa.name.into(), pb.name.into()];
        self.seed = seed;
        self.world = World::new(MatchConfig::standard(seed, vec![pa, pb]));
        let mut prng = Rng::new(seed.wrapping_add(17));
        self.bots = vec![
            Bot::new(Personality::for_design(pa.name, &mut prng), seed ^ 1),
            Bot::new(Personality::for_design(pb.name, &mut prng), seed ^ 2),
        ];
        self.ended_at = None;
        self.pending_events.clear();
        self.reset_flag = true;
    }

    fn step(&mut self) {
        for i in 0..self.world.ships.len() {
            let inp = if self.control == Some(i) {
                let k = self.keys;
                // Fly-by-wire: keys command body rates (rad/s).
                let max = self.world.ships[i].params.max_rate;
                let rate = Vec3::new(k.pitch, k.yaw, k.roll) * max;
                Input {
                    thrust: k.thrust,
                    strafe: Vec3::new(k.strafe[0], k.strafe[1], k.strafe[2]),
                    torque: rate_torque(&self.world, i, rate),
                    fire: k.fire,
                }
            } else {
                self.bots[i].act(&self.world.perceived(i), i)
            };
            self.world.set_input(i, inp);
        }
        self.world.step();
        self.pending_events.extend(self.world.events.drain(..));
        if self.world.finished && self.ended_at.is_none() {
            self.ended_at = Some(Instant::now());
        }
    }

    fn handle(&mut self, msg: &str) {
        let Ok(v) = serde_json::from_str::<Value>(msg) else { return };
        let f = |k: &str| v.get(k).and_then(Value::as_f64).unwrap_or(0.0);
        let bl = |k: &str| v.get(k).and_then(Value::as_bool).unwrap_or(false);
        match v.get("type").and_then(Value::as_str) {
            Some("input") => {
                self.keys = HumanKeys {
                    thrust: f("thrust"),
                    pitch: f("pitch"),
                    yaw: f("yaw"),
                    roll: f("roll"),
                    strafe: [f("strafe_x"), f("strafe_y"), f("strafe_z")],
                    fire: bl("fire"),
                }
            }
            Some("control") => {
                self.control = v.get("ship").and_then(Value::as_u64).map(|x| x as usize).filter(|&x| x < 2);
                self.keys = HumanKeys::default();
            }
            Some("reset") => {
                let a = v.get("a").and_then(Value::as_str).unwrap_or(&self.names[0]).to_string();
                let b = v.get("b").and_then(Value::as_str).unwrap_or(&self.names[1]).to_string();
                let seed = v.get("seed").and_then(Value::as_u64).unwrap_or_else(|| self.rng.next_u64() % 1_000_000);
                self.reset(&a, &b, seed);
            }
            Some("pause") => self.paused = !self.paused,
            Some("speed") => self.speed = f("value").clamp(0.05, 8.0),
            Some("auto") => self.auto_restart = bl("value"),
            _ => {}
        }
    }

    fn state_json(&mut self) -> String {
        let modes: Vec<String> = (0..self.world.ships.len())
            .map(|i| if self.control == Some(i) { "human".to_string() } else { self.bots[i].mode_name().to_string() })
            .collect();
        let events = std::mem::take(&mut self.pending_events);
        let mut m = sk_wire::state(&self.world, &modes, &events, true);
        m.insert("seed".into(), json!(self.seed));
        m.insert("paused".into(), json!(self.paused));
        m.insert("speed".into(), json!(self.speed));
        m.insert("control".into(), json!(self.control));
        if self.reset_flag {
            self.reset_flag = false;
            if let Some(Value::Array(ev)) = m.get_mut("events") {
                ev.insert(0, json!({"type": "reset", "seed": self.seed}));
            }
        }
        Value::Object(m).to_string()
    }
}

fn viewer_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../viewer")
}

fn serve_http() {
    let server = tiny_http::Server::http(("127.0.0.1", HTTP_PORT)).expect("http bind");
    let root = viewer_dir().canonicalize().expect("viewer dir");
    for req in server.incoming_requests() {
        let url = req.url().split('?').next().unwrap_or("/").to_string();
        let rel = if url == "/" { "index.html".to_string() } else { url.trim_start_matches('/').to_string() };
        let path = root.join(&rel);
        let ok = path.canonicalize().map(|p| p.starts_with(&root)).unwrap_or(false);
        let resp = if ok {
            match std::fs::read(&path) {
                Ok(bytes) => {
                    let ct = match path.extension().and_then(|e| e.to_str()) {
                        Some("html") => "text/html; charset=utf-8",
                        Some("js") => "text/javascript; charset=utf-8",
                        Some("css") => "text/css; charset=utf-8",
                        Some("json") => "application/json",
                        _ => "application/octet-stream",
                    };
                    tiny_http::Response::from_data(bytes)
                        .with_header(tiny_http::Header::from_bytes("Content-Type", ct).unwrap())
                        .with_header(tiny_http::Header::from_bytes("Cache-Control", "no-store").unwrap())
                }
                Err(_) => tiny_http::Response::from_string("not found").with_status_code(404),
            }
        } else {
            tiny_http::Response::from_string("not found").with_status_code(404)
        };
        let _ = req.respond(resp);
    }
}

fn main() {
    std::thread::spawn(serve_http);
    let listener = TcpListener::bind(("127.0.0.1", WS_PORT)).expect("ws bind");
    listener.set_nonblocking(true).unwrap();
    println!("Speed Kills sandbox: http://localhost:{HTTP_PORT}  (ws {WS_PORT})");

    let mut sb = Sandbox::new("Lancer", "Hornet", 1);
    let mut clients: Vec<WebSocket<TcpStream>> = Vec::new();
    let dt = sb.world.arena.dt;
    let broadcast_every = Duration::from_secs_f64(1.0 / 60.0);
    let mut last = Instant::now();
    let mut acc = 0.0;
    let mut last_broadcast = Instant::now();

    loop {
        // New viewers.
        while let Ok((stream, _)) = listener.accept() {
            let _ = stream.set_nonblocking(false);
            let _ = stream.set_nodelay(true);
            if let Ok(ws) = tungstenite::accept(stream) {
                let _ = ws.get_ref().set_nonblocking(true);
                clients.push(ws);
            }
        }
        // Commands.
        let mut msgs = Vec::new();
        clients.retain_mut(|ws| loop {
            match ws.read() {
                Ok(Message::Text(t)) => msgs.push(t.to_string()),
                Ok(Message::Close(_)) => break false,
                Ok(_) => {}
                Err(tungstenite::Error::Io(e)) if e.kind() == std::io::ErrorKind::WouldBlock => break true,
                Err(_) => break false,
            }
        });
        for m in msgs {
            sb.handle(&m);
        }

        // Simulate.
        let now = Instant::now();
        let elapsed = (now - last).as_secs_f64().min(0.1);
        last = now;
        if !sb.paused {
            acc += elapsed * sb.speed;
            while acc >= dt {
                sb.step();
                acc -= dt;
            }
        }
        if sb.auto_restart && sb.ended_at.is_some_and(|t| t.elapsed() > Duration::from_secs(6)) {
            let (a, b) = (sb.names[0].clone(), sb.names[1].clone());
            let seed = sb.rng.next_u64() % 1_000_000;
            sb.reset(&a, &b, seed);
        }

        // Broadcast.
        if last_broadcast.elapsed() >= broadcast_every {
            last_broadcast = Instant::now();
            if !clients.is_empty() {
                let s = sb.state_json();
                clients.retain_mut(|ws| match ws.send(Message::Text(s.clone().into())) {
                    Ok(_) => true,
                    Err(tungstenite::Error::Io(e)) if e.kind() == std::io::ErrorKind::WouldBlock => true,
                    Err(_) => false,
                });
            } else {
                sb.pending_events.clear();
            }
        }
        std::thread::sleep(Duration::from_millis(1));
    }
}
