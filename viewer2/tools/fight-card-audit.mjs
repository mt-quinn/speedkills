// Geometry sweep of real camera views. DOM typography is reviewed separately.
import fs from 'node:fs';
import * as THREE from 'three';
import { Match } from '../js/data.js';
import { CameraDrones } from '../js/camera-drones.js';
import { placeFightCards, intersects } from '../js/fight-layout.js';
const files=process.argv.slice(2);
if(!files.length)throw new Error('Supply fight recordings to audit.');
const reports=[];
for(const file of files)for(const [width,height,w,h,top] of [[1280,720,218,160,132],[844,390,176,120,96]]){
 const match=new Match(JSON.parse(fs.readFileSync(file))),engine=new CameraDrones(match,new THREE.Vector3(0,1,0),{width,height,stage:{left:0,right:width,top,bottom:height-38}});
 let previous=[],frames=0,obstructions=0,overlaps=0;const failures=[];
 for(let t=0;t<match.duration;t+=.25){
  const shot=engine.at(t);engine.prepareProbe(shot);
  const project=p=>{const q=p.clone().project(engine.probe);return{x:(q.x+1)*width/2,y:(1-q.y)*height/2,on:q.z>-1&&q.z<1&&Math.abs(q.x)<1.1&&Math.abs(q.y)<1.1};};
  const ships=[0,1].map(i=>{const p=match.ship(t,i).pos;return{...project(p),radius:Math.max(12,Math.min(100,height*6*shot.sizeScale/(Math.max(1,p.distanceTo(shot.pos))*Math.tan(shot.fov*Math.PI/360))))};});
  const obstacles=match.objects(t,'tp').map(tp=>project(tp.pos)).filter(p=>p.on).map(p=>({x:p.x-16,y:p.y-16,w:32,h:32,weight:18000}));
  const layout=placeFightCards({ships,sizes:[{w,h},{w,h}],bounds:{left:12,right:width-12,top:top+8,bottom:height-38},obstacles,previous});
  previous=layout.cards;frames++;obstructions+=layout.blocked.filter(Boolean).length;overlaps+=intersects(...layout.cards)?1:0;
  if(layout.blocked.some(Boolean)&&failures.length<5)failures.push({t,ships,cards:layout.cards});
 }
 reports.push({file,width,height,frames,obstructions,overlaps,failures});
}
console.log(JSON.stringify(reports,null,2));if(reports.some(r=>r.obstructions||r.overlaps))process.exitCode=1;
