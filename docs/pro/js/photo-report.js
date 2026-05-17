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
    // Tier 3: chronological overview ONLY when tiers 1+2 found nothing.
    // Original design said `< 2` but that misbehaved: a lead with one
    // location pair AND leftover same-location photos would get a
    // bonus "Project overview" pair pulled from those leftovers,
    // mislabeling them. §3.2 unit-test caught it. With `=== 0` this
    // tier fires only for genuinely untagged leads (its real purpose).
    if (out.length === 0) {
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
    const allPhotos  = before.concat(during).concat(after);

    // ── Photo tile rendering ─────────────────────────────────────────
    // Homeowner: 4/3 aspect, caption below if available, no metadata
    //   clutter — visual story format.
    // Adjuster:  numbered tile with location + damage·severity + caption,
    //   1/1 aspect for a denser dossier grid.
    // Both modes lock aspect-ratio so phone/drone/closeup photos land
    // uniform — the old report rendered native aspect ratios and looked
    // like a collage.
    const photoGrid = (photos) => photos.map((p, i) => {
      const cap = _captionFor(p, mode);
      const loc = _locationLabel(p);
      const dmg = _damageLabel(p);
      const sev = _severityLabel(p);

      if (isAdjuster) {
        const num = (i + 1).toString().padStart(2, '0');
        return (
          '<div class="ph-tile ph-tile-adj">' +
            '<div class="ph-img"><img ' + _imgAttrs(p, '200px') + ' alt="Photo ' + num + '"></div>' +
            '<div class="ph-meta">' +
              '<div class="ph-num">#' + num + '</div>' +
              (loc ? '<div class="ph-row"><span class="ph-k">Location</span><span class="ph-v">' + _esc(loc) + '</span></div>' : '') +
              (dmg ? '<div class="ph-row"><span class="ph-k">Damage</span><span class="ph-v">' + _esc(dmg) + (sev ? ' · ' + _esc(sev) : '') + '</span></div>' : '') +
              (cap ? '<div class="ph-cap">' + _esc(cap) + '</div>' : '') +
            '</div>' +
          '</div>'
        );
      }
      return (
        '<div class="ph-tile">' +
          '<div class="ph-img"><img ' + _imgAttrs(p, '260px') + ' alt=""></div>' +
          (cap ? '<div class="ph-cap-ho">' + _esc(cap) + '</div>' : '') +
        '</div>'
      );
    }).join('');

    // ── Stats strip (always shown when there's at least 1 photo) ─────
    // Phase counts + AI-severity totals when classifier data exists.
    // This replaces the old "DAMAGE SUMMARY" block in adjuster mode and
    // adds it to homeowner mode too (with friendlier labels).
    const sevCounts = { minor: 0, moderate: 0, severe: 0 };
    let damagedCount = 0;
    for (const p of allPhotos) {
      const s = (p.severity || (p.aiSuggestion && p.aiSuggestion.severity) || '').toLowerCase();
      if (sevCounts.hasOwnProperty(s)) { sevCounts[s]++; damagedCount++; }
    }
    const statCell = (n, label, sub) =>
      '<div class="stat">'
      + '<div class="stat-num">' + n + '</div>'
      + '<div class="stat-label">' + label + '</div>'
      + (sub ? '<div class="stat-sub">' + sub + '</div>' : '')
      + '</div>';
    const stats =
      '<div class="stat-grid">'
      + statCell(allPhotos.length, 'Total Photos', '')
      + (before.length ? statCell(before.length, 'Before', isAdjuster ? 'pre-loss' : 'pre-project') : '')
      + (during.length ? statCell(during.length, 'During', 'in progress') : '')
      + (after.length  ? statCell(after.length,  'After',  'completed') : '')
      + (damagedCount  ? statCell(damagedCount,  'With damage', sevCounts.severe ? sevCounts.severe + ' severe' : '') : '')
      + '</div>';

    // ── Adjuster-only damage breakdown ───────────────────────────────
    // Shown ONLY when there's real data. The old report rendered four
    // labeled cells with em-dash placeholders when fields were empty —
    // that looked like the report itself was broken. Now: render nothing
    // unless at least one of dmg/sev/loc has counts.
    let adjusterSummary = '';
    if (isAdjuster) {
      const dmgCounts = {};
      const locCounts = {};
      for (const p of allPhotos) {
        const d = _damageLabel(p); if (d) dmgCounts[d] = (dmgCounts[d] || 0) + 1;
        const l = _locationLabel(p); if (l) locCounts[l] = (locCounts[l] || 0) + 1;
      }
      const sortPairs = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]);
      const renderTag = ([k, v]) => '<span class="dmg-tag"><strong>' + v + '</strong> ' + _esc(k) + '</span>';
      const dmgEntries = sortPairs(dmgCounts);
      const sevEntries = Object.entries(sevCounts).filter(([, v]) => v > 0);
      const locEntries = sortPairs(locCounts);
      const hasAnyData = dmgEntries.length || sevEntries.length || locEntries.length;
      if (hasAnyData) {
        const rows = [];
        if (dmgEntries.length) rows.push('<div class="dmg-row"><div class="dmg-row-label">Damage types</div><div class="dmg-row-tags">' + dmgEntries.map(renderTag).join('') + '</div></div>');
        if (sevEntries.length) rows.push('<div class="dmg-row"><div class="dmg-row-label">Severity mix</div><div class="dmg-row-tags">' + sevEntries.map(([k,v]) => '<span class="dmg-tag dmg-sev-' + k + '"><strong>' + v + '</strong> ' + k + '</span>').join('') + '</div></div>');
        if (locEntries.length) rows.push('<div class="dmg-row"><div class="dmg-row-label">Locations covered</div><div class="dmg-row-tags">' + locEntries.slice(0, 10).map(renderTag).join('') + '</div></div>');
        adjusterSummary =
          '<div class="dmg-summary">'
          + '<div class="dmg-summary-title">Damage Summary</div>'
          + rows.join('')
          + '</div>';
      }
    }

    // ── Before / After pair section (homeowner mode — visual story) ──
    // The pairs come from _buildPairs which we run on the full photo set
    // earlier in the server-render code path. For the standalone fallback
    // we re-run it here so the homeowner version gets the showcase grid.
    let pairsSection = '';
    if (!isAdjuster) {
      const pairs = _buildPairs(allPhotos);
      if (pairs.length) {
        const items = pairs.map((pair) => (
          '<div class="ba-pair">'
          + '<div class="ba-cell"><div class="ba-frame"><img src="' + _esc(pair.before.url) + '" alt="Before"><div class="ba-stamp">Before</div></div></div>'
          + '<div class="ba-cell"><div class="ba-frame"><img src="' + _esc(pair.after.url)  + '" alt="After"><div class="ba-stamp ba-after">After</div></div></div>'
          + '<div class="ba-loc">' + _esc(pair.location) + '</div>'
          + '</div>'
        )).join('');
        pairsSection =
          '<div class="section avoid-break">'
          + '<div class="section-eyebrow">The Transformation</div>'
          + '<div class="section-title">Before &amp; After</div>'
          + '<p class="section-lead">Side-by-side comparisons of the same locations at start and finish.</p>'
          + '<div class="ba-grid">' + items + '</div>'
          + '</div>';
      }
    }

    // Cover photo for the homeowner hero — first BEFORE photo that
    // has a usable URL. Adjuster mode skips the hero to keep dense.
    const heroPhoto = !isAdjuster ? before.find(p => (p.urls && (p.urls.full || p.urls.med || p.urls.lg)) || p.url) : null;
    const heroUrl = heroPhoto ? ((heroPhoto.urls && (heroPhoto.urls.full || heroPhoto.urls.lg || heroPhoto.urls.med)) || heroPhoto.url) : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${isAdjuster ? 'Adjuster' : 'Homeowner'} Photo Report — ${_esc(name)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@600;700;800&display=swap">
</head>
<body data-report-mode="${isAdjuster ? 'adjuster' : 'homeowner'}">
<style>
  /* All colors / typography / spacing inlined — no external token
     dependencies. The fallback renders in a doc-viewer iframe that
     historically failed to load nbd-brand.css; the report then
     collapsed visually. This is a print-friendly light theme with
     explicit hex values, identical in every render context. */
  *{margin:0;padding:0;box-sizing:border-box;}
  html,body{ background:#ffffff; }
  body{
    font-family: 'Barlow', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    color:#111827;
    line-height:1.55;
    -webkit-font-smoothing: antialiased;
  }
  h1,h2,h3,h4{ font-family:'Barlow Condensed','Barlow',sans-serif; font-weight:800; letter-spacing:.02em; line-height:1.15; color:#111827; }
  @media print{
    .no-print{ display:none!important; }
    body{ margin:0; }
    @page{ margin:0.5in; }
    .section,.ba-pair,.ph-tile{ break-inside: avoid; }
    .page-break{ page-break-before: always; }
  }

  /* ── No-print top bar (Close / Print) ────────────────────────── */
  .top-bar{
    position:fixed; top:0; left:0; right:0; height:52px;
    background:#ffffff; border-bottom:1px solid #e5e7eb;
    display:flex; align-items:center; justify-content:space-between;
    padding:0 20px; z-index:1000;
    box-shadow:0 1px 3px rgba(0,0,0,.06);
  }
  .top-bar-btn{
    padding:8px 16px; background:#f3f4f6;
    border:1px solid #e5e7eb; border-radius:8px;
    color:#111827; font-weight:700; font-size:13px;
    cursor:pointer; font-family:inherit;
  }
  .top-bar-btn-primary{ background:#e8720c; border-color:#e8720c; color:#ffffff; }
  .top-bar-btn-primary:hover{ background:#c8541a; }
  .top-bar-mode{ color:#6b7280; font-size:13px; }

  /* ── Hero / cover band ───────────────────────────────────────── */
  .hero{
    position:relative;
    background:linear-gradient(135deg,#fffaf4 0%,#ffffff 60%);
    border-bottom:1px solid #e5e7eb;
    padding:48px 56px 36px;
    overflow:hidden;
  }
  .hero-eyebrow{
    font-family:'Barlow Condensed',sans-serif;
    font-size:11px; font-weight:700;
    letter-spacing:.18em; text-transform:uppercase;
    color:#e8720c; margin-bottom:10px;
  }
  .hero-title{
    font-size:42px; font-weight:800;
    color:#111827; letter-spacing:.01em;
    margin-bottom:8px;
  }
  .hero-sub{
    font-size:14px; color:#6b7280;
    max-width:560px; line-height:1.5;
  }
  .hero-photo{
    position:absolute; right:-40px; top:50%;
    transform:translateY(-50%);
    width:340px; height:220px;
    border-radius:14px; overflow:hidden;
    box-shadow:0 10px 30px rgba(0,0,0,.18);
    border:6px solid #ffffff;
  }
  .hero-photo img{ width:100%; height:100%; object-fit:cover; display:block; }
  @media (max-width:820px){ .hero-photo{ display:none; } .hero{ padding:36px 24px 28px; } .hero-title{ font-size:30px; } }

  /* ── Brand band ──────────────────────────────────────────────── */
  .brand-bar{
    display:flex; align-items:center; justify-content:space-between;
    padding:14px 56px; background:#111827; color:#f9fafb;
    font-size:12px; gap:16px;
  }
  .brand-bar-left{ display:flex; align-items:center; gap:14px; }
  .brand-logo{ height:32px; width:auto; display:block; }
  .brand-bar-name{
    font-family:'Barlow Condensed',sans-serif;
    font-weight:800; color:#ffffff;
    text-transform:uppercase; letter-spacing:.06em; font-size:14px;
  }
  .brand-bar-contact{ color:#d1d5db; font-size:12px; }
  @media (max-width:600px){ .brand-bar{ padding:14px 24px; flex-direction:column; gap:8px; text-align:center; } }

  /* ── Content shell ───────────────────────────────────────────── */
  .content{ max-width:920px; margin:0 auto; padding:32px 56px 64px; }
  @media (max-width:820px){ .content{ padding:24px 20px 48px; } }

  /* ── Property info card ──────────────────────────────────────── */
  .info-card{
    border:1px solid #e5e7eb; border-radius:12px;
    padding:20px 24px; margin-bottom:32px;
    background:#fafafa;
    display:grid; grid-template-columns:1fr 1fr; gap:14px 32px;
    font-size:13.5px;
  }
  .info-card .info-k{
    font-family:'Barlow Condensed',sans-serif;
    font-size:10px; font-weight:700;
    letter-spacing:.14em; text-transform:uppercase;
    color:#9ca3af; margin-bottom:2px;
  }
  .info-card .info-v{ color:#111827; font-weight:600; }
  @media (max-width:600px){ .info-card{ grid-template-columns:1fr; padding:16px 18px; } }

  /* ── Stats strip ─────────────────────────────────────────────── */
  .stat-grid{
    display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr));
    gap:12px; margin-bottom:32px;
  }
  .stat{
    border:1px solid #e5e7eb; border-radius:10px;
    background:#ffffff; padding:14px 16px; text-align:left;
  }
  .stat-num{
    font-family:'Barlow Condensed',sans-serif;
    font-size:32px; font-weight:800;
    color:#e8720c; line-height:1;
  }
  .stat-label{
    font-family:'Barlow Condensed',sans-serif;
    font-size:11px; font-weight:700;
    letter-spacing:.12em; text-transform:uppercase;
    color:#374151; margin-top:8px;
  }
  .stat-sub{ font-size:11px; color:#9ca3af; margin-top:2px; }

  /* ── Adjuster Damage Summary (only when has-data) ───────────── */
  .dmg-summary{
    border:1px solid #e5e7eb; border-radius:12px;
    background:#fffaf4; padding:18px 22px; margin-bottom:32px;
  }
  .dmg-summary-title{
    font-family:'Barlow Condensed',sans-serif;
    font-size:11px; font-weight:700;
    letter-spacing:.16em; text-transform:uppercase;
    color:#c8541a; margin-bottom:12px;
  }
  .dmg-row{ display:flex; align-items:flex-start; gap:14px; margin-bottom:10px; flex-wrap:wrap; }
  .dmg-row:last-child{ margin-bottom:0; }
  .dmg-row-label{
    flex-shrink:0; width:130px;
    font-family:'Barlow Condensed',sans-serif;
    font-size:11px; font-weight:700;
    letter-spacing:.1em; text-transform:uppercase;
    color:#6b7280; padding-top:3px;
  }
  .dmg-row-tags{ flex:1; display:flex; flex-wrap:wrap; gap:6px; }
  .dmg-tag{
    display:inline-flex; align-items:center; gap:4px;
    padding:3px 10px; border-radius:999px;
    background:#ffe8d5; color:#c8541a;
    font-size:11px; font-weight:600;
  }
  .dmg-tag strong{ font-weight:800; }
  .dmg-sev-minor   { background:#fef9c3; color:#854d0e; }
  .dmg-sev-moderate{ background:#ffedd5; color:#9a3412; }
  .dmg-sev-severe  { background:#fee2e2; color:#991b1b; }

  /* ── Section headers ─────────────────────────────────────────── */
  .section{ margin-bottom:40px; }
  .section-eyebrow{
    font-family:'Barlow Condensed',sans-serif;
    font-size:11px; font-weight:700;
    letter-spacing:.16em; text-transform:uppercase;
    color:#e8720c; margin-bottom:6px;
  }
  .section-title{
    font-size:26px; font-weight:800;
    color:#111827; margin-bottom:8px;
  }
  .section-lead{
    color:#6b7280; font-size:14px;
    max-width:560px; margin-bottom:18px;
  }
  .section-count{
    color:#9ca3af; font-size:13px; font-weight:500;
    margin-left:8px;
  }
  .section-eyebrow.is-before{ color:#dc2626; }
  .section-eyebrow.is-during{ color:#e8720c; }
  .section-eyebrow.is-after { color:#16a34a; }

  /* ── Before/After pair grid (homeowner showcase) ─────────────── */
  .ba-grid{ display:grid; grid-template-columns:1fr; gap:24px; }
  .ba-pair{
    display:grid; grid-template-columns:1fr 1fr; gap:12px;
    border:1px solid #e5e7eb; border-radius:14px;
    background:#ffffff; padding:14px;
  }
  .ba-cell{ position:relative; }
  .ba-frame{
    position:relative; aspect-ratio:4/3;
    border-radius:10px; overflow:hidden;
    background:#f3f4f6;
  }
  .ba-frame img{ width:100%; height:100%; object-fit:cover; display:block; }
  .ba-stamp{
    position:absolute; left:10px; top:10px;
    background:#dc2626; color:#ffffff;
    font-family:'Barlow Condensed',sans-serif;
    font-size:11px; font-weight:800;
    letter-spacing:.12em; text-transform:uppercase;
    padding:4px 10px; border-radius:6px;
    box-shadow:0 2px 6px rgba(0,0,0,.18);
  }
  .ba-stamp.ba-after{ background:#16a34a; }
  .ba-loc{
    grid-column:1/-1;
    font-family:'Barlow Condensed',sans-serif;
    font-size:13px; font-weight:700;
    letter-spacing:.05em; text-transform:uppercase;
    color:#374151; padding:8px 4px 2px;
  }

  /* ── Photo tile grid ─────────────────────────────────────────── */
  .photo-grid{
    display:grid;
    grid-template-columns:repeat(3,1fr);
    gap:14px;
  }
  @media (max-width:820px){ .photo-grid{ grid-template-columns:repeat(2,1fr); } }
  @media (max-width:520px){ .photo-grid{ grid-template-columns:1fr; } }
  .ph-tile{
    border:1px solid #e5e7eb; border-radius:10px;
    background:#ffffff; overflow:hidden;
    display:flex; flex-direction:column;
  }
  .ph-img{
    aspect-ratio:4/3; background:#f3f4f6;
    overflow:hidden; position:relative;
  }
  .ph-img img{ width:100%; height:100%; object-fit:cover; display:block; }
  .ph-cap-ho{
    padding:10px 12px; font-size:12px;
    color:#6b7280; line-height:1.4;
    border-top:1px solid #f3f4f6;
  }

  /* Adjuster tile = square, dense metadata under image */
  .photo-grid.is-adjuster{ grid-template-columns:repeat(4,1fr); gap:10px; }
  @media (max-width:820px){ .photo-grid.is-adjuster{ grid-template-columns:repeat(3,1fr); } }
  @media (max-width:520px){ .photo-grid.is-adjuster{ grid-template-columns:repeat(2,1fr); } }
  .ph-tile-adj .ph-img{ aspect-ratio:1/1; }
  .ph-meta{
    padding:8px 10px; background:#fafafa;
    border-top:1px solid #f3f4f6;
    font-size:11px; line-height:1.4;
  }
  .ph-num{
    font-family:'Barlow Condensed',sans-serif;
    font-weight:800; font-size:11px;
    letter-spacing:.1em; color:#e8720c;
    margin-bottom:4px;
  }
  .ph-row{ display:grid; grid-template-columns:60px 1fr; gap:6px; margin-bottom:2px; }
  .ph-k{
    color:#9ca3af; font-weight:700;
    letter-spacing:.06em; text-transform:uppercase;
    font-size:9.5px; align-self:center;
  }
  .ph-v{ color:#111827; font-weight:500; font-size:11px; }
  .ph-cap{
    color:#6b7280; font-size:11px;
    margin-top:6px; padding-top:6px;
    border-top:1px dashed #e5e7eb;
    line-height:1.4;
  }

  /* ── Work performed narrative ────────────────────────────────── */
  .scope-block{
    border-left:3px solid #e8720c;
    padding:8px 0 8px 18px; margin-bottom:32px;
  }
  .scope-block h2{ font-size:22px; margin-bottom:10px; }
  .scope-block p{ font-size:14px; color:#374151; line-height:1.65; white-space:pre-line; }

  /* ── Footer / brand seal ─────────────────────────────────────── */
  .footer{
    border-top:1px solid #e5e7eb;
    margin-top:40px; padding:24px 56px 12px;
    background:#fafafa;
    font-size:12px; color:#6b7280; text-align:center;
  }
  .footer-brand{
    font-family:'Barlow Condensed',sans-serif;
    font-weight:800; color:#111827;
    text-transform:uppercase; letter-spacing:.08em;
    font-size:14px; margin-bottom:4px;
  }
  .footer-tag{
    font-style:italic; color:#e8720c;
    font-size:11px; margin-top:6px;
    font-family:'Barlow Condensed',sans-serif;
    letter-spacing:.06em; text-transform:uppercase;
  }
</style>

<!-- No-print top bar -->
<div class="no-print top-bar">
  <div style="display:flex;align-items:center;gap:12px;">
    <button id="rpt-close-btn" class="top-bar-btn">&#8592; Close</button>
    <span class="top-bar-mode">${isAdjuster ? 'Adjuster Report' : 'Homeowner Report'}</span>
  </div>
  <button id="rpt-print-btn" class="top-bar-btn top-bar-btn-primary">Print / Save PDF</button>
</div>
<div style="height:52px;"></div>
<script>
  // The report renders inside its own window/viewer; wire the top-bar
  // buttons via addEventListener so CSP \`script-src-attr 'none'\`
  // doesn't block them the way inline onclick="..." would.
  (function(){
    var c = document.getElementById('rpt-close-btn');
    var p = document.getElementById('rpt-print-btn');
    if (c) c.addEventListener('click', function(){ window.close(); });
    if (p) p.addEventListener('click', function(){ window.print(); });
  })();
<\/script>

<!-- Hero -->
<header class="hero">
  <div class="hero-eyebrow">${isAdjuster ? 'Loss Documentation · Adjuster Copy' : 'Project Story · Before &amp; After'}</div>
  <h1 class="hero-title">${isAdjuster ? 'Claim Photo Documentation' : _esc(name) + '’s Project'}</h1>
  <div class="hero-sub">${isAdjuster
    ? 'Photographic evidence of property condition before, during, and after the scope of work performed by ' + BRAND.name + '. Every image stamped with location, damage type, and severity where applicable.'
    : 'A visual walkthrough of your roof project — what we found, the work as it happened, and the result.'}</div>
  ${heroUrl ? '<div class="hero-photo"><img src="' + _esc(heroUrl) + '" alt=""></div>' : ''}
</header>

<!-- Brand band -->
<div class="brand-bar">
  <div class="brand-bar-left">
    <img class="brand-logo" src="/assets/images/nbd-logo.png" alt="${BRAND.name}">
    <span class="brand-bar-name">${BRAND.name}</span>
  </div>
  <span class="brand-bar-contact">${BRAND.phone} &nbsp;·&nbsp; ${BRAND.email} &nbsp;·&nbsp; ${BRAND.website}</span>
</div>

<main class="content">

  <!-- Property info -->
  <div class="info-card">
    <div>
      <div class="info-k">${isAdjuster ? 'Insured' : 'Property Owner'}</div>
      <div class="info-v">${_esc(name)}</div>
    </div>
    <div>
      <div class="info-k">${isAdjuster ? 'Loss Type' : 'Project'}</div>
      <div class="info-v">${_esc(lead.jobType || lead.damageType || 'Exterior')}</div>
    </div>
    <div>
      <div class="info-k">Address</div>
      <div class="info-v">${_esc(lead.address || '—')}</div>
    </div>
    <div>
      <div class="info-k">Date</div>
      <div class="info-v">${_esc(dateStr)}</div>
    </div>
    ${isAdjuster && lead.claimNumber ? '<div><div class="info-k">Claim #</div><div class="info-v">' + _esc(lead.claimNumber) + '</div></div>' : ''}
    ${isAdjuster && (lead.insCarrier || lead.insuranceCarrier) ? '<div><div class="info-k">Carrier</div><div class="info-v">' + _esc(lead.insCarrier || lead.insuranceCarrier) + '</div></div>' : ''}
  </div>

  <!-- Stats strip -->
  ${stats}

  <!-- Damage summary (adjuster only, only when has-data) -->
  ${adjusterSummary}

  <!-- Before/After pairs (homeowner showcase) -->
  ${pairsSection}

  ${before.length > 0 ? `<section class="section">
    <div class="section-eyebrow is-before">${hasPhases ? 'Before' : 'Project Photos'}</div>
    <h2 class="section-title">${hasPhases ? 'Pre-Project Condition' : 'Documentation'}<span class="section-count">${before.length} photo${before.length === 1 ? '' : 's'}</span></h2>
    <p class="section-lead">${isAdjuster
      ? (hasPhases ? 'Documentation of property condition prior to work commencing.' : 'Photographic record of the property.')
      : (hasPhases ? 'Photos of the property at the start of the project.' : 'Photos of your project.')}</p>
    <div class="photo-grid${isAdjuster ? ' is-adjuster' : ''}">${photoGrid(before)}</div>
  </section>` : ''}

  ${lead.scopeOfWork ? `<section class="scope-block">
    <h2>Work Performed</h2>
    <p>${_esc(lead.scopeOfWork)}</p>
  </section>` : ''}

  ${during.length > 0 ? `<section class="section">
    <div class="section-eyebrow is-during">During</div>
    <h2 class="section-title">Work In Progress<span class="section-count">${during.length} photo${during.length === 1 ? '' : 's'}</span></h2>
    <p class="section-lead">${isAdjuster ? 'Mid-project documentation of work in progress.' : 'Photos taken while the crew was on the property.'}</p>
    <div class="photo-grid${isAdjuster ? ' is-adjuster' : ''}">${photoGrid(during)}</div>
  </section>` : ''}

  ${after.length > 0 ? `<section class="section">
    <div class="section-eyebrow is-after">After</div>
    <h2 class="section-title">Completed Project<span class="section-count">${after.length} photo${after.length === 1 ? '' : 's'}</span></h2>
    <p class="section-lead">${isAdjuster ? 'Final-condition documentation post-completion.' : 'The finished work — what the property looks like now.'}</p>
    <div class="photo-grid${isAdjuster ? ' is-adjuster' : ''}">${photoGrid(after)}</div>
  </section>` : ''}

</main>

<footer class="footer">
  <div class="footer-brand">${BRAND.name}</div>
  <div>${BRAND.phone} &nbsp;·&nbsp; ${BRAND.email} &nbsp;·&nbsp; ${BRAND.website}</div>
  <div class="footer-tag">We Put Our Name On It</div>
</footer>

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
