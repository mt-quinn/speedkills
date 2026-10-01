import test from 'node:test';
import assert from 'node:assert/strict';
import { bettingSummary } from './betting-summary.js';
import { shipBetTotal, payoutSummary } from '../viewer2/js/live/bet-totals.js';
const wagers = [{side:0,stake:10000,payout:19500},{side:1,stake:5000,payout:9750}];
const credits = n => String(n/100), escape = s => s.replaceAll('<','&lt;');
test('live totals update by side without revealing outcome',()=>{
 assert.deepEqual(bettingSummary(wagers,undefined,[10000,20000]),{bySide:[20000,25000],total:45000});
 assert.deepEqual(bettingSummary([...wagers,{side:0,stake:100,payout:200}],undefined).bySide,[10100,5000]);
});
test('settlement totals match individual returns, profits and lost stakes',()=>{
 assert.deepEqual(bettingSummary(wagers,0,[10000,20000]),{bySide:[20000,25000],total:45000,won:19000,lost:25000,paidOut:39000});
 assert.deepEqual(bettingSummary(wagers,null),{bySide:[10000,5000],total:15000,won:0,lost:0,paidOut:15000});
});
test('zero amounts disappear, including all-empty summaries',()=>{
 assert.equal(shipBetTotal(0,credits),'');
 assert.equal(payoutSummary({betting:bettingSummary([],0),winner:0,ships:[{name:'Ship',owner:'p'}],ownerPayout:0},credits,escape),'');
 const html=payoutSummary({betting:bettingSummary(wagers,null),winner:null,ships:[]},credits,escape);
 assert.match(html,/Total bet/);assert.match(html,/Paid out/);assert.doesNotMatch(html,/Won \/ profit|Lost \/ stakes|earned/);
});
test('winning owner earnings are public, escaped, and only actual payouts',()=>{
 const fight={winner:0,ships:[{name:'<Ship>',owner:'p'}],ownerPayout:100};
 assert.match(payoutSummary(fight,credits,escape),/&lt;Ship> earned/);
 assert.equal(payoutSummary({...fight,ships:[{name:'Ship'}]},credits,escape),'');
});
