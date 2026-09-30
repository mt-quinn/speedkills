import fs from 'node:fs';
import path from 'node:path';
import { VOICES } from '../js/voices.js';
const dir = path.resolve(import.meta.dirname, '../sfx/voices');
const files = fs.readdirSync(dir).filter((f) => /\.(wav|mp3|ogg|opus|m4a)$/i.test(f));
const manifest = {};
for (const id of Object.keys(VOICES)) {
  const clips = files.filter((f) => new RegExp(`^${id}_\\d+\\.`).test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (clips.length) manifest[id] = clips;
}
fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Registered ${Object.values(manifest).flat().length} clips across ${Object.keys(manifest).length} cues.`);
