// Match recordings: load, index, interpolate.
import * as THREE from 'three';

export const PART_NAMES = ['drive', 'rcs_bow_port', 'rcs_bow_stbd', 'rcs_stern_port', 'rcs_stern_stbd', 'reactor', 'sensors', 'pdc_dorsal', 'pdc_port', 'pdc_stbd', 'launcher', 'railgun'];
export const PART_LABEL = {
  drive: 'drive', rcs_bow_port: 'bow thrusters', rcs_bow_stbd: 'bow thrusters', rcs_stern_port: 'stern thrusters',
  rcs_stern_stbd: 'stern thrusters', reactor: 'reactor', sensors: 'sensors', pdc_dorsal: 'dorsal PDC', pdc_port: 'port PDC',
  pdc_stbd: 'starboard PDC', launcher: 'torpedo launcher', railgun: 'railgun',
};

// The league (roster, crews, odds), if this card is a league card.
export async function loadLeague() {
  try { const r = await fetch('league.json'); return r.ok ? r.json() : null; } catch (e) { return null; }
}

export async function loadIndex() {
  const r = await fetch('matches/index.json');
  return r.json();
}

export async function loadMatch(file) {
  const r = await fetch('matches/' + file);
  const m = await r.json();
  return new Match(m);
}

const v = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const q = (a) => new THREE.Quaternion(a[1], a[2], a[3], a[0]);

export class Match {
  constructor(raw) {
    this.raw = raw;
    this.hz = raw.hz;
    this.frames = raw.frames;
    this.events = raw.events;
    this.duration = this.frames[this.frames.length - 1].t;
    this.ships = raw.ships;
    this.params = raw.params;
    // Events by kind, for the director's look-ahead.
    this.byKind = {};
    for (const e of this.events) (this.byKind[e.k] ||= []).push(e);
    // Health index timeline (from the summary, 1 Hz) for the tug and the story.
    this.health = raw.summary.health;
    this.exchanges = this.findExchanges();
    this.pdcBursts = this.findBursts();
    this.measures = this.findMeasures();
  }

  // Measurement moments: railgun rounds that missed (closest approach to their target, as an
  // offset from the target, refined between frames) and close passes between the ships (local
  // minima of separation under 300 m, at least 4 s apart).
  findMeasures() {
    const out = [], F = this.frames;
    const hit = new Set(this.events.filter((e) => e.k === 'rail_hit').map((e) => e.id));
    const best = new Map();
    for (let k = 0; k < F.length; k++) {
      for (const o of F[k].sl) {
        if (hit.has(o[0])) continue;
        const tgt = F[k].s[1 - o[1]];
        // Closest approach within this frame step (relative motion, straight line).
        const rel = v(o[2]).sub(v(tgt.p)), rv = v(o[3]).sub(v(tgt.v));
        const u = Math.max(0, Math.min(1 / this.hz, -rel.dot(rv) / Math.max(1e-6, rv.lengthSq())));
        const off = rel.clone().addScaledVector(rv, u);
        const d = off.length();
        const b = best.get(o[0]);
        if (!b || d < b.gap) best.set(o[0], { kind: 'miss', t: F[k].t + u, gap: d, off, dir: v(o[3]).normalize(), ship: 1 - o[1], owner: o[1] });
      }
    }
    for (const b of best.values()) if (b.gap < 600) out.push(b);
    let last = -99;
    for (let k = 1; k < F.length - 1; k++) {
      const d = (j) => v(F[j].s[0].p).distanceTo(v(F[j].s[1].p));
      const dk = d(k);
      if (dk < 300 && dk < d(k - 1) && dk <= d(k + 1) && F[k].t - last > 4 && F[k].s[0].alive && F[k].s[1].alive) {
        out.push({ kind: 'pass', t: F[k].t, gap: dk, a: v(F[k].s[0].p), b: v(F[k].s[1].p) });
        last = F[k].t;
      }
    }
    return out.sort((x, y) => x.t - y.t);
  }

  // Damage in integrity points (100 = a whole ship): the scoreboard's own weighting of hull,
  // components and crew.
  points(e) {
    const H = this.frames[0].s[e.ship].hull;
    return 100 * (0.4 * e.hull / H + 0.4 * e.parts / 12 + 0.2 * e.crew / 4);
  }

  // Exchanges: the fight split into rounds by activity. Shots, launches, kills, damage and PDC
  // fire on a ship are activity; a gap of 4 s with none ends the exchange. Exchanges that did
  // less than 3 points between them are skirmishes, not scored. Each is won by damage dealt,
  // and named by the weapon that did most of it (≥60%) when there is one.
  findExchanges() {
    const GAP = 4, act = [];
    for (const e of this.events) if (['damage', 'rail_fire', 'torp_launch', 'torp_down'].includes(e.k)) act.push(e.t);
    for (let k = 0; k < this.frames.length; k += 15) if (this.frames[k].s.some((s) => s.pdc.some((p) => p[3]))) act.push(this.frames[k].t);
    act.sort((a, b) => a - b);
    const cl = [];
    for (const t of act) { if (cl.length && t - cl[cl.length - 1].t1 < GAP) cl[cl.length - 1].t1 = t; else cl.push({ t0: t, t1: t }); }
    const out = [];
    for (const c of cl) {
      const dmg = [0, 0], by = [{}, {}], hits = [];
      for (const e of this.events) {
        if (e.k !== 'damage' || e.t < c.t0 - 1e-6 || e.t > c.t1 + 1e-6) continue;
        const who = 1 - e.ship, p = this.points(e);
        dmg[who] += p; by[who][e.cause] = (by[who][e.cause] || 0) + p;
        hits.push({ t: e.t, who, p });
      }
      const tot = dmg[0] + dmg[1];
      if (tot < 3) continue;
      const w = {};
      for (const b of by) for (const k in b) w[k] = (w[k] || 0) + b[k];
      const top = Object.entries(w).sort((a, b) => b[1] - a[1])[0];
      const kind = top[1] / tot >= 0.6 ? ({ torpedo: 'torpedo trade', railgun: 'gun duel', pdc: 'close-in brawl' }[top[0]] || 'exchange') : 'exchange';
      const winner = Math.abs(dmg[0] - dmg[1]) < 1 ? null : dmg[0] > dmg[1] ? 0 : 1;
      out.push({ n: out.length + 1, t0: c.t0, t1: c.t1, dmg, by, kind, winner, hits });
    }
    return out;
  }
  exchangeAt(t) { return this.exchanges.find((x) => t >= x.t0 - 1e-6 && t <= x.t1 + 1.5) || null; }
  // Running score of an exchange at time t.
  exchangeScore(x, t) { const d = [0, 0]; for (const h of x.hits) if (h.t <= t) d[h.who] += h.p; return d; }

  // PDC bursts, per ship: at the enemy ship (rounds fired and rounds that landed) and at
  // torpedoes (engaged and shot down). Rounds: the mounts' cyclic rate, PDC_RPS rounds a second
  // each while firing; every recorded PDC hit is one round landing.
  findBursts() {
    const RPS = 60, dtF = 1 / this.hz, out = [[], []];
    for (let i = 0; i < 2; i++) {
      for (const mode of ['ship', 'torp']) {
        let cur = null;
        for (const f of this.frames) {
          const mounts = f.s[i].alive ? f.s[i].pdc.filter((p) => (mode === 'ship' ? p[3] : p[2] >= 0 && !p[3])) : [];
          if (mounts.length) {
            if (!cur || f.t - cur.t1 > 0.6) { cur = { mode, t0: f.t, t1: f.t, cum: [], targets: new Set() }; out[i].push(cur); }
            cur.t1 = f.t;
            const prev = cur.cum.length ? cur.cum[cur.cum.length - 1][1] : 0;
            cur.cum.push([f.t, prev + mounts.length * RPS * dtF]);
            for (const p of mounts) if (p[2] >= 0) cur.targets.add(p[2]);
          }
        }
      }
      for (const b of out[i]) {
        b.hitT = this.events.filter((e) => (b.mode === 'ship' ? e.k === 'pdc_hit' && e.victim === 1 - i : e.k === 'torp_down' && e.by === i) && e.t >= b.t0 - 1e-6 && e.t <= b.t1 + 0.3).map((e) => e.t);
      }
      out[i] = out[i].filter((b) => (b.mode === 'ship' ? b.cum[b.cum.length - 1][1] >= 15 : b.targets.size > 0));
    }
    return out;
  }
  // The burst a ship's PDCs are in at t (or just finished, held 2 s), with its running tally.
  burstAt(i, t) {
    const b = this.pdcBursts[i].filter((x) => t >= x.t0 && t <= x.t1 + 2).pop();
    if (!b) return null;
    let rounds = 0;
    for (const [ft, r] of b.cum) { if (ft > t) break; rounds = r; }
    const hits = b.hitT.filter((x) => x <= t).length;
    return { mode: b.mode, rounds: Math.round(rounds), hits, engaged: b.targets.size, done: t > b.t1 };
  }

  // Frame index at or before t.
  idx(t) {
    // (The final frame is written at the exact tick the fight ended, off the 30 Hz grid.)
    if (t >= this.frames[this.frames.length - 1].t - 1e-6) return this.frames.length - 1;
    const i = Math.floor(t * this.hz + 1e-6);
    return Math.max(0, Math.min(this.frames.length - 1, i));
  }

  frameAt(t) { return this.frames[this.idx(t)]; }

  // Interpolated state of ship i at time t (after the end: coasting on from the final state).
  ship(t, i) {
    if (t > this.duration) {
      const a = this.frames[this.frames.length - 1].s[i];
      const vel = v(a.v);
      return { raw: a, pos: v(a.p).addScaledVector(vel, t - this.duration), vel, acc: new THREE.Vector3(), quat: q(a.q) };
    }
    const k = this.idx(t);
    const a = this.frames[k].s[i];
    const b = this.frames[Math.min(k + 1, this.frames.length - 1)].s[i];
    const f = Math.max(0, Math.min(1, t * this.hz - k));
    const pos = v(a.p).lerp(v(b.p), f);
    const vel = v(a.v).lerp(v(b.v), f);
    const acc = v(a.a).lerp(v(b.a), f);
    const quat = q(a.q).slerp(q(b.q), f);
    return { raw: f < 0.5 ? a : b, pos, vel, acc, quat };
  }

  // Interpolated projectiles: [{id, owner, pos, vel, ...}]
  objects(t, key) {
    if (t > this.duration) {
      // After the end: whatever was in flight carries on, fading (`fade` 1 → 0 over 2 s).
      const dt = t - this.duration;
      if (dt > 2) return [];
      return this.frames[this.frames.length - 1][key].map((o) => {
        const vel = key === 'db' ? null : v(o[3]);
        const pos = vel ? v(o[2]).addScaledVector(vel, dt) : v(o[2]);
        return { id: o[0], owner: o[1], pos, vel, extra: key === 'db' ? o[3] : o[4], fade: 1 - dt / 2 };
      });
    }
    const k = this.idx(t);
    const A = this.frames[k][key];
    const B = this.frames[Math.min(k + 1, this.frames.length - 1)][key];
    const f = Math.max(0, Math.min(1, t * this.hz - k));
    const next = new Map(B.map((o) => [o[0], o]));
    // Records: torpedo/slug [id, owner, [x,y,z], [vx,vy,vz], (power)]; debris [id, target, [x,y,z], sigma].
    return A.map((o) => {
      const n = next.get(o[0]);
      const p0 = v(o[2]);
      const vel = key === 'db' ? null : v(o[3]);
      const pos = n ? p0.lerp(v(n[2]), f) : vel ? p0.addScaledVector(vel, f / this.hz) : p0;
      return { id: o[0], owner: o[1], pos, vel, extra: key === 'db' ? o[3] : o[4] };
    });
  }

  eventsBetween(t0, t1) {
    // Events are time-sorted.
    const out = [];
    for (const e of this.events) {
      if (e.t > t1) break;
      if (e.t > t0) out.push(e);
    }
    return out;
  }

  healthAt(t) {
    const h = this.health;
    const i = Math.min(h.length - 1, Math.floor(t));
    const j = Math.min(h.length - 1, i + 1);
    const f = Math.min(1, t - Math.floor(t));
    return [h[i][0] + (h[j][0] - h[i][0]) * f, h[i][1] + (h[j][1] - h[i][1]) * f];
  }
}
