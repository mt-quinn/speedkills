// The broadcast director: where the camera is, and when time slows down.
import * as THREE from 'three';
import { CameraDrones, CAMERA_RIGS } from './camera-drones.js';

const DEG = Math.PI / 180;

export class Director {
  constructor(match, scene) {
    this.match = match;
    this.scene = scene;
    this.engine = new CameraDrones(match, scene.up, this.viewport(), window.__cameraTuning, !!window.__opt?.cameraLab);
    scene.cameraEngine = this.engine;
    this.lastCut = -1;
    this.manualRig = null;
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
    // No slow motion on the killing blow, nor on anything in the last 3 s before it: time
    // slowing down on a ship that's low would give the ending away.
    const picked = [];
    if (end) for (let k = cands.length - 1; k >= 0; k--) if (cands[k].t1 > end.t - 3) cands.splice(k, 1);
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
    const torpedoes = this.match.objects(t, 'tp');
    for (const tp of torpedoes) {
      const target = tp.extra != null ? torpedoes.find(other => other.id === tp.extra) : st.ships[1 - tp.owner];
      if (!target) continue;
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

  viewport() {
    return { width: window.innerWidth, height: window.innerHeight, stage: this.scene.stage };
  }

  update(t, st, dt) {
    const sc = this.scene, cam = sc.camera, up = sc.up;
    this.engine.configure(this.viewport());
    let shot = this.engine.at(t);
    if (window.__opt?.cameraLab && window.__cameraMonitor != null) {
      const index = window.__cameraMonitor, d = this.engine.drones[index];
      shot = { ...shot, rig: index, pos: d.pos.clone(), quat: d.quat.clone(), fov: d.fov, focus: d.focus, aperture: d.aperture, sizeScale: d.sizeScale, target: d.target.clone(), purpose: d.purpose, focusKey: d.focusKey, aimError: d.aimError, focusError: Math.abs(d.focus-d.focusWanted)/Math.max(1,d.focusWanted) };
    }
    if (window.__cameraFocusOff) shot.aperture = 0;
    const manual = this.user?.engaged;
    if (!manual && this.wasManual && this.lastApplied) this.handback = { ...this.lastApplied, age: 0 };
    if (manual && this.manualRig === null) this.manualRig = shot.rig;
    if (manual) {
      const d = this.engine.drones[this.manualRig];
      shot = { ...shot, rig: this.manualRig, pos: d.pos.clone(), quat: d.quat.clone(), fov: d.fov, target: d.target.clone(), aperture: 0 };
    } else this.manualRig = null;
    const stage = sc.stage || { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
    const W = window.innerWidth, H = window.innerHeight;
    cam.setViewOffset(W, H, W / 2 - (stage.left + stage.right) / 2, H / 2 - (stage.top + stage.bottom) / 2, W, H);
    cam.fov = shot.fov; cam.updateProjectionMatrix();
    cam.position.copy(shot.pos).sub(sc.mid); cam.up.copy(up); cam.quaternion.copy(shot.quat);
    if (manual) {
      const dir = shot.pos.clone().sub(shot.target).normalize(), distance = shot.pos.distanceTo(shot.target);
      const adjusted = this.user.apply(dir, distance, up);
      cam.position.copy(shot.target).sub(sc.mid).addScaledVector(adjusted.dir, adjusted.d);
      cam.lookAt(shot.target.clone().sub(sc.mid));
    }
    if (!manual && this.handback) {
      this.handback.age += Math.min(.1, dt);
      const blend = THREE.MathUtils.smoothstep(this.handback.age, 0, .7);
      cam.position.lerp(this.handback.pos.clone().sub(sc.mid), 1-blend);
      cam.quaternion.slerp(this.handback.quat, 1-blend);
      cam.fov = THREE.MathUtils.lerp(this.handback.fov, shot.fov, blend);
      cam.updateProjectionMatrix(); shot.aperture = 0;
      if (blend >= 1) this.handback = null;
    }
    this.wasManual = !!manual;
    this.lastApplied = { pos: cam.position.clone().add(sc.mid), quat: cam.quaternion.clone(), fov: cam.fov };
    cam.updateMatrixWorld(true);
    sc.shot = { ...shot, name: CAMERA_RIGS[shot.rig].name, id: CAMERA_RIGS[shot.rig].id, manual: !!manual };
    sc.cameraCut = this.lastCut !== shot.rig;
    if (sc.cameraCut) sc.shotEpoch = (sc.shotEpoch || 0) + 1;
    this.lastCut = shot.rig;
    this.timeScale = this.scaleAt(t);
    return shot;
  }
}
