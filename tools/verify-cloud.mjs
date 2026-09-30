// Exercises public functions against the explicit development deployment; writes test progress locally.
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference as ref } from 'convex/server';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const client = new ConvexHttpClient('https://resolute-crocodile-221.convex.cloud');
const token = randomBytes(32).toString('hex');
await client.mutation(ref('game:join'),{token});
await writeFile('runs/viewer/cloud-test-session.json',JSON.stringify({token}));
console.log('Created isolated development test session. Use grant command from saved test session for ownership checks.');
const home = await client.query(ref('game:home'),{token});
console.log({sequence:home.fight?.sequence,startingBalance:home.player.balance,connected:true});
