const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractKeyId } = require('../dist/utils/api-key-verifier');
const { isPublicAddress, validateWebhookUrl } = require('../dist/utils/webhook');
const { matchCondition } = require('../dist/infra/streams/alert-consumer');
test('API-key secrets may contain underscores', () => {
  const id = 'a'.repeat(32);
  assert.equal(extractKeyId('oml_' + id + '_' + 'x'.repeat(20) + '_' + 'x'.repeat(22)), id);
  assert.equal(extractKeyId('oml_' + id + '_short'), null);
  assert.equal(extractKeyId('other_' + id + '_' + 'x'.repeat(43)), null);
});
test('alert comparisons normalize importance and cover both operators', () => {
  assert.equal(matchCondition({ importance: 4 }, { field: 'importance', operator: 'equals', value: 'critical' }), true);
  assert.equal(matchCondition({ type: 'error' }, { field: 'type', operator: 'not_equals', value: 'info' }), true);
  assert.equal(matchCondition({ type: 'error' }, { field: 'type', operator: 'unknown', value: 'error' }), false);
});
test('webhooks accept public HTTPS and reject private addresses and credentials', () => {
  assert.equal(validateWebhookUrl('https://example.com/alert').protocol, 'https:');
  for (const url of ['http://example.com', 'https://127.0.0.1/', 'https://[::1]/', 'https://user:pass@example.com', 'https://example.com:8080']) {
    assert.throws(() => validateWebhookUrl(url));
  }
  assert.equal(isPublicAddress('10.1.2.3'), false);
  assert.equal(isPublicAddress('169.254.169.254'), false);
  assert.equal(isPublicAddress('8.8.8.8'), true);
});
