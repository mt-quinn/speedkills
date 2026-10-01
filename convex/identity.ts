import { getAuthUserId, getAuthSessionId } from '@convex-dev/auth/server';
import { ConvexError } from 'convex/values';
import type { QueryCtx, MutationCtx } from './_generated/server';
export async function accountPlayer(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const sessionId = await getAuthSessionId(ctx);
  const session = sessionId ? await ctx.db.get(sessionId) : null;
  if (!session || session.userId !== userId || session.expirationTime <= Date.now()) return null;
  return ctx.db.query('players').withIndex('userId', q => q.eq('userId', userId)).unique();
}
export async function requirePlayer(ctx: QueryCtx | MutationCtx) {
  const p = await accountPlayer(ctx);
  if (!p) throw new ConvexError('Create an account or sign in to continue.');
  return p;
}
export function username(value: unknown) {
  const name = String(value ?? '').trim();
  if (!/^[A-Za-z0-9_]{3,24}$/.test(name)) throw new ConvexError('Use 3–24 letters, numbers or underscores for your username.');
  return { name, key: name.toLowerCase() };
}
