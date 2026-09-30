// The 3D broadcast scene: ships, weapons, the fight plane and its drop lines.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

export const TEAM_CSS = ['#f5a623', '#4f8dff'];
export const TEAM = TEAM_CSS.map((c) => new THREE.Color(c));
export const THREAT = new THREE.Color('#ff3b5c');
const WHITE = new THREE.Color('#ffffff');

// On-screen length of a ship, as a fraction of the viewport height.
const SHIP_SCREEN = 0.08;
const SHIP_LEN = 24; // model metres, nose +Z

// One resolution shared by every line material (updated on resize): a line material left at its
// default 1×1 resolution draws a 3 px line three screens wide.
const RES = new THREE.Vector2(window.innerWidth, window.innerHeight);

function line2(color, width, opacity = 1, dashed = false) {
  const mat = new LineMaterial({ color, linewidth: width, transparent: true, opacity, depthWrite: false, dashed, dashSize: 60, gapSize: 40 });
  mat.resolution = RES;
  const l = new Line2(new LineGeometry(), mat);
  l.frustumCulled = false;
  l.geometry.setPositions([0, 0, 0, 0, 0, 1]);
  return l;
}
// A Line2's instanced buffers can't grow after first render: when the number of points changes,
// give it a fresh geometry (otherwise the draw overruns the buffer and the line goes to NaN).
function setLine(l, pts) {
  const arr = [];
  for (const p of pts) arr.push(p.x, p.y, p.z);
  if (l.userData.n !== pts.length) {
    l.geometry.dispose();
    l.geometry = new LineGeometry();
    l.userData.n = pts.length;
  }
  l.geometry.setPositions(arr);
  if (l.material.dashed) l.computeLineDistances();
}

// A batch of line segments with a fixed capacity, rewritten in place each frame (additive, so
// a segment coloured black is invisible: colour carries the fade).
function segBatch(max, width) {
  const geo = new LineSegmentsGeometry();
  geo.setPositions(new Float32Array(max * 6));
  geo.setColors(new Float32Array(max * 6));
  const mat = new LineMaterial({ color: 0xffffff, linewidth: width, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  mat.resolution = RES;
  const l = new LineSegments2(geo, mat);
  l.frustumCulled = false;
  l.userData.max = max;
  return l;
}
function writeSegs(l, pos, col, n) {
  const g = l.geometry;
  g.attributes.instanceStart.data.array.set(pos.subarray(0, n * 6));
  g.attributes.instanceStart.data.needsUpdate = true;
  g.attributes.instanceColorStart.data.array.set(col.subarray(0, n * 6));
  g.attributes.instanceColorStart.data.needsUpdate = true;
  g.instanceCount = n;
}
const hash = (a, b, c, d) => { const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7 + d * 19.3) * 43758.5453; return x - Math.floor(x); };

// Lines that brighten in front of the fight's middle and dim behind it (depth cueing).
// Geometry carries an `rgba` attribute; `uCentre` is the fight's middle in scene coordinates.
function depthCue() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uCentre: { value: new THREE.Vector3() }, uSpan: { value: 1000 } },
    vertexShader: `attribute vec4 rgba; uniform vec3 uCentre; varying vec4 vC; varying float vD;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vD = mv.z - (viewMatrix * vec4(uCentre, 1.0)).z; vC = rgba; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uSpan; varying vec4 vC; varying float vD;
      void main() { float k = smoothstep(-uSpan, uSpan, vD); gl_FragColor = vec4(vC.rgb, vC.a * mix(0.28, 1.3, k)); }`,
  });
}

// World-fixed dust: faint motes the fight moves through, so absolute motion reads. Several
// octaves of lattice (one jittered mote per cell), blended by camera distance so density on
// screen stays about constant; sized by depth for parallax.
const DUST_N = 12;
const DUST_CELLS = [125, 250, 500, 1000, 2000, 4000, 8000];
function dustMaterial(pr) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uAlpha: { value: 0 }, uRadius: { value: 1000 }, uRef: { value: 4000 }, uPx: { value: 2.2 * pr }, uColor: { value: new THREE.Color('#9fb2d6') } },
    vertexShader: `attribute float seed; uniform float uAlpha, uRadius, uRef, uPx; varying float vA;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec4 mv = viewMatrix * wp;
        float r = length(wp.xyz);
        vA = uAlpha * (0.3 + 0.7 * seed) * (1.0 - smoothstep(uRadius * 0.5, uRadius, r)) * smoothstep(30.0, 400.0, -mv.z);
        gl_PointSize = uPx * clamp(uRef / max(1.0, -mv.z), 0.45, 2.2) * (0.7 + 0.6 * seed);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uColor; varying float vA;
      void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(uColor * vA * (1.0 - smoothstep(0.2, 0.5, d)), 1.0); }`,
  });
}

// Ships are drawn as icons, not models: a solid team-coloured dart (nose +Z, a dorsal ridge so it
// reads in 3D, flat-ish so the key light shows which way it's banked), a bright nose tip, and a
// short flame whose length is the g. Stylised legibility over realism.
function shipModel(team) {
  const g = new THREE.Group();
  const c = TEAM[team];
  // Dart: nose, two wing tips, tail notch, dorsal ridge and a shallow keel.
  const V = [
    [0, 0, 14], // 0 nose
    [-7.5, 0, -9], // 1 port wing
    [7.5, 0, -9], // 2 starboard wing
    [0, 0, -4.5], // 3 tail notch
    [0, 3.4, -5], // 4 dorsal ridge
    [0, -1.4, -5], // 5 keel
  ].map((p) => new THREE.Vector3(...p));
  const F = [[0, 1, 4], [0, 4, 2], [1, 3, 4], [4, 3, 2], [0, 5, 1], [0, 2, 5], [1, 5, 3], [5, 2, 3]];
  const pos = [];
  for (const f of F) for (const k of f) pos.push(V[k].x, V[k].y, V[k].z);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const hullMat = new THREE.MeshLambertMaterial({ color: c.clone().multiplyScalar(0.85), emissive: c.clone().multiplyScalar(0.28), flatShading: true });
  const body = new THREE.Mesh(geo, hullMat);
  g.add(body);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 1), new THREE.LineBasicMaterial({ color: c.clone().lerp(WHITE, 0.55), transparent: true, opacity: 0.95 }));
  g.add(edges);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(1.3, 10, 8), new THREE.MeshBasicMaterial({ color: WHITE }));
  tip.position.set(0, 0.2, 14.2);
  g.add(tip);
  const plume = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1, 10, 1, true), new THREE.MeshBasicMaterial({ color: c.clone().lerp(WHITE, 0.35), transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
  plume.rotation.x = -Math.PI / 2;
  g.add(plume);
  // Shards for a breakup: each facet of the dart as its own piece (hidden until destroyed).
  const shards = new THREE.Group();
  shards.visible = false;
  const shardMat = new THREE.MeshLambertMaterial({ color: c.clone().multiplyScalar(0.5), emissive: c.clone().multiplyScalar(0.12), flatShading: true, side: THREE.DoubleSide });
  const shardEdge = new THREE.LineBasicMaterial({ color: c.clone().lerp(WHITE, 0.3), transparent: true, opacity: 0.7 });
  F.forEach((f, k) => {
    const cen = V[f[0]].clone().add(V[f[1]]).add(V[f[2]]).multiplyScalar(1 / 3);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute([...f].flatMap((j) => { const p = V[j].clone().sub(cen); return [p.x, p.y, p.z]; }), 3));
    sg.computeVertexNormals();
    const m = new THREE.Mesh(sg, shardMat);
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(sg), shardEdge));
    // Outward from the hull, plus a little randomness, and a spin.
    const dir = cen.clone().normalize().add(new THREE.Vector3(Math.sin(k * 12.9), Math.cos(k * 7.3), Math.sin(k * 3.1)).multiplyScalar(0.4)).normalize();
    m.userData = { home: cen, dir, speed: 5 + (k % 3) * 2.5, spin: new THREE.Vector3(Math.sin(k * 5.1), Math.cos(k * 2.7), Math.sin(k * 9.3)).multiplyScalar(2.2) };
    shards.add(m);
  });
  g.add(shards);
  g.userData = { plume, edges, hullMat, tip, body, shards };
  return g;
}

function ringGeometry(r, seg = 96) {
  const pts = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

export class Scene {
  constructor(canvas, match) {
    this.match = match;
    const story = window.__opt && window.__opt.story;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!story });
    // Phones: a pixel-ratio cap of 1.5 (their 3× screens cost battery for detail no one sees at
    // this line weight); desktop 2.
    const phone = Math.min(window.innerWidth, window.innerHeight) < 700 && matchMedia('(pointer: coarse)').matches;
    this.renderer.setPixelRatio(story ? 1 : Math.min(phone ? 1.5 : 2, window.devicePixelRatio));
    this.phone = phone;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#070a12');
    this.scene.fog = new THREE.FogExp2('#070a12', 0.00006);
    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 5, 200000);
    this.root = new THREE.Group(); // floating origin: everything relative to the fight's middle
    this.scene.add(this.root);

    // Light: a fixed key from "sun" direction so shading shows orientation; soft fill.
    const key = new THREE.DirectionalLight('#fff4e6', 2.2);
    key.position.set(0.6, 1, 0.35);
    this.scene.add(key);
    this.scene.add(new THREE.HemisphereLight('#6b7fa8', '#0b0d12', 0.55));

    this.stars();
    this.makeSky();
    this.plane = this.makePlane();
    this.ships = [0, 1].map((i) => { const m = shipModel(i); this.root.add(m); return m; });
    this.chargeLines = [0, 1].map((i) => { const l = line2(TEAM[i], 2.0, 0); this.root.add(l); return l; });
    this.stalks = [0, 1].map((i) => { const l = line2(TEAM[i], 1.5, 0.55); this.root.add(l); return l; });
    this.feet = [0, 1].map((i) => { const m = new THREE.LineLoop(ringGeometry(1), new THREE.LineBasicMaterial({ color: TEAM[i], transparent: true, opacity: 0.8 })); this.root.add(m); return m; });
    this.velLines = [0, 1].map((i) => { const l = line2(TEAM[i], 1.2, 0.35, true); this.root.add(l); return l; });
    this.rocks = this.makeRocks();
    // Ship paths: where each ship has been in the last few seconds (world-fixed).
    this.paths = [0, 1].map(() => { const l = line2(WHITE, 2.0, 1); l.material.vertexColors = true; l.material.blending = THREE.AdditiveBlending; this.root.add(l); return l; });
    // PDC tracers.
    this.tracers = segBatch(1500, 1.8);
    this.root.add(this.tracers);
    this._tp = new Float32Array(1500 * 6); this._tc = new Float32Array(1500 * 6);
    this.measureBatch = segBatch(200, 1.7);
    this.root.add(this.measureBatch);
    this._mp = new Float32Array(200 * 6); this._mc = new Float32Array(200 * 6);
    this.measureLabels = [];
    this.shrapnel = segBatch(1600, 1.6);
    this.root.add(this.shrapnel);
    this._sp = new Float32Array(1600 * 6); this._sc = new Float32Array(1600 * 6);
    this.shrapTags = [];
    this.makeDust();
    this.makeGimbal();
    this.makeTicks();

    // Pools for per-frame objects.
    this.pool = { slug: [], torp: [], trail: [], pdc: [], debris: [], tstalk: [], tring: [] };
    this.trails = new Map(); // torp id -> [positions]
    this.fx = []; // transient effects

    // Post: bloom.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.3, 0.55);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.resize();
    window.addEventListener('resize', () => this.resize());

    // Fight plane: fixed orientation for the match, perpendicular to the opening separation, so
    // both ships start on it and every later climb or dive shows as a stalk.
    const f0 = match.frames[0];
    const sep = new THREE.Vector3(...f0.s[1].p).sub(new THREE.Vector3(...f0.s[0].p)).normalize();
    let up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(up.dot(sep)) > 0.9) up.set(1, 0, 0);
    this.up = up.sub(sep.clone().multiplyScalar(up.dot(sep))).normalize();
    this.planeQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.up);
    this.planeCenter = new THREE.Vector3(); // smoothed
    this.mid = new THREE.Vector3();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    RES.set(w, h);
    this.bloom.setSize(this.phone ? w / 2 : w, this.phone ? h / 2 : h);
  }

  *allLineMaterials() {
    const walk = (o) => { if (o.material && o.material.isLineMaterial) return o.material; return null; };
    const out = [];
    this.scene.traverse((o) => { const m = walk(o); if (m) out.push(m); });
    yield* out;
  }

  stars() {
    const n = 2400, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = 150000;
      const s = Math.sqrt(1 - u * u);
      pos.set([Math.cos(a) * s * r, u * r, Math.sin(a) * s * r], i * 3);
      const b = 0.35 + Math.random() * 0.65;
      col.set([b * 0.85, b * 0.9, b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.starfield = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.4, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, opacity: 0.5 }));
    this.scene.add(this.starfield);
  }

  // The fight plane: rings and spokes around the fight's middle, spaced to suit the fight's size
  // and fading out with distance, so it frames the action without papering the screen.
  makePlane() {
    const grp = new THREE.Group();
    this.root.add(grp);
    this.gridSpacing = 0;
    return grp;
  }

  // The fight's gimbal: a 3D compass frame around the fight's middle, sized to the fight. The
  // horizon disc (rings, spokes), two vertical rings through the headings 000–180 and 090–270,
  // and a height axis with ticks. Depth-cued: lines in front of the fight's middle are bright,
  // lines behind it dim, so the frame reads as a volume, not a flat drawing.
  buildGrid(spacing) {
    const grp = this.plane;
    while (grp.children.length) { const c = grp.children.pop(); c.geometry.dispose(); }
    this.gridSpacing = spacing;
    const pos = [], col = [];
    const base = new THREE.Color('#9fb4dc'), vert = new THREE.Color('#b6c6e6');
    const push = (a, b, alpha, c = base) => { pos.push(a.x, a.y, a.z, b.x, b.y, b.z); col.push(c.r, c.g, c.b, alpha, c.r, c.g, c.b, alpha); };
    const rings = 5, maxR = spacing * rings;
    const fade = (r) => Math.max(0, 1 - r / (maxR * 1.05)) ** 1.1;
    const circle = (r, alpha, seg, pt, c) => {
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        push(pt(a0, r), pt(a1, r), alpha, c);
      }
    };
    const flat = (a, r) => new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r);
    // Horizon disc.
    for (let k = 1; k <= rings; k++) circle(k * spacing, (k === 2 ? 0.55 : k % 2 === 0 ? 0.36 : 0.24) * fade(k * spacing), 128, flat, base);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2, n = 12, major = k % 3 === 0;
      for (let i = 0; i < n; i++) {
        const r0 = spacing * 0.5 + (maxR - spacing * 0.5) * (i / n), r1 = spacing * 0.5 + (maxR - spacing * 0.5) * ((i + 1) / n);
        push(flat(a, r0), flat(a, r1), (major ? 0.26 : 0.12) * fade(r0));
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('rgba', new THREE.Float32BufferAttribute(col, 4));
    this.gridMat ||= depthCue();
    grp.add(new THREE.LineSegments(g, this.gridMat));
  }

  // The gimbal proper, built once at unit radius and scaled smoothly to hold both ships.
  makeGimbal() {
    const pos = [], col = [];
    const base = new THREE.Color('#9fb4dc'), vert = new THREE.Color('#b6c6e6');
    const push = (a, b, alpha, c = base) => { pos.push(a.x, a.y, a.z, b.x, b.y, b.z); col.push(c.r, c.g, c.b, alpha, c.r, c.g, c.b, alpha); };
    const circle = (r, alpha, seg, pt, c) => { for (let i = 0; i < seg; i++) push(pt((i / seg) * Math.PI * 2, r), pt(((i + 1) / seg) * Math.PI * 2, r), alpha, c); };
    const flat = (a, r) => new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r);
    const R = 1, spacing = 0.5;
    circle(R, 0.34, 128, flat, base);
    // Heading ticks on the gimbal ring (every 10°, long at 30°).
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * Math.PI * 2, l = k % 3 === 0 ? 0.14 : 0.06;
      push(flat(a, R * (1 - l)), flat(a, R * (1 + l)), k % 3 === 0 ? 0.4 : 0.2);
    }
    // Vertical rings: through 000/180 and 090/270.
    circle(R, 0.2, 128, (a, r) => new THREE.Vector3(0, Math.sin(a) * r, Math.cos(a) * r), vert);
    circle(R, 0.2, 128, (a, r) => new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0), vert);
    // Elevation ticks on the vertical rings (every 15°).
    for (let k = 1; k < 24; k++) {
      if (k % 12 === 0) continue;
      const a = (k / 24) * Math.PI * 2, l = k % 2 === 0 ? 0.08 : 0.04;
      for (const f of [(a, r) => new THREE.Vector3(0, Math.sin(a) * r, Math.cos(a) * r), (a, r) => new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0)]) push(f(a, R * (1 - l)), f(a, R * (1 + l)), 0.25, vert);
    }
    // Height axis, ticks every `spacing / 2`.
    push(new THREE.Vector3(0, -R, 0), new THREE.Vector3(0, R, 0), 0.22, vert);
    for (let h = -R; h <= R + 1e-6; h += spacing / 2) {
      if (Math.abs(h) < 1e-6) continue;
      const l = spacing * (Math.abs(h % spacing) < 1e-6 ? 0.12 : 0.06);
      push(new THREE.Vector3(-l, h, 0), new THREE.Vector3(l, h, 0), 0.28, vert);
      push(new THREE.Vector3(0, h, -l), new THREE.Vector3(0, h, l), 0.28, vert);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('rgba', new THREE.Float32BufferAttribute(col, 4));
    this.gimbalMat = depthCue();
    this.gimbal = new THREE.LineSegments(g, this.gimbalMat);
    this.gimbal.frustumCulled = false;
    this.root.add(this.gimbal);
    this.gimbalR = 0;
  }

  // The sky compass: a sphere of great circles at infinity, fixed to the fight's frame (up = the
  // fight plane's normal). Every turn of the camera reads against it: horizon, elevation rings
  // every 30°, meridians every 30°, heading labels round the horizon, zenith and nadir marks.
  makeSky() {
    const grp = new THREE.Group();
    const R = 90000, pos = [], col = [];
    const c = new THREE.Color('#8fa3c8');
    const push = (a, b, alpha) => { pos.push(a.x, a.y, a.z, b.x, b.y, b.z); col.push(c.r, c.g, c.b, alpha, c.r, c.g, c.b, alpha); };
    const P = (az, el) => new THREE.Vector3(Math.sin(az) * Math.cos(el) * R, Math.sin(el) * R, Math.cos(az) * Math.cos(el) * R);
    const D = Math.PI / 180, seg = 144;
    for (const el of [-30, 0, 30]) {
      for (let i = 0; i < seg; i++) push(P((i / seg) * 2 * Math.PI, el * D), P(((i + 1) / seg) * 2 * Math.PI, el * D), el === 0 ? 0.22 : 0.05);
    }
    for (let k = 0; k < 12; k += 3) {
      const az = k * 30 * D;
      for (let i = 0; i < 72; i++) { const e0 = -90 + (i / 72) * 180, e1 = -90 + ((i + 1) / 72) * 180; push(P(az, e0 * D), P(az, e1 * D), 0.06); }
    }
    for (let k = 0; k < 12; k++) { const az = k * 30 * D, l = 0.8; push(P(az, -l * D), P(az, l * D), 0.22); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('rgba', new THREE.Float32BufferAttribute(col, 4));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false, fog: false,
      vertexShader: 'attribute vec4 rgba; varying vec4 vC; void main() { vC = rgba; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec4 vC; void main() { gl_FragColor = vC; }',
    });
    const lines = new THREE.LineSegments(g, mat);
    lines.frustumCulled = false; lines.renderOrder = -10;
    grp.add(lines);
    // Labels.
    const label = (text, az, el, size = 0.022, alpha = 0.7) => {
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
      const x = cv.getContext('2d');
      x.font = '600 40px "Saira Condensed", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = `rgba(170,188,222,${alpha})`; x.fillText(text, 128, 32);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, depthWrite: false, transparent: true, fog: false, sizeAttenuation: false }));
      sp.scale.set(size * 4, size, 1);
      sp.position.copy(P(az * D, el * D));
      sp.renderOrder = -9;
      grp.add(sp);
    };
    for (let k = 0; k < 12; k++) label(String(k * 30).padStart(3, '0'), k * 30, 2.6, k % 3 === 0 ? 0.024 : 0.018, k % 3 === 0 ? 0.6 : 0.38);
    label('ZENITH', 0, 88, 0.02, 0.4); label('NADIR', 0, -88, 0.02, 0.4);
    for (const el of [-30, 30]) label((el > 0 ? '+' : '') + el + '°', 15, el + 1.5, 0.015, 0.3);
    this.scene.add(grp);
    this.sky = grp;
  }

  makeDust() {
    this.dust = DUST_CELLS.map((C) => {
      const n = DUST_N ** 3;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('seed', new THREE.BufferAttribute(new Float32Array(n), 1));
      const pts = new THREE.Points(g, dustMaterial(this.renderer.getPixelRatio()));
      pts.frustumCulled = false; pts.visible = false;
      this.root.add(pts);
      return { C, pts, key: null };
    });
  }
  updateDust() {
    const camD = this.camera.position.length();
    const ideal = camD / 7;
    for (const o of this.dust) {
      const w = Math.max(0, 1 - Math.abs(Math.log2(o.C / ideal)));
      o.pts.visible = w > 0.01;
      if (!o.pts.visible) continue;
      const u = o.pts.material.uniforms;
      u.uAlpha.value = 0.55 * w; u.uRadius.value = (DUST_N / 2) * o.C; u.uRef.value = camD;
      // Re-seed the lattice around the fight when the fight moves to another cell (motes are
      // tied to world cells, so the pattern is the same whenever it's regenerated).
      const cx = Math.round(this.mid.x / o.C), cy = Math.round(this.mid.y / o.C), cz = Math.round(this.mid.z / o.C);
      const key = cx + ',' + cy + ',' + cz;
      if (key === o.key) continue;
      o.key = key;
      const pos = o.pts.geometry.attributes.position.array, seed = o.pts.geometry.attributes.seed.array;
      let k = 0; const h = DUST_N / 2;
      for (let i = -h; i < h; i++) for (let j = -h; j < h; j++) for (let l = -h; l < h; l++) {
        const X = cx + i, Y = cy + j, Z = cz + l;
        pos[k * 3] = (X + hash(X, Y, Z, 1)) * o.C; pos[k * 3 + 1] = (Y + hash(X, Y, Z, 2)) * o.C; pos[k * 3 + 2] = (Z + hash(X, Y, Z, 3)) * o.C;
        seed[k] = hash(X, Y, Z, o.C);
        k++;
      }
      o.pts.geometry.attributes.position.needsUpdate = true; o.pts.geometry.attributes.seed.needsUpdate = true;
    }
  }

  // Ticks on the fight plane, fixed in the world (the rings follow the fight; the ticks don't),
  // so drift across the plane shows.
  makeTicks() {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uCentre: { value: new THREE.Vector3() }, uRadius: { value: 1000 }, uColor: { value: new THREE.Color('#8fa3c8') } },
      vertexShader: `uniform vec3 uCentre; uniform float uRadius; varying float vA;
        void main() { vec4 wp = modelMatrix * vec4(position, 1.0); float r = length(wp.xyz - uCentre);
          vA = 0.2 * pow(max(0.0, 1.0 - r / uRadius), 1.3); gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: `uniform vec3 uColor; varying float vA; void main() { gl_FragColor = vec4(uColor, vA); }`,
    });
    this.ticks = new THREE.LineSegments(new THREE.BufferGeometry(), mat);
    this.ticks.frustumCulled = false;
    this.root.add(this.ticks);
    this.tickS = 0;
  }
  updateTicks() {
    const S = this.gridSpacing;
    if (!S) return;
    const N = 7;
    if (S !== this.tickS) {
      this.tickS = S;
      const a = S * 0.035, pos = [];
      for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) {
        const x = i * S, z = j * S;
        pos.push(x - a, 0, z, x + a, 0, z, x, 0, z - a, x, 0, z + a);
      }
      this.ticks.geometry.dispose();
      this.ticks.geometry = new THREE.BufferGeometry();
      this.ticks.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    }
    // The lattice in plane coordinates, snapped to world multiples of S.
    const e1 = new THREE.Vector3(1, 0, 0).applyQuaternion(this.planeQuat), e2 = new THREE.Vector3(0, 0, 1).applyQuaternion(this.planeQuat);
    const c = this.planeCenter;
    const u = Math.round(c.dot(e1) / S) * S, v = Math.round(c.dot(e2) / S) * S;
    this.ticks.position.copy(this.up).multiplyScalar(c.dot(this.up)).addScaledVector(e1, u).addScaledVector(e2, v);
    this.ticks.quaternion.copy(this.planeQuat);
    const U = this.ticks.material.uniforms;
    U.uCentre.value.copy(c).sub(this.mid); U.uRadius.value = S * 5.2;
  }

  makeRocks() {
    const out = [];
    for (const [x, y, z, r] of this.match.raw.rocks) {
      const geo = new THREE.IcosahedronGeometry(r, 0);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const s = 0.8 + 0.35 * Math.sin(i * 12.9898 + x) * Math.cos(i * 78.233 + z);
        p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s);
      }
      geo.computeVertexNormals();
      // Terrain as a quiet silhouette: flat dark fill, thin cool outline — it reads as an obstacle
      // without competing with the ships.
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x232a36, emissive: 0x0b0e14, flatShading: true }));
      m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 40), new THREE.LineBasicMaterial({ color: 0x6a7690, transparent: true, opacity: 0.35 })));
      m.userData.pos = new THREE.Vector3(x, y, z);
      this.root.add(m);
      out.push(m);
    }
    return out;
  }

  get(kind, make) {
    const p = this.pool[kind];
    p._used = (p._used || 0);
    if (p._used >= p.length) { const o = make(); this.root.add(o); p.push(o); }
    const o = p[p._used++];
    o.visible = true;
    return o;
  }
  resetPools() { for (const k in this.pool) { const p = this.pool[k]; for (let i = 0; i < p.length; i++) p[i].visible = false; p._used = 0; } }

  // Project a world point onto the fight plane.
  toPlane(p) {
    const d = p.clone().sub(this.planeCenter);
    return p.clone().sub(this.up.clone().multiplyScalar(d.dot(this.up)));
  }
  height(p) { return p.clone().sub(this.planeCenter).dot(this.up); }

  // Screen-constant scale for an object at world position p.
  screenScale(p, frac = SHIP_SCREEN, len = SHIP_LEN) {
    const d = p.distanceTo(this.camWorld);
    const worldH = 2 * d * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    return Math.max(1, (worldH * frac) / len);
  }

  // Icon size as a fraction of screen height: generous, shrinking so the two never overlap.
  iconFrac(st) {
    const a = st.ships[0].pos.clone().sub(this.mid).project(this.camera);
    const b = st.ships[1].pos.clone().sub(this.mid).project(this.camera);
    const sepH = Math.hypot((a.x - b.x) * this.camera.aspect, a.y - b.y) / 2; // in screen heights
    // (Sized against the screen's shorter side, so a tall phone screen doesn't get huge icons.)
    const short = Math.min(1, this.camera.aspect * 1.25);
    return Math.max(0.028 * short, Math.min(SHIP_SCREEN * short, 0.34 * sepH));
  }

  update(t, st, now) {
    this._now = now;
    // After the end, the guns go quiet.
    this.ended = t > this.match.duration + 1e-3;
    const m = this.match;
    this.resetPools();
    this.camWorld = this.camera.position.clone().add(this.mid);
    // Floating origin at the fight's middle.
    this.mid.copy(st.ships[0].pos).add(st.ships[1].pos).multiplyScalar(0.5);
    this.root.position.copy(this.mid).negate();
    if (this.planeCenter.lengthSq() === 0) this.planeCenter.copy(this.mid);
    this.planeCenter.lerp(this.mid, 0.02); // plane follows the fight's middle, slowly (never rotates)
    this.plane.position.copy(this.planeCenter);
    // Ring spacing to suit the fight: about half the ships' separation, in round numbers.
    const sepNow = st.ships[0].pos.distanceTo(st.ships[1].pos);
    const want = sepNow < 1400 ? 250 : sepNow < 2800 ? 500 : sepNow < 6000 ? 1000 : 2000;
    if (want !== this.gridSpacing && (this.gridSpacing === 0 || want > this.gridSpacing * 1.5 || want < this.gridSpacing / 1.5)) this.buildGrid(want);
    this.plane.quaternion.copy(this.planeQuat);
    this.updateTicks();
    // The sky compass sits at infinity (moves with the camera), turned with the fight's frame.
    this.sky.position.copy(this.camera.position);
    this.sky.quaternion.copy(this.planeQuat);
    // Gimbal: centred on the plane's middle, radius easing toward 1.25× the farther ship.
    {
      const far = Math.max(st.ships[0].pos.distanceTo(this.planeCenter), st.ships[1].pos.distanceTo(this.planeCenter));
      const want = Math.max(400, far * 1.12);
      this.gimbalR = this.gimbalR ? this.gimbalR + (want - this.gimbalR) * 0.03 : want;
      this.gimbal.position.copy(this.planeCenter);
      this.gimbal.quaternion.copy(this.planeQuat);
      this.gimbal.scale.setScalar(this.gimbalR);
      for (const mt of [this.gridMat, this.gimbalMat]) if (mt) { mt.uniforms.uCentre.value.copy(this.planeCenter).sub(this.mid); mt.uniforms.uSpan.value = this.gimbalR; }
    }
    this.updateDust();

    for (let i = 0; i < 2; i++) {
      const s = st.ships[i], g = this.ships[i];
      g.position.copy(s.pos);
      g.quaternion.copy(s.quat);
      this.deathT ??= [null, null];
      const dead = !s.raw.alive || (!['time', 'broke off', 'both disabled'].includes(this.match.raw.end_reason) && t >= this.match.duration - 1e-3 && this.match.raw.winner !== i);
      if (dead) {
        this.deathT[i] ??= t;
        const k = t - this.deathT[i];
        const u = g.userData;
        if (s.raw.hull <= 0) {
          // Destroyed by fire: the hull comes apart — facets drifting outward, tumbling.
          u.body.visible = false; u.edges.visible = false; u.tip.visible = false; u.plume.visible = false;
          u.shards.visible = true;
          const e = 1 - Math.exp(-k * 1.2);
          for (const m of u.shards.children) {
            const d = m.userData;
            m.position.copy(d.home).addScaledVector(d.dir, d.speed * e * 3);
            m.rotation.set(d.spin.x * k, d.spin.y * k, d.spin.z * k);
          }
        } else {
          // Crew dead or dead in space: intact, a derelict in a slow tumble.
          g.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(k * 0.6, k * 0.25, k * 0.4)));
        }
      } else {
        this.deathT[i] = null;
        const u = g.userData;
        u.body.visible = true; u.edges.visible = true; u.plume.visible = true; u.shards.visible = false;
      }
      // Icon size: generous, but never so big that the two overlap on screen.
      const sc = this.screenScale(s.pos, this.iconFrac(st), SHIP_LEN);
      g.scale.setScalar(sc);
      g.visible = true;
      const alive = s.raw.alive;
      g.userData.edges.material.opacity = alive ? 0.95 : 0.3;
      g.userData.hullMat.color.copy(alive ? TEAM[i].clone().multiplyScalar(0.85) : new THREE.Color(0x2a2d33));
      g.userData.hullMat.emissive.copy(alive ? TEAM[i].clone().multiplyScalar(0.28) : new THREE.Color(0));
      g.userData.tip.visible = alive;
      // Plume: drive thrust = acceleration along the nose.
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(s.quat);
      const thrustG = this.ended ? 0 : Math.max(0, s.acc.dot(fwd)) / 9.81;
      const plume = g.userData.plume;
      // Flame length reads as g: one ship length at 12 g, capped.
      const L = thrustG > 0.3 ? Math.min(30, 4 + thrustG * 1.9) : 0.001;
      plume.scale.set(1, L, 1);
      plume.position.set(0, 0, -4.5 - L / 2);
      plume.material.color.copy(thrustG > 11 ? THREAT : TEAM[i].clone().lerp(WHITE, 0.35));
      plume.material.opacity = 0.8;
      // Stalk and footprint.
      const foot = this.toPlane(s.pos);
      setLine(this.stalks[i], [s.pos, foot]);
      this.stalks[i].material.opacity = 0.5;
      this.feet[i].position.copy(foot);
      this.feet[i].quaternion.copy(this.planeQuat);
      this.feet[i].scale.setScalar(sc * 7);
      // Path: the last 8 s of where the ship has actually been, fading toward the tail.
      {
        const N = 64, span = 8, pts = [], col = [];
        const c = TEAM[i];
        for (let k = 0; k < N; k++) {
          const tk = Math.max(0, t - (k / (N - 1)) * span);
          pts.push(k === 0 ? s.pos : m.ship(tk, i).pos);
          const f = (1 - k / (N - 1)) ** 1.6 * 0.6;
          col.push(c.r * f, c.g * f, c.b * f);
        }
        const l = this.paths[i];
        l.geometry.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
        l.geometry.setColors(col);
      }
      // Velocity cue (dashed), 4 s ahead relative to the fight's middle.
      const rel = s.vel.clone().sub(st.ships[0].vel.clone().add(st.ships[1].vel).multiplyScalar(0.5));
      this.velLines[i].visible = false;
      // Railgun charge line: along the nose, brightening with charge; the threat colour once full
      // and on target.
      const r = s.raw.rail; // [charge, held, cooldown, ammo, overcharged]
      const cl = this.chargeLines[i];
      const e = st.ships[1 - i];
      if (alive && !this.ended && r[0] > 0.02) {
        const toE = e.pos.clone().sub(s.pos);
        const len = Math.max(400, toE.length() * 1.15);
        setLine(cl, [s.pos.clone().addScaledVector(fwd, 14 * sc), s.pos.clone().addScaledVector(fwd, len)]);
        const along = toE.dot(fwd);
        const miss = toE.clone().sub(fwd.clone().multiplyScalar(along)).length();
        const onTarget = along > 0 && miss < 60;
        const full = r[0] >= 0.999;
        const pulse = full ? 0.75 + 0.25 * Math.sin(now * 14) : 1;
        cl.material.color.copy(full && onTarget ? THREAT : TEAM[i]);
        cl.material.opacity = (0.15 + 0.75 * r[0]) * pulse;
        cl.material.linewidth = full ? 2.6 : 1.4;
        cl.visible = true;
      } else cl.visible = false;
    }

    // Railgun rounds: bright streaks.
    for (const sl of m.objects(t, 'sl')) {
      const l = this.get('slug', () => line2(WHITE, 3.0, 1));
      const dir = sl.vel.clone().normalize();
      setLine(l, [sl.pos.clone().addScaledVector(dir, -Math.max(150, this.screenScale(sl.pos, 0.05, 1))), sl.pos]);
      l.material.color.copy(TEAM[sl.owner]).lerp(WHITE, 0.6);
      l.material.linewidth = sl.extra > 1.01 ? 4.5 : 3.0;
    }

    // Torpedoes: motes with ribbon trails; red when close and inbound.
    const seen = new Set();
    for (const tp of m.objects(t, 'tp')) {
      seen.add(tp.id);
      const tr = this.trails.get(tp.id) || [];
      if (!tr.length || tr[tr.length - 1].t < t - 0.05) tr.push({ t, p: tp.pos.clone() });
      while (tr.length && tr[0].t < t - 3.0) tr.shift();
      this.trails.set(tp.id, tr);
      const target = st.ships[1 - tp.owner];
      const range = tp.pos.distanceTo(target.pos);
      const hot = range < 2500;
      // A chevron along its flight path; threat red with a pulsing ring once it's close.
      const mote = this.get('torp', () => { const m = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.4, 4), new THREE.MeshBasicMaterial({ color: WHITE })); m.geometry.rotateX(Math.PI / 2); return m; });
      mote.position.copy(tp.pos);
      mote.lookAt(tp.pos.clone().add(tp.vel.clone().sub(target.vel)));
      mote.scale.setScalar(this.screenScale(tp.pos, 0.022, 1.4));
      mote.material.color.copy(hot ? THREAT : TEAM[tp.owner].clone().lerp(WHITE, 0.3));
      if (hot) {
        const ring = this.get('tring', () => new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 24), new THREE.MeshBasicMaterial({ color: THREAT, transparent: true, depthWrite: false, side: THREE.DoubleSide })));
        ring.position.copy(tp.pos);
        ring.quaternion.copy(this.camera.quaternion);
        const k = (now * 2.5 + tp.id * 0.37) % 1;
        ring.scale.setScalar(this.screenScale(tp.pos, 0.012 + 0.02 * k, 1));
        ring.material.opacity = 0.9 * (1 - k);
      }
      if (tr.length > 1) {
        const l = this.get('trail', () => line2(WHITE, 1.6, 0.6));
        // Fixed point count (resampled), so the line's buffers never need rebuilding.
        const pts = tr.map((x) => x.p).concat([tp.pos]);
        const N = 32, rs = [];
        for (let k = 0; k < N; k++) { const f = (k / (N - 1)) * (pts.length - 1), j = Math.min(pts.length - 2, Math.floor(f)); rs.push(pts[j].clone().lerp(pts[j + 1], f - j)); }
        setLine(l, rs);
        l.material.color.copy(hot ? THREAT : TEAM[tp.owner]);
        l.material.opacity = 0.7;
        l.material.linewidth = 2.0;
      }
      const s = this.get('tstalk', () => line2(WHITE, 1.0, 0.25));
      setLine(s, [tp.pos, this.toPlane(tp.pos)]);
      s.material.color.copy(TEAM[tp.owner]);
    }
    for (const id of this.trails.keys()) if (!seen.has(id)) this.trails.delete(id);

    // PDC tracers: individual rounds, fired from the mount toward where the target will be,
    // flying on ballistically (the shooter's velocity plus muzzle velocity). Drawn from the
    // recording, not simulated here: every round alive at t is re-derived from the frame it was
    // fired in, so seeking and slow motion are exact.
    this.drawTracers(t, st);

    // Shrapnel: a shot-down torpedo breaks up but its pieces fly on. Drawn as a cloud of
    // fragments — hot sparks streaking along the cloud's course, spread by its dispersion —
    // so it reads as debris still coming, not as an abstract zone.
    this.drawShrapnel(t, st, now);
    this.drawMeasures(t, st);

    // Rocks: shown at true size (they're big), but never smaller than a speck.
    for (const r of this.rocks) {
      r.position.copy(r.userData.pos);
    }

    // Transient effects.
    this.fx = this.fx.filter((f) => {
      const age = now - f.born;
      if (age > f.life) { this.root.remove(f.obj); return false; }
      if (age < 0) { f.tick(-1, f.obj, this); return true; }
      f.tick(age / f.life, f.obj, this);
      return true;
    });
  }

  // Measurement lines, |—N m—|: a railgun round's miss distance, from the target's hull out to
  // where the round passed (with a dashed trace of its path), riding with the target; and the
  // ships' closest pass, spanning where they were at that moment. Shown for 2.4 s of match time.
  // (Icons are drawn far larger than the ships, so the miss line starts at the icon's edge and
  // is never drawn shorter than a readable length; the label is the true distance.)
  drawMeasures(t, st) {
    const pos = this._mp, col = this._mc;
    let n = 0;
    this.measureLabels = [];
    const view = new THREE.Vector3(); this.camera.getWorldDirection(view);
    const seg = (a, b, c, f) => { if (n >= 200) return; pos.set([a.x, a.y, a.z, b.x, b.y, b.z], n * 6); col.set([c.r * f, c.g * f, c.b * f, c.r * f, c.g * f, c.b * f], n * 6); n++; };
    const ink = new THREE.Color('#e6ebf5');
    const dim = (A, B, f, text) => {
      const along = B.clone().sub(A);
      const tdir = along.clone().cross(view).normalize();
      const tk = this.screenScale(A.clone().add(B).multiplyScalar(0.5), 0.011, 1);
      seg(A, B, ink, f);
      for (const P of [A, B]) seg(P.clone().addScaledVector(tdir, -tk), P.clone().addScaledVector(tdir, tk), ink, f);
      this.measureLabels.push({ pos: A.clone().add(B).multiplyScalar(0.5).addScaledVector(tdir, tk * 2.2), text, alpha: f });
    };
    for (const m of this.match.measures) {
      const age = t - m.t;
      if (age < 0 || age > 2.4) continue;
      const f = Math.min(1, age / 0.15) * Math.min(1, (2.4 - age) / 0.6);
      if (m.kind === 'miss') {
        const S = st.ships[m.ship].pos, o = m.off.clone().normalize();
        const rIcon = this.ships[m.ship].scale.x * 8;
        const minVis = this.screenScale(S, 0.06, 1);
        const A = S.clone().addScaledVector(o, rIcon), B = S.clone().addScaledVector(o, rIcon + Math.max(minVis, m.gap));
        dim(A, B, f, `${Math.round(m.gap)} m`);
        // The round's path past the ship, dashed.
        const L = (rIcon + minVis) * 2.2, c = TEAM[m.owner].clone().lerp(new THREE.Color('#ffffff'), 0.4);
        for (let k = -6; k < 6; k++) seg(B.clone().addScaledVector(m.dir, (k / 6) * L), B.clone().addScaledVector(m.dir, ((k + 0.55) / 6) * L), c, 0.7 * f);
      } else {
        // Carried with the fight's middle since the pass (the whole fight drifts), so it stays
        // by the ships; its length and angle stay those of the closest approach.
        if (age > 1.8) continue;
        const g = Math.min(1, age / 0.15) * Math.min(1, (1.8 - age) / 0.5);
        const shift = this.mid.clone().sub(m.a.clone().add(m.b).multiplyScalar(0.5));
        dim(m.a.clone().add(shift), m.b.clone().add(shift), g, `closest ${Math.round(m.gap)} m`);
      }
    }
    writeSegs(this.measureBatch, pos, col, n);
  }

  drawShrapnel(t, st, now) {
    const m = this.match;
    const clouds = m.objects(t, 'db');
    const prev = new Map(m.objects(Math.max(0, t - 1 / 30), 'db').map((o) => [o.id, o]));
    const pos = this._sp, col = this._sc, max = this.shrapnel.userData.max;
    const FR = 40;
    let n = 0;
    this.shrapTags = [];
    const g = (a, b) => Math.sqrt(-2 * Math.log(Math.max(1e-6, a))) * Math.cos(6.2832 * b); // gaussian
    for (const d of clouds) {
      const target = st.ships[d.owner]; // (debris records carry the target where others carry the owner)
      const p = prev.get(d.id);
      const vel = p && t > 1 / 30 ? d.pos.clone().sub(p.pos).multiplyScalar(30) : new THREE.Vector3();
      const rel = vel.clone().sub(target.vel);
      const dir = rel.lengthSq() > 1 ? rel.clone().normalize() : new THREE.Vector3(0, 0, 1);
      const toT = target.pos.clone().sub(d.pos);
      const closing = toT.dot(rel) > 0;
      const spread = Math.max(d.extra, this.screenScale(d.pos, 0.012, 1));
      const len = this.screenScale(d.pos, 0.007, 1);
      const fade = (d.fade ?? 1) * (closing ? 1 : 0.35);
      for (let k = 0; k < FR && n < max; k++) {
        const h1 = hash(d.id, k, 1, 0), h2 = hash(d.id, k, 2, 0), h3 = hash(d.id, k, 3, 0), h4 = hash(d.id, k, 4, 0);
        const off = new THREE.Vector3(g(h1, h2), g(h2, h3), g(h3, h4)).multiplyScalar(spread * 0.6);
        const head = d.pos.clone().add(off);
        const L = len * (0.5 + h4);
        const tail = head.clone().addScaledVector(dir, -L);
        pos.set([tail.x, tail.y, tail.z, head.x, head.y, head.z], n * 6);
        // Sparkle: each fragment glints at its own rhythm.
        const tw = 0.45 + 0.55 * Math.abs(Math.sin(now * (5 + 9 * h1) + k));
        const f = fade * tw;
        col.set([0.35 * f, 0.08 * f, 0.05 * f, 1.0 * f, 0.62 * f, 0.4 * f], n * 6);
        n++;
      }
      if (closing && toT.length() < 3500 && !this.ended) this.shrapTags.push({ pos: d.pos.clone(), id: d.id, spread });
    }
    writeSegs(this.shrapnel, pos, col, n);
  }

  drawTracers(t, st) {
    const m = this.match, hz = m.hz, normals = m.raw.pdc_normals;
    const V = 1400, RANGE = m.params.pdc_range || 2000, LIFE = RANGE / V;
    const pos = this._tp, col = this._tc, max = this.tracers.userData.max;
    let n = 0;
    const k1 = Math.min(m.frames.length - 1, Math.floor(t * hz)), k0 = Math.max(0, Math.ceil((t - LIFE) * hz));
    const tmp = new THREE.Vector3(), dir = new THREE.Vector3();
    for (let k = k0; k <= k1 && n < max; k++) {
      const F = m.frames[k];
      let torps = null;
      for (let i = 0; i < 2; i++) {
        const S = F.s[i];
        if (!S.alive) continue;
        for (let j = 0; j < S.pdc.length; j++) {
          const [, , target, atShip] = S.pdc[j];
          let aimP = null, aimV = null;
          if (atShip) { const E = F.s[1 - i]; aimP = E.p; aimV = E.v; }
          else if (target >= 0) {
            torps ||= new Map(F.tp.map((o) => [o[0], o]));
            const o = torps.get(target);
            if (o) { aimP = o[2]; aimV = o[3]; }
          }
          if (!aimP) continue;
          // One tracer every other frame (15 a second per mount, like a tracer every few
          // rounds), mounts staggered: discrete rounds with clear gaps, not a beam.
          if ((k + j + i) % 2) continue;
          for (let r = 0; r < 1 && n < max; r++) {
            const te = F.t;
            const age = t - te;
            if (age < 0 || age > LIFE) continue;
            const q = new THREE.Quaternion(S.q[1], S.q[2], S.q[3], S.q[0]);
            const from = new THREE.Vector3(...S.p).addScaledVector(new THREE.Vector3(...normals[j]).applyQuaternion(q), 6);
            // Lead the target by the flight time (relative velocity); a little dispersion.
            const rel = new THREE.Vector3(...aimV).sub(new THREE.Vector3(...S.v));
            const d0 = from.distanceTo(tmp.set(...aimP));
            tmp.addScaledVector(rel, d0 / V);
            dir.copy(tmp).sub(from).normalize();
            const sp = 0.012;
            dir.x += (hash(k, i, j, r) - 0.5) * sp; dir.y += (hash(k, i, j, r + 7) - 0.5) * sp; dir.z += (hash(k, i, j, r + 13) - 0.5) * sp;
            dir.normalize();
            const reach = Math.min(RANGE, d0 * 1.15 + 100);
            if (age * V > reach) continue;
            const vel = dir.clone().multiplyScalar(V).add(new THREE.Vector3(...S.v));
            const head = from.clone().addScaledVector(vel, age);
            const len = Math.min(age * V, Math.max(18, this.screenScale(head, 0.008, 1)));
            const tail = head.clone().addScaledVector(dir, -len);
            pos.set([tail.x, tail.y, tail.z, head.x, head.y, head.z], n * 6);
            // Bright head, team-tinted tail; fading over the last part of the reach.
            const f = Math.min(1, (reach - age * V) / 250);
            const c = TEAM[i];
            col.set([c.r * 0.35 * f, c.g * 0.35 * f, c.b * 0.35 * f, (0.55 + 0.45 * c.r) * f, (0.55 + 0.45 * c.g) * f, (0.55 + 0.45 * c.b) * f], n * 6);
            n++;
          }
        }
      }
    }
    writeSegs(this.tracers, pos, col, n);
    this.tracerCount = n;
  }

  // Impact marker: a crisp ring expanding on the camera plane plus a short burst of spokes —
  // a diagram of a hit, not a fireball. `size` is the final ring as a fraction of screen height.
  flash(pos, color, size = 0.03, life = 0.5, delay = 0) {
    const grp = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    const spokes = [];
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + 0.2; spokes.push(new THREE.Vector3(Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0), new THREE.Vector3(Math.cos(a) * 0.7, Math.sin(a) * 0.7, 0)); }
    const burst = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(spokes), new THREE.LineBasicMaterial({ color: WHITE, transparent: true }));
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.18, 16), new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, depthWrite: false }));
    grp.add(ring, burst, dot);
    grp.position.copy(pos);
    this.root.add(grp);
    grp.visible = delay <= 0;
    this.fx.push({ obj: grp, born: this._now + delay, life, tick: (k, o, sc) => {
      if (k < 0) { o.visible = false; return; }
      o.visible = true;
      o.quaternion.copy(sc.camera.quaternion);
      const e = 1 - (1 - k) ** 3;
      o.scale.setScalar(sc.screenScale(pos, size * (0.35 + 0.65 * e), 1));
      ring.material.opacity = 1 - k; burst.material.opacity = Math.max(0, 1 - 2 * k); dot.material.opacity = Math.max(0, 1 - 3 * k);
    } });
  }
  streak(a, b, color, life = 0.6) {
    const obj = line2(color, 3, 1);
    setLine(obj, [a, b]);
    this.root.add(obj);
    this.fx.push({ obj, born: this._now, life, tick: (k, o) => { o.material.opacity = 1 - k; o.material.linewidth = 3 * (1 - k) + 1; } });
  }

  render(now) {
    this._now = now;
    this.composer.render();
  }
}
