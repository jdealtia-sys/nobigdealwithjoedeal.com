/**
 * Unit tests for functions/rate-limit.js against the Firestore emulator.
 *
 * RUN:
 *   cd tests && npm install
 *   firebase emulators:exec --only firestore --project nbd-test 'node rate-limit.test.js'
 *
 * These tests assert that:
 *   1. A fresh key under the limit passes.
 *   2. The limit is enforced transactionally — a burst that exceeds it
 *      throws a rateLimited error on the first over-budget call.
 *   3. After the window elapses, the counter resets.
 *   4. Per-key isolation — different keys in the same namespace don't
 *      collide.
 *   5. Per-namespace isolation — same key in different namespaces.
 *   6. Hash collision resistance — different raw keys produce different
 *      docIds.
 */

const assert = require('assert');
const admin = require('firebase-admin');

// Point the admin SDK at the local emulator.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
admin.initializeApp({ projectId: 'nbd-test-ratelimit' });

// Load the module under test AFTER admin is initialized — the helper uses
// admin.firestore() at call time.
const { enforceRateLimit, hashKey } = require('../functions/rate-limit');

// Small helpers.
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function expectRateLimited(fn) {
  try {
    await fn();
  } catch (e) {
    if (e.rateLimited) return;
    throw e;
  }
  throw new Error('expected rateLimited error');
}

async function run() {
  // Test 1: fresh key under the limit passes twice.
  await enforceRateLimit('test:t1', 'alice', 3, 60_000);
  await enforceRateLimit('test:t1', 'alice', 3, 60_000);
  console.log('✓ fresh key under limit passes');

  // Test 2: hitting the limit throws on the next call.
  await enforceRateLimit('test:t1', 'alice', 3, 60_000); // 3rd — still ok
  await expectRateLimited(() => enforceRateLimit('test:t1', 'alice', 3, 60_000));
  console.log('✓ over-limit call throws rateLimited');

  // Test 3: short-window reset. Use a 500 ms window so we can wait.
  await enforceRateLimit('test:t3', 'bob', 1, 500);
  await expectRateLimited(() => enforceRateLimit('test:t3', 'bob', 1, 500));
  await sleep(600);
  // After the window elapses the next call should pass.
  await enforceRateLimit('test:t3', 'bob', 1, 500);
  console.log('✓ window reset after elapsed ms');

  // Test 4: per-key isolation. Two separate keys in the same namespace
  // do not share a counter.
  await enforceRateLimit('test:t4', 'carol', 1, 60_000);
  await enforceRateLimit('test:t4', 'dave', 1, 60_000);
  await expectRateLimited(() => enforceRateLimit('test:t4', 'carol', 1, 60_000));
  await expectRateLimited(() => enforceRateLimit('test:t4', 'dave', 1, 60_000));
  console.log('✓ per-key isolation');

  // Test 5: per-namespace isolation. Same key in two namespaces has two
  // independent counters.
  await enforceRateLimit('test:t5a', 'eve', 1, 60_000);
  await enforceRateLimit('test:t5b', 'eve', 1, 60_000);
  await expectRateLimited(() => enforceRateLimit('test:t5a', 'eve', 1, 60_000));
  await expectRateLimited(() => enforceRateLimit('test:t5b', 'eve', 1, 60_000));
  console.log('✓ per-namespace isolation');

  // Test 6: hash collision sanity — different keys must map to different
  // docIds.
  assert.notStrictEqual(hashKey('alice'), hashKey('bob'));
  assert.notStrictEqual(hashKey('127.0.0.1'), hashKey('127.0.0.2'));
  // Same input produces same hash (deterministic).
  assert.strictEqual(hashKey('127.0.0.1'), hashKey('127.0.0.1'));
  console.log('✓ hashKey deterministic + distinct');

  // Test 7: rapid-fire burst inside the same namespace. Fire 10 calls in
  // parallel against a limit of 3 — exactly 3 should succeed, the other 7
  // should throw rateLimited.
  const LIMIT = 3;
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () => enforceRateLimit('test:t7', 'frank', LIMIT, 60_000))
  );
  const ok = results.filter(r => r.status === 'fulfilled').length;
  const rejected = results.filter(r => r.status === 'rejected' && r.reason && r.reason.rateLimited).length;
  // With transactional counters we should get at most LIMIT successes.
  assert.ok(ok <= LIMIT, 'expected at most ' + LIMIT + ' successes, got ' + ok);
  assert.ok(ok + rejected === 10, 'expected all 10 calls to resolve or reject cleanly');
  console.log(`✓ parallel burst: ${ok} ok / ${rejected} rate-limited (limit=${LIMIT})`);

  console.log('\n✓ All rate-limit tests passed');
  process.exit(0);
}

run().catch(e => {
  console.error('✗ rate-limit tests failed:', e);
  process.exit(1);
});
