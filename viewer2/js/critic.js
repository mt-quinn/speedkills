// The critic: per-frame measurements of how watchable the broadcast is, aggregated against the
// watchability gate (V1–V8). Read from window.__critic, or shown with ?critic=1.
import * as THREE from 'three';

const KEY_EVENTS = new Set(['rail_fire', 'rail_hit', 'torp_launch', 'torp_hit', 'debris_hit', 'part_lost', 'crew_killed', 'blackout', 'overcharge', 'rail_vent', 'end']);

export class Critic {
  constructor(match, scene) {
    this.m = match; this.scene = scene;
    this.frames = 0; this.bothIn = 0; this.axisBad = 0; this.minSep = Infinity; this.sepSmall = 0;
    this.events = 0; this.eventsSeen = 0; this.missed = [];
    this.lastDir = null; this.lastW = null; this.maxW = 0; this.maxA = 0; this.jerks = 0; this.rates = [];
    this.wall = 0; this.slowWall = 0; this.slowEntries = 0; this.inSlow = false;
    this.tagOverlap = 0; this.tiny = 0;
    this.fpsSamples = [];
  }

  ndc(p) {
    return p.clone().sub(this.scene.mid).project(this.scene.camera);
  }
  inSafe(n, mx = 0.9, my = 0.8) { return n.z < 1 && Math.abs(n.x) < mx && Math.abs(n.y) < my; }
  // In the stage (the clear part of the screen the director frames into), inset by 4%.
  inStage(n) {
    const S = this.scene.stage;
    if (!S) return this.inSafe(n);
    const W = window.innerWidth, H = window.innerHeight;
    const x = (n.x * 0.5 + 0.5) * W, y = (-n.y * 0.5 + 0.5) * H, ix = 0.04 * (S.right - S.left), iy = 0.04 * (S.bottom - S.top);
    return n.z < 1 && x > S.left + ix && x < S.right - ix && y > S.top + iy && y < S.bottom - iy;
  }

  frame(t, st, dtWall, timeScale, hud) {
    const cam = this.scene.camera;
    this.frames++;
    this.wall += dtWall;
    if (timeScale < 0.99) { this.slowWall += dtWall; if (!this.inSlow) this.slowEntries++; this.inSlow = true; } else this.inSlow = false;
    const a = this.ndc(st.ships[0].pos), b = this.ndc(st.ships[1].pos);
    if (this.inStage(a) && this.inStage(b)) this.bothIn++;
    else (this.outLog ||= []).push([+t.toFixed(1), this.inStage(a) ? 1 : 0, +a.x.toFixed(2), +a.y.toFixed(2), +b.x.toFixed(2), +b.y.toFixed(2), Math.round(cam.position.length())]);
    // Viewing along the ships' line flattens the depth between them.
    const view = new THREE.Vector3(); cam.getWorldDirection(view);
    const axis = st.ships[1].pos.clone().sub(st.ships[0].pos).normalize();
    const ang = Math.acos(Math.min(1, Math.abs(view.dot(axis)))) * 180 / Math.PI; // 90 = across
    // Looking along the ships' line only hurts when it also stacks them on screen (depth ambiguous).
    const sepNow = Math.hypot((a.x - b.x) * window.innerWidth / 2, (a.y - b.y) * window.innerHeight / 2);
    if (ang < 25 && sepNow < 0.08 * window.innerHeight) this.axisBad++;
    // Separation on screen (px).
    const W = window.innerWidth, H = window.innerHeight;
    const sep = Math.hypot((a.x - b.x) * W / 2, (a.y - b.y) * H / 2);
    this.minSep = Math.min(this.minSep, sep);
    // The fight should fill the frame: ships far enough apart in the world should not be a speck.
    const worldSep = st.ships[0].pos.distanceTo(st.ships[1].pos);
    // (Against the stage's shorter side: 0.3 of it ≈ the old 15% of a 16:9 screen's width.)
    const St = this.scene.stage || { top: 0, bottom: H, left: 0, right: W };
    if (worldSep > 400 && sep < 0.3 * Math.min(St.right - St.left, St.bottom - St.top)) {
      this.tiny++;
      const camD = cam.position.length();
      (this.tinyLog ||= []).push([+t.toFixed(1), Math.round(ang), +(camD / worldSep).toFixed(1)]);
    }
    if (sep < 0.06 * H) { this.sepSmall++; (this.closeTimes ||= []).push(+t.toFixed(1)); }
    // Camera smoothness (rad/s, rad/s²) in wall time.
    if (this.lastDir && dtWall > 0) {
      const w = this.lastDir.angleTo(view) / dtWall;
      if (this.lastW !== null) {
        const acc = Math.abs(w - this.lastW) / dtWall;
        this.maxA = Math.max(this.maxA, acc);
        if (acc > 2.5) this.jerks++;
      }
      this.maxW = Math.max(this.maxW, w);
      this.rates.push(w);
      (this.rateLog ||= []).push([+t.toFixed(2), +(w * 57.3).toFixed(1), timeScale]);
      this.lastW = w;
    }
    this.lastDir = view.clone();
    // Tag overlap.
    if (hud.tagRects && hud.tagRects.length === 2) {
      const [r1, r2] = hud.tagRects;
      if (Math.abs(r1.x - r2.x) < (r1.w + r2.w) / 2 && Math.abs(r1.y - r2.y) < (r1.h + r2.h) / 2) this.tagOverlap++;
    }
    if (dtWall > 0) this.fpsSamples.push(1 / dtWall);
  }

  // Was each key event on screen when it happened?
  events_(evs, st) {
    for (const e of evs) {
      if (!KEY_EVENTS.has(e.k)) continue;
      let p = null;
      if (e.pos) p = new THREE.Vector3(...e.pos);
      else if (e.ship !== undefined) p = st.ships[e.ship].pos;
      else if (e.victim !== undefined) p = st.ships[e.victim].pos;
      if (!p) continue;
      this.events++;
      if (this.inSafe(this.ndc(p), 0.97, 0.95)) this.eventsSeen++;
      else if (this.missed.length < 20) this.missed.push(`${e.k}@${e.t.toFixed(1)}`);
    }
  }

  report(hud) {
    const f = Math.max(1, this.frames);
    const fps = this.fpsSamples.slice(30).sort((x, y) => x - y);
    const p5 = fps.length ? fps[Math.floor(fps.length * 0.05)] : 0;
    const r = {
      V1_framing: { both_in_safe: this.bothIn / f, looking_along_axis: this.axisBad / f, pass: this.bothIn / f >= 0.98 && this.axisBad / f <= 0.01 },
      V2_events_seen: { seen: this.eventsSeen / Math.max(1, this.events), n: this.events, missed: this.missed, pass: this.eventsSeen / Math.max(1, this.events) >= 0.95 },
      V3_smooth: (() => { const r = this.rates.slice().sort((x, y) => x - y); const p99 = r.length ? r[Math.floor(r.length * 0.99)] * 57.3 : 0; return { p99_rate_deg_s: p99, max_rate_deg_s: this.maxW * 57.3, max_accel_deg_s2: this.maxA * 57.3, jerks: this.jerks, pass: this.jerks === 0 && p99 <= 20 && this.maxW * 57.3 <= 45 }; })(),
      V4_depth: { min_sep_px: this.minSep, frames_too_close: this.sepSmall / f, tag_overlap: this.tagOverlap / f, pass: this.sepSmall / f < 0.02 && this.tagOverlap / f < 0.01 },
      V5_text: { captions: hud.stats.captionsShown, per_min: hud.stats.captionsShown / Math.max(1, this.m.duration / 60), max_at_once: hud.stats.maxSimultaneous, shortest_s: hud.stats.shortest, pass: hud.stats.maxSimultaneous <= 2 && hud.stats.shortest >= 1.5 && hud.stats.captionsShown / Math.max(1, this.m.duration / 60) <= 8 },
      V6_slowmo: { share: this.slowWall / Math.max(1e-6, this.wall), entries: this.slowEntries, per_min: this.slowEntries / Math.max(1, this.m.duration / 60), pass: this.slowWall / Math.max(1e-6, this.wall) <= 0.12 && this.slowEntries / Math.max(1, this.m.duration / 60) <= 3 },
      V9_fills_frame: { samples: (this.tinyLog || []).slice(0, 8), tiny_share: this.tiny / f, pass: this.tiny / f < 0.02 },
      V8_fps: { p5, median: fps.length ? fps[Math.floor(fps.length / 2)] : 0, pass: p5 >= 50 },
    };
    return r;
  }
}
