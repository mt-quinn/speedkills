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

### Player accounts

Hard Burn uses Better Auth on Cloudflare D1 for production email/password sessions, with its frontend on Vercel. See [backend operations and migration evidence](cloudflare/README.md). The Convex implementation remains available for development and the frozen recovery copy. Guests can watch fights, browse results and read chat. Betting, a wallet, sponsorship, scouting, renaming and sending/moderating chat require a signed-in account. Usernames are case-insensitively unique (3–24 letters, numbers or underscores) and are the chat identity. New accounts receive 500 credits once.

Player records are indexed by authenticated user ID, not a browser secret. Creating an account with “Keep this browser’s existing credits and ship” claims the previous `hb-session` record atomically, preserving its player ID, balance, ship, ledger, wagers and pending candidate. It does not issue a second welcome grant. The old bearer token is erased. Logging in to an existing account never merges another browser’s wallet. Device settings, volume and ship colors remain local. Existing production accounts retain the same email, password and progress after migration; users sign in again because old sessions are not imported.

The retained Convex deployments use independent `JWT_PRIVATE_KEY` and `JWKS` values, configured according to the [manual auth setup](https://labs.convex.dev/auth/setup/manual). These were configured on dev and prod during the account rollout. Never commit private keys or rotate them casually; rotation invalidates current access tokens.

Password-reset support uses Resend and an eight-digit code valid for ten minutes. To enable the recovery UI, set **both** `AUTH_RESEND_KEY` and `AUTH_EMAIL_FROM` as secrets on each relevant Cloudflare API Worker (or on Convex when testing that backend). The sender must be a verified Resend sender. Until email delivery is configured, password reset is unavailable; email/password registration and login still work. Email verification at signup is not enabled. Resetting a password revokes other sessions; game mutations also check the session record so sign-out revokes account access immediately.

Verification: `npm run test:cloudflare` covers production account compatibility, economy, queued preparation, sockets and replay privacy. `npm run test:backend` exercises the real auth actions with `convex-test`; `node tools/verify-accounts.mjs` creates a disposable **dev-only** test account and checks actual signup, cross-device identity, token refresh and revocation. It writes temporary login credentials with mode 0600 to `/private/tmp/hb-account-test-login.json`; remove that file after any browser check. This script never posts chat or places bets.
