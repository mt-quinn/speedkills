// Inspector attaches to local workerd, never to the user's browser. Instrumented
// code stays in ignored generated files and is never a deployment entrypoint.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { simulator } from '../shared/simulator.js';
const source = await readFile('convex/roster.ts','utf8');
const roster = JSON.parse(source.slice(source.indexOf('=')+1).trim().replace(/;$/,''));
const baseline = roster.ships.map((s,i)=>({...s,id:`profile-${i}`,identity:1000+i,revision:1}));
const sim = await simulator(await readFile('cloudflare/generated/sim.wasm'));
let largest;
for(let a=0;a<10;a++)for(let b=a+1;b<10;b++){
  const ships=[baseline[a],baseline[b]], raw=JSON.stringify(sim.fight(ships,1337));
  if(!largest||raw.length>largest.rawBytes)largest={ships,rawBytes:raw.length,seed:1337};
}
await writeFile('cloudflare/generated/profile-entry.ts',`import {Simulator} from '../src/simulator'; export default {async fetch(r,e,c){return Response.json(await new Simulator(c,e).benchmark(await r.json()))}}`);
await build({entryPoints:['cloudflare/generated/profile-entry.ts'],bundle:true,format:'esm',platform:'neutral',outfile:'cloudflare/generated/profile-memory.mjs',external:['cloudflare:workers','*.wasm'],plugins:[{
  name:'memory-checkpoints',setup(build){build.onLoad({filter:/src\/simulator\.ts$/},async args=>{
    let contents=await readFile(args.path,'utf8');
    contents=contents.replace('const raw = sim.fight(input.ships, input.seed);','const raw = sim.fight(input.ships, input.seed); debugger;')
      .replace('const bytes = new TextEncoder().encode(json);','const bytes = new TextEncoder().encode(json); debugger;')
      .replace("const cause = raw.summary.finish_cause;","debugger; const cause = raw.summary.finish_cause;");
    return {contents,loader:'ts'};
  });}
}]});
const mf=new Miniflare(convertV4MiniflareOptions({compatibilityDate:'2026-10-01',compatibilityFlags:['nodejs_compat'],inspectorPort:0,
  modules:[{type:'ESModule',path:resolve('cloudflare/generated/profile-memory.mjs')},{type:'CompiledWasm',path:resolve('cloudflare/generated/sim.wasm')}],r2Buckets:{TRACES:'profile-only'}}));
let socket;
try{
  const url=await mf.getInspectorURL();url.protocol='http:';
  const targets=await(await fetch(new URL('/json',url))).json();
  const target=targets.find(t=>t.id==='core:user:');
  if(!target)throw new Error('Missing local simulator inspector');
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let next=0;const pending=new Map(), samples=[];
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  socket.onmessage=async event=>{
    const message=JSON.parse(event.data);
    if(message.id){const p=pending.get(message.id);pending.delete(message.id);message.error?p.reject(new Error(message.error.message)):p.resolve(message.result);}
    if(message.method==='Debugger.paused'){
      samples.push(await send('Runtime.getHeapUsage'));await send('Debugger.resume');
    }
  };
  await send('Debugger.enable');await send('Runtime.enable');
  const response=await mf.dispatchFetch('http://profile/',{method:'POST',body:JSON.stringify({ships:largest.ships,seed:largest.seed,oddsSeed:73421,samples:400,fightId:'profile-largest'})});
  if(!response.ok)throw new Error('Profile failed');
  const metrics=await response.json();
  const conservativeBytes=Math.max(...samples.map(s=>s.totalSize+(s.backingStorageSize??0)+(s.embedderHeapUsedSize??0)))+metrics.wasmMemoryBytes+2*metrics.rawBytes;
  const report={runtime:'local-workerd-inspector',selection:'largest trace among all 45 baseline pairs at seed 1337',samples,
    wasmMemoryBytes:metrics.wasmMemoryBytes,rawBytes:metrics.rawBytes,compressedBytes:metrics.compressedBytes,
    conservativeBytes,limitBytes:128*1024*1024,
    caveat:'Checkpoint samples, not a continuous production peak; bound adds WASM again and two raw trace buffers conservatively.'};
  await writeFile('cloudflare/docs/memory-report.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  if(conservativeBytes>=128*1024*1024)throw new Error('Insufficient conservative memory headroom');
}finally{socket?.close();await mf.dispose();}
