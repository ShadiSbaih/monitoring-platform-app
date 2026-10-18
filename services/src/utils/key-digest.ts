import { createHmac } from 'node:crypto';

export function digest(rawKey: string): string {
  const secret = process.env.REDIS_KEY_SECRET;
  if (!secret) throw new Error('REDIS_KEY_SECRET must be configured to validate API keys.');

  return createHmac('sha256', secret).update(rawKey).digest('hex');
}
