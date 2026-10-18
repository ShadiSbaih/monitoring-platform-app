import { Injectable, ServiceUnavailableException } from '@nestjs/common';
@Injectable()
export class EmailService {
  async send(email: string, purpose: 'verify' | 'reset', token: string) {
    const apiKey = process.env.BREVO_API_KEY;
    const sender = process.env.BREVO_SENDER_EMAIL;
    const appUrl = process.env.APP_URL;
    if (!apiKey || !sender || !appUrl) throw new ServiceUnavailableException('Account email delivery is temporarily unavailable');
    const url = new URL(purpose === 'verify' ? '/verify-email' : '/reset-password', appUrl);
    url.searchParams.set('token', token);
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: 'Tracebloom', email: sender }, to: [{ email }],
        subject: purpose === 'verify' ? 'Verify your Tracebloom email' : 'Reset your Tracebloom password',
        textContent: (purpose === 'verify' ? 'Verify your email: ' : 'Reset your password: ') + url.toString() +
          '\nIf you did not request this, you can ignore this email.',
      }), signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new ServiceUnavailableException('Account email delivery is temporarily unavailable');
  }
}
