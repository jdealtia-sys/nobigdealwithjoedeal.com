// @ts-check
// ─────────────────────────────────────────────────────────────────────
// THE STRANGER TEST @stranger — the full second-contractor lifecycle.
//
// The 2026-07 product audit's central verdict was "no stranger can
// self-provision a usable tenant today". Everything needed to flip that
// answer shipped across Pillars 1/4/5 (createCompany, invites, onboarding
// wizard, tenant microsite), but nothing ever exercised them TOGETHER —
// structurally nothing could, because the rig ran without the Functions
// emulator. This spec is that proof, end to end, in CI, on every PR:
//
//   register → createCompany (really runs) → onboarding completed for real
//   → dashboard unwalled on the free plan → save a lead → the tenant's
//   public microsite renders THEIR brand → a homeowner's quote-form lead
//   routes into THEIR pipeline (never NBD's) → free-plan seat gate refuses
//   invites → upgraded tenant invites a rep → rep registers, claims in,
//   their solo tenant is superseded → cross-tenant isolation holds.
//
// Requires the FUNCTIONS emulator (tests/package.json --only list) — the
// enforced callables get their App Check token from the localhost-only
// CustomProvider shim in docs/pro/js/nbd-emulator-connect.js.
//
// Node side uses firebase-admin against the emulators (emulators:exec
// exports FIREBASE_AUTH_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST to child
// processes) for seeding-free assertions and the two admin-only nudges a
// real flow gets from outside the browser: email verification (the rep
// clicks a link we can't receive) and the plan upgrade (Stripe checkout
// can't be emulated).
// ─────────────────────────────────────────────────────────────────────

const { test, expect } = require('@playwright/test');
const { loginAs } = require('./fixtures/auth');
const { installLocalSdkShim } = require('./fixtures/local-sdk');

const EMULATOR_MODE = /localhost|127\.0\.0\.1/.test(process.env.PLAYWRIGHT_BASE_URL || '')
  && !!process.env.FIRESTORE_EMULATOR_HOST
  && !!process.env.FIREBASE_AUTH_EMULATOR_HOST;

// Lazy admin SDK handle — initialized once, only in emulator mode.
let _admin = null;
function admin() {
  if (_admin) return _admin;
  const { initializeApp, getApps } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  if (!getApps().length) initializeApp({ projectId: 'nobigdeal-pro' });
  _admin = { auth: getAuth(), db: getFirestore(), FieldValue };
  return _admin;
}

/** Poll an async predicate until truthy or timeout. Returns the value. */
async function eventually(fn, { timeout = 30_000, interval = 1_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`eventually: ${label} not met within ${timeout}ms`);
}

/** Register a brand-new account through the real /pro/register UI. */
async function registerViaUi(page, { first, last, company, email, password }) {
  await page.goto('/pro/register.html');
  await page.waitForLoadState('load');
  await page.fill('#regFirst', first);
  await page.fill('#regLast', last);
  if (company) await page.fill('#regCompany', company);
  await page.fill('#regEmail', email);
  await page.fill('#regPass', password);
  await page.fill('#regConfirm', password);
  await page.click('#regBtn');
  try {
    await page.waitForURL(/\/pro\/onboarding(\.html)?([?#]|$)/, { timeout: 30_000 });
  } catch (e) {
    const regErr = await page.locator('#regErr').textContent().catch(() => '');
    throw new Error('register never reached onboarding'
      + (regErr ? ` — #regErr: "${regErr.trim()}"` : ' — #regErr empty (silent hang)'));
  }
}

/** Wait for the onboarding module to be ready (same signal the signup-funnel journey uses). */
async function waitOnboardingReady(page, email) {
  await page.waitForFunction((expected) => {
    const el = document.getElementById('obEmail');
    return !!el && el.value === expected;
  }, email, { timeout: 20_000 });
}

/** In-page callable through the app's own (emulator-connected, App-Check-shimmed) SDK. */
async function callFromPageOnce(page, fnName, payload) {
  return page.evaluate(async ({ name, data }) => {
    const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
    const emu = await import('/pro/js/nbd-emulator-connect.js');
    const fns = m.getFunctions();
    await emu.connectEmulatorsIfLocal({ functions: fns });
    try {
      const r = await m.httpsCallable(fns, name)(data || {});
      return { ok: true, data: r && r.data };
    } catch (e) {
      return { ok: false, code: (e && e.code) || '', message: (e && e.message) || String(e) };
    }
  }, { name: fnName, data: payload || {} });
}

/**
 * Same, but retries the emulator's transient-failure signature: a bare
 * `internal` error. Server-side Firestore hiccups (rate-limit transaction
 * contention, dropped reads) surface as raw errors → callable `internal`;
 * every DELIBERATE refusal in these functions is a typed HttpsError
 * (resource-exhausted, failed-precondition, invalid-argument) which is
 * returned as-is, so retrying `internal` never masks a real verdict.
 */
async function callFromPage(page, fnName, payload) {
  let last;
  for (let i = 0; i < 3; i++) {
    last = await callFromPageOnce(page, fnName, payload);
    const internal = !last.ok && /(^|\/)internal$/.test(last.code || '') ||
      (!last.ok && String(last.message).trim().toLowerCase() === 'internal');
    if (!internal) return last;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return last;
}

// Shared across the serial journey.
const stamp = Date.now();
const STRANGER = {
  email: `e2e-stranger-${stamp}@nbd.test`,
  password: 'nbd-e2e-stranger-pw-1',
  company: `[E2E] Stranger Roofing ${stamp}`,
  primaryColor: '#123456',
  uid: '',
};
const REP = {
  email: `e2e-stranger-rep-${stamp}@nbd.test`,
  password: 'nbd-e2e-rep-pw-1',
  uid: '',
};
const LEAD_LAST = `Stranger${stamp}`;

test.describe.serial('The Stranger Test — second-contractor lifecycle @stranger', () => {
  test.beforeEach(async ({ context }, testInfo) => {
    if (!EMULATOR_MODE) {
      testInfo.skip(true, 'stranger journey runs in emulator mode only (functions+auth+firestore emulators required)');
    }
    // These are LONG journeys (multi-page, multi-context, trigger polls up
    // to 60s) — the 30s default guarantees false timeouts.
    testInfo.setTimeout(240_000);
    await installLocalSdkShim(context); // sandbox-only; no-op in CI
  });

  test('provision: register → real onboarding → dashboard, tenant docs + claims land', async ({ page }) => {
    await registerViaUi(page, {
      first: '[E2E] Stranger', last: String(stamp),
      company: STRANGER.company, email: STRANGER.email, password: STRANGER.password,
    });
    await waitOnboardingReady(page, STRANGER.email);

    // Complete the wizard FOR REAL (the existing signup-funnel journey covers
    // the skip link; this is the brand-setting path the invite email sells).
    await page.fill('#obName', STRANGER.company);
    await page.fill('#obPhone', '(513) 555-0142');
    await page.fill('#obServiceArea', 'Greater Cincinnati (E2E)');
    await page.click('#next1');
    // Step 2: a deliberate color choice — buildOverrides only persists colors
    // the rep actually touched (the M1 NBD-bleed rule this asserts later).
    await page.fill('#obColorPrimary', STRANGER.primaryColor);
    await page.click('#next2');
    const finish = page.locator('#finishBtn');
    await expect(finish, 'review step reached').toBeVisible({ timeout: 10_000 });
    await finish.click();
    await page.waitForURL(/\/pro\/dashboard(\.html)?([?#]|$)/, { timeout: 30_000 });

    // Dashboard resolves, unwalled, on the free plan.
    await page.waitForFunction(() => typeof window.goTo === 'function', null, { timeout: 20_000 });
    await expect(page.locator('#nbd-upgrade-wall'), 'free tenant must not be upgrade-walled').toHaveCount(0);
    await page.waitForFunction(() => !!window._userPlan, null, { timeout: 20_000 });

    // The provisioning contract: claims say this user IS a tenant.
    const idState = await page.evaluate(async () => {
      const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
      const user = m.getAuth().currentUser;
      const t = await user.getIdTokenResult(true);
      return { uid: user.uid, claims: t.claims, plan: window._userPlan || null };
    });
    STRANGER.uid = idState.uid;
    expect(idState.claims.companyId, 'companyId claim == uid (solo convention)').toBe(idState.uid);
    expect(idState.claims.role, 'role claim is the canonical top company role').toBe('company_admin');
    expect(idState.plan, 'fresh tenant resolves to the free plan').toBe('free');

    // Server truth: createCompany + the wizard both landed, and the seed is
    // NEUTRAL — the tenant's own identity, zero NBD bleed (Pillar 2 M1).
    const { db } = admin();
    const co = (await db.doc(`companies/${STRANGER.uid}`).get()).data();
    expect(co, 'companies/{uid} exists').toBeTruthy();
    expect(co.ownerId).toBe(STRANGER.uid);
    expect(co.source).toBe('self-serve');
    expect(co.status).toBe('active');
    const profile = (await db.doc(`companyProfile/${STRANGER.uid}`).get()).data();
    expect(profile, 'companyProfile/{uid} exists').toBeTruthy();
    expect(profile.brand && profile.brand.legalName).toBe(STRANGER.company);
    expect(profile.brand && profile.brand.colors && profile.brand.colors.primary,
      'deliberately-picked primary color persisted').toBe(STRANGER.primaryColor);
    const profileJson = JSON.stringify(profile).toLowerCase();
    for (const bleed of ['no big deal', 'nobigdeal', 'joe deal', '18595']) {
      expect(profileJson, `companyProfile carries no NBD bleed ("${bleed}")`).not.toContain(bleed);
    }
  });

  test('operate: the new tenant saves a lead scoped to their own company', async ({ page }) => {
    expect(STRANGER.uid, 'provision test must have run').toBeTruthy();
    await page.route('**/nominatim.openstreetmap.org/**', route =>
      route.fulfill({ contentType: 'application/json', body: '[]' }));
    await loginAs(page, { email: STRANGER.email, password: STRANGER.password });
    await page.waitForFunction(() => typeof window.goTo === 'function', null, { timeout: 20_000 });
    await page.evaluate(() => window.goTo('crm'));
    await expect(page.locator('#kanbanBoard, #view-crm .kanban-board').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForFunction(() => window._user && window._user.uid, null, { timeout: 15_000 });

    await page.evaluate(async (args) => {
      try {
        await window._saveLead({
          firstName: '[E2E] Homeowner',
          lastName: args.last,
          address: `${String(args.stamp).slice(-3)} Stranger Test Ln, Cincinnati, OH`,
          phone: '513' + String(args.stamp).slice(-7),
          stage: 'new',
          e2eTestData: true,
        });
      } catch (e) { if (!/ALREADY_EXISTS/.test(String(e && e.message || e))) throw e; }
    }, { last: LEAD_LAST, stamp });

    const card = page.locator(`text=/\\[E2E\\] Homeowner.*${stamp}/i`).first();
    await expect(card, 'lead card visible in the new tenant kanban').toBeVisible({ timeout: 10_000 });

    // Server truth: the lead is stamped to the STRANGER tenant.
    const { db } = admin();
    const leads = await db.collection('leads')
      .where('lastName', '==', LEAD_LAST).limit(2).get();
    expect(leads.size, 'exactly one lead saved').toBe(1);
    const lead = leads.docs[0].data();
    expect(lead.companyId, 'lead.companyId == stranger tenant').toBe(STRANGER.uid);
    expect(lead.userId, 'lead.userId == stranger uid').toBe(STRANGER.uid);
  });

  test('public face: microsite renders the tenant brand; quote form routes to THEIR pipeline', async ({ page }) => {
    expect(STRANGER.uid, 'provision test must have run').toBeTruthy();

    await page.goto(`/sites/t/${STRANGER.uid}`);
    await expect(page.locator('#site'), 'microsite resolved (not siteMissing)').toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#brandName')).toHaveText(STRANGER.company, { timeout: 10_000 });
    const primary = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());
    expect(primary.toLowerCase(), 'tenant primary color applied via getPublicSiteConfig').toBe(STRANGER.primaryColor);

    // A homeowner submits the quote form (honeypot #qWebsite stays empty).
    await page.fill('#qFirst', 'Micro');
    await page.fill('#qLast', `Site${stamp}`);
    await page.fill('#qPhone', '513' + String(stamp + 1).slice(-7));
    await page.click('#qSubmit');
    await expect(page.locator('#formOk'), 'quote form confirms').toContainText(/reach out shortly/i, { timeout: 20_000 });

    // Server truth: contact_leads doc tagged to the tenant, then the
    // leadBridgeContact trigger (now actually running) mirrors it into the
    // CRM pipeline — owned by the STRANGER, never NBD.
    const { db } = admin();
    const bridged = await eventually(async () => {
      const snap = await db.collection('leads')
        .where('companyId', '==', STRANGER.uid)
        .where('lastName', '==', `Site${stamp}`).limit(1).get();
      return snap.empty ? null : snap.docs[0].data();
    }, { label: 'bridged microsite lead in CRM', timeout: 45_000 });
    expect(bridged.userId, 'bridged lead routed to the tenant OWNER').toBe(STRANGER.uid);
    expect(bridged.companyId).toBe(STRANGER.uid);

    // …and their card shows up in THEIR kanban like any other lead.
    await loginAs(page, { email: STRANGER.email, password: STRANGER.password });
    await page.waitForFunction(() => typeof window.goTo === 'function', null, { timeout: 20_000 });
    await page.evaluate(() => window.goTo('crm'));
    await expect(page.locator(`text=/Micro.*Site${stamp}/i`).first(),
      'microsite lead card visible in tenant kanban').toBeVisible({ timeout: 15_000 });
  });

  test('team: free plan is seat-gated; upgraded tenant invites a rep who claims in', async ({ page, browser }) => {
    expect(STRANGER.uid, 'provision test must have run').toBeTruthy();
    const { db, auth, FieldValue } = admin();

    await loginAs(page, { email: STRANGER.email, password: STRANGER.password });
    await page.waitForFunction(() => window._user && window._user.uid, null, { timeout: 20_000 });

    // Free plan → zero seats. The gate must refuse BEFORE any member doc.
    const gated = await callFromPage(page, 'createTeamInvite', { email: REP.email, role: 'sales_rep' });
    expect(gated.ok, 'free-plan invite refused').toBe(false);
    expect(gated.message, 'refusal names the upgrade path').toMatch(/growth plan/i);

    // Upgrade the tenant (admin stand-in for Stripe checkout, which cannot
    // be emulated — the webhook path has its own unit coverage).
    await db.doc(`subscriptions/${STRANGER.uid}`).set({
      plan: 'growth', status: 'active', source: 'e2e-stranger-upgrade',
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const invited = await callFromPage(page, 'createTeamInvite', { email: REP.email, role: 'sales_rep' });
    expect(invited.ok, `growth-plan invite succeeds (got: ${invited.message || ''})`).toBe(true);
    expect(invited.data && invited.data.invited).toBe(true);
    const memberRef = db.doc(`companies/${STRANGER.uid}/members/${REP.email}`);
    const member = (await memberRef.get()).data();
    expect(member && member.status, 'member doc written as invited').toBe('invited');

    // The rep follows the invite email's instructions: create an account
    // with this email. Fresh browser context = fresh device.
    const repContext = await browser.newContext();
    await installLocalSdkShim(repContext); // sandbox-only; no-op in CI
    const repPage = await repContext.newPage();
    try {
      await registerViaUi(repPage, {
        first: '[E2E] Rep', last: String(stamp),
        company: '', email: REP.email, password: REP.password,
      });
      await waitOnboardingReady(repPage, REP.email);
      REP.uid = (await auth.getUserByEmail(REP.email)).uid;

      // Step 2 of the email: "verify your email" — the admin nudge stands in
      // for the link click, and the page refreshes its token to carry it.
      await auth.updateUser(REP.uid, { emailVerified: true });
      await repPage.evaluate(async () => {
        const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
        await m.getAuth().currentUser.getIdToken(true);
      });

      // Step 3: open the dashboard — claimInvite runs on first load and
      // reboots the page into team scope.
      await repPage.click('[data-action="skip"]');
      await repPage.waitForURL(/\/pro\/dashboard(\.html)?([?#]|$)/, { timeout: 30_000 });

      const activated = await eventually(async () => {
        const m = (await memberRef.get()).data();
        return m && m.status === 'active' ? m : null;
      }, { label: 'member doc flips to active via claimInvite', timeout: 60_000 });
      expect(activated.uid, 'member doc records the claiming uid').toBe(REP.uid);
      expect(activated.activatedVia).toBe('claimInvite-v1');

      // Claims re-pointed to the team; the rep's register-time solo tenant is
      // absorbed, not deleted.
      const repUser = await auth.getUser(REP.uid);
      expect((repUser.customClaims || {}).companyId, 'rep claims re-pointed to the tenant').toBe(STRANGER.uid);
      expect((repUser.customClaims || {}).role).toBe('sales_rep');
      const repSolo = (await db.doc(`companies/${REP.uid}`).get()).data();
      expect(repSolo && repSolo.status, 'rep solo tenant superseded-by-invite').toBe('superseded-by-invite');
      expect(repSolo && repSolo.supersededBy).toBe(STRANGER.uid);
    } finally {
      await repContext.close();
    }
  });

  test('isolation: neither tenant can read the other\'s leads', async ({ page, browser }) => {
    expect(STRANGER.uid, 'provision test must have run').toBeTruthy();
    const { db, auth, FieldValue } = admin();

    // A lead each side, admin-written so this test is self-contained.
    const nbdEmail = process.env.PLAYWRIGHT_TEST_USER_EMAIL || 'playwright-e2e@nbd.test';
    const nbdUid = (await auth.getUserByEmail(nbdEmail)).uid;
    const nbdLeadRef = db.doc(`leads/e2e-iso-nbd-${stamp}`);
    await nbdLeadRef.set({
      firstName: '[E2E] NBD', lastName: `Iso${stamp}`,
      userId: nbdUid, companyId: nbdUid, stage: 'new',
      e2eTestData: true, createdAt: FieldValue.serverTimestamp(),
    });
    const strangerLead = (await db.collection('leads')
      .where('lastName', '==', LEAD_LAST).limit(1).get()).docs[0];

    const probeReadOnce = async (p, leadId) => p.evaluate(async (id) => {
      const fs = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      try {
        const snap = await fs.getDoc(fs.doc(window.db || window._db, 'leads', id));
        return { denied: false, exists: snap.exists() };
      } catch (e) {
        const err = String((e && (e.code || e.message)) || e);
        return { denied: /permission|insufficient/i.test(err), err };
      }
    }, leadId);
    // The Java Firestore emulator intermittently drops reads ("client is
    // offline" — the documented flake class behind the CI shard split).
    // Retry NON-permission errors a few times so a dropped read doesn't
    // masquerade as an isolation verdict either way.
    const probeRead = async (p, leadId) => {
      let last;
      for (let i = 0; i < 3; i++) {
        last = await probeReadOnce(p, leadId);
        if (last.denied || last.exists !== undefined) return last;
        await new Promise((r) => setTimeout(r, 2_000));
      }
      return last;
    };

    // The stranger cannot read NBD's lead…
    await loginAs(page, { email: STRANGER.email, password: STRANGER.password });
    await page.waitForFunction(() => window._user && window._user.uid, null, { timeout: 20_000 });
    const strangerProbe = await probeRead(page, `e2e-iso-nbd-${stamp}`);
    expect(strangerProbe.denied, 'stranger blocked from NBD lead').toBe(true);

    // …and the seeded NBD tenant cannot read the stranger's.
    const nbdContext = await browser.newContext();
    await installLocalSdkShim(nbdContext); // sandbox-only; no-op in CI
    const nbdPage = await nbdContext.newPage();
    try {
      await loginAs(nbdPage, { email: nbdEmail, password: process.env.PLAYWRIGHT_TEST_USER_PASSWORD || 'nbd-e2e-password-1' });
      await nbdPage.waitForFunction(() => window._user && window._user.uid, null, { timeout: 20_000 });
      const nbdProbe = await probeRead(nbdPage, strangerLead.id);
      expect(nbdProbe.denied, 'NBD tenant blocked from stranger lead').toBe(true);
      // Sanity: the deny is scoping, not a broken session — NBD reads its OWN lead fine.
      const own = await probeRead(nbdPage, `e2e-iso-nbd-${stamp}`);
      expect(own.denied, `NBD reads its own lead (err: ${own.err || 'none'})`).toBe(false);
      expect(own.exists, `own lead readable (err: ${own.err || 'none'})`).toBe(true);
    } finally {
      await nbdContext.close();
    }
  });
});
