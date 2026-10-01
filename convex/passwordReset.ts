import Resend from '@auth/core/providers/resend';
// Delivery configuration stays on Convex. The client never sees the API key.
export const passwordReset = Resend({
  id: 'password-reset',
  apiKey: process.env.AUTH_RESEND_KEY,
  maxAge: 10 * 60,
  async generateVerificationToken() {
    let code = '';
    while (code.length < 8) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      for (const byte of bytes) if (byte < 250 && code.length < 8) code += String(byte % 10);
    }
    return code;
  },
  async sendVerificationRequest({ identifier, token, provider }) {
    if (!provider.apiKey || !process.env.AUTH_EMAIL_FROM) throw new Error('Password reset email is not configured.');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.AUTH_EMAIL_FROM, to: [identifier], subject: 'Hard Burn password reset', text: `Your Hard Burn password reset code is ${token}. It expires in 10 minutes. If you did not request this, ignore this email.` }),
    });
    if (!response.ok) throw new Error('Could not deliver password reset email.');
  },
});
