const KEY = 'hb-history-v1';
export function loadHistory() {
  try { const h = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(h) ? h.filter((x) => x && Array.isArray(x.names)) : []; } catch { return []; }
}
export function resultId(raw) { return `${raw.seed ?? ''}:${raw.ships.map((s) => s.name).join(':')}:${raw.frames.at(-1).t}`; }
export function rememberResult(raw) {
  const h = loadHistory(), id = resultId(raw);
  if (h.some((r) => r.id === id)) return;
  h.push({ id, names: raw.ships.map((s) => s.name), winner: raw.winner, at: Date.now() });
  try { localStorage.setItem(KEY, JSON.stringify(h.slice(-500))); } catch { /* private mode */ }
}
export function form(name, history = loadHistory()) {
  return history.filter((r) => r.names.includes(name)).slice(-5).map((r) => r.winner === null ? 'D' : r.names[r.winner] === name ? 'W' : 'L').join(' ') || 'No completed fights';
}
export function meetings(a, b, history = loadHistory()) {
  const rows = history.filter((r) => r.names.includes(a) && r.names.includes(b));
  if (!rows.length) return 'First meeting watched on this device';
  const wins = (n) => rows.filter((r) => r.names[r.winner] === n).length;
  return `Prior meetings watched: ${a} ${wins(a)}–${wins(b)} ${b}${rows.some((r) => r.winner === null) ? ' · includes draws' : ''}`;
}
