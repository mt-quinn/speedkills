import { mutation, query, internalMutation, internalQuery, action } from './_generated/server';
import { internal } from './_generated/api';
import { v, ConvexError } from 'convex/values';
import { ECONOMY, TIMING, phase, maxBet, betCheck, settlement, ownerIncome, crewLocked, candidate, STATIONS, quote } from '../shared/rules.js';
import { withResistance } from '../viewer2/js/gee.js';
import { bettingSummary } from '../shared/betting-summary.js';
import { crewName } from '../shared/crew-names.js';
import { roster } from './roster';
import { rotation } from './matchmaking';
import type { Id } from './_generated/dataModel';
const tokenArg = { token: v.string() };
const channel = (ctx: any) => ctx.db.query('channel').withIndex('key', (q: any) => q.eq('key', 'live')).unique();
async function player(ctx: any, token: string) {
  const p = await ctx.db.query('players').withIndex('token', (q: any) => q.eq('token', token)).unique();
  if (!p) throw new ConvexError('Your session has expired. Reload to reconnect.'); return p;
}
async function move(ctx: any, p: any, amount: number, kind: string, note: string, fight?: any) {
  if (!Number.isSafeInteger(amount) || amount % 100 !== 0) throw new Error('Credit transfers must use whole credits.');
  const balance = p.balance + amount;
  if (balance < 0) throw new ConvexError('Not enough credits.');
  await ctx.db.patch(p._id, { balance }); p.balance = balance;
  await ctx.db.insert('ledger', { player: p._id, kind, amount, balance, note, ...(fight ? { fight } : {}) });
}
export async function grantStipend(ctx: any, p: any) {
  if (p.balance !== 0 || Date.now()-p.lastRecovery < 3600000) return false;
  const wagers=await ctx.db.query('wagers').withIndex('player_fight',(q:any)=>q.eq('player',p._id)).collect();
  if(wagers.some((w:any)=>w.returned===undefined))return false;
  await move(ctx,p,ECONOMY.recovery,'recovery','Hourly refill stipend');
  p.lastRecovery=Date.now();await ctx.db.patch(p._id,{lastRecovery:p.lastRecovery});return true;
}
async function own(ctx: any, p: any) { return ctx.db.query('ships').withIndex('owner', (q: any) => q.eq('owner', p._id)).unique(); }
async function editable(ctx: any, p: any) {
  const ship = await own(ctx, p); if (!ship) throw new ConvexError('Sponsor a ship first.');
  const ch = await channel(ctx); const f = ch?.current && await ctx.db.get(ch.current);
  if (crewLocked(ship._id, f, Date.now())) throw new ConvexError('Your ship is locked for this matchup. You can make changes after its fight.');
  return ship;
}
async function publicFight(ctx: any, f: any, now: number) {
  if (!f) return null;
  const ended = now >= f.endsAt;
  const wagers = await ctx.db.query('wagers').withIndex('fight', (q: any) => q.eq('fight', f._id)).collect();
  return { id: f._id, sequence: f.sequence, ships: f.ships, odds: f.odds, oddsSamples: f.oddsSamples,
    betting: bettingSummary(wagers, ended ? f.winner : undefined, f.crowd, f.odds),
    opensAt: f.opensAt, startsAt: f.startsAt, endsAt: f.endsAt, nextAt: f.nextAt,
    ...(ended ? { winner: f.winner, stats: f.stats, story: f.story, settled: f.settled, ownerPayout: f.ownerPayout ?? 0 } : {}) };
}
async function applyQueue(ctx: any, ch: any, queue: any[][]) {
  await ctx.db.patch(ch._id, {queue});
  const pending=ch.pending && await ctx.db.get(ch.pending);
  if(pending && !queue[0]?.every((id:any,i:number)=>id===pending.ships[i]?.id)) {
    await ctx.storage.delete(pending.trace);await ctx.db.delete(pending._id);
    if(ch.fallback){const backup=await ctx.db.get(ch.fallback);if(backup){await ctx.storage.delete(backup.trace);await ctx.db.delete(backup._id);}}
    await ctx.db.patch(ch._id,{pending:undefined,fallback:undefined,preparing:true});
    await ctx.scheduler.runAfter(0,internal.simulation.prepare,{generation:ch.generation});
  }
}
function prioritize(queue: any[][], ships: any[]) {
  const eligible=new Set(ships.map(s=>s._id)),human=new Set(ships.filter(s=>s.owner).map(s=>s._id));
  return queue.filter(pair=>pair.length===2&&pair[0]!==pair[1]&&pair.every(id=>eligible.has(id))).map((pair,index)=>({pair,index,priority:pair.some(id=>human.has(id))?0:1})).sort((a,b)=>a.priority-b.priority||a.index-b.index).map(x=>x.pair);
}
async function ensureQueue(ctx: any, ch: any) {
  const ships = (await ctx.db.query('ships').collect()).filter((s: any) => !s.testing);
  if (ships.length < 2) throw new Error('At least two ships are required.');
  let queue = ch.queue;
  if (!queue) {
    const pending = ch.pending && await ctx.db.get(ch.pending);
    queue = pending && pending.ships.every((s: any) => ships.some((actual: any) => actual._id === s.id)) ? [pending.ships.map((s: any) => s.id)] : [];
  }
  queue=prioritize(queue,ships);
  if (queue.length <= Math.ceil(ships.length/2)) queue = [...queue, ...rotation(ships)];
  if (queue.length <= Math.ceil(ships.length/2)) queue = [...queue, ...rotation(ships)];
  // Always give each sponsored ship a next appearance, even between rotations.
  // Fill unannounced background slots without moving existing sponsored bookings.
  const booked=new Set(queue.flat());
  const current=ch.current && await ctx.db.get(ch.current);
  for(const ship of ships.filter((s:any)=>s.owner&&!booked.has(s._id))) {
    const previousOpponent=current?.ships.some((s:any)=>s.id===ship._id)?current.ships.find((s:any)=>s.id!==ship._id)?.id:null;
    let opponents=ships.filter((s:any)=>s._id!==ship._id&&!s.owner&&s._id!==previousOpponent);
    if(!opponents.length)opponents=ships.filter((s:any)=>s._id!==ship._id);
    opponents=opponents.map((s:any)=>({s,tie:Math.random()})).sort((a:any,b:any)=>a.s.lastFight-b.s.lastFight||a.tie-b.tie).map((x:any)=>x.s);
    const opponent=opponents[Math.floor(Math.random()*Math.min(5,opponents.length))];
    const filler=queue.findIndex((pair:any[])=>pair.every(id=>!ships.find((s:any)=>s._id===id)?.owner));
    const pair=[ship._id,opponent._id];if(filler>=0)queue[filler]=pair;else queue.push(pair);
    booked.add(ship._id);booked.add(opponent._id);
  }
  queue=prioritize(queue,ships);
  await applyQueue(ctx,ch,queue);
  return queue;
}
async function preserveSchedule(ctx: any, shipId: any) {
  const ch = await channel(ctx); if (!ch?.pending) return;
  const pending = await ctx.db.get(ch.pending);
  if (!pending?.ships.some((s: any) => s.id === shipId)) return;
  await ctx.storage.delete(pending.trace); await ctx.db.delete(pending._id);
  if (ch.fallback) {const backup=await ctx.db.get(ch.fallback);if(backup){await ctx.storage.delete(backup.trace);await ctx.db.delete(backup._id);}}
  // Keep the booked pairing and regenerate it using the owner's current crew.
  await ctx.db.patch(ch._id, { pending: undefined, fallback: undefined, preparing: true });
  await ctx.scheduler.runAfter(0, internal.simulation.prepare, {generation:ch.generation});
}
export const initializeQueue = internalMutation({args:{},handler:async ctx=>{
  const ch=await channel(ctx);if(ch)await ensureQueue(ctx,ch);
}});
export const join = mutation({ args: tokenArg, handler: async (ctx, { token }) => {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new ConvexError('Invalid session.');
  const exists = await ctx.db.query('players').withIndex('token', q => q.eq('token', token)).unique();
  if (exists) { await grantStipend(ctx,exists); return; }
  const id = await ctx.db.insert('players', { token, name: `Spectator ${token.slice(0, 5).toUpperCase()}`, balance: ECONOMY.starting, lastChat: 0, lastRecovery: 0 });
  await ctx.db.insert('ledger', { player: id, kind: 'welcome', amount: ECONOMY.starting, balance: ECONOMY.starting, note: 'Welcome credits' });
}});
export const home = query({ args: tokenArg, handler: async (ctx, { token }) => {
  const p = await player(ctx, token); const ch = await channel(ctx); const f = ch?.current && await ctx.db.get(ch.current);
  const ship = await own(ctx, p);
  const wager = f && await ctx.db.query('wagers').withIndex('player_fight', q => q.eq('player', p._id).eq('fight', f._id)).unique();
  const transactions = await ctx.db.query('ledger').withIndex('player', q => q.eq('player', p._id)).order('desc').take(12);
  // Only expose completed appearances; queued matchups and outcomes stay private.
  const recent = ship ? await ctx.db.query('fights').withIndex('sequence').order('desc').take(100) : [];
  const shipActivity = recent.filter(row => row.settled && row.endsAt! <= Date.now() && row.ships.some((s: any) => s.id === ship!._id)).slice(0, 5).map(row => {
    const side = row.ships.findIndex((s: any) => s.id === ship!._id);
    return { sequence: row.sequence, opponent: row.ships[1-side].name, result: row.winner === null ? 'draw' : row.winner === side ? 'win' : 'loss', income: row.winner === side ? row.ownerPayout ?? 0 : 0, hull: row.stats[side].hull, endedAt: row.endsAt };
  });
  const queueIndex = ship ? (ch?.queue ?? []).findIndex((pair: Id<'ships'>[]) => pair.includes(ship._id)) : -1;
  const nextPair = queueIndex >= 0 ? ch!.queue![queueIndex] : null;
  const opponent: any = nextPair && ship ? await ctx.db.get(nextPair.find((id: Id<'ships'>) => id !== ship._id)!) : null;
  const upcoming = nextPair ? { fightsRemaining: queueIndex+1, opponent: opponent?.name ?? 'Opponent unavailable' } : null;
  const lastOwnerIncome = ship ? await ctx.db.query('ledger').withIndex('player', q => q.eq('player', p._id)).filter(q => q.eq(q.field('kind'), 'owner')).order('desc').first() : null;
  return { now: Date.now(), player: { id: p._id, name: p.name, balance: p.balance, maxBet: maxBet(p.balance), nextStipendAt: p.lastRecovery+3600000, candidate: p.candidate ?? null }, ship: ship ? { ...ship, locked: crewLocked(ship._id, f, Date.now()) } : null,
    fight: await publicFight(ctx, f, Date.now()), wager: wager ?? null, transactions, shipActivity, lastOwnerIncome, upcoming, economy: ECONOMY,
    status: ch?.error ? 'recovering' : ch?.current ? 'ready' : 'preparing' };
}});
// A scheduled write makes time-gated trace/home queries reactive at combat start.
export const startBroadcast = internalMutation({args:{fight:v.id('fights')},handler:async(ctx,{fight})=>{
  const ch=await channel(ctx),f=await ctx.db.get(fight);
  if(ch?.current!==fight||!f||f.liveStarted)return;
  if(Date.now()<f.startsAt!){await ctx.scheduler.runAt(f.startsAt!,internal.game.startBroadcast,{fight});return;}
  await ctx.db.patch(fight,{liveStarted:true});
}});
export const scheduleBroadcastStart = internalMutation({args:{},handler:async ctx=>{
  const ch=await channel(ctx),f=ch?.current&&await ctx.db.get(ch.current);
  if(f&&!f.liveStarted)await ctx.scheduler.runAt(Math.max(Date.now(),f.startsAt!),internal.game.startBroadcast,{fight:f._id});
}});
export const trace = query({ args: { fight: v.id('fights') }, handler: async (ctx, { fight }) => {
  const ch = await channel(ctx); const f = await ctx.db.get(fight);
  if (!f || ch?.current !== fight || Date.now() < f.startsAt! || Date.now() >= f.nextAt!) return null;
  return ctx.storage.getUrl(f.trace);
}});
export const archive = query({ args: {}, handler: async ctx => {
  const rows = await ctx.db.query('fights').withIndex('sequence').order('desc').take(31);
  return Promise.all(rows.filter(f => f.endsAt && f.endsAt <= Date.now()).slice(0, 30).map(f => publicFight(ctx, f, Date.now())));
}});
export const wager = mutation({ args: { ...tokenArg, fight: v.id('fights'), side: v.number(), stake: v.number() }, handler: async (ctx, a) => {
  const p = await player(ctx, a.token); const ch = await channel(ctx); const f = await ctx.db.get(a.fight);
  if (!f || ch?.current !== f._id) throw new ConvexError('This matchup is no longer open.');
  const old = await ctx.db.query('wagers').withIndex('player_fight', q => q.eq('player', p._id).eq('fight', f._id)).unique();
  let w; try { w = betCheck(f, Date.now(), a.side, a.stake, p.balance, old, maxBet(p.balance)); } catch (e: any) { throw new ConvexError(e.message); }
  await move(ctx, p, -w.stake, 'stake', `Backed ${f.ships[w.side].name}`, f._id);
  await ctx.db.insert('wagers', { player: p._id, fight: f._id, ...w });
}});
export const sponsor = mutation({ args: tokenArg, handler: async (ctx, { token }) => {
  const p = await player(ctx, token); if (await own(ctx, p)) throw new ConvexError('Your berth already has a ship.');
  const r = roster.ships[Math.floor(Math.random() * roster.ships.length)];
  const name = ['Wayfarer', 'Redshift', 'Starling', 'Longshot', 'Peregrine', 'Afterglow'][Math.floor(Math.random() * 6)] + ' ' + (100 + Math.floor(Math.random() * 900));
  await move(ctx, p, -ECONOMY.sponsor, 'sponsor', `Sponsored ${name}`);
  const aboard = new Set<string>();
  const crew = r.crew.map(member => {
    const name = crewName(Math.floor(Math.random() * 4294967296), [...aboard]); aboard.add(name);
    return { ...member, name };
  });
  const shipId = await ctx.db.insert('ships', { name, style: r.style, crew, identity: 10000 + Math.floor(Math.random() * 1000000), revision: 1, owner: p._id, earnings: 0, wins: 0, fights: 0, lastFight: 0 });
  const ch=await channel(ctx);
  if(ch){
    const queue=await ensureQueue(ctx,ch);
    const eligible=(await ctx.db.query('ships').collect()).filter(s=>!s.testing);
    if(!queue.some((pair:any[])=>pair.includes(shipId))){
      const human=new Set(eligible.filter(s=>s.owner).map(s=>s._id));
      const spare=queue.findIndex((pair:any[])=>pair.every(id=>!human.has(id)));
      if(spare>=0)queue[spare]=[shipId,queue[spare][0]];
      else{const opponents=eligible.filter(s=>s._id!==shipId);queue.push([shipId,opponents[Math.floor(Math.random()*opponents.length)]._id]);}
      await applyQueue(ctx,await channel(ctx),prioritize(queue,eligible));
    }
  }
}});
export const tryout = mutation({ args: { ...tokenArg, station: v.string() }, handler: async (ctx, { token, station }) => {
  const p = await player(ctx, token); const s = await editable(ctx, p);
  if (p.candidate) throw new ConvexError('Decide on your current candidate first.');
  if (!STATIONS.includes(station)) throw new ConvexError('Choose a crew station.');
  const aboard = new Set(s.crew.map((c: any) => c.name));
  const c = candidate(Math.floor(Math.random() * 4294967296), station, [...aboard]);
  await move(ctx, p, -ECONOMY.tryout, 'tryout', `${station} candidate tryout`);
  await ctx.db.patch(p._id, { candidate: { shipId: s._id, crew: c, paid: ECONOMY.tryout } });
}});
export const decide = mutation({ args: { ...tokenArg, accept: v.boolean() }, handler: async (ctx, { token, accept }) => {
  const p = await player(ctx, token); const c = p.candidate;
  if (!c) throw new ConvexError('No pending candidate.');
  if (accept) { const s = await editable(ctx, p); await ctx.db.patch(s._id, { crew: s.crew.map((old: any) => old.station === c.crew.station ? c.crew : old), revision: s.revision + 1 }); await preserveSchedule(ctx, s._id); }
  await ctx.db.patch(p._id, { candidate: undefined });
}});
export const rename = mutation({ args: { ...tokenArg, name: v.string() }, handler: async (ctx, { token, name }) => {
  const p = await player(ctx, token); const s = await editable(ctx, p); const clean = name.trim();
  if (clean.length < 2 || clean.length > 24 || /[<>\x00-\x1f]/.test(clean)) throw new ConvexError('Use 2–24 characters for the ship name.');
  if (clean === s.name) throw new ConvexError('That is already your ship’s name.');
  await move(ctx, p, -ECONOMY.rename, 'rename', `${s.name} → ${clean}`); await ctx.db.patch(s._id, { name: clean, revision: s.revision + 1 }); await preserveSchedule(ctx, s._id);
}});
export const profile = mutation({ args: { ...tokenArg, name: v.string() }, handler: async (ctx, { token, name }) => {
  const p = await player(ctx, token); const clean = name.trim();
  if (clean.length < 2 || clean.length > 24 || /[<>\x00-\x1f]/.test(clean)) throw new ConvexError('Use 2–24 characters for your viewer name.');
  await ctx.db.patch(p._id, { name: clean });
}});
export const recovery = mutation({ args: tokenArg, handler: async (ctx, { token }) => {
  const p = await player(ctx, token);
  if(!await grantStipend(ctx,p))throw new ConvexError('A 50-credit refill is available at zero balance, with no unsettled bets, at most once per hour.');
}});
export const initialize = internalMutation({ args: {}, handler: async ctx => {
  if (await channel(ctx)) return;
  for (const [i, s] of roster.ships.entries()) await ctx.db.insert('ships', { name: s.name, style: s.style, crew: s.crew, identity: 1000 + i, revision: 1, rosterIndex: i, earnings: 0, wins: 0, fights: 0, lastFight: 0 });
  const channelId=await ctx.db.insert('channel', { key: 'live', generation: 1, preparing: true, attempts: 0 });
  await ensureQueue(ctx,await ctx.db.get(channelId));
  await ctx.scheduler.runAfter(0, internal.simulation.prepare, { generation: 1 });
}});
export const preparation = internalQuery({ args: { generation: v.number() }, handler: async (ctx, { generation }) => {
  const ch = await channel(ctx); if (!ch || ch.generation !== generation || ch.pending) return null;
  const ships = (await ctx.db.query('ships').collect()).filter(s => !s.testing); const last = await ctx.db.query('fights').withIndex('sequence').order('desc').first();
  const pair = ch.queue?.[0];
  if (!pair || pair.some((id: Id<'ships'>)=>!ships.some(s=>s._id===id))) return null;
  return { ships: pair.map((id: Id<'ships'>)=>ships.find(s=>s._id===id)!), sequence: (last?.sequence ?? 0) + 1 };
}});
export const cachedOdds = internalQuery({ args: { key: v.string() }, handler: async (ctx, { key }) => ctx.db.query('odds').withIndex('key', q => q.eq('key', key)).unique() });
export const stage = internalMutation({ args: { generation: v.number(), data: v.any(), fallback: v.optional(v.any()) }, handler: async (ctx, { generation, data, fallback }) => {
  const ch = await channel(ctx); if (!ch || ch.generation !== generation || ch.pending) return false;
  async function valid(snapshot: any) { for(const s of snapshot.ships){const current: any=await ctx.db.get(s.id);if(!current||current.testing||current.revision!==s.revision)return false;}return true; }
  if (!ch.queue?.[0]?.every((id: Id<'ships'>, i: number) => id === data.ships[i]?.id) || !await valid(data)) {
    await ctx.scheduler.runAfter(0, internal.simulation.prepare, {generation}); return false;
  }
  const id = await ctx.db.insert('fights', { ...data, settled: false });

  if (!await ctx.db.query('odds').withIndex('key', q => q.eq('key', data.oddsKey)).unique()) await ctx.db.insert('odds', { key: data.oddsKey, probability: data.odds[0], samples: data.oddsSamples });
  await ctx.db.patch(ch._id, { pending: id, fallback: undefined, preparing: false, error: undefined, attempts: 0 });
  if (!ch.current) await ctx.scheduler.runAfter(0, internal.game.promote, {});
  return true;
}});
export const failed = internalMutation({ args: { generation: v.number(), message: v.string() }, handler: async (ctx, { generation, message }) => {
  const ch = await channel(ctx); if (!ch || ch.generation !== generation || ch.pending) return;
  await ctx.db.patch(ch._id, { error: message.slice(0, 160), preparing: true, attempts: ch.attempts + 1 });
  await ctx.scheduler.runAfter(Math.min(30000, 1000 * 2 ** ch.attempts), internal.simulation.prepare, { generation });
}});
export const promote = internalMutation({ args: {}, handler: async ctx => {
  const ch = await channel(ctx); if (!ch) return;
  const current = ch.current && await ctx.db.get(ch.current);
  if (current && Date.now() < current.nextAt!) return;
  if (current && !current.settled) { await ctx.scheduler.runAfter(500, internal.game.promote, {}); return; }
  if (!ch.pending) { await ctx.scheduler.runAfter(1000, internal.game.promote, {}); return; }
  const f: any = await ctx.db.get(ch.pending); if (!f) return;
  for (const s of f.ships) { const actual: any = await ctx.db.get(s.id); if (!actual || actual.testing || actual.revision !== s.revision) {
    await ctx.storage.delete(f.trace); await ctx.db.delete(f._id);
    await ctx.db.patch(ch._id, { pending: undefined, preparing: true });
    await ctx.scheduler.runAfter(0, internal.simulation.prepare, { generation: ch.generation }); await ctx.scheduler.runAfter(1000, internal.game.promote, {}); return;
  } }
  if (ch.fallback) { const backup: any = await ctx.db.get(ch.fallback); if (backup) { await ctx.storage.delete(backup.trace); await ctx.db.delete(backup._id); } }
  const opensAt = Date.now(), startsAt = opensAt + TIMING.betting, endsAt = startsAt + f.duration * 1000 + TIMING.finishHold, nextAt = endsAt + TIMING.results;
  await ctx.db.patch(f._id, { opensAt, startsAt, endsAt, nextAt });
  for (const s of f.ships) await ctx.db.patch(s.id, { lastFight: f.sequence });
  await ctx.db.patch(ch._id, { current: f._id, pending: undefined, fallback: undefined, queue: (ch.queue ?? []).slice(1), generation: ch.generation + 1, preparing: false });
  await ctx.scheduler.runAfter(0, internal.game.begin, { fight: f._id, generation: ch.generation + 1 });
  await ctx.scheduler.runAt(startsAt, internal.game.startBroadcast, { fight: f._id });
  await ctx.scheduler.runAt(endsAt, internal.game.finish, { fight: f._id });
  await ctx.scheduler.runAt(nextAt, internal.game.promote, {});
}});
export const begin = internalMutation({ args: { fight: v.id('fights'), generation: v.number() }, handler: async (ctx, { fight, generation }) => {
  const ch = await channel(ctx); if (ch?.current !== fight || ch.generation !== generation || ch.pending || ch.preparing) return;
  await ensureQueue(ctx,ch);
  await ctx.db.patch(ch._id, { preparing: true }); await ctx.scheduler.runAfter(0, internal.simulation.prepare, { generation });
}});
export const finish = internalMutation({ args: { fight: v.id('fights') }, handler: async (ctx, { fight }) => {
  const f = await ctx.db.get(fight); if (!f || f.settled || Date.now() < f.endsAt!) return;
  // Each wager has an explicit returned field; retries cannot credit it twice.
  const wagers = await ctx.db.query('wagers').withIndex('fight', q => q.eq('fight', fight)).collect();
  const profits = [];
  for (const w of wagers) { const result = settlement(w, f.winner); profits.push(result.profit);
    if (w.returned !== undefined) continue; const p = await ctx.db.get(w.player); if (!p) continue;
    await move(ctx, p, result.returned, 'settlement', f.winner === null ? 'Draw · stake returned' : result.net > 0 ? 'Winning wager' : 'Wager lost', fight);
    await ctx.db.patch(w._id, { returned: result.returned, net: result.net });
  }
  let income = 0;
  if (f.winner !== null) {
    const crowdProfit = quote(f.crowd[f.winner], f.odds[f.winner]) - f.crowd[f.winner];
    income = ownerIncome([...profits, crowdProfit]);
    const winner = await ctx.db.get(f.ships[f.winner].id);
    if (winner?.owner) { const p = await ctx.db.get(winner.owner); if (p) await move(ctx, p, income, 'owner', `${f.ships[f.winner].name} owner income`, fight); await ctx.db.patch(winner._id, { earnings: winner.earnings + income }); }
  }
  for (const [i, snap] of f.ships.entries()) { const s = await ctx.db.get(snap.id); if (s) await ctx.db.patch(s._id, { fights: s.fights + 1, wins: s.wins + (f.winner === i ? 1 : 0) }); }
  for(const id of new Set(wagers.map(w=>w.player))){const p=await ctx.db.get(id);if(p)await grantStipend(ctx,p);}
  await ctx.db.patch(f._id, { settled: true, ownerPayout: income });
  // Completed traces are not an archive feature; delete the preceding trace when the next one finishes.
  const old = await ctx.db.query('fights').withIndex('sequence', q => q.lt('sequence', f.sequence)).order('desc').first();
  if (old) await ctx.storage.delete(old.trace);
}});
export const watchdog = internalMutation({ args: {}, handler: async ctx => {
  for(const p of await ctx.db.query('players').withIndex('balance',q=>q.eq('balance',0)).collect())await grantStipend(ctx,p);
  const ch = await channel(ctx); if (!ch) return;
  const f = ch.current && await ctx.db.get(ch.current);
  if (f && Date.now() >= f.startsAt! && !f.liveStarted) await ctx.scheduler.runAfter(0, internal.game.startBroadcast, { fight: f._id });
  if (f && Date.now() >= f.endsAt! && !f.settled) await ctx.scheduler.runAfter(0, internal.game.finish, { fight: f._id });
  if (!f || Date.now() >= f.nextAt!) await ctx.scheduler.runAfter(0, internal.game.promote, {});
  if (f && Date.now() >= f.startsAt! && !ch.pending && !ch.preparing) await ctx.scheduler.runAfter(0, internal.game.begin, { fight: f._id, generation: ch.generation });
}});

export const clock = action({ args: {}, handler: async () => Date.now() });

export const syncRoster = internalMutation({ args: {}, handler: async ctx => {
  const ships=await ctx.db.query('ships').collect();
  for(const s of ships) if(s.rosterIndex !== undefined && !s.owner) await ctx.db.patch(s._id,{crew:roster.ships[s.rosterIndex].crew,revision:s.revision+1});
}});

// Idempotent migration of the prototype economy to whole-credit values.
export const roundCredits = internalMutation({args:{},handler:async ctx=>{
  const round=(n:number)=>Math.round(n/100)*100;
  for(const p of await ctx.db.query('players').collect())await ctx.db.patch(p._id,{balance:round(p.balance),...(p.candidate?{candidate:{...p.candidate,paid:round(p.candidate.paid)}}:{})});
  for(const s of await ctx.db.query('ships').collect())await ctx.db.patch(s._id,{earnings:round(s.earnings)});
  for(const w of await ctx.db.query('wagers').collect())await ctx.db.patch(w._id,{stake:round(w.stake),payout:round(w.payout),...(w.returned!==undefined?{returned:round(w.returned),net:round(w.returned)-round(w.stake)}:{})});
  for(const l of await ctx.db.query('ledger').collect())await ctx.db.patch(l._id,{amount:round(l.amount),balance:round(l.balance)});
  for(const f of await ctx.db.query('fights').collect())await ctx.db.patch(f._id,{crowd:f.crowd.map(round),...(f.ownerPayout!==undefined?{ownerPayout:round(f.ownerPayout)}:{})});
}});

// Convert persistent identities and invalidate only unannounced, prepared simulations.
export const migrateGeeResistance = internalMutation({args:{},handler:async ctx=>{
 let converted=0;
 for(const ship of await ctx.db.query('ships').collect()){
  if(ship.crew.some(c=>c.resistance===undefined||c.tolerance!==undefined)){
   await ctx.db.patch(ship._id,{crew:ship.crew.map(withResistance),revision:ship.revision+1});converted++;
  }
 }
 for(const p of await ctx.db.query('players').collect())if(p.candidate&&p.candidate.crew.resistance===undefined){
  await ctx.db.patch(p._id,{candidate:{...p.candidate,crew:withResistance(p.candidate.crew)}});
 }
 const ch=await channel(ctx);
 if(converted&&ch){
  for(const id of [ch.pending,ch.fallback])if(id){const f=await ctx.db.get(id as Id<'fights'>);if(f){await ctx.storage.delete(f.trace);await ctx.db.delete(id);}}
  await ctx.db.patch(ch._id,{pending:undefined,fallback:undefined,generation:ch.generation+1,preparing:true});
  await ctx.scheduler.runAfter(0,internal.simulation.prepare,{generation:ch.generation+1});
 }
 return{converted};
}});

// Replace legacy single-surname identities; generated Terran full names persist.
export const migrateCrewNames = internalMutation({args:{},handler:async ctx=>{
 let converted=0,candidates=0;
 const ships=await ctx.db.query('ships').collect();
 const taken=ships.flatMap(s=>s.crew.filter(c=>c.name.includes(' ')).map(c=>c.name));
 const rename=(crew:any[],key:string)=>crew.map((c,i)=>{
  if(c.name.includes(' '))return c;
  let seed=2166136261;for(const ch of `${key}:${i}`)seed=Math.imul(seed^ch.charCodeAt(0),16777619);
  const name=crewName(seed>>>0,taken);taken.push(name);converted++;
  return{...c,name};
 });
 for(const ship of ships){const crew=rename(ship.crew,ship._id);if(crew.some((c,i)=>c.name!==ship.crew[i].name))await ctx.db.patch(ship._id,{crew,revision:ship.revision+1});}
 for(const p of await ctx.db.query('players').collect())if(p.candidate&&!p.candidate.crew.name.includes(' ')){
  const crew=rename([p.candidate.crew],p._id)[0];await ctx.db.patch(p._id,{candidate:{...p.candidate,crew}});candidates++;
 }
 const ch=await channel(ctx);
 if(converted&&ch){
  for(const id of [ch.pending,ch.fallback])if(id){const f=await ctx.db.get(id as Id<'fights'>);if(f){await ctx.storage.delete(f.trace);await ctx.db.delete(id);}}
  await ctx.db.patch(ch._id,{pending:undefined,fallback:undefined,generation:ch.generation+1,preparing:true});
  await ctx.scheduler.runAfter(0,internal.simulation.prepare,{generation:ch.generation+1});
 }
 return{renamed:converted,candidates};
}});
