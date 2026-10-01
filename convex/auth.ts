import { convexAuth } from '@convex-dev/auth/server';
import { Password } from '@convex-dev/auth/providers/Password';
import { ConvexError } from 'convex/values';
import { username } from './identity';
import type { MutationCtx } from './_generated/server';
import { passwordReset } from './passwordReset';
import { query, action, internalMutation } from './_generated/server';
import { makeFunctionReference } from 'convex/server';
import { v } from 'convex/values';
import { assertWritable } from './migration';
import { ECONOMY } from '../shared/rules.js';

const provider = convexAuth({
  providers: [Password({
    reset: passwordReset,
    profile(params) {
      const email = String(params.email ?? '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new ConvexError('Enter a valid email address.');
      return { email, ...(params.flow === 'signUp' ? { name: username(params.username).name, legacyToken: params.legacyToken } : {}) };
    },
    validatePasswordRequirements(password) {
      if (typeof password !== 'string' || password.length < 8 || password.length > 256) throw new ConvexError('Use a password between 8 and 256 characters.');
    },
  })],
  callbacks: {
    async createOrUpdateUser(genericCtx, { existingUserId, profile }) {
      const ctx = genericCtx as MutationCtx;
      if (existingUserId) return existingUserId;
      const { name, key } = username(profile.name);
      if (await ctx.db.query('users').withIndex('usernameKey', q => q.eq('usernameKey', key)).unique()) throw new ConvexError('That username is already taken.');
      const legacyToken = typeof profile.legacyToken === 'string' && /^[a-f0-9]{64}$/.test(profile.legacyToken) ? profile.legacyToken : null;
      const legacy = legacyToken ? await ctx.db.query('players').withIndex('token', q => q.eq('token', legacyToken)).unique() : null;
      if (legacy?.userId) throw new ConvexError('This browser’s progress already belongs to an account. Sign in to that account.');
      const userId = await ctx.db.insert('users', { name, usernameKey: key, email: profile.email });
      if (legacy) {
        // Preserve player IDs: ships, wagers, ledger and candidate remain attached.
        // Erase the bearer secret so it cannot claim or authorize this player again.
        await ctx.db.patch(legacy._id, { userId, name, token: undefined });
      } else {
        const playerId = await ctx.db.insert('players', { userId, name, balance: ECONOMY.starting, lastChat: 0, lastRecovery: 0 });
        await ctx.db.insert('ledger', { player: playerId, kind: 'welcome', amount: ECONOMY.starting, balance: ECONOMY.starting, note: 'Welcome credits' });
      }
      return userId;
    },
  },
});

export const { auth, isAuthenticated } = provider;
// Registration wrappers expose _handler at runtime, including the auth library's
// bundled Convex version. Keep this bridge local rather than exporting bypasses.
const run = (fn: unknown, ctx: unknown, args: unknown): Promise<any> =>
  (fn as { _handler: (ctx: unknown, args: unknown) => Promise<any> })._handler(ctx, args);
// Guard the actual internal auth write, including refreshes already in flight.
export const store = internalMutation({ args: v.any(), handler: async (ctx, args): Promise<any> => {
  await assertWritable(ctx); return run(provider.store, ctx, args);
} });
export const signIn = action({ args: { provider: v.optional(v.string()), params: v.optional(v.any()), verifier: v.optional(v.string()), refreshToken: v.optional(v.string()), calledBy: v.optional(v.string()) }, handler: async (ctx, args): Promise<any> => {
  if ((await ctx.runQuery(makeFunctionReference<'query'>('migration:status'), {})).frozen) throw new ConvexError('The league is moving to Cloudflare. Please reconnect shortly.');
  return run(provider.signIn, ctx, args);
} });
export const signOut = action({ args: {}, handler: async (ctx, args): Promise<any> => run(provider.signOut, ctx, args) });

export const options = query({ args: {}, handler: async () => ({ passwordReset: !!(process.env.AUTH_RESEND_KEY && process.env.AUTH_EMAIL_FROM) }) });
