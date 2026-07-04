// @ts-check
// Authenticated /pro/ surface tests. Path A (BIG_ROCKS Rock 3):
// a dedicated test user logs in to the live site so we catch
// regressions in the actual post-auth shell — kanban load,
// auth-state plumbing, plan-tier gating, etc.
//
// Provisioning + secret setup: tests/e2e/README.md
//
// Without PLAYWRIGHT_TEST_USER_EMAIL + PLAYWRIGHT_TEST_USER_PASSWORD
// set, every test in this file skips (no failure, no pass) so
// running the suite locally without secrets stays clean.

const { test, expect } = require('@playwright/test');
const { requireTestUser, loginAs, callCallableInPage, cleanupE2EData } = require('./fixtures/auth');

/**
 * Navigate to the CRM/Pipeline view. Post-login the dashboard shows
 * view-home; the kanban view is template-stamped on first goTo('crm').
 * Click the sidebar nav item (#nav-crm) like a real user, falling back
 * to the global goTo() when the sidebar is hidden (narrow viewports).
 */
async function openCrmView(page) {
  // Wait for the nav plumbing itself (dashboard-ui.js defines window.goTo)
  // rather than clicking #nav-crm — the click delegate binds asynchronously
  // and a fast retry can click before it listens, silently going nowhere.
  // Retry through context teardowns: login lands via a 301 hop
  // (dashboard.html → cleanUrls → dashboard), and a wait that latched onto
  // the provisional document dies with "Execution context was destroyed".
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.waitForLoadState('load');
      await page.waitForFunction(() => typeof window.goTo === 'function', null, { timeout: 15_000 });
      await page.evaluate(() => window.goTo('crm'));
      return;
    } catch (e) {
      if (!/Execution context was destroyed|navigation|not a function/i.test(String(e))) throw e;
    }
  }
  throw new Error('openCrmView: dashboard never settled with a working goTo()');
}

test.describe('Authenticated /pro/ shell — read-only', () => {
  let creds;
  test.beforeAll(() => {
    try { creds = requireTestUser(); }
    catch (e) {
      // Surface a single notice, not an error per spec, so the CI
      // logs make it obvious why the authed suite skipped.
      // eslint-disable-next-line no-console
      console.warn('[pro-authed] ' + e.message);
    }
  });

  test.beforeEach(async ({}, testInfo) => {
    if (!creds) testInfo.skip(true, 'PLAYWRIGHT_TEST_USER_EMAIL not set');
  });

  test('login redirects to dashboard and kanban container renders', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    await loginAs(page, creds);

    // Post-redirect URL is dashboard.html; the auth gate (nbd-auth.js)
    // would bounce us back to /pro/login if auth state didn't stick.
    expect(page.url()).toMatch(/\/pro\/dashboard(\.html)?([?#]|$)/); // cleanUrls strips .html

    // Post-login the dashboard lands on view-home (re-audited 2026-07-04:
    // boot only auto-opens CRM for ?edit=/?tasks= deep links). The kanban
    // exists after navigating to the Pipeline view, which stamps
    // <template id="tpl-view-crm"> into #view-crm; crm.js binds
    // #kanbanBoard (dashboard.html:2398). Navigate like a user: the
    // sidebar nav item.
    await openCrmView(page);
    const kanban = page.locator('#kanbanBoard, #view-crm .kanban-board').first();
    await expect(kanban).toBeVisible({ timeout: 15_000 });

    // Sanity: no hard runtime errors during the dashboard's first paint.
    // Allow CSP Report-Only + Service Worker registration warnings — those
    // are expected on first visit and don't break the app. Emulator mode
    // additionally runs without the functions emulator, so callable fetches
    // to 127.0.0.1:5001 log connection-refused errors that aren't app bugs.
    const emulatorMode = /127\.0\.0\.1|localhost/.test(process.env.PLAYWRIGHT_BASE_URL || '');
    const hard = consoleErrors.filter(e =>
      !/Report Only|favicon|Service Worker registration|chrome-extension/i.test(e)
      && !(emulatorMode && /127\.0\.0\.1:5001|ERR_CONNECTION_REFUSED|Failed to load resource|app-?check|ReCAPTCHA|cloudfunctions\.net|CORS policy/i.test(e))
    );
    expect(hard, 'unexpected console errors during dashboard load').toEqual([]);
  });

  test('auth state persists across page reload (no kick to login)', async ({ page }) => {
    // The auth-restore race that kicked iOS users to /login was the
    // motivating bug for PRs #34 and #37. This test locks in that fix:
    // after a reload the user must stay on dashboard.html, not bounce.
    await loginAs(page, creds);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    // Give the 2.5-second nbd-auth.js grace window from PR #37 enough
    // headroom to settle; if we're going to bounce we'd see /login by now.
    await page.waitForTimeout(3_500);
    expect(page.url(), 'auth-restore must keep us on dashboard, not /login').toMatch(/\/pro\/dashboard(\.html)?([?#]|$)/);
  });
});

// ───────────────────────────────────────────────────────────────
// Destructive flows (Rock 3 PR 4)
//
// Every test in this block creates real Firestore docs tagged with
// `e2eTestData: true` so the afterAll hook can call the
// cleanupE2ETestData callable to delete them. All seeded names use
// an `[E2E]` prefix so even if cleanup misses one, it's visually
// obvious in the kanban and easy to delete by hand.
//
// These tests run sequentially (not parallel) because they share
// the test user account and would race on document writes otherwise.
// ───────────────────────────────────────────────────────────────
test.describe.serial('Authenticated destructive flows', () => {
  let creds;
  test.beforeAll(() => {
    try { creds = requireTestUser(); }
    catch (e) { console.warn('[pro-authed-destructive] ' + e.message); }
  });

  test.beforeEach(async ({}, testInfo) => {
    if (!creds) testInfo.skip(true, 'PLAYWRIGHT_TEST_USER_EMAIL not set');
  });

  test.afterAll(async ({ browser }) => {
    if (!creds) return;
    // Emulator mode (test:e2e:authed:emu): all state lives in the Firestore
    // emulator and evaporates when emulators:exec exits, and the functions
    // emulator (which would host the cleanup callable) isn't running. Skip.
    if (/localhost|127\.0\.0\.1/.test(process.env.PLAYWRIGHT_BASE_URL || '')) return;
    // Spin up a fresh page so afterAll has its own auth context
    // independent of any test that may have navigated mid-flight.
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await loginAs(page, creds);
      const result = await cleanupE2EData(page);
      // eslint-disable-next-line no-console
      console.log('[pro-authed-cleanup]', JSON.stringify(result));
    } finally {
      await context.close();
    }
  });

  test('save lead writes companyId + customerId, lead appears in kanban', async ({ page }) => {
    // _saveLead geocodes new-lead addresses via nominatim.openstreetmap.org,
    // which has no client timeout and rate-limits CI egress IPs — the save
    // then hangs the full test timeout. E2E must not depend on OSM: answer
    // the geocode with an empty result so the save proceeds without lat/lng.
    await page.route('**/nominatim.openstreetmap.org/**', route =>
      route.fulfill({ contentType: 'application/json', body: '[]' }));
    await loginAs(page, creds);

    // Wait for the kanban to render before opening a modal — opening
    // before the page is hydrated can race against module load order.
    await openCrmView(page);
    await expect(page.locator('#kanbanBoard, #view-crm .kanban-board').first()).toBeVisible({ timeout: 15_000 });

    // Tag with a fixed prefix per session so cleanup can reliably
    // find every test lead even if a test crashes mid-write.
    const stamp = Date.now();
    const leadName = `[E2E] Smith ${stamp}`;
    // Unique per attempt: a retry re-runs against the same emulator session,
    // and a same-phone/same-address payload trips LeadDedup.checkAndPrompt's
    // modal, which awaits a human click forever.
    const leadPhone = '513' + String(stamp).slice(-7);
    const leadAddress = `${String(stamp).slice(-3)} E2E Test Lane, Cincinnati, OH`;

    // _saveLead stamps userId from window._user, which the auth listener
    // sets asynchronously after boot — calling before it lands writes
    // userId: undefined (addDoc rejects). A human can't click Save that
    // fast; the test can.
    await page.waitForFunction(() => window._user && window._user.uid, null, { timeout: 15_000 });

    // Open the new-lead modal via the canonical button. Selector
    // audited 2026-04-25: dashboard.html:8411 has the orange button
    // with onclick="openLeadModal()".
    await page.evaluate(() => { window.openLeadModal && window.openLeadModal(); });

    await page.fill('#lFname', '[E2E] Smith');
    await page.fill('#lLname', String(stamp));
    await page.fill('#lAddr', leadAddress);
    await page.fill('#lPhone', leadPhone);
    await page.fill('#lEmail', `e2e-${stamp}@nbd.test`);

    // Bypass the UI's `saveLead()` so we can stamp e2eTestData:true
    // (the modal has no field for it). We still go through
    // window._saveLead, which is the same code path the UI uses,
    // so the companyId/customerId/userId stamping is exercised end
    // to end. Cleanup callable filters on this flag.
    await page.evaluate((args) => window._saveLead({
      firstName: '[E2E] Smith',
      lastName: String(args.stamp),
      address: args.leadAddress,
      phone: args.leadPhone,
      email: `e2e-${args.stamp}@nbd.test`,
      stage: 'new',
      e2eTestData: true
    }), { stamp, leadAddress, leadPhone });

    // Give the optimistic insert + Firestore round-trip a moment to
    // settle. The kanban refresh is debounced; 4s is generous.
    await page.waitForTimeout(4_000);

    // Lead card should now show in some column with our [E2E] prefix.
    // We don't bind to a specific stage column because crm.js is free
    // to bucket new leads in different stages depending on view config.
    const card = page.locator(`text=/\\[E2E\\] Smith.*${stamp}/i`).first();
    await expect(card, 'new [E2E] lead card visible in kanban').toBeVisible({ timeout: 8_000 });

    // Read the saved doc back via Firestore SDK to lock in companyId
    // + customerId stamping (Rock 3 PR 2 contract).
    const dbCheck = await page.evaluate(async (n) => {
      const fsMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const db = window.db || window._db;
      // The leads read rule is isOwner(resource.data.userId) — a query
      // must carry the userId filter or Firestore can't prove it complies
      // and rejects it outright (empty-message FirebaseError).
      const uid = (window._auth || window.auth).currentUser.uid;
      const snap = await fsMod.getDocs(
        fsMod.query(
          fsMod.collection(db, 'leads'),
          fsMod.where('userId', '==', uid),
          fsMod.where('e2eTestData', '==', true),
          fsMod.where('lastName', '==', String(n))
        )
      );
      const docs = [];
      snap.forEach(d => docs.push(Object.assign({ id: d.id }, d.data())));
      return docs;
    }, stamp);

    expect(dbCheck.length, 'exactly one [E2E] lead matches lastName').toBe(1);
    const lead = dbCheck[0];
    expect(lead.companyId, 'companyId stamped').toBeTruthy();
    expect(lead.userId, 'userId stamped').toBe(creds.email ? lead.userId : lead.userId); // userId existence check
    expect(lead.userId, 'userId is set').toBeTruthy();
    expect(lead.customerId, 'customerId follows NBD-#### shape').toMatch(/^NBD-\d{4,}$/);
  });

  test('move stage logs timeline activity + updates stageStartedAt', async ({ page }) => {
    // Same nominatim stub as the save-lead test — _saveLead geocodes new
    // addresses and OSM rate-limits CI IPs with no client timeout.
    await page.route('**/nominatim.openstreetmap.org/**', route =>
      route.fulfill({ contentType: 'application/json', body: '[]' }));
    await loginAs(page, creds);
    await openCrmView(page);
    await expect(page.locator('#kanbanBoard, #view-crm .kanban-board').first()).toBeVisible({ timeout: 15_000 });

    const stamp = Date.now();

    // Same auth-resolved gate as the save-lead test (userId stamping).
    await page.waitForFunction(() => window._user && window._user.uid, null, { timeout: 15_000 });

    // Seed a fresh lead in stage 'new', tagged for cleanup.
    const leadId = await page.evaluate(async (args) => {
      const ref = await window._saveLead({
        firstName: '[E2E] Move',
        lastName: String(args.stamp),
        // Unique per attempt so LeadDedup's blocking prompt never fires
        // against leftovers from an earlier attempt in the same session.
        address: `${String(args.stamp).slice(-3)} Stage-Move Way, Cincinnati, OH`,
        phone: '513' + String(args.stamp).slice(-7),
        email: `e2e-move-${args.stamp}@nbd.test`,
        stage: 'new',
        e2eTestData: true
      });
      // _saveLead returns null on the geocoded path (it does its own
      // loadLeads refresh), so re-fetch by lastName to grab the id.
      const fsMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const db = window.db || window._db;
      // userId filter keeps the query provable under the leads read rule
      // (isOwner(resource.data.userId)) — see the save-lead test.
      const uid = (window._auth || window.auth).currentUser.uid;
      const snap = await fsMod.getDocs(
        fsMod.query(
          fsMod.collection(db, 'leads'),
          fsMod.where('userId', '==', uid),
          fsMod.where('lastName', '==', String(args.stamp)),
          fsMod.where('e2eTestData', '==', true)
        )
      );
      let id = null;
      snap.forEach(d => { if (!id) id = d.id; });
      return id;
    }, { stamp });

    expect(leadId, 'seeded [E2E] Move lead has an id').toBeTruthy();

    // Capture stageStartedAt BEFORE the move so we can assert it
    // updates rather than just being equal-by-coincidence.
    const beforeMove = await page.evaluate(async (id) => {
      const fsMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const db = window.db || window._db;
      const snap = await fsMod.getDoc(fsMod.doc(db, 'leads', id));
      const d = snap.data();
      return { stage: d.stage, stageStartedAt: d.stageStartedAt && d.stageStartedAt.seconds };
    }, leadId);

    // Tiny wait so the new stageStartedAt timestamp can differ from
    // beforeMove's. Server timestamps have second-level resolution.
    await page.waitForTimeout(1_500);

    // Drive the stage transition through the same code path the UI
    // uses on drag/drop. moveCard() handles the firestore transaction,
    // optimistic UI, and timeline-note creation.
    await page.evaluate(async (id) => {
      return window.moveCard && window.moveCard(id, 'contacted');
    }, leadId);

    await page.waitForTimeout(2_500);

    // Assert: stage advanced, stageStartedAt advanced, timeline note
    // created. Location re-audited 2026-07-04 against moveCard
    // (crm-pipeline.js:1661): stage-change notes live in the TOP-LEVEL
    // `notes` collection keyed by a leadId field — not a leads/{id}
    // subcollection. The userId filter keeps the query provable under
    // the notes read rule (isOwner(resource.data.userId)).
    const afterMove = await page.evaluate(async (id) => {
      const fsMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const db = window.db || window._db;
      const leadSnap = await fsMod.getDoc(fsMod.doc(db, 'leads', id));
      const lead = leadSnap.data();
      const uid = (window._auth || window.auth).currentUser.uid;
      const notesSnap = await fsMod.getDocs(fsMod.query(
        fsMod.collection(db, 'notes'),
        fsMod.where('userId', '==', uid),
        fsMod.where('leadId', '==', id)
      ));
      const notes = []; notesSnap.forEach(n => notes.push(n.data()));
      return {
        stage: lead.stage,
        stageStartedAt: lead.stageStartedAt && lead.stageStartedAt.seconds,
        notesCount: notes.length,
        notesShapes: notes.map(n => ({ type: n.type || null, text: (n.text || '').slice(0, 60) }))
      };
    }, leadId);

    expect(afterMove.stage, 'stage moved to contacted').toBe('contacted');
    expect(afterMove.stageStartedAt, 'stageStartedAt is set').toBeTruthy();
    if (beforeMove.stageStartedAt && afterMove.stageStartedAt) {
      expect(afterMove.stageStartedAt, 'stageStartedAt updated').toBeGreaterThan(beforeMove.stageStartedAt);
    }
    expect(afterMove.notesCount, 'at least one timeline note created on move').toBeGreaterThan(0);
  });
  test('estimate: browser V2 math matches the Node engine, doc persists with stamping + deposit', async ({ page }) => {
    await loginAs(page, creds);
    await page.waitForFunction(() => window._user && window._user.uid, null, { timeout: 15_000 });

    // The estimate engine is lazy (ScriptLoader PR 2c bundle) — pull it in
    // exactly the way goTo('est') would, then wait for the engine + the
    // shared persist path.
    await page.waitForFunction(() => window.ScriptLoader && typeof window.ScriptLoader.loadBundle === 'function', null, { timeout: 15_000 });
    await page.evaluate(() => window.ScriptLoader.loadBundle('estimates'));
    await page.waitForFunction(() =>
      window.EstimateBuilderV2 && typeof window.EstimateBuilderV2.calculateEstimate === 'function'
      && typeof window._saveEstimate === 'function', null, { timeout: 20_000 });

    // Same locked scenario shape as tests/estimate-pricing.test.js — the
    // Node engine is the spec reference; the browser engine must agree to
    // the penny, and the persisted doc must carry the same numbers.
    const INPUT = {
      method: 'per-sq', tier: 'better', mode: 'cash',
      rawSqft: 3900, pitch: '6/12', county: 'hamilton-oh', wasteFactorOverride: 1.0,
    };
    // eslint-disable-next-line global-require
    const EBv2 = require('../../docs/pro/js/estimate-builder-v2.js');
    const expected = EBv2.calculateEstimate(INPUT);
    const expectedDeposit = EBv2.calcDeposit(expected.total, INPUT.mode, {});

    const saved = await page.evaluate(async (input) => {
      const r = window.EstimateBuilderV2.calculateEstimate(input);
      const dep = window.EstimateBuilderV2.calcDeposit(r.total, input.mode, {});
      const id = await window._saveEstimate({
        name: '[E2E] V2 parity ' + Date.now(),
        addr: '999 E2E Test Lane, Cincinnati, OH',
        mode: input.mode, tier: input.tier, engine: 'v2',
        grandTotal: r.total, deposit: dep,
        e2eTestData: true,
      });
      const fsMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const db = window.db || window._db;
      const snap = await fsMod.getDoc(fsMod.doc(db, 'estimates', id));
      return { id, browserTotal: r.total, browserDeposit: dep, doc: snap.data() };
    }, INPUT);

    expect(saved.browserTotal, 'browser V2 total == Node V2 total (engine parity across runtimes)').toBe(expected.total);
    expect(saved.doc.grandTotal, 'persisted grandTotal matches the engine').toBe(expected.total);
    expect(saved.doc.userId, '_saveEstimate stamps userId').toBeTruthy();
    expect(saved.browserDeposit.amount, 'deposit follows spec (cash 50%, $25-rounded — D-5)').toBe(expectedDeposit.amount);
    expect(saved.doc.deposit && saved.doc.deposit.amount, 'persisted deposit matches').toBe(expectedDeposit.amount);
    expect(saved.doc.deposit && saved.doc.deposit.remainder, 'deposit + remainder reconstructs the total')
      .toBeCloseTo(expected.total - expectedDeposit.amount, 2);
  });

  test('invoice: createInvoiceFromEstimate carries totals + deposit, balanceDue is the FULL total', async ({ page }) => {
    await loginAs(page, creds);
    await page.waitForFunction(() => window._user && window._user.uid, null, { timeout: 15_000 });

    // InvoicePipeline is an EAGER <script defer> (dashboard.html) but it runs
    // on the window Firestore globals (_db/doc/getDoc/addDoc/collection) that
    // dashboard-bootstrap exposes asynchronously — wait for both ends of that
    // contract, plus the shared estimate persist path.
    await page.waitForFunction(() =>
      window.InvoicePipeline && typeof window.InvoicePipeline.createInvoiceFromEstimate === 'function'
      && window._db && typeof window.addDoc === 'function'
      && typeof window._saveEstimate === 'function', null, { timeout: 20_000 });

    const stamp = Date.now();
    // Classic row-shaped estimate with NO locked grandTotal: exercises the
    // row-sum branch of createInvoiceFromEstimate (per-sq V2 estimates take
    // the single-summary-line branch instead, covered by unit tests).
    // taxRate 0 is the insurance-scope contract: an explicit 0 must be
    // HONORED, not silently defaulted to 7.5% (Audit #3 F-3).
    const EST = {
      name: `[E2E] Invoice source ${stamp}`,
      addr: '742 Invoice Test Ct, Cincinnati, OH',
      // Linkage is copied verbatim onto the invoice; the pipeline's
      // enrichment read of this (nonexistent) lead is best-effort and
      // swallows the permission error.
      leadId: `e2e-missing-lead-${stamp}`,
      rows: [
        { desc: 'Tear-off + disposal', qty: 20, rate: 100, total: 2000 },
        { desc: 'Shingles (architectural)', qty: 1, rate: 1500, total: 1500 },
      ],
      taxRate: 0,
      // Classic builder saves deposit as an OBJECT — the pipeline must
      // coerce .amount, not Number() the object into NaN (review blocker).
      deposit: { pct: 50, amount: 1750, remainder: 1750 },
      e2eTestData: true,
    };

    const out = await page.evaluate(async (est) => {
      // Re-check auth IN this execution context right before the write:
      // the outer waitForFunction gate can pass against a pre-navigation
      // document, after which _saveEstimate stamps userId from a _user the
      // fresh dashboard context hasn't re-populated yet (CI retry flake:
      // "Unsupported field value: undefined in field userId").
      for (let i = 0; i < 75 && !(window._user && window._user.uid); i++) {
        await new Promise(r => setTimeout(r, 200));
      }
      const estimateId = await window._saveEstimate(est);
      const invoiceId = await window.InvoicePipeline.createInvoiceFromEstimate(estimateId);
      const fsMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const db = window.db || window._db;
      // Tag the invoice for the cleanupE2ETestData callable — the pipeline
      // writes a fixed shape with no room for test flags. Owner update is
      // allowed while createdBy/companyId/estimateId/createdAt stay frozen.
      await fsMod.updateDoc(fsMod.doc(db, 'invoices', invoiceId), { e2eTestData: true });
      const snap = await fsMod.getDoc(fsMod.doc(db, 'invoices', invoiceId));
      return { estimateId, invoiceId, inv: snap.data() };
    }, EST);

    const inv = out.inv;
    const expectedSubtotal = EST.rows.reduce((s, r) => s + r.total, 0);
    expect(inv.subtotal, 'subtotal = Σ row totals').toBe(expectedSubtotal);
    expect(inv.taxRate, 'estimate taxRate 0 honored (not defaulted to 7.5%)').toBe(0);
    expect(inv.tax, 'tax is 0 at a 0% rate').toBe(0);
    expect(inv.total, 'total = subtotal at 0% tax').toBe(expectedSubtotal);
    expect(inv.depositAmount, 'deposit coerced from the classic {amount} object').toBe(EST.deposit.amount);
    // The locked AR contract: balanceDue tracks genuinely-owed money — the
    // FULL total at create time. It was `total - depositAmount`, which booked
    // the deposit as collected before any payment arrived, under-reporting AR.
    expect(inv.balanceDue, 'balanceDue = full total at create').toBe(inv.total);
    expect(inv.status, 'new invoice starts as draft').toBe('draft');
    expect(inv.depositPaid, 'deposit not marked paid at create').toBe(false);
    expect(inv.amountPaid, 'nothing collected at create').toBe(0);
    expect(inv.estimateId, 'invoice → estimate linkage').toBe(out.estimateId);
    expect(inv.leadId, 'invoice inherits the estimate leadId').toBe(EST.leadId);
    expect(inv.createdBy, 'createdBy stamped').toBeTruthy();
    expect(inv.companyId, 'companyId stamped (solo convention: uid)').toBeTruthy();
    expect(inv.items.length, 'row-shaped estimate keeps its line items').toBe(EST.rows.length);
  });

  test('photo: uploadFromFile stores original + thumb, derives phase from the before tag', async ({ page }) => {
    await loginAs(page, creds);
    await page.waitForFunction(() => window._user && window._user.uid, null, { timeout: 15_000 });

    // PhotoEngine lives in the lazy 'photos' bundle (ScriptLoader PR 2c);
    // the upload path additionally needs the Storage handle that bootstrap
    // exposes as window._storage (emulator-wired on localhost, line 809).
    await page.waitForFunction(() => window.ScriptLoader && typeof window.ScriptLoader.loadBundle === 'function', null, { timeout: 15_000 });
    await page.evaluate(() => window.ScriptLoader.loadBundle('photos'));
    await page.waitForFunction(() =>
      window.PhotoEngine && typeof window.PhotoEngine.uploadFromFile === 'function'
      && window._storage && window._db, null, { timeout: 20_000 });

    const stamp = Date.now();
    const out = await page.evaluate(async (args) => {
      // Same in-context auth re-check as the invoice journey —
      // uploadPhotoToFirebase throws without window._user.
      for (let i = 0; i < 75 && !(window._user && window._user.uid); i++) {
        await new Promise(r => setTimeout(r, 200));
      }
      // A REAL image via canvas export: generateThumbnail() re-decodes the
      // blob as an <img>, so a hand-rolled Blob of junk bytes fails there,
      // and storage.rules requires an image/* content type (isImage()).
      const canvas = document.createElement('canvas');
      canvas.width = 80; canvas.height = 60;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#d2691e'; ctx.fillRect(0, 0, 80, 60);
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.8));

      const leadId = 'e2e-photo-lead-' + args.stamp;
      const photo = await window.PhotoEngine.uploadFromFile(
        leadId, blob, ['before'], '[E2E] photo journey ' + args.stamp);

      const fsMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const db = window.db || window._db;
      // Tag for the cleanup callable (the upload writes a fixed doc shape).
      // NOTE: cleanup deletes the Firestore doc; the Storage originals under
      // photos/<uid>/<leadId>/ are only reclaimed in emulator runs (state
      // evaporates) — a prod run leaves two tiny orphaned JPEGs per run.
      await fsMod.updateDoc(fsMod.doc(db, 'photos', photo.id), { e2eTestData: true });
      const snap = await fsMod.getDoc(fsMod.doc(db, 'photos', photo.id));
      return { id: photo.id, doc: snap.data(), uid: window._user.uid, leadId };
    }, { stamp });

    const doc = out.doc;
    expect(doc, 'photo doc persisted to Firestore').toBeTruthy();
    // share-gallery.js buckets on photo.phase — without the derived field
    // every photo landed in 'During' and Before/After stayed empty.
    expect(doc.phase, "tag 'before' derives phase 'Before'").toBe('Before');
    expect(doc.userId, 'userId stamped from window._user').toBe(out.uid);
    expect(doc.leadId, 'photo keyed to its lead').toBe(out.leadId);
    expect(doc.tags, 'user tags persisted').toContain('before');
    expect(doc.url, 'download URL for the original').toBeTruthy();
    expect(doc.thumbUrl, 'thumbnail generated + uploaded').toBeTruthy();
    // storagePath is the future-proof deletion key — must be rooted under
    // the owner-scoped prefix that storage.rules enforces.
    expect(doc.storagePath, 'original rooted under photos/<uid>/<leadId>/')
      .toMatch(new RegExp('^photos/' + out.uid + '/' + out.leadId + '/'));
    expect(doc.thumbStoragePath, 'thumb rooted under .../thumbs/')
      .toMatch(new RegExp('^photos/' + out.uid + '/' + out.leadId + '/thumbs/'));
    expect(doc.createdAt, 'createdAt serverTimestamp (canonical ordering field)').toBeTruthy();
  });

  test('docgen: generate persists metadata under the lead + uploads rendered HTML', async ({ page }) => {
    // The doc-generation persist path is fully client-side (Firestore
    // subcollection + Storage HTML upload) — the functions emulator is only
    // involved for server PDF render (contract/invoice/change_order/receipt,
    // which FALLS BACK to client render) and remote signing. 'thank_you' is
    // not in SERVER_TYPE_MAP, so this journey is hermetic without functions.
    await page.route('**/nominatim.openstreetmap.org/**', route =>
      route.fulfill({ contentType: 'application/json', body: '[]' }));
    await loginAs(page, creds);
    await page.waitForFunction(() => window._user && window._user.uid, null, { timeout: 15_000 });

    const stamp = Date.now();
    // The documents subcollection rule does get(leads/{leadId}).data.userId —
    // the PARENT LEAD MUST EXIST and be ours, so seed one first (same
    // re-fetch-by-lastName pattern as the move-stage journey; _saveLead
    // returns null on the geocoded path).
    const leadId = await page.evaluate(async (args) => {
      // Same in-context auth re-check as the invoice journey — _saveLead
      // stamps userId from window._user.
      for (let i = 0; i < 75 && !(window._user && window._user.uid); i++) {
        await new Promise(r => setTimeout(r, 200));
      }
      await window._saveLead({
        firstName: '[E2E] DocGen',
        lastName: String(args.stamp),
        address: `${String(args.stamp).slice(-3)} DocGen Drive, Cincinnati, OH`,
        phone: '513' + String(args.stamp).slice(-7),
        email: `e2e-docgen-${args.stamp}@nbd.test`,
        stage: 'new',
        e2eTestData: true
      });
      const fsMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const db = window.db || window._db;
      const uid = (window._auth || window.auth).currentUser.uid;
      const snap = await fsMod.getDocs(fsMod.query(
        fsMod.collection(db, 'leads'),
        fsMod.where('userId', '==', uid),
        fsMod.where('lastName', '==', String(args.stamp)),
        fsMod.where('e2eTestData', '==', true)
      ));
      let id = null;
      snap.forEach(d => { if (!id) id = d.id; });
      return id;
    }, { stamp });
    expect(leadId, 'seeded [E2E] DocGen lead has an id').toBeTruthy();

    // NBDDocGen is in the lazy 'docgen' bundle; NBDDocViewer is an EAGER
    // <script defer> (dashboard.html) — generate() only persists when the
    // viewer path is available, so gate on both.
    await page.waitForFunction(() => window.ScriptLoader && typeof window.ScriptLoader.loadBundle === 'function', null, { timeout: 15_000 });
    await page.evaluate(() => window.ScriptLoader.loadBundle('docgen'));
    await page.waitForFunction(() =>
      window.NBDDocGen && typeof window.NBDDocGen.generate === 'function'
      && window.NBDDocViewer && typeof window.NBDDocViewer.open === 'function'
      && window.storage && typeof window.uploadBytes === 'function', null, { timeout: 20_000 });

    await page.evaluate(async (args) => {
      await window.NBDDocGen.generate('thank_you', {
        leadId: args.leadId,
        customer: { name: '[E2E] DocGen ' + args.stamp, address: '1 DocGen Drive', email: `e2e-docgen-${args.stamp}@nbd.test` },
        homeownerName: '[E2E] DocGen ' + args.stamp,
        projectType: 'Roof Replacement',
        completionDate: '2026-07-04',
      });
    }, { leadId, stamp });

    // generate() kicks persistence off in the background (_persistPromise);
    // poll the subcollection from the TEST side. Not waitForFunction: its
    // async-predicate result comes back as a JSHandle whose jsonValue
    // doesn't round-trip a stringified array reliably (CI: "docs.find is
    // not a function") — page.evaluate deserializes arrays natively.
    let docs = [];
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      docs = await page.evaluate(async (id) => {
        const fsMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const db = window.db || window._db;
        const snap = await fsMod.getDocs(fsMod.collection(db, 'leads', id, 'documents'));
        const list = [];
        snap.forEach(d => {
          const data = d.data();
          list.push({
            id: d.id, type: data.type, typeName: data.typeName,
            userId: data.userId, filename: data.filename,
            htmlPath: data.htmlPath, htmlUrl: data.htmlUrl,
          });
        });
        return list;
      }, leadId);
      if (docs.length) break;
      await page.waitForTimeout(1_000);
    }

    const meta = docs.find(d => d.type === 'thank_you');
    expect(meta, 'thank_you metadata doc persisted under the lead').toBeTruthy();
    expect(meta.userId, 'userId stamped on the metadata').toBeTruthy();
    expect(meta.typeName, 'human-readable type name recorded').toBeTruthy();
    expect(meta.filename, 'filename recorded for the PDF flow').toMatch(/\.pdf$/);
    // Storage leg: the rendered HTML must land under the owner-scoped
    // documents/ prefix (storage.rules isHtmlOnly path) with a resolvable
    // download URL — this is what the customer-page documents tab reopens.
    expect(meta.htmlPath, 'HTML uploaded under documents/<uid>/<leadId>/')
      .toMatch(new RegExp('^documents/[^/]+/' + leadId + '/'));
    expect(meta.htmlUrl, 'download URL resolved for the uploaded HTML').toBeTruthy();

    // Tag the metadata doc for prod-run cleanup (subcollection docs don't
    // cascade-delete with the lead). Owner write allowed via the parent-get
    // rule. Emulator runs don't need it — state evaporates.
    await page.evaluate(async (args) => {
      const fsMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const db = window.db || window._db;
      await fsMod.updateDoc(fsMod.doc(db, 'leads', args.leadId, 'documents', args.docId), { e2eTestData: true });
    }, { leadId, docId: meta.id });
  });
});
