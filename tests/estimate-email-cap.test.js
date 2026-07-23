/**
 * tests/estimate-email-cap.test.js — anti-relay invariants for the
 * estimate-email send caps (functions/estimate-email.js, ~L235-311).
 *
 * The estimate funnel lets anyone create an estimate_leads doc with ANY
 * email, so the send trigger is guarded by two sliding-window daily caps:
 *   • per-recipient  — 3/day per address (blocks repeat mail to one victim);
 *   • global backstop — 100/day across ALL addresses (env-overridable),
 *     so rotating through distinct victims can't turn the funnel into a
 *     domain-authenticated open relay.
 * Both fail OPEN so a transient throttle-store blip never drops a real send.
 *
 * The Cloud Function can't be require()d standalone (getFirestore /
 * defineSecret at module load), so — per the house pattern — the sanitizer,
 * the global-cap resolver, and the throttle-transaction body below are
 * FAITHFUL MIRRORS of that block. Change stripe.js-style: if you touch the
 * cap logic in estimate-email.js, mirror it here.
 *
 * Zero deps. Run: node tests/estimate-email-cap.test.js
 */
'use strict';

const DAY = 86400000;

// Mirror of the per-recipient key sanitizer (estimate-email.js L241).
function emailKey(email) {
  return String(email).toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 200);
}

// Mirror of the global-cap resolver (L292-293): env override, else 100.
function globalCap(envVal) {
  const parsed = Number(envVal);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 100;
}

// Mirror of the sliding-window throttle transaction body (L246-258 / L289-303).
// `doc` = current throttle doc data (null if absent). Returns { allowed, next }
// where `next` is what would be written back on an allowed send.
function decide(doc, now, CAP) {
  let count = 0, windowStartMs = now;
  if (doc) {
    windowStartMs = Number(doc.windowStartMs) || now;
    if (now - windowStartMs < DAY) count = Number(doc.count) || 0;
    else windowStartMs = now;
  }
  if (count >= CAP) return { allowed: false, next: doc };
  return { allowed: true, next: { count: count + 1, windowStartMs } };
}

// Simulate N sends spaced `stepMs` apart starting at `t0`; returns the
// allow/block verdicts and the final persisted doc.
function runSends(n, CAP, { t0 = 1_000_000_000_000, stepMs = 0, startDoc = null } = {}) {
  const verdicts = [];
  let doc = startDoc, now = t0;
  for (let i = 0; i < n; i++) {
    const r = decide(doc, now, CAP);
    verdicts.push(r.allowed);
    if (r.allowed) doc = r.next;
    now += stepMs;
  }
  return { verdicts, doc };
}

// ── harness ────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('ESTIMATE-EMAIL SEND CAPS — anti-relay invariants');

// P — per-recipient cap (3/day).
{
  const { verdicts, doc } = runSends(4, 3);
  ok('P1 first 3 sends allowed, 4th blocked', verdicts.join() === 'true,true,true,false');
  ok('P1 count settles at the cap (3)', doc.count === 3);

  // Same window (all within 24h) keeps the ORIGINAL windowStart, not a slide.
  const win = runSends(3, 3, { stepMs: 3600_000 }); // 1h apart
  ok('P2 window does not slide within 24h', win.doc.windowStartMs === 1_000_000_000_000);

  // A 4th send just past 24h from the window start resets and is allowed.
  const start = { count: 3, windowStartMs: 1_000_000_000_000 };
  const past = decide(start, 1_000_000_000_000 + DAY + 1, 3);
  ok('P3 window resets after 24h → allowed again', past.allowed === true);
  ok('P3 reset stamps a fresh windowStart', past.next.windowStartMs === 1_000_000_000_000 + DAY + 1 && past.next.count === 1);

  // Garbage persisted data must not brick the cap (fail-safe parsing).
  const junk = decide({ count: 'x', windowStartMs: 'y' }, 1_000_000_000_000, 3);
  ok('P4 non-numeric doc fields → count 0, fresh window, allowed', junk.allowed === true && junk.next.count === 1);
}

// K — email key sanitizer (a caller must not dodge the per-recipient cap).
{
  ok('K1 case-insensitive: FOO@bar vs foo@BAR share a key',
    emailKey('FOO@Bar.com') === emailKey('foo@bar.COM'));
  ok('K2 non-alphanumerics collapse to underscores', emailKey('a+b@x.io') === 'a_b_x_io');
  ok('K3 key length capped at 200', emailKey('a'.repeat(500) + '@x.com').length === 200);
  ok('K4 sanitizer can never collide with the GLOBAL_DAILY sentinel',
    emailKey('GLOBAL_DAILY') !== 'GLOBAL_DAILY'); // lowercased → 'global_daily'
}

// G — global backstop cap.
{
  // Default 100: the 100th send (count 99→100) is allowed, the 101st blocked.
  const at99 = decide({ count: 99, windowStartMs: 1_000_000_000_000 }, 1_000_000_000_000, globalCap(undefined));
  const at100 = decide({ count: 100, windowStartMs: 1_000_000_000_000 }, 1_000_000_000_000, globalCap(undefined));
  ok('G1 default cap 100: 100th allowed, 101st blocked', at99.allowed === true && at100.allowed === false);

  ok('G2 env override caps lower', globalCap('5') === 5);
  ok('G3 zero / negative / garbage / empty env → falls back to 100',
    [globalCap('0'), globalCap('-3'), globalCap('abc'), globalCap(''), globalCap(undefined)].every((c) => c === 100));
  ok('G4 fractional env floored', globalCap('7.9') === 7);
}

// S — sentinel-id safety (fail-open makes a rejected id silently disable the cap).
{
  ok('S1 GLOBAL_DAILY is NOT a Firestore-reserved /__.*__/ id', !/^__.*__$/.test('GLOBAL_DAILY'));
  ok('S2 no per-recipient key equals the global sentinel',
    !['a@b.com', 'x_y', 'GLOBAL_DAILY', 'Z'].some((e) => emailKey(e) === 'GLOBAL_DAILY'));
}

console.log('\n──────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
