require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const { randomUUID, createHmac } = require('node:crypto');
const argon2 = require('argon2');
const { and, eq, inArray } = require('drizzle-orm');
const { db, closeDatabase } = require('../dist/database/client');
const schema = require('../dist/database/schema');
const { redisClient } = require('../dist/infra/redis.module');
const { processIngest } = require('../dist/infra/streams/consumer');
const { runConsumer, stopConsumers } = require('../dist/infra/streams/queue');
const { processAlerts } = require('../dist/infra/streams/alert-consumer');
const { AuthService } = require('../dist/modules/auth/auth.service');
const { JwtService } = require('@nestjs/jwt');
const { isPublicAddress, validateWebhookUrl } = require('../dist/utils/webhook');
const { REDIS_KEYS } = require('../dist/configs');
const base = process.env.OML_SMOKE_API_URL || 'http://localhost:8080/api/v1';
const ids = [randomUUID(), randomUUID()];
const password = 'Cloud-smoke-' + randomUUID();
const emails = ids.map(id => id + '@example.invalid');
const rules = [];
let checks = 0;
let activeStream;
async function request(method, path, body, token, apiKey) {
  const response = await fetch(base + path, { method, headers: {
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(apiKey ? { 'x-api-key': apiKey } : {}),
  }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
  return { status: response.status, body: await response.json() };
}
function check(condition, message) { assert.ok(condition, message); checks++; console.log('PASS ' + message); }
async function eventually(fn, description) {
  for (let i = 0; i < 25; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 300)); }
  throw new Error(description);
}
(async () => {
  const hash = await argon2.hash(password);
  await db.insert(schema.users).values(ids.map((id, i) => ({ id, email: emails[i], name: 'Cloud smoke fixture',
    password_hash: hash, email_verified: true })));
  const first = await request('POST', '/auth/login', { email: emails[0], password });
  check(first.status === 201 && first.body.accessToken, 'email/password login issues JWT');
  const token = first.body.accessToken;
  const other = await request('POST', '/auth/login', { email: emails[1], password });
  check((await request('GET', '/auth/me', undefined, token)).body.id === ids[0], 'JWT resolves current user');
  check((await request('POST', '/auth/login', { email: emails[0], password: 'wrong' })).status === 401, 'incorrect password rejected');
  const refreshes = await Promise.all([1, 2].map(() => request('POST', '/auth/refresh', { refreshToken: first.body.refreshToken })));
  check(refreshes.every(r => r.status === 201) && refreshes[0].body.refreshToken === refreshes[1].body.refreshToken, 'parallel refresh rotates to the same token');
  const key1 = await request('POST', '/api-keys', {}, token);
  const key2 = await request('POST', '/api-keys', {}, token);
  const key3 = await request('POST', '/api-keys', {}, token);
  check([key1, key2, key3].every(r => r.status === 201), 'three API keys can be created');
  check((await request('POST', '/api-keys', {}, token)).status === 400, 'fourth API key is rejected');
  const batchId = randomUUID();
  const logs = Array.from({ length: 5 }, (_, i) => ({ type: 'error', importance: 'critical', app_name: 'cloud-smoke',
    environment: 'test', message: 'Cloud smoke ' + i, timestamp: new Date().toISOString() }));
  const streamAbort = new AbortController(); activeStream = streamAbort;
  const stream = await fetch(base + '/logs/stream', { headers: { 'x-api-key': key1.body.key }, signal: streamAbort.signal });
  check(stream.status === 200 && stream.headers.get('content-type').includes('text/event-stream'), 'authenticated real SSE connects');
  const reader = stream.body.getReader();
  let streamed = '';
  const collecting = (async () => {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; streamed += new TextDecoder().decode(chunk.value); }
  })().catch(() => {});
  const accepted = await request('POST', '/logs/send', { batchId, logs }, undefined, key1.body.key);
  check(accepted.status === 201 && accepted.body.queued, 'ingestion is durably queued');
  const duplicate = await request('POST', '/logs/send', { batchId, logs }, undefined, key1.body.key);
  check(duplicate.body.duplicate === true, 'duplicate batch is acknowledged without recounting');
  check((await request('POST', '/logs/send', { batchId, logs: [logs[0]] }, undefined, key1.body.key)).status === 409, 'batch ID cannot be reused for different data');
  await eventually(async () => (await request('GET', '/logs?range=1h&type=error', undefined, token)).body.logs?.length === 5, 'logs did not reach Neon');
  check(true, 'queued logs reach Neon and filtered queries');
  await eventually(async () => streamed.includes('"type":"live"') && streamed.includes('Cloud smoke'), 'live logs missing from SSE');
  check(true, 'stored logs broadcast over real SSE');
  streamAbort.abort(); await collecting;
  const usage = await request('GET', '/logs/usage', undefined, token);
  await processIngest({ batchId, userId: ids[0], keyId: key1.body.key.split('_')[1], receivedAt: Date.now(), bytes: 0, logs });
  check((await request('GET', '/logs?range=1h', undefined, token)).body.logs.length === 5, 'worker redelivery does not duplicate committed logs');
  await eventually(async () => Number(await redisClient.get(REDIS_KEYS.queueBytes)) === 0, 'queue bytes were not released');
  check(true, 'queue reservations release after alert processing');
  check(usage.body.events_used === 5 && usage.body.events_stored === 5, 'usage counts a batch exactly once');
  check((await request('GET', '/logs?range=1h', undefined, other.body.accessToken)).body.logs.length === 0, 'another account cannot read logs');
  check((await request('POST', '/logs/send', { logs: Array(101).fill(logs[0]) }, undefined, key1.body.key)).status >= 400, 'oversized batch rejected');
  const large = Array.from({ length: 30 }, () => ({ message: 'x'.repeat(4_000), type: 'info', app_name: 'large-smoke' }));
  check((await request('POST', '/logs/send', { batchId: randomUUID(), logs: large }, undefined, key1.body.key)).status === 201, 'valid batch above the old 100 KiB body limit is accepted');
  await redisClient.set(REDIS_KEYS.usage(ids[0]), '1000', 'EX', 60);
  check((await request('POST', '/logs/send', { batchId: randomUUID(), logs: [logs[0]] }, undefined, key1.body.key)).status === 429, 'daily allowance is enforced before queueing');
  const keyId = key1.body.key.split('_')[1];
  check((await request('DELETE', '/api-keys/' + keyId, undefined, token)).status === 200, 'one API key can be revoked');
  check((await request('POST', '/logs/send', { logs: [logs[0]] }, undefined, key1.body.key)).status === 401, 'revoked API key rejected immediately');
  check((await request('GET', '/logs', undefined, undefined, key2.body.key)).status === 200, 'revoking one key keeps other keys valid');
  const alert = { name: 'Cloud smoke alert', app_name: 'cloud-smoke-alert',
    conditions: [{ field: 'type', operator: 'equals', value: 'error' }],
    threshold: { count: 1, window_minutes: 5 }, webhook_url: 'https://example.com/oml-smoke',
    cooldown_period: '5m', summary: 'Cloud smoke verification' };
  for (let i = 0; i < 3; i++) { const result = await request('POST', '/alerts', alert, token);
    check(result.status === 201, 'free alert ' + (i + 1) + ' can be created'); rules.push(result.body.id); }
  check((await request('POST', '/alerts', alert, token)).status === 403, 'fourth alert rejected');
  check((await request('POST', '/alerts', { ...alert, webhook_url: 'https://127.0.0.1/' }, token)).status === 400, 'private webhook destination rejected');
  let calls = 0; let delivered;
  const alertBatch = { batchId: randomUUID(), userId: ids[0], receivedAt: Date.now(),
    logs: [{ type: 'error', app_name: 'cloud-smoke-alert', message: 'Synthetic alert verification' }] };
  const deliver = async (_url, body, headers) => {
    calls++; delivered = { body, headers };
    const expected = createHmac('sha256', process.env.WEBHOOK_SIGNING_SECRET).update(headers['X-OML-Timestamp'] + '.' + body).digest('hex');
    check(headers['X-OML-Signature'] === expected, 'alert payload has a valid HMAC signature');
  };
  await processAlerts(alertBatch, deliver);
  const once = calls;
  await processAlerts(alertBatch, deliver);
  const signed = { body: delivered.body, signature: delivered.headers['X-OML-Signature'], timestamp: Number(delivered.headers['X-OML-Timestamp']) };
  check((await request('POST', '/alerts/verify-webhook', signed, token)).status === 201, 'account verifies its own signed webhook');
  check((await request('POST', '/alerts/verify-webhook', signed, other.body.accessToken)).status === 401, 'another account cannot validate the webhook as its own');
  check(calls === 3 && calls === once, 'alert retry does not redeliver completed events');
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1']) check(!isPublicAddress(address), 'webhook blocks ' + address);
  if (process.env.OML_SMOKE_DASHBOARD_URL) {
    const { spawnSync } = require('node:child_process');
    const browser = spawnSync('python', ['test/browser-smoke.py'], { encoding: 'utf-8',
      env: { ...process.env, OML_SMOKE_EMAIL: emails[0], OML_SMOKE_PASSWORD: password } });
    if (browser.status !== 0) throw new Error('Browser smoke failed: ' + (browser.stdout || '').slice(-400) + ' ' + (browser.stderr || '').slice(-1000));
    process.stdout.write(browser.stdout);
  }
  let captured;
  const auth = new AuthService(db, new JwtService({ secret: process.env.JWT_SECRET,
    signOptions: { algorithm: 'HS256', issuer: 'tracebloom', audience: 'oml-dashboard', expiresIn: 900 },
    verifyOptions: { algorithms: ['HS256'], issuer: 'tracebloom', audience: 'oml-dashboard' } }),
    { send: async (_email, _purpose, value) => { captured = value; } });
  await auth.requestEmail(emails[0], 'reset');
  await auth.consumeToken(captured, 'reset', password + '-changed');
  check((await request('GET', '/auth/me', undefined, token)).status === 401, 'password reset revokes existing access tokens');
  await assert.rejects(auth.consumeToken(captured, 'reset', password));
  check(true, 'password recovery token is single use');
  const recoveryStream = 'oml:smoke:recovery:' + ids[0];
  await redisClient.command('XGROUP', 'CREATE', recoveryStream, 'oml_workers_v1', '0', 'MKSTREAM');
  await redisClient.command('XADD', recoveryStream, '*', 'payload', JSON.stringify({ bytes: 0, userId: ids[0] }));
  await redisClient.command('XREADGROUP', 'GROUP', 'oml_workers_v1', 'crashed-fixture', 'COUNT', 1, 'STREAMS', recoveryStream, '>');
  // Use real idle time: Upstash does not implement XCLAIM's IDLE option.
  console.log('Waiting for the production 30-second recovery threshold...');
  await new Promise(resolve => setTimeout(resolve, 31_000));
  let recovered = false;
  runConsumer(recoveryStream, async () => { recovered = true; });
  await eventually(async () => recovered, 'abandoned stream work was not recovered');
  await eventually(async () => Number(await redisClient.command('XLEN', recoveryStream)) === 0, 'recovered work was not acknowledged');
  check(true, 'consumer recovers work abandoned by a crashed process');
  stopConsumers();
  console.log('Cloud smoke: ' + checks + ' checks passed. No emails or external webhooks were sent.');
})().catch(error => { console.error('Cloud smoke failed:', error.message); process.exitCode = 1; }).finally(async () => {
  activeStream?.abort(); stopConsumers();
  try {
    await db.delete(schema.alertOutbox).where(inArray(schema.alertOutbox.id,
      ids.map(id => id + ':unused')));
    const keys = await db.select({ id: schema.apiKey.id }).from(schema.apiKey).where(inArray(schema.apiKey.user_id, ids));
    for (const key of keys) {
      const id = key.id.replaceAll('-', '');
      await redisClient.del(REDIS_KEYS.apiKey(id));
      await redisClient.hdel(REDIS_KEYS.apiKeyLastUsed, id);
    }
    await db.delete(schema.users).where(inArray(schema.users.id, ids));
    // Remove only fixture-owned outbox data and Redis keys, never flush the database.
    const allOutbox = await db.select({ id: schema.alertOutbox.id }).from(schema.alertOutbox);
    for (const row of allOutbox) if (ids.some(id => row.id.startsWith(id + ':'))) await db.delete(schema.alertOutbox).where(eq(schema.alertOutbox.id, row.id));
    let cursor = '0';
    do {
      const result = await redisClient.command('SCAN', cursor, 'MATCH', 'oml:*', 'COUNT', 100);
      cursor = result[0];
      for (const key of result[1]) if ([...ids, ...rules].some(id => key.includes(id))) await redisClient.del(key);
    } while (cursor !== '0');
  } finally { await Promise.allSettled([closeDatabase(), redisClient.quit()]); }
});
