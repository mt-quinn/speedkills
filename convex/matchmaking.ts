// Pair each eligible ship once per rotation, with an extra opponent for odd rosters.
// Randomness selects opponents when booking; published positions never reshuffle.
export function rotation(ships: any[]): any[][] {
  const waiting = ships.map(s => ({ s, tie: Math.random() })).sort((a,b) => a.s.lastFight-b.s.lastFight || a.tie-b.tie).map(x=>x.s);
  const matches: any[][] = [];
  while (waiting.length > 1) {
    const first = waiting.shift()!;
    const second = waiting.splice(Math.floor(Math.random()*Math.min(5,waiting.length)),1)[0];
    matches.push([first._id,second._id]);
  }
  if(waiting.length) {
    const first=waiting[0], opponents=ships.filter(s=>s._id!==first._id);
    matches.push([first._id,opponents[Math.floor(Math.random()*opponents.length)]._id]);
  }
  return matches;
}
