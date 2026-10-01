import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const engineSource = (await readFile(new URL('../js/audio.js', import.meta.url), 'utf8'))
  .replace(/^import .*;$/gm, '').replace('export class Audio', 'globalThis.BroadcastAudio = class Audio');
const hostSource = (await readFile(new URL('../js/audio-context.js', import.meta.url), 'utf8'))
  .replaceAll('export function ', 'function ');

test('gestures retry suspended audio during loading without duplicating its audio graph', () => {
  let resumes = 0, graphs = 0;
  const parameter = () => ({ value: 0, setTargetAtTime() {} });
  const node = () => ({ gain: parameter(), frequency: parameter(), connect() { return this; }, disconnect() {} });
  const context = { state: 'suspended', currentTime: 0, destination: {},
    createGain: node, createBiquadFilter: node,
    createDynamicsCompressor() { graphs++; return { ...node(), threshold: parameter(), knee: parameter(), ratio: parameter(), attack: parameter(), release: parameter() }; },
    addEventListener() {}, removeEventListener() {} };
  const sandbox = { audioHost: () => ({ resume() { resumes++; return context; } }),
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
