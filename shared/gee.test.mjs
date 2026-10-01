import test from 'node:test';
import assert from 'node:assert/strict';
import {geeResistance,withResistance} from '../viewer2/js/gee.js';
import {candidate} from './rules.js';
import {oddsKey} from './simulator.js';
test('legacy resistance migration preserves ranking, identities and other stats',()=>{
 const crew={name:'Lenie Hardson',station:'pilot',skill:1.12,tolerance:1};
 assert.equal(geeResistance(crew),5);
 assert.deepEqual(withResistance(crew),{name:crew.name,station:crew.station,skill:crew.skill,resistance:5});
 assert.equal(geeResistance({tolerance:.88}),1);assert.equal(geeResistance({tolerance:1.15}),10);
 assert.equal(geeResistance({resistance:1,tolerance:1.15}),1);
 assert.equal(geeResistance(withResistance(withResistance(crew))),5);
});
test('scouting produces whole resistance scores and caches separate the new gee model',()=>{
 const values=new Set();for(let seed=0;seed<1000;seed++){const c=candidate(Math.imul(seed,0x9e3779b9)>>>0,'pilot');assert.ok(Number.isInteger(c.resistance)&&c.resistance>=1&&c.resistance<=10);assert.equal(c.tolerance,undefined);values.add(c.resistance);}
 assert.equal(values.size,10);
 const ship={style:'Reference',identity:1000,crew:[{skill:1,tolerance:1}]};
 assert.ok(oddsKey([ship,ship]).startsWith('["wasm-tactics-v5"'));
 const high={...ship,crew:[{skill:1,resistance:10}]};assert.notEqual(oddsKey([ship,ship]),oddsKey([high,ship]));
});
