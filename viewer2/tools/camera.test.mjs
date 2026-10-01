import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { Match } from '../js/data.js';
import { CameraDrones, CAMERA_DEFAULTS, circleOfConfusion } from '../js/camera-drones.js';
const match=new Match(JSON.parse(fs.readFileSync(new URL('../matches/L40000.json',import.meta.url))));
const viewport={width:1600,height:900,stage:{left:0,right:1600,top:112,bottom:884}};
const engine=()=>new CameraDrones(match,new THREE.Vector3(0,1,0),viewport,{},true);
test('camera flight and optics respect independent physical limits',()=>{
 const e=engine();let prev;
 for(let t=0;t<match.duration;t+=1/30){e.at(t);const now=e.drones.map(d=>({pos:d.pos.clone(),vel:d.vel.clone(),body:d.body.clone(),quat:d.quat.clone(),fov:d.fov,focus:d.focus,omega:d.angularVelocity.clone()}));
  if(prev)for(let i=0;i<now.length;i++){
   const a=prev[i],b=now[i],dt=1/30;
   assert.ok(b.vel.distanceTo(a.vel)<=CAMERA_DEFAULTS.acceleration*dt+1e-6);
   assert.ok(b.vel.length()<=CAMERA_DEFAULTS.speed+1e-6);
   assert.ok(b.body.angleTo(a.body)<=CAMERA_DEFAULTS.bodyTurn*Math.PI/180*dt+1e-6);
   assert.ok(b.omega.distanceTo(a.omega)<=CAMERA_DEFAULTS.gimbalAcceleration*Math.PI/180*dt+1e-6);
   assert.ok(b.quat.angleTo(a.quat)<=CAMERA_DEFAULTS.gimbalTurn*Math.PI/180*dt+1e-6);
   assert.ok(Math.abs(b.fov-a.fov)<=CAMERA_DEFAULTS.zoomRate*dt+1e-6);
   assert.ok(Math.abs(Math.log(b.focus/a.focus))<=CAMERA_DEFAULTS.focusRate*.36*dt+1e-6);
  }prev=now;
 }
});
test('late joining and different display frame rates produce the same shot and drone state',()=>{
 const a=engine(),b=engine(),c=engine();
 for(let t=0;t<54;t+=1/60)a.at(t);
 for(let t=0;t<54;t+=1/24)b.at(t);
 const samples=[a.at(54),b.at(54),c.at(54)];
 for(const s of samples.slice(1)){assert.equal(s.rig,samples[0].rig);assert.ok(s.pos.distanceTo(samples[0].pos)<1e-8);assert.ok(s.quat.angleTo(samples[0].quat)<1e-6);assert.equal(s.fov,samples[0].fov);}
 assert.deepEqual(a.cuts,b.cuts);assert.deepEqual(a.cuts,c.cuts);
 const rewind=a.at(13);const fresh=engine().at(13);assert.ok(rewind.pos.distanceTo(fresh.pos)<1e-8);
});
test('director selects prepared views, cuts discretely, and retains wide coverage',()=>{
 const e=engine();e.at(match.duration);
 const report=e.report();assert.ok(report.coverage>=.97);assert.ok(report.pairCoverage>=.98);assert.ok(report.cutsPerMinute<=18);
 for(const cut of e.cuts){const decision=e.decisions.find(d=>d.t===cut.t);assert.ok(decision.candidates.find(c=>c.rig===cut.to).ready);}
 assert.ok(new Set(e.cuts.map(c=>c.to)).size>=3);
 assert.ok(e.focusEvents.some(f=>f.to.startsWith('torpedo:')));
});
test('focus optics preserve deep coverage and bounded blur',()=>{
 assert.equal(circleOfConfusion(100,5000,0),0);
 assert.equal(circleOfConfusion(5000,5000,1),0);
 assert.equal(circleOfConfusion(5400,5000,1),0);
 assert.ok(circleOfConfusion(500,2500,.8)>circleOfConfusion(2200,2500,.8));
 assert.ok(circleOfConfusion(5,5000,1)<=9);
 const e=engine();e.at(40);assert.equal(e.drones[0].aperture,0);
});
test('ordinary playback does not accumulate diagnostic samples',()=>{
 const e=new CameraDrones(match,new THREE.Vector3(0,1,0),viewport);e.at(match.duration);
 assert.equal(e.samples.length,0);assert.equal(e.decisions.length,0);assert.equal(e.focusEvents.length,0);
});
