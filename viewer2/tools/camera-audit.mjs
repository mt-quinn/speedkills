// Run real recordings through the exact live camera engine, without a renderer.
// node viewer2/tools/camera-audit.mjs [--portrait] [--trace PATH] match.json ...
import fs from 'node:fs';
import * as THREE from 'three';
import { Match } from '../js/data.js';
import { CameraDrones } from '../js/camera-drones.js';
const args=process.argv.slice(2), portrait=args.includes('--portrait');
const traceIndex=args.indexOf('--trace'), trace=traceIndex>=0?args[traceIndex+1]:null;
const files=args.filter((a,i)=>!a.startsWith('--')&&(traceIndex<0||i!==traceIndex+1));
if(!files.length)throw new Error('Supply one or more fight recordings.');
const results=[];
for(const file of files){
 const raw=JSON.parse(fs.readFileSync(file)),m=new Match(raw),a=m.ship(0,0),b=m.ship(0,1);
 const sep=b.pos.clone().sub(a.pos).normalize();let up=new THREE.Vector3(0,1,0);if(Math.abs(up.dot(sep))>.9)up.set(1,0,0);up.addScaledVector(sep,-up.dot(sep)).normalize();
 const viewport=portrait?{width:390,height:844,stage:{left:8,right:382,top:160,bottom:600}}:{width:1600,height:900,stage:{left:0,right:1600,top:112,bottom:884}};
 const start=performance.now(), engine=new CameraDrones(m,up,viewport,{},true);
 engine.at(m.duration);const report=engine.report();
 const roles=new Set(engine.cuts.map(c=>c.to)),shortShots=engine.cuts.filter(c=>c.previousDuration<2).length;
 const passes=report.coverage>=.97&&report.pairCoverage>=.98&&report.cutsPerMinute<=18&&shortShots*60/m.duration<=2;
 results.push({file,duration:m.duration,...report,roles:roles.size,shortShots,ms:Math.round(performance.now()-start),pass:passes});
 if(trace)fs.writeFileSync(trace.replace('{seed}',String(raw.seed??results.length)),JSON.stringify(engine.export()));
}
console.log(JSON.stringify(results,null,2));if(results.some(r=>!r.pass))process.exitCode=1;
