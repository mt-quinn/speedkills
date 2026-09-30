// Speed Kills viewer: renders the authoritative sim stream. Legibility first.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const WS_URL = `ws://${location.hostname || 'localhost'}:8081`;
const TEAM = [new THREE.Color('#3cc8ff'), new THREE.Color('#ff6a3d')];
const TEAM_CSS = ['#3cc8ff', '#ff6a3d'];
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

// ---------- renderer / scene ----------
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#04060c');
const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 12000);
camera.position.set(0, 300, 900);
const controls = new OrbitControls(camera, canvas);
controls.enabled = false;
controls.enableDamping = true;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.35, 0.6);
composer.addPass(bloom);
composer.addPass(new OutputPass());

scene.add(new THREE.HemisphereLight('#8fb4ff', '#1a1020', 0.7));
const sun = new THREE.DirectionalLight('#fff1dd', 2.2);
sun.position.set(600, 900, 400);
scene.add(sun);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  bloom.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// Stars.
{
  const n = 2500, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(5000 + Math.random() * 2000);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: '#9fb0d0', size: 2, sizeAttenuation: false })));
}

// ---------- arena ----------
let arenaRadius = 450;
let safeRadius = Infinity;
let atmoHeight = 0;
const arena = new THREE.Group();
scene.add(arena);
function buildArena(R) {
  arena.clear();
  const pts = [];
  const seg = 96;
  for (let lat = -75; lat <= 75; lat += 15) {
    const phi = THREE.MathUtils.degToRad(lat);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      pts.push(R * Math.cos(phi) * Math.cos(a0), R * Math.sin(phi), R * Math.cos(phi) * Math.sin(a0));
      pts.push(R * Math.cos(phi) * Math.cos(a1), R * Math.sin(phi), R * Math.cos(phi) * Math.sin(a1));
    }
  }
  for (let lon = 0; lon < 180; lon += 15) {
    const th = THREE.MathUtils.degToRad(lon);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      pts.push(R * Math.cos(a0) * Math.cos(th), R * Math.sin(a0), R * Math.cos(a0) * Math.sin(th));
      pts.push(R * Math.cos(a1) * Math.cos(th), R * Math.sin(a1), R * Math.cos(a1) * Math.sin(th));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  arena.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#2a3a5c', transparent: true, opacity: 0.35 })));
}
buildArena(1);
arena.scale.setScalar(arenaRadius);
arena.visible = false; // the planet's zones are the boundary; the far wall is a backstop

// Planet zones: safe boundary, then amber and red burn bands. Unit grids scaled per state.
const zoneShells = ['#7fa6d6', '#ffb347', '#ff4d5e'].map((color, k) => {
  const g = arena.children[0].geometry;
  const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: [0.08, 0.1, 0.12][k], depthWrite: false }));
  m.visible = false;
  scene.add(m);
  return m;
});
// Each zone boundary drawn as its true silhouette from the camera: a clean circle.
const zoneLimbs = ['#8fb8ff', '#ffb347', '#ff4d5e'].map((color, k) => {
  const pts = [];
  for (let i = 0; i <= 256; i++) { const a = (i / 256) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0)); }
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: [0.7, 0.55, 0.55][k], depthWrite: false }));
  l.frustumCulled = false;
  l.visible = false;
  scene.add(l);
  return l;
});
function updateLimbs() {
  const planet = hazards.find((h) => h.k === 'planet');
  zoneLimbs.forEach((l, k) => {
    if (!planet || !state || state.safe == null) { l.visible = false; return; }
    const R = state.safe + k * state.zone_width;
    const toCam = camera.position.clone().sub(planet.P);
    const D = toCam.length();
    l.visible = D > R * 1.01;
    if (!l.visible) return;
    toCam.normalize();
    l.position.copy(planet.P).addScaledVector(toCam, (R * R) / D);
    l.scale.setScalar(R * Math.sqrt(1 - (R * R) / (D * D)));
    l.lookAt(camera.position);
  });
}
const safeFill = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.MeshBasicMaterial({ color: '#7fa6d6', transparent: true, opacity: 0.025, side: THREE.BackSide, depthWrite: false }));
safeFill.visible = false;
scene.add(safeFill);

// Wall proximity rings: one per ship, glowing on the wall where it would hit.
const wallRings = TEAM.map((c) => {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.7, 1, 48),
    new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  scene.add(m);
  return m;
});

// ---------- shared resources ----------
const glowMat = (color, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
const sphereGeo = new THREE.SphereGeometry(1, 32, 16);
const lowSphere = new THREE.SphereGeometry(1, 12, 8);
function rockGeo(detail, jag, seed) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const cache = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!cache.has(key)) cache.set(key, 1 + (rnd() - 0.5) * jag);
    const k = cache.get(key);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}
const rockMat = new THREE.MeshStandardMaterial({ color: '#6b6560', roughness: 0.95, flatShading: true });

// ---------- ships ----------
// A robot gunship: hull oriented along +Z, a railgun spine that glows as it charges, main
// engine plume, strafing thruster puffs, spin ring, heading line, trail, ghost and orbit.
function hullGeometry() {
  // Arrowhead hull: long spine, swept fins. Unit length along +Z.
  const g = new THREE.ConeGeometry(0.42, 1.7, 5);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, 0.1);
  return g;
}
const HULL_GEO = hullGeometry();
const FIN_GEO = (() => { const g = new THREE.BoxGeometry(1.5, 0.06, 0.55); g.translate(0, 0, -0.45); return g; })();
const SPINE_GEO = (() => { const g = new THREE.CylinderGeometry(0.07, 0.07, 1.9, 8); g.rotateX(Math.PI / 2); g.translate(0, 0.28, 0.15); return g; })();

class ShipView {
  constructor(i, s) {
    this.i = i;
    this.color = TEAM[i];
    this.root = new THREE.Group();
    scene.add(this.root);
    this.body = new THREE.Group();
    this.root.add(this.body);

    this.hullMat = new THREE.MeshStandardMaterial({ color: this.color.clone().lerp(new THREE.Color('#d8dde6'), 0.45), roughness: 0.45, metalness: 0.35, emissive: this.color, emissiveIntensity: 0.12, flatShading: true });
    this.hull = new THREE.Mesh(HULL_GEO, this.hullMat);
    this.fins = new THREE.Mesh(FIN_GEO, this.hullMat);
    this.spine = new THREE.Mesh(SPINE_GEO, new THREE.MeshStandardMaterial({ color: '#c9d0dc', roughness: 0.3, metalness: 0.8 }));
    this.body.add(this.hull, this.fins, this.spine);

    // Firing line: where a shot fired right now would fly (shown while loaded).
    this.sight = makeGhost(this.color.clone().lerp(new THREE.Color('#ffffff'), 0.5), 0.35);
    scene.add(this.sight);
    this.loadedGlow = new THREE.Mesh(sphereGeo, glowMat(new THREE.Color('#f4f8ff')));
    this.body.add(this.loadedGlow);

    // Main engine and strafing puffs.
    const plumeGeo = new THREE.ConeGeometry(0.5, 1, 16, 1, true);
    plumeGeo.rotateX(-Math.PI / 2);
    plumeGeo.translate(0, 0, -0.5);
    this.plume = new THREE.Mesh(plumeGeo, glowMat(new THREE.Color('#ffb870'), 0.9));
    this.plumeCore = new THREE.Mesh(plumeGeo, glowMat(new THREE.Color('#fffaf0'), 0.95));
    this.body.add(this.plume, this.plumeCore);
    this.puffs = [0, 1, 2].map(() => {
      const m = new THREE.Mesh(plumeGeo, glowMat(new THREE.Color('#dfe8ff'), 0.7));
      this.body.add(m);
      return m;
    });

    // Heading: where it points (the ghost shows where it goes).
    const hg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1)]);
    this.heading = new THREE.Line(hg, new THREE.LineBasicMaterial({ color: this.color.clone().lerp(new THREE.Color('#ffffff'), 0.6), transparent: true, opacity: 0.8 }));
    this.body.add(this.heading);

    // Spin ring around the true spin axis, turning at the true rate.
    const ringPts = [];
    const dashes = 12;
    for (let k = 0; k < dashes; k++) {
      const a0 = (k / dashes) * Math.PI * 2, a1 = a0 + (Math.PI * 2) / dashes * 0.55;
      for (let j = 0; j < 4; j++) {
        const u0 = a0 + ((a1 - a0) * j) / 4, u1 = a0 + ((a1 - a0) * (j + 1)) / 4;
        ringPts.push(Math.cos(u0), Math.sin(u0), 0, Math.cos(u1), Math.sin(u1), 0);
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(ringPts, 3));
    this.spinRing = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: this.color, transparent: true, opacity: 0.8 }));
    this.spinAngle = 0;
    this.root.add(this.spinRing);

    // Trail, ghost, orbit.
    this.trailN = 360;
    this.trailPts = [];
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.trailN * 3), 3));
    tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.trailN * 3), 3));
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.trail.frustumCulled = false;
    scene.add(this.trail);
    this.ghost = makeGhost(this.color, 0.55);
    scene.add(this.ghost);
    const og = new THREE.BufferGeometry();
    og.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ORBIT_N * 3), 3));
    this.orbit = new THREE.Line(og, new THREE.LineBasicMaterial({ color: this.color, transparent: true, opacity: 0.28, depthWrite: false }));
    this.orbit.frustumCulled = false;
    scene.add(this.orbit);

    this.label = document.createElement('div');
    this.label.className = `label t${i}`;
    document.getElementById('labels').appendChild(this.label);
  }

  update(s, showGhost, showTrail) {
    const pos = v3(s.p);
    const vel = v3(s.v);
    const dt = this._dt || 0.016;
    this.root.visible = s.alive;
    this.root.position.copy(pos);
    this.body.quaternion.set(s.q[0], s.q[1], s.q[2], s.q[3]);
    const r = s.r;
    this.body.scale.setScalar(r * 1.25);
    const k = 1 / (r * 1.25); // body-local units per metre

    // Damage: the hull darkens and flickers as it fails.
    const hullFrac = Math.max(0, s.hull / s.hull_max);
    const heat = Math.min(1, ((s.heating || 0) + (s.zone_burn || 0)) / 25);
    this.hullMat.emissive.copy(this.color).lerp(new THREE.Color('#ff3b1a'), Math.max(heat, hullFrac < 0.3 ? 0.6 : 0));
    this.hullMat.emissiveIntensity = 0.12 + 2.2 * heat * (0.8 + 0.2 * Math.random()) + (hullFrac < 0.3 && Math.random() < 0.15 ? 0.8 : 0);

    // Loaded: a glow at the muzzle and the predicted path of a shot fired now.
    this.loadedGlow.visible = s.alive && s.ready;
    this.loadedGlow.scale.setScalar(0.16 * (1 + 0.1 * Math.sin(performance.now() / 180)));
    this.loadedGlow.position.set(0, 0.28, 1.1);
    const q = new THREE.Quaternion(s.q[0], s.q[1], s.q[2], s.q[3]);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const muzzle = pos.clone().addScaledVector(fwd, r + 1);
    updateGhost(this.sight, muzzle, vel.clone().addScaledVector(fwd, s.muzzle || 100), 12.0, showGhost && s.alive && s.ready);

    const th = s.thrust;
    const flick = 0.85 + Math.random() * 0.3;
    for (const [m, w, l] of [[this.plume, 0.55, 3.2], [this.plumeCore, 0.25, 1.8]]) {
      m.visible = th > 0.02;
      m.scale.set(w, w, (0.3 + l * th) * flick);
      m.position.set(0, 0, -0.75);
    }
    // Strafing thrusters fire opposite to the push.
    const st = s.strafe || [0, 0, 0];
    const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    this.puffs.forEach((m, j) => {
      const a = st[j];
      m.visible = Math.abs(a) > 0.05;
      if (!m.visible) return;
      const dir = axes[j].clone().multiplyScalar(-Math.sign(a));
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
      m.position.copy(dir.clone().multiplyScalar(0.5));
      m.scale.set(0.18, 0.18, (0.3 + 0.9 * Math.abs(a)) * flick);
    });

    this.heading.scale.set(1, 1, Math.max(40, r * 9) * k);

    const w = v3(s.w || [0, 0, 0]);
    const rate = w.length();
    this.spinRing.visible = s.alive && rate > 0.15;
    if (this.spinRing.visible) {
      this.spinAngle += Math.min(rate, 8) * dt;
      const qa = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), w.clone().normalize());
      const qs = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.spinAngle);
      this.spinRing.quaternion.copy(qa.multiply(qs));
      this.spinRing.scale.setScalar(r * 2.2);
      this.spinRing.material.opacity = Math.min(0.9, 0.25 + rate / 2);
    }

    // Trail.
    if (s.alive) {
      this.trailPts.push(pos.clone());
      if (this.trailPts.length > this.trailN) this.trailPts.shift();
    }
    this.trail.visible = showTrail;
    const tp = this.trail.geometry.attributes.position, tc = this.trail.geometry.attributes.color;
    const n = this.trailPts.length;
    for (let j = 0; j < this.trailN; j++) {
      const p = this.trailPts[Math.max(0, n - this.trailN + j)] || pos;
      tp.setXYZ(j, p.x, p.y, p.z);
      const a = n ? Math.max(0, (j - (this.trailN - n)) / this.trailN) ** 1.6 : 0;
      tc.setXYZ(j, this.color.r * a, this.color.g * a, this.color.b * a);
    }
    tp.needsUpdate = tc.needsUpdate = true;

    updateGhost(this.ghost, pos, vel, 3.0, showGhost && s.alive);
    const ring = wallRings[this.i];
    const planet = hazards.find((hz) => hz.k === 'planet');
    if (planet) {
      const cross = updateOrbit(this.orbit, pos, vel, planet, s.alive);
      if (s.alive && cross && cross.t < 12) {
        ring.position.copy(cross.p);
        ring.lookAt(planet.P);
        ring.scale.setScalar(14 + vel.length() * 0.4);
        ring.material.opacity = 0.9 * (1 - cross.t / 12);
      } else ring.material.opacity = 0;
    } else {
      this.orbit.visible = false;
      ring.material.opacity = 0;
    }

    const speed = vel.length();
    const warn = s.zone_burn > 0 ? ' · <span class="hot">OUT OF ZONE</span>' : (s.heating > 1 ? ' · <span class="hot">HEATING</span>' : '');
    this.labelHTML = `${s.name.toUpperCase()}<div class="sub">${Math.round(s.hull)} hull · ${speed.toFixed(0)} m/s · ${s.ammo} rds${warn}</div>`;
    this.pos = pos;
    this.alive = s.alive;
  }

  dispose() {
    scene.remove(this.root, this.trail, this.ghost, this.orbit, this.sight);
    this.label.remove();
  }
}

const GHOST_N = 40;
function makeGhost(color, opacity) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(GHOST_N * 3), 3));
  const l = new THREE.Line(g, new THREE.LineDashedMaterial({ color, dashSize: 4, gapSize: 4, transparent: true, opacity }));
  l.frustumCulled = false;
  // One tick per second of predicted flight.
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 3), 3));
  const ticks = new THREE.Points(tg, new THREE.PointsMaterial({ map: DOT, color, size: 9, sizeAttenuation: false, transparent: true, opacity: Math.min(1, opacity + 0.3), depthWrite: false }));
  ticks.frustumCulled = false;
  l.add(ticks);
  l.userData.ticks = ticks;
  return l;
}
// Ballistic prediction through the hazard fields: where it goes if nobody acts.
const _acc = new THREE.Vector3();
function updateGhost(line, pos, vel, T, visible) {
  line.visible = visible && vel.lengthSq() > 1;
  if (!line.visible) return;
  const p = line.geometry.attributes.position;
  const x = pos.clone(), v = vel.clone();
  const steps = 4, h = T / (GHOST_N - 1) / steps;
  let stopped = false;
  p.setXYZ(0, x.x, x.y, x.z);
  for (let k = 1; k < GHOST_N; k++) {
    if (!stopped) {
      for (let s = 0; s < steps; s++) {
        v.addScaledVector(hazardAccel(x, v, _acc), h);
        x.addScaledVector(v, h);
      }
      if (x.length() > arenaRadius) { x.setLength(arenaRadius); stopped = true; }
      for (const hz of hazards) if ((hz.k === 'well' || hz.k === 'planet') && x.distanceTo(hz.P) < hz.core) { stopped = true; }
    }
    p.setXYZ(k, x.x, x.y, x.z);
  }
  p.needsUpdate = true;
  line.computeLineDistances();
  const tk = line.userData.ticks;
  if (tk) {
    const tp = tk.geometry.attributes.position;
    const n = Math.floor(T);
    for (let k = 0; k < 3; k++) {
      const idx = Math.min(GHOST_N - 1, Math.round(((k + 1) / T) * (GHOST_N - 1)));
      const src = k < n ? idx : GHOST_N - 1;
      tp.setXYZ(k, p.getX(src), p.getY(src), p.getZ(src));
    }
    tp.needsUpdate = true;
    tk.geometry.setDrawRange(0, Math.min(3, n));
  }
}
const ORBIT_N = 240;
// Integrate the planet-only two-body path for up to one orbit (or 90 s). Returns where it
// first leaves the safe zone, if it does.
function updateOrbit(line, pos, vel, planet, visible) {
  line.visible = visible;
  if (!visible) return null;
  const gm = planet.gm;
  const r0 = pos.distanceTo(planet.P);
  const energy = vel.lengthSq() / 2 - gm / r0;
  const period = energy < 0 ? 2 * Math.PI * Math.sqrt((-gm / (2 * energy)) ** 3 / gm) : 90;
  const T = Math.min(90, period * 1.02);
  const p = line.geometry.attributes.position;
  const x = pos.clone().sub(planet.P), v = vel.clone();
  const sub = 6, h = T / (ORBIT_N - 1) / sub;
  let cross = null, dead = false;
  const a = new THREE.Vector3();
  p.setXYZ(0, pos.x, pos.y, pos.z);
  for (let k = 1; k < ORBIT_N; k++) {
    if (!dead) {
      for (let j = 0; j < sub; j++) {
        const r2 = x.lengthSq();
        a.copy(x).multiplyScalar(-gm / (r2 * Math.sqrt(r2)));
        v.addScaledVector(a, h);
        x.addScaledVector(v, h);
      }
      const r = x.length();
      if (!cross && r > safeRadius && r0 <= safeRadius) cross = { p: x.clone().add(planet.P), t: (k * T) / (ORBIT_N - 1) };
      if (r < planet.core || r > safeRadius + 700) dead = true;
    }
    p.setXYZ(k, x.x + planet.P.x, x.y + planet.P.y, x.z + planet.P.z);
  }
  p.needsUpdate = true;
  return cross;
}
function timeToSphere(p, v, R) {
  const a = v.lengthSq(), b = 2 * p.dot(v), c = p.lengthSq() - R * R;
  if (a < 1e-6) return Infinity;
  if (c >= 0) return 0;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}


// ---------- hazards ----------
// Mirror of sim Hazard::accel so ghost trajectories bend exactly like the real thing.
let hazards = [];
function hazardAccel(p, v, out) {
  out.set(0, 0, 0);
  for (const h of hazards) {
    if (h.k === 'well' || h.k === 'planet') {
      const d = h.P.clone().sub(p);
      const r2 = Math.max(d.lengthSq(), h.core * h.core);
      out.addScaledVector(d.normalize(), h.gm / r2);
    } else if (h.k === 'nebula') {
      const q = p.distanceToSquared(h.P) / (h.r * h.r);
      if (q < 1) out.addScaledVector(v, -v.length() * h.drag * (1 - q));
    } else if (h.k === 'stream') {
      const ab = h.B.clone().sub(h.A);
      const t = p.clone().sub(h.A).dot(ab) / ab.lengthSq();
      if (t > 0 && t < 1) {
        const d = h.A.clone().addScaledVector(ab, t).distanceTo(p);
        if (d < h.r) out.addScaledVector(ab.normalize(), h.accel * (1 - (d / h.r) ** 2));
      }
    }
  }
  return out;
}
const hazardGroup = new THREE.Group();
scene.add(hazardGroup);
let hazardKey = '';
let streamParticles = [];
function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const DOT = dotTexture();
function planetTexture(seed) {
  const W = 1024, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const sea = g.createLinearGradient(0, 0, 0, H);
  sea.addColorStop(0, '#1d3957'); sea.addColorStop(0.5, '#24507a'); sea.addColorStop(1, '#1d3957');
  g.fillStyle = sea; g.fillRect(0, 0, W, H);
  const land = ['#4c6b3c', '#6b6a44', '#7d6446', '#57704a'];
  for (let k = 0; k < 14; k++) {
    const cx = rnd() * W, cy = H * (0.2 + rnd() * 0.6), rad = 30 + rnd() * 90;
    g.fillStyle = land[k % land.length];
    for (let j = 0; j < 60; j++) {
      const a = rnd() * Math.PI * 2, d = rnd() * rad;
      g.beginPath();
      g.ellipse((cx + Math.cos(a) * d * 1.8 + W) % W, cy + Math.sin(a) * d, 6 + rnd() * 26, 4 + rnd() * 16, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.fillStyle = 'rgba(240,245,255,0.9)';
  g.fillRect(0, 0, W, H * 0.06); g.fillRect(0, H * 0.94, W, H * 0.06);
  g.fillStyle = 'rgba(255,255,255,0.1)';
  for (let k = 0; k < 90; k++) { g.beginPath(); g.ellipse(rnd() * W, rnd() * H, 20 + rnd() * 70, 3 + rnd() * 6, 0, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function buildHazards(list) {
  hazardGroup.clear();
  streamParticles = [];
  hazards = list.map((h) => ({ ...h, P: h.p && v3(h.p), A: h.a && v3(h.a), B: h.b && v3(h.b) }));
  for (const h of hazards) {
    if (h.k === 'planet') {
      const m = new THREE.Mesh(new THREE.SphereGeometry(h.core, 96, 64), new THREE.MeshStandardMaterial({ map: planetTexture(hazardKey.length), roughness: 0.9, metalness: 0 }));
      m.position.copy(h.P);
      m.rotation.z = 0.35;
      m.userData.spinY = 0.01;
      const atmo = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: '#6fb6ff', transparent: true, opacity: 0.035, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      atmo.scale.setScalar(h.core + (atmoHeight || 45));
      atmo.position.copy(h.P);
      hazardGroup.add(m, atmo);
      continue;
    }
    if (h.k === 'well') {
      // Black core with a hot rim, an accretion disc, and a shell where gravity = 3 m/s^2.
      const core = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: '#000000' }));
      core.scale.setScalar(h.core);
      core.position.copy(h.P);
      const rim = new THREE.Mesh(sphereGeo, glowMat(new THREE.Color('#b26bff'), 0.07));
      rim.material.side = THREE.BackSide;
      rim.scale.setScalar(h.core * 1.25);
      rim.position.copy(h.P);
      const disc = new THREE.Mesh(new THREE.RingGeometry(h.core * 1.3, h.core * 1.9, 96), new THREE.MeshBasicMaterial({
        color: '#d49bff', transparent: true, opacity: 0.06, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      disc.position.copy(h.P);
      disc.rotation.x = Math.PI / 2 + 0.3;
      disc.userData.spin = 0.25;
      const reach = Math.sqrt(h.gm / 3);
      const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({
        color: '#7a4dff', wireframe: true, transparent: true, opacity: 0.07, depthWrite: false,
      }));
      shell.scale.setScalar(reach);
      shell.position.copy(h.P);
      hazardGroup.add(core, rim, disc, shell);
    } else if (h.k === 'nebula') {
      // Dust: soft particles, denser toward the centre.
      const n = Math.floor(h.r * 3);
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar(h.r * Math.sqrt(Math.random()) * 0.95).add(h.P);
        pos.set([v.x, v.y, v.z], i * 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({
        map: DOT, color: '#3fb8a8', size: 38, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      const edge = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: '#3fb8a8', transparent: true, opacity: 0.04, side: THREE.BackSide, depthWrite: false }));
      edge.scale.setScalar(h.r);
      edge.position.copy(h.P);
      hazardGroup.add(pts, edge);
    } else if (h.k === 'stream') {
      const ab = h.B.clone().sub(h.A);
      const len = ab.length();
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(h.r, h.r, len, 24, 1, true), new THREE.MeshBasicMaterial({
        color: '#4d9dff', transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      tube.position.copy(h.A.clone().add(h.B).multiplyScalar(0.5));
      tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ab.clone().normalize());
      const n = Math.floor(len / 3);
      const pos = new Float32Array(n * 3);
      const seeds = [];
      for (let i = 0; i < n; i++) seeds.push({ t: Math.random(), off: new THREE.Vector3().randomDirection().multiplyScalar(h.r * Math.sqrt(Math.random()) * 0.9) });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({
        map: DOT, color: '#8fc6ff', size: 7, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      pts.frustumCulled = false;
      // Remove the along-axis component of each offset so particles sit in cross-section.
      const dir = ab.clone().normalize();
      for (const s of seeds) s.off.addScaledVector(dir, -s.off.dot(dir));
      streamParticles.push({ pts, seeds, h, len });
      hazardGroup.add(tube, pts);
    }
  }
}
function updateHazards(dt) {
  for (const c of hazardGroup.children) {
    if (c.userData.spin) c.rotation.z += c.userData.spin * dt;
    if (c.userData.spinY) c.rotation.y += c.userData.spinY * dt;
  }
  for (const sp of streamParticles) {
    const p = sp.pts.geometry.attributes.position;
    const speed = (sp.h.accel * 2.5) / sp.len;
    sp.seeds.forEach((s, i) => {
      s.t = (s.t + speed * dt) % 1;
      const v = sp.h.A.clone().lerp(sp.h.B, s.t).add(s.off);
      p.setXYZ(i, v.x, v.y, v.z);
    });
    p.needsUpdate = true;
  }
}

// ---------- loose bodies: asteroids and mass-driver slugs ----------
const bodyViews = new Map(); // asteroid id -> mesh
const MAX_TRACERS = 1200;
const tracerGeo = new THREE.BufferGeometry();
tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_TRACERS * 6), 3));
tracerGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_TRACERS * 6), 3));
const tracers = new THREE.LineSegments(tracerGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
tracers.frustumCulled = false;
scene.add(tracers);
const slugViews = new Map(); // rail slug id -> {streak, glow, ghost}
const SLUG_COLOR = new THREE.Color('#f2f6ff');

function syncBodies(bodies, showGhost, dt) {
  const seen = new Set();
  const tp = tracerGeo.attributes.position, tc = tracerGeo.attributes.color;
  let nt = 0;
  for (const b of bodies) {
    if (b.k === 'asteroid') {
      seen.add(b.id);
      let m = bodyViews.get(b.id);
      if (!m) {
        m = new THREE.Mesh(rockGeo(2, 0.35, b.id * 104729 + 1), rockMat);
        m.userData.spin = new THREE.Vector3().randomDirection().multiplyScalar(0.05 + Math.random() * 0.1);
        scene.add(m);
        bodyViews.set(b.id, m);
      }
      m.position.set(b.p[0], b.p[1], b.p[2]);
      m.scale.setScalar(b.r);
      const sp = m.userData.spin;
      m.rotation.x += sp.x * dt; m.rotation.y += sp.y * dt; m.rotation.z += sp.z * dt;
    } else if (b.k === 'slug') {
      seen.add(b.id);
      let v = slugViews.get(b.id);
      if (!v) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
        const streak = new THREE.Line(g, new THREE.LineBasicMaterial({ color: SLUG_COLOR.clone().lerp(TEAM[b.o], 0.25).multiplyScalar(2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        streak.frustumCulled = false;
        const glow = new THREE.Mesh(sphereGeo, glowMat(SLUG_COLOR.clone().multiplyScalar(2)));
        const ghost = makeGhost(TEAM[b.o], 0.7);
        scene.add(streak, glow, ghost);
        v = { streak, glow, ghost };
        slugViews.set(b.id, v);
      }
      const p = v3(b.p), vel = v3(b.v);
      const sp = v.streak.geometry.attributes.position;
      const tail = p.clone().addScaledVector(vel, -0.25);
      sp.setXYZ(0, tail.x, tail.y, tail.z);
      sp.setXYZ(1, p.x, p.y, p.z);
      sp.needsUpdate = true;
      v.glow.position.copy(p);
      v.glow.scale.setScalar(2.2);
      // Orbital bullets: show where the slug is going, curving round the planet.
      updateGhost(v.ghost, p, vel, 15.0, showGhost);
    }
  }
  tracerGeo.setDrawRange(0, nt * 2);
  tp.needsUpdate = tc.needsUpdate = true;
  for (const [id, m] of bodyViews) if (!seen.has(id)) { scene.remove(m); bodyViews.delete(id); }
  for (const [id, v] of slugViews) if (!seen.has(id)) { scene.remove(v.streak, v.glow, v.ghost); slugViews.delete(id); }
}
function clearBodies() {
  for (const [, m] of bodyViews) scene.remove(m);
  bodyViews.clear();
  for (const [, v] of slugViews) scene.remove(v.streak, v.glow, v.ghost);
  slugViews.clear();
  tracerGeo.setDrawRange(0, 0);
}

// ---------- effects ----------
const fx = [];
const ringGeo = new THREE.RingGeometry(0.85, 1, 48);
function flash(pos, color, size, life = 0.5) {
  const m = new THREE.Mesh(sphereGeo, glowMat(new THREE.Color(color)));
  m.position.copy(pos);
  scene.add(m);
  fx.push({ m, t: 0, life, size, kind: 'flash' });
  const r = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  r.position.copy(pos);
  r.lookAt(camera.position);
  scene.add(r);
  fx.push({ m: r, t: 0, life: life * 1.6, size: size * 3, kind: 'ring' });
}
function updateFx(dt) {
  for (let k = fx.length - 1; k >= 0; k--) {
    const f = fx[k];
    f.t += dt;
    const u = f.t / f.life;
    if (u >= 1) { scene.remove(f.m); fx.splice(k, 1); continue; }
    if (f.kind === 'flash') { f.m.scale.setScalar(f.size * (0.4 + u)); f.m.material.opacity = (1 - u) ** 2; }
    else { f.m.scale.setScalar(f.size * (0.2 + u)); f.m.material.opacity = 0.8 * (1 - u); }
  }
}
let shake = 0;

// ---------- HUD ----------
const $ = (id) => document.getElementById(id);
const feed = $('feed');
function feedLine(html, cls) {
  const d = document.createElement('div');
  d.className = cls || '';
  d.innerHTML = html;
  feed.prepend(d);
  while (feed.children.length > 9) feed.lastChild.remove();
}
const nameOf = (i) => `<b style="color:${TEAM_CSS[i]}">${state?.ships[i]?.name.toUpperCase() ?? '?'}</b>`;

function attitude(i) {
  const s = state.ships[i], o = state.ships[1 - i];
  const q = new THREE.Quaternion(s.q[0], s.q[1], s.q[2], s.q[3]);
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const deg = (a, b) => (a.lengthSq() < 1e-6 || b.lengthSq() < 1e-6 ? 0 : THREE.MathUtils.radToDeg(a.angleTo(b)));
  const toFoe = o ? v3(o.p).sub(v3(s.p)) : new THREE.Vector3();
  const vel = v3(s.v);
  return {
    aim: deg(fwd, toFoe).toFixed(0),
    drift: vel.length() > 2 ? deg(fwd, vel).toFixed(0) : '–',
    spin: THREE.MathUtils.radToDeg(Math.hypot(...(s.w || [0, 0, 0]))).toFixed(0),
  };
}
// Altitude bar: planet surface -> safe edge -> amber -> red, with the ship's position and
// its orbit's low and high points.
function altitudeGauge(i, s) {
  const planet = hazards.find((h) => h.k === 'planet');
  if (!planet || state.safe == null) return '';
  const lo = planet.core, hi = state.safe_base + 3 * state.zone_width;
  const f = (r) => THREE.MathUtils.clamp(((r - lo) / (hi - lo)) * 100, 0, 100);
  const rv = v3(s.p).sub(planet.P), v = v3(s.v);
  const r = rv.length();
  const gm = planet.gm, E = v.lengthSq() / 2 - gm / r, h = rv.clone().cross(v).length();
  const e = Math.sqrt(Math.max(0, 1 + (2 * E * h * h) / (gm * gm)));
  const rp = (h * h) / (gm * (1 + e));
  const ra = E < 0 ? -gm / (2 * E) * (1 + e) : Infinity;
  const safe = f(state.safe), amber = f(state.safe + state.zone_width), red = f(state.safe + 2 * state.zone_width);
  const side = i === 0 ? 'left' : 'right';
  const span = `${side}:${f(rp)}%;width:${Math.max(0.5, f(Math.min(ra, hi)) - f(rp))}%`;
  const danger = rp < lo + 30 ? ' low' : ra > state.safe ? ' high' : '';
  return `<div class="alt${danger}" title="altitude: planet → safe zone → burn zones">
    <div class="z safe" style="${side}:0;width:${safe}%"></div>
    <div class="z amber" style="${side}:${safe}%;width:${amber - safe}%"></div>
    <div class="z red" style="${side}:${amber}%;width:${red - amber}%"></div>
    <div class="z black" style="${side}:${red}%;width:${100 - red}%"></div>
    <div class="orbit" style="${span}"></div>
    <div class="me" style="${side}:${f(r)}%"></div>
  </div>`;
}
function pips(n, max, cls) {
  const shown = Math.min(max, 16);
  const on = Math.round((n / max) * shown);
  return `<span class="pips ${cls}">${Array.from({ length: shown }, (_, k) => `<i class="${k < on ? 'on' : ''}"></i>`).join('')}</span>`;
}
function renderTeam(i, s) {
  const el = $(`team${i}`);
  const hull = Math.max(0, s.hull / s.hull_max) * 100;
  const fuel = Math.max(0, s.fuel / s.fuel_max) * 100;
  const gun = s.ready ? '<b>LOADED</b>' : s.ammo > 0 ? `reloading <span class="mini"><i style="width:${(1 - s.reload) * 100}%"></i></span>` : '<b class="hot">EMPTY</b>';
  const att = attitude(i);
  el.innerHTML = `
    <div><span class="name">${s.name}</span><span class="mode">${s.alive ? s.mode : 'destroyed'}</span></div>
    <div class="bar" title="hull"><div class="fill" style="width:${hull}%"></div></div>
    <div class="bar thin fuel" title="propellant"><div class="fill" style="width:${fuel}%"></div></div>
    ${altitudeGauge(i, s)}
    <div class="meters">
      <span><b>${Math.round(s.hull)}</b> hull</span>
      <span><b>${Math.round(fuel)}%</b> fuel</span>
      <span><b>${Math.hypot(...s.v).toFixed(0)}</b> m/s</span>
      <span title="mass-driver rounds">${pips(s.ammo, s.ammo_max, 'rail')} ${gun}</span>
      <span title="nose vs. direction to enemy">aim <b>${att.aim}°</b></span>
      <span title="nose vs. direction of travel">drift <b>${att.drift}°</b></span>
      <span title="rotation rate">spin <b>${att.spin}°/s</b></span>
    </div>`;
}

const spark = $('spark').getContext('2d');
let history = [];
function drawSpark() {
  const w = 260, h = 56;
  spark.clearRect(0, 0, w, h);
  spark.strokeStyle = 'rgba(160,180,220,0.25)';
  spark.beginPath(); spark.moveTo(0, h / 2); spark.lineTo(w, h / 2); spark.stroke();
  if (history.length < 2) return;
  const T = Math.max(60, history[history.length - 1].t);
  const pts = history.map((p) => [(p.t / T) * w, h / 2 - p.d * (h / 2 - 3)]);
  for (const [i, sign] of [[0, 1], [1, -1]]) {
    spark.save();
    spark.beginPath();
    spark.rect(0, sign > 0 ? 0 : h / 2, w, h / 2);
    spark.clip();
    spark.fillStyle = TEAM_CSS[i] + '55';
    spark.strokeStyle = TEAM_CSS[i];
    spark.beginPath();
    spark.moveTo(pts[0][0], h / 2);
    for (const p of pts) spark.lineTo(p[0], p[1]);
    spark.lineTo(pts[pts.length - 1][0], h / 2);
    spark.closePath();
    spark.fill();
    spark.beginPath();
    pts.forEach((p, k) => (k ? spark.lineTo(p[0], p[1]) : spark.moveTo(p[0], p[1])));
    spark.stroke();
    spark.restore();
  }
}

// ---------- events → effects + feed ----------
function handleEvent(e) {
  switch (e.type) {
    case 'reset':
      history = [];
      feed.innerHTML = '';
      for (const sv of shipViews) sv.trailPts = [];
      $('banner').hidden = true;
      break;
    case 'fire':
      flash(v3(e.p), '#f4f8ff', 5, 0.35);
      shake = Math.max(shake, 0.5);
      feedLine(`${nameOf(e.ship)} fires`, `c${e.ship}`);
      break;
    case 'impact':
      flash(v3(e.p), '#f4f8ff', 6, 0.35);
      break;
    case 'hit': {
      const p = v3(e.p);
      const who = nameOf(e.victim);
      flash(p, e.cause === 'slug' ? '#ffffff' : '#ff8a6a', 3 + Math.sqrt(e.damage) * 1.2, 0.7);
      shake = Math.max(shake, Math.min(2.5, e.damage / 120));
      const txt = {
        slug: e.attacker === e.victim ? `${who} is hit by its own round` : `${nameOf(e.attacker)} <b>HITS</b> ${who}`,
        ram: `${nameOf(e.attacker)} rams ${who}`,
        asteroid: `${who} slams a rock`,
        planet: `${who} hits the planet`,
        wall: `${who} hits the arena wall`,
      }[e.cause] || `${who} takes damage`;
      feedLine(`${txt} <b>−${Math.round(e.damage)}</b>`, `c${e.victim} big`);
      break;
    }
    case 'kill': {
      flash(v3(e.p), '#ffffff', 30, 1.4);
      shake = 3;
      const how = { slug: 'a mass-driver round', ram: 'a ram', planet: 'the planet', atmosphere: 'atmospheric heating', zone: 'the burn zone', asteroid: 'a rock', wall: 'the wall' }[e.cause] || e.cause;
      feedLine(`${nameOf(e.victim)} DESTROYED by ${e.attacker != null && e.attacker !== e.victim ? nameOf(e.attacker) + "'s " : ''}${how}`, 'kill');
      break;
    }
    case 'end': {
      const b = $('banner');
      b.hidden = false;
      const how = e.decision ? 'on hull at the bell' : 'by destruction';
      const next = replay ? 'replay finished' : 'next match shortly';
      b.innerHTML = e.winner == null ? `Stalemate<small>no kill by the bell</small>` : `<span style="color:${TEAM_CSS[e.winner]}">${state.ships[e.winner].name} wins</span><small>${how} · ${next}</small>`;
      break;
    }
  }
}

// ---------- camera ----------
// Stable by design: world-up is always up, the view direction is held fixed, and it only
// drifts (slowly) when the ships line up in depth or something blocks the shot.
let camMode = 'director';
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3(0, 300, 900);
const camDir = new THREE.Vector3(0.35, 0.3, 1).normalize(); // target -> camera
let camDist = 600;
let followDir = null;
function segmentBlocked(a, b, c, r) {
  const ab = b.clone().sub(a);
  const t = THREE.MathUtils.clamp(c.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
  return a.clone().addScaledVector(ab, t).distanceTo(c) < r;
}
function occluded(from, views) {
  const blockers = [];
  for (const h of hazards) if (h.k === 'well') blockers.push([h.P, h.core * 1.4]);
  for (const h of hazards) if (h.k === 'planet') blockers.push([h.P, h.core * 1.02]);
  for (const b of state?.bodies ?? []) if (b.k === 'asteroid') blockers.push([v3(b.p), b.r]);
  return views.some((sv) => blockers.some(([c, r]) => segmentBlocked(from, sv.pos, c, r)));
}
const ease = (rate, dt) => 1 - Math.exp(-rate * dt);
// Distance at which a sphere of radius `r` fits comfortably in frame.
function fitDistance(r) {
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  return r / Math.tan(Math.min(vfov, hfov) / 2 * 0.75);
}
function keepLevel(dir, maxY) {
  if (Math.abs(dir.y) > maxY) { dir.y = Math.sign(dir.y) * maxY; dir.normalize(); }
}
function updateCamera(dt) {
  controls.enabled = camMode === 'free';
  if (camMode === 'free') { controls.update(); return; }
  const alive = shipViews.filter((s) => s.alive && s.pos);
  const views = alive.length ? alive : shipViews.filter((s) => s.pos);
  if (!views.length) return;
  camera.up.copy(WORLD_UP);

  if (camMode === 'director') {
    const mid = new THREE.Vector3();
    views.forEach((s) => mid.add(s.pos));
    mid.divideScalar(views.length);
    const sep = views.length > 1 ? views[0].pos.distanceTo(views[1].pos) : 0;
    if (views.length > 1) {
      // Ships stacked in depth are unreadable: ease the view toward side-on, gently.
      const axis = views[1].pos.clone().sub(views[0].pos).normalize();
      const d = camDir.dot(axis);
      if (Math.abs(d) > 0.55) camDir.addScaledVector(axis, -d * ease(0.5, dt)).normalize();
    }
    const planet = hazards.find((h) => h.k === 'planet');
    if (planet) {
      // Stay on the outside of the fight: ships in front, planet as the backdrop. This
      // glides round with the orbit instead of ever looking through the planet.
      const out = mid.clone().sub(planet.P).normalize();
      const want = out.clone().multiplyScalar(0.75).add(camDir.clone().multiplyScalar(0.25)).normalize();
      camDir.lerp(want, ease(0.8, dt)).normalize();
    } else {
      if (occluded(camPos, views)) camDir.applyAxisAngle(WORLD_UP, 0.35 * dt).normalize();
      keepLevel(camDir, 0.6);
    }
    const want = Math.max(60, fitDistance(sep / 2 + 25));
    camDist += (want - camDist) * ease(want > camDist ? 1.5 : 0.8, dt); // out fast, in slower
    camTarget.lerp(mid, ease(2.0, dt));
    camPos.copy(camTarget).addScaledVector(camDir, camDist);
  } else if (camMode === 'follow0' || camMode === 'follow1') {
    // Over the shoulder of one ship, looking toward its opponent. Direction is heavily
    // smoothed so it never whips around.
    const i = camMode === 'follow0' ? 0 : 1;
    const me = shipViews[i], foe = shipViews[1 - i];
    if (!me?.pos) return;
    const toFoe = foe?.pos && foe.alive ? foe.pos.clone().sub(me.pos) : new THREE.Vector3(0, 0, 1);
    const wantDir = toFoe.clone().normalize().negate().addScaledVector(WORLD_UP, 0.45).normalize();
    if (!followDir) followDir = wantDir.clone();
    followDir.lerp(wantDir, ease(0.6, dt)).normalize();
    keepLevel(followDir, 0.7);
    const s = state.ships[i];
    const dist = Math.max(45, s.r * 14);
    const look = me.pos.clone().addScaledVector(toFoe, Math.min(0.35, 150 / Math.max(1, toFoe.length())));
    camTarget.lerp(look, ease(4, dt));
    camPos.lerp(me.pos.clone().addScaledVector(followDir, dist), ease(4, dt));
  } else {
    // Pilot: behind the nose for body-relative controls, but kept level to world-up so the
    // horizon doesn't roll with the ship.
    const i = state?.control ?? 0;
    const s = state?.ships[i];
    const sv = shipViews[i];
    if (!s || !sv?.pos) return;
    const q = new THREE.Quaternion(s.q[0], s.q[1], s.q[2], s.q[3]);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const want = sv.pos.clone().addScaledVector(fwd, -s.r * 16).addScaledVector(WORLD_UP, s.r * 5);
    camPos.lerp(want, ease(5, dt));
    camTarget.lerp(sv.pos.clone().addScaledVector(fwd, 60), ease(6, dt));
  }
  camera.position.copy(camPos);
  if (shake > 0.01) camera.position.add(new THREE.Vector3().randomDirection().multiplyScalar(shake));
  shake *= Math.exp(-dt * 8);
  camera.lookAt(camTarget);
}

// ---------- labels ----------
const rangeLabel = document.createElement('div');
rangeLabel.className = 'label range';
$('labels').appendChild(rangeLabel);
const rangeLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
  new THREE.LineDashedMaterial({ color: '#5d6b88', dashSize: 3, gapSize: 5, transparent: true, opacity: 0.5 }));
rangeLine.frustumCulled = false;
scene.add(rangeLine);
function project(p) {
  const v = p.clone().project(camera);
  return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, vis: v.z < 1 };
}
function updateLabels() {
  for (const sv of shipViews) {
    if (!sv.pos) continue;
    const s = state.ships[sv.i];
    const pr = project(sv.pos.clone().add(camera.up.clone().multiplyScalar(s.r * 1.6)));
    sv.label.style.display = pr.vis && sv.alive ? '' : 'none';
    sv.label.style.left = `${pr.x}px`;
    sv.label.style.top = `${pr.y}px`;
    sv.label.innerHTML = sv.labelHTML;
  }
  // Keep the two name tags from stacking when ships are close on screen.
  const tags = shipViews.filter((sv) => sv.pos && sv.alive && sv.label.style.display !== 'none');
  if (tags.length === 2) {
    const [p, q] = tags.map((sv) => ({ sv, x: parseFloat(sv.label.style.left), y: parseFloat(sv.label.style.top) }));
    if (Math.abs(p.x - q.x) < 130 && Math.abs(p.y - q.y) < 34) {
      const [hi, lo] = p.y <= q.y ? [p, q] : [q, p];
      hi.sv.label.style.top = `${lo.y - 34}px`;
    }
  }
  const [a, b] = shipViews;
  if (a?.pos && b?.pos && a.alive && b.alive) {
    const sa = state.ships[0], sb = state.ships[1];
    const rel = b.pos.clone().sub(a.pos);
    const dist = rel.length();
    const closing = -v3(sb.v).sub(v3(sa.v)).dot(rel.clone().normalize());
    const mid = a.pos.clone().add(b.pos).multiplyScalar(0.5);
    const pr = project(mid);
    rangeLabel.style.display = pr.vis ? '' : 'none';
    rangeLabel.style.left = `${pr.x}px`;
    rangeLabel.style.top = `${pr.y}px`;
    const cls = closing > 40 ? 'color:#ff4d5e' : closing > 15 ? 'color:#ffd35a' : '';
    rangeLabel.innerHTML = `${dist.toFixed(0)} m · <span style="${cls}">${closing >= 0 ? 'closing' : 'opening'} ${Math.abs(closing).toFixed(0)} m/s</span>`;
    rangeLine.visible = true;
    const p = rangeLine.geometry.attributes.position;
    p.setXYZ(0, a.pos.x, a.pos.y, a.pos.z);
    p.setXYZ(1, b.pos.x, b.pos.y, b.pos.z);
    p.needsUpdate = true;
    rangeLine.computeLineDistances();
  } else {
    rangeLabel.style.display = 'none';
    rangeLine.visible = false;
  }
}

// ---------- live stream or recorded replay ----------
const params = new URLSearchParams(location.search);
const replayUrl = params.get('replay');
let replay = null;
let ws = null;
let state = null;
let shipViews = [];
let shipKey = '';
function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => { $('conn').hidden = true; };
  ws.onclose = () => { $('conn').hidden = false; $('conn').textContent = 'reconnecting…'; setTimeout(connect, 1000); };
  ws.onmessage = (m) => onState(JSON.parse(m.data));
}
const send = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));

function onState(s) {
  const key = s.ships.map((x) => x.id + x.name).join('|');
  if (key !== shipKey) {
    shipViews.forEach((v) => v.dispose());
    shipViews = s.ships.map((x, i) => new ShipView(i, x));
    shipKey = key;
    if (!replay) {
      $('selA').value = s.ships[0].name;
      $('selB').value = s.ships[1].name;
    }
  }
  if (s.hazards) {
    const hk = JSON.stringify(s.hazards);
    if (hk !== hazardKey) { hazardKey = hk; buildHazards(s.hazards); }
  }
  arenaRadius = s.arena;
  safeRadius = s.safe ?? Infinity;
  atmoHeight = s.atmo ?? 0;
  const planetMode = s.safe != null;
  zoneShells.forEach((z) => { z.visible = false; });
  safeFill.visible = planetMode;
  if (planetMode) safeFill.scale.setScalar(s.safe);
  const sd = planetMode && s.safe < s.safe_base - 1;
  zoneShells[0].material.color.set(sd ? '#ff3b4f' : '#7fa6d6');
  zoneShells[0].material.opacity = sd ? 0.3 + 0.15 * Math.sin(performance.now() / 200) : 0.08;
  zoneLimbs[0].material.color.set(sd ? '#ff3b4f' : '#8fb8ff');
  $('clock').classList.toggle('sd', sd);
  state = s;
  for (const e of s.events || []) handleEvent(e);
  if (!s.finished && (!history.length || s.t - history[history.length - 1].t >= 0.25)) {
    const f = (x) => Math.max(0, x.hull / x.hull_max);
    history.push({ t: s.t, d: Math.max(-1, Math.min(1, f(s.ships[0]) - f(s.ships[1]))) });
  }
  if (!replay) $('btnPause').textContent = s.paused ? 'Resume' : 'Pause';
}

// Replays are recorded at 15 fps; frames are interpolated so playback is smooth at any speed.
async function loadReplay(url) {
  $('conn').hidden = false;
  $('conn').textContent = 'loading replay…';
  const data = await (await fetch(url)).json();
  const frames = data.frames;
  replay = { frames, meta: data.meta, t: 0, playing: true, speed: 1, lastIdx: -1, dur: frames[frames.length - 1].t, hazards: frames[0].hazards };
  $('conn').hidden = true;
  document.body.classList.add('replay-mode');
  const info = data.meta.info;
  const labels = data.meta.labels || [];
  $('replayTitle').textContent = params.get('title') || `${labels[0]} vs ${labels[1]}`;
  const result = info.winner == null ? 'stalemate' : `${info.presets[info.winner]} (${labels[info.winner]}) wins${info.decision ? ' on hull' : ''}`;
  $('replayResult').textContent = `${info.presets[0]} vs ${info.presets[1]} · ${result} · excitement ${Math.round(info.excitement)}`;
  $('scrub').max = replay.dur;
}
function frameAt(t) {
  const f = replay.frames;
  let lo = 0, hi = f.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (f[mid].t <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}
const lerp3 = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
function replayState(t) {
  const f = replay.frames;
  const i = frameAt(t);
  const a = f[i], b = f[Math.min(i + 1, f.length - 1)];
  const u = b.t > a.t ? THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1) : 0;
  const bShips = new Map(b.ships.map((x) => [x.id, x]));
  const bBodies = new Map(b.bodies.map((x) => [x.id, x]));
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  const ships = a.ships.map((s) => {
    const n = bShips.get(s.id);
    if (!n) return s;
    qa.set(...s.q); qb.set(...n.q);
    qa.slerp(qb, u);
    return { ...s, p: lerp3(s.p, n.p, u), v: lerp3(s.v, n.v, u), q: [qa.x, qa.y, qa.z, qa.w] };
  });
  const bodies = a.bodies.map((x) => {
    const n = bBodies.get(x.id);
    return n ? { ...x, p: lerp3(x.p, n.p, u) } : x;
  });
  // Events fire as playback passes their frame; seeking skips them.
  let events = [];
  if (i > replay.lastIdx && i - replay.lastIdx < 40) for (let k = replay.lastIdx + 1; k <= i; k++) events = events.concat(f[k].events || []);
  if (i < replay.lastIdx) resetVisuals(t);
  replay.lastIdx = i;
  return { ...a, t: a.t + (b.t - a.t) * u, ships, bodies, hazards: replay.hazards, events };
}
function resetVisuals(t) {
  for (const sv of shipViews) sv.trailPts = [];
  history = history.filter((h) => h.t <= t);
  feed.innerHTML = '';
  $('banner').hidden = true;
}
function seek(t) {
  replay.t = THREE.MathUtils.clamp(t, 0, replay.dur);
  const i = frameAt(replay.t);
  if (Math.abs(i - replay.lastIdx) >= 40 || i < replay.lastIdx) {
    resetVisuals(replay.t);
    replay.lastIdx = i - 1;
    clearBodies();
  }
}

// ---------- input ----------
const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (replay) {
    if (k === ' ') { e.preventDefault(); togglePlay(); }
    if (k === 'arrowright') seek(replay.t + 5);
    if (k === 'arrowleft') seek(replay.t - 5);
  }
  if (k === 'c') { const opts = ['director', 'follow0', 'follow1', 'free']; camMode = opts[(opts.indexOf(camMode) + 1) % opts.length]; $('selCam').value = camMode; }
  if (k === 'h') $('help').hidden = !$('help').hidden;
  if (replay || e.repeat) return;
  if (k === 'n') newMatch();
  if (k === 'p') send({ type: 'pause' });
  if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
  keys.add(k);
  sendInput();
});
addEventListener('keyup', (e) => { keys.delete(e.key.toLowerCase()); sendInput(); });
addEventListener('blur', () => { keys.clear(); sendInput(); });
function axis(pos, neg) { return (keys.has(pos) ? 1 : 0) - (keys.has(neg) ? 1 : 0); }
function sendInput() {
  if (replay || state?.control == null) return;
  send({
    type: 'input',
    thrust: keys.has('shift') ? 1 : 0,
    pitch: axis('w', 's'),
    yaw: axis('a', 'd'),
    roll: axis('e', 'q'),
    strafe_x: axis('arrowleft', 'arrowright'),
    strafe_y: axis('arrowup', 'arrowdown'),
    strafe_z: axis('r', 'f'),
    fire: keys.has(' '),
  });
}
setInterval(sendInput, 100);

function newMatch() { send({ type: 'reset', a: $('selA').value, b: $('selB').value }); }
function togglePlay() {
  replay.playing = !replay.playing;
  if (replay.playing && replay.t >= replay.dur) seek(0);
  $('btnPlay').textContent = replay.playing ? 'Pause' : 'Play';
}
$('btnReset').onclick = newMatch;
$('selA').onchange = newMatch;
$('selB').onchange = newMatch;
$('btnPause').onclick = () => send({ type: 'pause' });
$('selSpeed').onchange = (e) => send({ type: 'speed', value: parseFloat(e.target.value) });
$('selCam').onchange = (e) => { camMode = e.target.value; e.target.blur(); };
$('selCtl').onchange = (e) => {
  const v = e.target.value;
  send({ type: 'control', ship: v === '' ? null : parseInt(v, 10) });
  camMode = v === '' ? 'director' : 'pilot';
  $('selCam').value = camMode;
  e.target.blur();
};
$('btnHelp').onclick = () => { $('help').hidden = !$('help').hidden; };
$('btnPlay').onclick = togglePlay;
$('scrub').oninput = (e) => seek(parseFloat(e.target.value));
$('replaySpeed').onchange = (e) => { replay.speed = parseFloat(e.target.value); e.target.blur(); };
$('selCam2').onchange = (e) => { camMode = e.target.value; $('selCam').value = camMode; e.target.blur(); };
for (const el of document.querySelectorAll('select, button')) el.addEventListener('keydown', (e) => e.key === ' ' && e.preventDefault());

// ---------- loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // Don't burn CPU/GPU rendering a tab nobody can see (training shares this machine).
  if (document.hidden) {
    requestAnimationFrame(frame);
    return;
  }
  if (replay) {
    if (replay.playing) {
      replay.t = Math.min(replay.dur, replay.t + dt * replay.speed);
      if (replay.t >= replay.dur) { replay.playing = false; $('btnPlay').textContent = 'Replay'; }
    }
    onState(replayState(replay.t));
    $('scrub').value = replay.t;
    const f = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
    $('replayTime').textContent = `${f(replay.t)} / ${f(replay.dur)}`;
  }
  if (state) {
    const g = $('chkGhost').checked, tr = $('chkTrail').checked;
    state.ships.forEach((s, i) => { if (shipViews[i]) { shipViews[i]._dt = dt; shipViews[i].update(s, g, tr); } });
    syncBodies(state.bodies, g, dt);
    state.ships.forEach((s, i) => renderTeam(i, s));
    const t = Math.max(0, state.t);
    $('clock').textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    drawSpark();
    updateCamera(dt);
    updateLabels();
  }
  updateFx(dt);
  updateHazards(dt);
  updateLimbs();
  composer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
if (replayUrl) loadReplay(replayUrl).catch((e) => { $('conn').textContent = 'could not load replay: ' + e.message; });
else connect();
