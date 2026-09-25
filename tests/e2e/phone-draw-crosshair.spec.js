// tests/e2e/phone-draw-crosshair.spec.js — the phone crosshair screen of the
// Drawing Tool (docs/pro/js/draw-reticle.js + css/draw-reticle.css), draw
// lane L4, 2026-09-25.
//
// Jo's decision 4 is the flow under test: a fixed crosshair; Add drops a
// PENDING point there (nothing committed); the rep fine-tunes it by dragging
// it (or nudging the map) while a magnifier shows the imagery around it,
// offset above the finger; Confirm commits it at the crosshair; Cancel
// throws it away. Plus the bar around it: sticky Eave/Rake chips, the snap
// ring and same-spot guard, per-structure totals (decision 3), Undo/Redo,
// Edit's Move/Drop/Flip/Type, and ☰ Tools as an overlay sheet that never
// resizes the map and keeps #1757's installed-app guarantee.
//
// How it measures:
//   - The engine seam (drawMap.nbdDraw, draw lane L3) is a TEST-ONLY stub
//     from fixtures/draw-seam-stub.js, injected with addInitScript: it keeps
//     its own model and records every call, with the map centre at each
//     placement. The real engine underneath is never armed.
//   - Real touch: CDP Input.dispatchTouchEvent (fixtures/draw-touch.js) for
//     drags and pans; locator.tap() for buttons; hit-tests with
//     document.elementFromPoint, as phone-dashnav does.
//   - Hermetic: map tiles are the stubbed 256px PNG; geometry is the fixed
//     z21 WING fixture; expected numbers come from docs/pro/js/draw-geom.js
//     required here in node.
//   - 412x860 and 360x640 (the tightest phone: the crosshair must still sit
//     above the bar), plus a 1280 desktop block (mouse, pointer: fine).
//
// One login per viewport (serial). Tagged @shard2 for its CI shard.
// Run locally against a served worktree:
//   cd tests && PLAYWRIGHT_BASE_URL=http://127.0.0.1:5000 \
//     PLAYWRIGHT_TEST_USER_EMAIL=playwright-e2e@nbd.test \
//     PLAYWRIGHT_TEST_USER_PASSWORD=nbd-e2e-password-1 \
//     npx playwright test --config=playwright.config.js phone-draw-crosshair.spec.js --workers=1
const path = require('path');
const { test, expect } = require('@playwright/test');
const { requireTestUser, loginAs, safeWaitForFunction } = require('./fixtures/auth');
const T = require('./fixtures/draw-touch');
const { installSeamStub } = require('./fixtures/draw-seam-stub');
const G = require(path.join(__dirname, '..', '..', 'docs', 'pro', 'js', 'draw-geom.js'));

const { WING } = T;
const PITCH = 1.202, WASTE = 1.17; // #pitchSel / #wasteSel defaults (the stub's too)

let creds = null;
try { creds = requireTestUser(); } catch (_) { /* every test skips below */ }

async function stubNetwork(page) {
  await page.route('**/nominatim.openstreetmap.org/**', (r) => r.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.route(/127\.0\.0\.1:5001\/|cloudfunctions\.net\//, (r) => r.fulfill({ contentType: 'application/json', body: '{"result":null}' }));
}
async function returningUser(context) {
  await context.addInitScript(() => {
    try {
      localStorage.setItem('nbd-onboarding-complete', '1');
      localStorage.setItem('nbd_push_optin_snoozed_until', String(Date.now() + 3600_000));
      localStorage.setItem('nbd_draw_crosshair_coached', '1');
    } catch (e) { /* storage blocked */ }
  });
}
const nextFrames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const fmtSq = (base) => (base * PITCH * WASTE / 100).toFixed(2);
const fmtSf = (base) => Math.round(base).toLocaleString('en-US');

// Everything the specs read: the crosshair screen's DOM and the stub's log.
async function ui(page) {
  return page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const box = (e) => {
      if (!e || e.hidden) return null;
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2, b: r.bottom, r: r.right };
    };
    const b = (s) => { const e = q(s); return e ? { text: e.textContent.trim(), disabled: e.disabled, hidden: e.hidden } : null; };
    const h = q('.dr-handle');
    const lo = q('.dr-loupe');
    const api = drawMap.nbdDraw;
    const m = drawMap.getContainer().getBoundingClientRect();
    const s = drawMap.getSize();
    return {
      map: { x: m.left, y: m.top, w: m.width, h: m.height, cx: m.left + s.x / 2, cy: m.top + s.y / 2 },
      zoom: drawMap.getZoom(),
      cross: box(q('.dr-cross')), bar: box(q('.dr-bar')), ring: box(q('.dr-snap:not(.dr-pickring)')), pickRing: box(q('.dr-pickring')),
      handle: box(h), handleLL: h && !h.hidden ? { lat: Number(h.dataset.lat), lng: Number(h.dataset.lng) } : null,
      loupe: box(lo), loupeLL: lo && !lo.hidden ? { lat: Number(lo.dataset.lat), lng: Number(lo.dataset.lng), zoom: Number(lo.dataset.zoom) } : null,
      loupeTiles: [...document.querySelectorAll('.dr-loupe img.leaflet-tile')].filter((i) => i.complete && i.naturalWidth > 0).length,
      add: b('[data-dr-act="add"]'), confirm: b('[data-dr-act="confirm"]'), cancel: b('[data-dr-act="cancel"]'), aux: b('[data-dr-act="aux"]'),
      undo: b('[data-dr-act="undo"]'), flip: b('[data-dr-act="flip"]'),
      readMain: q('.dr-read-main').textContent, readSub: q('.dr-read-sub').textContent,
      calls: api.__calls.map((c) => ({ fn: c.fn, args: c.args, centre: c.centre, result: c.result })),
      model: api.__model(),
    };
  });
}
// px between two lat/lngs at the map's current zoom (or `zoom`).
async function pxApart(page, a, b, zoom) {
  return page.evaluate(([a1, b1, z]) => {
    const crs = drawMap.options.crs;
    const zz = z == null ? drawMap.getZoom() : z;
    return crs.latLngToPoint(L.latLng(a1.lat, a1.lng), zz).distanceTo(crs.latLngToPoint(L.latLng(b1.lat, b1.lng), zz));
  }, [a, b, zoom == null ? null : zoom]);
}
const placements = (u) => u.calls.filter((c) => c.fn === 'placeAtReticle');

// What a thumb on `selector` would hit (phone-dashnav's hitTest).
async function hitTest(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { ok: false, why: 'missing' };
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return { ok: false, why: '0x0' };
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return { ok: false, why: `off-screen at y=${Math.round(y)}` };
    const h = document.elementFromPoint(x, y);
    const ok = !!h && (h === el || el.contains(h));
    return { ok, why: ok ? 'hit' : `covered by ${h ? h.tagName + '#' + h.id + '.' + String(h.className).split(' ')[0] : 'nothing'}` };
  }, selector);
}
async function expectTappable(page, selector, label) {
  await expect.poll(async () => (await hitTest(page, selector)).why, { message: `${label} (${selector}) is under a thumb`, timeout: 5_000 }).toBe('hit');
}
// Copy the @media(display-mode: standalone) rules to the top level: the
// cascade the INSTALLED app gets (no browser can emulate display-mode).
async function forceStandalone(page) {
  return page.evaluate(() => {
    let css = '';
    for (const sh of document.styleSheets) {
      let rules; try { rules = sh.cssRules; } catch (e) { continue; }
      for (const r of rules) if (r.media && /display-mode:\s*standalone/.test(r.conditionText || r.media.mediaText)) for (const inner of r.cssRules) css += inner.cssText + '\n';
    }
    const s = document.createElement('style');
    s.id = 'e2e-force-standalone';
    s.textContent = css;
    document.head.appendChild(s);
    return css.length;
  });
}

for (const [width, height] of [[412, 860], [360, 640]]) {
  test.describe.serial(`phone draw crosshair ${width}x${height} @shard2`, () => {
    /** @type {import('@playwright/test').BrowserContext} */ let context;
    /** @type {import('@playwright/test').Page} */ let page;
    let touch = null;
    const pageErrors = [];
    const urls = [];
    let bootUrls = [];

    // A real tap, then wait for the click Chromium synthesises from it (it can
    // land after tap() resolves) and for the screen's next frame.
    async function tapSel(sel) {
      await page.evaluate((s) => {
        const e = document.querySelector(s);
        e.dataset.e2eClicked = '0';
        e.addEventListener('click', () => { e.dataset.e2eClicked = '1'; }, { once: true, capture: true });
      }, sel);
      await page.locator(sel).tap();
      await expect.poll(() => page.evaluate((s) => document.querySelector(s).dataset.e2eClicked, sel), { message: `a tap on ${sel} clicks it`, timeout: 3_000 }).toBe('1');
      await nextFrames(page);
    }
    async function mode(name) { await tapSel(`.dr-mode[data-dr-mode="${name}"]`); }
    // Commit a corner exactly at `ll` the way a rep does: crosshair on it,
    // Add, Confirm.
    async function placeAt(ll) {
      await T.setView(page, ll, WING.zoom);
      await tapSel('[data-dr-act="add"]');
      await tapSel('[data-dr-act="confirm"]');
    }
    async function reset() {
      await page.evaluate(() => drawMap.nbdDraw.__seed({}));
      await page.evaluate(() => { drawMap.nbdDraw.__calls.length = 0; });
      if (!(await ui(page)).cancel.hidden) await tapSel('[data-dr-act="cancel"]');
      await T.setView(page, WING.view, WING.zoom);
    }
    // A finger on the page, held down between calls (CDP touch).
    const finger = {
      down: (p) => touch.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 0, radiusX: 8, radiusY: 8, force: 1 }] }),
      move: (p) => touch.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y, id: 0, radiusX: 8, radiusY: 8, force: 1 }] }),
      up: () => touch.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
      async drag(from, to, steps) {
        await finger.down(from);
        for (let i = 1; i <= (steps || 16); i++) {
          await finger.move({ x: from.x + (to.x - from.x) * i / (steps || 16), y: from.y + (to.y - from.y) * i / (steps || 16) });
          await page.waitForTimeout(16);
        }
      },
    };

    test.beforeAll(async ({ browser }, testInfo) => {
      if (!creds) return;
      testInfo.setTimeout(90_000);
      context = await browser.newContext(T.phoneContextOptions(width, height));
      await returningUser(context);
      await installSeamStub(context);
      page = await context.newPage();
      page.on('request', (r) => urls.push(r.url()));
      T.acceptDialogs(page);
      await T.stubTiles(page);
      await stubNetwork(page);
      await loginAs(page, creds);
      await safeWaitForFunction(page, () => typeof window.goTo === 'function' && !!window._user, { timeout: 30_000 });
      bootUrls = urls.slice();
      await T.openDraw(page);
      await page.waitForSelector('#view-draw.dr-on .dr-root .dr-bar', { timeout: 10_000 });
      page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e)));
      touch = await T.touchSession(page);
      await T.quietToasts(page);
      await T.setView(page, WING.view, WING.zoom);
    });

    test.afterAll(async () => {
      if (touch) await touch.detach();
      if (context) await context.close();
    });

    test.beforeEach(async ({}, testInfo) => {
      if (!creds) testInfo.skip(true, 'PLAYWRIGHT_TEST_USER_EMAIL not set');
    });

    test('lazy: the crosshair files are not fetched at boot, and arrive with the Draw view', async () => {
      const hits = (list, name) => list.filter((u) => u.includes(name)).length;
      expect(hits(bootUrls, 'draw-reticle.js'), 'draw-reticle.js at boot').toBe(0);
      expect(hits(bootUrls, 'draw-reticle.css'), 'draw-reticle.css at boot').toBe(0);
      expect(hits(urls, 'draw-reticle.js'), 'draw-reticle.js with the Draw view').toBeGreaterThan(0);
      expect(hits(urls, 'draw-reticle.css'), 'draw-reticle.css with the Draw view').toBeGreaterThan(0);
      const calls = await page.evaluate(() => drawMap.nbdDraw.__calls.map((c) => c.fn));
      expect(calls, 'the screen switched the engine into crosshair mode').toContain('setCrosshair');
    });

    test('layout: the crosshair is the map centre with the map under it, above a bar clear of the nav and attribution', async () => {
      await reset();
      await mode('perim');
      const u = await ui(page);
      expect(Math.abs(u.cross.cx - u.map.cx), 'crosshair x = map centre').toBeLessThanOrEqual(1);
      expect(Math.abs(u.cross.cy - u.map.cy), 'crosshair y = map centre').toBeLessThanOrEqual(1);
      const under = await page.evaluate(([x, y]) => {
        const e = document.elementFromPoint(x, y);
        return { inMap: !!e && document.getElementById('drawMap').contains(e), what: e ? e.tagName + '.' + String(e.className).split(' ')[0] : 'nothing' };
      }, [u.map.cx, u.map.cy]);
      expect(under.inMap, `a finger at the crosshair reaches the map (not ${under.what})`).toBe(true);
      expect(u.cross.b, 'the whole crosshair sits above the bar').toBeLessThan(u.bar.y - 8);
      const chrome = await page.evaluate(() => {
        const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return b.height ? { t: b.top, b: b.bottom, l: b.left, r: b.right } : null; };
        return { nav: r('#mobile-nav'), attrib: r('#drawMap .leaflet-control-attribution'), vw: innerWidth };
      });
      expect(chrome.attrib, 'Leaflet attribution is rendered').not.toBeNull();
      expect(u.bar.b, 'bar bottom vs the attribution strip').toBeLessThanOrEqual(chrome.attrib.t + 0.5);
      if (chrome.nav) expect(u.bar.b, 'bar bottom vs the bottom nav').toBeLessThanOrEqual(chrome.nav.t + 0.5);
      expect(u.bar.x, 'bar inside the screen (left)').toBeGreaterThanOrEqual(0);
      expect(u.bar.r, 'bar inside the screen (right)').toBeLessThanOrEqual(chrome.vw);
      expect(u.bar.h, 'bar height cap').toBeLessThanOrEqual(190);

      // Every control on the bar and the side column is under a thumb and
      // finger-sized: 44px chips, 56px action buttons, 44px round buttons.
      const sizes = async () => page.evaluate(() => [...document.querySelectorAll('.dr-bar button, .dr-side button')]
        .filter((e) => !e.hidden && e.offsetParent !== null)
        .map((e) => ({ cls: e.className, label: e.getAttribute('aria-label') || e.textContent.trim(), h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width) })));
      const checkAll = async (phase) => {
        const list = await sizes();
        expect(list.length, `${phase}: controls found`).toBeGreaterThan(6);
        for (const c of list) {
          const min = /dr-act/.test(c.cls) ? 56 : 44;
          expect(c.h, `${phase}: "${c.label}" height`).toBeGreaterThanOrEqual(min);
          expect(c.w, `${phase}: "${c.label}" width`).toBeGreaterThanOrEqual(44);
        }
        const n = await page.evaluate(() => {
          document.querySelectorAll('[data-e2e-hit]').forEach((e) => e.removeAttribute('data-e2e-hit'));
          const vis = [...document.querySelectorAll('.dr-bar button, .dr-side button')].filter((e) => !e.hidden && e.offsetParent !== null);
          vis.forEach((e, i) => e.setAttribute('data-e2e-hit', String(i)));
          return vis.length;
        });
        for (let i = 0; i < n; i++) await expectTappable(page, `[data-e2e-hit="${i}"]`, `${phase}: control #${i}`);
      };
      await T.quietToasts(page);
      await checkAll('aiming');
      await tapSel('[data-dr-act="add"]');
      await checkAll('pending');
      await tapSel('[data-dr-act="cancel"]');
    });

    test('Add drops a PENDING point at the crosshair — nothing is committed, the magnifier opens', async () => {
      await reset();
      await mode('perim');
      await tapSel('[data-dr-act="add"]');
      const u = await ui(page);
      expect(u.handle, 'the pending point is on screen').not.toBeNull();
      expect(Math.hypot(u.handle.cx - u.map.cx, u.handle.cy - u.map.cy), 'pending point at the crosshair').toBeLessThanOrEqual(1);
      const centre = await T.client2ll(page, { x: u.map.cx, y: u.map.cy });
      expect(await pxApart(page, u.handleLL, centre), 'pending lat/lng = the crosshair').toBeLessThanOrEqual(1);
      expect(placements(u).length, 'placeAtReticle calls after Add').toBe(0);
      expect(u.model.open.length + u.model.lines.length, 'committed points/edges after Add').toBe(0);
      expect(u.loupe, 'magnifier shows while placing').not.toBeNull();
      expect(u.confirm.hidden || u.cancel.hidden, 'Confirm and Cancel replace Add').toBe(false);
      expect(u.add.hidden, 'Add hides while a point is pending').toBe(true);
    });

    test('drag: the pending point follows the finger, and the magnifier sits above the finger, centred on it', async () => {
      const u0 = await ui(page);
      expect(u0.handle, 'still pending from the previous test').not.toBeNull();
      const from = { x: u0.handle.cx, y: u0.handle.cy };
      const to = { x: from.x + 52, y: from.y + 36 };
      await finger.drag(from, to);
      await nextFrames(page);
      try {
        const u = await ui(page);
        expect(Math.hypot(u.handle.cx - to.x, u.handle.cy - to.y), 'the point is under the finger').toBeLessThanOrEqual(1.5);
        const atHandle = await T.client2ll(page, { x: u.handle.cx, y: u.handle.cy });
        expect(await pxApart(page, u.handleLL, atHandle), 'pending lat/lng = where the point is drawn').toBeLessThanOrEqual(1);
        expect(Math.hypot(u.cross.cx - u.map.cx, u.cross.cy - u.map.cy), 'the crosshair did not move').toBeLessThanOrEqual(1);
        // The magnifier: visible, wholly above the fingertip, over it.
        expect(u.loupe, 'magnifier visible while dragging').not.toBeNull();
        expect(u.loupe.b, 'magnifier bottom clears the fingertip').toBeLessThanOrEqual(to.y - 30);
        expect(Math.abs(u.loupe.cx - to.x), 'magnifier centred over the finger').toBeLessThanOrEqual(2);
        // ...and it magnifies THIS spot: its map is centred on the pending
        // lat/lng (within 2px at its own zoom), two zooms deeper, with tiles.
        expect(u.loupeLL.zoom, 'magnifier zoom = map zoom + 2').toBe(u.zoom + 2);
        expect(await pxApart(page, u.loupeLL, u.handleLL, u.loupeLL.zoom), 'magnifier centre vs the pending point (px at its zoom)').toBeLessThanOrEqual(2);
        await expect.poll(async () => (await ui(page)).loupeTiles, { message: 'magnifier tiles decoded' }).toBeGreaterThan(0);
        expect(placements(u).length, 'dragging commits nothing').toBe(0);
      } finally {
        await finger.up();
      }
      await nextFrames(page);
      const after = await ui(page);
      expect(Math.hypot(after.handle.cx - to.x, after.handle.cy - to.y), 'the point stays where the finger left it').toBeLessThanOrEqual(1.5);
      expect(after.loupe, 'magnifier stays up until Confirm / Cancel').not.toBeNull();
    });

    test('Confirm commits exactly one point where the pending point is — centred under the crosshair first', async () => {
      const u0 = await ui(page);
      const want = u0.handleLL;
      expect(Math.hypot(u0.handle.cx - u0.map.cx, u0.handle.cy - u0.map.cy), 'the point was dragged off the crosshair').toBeGreaterThan(30);
      await tapSel('[data-dr-act="confirm"]');
      const u = await ui(page);
      const put = placements(u);
      expect(put.length, 'placeAtReticle calls').toBe(1);
      expect(put[0].result && put[0].result.ok, 'the engine accepted it').toBe(true);
      expect(await pxApart(page, put[0].centre, want), 'the map was centred on the pending point when it committed').toBeLessThanOrEqual(1);
      expect(u.model.open.length, 'one corner committed').toBe(1);
      expect(await pxApart(page, u.model.open[0], want), 'the corner is where the pending point was').toBeLessThanOrEqual(1);
      expect(u.handle, 'no pending point after Confirm').toBeNull();
      expect(u.loupe, 'magnifier gone after Confirm').toBeNull();
      expect(u.add.hidden, 'Add is back').toBe(false);
    });

    test('nudge: a pending point that was not dragged rides the crosshair as the map moves; the live length follows; Cancel commits nothing', async () => {
      const u0 = await ui(page);
      const anchor = u0.model.open[0];
      // Confirm left the crosshair ON the new corner: Add is refused there.
      expect(u0.add.disabled, 'Add right after Confirm (same spot)').toBe(true);
      // Pan on open map, well away from the handle and the bar.
      const box = await T.mapBox(page);
      const from = { x: box.x + box.w * 0.25, y: box.y + box.h * 0.22 };
      expect((await T.hitAt(page, from)).ok, 'pan starts on open map').toBe(true);
      await touch.pan(from, { x: from.x - 60, y: from.y + 50 }, { steps: 20, settleMs: 500 });
      await tapSel('[data-dr-act="add"]');
      const start = (await ui(page)).handleLL;
      await touch.pan(from, { x: from.x + 70, y: from.y + 44 }, { steps: 20, settleMs: 500 });
      const u = await ui(page);
      const centre = await T.client2ll(page, { x: u.map.cx, y: u.map.cy });
      expect(await pxApart(page, u.handleLL, centre), 'the pending point is still on the crosshair').toBeLessThanOrEqual(1);
      expect(await pxApart(page, u.handleLL, start), 'and so it moved with the nudge').toBeGreaterThan(60);
      const seg = G.hav(anchor, u.handleLL);
      expect(Math.abs(parseFloat(u.readMain) - seg), `live length "${u.readMain}" vs ${seg.toFixed(2)} ft`).toBeLessThanOrEqual(0.06);
      expect(placements(u).length, 'nudging commits nothing').toBe(1);
      await tapSel('[data-dr-act="cancel"]');
      const c = await ui(page);
      expect(c.handle, 'Cancel removes the pending point').toBeNull();
      expect(placements(c).length, 'Cancel commits nothing').toBe(1);
      expect(c.model.open.length, 'still one corner').toBe(1);
    });

    // 2026-09-25: touch-action:none alone let Chromium turn a drag of the
    // pending point, lifted while still moving, into a fling — and the very
    // next tap (Confirm) was swallowed as the tap that stops a fling: no
    // click at all. The handle now consumes its own touches. The tap must
    // follow the lift at once: extra frames in between let the headless fling
    // finish and hide the bug (measured).
    test('a drag lifted mid-motion does not swallow the next tap (Confirm)', async () => {
      const u0 = await ui(page);
      const box = await T.mapBox(page);
      const from0 = { x: box.x + box.w * 0.3, y: box.y + box.h * 0.2 };
      await touch.pan(from0, { x: from0.x - 50, y: from0.y + 40 }, { steps: 16, settleMs: 450 }); // off the last corner
      await tapSel('[data-dr-act="add"]');
      const h = (await ui(page)).handle;
      await finger.drag({ x: h.cx, y: h.cy }, { x: h.cx + 52, y: h.cy + 36 }, 16);
      await finger.up();
      await tapSel('[data-dr-act="confirm"]');
      expect(placements(await ui(page)).length, 'Confirm committed the dragged point').toBe(placements(u0).length + 1);
    });

    test('outline: sticky Eave/Rake chips type every edge; same-spot guard; the snap ring closes the shape on corner A', async () => {
      await reset();
      await mode('perim');
      await placeAt(WING.A);
      // Crosshair right on the last point: Add is refused, and says why.
      let u = await ui(page);
      expect(u.add.disabled, 'Add on the last point').toBe(true);
      expect(u.readMain, 'readout explains').toMatch(/On the last point/);
      // ...and a pending point dragged back onto it cannot be confirmed.
      const a0 = await T.ll2client(page, WING.A);
      await page.evaluate(([x, y]) => { const r = drawMap.getContainer().getBoundingClientRect(); drawMap.setView(drawMap.containerPointToLatLng([x - r.left, y - r.top]), drawMap.getZoom(), { animate: false }); }, [a0.x + 60, a0.y + 40]);
      await page.waitForTimeout(250);
      await tapSel('[data-dr-act="add"]');
      const h0 = (await ui(page)).handle;
      const onA = await T.ll2client(page, WING.A);
      await finger.drag({ x: h0.cx, y: h0.cy }, { x: onA.x + 3, y: onA.y + 2 }, 12);
      await finger.up();
      await nextFrames(page);
      u = await ui(page);
      expect(u.confirm.disabled, 'Confirm with the pending point on the last point').toBe(true);
      expect(u.readMain, 'readout explains').toMatch(/Same spot/);
      await tapSel('[data-dr-act="cancel"]');
      expect(placements(await ui(page)).length, 'still only corner A').toBe(1);
      await tapSel('.dr-edge[data-dr-edge="rake"]');
      await placeAt(WING.B);
      await placeAt(WING.C);
      await tapSel('.dr-edge[data-dr-edge="eave"]');
      await placeAt(WING.D);
      // 8px off corner A: the ring lights on A, and Add / Confirm say Close.
      const a = await T.ll2client(page, WING.A);
      await page.evaluate(([x, y]) => { const r = drawMap.getContainer().getBoundingClientRect(); drawMap.setView(drawMap.containerPointToLatLng([x - r.left, y - r.top]), drawMap.getZoom(), { animate: false }); }, [a.x + 6, a.y - 5]);
      await page.waitForTimeout(250);
      await nextFrames(page);
      u = await ui(page);
      expect(u.ring, 'snap ring shows').not.toBeNull();
      const ringOn = await T.ll2client(page, WING.A);
      expect(Math.hypot(u.ring.cx - ringOn.x, u.ring.cy - ringOn.y), 'snap ring on corner A').toBeLessThanOrEqual(1);
      expect(u.add.text, 'Add says Close').toBe('Close');
      await tapSel('[data-dr-act="add"]');
      expect((await ui(page)).confirm.text).toMatch(/Confirm close/);
      await tapSel('[data-dr-act="confirm"]');
      u = await ui(page);
      const put = placements(u);
      expect(put.length, 'five placements (A B C D, close on A)').toBe(5);
      expect(put.map((p) => p.args && p.args.edgeType), 'edge type sent with each placement').toEqual(['eave', 'rake', 'rake', 'eave', 'eave']);
      expect(await pxApart(page, put[4].centre, u.model.facets[0].points[0]), 'the close was centred ON corner A, not 8px off it').toBeLessThanOrEqual(0.75);
      expect(u.model.facets.length, 'one closed facet').toBe(1);
      expect(u.model.lines.map((l) => l.type), 'edges typed by the sticky chips: rake, rake, eave, eave').toEqual([4, 4, 5, 5]);
      const base = G.shoelace(u.model.facets[0].points);
      expect(Math.abs(base - WING.expected.appAreaSf) / WING.expected.appAreaSf, 'the wing traced by crosshair').toBeLessThanOrEqual(0.005);
      expect(u.readMain, 'bar: this structure').toBe(`Structure 1 · ${fmtSf(base)} sf · ${fmtSq(base)} sq`);
    });

    test('totals: every structure on the bar (Jo decision 3) — sq per structure and the job; gutters per structure', async () => {
      const wing = [WING.A, WING.B, WING.C, WING.D];
      const FT_DEG = G.EARTH_R_FT * Math.PI / 180;
      const at = (o, e, n) => ({ lat: o.lat + n / FT_DEG, lng: o.lng + e / (FT_DEG * Math.cos(o.lat * Math.PI / 180)) });
      const g0 = at(WING.D, 2, -12);
      const garage = [g0, at(g0, 22, 0), at(g0, 22, -20), at(g0, 0, -20)];
      const wingSf = G.shoelace(wing), garageSf = G.shoelace(garage);
      const run = [WING.D, WING.C, WING.B];
      const seg = (i) => ({ id: 10 + i, type: 10, name: 'Gutters', color: '#06B6D4', p1: run[i], p2: run[i + 1], dist: G.hav(run[i], run[i + 1]), runId: 1, structureId: 1 });
      const gutterLf = seg(0).dist + seg(1).dist;
      await page.evaluate((m) => drawMap.nbdDraw.__seed(m), {
        mode: 'perim', structures: [{ id: 1, name: 'House' }, { id: 2, name: 'Garage' }], structureId: 1,
        facets: [
          { id: 1, points: wing, closed: true, baseArea: wingSf, pitch: PITCH, structureId: 1 },
          { id: 2, points: garage, closed: true, baseArea: garageSf, pitch: PITCH, structureId: 2 },
        ],
        lines: [seg(0), seg(1)], nextId: 20,
      });
      await nextFrames(page);
      let u = await ui(page);
      expect(u.readMain, 'Outline: the active structure').toBe(`House · ${fmtSf(wingSf)} sf · ${fmtSq(wingSf)} sq`);
      expect(u.readSub, 'every structure, then the job').toBe(`House ${fmtSq(wingSf)} sq · Garage ${fmtSq(garageSf)} sq · Job ${fmtSq(wingSf + garageSf)} sq`);
      await mode('gutter');
      u = await ui(page);
      expect(u.readMain, 'Gutters: the active structure\'s LF and downspouts').toBe(`House · ${gutterLf.toFixed(1)} ft · ${Math.ceil(gutterLf / 40)} downspouts`);
    });

    test('edit: aim at a shared corner, Move, drag, Drop moves it on both edges; Flip, Type and Undo/Redo go through the seam', async () => {
      const pts = [WING.A, WING.B, WING.C, WING.D];
      const types = [5, 4, 5, 4];
      const lines = pts.map((p, i) => ({ id: i + 1, type: types[i], name: types[i] === 4 ? 'Rake' : 'Eave', color: '#BE185D', p1: p, p2: pts[(i + 1) % 4], dist: G.hav(p, pts[(i + 1) % 4]), structureId: 1, facetId: 1 }));
      await page.evaluate((m) => drawMap.nbdDraw.__seed(m), {
        facets: [{ id: 1, points: pts, closed: true, baseArea: G.shoelace(pts), pitch: PITCH, structureId: 1 }], lines, nextId: 5,
      });
      await mode('edit');
      await T.setView(page, WING.B, WING.zoom);
      let u = await ui(page);
      expect(u.pickRing, 'the corner under the crosshair is picked').not.toBeNull();
      expect(u.add.text, 'Add becomes Move corner').toBe('Move corner');
      expect(u.add.disabled).toBe(false);
      await tapSel('[data-dr-act="add"]');
      u = await ui(page);
      const from = { x: u.handle.cx, y: u.handle.cy };
      const to = { x: from.x + 52, y: from.y + 36 };
      await finger.drag(from, to, 16);
      await finger.up();
      await nextFrames(page);
      u = await ui(page);
      const dropped = u.handleLL;
      expect(u.confirm.text, 'Confirm reads Drop').toMatch(/Drop/);
      await tapSel('[data-dr-act="confirm"]');
      u = await ui(page);
      const mv = u.calls.filter((c) => c.fn === 'moveVertex');
      expect(mv.length, 'one moveVertex').toBe(1);
      expect(await pxApart(page, mv[0].args[0], WING.B), 'from = corner B').toBeLessThanOrEqual(0.5);
      expect(await pxApart(page, mv[0].args[1], dropped), 'to = where it was dropped').toBeLessThanOrEqual(0.5);
      const ab = u.model.lines.find((l) => l.id === 1), bc = u.model.lines.find((l) => l.id === 2);
      expect(await pxApart(page, ab.p2, dropped), 'A-B follows the corner').toBeLessThanOrEqual(0.5);
      expect(await pxApart(page, bc.p1, dropped), 'B-C follows the corner').toBeLessThanOrEqual(0.5);

      // An edge: the middle of C-D (an Eave). Flip -> Rake; Type -> Valley.
      const midCD = { lat: (WING.C.lat + WING.D.lat) / 2, lng: (WING.C.lng + WING.D.lng) / 2 };
      await T.setView(page, midCD, WING.zoom);
      await nextFrames(page);
      u = await ui(page);
      expect(u.readMain, 'the picked edge is named with its length').toMatch(/^Eave · \d+\.\d ft$/);
      await tapSel('[data-dr-act="flip"]');
      u = await ui(page);
      expect(u.calls.filter((c) => c.fn === 'flip').map((c) => c.args[0]), 'flip(id of C-D)').toEqual([3]);
      expect(u.model.lines.find((l) => l.id === 3).type, 'C-D is a Rake now').toBe(4);
      await tapSel('[data-dr-act="undo"]');
      expect((await ui(page)).model.lines.find((l) => l.id === 3).type, 'Undo puts the Eave back').toBe(5);
      await tapSel('[data-dr-act="redo"]');
      expect((await ui(page)).model.lines.find((l) => l.id === 3).type, 'Redo flips it again').toBe(4);
      await tapSel('[data-dr-act="type"]');
      await tapSel('.dr-typechip[data-dr-lt="3"]');
      u = await ui(page);
      expect(u.calls.filter((c) => c.fn === 'retype').map((c) => c.args), 'retype(id, Valley)').toEqual([[3, 3]]);
      expect(u.model.lines.find((l) => l.id === 3).name).toBe('Valley');
    });

    for (const installed of [false, true]) {
      test(`Tools opens an overlay sheet${installed ? ' (installed app)' : ''}: the map keeps its size, Lines / Gutters stay under a thumb, Add waits`, async () => {
        await reset();
        await mode('perim');
        if (installed) expect(await forceStandalone(page), 'found the standalone rules to force').toBeGreaterThan(200);
        try {
          const before = await T.mapBox(page);
          const tools = '[data-action="mapSidebar"][data-target="map-sidebar-draw"]';
          await T.quietToasts(page);
          await expectTappable(page, tools, '☰ Draw Tools');
          await page.locator(tools).tap();
          await expect(page.locator('#map-sidebar-draw')).toHaveClass(/\bopen\b/);
          await page.waitForTimeout(400); // max-height transition
          const after = await T.mapBox(page);
          expect(after.h, 'the map height with the sheet open').toBe(before.h);
          expect(after.y, 'the map top with the sheet open').toBe(before.y);
          const sheet = await page.evaluate(() => {
            const s = document.getElementById('map-sidebar-draw');
            const r = s.getBoundingClientRect();
            return { pos: getComputedStyle(s).position, top: r.top, bottom: r.bottom, h: r.height };
          });
          expect(sheet.pos, 'the sheet overlays the map').toBe('absolute');
          expect(sheet.h, 'the sheet is open on screen').toBeGreaterThan(200);
          await T.quietToasts(page);
          await expectTappable(page, '#modeLineBtn', 'Draw Mode: Lines (inside the sheet)');
          await expectTappable(page, '#modeGutterBtn', 'Draw Mode: Gutters (inside the sheet)');
          expect((await ui(page)).add.disabled, 'Add waits while the sheet is open').toBe(true);
          await page.locator(tools).tap();
          await expect(page.locator('#map-sidebar-draw')).not.toHaveClass(/\bopen\b/);
          await nextFrames(page);
          expect((await ui(page)).add.disabled, 'Add is back once the sheet closes').toBe(false);
        } finally {
          await page.evaluate(() => { const s = document.getElementById('e2e-force-standalone'); if (s) s.remove(); });
        }
      });
    }

    test('no page errors while drawing', async () => {
      expect(pageErrors, 'uncaught page errors').toEqual([]);
    });
  });
}

test.describe.serial('desktop draw (1280, mouse) has no crosshair screen @shard2', () => {
  /** @type {import('@playwright/test').BrowserContext} */ let context;
  /** @type {import('@playwright/test').Page} */ let page;
  const urls = [];

  test.beforeAll(async ({ browser }, testInfo) => {
    if (!creds) return;
    testInfo.setTimeout(90_000);
    context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    await returningUser(context);
    await installSeamStub(context);
    page = await context.newPage();
    page.on('request', (r) => urls.push(r.url()));
    T.acceptDialogs(page);
    await T.stubTiles(page);
    await stubNetwork(page);
    await loginAs(page, creds);
    await safeWaitForFunction(page, () => typeof window.goTo === 'function' && !!window._user, { timeout: 30_000 });
    await T.openDraw(page);
    await page.waitForFunction(() => !!(drawMap && drawMap.nbdDraw), null, { timeout: 10_000 });
    await page.waitForTimeout(500);
  });
  test.afterAll(async () => { if (context) await context.close(); });
  test.beforeEach(async ({}, testInfo) => {
    if (!creds) testInfo.skip(true, 'PLAYWRIGHT_TEST_USER_EMAIL not set');
  });

  test('pointer: fine — the files arrive with the bundle but build nothing, and click-to-place still works', async () => {
    const d = await page.evaluate(() => ({
      coarse: matchMedia('(pointer: coarse)').matches,
      root: document.querySelectorAll('.dr-root').length,
      on: document.getElementById('view-draw').classList.contains('dr-on'),
      barOn: document.body.classList.contains('dr-bar-on'),
      calls: drawMap.nbdDraw.__calls.map((c) => c.fn),
      sidebar: getComputedStyle(document.getElementById('map-sidebar-draw')).position,
      sidebarW: Math.round(document.getElementById('map-sidebar-draw').getBoundingClientRect().width),
    }));
    expect(d.coarse, 'a mouse desktop').toBe(false);
    expect(urls.some((u) => u.includes('draw-reticle.js')), 'draw-reticle.js rides the drawtool bundle').toBe(true);
    expect(d.root, 'no crosshair screen').toBe(0);
    expect(d.on, '#view-draw.dr-on').toBe(false);
    expect(d.barOn, 'body.dr-bar-on').toBe(false);
    expect(d.calls, 'the screen never touched the seam').toEqual([]);
    expect(d.sidebar, 'the Tools column is untouched').not.toBe('absolute');
    expect(d.sidebarW, 'the 280px Tools column').toBe(280);
    // Click-to-place on the real engine, as before.
    await T.resetDrawing(page);
    await T.setView(page, WING.view, WING.zoom);
    await T.arm(page, 'line');
    const a = await T.ll2client(page, WING.A), b = await T.ll2client(page, WING.B);
    await page.mouse.click(a.x, a.y);
    await page.waitForTimeout(250);
    await page.mouse.click(b.x, b.y);
    await page.waitForTimeout(400);
    const st = await T.drawState(page);
    expect(st.saved && st.saved.lines.length, 'two clicks drew one line').toBe(1);
    expect(Math.abs(st.saved.lines[0].dist - G.hav(WING.A, WING.B)), 'its length').toBeLessThanOrEqual(0.3);
    await T.resetDrawing(page);
  });
});
