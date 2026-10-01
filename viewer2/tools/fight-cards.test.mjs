import test from 'node:test';
import assert from 'node:assert/strict';
import { SalvoLedger, magazine, shipOpportunity } from '../js/fight-facts.js';
import { placeFightCards, intersects } from '../js/fight-layout.js';
const raw=()=>({alive:true,p:[0,0,0],parts:Array(12).fill(1),rail:[0,0,0,11,0],torps:[12,0],pdc:Array.from({length:3},()=>[22,0,-1,0,0])});
test('salvo tally cannot reveal future launches or results, and separates interception weapons',()=>{
 const e=[{k:'torp_launch',ship:1,id:1,t:1},{k:'torp_launch',ship:1,id:2,t:1.3},{k:'torp_launch',ship:1,id:3,t:1.4},{k:'torp_down',id:1,by:0,t:3},{k:'torp_intercept',id:2,by:0,t:4},{k:'torp_hit',id:3,victim:0,t:5}];
 const ledger=new SalvoLedger(e);
 assert.equal(ledger.at(0,1.1,new Set([1])).total,1);
 assert.equal(ledger.at(0,2,new Set([1,2,3])).pdc,0);
 assert.deepEqual({...ledger.at(0,5,new Set()),last:undefined,first:undefined},{total:3,pdc:1,other:1,hits:1,flying:0,last:undefined,first:undefined});
 assert.equal(ledger.at(0,10,new Set()),null);
 assert.equal(ledger.at(0,2,new Set([1,2,3])).hits,0);
});
test('defensive torpedoes do not inflate offensive salvos',()=>{
 const ledger=new SalvoLedger([{k:'torp_launch',t:1,ship:1,id:8},{k:'defensive_shot',t:1,ship:1,weapon:'torpedo',munition:8}]);
 assert.equal(ledger.at(0,2,new Set([8])),null);
});
test('reserve warnings distinguish ammunition exhaustion from disabled weapons',()=>{
 const initial=raw(),r=raw();r.rail[3]=2;r.torps[0]=0;r.parts[7]=0;r.pdc[1][0]=1;r.pdc[2][0]=2;
 assert.deepEqual(magazine(r,initial).map(m=>m.level),['low','empty','low']);
 r.parts[11]=0;assert.equal(magazine(r,initial)[0].level,'disabled');
 r.pdc.forEach(p=>p[0]=.1);assert.equal(magazine(r,initial)[2].value,'<1');
});
test('openings require a living opponent and usable attacking weapon',()=>{
 const a=raw(),b=raw();b.pdc.forEach(p=>p[0]=0);
 assert.equal(shipOpportunity([a,b],0).label,'TORPEDO OPENING');
 a.torps[0]=0;assert.equal(shipOpportunity([a,b],0),null);
 a.torps[0]=12;b.alive=false;assert.equal(shipOpportunity([a,b],0),null);
});
test('reactor loss removes weapon readiness without discarding stored ammunition',()=>{
 const a=raw(),b=raw();a.parts[5]=0;
 assert.deepEqual(magazine(a,raw()).map(m=>m.level),['disabled','disabled','disabled']);
 assert.equal(magazine(a,raw())[2].value,66);
 assert.equal(shipOpportunity([b,a],0).label,'TORPEDO OPENING');
 assert.equal(shipOpportunity([a,b],0),null);
});
test('joint card placement protects crossing ships, avoids overlap and stays inside screen',()=>{
 for(const ships of [
  [{x:780,y:440,radius:40,on:true},{x:810,y:460,radius:40,on:true}],
  [{x:12,y:500,radius:40,on:true},{x:1580,y:480,radius:40,on:true}],
  [{x:-300,y:200,radius:40,on:false},{x:800,y:500,radius:40,on:true}],
 ]){
  const {cards,blocked}=placeFightCards({ships,sizes:[{w:218,h:145},{w:218,h:145}],bounds:{left:12,right:1588,top:132,bottom:862}});
  assert.deepEqual(blocked,[false,false]);assert.equal(intersects(...cards),false);
  for(const c of cards){assert.ok(c.x>=12&&c.x+c.w<=1588&&c.y>=132&&c.y+c.h<=862);}
 }
});

test('system tags track actual repairs, pauses and destruction resets without predicting future restoration',async()=>{
 const {systemFlags}=await import('../js/system-flags.js');
 const r=raw(),events=[{k:'part_lost',part:'drive',ship:0,t:1},{k:'repaired',part:'drive',ship:0,t:10},{k:'part_lost',part:'drive',ship:0,t:11}];
 r.parts[0]=0;r.repair=[0,.625,1];
 const repairing=systemFlags(r,events,0,5)[0];
 assert.equal(repairing.state,'out');assert.equal(repairing.progress,.625);assert.equal(repairing.paused,false);
 r.repair[2]=0;assert.equal(systemFlags(r,events,0,6)[0].paused,true);
 r.repair=null;assert.equal(systemFlags(r,events,0,7)[0].progress,0);
 r.parts[0]=.3;const restored=systemFlags(r,events,0,10)[0];assert.equal(restored.part,repairing.part);assert.equal(restored.state,'restored');assert.equal(restored.progress,1);
 r.parts[0]=0;assert.equal(systemFlags(r,events,0,11)[0].state,'out');
 r.parts[0]=.3;assert.deepEqual(systemFlags(r,events,0,11),[]);
 assert.equal(systemFlags(r,events,0,10)[0].state,'restored'); // backwards seek
 assert.deepEqual(systemFlags(r,events,0,14),[]);
});
test('component repair tags remain independent when several PDC mounts or thrusters are lost',async()=>{
 const {systemFlags}=await import('../js/system-flags.js');
 const r=raw();r.parts[1]=0;r.parts[7]=0;r.parts[8]=0;r.repair=[7,.25,1];
 const flags=systemFlags(r,[],0,3);
 assert.deepEqual(flags.map(f=>[f.part,f.progress]),[['rcs_bow_port',0],['pdc_dorsal',.25],['pdc_port',0]]);
 delete r.repair;assert.equal(systemFlags(r,[],0,3).every(f=>f.progress===0),true); // older recording
});
