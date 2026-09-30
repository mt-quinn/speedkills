'use node';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';
import { randomInt } from 'node:crypto';
import { SIM_BINARY } from './simBinary';
import { simulator, oddsKey } from '../shared/simulator.js';
import { fightStats } from '../shared/rules.js';
import { roster } from './roster';
export const prepare = internalAction({ args: { generation: v.number() }, handler: async (ctx, { generation }) => {
  const traces: any[]=[];
  try {
    const state=await ctx.runQuery(internal.game.preparation,{generation});if(!state)return;
    const sequence=state.sequence;
    const ships=state.ships.map((s:any)=>({id:s._id,name:s.name,style:s.style,crew:s.crew,identity:s.identity,revision:s.revision,...(s.owner?{owner:s.owner}:{})}));
    const sim=await simulator(Buffer.from(SIM_BINARY,'base64'));
    async function record(ships:any[],probability:number,samples:number) {
      const seed=randomInt(1,1000000000),raw=sim.fight(ships,seed),duration=raw.frames.at(-1).t;
      const trace=await ctx.storage.store(new Blob([JSON.stringify(raw)],{type:'application/json'}));traces.push(trace);
      const cause=raw.summary.finish_cause;
      const story=raw.winner===null?'Neither ship secured the win.':cause==='torpedo'?'The final torpedo strike decided the duel.':cause==='railgun'?'The final railgun strike decided the duel.':'The surviving ship takes the win.';
      return {sequence,ships,odds:[probability,1-probability],oddsSamples:samples,oddsKey:oddsKey(ships),seed,duration,winner:raw.winner,stats:fightStats(raw),story,trace,crowd:[randomInt(20000,80000)*100,randomInt(20000,80000)*100]};
    }
    const cached=await ctx.runQuery(internal.game.cachedOdds,{key:oddsKey(ships)});
    const baseline=ships.every((s:any)=>s.identity>=1000&&s.identity<1010);
    let probability=cached?.probability,samples=cached?.samples??128;
    if(probability==null&&baseline){probability=roster.odds[ships[0].identity-1000][ships[1].identity-1000];samples=400;}
    if(probability==null)probability=sim.odds(ships,randomInt(1,1000000000),samples);
    probability=Math.max(.05,Math.min(.95,probability!));
    const data=await record(ships,probability,samples);
    const staged=await ctx.runMutation(internal.game.stage,{generation,data});
    if(!staged)for(const trace of traces)await ctx.storage.delete(trace);
  }catch(e:any){
    for(const trace of traces)await ctx.storage.delete(trace);
    await ctx.runMutation(internal.game.failed,{generation,message:e.message||'Simulation preparation failed'});
  }
}});
