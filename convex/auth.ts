import { convexAuth } from '@convex-dev/auth/server';
import { Password } from '@convex-dev/auth/providers/Password';
import { ConvexError } from 'convex/values';
import { username } from './identity';
import type { MutationCtx } from './_generated/server';
import { passwordReset } from './passwordReset';
import { query } from './_generated/server';
import { ECONOMY } from '../shared/rules.js';

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
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

export const options = query({ args: {}, handler: async () => ({ passwordReset: !!(process.env.AUTH_RESEND_KEY && process.env.AUTH_EMAIL_FROM) }) });
