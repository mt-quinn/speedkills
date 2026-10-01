/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as chat from "../chat.js";
import type * as crons from "../crons.js";
import type * as game from "../game.js";
import type * as http from "../http.js";
import type * as identity from "../identity.js";
import type * as lab from "../lab.js";
import type * as matchmaking from "../matchmaking.js";
import type * as migration from "../migration.js";
import type * as passwordReset from "../passwordReset.js";
import type * as roster from "../roster.js";
import type * as simBinary from "../simBinary.js";
import type * as simulation from "../simulation.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  chat: typeof chat;
  crons: typeof crons;
  game: typeof game;
  http: typeof http;
  identity: typeof identity;
  lab: typeof lab;
  matchmaking: typeof matchmaking;
  migration: typeof migration;
  passwordReset: typeof passwordReset;
  roster: typeof roster;
  simBinary: typeof simBinary;
  simulation: typeof simulation;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
