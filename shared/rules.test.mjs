import test from 'node:test';
import assert from 'node:assert/strict';
import { phase, maxBet, betCheck, settlement, ownerIncome, crewLocked, candidate, quote } from './rules.js';
const f = { opensAt: 1000, startsAt: 61000, endsAt: 160000, nextAt: 175000, odds: [.4, .6], ships: [{id:'a'}, {id:'b'}] };
test('global phases use exact server boundaries', () => {
 assert.equal(phase(f, 60999), 'betting'); assert.equal(phase(f, 61000), 'combat'); assert.equal(phase(f, 160000), 'results');
 assert.throws(() => betCheck(f, 999, 0, 100, 1000, null));
 assert.throws(() => betCheck(f, 61000, 0, 100, 1000, null));
});
test('wager validation locks funds and rejects invalid or repeated choices', () => {
 assert.deepEqual(betCheck(f, 2000, 0, 1000, 1000, null), { side:0, stake:1000, payout:2400 });
 for (const s of [NaN, Infinity, -1, 99, 1000.5, 150, 1001]) assert.throws(() => betCheck(f, 2000, 0, s, 1000, null));
 assert.throws(() => betCheck(f, 2000, 2, 100, 1000, null)); assert.throws(() => betCheck(f, 2000, 0, 100, 1000, {}));
});
test('settlement separates returned stake, net and owner share', () => {
 const w = { side:0, stake:1000, payout:2400 };
 assert.deepEqual(settlement(w,0), { returned:2400, net:1400, profit:1400 });
 assert.deepEqual(settlement(w,1), { returned:0, net:-1000, profit:0 });
 assert.deepEqual(settlement(w,null), { returned:1000, net:0, profit:0 });
 assert.equal(ownerIncome([140000, 260000]),4000); assert.equal(quote(100, .4),200);
});
test('crew lock ends at finish and only applies to the current competitors', () => {
 assert.equal(crewLocked('a',f,1000),true); assert.equal(crewLocked('a',f,61000),true);
 assert.equal(crewLocked('a',f,160000),false); assert.equal(crewLocked('c',f,1000),false);
});
test('candidate generation is deterministic and can trade skill for g tolerance', () => {
 const c = candidate(123,'pilot',['A','B']); assert.deepEqual(c,candidate(123,'pilot',['A','B']));
 assert.ok(c.skill >= .78 && c.skill <= 1.28); assert.ok(Number.isInteger(c.resistance) && c.resistance >= 1 && c.resistance <= 10);
});

test('money awards round to whole credits, including owner shares', () => {
 assert.equal(quote(1000,.4),2400); assert.equal(quote(1000,.6),1600);
 assert.equal(ownerIncome([4900]),0); assert.equal(ownerIncome([5100]),100);
 assert.throws(()=>quote(150,.5));
});

test('bet limits follow balance tiers, including exact thresholds',()=>{
 for (const [balance, cap] of [[0,0],[5000,5000],[99900,10000],[100000,25000],[199900,25000],[200000,50000],[1000000,50000]]) {
  assert.equal(maxBet(balance),cap);
  if(cap)assert.doesNotThrow(()=>betCheck(f,2000,0,cap,balance,null));
  assert.throws(()=>betCheck(f,2000,0,cap+100,balance,null));
 }
});
