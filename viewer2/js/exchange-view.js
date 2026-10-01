// Outcomes are revealed only after the exchange closes. Live advantage uses past hits.
export function exchangeView(exchanges, t, endT = Infinity, hold = 6) {
  const wins = [0, 0];
  let latest = null;
  let active = null;
  for (const x of exchanges) {
    const called = x.t1 + 1.5;
    if (called <= t) {
      if (x.winner !== null) wins[x.winner]++;
      if (x.t1 < endT - .5) latest = x;
    } else if (x.t0 <= t && !active) active = x;
  }
  if (t >= endT) return {wins, exchange:null, phase:'idle', status:['idle','idle']};
  if (latest && t < latest.t1 + 1.5 + hold) {
    const status = latest.winner === null ? ['even','even'] : [0,1].map(i => i === latest.winner ? 'won' : 'lost');
    return {wins, exchange:latest, phase:'result', status};
  }
  if (active) {
    const score = [0,0];
    for (const hit of active.hits) if (hit.t <= t) score[hit.who] += hit.p;
    const diff = score[0] - score[1];
    const status = Math.abs(diff) < 1 ? ['trading','trading'] : [0,1].map(i => i === (diff > 0 ? 0 : 1) ? 'edge' : 'trading');
    return {wins, exchange:active, phase:'live', status};
  }
  return {wins, exchange:null, phase:'idle', status:['idle','idle']};
}
