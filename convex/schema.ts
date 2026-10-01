import { defineSchema, defineTable } from 'convex/server';
import { authTables } from '@convex-dev/auth/server';
import { v } from 'convex/values';
const crew = v.object({ name: v.string(), station: v.string(), skill: v.number(), tolerance: v.optional(v.number()), resistance: v.optional(v.number()) });
export const shipSnapshot = v.object({ id: v.id('ships'), name: v.string(), style: v.string(), crew: v.array(crew), identity: v.number(), revision: v.number(), owner: v.optional(v.id('players')) });
export default defineSchema({
  migrationControl: defineTable({ key: v.string(), requested: v.boolean(), frozen: v.boolean(), frozenAt: v.optional(v.number()) }).index('key', ['key']),
  ...authTables,
  users: defineTable({ name: v.optional(v.string()), email: v.optional(v.string()), emailVerificationTime: v.optional(v.number()), usernameKey: v.optional(v.string()) }).index('email', ['email']).index('usernameKey', ['usernameKey']),
  players: defineTable({ token: v.optional(v.string()), userId: v.optional(v.id('users')), name: v.string(), balance: v.number(), lastChat: v.number(), candidate: v.optional(v.object({ shipId: v.id('ships'), crew, paid: v.number() })), lastRecovery: v.number() }).index('token', ['token']).index('userId', ['userId']).index('balance', ['balance']),
  ships: defineTable({ name: v.string(), style: v.string(), crew: v.array(crew), identity: v.number(), revision: v.number(), owner: v.optional(v.id('players')), testing: v.optional(v.boolean()), rosterIndex: v.optional(v.number()), earnings: v.number(), wins: v.number(), fights: v.number(), lastFight: v.number() }).index('owner', ['owner']),
  channel: defineTable({ key: v.string(), queue: v.optional(v.array(v.array(v.id('ships')))), current: v.optional(v.id('fights')), pending: v.optional(v.id('fights')), fallback: v.optional(v.id('fights')), generation: v.number(), preparing: v.boolean(), error: v.optional(v.string()), attempts: v.number() }).index('key', ['key']),
  fights: defineTable({ sequence: v.number(), ships: v.array(shipSnapshot), odds: v.array(v.number()), oddsSamples: v.number(), oddsKey: v.string(), seed: v.number(), duration: v.number(), winner: v.union(v.number(), v.null()), stats: v.any(), story: v.string(), trace: v.id('_storage'), opensAt: v.optional(v.number()), startsAt: v.optional(v.number()), endsAt: v.optional(v.number()), nextAt: v.optional(v.number()), settled: v.boolean(), liveStarted: v.optional(v.boolean()), crowd: v.array(v.number()), ownerPayout: v.optional(v.number()) }).index('sequence', ['sequence']),
  wagers: defineTable({ player: v.id('players'), fight: v.id('fights'), side: v.number(), stake: v.number(), payout: v.number(), returned: v.optional(v.number()), net: v.optional(v.number()) }).index('player_fight', ['player', 'fight']).index('fight', ['fight']),
  ledger: defineTable({ player: v.id('players'), fight: v.optional(v.id('fights')), kind: v.string(), amount: v.number(), balance: v.number(), note: v.string() }).index('player', ['player']),
  messages: defineTable({ player: v.id('players'), name: v.string(), ship: v.optional(v.string()), body: v.string(), fight: v.optional(v.id('fights')) }),
  reports: defineTable({ player: v.id('players'), message: v.id('messages') }).index('player_message', ['player', 'message']),
  mutes: defineTable({ player: v.id('players'), muted: v.id('players') }).index('player', ['player']),
  odds: defineTable({ key: v.string(), probability: v.number(), samples: v.number() }).index('key', ['key']),
});
