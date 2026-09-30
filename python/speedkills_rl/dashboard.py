"""Training dashboard server (stdlib only).

    python -m speedkills_rl.dashboard            # http://localhost:8090

Reads everything from runs/ and models/, launches and controls training processes, and serves
the dashboard UI plus the 3D viewer for replays.
"""

from __future__ import annotations

import json
import mimetypes
import os
import subprocess
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import store
from .store import MODELS, ROOT, RUNS, Run, list_runs, read_json, read_jsonl
from .train import DEFAULT_CONFIG

PORT = int(os.environ.get("SK_DASHBOARD_PORT", "8090"))
STATIC = ROOT / "dashboard"
VIEWER = ROOT / "viewer"
PY = sys.executable
STALE_AFTER = 90.0

procs: dict[str, subprocess.Popen] = {}
lock = threading.Lock()


def pid_alive(pid) -> bool:
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
        return True
    except (OSError, ValueError):
        return False


def effective_status(meta: dict) -> str:
    """The trainer's reported status, corrected when its process is gone or silent."""
    st = meta.get("status", "unknown")
    if st in ("running", "paused", "starting"):
        if not pid_alive(meta.get("pid")) and time.time() - meta.get("heartbeat", 0) > 10:
            return "dead"
        if time.time() - meta.get("heartbeat", 0) > STALE_AFTER:
            return "unresponsive"
    return st


def run_summary(r: Run) -> dict:
    m = r.meta()
    cfg = m.get("config", {})
    return {
        "id": r.id, "name": m.get("name"), "status": effective_status(m), "created": m.get("created"),
        "step": m.get("step", 0), "total_steps": cfg.get("total_steps"), "gen": m.get("gen", -1),
        "best": m.get("best"), "promoted": m.get("promoted"), "parent": m.get("parent"),
        "sps": m.get("sps"), "heartbeat": m.get("heartbeat"), "notes": m.get("notes", ""),
        "progress": m.get("progress"), "design": cfg.get("design"),
    }


def run_detail(r: Run) -> dict:
    m = r.meta()
    rt = read_json(r.dir / "ratings.json", {})
    gens = []
    for g in r.gen_reports():
        g = dict(g)
        g["rating"] = rt.get(g["key"])
        g.pop("train", None) if False else None
        gens.append(g)
    lineage = []
    p = m.get("parent")
    while p:
        lineage.append(p)
        p = Run(p["run"]).meta().get("parent")
    # A fork carries on from its parent's generation: show the ancestry up to each fork point,
    # marked as inherited, so the charts tell the whole story.
    inherited, upto = [], min((g["gen"] for g in gens), default=10**9)
    for anc in lineage:
        pr = Run(anc["run"])
        prt = read_json(pr.dir / "ratings.json", {})
        part = []
        for g in pr.gen_reports():
            if g["gen"] > anc["gen"] or g["gen"] >= upto:
                continue
            g = dict(g)
            g["rating"] = rt.get(g["key"]) or prt.get(g["key"])
            g["run"], g["inherited"] = anc["run"], anc.get("name") or anc["run"]
            part.append(g)
        inherited = part + inherited
        upto = min((g["gen"] for g in part), default=upto)
    gens = inherited + gens
    return {**run_summary(r), "config": m.get("config"), "error": m.get("error"), "gens": gens,
            "ratings": rt, "lineage": lineage, "champion": read_json(MODELS / "champion.json")}


def spawn(args: list[str], run_hint: str | None = None) -> str:
    """Start a training process (it outlives the dashboard); returns its run id."""
    spawn_dir = RUNS / ".spawn"
    spawn_dir.mkdir(parents=True, exist_ok=True)
    out = spawn_dir / f"{time.time():.3f}.log"
    env = dict(os.environ, PYTHONUNBUFFERED="1")
    with out.open("w") as f:
        p = subprocess.Popen([PY, "-m", "speedkills_rl.train", *args], cwd=ROOT, stdout=f, stderr=subprocess.STDOUT, env=env, start_new_session=True)
    run_id = None
    for _ in range(400):
        time.sleep(0.05)
        text = out.read_text()
        if text.startswith("run "):
            run_id = text.split()[1]
            break
        if p.poll() is not None:
            raise RuntimeError(text[-2000:] or "trainer exited")
    if not run_id:
        raise RuntimeError("trainer did not start")
    with lock:
        procs[run_id] = p
    return run_id


def overrides_to_args(cfg: dict | None) -> list[str]:
    return ["--config", json.dumps(cfg)] if cfg else []


class Handler(BaseHTTPRequestHandler):
    server_version = "SpeedKills/1"

    def log_message(self, *a):
        pass

    # ----- helpers -----
    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path: Path, gz: bool = False):
        if not path.is_file():
            return self.send_error(HTTPStatus.NOT_FOUND)
        data = path.read_bytes()
        self.send_response(200)
        if gz:
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Encoding", "gzip")
        else:
            ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            if path.suffix == ".js":
                ctype = "text/javascript"
            self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    @staticmethod
    def safe(base: Path, rel: str) -> Path | None:
        p = (base / rel).resolve()
        return p if str(p).startswith(str(base.resolve())) else None

    # ----- routes -----
    def do_GET(self):
        u = urlparse(self.path)
        parts = [p for p in u.path.split("/") if p]
        q = parse_qs(u.query)
        try:
            if not parts:
                return self.send_file(STATIC / "index.html")
            if parts[0] == "static":
                p = self.safe(STATIC, "/".join(parts[1:]))
                return self.send_file(p) if p else self.send_error(404)
            if parts[0] == "viewer":
                p = self.safe(VIEWER, "/".join(parts[1:]) or "index.html")
                return self.send_file(p) if p else self.send_error(404)
            if parts[0] == "replays" and len(parts) == 3:
                p = self.safe(RUNS, f"{parts[1]}/replays/{parts[2]}")
                return self.send_file(p, gz=True) if p else self.send_error(404)
            if parts[:2] == ["api", "runs"] and len(parts) == 2:
                return self.send_json([run_summary(r) for r in list_runs()])
            if parts[:2] == ["api", "runs"] and len(parts) >= 3:
                r = Run(parts[2])
                if not (r.dir / "run.json").exists():
                    return self.send_json({"error": "no such run"}, 404)
                if len(parts) == 3:
                    return self.send_json(run_detail(r))
                if parts[3] == "metrics":
                    since = int(q.get("since", ["0"])[0])
                    return self.send_json(read_jsonl(r.dir / "metrics.jsonl", since))
                if parts[3] == "league":
                    return self.send_json(read_jsonl(r.dir / "league.jsonl"))
                if parts[3] == "log":
                    tail = int(q.get("tail", ["300"])[0])
                    try:
                        lines = (r.dir / "log.txt").read_text().splitlines()[-tail:]
                    except FileNotFoundError:
                        lines = []
                    return self.send_json({"lines": lines})
            if parts[:2] == ["api", "champion"]:
                return self.send_json({"current": read_json(MODELS / "champion.json"), "history": read_jsonl(MODELS / "champion_history.jsonl")})
            if parts[:2] == ["api", "defaults"]:
                return self.send_json(DEFAULT_CONFIG)
            self.send_error(404)
        except BrokenPipeError:
            pass

    def do_POST(self):
        u = urlparse(self.path)
        parts = [p for p in u.path.split("/") if p]
        try:
            b = self.body()
            if parts == ["api", "runs"]:
                args = ["--name", b.get("name") or "run", *overrides_to_args(b.get("config"))]
                return self.send_json({"id": spawn(args)})
            if parts[:2] == ["api", "runs"] and len(parts) == 4:
                r = Run(parts[2])
                action = parts[3]
                if action == "control":
                    cmd = b.get("command")
                    r.set_command(None if cmd == "resume" else cmd)
                    return self.send_json({"ok": True})
                if action == "promote":
                    return self.send_json(store.promote(r, int(b["gen"]), b.get("note", "")))
                if action == "fork":
                    args = ["--fork", r.id, "--gen", str(int(b["gen"])), "--name", b.get("name") or f"{r.meta().get('name')}-fork", *overrides_to_args(b.get("config"))]
                    return self.send_json({"id": spawn(args)})
                if action == "resume":
                    r.set_command(None)
                    return self.send_json({"id": spawn(["--resume", r.id], run_hint=r.id)})
                if action == "notes":
                    r.update(notes=b.get("notes", ""))
                    return self.send_json({"ok": True})
            self.send_error(404)
        except Exception as e:  # surface errors to the UI
            self.send_json({"error": str(e)}, 500)


def main():
    RUNS.mkdir(exist_ok=True)
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Speed Kills dashboard: http://localhost:{PORT}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
