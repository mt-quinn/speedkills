import { geeResistance } from './gee.js';
// Broadcast furniture. Information lives where the eye already is: each ship carries a plate
// (name, what it's doing, hull, crew, what's broken, its PDC burst, its news and its radio),
// joined to the ship by a leader line. Scene objects are labelled in place (torpedo salvos,
// shrapnel). The scoreboard holds the score: clock, tug, exchanges. Fight-wide news (exchange
// results, the lead, the result) sits under the scoreboard.
import * as THREE from 'three';
import { TEAM_CSS } from './scene.js';
import { PART_LABEL } from './data.js';
import { portrait } from './portraits.js';
import { defence, tactical, decisive, recentRestorations } from './broadcast.js';
import { voiceState, voiceRequests, chooseVoice } from './voices.js';
import { SalvoLedger, magazine, shipOpportunity } from './fight-facts.js';
import { placeFightCards } from './fight-layout.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };

const PLAN = {
  'holding range': 'holding range', guns: 'guns up', juke: 'breaking hard', punish: 'going in', 'attack run': 'attack run', extend: 'extending',
  salvo: 'salvo', 'torpedo break': 'torpedo break', 'closing in': 'closing', braking: 'braking', brawl: 'charging in',
  crossing: 'crossing', coasting: 'coasting', 'rail defence': 'rail intercept', 'counter torpedo': 'counter-torpedo', pressing: 'pressing', ramming: 'ramming!', '': '—',
};
const STYLE = { Reference: 'duelist', Knife: 'knife fighter', Counter: 'counterpuncher', Striker: 'striker', Warden: 'warden' };
const BY = { railgun: 'by railgun', torpedo: 'by torpedo', pdc: 'by PDC fire', ram: 'by ramming', 'mutual ram': 'in a collision', rock: 'on the rocks', g: 'by its own burn', overcharge: 'by its own gun' };
// Systems as a viewer thinks of them: shown on the plate only when out.
const OUTS = [['drive', [0]], ['thrusters', [1, 2, 3, 4]], ['reactor', [5]], ['gun', [11]], ['PDC', [7, 8, 9]], ['tubes', [10]], ['sensors', [6]]];

export class Hud {
  constructor(match, scene, opts = {}) {
    this.m = match; this.scene = scene; this.opts = opts;
    this.systemEvents = match.events.filter(e => e.k === 'repaired' || e.k === 'part_lost');
    this.salvos = new SalvoLedger(match.events);
    this.names = match.ships.map((s) => s.name.toUpperCase());
    this.buildScoreboard();
    $('#cards').innerHTML = '';
    $('#inset').classList.remove('on');
    this.leaders = document.querySelector('#leaders');
    this.leaders.innerHTML = '';
    this.leaderLines = [0, 1].map((i) => { const l = document.createElementNS('http://www.w3.org/2000/svg', 'line'); l.setAttribute('class', `ld t${i}`); this.leaders.append(l); return l; });
    this.plates = [0, 1].map((i) => this.buildPlate(i));
    // Portrait: the plates dock at the bottom; each ship keeps a small name tag.
    this.dock = $('#dock'); this.dock.innerHTML = '';
    this.shipTags = [0, 1].map((i) => { const t = el('div', `shiptag t${i}`, this.names[i]); $('#tags').append(t); return t; });
    this.frameN = 0;
    // Scene labels: shrapnel clouds and torpedo salvos.
    this.shrapTags = [0, 1, 2].map(() => { const t = el('div', 'slabel shrap', 'shrapnel'); t.style.display = 'none'; $('#tags').append(t); return t; });
    this.mLabels = [0, 1, 2].map(() => { const t = el('div', 'mlabel'); t.style.display = 'none'; $('#tags').append(t); return t; });
    this.torpTags = [0, 1, 2, 3].map(() => { const t = el('div', 'slabel torp'); t.style.display = 'none'; $('#tags').append(t); return t; });
    this.buildLegend();
    this.callouts = []; // {text, t0, until, prio, key, node}
    this.stats = { captionsShown: 0, maxSimultaneous: 0, shortest: Infinity, chars: 0 };
    this.platePos = [null, null];
    document.querySelector('.camera-ident')?.remove();
    document.querySelectorAll('.camera-bearing').forEach(e=>e.remove());
    this.cameraIdent = el('div', 'camera-ident'); document.body.append(this.cameraIdent);
    this.bearings = [0,1].map(i=>{const tag=el('div', `camera-bearing t${i}`);tag.hidden=true;document.body.append(tag);return tag;});
    this.betMarkers=[0,1].map(i=>{const tag=el('div',`ship-backed t${i}`,'◆');tag.hidden=true;tag.setAttribute('aria-label','Ship you backed');$('#tags').append(tag);return tag;});
  }

  buildScoreboard() {
    const sb = $('#scoreboard');
    sb.innerHTML = '';
    const side = (i) => {
      const s = el('div', `sb-side t${i}`);
      const style = el('div', 'sb-style', STYLE[this.m.ships[i].style] || this.m.ships[i].style);
      const pips = el('span', 'sb-pips');
      if (i === 0) style.prepend(pips); else style.append(pips);
      (this.exPips ||= [])[i] = pips;
      // Integrity: the ship's overall condition (hull, systems, crew), draining toward the
      // centre. During an exchange, what it has lost so far is a bright chunk at the bar's end,
      // labelled; the chunk drains once the exchange is called.
      const bar = el('div', 'sb-bar');
      const fill = el('i', 'fill'), chunk = el('i', 'chunk'), pct = el('span', 'sb-pct'), delta = el('span', 'sb-delta');
      bar.append(fill, chunk, pct, delta);
      (this.bars ||= [])[i] = { fill, chunk, pct, delta, lastLoss: 0 };
      s.append(el('div', 'sb-name', this.names[i]), style, bar);
      return s;
    };
    const mid = el('div', 'sb-mid');
    this.clock = el('div', 'sb-clock', '0:00');
    this.leadTxt = el('div', 'sb-lead', 'even');
    this.barCap = el('div', 'sb-cap', 'condition · not win odds');
    // Range between the ships, and whether it's closing or opening.
    this.rangeTxt = el('div', 'sb-range');
    mid.append(this.clock, this.rangeTxt, this.leadTxt, this.barCap);
    sb.append(side(0), mid, side(1));
    document.querySelector('.tactical')?.remove();
    this.tactical = el('div', 'tactical'); sb.after(this.tactical);
  }

  // The viewer's pick, marked on the scoreboard.
  setPick(side) {
    this.pickSide = side;
    document.querySelectorAll('#scoreboard .sb-side').forEach((el, i) => {
      el.classList.toggle('picked', i === side);
      let b = el.querySelector('.sb-pick');
      if (i === side && !b) { b = el.ownerDocument.createElement('span'); b.className = 'sb-pick'; b.textContent = '◆ YOUR BET'; el.append(b); }
      if (i !== side && b) b.remove();
    });
    this.plates.forEach((P,i)=>{P.p.classList.toggle('backed',i===side);P.bet.hidden=i!==side;});
    this.shipTags.forEach((tag,i)=>tag.classList.toggle('backed',i===side));
  }

  shipRadius(st,i,cam) {
    const local=st.ships[i].pos.clone().sub(this.scene.mid).applyMatrix4(cam.matrixWorldInverse);
    return Math.max(12,Math.min(100,window.innerHeight*6*this.scene.ships[i].scale.x/(Math.max(1,-local.z)*Math.tan(THREE.MathUtils.degToRad(cam.fov/2)))));
  }

  // The plate: everything about one ship, next to the ship.
  buildPlate(i) {
    const p = el('div', `plate t${i}`);
    const head = el('div', 'pl-head');
    const name = el('span', 'pl-name', this.names[i]);
    const bet=el('span','pl-bet','◆ YOUR BET');bet.hidden=true;
    const rail = el('span', 'pl-rail', '');
    head.append(name,bet);
    const plan = el('div', 'pl-plan', '');
    const hull = el('div', 'pl-hull'); const hullFill = el('i'); const hullTxt = el('span');
    hull.append(el('b', null, 'hull'), hullFill, hullTxt);
    const meta = el('div', 'pl-meta');
    const crew = el('span', 'pl-crew');
    const dots = this.m.ships[i].crew.map((c) => {
      const d = el('i', 'crew-face'), art = portrait(c.name);
      d.style.setProperty('--portrait-url', `url('assets/portraits/${art.file}')`);
      d.style.setProperty('--portrait-color', art.color);
      d.setAttribute('role', 'img'); d.tabIndex = 0;
      crew.append(d); return d;
    });
    const ammo = el('span', 'pl-ammo', '');
    const weapons=['RAIL','TORP','PDC'].map(label=>{
      const cell=el('span','pl-weapon'),key=el('small',null,label),value=el('b'),state=el('em');
      cell.append(key,value,state);ammo.append(cell);return{cell,value,state};
    });
    meta.append(plan,crew);
    const action=el('div','pl-action'),mounts=el('span','pl-mounts');action.append(rail,mounts);
    const signal=el('div','pl-signal');
    const outs = el('div', 'pl-outs');
    const restored = el('div', 'pl-restored');
    restored.setAttribute('role', 'status');
    const acc = el('div', 'pl-acc');
    const flag = el('div', 'pl-flag');
    const chat = el('div', 'pl-chat');
    p.append(head,hull,meta,ammo,action,signal,outs,restored,flag,chat);
    $('#tags').append(p);
    return { p, bet, weapons, signal, mounts, rail, plan, hullFill, hullTxt, dots, ammo, outs, restored, acc, flag, chat, flagState: null, lastOuts: '', lastAmmo: '' };
  }

  // What you're looking at: the scene's visual language, for the opening seconds.
  buildLegend() {
    const lg = $('#legend');
    lg.innerHTML = `
      <span><svg viewBox="0 0 24 12"><path d="M2 6 L20 2 L16 6 L20 10 Z" fill="currentColor"/></svg>ship · flame = thrust</span>
      <span><svg viewBox="0 0 24 12"><line x1="1" y1="6" x2="9" y2="6" stroke="currentColor" stroke-width="2.4"/><path d="M15 2h-2v2M21 2h2v2M15 10h-2v-2M21 10h2v-2" fill="none" stroke="#ff3b5c" stroke-width="1.4"/></svg>railgun charge · lock</span>
      <span><svg viewBox="0 0 24 12"><path d="M4 6 L14 2 L11 6 L14 10 Z" fill="#fff"/><line x1="14" y1="6" x2="23" y2="6" stroke="currentColor" stroke-width="1.5" opacity=".6"/></svg>torpedo</span>
      <span><svg viewBox="0 0 24 12"><path d="M1 10 Q12 -3 23 10" fill="none" stroke="#fff" stroke-width="1.6" stroke-dasharray="3 3"/></svg>PDC rounds</span>
      <span><svg viewBox="0 0 24 12"><g stroke="#ffa070" stroke-width="1.4"><line x1="3" y1="3" x2="7" y2="4"/><line x1="10" y1="8" x2="14" y2="9"/><line x1="15" y1="2" x2="19" y2="3"/><line x1="6" y1="9" x2="9" y2="10"/></g></svg>shrapnel</span>
      <span><svg viewBox="0 0 24 12"><line x1="12" y1="0" x2="12" y2="12" stroke="currentColor" stroke-width="1.2"/><ellipse cx="12" cy="11" rx="5" ry="1.4" fill="none" stroke="currentColor"/></svg>height above the plane</span>
      <span><svg viewBox="0 0 24 12"><rect x="1" y="4" width="14" height="4" fill="#f5a623"/><rect x="15" y="3" width="6" height="6" fill="#fff"/></svg>top bars: ship condition · white = lost this exchange</span>`;
    this.legend = lg;
  }

  // Fight-wide news under the scoreboard: exchange results, the lead, the result. `text` may be
  // a function of a count (repeats under one `key` update in place).
  say(t, text, { prio = 1, key = null, team = null, hold = 2.2 } = {}) {
    // (Two-line callouts: {head, sub}.)
    if (text && typeof text === 'object') { const { head, sub } = text; text = head + '\n' + sub; }
    const fmt = typeof text === 'function' ? text : () => text;
    if (key) {
      const ex = this.callouts.find((c) => c.key === key && c.until > t);
      if (ex) { ex.n += 1; ex.text = fmt(ex.n); ex.until = t + hold; ex.node.textContent = ex.text; return; }
    }
    const fresh = this.callouts.filter((c) => t - c.t0 < 1.6);
    if (prio <= 1 && fresh.length) return;
    // Spacing: lines start at least 5 s apart; news that can't get a slot within 3 s is dropped
    // (the result always goes through).
    if (prio === 2 && t - (this.lastSayT ?? -99) < 5) { (this.pending ||= []).push({ t: this.pendT ?? t, text: fmt(1), opts: { prio, key, team, hold } }); return; }
    if (this.callouts.length >= 1 && prio < 5) {
      const old = this.callouts[0];
      if (t - old.t0 < 1.6 && old.prio >= prio) { (this.pending ||= []).push({ t: this.pendT ?? t, text: fmt(1), opts: { prio, key, team, hold } }); return; }
      this.callouts = [];
      this.retire(old, t);
    }
    const node = el('div', `callout${team !== null && team !== undefined ? ' t' + team : ''}${prio >= 5 ? ' big' : ''}`);
    const [l1, l2] = fmt(1).split('\n');
    node.textContent = l1;
    if (l2) node.append(el('small', null, l2));
    $('#callouts').append(node);
    const c = { text: node.textContent, t0: t, until: t + hold, prio, key, node, n: 1 };
    this.lastSayT = t;
    this.count(t, prio, node.textContent);
    this.callouts.push(c);
  }
  count(t, prio, text) {
    (this.stats.log ||= []).push([+t.toFixed(1), prio, text]);
    this.stats.captionsShown++;
    this.stats.chars += text.length;
  }
  retire(c, t, clearing = false) {
    if (!clearing) this.stats.shortest = Math.min(this.stats.shortest, t - c.t0);
    c.node.classList.add('out');
    setTimeout(() => c.node.remove(), 400);
  }

  // News about one ship, on its plate: a death, a vital system out, the pilot out, the gun
  // burned. One at a time per plate; a same-moment follow-up joins the line ("· DRIVE OUT");
  // a flag under 1.6 s old is replaced only by more important news (deaths), and news that
  // can't show within 3 s is dropped.
  flag(t, i, text, { prio = 2, hold = 3, key = null } = {}) {
    const P = this.plates[i], f = P.flagState;
    const wait = () => (this.flagPending ||= []).push({ t: this.pendT ?? t, i, text, opts: { prio, hold, key } });
    if (f && t < f.until) {
      if (key && f.key === key) { f.text = key.startsWith('intercept:') ? text : f.text + ' · ' + text; P.flag.textContent = f.text; f.until = t + hold; return; }
      // Never cut a fresh flag short; deaths wait for it, lesser news waits its turn.
      if (t - f.t0 < 1.6 || prio < f.prio) { wait(); return; }
      this.stats.shortest = Math.min(this.stats.shortest, t - f.t0);
    }
    // Spacing: a plate's system news starts at least 4 s apart (deaths exempt).
    if (prio < 3 && t - (P.lastFlagT ?? -99) < 4) { wait(); return; }
    P.lastFlagT = t;
    P.flagState = { t0: t, until: t + hold, prio, key, text };
    P.flag.textContent = text;
    P.flag.classList.remove('on'); void P.flag.offsetWidth; P.flag.classList.add('on');
    P.flag.classList.toggle('death', prio >= 3);
    this.count(t, prio, `[${this.names[i]}] ${text}`);
  }

  onEvents(t, evs, st) {
    const N = this.names;
    this.endT ??= (this.m.events.find((e) => e.k === 'end') || { t: Infinity }).t;
    for (const e of evs) {
      (this.voiceEvents ||= [[], []]);
      if (e.ship !== undefined) this.voiceEvents[e.ship].push(e);
      switch (e.k) {
        // Hits are shown in the scene (the ring on the ship) and on the tug; text is for
        // consequences — what broke, who died — on the victim's plate.
        case 'torp_hit': case 'rail_hit': case 'debris_hit': case 'pdc_hit':
          this.lastHit = { t: e.t, victim: e.victim, kind: { rail_hit: 'railgun', debris_hit: 'shrapnel', torp_hit: 'torpedo', pdc_hit: 'PDC' }[e.k] };
          break;
        case 'part_lost': case 'crew_killed': {
          // Systems lost show in the plate's outs row, which lights up (and on the radio); the
          // flag is for deaths.
          if (e.k === 'part_lost') break;
          if (e.t >= this.endT - 1e-3) break;
          if (e.k === 'part_lost' && e.part === 'railgun' && this.overT && Math.abs(this.overT[e.ship] - e.t) < 1e-3) break; // (said by the overcharge flag)
          const lh = this.lastHit && Math.abs(this.lastHit.t - e.t) < 1e-3 && this.lastHit.victim === e.ship ? this.lastHit : null;
          const what = e.k === 'part_lost' ? `${e.part === 'railgun' ? 'gun' : PART_LABEL[e.part] || e.part} out` : `${this.m.ships[e.ship].crew[e.crew].name} killed · ${({pilot:'flight computer takes over',gunner:'rail accuracy impaired',engineer:'repairs lost',ops:'defence control impaired'})[this.m.ships[e.ship].crew[e.crew].station]}`;
          this.flag(t, e.ship, lh ? `${what} · ${lh.kind}` : what, { prio: e.k === 'crew_killed' ? 3 : 2, key: 'hit' + e.t, hold: 3 });
          break;
        }
        case 'blackout': {
          const who = this.m.ships[e.ship].crew[e.crew];
          if (who.station === 'pilot' && e.t < this.endT) this.flag(t, e.ship, 'pilot blacked out', { prio: 2, hold: 2.6 });
          break;
        }
        case 'defensive_shot':
          this.flag(t, e.ship, e.weapon === 'railgun' ? 'railgun intercept fired' : 'counter-torpedo launched', { prio: 2, hold: 2.8, key: `intercept:${e.target}` });
          break;
        case 'torp_intercept':
          this.flag(t, e.by, e.weapon === 'railgun' ? 'railgun stopped torpedo' : 'counter-torpedo hit', { prio: 2, hold: 3, key: `intercept:${e.id}` });
          break;
        case 'overcharge': (this.overT ||= [-1, -1])[e.ship] = e.t; if (e.burned) this.flag(t, e.ship, 'gun burned out · overcharge', { prio: 2, hold: 2.6 }); break;
        case 'end': {
          for (const c of this.callouts) this.retire(c, t, true);
          this.callouts = [];
          const w = e.winner;
          this.say(t, w === null ? `Draw · ${e.reason}` : `${N[w]} wins · ${e.reason}`, { team: w, prio: 5, hold: 1.4 });
          break;
        }
      }
    }
  }

  // Radio chatter: short crew lines under each plate — plan changes and events, by the crew
  // member who'd say it. Sparse by rule: one line per ship at most every 6 s, shown for 2.6 s.
  chatterFor(t, i, r) {
    this.chatState ??= [voiceState(), voiceState()];
    const cs = this.chatState[i], node = this.plates[i].chat;
    const finished = t >= (this.endT ?? Infinity);
    if (t > cs.until || !r.alive || finished || (cs.speaker !== undefined && r.crew[cs.speaker][0] !== 0)) { node.classList.remove('on'); node.replaceChildren(); }
    if (finished || !this.voiceEnabled) return;
    const events = this.voiceEvents?.[i] || [];
    if (this.voiceEvents) this.voiceEvents[i] = [];
    const ids = voiceRequests(cs, r, this.m.ships[i].crew, events);
    if (t < (this.radioNext ?? -1)) return;
    const v = chooseVoice(cs, t, r, this.m.ships[i].crew, ids, this.voiceVariations?.() || {});
    if (!v) return;
    node.replaceChildren(el('b', null, v.who.name + ':'), document.createTextNode(` “${v.line}”`));
    node.classList.remove('on'); void node.offsetWidth; node.classList.add('on');
    this.radioNext = t + 3;
    this.stats.chatter = (this.stats.chatter || 0) + 1;
    this.onVoice?.(v, i);
  }

  // Exchange results: announced 1.5 s after each ends (not the last one — the result card has
  // it), and tallied as pips on the scoreboard.
  exchanges(t) {
    const last = this.lastExT;
    this.lastExT = t;
    const won = [0, 0];
    const lead = (tt) => { const h = this.m.healthAt(tt), d = h[0] - h[1]; return Math.abs(d) < 0.03 ? null : d > 0 ? 0 : 1; };
    for (const x of this.m.exchanges) {
      const at = x.t1 + 1.5;
      if (at <= t && x.winner !== null) won[x.winner]++;
      // (Only when crossing the moment in playback: a seek doesn't replay old news.)
      if (last === undefined || t - last > 1 || !(at > last && at <= t) || x.t1 >= this.endT - 0.5) continue;
      const before = lead(Math.max(0, x.t0 - 0.5)), after = lead(at);
      const swung = after !== null && after !== before;
      // Small exchanges count on the tally but get a line only if they swung the lead.
      if (x.dmg[0] + x.dmg[1] < 8 && !swung) continue;
      // Stated as what each ship lost (of its whole condition), the winner first.
      const lost = [x.dmg[1], x.dmg[0]].map((v) => Math.max(1, Math.round(v)));
      const kind = x.kind.toUpperCase();
      const head = x.winner === null ? `${kind} ${x.n} · even` : `${this.names[x.winner]} wins ${kind} ${x.n}`;
      const order = x.winner === 1 ? [1, 0] : [0, 1];
      const sub = order.map((i) => `${this.names[i]} lost ${lost[i]}%`).join(' · ') + (swung ? ` · ${this.names[after]} gains condition edge` : '');
      this.say(t, { head, sub }, { team: x.winner, prio: 2, key: 'ex', hold: 3.4 });
    }
    for (let i = 0; i < 2; i++) { const s = '■'.repeat(won[i]); if (this.exPips[i].textContent !== s) this.exPips[i].textContent = s; }
  }

  // Story beat: the lead changing hands (during an exchange it's told with the exchange).
  leadBeat(t) {
    const h = this.m.healthAt(t);
    const d = h[0] - h[1];
    const now = d > 0.03 ? 0 : d < -0.03 ? 1 : this.leader ?? null;
    if (this.leader !== undefined && this.leader !== null && now !== null && now !== this.leader && !this.m.exchangeAt(t) && t < this.endT) {
      this.say(t, `${this.names[now]} takes the condition edge`, { team: now, prio: 2, key: 'lead', hold: 2.6 });
    }
    if (now !== null) this.leader = now;
  }

  // The result card: who won, how and when, and the fight in a few numbers each.
  showResult(t) {
    const box = $('#result');
    if (this.liveNetwork) { box.hidden = true; return; }
    // (From the recorded end — however playback got here, live or by seeking.)
    if (this.replay || t < this.endT + 1.4) { box.hidden = true; return; }
    if (!box.hidden) return;
    const m = this.m, ev = m.events, end = ev.find((e) => e.k === 'end');
    const w = end.winner;
    const stat = (i) => {
      const dealt = ev.filter((e) => e.k === 'damage' && e.ship === 1 - i && (e.hull >= 50 || e.parts >= 0.25 || e.crew > 0)).length;
      const torps = ev.filter((e) => e.k === 'torp_hit' && e.victim === 1 - i).length;
      const lost = ev.filter((e) => e.k === 'crew_killed' && e.ship === i).length;
      const exw = m.exchanges.filter((x) => x.winner === i).length;
      return [['exchanges won', `${exw}/${m.exchanges.length}`], ['hits', dealt], ['torpedoes through', torps], ['crew lost', lost], ['crew alive at finish', m.ships[i].crew.filter((c, k) => m.raw.frames.at(-1).s[i].crew[k][0] !== 2).map((c) => c.name).join(', ') || 'none']];
    };
    const mm = Math.floor(end.t / 60), ss = String(Math.floor(end.t % 60)).padStart(2, '0');
    const how = { destroyed: 'destroyed', 'crew dead': 'crew lost', 'dead in space': 'dead in space', time: 'on points', 'broke off': 'broke off', 'both disabled': 'both disabled · decided on condition' }[end.reason] || end.reason;
    const cause = m.raw.summary.finish_cause;
    this.decisive = decisive(m.raw);
    this.onFinish?.();
    box.innerHTML = `<div class="res-head ${w === null ? '' : 't' + w}">${w === null ? 'DRAW' : this.names[w] + ' WINS'}</div>
      <div class="res-sub">${w === null ? how : this.names[1 - w] + ' ' + how}${BY[cause] ? ' ' + BY[cause] : ''} · ${mm}:${ss}</div>
      ${(() => { const pr = this.pickResult && this.pickResult(); if (!pr) return ''; const ok = pr.result === pr.pick; const fav = pr.odds >= 0.5 ? 'favourite' : 'underdog';
        return `<div class="res-pick ${ok ? 'right' : 'wrong'}">${ok ? '✓ You called it' : '✗ Not this time'} · you picked <b>${pr.name}</b> (${Math.round(100 * pr.odds)}% ${fav}) · ${pr.record}</div>`; })()}
      <div class="res-story">${this.decisive.story}</div>
      <div class="res-cols">${[0, 1].map((i) => `<div class="res-col t${i}"><div class="res-name">${this.names[i]}</div>${stat(i).map(([k, v]) => `<div class="res-row"><span>${k}</span><b>${v}</b></div>`).join('')}</div>`).join('')}</div>
      <div class="res-actions">
        <button type="button" data-a="decisive">Decisive sequence</button>
        <button type="button" data-a="replay"><svg viewBox="0 0 24 24"><path d="M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/></svg>Replay</button>
        <button type="button" data-a="next" class="primary">Next fight<small>${this.fightLabel || ''}</small><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7z"/></svg></button>
      </div>`;
    box.hidden = false;
  }

  update(t, st, cam) {
    this.endT ??= (this.m.events.find((e) => e.k === 'end') || { t: Infinity }).t;
    this.leadBeat(t);
    this.showResult(t);
    for (const [key, fn] of [['pending', (q) => this.say(t, q.text, q.opts)], ['flagPending', (q) => this.flag(t, q.i, q.text, q.opts)]]) {
      const p = this[key];
      if (!p || !p.length) continue;
      this[key] = [];
      for (const q of p) if (t - q.t < 3) { this.pendT = q.t; fn(q); this.pendT = undefined; } // (stale news is dropped)
    }
    this.callouts = this.callouts.filter((c) => { if (c.until <= t) { this.retire(c, t, c.prio >= 5); return false; } return true; });
    this.stats.maxSimultaneous = Math.max(this.stats.maxSimultaneous, this.callouts.length);
    // Legend: the opening seconds only.
    this.legend.style.opacity = t < 7 ? 1 : Math.max(0, 1 - (t - 7) / 0.8);
    // Scoreboard.
    const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
    this.clock.textContent = `${mm}:${String(ss).padStart(2, '0')}`;
    const h = this.m.healthAt(t);
    const d = h[0] - h[1];
    {
      const [a, b] = st.ships;
      const sep = b.pos.clone().sub(a.pos), r = sep.length();
      const rate = -b.vel.clone().sub(a.vel).dot(sep) / Math.max(1, r); // >0 closing
      const dist = r < 995 ? `${Math.round(r / 10) * 10} m` : `${(r / 1000).toFixed(1)} km`;
      const rt = Math.abs(rate) < 20 ? '' : ` <i class="${rate > 0 ? 'cl' : 'op'}">${rate > 0 ? '▼' : '▲'} ${Math.round(Math.abs(rate) / 10) * 10} m/s</i>`;
      const html = `${dist}${rt}`;
      if (html !== this.lastRange) { this.rangeTxt.innerHTML = html; this.lastRange = html; }
    }
    this.exchanges(t);
    // The live exchange (and its call, 1.5 s after it ends): each ship's loss in it so far.
    const ex = t <= this.endT + 0.5 ? this.m.exchangeAt(t) : null;
    const sc = ex ? this.m.exchangeScore(ex, t) : [0, 0];
    for (let i = 0; i < 2; i++) {
      const B = this.bars[i];
      const hp = st.ships[i].raw.alive ? Math.max(0, Math.min(1, h[i])) * 100 : 0;
      const loss = ex ? Math.min(100 - hp, sc[1 - i]) : 0; // (points dealt by the other ship)
      B.fill.style.width = `${hp}%`;
      B.chunk.style[i === 0 ? 'left' : 'right'] = `${hp}%`;
      B.chunk.style.width = `${loss}%`;
      B.chunk.classList.toggle('drain', !ex);
      const pt = st.ships[i].raw.alive ? `${Math.round(hp)}%` : 'OUT';
      if (B.pct.textContent !== pt) B.pct.textContent = pt;
      const dt = loss >= 0.5 ? `−${Math.round(loss)}%` : '';
      if (B.delta.textContent !== dt) B.delta.textContent = dt;
    }
    if (ex && t < this.endT) {
      this.leadTxt.textContent = `exchange ${ex.n}`;
      this.leadTxt.className = 'sb-lead live';
    } else {
      this.leadTxt.textContent = t >= this.endT ? (this.m.raw.winner === null ? 'draw' : `${this.names[this.m.raw.winner]} wins`) : Math.abs(d) < 0.03 ? 'condition even' : `${this.names[d > 0 ? 0 : 1]} condition edge`;
      this.leadTxt.className = `sb-lead ${t >= this.endT ? (this.m.raw.winner === null ? '' : 't' + this.m.raw.winner) : Math.abs(d) < 0.03 ? '' : 't' + (d > 0 ? 0 : 1)}`;
    }
    const ended = t >= this.endT;
    this.liveTorpedoes=this.m.objects(t,'tp');
    this.currentRaws=st.ships.map(s=>s.raw);
    this.tactical.textContent = this.replay ? 'REPLAY · DECISIVE SEQUENCE' : ended || this.callouts.length ? '' : tactical(st.ships.map((s) => s.raw), this.names, this.m.objects(t, 'tp').map((tp) => ({owner:tp.owner,p:tp.pos.toArray(),intercept:tp.extra})));
    for (let i = 0; i < 2; i++) this.fillPlate(t, i, st.ships[i].raw, ended);
    const portrait = document.body.classList.contains('portrait');
    const shot = this.scene.shot;
    if (shot && this.cameraIdent.dataset.rig !== `${shot.id}:${shot.manual}`) {
      this.cameraIdent.innerHTML = `<b>CAM ${shot.id}</b><span>${shot.manual ? 'MANUAL' : shot.name}</span>`;
      this.cameraIdent.dataset.rig = `${shot.id}:${shot.manual}`;
    }
    if (this.scene.cameraCut) this.platePos = [null, null];
    for (let i=0;i<2;i++) {
      const p=st.ships[i].pos.clone().sub(this.scene.mid).project(cam);
      const off=p.z>1||p.z < -1||Math.abs(p.x)>.97||Math.abs(p.y)>.88;
      this.bearings[i].hidden=!off;
      if(off) {
        const angle=Math.atan2(-p.y,p.x)+(p.z>1?Math.PI:0), arrows=['→','↘','↓','↙','←','↖','↑','↗'];
        const arrow=arrows[(Math.round(angle/(Math.PI/4))+8)%8];
        const distance=st.ships[i].pos.distanceTo(st.ships[1-i].pos);
        this.bearings[i].textContent=`${i===this.pickSide?'◆ ':''}${arrow} ${this.names[i]} · ${(distance/1000).toFixed(1)} km`;
      }
      const visible=p.z>-1&&p.z<1&&Math.abs(p.x)<.98&&Math.abs(p.y)<.95;
      this.betMarkers[i].hidden=i!==this.pickSide||!visible;
      const markerRadius=this.shipRadius(st,i,cam)+8;
      this.betMarkers[i].style.width=this.betMarkers[i].style.height=`${markerRadius*2}px`;
      this.betMarkers[i].style.transform=`translate(${((p.x+1)*window.innerWidth/2-markerRadius).toFixed(1)}px,${((1-p.y)*window.innerHeight/2-markerRadius).toFixed(1)}px)`;
    }
    if (portrait) this.placeDocked(st, cam); else this.placePlates(st, cam);
    if (this.frameN++ % 10 === 0 || !this.scene.stage) this.measureStage(portrait);
    this.placeLabels(t, st, cam);
  }

  fillPlate(t, i, r, ended) {
    const P = this.plates[i], ms = this.m.ships[i];
    const lost = ended && this.m.raw.winner !== i && this.m.raw.winner !== null;
    const ending = { destroyed: 'destroyed', 'dead in space': 'adrift', 'crew dead': 'crew lost', 'both disabled': 'disabled' }[this.m.raw.end_reason] || 'out';
    const g = r.g;
    const plan = lost ? ending : ended ? (this.m.raw.winner === i ? 'victory' : 'stood down') : r.alive ? (PLAN[r.mode] ?? r.mode) : 'out';
    // The plan line carries the g once it's hard.
    P.plan.innerHTML = `${plan}${!ended && r.alive && g > 6 ? ` <b class="${g > 11 ? 'hot' : 'warm'}">${g.toFixed(0)} g</b>` : ''}`;
    P.p.classList.toggle('lost', lost);
    // Railgun: its charge, in the head.
    const [charge, , cooldown, ammo, over] = r.rail;
    const rtxt = ended || !r.alive || r.parts[11] <= 0 || ammo <= 0 ? '' : cooldown > 0 ? `RAIL ${(Math.ceil(cooldown * 10) / 10).toFixed(1)}s` : charge < 0.02 ? '' : charge >= 0.999 ? 'RAIL READY' : `RAIL ${Math.round(charge * 100)}%`;
    if (P.rail.textContent !== rtxt) P.rail.textContent = rtxt;
    P.rail.className = `pl-rail${charge >= 0.999 ? ' ready' : ''}${over ? ' over' : ''}`;
    const hf = Math.max(0, r.hull / ms.hull);
    P.hullFill.style.width = `${hf * 100}%`;
    P.hullFill.style.background = hf < 0.3 ? '#ff3b5c' : TEAM_CSS[i];
    P.hullTxt.textContent = `${Math.round(hf * 100)}%`;
    P.p.classList.toggle('critical-hull',hf<=.15&&r.alive);
    r.crew.forEach(([state, health, remaining], k) => {
      const c = ms.crew[k], status = state === 2 ? 'dead' : state === 1 ? 'blacked out' : health < 60 ? 'injured' : 'fit';
      P.dots[k].className = `crew-face ${state === 2 ? 'dead' : state === 1 ? 'out' : health < 60 ? 'hurt' : ''}`;
      const label = `${c.name} · ${c.station} · ${status} · gee resistance ${geeResistance(c)}/10${state===1&&this.m.raw.params?.g_model==='random-v1'?` · recovery ${remaining.toFixed(1)}s`: ''}`;
      P.dots[k].title = label; P.dots[k].setAttribute('aria-label', label);
    });
    const df = defence(r);
    P.mounts.textContent=ended?'':!df.powered?'NO POWER':`${df.loaded-df.hot}/3 PDC ready`;
    P.mounts.classList.toggle('unavailable',df.loaded===df.hot);
    const magazines=magazine(r,this.m.frames[0].s[i]);
    magazines.forEach((m,k)=>{
      const W=P.weapons[k];W.cell.className=`pl-weapon ${m.level}`;W.value.textContent=`${m.value}${m.unit}`;
      W.state.textContent=m.level==='disabled'?'OUT':m.level==='empty'?'EMPTY':m.level==='low'?'LOW':k===2&&df.hot?'HOT':'';
      W.cell.title=`${m.key}: ${m.value}${m.unit} remaining${m.level==='disabled'?' · system disabled':''}`;
    });
    P.ammo.title = `PDC reserve: total firing seconds across working mounts (${r.pdc.map((p,k) => r.parts[7+k] <= 0 ? 'out' : p[0].toFixed(1) + 's').join(' / ')}). Multiple mounts consume reserve simultaneously.`;
    const outs = OUTS.map(([label, idx]) => {
      const down = idx.filter((k) => r.parts[k] <= 0).length;
      if (!down) return null;
      return label === 'PDC' ? `PDC ${down}/3 out` : label === 'thrusters' ? (down >= 2 ? 'thrusters out' : null) : `${label} out`;
    }).filter(Boolean).join(' · ');
    if (outs !== P.lastOuts) {
      // A system newly out: the row lights up for a moment.
      const grew = outs.length > P.lastOuts.length && t > 0.5;
      P.outs.textContent = outs; P.lastOuts = outs;
      if (grew) { P.outs.classList.remove('fresh'); void P.outs.offsetWidth; P.outs.classList.add('fresh'); P.outsFreshUntil = t + 2.5; }
    }
    if (P.outsFreshUntil && t > P.outsFreshUntil) { P.outs.classList.remove('fresh'); P.outsFreshUntil = 0; }
    // Restoration news has its own green row, so it never hides a casualty warning.
    const restoration = recentRestorations(this.systemEvents, i, t).map(part => `${PART_LABEL[part] || part} restored`).join(' · ');
    if (P.restored.textContent !== restoration) P.restored.textContent = restoration;
    // PDC burst: its running tally.
    const salvo=t<=this.endT?this.salvos.at(i,t,new Set((this.liveTorpedoes||[]).map(tp=>tp.id))):null;
    const opportunity=ended?null:shipOpportunity(this.currentRaws,i,this.liveTorpedoes||[]);
    let signal=null;
    if(salvo&&(salvo.pdc||salvo.hits||salvo.other||salvo.flying)){
      signal={kind:salvo.hits?'danger':'defence',label:`PDC ${salvo.pdc}/${salvo.total} INTERCEPTED`,text:[salvo.hits?`${salvo.hits} hit`:null,salvo.other?`${salvo.other} other intercept`:null,salvo.flying?`${salvo.flying} in flight`:'salvo resolved'].filter(Boolean).join(' · ')};
      if(!salvo.pdc&&opportunity?.kind==='danger')signal=opportunity;
    }else signal=opportunity;
    if(!signal&&!ended){const low=magazines.filter(m=>m.level!=='normal');if(low.length)signal={kind:low.some(m=>m.level==='empty'||m.level==='disabled')?'danger':'reserve',label:'AMMUNITION',text:low.map(m=>`${m.key} ${m.level==='low'?'low':m.level==='empty'?'empty':'offline'}`).join(' · ')};}
    const signalKey=signal?`${signal.kind}:${signal.label}:${signal.text}`:'';
    if(P.lastSignal!==signalKey){P.lastSignal=signalKey;P.signal.replaceChildren();if(signal){P.signal.append(el('b',null,signal.label),el('span',null,signal.text));}P.signal.className=`pl-signal ${signal?.kind||''}`;}
    const f = P.flagState;
    if (f && t >= f.until) { P.flag.classList.remove('on'); P.flagState = null; this.stats.shortest = Math.min(this.stats.shortest, t - f.t0); }
    this.chatterFor(t, i, r);
  }

  // The stage: the part of the screen the overlay leaves clear, which the director frames the
  // fight into (between the scoreboard, with room for its news line, and the dock or the
  // bottom edge).
  measureStage(portrait) {
    const W = window.innerWidth, H = window.innerHeight;
    const sb = $('#scoreboard').getBoundingClientRect();
    this.tactical.style.top = `${sb.bottom + 5}px`;
    $('#result').style.top = `${sb.bottom + 8}px`;
    $('#callouts').style.top = `${sb.bottom + 5}px`;
    // (Once the result card is up, the stage is what's left under it.)
    const res = $('#result');
    const top = !res.hidden && portrait ? res.getBoundingClientRect().bottom + 8 : sb.bottom + (portrait ? 44 : H < 520 ? 4 : 10);
    const bottom = portrait ? this.dock.getBoundingClientRect().top - 40 : H - 16;
    this.scene.stage = { top, bottom: Math.max(top + 120, bottom), left: portrait ? 8 : 0, right: portrait ? W - 8 : W };
    // (The dock's top, for things that sit just above it.)
    document.documentElement.style.setProperty('--dock-top', portrait ? `${this.dock.getBoundingClientRect().top}px` : `${H}px`);
    window.__stage = this.scene.stage;
  }

  // Portrait: plates in the dock (moved there once), leaders hidden, name tags on the ships.
  placeDocked(st, cam) {
    const W = window.innerWidth, H = window.innerHeight;
    for (let i = 0; i < 2; i++) {
      const pl = this.plates[i].p;
      if (pl.parentNode !== this.dock) { this.dock.append(pl); pl.style.transform = ''; pl.style.display = ''; }
      this.leaderLines[i].style.display = 'none';
    }
    this.layoutTelemetry={docked:true,cards:this.plates.map(P=>{const r=P.p.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,fact:P.lastSignal};})};
    const P = [0, 1].map((i) => st.ships[i].pos.clone().sub(this.scene.mid).project(cam));
    const icon = H * 0.5 * this.scene.iconFrac(st);
    this.tagRects = [];
    for (let i = 0; i < 2; i++) {
      const p = P[i], o = P[1 - i], tag = this.shipTags[i];
      const on = p.z < 1 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05;
      tag.style.display = on ? '' : 'none';
      const x = (p.x * 0.5 + 0.5) * W, y = (-p.y * 0.5 + 0.5) * H;
      let dx = (p.x - o.x) * W, dy = -(p.y - o.y) * H;
      const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n;
      const w = tag.offsetWidth || 60, h = 16;
      let tx = x + dx * (icon + 10) + (dx >= 0 ? 0 : -w), ty = y + dy * (icon + 10) - h / 2;
      tx = Math.max(6, Math.min(W - 6 - w, tx));
      tag.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px)`;
      this.tagRects.push({ x: tx + w / 2, y: ty + h / 2, w, h, visible: on });
    }
  }

  // Plates sit beside their ship, on the side away from the other ship, joined by a leader;
  // kept on screen and clear of the scoreboard and of each other; eased so they don't jitter.
  placePlates(st, cam) {
    const W = window.innerWidth, H = window.innerHeight;
    const P = [0, 1].map((i) => st.ships[i].pos.clone().sub(this.scene.mid).project(cam));
    // (Before the camera is placed a projection can be non-finite: hide until it's valid.)
    const S = P.map((p) => ({ x: (p.x * 0.5 + 0.5) * W, y: (-p.y * 0.5 + 0.5) * H, on: Number.isFinite(p.x) && Number.isFinite(p.y) && p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1 }));
    if (!S.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))) { for (let i = 0; i < 2; i++) { this.plates[i].p.style.display = 'none'; this.leaderLines[i].style.display = 'none'; } this.tagRects = []; return; }
    const sizes = this.plates.map(P=>({w:P.p.offsetWidth||214,h:P.p.offsetHeight||132}));
    for(let i=0;i<2;i++){
      if(this.plates[i].p.parentNode!==$('#tags'))$('#tags').append(this.plates[i].p);
      this.shipTags[i].style.display='none';
      S[i].radius=this.shipRadius(st,i,cam);
    }
    const stage=this.scene.stage||{top:112,bottom:H-24};
    const obstacles=[];
    const projected=p=>{const q=p.clone().sub(this.scene.mid).project(cam);return q.z>-1&&q.z<1?{x:(q.x+1)*W/2,y:(1-q.y)*H/2}:null;};
    for(const tp of this.liveTorpedoes||[]){const q=projected(tp.pos);if(q)obstacles.push({x:q.x-16,y:q.y-16,w:32,h:32,weight:18000});}
    for(const node of [$('#callouts'),this.tactical,$('#result')])if(node&&!node.hidden&&node.textContent.trim()){
      const r=node.getBoundingClientRect();if(r.width&&r.height)obstacles.push({x:r.x,y:r.y,w:r.width,h:r.height,weight:30000});
    }
    const layout=placeFightCards({ships:S,sizes,bounds:{left:12,right:W-12,top:stage.top+8,bottom:H-38},obstacles,previous:this.platePos});
    this.layoutTelemetry={score:layout.score,blocked:layout.blocked,cards:layout.cards,facts:this.plates.map(P=>P.lastSignal)};
    this.tagRects=[];
    for(let i=0;i<2;i++){
      const r=layout.cards[i],prev=this.platePos[i];
      let q={...r};
      if(prev&&!this.scene.cameraCut&&Math.hypot(prev.x-r.x,prev.y-r.y)<80){
        const smooth={...r,x:prev.x+(r.x-prev.x)*.25,y:prev.y+(r.y-prev.y)*.25};
        const safe=!S.some(s=>s.on&&smooth.x<s.x+s.radius+14&&smooth.x+smooth.w>s.x-s.radius-14&&smooth.y<s.y+s.radius+14&&smooth.y+smooth.h>s.y-s.radius-14);
        const other=layout.cards[1-i];
        const separate=smooth.x>=other.x+other.w||smooth.x+smooth.w<=other.x||smooth.y>=other.y+other.h||smooth.y+smooth.h<=other.y;
        if(safe&&separate)q=smooth;
      }
      this.platePos[i]=q;
      const pl=this.plates[i].p;pl.style.display='';pl.classList.toggle('edge-docked',r.docked||!S[i].on);
      pl.style.transform=`translate(${q.x.toFixed(1)}px,${q.y.toFixed(1)}px)`;
      this.tagRects.push({x:q.x+r.w/2,y:q.y+r.h/2,w:r.w,h:r.h,visible:true});
      const s=S[i],tx=Math.max(q.x,Math.min(q.x+r.w,s.x)),ty=Math.max(q.y,Math.min(q.y+r.h,s.y));
      const L=Math.hypot(tx-s.x,ty-s.y)||1,sx=s.x+(tx-s.x)/L*Math.min(L,s.radius+5),sy=s.y+(ty-s.y)/L*Math.min(L,s.radius+5);
      const ln=this.leaderLines[i];ln.setAttribute('x1',sx.toFixed(1));ln.setAttribute('y1',sy.toFixed(1));ln.setAttribute('x2',tx.toFixed(1));ln.setAttribute('y2',ty.toFixed(1));
      ln.style.display=s.on&&L>s.radius+10?'':'none';
    }
  }

  // In-scene labels: torpedo salvos (per owner, torpedoes within 900 m of each other share one
  // label: count, and range once they're close) and shrapnel clouds still closing on a ship.
  placeLabels(t, st, cam) {
    const W = window.innerWidth, H = window.innerHeight;
    const scr = (p) => { const n = p.clone().sub(this.scene.mid).project(cam); return n.z < 1 && Math.abs(n.x) < 1 && Math.abs(n.y) < 1 ? { x: (n.x * 0.5 + 0.5) * W, y: (-n.y * 0.5 + 0.5) * H } : null; };
    const clear = (x, y, w = 110) => this.tagRects.filter(r=>r.visible!==false).every((r) => Math.abs(r.x - (x + w / 2)) > r.w / 2 + w / 2 || Math.abs(r.y - y) > r.h / 2 + 14);
    // Torpedo salvos.
    const groups = [];
    if (t <= this.endT) {
      for (const tp of this.m.objects(t, 'tp')) {
        const g = groups.find((q) => q.owner === tp.owner && q.defensive === (tp.extra != null) && q.pos.distanceTo(tp.pos) < 900);
        if (g) { g.n++; g.sum.add(tp.pos); g.pos = g.sum.clone().divideScalar(g.n); } else groups.push({ owner: tp.owner, defensive: tp.extra != null, n: 1, sum: tp.pos.clone(), pos: tp.pos.clone() });
      }
    }
    const tspots = [];
    for (const g of groups) {
      const s = scr(g.pos);
      if (!s || tspots.length >= this.torpTags.length) continue;
      const range = g.pos.distanceTo(st.ships[1 - g.owner].pos);
      const hot = !g.defensive && range < 2500;
      const txt = g.defensive ? 'counter-torpedo' : `${g.n > 1 ? g.n + ' torpedoes' : 'torpedo'}${hot ? ` · ${(range / 1000).toFixed(1)} km` : ''}`;
      // (Flipped to the left of the salvo near the right edge.)
      const tw = 7.2 * txt.length;
      const x = s.x + 16 + tw > W - 6 ? s.x - 16 - tw : s.x + 16, y = s.y - 22;
      if (!clear(x, y)) continue;
      tspots.push({ x, y, txt, hot, owner: g.owner });
    }
    this.torpTags.forEach((tag, k) => {
      const q = tspots[k];
      tag.style.display = q ? '' : 'none';
      if (!q) return;
      tag.style.transform = `translate(${q.x}px, ${q.y}px)`;
      if (tag.textContent !== q.txt) tag.textContent = q.txt;
      tag.className = `slabel torp t${q.owner}${q.hot ? ' hot' : ''}`;
    });
    // Shrapnel (clouds close together share a label).
    const spots = [];
    for (const d of this.scene.shrapTags || []) {
      const s = scr(d.pos);
      if (!s) continue;
      const x = s.x + 18 + 80 > W - 6 ? s.x - 18 - 80 : s.x + 18, y = s.y + 14;
      if (spots.some((q) => Math.hypot(q.x - x, q.y - y) < 120) || tspots.some((q) => Math.hypot(q.x - x, q.y - y) < 60) || !clear(x, y, 80)) continue;
      spots.push({ x, y });
    }
    this.shrapTags.forEach((tag, k) => {
      const q = spots[k];
      tag.style.display = q ? '' : 'none';
      if (q) tag.style.transform = `translate(${q.x}px, ${q.y}px)`;
    });
    // Measurement labels (centred on their point).
    const ml = this.scene.measureLabels || [];
    this.mLabels.forEach((tag, k) => {
      const d = ml[k], s = d && scr(d.pos);
      tag.style.display = s ? '' : 'none';
      if (!s) return;
      if (tag.textContent !== d.text) tag.textContent = d.text;
      tag.style.opacity = d.alpha.toFixed(2);
      tag.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -50%)`;
    });
  }
}
