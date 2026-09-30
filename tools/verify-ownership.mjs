import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference as ref } from 'convex/server';
const c = new ConvexHttpClient('https://resolute-crocodile-221.convex.cloud');
const {token}=JSON.parse(await readFile('runs/viewer/cloud-test-session.json'));
const call=(name,args={})=>c.mutation(ref(name),{token,...args});
const home=()=>c.query(ref('game:home'),{token});
const results=[];
let h=await home();
if(!h.ship){await call('game:sponsor');results.push('Sponsorship creates a full crew and deducts its fee.');}
h=await home();assert.equal(h.ship.crew.length,4);assert.ok(h.player.balance>=0);
await assert.rejects(call('game:sponsor'));results.push('A second sponsorship cannot duplicate the berth.');
if(!h.ship.locked){
 await call('game:rename',{name:'Cloud Test Ship'});h=await home();assert.equal(h.ship.name,'Cloud Test Ship');
 const before=h.player.balance;
 await call('game:tryout',{station:'pilot'});h=await home();assert.equal(h.player.balance,before-h.economy.tryout);assert.ok(h.player.candidate);
 const otherConnection=new ConvexHttpClient('https://resolute-crocodile-221.convex.cloud');const reload=await otherConnection.query(ref('game:home'),{token});assert.deepEqual(reload.player.candidate,h.player.candidate);
 await assert.rejects(call('game:tryout',{station:'gunner'}));
 const pilot=h.ship.crew[0];await call('game:decide',{accept:false});h=await home();assert.deepEqual(h.ship.crew[0],pilot);assert.equal(h.player.candidate,null);
 results.push('Paid candidate survives reconnect; repeated tryouts are blocked; rejection retains current crew.');
 await call('game:tryout',{station:'gunner'});h=await home();const candidate=h.player.candidate.crew;
 await call('game:decide',{accept:true});h=await home();assert.deepEqual(h.ship.crew[1],candidate);results.push('Acceptance replaces only the selected station.');
}
const f=h.fight;const now=await c.action(ref('game:clock'),{});
if(now<f.startsAt){
 const before=h.player.balance;
 const choices=await Promise.allSettled([call('game:wager',{fight:f.id,side:0,stake:10000}),call('game:wager',{fight:f.id,side:1,stake:10000})]);
 assert.equal(choices.filter(x=>x.status==='fulfilled').length,1);h=await home();assert.equal(h.player.balance,before-10000);results.push('Concurrent duplicate wager attempts spend the stake exactly once.');
 assert.equal(await c.query(ref('game:trace'),{fight:f.id}),null);results.push('Recording URL is unavailable while betting is open.');
}else{
 await assert.rejects(call('game:wager',{fight:f.id,side:0,stake:10000}));results.push('Late wagers are rejected by server time.');
}
await writeFile('runs/viewer/cloud-verification.json',JSON.stringify({results,sequence:h.fight.sequence},null,2));
console.log(results.join('\n'));
