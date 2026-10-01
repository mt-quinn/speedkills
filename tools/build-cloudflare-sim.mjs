import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Use exactly the binary committed for Convex, not a potentially stale local build.
const source = await readFile(new URL('../convex/simBinary.ts', import.meta.url), 'utf8');
const match = source.match(/export const SIM_BINARY =\s*"([A-Za-z0-9+/=]+)"/);
if (!match) throw new Error('Committed simulator binary was not found. Run npm run build:sim.');
const bytes = Buffer.from(match[1], 'base64');
if (!WebAssembly.validate(bytes)) throw new Error('Committed simulator is not valid WASM.');
await mkdir(new URL('../cloudflare/generated/', import.meta.url), { recursive: true });
await writeFile(new URL('../cloudflare/generated/sim.wasm', import.meta.url), bytes);
await writeFile(new URL('../cloudflare/generated/sim-manifest.json', import.meta.url), JSON.stringify({
  sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
}, null, 2) + '\n');
console.log(`Cloudflare simulator prepared: ${bytes.length} bytes, identical to committed Convex WASM.`);
