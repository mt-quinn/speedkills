import { verifyPassword } from '../src/passwords';

// Test-only Worker, never deployed or reachable through the preview API.
export default {
  async fetch(request: Request) {
    const { hash, password } = await request.json<{ hash: string; password: string }>();
    return Response.json({ valid: await verifyPassword({ hash, password }) });
  },
};
