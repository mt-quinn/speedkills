import { query, mutation } from './_generated/server';
import { v, ConvexError } from 'convex/values';
import { accountPlayer, requirePlayer } from './identity';
export const list = query({ args: { token: v.optional(v.string()) }, handler: async ctx => {
 const p = await accountPlayer(ctx); const muted = p ? await ctx.db.query('mutes').withIndex('player', q => q.eq('player', p._id)).collect() : []; const ids = new Set(muted.map(m => m.muted));
 const rows = await ctx.db.query('messages').order('desc').take(80);
 return rows.filter(m => !ids.has(m.player)).reverse().map(m => ({ id: m._id, player: m.player, name: m.name, body: m.body, ship: m.ship ?? null, at: m._creationTime, fight: m.fight ?? null }));
}});
export const send = mutation({ args: { token: v.optional(v.string()), body: v.string() }, handler: async (ctx, { body }) => {
 const p = await requirePlayer(ctx); const clean = body.trim();
 if (!clean || clean.length > 240 || /[\x00-\x08\x0e-\x1f]/.test(clean)) throw new ConvexError('Messages must be 1–240 characters.');
 if (Date.now() - p.lastChat < 3000) throw new ConvexError('Wait a moment before sending another message.');
 const ch = await ctx.db.query('channel').withIndex('key', q => q.eq('key', 'live')).unique();
 const s = await ctx.db.query('ships').withIndex('owner', q => q.eq('owner', p._id)).unique();
 await ctx.db.insert('messages', { player: p._id, name: p.name, body: clean, ...(s ? { ship: s.name } : {}), ...(ch?.current ? { fight: ch.current } : {}) });
 await ctx.db.patch(p._id, { lastChat: Date.now() });
}});
export const mute = mutation({ args: { token: v.optional(v.string()), muted: v.id('players') }, handler: async (ctx, { muted }) => {
 const p = await requirePlayer(ctx); if (p._id === muted) throw new ConvexError('You cannot mute yourself.');
 const rows = await ctx.db.query('mutes').withIndex('player', q => q.eq('player', p._id)).collect();
 const old = rows.find(m => m.muted === muted);
 if (old) await ctx.db.delete(old._id); else await ctx.db.insert('mutes', { player: p._id, muted });
}});
export const report = mutation({ args: { token: v.optional(v.string()), message: v.id('messages') }, handler: async (ctx, { message }) => {
 const p = await requirePlayer(ctx); if (!await ctx.db.get(message)) throw new ConvexError('Message is no longer available.');
 const old = await ctx.db.query('reports').withIndex('player_message', q => q.eq('player', p._id).eq('message', message)).unique();
 if (!old) await ctx.db.insert('reports', { player: p._id, message });
}});
