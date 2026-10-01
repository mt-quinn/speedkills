// Match-side colors are a device preference, never part of the shared league.
export const DEFAULT_SHIP_COLORS=Object.freeze(['#f5a623','#4f8dff']);
export const COLOR_PRESETS=Object.freeze([
 {name:'Amber / Blue',colors:DEFAULT_SHIP_COLORS},
 {name:'Cyan / Coral',colors:['#59d8e5','#ff8275']},
 {name:'Lime / Violet',colors:['#b8e36d','#b299ff']},
 {name:'Rose / Ice',colors:['#f394c2','#9dcdf5']},
 {name:'Gold / Mint',colors:['#e7c769','#72ddba']},
 {name:'Ivory / Red',colors:['#e8e5d6','#ef6571']},
]);
export function normalizeShipColor(value){
 if(typeof value!=='string')return null;
 const color=value.trim();
 if(/^#[\da-f]{6}$/i.test(color))return color.toLowerCase();
 if(/^#[\da-f]{3}$/i.test(color))return '#'+color.slice(1).split('').map(c=>c+c).join('').toLowerCase();
 return null;
}
export function readShipColors(storage=globalThis.localStorage){
 let saved;try{saved=JSON.parse(storage?.getItem('hb-ship-colors')||'null');}catch{}
 return DEFAULT_SHIP_COLORS.map((fallback,i)=>normalizeShipColor(saved?.[i])||fallback);
}
export const SHIP_COLORS=readShipColors();
export function applyShipColors(colors=readShipColors(),doc=globalThis.document){
 for(let i=0;i<2;i++){
  SHIP_COLORS[i]=normalizeShipColor(colors?.[i])||DEFAULT_SHIP_COLORS[i];
  doc?.documentElement?.style.setProperty(i?'--b':'--a',SHIP_COLORS[i]);
 }
 return SHIP_COLORS;
}
export function saveShipColors(colors,storage=globalThis.localStorage){
 const valid=DEFAULT_SHIP_COLORS.map((fallback,i)=>normalizeShipColor(colors?.[i])||fallback);
 try{storage?.setItem('hb-ship-colors',JSON.stringify(valid));}catch{}
 return applyShipColors(valid);
}
