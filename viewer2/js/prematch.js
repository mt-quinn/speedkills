import { geeResistance } from './gee.js';
import { portrait } from './portraits.js';
import { form, meetings } from './history.js';

// Pre-match: the two ships and their crews, the odds, and the pick. Picks and the record are
// kept on this device (localStorage), keyed by fight file.
const KEY = 'hb-picks';
const STYLE = {
  Reference: ['duelist', 'Works at 3–5 km: salvos from range, takes the medium-odds shot.'],
  Knife: ['knife fighter', 'Closes in hard: point-blank salvos, PDC brawls, sure railgun shots.'],
  Counter: ['counterpuncher', 'Patient: holds for good odds, punishes the other ship’s mistakes.'],
};
const STATION = {
  pilot: ['Pilot', 'handling — dodging, a steady gun platform'],
  gunner: ['Gunner', 'railgun accuracy and charge speed'],
  engineer: ['Engineer', 'repairs, railgun and PDC power'],
  ops: ['Ops', 'point-defence fire control'],
};

export function loadPicks() {
  try { const p = JSON.parse(localStorage.getItem(KEY) || '{}'); return p && typeof p === 'object' && !Array.isArray(p) ? p : {}; } catch (e) { return {}; }
}
export function savePicks(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* private mode */ }
}
// The record: resolved picks — right/wrong, and how the favourite/underdog calls went.
export function record(picks) {
  const r = Object.values(picks).filter((x) => x && x.pick !== undefined && x.result !== undefined);
  const right = r.filter((x) => x.result === x.pick).length;
  const fav = r.filter((x) => x.odds >= 0.5), dog = r.filter((x) => x.odds < 0.5);
  return {
    n: r.length, right, wrong: r.length - right,
    fav: [fav.filter((x) => x.result === x.pick).length, fav.length],
    dog: [dog.filter((x) => x.result === x.pick).length, dog.length],
  };
}
export function recordText(picks) {
  const r = record(picks);
  if (!r.n) return 'No picks yet';
  return `Your record ${r.right}–${r.wrong} · ${Math.round((100 * r.right) / r.n)}%`;
}

// Station skill as a 1–99 rating (50 = league average).
export const rating = (skill) => Math.max(1, Math.min(99, Math.round(50 + (skill - 1) * 180)));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SKILL = { pilot: 'Handling', gunner: 'Gunnery', engineer: 'Engineering', ops: 'Defence' };
const SKILL_NOTE = { pilot: 'Dodging · aim stability', gunner: 'Accuracy · charge speed', engineer: 'Repairs · weapon cooling', ops: 'Point-defence fire control' };

export function shipCard(side, ship, gp) {
  const st = STYLE[ship.style] || [ship.style, ''];
  const strongest = ship.crew.reduce((a, b) => a.skill > b.skill ? a : b);
  const rows = ship.crew.map((c) => {
    const [label, what] = STATION[c.station] || [c.station, ''];
    const r = rating(c.skill), h = geeResistance(c), art = portrait(c.name);
    const gbar = h / 10 * 100;
    return `<article class="pm-crew" aria-label="${esc(c.name)}, ${label}">
      <header class="pm-who"><span class="pm-st">${label}</span><b>${esc(c.name)}</b></header>
      <div class="pm-portrait" style="--portrait-color:${art.color}">
        <span role="img" aria-label="Portrait of ${esc(c.name)}" style="--portrait-url:url('assets/portraits/${art.file}')"></span>
      </div>
      <div class="pm-stats">
        <div class="pm-stat-label"><span>${SKILL[c.station] || 'Skill'}</span><b>${r}<small>/99</small></b></div>
        <div class="pm-stat" role="meter" aria-label="${esc(what)}" aria-valuemin="1" aria-valuemax="99" aria-valuenow="${r}"><i style="width:${r}%"></i></div>
        <div class="pm-stat-label pm-g"><span>Gee resistance</span><b>${h}<small>/10</small></b></div>
        <div class="pm-gbar"><i style="width:${gbar}%"></i></div>
        <div class="pm-g-note">risk reduction · no immunity</div>
      </div>
      <footer class="pm-what">${SKILL_NOTE[c.station] || esc(what)}</footer>
    </article>`;
  }).join('');
  return `<section class="pm-ship t${side}" aria-label="${esc(ship.name)} crew">
    <header class="pm-shiphead"><div><span class="pm-team">${side ? 'BLUE CORNER' : 'AMBER CORNER'}</span><h2 class="pm-name">${esc(ship.name)}</h2></div><span class="pm-doctrine">${esc(st[0])}</span></header>
    <p class="pm-style">${esc(st[1])}</p>
    <div class="pm-roster">${rows}</div>
    <div class="pm-edge"><span>CREW EDGE</span><b>${esc(SKILL[strongest.station] || strongest.station)}</b><span>${esc(strongest.name)} · ${rating(strongest.skill)}</span></div>
  </section>`;
}

// Show the pre-match screen for `entry` (from index.json, with ships and odds). Resolves when
// the viewer starts the fight.
export function showPrematch({ league, entry, pos, count, onPick }) {
  const box = document.querySelector('#prematch');
  const A = league.ships[entry.ships[0]], B = league.ships[entry.ships[1]];
  const [pa, pb] = entry.odds;
  const picks = loadPicks();
  const mine = picks[entry.file];
  const locked = mine && (mine.locked || mine.seen);
  const pct = (x) => `${Math.round(100 * x)}%`;
  box.innerHTML = `<div class="pm-card" role="dialog" aria-modal="true" aria-labelledby="pm-title">
    <div class="pm-top"><span class="pm-brand">HARD BURN <small> / FIGHT CARD</small></span><span>FIGHT ${String(pos).padStart(2, '0')} / ${String(count).padStart(2, '0')}</span></div>
    <div class="pm-heading"><h1 id="pm-title">Meet the crews.</h1><span class="pm-rec">${esc(recordText(picks))}</span></div>
    <div class="pm-vs">
      ${shipCard(0, A, league.g)}

      ${shipCard(1, B, league.g)}
    </div>
    <div class="pm-history"><span>${esc(A.name)} form: ${esc(form(A.name))}</span><span>${esc(B.name)} form: ${esc(form(B.name))}</span><small>${esc(meetings(A.name, B.name))} · device history</small></div>
    <div class="pm-question">${esc(A.style === B.style ? 'Same doctrine. Which crew can turn its strongest station into an advantage?' : A.style === 'Counter' || B.style === 'Counter' ? 'Can the counterpuncher hold range and exploit the reload?' : 'Can the knife fighter force a close-range duel before the next attack run?')}</div>
    <div class="pm-odds">
      <div class="pm-oddsbar"><i class="t0" style="width:${100 * pa}%"></i><i class="t1" style="width:${100 * pb}%"></i></div>
      <div class="pm-oddsnums"><b class="t0">${pct(pa)}</b><span>WIN PROBABILITY <small>${league.odds_fights} matchup simulations</small></span><b class="t1">${pct(pb)}</b></div>
    </div>
    <div class="pm-actions">
      ${locked ? `<div class="pm-locked">${mine.pick !== undefined ? `Your pick: <b class="t${mine.side}">${esc(mine.name)}</b>` : 'Already watched · picks closed'}</div><button type="button" class="pm-go primary" data-a="watch">Watch</button>` : `
      <button type="button" class="pm-pick t0" data-side="0">Pick ${esc(A.name.toUpperCase())}<small>${pct(pa)}</small></button>
      <button type="button" class="pm-pick t1" data-side="1">Pick ${esc(B.name.toUpperCase())}<small>${pct(pb)}</small></button>
      <button type="button" class="pm-skip" data-a="watch">Just watch</button>`}
    </div>
    <div class="pm-foot"><span>Station skill: 50 = league average</span><a href="assets/portraits/CREDITS.md" target="_blank" rel="noopener">Portraits: game-icons.net · Lorc &amp; Delapouite · CC BY 3.0</a></div>
  </div>`;
  box.hidden = false;
  box.querySelector('button')?.focus({ preventScroll: true });
  return new Promise((resolve) => {
    box.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      e.stopPropagation();
      if (b.dataset.side !== undefined) {
        const side = +b.dataset.side;
        const p = loadPicks();
        p[entry.file] = { pick: side, side, name: (side ? B : A).name.toUpperCase(), odds: entry.odds[side], locked: true, at: Date.now() };
        savePicks(p);
        if (onPick) onPick(side);
      }
      const seen = loadPicks();
      seen[entry.file] = { ...(seen[entry.file] || {}), seen: true }; savePicks(seen);
      box.hidden = true;
      resolve();
    };
  });
}

// Settle the pick for a fight once its winner is known (null = draw: counted as wrong).
export function settle(file, winner) {
  const p = loadPicks();
  if (!p[file] || p[file].pick === undefined) return null;
  if (p[file].result !== undefined) return p[file];
  p[file].result = winner === null ? -1 : winner;
  savePicks(p);
  return p[file];
}
