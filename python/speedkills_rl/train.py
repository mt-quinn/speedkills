"""PPO self-play trainer with a generation league.

    python -m speedkills_rl.train --name first-light
    python -m speedkills_rl.train --fork <run_id> --gen 12 --name tweak --set lr=1e-4
    python -m speedkills_rl.train --resume <run_id>

Every `gen_every` updates the current policy is frozen as a generation: saved, evaluated
against scripted bots and earlier generations, rated (Bradley-Terry, bot = 1000), and given
replays. Generations are permanent, so the best one can be promoted even if later training
regresses, or used as the starting point of a fork.
"""

from __future__ import annotations

import argparse
import copy
import gzip
import json
import math
import os
import random
import sys
import time
import traceback
from collections import Counter, OrderedDict, defaultdict

import numpy as np
import torch

import speedkills as sk

from . import ratings
from .model import N_BIN, N_CONT, Policy, load_policy
from .store import Run, append_jsonl, gen_key, parse_key, read_jsonl, resolve_checkpoint, write_json

DEFAULT_CONFIG = {
    "seed": 1,
    # One design for every ship (less noise while learning the fundamentals); null = random mix.
    "design": "Warden",
    "num_envs": 128,
    "rollout": 128,
    "total_steps": 300_000_000,
    "action_repeat": 6,
    "lr": 3e-4,
    # ~50 s horizon at 20 decisions/s: running out of propellant or drifting into the zones
    # has to be connected to the burns that caused it.
    "gamma": 0.999,
    "gae_lambda": 0.97,
    "clip": 0.2,
    "epochs": 4,
    "minibatches": 8,
    "ent_coef": 0.002,
    "vf_coef": 0.5,
    "max_grad_norm": 0.5,
    "hidden": 256,
    "torch_threads": 4,
    # Built around the kill: survival only matters because it lets you get the kill.
    # shot: per round, by closest pass to the enemy hull: shot * (1 - d / shot_radius)^2.
    # engage: proximity per second, engage * (1 - d / engage_range)^2.
    # Missiles: no per-launch reward (damage and kills pay); ; strafing with
    # no enemy round near costs 2 per tank (always-on jinking emptied tanks); fuel is a permanent
    # potential; an unforced death costs clearly more than a stalemate.
    "reward": {"dealt": 1.0, "taken": 0.3, "kill": 3.0, "death": 2.0, "decision": 0.2, "stalemate": 0.5, "engage": 0.005, "engage_range": 500.0, "shot": 0.0, "shot_radius": 15.0, "shot_wide": 150.0, "fuel": 2.0, "calm_burn": 2.0},
    # Aiming scaffold: potential-based shaping on the gunsight, faded out so only the kill-first
    # rewards remain.
    "aim_start": 0.5,
    "aim_end": 0.1,  # potential-based: kept at a floor, never annealed to 0
    "aim_decay_steps": 20_000_000,
    # Orbit-safety scaffold: potential-based on the orbit's margins, faded out.
    "safety_start": 0.5,
    "safety_end": 0.25,
    "safety_decay_steps": 30_000_000,
    # Refuelling scaffold: per full tank scooped from the air (skipping), faded out. Once the
    # skip is learned it pays for itself: propellant is survival and dodges.
    "scoop_start": 0.0,
    "scoop_end": 0.0,
    "scoop_decay_steps": 30_000_000,
    # Skip drills (start-state curriculum) and skip imitation toward the scripted pilot.
    "skip_drill_start": 0.2,
    "skip_drill_end": 0.2,
    "skip_drill_steps": 1,
    "bc_skip": 1.0,
    # Adaptive learning rate on measured KL.
    "target_kl": 0.015,
    # Full traces of a sample of training episodes (drills oversampled).
    "trace_frac": 0.01,
    "trace_drill_frac": 0.03,
    # Curriculum: early bots fly but don't shoot; they get their guns over time.
    "bot_passive_start": 1.0,
    "bot_passive_end": 0.0,
    "bot_passive_decay_steps": 15_000_000,
    # Opponent mix: scripted bots, the current policy (self-play), and past generations.
    "opp_bot_start": 0.6,
    "opp_bot_end": 0.2,
    "opp_bot_decay_steps": 30_000_000,
    "opp_self": 0.4,
    "pool_size": 30,
    "active_pool": 3,
    "gen_every": 60,
    "eval_envs": 64,
    "eval_bot_matches": 64,
    "eval_league_opponents": 6,
    "eval_league_matches": 24,
}

OPP_CACHE_SIZE = 12


def compute_gae(rew, val, done, last_val, gamma, lam):
    """Generalized advantage estimation. done[t] = the step at t ended its episode, so no value
    is bootstrapped across it. Shapes: (T, N); last_val: (N,)."""
    T, N = rew.shape
    adv = np.zeros((T, N), np.float32)
    last = np.zeros(N, np.float32)
    for t in reversed(range(T)):
        nv = last_val if t == T - 1 else val[t + 1]
        nonterm = 1.0 - done[t]
        delta = rew[t] + gamma * nv * nonterm - val[t]
        last = delta + gamma * lam * nonterm * last
        adv[t] = last
    return adv


def diag_summary(ds: list[dict]) -> dict:
    if not ds:
        return {}
    S = lambda k: sum(d.get(k, 0) for d in ds)
    shots = S("launch_close") + S("launch_mid") + S("launch_far") + S("launch_blocked")
    burn = S("burn_main") + S("burn_rcs")
    zr = Counter(d["zone_reason"] for d in ds if d["zone_reason"])
    return {
        "launch_close_share": S("launch_close") / shots if shots else None,
        "close_launch_landed": S("close_landed") / max(1, S("close_landed") + S("close_missed")),
        "missile_lock_rate": S("missiles_locked") / shots if shots else None,
        "dodged_per_match": S("dodged") / len(ds),
        "blind_launch_share": S("shots_blind") / shots if shots else None,
        "enemy_in_sight": S("enemy_visible_time") / max(1e-9, sum(d.get("death_t", 0) if d.get("death_t", -1) > 0 else 0 for d in ds) or 1),
        "strafe_share": S("burn_rcs") / burn if burn else None,
        "calm_strafe_share": S("burn_rcs_calm") / max(1e-9, S("burn_rcs")),
        "ran_dry": sum(d["t_dry"] >= 0 for d in ds) / len(ds),
        "zone_reasons": dict(zr),
        "air_nose_first": S("nose_first_time") / max(1e-9, S("air_time")),
        "reward_parts": {k: sum(d["reward"][k] for d in ds) / len(ds) for k in ds[0]["reward"]},
    }


def merge_defaults(cfg: dict) -> dict:
    """Fill in settings added since a run was created (so a resumed run picks them up)."""
    out = copy.deepcopy(DEFAULT_CONFIG)
    for k, v in cfg.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k].update(v)
        else:
            out[k] = v
    return out


def deep_update(d: dict, key: str, value):
    parts = key.split(".")
    for p in parts[:-1]:
        d = d.setdefault(p, {})
    try:
        value = json.loads(value)
    except (json.JSONDecodeError, TypeError):
        pass
    d[parts[-1]] = value


class RunningMeanStd:
    def __init__(self):
        self.mean, self.var, self.count = 0.0, 1.0, 1e-4

    def update(self, x: np.ndarray):
        bm, bv, bn = float(x.mean()), float(x.var()), x.size
        delta, tot = bm - self.mean, self.count + bn
        self.mean += delta * bn / tot
        self.var = (self.var * self.count + bv * bn + delta**2 * self.count * bn / tot) / tot
        self.count = tot


class Trainer:
    def __init__(self, run: Run, cfg: dict, init: dict | None):
        self.run, self.cfg = run, cfg
        torch.set_num_threads(cfg["torch_threads"])
        torch.manual_seed(cfg["seed"])
        np.random.seed(cfg["seed"])
        random.seed(cfg["seed"])
        rw = cfg["reward"]
        rargs = dict(dealt=rw["dealt"], taken=rw["taken"], kill=rw["kill"], death=rw["death"], decision=rw["decision"], stalemate=rw["stalemate"], engage=rw["engage"], engage_range=rw.get("engage_range", 500.0), shot=rw.get("shot", 0.2), shot_radius=rw.get("shot_radius", 50.0), shot_wide=rw.get("shot_wide", 600.0), fuel=rw.get("fuel", 0.0), calm_burn=rw.get("calm_burn", 0.0), gamma=cfg["gamma"])
        self.env = sk.VecEnv(cfg["num_envs"], cfg["seed"], cfg["action_repeat"], **rargs)
        self.eval_env = sk.VecEnv(cfg["eval_envs"], cfg["seed"] + 999, cfg["action_repeat"], **rargs)
        self.obs_dim, self.act_dim = self.env.obs_dim, self.env.act_dim
        design = cfg.get("design")
        if design:
            names = sk.VecEnv.presets()
            k = names.index(design)
            for env in (self.env, self.eval_env):
                for i in range(env.n):
                    env.set_presets(i, k, k)
        self.policy = Policy(self.obs_dim, cfg["hidden"])
        self.opt = torch.optim.Adam(self.policy.parameters(), lr=cfg["lr"], eps=1e-5)
        self.ret_rms = RunningMeanStd()
        self.step, self.updates, self.gen = 0, 0, -1
        self.pool: list[str] = []  # generation keys available as opponents
        if init:
            self.policy.load_state_dict(init["model"])
            if "optim" in init and init.get("spec", {}).get("hidden") == cfg["hidden"]:
                try:
                    self.opt.load_state_dict(init["optim"])
                    for g in self.opt.param_groups:
                        g["lr"] = cfg["lr"]
                except ValueError:
                    pass
            self.step, self.updates, self.gen = init.get("step", 0), init.get("updates", 0), init.get("gen", -1)
            if "ret_rms" in init:
                self.ret_rms.mean, self.ret_rms.var, self.ret_rms.count = init["ret_rms"]
        self.self_snapshot = copy.deepcopy(self.policy)
        self.opp_cache: OrderedDict[str, Policy] = OrderedDict()
        self.ep_log: list[tuple[int, str]] = []
        self.drill_outcomes: Counter = Counter()
        self.traces: dict[int, dict] = {}
        self.env_opp = ["bot"] * cfg["num_envs"]
        self.started = time.time()
        self.ep_window: list[dict] = []
        self.active_pool: list[str] = []

    # ---------- opponents ----------
    def p_bot(self) -> float:
        c = self.cfg
        u = min(1.0, self.step / max(1, c["opp_bot_decay_steps"]))
        return c["opp_bot_start"] + (c["opp_bot_end"] - c["opp_bot_start"]) * u

    def schedule(self, start: str, end: str, steps: str) -> float:
        c = self.cfg
        u = min(1.0, self.step / max(1, c[steps]))
        return c[start] + (c[end] - c[start]) * u

    def aim_weight(self) -> float:
        return self.schedule("aim_start", "aim_end", "aim_decay_steps")

    def scoop_weight(self) -> float:
        if "scoop_start" not in self.cfg:
            return 0.0
        return self.schedule("scoop_start", "scoop_end", "scoop_decay_steps")

    def safety_weight(self) -> float:
        if "safety_start" not in self.cfg:
            return 0.0
        return self.schedule("safety_start", "safety_end", "safety_decay_steps")

    def p_passive(self) -> float:
        return self.schedule("bot_passive_start", "bot_passive_end", "bot_passive_decay_steps")

    def sample_opponent(self) -> str:
        r = random.random()
        pb = self.p_bot()
        if r < pb or (not self.pool and r < pb + self.cfg["opp_self"]):
            return "bot" if r < pb else "self"
        if r < pb + self.cfg["opp_self"] or not self.pool:
            return "self"
        return random.choice(self.active_pool or self.pool[-self.cfg["pool_size"]:])

    def refresh_active_pool(self):
        """A few past generations per update keep inference groups (and cost) small."""
        recent = self.pool[-self.cfg["pool_size"]:]
        self.active_pool = random.sample(recent, min(self.cfg.get("active_pool", 3), len(recent)))

    def opponent(self, key: str) -> Policy:
        if key == "self":
            return self.self_snapshot
        if key in self.opp_cache:
            self.opp_cache.move_to_end(key)
            return self.opp_cache[key]
        p = load_policy(str(resolve_checkpoint(key)))
        self.opp_cache[key] = p
        # Hold every opponent that can be in play: evicting one that's still live reloads it
        # from disk on every step.
        while len(self.opp_cache) > max(OPP_CACHE_SIZE, self.cfg["pool_size"] + 8):
            self.opp_cache.popitem(last=False)
        return p

    def assign(self, env: sk.VecEnv, i: int, key: str, store: list[str], passive: bool | None = None):
        if passive is None:
            passive = random.random() < self.p_passive()
        store[i] = key
        env.set_bot(i, 1, key == "bot", passive and key == "bot")
        env.set_bot(i, 0, False)
        env.reset_env(i)

    def opponent_actions(self, obs1: np.ndarray, keys: list[str], deterministic: bool) -> np.ndarray:
        acts = np.zeros((len(keys), self.act_dim), np.float32)
        groups: dict[str, list[int]] = defaultdict(list)
        for i, k in enumerate(keys):
            if k != "bot":
                groups[k].append(i)
        for k, idx in groups.items():
            a, *_ = self.opponent(k).act(obs1[idx], deterministic=deterministic)
            acts[idx] = a
        return acts

    # ---------- diagnostics: every episode logged, a sample traced in full ----------
    def log_episode(self, info: dict, kind: str, opponent: str):
        """Every episode's full summary and diagnostics, training and evaluation alike, go to
        runs/<id>/episodes/g####.jsonl.gz (one line per episode; flushed per generation)."""
        rec = dict(info)
        # Training episodes belong to the generation being trained; evaluation ones to the one
        # being evaluated.
        rec.update(kind=kind, opponent_key=opponent, step=self.step, gen=self.gen + (1 if kind == "train" else 0), t=time.time())
        self.ep_log.append((rec["gen"], json.dumps(rec, separators=(",", ":"))))
        if len(self.ep_log) >= 2000:
            self.flush_episodes()

    def flush_episodes(self):
        if not self.ep_log:
            return
        d = self.run.dir / "episodes"
        d.mkdir(exist_ok=True)
        by_gen = defaultdict(list)
        for g, line in self.ep_log:
            by_gen[g].append(line)
        for g, lines in by_gen.items():
            with gzip.open(d / f"g{g:04d}.jsonl.gz", "at") as f:
                f.write("\n".join(lines) + "\n")
        self.ep_log.clear()

    def maybe_trace(self, i: int):
        """Record a sample of training episodes in full: the replay (world state) plus the
        policy's own trace per decision (value, mean controls, fire probability, action, reward,
        teacher, observation). Drills are oversampled."""
        c = self.cfg
        p = c.get("trace_drill_frac", 0.03) if self.env.is_drill(i) else c.get("trace_frac", 0.01)
        if random.random() >= p:
            return
        self.env.set_record(i, True, [f"g{self.gen + 1}", self.env_opp[i]])
        self.traces[i] = {k: [] for k in ("t", "value", "mu", "p_fire", "action", "reward", "teacher", "obs")}
        self.traces[i]["drill"] = self.env.is_drill(i)

    @torch.no_grad()
    def trace_step(self, o0, a0, val, teach):
        idx = list(self.traces)
        x = torch.from_numpy(o0[idx])
        out = self.policy.actor(self.policy.norm(x))
        mu, pf = out[:, :N_CONT].numpy(), torch.sigmoid(out[:, N_CONT:]).numpy()
        for j, i in enumerate(idx):
            tr = self.traces[i]
            tr["t"].append(self.env.match_time(i)); tr["value"].append(float(val[i])); tr["mu"].append(mu[j]); tr["p_fire"].append(float(pf[j, 0]))
            tr["action"].append(a0[i]); tr["teacher"].append(teach[i]); tr["obs"].append(o0[i].astype(np.float16))

    def finish_trace(self, i: int, info: dict):
        tr = self.traces.pop(i, None)
        if tr is None:
            return
        data = self.env.take_replay(i)
        self.env.set_record(i, False)
        d = self.run.dir / "trajectories" / f"g{self.gen + 1:04d}"
        d.mkdir(parents=True, exist_ok=True)
        name = f"{self.step:012d}-e{i:03d}" + ("-drill" if tr["drill"] else "")
        if data:
            with gzip.open(d / f"{name}.json.gz", "wt") as f:
                f.write(data)
        n = min(len(tr["t"]), len(tr["reward"]))
        np.savez_compressed(d / f"{name}.npz", t=np.array(tr["t"][:n]), value=np.array(tr["value"][:n], np.float32), mu=np.array(tr["mu"][:n], np.float32),
                            p_fire=np.array(tr["p_fire"][:n], np.float32), action=np.array(tr["action"][:n], np.float32), reward=np.array(tr["reward"][:n], np.float32),
                            teacher=np.array(tr["teacher"][:n], np.float32), obs=np.array(tr["obs"][:n], np.float16), info=np.array(json.dumps(info)))

    # ---------- rollout ----------
    def rollout(self):
        c, env, N, T = self.cfg, self.env, self.cfg["num_envs"], self.cfg["rollout"]
        obs = np.frombuffer(env.observe(), np.float32).reshape(N, 2, self.obs_dim).copy()
        B = {
            "obs": np.zeros((T, N, self.obs_dim), np.float32),
            "cont": np.zeros((T, N, N_CONT), np.float32),
            "bin": np.zeros((T, N, N_BIN), np.float32),
            "logp": np.zeros((T, N), np.float32),
            "val": np.zeros((T, N), np.float32),
            "rew": np.zeros((T, N), np.float32),
            "done": np.zeros((T, N), np.float32),
            "teach": np.zeros((T, N, 4), np.float32),
        }
        infos_all = []
        trig = np.zeros(N_BIN)
        ret = getattr(self, "_ret", np.zeros(N))
        for t in range(T):
            o0 = obs[:, 0].copy()
            teach = np.frombuffer(env.teacher(), np.float32).reshape(N, 2, 4)[:, 0]
            a0, cont, binv, logp, val = self.policy.act(o0)
            a1 = self.opponent_actions(obs[:, 1], self.env_opp, deterministic=False)
            actions = np.stack([a0, a1], 1).astype(np.float32)
            if self.traces:
                self.trace_step(o0, a0, val, teach)
            o, r, d, infos = env.step(actions.tobytes())
            obs = np.frombuffer(o, np.float32).reshape(N, 2, self.obs_dim).copy()
            rew = np.frombuffer(r, np.float32).reshape(N, 2)[:, 0]
            done = np.frombuffer(d, np.uint8).astype(np.float32)
            B["obs"][t], B["cont"][t], B["bin"][t], B["logp"][t], B["val"][t] = o0, cont, binv, logp, val
            B["rew"][t], B["done"][t], B["teach"][t] = rew, done, teach
            for i, tr in self.traces.items():
                tr["reward"].append(float(rew[i]))
            trig += binv.mean(0)
            ret = ret * c["gamma"] + rew
            self.ret_rms.update(ret)
            ret[done > 0] = 0.0
            if infos:
                for i, js in infos:
                    info = json.loads(js)
                    info["env"] = i
                    self.log_episode(info, "train", self.env_opp[i])
                    if info.get("drill"):
                        self.drill_outcomes[info["drill_outcome"]] += 1
                    info["opponent"] = "bot" if self.env_opp[i] == "bot" else ("self" if self.env_opp[i] == "self" else "pool")
                    infos_all.append(info)
                    self.finish_trace(i, info)
                    self.assign(env, i, self.sample_opponent(), self.env_opp)
                    self.maybe_trace(i)
                obs = np.frombuffer(env.observe(), np.float32).reshape(N, 2, self.obs_dim).copy()
        self._ret = ret
        _, _, _, _, last_val = self.policy.act(obs[:, 0])
        self.step += T * N
        return B, last_val, infos_all, trig / T

    def update(self, B, last_val):
        c = self.cfg
        T, N = B["rew"].shape
        scale = 1.0 / math.sqrt(self.ret_rms.var + 1e-8)
        rew = np.clip(B["rew"] * scale, -10, 10)
        adv = compute_gae(rew, B["val"], B["done"], last_val, c["gamma"], c["gae_lambda"])
        rets = adv + B["val"]
        flat = lambda x: torch.as_tensor(x.reshape(T * N, *x.shape[2:]))
        teach = flat(B["teach"])
        obs, cont, binv = flat(B["obs"]), flat(B["cont"]), flat(B["bin"])
        old_logp, advs, returns, old_v = flat(B["logp"]), flat(adv), flat(rets), flat(B["val"])
        n = T * N
        mb = n // c["minibatches"]
        stats = defaultdict(list)
        for _ in range(c["epochs"]):
            perm = torch.randperm(n)
            for k in range(c["minibatches"]):
                idx = perm[k * mb:(k + 1) * mb]
                logp, ent, v = self.policy.evaluate(obs[idx], cont[idx], binv[idx])
                ratio = (logp - old_logp[idx]).exp()
                a = advs[idx]
                a = (a - a.mean()) / (a.std() + 1e-8)
                pg = torch.max(-a * ratio, -a * ratio.clamp(1 - c["clip"], 1 + c["clip"])).mean()
                vl = 0.5 * (v - returns[idx]).pow(2).mean()
                loss = pg + c["vf_coef"] * vl - c["ent_coef"] * ent.mean()
                # Skip imitation: low over the planet, pull the mean body rates toward the scripted
                # skip pilot's (nose into the airflow, belly to the planet). Exploration can't find
                # that attitude hold on its own (0 skips in 64 drills at g204).
                bc = c.get("bc_skip", 0.0)
                m = teach[idx, 3] > 0.5
                if bc and m.any():
                    mu = self.policy.means(obs[idx][m])[:, 4:7]
                    bl = (mu.clamp(-1, 1) - teach[idx][m][:, :3]).pow(2).sum(-1).mean()
                    loss = loss + bc * bl
                    stats["bc_loss"].append(bl.item())
                    stats["bc_frac"].append(m.float().mean().item())
                self.opt.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(self.policy.parameters(), c["max_grad_norm"])
                self.opt.step()
                with torch.no_grad():
                    stats["policy_loss"].append(pg.item())
                    stats["value_loss"].append(vl.item())
                    stats["entropy"].append(ent.mean().item())
                    stats["approx_kl"].append(((ratio - 1) - (logp - old_logp[idx])).mean().item())
                    stats["clip_frac"].append(((ratio - 1).abs() > c["clip"]).float().mean().item())
        self.policy.norm.update(obs)
        var_y = returns.var().item()
        ev = 1 - (returns - old_v).var().item() / var_y if var_y > 1e-8 else 0.0
        out = {k: float(np.mean(v)) for k, v in stats.items()}
        out["explained_var"] = ev
        out["action_std"] = float(self.policy.std_log().detach().exp().mean())
        # Adaptive learning rate on the measured KL (rsl_rl / legged_gym): keeps each update's
        # step a steady size instead of a constant lr that is too big late or too small early.
        tk = c.get("target_kl")
        if tk:
            kl = out.get("approx_kl", tk)
            lr = self.opt.param_groups[0]["lr"]
            if kl > 2 * tk:
                lr = max(c.get("lr_min", 1e-5), lr / 1.5)
            elif kl < tk / 2:
                lr = min(c.get("lr_max", 1e-3), lr * 1.5)
            for g in self.opt.param_groups:
                g["lr"] = lr
        out["lr"] = self.opt.param_groups[0]["lr"]
        return out

    # ---------- generations ----------
    def checkpoint(self) -> dict:
        return {
            "spec": self.policy.spec(), "model": self.policy.state_dict(), "optim": self.opt.state_dict(),
            "config": self.cfg, "gen": self.gen, "step": self.step, "updates": self.updates,
            "ret_rms": (self.ret_rms.mean, self.ret_rms.var, self.ret_rms.count), "key": gen_key(self.run.id, self.gen),
        }

    def make_generation(self, train_stats: dict):
        self.progress("evaluating", 0, 1)
        self.flush_episodes()
        self._drills_report, self.drill_outcomes = dict(self.drill_outcomes), Counter()
        self.gen += 1
        key = gen_key(self.run.id, self.gen)
        torch.save(self.checkpoint(), self.run.gen_path(self.gen))
        t0 = time.time()
        report = self.evaluate(key)
        self.flush_episodes()  # this generation's evaluation episodes, filed under it
        report.update({
            "gen": self.gen, "key": key, "step": self.step, "updates": self.updates,
            "created": time.time(), "wall": time.time() - self.started, "eval_seconds": time.time() - t0,
            "train": train_stats,
        })
        write_json(self.run.gens / f"g{self.gen:04d}.json", report)
        self.pool.append(key)
        self.refresh_ratings()
        self.log(f"gen {self.gen}: vs bot {report['vs_bot']:.0%}, excitement {report['excitement']:.0f}, eval {report['eval_seconds']:.0f}s")

    def league_opponents(self) -> list[str]:
        prev = [k for k in self.pool]
        if not prev:
            return []
        picks = prev[-2:]
        rt = ratings.fit(self.all_games())
        best = max(prev, key=lambda k: rt.get(k, {}).get("elo", -1e9))
        if best not in picks:
            picks.append(best)
        older = [k for k in prev[:-2] if k not in picks]
        random.shuffle(older)
        picks += older[: max(0, self.cfg["eval_league_opponents"] - len(picks))]
        return picks[: self.cfg["eval_league_opponents"]]

    def evaluate(self, key: str) -> dict:
        c, env = self.cfg, self.eval_env
        E = c["eval_envs"]
        plan = ["bot"] * c["eval_bot_matches"]
        opps = self.league_opponents()
        for o in opps:
            plan += [o] * c["eval_league_matches"]
        me = self.policy
        results: list[tuple[str, dict]] = []
        replays = []
        recorded = set()
        done_matches = 0
        last_report = 0.0
        for w0 in range(0, len(plan), E):
            chunk = plan[w0:w0 + E]
            keys = chunk + ["bot"] * (E - len(chunk))
            record = {}
            for i, k in enumerate(keys):
                env.set_bot(i, 0, False)
                env.set_bot(i, 1, k == "bot", False)
                rec = i < len(chunk) and k not in recorded and len(recorded) < 3
                if rec:
                    recorded.add(k)
                    label = "bot" if k == "bot" else f"g{parse_key(k)[1]}"
                    record[i] = k
                    env.set_record(i, True, [f"g{self.gen}", label])
                else:
                    env.set_record(i, False)
                env.reset_env(i)
            done = [False] * len(chunk)
            obs = np.frombuffer(env.observe(), np.float32).reshape(E, 2, self.obs_dim)
            for _ in range(100_000):
                if all(done):
                    break
                a0, *_ = me.act(obs[:, 0], deterministic=True)
                a1 = self.opponent_actions(obs[:, 1], keys, deterministic=True)
                o, _, _, infos = env.step(np.stack([a0, a1], 1).astype(np.float32).tobytes())
                obs = np.frombuffer(o, np.float32).reshape(E, 2, self.obs_dim)
                if time.time() - last_report > 2.0:
                    last_report = time.time()
                    self.progress("evaluating", done_matches, len(plan), gen=self.gen)
                for i, js in infos:
                    if i < len(chunk) and not done[i]:
                        done[i] = True
                        done_matches += 1
                        info = json.loads(js)
                        results.append((chunk[i], info))
                        self.log_episode(info, "eval", chunk[i])
                        if i in record:
                            data = env.take_replay(i)
                            env.set_record(i, False)
                            if data:
                                fname = f"g{self.gen:04d}-{'bot' if chunk[i] == 'bot' else 'g' + str(parse_key(chunk[i])[1])}.json.gz"
                                with gzip.open(self.run.replays / fname, "wt") as f:
                                    f.write(data)
                                replays.append({"file": fname, "opponent": chunk[i], "winner": info["winner"], "excitement": info["excitement"], "presets": info["presets"], "duration": info["duration"]})
        for i in range(E):
            env.set_record(i, False)

        # League games and the report.
        games = []
        for opp, info in results:
            score = 1.0 if info["winner"] == 0 else (0.0 if info["winner"] == 1 else 0.5)
            g = {"a": key, "b": opp, "score": score, "presets": info["presets"], "decision": info["decision"], "excitement": info["excitement"], "t": time.time()}
            games.append(g)
            append_jsonl(self.run.dir / "league.jsonl", g)
        infos = [i for _, i in results]
        bot = [s for s, (o, _) in zip(games, results) if o == "bot"]
        league = [s for s, (o, _) in zip(games, results) if o != "bot"]
        mean = lambda f: float(np.mean([f(i) for i in infos])) if infos else 0.0
        by_preset = defaultdict(list)
        for g in bot:
            by_preset[g["presets"][0]].append(g["score"])
        causes = Counter(i["kill_cause"] or ("decision" if i["decision"] else "draw") for i in infos)
        my_causes = Counter()
        for g, (_, i) in zip(games, results):
            if i["winner"] == 0:
                my_causes[i["kill_cause"] or "decision"] += 1
        return {
            "vs_bot": float(np.mean([g["score"] for g in bot])) if bot else None,
            "vs_league": float(np.mean([g["score"] for g in league])) if league else None,
            "league_opponents": opps,
            "vs_bot_by_design": {k: float(np.mean(v)) for k, v in by_preset.items()},
            "matches": len(infos),
            "excitement": mean(lambda i: i["excitement"]),
            "duration": mean(lambda i: i["duration"]),
            "decision_rate": mean(lambda i: float(i["decision"])),
            "kill_rate": mean(lambda i: float(i["winner"] == 0 and i["kill_credited"])),
            "hits": mean(lambda i: i["hits"][0]),
            "bursts": mean(lambda i: i.get("bursts", [0, 0])[0]),
            "shots": mean(lambda i: i["shots"][0]),
            "hits_taken": mean(lambda i: i["hits"][1]),
            "near_misses": mean(lambda i: i["near_misses"]),
            "shot_quality": float(np.sum([i["shot_quality"][0] for i in infos]) / max(1, np.sum([i["shots"][0] for i in infos]))),
            "aim_quality": float(np.sum([i["aim_quality"][0] for i in infos]) / max(1, np.sum([i["shots"][0] for i in infos]))),
            "good_shot_rate": float(np.sum([i["good_shots"][0] for i in infos]) / max(1, np.sum([i["shots"][0] for i in infos]))),
            "lead_changes": mean(lambda i: i["lead_changes"]),
            "close_frac": mean(lambda i: i["close_frac"]),
            "first_blood": mean(lambda i: i["first_blood"] if i["first_blood"] is not None else i["duration"]),
            "fuel_left": mean(lambda i: i["fuel_left"][0]),
            "atmo_time": mean(lambda i: i["atmo_time"][0]),
            "fuel_scooped": mean(lambda i: i.get("fuel_scooped", [0, 0])[0]),
            # Diagnostics (ShipDiag): how well it aims at the trigger, how often its good shots
            # are dodged, how it spends propellant.
            **diag_summary([i["diag"][0] for i in infos if "diag" in i]),
            "drills": getattr(self, "_drills_report", {}),
            "endings": dict(causes),
            "root_causes": dict(Counter(i["root_cause"] for i in infos if i["winner"] == 1 and not i["decision"])),
            "damage_by": {k: mean(lambda i, k=k: i["damage_by"][0][k]) for k in (infos[0]["damage_by"][0] if infos else {})},
            "wins_by": dict(my_causes),
            "replays": replays,
        }

    def all_games(self) -> list[dict]:
        return self.imported_games + read_jsonl(self.run.dir / "league.jsonl")

    def refresh_ratings(self):
        rt = ratings.fit(self.all_games())
        write_json(self.run.dir / "ratings.json", rt)
        mine = {k: v for k, v in rt.items() if k.startswith(self.run.id + "/")}
        best = None
        if mine:
            k, v = max(mine.items(), key=lambda kv: kv[1]["elo"] - kv[1]["sd"])
            best = {"key": k, "gen": parse_key(k)[1], "elo": v["elo"], "sd": v["sd"]}
        self.run.update(best=best)

    # ---------- main loop ----------
    def log(self, msg: str):
        print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)

    def progress(self, phase: str, done: int, total: int, gen: int | None = None):
        """Live progress through the generation being built (not results)."""
        g = self.gen + 1 if gen is None else gen
        self.run.update(heartbeat=time.time(), progress={"gen": g, "phase": phase, "done": done, "total": total, "at": time.time()})

    def heartbeat(self, status: str, **kw):
        self.run.update(status=status, heartbeat=time.time(), step=self.step, gen=self.gen, pid=os.getpid(), **kw)

    def train(self):
        c = self.cfg
        N = c["num_envs"]
        for i in range(N):
            self.assign(self.env, i, self.sample_opponent(), self.env_opp)
            self.maybe_trace(i)
        self.heartbeat("running")
        if self.gen < 0:
            self.make_generation({})
        since_gen = 0
        last_t = time.time()
        while self.step < c["total_steps"]:
            cmd = self.run.command()
            if cmd == "pause":
                self.heartbeat("paused")
                while self.run.command() == "pause":
                    time.sleep(1.0)
                    self.run.update(heartbeat=time.time())
                last_t = time.time()
                self.heartbeat("running")
                continue
            if cmd == "stop":
                self.log("stop requested: saving a final generation")
                self.make_generation({})
                self.run.set_command(None)
                self.heartbeat("stopped")
                return
            self.env.set_aim_weight(self.aim_weight())
            self.env.set_safety_weight(self.safety_weight())
            self.env.set_scoop_weight(self.scoop_weight())
            if "skip_drill_start" in c:
                self.env.set_skip_drill(self.schedule("skip_drill_start", "skip_drill_end", "skip_drill_steps"))
            # Refreshing the active opponents only every few updates keeps the number of distinct
            # opponents in play (one inference group each) small: matches keep the opponent they
            # started with, so a per-update refresh left dozens live at once.
            if self.updates % c.get("active_refresh", 10) == 0 or not self.active_pool:
                self.refresh_active_pool()
            t_roll = time.time()
            B, last_val, infos, trig = self.rollout()
            t_upd = time.time()
            stats = self.update(B, last_val)
            stats["rollout_s"] = t_upd - t_roll
            stats["update_s"] = time.time() - t_upd
            self.updates += 1
            since_gen += 1
            self.self_snapshot.load_state_dict(self.policy.state_dict())
            now = time.time()
            sps = c["rollout"] * N / (now - last_t)
            last_t = now
            self.ep_window = (self.ep_window + infos)[-400:]
            ew = self.ep_window
            by_opp = defaultdict(list)
            for i in infos:
                by_opp[i["opponent"]].append(1.0 if i["winner"] == 0 else (0.0 if i["winner"] == 1 else 0.5))
            row = {
                "update": self.updates, "step": self.step, "gen": self.gen, "time": now, "wall": now - self.started,
                "sps": sps, "episodes": len(infos),
                "ep_return": float(np.mean([i["returns"][0] for i in ew])) if ew else None,
                "ep_length": float(np.mean([i["duration"] for i in ew])) if ew else None,
                "excitement": float(np.mean([i["excitement"] for i in ew])) if ew else None,
                "win_rate": {k: float(np.mean(v)) for k, v in by_opp.items()},
                "p_bot": self.p_bot(), "p_passive": self.p_passive(), "aim_weight": self.aim_weight(), "safety_weight": self.safety_weight(), "scoop_weight": self.scoop_weight(),
                "fire_trigger": float(trig[0]),
                "hits": float(np.mean([i["hits"][0] for i in ew])) if ew else None,
                "shots": float(np.mean([i["shots"][0] for i in ew])) if ew else None,
                "fuel_left": float(np.mean([i["fuel_left"][0] for i in ew])) if ew else None,
                "fuel_scooped": float(np.mean([i.get("fuel_scooped", [0, 0])[0] for i in ew])) if ew else None,
                "shot_quality": float(np.sum([i["shot_quality"][0] for i in ew]) / max(1, np.sum([i["shots"][0] for i in ew]))) if ew else None,
                "aim_quality": float(np.sum([i["aim_quality"][0] for i in ew]) / max(1, np.sum([i["shots"][0] for i in ew]))) if ew else None,
                "good_shot_rate": float(np.sum([i["good_shots"][0] for i in ew]) / max(1, np.sum([i["shots"][0] for i in ew]))) if ew else None,
                "reward_std": math.sqrt(self.ret_rms.var), **stats,
            }
            append_jsonl(self.run.dir / "metrics.jsonl", row)
            self.heartbeat("running", sps=sps, progress={"gen": self.gen + 1, "phase": "training", "done": since_gen, "total": c["gen_every"], "at": time.time()})
            if self.updates % 5 == 0:
                self.log(f"update {self.updates} step {self.step:,} sps {sps:,.0f} (rollout {stats['rollout_s']:.2f}s, update {stats['update_s']:.2f}s) ret {row['ep_return']} ent {stats['entropy']:.2f} kl {stats['approx_kl']:.4f}")
            if since_gen >= c["gen_every"]:
                since_gen = 0
                self.make_generation({k: row[k] for k in ("ep_return", "ep_length", "excitement", "entropy", "explained_var", "sps")})
                last_t = time.time()  # keep eval time out of the throughput figure
        self.make_generation({})
        self.heartbeat("finished")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="run")
    ap.add_argument("--config", help="JSON object of config overrides")
    ap.add_argument("--set", action="append", default=[], help="key=value override (dots for nesting)")
    ap.add_argument("--fork", help="run id to fork from")
    ap.add_argument("--gen", type=int, help="generation to fork from")
    ap.add_argument("--resume", help="run id to resume from its latest generation")
    args = ap.parse_args()

    cfg = copy.deepcopy(DEFAULT_CONFIG)
    init = None
    imported: list[dict] = []
    pool: list[str] = []
    if args.resume:
        run = Run(args.resume)
        cfg = merge_defaults(run.meta()["config"])
        for kv in args.set:
            k, v = kv.split("=", 1)
            deep_update(cfg, k, v)
        run.update(config=cfg)
        gens = sorted(run.gens.glob("g*.pt"))
        init = torch.load(gens[-1], map_location="cpu", weights_only=False) if gens else None
        pool = [gen_key(run.id, int(p.stem[1:])) for p in gens]
        parent = run.meta().get("parent")
        if parent:
            imported, ppool = lineage(parent)
            pool = ppool + pool
    else:
        parent = None
        if args.fork:
            src = Run(args.fork)
            cfg = copy.deepcopy(src.meta()["config"])
            gen = args.gen if args.gen is not None else src.meta().get("best", {}).get("gen", 0)
            init = torch.load(src.gen_path(gen), map_location="cpu", weights_only=False)
            parent = {"run": src.id, "gen": gen, "key": gen_key(src.id, gen), "name": src.meta().get("name")}
        if args.config:
            for k, v in json.loads(args.config).items():
                if isinstance(v, dict) and isinstance(cfg.get(k), dict):
                    cfg[k].update(v)
                else:
                    cfg[k] = v
        for kv in args.set:
            k, v = kv.split("=", 1)
            deep_update(cfg, k, v)
        run = Run.create(args.name, cfg, parent)
        if parent:
            imported, pool = lineage(parent)
    print(f"run {run.id}", flush=True)
    log = (run.dir / "log.txt").open("a", buffering=1)
    sys.stdout = Tee(sys.stdout, log)
    sys.stderr = Tee(sys.stderr, log)
    # Pre-flight: never spend compute on broken instrumentation.
    from . import audit
    print("pre-flight instrumentation audit…", flush=True)
    failed = audit.preflight()
    if failed:
        run.update(status="crashed", heartbeat=time.time(), error="Pre-flight audit failed:\n" + "\n".join(failed))
        print("pre-flight FAILED: " + "; ".join(failed), flush=True)
        sys.exit(2)
    print("pre-flight passed", flush=True)
    t = Trainer(run, cfg, init)
    t.imported_games = imported
    t.pool = pool
    try:
        t.train()
        t.flush_episodes()
    except KeyboardInterrupt:
        t.flush_episodes()
        t.heartbeat("stopped")
    except Exception:
        traceback.print_exc()
        t.heartbeat("crashed", error=traceback.format_exc()[-2000:])
        sys.exit(1)


class Tee:
    def __init__(self, *streams):
        self.streams = streams

    def write(self, s):
        for st in self.streams:
            try:
                st.write(s)
            except ValueError:
                pass
        return len(s)

    def flush(self):
        for st in self.streams:
            try:
                st.flush()
            except ValueError:
                pass


def lineage(parent: dict) -> tuple[list[dict], list[str]]:
    """Games and opponent pool inherited from the parent run, up to the fork point."""
    src = Run(parent["run"])
    cut = parent["gen"]
    allowed = lambda k: k == "bot" or not k.startswith(src.id + "/") or parse_key(k)[1] <= cut
    games = [g for g in read_jsonl(src.dir / "league.jsonl") if allowed(g["a"]) and allowed(g["b"])]
    grand = src.meta().get("parent")
    pool = []
    if grand:
        g2, p2 = lineage(grand)
        games = g2 + games
        pool = p2
    pool += [gen_key(src.id, g) for g in range(cut + 1) if src.gen_path(g).exists()]
    return games, pool


if __name__ == "__main__":
    main()
