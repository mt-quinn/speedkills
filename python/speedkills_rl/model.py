"""Policy network: one design-conditioned actor-critic that flies every ship.

Action layout (matches `crates/sim/src/rl.rs`):
    continuous (Gaussian, clipped to [-1, 1]): thrust (<= 0 is off), strafe x/y/z (dead zone),
        pitch/yaw/roll rate
    binary (Bernoulli): fire the mass driver
"""

from __future__ import annotations

import math

import numpy as np
import torch
from torch import nn
from torch.distributions import Bernoulli, Normal

N_CONT = 7
N_BIN = 1
# Floor on the controls' log std: exploration never collapses (std >= ~0.2).
LOG_STD_MIN = -1.6


class RunningNorm(nn.Module):
    """Observation normalizer with running mean/variance, saved with the weights."""

    def __init__(self, dim: int, clip: float = 8.0):
        super().__init__()
        self.register_buffer("mean", torch.zeros(dim))
        self.register_buffer("var", torch.ones(dim))
        self.register_buffer("count", torch.tensor(1e-4))
        self.clip = clip

    @torch.no_grad()
    def update(self, x: torch.Tensor) -> None:
        b_mean, b_var, b_n = x.mean(0), x.var(0, unbiased=False), x.shape[0]
        delta = b_mean - self.mean
        tot = self.count + b_n
        self.mean += delta * b_n / tot
        m2 = self.var * self.count + b_var * b_n + delta.pow(2) * self.count * b_n / tot
        self.var = m2 / tot
        self.count = tot

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return ((x - self.mean) / torch.sqrt(self.var + 1e-8)).clamp(-self.clip, self.clip)


def mlp(i: int, h: int, o: int) -> nn.Sequential:
    net = nn.Sequential(nn.Linear(i, h), nn.Tanh(), nn.Linear(h, h), nn.Tanh(), nn.Linear(h, o))
    for m in net:
        if isinstance(m, nn.Linear):
            nn.init.orthogonal_(m.weight, np.sqrt(2))
            nn.init.zeros_(m.bias)
    return net


class Policy(nn.Module):
    def __init__(self, obs_dim: int, hidden: int = 256):
        super().__init__()
        self.obs_dim, self.hidden = obs_dim, hidden
        self.norm = RunningNorm(obs_dim)
        self.actor = mlp(obs_dim, hidden, N_CONT + N_BIN)
        self.critic = mlp(obs_dim, hidden, 1)
        # Modest initial randomness, so "off" (engine, strafe dead zones) really means off.
        self.log_std = nn.Parameter(torch.full((N_CONT,), -1.0))
        with torch.no_grad():
            last = self.actor[-1]
            last.weight.mul_(0.01)
            # Start with the engine off (propellant is scarce; thrust <= 0 means off) and
            # trigger-shy (ammo is scarce).
            last.bias[0] = -0.8
            # ~3% chance per decision: the magazine isn't dumped before aiming is learned.
            last.bias[N_CONT] = -3.5
            nn.init.orthogonal_(self.critic[-1].weight, 1.0)

    def std_log(self) -> torch.Tensor:
        """Exploration floor: the controls' noise never collapses below std ~0.2."""
        return self.log_std.clamp(min=LOG_STD_MIN)

    def _heads(self, obs: torch.Tensor):
        x = self.norm(obs)
        out = self.actor(x)
        mu, logits = out[:, :N_CONT], out[:, N_CONT:]
        return Normal(mu, self.std_log().exp().expand_as(mu)), Bernoulli(logits=logits), self.critic(x).squeeze(-1)

    @torch.inference_mode()
    def act(self, obs: np.ndarray, deterministic: bool = False, sample_triggers: bool = True):
        """Returns (env_action [N,8], cont [N,7], bin [N,1], logp [N], value [N]) as numpy.

        `deterministic` uses the mean for continuous controls. Triggers are still sampled by
        default: a rare action (a ~3% per-decision shot) is never the argmax, so thresholding
        would make an evaluated policy that never fires. A lean path (no distribution objects):
        this runs every decision, for every ship."""
        o = torch.from_numpy(np.ascontiguousarray(obs, dtype=np.float32))
        x = self.norm(o)
        out = self.actor(x)
        mu, logits = out[:, :N_CONT], out[:, N_CONT:]
        value = self.critic(x).squeeze(-1)
        log_std = self.std_log()
        cont = mu if deterministic else mu + torch.randn_like(mu) * log_std.exp()
        if deterministic and not sample_triggers:
            binv = (logits > 0).float()
        else:
            binv = (torch.rand_like(logits) < torch.sigmoid(logits)).float()
        z = (cont - mu) / log_std.exp()
        logp = (-0.5 * z * z - log_std - 0.5 * math.log(2 * math.pi)).sum(-1)
        logp = logp + (binv * logits - torch.nn.functional.softplus(logits)).sum(-1)
        return to_env(cont.numpy(), binv.numpy()), cont.numpy(), binv.numpy(), logp.numpy(), value.numpy()

    def evaluate(self, obs: torch.Tensor, cont: torch.Tensor, binv: torch.Tensor):
        cont_d, bin_d, value = self._heads(obs)
        logp = cont_d.log_prob(cont).sum(-1) + bin_d.log_prob(binv).sum(-1)
        ent = cont_d.entropy().sum(-1) + bin_d.entropy().sum(-1)
        return logp, ent, value

    def means(self, obs: torch.Tensor) -> torch.Tensor:
        """Mean continuous controls (with gradient), for imitation terms."""
        return self.actor(self.norm(obs))[:, :N_CONT]

    def spec(self) -> dict:
        return {"obs_dim": self.obs_dim, "hidden": self.hidden}


def to_env(cont: np.ndarray, binv: np.ndarray) -> np.ndarray:
    c = np.clip(cont, -1.0, 1.0)
    a = np.empty((c.shape[0], N_CONT + N_BIN), np.float32)
    a[:, :N_CONT] = c  # engine (<=0 off), strafe (dead zone in the sim), body rates
    a[:, N_CONT:] = binv  # fire
    return a


def load_policy(path: str) -> Policy:
    ck = torch.load(path, map_location="cpu", weights_only=False)
    p = Policy(**ck["spec"])
    p.load_state_dict(ck["model"])
    p.eval()
    return p
