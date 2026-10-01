// Reproduce the tuning batch against the same embedded engine used by Convex.
import {readFile} from 'node:fs/promises';
import {simulator} from '../shared/simulator.js';
const roster=JSON.parse((await readFile(new URL('../convex/roster.ts',import.meta.url),'utf8')).slice('export const roster = '.length).trim().replace(/;$/,''));
const source=await readFile(new URL('../convex/simBinary.ts',import.meta.url),'utf8');
const sim=await simulator(Buffer.from(JSON.parse(source.slice(source.indexOf('=')+1).trim().replace(/;$/,'')),'base64'));
const count=Number(process.argv[2]||500);
if(!Number.isInteger(count)||count<1)throw Error('Pass a positive fight count.');
let blackoutFights=0,deathFights=0,blackouts=0,deaths=0,duration=0;
for(let k=0;k<count;k++){
 const a=k%10,b=(a+1+Math.floor(k/10)%9)%10;
 const ships=[a,b].map(i=>({...roster.ships[i],identity:1000+i}));
 const raw=sim.fight(ships,880000+k);
 if(raw.params.g_model!=='random-v1')throw Error('Wrong gee model.');
 const outs=raw.summary.sides.reduce((n,s)=>n+s.blackouts,0),dead=raw.summary.sides.reduce((n,s)=>n+s.crew_killed_by_g,0);
 blackoutFights+=outs>0;deathFights+=dead>0;blackouts+=outs;deaths+=dead;duration+=raw.summary.duration;
}
console.log(JSON.stringify({fights:count,blackoutFights,blackoutPercent:blackoutFights/count*100,geeDeathFights:deathFights,geeDeathPercent:deathFights/count*100,blackouts,deaths,meanDuration:duration/count},null,2));
