// Internal, development-only tooling for exercising ownership without grinding credits.
import { internalMutation, internalQuery, mutation } from './_generated/server';
import { v, ConvexError } from 'convex/values';
import { requirePlayer } from './identity';
import { grantStipend } from './game';
import { ECONOMY, maxBet, betCheck } from '../shared/rules.js';
function devOnly() { if (process.env.CONVEX_CLOUD_URL !== 'https://resolute-crocodile-221.convex.cloud') throw new ConvexError('Lab tooling is disabled outside the development deployment.'); }
export const grant = internalMutation({ args: { token: v.string() }, handler: async (ctx, { token }) => {
 devOnly(); const p = await ctx.db.query('players').withIndex('token', q => q.eq('token',token)).unique(); if(!p) throw new Error('Join first.');
 const old = await ctx.db.query('ledger').withIndex('player',q=>q.eq('player',p._id)).filter(q=>q.eq(q.field('kind'),'lab')).first(); if(old)return;
 await ctx.db.patch(p._id,{balance:p.balance+400000});
 await ctx.db.insert('ledger',{player:p._id,kind:'lab',amount:400000,balance:p.balance+400000,note:'Development verification credits'});
}});
export const status = internalQuery({ args: {}, handler: async ctx => {
 devOnly(); const ch = await ctx.db.query('channel').first();
 const f = ch?.current ? await ctx.db.get(ch.current) : null;
 return {channel:ch,active:f?{id:f._id,sequence:f.sequence,opensAt:f.opensAt,startsAt:f.startsAt,endsAt:f.endsAt,nextAt:f.nextAt}:null};
}});

export const previewCredits = mutation({ args: { token: v.optional(v.string()) }, handler: async (ctx, { token }) => {
 devOnly(); const p = await requirePlayer(ctx);
 const old=await ctx.db.query('ledger').withIndex('player',q=>q.eq('player',p._id)).filter(q=>q.eq(q.field('kind'),'lab')).first();if(old)return;
 await ctx.db.patch(p._id,{balance:p.balance+400000});await ctx.db.insert('ledger',{player:p._id,kind:'lab',amount:400000,balance:p.balance+400000,note:'Design preview credits'});
}});

export const excludeVerificationShips = internalMutation({ args: {}, handler: async ctx => {
 devOnly(); const ships=await ctx.db.query('ships').collect();
 for(const s of ships)if(s.owner){const grant=await ctx.db.query('ledger').withIndex('player',q=>q.eq('player',s.owner!)).filter(q=>q.eq(q.field('note'),'Development verification credits')).first();if(grant)await ctx.db.patch(s._id,{testing:true});}
}});

export const queueStatus = internalQuery({args:{},handler:async ctx=>{
 devOnly();const ch=await ctx.db.query('channel').first(),ships=await ctx.db.query('ships').collect();
 const queue=(ch?.queue??[]).map((pair,index)=>({position:index+1,ships:pair.map(id=>{const s=ships.find(s=>s._id===id);return{name:s?.name,human:!!s?.owner,testing:!!s?.testing};})}));
 const pending=ch?.pending?await ctx.db.get(ch.pending):null;
 const current=ch?.current?await ctx.db.get(ch.current):null;
 return{queue,pendingMatchesHead:!pending||ch?.queue?.[0]?.every((id,i)=>id===pending.ships[i].id),preparing:ch?.preparing,current:current?{sequence:current.sequence,nextAt:current.nextAt}:null};
}});

export const creditAudit = internalQuery({args:{},handler:async ctx=>{
 devOnly();const bad=(n:number)=>!Number.isSafeInteger(n)||n%100!==0;
 const players=await ctx.db.query('players').collect(),ships=await ctx.db.query('ships').collect(),wagers=await ctx.db.query('wagers').collect(),ledger=await ctx.db.query('ledger').collect(),fights=await ctx.db.query('fights').collect();
 return {fractionalPlayers:players.filter(p=>bad(p.balance)||p.candidate&&bad(p.candidate.paid)).length,fractionalShips:ships.filter(s=>bad(s.earnings)).length,fractionalWagers:wagers.filter(w=>[w.stake,w.payout,w.returned,w.net].filter(n=>n!==undefined).some(n=>bad(n!))).length,fractionalLedger:ledger.filter(l=>bad(l.amount)||bad(l.balance)).length,fractionalFights:fights.filter(f=>f.crowd.some(bad)||f.ownerPayout!==undefined&&bad(f.ownerPayout)).length};
}});

export const verifyEconomy = internalMutation({args:{},handler:async ctx=>{
 devOnly();const now=Date.now(),f={opensAt:now-1,startsAt:now+60000,endsAt:now+120000,odds:[.5,.5]};
 if(ECONOMY.starting!==50000||ECONOMY.recovery!==5000)throw new Error('Economy defaults incorrect.');
 betCheck(f,now,0,10000,50000,null,maxBet(50000));
 let capped=false;try{betCheck(f,now,0,10100,50000,null,maxBet(50000));}catch{capped=true;}if(!capped)throw new Error('Spectator cap failed.');
 betCheck(f,now,0,25000,100000,null);
 betCheck(f,now,0,50000,200000,null);
 const id=await ctx.db.insert('players',{token:'economy-check-'+now,name:'Economy verification',balance:0,lastChat:0,lastRecovery:0});
 const p:any=await ctx.db.get(id),ch=await ctx.db.query('channel').first();
 const wager=ch?.current?await ctx.db.insert('wagers',{player:id,fight:ch.current,side:0,stake:100,payout:200}):null;
 if(wager){if(await grantStipend(ctx,p))throw new Error('Unsettled bet triggered refill.');await ctx.db.patch(wager,{returned:0,net:-100});}
 if(!await grantStipend(ctx,p)||p.balance!==5000)throw new Error('First refill failed.');
 p.balance=0;await ctx.db.patch(id,{balance:0});if(await grantStipend(ctx,p))throw new Error('Hourly limit failed.');
 p.lastRecovery=now-3600001;await ctx.db.patch(id,{lastRecovery:p.lastRecovery});if(!await grantStipend(ctx,p)||p.balance!==5000)throw new Error('Hourly refill failed.');
 return{startingCredits:500,balanceCaps:[100,250,500],refillCredits:50,hourlyLimit:true,unsettledBetProtection:!!wager};
}});
