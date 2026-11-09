import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isConnectError } from '../db/index.js';

const sysError = (code) => Object.assign(new Error(code), { code });
const fetchFailed = (cause) => Object.assign(new TypeError('fetch failed'), { cause });

test('retries when the connection never opened', () => {
  assert.equal(isConnectError(fetchFailed(sysError('UND_ERR_CONNECT_TIMEOUT'))), true);
  assert.equal(isConnectError(fetchFailed(sysError('ECONNREFUSED'))), true);
  assert.equal(isConnectError(fetchFailed(new AggregateError([sysError('ETIMEDOUT'), sysError('ENETUNREACH')]))), true);
});

test('never retries once the request may have reached the database', () => {
  assert.equal(isConnectError(fetchFailed(sysError('ECONNRESET'))), false);
  assert.equal(isConnectError(fetchFailed(sysError('UND_ERR_SOCKET'))), false);
  assert.equal(isConnectError(fetchFailed(new AggregateError([sysError('ETIMEDOUT'), sysError('ECONNRESET')]))), false);
});

test('ignores errors without a network cause', () => {
  assert.equal(isConnectError(new Error('syntax error')), false);
  assert.equal(isConnectError(fetchFailed(new AggregateError([]))), false);
});
