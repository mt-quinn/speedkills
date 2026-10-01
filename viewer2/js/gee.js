// Old snapshots stored a threshold multiplier. Preserve their ranking when displaying
// the new 1–10 resistance stat; new crews store resistance directly.
export function geeResistance(crew) {
  if (Number.isFinite(crew.resistance)) return Math.max(1, Math.min(10, Math.round(crew.resistance)));
  const old = Number(crew.tolerance ?? 1.015);
  return Math.max(1, Math.min(10, Math.round(1 + (old - .88) * 9 / .27)));
}
export function withResistance(crew) {
  const { tolerance, ...member } = crew;
  return { ...member, resistance: geeResistance(crew) };
}
