# Speed Kills

The current **Hard Burn** duel sim is in `crates/duel`, with its broadcast viewer in `viewer2`.
Run `python3 viewer2/serve.py` and open http://127.0.0.1:8095/.
See [broadcast changes, validation and fresh cards](viewer2/docs/BROADCAST_IMPROVEMENTS.md) and the [voice recording manifest](viewer2/docs/VOICE_RECORDING_MANIFEST.md).

The training dashboard below belongs to the earlier orbital/RL prototype.

RL-driven 3D gunship duels around a planet. See [DESIGN.md](DESIGN.md).

## Training dashboard

```bash
.venv/bin/python -m speedkills_rl.dashboard
```

Open http://localhost:8090 — start runs, watch strength by generation, replay any generation,
promote a champion, or fork from any point. Training processes keep running if the dashboard
is closed.

Command line equivalents:

```bash
.venv/bin/python -m speedkills_rl.train --name my-run --set lr=1e-4
.venv/bin/python -m speedkills_rl.train --fork <run_id> --gen 12 --name tweak
.venv/bin/python -m speedkills_rl.train --resume <run_id>
```

Records live in `runs/<run_id>/` (see `python/speedkills_rl/store.py`); the champion in `models/`.

## Live sandbox (scripted bots, or fly yourself)

```bash
cargo run --release --bin sk-server
```

Open http://localhost:8080. Press `?` for controls.

## Setup (once)

```bash
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python torch numpy maturin
cd crates/py && VIRTUAL_ENV=../../.venv ../../.venv/bin/maturin develop --release && cd ../..
uv pip install --python .venv/bin/python -e python
```

Rebuild the Python extension (`maturin develop --release` in `crates/py`) after changing the sim.

## Sim health

```bash
cargo test --release -p sk-sim
cargo run --release --bin batch -- 30 1
cargo run --release -p sk-sim --example trace -- Lancer Hornet 3
```

## Layout

- `crates/sim` — deterministic, dependency-free sim core, bots, RL interface
- `crates/wire` — JSON state format shared by live streaming and replays
- `crates/server` — live sandbox server and the batch statistics tool
- `crates/py` — Python binding (vectorized environments)
- `python/speedkills_rl` — PPO trainer, league ratings, run records, dashboard server
- `dashboard` — training dashboard UI
- `viewer` — Three.js spectator viewer (live and replay)
