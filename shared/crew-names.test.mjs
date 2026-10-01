import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crewName } from './crew-names.js';
import { MALE_GIVEN, FEMALE_GIVEN, FAMILY } from './terran-name-pool.js';
import { candidate } from './rules.js';
import { portrait } from '../viewer2/js/portraits.js';

test('name pools derive from all 40 sampled Donjon Terran batches', () => {
  const source = JSON.parse(readFileSync(new URL('../viewer2/docs/terran-name-samples.json', import.meta.url)));
  const male = source.samples['Terran Male'], female = source.samples['Terran Female'];
  assert.equal(male.length, 20); assert.equal(female.length, 20);
  for(const batch of [...male,...female])assert.equal(batch.length,10);
  assert.deepEqual(MALE_GIVEN, [...new Set(male.flat().map(n=>n.split(' ',1)[0]))].sort());
  assert.deepEqual(FEMALE_GIVEN, [...new Set(female.flat().map(n=>n.split(' ',1)[0]))].sort());
  assert.deepEqual(FAMILY, [...new Set([...male.flat(),...female.flat()].map(n=>n.slice(n.indexOf(' ')+1)))].sort());
});

test('generated crews have distinct, deterministic names spanning both Terran lists', () => {
  const names = new Set(); let male=0, female=0;
  for(let seed=0;seed<1000;seed++) {
    const name=crewName(seed,names); assert.equal(name,crewName(seed,names)); assert.ok(!names.has(name)); names.add(name);
    const [given,...family]=name.split(' '); assert.ok(FAMILY.includes(family.join(' ')));
    if(MALE_GIVEN.includes(given))male++; if(FEMALE_GIVEN.includes(given))female++;
  }
  assert.equal(names.size,1000); assert.ok(male>350&&female>350);
});

test('scouting excludes current crew without changing its skill rolls', () => {
  const original=candidate(123,'pilot'), replacement=candidate(123,'pilot',[original.name]);
  assert.notEqual(original.name,replacement.name);
  assert.equal(original.skill,replacement.skill); assert.equal(original.tolerance,replacement.tolerance);
  let n=123;const rand=()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};
  rand();const skill=+(0.78+(rand()+rand()+rand())/3*.50).toFixed(3),tolerance=+(0.88+rand()*.27).toFixed(3);
  assert.equal(original.skill,skill);assert.equal(original.tolerance,tolerance);
});

test('new names retain stable portraits with variety across a crew', () => {
  const files=new Set();
  for(let seed=0;seed<40;seed++){const name=crewName(seed);assert.deepEqual(portrait(name),portrait(name));files.add(portrait(name).file);}
  assert.ok(files.size>10);
  assert.equal(portrait('Kaplan').file,'astronaut-helmet.svg');
});
