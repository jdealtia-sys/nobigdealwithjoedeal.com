/**
 * customer-estimate-rows.js — customer-facing display rows for a SAVED estimate.
 *
 * The customer-portal estimate export (exportCustomerEstimate in
 * customer-bootstrap.module.js) used to print est.rows verbatim. Post-sweep V2
 * saves persist the RETAIL price in rows[].rate/total (+ rows[].retailTotal),
 * but V2/insurance docs saved BEFORE the 2026-07-18 money-math sweep wrote the
 * raw COST basis (material+labor, no markup, no O&P) there — so the portal PDF
 * showed the contractor's cost under a retail total and exposed the margin to
 * the homeowner/adjuster.
 *
 * buildDisplayRows(est) mirrors InvoicePipeline.buildRowItems (which customer
 * pages don't load) with the same ladder, per row:
 *   1. rows[].retailTotal when present            → post-sweep saves, exact
 *   2. materialTotal×(1+markup) + laborTotal      → older V2 docs w/ cost split
 *      (rows whose split is all-zero — SVC pass-through fees — stay at face)
 *   3. rows[].total verbatim                      → classic rows: already the
 *      all-in customer price; rate keeps its display string ('$595/SQ')
 * plus the same two structural rules:
 *   - per-SQ docs return NO rows: their rows are the internal cost basis and
 *     can never foot to the selected-tier grandTotal (the invoice bills these
 *     as one summary line; the server quote suppresses lines the same way)
 *   - V2 docs with an O&P ladder get an 'Overhead & Profit (N%)' row appended
 *     so the printed lines foot to the subtotal, matching the signed scope.
 *
 * Pure + dependency-free: unit-tested in tests/customer-estimate-rows.test.js.
 */
(function () {
  'use strict';

  // First numeric token out of a value — qty/rate/total may be display strings
  // ('20.00 SQ', '$595/SQ'); a bare parseFloat would NaN on the '$' forms.
  function numFrom(v) {
    if (typeof v === 'number') return v;
    const m = String(v == null ? '' : v).match(/-?\d[\d,]*\.?\d*/);
    return m ? parseFloat(m[0].replace(/,/g, '')) : NaN;
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  /**
   * @param {object} est saved estimate doc (classic or V2 shape)
   * @returns {Array<{code:string,desc:string,qty:string,rate:string,total:number}>}
   */
  function buildDisplayRows(est) {
    if (!est) return [];
    // Per-SQ: rows are internal cost lines; the tier price is the only
    // customer number. Same detection as InvoicePipeline.createInvoiceFromEstimate.
    if (est.priceMode === 'per-sq' || est.prices != null) return [];

    const markup = Number(est.materialMarkupPct);
    const hasV2Pricing = Number.isFinite(markup);

    const rows = (est.rows || []).map(function (row) {
      const explicitRetail = (row.retailTotal != null && Number.isFinite(Number(row.retailTotal)))
        ? Number(row.retailTotal) : null;
      const hasSplit = hasV2Pricing && (row.materialTotal != null || row.laborTotal != null);
      let total;
      if (explicitRetail != null) {
        total = explicitRetail;
      } else if (hasSplit) {
        const mat = Number(row.materialTotal) || 0;
        const lab = Number(row.laborTotal) || 0;
        total = (mat === 0 && lab === 0) ? numFrom(row.total) : mat * (1 + markup) + lab;
      } else {
        total = numFrom(row.total);
      }
      total = Number.isFinite(total) ? round2(total) : 0;

      let rate;
      if (explicitRetail != null || hasSplit) {
        // Retail-priced row: derive the unit rate from the retail total — the
        // saved rate string on pre-sweep docs is the COST rate, never print it.
        const qty = numFrom(row.qty);
        const unit = (Number.isFinite(qty) && qty !== 0) ? total / qty : total;
        rate = '$' + round2(unit).toFixed(2);
      } else {
        rate = row.rate == null ? '' : String(row.rate);
      }

      return {
        code: row.code == null ? '' : String(row.code),
        desc: String(row.desc || row.description || ''),
        qty: row.qty == null ? '' : String(row.qty),
        rate: rate,
        total: total
      };
    });

    const ohp = (Number(est.overhead) || 0) + (Number(est.profit) || 0);
    if (hasV2Pricing && ohp > 0 && rows.length) {
      const pct = Math.round(((Number(est.overheadPct) || 0) + (Number(est.profitPct) || 0)) * 100);
      rows.push({
        code: 'O&P',
        desc: 'Overhead & Profit' + (pct ? ' (' + pct + '%)' : ''),
        qty: '',
        rate: '',
        total: round2(ohp)
      });
    }
    return rows;
  }

  /**
   * Doc-generator line items for a saved estimate, in EITHER shape.
   *
   * WHY THIS EXISTS. The document generator and its pre-flight read
   * `est.lineItems`. V2 — the builder every estimate goes through now — writes
   * `est.rows` and the string `lineItems` does not appear in estimate-v2-ui.js
   * even once. So the scope came back empty for every V2 estimate, and two
   * things followed:
   *   1. `lineItems` is required:true on proposal, contract, supplement_request
   *      and invoice, so every one of those documents started with an empty
   *      REQUIRED field and had to be typed by hand.
   *   2. The same empty array reached resolveDocManufacturer, which finds no
   *      shingle line and falls back to its hardcoded default — so warranty
   *      certificates and proposals claimed "GAF Timberline" on TAMKO jobs.
   *
   * It lives HERE, next to buildDisplayRows and its test, because the answer
   * is the retail ladder — and a fourth private copy of that math is exactly
   * what leaked the cost basis to homeowners in the first place.
   *
   * Three shapes in, one shape out:
   *   - classic `lineItems`  → mapped straight across
   *   - per-SQ V2            → ONE summary line at the locked tier total,
   *                            mirroring InvoicePipeline.createInvoiceFromEstimate.
   *                            buildDisplayRows deliberately returns [] here
   *                            (the rows are internal cost lines that cannot
   *                            foot to the tier price) — but a CONTRACT with no
   *                            scope is the bug being fixed, so summarise
   *                            rather than emit nothing.
   *   - row-based V2/classic → buildDisplayRows, i.e. the retail ladder + O&P
   *
   * Emits both naming conventions on purpose: `description`/`qty`/`rate` for
   * the doc templates, and `code`/`name` for resolveDocManufacturer, which
   * inspects `li.code || li.name` and would otherwise never see the shingle.
   */
  function buildDocLineItems(est) {
    if (!est) return [];

    function shape(o) {
      const qty = Number.isFinite(o.qty) ? o.qty : 1;
      const total = round2(Number(o.total) || 0);
      const rate = Number.isFinite(o.rate) ? round2(o.rate) : (qty ? round2(total / qty) : total);
      return {
        code: o.code || '',
        name: o.desc || '',
        description: o.desc || 'Line item',
        qty: qty,
        quantity: qty,
        unit: o.unit || 'ea',
        rate: rate,
        unitPrice: rate,
        total: total,
        amount: total,
      };
    }

    // Classic estimates already carry the customer-facing ladder.
    if (Array.isArray(est.lineItems) && est.lineItems.length) {
      return est.lineItems.map(function (it) {
        const qty = numFrom(it.quantity != null ? it.quantity : it.qty);
        const amt = numFrom(it.amount != null ? it.amount : it.total);
        const rate = numFrom(it.unitPrice != null ? it.unitPrice : it.rate);
        const q = Number.isFinite(qty) && qty !== 0 ? qty : 1;
        const t = Number.isFinite(amt) ? amt : (Number.isFinite(rate) ? rate * q : 0);
        return shape({
          code: it.code, desc: it.description || it.name, unit: it.unit,
          qty: q, rate: Number.isFinite(rate) ? rate : null, total: t,
        });
      });
    }

    // Per-SQ: the customer price is the locked selected-tier total.
    const isPerSq = (est.priceMode === 'per-sq') || (est.prices != null);
    if (isPerSq) {
      const grand = estimateValue(est);
      if (!grand) return [];
      const tier = String(est.selectedTier || est.tier || '').replace(/^./, function (c) { return c.toUpperCase(); });
      return [shape({
        code: '', desc: 'Roofing system' + (tier ? ' — ' + tier + ' tier' : ''),
        unit: 'ea', qty: 1, rate: grand, total: grand,
      })];
    }

    return buildDisplayRows(est).map(function (r) {
      const qty = numFrom(r.qty);
      // qty arrives as a display string ('20.00 SQ') — split the unit back off.
      const unit = String(r.qty == null ? '' : r.qty).replace(/^[\s\d.,-]+/, '').trim();
      const q = Number.isFinite(qty) && qty !== 0 ? qty : 1;
      return shape({
        code: r.code, desc: r.desc, unit: unit || 'ea',
        qty: q, rate: numFrom(r.rate), total: r.total,
      });
    });
  }

  // ── Two-shape estimate readers ──────────────────────────────────────
  // Estimates exist in TWO shapes and every reader used to invent its own
  // guess at which key holds the money and the label:
  //   V2      → name  / grandTotal / rows
  //   Classic → title / amount|total / lineItems
  // That drift is not cosmetic. setPrimaryEstimate read `grandTotal` ONLY, so
  // making a visible $14,500 Classic estimate primary wrote `jobValue: 0` over
  // the lead and blanked the header, the profit panel and every pipeline
  // number. These two helpers are the single source of truth — any surface
  // that needs "what is this estimate worth / what is it called" calls them.
  //
  // Order matters: grandTotal first (V2's authoritative total), then total,
  // then amount (Classic's two spellings). Falsy-but-present 0 is preserved via
  // the != null checks — a genuine $0 draft must not fall through to a stale key.
  function estimateValue(est) {
    if (!est) return 0;
    const v = est.grandTotal != null ? est.grandTotal
      : est.total != null ? est.total
      : est.amount != null ? est.amount : 0;
    const n = numFrom(v);
    return isFinite(n) ? n : 0;
  }

  function estimateName(est) {
    if (!est) return 'Estimate';
    return est.title || est.name || est.addr || 'Estimate';
  }

  const _api = {
    buildDocLineItems: buildDocLineItems,
    buildDisplayRows: buildDisplayRows,
    numFrom: numFrom,
    estimateValue: estimateValue,
    estimateName: estimateName,
  };
  if (typeof window !== 'undefined') {
    window.NBDCustomerEstimateRows = _api;
  }
  // Node (unit tests) require() this file; expose the same API via CommonJS.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = _api;
  }
})();
