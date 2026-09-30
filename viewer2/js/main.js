// Hard Burn broadcast viewer: plays back recorded duels.
import * as THREE from 'three';
import { loadIndex, loadMatch } from './data.js';
import { Scene, TEAM, THREAT } from './scene.js';
import { Director } from './director.js';
import { Hud } from './hud.js';
import { Critic } from './critic.js';
import { Audio } from './audio.js';
import { CamControl } from './camctl.js';

const Q = new URLSearchParams(location.search);
const opt = {
  match: Q.get('match'),
  t: parseFloat(Q.get('t') || '0'),
  paused: Q.get('paused') === '1',
  speed: parseFloat(Q.get('speed') || '1'),
  critic: Q.get('critic') === '1',
  audit: Q.get('audit') === '1',
  story: Q.get('story') === '1',
  auditall: Q.get('auditall') === '1',
  at: Q.get('at') ? Q.get('at').split(',').map(Number) : null,
};
window.__opt = opt;

const state = { t: 0, speed: opt.speed, paused: opt.paused, lastWall: null, idx: 0 };
let app = null;
let sound = null;
// The viewer's hand on the camera (live playback only).
const live = !opt.audit && !opt.story && !opt.auditall;
const camctl = live ? new CamControl(document.querySelector('#view')) : null;

function stateAt(m, t) { return { ships: [m.ship(t, 0), m.ship(t, 1)] }; }

class App {
  constructor(match, index, idx) {
    this.m = match; this.index = index; this.idx = idx;
    document.querySelector('#cards').innerHTML = '';
    document.querySelector('#tags').innerHTML = '';
    document.querySelector('#callouts').innerHTML = '';
    this.scene = new Scene(document.querySelector('#view'), match);
    this.dir = new Director(match, this.scene);
    this.dir.user = camctl;
    this.hud = new Hud(match, this.scene);
    this.hud.fightLabel = `${idx + 2 > index.length ? 1 : idx + 2} of ${index.length}`;
    this.critic = new Critic(match, this.scene);
    // One audio engine for the session; it follows whichever fight is open.
    if (!opt.audit && !opt.story && !opt.auditall) {
      if (sound) { sound.m = match; sound.scene = this.scene; sound.hush(); }
      else {
        sound = new Audio(match, this.scene);
        sound.onState = () => soundUI();
        // Desktop: start the audio right away (it plays where the browser allows autoplay; where
        // it doesn't, the first click or key resumes it). Phones wait for the first tap.
        if (matchMedia('(pointer: fine)').matches && (sound.musicOn || sound.sfxOn)) sound.enable();
        setTimeout(soundUI, 0);
      }
      this.audio = sound;
    }
    this.t = 0;
    document.querySelector('#title').textContent = `${match.ships[0].name} v ${match.ships[1].name}`;
  }

  // Advance match time by one display frame of `dtWall` seconds.
  step(dtWall, now, render = true) {
    const m = this.m;
    const scale = this.dir.timeScale;
    const t0 = this.t;
    // Play on a few seconds past the end (the final state held) for the kill and the result card.
    if (!state.paused) this.t = Math.min(m.duration + 6, this.t + dtWall * state.speed * scale);
    const t = this.t;
    let st = stateAt(m, t);
    this.scene.mid.copy(st.ships[0].pos).add(st.ships[1].pos).multiplyScalar(0.5);
    const evs = t > t0 ? m.eventsBetween(t0, t) : [];
    this.hud.onEvents(t, evs, st);
    this.critic.events_(evs, st);
    if (render) this.fx(evs, st, now);
    this.dir.update(t, st, dtWall * Math.max(0.55, scale));
    this.scene.update(t, st, now);
    this.hud.update(t, st, this.scene.camera);
    this.critic.frame(t, st, dtWall, scale, this.hud);
    if (render) this.scene.render(now);
    if (render && this.audio && !state.paused) this.audio.update(t, st, evs, this.dir, dtWall);
    if (opt.critic) this.showCritic();
    this.timeBadge(scale);
  }

  // How fast the broadcast is running, whenever it isn't 1×: the factor, what it is, and a meter
  // (log scale, 0.25× to 1×, the tick at 1×) so the ramp in and out of slow motion is visible.
  timeBadge(scale) {
    const rate = (state.paused ? 0 : state.speed) * scale;
    const show = state.paused || Math.abs(rate - 1) > 0.02;
    const b = document.querySelector('#timebadge');
    b.style.opacity = show ? 1 : Math.max(0, +b.style.opacity - 0.08);
    if (show) {
      b.querySelector('.tb-rate').textContent = state.paused ? '❚❚' : (rate < 1 ? rate.toFixed(2) : rate.toFixed(rate % 1 ? 1 : 0)) + '×';
      b.querySelector('.tb-lab').textContent = state.paused ? 'paused' : scale < 0.99 ? 'slow motion' : rate > 1 ? 'fast forward' : 'slowed';
      const f = rate >= 1 ? 1 : Math.max(0, 1 + Math.log(Math.max(rate, 0.25)) / Math.log(4));
      b.querySelector('.tb-meter i').style.width = (f * 100).toFixed(1) + '%';
    }
    document.querySelector('#slowvig').style.opacity = Math.min(1, (1 - scale) / 0.6).toFixed(3);
  }

  fx(evs, st, now) {
    const sc = this.scene;
    sc._now = now;
    for (const e of evs) {
      if (e.k === 'rail_fire') {
        const s = st.ships[e.ship];
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(s.quat);
        sc.flash(s.pos.clone().addScaledVector(fwd, 14 * sc.screenScale(s.pos, sc.iconFrac(st))), TEAM[e.ship], 0.025, 0.3);
      } else if (e.k === 'rail_hit') {
        const p = new THREE.Vector3(...e.pos);
        const v = st.ships[e.victim].pos.clone().sub(p).normalize();
        const k = sc.screenScale(p, sc.iconFrac(st));
        sc.flash(p, THREAT, 0.07, 0.8);
        sc.streak(p.clone().addScaledVector(v, -30 * k), p.clone().addScaledVector(v, 40 * k), new THREE.Color('#ffffff'), 0.5);
      } else if (e.k === 'torp_hit') {
        sc.flash(new THREE.Vector3(...e.pos), THREAT, 0.09, 0.9);
      } else if (e.k === 'debris_hit') {
        sc.flash(new THREE.Vector3(...e.pos), THREAT, 0.03 + 0.05 * e.share, 0.6);
      } else if (e.k === 'torp_down') {
        const tr = sc.trails.get(e.id);
        if (tr && tr.length) sc.flash(tr[tr.length - 1].p, TEAM[e.by], 0.02, 0.4);
      } else if (e.k === 'end' && e.winner !== null) {
        // The killing blow: a double ring on the loser and a brief flash frame.
        const loser = st.ships[1 - e.winner].pos;
        sc.flash(loser, THREAT, 0.16, 1.4);
        sc.flash(loser, new THREE.Color('#ffffff'), 0.1, 1.0, 0.18);
        const f = document.querySelector('#flashframe');
        f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
      } else if (e.k === 'pdc_hit') {
        sc.flash(new THREE.Vector3(...e.pos), TEAM[1 - e.victim], 0.008, 0.2);
      }
    }
  }

  // Jump to match time t: replay the director (and the HUD's memory) from the start without
  // rendering, so the camera is exactly where live playback would have put it.
  seek(t) {
    if (this.audio) this.audio.hush();
    const target = Math.max(0, Math.min(this.m.duration + 6, t));
    document.querySelector('#callouts').innerHTML = '';
    this.hud.callouts = []; this.hud.resultAt = null; this.hud.chatState = null; this.hud.lastMode = null; this.hud.pending = [];
    this.hud.flagPending = []; for (const P of this.hud.plates) { P.flagState = null; P.flag.classList.remove('on'); P.chat.classList.remove('on'); } this.hud.platePos = [null, null];
    document.querySelector('#result').hidden = true;
    this.scene.deathT = null;
    for (const f of this.scene.fx) this.scene.root.remove(f.obj);
    this.scene.fx = [];
    this.dir = new Director(this.m, this.scene);
    this.dir.user = camctl;
    this.t = 0;
    const wasPaused = state.paused;
    state.paused = false;
    const dt = 1 / 30;
    // Fast replay: only what the camera depends on (the fight's middle, the plane's slow
    // follow, the director's springs), at the rate live playback would have stepped.
    while (this.t < target - 1e-6) {
      const remaining = target - this.t;
      const k = this.dir.timeScale * state.speed;
      const dtw = Math.min(dt, remaining / Math.max(1e-6, k));
      this.t = Math.min(target, this.t + dtw * k);
      const st = stateAt(this.m, this.t);
      this.scene.mid.copy(st.ships[0].pos).add(st.ships[1].pos).multiplyScalar(0.5);
      if (this.scene.planeCenter.lengthSq() === 0) this.scene.planeCenter.copy(this.scene.mid);
      for (let j = 0; j < 2; j++) this.scene.planeCenter.lerp(this.scene.mid, 0.02); // (two 60 fps frames per step)
      this.dir.update(this.t, st, dtw * Math.max(0.55, this.dir.timeScale));
    }
    this.hud.update(this.t, stateAt(this.m, this.t), this.scene.camera);
    state.paused = wasPaused;
  }

  showCritic() {
    const r = this.critic.report(this.hud);
    const box = document.querySelector('#critic');
    box.hidden = false;
    box.textContent = Object.entries(r).map(([k, v]) => `${v.pass ? '✓' : '✗'} ${k}  ` + Object.entries(v).filter(([kk]) => kk !== 'pass' && kk !== 'missed').map(([kk, vv]) => `${kk} ${typeof vv === 'number' ? (Math.abs(vv) < 10 ? vv.toFixed(2) : vv.toFixed(0)) : vv}`).join(' · ')).join('\n') + `\n\nt ${this.t.toFixed(1)} / ${this.m.duration.toFixed(1)} · ×${(state.speed * this.dir.timeScale).toFixed(2)} · slow-mo windows ${this.dir.slowmo.length}`;
  }
}

async function open(i) {
  const index = await loadIndex();
  if (opt.auditall && i === undefined) return auditAll(index);
  const idx = opt.match !== null && i === undefined ? (isNaN(+opt.match) ? index.findIndex((x) => x.file === opt.match) : +opt.match) : (i ?? 0);
  // (?file=name.json plays a recording that isn't on the card.)
  const file = Q.get('file');
  if (file && i === undefined) { index.push({ file, seed: file }); }
  const entry = file && i === undefined ? index[index.length - 1] : index[(idx + index.length) % index.length];
  const match = await loadMatch(entry.file);
  app = new App(match, index, file && i === undefined ? index.length - 1 : (idx + index.length) % index.length);
  window.__app = app;
  if (opt.audit) return audit();
  if (opt.story) return story();
  if (opt.t > 0) app.seek(opt.t);
  state.lastWall = null;
}

// Audit: play the whole match as a 60 fps display would, without rendering; publish the report.
function audit() {
  const dt = 1 / 60;
  let guard = 0;
  while (app.t < app.m.duration - 1e-6 && guard++ < 200000) app.step(dt, guard * dt, false);
  const report = app.critic.report(app.hud);
  window.__critic = { file: app.index[app.idx].file, duration: app.m.duration, slowmo: app.dir.slowmo, report };
  document.querySelector('#critic').hidden = false;
  document.querySelector('#critic').textContent = JSON.stringify(window.__critic.report, null, 1);
}

// ---------- Storyboard: capture the key moments of a match at full resolution ----------

// The moments a viewer must be able to read: openings, the first exchanges, every slowed moment,
// lead changes, and the kill.
function keyMoments(m, dir) {
  const out = [];
  const first = (k) => m.events.find((e) => e.k === k);
  out.push({ t: 4, label: 'open' });
  const tl = first('torp_launch'); if (tl) out.push({ t: tl.t + 4, label: 'salvo-in-flight' });
  const td = first('torp_down'); if (td) out.push({ t: td.t, label: 'point-defence' });
  const rf = first('rail_fire'); if (rf) out.push({ t: rf.t - 0.6, label: 'first-charge' }, { t: rf.t + 0.12, label: 'first-shot' });
  for (const w of dir.slowmo) out.push({ t: w.at - 0.15, label: w.kill ? 'kill-incoming' : 'slowmo-before' }, { t: w.at + 0.08, label: w.kill ? 'kill' : 'slowmo-impact' });
  const h = m.health; let lead = 0;
  for (let k = 0; k < h.length; k++) {
    const d = h[k][0] - h[k][1]; const now = d > 0.03 ? 1 : d < -0.03 ? -1 : lead;
    if (lead !== 0 && now !== lead) out.push({ t: k + 0.5, label: 'lead-change' });
    lead = now;
  }
  const end = first('end'); if (end) out.push({ t: end.t + 3, label: 'result' });
  const seen = new Set();
  return out.filter((x) => x.t >= 0 && x.t <= m.duration + 6).sort((a, b) => a.t - b.t).filter((x) => { const k = Math.round(x.t * 2); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 16);
}

async function loadScript(src) {
  if (window.html2canvas) return;
  await new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.append(s); });
}

// Composite the 3D frame and the HUD, and send it to the capture server.
async function capture(name) {
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
  const gl = app.scene.renderer.domElement;
  const c = document.createElement('canvas'); c.width = gl.width; c.height = gl.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(gl, 0, 0);
  // (The page background would paint over the 3D frame: clear it for the capture.)
  const bg = [document.documentElement.style.background, document.body.style.background];
  document.documentElement.style.background = 'transparent'; document.body.style.background = 'transparent';
  const hud = await window.html2canvas(document.body, { backgroundColor: null, scale: gl.width / window.innerWidth, logging: false,
    ignoreElements: (el) => el.id === 'view' || el.id === 'critic' || el.id === 'transport' });
  document.documentElement.style.background = bg[0]; document.body.style.background = bg[1];
  ctx.drawImage(hud, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  await fetch('/capture?name=' + encodeURIComponent(name), { method: 'POST', body: blob });
}

async function story() {
  document.body.classList.add('story');
  const m = app.m;
  const moments = opt.at ? opt.at.map((t) => ({ t, label: 'at' })) : keyMoments(m, app.dir);
  const seed = app.index[app.idx].seed;
  const files = [];
  for (let k = 0; k < moments.length; k++) {
    const mo = moments[k];
    // Seek to just before, then play live for a beat so effects (flashes, trails) are present.
    app.seek(Math.max(0, mo.t - 0.6));
    const frames = 24;
    for (let i = 0; i < frames; i++) {
      const dt = Math.max(0, (mo.t - app.t)) / Math.max(1, frames - i) / Math.max(0.05, app.dir.timeScale * state.speed);
      app.step(dt, performance.now() / 1000 + i / 60, true);
      await new Promise((r) => requestAnimationFrame(r));
    }
    await new Promise((r) => setTimeout(r, 650)); // (let entrance animations finish)
    const name = `s${seed}_${String(k).padStart(2, '0')}_${mo.label}_t${mo.t.toFixed(1)}`;
    await capture(name);
    files.push(name);
  }
  window.__story = { done: true, seed, files, moments };
}

// Audit every match on the card; publish the per-match reports and the pass rate per criterion.
async function auditAll(index) {
  const all = [];
  for (let k = 0; k < index.length; k++) {
    const match = await loadMatch(index[k].file);
    app = new App(match, index, k);
    window.__app = app; window.__auditProgress = k;
    const dt = 1 / 60;
    let guard = 0;
    while (app.t < app.m.duration - 1e-6 && guard++ < 200000) app.step(dt, guard * dt, false);
    all.push({ file: index[k].file, report: app.critic.report(app.hud), slowmo: app.dir.slowmo.length });
  }
  const crit = Object.keys(all[0].report);
  const summary = Object.fromEntries(crit.map((c) => [c, all.filter((a) => a.report[c].pass).length + '/' + all.length]));
  window.__auditAll = { summary, all };
  document.querySelector('#critic').hidden = false;
  document.querySelector('#critic').textContent = JSON.stringify(summary, null, 1);
}

function loop(now) {
  requestAnimationFrame(loop);
  if (!app || opt.audit || opt.story || opt.auditall) return;
  const w = now / 1000;
  const dt = state.lastWall === null ? 1 / 60 : Math.min(0.1, w - state.lastWall);
  state.lastWall = w;
  if (camctl) camctl.frame(dt);
  app.step(dt, w, true);
  ctl.frame();
  document.querySelector('#transport-t').textContent = `${app.t.toFixed(1)}s ×${(state.speed * app.dir.timeScale).toFixed(2)}${state.paused ? ' ❚❚' : ''}`;
}

window.addEventListener('keydown', (e) => {
  if (!app) return;
  if (e.key === ' ') { state.paused = !state.paused; if (state.paused && app.audio) app.audio.hush(); e.preventDefault(); }
  else if (e.key === 'm') toggleSound();
  else if (e.key === 'ArrowRight') app.seek(app.t + 5);
  else if (e.key === 'ArrowLeft') app.seek(app.t - 5);
  else if (e.key === ']') state.speed = Math.min(8, state.speed * 2);
  else if (e.key === '[') state.speed = Math.max(0.125, state.speed / 2);
  else if (e.key === 'n') open(app.idx + 1);
  else if (e.key === 'Enter' && !document.querySelector('#result').hidden) act('next');
  else if (e.key === 'r') act('replay');
  else if (e.key === 'p') open(app.idx - 1);
  else if (e.key === 'c') { opt.critic = !opt.critic; document.querySelector('#critic').hidden = !opt.critic; }
});

// Sound starts on the first click or key (browsers require a gesture); M toggles it.
// Sound: M mutes or unmutes everything; the controls have separate music and effects toggles.
function toggleSound(force) {
  if (!sound) return;
  const on = force ?? !sound.playing;
  if (on && !sound.musicOn && !sound.sfxOn) sound.setMix({ music: true, sfx: true });
  if (on) sound.enable(); else sound.disable();
  sound.userOff = !on;
  soundUI();
}
function toggleMix(which) {
  if (!sound) return;
  // (The buttons show what's actually playing: with audio not running both read "off", so a
  // tap turns that one on and leaves the other off.)
  if (!sound.playing) sound.setMix({ music: which === 'music', sfx: which === 'sfx' });
  else sound.setMix({ [which]: !sound[which === 'music' ? 'musicOn' : 'sfxOn'] });
  // (Either on needs the audio running; both off is the same as muted.)
  if (sound.musicOn || sound.sfxOn) sound.enable(); else sound.disable();
  sound.userOff = !(sound.musicOn || sound.sfxOn);
  soundUI();
}
function soundUI() {
  if (!sound) return;
  const live = sound.playing;
  // (The hint shows whenever sound is wanted but not yet audible — held by the browser, or on a
  // phone before the first tap — unless the viewer switched it off themselves.)
  const blocked = !live && (sound.musicOn || sound.sfxOn) && !sound.userOff;
  const m = live && sound.musicOn, f = live && sound.sfxOn;
  document.querySelector('#sound').textContent = live ? 'sound on · m' : blocked ? 'click for sound' : 'sound off · m';
  const hint = document.querySelector('#soundhint');
  hint.classList.toggle('on', blocked);
  const ht = matchMedia('(pointer: coarse)').matches ? 'tap for sound' : 'click anywhere for sound';
  if (hint.lastChild.textContent !== ht) hint.lastChild.textContent = ht;
  const bm = document.querySelector('#controls [data-a=music]'), bf = document.querySelector('#controls [data-a=sfx]');
  bm.querySelector('span').textContent = m ? 'music on' : 'music off'; bm.classList.toggle('on', m); bm.setAttribute('aria-pressed', m);
  bf.querySelector('span').textContent = f ? 'effects on' : 'effects off'; bf.classList.toggle('on', f); bf.setAttribute('aria-pressed', f);
}
const firstGesture = (e) => {
  window.removeEventListener('pointerdown', firstGesture); window.removeEventListener('keydown', firstGesture);
  // (Starts the audio, or resumes it where the browser held an early start suspended.)
  if (sound && !sound.playing && !(e.key === 'm') && !(e.target && e.target.closest && e.target.closest('[data-a=music], [data-a=sfx]')) && (sound.musicOn || sound.sfxOn)) { sound.enable(); soundUI(); }
};
window.addEventListener('pointerdown', firstGesture); window.addEventListener('keydown', firstGesture);

// ---------- Layout and touch controls ----------

// Portrait (a phone held upright): docked plates, compact scoreboard, portrait framing.
function layout() {
  document.body.classList.toggle('portrait', window.innerWidth / window.innerHeight < 0.9);
  document.body.classList.toggle('touch', matchMedia('(pointer: coarse)').matches);
}
layout();
window.addEventListener('resize', layout);
window.addEventListener('orientationchange', () => setTimeout(layout, 50));

const ctl = {
  el: document.querySelector('#controls'), shown: false, hideAt: 0, dragging: false, lastTap: null, single: null,
  show() { soundUI(); this.el.classList.remove('hidden'); document.body.classList.add('ctl-open'); this.shown = true; this.poke(); this.build(); },
  hide() { this.el.classList.add('hidden'); document.body.classList.remove('ctl-open'); this.shown = false; },
  poke() { this.hideAt = performance.now() + 4000; },
  // The scrubber's marks: each exchange as a block in its winner's colour, and the kill.
  build() {
    if (!app || this.builtFor === app.m) return;
    this.builtFor = app.m;
    const m = app.m, D = m.duration + 6, marks = this.el.querySelector('.sc-marks');
    marks.innerHTML = '';
    for (const x of m.exchanges) {
      const b = document.createElement('i');
      b.className = x.winner === null ? 'even' : 't' + x.winner;
      b.style.left = (100 * x.t0 / D) + '%'; b.style.width = Math.max(0.6, 100 * (x.t1 - x.t0) / D) + '%';
      marks.append(b);
    }
    const k = document.createElement('b'); k.style.left = (100 * m.duration / D) + '%'; marks.append(k);
    document.querySelector('#ct-name').textContent = `${m.ships[0].name} v ${m.ships[1].name}`;
    document.querySelector('#ct-count').textContent = `fight ${app.idx + 1} of ${app.index.length}`;
    const d = m.duration; document.querySelector('#sc-d').textContent = `${Math.floor(d / 60)}:${String(Math.floor(d % 60)).padStart(2, '0')}`;
  },
  frame() {
    if (!this.shown || !app) return;
    if (!state.paused && !this.dragging && performance.now() > this.hideAt) return this.hide();
    this.build();
    this.el.classList.toggle('paused', state.paused);
    if (!this.dragging) this.setKnob(app.t);
    this.el.querySelector('[data-a=speed] span').textContent = `${state.speed}×`;
  },
  setKnob(t) {
    const D = app.m.duration + 6, f = Math.max(0, Math.min(1, t / D));
    this.el.querySelector('.sc-fill').style.width = (f * 100) + '%';
    this.el.querySelector('.sc-knob').style.left = (f * 100) + '%';
    const tt = Math.min(t, app.m.duration);
    document.querySelector('#sc-t').textContent = `${Math.floor(tt / 60)}:${String(Math.floor(tt % 60)).padStart(2, '0')}`;
  },
};
function act(a) {
  if (!app) return;
  ctl.poke();
  if (a === 'play') state.paused = !state.paused;
  else if (a === 'back') app.seek(app.t - 5);
  else if (a === 'fwd') app.seek(app.t + 5);
  else if (a === 'next') { ctl.builtFor = null; open(app.idx + 1); }
  else if (a === 'prev') { ctl.builtFor = null; open(app.idx - 1); }
  else if (a === 'replay') { app.seek(0); state.paused = false; }
  else if (a === 'speed') { const S = [1, 2, 4, 0.5]; state.speed = S[(S.indexOf(state.speed) + 1) % S.length] ?? 1; }
  else if (a === 'sound') toggleSound();
  else if (a === 'music' || a === 'sfx') toggleMix(a);
  if (state.paused && app.audio) app.audio.hush();
}
window.__ctl = ctl; window.__act = act;
// The result card's buttons: next fight, replay.
document.querySelector('#result').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { e.stopPropagation(); act(b.dataset.a); } });
ctl.el.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { e.stopPropagation(); act(b.dataset.a); } });
// Scrubbing: the knob follows the finger; the seek happens on release (a seek replays the
// director from the start, too heavy to run on every move).
{
  const track = ctl.el.querySelector('.sc-track');
  const tAt = (x) => { const r = track.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)) * (app.m.duration + 6); };
  track.addEventListener('pointerdown', (e) => { if (!app) return; ctl.dragging = true; track.setPointerCapture(e.pointerId); ctl.setKnob(tAt(e.clientX)); e.stopPropagation(); });
  track.addEventListener('pointermove', (e) => { if (ctl.dragging) { ctl.setKnob(tAt(e.clientX)); ctl.poke(); } });
  track.addEventListener('pointerup', (e) => { if (!ctl.dragging) return; ctl.dragging = false; app.seek(tAt(e.clientX)); ctl.poke(); e.stopPropagation(); });
  track.addEventListener('pointercancel', () => { ctl.dragging = false; });
}
// Taps on the picture: one shows or hides the controls; a double tap on the left or right third
// skips back or forward 5 s (with the same buttons in the controls, so nothing is gesture-only).
window.addEventListener('pointerup', (e) => {
  if (!app || e.target.closest('#controls') || e.target.closest('#camhud') || e.target.closest('#result')) return;
  // (A camera drag or pinch isn't a tap.)
  if (camctl && camctl.dragged) { ctl.lastTap = null; return; }
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const now = performance.now(), W = window.innerWidth;
  const zone = e.clientX < W / 3 ? 'back' : e.clientX > (2 * W) / 3 ? 'fwd' : 'mid';
  if (ctl.lastTap && now - ctl.lastTap.t < 300 && zone !== 'mid' && ctl.lastTap.zone === zone) {
    clearTimeout(ctl.single); ctl.lastTap = null;
    act(zone);
    const fx = document.querySelector('#tapfx');
    fx.textContent = zone === 'back' ? '−5 s' : '+5 s'; fx.className = 'on ' + zone; void fx.offsetWidth;
    setTimeout(() => { fx.className = ''; }, 500);
    return;
  }
  ctl.lastTap = { t: now, zone };
  clearTimeout(ctl.single);
  ctl.single = setTimeout(() => { if (ctl.shown) ctl.hide(); else ctl.show(); }, zone === 'mid' ? 0 : 260);
});

open();
requestAnimationFrame(loop);
