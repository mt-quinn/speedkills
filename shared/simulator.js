import { geeResistance } from '../viewer2/js/gee.js';
const styleIndex = { Reference: 0, Knife: 1, Counter: 2 };
export async function simulator(bytes) {
  const { instance } = await WebAssembly.instantiate(bytes, {}); const e = instance.exports;
  function setup(ships) {
    const p = e.hb_input();
    new Float64Array(e.memory.buffer, p, 16).set(ships.flatMap(s => s.crew.flatMap(c => [c.skill, geeResistance(c)])));
    return [styleIndex[ships[0].style] ?? 0, ships[0].identity, styleIndex[ships[1].style] ?? 0, ships[1].identity];
  }
  return {
    odds(ships, seed, n = 128) { return e.hb_odds(seed, n, ...setup(ships)); },
    fight(ships, seed) {
      const len = e.hb_fight(seed, ...setup(ships)); const ptr = e.hb_output();
      const raw = JSON.parse(new TextDecoder().decode(new Uint8Array(e.memory.buffer, ptr, len)));
      raw.ships.forEach((s, i) => { s.name = ships[i].name; s.crew = ships[i].crew; });
      return raw;
    }
  };
}
export function oddsKey(ships) { return JSON.stringify(['wasm-tactics-v4', ships.map(s => [s.style, s.identity, s.crew.map(c => [c.skill, geeResistance(c)])])]); }
