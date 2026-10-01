// Part order matches the recorded ship.parts array. Each component keeps its own tag.
export const SYSTEM_PARTS = [
  ['drive','DRIVE'],['rcs_bow_port','BOW L RCS'],['rcs_bow_stbd','BOW R RCS'],
  ['rcs_stern_port','STERN L RCS'],['rcs_stern_stbd','STERN R RCS'],
  ['reactor','REACTOR'],['sensors','SENSORS'],['pdc_dorsal','DORSAL PDC'],
  ['pdc_port','PORT PDC'],['pdc_stbd','STBD PDC'],['launcher','TORP TUBES'],['railgun','RAILGUN'],
];
export function systemFlags(raw, events, ship, t, hold=3.5) {
  const restored=new Map();
  for(const e of events) {
    if(e.ship!==ship||e.t>t||e.t<=t-hold)continue;
    if(e.k==='repaired')restored.set(e.part,e.t);
    else if(e.k==='part_lost')restored.delete(e.part);
  }
  return SYSTEM_PARTS.flatMap(([part,label],index)=>{
    if(raw.parts[index]<=0) {
      const repairing=raw.repair?.[0]===index;
      const progress=repairing?Math.max(0,Math.min(1,raw.repair[1])):0;
      const paused=repairing&&(!raw.alive||!raw.repair[2]);
      return [{part,label,state:'out',repairing,progress,paused}];
    }
    return restored.has(part)?[{part,label,state:'restored',repairing:false,progress:1,paused:false}]:[];
  });
}
