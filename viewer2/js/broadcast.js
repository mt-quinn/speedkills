// Pure, current-state broadcast facts. Never consult a future event for live analysis.
export function defence(raw) {
  const mounts = raw.pdc.filter((p, k) => raw.parts[7 + k] > 0);
  const loaded = mounts.filter((p) => p[0] > 0);
  return { ammo: mounts.reduce((s, p) => s + p[0], 0), hot: loaded.filter((p) => p[4]).length, loaded: loaded.length, working: mounts.length };
}
export function tactical(raws, names, torpedoes = []) {
  for (let i = 0; i < 2; i++) {
    if (!raws[i].alive) continue;
    const incoming = torpedoes.filter((tp) => tp.owner !== i && Math.hypot(...tp.p.map((x,k) => x - raws[i].p[k])) < 2500);
    if (!incoming.length) continue;
    const d = defence(raws[i]);
    return `${incoming.length} torpedo${incoming.length === 1 ? '' : 'es'} closing on ${names[i]} · ${!d.loaded || !d.working ? 'defence unavailable' : d.hot === d.loaded ? 'defence is cooling' : 'can point defence hold?'}`;
  }
  for (let i = 0; i < 2; i++) {
    const r = raws[i], d = defence(r);
    if (!r.alive) continue;
    if (!d.working || !d.loaded) return `${names[i]} has no point defence${raws[1-i].torps[0] > 0 && raws[1-i].parts[10] > 0 ? ' · torpedoes have an opening' : ''}`;
    if (d.hot === d.loaded) return `${names[i]} is cooling point defence · a brief opening`;
    if (r.crew.some(([state, , dose]) => state === 0 && dose > 0.75)) return `${names[i]} is near a crew g limit · can the burn continue?`;
  }
  for (let i = 0; i < 2; i++) {
    const r = raws[i], other = raws[1 - i];
    if (r.parts[11] > 0 && r.rail[0] >= 0.99 && other.rail[2] > 1.5) return `${names[i]} has a charged rail · ${names[1 - i]} is reloading`;
  }
  return '';
}
export function decisive(raw) {
  const end = raw.events.find((e) => e.k === 'end');
  const t = end?.t ?? raw.frames.at(-1).t;
  const w = end?.winner;
  const cause = raw.summary.finish_cause;
  const near = raw.events.filter((e) => e.t <= t && e.t >= t - 12);
  const hit = [...near].reverse().find((e) => e.victim === 1 - w && ['rail_hit', 'torp_hit'].includes(e.k));
  const launch = hit && raw.events.find((e) => e.id === hit.id && ['rail_fire', 'torp_launch'].includes(e.k));
  const start = Math.max(0, t - 12, Math.min(t - 4, launch?.t ?? t - 8));
  const before = [...raw.frames].reverse().find((f) => f.t < t - 0.1) || raw.frames[0];
  let story = '';
  if (w !== null && w !== undefined) {
    const loser = before.s[1 - w], survivor = before.s[w];
    const d = defence(loser);
    if (cause === 'torpedo' && (!d.loaded || !d.working)) story = 'The final torpedo struck after the defeated ship’s point defence was exhausted or disabled.';
    else if (cause === 'torpedo') story = 'The final torpedo hit ended the duel.';
    else if (cause === 'ram') story = `The collision decided it. ${raw.ships[w].name} survived the impact.`;
    else if (cause === 'railgun') story = 'The final railgun hit ended the duel.';
    else if (cause === 'pdc') story = 'Close-range point-defence fire finished the duel.';
    else story = `The recorded finish was ${end.reason}.`;
    if (survivor.hull / raw.ships[w].hull < 0.1) story += ' The winner was already below 10% hull before the finish.';
  }
  return { start, end: t + 1.4, story };
}

// Derive temporary system news from recording time, including joining mid-fight/seeking.
export function recentRestorations(events, ship, t, hold = 3.5) {
  const restored = new Map();
  for (const e of events) {
    if (e.ship !== ship || e.t > t || e.t <= t - hold) continue;
    if (e.k === 'repaired') restored.set(e.part, e.t);
    else if (e.k === 'part_lost') restored.delete(e.part);
  }
  return [...restored.keys()];
}
