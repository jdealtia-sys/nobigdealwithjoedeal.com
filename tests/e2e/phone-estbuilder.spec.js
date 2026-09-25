// tests/e2e/phone-estbuilder.spec.js — the V2 estimate builder on a phone.
//
// Regression lane for the 2026-09-25 phone audit (estimate#2, #3, #4, #5, #6,
// #8, #12). Jo runs his roofing business from an Android at ~412px; the V2
// builder is where he prices a roof in the driveway. Every finding here was
// reproduced with real taps before it was fixed, and every assertion below
// checks what a thumb gets — hit-testing (document.elementFromPoint at the
// control's centre must land on the control) and real locator.tap() calls —
// not class names. The pipeline menus stayed "green" for months behind a test
// that only checked '.open'; don't write that test here.
//
//   estimate#2  every step opened with all sections collapsed (Setup = five
//               bare headers; Review hid the scope, total and Save)
//   estimate#3  price-adder checkboxes were 13x13 and their text not tappable
//   estimate#4  9px labels; grey "3900" placeholders read as entered values
//   estimate#5  Items category chips were 22px tall, wrapping into 3-4 rows
//   estimate#6  22px note button; × deleted a priced line with no undo;
//               quantity edits went through window.prompt (text keyboard)
//   estimate#8  reopening a saved estimate blanked the customer's phone and
//               email — the Retail Quote printed "—"
//   estimate#12 the dashboard showed through a short V2 step and the Job
//               Templates modal; the JT title was #fff on a cream header
//
// Cloud Functions are mocked (renderPdf → 500, so the quote renders through
// the local viewer and CI never calls production). One login per describe.
//
// Run locally against a served worktree + the emulators:
//   cd tests && PLAYWRIGHT_BASE_URL=http://127.0.0.1:5000 \
//     PLAYWRIGHT_TEST_USER_EMAIL=... PLAYWRIGHT_TEST_USER_PASSWORD=... \
//     npx playwright test --config=playwright.config.js phone-estbuilder.spec.js --workers=1
const { test, expect } = require('@playwright/test');
const { requireTestUser, loginAs, safeEvaluate, safeWaitForFunction } = require('./fixtures/auth');

const ANDROID = {
  isMobile: true,
  hasTouch: true,
  serviceWorkers: 'block',
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
};

let creds = null;
try { creds = requireTestUser(); } catch (_) { creds = null; }

// ── helpers ────────────────────────────────────────────────────────────────

async function signIn(page) {
  // _saveLead geocodes new addresses and OSM rate-limits CI IPs with no
  // client timeout; the quote's server render is a Cloud Function. Neither
  // is under test — keep both local and deterministic.
  await page.route('**/nominatim.openstreetmap.org/**', (r) =>
    r.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.route('**/renderPdf**', (r) =>
    r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"status":"INTERNAL","message":"mocked in phone-estbuilder.spec"}}' }));
  // The first-run tour mounts 1.5s after the dashboard and its overlay eats
  // taps; a one-shot "Skip tour" check races it. Mark it done up front
  // (onboarding-tour.js STORAGE_KEY).
  await page.addInitScript(() => { try { localStorage.setItem('nbd-onboarding-complete', '1'); } catch (e) { /* private mode */ } });
  await loginAs(page, creds);
  await safeWaitForFunction(page, () => !!(window._user && window._user.uid), { timeout: 20_000 });
  const skip = page.getByText('Skip tour', { exact: true });
  if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => {});
}

// Open the builder the way the customer page's "Build Estimate" does — the
// entry is not under test, the builder is.
async function openBuilder(page, arg) {
  await safeWaitForFunction(page, () => !!(window.ScriptLoader && typeof window.ScriptLoader.loadBundle === 'function'), { timeout: 20_000 });
  await safeEvaluate(page, async (a) => {
    await window.ScriptLoader.loadBundle('estimates');
    window.openEstimateV2Builder(a);
  }, arg);
  await expect(page.locator('#estV2Modal.open')).toBeVisible({ timeout: 15_000 });
  await safeWaitForFunction(page, () => !!(window.NBD_XACT_CATALOG && window.EstimateV2UI), { timeout: 15_000 });
  await page.waitForTimeout(400);
}

// The control's centre, hit-tested: what a thumb landing there would touch.
// Host-page toasts are cleared first: they are transient, sit above every
// overlay by design (--z-toast), and the seeding here raises its own
// ("Address not found" from the stubbed geocoder) plus the dashboard's
// timers ("8 overdue follow-ups"). A toast over a control is not what these
// steps measure; the builder's own layers (step bar, undo bar) still count.
async function reachable(locator) {
  await locator.page().evaluate(() => {
    document.querySelectorAll('.toast-container .toast, #toast.toast').forEach((t) => t.remove());
  });
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!h && (h === el || el.contains(h));
  });
}

// Customers of our own, written straight to /leads. The lead-save UI path is
// not under test here, and window._saveLead swallows a failed write into a
// `null` return (seen on a loaded emulator), which left this spec with no
// customer and an unrelated red. The doc carries what the leads create rule
// requires (userId + the caller's companyId) and what the builder reads.
async function seedLeads(page, n) {
  return safeEvaluate(page, async (count) => {
    const stamp = Date.now();
    const fsMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const db = window.db || window._db;
    const uid = (window._auth || window.auth).currentUser.uid;
    const companyId = (window._userClaims && window._userClaims.companyId) || uid;
    const out = [];
    for (let i = 0; i < count; i++) {
      const last = 'Estb' + stamp + '-' + i;
      const lead = {
        firstName: '[E2E] Estb', lastName: last,
        address: stamp + '-' + i + ' Estbuilder Way, Milford, OH 45150',
        phone: '513' + String(stamp + i).slice(-7),
        email: 'e2e-estb-' + stamp + '-' + i + '@nbd.test',
        stage: 'new', e2eTestData: true,
        userId: uid, companyId: companyId, createdAt: fsMod.serverTimestamp(),
      };
      let id = null;
      try {
        id = (await fsMod.addDoc(fsMod.collection(db, 'leads'), lead)).id;
      } catch (e) {
        // ALREADY_EXISTS = the emulator commit-retry bug: the write landed,
        // so find it by its unique lastName.
        if (!/ALREADY_EXISTS/.test(String(e && e.message || e))) throw e;
        const snap = await fsMod.getDocs(fsMod.query(fsMod.collection(db, 'leads'),
          fsMod.where('userId', '==', uid), fsMod.where('lastName', '==', last)));
        snap.forEach((d) => { if (!id) id = d.id; });
      }
      out.push({ id, name: lead.firstName + ' ' + lead.lastName, email: lead.email, phone: lead.phone, address: lead.address });
    }
    if (typeof window.loadLeads === 'function') await window.loadLeads();
    // The builder prefills from window._leads — wait until they're in it.
    for (let i = 0; i < 75 && !out.every((l) => (window._leads || []).some((x) => x.id === l.id)); i++) {
      await new Promise((r) => setTimeout(r, 200));
    }
    return out;
  }, n);
}

async function stepTo(page, n) {
  await page.locator(`#v2mStepBar [data-action="mstep"][data-arg="${n}"]`).first().tap();
  await expect(page.locator('#estV2Modal')).toHaveAttribute('data-mstep', String(n));
}

// Scope set-up through the builder's own API. Not under test here, and kept
// off the Setup step on purpose: a break in Setup must redden the Setup
// assertions, not every describe that merely needs a priced scope.
async function loadStandardReroof(page, measured) {
  await safeEvaluate(page, (m) => {
    const u = window.EstimateV2UI;
    if (m) { u.updateMeasurement('rawSqft', 2400); u.updateMeasurement('eaveLf', 120); u.updateMeasurement('ridgeLf', 45); }
    u.loadPreset('standard-reroof');
  }, !!measured);
  await expect(page.locator('#v2scopeList .v2-scope-item').first()).toBeAttached();
}

const scopeTotal = (page) => page.locator('#v2total').textContent();

// estimate#12 only shows on a SHORT step: with its sections open a pane runs
// past the step bar on its own, so the check would pass vacuously. Fold every
// section with real header taps (what a rep does to get an overview), then
// hit-test just above the step bar: it must be the pane, not the dashboard
// seen through the modal's backdrop.
async function foldedPaneFillsScreen(page, paneSel) {
  const pane = page.locator('#estV2Modal ' + paneSel);
  const open = pane.locator('.v2-section:not(.collapsed)');
  for (let n = await open.count(); n > 0; n = await open.count()) {
    await open.first().scrollIntoViewIfNeeded();
    await open.first().tap();
  }
  await pane.evaluate((el) => { el.scrollTop = 0; });
  return page.evaluate((sel) => {
    const p = document.querySelector('#estV2Modal ' + sel);
    const last = [...p.querySelectorAll('.v2-section')].pop().getBoundingClientRect().bottom;
    const y = document.getElementById('v2mStepBar').getBoundingClientRect().top - 8;
    const h = document.elementFromPoint(window.innerWidth / 2, y);
    return { short: last < y - 40, inPane: !!h && p.contains(h), hit: h ? String(h.className) : null };
  }, paneSel);
}

// ── 1. Layout of the three steps, at the small-Android width ───────────────

test.describe('phone estbuilder: V2 steps open usable at 360px @shard2', () => {
  test.skip(!creds, 'PLAYWRIGHT_TEST_USER_EMAIL / _PASSWORD not set');
  test.use({ ...ANDROID, viewport: { width: 360, height: 860 } });

  test('Setup, Items and Review each show their controls — no header taps needed', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page);
    // A customer of our own: the lead path skips draft restore (another
    // spec's autosaved draft would otherwise fill the boxes), so every field
    // starts from the page-load state.
    const [lead] = await seedLeads(page, 1);
    await openBuilder(page, { leadId: lead.id });
    const setup = page.locator('#estV2Modal .pane-setup');

    await test.step('estimate#2: Setup opens with its inputs on screen', async () => {
      await expect(page.locator('#estV2Modal')).toHaveAttribute('data-mstep', '1');
      expect(await reachable(page.locator('#v2county')), 'county select is tappable on open').toBe(true);
      expect(await reachable(page.locator('#v2rawSqft')), 'roof-area input is tappable on open').toBe(true);
      await page.locator('#v2rawSqft').tap();
      await expect(page.locator('#v2rawSqft')).toBeFocused();
    });

    await test.step('estimate#4: labels are readable; empty boxes show hints, not values', async () => {
      const info = await page.evaluate(() => {
        const labels = [...document.querySelectorAll('#estV2Modal .pane-setup .v2-field > label')]
          .filter((l) => l.offsetParent);
        const inputs = [...document.querySelectorAll('#estV2Modal .pane-setup input[type=number]')];
        const empty = inputs.filter((i) => !i.value);
        return {
          n: labels.length,
          minPx: Math.min(...labels.map((l) => parseFloat(getComputedStyle(l).fontSize))),
          empty: empty.length,
          // A bare number in grey reads like a measurement already entered;
          // "0" is the one honest bare hint (an empty box IS zero).
          bare: empty.filter((i) => /^\d+(\.\d+)?$/.test(i.placeholder.trim()) && i.placeholder.trim() !== '0')
            .map((i) => i.id + '=' + i.placeholder),
        };
      });
      expect(info.n).toBeGreaterThan(10);
      expect(info.minPx, 'smallest Setup field label (px)').toBeGreaterThanOrEqual(11);
      expect(info.empty, 'a fresh estimate has empty measurement boxes to check').toBeGreaterThan(5);
      expect(info.bare, 'empty boxes whose hint looks like an entered value').toEqual([]);
    });

    await test.step('estimate#3: tapping a price adder\'s text toggles it', async () => {
      for (const [id, re] of [['v2cutup', /^Cut-up Roof/], ['v2chimneyFlash', /^Chimney Flashing/], ['v2skylightFlash', /^Skylight Flashing/]]) {
        const box = page.locator('#' + id);
        const text = setup.getByText(re);
        const before = await box.isChecked();
        await text.tap();
        await expect(box, `${id}: a tap on its text toggles it`).toBeChecked({ checked: !before });
        const field = await box.getAttribute('data-field');
        expect(await page.evaluate((f) => window.EstimateV2UI.getState().measurements[f], field),
          `${id}: the estimate's state follows the tap`).toBe(!before);
        const bb = await box.boundingBox();
        expect(Math.min(bb.width, bb.height), `${id}: the box itself is thumb-sized`).toBeGreaterThanOrEqual(20);
        await text.tap(); // put it back
        await expect(box).toBeChecked({ checked: before });
      }
    });

    await test.step('estimate#12: a folded-up Setup step still fills the screen', async () => {
      const g = await foldedPaneFillsScreen(page, '.pane-setup');
      expect(g.short, 'folded, the Setup content ends well above the step bar').toBe(true);
      expect(g.inPane, `just above the step bar is the builder, not the dashboard behind it (hit ${g.hit})`).toBe(true);
    });

    await test.step('estimate#5: Items category chips are thumb-sized, one row, and filter', async () => {
      await stepTo(page, 2);
      const g = await page.evaluate(() => {
        const bs = [...document.querySelectorAll('#v2cats button')];
        return { n: bs.length, minH: Math.min(...bs.map((b) => b.getBoundingClientRect().height)),
          rowH: document.getElementById('v2cats').getBoundingClientRect().height };
      });
      expect(g.n).toBeGreaterThan(5);
      expect(g.minH, 'shortest category chip (px)').toBeGreaterThanOrEqual(36);
      expect(g.rowH, 'chips take one row, not three or four').toBeLessThan(60);
      // The last chip starts off-screen in the sideways row; a real tap
      // scrolls to it and must filter the list to that category.
      const last = page.locator('#v2cats button').last();
      const want = Number(((await last.textContent()) || '').match(/\((\d+)\)/)[1]);
      await last.tap();
      expect(await reachable(page.locator('#v2cats button').last()), 'the tapped chip is on screen').toBe(true);
      await expect(page.locator('#v2items .v2-item')).toHaveCount(want);
    });

    await test.step('estimate#2: Review shows the scope, total and Save without opening a section', async () => {
      await loadStandardReroof(page, false);
      await stepTo(page, 3);
      const row = page.locator('#v2scopeList .v2-scope-item').first();
      await row.scrollIntoViewIfNeeded();
      expect(await reachable(row), 'first scope line is on screen and tappable').toBe(true);
      for (const sel of ['.v2-total-card', '#v2saveBtn']) {
        const el = page.locator('#estV2Modal ' + sel);
        await el.scrollIntoViewIfNeeded();
        expect(await reachable(el), sel + ' is reachable by scrolling alone').toBe(true);
      }
    });

    await test.step('estimate#12: a folded-up Review step still fills the screen', async () => {
      const g = await foldedPaneFillsScreen(page, '.pane-review');
      expect(g.short, 'folded, the Review content ends well above the step bar').toBe(true);
      expect(g.inPane, `just above the step bar is the builder, not the dashboard behind it (hit ${g.hit})`).toBe(true);
    });
  });
});

// ── 2. Review scope-row controls at Jo's width ─────────────────────────────

test.describe('phone estbuilder: scope rows at 412px @shard2', () => {
  test.skip(!creds, 'PLAYWRIGHT_TEST_USER_EMAIL / _PASSWORD not set');
  test.use({ ...ANDROID, viewport: { width: 412, height: 860 } });

  test('note/qty/remove are thumb targets; qty edits in place; remove can be undone', async ({ page }) => {
    test.setTimeout(120_000);
    const dialogs = [];
    page.on('dialog', async (d) => { dialogs.push(d.type() + ': ' + d.message().slice(0, 60)); await d.dismiss(); });
    await signIn(page);
    const [lead] = await seedLeads(page, 1);
    await openBuilder(page, { leadId: lead.id });
    await loadStandardReroof(page, true);
    await stepTo(page, 3);

    const firstRow = page.locator('#v2scopeList .v2-scope-item').first();
    await firstRow.scrollIntoViewIfNeeded();
    const code = await firstRow.getAttribute('data-code');
    const row = page.locator(`#v2scopeList .v2-scope-item[data-code="${code}"]`);

    await test.step('estimate#6: 📝 ✎ × are each a 40px target a thumb actually hits', async () => {
      for (const cls of ['edit-note', 'edit-qty', 'rm']) {
        const b = row.locator('button.' + cls);
        const bb = await b.boundingBox();
        expect(Math.min(bb.width, bb.height), `${cls} size`).toBeGreaterThanOrEqual(39.5);
        expect(await reachable(b), `${cls} is not covered`).toBe(true);
      }
    });

    let T1 = null;
    await test.step('estimate#6: ✎ edits the quantity in the row with a number pad — no prompt()', async () => {
      const T0 = await scopeTotal(page);
      await row.locator('button.edit-qty').tap();
      const input = page.locator('#v2RowEditInput');
      await expect(input, 'an in-row quantity box opens').toBeVisible();
      await expect(input).toBeFocused();
      await expect(input).toHaveAttribute('inputmode', 'decimal');
      await input.fill('30');
      await page.locator('#v2scopeList [data-action="row-edit-apply"]').tap();
      await expect(row.locator('.qty')).toContainText('30.0');
      await expect(row.locator('.qty')).toContainText('manual');
      T1 = await scopeTotal(page);
      expect(T1, 'the override re-prices the estimate').not.toBe(T0);
      expect(dialogs, 'no native dialog on the way').toEqual([]);
    });

    await test.step('estimate#6: × on a priced line can be undone, override intact', async () => {
      const n = await page.locator('#v2scopeList .v2-scope-item').count();
      const idx = await page.evaluate((c) => [...document.querySelectorAll('#v2scopeList .v2-scope-item')]
        .findIndex((r) => r.dataset.code === c), code);
      await row.locator('button.rm').tap();
      await expect(page.locator('#v2scopeList .v2-scope-item')).toHaveCount(n - 1);
      expect(await scopeTotal(page), 'removing the line drops the total').not.toBe(T1);
      const undo = page.locator('#estV2Modal').getByRole('button', { name: 'Undo' });
      await expect(undo, 'an Undo control is offered').toBeVisible();
      expect(await reachable(undo), 'Undo is not covered (e.g. by the step bar)').toBe(true);
      await undo.tap();
      await expect(page.locator('#v2scopeList .v2-scope-item')).toHaveCount(n);
      await expect(row.locator('.qty')).toContainText('manual');
      expect(await scopeTotal(page), 'undo restores the exact total').toBe(T1);
      expect(await page.evaluate((c) => [...document.querySelectorAll('#v2scopeList .v2-scope-item')]
        .findIndex((r) => r.dataset.code === c), code), 'back in its original position').toBe(idx);
      expect(dialogs).toEqual([]);
    });
  });
});

// ── 3. Reopen keeps the customer's contact (data bug, any width) ───────────

test.describe('phone estbuilder: reopened estimate keeps contact @shard2', () => {
  test.skip(!creds, 'PLAYWRIGHT_TEST_USER_EMAIL / _PASSWORD not set');
  test.use({ ...ANDROID, viewport: { width: 412, height: 860 } });

  test('save → reopen → Retail Quote still carries phone + email; the next customer starts clean', async ({ page }) => {
    test.setTimeout(150_000);
    // The document viewer asks "Close without saving?" — accept that one.
    page.on('dialog', async (d) => {
      if (/close without saving/i.test(d.message())) await d.accept(); else await d.dismiss();
    });
    await signIn(page);
    const [A, B] = await seedLeads(page, 2);
    expect(A.id && B.id, 'two seeded customers').toBeTruthy();
    await safeWaitForFunction(page, () => (window._leads || []).length > 0, { timeout: 15_000 });

    await openBuilder(page, { leadId: A.id });
    await loadStandardReroof(page, true);
    await stepTo(page, 3);
    await expect(page.locator('#v2custEmail')).toHaveValue(A.email);

    let estId = null;
    await test.step('estimate#8: Save persists the phone + email the estimate was written for', async () => {
      // The builder's own save() — the button is covered by the layout steps.
      await safeEvaluate(page, () => window.EstimateV2UI.save());
      await expect(page.locator('#v2saveStatus')).toHaveText(/Saved|error|fail/i, { timeout: 20_000 });
      // Recover by leadId: survives the emulator's ALREADY_EXISTS retry bug
      // (the write lands, the client reports an error).
      const saved = await safeEvaluate(page, async (lid) => {
        const fsMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const db = window.db || window._db;
        const uid = (window._auth || window.auth).currentUser.uid;
        const snap = await fsMod.getDocs(fsMod.query(fsMod.collection(db, 'estimates'),
          fsMod.where('userId', '==', uid), fsMod.where('leadId', '==', lid)));
        let out = null; snap.forEach((d) => { if (!out) out = { id: d.id, ...d.data() }; });
        return out && { id: out.id, customerEmail: out.customerEmail, customerPhone: out.customerPhone };
      }, A.id);
      expect(saved, 'the estimate was saved against the customer').toBeTruthy();
      expect(saved.customerEmail).toBe(A.email);
      expect(saved.customerPhone).toBe(A.phone);
      estId = saved.id;
    });

    await test.step('estimate#8: reopening lands on Review with phone + email filled in', async () => {
      await page.locator('#estV2Modal .v2-close').tap();
      await expect(page.locator('#estV2Modal')).toBeHidden();
      await page.waitForFunction((id) => (window._estimates || []).some((e) => e.id === id), estId, { timeout: 20_000 });
      await openBuilder(page, { estimateId: estId });
      await expect(page.locator('#estV2Modal')).toHaveAttribute('data-mstep', '3');
      await expect(page.locator('#v2custEmail')).toHaveValue(A.email);
      await expect(page.locator('#v2custPhone')).toHaveValue(A.phone);
      expect(await reachable(page.locator('#v2custEmail')), 'the reopened contact is on screen').toBe(true);
    });

    await test.step('estimate#8: the regenerated Retail Quote prints them', async () => {
      const rq = page.locator('#estV2Modal [data-action="finalize"][data-arg="retail-quote"]');
      await rq.scrollIntoViewIfNeeded();
      await rq.tap();
      const doc = page.frameLocator('#nbdv-iframe').locator('body');
      await expect(doc).toContainText(A.email, { timeout: 20_000 });
      await expect(doc).toContainText(A.phone);
    });

    await test.step('estimate#8 sibling: the next customer\'s new estimate does not inherit this one', async () => {
      await page.locator('#nbdv-close').tap(); // "Close without saving?" → OK (handler above)
      await expect(page.locator('#nbdv-close')).toBeHidden({ timeout: 10_000 });
      await page.locator('#estV2Modal .v2-close').tap();
      await expect(page.locator('#estV2Modal')).toBeHidden();
      await openBuilder(page, { leadId: B.id });
      await expect(page.locator('#v2custName')).toHaveValue(B.name);
      await expect(page.locator('#v2custEmail')).toHaveValue(B.email);
      await expect(page.locator('#v2custAddress')).toHaveValue(B.address);
      expect(await page.evaluate(() => {
        const s = window.EstimateV2UI.getState();
        return { scope: s.scope.length, leadId: s.leadId, linked: s.customer.leadId };
      }), 'a clean scope, and Save would file it under B — not A').toEqual({ scope: 0, leadId: null, linked: B.id });
    });
  });
});

// ── 4. Desktop keeps its layout; Job Templates modal is opaque + readable ──

test.describe('phone estbuilder: desktop + Job Templates modal @shard2', () => {
  test.skip(!creds, 'PLAYWRIGHT_TEST_USER_EMAIL / _PASSWORD not set');
  test.use({ viewport: { width: 1280, height: 860 } });

  test('three-pane desktop layout intact; Job Templates title readable on a light header', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page);
    // The light theme's surface tokens as the audit measured them on a phone
    // in light mode (header #fcf8f6, text #0f172a). Pinned so the check runs
    // against the palette that exposed the bug whatever theme CI boots.
    await page.addStyleTag({ content: ':root{--s:#fcf8f6 !important;--t:#0f172a !important;--bg:#faf2ee !important;}' });
    await openBuilder(page, {});

    await test.step('desktop: all three panes still side by side, nothing folded', async () => {
      const g = await page.evaluate(() => ['.pane-setup', '.pane-items', '.pane-review'].map((s) => {
        const r = document.querySelector('#estV2Modal ' + s).getBoundingClientRect();
        return { w: Math.round(r.width), top: Math.round(r.top) };
      }));
      for (const p of g) expect(p.w).toBeGreaterThan(200);
      expect(new Set(g.map((p) => p.top)).size, 'panes share one row').toBe(1);
      expect(await page.locator('#estV2Modal .v2-section.collapsed').count(), 'no section starts folded on desktop').toBe(0);
    });

    await test.step('estimate#12: Job Templates modal — readable title, opaque body', async () => {
      await page.locator('#estV2Modal [data-action="open-job-templates"]').click();
      await expect(page.locator('#jtModal.open')).toBeVisible({ timeout: 15_000 });
      const r = await page.evaluate(() => {
        const rgb = (c) => (c.match(/[\d.]+/g) || []).map(Number);
        const lum = (c) => { const m = rgb(c); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
        const title = document.querySelector('#jtModal .jt-m-title');
        const hdr = document.querySelector('#jtModal .jt-m-hdr');
        const body = document.getElementById('jtModalBody');
        const a = lum(getComputedStyle(title).color), b = lum(getComputedStyle(hdr).backgroundColor);
        const bg = rgb(getComputedStyle(body).backgroundColor);
        const h = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 40);
        return { contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), bodyAlpha: bg.length === 4 ? bg[3] : 1,
          bottomInBody: !!h && body.contains(h) };
      });
      expect(r.contrast, 'modal title vs its header (WCAG ratio)').toBeGreaterThanOrEqual(4.5);
      expect(r.bottomInBody).toBe(true);
      expect(r.bodyAlpha, 'the modal body is opaque — the dashboard never shows through').toBe(1);
    });
  });
});
