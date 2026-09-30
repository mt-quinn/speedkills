import { readFile, writeFile } from 'node:fs/promises';
const wasm = await readFile('target/wasm32-unknown-unknown/release/hb_live_sim.wasm');
await writeFile('convex/simBinary.ts', `// Generated from crates/live-sim; rebuild with npm run build:sim.\nexport const SIM_BINARY = ${JSON.stringify(wasm.toString('base64'))};\n`);
console.log(`Embedded ${wasm.length} bytes of the duel simulator.`);
