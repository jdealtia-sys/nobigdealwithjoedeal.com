// tests/e2e/phone-views.spec.js — phone-scale regressions for the dashboard
// widgets, the header bell, Settings, Products and Sales Training.
//
// Phone audit 2026-09-25, lane "views" (Jo runs the business from an Android
// at ~412px; standing rule: the CRM must fit and work flawlessly there, in
// light AND dark mode). Each block below pins one fixed finding by its
// BEHAVIOUR — what a thumb can reach, what an eye can read — with real taps
// and hit-testing (document.elementFromPoint at a control's centre must be
// that control), never by checking that a class is present: the pipeline
// menus stayed "green" for months behind a test that only looked for `.open`.
//
//   views#4  Hot Leads rows showed no name (0px track) and 💤 clipped at 360
//   views#5  Next Best Actions cut every headline before the customer's name
//   views#8  bell rows squeezed to a 98px text column; 11px-tall header buttons
//   views#6  Settings > Profile stayed two 145px columns
//   views#7  Settings > Team invite box 66px wide, typed text invisible (light)
//   views#9  Pipelines editor: 22x20 arrows, Save only 7 screens up
//   views#13 brand colour pickers rendered as a 5px grey rule
//   views#14 Products: 22px Edit/Archive in an 88,000px list
//   views#3  Objection Obliterator text dark-on-navy in light mode
//   views#11 light-mode chrome / cohort / Talk Tank contrast
//   upgrades Settings > Estimates > Upgrade prices (2026-09-25, Upgrades &
//            Add-ons stage 2): price a needs_price item, switch one Off,
//            Save, reload — persisted in Firestore and seen by NBDUpgrades
//
// Every describe logs in ONCE and walks its surfaces in steps, so the whole
// file stays around two minutes at --workers=1. Tagged @audit so it rides the
// audit shard of the authed emulator job. Run locally against a served tree:
//   cd tests && PLAYWRIGHT_BASE_URL=http://127.0.0.1:5000 \
//     PLAYWRIGHT_TEST_USER_EMAIL=playwright-e2e@nbd.test \
//     PLAYWRIGHT_TEST_USER_PASSWORD=nbd-e2e-password-1 \
//     npx playwright test --config=playwright.config.js phone-views.spec.js --workers=1
const { test, expect } = require('@playwright/test');
const zlib = require('zlib');
const { requireTestUser, loginAs, safeEvaluate, safeWaitForFunction } = require('./fixtures/auth');

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';

test.use({
  viewport: { width: 412, height: 860 },
  isMobile: true,
  hasTouch: true,
  serviceWorkers: 'block',
  userAgent: ANDROID_UA,
  // A tap that can't land should fail naming the control, not burn the
  // whole test timeout retrying.
  actionTimeout: 15_000,
});

let creds;
test.beforeAll(() => {
  try { creds = requireTestUser(); }
  catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[phone-views] ' + e.message);
  }
});

test.beforeEach(async ({ page }, testInfo) => {
  if (!creds) testInfo.skip(true, 'PLAYWRIGHT_TEST_USER_EMAIL not set');
  // Transient overlays aren't what this spec measures, and on a fresh
  // profile they land on top of the controls it hit-tests: the first-run
  // onboarding tour (a full-screen overlay that swallows taps) and Ask Joe's
  // once-a-day proactive nudges (a toast that sat over the brand colour
  // picker). Mark both as already done for today.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('nbd-onboarding-complete', '1');
      const today = new Date().toISOString().split('T')[0];
      localStorage.setItem('nbd_proactive_overdue_scan', today);
      localStorage.setItem('nbd_proactive_pending_estimate_scan', today);
    } catch (_) { /* storage blocked: the hit-test polls below still cope */ }
  });
  // No Cloud Function call leaves this spec: with --only hosting a callable
  // would reach PRODUCTION (ci-e2e-calls-production-functions), and the Next
  // Best Actions AI enrichment would rewrite the headlines under the
  // assertions. An immediate UNAVAILABLE keeps the heuristic headlines.
  await page.route(/cloudfunctions\.net|\.run\.app\/|127\.0\.0\.1:5001\//, (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: { status: 'UNAVAILABLE', message: 'mocked by phone-views.spec' } }),
  }));
});

// ── helpers ────────────────────────────────────────────────────────────────

async function skipTour(page) {
  const skip = page.getByText('Skip tour', { exact: true });
  if (await skip.isVisible().catch(() => false)) await skip.tap({ timeout: 3_000 }).catch(() => {});
}

// The lead widgets re-render on every nbd:data-refreshed (and the leads
// snapshot can land mid-test), which detaches rows under a locator. Wait
// until the container has stopped changing before measuring or tapping.
async function settled(page, selector) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const html = el.innerHTML;
    const now = Date.now();
    const s = (window.__pvSettle = window.__pvSettle || {});
    if (s[sel] !== html) { s[sel] = html; s[sel + ':t'] = now; return false; }
    return now - s[sel + ':t'] >= 1000;
  }, selector, { timeout: 20_000, polling: 100 });
}

// Settings panels fade in; a screenshot or contrast read mid-fade sees the
// page through the panel. Wait out finite animations (infinite ones — a
// pulsing status dot — never finish and don't matter here).
async function animationsDone(page) {
  await safeWaitForFunction(page, () => document.getAnimations().every((a) => {
    const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {};
    return a.playState !== 'running' || t.iterations === Infinity;
  }), { timeout: 10_000 });
}

async function boot(page, { reload = false } = {}) {
  await loginAs(page, creds);
  if (reload) {
    // Second boot: a returning phone has nbd_pro_theme saved, so the lazy
    // theme bundle loads and paints the light palette (the first boot of a
    // fresh profile never does).
    await page.reload();
    await page.waitForURL(/\/pro\/dashboard/);
  }
  await safeWaitForFunction(page, () => typeof window.goTo === 'function' && Array.isArray(window._leads), { timeout: 30_000 });
  await skipTour(page);
  // Demo leads carry phone + email, so the lead widgets render the full
  // 📞💬📧🔍💤 cluster the bugs needed. Seed once per emulator, never twice.
  await safeEvaluate(page, async () => {
    const have = (window._leads || []).some((l) => l && !l.deleted && l.lastName === 'Kowalski');
    if (!have && typeof window.seedDemoLeads === 'function' && window._user) {
      await window.seedDemoLeads(window._user.uid);
      if (typeof window._loadLeads === 'function') await window._loadLeads();
    }
  });
  await skipTour(page);
}

async function openMore(page, target) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('#mni-more').tap();
  const item = page.locator(`#mobile-more-menu .mm-item[data-target="${target}"]`);
  await item.scrollIntoViewIfNeeded();
  await item.tap();
  await skipTour(page);
}

async function openSettingsTab(page, tab) {
  const btn = page.locator(`#stab-${tab}`);
  await btn.scrollIntoViewIfNeeded();
  await btn.tap();
  await expect(page.locator(`#stab-panel-${tab}`)).toBeVisible();
  await animationsDone(page);
}

// Is el's centre topmost? Returns a failure string or ''.
function hitProbeSrc() {
  window.__pvHit = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return 'zero-size';
    const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (h && (h === el || el.contains(h))) return '';
    return 'covered by ' + (h ? h.tagName.toLowerCase() + (h.id ? '#' + h.id : '') + (typeof h.className === 'string' && h.className ? '.' + h.className.split(' ')[0] : '') : 'nothing (off-screen)');
  };
  // Contrast of el's text against what is actually painted behind it:
  // translucent layers composited up the tree, a gradient read at its first
  // stop, white canvas underneath.
  window.__pvContrast = (el) => {
    const parse = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const over = (t, b) => { const a = t.a + b.a * (1 - t.a); return { r: (t.r * t.a + b.r * b.a * (1 - t.a)) / a, g: (t.g * t.a + b.g * b.a * (1 - t.a)) / a, b: (t.b * t.a + b.b * b.a * (1 - t.a)) / a, a }; };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (/gradient/.test(cs.backgroundImage)) { const g = parse((cs.backgroundImage.match(/rgba?\([^)]+\)/) || [])[0]); if (g) { layers.push(g); if (g.a >= 1) break; } }
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    let fg = parse(getComputedStyle(el).color);
    if (fg.a < 1) fg = over(fg, bg);
    const l1 = lum(fg), l2 = lum(bg);
    return +(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2));
  };
  // Is `needle` inside el's text laid out entirely within el's own box (not
  // clipped by an ellipsis, a line clamp, or a zero-width track)?
  window.__pvTextVisible = (el, needle) => {
    const box = el.getBoundingClientRect();
    if (box.width < 1) return 'element is ' + box.width + 'px wide';
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode());) {
      const i = n.textContent.indexOf(needle);
      if (i < 0) continue;
      const range = document.createRange();
      range.setStart(n, i); range.setEnd(n, i + needle.length);
      const rects = [...range.getClientRects()];
      const out = rects.filter((q) => q.left < box.left - 1 || q.right > box.right + 1 || q.top < box.top - 1 || q.bottom > box.bottom + 1);
      if (!rects.length) return 'no layout for "' + needle + '"';
      return out.length ? '"' + needle + '" runs outside the ' + Math.round(box.width) + 'x' + Math.round(box.height) + ' box' : '';
    }
    return 'text "' + needle + '" not found in "' + el.textContent.trim().slice(0, 60) + '"';
  };
}

async function installProbes(page) { await safeEvaluate(page, hitProbeSrc); }

// Minimal PNG reader (8-bit RGB/RGBA, non-interlaced — what Chromium's
// screenshots are) so a swatch's painted colour can be sampled.
function decodePng(buf) {
  let p = 8; let w; let h; let depth; let type; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const kind = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; }
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    p += 12 + len;
  }
  const bpp = type === 6 ? 4 : type === 2 ? 3 : 0;
  if (depth !== 8 || !bpp) throw new Error(`unsupported PNG (depth ${depth}, colour type ${type})`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0;
      const b = y ? px[dst - stride + x] : 0;
      const c = x >= bpp && y ? px[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const q = a + b - c; const pa = Math.abs(q - a); const pb = Math.abs(q - b); const pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + x] = v & 255;
    }
  }
  return { w, h, at: (x, y) => { const i = y * stride + x * bpp; return [px[i], px[i + 1], px[i + 2]]; } };
}

// ── dashboard widgets + bell ───────────────────────────────────────────────

test.describe('phone views: dashboard lead widgets and the bell @audit', () => {
  test('Hot Leads, Next Best Actions and the bell fit 412 and 360', async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page);
    await installProbes(page);

    for (const width of [412, 360]) {
      await page.setViewportSize({ width, height: 860 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.locator('#mni-dash').tap();
      await safeEvaluate(page, () => window.dispatchEvent(new Event('nbd:data-refreshed')));
      await expect(page.locator('#hot-leads-body .hot-lead-row').first()).toBeVisible({ timeout: 15_000 });
      await settled(page, '#hot-leads-body');

      await test.step(`views#4 Hot Leads rows show the name and every action @${width}`, async () => {
        const rows = await page.evaluate(async () => {
          const out = [];
          const SEL = '#hot-leads-body .hot-lead-row';
          for (let i = 0; i < document.querySelectorAll(SEL).length; i++) {
            document.querySelectorAll(SEL)[i].scrollIntoView({ block: 'center' });
            await new Promise((r) => setTimeout(r, 60));
            // Re-query after the wait: a data refresh re-renders the widget
            // and would leave a held row detached. Measure synchronously.
            const row = document.querySelectorAll(SEL)[i];
            if (!row) break;
            const nameLine = row.children[1] && row.children[1].firstElementChild;
            const lead = (window._leads || []).find((l) => l && l.id === row.getAttribute('data-lead-id')) || {};
            const first = String(lead.firstName || '').trim() || (nameLine ? nameLine.textContent.trim().split(/\s+/)[0] : '');
            const panel = row.closest('.panel').getBoundingClientRect();
            const acts = [...row.querySelectorAll('.hl-action')].map((a) => {
              const r = a.getBoundingClientRect();
              const inPanel = r.left >= panel.left - 1 && r.right <= panel.right + 1;
              return (inPanel ? '' : `${a.dataset.action} outside the card (${Math.round(r.left)}-${Math.round(r.right)} vs ${Math.round(panel.left)}-${Math.round(panel.right)}) `) + (window.__pvHit(a) ? `${a.dataset.action} ${window.__pvHit(a)}` : '');
            }).filter(Boolean);
            out.push({ first, nameProblem: nameLine ? window.__pvTextVisible(nameLine, first) : 'no name line', acts, nActs: row.querySelectorAll('.hl-action').length });
          }
          return out;
        });
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.some((r) => r.nActs >= 4), 'at least one row carries a 4-5 action cluster (the case that squeezed the name)').toBe(true);
        for (const r of rows) {
          expect(r.nameProblem, `Hot Leads row for "${r.first}" must show the name`).toBe('');
          expect(r.acts, `Hot Leads row for "${r.first}": every action inside the card and tappable`).toEqual([]);
        }
      });

      await test.step(`views#4 a real tap on 💤 opens snooze without sliding the card @${width}`, async () => {
        await settled(page, '#hot-leads-body');
        const snooze = page.locator('#hot-leads-body .hot-lead-row .hl-action[data-action="snooze"]').last();
        await snooze.tap();
        await expect(page.locator('#nbd-snooze-overlay')).toBeVisible();
        // A button past the card's overflow:hidden edge is only "tappable" to
        // Playwright, which scrolls the clipped card sideways to reach it — a
        // finger can't. The card must not have moved.
        const scrollLeft = await page.evaluate(() => document.querySelector('#hot-leads-body').closest('.panel').scrollLeft);
        expect(scrollLeft, 'Hot Leads card was scrolled sideways to reach 💤').toBe(0);
        await page.locator('#nbd-snooze-cancel').tap();
        await expect(page.locator('#nbd-snooze-overlay')).toHaveCount(0);
      });

      await test.step(`views#5 Next Best Actions headlines reach the customer's name @${width}`, async () => {
        await expect(page.locator('#smart-followup-briefing-body .sfb-row').first()).toBeVisible({ timeout: 15_000 });
        await settled(page, '#smart-followup-briefing-body');
        const rows = await page.evaluate(async () => {
          const out = [];
          const SEL = '#smart-followup-briefing-body .sfb-row';
          for (let i = 0; i < document.querySelectorAll(SEL).length; i++) {
            document.querySelectorAll(SEL)[i].scrollIntoView({ block: 'center' });
            await new Promise((r) => setTimeout(r, 60));
            const row = document.querySelectorAll(SEL)[i];
            if (!row) break;
            const lead = (window._leads || []).find((l) => l && l.id === row.getAttribute('data-sfb-lead-id')) || {};
            const name = `${lead.firstName || ''} ${lead.lastName || ''}`.trim();
            const headline = row.querySelector('.sfb-headline');
            if (!name || !headline.textContent.includes(name)) { out.push({ name, skipped: true }); continue; }
            out.push({
              name,
              nameProblem: window.__pvTextVisible(headline, name),
              acts: [...row.querySelectorAll('.sfb-action')].map((a) => window.__pvHit(a)).filter(Boolean),
              minAct: Math.min(...[...row.querySelectorAll('.sfb-action')].map((a) => Math.min(a.getBoundingClientRect().width, a.getBoundingClientRect().height))),
            });
          }
          return out;
        });
        const checked = rows.filter((r) => !r.skipped);
        expect(checked.length, 'at least one headline names its customer').toBeGreaterThan(0);
        for (const r of checked) {
          expect(r.nameProblem, `Next Best Actions headline must show "${r.name}"`).toBe('');
          expect(r.acts, `Next Best Actions actions for ${r.name} tappable`).toEqual([]);
          // Same 36px touch floor as the other lead widgets' actions (Wave 81).
          expect(r.minAct, `Next Best Actions action size for ${r.name}`).toBeGreaterThanOrEqual(36);
        }
      });

      await test.step(`views#8 the bell's rows give the title the row, and every control is thumb-sized @${width}`, async () => {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.locator('#notifBtn').tap();
        await expect(page.locator('#notifDropdown')).toBeVisible();
        const bell = await page.evaluate(() => {
          const dd = document.getElementById('notifDropdown');
          const items = [...dd.querySelectorAll('#notifList .notif-item')].slice(0, 4).map((it) => {
            const col = it.children[1];
            return { title: col.children[0].textContent.trim().slice(0, 40), colW: col.getBoundingClientRect().width, itemW: it.getBoundingClientRect().width };
          });
          const controls = [...dd.querySelectorAll('button[data-fn="markAllNotificationsRead"], #clearAllNotifBtn, #notifList .notif-item button[data-nb-action="dismiss"]')].slice(0, 3).map((b) => {
            const r = b.getBoundingClientRect();
            return { label: b.textContent.trim() || b.title, h: Math.round(r.height), w: Math.round(r.width), hit: window.__pvHit(b) };
          });
          const nav = document.getElementById('mobile-nav').getBoundingClientRect();
          const list = document.getElementById('notifList');
          return { items, controls, ddBottom: dd.getBoundingClientRect().bottom, navTop: nav.top, listH: list.clientHeight, listMore: list.scrollHeight > list.clientHeight + 1 };
        });
        expect(bell.items.length, 'bell has rows to measure').toBeGreaterThan(0);
        for (const it of bell.items) {
          expect(it.colW, `bell row "${it.title}": the text column should get most of the row, not a sliver beside the actions`).toBeGreaterThanOrEqual(it.itemW * 0.6);
        }
        for (const c of bell.controls) {
          expect(c.h, `bell control "${c.label}" height`).toBeGreaterThanOrEqual(32);
          expect(c.w, `bell control "${c.label}" width`).toBeGreaterThanOrEqual(32);
          expect(c.hit, `bell control "${c.label}"`).toBe('');
        }
        expect(bell.ddBottom, 'the open bell panel must stop above the bottom nav').toBeLessThanOrEqual(bell.navTop);
        // With more alerts than fit, the list uses the panel's height rather
        // than its old inline 300px cap (2-3 of 10 rows visible).
        if (bell.listMore) expect(bell.listH, 'bell list height when it has more to show').toBeGreaterThan(300);
        await page.locator('#notifBtn').tap();
        await expect(page.locator('#notifDropdown')).toBeHidden();
      });
    }
  });
});

// ── Settings ───────────────────────────────────────────────────────────────

test.describe('phone views: Settings panels @audit', () => {
  test('Profile, Team, Company Profile and Pipelines work at phone width', async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page);
    await installProbes(page);
    await openMore(page, 'settings');
    await expect(page.locator('#stab-panel-profile')).toBeVisible({ timeout: 15_000 });

    for (const width of [412, 360]) {
      await page.setViewportSize({ width, height: 860 });
      await test.step(`views#6 Profile fields stack one per row @${width}`, async () => {
        await openSettingsTab(page, 'profile');
        const rows = await page.evaluate(() => [...document.querySelectorAll('#stab-panel-profile .sf-row')].map((row) => {
          const rw = row.getBoundingClientRect().width;
          return { label: (row.querySelector('label') || row).textContent.trim().slice(0, 30), rw, fields: [...row.children].map((f) => f.getBoundingClientRect().width) };
        }));
        expect(rows.length).toBeGreaterThan(0);
        for (const r of rows) {
          for (const fw of r.fields) expect(fw, `Profile field "${r.label}" should span the row on a phone`).toBeGreaterThanOrEqual(r.rw * 0.9);
        }
        const digestLabelH = await page.evaluate(() => document.getElementById('settingsWeeklyDigest').closest('label').getBoundingClientRect().height);
        expect(digestLabelH, '"Send me the weekly digest" should read in a few lines, not a 9px column').toBeLessThanOrEqual(64);
      });
    }

    await page.setViewportSize({ width: 412, height: 860 });
    await test.step('views#7 Team: the invite address is full width and its text visible', async () => {
      await openSettingsTab(page, 'team');
      const email = page.locator('#inviteRepEmail');
      await email.scrollIntoViewIfNeeded();
      await email.tap();
      await page.keyboard.type('alice.estimator@example.test');
      const m = await page.evaluate(() => {
        const el = document.getElementById('inviteRepEmail');
        const send = document.querySelector('[data-fn="inviteTeamMember"]');
        return { w: el.clientWidth, sw: el.scrollWidth, contrast: window.__pvContrast(el), owner: window.__pvContrast(document.getElementById('teamOwnerName')), sendHit: window.__pvHit(send) };
      });
      expect(m.w, 'invite email box width').toBeGreaterThanOrEqual(200);
      expect(m.sw, 'the whole typed address fits the box').toBeLessThanOrEqual(m.w + 2);
      expect(m.contrast, 'typed address contrast').toBeGreaterThanOrEqual(4.5);
      expect(m.owner, 'owner name contrast').toBeGreaterThanOrEqual(4.5);
      expect(m.sendHit, 'Send Invite reachable').toBe('');
      await email.fill('');
    });

    await test.step('views#13 brand colour pickers show the saved colour', async () => {
      await openSettingsTab(page, 'company-profile');
      const picker = page.locator('#cp_brand_colorAccent');
      await picker.scrollIntoViewIfNeeded();
      await animationsDone(page);
      // Nothing may sit on top of it when it is sampled (a toast would make
      // the pixel read meaningless) — and it must be reachable anyway.
      await expect.poll(() => page.evaluate(() => window.__pvHit(document.getElementById('cp_brand_colorAccent'))), { timeout: 12_000 }).toBe('');
      const hex = await picker.inputValue();
      const box = await picker.boundingBox();
      expect(box.height, 'colour picker height').toBeGreaterThanOrEqual(36);
      const shot = decodePng(await picker.screenshot());
      const got = shot.at(Math.floor(shot.w / 2), Math.floor(shot.h / 2));
      const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const off = Math.max(...got.map((v, i) => Math.abs(v - want[i])));
      expect(off, `swatch centre should paint ${hex}, painted rgb(${got.join(',')})`).toBeLessThanOrEqual(16);
    });

    await test.step('views#9 Pipelines: thumb-sized reorder controls and a Save that follows you', async () => {
      await openSettingsTab(page, 'pipelines');
      const rows = page.locator('#pipelineBuilderRoot .pb-stage-row');
      await expect(rows.first()).toBeVisible({ timeout: 15_000 });
      // Save must never write the shared tenant config from a test: stub the
      // profile writer and record what Save hands it.
      await page.evaluate(() => {
        window.__pvSaves = [];
        window._saveCompanyProfile = async (patch) => { window.__pvSaves.push(patch); };
      });

      // Edit the LAST stage of the LAST pipeline — the far end of a ~6,600px
      // panel, where the header's Save is screens away.
      const rename = page.locator('#pipelineBuilderRoot input[data-pb-action="rename"]').last();
      await rename.scrollIntoViewIfNeeded();
      await rename.tap();
      await page.keyboard.type('X');
      const bar = await page.evaluate(() => {
        const vh = window.innerHeight;
        const inView = [...document.querySelectorAll('#pipelineBuilderRoot [data-pb-action="save"]')].filter((b) => {
          const r = b.getBoundingClientRect();
          return r.height > 0 && r.top >= 0 && r.bottom <= vh && !window.__pvHit(b);
        });
        return { n: inView.length, h: inView[0] ? inView[0].getBoundingClientRect().height : 0 };
      });
      expect(bar.n, 'a tappable Save is on screen right after editing the last stage').toBe(1);
      expect(bar.h).toBeGreaterThanOrEqual(36);
      const visibleSave = page.locator('#pipelineBuilderRoot .pb-savebar [data-pb-action="save"]');
      await visibleSave.tap();
      await expect.poll(() => page.evaluate(() => window.__pvSaves.length)).toBe(1);
      expect(await page.evaluate(() => !!(window.__pvSaves[0] && window.__pvSaves[0].pipelines))).toBe(true);
      await expect(visibleSave).toBeHidden();

      // Touch-sized ▲ / ▼ / 👁 / ✕, and ▼ really reorders.
      const first = rows.first();
      await first.scrollIntoViewIfNeeded();
      const sizes = await first.evaluate((row) => [...row.querySelectorAll('button.pb-mini')].map((b) => {
        const r = b.getBoundingClientRect();
        return { a: b.dataset.pbAction, w: r.width, h: r.height, hit: window.__pvHit(b) };
      }));
      for (const s of sizes) {
        expect(s.w, `${s.a} width`).toBeGreaterThanOrEqual(36);
        expect(s.h, `${s.a} height`).toBeGreaterThanOrEqual(36);
        expect(s.hit, `${s.a} reachable`).toBe('');
      }
      const view = await first.getAttribute('data-view');
      const order = () => page.evaluate((v) => [...document.querySelectorAll(`#pipelineBuilderRoot .pb-stage-row[data-view="${v}"]`)].map((r) => r.dataset.stage), view);
      const before = await order();
      await first.locator('button.pb-mini[data-pb-action="down"]').tap();
      const after = await order();
      expect(after.slice(0, 2), '▼ on the first stage swaps it with the second').toEqual([before[1], before[0]]);
    });
  });
});

// ── Settings → Estimates → Upgrade prices ──────────────────────────────────
//
// Upgrades & Add-ons stage 2 (2026-09-25). No research-guess price may reach
// a homeowner, so six gutter upgrades ship with NO price and stay off every
// quote until the company saves one here. This drives the real panel with
// real taps — at 412 and 360, and with the installed app's
// @media(display-mode: standalone) cascade forced on (Jo prices from the
// iPhone home-screen app; a browser tab never matches that query) — then
// proves the save is REAL: the Firestore doc holds whole cents, NBDUpgrades
// quotes it with no argument passed, and a reload paints it back.

// The installed-app cascade, copied to the top level (same technique as
// phone-dashnav.spec.js 'draw (installed app)').
async function forceStandalone(page) {
  return safeEvaluate(page, () => {
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
}
async function unforceStandalone(page) {
  await safeEvaluate(page, () => { const s = document.getElementById('e2e-force-standalone'); if (s) s.remove(); });
}

// companyProfile/{key}.pricing.upgradePrices as the SERVER holds it — read
// with getDoc, not window._companyProfile, which _saveCompanyProfile updates
// before its write has landed.
async function serverUpgradePrices(page) {
  return safeEvaluate(page, async () => {
    const fs = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const key = await window._resolveCompanyKey();
    const snap = await fs.getDoc(fs.doc(window.db, 'companyProfile', String(key)));
    const d = snap.exists() ? snap.data() : {};
    return { key: String(key), map: (d.pricing && d.pricing.upgradePrices) || null };
  });
}

test.describe('phone views: Settings upgrade prices @audit', () => {
  test('price a needs_price item, switch one Off, Save, reload: persisted and quoted', async ({ page }) => {
    test.setTimeout(180_000);
    const ROWS = '#upgPriceRows';
    const FASCIA = '[data-upg-id="fascia_wrap"]';
    const FLIP = '[data-upg-id="flip_up_extension"]';
    const APRON = '[data-upg-id="gutter_apron"]';

    const openPanel = async () => {
      await openMore(page, 'settings');
      await openSettingsTab(page, 'estimates');
      await expect(page.locator(ROWS)).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
      await expect(page.locator(ROWS)).toHaveAttribute('data-editable', '1');
    };

    await boot(page);
    await installProbes(page);
    await openPanel();

    // This test writes the seeded tenant's companyProfile — a real save and
    // reload is the point. Snapshot the one field it touches and put it back
    // whatever happens: later specs in the shard read the same doc.
    const original = await serverUpgradePrices(page);
    try {
      const libCount = await page.evaluate(() => window.NBD_UPGRADE_LIBRARY.items.length);

      const layout = async (label) => {
        const m = await safeEvaluate(page, () => {
          const panel = document.getElementById('upgPricePanel').getBoundingClientRect();
          const out = { overflow: document.documentElement.scrollWidth - window.innerWidth, rows: [] };
          document.querySelectorAll('#upgPriceRows [data-upg-id]').forEach((row) => {
            const r = row.getBoundingClientRect();
            const ctl = [row.querySelector('[data-upg-price]'), row.querySelector('[data-upg-enabled]')];
            out.rows.push({
              id: row.dataset.upgId,
              inside: r.left >= panel.left - 0.5 && r.right <= panel.right + 0.5,
              hits: ctl.map((el) => { el.scrollIntoView({ block: 'center' }); return window.__pvHit(el); }),
              heights: ctl.map((el) => Math.round(el.closest('label').getBoundingClientRect().height)),
            });
          });
          const save = document.getElementById('upgPriceSave');
          save.scrollIntoView({ block: 'center' });
          out.save = window.__pvHit(save);
          out.saveH = Math.round(save.getBoundingClientRect().height);
          return out;
        });
        expect(m.overflow, `${label}: the page does not scroll sideways`).toBeLessThanOrEqual(0);
        expect(m.rows.length, `${label}: one row per library upgrade`).toBe(libCount);
        for (const r of m.rows) {
          expect(r.inside, `${label}: ${r.id} row stays inside the panel`).toBe(true);
          expect(r.hits, `${label}: ${r.id} price field and On/Off switch are reachable`).toEqual(['', '']);
          for (const h of r.heights) expect(h, `${label}: ${r.id} control is thumb-sized`).toBeGreaterThanOrEqual(44);
        }
        expect(m.save, `${label}: Save upgrade prices reachable`).toBe('');
        expect(m.saveH, `${label}: Save height`).toBeGreaterThanOrEqual(44);
      };

      for (const width of [412, 360]) {
        await page.setViewportSize({ width, height: 860 });
        await test.step(`upgrade rows fit and every control is reachable @${width}`, () => layout('@' + width));
      }
      await page.setViewportSize({ width: 412, height: 860 });
      expect(await forceStandalone(page), 'found the standalone rules to force').toBeGreaterThan(200);

      await test.step('installed app: rows fit and a bad price saves nothing', async () => {
        await layout('installed app @412');
        const apron = page.locator(APRON + ' [data-upg-price]');
        await apron.tap();
        await page.keyboard.type('6,50');
        await expect(page.locator(APRON + ' [data-upg-error]')).toHaveText(/dot for cents/);
        await page.locator('#upgPriceSave').tap();
        await expect(page.locator('#upgPriceMsg')).toHaveText(/Nothing was saved/);
        expect((await serverUpgradePrices(page)).map, 'the refused save wrote nothing').toEqual(original.map);
        await apron.fill('');
        await expect(page.locator(APRON + ' [data-upg-badge]')).toBeVisible();
      });

      await test.step('installed app: price the fascia wrap, switch flip-ups Off, Save', async () => {
        const fascia = page.locator(FASCIA + ' [data-upg-price]');
        await expect(fascia, 'fascia wrap starts unpriced').toHaveValue('');
        await expect(page.locator(FASCIA + ' [data-upg-badge]')).toHaveText('Set a price');
        await fascia.tap();
        await page.keyboard.type('9.75');
        await expect(page.locator(FASCIA + ' [data-upg-status]')).toHaveText('Offered at $9.75 per foot (your price).');
        await expect(page.locator(FASCIA + ' [data-upg-badge]')).toBeHidden();

        const flip = page.locator(FLIP + ' [data-upg-enabled]');
        await expect(flip, 'flip-up extension starts On').toBeChecked();
        await flip.tap();
        await expect(flip).not.toBeChecked();
        await expect(page.locator(FLIP + ' [data-upg-onoff]')).toHaveText('Off');
        await expect(page.locator(FLIP + ' [data-upg-status]')).toHaveText('Off. Reps never see it.');

        await page.locator('#upgPriceSave').tap();
        await expect(page.locator('#upgPriceMsg')).toHaveText('✓ Upgrade prices saved for your whole company.', { timeout: 20_000 });
      });

      await test.step('Firestore holds whole cents, and NBDUpgrades quotes it with no argument', async () => {
        const saved = (await serverUpgradePrices(page)).map;
        expect(Object.keys(saved || {}).length, 'one entry per library upgrade').toBe(libCount);
        expect(saved.fascia_wrap).toEqual({ cents: 975, enabled: true });
        expect(saved.flip_up_extension).toEqual({ cents: null, enabled: false });
        const seen = await safeEvaluate(page, () => {
          const m = {};
          // A gutter repair family offers both items; no tenantOverrides
          // argument — the builder card reads the saved Settings this way.
          window.NBDUpgrades.offeredFor('jt_gr_reseal', { lines: [] }).forEach((o) => { m[o.id] = o; });
          const q = window.NBDUpgrades.price([{ id: 'fascia_wrap', qty: 40 }], { templateIds: ['jt_gr_reseal'], lines: [], taxRate: 0 });
          return {
            fascia: [m.fascia_wrap.state, m.fascia_wrap.unitCents, m.fascia_wrap.priceSource],
            flip: m.flip_up_extension.state,
            quote: [q.errors.length, q.upgradeCents, q.rows[0] && q.rows[0].total],
          };
        });
        expect(seen.fascia).toEqual(['available', 975, 'tenant']);
        expect(seen.flip).toBe('hidden');
        expect(seen.quote, '40 ft × $9.75 = $390.00 exactly').toEqual([0, 39000, 390]);
      });
      await unforceStandalone(page);

      await test.step('reload: the panel paints the saved price and the Off switch back', async () => {
        await page.reload();
        await page.waitForURL(/\/pro\/dashboard/);
        await safeWaitForFunction(page, () => typeof window.goTo === 'function', { timeout: 30_000 });
        await skipTour(page);
        await installProbes(page);
        await openPanel();
        await expect(page.locator(FASCIA + ' [data-upg-price]')).toHaveValue('9.75');
        await expect(page.locator(FASCIA + ' [data-upg-status]')).toHaveText('Offered at $9.75 per foot (your price).');
        await expect(page.locator(FLIP + ' [data-upg-enabled]')).not.toBeChecked();
        await expect(page.locator(FLIP + ' [data-upg-status]')).toHaveText('Off. Reps never see it.');
      });
    } finally {
      await unforceStandalone(page).catch(() => {});
      await safeEvaluate(page, async (o) => {
        const fs = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        await fs.updateDoc(fs.doc(window.db, 'companyProfile', o.key), {
          'pricing.upgradePrices': o.map == null ? fs.deleteField() : o.map,
        });
      }, original);
    }
  });
});

// ── Products + Sales Training ──────────────────────────────────────────────

test.describe('phone views: Products and Sales Training @audit', () => {
  test('Products opens collapsed with thumb-sized card buttons; the drill opens', async ({ page }) => {
    test.setTimeout(90_000);
    await boot(page);
    await installProbes(page);

    await test.step('views#14 Products starts collapsed on a phone', async () => {
      await openMore(page, 'products');
      await expect(page.locator('#productLibraryContainer [data-pl-action="toggleCategory"]').first()).toBeVisible({ timeout: 15_000 });
      const m = await page.evaluate(() => ({
        openGrids: [...document.querySelectorAll('#productLibraryContainer .pl-product-grid')].filter((g) => g.offsetParent !== null).length,
        docH: document.documentElement.scrollHeight,
      }));
      expect(m.openGrids, 'no category grid open on arrival').toBe(0);
      expect(m.docH, 'the library is a list of categories, not ~88,000px of cards').toBeLessThan(12_000);
    });

    await test.step('views#14 a tapped category shows 36px+ Edit / Archive, and Edit opens the editor', async () => {
      const header = page.locator('#productLibraryContainer [data-pl-action="toggleCategory"]').first();
      await header.scrollIntoViewIfNeeded();
      await header.tap();
      const edit = page.locator('#productLibraryContainer [data-pl-action="editProduct"]').first();
      await expect(edit).toBeVisible();
      await edit.scrollIntoViewIfNeeded();
      const m = await page.evaluate(() => ['editProduct', 'archiveProduct'].map((a) => {
        const b = document.querySelector(`#productLibraryContainer [data-pl-action="${a}"]`);
        const r = b.getBoundingClientRect();
        return { a, h: r.height, hit: window.__pvHit(b) };
      }));
      for (const b of m) {
        expect(b.h, `${b.a} height`).toBeGreaterThanOrEqual(36);
        expect(b.hit, `${b.a} reachable`).toBe('');
      }
      await edit.tap();
      await expect(page.locator('#product-edit-modal')).toBeVisible();
      const cancel = page.locator('#product-edit-modal [data-pl-action="closeModal"]', { hasText: 'Cancel' });
      await cancel.scrollIntoViewIfNeeded();
      await cancel.tap();
      await expect(page.locator('#product-edit-modal')).toHaveCount(0);
    });

    await test.step('views#14 a search shows its matches without tapping a category', async () => {
      const search = page.locator('#product-search');
      await search.scrollIntoViewIfNeeded();
      await search.fill('shingle');
      await expect(page.locator('#productLibraryContainer .pl-card').first()).toBeVisible();
      await page.locator('#product-search').fill('');
    });

    await test.step('Sales Training: the Objection Obliterator drill opens from a tap', async () => {
      await openMore(page, 'training');
      const banner = page.locator('.rapid-banner');
      // Sales Training is a ~150KB lazy bundle (script-loader.js `training`);
      // on a loaded runner it outlasts the 15s action timeout.
      await expect(banner).toBeVisible({ timeout: 45_000 });
      await banner.scrollIntoViewIfNeeded();
      await banner.tap();
      await expect(page.locator('.rapid-objection')).toBeVisible();
    });
  });
});

// ── light mode ─────────────────────────────────────────────────────────────

test.describe('phone views: light mode stays readable @audit', () => {
  test.use({ colorScheme: 'light' });

  test('chrome, dashboard labels, Talk Tank, the drill and Settings clear contrast', async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page, { reload: true });
    await installProbes(page);
    const palette = await page.evaluate(() => {
      const m = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g).map(Number);
      return { mode: document.documentElement.getAttribute('data-mode'), light: (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255 > 0.5 };
    });
    expect(palette, 'the light palette is painted on the second boot').toEqual({ mode: 'light', light: true });

    await test.step('views#11 header wordmark, header icons and bottom-nav labels', async () => {
      const c = await page.evaluate(() => ({
        logo: window.__pvContrast(document.querySelector('header .logo')),
        // The ↻ beside the sync dot (connection-status-btn.js) had no colour of
        // its own, so it painted the UA's black buttontext on the dark bar.
        sync: (() => { const g = document.querySelector('#nbd-conn-btn span:last-child'); return g ? window.__pvContrast(g) : null; })(),
        tools: [...document.querySelectorAll('header .hdr-tool')].filter((b) => b.offsetParent !== null).map((b) => window.__pvContrast(b)),
        nav: [...document.querySelectorAll('#mobile-nav .mn-item:not(.active):not(.mn-fab) .mn-lbl')].map((l) => ({ t: l.textContent.trim(), c: window.__pvContrast(l) })),
      }));
      expect(c.logo, '"NBD" wordmark on the dark header').toBeGreaterThanOrEqual(4.5);
      expect(c.sync, 'the header sync button renders').not.toBeNull();
      expect(c.sync, '↻ sync glyph on the dark header').toBeGreaterThanOrEqual(4.5);
      for (const t of c.tools) expect(t, 'header icon').toBeGreaterThanOrEqual(3);
      expect(c.nav.length).toBeGreaterThan(0);
      for (const n of c.nav) expect(n.c, `bottom-nav "${n.t}"`).toBeGreaterThanOrEqual(4.5);
      // :hover turned a header icon var(--t) — #0f172a on the near-black bar,
      // 1.04:1 — and on Android a tap leaves :hover stuck on what was tapped,
      // so the bell went dark-on-dark right after you opened it. Tap it for
      // real, then let the icon's .15s colour transition finish: read
      // immediately, it still shows the resting colour and the check passes
      // with the bug present.
      await page.locator('#notifBtn').tap();
      await animationsDone(page);
      const hovered = await page.evaluate(() => {
        const b = document.getElementById('notifBtn');
        return { stuck: b.matches(':hover'), c: window.__pvContrast(b) };
      });
      expect(hovered.stuck, 'a tap leaves :hover on the bell (the Android case this pins)').toBe(true);
      expect(hovered.c, 'hovered header icon on the dark header').toBeGreaterThanOrEqual(3);
      await page.locator('#notifBtn').tap();
      await expect(page.locator('#notifDropdown')).toBeHidden();
    });

    await test.step('views#11 Engagement Cohort + Next Best Actions labels', async () => {
      await page.locator('#mni-dash').tap();
      await safeEvaluate(page, () => window.dispatchEvent(new Event('nbd:data-refreshed')));
      // Tier rows: the grid children of the cohort list (label | bar | count).
      await safeWaitForFunction(page, () => [...document.querySelectorAll('#engagement-cohort-body > div:first-child > div')].some((r) => getComputedStyle(r).display === 'grid'), { timeout: 15_000 });
      await expect(page.locator('#smart-followup-briefing-body .sfb-row').first()).toBeVisible({ timeout: 15_000 });
      const c = await page.evaluate(() => ({
        // Empty tiers are dimmed to .45 on purpose; judge the live ones.
        cohort: [...document.querySelectorAll('#engagement-cohort-body > div:first-child > div')]
          .filter((r) => getComputedStyle(r).display === 'grid' && getComputedStyle(r).opacity === '1')
          .map((r) => ({ t: r.firstElementChild.textContent.trim(), c: window.__pvContrast(r.firstElementChild) })),
        // The TODAY / URGENT label: first span of the row's text column.
        sfb: [...document.querySelectorAll('#smart-followup-briefing-body .sfb-row > div:nth-child(2) > div:first-child > span:first-child')].map((l) => ({ t: l.textContent.trim(), c: window.__pvContrast(l) })),
      }));
      expect(c.cohort.length, 'at least one populated cohort tier').toBeGreaterThan(0);
      for (const x of c.cohort) expect(x.c, `cohort "${x.t}"`).toBeGreaterThanOrEqual(4.5);
      expect(c.sfb.length).toBeGreaterThan(0);
      for (const x of c.sfb) expect(x.c, `Next Best Actions "${x.t}" label`).toBeGreaterThanOrEqual(4.5);
    });

    await test.step('views#11 Talk Tank active filter chip', async () => {
      // Talk Tank has no phone entry point yet (views#1, another lane), so it
      // is opened the way the sidebar does it.
      await safeEvaluate(page, () => window.goTo('talk-tank'));
      const chip = page.locator('#view-talk-tank .tt-chip[data-tt-id]').first();
      await expect(chip).toBeVisible({ timeout: 15_000 });
      const c = await page.evaluate(() => {
        const a = document.querySelector('#view-talk-tank .tt-chip-active') || document.querySelector('#view-talk-tank .tt-chip');
        const bg = getComputedStyle(a).backgroundColor;
        return { bgPainted: !/rgba\(0, 0, 0, 0\)|transparent/.test(bg), c: window.__pvContrast(a) };
      });
      expect(c.bgPainted, 'the active chip has a fill').toBe(true);
      expect(c.c, 'active chip text').toBeGreaterThanOrEqual(4.5);
    });

    await test.step('views#3 Objection Obliterator banner and drill', async () => {
      await openMore(page, 'training');
      const banner = page.locator('.rapid-banner');
      await expect(banner).toBeVisible({ timeout: 45_000 }); // lazy `training` bundle, see above
      await banner.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => window.__pvContrast(document.querySelector('.rb-title'))), 'banner title').toBeGreaterThanOrEqual(4.5);
      await banner.tap();
      await expect(page.locator('.rapid-objection')).toBeVisible();
      expect(await page.evaluate(() => window.__pvContrast(document.querySelector('.rapid-objection'))), 'the objection to answer').toBeGreaterThanOrEqual(4.5);
    });

    await test.step('views#7 siblings: Team owner name and Billing usage figures', async () => {
      await openMore(page, 'settings');
      await openSettingsTab(page, 'team');
      expect(await page.evaluate(() => window.__pvContrast(document.getElementById('teamOwnerName'))), 'owner name').toBeGreaterThanOrEqual(4.5);
      await openSettingsTab(page, 'billing');
      const figs = await page.evaluate(() => ['billingLeadsUsed', 'billingReportsUsed', 'billingAIUsed'].map((id) => ({ id, c: window.__pvContrast(document.getElementById(id)) })));
      for (const f of figs) expect(f.c, f.id).toBeGreaterThanOrEqual(4.5);
    });
  });
});
