import { geeResistance } from '../viewer2/js/gee.js';
import { crewName } from './crew-names.js';

// Whole fictional credits, stored in legacy scaled units (100 units = 1 credit).
// Every monetary value must be a multiple of 100; awards round once at source.
export const ECONOMY = Object.freeze({ starting: 50000, sponsor: 200000, tryout: 10000, rename: 5000, recovery: 5000, margin: 0.05, ownerShare: 0.01 });
export function maxBet(balance) {
  return Math.min(balance, balance < 100000 ? 10000 : balance < 200000 ? 25000 : 50000);
}
export const TIMING = Object.freeze({ betting: 60000, finishHold: 4000, results: 15000 });
export const STATIONS = ['pilot', 'gunner', 'engineer', 'ops'];
export function phase(fight, now) {
  if (!fight || fight.opensAt == null) return 'preparing';
  if (now < fight.startsAt) return 'betting';
  if (now < fight.endsAt) return 'combat';
  return 'results';
}
export function quote(stake, probability) {
  if (!Number.isSafeInteger(stake) || stake <= 0 || stake % 100 !== 0) throw new Error('Enter a positive whole-credit stake.');
  const p = Math.max(0.05, Math.min(0.95, probability));
  return Math.round(stake * (1 + (1 - ECONOMY.margin) * (1 - p) / p) / 100) * 100;
}
export function betCheck(fight, now, side, stake, balance, existing, maxStake = maxBet(balance)) {
  if (phase(fight, now) !== 'betting' || now < fight.opensAt) throw new Error('Betting has closed for this fight.');
  if (![0, 1].includes(side)) throw new Error('Choose a ship.');
  if (existing) throw new Error('Your wager is already locked.');
  if (!Number.isSafeInteger(stake) || stake < 100 || stake % 100 !== 0 || stake > balance) throw new Error('Use whole credits, at least 1 credit and within your balance.');
  if (stake > maxStake) throw new Error(`Your current maximum bet is ${Math.round(maxStake / 100)} credits per fight.`);
  return { side, stake, payout: quote(stake, fight.odds[side]) };
}
export function settlement(wager, winner) {
  const returned = winner === null ? wager.stake : wager.side === winner ? wager.payout : 0;
  return { returned, net: returned - wager.stake, profit: Math.max(0, returned - wager.stake) };
}
export function ownerIncome(profits) { return Math.round(profits.reduce((a, b) => a + b, 0) * ECONOMY.ownerShare / 100) * 100; }
export function crewLocked(shipId, fight, now) { return !!fight?.ships?.some(s => s.id === shipId) && ['betting', 'combat'].includes(phase(fight, now)); }
export function candidate(seed, station, excluded = []) {
  let n = seed >>> 0; const rand = () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; };
  rand(); // Preserve the existing skill/tolerance rolls when changing naming.
  return { name: crewName(seed, excluded), station, skill: +(0.78 + (rand() + rand() + rand()) / 3 * 0.50).toFixed(3), resistance: geeResistance({ tolerance: 0.88 + rand() * 0.27 }) };
}
export function fightStats(raw) {
  return raw.ships.map((s, side) => ({ name: s.name, railShots: raw.events.filter(e => e.k === 'rail_fire' && e.ship === side).length,
    railHits: raw.events.filter(e => e.k === 'rail_hit' && e.victim === 1 - side).length,
    torpedoes: raw.events.filter(e => e.k === 'torp_launch' && e.ship === side).reduce((n, e) => n + (e.ids?.length ?? 1), 0),
    intercepts: raw.events.filter(e => ['torp_down', 'torp_intercept'].includes(e.k) && e.by === side).length,
    crewSurvived: raw.frames.at(-1).s[side].crew.filter(c => c[0] !== 2).length,
    hull: Math.round(100 * raw.frames.at(-1).s[side].hull / raw.frames[0].s[side].hull) }));
}
