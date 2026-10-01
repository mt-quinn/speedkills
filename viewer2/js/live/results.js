const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const credits=n=>Math.round(n/100).toLocaleString();
const doctrines={Reference:'Duelist',Knife:'Knife fighter',Counter:'Counterpuncher'};
const record=[['railShots','Rail shots'],['railHits','Rail hits'],['torpedoes','Torps fired'],['intercepts','Intercepted'],['crewSurvived','Crew alive'],['hull','Hull left']];
function shipRecord(f,i,wager){
 const s=f.ships[i],win=f.winner===i,draw=f.winner===null;
 return `<article class="finish-ship t${i} ${win?'victor':''}" aria-label="${esc(s.name)}, ${draw?'draw':win?'winner':'loss'}"><header><div><span class="finish-outcome">${draw?'DRAW':win?'WINNER':'LOSS'}${wager?.side===i?'<i>✓ YOUR BET</i>':''}</span><h2 title="${esc(s.name)}">${esc(s.name)}</h2><span class="finish-doctrine">${esc(doctrines[s.style]||s.style)}</span></div><div class="finish-opening"><b>${Math.round(f.odds[i]*100)}<small>%</small></b><span>OPENING ODDS</span></div></header><div class="finish-record">${record.map(([key,label])=>{
 const n=f.stats[i][key],max=key==='hull'?100:key==='crewSurvived'?4:Math.max(1,...f.stats.map(s=>s[key])),lead=n>f.stats[1-i][key];
 return `<section class="finish-stat ${lead?'stat-lead':''}"><span>${label}</span><b>${n}${key==='hull'?'<small>%</small>':key==='crewSurvived'?'<small>/4</small>':''}</b><div class="finish-meter" role="meter" aria-label="${esc(s.name)}: ${label}" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${n}"><i style="--fill:${Math.min(100,100*n/max)}%"></i></div></section>`;
 }).join('')}</div><footer>COMBAT RECORD <span>bars compare ships</span></footer></article>`;
}
function settlement(f,w){
 const pending=w&&w.returned===undefined;
 const state=!w?'NO BET PLACED':pending?'SETTLING BET':w.net>0?'BET WON':w.net===0?'STAKE RETURNED':'BET LOST';
 return `<section class="finish-personal ${w&&!pending?(w.net>0?'won':w.net<0?'lost':'returned'):''}" aria-label="Your bet result"><span class="finish-overline">YOUR BET</span><div class="finish-settlement"><span>${state}</span>${w?`<b>${pending?'—':(w.net>0?'+':'')+credits(w.net)}${pending?'':'<small>cr</small>'}</b>`:'<b class="finish-spectator">Watched the duel</b>'}</div>${w?`<p class="finish-backed" title="${esc(f.ships[w.side].name)}">${esc(f.ships[w.side].name)}</p><div class="finish-receipt"><div><span>Stake</span><b>${credits(w.stake)} <small>cr</small></b></div><div><span>Returned</span><b>${pending?'Pending':credits(w.returned)+' <small>cr</small>'}</b></div></div>`:'<p class="finish-backed">Betting opens before the next fight.</p>'}</section>`;
}
function market(f){
 const b=f.betting??{},rows=[['Total bet',b.total],['Won / profit',b.won],['Lost / stakes',b.lost],['Paid out',b.paidOut]].filter(([,n])=>n>0);
 const ship=f.winner==null?null:f.ships[f.winner],income=ship?.owner&&f.ownerPayout>0?f.ownerPayout:0;
 if(!rows.length&&!income)return '';
 return `<section class="finish-market" aria-label="Bets and payouts"><span class="finish-overline">BETS / PAYOUTS</span><div class="finish-market-grid">${rows.map(([label,n])=>`<div><span>${label}</span><b>${credits(n)} <small>cr</small></b>${label==='Paid out'?'<small class="finish-paid-note">includes returned stakes</small>':''}</div>`).join('')}</div>${income?`<div class="finish-income"><div><span>SHIP EARNINGS</span><b title="${esc(ship.name)}">${esc(ship.name)}</b></div><strong>+${credits(income)} <small>cr</small></strong></div>`:''}</section>`;
}
export function renderResults({fight:f,wager=null}){
 if(f.winner===undefined)return '<p>Confirming the result…</p>';
 return `<section class="hb-finish match-console finish-desk"><header class="match-console-head"><div><span class="hb-eyebrow">MATCH ${String(f.sequence).padStart(4,'0')} / FINAL</span><h1>${f.winner===null?'Draw':'Fight complete'}</h1></div><span class="finish-final">FINAL</span></header><div class="match-console-body"><p class="finish-story">${esc(f.story)}</p><div class="finish-ships" aria-label="Combat statistics">${f.ships.map((_,i)=>shipRecord(f,i,wager)).join('')}</div><aside class="finish-ledger" aria-label="Fight settlement">${settlement(f,wager)}${market(f)}</aside><p class="finish-reset">Ship and crew restored for the next fight.</p></div><footer class="match-action-bar finish-action"><div class="hb-next-window"><span>NEXT BETTING OPENS IN</span><b data-countdown></b></div><button data-do="hangar">Return to hangar <span aria-hidden="true">↗</span></button></footer></section>`;
}
