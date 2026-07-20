/**
 * NBD Pro - Job Templates ENGINE (no UI — see job-templates-ui.js)
 * Pre-built, editable quotes: template metadata + line items that resolve
 * through window.EstimateLogic (formulas, tier pricing, retail stamping).
 * Data: window.NBD_JOB_TEMPLATES / NBD_JOB_TEMPLATE_CATEGORIES (job-templates-data.js).
 * Custom/forked templates only in localStorage 'nbd_job_templates_v1' —
 * defaults are NEVER persisted (data file is the source of truth).
 */

(function() {
  'use strict';
  if (typeof window === 'undefined') return;

  const STORAGE_KEY = 'nbd_job_templates_v1';
  const DATA_VERSION = 1;

  // Fallback taxonomy — job-templates-data.js may not be loaded yet (lazy
  // bundle order) or may not exist; the engine must degrade, not throw.
  const FALLBACK_CATEGORIES = {
    roof_repair:       { label: 'Roof Repairs' },
    leak_flashing:     { label: 'Leak & Flashing' },
    gutters_repair:    { label: 'Gutter Repair & Maintenance' },
    gutters_install:   { label: 'Gutter Systems' },
    soffit_fascia:     { label: 'Soffit & Fascia' },
    ventilation:       { label: 'Ventilation & Energy' },
    roof_replacement:  { label: 'Full Roof Replacement' },
    specialty_roofing: { label: 'Specialty Roofing' },
    storm_emergency:   { label: 'Storm / Emergency / Insurance' },
    exterior:          { label: 'Siding, Windows & Exterior' },
    maintenance:       { label: 'Maintenance & Inspection' }
  };

  // Overhead codes that make sense once per job, no matter how many
  // templates are merged into one estimate — keep the FIRST occurrence.
  const SINGLETON_CODES = {
    'LAB MOB': 1, 'LAB DEMOB': 1, 'LAB CLN-M': 1, 'DSP HAUL': 1,
    'PRM RES-OH': 1, 'LAB PHOTO': 1, 'LAB WALK': 1
  };

  // ═════════════════════════════════════════════════════════
  // Storage — customs only. Version bumps keep custom entries
  // (they're user data; there's nothing to re-seed).
  // ═════════════════════════════════════════════════════════

  function storage() {
    try { return window.localStorage || null; } catch (e) { return null; }
  }

  function loadCustoms() {
    const ls = storage();
    if (!ls) return [];
    try {
      const stored = ls.getItem(STORAGE_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed.items) ? parsed.items : [];
    } catch (e) {
      console.error('[JobTemplates] load error:', e);
      return [];
    }
  }

  function persistCustoms(customs) {
    const ls = storage();
    if (ls) {
      try {
        ls.setItem(STORAGE_KEY, JSON.stringify({ _v: DATA_VERSION, items: customs }));
      } catch (e) {
        console.error('[JobTemplates] save error:', e);
      }
    }
    mirrorToFirestore(customs);
  }

  // Best-effort one-way Firestore mirror (template-suite.js pattern).
  // window._db is the MODULAR v10 instance — no db.batch()/db.collection();
  // use window.writeBatch + window.doc exposed by the dashboard bootstrap,
  // and guard if they aren't ready yet. Failure is non-fatal by design.
  function mirrorToFirestore(customs) {
    if (!window._db || !window._user?.uid) return;
    if (typeof window.writeBatch !== 'function' || typeof window.doc !== 'function') return;
    try {
      const db = window._db;
      const uid = window._user.uid;
      const batch = window.writeBatch(db);
      customs.forEach(tpl => {
        const ref = window.doc(db, 'users', uid, 'jobTemplates', tpl.id);
        batch.set(ref, tpl, { merge: true });
      });
      batch.commit().catch(e => console.error('[JobTemplates] Firestore mirror failed:', e));
    } catch (e) {
      console.error('[JobTemplates] Firestore mirror failed:', e);
    }
  }

  // ═════════════════════════════════════════════════════════
  // Merged read model — defaults + customs, customs win on id.
  // ═════════════════════════════════════════════════════════

  function defaults() {
    return Array.isArray(window.NBD_JOB_TEMPLATES) ? window.NBD_JOB_TEMPLATES : [];
  }

  function list() {
    const customs = loadCustoms();
    const customById = {};
    customs.forEach(t => { if (t && t.id) customById[t.id] = t; });
    const merged = [];
    const seen = {};
    defaults().forEach(t => {
      if (!t || !t.id) return;
      seen[t.id] = true;
      merged.push(customById[t.id] || t);
    });
    customs.forEach(t => {
      if (t && t.id && !seen[t.id]) merged.push(t);
    });
    return merged;
  }

  function get(id) {
    if (!id) return null;
    return list().find(t => t.id === id) || null;
  }

  function categories() {
    const data = window.NBD_JOB_TEMPLATE_CATEGORIES;
    const out = {};
    Object.keys(FALLBACK_CATEGORIES).forEach(k => { out[k] = FALLBACK_CATEGORIES[k]; });
    if (data && typeof data === 'object') {
      Object.keys(data).forEach(k => { out[k] = data[k]; });
    }
    // Categories referenced by templates but absent from both maps still
    // need a label so the library never renders an undefined chip.
    list().forEach(t => {
      const c = t.category;
      if (c && !out[c]) out[c] = { label: c.replace(/_/g, ' ') };
    });
    return out;
  }

  function search(q, filters) {
    filters = filters || {};
    const needle = String(q || '').toLowerCase().trim();
    return list().filter(t => {
      if (filters.category && t.category !== filters.category) return false;
      if (filters.jobType && t.jobType !== filters.jobType) return false;
      if (!needle) return true;
      return (t.name || '').toLowerCase().includes(needle)
        || (t.description || '').toLowerCase().includes(needle)
        || (t.category || '').toLowerCase().includes(needle)
        || (t.tags || []).some(tag => String(tag).toLowerCase().includes(needle));
    });
  }

  // ═════════════════════════════════════════════════════════
  // Custom CRUD — defaults are immutable; saving over a default
  // id shadows it as a custom fork (basedOn keeps the lineage).
  // ═════════════════════════════════════════════════════════

  function genId(name) {
    const slug = slugify(name || 'template') || 'template';
    return 'jt_custom_' + slug + '_' + Date.now().toString(36);
  }

  function saveCustom(tpl) {
    if (!tpl || typeof tpl !== 'object' || !(tpl.name || tpl.id)) return null;
    const customs = loadCustoms();
    const now = new Date().toISOString();
    const clean = JSON.parse(JSON.stringify(tpl)); // detach from caller/defaults
    if (!clean.id) clean.id = genId(clean.name);
    const isDefaultId = defaults().some(d => d && d.id === clean.id);
    if (isDefaultId && !clean.basedOn) clean.basedOn = clean.id;
    clean.custom = true;
    clean.updatedAt = now;
    const idx = customs.findIndex(t => t && t.id === clean.id);
    if (idx >= 0) {
      clean.createdAt = customs[idx].createdAt || now;
      customs[idx] = clean;
    } else {
      clean.createdAt = now;
      customs.push(clean);
    }
    persistCustoms(customs);
    return clean;
  }

  function duplicate(id) {
    const src = get(id);
    if (!src) return null;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = genId(src.name);
    copy.name = (src.name || 'Template') + ' (copy)';
    copy.basedOn = src.id;
    return saveCustom(copy);
  }

  // Removes a CUSTOM entry only. Removing a shadow restores the default.
  function remove(id) {
    const customs = loadCustoms();
    const idx = customs.findIndex(t => t && t.id === id);
    if (idx === -1) return false;
    customs.splice(idx, 1);
    persistCustoms(customs);
    return true;
  }

  // ═════════════════════════════════════════════════════════
  // Custom line items — synthetic 'JT <SLUG>' codes bridged into
  // the builder catalogs (xactimate bridge pattern).
  // ═════════════════════════════════════════════════════════

  function slugify(name) {
    return String(name || '').toLowerCase().trim()
      .replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '').replace(/\-+/g, '-');
  }

  function customCode(custom) {
    return 'JT ' + slugify(custom.name).toUpperCase();
  }

  // Line-item shape resolveLineItem expects. Costs are CONTRACTOR COST —
  // explicit materialCost/laborCost win inside the engine, which then
  // stamps retail (+25% material markup, 10/10 OH&P at rollup).
  function customLineItem(custom) {
    return {
      code:         customCode(custom),
      name:         custom.name || 'Custom item',
      description:  custom.desc || '',
      category:     custom.category || 'custom',
      unit:         custom.unit || 'EA',
      materialCost: Number(custom.materialCost) || 0,
      laborCost:    Number(custom.laborCost) || 0,
      tier:         'any',
      source:       'job-template'
    };
  }

  function registerCustomItems(tpl) {
    if (!tpl || !Array.isArray(tpl.items)) return [];
    const registered = [];
    tpl.items.forEach(item => {
      if (!item || !item.custom || !item.custom.name) return;
      const line = customLineItem(item.custom);
      const key = 'jt-' + slugify(item.custom.name);
      // V2 catalog bridge — idempotent; first registration wins.
      if (window.EstimateBuilderV2 && window.EstimateBuilderV2.CATALOG
          && !window.EstimateBuilderV2.CATALOG[key]) {
        window.EstimateBuilderV2.CATALOG[key] = {
          code:     line.code,
          name:     line.name,
          category: line.category,
          unit:     line.unit,
          cost:     line.materialCost,
          labor:    line.laborCost
        };
      }
      // The V2 UI resolves scope by NBD_XACT_CATALOG.find(code) — the JT
      // code must be findable there or insertIntoV2 scope entries silently
      // drop at getCurrentEstimate. byCode only; the xact search stays clean.
      const xact = window.NBD_XACT_CATALOG;
      if (xact && xact.byCode && !xact.byCode[line.code]) {
        xact.byCode[line.code] = line;
      }
      registered.push(key);
    });
    return registered;
  }

  // ═════════════════════════════════════════════════════════
  // Selection → resolved estimate
  // ═════════════════════════════════════════════════════════

  // Accepts 'jt_id', {templateId}, or arrays of either.
  function normalizeSelection(selection) {
    const arr = Array.isArray(selection) ? selection : (selection ? [selection] : []);
    return arr.map(s => (typeof s === 'string' ? { templateId: s } : s)).filter(s => s && s.templateId);
  }

  function itemChoice(choices, index) {
    if (!choices) return null;
    return choices[index] != null ? choices[index] : (choices[String(index)] || null);
  }

  // Validate a brand pick against the item's declared alternatives; an
  // arbitrary code here would bypass the catalog-codes CI validation.
  function pickBrandCode(item, choice) {
    if (!choice || !choice.brandCode || choice.brandCode === item.code) return item.code;
    const opts = item.brandOptions || [];
    return opts.some(o => o && o.code === choice.brandCode) ? choice.brandCode : item.code;
  }

  /**
   * resolveSelection(selection, opts)
   *   selection: [{templateId, tier?, itemChoices?: {itemIndex: {include, qty, brandCode, unitPriceOverride}}}]
   *   opts:      {tier, measurements, jobMode}
   * Merges items across templates (singleton overhead codes dedupe, first
   * wins), applies brand/qty/price choices, resolves through EstimateLogic.
   * Returns {lines, totals, measurements, minJobCharge, sourceTemplates, warnings}.
   */
  function resolveSelection(selection, opts) {
    opts = opts || {};
    const sel = normalizeSelection(selection);
    const warnings = [];
    const lineItems = [];
    const sourceTemplates = [];
    const seenSingleton = {};
    let measurements = null;
    let minJobCharge = null;

    const xact = window.NBD_XACT_CATALOG;

    sel.forEach(entry => {
      const tpl = get(entry.templateId);
      if (!tpl) {
        warnings.push('Unknown template: ' + entry.templateId);
        return;
      }
      sourceTemplates.push(tpl.id);

      // Measurements precedence: opts > FIRST selected template that has
      // them > engine defaults (null → buildContext defaults).
      if (!measurements && tpl.measurements && typeof tpl.measurements === 'object') {
        measurements = tpl.measurements;
      }
      // Floor: MAX across selected templates — merging a repair into a
      // full job must never lower the job's trip-charge floor.
      if (tpl.minJobCharge != null) {
        minJobCharge = Math.max(minJobCharge != null ? minJobCharge : 0, Number(tpl.minJobCharge));
      }

      (tpl.items || []).forEach((item, i) => {
        if (!item) return;
        const choice = itemChoice(entry.itemChoices, i);
        if (choice && choice.include === false) return;

        // Custom item — explicit costs + fixed qty, synthetic JT code.
        if (item.custom) {
          const c = item.custom;
          if (!c.name) return;
          const line = customLineItem(c);
          const qty = (choice && choice.qty != null) ? Number(choice.qty)
            : (c.qty != null ? Number(c.qty) : 1);
          line.qtyOverride = qty;
          if (choice && choice.unitPriceOverride != null) {
            // Override = customer per-unit price. Priced as labor (no
            // material markup) so retailPerUnit lands exactly on it.
            line.materialCost = 0;
            line.laborCost = Number(choice.unitPriceOverride) || 0;
          }
          lineItems.push(line);
          return;
        }

        if (!item.code) return;
        const code = pickBrandCode(item, choice);
        if (SINGLETON_CODES[code]) {
          if (seenSingleton[code]) return;
          seenSingleton[code] = true;
        }
        const base = xact && typeof xact.find === 'function' ? xact.find(code) : null;
        if (!base) {
          warnings.push('Unknown catalog code: ' + code + ' (template ' + tpl.id + ')');
          return;
        }
        // Non-destructive — spread a fresh object so the catalog's
        // original stays untouched (matches getCurrentEstimate).
        const line = Object.assign({}, base);
        const qty = (choice && choice.qty != null) ? choice.qty
          : (item.qty != null ? item.qty : null);
        if (qty !== null && qty !== '' && isFinite(Number(qty))) {
          line.qtyOverride = Number(qty);
        }
        if (choice && choice.unitPriceOverride != null) {
          line.materialCost = 0;
          line.laborCost = Number(choice.unitPriceOverride) || 0;
        }
        lineItems.push(line);
      });
    });

    if (opts.measurements && typeof opts.measurements === 'object') {
      measurements = opts.measurements;
    }

    if (!window.EstimateLogic || typeof window.EstimateLogic.resolveEstimate !== 'function') {
      warnings.push('EstimateLogic not loaded — cannot resolve');
      return { lines: [], totals: null, measurements, minJobCharge, sourceTemplates, warnings };
    }

    const settings = {
      tier: opts.tier || (sel[0] && sel[0].tier) || 'better',
      mode: opts.jobMode || 'cash'
    };
    if (opts.county) settings.county = opts.county;
    if (minJobCharge != null) settings.minJobCharge = minJobCharge;

    const totals = window.EstimateLogic.resolveEstimate(lineItems, measurements, settings);
    return {
      lines: totals.lines,
      totals,
      measurements,
      minJobCharge,
      sourceTemplates,
      warnings
    };
  }

  // ═════════════════════════════════════════════════════════
  // Payload — classic + V2 compatible doc. PURE (no DOM, no
  // window reads) so it unit-tests standalone.
  // ═════════════════════════════════════════════════════════

  /**
   * buildEstimatePayload(resolved, meta)
   *   resolved: resolveSelection() result (totals required)
   *   meta:     {name, leadId, addr, owner, deposit}
   * rows[].rate/total carry the RETAIL price — the classic-row contract is
   * customer-facing (portal, classic views, invoice items print these
   * verbatim). Cost basis lives ONLY in the *CostPerUnit/*Total split
   * fields (B-8 reconstruction; money-math sweep 2026-07-18).
   */
  function buildEstimatePayload(resolved, meta) {
    meta = meta || {};
    const est = resolved && resolved.totals;
    if (!est) return null;
    const ctx = est.context || {};
    const m = resolved.measurements || {};
    const num = (v) => (v != null && isFinite(Number(v)) ? Number(v) : null);
    const mk = (num(est.materialMarkupPct) != null ? num(est.materialMarkupPct) : 0.25);

    return {
      // Identity
      name:            meta.name || 'Template Estimate ' + new Date().toLocaleDateString(),
      builder:         'template',
      estimateVersion: 'v2',
      method:          est.method || 'line-item',
      tier:            est.tier || 'better',
      mode:            est.mode || 'cash',
      insurance:       est.mode === 'insurance',
      sourceTemplates: resolved.sourceTemplates || [],
      // Customer association
      leadId:          meta.leadId || null,
      addr:            meta.addr || '',
      owner:           meta.owner || '',
      // Measurements (echoed so the estimate list can show them)
      raw:             Math.round(ctx.rawSqft || 0),
      adj:             Math.round(ctx.adjustedSqft || 0),
      sq:              Number((ctx.sq || 0).toFixed(2)),
      wf:              ctx.waste || 1.17,
      pl:              String(m.pitch || 6) + '/12',
      ridge:           ctx.ridgeLf || 0,
      eave:            ctx.eaveLf || 0,
      hip:             ctx.hipLf || 0,
      pipes:           ctx.pipes || 0,
      stories:         num(m.stories),
      tearOffLayers:   num(m.tearOffLayers),
      deckReplacePct:  num(m.deckReplacePct),
      rakeLf:          num(m.rakeLf),
      valleyLf:        num(m.valleyLf),
      wallLf:          num(m.wallLf),
      chimneys:        num(m.chimneys),
      skylights:       num(m.skylights),
      cutUpRoof:       !!m.cutUpRoof,
      // Rows — classic shape (code/desc/qty/rate/total) + B-8 fields.
      rows: (est.lines || []).map(line => {
        const matT = Number(line.materialTotal) || 0;
        const labT = Number(line.laborTotal) || 0;
        const retailTotal = Math.round(((line.retailTotal != null)
          ? Number(line.retailTotal)
          : ((matT === 0 && labT === 0)
              ? (Number(line.lineTotal) || 0)              // pass-through: face value
              : matT * (1 + mk) + labT)) * 100) / 100;
        const retailPerUnit = (line.retailPerUnit != null)
          ? Number(line.retailPerUnit)
          : (Number(line.materialCostPerUnit) || 0) * (1 + mk) + (Number(line.laborCostPerUnit) || 0);
        return {
          code:   line.code,
          desc:   line.name,
          qty:    (line.quantity || 0).toFixed(2) + (line.unit || ''),
          rate:   '$' + retailPerUnit.toFixed(2),
          total:  retailTotal,
          retailTotal: retailTotal,
          // B-8 reconstruction fields:
          quantity:            num(line.quantity),
          unit:                line.unit || '',
          category:            line.category || '',
          materialTotal:       num(line.materialTotal),
          laborTotal:          num(line.laborTotal),
          materialCostPerUnit: num(line.materialCostPerUnit),
          laborCostPerUnit:    num(line.laborCostPerUnit),
          unitPrice:           num(line.unitPrice),
          qtyOverride:         line.qtyOverridden ? num(line.quantity) : null
        };
      }),
      // Totals — grandTotal is the canonical customer total (RETAIL after
      // markup + OH&P + tax/minimum rules).
      grandTotal:      est.total,
      selectedTier:    est.tier || 'better',
      priceMode:       'line-item',
      deposit:         (meta.deposit != null ? Number(meta.deposit) : null),
      materialCost:    est.materialCost,
      laborCost:       est.laborCost,
      subtotal:        est.subtotal,
      tax:             est.tax,
      taxAmount:       est.tax,
      taxRate:         est.taxRate,
      minJobApplied:   !!est.minJobApplied,
      // B-8 retail-scope reconstruction inputs
      materialMarkupPct: num(est.materialMarkupPct),
      retailBeforeOHP:   num(est.retailBeforeOHP),
      overhead:          num(est.overhead),
      overheadPct:       num(est.overheadPct),
      profit:            num(est.profit),
      profitPct:         num(est.profitPct),
      // Internal margin view — never customer-rendered
      internal:        est.internal || null
      // Timestamp handled by _saveEstimate (serverTimestamp)
    };
  }

  // ═════════════════════════════════════════════════════════
  // Actions
  // ═════════════════════════════════════════════════════════

  // Resolve → payload → save as a NEW estimate. Clearing the edit id is
  // load-bearing: a stale _editingEstimateId would silently OVERWRITE
  // whatever estimate the user last opened in a builder.
  async function createEstimate(selection, opts) {
    opts = opts || {};
    const resolved = resolveSelection(selection, opts);
    if (!resolved.totals) {
      throw new Error('[JobTemplates] resolve failed: ' + resolved.warnings.join('; '));
    }
    const payload = buildEstimatePayload(resolved, opts);
    if (typeof window._saveEstimate !== 'function') {
      throw new Error('[JobTemplates] _saveEstimate not loaded');
    }
    window._editingEstimateId = null;
    const id = await window._saveEstimate(payload);
    return id;
  }

  // Push the selection into the open V2 builder as additive scope entries.
  // Custom items are bridged first so their JT codes resolve in scope.
  function insertIntoV2(selection, opts) {
    opts = opts || {};
    const sel = normalizeSelection(selection);
    const entries = [];
    const seen = {};
    let measurements = null;
    let minJobCharge = null;

    sel.forEach(entry => {
      const tpl = get(entry.templateId);
      if (!tpl) return;
      registerCustomItems(tpl);
      if (!measurements && tpl.measurements && typeof tpl.measurements === 'object') {
        measurements = tpl.measurements;
      }
      if (tpl.minJobCharge != null) {
        minJobCharge = Math.max(minJobCharge != null ? minJobCharge : 0, Number(tpl.minJobCharge));
      }
      (tpl.items || []).forEach((item, i) => {
        if (!item) return;
        const choice = itemChoice(entry.itemChoices, i);
        if (choice && choice.include === false) return;
        let code, qty;
        if (item.custom) {
          if (!item.custom.name) return;
          code = customCode(item.custom);
          qty = (choice && choice.qty != null) ? choice.qty
            : (item.custom.qty != null ? item.custom.qty : 1);
        } else {
          if (!item.code) return;
          code = pickBrandCode(item, choice);
          qty = (choice && choice.qty != null) ? choice.qty
            : (item.qty != null ? item.qty : null);
        }
        if (seen[code]) return;   // addScopeEntries dedupes too; parity here
        seen[code] = true;
        const overrides = {};
        if (qty !== null && qty !== '' && isFinite(Number(qty))) overrides.qty = Number(qty);
        entries.push({ code, overrides });
      });
    });

    if (opts.measurements && typeof opts.measurements === 'object') {
      measurements = opts.measurements;
    }

    if (window.EstimateV2UI && typeof window.EstimateV2UI.addScopeEntries === 'function') {
      return window.EstimateV2UI.addScopeEntries(entries, measurements, { minJobCharge });
    }
    return { entries, measurements, minJobCharge };
  }

  // UI passthrough — the engine loads before (or without) the UI file.
  function openLibrary(opts) {
    if (window.JobTemplatesUI && typeof window.JobTemplatesUI.openPicker === 'function') {
      return window.JobTemplatesUI.openPicker(opts);
    }
    console.warn('[JobTemplates] JobTemplatesUI not loaded');
    return null;
  }

  // ═════════════════════════════════════════════════════════
  // Public API
  // ═════════════════════════════════════════════════════════

  const JobTemplates = {
    STORAGE_KEY,
    DATA_VERSION,
    SINGLETON_CODES,

    list,
    get,
    categories,
    search,

    saveCustom,
    duplicate,
    remove,

    registerCustomItems,
    resolveSelection,
    buildEstimatePayload,
    createEstimate,
    insertIntoV2,
    openLibrary
  };

  window.JobTemplates = JobTemplates;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = JobTemplates;
  }

  console.log('[JobTemplates] engine ready (' + defaults().length + ' default templates).');
})();
