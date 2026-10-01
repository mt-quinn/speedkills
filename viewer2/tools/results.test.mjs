import test from 'node:test';
import assert from 'node:assert/strict';
import {renderResults} from '../js/live/results.js';
const fight={sequence:23,duration:125,winner:0,story:'Reactor <destroyed>.',ships:[{name:'Iron & bark',style:'Reference',owner:'player'},{name:'Corvid',style:'Knife'}],odds:[.65,.35],stats:[{railShots:12,railHits:8,torpedoes:16,intercepts:11,crewSurvived:3,hull:42},{railShots:11,railHits:6,torpedoes:20,intercepts:8,crewSurvived:1,hull:0}],betting:{total:100000,won:50000,lost:20000,paidOut:120000},ownerPayout:500};
test('results keep combat records, personal receipt, payouts and transition controls together',()=>{
 const html=renderResults({fight,wager:{side:0,stake:10000,returned:15100,net:5100}});
 assert.equal((html.match(/role="meter"/g)||[]).length,12);
 for(const match of html.matchAll(/aria-valuemax="([\d.]+)" aria-valuenow="([\d.]+)"/g))assert.ok(Number(match[2])<=Number(match[1]));
 for(const text of ['WINNER','YOUR BET','BET WON','+51','151','SHIP EARNINGS','Paid out','includes returned stakes','data-countdown','data-do="hangar"','Reactor &lt;destroyed&gt;.','Iron &amp; bark'])assert.ok(html.includes(text),text);
 assert.ok(!html.includes('<details'));
});
test('loss, refunded draw, pending settlement and spectators have distinct accurate receipts',()=>{
 assert.match(renderResults({fight,wager:{side:1,stake:10000,returned:0,net:-10000}}),/BET LOST[\s\S]*-100/);
 assert.match(renderResults({fight:{...fight,winner:null},wager:{side:0,stake:10000,returned:10000,net:0}}),/STAKE RETURNED/);
 assert.match(renderResults({fight,wager:{side:0,stake:10000}}),/SETTLING BET[\s\S]*Pending/);
 assert.match(renderResults({fight}),/NO BET PLACED/);
});
test('zero market amounts stay hidden, owner income requires an owned winning ship',()=>{
 assert.ok(!renderResults({fight:{...fight,betting:{},ownerPayout:0}}).includes('class="finish-market"'));
 assert.ok(!renderResults({fight:{...fight,winner:1}}).includes('SHIP EARNINGS'));
 assert.ok(!renderResults({fight:{...fight,winner:null}}).includes('SHIP EARNINGS'));
 const partial=renderResults({fight:{...fight,betting:{total:10000,lost:0,won:0,paidOut:0},ownerPayout:0}});
 assert.ok(partial.includes('Total bet'));assert.ok(!partial.includes('Won / profit'));assert.ok(!partial.includes('Paid out'));
});
