import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBetting } from '../js/live/betting.js';
const crew=['pilot','gunner','engineer','ops'].map((station,i)=>({station,name:`Crew <${i}>`,skill:1,resistance:i+3}));
const fight={sequence:1,odds:[.65,.35],oddsSamples:400,ships:[{name:'Ship <A>',style:'Knife',crew},{name:'Ship B',style:'Counter',crew}],betting:{bySide:[0,10000]}};
const player={balance:50000,maxBet:10000};
test('betting panels expose full-surface choices and eight pairs of bounded stat meters',()=>{
 const html=renderBetting({fight,player,draft:{side:null,amount:'100'}});
 assert.equal((html.match(/role="button"/g)||[]).length,2);assert.equal((html.match(/role="meter"/g)||[]).length,16);
 assert.ok(html.includes('Ship &lt;A&gt;'));assert.ok(html.includes('aria-valuenow="3"'));assert.ok(html.includes('aria-valuenow="50"'));
 assert.equal((html.match(/TOTAL BET/g)||[]).length,1);assert.ok(/data-do="place-bet" disabled/.test(html));
});
test('a locked bet controls selected ship even if an old draft chooses the other side',()=>{
 const html=renderBetting({fight,player,draft:{side:0,amount:'100'},wager:{side:1,stake:10000,payout:37100}});
 assert.equal((html.match(/aria-disabled="true"/g)||[]).length,2);assert.equal((html.match(/tabindex="-1"/g)||[]).length,2);
 assert.ok(/market-ship t1 backed/.test(html));assert.ok(html.includes('YOUR BET · LOCKED'));assert.ok(!html.includes('data-form="wager"'));
});
