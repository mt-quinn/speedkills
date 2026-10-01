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
