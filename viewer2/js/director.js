// The broadcast director: where the camera is, and when time slows down.
import * as THREE from 'three';

const DEG = Math.PI / 180;

// Critically damped spring toward a target (scalar).
class Spring {
  constructor(x, tau) { this.x = x; this.v = 0; this.tau = tau; }
  step(target, dt) {
    const w = 2 / this.tau;
    const a = w * w * (target - this.x) - 2 * w * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
}
class Spring3 {
  constructor(p, tau) { this.s = [new Spring(p.x, tau), new Spring(p.y, tau), new Spring(p.z, tau)]; }
  step(t, dt) { return new THREE.Vector3(this.s[0].step(t.x, dt), this.s[1].step(t.y, dt), this.s[2].step(t.z, dt)); }
  get value() { return new THREE.Vector3(this.s[0].x, this.s[1].x, this.s[2].x); }
}
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Director {
  constructor(match, scene) {
    this.match = match;
    this.scene = scene;
    this.az = null; // camera azimuth around the plane's up
    this.el = new Spring(24 * DEG, 1.6);
    this.dist = new Spring(4000, 2.5);
    this.azS = null;
    this.look = new Spring3(new THREE.Vector3(), 1.4);
    this.slowmo = this.planSlowmo();
    this.timeScale = 1;
  }

  // Pick the defining moments and schedule slow motion around them, within a budget.
  planSlowmo() {
    const m = this.match;
    const ev = m.events;
    const fireT = new Map();
    for (const e of ev) if (e.k === 'rail_fire') fireT.set(e.id, e.t);
    // Big damage events: look at the Damage event that follows each hit.
    const cands = [];
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      if (e.k !== 'damage') continue;
      const big = e.hull >= 90 || e.parts >= 0.6 || e.crew > 0;
      if (!big) continue;
      // The hit event just before it (same t).
      let hit = null;
      for (let j = i - 1; j >= 0 && ev[j].t >= e.t - 1e-6; j--) if (['rail_hit', 'torp_hit', 'debris_hit'].includes(ev[j].k)) { hit = ev[j]; break; }
      if (!hit) continue;
      const start = hit.k === 'rail_hit' && fireT.has(hit.id) ? fireT.get(hit.id) - 0.1 : e.t - 0.6;
      cands.push({ t0: start, t1: e.t + 0.5, at: e.t, weight: e.hull + 200 * e.parts + 150 * e.crew, kind: hit.k, victim: hit.victim });
    }
    // The killing blow always gets one.
    const end = ev.find((e) => e.k === 'end');
    const lastDmg = [...ev].reverse().find((e) => e.k === 'damage' && end && e.t <= end.t + 1e-6);
    const picked = [];
    if (lastDmg && end && end.winner !== null) {
      const fire = [...ev].reverse().find((e) => e.k === 'rail_fire' && e.t <= lastDmg.t && e.t > lastDmg.t - 3);
      // (At most 1.2 s of lead-in: a long flight to the killing blow would eat a short fight's budget.)
      picked.push({ t0: Math.max((fire ? fire.t : lastDmg.t - 0.6) - 0.1, lastDmg.t - 1.2), t1: end.t + 0.8, at: lastDmg.t, weight: 1e9, kill: true });
    }
    cands.sort((a, b) => b.weight - a.weight);
    // Budget in watching time: slowed play at 1/3 speed costs three seconds per match second.
    // Keep slowed play to ≤10% of the broadcast's running time.
    const wall = (w) => (w.t1 - w.t0) / (w.kill ? 0.3 : 0.4) + 0.8; // (+ ramps)
    let slowed = picked.reduce((s, w) => s + wall(w), 0);
    let total = m.duration + picked.reduce((s, w) => s + wall(w) - (w.t1 - w.t0), 0);
    for (const c of cands) {
      if (picked.some((p) => Math.abs(p.at - c.at) < 20)) continue;
      const add = wall(c);
      if ((slowed + add) / (total + add - (c.t1 - c.t0)) > 0.10) continue;
      picked.push(c);
      slowed += add; total += add - (c.t1 - c.t0);
    }
    return picked.sort((a, b) => a.t0 - b.t0);
  }

  // Time scale at match time t (ramped in and out).
  scaleAt(t) {
    for (const w of this.slowmo) {
      if (t < w.t0 - 0.4 || t > w.t1 + 0.4) continue;
      const k = t < w.t0 ? (w.t0 - t) / 0.4 : t > w.t1 ? (t - w.t1) / 0.4 : 0;
      const slow = w.kill ? 0.3 : 0.4;
      return slow + (1 - slow) * Math.min(1, k);
    }
    return 1;
  }
  activeSlowmo(t) { return this.slowmo.find((w) => t >= w.t0 && t <= w.t1) || null; }

  // Subjects the frame must hold: the ships, plus live threats.
  subjects(t, st) {
    const pts = [st.ships[0].pos, st.ships[1].pos];
    // Ordnance counts for framing only while it's still coming at its target: anything that has
    // gone past is still drawn, but never holds the shot wide.
    for (const tp of this.match.objects(t, 'tp')) {
      const target = st.ships[1 - tp.owner];
      const toT = target.pos.clone().sub(tp.pos);
      const closing = toT.dot(tp.vel.clone().sub(target.vel)) > 0;
      if (closing && toT.length() < 2000) pts.push(tp.pos);
    }
    // A round only while it's still coming at its target and near the fight (a miss flies on
    // for kilometres; following it would shrink the fight to a speck).
    const sep = st.ships[0].pos.distanceTo(st.ships[1].pos);
    for (const sl of this.match.objects(t, 'sl')) {
      const target = st.ships[1 - sl.owner];
      const toT = target.pos.clone().sub(sl.pos);
      if (toT.dot(sl.vel.clone().sub(target.vel)) > 0 && toT.length() < 1.2 * sep + 500) pts.push(sl.pos);
    }
    return pts;
  }

  // How much of the ships' separation a view from azimuth `a`, elevation `el` shows on screen.
  shownFrom(a, el, axis, ref, ref2, up) {
    const d = ref.clone().multiplyScalar(Math.cos(a) * Math.cos(el)).addScaledVector(ref2, Math.sin(a) * Math.cos(el)).addScaledVector(up, Math.sin(el));
    return axis.clone().sub(d.multiplyScalar(axis.dot(d))).length() / Math.max(1, axis.length());
  }

  update(t, st, dt) {
    const sc = this.scene;
    const up = sc.up;
    const mid = sc.mid;
    const pts = this.subjects(t, st).map((p) => p.clone().sub(mid));
    // Framing centre: the ships' middle, pulled a little toward live threats.
    const centre = new THREE.Vector3();
    pts.forEach((p, k) => centre.addScaledVector(p, k < 2 ? 1 : 0.35));
    centre.multiplyScalar(1 / (2 + 0.35 * (pts.length - 2)));
    // Ship axis in the plane → camera azimuth across it (never along it).
    const axis = st.ships[1].pos.clone().sub(st.ships[0].pos);
    const axisFlat = axis.clone().sub(up.clone().multiplyScalar(axis.dot(up)));
    const ref = new THREE.Vector3(1, 0, 0).applyQuaternion(sc.planeQuat);
    const ref2 = new THREE.Vector3(0, 0, 1).applyQuaternion(sc.planeQuat);
    const axisAz = Math.atan2(axisFlat.dot(ref2), axisFlat.dot(ref));
    // Slow drift so objects at different depths slide past each other (never still, never spinning).
    const drift = 32 * DEG * Math.sin(t * 0.045) + 14 * DEG * Math.sin(t * 0.11 + 1.3);
    // Portrait screens are tall: there the camera sits closer to the ships' line and higher, so
    // their separation runs up the screen instead of across it (blended by aspect).
    const cam = sc.camera;
    const portrait = Math.max(0, Math.min(1, (1.2 - cam.aspect) / 0.6));
    // The offset from the ships' line: in portrait the smallest (most upright) of 25°, 45°, 65°
    // that still shows at least 55% of their separation on screen — judged from the candidate
    // view, not the camera (no feedback) — with hysteresis so it doesn't flicker.
    let off = 90 * DEG;
    if (portrait > 0.5) {
      const elP = (42 + 10 * Math.abs(axis.dot(up)) / Math.max(1, axis.length())) * DEG;
      const shown = (o) => Math.max(...[o, -o, Math.PI + o, Math.PI - o].map((a0) => this.shownFrom(axisAz + a0, elP, axis, ref, ref2, up)));
      this.elP = elP;
      const opts = [25, 45, 65, 90];
      const better = opts.find((o) => o < (this.pOff ?? 99) && shown(o * DEG) >= 0.65);
      const keep = this.pOff && shown(this.pOff * DEG) >= 0.45 ? this.pOff : null;
      this.pOff = better ?? keep ?? opts.find((o) => shown(o * DEG) >= 0.55) ?? 90;
      off = (90 - (90 - this.pOff) * Math.min(1, (portrait - 0.5) * 2)) * DEG;
    }
    const cands = [axisAz + off, axisAz - off, axisAz + Math.PI + off, axisAz + Math.PI - off].map((a) => a + drift * (1 - 0.6 * portrait));
    if (this.az === null) { this.az = cands[0]; this.azS = new Spring(cands[0], 2.2); }
    // Choose the candidate nearest where we are, so the camera never swings round.
    // (In portrait, only sides that actually show the ships apart: with the ships' line tilted,
    // looking down from one side can be almost along it.)
    const good = portrait > 0.5 ? cands.filter((a) => this.shownFrom(a, this.elP, axis, ref, ref2, up) >= 0.5) : cands;
    let target = (good.length ? good : cands).reduce((b, a) => (Math.abs(wrap(a - this.azS.x)) < Math.abs(wrap(b - this.azS.x)) ? a : b));
    target = this.azS.x + wrap(target - this.azS.x);
    // Never chase a merge round the fight: cap the swing at 12°/s and let a fast pass cross the
    // frame (the lift below raises the camera so height keeps the ships apart meanwhile).
    const az0 = this.azS.x;
    let az = this.azS.step(target, dt);
    const cap = 12 * DEG * dt;
    if (Math.abs(az - az0) > cap) { az = az0 + Math.sign(az - az0) * cap; this.azS.x = az; this.azS.v = Math.sign(this.azS.v) * Math.min(Math.abs(this.azS.v), 12 * DEG); }
    // Elevation: low enough that stalks read as height, high enough that footprints spread out.
    const heightSpread = Math.abs(axis.dot(up)) / Math.max(1, axis.length());
    // If the view is drifting toward the ships' line (a fast merge), look down on them more:
    // height separates them on screen where azimuth can't.
    // (Judged from the azimuth against the ships' line — not from the camera itself, which would
    // feed the lift back into the view and make it oscillate.)
    const axisN = axis.clone().normalize();
    const flatAlong = Math.abs(Math.cos(az - axisAz)) * Math.sqrt(Math.max(0, 1 - axisN.dot(up) ** 2));
    const lift = (flatAlong > 0.6 ? Math.min(1, (flatAlong - 0.6) / 0.25) : 0) * (1 - portrait);
    const elT = (20 + 22 * portrait + 8 * Math.sin(t * 0.07) + 10 * heightSpread + 38 * lift) * DEG;
    const el = this.el.step(elT, dt);
    const dir = ref.clone().multiplyScalar(Math.cos(az) * Math.cos(el)).addScaledVector(ref2, Math.sin(az) * Math.cos(el)).addScaledVector(up, Math.sin(el));
    // Distance: fit every subject into the stage (the part of the screen the overlay leaves
    // clear), each screen axis on its own, with margin; the change in distance is rate-limited
    // (framing, never a zoom). The projection centre is shifted to the stage's middle.
    const W = window.innerWidth, H = window.innerHeight;
    const stage = sc.stage || { top: 0, bottom: H, left: 0, right: W };
    const sH = Math.max(100, stage.bottom - stage.top), sW = Math.max(100, stage.right - stage.left);
    cam.setViewOffset(W, H, (W / 2) - (stage.left + stage.right) / 2, (H / 2) - (stage.top + stage.bottom) / 2, W, H);
    const vfov = cam.fov * DEG;
    const tanY = Math.tan(vfov / 2) * (sH / H), tanX = Math.tan(vfov / 2) * cam.aspect * (sW / W);
    const M = 0.74;
    // Camera basis for this view direction.
    const fwd = dir.clone().negate(), right = fwd.clone().cross(up).normalize(), camUp = right.clone().cross(fwd).normalize();
    // Lead the action: frame where the ships will be in 0.8 s as well as where they are (it's a
    // recording — the director can know), so a fast separation is framed before it happens.
    const ahead = Math.min(this.match.duration, t + 0.8);
    const fit = [...pts.map((p, k) => ({ p, ship: k < 2 })), ...[0, 1].map((i) => ({ p: this.match.ship(ahead, i).pos.clone().sub(mid), ship: true }))];
    // Never frame so wide that the ships themselves become small: threats can widen the shot
    // up to about the ships' own separation, no further.
    const shipR = Math.max(pts[0].distanceTo(centre), pts[1].distanceTo(centre));
    const capR = Math.max(shipR * 1.5, shipR + 200);
    let want = 1100;
    for (const f of fit) {
      let v = f.p.clone().sub(centre);
      if (!f.ship && v.length() > capR) v.setLength(capR);
      const x = Math.abs(v.dot(right)), y = Math.abs(v.dot(camUp)), z = v.dot(dir);
      want = Math.max(want, z + x / (tanX * M), z + y / (tanY * M));
    }
    if (!this.started) {
      // Open already framed: no settling from a guess.
      this.started = true;
      this.dist.x = want; this.look.s.forEach((sp, k) => { sp.x = centre.getComponent(k); });
    }
    const cur = this.dist.x;
    // Pull back briskly when the frame needs it (1 s spring, up to 80%/s); ease in more gently
    // (1.6 s, 35%/s). Easing out is what keeps the action in frame; easing in is what keeps it calm.
    const out = want > cur;
    this.dist.tau = out ? 1.0 : 1.6;
    const maxRate = (out ? 0.8 : 0.35) * cur;
    const d = this.dist.step(Math.min(cur + maxRate, Math.max(cur - maxRate, want)), dt);
    const look = this.look.step(centre, dt);
    cam.position.copy(look).addScaledVector(dir, d);
    cam.up.copy(up);
    cam.lookAt(look);
    this.timeScale = this.scaleAt(t);
    return { az, el, d, look };
  }
}
