export function shipBetTotal(amount, credits) {
  return amount > 0 ? `<div class="market-bet-total"><span>TOTAL BET</span><b>${credits(amount)} <small>cr</small></b><i aria-hidden="true"></i></div>` : '';
}
export function payoutSummary(fight, credits, escape) {
  const b = fight.betting ?? {};
  const winningShip = fight.winner == null ? null : fight.ships[fight.winner];
  const rows = [
    ['Total bet', b.total],
    ['Won / profit', b.won],
    ['Lost / stakes', b.lost],
    ['Paid out / incl. stakes', b.paidOut],
  ].filter(([, amount]) => amount > 0);
  const income = winningShip?.owner && fight.ownerPayout > 0 ? fight.ownerPayout : 0;
  if (!rows.length && !income) return '';
  return `<section class="result-market" aria-label="Bets and payouts">${rows.length ? `<header><span>BETS / PAYOUTS</span></header><div class="result-market-totals">${rows.map(([label, amount]) => `<div><span>${label}</span><b>${credits(amount)} <small>cr</small></b></div>`).join('')}</div>` : ''}${income ? `<div class="result-ship-income"><span>${escape(winningShip.name)} earned <small>Owner income</small></span><b>+${credits(income)} <small>cr</small></b></div>` : ''}</section>`;
}
