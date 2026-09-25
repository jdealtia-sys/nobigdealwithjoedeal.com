// tests/e2e/phone-dashnav.spec.js — dashboard navigation + quick-create on a
// phone (phone audit 2026-09-25, lane "dashnav").
//
// Every check here is BEHAVIOUR, measured the way a thumb meets it: real
// taps (locator.tap(), never force or dispatchEvent), and a hit-test —
// document.elementFromPoint at the control's centre must land on the control
// or a descendant. Class names prove nothing: the pipeline menus stayed
// "green" for months because a test only checked for '.open'.
//
// What each test pins, and the finding it closes:
//   greeting    pipeline#13 / views#12 — the bottom-nav Home tab greeted
//               every tenant with a hard-coded owner's name.
//   bell        views#10 — tapping What's New also navigated to Settings.
//   task        pipeline#3 — "+" > Task opened nameless and refused to save.
//   knock       pipeline#8 — "+" > D2D Knock opened the map, not the form.
//   gate        pipeline#5 — the knock door-number confirm fired ~800px
//               off-screen, and only its 18px text row was tappable.
//   note        pipeline#8 — "+" > Quick Note opened the ADD LEAD form.
//   schedule    pipeline#10 — Today's schedule sat ~2,100px down.
//   draw        views#0 — the Drawing Tool map was 0px tall on touch devices.
//   draw search Draw audit H9 — no address suggestions ever appeared on the
//               Draw view, and Go left ☰ Tools open over the map.
//   more        views#1 — Reports / Talk Tank / Referrals had no phone entry.
//   report      views#2 — Photo Library "New Report" rendered the builder
//               into a hidden overlay.
//
// One login per describe (a shared page, serial), so the file stays well
// under two minutes at --workers=1. Tagged @shard2 for its CI shard.
// Run locally against a served worktree:
//   cd tests && PLAYWRIGHT_BASE_URL=http://127.0.0.1:5000 \
//     PLAYWRIGHT_TEST_USER_EMAIL=playwright-e2e@nbd.test \
//     PLAYWRIGHT_TEST_USER_PASSWORD=nbd-e2e-password-1 \
//     npx playwright test --config=playwright.config.js phone-dashnav.spec.js --workers=1
const { test, expect } = require('@playwright/test');
const { requireTestUser, loginAs, safeEvaluate, safeWaitForFunction } = require('./fixtures/auth');

const PHONE = {
  viewport: { width: 412, height: 860 },
  isMobile: true,
  hasTouch: true,
  serviceWorkers: 'block',
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
};

let creds = null;
try { creds = requireTestUser(); } catch (_) { /* every test skips below */ }

// elementFromPoint at the centre of `selector`'s first match. ok = the thumb
// would land on it (or a descendant) right now, inside the viewport.
async function hitTest(page, selector) {
  return safeEvaluate(page, (sel) => {
    const el = document.querySelector(sel);
    if (!el) return { ok: false, why: 'missing' };
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return { ok: false, why: `0x0 (${Math.round(r.width)}x${Math.round(r.height)})` };
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return { ok: false, why: `off-screen at y=${Math.round(y)}` };
    const h = document.elementFromPoint(x, y);
    const ok = !!h && (h === el || el.contains(h));
    return { ok, why: ok ? 'hit' : `covered by ${h ? h.tagName + '#' + h.id + '.' + String(h.className).split(' ')[0] : 'nothing'}`, top: Math.round(r.top), height: Math.round(r.height) };
  }, selector);
}

async function expectTappable(page, selector, label) {
  await expect.poll(async () => (await hitTest(page, selector)).why, { message: `${label} (${selector}) is under a thumb`, timeout: 5_000 }).toBe('hit');
}

const activeView = (page) => safeEvaluate(page, () => (document.querySelector('.view.active') || {}).id || '');

// Warning/error toasts live 7-9s and float over the bottom sheets (seeding a
// lead with geocoding stubbed says "Address not found"; the overdue sweep
// adds its own). A rep would swipe them away — close them with real taps
// rather than let an unrelated toast decide a hit-test.
async function dismissToasts(page) {
  for (let i = 0; i < 8; i++) {
    const close = page.locator('#toastContainer .toast-close').first();
    if (!(await close.count())) return;
    await close.tap({ timeout: 2_000 }).catch(() => {});
    await page.waitForTimeout(350);
  }
}

async function openCreateSheet(page) {
  await dismissToasts(page);
  await expectTappable(page, '#mni-create', 'the "+" FAB');
  await page.locator('#mni-create').tap();
  await expect(page.locator('#mCreatePopover')).toBeVisible();
}

// Stub the network the flows below would otherwise reach: OSM geocoding
// (_saveLead, the knock address autocomplete — no client timeout, rate-limits
// CI) and Cloud Functions (functions-less shard; callables answer null).
async function stubNetwork(page) {
  await page.route('**/nominatim.openstreetmap.org/**', (r) => r.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.route(/127\.0\.0\.1:5001\/|cloudfunctions\.net\//, (r) => r.fulfill({ contentType: 'application/json', body: '{"result":null}' }));
}

// First-run UI (the onboarding tour's full-screen overlay, the push opt-in
// card) is legitimate but lands over the bottom nav a moment AFTER boot on a
// fresh CI tenant — CI's first run failed "#mni-dash covered by
// #nbd-onb-overlay". Arrive as a returning user, as dashboard-actions-audit
// does; the tour has its own spec there.
async function returningUser(context) {
  await context.addInitScript(() => {
    try {
      localStorage.setItem('nbd-onboarding-complete', '1');
      localStorage.setItem('nbd_push_optin_snoozed_until', String(Date.now() + 3600_000));
    } catch (e) { /* storage blocked: the tour just shows */ }
  });
}

async function bootPhone(browser) {
  const context = await browser.newContext(PHONE);
  await returningUser(context);
  const page = await context.newPage();
  await stubNetwork(page);
  await loginAs(page, creds);
  await safeWaitForFunction(page, () => typeof window.goTo === 'function' && !!window._user && Array.isArray(window._leads), { timeout: 30_000 });
  return { context, page };
}

test.describe.serial('phone dashboard nav + quick create @shard2', () => {
  /** @type {import('@playwright/test').BrowserContext} */ let context;
  /** @type {import('@playwright/test').Page} */ let page;
  let lead = null; // { id, name } — this file's own customer, deleted at the end
  const stamp = Date.now();

  test.beforeAll(async ({ browser }, testInfo) => {
    if (!creds) return;
    // Login + a lead save + waiting for it to reach _leads: 30s is too tight
    // when the emulator is busy (CI shards, a shared local rig).
    testInfo.setTimeout(90_000);
    ({ context, page } = await bootPhone(browser));
    // Our own lead, so the task picker and New Report never touch shared data
    // (a fresh CI emulator has no leads at all).
    lead = await safeEvaluate(page, async (s) => {
      const firstName = '[E2E] Dashnav';
      let id = null;
      try {
        id = await window._saveLead({
          firstName, lastName: String(s), address: `${String(s).slice(-4)} Dashnav Way, Cincinnati, OH`,
          phone: '513' + String(s).slice(-7), email: `e2e-dashnav-${s}@nbd.test`, stage: 'new', e2eTestData: true,
        });
      } catch (e) { if (!/ALREADY_EXISTS/.test(String(e && e.message || e))) throw e; }
      for (let i = 0; i < 60 && !(window._leads || []).some((l) => l.lastName === String(s)); i++) {
        if (i % 10 === 0 && typeof window._loadLeads === 'function') await window._loadLeads().catch(() => {});
        await new Promise((r) => setTimeout(r, 250));
      }
      const l = (window._leads || []).find((x) => x.lastName === String(s));
      return l ? { id: l.id, name: `${firstName} ${s}` } : (id ? { id, name: `${firstName} ${s}` } : null);
    }, stamp);
  });

  test.afterAll(async () => {
    if (!page) return;
    if (lead) {
      await safeEvaluate(page, async (id) => {
        try {
          for (const t of (await window._loadTasks(id)) || []) await window._deleteTask(id, t.id);
          const fs = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
          await fs.deleteDoc(fs.doc(window.db || window._db, 'leads', id));
        } catch (_) { /* best effort — e2eTestData:true also marks it for the sweep */ }
      }, lead.id).catch(() => {});
    }
    await context.close();
  });

  test.beforeEach(async ({}, testInfo) => {
    if (!creds) testInfo.skip(true, 'PLAYWRIGHT_TEST_USER_EMAIL not set');
  });

  test('greeting: the Home tab greets the signed-in user, never a hard-coded name', async () => {
    await dismissToasts(page);
    await expectTappable(page, '#mni-dash', 'bottom-nav Home');
    await page.locator('#mni-dash').tap();
    await expect.poll(() => activeView(page)).toBe('view-dash');
    const first = await safeEvaluate(page, () => String(window._user.displayName || window._user.email.split('@')[0]).trim().split(/\s+/)[0]);
    await expect(page.locator('#view-dash .page-title').first()).toHaveText(new RegExp(`Welcome Back, ${first}$`, 'i'));
  });

  test('bell: What\'s New opens over the current view instead of navigating to Settings', async () => {
    await safeEvaluate(page, () => window.goTo('dash'));
    await expect.poll(() => activeView(page)).toBe('view-dash');
    await expectTappable(page, '#nbd-whats-new-bell', 'What\'s New bell');
    await page.locator('#nbd-whats-new-bell').tap();
    await expect(page.locator('#nbd-whats-new-panel')).toBeVisible();
    expect(await activeView(page), 'the view behind the panel').toBe('view-dash');
    await page.locator('#nbd-wn-close').tap();
    await expect(page.locator('#nbd-whats-new-panel')).toHaveCount(0);
    expect(await activeView(page), 'where closing the panel leaves the rep').toBe('view-dash');
  });

  test('task: "+" > Task asks for the customer, then the task saves to them', async () => {
    test.skip(!lead, 'could not seed a lead');
    await safeEvaluate(page, () => window.goTo('crm'));
    await openCreateSheet(page);
    const row = '#mCreatePopover .m-create-row[data-arg="task"]';
    await expectTappable(page, row, 'Task row');
    await page.locator(row).tap();

    await expectTappable(page, '#taskLeadSearch', 'customer search');
    await page.locator('#taskLeadSearch').tap();
    await page.locator('#taskLeadSearch').fill(String(stamp));
    const pick = `#taskLeadResults [data-tk-id="${lead.id}"]`;
    await expectTappable(page, pick, 'the seeded customer in the picker');
    await page.locator(pick).tap();
    await expect(page.locator('#taskModalName')).toHaveText(lead.name);

    const text = `Call adjuster back ${stamp}`;
    await expectTappable(page, '#taskInput', 'task input');
    await page.locator('#taskInput').tap();
    await page.locator('#taskInput').fill(text);
    await expectTappable(page, '#taskModal .task-add-btn', '+ Add');
    await page.locator('#taskModal .task-add-btn').tap();
    await expect(page.locator('#taskList')).toContainText(text);
    const saved = await safeEvaluate(page, async (a) => ((await window._loadTasks(a.id)) || []).some((t) => t.text === a.text), { id: lead.id, text });
    expect(saved, 'the task is in Firestore under the picked lead').toBe(true);
    await page.locator('#taskModal .m-modal-bar-x').tap();
    await expect(page.locator('#taskModal')).not.toHaveClass(/\bopen\b/);
  });

  test('knock: "+" > D2D Knock opens the knock form, even cold', async () => {
    await safeEvaluate(page, () => window.goTo('crm'));
    await openCreateSheet(page);
    const row = '#mCreatePopover .m-create-row[data-arg="knock"]';
    await expectTappable(page, row, 'D2D Knock row');
    await page.locator(row).tap();
    await expect(page.locator('#d2d-quick-knock-overlay .d2d-modal-title')).toContainText('Knock', { timeout: 15_000 });
    await expectTappable(page, '#d2d-qk-address', 'knock address field');
  });

  test('gate: Save brings the door-number confirm on screen, and the whole row ticks it', async () => {
    const addr = page.locator('#d2d-qk-address');
    await addr.tap();
    await addr.fill(`${String(stamp).slice(-4)} Gate Test Rd, Cincinnati, OH`);
    await page.locator('#d2d-quick-knock-overlay [data-dispo="not_home"]').first().tap();
    const save = page.locator('#d2d-qk-save');
    await dismissToasts(page); // D2D's "location permission denied" warning
    await save.scrollIntoViewIfNeeded();
    await expectTappable(page, '#d2d-qk-save', 'knock Save');
    await save.tap();
    // Save sits ~800px below the confirm row in the scrolled sheet on a phone.
    await expectTappable(page, '#d2d-addr-confirm-chk', 'door-number confirm checkbox');
    // The scroll to it is smooth; let it land before measuring for a tap.
    let lastTop = null;
    await expect.poll(async () => {
      const t = (await hitTest(page, '#d2d-addr-confirm')).top;
      const settled = t === lastTop;
      lastTop = t;
      return settled;
    }, { message: 'confirm row stops moving', intervals: [150] }).toBe(true);
    const lbl = await hitTest(page, '.d2d-addr-confirm-lbl');
    expect(lbl.height, 'confirm row is a 44px target').toBeGreaterThanOrEqual(44);
    // Tap the gold box 4px inside its top-right corner — its padding, well
    // clear of the 18px checkbox and its text. That dead-zone was the bug.
    const box = await page.locator('#d2d-addr-confirm').boundingBox();
    await page.touchscreen.tap(box.x + box.width - 6, box.y + 4);
    await expect(page.locator('#d2d-addr-confirm-chk')).toBeChecked();
    // Close without saving — no knock record left behind.
    await page.locator('#d2d-quick-knock-overlay .d2d-modal-close').tap();
    await expect(page.locator('#d2d-quick-knock-overlay')).toHaveCount(0);
  });

  test('note: "+" > Voice Note opens Quick Capture, not the Add Lead form', async () => {
    await safeEvaluate(page, () => window.goTo('crm'));
    await openCreateSheet(page);
    const row = '#mCreatePopover .m-create-row[data-arg="note"]';
    await expectTappable(page, row, 'Voice Note row');
    await page.locator(row).tap();
    await expect(page.locator('#nbd-qc-modal')).toBeVisible();
    await expect(page.locator('#leadModal')).not.toHaveClass(/\bopen\b/);
    await expectTappable(page, '#nbd-qc-record-btn', 'record button');
    await page.locator('#nbd-qc-close').tap();
    await expect(page.locator('#nbd-qc-modal')).toHaveCount(0);
  });

  test('schedule: Today\'s schedule is on the first screen', async () => {
    await safeEvaluate(page, () => { window.goTo('schedule'); window.scrollTo(0, 0); });
    await expect(page.locator('#calUpcoming')).toBeAttached();
    const m = await safeEvaluate(page, () => {
      const panel = document.getElementById('calUpcoming').closest('.panel');
      const nav = document.getElementById('mobile-nav');
      const navTop = nav ? nav.getBoundingClientRect().top : innerHeight;
      return { top: Math.round(panel.getBoundingClientRect().top), navTop: Math.round(navTop),
        first: document.querySelector('#view-schedule .panel') === panel,
        embed: Math.round(document.getElementById('calEmbed').getBoundingClientRect().height) };
    });
    expect(m.first, 'Today is the first panel in the view').toBe(true);
    expect(m.top, 'Today starts above the bottom nav with the page unscrolled').toBeLessThan(m.navTop - 100);
    expect(m.embed, 'an unconfigured calendar box takes no space').toBe(0);

    // The 500px floor now comes from updateCalEmbed, only while an iframe is
    // there to fill it — both directions, typed like a rep (input events
    // drive updateCalEmbed; nothing is saved, so no localStorage write).
    await page.route('**/cal.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>cal</title>' }));
    const embedH = () => safeEvaluate(page, () => Math.round(document.getElementById('calEmbed').getBoundingClientRect().height));
    await page.locator('#calUsername').fill('e2e-rep');
    await page.locator('#calEventSlug').fill('roof-inspection');
    await expect.poll(embedH, { message: 'configured calendar box height' }).toBeGreaterThanOrEqual(500);
    await page.locator('#calUsername').fill('');
    await expect.poll(embedH, { message: 'calendar box after clearing the username' }).toBe(0);
    await page.locator('#calEventSlug').fill('');
  });

  test('draw: the Drawing Tool map has real height and its controls are tappable', async () => {
    await dismissToasts(page);
    await page.locator('#mni-more').tap();
    const item = '#mobile-more-menu .mm-item[data-target="draw"]';
    await page.locator(item).scrollIntoViewIfNeeded();
    await expectTappable(page, item, 'More > Drawing Tool');
    await page.locator(item).tap();
    // Measure only AFTER initDrawMap has run: the collapse came from init
    // itself (an inline style it wrote), so the empty container measures
    // fine for the moment before it — a break-test caught this assertion
    // passing on the broken code by reading too early. The touch toggle is
    // appended at the end of init's touch branch, so it marks "init done".
    await expect(page.locator('#drawMap.leaflet-container #drawModeToggle')).toBeAttached({ timeout: 15_000 });
    await page.waitForTimeout(300);
    await expect.poll(() => safeEvaluate(page, () => Math.round(document.getElementById('drawMap').getBoundingClientRect().height)),
      { message: '#drawMap height after init', timeout: 5_000 }).toBeGreaterThan(200);
    await expectTappable(page, '#drawMap', 'the map surface');
    await expectTappable(page, '#drawModeToggle', 'DRAW MODE / NAVIGATE toggle');
    await expectTappable(page, '#drawMap .leaflet-control-zoom-in', 'zoom-in (+)');
  });

  // 2026-09-25, Jo on the INSTALLED app (iPhone): "☰ Tools" did nothing
  // visible. The @media(display-mode: standalone) block pinned .map-area at
  // 100dvh-120px, so the drawer opened below the screen of an overflow:hidden
  // view. A browser tab never matches display-mode:standalone, and no browser
  // can emulate it, so this copies the block's rules to the top level: the
  // exact cascade the installed app gets. Runs straight after 'draw', with
  // the Draw view still open.
  test('draw (installed app): ☰ Tools opens the drawer on screen with the modes tappable', async () => {
    await dismissToasts(page);
    const forced = await safeEvaluate(page, () => {
      let css = '';
      for (const sh of document.styleSheets) {
        let rules; try { rules = sh.cssRules; } catch (e) { continue; }
        for (const r of rules) {
          if (r.media && /display-mode:\s*standalone/.test(r.conditionText || r.media.mediaText)) {
            for (const inner of r.cssRules) css += inner.cssText + '\n';
          }
        }
      }
      const s = document.createElement('style');
      s.id = 'e2e-force-standalone';
      s.textContent = css;
      document.head.appendChild(s);
      return css.length;
    });
    expect(forced, 'found the standalone rules to force').toBeGreaterThan(200);
    try {
      const tools = '[data-action="mapSidebar"][data-target="map-sidebar-draw"]';
      await expectTappable(page, tools, '☰ Draw Tools');
      await page.locator(tools).tap();
      await expect(page.locator('#map-sidebar-draw')).toHaveClass(/\bopen\b/);
      // Opening Draw raises async toasts (e.g. geocoding stubbed to "not
      // found"); a rep swipes them away, so close them before hit-testing.
      await dismissToasts(page);
      await expectTappable(page, '#modeLineBtn', 'Draw Mode: Lines (inside the opened drawer)');
      await expectTappable(page, '#modeGutterBtn', 'Draw Mode: Gutters (inside the opened drawer)');
      const map = await safeEvaluate(page, () => Math.round(document.getElementById('drawMap').getBoundingClientRect().height));
      expect(map, 'the map keeps a usable height with the drawer open').toBeGreaterThan(200);
      await page.locator(tools).tap();
      await expect(page.locator('#map-sidebar-draw')).not.toHaveClass(/\bopen\b/);
    } finally {
      await safeEvaluate(page, () => { const s = document.getElementById('e2e-force-standalone'); if (s) s.remove(); });
    }
  });

  // Draw audit H9 (2026-09-25): typing into the Draw view's address box never
  // showed a suggestion. The autocomplete was bound once at boot, while
  // #drawSearch still sat inside <template id="tpl-view-draw">, so there was
  // nothing to bind. And after Go, ☰ Tools stayed open over the map the rep
  // had just flown to. Runs straight after the two draw tests, with the Draw
  // view still open and its drawer shut. Geocoding answers with one made-up
  // address (the file's catch-all stub answers "no results").
  test('draw search: suggestions appear as the rep types, and a pick, Go or Enter closes ☰ Tools', async () => {
    const HIT = [{
      lat: '39.1031', lon: '-84.5120',
      display_name: '1234 Dashnav Draw Road, Cincinnati, Hamilton County, Ohio, 45202, United States',
      address: { house_number: '1234', road: 'Dashnav Draw Road', city: 'Cincinnati', county: 'Hamilton County',
        state: 'Ohio', 'ISO3166-2-lvl4': 'US-OH', postcode: '45202' },
    }];
    const LABEL = '1234 Dashnav Draw Rd, Cincinnati, OH 45202';
    const NOMINATIM = '**/nominatim.openstreetmap.org/search**';
    const answer = (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(HIT) });
    await page.route(NOMINATIM, answer);
    const tools = '[data-action="mapSidebar"][data-target="map-sidebar-draw"]';
    const drawer = page.locator('#map-sidebar-draw');
    const input = page.locator('#drawSearch');
    const view = () => safeEvaluate(page, () => {
      const c = drawMap.getCenter(); // a bare sibling-scope `let` in maps-routing.js, never on window
      return `${c.lat.toFixed(4)},${c.lng.toFixed(4)} z${drawMap.getZoom()}`;
    });
    const openTools = async () => {
      await dismissToasts(page);
      await page.locator(tools).tap();
      await expect(drawer).toHaveClass(/\bopen\b/);
      await expectTappable(page, '#drawSearch', 'the Draw address box (inside ☰ Tools)');
    };
    const typingFocus = () => safeEvaluate(page, () => document.activeElement && document.activeElement.id);
    try {
      // 1. Suggestions appear as the rep types (10 characters), under a thumb.
      await openTools();
      await input.tap();
      await input.pressSequentially('1234 Dashn', { delay: 25 });
      const item = '#ac-drawSearch .ac-item';
      await expect(page.locator(item).first(), '#ac-drawSearch shows a suggestion after typing 10 characters').toBeVisible({ timeout: 5_000 });
      await expect(page.locator(item).first()).toContainText('1234 Dashnav Draw Rd');
      await expectTappable(page, item, 'the first address suggestion');

      // 2. Picking it fills the box, flies the map there, closes ☰ Tools and
      //    drops the keyboard (the box is no longer on screen to type into).
      await page.locator(item).first().tap();
      await expect(input).toHaveValue(LABEL);
      await expect(drawer, 'picking a suggestion closes ☰ Tools').not.toHaveClass(/\bopen\b/);
      await expect.poll(view, { message: 'the map flies to the picked address' }).toBe('39.1031,-84.5120 z19');
      expect(await typingFocus(), 'the address box lets go of the keyboard').not.toBe('drawSearch');

      // 3. Go (the box keeps the picked address) — from somewhere else on the map.
      await safeEvaluate(page, () => drawMap.setView([39.2, -84.3], 15, { animate: false }));
      await openTools();
      const go = '#map-sidebar-draw [data-fn="searchDraw"]';
      await expectTappable(page, go, 'Go');
      await page.locator(go).tap();
      await expect(drawer, 'Go closes ☰ Tools').not.toHaveClass(/\bopen\b/);
      await expect.poll(view, { message: 'Go flies the map to the address' }).toBe('39.1031,-84.5120 z19');

      // 4. The phone keyboard's Go key is an Enter keydown in the box.
      await openTools();
      await input.tap();
      await input.press('Enter');
      await expect(drawer, 'the keyboard\'s Go (Enter) closes ☰ Tools').not.toHaveClass(/\bopen\b/);
      expect(await typingFocus(), 'Enter lets go of the keyboard too').not.toBe('drawSearch');
    } finally {
      await page.unroute(NOMINATIM, answer);
    }
  });

  test('more:Reports, Talk Tank and Referrals open from the More drawer, and the drawer covers the sidebar', async () => {
    for (const target of ['reports', 'talk-tank', 'refrewards']) {
      await dismissToasts(page);
      await page.locator('#mni-more').tap();
      const item = `#mobile-more-menu .mm-item[data-target="${target}"]`;
      await expect(page.locator(item), `More drawer has ${target}`).toHaveCount(1);
      await page.locator(item).scrollIntoViewIfNeeded();
      await expectTappable(page, item, `More > ${target}`);
      await page.locator(item).tap();
      await expect.poll(() => activeView(page), { message: `tapping ${target}` }).toBe(`view-${target}`);
    }
    // Parity: a view with a desktop-sidebar entry must have a More-drawer
    // entry, or a phone cannot reach it (the sidebar is display:none ≤900px).
    // Left out on purpose, with the reason:
    //   admin — Team Manager, role-gated by admin-manager.js; not a rep tool.
    //   aitree, understand, projectcodex — the AI Tools views; at 412px they
    //     render an empty embedded page (checked 2026-09-25), so a drawer
    //     link would lead nowhere useful. Add them when they fit a phone.
    const missing = await safeEvaluate(page, () => {
      const skip = new Set(['admin', 'aitree', 'understand', 'projectcodex']);
      const drawer = new Set([...document.querySelectorAll('#mobile-more-menu .mm-item[data-target]')].map((e) => e.dataset.target));
      return [...document.querySelectorAll('.sidebar .ni[data-action="goTo"][data-target]')]
        .map((e) => e.dataset.target).filter((t) => !skip.has(t) && !drawer.has(t));
    });
    expect(missing, 'sidebar views with no More-drawer entry').toEqual([]);

    // …and the Customize Tab Bar picker offers them as bottom-nav tabs.
    await dismissToasts(page);
    await page.locator('#mni-more').tap();
    const cust = '#mobile-more-menu .mm-item-customize';
    await page.locator(cust).scrollIntoViewIfNeeded();
    await page.locator(cust).tap();
    for (const id of ['reports', 'talk-tank', 'refrewards']) {
      const tile = `#navCustomizeModal .ncm-pool-item[data-tab-id="${id}"]`;
      await expect(page.locator(tile), `tab-bar picker offers ${id}`).toHaveCount(1);
      await page.locator(tile).scrollIntoViewIfNeeded();
      await expectTappable(page, tile, `tab-bar picker > ${id}`);
    }
    await page.locator('#navCustomizeModal .ncm-close').tap();
    await expect(page.locator('#navCustomizeModal')).not.toHaveClass(/\bopen\b/);
  });

  test('report: Photo Library "New Report" opens the builder once a property is picked', async () => {
    test.skip(!lead, 'could not seed a lead');
    await dismissToasts(page);
    await page.locator('#mni-more').tap();
    const item = '#mobile-more-menu .mm-item[data-target="photos"]';
    await page.locator(item).scrollIntoViewIfNeeded();
    await page.locator(item).tap();
    await expect.poll(() => activeView(page)).toBe('view-photos');
    const btn = '#view-photos button[data-fn="openInspectionBuilderCurrentLead"]';
    await expectTappable(page, btn, 'New Report');
    // No property yet: say so, and don't open an empty builder.
    await safeEvaluate(page, () => { window._currentPhotoLeadId = null; });
    await page.locator(btn).tap();
    await expect(page.locator('#inspectionBuilderOverlay')).toBeHidden();
    await page.locator('#photoLeadSelect').selectOption(lead.id);
    await page.locator(btn).tap();
    await expect(page.locator('#inspectionBuilderOverlay')).toBeVisible();
    await expectTappable(page, '#inspectionBuilderContainer .report-builder', 'the report builder');
    await page.locator('#inspectionBuilderOverlay button[data-fn="closeInspectionBuilder"]').tap();
    await expect(page.locator('#inspectionBuilderOverlay')).toBeHidden();
  });
});

// The greeting, the bell and the Schedule order were desktop bugs too.
test.describe.serial('desktop dashboard nav @shard2', () => {
  /** @type {import('@playwright/test').BrowserContext} */ let context;
  /** @type {import('@playwright/test').Page} */ let page;

  test.beforeAll(async ({ browser }, testInfo) => {
    if (!creds) return;
    testInfo.setTimeout(60_000);
    context = await browser.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'block' });
    await returningUser(context);
    page = await context.newPage();
    await stubNetwork(page);
    await loginAs(page, creds);
    await safeWaitForFunction(page, () => typeof window.goTo === 'function' && !!window._user, { timeout: 30_000 });
  });

  test.afterAll(async () => { if (context) await context.close(); });

  test.beforeEach(async ({}, testInfo) => {
    if (!creds) testInfo.skip(true, 'PLAYWRIGHT_TEST_USER_EMAIL not set');
  });

  test('sidebar Dashboard greets the signed-in user; the bell stays on the view', async () => {
    await page.locator('#nav-dash').click();
    await expect.poll(() => activeView(page)).toBe('view-dash');
    const first = await safeEvaluate(page, () => String(window._user.displayName || window._user.email.split('@')[0]).trim().split(/\s+/)[0]);
    await expect(page.locator('#view-dash .page-title').first()).toHaveText(new RegExp(`Welcome Back, ${first}$`, 'i'));
    await expectTappable(page, '#nbd-whats-new-bell', 'What\'s New bell');
    await page.locator('#nbd-whats-new-bell').click();
    await expect(page.locator('#nbd-whats-new-panel')).toBeVisible();
    expect(await activeView(page)).toBe('view-dash');
    await page.locator('#nbd-wn-close').click();
  });

  test('a #/dash deep link greets the signed-in user too', async () => {
    // Booting straight into the Dashboard clones its template around auth
    // time, the other side of the race from the Home-tab path above.
    // A hash-only goto is a same-document navigation; reload for a real boot,
    // and prove it happened (the marker must not survive).
    await safeEvaluate(page, () => { window.__dashnavBeforeReload = true; });
    await page.goto('/pro/dashboard.html#/dash');
    await page.reload();
    await safeWaitForFunction(page, () => !window.__dashnavBeforeReload && !!window._user && !!document.querySelector('#view-dash.active .page-title'), { timeout: 30_000 });
    const first = await safeEvaluate(page, () => String(window._user.displayName || window._user.email.split('@')[0]).trim().split(/\s+/)[0]);
    await expect(page.locator('#view-dash .page-title').first()).toHaveText(new RegExp(`Welcome Back, ${first}$`, 'i'), { timeout: 15_000 });
  });

  test('Schedule leads with Today', async () => {
    await safeEvaluate(page, () => window.goTo('schedule'));
    await expect(page.locator('#calUpcoming')).toBeAttached();
    const first = await safeEvaluate(page, () => document.querySelector('#view-schedule .panel') === document.getElementById('calUpcoming').closest('.panel'));
    expect(first, 'Today is the first panel in the view').toBe(true);
  });
});
