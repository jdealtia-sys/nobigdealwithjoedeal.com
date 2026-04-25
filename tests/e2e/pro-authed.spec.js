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
    expect(page.url()).toContain('/pro/dashboard.html');

    // Kanban container loads via crm.js. Selector audited 2026-04-25:
    // #crm-board is the top-level kanban wrapper rendered post-login.
    // Fall back to any "crm" or "kanban" id if the selector drifts.
    const kanban = page.locator('#crm-board, #crm-kanban, [data-view="crm"]').first();
    await expect(kanban).toBeVisible({ timeout: 15_000 });

    // Sanity: no hard runtime errors during the dashboard's first paint.
    // Allow CSP Report-Only + Service Worker registration warnings — those
    // are expected on first visit and don't break the app.
    const hard = consoleErrors.filter(e =>
      !/Report Only|favicon|Service Worker registration|chrome-extension/i.test(e)
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
    expect(page.url(), 'auth-restore must keep us on dashboard, not /login').toContain('/pro/dashboard.html');
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
    await loginAs(page, creds);

    // Wait for the kanban to render before opening a modal — opening
    // before the page is hydrated can race against module load order.
    await expect(page.locator('#crm-board, #crm-kanban').first()).toBeVisible({ timeout: 15_000 });

    // Tag with a fixed prefix per session so cleanup can reliably
    // find every test lead even if a test crashes mid-write.
    const stamp = Date.now();
    const leadName = `[E2E] Smith ${stamp}`;
    const leadAddress = '999 E2E Test Lane, Cincinnati, OH';

    // Open the new-lead modal via the canonical button. Selector
    // audited 2026-04-25: dashboard.html:8411 has the orange button
    // with onclick="openLeadModal()".
    await page.evaluate(() => { window.openLeadModal && window.openLeadModal(); });

    await page.fill('#lFname', '[E2E] Smith');
    await page.fill('#lLname', String(stamp));
    await page.fill('#lAddr', leadAddress);
    await page.fill('#lPhone', '5135550199');
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
      phone: '5135550199',
      email: `e2e-${args.stamp}@nbd.test`,
      stage: 'new',
      e2eTestData: true
    }), { stamp, leadAddress });

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
      const snap = await fsMod.getDocs(
        fsMod.query(
          fsMod.collection(db, 'leads'),
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
    await loginAs(page, creds);
    await expect(page.locator('#crm-board, #crm-kanban').first()).toBeVisible({ timeout: 15_000 });

    const stamp = Date.now();

    // Seed a fresh lead in stage 'new', tagged for cleanup.
    const leadId = await page.evaluate(async (args) => {
      const ref = await window._saveLead({
        firstName: '[E2E] Move',
        lastName: String(args.stamp),
        address: '888 Stage-Move Way, Cincinnati, OH',
        phone: '5135550288',
        email: `e2e-move-${args.stamp}@nbd.test`,
        stage: 'new',
        e2eTestData: true
      });
      // _saveLead returns null on the geocoded path (it does its own
      // loadLeads refresh), so re-fetch by lastName to grab the id.
      const fsMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const db = window.db || window._db;
      const snap = await fsMod.getDocs(
        fsMod.query(
          fsMod.collection(db, 'leads'),
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
    // created in leads/{id}/notes (legacy) or leads/{id}/activity
    // (Rock 3 contract). Either is acceptable for now.
    const afterMove = await page.evaluate(async (id) => {
      const fsMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const db = window.db || window._db;
      const leadSnap = await fsMod.getDoc(fsMod.doc(db, 'leads', id));
      const lead = leadSnap.data();
      const notesSnap = await fsMod.getDocs(fsMod.collection(db, 'leads', id, 'notes'));
      const notes = []; notesSnap.forEach(n => notes.push(n.data()));
      return {
        stage: lead.stage,
        stageStartedAt: lead.stageStartedAt && lead.stageStartedAt.seconds,
        notesCount: notes.length,
        notesShapes: notes.map(n => ({ type: n.type || null, hasStageLabel: !!n.stageLabel }))
      };
    }, leadId);

    expect(afterMove.stage, 'stage moved to contacted').toBe('contacted');
    expect(afterMove.stageStartedAt, 'stageStartedAt is set').toBeTruthy();
    if (beforeMove.stageStartedAt && afterMove.stageStartedAt) {
      expect(afterMove.stageStartedAt, 'stageStartedAt updated').toBeGreaterThan(beforeMove.stageStartedAt);
    }
    expect(afterMove.notesCount, 'at least one timeline note created on move').toBeGreaterThan(0);
  });
});
