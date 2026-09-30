"""League ratings: a Bradley-Terry fit over every recorded game, reported on the Elo scale.

The scripted bot is the fixed anchor at 1000, so ratings stay comparable across runs and forks.
Refitting over all games (instead of sequential Elo updates) keeps early generations' ratings
honest as later, stronger opponents play them.
"""

from __future__ import annotations

import math

import numpy as np

ANCHOR = "bot"
ANCHOR_ELO = 1000.0
SCALE = 400.0 / math.log(10.0)  # Elo points per natural-log unit of strength


def fit(games: list[dict], prior_sd: float = 400.0, iters: int = 300) -> dict[str, dict]:
    """games: [{"a": key, "b": key, "score": 1 | 0.5 | 0 (for a)}] -> {key: {elo, sd, games}}"""
    players = sorted({g["a"] for g in games} | {g["b"] for g in games} | {ANCHOR})
    idx = {p: i for i, p in enumerate(players)}
    n = len(players)
    a = np.array([idx[g["a"]] for g in games], dtype=np.int64)
    b = np.array([idx[g["b"]] for g in games], dtype=np.int64)
    s = np.array([g["score"] for g in games], dtype=np.float64)
    theta = np.zeros(n)
    anchor = idx[ANCHOR]
    prior = (SCALE / prior_sd) ** 2  # precision in natural units
    for _ in range(iters):
        p = 1.0 / (1.0 + np.exp(theta[b] - theta[a])) if len(games) else np.zeros(0)
        grad = np.zeros(n)
        hess = np.full(n, prior)
        if len(games):
            r = s - p
            np.add.at(grad, a, r)
            np.add.at(grad, b, -r)
            w = p * (1 - p)
            np.add.at(hess, a, w)
            np.add.at(hess, b, w)
        grad -= prior * theta
        step = grad / hess
        step[anchor] = 0.0
        theta += np.clip(step, -1.0, 1.0)
        theta -= theta[anchor]
        if np.abs(step).max() < 1e-6:
            break
    counts = np.zeros(n, dtype=np.int64)
    np.add.at(counts, a, 1)
    np.add.at(counts, b, 1)
    p = 1.0 / (1.0 + np.exp(theta[b] - theta[a])) if len(games) else np.zeros(0)
    info = np.full(n, prior)
    if len(games):
        w = p * (1 - p)
        np.add.at(info, a, w)
        np.add.at(info, b, w)
    out = {}
    for pl, i in idx.items():
        out[pl] = {
            "elo": float(ANCHOR_ELO + theta[i] * SCALE),
            "sd": 0.0 if i == anchor else float(SCALE / math.sqrt(info[i])),
            "games": int(counts[i]),
        }
    return out
