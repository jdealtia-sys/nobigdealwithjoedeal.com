/**
 * NBD Pro — Job Templates Library UI (v1)
 *
 * Renders the Job Templates view (#jobTemplatesContainer) and drives the
 * pick → configure (preconfirm) → preview → create-estimate flow on top of
 * the window.JobTemplates engine (job-templates.js, same lazy bundle).
 *
 * Contract (job-template-spec.md, "Runtime architecture" item 3):
 *   window.JobTemplatesUI = { render, reRender, openPicker,
 *                             openPickerForScope, openPreconfirm, closeModal }
 *   window.renderJobTemplatesLibrary = render
 *
 * Repo rules honored here:
 *  - CSP: ZERO inline handlers anywhere (incl. JS-generated markup). ONE
 *    delegated click listener + one input/change handler, bound once behind
 *    window._NBD_JT_DELEGATE_BOUND (product-library.js pattern), dispatching
 *    on data-jt-action attributes.
 *  - Every interpolated string goes through the local escapeHtml (template
 *    names/descriptions are user-editable → stored-XSS surface).
 *  - Customer-facing money = RETAIL ONLY (retailTotal / retailPerUnit /
 *    resolved total). lineTotal / materialTotal / laborTotal never render
 *    in the preview pane (2026-07-18 money-sweep rule).
 *  - Styles injected once, keyed off the same CSS vars as estimate-v2-ui.js
 *    (var(--s,#111418), var(--orange,#e8720c), ...), mobile responsive.
 */
(function () {
  'use strict';

  // Browser guard — this file is UI-only.
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // ══════════════════════════════════════════════════════════════════════
  // Constants
  // ══════════════════════════════════════════════════════════════════════

  // Fallback taxonomy (mirrors job-templates-data.js NBD_JOB_TEMPLATE_CATEGORIES;
  // used only if the engine/data file hasn't populated categories yet).
  var FALLBACK_CATS = {
    roof_repair:      { label: 'Roof Repairs',                 icon: '🔨' },
    leak_flashing:    { label: 'Leak & Flashing',              icon: '💧' },
    gutters_repair:   { label: 'Gutter Repair & Maintenance',  icon: '🧹' },
    gutters_install:  { label: 'Gutter Systems',               icon: '🌧️' },
    soffit_fascia:    { label: 'Soffit & Fascia',              icon: '🪚' },
    ventilation:      { label: 'Ventilation & Energy',         icon: '🌀' },
    roof_replacement: { label: 'Full Roof Replacement',        icon: '🏠' },
    specialty_roofing:{ label: 'Specialty Roofing',            icon: '⭐' },
    storm_emergency:  { label: 'Storm / Emergency / Insurance',icon: '⛈️' },
    exterior:         { label: 'Siding, Windows & Exterior',   icon: '🧱' },
    maintenance:      { label: 'Maintenance & Inspection',     icon: '🔍' }
  };

  // Category accent colors (cards' left border + chips). Distinct hues per key.
  var CAT_COLORS = {
    roof_repair: '#ef4444',  leak_flashing: '#f59e0b',  gutters_repair: '#06b6d4',
    gutters_install: '#0284c7', soffit_fascia: '#8b5cf6', ventilation: '#10b981',
    roof_replacement: '#e8720c', specialty_roofing: '#64748b',
    storm_emergency: '#be123c', exterior: '#3b82f6', maintenance: '#84cc16'
  };

  var JOB_TYPES = {
    repair: 'Repair', replacement: 'Replacement', install: 'Install',
    maintenance: 'Maintenance', inspection: 'Inspection', emergency: 'Emergency'
  };

  var TIERS = ['good', 'better', 'best'];
  var TIER_LABELS = { good: 'Good', better: 'Better', best: 'Best' };

  // Default measurements used to seed the editable panel when every selected
  // template is measurement-driven (measurements: null in the schema).
  var MEAS_DEFAULTS = {
    rawSqft: 2000, pitch: 6, waste: 1.15, ridgeLf: 0, eaveLf: 0, rakeLf: 0,
    hipLf: 0, valleyLf: 0, wallLf: 0, pipes: 0, chimneys: 0, skylights: 0,
    stories: 1, tearOffLayers: 1, deckReplacePct: 0, cutUpRoof: false
  };
  var MEAS_LABELS = {
    rawSqft: 'Roof area (sqft)', pitch: 'Pitch (/12)', waste: 'Waste factor',
    ridgeLf: 'Ridge (LF)', eaveLf: 'Eave (LF)', rakeLf: 'Rake (LF)',
    hipLf: 'Hip (LF)', valleyLf: 'Valley (LF)', wallLf: 'Wall (LF)',
    pipes: 'Pipe boots', chimneys: 'Chimneys', skylights: 'Skylights',
    stories: 'Stories', tearOffLayers: 'Tear-off layers',
    deckReplacePct: 'Deck replace %', cutUpRoof: 'Cut-up roof'
  };

  // ══════════════════════════════════════════════════════════════════════
  // State
  // ══════════════════════════════════════════════════════════════════════

  var state = {
    search: '',
    category: 'all',
    jobType: 'all',
    selected: [],            // ordered template ids
    choices: {},             // templateId -> [{included, qty, brandCode, unitPriceOverride}]
    collapsed: {},           // templateId -> bool (preconfirm sections)
    tier: 'better',
    jobMode: 'cash',
    county: 'hamilton-oh',   // tax jurisdiction — same default as estimate-v2-ui.js:27
    measurements: Object.assign({}, MEAS_DEFAULTS),
    measSeedKey: '',
    measOpen: false,
    step: 'library',         // library | preconfirm | preview | success
    host: 'view',            // 'view' (dashboard container) | 'modal' (picker)
    forScope: false,
    scopeCb: null,
    leadId: null,            // lead-context entry (openPicker({leadId})) — pre-selects the lead in the create step
    createdId: null,
    createdLeadId: null,     // lead the created estimate was attributed to — powers "Send to customer" on the success step
    createdName: '',
    lastResolved: null,
    creating: false
  };

  var edState = { tpl: null, isFork: false };
  var bandCache = {};        // templateId -> 'price band' html-safe string
  var _codeMap = null;
  var _resolveTimer = null;

  // ══════════════════════════════════════════════════════════════════════
  // Helpers
  // ══════════════════════════════════════════════════════════════════════

  // Local HTML escape — EVERY interpolated string passes through this
  // (template names/descriptions are user-editable → stored-XSS surface).
  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  var esc = escapeHtml;

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function money(n) {
    var v = Number(n) || 0;
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function money0(n) {
    var v = Number(n) || 0;
    return '$' + Math.round(v).toLocaleString('en-US');
  }
  function moneyShort(n) {
    var v = Number(n) || 0;
    if (v >= 10000) return '$' + (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    if (v >= 1000) return '$' + (v / 1000).toFixed(1) + 'k';
    return '$' + Math.round(v);
  }

  function toast(msg, type) {
    if (typeof window._showToast === 'function') { window._showToast(msg, type); return; }
    try { console.log('[job-templates-ui] ' + (type || 'info') + ': ' + msg); } catch (e) {}
  }

  function engine() {
    var jt = window.JobTemplates;
    return (jt && typeof jt === 'object') ? jt : null;
  }

  function categoryMeta() {
    var JT = engine();
    if (JT && typeof JT.categories === 'function') {
      try {
        var c = JT.categories();
        if (c && typeof c === 'object' && Object.keys(c).length) return c;
      } catch (e) { /* fall through */ }
    }
    return (window.NBD_JOB_TEMPLATE_CATEGORIES && Object.keys(window.NBD_JOB_TEMPLATE_CATEGORIES).length)
      ? window.NBD_JOB_TEMPLATE_CATEGORIES : FALLBACK_CATS;
  }

  function catLabel(key) {
    var m = categoryMeta()[key];
    return m && m.label ? m.label : String(key || '').replace(/_/g, ' ');
  }
  function catIcon(key) {
    var m = categoryMeta()[key];
    return m && m.icon ? m.icon : '📋';
  }
  function catColor(key) { return CAT_COLORS[key] || '#6b7280'; }

  function isCustom(t) {
    return !!(t && (t.isCustom || t.custom === true || t.basedOn ||
      /^(jt_custom_|custom_)/.test(String(t.id || ''))));
  }

  function allTemplates() {
    var JT = engine();
    if (!JT || typeof JT.list !== 'function') return [];
    try { return JT.list() || []; } catch (e) { console.error('[job-templates-ui] list() failed:', e); return []; }
  }

  function getTpl(id) {
    var JT = engine();
    if (JT && typeof JT.get === 'function') {
      try { var t = JT.get(id); if (t) return t; } catch (e) { /* fall through */ }
    }
    var list = allTemplates();
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }

  function getFiltered() {
    var JT = engine();
    var cat = state.category === 'all' ? null : state.category;
    var jtF = state.jobType === 'all' ? null : state.jobType;
    if (JT && typeof JT.search === 'function') {
      try { return JT.search(state.search || '', { category: cat, jobType: jtF }) || []; }
      catch (e) { console.error('[job-templates-ui] search() failed:', e); }
    }
    // Manual fallback over list()
    var q = (state.search || '').toLowerCase();
    return allTemplates().filter(function (t) {
      if (!t) return false;
      if (cat && t.category !== cat) return false;
      if (jtF && t.jobType !== jtF) return false;
      if (!q) return true;
      var hay = [t.name, t.description, t.category, (t.tags || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  // Code → {name, unit} lookup (NBD_XACT_CATALOG in array or map shape,
  // plus the V2 builder catalog when present). Rebuilt if still empty.
  function codeMap() {
    if (_codeMap && Object.keys(_codeMap).length) return _codeMap;
    var m = {};
    function push(it) {
      if (it && it.code) m[String(it.code)] = { name: it.name || it.desc || '', unit: it.unit || '' };
    }
    var cat = window.NBD_XACT_CATALOG;
    if (Array.isArray(cat)) cat.forEach(push);
    else if (cat && typeof cat === 'object') {
      Object.keys(cat).forEach(function (k) {
        var v = cat[k];
        if (v && typeof v === 'object') push(v.code ? v : Object.assign({ code: k }, v));
        else m[k] = { name: String(v || ''), unit: '' };
      });
    }
    var v2 = window.EstimateBuilderV2 && window.EstimateBuilderV2.CATALOG;
    if (v2 && typeof v2 === 'object') {
      Object.keys(v2).forEach(function (k) { push(v2[k]); });
    }
    _codeMap = m;
    return m;
  }

  function catalogCodes() {
    return Object.keys(codeMap()).sort();
  }

  function itemLabel(it) {
    if (!it) return '';
    if (it.custom) return it.custom.name || 'Custom item';
    var info = codeMap()[it.code];
    return (info && info.name) ? info.name : (it.code || 'Item');
  }
  function itemDesc(it) {
    if (!it) return '';
    if (it.custom) return it.custom.desc || '';
    return it.code || '';
  }
  function itemUnit(it, choice) {
    if (it && it.custom) return it.custom.unit || 'EA';
    var code = (choice && choice.brandCode) || (it && it.code);
    var info = codeMap()[code];
    return (info && info.unit) ? info.unit : '';
  }

  // County options for the preconfirm tax selector — sourced from the engine
  // tax map (estimate-config.js COUNTY_TAX, the same table the V2 builder
  // reads), so preview tax == saved tax == V2 tax. Fallback: hamilton-oh only.
  function countyOptions() {
    var cfg = window.NBD_ESTIMATE_CONFIG;
    var map = cfg && cfg.COUNTY_TAX;
    if (map && typeof map === 'object' && Object.keys(map).length) {
      return Object.keys(map).map(function (slug) {
        var entry = map[slug] || {};
        var st = String(slug).split('-').pop();
        var label = entry.name
          ? entry.name + ' County, ' + String(st || '').toUpperCase()
          : slug;
        return { value: slug, label: label };
      });
    }
    return [{ value: 'hamilton-oh', label: 'Hamilton County, OH' }];
  }

  // ══════════════════════════════════════════════════════════════════════
  // Selection / choices / engine bridge
  // ══════════════════════════════════════════════════════════════════════

  function isSelected(id) { return state.selected.indexOf(id) !== -1; }

  function toggleSelect(id, on) {
    var idx = state.selected.indexOf(id);
    if (on && idx === -1) state.selected.push(id);
    if (!on && idx !== -1) state.selected.splice(idx, 1);
  }

  function seedChoices(tid) {
    var t = getTpl(tid);
    if (!t) return;
    state.choices[tid] = (t.items || []).map(function (it) {
      var q = null;
      if (it && it.qty != null) q = it.qty;
      else if (it && it.custom && it.custom.qty != null) q = it.custom.qty;
      return {
        included: true,
        qty: q,                              // null → engine measurement formula
        brandCode: (it && it.code) || null,  // brand choice (defaults to own code)
        unitPriceOverride: null              // rep-typed customer retail $/unit
      };
    });
  }

  function ensureChoices() {
    state.selected.forEach(function (tid) {
      var t = getTpl(tid);
      var want = t ? (t.items || []).length : 0;
      if (!state.choices[tid] || state.choices[tid].length !== want) seedChoices(tid);
    });
    // prune stale
    Object.keys(state.choices).forEach(function (tid) {
      if (!isSelected(tid)) delete state.choices[tid];
    });
  }

  // Seed the editable measurements panel from the selected templates:
  // field-wise max across templates that carry baked measurements, OR the
  // generic defaults when everything is measurement-driven (null).
  function seedMeasurements() {
    var key = state.selected.slice().sort().join(',');
    if (key === state.measSeedKey) return;
    state.measSeedKey = key;
    var seeded = null;
    state.selected.forEach(function (tid) {
      var t = getTpl(tid);
      if (!t || !t.measurements) return;
      if (!seeded) seeded = Object.assign({}, MEAS_DEFAULTS, t.measurements);
      else {
        Object.keys(MEAS_DEFAULTS).forEach(function (k) {
          var v = t.measurements[k];
          if (typeof MEAS_DEFAULTS[k] === 'boolean') seeded[k] = seeded[k] || !!v;
          else if (num(v) != null) seeded[k] = Math.max(Number(seeded[k]) || 0, Number(v));
        });
      }
    });
    state.measurements = seeded || Object.assign({}, MEAS_DEFAULTS);
    // Measurement-driven selections need real numbers → open the panel.
    state.measOpen = anyMeasurementDriven();
  }

  function anyMeasurementDriven() {
    return state.selected.some(function (tid) {
      var t = getTpl(tid);
      return t && (t.measurements === null || t.measurements === undefined);
    });
  }

  function buildSelection() {
    ensureChoices();
    return state.selected.map(function (tid) {
      var ch = state.choices[tid] || [];
      return {
        templateId: tid,
        itemChoices: ch.map(function (c, i) {
          // Canonical UI↔engine contract: brandCode + unitPriceOverride —
          // the engine reads EXACTLY these keys (never the legacy names).
          return {
            index: i,
            include: c.included !== false,
            qty: (c.qty === null || c.qty === undefined || c.qty === '') ? null : Number(c.qty),
            brandCode: c.brandCode || null,
            unitPriceOverride: (c.unitPriceOverride === null || c.unitPriceOverride === undefined || c.unitPriceOverride === '') ? null : Number(c.unitPriceOverride)
          };
        })
      };
    });
  }

  function resolveOpts() {
    return {
      tier: state.tier,
      jobMode: state.jobMode,
      county: state.county || 'hamilton-oh',
      measurements: Object.assign({}, state.measurements)
    };
  }

  function resolveCurrent() {
    var JT = engine();
    if (!JT || typeof JT.resolveSelection !== 'function') return null;
    try { return JT.resolveSelection(buildSelection(), resolveOpts()); }
    catch (e) { console.error('[job-templates-ui] resolveSelection failed:', e); return null; }
  }

  // Defensive totals reader — the engine returns {lines, totals} with retail
  // stamped; tolerate a few key spellings but only ever surface RETAIL fields.
  function readTotals(res) {
    if (!res) return null;
    var t = res.totals || res;
    var total = num(t.total); if (total == null) total = num(t.grandTotal);
    var sub = num(t.subtotal); if (sub == null) sub = num(t.retailSubtotal);
    var tax = num(t.tax); if (tax == null) tax = num(t.taxAmount); if (tax == null) tax = num(t.salesTax);
    // Engine flag is minJobApplied (estimate-logic-engine.js resolveEstimate).
    var minApplied = !!t.minJobApplied;
    // O&P bridge (customer-estimate-rows house pattern): lines sum to
    // retailBeforeOHP; the O&P row makes them foot to Subtotal.
    var ohp = (Number(t.overhead) || 0) + (Number(t.profit) || 0);
    var ohpPct = Math.round(((Number(t.overheadPct) || 0) + (Number(t.profitPct) || 0)) * 100);
    return { total: total, subtotal: sub, tax: tax, minApplied: minApplied, ohp: ohp, ohpPct: ohpPct };
  }

  function readLines(res) {
    if (!res) return [];
    if (Array.isArray(res.lines)) return res.lines;
    if (res.estimate && Array.isArray(res.estimate.lines)) return res.estimate.lines;
    return [];
  }

  function lineRetailTotal(line) {
    var r = num(line && line.retailTotal);
    if (r != null) return r;
    var per = num(line && line.retailPerUnit);
    var q = num(line && (line.quantity != null ? line.quantity : line.qty));
    if (per != null && q != null) return per * q;
    return null;
  }
  function lineRetailPerUnit(line) {
    var per = num(line && line.retailPerUnit);
    if (per != null) return per;
    var r = num(line && line.retailTotal);
    var q = num(line && (line.quantity != null ? line.quantity : line.qty));
    if (r != null && q) return r / q;
    return null;
  }
  function lineQty(line) {
    var q = num(line && (line.quantity != null ? line.quantity : line.qty));
    return q == null ? 0 : q;
  }

  // code → resolved line (also keyed by lowercased name for custom items)
  function lineMapFrom(res) {
    var map = {};
    readLines(res).forEach(function (l) {
      if (!l) return;
      if (l.code) map[String(l.code)] = l;
      var nm = String(l.name || l.desc || l.description || '').trim().toLowerCase();
      if (nm) map['name:' + nm] = l;
    });
    return map;
  }

  function findLineForItem(it, choice, map) {
    if (!it) return null;
    if (it.custom) {
      var nm = String(it.custom.name || '').trim().toLowerCase();
      return map['name:' + nm] || null;
    }
    var code = (choice && choice.brandCode) || it.code;
    return map[String(code)] || null;
  }

  // Card price band: single-template resolve at good & best tier, cached.
  function priceBand(tpl) {
    if (!tpl || !tpl.id) return '';
    if (bandCache[tpl.id] !== undefined) return bandCache[tpl.id];
    var JT = engine();
    if (!JT || typeof JT.resolveSelection !== 'function') return (bandCache[tpl.id] = '');
    var out = '';
    try {
      var meas = Object.assign({}, MEAS_DEFAULTS, tpl.measurements || {});
      var sel = [{ templateId: tpl.id, itemChoices: (tpl.items || []).map(function (it, i) {
        return { index: i, include: true, qty: (it && it.qty != null) ? it.qty : null, brandCode: (it && it.code) || null, unitPriceOverride: null };
      }) }];
      var lo = readTotals(JT.resolveSelection(sel, { tier: 'good', jobMode: 'cash', measurements: meas }));
      var hi = readTotals(JT.resolveSelection(sel, { tier: 'best', jobMode: 'cash', measurements: meas }));
      if (lo && hi && lo.total != null && hi.total != null) {
        out = (Math.round(lo.total) === Math.round(hi.total))
          ? moneyShort(lo.total)
          : moneyShort(Math.min(lo.total, hi.total)) + ' – ' + moneyShort(Math.max(lo.total, hi.total));
      }
    } catch (e) { out = ''; }
    bandCache[tpl.id] = out;
    return out;
  }

  function clearBandCache() { bandCache = {}; }

  // ══════════════════════════════════════════════════════════════════════
  // Styles (injected once into <head>)
  // ══════════════════════════════════════════════════════════════════════

  function ensureStyles() {
    if (document.getElementById('jtUIStyles')) return;
    var st = document.createElement('style');
    st.id = 'jtUIStyles';
    st.textContent = [
      '.jt-wrap{padding:20px;font-family:"Barlow","Helvetica Neue",-apple-system,sans-serif;color:var(--t,#e8eaf0);}',
      '.jt-hdr{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:18px;}',
      '.jt-hdr h1{margin:0;font-size:26px;font-weight:800;color:var(--t,#e8eaf0);}',
      '.jt-hdr p{margin:5px 0 0;font-size:13px;color:var(--m,#9aa3ad);}',
      '.jt-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:16px;}',
      '.jt-stat{background:var(--s,#111418);padding:13px 14px;border-radius:8px;border:1px solid var(--br,#2a2f35);border-left-width:4px;}',
      '.jt-stat .k{font-size:11px;color:var(--m,#9aa3ad);font-weight:600;}',
      '.jt-stat .v{font-size:22px;font-weight:800;color:var(--t,#e8eaf0);margin-top:2px;}',
      '.jt-controls{background:var(--s,#111418);border:1px solid var(--br,#2a2f35);padding:14px;border-radius:10px;margin-bottom:16px;}',
      '.jt-search{width:100%;padding:10px 14px;background:var(--s2,#181c22);border:1px solid var(--br,#2a2f35);border-radius:8px;font-size:14px;color:var(--t,#e8eaf0);box-sizing:border-box;}',
      '.jt-search:focus{outline:none;border-color:var(--orange,#e8720c);}',
      '.jt-pills{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;}',
      '.jt-pill{padding:6px 12px;border-radius:20px;border:2px solid var(--br,#2a2f35);background:transparent;color:var(--t,#e8eaf0);cursor:pointer;font-size:12px;font-weight:500;font-family:inherit;white-space:nowrap;-webkit-tap-highlight-color:transparent;}',
      '.jt-pill .ct{background:var(--br,#2a2f35);color:var(--m,#9aa3ad);border-radius:10px;padding:1px 7px;font-size:11px;margin-left:4px;}',
      '.jt-pill.on{font-weight:700;}',
      // ── Recently-used strip (compact horizontal cards above the grid) ──
      '.jt-recent{margin-bottom:16px;}',
      '.jt-recent-hdr{font-size:11px;font-weight:700;color:var(--m,#9aa3ad);text-transform:uppercase;letter-spacing:.12em;margin-bottom:8px;}',
      '.jt-recent-row{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch;}',
      '.jt-recent-card{flex:0 0 auto;display:flex;align-items:center;gap:9px;background:var(--s,#111418);border:1px solid var(--br,#2a2f35);border-left-width:3px;border-radius:8px;padding:8px 12px;cursor:pointer;color:var(--t,#e8eaf0);font-family:inherit;text-align:left;max-width:240px;-webkit-tap-highlight-color:transparent;touch-action:manipulation;}',
      '.jt-recent-card:hover{border-color:var(--orange,#e8720c);}',
      '.jt-recent-card.sel{outline:2px solid var(--orange,#e8720c);outline-offset:-1px;}',
      '.jt-recent-ic{font-size:16px;}',
      '.jt-recent-name{display:block;font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px;}',
      '.jt-recent-meta{display:block;font-size:10px;color:var(--m,#9aa3ad);margin-top:1px;}',
      '.jt-recent-check{color:var(--orange,#e8720c);font-weight:800;font-size:13px;}',
      '.jt-used-chip{opacity:.85;}',
      '.jt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;padding-bottom:96px;}',
      '@media (max-width:640px){.jt-grid{grid-template-columns:1fr;}.jt-wrap{padding:12px;}}',
      '.jt-card{position:relative;background:var(--s,#111418);border:1px solid var(--br,#2a2f35);border-left-width:4px;border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:8px;transition:box-shadow .15s;}',
      '.jt-card:hover{box-shadow:0 4px 14px rgba(0,0,0,.28);}',
      '.jt-card.sel{outline:2px solid var(--orange,#e8720c);outline-offset:-1px;}',
      '.jt-card-top{display:flex;gap:10px;align-items:flex-start;}',
      '.jt-check{width:20px;height:20px;min-width:20px;accent-color:var(--orange,#e8720c);cursor:pointer;margin-top:2px;}',
      '.jt-card-name{font-weight:700;font-size:14.5px;color:var(--t,#e8eaf0);line-height:1.25;}',
      '.jt-card-desc{font-size:12px;color:var(--m,#9aa3ad);line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}',
      '.jt-chip{display:inline-block;font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:10px;background:var(--s2,#181c22);color:var(--m,#9aa3ad);border:1px solid var(--br,#2a2f35);white-space:nowrap;}',
      '.jt-chips{display:flex;flex-wrap:wrap;gap:5px;align-items:center;}',
      '.jt-band{font-size:13px;font-weight:800;color:var(--orange,#e8720c);}',
      // Bottom action block: primary "Use" CTA over the band + edit/dupe row.
      // margin-top:auto pins it to the card bottom (grid cards stretch equal).
      '.jt-card-actions{margin-top:auto;display:flex;flex-direction:column;gap:9px;border-top:1px solid var(--br,#2a2f35);padding-top:10px;}',
      '.jt-card-use{width:100%;}',
      '.jt-card-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;}',
      '.jt-btn{padding:8px 14px;border-radius:8px;border:1px solid var(--br,#2a2f35);background:var(--s2,#181c22);color:var(--t,#e8eaf0);cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;-webkit-tap-highlight-color:transparent;touch-action:manipulation;}',
      '.jt-btn:hover{border-color:var(--orange,#e8720c);}',
      '.jt-btn-sm{padding:5px 10px;font-size:11px;border-radius:6px;}',
      '.jt-btn-primary{background:var(--orange,#e8720c);border-color:var(--orange,#e8720c);color:#fff;font-weight:700;}',
      '.jt-btn-primary:hover{background:#ff8420;border-color:#ff8420;}',
      '.jt-btn-primary:disabled{opacity:.55;cursor:default;}',
      '.jt-btn-danger{color:#ef4444;border-color:#7f1d1d;background:transparent;}',
      '.jt-empty{text-align:center;padding:56px 20px;color:var(--m,#9aa3ad);font-size:14px;}',
      '.jt-stickybar{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(18px + env(safe-area-inset-bottom,0px));z-index:900;background:var(--s,#111418);border:1px solid var(--orange,#e8720c);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.5);padding:10px 14px;display:flex;gap:12px;align-items:center;max-width:calc(100vw - 24px);flex-wrap:wrap;justify-content:center;}',
      '.jt-stickybar .n{font-size:13px;font-weight:700;color:var(--t,#e8eaf0);white-space:nowrap;}',
      // ── Modal shell ──
      '#jtModal{position:fixed;inset:0;z-index:10500;background:rgba(10,12,15,.96);display:none;font-family:"Barlow","Helvetica Neue",sans-serif;padding-top:env(safe-area-inset-top,0);padding-bottom:env(safe-area-inset-bottom,0);}',
      '#jtModal.open{display:flex;flex-direction:column;}',
      '.jt-m-hdr{background:var(--s,#111418);border-bottom:2px solid var(--orange,#e8720c);padding:12px 20px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-shrink:0;}',
      '.jt-m-title{font-family:"Barlow Condensed",sans-serif;font-size:20px;font-weight:800;color:#fff;text-transform:uppercase;letter-spacing:.06em;}',
      '.jt-m-title .pro{color:var(--orange,#e8720c);}',
      '.jt-m-step{font-size:11px;color:var(--m,#9aa3ad);letter-spacing:.12em;text-transform:uppercase;font-weight:700;}',
      '.jt-m-step b{color:var(--orange,#e8720c);}',
      '.jt-m-close{background:var(--orange,#e8720c);border:1px solid var(--orange,#e8720c);color:#fff;padding:10px 18px;cursor:pointer;font-weight:700;border-radius:6px;font-size:13px;min-height:44px;min-width:44px;font-family:inherit;-webkit-tap-highlight-color:transparent;touch-action:manipulation;}',
      '.jt-m-close:hover{background:#ff8420;}',
      '.jt-m-body{flex:1;overflow-y:auto;min-height:0;padding:18px;color:var(--t,#e8eaf0);}',
      '.jt-m-body>.jt-col{max-width:960px;margin:0 auto;}',
      '.jt-m-foot{flex-shrink:0;background:var(--s,#111418);border-top:1px solid var(--br,#2a2f35);padding:12px 18px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;}',
      '.jt-run{font-size:13px;color:var(--m,#9aa3ad);}',
      '.jt-run b{font-size:20px;color:var(--t,#e8eaf0);font-weight:800;margin-left:6px;}',
      '@media (max-width:640px){.jt-m-hdr{padding:10px 12px;}.jt-m-title{font-size:15px;}.jt-m-body{padding:10px;}.jt-m-foot{padding:10px 12px;}.jt-m-step{display:none;}}',
      // ── Preconfirm ──
      '.jt-topctl{display:flex;gap:14px;flex-wrap:wrap;align-items:center;background:var(--s2,#181c22);border:1px solid var(--br,#2a2f35);border-radius:10px;padding:12px 14px;margin-bottom:14px;}',
      '.jt-seg{display:inline-flex;border:1px solid var(--br,#2a2f35);border-radius:8px;overflow:hidden;}',
      '.jt-seg button{background:transparent;color:var(--m,#9aa3ad);border:none;padding:8px 14px;cursor:pointer;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.04em;font-family:inherit;-webkit-tap-highlight-color:transparent;}',
      '.jt-seg button.on{background:var(--orange,#e8720c);color:#fff;}',
      '.jt-ctl-lbl{font-size:10.5px;color:var(--m,#9aa3ad);font-weight:700;text-transform:uppercase;letter-spacing:.1em;display:block;margin-bottom:4px;}',
      '.jt-sec{border:1px solid var(--br,#2a2f35);border-radius:10px;margin-bottom:12px;overflow:hidden;background:var(--s,#111418);}',
      '.jt-sec-hdr{display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer;user-select:none;background:var(--s2,#181c22);-webkit-tap-highlight-color:transparent;}',
      '.jt-sec-hdr .nm{font-weight:700;font-size:14px;color:var(--t,#e8eaf0);flex:1;min-width:0;}',
      '.jt-sec-hdr .meta{font-size:11px;color:var(--m,#9aa3ad);white-space:nowrap;}',
      '.jt-sec-hdr .chev{color:var(--orange,#e8720c);font-size:15px;font-weight:800;width:14px;text-align:center;}',
      '.jt-sec-body{padding:10px 12px;display:flex;flex-direction:column;gap:8px;}',
      '.jt-sec.closed .jt-sec-body{display:none;}',
      '.jt-scopenotes{font-size:11.5px;color:var(--m,#9aa3ad);border-left:3px solid var(--br,#2a2f35);padding:4px 10px;margin:2px 0 4px;line-height:1.45;}',
      '.jt-row{display:flex;gap:10px;align-items:flex-start;padding:9px 10px;border:1px solid var(--br,#2a2f35);border-radius:8px;background:var(--s2,#181c22);}',
      '.jt-row.off{opacity:.45;}',
      '.jt-row-main{flex:1;min-width:0;}',
      '.jt-row-name{font-size:13px;font-weight:600;color:var(--t,#e8eaf0);line-height:1.3;}',
      '.jt-row-desc{font-size:11px;color:var(--m,#9aa3ad);margin-top:1px;}',
      '.jt-opt{display:inline-block;font-size:9.5px;font-weight:800;letter-spacing:.08em;color:#eab308;border:1px solid #713f12;border-radius:4px;padding:1px 6px;margin-left:6px;text-transform:uppercase;vertical-align:1px;}',
      '.jt-row-ctrls{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;}',
      '.jt-in{background:var(--s,#111418);border:1px solid var(--br,#2a2f35);color:var(--t,#e8eaf0);border-radius:6px;padding:7px 8px;font-size:13px;font-family:inherit;box-sizing:border-box;}',
      '.jt-in:focus{outline:none;border-color:var(--orange,#e8720c);}',
      '.jt-in-qty{width:76px;text-align:right;}',
      '.jt-in-price{width:92px;text-align:right;}',
      '.jt-mini-lbl{font-size:9.5px;color:var(--m,#9aa3ad);font-weight:700;text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:2px;}',
      '.jt-unit{font-size:11px;color:var(--m,#9aa3ad);min-width:24px;}',
      '.jt-lineretail{font-size:12px;font-weight:700;color:var(--orange,#e8720c);min-width:90px;text-align:right;white-space:nowrap;}',
      '.jt-brand{max-width:230px;font-size:12px;}',
      '@media (max-width:640px){.jt-row{flex-wrap:wrap;}.jt-row-ctrls{width:100%;justify-content:flex-start;}.jt-lineretail{margin-left:auto;}}',
      '.jt-meas{border:1px dashed var(--br,#2a2f35);border-radius:10px;padding:12px 14px;margin-bottom:14px;background:var(--s,#111418);}',
      '.jt-meas-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-top:10px;}',
      // ── Proposal (customer-facing paper — deliberately light-on-white) ──
      '.jt-prop{max-width:820px;margin:0 auto;background:#fff;color:#1a202c;border-radius:10px;padding:34px 38px;box-shadow:0 10px 40px rgba(0,0,0,.5);}',
      '.jt-prop-co{font-family:"Barlow Condensed",sans-serif;font-size:26px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#1a202c;}',
      // Compact legal-name line shown UNDER the logo (letterhead), so the name
      // doesn\'t read as a second giant wordmark beside the logo mark.
      '.jt-prop-co-sm{font-family:"Barlow Condensed",sans-serif;font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-top:7px;line-height:1.1;}',
      '.jt-prop-kind{font-size:11px;font-weight:800;letter-spacing:.22em;text-transform:uppercase;color:var(--orange,#e8720c);margin-top:3px;}',
      '.jt-prop-meta{font-size:12px;color:#64748b;margin-top:6px;}',
      '.jt-prop hr{border:none;border-top:2px solid #1a202c;margin:16px 0;}',
      '.jt-prop-scope h3{margin:14px 0 3px;font-size:14px;font-weight:800;color:#1a202c;}',
      '.jt-prop-scope p{margin:0;font-size:12.5px;color:#475569;line-height:1.55;}',
      '.jt-prop table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px;}',
      '.jt-prop th{text-align:left;border-bottom:2px solid #1a202c;padding:8px 6px;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#334155;}',
      '.jt-prop td{padding:8px 6px;border-bottom:1px solid #e2e8f0;vertical-align:top;}',
      '.jt-prop .num{text-align:right;white-space:nowrap;}',
      '.jt-prop-grp td{background:#f8fafc;font-weight:800;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#475569;}',
      '.jt-prop-tots{margin-top:14px;margin-left:auto;max-width:300px;font-size:13.5px;}',
      '.jt-prop-tots .r{display:flex;justify-content:space-between;padding:5px 0;color:#334155;}',
      '.jt-prop-tots .g{border-top:2px solid #1a202c;margin-top:5px;padding-top:9px;font-size:17px;font-weight:800;color:#1a202c;}',
      '.jt-prop-note{margin-top:20px;font-size:11px;color:#94a3b8;line-height:1.5;}',
      '@media (max-width:640px){.jt-prop{padding:20px 14px;}}',
      '.jt-createbar{max-width:820px;margin:16px auto 0;background:var(--s,#111418);border:1px solid var(--br,#2a2f35);border-radius:10px;padding:14px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;}',
      '.jt-createbar .fld{flex:1;min-width:200px;}',
      // ── Lead picker (EntityResolver) ──
      '.er-picker{position:relative;}',
      // Two-choice chooser — same flex:1 primary/secondary pair pattern as
      // D2D's Hot Lead "Convert Now" / "Edit First" prompt, for consistency.
      '.er-choice{display:flex;gap:10px;}',
      '.er-choice button{flex:1;}',
      '.er-search-wrap{position:relative;}',
      '.er-search{width:100%;}',
      '.er-back{margin-top:8px;}',
      '.er-selected{display:flex;align-items:center;gap:8px;background:var(--s2,#181c22);border:1px solid var(--br,#2a2f35);border-radius:6px;padding:7px 8px;}',
      '.er-selected-name{font-size:13px;font-weight:700;color:var(--t,#e8eaf0);}',
      '.er-selected-sub{font-size:11px;color:var(--m,#9aa3ad);flex:1;}',
      '.er-results{position:absolute;left:0;right:0;top:100%;margin-top:4px;background:var(--s,#111418);border:1px solid var(--br,#2a2f35);border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.4);max-height:240px;overflow-y:auto;z-index:5;}',
      '.er-row{padding:8px 10px;cursor:pointer;border-bottom:1px solid var(--br,#2a2f35);}',
      '.er-row:last-child{border-bottom:none;}',
      '.er-row:hover{background:var(--s2,#181c22);}',
      '.er-row-name{display:block;font-size:12.5px;font-weight:600;color:var(--t,#e8eaf0);}',
      '.er-row-sub{display:block;font-size:11px;color:var(--m,#9aa3ad);}',
      '.er-row-empty{cursor:default;font-size:11.5px;color:var(--m,#9aa3ad);}',
      '.er-row-empty:hover{background:transparent;}',
      // ── Success ──
      '.jt-success{max-width:520px;margin:8vh auto 0;text-align:center;background:var(--s,#111418);border:1px solid var(--br,#2a2f35);border-radius:14px;padding:38px 26px;}',
      '.jt-success .ic{width:64px;height:64px;border-radius:50%;background:rgba(16,185,129,.12);border:2px solid #10b981;color:#10b981;font-size:30px;line-height:60px;margin:0 auto 14px;}',
      '.jt-success h2{margin:0 0 6px;font-size:20px;color:var(--t,#e8eaf0);}',
      '.jt-success p{margin:0 0 20px;font-size:13px;color:var(--m,#9aa3ad);}',
      '.jt-success .btns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;}',
      // ── Editor overlay ──
      '#jtEditModal{position:fixed;inset:0;z-index:10600;background:rgba(0,0,0,.65);display:none;align-items:center;justify-content:center;padding:18px;font-family:"Barlow","Helvetica Neue",sans-serif;}',
      '#jtEditModal.open{display:flex;}',
      '.jt-ed-card{background:var(--s,#111418);border:1px solid var(--br,#2a2f35);border-radius:12px;width:min(880px,100%);max-height:92vh;display:flex;flex-direction:column;overflow:hidden;color:var(--t,#e8eaf0);box-shadow:0 14px 50px rgba(0,0,0,.6);}',
      '.jt-ed-hdr{padding:14px 18px;border-bottom:2px solid var(--orange,#e8720c);display:flex;justify-content:space-between;align-items:center;gap:10px;}',
      '.jt-ed-hdr .t{font-weight:800;font-size:16px;color:#fff;}',
      '.jt-ed-body{flex:1;overflow-y:auto;min-height:0;padding:16px 18px;}',
      '.jt-ed-foot{padding:12px 18px;border-top:1px solid var(--br,#2a2f35);display:flex;justify-content:flex-end;gap:10px;}',
      '.jt-ed-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}',
      '@media (max-width:640px){.jt-ed-grid{grid-template-columns:1fr;}}',
      '.jt-ed-item{display:flex;gap:8px;align-items:center;padding:8px;border:1px solid var(--br,#2a2f35);border-radius:8px;background:var(--s2,#181c22);flex-wrap:wrap;}',
      '.jt-ed-item .code{flex:1;min-width:160px;}',
      '.jt-fork-note{font-size:11.5px;color:#eab308;border:1px solid #713f12;background:rgba(234,179,8,.06);border-radius:8px;padding:8px 12px;margin-bottom:12px;line-height:1.45;}'
    ].join('\n');
    document.head.appendChild(st);
  }

  // ══════════════════════════════════════════════════════════════════════
  // Modal shell (injected once — estimate-v2-ui ensureModal pattern)
  // ══════════════════════════════════════════════════════════════════════

  function ensureModal() {
    ensureStyles();
    if (document.getElementById('jtModal')) return;

    var modal = document.createElement('div');
    modal.id = 'jtModal';
    modal.innerHTML =
      '<div class="jt-m-hdr">' +
        '<div style="display:flex;align-items:baseline;gap:14px;min-width:0;">' +
          '<span class="jt-m-title">Job <span class="pro">Templates</span></span>' +
          '<span class="jt-m-step" id="jtStepLbl"></span>' +
        '</div>' +
        '<button type="button" class="jt-m-close" data-jt-action="close-modal">✕ Close</button>' +
      '</div>' +
      '<div class="jt-m-body" id="jtModalBody"></div>' +
      '<div class="jt-m-foot" id="jtModalFoot" style="display:none;"></div>';
    document.body.appendChild(modal);

    var ed = document.createElement('div');
    ed.id = 'jtEditModal';
    ed.innerHTML = '<div class="jt-ed-card" id="jtEditCard"></div>';
    document.body.appendChild(ed);
  }

  function modalOpen() {
    var m = document.getElementById('jtModal');
    return !!(m && m.classList.contains('open'));
  }

  function showModal() {
    ensureModal();
    document.getElementById('jtModal').classList.add('open');
  }

  function closeModal() {
    var m = document.getElementById('jtModal');
    if (m) m.classList.remove('open');
    var e = document.getElementById('jtEditModal');
    if (e) e.classList.remove('open');
    state.step = 'library';
    state.creating = false;
    state.leadId = null; // lead context is per-open, never sticky
    if (state.host === 'modal') {
      state.host = 'view';
      state.forScope = false;
      state.scopeCb = null;
    }
    reRender(); // refresh the dashboard view (selection state may have changed)
  }

  // ══════════════════════════════════════════════════════════════════════
  // LIBRARY view
  // ══════════════════════════════════════════════════════════════════════

  function renderStats(list) {
    var all = allTemplates();
    var customs = all.filter(isCustom).length;
    var cats = {};
    all.forEach(function (t) { if (t && t.category) cats[t.category] = 1; });
    function tile(k, v, color) {
      return '<div class="jt-stat" style="border-left-color:' + esc(color) + ';">' +
        '<div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div></div>';
    }
    return '<div class="jt-stats">' +
      tile('Templates', all.length, '#3b82f6') +
      tile('Custom', customs, '#8b5cf6') +
      tile('Categories', Object.keys(cats).length, '#10b981') +
      tile('Showing', list.length, '#f59e0b') +
      tile('Selected', state.selected.length, 'var(--orange,#e8720c)') +
      '</div>';
  }

  function renderPills() {
    var meta = categoryMeta();
    var all = allTemplates();
    var counts = {};
    all.forEach(function (t) { if (t) counts[t.category] = (counts[t.category] || 0) + 1; });

    var catPills = '<button type="button" class="jt-pill' + (state.category === 'all' ? ' on' : '') + '" ' +
      'data-jt-action="set-category" data-id="all" style="' +
      (state.category === 'all' ? 'border-color:var(--orange,#e8720c);color:var(--orange,#e8720c);background:rgba(232,114,12,.09);' : '') +
      '">All <span class="ct">' + all.length + '</span></button>';
    Object.keys(meta).forEach(function (key) {
      var c = counts[key] || 0;
      if (!c) return;
      var on = state.category === key;
      var col = catColor(key);
      catPills += '<button type="button" class="jt-pill' + (on ? ' on' : '') + '" data-jt-action="set-category" data-id="' + esc(key) + '"' +
        (on ? ' style="border-color:' + esc(col) + ';color:' + esc(col) + ';background:' + esc(col) + '18;"' : '') + '>' +
        esc(catIcon(key)) + ' ' + esc(catLabel(key)) + ' <span class="ct">' + c + '</span></button>';
    });

    var typePills = '<button type="button" class="jt-pill' + (state.jobType === 'all' ? ' on' : '') + '" data-jt-action="set-jobtype" data-id="all"' +
      (state.jobType === 'all' ? ' style="border-color:var(--orange,#e8720c);color:var(--orange,#e8720c);background:rgba(232,114,12,.09);"' : '') +
      '>All types</button>';
    Object.keys(JOB_TYPES).forEach(function (key) {
      var on = state.jobType === key;
      typePills += '<button type="button" class="jt-pill' + (on ? ' on' : '') + '" data-jt-action="set-jobtype" data-id="' + esc(key) + '"' +
        (on ? ' style="border-color:var(--orange,#e8720c);color:var(--orange,#e8720c);background:rgba(232,114,12,.09);"' : '') + '>' +
        esc(JOB_TYPES[key]) + '</button>';
    });

    return '<div class="jt-controls">' +
      '<input type="text" class="jt-search" id="jtSearch" data-jt-action="search" ' +
        'placeholder="Search templates by name, tag, or description..." value="' + esc(state.search) + '">' +
      '<div class="jt-pills">' + typePills + '</div>' +
      '<div class="jt-pills">' + catPills + '</div>' +
      '</div>';
  }

  function renderCard(t) {
    var col = catColor(t.category);
    var sel = isSelected(t.id);
    var custom = isCustom(t);
    var items = (t.items || []).length;
    var band = priceBand(t);
    var tags = (t.tags || []).slice(0, 3).map(function (tg) {
      return '<span class="jt-chip">#' + esc(tg) + '</span>';
    }).join('');
    // Primary card CTA — the always-visible entry into the use flow, so the
    // rep never has to discover the checkbox + sticky bar to apply a
    // template. In scope mode it inserts into the open estimate; otherwise
    // it runs configure → preview → attribute-to-customer → create.
    var useLabel = state.forScope ? 'Insert into estimate →' : 'Use this template →';
    var useTitle = state.forScope
      ? 'Add this template to the open estimate'
      : 'Configure this template, then apply it to a customer, lead, or prospect';

    return '<div class="jt-card' + (sel ? ' sel' : '') + '" style="border-left-color:' + esc(col) + ';">' +
      '<div class="jt-card-top">' +
        '<input type="checkbox" class="jt-check" data-jt-action="toggle-select" data-id="' + esc(t.id) + '"' + (sel ? ' checked' : '') + ' aria-label="Select ' + esc(t.name) + '">' +
        '<div style="flex:1;min-width:0;">' +
          '<div class="jt-card-name">' + esc(t.name) +
            (custom ? ' <span class="jt-chip" style="color:#8b5cf6;border-color:#8b5cf6;">Custom</span>' : '') +
          '</div>' +
          '<div class="jt-chips" style="margin-top:4px;">' +
            '<span class="jt-chip" style="color:' + esc(col) + ';border-color:' + esc(col) + '55;">' + esc(catIcon(t.category)) + ' ' + esc(catLabel(t.category)) + '</span>' +
            (t.jobType ? '<span class="jt-chip">' + esc(JOB_TYPES[t.jobType] || t.jobType) + '</span>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="jt-card-desc">' + esc(t.description || '') + '</div>' +
      '<div class="jt-chips">' +
        '<span class="jt-chip">' + items + ' item' + (items === 1 ? '' : 's') + '</span>' +
        (t.durationHint ? '<span class="jt-chip">⏱ ' + esc(t.durationHint) + '</span>' : '') +
        // Subtle stickiness signal — list() stamps useCount from the usage map.
        (Number(t.useCount) > 0 ? '<span class="jt-chip jt-used-chip">used ' + Number(t.useCount) + '×</span>' : '') +
        tags +
      '</div>' +
      '<div class="jt-card-actions">' +
        '<button type="button" class="jt-btn jt-btn-primary jt-card-use" data-jt-action="quick-use" data-id="' + esc(t.id) + '" title="' + esc(useTitle) + '">' + useLabel + '</button>' +
        '<div class="jt-card-foot">' +
          '<span class="jt-band">' + (band ? esc(band) : '&nbsp;') + '</span>' +
          '<div style="display:flex;gap:6px;">' +
            '<button type="button" class="jt-btn jt-btn-sm" data-jt-action="edit-template" data-id="' + esc(t.id) + '">Edit</button>' +
            '<button type="button" class="jt-btn jt-btn-sm" data-jt-action="duplicate-template" data-id="' + esc(t.id) + '">Duplicate</button>' +
            (custom ? '<button type="button" class="jt-btn jt-btn-sm jt-btn-danger" data-jt-action="delete-template" data-id="' + esc(t.id) + '">Delete</button>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      '</div>';
  }

  // "Recently used" strip — top 6 by lastUsedAt (list() overlays the usage
  // map), compact cards, hidden entirely when nothing has been used yet.
  // Tapping a card toggles selection (same effect as the grid checkbox).
  function renderRecentStrip() {
    var recent = allTemplates()
      .filter(function (t) { return t && Number(t.useCount) > 0 && t.lastUsedAt != null; })
      .sort(function (a, b) { return Number(b.lastUsedAt || 0) - Number(a.lastUsedAt || 0); })
      .slice(0, 6);
    if (!recent.length) return '';
    var cards = recent.map(function (t) {
      var col = catColor(t.category);
      var sel = isSelected(t.id);
      return '<button type="button" class="jt-recent-card' + (sel ? ' sel' : '') + '" ' +
        'data-jt-action="quick-select" data-id="' + esc(t.id) + '" ' +
        'style="border-left-color:' + esc(col) + ';" aria-label="Select ' + esc(t.name) + '">' +
        '<span class="jt-recent-ic">' + esc(catIcon(t.category)) + '</span>' +
        '<span style="min-width:0;">' +
          '<span class="jt-recent-name">' + esc(t.name) + '</span>' +
          '<span class="jt-recent-meta">used ' + Number(t.useCount) + '×</span>' +
        '</span>' +
        (sel ? '<span class="jt-recent-check">✓</span>' : '') +
        '</button>';
    }).join('');
    return '<div class="jt-recent">' +
      '<div class="jt-recent-hdr">🕘 Recently used</div>' +
      '<div class="jt-recent-row">' + cards + '</div>' +
      '</div>';
  }

  function renderStickyBar() {
    var n = state.selected.length;
    if (!n) return '';
    var label = state.forScope ? 'Insert setup (' + n + ')' : 'Configure &amp; Preview (' + n + ')';
    return '<div class="jt-stickybar">' +
      '<span class="n">' + n + ' template' + (n === 1 ? '' : 's') + ' selected</span>' +
      '<button type="button" class="jt-btn jt-btn-sm" data-jt-action="clear-selection">Clear</button>' +
      '<button type="button" class="jt-btn jt-btn-primary" data-jt-action="open-preconfirm">' + label + '</button>' +
      '</div>';
  }

  function renderLibrary() {
    ensureStyles();
    var JT = engine();
    if (!JT) {
      return '<div class="jt-wrap"><div class="jt-empty">' +
        '<div style="font-size:34px;margin-bottom:10px;">📋</div>' +
        'Job templates are still loading.<br>' +
        '<button type="button" class="jt-btn" style="margin-top:14px;" data-jt-action="rerender">Retry</button>' +
        '</div></div>';
    }
    var list = getFiltered();
    var cards = list.map(renderCard).join('');
    var hdrBtns =
      '<div style="display:flex;gap:8px;">' +
        '<button type="button" class="jt-btn jt-btn-primary" data-jt-action="new-template">+ New Template</button>' +
      '</div>';
    // In modal (picker) mode the dashboard page header isn't around us,
    // so include a compact heading either way.
    return '<div class="jt-wrap">' +
      '<div class="jt-hdr"><div>' +
        '<h1>Job Templates</h1>' +
        '<p>Pre-built quotes — select one or more, customize, and generate a retail estimate.</p>' +
      '</div>' + hdrBtns + '</div>' +
      renderStats(list) +
      renderPills() +
      renderRecentStrip() +
      (cards ? '<div class="jt-grid">' + cards + '</div>'
             : '<div class="jt-empty">No templates match your filters.</div>') +
      renderStickyBar() +
      '</div>';
  }

  // Public: render() → HTML string (same contract as _productLib.render()).
  function render() {
    return renderLibrary();
  }

  function viewHost() { return document.getElementById('jobTemplatesContainer'); }

  function paintView() {
    var host = viewHost();
    if (host) host.innerHTML = renderLibrary();
  }

  function paintModal() {
    ensureModal();
    var body = document.getElementById('jtModalBody');
    var foot = document.getElementById('jtModalFoot');
    var stepLbl = document.getElementById('jtStepLbl');
    if (!body || !foot) return;

    var stepNames = state.host === 'modal'
      ? ['library', 'preconfirm'].concat(state.forScope ? [] : ['preview'])
      : ['preconfirm'].concat(state.forScope ? [] : ['preview']);
    if (stepLbl) {
      stepLbl.innerHTML = stepNames.map(function (s) {
        var lbl = s === 'library' ? 'Pick' : (s === 'preconfirm' ? 'Configure' : 'Preview');
        return (s === state.step) ? '<b>' + lbl + '</b>' : lbl;
      }).join(' › ');
    }

    if (state.step === 'library') {
      body.innerHTML = renderLibrary();
      foot.style.display = 'none';
    } else if (state.step === 'preconfirm') {
      body.innerHTML = renderPreconfirm();
      foot.innerHTML = renderPreconfirmFoot();
      foot.style.display = 'flex';
      refreshTotals(); // populate running total + per-line retail
    } else if (state.step === 'preview') {
      var res = resolveCurrent();
      state.lastResolved = res;
      body.innerHTML = renderPreview(res);
      _jtWireLeadPicker();
      foot.innerHTML =
        '<button type="button" class="jt-btn" data-jt-action="back-to-preconfirm">← Back to edit</button>' +
        '<span class="jt-run" id="jtRunTotal">' + runTotalHtml(res) + '</span>';
      foot.style.display = 'flex';
    } else if (state.step === 'success') {
      body.innerHTML = renderSuccess();
      foot.style.display = 'none';
    }
    body.scrollTop = 0;
  }

  // Public: reRender — repaints whichever host is live.
  function reRender() {
    if (modalOpen() && state.step !== 'library') { paintModal(); return; }
    if (modalOpen() && state.host === 'modal') { paintModal(); }
    paintView();
  }

  // ══════════════════════════════════════════════════════════════════════
  // PRECONFIRM step
  // ══════════════════════════════════════════════════════════════════════

  function renderPreconfirm() {
    ensureChoices();
    seedMeasurements();

    var tierSeg = '<div><span class="jt-ctl-lbl">Tier</span><div class="jt-seg">' +
      TIERS.map(function (t) {
        return '<button type="button" class="' + (state.tier === t ? 'on' : '') + '" data-jt-action="set-tier" data-id="' + t + '">' + TIER_LABELS[t] + '</button>';
      }).join('') + '</div></div>';

    var modeSeg = '<div><span class="jt-ctl-lbl">Job mode</span><div class="jt-seg">' +
      ['cash', 'insurance'].map(function (m) {
        return '<button type="button" class="' + (state.jobMode === m ? 'on' : '') + '" data-jt-action="set-jobmode" data-id="' + m + '">' + (m === 'cash' ? 'Cash' : 'Insurance') + '</button>';
      }).join('') + '</div></div>';

    // County/tax jurisdiction — same tax map + default as the V2 builder, so
    // preview tax == saved tax == V2 tax (never the 7% no-county fallback).
    var countySel = '<div><span class="jt-ctl-lbl">County / Tax</span>' +
      '<select class="jt-in" data-jt-action="set-county" style="min-width:180px;">' +
      countyOptions().map(function (o) {
        return '<option value="' + esc(o.value) + '"' + (state.county === o.value ? ' selected' : '') + '>' + esc(o.label) + '</option>';
      }).join('') + '</select></div>';

    var measBtn = '<div style="margin-left:auto;"><span class="jt-ctl-lbl">&nbsp;</span>' +
      '<button type="button" class="jt-btn" data-jt-action="toggle-meas">📐 Measurements ' + (state.measOpen ? '▾' : '▸') + '</button></div>';

    var html = '<div class="jt-col">' +
      '<div class="jt-topctl">' + tierSeg + modeSeg + countySel + measBtn + '</div>' +
      (state.measOpen ? renderMeasPanel() : '');

    state.selected.forEach(function (tid) {
      html += renderTplSection(tid);
    });

    html += '</div>';
    return html;
  }

  function renderMeasPanel() {
    var driven = anyMeasurementDriven();
    var fields = Object.keys(MEAS_DEFAULTS).map(function (k) {
      var v = state.measurements[k];
      if (typeof MEAS_DEFAULTS[k] === 'boolean') {
        return '<label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--t,#e8eaf0);cursor:pointer;">' +
          '<input type="checkbox" class="jt-check" style="width:17px;height:17px;min-width:17px;" data-jt-meas="' + esc(k) + '"' + (v ? ' checked' : '') + '>' +
          esc(MEAS_LABELS[k] || k) + '</label>';
      }
      return '<div><span class="jt-mini-lbl">' + esc(MEAS_LABELS[k] || k) + '</span>' +
        '<input type="number" step="any" class="jt-in" style="width:100%;" data-jt-meas="' + esc(k) + '" value="' + esc(v == null ? '' : v) + '"></div>';
    }).join('');
    return '<div class="jt-meas">' +
      '<div style="font-size:12px;font-weight:700;color:var(--orange,#e8720c);text-transform:uppercase;letter-spacing:.1em;">Measurements' +
      (driven ? ' <span style="color:#eab308;font-weight:600;text-transform:none;letter-spacing:0;">— required: a selected template scales to real measurements</span>' : '') +
      '</div>' +
      '<div class="jt-meas-grid">' + fields + '</div>' +
      '</div>';
  }

  function renderTplSection(tid) {
    var t = getTpl(tid);
    if (!t) return '';
    var ch = state.choices[tid] || [];
    var closed = !!state.collapsed[tid];
    var included = ch.filter(function (c) { return c.included !== false; }).length;
    var col = catColor(t.category);

    var rows = (t.items || []).map(function (it, i) {
      return renderItemRow(tid, it, ch[i] || {}, i);
    }).join('');

    return '<div class="jt-sec' + (closed ? ' closed' : '') + '" style="border-left:4px solid ' + esc(col) + ';">' +
      '<div class="jt-sec-hdr" data-jt-action="toggle-section" data-id="' + esc(tid) + '">' +
        '<span class="chev">' + (closed ? '+' : '−') + '</span>' +
        '<span class="nm">' + esc(catIcon(t.category)) + ' ' + esc(t.name) + '</span>' +
        '<span class="meta">' + included + '/' + (t.items || []).length + ' items' +
          (t.durationHint ? ' · ' + esc(t.durationHint) : '') + '</span>' +
      '</div>' +
      '<div class="jt-sec-body">' +
        (t.scopeNotes ? '<div class="jt-scopenotes">' + esc(t.scopeNotes) + '</div>' : '') +
        rows +
      '</div>' +
      '</div>';
  }

  function renderItemRow(tid, it, choice, idx) {
    var incl = choice.included !== false;
    var unit = itemUnit(it, choice);
    var name = itemLabel(it);
    var desc = itemDesc(it);
    var qtyVal = (choice.qty === null || choice.qty === undefined) ? '' : choice.qty;
    var priceVal = (choice.unitPriceOverride === null || choice.unitPriceOverride === undefined) ? '' : choice.unitPriceOverride;

    var brandSel = '';
    if (Array.isArray(it.brandOptions) && it.brandOptions.length) {
      brandSel = '<select class="jt-in jt-brand" data-jt-action="item-brand" data-tid="' + esc(tid) + '" data-idx="' + idx + '">' +
        it.brandOptions.map(function (o) {
          var on = (choice.brandCode || it.code) === o.code;
          return '<option value="' + esc(o.code) + '"' + (on ? ' selected' : '') + '>' + esc(o.label) + '</option>';
        }).join('') + '</select>';
    }

    return '<div class="jt-row' + (incl ? '' : ' off') + '">' +
      '<input type="checkbox" class="jt-check" data-jt-action="item-include" data-tid="' + esc(tid) + '" data-idx="' + idx + '"' + (incl ? ' checked' : '') + ' aria-label="Include ' + esc(name) + '">' +
      '<div class="jt-row-main">' +
        '<div class="jt-row-name">' + esc(name) +
          (it.optional ? '<span class="jt-opt">Optional</span>' : '') +
        '</div>' +
        (desc ? '<div class="jt-row-desc">' + esc(desc) + '</div>' : '') +
        (brandSel ? '<div style="margin-top:6px;">' + brandSel + '</div>' : '') +
      '</div>' +
      '<div class="jt-row-ctrls">' +
        '<div><span class="jt-mini-lbl">Qty</span>' +
          '<input type="number" step="any" min="0" class="jt-in jt-in-qty" placeholder="auto" data-jt-action="item-qty" data-tid="' + esc(tid) + '" data-idx="' + idx + '" value="' + esc(qtyVal) + '">' +
        '</div>' +
        '<span class="jt-unit">' + esc(unit) + '</span>' +
        '<div><span class="jt-mini-lbl">$ / unit</span>' +
          '<input type="number" step="any" min="0" class="jt-in jt-in-price" placeholder="auto" data-jt-action="item-price" data-tid="' + esc(tid) + '" data-idx="' + idx + '" value="' + esc(priceVal) + '">' +
        '</div>' +
        '<span class="jt-lineretail" data-jt-lineref="' + esc(tid) + '|' + idx + '">…</span>' +
      '</div>' +
      '</div>';
  }

  function renderPreconfirmFoot() {
    var back = '<button type="button" class="jt-btn" data-jt-action="' +
      (state.host === 'modal' ? 'back-to-library' : 'close-modal') + '">← Back</button>';
    var primary = state.forScope
      ? '<button type="button" class="jt-btn jt-btn-primary" data-jt-action="insert-into-v2">Insert into estimate →</button>'
      : '<button type="button" class="jt-btn jt-btn-primary" data-jt-action="go-preview">Preview proposal →</button>';
    return back +
      '<span class="jt-run" id="jtRunTotal">…</span>' +
      primary;
  }

  function runTotalHtml(res) {
    var t = readTotals(res);
    if (!t || t.total == null) return 'Total (retail): <b>—</b>';
    var bits = 'Total (retail): <b>' + esc(money0(t.total)) + '</b>';
    var extra = [];
    if (t.subtotal != null) extra.push('subtotal ' + money0(t.subtotal));
    if (t.tax != null && t.tax > 0) extra.push('tax ' + money0(t.tax));
    if (t.minApplied) extra.push('min charge applied');
    if (extra.length) bits += ' <span style="font-size:11px;">(' + esc(extra.join(' · ')) + ')</span>';
    return bits;
  }

  // Debounced live re-resolve → running total + per-line retail chips only
  // (never a full repaint, so typing in qty/price inputs keeps focus).
  function scheduleResolve() {
    if (_resolveTimer) clearTimeout(_resolveTimer);
    _resolveTimer = setTimeout(refreshTotals, 250);
  }

  function refreshTotals() {
    _resolveTimer = null;
    if (!modalOpen() || state.step !== 'preconfirm') return;
    var res = resolveCurrent();
    state.lastResolved = res;
    var footTotal = document.getElementById('jtRunTotal');
    if (footTotal) footTotal.innerHTML = runTotalHtml(res);
    var map = lineMapFrom(res);
    var spans = document.querySelectorAll('[data-jt-lineref]');
    for (var i = 0; i < spans.length; i++) {
      var sp = spans[i];
      var parts = String(sp.getAttribute('data-jt-lineref') || '').split('|');
      var tid = parts[0], idx = Number(parts[1]);
      var t = getTpl(tid);
      var it = t && t.items && t.items[idx];
      var ch = (state.choices[tid] || [])[idx] || {};
      if (!it || ch.included === false) { sp.textContent = '—'; continue; }
      var line = findLineForItem(it, ch, map);
      if (!line) { sp.textContent = res ? '—' : '…'; continue; }
      var q = lineQty(line);
      var unit = line.unit || itemUnit(it, ch);
      var rt = lineRetailTotal(line);
      sp.textContent = (q ? (q % 1 ? q.toFixed(1) : q) + (unit ? ' ' + unit : '') + ' · ' : '') +
        (rt != null ? money0(rt) : '—');
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // PREVIEW step (customer-facing — RETAIL ONLY)
  // ══════════════════════════════════════════════════════════════════════

  // Active-tenant brand — the same source every other brand-bearing surface
  // reads (company-profile.js window._brand(): NBD defaults deep-merged with
  // this tenant's companyProfile.brand). Never null once company-profile.js
  // is loaded; falls back to _companyProfile.brand, then null.
  function brandCtx() {
    try {
      if (typeof window._brand === 'function') {
        var b = window._brand();
        if (b && typeof b === 'object') return b;
      }
    } catch (e) { /* fall through */ }
    var cp = window._companyProfile;
    return (cp && cp.brand && typeof cp.brand === 'object') ? cp.brand : null;
  }

  // Company display name — the tenant's legal name (e.g. "No Big Deal Home
  // Solutions"), NOT the old hardcoded "No Big Deal Roofing". Legacy
  // _companyProfile.companyName/name still win if a page set them.
  function companyName() {
    var b = brandCtx();
    if (b && (b.legalName || b.displayName)) return b.legalName || b.displayName;
    var cp = window._companyProfile;
    return (cp && (cp.companyName || cp.name)) || 'No Big Deal Home Solutions';
  }

  // Logo src for the proposal letterhead. The tenant's own brand.logoUrl
  // wins; only the NBD tenant falls back to the NBD asset — a non-NBD tenant
  // with no logo gets none, never NBD's (cross-tenant leak guard, mirrors
  // document-generator.js _logoSrc / review M1).
  function brandLogo() {
    var b = brandCtx();
    if (b && b.logoUrl) return String(b.logoUrl);
    var isNbd = !b || !b.legalName || b.legalName === 'No Big Deal Home Solutions';
    if (!isNbd) return '';
    if (typeof window.NBD_LOGO_DATA_URI === 'string' && window.NBD_LOGO_DATA_URI) return window.NBD_LOGO_DATA_URI;
    return 'https://nobigdealwithjoedeal.com/assets/images/nbd-logo.png';
  }

  // Brand colors for the customer-facing proposal — primary (navy) titles the
  // company, accent (orange) tags the proposal kind. Falls back to the
  // canonical NBD palette so the paper is never unstyled.
  function brandColors() {
    var b = brandCtx();
    var c = (b && b.colors && typeof b.colors === 'object') ? b.colors : {};
    return {
      primary: c.primary || '#1E3A6E',
      accent:  c.accent  || '#E8720C',
      ink:     c.ink     || '#14181F'
    };
  }

  function defaultEstimateName() {
    var first = getTpl(state.selected[0]);
    var base = first ? first.name : 'Job Template Estimate';
    var extra = state.selected.length > 1 ? ' + ' + (state.selected.length - 1) + ' more' : '';
    var d = new Date();
    return base + extra + ' — ' + (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
  }

  function renderPreview(res) {
    var totals = readTotals(res);
    var lines = readLines(res).filter(function (l) {
      // Customer preview: only lines that actually bill. Hides zero-qty
      // formula lines (incl. the self-selecting dumpster trio).
      return lineQty(l) > 0 && (lineRetailTotal(l) || 0) > 0;
    });

    // Scope descriptions — template.description is the customer-facing text
    // (scopeNotes is rep-internal and deliberately NOT shown here).
    var scopes = state.selected.map(function (tid) {
      var t = getTpl(tid);
      if (!t) return '';
      return '<div class="jt-prop-scope"><h3>' + esc(t.name) + '</h3>' +
        (t.description ? '<p>' + esc(t.description) + '</p>' : '') + '</div>';
    }).join('');

    // Group lines by resolved category when present, else one section.
    var groups = {};
    var order = [];
    lines.forEach(function (l) {
      var g = String(l.category || 'Scope of Work');
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(l);
    });

    var rowsHtml = '';
    order.forEach(function (g) {
      if (order.length > 1) {
        rowsHtml += '<tr class="jt-prop-grp"><td colspan="5">' + esc(g.replace(/_/g, ' ')) + '</td></tr>';
      }
      groups[g].forEach(function (l) {
        var q = lineQty(l);
        var per = lineRetailPerUnit(l);
        var rt = lineRetailTotal(l);
        var nm = l.name || l.desc || l.description || l.code || 'Item';
        rowsHtml += '<tr>' +
          '<td>' + esc(nm) + '</td>' +
          '<td class="num">' + esc(q % 1 ? q.toFixed(1) : q) + '</td>' +
          '<td>' + esc(l.unit || '') + '</td>' +
          '<td class="num">' + (per != null ? esc(money(per)) : '—') + '</td>' +
          '<td class="num">' + (rt != null ? esc(money(rt)) : '—') + '</td>' +
          '</tr>';
      });
    });

    var totsHtml = '';
    if (totals) {
      // House pattern (customer-estimate-rows.js): retail lines sum to
      // retailBeforeOHP — the O&P bridge row is mandatory so the printed
      // lines foot to the Subtotal, matching the portal/invoice rendering.
      if (totals.ohp > 0) {
        totsHtml += '<div class="r"><span>Overhead &amp; Profit' +
          (totals.ohpPct ? ' (' + esc(totals.ohpPct) + '%)' : '') + '</span><span>' +
          esc(money(totals.ohp)) + '</span></div>';
      }
      if (totals.subtotal != null) totsHtml += '<div class="r"><span>Subtotal</span><span>' + esc(money(totals.subtotal)) + '</span></div>';
      if (totals.tax != null && totals.tax > 0) totsHtml += '<div class="r"><span>Tax</span><span>' + esc(money(totals.tax)) + '</span></div>';
      totsHtml += '<div class="r g"><span>Total</span><span>' + esc(totals.total != null ? money(totals.total) : '—') + '</span></div>';
      if (totals.minApplied) totsHtml += '<div class="r" style="font-size:11px;color:#94a3b8;"><span>Minimum job charge applied</span><span></span></div>';
    } else {
      totsHtml = '<div class="r g"><span>Total</span><span>—</span></div>';
    }

    var d = new Date();
    var dateStr = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    // Lead-context flow: openPicker/openPreconfirm({leadId}) staged the
    // lead — _jtWireLeadPicker() (called from paintModal right after this
    // HTML is inserted) preselects it. #jtLeadSel is the load-bearing
    // contract: doCreateEstimate() reads its .value unchanged regardless
    // of whether the lead came from search, quick-create, or pre-staging.
    var leadField =
      '<div class="fld"><span class="jt-mini-lbl">Apply to customer / lead (optional)</span>' +
      '<input type="hidden" id="jtLeadSel" value="' + (state.leadId ? esc(state.leadId) : '') + '">' +
      '<div id="jtLeadPickerRoot"></div>' +
      '</div>';

    var colors = brandColors();
    var logo = brandLogo();
    var coName = companyName();
    var kind = (state.jobMode === 'insurance' ? 'Insurance Proposal' : 'Project Proposal');
    // Letterhead. When a logo is present it is the hero brand mark and the
    // legal name renders as a COMPACT line beneath it (a proposal becomes a
    // contract — the legal entity name must still appear, but not as a second
    // giant wordmark competing with the logo). With no logo (e.g. a white-label
    // tenant that hasn't uploaded one) the legal name IS the masthead.
    // No inline onerror — CSP sets script-src-attr 'none'; the NBD logo src is
    // same-origin (docs/assets/images/nbd-logo.png) so it resolves under img-src 'self'.
    var brandBlock = logo
      ? '<img src="' + esc(logo) + '" alt="' + esc(coName) + '" ' +
          'style="max-height:52px;max-width:240px;display:block;object-fit:contain;">' +
        '<div class="jt-prop-co-sm" style="color:' + esc(colors.primary) + ';">' + esc(coName) + '</div>'
      : '<div class="jt-prop-co" style="color:' + esc(colors.primary) + ';">' + esc(coName) + '</div>';

    return '<div class="jt-prop">' +
      '<div style="display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;">' +
        '<div>' +
          brandBlock +
          '<div class="jt-prop-kind" style="color:' + esc(colors.accent) + ';">' + kind + '</div>' +
        '</div>' +
        '<div class="jt-prop-meta" style="text-align:right;">' +
          esc(dateStr) + '<br>' +
          esc(TIER_LABELS[state.tier] || state.tier) + ' tier' +
        '</div>' +
      '</div>' +
      '<hr>' +
      scopes +
      '<table><thead><tr>' +
        '<th>Item</th><th class="num">Qty</th><th>Unit</th><th class="num">Unit Price</th><th class="num">Total</th>' +
      '</tr></thead><tbody>' +
        (rowsHtml || '<tr><td colspan="5" style="color:#94a3b8;">No billable line items — adjust quantities or measurements.</td></tr>') +
      '</tbody></table>' +
      '<div class="jt-prop-tots">' + totsHtml + '</div>' +
      '<div class="jt-prop-note">Prepared with ' + esc(companyName()) + '. Pricing reflects the selected scope and is valid for 30 days. Final invoice follows the signed agreement.</div>' +
      '</div>' +
      // Create bar (rep-facing, below the paper)
      '<div class="jt-createbar">' +
        '<div class="fld"><span class="jt-mini-lbl">Estimate name</span>' +
          '<input type="text" class="jt-in" id="jtEstName" style="width:100%;" value="' + esc(defaultEstimateName()) + '"></div>' +
        leadField +
        '<button type="button" class="jt-btn jt-btn-primary" data-jt-action="create-estimate"' + (state.creating ? ' disabled' : '') + '>' +
          (state.creating ? 'Creating…' : 'Create estimate') + '</button>' +
      '</div>';
  }

  // Wires the real search/quick-create widget into the #jtLeadPickerRoot
  // container renderPreview() just emitted. Called from paintModal AFTER
  // body.innerHTML is set, since the container must be live in the DOM.
  function _jtWireLeadPicker() {
    var root = document.getElementById('jtLeadPickerRoot');
    var hidden = document.getElementById('jtLeadSel');
    if (!root || !hidden || !window.EntityResolver) return;
    var leads = Array.isArray(window._leads) ? window._leads : [];
    var initialLead = state.leadId
      ? leads.filter(function (l) { return l && String(l.id) === String(state.leadId); })[0] || null
      : null;
    window.EntityResolver.mountLeadPicker(root, {
      hiddenInput: hidden,
      initialLead: initialLead
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // SUCCESS step
  // ══════════════════════════════════════════════════════════════════════

  function renderSuccess() {
    // "Send to customer" only when the estimate was attributed to a lead —
    // the shared estimate-view link mints a portal token whose leadId must
    // match the estimate's leadId (getEstimateForView enforces it). When a
    // lead is attached it's the primary action (the payoff of quoting a
    // customer); otherwise the builder is primary.
    var hasLead = !!state.createdLeadId;
    var sendBtn = hasLead
      ? '<button type="button" class="jt-btn jt-btn-primary" data-jt-action="send-to-customer">📤 Send to customer</button>'
      : '';
    return '<div class="jt-success">' +
      '<div class="ic">✓</div>' +
      '<h2>Estimate created</h2>' +
      '<p>' + esc(state.createdName || 'Your estimate') + ' has been saved to your estimates.' +
        (hasLead ? ' Send the customer a private link to view it.' : '') + '</p>' +
      '<div class="btns">' +
        sendBtn +
        '<button type="button" class="jt-btn' + (hasLead ? '' : ' jt-btn-primary') + '" data-jt-action="open-in-v2">Open in Estimate Builder</button>' +
        '<button type="button" class="jt-btn" data-jt-action="done">Done</button>' +
      '</div>' +
      '</div>';
  }

  // ══════════════════════════════════════════════════════════════════════
  // Template editor (fork-on-edit; JSON-backed form)
  // ══════════════════════════════════════════════════════════════════════

  function blankTemplate() {
    return {
      id: '', name: '', category: 'roof_repair', jobType: 'repair',
      description: '', scopeNotes: '', tags: [], durationHint: '',
      minJobCharge: null, measurements: null, items: []
    };
  }

  function openEditor(id) {
    var t = id ? getTpl(id) : null;
    edState.tpl = t ? JSON.parse(JSON.stringify(t)) : blankTemplate();
    edState.isFork = !!(t && !isCustom(t));
    ensureModal();
    paintEditor();
    document.getElementById('jtEditModal').classList.add('open');
  }

  function closeEditor() {
    var e = document.getElementById('jtEditModal');
    if (e) e.classList.remove('open');
    edState.tpl = null;
  }

  function paintEditor() {
    var card = document.getElementById('jtEditCard');
    var t = edState.tpl;
    if (!card || !t) return;

    var meta = categoryMeta();
    var catOpts = Object.keys(meta).map(function (k) {
      return '<option value="' + esc(k) + '"' + (t.category === k ? ' selected' : '') + '>' + esc(catLabel(k)) + '</option>';
    }).join('');
    var typeOpts = Object.keys(JOB_TYPES).map(function (k) {
      return '<option value="' + esc(k) + '"' + (t.jobType === k ? ' selected' : '') + '>' + esc(JOB_TYPES[k]) + '</option>';
    }).join('');

    var dl = '<datalist id="jtCodeList">' + catalogCodes().map(function (c) {
      return '<option value="' + esc(c) + '"></option>';
    }).join('') + '</datalist>';

    var itemsHtml = (t.items || []).map(function (it, i) {
      var isCustomItem = !!it.custom;
      var codeField = isCustomItem
        ? '<input type="text" class="jt-in code" data-jt-edi="customName" data-idx="' + i + '" value="' + esc(it.custom.name || '') + '" placeholder="Custom item name">'
        : '<input type="text" class="jt-in code" list="jtCodeList" data-jt-edi="code" data-idx="' + i + '" value="' + esc(it.code || '') + '" placeholder="Catalog code">';
      var q = (isCustomItem ? it.custom.qty : it.qty);
      return '<div class="jt-ed-item">' +
        '<span class="jt-chip" style="min-width:52px;text-align:center;">' + (isCustomItem ? 'CUSTOM' : 'CODE') + '</span>' +
        codeField +
        '<div><span class="jt-mini-lbl">Qty</span>' +
          '<input type="number" step="any" min="0" class="jt-in jt-in-qty" placeholder="auto" data-jt-edi="qty" data-idx="' + i + '" value="' + esc(q == null ? '' : q) + '"></div>' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--m,#9aa3ad);cursor:pointer;">' +
          '<input type="checkbox" data-jt-edi="optional" data-idx="' + i + '"' + (it.optional ? ' checked' : '') + '> optional</label>' +
        '<div style="display:flex;gap:4px;margin-left:auto;">' +
          '<button type="button" class="jt-btn jt-btn-sm" data-jt-action="ed-move-up" data-idx="' + i + '" title="Move up">↑</button>' +
          '<button type="button" class="jt-btn jt-btn-sm" data-jt-action="ed-move-down" data-idx="' + i + '" title="Move down">↓</button>' +
          '<button type="button" class="jt-btn jt-btn-sm jt-btn-danger" data-jt-action="ed-remove-item" data-idx="' + i + '">✕</button>' +
        '</div>' +
        '</div>';
    }).join('');

    card.innerHTML =
      '<div class="jt-ed-hdr">' +
        '<span class="t">' + (t.id ? 'Edit Template' : 'New Template') + '</span>' +
        '<button type="button" class="jt-m-close" style="min-height:38px;padding:8px 14px;" data-jt-action="ed-cancel">✕</button>' +
      '</div>' +
      '<div class="jt-ed-body">' + dl +
        (edState.isFork
          ? '<div class="jt-fork-note">This is a built-in template. Saving your changes creates your own editable copy — the original stays untouched.</div>'
          : '') +
        '<div class="jt-ed-grid">' +
          '<div><span class="jt-mini-lbl">Name</span>' +
            '<input type="text" class="jt-in" style="width:100%;" data-jt-ed="name" value="' + esc(t.name) + '"></div>' +
          '<div><span class="jt-mini-lbl">Duration hint</span>' +
            '<input type="text" class="jt-in" style="width:100%;" data-jt-ed="durationHint" value="' + esc(t.durationHint || '') + '" placeholder="e.g. 2-3 hours"></div>' +
          '<div><span class="jt-mini-lbl">Category</span>' +
            '<select class="jt-in" style="width:100%;" data-jt-ed="category">' + catOpts + '</select></div>' +
          '<div><span class="jt-mini-lbl">Job type</span>' +
            '<select class="jt-in" style="width:100%;" data-jt-ed="jobType">' + typeOpts + '</select></div>' +
          '<div><span class="jt-mini-lbl">Tags (comma-separated)</span>' +
            '<input type="text" class="jt-in" style="width:100%;" data-jt-ed="tags" value="' + esc((t.tags || []).join(', ')) + '"></div>' +
          '<div><span class="jt-mini-lbl">Minimum job charge ($, blank = engine default)</span>' +
            '<input type="number" step="any" min="0" class="jt-in" style="width:100%;" data-jt-ed="minJobCharge" value="' + esc(t.minJobCharge == null ? '' : t.minJobCharge) + '"></div>' +
        '</div>' +
        '<div style="margin-top:12px;"><span class="jt-mini-lbl">Customer description (shown on proposals)</span>' +
          '<textarea class="jt-in" style="width:100%;min-height:56px;resize:vertical;" data-jt-ed="description">' + esc(t.description || '') + '</textarea></div>' +
        '<div style="margin-top:10px;"><span class="jt-mini-lbl">Scope notes (internal, rep-facing)</span>' +
          '<textarea class="jt-in" style="width:100%;min-height:56px;resize:vertical;" data-jt-ed="scopeNotes">' + esc(t.scopeNotes || '') + '</textarea></div>' +
        '<div style="margin:16px 0 8px;display:flex;justify-content:space-between;align-items:center;">' +
          '<span style="font-size:12px;font-weight:800;color:var(--orange,#e8720c);text-transform:uppercase;letter-spacing:.1em;">Line items (' + (t.items || []).length + ')</span>' +
          '<button type="button" class="jt-btn jt-btn-sm" data-jt-action="ed-add-item">+ Add item</button>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:8px;">' +
          (itemsHtml || '<div class="jt-empty" style="padding:22px;">No items yet — add catalog codes above.</div>') +
        '</div>' +
      '</div>' +
      '<div class="jt-ed-foot">' +
        '<button type="button" class="jt-btn" data-jt-action="ed-cancel">Cancel</button>' +
        '<button type="button" class="jt-btn jt-btn-primary" data-jt-action="ed-save">' + (edState.isFork ? 'Save as my copy' : 'Save template') + '</button>' +
      '</div>';
  }

  function editorSave() {
    var t = edState.tpl;
    if (!t) return;
    if (!String(t.name || '').trim()) { toast('Template needs a name', 'error'); return; }
    // Drop empty item rows (no code and no custom name)
    t.items = (t.items || []).filter(function (it) {
      if (it.custom) return String(it.custom.name || '').trim() !== '';
      return String(it.code || '').trim() !== '';
    });
    var JT = engine();
    if (!JT || typeof JT.saveCustom !== 'function') { toast('Template engine not ready', 'error'); return; }
    try {
      JT.saveCustom(t); // engine handles fork semantics (basedOn) for defaults
      toast(edState.isFork ? 'Saved as your custom copy' : 'Template saved', 'success');
      closeEditor();
      clearBandCache();
      reRender();
    } catch (e) {
      console.error('[job-templates-ui] saveCustom failed:', e);
      toast('Could not save template', 'error');
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // Flow actions
  // ══════════════════════════════════════════════════════════════════════

  // Both entries accept an optional { leadId } (lead-context flow — the
  // dashboard card-detail "Template Quote" action): the create step's lead
  // select pre-selects that lead. Plain calls (no opts) keep any leadId
  // already staged by openPicker.
  function openPreconfirm(opts) {
    if (opts && opts.leadId) state.leadId = String(opts.leadId);
    if (!state.selected.length) { toast('Select at least one template first', 'error'); return; }
    ensureChoices();
    seedMeasurements();
    state.step = 'preconfirm';
    showModal();
    paintModal();
  }

  function openPicker(opts) {
    state.host = 'modal';
    state.forScope = false;
    state.scopeCb = null;
    state.leadId = (opts && opts.leadId) ? String(opts.leadId) : null;
    state.step = 'library';
    showModal();
    paintModal();
  }

  // One-tap "Use this template" — the per-card primary CTA. Ensures the
  // template is in the selection (additive, never clobbers an in-progress
  // multi-select) and jumps straight into the configure step, from which
  // the rep previews and attributes the quote to a customer/lead. Honors
  // scope mode (openPickerForScope) via openPreconfirm's Insert primary.
  function quickUse(id) {
    if (!id) return;
    toggleSelect(id, true);
    openPreconfirm();
  }

  function openPickerForScope(cb) {
    state.host = 'modal';
    state.forScope = true;
    state.scopeCb = (typeof cb === 'function') ? cb : null;
    state.step = 'library';
    showModal();
    paintModal();
  }

  function goPreview() {
    state.step = 'preview';
    paintModal();
  }

  function doInsertIntoV2() {
    var JT = engine();
    if (!JT || typeof JT.insertIntoV2 !== 'function') { toast('Template engine not ready', 'error'); return; }
    try {
      var sel = buildSelection();
      var result = JT.insertIntoV2(sel, resolveOpts()) || {};
      // Surface added/skipped counts + engine warnings (truncated ~3 lines).
      var msgs = [];
      if (typeof result.added === 'number' || typeof result.skipped === 'number') {
        var added = Number(result.added) || 0;
        var skipped = Number(result.skipped) || 0;
        msgs.push(added + ' line' + (added === 1 ? '' : 's') + ' added' +
          (skipped ? ', ' + skipped + ' skipped (already in scope)' : ''));
      } else {
        msgs.push('Templates inserted into estimate scope');
      }
      var warns = Array.isArray(result.warnings) ? result.warnings : [];
      var room = Math.max(0, 3 - msgs.length);
      warns.slice(0, room).forEach(function (w) { msgs.push(String(w)); });
      if (warns.length > room) msgs.push('+' + (warns.length - room) + ' more warning' + (warns.length - room === 1 ? '' : 's'));
      toast(msgs.slice(0, 4).join('\n'), warns.length ? 'info' : 'success');
      var cb = state.scopeCb;
      closeModal();
      if (typeof cb === 'function') { try { cb(sel); } catch (e) { /* caller's problem */ } }
    } catch (e) {
      console.error('[job-templates-ui] insertIntoV2 failed:', e);
      toast('Could not insert into the estimate', 'error');
    }
  }

  function doCreateEstimate() {
    if (state.creating) return;
    var JT = engine();
    if (!JT || typeof JT.createEstimate !== 'function') { toast('Template engine not ready', 'error'); return; }
    var nameEl = document.getElementById('jtEstName');
    var leadEl = document.getElementById('jtLeadSel');
    var name = (nameEl && nameEl.value.trim()) || defaultEstimateName();
    var leadId = (leadEl && leadEl.value) ? leadEl.value : null;

    state.creating = true;
    var btn = document.querySelector('[data-jt-action="create-estimate"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }

    var opts = resolveOpts();
    opts.name = name;
    if (leadId) {
      opts.leadId = leadId;
      // Stamp owner/addr from the selected lead so the saved payload carries
      // the customer block (V2 prefillFromLead parity — reopen shows customer).
      var leads = Array.isArray(window._leads) ? window._leads : [];
      var lead = null;
      for (var li = 0; li < leads.length; li++) {
        if (leads[li] && String(leads[li].id) === String(leadId)) { lead = leads[li]; break; }
      }
      if (lead) {
        var ownerName = lead.name || lead.customerName ||
          ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim();
        if (ownerName) opts.owner = ownerName;
        var leadAddr = lead.address || lead.addr || '';
        if (leadAddr) opts.addr = leadAddr;
      }
    }

    Promise.resolve()
      .then(function () { return JT.createEstimate(buildSelection(), opts); })
      .then(function (res) {
        state.creating = false;
        state.createdId = (res && typeof res === 'object') ? (res.id || res.estimateId || null) : (res || null);
        // Capture the attributed lead now — #jtLeadSel is destroyed on the
        // transition to the success step, and "Send to customer" needs it to
        // mint a portal token whose leadId matches the estimate's leadId.
        state.createdLeadId = leadId || null;
        state.createdName = name;
        state.step = 'success';
        paintModal();
        toast('Estimate created', 'success');
      })
      .catch(function (e) {
        console.error('[job-templates-ui] createEstimate failed:', e);
        state.creating = false;
        toast('Could not create the estimate', 'error');
        paintModal(); // re-enable the button
      });
  }

  function openInV2() {
    var id = state.createdId;
    closeModal();
    if (!id) { toast('Estimate saved — open it from the Estimates view', 'info'); return; }
    // Canonical reopen entry (dashboard-widgets.js viewEstimate pattern):
    // window.openEstimateV2Builder({ estimateId }) — estimate-v2-ui.js open().
    if (typeof window.openEstimateV2Builder === 'function') {
      window.openEstimateV2Builder({ estimateId: id });
      return;
    }
    toast('Estimate saved — open it from the Estimates view', 'info');
  }

  // "Send to customer" — share a private, revocable link to THIS estimate's
  // customer view. Reuses the proven token path: CustomerPortal.mintUrl mints
  // a createPortalToken bound to the lead (loaded on both dashboard + customer
  // pages, unlike the customer-only shareEstimateViewLink), then we point it at
  // /pro/estimate-view.html?token=&estimateId= — the same viewer + server guard
  // (getEstimateForView) the customer page's 🔗 button uses. Web Share on mobile,
  // else clipboard, else prompt() so the rep always walks away with the link.
  async function sendToCustomer() {
    var estId = state.createdId;
    var leadId = state.createdLeadId;
    if (!estId) { toast('Estimate not saved yet', 'error'); return; }
    if (!leadId) { toast('Attach a customer to this estimate to send it', 'info'); return; }
    if (!window.CustomerPortal || typeof window.CustomerPortal.mintUrl !== 'function') {
      toast('Portal module not loaded — open the estimate and share from there', 'error');
      return;
    }
    var btn = document.querySelector('[data-jt-action="send-to-customer"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Creating link…'; }
    try {
      var portalUrl = await window.CustomerPortal.mintUrl(leadId);
      var token = '';
      try { token = new URL(portalUrl).searchParams.get('token') || ''; } catch (e) { token = ''; }
      if (!token) throw new Error('No token');
      var url = location.origin + '/pro/estimate-view.html?token=' +
        encodeURIComponent(token) + '&estimateId=' + encodeURIComponent(estId);

      var shared = false;
      if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || '')) {
        try { await navigator.share({ title: 'Your estimate', text: 'Here’s your estimate:', url: url }); shared = true; }
        catch (e) { /* user cancelled or unsupported — fall through to copy */ }
      }
      if (!shared && navigator.clipboard && navigator.clipboard.writeText) {
        try { await navigator.clipboard.writeText(url); shared = true; toast('Customer estimate link copied ✓', 'success'); }
        catch (e) { /* clipboard blocked — fall through to prompt */ }
      }
      if (!shared) { window.prompt('Copy this link to send to your customer:', url); }

      // Feed the existing share-tracking widgets (last-shared chip, freshness).
      if (window.PortalLinkHelpers && typeof window.PortalLinkHelpers.recordShare === 'function') {
        try { window.PortalLinkHelpers.recordShare(leadId, 'copy'); } catch (e) { /* non-fatal */ }
      }
    } catch (e) {
      console.error('[job-templates-ui] sendToCustomer failed:', e);
      toast('Could not create the customer link — try again', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '📤 Send to customer'; }
    }
  }

  function duplicateTemplate(id) {
    var JT = engine();
    if (!JT || typeof JT.duplicate !== 'function') { toast('Template engine not ready', 'error'); return; }
    try {
      JT.duplicate(id);
      toast('Template duplicated', 'success');
      clearBandCache();
      reRender();
    } catch (e) {
      console.error('[job-templates-ui] duplicate failed:', e);
      toast('Could not duplicate template', 'error');
    }
  }

  function deleteTemplate(id) {
    var t = getTpl(id);
    if (!t) return;
    if (!window.confirm('Delete "' + (t.name || id) + '"? This cannot be undone.')) return;
    var JT = engine();
    if (!JT || typeof JT.remove !== 'function') { toast('Template engine not ready', 'error'); return; }
    try {
      JT.remove(id);
      toggleSelect(id, false);
      delete state.choices[id];
      toast('Template deleted', 'success');
      clearBandCache();
      reRender();
    } catch (e) {
      console.error('[job-templates-ui] remove failed:', e);
      toast('Could not delete template', 'error');
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // Delegated events — bound ONCE at document scope behind a window flag
  // (product-library.js _NBD_PL_DELEGATE_BOUND pattern). ZERO inline
  // handlers anywhere; everything dispatches on data-jt-action.
  // ══════════════════════════════════════════════════════════════════════

  function onDelegatedClick(ev) {
    var t = ev.target.closest && ev.target.closest('[data-jt-action]');
    if (!t) return;
    // Inputs/selects are handled by the input/change delegate below.
    if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;

    var action = t.dataset.jtAction;
    var id = t.dataset.id;
    var idx = t.dataset.idx !== undefined ? Number(t.dataset.idx) : null;

    try {
      switch (action) {
        case 'rerender': reRender(); break;

        // ── Library ──
        case 'set-category': state.category = id || 'all'; reRender(); break;
        case 'set-jobtype': state.jobType = id || 'all'; reRender(); break;
        case 'clear-selection':
          state.selected = [];
          state.choices = {};
          reRender();
          break;
        // Recently-used compact card — toggles selection like the checkbox.
        case 'quick-select':
          if (id) { toggleSelect(id, !isSelected(id)); reRender(); }
          break;
        case 'open-preconfirm': openPreconfirm(); break;
        case 'quick-use': if (id) quickUse(id); break;
        case 'new-template': openEditor(null); break;
        case 'edit-template': if (id) openEditor(id); break;
        case 'duplicate-template': if (id) duplicateTemplate(id); break;
        case 'delete-template': if (id) deleteTemplate(id); break;

        // ── Modal nav ──
        case 'close-modal': closeModal(); break;
        case 'back-to-library': state.step = 'library'; paintModal(); break;
        case 'back-to-preconfirm': state.step = 'preconfirm'; paintModal(); break;
        case 'go-preview': goPreview(); break;
        case 'toggle-section':
          if (id) { state.collapsed[id] = !state.collapsed[id]; paintModal(); }
          break;
        case 'set-tier':
          if (id && TIERS.indexOf(id) !== -1) { state.tier = id; paintModal(); }
          break;
        case 'set-jobmode':
          if (id === 'cash' || id === 'insurance') { state.jobMode = id; paintModal(); }
          break;
        case 'toggle-meas': state.measOpen = !state.measOpen; paintModal(); break;

        // ── Terminal actions ──
        case 'insert-into-v2': doInsertIntoV2(); break;
        case 'create-estimate': doCreateEstimate(); break;
        case 'send-to-customer': sendToCustomer(); break;
        case 'open-in-v2': openInV2(); break;
        case 'done': closeModal(); break;

        // ── Editor ──
        case 'ed-add-item':
          if (edState.tpl) {
            edState.tpl.items = edState.tpl.items || [];
            edState.tpl.items.push({ code: '' });
            paintEditor();
          }
          break;
        case 'ed-remove-item':
          if (edState.tpl && idx !== null && edState.tpl.items && edState.tpl.items[idx] !== undefined) {
            edState.tpl.items.splice(idx, 1);
            paintEditor();
          }
          break;
        case 'ed-move-up':
        case 'ed-move-down':
          if (edState.tpl && idx !== null && edState.tpl.items) {
            var to = action === 'ed-move-up' ? idx - 1 : idx + 1;
            if (to >= 0 && to < edState.tpl.items.length) {
              var tmp = edState.tpl.items[idx];
              edState.tpl.items[idx] = edState.tpl.items[to];
              edState.tpl.items[to] = tmp;
              paintEditor();
            }
          }
          break;
        case 'ed-save': editorSave(); break;
        case 'ed-cancel': closeEditor(); break;
      }
    } catch (e) {
      console.error('[job-templates-ui] dispatch ' + action + ' failed:', e);
    }
  }

  function onDelegatedInput(ev) {
    var el = ev.target;
    if (!el || !el.dataset) return;

    try {
      // ── Measurements panel ──
      if (el.dataset.jtMeas !== undefined) {
        var mk = el.dataset.jtMeas;
        if (el.type === 'checkbox') state.measurements[mk] = !!el.checked;
        else {
          var mv = num(el.value);
          state.measurements[mk] = mv == null ? 0 : mv;
        }
        scheduleResolve();
        return;
      }

      // ── Editor: template-level fields (update working copy only —
      //    no re-render so typing keeps focus) ──
      if (el.dataset.jtEd !== undefined && edState.tpl) {
        var f = el.dataset.jtEd;
        if (f === 'tags') {
          edState.tpl.tags = String(el.value || '').split(',')
            .map(function (s) { return s.trim(); }).filter(Boolean);
        } else if (f === 'minJobCharge') {
          edState.tpl.minJobCharge = (el.value === '') ? null : (num(el.value) || 0);
        } else {
          edState.tpl[f] = el.value;
        }
        return;
      }

      // ── Editor: per-item fields ──
      if (el.dataset.jtEdi !== undefined && edState.tpl) {
        var ii = Number(el.dataset.idx);
        var item = edState.tpl.items && edState.tpl.items[ii];
        if (!item) return;
        var fld = el.dataset.jtEdi;
        if (fld === 'code') item.code = el.value.trim();
        else if (fld === 'customName') { item.custom = item.custom || {}; item.custom.name = el.value; }
        else if (fld === 'qty') {
          var qv = (el.value === '') ? null : num(el.value);
          if (item.custom) item.custom.qty = (qv == null ? 1 : qv);
          else if (qv == null) delete item.qty;
          else item.qty = qv;
        }
        else if (fld === 'optional') {
          if (el.checked) item.optional = true; else delete item.optional;
        }
        return;
      }

      var action = el.dataset.jtAction;
      if (!action) return;

      // ── Library search (re-render + restore caret, PL pattern) ──
      if (action === 'search') {
        state.search = el.value || '';
        reRender();
        var fresh = document.getElementById('jtSearch');
        if (fresh && fresh !== el) {
          fresh.focus();
          fresh.setSelectionRange(fresh.value.length, fresh.value.length);
        }
        return;
      }

      // ── Card multi-select ──
      if (action === 'toggle-select') {
        toggleSelect(el.dataset.id, !!el.checked);
        reRender();
        return;
      }

      // ── Preconfirm global county/tax jurisdiction ──
      if (action === 'set-county') {
        state.county = el.value || 'hamilton-oh';
        scheduleResolve();
        return;
      }

      // ── Preconfirm per-item edits ──
      var tid = el.dataset.tid;
      var idx = Number(el.dataset.idx);
      if (!tid || !state.choices[tid] || !state.choices[tid][idx]) return;
      var ch = state.choices[tid][idx];

      if (action === 'item-include') {
        ch.included = !!el.checked;
        var row = el.closest('.jt-row');
        if (row) row.classList.toggle('off', !el.checked);
        scheduleResolve();
      } else if (action === 'item-qty') {
        ch.qty = (el.value === '') ? null : num(el.value);
        scheduleResolve();
      } else if (action === 'item-price') {
        ch.unitPriceOverride = (el.value === '') ? null : num(el.value);
        scheduleResolve();
      } else if (action === 'item-brand') {
        ch.brandCode = el.value || null;
        scheduleResolve();
      }
    } catch (e) {
      console.error('[job-templates-ui] input dispatch failed:', e);
    }
  }

  if (!window._NBD_JT_DELEGATE_BOUND) {
    window._NBD_JT_DELEGATE_BOUND = true;
    document.addEventListener('click', onDelegatedClick);
    // One handler wired to both events: text/number fields fire 'input',
    // selects/checkboxes fire 'change'. The handler is idempotent, so the
    // occasional double fire (checkboxes emit both) is harmless.
    document.addEventListener('input', onDelegatedInput);
    document.addEventListener('change', onDelegatedInput);
  }

  // ══════════════════════════════════════════════════════════════════════
  // Public API
  // ══════════════════════════════════════════════════════════════════════

  window.JobTemplatesUI = {
    render: render,
    reRender: reRender,
    openPicker: openPicker,
    openPickerForScope: openPickerForScope,
    openPreconfirm: openPreconfirm,
    closeModal: closeModal
  };

  window.renderJobTemplatesLibrary = render;

})();
