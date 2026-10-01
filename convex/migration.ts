import { internalMutation, internalQuery } from './_generated/server';
import { ConvexError } from 'convex/values';

export async function control(ctx: any) {
  return ctx.db.query('migrationControl').withIndex('key', (q: any) => q.eq('key', 'cloudflare')).unique();
}
export async function assertWritable(ctx: any) {
  if ((await control(ctx))?.frozen) throw new ConvexError('The league is moving to Cloudflare. Please reconnect shortly.');
}
export const status = internalQuery({ args: {}, handler: async ctx => {
  const state = await control(ctx);
  return { requested: !!state?.requested, frozen: !!state?.frozen, frozenAt: state?.frozenAt ?? null };
} });
export const requestFreeze = internalMutation({ args: {}, handler: async ctx => {
  const state = await control(ctx);
  if (state) await ctx.db.patch(state._id, { requested: true });
  else await ctx.db.insert('migrationControl', { key: 'cloudflare', requested: true, frozen: false });
  return { requested: true, frozen: !!state?.frozen };
} });
export const cancelFreeze = internalMutation({ args: {}, handler: async ctx => {
  const state = await control(ctx);
  if (state) await ctx.db.patch(state._id, { requested: false, frozen: false, frozenAt: undefined });
} });

/** Called only at promotion, after the current fight's settlement is durable. */
export async function freezeAtBoundary(ctx: any) {
  const state = await control(ctx);
  if (!state?.requested) return false;
  if (!state.frozen) await ctx.db.patch(state._id, { frozen: true, frozenAt: Date.now() });
  return true;
}
