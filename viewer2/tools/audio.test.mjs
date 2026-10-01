import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const engineSource = (await readFile(new URL('../js/audio.js', import.meta.url), 'utf8'))
  .replace(/^import .*;$/gm, '').replace('export class Audio', 'globalThis.BroadcastAudio = class Audio');
const hostSource = (await readFile(new URL('../js/audio-context.js', import.meta.url), 'utf8'))
  .replaceAll('export function ', 'function ');
const musicSource = (await readFile(new URL('../js/session-music.js', import.meta.url), 'utf8'))
  .replace('export class SessionMusic','class SessionMusic').replace('export function sessionMusic','function sessionMusic');

test('session music keeps one streaming playhead through screens, fights and mute changes',async()=>{
 let graphs=0,plays=0,gain=0;
 const media={paused:true,currentTime:0,dataset:{},addEventListener(){},play(){plays++;this.paused=false;return Promise.resolve();}};
 const node={connect(){return this;},gain:{value:0,setTargetAtTime(value){gain=value;}}};
 const context={state:'running',currentTime:0,destination:{},createMediaElementSource(){graphs++;return node;},createGain(){return node;}};
 const host={context,muted:false,getContext(){return context;}};
 const sandbox={window:{Audio:function(){return media;}},document:{body:{append(){}}},host};
 vm.runInNewContext(musicSource+'\nglobalThis.music=sessionMusic(host);',sandbox);
 const m=sandbox.music;await m.start();assert.equal(gain,0);assert.equal(media.loop,true);
 media.currentTime=83;m.setVisible(true);assert.equal(gain,.28);
 m.setVisible(false);media.currentTime=114;m.setVisible(true);await m.start();
 assert.equal(media.currentTime,114);assert.equal(plays,1);assert.equal(graphs,1);
 host.muted=true;m.updateGate();assert.equal(gain,0);assert.equal(media.paused,false);
 host.muted=false;m.updateGate();assert.equal(gain,.28);
 m.setEnabled(false);assert.equal(gain,0);assert.equal(media.currentTime,114);
 vm.runInNewContext('globalThis.again=sessionMusic(host);',sandbox);assert.equal(sandbox.again,m);
});

test('gestures retry suspended audio during loading without duplicating its audio graph', () => {
  let resumes = 0, graphs = 0;
  const parameter = () => ({ value: 0, setTargetAtTime() {} });
  const node = () => ({ gain: parameter(), frequency: parameter(), connect() { return this; }, disconnect() {} });
  const context = { state: 'suspended', currentTime: 0, destination: {},
    createGain: node, createBiquadFilter: node,
    createDynamicsCompressor() { graphs++; return { ...node(), threshold: parameter(), knee: parameter(), ratio: parameter(), attack: parameter(), release: parameter() }; },
    addEventListener() {}, removeEventListener() {} };
  const sandbox = { sessionMusic:()=>({setEnabled(){},setVisible(){},start(){}}),audioHost: () => ({ resume() { resumes++; return context; } }),
    localStorage: {getItem: () => null}, fetch: () => new Promise(() => {}), THREE: {} };
  vm.runInNewContext(engineSource, sandbox);
  const audio = new sandbox.BroadcastAudio({}, {});
  const loading = audio.enable();
  for(let i=0;i<8;i++)assert.equal(audio.enable(), loading);
  assert.equal(resumes, 9); assert.equal(graphs, 1);
  context.state = 'running'; assert.equal(audio.playing, false, 'running context without loaded sources is not confirmed playback');
  audio.ready = true; audio.sources = [{stop() {}, disconnect() {}}]; assert.equal(audio.playing, true);
  context.state = 'interrupted'; audio.enable(); assert.equal(resumes, 10); assert.equal(audio.playing, false);
  context.state = 'running'; audio.disable(); assert.equal(audio.playing, false);
  audio.dispose(); audio.enable(); assert.equal(resumes, 10, 'removed viewers cannot restart their sources');
});

test('activation listeners survive early failed interactions and include keyboard, touch, forms and focus recovery', () => {
  const listeners = new Map(); let attempts = 0, contexts = 0, resumes = 0;
  const window = { addEventListener(type, listener) { listeners.set(type, listener); },
    AudioContext: class { constructor() { contexts++; this.state = 'suspended'; } resume() { resumes++; return Promise.resolve(); } } };
  const sandbox = { window, parent: window, document: {hidden:false,addEventListener(type, listener) {listeners.set(type,listener);}} };
  vm.runInNewContext(hostSource + '\ncaptureAudioInteractions(() => { audioHost().resume(); });', sandbox);
  for(const type of ['pointerdown','pointerup','click','touchend','keydown','input','change','focusin','wheel']) {
    const listener = listeners.get(type); assert.ok(listener); listener({isTrusted:true}); attempts++;
  }
  listeners.get('pointerdown')({isTrusted:true}); attempts++;
  listeners.get('click')({isTrusted:false});
  assert.equal(contexts,1); assert.equal(resumes,attempts);
  window.__hbAudioHost.context.state = 'running'; listeners.get('click')({isTrusted:true}); assert.equal(resumes,attempts);
  window.__hbAudioHost.context.state = 'suspended'; listeners.get('visibilitychange')(); assert.equal(resumes,attempts+1);
});
