import { settlement, quote } from './rules.js';

// Use the same individual quotes and crowd quote as settlement.
export function bettingSummary(wagers, winner, crowd = [0, 0], odds = [.5, .5]) {
  wagers = [...wagers, ...crowd.flatMap((stake, side) => stake > 0 ? [{ side, stake, payout: quote(stake, odds[side]) }] : [])];
  const bySide = [0, 0];
  let won = 0, lost = 0, paidOut = 0;
  for (const wager of wagers) {
    bySide[wager.side] += wager.stake;
    if (winner === undefined) continue;
    const result = settlement(wager, winner);
    won += result.profit;
    lost += Math.max(0, -result.net);
    paidOut += result.returned;
  }
  return { bySide, total: bySide[0] + bySide[1], ...(winner === undefined ? {} : { won, lost, paidOut }) };
}
