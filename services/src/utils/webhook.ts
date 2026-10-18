import { isIP } from 'node:net';
import { lookup } from 'node:dns';
import { Agent, fetch } from 'undici';
export function isPublicAddress(ip: string): boolean {
  const value = ip.toLowerCase();
  if (isIP(value) === 4) {
    const [a, b] = value.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0))
      || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)));
  }
  // Public IPv6 global unicast only; rejects mapped IPv4, loopback, link-local and unique-local.
  return isIP(value) === 6 && /^[23]/.test(value) && !value.startsWith('2001:db8:');
}
export function validateWebhookUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
    || url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) throw new Error('Use a public HTTPS webhook URL on port 443');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !isPublicAddress(host)) throw new Error('Webhook addresses must be public');
  return url;
}
export async function postWebhook(url: string, body: string, headers: Record<string, string>) {
  validateWebhookUrl(url);
  const dispatcher = new Agent({ connect: { lookup: (hostname, options, callback) => {
    lookup(hostname, { all: true }, (error, addresses) => {
      if (error) return callback(error, '', 4);
      if (!addresses.length || addresses.some(address => !isPublicAddress(address.address))) return callback(new Error('Webhook DNS resolved to a private address'), '', 4);
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    });
  } } });
  try {
    const response = await fetch(url, { method: 'POST', body, headers, redirect: 'error',
      dispatcher, signal: AbortSignal.timeout(5_000) });
    await response.body?.cancel();
    if (!response.ok) throw new Error('Webhook responded with HTTP ' + response.status);
  } finally { await dispatcher.close(); }
}
