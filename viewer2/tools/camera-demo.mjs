// Prepare a reproducible local review reel from the current native simulator.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const out='viewer2/matches/camera-review';fs.mkdirSync(out,{recursive:true});
for(const [a,b,seed,label] of [[1,2,8000,'Mixed engagement'],[1,4,8001,'Knife fighter mirror'],[2,5,8002,'Counterpuncher mirror'],[0,3,8003,'Reference mirror']]){
 execFileSync('target/release/league',['fight','--a',String(a),'--b',String(b),'--seed',String(seed),'--out',`${out}/${seed}.json`]);
 console.log(`${label}: http://127.0.0.1:8095/broadcast.html?studio=1&file=camera-review/${seed}.json&cameraLab=1&t=0.1&paused=1`);
}
