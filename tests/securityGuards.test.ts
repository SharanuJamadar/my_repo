import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  BoundedTtlCache,
  SlidingWindowRateLimiter,
  finiteNumber,
  isAuthorizedOperator,
  isBlockedHostname,
  isBlockedIpAddress,
  sanitizeConfig,
  validateExnessBridgeUrl,
} from '../server/securityGuards.ts';
import {
  consumePendingOAuthState,
  decryptStorePayload,
  encryptStorePayload,
  getBrokerSpec,
  type PendingOAuthState,
} from '../server/brokerOAuth.ts';
import { parseChartAnalysisJson } from '../server/geminiService.ts';

test('isBlockedHostname allows legitimate fc*/fd* domains and blocks loopback/private/IPv4-mapped IPv6', () => {
  // Legitimate public domains starting with fc or fd must NOT be blocked
  assert.equal(isBlockedHostname('fcm.googleapis.com'), false);
  assert.equal(isBlockedHostname('fdic.gov'), false);
  assert.equal(isBlockedHostname('bridge.example.com'), false);

  // Blocked loopback, link-local, metadata, private IPv4 & IPv6
  assert.equal(isBlockedHostname('localhost'), true);
  assert.equal(isBlockedHostname('127.0.0.1'), true);
  assert.equal(isBlockedHostname('169.254.169.254'), true);
  assert.equal(isBlockedHostname('10.0.0.5'), true);
  assert.equal(isBlockedHostname('192.168.1.10'), true);
  assert.equal(isBlockedHostname('[::1]'), true);
  assert.equal(isBlockedHostname('[::ffff:127.0.0.1]'), true);
  assert.equal(isBlockedHostname('[::ffff:169.254.169.254]'), true);
  assert.equal(isBlockedHostname('[fc00::1]'), true);
  assert.equal(isBlockedHostname('[fd12:3456::1]'), true);
  assert.equal(isBlockedHostname('[fe80::1]'), true);

  // Raw IPv4-mapped hex notation
  assert.equal(isBlockedIpAddress('::ffff:7f00:1'), true);
  assert.equal(isBlockedIpAddress('::ffff:a9fe:a9fe'), true);
  assert.equal(isBlockedIpAddress('8.8.8.8'), false);
});

test('validateExnessBridgeUrl enforces HTTPS and rejects credentials or private hosts', () => {
  assert.equal(validateExnessBridgeUrl('http://bridge.example.com'), null);
  assert.equal(validateExnessBridgeUrl('https://user:pass@bridge.example.com'), null);
  assert.equal(validateExnessBridgeUrl('https://127.0.0.1:8443'), null);
  assert.equal(validateExnessBridgeUrl('https://[fd00::1]/api'), null);
  const ok = validateExnessBridgeUrl('https://fcm.googleapis.com/hook');
  assert.ok(ok !== null && ok.hostname === 'fcm.googleapis.com');
});

test('sanitizeConfig never produces NaN and preserves explicit 0 values', () => {
  assert.equal(finiteNumber('not-a-number', 14), 14);
  assert.equal(finiteNumber(Infinity, 14), 14);
  assert.equal(finiteNumber(0, 14), 0);

  const sanitized = sanitizeConfig({
    emaFast: 'abc',
    emaMid: NaN,
    emaSlow: Infinity,
    minSetupScore: 0,
    minRiskReward: 'bad',
    dailyMaxLossPct: 0,
    adxMinThreshold: 0,
  });

  assert.equal(sanitized.emaFast, 9);
  assert.equal(sanitized.emaMid, 20);
  assert.equal(sanitized.emaSlow, 50);
  // 0 is treated as a valid numeric input (clamped to min bound) rather than falsy fallback to default (72 / 18)
  assert.equal(sanitized.minSetupScore, 40);
  assert.equal(sanitized.minRiskReward, 2);
  assert.equal(sanitized.adxMinThreshold, 10);
  assert.equal(Number.isFinite(sanitized.dailyMaxLossPct), true);
});

test('isAuthorizedOperator requires verified email plus admin claim or explicit allowlist', () => {
  const prev = process.env.ADMIN_ALLOWED_EMAILS;
  process.env.ADMIN_ALLOWED_EMAILS = 'ops@mytrade.test';
  try {
    assert.equal(isAuthorizedOperator(null), false);
    assert.equal(
      isAuthorizedOperator({ uid: 'u1', email: 'ops@mytrade.test', emailVerified: false }),
      false
    );
    assert.equal(
      isAuthorizedOperator({ uid: 'u2', email: 'random@example.com', emailVerified: true }),
      false
    );
    assert.equal(
      isAuthorizedOperator({ uid: 'u3', email: 'ops@mytrade.test', emailVerified: true }),
      true
    );
    assert.equal(
      isAuthorizedOperator({
        uid: 'u4',
        email: 'claim-admin@example.com',
        emailVerified: true,
        isAdminClaim: true,
      }),
      true
    );
  } finally {
    if (prev === undefined) delete process.env.ADMIN_ALLOWED_EMAILS;
    else process.env.ADMIN_ALLOWED_EMAILS = prev;
  }
});

test('SlidingWindowRateLimiter and BoundedTtlCache enforce limits and capacity caps', () => {
  const limiter = new SlidingWindowRateLimiter(50);
  assert.equal(limiter.consume('user-1', 2, 10_000, 1000).allowed, true);
  assert.equal(limiter.consume('user-1', 2, 10_000, 2000).allowed, true);
  assert.equal(limiter.consume('user-1', 2, 10_000, 3000).allowed, false);
  // After window expires, allowed again
  assert.equal(limiter.consume('user-1', 2, 10_000, 12000).allowed, true);

  const cache = new BoundedTtlCache<string>(3);
  cache.set('a', '1', 5000, 1000);
  cache.set('b', '2', 5000, 1000);
  cache.set('c', '3', 5000, 1000);
  cache.set('d', '4', 5000, 1000);
  assert.equal(cache.size, 3);
  assert.equal(cache.get('a', 1500), undefined); // evicted oldest
  assert.equal(cache.get('d', 1500), '4');
  assert.equal(cache.get('d', 7000), undefined); // expired
});

test('OAuth CSRF state validation, encrypted persistence, DHAN/ZERODHA specs', async () => {
  const store = new Map<string, PendingOAuthState>();
  const validState = crypto.randomBytes(24).toString('hex');
  store.set(validState, {
    brokerId: 'ZERODHA',
    userId: 'uid_real_user',
    createdAt: 1000,
    expiresAt: 60_000,
  });

  // Missing or short state fails
  assert.equal(consumePendingOAuthState('', 'ZERODHA', store, 2000), null);
  assert.equal(consumePendingOAuthState('short', 'ZERODHA', store, 2000), null);

  // Wrong broker fails and consumes state
  const mismatchState = crypto.randomBytes(24).toString('hex');
  store.set(mismatchState, {
    brokerId: 'UPSTOX',
    userId: 'uid_real_user',
    createdAt: 1000,
    expiresAt: 60_000,
  });
  assert.equal(consumePendingOAuthState(mismatchState, 'ZERODHA', store, 2000), null);

  // Guest userId is rejected
  const guestState = crypto.randomBytes(24).toString('hex');
  store.set(guestState, {
    brokerId: 'ZERODHA',
    userId: 'guest',
    createdAt: 1000,
    expiresAt: 60_000,
  });
  assert.equal(consumePendingOAuthState(guestState, 'ZERODHA', store, 2000), null);

  // Valid state succeeds once and cannot be replayed
  const consumed = consumePendingOAuthState(validState, 'ZERODHA', store, 2000);
  assert.ok(consumed !== null && consumed.userId === 'uid_real_user');
  assert.equal(consumePendingOAuthState(validState, 'ZERODHA', store, 2000), null);

  // AES-256-GCM encryption round-trip and tamper rejection
  const testKey = crypto.randomBytes(32);
  const cipher = encryptStorePayload('{"secret":"token-123"}', testKey);
  assert.equal(decryptStorePayload(cipher, testKey), '{"secret":"token-123"}');
  assert.equal(decryptStorePayload(cipher.slice(0, -2) + 'xx', testKey), null);

  // DHAN must report supportsOAuth: false
  assert.equal(getBrokerSpec('DHAN')?.supportsOAuth, false);

  // ZERODHA.exchangeCode must throw when credentials are missing instead of returning raw code
  const prevKey = process.env.KITE_API_KEY;
  const prevSec = process.env.KITE_API_SECRET;
  delete process.env.KITE_API_KEY;
  delete process.env.KITE_API_SECRET;
  try {
    const zerodha = getBrokerSpec('ZERODHA');
    assert.ok(zerodha && typeof zerodha.exchangeCode === 'function');
    const exchangeCode = zerodha.exchangeCode;
    await assert.rejects(
      () => exchangeCode({ code: 'raw_auth_code', callbackUrl: 'https://example.com/cb' }),
      /requires KITE_API_KEY and KITE_API_SECRET/i
    );
  } finally {
    if (prevKey !== undefined) process.env.KITE_API_KEY = prevKey;
    if (prevSec !== undefined) process.env.KITE_API_SECRET = prevSec;
  }
});

test('parseChartAnalysisJson guards invalid JSON and prevents NaN qualityScore bypass', () => {
  const malformed = parseChartAnalysisJson('not valid json {{');
  assert.equal(malformed.direction, 'NO_TRADE');
  assert.equal(malformed.status, 'NO_TRADE');
  assert.equal(malformed.qualityScore, 0);

  const parsed = parseChartAnalysisJson(
    JSON.stringify({
      instrument: 'XAUUSD',
      direction: 'BUY',
      qualityScore: 'high',
      entryPrice: 'not-a-number',
      stopLoss: 2500,
      target1: 2530,
      target2: 2560,
    })
  );
  assert.equal(parsed.qualityScore, 0);
  assert.equal(Number.isFinite(parsed.qualityScore), true);
  assert.equal(parsed.entryPrice, 0);
});
