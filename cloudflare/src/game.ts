import { ECONOMY, TIMING, maxBet, betCheck, settlement, ownerIncome, crewLocked, candidate, STATIONS, quote, phase } from '../../shared/rules.js';
import { bettingSummary } from '../../shared/betting-summary.js';
import { crewName } from '../../shared/crew-names.js';
import { oddsKey } from '../../shared/simulator.js';
import { roster } from '../../convex/roster';
import { rotation } from '../../convex/matchmaking';
import { sha256 } from './auth';
import type { SimulationInput, SimulationMetadata, SimulationMetrics } from './simulator';

type Row = Record<string, any>;
export type State = { revision: number; generation: number; maintenance: number; current_id: string | null;
  pending_id: string | null; queue_json: string; next_at: number | null; phase: string; error: string | null;
  reopened_at: number | null; new_writes_at: number | null; import_source_hash: string | null };
const id = () => crypto.randomUUID();
const random = () => crypto.getRandomValues(new Uint32Array(1))[0] || 1;
const snapshot = (s: Row) => ({ id: s.id, name: s.name, style: s.style, identity: s.identity,
  revision: s.revision, crew: JSON.parse(s.crew_json), ...(s.owner_id ? { owner: s.owner_id } : {}) });
const fight = (f: Row | null): Row | null => f && ({ ...f, ships: JSON.parse(f.ships_json), odds: JSON.parse(f.odds_json),
  stats: JSON.parse(f.stats_json), crowd: JSON.parse(f.crowd_json), opensAt: f.opens_at, startsAt: f.starts_at,
  endsAt: f.ends_at, nextAt: f.next_at, oddsSamples: f.odds_samples, ownerPayout: f.owner_payout });
function canonical(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

/** All calls run inside League's explicit serial section, except simulator RPC. */
export class Game {
  private readCache: Map<string, Promise<any>> | null = null;
  private snapshotTime: number | null = null;
  private snapshotCache: { at: number; reads: Map<string, Promise<any>> } | null = null;
  constructor(readonly env: Env) {}
  sql(query: string, ...values: any[]) { return this.env.DB.prepare(query).bind(...values.map(v => v ?? null)); }
  private read<T>(key: string, operation: () => Promise<T>): Promise<T> {
    if (!this.readCache) return operation();
    if (!this.readCache.has(key)) this.readCache.set(key, operation());
    return this.readCache.get(key)!;
  }
  invalidateSnapshots() { this.snapshotCache = null; }
  async cachedSnapshots(operation: () => Promise<void>, reuse = false) {
    if (!reuse || !this.snapshotCache || Date.now() - this.snapshotCache.at >= 5000) {
      this.snapshotCache = { at: Date.now(), reads: new Map() };
    }
    this.readCache = this.snapshotCache.reads;
    this.snapshotTime = this.snapshotCache.at;
    try { await operation(); } finally { this.readCache = null; this.snapshotTime = null; }
  }
  async one(query: string, ...values: any[]) { return this.read('one:'+query+canonical(values), () => this.sql(query, ...values).first<Row>()); }
  async rows(query: string, ...values: any[]) { return this.read('rows:'+query+canonical(values), async () => (await this.sql(query, ...values).all<Row>()).results); }
  async state() { const row = await this.one("SELECT * FROM league_state WHERE id = 'live'"); if (!row) throw new Error('League is not initialized'); return row as State; }
  async current(s: State) { return fight(s.current_id ? await this.one('SELECT * FROM fights WHERE id = ?', s.current_id) : null); }
  async commit(s: State, statements: D1PreparedStatement[], patch: Row = {}) {
    const key = id();
    const columns = Object.keys(patch);
    await this.env.DB.batch([
      this.sql("INSERT INTO commit_guard(id,valid) VALUES (?, COALESCE((SELECT CASE WHEN revision = ? THEN 1 ELSE 0 END FROM league_state WHERE id = 'live'), 0))", key, s.revision),
      ...statements,
      this.sql(`UPDATE league_state SET revision = revision + 1${columns.length ? ', ' + columns.map(k => `${k} = ?`).join(', ') : ''} WHERE id = 'live'`, ...columns.map(k => patch[k])),
      this.sql('DELETE FROM commit_guard WHERE id = ?', key),
    ]);
  }
  async player(userId: string) { const p = await this.one('SELECT * FROM players WHERE user_id = ?', userId); if (!p) throw new Error('Sign in to an account first.'); return p; }
  async own(p: Row) { return this.one('SELECT * FROM ships WHERE owner_id = ?', p.id); }
  async editable(p: Row, f: Row | null) {
    const ship = await this.own(p); if (!ship) throw new Error('Sponsor a ship first.');
    if (crewLocked(ship.id, f, Date.now())) throw new Error('Your ship is locked for this matchup. You can make changes after its fight.');
    return ship;
  }
  move(out: D1PreparedStatement[], p: Row, amount: number, kind: string, note: string, effect: string, fightId?: string) {
    if (!Number.isSafeInteger(amount) || amount % 100 || p.balance + amount < 0) throw new Error('Not enough credits.');
    p.balance += amount;
    out.push(this.sql('UPDATE players SET balance = ? WHERE id = ?', p.balance, p.id),
      this.sql('INSERT INTO ledger(id,player_id,fight_id,kind,amount,balance,note,effect_key,created_at) VALUES (?,?,?,?,?,?,?,?,?)', id(), p.id, fightId, kind, amount, p.balance, note, effect, Date.now()));
  }
  async stipend(out: D1PreparedStatement[], p: Row, effect: string) {
    if (p.balance !== 0 || Date.now() - p.last_recovery < 3600000 || await this.one('SELECT id FROM wagers WHERE player_id = ? AND returned IS NULL LIMIT 1', p.id)) return false;
    this.move(out, p, ECONOMY.recovery, 'recovery', 'Hourly refill stipend', effect);
    out.push(this.sql('UPDATE players SET last_recovery = ? WHERE id = ?', Date.now(), p.id)); return true;
  }
  async publicFight(f: Row | null, now: number, loadedWagers?: Row[]) {
    if (!f) return null;
    const wagers = loadedWagers ?? await this.rows('SELECT side,stake,payout FROM wagers WHERE fight_id = ?', f.id);
    const ended = f.endsAt !== null && now >= f.endsAt;
    return { id: f.id, sequence: f.sequence, ships: f.ships, odds: f.odds, oddsSamples: f.oddsSamples,
      betting: bettingSummary(wagers, ended ? f.winner : undefined, f.crowd, f.odds),
      opensAt: f.opensAt, startsAt: f.startsAt, endsAt: f.endsAt, nextAt: f.nextAt,
      replayUnavailable: !!f.replay_unavailable,
      ...(ended ? { winner: f.winner, stats: f.stats, story: f.story, settled: !!f.settled, ownerPayout: f.ownerPayout } : {}) };
  }
  async query(name: string, args: Row, userId: string | null, baseURL: string) {
    if (name === 'auth:options') return { passwordReset: !!(this.env.AUTH_RESEND_KEY && this.env.AUTH_EMAIL_FROM) };
    if (name === 'game:clock') return Date.now();
    const s = await this.state(), now = this.snapshotTime ?? Date.now(), f = await this.current(s);
    const p = userId ? await this.player(userId) : null;
    if (name === 'game:trace') {
      const target = fight(await this.one('SELECT * FROM fights WHERE id = ?', args.fight));
      const live = target && target.id === s.current_id && now >= target.startsAt && now < target.nextAt;
      const historical = target && target.settled && now >= target.nextAt;
      return target?.trace_key && !target.replay_unavailable && (live || historical) ? `${baseURL}/replay/${encodeURIComponent(target.id)}` : null;
    }
    if (name === 'game:archive' || name === 'game:archivePage') {
      const before = args.before ?? Number.MAX_SAFE_INTEGER;
      if (!Number.isSafeInteger(before) || before < 0) throw new Error('Invalid archive cursor');
      const rows = await this.rows('SELECT * FROM fights WHERE settled = 1 AND ends_at <= ? AND sequence < ? ORDER BY sequence DESC LIMIT 31', now, before);
      const page = rows.slice(0, 30);
      const wagers = page.length ? await this.rows(`SELECT fight_id,side,stake,payout FROM wagers WHERE fight_id IN (${page.map(() => '?').join(',')})`, ...page.map(r => r.id)) : [];
      const items = await Promise.all(page.map(r => this.publicFight(fight(r), now, wagers.filter(w => w.fight_id === r.id))));
      return name === 'game:archive' ? items : { items, next: rows.length > 30 ? rows[29].sequence : null };
    }
    if (name === 'chat:list') {
      const muted = p ? new Set((await this.rows('SELECT muted_id FROM mutes WHERE player_id = ?', p.id)).map(r => r.muted_id)) : new Set();
      return (await this.rows('SELECT * FROM messages ORDER BY created_at DESC,id DESC LIMIT 80')).filter(r => !muted.has(r.player_id)).reverse()
        .map(r => ({ id: r.id, player: r.player_id, name: r.name, body: r.body, ship: r.ship, at: r.created_at, fight: r.fight_id }));
    }
    if (name !== 'game:home') throw new Error('Unknown query');
    const [ship, wagers, transactions, lastOwnerIncome, publicCurrent] = await Promise.all([
      p ? this.own(p) : null,
      p && f ? this.one('SELECT * FROM wagers WHERE player_id = ? AND fight_id = ?', p.id, f.id) : null,
      p ? this.rows('SELECT *, id AS _id, created_at AS _creationTime FROM ledger WHERE player_id = ? ORDER BY created_at DESC,id DESC LIMIT 12', p.id) : [],
      p ? this.one("SELECT * FROM ledger WHERE player_id = ? AND kind = 'owner' ORDER BY created_at DESC LIMIT 1", p.id) : null,
      this.publicFight(f, now),
    ]);
    const queue = JSON.parse(s.queue_json), index = ship ? queue.findIndex((pair: string[]) => pair.includes(ship.id)) : -1;
    const opponentId = index >= 0 ? queue[index].find((v: string) => v !== ship!.id) : null;
    const opponent = opponentId ? await this.one('SELECT name FROM ships WHERE id = ?', opponentId) : null;
    const recent = ship ? await this.rows('SELECT * FROM fights WHERE settled = 1 AND ends_at <= ? ORDER BY sequence DESC LIMIT 100', now) : [];
    const shipActivity = recent.map(r => fight(r)!).filter(r => r.ships.some((v: Row) => v.id === ship!.id)).slice(0, 5).map(r => {
      const side = r.ships.findIndex((v: Row) => v.id === ship!.id);
      return { sequence: r.sequence, opponent: r.ships[1-side].name, result: r.winner === null ? 'draw' : r.winner === side ? 'win' : 'loss', income: r.winner === side ? r.ownerPayout : 0, hull: r.stats[side].hull, endedAt: r.endsAt };
    });
    return { now, revision: s.revision, authenticated: !!p,
      player: p ? { id: p.id, name: p.name, balance: p.balance, maxBet: maxBet(p.balance), nextStipendAt: p.last_recovery + 3600000, candidate: p.candidate_json ? JSON.parse(p.candidate_json) : null }
        : { id: null, name: 'Spectator', balance: 0, maxBet: 0, nextStipendAt: 0, candidate: null },
      ship: ship ? { ...snapshot(ship), _id: ship.id, owner: ship.owner_id, earnings: ship.earnings, wins: ship.wins, fights: ship.fights, lastFight: ship.last_fight, locked: crewLocked(ship.id, f, now) } : null,
      fight: publicCurrent, wager: wagers ? { ...wagers, _id: wagers.id, player: wagers.player_id, fight: wagers.fight_id } : null,
      transactions, shipActivity, lastOwnerIncome,
      upcoming: index >= 0 ? { fightsRemaining: index + 1, opponent: opponent?.name ?? 'Opponent unavailable' } : null,
      economy: ECONOMY, status: s.maintenance ? 'maintenance' : s.error ? 'recovering' : s.current_id ? 'ready' : 'preparing' };
  }
  async command(userId: string, commandId: string, name: string, args: Row) {
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(commandId)) throw new Error('Invalid command identifier');
    const [s, p, hash] = await Promise.all([this.state(), this.player(userId), sha256(canonical({ name, args }))]);
    if (s.maintenance) throw new Error('League maintenance is in progress');
    const [previous, rate, f] = await Promise.all([
      this.one('SELECT * FROM commands WHERE actor_id = ? AND command_id = ?', p.id, commandId),
      this.one('SELECT window_start, count FROM command_rates WHERE actor_id = ?', p.id),
      this.current(s),
    ]);
    if (previous) { if (previous.payload_hash !== hash) throw new Error('Command identifier was already used for another request'); return JSON.parse(previous.result_json); }
    const windowStart = !rate || Date.now() - rate.window_start >= 10000 ? Date.now() : rate.window_start;
    const count = !rate || windowStart !== rate.window_start ? 1 : rate.count + 1;
    if (count > 30) throw new Error('Wait a moment before sending more commands.');
    const out: D1PreparedStatement[] = [], patch: Row = {};
    patch.new_writes_at = s.new_writes_at ?? Date.now();
    const effect = `command:${p.id}:${commandId}`;
    const invalidate = async (shipId: string, force = false) => {
      const pending = s.pending_id ? await this.one('SELECT ships_json FROM fights WHERE id = ?', s.pending_id) : null;
      const job = await this.one("SELECT ships_json FROM preparation_jobs WHERE generation = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1", s.generation);
      if (!force && ![pending,job].some(row => row && JSON.parse(row.ships_json).some((v: Row) => v.id === shipId))) return;
      patch.pending_id = null; patch.generation = s.generation + 1; patch.preparing = 0; patch.next_at = Date.now() + 1;
    };
    if (name === 'game:join' || name === 'game:recovery') {
      if (!await this.stipend(out, p, effect) && name === 'game:recovery') throw new Error('A 50-credit refill is available at zero balance, with no unsettled bets, at most once per hour.');
    } else if (name === 'game:wager') {
      if (!f || f.id !== args.fight) throw new Error('This matchup is no longer open.');
      const old = await this.one('SELECT id FROM wagers WHERE player_id = ? AND fight_id = ?', p.id, f.id);
      const w = betCheck(f, Date.now(), args.side, args.stake, p.balance, old, maxBet(p.balance));
      this.move(out, p, -w.stake, 'stake', `Backed ${f.ships[w.side].name}`, effect, f.id);
      out.push(this.sql('INSERT INTO wagers(id,player_id,fight_id,side,stake,payout) VALUES (?,?,?,?,?,?)', id(), p.id, f.id, w.side, w.stake, w.payout));
    } else if (name === 'game:sponsor') {
      if (await this.own(p)) throw new Error('Your berth already has a ship.');
      const r = roster.ships[random() % roster.ships.length], shipId = id();
      const shipName = ['Wayfarer', 'Redshift', 'Starling', 'Longshot', 'Peregrine', 'Afterglow'][random() % 6] + ' ' + (100 + random() % 900);
      const aboard: string[] = [], crew = r.crew.map(c => { const name = crewName(random(), aboard); aboard.push(name); return { ...c, name }; });
      this.move(out, p, -ECONOMY.sponsor, 'sponsor', `Sponsored ${shipName}`, effect);
      out.push(this.sql('INSERT INTO ships(id,owner_id,name,style,identity,revision,crew_json) VALUES (?,?,?,?,?,1,?)', shipId, p.id, shipName, r.style, 10000 + random() % 1000000, JSON.stringify(crew)));
      const eligible = await this.rows('SELECT * FROM ships WHERE testing = 0');
      const q = JSON.parse(s.queue_json), opponent = eligible[random() % eligible.length];
      if (!opponent) throw new Error('League roster is unavailable');
      const filler = q.findIndex((pair: string[]) => pair.every(v => !eligible.find(r => r.id === v)?.owner_id));
      if (filler >= 0) q[filler] = [shipId, opponent.id]; else q.push([shipId, opponent.id]);
      patch.queue_json = JSON.stringify(q); await invalidate(shipId, canonical(q[0]) !== canonical(JSON.parse(s.queue_json)[0] ?? null));
    } else if (name === 'game:tryout') {
      const ship = await this.editable(p, f); if (p.candidate_json) throw new Error('Decide on your current candidate first.');
      if (!STATIONS.includes(args.station)) throw new Error('Choose a crew station.');
      const c = candidate(random(), args.station, JSON.parse(ship.crew_json).map((v: Row) => v.name));
      this.move(out, p, -ECONOMY.tryout, 'tryout', `${args.station} candidate tryout`, effect);
      out.push(this.sql('UPDATE players SET candidate_json = ? WHERE id = ?', JSON.stringify({ shipId: ship.id, crew: c, paid: ECONOMY.tryout }), p.id));
    } else if (name === 'game:decide') {
      if (typeof args.accept !== 'boolean') throw new Error('Choose whether to hire the candidate');
      if (!p.candidate_json) throw new Error('No pending candidate.');
      if (args.accept) {
        const c = JSON.parse(p.candidate_json), ship = await this.editable(p, f);
        if (ship.id !== c.shipId) throw new Error('Candidate belongs to another ship');
        out.push(this.sql('UPDATE ships SET crew_json = ?, revision = revision + 1 WHERE id = ?', JSON.stringify(JSON.parse(ship.crew_json).map((old: Row) => old.station === c.crew.station ? c.crew : old)), ship.id)); await invalidate(ship.id);
      }
      out.push(this.sql('UPDATE players SET candidate_json = NULL WHERE id = ?', p.id));
    } else if (name === 'game:rename') {
      const ship = await this.editable(p, f), clean = typeof args.name === 'string' ? args.name.trim() : '';
      if (clean.length < 2 || clean.length > 24 || /[<>\x00-\x1f]/.test(clean)) throw new Error('Use 2–24 characters for the ship name.');
      if (clean === ship.name) throw new Error('That is already your ship’s name.');
      this.move(out, p, -ECONOMY.rename, 'rename', `${ship.name} → ${clean}`, effect);
      out.push(this.sql('UPDATE ships SET name = ?, revision = revision + 1 WHERE id = ?', clean, ship.id)); await invalidate(ship.id);
    } else if (name === 'chat:send') {
      const clean = typeof args.body === 'string' ? args.body.trim() : '';
      if (!clean || clean.length > 240 || /[\x00-\x08\x0e-\x1f]/.test(clean)) throw new Error('Messages must be 1–240 characters.');
      if (Date.now() - p.last_chat < 3000) throw new Error('Wait a moment before sending another message.');
      const ship = await this.own(p);
      out.push(this.sql('INSERT INTO messages(id,player_id,name,ship,body,fight_id,created_at) VALUES (?,?,?,?,?,?,?)', id(), p.id, p.name, ship?.name, clean, s.current_id, Date.now()), this.sql('UPDATE players SET last_chat = ? WHERE id = ?', Date.now(), p.id));
    } else if (name === 'chat:mute') {
      if (p.id === args.muted) throw new Error('You cannot mute yourself.');
      const old = await this.one('SELECT 1 FROM mutes WHERE player_id = ? AND muted_id = ?', p.id, args.muted);
      out.push(old ? this.sql('DELETE FROM mutes WHERE player_id = ? AND muted_id = ?', p.id, args.muted) : this.sql('INSERT INTO mutes(player_id,muted_id) VALUES (?,?)', p.id, args.muted));
    } else if (name === 'chat:report') {
      if (!await this.one('SELECT id FROM messages WHERE id = ?', args.message)) throw new Error('Message is no longer available.');
      out.push(this.sql('INSERT OR IGNORE INTO reports(player_id,message_id) VALUES (?,?)', p.id, args.message));
    } else if (name === 'game:profile') throw new Error('Your account username is used in chat.');
    else throw new Error('Unknown command');
    out.push(this.sql('INSERT INTO commands(actor_id,command_id,payload_hash,result_json,created_at) VALUES (?,?,?,?,?)', p.id, commandId, hash, 'null', Date.now()));
    out.push(this.sql('INSERT INTO command_rates(actor_id,window_start,count) VALUES (?,?,?) ON CONFLICT(actor_id) DO UPDATE SET window_start = excluded.window_start, count = excluded.count', p.id, windowStart, count));
    await this.commit(s, out, patch); return null;
  }

  async initialize() {
    const s = await this.state();
    if ((await this.one('SELECT count(*) AS n FROM ships'))!.n) return;
    await this.commit(s, roster.ships.map((r, i) => this.sql('INSERT INTO ships(id,name,style,identity,revision,crew_json,roster_index) VALUES (?,?,?,?,1,?,?)', `baseline-${i}`, r.name, r.style, 1000 + i, JSON.stringify(r.crew), i)));
  }
  async ensureQueue(s: State) {
    const ships = await this.rows('SELECT *, id AS _id, last_fight AS lastFight FROM ships WHERE testing = 0');
    if (ships.length < 2) throw new Error('At least two ships are required');
    const eligible = new Set(ships.map(v => v.id)), human = new Set(ships.filter(v => v.owner_id).map(v => v.id));
    let q: string[][] = JSON.parse(s.queue_json).filter((p: string[]) => p.length === 2 && p[0] !== p[1] && p.every(v => eligible.has(v)));
    if (q.length <= Math.ceil(ships.length / 2)) q.push(...rotation(ships));
    if (q.length <= Math.ceil(ships.length / 2)) q.push(...rotation(ships));
    const booked = new Set(q.flat());
    for (const ship of ships.filter(v => v.owner_id && !booked.has(v.id))) {
      const opponents = ships.filter(v => v.id !== ship.id && !v.owner_id);
      const pool = opponents.length ? opponents : ships.filter(v => v.id !== ship.id);
      q.push([ship.id, pool[random() % pool.length].id]);
    }
    q = q.map((pair, index) => ({ pair, index, priority: pair.some(v => human.has(v)) ? 0 : 1 })).sort((a,b) => a.priority-b.priority || a.index-b.index).map(v => v.pair);
    return { q, ships };
  }
  async reserve(): Promise<Row | null> {
    let s = await this.state(); if (s.maintenance || s.pending_id) return null;
    const active = await this.one("SELECT * FROM preparation_jobs WHERE generation = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1", s.generation);
    if (active && active.lease_until > Date.now()) return null;
    if (active) {
      await this.commit(s, [this.sql('UPDATE preparation_jobs SET lease_until = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?', Date.now() + 300000, Date.now(), active.id)]);
      return active;
    }
    const { q, ships } = await this.ensureQueue(s), pair = q[0].map(v => snapshot(ships.find(r => r.id === v)!));
    const last = await this.one('SELECT max(sequence) AS n FROM fights'), jobId = id();
    const cached = await this.one('SELECT * FROM odds_cache WHERE key = ?', oddsKey(pair));
    const input: SimulationInput = { ships: pair, fightId: jobId, seed: 1 + random() % 999999999,
      oddsSeed: 1 + random() % 999999999, samples: cached?.samples ?? (pair.every(v => v.identity >= 1000 && v.identity < 1010) ? 400 : 128),
      ...(cached ? { probability: cached.probability } : {}) };
    const row = { id: jobId, generation: s.generation, sequence: (last?.n ?? 0) + 1, input_json: JSON.stringify(input) };
    await this.commit(s, [this.sql('INSERT INTO preparation_jobs(id,generation,ships_json,status,created_at,updated_at,input_json,sequence,lease_until) VALUES (?,?,?,\'running\',?,?,?,?,?)', jobId, s.generation, JSON.stringify(pair), Date.now(), Date.now(), row.input_json, row.sequence, Date.now() + 300000)], { queue_json: JSON.stringify(q), preparing: 1 });
    return row;
  }
  async accept(job: Row, data: SimulationMetadata & SimulationMetrics & { traceKey: string }) {
    const s = await this.state(), current = await this.one('SELECT status FROM preparation_jobs WHERE id = ?', job.id);
    if (s.maintenance || s.generation !== job.generation || s.pending_id || current?.status !== 'running') return false;
    const q = JSON.parse(s.queue_json);
    let valid = q[0]?.every((v: string, i: number) => v === data.ships[i]?.id);
    for (const snap of data.ships) { const actual = await this.one('SELECT revision,testing FROM ships WHERE id = ?', snap.id); valid &&= !!actual && !actual.testing && actual.revision === snap.revision; }
    if (!valid) { await this.commit(s, [this.sql("UPDATE preparation_jobs SET status = 'stale', updated_at = ? WHERE id = ?", Date.now(), job.id)], { generation: s.generation + 1, preparing: 0 }); return false; }
    await this.commit(s, [
      this.sql('INSERT INTO fights(id,sequence,ships_json,odds_json,odds_samples,odds_key,seed,duration,winner,stats_json,story,trace_key,crowd_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', job.id, job.sequence, JSON.stringify(data.ships), JSON.stringify(data.odds), data.oddsSamples, data.oddsKey, data.seed, data.duration, data.winner, JSON.stringify(data.stats), data.story, data.traceKey, JSON.stringify([20000 + random() % 60000, 20000 + random() % 60000].map(n => n * 100))),
      this.sql('INSERT OR IGNORE INTO odds_cache(key,probability,samples,simulator_hash,created_at) VALUES (?,?,?,?,?)', data.oddsKey, data.odds[0], data.oddsSamples, 'wasm-tactics-v5', Date.now()),
      this.sql("UPDATE preparation_jobs SET status = 'complete', trace_key = ?, updated_at = ? WHERE id = ?", data.traceKey, Date.now(), job.id),
    ], { pending_id: job.id, preparing: 0, attempts: 0, error: null, next_at: Math.min(s.next_at ?? Infinity, Date.now() + 1) });
    return true;
  }
  async failed(job: Row) {
    const s = await this.state(); if (s.maintenance || s.generation !== job.generation || s.pending_id) return;
    await this.commit(s, [this.sql('UPDATE preparation_jobs SET lease_until = ?, updated_at = ? WHERE id = ?', Date.now() + 30000, Date.now(), job.id)], { error: 'Simulation preparation is retrying', next_at: Date.now() + 30000 });
  }
  async advance() {
    const s = await this.state(); if (s.maintenance) return;
    const f = await this.current(s), now = Date.now();
    if (f && now >= f.endsAt && !f.settled) {
      const wagers = await this.rows('SELECT * FROM wagers WHERE fight_id = ? AND returned IS NULL ORDER BY id LIMIT 25', f.id);
      if (wagers.length) {
        const out: D1PreparedStatement[] = [], players = new Map<string, Row>();
        for (const w of wagers) {
          const result = settlement(w, f.winner); let p = players.get(w.player_id);
          if (!p) { p = (await this.one('SELECT * FROM players WHERE id = ?', w.player_id))!; players.set(w.player_id, p); }
          this.move(out, p, result.returned, 'settlement', f.winner === null ? 'Draw · stake returned' : result.net > 0 ? 'Winning wager' : 'Wager lost', `settlement:${w.id}`, f.id);
          out.push(this.sql('UPDATE wagers SET returned = ?, net = ? WHERE id = ?', result.returned, result.net, w.id));
        }
        await this.commit(s, out, { phase: 'settling', next_at: now + 1 }); return;
      }
      const out: D1PreparedStatement[] = [], all = await this.rows('SELECT * FROM wagers WHERE fight_id = ?', f.id);
      const income = f.winner === null ? 0 : ownerIncome([...all.map(w => settlement(w, f.winner).profit), quote(f.crowd[f.winner], f.odds[f.winner]) - f.crowd[f.winner]]);
      if (f.winner !== null) { const ship = await this.one('SELECT * FROM ships WHERE id = ?', f.ships[f.winner].id);
        if (ship?.owner_id) { const p = (await this.one('SELECT * FROM players WHERE id = ?', ship.owner_id))!;
          this.move(out, p, income, 'owner', `${ship.name} owner income`, `owner:${f.id}`, f.id); out.push(this.sql('UPDATE ships SET earnings = earnings + ? WHERE id = ?', income, ship.id)); }
      }
      for (const [i, snap] of f.ships.entries()) out.push(this.sql('UPDATE ships SET fights = fights + 1, wins = wins + ? WHERE id = ?', f.winner === i ? 1 : 0, snap.id));
      out.push(this.sql('UPDATE fights SET settled = 1, owner_payout = ? WHERE id = ?', income, f.id));
      await this.commit(s, out, { phase: 'results', next_at: Math.max(now + 1, f.nextAt) }); return;
    }
    if ((!f || (f.settled && now >= f.nextAt)) && s.pending_id) {
      const pending = fight(await this.one('SELECT * FROM fights WHERE id = ?', s.pending_id));
      let valid = !!pending;
      for (const snap of pending?.ships ?? []) { const actual = await this.one('SELECT revision,testing FROM ships WHERE id = ?', snap.id); valid &&= !!actual && !actual.testing && actual.revision === snap.revision; }
      if (!valid) { await this.commit(s, [], { pending_id: null, generation: s.generation + 1, preparing: 0, next_at: now + 1000 }); return; }
      const starts = now + TIMING.betting, ends = starts + pending!.duration * 1000 + TIMING.finishHold;
      const out = [this.sql('UPDATE fights SET opens_at = ?, starts_at = ?, ends_at = ?, next_at = ? WHERE id = ?', now, starts, ends, ends + TIMING.results, pending!.id)];
      for (const snap of pending!.ships) out.push(this.sql('UPDATE ships SET last_fight = ? WHERE id = ?', pending!.sequence, snap.id));
      await this.commit(s, out, { current_id: pending!.id, pending_id: null, queue_json: JSON.stringify(JSON.parse(s.queue_json).slice(1)), generation: s.generation + 1, phase: 'betting', next_at: starts }); return;
    }
    const out: D1PreparedStatement[] = [];
    for (const p of await this.rows('SELECT * FROM players WHERE balance = 0 AND last_recovery <= ? LIMIT 25', now - 3600000)) await this.stipend(out, p, `recovery:${p.id}:${now}`);
    const next = f ? now < f.startsAt ? f.startsAt : now < f.endsAt ? f.endsAt : now + 1000 : now + 1000;
    if (f && now >= f.startsAt && !f.live_started) out.push(this.sql('UPDATE fights SET live_started = 1 WHERE id = ?', f.id));
    if (out.length || s.next_at === null || s.next_at <= now) await this.commit(s, out, { phase: phase(f, now), next_at: next });
  }
}
