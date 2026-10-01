// Broadcast audio (Web Audio): event one-shots, continuous engine / railgun-charge / PDC layers
// driven by the fight's state, slow-motion treatment, and the music bed with ducking.
import * as THREE from 'three';
import { audioHost } from './audio-context.js';

const FILES = ['bgm', 'engine', 'explosion', 'pdc', 'rail_charge', 'rail_fire', 'torpedo_launch'];

// Loudness-normalise a buffer in place: gated RMS (ignoring near-silence) to -20 dBFS, but never
// pushing the peak past -1 dBFS. Returns the gain applied (dB), for the log.
function normalise(buf, target = -20) {
  let sum = 0, n = 0, peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); peak = Math.max(peak, a); if (a > 0.003) { sum += a * a; n++; } }
  }
  if (!n) return 0;
  const rms = 20 * Math.log10(Math.sqrt(sum / n));
  const g = Math.min(target - rms, -1 - 20 * Math.log10(peak));
  const k = 10 ** (g / 20);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= k; }
  return g;
}

// A buffer that loops without a click: the tail crossfaded into the head.
function loopable(ctx, buf, xf = 0.05) {
  const n = Math.floor(xf * buf.sampleRate);
  if (buf.length < n * 3) return buf;
  const out = ctx.createBuffer(buf.numberOfChannels, buf.length - n, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c), dst = out.getChannelData(c);
    dst.set(src.subarray(0, buf.length - n));
    for (let i = 0; i < n; i++) {
      const k = i / n;
      dst[i] = src[i] * k + src[buf.length - n + i] * (1 - k);
    }
  }
  return out;
}

export class Audio {
  constructor(match, scene) {
    this.m = match; this.scene = scene;
    this.enabled = false; this.ready = false; this.host = audioHost(); this.sources = [];
    let mix = null;
    try { mix = JSON.parse(localStorage.getItem('sk-audio') || 'null'); } catch (e) { /* none */ }
    this.musicOn = mix ? !!mix.music : true; this.sfxOn = mix ? !!mix.sfx : true;
    this.lastLaunch = [-1, -1];
    this.nextPdc = [0, 0];
    this.prevG = [0, 0]; this.onset = [0, 0];
    this.slowRate = 1;
    // Instrumentation: every one-shot fired, [match time, name, gain] (read from window.__app.audio.log).
    this.log = []; this.tNow = 0;
  }

  // Actually audible: switched on, and the browser has let the audio context run (most
  // browsers hold it suspended until the first click or key press).
  get playing() { return this.enabled && this.ready && (this.musicOn || this.sfxOn) && !!this.ctx && this.ctx.state === 'running' && this.sources.length > 0; }

  // Music / effects on or off (remembered on this device).
  setMix({ music = this.musicOn, sfx = this.sfxOn } = {}) {
    this.musicOn = music; this.sfxOn = sfx;
    try { localStorage.setItem('sk-audio', JSON.stringify({ music, sfx })); } catch (e) { /* private mode */ }
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    this.sfxGate.gain.setTargetAtTime(sfx ? 1 : 0, now, 0.08);
    this.bgmGate.gain.setTargetAtTime(music ? 1 : 0, now, 0.15);
  }

  enable() {
    if (this.disposed) return;
    this.enabled = true;
    // Resume synchronously inside every gesture, even while assets are still loading.
    const ctx = this.ctx = this.host.resume();
    if (!ctx) return;
    if (this.master) this.master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.1);
    if (!this.loading) this.loading = this.initialise(ctx).catch(() => {
      this.dispose(); this.onState?.();
    });
    this.onState?.();
    return this.loading;
  }

  async initialise(ctx) {
    this.stateListener = () => {
      this.onState?.();
      if (this.enabled && !this.host.muted && ['suspended', 'interrupted'].includes(ctx.state)) this.host.resume();
    };
    ctx.addEventListener('statechange', this.stateListener);
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
    this.compressor = comp;
    this.master.connect(comp).connect(ctx.destination);
    // Effects bus: a low-pass that closes in slow motion.
    this.sfx = ctx.createGain();
    this.sfxFilter = ctx.createBiquadFilter(); this.sfxFilter.type = 'lowpass'; this.sfxFilter.frequency.value = 20000;
    // Music and effects each pass a gate the viewer switches (two toggles in the controls).
    this.sfxGate = ctx.createGain(); this.sfxGate.gain.value = this.sfxOn ? 1 : 0;
    this.bgmGate = ctx.createGain(); this.bgmGate.gain.value = this.musicOn ? 1 : 0;
    this.sfx.connect(this.sfxFilter).connect(this.sfxGate).connect(this.master);
    this.bgmBus = ctx.createGain(); this.bgmBus.gain.value = 0; this.bgmBus.connect(this.bgmGate).connect(this.master);
    this.buf = {}; this.norm = {};
    await Promise.all(FILES.map(async (f) => {
      for (const ext of ['opus', 'm4a']) {
        try {
          const r = await fetch(`sfx/${f}.${ext}`);
          this.buf[f] = await ctx.decodeAudioData(await r.arrayBuffer());
          if (f !== 'bgm') this.norm[f] = +normalise(this.buf[f]).toFixed(1);
          return;
        } catch (e) { /* try the next format */ }
      }
    }));
    if (this.disposed) return;
    this.buf.engineLoop = this.buf.engine && loopable(ctx, this.buf.engine, 0.2);
    this.buf.chargeLoop = this.buf.rail_charge && loopable(ctx, this.buf.rail_charge, 0.06);
    // Continuous layers, one per ship: engine and railgun charge.
    this.layers = [0, 1].map(() => this.makeLayers());
    // Music bed.
    if (this.buf.bgm) {
      const s = ctx.createBufferSource(); s.buffer = this.buf.bgm; s.loop = true;
      s.connect(this.bgmBus); s.start(); this.sources.push(s);
      this.bgmBus.gain.setTargetAtTime(0.32, ctx.currentTime, 1.5);
    }
    this.voices = {};
    this.ready = true;
    this.master.gain.setTargetAtTime(this.enabled ? .9 : 0, ctx.currentTime, .1);
    this.onState?.();
    try {
      const response = await fetch('sfx/voices/index.json');
      if (response.ok) {
        const manifest = await response.json();
        await Promise.all(Object.entries(manifest).map(async ([id, files]) => {
          if (!Array.isArray(files)) return;
          const decoded = await Promise.all(files.map(async (file) => {
            try { const r = await fetch(`sfx/voices/${file}`); if (!r.ok) return null; const b = await ctx.decodeAudioData(await r.arrayBuffer()); normalise(b, -18); return b; } catch { return null; }
          }));
          this.voices[id] = Object.fromEntries(files.map((file, i) => [Number(file.match(/_(\d+)\./)?.[1]) - 1, decoded[i]]).filter(([k,b]) => Number.isInteger(k) && k >= 0 && b));
        }));
      }
    } catch { /* subtitles remain available without recordings */ }
  }

  disable() {
    this.enabled = false;
    if (this.master) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
    this.onState?.();
  }

  dispose() {
    this.disposed = true; this.enabled = false;
    this.ctx?.removeEventListener('statechange', this.stateListener);
    if (this.voiceSource) { try { this.voiceSource.stop(); } catch {} }
    for (const source of this.sources) { try { source.stop(); source.disconnect(); } catch {} }
    this.sources = [];
    this.master?.disconnect(); this.compressor?.disconnect();
  }

  makeLayers() {
    const ctx = this.ctx;
    const mk = (buf) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 800;
      const gain = ctx.createGain(); gain.gain.value = 0;
      const pan = ctx.createStereoPanner();
      src.connect(filt).connect(gain).connect(pan).connect(this.sfx);
      src.start(ctx.currentTime + Math.random() * 0.1); this.sources.push(src);
      return { src, filt, gain, pan };
    };
    const engine = this.buf.engineLoop ? mk(this.buf.engineLoop) : null;
    const charge = this.buf.chargeLoop ? mk(this.buf.chargeLoop) : null;
    if (charge) charge.filt.frequency.value = 12000;
    // A slow tremolo for a held full charge (capacitors straining).
    let lfo = null;
    if (charge) {
      lfo = ctx.createOscillator(); lfo.frequency.value = 7;
      const depth = ctx.createGain(); depth.gain.value = 0;
      lfo.connect(depth).connect(charge.gain.gain); lfo.start(); this.sources.push(lfo);
      charge.lfoDepth = depth;
    }
    return { engine, charge };
  }

  // Where a world point sits in the stereo field (screen x), and how loud distance leaves it.
  place(p) {
    const cam = this.scene.camera;
    const n = p.clone().sub(this.scene.mid).project(cam);
    const pan = Math.max(-1, Math.min(1, n.x)) * 0.75;
    const d = p.clone().sub(this.scene.mid).distanceTo(cam.position);
    const ref = cam.position.length() || 1;
    const att = Math.max(0.35, Math.min(1.2, 1 / (0.4 + 0.6 * (d / ref))));
    return { pan, att };
  }

  oneShot(name, { gain = 1, rate = 1, pan = 0, lowpass = 0, highpass = 0, sweep = null, when = 0 } = {}) {
    const buf = this.buf[name];
    if (!buf) return;
    if (this.log.length < 20000) this.log.push([+this.tNow.toFixed(2), name, +gain.toFixed(2)]);
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = rate * this.slowRate;
    let node = src;
    if (highpass) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = highpass; node.connect(f); node = f; }
    if (lowpass || sweep) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass || sweep[0];
      if (sweep) f.frequency.setTargetAtTime(sweep[1], ctx.currentTime + when, sweep[2]);
      node.connect(f); node = f;
    }
    const g = ctx.createGain(); g.gain.value = gain;
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    node.connect(g).connect(p).connect(this.sfx);
    src.start(ctx.currentTime + when);
  }

  voice(id, variation, side, station) {
    if (!this.playing || !this.ready || !this.sfxOn || this.voiceSource) return;
    const clip = this.voices[id]?.[variation];
    if (!clip) return;
    const src = this.ctx.createBufferSource(); src.buffer = clip;
    const gain = this.ctx.createGain(); gain.gain.value = .85;
    const pan = this.ctx.createStereoPanner(); pan.pan.value = side ? .25 : -.25;
    // Speech bypasses the slow-motion filter and never changes pitch.
    src.connect(gain).connect(pan).connect(this.sfxGate);
    this.voiceSpeaker = { side, station };
    this.voiceSource = src; src.onended = () => { if (this.voiceSource === src) this.voiceSource = null; src.disconnect(); gain.disconnect(); pan.disconnect(); };
    src.start();
  }

  // Called once per rendered frame during live playback.
  update(t, st, evs, dir, dtWall) {
    const dt = Math.min(0.1, dtWall);
    if (!this.enabled || !this.ready) return;
    const ctx = this.ctx, now = ctx.currentTime;
    this.tNow = t;
    if (this.voiceSource && (!st.ships[this.voiceSpeaker.side].raw.alive || st.ships[this.voiceSpeaker.side].raw.crew[this.voiceSpeaker.station][0] !== 0)) { this.voiceSource.stop(); this.voiceSource = null; }
    const slow = dir.timeScale < 0.99;
    // Slow motion: new sounds pitched down, the whole effects bus muffled.
    this.slowRate = slow ? 0.72 : 1;
    this.sfxFilter.frequency.setTargetAtTime(slow ? 1700 : 20000, now, slow ? 0.08 : 0.3);
    const ended = t > this.m.duration + 1e-3;
    const endT = (this.m.events.find((e) => e.k === 'end') || { t: Infinity }).t;
    // Music: ducks under slow motion, swells for the result.
    // (It also sits back while a railgun charges, so the spin-up is heard.)
    const maxCharge = ended ? 0 : Math.max(...st.ships.map((s) => (s.raw.alive ? s.raw.rail[0] : 0)));
    const bgm = this.voiceSource ? .1 : t > endT + 1.2 ? 0.45 : slow ? 0.16 : 0.32 * (1 - 0.25 * Math.min(1, maxCharge / 0.4));
    this.bgmBus.gain.setTargetAtTime(bgm, now, 0.4);
    this.sfx.gain.setTargetAtTime(this.voiceSource ? .5 : 1, now, .08);

    // ---- events ----
    for (const e of evs) {
      const at = (i) => this.place(st.ships[i].pos);
      const atP = (p) => this.place(new THREE.Vector3(...p));
      switch (e.k) {
        case 'torp_launch': {
          // A salvo is one launch sound, not three.
          if (t - this.lastLaunch[e.ship] < 0.4) break;
          this.lastLaunch[e.ship] = t;
          const { pan, att } = at(e.ship);
          this.oneShot('torpedo_launch', { gain: 0.75 * att, rate: 0.96 + Math.random() * 0.08, pan });
          break;
        }
        case 'rail_fire': {
          const { pan, att } = at(e.ship);
          this.oneShot('rail_fire', { gain: 1.0 * att, rate: 0.97 + Math.random() * 0.06, pan });
          break;
        }
        case 'rail_hit': {
          // The round striking hull: a sharp crack from the explosion, sped up and thinned.
          const { pan, att } = atP(e.pos);
          this.oneShot('explosion', { gain: 0.7 * att, rate: 1.75, pan, highpass: 350 });
          break;
        }
        case 'torp_hit': {
          const { pan, att } = atP(e.pos);
          this.oneShot('explosion', { gain: 0.95 * att, rate: 1.0, pan, lowpass: 7000 });
          break;
        }
        case 'debris_hit': {
          // Wreckage peppering the hull: a small, bright patter scaled by how much landed.
          const { pan, att } = atP(e.pos);
          this.oneShot('explosion', { gain: (0.15 + 0.7 * e.share) * att, rate: 1.55, pan, highpass: 900 });
          break;
        }
        case 'torp_down': {
          // A torpedo killed out in the dark: a distant pop.
          this.oneShot('explosion', { gain: 0.16, rate: 2.2, pan: (Math.random() - 0.5) * 0.6, highpass: 1400 });
          break;
        }
        case 'rail_vent': {
          const { pan, att } = at(e.ship);
          this.oneShot('rail_charge', { gain: 0.25 * att, rate: 0.55, pan, lowpass: 1500 });
          break;
        }
        case 'end': {
          if (e.winner === null) break;
          const loser = 1 - e.winner;
          const { pan } = at(loser);
          if (this.m.raw.end_reason === 'destroyed') {
            // The big one: the same explosion, slowed and deepened, its top end closing as it rolls.
            this.oneShot('explosion', { gain: 1.3, rate: 0.62, pan, sweep: [9000, 700, 0.8] });
            this.oneShot('explosion', { gain: 0.6, rate: 0.9, pan: pan * 0.5, when: 0.12, lowpass: 3000 });
          } else {
            // Derelict: a dull, muffled thud — the ship dies quiet.
            this.oneShot('explosion', { gain: 0.5, rate: 0.5, pan, lowpass: 450 });
          }
          break;
        }
      }
    }

    // ---- continuous layers ----
    const eng = [0, 0];
    for (let i = 0; i < 2; i++) {
      const s = st.ships[i];
      const L = this.layers[i];
      const { pan, att } = this.place(s.pos);
      const alive = s.raw.alive && !ended;
      const g = alive ? s.raw.g : 0;
      // Burn onset: a swell when thrust jumps, so changes are heard and steady burns recede.
      // (Onset from how far thrust rose over the last ~0.25 s, decaying with a 0.6 s time constant.)
      const rise = g - this.prevG[i];
      if (rise > 0) this.onset[i] = Math.min(1, this.onset[i] + (rise / 5) * (dt / 0.25));
      this.onset[i] *= Math.exp(-dt / 0.6);
      this.prevG[i] += (g - this.prevG[i]) * Math.min(1, dt / 0.25);
      eng[i] = g > 0.3 ? (0.08 + 0.34 * (1 - Math.exp(-g / 6)) + 0.6 * this.onset[i]) * att : 0;
      if (L.engine) {
        L.engine.filt.frequency.setTargetAtTime(Math.min(7000, 450 + 350 * g), now, 0.12);
        L.engine.pan.pan.setTargetAtTime(pan, now, 0.1);
        L.engine.src.playbackRate.setTargetAtTime((0.92 + 0.012 * Math.min(g, 16)) * this.slowRate, now, 0.2);
      }
      // Railgun charge: louder and higher as it fills; a held full charge wavers.
      if (L.charge) {
        const [charge] = s.raw.rail;
        const on = alive && charge > 0.02;
        const full = charge >= 0.999;
        L.charge.gain.gain.setTargetAtTime(on ? (full ? 0.38 : 0.15 + 0.25 * charge) * att : 0, now, 0.05);
        L.charge.lfoDepth.gain.setTargetAtTime(on && full ? 0.04 : 0, now, 0.1);
        L.charge.src.playbackRate.setTargetAtTime((0.85 + 0.45 * charge) * this.slowRate, now, 0.05);
        L.charge.pan.pan.setTargetAtTime(pan, now, 0.1);
      }
      // PDC bursts: the single shot retriggered on the audio clock while mounts are firing.
      const firing = alive ? s.raw.pdc.filter((p) => p[2] >= 0 || p[3] > 0).length : 0;
      if (firing > 0 && this.buf.pdc) {
        if (this.nextPdc[i] < now) this.nextPdc[i] = now;
        while (this.nextPdc[i] < now + 0.12) {
          this.oneShot('pdc', { gain: 0.13 * Math.pow(firing, 0.6) * att, rate: 0.92 + Math.random() * 0.16, pan, when: this.nextPdc[i] - now });
          this.nextPdc[i] += (0.055 + Math.random() * 0.03) / (slow ? 0.6 : 1);
        }
      }
    }
    // Two engines burning all the time mustn't wash out the mix: the louder one leads, the other
    // sits back.
    const lead = eng[0] >= eng[1] ? 0 : 1;
    this.levels = { eng: eng.map((e, i) => e * (i === lead ? 1 : 0.55)), charge: st.ships.map((s) => s.raw.rail[0]) };
    for (let i = 0; i < 2; i++) {
      const L = this.layers[i];
      if (L.engine) L.engine.gain.gain.setTargetAtTime(eng[i] * (i === lead ? 1 : 0.55), now, 0.15);
    }
  }

  // Seeking: silence the continuous layers until live playback resumes.
  hush() {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    if (this.voiceSource) { this.voiceSource.stop(); this.voiceSource = null; }
    for (const L of this.layers) {
      if (L.engine) L.engine.gain.gain.setTargetAtTime(0, now, 0.05);
      if (L.charge) { L.charge.gain.gain.setTargetAtTime(0, now, 0.05); L.charge.lfoDepth.gain.setTargetAtTime(0, now, 0.05); }
    }
    this.nextPdc = [0, 0];
  }
}
