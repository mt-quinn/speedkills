// Local workerd/D1 rehearsal of a private import bundle. No user records logged.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
const folder = process.argv[2];
if (!folder) throw new Error('Pass the private import bundle directory');
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default {fetch(){return new Response("Not found",{status:404})}}',
  compatibilityDate: '2026-10-01', d1Databases: { DB: 'private-rehearsal' } }));
try {
  const db = await mf.getD1Database('DB');
  for (const name of ['0001_league.sql','0002_auth.sql','0003_atomic_game.sql','0004_timestamps_and_limits.sql','0005_cutover_markers.sql']) {
    const raw = await readFile(`cloudflare/migrations/${name}`, 'utf8');
    const statements = raw.includes('-- statement-break') ? raw.split('-- statement-break') : raw.replace(/--[^\n]*/g,'').split(';').filter(s=>s.trim());
    for(const statement of statements)await db.prepare(statement).run();
  }
  const statements = JSON.parse(await readFile(resolve(folder,'statements.json'),'utf8'));
  for (let i=0;i<statements.length;i+=40) await db.batch(statements.slice(i,i+40).map(s=>db.prepare(s)));
  const report = JSON.parse(await readFile(resolve(folder,'report.json'),'utf8'));
  assert.equal((await db.prepare('SELECT SUM(balance) AS n FROM players').first()).n,report.balanceTotal);
  assert.equal((await db.prepare('SELECT SUM(amount) AS n FROM ledger').first()).n,report.ledgerAmountTotal);
  const tableNames = { users:'auth_user',authAccounts:'auth_account',players:'players',ships:'ships',fights:'fights',wagers:'wagers',ledger:'ledger',messages:'messages',mutes:'mutes',reports:'reports',odds:'odds_cache',channel:'league_state' };
  for(const [source,target] of Object.entries(tableNames)) assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${target}`).first()).n,report.rows[source]);
  assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length,0);
  assert.equal((await db.prepare('SELECT maintenance FROM league_state').first()).maintenance,1);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM auth_session').first()).n,0);
  console.log(JSON.stringify({runtime:'workerd-D1',import:'pass',counts:'match',balances:'match',ledger:'match',foreignKeys:'pass',maintenance:true,sessionsImported:0}));
} finally { await mf.dispose(); }
