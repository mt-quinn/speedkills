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
  const takes = mean >= 3 ? 8 : mean >= 1 ? 6 : mean >= .25 ? 4 : 3;
  return { id, station: v.station, trigger: v.trigger, priority: v.priority, text: v.text, delivery: v.delivery, observed: counts[id], per_fight: +mean.toFixed(2), per_minute: +(counts[id] * 60 / seconds).toFixed(2), recommended_takes: takes, files: Array.from({length:takes}, (_, i) => `${id}_take_${String(i + 1).padStart(2, '0')}.wav`) };
});
const total = rows.reduce((s, r) => s + r.recommended_takes, 0);
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs/voice-manifest.json'), JSON.stringify({ recording_model: 'One fixed script per cue; multiple performances of exactly the same words.', measurement: '30 Hz recorded-card playback, same scheduler as HUD; includes global 3s and per-ship 6s spacing, fit speakers only. Actual display frame timing can change counts slightly.', card: card.map((e) => e.file), fights: card.length, seconds, recommended_total_takes: total, lines: rows, perFight }, null, 2) + '\n');
const md = ['# Crew comms recording manifest', '', `**${rows.length} scripts · ${total} recommended recordings.** Record the exact same words for every take of a script. The takes provide vocal variation; there are no alternate-wording lists.`, '', 'Keep one consistent character voice within each script. Change emphasis, pace, breath and the amount of strain slightly. Aim for usable performances of the same intent, rather than different impressions or exaggerated moods. One shared comms pack works across the roster; separate character packs can come later.', '', `Measured on ${card.length} unfiltered fights (${(seconds / 60).toFixed(1)} match minutes). Counts reflect emitted subtitles at 30 Hz after radio spacing and conscious-speaker checks. Frequent cues get 8 takes (3+ plays/fight) or 6 (1+); occasional cues get 4 (0.25+), and rare cues get 3. Zero observed plays means rare on this sample, not unused.`, '', '| Exact script | Speaker | Plays/fight | Plays/min | Record this many takes |', '|---|---|---:|---:|---:|', ...rows.map((r) => `| “${r.text}” | ${r.station} | ${r.per_fight} | ${r.per_minute} | **${r.recommended_takes}** |`), '', '## Recording workflow', '', 'Use a quiet room and keep the phone distance consistent. Record clean speech and save the originals before applying your comms treatment in Audacity. Aim for 0.5–2.5 seconds per take, with a short pause between takes. Clarity comes first: keep urgent lines intelligible and avoid long improvised additions, crew names or ship names.', '', 'Each numbered file is another performance of the same script. Export individual mono WAV files to `viewer2/sfx/voices/`, then run `node --experimental-default-type=module viewer2/tools/register-voices.mjs`. WAV, MP3, OGG, Opus and M4A are supported when the browser can decode them. Extra numbered takes are welcome; partial sets work too. The subtitle stays identical whichever take plays.', '', 'Speech follows the effects toggle, stays at normal pitch during slow motion, and ducks the music. Missing recordings leave subtitles. Only conscious crew speak; any conscious survivor can report a crew casualty.', '', 'Start with the frequent calls: “Going in,” “Torpedoes away,” “Railgun firing,” and “Breaking hard.” Then record the remaining scripts. Generic system-loss and repair calls have been removed: engineering speech identifies the railgun or main drive. Other component changes remain visible in the HUD.', '', ...rows.flatMap((r) => [`## ${r.id} — ${r.recommended_takes} takes`, '', `**Say every time: “${r.text}”**`, '', `Delivery: ${r.delivery}`, '', `Trigger: ${r.trigger}. Observed ${r.observed} times on this card.`, '', ...r.files.map((file, i) => `- [ ] Take ${i + 1}: \`${file}\``), ''])];
fs.writeFileSync(path.join(root, 'docs/VOICE_RECORDING_MANIFEST.md'), md.join('\n').trimEnd() + '\n');
console.log(`Measured ${seconds.toFixed(0)}s; wrote ${rows.length} fixed scripts and ${total} recommended vocal takes.`);
