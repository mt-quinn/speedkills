import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { defence, tactical, decisive, recentRestorations } from '../js/broadcast.js';
import { VOICES, chooseVoice, voiceRequests, voiceState } from '../js/voices.js';
import { rememberResult, loadHistory, form, meetings } from '../js/history.js';
import { settle, record, loadPicks, savePicks } from '../js/prematch.js';
const storage = new Map();
globalThis.localStorage = {getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v)};
const m = JSON.parse(fs.readFileSync(new URL('../matches/L40000.json', import.meta.url)));
const raw = () => structuredClone(m.frames[0].s[0]);
test('tactic changes produce radio cues without interrupting the broadcast', () => {
  const s = voiceState(), r = raw(), crew = m.ships[0].crew;
  for (const [mode, cue] of Object.entries({
    'attack run':'attack', punish:'attack', juke:'evade', extend:'extend',
    'holding range':'hold_range', 'torpedo break':'torpedo_break', ramming:'ram',
  })) {
    r.mode = mode;
    assert.deepEqual(voiceRequests(s,r,crew,[]),[cue]);
    assert.deepEqual(voiceRequests(s,r,crew,[]),[]);
  }
  r.mode = 'juke';
  assert.deepEqual(voiceRequests(s,r,crew,[{k:'defensive_shot',weapon:'railgun'}]),['rail_intercept','evade']);
});
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
test('radio is sparse and uses the fixed script without recordings', () => {
  const s = voiceState(), r = raw(), crew = m.ships[0].crew;
  assert.equal(chooseVoice(s, 0, r, crew, ['fire']).variation, 0);
  assert.equal(chooseVoice(s, 1, r, crew, ['fire']), null);
  assert.equal(chooseVoice(s, 6, r, crew, ['fire']).line, 'Railgun firing.');
});
test('g warning re-arms only after recovery and dry warning is edge-triggered', () => {
  const s = voiceState(), r = raw(), crew = m.ships[0].crew;
  r.g = 8; r.pdc.forEach((p) => p[0] = 0);
  assert.ok(voiceRequests(s,r,crew,[]).includes('g_limit'));
  assert.ok(!voiceRequests(s,r,crew,[]).includes('g_limit'));
  assert.ok(!voiceRequests(s,r,crew,[]).includes('defence_dry'));
  r.g = 3; voiceRequests(s,r,crew,[]); r.g = 8;
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
test('recorded takes rotate while the words stay identical, including extra takes', () => {
  const s = voiceState(), r = raw(), crew = m.ships[0].crew;
  const results = [0,6,12,18].map((t) => chooseVoice(s,t,r,crew,['fire'],{fire:[0,2,12]}));
  assert.deepEqual(results.map((v) => v.variation),[0,2,12,0]);
  assert.deepEqual(results.map((v) => v.line),Array(4).fill('Railgun firing.'));
});
test('engineering calls identify a meaningful system and skip minor component chatter', () => {
  const s = voiceState(), r = raw(), crew = m.ships[0].crew;
  const ids = voiceRequests(s,r,crew,[{k:'part_lost',part:'railgun'}, {k:'repaired',part:'drive'}, {k:'part_lost',part:'rcs_bow_port'}]);
  assert.deepEqual(ids,['rail_lost','drive_restored']);
  assert.equal(chooseVoice(s,0,r,crew,ids).line,'Railgun offline.');
});
test('every cue has exactly one script; manifest filenames are takes of that script', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../docs/voice-manifest.json',import.meta.url)));
  assert.equal(manifest.lines.length,Object.keys(VOICES).length);
  for (const row of manifest.lines) {
    assert.equal(row.text,VOICES[row.id].text);
    assert.equal(VOICES[row.id].lines,undefined);
    assert.equal(row.files.length,row.recommended_takes);
    assert.ok(row.files.every((f,i) => f === `${row.id}_take_${String(i+1).padStart(2,'0')}.wav`));
  }
  assert.equal(manifest.recommended_total_takes,manifest.lines.reduce((n,r) => n+r.recommended_takes,0));
});
test('incoming torpedoes use current positions, not later hits', () => {
  const a = raw(), b = raw();
  const tp = { owner:1, p:a.p.map((x,k) => x + (k === 0 ? 1000 : 0)) };
  assert.match(tactical([a,b],['A','B'],[tp]), /1 torpedo closing on A/);
  tp.p[0] += 5000;
  assert.equal(tactical([a,b],['A','B'],[tp]),'');
});

test('restoration tags follow simulation time and clear on a new system loss', () => {
  const events = [
    {t:10,k:'repaired',ship:0,part:'drive'},
    {t:11,k:'repaired',ship:0,part:'sensors'},
    {t:12,k:'part_lost',ship:0,part:'drive'},
    {t:12,k:'repaired',ship:1,part:'railgun'},
  ];
  assert.deepEqual(recentRestorations(events,0,9),[]);
  assert.deepEqual(recentRestorations(events,0,11),['drive','sensors']);
  assert.deepEqual(recentRestorations(events,0,12),['sensors']);
  assert.deepEqual(recentRestorations(events,0,14.5),[]);
  assert.deepEqual(recentRestorations(events,1,12),['railgun']);
  assert.deepEqual(recentRestorations(events,0,10),['drive']); // backwards seek
});

test('defensive launch comms explain the ammunition choice rather than generic fire', () => {
  const r=raw(),crew=m.ships[0].crew,s=voiceState();
  const ids=voiceRequests(s,r,crew,[{k:'torp_launch'},{k:'defensive_shot',weapon:'torpedo'}]);
  assert.equal(chooseVoice(s,0,r,crew,ids).line,'Counter-torpedo away.');
});
test('a counter-torpedo is not described as an incoming ship threat', () => {
  const r=raw();
  assert.equal(tactical([r,r],['A','B'],[{owner:1,p:r.p,intercept:100}]),'');
});
