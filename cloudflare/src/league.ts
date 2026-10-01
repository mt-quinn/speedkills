import { DurableObject } from 'cloudflare:workers';
import { accountRequest, accounts } from './auth';
import { Game } from './game';

type State = { revision: number; next_at: number | null; maintenance: number; phase: string };

/** Serialized authoritative league writes, durable alarms and personalized sockets. */
export class League extends DurableObject<Env> {
  private tail: Promise<unknown> = Promise.resolve();
  private game = new Game(this.env);
  private pumping = false;
  private lastCommandTiming: { queuedMs: number; executionMs: number } | null = null;

  private serial<T>(operation: () => Promise<T>, readonly = false): Promise<T> {
    const next = this.tail.then(() => { if (!readonly) this.game.invalidateSnapshots(); return operation(); });
    this.tail = next.catch(() => undefined);
    return next;
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname === '/socket') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      if (this.ctx.getWebSockets().length >= 1000) return new Response('Connection limit reached', { status: 503 });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ baseURL: url.origin, userId: null, sessionId: null, subscriptions: [], joined: false });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    let mutated = false;
    let affected = ['game:home', 'chat:list'];
    const receivedAt = Date.now();
    const result = await this.serial(async () => {
      if (url.pathname.startsWith('/auth/')) {
        const response = await accountRequest(request, this.env);
        mutated = request.method === 'POST' && response.ok;
        if (mutated) await this.repairAlarm();
        return response;
      }
      if (url.pathname !== '/rpc' || request.method !== 'POST') return Response.json({ error: 'Not found' }, { status: 404 });
      try {
        const text = await request.text(); if (text.length > 16384) return Response.json({ error: 'Payload too large' }, { status: 413 });
        const { kind, name, args = {}, commandId } = JSON.parse(text);
        const session = await accounts(this.env, url.origin).api.getSession({ headers: request.headers });
        if (kind === 'command') {
          if (!session) return Response.json({ error: 'Sign in to an account first.' }, { status: 401 });
          const startedAt = Date.now();
          const value = await this.game.command(session.user.id, commandId, name, args);
          this.lastCommandTiming = { queuedMs: startedAt - receivedAt, executionMs: Date.now() - startedAt };
          mutated = true;
          affected = name.startsWith('chat:') ? ['game:home', 'chat:list'] : ['game:home'];
          await this.repairAlarm();
          return Response.json({ value });
        }
        if (kind !== 'query') throw new Error('Unknown request');
        return Response.json({ value: await this.game.query(name, args, session?.user.id ?? null, url.origin) });
      } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Request failed' }, { status: 400 }); }
    });
    if (mutated) {
      this.ctx.waitUntil(this.broadcast(affected));
      this.ctx.waitUntil(this.prepare());
    }
    return result;
  }

  private async identity(attachment: any) {
    if (!attachment.sessionId) return null;
    const session = await this.game.one('SELECT userId, expiresAt FROM auth_session WHERE id = ?', attachment.sessionId);
    return session && session.userId === attachment.userId && new Date(session.expiresAt).getTime() > Date.now() ? attachment.userId as string : null;
  }
  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    await this.serial(async () => {
      try {
        if (typeof message !== 'string' || message.length > 16384) throw new Error('Invalid message');
        const body = JSON.parse(message), attachment = socket.deserializeAttachment();
        if (body.type === 'hello') {
          const token = typeof body.token === 'string' && body.token.length < 512 ? body.token : null;
          const session = token ? await accounts(this.env, attachment.baseURL).api.getSession({ headers: new Headers({ Authorization: `Bearer ${token}` }) }) : null;
          const user = session?.user.id ?? null;
          attachment.userId = user; attachment.sessionId = session?.session.id ?? null;
          if (token && !user) socket.send(JSON.stringify({ type: 'session-expired' }));
          attachment.joined = true; socket.serializeAttachment(attachment);
          socket.send(JSON.stringify({ type: 'ready', authenticated: !!user }));
        } else if (body.type === 'subscribe' && attachment.joined) {
          if (!/^[a-zA-Z0-9_-]{1,100}$/.test(body.id) || (attachment.subscriptions.length >= 8 && !attachment.subscriptions.some((s: any) => s.id === body.id))) throw new Error('Invalid subscription');
          attachment.subscriptions = attachment.subscriptions.filter((s: any) => s.id !== body.id);
          attachment.subscriptions.push({ id: body.id, name: body.name, args: body.args ?? {} }); socket.serializeAttachment(attachment);
          await this.game.cachedSnapshots(() => this.snapshot(socket, body.id), true); return;
        } else if (body.type === 'unsubscribe') {
          attachment.subscriptions = attachment.subscriptions.filter((s: any) => s.id !== body.id); socket.serializeAttachment(attachment);
        } else throw new Error('Unknown message');
        await this.game.cachedSnapshots(() => this.snapshot(socket), true);
      } catch { socket.send(JSON.stringify({ type: 'error', error: 'Invalid subscription request' })); }
    }, true);
  }
  webSocketClose(socket: WebSocket, code: number, reason: string) { socket.close(code, reason); }
  webSocketError(socket: WebSocket) { socket.close(1011, 'Reconnect'); }
  private async snapshot(socket: WebSocket, subscriptionId?: string, names?: string[]) {
    const a = socket.deserializeAttachment(); if (!a?.joined) return;
    if (!('sessionId' in a)) { socket.close(1012, 'Reconnect'); return; }
    const user = await this.identity(a);
    if (a.sessionId && !user) { a.userId = null; a.sessionId = null; socket.serializeAttachment(a); socket.send(JSON.stringify({ type: 'session-expired' })); }
    for (const sub of a.subscriptions) {
      if (subscriptionId && sub.id !== subscriptionId) continue;
      if (names && !names.includes(sub.name)) continue;
      try { socket.send(JSON.stringify({ type: 'snapshot', id: sub.id,
        value: await this.game.query(sub.name, sub.args, user, a.baseURL) })); }
      catch { socket.send(JSON.stringify({ type: 'error', id: sub.id, error: 'Subscription failed' })); }
    }
  }
  private async broadcast(names?: string[]) {
    return this.serial(() => this.game.cachedSnapshots(async () => {
      for (const socket of this.ctx.getWebSockets()) { try { await this.snapshot(socket, undefined, names); } catch { socket.close(1011, 'Reconnect'); } }
    }));
  }
  async replayAccess(fightId: string, historicalOnly = false) {
    return this.serial(async () => {
      const s = await this.game.state(), f = await this.game.one('SELECT * FROM fights WHERE id = ?', fightId);
      const now = Date.now();
      return f?.trace_key && !f.replay_unavailable && ((!historicalOnly && f.id === s.current_id && f.starts_at !== null && now >= f.starts_at && now < f.next_at) || (f.settled && f.next_at !== null && now >= f.next_at)) ? f.trace_key as string : null;
    });
  }
  async initialize() { return this.serial(() => this.game.initialize()); }
  async control(action: string) {
    if (action === 'initialize') await this.initialize();
    else if (action === 'advance') await this.serial(() => this.game.advance());
    else if (action === 'pause' || action === 'resume') await this.serial(async () => {
      const s = await this.game.state();
      await this.game.commit(s, [], { maintenance: action === 'pause' ? 1 : 0,
        next_at: action === 'pause' ? null : Date.now() + 1,
        reopened_at: action === 'resume' ? s.reopened_at ?? Date.now() : s.reopened_at });
    });
    else throw new Error('Unknown control action');
    return this.reconcile();
  }
  private async prepare() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      const job = await this.serial(() => this.game.reserve()); if (!job) return;
      try { await this.env.PREPARATIONS.send({ jobId: job.id }); }
      catch { await this.serial(() => this.game.failed(job)); }
      await this.reconcile();
    } catch { /* The cron watchdog retries reservation after a missing schema/roster. */ }
    finally { this.pumping = false; }
  }

  async simulationJob(jobId: string) {
    return this.serial(async () => {
      const [s, job] = await Promise.all([this.game.state(), this.game.one('SELECT * FROM preparation_jobs WHERE id = ?', jobId)]);
      return job?.status === 'running' && !s.maintenance && !s.pending_id && job.generation === s.generation ? JSON.parse(job.input_json) as import('./simulator').SimulationInput : null;
    });
  }
  async completeSimulation(jobId: string, data: import('./simulator').PreparedSimulation) {
    const accepted = await this.serial(async () => {
      const job = await this.game.one('SELECT * FROM preparation_jobs WHERE id = ?', jobId);
      return job ? this.game.accept(job, data) : false;
    });
    if (!accepted) {
      const used = await this.serial(() => this.game.one('SELECT id FROM fights WHERE trace_key = ?', data.traceKey));
      if (!used) await this.env.TRACES.delete(data.traceKey);
    }
    await this.reconcile();
    this.ctx.waitUntil(this.broadcast());
    return accepted;
  }
  async failSimulation(jobId: string) {
    await this.serial(async () => {
      const job = await this.game.one('SELECT * FROM preparation_jobs WHERE id = ?', jobId);
      if (job?.status === 'running') await this.game.failed(job);
    });
    await this.reconcile();
  }

  async reconcile() { return this.serial(() => this.repairAlarm()); }
  private async repairAlarm() {
      const state = await this.env.DB.prepare('SELECT revision, next_at, maintenance, phase, reopened_at, new_writes_at, import_source_hash FROM league_state WHERE id = ?').bind('live').first<State & { reopened_at: number | null; new_writes_at: number | null; import_source_hash: string | null }>();
      if (!state) throw new Error('League schema is not initialized');
      const existing = await this.ctx.storage.getAlarm();
      if (state.maintenance || state.next_at === null) {
        if (existing !== null) await this.ctx.storage.deleteAlarm();
      } else if (existing !== state.next_at) {
        await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, state.next_at));
      }
      return { revision: state.revision, phase: state.phase, maintenance: !!state.maintenance,
        connections: this.ctx.getWebSockets().length,
        lastCommandTiming: this.lastCommandTiming,
        nextAt: state.next_at, alarmAt: await this.ctx.storage.getAlarm(),
        reopenedAt: state.reopened_at, firstWriteAt: state.new_writes_at, sourceHash: state.import_source_hash };
  }

  async alarm() {
    await this.serial(() => this.game.advance());
    await this.reconcile();
    await this.broadcast();
    this.ctx.waitUntil(this.prepare());
  }

  async watchdog() { await this.alarm(); }
}
