import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { gunzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { simulator } from '../../shared/simulator.js';
import { Scrypt } from 'lucia';
import { verifyPassword } from '../node_modules/better-auth/dist/crypto/index.mjs';

const key = 'local-test-key-not-a-deployment-secret';
let mf, nodeSim, ships, resetCode;
const call = (path, options = {}) => mf.dispatchFetch(`http://localhost${path}`, options);
const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
function job(samples = 1, overrides = {}) {
  return { ships, seed: 73421, oddsSeed: 51283, samples, fightId: 'test-fight', ...overrides };
}

before(async () => {
  await Promise.all([
    build({ entryPoints: ['cloudflare/src/index.ts'], bundle: true, format: 'esm', platform: 'neutral',
      outfile: 'cloudflare/generated/index.mjs', external: ['cloudflare:workers', 'node:*'] }),
    build({ entryPoints: ['cloudflare/src/simulator.ts'], bundle: true, format: 'esm', platform: 'neutral',
      outfile: 'cloudflare/generated/simulator.mjs', external: ['cloudflare:workers', '*.wasm'] }),
    build({ entryPoints: ['cloudflare/test/password-worker.ts'], bundle: true, format: 'esm', platform: 'neutral',
      outfile: 'cloudflare/generated/password-worker.mjs', external: ['node:*'] }),
    build({ entryPoints: ['cloudflare/test/game-worker.ts'], bundle: true, format: 'esm', platform: 'neutral',
      outfile: 'cloudflare/generated/game-worker.mjs', external: ['node:*'] }),
  ]);
  const source = await readFile('convex/roster.ts', 'utf8');
  const roster = JSON.parse(source.slice(source.indexOf('=') + 1).trim().replace(/;$/, ''));
  ships = roster.ships.slice(0, 2).map((s, i) => ({ id: `ship-${i}`, name: s.name, style: s.style,
    identity: 1000 + i, revision: 1, crew: s.crew }));
  nodeSim = await simulator(await readFile('cloudflare/generated/sim.wasm'));
  mf = new Miniflare(convertV4MiniflareOptions({ workers: [
    { name: 'api', compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat'],
      modules: [{ type: 'ESModule', path: resolve('cloudflare/generated/index.mjs') }],
      bindings: { ENVIRONMENT: 'preview', ALLOWED_ORIGINS: 'http://localhost:3000', BENCHMARK_KEY: key,
        AUTH_SECRET: 'local-test-auth-secret-at-least-thirty-two-characters',
        AUTH_RESEND_KEY: 'disposable-test-key', AUTH_EMAIL_FROM: 'test@example.test' },
      outboundService: async request => {
        if (request.url !== 'https://api.resend.com/emails') throw new Error('Unexpected network request');
        const payload = await request.json(); resetCode = payload.text.match(/\b[0-9]{8}\b/)?.[0];
        return Response.json({ id: 'disposable-email' });
      },
      d1Databases: { DB: 'preview-test' }, r2Buckets: { TRACES: 'trace-test' },
      durableObjects: { LEAGUE: { className: 'League', useSQLite: true } },
      queueProducers: { PREPARATIONS: 'preparations' },
      serviceBindings: { SIMULATOR: { name: 'simulator', entrypoint: 'Simulator' } } },
    { name: 'simulator', compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat'],
      modules: [
        { type: 'ESModule', path: resolve('cloudflare/generated/simulator.mjs') },
        { type: 'CompiledWasm', path: resolve('cloudflare/generated/sim.wasm') },
      ], r2Buckets: { TRACES: 'trace-test' },
      queueConsumers: { preparations: { maxBatchSize: 1, maxBatchTimeout: 0 } },
      serviceBindings: { COMPLETION: { name: 'api', entrypoint: 'Completion' } } },
    { name: 'password-test', compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat'],
      modules: [{ type: 'ESModule', path: resolve('cloudflare/generated/password-worker.mjs') }] },
    { name: 'game-test', compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat'],
      modules: [{ type: 'ESModule', path: resolve('cloudflare/generated/game-worker.mjs') }], d1Databases: { DB: 'isolated-game-test' } },
  ] }));
  const db = await mf.getD1Database('DB', 'api');
  const sql = await readFile('cloudflare/migrations/0001_league.sql', 'utf8');
  const statements = sql.replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean);
  await db.batch(statements.map(s => db.prepare(s)));
  const auth = await readFile('cloudflare/migrations/0002_auth.sql', 'utf8');
  await db.batch(auth.split('-- statement-break').map(s => db.prepare(s)));
  const atomic = await readFile('cloudflare/migrations/0003_atomic_game.sql', 'utf8');
  await db.batch(atomic.replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
  const gameDb=await mf.getD1Database('DB','game-test');
  await gameDb.batch(statements.map(s=>gameDb.prepare(s)));
  await gameDb.batch(auth.split('-- statement-break').map(s=>gameDb.prepare(s)));
  await gameDb.batch(atomic.replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean).map(s=>gameDb.prepare(s)));
  const timestamps=await readFile('cloudflare/migrations/0004_timestamps_and_limits.sql','utf8');
  await db.batch(timestamps.split('-- statement-break').map(s=>db.prepare(s)));
  await gameDb.batch(timestamps.split('-- statement-break').map(s=>gameDb.prepare(s)));
  const markers=await readFile('cloudflare/migrations/0005_cutover_markers.sql','utf8');
  for(const statement of markers.split('-- statement-break')){await db.prepare(statement).run();await gameDb.prepare(statement).run();}
});

test('durable preparation keeps its seed on retry, rejects changed crews, and promotes only once', async () => {
  const db=await mf.getD1Database('DB','game-test'), worker=await mf.getWorker('game-test');
  const invoke=async(operation,...args)=>{
    const response=await worker.fetch('http://game-test/',{method:'POST',body:JSON.stringify({operation,args})});
    assert.equal(response.status,200,await response.clone().text());return(await response.json()).value;
  };
  await invoke('initialize');
  await db.prepare("UPDATE league_state SET maintenance = 0 WHERE id = 'live'").run();
  const job=await invoke('reserve'), input=JSON.parse(job.input_json);
  assert.equal(await invoke('reserve'),null);
  await db.prepare('UPDATE preparation_jobs SET lease_until = 0 WHERE id = ?').bind(job.id).run();
  const retried=await invoke('reserve');assert.equal(retried.id,job.id);assert.equal(retried.input_json,job.input_json);
  const result={ships:input.ships,seed:input.seed,odds:[0.6,0.4],oddsSamples:400,oddsKey:'test-prep-odds',duration:10,winner:0,stats:[{hull:80},{hull:0}],story:'Test outcome',sha256:'test',rawBytes:100,compressedBytes:50,wasmMemoryBytes:100,traceKey:'private-test-key'};
  await db.prepare('UPDATE ships SET revision = revision + 1 WHERE id = ?').bind(input.ships[0].id).run();
  assert.equal(await invoke('accept',job,result),false);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM fights').first()).n,0);
  const fresh=await invoke('reserve'), next=JSON.parse(fresh.input_json);
  assert.deepEqual(next.ships.map(s=>s.id),input.ships.map(s=>s.id));
  assert.equal(next.ships[0].revision,input.ships[0].revision+1);
  assert.equal(await invoke('accept',fresh,{...result,ships:next.ships,seed:next.seed}),true);
  assert.equal(await invoke('accept',fresh,{...result,ships:next.ships,seed:next.seed}),false);
  await invoke('advance');await invoke('advance');
  const home=await invoke('query','game:home',{},null,'http://game-test');
  assert.equal(home.fight.id,fresh.id);assert.equal(home.fight.startsAt-home.fight.opensAt,60000);
  assert.equal('winner' in home.fight,false);assert.equal('seed' in home.fight,false);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM fights').first()).n,1);
  const before=await invoke('state');
  const rejected=await worker.fetch('http://game-test/',{method:'POST',body:JSON.stringify({operation:'commit',args:[{...before,revision:before.revision-1},[],{phase:'bad-stale-commit'}]})});
  assert.equal(rejected.status,400);
  assert.notEqual((await invoke('state')).phase,'bad-stale-commit');
});

test('mixed rotations retain bot fights with two or sixteen registered player ships and preserve booked order', async () => {
  const db=await mf.getD1Database('DB','game-test'),worker=await mf.getWorker('game-test');
  const invoke=async(operation,...args)=>{const r=await worker.fetch('http://game-test/',{method:'POST',body:JSON.stringify({operation,args})});assert.equal(r.status,200,await r.clone().text());return(await r.json()).value;};
  const template=await db.prepare("SELECT * FROM ships WHERE id = 'baseline-0'").first();
  for(let i=0;i<16;i++)await db.batch([
    db.prepare('INSERT INTO players(id,name,balance,created_at) VALUES (?,?,50000,1)').bind('rotation-player-'+i,'RotationPilot'+i),
    db.prepare('INSERT INTO ships(id,owner_id,name,style,identity,revision,crew_json,testing) VALUES (?,?,?,?,?,1,?,?)').bind('rotation-ship-'+i,'rotation-player-'+i,'RotationShip'+i,template.style,20000+i,template.crew_json,i<2?0:1),
  ]);
  try {
    const state=await invoke('state');
    for(const count of [2,16]){
      if(count===16)await db.prepare("UPDATE ships SET testing = 0 WHERE id LIKE 'rotation-ship-%'").run();
      const {q,ships:eligible}=await invoke('ensureQueue',{...state,queue_json:'[]'});
      assert.equal(eligible.length,10+count);
      const size=eligible.length/2;
      assert.equal(q.length,size*2);
      for(const round of [q.slice(0,size),q.slice(size)]){
        assert.equal(new Set(round.flat()).size,eligible.length,'each ship appears once per even-sized rotation');
        assert.equal(round.flat().filter(id=>id.startsWith('baseline-')).length,10,'all bot ships remain in every rotation');
        assert.ok(round.some(pair=>pair.some(id=>id.startsWith('rotation-ship-'))));
      }
      const booked=[['baseline-0','baseline-1'],['rotation-ship-0','rotation-ship-1']];
      const preserved=await invoke('ensureQueue',{...state,queue_json:JSON.stringify(booked)});
      assert.deepEqual(preserved.q.slice(0,2),booked,'player pairs cannot jump booked bot fights');
    }
  } finally {
    await db.prepare("DELETE FROM ships WHERE id LIKE 'rotation-ship-%'").run();
    await db.prepare("DELETE FROM players WHERE id LIKE 'rotation-player-%'").run();
  }
});

test('ownership, paid crew decisions, rename, owner income, chat moderation and recovery retain game semantics', async () => {
  const db=await mf.getD1Database('DB','game-test'), worker=await mf.getWorker('game-test');
  const invoke=async(operation,...args)=>{
    const response=await worker.fetch('http://game-test/',{method:'POST',body:JSON.stringify({operation,args})});
    assert.equal(response.status,200,await response.clone().text());return(await response.json()).value;
  };
  await db.prepare("INSERT INTO players(id,user_id,name,balance,created_at) VALUES ('owner-player','owner-user','OwnerPilot',500000,1),('refill-player','refill-user','RefillPilot',0,1)").run();
  let command=0;
  const call=(name,args={})=>invoke('command','owner-user',`owner-command-${++command}`,name,args);
  const booked=JSON.parse((await invoke('state')).queue_json);
  await call('game:sponsor');
  const ship=await db.prepare("SELECT * FROM ships WHERE owner_id = 'owner-player'").first();
  assert.ok(ship);assert.equal(JSON.parse(ship.crew_json).length,4);
  const afterSponsor=JSON.parse((await invoke('state')).queue_json);
  assert.deepEqual(afterSponsor.slice(0,booked.length),booked);
  assert.ok(afterSponsor.at(-1).includes(ship.id));
  assert.equal((await db.prepare("SELECT balance FROM players WHERE id = 'owner-player'").first()).balance,300000);
  await call('game:tryout',{station:'pilot'});
  const pending=JSON.parse((await db.prepare("SELECT candidate_json FROM players WHERE id = 'owner-player'").first()).candidate_json);
  await call('game:decide',{accept:true});
  const hired=await db.prepare('SELECT * FROM ships WHERE id = ?').bind(ship.id).first();
  assert.equal(hired.revision,2);assert.deepEqual(JSON.parse(hired.crew_json).find(c=>c.station==='pilot'),pending.crew);
  await call('game:rename',{name:'Verified Starling'});
  assert.equal((await db.prepare('SELECT name FROM ships WHERE id = ?').bind(ship.id).first()).name,'Verified Starling');
  assert.equal((await db.prepare("SELECT balance FROM players WHERE id = 'owner-player'").first()).balance,285000);
  await call('chat:send',{body:'Hello test league'});
  const message=await db.prepare('SELECT * FROM messages').first();assert.equal(message.name,'OwnerPilot');
  await invoke('command','refill-user','mute-command-0001','chat:mute',{muted:'owner-player'});
  assert.deepEqual(await invoke('query','chat:list',{},'refill-user','http://game-test'),[]);
  await invoke('command','refill-user','report-command-0001','chat:report',{message:message.id});
  assert.equal((await db.prepare('SELECT count(*) AS n FROM reports').first()).n,1);
  await invoke('command','refill-user','refill-command-0001','game:recovery',{});
  await invoke('command','refill-user','refill-command-0001','game:recovery',{});
  assert.equal((await db.prepare("SELECT balance FROM players WHERE id = 'refill-player'").first()).balance,5000);
  // Select the owner's matchup explicitly; sponsorship no longer jumps the queue.
  await db.prepare("UPDATE league_state SET queue_json = ? WHERE id = 'live'").bind(JSON.stringify([[ship.id,'baseline-0']])).run();
  const job=await invoke('reserve'), input=JSON.parse(job.input_json);
  const side=input.ships.findIndex(s=>s.id===ship.id);assert.notEqual(side,-1);
  const data={ships:input.ships,seed:input.seed,odds:[0.5,0.5],oddsSamples:128,oddsKey:'test-owner-odds',duration:1,winner:side,stats:[{hull:80},{hull:10}],story:'Test',traceKey:'private-owned-trace',sha256:'test',rawBytes:100,compressedBytes:50,wasmMemoryBytes:100};
  await invoke('accept',job,data);
  assert.equal((await db.prepare('SELECT crowd_json FROM fights WHERE id = ?').bind(job.id).first()).crowd_json,'[0,0]');
  // Legacy synthetic stakes must not contribute to new owner settlements.
  await db.prepare("UPDATE fights SET crowd_json = '[2000000,2000000]' WHERE id = ?").bind(job.id).run();
  await db.prepare("UPDATE fights SET ends_at = ?,next_at = ? WHERE id = (SELECT current_id FROM league_state WHERE id = 'live')").bind(Date.now()-2,Date.now()-1).run();
  await invoke('advance');await invoke('advance');
  const home=await invoke('query','game:home',{},'owner-user','http://game-test');
  assert.equal(home.fight.id,job.id);assert.equal(home.ship.locked,true);
  await call('game:wager',{fight:job.id,side,stake:50000});
  await db.prepare('UPDATE fights SET starts_at = ?,ends_at = ?,next_at = ? WHERE id = ?').bind(Date.now()-10,Date.now()-5,Date.now()+60000,job.id).run();
  await invoke('advance');await invoke('advance');await invoke('advance');
  const f=await db.prepare('SELECT * FROM fights WHERE id = ?').bind(job.id).first();
  const winner=await db.prepare('SELECT * FROM ships WHERE id = ?').bind(ship.id).first();
  const wager=await db.prepare("SELECT * FROM wagers WHERE player_id = 'owner-player'").first();
  assert.equal(f.owner_payout,Math.round((wager.payout-wager.stake)*0.01/100)*100);assert.equal(winner.earnings,f.owner_payout);assert.equal(winner.wins,1);assert.equal(winner.fights,1);
  assert.equal((await db.prepare("SELECT balance FROM players WHERE id = 'owner-player'").first()).balance,285000-50000+wager.payout+f.owner_payout);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM ledger WHERE kind = 'owner' AND player_id = 'owner-player'").first()).n,1);
});

test('rescheduling replaces unpublished work without touching the current fight, wagers or wallets', async () => {
  const db=await mf.getD1Database('DB','game-test'),worker=await mf.getWorker('game-test');
  const invoke=async(operation,...args)=>{const r=await worker.fetch('http://game-test/',{method:'POST',body:JSON.stringify({operation,args})});assert.equal(r.status,200,await r.clone().text());return(await r.json()).value;};
  const before=await invoke('state');
  const current=await db.prepare('SELECT * FROM fights WHERE id = ?').bind(before.current_id).first();
  const wagers=(await db.prepare('SELECT * FROM wagers').all()).results;
  const balances=(await db.prepare('SELECT id,balance FROM players ORDER BY id').all()).results;
  const job=await invoke('reserve'),input=JSON.parse(job.input_json);
  const result={ships:input.ships,seed:input.seed,odds:[0.5,0.5],oddsSamples:128,oddsKey:'reschedule-odds',duration:1,winner:0,stats:[],story:'Unpublished',traceKey:'unpublished-key'};
  assert.equal(await invoke('accept',job,result),true);
  await invoke('reschedule');
  const after=await invoke('state');
  assert.equal(after.current_id,before.current_id);assert.equal(after.pending_id,null);assert.equal(after.generation,before.generation+1);
  assert.deepEqual(await db.prepare('SELECT * FROM fights WHERE id = ?').bind(before.current_id).first(),current);
  assert.deepEqual((await db.prepare('SELECT * FROM wagers').all()).results,wagers);
  assert.deepEqual((await db.prepare('SELECT id,balance FROM players ORDER BY id').all()).results,balances);
  assert.equal(await invoke('accept',job,result),false,'old completion cannot undo the new queue');
  const next=await invoke('reserve');assert.ok(next);assert.equal(next.generation,after.generation);
});

test('a 60-wager draw resumes bounded settlement pages across fresh coordinators without duplicate payouts', async () => {
  const db=await mf.getD1Database('DB','game-test'),worker=await mf.getWorker('game-test'),now=Date.now();
  await db.prepare('INSERT INTO fights(id,sequence,ships_json,odds_json,odds_samples,odds_key,seed,duration,winner,stats_json,story,crowd_json,opens_at,starts_at,ends_at,next_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind('paged-draw',1000,JSON.stringify(ships),'[0.5,0.5]',128,'draw-odds',1,1,null,'[]','Draw','[2000000,2000000]',now-10000,now-9000,now-8000,now+600000).run();
  for(let i=0;i<60;i++)await db.batch([
    db.prepare('INSERT INTO players(id,name,balance,created_at) VALUES (?,?,0,1)').bind('draw-player-'+i,'DrawPilot'+i),
    db.prepare('INSERT INTO wagers(id,player_id,fight_id,side,stake,payout) VALUES (?,? ,?,0,1000,2000)').bind('draw-wager-'+i,'draw-player-'+i,'paged-draw'),
  ]);
  await db.prepare("UPDATE league_state SET current_id = 'paged-draw',pending_id = NULL,maintenance = 0 WHERE id = 'live'").run();
  const advance=async()=>{const r=await worker.fetch('http://game-test/',{method:'POST',body:JSON.stringify({operation:'advance'})});assert.equal(r.status,200,await r.clone().text());};
  await advance();
  assert.equal((await db.prepare("SELECT count(*) AS n FROM wagers WHERE fight_id = 'paged-draw' AND returned IS NOT NULL").first()).n,25);
  assert.equal((await db.prepare("SELECT settled FROM fights WHERE id = 'paged-draw'").first()).settled,0);
  await advance();await advance();await advance();await advance();
  assert.equal((await db.prepare("SELECT settled,owner_payout FROM fights WHERE id = 'paged-draw'").first()).settled,1);
  assert.equal((await db.prepare("SELECT owner_payout FROM fights WHERE id = 'paged-draw'").first()).owner_payout,0);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM ledger WHERE fight_id = 'paged-draw' AND kind = 'settlement'").first()).n,60);
  assert.equal((await db.prepare("SELECT SUM(balance) AS n FROM players WHERE id LIKE 'draw-player-%'").first()).n,60000);
});

test('account registration preserves legacy progress atomically and sessions revoke across devices', async () => {
  const db = await mf.getD1Database('DB', 'api');
  await db.prepare("UPDATE league_state SET maintenance = 0 WHERE id = 'live'").run();
  const secret = 'a'.repeat(64), hash = createHash('sha256').update(secret).digest('hex');
  await db.prepare("INSERT INTO players(id,legacy_token_hash,name,balance,created_at) VALUES ('legacy-owned',?,'Legacy',23300,1)").bind(hash).run();
  const post = (path, data, token) => call(`/auth/${path}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000',
      ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data) });
  const signup = await post('sign-up/email', { email: 'migration-test@example.test', username: 'PilotOne',
    password: 'disposable-test-password-123', legacyToken: secret, legacyClaimHash: 'attacker-value' });
  assert.equal(signup.status, 200, await signup.clone().text());
  const firstToken = signup.headers.get('set-auth-token');
  assert.ok(firstToken);
  const player = await db.prepare("SELECT * FROM players WHERE id = 'legacy-owned'").first();
  assert.equal(player.balance, 23300);
  assert.equal(player.name, 'PilotOne');
  assert.equal(player.legacy_token_hash, null);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM ledger WHERE player_id = 'legacy-owned'").first()).n, 0);
  const fresh = await post('sign-up/email', { email: 'fresh-test@example.test', username: 'FreshPilot', password: 'disposable-test-password-123' });
  assert.equal(fresh.status, 200, await fresh.clone().text());
  const freshUser = (await fresh.json()).user;
  assert.equal((await db.prepare('SELECT balance FROM players WHERE user_id = ?').bind(freshUser.id).first()).balance, 50000);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM ledger WHERE player_id = ?').bind(freshUser.id).first()).n, 1);
  assert.equal(typeof (await db.prepare('SELECT created_at FROM ledger WHERE player_id = ?').bind(freshUser.id).first()).created_at, 'number');
  const duplicate = await post('sign-up/email', { email: 'duplicate-test@example.test', username: 'pilotone', password: 'disposable-test-password-123' });
  assert.notEqual(duplicate.status, 200);
  const reclaim = await post('sign-up/email', { email: 'reclaim-test@example.test', username: 'ReclaimPilot', password: 'disposable-test-password-123', legacyToken: secret });
  assert.notEqual(reclaim.status, 200);
  assert.equal(await db.prepare("SELECT id FROM auth_user WHERE email = 'reclaim-test@example.test'").first(), null);
  const second = await post('sign-in/email', { email: 'migration-test@example.test', password: 'disposable-test-password-123' });
  assert.equal(second.status, 200);
  const secondToken = second.headers.get('set-auth-token');
  const session = async token => (await (await call('/auth/get-session', { headers: { Authorization: `Bearer ${token}` } })).json());
  assert.equal((await session(firstToken)).user.id, player.user_id);
  assert.equal((await session(secondToken)).user.id, player.user_id);
  assert.equal((await post('sign-out', {}, firstToken)).status, 200);
  assert.equal(await session(firstToken), null);
  assert.equal((await session(secondToken)).user.id, player.user_id);
  assert.equal(await session('a'.repeat(64)), null);
  await db.prepare("UPDATE league_state SET maintenance = 1 WHERE id = 'live'").run();
  assert.equal((await post('sign-in/email', { email: 'migration-test@example.test', password: 'disposable-test-password-123' })).status, 503);
});

test('an imported Convex password authenticates through the complete Better Auth D1 flow', async () => {
  const db = await mf.getD1Database('DB', 'api');
  const password = 'Ｔｅｓｔ-imported-password-123';
  const hash = await new Scrypt().hash(password);
  await db.batch([
    db.prepare("INSERT INTO auth_user(id,name,email,emailVerified,createdAt,updatedAt,username,displayUsername) VALUES ('imported-user','Imported','imported@example.test',0,1,1,'imported','Imported')"),
    db.prepare("INSERT INTO auth_account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES ('imported-account','imported-user','credential','imported-user',?,1,1)").bind(hash),
    db.prepare("UPDATE league_state SET maintenance = 0 WHERE id = 'live'"),
  ]);
  const response = await call('/auth/sign-in/email', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email: 'imported@example.test', password }) });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).user.id, 'imported-user');
  assert.ok(response.headers.get('set-auth-token'));
  assert.equal((await db.prepare("SELECT count(*) AS n FROM players WHERE user_id = 'imported-user'").first()).n, 1);
  await db.prepare("UPDATE league_state SET maintenance = 1 WHERE id = 'live'").run();
});

test('password reset uses an expiring single-use code and revokes old sessions without changing wallets', async () => {
  const db = await mf.getD1Database('DB', 'api');
  await db.prepare('DELETE FROM auth_rate_limit').run();
  await db.prepare("UPDATE league_state SET maintenance = 0 WHERE id = 'live'").run();
  const post = (path, body) => call('/auth/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' }, body: JSON.stringify(body) });
  const signin = await post('sign-in/email', { email: 'fresh-test@example.test', password: 'disposable-test-password-123' });
  const oldToken = signin.headers.get('set-auth-token'); assert.ok(oldToken);
  assert.equal((await post('email-otp/request-password-reset', { email: 'fresh-test@example.test' })).status, 200);
  assert.match(resetCode, /^[0-9]{8}$/);
  const verification = await db.prepare('SELECT * FROM auth_verification').first();
  const expiry = new Date(verification.expiresAt).getTime();
  assert.ok(expiry > Date.now() && expiry <= Date.now() + 600000);
  assert.ok(!verification.value.includes(resetCode));
  const reset = { email: 'fresh-test@example.test', otp: resetCode, password: 'new-disposable-password-456' };
  assert.notEqual((await post('email-otp/reset-password', { ...reset, otp: 'incorrect' })).status, 200);
  assert.equal((await post('email-otp/reset-password', reset)).status, 200);
  assert.notEqual((await post('email-otp/reset-password', reset)).status, 200);
  const old = await call('/auth/get-session', { headers: { Authorization: `Bearer ${oldToken}` } });
  assert.equal(await old.json(), null);
  assert.equal((await post('sign-in/email', { email: 'fresh-test@example.test', password: reset.password })).status, 200);
  assert.equal((await db.prepare("SELECT balance FROM players WHERE name = 'FreshPilot'").first()).balance, 50000);
  await db.prepare("UPDATE league_state SET maintenance = 1 WHERE id = 'live'").run();
});

test('concurrent command retries debit once; lifecycle settles in pages and never credits twice', async () => {
  const db = await mf.getD1Database('DB', 'api');
  await db.prepare('DELETE FROM auth_rate_limit').run();
  await db.prepare("UPDATE league_state SET maintenance = 0, next_at = NULL WHERE id = 'live'").run();
  const login = await call('/auth/sign-in/email', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email: 'migration-test@example.test', password: 'disposable-test-password-123' }) });
  const token = login.headers.get('set-auth-token'); assert.ok(token);
  const p = await db.prepare("SELECT * FROM players WHERE id = 'legacy-owned'").first(), before = p.balance;
  const now = Date.now();
  await db.prepare('INSERT INTO fights(id,sequence,ships_json,odds_json,odds_samples,odds_key,seed,duration,winner,stats_json,story,crowd_json,opens_at,starts_at,ends_at,next_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind('economic-fight', 1, JSON.stringify(ships), '[0.5,0.5]', 128, 'test-odds', 1, 1, 0, '[]', 'Test story', '[2000000,2000000]', now, now + 600000, now + 700000, now + 710000).run();
  await db.prepare("UPDATE league_state SET current_id = 'economic-fight' WHERE id = 'live'").run();
  const rpc = body => call('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Origin: 'http://localhost:3000' }, body: JSON.stringify(body) });
  const command = { kind: 'command', name: 'game:wager', commandId: 'retry-wager-123', args: { fight: 'economic-fight', side: 0, stake: 1000 } };
  const responses = await Promise.all(Array.from({ length: 3 }, () => rpc(command)));
  for (const response of responses) assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await db.prepare("SELECT balance FROM players WHERE id = 'legacy-owned'").first()).balance, before - 1000);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM wagers WHERE fight_id = 'economic-fight'").first()).n, 1);
  assert.equal((await rpc({ ...command, args: { ...command.args, stake: 2000 } })).status, 400);
  const guest = await (await call('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'query', name: 'game:home' }) })).json();
  assert.equal(guest.value.authenticated, false);
  assert.deepEqual(guest.value.fight.betting,{bySide:[1000,0],total:1000});
  assert.equal('winner' in guest.value.fight, false);
  assert.equal('seed' in guest.value.fight, false);
  assert.equal('trace_key' in guest.value.fight, false);
  const transfer = (await db.prepare("SELECT * FROM wagers WHERE fight_id = 'economic-fight'").first()).payout;
  await db.prepare("UPDATE fights SET starts_at = ?, ends_at = ?, next_at = ? WHERE id = 'economic-fight'").bind(now - 20000, now - 10000, now + 600000).run();
  const tick = async () => {
    const response = await call('/internal/control', { method: 'POST', headers, body: JSON.stringify({ action: 'advance' }) });
    assert.equal(response.status, 200, await response.clone().text());
  };
  await tick(); await tick(); await tick();
  assert.equal((await db.prepare("SELECT balance FROM players WHERE id = 'legacy-owned'").first()).balance, before - 1000 + transfer);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM ledger WHERE player_id = 'legacy-owned' AND kind = 'settlement'").first()).n, 1);
  assert.equal((await db.prepare("SELECT settled FROM fights WHERE id = 'economic-fight'").first()).settled, 1);
  assert.equal((await call('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + 'a'.repeat(64) }, body: JSON.stringify(command) })).status, 401);
  await db.prepare("UPDATE league_state SET maintenance = 1, current_id = NULL, next_at = NULL WHERE id = 'live'").run();
});

test('WebSocket snapshots personalize on join and become guest snapshots immediately after revocation', async () => {
  const db = await mf.getD1Database('DB', 'api');
  await db.prepare('DELETE FROM auth_rate_limit').run();
  await db.prepare("UPDATE league_state SET maintenance = 0 WHERE id = 'live'").run();
  const response = await call('/auth/sign-in/email', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' }, body: JSON.stringify({ email: 'migration-test@example.test', password: 'disposable-test-password-123' }) });
  const token = response.headers.get('set-auth-token'); assert.ok(token);
  const upgrade = await call('/socket', { headers: { Upgrade: 'websocket', Origin: 'http://localhost:3000' } });
  assert.equal(upgrade.status, 101);
  const socket = upgrade.webSocket, messages = [], pending = [];
  socket.accept();
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data); messages.push(data);
    for (const waiter of [...pending]) if (waiter.predicate(data)) { pending.splice(pending.indexOf(waiter),1); clearTimeout(waiter.timer); waiter.resolve(data); }
  });
  const waitFor = predicate => {
    const existing = messages.find(predicate); if (existing) return Promise.resolve(existing);
    return new Promise((resolve,reject) => { const waiter = { predicate, resolve }; waiter.timer=setTimeout(()=>reject(new Error('Socket snapshot timed out')),5000); pending.push(waiter); });
  };
  socket.send(JSON.stringify({ type: 'hello', token }));
  assert.equal((await waitFor(m=>m.type==='ready')).authenticated, true);
  socket.send(JSON.stringify({ type: 'subscribe', id: 'home-subscription', name: 'game:home', args: {} }));
  const own = await waitFor(m=>m.type==='snapshot'&&m.value.authenticated);
  assert.equal(own.value.player.id, 'legacy-owned');
  assert.ok(own.value.transactions.length > 0);
  await call('/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', Authorization: `Bearer ${token}` }, body: '{}' });
  await waitFor(m=>m.type==='session-expired');
  const guest = await waitFor(m=>m.type==='snapshot'&&!m.value.authenticated);
  assert.equal(guest.value.player.id, null); assert.deepEqual(guest.value.transactions, []);
  socket.close();
  await db.prepare("UPDATE league_state SET maintenance = 1 WHERE id = 'live'").run();
});
after(async () => { await mf?.dispose(); });

test('health is honest about prototype readiness; benchmark is protected and simulator has no public endpoint', async () => {
  assert.equal((await (await call('/health')).json()).gameplayReady, false);
  assert.equal((await call('/internal/benchmark', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(job()) })).status, 401);
  assert.equal((await call('/health', { headers: { Origin: 'https://untrusted.example' } })).status, 403);
  const preflight = await call('/internal/benchmark', { method: 'OPTIONS', headers: { Origin: 'http://localhost:3000' } });
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'http://localhost:3000');
  const worker = await mf.getWorker('simulator');
  assert.equal((await worker.fetch('http://simulator/')).status, 404);
});

test('compiled-module Worker produces exactly the current Node fight and odds, including 400 samples', { timeout: 120_000 }, async () => {
  const raw = JSON.stringify(nodeSim.fight(ships, 73421));
  const expectedHash = createHash('sha256').update(raw).digest('hex');
  for (const samples of [1, 128, 400]) {
    const started = performance.now();
    const response = await call('/internal/benchmark', { method: 'POST', headers, body: JSON.stringify(job(samples)) });
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    const workerWallMs = Math.round(performance.now() - started);
    assert.equal(result.sha256, expectedHash);
    assert.equal(result.rawBytes, Buffer.byteLength(raw));
    assert.equal(result.odds[0], Math.max(0.05, Math.min(0.95, nodeSim.odds(ships, 51283, samples))));
    assert.ok(result.compressedBytes < result.rawBytes);
    assert.ok(result.wasmMemoryBytes < 128 * 1024 * 1024);
    console.log(JSON.stringify({ runtime: 'local-workerd', samples, workerWallMs, ...result,
      ships: undefined, stats: undefined, seed: undefined, oddsKey: undefined, story: undefined }));
  }
});

test('cached-odds jobs remain deterministic under concurrent invocations; invalid jobs are rejected', async () => {
  const [a, b] = await Promise.all([73421, 83422].map(seed => call('/internal/benchmark', {
    method: 'POST', headers, body: JSON.stringify(job(1, { seed, probability: 0.6 })),
  })));
  for (const [response, seed] of [[a, 73421], [b, 83422]]) {
    const result = await response.json();
    assert.equal(result.sha256, createHash('sha256').update(JSON.stringify(nodeSim.fight(ships, seed))).digest('hex'));
    assert.equal(result.odds[0], 0.6);
  }
  assert.equal((await call('/internal/benchmark', { method: 'POST', headers, body: JSON.stringify(job(9999)) })).status, 422);
});

test('D1 enforces monetary and ownership invariants and failed batches roll back', async () => {
  const db = await mf.getD1Database('DB', 'api');
  await assert.rejects(db.batch([
    db.prepare("INSERT INTO players(id, name, balance, created_at) VALUES ('atomic-one', 'One', 50000, 1)"),
    db.prepare("INSERT INTO players(id, name, balance, created_at) VALUES ('bad-units', 'Bad', 51, 1)"),
  ]));
  assert.equal(await db.prepare("SELECT id FROM players WHERE id = 'atomic-one'").first(), null);
  await db.prepare("INSERT INTO players(id, user_id, name, balance, created_at) VALUES ('owned-one', 'user-one', 'One', 50000, 1)").run();
  await assert.rejects(db.prepare("INSERT INTO players(id, user_id, name, balance, created_at) VALUES ('owned-two', 'user-one', 'Two', 50000, 1)").run());
});

test('private preparation persists a gzip trace with verified checksum and decoding metadata', async () => {
  const response = await call('/internal/prepare', { method: 'POST', headers,
    body: JSON.stringify(job(128, { probability: 0.6, fightId: 'retained-test' })) });
  assert.equal(response.status, 200);
  const result = await response.json();
  const bucket = await mf.getR2Bucket('TRACES', 'api');
  const object = await bucket.get(result.traceKey);
  assert.ok(object);
  assert.equal(object.httpMetadata.contentType, 'application/json');
  assert.equal(object.httpMetadata.contentEncoding, 'gzip');
  const raw = gunzipSync(Buffer.from(await object.arrayBuffer()));
  assert.equal(createHash('sha256').update(raw).digest('hex'), result.sha256);
  assert.equal(JSON.parse(raw.toString()).winner, result.winner);
  assert.equal((await call('/internal/prepare', { method: 'POST', body: '{}' })).status, 401);
  const db = await mf.getD1Database('DB','api'), now = Date.now();
  await db.prepare('INSERT INTO fights(id,sequence,ships_json,odds_json,odds_samples,odds_key,seed,duration,winner,stats_json,story,trace_key,crowd_json,opens_at,starts_at,ends_at,next_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind('replay-gate',2,JSON.stringify(ships),'[0.5,0.5]',128,'replay-odds',1,10,0,'[]','Story',result.traceKey,'[2000000,2000000]',now,now+60000,now+70000,now+85000).run();
  await db.prepare("UPDATE league_state SET current_id = 'replay-gate' WHERE id = 'live'").run();
  assert.equal((await call('/replay/replay-gate')).status,404);
  await db.prepare("UPDATE fights SET starts_at = ? WHERE id = 'replay-gate'").bind(now-1000).run();
  const live = await call('/replay/replay-gate'); assert.equal(live.status,200);
  assert.equal(live.headers.get('Cache-Control'),'private, no-store');
  assert.equal(JSON.parse(await live.text()).winner,result.winner);
  assert.equal((await call('/archive/replay/replay-gate')).status,404);
  await db.prepare("UPDATE fights SET settled = 1, ends_at = ?, next_at = ? WHERE id = 'replay-gate'").bind(now-1000,now+60000).run();
  assert.equal((await call('/archive/replay/replay-gate')).status,404);
  await db.prepare("UPDATE fights SET next_at = ? WHERE id = 'replay-gate'").bind(now-1).run();
  assert.equal((await call('/archive/replay/replay-gate')).status,200);
  await db.prepare("UPDATE fights SET replay_unavailable = 1 WHERE id = 'replay-gate'").run();
  assert.equal((await call('/archive/replay/replay-gate')).status,404);
  await db.prepare("UPDATE league_state SET current_id = NULL WHERE id = 'live'").run();
});

test('Better Auth verifies current Convex/Lucia scrypt hashes in Node and Workers, including normalization', async () => {
  const worker = await mf.getWorker('password-test');
  const old = new Scrypt();
  for (const password of ['disposable-test-passphrase-123', 'Ｔｅｓｔ-password-123']) {
    const hash = await old.hash(password);
    assert.equal(await verifyPassword({ hash, password }), true);
    const verify = async value => (await (await worker.fetch('http://password-test/', {
      method: 'POST', body: JSON.stringify({ hash, password: value }),
    })).json()).valid;
    assert.equal(await verify(password), true);
    assert.equal(await verify('incorrect-password'), false);
  }
});

test('coordinator reads authoritative D1 state and repairs alarm changes without game traffic', async () => {
  const db = await mf.getD1Database('DB', 'api');
  const before = await (await call('/internal/status', { headers })).json();
  assert.equal(before.maintenance, true);
  const deadline = Date.now() + 3600_000;
  await db.prepare('UPDATE league_state SET revision = 7, maintenance = 0, next_at = ? WHERE id = ?').bind(deadline, 'live').run();
  const after = await (await call('/internal/status', { headers })).json();
  assert.equal(after.revision, 7);
  assert.equal(after.nextAt, deadline);
  assert.equal(after.alarmAt, deadline);
  await db.prepare("UPDATE league_state SET maintenance = 1 WHERE id = 'live'").run();
  const stopped = await (await call('/internal/status', { headers })).json();
  assert.equal(stopped.maintenance, true);
  assert.equal(stopped.alarmAt, null);
});

test('queue preparation calls the private coordinator and duplicate delivery does not create a second fight', async () => {
  const db=await mf.getD1Database('DB','api'), now=Date.now(), jobId='queued-fixture';
  for(const s of ships)await db.prepare('INSERT INTO ships(id,name,style,identity,revision,crew_json) VALUES (?,?,?,?,?,?)').bind(s.id,s.name,s.style,s.identity,s.revision,JSON.stringify(s.crew)).run();
  await db.prepare('INSERT INTO fights(id,sequence,ships_json,odds_json,odds_samples,odds_key,seed,duration,winner,stats_json,story,crowd_json,opens_at,starts_at,ends_at,next_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind('queue-live',99999,JSON.stringify(ships),'[0.5,0.5]',1,'queue-odds',1,3600,0,'[]','Queue fixture','[0,0]',now-60000,now-1000,now+3600000,now+3620000).run();
  await db.prepare("UPDATE league_state SET maintenance = 0,current_id = 'queue-live',pending_id = NULL,generation = 900,queue_json = ?,next_at = ? WHERE id = 'live'").bind(JSON.stringify([ships.map(s=>s.id)]),now+3600000).run();
  await db.prepare("INSERT INTO preparation_jobs(id,generation,ships_json,status,created_at,updated_at,input_json,sequence,lease_until) VALUES (?,900,?,'running',?,?,?,?,?)").bind(jobId,JSON.stringify(ships),now,now,JSON.stringify(job(1,{fightId:jobId,probability:0.6})),100000,now+300000).run();
  const queue=await mf.getQueueProducer('PREPARATIONS','api');
  await queue.send({jobId});
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){if(await db.prepare('SELECT id FROM fights WHERE id = ?').bind(jobId).first())break;await new Promise(r=>setTimeout(r,50));}
  const f=await db.prepare('SELECT * FROM fights WHERE id = ?').bind(jobId).first();assert.ok(f);assert.equal(f.opens_at,null);
  const trace=await (await mf.getR2Bucket('TRACES','api')).get(f.trace_key);assert.ok(trace);
  await queue.send({jobId});await new Promise(r=>setTimeout(r,100));
  assert.equal((await db.prepare('SELECT count(*) AS n FROM fights WHERE id = ?').bind(jobId).first()).n,1);
  const state=await db.prepare('SELECT * FROM league_state').first();assert.equal(state.pending_id,jobId);
  await db.prepare("UPDATE league_state SET maintenance = 1 WHERE id = 'live'").run();
  await call('/internal/status',{headers});
});
