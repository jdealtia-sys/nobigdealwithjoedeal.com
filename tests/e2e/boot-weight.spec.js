// @ts-check
// Boot-weight + duplicate-execution guards (2026-09-06).
//
// These assert BEHAVIOUR on the real authed pages, not file lists — a lazy
// file that every boot immediately fetches has saved nothing, and a lazy file
// the page needs but never fetches is a silent, user-facing break that only
// shows up on the one interaction that needs it.
//
// What it locks down:
//   1. customer.html does NOT fetch the docgen cluster at boot, and DOES
//      resolve it on demand (window.NBDDocGen / window.DocPreflight).
//   2. profit-tracker.js / supplement-ui.js stay EAGER on customer.html —
//      both render at load (cost panel, "+ Supplement" buttons), so lazy
//      would blank a live surface with no error.
//   3. ScriptLoader dedupes on the RESOLVED PATH: loading the 'estimates'
//      bundle must not re-fetch or re-execute customer.html's absolute-path
//      supplement-ui.js tag (which registers a document.body MutationObserver
//      at load and has no re-entry guard).
//   4. Cmd+K opens exactly ONE palette on the dashboard.
//   5. The Leaflet stylesheets ride the lazy mapvendor bundle and are
//      actually APPLIED once it loads.
//
// Runs in the emulator harness: npm run test:e2e:authed:emu

const { test, expect } = require('@playwright/test');
const { requireTestUser, loginAs, safeEvaluate } = require('./fixtures/auth');

const DOCGEN = [
  'document-generator.js',
  'document-generator-templates.js',
  'doc-preflight.js',
  'nbd-logo-asset.js',
];

/** Record every request URL the page makes, from before the first navigation. */
function trackRequests(page) {
  const urls = [];
  page.on('request', (r) => urls.push(r.url()));
  return urls;
}
const hits = (urls, name) => urls.filter((u) => u.includes(name)).length;

test.describe('boot weight — customer.html docgen is lazy', () => {
  test('docgen is absent at boot and resolves on demand', async ({ page }) => {
    const creds = requireTestUser(test);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));

    await loginAs(page, creds);
    const urls = trackRequests(page);

    // Any customer page — the id need not resolve to a real lead for the
    // boot-path assertions; the scripts load regardless of the data read.
    await page.goto('/pro/customer.html?id=E2E-BOOT-WEIGHT');
    await page.waitForLoadState('load');
    await page.waitForFunction(() => !!(window.ScriptLoader && window.ScriptLoader.loadBundle), null, { timeout: 20_000 });

    // 1. the cluster must NOT be on the boot path
    for (const f of DOCGEN) {
      expect(hits(urls, f), f + ' must not be fetched at boot').toBe(0);
    }
    expect(await safeEvaluate(page, () => typeof window.NBDDocGen)).toBe('undefined');

    // 2. …and the entry points' load-then-run must actually deliver it
    const got = await safeEvaluate(page, async () => {
      await window.ScriptLoader.loadBundle('docgen');
      return {
        generate: typeof (window.NBDDocGen && window.NBDDocGen.generate),
        preflight: typeof (window.DocPreflight && window.DocPreflight.open),
      };
    });
    expect(got.generate, 'NBDDocGen.generate after loadBundle').toBe('function');
    expect(got.preflight, 'DocPreflight.open after loadBundle').toBe('function');
    for (const f of DOCGEN) {
      expect(hits(urls, f), f + ' fetched on demand').toBeGreaterThan(0);
    }

    expect(errors, 'no uncaught page errors').toEqual([]);
  });

  test('the render-time modules stay eager', async ({ page }) => {
    const creds = requireTestUser(test);
    await loginAs(page, creds);
    const urls = trackRequests(page);
    await page.goto('/pro/customer.html?id=E2E-BOOT-WEIGHT');
    await page.waitForLoadState('load');
    await page.waitForFunction(() => !!window.ScriptLoader, null, { timeout: 20_000 });

    // profit-tracker renders the cost panel during the customer render, and
    // supplement-ui paints the "+ Supplement" button onto every estimate row.
    // Neither has a user-intent trigger to hang a lazy load on.
    expect(hits(urls, 'profit-tracker.js'), 'profit-tracker.js eager').toBeGreaterThan(0);
    expect(hits(urls, 'supplement-ui.js'), 'supplement-ui.js eager').toBeGreaterThan(0);
  });

  test('loading the estimates bundle does not re-execute supplement-ui', async ({ page }) => {
    const creds = requireTestUser(test);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
    await loginAs(page, creds);
    const urls = trackRequests(page);
    await page.goto('/pro/customer.html?id=E2E-BOOT-WEIGHT');
    await page.waitForLoadState('load');
    await page.waitForFunction(() => !!(window.ScriptLoader && window.ScriptLoader.loadBundle), null, { timeout: 20_000 });

    const before = hits(urls, 'supplement-ui.js');
    expect(before, 'supplement-ui.js on the boot path exactly once').toBe(1);

    // customer.html's tag is '/pro/js/supplement-ui.js?v=1'; the bundle entry
    // is 'js/supplement-ui.js?v=1'. A raw-string dedupe sees two files.
    await safeEvaluate(page, async () => { await window.ScriptLoader.loadBundle('estimates'); });
    await page.waitForTimeout(750);

    expect(hits(urls, 'supplement-ui.js'), 'not re-fetched by the estimates bundle').toBe(before);
    const tags = await safeEvaluate(page, () =>
      document.querySelectorAll('script[src*="supplement-ui.js"]').length);
    expect(tags, 'exactly one supplement-ui.js tag in the DOM').toBe(1);
    expect(errors).toEqual([]);
  });
});

test.describe('boot weight — photo-report.js is lazy on customer.html', () => {
  // 2026-09-06: photo-report.js was eager here ONLY to out-race a rival
  // window.generatePhotoReport in customer-photo-report-generator.js. That rival
  // was dead (this file overwrote it) and is deleted, so the tag went too. The
  // failure mode this guards is SILENT: without the load-then-run stub the
  // "📋 Generate Report" button logs an unknown action and does nothing visible.
  test('absent at boot, and the stub resolves it on demand', async ({ page }) => {
    const creds = requireTestUser(test);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
    await loginAs(page, creds);
    const urls = trackRequests(page);
    await page.goto('/pro/customer.html?id=E2E-BOOT-WEIGHT');
    await page.waitForLoadState('load');
    await page.waitForFunction(() => !!(window.ScriptLoader && window.ScriptLoader.loadBundle), null, { timeout: 20_000 });

    expect(hits(urls, 'photo-report.js'), 'photo-report.js must not be fetched at boot').toBe(0);

    // the global must EXIST (or every entry point is a silent no-op) and be the stub
    const before = await safeEvaluate(page, () => ({
      type: typeof window.generatePhotoReport,
      isStub: !!(window.generatePhotoReport && window.generatePhotoReport.__nbdLazyPhotoReportStub),
    }));
    expect(before.type, 'generatePhotoReport must be defined at boot').toBe('function');
    expect(before.isStub, 'and it must be the lazy stub').toBe(true);

    // the dead rival must not be reachable any more
    expect(await safeEvaluate(page, () => typeof window.fetchImageAsBase64)).toBe('undefined');

    // loading the bundle must replace the stub with the real renderer
    const after = await safeEvaluate(page, async () => {
      await window.ScriptLoader.loadBundle('photos');
      return {
        type: typeof window.generatePhotoReport,
        stillStub: !!(window.generatePhotoReport && window.generatePhotoReport.__nbdLazyPhotoReportStub),
        pairs: typeof window._buildPhotoReportPairs,
      };
    });
    expect(after.type).toBe('function');
    expect(after.stillStub, 'the real photo-report.js must overwrite the stub').toBe(false);
    expect(after.pairs, 'photo-report.js actually executed').toBe('function');
    expect(hits(urls, 'photo-report.js'), 'fetched on demand').toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
});

test.describe('duplicate execution — Cmd+K', () => {
  test('one keypress opens exactly one palette', async ({ page }) => {
    const creds = requireTestUser(test);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
    await loginAs(page, creds);
    await page.waitForFunction(() => typeof window.goTo === 'function', null, { timeout: 20_000 });

    // Both palettes must actually be present, or this test proves nothing.
    const present = await safeEvaluate(page, () => ({
      legacy: !!document.getElementById('cmdPalette'),
      canonical: !!window.NBDCommand,
    }));
    expect(present.legacy, 'ui.js #cmdPalette exists on the dashboard').toBe(true);
    expect(present.canonical, 'command-palette.js NBDCommand is loaded').toBe(true);

    await page.keyboard.press('Control+k');
    await page.waitForTimeout(500);

    const open = await safeEvaluate(page, () => {
      const legacyEl = document.getElementById('cmdPalette');
      const legacy = !!legacyEl && getComputedStyle(legacyEl).display !== 'none';
      // NBDCommand renders its own modal; find any other visible palette node.
      const others = [...document.querySelectorAll('[id]')]
        .filter((e) => e.id !== 'cmdPalette' && /cmdk|command|palette/i.test(e.id))
        .filter((e) => getComputedStyle(e).display !== 'none');
      return { legacy, canonical: others.length > 0, ids: others.map((e) => e.id) };
    });

    expect(open.legacy, 'the legacy ui.js palette must stand down').toBe(false);
    expect(open.canonical, 'the canonical NBDCommand palette opens (ids: ' + open.ids.join(',') + ')').toBe(true);
    expect(errors).toEqual([]);
  });
});

test.describe('boot weight — Leaflet CSS rides the lazy bundle', () => {
  // NOTE ON SCOPE, measured 2026-09-06: 'weather-radar' is in DEFAULT_WIDGETS
  // (widgets.js), and its render() calls _withLeaflet → loadBundle('mapvendor').
  // So on a DEFAULT home view the Leaflet bytes still arrive shortly after
  // boot — what this change removes is four RENDER-BLOCKING <link>s from
  // <head>, not the bytes. Asserting "never fetched" would therefore be a
  // false gate. The honest invariants are: not parser-blocking, and correct
  // (applied, and ahead of leaflet.js) whenever the bundle does load.
  test('stylesheets are not parser-blocking, and apply when the bundle loads', async ({ page }) => {
    const creds = requireTestUser(test);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
    await loginAs(page, creds);
    await page.waitForFunction(() => !!(window.ScriptLoader && window.ScriptLoader.loadBundle), null, { timeout: 20_000 });

    // 1. the served HTML must carry no leaflet stylesheet <link> — that is
    //    what put them on the critical path.
    const html = await (await page.request.get('/pro/dashboard.html')).text();
    const blocking = (html.match(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi) || [])
      .filter((t) => /leaflet|MarkerCluster/i.test(t));
    expect(blocking, 'no render-blocking leaflet <link> in dashboard.html').toEqual([]);

    // 2. whenever the bundle loads, the CSS must be there and APPLIED —
    //    leaflet.css sets `.leaflet-pane { position: absolute }`; without the
    //    rule the computed value falls back to `static`.
    const after = await safeEvaluate(page, async () => {
      await window.ScriptLoader.loadBundle('mapvendor');
      const probe = document.createElement('div');
      probe.className = 'leaflet-pane';
      document.body.appendChild(probe);
      const position = getComputedStyle(probe).position;
      probe.remove();
      const sheets = [...document.querySelectorAll('link[rel="stylesheet"][href]')]
        .map((l) => l.getAttribute('href'))
        .filter((h) => /leaflet|MarkerCluster/i.test(h));
      return { position, sheets: sheets.length, hasL: typeof window.L };
    });
    expect(after.sheets, 'all four leaflet stylesheets injected').toBe(4);
    expect(after.position, '.leaflet-pane is styled — the CSS actually applied').toBe('absolute');
    expect(after.hasL, 'leaflet.js loaded behind its CSS').toBe('object');

    // 3. the user-visible proof: the default home view's radar widget still
    //    builds a real map (Leaflet only creates .leaflet-pane children once
    //    L.map() has run against a styled container).
    const radar = await safeEvaluate(page, async () => {
      const el = document.getElementById('w-radar-map');
      if (!el) return { present: false };
      for (let i = 0; i < 40 && !el.querySelector('.leaflet-pane'); i++) {
        await new Promise((r) => setTimeout(r, 250));
      }
      return { present: true, panes: el.querySelectorAll('.leaflet-pane').length };
    });
    if (radar.present) {
      expect(radar.panes, 'weather-radar widget built a Leaflet map').toBeGreaterThan(0);
    }

    expect(errors).toEqual([]);
  });
});
