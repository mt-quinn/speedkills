"""Instrumentation audit for the learning side. Run: python -m speedkills_rl.audit

Every check compares what the trainer believes against an independent ground truth. A failure
means the policy is learning from, or being scored on, something other than what we think.
"""

from __future__ import annotations

import json
import math
import shutil
import sys

import numpy as np
import torch

import speedkills as sk

from . import ratings
from .model import N_BIN, N_CONT, Policy, to_env
from .store import RUNS, Run
from .train import DEFAULT_CONFIG, Trainer, compute_gae

RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = ""):
    RESULTS.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}{' — ' + detail if detail else ''}", flush=True)


def layout():
    return {n: (s, l) for n, s, l in sk.VecEnv.obs_layout()}


def audit_layout():
    lay = sk.VecEnv.obs_layout()
    env = sk.VecEnv(1, 1)
    total = sum(l for _, _, l in lay)
    check("observation layout covers the whole observation", total == env.obs_dim, f"{total} of {env.obs_dim}")
    check("policy action size matches the environment", N_CONT + N_BIN == env.act_dim, f"{N_CONT}+{N_BIN} vs {env.act_dim}")


def audit_action_mapping():
    """Drive the real env through the policy's to_env mapping and watch the ship respond."""
    L = layout()
    self_at = L["self"][0]
    FUEL, AMMO = self_at + 22, self_at + 24

    def run(cont, binv, steps=20):
        env = sk.VecEnv(1, 3)
        env.set_presets(0, 2, 2)
        env.set_bot(0, 1, True, True)
        env.reset_env(0)
        o0 = np.frombuffer(env.observe(), np.float32).reshape(2, -1)[0].copy()
        a1 = np.zeros((1, N_CONT + N_BIN), np.float32)
        a1[0, 0] = -1
        for _ in range(steps):
            a0 = to_env(np.array([cont], np.float32), np.array([binv], np.float32))
            o, *_ = env.step(np.stack([a0, a1], 1).astype(np.float32).tobytes())
        o1 = np.frombuffer(o, np.float32).reshape(2, -1)[0]
        return o0, o1

    zero = [-1.0] + [0.0] * (N_CONT - 1)
    o0, o1 = run(zero, [0.0])
    check("engine off (thrust <= 0) burns no propellant", abs(o1[FUEL] - o0[FUEL]) < 1e-6, f"fuel {o0[FUEL]:.4f} -> {o1[FUEL]:.4f}")
    burn = [1.0] + [0.0] * (N_CONT - 1)
    o0, o1 = run(burn, [0.0])
    check("engine on burns propellant", o1[FUEL] < o0[FUEL] - 0.01, f"fuel {o0[FUEL]:.3f} -> {o1[FUEL]:.3f}")
    o0, o1 = run(zero, [1.0])
    check("trigger fires the driver", o1[AMMO] < o0[AMMO], f"ammo {o0[AMMO]:.3f} -> {o1[AMMO]:.3f}")
    o0, o1 = run(zero, [0.0])
    check("no trigger, no shot", abs(o1[AMMO] - o0[AMMO]) < 1e-6)


def audit_policy_math():
    torch.manual_seed(0)
    p = Policy(sk.VecEnv(1, 1).obs_dim)
    obs = np.random.randn(512, p.obs_dim).astype(np.float32)
    _, cont, binv, logp, val = p.act(obs)
    lp2, _, v2 = p.evaluate(torch.from_numpy(obs), torch.from_numpy(cont), torch.from_numpy(binv))
    d = float((torch.from_numpy(logp) - lp2.detach()).abs().max())
    check("rollout log-probs match training log-probs", d < 1e-4, f"max diff {d:.2e}")
    check("rollout values match training values", float((torch.from_numpy(val) - v2).abs().max()) < 1e-5)
    # Evaluation: continuous controls at the mean, triggers sampled at their learned probability.
    with torch.no_grad():
        logits = p.actor(p.norm(torch.from_numpy(obs)))[:, N_CONT:]
    rate = float(torch.sigmoid(logits).mean())
    fires = np.mean([p.act(obs, deterministic=True)[2].mean() for _ in range(40)])
    check("evaluation samples triggers at the policy's rate", abs(fires - rate) < 0.01, f"fired {fires:.3f} vs p {rate:.3f}")


def audit_gae():
    rng = np.random.default_rng(0)
    T, N, g, lam = 50, 4, 0.99, 0.95
    rew = rng.normal(size=(T, N)).astype(np.float32)
    val = rng.normal(size=(T, N)).astype(np.float32)
    done = (rng.random((T, N)) < 0.08).astype(np.float32)
    last = rng.normal(size=N).astype(np.float32)
    adv = compute_gae(rew, val, done, last, g, lam)
    # Brute force: sum of (g*lam)^k * delta_{t+k}, stopping after a done.
    worst = 0.0
    for n in range(N):
        v_next = np.append(val[1:, n], last[n])
        deltas = rew[:, n] + g * v_next * (1 - done[:, n]) - val[:, n]
        for t in range(T):
            a, w = 0.0, 1.0
            for k in range(t, T):
                a += w * deltas[k]
                if done[k, n]:
                    break
                w *= g * lam
            worst = max(worst, abs(a - adv[t, n]))
    check("advantages match a brute-force reference (no bootstrap across episode ends)", worst < 1e-4, f"max diff {worst:.2e}")


def audit_ratings():
    rng = np.random.default_rng(1)
    true = {"bot": 1000.0, "a": 1300.0, "b": 900.0, "c": 1150.0}
    keys = list(true)
    games = []
    for _ in range(6000):
        x, y = rng.choice(keys, 2, replace=False)
        p = 1 / (1 + 10 ** ((true[y] - true[x]) / 400))
        games.append({"a": x, "b": y, "score": float(rng.random() < p)})
    fit = ratings.fit(games, prior_sd=2000)
    err = max(abs(fit[k]["elo"] - true[k]) for k in keys)
    check("ratings recover known strengths from synthetic games", err < 40, f"worst error {err:.0f} Elo")
    check("rating uncertainty shrinks with games", fit["a"]["sd"] < 40, f"sd {fit['a']['sd']:.0f}")


def audit_rollout():
    """Run the real Trainer.rollout and check what it stores against the env's own accounting."""
    tmp = Run.create("audit-tmp", {}, None)
    try:
        cfg = json.loads(json.dumps(DEFAULT_CONFIG))
        cfg.update(num_envs=8, rollout=2400, eval_envs=2, action_repeat=6)
        t = Trainer(tmp, cfg, None)
        t.imported_games, t.pool = [], []
        for i in range(cfg["num_envs"]):
            t.assign(t.env, i, "bot", t.env_opp, passive=False)
        # Two rollouts back to back so episodes span the boundary, as in training.
        ep_sum = np.zeros(cfg["num_envs"])
        checked, worst = 0, 0.0
        for _ in range(2):
            B, last_val, infos, _ = t.rollout()
            by_env = {}
            for info in infos:
                by_env.setdefault(info["env"], []).append(info)
            for n in range(cfg["num_envs"]):
                done_steps = np.nonzero(B["done"][:, n])[0]
                start = 0
                for k, d in enumerate(done_steps):
                    total = ep_sum[n] + B["rew"][start:d + 1, n].sum()
                    info = by_env[n][k]
                    worst = max(worst, abs(total - info["returns"][0]))
                    checked += 1
                    ep_sum[n] = 0.0
                    start = d + 1
                ep_sum[n] += B["rew"][start:, n].sum()
            # Stored (obs, action) pairs reproduce the stored log-probs: nothing is misaligned.
            T, N = B["rew"].shape
            obs = torch.from_numpy(B["obs"].reshape(T * N, -1))
            lp, _, _ = t.policy.evaluate(obs, torch.from_numpy(B["cont"].reshape(T * N, -1)), torch.from_numpy(B["bin"].reshape(T * N, -1)))
            d = float((lp - torch.from_numpy(B["logp"].reshape(-1))).abs().max())
            check("stored observations and actions reproduce stored log-probs", d < 1e-4, f"max diff {d:.2e}")
        check("rewards stored in the rollout add up to each episode's return", checked >= 5 and worst < 1e-3, f"{checked} episodes, worst diff {worst:.2e}")
    finally:
        shutil.rmtree(tmp.dir, ignore_errors=True)


def audit_scripted_ceiling():
    """A trivial pilot that reads only its observation must be able to hit a coasting target.
    This is the proof that the instrumentation is sufficient to learn to shoot."""
    L = layout()
    SIGHT, AIM = L["gunsight"][0], L["aim_hint"][0]
    N = 16
    env = sk.VecEnv(N, 9)
    for i in range(N):
        env.set_presets(i, 2, 2)
        env.set_bot(i, 1, False)
        env.reset_env(i)
    obs = np.frombuffer(env.observe(), np.float32).reshape(N, 2, -1)
    done = [None] * N
    for _ in range(5000):
        if all(done):
            break
        o = obs[:, 0]
        cont = np.zeros((N, N_CONT), np.float32)
        cont[:, 0] = -1
        aim = o[:, AIM:AIM + 3]
        cont[:, 4] = np.clip(-aim[:, 1] * 4, -1, 1)
        cont[:, 5] = np.clip(aim[:, 0] * 4, -1, 1)
        binv = ((o[:, SIGHT] * 50 < 4) & (o[:, SIGHT + 6] < 0.5)).astype(np.float32)[:, None]
        a0 = to_env(cont, binv)
        a1 = np.zeros_like(a0)
        a1[:, 0] = -1
        ob, _, _, infos = env.step(np.stack([a0, a1], 1).astype(np.float32).tobytes())
        obs = np.frombuffer(ob, np.float32).reshape(N, 2, -1)
        for i, js in infos:
            if done[i] is None:
                done[i] = json.loads(js)
    eps = [d for d in done if d]
    shots = sum(e["shots"][0] for e in eps)
    hits = sum(e["hits"][0] for e in eps)
    check("observation-only scripted pilot hits a coasting target (through the policy's action mapping)", shots and hits / shots > 0.2, f"{hits}/{shots} hits")
    locks = sum(e["diag"][0]["missiles_locked"] for e in eps)
    check("a good shooter's missiles lock on (seeker diagnostics)", shots and locks / shots > 0.6, f"{locks}/{shots} locked")


def orbit_pilot(o, S, A, G):
    """Scripted orbit-keeper that reads only its own observation. Returns continuous controls.
    Uses efficient burns: lower the high point by braking near the low point; raise the low point
    by speeding up; brake straight in only if about to cross the zone edge."""
    N = o.shape[0]
    cont = np.zeros((N, N_CONT), np.float32)
    cont[:, 0] = -1
    vel = o[:, S:S + 3]
    to_planet = o[:, S + 6:S + 9]
    alt = o[:, S + 9] * 500
    safe = o[:, G + 1] * 800
    r = o[:, S + 11] * safe
    pr = r - alt
    vr = o[:, S + 13] * 100
    peri_alt, apo_over = o[:, S + 14] * 500, o[:, S + 15] * 500
    ra = apo_over + safe
    rp = peri_alt + pr
    prograde = vel / (np.linalg.norm(vel, axis=1, keepdims=True) + 1e-6)
    low = peri_alt < 75
    high = apo_over > -70
    near_peri = r < (rp + ra) / 2
    exiting = (r > safe - 40) & (vr > 0)
    want = np.zeros((N, 3), np.float32)
    burning = np.zeros(N, bool)
    m = low
    want[m] = prograde[m] + np.where(vr[m, None] < -5, -to_planet[m], 0)
    burning |= m
    m = ~low & high & (near_peri | exiting)
    want[m] = np.where(exiting[m, None], to_planet[m], -prograde[m])
    burning |= m
    want = want / (np.linalg.norm(want, axis=1, keepdims=True) + 1e-6)
    cont[:, 4] = np.where(burning, np.clip(-want[:, 1] * 4, -1, 1), 0)
    cont[:, 5] = np.where(burning, np.clip(want[:, 0] * 4, -1, 1), 0)
    cont[:, 0] = np.where(burning & (want[:, 2] > 0.95), 1.0, -1.0)
    # Rocks: strafe away from any asteroid predicted (straight line, 8 s) to pass close.
    for k in range(3):
        p = o[:, A + 7 * k:A + 7 * k + 3] * 500
        v = o[:, A + 7 * k + 3:A + 7 * k + 6] * 100
        rad = o[:, A + 7 * k + 6] * 30
        vv = (v * v).sum(1) + 1e-6
        tc = np.clip(-(p * v).sum(1) / vv, 0, 8)
        miss = p + v * tc[:, None]
        md = np.linalg.norm(miss, axis=1)
        danger = (rad > 0) & (md < rad + 25) & (tc > 0) & (tc < 8)
        away = -miss / (md[:, None] + 1e-6)
        for j in range(3):
            cont[:, 1 + j] = np.where(danger, np.sign(away[:, j]) * (0.5 + 0.5 * np.abs(away[:, j])), cont[:, 1 + j])
    return cont


def audit_orbit_ceiling():
    """A trivial pilot that reads only its own observation (orbit margins, velocity, direction to
    the planet, nearby rocks) must be able to stay alive through a careless opening burn and
    sudden death: proof the orbit and asteroid instrumentation is sufficient."""
    from collections import Counter
    L = layout()
    S, A, G = L["self"][0], L["asteroids"][0], L["global"][0]
    N = 24
    env = sk.VecEnv(N, 13)
    for i in range(N):
        env.set_presets(i, 2, 2)
        env.set_bot(i, 1, False)
        env.reset_env(i)
    obs = np.frombuffer(env.observe(), np.float32).reshape(N, 2, -1)
    done = [None] * N
    for step in range(5200):
        if all(done):
            break
        o = obs[:, 0]
        cont = orbit_pilot(o, S, A, G)
        if step < 10:
            cont[:, 0] = 1.0  # a careless 0.5 s opening burn (~25 m/s) wherever the nose points
        a0 = to_env(cont, np.zeros((N, 1), np.float32))
        a1 = np.zeros_like(a0)
        a1[:, 0] = -1
        ob, _, _, infos = env.step(np.stack([a0, a1], 1).astype(np.float32).tobytes())
        obs = np.frombuffer(ob, np.float32).reshape(N, 2, -1)
        for i, js in infos:
            if done[i] is None:
                done[i] = json.loads(js)
    eps = [d for d in done if d]
    deaths = [e for e in eps if e["winner"] == 1 and not e["decision"]]
    roots = Counter(e["root_cause"] for e in deaths)
    dmg = {k: np.mean([e["damage_by"][0][k] for e in eps]) for k in eps[0]["damage_by"][0]}
    check("observation-only orbit pilot survives a careless burn, rocks and sudden death", len(deaths) <= 1,
          f"destroyed in {len(deaths)}/{len(eps)} (root causes {dict(roots)}); mean hull lost by source {({k: round(v) for k, v in dmg.items() if v > 0.5})}")


def skip_pilot(o: np.ndarray, S: int) -> np.ndarray:
    """Continuous controls that fly the skip from the observation alone: nose onto the body-frame
    velocity, canopy (body +Y) away from the planet. Engine off."""
    vel = o[:, S:S + 3]
    vel = vel / np.maximum(np.linalg.norm(vel, axis=1, keepdims=True), 1e-6)
    out = -o[:, S + 6:S + 9]
    up = out - vel * np.sum(out * vel, axis=1, keepdims=True)
    up = up / np.maximum(np.linalg.norm(up, axis=1, keepdims=True), 1e-6)
    z, y = np.array([0, 0, 1.0]), np.array([0, 1.0, 0])
    rate = (np.cross(z, vel) + np.cross(y, up)) * 0.75
    cont = np.zeros((len(o), 7), np.float32)
    cont[:, 0] = -1.0
    cont[:, 4:7] = np.clip(rate, -1, 1)
    return cont


def audit_skip_ceiling():
    """A trivial pilot that reads only its own observation must be able to skip off the air:
    dry, diving from 500 m to the floor of the atmosphere, it comes back out alive with a real
    refill. Proof the attitude and air instrumentation is sufficient to learn the refuel."""
    L = layout()
    S = L["self"][0]
    alts = [10.0, 5.0, 0.0, -3.0]
    N = len(alts)
    env = sk.VecEnv(N, 17)
    for i, alt in enumerate(alts):
        env.set_presets(i, 2, 2)
        env.set_bot(i, 1, False)
        env.reset_env(i)
        env.setup_skip_dive(i, alt)
    obs = np.frombuffer(env.observe(), np.float32).reshape(N, 2, -1)
    low, out, dead = [False] * N, [None] * N, [False] * N
    for _ in range(600):
        o = obs[:, 0]
        for i in range(N):
            if dead[i]:
                continue  # the env has reset to a fresh match; the dive is over
            alt = o[i, S + 9] * 500.0  # height above the planet's surface
            low[i] = low[i] or alt < 60
            if low[i] and alt > 120 and out[i] is None:
                out[i] = (float(o[i, S + 22]), float(o[i, S + 21]))
        if all(x is not None or d for x, d in zip(out, dead)):
            break
        a0 = to_env(skip_pilot(o, S), np.zeros((N, 1), np.float32))
        a1 = np.zeros_like(a0)
        a1[:, 0] = -1
        ob, _, _, infos = env.step(np.stack([a0, a1], 1).astype(np.float32).tobytes())
        obs = np.frombuffer(ob, np.float32).reshape(N, 2, -1)
        for i, js in infos:
            if out[i] is None:
                dead[i] = True
    ok = all(x is not None and x[0] > 0.17 and x[1] > 0.9 for x in out)
    desc = ", ".join(f"{a:+.0f} m: " + ("crashed" if x is None else f"fuel {x[0]:.0%}, hull {x[1]:.0%}") for a, x in zip(alts, out))
    check("observation-only skip pilot skips off the air and refuels (through the policy's action mapping)", ok, desc)


def audit_reports():
    """Generation reports on the dashboard agree with the raw league games they came from."""
    from .store import list_runs, read_jsonl
    runs = [r for r in list_runs() if r.gen_reports()]
    if not runs:
        check("generation reports match league games", True, "no runs to check")
        return
    r = runs[0]
    games = read_jsonl(r.dir / "league.jsonl")
    worst, n = 0.0, 0
    for g in r.gen_reports():
        mine = [x for x in games if x["a"] == g["key"]]
        bot = [x["score"] for x in mine if x["b"] == "bot"]
        lg = [x["score"] for x in mine if x["b"] != "bot"]
        if bot and g.get("vs_bot") is not None:
            worst = max(worst, abs(np.mean(bot) - g["vs_bot"]))
            n += 1
        if lg and g.get("vs_league") is not None:
            worst = max(worst, abs(np.mean(lg) - g["vs_league"]))
        if g.get("matches") is not None:
            worst = max(worst, abs(len(mine) - g["matches"]))
    check(f"generation reports match league games ({r.meta().get('name')})", n > 0 and worst < 1e-9, f"{n} generations, worst diff {worst:.2g}")


PREFLIGHT = (audit_layout, audit_action_mapping, audit_policy_math, audit_gae, audit_scripted_ceiling, audit_orbit_ceiling, audit_skip_ceiling)


def preflight() -> list[str]:
    """Fast checks run before every training run. Returns the names of failed checks."""
    RESULTS.clear()
    for f in PREFLIGHT:
        try:
            f()
        except Exception as e:
            check(f.__name__, False, f"crashed: {e!r}")
    return [n for n, ok, _ in RESULTS if not ok]


def main():
    for f in (audit_layout, audit_action_mapping, audit_policy_math, audit_gae, audit_ratings, audit_scripted_ceiling, audit_orbit_ceiling, audit_skip_ceiling, audit_rollout, audit_reports):
        try:
            f()
        except Exception as e:  # a crash is a failure, not a skip
            check(f.__name__, False, f"crashed: {e!r}")
    failed = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
