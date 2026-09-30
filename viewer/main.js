// Speed Kills viewer. Legibility first: the world is huge (ships ~5 m, fights ~800 m apart),
// so everything that matters is drawn at a constant screen size on a 2D overlay above the 3D
// scene, lines have pixel widths, and every mark on screen is named in plain words.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

const WS_URL = `ws://${location.hostname || 'localhost'}:8081`;
const TEAM_CSS = ['#4cc3ff', '#ff6b4a'];
const TEAM = TEAM_CSS.map((c) => new THREE.Color(c));
const NAMES = ['BLUE', 'RED'];
const HOT = '#ffe3dc';
const $ = (id) => document.getElementById(id);
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const fmtTime = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;

// ---------- renderer / scene ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#05070d');
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 12000);
camera.position.set(0, 400, 1200);
const controls = new OrbitControls(camera, canvas);
controls.enabled = false;
controls.enableDamping = true;
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.35, 0.65);
composer.addPass(bloom);
composer.addPass(new OutputPass());
scene.add(new THREE.HemisphereLight('#a8c4ff', '#20182a', 0.9));
const sun = new THREE.DirectionalLight('#fff3e2', 2.4);
scene.add(sun, sun.target);

const overlay = $('overlay');
const ctx = overlay.getContext('2d');
let W = 1, H = 1, DPR = 1;
const lineMats = new Set();
function resize() {
  W = innerWidth; H = innerHeight; DPR = Math.min(devicePixelRatio, 2);
  renderer.setSize(W, H, false);
  composer.setSize(W, H);
  bloom.setSize(W, H);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  overlay.width = W * DPR; overlay.height = H * DPR;
  for (const m of lineMats) m.resolution.set(W, H);
}
addEventListener('resize', resize);

// Stars.
{
  const n = 2500, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(5000 + Math.random() * 2000);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: '#7f8aa6', size: 1.5, sizeAttenuation: false })));
}

// ---------- pixel-width lines ----------
class Path {
  constructor({ color, width = 2, opacity = 1, dashed = false, dash = 10, gap = 8 }) {
    this.mat = new LineMaterial({ color, linewidth: width, transparent: true, opacity, dashed, dashSize: dash, gapSize: gap, worldUnits: false, depthWrite: false });
    this.mat.resolution.set(W, H);
    lineMats.add(this.mat);
    this.geo = new LineGeometry();
    this.line = new Line2(this.geo, this.mat);
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.dashed = dashed;
    scene.add(this.line);
  }
  set(flat) {
    if (flat.length < 6) { this.line.visible = false; return; }
    this.geo.dispose();
    this.geo = new LineGeometry();
    this.geo.setPositions(flat);
    this.line.geometry = this.geo;
    if (this.dashed) this.line.computeLineDistances();
    this.line.visible = true;
  }
  hide() { this.line.visible = false; }
  dispose() { scene.remove(this.line); this.geo.dispose(); this.mat.dispose(); lineMats.delete(this.mat); }
}

// ---------- world state helpers ----------
let state = null, planet = null, hazardKey = '';
const gAt = (p, out) => {
  out.set(0, 0, 0);
  if (!planet) return out;
  out.copy(planet.P).sub(p);
  const r2 = Math.max(out.lengthSq(), planet.core * planet.core);
  return out.normalize().multiplyScalar(planet.gm / r2);
};
// Ballistic path under planet gravity: flat [x,y,z,...] with `n` points over `T` seconds.
const _g = new THREE.Vector3();
function ballistic(p0, v0, T, n, stopAtPlanet = true) {
  const p = p0.clone(), v = v0.clone();
  const out = [p.x, p.y, p.z];
  const sub = 4, h = T / (n - 1) / sub;
  for (let k = 1; k < n; k++) {
    for (let s = 0; s < sub; s++) {
      v.addScaledVector(gAt(p, _g), h);
      p.addScaledVector(v, h);
    }
    out.push(p.x, p.y, p.z);
    if (stopAtPlanet && planet && p.distanceTo(planet.P) < planet.core) break;
  }
  return out;
}
// Closest approach of two coasting bodies over T seconds (dt 0.1).
function closest(pa, va, pb, vb, T) {
  const a = pa.clone(), av = va.clone(), b = pb.clone(), bv = vb.clone();
  let best = { dist: a.distanceTo(b), time: 0 };
  for (let t = 0.1; t <= T; t += 0.1) {
    av.addScaledVector(gAt(a, _g), 0.1); a.addScaledVector(av, 0.1);
    bv.addScaledVector(gAt(b, _g), 0.1); b.addScaledVector(bv, 0.1);
    const d = a.distanceTo(b);
    if (d < best.dist) best = { dist: d, time: t };
    if (planet && a.distanceTo(planet.P) < planet.core) break;
  }
  return best;
}
function apsides(r, v) {
  const gm = planet.gm, rl = r.length();
  const E = v.lengthSq() / 2 - gm / rl, h = r.clone().cross(v).length();
  const e = Math.sqrt(Math.max(0, 1 + (2 * E * h * h) / (gm * gm)));
  return { rp: (h * h) / (gm * (1 + e)), ra: E < 0 ? (-gm / (2 * E)) * (1 + e) : Infinity };
}

// ---------- planet, atmosphere, zones ----------
const sphereGeo = new THREE.SphereGeometry(1, 48, 24);
const glow = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
const world = new THREE.Group();
scene.add(world);
function planetTexture() {
  const Wt = 1024, Ht = 512, c = document.createElement('canvas');
  c.width = Wt; c.height = Ht;
  const g = c.getContext('2d');
  let s = 12345;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const sea = g.createLinearGradient(0, 0, 0, Ht);
  sea.addColorStop(0, '#24466a'); sea.addColorStop(0.5, '#2c5e8e'); sea.addColorStop(1, '#24466a');
  g.fillStyle = sea; g.fillRect(0, 0, Wt, Ht);
  const land = ['#5a7a44', '#7b7a4e', '#8d7250', '#62804f'];
  for (let k = 0; k < 14; k++) {
    const cx = rnd() * Wt, cy = Ht * (0.2 + rnd() * 0.6), rad = 30 + rnd() * 90;
    g.fillStyle = land[k % 4];
    for (let j = 0; j < 60; j++) {
      const a = rnd() * 6.28, d = rnd() * rad;
      g.beginPath();
      g.ellipse((cx + Math.cos(a) * d * 1.8 + Wt) % Wt, cy + Math.sin(a) * d, 6 + rnd() * 26, 4 + rnd() * 16, 0, 0, 6.28);
      g.fill();
    }
  }
  g.fillStyle = 'rgba(240,245,255,0.9)';
  g.fillRect(0, 0, Wt, Ht * 0.06); g.fillRect(0, Ht * 0.94, Wt, Ht * 0.06);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const zoneLimbs = [];
function circlePoints() {
  const out = [];
  for (let i = 0; i <= 192; i++) { const a = (i / 192) * Math.PI * 2; out.push(Math.cos(a), Math.sin(a), 0); }
  return out;
}
function buildWorld(s) {
  world.clear();
  zoneLimbs.forEach((z) => z.dispose());
  zoneLimbs.length = 0;
  const h = (s.hazards || []).find((x) => x.k === 'planet');
  planet = h ? { P: v3(h.p), gm: h.gm, core: h.core } : null;
  if (!planet) return;
  const m = new THREE.Mesh(new THREE.SphereGeometry(planet.core, 96, 64), new THREE.MeshStandardMaterial({ map: planetTexture(), roughness: 0.9 }));
  m.position.copy(planet.P);
  m.rotation.z = 0.35;
  world.add(m);
  const atmo = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: '#6fb6ff', transparent: true, opacity: 0.05, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  atmo.scale.setScalar(planet.core + (s.atmo || 45));
  atmo.position.copy(planet.P);
  world.add(atmo);
  const safeFill = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: '#8fb8ff', transparent: true, opacity: 0.02, side: THREE.BackSide, depthWrite: false }));
  safeFill.name = 'safeFill';
  world.add(safeFill);
  // Zone boundaries as true silhouettes (clean circles facing the camera).
  ['#9cc2ff', '#ffc857', '#ff4d5e'].forEach((c, k) => {
    const p = new Path({ color: c, width: k === 0 ? 2 : 1.5, opacity: k === 0 ? 0.6 : 0.4 });
    p.set(circlePoints());
    zoneLimbs.push(p);
  });
}
function updateZones() {
  if (!planet || !state || state.safe == null) { zoneLimbs.forEach((z) => z.hide()); return; }
  const sd = state.safe < state.safe_base - 1;
  zoneLimbs[0].mat.color.set(sd ? '#ff4d5e' : '#9cc2ff');
  zoneLimbs.forEach((l, k) => {
    const R = state.safe + k * state.zone_width;
    const toCam = camera.position.clone().sub(planet.P);
    const D = toCam.length();
    if (D < R * 1.01) { l.line.visible = false; return; }
    l.line.visible = true;
    toCam.normalize();
    l.line.position.copy(planet.P).addScaledVector(toCam, (R * R) / D);
    l.line.scale.setScalar(R * Math.sqrt(1 - (R * R) / (D * D)));
    l.line.lookAt(camera.position);
  });
  const f = world.getObjectByName('safeFill');
  if (f) { f.scale.setScalar(state.safe); f.position.copy(planet.P); }
}

// ---------- asteroids ----------
function rockGeo(seed) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const cache = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!cache.has(key)) cache.set(key, 1 + (rnd() - 0.5) * 0.35);
    const k = cache.get(key);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}
const rockMat = new THREE.MeshStandardMaterial({ color: '#9a938b', roughness: 0.9, flatShading: true });
const rocks = new Map();

// ---------- the tape ----------
// Everything on screen is played back from a tape of states. Live, the tape runs a few seconds
// behind the sim: that delay is the director's lookahead (it knows a round will burst before it
// does, so it can slow down, zoom in and draw the geometry), and it pays for slow-motion, instant
// replays and fast-forwarded lulls. Recorded replays are the same tape, loaded whole.
const tape = { frames: [], match: 0, matchStart: [0], hazards: null };
let showK = 0, lastShownIdx = -1, started = false, quiet = false;
const START_LAG = 4.0; // s of sim time buffered before the broadcast starts
const MIN_LAG = 3.5; // lookahead kept in hand (s of wall time at 1x)
const MAX_LAG = 16; // beyond this, catch up
let liveK = 0, liveLastT = null, liveEvents = [];
function pushLive(s) {
  if (liveLastT != null) {
    const d = s.t - liveLastT;
    if (d < -1e-3 || d > 2) { tape.match++; liveK += 1 / 30; tape.matchStart[tape.match] = liveK; } else liveK += Math.max(0, d);
  }
  liveLastT = s.t;
  if (s.events?.length) liveEvents.push(...s.events);
  const f = tape.frames, lastF = f[f.length - 1];
  // Stored at ~30 Hz; a frame carrying events is always kept so they land on time.
  if (lastF && liveK - lastF.k < 1 / 31 && !liveEvents.length && lastF.match === tape.match) return;
  const fr = { ...s, k: liveK, match: tape.match, events: liveEvents };
  liveEvents = [];
  if (s.hazards) tape.hazards = s.hazards;
  f.push(fr);
  detectFrame(fr);
  // Keep ~45 s behind the playhead for replays and trails.
  let n = 0;
  while (n < f.length - 2 && f[n].k < showK - 45) n++;
  if (n > 200) { f.splice(0, n); lastShownIdx -= n; }
}
function frameAtK(k) {
  const f = tape.frames;
  let lo = 0, hi = f.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (f[mid].k <= k) lo = mid; else hi = mid - 1; }
  return lo;
}
const lerp3 = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
function pair(k) {
  const f = tape.frames, i = frameAtK(k);
  const a = f[i], b = f[Math.min(i + 1, f.length - 1)];
  const u = b.match === a.match && b.k > a.k ? THREE.MathUtils.clamp((k - a.k) / (b.k - a.k), 0, 1) : 0;
  return { i, a, b, u };
}
function tapeState(k) {
  const { i, a, b, u } = pair(k);
  const bs = new Map(b.ships.map((x) => [x.id, x])), bb = new Map(b.bodies.map((x) => [x.id, x]));
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  const ships = a.ships.map((s) => {
    const n = bs.get(s.id);
    if (!n || u === 0) return s;
    qa.set(...s.q); qb.set(...n.q); qa.slerp(qb, u);
    return { ...s, p: lerp3(s.p, n.p, u), v: lerp3(s.v, n.v, u), q: [qa.x, qa.y, qa.z, qa.w] };
  });
  const bodies = a.bodies.map((x) => { const n = bb.get(x.id); return n && u ? { ...x, p: lerp3(x.p, n.p, u), v: lerp3(x.v, n.v, u) } : x; });
  let events = [];
  if (i > lastShownIdx && i - lastShownIdx < 150) for (let j = lastShownIdx + 1; j <= i; j++) events = events.concat(tape.frames[j].events || []);
  else if (i !== lastShownIdx) visualReset();
  lastShownIdx = i;
  return { ...a, t: a.t + (b.t - a.t) * u, ships, bodies, hazards: a.hazards || tape.hazards, events };
}
// Positions at any tape time (for diagrams, trails and the chase camera).
function sampleShip(k, i) {
  const { a, b, u } = pair(k);
  const s = a.ships[i], n = b.ships[i];
  if (!s) return null;
  const same = n && n.id === s.id;
  return { p: v3(same ? lerp3(s.p, n.p, u) : s.p), v: v3(same ? lerp3(s.v, n.v, u) : s.v), alive: s.alive, r: s.r, match: a.match, s };
}
function sampleBody(k, id) {
  const { a, b, u } = pair(k);
  const x = a.bodies.find((o) => o.id === id);
  if (!x) return null;
  const n = b.bodies.find((o) => o.id === id);
  return { p: v3(n ? lerp3(x.p, n.p, u) : x.p), v: v3(n ? lerp3(x.v, n.v, u) : x.v) };
}
function visualReset() {
  callouts.length = 0;
  burstPending.clear();
  $('banner').hidden = true;
  clearBodies();
  for (const sv of shipViews) { sv.inAir = false; sv.sees = undefined; }
}

// ---------- moments: what happens on the tape ----------
// Every close pass of a round (with its exact geometry), every burst, hit, kill and skip.
const moments = [];
const trk = { slugs: new Map(), air: [null, null], prev: null };
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vadd = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const vlen = (a) => Math.sqrt(vdot(a, a));
function pushMoment(m) { m.pushK = trk.prev ? trk.prev.k : 0; moments.push(m); if (moments.length > 400) moments.splice(0, 100); }
function detectFrame(f) {
  const prev = trk.prev;
  const h = prev && prev.match === f.match ? Math.max(1e-3, f.k - prev.k) : 1 / 30;
  if (prev && prev.match !== f.match) { trk.slugs.clear(); trk.air = [null, null]; }
  trk.prev = f;
  const ships = f.ships, evs = f.events || [], used = new Set();
  for (const e of evs) if (e.type === 'kill') pushMoment({ type: 'kill', k: f.k, victim: e.victim, attacker: e.attacker, cause: e.cause, p: e.p });
  const present = new Set();
  for (const b of f.bodies) {
    if (b.k !== 'slug') continue;
    present.add(b.id);
    let r = trk.slugs.get(b.id);
    if (!r) { r = { id: b.id, owner: b.o, target: 1 - b.o, fireK: f.k - Math.max(0, f.t - (b.born ?? f.t)), min: Infinity, cool: false }; trk.slugs.set(b.id, r); }
    r.last = { p: b.p, v: b.v };
    const tgt = ships[r.target];
    if (!tgt || !tgt.alive) continue;
    const dp = vsub(b.p, tgt.p), dv = vsub(b.v, tgt.v), dv2 = vdot(dv, dv);
    const tau = dv2 > 1e-9 ? THREE.MathUtils.clamp(-vdot(dp, dv) / dv2, -h, 0) : 0;
    const gap = vlen(vadd(dp, dv, tau)) - tgt.r;
    if (r.cool) { if (gap > 120) r.cool = false; continue; }
    if (gap < r.min) { r.min = gap; r.minK = f.k + tau; r.snap = { slugP: vadd(b.p, b.v, tau), tgtP: vadd(tgt.p, tgt.v, tau), rel: Math.sqrt(dv2) }; }
    else if (r.min < 60 && gap > r.min + 6) { finalize(r, { outcome: 'miss' }); r.min = Infinity; r.cool = true; }
  }
  for (const [id, r] of trk.slugs) {
    if (present.has(id)) continue;
    trk.slugs.delete(id);
    // Gone: a burst or a hit on its target this frame (nearest to where it was), or it missed.
    const at = vadd(r.last.p, r.last.v, h);
    let best = null, bd = 60;
    for (const [j, e] of evs.entries()) {
      if (used.has(j)) continue;
      const mine = (e.type === 'burst' && e.victim === r.target) || (e.type === 'hit' && e.cause === 'slug' && e.victim === r.target && e.attacker === r.owner);
      if (!mine) continue;
      const d = vlen(vsub(e.p, at));
      if (d < bd) { bd = d; best = j; }
    }
    if (best != null) {
      const e = evs[best];
      used.add(best);
      let damage = e.type === 'hit' ? e.damage : 0;
      if (e.type === 'burst') {
        const hj = evs.findIndex((x, j) => !used.has(j) && x.type === 'hit' && x.cause === 'slug' && x.victim === r.target);
        if (hj >= 0) { used.add(hj); damage = evs[hj].damage; }
      }
      const tgt = ships[r.target];
      finalize(r, { outcome: e.type, k: f.k, gap: e.type === 'burst' ? e.dist : 0, damage, slugP: e.p, tgtP: tgt ? tgt.p : e.p });
    } else if (r.min < 60 && !r.cool) finalize(r, { outcome: 'miss' });
  }
  for (let i = 0; i < ships.length && i < 2; i++) {
    const s = ships[i];
    const air = s.alive && ((s.heating || 0) > 0.05 || (s.scoop || 0) > 0);
    const a = trk.air[i];
    if (air) {
      if (!a) {
        const m = { type: 'skip', ship: i, k: f.k, k0: f.k, k1: null, scooped0: s.scooped ?? 0, hull0: s.hull, fuel0: s.fuel / s.fuel_max, fuelMax: s.fuel_max };
        pushMoment(m);
        trk.air[i] = { m, lastIn: f.k };
      } else { a.lastIn = f.k; a.m.gainSoFar = ((s.scooped ?? 0) - a.m.scooped0) / s.fuel_max; }
    } else if (a && (f.k - a.lastIn > 0.3 || !s.alive)) {
      a.m.k1 = a.lastIn;
      a.m.gain = ((s.scooped ?? 0) - a.m.scooped0) / s.fuel_max;
      a.m.hullLoss = a.m.hull0 - s.hull;
      a.m.survived = s.alive;
      trk.air[i] = null;
    }
  }
}
function finalize(r, o) {
  const snap = r.snap || { slugP: r.last.p, tgtP: r.last.p, rel: 0 };
  pushMoment({
    type: 'approach', slugId: r.id, owner: r.owner, target: r.target, fireK: r.fireK,
    k: o.k ?? r.minK, gap: Math.max(0, o.gap ?? r.min), outcome: o.outcome, damage: o.damage || 0,
    slugP: o.slugP || snap.slugP, tgtP: o.tgtP || snap.tgtP, rel: snap.rel,
  });
}
// Where the target would have been had it just coasted (from `refK`), for "why it missed".
function ghostOf(m) {
  if (m.ghost !== undefined) return m.ghost;
  const refK = Math.max(m.fireK + 0.3, m.k - 4);
  const s0 = refK < tape.frames[0].k ? null : sampleShip(refK, m.target);
  if (!s0 || !planet) return (m.ghost = null);
  const p = s0.p.clone(), v = s0.v.clone(), T = m.k - refK, n = Math.max(1, Math.ceil(T / 0.02)), dt = T / n;
  for (let j = 0; j < n; j++) { v.addScaledVector(gAt(p, _g), dt); p.addScaledVector(v, dt); }
  const gap = p.distanceTo(v3(m.slugP)) - (s0.r || 5);
  return (m.ghost = { p, gap, refK, moved: p.distanceTo(v3(m.tgtP)) });
}
const interesting = (m) => m.type === 'kill' || (m.type === 'approach' && (m.outcome !== 'miss' || m.gap < 30)) ||
  (m.type === 'skip' && (m.k1 == null || m.k1 - m.k0 > 1.2 || (m.gain || 0) > 0.03));
// Only the big moments get the full treatment (zoom, slow-motion, diagram), and not back to back:
// a kill always; a damaging burst or hit, a real dodge or a big skip at most every FEATURE_GAP s of match time.
const FEATURE_GAP = 15;
function bigHit(m) { const hm = state?.ships?.[m.target]?.hull_max || 850; return m.type === 'approach' && m.outcome !== 'miss' && m.damage >= 0.3 * hm; }
function featured(m) {
  if (m.type === 'kill' || m === dir.focus || bigHit(m)) return true;
  if ((m.k ?? m.k0) - dir.lastFeatureK < FEATURE_GAP) return false;
  if (m.type === 'approach') {
    if (m.outcome !== 'miss') return m.damage >= 100;
    if (m.gap > 30) return false;
    const g = ghostOf(m);
    return !!g && g.gap < 6; // it was on target and the dodge beat it
  }
  if (m.type === 'skip') return m.k1 == null ? (m.gainSoFar || 0) > 0.03 || showK < m.k0 : (m.gain || 0) > 0.1;
  return false;
}
const PRIORITY = { kill: 4, hit: 3, burst: 3, miss: 2, skip: 1 };
const prio = (m) => PRIORITY[m.type === 'approach' ? m.outcome : m.type];

// ---------- the director: pacing, shots, telestration ----------
const LEAD = 3.4, AFTER = 2.8;
const dir = { focus: null, shot: 'wide', rate: 1, rateSm: 1, replay: null, cut: true, wideUntil: 0, lastFeatureK: -Infinity };
function headK() { const f = tape.frames; return f.length ? f[f.length - 1].k : 0; }
function focusActive(m) {
  if (m.type === 'kill') return !m.replayDone && showK >= m.k - LEAD && showK <= m.k + 2.6;
  if (m.type === 'approach') {
    if (showK < m.k - LEAD || showK > m.k + AFTER) return false;
    if (showK < m.k) { const t = sampleShip(showK, m.target); if (!t || !t.alive) return false; }
    return true;
  }
  if (m.type === 'skip') return showK >= m.k0 - 1.5 && showK <= (m.k1 ?? headK()) + 2.4;
  return false;
}
function recentMoments(back = 12) {
  const out = [];
  for (let j = moments.length - 1; j >= 0; j--) {
    const m = moments[j];
    if (m.pushK < showK - back) break;
    out.push(m);
  }
  return out;
}
function pickFocus() {
  const cur = dir.focus && focusActive(dir.focus) ? dir.focus : null;
  let best = null;
  for (const m of recentMoments()) {
    if (!interesting(m) || !focusActive(m) || !featured(m)) continue;
    if (!best || prio(m) > prio(best) || (prio(m) === prio(best) && m.k < best.k)) best = m;
  }
  if (cur && (!best || prio(best) <= prio(cur))) return cur;
  return best;
}
const ramp = (x, a, b) => THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
function focusRate(m) {
  const u = m.k - showK; // seconds of sim time until the moment
  if (m.type === 'skip') return showK >= m.k0 && showK <= (m.k1 ?? Infinity) ? 0.6 : 1;
  const shot = m.type === 'kill' && (m.cause === 'slug' || m.cause === 'ram');
  const lo = m.type === 'kill' ? (shot ? 0.15 : 0.6) : m.outcome === 'miss' ? 0.35 : 0.25;
  if (u > 1.6) return 1;
  if (u > 0.3) return THREE.MathUtils.lerp(lo, 1, ramp(u, 0.3, 1.6));
  if (u > -0.5) return lo;
  if (m.type === 'kill') return shot ? 0.4 : 0.8;
  return THREE.MathUtils.lerp(lo, 1, ramp(-u, 0.5, 1.4));
}
// Returns the playback-rate multiplier for this frame and sets the shot.
function direct() {
  const f = tape.frames;
  if (dir.replay) {
    const r = dir.replay;
    if (showK >= r.to) {
      dir.replay = null; quiet = false; dir.cut = true; r.m.replayDone = true; dir.focus = null;
      showK = replayFile ? r.m.k + 2.6 : Math.max(showK, headK() - MIN_LAG * serverSpeed - 0.5);
      dir.wideUntil = wallT + 2.5;
    } else {
      dir.shot = 'chase';
      return showK > r.m.k - 1 && showK < r.m.k + 0.4 ? 0.25 : 0.5;
    }
  }
  const m = pickFocus();
  if (m !== dir.focus) { dir.focus = m; if (m) { m.shownAt = wallT; if (m.type !== 'kill') dir.lastFeatureK = m.k ?? m.k0; } }
  const match = f[frameAtK(showK)].match;
  const sinceStart = showK - (tape.matchStart[match] ?? 0);
  if (m && m.type === 'kill' && !m.replayed && showK > m.k + 2.4) {
    // Instant replay of the kill, from behind the killing round when there is one.
    m.replayed = true;
    const shot = recentMoments(30).find((x) => x.type === 'approach' && x.target === m.victim && x.outcome !== 'miss' && Math.abs(x.k - m.k) < 0.3);
    if (!shot) { m.replayDone = true; dir.focus = null; return 1; } // an unforced death: nothing to replay
    const from = Math.max(m.k - 5, shot.fireK - 0.4, f[0].k);
    dir.replay = { m, shot, from, to: m.k + 1.2 };
    quiet = true; dir.cut = true;
    showK = from;
    dir.shot = 'chase';
    return 0.5;
  }
  if (!m) {
    dir.shot = sinceStart < 3.5 || wallT < dir.wideUntil ? 'wide' : 'two';
    // Lulls run fast while the tape shows nothing coming for a while.
    const ahead = headK() - showK;
    const next = recentMoments().filter((x) => interesting(x) && (x.k ?? x.k0) > showK).reduce((a, x) => Math.min(a, x.k), Infinity);
    const lull = next > showK + 4.5 && ahead > 4.5 && sinceStart > 3.5;
    return lull ? 2.5 : 1;
  }
  dir.shot = m.type === 'skip' ? 'skip' : m.type === 'kill' ? 'kill' : 'approach';
  return focusRate(m);
}
function advanceClock(dt) {
  const f = tape.frames;
  if (!f.length) return;
  const head = headK();
  const piloting = !replayFile && f[f.length - 1].control != null;
  const sp = replayFile ? (replayFile.playing ? replayFile.speed : 0) : serverSpeed;
  if (!started) {
    if (replayFile || piloting) { started = true; showK = replayFile ? f[0].k : head; }
    else if (head - f[0].k >= START_LAG * serverSpeed || f[f.length - 1].paused) { started = true; showK = f[0].k; }
    else { $('conn').hidden = false; $('conn').textContent = 'buffering the broadcast…'; return; }
    $('conn').hidden = true;
  }
  if (piloting) { showK = head; dir.rateSm = 1; dir.replay = null; quiet = false; dir.shot = 'two'; return; }
  let want = camMode === 'director' ? direct() : 1;
  if (!replayFile && !dir.replay) {
    const lag = (head - showK) / Math.max(sp, 1e-6);
    if (lag < MIN_LAG) want = Math.min(want, 1);
    if (lag < 0.5) want = Math.min(want, lag / 0.5);
    if (lag > MAX_LAG) want = Math.max(want, 1.8);
  }
  // Quick into slow-motion, gentler out of it.
  dir.rateSm += (want - dir.rateSm) * ease(want < dir.rateSm ? 7 : 3, dt);
  dir.rate = dir.rateSm;
  // A recording ends on its kill: let the clock run on past the last frame to hold on it and
  // roll the instant replay.
  const hold = replayFile && camMode === 'director' && moments.some((m) => m.type === 'kill' && !m.replayed && m.k > head - 1) ? 3 : 0;
  showK = Math.min(head + hold, showK + dt * sp * dir.rateSm);
  if (replayFile && showK >= head + hold && replayFile.playing) { replayFile.playing = false; $('btnPlay').textContent = 'Replay'; }
}
// Moments announced as the playhead crosses them (feed lines and callouts).
let announcedK = -Infinity;
function announce() {
  if (quiet) { announcedK = showK; return; }
  for (const m of recentMoments()) {
    const k = m.type === 'skip' ? m.k1 : m.k;
    if (k == null || m.announced || k > showK || k < announcedK - 0.5) continue;
    m.announced = true;
    if (m.type === 'approach' && m.outcome === 'miss' && m.gap < 30) {
      const g = ghostOf(m), dodged = g && g.gap < 15;
      // The director's card covers its own moment; anything else stays in the feed.
      if (camMode !== 'director' || !dir.focus) callout(dodged ? `DODGED · ${Math.round(m.gap)} m` : `CLOSE CALL · ${Math.round(m.gap)} m`, v3(m.tgtP), '#ffffff', 20);
      feedLine(`${team(m.target)} ${dodged ? '<b>dodges</b>' : 'slips'} a ${team(m.owner)} round by ${Math.round(m.gap)} m`);
    }
    if (m.type === 'skip' && m.survived && (m.gain || 0) > 0.01) {
      const pct = Math.round(m.gain * 100);
      const sv = shipViews[m.ship];
      feedLine(`${team(m.ship)} skips off the atmosphere · <b>+${pct}% propellant</b>`, 'big');
      if (sv?.pos && (camMode !== 'director' || !dir.focus)) callout(`+${pct}% FUEL`, sv.pos, '#9fd4ff', 18, 1.6);
    }
  }
  announcedK = showK;
}

// ---------- ships ----------
const HULL_GEO = (() => { const g = new THREE.ConeGeometry(0.42, 1.7, 5); g.rotateX(Math.PI / 2); g.translate(0, 0, 0.1); return g; })();
const FIN_GEO = (() => { const g = new THREE.BoxGeometry(1.5, 0.06, 0.55); g.translate(0, 0, -0.45); return g; })();
class ShipView {
  constructor(i) {
    this.i = i;
    this.root = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: TEAM[i].clone().lerp(new THREE.Color('#dde3ec'), 0.35), roughness: 0.45, metalness: 0.3, emissive: TEAM[i], emissiveIntensity: 0.25, flatShading: true });
    this.hullMat = mat;
    this.body = new THREE.Group();
    this.body.add(new THREE.Mesh(HULL_GEO, mat), new THREE.Mesh(FIN_GEO, mat));
    const plumeGeo = new THREE.ConeGeometry(0.5, 1, 16, 1, true);
    plumeGeo.rotateX(-Math.PI / 2);
    plumeGeo.translate(0, 0, -0.5);
    this.plume = new THREE.Mesh(plumeGeo, glow(new THREE.Color('#ffc890'), 0.9));
    this.body.add(this.plume);
    // Plasma sheath while in the air: heat glow, blue-white while scooping.
    this.sheath = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), glow(new THREE.Color('#ff8a3d'), 0));
    this.sheath.visible = false;
    this.root.add(this.sheath);
    this.inAir = false;
    this.root.add(this.body);
    scene.add(this.root);
    this.orbit = new Path({ color: TEAM_CSS[i], width: 1.5, opacity: 0.45 });
    this.sight = new Path({ color: TEAM_CSS[i], width: 1.5, opacity: 0.8, dashed: true, dash: 6, gap: 6 });
    this.trail = new Path({ color: TEAM_CSS[i], width: 2.5, opacity: 0.4 });
    this.threat = null;
  }
  update(s, predict) {
    const pos = v3(s.p), vel = v3(s.v);
    this.pos = pos; this.vel = vel; this.alive = s.alive;
    this.root.visible = s.alive;
    this.root.position.copy(pos);
    this.body.quaternion.set(s.q[0], s.q[1], s.q[2], s.q[3]);
    this.body.scale.setScalar(s.r * 1.25);
    this.fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.body.quaternion);
    this.plume.visible = s.thrust > 0.02;
    this.plume.scale.set(0.55, 0.55, 0.3 + 3.2 * s.thrust * (0.85 + Math.random() * 0.3));
    this.plume.position.set(0, 0, -0.75);
    const heat = Math.min(1, ((s.heating || 0) + (s.zone_burn || 0)) / 25);
    this.hullMat.emissive.copy(TEAM[this.i]).lerp(new THREE.Color('#ff3b1a'), heat);
    this.hullMat.emissiveIntensity = 0.25 + 2 * heat;
    const air = (s.heating || 0) > 0.05 || (s.scoop || 0) > 0;
    this.sheath.visible = s.alive && air;
    if (this.sheath.visible) {
      const scoop = Math.min(1, (s.scoop || 0) / 60);
      this.sheath.material.color.set('#ff8a3d').lerp(new THREE.Color('#9fd4ff'), scoop);
      this.sheath.material.opacity = Math.min(0.75, 0.15 + (s.heating || 0) / 30 + scoop * 0.4) * (0.85 + Math.random() * 0.3);
      // Sized in the world, but never more than a small disc on screen (close cameras).
      const cap = camera.position.distanceTo(pos) * 0.035;
      this.sheath.scale.setScalar(Math.min(s.r * (2.2 + 1.5 * scoop), cap));
    }
    if (predict) {
      // Trail: the last 10 s from the tape, so it's right whatever the playback speed.
      const pts = [], m = sampleShip(showK, this.i)?.match;
      for (let k = showK - 10; k <= showK; k += 0.2) {
        if (k < tape.frames[0].k) continue;
        const x = sampleShip(k, this.i);
        if (x && x.match === m && x.alive) pts.push(x.p.x, x.p.y, x.p.z);
      }
      if (s.alive) pts.push(pos.x, pos.y, pos.z);
      this.trail.set(pts);
      if (s.alive && planet) this.orbit.set(orbitPath(pos, vel)); else this.orbit.hide();
      this.sight.hide(); // missiles steer themselves: no ballistic firing line
    }
  }
  dispose() { scene.remove(this.root); this.orbit.dispose(); this.sight.dispose(); this.trail.dispose(); }
}
function orbitPath(pos, vel) {
  const gm = planet.gm, r0 = pos.distanceTo(planet.P);
  const E = vel.lengthSq() / 2 - gm / r0;
  const period = E < 0 ? 2 * Math.PI * Math.sqrt((-gm / (2 * E)) ** 3 / gm) : 90;
  return ballistic(pos, vel, Math.min(90, period * 1.01), 180);
}

// ---------- slugs ----------
const FUZE = 15;
const slugs = new Map(); // id -> {mesh, path, threat, owner}
function syncBodies(bodies, predict) {
  const seen = new Set();
  for (const b of bodies) {
    seen.add(b.id);
    if (b.k === 'asteroid') {
      let m = rocks.get(b.id);
      if (!m) {
        m = new THREE.Mesh(rockGeo(b.id * 104729 + 1), rockMat);
        scene.add(m);
        rocks.set(b.id, m);
      }
      m.position.set(b.p[0], b.p[1], b.p[2]);
      m.scale.setScalar(b.r);
    } else if (b.k === 'slug') {
      let v = slugs.get(b.id);
      if (!v) {
        const mesh = new THREE.Mesh(sphereGeo, glow(TEAM[b.o].clone().lerp(new THREE.Color('#ffffff'), 0.5)));
        mesh.scale.setScalar(2.5);
        scene.add(mesh);
        v = { mesh, path: new Path({ color: TEAM_CSS[b.o], width: 1.8, opacity: 0.55 }), threat: null, owner: b.o, id: b.id };
        slugs.set(b.id, v);
      }
      v.pos = v3(b.p); v.vel = v3(b.v); v.born = b.born;
      // Dark: its target can't see it yet (older recordings carry no knowledge: treat as seen).
      v.dark = b.seen === false;
      v.burn = !!b.burn; v.lock = !!b.lock;
      v.mesh.position.copy(v.pos);
      // Motor lit: a bright plume; burnt out: a dim coasting body.
      v.mesh.scale.setScalar(v.burn ? 3.2 : 1.8);
      v.mesh.material.color.set(v.burn ? '#ffd38a' : TEAM[b.o].clone().lerp(new THREE.Color('#ffffff'), 0.3));
      if (predict) {
        // Missiles steer: show where it has been (a smoke trail), not a ballistic guess.
        const pts = [];
        for (let k = showK - 4; k <= showK; k += 0.1) { const x = sampleBody(k, b.id); if (x) pts.push(x.p.x, x.p.y, x.p.z); }
        pts.push(v.pos.x, v.pos.y, v.pos.z);
        v.path.set(pts);
        const tgt = shipViews[1 - b.o];
        v.threat = null; v.darkThreat = null;
        if (tgt?.alive && tgt.pos) {
          const rel = tgt.pos.clone().sub(v.pos), closing = -tgt.vel.clone().sub(v.vel).dot(rel.clone().normalize());
          const tgo = closing > 1 ? rel.length() / closing : Infinity;
          const c = { time: tgo, dist: rel.length() };
          if (tgo < 4) { if (v.dark) v.darkThreat = c; else v.threat = c; }
        }
        const hot = v.threat && !v.dark;
        v.path.mat.color.set(hot ? HOT : v.dark ? '#8b93a7' : TEAM_CSS[b.o]);
        v.path.mat.opacity = hot ? 0.9 : v.dark ? 0.3 : 0.55;
        v.path.mat.linewidth = hot ? 2.5 : 1.8;
      }
    }
  }
  for (const [id, m] of rocks) if (!seen.has(id)) { scene.remove(m); rocks.delete(id); }
  for (const [id, v] of slugs) if (!seen.has(id)) { scene.remove(v.mesh); v.path.dispose(); slugs.delete(id); }
}
function clearBodies() {
  for (const [, m] of rocks) scene.remove(m);
  rocks.clear();
  for (const [, v] of slugs) { scene.remove(v.mesh); v.path.dispose(); }
  slugs.clear();
}

// ---------- 3D effects ----------
const fx = [];
function flash(pos, color, size, life = 0.5) {
  const m = new THREE.Mesh(sphereGeo, glow(new THREE.Color(color)));
  m.position.copy(pos);
  scene.add(m);
  fx.push({ m, t: 0, life, size });
}
function updateFx(dt) {
  for (let k = fx.length - 1; k >= 0; k--) {
    const f = fx[k];
    f.t += dt;
    const u = f.t / f.life;
    if (u >= 1) { scene.remove(f.m); fx.splice(k, 1); continue; }
    f.m.scale.setScalar(f.size * (0.4 + u));
    f.m.material.opacity = (1 - u) ** 2;
  }
}

// ---------- overlay: constant-size icons, labels, warnings, callouts ----------
const callouts = [];
function callout(text, pos, color, size = 22, life = 1.8) {
  callouts.push({ text, pos: pos.clone(), color, size, life, t: 0 });
}
function project(p) {
  const v = p.clone().project(camera);
  const inFront = p.clone().sub(camera.position).dot(camera.getWorldDirection(new THREE.Vector3())) > 0;
  return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, inFront };
}
function behindPlanet(p) {
  if (!planet) return false;
  const o = camera.position, d = p.clone().sub(o), L = d.length();
  d.divideScalar(L);
  const oc = o.clone().sub(planet.P);
  const b = oc.dot(d), c = oc.lengthSq() - planet.core * planet.core;
  const disc = b * b - c;
  if (disc < 0) return false;
  const t = -b - Math.sqrt(disc);
  return t > 0 && t < L;
}
const MARGIN = 28;
function drawShip(sv, s) {
  const pr = project(sv.pos);
  const color = TEAM_CSS[sv.i];
  const onScreen = pr.inFront && pr.x > MARGIN && pr.x < W - MARGIN && pr.y > MARGIN && pr.y < H - MARGIN;
  if (!onScreen) return drawEdgeArrow(pr, color, NAMES[sv.i]);
  const hidden = behindPlanet(sv.pos);
  ctx.globalAlpha = hidden ? 0.4 : 1;
  // Heading: project a point ahead of the nose.
  const ahead = project(sv.pos.clone().addScaledVector(sv.fwd, 60));
  let ang = Math.atan2(ahead.y - pr.y, ahead.x - pr.x);
  const foreshort = Math.hypot(ahead.x - pr.x, ahead.y - pr.y) < 6;
  ctx.save();
  ctx.translate(pr.x, pr.y);
  // Loud: emitting, seen from anywhere with a line of sight.
  if (isLoud(sv, s)) {
    const ph = (wallT * 1.6) % 1;
    ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    for (const o of [0, 0.5]) { const u = (ph + o) % 1; ctx.globalAlpha = (1 - u) * 0.6 * (hidden ? 0.4 : 1); ctx.beginPath(); ctx.arc(0, 0, 14 + 22 * u, 0, Math.PI * 2); ctx.stroke(); }
    ctx.globalAlpha = hidden ? 0.4 : 1;
  }
  // Threat ring.
  if (sv.threat && s.alive) {
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 110);
    ctx.strokeStyle = `rgba(255,77,94,${0.5 + 0.5 * pulse})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 22 + 4 * pulse, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 2;
  if (!s.alive) {
    ctx.strokeStyle = color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-9, -9); ctx.lineTo(9, 9); ctx.moveTo(9, -9); ctx.lineTo(-9, 9); ctx.stroke();
  } else if (foreshort) {
    ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(-9, -9); ctx.lineTo(-4, 0); ctx.lineTo(-9, 9); ctx.closePath();
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();
  // Name, hull bar, status.
  const x = pr.x, y = pr.y + 20;
  ctx.textAlign = 'center';
  ctx.font = '700 15px "Barlow Condensed", sans-serif';
  ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(NAMES[sv.i], x, y + 12);
  ctx.fillStyle = color; ctx.fillText(NAMES[sv.i], x, y + 12);
  const frac = Math.max(0, s.hull / s.hull_max);
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - 22, y + 17, 44, 6);
  ctx.fillStyle = color; ctx.fillRect(x - 21, y + 18, 42 * frac, 4);
  const st = status(sv, s);
  if (st.text !== 'COASTING') {
    ctx.font = '700 13px "Barlow Condensed", sans-serif';
    ctx.strokeText(st.text, x, y + 37);
    ctx.fillStyle = st.color; ctx.fillText(st.text, x, y + 37);
  }
  if (hidden) {
    ctx.font = '600 12px Barlow, sans-serif';
    ctx.fillStyle = '#c7d0e0';
    ctx.fillText('behind planet', x, y - 42);
  }
  // A round it can't see is coming (the audience knows; the pilot doesn't).
  if (sv.darkThreat && s.alive && !sv.threat) {
    ctx.font = '700 13px "Barlow Condensed", sans-serif';
    const t = `UNSEEN ROUND · ${sv.darkThreat.time.toFixed(1)} s`;
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(t, x, y + 37 + (st.text !== 'COASTING' ? 16 : 0));
    ctx.fillStyle = '#ffb347'; ctx.fillText(t, x, y + 37 + (st.text !== 'COASTING' ? 16 : 0));
  }
  ctx.globalAlpha = 1;
}
function drawEdgeArrow(pr, color, name) {
  let dx = pr.x - W / 2, dy = pr.y - H / 2;
  if (!pr.inFront) { dx = -dx; dy = -dy; }
  const ang = Math.atan2(dy, dx);
  const m = 44;
  const sx = (W / 2 - m) / Math.max(1e-6, Math.abs(Math.cos(ang))), sy = (H / 2 - m) / Math.max(1e-6, Math.abs(Math.sin(ang)));
  const r = Math.min(sx, sy);
  const x = W / 2 + Math.cos(ang) * r, y = H / 2 + Math.sin(ang) * r;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  ctx.fillStyle = color; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -10); ctx.lineTo(-8, 10); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  ctx.font = '700 13px "Barlow Condensed", sans-serif'; ctx.textAlign = 'center';
  ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(name, x - Math.cos(ang) * 26, y - Math.sin(ang) * 26 + 4);
  ctx.fillStyle = color; ctx.fillText(name, x - Math.cos(ang) * 26, y - Math.sin(ang) * 26 + 4);
}
function drawSlug(v) {
  const pr = project(v.pos);
  if (!pr.inFront || pr.x < 0 || pr.x > W || pr.y < 0 || pr.y > H) return;
  ctx.globalAlpha = behindPlanet(v.pos) ? 0.35 : 1;
  if (v.dark) {
    // Dark round: hollow, in the shooter's colour. Its target doesn't know it's there.
    ctx.strokeStyle = TEAM_CSS[v.owner]; ctx.lineWidth = 2;
    ctx.globalAlpha *= 0.8;
    ctx.beginPath(); ctx.arc(pr.x, pr.y, 4.5, 0, Math.PI * 2); ctx.stroke();
  } else {
    ctx.fillStyle = v.threat ? HOT : TEAM_CSS[v.owner];
    ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(pr.x, pr.y, v.threat ? 5.5 : 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
function drawCallouts(dt) {
  ctx.textAlign = 'center';
  for (let k = callouts.length - 1; k >= 0; k--) {
    const c = callouts[k];
    c.t += dt;
    if (c.t > c.life) { callouts.splice(k, 1); continue; }
    const pr = project(c.pos);
    if (!pr.inFront) continue;
    const u = c.t / c.life;
    ctx.globalAlpha = u < 0.75 ? 1 : 1 - (u - 0.75) / 0.25;
    ctx.font = `800 ${c.size}px "Barlow Condensed", sans-serif`;
    const y = pr.y - 36 - 40 * u;
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(c.text, pr.x, y);
    ctx.fillStyle = c.color; ctx.fillText(c.text, pr.x, y);
  }
  ctx.globalAlpha = 1;
}

// ---------- telestrator: diagrams that explain what's happening ----------
const INK = '#f6f1e4', AMBER = '#ffb347', GOOD = '#7ee0a1', SKY = '#9fd4ff';
const camRight = () => new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
function screenRadius(p, r) {
  const a = project(p), b = project(p.clone().addScaledVector(camRight(), r));
  return Math.hypot(b.x - a.x, b.y - a.y);
}
// Draw-on: a diagram element grows in over `dur` seconds from when the focus began.
function drawOn(m, delay = 0, dur = 0.35) { return THREE.MathUtils.clamp((wallT - (m.shownAt || 0) - delay) / dur, 0, 1); }
function polyline(pts3, { color = INK, width = 2, dash = null, alpha = 1, upto = 1, arrow = false } = {}) {
  const pts = pts3.map(project).filter((p) => p.inFront);
  if (pts.length < 2) return;
  const n = Math.max(2, Math.round(pts.length * upto));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.setLineDash(dash || []);
  ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 4;
  ctx.beginPath();
  pts.slice(0, n).forEach((p, j) => (j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
  if (arrow && n >= 2) {
    const a = pts[n - 2], b = pts[n - 1], ang = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.setLineDash([]); ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - 11 * Math.cos(ang - 0.45), b.y - 11 * Math.sin(ang - 0.45));
    ctx.lineTo(b.x - 11 * Math.cos(ang + 0.45), b.y - 11 * Math.sin(ang + 0.45));
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
function ring(p, r, { color = AMBER, width = 2, dash = [6, 5], alpha = 1, upto = 1 } = {}) {
  const c = project(p);
  if (!c.inFront) return;
  const R = Math.max(6, screenRadius(p, r));
  ctx.save();
  ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
  ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 4;
  ctx.beginPath(); ctx.arc(c.x, c.y, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * upto); ctx.stroke();
  ctx.restore();
  return R;
}
function dot(p, { color = INK, r = 4, hollow = false } = {}) {
  const c = project(p);
  if (!c.inFront) return;
  ctx.save();
  ctx.fillStyle = color; ctx.strokeStyle = hollow ? color : 'rgba(0,0,0,0.8)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  hollow ? ctx.stroke() : (ctx.fill(), ctx.stroke());
  ctx.restore();
}
// A measurement between two 3D points, with its label at the middle.
function measure(a, b, text, color = INK, alpha = 1) {
  const pa = project(a), pb = project(b);
  if (!pa.inFront || !pb.inFront) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
  const ang = Math.atan2(pb.y - pa.y, pb.x - pa.x) + Math.PI / 2;
  for (const q of [pa, pb]) { ctx.beginPath(); ctx.moveTo(q.x + 5 * Math.cos(ang), q.y + 5 * Math.sin(ang)); ctx.lineTo(q.x - 5 * Math.cos(ang), q.y - 5 * Math.sin(ang)); ctx.stroke(); }
  ctx.font = '700 13px "Barlow Condensed", sans-serif'; ctx.textAlign = 'center';
  const mx = (pa.x + pb.x) / 2 + 12 * Math.cos(ang), my = (pa.y + pb.y) / 2 + 12 * Math.sin(ang) + 4;
  ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.strokeText(text, mx, my);
  ctx.fillStyle = color; ctx.fillText(text, mx, my);
  ctx.restore();
}
// A telestrator card: title and lines, with a leader line to the point it explains.
function wrap(line, n = 46) {
  const out = [];
  let cur = '';
  for (const w of line.split(' ')) { if ((cur + ' ' + w).trim().length > n && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) out.push(cur);
  return out;
}
function card(p, title, lines, { color = INK, side = 1, alpha = 1 } = {}) {
  const a = project(p);
  if (!a.inFront) return;
  lines = lines.flatMap((l) => wrap(l));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = '800 17px "Barlow Condensed", sans-serif';
  const tw = ctx.measureText(title).width;
  ctx.font = '500 13px Barlow, sans-serif';
  const w = Math.max(tw, ...lines.map((l) => ctx.measureText(l).width)) + 22, h = lines.length ? 26 + lines.length * 17 : 28;
  let x = a.x + side * 70, y = a.y - 70 - h / 2;
  if (side < 0) x -= w;
  x = THREE.MathUtils.clamp(x, 12, W - w - 12);
  y = THREE.MathUtils.clamp(y, safe.top * H + 8, H - safe.bottom * H - h - 8);
  const ex = x + (side > 0 ? 0 : w), ey = y + h / 2;
  ctx.strokeStyle = color; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.fillStyle = 'rgba(7,10,18,0.9)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color; ctx.fillRect(x, y, 3, h);
  ctx.textAlign = 'left';
  ctx.font = '800 17px "Barlow Condensed", sans-serif'; ctx.fillStyle = color;
  ctx.fillText(title, x + 12, y + 20);
  ctx.font = '500 13px Barlow, sans-serif'; ctx.fillStyle = '#d7deea';
  lines.forEach((l, j) => ctx.fillText(l, x + 12, y + 38 + j * 17));
  ctx.restore();
}
function coast(p0, v0, T, n = 24) {
  const p = p0.clone(), v = v0.clone(), out = [p.clone()], h = T / n;
  for (let j = 0; j < n; j++) { for (let s = 0; s < 3; s++) { v.addScaledVector(gAt(p, _g), h / 3); p.addScaledVector(v, h / 3); } out.push(p.clone()); }
  return out;
}
function telestrate() {
  const m = dir.focus;
  if (!m || camMode !== 'director' || dir.replay) return;
  const fade = (x) => THREE.MathUtils.clamp(x, 0, 1);
  if (m.type === 'approach') {
    const u = m.k - showK, tgtP = v3(m.tgtP), slugP = v3(m.slugP), r = sampleShip(m.k, m.target)?.r || 5;
    if (u > 0) {
      // Before: the round's path to the meeting point, and where the target is headed if it coasts.
      const s = sampleBody(showK, m.slugId), t = sampleShip(showK, m.target);
      if (!s || !t) return;
      const path = [];
      for (let j = 0; j <= 16; j++) { const x = sampleBody(showK + (u * j) / 16, m.slugId); if (x) path.push(x.p); }
      path.push(slugP);
      const g = drawOn(m);
      polyline(path, { color: HOT, width: 2.5, upto: g, arrow: true });
      const ghost = coast(t.p, t.v, u);
      const gp = ghost[ghost.length - 1];
      polyline(ghost, { color: TEAM_CSS[m.target], width: 2, dash: [5, 6], upto: g, alpha: 0.9 });
      ring(gp, r + FUZE, { upto: drawOn(m, 0.25, 0.4) });
      const gap = gp.distanceTo(slugP) - r;
      const unseen = slugs.get(m.slugId)?.dark;
      if (gap < FUZE) card(gp, `ON TARGET · ${u.toFixed(1)} s${unseen ? ' · UNSEEN' : ''}`, [], { color: unseen ? '#ffb347' : '#ff8c7a', alpha: drawOn(m, 0.4, 0.3) });
    } else {
      // After: what happened, measured.
      const t0 = -u, a = fade(1 - (t0 - AFTER + 0.6) / 0.6);
      if (m.outcome === 'burst') {
        ring(tgtP, r + FUZE, { alpha: a });
        dot(slugP, { color: AMBER, r: 5 });
        measure(tgtP.clone().add(slugP.clone().sub(tgtP).setLength(r)), slugP, `${Math.round(m.gap)} m`, AMBER, a);
        card(tgtP, `BURST · −${Math.round(m.damage)}`, [], { color: AMBER, alpha: a });
      } else if (m.outcome === 'hit') {
        const flight = [];
        for (let k = m.fireK; k <= m.k; k += Math.max(0.1, (m.k - m.fireK) / 40)) { const x = sampleBody(k, m.slugId); if (x) flight.push(x.p); }
        flight.push(slugP);
        polyline(flight, { color: HOT, width: 2, alpha: 0.8 * a, dash: [2, 5] });
        const shooter = sampleShip(m.fireK, m.owner);
        if (shooter && m.fireK >= tape.frames[0].k) { dot(shooter.p, { color: TEAM_CSS[m.owner], r: 5, hollow: true }); card(shooter.p, `FIRED ${(m.k - m.fireK).toFixed(0)} s AGO`, [], { color: TEAM_CSS[m.owner], side: -1, alpha: a }); }
        card(tgtP, `DIRECT HIT · −${Math.round(m.damage)}`, [], { color: '#ff8c7a', alpha: a });
      } else {
        const g = ghostOf(m);
        ring(tgtP, r + FUZE, { color: 'rgba(255,179,71,0.7)', alpha: a });
        dot(slugP, { color: HOT, r: 4 });
        measure(tgtP.clone().add(slugP.clone().sub(tgtP).setLength(r)), slugP, `${Math.round(m.gap)} m`, GOOD, a);
        if (g && g.gap < FUZE) {
          dot(g.p, { color: TEAM_CSS[m.target], r: 6, hollow: true });
          ring(g.p, r, { color: TEAM_CSS[m.target], dash: [3, 4], alpha: a * 0.8 });
          measure(g.p, tgtP, `${Math.round(g.moved)} m`, TEAM_CSS[m.target], a);
          card(tgtP, 'DODGED', [], { color: GOOD, alpha: a });
        }
      }
    }
  } else if (m.type === 'skip') {
    const s = state.ships[m.ship], sv = shipViews[m.ship];
    if (!sv?.pos || !s) return;
    const inAir = showK >= m.k0 && showK <= (m.k1 ?? Infinity);
    if (inAir && s.alive) {
      const vel = sv.vel.clone();
      polyline([sv.pos, sv.pos.clone().addScaledVector(vel, 1.2)], { color: INK, width: 2, arrow: true, upto: drawOn(m) });
      if (s.lift) {
        const L = v3(s.lift);
        if (L.length() > 0.5) polyline([sv.pos, sv.pos.clone().addScaledVector(L.clone().normalize(), 18 + 4 * L.length())], { color: SKY, width: 3, arrow: true });
      }
      const out = s.lift && planet ? v3(s.lift).dot(sv.pos.clone().sub(planet.P).normalize()) : 0;
      card(sv.pos, out < -0.5 ? 'DIGGING IN' : 'SKIPPING', [], { color: out < -0.5 ? '#ff8c7a' : SKY, alpha: drawOn(m, 0.3, 0.3) });
    } else if (m.k1 != null && showK > m.k1 && m.survived) {
      card(sv.pos, `+${Math.round((m.gain || 0) * 100)}% FUEL`, [], { color: SKY, alpha: fade(1 - (showK - m.k1 - 1.6) / 0.6) });
    }
  }
}

// ---------- fog of war: what each ship knows ----------
const SENSOR_RANGE = 300;
// Loud: engine lit, firing, glowing in the air, or just hit. Loud ships are seen at any range.
function isLoud(sv, s) {
  return s.alive && ((s.thrust || 0) > 0.05 || (s.heating || 0) > 0.5 || (s.scoop || 0) > 0 || wallT - (sv.loudAt ?? -9) < 0.4);
}
function drawKnowledge() {
  state.ships.forEach((s, i) => {
    const sv = shipViews[i], foe = shipViews[1 - i], k = s.knows;
    if (!sv?.pos || !s.alive || !k) return;
    // Sensor range: faint, brighter while the enemy is inside it.
    const inside = foe?.pos && foe.alive && foe.pos.distanceTo(sv.pos) < SENSOR_RANGE;
    ring(sv.pos, SENSOR_RANGE, { color: TEAM_CSS[i], width: 1, dash: [2, 7], alpha: inside ? 0.45 : 0.14 });
    if (k.visible || !foe?.alive || k.age < 1) return;
    // Out of sight: where this ship thinks the enemy is, and how sure it is.
    const g = v3(k.p), c = project(g);
    if (!c.inFront) return;
    const R = Math.min(Math.max(screenRadius(g, Math.max(k.unc, 4)), 9), Math.min(W, H) * 0.42);
    ctx.save();
    ctx.strokeStyle = TEAM_CSS[i]; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, Math.PI * 2); ctx.stroke();
    // The ghost: a hollow marker in the enemy's colour.
    ctx.setLineDash([]); ctx.globalAlpha = 0.9; ctx.strokeStyle = TEAM_CSS[1 - i]; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(c.x, c.y - 8); ctx.lineTo(c.x + 8, c.y); ctx.lineTo(c.x, c.y + 8); ctx.lineTo(c.x - 8, c.y); ctx.closePath(); ctx.stroke();
    ctx.font = '700 12px "Barlow Condensed", sans-serif'; ctx.textAlign = 'center';
    const label = `${NAMES[i]}'s guess · ${Math.round(k.age)} s`;
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(label, c.x, c.y + R + 14);
    ctx.fillStyle = TEAM_CSS[i]; ctx.fillText(label, c.x, c.y + R + 14);
    ctx.restore();
    // How wrong the guess is: a thin line to where the enemy really is.
    if (foe.pos.distanceTo(g) > 15) polyline([g, foe.pos], { color: 'rgba(210,218,232,0.5)', width: 1, dash: [2, 4] });
  });
}
// A missile whose seeker has its target: a thin red line to it (for the audience).
function drawLocks() {
  for (const v of slugs.values()) {
    const tgt = shipViews[1 - v.owner];
    if (!v.lock || !tgt?.alive || !tgt.pos) continue;
    polyline([v.pos, tgt.pos], { color: 'rgba(255,90,90,0.75)', width: 1.5, dash: [3, 4] });
  }
}
function contactEvents() {
  state.ships.forEach((s, i) => {
    const sv = shipViews[i], k = s.knows, foe = state.ships[1 - i];
    if (!sv || !k || !s.alive || !foe?.alive) return;
    // Announce only a change that lasts (shots and burns flash a ship into view for a moment).
    if (sv.sees === undefined) { sv.sees = k.visible; sv.flipAt = null; return; }
    if (k.visible === sv.sees) { sv.flipAt = null; return; }
    if (sv.flipAt == null) { sv.flipAt = state.t; return; }
    if (state.t - sv.flipAt < 1.5) return;
    sv.sees = k.visible; sv.flipAt = null;
    const fv = shipViews[1 - i];
    if (k.visible) {
      if (fv?.pos) callout('SPOTTED', fv.pos, TEAM_CSS[i], 16, 1.2);
      feedLine(`${team(i)} spots ${team(1 - i)}`);
    } else {
      const hidden = planet && fv?.pos && sv.pos && lineBlocked(sv.pos, fv.pos);
      feedLine(`${team(i)} loses sight of ${team(1 - i)}${hidden ? ' behind the planet' : ''}`);
    }
  });
}
function lineBlocked(a, b) {
  const d = b.clone().sub(a), L = d.length(); d.divideScalar(L);
  const oc = a.clone().sub(planet.P), bb = oc.dot(d), cc = oc.lengthSq() - planet.core * planet.core, disc = bb * bb - cc;
  if (disc < 0) return false;
  const t = -bb - Math.sqrt(disc);
  return t > 0 && t < L;
}

function drawOverlay(dt) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!state) return;
  drawKnowledge();
  drawLocks();
  telestrate();
  for (const v of slugs.values()) drawSlug(v);
  state.ships.forEach((s, i) => shipViews[i]?.pos && drawShip(shipViews[i], s));
  drawCallouts(dt);
}

// ---------- plain-language status ----------
function status(sv, s) {
  if (!s.alive) return { text: 'DESTROYED', cls: 'dead', color: '#ff4d5e' };
  const locked = [...slugs.values()].some((v) => v.lock && v.owner !== sv.i && !v.dark);
  if (sv.threat) return { text: `${locked ? 'LOCKED · ' : 'MISSILE '}${sv.threat.time.toFixed(1)} s`, cls: 'danger', color: '#ff4d5e' };
  if (s.zone_burn > 0) return { text: 'OUT OF ZONE', cls: 'danger', color: '#ff4d5e' };
  if (s.heating > 1 || s.scoop > 0) {
    const out = s.lift && planet ? v3(s.lift).dot(v3(s.p).sub(planet.P).normalize()) : 0;
    if (out < -0.5) return { text: 'DIGGING IN', cls: 'danger', color: '#ff4d5e' };
    if (s.scoop > 0) return { text: `SKIPPING · +${Math.round((s.scoop / s.fuel_max) * 100)}%/s`, cls: 'scoop', color: '#9fd4ff' };
    return { text: 'IN ATMOSPHERE', cls: 'burn', color: '#ffc857' };
  }
  if (s.thrust > 0.05) return { text: 'BURNING', cls: 'burn', color: '#ffc857' };
  if (Math.hypot(...(s.strafe || [0, 0, 0])) > 0.05) return { text: 'DODGING', cls: 'dodge', color: '#7ee0a1' };
  return { text: 'COASTING', cls: '', color: '#8f9bb3' };
}
function orbitNote(s) {
  if (!planet || state.safe == null) return { text: '', cls: '' };
  const r = v3(s.p).sub(planet.P), { rp, ra } = apsides(r, v3(s.v));
  const alt = Math.round(r.length() - planet.core);
  if (rp < planet.core) return { text: `${alt} m up · on course for the ground: must skip or burn`, cls: 'hot' };
  if (rp < planet.core + (state.atmo || 45)) return { text: `${alt} m up · dips into the air: a skip to refuel`, cls: 'warn' };
  if (ra > state.safe) return { text: `${alt} m up · swings out past the safe zone`, cls: 'warn' };
  return { text: `${alt} m up · stable inside the zone`, cls: 'ok' };
}
function renderSide(i, s) {
  const sv = shipViews[i];
  const st = status(sv, s);
  const hull = Math.max(0, s.hull / s.hull_max), fuel = Math.max(0, s.fuel / s.fuel_max);
  const gun = !s.alive ? '' : s.ready ? '<span class="ok">loaded</span>' : s.ammo > 0 ? (s.reload_s != null ? `${Number(s.reload_s).toFixed(1)} s` : 'reloading') : '<span class="hot">empty</span>';
  const ammo = s.ammo / s.ammo_max;
  const orbit = orbitNote(s);
  const who = replayFile ? (replayFile.meta.labels?.[i] ?? '') : state.control === i ? 'you' : 'bot';
  $(`side${i}`).innerHTML = `
    <div class="top"><span class="team">${NAMES[i]}</span><span class="who">${s.name}${who ? ' · ' + who : ''}</span><span class="status ${st.cls}">${st.text}</span></div>
    <div class="rows">
      <span class="k">HULL</span><div class="meter hull ${hull < 0.3 ? 'low' : ''}"><i style="width:${hull * 100}%"></i></div><span class="v">${Math.round(hull * 100)}%</span>
      <span class="k">FUEL</span><div class="meter fuel ${fuel < 0.15 ? 'low' : ''} ${s.scoop > 0 ? 'scooping' : ''}"><i style="width:${fuel * 100}%"></i></div><span class="v">${fuel < 0.01 ? '<span class="hot">DRY</span>' : Math.round(fuel * 100) + '%'}</span>
      <span class="k">AMMO</span><div class="meter ammo-m"><i style="width:${ammo * 100}%"></i></div><span class="v">${s.ammo} · ${gun}</span>
      <span class="k">ORBIT</span><span class="note ${orbit.cls}">${orbit.text}</span>
      ${s.knows ? `<span class="k">SENSE</span><span class="note ${s.knows.visible ? 'ok' : 'warn'}">${s.knows.visible ? `sees ${NAMES[1 - i]}` : `lost ${NAMES[1 - i]} ${Math.round(s.knows.age)} s ago · ±${Math.round(s.knows.unc)} m`} · ${isLoud(sv, s) ? '<span class="hot">loud</span>' : 'quiet'}</span>` : ''}
      <span class="k">SPEED</span><span class="note">${Math.hypot(...s.v).toFixed(0)} m/s · ${s.stats.hits} hit${s.stats.hits === 1 ? '' : 's'} from ${s.stats.shots} shot${s.stats.shots === 1 ? '' : 's'}</span>
    </div>`;
}
function renderMiddle() {
  const t = Math.max(0, state.t);
  $('clock').textContent = fmtTime(t);
  const sdAt = state.sudden_death_at ?? 150;
  const sd = t >= sdAt && !state.finished;
  $('clock').classList.toggle('sd', sd);
  const ph = $('phase');
  ph.classList.toggle('sd', sd);
  ph.textContent = state.finished ? 'Final' : sd ? `Sudden death · zone shrinking · ends ${fmtTime(state.time_limit)}` : `Sudden death in ${fmtTime(sdAt - t)}`;
  const f = state.ships.map((s) => Math.max(0, s.hull / s.hull_max));
  $('tugBlue').style.flexGrow = f[0] + 0.001;
  $('tugRed').style.flexGrow = f[1] + 0.001;
  const d = Math.round((f[0] - f[1]) * 100);
  $('leadText').textContent = d === 0 ? 'even' : `${d > 0 ? 'BLUE' : 'RED'} +${Math.abs(d)}%`;
  // Broadcast badge: what the clock is doing.
  const b = $('bcast'), r = dir.rate;
  let text = '', cls = '';
  if (dir.replay) { text = 'INSTANT REPLAY'; cls = 'replay'; }
  else if (r < 0.9) { text = `SLOW-MO ${r < 0.3 ? '¼' : r < 0.45 ? '⅓' : r < 0.7 ? '½' : '¾'}×`; cls = 'slow'; }
  else if (r > 1.2) { text = `▶▶ ${r.toFixed(1)}×`; cls = 'fast'; }
  else if (!replayFile) { const lag = (headK() - showK) / Math.max(serverSpeed, 1e-6); text = state.control != null ? 'LIVE' : `LIVE · ${lag.toFixed(0)} s delay`; }
  b.textContent = text; b.className = `bcast ${cls}`; b.hidden = !text;
}

// ---------- feed & events ----------
const feed = $('feed');
const team = (i) => `<b class="${i === 0 ? 'blue' : 'red'}">${NAMES[i]}</b>`;
function feedLine(html, cls = '') {
  if (quiet) return;
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = html;
  feed.prepend(d);
  while (feed.children.length > 4) feed.lastChild.remove();
}
let shake = 0;
const burstPending = new Set();
// The director's card is about to explain this moment: skip the floating callouts it repeats.
const explaining = () => camMode === 'director' && dir.focus?.type === 'approach' && Math.abs(dir.focus.k - showK) < 0.3;
function handleEvent(e) {
  switch (e.type) {
    case 'reset':
      feed.innerHTML = '';
      for (const sv of shipViews) sv.inAir = false;
      $('banner').hidden = true;
      break;
    case 'fire': {
      flash(v3(e.p), '#f4f8ff', 4, 0.3);
      const sv = shipViews[e.ship];
      if (sv) sv.loudAt = wallT;
      if (sv?.pos) callout('FIRE', sv.pos, TEAM_CSS[e.ship], 16, 0.9);
      break;
    }
    case 'impact':
      flash(v3(e.p), '#f4f8ff', 5, 0.3);
      break;
    case 'burst': {
      // Proximity fuze: fragments, not a direct hit. The Hit event follows (if armour didn't stop it).
      const p = v3(e.p);
      flash(p, '#ffb347', 9, 0.55);
      if (!explaining()) callout(`BURST ${Math.round(e.dist)} m`, p, '#ffb347', 18, 1.2);
      burstPending.add(e.victim);
      break;
    }
    case 'hit': {
      const p = v3(e.p);
      if (shipViews[e.victim]) shipViews[e.victim].loudAt = wallT;
      const burst = e.cause === 'slug' && burstPending.delete(e.victim);
      flash(p, '#ffffff', 3 + Math.sqrt(e.damage), 0.7);
      shake = Math.max(shake, Math.min(2.5, e.damage / 150));
      if (!explaining()) callout(`−${Math.round(e.damage)}`, p, '#ff5a5a', 30);
      const cause = burst ? `${team(e.attacker)}'s round <b>BURSTS</b> beside ${team(e.victim)}` : { slug: e.attacker === e.victim ? `${team(e.victim)} is hit by its own round` : `${team(e.attacker)} <b>HITS</b> ${team(e.victim)}`, ram: `${team(e.attacker)} rams ${team(e.victim)}`, asteroid: `${team(e.victim)} hits a rock`, planet: `${team(e.victim)} hits the planet`, wall: `${team(e.victim)} hits the arena wall` }[e.cause] || `${team(e.victim)} takes damage`;
      feedLine(`${cause} · −${Math.round(e.damage)} hull`, 'big');
      break;
    }
    case 'kill': {
      flash(v3(e.p), '#ffffff', 30, 1.4);
      shake = 3;
      callout('DESTROYED', v3(e.p), '#ffffff', 34, 2.5);
      const how = { slug: 'a round', ram: 'a ram', planet: 'the planet', atmosphere: 'atmospheric heating', zone: 'the burn zone', asteroid: 'a rock', wall: 'the wall' }[e.cause] || e.cause;
      feedLine(`${team(e.victim)} DESTROYED by ${e.attacker != null && e.attacker !== e.victim ? team(e.attacker) + "'s " : ''}${how}`, 'kill');
      break;
    }
    case 'end': {
      if (quiet) break;
      const b = $('banner');
      b.hidden = false;
      const how = e.decision ? 'on hull at the bell' : 'by destruction';
      b.innerHTML = e.winner == null ? 'Stalemate<small>no kill by the bell</small>' : `<span style="color:${TEAM_CSS[e.winner]}">${NAMES[e.winner]} wins</span><small>${how}${replayFile ? '' : ' · next match shortly'}</small>`;
      break;
    }
  }
}

// ---------- camera ----------
// The director works on a stable stage: it looks along the fight's orbital plane (so orbits read
// as true ellipses and the planet holds still), tilted a little for depth, and only zooms and
// re-centres on what matters — cutting, not swinging, when it needs a different angle. Framing
// respects the HUD: points of interest are fitted into the part of the screen nothing covers.
let camMode = 'director';
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3(0, 400, 1200);
let followDir = null;
const ease = (rate, dt) => 1 - Math.exp(-rate * dt);
const safe = { top: 0.2, bottom: 0.12 };
const cam = { q: new THREE.Quaternion(), c: new THREE.Vector3(), d: 1200, init: false };
let stageN = null;
const TILT = THREE.MathUtils.degToRad(24);
function basisQuat(back, upHint) {
  const B = back.clone().normalize();
  let U = upHint.clone().sub(B.clone().multiplyScalar(upHint.dot(B)));
  if (U.lengthSq() < 1e-6) U = B.clone().cross(new THREE.Vector3(1, 0, 0));
  U.normalize();
  const R = U.clone().cross(B).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(R, U, B));
}
const axisOf = (q, x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(q);
function stageQuat(dt) {
  const hs = shipViews.filter((s) => s.pos && s.alive && planet).map((s) => s.pos.clone().sub(planet.P).cross(s.vel).normalize());
  if (hs.length) {
    const n = hs.reduce((a, h) => a.add(h), new THREE.Vector3());
    if (n.lengthSq() < 0.05) n.copy(hs[0]);
    n.normalize();
    if (!stageN) stageN = n.clone();
    if (n.dot(stageN) < 0) n.negate();
    stageN.lerp(n, ease(0.25, dt)).normalize();
  }
  const N = stageN || new THREE.Vector3(0, 0, 1);
  const upIn = axisOf(cam.q, 0, 1, 0).projectOnPlane(N);
  if (upIn.lengthSq() < 1e-6) upIn.copy(N.clone().cross(new THREE.Vector3(1, 0, 0)));
  upIn.normalize();
  const back = N.clone().multiplyScalar(Math.cos(TILT)).addScaledVector(upIn, -Math.sin(TILT));
  return basisQuat(back, upIn);
}
// Fit points into the safe area for orientation q: returns look-at centre and distance.
function fit(points, q, minR) {
  const R = axisOf(q, 1, 0, 0), U = axisOf(q, 0, 1, 0), B = axisOf(q, 0, 0, 1);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, zs = 0;
  for (const p of points) { const x = p.dot(R), y = p.dot(U); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); zs += p.dot(B); }
  const c = R.clone().multiplyScalar((x0 + x1) / 2).addScaledVector(U, (y0 + y1) / 2).addScaledVector(B, zs / points.length);
  const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * (1 - safe.top - safe.bottom) * 0.9;
  const tanX = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect * 0.88;
  let d = minR / Math.min(tanX, tanY);
  for (const p of points) {
    const o = p.clone().sub(c), z = o.dot(B);
    d = Math.max(d, z + Math.abs(o.dot(R)) / tanX, z + Math.abs(o.dot(U)) / tanY);
  }
  return { c, d };
}
function directorShot(dt) {
  const alive = shipViews.filter((s) => s.pos && s.alive);
  const all = alive.length ? alive : shipViews.filter((s) => s.pos);
  if (!all.length) return null;
  const m = dir.focus;
  let q = stageQuat(dt), pts = all.map((s) => s.pos), minR = 110;
  switch (dir.shot) {
    case 'wide':
      if (planet) { const R = axisOf(q, 1, 0, 0), U = axisOf(q, 0, 1, 0), c = planet.core * 1.3; pts = pts.concat([planet.P.clone().addScaledVector(R, c), planet.P.clone().addScaledVector(R, -c), planet.P.clone().addScaledVector(U, c), planet.P.clone().addScaledVector(U, -c)]); }
      minR = 300;
      break;
    // No zoom: every shot keeps both ships in frame (zooming in lost the fight). A moment only
    // widens the frame to include what matters: the round in flight and where it meets.
    case 'approach': {
      const s = sampleBody(showK, m.slugId), u = m.k - showK;
      pts.push(v3(m.tgtP));
      if (s && u > 0) pts.push(s.p);
      break;
    }
    case 'kill':
      pts.push(v3(m.p));
      break;
    case 'chase': {
      const r = dir.replay, sh = r?.shot;
      const s = sh && showK < sh.k ? sampleBody(showK, sh.slugId) : null;
      if (s) pts.push(s.p);
      pts.push(v3(r.m.p));
      break;
    }
  }
  const { c, d } = fit(pts, q, minR);
  return { q, c, d };
}
function updateCamera(dt) {
  controls.enabled = camMode === 'free';
  if (camMode === 'free') { camera.clearViewOffset(); controls.update(); return; }
  // Shift the frame's centre to the middle of the uncovered area.
  camera.setViewOffset(W, H, 0, Math.round(H / 2 - (safe.top * H + (1 - safe.top - safe.bottom) * H / 2)), W, H);
  const views = shipViews.filter((s) => s.pos && s.alive);
  const all = views.length ? views : shipViews.filter((s) => s.pos);
  if (!all.length) return;
  if (camMode === 'director') {
    const want = directorShot(dt);
    if (!want) return;
    const angle = cam.init ? cam.q.angleTo(want.q) : Math.PI;
    if (dir.cut || angle > THREE.MathUtils.degToRad(55) || !cam.init || want.pose) {
      // A cut: the new angle is too far for a move to read (or the chase camera is locked on).
      if (!want.pose || dir.cut || !cam.init) { cam.q.copy(want.q); cam.c.copy(want.c); cam.d = want.d; }
      else { cam.q.slerp(want.q, ease(10, dt)); cam.c.lerp(want.c, ease(10, dt)); cam.d += (want.d - cam.d) * ease(10, dt); }
      dir.cut = false; cam.init = true;
    } else {
      cam.q.slerp(want.q, ease(1.6, dt));
      cam.c.lerp(want.c, ease(dir.shot === 'approach' ? 3 : 2, dt));
      // Zoom in log space: equally smooth pushing in and pulling out.
      cam.d = Math.exp(Math.log(cam.d) + (Math.log(want.d) - Math.log(cam.d)) * ease(dir.shot === 'approach' || dir.shot === 'kill' ? 2.2 : 1.2, dt));
    }
    camPos.copy(cam.c).addScaledVector(axisOf(cam.q, 0, 0, 1), cam.d);
    camera.position.copy(camPos);
    camera.quaternion.copy(cam.q);
  } else {
    if (camMode === 'follow0' || camMode === 'follow1') {
      const i = camMode === 'follow0' ? 0 : 1;
      const me = shipViews[i], foe = shipViews[1 - i];
      if (!me?.pos) return;
      const toFoe = foe?.pos && foe.alive ? foe.pos.clone().sub(me.pos) : new THREE.Vector3(0, 0, 1);
      const upv = planet ? me.pos.clone().sub(planet.P).normalize() : WORLD_UP;
      const wantDir = toFoe.clone().normalize().negate().addScaledVector(upv, 0.45).normalize();
      followDir = (followDir || wantDir.clone()).lerp(wantDir, ease(0.6, dt)).normalize();
      const look = me.pos.clone().addScaledVector(toFoe, Math.min(0.35, 150 / Math.max(1, toFoe.length())));
      camTarget.lerp(look, ease(4, dt));
      camPos.lerp(me.pos.clone().addScaledVector(followDir, 90), ease(4, dt));
    } else {
      const i = state?.control ?? 0;
      const sv = shipViews[i];
      if (!sv?.pos) return;
      camPos.lerp(sv.pos.clone().addScaledVector(sv.fwd, -80).addScaledVector(WORLD_UP, 25), ease(5, dt));
      camTarget.lerp(sv.pos.clone().addScaledVector(sv.fwd, 60), ease(6, dt));
    }
    // Never inside the planet or its air: stay clear of the limb.
    if (planet) {
      const off = camPos.clone().sub(planet.P), minR = planet.core + (state?.atmo || 45) + 25;
      if (off.length() < minR) camPos.copy(planet.P).addScaledVector(off.normalize(), minR);
    }
    camera.position.copy(camPos);
    camera.up.copy(planet && (camMode === 'follow0' || camMode === 'follow1') ? shipViews[camMode === 'follow0' ? 0 : 1].pos.clone().sub(planet.P).normalize() : WORLD_UP);
    camera.lookAt(camTarget);
    cam.q.copy(camera.quaternion); cam.c.copy(camTarget); cam.d = camPos.distanceTo(camTarget); cam.init = true;
  }
  if (shake > 0.01) camera.position.add(new THREE.Vector3().randomDirection().multiplyScalar(shake * Math.min(1, cam.d / 400)));
  shake *= Math.exp(-dt * 8);
}
// A fixed sun: the planet keeps a day side, so the camera's own moves read as moves.
sun.position.set(1400, 900, 1100);
sun.target.position.set(0, 0, 0);

// ---------- live stream or recorded replay ----------
const params = new URLSearchParams(location.search);
const replayUrl = params.get('replay');
const ALWAYS_RENDER = params.get('render') === 'always';
let replayFile = null, ws = null, shipViews = [], shipKey = '', serverSpeed = 1;
function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => { $('conn').hidden = true; };
  ws.onclose = () => { $('conn').hidden = false; $('conn').textContent = 'reconnecting…'; setTimeout(connect, 1000); };
  ws.onmessage = (m) => pushLive(JSON.parse(m.data));
}
const send = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));
function onState(s) {
  const key = s.ships.map((x) => x.id + x.name).join('|');
  if (key !== shipKey) {
    shipViews.forEach((v) => v.dispose());
    shipViews = s.ships.map((_, i) => new ShipView(i));
    shipKey = key;
    clearBodies();
    if (!replayFile) { $('selA').value = s.ships[0].name; $('selB').value = s.ships[1].name; }
  }
  if (s.hazards) {
    const hk = JSON.stringify(s.hazards);
    if (hk !== hazardKey) { hazardKey = hk; buildWorld(s); }
  }
  state = s;
  for (const e of s.events || []) handleEvent(e);
  if (!replayFile) $('btnPause').textContent = s.paused ? 'Resume' : 'Pause';
}
async function loadReplay(url) {
  $('conn').hidden = false;
  $('conn').textContent = 'loading replay…';
  const data = await (await fetch(url)).json();
  replayFile = { meta: data.meta, playing: true, speed: 1 };
  tape.hazards = data.frames[0].hazards;
  for (const f of data.frames) { const fr = { ...f, k: f.t, match: 0 }; tape.frames.push(fr); detectFrame(fr); }
  $('conn').hidden = true;
  document.body.classList.add('replay-mode');
  const info = data.meta.info, labels = data.meta.labels || [];
  $('replayTitle').textContent = params.get('title') || `${labels[0]} vs ${labels[1]}`;
  const result = info.winner == null ? 'stalemate' : `${NAMES[info.winner]} (${labels[info.winner] ?? ''}) wins${info.decision ? ' on hull' : ''}`;
  $('replayResult').textContent = `· ${result}`;
  $('scrub').max = headK();
}
function seek(k) {
  showK = THREE.MathUtils.clamp(k, tape.frames[0]?.k ?? 0, headK());
  dir.replay = null; quiet = false; dir.cut = true; dir.focus = null; dir.lastFeatureK = -Infinity;
  lastShownIdx = -999; // a jump: reset visuals rather than replaying events
  for (const m of moments) if (m.k > showK) { m.announced = false; m.replayed = false; m.replayDone = false; }
  announcedK = showK;
}

// ---------- input ----------
const keys = new Set();
const toggleLegend = () => { $('legend').hidden = !$('legend').hidden; };
for (const b of document.querySelectorAll('[data-legend]')) b.onclick = toggleLegend;
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === 'l') toggleLegend();
  if (k === 'h') $('help').hidden = !$('help').hidden;
  if (k === 'c') { const o = ['director', 'follow0', 'follow1', 'free']; camMode = o[(o.indexOf(camMode) + 1) % o.length]; $('selCam').value = camMode; $('selCam2').value = camMode; }
  if (replayFile) {
    if (k === ' ') { e.preventDefault(); togglePlay(); }
    if (k === 'arrowright') seek(showK + 5);
    if (k === 'arrowleft') seek(showK - 5);
    return;
  }
  if (e.repeat) return;
  if (k === 'n') newMatch();
  if (k === 'p') send({ type: 'pause' });
  if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
  keys.add(k);
  sendInput();
});
addEventListener('keyup', (e) => { keys.delete(e.key.toLowerCase()); sendInput(); });
addEventListener('blur', () => { keys.clear(); sendInput(); });
const axis = (a, b) => (keys.has(a) ? 1 : 0) - (keys.has(b) ? 1 : 0);
function sendInput() {
  if (replayFile || state?.control == null) return;
  send({ type: 'input', thrust: keys.has('shift') ? 1 : 0, pitch: axis('w', 's'), yaw: axis('a', 'd'), roll: axis('e', 'q'),
    strafe_x: axis('arrowleft', 'arrowright'), strafe_y: axis('arrowup', 'arrowdown'), strafe_z: axis('r', 'f'), fire: keys.has(' ') });
}
setInterval(sendInput, 100);
function newMatch() { send({ type: 'reset', a: $('selA').value, b: $('selB').value }); }
function togglePlay() {
  replayFile.playing = !replayFile.playing;
  if (replayFile.playing && showK >= headK()) seek(0);
  $('btnPlay').textContent = replayFile.playing ? 'Pause' : 'Play';
}
$('btnReset').onclick = newMatch;
$('selA').onchange = newMatch;
$('selB').onchange = newMatch;
$('btnPause').onclick = () => send({ type: 'pause' });
$('selSpeed').onchange = (e) => { serverSpeed = parseFloat(e.target.value); send({ type: 'speed', value: serverSpeed }); };
$('selCam').onchange = (e) => { camMode = e.target.value; dir.cut = true; e.target.blur(); };
$('selCam2').onchange = (e) => { camMode = e.target.value; dir.cut = true; e.target.blur(); };
$('selCtl').onchange = (e) => {
  const v = e.target.value;
  send({ type: 'control', ship: v === '' ? null : parseInt(v, 10) });
  camMode = v === '' ? 'director' : 'pilot';
  $('selCam').value = camMode;
  e.target.blur();
};
$('btnPlay').onclick = togglePlay;
$('scrub').oninput = (e) => seek(parseFloat(e.target.value));
$('replaySpeed').onchange = (e) => { replayFile.speed = parseFloat(e.target.value); e.target.blur(); };
for (const el of document.querySelectorAll('select, button')) el.addEventListener('keydown', (e) => e.key === ' ' && e.preventDefault());

// ---------- loop ----------
let last = performance.now(), predictAt = 0, hudAt = 0, wallT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = THREE.MathUtils.clamp((now - last) / 1000, 0, 0.1);
  last = Math.max(last, now);
  wallT += dt;
  if (document.hidden && !ALWAYS_RENDER) return; // don't compete with training for CPU
  advanceClock(dt);
  if (started && tape.frames.length) {
    onState(tapeState(showK));
    announce();
    if (!quiet) contactEvents();
    if (replayFile) {
      $('scrub').value = showK;
      $('replayTime').textContent = `${fmtTime(showK)} / ${fmtTime(headK())}`;
    }
  }
  if (state) {
    // Predictions (orbits, round paths, threats) at 10 Hz; drawing every frame.
    const predict = now - predictAt > 100;
    if (predict) predictAt = now;
    state.ships.forEach((s, i) => shipViews[i]?.update(s, predict));
    syncBodies(state.bodies, predict);
    if (predict) {
      for (const sv of shipViews) { sv.threat = null; sv.darkThreat = null; }
      for (const v of slugs.values()) {
        const tv = shipViews[1 - v.owner];
        if (!tv) continue;
        if (v.threat && !v.dark && (!tv.threat || v.threat.time < tv.threat.time)) tv.threat = v.threat;
        if (v.darkThreat && (!tv.darkThreat || v.darkThreat.time < tv.darkThreat.time)) tv.darkThreat = v.darkThreat;
      }
    }
    if (now - hudAt > 100) {
      hudAt = now;
      // Keep the feed and legend clear of the bottom bar, whatever its height; measure the HUD
      // so the camera frames the action in the uncovered area.
      const bar = replayFile ? $('replaybar') : $('toolbar');
      const off = `${bar.offsetHeight + 20}px`;
      feed.style.bottom = off;
      $('legend').style.bottom = off;
      $('help').style.bottom = off;
      safe.top = Math.min(0.35, ($('scoreboard').getBoundingClientRect().bottom + 10) / H);
      safe.bottom = Math.min(0.3, (H - bar.getBoundingClientRect().top + 10) / H);
      state.ships.forEach((s, i) => renderSide(i, s));
      renderMiddle();
    }
    updateCamera(dt);
    updateZones();
  }
  updateFx(dt);
  composer.render();
  drawOverlay(dt);
}
resize();
requestAnimationFrame(frame);
if (replayUrl) loadReplay(replayUrl).catch((e) => { $('conn').textContent = 'could not load replay: ' + e.message; });
else connect();
// Inspection hook (debugging only).
window.__sk = { seek: (k) => seek(k), step(seconds, fps = 30) { let t = last; for (let j = 0; j < seconds * fps; j++) { t += 1000 / fps; frame(t); } }, dir, moments, tape, safe, get showK() { return showK; }, get started() { return started; }, get replayFile() { return replayFile; } };
