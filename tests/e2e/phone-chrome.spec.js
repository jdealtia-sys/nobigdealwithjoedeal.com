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
// down. Follow-ups (review:chrome): the Voice Intel error toast still sat on
// the bar, and toasts landed on the in-flight upload indicator's "View
// details" (phone and desktop) — both now stack clear.
//
// Every assertion here is BEHAVIOUR: document.elementFromPoint at a
// control's centre must return that control, and taps are real taps.
// A class check ('.open') is what kept the pipeline menus "green" for
// months while nothing could be tapped.
//
// One login per describe (serial, shared page); the phone tests walk 412
// and 360 (PHONE_WIDTHS). Each describe seeds one lead + estimate + two
// photos and deletes them by tag in afterAll (fixtures/seeded-run.js).
// Tagged @audit so the audit shard of the authed emulator job runs it.
// Local run:
//   cd tests && PLAYWRIGHT_BASE_URL=http://127.0.0.1:5000 \
//     PLAYWRIGHT_TEST_USER_EMAIL=playwright-e2e@nbd.test \
//     PLAYWRIGHT_TEST_USER_PASSWORD=nbd-e2e-password-1 \
//     npx playwright test --config=playwright.config.js phone-chrome.spec.js --workers=1
const { test, expect } = require('@playwright/test');
const { requireTestUser, loginAs, safeEvaluate, safeWaitForFunction } = require('./fixtures/auth');
const { deleteSeededRun } = require('./fixtures/seeded-run');

// Jo's Android, then the small-Android floor of the standing phone rule.
// 2026-09-25 follow-up: the toast, upload, warranty, launcher, dictation,
// Edit Photo, editor and upload-modal tests ran at 412 only while the
// findings they pin were measured at 412 AND 360; each now walks both.
const PHONE_WIDTHS = [412, 360];

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
// 1x1 PNG — enough for the upload modal to queue and preview a file.
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

// A fake microphone, so the dictation test can record for real. Keeps the
// config's pinned-Chromium escape hatch (test.use replaces launchOptions).
test.use({
  launchOptions: {
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

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
// Every doc carries e2eTestData:true and the describe's `run` tag, so its
// afterAll can delete them by tag (fixtures/seeded-run.js) — until the
// 2026-09-25 follow-up they stayed in the emulator for every later spec in
// the shard, two leads per run and more with CI retries.
async function seedLead(page, stamp, run) {
  await safeWaitForFunction(page, () => !!(window._user && window._user.uid && typeof window._saveLead === 'function'), { timeout: 20_000 });
  return safeEvaluate(page, ({ s, tag }) => {
    window.__e2eSeeding = (async () => {
      try {
        await window._saveLead({
          firstName: '[E2E] Chrome',
          lastName: String(s),
          address: `${String(s).slice(-3)} Chrome Layer Ct, Cincinnati, OH`,
          phone: '513' + String(s).slice(-7),
          email: `e2e-chrome-${s}@nbd.test`,
          stage: 'new',
          e2eTestData: true,
          e2eRun: tag,
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
        createdAt: fs.serverTimestamp(), e2eTestData: true, e2eRun: tag,
      });
      for (let i = 0; i < 2; i++) {
        await add('photos', {
          // Absolute: the strip only opens the editor for an http(s) URL.
          leadId, userId: uid, url: location.origin + '/pro/img/nbd-icon-512.png', filename: `chrome-${i}.png`,
          type: 'image/png', size: 1, phase: null, category: 'Property', damageType: '', severity: '', location: '',
          createdAt: fs.serverTimestamp(), date: fs.serverTimestamp(), uploadedAt: fs.serverTimestamp(),
          e2eTestData: true, e2eRun: tag,
        });
      }
      return leadId;
    })();
    return window.__e2eSeeding;
  }, { s: stamp, tag: run });
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

// The bar re-renders (remove + rebuild) 120ms after any resize and 60ms
// after every nbd:data-refreshed, then slides in over 250ms. Measure it
// present and at rest: on a phone an absent bar would make every "is the
// bar on top?" probe below pass vacuously.
async function settleBar(page) {
  await page.waitForTimeout(200);
  await safeWaitForFunction(page, () => {
    const bar = document.getElementById('nbd-quick-action-bar');
    if (!bar) return innerWidth > 640;
    return !!bar.querySelector('.qab-call') && bar.getAnimations().every((a) => a.playState === 'finished');
  }, { timeout: 8_000 });
}

// Toasts deliberately sit above every overlay (--z-toast); a lingering
// "Job costs saved" from an earlier test is not what a later test measures.
async function clearToasts(page) {
  await safeEvaluate(page, () => document.querySelectorAll('#toastContainer > div').forEach((t) => t.remove()));
  await settleBar(page);
}

// The in-flight upload indicator, raised the way a rep raises it
// (2026-09-25, #1767 review): queue a photo, put it in flight — the state
// uploadPhotos() gives each item before its Storage put — and tap Cancel.
// _uploadModalOnClose keeps the running batch, and updateGlobalUploadStatus()
// shows the widget AND publishes --nbd-upload-lift in the same task. These
// tests used to add .active by hand, which skipped that call and left the
// lift to the widget's ResizeObserver a frame later; the toast was measured
// before it rose (flaky in CI at 412px, red locally at 1280px, and 16 of 24
// rig rounds overlapped). Returns the lift and the widget height it read.
async function raiseUploadIndicator(page, { touch }) {
  const press = (loc) => (touch ? loc.tap() : loc.click());
  const open = page.locator('[data-action="openUploadModal"]:visible').first();
  await open.scrollIntoViewIfNeeded();
  await press(open);
  await page.waitForSelector('#uploadModal.open #uploadZone');
  await page.locator('#fileInput').setInputFiles({ name: 'roof.png', mimeType: 'image/png', buffer: PNG_1PX });
  await expect(page.locator('#uploadCount')).toHaveText('1', { timeout: 15_000 });
  await safeEvaluate(page, () => { const it = window._uploadQueue[0]; it.uploading = true; it.progress = 40; });
  await press(page.locator('#uploadModal button.btn[data-action="closeUploadModal"]'));
  await expect(page.locator('#uploadModal.open')).toHaveCount(0);
  await expect(page.locator('#nbdUploadWidget.active')).toBeVisible();
  return safeEvaluate(page, () => ({
    lift: getComputedStyle(document.documentElement).getPropertyValue('--nbd-upload-lift').trim(),
    height: document.getElementById('nbdUploadWidget').offsetHeight,
  }));
}

// ...and taken down the way a finished batch takes it down: the item leaves
// the in-flight set and updateGlobalUploadStatus() hides the widget and drops
// the lift. removeFromQueue() is the page global that runs that refresh (a
// no-op splice on an empty queue), so this is also the cleanup after a
// failure — it first closes a modal a failed step left open.
async function finishUpload(page) {
  await safeEvaluate(page, () => {
    if (document.querySelector('#uploadModal.open')) window.closeUploadModal();
    window.removeFromQueue(0);
  });
}

// RGBA of one screen pixel. A 1x1 clip screenshot is a PNG whose IDAT
// inflates to [filter byte, R, G, B(, A)] — no image library needed.
async function pixelAt(page, x, y) {
  const png = await page.screenshot({ clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 } });
  const zlib = require('zlib');
  const idat = [];
  let colorType = 6;
  for (let o = 8; o < png.length;) {
    const len = png.readUInt32BE(o);
    const type = png.toString('ascii', o + 4, o + 8);
    if (type === 'IHDR') colorType = png[o + 8 + 9];
    if (type === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  return { r: raw[1], g: raw[2], b: raw[3], a: colorType === 6 ? raw[4] : 255 };
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
  let run = ''; // e2eRun tag on everything this describe seeds

  test.beforeAll(async ({ browser }, testInfo) => {
    try { creds = requireTestUser(); } catch (e) { console.warn('[phone-chrome] ' + e.message); return; }
    testInfo.setTimeout(120_000);
    // Tagged before the first write, so afterAll finds the seeds even if
    // this hook dies before leadId is assigned.
    const stamp = Date.now();
    run = `phone-chrome@phone:${stamp}`;
    ctx = await browser.newContext(contextOptions(testInfo, {
      viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true, userAgent: ANDROID_UA,
      permissions: ['microphone'],
    }));
    page = await ctx.newPage();
    await prepare(page);
    await loginAs(page, creds);
    leadId = await seedLead(page, stamp, run);
    expect(leadId, 'seeded [E2E] Chrome lead has an id').toBeTruthy();
    await openCustomer(page, leadId);
    await page.waitForSelector('#nbd-quick-action-bar .qab-call', { timeout: 15_000 });
  });

  test.afterAll(async ({}, testInfo) => {
    testInfo.setTimeout(120_000); // a stalled rig: seed + pending writes + retried lookups (fixtures/seeded-run.js)
    const res = await deleteSeededRun({ page, context: ctx, creds, run });
    if (res.failed.length) console.warn('[phone-chrome] cleanup: ' + res.failed.join('; '));
    if (ctx) await ctx.close();
  });

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
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 860 });
      await clearToasts(page); // one toast per width: the last width's must not stack under this one
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
      expect(r.toastOnTop, `the toast is the topmost thing where it sits at ${width}px`).toBe(true);
      expect(r.toastBottom, `the toast sits above the quick-action bar at ${width}px`).toBeLessThanOrEqual(r.barTop);
      expect(r.barBtns.filter((b) => !b.ok), `bar buttons stay tappable while a toast shows at ${width}px`).toEqual([]);
      expect(r.overlapsLauncher, `the toast clears the field-tools launcher at ${width}px`).toBe(false);
    }
    await page.setViewportSize({ width: 412, height: 860 });
  });

  test('a Voice Intel error toast sits above the bar, not on CALL / TEXT / EMAIL / TASK', async () => {
    // Follow-up (review:chrome): #toastContainer was lifted above the bar but
    // the Voice Intel toast kept bottom:20px, so for its 5s life it covered
    // TEXT / EMAIL / TASK. voice-intelligence.js showToast() appends exactly
    // this element to the panel root on a recording or upload failure; the
    // feature is flag-gated, so build it the same way instead of recording.
    for (const width of [412, 360]) {
      await page.setViewportSize({ width, height: 860 });
      await clearToasts(page);
      const r = await safeEvaluate(page, () => {
        const t = document.createElement('div');
        t.className = 'nbd-voice-toast nbd-voice-toast-err';
        t.textContent = 'Upload failed: network error while sending the recording';
        (document.getElementById('voiceIntelRoot') || document.body).appendChild(t);
        try {
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
            painted: tr.width > 0 && tr.height > 0,
            toastOnTop: !!hit && t.contains(hit),
            toastBottom: tr.bottom, toastLeft: tr.left, barTop: bar.top,
            barBtns,
            overlapsLauncher: !!dr && !(tr.bottom <= dr.top || tr.top >= dr.bottom || tr.right <= dr.left || tr.left >= dr.right),
          };
        } finally { t.remove(); }
      });
      expect(r.painted, `voice toast renders at ${width}px`).toBe(true);
      expect(r.toastOnTop, `the voice toast is the topmost thing where it sits at ${width}px`).toBe(true);
      expect(r.toastBottom, `the voice toast sits above the quick-action bar at ${width}px`).toBeLessThanOrEqual(r.barTop);
      expect(r.toastLeft, `the voice toast keeps a gutter at ${width}px`).toBeGreaterThanOrEqual(8);
      expect(r.barBtns.filter((b) => !b.ok), `bar buttons stay tappable under a voice toast at ${width}px`).toEqual([]);
      expect(r.overlapsLauncher, `the voice toast clears the field-tools launcher at ${width}px`).toBe(false);
    }
    await page.setViewportSize({ width: 412, height: 860 });
  });

  test('in-flight upload indicator rides above the bar, and toasts stack above it', async () => {
    // A batch left uploading behind a closed modal — the real show path, not
    // a hand-added .active (see raiseUploadIndicator). Raised and finished
    // once per width: each pass measures the lift its own show published, and
    // the indicator is down again before the next width re-renders the bar.
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 860 });
      await clearToasts(page);
      try {
        const up = await raiseUploadIndicator(page, { touch: true });
        expect(up.lift, `the indicator publishes its lift as it shows at ${width}px`).toBe(`${up.height + 8}px`);
        expect(covered(await hitReport(page, '#nbdUploadWidgetReopen')), `"View details" on the upload indicator at ${width}px`).toEqual([]);
        // Follow-up (review:chrome): the widget and #toastContainer shared one
        // bottom offset in one corner, so a toast raised mid-upload sat on
        // "View details" for its whole life. A real toast now stacks above.
        await safeEvaluate(page, () => window.showToast('Customer info updated', 'success'));
        const toast = page.locator('#toastContainer > div', { hasText: 'Customer info updated' }).last();
        await expect(toast).toBeVisible();
        const s = await safeEvaluate(page, () => {
          const w = document.getElementById('nbdUploadWidget').getBoundingClientRect();
          const t = [...document.querySelectorAll('#toastContainer > div')].filter((d) => /Customer info updated/.test(d.textContent)).pop();
          const tr = t.getBoundingClientRect();
          const hit = document.elementFromPoint(tr.left + tr.width / 2, tr.top + tr.height / 2);
          return { overlap: !(tr.bottom <= w.top || tr.top >= w.bottom || tr.right <= w.left || tr.left >= w.right), toastOnTop: !!hit && t.contains(hit) };
        });
        expect(s.overlap, `the toast and the upload indicator overlap at ${width}px`).toBe(false);
        expect(s.toastOnTop, `the toast is the topmost thing where it sits at ${width}px`).toBe(true);
        expect(covered(await hitReport(page, '#nbdUploadWidgetReopen')), `"View details" while a toast shows at ${width}px`).toEqual([]);
        // ...and so does the Voice Intel toast.
        const v = await safeEvaluate(page, () => {
          document.querySelectorAll('#toastContainer > div').forEach((d) => d.remove());
          const t = document.createElement('div');
          t.className = 'nbd-voice-toast nbd-voice-toast-err';
          t.textContent = 'Recording failed';
          (document.getElementById('voiceIntelRoot') || document.body).appendChild(t);
          try {
            const w = document.getElementById('nbdUploadWidget').getBoundingClientRect();
            const tr = t.getBoundingClientRect();
            return !(tr.bottom <= w.top || tr.top >= w.bottom || tr.right <= w.left || tr.left >= w.right);
          } finally { t.remove(); }
        });
        expect(v, `the voice toast and the upload indicator overlap at ${width}px`).toBe(false);
      } finally {
        await finishUpload(page);
      }
      await expect(page.locator('#nbdUploadWidget.active'), `the indicator is down again after ${width}px`).toHaveCount(0);
    }
    await page.setViewportSize({ width: 412, height: 860 });
  });

  test('warranty claim modal covers the page chrome', async () => {
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 860 });
      await clearToasts(page);
      // The same call a stage move into Warranty Claim makes
      // (customer-bootstrap.module.js progressStage → promptIntake).
      await safeEvaluate(page, () => { window.__wcDone = window.WarrantyClaim.promptIntake(window._currentLead || {}).then(() => true); });
      await page.waitForSelector('#nbd-warranty-claim-modal button', { timeout: 5_000 });
      expect(covered(await hitReport(page, '#nbd-warranty-claim-modal button, #nbd-warranty-claim-modal textarea, #nbd-warranty-claim-modal select')), `warranty modal controls at ${width}px`).toEqual([]);
      expect(await chromeTopmostWhileOpen(page), `bar / launcher above the warranty backdrop at ${width}px`).toEqual([]);
      await page.locator('#nbd-warranty-claim-modal button', { hasText: /^cancel$/i }).tap();
      await expect(page.locator('#nbd-warranty-claim-modal')).toHaveCount(0);
    }
    await page.setViewportSize({ width: 412, height: 860 });
  });

  test('field tools collapse behind one launcher and fan out on tap', async () => {
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 860 });
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
      expect(parked.length, `the three field tools exist at ${width}px`).toBe(3);
      expect(parked.filter((t) => t.tappable || t.opacity !== '0'), `closed dial: tools parked, faded and untappable at ${width}px`).toEqual([]);

      const dial = page.locator('#nbd-fab-dial');
      await expect(dial).toBeVisible();
      expect(covered(await hitReport(page, '#nbd-fab-dial')), `launcher is tappable at ${width}px`).toEqual([]);
      await dial.tap();
      await safeWaitForFunction(page, () => getComputedStyle(document.getElementById('nbd-whisper-fab')).opacity === '1', { timeout: 5_000 });
      const fanned = await hitReport(page, '#nbd-whisper-fab, #nbd-qc-fab, #nbd-qci-fab');
      expect(covered(fanned), `fanned-out tools are tappable at ${width}px`).toEqual([]);
      const clear = await safeEvaluate(page, () => {
        const bar = document.getElementById('nbd-quick-action-bar').getBoundingClientRect();
        return ['nbd-whisper-fab', 'nbd-qc-fab', 'nbd-qci-fab', 'nbd-fab-dial'].filter((id) => {
          const r = document.getElementById(id).getBoundingClientRect();
          return r.bottom > bar.top || r.left < 0 || r.right > innerWidth;
        });
      });
      expect(clear, `fan row sits above the bar and inside the screen at ${width}px`).toEqual([]);
      await page.touchscreen.tap(40, 300);
      await safeWaitForFunction(page, () => getComputedStyle(document.getElementById('nbd-whisper-fab')).opacity === '0', { timeout: 5_000 });
    }
    await page.setViewportSize({ width: 412, height: 860 });

    // The bar re-renders and slides in again on every resize and data
    // refresh. fab-stack-coordinator.js used to measure it mid-slide (still
    // below the screen), publish an 8px corner claim, and leave the launcher
    // parked ON the bar's TASK button until its 1.5s safety re-check.
    // Whether that re-check lands before the probe is chance (~20% per
    // re-render), so run three re-renders: the old code slips all three
    // well under 1% of the time.
    const misses = [];
    for (let i = 0; i < 3; i++) {
      await page.setViewportSize({ width: 360, height: 860 });
      await page.setViewportSize({ width: 412, height: 860 });
      await settleBar(page);
      const r = await safeEvaluate(page, () => {
        const dial = document.getElementById('nbd-fab-dial').getBoundingClientRect();
        const bar = document.getElementById('nbd-quick-action-bar').getBoundingClientRect();
        const task = document.querySelector('#nbd-quick-action-bar .qab-task');
        const tr = task.getBoundingClientRect();
        const hit = document.elementFromPoint(tr.left + tr.width / 2, tr.top + tr.height / 2);
        return { dialBottom: dial.bottom, barTop: bar.top, taskOk: !!hit && task.contains(hit) };
      });
      if (r.dialBottom > r.barTop || !r.taskOk) misses.push(`re-render ${i + 1}: launcher bottom ${Math.round(r.dialBottom)} vs bar top ${Math.round(r.barTop)}, TASK tappable ${r.taskOk}`);
    }
    expect(misses, 'launcher stays above the bar and TASK stays tappable right after the bar re-renders').toEqual([]);
  });

  test('dictation: the recording pill and the result stay off the mic', async () => {
    await clearToasts(page);
    // Never let a test reach a real transcription backend: in CI a callable
    // can resolve to production (ci-e2e-calls-production-functions). Answer
    // it here in the callable wire format.
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
    const answer = (route) => (route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: cors })
      : route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ result: { transcript: 'check the ridge vent', cleaned: 'Check the ridge vent.' } }) }));
    await page.route('**/dictate', answer);
    await page.route('**/transcribeVoiceMemo', answer);
    try {
      for (const width of PHONE_WIDTHS) {
        await page.setViewportSize({ width, height: 860 });
        await clearToasts(page);
        await page.evaluate(() => { window.scrollTo(0, 0); if (document.activeElement) document.activeElement.blur(); });
        await page.locator('#nbd-fab-dial').tap();
        const mic = page.locator('#nbd-whisper-fab');
        await safeWaitForFunction(page, () => getComputedStyle(document.getElementById('nbd-whisper-fab')).opacity === '1', { timeout: 5_000 });
        await mic.tap();
        await safeWaitForFunction(page, () => {
          const v = document.getElementById('nbd-whisper-viz');
          return /⏹/.test(document.getElementById('nbd-whisper-fab').textContent) && !!v && v.style.display !== 'none';
        }, { timeout: 10_000 });
        await page.waitForTimeout(1_200); // a clip long enough to be sent
        // Before the fix the pill sat on the mic, so ⏹ — the only way to stop
        // a dictation short of the 60s ceiling — hit-tested as the pill.
        expect(covered(await hitReport(page, '#nbd-whisper-fab')), `the ⏹ stop control while recording at ${width}px`).toEqual([]);
        await mic.tap();
        await safeWaitForFunction(page, () => !/⏹/.test(document.getElementById('nbd-whisper-fab').textContent), { timeout: 5_000 });
        await page.waitForSelector('#nbd-whisper-tip', { timeout: 10_000 });
        expect(covered(await hitReport(page, '#nbd-whisper-fab, #nbd-qc-fab, #nbd-qci-fab, #nbd-fab-dial')), `field tools with the dictation result showing at ${width}px`).toEqual([]);
        await page.locator('#nbd-whisper-tip .nbd-whisper-tip-close').tap();
        await expect(page.locator('#nbd-whisper-tip')).toHaveCount(0);
        await page.touchscreen.tap(40, 300); // fold the dial for the next width
        await safeWaitForFunction(page, () => getComputedStyle(document.getElementById('nbd-whisper-fab')).opacity === '0', { timeout: 5_000 });
      }
    } finally {
      await page.unroute('**/dictate');
      await page.unroute('**/transcribeVoiceMemo');
      // A failure mid-loop leaves the dial open; a tap on a closed dial's
      // page would land on whatever sits at (40, 300).
      if (await safeEvaluate(page, () => getComputedStyle(document.getElementById('nbd-whisper-fab')).opacity !== '0').catch(() => false)) {
        await page.touchscreen.tap(40, 300);
      }
      await page.setViewportSize({ width: 412, height: 860 });
    }
  });

  test('Edit Photo sheet covers the page chrome; Delete is the sheet', async () => {
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 860 });
      await clearToasts(page);
      const tile = page.locator('.nbd-phase-photo').first();
      await tile.scrollIntoViewIfNeeded();
      await tile.tap();
      await page.waitForSelector('#photoActionPopup [data-action="deletePhoto"]', { timeout: 10_000 });
      const btns = await hitReport(page, '#photoActionPopup button');
      expect(covered(btns), `every Edit Photo control at ${width}px`).toEqual([]);
      expect(await chromeTopmostWhileOpen(page), `bar / launcher above the Edit Photo backdrop at ${width}px`).toEqual([]);
      const close = await safeEvaluate(page, () => {
        const r = document.querySelector('#photoActionPopup [data-action="_closePhotoActionPopup"]').getBoundingClientRect();
        return { w: r.width, h: r.height };
      });
      expect(Math.min(close.w, close.h), `close × is thumb-sized at ${width}px`).toBeGreaterThanOrEqual(40);
      await page.locator('#photoActionPopup [data-action="_closePhotoActionPopup"]').tap();
      await expect(page.locator('#photoActionPopup')).toHaveCount(0);
    }
    await page.setViewportSize({ width: 412, height: 860 });
  });

  test('photo editor: tools, Save and Toggle Panel are reachable by a finger', async () => {
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 860 });
      await clearToasts(page);
      const item = page.locator('#photoList .nbd-photo-item').first();
      await item.scrollIntoViewIfNeeded();
      await item.tap();
      await page.waitForSelector('.nbd-editor-overlay #nbd-toolbar .nbd-tool-btn', { timeout: 15_000 });
      await page.waitForTimeout(600);
      // The tool strip scrolls sideways (overflow-x), so the tools a finger
      // can reach without a swipe are the ones whose centre is on screen:
      // eight at 412; at 360 the eighth (Text) sits past the edge (2026-09-25
      // review of the chrome lane). Every one of those must take the tap, and
      // at least that many must fit, so a collapsed strip can't pass empty.
      const tools = await safeEvaluate(page, () => [...document.querySelectorAll('.nbd-editor-overlay #nbd-toolbar .nbd-tool-btn')]
        .map((el) => {
          const r = el.getBoundingClientRect();
          const x = r.left + r.width / 2;
          const y = r.top + r.height / 2;
          const onScreen = r.width > 0 && x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight;
          const hit = onScreen ? document.elementFromPoint(x, y) : null;
          return { label: (el.title || el.getAttribute('aria-label') || el.textContent).trim().slice(0, 20), onScreen, ok: !!hit && (hit === el || el.contains(hit)), who: hit ? (hit.id ? '#' + hit.id + ' ' : '') + hit.tagName.toLowerCase() : 'off-screen' };
        }).filter((t) => t.onScreen));
      expect(tools.length, `editor tools reachable without a swipe at ${width}px`).toBeGreaterThanOrEqual(width >= 412 ? 8 : 7);
      expect(covered(tools), `on-screen editor tools at ${width}px`).toEqual([]);
      expect(covered(await hitReport(page, '.nbd-editor-overlay [data-act="save-over"]')), `Save is on screen and tappable at ${width}px`).toEqual([]);
      expect(await chromeTopmostWhileOpen(page), `page chrome above the editor at ${width}px`).toEqual([]);
      // Toggle Panel (the only way into the damage-tag drawer) sits at the end
      // of the top bar's swipe strip: drag it into view with a real touch,
      // starting 32px in from this width's right edge. One 300px swipe
      // reaches it at 412; the strip is 52px narrower at 360 and takes a
      // second, as it would for a thumb. Three that never get there fail.
      const toggle = '.nbd-editor-overlay [data-act="toggle-panel"]';
      const y = await safeEvaluate(page, () => {
        const r = document.querySelector('.nbd-editor-overlay [data-act="save-over"]').getBoundingClientRect();
        return Math.round(r.top + r.height / 2);
      });
      const cdp = await page.context().newCDPSession(page);
      const pt = (x) => [{ x: Math.round(x), y, id: 1 }];
      const x0 = width - 32;
      for (let swipes = 0; swipes < 3; swipes++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x0) });
        for (let i = 1; i <= 12; i++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x0 - 25 * i) });
          await page.waitForTimeout(16);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(500);
        const r = await hitReport(page, toggle);
        if (r.length && !covered(r).length) break;
      }
      await cdp.detach().catch(() => {});
      const tp = await hitReport(page, toggle);
      expect(tp.length, `Toggle Panel is rendered at ${width}px`).toBe(1);
      expect(covered(tp), `Toggle Panel after swiping the top bar at ${width}px`).toEqual([]);
      await page.locator('.nbd-editor-overlay [data-act="toggle-panel"]').tap();
      await expect(page.locator('#nbd-panel.open')).toHaveCount(1);
      await page.locator('.nbd-editor-overlay [data-act="back"]').tap();
      await expect(page.locator('.nbd-editor-overlay')).toHaveCount(0, { timeout: 5_000 });
    }
    await page.setViewportSize({ width: 412, height: 860 });
  });

  test('upload modal keeps Upload on screen with a batch queued', async () => {
    for (const width of PHONE_WIDTHS) {
      await page.setViewportSize({ width, height: 860 });
      await clearToasts(page);
      const open = page.locator('[data-action="openUploadModal"]').first();
      await open.scrollIntoViewIfNeeded();
      await open.tap();
      await page.waitForSelector('#uploadModal.open #uploadZone');
      // openUploadModal empties the queue, so each width starts from 0.
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#uploadZone').tap()]);
      await chooser.setFiles(Array.from({ length: 15 }, (_, i) => ({ name: `batch-${i}.png`, mimeType: 'image/png', buffer: PNG_1PX })));
      await expect(page.locator('#uploadCount')).toHaveText('15', { timeout: 15_000 });
      // No scrolling: the rep must see the primary action as soon as the batch lands.
      // Selected by role, not by the footer's class, so a break-test against
      // the old markup fails on reachability rather than on a missing class.
      const btns = await hitReport(page, '#uploadModal #uploadBtn, #uploadModal button.btn[data-action="closeUploadModal"]');
      expect(btns.length, `Upload + Cancel rendered at ${width}px`).toBe(2);
      expect(covered(btns), `Upload / Cancel with 15 queued at ${width}px`).toEqual([]);
      expect(await chromeTopmostWhileOpen(page), `page chrome above the upload modal at ${width}px`).toEqual([]);
      await page.locator('#uploadModal button.btn[data-action="closeUploadModal"]').tap();
      await expect(page.locator('#uploadModal.open')).toHaveCount(0);
    }
    await page.setViewportSize({ width: 412, height: 860 });
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

      // Hit-testing can't see a mask: a masked-out edge still hit-tests as
      // the bar while painting whatever scrolls under it. Put a red band
      // UNDER the pinned bar and read the pixel at the bar's right edge.
      const edge = await safeEvaluate(page, () => {
        const band = document.createElement('div');
        band.id = '__chromeProbeBand';
        band.style.cssText = 'position:fixed;left:0;right:0;top:0;height:64px;background:#ff0000;z-index:1;pointer-events:none;';
        document.body.appendChild(band);
        const nav = document.getElementById('tabBar').getBoundingClientRect();
        return { x: nav.right - 3, y: nav.top + nav.height / 2 };
      });
      try {
        const px = await pixelAt(page, edge.x, edge.y);
        expect(px.r - Math.max(px.g, px.b), `red band shows through the pinned bar's right edge at ${width}px (rgb ${px.r},${px.g},${px.b})`).toBeLessThan(80);
      } finally {
        await safeEvaluate(page, () => { const b = document.getElementById('__chromeProbeBand'); if (b) b.remove(); });
      }
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
  let run = '';

  test.beforeAll(async ({ browser }, testInfo) => {
    try { creds = requireTestUser(); } catch (e) { return; }
    testInfo.setTimeout(120_000);
    const stamp = Date.now();
    run = `phone-chrome@desktop:${stamp}`;
    ctx = await browser.newContext(contextOptions(testInfo, { viewport: { width: 1280, height: 860 } }));
    page = await ctx.newPage();
    await prepare(page);
    await loginAs(page, creds);
    leadId = await seedLead(page, stamp, run);
    expect(leadId, 'seeded lead').toBeTruthy();
    await openCustomer(page, leadId);
    await page.waitForTimeout(2_000); // past the bar's 1.5s deferred render
  });

  test.afterAll(async ({}, testInfo) => {
    testInfo.setTimeout(120_000);
    const res = await deleteSeededRun({ page, context: ctx, creds, run });
    if (res.failed.length) console.warn('[phone-chrome desktop] cleanup: ' + res.failed.join('; '));
    if (ctx) await ctx.close();
  });

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

  test('a toast raised mid-upload stacks above the upload indicator, and drops back after', async () => {
    // Desktop had the same overlap (widget bottom:16px, toasts bottom:20px,
    // both right-aligned): "View details" sat under every toast.
    await safeEvaluate(page, () => document.querySelectorAll('#toastContainer > div').forEach((d) => d.remove()));
    const measure = () => safeEvaluate(page, () => {
      const w = document.getElementById('nbdUploadWidget');
      const wr = w.getBoundingClientRect();
      const t = [...document.querySelectorAll('#toastContainer > div')].filter((d) => /Job costs saved/.test(d.textContent)).pop();
      // A toast that has timed out reads as "not dropped back" (null), not a
      // TypeError that hides which assertion failed.
      if (!t) return { active: w.classList.contains('active'), overlap: null, reopenOk: null, toastBottom: null };
      const tr = t.getBoundingClientRect();
      const re = document.getElementById('nbdUploadWidgetReopen').getBoundingClientRect();
      const h = document.elementFromPoint(re.left + re.width / 2, re.top + re.height / 2);
      return {
        active: w.classList.contains('active'),
        overlap: w.classList.contains('active') && !(tr.bottom <= wr.top || tr.top >= wr.bottom || tr.right <= wr.left || tr.left >= wr.right),
        reopenOk: !w.classList.contains('active') || (!!h && h.id === 'nbdUploadWidgetReopen'),
        toastBottom: tr.bottom,
      };
    });
    try {
      // The real show path (see raiseUploadIndicator), then the toast.
      const lifted = await raiseUploadIndicator(page, { touch: false });
      expect(lifted.lift, 'the indicator publishes its lift as it shows').toBe(`${lifted.height + 8}px`);
      await safeEvaluate(page, () => window.showToast('Job costs saved', 'success'));
      await expect(page.locator('#toastContainer > div', { hasText: 'Job costs saved' }).last()).toBeVisible();
      const up = await measure();
      expect(up.overlap, 'toast vs upload indicator').toBe(false);
      expect(up.reopenOk, '"View details" is not under the toast').toBe(true);
      // Upload finished: the widget hides and the stack settles back down.
      await finishUpload(page);
      await expect(page.locator('#nbdUploadWidget.active')).toHaveCount(0);
      await expect.poll(async () => (await measure()).toastBottom, { message: 'toast drops back once the indicator hides' }).toBeGreaterThan(up.toastBottom + 40);
    } finally {
      await finishUpload(page);
    }
  });
});
