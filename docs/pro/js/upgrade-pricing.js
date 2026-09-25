/**
 * upgrade-pricing.js — window.NBDUpgrades: the pricing core for Upgrades &
 * Add-ons. PURE functions over window.NBD_UPGRADE_LIBRARY (upgrade-library.js,
 * which must load first). Integer cents throughout, no DOM, no Firestore.
 *
 * WHY THIS EXISTS (2026-09-25). See documentation/projects/
 * UPGRADES-ADDONS-DESIGN-2026-09-25.md. Two findings shape every rule here:
 *
 *  1. Upgrades print as FACE-VALUE retail rows added AFTER the engine, the
 *     way V2's pass-through fees already do (estimate-v2-ui.js, the passThru
 *     loop). Routing an upgrade through EstimateLogic would run it through
 *     material markup, O&P and the nearest-$25 rounding, and the customer
 *     paper — which prints lines before O&P plus one O&P row — would then
 *     show a different number than the rep quoted. So price() emits rows in
 *     the saved-estimate rows[] shape with an explicit retailTotal, which is
 *     the first rung of the retail ladder in all three readers
 *     (NBDCustomerEstimateRows.buildDisplayRows / buildDocLineItems and
 *     InvoicePipeline.buildRowItems). The card price, the printed line and
 *     the change in the total are the same integer.
 *
 *  2. Silent pre-ticks were the bug (seedChoices includes every `optional`
 *     line). offeredFor() therefore returns every offer with picked:false and
 *     recommended:false; nothing is ever chosen for the rep or the homeowner.
 *
 * Refusals are errors, never silent fixes: a needs_price item, an ineligible
 * or hidden item, two picks from one pick-one group, an emitter with no drain,
 * a missing quantity, an insurance claim, a per-SQ quote (its customer paper
 * prints no lines yet) — each returns an error and prices nothing for that
 * pick, so a caller cannot save a quote the homeowner would read wrongly.
 *
 * API (window.NBDUpgrades):
 *   offeredFor(templateIds, ctx, tenantOverrides) → offer[]
 *   price(picks, ctx, tenantOverrides)            → { rows, upgradeCents,
 *                                                     taxCents, totalCents,
 *                                                     taxRate, priced, errors }
 *   totalsWithUpgrades(base, priced)              → new estimate totals, cents
 *   applyToEstimate(payload, priced, opts)        → NEW payload, rows appended
 *   sanitizeOverrides(raw)                        → { prices, disabled, ignored }
 *   installerLine(offerOrItem, tenant)            → homeowner installer sentence
 *
 * An offer's `qty` is what price() bills when the rep types nothing, so it
 * is only ever a figure the scope itself is priced on. `suggestedQty` is a
 * starting figure to SHOW (a cleaning template's default eaveLf); an offer
 * carrying only a suggestion has needsQuantity:true and price() refuses it.
 *
 * ctx (all optional except where noted):
 *   templateIds       price() only: the selected Job Template ids
 *   lines             the estimate's lines: resolved engine lines
 *                     ({code, name, quantity}) or template items ({code, qty})
 *   measurements      {eaveLf, guttersLf, ...} from resolveSelection(); eaveLf
 *                     is only ever a suggestedQty, never billed. guttersLf (a
 *                     drawn or measured gutter footage) prices a guard when no
 *                     whole-house run line does
 *   gutterLf          rep-measured whole-house gutter footage (wins over lines)
 *   downspoutLf, downspoutCount
 *   quantities        {upgradeId: qty} rep-typed quantities
 *   gutter            {profile:'k5'|'k6'|'half_round'|'box',
 *                      material:'aluminum'|'steel'|'copper'} for EXISTING
 *                     gutters when the scope has no gutter-run line
 *   newGutters        boolean override for the Alu-Rex variant
 *   mode              'cash' | 'insurance'  (insurance refuses everything)
 *   priceMode         'line-item' | 'per-sq' (per-sq refuses everything)
 *   taxRate           price() only: the estimate's saved decimal tax rate
 *   tenant            {certifiedInstallerName}
 *
 * tenantOverrides: { <upgradeId>: <retail cents> } or
 *                  { <upgradeId>: { enabled: false } } — sanitized the way
 *                  EstimateBuilderV2.applyCompanyPricing sanitizes shop
 *                  prices (see sanitizeOverrides for the one deliberate
 *                  difference).
 */
(function (root) {
  'use strict';

  function lib() {
    var L = root && root.NBD_UPGRADE_LIBRARY;
    if (!L || !Array.isArray(L.items)) {
      throw new Error('[NBDUpgrades] upgrade-library.js must load before upgrade-pricing.js');
    }
    return L;
  }

  function hasOwn(o, k) { return o != null && Object.prototype.hasOwnProperty.call(o, k); }

  function num(v) {
    if (v === '' || v == null || typeof v === 'boolean') return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function toIdList(ids) {
    if (ids == null) return [];
    var arr = Array.isArray(ids) ? ids : [ids];
    return arr.map(function (x) { return (x && typeof x === 'object') ? x.templateId : x; })
      .filter(function (x) { return typeof x === 'string' && x; });
  }

  function itemById(L, id) {
    for (var i = 0; i < L.items.length; i++) if (L.items[i].id === id) return L.items[i];
    return null;
  }

  // A family's `offers`/`hide` entries may name a GROUP; expand to its items.
  function expand(L, key) {
    if (hasOwn(L.groups, key)) {
      return L.items.filter(function (it) { return it.group === key; }).map(function (it) { return it.id; });
    }
    return itemById(L, key) ? [key] : [];
  }

  // ── Tenant overrides ──────────────────────────────────────────────────
  // Same rule as applyCompanyPricing's sane() in estimate-builder-v2.js: a
  // blank / null / NaN field is DROPPED so the default stands — a garbage
  // Settings field must never silently zero or corrupt a price. The one
  // deliberate difference: applyCompanyPricing honors a literal 0 (a shop
  // making an add-on free); an upgrade at $0 would print as a free item on a
  // homeowner's paper, which the design forbids, so 0 is dropped too. Hide an
  // upgrade with { enabled: false } instead.
  //
  // Values are CENTS and must be whole; a fractional value is dropped, not
  // rounded. This CANNOT tell 18 cents from $18 — both are whole numbers —
  // so the stage-2 Settings screen must take dollars from the rep and
  // convert them to cents itself; never pass a typed field straight in.
  //
  // MAX_UNIT_CENTS (review of #1756): there was no ceiling, so a key-stuck
  // 180000000 was accepted and quoted a 137 LF guard at $246,600,000. No
  // gutter upgrade is near $1,000 per foot or per piece; a figure past that
  // is a typo and is dropped like any other garbage (the library price, or
  // needs_price, stands). Raise it deliberately when a trade with bigger
  // per-piece items joins the library.
  var MAX_UNIT_CENTS = 100000;

  function sanitizeOverrides(raw) {
    var L = lib();
    var out = { prices: {}, disabled: {}, ignored: [] };
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (k) {
      if (!itemById(L, k)) { out.ignored.push(k); return; }
      var v = raw[k];
      if (v && typeof v === 'object') {
        if (v.enabled === false) out.disabled[k] = true;
        else out.ignored.push(k);
        return;
      }
      var n = num(v);
      if (n == null || !Number.isInteger(n) || n <= 0 || n > MAX_UNIT_CENTS) { out.ignored.push(k); return; }
      out.prices[k] = n;
    });
    return out;
  }

  // ── Scope scan ────────────────────────────────────────────────────────
  var RUN_RE = /^GTR (5K|6K|HR|BOX)-(AL|ST|CU)$/;
  var PROFILE = { '5K': 'k5', '6K': 'k6', HR: 'half_round', BOX: 'box' };
  var MATERIAL = { AL: 'aluminum', ST: 'steel', CU: 'copper' };

  function lineCode(l) { return String((l && l.code) || '').trim().toUpperCase(); }
  function lineName(l) {
    if (!l) return '';
    return String(l.name || l.desc || (l.custom && l.custom.name) || '').toLowerCase();
  }
  function lineQty(l) {
    if (!l) return 0;
    var q = num(l.quantity);
    if (q == null) q = num(l.qty);
    if (q == null && l.custom) q = num(l.custom.qty);
    return q != null && q > 0 ? q : 0;
  }

  function scanLines(ctx) {
    var lines = Array.isArray(ctx.lines) ? ctx.lines : [];
    var s = { runs: [], runLf: 0, dsp23Lf: 0, dsp34Lf: 0, codes: {}, names: [] };
    lines.forEach(function (l) {
      // An upgrade row is not BASE scope. Without this skip, a payload that
      // already carries "Upgrade — … gutter guard" would read as a guard in
      // the base and hide the whole leaf group on the next offer.
      if (!l || l.upgrade === true || /^UPG /.test(lineCode(l))) return;
      var code = lineCode(l);
      if (code) s.codes[code] = true;
      var nm = lineName(l);
      if (nm) s.names.push(nm);
      var m = RUN_RE.exec(code);
      if (m) {
        var q = lineQty(l);
        s.runs.push({ profile: PROFILE[m[1]], material: MATERIAL[m[2]], qty: q });
        s.runLf += q;
      } else if (code === 'GTR DSP23-AL') {
        s.dsp23Lf += lineQty(l);
      } else if (code === 'GTR DSP34-AL' || code === 'GTR DSP34-ST' || code === 'GTR DSP-CU') {
        s.dsp34Lf += lineQty(l);
      }
    });
    return s;
  }

  function inScope(item, scan) {
    var sc = item.inScope || {};
    var codes = sc.codes || [];
    for (var i = 0; i < codes.length; i++) if (scan.codes[codes[i]]) return true;
    var names = sc.names || [];
    for (var j = 0; j < names.length; j++) {
      for (var k = 0; k < scan.names.length; k++) {
        if (scan.names[k].indexOf(names[j]) !== -1) return true;
      }
    }
    return false;
  }

  // ── Eligibility ───────────────────────────────────────────────────────
  // Returns { ok, reason, check }. `check` is a rep prompt when the scope
  // cannot prove eligibility (existing gutters with no run line, and a
  // ctx.gutter missing its profile or material): the offer stays available,
  // and the rep is told what to confirm on the house before quoting.
  //
  // A null profile or material is UNKNOWN, not wrong, so it is never judged
  // (2026-09-25: judging it printed "this job has non-aluminum gutters" for
  // a rep who had only picked 5" K-style). Values are case-insensitive.
  function gutterFailure(profile, material) {
    if (material === 'copper') {
      return 'Copper gutters: an aluminum guard must not touch copper (LeafBlaster voids its warranty on copper contact).';
    }
    if (profile != null && profile !== 'k5' && profile !== 'k6') {
      return 'The guards are listed for 5" or 6" K-style gutters; this job has ' +
        (profile === 'half_round' ? 'half-round' : profile === 'box' ? 'box' : 'other') + ' gutters.';
    }
    if (material != null && material !== 'aluminum') {
      return 'The guards are listed for aluminum gutters; this job has ' +
        (material === 'steel' ? 'galvanized steel' : 'non-aluminum') + ' gutters.';
    }
    return null;
  }

  function gutterField(v) {
    var s = (v == null) ? '' : String(v).trim().toLowerCase();
    return s || null;
  }

  var CONFIRM_GUTTER = 'Confirm the gutters are 5" or 6" aluminum K-style before quoting a guard.';

  function eligibility(item, ctx, scan) {
    if (item.eligibility === 'kstyle_aluminum') {
      if (scan.runs.length) {
        // Copper anywhere in the runs wins the reason: it is the one that
        // voids a warranty, not just a fit problem.
        var copper = scan.runs.filter(function (r) { return r.material === 'copper'; })[0];
        var bad = copper || scan.runs.filter(function (r) { return gutterFailure(r.profile, r.material); })[0];
        return bad ? { ok: false, reason: gutterFailure(bad.profile, bad.material) } : { ok: true };
      }
      var g = ctx.gutter || {};
      var prof = gutterField(g.profile);
      var mat = gutterField(g.material);
      var why = gutterFailure(prof, mat);
      if (why) return { ok: false, reason: why };
      // Both known and fine: confirmed. Either one missing: still offered,
      // with the prompt to check the house.
      return (prof && mat) ? { ok: true } : { ok: true, check: CONFIRM_GUTTER };
    }
    if (item.eligibility === 'has_2x3_downspouts') {
      if (scan.dsp23Lf > 0) return { ok: true };
      if (scan.dsp34Lf > 0) return { ok: false, reason: 'The downspouts in this scope are already 3x4.' };
      return { ok: false, reason: 'There are no 2x3 downspouts in this scope to step up.' };
    }
    return { ok: true };
  }

  // ── Quantity ──────────────────────────────────────────────────────────
  // Returns { qty, source, suggested } with qty null when nothing
  // trustworthy exists. Never a guess: an unknown quantity is
  // `needsQuantity`, and price() refuses it until the rep types one.
  //
  // footage.runOk: every selected family vouches that its gutter-run lines
  // are the gutter the guard sits on (a repair's run line is the repaired
  // section, not the house). footage.eaveSuggest: every selected family
  // says its template eaveLf describes the whole house — it then comes back
  // as `suggested`, never as qty (review of #1756: a cleaning template's
  // 160 LF is its coverage cap, and it was being billed unseen).
  function derivedQuantity(item, ctx, scan, footage) {
    var explicit = ctx.quantities && hasOwn(ctx.quantities, item.id) ? num(ctx.quantities[item.id]) : null;
    if (explicit != null) return { qty: explicit, source: 'rep', suggested: null };
    switch (item.qtySource) {
      case 'gutter_lf': {
        var g = num(ctx.gutterLf);
        if (g != null && g > 0) return { qty: g, source: 'gutterLf', suggested: null };
        if (footage.runOk && scan.runLf > 0) return { qty: scan.runLf, source: 'gutter_lines', suggested: null };
        // The job's drawn or measured gutter footage (Jo, 2026-09-25: guards
        // follow the drawn gutter feet). It comes after the run lines on
        // purpose: when the scope already bills a whole-house gutter run, the
        // guard follows that billed figure, and EstimateLogic sizes a
        // formula-driven run from this same guttersLf (GUTTER_LF), so the two
        // agree. It is a measurement of this house, not a template default:
        // no Job Template ships a guttersLf. So it prices, where eaveLf only
        // suggests.
        var drawn = ctx.measurements ? num(ctx.measurements.guttersLf) : null;
        if (drawn != null && drawn > 0) return { qty: drawn, source: 'guttersLf', suggested: null };
        var eave = ctx.measurements ? num(ctx.measurements.eaveLf) : null;
        var hint = (footage.eaveSuggest && eave != null && eave > 0) ? eave : null;
        return { qty: null, source: 'rep_entered', suggested: hint };
      }
      case 'downspout_2x3_lf': {
        var d = num(ctx.downspoutLf);
        if (d != null && d > 0) return { qty: d, source: 'downspoutLf' };
        if (scan.dsp23Lf > 0) return { qty: scan.dsp23Lf, source: 'downspout_lines' };
        return { qty: null, source: 'rep_entered' };
      }
      case 'downspout_count': {
        var c = num(ctx.downspoutCount);
        if (c != null && c > 0) return { qty: c, source: 'downspoutCount' };
        return { qty: null, source: 'rep_entered' };
      }
      default:
        return { qty: null, source: 'rep_entered' };
    }
  }

  // Whole units only, so qty × unit cents is always an exact integer. Feet
  // round UP to the next whole foot (137.2 ft of gutter is 138 ft of guard);
  // counted items must already be whole — 2.5 emitters is a typo, not a
  // quantity to round.
  function normalizeQty(qty, unit) {
    var q = num(qty);
    if (q == null || q <= 0) return { error: 'needs a quantity greater than zero' };
    if (unit === 'LF') return { qty: Math.max(1, Math.ceil(q - 1e-9)) };
    if (!Number.isInteger(q)) return { error: 'must be a whole number of ' + unit };
    return { qty: q };
  }

  // ── Copy ──────────────────────────────────────────────────────────────
  function cleanName(s) {
    // eslint-disable-next-line no-control-regex
    return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function installerLine(itemOrOffer, tenant) {
    var kind = itemOrOffer && (itemOrOffer.installerKind || itemOrOffer.installer);
    if (kind !== 'certified_sub') return null;
    var cert = (itemOrOffer.certification || '').trim();
    var name = cleanName(tenant && tenant.certifiedInstallerName);
    if (!name) return 'Installed by an independent certified installer.';
    return 'Installed by ' + name + ', an independent ' + (cert ? cert + '-certified' : 'certified') + ' installer.';
  }

  function variantOf(item, newGutters) {
    var v = item.variants && item.variants[newGutters ? 'new' : 'existing'];
    return {
      name: (v && v.name) || item.name,
      benefit: (v && v.benefit) || item.benefit,
      warrantyLine: v && hasOwn(v, 'warrantyLine') ? v.warrantyLine : item.warrantyLine,
      notCovered: v && hasOwn(v, 'notCovered') ? v.notCovered : item.notCovered
    };
  }

  // ── offeredFor ────────────────────────────────────────────────────────
  function contextBlock(ctx) {
    // Upgrades stay out of claims entirely (a separate signed homeowner
    // addendum is build step 5), and nothing on a claim job may be free or
    // discounted (KY KRS 367.628). A saved payload says insurance two ways;
    // honor both.
    if (ctx.mode === 'insurance' || ctx.insurance === true) {
      return 'Upgrades are never added inside an insurance claim; they need a separate signed homeowner addendum.';
    }
    if (ctx.priceMode === 'per-sq') {
      return 'Per-square estimates do not print line items yet, so an upgrade line would not reach the homeowner\'s paper.';
    }
    return null;
  }

  function offeredFor(templateIds, ctx, tenantOverrides) {
    var L = lib();
    ctx = ctx || {};
    var fams = toIdList(templateIds)
      .map(function (id) { return hasOwn(L.templates, id) ? L.families[L.templates[id]] : null; })
      .filter(Boolean);
    if (!fams.length) return [];

    var ov = sanitizeOverrides(tenantOverrides);
    var scan = scanLines(ctx);
    var newGutters = (typeof ctx.newGutters === 'boolean')
      ? ctx.newGutters
      : fams.some(function (f) { return f.newGutters; });
    // Every selected family must vouch: the merged measurements come from
    // the LAST template selected, and run lines add up across templates, so
    // one partial-run repair in the mix makes either figure the repaired
    // run, not the house.
    var footage = {
      runOk: fams.every(function (f) { return f.runLinesAreWholeHouse === true; }),
      eaveSuggest: fams.every(function (f) { return f.suggestEaveLf === true; })
    };

    var offered = {};
    var hidden = {};
    fams.forEach(function (f) {
      (f.offers || []).forEach(function (k) { expand(L, k).forEach(function (id) { offered[id] = true; }); });
      Object.keys(f.hide || {}).forEach(function (k) {
        expand(L, k).forEach(function (id) { if (!hidden[id]) hidden[id] = f.hide[k]; });
      });
    });

    var block = contextBlock(ctx);
    var groupInScope = {};
    L.items.forEach(function (it) { if (it.group && inScope(it, scan)) groupInScope[it.group] = true; });

    return L.items.filter(function (it) { return offered[it.id] || hidden[it.id]; }).map(function (it) {
      var v = variantOf(it, newGutters);
      var tenantPrice = hasOwn(ov.prices, it.id) ? ov.prices[it.id] : null;
      var libPrice = (it.priceStatus === 'approved' && Number.isInteger(it.retailCents) && it.retailCents > 0)
        ? it.retailCents : null;
      var unitCents = tenantPrice != null ? tenantPrice : libPrice;
      var offer = {
        id: it.id,
        code: it.code,
        group: it.group || null,
        groupLabel: it.group && L.groups[it.group] ? L.groups[it.group].label : null,
        name: v.name,
        benefit: v.benefit,
        unit: it.unit,
        unitCents: unitCents,
        priceSource: tenantPrice != null ? 'tenant' : (libPrice != null ? 'library' : null),
        state: 'available',
        reason: null,
        check: null,
        qty: null,
        qtySource: null,
        suggestedQty: null,
        needsQuantity: false,
        requires: (it.requires || []).slice(),
        warrantyLine: v.warrantyLine || null,
        notCovered: v.notCovered || null,
        installerKind: it.installer,
        certification: it.certification || null,
        installerLine: installerLine(it, ctx.tenant),
        picked: false,
        recommended: false
      };

      var hideWhy = block
        || (ov.disabled[it.id] ? 'Turned off in this company\'s upgrade settings.' : null)
        || hidden[it.id]
        || (inScope(it, scan) || (it.group && groupInScope[it.group])
          ? (it.group
            ? 'This estimate\'s base scope already has ' + (L.groups[it.group].label || 'this').toLowerCase() + '.'
            : 'Already in this estimate\'s base scope.')
          : null);
      if (hideWhy) {
        offer.state = 'hidden';
        offer.reason = hideWhy;
        return offer;
      }

      var el = eligibility(it, ctx, scan);
      if (!el.ok) {
        offer.state = 'ineligible';
        offer.reason = el.reason;
        return offer;
      }
      offer.check = el.check || null;

      var q = derivedQuantity(it, ctx, scan, footage);
      if (q.qty != null) {
        var nq = normalizeQty(q.qty, it.unit);
        offer.qty = nq.error ? null : nq.qty;
      }
      if (offer.qty == null && q.suggested != null) {
        var ns = normalizeQty(q.suggested, it.unit);
        offer.suggestedQty = ns.error ? null : ns.qty;
      }
      offer.qtySource = q.source;
      offer.needsQuantity = offer.qty == null;

      if (unitCents == null) {
        offer.state = 'needs_price';
        offer.reason = 'No saved price yet. Set one in upgrade prices before offering it.';
      }
      return offer;
    });
  }

  // ── price ─────────────────────────────────────────────────────────────
  function err(list, id, code, message) { list.push({ id: id || null, code: code, message: message }); }

  // Integer tax: the rate is scaled to millionths first so 0.0725 × cents is
  // integer math, then rounded half-up once for the whole upgrade subtotal.
  function taxOn(cents, rate) {
    var micro = Math.round(rate * 1e6);
    return Math.floor((cents * micro + 500000) / 1e6);
  }

  function dollars(cents) { return cents / 100; }

  function price(picks, ctx, tenantOverrides) {
    var L = lib();
    ctx = ctx || {};
    var out = { rows: [], upgradeCents: 0, taxCents: 0, totalCents: 0, taxRate: null, priced: [], errors: [] };

    var list = (Array.isArray(picks) ? picks : (picks == null ? [] : [picks])).map(function (p) {
      return (p && typeof p === 'object') ? { id: p.id, qty: p.qty } : { id: p, qty: undefined };
    });
    if (!list.length) return out;

    var block = contextBlock(ctx);
    if (block) {
      err(out.errors, null, ctx.priceMode === 'per-sq' && ctx.mode !== 'insurance' && ctx.insurance !== true
        ? 'per_sq' : 'insurance', block);
      return out;
    }
    if (!toIdList(ctx.templateIds).length) {
      err(out.errors, null, 'no_templates', 'ctx.templateIds is required: offers depend on the selected templates.');
      return out;
    }

    var offers = {};
    offeredFor(ctx.templateIds, ctx, tenantOverrides).forEach(function (o) { offers[o.id] = o; });

    // Duplicates refuse every copy: silently keeping one hides the UI bug
    // that sent two, and silently summing them bills a guard twice.
    var seen = {};
    list.forEach(function (p) { seen[p.id] = (seen[p.id] || 0) + 1; });
    // Group membership counts DISTINCT ids, duplicated ones included. It
    // once counted only ids picked exactly once, so Alu-Rex twice plus
    // Amerimax refused Alu-Rex as a duplicate and quietly sold Amerimax —
    // the silent winner the pick-one rule exists to stop (review of #1756).
    var byGroup = {};
    var counted = {};
    list.forEach(function (p) {
      var it = itemById(L, p.id);
      if (!it || !it.group || hasOwn(counted, it.id)) return;
      counted[it.id] = true;
      (byGroup[it.group] = byGroup[it.group] || []).push(it.id);
    });

    var valid = {};
    var dupReported = {};
    list.forEach(function (p) {
      var id = p.id;
      var it = itemById(L, id);
      if (!it) { err(out.errors, id, 'unknown', 'Unknown upgrade "' + String(id) + '".'); return; }
      if (seen[id] > 1) {
        if (!dupReported[id]) err(out.errors, id, 'duplicate', it.name + ' was picked more than once.');
        dupReported[id] = true;
        return;
      }
      if (it.group && byGroup[it.group] && byGroup[it.group].length > 1) {
        err(out.errors, id, 'group', 'Pick one ' + L.groups[it.group].label.toLowerCase() + ' option, not ' + byGroup[it.group].length + '.');
        return;
      }
      var o = offers[id];
      if (!o) { err(out.errors, id, 'not_offered', it.name + ' is not offered on the selected templates.'); return; }
      if (o.state === 'hidden') { err(out.errors, id, 'hidden', o.name + ': ' + o.reason); return; }
      if (o.state === 'ineligible') { err(out.errors, id, 'ineligible', o.name + ': ' + o.reason); return; }
      if (o.state === 'needs_price' || o.unitCents == null) {
        err(out.errors, id, 'needs_price', o.name + ' has no saved price, so it cannot be quoted.');
        return;
      }
      var raw = (p.qty !== undefined && p.qty !== null && p.qty !== '') ? p.qty : o.qty;
      if (raw == null) {
        // A suggestion is named so the rep knows where the figure came
        // from, and is still refused: it is a template default, not a
        // measurement of this house.
        err(out.errors, id, 'quantity', o.name + ' needs a measured quantity' + (o.suggestedQty != null
          ? ' (the template default of ' + o.suggestedQty + ' ' + o.unit + ' is not a measurement of this house)'
          : '') + '.');
        return;
      }
      var nq = normalizeQty(raw, o.unit);
      if (nq.error) { err(out.errors, id, 'quantity', o.name + ' ' + nq.error + '.'); return; }
      // Exact integer cents or nothing: past 2^53 a product stops being
      // exact, and a silent wrap is the one failure a quote cannot have.
      if (!Number.isSafeInteger(nq.qty * o.unitCents)) {
        err(out.errors, id, 'quantity', o.name + ' quantity is too large to quote.');
        return;
      }
      valid[id] = { offer: o, qty: nq.qty };
    });

    // Requirements, after every pick has been judged on its own: an emitter
    // needs a drain that is either picked-and-valid or already in the base.
    var scan = scanLines(ctx);
    Object.keys(valid).forEach(function (id) {
      var o = valid[id].offer;
      (o.requires || []).forEach(function (req) {
        var reqItem = itemById(L, req);
        if (valid[req] || (reqItem && inScope(reqItem, scan))) return;
        err(out.errors, id, 'requires', o.name + ' needs ' + (reqItem ? reqItem.name.toLowerCase() : req) + ' on the same estimate.');
        delete valid[id];
      });
    });

    // Rows in LIBRARY order, not pick order, so the same picks always print
    // the same paper.
    L.items.forEach(function (it) {
      var v = valid[it.id];
      if (!v) return;
      var o = v.offer;
      var cents = v.qty * o.unitCents;
      out.upgradeCents += cents;
      out.priced.push({ id: o.id, qty: v.qty, unit: o.unit, unitCents: o.unitCents, retailCents: cents, priceSource: o.priceSource });
      out.rows.push({
        // ── the saved-estimate rows[] contract (job-templates.js
        //    buildEstimatePayload / estimate-v2-ui.js _buildSavePayload) ──
        code: o.code,
        desc: 'Upgrade — ' + o.name,
        qty: v.qty.toFixed(2) + o.unit,
        rate: '$' + dollars(o.unitCents).toFixed(2),
        total: dollars(cents),
        retailTotal: dollars(cents),
        quantity: v.qty,
        unit: o.unit,
        category: 'Upgrades',
        // No cost basis. Null (not 0) is the pass-through precedent: readers
        // take the explicit retailTotal rung, and V2's reopen reconstructs
        // lineTotal from `total` at face value.
        materialTotal: null,
        laborTotal: null,
        materialCostPerUnit: null,
        laborCostPerUnit: null,
        unitPrice: dollars(o.unitCents),
        qtyOverride: null,
        // ── upgrade tag. Readers ignore unknown keys; these let stage 2
        //    find, re-price and re-print an upgrade without parsing desc. ──
        upgrade: true,
        upgradeId: o.id,
        upgradeGroup: o.group,
        upgradeVersion: L.version,
        upgradeCents: cents,
        upgradeWarranty: o.warrantyLine,
        upgradeNotCovered: o.notCovered,
        upgradeInstaller: o.installerLine
      });
    });

    if (out.rows.length) {
      var rate = num(ctx.taxRate);
      if (rate == null || rate < 0 || rate >= 1) {
        err(out.errors, null, 'tax_rate', 'No valid tax rate: pass the estimate\'s saved decimal taxRate (0 is allowed).');
      } else {
        out.taxCents = taxOn(out.upgradeCents, rate);
        // Recorded so applyToEstimate can refuse a payload taxed at a
        // different rate than this quote.
        out.taxRate = rate;
      }
    }
    out.totalCents = out.upgradeCents + out.taxCents;
    if (!Number.isSafeInteger(out.totalCents)) {
      err(out.errors, null, 'quantity', 'This upgrade quote is too large to total exactly.');
    }
    return out;
  }

  // ── Totals ────────────────────────────────────────────────────────────
  /**
   * totalsWithUpgrades(base, priced)
   *   base:   the estimate's ENGINE totals, dollars:
   *           { subtotal, tax, grandTotal|total, minJobApplied, minJobCharge, roundTo }
   *   priced: a price() result with no errors
   * → { subtotalCents, taxCents, grandTotalCents, minJobApplied,
   *     subtotal, tax, grandTotal }
   *
   * Upgrades add at face AFTER the engine's nearest-$25 rounding. The one
   * exception is the job minimum: when the base scope was floored (a $200
   * cleaning billed at a $350 minimum), stacking a $2,880 guard on the
   * FLOORED figure would bill the $150 floor gap on a job that is no longer
   * small. So a floored base is unwound to the engine's own pre-floor total
   * (subtotal + tax, rounded exactly as resolveEstimate rounds it) and the
   * floor is re-applied to the whole job.
   */
  function totalsWithUpgrades(base, priced) {
    if (!priced || (priced.errors && priced.errors.length)) {
      throw new Error('[NBDUpgrades] refusing to total an upgrade quote that has errors');
    }
    base = base || {};
    var sub = num(base.subtotal) || 0;
    var tax = num(base.tax != null ? base.tax : base.taxAmount) || 0;
    var grand = num(base.grandTotal != null ? base.grandTotal : base.total);
    if (grand == null) throw new Error('[NBDUpgrades] base grandTotal is required');
    // Exact, non-negative integer cents or a throw. This read `| 0`, which
    // wraps silently past 2^31 cents ($21.4M): a huge quote became a
    // NEGATIVE subtotal on the saved estimate (review of #1756).
    var upg = priced.upgradeCents;
    var upgTax = priced.taxCents;
    if (!Number.isSafeInteger(upg) || upg < 0 || !Number.isSafeInteger(upgTax) || upgTax < 0) {
      throw new Error('[NBDUpgrades] upgradeCents and taxCents must be non-negative safe integers');
    }
    var subtotalCents = Math.round(sub * 100) + upg;
    var taxCents = Math.round(tax * 100) + upgTax;
    var grandCents;
    var minApplied = false;
    if (base.minJobApplied) {
      var minCharge = num(base.minJobCharge);
      if (minCharge == null) {
        throw new Error('[NBDUpgrades] base.minJobCharge is required when the job minimum applied');
      }
      var roundTo = num(base.roundTo) || 25;
      var unfloored = Math.round((sub + tax) / roundTo) * roundTo;   // resolveEstimate's own rounding
      var combined = Math.round(unfloored * 100) + upg + upgTax;
      var minCents = Math.round(minCharge * 100);
      if (combined < minCents) { grandCents = minCents; minApplied = true; } else { grandCents = combined; }
    } else {
      grandCents = Math.round(grand * 100) + upg + upgTax;
    }
    return {
      subtotalCents: subtotalCents,
      taxCents: taxCents,
      grandTotalCents: grandCents,
      minJobApplied: minApplied,
      subtotal: dollars(subtotalCents),
      tax: dollars(taxCents),
      grandTotal: dollars(grandCents)
    };
  }

  // A V2 pass-through fee row (estimate-v2-ui.js getCurrentEstimate: the
  // measurement report and other flat Services charges, added after the
  // engine and its job-minimum floor).
  function isPassThroughRow(r) {
    return !!r && r.upgrade !== true &&
      (r.category === 'Services' || /^SVC /.test(String(r.code || '').trim().toUpperCase()));
  }

  /**
   * applyToEstimate(payload, priced, opts) → a NEW payload (the input is not
   * mutated) with the upgrade rows appended after the engine rows and the
   * totals moved by exactly the quoted amount. opts.minJobCharge is required
   * when payload.minJobApplied (buildEstimatePayload does not persist the
   * floor itself; resolveSelection().minJobCharge has it).
   *
   * Refuses a payload that already carries upgrade rows: re-pricing must
   * start from the engine's base payload, or the old upgrades are billed
   * twice.
   *
   * Also refuses (review of #1756 — price() checked its ctx, but nothing
   * checked that the PAYLOAD matched it):
   *  - a per-SQ payload: its customer paper prints no lines, so the upgrade
   *    would fold silently into "Roofing system — Preferred tier";
   *  - an insurance payload: upgrades never go inside a claim;
   *  - a payload taxed at a different rate than the quote;
   *  - a FLOORED payload carrying pass-through rows (V2's Services lines):
   *    V2 adds those after the floor, so unwinding subtotal + tax would pull
   *    the fee under the floor, and adding a $10 upgrade LOWERED a $475
   *    total to $410.70. Stage 2 must unwind engine rows only before it
   *    lifts this refusal.
   *
   * Not touched, deliberately: retailBeforeOHP, overhead/profit and the
   * internal margin block. Upgrades sit outside O&P and carry no cost
   * basis, so there is nothing true to add there. V2's reopen
   * (_reconstructEstimateFromSaved) derives materialRetail from
   * retailBeforeOHP and rebuilds a face-value row's lineTotal from `total`;
   * stage 2 must teach that path about upgrade rows before V2 reopens an
   * upgraded estimate.
   */
  function applyToEstimate(payload, priced, opts) {
    opts = opts || {};
    if (!payload || !Array.isArray(payload.rows)) throw new Error('[NBDUpgrades] payload.rows is required');
    if (payload.rows.some(function (r) { return r && r.upgrade === true; })) {
      throw new Error('[NBDUpgrades] payload already has upgrade rows; rebuild from the base estimate');
    }
    if (payload.priceMode === 'per-sq' || payload.prices != null) {
      throw new Error('[NBDUpgrades] refusing a per-SQ payload: its customer paper prints no line items');
    }
    if (payload.mode === 'insurance' || payload.insurance === true) {
      throw new Error('[NBDUpgrades] refusing an insurance payload: upgrades need a separate signed homeowner addendum');
    }
    if (priced && Array.isArray(priced.rows) && priced.rows.length) {
      var pr = num(payload.taxRate);
      var qr = num(priced.taxRate);
      if (pr == null || qr == null || Math.round(pr * 1e6) !== Math.round(qr * 1e6)) {
        throw new Error('[NBDUpgrades] the quote was taxed at ' + qr + ' but the payload\'s taxRate is ' + pr + '; re-price with the payload\'s rate');
      }
    }
    if (payload.minJobApplied && payload.rows.some(isPassThroughRow)) {
      throw new Error('[NBDUpgrades] refusing a floored payload with pass-through rows: the floor unwind would absorb the fee');
    }
    var t = totalsWithUpgrades({
      subtotal: payload.subtotal,
      tax: payload.tax != null ? payload.tax : payload.taxAmount,
      grandTotal: payload.grandTotal,
      minJobApplied: payload.minJobApplied,
      minJobCharge: opts.minJobCharge != null ? opts.minJobCharge : payload.minJobCharge,
      roundTo: opts.roundTo
    }, priced);
    var next = Object.assign({}, payload);
    next.rows = payload.rows.concat(priced.rows.map(function (r) { return Object.assign({}, r); }));
    next.subtotal = t.subtotal;
    next.tax = t.tax;
    next.taxAmount = t.tax;
    next.grandTotal = t.grandTotal;
    next.minJobApplied = t.minJobApplied;
    next.upgradeCents = priced.upgradeCents;
    next.upgradeTaxCents = priced.taxCents;
    next.upgrades = priced.priced.map(function (p) { return Object.assign({}, p); });
    next.upgradeLibraryVersion = lib().version;
    return next;
  }

  var api = {
    get version() { return lib().version; },
    offeredFor: offeredFor,
    price: price,
    totalsWithUpgrades: totalsWithUpgrades,
    applyToEstimate: applyToEstimate,
    sanitizeOverrides: sanitizeOverrides,
    installerLine: installerLine
  };
  root.NBDUpgrades = Object.freeze(api);
})(typeof window !== 'undefined' ? window : this);
