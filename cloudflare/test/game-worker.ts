// Local test helper only; never referenced by a Wrangler deployment config.
import { Game } from '../src/game';
export default {
  async fetch(request: Request, env: Env) {
    const { operation, args = [] } = await request.json() as { operation: string; args: any[] };
    const game = new Game(env);
    if (!['initialize','ensureQueue','reschedule','reserve','accept','advance','command','query','commit','state'].includes(operation)) return new Response(null,{status:404});
    try { return Response.json({ value: await (game as any)[operation](...args) }); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Failed' }, { status:400 }); }
  },
};
