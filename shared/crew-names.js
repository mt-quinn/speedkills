import { MALE_GIVEN, FEMALE_GIVEN, FAMILY } from './terran-name-pool.js';

// Recombine sampled Terran given names and surnames. Equal chances of choosing
// either given-name list; names don't change crew skills or g tolerance.
export function crewName(seed, excluded = []) {
  const taken = new Set(excluded);
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let n = Math.imul(state ^ state >>> 15, state | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
  for (let attempt = 0; attempt < 64; attempt++) {
    const given = random() < .5 ? MALE_GIVEN : FEMALE_GIVEN;
    const name = `${given[Math.floor(random() * given.length)]} ${FAMILY[Math.floor(random() * FAMILY.length)]}`;
    if (!taken.has(name)) return name;
  }
  // Bounded fallback if an unusually large exclusion set blocks random picks.
  const given = [...MALE_GIVEN, ...FEMALE_GIVEN];
  const size = given.length * FAMILY.length, start = Math.floor(random() * size);
  for (let i = 0; i < size; i++) {
    const index = (start + i) % size;
    const name = `${given[Math.floor(index / FAMILY.length)]} ${FAMILY[index % FAMILY.length]}`;
    if (!taken.has(name)) return name;
  }
  throw new Error('No unused crew names remain.');
}
