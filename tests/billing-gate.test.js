/**
 * tests/billing-gate.test.js — behavioral unit tests for the client billing
 * gate (docs/pro/js/billing-gate.js), Audit #3 Phase 1.
 *
 * billing-gate.js is a browser IIFE that attaches window.NBDBilling. It has no
 * DOM dependency at call time for the gate decisions (canUse / loadSubscription
 * / getPlan), so we load it in a vm sandbox with a stubbed `window` + a fake
 * Firestore (window.doc / window.getDoc / window.db) and actually EXERCISE the
 * plan logic — free defaults, an active professional sub, owner bypass, and a
 * past_due (inactive) sub. This drives the real code path the dashboard uses to
 * decide "is this feature available?", not a source grep.
 *
 * Zero deps. Run: node tests/billing-gate.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/billing-gate.js'), 'utf8');

let passed = 0, failed = 0;
const fails = [];
function assert(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

// Build a fresh sandboxed NBDBilling whose Firestore getDoc returns `subDoc`.
// `claims` wires user.getIdTokenResult() to resolve { claims } (the owner-
// claim path); `claimsError` makes that read throw (fallback path).
function makeBilling({ user, subDoc, subExists = true, claims, claimsError } = {}) {
  if (user && (claims || claimsError)) {
    user.getIdTokenResult = async () => {
      if (claimsError) throw new Error('claims read failed (simulated)');
      return { claims: claims || {} };
    };
  }
  const noopEl = () => ({ style: {}, appendChild() {}, addEventListener() {}, remove() {}, dataset: {} });
  const documentStub = {
    addEventListener() {}, removeEventListener() {},
    getElementById() { return null; },
    createElement() { return noopEl(); },
    body: noopEl(),
  };
  const windowStub = {
    _user: user || null,
    db: {},
    doc: (_db, coll, id) => ({ coll, id }),
    getDoc: async () => ({ exists: () => subExists, data: () => subDoc || {} }),
  };
  windowStub.window = windowStub;
  const sandbox = { window: windowStub, document: documentStub, console: { log() {}, error() {}, warn() {} }, setTimeout, Date };
  vm.runInNewContext(SRC, sandbox, { filename: 'billing-gate.js' });
  return windowStub.NBDBilling;
}

(async () => {
  console.log('BILLING GATE — plan decision logic');

  // 1. Free defaults (no subscription loaded yet).
  {
    const B = makeBilling({ user: { uid: 'u1', email: 'rep@demo.test' } });
    assert('exposes NBDBilling API (canUse/loadSubscription/getPlan)',
      B && typeof B.canUse === 'function' && typeof B.loadSubscription === 'function' && typeof B.getPlan === 'function');
    assert('free default: leads allowed (0 < 10)', B.canUse('leads') === true);
    assert('free default: team feature locked (reps == 1)', B.canUse('team') === false);
    assert('free default: reports locked (limit 0)', B.canUse('reports') === false);
    assert('free default: aiCalls locked (limit 0)', B.canUse('aiCalls') === false);
    assert('free default getPlan(): plan=free, not active', B.getPlan().plan === 'free' && B.getPlan().isActive === false);
  }

  // 2. Active subscription with the LEGACY 'professional' doc value →
  //    resolves to canonical 'growth' at the read boundary and unlocks
  //    team/reports/aiCalls. Production docs carry legacy keys forever,
  //    so this alias path can never be removed.
  {
    const B = makeBilling({ user: { uid: 'u2', email: 'admin@demo.test' }, subDoc: { plan: 'professional', status: 'active' } });
    await B.loadSubscription();
    const p = B.getPlan();
    assert('legacy professional doc: getPlan().plan === growth (canonical)', p.plan === 'growth');
    assert('legacy professional doc: isActive === true', p.isActive === true);
    assert('legacy professional doc: team unlocked (reps 5 > 1)', B.canUse('team') === true);
    assert('legacy professional doc: reports unlocked (Infinity)', B.canUse('reports') === true);
    assert('legacy professional doc: aiCalls unlocked (Infinity)', B.canUse('aiCalls') === true);
  }

  // 3. OWNER_EMAILS retirement (2026-07-06): a founder EMAIL with no owner
  //    claim gets NO bypass — email alone never authorizes anymore. (The
  //    self-heal lives in nbd-auth.js: mint + token re-read at login turns
  //    a real founder session into case 3b before billing-gate ever gates.)
  {
    const B = makeBilling({ user: { uid: 'owner', email: 'jonathandeal459@gmail.com' }, subDoc: { plan: 'free', status: 'none' } });
    await B.loadSubscription();
    assert('founder email, NO claim: stays free (email never authorizes)', B.getPlan().plan === 'free');
    assert('founder email, NO claim: team locked like any free user', B.canUse('team') === false);
  }

  // 3b. Owner CLAIM bypass (claims-based root) — an { owner: true } custom
  //     claim bypasses gating regardless of email. Since the retirement
  //     this is THE owner path, not the post-transition one.
  {
    const B = makeBilling({
      user: { uid: 'claim-owner', email: 'not-in-the-list@demo.test' },
      claims: { owner: true },
      subDoc: { plan: 'free', status: 'none' },
    });
    await B.loadSubscription();
    assert('owner claim (any email): getPlan().plan === enterprise', B.getPlan().plan === 'enterprise');
    assert('owner claim (any email): canUse(team) true', B.canUse('team') === true);
    assert('owner claim (any email): canUse(reports) true', B.canUse('reports') === true);
  }

  // 3c. Claims read FAILURE + listed owner email → NO bypass since the
  //     retirement. The session degrades to the subscription doc for this
  //     load and heals at the next login (nbd-auth mint + refresh) — it
  //     must NOT fail open on an email literal.
  {
    const B = makeBilling({
      user: { uid: 'owner-fallback', email: 'jd@nobigdealwithjoedeal.com' },
      claimsError: true,
      subDoc: { plan: 'free', status: 'none' },
    });
    await B.loadSubscription();
    assert('claims read fails + founder email: NO email bypass (stays free)', B.getPlan().plan === 'free');
    assert('claims read fails + founder email: team locked (degrade, heal next login)', B.canUse('team') === false);
  }

  // 3d. Claims read failure + NON-owner email → NO bypass (the fallback
  //     must not fail open for regular users).
  {
    const B = makeBilling({
      user: { uid: 'rep-fail', email: 'rep@demo.test' },
      claimsError: true,
      subDoc: { plan: 'free', status: 'none' },
    });
    await B.loadSubscription();
    assert('claims read fails + non-owner email: stays free (no bypass)', B.getPlan().plan === 'free');
    assert('claims read fails + non-owner email: team still locked', B.canUse('team') === false);
  }

  // 3e. Non-owner claims (owner flag absent) + non-listed email → no bypass.
  {
    const B = makeBilling({
      user: { uid: 'rep-claims', email: 'rep2@demo.test' },
      claims: { companyId: 'rep-claims', role: 'sales_rep' },
      subDoc: { plan: 'free', status: 'none' },
    });
    await B.loadSubscription();
    assert('non-owner claims: stays free (owner requires owner === true)', B.getPlan().plan === 'free');
  }

  // 4. past_due subscription → plan set but NOT active.
  {
    const B = makeBilling({ user: { uid: 'u4', email: 'late@demo.test' }, subDoc: { plan: 'professional', status: 'past_due' } });
    await B.loadSubscription();
    const p = B.getPlan();
    assert('past_due: getPlan().isActive === false', p.isActive === false);
    assert('past_due: isPastDue === true', p.isPastDue === true);
  }

  // 5. Access-code trial expiry — read-time enforcement (2026-07-05
  //    decision). A code-granted sub past trialEndsAt gates as free;
  //    an unexpired or untimed code grant keeps its plan; Stripe subs
  //    are never touched by this check.
  {
    const past = { toMillis: () => Date.now() - 24 * 60 * 60 * 1000 };
    const future = { toMillis: () => Date.now() + 24 * 60 * 60 * 1000 };

    const expired = makeBilling({ user: { uid: 'u5', email: 'trial@demo.test' },
      subDoc: { plan: 'foundation', status: 'active', source: 'access_code', trialEndsAt: past } });
    await expired.loadSubscription();
    assert('expired code trial: gates as free', expired.getPlan().plan === 'free');
    assert('expired code trial: reports locked again', expired.canUse('reports') === false);

    const live = makeBilling({ user: { uid: 'u6', email: 'trial2@demo.test' },
      subDoc: { plan: 'foundation', status: 'active', source: 'access_code', trialEndsAt: future } });
    await live.loadSubscription();
    assert('unexpired code trial: keeps its tier (legacy foundation → canonical starter)',
      live.getPlan().plan === 'starter');

    const comp = makeBilling({ user: { uid: 'u7', email: 'comp@demo.test' },
      subDoc: { plan: 'foundation', status: 'active', source: 'access_code' } });
    await comp.loadSubscription();
    assert('untimed code grant: indefinite comp, keeps its tier (legacy foundation → canonical starter)',
      comp.getPlan().plan === 'starter');

    const stripe = makeBilling({ user: { uid: 'u8', email: 'paying@demo.test' },
      subDoc: { plan: 'growth', status: 'active', source: 'stripe', trialEndsAt: past } });
    await stripe.loadSubscription();
    assert('stripe sub with stale trialEndsAt: untouched (Stripe owns lifecycle)', stripe.getPlan().plan === 'growth');
  }

  // 6. loadSubscription failure must NOT paint a known Free tier.
  //    Post-sprint chip: a paid tenant on a Firestore blip used to flash Free
  //    + Upgrade because the catch path forced plan=free and loaded=true.
  //    Gates must fail open (_loaded=false) until a successful read.
  {
    const noopEl = () => ({ style: {}, appendChild() {}, addEventListener() {}, remove() {}, dataset: {} });
    const documentStub = {
      addEventListener() {}, removeEventListener() {},
      getElementById() { return null; },
      createElement() { return noopEl(); },
      body: noopEl(),
    };
    const windowStub = {
      _user: { uid: 'paid-blip', email: 'paid@demo.test' },
      db: {},
      doc: (_db, coll, id) => ({ coll, id }),
      getDoc: async () => { throw new Error('simulated firestore blip'); },
    };
    windowStub.window = windowStub;
    const sandbox = { window: windowStub, document: documentStub, console: { log() {}, error() {}, warn() {} }, setTimeout, Date };
    vm.runInNewContext(SRC, sandbox, { filename: 'billing-gate.js' });
    const B = windowStub.NBDBilling;
    await B.loadSubscription();
    const p = B.getPlan();
    assert('load failure: getPlan().loaded === false (plan unknown)', p.loaded === false);
    assert('load failure: enforceGate fails open (never blocks on unknown plan)', B.enforceGate('leads', 'leads') === true);
    assert('load failure: softGate fails open', B.softGate('leads', 'leads') === true);
  }

  // 7. Successful load exposes loaded:true so billing UI can trust Free.
  {
    const B = makeBilling({ user: { uid: 'u9', email: 'ok@demo.test' }, subDoc: { plan: 'team', status: 'trialing' } });
    assert('before load: loaded === false', B.getPlan().loaded === false);
    await B.loadSubscription();
    assert('after load: loaded === true', B.getPlan().loaded === true);
    assert('after load: plan === team', B.getPlan().plan === 'team');
  }

  console.log('\n──────────────────────────────────────────────────');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
})().catch(e => { console.error('billing-gate test crashed:', e); process.exit(1); });
