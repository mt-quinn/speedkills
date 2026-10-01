export const intersects=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const segmentHits=(r,a,b)=>{
  // Sample the screen-space engagement corridor, expanded by its readable width.
  for(let k=0;k<=24;k++){const f=k/24,x=a.x+(b.x-a.x)*f,y=a.y+(b.y-a.y)*f;
    if(x>r.x-12&&x<r.x+r.w+12&&y>r.y-12&&y<r.y+r.h+12)return true;}
  return false;
};

// Joint placement; no after-the-fact push that can put a card back over a ship.
export function placeFightCards({ships,sizes,bounds,obstacles=[],previous=[],corridor=true}) {
  const candidates=ships.map((s,i)=>{
    const {w,h}=sizes[i],r=s.radius+24,rows=[];
    const add=(x,y,docked=false)=>{
      const q={x:clamp(x,bounds.left,bounds.right-w),y:clamp(y,bounds.top,bounds.bottom-h),w,h,docked};
      let cost=Math.hypot(q.x+w/2-s.x,q.y+h/2-s.y)*.11;
      for(const o of ships)if(o.on&&intersects(q,{x:o.x-o.radius-14,y:o.y-o.radius-14,w:2*o.radius+28,h:2*o.radius+28}))cost+=100000;
      for(const o of obstacles)if(intersects(q,o))cost+=o.weight??15000;
      if(corridor&&ships.every(s=>s.on)&&segmentHits(q,ships[0],ships[1]))cost+=12000;
      if(previous[i])cost+=Math.hypot(q.x-previous[i].x,q.y-previous[i].y)*.16;
      if(!s.on&&!docked)cost+=2000;
      rows.push({...q,cost});
    };
    for(const [x,y] of [[s.x+r,s.y-h/2],[s.x-r-w,s.y-h/2],[s.x-w/2,s.y-r-h],[s.x-w/2,s.y+r],
      [s.x+r,s.y-r-h],[s.x-r-w,s.y-r-h],[s.x+r,s.y+r],[s.x-r-w,s.y+r]])add(x,y);
    for(const y of [bounds.top,bounds.bottom-h,(bounds.top+bounds.bottom-h)/2]){
      add(bounds.left,y,true);add(bounds.right-w,y,true);
      add((bounds.left+bounds.right-w)/2,y,true);
    }
    if(previous[i])add(previous[i].x,previous[i].y,previous[i].docked);
    return rows;
  });
  let best,score=Infinity;
  for(const a of candidates[0])for(const b of candidates[1]){
    const value=a.cost+b.cost+(intersects(a,b)?200000:0);
    if(value<score){score=value;best=[a,b];}
  }
  return{cards:best,score,blocked:best.map(r=>ships.some(s=>s.on&&intersects(r,{x:s.x-s.radius,y:s.y-s.radius,w:s.radius*2,h:s.radius*2})))};
}
