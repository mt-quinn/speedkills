// Device preferences shared by the league shell and each broadcast frame.
export const AUDIO_DEFAULTS=Object.freeze({music:true,sfx:true,musicVolume:1,sfxVolume:1});
export const VIEW_DEFAULTS=Object.freeze({cameraDrones:true,depthOfField:true});
export const MUSIC_LEVEL=.28*1.15;
export const THRUST_LEVEL=1.15;
const volume=(value,fallback)=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(1,value)):fallback;
function read(key,storage){try{return JSON.parse(storage?.getItem(key)||'null')||{};}catch{return {};}}
export function readAudioMix(storage=globalThis.localStorage){
 const saved=read('sk-audio',storage);
 return {music:typeof saved.music==='boolean'?saved.music:true,sfx:typeof saved.sfx==='boolean'?saved.sfx:true,
  musicVolume:volume(saved.musicVolume,1),sfxVolume:volume(saved.sfxVolume,1)};
}
export function saveAudioMix(patch,storage=globalThis.localStorage){
 const mix={...readAudioMix(storage),...patch};
 mix.musicVolume=volume(mix.musicVolume,1);mix.sfxVolume=volume(mix.sfxVolume,1);
 try{storage?.setItem('sk-audio',JSON.stringify(mix));}catch{}
 return mix;
}
export function readViewerSettings(storage=globalThis.localStorage){return {...VIEW_DEFAULTS,...Object.fromEntries(Object.entries(read('hb-viewer-settings',storage)).filter(([k,v])=>k in VIEW_DEFAULTS&&typeof v==='boolean'))};}
export function saveViewerSettings(patch,storage=globalThis.localStorage){const prefs={...readViewerSettings(storage),...patch};try{storage?.setItem('hb-viewer-settings',JSON.stringify(prefs));}catch{}return prefs;}
