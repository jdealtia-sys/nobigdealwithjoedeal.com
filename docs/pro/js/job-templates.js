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
  const USAGE_KEY = 'nbd_jt_usage_v1';
  // Usage rollup lives as ONE sibling doc in the same subcollection as the
  // template mirror docs. Hydration MUST skip this id when loading
  // templates (it is not a template) and route it to the usage map.
  const USAGE_DOC_ID = '_usage';
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
  // templates are merged into one estimate — merged down to ONE line whose
  // fixed qty is the MAX across occurrences (see resolveSelection).
  const SINGLETON_CODES = {
    'LAB MOB': 1, 'LAB DEMOB': 1, 'LAB CLN-M': 1, 'DSP HAUL': 1,
    'PRM RES-OH': 1, 'LAB PHOTO': 1, 'LAB WALK': 1
  };

  // Typical-house measurement context — the BASE of the resolveSelection
  // overlay: DEFAULT_MEASUREMENTS ← each selected template's (possibly
  // PARTIAL) measurements object, in selection order ← opts.measurements
  // last (user always wins). A template's partial object (e.g.
  // {deckReplacePct: 1}) is an overlay, NEVER the whole context — using it
  // wholesale zeroed every formula-driven line (rawSqft/eaveLf/... all 0).
  const DEFAULT_MEASUREMENTS = {
    rawSqft: 2000, pitch: 6, waste: 1.12, ridgeLf: 40, eaveLf: 120,
    rakeLf: 60, hipLf: 0, valleyLf: 20, wallLf: 0, pipes: 3, chimneys: 1,
    skylights: 0, stories: 1, tearOffLayers: 1, deckReplacePct: 0.15,
    cutUpRoof: false
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

  // Best-effort one-way Firestore mirror.
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
  // Usage tracking — {templateId: {n, last}} in localStorage,
  // mirrored as ONE doc users/{uid}/jobTemplates/_usage.
  // Stamped on every successful createEstimate / insertIntoV2;
  // surfaced through list() as useCount / lastUsedAt.
  // ═════════════════════════════════════════════════════════

  function loadUsage() {
    const ls = storage();
    if (!ls) return {};
    try {
      const stored = ls.getItem(USAGE_KEY);
      if (!stored) return {};
      const parsed = JSON.parse(stored);
      return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function persistUsage(usage) {
    const ls = storage();
    if (ls) {
      try { ls.setItem(USAGE_KEY, JSON.stringify(usage)); }
      catch (e) { console.error('[JobTemplates] usage save error:', e); }
    }
    mirrorUsage(usage);
  }

  // Best-effort one-way usage mirror — plain set (NOT merge): the local map
  // is the post-LWW merged truth, so overwriting keeps pruned entries dead.
  function mirrorUsage(usage) {
    if (!window._db || !window._user || !window._user.uid) return;
    if (typeof window.doc !== 'function') return;
    try {
      const ref = window.doc(window._db, 'users', window._user.uid, 'jobTemplates', USAGE_DOC_ID);
      const payload = { kind: 'usage', usage: usage, updatedAt: new Date().toISOString() };
      let p = null;
      if (typeof window.setDoc === 'function') {
        p = window.setDoc(ref, payload);
      } else if (typeof window.writeBatch === 'function') {
        const batch = window.writeBatch(window._db);
        batch.set(ref, payload);
        p = batch.commit();
      }
      if (p && typeof p.catch === 'function') {
        p.catch(e => console.error('[JobTemplates] usage mirror failed:', e));
      }
    } catch (e) {
      console.error('[JobTemplates] usage mirror failed:', e);
    }
  }

  // Stamp {n++, last: now} for each involved template. Never throws —
  // usage is telemetry and must not fail the estimate that triggered it.
  function markUsed(templateIds) {
    try {
      const ids = (Array.isArray(templateIds) ? templateIds : [templateIds]).filter(Boolean);
      if (!ids.length) return;
      const usage = loadUsage();
      const now = Date.now();
      ids.forEach(id => {
        const prev = usage[id];
        const n = prev && isFinite(Number(prev.n)) && Number(prev.n) > 0 ? Number(prev.n) : 0;
        usage[id] = { n: n + 1, last: now };
      });
      persistUsage(usage);
    } catch (e) {
      console.error('[JobTemplates] markUsed failed:', e);
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
    const usage = loadUsage();
    // SHALLOW COPY per entry: usage fields are a read-model overlay, never
    // mutated onto the shared default objects or the stored customs
    // (saveCustom strips them so persisted data stays canonical).
    const withUsage = (t) => {
      const u = t && t.id ? usage[t.id] : null;
      return Object.assign({}, t, {
        useCount: u && isFinite(Number(u.n)) && Number(u.n) > 0 ? Number(u.n) : 0,
        lastUsedAt: u && u.last != null && isFinite(Number(u.last)) ? Number(u.last) : null
      });
    };
    const customById = {};
    customs.forEach(t => { if (t && t.id) customById[t.id] = t; });
    const merged = [];
    const seen = {};
    defaults().forEach(t => {
      if (!t || !t.id) return;
      seen[t.id] = true;
      merged.push(withUsage(customById[t.id] || t));
    });
    customs.forEach(t => {
      if (t && t.id && !seen[t.id]) merged.push(withUsage(t));
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
    // Usage fields are a list()-time overlay (localStorage map) — never
    // persist them into the stored template (duplicate()/edit flows pass
    // list() copies that carry them).
    delete clean.useCount;
    delete clean.lastUsedAt;
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
    // Re-bridge immediately (last-write-wins) so edited custom-item costs/
    // names resolve at the NEW values in this session's catalogs.
    registerCustomItems(clean);
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
  // Best-effort cloud cleanup: the one-way mirror (persistCustoms) never
  // deletes, so without this the removed doc lives in Firestore forever and
  // any future sync/read path resurrects it. Guarded + never throws.
  function remove(id) {
    const customs = loadCustoms();
    const idx = customs.findIndex(t => t && t.id === id);
    if (idx === -1) return false;
    customs.splice(idx, 1);
    persistCustoms(customs);
    // Drop the usage entry too — but ONLY for template ids that vanish
    // entirely. Removing a shadow restores the default under the same id,
    // and its usage history still belongs to that template.
    try {
      if (!defaults().some(d => d && d.id === id)) {
        const usage = loadUsage();
        if (usage[id]) { delete usage[id]; persistUsage(usage); }
      }
    } catch (e) { /* usage cleanup is best-effort */ }
    try {
      if (window._db && window._user && window._user.uid
          && typeof window.deleteDoc === 'function' && typeof window.doc === 'function') {
        const p = window.deleteDoc(window.doc(window._db, 'users', window._user.uid, 'jobTemplates', id));
        if (p && typeof p.catch === 'function') {
          p.catch(e => console.error('[JobTemplates] Firestore delete failed:', e));
        }
      }
    } catch (e) {
      console.error('[JobTemplates] Firestore delete failed:', e);
    }
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

  // Deterministic synthetic code — keyed by TEMPLATE ID + ITEM INDEX (not
  // the item name) so (a) same-named custom items in different templates
  // never collide onto one catalog entry, and (b) the code derives
  // identically in every session, letting saved estimates resolve their
  // 'JT *' rows on reopen.
  function customCode(templateId, itemIndex) {
    return 'JT ' + slugify(templateId).toUpperCase() + '-' + itemIndex;
  }

  // Line-item shape resolveLineItem expects. Costs are CONTRACTOR COST —
  // explicit materialCost/laborCost win inside the engine, which then
  // stamps retail (+25% material markup, 10/10 OH&P at rollup).
  function customLineItem(custom, templateId, itemIndex) {
    return {
      code:         customCode(templateId, itemIndex),
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
    if (!tpl || !tpl.id || !Array.isArray(tpl.items)) return [];
    const registered = [];
    tpl.items.forEach((item, i) => {
      if (!item || !item.custom || !item.custom.name) return;
      const line = customLineItem(item.custom, tpl.id, i);
      const key = 'jt-' + slugify(tpl.id) + '-' + i;
      // V2 catalog bridge — LAST write wins: saveCustom edits (new costs,
      // renamed items) must take effect immediately; first-registration-wins
      // kept resolving inserts at stale pre-edit prices.
      if (window.EstimateBuilderV2 && window.EstimateBuilderV2.CATALOG) {
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
      if (xact && xact.byCode) {
        xact.byCode[line.code] = line;
      }
      registered.push(key);
    });
    return registered;
  }

  // Load-time bridge: register EVERY template's custom items (defaults +
  // stored customs) so 'JT *' codes inside previously-saved estimates
  // resolve on REOPEN in any session that loads this bundle — not just the
  // session that happened to run insertIntoV2. Re-run after saveCustom.
  function registerAllCustomItems() {
    list().forEach(registerCustomItems);
  }

  // ═════════════════════════════════════════════════════════
  // Cloud hydration — Firestore-first sync for custom templates.
  // ═════════════════════════════════════════════════════════

  function tplTime(t) {
    const v = t && t.updatedAt;
    if (!v) return 0;
    const ms = Date.parse(v);
    return isFinite(ms) ? ms : 0;
  }

  /**
   * hydrateFromCloud() — pull users/{uid}/jobTemplates ONCE at init (no
   * listeners) and merge into local storage:
   *   - custom templates: last-write-wins by updatedAt (ISO). Cloud must be
   *     STRICTLY newer to replace local; ties keep local (they're the same
   *     write echoed back). Cloud-only docs land locally (new device);
   *     local-side winners (offline edits / never-mirrored customs) are
   *     mirrored back up. Write-through stays on saveCustom/remove.
   *   - the _usage doc id is NEVER a template: it routes into the usage
   *     map with per-entry LWW by .last, and mirrors back up only when the
   *     local side had newer entries.
   *   - offline / logged out / SDK not ready: resolves false, local state
   *     untouched.
   * Custom-item JT codes re-register after the merge so estimates saved on
   * ANOTHER device resolve their 'JT *' rows in this session.
   * Returns Promise<boolean> (true = a cloud merge ran).
   */
  function hydrateFromCloud() {
    if (!window._db || !window._user || !window._user.uid) return Promise.resolve(false);
    if (typeof window.getDocs !== 'function' || typeof window.collection !== 'function') {
      return Promise.resolve(false);
    }
    let pull;
    try {
      pull = window.getDocs(window.collection(window._db, 'users', window._user.uid, 'jobTemplates'));
    } catch (e) {
      console.error('[JobTemplates] cloud hydrate failed:', e);
      return Promise.resolve(false);
    }
    return Promise.resolve(pull).then(snap => {
      const cloudTpls = [];
      let cloudUsage = null;
      const eachDoc = (d) => {
        if (!d) return;
        let data = null;
        try { data = typeof d.data === 'function' ? d.data() : null; } catch (e) { data = null; }
        if (!data || typeof data !== 'object') return;
        if (d.id === USAGE_DOC_ID) {
          // Usage rollup doc — route to the usage map, never the template list.
          cloudUsage = (data.usage && typeof data.usage === 'object') ? data.usage : {};
          return;
        }
        if (!data.id) data.id = d.id;
        cloudTpls.push(data);
      };
      if (snap && typeof snap.forEach === 'function') snap.forEach(eachDoc);
      else if (snap && Array.isArray(snap.docs)) snap.docs.forEach(eachDoc);

      // ── Custom templates: LWW by updatedAt ──
      const locals = loadCustoms();
      const byId = {};
      const order = [];
      locals.forEach(t => {
        if (t && t.id) { byId[t.id] = { tpl: t, src: 'local' }; order.push(t.id); }
      });
      const cloudTime = {};
      cloudTpls.forEach(t => {
        if (!t || !t.id) return;
        cloudTime[t.id] = tplTime(t);
        const cur = byId[t.id];
        if (!cur) { byId[t.id] = { tpl: t, src: 'cloud' }; order.push(t.id); return; }
        if (tplTime(t) > tplTime(cur.tpl)) byId[t.id] = { tpl: t, src: 'cloud' };
      });
      const merged = order.map(id => byId[id].tpl);
      // Local winners the cloud is missing (or holds stale) — push back up.
      const toUpload = merged.filter(t => byId[t.id].src === 'local'
        && (cloudTime[t.id] === undefined || tplTime(t) > cloudTime[t.id]));

      // Persist the merged view locally WITHOUT persistCustoms (its blanket
      // mirror would rewrite every cloud doc on every boot) …
      const ls = storage();
      if (ls) {
        try { ls.setItem(STORAGE_KEY, JSON.stringify({ _v: DATA_VERSION, items: merged })); }
        catch (e) { console.error('[JobTemplates] hydrate save error:', e); }
      }
      // … then mirror ONLY the local-side winners.
      if (toUpload.length) mirrorToFirestore(toUpload);

      // ── Usage map: per-entry LWW by .last ──
      if (cloudUsage) {
        const localUsage = loadUsage();
        const mergedUsage = {};
        let localNewer = false;
        const keys = {};
        Object.keys(localUsage).forEach(k => { keys[k] = 1; });
        Object.keys(cloudUsage).forEach(k => { keys[k] = 1; });
        Object.keys(keys).forEach(k => {
          const l = localUsage[k], c = cloudUsage[k];
          const lLast = l && isFinite(Number(l.last)) ? Number(l.last) : 0;
          const cLast = c && isFinite(Number(c.last)) ? Number(c.last) : 0;
          const win = (lLast >= cLast) ? (l || c) : c;
          if (!win) return;
          mergedUsage[k] = {
            n: isFinite(Number(win.n)) && Number(win.n) > 0 ? Number(win.n) : 0,
            last: isFinite(Number(win.last)) ? Number(win.last) : null
          };
          if (l && (lLast > cLast || !c)) localNewer = true;
        });
        if (ls) {
          try { ls.setItem(USAGE_KEY, JSON.stringify(mergedUsage)); }
          catch (e) { /* usage save is best-effort */ }
        }
        if (localNewer) mirrorUsage(mergedUsage);
      }

      // Re-bridge JT codes for every (possibly just-pulled) custom item so
      // saved estimates from other devices resolve on reopen HERE.
      registerAllCustomItems();
      // Repaint the library if the UI is live (guarded — the engine may
      // load standalone; reRender only repaints hosts that exist).
      if (window.JobTemplatesUI && typeof window.JobTemplatesUI.reRender === 'function') {
        try { window.JobTemplatesUI.reRender(); } catch (e) { /* UI's problem */ }
      }
      return true;
    }).catch(e => {
      // Offline / rules denial / transient — keep local state untouched.
      console.error('[JobTemplates] cloud hydrate failed:', e);
      return false;
    });
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
   * resolveSelection(selection, opts) — canonical UI↔engine contract:
   *   selection: [{ templateId, itemChoices?: { <itemIndex>: {
   *     include: boolean,              // default true
   *     qty: number|null,              // fixed-qty override (0 is valid and honored)
   *     brandCode: string|null,        // the PICKED brandOptions code
   *     unitPriceOverride: number|null // rep-typed CUSTOMER retail $/unit
   *   } } }]
   *   opts: { tier, jobMode, measurements, county }
   *
   * Measurements context = DEFAULT_MEASUREMENTS ← each selected template's
   * (possibly partial) measurements, in selection order ← opts.measurements
   * LAST (user always wins).
   * Singleton overhead codes merge to ONE line whose fixed qty is the MAX
   * across occurrences (formula-driven occurrence counts as qty 1).
   * unitPriceOverride: the typed value IS the customer's per-unit retail
   * (pre-OH&P, same plane as every other line's retailPerUnit) — the line
   * resolves with materialCost=0, laborCost=<typed> since labor passes
   * through markup untouched, so retailPerUnit === typed exactly; OH&P/tax
   * still apply on top. Cost-split on such a line reads cost==retail
   * (rep-negotiated) by design. Pushes 'Priced manually: <name>'.
   * county → engine tax map; defaults 'hamilton-oh' (estimate-v2-ui parity).
   * Returns {lines, totals, measurements, minJobCharge, county,
   *          sourceTemplates, warnings}.
   */
  function resolveSelection(selection, opts) {
    opts = opts || {};
    const sel = normalizeSelection(selection);
    const warnings = [];
    const lineItems = [];
    const sourceTemplates = [];
    const seenSingleton = {};   // code → { line, qty: effective fixed qty }
    const measurements = Object.assign({}, DEFAULT_MEASUREMENTS);
    let minJobCharge = null;

    const xact = window.NBD_XACT_CATALOG;

    sel.forEach(entry => {
      const tpl = get(entry.templateId);
      if (!tpl) {
        warnings.push('Unknown template: ' + entry.templateId);
        return;
      }
      sourceTemplates.push(tpl.id);

      // Overlay, never wholesale: a template's PARTIAL measurements object
      // (e.g. {deckReplacePct: 1}) merges over the typical-house defaults.
      if (tpl.measurements && typeof tpl.measurements === 'object') {
        Object.assign(measurements, tpl.measurements);
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
          const line = customLineItem(c, tpl.id, i);
          const qty = (choice && choice.qty != null) ? Number(choice.qty)
            : (c.qty != null ? Number(c.qty) : 1);
          line.qtyOverride = qty;
          if (choice && choice.unitPriceOverride != null) {
            // Override = customer per-unit retail. Priced as labor (no
            // material markup) so retailPerUnit lands exactly on it.
            line.materialCost = 0;
            line.laborCost = Number(choice.unitPriceOverride) || 0;
            warnings.push('Priced manually: ' + line.name);
          }
          lineItems.push(line);
          return;
        }

        if (!item.code) return;
        const code = pickBrandCode(item, choice);
        const rawQty = (choice && choice.qty != null) ? choice.qty
          : (item.qty != null ? item.qty : null);
        const fixedQty = (rawQty !== null && rawQty !== '' && isFinite(Number(rawQty)))
          ? Number(rawQty) : null;

        if (SINGLETON_CODES[code] && seenSingleton[code]) {
          // Once-per-job code collision: keep ONE line at the MAX fixed qty
          // (formula-driven occurrence counts as qty 1) — mirrors the
          // minJobCharge 'never lower the floor' rule. First-wins was an
          // order-dependent undercharge (DSP HAUL 1 vs 2).
          const eff = fixedQty != null ? fixedQty : 1;
          const prev = seenSingleton[code];
          if (eff > prev.qty) {
            prev.qty = eff;
            prev.line.qtyOverride = eff;
          }
          return;
        }

        const base = xact && typeof xact.find === 'function' ? xact.find(code) : null;
        if (!base) {
          warnings.push('Unknown catalog code: ' + code + ' (template ' + tpl.id + ')');
          return;
        }
        // Non-destructive — spread a fresh object so the catalog's
        // original stays untouched (matches getCurrentEstimate).
        const line = Object.assign({}, base);
        if (fixedQty != null) {
          line.qtyOverride = fixedQty;
        }
        if (choice && choice.unitPriceOverride != null) {
          // Same semantics as the custom-item path above.
          line.materialCost = 0;
          line.laborCost = Number(choice.unitPriceOverride) || 0;
          warnings.push('Priced manually: ' + (line.name || code));
        }
        if (SINGLETON_CODES[code]) {
          seenSingleton[code] = { line, qty: fixedQty != null ? fixedQty : 1 };
        }
        lineItems.push(line);
      });
    });

    if (opts.measurements && typeof opts.measurements === 'object') {
      Object.assign(measurements, opts.measurements);
    }

    const county = opts.county || 'hamilton-oh'; // estimate-v2-ui.js default parity

    if (!window.EstimateLogic || typeof window.EstimateLogic.resolveEstimate !== 'function') {
      warnings.push('EstimateLogic not loaded — cannot resolve');
      return { lines: [], totals: null, measurements, minJobCharge, county, sourceTemplates, warnings };
    }

    const settings = {
      tier: opts.tier || (sel[0] && sel[0].tier) || 'better',
      mode: opts.jobMode || 'cash',
      county: county
    };
    if (minJobCharge != null) settings.minJobCharge = minJobCharge;

    const totals = window.EstimateLogic.resolveEstimate(lineItems, measurements, settings);
    return {
      lines: totals.lines,
      totals,
      measurements,
      minJobCharge,
      county,
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
   *   meta:     {name, leadId, addr, owner, deposit, county?}
   * county persists (V2 _buildSavePayload parity — estimate-v2-ui.js:2120)
   * so reopen doesn't silently re-tax at a different rate; meta.owner/addr
   * pass through (blank default stays '').
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
      // Tax jurisdiction — must round-trip or the V2 reopen path re-taxes
      // at ITS default and the saved grandTotal shifts on first edit.
      county:          resolved.county || meta.county || 'hamilton-oh',
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
    // Stickiness: only AFTER the save resolves — a failed save must not
    // inflate useCount. markUsed never throws (usage is telemetry).
    markUsed(resolved.sourceTemplates);
    return id;
  }

  /**
   * insertIntoV2(selection, opts) — push the selection into the open V2
   * builder as additive scope entries. Custom items are bridged first so
   * their JT codes resolve in scope. Scope candidates GROUP by final code
   * (after brand swap) — the old blanket first-wins dedupe silently dropped
   * the second template's quantities:
   *   - singleton codes → one entry, fixed qty = MAX across occurrences
   *     (a formula-driven occurrence counts as qty 1);
   *   - non-singletons where ALL occurrences carry fixed qty → one entry,
   *     qty = SUM;
   *   - non-singleton collisions involving a formula-driven occurrence →
   *     one entry, NO qty override + a verify-qty warning.
   * unitPriceOverride never carries into the builder (warned).
   * Returns { entries, measurements, minJobCharge, warnings } — merged over
   * the addScopeEntries result (added/skipped) when the V2 UI is open.
   */
  function insertIntoV2(selection, opts) {
    opts = opts || {};
    const sel = normalizeSelection(selection);
    const warnings = [];
    const groups = {};        // code → [fixedQty|null, ...]
    const groupOrder = [];
    let measurements = null;
    let minJobCharge = null;
    let anyPriceOverride = false;

    const usedIds = [];
    sel.forEach(entry => {
      const tpl = get(entry.templateId);
      if (!tpl) return;
      usedIds.push(tpl.id);
      registerCustomItems(tpl);
      // Partial template measurements overlay in selection order; the
      // caller's opts.measurements merge LAST below. No defaults base here —
      // the open builder's own context must not be clobbered by ours.
      if (tpl.measurements && typeof tpl.measurements === 'object') {
        measurements = Object.assign(measurements || {}, tpl.measurements);
      }
      if (tpl.minJobCharge != null) {
        minJobCharge = Math.max(minJobCharge != null ? minJobCharge : 0, Number(tpl.minJobCharge));
      }
      (tpl.items || []).forEach((item, i) => {
        if (!item) return;
        const choice = itemChoice(entry.itemChoices, i);
        if (choice && choice.include === false) return;
        if (choice && choice.unitPriceOverride != null) anyPriceOverride = true;
        let code, qty;
        if (item.custom) {
          if (!item.custom.name) return;
          code = customCode(tpl.id, i);
          qty = (choice && choice.qty != null) ? choice.qty
            : (item.custom.qty != null ? item.custom.qty : 1);
        } else {
          if (!item.code) return;
          code = pickBrandCode(item, choice);
          qty = (choice && choice.qty != null) ? choice.qty
            : (item.qty != null ? item.qty : null);
        }
        const fixedQty = (qty !== null && qty !== '' && isFinite(Number(qty)))
          ? Number(qty) : null;
        if (!groups[code]) { groups[code] = []; groupOrder.push(code); }
        groups[code].push(fixedQty);
      });
    });

    const entries = groupOrder.map(code => {
      const occ = groups[code];
      const overrides = {};
      if (SINGLETON_CODES[code]) {
        // Once-per-job: MAX fixed qty wins (formula-driven counts as 1) —
        // same rule as resolveSelection, so preview === inserted scope.
        if (occ.some(q => q != null)) {
          overrides.qty = Math.max.apply(null, occ.map(q => (q != null ? q : 1)));
        }
      } else if (occ.every(q => q != null)) {
        // Every occurrence fixed → quantities SUM (matches the preview,
        // where each occurrence is its own line).
        overrides.qty = occ.reduce((s, q) => s + q, 0);
      } else if (occ.length > 1) {
        // Collision with a measurement-driven occurrence: can't sum a
        // formula — leave the builder's formula in charge and flag it.
        warnings.push(code + ': measurement-driven; verify qty after insert');
      }
      return { code, overrides };
    });

    if (anyPriceOverride) {
      warnings.push('price overrides do not carry into the builder — adjust there');
    }

    if (opts.measurements && typeof opts.measurements === 'object') {
      measurements = Object.assign(measurements || {}, opts.measurements);
    }

    // Stickiness: entries were built for these templates — stamp usage
    // whether the V2 UI consumes them or the caller gets the raw result.
    if (usedIds.length) markUsed(usedIds);

    if (window.EstimateV2UI && typeof window.EstimateV2UI.addScopeEntries === 'function') {
      const result = window.EstimateV2UI.addScopeEntries(entries, measurements, { minJobCharge }) || {};
      return Object.assign({}, result, {
        warnings: warnings.concat(Array.isArray(result.warnings) ? result.warnings : [])
      });
    }
    return { entries, measurements, minJobCharge, warnings };
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
    USAGE_KEY,
    USAGE_DOC_ID,
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
    registerAllCustomItems,
    hydrateFromCloud,
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

  // Load-time custom-item bridge (defaults + stored customs) — saved
  // estimates carry 'JT *' codes and must resolve on reopen in EVERY
  // session, not just the one that ran insertIntoV2. Best-effort: the
  // engine loads after the catalogs in the estimates bundle; if a catalog
  // is absent (standalone load) registerCustomItems guards internally.
  try {
    registerAllCustomItems();
  } catch (e) {
    console.error('[JobTemplates] custom-item bridge failed:', e);
  }

  // Firestore-first sync: one-shot cloud pull at init (fire-and-forget —
  // hydrateFromCloud guards _db/_user/getDocs itself and resolves false
  // when the SDK isn't ready, so a standalone/offline load is a no-op).
  try {
    hydrateFromCloud();
  } catch (e) {
    console.error('[JobTemplates] cloud hydrate failed:', e);
  }

  console.log('[JobTemplates] engine ready (' + defaults().length + ' default templates).');
})();
