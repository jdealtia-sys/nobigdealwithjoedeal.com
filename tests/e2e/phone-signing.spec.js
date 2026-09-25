// tests/e2e/phone-signing.spec.js — the signing and review pages on a phone.
//
// The 2026-09-25 phone audit (lane "signing") confirmed five defects on the
// pages a homeowner signs on and the rep's photo review, each reproduced at
// 412px (Jo's Android) and 360px:
//   homeowner#2  sign.html showed a contract at PRINT size: 9-10px clause
//                text (the 3-day cancellation notice included) in a 277px
//                column under a 66px blank band.
//   homeowner#3  the signature pad's Clear / Undo were 22px tall.
//   homeowner#6  esign "Next field" silently TICKED a required checkbox the
//                signer was never shown the words of.
//   homeowner#9  Photo Review's chips (the Review Sprint control) were 21px,
//                and the "x/y reviewed" counter was hidden on phones.
//   homeowner#10 the sandbox's per-card arrows, the only touch control that
//                moves a card, were 26x22.
//
// Every assertion here is BEHAVIOURAL: sizes measured with
// getBoundingClientRect, reachability by hit-testing the control's centre
// with elementFromPoint, and actions done with real taps. The pipeline menus
// stayed "green" for months because a test only checked a class name.
//
// The contract is also held to the rule that matters most: the phone layout
// lives only on screen. The record POSTed to submitSignature must be the
// same bytes whichever layout the signer saw, and printing the live phone
// document must produce the same PDF as printing the stored original.
//
// Cloud Functions (getSignDocument / submitSignature / getEsignEnvelope /
// submitEsignEnvelope) are mocked with page.route. Tagged @audit so the
// authed emulator job's audit shard runs it.
const { test, expect } = require('@playwright/test');
const { requireTestUser, loginAs, safeEvaluate, safeWaitForFunction } = require('./fixtures/auth');

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://nobigdealwithjoedeal.com';
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)([:/]|$)/.test(BASE);
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const PHONES = [412, 360];
const DESKTOP = 1280;

function ctxOpts(width) {
  const o = { baseURL: BASE, viewport: { width, height: 860 }, serviceWorkers: 'block', ...(LOCAL ? { bypassCSP: true } : {}) };
  return width < 1000 ? { ...o, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625, userAgent: UA } : o;
}

function fulfillJson(route, body, status) {
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  return route.fulfill({ status: status || 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

// Runs in the page/frame: is `sel`'s centre actually `sel` (not covered)?
// Returns the element's box too, so callers assert size and reach at once.
function probeFn(sel) {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { w: r.width, h: r.height, left: r.left, right: r.right, top: r.top, reach: !!hit && (hit === el || el.contains(hit)) };
}

// ── homeowner#2 / #3: remote contract on sign.html ─────────────────────
test.describe('phone signing: remote contract on sign.html @audit', () => {
  test('contract reads at phone size, pads have finger-sized controls, the record is unchanged', async ({ page, browser }) => {
    test.setTimeout(150_000);
    let creds;
    try { creds = requireTestUser(); } catch (e) { test.skip(true, e.message); return; }

    // A REAL contract from the generator, so the template's own inch-based
    // CSS and inline 9px clause blocks are what gets measured.
    await loginAs(page, creds);
    await safeWaitForFunction(page, () => window.ScriptLoader && typeof window.ScriptLoader.loadBundle === 'function', { timeout: 30_000 });
    const contract = await safeEvaluate(page, async () => {
      await window.ScriptLoader.loadBundle('docgen');
      for (let i = 0; i < 100 && !(window.NBDDocGen && window.NBDDocGen.getHTML); i++) await new Promise((r) => setTimeout(r, 100));
      try { if (window._loadCompanyProfile) await window._loadCompanyProfile(); } catch (_) {}
      const data = {
        homeownerName: 'Pat Phone', address: '118 Maple Ridge Ct, Loveland, OH 45140',
        phone: '(513) 555-0142', email: 'pat@example.com', contractPrice: '$18,430.00', startDate: '2026-10-05',
        signers: [{ role: 'homeowner', label: 'Homeowner', required: true }, { role: 'contractor', label: 'Contractor', required: true }],
        lineItems: [
          { description: 'Tear-off and replace architectural shingles', qty: 32, unit: 'SQ', unitPrice: 485 },
          { description: 'Ice and water shield, eaves and valleys', qty: 6, unit: 'RL', unitPrice: 95 },
        ],
      };
      return window.NBDDocGen._injectSignatureAssets(window.NBDDocGen.getHTML('contract', data));
    });
    expect(contract, 'generator produced a contract with signature pads').toMatch(/data-nbd-sig="homeowner"/);

    const records = {};
    let livePhoneDoc = null;
    for (const width of [...PHONES, DESKTOP]) {
      await test.step(`${width}px`, async () => {
        const phone = width < 1000;
        const ctx = await browser.newContext(ctxOpts(width));
        try {
          const p = await ctx.newPage();
          let signed = null;
          await p.route('**/getSignDocument', (r) => fulfillJson(r, { html: contract, docTypeName: 'Roofing Contract' }));
          await p.route('**/submitSignature', (r) => {
            if (r.request().method() === 'POST') signed = JSON.parse(r.request().postData()).signedHtml;
            return fulfillJson(r, { ok: true });
          });
          await p.goto('/pro/sign.html?token=phonesigning000000001');
          await expect(p.locator('#spFoot')).toBeVisible({ timeout: 20_000 });
          const frameEl = await p.$('#spFrame');
          const f = await frameEl.contentFrame();
          await f.waitForFunction(() => window.__NBD_LOADED && window.__NBD_LOADED['signature-widget'], null, { timeout: 15_000 });

          const m = await f.evaluate(() => {
            const title = [...document.querySelectorAll('.section-title')].find((e) => /Cancellation/i.test(e.textContent));
            const clause = title.nextElementSibling;
            const sec = title.closest('.section');
            const cs = getComputedStyle(sec);
            let minFont = Infinity;
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            for (let n; (n = walker.nextNode());) {
              if (!n.textContent.trim()) continue;
              const el = n.parentElement;
              // The pad's own controls are the widget's, asserted below.
              if (el.closest('.nbd-sig-controls')) continue;
              const c = getComputedStyle(el);
              const b = el.getBoundingClientRect();
              if (c.display === 'none' || c.visibility === 'hidden' || (!b.width && !b.height)) continue;
              minFont = Math.min(minFont, parseFloat(c.fontSize));
            }
            return {
              clauseFont: parseFloat(getComputedStyle(clause).fontSize),
              column: sec.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - parseFloat(cs.borderLeftWidth),
              headerTop: document.querySelector('.document-header').getBoundingClientRect().top + scrollY,
              overflow: document.documentElement.scrollWidth - innerWidth,
              minFont,
            };
          });
          if (phone) {
            expect(m.clauseFont, 'cancellation clause text size').toBeGreaterThanOrEqual(15);
            expect(m.minFont, 'smallest visible text in the contract').toBeGreaterThanOrEqual(12);
            expect(m.column, 'contract text column width').toBeGreaterThanOrEqual(width * 0.8);
            expect(m.headerTop, 'blank band above the contract header').toBeLessThanOrEqual(1);
          } else {
            // Desktop keeps the paper layout exactly as it was.
            expect(m.clauseFont, 'desktop clause text unchanged').toBe(9);
            expect(m.headerTop, 'desktop page offset unchanged').toBe(66);
          }
          expect(m.overflow, 'contract scrolls sideways').toBeLessThanOrEqual(0);
          if (phone && !livePhoneDoc) livePhoneDoc = await f.evaluate(() => '<!DOCTYPE html>\n' + document.documentElement.outerHTML);

          // Draw a stroke on a pad the way a finger drags across it.
          const draw = async (role) => {
            await f.evaluate((r) => document.querySelector(`[data-nbd-sig="${r}"]`).scrollIntoView({ block: 'center' }), role);
            const fr = await frameEl.boundingBox();
            const c = await f.evaluate((r) => { const b = document.querySelector(`[data-nbd-sig="${r}"] canvas`).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width }; }, role);
            await p.mouse.move(fr.x + c.x + 20, fr.y + c.y + 40);
            await p.mouse.down();
            for (let i = 1; i <= 12; i++) await p.mouse.move(fr.x + c.x + 20 + i * ((c.w - 40) / 12), fr.y + c.y + 40 + (i % 3) * 12);
            await p.mouse.up();
          };
          await draw('homeowner');
          const hb = '[data-nbd-sig="homeowner"]';
          await expect(f.locator(`${hb} .nbd-sig-state`)).toHaveText(/signed/);
          for (const action of ['clear', 'undo']) {
            const b = await f.evaluate(probeFn, `${hb} [data-nbd-sig-action="${action}"]`);
            if (phone) {
              expect(b.h, `${action} button height`).toBeGreaterThanOrEqual(40);
              expect(b.reach, `${action} button is the element under its own centre`).toBe(true);
            } else {
              expect(b.h, `desktop ${action} button unchanged`).toBeLessThanOrEqual(24);
            }
          }
          const stateFont = await f.evaluate((sel) => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize), `${hb} .nbd-sig-state`);
          if (phone) expect(stateFont, '"✓ signed" label size').toBeGreaterThanOrEqual(13);
          // A real tap on Clear must empty the pad.
          const clear = f.locator(`${hb} [data-nbd-sig-action="clear"]`);
          if (phone) await clear.tap(); else await clear.click();
          await expect(f.locator(`${hb} .nbd-sig-state`)).toHaveText('');
          const ink = await f.evaluate((sel) => {
            const cv = document.querySelector(sel + ' canvas');
            const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
            let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
            return n;
          }, hb);
          expect(ink, 'pad is blank after Clear').toBe(0);

          await draw('homeowner');
          await draw('contractor');
          await p.locator('#spSubmit').click();
          await expect(p.locator('#spMsgTitle')).toHaveText(/All done/, { timeout: 15_000 });
          expect(signed, 'submitSignature received the signed document').toBeTruthy();
          expect(signed, 'phone layout sheet kept out of the signed record').not.toContain('nbd-sign-phone');
          expect(signed, 'touch sheet kept out of the signed record').not.toContain('nbd-sig-touch');
          // What legitimately varies between signings: the drawn PNGs, the
          // signing timestamps and the date stamp.
          records[width] = signed
            .replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, 'PNG')
            .replace(/data-nbd-sig-signed-at="[^"]*"/g, 'data-nbd-sig-signed-at=""')
            .replace(/Signed [A-Z][a-z]+ \d{1,2}, \d{4}/g, 'Signed DATE');
        } finally {
          await ctx.close();
        }
      });
    }

    // The executed record does not depend on which layout the signer saw.
    for (const width of PHONES) {
      expect(records[width] === records[DESKTOP], `signed record at ${width}px is byte-identical to desktop's`).toBe(true);
    }

    // Printing the live phone document (phone + touch sheets present) gives
    // the same PDF as printing the stored original: both sheets are screen-only.
    const pdfOf = async (html) => {
      const ctx = await browser.newContext(ctxOpts(DESKTOP));
      try {
        const p = await ctx.newPage();
        await p.setContent(html, { waitUntil: 'load' });
        const buf = await p.pdf({ format: 'Letter', printBackground: true });
        // Chromium stamps creation/mod dates and a random document ID.
        return buf.toString('latin1').replace(/\/(CreationDate|ModDate) \([^)]*\)/g, '').replace(/\/ID \[<[0-9A-Fa-f]+> <[0-9A-Fa-f]+>\]/g, '');
      } finally { await ctx.close(); }
    };
    expect(livePhoneDoc, 'the live phone document carried the phone sheet').toContain('id="nbd-sign-phone"');
    const [livePdf, storedPdf] = [await pdfOf(livePhoneDoc), await pdfOf(contract)];
    expect(livePdf === storedPdf, 'print of the live phone document matches print of the stored contract').toBe(true);
  });
});

// ── homeowner#6: esign "Next field" ────────────────────────────────────
// A one-page PDF built by hand (no pdf-lib in tests/): a heading, a 16pt
// box with the acknowledgement beside it in 10pt Helvetica — the size the
// audit measured at 5.5-6.3px on a phone at fit scale.
function tinyPdf() {
  const esc = (s) => s.replace(/[()\\]/g, (c) => '\\' + c);
  const text = (x, y, size, s) => `BT /F1 ${size} Tf ${x} ${y} Td (${esc(s)}) Tj ET`;
  const content = [
    text(60, 740, 16, 'ROOFING AGREEMENT'),
    '1 w 60 500 16 16 re S',
    text(84, 504, 10, 'I have read and agree to the Terms & Conditions and the 3-day right to cancel.'),
    text(60, 440, 10, 'Initials: ________'),
    text(60, 300, 10, 'Signature: ______________________      Date: ____________'),
  ].join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1').toString('base64');
}

test.describe('phone signing: esign Next field never ticks a box @audit', () => {
  test('Next shows the words beside a checkbox and waits for the signer to check it', async ({ browser }) => {
    test.setTimeout(90_000);
    const envelope = {
      title: 'Roofing Agreement', companyName: '', signerName: 'Pat Phone', consentText: 'I agree to sign electronically.',
      pages: [{ w: 612, h: 792, rotation: 0 }], pdf: tinyPdf(),
      // label:'' is what production writes (esign-setup.js, esign-autodetect.js).
      fields: [
        { id: 'ini', type: 'initials', page: 0, x: 110, y: 436, w: 64, h: 40, required: true, label: '' },
        { id: 'ack', type: 'checkbox', page: 0, x: 60, y: 500, w: 16, h: 16, required: true, label: '' },
        { id: 'sig', type: 'signature', page: 0, x: 120, y: 296, w: 190, h: 46, required: true, label: '' },
        { id: 'dt', type: 'date', page: 0, x: 390, y: 296, w: 120, h: 22, required: true, label: '' },
      ],
    };
    for (const width of [...PHONES, DESKTOP]) {
      await test.step(`${width}px`, async () => {
        const phone = width < 1000;
        const ctx = await browser.newContext(ctxOpts(width));
        try {
          const p = await ctx.newPage();
          let submitted = null;
          await p.route('**/getEsignEnvelope', (r) => fulfillJson(r, envelope));
          await p.route('**/submitEsignEnvelope', (r) => {
            if (r.request().method() === 'POST') submitted = JSON.parse(r.request().postData());
            return fulfillJson(r, { ok: true });
          });
          const tap = (loc) => (phone ? loc.tap() : loc.click());
          const ack = p.locator('.es-field[data-field-id="ack"]');
          const isDone = () => ack.evaluate((n) => n.classList.contains('is-done'));
          await p.goto('/pro/esign?t=phonesigning000000001');
          await expect(p.locator('.es-field')).toHaveCount(4, { timeout: 30_000 });

          await tap(p.locator('#esNext'));                      // -> initials
          await expect(p.locator('#esSheet')).toBeVisible();
          await tap(p.locator('#esTabs button[data-mode="type"]'));
          await p.locator('#esTypeInput').fill('PP');
          await tap(p.locator('#esApply'));
          await expect(p.locator('#esSheet')).toBeHidden();
          await expect(p.locator('#esProgress')).toHaveText('1 of 4');

          await tap(p.locator('#esNext'));                      // -> the checkbox
          await expect(p.locator('#esSheet'), 'Next on a checkbox opens a sheet').toBeVisible();
          expect(await isDone(), 'Next did not tick the box by itself').toBe(false);
          await expect(p.locator('#esProgress')).toHaveText('1 of 4');

          // The excerpt shows the page's own words, drawn at a readable scale.
          await p.waitForFunction(() => {
            const c = document.querySelector('#esExcerpt canvas');
            if (!c) return false;
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] && d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 90) dark++;
            return dark > 400;
          }, null, { timeout: 10_000 });
          const ex = await p.evaluate(() => {
            const c = document.querySelector('#esExcerpt canvas');
            const panel = document.querySelector('#esSheet .es-sheet-panel');
            const mark = document.querySelector('#esExcerpt .es-excerpt-box');
            const r = mark.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return {
              pxPerPt: c.getBoundingClientRect().width / 612,
              boxOnScreen: !!hit && document.getElementById('esExcerpt').contains(hit),
              panelSideways: panel.scrollWidth - panel.clientWidth,
            };
          });
          expect(ex.pxPerPt * 10, 'CSS px of 10pt document text in the excerpt').toBeGreaterThanOrEqual(14);
          expect(ex.boxOnScreen, 'the outlined box is visible in the excerpt').toBe(true);
          expect(ex.panelSideways, 'the sheet itself never scrolls sideways (only the excerpt does)').toBeLessThanOrEqual(1);

          const check = await p.evaluate(probeFn, '#esApply');
          expect(check.h, 'Check-this-box button height').toBeGreaterThanOrEqual(44);
          expect(check.reach, 'Check-this-box button is reachable').toBe(true);
          await expect(p.locator('#esApply')).toHaveText(/Check this box/);
          await tap(p.locator('#esApply'));                     // the signer's own act
          await expect(p.locator('#esSheet')).toBeHidden();
          expect(await isDone(), 'box is checked after the signer checks it').toBe(true);
          await expect(p.locator('#esProgress')).toHaveText('2 of 4');

          await tap(p.locator('#esNext'));                      // -> signature
          await expect(p.locator('#esSheet')).toBeVisible();
          await expect(p.locator('#esApply'), 'a later sheet is back to Apply').toHaveText('Apply');
          await tap(p.locator('#esTabs button[data-mode="type"]'));
          await p.locator('#esTypeInput').fill('Pat Phone');
          await tap(p.locator('#esApply'));
          await expect(p.locator('#esSheet')).toBeHidden();
          await tap(p.locator('#esNext'));                      // -> date (prefilled)
          await expect(p.locator('#esSheet')).toBeVisible();
          await tap(p.locator('#esApply'));
          await expect(p.locator('#esProgress')).toHaveText('4 of 4');
          await tap(p.locator('#esFinish'));
          await tap(p.locator('#esConsent'));
          await tap(p.locator('#esSubmit'));
          await expect(p.locator('#esMsgTitle')).toHaveText(/All done/, { timeout: 15_000 });
          expect(submitted && submitted.values && submitted.values.ack, 'posted checkbox value').toEqual({ checked: true });
        } finally {
          await ctx.close();
        }
      });
    }
  });
});

// ── homeowner#9: Photo Review chips / counter / bulk bar ───────────────
test.describe('phone signing: photo review controls @audit', () => {
  test('chips, filters and bulk actions are finger-sized and the reviewed count shows', async ({ browser }) => {
    test.setTimeout(120_000);
    let creds;
    try { creds = requireTestUser(); } catch (e) { test.skip(true, e.message); return; }
    const ctx = await browser.newContext(ctxOpts(412));
    try {
      const page = await ctx.newPage();
      // Expose the module's state + render so photos can be shown without
      // Storage uploads. Nothing is written: only EMPTY chips are tapped
      // (they open the picker), never a value.
      await page.route('**/pro/js/pages/photo-review.js*', async (route) => {
        const resp = await route.fetch();
        const body = (await resp.text()) + '\n;window.__prPhoneTest = { state, render };\n';
        await route.fulfill({ response: resp, body, headers: { ...resp.headers(), 'content-type': 'application/javascript' } });
      });
      await loginAs(page, creds);

      // No lead record on purpose. The page needs a signed-in user (auth
      // gate) but what is measured is renderTile()'s output for injected
      // photos, which does not read the lead. Seeding one made this test
      // hostage to Firestore: with the emulator under load ("client is
      // offline") the save + read-back timed the test out, twice in a row.
      // A missing lead ends in the page's own "Couldn't load this lead"
      // branch, after which render() draws the injected grid.
      await page.goto('/pro/photo-review.html?lead=phone-signing-no-such-lead');
      await page.waitForFunction(() => window.__prPhoneTest
        && (window.__prPhoneTest.state.unsub || /Couldn.t load this lead/.test(document.getElementById('prBody').textContent)),
      null, { timeout: 30_000 });
      await page.evaluate(() => {
        const st = window.__prPhoneTest.state;
        // A live /photos listener's first (empty) snapshot would wipe the
        // injected photos if it landed after them.
        if (st.unsub) { st.unsub(); st.unsub = null; }
        const img = 'data:image/gif;base64,R0lGODlhAQABAIAAAMLCwgAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==';
        const photos = [];
        for (let i = 0; i < 8; i++) {
          const ph = { id: 'phoneReview' + i, url: img, urls: { thumb: img }, uploadedAt: { seconds: 1700000000 + i } };
          if (i % 4 === 1) ph.aiSuggestion = { phase: 'Before', damageType: 'hail', severity: 'moderate', confidence: 0.86 };
          if (i % 4 === 2) { ph.aiSuggestion = { phase: 'During', confidence: 0.6 }; ph.phase = 'During'; }
          photos.push(ph);
        }
        const s = window.__prPhoneTest.state;
        s.photos = photos; s.photosById.clear();
        for (const ph of photos) s.photosById.set(ph.id, ph);
        window.__prPhoneTest.render();
      });
      await expect(page.locator('.pr-chip').first()).toBeVisible();

      for (const width of [...PHONES, DESKTOP]) {
        await test.step(`${width}px`, async () => {
          const phone = width < 1000;
          await page.setViewportSize({ width, height: 860 });
          await page.evaluate(() => window.scrollTo(0, 0));
          const m = await page.evaluate(() => {
            const vw = document.documentElement.clientWidth;
            const hs = (sel) => [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect().height);
            const counter = document.getElementById('prCounter');
            const cr = counter.getBoundingClientRect();
            const hit = document.elementFromPoint(cr.left + cr.width / 2, cr.top + cr.height / 2);
            return {
              chipH: Math.min(...hs('.pr-chip')), maxChipH: Math.max(...hs('.pr-chip')),
              filterH: Math.min(...hs('.pr-filter')),
              counter: { shown: cr.width > 0 && cr.height > 0 && cr.left >= 0 && cr.right <= vw, reach: !!hit && counter.contains(hit), text: counter.textContent },
              overflow: document.documentElement.scrollWidth - vw,
            };
          });
          expect(m.counter.shown, 'the "x/y reviewed" counter is on screen').toBe(true);
          expect(m.counter.reach, 'the counter is not covered').toBe(true);
          expect(m.counter.text).toMatch(/\d+\/8 reviewed/);
          expect(m.overflow, 'page scrolls sideways').toBeLessThanOrEqual(0);
          if (!phone) {
            expect(m.maxChipH, 'desktop chips keep the dense layout').toBeLessThanOrEqual(24);
            return;
          }
          expect(m.chipH, 'shortest chip').toBeGreaterThanOrEqual(36);
          expect(m.filterH, 'shortest filter pill').toBeGreaterThanOrEqual(38);

          // A real tap on an empty chip opens its picker.
          const chip = page.locator('.pr-chip[data-state="empty"]').first();
          await chip.scrollIntoViewIfNeeded();
          const cb = await chip.evaluate((el) => { const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return h === el || el.contains(h); });
          expect(cb, 'empty chip is the element under its own centre').toBe(true);
          await chip.tap();
          await expect(page.locator('#prPicker')).toHaveAttribute('data-open', 'true');
          await page.keyboard.press('Escape');
          await expect(page.locator('#prPicker')).toHaveAttribute('data-open', 'false');

          // Select a tile: every bulk action must be on screen and tappable.
          const img = page.locator('[data-tile-img]').first();
          await img.scrollIntoViewIfNeeded();
          await img.tap();
          await expect(page.locator('#prBulkBar')).toHaveAttribute('data-open', 'true');
          await page.waitForTimeout(300); // the bar slides up (.22s)
          const btns = await page.evaluate(() => {
            const vw = document.documentElement.clientWidth;
            return [...document.querySelectorAll('#prBulkBar .pr-bulk-btn')].map((b) => {
              const r = b.getBoundingClientRect();
              const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              return { t: b.textContent.trim(), h: r.height, inView: r.left >= 0 && r.right <= vw, reach: !!h && (h === b || b.contains(h)) };
            });
          });
          for (const b of btns) {
            expect(b.inView, `bulk "${b.t}" fully on screen`).toBe(true);
            expect(b.reach, `bulk "${b.t}" reachable`).toBe(true);
            expect(b.h, `bulk "${b.t}" height`).toBeGreaterThanOrEqual(38);
          }
          await page.locator('#prBulkClear').tap();
          await expect(page.locator('#prBulkBar')).toHaveAttribute('data-open', 'false');
        });
      }
    } finally {
      await ctx.close();
    }
  });
});

// ── homeowner#10: sandbox per-card arrows ──────────────────────────────
test.describe('phone signing: sandbox stage arrows @audit', () => {
  test('the arrows that move a card on a phone are finger-sized and work', async ({ browser }) => {
    test.setTimeout(60_000);
    for (const width of [...PHONES, DESKTOP]) {
      await test.step(`${width}px`, async () => {
        const phone = width < 1000;
        const ctx = await browser.newContext(ctxOpts(width));
        try {
          const p = await ctx.newPage();
          await p.goto('/pro/sandbox.html');
          await expect(p.locator('.sb-arrow').first()).toBeVisible();
          const counts = () => p.evaluate(() => [...document.querySelectorAll('.sb-col')].map((c) => c.querySelectorAll('.sb-card').length).join(','));
          const before = await counts();
          const sel = '.sb-card .sb-arrow[data-action="next"]';
          await p.locator(sel).first().scrollIntoViewIfNeeded();
          const a = await p.evaluate(probeFn, sel);
          const nav = await p.evaluate(() => {
            const mark = document.querySelector('.sb-logo .mark').getBoundingClientRect();
            const cta = document.querySelector('.sb-nav-right a.cta');
            const badge = document.querySelector('.sb-badge');
            const lines = (el) => {
              const c = getComputedStyle(el);
              const inner = el.getBoundingClientRect().height - parseFloat(c.paddingTop) - parseFloat(c.paddingBottom) - parseFloat(c.borderTopWidth) - parseFloat(c.borderBottomWidth);
              return Math.round(inner / parseFloat(c.lineHeight));
            };
            // The logo's 'NBD PRO' text is an inline span: no padding, so lines() holds.
            const logoText = document.querySelector('.sb-logo > span:last-child');
            const vw = document.documentElement.clientWidth;
            const navRight = Math.max(...[...document.querySelectorAll('.sb-nav *')].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().right));
            return { markW: mark.width, ctaLines: lines(cta), badgeLines: badge.offsetParent ? lines(badge) : 0, logoLines: lines(logoText), navPastEdge: navRight - vw };
          });
          if (phone) {
            expect(a.w, 'arrow width').toBeGreaterThanOrEqual(40);
            expect(a.h, 'arrow height').toBeGreaterThanOrEqual(36);
            expect(a.reach, 'arrow is the element under its own centre').toBe(true);
            expect(nav.markW, 'NBD mark keeps its 32px square').toBeGreaterThanOrEqual(31);
            expect(nav.ctaLines, 'START FREE on one line').toBeLessThanOrEqual(1);
            expect(nav.badgeLines, 'sandbox badge on one line (or hidden)').toBeLessThanOrEqual(1);
            expect(nav.logoLines, 'NBD PRO wordmark on one line').toBeLessThanOrEqual(1);
            expect(nav.navPastEdge, 'nav content past the right edge').toBeLessThanOrEqual(0);
          } else {
            expect(a.h, 'desktop arrows unchanged').toBeLessThanOrEqual(24);
          }
          const next = p.locator(sel).first();
          if (phone) await next.tap(); else await next.click();
          await expect.poll(counts, { message: 'tapping › moved the card to the next stage' }).not.toBe(before);
          await expect(p.locator('#drawerWrap')).not.toHaveClass(/open/);
        } finally {
          await ctx.close();
        }
      });
    }
  });
});
