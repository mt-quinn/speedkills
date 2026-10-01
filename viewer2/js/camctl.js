// Hybrid camera: the viewer can orbit and zoom within the director's frame. Input becomes
// offsets on the director's own view (azimuth and elevation around its look point, a factor on
// its distance); the director keeps framing underneath, never seeing the offsets. After
// HOLD seconds without input the offsets ease back to zero and the director has the shot again.
//   Desktop: drag to orbit, wheel / trackpad pinch to zoom, double-click to hand back at once.
//   Touch: one finger orbits, two fingers pinch-zoom (and orbit by their midpoint).
import * as THREE from 'three';

const HOLD = 2.5; // s of no input before the director takes back
const RETURN = 0.9; // s time constant of the hand-back
const DRAG = 0.0045; // rad per px (a full desktop-width drag ≈ 400°)
const EL_MIN = -80 * Math.PI / 180, EL_MAX = 84 * Math.PI / 180;

export class CamControl {
  constructor(el) {
    this.el = el;
    this.az = 0; this.el0 = 0; this.logZoom = 0;
    this.lastInput = -1e9; this.pointers = new Map(); this.moved = false;
    this.pinch = null; this.snapping = false;
    this.hud = document.querySelector('#camhud');
    this.hud.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); this.release(); });
    el.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e), { capture: true });
    window.addEventListener('pointercancel', (e) => this.up(e), { capture: true });
    el.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    el.addEventListener('dblclick', (e) => { if (e.pointerType !== 'touch') this.release(); });
    // Desktop Safari reports a trackpad pinch as gesture events, not ctrl+wheel. (Touch screens
    // pinch through pointer events above; iOS also fires gesture events, so only fine pointers.)
    if (matchMedia('(pointer: fine)').matches) {
      el.addEventListener('gesturestart', (e) => { e.preventDefault(); this.gs = 1; });
      el.addEventListener('gesturechange', (e) => { e.preventDefault(); this.zoomBy((this.gs || 1) / e.scale); this.gs = e.scale; this.poke(); });
    }
    window.__cam = this;
  }

  get engaged() { return Math.abs(this.az) > 0.004 || Math.abs(this.el0) > 0.004 || Math.abs(this.logZoom) > 0.01 || this.pointers.size > 0; }
  // (A drag, not a tap: the tap handlers ask this before acting.)
  get dragged() { return this.moved; }

  poke() { this.lastInput = performance.now() / 1000; this.snapping = false; }
  release() { this.pointers.clear(); this.pinch = null; this.el.classList.remove('grabbing'); this.snapping = true; this.lastInput = -1e9; }

  down(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
    if (this.pointers.size === 1) this.moved = false;
    if (this.pointers.size === 2) this.pinch = this.pinchState();
    this.el.classList.add('grabbing');
  }
  pinchState() {
    const [a, b] = [...this.pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }
  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (!this.moved && Math.hypot(p.x - p.x0, p.y - p.y0) < 8) return; // (still a tap)
    this.moved = true;
    if (this.pointers.size === 1) {
      this.orbit(dx, dy);
    } else if (this.pointers.size === 2 && this.pinch) {
      const now = this.pinchState();
      this.zoomBy(this.pinch.d / Math.max(1, now.d));
      this.orbit((now.mx - this.pinch.mx), (now.my - this.pinch.my));
      this.pinch = now;
    }
    this.poke();
  }
  up(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    this.pinch = this.pointers.size === 2 ? this.pinchState() : null;
    if (this.pointers.size === 0) {
      this.el.classList.remove('grabbing');
      if (this.moved) this.poke();
      // (Reset after the tap handlers on this same pointerup have read it.)
      setTimeout(() => { if (this.pointers.size === 0) this.moved = false; }, 0);
    }
  }
  wheel(e) {
    e.preventDefault();
    // (Trackpad pinch arrives as a wheel with ctrlKey: finer steps, more per step.)
    const k = e.ctrlKey ? 0.012 : 0.0016;
    this.zoomBy(Math.exp(e.deltaY * k));
    this.poke();
  }
  orbit(dx, dy) { this.az -= dx * DRAG; this.el0 += dy * DRAG; }
  zoomBy(f) { this.logZoom = Math.max(Math.log(0.3), Math.min(Math.log(3), this.logZoom + Math.log(f))); }

  // Per frame (wall time): hand back once input has stopped.
  frame(dtWall) {
    const now = performance.now() / 1000;
    const idle = this.pointers.size === 0 && (this.snapping || now - this.lastInput > HOLD);
    if (idle) {
      const k = 1 - Math.exp(-dtWall / (this.snapping ? 0.35 : RETURN));
      this.az -= this.az * k; this.el0 -= this.el0 * k; this.logZoom -= this.logZoom * k;
      if (!this.engaged) { this.az = 0; this.el0 = 0; this.logZoom = 0; this.snapping = false; }
    }
    const on = this.engaged;
    this.hud.classList.toggle('on', on);
    if (on) {
      const left = Math.max(0, HOLD - (now - this.lastInput));
      this.hud.querySelector('span').textContent = this.pointers.size ? 'free camera' : left > 0.05 ? `free camera · director in ${left.toFixed(0)} s` : 'director returning';
    }
  }

  // Apply the offsets to the director's view: `dir` points from the look point to the camera.
  apply(dir, d, up) {
    if (!this.engaged) return { dir, d };
    const el = Math.asin(Math.max(-1, Math.min(1, dir.dot(up))));
    const flat = dir.clone().sub(up.clone().multiplyScalar(dir.dot(up))).normalize();
    const e2 = Math.max(EL_MIN, Math.min(EL_MAX, el + this.el0));
    // (Keep the stored offset inside the clamp, so a drag past the pole doesn't bank up.)
    this.el0 = e2 - el;
    const f2 = flat.applyAxisAngle(up, this.az);
    const out = f2.multiplyScalar(Math.cos(e2)).addScaledVector(up, Math.sin(e2)).normalize();
    return { dir: out, d: d * Math.exp(this.logZoom) };
  }
}
