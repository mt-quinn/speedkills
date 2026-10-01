// Reproducible camera coverage suite on every actual roster pairing. No odds or
// backend changes. Native fights are generated into a temporary directory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three';
import { Match } from '../js/data.js';
import { CameraDrones, circleOfConfusion } from '../js/camera-drones.js';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'hardburn-camera-'));
const reportPath=process.argv[2]||path.join(os.tmpdir(),`hardburn-camera-report-${Date.now()}.json`);
const seedBase=Number(process.argv[3]||8100),repeats=Number(process.argv[4]||1);
if(!Number.isSafeInteger(seedBase)||!Number.isSafeInteger(repeats)||repeats<1||repeats>20)throw new Error('Supply an integer seed and1–20 repetitions.');
const reports=[];
try {
 for(let round=0;round<repeats;round++)for(let a=0;a<10;a++)for(let b=a+1;b<10;b++){
  const seed=seedBase+reports.length/2, file=path.join(folder,`${a}-${b}.json`);
  execFileSync('target/release/league',['fight','--a',String(a),'--b',String(b),'--seed',String(seed),'--out',file]);
  const raw=JSON.parse(fs.readFileSync(file)),m=new Match(raw),axis=m.ship(0,1).pos.clone().sub(m.ship(0,0).pos).normalize();
  let up=new THREE.Vector3(0,1,0);if(Math.abs(up.dot(axis))>.9)up.set(1,0,0);up.addScaledVector(axis,-up.dot(axis)).normalize();
  for(const portrait of [false,true]){
   const viewport=portrait?{width:390,height:844,stage:{left:8,right:382,top:160,bottom:600}}:{width:1600,height:900,stage:{left:0,right:1600,top:112,bottom:884}};
   const e=new CameraDrones(m,up,viewport,{},true);e.at(m.duration);const report=e.report();
   const events=m.events.filter(x=>['rail_fire','rail_hit','torp_hit','torp_down','end'].includes(x.k));
   const inspect=new CameraDrones(m,up,viewport);let seen=0,sharp=0,impacts=0,impactsSeen=0;const missed=[];
   for(const event of events){
    const s=inspect.at(event.t);inspect.prepareProbe(s);
    const ship=event.victim??event.ship??event.by??(event.k==='end'&&event.winner!=null?1-event.winner:0);
    const p=event.pos?new THREE.Vector3(...event.pos):m.ship(event.t,ship).pos;
    const ndc=p.clone().project(inspect.probe),pixel={x:(ndc.x+1)*viewport.width/2,y:(1-ndc.y)*viewport.height/2};
    const on=ndc.z>-1&&ndc.z<1&&pixel.x>viewport.stage.left&&pixel.x<viewport.stage.right&&pixel.y>viewport.stage.top&&pixel.y<viewport.stage.bottom;
    if(on)seen++;else missed.push({t:event.t,kind:event.k,rig:s.rig});
    if(['rail_hit','torp_hit','end'].includes(event.k)){impacts++;if(on)impactsSeen++;}
    const z=-p.clone().sub(s.pos).applyQuaternion(s.quat.clone().invert()).z;
    if(on&&circleOfConfusion(z,s.focus,s.aperture,s.fov)<3)sharp++;
   }
   const cuts=e.cuts,short=cuts.filter(c=>c.previousDuration<2).length;
   const result={a,b,seed,portrait,duration:m.duration,...report,eventCoverage:seen/Math.max(1,events.length),eventSharp:sharp/Math.max(1,events.length),impactCoverage:impactsSeen/Math.max(1,impacts),missed,shortShots:short};
   result.pass=report.coverage>=.97&&report.pairCoverage>=.98&&report.cutsPerMinute<=18&&short*60/m.duration<=2&&result.impactCoverage>=.95;
   reports.push(result);
  }
  fs.unlinkSync(file);
 }
 const summary={version:'drone-broadcast-v1',samples:reports.length,failed:reports.filter(r=>!r.pass),
  meanCoverage:reports.reduce((s,r)=>s+r.coverage,0)/reports.length,
  meanEventCoverage:reports.reduce((s,r)=>s+r.eventCoverage,0)/reports.length,
  maxCutsPerMinute:Math.max(...reports.map(r=>r.cutsPerMinute)),reports};
 fs.writeFileSync(reportPath,JSON.stringify(summary,null,2));
 console.log(JSON.stringify({...summary,reportPath,reports:undefined,failed:summary.failed.map(r=>({a:r.a,b:r.b,portrait:r.portrait,coverage:r.coverage,impactCoverage:r.impactCoverage,shortShots:r.shortShots,missed:r.missed}))},null,2));if(summary.failed.length)process.exitCode=1;
} finally {fs.rmSync(folder,{recursive:true,force:true});}
