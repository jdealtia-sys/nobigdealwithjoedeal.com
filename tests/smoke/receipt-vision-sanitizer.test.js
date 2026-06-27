/**
 * tests/smoke/receipt-vision-sanitizer.test.js — unit tests for
 * receipt-vision.js's pure helpers (Phase 2 receipt OCR).
 *
 * Like photo-vision-sanitizer.test.js, this `require`s the function module and
 * exercises the REAL exported helpers via `_test` — these are the boundary
 * between Claude's free-form receipt extraction and what the expense form
 * pre-fills. A drift or pathological response that bypassed the clamps would
 * write garbage money into the ledger, so every field flows through
 * sanitizeReceipt; reconcile + computeNeedsReview are the human-in-the-loop
 * guard against a confidently-wrong total.
 */

'use strict';

const path = require('path');
const { FUNCTIONS } = require('./_shared');

let T, loadError;
try {
  const mod = require(path.join(FUNCTIONS, 'receipt-vision.js'));
  T = mod && mod._test;
} catch (e) { loadError = e; }

module.exports.run = function run(ctx) {
  const { assert, section } = ctx;

  section('receipt-vision sanitizer — real function calls (not regex)');
  {
    assert('receipt-vision.js loads without throwing', !loadError, loadError ? loadError.message : '');
    assert('_test helpers exported',
      !!(T && T.sanitizeReceipt && T.reconcile && T.computeNeedsReview && T.dollarsToCents),
      'expected sanitizeReceipt/reconcile/computeNeedsReview/dollarsToCents');
    if (!T || typeof T.sanitizeReceipt !== 'function') return;

    const { sanitizeReceipt, reconcile, computeNeedsReview, dollarsToCents } = T;

    // ── dollarsToCents ──
    assert('dollarsToCents 12.34 -> 1234', dollarsToCents(12.34) === 1234);
    assert('dollarsToCents "0.005" rounds -> 1', dollarsToCents('0.005') === 1);
    assert('dollarsToCents negative -> null', dollarsToCents(-5) === null);
    assert('dollarsToCents "" -> null', dollarsToCents('') === null);
    assert('dollarsToCents junk -> null', dollarsToCents('abc') === null);
    assert('dollarsToCents 0 -> 0', dollarsToCents(0) === 0);

    // ── sanitizeReceipt happy path ──
    {
      const o = sanitizeReceipt({
        vendor: '  ABC Supply  ', date: '2026-06-27', subtotal: 100, tax: 8.25, total: 108.25,
        currency: 'eur', lineItems: [{ description: 'Shingles', amount: 100 }],
        suggestedCategory: 'materials', confidence: 0.9,
      });
      assert('vendor trimmed', o.vendor === 'ABC Supply');
      assert('date passes', o.date === '2026-06-27');
      assert('subtotal -> cents', o.subtotalCents === 10000);
      assert('tax -> cents', o.taxCents === 825);
      assert('total -> cents', o.totalCents === 10825);
      assert('currency clamped to USD', o.currency === 'USD');
      assert('lineItem amount -> cents', o.lineItems[0].amountCents === 10000);
      assert('lineItem description kept', o.lineItems[0].description === 'Shingles');
      assert('suggestedCategory passes', o.suggestedCategory === 'materials');
      assert('confidence passes', o.confidence === 0.9);
    }

    // ── field clamps / rejects ──
    assert('invalid date -> null', sanitizeReceipt({ date: '06/27/2026' }).date === null);
    assert('missing total -> null', sanitizeReceipt({}).totalCents === null);
    assert('missing tax -> 0', sanitizeReceipt({}).taxCents === 0);
    assert('bad category -> null', sanitizeReceipt({ suggestedCategory: 'beer' }).suggestedCategory === null);
    assert('confidence 1.5 clamps to 1', sanitizeReceipt({ confidence: 1.5 }).confidence === 1);
    assert('confidence string -> default 0.5', sanitizeReceipt({ confidence: '0.9' }).confidence === 0.5);
    assert('negative total rejected -> null', sanitizeReceipt({ total: -10 }).totalCents === null);
    assert('lineItems capped at 50', sanitizeReceipt({
      lineItems: Array.from({ length: 80 }, (_, i) => ({ description: 'x' + i, amount: 1 })),
    }).lineItems.length === 50);
    assert('vendor non-string -> empty', sanitizeReceipt({ vendor: { x: 1 } }).vendor === '');

    // ── null safety ──
    assert('null input -> safe defaults', (() => {
      const o = sanitizeReceipt(null);
      return o.vendor === '' && o.totalCents === null && o.taxCents === 0 && o.confidence === 0.5 && Array.isArray(o.lineItems);
    })());
    assert('string input -> safe defaults', sanitizeReceipt('nope').totalCents === null);

    // ── reconcile ──
    {
      const matched = sanitizeReceipt({ total: 108.25, tax: 8.25, lineItems: [{ description: 'a', amount: 100 }] });
      const r1 = reconcile(matched);
      assert('reconcile matched when lineItems+tax == total', r1.matched === true && r1.diffCents === 0);

      const mismatch = sanitizeReceipt({ total: 200, tax: 8.25, lineItems: [{ description: 'a', amount: 100 }] });
      const r2 = reconcile(mismatch);
      assert('reconcile flags mismatch', r2.matched === false && r2.diffCents > 2);

      const noItems = sanitizeReceipt({ total: 108.25, subtotal: 100, tax: 8.25 });
      assert('reconcile uses subtotal+tax when no line items', reconcile(noItems).matched === true);

      const noTotal = sanitizeReceipt({ lineItems: [{ description: 'a', amount: 100 }] });
      assert('reconcile matched=true when no total to check', reconcile(noTotal).matched === true);
    }

    // ── computeNeedsReview ──
    {
      const good = sanitizeReceipt({ vendor: 'ABC', total: 108.25, tax: 8.25, confidence: 0.9, lineItems: [{ description: 'a', amount: 100 }] });
      assert('needsReview false on a clean, reconciled, confident receipt', computeNeedsReview(good, reconcile(good)) === false);

      const lowConf = sanitizeReceipt({ vendor: 'ABC', total: 100, confidence: 0.3 });
      assert('needsReview true on low confidence', computeNeedsReview(lowConf, reconcile(lowConf)) === true);

      const noVendor = sanitizeReceipt({ total: 100, confidence: 0.9 });
      assert('needsReview true when vendor missing', computeNeedsReview(noVendor, reconcile(noVendor)) === true);

      const noTotal = sanitizeReceipt({ vendor: 'ABC', confidence: 0.9 });
      assert('needsReview true when total missing', computeNeedsReview(noTotal, reconcile(noTotal)) === true);

      const mismatch = sanitizeReceipt({ vendor: 'ABC', total: 200, tax: 8.25, confidence: 0.9, lineItems: [{ description: 'a', amount: 100 }] });
      assert('needsReview true when reconcile fails', computeNeedsReview(mismatch, reconcile(mismatch)) === true);
    }
  }
};
