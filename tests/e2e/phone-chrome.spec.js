// tests/e2e/phone-chrome.spec.js — the customer page's fixed chrome must
// yield to what the rep is actually doing, on a phone.
//
// Phone audit 2026-09-25 (Jo runs NBD Pro from an Android at ~412px). On
// /pro/customer the bottom CALL / TEXT / EMAIL / TASK bar sat at z-index
// 99985, above every overlay on the page (all at --z-overlay 10000+). It
// painted over the document viewer's Save / Email / Print / Download PDF,
// the photo editor's tool strip, the estimate sheet's Edit / Archive /
// Close and every toast — and a tap on "Save to Customer" or "Edit" landed
// on the bar's tel: link and dialled the homeowner. The three field-tool
// FABs stood in a 166px column over the right edge of every panel, the
// Edit Photo sheet (z 9000) sat UNDER them, the editor's Save was
// off-screen, the upload modal buried its Upload button under the batch,
// and the pinned jump-nav left a see-through notch and landed jumps 140px
// down.
//
// Every assertion here is BEHAVIOUR: document.elementFromPoint at a
// control's centre must return that control, and taps are real taps.
// A class check ('.open') is what kept the pipeline menus "green" for
// months while nothing could be tapped.
//
// One login per describe (serial, shared page). Tagged @audit so the audit
// shard of the authed emulator job runs it. Local run:
//   cd tests && PLAYWRIGHT_BASE_URL=http://127.0.0.1:5000 \
//     PLAYWRIGHT_TEST_USER_EMAIL=playwright-e2e@nbd.test \
//     PLAYWRIGHT_TEST_USER_PASSWORD=nbd-e2e-password-1 \
//     npx playwright test --config=playwright.config.js phone-chrome.spec.js --workers=1
const { test, expect } = require('@playwright/test');
const { requireTestUser, loginAs, safeEvaluate, safeWaitForFunction } = require('./fixtures/auth');

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
// 1x1 PNG — enough for the upload modal to queue and preview a file.
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

// Context options the config's `use` would normally supply; a context made
// in beforeAll doesn't inherit them.
function contextOptions(testInfo, extra) {
  const u = testInfo.project.use || {};
  const pick = {};
  for (const k of ['baseURL', 'bypassCSP', 'proxy', 'ignoreHTTPSErrors']) if (u[k] !== undefined) pick[k] = u[k];
  return { ...pick, serviceWorkers: 'block', ...extra };
}

async function prepare(page) {
  // A mis-tap on the quick bar must never leave the page (tel:/sms:/mailto:
  // would navigate) — record it instead, so a test can assert none happened.
  await page.addInitScript(() => {
    document.addEventListener('click', (e) => {
      const a = e.target && e.target.closest && e.target.closest('a[href^="tel:"],a[href^="sms:"],a[href^="mailto:"]');
      if (a) { e.preventDefault(); window.__protoTaps = (window.__protoTaps || []).concat(a.getAttribute('href')); }
    }, true);
  });
  // "Close without saving?" etc. — accept, as a rep would.
  page.on('dialog', (d) => d.accept().catch(() => {}));
  // _saveLead geocodes via OSM, which rate-limits CI (same stub as pro-authed).
  await page.route('**/nominatim.openstreetmap.org/**', (route) =>
    route.fulfill({ contentType: 'application/json', body: '[]' }));
}

// Seed a lead with a phone + email (so the bar shows all four buttons), an
// estimate (for the preview sheet) and two photos (strip + Photos grid).
async function seedLead(page) {
  await safeWaitForFunction(page, () => !!(window._user && window._user.uid && typeof window._saveLead === 'function'), { timeout: 20_000 });
  const stamp = Date.now();
  return safeEvaluate(page, async (s) => {
    try {
      await window._saveLead({
        firstName: '[E2E] Chrome',
        lastName: String(s),
        address: `${String(s).slice(-3)} Chrome Layer Ct, Cincinnati, OH`,
        phone: '513' + String(s).slice(-7),
        email: `e2e-chrome-${s}@nbd.test`,
        stage: 'new',
        e2eTestData: true,
      });
    } catch (e) { if (!/ALREADY_EXISTS/.test(String(e && e.message || e))) throw e; }
    const fs = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const db = window.db || window._db;
    const uid = (window._auth || window.auth).currentUser.uid;
    const snap = await fs.getDocs(fs.query(fs.collection(db, 'leads'),
      fs.where('userId', '==', uid), fs.where('lastName', '==', String(s)), fs.where('e2eTestData', '==', true)));
    if (snap.empty) return null;
    const leadId = snap.docs[0].id;
    const add = async (coll, data) => {
      try { await fs.addDoc(fs.collection(db, coll), data); }
      catch (e) { if (!/ALREADY_EXISTS/.test(String(e && e.message || e))) throw e; }
    };
    await add('estimates', {
      leadId, userId: uid, type: 'Good', title: 'Good Estimate', status: 'Draft',
      amount: 12450.75, grandTotal: 12450.75, notes: '', createdBy: 'phone-chrome.spec',
      createdAt: fs.serverTimestamp(),
    });
    for (let i = 0; i < 2; i++) {
      await add('photos', {
        // Absolute: the strip only opens the editor for an http(s) URL.
        leadId, userId: uid, url: location.origin + '/pro/img/nbd-icon-512.png', filename: `chrome-${i}.png`,
        type: 'image/png', size: 1, phase: null, category: 'Property', damageType: '', severity: '', location: '',
        createdAt: fs.serverTimestamp(), date: fs.serverTimestamp(), uploadedAt: fs.serverTimestamp(),
      });
    }
    return leadId;
  }, stamp);
}

async function openCustomer(page, leadId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await page.goto(`/pro/customer.html?id=${leadId}`); break; }
    catch (e) {
      if (attempt === 2 || !/ERR_ABORTED|interrupted by another navigation/.test(String(e))) throw e;
      await page.waitForTimeout(1_500);
    }
  }
  await safeWaitForFunction(page, () => document.documentElement.style.opacity === '1', { timeout: 30_000 });
  const skip = page.getByText('Skip tour', { exact: true });
  if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => {});
}

// Topmost-element check at the centre of every match: the control a thumb
// aims for must be the control that receives the tap.
async function hitReport(page, selector) {
  return safeEvaluate(page, (sel) => [...document.querySelectorAll(sel)]
    .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
    .map((el) => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      const onScreen = x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight;
      const ok = onScreen && !!hit && (hit === el || el.contains(hit));
      const who = hit ? ((hit.closest('[id]') ? '#' + hit.closest('[id]').id + ' ' : '') + hit.tagName.toLowerCase()) : 'nothing (off-screen)';
      return { label: (el.innerText || el.getAttribute('aria-label') || el.title || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 30), ok, who };
    }), selector);
}

// The bar re-renders 120ms after any resize and slides in over 250ms;
// measure it at rest.
async function settleBar(page) {
  await page.waitForTimeout(200);
  await safeWaitForFunction(page, () => {
    const bar = document.getElementById('nbd-quick-action-bar');
    return !bar || bar.getAnimations().every((a) => a.playState === 'finished');
  }, { timeout: 5_000 });
}

// Toasts deliberately sit above every overlay (--z-toast); a lingering
// "Job costs saved" from an earlier test is not what a later test measures.
async function clearToasts(page) {
  await safeEvaluate(page, () => document.querySelectorAll('#toastContainer > div').forEach((t) => t.remove()));
}

function covered(report) {
  return report.filter((r) => !r.ok).map((r) => `"${r.label}" is under ${r.who}`);
}

// While an overlay is open, the page chrome must be BEHIND its backdrop:
// sample the bar and the corner where the FAB launcher lives.
async function chromeTopmostWhileOpen(page) {
  return safeEvaluate(page, () => {
    const out = [];
    const probe = (x, y) => {
      const hit = document.elementFromPoint(x, y);
      if (hit && hit.closest('#nbd-quick-action-bar,#nbd-fab-dial,#nbd-whisper-fab,#nbd-qc-fab,#nbd-qci-fab')) {
        out.push(`(${Math.round(x)},${Math.round(y)}) → #${hit.closest('[id]').id}`);
      }
    };
    const bar = document.getElementById('nbd-quick-action-bar');
    if (bar && bar.getClientRects().length) {
      const r = bar.getBoundingClientRect();
      for (let i = 1; i <= 4; i++) probe(r.left + (r.width * i) / 5, r.top + r.height / 2);
    }
    for (const id of ['nbd-fab-dial', 'nbd-whisper-fab', 'nbd-qc-fab', 'nbd-qci-fab']) {
      const el = document.getElementById(id);
      if (el && el.getClientRects().length) {
        const r = el.getBoundingClientRect();
        probe(r.left + r.width / 2, r.top + r.height / 2);
      }
    }
    return out;
  });
}

test.describe.serial('customer page chrome on a phone @audit', () => {
  let creds = null;
  let ctx;
  let page;
  let leadId;

  test.beforeAll(async ({ browser }, testInfo) => {
    try { creds = requireTestUser(); } catch (e) { console.warn('[phone-chrome] ' + e.message); return; }
    testInfo.setTimeout(120_000);
    ctx = await browser.newContext(contextOptions(testInfo, {
      viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true, userAgent: ANDROID_UA,
    }));
    page = await ctx.newPage();
    await prepare(page);
    await loginAs(page, creds);
    leadId = await seedLead(page);
    expect(leadId, 'seeded [E2E] Chrome lead has an id').toBeTruthy();
    await openCustomer(page, leadId);
    await page.waitForSelector('#nbd-quick-action-bar .qab-call', { timeout: 15_000 });
  });

  test.afterAll(async () => { if (ctx) await ctx.close(); });

  test.beforeEach(async ({}, testInfo) => {
    if (!creds) testInfo.skip(true, 'PLAYWRIGHT_TEST_USER_EMAIL not set');
  });

  test('document viewer footer is reachable, not the bar under it', async () => {
    for (const width of [412, 360]) {
      await page.setViewportSize({ width, height: 860 });
      await settleBar(page);
      const more = page.locator('#qaMoreBtn');
      if (await more.isVisible().catch(() => false) && !(await page.locator('.quick-actions [data-action="exportCustomerPDF"]').isVisible())) {
        await more.tap();
      }
      const report = page.locator('.quick-actions [data-action="exportCustomerPDF"]');
      await report.scrollIntoViewIfNeeded();
      await report.tap();
      await page.waitForSelector('#nbd-doc-viewer-overlay.open .nbdv-action-btn', { timeout: 30_000 });
      await page.waitForTimeout(500);
      const footer = await hitReport(page, '#nbd-doc-viewer-overlay .nbdv-action-btn');
      expect(footer.length, `viewer footer buttons at ${width}px`).toBeGreaterThanOrEqual(4);
      expect(covered(footer), `viewer footer at ${width}px`).toEqual([]);
      expect(await chromeTopmostWhileOpen(page), `page chrome above the viewer at ${width}px`).toEqual([]);
      await page.locator('#nbdv-close').tap();
      await expect(page.locator('#nbd-doc-viewer-overlay.open')).toHaveCount(0);
    }
    await page.setViewportSize({ width: 412, height: 860 });
  });

  test('estimate sheet Edit / Archive / Close are the sheet, and Close closes it', async () => {
    await clearToasts(page);
    for (const width of [412, 360]) {
      await page.setViewportSize({ width, height: 860 });
      await settleBar(page);
      await safeEvaluate(page, () => { window.__protoTaps = []; });
      const row = page.locator('.nbd-est-row').first();
      await row.scrollIntoViewIfNeeded();
      // Top-left of the row: its centre carries the row's own Export button.
      await row.tap({ position: { x: 24, y: 14 } });
      await page.waitForSelector('.ep-overlay .ep-actions button', { timeout: 10_000 });
      // The sheet slides up from below the screen; measure it once it lands.
      await safeWaitForFunction(page, () => {
        const b = document.querySelector('.ep-overlay .ep-actions button');
        return !!b && b.getBoundingClientRect().bottom <= innerHeight;
      }, { timeout: 5_000 });
      await page.waitForTimeout(300);
      const actions = await hitReport(page, '.ep-overlay .ep-actions button');
      expect(actions.length, `sheet actions at ${width}px`).toBeGreaterThanOrEqual(3);
      expect(covered(actions), `sheet actions at ${width}px`).toEqual([]);
      // Real tap on Close. Before the fix this hit the bar's TASK button:
      // the task modal opened behind a sheet that stayed open.
      await page.locator('.ep-overlay .ep-actions button', { hasText: /close/i }).tap();
      await expect(page.locator('.ep-overlay')).toHaveCount(0);
      await expect(page.locator('#taskModal.open')).toHaveCount(0);
      expect(await safeEvaluate(page, () => window.__protoTaps || []), 'no call/text/email fired').toEqual([]);
    }
    await page.setViewportSize({ width: 412, height: 860 });
  });

  test('a save toast shows above the bar and leaves CALL / TASK tappable', async () => {
    await settleBar(page);
    const save = page.locator('[data-pt-action="save"]').first();
    await save.scrollIntoViewIfNeeded();
    await save.tap();
    const toast = page.locator('#toastContainer > div', { hasText: /costs saved/i }).last();
    await expect(toast).toBeVisible({ timeout: 10_000 });
    const r = await safeEvaluate(page, () => {
      const t = [...document.querySelectorAll('#toastContainer > div')].filter((d) => /costs saved/i.test(d.textContent)).pop();
      const tr = t.getBoundingClientRect();
      const hit = document.elementFromPoint(tr.left + tr.width / 2, tr.top + tr.height / 2);
      const bar = document.getElementById('nbd-quick-action-bar').getBoundingClientRect();
      const barBtns = [...document.querySelectorAll('#nbd-quick-action-bar .qab-btn')].map((b) => {
        const br = b.getBoundingClientRect();
        const h = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
        return { label: b.textContent.trim(), ok: !!h && (h === b || b.contains(h)), who: h ? h.tagName + '.' + String(h.className).slice(0, 30) : 'null' };
      });
      const dial = document.getElementById('nbd-fab-dial');
      const dr = dial && dial.getClientRects().length ? dial.getBoundingClientRect() : null;
      return {
        toastOnTop: !!hit && t.contains(hit),
        toastBottom: tr.bottom, barTop: bar.top,
        barBtns,
        overlapsLauncher: !!dr && !(tr.bottom <= dr.top || tr.top >= dr.bottom || tr.right <= dr.left || tr.left >= dr.right),
      };
    });
    expect(r.toastOnTop, 'the toast is the topmost thing where it sits').toBe(true);
    expect(r.toastBottom, 'the toast sits above the quick-action bar').toBeLessThanOrEqual(r.barTop);
    expect(r.barBtns.filter((b) => !b.ok), 'bar buttons stay tappable while a toast shows').toEqual([]);
    expect(r.overlapsLauncher, 'the toast clears the field-tools launcher').toBe(false);
  });

  test('in-flight upload indicator rides above the bar', async () => {
    await clearToasts(page);
    // updateGlobalUploadStatus() shows the widget by adding .active while a
    // batch uploads with the modal closed; drive that state directly rather
    // than pushing real files through Storage.
    await safeEvaluate(page, () => document.getElementById('nbdUploadWidget').classList.add('active'));
    try {
      expect(covered(await hitReport(page, '#nbdUploadWidgetReopen')), '"View details" on the upload indicator').toEqual([]);
    } finally {
      await safeEvaluate(page, () => document.getElementById('nbdUploadWidget').classList.remove('active'));
    }
  });

  test('warranty claim modal covers the page chrome', async () => {
    await clearToasts(page);
    // The same call a stage move into Warranty Claim makes
    // (customer-bootstrap.module.js progressStage → promptIntake).
    await safeEvaluate(page, () => { window.__wcDone = window.WarrantyClaim.promptIntake(window._currentLead || {}).then(() => true); });
    await page.waitForSelector('#nbd-warranty-claim-modal button', { timeout: 5_000 });
    expect(covered(await hitReport(page, '#nbd-warranty-claim-modal button, #nbd-warranty-claim-modal textarea, #nbd-warranty-claim-modal select')), 'warranty modal controls').toEqual([]);
    expect(await chromeTopmostWhileOpen(page), 'bar / launcher above the warranty backdrop').toEqual([]);
    await page.locator('#nbd-warranty-claim-modal button', { hasText: /^cancel$/i }).tap();
    await expect(page.locator('#nbd-warranty-claim-modal')).toHaveCount(0);
  });

  test('field tools collapse behind one launcher and fan out on tap', async () => {
    await clearToasts(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    const parked = await safeEvaluate(page, () => ['nbd-whisper-fab', 'nbd-qc-fab', 'nbd-qci-fab']
      .filter((id) => document.getElementById(id))
      .map((id) => {
        const el = document.getElementById(id);
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { id, tappable: !!hit && (hit === el || el.contains(hit)), opacity: getComputedStyle(el).opacity };
      }));
    expect(parked.length, 'the three field tools exist').toBe(3);
    expect(parked.filter((t) => t.tappable || t.opacity !== '0'), 'closed dial: tools parked, faded and untappable').toEqual([]);

    const dial = page.locator('#nbd-fab-dial');
    await expect(dial).toBeVisible();
    expect(covered(await hitReport(page, '#nbd-fab-dial')), 'launcher is tappable').toEqual([]);
    await dial.tap();
    await safeWaitForFunction(page, () => getComputedStyle(document.getElementById('nbd-whisper-fab')).opacity === '1', { timeout: 5_000 });
    const fanned = await hitReport(page, '#nbd-whisper-fab, #nbd-qc-fab, #nbd-qci-fab');
    expect(covered(fanned), 'fanned-out tools are tappable').toEqual([]);
    const clear = await safeEvaluate(page, () => {
      const bar = document.getElementById('nbd-quick-action-bar').getBoundingClientRect();
      return ['nbd-whisper-fab', 'nbd-qc-fab', 'nbd-qci-fab', 'nbd-fab-dial'].filter((id) => {
        const r = document.getElementById(id).getBoundingClientRect();
        return r.bottom > bar.top || r.left < 0 || r.right > innerWidth;
      });
    });
    expect(clear, 'fan row sits above the bar and inside the screen').toEqual([]);
    await page.touchscreen.tap(40, 300);
    await safeWaitForFunction(page, () => getComputedStyle(document.getElementById('nbd-whisper-fab')).opacity === '0', { timeout: 5_000 });

    // The bar re-renders and slides in again on every resize and data
    // refresh. fab-stack-coordinator.js used to measure it mid-slide (still
    // below the screen), publish an 8px corner claim, and leave the launcher
    // parked ON the bar's TASK button until its 1.5s safety re-check.
    await page.setViewportSize({ width: 360, height: 860 });
    await page.setViewportSize({ width: 412, height: 860 });
    await settleBar(page);
    const afterRerender = await safeEvaluate(page, () => {
      const dial = document.getElementById('nbd-fab-dial').getBoundingClientRect();
      const bar = document.getElementById('nbd-quick-action-bar').getBoundingClientRect();
      const task = document.querySelector('#nbd-quick-action-bar .qab-task');
      const tr = task.getBoundingClientRect();
      const hit = document.elementFromPoint(tr.left + tr.width / 2, tr.top + tr.height / 2);
      return { dialBottom: dial.bottom, barTop: bar.top, taskOk: !!hit && task.contains(hit) };
    });
    expect(afterRerender.dialBottom, 'launcher stays above the bar right after it re-renders').toBeLessThanOrEqual(afterRerender.barTop);
    expect(afterRerender.taskOk, 'TASK is tappable right after the bar re-renders').toBe(true);
  });

  test('Edit Photo sheet covers the page chrome; Delete is the sheet', async () => {
    await clearToasts(page);
    const tile = page.locator('.nbd-phase-photo').first();
    await tile.scrollIntoViewIfNeeded();
    await tile.tap();
    await page.waitForSelector('#photoActionPopup [data-action="deletePhoto"]', { timeout: 10_000 });
    const btns = await hitReport(page, '#photoActionPopup button');
    expect(covered(btns), 'every Edit Photo control').toEqual([]);
    expect(await chromeTopmostWhileOpen(page), 'bar / launcher above the Edit Photo backdrop').toEqual([]);
    const close = await safeEvaluate(page, () => {
      const r = document.querySelector('#photoActionPopup [data-action="_closePhotoActionPopup"]').getBoundingClientRect();
      return { w: r.width, h: r.height };
    });
    expect(Math.min(close.w, close.h), 'close × is thumb-sized').toBeGreaterThanOrEqual(40);
    await page.locator('#photoActionPopup [data-action="_closePhotoActionPopup"]').tap();
    await expect(page.locator('#photoActionPopup')).toHaveCount(0);
  });

  test('photo editor: tools, Save and Toggle Panel are reachable by a finger', async () => {
    await clearToasts(page);
    const item = page.locator('#photoList .nbd-photo-item').first();
    await item.scrollIntoViewIfNeeded();
    await item.tap();
    await page.waitForSelector('.nbd-editor-overlay #nbd-toolbar .nbd-tool-btn', { timeout: 15_000 });
    await page.waitForTimeout(600);
    // First eight tools fit on screen at 412; the rest scroll (overflow-x).
    const tools = (await hitReport(page, '.nbd-editor-overlay #nbd-toolbar .nbd-tool-btn')).slice(0, 8);
    expect(covered(tools), 'on-screen editor tools').toEqual([]);
    expect(covered(await hitReport(page, '.nbd-editor-overlay [data-act="save-over"]')), 'Save is on screen and tappable').toEqual([]);
    expect(await chromeTopmostWhileOpen(page), 'page chrome above the editor').toEqual([]);
    // Toggle Panel (the only way into the damage-tag drawer) sits at the end
    // of the top bar's swipe strip: drag it into view with a real touch.
    const y = await safeEvaluate(page, () => {
      const r = document.querySelector('.nbd-editor-overlay [data-act="save-over"]').getBoundingClientRect();
      return Math.round(r.top + r.height / 2);
    });
    const cdp = await page.context().newCDPSession(page);
    const pt = (x) => [{ x: Math.round(x), y, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(380) });
    for (let i = 1; i <= 12; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(380 - 25 * i) });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(500);
    expect(covered(await hitReport(page, '.nbd-editor-overlay [data-act="toggle-panel"]')), 'Toggle Panel after a swipe').toEqual([]);
    await page.locator('.nbd-editor-overlay [data-act="toggle-panel"]').tap();
    await expect(page.locator('#nbd-panel.open')).toHaveCount(1);
    await page.locator('.nbd-editor-overlay [data-act="back"]').tap();
    await expect(page.locator('.nbd-editor-overlay')).toHaveCount(0, { timeout: 5_000 });
  });

  test('upload modal keeps Upload on screen with a batch queued', async () => {
    await clearToasts(page);
    const open = page.locator('[data-action="openUploadModal"]').first();
    await open.scrollIntoViewIfNeeded();
    await open.tap();
    await page.waitForSelector('#uploadModal.open #uploadZone');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#uploadZone').tap()]);
    await chooser.setFiles(Array.from({ length: 15 }, (_, i) => ({ name: `batch-${i}.png`, mimeType: 'image/png', buffer: PNG_1PX })));
    await expect(page.locator('#uploadCount')).toHaveText('15', { timeout: 15_000 });
    // No scrolling: the rep must see the primary action as soon as the batch lands.
    const btns = await hitReport(page, '#uploadModal #uploadBtn, #uploadModal .upload-actions button');
    expect(btns.length, 'Upload + Cancel rendered').toBe(2);
    expect(covered(btns), 'Upload / Cancel with 15 queued').toEqual([]);
    expect(await chromeTopmostWhileOpen(page), 'page chrome above the upload modal').toEqual([]);
    await page.locator('#uploadModal .upload-actions button', { hasText: 'Cancel' }).tap();
    await expect(page.locator('#uploadModal.open')).toHaveCount(0);
  });

  test('pinned jump-nav spans the width and a jump lands just under it', async () => {
    await clearToasts(page);
    for (const width of [412, 360]) {
      await page.setViewportSize({ width, height: 860 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
      const chip = page.locator('#tabBar a[href="#photosTab"]');
      await chip.scrollIntoViewIfNeeded();
      await chip.tap();
      await page.waitForTimeout(900);
      const r = await safeEvaluate(page, () => {
        const nav = document.getElementById('tabBar').getBoundingClientRect();
        const sec = document.getElementById('photosTab').getBoundingClientRect();
        const vw = document.documentElement.clientWidth;
        const y = nav.top + nav.height / 2;
        // The container's side padding is the only gap allowed beside the bar.
        const pad = parseFloat(getComputedStyle(document.getElementById('tabBar').parentElement).paddingRight) || 0;
        const leaks = [];
        for (let x = nav.left + nav.width * 0.6; x < vw - pad - 1; x += 8) {
          const hit = document.elementFromPoint(x, y);
          if (!hit || !hit.closest('#tabBar')) leaks.push(Math.round(x) + ':' + (hit ? hit.tagName.toLowerCase() : 'null'));
        }
        return { navTop: nav.top, navBottom: nav.bottom, secTop: sec.top, leaks };
      });
      expect(r.navTop, `bar pinned at ${width}px`).toBeLessThanOrEqual(1);
      expect(r.leaks, `page shows through beside the pinned bar at ${width}px`).toEqual([]);
      expect(r.secTop, `section starts below the bar at ${width}px`).toBeGreaterThanOrEqual(r.navBottom - 1);
      expect(r.secTop - r.navBottom, `gap between bar and section at ${width}px`).toBeLessThanOrEqual(24);
    }
    await page.setViewportSize({ width: 412, height: 860 });
  });
});

// Desktop keeps its layout: no bar, no launcher, the classic FAB stack, and
// the jump landing fix (the doubled offset was a desktop bug too).
test.describe.serial('customer page chrome on desktop @audit', () => {
  let creds = null;
  let ctx;
  let page;
  let leadId;

  test.beforeAll(async ({ browser }, testInfo) => {
    try { creds = requireTestUser(); } catch (e) { return; }
    testInfo.setTimeout(120_000);
    ctx = await browser.newContext(contextOptions(testInfo, { viewport: { width: 1280, height: 860 } }));
    page = await ctx.newPage();
    await prepare(page);
    await loginAs(page, creds);
    leadId = await seedLead(page);
    expect(leadId, 'seeded lead').toBeTruthy();
    await openCustomer(page, leadId);
    await page.waitForTimeout(2_000); // past the bar's 1.5s deferred render
  });

  test.afterAll(async () => { if (ctx) await ctx.close(); });

  test.beforeEach(async ({}, testInfo) => {
    if (!creds) testInfo.skip(true, 'PLAYWRIGHT_TEST_USER_EMAIL not set');
  });

  test('no phone chrome on desktop; FABs stay a tappable stack; jumps land under the bar', async () => {
    const r = await safeEvaluate(page, () => {
      const vis = (id) => { const el = document.getElementById(id); return !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none'; };
      return { bar: vis('nbd-quick-action-bar'), dial: vis('nbd-fab-dial') };
    });
    expect(r.bar, 'quick-action bar hidden on desktop').toBe(false);
    expect(r.dial, 'speed-dial launcher hidden on desktop').toBe(false);
    expect(covered(await hitReport(page, '#nbd-whisper-fab, #nbd-qc-fab, #nbd-qci-fab')), 'desktop FAB stack').toEqual([]);

    await page.locator('#tabBar a[href="#photosTab"]').click();
    await page.waitForTimeout(900);
    const j = await safeEvaluate(page, () => ({
      navBottom: document.getElementById('tabBar').getBoundingClientRect().bottom,
      secTop: document.getElementById('photosTab').getBoundingClientRect().top,
    }));
    expect(j.secTop, 'section starts below the bar').toBeGreaterThanOrEqual(j.navBottom - 1);
    expect(j.secTop - j.navBottom, 'gap between bar and section').toBeLessThanOrEqual(24);
  });
});
