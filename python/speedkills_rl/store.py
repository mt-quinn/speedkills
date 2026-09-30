"""On-disk records for training runs. Everything a run produces lives under runs/<run_id>/:

    run.json            identity, config, lineage (parent run + gen), status, heartbeat, best/promoted
    metrics.jsonl       one line per PPO update (training health, opponent mix, episode stats)
    league.jsonl        every evaluation game: {"a", "b", "score", ...}
    gens/g0007.pt       generation checkpoint: weights, obs normalizer, optimizer (exact resume)
    gens/g0007.json     generation report: rating, win rates, excitement, fight style, replays
    replays/*.json.gz   recorded evaluation matches, playable in the viewer
    control.json        commands from the dashboard (pause / resume / stop)
    log.txt             stdout/stderr

Generations are never overwritten, so any point in a run can be rewound to: promote it as the
champion, or fork a new run from it.
"""

from __future__ import annotations

import json
import os
import shutil
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNS = ROOT / "runs"
MODELS = ROOT / "models"


def now() -> float:
    return time.time()


def write_json(path: Path, obj) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2))
    os.replace(tmp, path)


def read_json(path: Path, default=None):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def append_jsonl(path: Path, obj) -> None:
    with path.open("a") as f:
        f.write(json.dumps(obj) + "\n")


def read_jsonl(path: Path, since: int = 0) -> list:
    out = []
    try:
        with path.open() as f:
            for i, line in enumerate(f):
                if i >= since and line.strip():
                    try:
                        out.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass  # a line mid-write
    except FileNotFoundError:
        pass
    return out


def gen_key(run_id: str, gen: int) -> str:
    return f"{run_id}/g{gen:04d}"


def parse_key(key: str) -> tuple[str, int] | None:
    if "/g" not in key:
        return None
    run, g = key.rsplit("/g", 1)
    return run, int(g)


class Run:
    def __init__(self, run_id: str):
        self.id = run_id
        self.dir = RUNS / run_id
        self.gens = self.dir / "gens"
        self.replays = self.dir / "replays"

    @classmethod
    def create(cls, name: str, config: dict, parent: dict | None = None) -> "Run":
        slug = "".join(c if c.isalnum() or c in "-_" else "-" for c in name.strip().lower())[:40] or "run"
        run_id = time.strftime("%Y%m%d-%H%M%S") + "-" + slug
        r = cls(run_id)
        r.gens.mkdir(parents=True)
        r.replays.mkdir()
        write_json(r.dir / "run.json", {
            "id": run_id, "name": name, "created": now(), "config": config, "parent": parent,
            "status": "starting", "heartbeat": now(), "gen": parent["gen"] if parent else -1,
            "step": 0, "best": None, "promoted": None, "notes": "",
        })
        return r

    def meta(self) -> dict:
        return read_json(self.dir / "run.json", {})

    def update(self, **kw) -> dict:
        m = self.meta()
        m.update(kw)
        write_json(self.dir / "run.json", m)
        return m

    def gen_path(self, gen: int) -> Path:
        return self.gens / f"g{gen:04d}.pt"

    def gen_report(self, gen: int) -> dict | None:
        return read_json(self.gens / f"g{gen:04d}.json")

    def gen_reports(self) -> list[dict]:
        out = []
        for p in sorted(self.gens.glob("g*.json")):
            d = read_json(p)
            if d:
                out.append(d)
        return out

    def command(self) -> str | None:
        c = read_json(self.dir / "control.json")
        return c.get("command") if c else None

    def set_command(self, cmd: str | None) -> None:
        write_json(self.dir / "control.json", {"command": cmd, "at": now()})


def list_runs() -> list[Run]:
    if not RUNS.exists():
        return []
    return [Run(p.name) for p in sorted(RUNS.iterdir(), reverse=True) if (p / "run.json").exists()]


def resolve_checkpoint(key: str) -> Path:
    run_id, gen = parse_key(key)
    return Run(run_id).gen_path(gen)


def promote(run: Run, gen: int, note: str = "") -> dict:
    """Make a generation the champion: the version to ship. Keeps a history."""
    MODELS.mkdir(exist_ok=True)
    src = run.gen_path(gen)
    report = run.gen_report(gen) or {}
    shutil.copy2(src, MODELS / "champion.pt")
    rec = {
        "key": gen_key(run.id, gen), "run": run.id, "run_name": run.meta().get("name"), "gen": gen,
        "rating": report.get("rating"), "excitement": report.get("excitement"),
        "vs_bot": report.get("vs_bot"), "promoted_at": now(), "note": note,
    }
    write_json(MODELS / "champion.json", rec)
    append_jsonl(MODELS / "champion_history.jsonl", rec)
    run.update(promoted=gen)
    return rec
