import test from 'node:test';
import assert from 'node:assert/strict';
import {readAudioMix,saveAudioMix,readViewerSettings,saveViewerSettings} from '../js/preferences.js';
import {renderSettings} from '../js/live/settings.js';
const storage=()=>{const values=new Map();return {getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};};
test('legacy audio toggles migrate with full volume and independent persistent faders',()=>{
 const s=storage();s.setItem('sk-audio',JSON.stringify({music:false,sfx:true}));
 assert.deepEqual(readAudioMix(s),{music:false,sfx:true,musicVolume:1,sfxVolume:1});
 saveAudioMix({musicVolume:.42,sfxVolume:.73},s);
 saveAudioMix({music:true},s);
 assert.deepEqual(readAudioMix(s),{music:true,sfx:true,musicVolume:.42,sfxVolume:.73});
 saveAudioMix({sfxVolume:0},s);saveAudioMix({sfx:false},s);saveAudioMix({sfx:true},s);
 assert.equal(readAudioMix(s).sfxVolume,0);
 s.setItem('sk-audio','corrupt');assert.equal(readAudioMix(s).musicVolume,1);
 s.setItem('sk-audio',JSON.stringify({musicVolume:5,sfxVolume:-3}));
 assert.equal(readAudioMix(s).musicVolume,1);assert.equal(readAudioMix(s).sfxVolume,0);
});
test('viewer preferences persist separately and settings expose accessible independent controls',()=>{
 const s=storage();saveViewerSettings({cameraDrones:false},s);saveViewerSettings({depthOfField:false},s);
 assert.deepEqual(readViewerSettings(s),{cameraDrones:false,depthOfField:false});
 const html=renderSettings({mix:{music:true,sfx:false,musicVolume:.42,sfxVolume:.73},viewer:readViewerSettings(s),chatShown:false});
 assert.match(html,/aria-label="Music volume"/);assert.match(html,/aria-label="Sound effects volume"/);
 assert.match(html,/value="42"/);assert.match(html,/value="73"/);
 assert.match(html,/data-setting="sfx" role="switch" aria-checked="false"/);
 assert.match(html,/data-setting="cameraDrones" role="switch" aria-checked="false"/);
 assert.match(html,/data-setting="depthOfField" role="switch" aria-checked="false"/);
 assert.match(html,/data-do="reset-settings"/);
});

test('custom match colors are validated, independent, persistent and share a stable palette',async()=>{
 const {SHIP_COLORS,DEFAULT_SHIP_COLORS,normalizeShipColor,readShipColors,saveShipColors,applyShipColors}=await import('../js/ship-colors.js');
 const s=storage(),original=[...SHIP_COLORS],props=new Map(),doc={documentElement:{style:{setProperty:(k,v)=>props.set(k,v)}}};
 assert.equal(normalizeShipColor(' #AbC '),'#aabbcc');
 for(const bad of ['red','#12','rgba(0,0,0,1)','#ffffff;display:none',null])assert.equal(normalizeShipColor(bad),null);
 saveShipColors(['#123456','#abcdef'],s);
 assert.deepEqual(readShipColors(s),['#123456','#abcdef']);
 assert.equal(applyShipColors(readShipColors(s),doc),SHIP_COLORS,'consumers keep the same shared array');
 assert.equal(props.get('--a'),'#123456');assert.equal(props.get('--b'),'#abcdef');
 s.setItem('hb-ship-colors',JSON.stringify(['invalid','#000000']));
 assert.deepEqual(readShipColors(s),[DEFAULT_SHIP_COLORS[0],'#000000'],'any valid hex, including black, is allowed');
 const html=renderSettings({mix:readAudioMix(s),viewer:readViewerSettings(s),chatShown:false,colors:['#123456','#abcdef']});
 assert.match(html,/aria-label="Ship 1 hex color"/);assert.match(html,/aria-label="Ship 2 color picker"/);
 assert.match(html,/value="#123456"/);assert.match(html,/Cyan \/ Coral ship colors/);
 applyShipColors(original);
});

test('3D team materials refresh together, including outlines, debris and world guides',async()=>{
 const [{default:vm},{readFile},THREE,{SHIP_COLORS,applyShipColors}]=await Promise.all([import('node:vm'),import('node:fs/promises'),import('three'),import('../js/ship-colors.js')]);
 const source=(await readFile(new URL('../js/scene.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'').replaceAll('export const ','const ').replace('export class Scene','globalThis.BroadcastScene=class Scene');
 const original=[...SHIP_COLORS],sandbox={THREE,SHIP_COLORS,applyShipColors,window:{innerWidth:1280,innerHeight:720},readViewerSettings:()=>({})};
 vm.runInNewContext(source+'\nglobalThis.models=[shipModel(0),shipModel(1)];',sandbox);
 const scene=Object.create(sandbox.BroadcastScene.prototype);scene.ships=sandbox.models;
 for(const key of ['chargeLines','chargeBg','stalks','feet','velLines'])scene[key]=[0,1].map(()=>({material:new THREE.LineBasicMaterial()}));
 scene.setShipColors(['#39dd99','#dc65ec']);
 for(let i=0;i<2;i++){
  const color=new THREE.Color(SHIP_COLORS[i]),u=scene.ships[i].userData;
  assert.ok(u.edges.material.color.equals(color.clone().lerp(new THREE.Color('#ffffff'),.55)));
  assert.ok(u.shardMat.color.equals(color.clone().multiplyScalar(.5)));
  assert.ok(u.shardEdge.color.equals(color.clone().lerp(new THREE.Color('#ffffff'),.3)));
  for(const key of ['chargeLines','chargeBg','stalks','feet','velLines'])assert.ok(scene[key][i].material.color.equals(color));
 }
 applyShipColors(original);
 scene.ships.forEach(g=>g.traverse(o=>{o.geometry?.dispose();o.material?.dispose();}));
});
