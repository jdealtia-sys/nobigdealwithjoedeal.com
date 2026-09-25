// tests/e2e/phone-estdata.spec.js — estimate data + display, on a phone.
//
// Phone audit 2026-09-25, lane "estdata". Jo runs the business from an
// Android at ~412px, and four estimate defects were independently reproduced
// there. Each test below drives the real UI (real taps, hit-tested targets)
// and asserts what the rep would see, never a class name:
//
//   estimate#0  the Estimates view said "No estimates yet" under a KPI band
//               counting them — renderEstimatesList ran at boot while the
//               view was still an un-hydrated <template>, and goTo('est')
//               never re-ran it. Siblings on the same early return: the
//               dashboard's "Latest Estimates" panel, and every linked
//               estimate chipped "Unassigned" on a cold #/est load.
//   estimate#11 a Log Estimate record (amount only) opened in the Classic
//               builder, which recomputed $12,451 down to the $2,500 minimum
//               and saved that over the logged price. It now opens an
//               amount editor that keeps the price, in cents. The Classic
//               review table's TOTAL column also has to fit a phone.
//   estimate#9  an invoice made from a V2 estimate billed "Customer" — the
//               name read two fields no writer sets. Plus the invoice detail's
//               TOTAL column ran off a 360px screen.
//   estimate#7  the Insurance Scope / Internal previews were 476 / 522px wide
//               inside a 412px viewer, so LINE TOTAL sat off-screen.
//
// One login for the whole file (a serial describe sharing one page), and
// every record it writes is its own, tagged e2eTestData. Cloud Functions are
// answered by page.route, so the result never depends on the functions
// emulator being up. Tagged @audit to ride the authed emulator job's audit
// shard. Run locally against a server on :5117 (see the PR for the command).
const { test, expect } = require('@playwright/test');
const { requireTestUser, loginAs, safeEvaluate, safeWaitForFunction } = require('./fixtures/auth');

const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)([:/]|$)/.test(process.env.PLAYWRIGHT_BASE_URL || '');

// Centre-point hit test: is the element actually the thing a finger lands on?
async function hitTest(target, selector) {
  return target.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { ok: false, why: 'missing ' + sel };
    const r = el.getBoundingClientRect();
    const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      ok: !!h && (h === el || el.contains(h)),
      why: h ? 'covered by ' + h.tagName.toLowerCase() + (h.id ? '#' + h.id : '') + '.' + String(h.className).split(' ')[0] : 'off-screen',
    };
  }, selector);
}

async function expectTappable(target, selector, label) {
  const r = await hitTest(target, selector);
  expect(r.ok, `${label} is reachable by a tap (${r.why})`).toBe(true);
}

// Poll a page predicate that takes an argument (safeWaitForFunction takes
// none), riding safeEvaluate's navigation-race tolerance.
async function waitForArg(page, fn, arg, timeout, label) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await safeEvaluate(page, fn, arg)) return;
    if (Date.now() > deadline) throw new Error('timed out waiting for ' + label);
    await page.waitForTimeout(200);
  }
}

// Real-tap navigation through the phone's bottom-nav MORE sheet.
async function moreNav(page, view) {
  await page.locator('#mni-more').tap();
  const item = page.locator(`.mm-item[data-target="${view}"]`);
  await expect(item).toBeVisible({ timeout: 5_000 });
  await item.tap();
  await waitForArg(page, (v) => { const el = document.getElementById('view-' + v); return !!el && el.classList.contains('active'); },
    view, 10_000, 'view-' + view + ' to become active');
}

test.describe.serial('phone estimate data @audit', () => {
  test.describe.configure({ timeout: 60_000 });
  let creds = null;
  let ctx;
  let page;
  const S = {}; // seeded ids + names

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    try { creds = requireTestUser(); } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[phone-estdata] ' + e.message);
      return;
    }
    ctx = await browser.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://nobigdealwithjoedeal.com',
      serviceWorkers: 'block',
      viewport: { width: 412, height: 860 },
      isMobile: true,
      hasTouch: true,
      userAgent: UA,
      ...(LOCAL ? { bypassCSP: true } : {}),
      ...(process.env.PLAYWRIGHT_PROXY_SERVER
        ? { proxy: { server: process.env.PLAYWRIGHT_PROXY_SERVER, bypass: '127.0.0.1,localhost' }, ignoreHTTPSErrors: true }
        : {}),
    });
    page = await ctx.newPage();
    // Cloud Functions (payment link, server PDF render): answer "unavailable"
    // so every path takes its documented fallback, with or without the
    // functions emulator.
    await page.route(/127\.0\.0\.1:5001\/|cloudfunctions\.net\//, (r) => r.fulfill({
      status: 503, contentType: 'application/json', body: JSON.stringify({ error: { status: 'UNAVAILABLE', message: 'mocked by phone-estdata' } }),
    }));
    await loginAs(page, creds);
    await safeWaitForFunction(page, () => window._user && window._user.uid && typeof window._loadLeads === 'function'
      && typeof window.addDoc === 'function' && Array.isArray(window._estimates) && window._leadsLoaded, { timeout: 60_000 });
    const skip = page.getByText('Skip tour', { exact: true });
    if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => {});

    S.stamp = Date.now();
    S.leadName = '[E2E] Estdata ' + S.stamp;
    Object.assign(S, await safeEvaluate(page, async (stamp) => {
      const uid = window._user.uid;
      const companyId = (window._userClaims && window._userClaims.companyId) || uid;
      // The lead goes in directly, not through _saveLead: _saveLead runs the
      // possible-duplicate prompt (LeadDedup.checkAndPrompt), and a CI retry
      // of this hook would find the previous attempt's lead and sit on that
      // prompt until the hook times out. loadLeads() below is the real loader.
      const leadRef = await window.addDoc(window.collection(window.db, 'leads'), {
        firstName: '[E2E] Estdata', lastName: String(stamp),
        address: `${String(stamp).slice(-3)} Estdata Ln, Milford, OH`,
        phone: '513' + String(stamp).slice(-7), email: `e2e-estdata-${stamp}@nbd.test`,
        stage: 'new', deleted: false, userId: uid, companyId, createdAt: window.serverTimestamp(), e2eTestData: true,
      });
      const leadId = leadRef.id;
      await window._loadLeads();
      const base = { userId: uid, companyId, leadId, createdAt: window.serverTimestamp(), e2eTestData: true };
      // 1) Exactly what customer.html's Log Estimate modal writes (amount only).
      const logged = await window.addDoc(window.collection(window.db, 'estimates'), Object.assign({}, base, {
        type: 'Good', amount: 12450.75, grandTotal: 12450.75, title: 'Good Estimate',
        notes: 'phone-estdata ' + stamp, status: 'Draft', createdBy: 'e2e',
      }));
      // 2) A V2 estimate: the homeowner lives in `owner`, never `customerName`.
      const rows = [
        { code: 'LAB-TO1', desc: 'Tear Off 1 Layer Comp Shingles', qty: '27.60SQ', rate: '$65.00', total: 1794, retailTotal: 1794, quantity: 27.6, unit: 'SQ' },
        { code: 'RFG-240-GAF-HDZ', desc: 'GAF Timberline HDZ', qty: '27.60SQ', rate: '$208.75', total: 5761.5, retailTotal: 5761.5, quantity: 27.6, unit: 'SQ' },
        { code: 'RFG-IWS', desc: 'Ice & Water Shield (Eave Protection)', qty: '2.76SQ', rate: '$128.25', total: 353.97, retailTotal: 353.97, quantity: 2.76, unit: 'SQ' },
        { code: 'DSP-30YD', desc: 'Dumpster 30-Yard', qty: '1.00EA', rate: '$687.50', total: 687.5, retailTotal: 687.5, quantity: 1, unit: 'EA' },
      ];
      const v2Total = Math.round(rows.reduce((s, r) => s + r.total * 100, 0)) / 100;
      const v2 = await window.addDoc(window.collection(window.db, 'estimates'), Object.assign({}, base, {
        builder: 'v2', estimateVersion: 'v2', method: 'line-item', mode: 'cash', tier: 'better',
        name: '[E2E] Estdata V2 ' + stamp, addr: `${String(stamp).slice(-3)} Estdata Ln, Milford, OH`,
        owner: '[E2E] Estdata ' + stamp, rows, subtotal: v2Total, tax: 0, taxRate: 0, grandTotal: v2Total,
      }));
      // 3) A genuine Classic doc (it has the inputs Classic prices from).
      const classic = await window.addDoc(window.collection(window.db, 'estimates'), Object.assign({}, base, {
        builder: 'classic', name: '[E2E] Estdata Classic ' + stamp, addr: `${String(stamp).slice(-3)} Estdata Ln, Milford, OH`,
        owner: '[E2E] Estdata ' + stamp, raw: 2500, adj: 2500, sq: 25, roofType: 'Gable', pitch: '6/12', wf: 1.15,
        tier: 'good', tierName: 'Good', mode: 'cash', grandTotal: 9876.54,
        rows: [{ code: 'RFG-SYS', desc: 'Standard turnkey per-square price', qty: '25.00 SQ', rate: '$395/SQ', total: 9876.54 }],
      }));
      return { leadId, loggedId: logged.id, v2Id: v2.id, classicId: classic.id, v2Total };
    }, S.stamp));
    expect(S.leadId, 'seeded lead has an id').toBeTruthy();
    await waitForArg(page, (a) => Array.isArray(window._estimates)
      && a.ids.every((id) => window._estimates.some((e) => e.id === id))
      && Array.isArray(window._leads) && window._leads.some((l) => l.id === a.leadId),
    { ids: [S.loggedId, S.v2Id, S.classicId], leadId: S.leadId }, 20_000, 'seeded estimates + lead in memory');
  });

  test.afterAll(async () => { if (ctx) await ctx.close(); });

  test.beforeEach(async ({}, testInfo) => {
    if (!creds) testInfo.skip(true, 'PLAYWRIGHT_TEST_USER_EMAIL not set');
  });

  test('estimate#0 sibling: the dashboard\'s Latest Estimates lists them before the Estimates view was ever opened', async () => {
    // The bug path needs the Estimates view still un-hydrated here; if a
    // future change hydrates it at boot this test no longer proves anything.
    const hydrated = await safeEvaluate(page, () => (document.getElementById('view-est') || { children: [] }).children.length);
    expect(hydrated, 'precondition: view-est not hydrated yet').toBe(0);
    await moreNav(page, 'dash');
    const panel = page.locator('#recentEsts');
    await panel.scrollIntoViewIfNeeded();
    const cards = panel.locator('.nbd-recent-est');
    await expect(cards.first(), 'Latest Estimates shows estimate cards, not "No estimates yet"').toBeVisible({ timeout: 5_000 });
    const n = await safeEvaluate(page, () => window._estimates.length);
    await expect(cards).toHaveCount(Math.min(4, n));
    await cards.first().scrollIntoViewIfNeeded();
    await expectTappable(page, '#recentEsts .nbd-recent-est', 'first Latest Estimates card');
  });

  test('estimate#0: opening Estimates by real taps lists every saved estimate, customer chip resolved', async () => {
    await moreNav(page, 'est');
    const card = page.locator(`#estListWrap .nbd-est-card[data-id="${S.loggedId}"]`);
    await expect(card, 'the saved estimate is listed on first open').toBeVisible({ timeout: 5_000 });
    const counts = await safeEvaluate(page, () => ({
      cards: document.querySelectorAll('#estListWrap .nbd-est-card').length,
      estimates: window._estimates.length,
      staticEmpty: !!document.querySelector('#estListWrap > .empty'),
    }));
    expect(counts.staticEmpty, 'the template\'s static "No estimates yet" is gone').toBe(false);
    expect(counts.cards, 'one card per estimate the KPI band counts').toBe(counts.estimates);
    await expect(card.locator('.est-lead-chip'), 'linked estimate names its customer').toContainText('Estdata');
    const edit = card.locator('[data-act="open"]');
    await edit.scrollIntoViewIfNeeded();
    await expectTappable(page, `#estListWrap .nbd-est-card[data-id="${S.loggedId}"] [data-act="open"]`, '✎ Edit on the logged estimate');
  });

  test('estimate#0 sibling: a cold load straight to #/est resolves customer chips once leads arrive', async () => {
    await page.goto('/pro/dashboard#/est');
    await safeWaitForFunction(page, () => window._leadsLoaded && Array.isArray(window._estimates)
      && !!document.querySelector('#estListWrap .nbd-est-card'), { timeout: 45_000 });
    const chip = page.locator(`#estListWrap .nbd-est-card[data-id="${S.loggedId}"] .est-lead-chip`);
    await expect(chip, 'no "Unassigned" on an estimate linked to a loaded lead').toContainText('Estdata', { timeout: 10_000 });
  });

  test('estimate#11: ✎ Edit on a Log Estimate record opens the amount editor — never Classic — and saves in cents', async () => {
    if (!(await page.locator('#view-est.active #estListWrap .nbd-est-card').count())) await moreNav(page, 'est');
    const card = page.locator(`#estListWrap .nbd-est-card[data-id="${S.loggedId}"]`);
    await card.scrollIntoViewIfNeeded();
    await card.locator('[data-act="open"]').tap();
    const editor = page.locator('#logged-est-editor');
    await expect(editor, 'the logged-estimate editor opens').toBeVisible({ timeout: 5_000 });
    const st = await safeEvaluate(page, () => {
      const b = document.getElementById('est-builder');
      return {
        classicShown: !!b && getComputedStyle(b).display !== 'none',
        amount: document.getElementById('logged-est-amount').value,
        recomputeToast: [...document.querySelectorAll('[id^="toast-"]')].some((t) => /recomputed/i.test(t.textContent || '')),
      };
    });
    expect(st.classicShown, 'the Classic builder did not open').toBe(false);
    expect(st.recomputeToast, 'no "total recomputed" warning').toBe(false);
    expect(st.amount, 'the logged amount is kept to the cent').toBe('12450.75');
    for (const [sel, label] of [['#logged-est-amount', 'Amount field'], ['#logged-est-type', 'Package select'],
      ['#logged-est-cancel', 'Cancel'], ['#logged-est-save', 'Save']]) {
      await expectTappable(page, sel, label);
    }
    // Edit the price by real typing, the way a rep would.
    await page.locator('#logged-est-amount').tap();
    await page.locator('#logged-est-amount').fill('');
    await page.keyboard.type('13,000.50');
    await page.locator('#logged-est-save').tap();
    await expect(editor, 'Save closes the editor').toHaveCount(0, { timeout: 15_000 });
    await waitForArg(page, (id) => { const e = window._estimates.find((x) => x.id === id); return !!e && e.grandTotal === 13000.5 && e.amount === 13000.5; },
      S.loggedId, 10_000, 'the edited amount to land in cents (13000.50)');
    const saved = await safeEvaluate(page, (id) => { const e = window._estimates.find((x) => x.id === id); return { builder: e.builder || null, type: e.type }; }, S.loggedId);
    expect(saved.builder, 'still a logged record — nothing stamped it Classic').toBeNull();
    await expect(page.locator(`#estListWrap .nbd-est-card[data-id="${S.loggedId}"] .est-card-total`)).toHaveText('$13,001');

    // 360px: the editor still fits and Cancel leaves the price alone.
    await page.setViewportSize({ width: 360, height: 860 });
    await card.scrollIntoViewIfNeeded();
    await card.locator('[data-act="open"]').tap();
    await expect(editor).toBeVisible({ timeout: 5_000 });
    for (const [sel, label] of [['#logged-est-amount', 'Amount field @360'], ['#logged-est-save', 'Save @360'], ['#logged-est-cancel', 'Cancel @360']]) {
      await expectTappable(page, sel, label);
    }
    expect(await page.locator('#logged-est-amount').inputValue()).toBe('13000.50');
    await page.locator('#logged-est-cancel').tap();
    await expect(editor).toHaveCount(0);
    await page.setViewportSize({ width: 412, height: 860 });
  });

  test('estimate#11 sibling: the Classic review table shows its TOTAL column on a phone', async () => {
    if (!(await page.locator('#view-est.active #estListWrap .nbd-est-card').count())) await moreNav(page, 'est');
    await safeEvaluate(page, () => window.ScriptLoader && window.ScriptLoader.loadBundle && window.ScriptLoader.loadBundle('estimates'));
    const card = page.locator(`#estListWrap .nbd-est-card[data-id="${S.classicId}"]`);
    await card.scrollIntoViewIfNeeded();
    await card.locator('[data-act="open"]').tap();
    const table = page.locator('#estReviewBody .li-table');
    await expect(table, 'a real Classic doc still opens in Classic').toBeVisible({ timeout: 10_000 });
    for (const width of [412, 360]) {
      await page.setViewportSize({ width, height: 860 });
      await table.scrollIntoViewIfNeeded();
      const m = await safeEvaluate(page, () => {
        const t = document.querySelector('#estReviewBody .li-table');
        const r = t.getBoundingClientRect();
        const cells = [...t.querySelectorAll('tr > :last-child')];
        return { overflow: t.scrollWidth - t.clientWidth, clipped: cells.filter((c) => c.getBoundingClientRect().right > r.right + 0.5).length };
      });
      expect(m.overflow, `review table needs no sideways scroll at ${width}px`).toBeLessThanOrEqual(1);
      expect(m.clipped, `no TOTAL cell is cut off at ${width}px`).toBe(0);
      await expectTappable(page, '#estReviewBody .li-table .total-row.grand td:last-child', `ESTIMATE TOTAL cell @${width}`);
    }
    await page.setViewportSize({ width: 412, height: 860 });
    // Leave without saving (this test never writes the Classic doc).
    await safeEvaluate(page, () => { if (typeof window.cancelEstimate === 'function') window.cancelEstimate(); });
  });

  test('estimate#9: an invoice made from a V2 estimate bills the homeowner by name', async () => {
    await safeEvaluate(page, (id) => window.openCardDetailModal(id), S.leadId);
    const invBtn = page.locator('.cd-action-btn[data-fn="cdaInvoice"]');
    await invBtn.scrollIntoViewIfNeeded();
    await invBtn.tap();
    await expect(page.locator('#nbd-invoice-modal')).toBeVisible({ timeout: 8_000 });
    await page.locator('#nbd-inv-est-pick').selectOption(S.v2Id);
    await page.locator('#nbd-inv-create').tap();
    const detail = page.locator('#nbd-invoice-detail-modal .invoice-detail');
    await expect(detail).toBeVisible({ timeout: 15_000 });
    const billTo = await safeEvaluate(page, () => {
      const t = document.querySelector('#nbd-invoice-detail-modal .invoice-detail').innerText;
      const i = t.search(/bill to/i);
      return t.slice(i).split('\n').map((s) => s.trim()).filter(Boolean)[1] || '';
    });
    expect(billTo, 'Bill To names the homeowner, not "Customer"').toBe(S.leadName);
    const stored = await safeEvaluate(page, async () => {
      const t = document.querySelector('#nbd-invoice-detail-modal .invoice-detail').innerText;
      const id = (t.match(/Invoice ([A-Za-z0-9]{15,})/) || [])[1];
      await window.updateDoc(window.doc(window.db, 'invoices', id), { e2eTestData: true });
      const s = await window.getDoc(window.doc(window.db, 'invoices', id));
      return { id, customerName: s.data().customerName };
    });
    expect(stored.customerName, 'the stored invoice carries the name for send/receipt/AR').toBe(S.leadName);
    S.invoiceId = stored.id;
    await page.locator('#nbd-inv-detail-close').tap();
    await expect(page.locator('#nbd-invoice-detail-modal')).toHaveCount(0, { timeout: 5_000 });
  });

  test('estimate#9 sibling: the invoice detail keeps its TOTAL column on screen at 412 and 360', async () => {
    const invoiceId = S.invoiceId || await safeEvaluate(page, (id) => window.InvoicePipeline.createInvoiceFromEstimate(id), S.v2Id);
    await safeEvaluate(page, (id) => window.InvoicePipeline.showInvoiceDetailModal(id), invoiceId);
    await expect(page.locator('#nbd-invoice-detail-modal .invoice-detail table')).toBeVisible({ timeout: 15_000 });
    // The create flow's toasts ("Invoice created", payouts hint) stack over the
    // lower screen for a few seconds; let them time out before hit-testing.
    await expect(page.locator('#toastContainer [id^="toast-"]')).toHaveCount(0, { timeout: 15_000 });
    for (const width of [412, 360]) {
      await page.setViewportSize({ width, height: 860 });
      await page.locator('#nbd-invoice-detail-modal .invoice-detail table').scrollIntoViewIfNeeded();
      const m = await safeEvaluate(page, () => {
        const d = document.querySelector('#nbd-invoice-detail-modal .invoice-detail');
        const right = Math.min(document.documentElement.clientWidth, d.getBoundingClientRect().right);
        const cells = [...d.querySelectorAll('table tr > :last-child')];
        return { cells: cells.length, clipped: cells.filter((c) => c.getBoundingClientRect().right > right + 0.5).length };
      });
      expect(m.cells, 'line items rendered').toBeGreaterThan(1);
      expect(m.clipped, `no TOTAL cell past the card edge at ${width}px`).toBe(0);
      await expectTappable(page, '#nbd-invoice-detail-modal .invoice-detail table thead th:last-child', `TOTAL header @${width}`);
    }
    await page.setViewportSize({ width: 412, height: 860 });
    await page.locator('#nbd-inv-detail-close').tap();
  });

  test('estimate#7: Insurance Scope and Internal previews fit the phone viewer (412, 360), desktop untouched', async () => {
    await safeEvaluate(page, () => window.ScriptLoader.loadBundle('estimates'));
    await safeWaitForFunction(page, () => window.EstimateFinalization && window.NBDDocViewer, { timeout: 20_000 });
    for (const fmt of ['insurance-scope', 'internal-view']) {
      await safeEvaluate(page, (f) => {
        const line = (code, name, category, quantity, unit, m, l) => ({ code, name, category, quantity, unit,
          materialCostPerUnit: m, laborCostPerUnit: l, lineTotal: Math.round(quantity * (m + l) * 100) / 100,
          matSource: 'catalog-2026-q3', labSource: 'crew-rate-card' });
        const estimate = {
          total: 38417.25, subtotal: 36000, materialRetail: 18000, laborCost: 9000, materialCost: 14400, hardCost: 23400,
          overhead: 3000, profit: 3000, overheadPct: 0.1, profitPct: 0.1, taxRate: 0.0725, tax: 2417.25,
          tier: 'best', mode: 'insurance', minJobApplied: false, deposit: 0, internal: { margin: 9000, marginPct: 23.4 },
          lines: [
            line('LAB-TO1', 'Tear Off 1 Layer Comp Shingles', 'labor', 27.6, 'SQ', 0, 65),
            line('LAB-DEMOB', 'Demobilization / Final Cleanup', 'labor', 1, 'JOB', 0, 185),
            line('RFG-240-GAF-HDZ', 'GAF Timberline HDZ', 'roofing', 97.6, 'SQ', 115, 65),
            line('RFG-IWS', 'Ice & Water Shield (Eave Protection)', 'roofing', 3.6, 'SQ', 85, 22),
            line('RFG-DRPE-AL', 'Drip Edge Aluminum (F-Style)', 'roofing', 120, 'LF', 1.95, 0.65),
          ],
        };
        const meta = { customer: { name: 'Phone Audit', address: '1 Estdata Ln, Milford OH' },
          claim: { carrier: 'State Farm', number: 'CLM-1', deductible: 1000, acv: 30000, recoverableDepreciation: 8417.25 },
          estimate: { date: new Date(), number: 'PA-1' } };
        const res = window.EstimateFinalization.formatEstimate(estimate, f, meta);
        window.NBDDocViewer.open({ html: res.html, title: f, filename: f + '.pdf' });
      }, fmt);
      await expect(page.locator('#nbd-doc-viewer-overlay.open #nbdv-iframe')).toBeVisible({ timeout: 10_000 });
      const frame = await (await page.$('#nbdv-iframe')).contentFrame();
      await frame.waitForSelector('table');
      for (const width of [412, 360]) {
        await page.setViewportSize({ width, height: 860 });
        await page.waitForTimeout(250);
        const m = await frame.evaluate(() => {
          const cw = document.documentElement.clientWidth;
          const money = [...document.querySelectorAll('td.num, th.num')];
          return { sideways: document.documentElement.scrollWidth - cw, cells: money.length,
            clipped: money.filter((c) => c.getBoundingClientRect().right > cw + 0.5).length };
        });
        expect(m.cells, `${fmt}: money cells rendered`).toBeGreaterThan(5);
        expect(m.sideways, `${fmt} @${width}: no sideways pan needed`).toBeLessThanOrEqual(1);
        expect(m.clipped, `${fmt} @${width}: every money column on screen`).toBe(0);
        // The last money header (LINE TOTAL / TOTAL) is what a finger lands on.
        const hit = await frame.evaluate(() => {
          const heads = [...document.querySelectorAll('th.num')];
          const th = heads[heads.length - 1];
          th.scrollIntoView({ block: 'center' });
          const r = th.getBoundingClientRect();
          const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!h && (h === th || th.contains(h));
        });
        expect(hit, `${fmt} @${width}: last money column header is on screen`).toBe(true);
      }
      // Desktop keeps the letter-size layout the documents were designed at.
      await page.setViewportSize({ width: 1280, height: 860 });
      await page.waitForTimeout(250);
      const pad = await frame.evaluate(() => getComputedStyle(document.body).paddingLeft);
      expect(pad, `${fmt}: desktop viewer layout unchanged`).toBe('36px');
      await page.setViewportSize({ width: 412, height: 860 });
      await safeEvaluate(page, () => window.NBDDocViewer.close());
    }
  });
});
