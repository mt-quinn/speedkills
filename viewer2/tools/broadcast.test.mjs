import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { defence, tactical, decisive } from '../js/broadcast.js';
import { chooseVoice, voiceRequests, voiceState } from '../js/voices.js';
import { rememberResult, loadHistory, form, meetings } from '../js/history.js';
import { settle, record, loadPicks, savePicks } from '../js/prematch.js';
const storage = new Map();
globalThis.localStorage = {getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v)};
const m = JSON.parse(fs.readFileSync(new URL('../matches/L40000.json', import.meta.url)));
const raw = () => structuredClone(m.frames[0].s[0]);
test('dead and unconscious crew cannot speak; casualty report uses survivor', () => {
  const r = raw(), crew = m.ships[0].crew;
  r.crew[1][0] = 2;
  assert.equal(chooseVoice(voiceState(), 1, r, crew, ['fire']), null);
  r.crew[0][0] = 1;
  assert.equal(chooseVoice(voiceState(), 1, r, crew, ['attack']), null);
  r.crew[3][0] = 2;
  assert.equal(chooseVoice(voiceState(), 1, r, crew, ['crew_lost']).who.name, crew[2].name);
  r.alive = false;
  assert.equal(chooseVoice(voiceState(), 1, r, crew, ['crew_lost']), null);
});
test('defence excludes disabled mounts; current state supplies opening', () => {
  const a = raw(), b = raw();
  a.parts[7] = 0; a.pdc[1][0] = a.pdc[2][0] = 0;
  assert.equal(defence(a).ammo, 0);
  assert.match(tactical([a,b], ['A','B']), /A has no point defence/);
  assert.equal(tactical([b,b], ['A','B']), '');
});
test('radio is sparse and variants rotate', () => {
  const s = voiceState(), r = raw(), crew = m.ships[0].crew;
  assert.equal(chooseVoice(s, 0, r, crew, ['fire']).variation, 0);
  assert.equal(chooseVoice(s, 1, r, crew, ['fire']), null);
  assert.equal(chooseVoice(s, 6, r, crew, ['fire']).variation, 1);
});
test('g warning re-arms only after recovery and dry warning is edge-triggered', () => {
  const s = voiceState(), r = raw(), crew = m.ships[0].crew;
  r.crew[0][2] = .8; r.pdc.forEach((p) => p[0] = 0);
  assert.ok(voiceRequests(s,r,crew,[]).includes('g_limit'));
  assert.ok(!voiceRequests(s,r,crew,[]).includes('g_limit'));
  assert.ok(!voiceRequests(s,r,crew,[]).includes('defence_dry'));
  r.crew[0][2] = .3; voiceRequests(s,r,crew,[]); r.crew[0][2] = .9;
  assert.ok(voiceRequests(s,r,crew,[]).includes('g_limit'));
});
test('decisive replay bounded and final explanation drawn from recorded finish', () => {
  const d = decisive(m), end = m.events.find((e) => e.k === 'end').t;
  assert.ok(d.start >= end - 12 && d.start <= end - 4);
  assert.equal(d.end, end + 1.4);
  assert.match(d.story, /torpedo/);
});
test('history and pick settlement remain idempotent across replay', () => {
  storage.clear(); rememberResult(m); rememberResult(m);
  assert.equal(loadHistory().length, 1);
  assert.equal(form(m.ships[0].name), 'W');
  assert.match(meetings(...m.ships.map((s) => s.name)), /1–0/);
  savePicks({ 'a': {pick:0,side:0,odds:.4}, 'skip':{seen:true} });
  settle('a',0); settle('a',1);
  assert.equal(record(loadPicks()).right,1);
  assert.equal(settle('skip',0),null);
  assert.equal(record(loadPicks()).n,1);
});
test('partial recorded packs select matching subtitle variations', () => {
  const s = voiceState(), r = raw(), crew = m.ships[0].crew;
  assert.equal(chooseVoice(s, 0, r, crew, ['fire'], {fire:[0,2]}).variation,0);
  assert.equal(chooseVoice(s, 6, r, crew, ['fire'], {fire:[0,2]}).variation,2);
  assert.equal(chooseVoice(s, 12, r, crew, ['fire'], {fire:[0,2]}).variation,0);
});
test('incoming torpedoes use current positions, not later hits', () => {
  const a = raw(), b = raw();
  const tp = { owner:1, p:a.p.map((x,k) => x + (k === 0 ? 1000 : 0)) };
  assert.match(tactical([a,b],['A','B'],[tp]), /1 torpedo closing on A/);
  tp.p[0] += 5000;
  assert.equal(tactical([a,b],['A','B'],[tp]),'');
});
