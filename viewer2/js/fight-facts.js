import { defence } from './broadcast.js';

// A ledger of launches, not PDC firing intervals. Only facts at or before t count.
export class SalvoLedger {
  constructor(events) {
    this.groups=[];this.resolutions=new Map();
    const defensive=new Set(events.filter(e=>e.k==='defensive_shot'&&e.weapon==='torpedo').map(e=>e.munition));
    for(const e of events) {
      if(e.k==='torp_launch'&&!defensive.has(e.id)) {
        let g=this.groups.filter(g=>g.owner===e.ship).at(-1);
        if(!g||e.t-g.first>1.2){g={owner:e.ship,first:e.t,launches:[]};this.groups.push(g);}
        g.launches.push(e);
      }
      if(['torp_down','torp_intercept','torp_hit'].includes(e.k))this.resolutions.set(e.id,e);
    }
  }
  at(defender,t,liveIds) {
    const rows=this.groups.filter(g=>g.owner!==defender&&g.first<=t).map(g=>{
      const launches=g.launches.filter(e=>e.t<=t),events=launches.map(e=>this.resolutions.get(e.id)).filter(e=>e&&e.t<=t);
      const pdc=events.filter(e=>e.k==='torp_down'&&e.by===defender).length;
      const other=events.filter(e=>e.k==='torp_intercept'&&e.by===defender).length;
      const hits=events.filter(e=>e.k==='torp_hit'&&e.victim===defender).length;
      const flying=launches.filter(e=>liveIds.has(e.id)).length;
      const last=Math.max(g.first,...events.map(e=>e.t));
      return{total:launches.length,pdc,other,hits,flying,last,first:g.first};
    }).filter(g=>g.flying||t-g.last<4);
    return rows.sort((a,b)=>b.last-a.last)[0]||null;
  }
}

export function magazine(raw,initial) {
  const d=defence(raw),initialPdc=initial.pdc.reduce((n,p)=>n+p[0],0);
  const level=(value,max,limit,working=true)=>!working?'disabled':value<=.01?'empty':value<=limit||value/Math.max(1,max)<=.15?'low':'normal';
  return [
    {key:'RAIL',value:raw.rail[3],unit:'',level:level(raw.rail[3],initial.rail[3],2,raw.parts[11]>0&&d.powered)},
    {key:'TORP',value:raw.torps[0],unit:'',level:level(raw.torps[0],initial.torps[0],2,raw.parts[10]>0&&d.powered)},
    {key:'PDC',value:d.ammo<=.01?0:d.ammo<1?'<1':Math.ceil(d.ammo),unit:'s',level:level(d.ammo,initialPdc,6,d.working>0&&d.powered)},
  ];
}

export function shipOpportunity(raws,i,torpedoes=[]) {
  const r=raws[i],o=raws[1-i],own=defence(r),enemy=defence(o);
  if(!r.alive||!o.alive)return null;
  const incoming=torpedoes.filter(tp=>tp.owner!==i&&tp.extra==null&&tp.pos.distanceTo({x:r.p[0],y:r.p[1],z:r.p[2]})<2500).length;
  if(incoming&&(!own.loaded||!own.working))return{kind:'danger',label:'DEFENCE OPEN',text:`${incoming} incoming · no PDC cover`};
  if(incoming&&own.hot===own.loaded)return{kind:'danger',label:'PDC COOLING',text:`${incoming} incoming · mounts overheated`};
  if(r.mode==='rail defence')return{kind:'defence',label:'RAIL INTERCEPT',text:'Railgun assigned to torpedo'};
  if(r.mode==='counter torpedo')return{kind:'defence',label:'COUNTER-TORPEDO',text:'Torpedo assigned to defence'};
  if(own.powered&&r.torps[0]>0&&r.parts[10]>0&&(!enemy.loaded||!enemy.working))return{kind:'opening',label:'TORPEDO OPENING',text:'Opponent has no PDC cover'};
  if(own.powered&&r.torps[0]>0&&r.parts[10]>0&&enemy.hot===enemy.loaded)return{kind:'opening',label:'TORPEDO WINDOW',text:'Opponent’s PDC is cooling'};
  if(own.powered&&r.parts[11]>0&&r.rail[3]>0&&r.rail[0]>=.99&&o.rail[2]>1.5)return{kind:'opening',label:'RAIL WINDOW',text:'Charged · opponent reloading'};
  return null;
}
