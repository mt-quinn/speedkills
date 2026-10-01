import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { Match } from '../js/data.js';
import { CameraDrones, CAMERA_DEFAULTS, circleOfConfusion, shotContrast } from '../js/camera-drones.js';
import { CameraModels } from '../js/camera-models.js';
const match=new Match(JSON.parse(fs.readFileSync(new URL('../matches/L40000.json',import.meta.url))));
const viewport={width:1600,height:900,stage:{left:0,right:1600,top:112,bottom:884}};
const engine=()=>new CameraDrones(match,new THREE.Vector3(0,1,0),viewport,{},true);
test('camera models follow optics, scale at distance and cue only visible pending cuts',()=>{
 const root=new THREE.Group(), models=new CameraModels(root), camera=new THREE.PerspectiveCamera(40,16/9,5,20000);
 camera.updateMatrixWorld();
 const drone={pos:new THREE.Vector3(0,0,-1000),quat:new THREE.Quaternion(),fov:35};
 const e={drones:[drone],viewport:{width:1600,height:900},pendingCut:{i:0,since:10},current:{t:10.4}};
 models.update(e,camera,new THREE.Vector3(),900);
 const m=models.models[0]; assert.ok(m.group.visible);assert.equal(m.guideMaterial.uniforms.highlight.value,1);
 assert.ok(m.group.position.equals(drone.pos));assert.ok(m.group.quaternion.equals(drone.quat));
 const scale=m.group.scale.x, width=m.geometry.attributes.position.array[3];
 drone.pos.z=-2000;drone.fov=60;models.update(e,camera,new THREE.Vector3(),900);
 assert.ok(Math.abs(m.group.scale.x/scale-2)<1e-6);assert.ok(Math.abs(m.geometry.attributes.position.array[3])>Math.abs(width));
 drone.pos.x=20000;models.update(e,camera,new THREE.Vector3(),900);assert.equal(m.guideMaterial.uniforms.highlight.value,0);
 drone.pos.set(0,0,0);models.update(e,camera,new THREE.Vector3(),900);assert.equal(m.group.visible,false);
 models.dispose();root.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
});
test('camera hardware and POV stay outside the lens exclusion zone without boundary flicker',()=>{
 const root=new THREE.Group(), models=new CameraModels(root), camera=new THREE.PerspectiveCamera(40,16/9,5,20000);
 camera.updateMatrixWorld();
 const drone={pos:new THREE.Vector3(0,0,-1000),quat:new THREE.Quaternion(),fov:35};
 const e={drones:[drone],viewport:{width:1600,height:900},pendingCut:{i:0,since:10},current:{t:10.4}};
 const update=(rig=null)=>models.update(e,camera,new THREE.Vector3(),900,rig);
 update(0); const m=models.models[0];
 assert.equal(m.group.visible,false,'on-air rig stays hidden despite interpolation offset');
 assert.equal(m.guideMaterial.uniforms.highlight.value,0);
 update();assert.equal(m.group.visible,true,'manual view can see distant hardware');
 drone.pos.z=-40;update();assert.equal(m.group.visible,false);
 drone.pos.z=-55;update();assert.equal(m.group.visible,false,'boundary hysteresis retains exclusion');
 drone.pos.z=-65;update();assert.equal(m.group.visible,true);
 // Wide POV guides extend well beyond the camera body, even at modest distance.
 drone.fov=120;drone.pos.z=-80;update();assert.equal(m.group.visible,false);
 assert.equal(m.guideMaterial.uniforms.highlight.value,0,'nearby incoming rig cannot highlight');
 drone.pos.z=-1000;update();assert.equal(m.group.visible,true);
 // Account for enlarged silhouettes in small viewports and wide broadcast lenses.
 camera.fov=120;models.update(e,camera,new THREE.Vector3(),300);
 assert.equal(m.group.visible,false,'scaled guide bounds are excluded too');
 models.dispose();root.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
});
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
test('visual contrast measures actual angle and subject scale, not camera identity',()=>{
 const a={pos:new THREE.Vector3(0,0,1000),sizePx:30},b={pos:new THREE.Vector3(10,0,1000),sizePx:32};
 assert.equal(shotContrast(a,b,new THREE.Vector3()).distinct,false);
 b.pos.set(1000,0,0);assert.equal(shotContrast(a,b,new THREE.Vector3()).distinct,true);
 b.pos.copy(a.pos);b.sizePx=60;assert.equal(shotContrast(a,b,new THREE.Vector3()).distinct,true);
});
test('good shots ignore similar score winners and require a sustained motivated edit',()=>{
 const e=engine();e.drones=e.drones.slice(0,2);e.active=0;e.since=0;
 const [a,b]=e.drones;a.pos.set(0,0,1000);b.pos.set(10,0,1000);
 for(const d of e.drones){d.ready=true;d.sizePx=30;d.purpose='exchange';}
 a.score=50;b.score=80;
 e.evaluate=d=>({rig:d.rig.id,ready:d.ready,score:d.score});
 const st={ships:[{raw:{g:0}},{raw:{g:0}}]},c={mid:new THREE.Vector3(),merge:true,phase:'crossing',threats:[],hard:-1};
 e.choose(20,st,c);e.choose(100,st,c);assert.equal(e.cuts.length,0);
 b.pos.set(1000,0,0);e.choose(101,st,c);assert.equal(e.cuts.length,0);
 b.score=55;e.choose(101.4,st,c);b.score=80;e.choose(102,st,c);assert.equal(e.cuts.length,0);
 e.choose(102.7,st,c);assert.equal(e.cuts.length,1);assert.equal(e.cuts[0].reason,'close engagement');
 assert.equal(e.cuts[0].contrast.distinct,true);assert.equal(e.cuts[0].outgoingReady,true);
});
test('coverage recovery can cut immediately even to a similar view',()=>{
 const e=engine();e.drones=e.drones.slice(0,2);e.active=0;e.since=0;
 const [a,b]=e.drones;a.ready=false;b.ready=true;a.score=-100;b.score=20;a.sizePx=b.sizePx=30;
 a.pos.set(0,0,1000);b.pos.set(10,0,1000);a.purpose=b.purpose='exchange';
 e.evaluate=d=>({rig:d.rig.id,ready:d.ready,score:d.score});
 e.choose(.1,{ships:[{raw:{g:0}},{raw:{g:0}}]},{mid:new THREE.Vector3(),phase:'approach',threats:[],hard:-1});
 assert.equal(e.cuts[0].reason,'coverage recovery');assert.equal(e.cuts[0].outgoingReady,false);
});
test('elapsed time and a phase change cannot force an unmotivated cut',()=>{
 const e=engine();e.drones=e.drones.slice(0,2);e.active=0;e.since=0;
 const [a,b]=e.drones;for(const d of e.drones){d.ready=true;d.sizePx=30;d.purpose='exchange';}
 a.pos.set(0,0,1000);b.pos.set(1000,0,0);a.score=50;b.score=80;
 e.evaluate=d=>({rig:d.rig.id,ready:d.ready,score:d.score});
 e.choose(100,{ships:[{raw:{g:0}},{raw:{g:0}}]},{mid:new THREE.Vector3(),phase:'separating',threats:[],hard:-1});
 assert.equal(e.cuts.length,0);
});
