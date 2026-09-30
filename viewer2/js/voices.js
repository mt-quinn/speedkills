// One catalog for subtitles, optional recordings, and the recording manifest.
export const VOICES = {
  attack: { station: 'pilot', priority: 1, trigger: 'Enter attack run or punish', lines: ['Going in.', 'Taking the opening.', 'Closing for the shot.', 'Pressing the attack.', 'Moving in.', 'We have an opening.', 'Commit to the run.', 'Taking the fight to them.'] },
  evade: { station: 'pilot', priority: 1, trigger: 'Enter juke', lines: ['Breaking!', 'Changing vector.', 'Hard break.', 'Rolling clear.', 'Hold on.', 'Jinking now.', 'Off their line.', 'Burning clear.'] },
  extend: { station: 'pilot', priority: 1, trigger: 'Enter extend', lines: ['Extending.', 'Opening the range.', 'Resetting the run.', 'Pulling clear.', 'Making room.', 'Coming around.'] },
  hold_range: { station: 'pilot', priority: 1, trigger: 'Enter Counter holding range; opposing rail has no reload opening', lines: ['Holding the range.', 'Bleeding closing speed.', 'Keeping our distance.', 'Hold here. Wait for the shot.', 'Braking the approach.', 'Keeping room to move.'] },
  torpedo_break: { station: 'pilot', priority: 2, trigger: 'Enter torpedo break', lines: ['Torpedo — hard over!', 'Incoming. Breaking hard!', 'Torpedo inbound. Hold on.', 'Missile closing. Hard break!', 'Burning off the intercept.', 'Incoming. Changing vector!'] },
  ram: { station: 'pilot', priority: 3, trigger: 'Enter ramming; ranged weapons exhausted', lines: ['Weapons are out. Ramming speed!', 'Ranged weapons lost. Going through them.', 'Weapons unavailable. Brace for collision.', 'Cannot fire. Taking her in.'] },
  overcharge: { station: 'gunner', priority: 2, trigger: 'Rail enters overcharge', lines: ['Safeties off.', 'Overcharging the rail.', 'Pushing the capacitors.', 'Taking the overload shot.', 'Running the gun hot.', 'One hard shot.'] },
  launch: { station: 'gunner', priority: 1, trigger: 'Torpedo launch; salvo grouped by cooldown', lines: ['Birds away.', 'Torpedoes away.', 'Salvo out.', 'Launch confirmed.', 'Fish in the water.', 'Tubes clear.', 'Sending the salvo.', 'Torpedoes running.'] },
  fire: { station: 'gunner', priority: 1, trigger: 'Rail fired', lines: ['Firing.', 'Shot away.', 'Rail away.', 'Round out.', 'Taking the shot.', 'Gun fired.', 'Sending it.', 'Rail fired.'] },
  repaired: { station: 'engineer', priority: 2, trigger: 'Destroyed component repaired', lines: ['System back online.', 'Repairs holding.', 'We have that system back.', 'Back in service.', 'Restored. Keep fighting.', 'Repair complete.'] },
  system_lost: { station: 'engineer', priority: 2, trigger: 'Component destroyed', lines: ['System down!', 'Lost a system!', 'Damage control, on it.', 'We have a system failure.', 'That system is out.', 'Working on the damage.'] },
  crew_lost: { station: 'ops', priority: 3, fallback: true, trigger: 'Crew killed; another conscious survivor reports', lines: ['Crew member down.', 'We lost someone.', 'Station casualty.', 'No response from that station.'] },
  pilot_out: { station: 'ops', priority: 3, trigger: 'Pilot blacked out', lines: ['Pilot is out. Holding steady.', 'Pilot unconscious. Hold course.', 'Pilot blacked out. Stay steady.', 'No response from the pilot.'] },
  defence_dry: { station: 'ops', priority: 2, trigger: 'All working PDC mounts exhausted, once per ship', lines: ['Point defence dry.', 'No defence rounds left.', 'PDC ammunition exhausted.', 'Defence guns are empty.'] },
  defence_hot: { station: 'ops', priority: 2, trigger: 'All loaded working PDC mounts overheated; at least 15s between warnings', lines: ['Defence guns too hot.', 'PDCs overheated. Cooling.', 'Defence needs to cool.', 'Point defence is cooling down.', 'Defence cooling. Keep clear.', 'Hot mounts. Need a moment.'] },
  g_limit: { station: 'pilot', priority: 2, trigger: 'Pilot conscious and normalized g dose crosses 0.75; rearm below 0.4', lines: ['Near my limit.', 'Need to ease this burn.', 'Vision closing in.', 'Too much gee. Easing off.'] },
};
export function voiceState() { return { next: -1, until: -1, priority: 0, last: {}, mode: '', over: false, dry: false, hotAt: -99, gHigh: false }; }
export function voiceRequests(state, raw, crew, events) {
  const out = [];
  for (const e of events) {
    const id = { torp_launch: 'launch', rail_fire: 'fire', repaired: 'repaired', part_lost: 'system_lost', crew_killed: 'crew_lost' }[e.k];
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
  const dose = raw.crew[pilot]?.[2] || 0;
  if (dose < 0.4) state.gHigh = false;
  if (dose >= 0.75 && !state.gHigh) { out.push('g_limit'); state.gHigh = true; }
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
    const recorded = available[id]?.filter((i) => Number.isInteger(i) && i >= 0 && i < v.lines.length);
    const choices = recorded?.length ? recorded : v.lines.map((_, i) => i);
    const variation = choices[(choices.indexOf(state.last[id]) + 1) % choices.length];
    state.last[id] = variation; state.next = t + 6; state.until = t + 2.6; state.priority = v.priority; state.speaker = k;
    if (id === 'defence_hot') state.hotAt = t;
    return { id, variation, line: v.lines[variation], who: crew[k], station: k };
  }
  return null;
}
