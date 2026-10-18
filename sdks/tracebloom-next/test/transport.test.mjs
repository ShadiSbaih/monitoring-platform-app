import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OMLTransport } from '../dist/utils/index.js';

test('splits batches at 100 events and exposes awaited flush', async () => {
  const original = globalThis.fetch; const batches = [];
  globalThis.fetch = async (_url, request) => { batches.push(JSON.parse(request.body)); return new Response('{}'); };
  const transport = new OMLTransport({ apiKey: 'test', flushIntervalMs: 60_000 });
  try {
    for (let i = 0; i < 205; i++) transport.send({ message: String(i), type: 'info' });
    await transport.flush();
    assert.deepEqual(batches.map(batch => batch.logs.length), [100, 100, 5]);
    assert.equal(new Set(batches.map(batch => batch.batchId)).size, 3);
  } finally { await transport.close(); globalThis.fetch = original; }
});
test('retries transient failures with a stable batch ID', async () => {
  const original = globalThis.fetch; const batches = [];
  globalThis.fetch = async (_url, request) => { batches.push(JSON.parse(request.body)); return new Response('{}', { status: batches.length === 1 ? 503 : 200 }); };
  const transport = new OMLTransport({ apiKey: 'test', maxRetries: 1 });
  try { transport.send({ message: 'retry' }); await transport.flush();
    assert.equal(batches.length, 2); assert.equal(batches[0].batchId, batches[1].batchId);
  } finally { await transport.close(); globalThis.fetch = original; }
});
test('permanent failures stop retrying and report dropped events', async () => {
  const original = globalThis.fetch; let calls = 0; const failures = [];
  globalThis.fetch = async () => { calls++; return new Response('{}', { status: 401 }); };
  const transport = new OMLTransport({ apiKey: 'test', onError: (error, details) => failures.push(details.dropped) });
  try { transport.send({ message: 'invalid' }); await transport.flush();
    assert.equal(calls, 1); assert.deepEqual(failures, [1]);
  } finally { await transport.close(); globalThis.fetch = original; }
});
test('bounds the buffer and rejects oversized logs', async () => {
  const original = globalThis.fetch; const dropped = [];
  globalThis.fetch = async () => new Response('{}');
  const transport = new OMLTransport({ apiKey: 'test', maxBufferSize: 1, onError: (_, details) => dropped.push(details.dropped) });
  try { transport.send({ message: 'x'.repeat(10_000) }); transport.send({ message: 'one' }); transport.send({ message: 'two' });
    assert.deepEqual(dropped, [1, 1]); await transport.flush();
  } finally { await transport.close(); globalThis.fetch = original; }
});
test('429 pauses additional deliveries', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{"retryAfter":60}', { status: 429 }); };
  const transport = new OMLTransport({ apiKey: 'test', onError: () => {} });
  try { transport.send({ message: 'limited' }); await transport.flush(); transport.send({ message: 'paused' });
    await transport.flush(); assert.equal(calls, 1);
  } finally { await transport.close(); globalThis.fetch = original; }
});
