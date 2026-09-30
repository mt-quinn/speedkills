// Speed Kills viewer: renders the authoritative sim stream. Legibility first.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const WS_URL = `ws://${location.hostname || 'localhost'}:8081`;
const DENSITY = 1.91;
const TEAM = [new THREE.Color('#3cc8ff'), new THREE.Color('#ff6a3d')];
const TEAM_CSS = ['#3cc8ff', '#ff6a3d'];
const radiusFor = (m) => Math.cbrt((3 * Math.max(m, 0)) / (4 * Math.PI * DENSITY));
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

// ---------- renderer / scene ----------
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
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
const debrisGeos = [1, 2, 3, 4, 5].map((s) => rockGeo(0, 0.6, s * 7919));
const rockMat = new THREE.MeshStandardMaterial({ color: '#6b6560', roughness: 0.95, flatShading: true });
const debrisMat = new THREE.MeshStandardMaterial({ color: '#b5a48c', roughness: 0.8, flatShading: true, emissive: '#3a2a18', emissiveIntensity: 0.6 });

// ---------- ships ----------
class ShipView {
  constructor(i, s) {
    this.i = i;
    this.color = TEAM[i];
    this.root = new THREE.Group();
    scene.add(this.root);
    this.body = new THREE.Group();
    this.root.add(this.body);

    this.shell = new THREE.Mesh(sphereGeo, new THREE.MeshStandardMaterial({
      color: this.color, transparent: true, opacity: 0.32, roughness: 0.3, metalness: 0.2,
      emissive: this.color, emissiveIntensity: 0.08, depthWrite: false,
    }));
    this.body.add(this.shell);
    this.core = new THREE.Mesh(sphereGeo, glowMat(this.color.clone().multiplyScalar(0.9)));
    this.body.add(this.core);

    const cone = new THREE.ConeGeometry(0.45, 1.3, 16);
    cone.rotateX(Math.PI / 2);
    cone.translate(0, 0, 0.65);
    this.nose = new THREE.Mesh(cone, new THREE.MeshStandardMaterial({ color: '#e8eef8', emissive: this.color, emissiveIntensity: 0.5, roughness: 0.4 }));
    this.body.add(this.nose);

    this.arms = [];
    const armGeo = new THREE.BoxGeometry(1, 0.12, 0.12);
    armGeo.translate(0.5, 0, 0);
    for (let k = 0; k < 4; k++) {
      const a = new THREE.Group();
      a.rotation.z = (k * Math.PI) / 2;
      const rod = new THREE.Mesh(armGeo, new THREE.MeshStandardMaterial({ color: '#c9d3e6', roughness: 0.5 }));
      const tip = new THREE.Mesh(lowSphere, glowMat(this.color));
      a.add(rod, tip);
      a.userData = { rod, tip };
      this.body.add(a);
      this.arms.push(a);
    }

    const plumeGeo = new THREE.ConeGeometry(0.5, 1, 16, 1, true);
    plumeGeo.rotateX(-Math.PI / 2);
    plumeGeo.translate(0, 0, -0.5);
    this.plume = new THREE.Mesh(plumeGeo, glowMat(new THREE.Color('#ffc27a'), 0.9));
    this.body.add(this.plume);
    this.plumeCore = new THREE.Mesh(plumeGeo, glowMat(new THREE.Color('#ffffff'), 0.9));
    this.body.add(this.plumeCore);

    this.charge = new THREE.Mesh(sphereGeo, glowMat(new THREE.Color('#fff4c0')));
    this.body.add(this.charge);

    const fieldGeo = new THREE.ConeGeometry(1, 1, 32, 1, true);
    fieldGeo.rotateX(-Math.PI / 2);
    fieldGeo.translate(0, 0, 0.5);
    this.field = new THREE.Mesh(fieldGeo, new THREE.MeshBasicMaterial({
      color: '#6aa8ff', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.body.add(this.field);

    // Tether: a cylinder stretched between endpoints.
    const tGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    tGeo.translate(0, 0.5, 0);
    tGeo.rotateX(Math.PI / 2);
    this.tether = new THREE.Mesh(tGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9 }));
    this.tether.visible = false;
    scene.add(this.tether);
    this.harpoon = new THREE.Mesh(lowSphere, glowMat(new THREE.Color('#ffffff')));
    this.harpoon.visible = false;
    scene.add(this.harpoon);

    // Heading: a line straight out of the nose — where it's pointing (vs. the ghost: where
    // it's going). The gap between the two is the story of Newtonian flight.
    const hg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1)]);
    this.heading = new THREE.Line(hg, new THREE.LineBasicMaterial({ color: this.color.clone().lerp(new THREE.Color('#ffffff'), 0.6), transparent: true, opacity: 0.85 }));
    this.body.add(this.heading);

    // Spin ring: dashes around the true spin axis, turning at the true rate.
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

    // Trail & ghost.
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
    // Full predicted orbit around the planet (gravity only): the long-range story.
    const og = new THREE.BufferGeometry();
    og.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ORBIT_N * 3), 3));
    this.orbit = new THREE.Line(og, new THREE.LineBasicMaterial({ color: this.color, transparent: true, opacity: 0.28, depthWrite: false }));
    this.orbit.frustumCulled = false;
    scene.add(this.orbit);

    this.label = document.createElement('div');
    this.label.className = `label t${i}`;
    document.getElementById('labels').appendChild(this.label);
    this.coreR = radiusFor(s.core);
  }

  update(s, bodiesById, showGhost, showTrail) {
    const pos = v3(s.p);
    this.root.visible = s.alive;
    this.root.position.copy(pos);
    this.body.quaternion.set(s.q[0], s.q[1], s.q[2], s.q[3]);
    const r = s.r;
    this.shell.scale.setScalar(r);
    this.core.scale.setScalar(this.coreR);
    this.nose.scale.setScalar(r);
    this.nose.position.set(0, 0, r * 0.55);

    this.heading.scale.set(1, 1, Math.max(40, r * 9));

    const w = v3(s.w || [0, 0, 0]);
    const rate = w.length();
    this.spinRing.visible = s.alive && rate > 0.15;
    if (this.spinRing.visible) {
      this.spinAngle += Math.min(rate, 8) * (this._dt || 0.016);
      const qa = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), w.clone().normalize());
      const qs = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.spinAngle);
      this.spinRing.quaternion.copy(qa.multiply(qs));
      this.spinRing.scale.setScalar(r * 1.9);
      this.spinRing.material.opacity = Math.min(0.9, 0.25 + rate / 2);
    }

    const span = r * (0.5 + 1.6 * s.arms);
    for (const a of this.arms) {
      a.userData.rod.scale.set(span, r, r);
      a.userData.tip.scale.setScalar(r * 0.14);
      a.userData.tip.position.set(span, 0, 0);
    }

    const th = s.thrust;
    this.plume.visible = th > 0.02;
    this.plumeCore.visible = th > 0.02;
    const flick = 0.85 + Math.random() * 0.3;
    this.plume.scale.set(r * 0.7, r * 0.7, r * (0.5 + 4 * th) * flick);
    this.plume.position.set(0, 0, -r * 0.85);
    this.plumeCore.scale.set(r * 0.3, r * 0.3, r * (0.3 + 2.2 * th) * flick);
    this.plumeCore.position.set(0, 0, -r * 0.85);

    this.charge.visible = s.charge > 0.5;
    if (this.charge.visible) {
      const cr = radiusFor(s.charge);
      const ready = s.charge >= s.throw_min;
      this.charge.scale.setScalar(cr * (ready ? 1 + 0.15 * Math.sin(performance.now() / 60) : 0.8));
      this.charge.position.set(0, 0, r + cr + 0.3);
      this.charge.material.color.set(ready ? '#fff4c0' : '#8a8060');
    }

    const f = s.field;
    this.field.visible = Math.abs(f) > 0.01;
    if (this.field.visible) {
      const len = s.field_range, rad = len * Math.tan(THREE.MathUtils.degToRad(s.field_cone));
      this.field.scale.set(rad, rad, len);
      this.field.material.color.set(f > 0 ? '#5a9cff' : '#ffae3c');
      this.field.material.opacity = 0.06 + 0.16 * Math.min(1, Math.abs(f)) * (0.8 + 0.2 * Math.sin(performance.now() / 90));
    }

    // Tether.
    const t = s.tether;
    this.harpoon.visible = s.alive && t.k === 'flying';
    let end = null;
    if (t.k === 'flying') {
      end = v3(t.p);
      this.harpoon.position.copy(end);
      this.harpoon.scale.setScalar(1.2);
    } else if (t.k === 'attached') {
      const b = bodiesById.get(t.target);
      if (b) end = v3(b.p);
    }
    this.tether.visible = s.alive && !!end;
    if (end) {
      const d = end.clone().sub(pos);
      const len = d.length();
      const k = Math.min(1, s.tension / s.tether_break);
      this.tether.position.copy(pos);
      this.tether.lookAt(end);
      const thick = 0.35 + 1.2 * k;
      this.tether.scale.set(thick, thick, len);
      this.tether.material.color.setRGB(1, 1 - 0.85 * k, 1 - 0.95 * k);
      if (k > 0.8) this.tether.material.color.multiplyScalar(1 + 2 * Math.sin(performance.now() / 30) ** 2);
    }

    // Trail.
    if (s.alive) {
      this.trailPts.push(pos.clone());
      if (this.trailPts.length > this.trailN) this.trailPts.shift();
    }
    this.trail.visible = showTrail;
    const tp = this.trail.geometry.attributes.position, tc = this.trail.geometry.attributes.color;
    const n = this.trailPts.length;
    for (let k = 0; k < this.trailN; k++) {
      const p = this.trailPts[Math.max(0, n - this.trailN + k)] || pos;
      tp.setXYZ(k, p.x, p.y, p.z);
      const a = n ? Math.max(0, (k - (this.trailN - n)) / this.trailN) ** 1.6 : 0;
      tc.setXYZ(k, this.color.r * a, this.color.g * a, this.color.b * a);
    }
    tp.needsUpdate = tc.needsUpdate = true;

    updateGhost(this.ghost, pos, v3(s.v), 3.0, showGhost && s.alive);

    const vel = v3(s.v);
    const ring = wallRings[this.i];
    const planet = hazards.find((h) => h.k === 'planet');
    if (planet) {
      // Orbit line, and a ring where it leaves the safe zone (brighter the sooner).
      const cross = updateOrbit(this.orbit, pos, vel, planet, s.alive);
      if (s.alive && cross && cross.t < 12) {
        ring.position.copy(cross.p);
        ring.lookAt(planet.P);
        ring.scale.setScalar(14 + vel.length() * 0.4);
        ring.material.opacity = 0.9 * (1 - cross.t / 12);
      } else ring.material.opacity = 0;
    } else {
      this.orbit.visible = false;
      // Wall ring: where the current velocity would meet the wall, brighter as impact nears.
      const tHit = timeToSphere(pos, vel, arenaRadius);
      if (s.alive && tHit < 4 && vel.length() > 5) {
        const hit = pos.clone().addScaledVector(vel, tHit);
        ring.position.copy(hit.clone().multiplyScalar(0.998));
        ring.lookAt(0, 0, 0);
        ring.scale.setScalar(10 + vel.length() * 0.5);
        ring.material.opacity = 0.9 * (1 - tHit / 4);
      } else ring.material.opacity = 0;
    }

    // Nebula ablation or zone burn: the shell burns hot.
    const burn = Math.min(1, Math.max(s.ablation || 0, s.zone_burn || 0) / 8);
    this.shell.material.emissive.copy(this.color).lerp(new THREE.Color('#ff3b1a'), burn);
    this.shell.material.emissiveIntensity = 0.08 + 2.5 * burn * (0.8 + 0.2 * Math.random());

    // Label.
    const speed = vel.length();
    const res = Math.max(0, s.mass - s.core);
    const burnRate = (s.ablation || 0) + (s.zone_burn || 0);
    const burnTxt = burnRate > 0.5 ? ` · <span style="color:#ff6a3d">${s.zone_burn > 0 ? 'OUT OF ZONE' : 'burning'} −${burnRate.toFixed(0)} kg/s</span>` : '';
    this.labelHTML = `${s.name.toUpperCase()}<div class="sub">${res.toFixed(0)} kg · ${speed.toFixed(0)} m/s${burnTxt}</div>`;
    this.pos = pos;
    this.alive = s.alive;
  }

  dispose() {
    scene.remove(this.root, this.tether, this.harpoon, this.trail, this.ghost, this.orbit);
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
      const atmo = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: '#6fb6ff', transparent: true, opacity: 0.07, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      atmo.scale.setScalar(h.core * 1.05);
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

// ---------- loose bodies ----------
const bodyViews = new Map(); // id -> {mesh, ghost?, trail?}
function bodyView(b) {
  let v = bodyViews.get(b.id);
  if (v) return v;
  if (b.k === 'asteroid') {
    const m = new THREE.Mesh(rockGeo(2, 0.35, b.id * 104729 + 1), rockMat);
    scene.add(m);
    v = { mesh: m };
  } else if (b.k === 'slug') {
    const m = new THREE.Mesh(sphereGeo, glowMat(TEAM[b.o].clone().lerp(new THREE.Color('#ffffff'), 0.35)));
    const ghost = makeGhost(TEAM[b.o], 0.8);
    scene.add(m, ghost);
    v = { mesh: m, ghost, kind: 'slug' };
  } else {
    const m = new THREE.Mesh(debrisGeos[b.id % debrisGeos.length], debrisMat);
    m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    m.userData.spin = new THREE.Vector3().randomDirection().multiplyScalar(1 + Math.random() * 2);
    scene.add(m);
    v = { mesh: m, kind: 'debris' };
  }
  bodyViews.set(b.id, v);
  return v;
}
function syncBodies(bodies, showGhost, dt) {
  const seen = new Set();
  for (const b of bodies) {
    seen.add(b.id);
    let v = bodyViews.get(b.id);
    // A slug that has hit something becomes debris: rebuild its view.
    if (v && v.kind === 'slug' && b.k === 'debris') { disposeBody(b.id); v = null; }
    v = bodyView(b);
    v.mesh.position.set(b.p[0], b.p[1], b.p[2]);
    v.mesh.scale.setScalar(b.r);
    if (v.mesh.userData.spin) {
      const s = v.mesh.userData.spin;
      v.mesh.rotation.x += s.x * dt; v.mesh.rotation.y += s.y * dt; v.mesh.rotation.z += s.z * dt;
    }
    if (v.ghost) updateGhost(v.ghost, v.mesh.position, v3(b.v), 1.5, showGhost);
  }
  for (const id of [...bodyViews.keys()]) if (!seen.has(id)) disposeBody(id);
}
function disposeBody(id) {
  const v = bodyViews.get(id);
  if (!v) return;
  scene.remove(v.mesh);
  if (v.ghost) scene.remove(v.ghost);
  bodyViews.delete(id);
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
function renderTeam(i, s) {
  const el = $(`team${i}`);
  const span = s.max - s.core;
  const pct = Math.max(0, (s.mass - s.core) / span) * 100;
  const startPct = ((s.start - s.core) / span) * 100;
  const tension = s.tether.k === 'attached' ? Math.min(1, s.tension / s.tether_break) : 0;
  const charge = s.charge > 0 ? s.charge / s.throw_max : 0;
  const startPos = i === 0 ? `left:${startPct}%` : `right:${startPct}%`;
  el.innerHTML = `
    <div><span class="name">${s.name}</span><span class="mode">${s.alive ? s.mode : 'destroyed'}</span></div>
    <div class="bar"><div class="fill" style="width:${pct}%"></div><div class="start" style="${startPos}"></div></div>
    ${altitudeGauge(i, s)}
    <div class="meters">
      <span><b>${Math.max(0, s.mass - s.core).toFixed(0)}</b> kg</span>
      <span><b>${Math.hypot(...s.v).toFixed(0)}</b> m/s</span>
      <span>charge <span class="mini"><i style="width:${charge * 100}%"></i></span></span>
      <span>tether <span class="mini tension"><i style="width:${tension * 100}%"></i></span></span>
      <span title="nose vs. direction to enemy">aim <b>${attitude(i).aim}°</b></span>
      <span title="nose vs. direction of travel">drift <b>${attitude(i).drift}°</b></span>
      <span title="rotation rate">spin <b>${attitude(i).spin}°/s</b></span>
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
    case 'hit': {
      const p = v3(e.p);
      const big = e.lost > 60;
      flash(p, e.cause === 'wall' ? '#ff4d5e' : '#ffe2a8', 2 + Math.sqrt(e.energy) / 90, big ? 0.8 : 0.5);
      shake = Math.max(shake, Math.min(2, e.lost / 60));
      const who = nameOf(e.victim);
      const txt = {
        slug: `${e.attacker === e.victim ? who + ' hit by own slug' : nameOf(e.attacker) + ' slug hits ' + who}`,
        ram: `${nameOf(e.attacker)} rams ${who}`,
        wall: `${who} slams the wall`,
        asteroid: `${who} slams a rock`,
        debris: `${who} clipped by debris`,
        well: `${who} hits a well core`,
        planet: `${who} slams into the planet`,
        zone: `${who} burns out beyond the zone`,
        nebula: `${who} burns up in the nebula`,
      }[e.cause];
      if (e.lost >= 3) feedLine(`${txt} <b>−${e.lost.toFixed(0)} kg</b>`, `c${e.victim} ${big ? 'big' : ''}`);
      break;
    }
    case 'scoop':
      flash(v3(e.p), '#7dffb0', 2 + e.mass / 10, 0.4);
      if (e.mass >= 8) feedLine(`${nameOf(e.ship)} scoops <b>+${e.mass.toFixed(0)} kg</b>`, `c${e.ship}`);
      break;
    case 'throw':
      flash(v3(e.p), '#fff4c0', 1.5 + e.mass / 20, 0.25);
      break;
    case 'tether_attach': {
      const b = state?.bodies.find((x) => x.id === e.target);
      const what = b ? { asteroid: 'a rock', debris: 'debris', slug: 'a slug' }[b.k] : state?.ships.find((s) => s.id === e.target) ? nameOf(state.ships.find((s) => s.id === e.target).i) : 'something';
      feedLine(`${nameOf(e.ship)} hooks ${what}`, `c${e.ship}`);
      break;
    }
    case 'tether_snap':
      flash(v3(e.p), '#ffd35a', 5, 0.6);
      feedLine(`${nameOf(e.ship)}'s tether <b>SNAPS</b>`, `c${e.ship} big`);
      break;
    case 'kill':
      flash(v3(e.p), '#ffffff', 30, 1.4);
      shake = 3;
      feedLine(`${nameOf(e.victim)} DESTROYED${e.attacker != null ? ' by ' + nameOf(e.attacker) : ''}`, 'kill');
      break;
    case 'end': {
      const b = $('banner');
      b.hidden = false;
      const how = e.decision ? 'on mass at the final bell' : 'by destruction';
      b.innerHTML = e.winner == null ? `Dead heat<small>time limit</small>` : `<span style="color:${TEAM_CSS[e.winner]}">${state.ships[e.winner].name} wins</span><small>${how} · next match shortly</small>`;
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

// ---------- network ----------
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
  if (s.arena !== arenaRadius) { arenaRadius = s.arena; buildArena(1);
arena.scale.setScalar(arenaRadius); }
  const key = s.ships.map((x) => x.id + x.name).join('|');
  if (key !== shipKey) {
    shipViews.forEach((v) => v.dispose());
    shipViews = s.ships.map((x, i) => new ShipView(i, x));
    shipKey = key;
    $('selA').value = s.ships[0].name;
    $('selB').value = s.ships[1].name;
  }
  const hk = JSON.stringify(s.hazards);
  if (hk !== hazardKey) { hazardKey = hk; buildHazards(s.hazards); }
  state = s;
  for (const e of s.events) handleEvent(e);
  if (!s.finished && (!history.length || s.t - history[history.length - 1].t >= 0.25)) {
    const f = (x) => Math.max(0, x.mass - x.core) / (x.start - x.core);
    history.push({ t: s.t, d: Math.max(-1, Math.min(1, f(s.ships[0]) - f(s.ships[1]))) });
  }
  $('btnPause').textContent = s.paused ? 'Resume' : 'Pause';
}

// ---------- input ----------
const keys = new Set();
let tetherOn = false, armsOut = false;
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  if (e.repeat) return;
  if (k === 'f') tetherOn = !tetherOn;
  if (k === 'x') armsOut = !armsOut;
  if (k === 'c') { const opts = ['director', 'follow0', 'follow1', 'free']; camMode = opts[(opts.indexOf(camMode) + 1) % opts.length]; $('selCam').value = camMode; }
  if (k === 'n') newMatch();
  if (k === 'p') send({ type: 'pause' });
  if (k === 'h') $('help').hidden = !$('help').hidden;
  if (k === ' ') e.preventDefault();
  keys.add(k === 'shift' ? 'shift' : k);
  sendInput();
});
addEventListener('keyup', (e) => { keys.delete(e.key.toLowerCase()); sendInput(); });
addEventListener('blur', () => { keys.clear(); sendInput(); });
function axis(pos, neg) { return (keys.has(pos) ? 1 : 0) - (keys.has(neg) ? 1 : 0); }
function sendInput() {
  if (state?.control == null) return;
  send({
    type: 'input',
    thrust: keys.has('shift') ? 1 : 0,
    pitch: axis('w', 's'),
    yaw: axis('a', 'd'),
    roll: axis('e', 'q'),
    charge: keys.has(' '),
    tether: tetherOn,
    reel: axis('r', 'g'),
    arms: armsOut ? 1 : 0,
    field: axis('v', 'b'),
  });
}
setInterval(sendInput, 100);

function newMatch() { send({ type: 'reset', a: $('selA').value, b: $('selB').value }); }
$('btnReset').onclick = newMatch;
$('selA').onchange = newMatch;
$('selB').onchange = newMatch;
$('btnPause').onclick = () => send({ type: 'pause' });
$('selSpeed').onchange = (e) => send({ type: 'speed', value: parseFloat(e.target.value) });
$('selCam').onchange = (e) => { camMode = e.target.value; };
$('selCtl').onchange = (e) => {
  const v = e.target.value;
  tetherOn = false;
  send({ type: 'control', ship: v === '' ? null : parseInt(v, 10) });
  camMode = v === '' ? 'director' : 'pilot';
  $('selCam').value = camMode;
  e.target.blur();
};
$('btnHelp').onclick = () => { $('help').hidden = !$('help').hidden; };
for (const el of document.querySelectorAll('select, button')) el.addEventListener('keydown', (e) => e.key === ' ' && e.preventDefault());

// ---------- loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (state) {
    const byId = new Map(state.bodies.map((b) => [b.id, b]));
    for (const s of state.ships) byId.set(s.id, s);
    const g = $('chkGhost').checked, tr = $('chkTrail').checked;
    state.ships.forEach((s, i) => { if (shipViews[i]) { shipViews[i]._dt = dt; shipViews[i].update(s, byId, g, tr); } });
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
connect();
