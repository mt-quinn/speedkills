// One catalog for subtitles, optional recordings, and the recording manifest.
// Each cue has one script. Recording indices select vocal takes, never different wording.
export const VOICES = {
  attack: { station: 'pilot', priority: 1, trigger: 'Enter attack run or punish', text: 'Going in.', delivery: 'Decisive; committing to the attack.' },
  evade: { station: 'pilot', priority: 1, trigger: 'Enter juke', text: 'Breaking hard.', delivery: 'Sharp, focused; under physical strain.' },
  extend: { station: 'pilot', priority: 1, trigger: 'Enter extend', text: 'Opening the range.', delivery: 'Controlled; making room for another pass.' },
  hold_range: { station: 'pilot', priority: 1, trigger: 'Enter Counter holding range; opposing rail has no reload opening', text: 'Holding range.', delivery: 'Steady and watchful.' },
  torpedo_break: { station: 'pilot', priority: 2, trigger: 'Enter torpedo break', text: 'Torpedo inbound. Breaking!', delivery: 'Urgent warning, then a firm action call.' },
  ram: { station: 'pilot', priority: 3, trigger: 'Enter ramming; ranged weapons unavailable', text: 'Ramming. Brace for impact.', delivery: 'Grim resolve; clear enough for the whole crew.' },
  overcharge: { station: 'gunner', priority: 2, trigger: 'Rail enters overcharge', text: 'Overcharging the rail.', delivery: 'Deliberate; a dangerous choice, not a celebration.' },
  launch: { station: 'gunner', priority: 1, trigger: 'Torpedo launch; salvo grouped by cooldown', text: 'Torpedoes away.', delivery: 'Crisp launch confirmation.' },
  fire: { station: 'gunner', priority: 1, trigger: 'Rail fired', text: 'Railgun firing.', delivery: 'Short and matter-of-fact.' },
  rail_restored: { station: 'engineer', priority: 2, trigger: 'Railgun repaired', text: 'Railgun back online.', delivery: 'Brief relief, still working.' },
  rail_lost: { station: 'engineer', priority: 2, trigger: 'Railgun destroyed', text: 'Railgun offline.', delivery: 'Immediate, clear damage report.' },
  drive_restored: { station: 'engineer', priority: 2, trigger: 'Main drive repaired', text: 'Main drive back online.', delivery: 'Relieved but composed.' },
  drive_lost: { station: 'engineer', priority: 2, trigger: 'Main drive destroyed', text: 'Main drive offline.', delivery: 'Serious; the ship has lost its thrust.' },
  crew_lost: { station: 'ops', priority: 3, fallback: true, trigger: 'Crew killed; another conscious survivor reports', text: 'Crew member down.', delivery: 'Restrained shock; keep it intelligible.' },
  pilot_out: { station: 'ops', priority: 3, trigger: 'Pilot blacked out', text: 'Pilot blacked out.', delivery: 'Urgent status report.' },
  defence_dry: { station: 'ops', priority: 2, trigger: 'All working PDC mounts exhausted, once per ship', text: 'Point defence out of ammo.', delivery: 'Plain warning; no panic.' },
  defence_hot: { station: 'ops', priority: 2, trigger: 'All loaded working PDC mounts overheated; at least 15s between warnings', text: 'Point defence overheated.', delivery: 'Tense but precise.' },
  g_limit: { station: 'pilot', priority: 2, trigger: 'Pilot conscious and felt acceleration reaches 7 g; rearm below 6 g', text: 'High-g burn.', delivery: 'Strained breath; every word must remain clear.' },
};
export function voiceState() { return { next: -1, until: -1, priority: 0, last: {}, mode: '', over: false, dry: false, hotAt: -99, gHigh: false }; }
export function voiceRequests(state, raw, crew, events) {
  const out = [];
  for (const e of events) {
    let id = { torp_launch: 'launch', rail_fire: 'fire', crew_killed: 'crew_lost' }[e.k];
    if (e.k === 'repaired' || e.k === 'part_lost') {
      const system = { railgun: 'rail', drive: 'drive' }[e.part];
      if (system) id = `${system}_${e.k === 'repaired' ? 'restored' : 'lost'}`;
    }
    if (id) out.push(id);
    if (e.k === 'blackout' && crew[e.crew]?.station === 'pilot') out.push('pilot_out');
  }
  if (raw.mode !== state.mode) {
    const id = { 'attack run': 'attack', punish: 'attack', juke: 'evade', extend: 'extend', 'holding range': 'hold_range', 'torpedo break': 'torpedo_break', ramming: 'ram' }[raw.mode];
    if (id) out.push(id);
    state.mode = raw.mode;
  }
  const over = raw.rail[4] === 1;
  if (over && !state.over) out.push('overcharge');
  state.over = over;
  const mounts = raw.pdc.filter((p, k) => raw.parts[7 + k] > 0);
  const dry = mounts.length > 0 && mounts.every((p) => p[0] <= 0);
  if (dry && !state.dry) out.push('defence_dry');
  state.dry = dry;
  const loaded = mounts.filter((p) => p[0] > 0);
  if (loaded.length && loaded.every((p) => p[4])) out.push('defence_hot');
  const pilot = crew.findIndex((c) => c.station === 'pilot');
  const g = raw.g || 0;
  if (g < 6) state.gHigh = false;
  if (g >= 7 && !state.gHigh) { out.push('g_limit'); state.gHigh = true; }
  return out;
}
// Highest priority gets the slot. Never attribute speech to dead/unconscious crew.
// Global radio spacing in the HUD prevents the two ships talking over one another.
export function chooseVoice(state, t, raw, crew, ids, available = {}) {
  if (!raw.alive) return null;
  for (const id of [...ids].sort((a, b) => VOICES[b].priority - VOICES[a].priority)) {
    const v = VOICES[id];
    if (t < state.next || (id === 'defence_hot' && t - state.hotAt < 15)) continue;
    let k = crew.findIndex((c, j) => c.station === v.station && raw.crew[j][0] === 0);
    if (k < 0 && v.fallback) k = raw.crew.findIndex((c) => c[0] === 0);
    if (k < 0) continue;
    const recorded = available[id]?.filter((i) => Number.isInteger(i) && i >= 0);
    const choices = recorded?.length ? [...new Set(recorded)].sort((a,b) => a-b) : [0];
    const variation = choices[(choices.indexOf(state.last[id]) + 1) % choices.length];
    state.last[id] = variation; state.next = t + 6; state.until = t + 2.6; state.priority = v.priority; state.speaker = k;
    if (id === 'defence_hot') state.hotAt = t;
    return { id, variation, line: v.text, who: crew[k], station: k };
  }
  return null;
}
