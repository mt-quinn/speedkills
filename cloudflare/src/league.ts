import { DurableObject } from 'cloudflare:workers';

type State = { revision: number; next_at: number | null; maintenance: number; phase: string };

/** Coordinator foundation. Game commands are added after the deployed compute gate. */
export class League extends DurableObject<Env> {
  private tail: Promise<unknown> = Promise.resolve();

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation);
    this.tail = next.catch(() => undefined);
    return next;
  }

  async reconcile() {
    return this.serial(async () => {
      const state = await this.env.DB.prepare('SELECT revision, next_at, maintenance, phase FROM league_state WHERE id = ?').bind('live').first<State>();
      if (!state) throw new Error('League schema is not initialized');
      const existing = await this.ctx.storage.getAlarm();
      if (state.maintenance || state.next_at === null) {
        if (existing !== null) await this.ctx.storage.deleteAlarm();
      } else if (existing !== state.next_at) {
        await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, state.next_at));
      }
      return { revision: state.revision, phase: state.phase, maintenance: !!state.maintenance,
        nextAt: state.next_at, alarmAt: await this.ctx.storage.getAlarm() };
    });
  }

  async alarm() {
    // Fail closed until the lifecycle is implemented; never reschedule a past deadline in a tight loop.
    await this.serial(async () => {
      await this.env.DB.prepare("UPDATE league_state SET maintenance = 1, next_at = NULL, error = 'Lifecycle is not implemented', revision = revision + 1 WHERE id = 'live'").run();
      await this.ctx.storage.deleteAlarm();
    });
  }
}
