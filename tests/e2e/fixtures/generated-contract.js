// tests/e2e/fixtures/generated-contract.js — a REAL contract from the
// document generator, and the measurements the phone specs hold it to.
//
// A generated contract reaches a phone three ways, each in a sandboxed
// <iframe srcdoc>: the homeowner's signing link (sign.html), the homeowner
// portal's "Your Documents → View", and the rep's doc viewer, where it is
// signed in person. All three share one phone layout
// (docs/pro/js/doc-phone-layout.js), so all three are measured the same way:
// phone-signing.spec.js (sign.html + the doc viewer) and phone-portal.spec.js
// (the portal) both use this file.
const { safeEvaluate, safeWaitForFunction } = require('./auth');

// The page must be signed in (it runs the generator from the ScriptLoader's
// docgen bundle, as the dashboard does). The template's own inch-based CSS
// and its inline 9px clause blocks are what the specs measure, so this is
// the generator's real output, never a hand-written stand-in.
async function buildContract(page) {
  await safeWaitForFunction(page, () => window.ScriptLoader && typeof window.ScriptLoader.loadBundle === 'function', { timeout: 30_000 });
  return safeEvaluate(page, async () => {
    await window.ScriptLoader.loadBundle('docgen');
    for (let i = 0; i < 100 && !(window.NBDDocGen && window.NBDDocGen.getHTML); i++) await new Promise((r) => setTimeout(r, 100));
    try { if (window._loadCompanyProfile) await window._loadCompanyProfile(); } catch (_) {}
    const data = {
      homeownerName: 'Pat Phone', address: '118 Maple Ridge Ct, Loveland, OH 45140',
      phone: '(513) 555-0142', email: 'pat@example.com', contractPrice: '$18,430.00', startDate: '2026-10-05',
      signers: [{ role: 'homeowner', label: 'Homeowner', required: true }, { role: 'contractor', label: 'Contractor', required: true }],
      // "counterflashing" is the long word that once set the description
      // column's minimum width and pushed Total past the table edge at 360.
      lineItems: [
        { description: 'Tear-off and replace architectural shingles, including starter strip and drip edge', qty: 32, unit: 'SQ', unitPrice: 485 },
        { description: 'Ice and water shield, eaves and valleys', qty: 6, unit: 'RL', unitPrice: 95 },
        { description: 'Chimney reflash with counterflashing', qty: 1, unit: 'EA', unitPrice: 1550 },
      ],
    };
    return window.NBDDocGen._injectSignatureAssets(window.NBDDocGen.getHTML('contract', data));
  });
}

// Runs INSIDE the document's frame (pass to frame.evaluate). Everything a
// reader of the contract meets: the 3-day cancellation clause's size, the
// smallest visible text, the text column's width, the blank band above the
// header, sideways scroll of the page and of the line-item table, and any
// line-item cell cut off at the table's edge (a clipped figure).
function measureContract() {
  const title = [...document.querySelectorAll('.section-title')].find((e) => /Cancellation/i.test(e.textContent));
  const clause = title.nextElementSibling;
  const sec = title.closest('.section');
  const cs = getComputedStyle(sec);
  let minFont = Infinity;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    // The pad's own controls are the widget's, asserted separately.
    if (el.closest('.nbd-sig-controls')) continue;
    const c = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    if (c.display === 'none' || c.visibility === 'hidden' || (!b.width && !b.height)) continue;
    minFont = Math.min(minFont, parseFloat(c.fontSize));
  }
  const table = document.querySelector('.document-container table');
  const tr = table.getBoundingClientRect();
  return {
    clauseFont: parseFloat(getComputedStyle(clause).fontSize),
    column: sec.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - parseFloat(cs.borderLeftWidth),
    headerTop: document.querySelector('.document-header').getBoundingClientRect().top + scrollY,
    overflow: document.documentElement.scrollWidth - innerWidth,
    minFont,
    tableSideways: table.scrollWidth - table.clientWidth,
    clippedCells: [...table.querySelectorAll('th,td')].filter((c) => c.getBoundingClientRect().right > tr.right + 0.5).map((c) => c.textContent.trim()),
  };
}

// The phone contract, whichever surface shows it. `where` names the surface
// in every failure message.
function expectReadableOnPhone(expect, m, width, where) {
  expect(m.clauseFont, `${where} ${width}px: cancellation clause text size`).toBeGreaterThanOrEqual(15);
  expect(m.minFont, `${where} ${width}px: smallest visible text in the contract`).toBeGreaterThanOrEqual(12);
  expect(m.column, `${where} ${width}px: contract text column width`).toBeGreaterThanOrEqual(width * 0.8);
  expect(m.headerTop, `${where} ${width}px: blank band above the contract header`).toBeLessThanOrEqual(1);
  expect(m.clippedCells, `${where} ${width}px: line-item cells cut off at the table edge`).toEqual([]);
  expect(m.tableSideways, `${where} ${width}px: line-item table scrolls sideways`).toBeLessThanOrEqual(0);
  expect(m.overflow, `${where} ${width}px: contract scrolls sideways`).toBeLessThanOrEqual(0);
}

// Desktop keeps the paper layout exactly as it was.
function expectPaperOnDesktop(expect, m, where) {
  expect(m.clauseFont, `${where} desktop: clause text unchanged`).toBe(9);
  expect(m.headerTop, `${where} desktop: page offset unchanged`).toBe(66);
  expect(m.overflow, `${where} desktop: contract scrolls sideways`).toBeLessThanOrEqual(0);
}

// What legitimately varies between two signings of the same contract: the
// drawn PNGs, the signing timestamps and the "Signed <date>" stamp.
function normalizeSigned(html) {
  return html
    .replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, 'PNG')
    .replace(/data-nbd-sig-signed-at="[^"]*"/g, 'data-nbd-sig-signed-at=""')
    .replace(/Signed [A-Z][a-z]+ \d{1,2}, \d{4}/g, 'Signed DATE');
}

module.exports = { buildContract, measureContract, expectReadableOnPhone, expectPaperOnDesktop, normalizeSigned };
