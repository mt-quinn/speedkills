import { betterAuth } from 'better-auth';
import { bearer, emailOTP, username } from 'better-auth/plugins';

/** No session cache: every request observes sign-out and password-reset revocation. */
export function accounts(env: Env, baseURL: string) {
  return betterAuth({
    appName: 'Hard Burn', baseURL, basePath: '/auth', secret: env.AUTH_SECRET,
    database: env.DB,
    trustedOrigins: env.ALLOWED_ORIGINS.split(',').filter(Boolean),
    emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 256,
      revokeSessionsOnPasswordReset: true },
    user: { modelName: 'auth_user', additionalFields: {
      legacyClaimHash: { type: 'string', required: false, returned: false },
    } },
    session: { modelName: 'auth_session', expiresIn: 60 * 60 * 24 * 30,
      cookieCache: { enabled: false } },
    account: { modelName: 'auth_account' },
    verification: { modelName: 'auth_verification' },
    rateLimit: { enabled: true, storage: 'database', modelName: 'auth_rate_limit',
      window: 60, max: 30 },
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    plugins: [bearer({ requireSignature: true }), username({ minUsernameLength: 3,
      maxUsernameLength: 24, immutableUsername: true,
      usernameValidator: value => /^[A-Za-z0-9_]{3,24}$/.test(value),
      displayUsernameValidator: value => /^[A-Za-z0-9_]{3,24}$/.test(value),
    }), emailOTP({ otpLength: 8, expiresIn: 600, storeOTP: 'hashed', disableSignUp: true,
      async sendVerificationOTP({ email, otp, type }) {
        if (type !== 'forget-password' || !env.AUTH_RESEND_KEY || !env.AUTH_EMAIL_FROM) {
          throw new Error('Password reset is unavailable');
        }
        const result = await fetch('https://api.resend.com/emails', { method: 'POST',
          headers: { Authorization: `Bearer ${env.AUTH_RESEND_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: env.AUTH_EMAIL_FROM, to: email,
            subject: 'Reset your Hard Burn password', text: `Your reset code is ${otp}. It expires in 10 minutes.` }),
        });
        if (!result.ok) throw new Error('Password reset delivery failed');
      },
    })],
  });
}

export async function sha256(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
}

// Expose only the account flows supported by the app. In particular, no public
// user updates, account deletion/linking, email change, or OTP-only registration.
const paths = new Set(['/auth/sign-up/email', '/auth/sign-in/email', '/auth/sign-out',
  '/auth/get-session', '/auth/email-otp/request-password-reset', '/auth/email-otp/reset-password']);

export async function accountRequest(request: Request, env: Env) {
  const url = new URL(request.url);
  if (!paths.has(url.pathname)) return Response.json({ error: 'Not found' }, { status: 404 });
  const state = await env.DB.prepare("SELECT maintenance FROM league_state WHERE id = 'live'").first<{ maintenance: number }>();
  if (!state || state.maintenance) return Response.json({ error: 'League maintenance is in progress' }, { status: 503 });
  let next = request;
  if (request.method === 'POST') {
    const text = await request.text();
    if (text.length > 16384) return Response.json({ error: 'Payload too large' }, { status: 413 });
    next = new Request(request, { body: text });
  }
  if (request.method === 'POST' && url.pathname === '/auth/sign-up/email') {
    let body: Record<string, unknown>;
    try { body = await next.json(); } catch { return Response.json({ error: 'Expected JSON' }, { status: 400 }); }
    const name = typeof body.username === 'string' ? body.username.trim() : '';
    if (!/^[A-Za-z0-9_]{3,24}$/.test(name)) return Response.json({ error: 'Use 3–24 letters, numbers, or underscores.' }, { status: 400 });
    const token = typeof body.legacyToken === 'string' && /^[a-f0-9]{64}$/.test(body.legacyToken) ? body.legacyToken : null;
    // Never accept a caller-supplied hash or name/displayUsername divergence.
    const clean = { email: String(body.email ?? '').trim().toLowerCase(), password: body.password,
      name, username: name, displayUsername: name, ...(token ? { legacyClaimHash: await sha256(token) } : {}) };
    next = new Request(request, { body: JSON.stringify(clean) });
  }
  const result = await accounts(env, url.origin).handler(next);
  const response = new Response(result.body, result);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
