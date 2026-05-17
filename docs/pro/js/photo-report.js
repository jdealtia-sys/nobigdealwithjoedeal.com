/**
 * NBD Pro — Photo Report Generator
 * One-click before/after report that pulls actual photos from a lead
 * and generates a beautiful branded PDF-ready HTML document.
 *
 * Exposes: window.generatePhotoReport(leadId)
 */

(function() {
  'use strict';

  // Brand strings only. All visual styling (color/type/space) comes
  // from nbd-brand.css — the same locked token set that drives the
  // homeowner portal, share-link pages, and any other customer-facing
  // surface. Photo system Phase 1 (2026-05-13): every customer artifact
  // must come out of one brand source so the PDF a homeowner gets emailed
  // looks like the portal they were already shown.
  const BRAND = {
    name: 'No Big Deal Home Solutions',
    phone: '(859) 420-7382',
    email: 'info@nobigdeal.pro',
    website: 'nobigdealwithjoedeal.com'
  };

  /**
   * Generate a before/after photo report for a lead.
   *
   * Phase 5 Output Engine: same dataset → two PDF styles.
   *   mode='homeowner' (default) — visual story, friendly captions,
   *     before/after pairs prominent. The one you email a homeowner.
   *   mode='adjuster'  — dense, label-forward, technical captions
   *     showing location + damageType + severity per photo. The one
   *     you drop into an insurance supplement.
   *
   * @param {string} leadId
   * @param {('homeowner'|'adjuster')} [mode='homeowner']
   */
  async function generatePhotoReport(leadId, mode) {
    leadId = leadId || window._customerId || window._cardDetailLeadId;
    if (!leadId || !window._user) {
      if (typeof showToast === 'function') showToast(!window._user ? 'Must be logged in' : 'No customer selected', 'error');
      return;
    }
    const reportMode = (mode === 'adjuster') ? 'adjuster' : 'homeowner';

    if (typeof showToast === 'function') showToast('Building ' + reportMode + ' photo report...', 'ok');

    try {
      // Get lead data
      const lead = (window._leads || []).find(l => l.id === leadId);
      if (!lead) throw new Error('Lead not found');

      // Load all photos for this lead
      let photos = [];
      try {
        const snap = await window.getDocs(window.query(
          window.collection(window.db, 'photos'),
          window.where('leadId', '==', leadId),
          window.where('userId', '==', window._user.uid)
        ));
        photos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch(e) { console.warn('Photo load failed:', e.message); }

      if (photos.length === 0) {
        if (typeof showToast === 'function') showToast('No photos found for this lead — upload some first', 'error');
        return;
      }

      // Sort photos by createdAt
      photos.sort((a, b) => {
        const aT = a.createdAt?.seconds || 0;
        const bT = b.createdAt?.seconds || 0;
        return aT - bT;
      });

      // Split into before/after using phase, tag, type, or category fields
      const getPhase = p => (p.phase || p.tag || p.type || p.category || '').toLowerCase();
      const beforePhotos = photos.filter(p => getPhase(p).includes('before'));
      const duringPhotos = photos.filter(p => getPhase(p).includes('during'));
      const afterPhotos = photos.filter(p => getPhase(p).includes('after'));

      let before, during, after;
      const hasPhases = beforePhotos.length > 0 || duringPhotos.length > 0 || afterPhotos.length > 0;
      if (hasPhases) {
        before = beforePhotos;
        during = duringPhotos;
        after = afterPhotos;
      } else {
        // No phase tags at all — show all as "Project Photos" (don't guess)
        before = photos;
        during = [];
        after = [];
      }

      const name = ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim() || 'Homeowner';
      const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

      // ─── D-4: try server-side Puppeteer render first ───
      // The new template uses the shared cover + design system, with
      // mode-aware sections (homeowner = visual story, adjuster =
      // evidence dossier). The legacy buildReportHTML stays as a
      // fallback for any case the server rejects.
      try {
        const ok = await _tryServerRenderPhotoReport({
          lead, name, before, during, after,
          mode: reportMode,
          allPhotos: photos,
        });
        if (ok) return;
      } catch (e) {
        console.warn('[photo-report] server render failed, falling back:', e && e.message || e);
      }

      const html = buildReportHTML(lead, name, before, during, after, now, hasPhases, reportMode);

      // Route through the Universal Document Viewer so the user
      // can Print or Download PDF via the action bar instead of
      // being dumped into a blank popup.
      if (window.NBDDocViewer && typeof window.NBDDocViewer.open === 'function') {
        const slug = (name || 'photos').replace(/[^A-Za-z0-9]+/g, '-').substring(0, 40);
        const modeTag = reportMode === 'adjuster' ? 'Adjuster' : 'Homeowner';
        window.NBDDocViewer.open({
          html: html,
          title: modeTag + ' Photo Report — ' + name,
          filename: 'NBD-' + modeTag + 'Report-' + slug + '-' + new Date().toISOString().split('T')[0] + '.pdf',
          onSave: async () => {
            if (typeof showToast === 'function') {
              showToast('\u2713 Photo report ready \u2014 Print or Download PDF from the action bar', 'ok');
            }
          }
        });
      } else {
        // Fallback: legacy popup
        const win = window.open('', '_blank');
        if (win) { win.document.write(html); win.document.close(); }
      }

      if (typeof showToast === 'function') showToast('Photo report generated — print to PDF', 'ok');
    } catch(e) {
      console.error('Photo report failed:', e);
      if (typeof showToast === 'function') showToast('Report generation failed: ' + e.message, 'error');
    }
  }

  // Tiny inline HTML escaper for interpolation safety. Captions and
  // location strings can legitimately carry quotes / ampersands.
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // Pick the right caption per photo + mode. Homeowner mode prefers the
  // rep's caption → AI caption → location label, all friendly. Adjuster
  // mode keeps it terse and label-driven (damage/severity surface on the
  // metadata row separately).
  function _captionFor(p, mode) {
    if (mode === 'adjuster') {
      return p.caption || (p.aiSuggestion && p.aiSuggestion.caption) || '';
    }
    return p.caption
      || (p.aiSuggestion && p.aiSuggestion.caption)
      || p.location
      || (p.inferredLocation && p.inferredLocation.label)
      || '';
  }
  // Damage label — humanize the snake_case enum the AI returns.
  function _damageLabel(p) {
    const v = p.damageType || (p.aiSuggestion && p.aiSuggestion.damageType) || '';
    if (!v) return '';
    return ({
      hail: 'Hail', wind: 'Wind', wear: 'Wear',
      granular_loss: 'Granular loss', leak: 'Leak',
      none: 'No damage', other: 'Other'
    })[v] || v;
  }
  function _severityLabel(p) {
    const v = p.severity || (p.aiSuggestion && p.aiSuggestion.severity) || '';
    if (!v) return '';
    return v[0].toUpperCase() + v.slice(1);
  }
  function _locationLabel(p) {
    return p.location || (p.inferredLocation && p.inferredLocation.label) || '';
  }
  // Emits the `src` (+ `srcset`+`sizes` when the variants pipeline has
  // run) for a photo tile. The report renders in a popped-out document
  // that doesn't have window.buildPhotoImgAttrs from customer.html, so
  // we replicate the same shape locally. Without this, the fallback
  // path drops the full-resolution iPhone original (3-5 MB) into every
  // tile — a 40-photo report could pull 200+ MB.
  function _imgAttrs(p, sizes) {
    sizes = sizes || '220px';
    const urls = p && p.urls;
    const primary = /^https?:/i.test(String(p && p.url || '')) ? p.url : '';
    const hasVariants = urls
      && /^https?:/i.test(String(urls.thumb || ''))
      && /^https?:/i.test(String(urls.med   || ''))
      && /^https?:/i.test(String(urls.full  || ''));
    if (!hasVariants) {
      return 'src="' + _esc(primary) + '"';
    }
    const srcset = _esc(urls.thumb) + ' 200w, ' +
                   _esc(urls.med)   + ' 600w, ' +
                   _esc(urls.full)  + ' 1600w';
    const fallback = _esc(urls.med || primary);
    return 'src="' + fallback + '" srcset="' + srcset + '" sizes="' + _esc(sizes) + '"';
  }

  // ─── Before/after pairing (§3.1) ───────────────────────────────────
  // Three tiers, applied in order. Each tier picks the BEFORE with the
  // EARLIEST createdAt (worst initial state) and the AFTER with the
  // LATEST (completed state) per key; photos consumed in one tier
  // aren't reused in later tiers; cap at 8 pairs total.
  //
  //   1. Location match. Normalizes by lowercasing and taking the first
  //      comma-segment so "North slope, ridge" pairs with "North Slope".
  //      Strongest signal — survives every tier above unchanged.
  //   2. Damage-type match. Fills remaining slots when reps tag what
  //      kind of damage but not where (or location strings don't match).
  //   3. Project-overview fallback. If <2 pairs after tiers 1+2 and any
  //      unused before/after exist anywhere, add ONE chronological pair
  //      (earliest before + latest after) labeled "Project overview".
  //      Untagged leads still get a usable report.
  function _buildPairs(allPhotos) {
    const list = Array.isArray(allPhotos) ? allPhotos : [];
    // Normalize a tag/location: lowercase, take first comma-segment,
    // collapse whitespace. Empty string when input lacks the field.
    const normKey = (s) => String(s || '').toLowerCase().split(',')[0].trim().replace(/\s+/g, ' ');
    const ms = (p) => (p && p.createdAt && (p.createdAt.toMillis ? p.createdAt.toMillis() : (p.createdAt.seconds ? p.createdAt.seconds * 1000 : 0))) || 0;
    const urlOf = (p) => (p && p.urls && (p.urls.lg || p.urls.med || p.urls.full)) || (p && p.url) || '';
    const idOf  = (p) => (p && (p.id || (p.urls && (p.urls.lg || p.urls.med || p.urls.full)) || p.url)) || '';
    const locOf = (p) => (p && (p.location || (p.inferredLocation && p.inferredLocation.label))) || '';
    const dmgOf = (p) => (p && (p.damageType || (p.aiSuggestion && p.aiSuggestion.damageType))) || '';

    const beforePhotos = list.filter(p => String(p && p.phase || '').toLowerCase() === 'before');
    const afterPhotos  = list.filter(p => String(p && p.phase || '').toLowerCase() === 'after');
    if (!beforePhotos.length || !afterPhotos.length) return [];

    // Build a key→best-photo map. `pickEarliest=true` for before tiles,
    // false (= latest wins) for after tiles. Photos already used by an
    // earlier tier are filtered out via `excludeIds`.
    function bestByKey(photos, keyFn, pickEarliest, excludeIds) {
      const map = new Map();
      for (const p of photos) {
        if (!p) continue;
        if (excludeIds && excludeIds.has(idOf(p))) continue;
        const k = keyFn(p);
        if (!k) continue;
        const m = ms(p);
        const cur = map.get(k);
        const better = !cur || (pickEarliest ? m < cur._ms : m > cur._ms);
        if (better) map.set(k, Object.assign({}, p, { _ms: m }));
      }
      return map;
    }

    const used = new Set();
    const out = [];
    function tryTier(beforeMap, afterMap, labelFor) {
      // Sort keys for deterministic order (alphabetical by key).
      const keys = Array.from(beforeMap.keys()).sort();
      for (const k of keys) {
        if (out.length >= 8) return;
        const b = beforeMap.get(k);
        const a = afterMap.get(k);
        if (!b || !a) continue;
        const bId = idOf(b), aId = idOf(a);
        if (used.has(bId) || used.has(aId)) continue;
        const bUrl = urlOf(b), aUrl = urlOf(a);
        if (!bUrl || !aUrl) continue;
        used.add(bId); used.add(aId);
        out.push({
          location: labelFor(k, b, a),
          before: { url: bUrl },
          after:  { url: aUrl },
        });
      }
    }

    // Tier 1: location.
    {
      const bMap = bestByKey(beforePhotos, (p) => normKey(locOf(p)), true,  used);
      const aMap = bestByKey(afterPhotos,  (p) => normKey(locOf(p)), false, used);
      tryTier(bMap, aMap, (k, b) => locOf(b) || k);
    }
    // Tier 2: damage type.
    if (out.length < 8) {
      const bMap = bestByKey(beforePhotos, (p) => normKey(dmgOf(p)), true,  used);
      const aMap = bestByKey(afterPhotos,  (p) => normKey(dmgOf(p)), false, used);
      tryTier(bMap, aMap, (k) => 'Damage: ' + k.replace(/_/g, ' '));
    }
    // Tier 3: chronological overview if we still have <2 pairs.
    if (out.length < 2) {
      const remBefore = beforePhotos.filter(p => !used.has(idOf(p)))
        .sort((x, y) => ms(x) - ms(y));
      const remAfter  = afterPhotos.filter(p => !used.has(idOf(p)))
        .sort((x, y) => ms(y) - ms(x));
      const b = remBefore[0], a = remAfter[0];
      if (b && a) {
        const bUrl = urlOf(b), aUrl = urlOf(a);
        if (bUrl && aUrl) {
          out.push({
            location: 'Project overview',
            before: { url: bUrl },
            after:  { url: aUrl },
          });
        }
      }
    }
    return out.slice(0, 8);
  }

  function buildReportHTML(lead, name, before, during, after, dateStr, hasPhases, mode) {
    const isAdjuster = mode === 'adjuster';

    // ── Adjuster tile: dense metadata grid under each thumbnail ──
    // Homeowner tile: just a clean caption (or nothing).
    const photoGrid = (photos) => photos.map((p, i) => {
      const cap = _captionFor(p, mode);
      const loc = _locationLabel(p);
      const dmg = _damageLabel(p);
      const sev = _severityLabel(p);

      if (isAdjuster) {
        const num = (i + 1).toString().padStart(2, '0');
        return (
          '<div class="photo-tile photo-tile-adj">' +
            '<img ' + _imgAttrs(p, '180px') + ' alt="Photo ' + num + '">' +
            '<div class="adj-meta">' +
              '<div class="adj-meta-num">#' + num + '</div>' +
              (loc ? '<div class="adj-meta-row"><span class="adj-meta-k">Location</span><span class="adj-meta-v">' + _esc(loc) + '</span></div>' : '') +
              (dmg ? '<div class="adj-meta-row"><span class="adj-meta-k">Damage</span><span class="adj-meta-v">' + _esc(dmg) + (sev ? ' · ' + _esc(sev) : '') + '</span></div>' : '') +
              (cap ? '<div class="adj-meta-cap">' + _esc(cap) + '</div>' : '') +
            '</div>' +
          '</div>'
        );
      }
      // Homeowner: just thumbnail + optional caption
      return (
        '<div class="photo-tile">' +
          '<img ' + _imgAttrs(p, '220px') + '>' +
          (cap ? '<div class="photo-tile-cap">' + _esc(cap) + '</div>' : '') +
        '</div>'
      );
    }).join('');

    // Adjuster-only summary block: counts + damage breakdown.
    const adjusterSummary = isAdjuster ? (() => {
      const all = before.concat(during).concat(after);
      const dmgCounts = {};
      const sevCounts = {};
      const locCounts = {};
      for (const p of all) {
        const d = _damageLabel(p); if (d) dmgCounts[d] = (dmgCounts[d] || 0) + 1;
        const s = _severityLabel(p); if (s) sevCounts[s] = (sevCounts[s] || 0) + 1;
        const l = _locationLabel(p); if (l) locCounts[l] = (locCounts[l] || 0) + 1;
      }
      const sortPairs = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]);
      const renderPair = ([k, v]) => '<span class="adj-tag"><strong>' + v + '</strong> ' + _esc(k) + '</span>';
      const dmgRow = sortPairs(dmgCounts).map(renderPair).join(' ');
      const sevRow = sortPairs(sevCounts).map(renderPair).join(' ');
      const locRow = sortPairs(locCounts).slice(0, 8).map(renderPair).join(' ');
      return (
        '<div class="adj-summary">' +
          '<div class="adj-summary-title">DAMAGE SUMMARY</div>' +
          '<div class="adj-summary-grid">' +
            '<div><div class="adj-summary-label">Total photos</div><div class="adj-summary-num">' + all.length + '</div></div>' +
            '<div><div class="adj-summary-label">Damage types</div><div class="adj-summary-tags">' + (dmgRow || '<span class="adj-tag-empty">—</span>') + '</div></div>' +
            '<div><div class="adj-summary-label">Severity mix</div><div class="adj-summary-tags">' + (sevRow || '<span class="adj-tag-empty">—</span>') + '</div></div>' +
            '<div><div class="adj-summary-label">Locations covered</div><div class="adj-summary-tags">' + (locRow || '<span class="adj-tag-empty">—</span>') + '</div></div>' +
          '</div>' +
        '</div>'
      );
    })() : '';

    return `<!DOCTYPE html>
<html data-nbd-brand="true">
<head>
<meta charset="UTF-8">
<title>Photo Report — ${name}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@600;700;800&display=swap">
<link rel="stylesheet" href="/pro/css/nbd-brand.css">
<style>
  /* Photo report layout — every color/type/space pulls from
     nbd-brand.css so the PDF a homeowner receives looks identical to
     the portal they were already shown. NO local color or font values. */
  @media print { body{margin:0;} .no-print{display:none!important;} @page{margin:0.5in;} }
  *{margin:0;padding:0;box-sizing:border-box;}
  body{
    font-family: var(--nbd-font-body);
    color: var(--nbd-ink);
    line-height: var(--nbd-leading-body);
    background: var(--nbd-bg);
  }
  .header{
    background: linear-gradient(135deg, var(--nbd-bg-tint), var(--nbd-bg));
    border-bottom: 1px solid var(--nbd-line);
    padding: var(--nbd-space-8) var(--nbd-space-8);
    text-align: center;
  }
  .header h1{
    font-family: var(--nbd-font-display);
    font-size: var(--nbd-text-2xl);
    font-weight: 800;
    color: var(--nbd-ink);
    letter-spacing: var(--nbd-tracking-wide);
    margin-bottom: var(--nbd-space-2);
  }
  .header .sub{
    color: var(--nbd-orange);
    font-size: var(--nbd-text-sm);
    letter-spacing: var(--nbd-tracking-wider);
    text-transform: uppercase;
    font-weight: 700;
  }
  .brand-bar{
    display:flex; align-items:center; justify-content:space-between;
    padding: var(--nbd-space-3) var(--nbd-space-8);
    background: var(--nbd-bg-elevated);
    border-bottom: 1px solid var(--nbd-line);
    font-size: var(--nbd-text-xs);
    color: var(--nbd-ink-muted);
    gap: var(--nbd-space-4);
  }
  .brand-bar-left{ display:flex; align-items:center; gap: var(--nbd-space-3); min-width:0; }
  .brand-bar-name{
    font-family: var(--nbd-font-display);
    font-weight: 800;
    color: var(--nbd-ink);
    text-transform: uppercase;
    letter-spacing: var(--nbd-tracking-wide);
  }
  .brand-logo{ height:36px; width:auto; display:block; flex-shrink:0; }
  .content{ max-width: 800px; margin: 0 auto; padding: var(--nbd-space-8); }
  .section{ margin-bottom: var(--nbd-space-8); }
  .section-label{
    display: inline-block;
    padding: 5px 14px;
    border-radius: var(--nbd-radius-pill);
    font-size: var(--nbd-text-xs);
    font-weight: 700;
    font-family: var(--nbd-font-body);
    letter-spacing: var(--nbd-tracking-wider);
    text-transform: uppercase;
    margin-bottom: var(--nbd-space-3);
    border: 1px solid transparent;
  }
  .before-label{ background: var(--nbd-danger-soft);  color: var(--nbd-danger);     border-color: rgba(220,38,38,.25); }
  .during-label{ background: var(--nbd-orange-soft);  color: var(--nbd-orange-ink); border-color: var(--nbd-orange-medium); }
  .after-label { background: var(--nbd-success-soft); color: var(--nbd-success);    border-color: rgba(22,163,74,.25); }
  .section-title{
    font-family: var(--nbd-font-display);
    font-size: var(--nbd-text-lg);
    font-weight: 700;
    color: var(--nbd-ink);
    margin-bottom: var(--nbd-space-4);
  }
  .photo-grid{
    display:grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: var(--nbd-space-3);
  }
  .photo-tile{
    background: var(--nbd-bg-elevated);
    border: 1px solid var(--nbd-line);
    border-radius: var(--nbd-radius-md);
    overflow: hidden;
    break-inside: avoid;
  }
  .photo-tile img{ width:100%; height:200px; object-fit:cover; display:block; background: var(--nbd-bg-sunken); }
  .photo-tile-cap{
    padding: var(--nbd-space-2) var(--nbd-space-3);
    font-size: var(--nbd-text-xs);
    color: var(--nbd-ink-muted);
    line-height: var(--nbd-leading-snug);
    text-align: center;
  }
  /* Adjuster-mode tile: same image area + a dense metadata strip
     below. Numbered for cross-reference in supplements. */
  .photo-tile-adj img{ height: 180px; }
  .adj-meta{
    padding: var(--nbd-space-2) var(--nbd-space-3);
    border-top: 1px solid var(--nbd-line-rule);
    background: var(--nbd-bg-sunken);
  }
  .adj-meta-num{
    font-family: var(--nbd-font-display); font-weight: 800;
    font-size: var(--nbd-text-xs); color: var(--nbd-orange);
    letter-spacing: var(--nbd-tracking-wider);
    margin-bottom: 4px;
  }
  .adj-meta-row{
    display: grid;
    grid-template-columns: 64px 1fr;
    gap: 6px;
    font-size: 11px;
    line-height: 1.35;
    margin-bottom: 2px;
  }
  .adj-meta-k{
    color: var(--nbd-ink-subtle);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--nbd-tracking-wide);
    font-size: 9.5px;
    align-self: center;
  }
  .adj-meta-v{ color: var(--nbd-ink); font-weight: 500; }
  .adj-meta-cap{
    font-size: 11px;
    color: var(--nbd-ink-muted);
    line-height: var(--nbd-leading-snug);
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px dashed var(--nbd-line-rule);
  }

  /* Adjuster summary block (top of report) */
  .adj-summary{
    background: var(--nbd-bg-elevated);
    border: 1px solid var(--nbd-line);
    border-radius: var(--nbd-radius-md);
    padding: var(--nbd-space-4) var(--nbd-space-5);
    margin-bottom: var(--nbd-space-6);
  }
  .adj-summary-title{
    font-family: var(--nbd-font-body);
    font-size: var(--nbd-text-xs);
    font-weight: 700;
    letter-spacing: var(--nbd-tracking-widest);
    text-transform: uppercase;
    color: var(--nbd-orange);
    margin-bottom: var(--nbd-space-3);
  }
  .adj-summary-grid{
    display: grid;
    grid-template-columns: auto 1fr 1fr 1fr;
    gap: var(--nbd-space-4);
    align-items: start;
  }
  @media (max-width: 720px) {
    .adj-summary-grid{ grid-template-columns: 1fr; gap: var(--nbd-space-3); }
  }
  .adj-summary-label{
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: var(--nbd-tracking-wider);
    text-transform: uppercase;
    color: var(--nbd-ink-subtle);
    margin-bottom: 4px;
  }
  .adj-summary-num{
    font-family: var(--nbd-font-display);
    font-size: var(--nbd-text-2xl);
    font-weight: 800;
    color: var(--nbd-orange);
    line-height: 1;
  }
  .adj-summary-tags{ display: flex; flex-wrap: wrap; gap: 6px; }
  .adj-tag{
    display: inline-flex; align-items: center; gap: 3px;
    padding: 2px 8px;
    border-radius: var(--nbd-radius-pill);
    background: var(--nbd-orange-soft);
    color: var(--nbd-orange-ink);
    font-size: 10.5px;
    font-weight: 600;
  }
  .adj-tag strong{ font-weight: 800; }
  .adj-tag-empty{ font-size: 11px; color: var(--nbd-ink-subtle); }

  /* Tighter grid for adjuster mode (3-up instead of fluid 220px+) */
  body[data-report-mode="adjuster"] .photo-grid{
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: var(--nbd-space-3);
  }
  body[data-report-mode="adjuster"] .header h1::after{
    content: ' — ADJUSTER COPY';
    font-size: 0.6em;
    color: var(--nbd-orange);
    letter-spacing: var(--nbd-tracking-wider);
    font-weight: 700;
  }
  .info-row{
    display:grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--nbd-space-3);
    margin-bottom: var(--nbd-space-6);
    font-size: var(--nbd-text-sm);
    color: var(--nbd-ink);
  }
  .info-row strong{ color: var(--nbd-ink); font-weight: 700; }
  .footer{
    text-align:center;
    padding: var(--nbd-space-6);
    border-top: 1px solid var(--nbd-line);
    margin-top: var(--nbd-space-10);
    font-size: var(--nbd-text-xs);
    color: var(--nbd-ink-muted);
  }
  .footer strong{ color: var(--nbd-ink); font-family: var(--nbd-font-display); letter-spacing: var(--nbd-tracking-wide); text-transform: uppercase; }
  .top-bar{
    position:fixed; top:0; left:0; right:0; height:52px;
    background: var(--nbd-bg-elevated);
    border-bottom: 1px solid var(--nbd-line);
    display:flex; align-items:center; justify-content:space-between;
    padding: 0 var(--nbd-space-5);
    z-index:1000;
    box-shadow: var(--nbd-shadow-sm);
    font-family: var(--nbd-font-body);
  }
  .top-bar-btn{
    padding: 8px 16px;
    background: var(--nbd-bg-sunken);
    border: 1px solid var(--nbd-line);
    border-radius: var(--nbd-radius-md);
    color: var(--nbd-ink);
    font-weight: 700;
    font-size: var(--nbd-text-sm);
    cursor: pointer;
  }
  .top-bar-btn-primary{
    background: var(--nbd-orange);
    border-color: var(--nbd-orange);
    color: var(--nbd-ink-on-orange);
  }
  .top-bar-btn-primary:hover{ background: var(--nbd-orange-deep); }
</style>
</head>
<body class="nbd-brand" data-report-mode="${isAdjuster ? 'adjuster' : 'homeowner'}">
<div class="no-print top-bar">
  <div style="display:flex;align-items:center;gap: 12px;">
    <button onclick="window.close()" class="top-bar-btn">&#8592; Close</button>
    <span style="color: var(--nbd-ink-muted); font-size: var(--nbd-text-sm);">${isAdjuster ? 'Adjuster Report' : 'Homeowner Report'}</span>
  </div>
  <button onclick="window.print()" class="top-bar-btn top-bar-btn-primary">Print / Save PDF</button>
</div>
<div style="height:52px;"></div>

<div class="header">
  <h1>${isAdjuster ? 'CLAIM PHOTO DOCUMENTATION' : 'PROJECT DOCUMENTATION'}</h1>
  <div class="sub">${isAdjuster ? 'Loss Documentation Package' : 'Before &amp; After Photo Report'}</div>
</div>
<div class="brand-bar">
  <div class="brand-bar-left">
    <img class="brand-logo" src="/assets/images/nbd-logo.png" alt="${BRAND.name}" />
    <span class="brand-bar-name">${BRAND.name}</span>
  </div>
  <span>${BRAND.phone} &nbsp;·&nbsp; ${BRAND.email}</span>
</div>

<div class="content">
  <div class="info-row">
    <div><strong>${isAdjuster ? 'Insured' : 'Property Owner'}:</strong> ${_esc(name)}</div>
    <div><strong>${isAdjuster ? 'Loss Type' : 'Project'}:</strong> ${_esc(lead.jobType || lead.damageType || 'Exterior')}</div>
    <div><strong>Address:</strong> ${_esc(lead.address || '')}</div>
    <div><strong>Date:</strong> ${_esc(dateStr)}</div>
    ${isAdjuster && lead.claimNumber ? '<div><strong>Claim #:</strong> ' + _esc(lead.claimNumber) + '</div>' : ''}
    ${isAdjuster && (lead.insCarrier || lead.insuranceCarrier) ? '<div><strong>Carrier:</strong> ' + _esc(lead.insCarrier || lead.insuranceCarrier) + '</div>' : ''}
  </div>

  ${adjusterSummary}

  ${before.length > 0 ? `<div class="section">
    <div class="section-label before-label">${hasPhases ? 'BEFORE' : 'PROJECT PHOTOS'}</div>
    <div class="section-title">${hasPhases ? 'Pre-Project Condition' : 'Documentation'} (${before.length} photos)</div>
    <div class="photo-grid">${photoGrid(before)}</div>
  </div>` : ''}

  ${lead.scopeOfWork ? `
  <div class="section">
    <div class="section-title">Work Performed</div>
    <p style="font-size: var(--nbd-text-sm); color: var(--nbd-ink); white-space: pre-line;">${_esc(lead.scopeOfWork)}</p>
  </div>` : ''}

  ${during.length > 0 ? `<div class="section">
    <div class="section-label during-label">DURING</div>
    <div class="section-title">Work In Progress (${during.length} photos)</div>
    <div class="photo-grid">${photoGrid(during)}</div>
  </div>` : ''}

  ${after.length > 0 ? `<div class="section">
    <div class="section-label after-label">AFTER</div>
    <div class="section-title">Completed Project (${after.length} photos)</div>
    <div class="photo-grid">${photoGrid(after)}</div>
  </div>` : ''}

  <div class="footer">
    <strong>${BRAND.name}</strong><br>
    ${BRAND.phone} &nbsp;·&nbsp; ${BRAND.email} &nbsp;·&nbsp; ${BRAND.website}<br>
    <em>We Put Our Name On It</em>
  </div>
</div>
</body>
</html>`;
  }

  // ═════════════════════════════════════════════════════════
  // D-4: Server-side photo-report render
  // ═════════════════════════════════════════════════════════
  async function _tryServerRenderPhotoReport(opts) {
    if (!window._functions || !window._httpsCallable) {
      const mod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
      window._functions = mod.getFunctions();
      window._httpsCallable = mod.httpsCallable;
    }
    const { lead, name, before, during, after, mode, allPhotos } = opts;

    if (typeof showToast === 'function') showToast('Rendering photo report…', 'ok');

    // Shape each phase into the template's photo cell payload.
    const shapePhoto = (p) => {
      const url = (p && p.urls && (p.urls.lg || p.urls.md)) || (p && p.url) || '';
      if (!url) return null;
      return {
        url,
        caption:  _captionFor(p, mode) || p.aiCaption || '',
        location: p.location || '',
        damageType: p.damageType || '',
        severity: p.severity || '',
      };
    };
    const shape = (arr) => (arr || []).map(shapePhoto).filter(Boolean);

    // Auto-pair before/after — three-tier heuristic (§3.1).
    // Tier 1: normalized location → Tier 2: damageType → Tier 3:
    // chronological "Project overview" when <2 pairs found. See
    // _buildPairs at the top of this module for the full picker logic.
    const pairs = _buildPairs(allPhotos);

    const beforeShaped = shape(before);
    const duringShaped = shape(during);
    const afterShaped  = shape(after);

    // Cover-page payload (shared partial)
    const preparedFor = {
      name,
      address:     lead.address || '',
      customerId:  lead.customerId || null,
      projectLine: lead.damageType ? lead.damageType : null,
    };
    const preparedBy = {
      name:  (window._user && window._user.displayName) || 'Joe Deal',
      role:  (mode === 'adjuster' ? 'Documentation · ' : 'Project Owner · ') + 'No Big Deal Home Solutions',
      phone: '(859) 420-7382',
      email: 'jd@nobigdealwithjoedeal.com',
    };
    const reportNumber = (mode === 'adjuster' ? 'ADJ-' : 'PHO-') + Date.now().toString().slice(-6);
    const projectMeta = [
      { label: 'Report Date', value: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) },
      { label: 'Total Photos', value: String((allPhotos || []).length) },
      { label: 'Report No.', value: reportNumber },
    ];

    const summary = mode === 'adjuster'
      ? {
          headline: 'Photographic evidence dossier',
          body: 'Documentation of property condition before, during, and after work performed by No Big Deal Home Solutions. Photos tagged with location, damage type, and severity where applicable.',
        }
      : {
          headline: 'The story of your project, in pictures',
          body: 'A walkthrough of how the property looked before we started, the work as it happened, and the finished result.',
        };

    const stats = [
      { label: 'Before', value: String(beforeShaped.length), sub: 'pre-work' },
      { label: 'During', value: String(duringShaped.length), sub: 'in progress' },
      { label: 'After',  value: String(afterShaped.length),  sub: 'completed' },
    ];

    const payload = {
      // Cover (shared partial)
      preparedFor,
      preparedBy,
      projectMeta,
      coverEyebrow: (mode === 'adjuster' ? 'Photo Report · Adjuster Dossier' : 'Photo Report · Project Story'),
      coverTagline: (mode === 'adjuster'
        ? 'Documented.<br>Defensible.'
        : 'The work,<br>in pictures.'),
      coverSub: (mode === 'adjuster'
        ? 'Comprehensive photographic record of property condition prior to, during, and following the scope of work performed.'
        : 'A visual walkthrough of your roof — what we found, what we did, and what it looks like now.'),
      coverPhoto: (beforeShaped[0] && beforeShaped[0].url) || (afterShaped[0] && afterShaped[0].url) || null,
      coverCaption: (beforeShaped[0] && beforeShaped[0].location) || null,
      // Body
      summary,
      stats,
      mode,
      pairs,
      before: beforeShaped,
      during: duringShaped,
      after:  afterShaped,
    };

    const fn = window._httpsCallable(window._functions, 'renderPdf');
    const slug = (name || 'photos').replace(/[^A-Za-z0-9]+/g, '-').substring(0, 40);
    const modeTag = mode === 'adjuster' ? 'Adjuster' : 'Homeowner';
    const filename = 'NBD-' + modeTag + 'Photos-' + slug + '-' + new Date().toISOString().split('T')[0] + '.pdf';

    const r = await fn({ template: 'photoReport', payload, filename });
    const data = r && r.data;
    if (!data || !data.ok || !data.url) throw new Error('Render returned no URL');

    if (window.NBDDocViewer && typeof window.NBDDocViewer.open === 'function') {
      window.NBDDocViewer.open({
        url: data.url,
        title: modeTag + ' Photo Report — ' + name,
        filename: data.filename || filename,
      });
    } else {
      window.open(data.url, '_blank', 'noopener');
    }
    const ms = data.timing && data.timing.totalMs;
    if (typeof showToast === 'function') {
      showToast(ms ? '✓ Photo report rendered in ' + ms + 'ms' : '✓ Photo report rendered', 'ok');
    }
    return true;
  }

  window.generatePhotoReport = generatePhotoReport;
  // Exposed for smoke + future Playwright coverage. Pure function —
  // takes an array of photo docs, returns up to 8 {location, before,
  // after} pair objects. No DOM, no Firebase, safe to unit-test.
  window._buildPhotoReportPairs = _buildPairs;

})();
