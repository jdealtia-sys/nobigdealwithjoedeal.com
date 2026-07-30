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
// claim path); `claimsError` makes that read throw (fallback path);
// `getDocError` makes the subscription-doc read itself throw.
function makeBilling({ user, subDoc, subExists = true, claims, claimsError, getDocError } = {}) {
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
    getDoc: async () => {
      if (getDocError) throw new Error('simulated firestore blip');
      return { exists: () => subExists, data: () => subDoc || {} };
    },
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

  // 8. Founder display mirror (2026-07-29 seat-stepper fix). The owner
  //    short-circuit pins enterprise for GATING, then best-effort reads the
  //    sub doc and mirrors a card-billed (source 'checkout') sub into
  //    getPlan() so the founder's billing/team UI reflects the REAL
  //    subscription — verified live: Jo's card-billed Growth sub was
  //    invisible and the "Extra seats" stepper never rendered. The
  //    never-limit-gated guarantee must survive every branch.

  // 8a. Owner + readable checkout sub → getPlan() exposes the real plan
  //     (finite caps), source 'checkout', purchasedSeats — exactly the
  //     surface _renderSeatBuy() needs to SHOW the stepper — while every
  //     gate still bypasses via the owner claim.
  {
    const B = makeBilling({
      user: { uid: 'founder-co', email: 'founder@demo.test' },
      claims: { owner: true, companyId: 'founder-co' },
      subDoc: { plan: 'growth', status: 'active', source: 'checkout', purchasedSeats: 3,
                usage: { leads: 42, reports: 1, aiCalls: 7 } },
    });
    await B.loadSubscription();
    const p = B.getPlan();
    assert('owner + checkout sub: getPlan().plan mirrors the real sub (growth)', p.plan === 'growth');
    assert('owner + checkout sub: source === checkout', p.source === 'checkout');
    assert('owner + checkout sub: purchasedSeats === 3 (real count)', p.purchasedSeats === 3);
    assert('owner + checkout sub: status active + loaded', p.status === 'active' && p.loaded === true);
    assert('owner + checkout sub: finite rep cap for display (growth = 5)', p.limits.reps === 5);
    assert('owner + checkout sub: usage mirrors the doc (42 leads)', p.usage.leads === 42);
    // Mirror of the dashboard-team-tab _renderSeatBuy visibility predicate:
    // entitled + card-billed + paid plan + finite reps ⇒ founder SEES it.
    const stepperVisible = (p.status === 'active' || p.status === 'trialing' || p.status === 'past_due')
      && p.source === 'checkout' && p.plan !== 'free'
      && p.limits.reps !== Infinity && p.limits.reps != null;
    assert('owner + checkout sub: seat-stepper predicate is TRUE', stepperVisible === true);
    // Never-gated guarantee intact despite the finite mirrored plan.
    assert('owner + checkout sub: canUse(team) still true (owner bypass)', B.canUse('team') === true);
    assert('owner + checkout sub: canUse(reports) still true', B.canUse('reports') === true);
    assert('owner + checkout sub: enforceGate never blocks', B.enforceGate('leads', 'leads') === true);
    assert('owner + checkout sub: softGate never warns/blocks', B.softGate('leads', 'leads') === true);
  }

  // 8a2. Owner + past_due checkout sub → status mirrors truthfully and
  //      purchasedSeats still count (past_due is seat-entitled — the
  //      reduction path), so the stepper's minus-only mode can render.
  {
    const B = makeBilling({
      user: { uid: 'founder-pd', email: 'founder@demo.test' },
      claims: { owner: true },
      subDoc: { plan: 'growth', status: 'past_due', source: 'checkout', purchasedSeats: 2 },
    });
    await B.loadSubscription();
    const p = B.getPlan();
    assert('owner + past_due checkout sub: status mirrors past_due', p.isPastDue === true);
    assert('owner + past_due checkout sub: purchasedSeats still count (2)', p.purchasedSeats === 2);
    assert('owner + past_due checkout sub: still never gated', B.canUse('team') === true && B.enforceGate('leads', 'leads') === true);
  }

  // 8b. Owner + FAILING Firestore read → enterprise/active defaults stand,
  //     loaded stays true, and no gate ever fires. The mirror is display-
  //     only sugar; a blip must never downgrade the founder.
  {
    const B = makeBilling({
      user: { uid: 'founder-blip', email: 'founder@demo.test' },
      claims: { owner: true },
      getDocError: true,
    });
    await B.loadSubscription();
    const p = B.getPlan();
    assert('owner + failing read: resolves enterprise', p.plan === 'enterprise');
    assert('owner + failing read: status active, loaded true', p.status === 'active' && p.loaded === true);
    assert('owner + failing read: source null + 0 purchased seats', p.source === null && p.purchasedSeats === 0);
    assert('owner + failing read: reps Infinity (stepper predicate FALSE)', p.limits.reps === Infinity);
    assert('owner + failing read: canUse(team) true — never gated', B.canUse('team') === true);
    assert('owner + failing read: enforceGate true — never gated', B.enforceGate('leads', 'leads') === true);
    assert('owner + failing read: softGate true — never warned', B.softGate('leads', 'leads') === true);
  }

  // 8c. Owner + NO sub doc → enterprise defaults (nothing to mirror).
  {
    const B = makeBilling({
      user: { uid: 'founder-nodoc', email: 'founder@demo.test' },
      claims: { owner: true },
      subExists: false,
    });
    await B.loadSubscription();
    const p = B.getPlan();
    assert('owner + missing doc: stays enterprise/active', p.plan === 'enterprise' && p.status === 'active');
    assert('owner + missing doc: source null, seats 0', p.source === null && p.purchasedSeats === 0);
  }

  // 8d. Owner + NON-checkout doc (access-code comp) → enterprise defaults
  //     kept, DELIBERATELY. Only a card-billed sub mirrors: a comp/junk doc
  //     must never repaint the founder's billing UI (worst case a
  //     {plan:'free'} doc painting Free + Upgrade), and setCompanySeatCount
  //     refuses non-checkout subs anyway, so the stepper stays hidden.
  {
    const B = makeBilling({
      user: { uid: 'founder-comp', email: 'founder@demo.test' },
      claims: { owner: true },
      subDoc: { plan: 'foundation', status: 'active', source: 'access_code', purchasedSeats: 2 },
    });
    await B.loadSubscription();
    const p = B.getPlan();
    assert('owner + access_code comp doc: NOT mirrored (stays enterprise)', p.plan === 'enterprise');
    assert('owner + access_code comp doc: source stays null, seats 0', p.source === null && p.purchasedSeats === 0);
  }

  console.log('\n──────────────────────────────────────────────────');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
})().catch(e => { console.error('billing-gate test crashed:', e); process.exit(1); });
