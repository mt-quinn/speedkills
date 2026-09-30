import fs from 'node:fs';
import path from 'node:path';
import { VOICES, voiceState, voiceRequests, chooseVoice } from '../js/voices.js';
const root = path.resolve(import.meta.dirname, '..');
const card = JSON.parse(fs.readFileSync(path.join(root, 'matches/index.json')));
const counts = Object.fromEntries(Object.keys(VOICES).map((k) => [k, 0]));
let seconds = 0;
const perFight = [];
for (const entry of card) {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'matches', entry.file)));
  const states = [voiceState(), voiceState()], local = { ...counts };
  for (const k in local) local[k] = 0;
  let last = -1, radioNext = -1;
  const end = m.events.find((e) => e.k === 'end').t;
  for (const frame of m.frames) {
    if (frame.t >= end) break;
    const events = m.events.filter((e) => e.t > last && e.t <= frame.t);
    for (let i = 0; i < 2; i++) {
      const ids = voiceRequests(states[i], frame.s[i], m.ships[i].crew, events.filter((e) => e.ship === i));
      if (frame.t < radioNext) continue;
      const v = chooseVoice(states[i], frame.t, frame.s[i], m.ships[i].crew, ids);
      if (v) { counts[v.id]++; local[v.id]++; radioNext = frame.t + 3; }
    }
    last = frame.t;
  }
  seconds += end; perFight.push({ file: entry.file, seconds: end, counts: local });
}
const rows = Object.entries(VOICES).map(([id, v]) => {
  const mean = counts[id] / card.length;
  const recommended = mean >= 3 ? 8 : mean >= 1 ? 6 : mean >= .25 ? 4 : 3;
  return { id, station: v.station, trigger: v.trigger, priority: v.priority, observed: counts[id], per_fight: +mean.toFixed(2), per_minute: +(counts[id] * 60 / seconds).toFixed(2), recommended_variations: Math.min(recommended, v.lines.length), lines: v.lines, files: v.lines.map((_, i) => `${id}_${String(i + 1).padStart(2, '0')}.wav`) };
});
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs/voice-manifest.json'), JSON.stringify({ measurement: '30 Hz recorded-card playback, same scheduler as HUD; includes global 3s and per-ship 6s spacing, fit speakers only. Actual display frame timing can change counts slightly.', card: card.map((e) => e.file), fights: card.length, seconds, lines: rows, perFight }, null, 2) + '\n');
const md = ['# Crew comms recording manifest', '', 'Record the recommended number first; the remaining scripted alternatives are optional. One reusable comms voice pack works across the roster. Separate character performances can come later.', '', `Measured on ${card.length} unfiltered fights (${(seconds / 60).toFixed(1)} match minutes). Counts reflect emitted subtitles at 30 Hz, after radio spacing and conscious-speaker checks—not raw trigger counts. Actual display timing may change totals slightly. Rare lines still need 3 takes because their repetition is conspicuous.`, '', '| Cue | Speaker | Plays/fight | Plays/min | Recommended variations |', '|---|---|---:|---:|---:|', ...rows.map((r) => `| ${r.id} | ${r.station} | ${r.per_fight} | ${r.per_minute} | ${r.recommended_variations} |`), '', '## Recording workflow', '', 'Use a quiet room and keep the phone distance consistent. Record clean, dry speech; keep the originals before applying your comms treatment in Audacity. Aim for 0.5–2.5 seconds per line, with about half a second of silence between takes. Avoid saying crew or ship names: these clips are reusable, and the subtitle identifies the speaker.', '', 'Export individual mono WAV files named below. Put processed clips in `viewer2/sfx/voices/`, then run `node --experimental-default-type=module viewer2/tools/register-voices.mjs`. The player accepts WAV, MP3, OGG, Opus or M4A files that the browser can decode. Speech follows the effects toggle, stays at normal pitch during slow motion, and ducks the music. Missing recordings simply leave subtitles.', '', 'Suggested recording order: attack, evade, fire, launch, extend, then damage and emergency cues. Deliver routine calls clearly and tightly; emergencies more strained, never long speeches. Leave system names and casualty names to the visual broadcast. Only conscious crew speak; crew-lost may be reported by any conscious survivor.', '', ...rows.flatMap((r) => [`## ${r.id} — ${r.recommended_variations} recommended variations`, '', `Trigger: ${r.trigger}. Observed ${r.observed} times on this card.`, '', ...r.lines.map((line, i) => `- [ ] \`${r.files[i]}\` — “${line}”${i >= r.recommended_variations ? ' (optional extra)' : ''}`), ''])];
fs.writeFileSync(path.join(root, 'docs/VOICE_RECORDING_MANIFEST.md'), md.join('\n').trimEnd() + '\n');
console.log(`Measured ${seconds.toFixed(0)}s; wrote recording manifest with ${rows.reduce((s, r) => s + r.recommended_variations, 0)} recommended clips.`);
