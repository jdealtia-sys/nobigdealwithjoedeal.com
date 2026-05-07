/**
 * inspection-capture.js — Wave 168 (Inspection Capture MVP)
 *
 * Mobile-first capture surface for the field rep at a property.
 * The existing W56-era InspectionReportEngine generates formal
 * inspection reports from a structured photo bundle — what was
 * missing was a fast, tappable capture front-end. This module is
 * that front-end: rep walks around the house, taps "Take photo",
 * tags each shot to a section + severity, and finishes with a
 * single Firestore write that the report engine can consume.
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ 🏠 Inspection — Sarah Mills                       [×]    │
 *   │ ──────────────────────────────────────────────────────── │
 *   │  Section  [Roof ▾]                                       │
 *   │  Severity [None ▾]                                       │
 *   │                                                           │
 *   │  ┌────────────────┐   ┌─────────┐ ┌─────────┐            │
 *   │  │   📷 Take       │   │  thumb  │ │  thumb  │            │
 *   │  │     photo       │   │  Roof   │ │ Gutters │            │
 *   │  └────────────────┘   │  Major  │ │  Minor  │            │
 *   │                       └─────────┘ └─────────┘            │
 *   │                                                           │
 *   │  4 photos captured · 3 sections · 1 major flagged        │
 *   │                                                           │
 *   │  [   ✓ Finish inspection   ]                              │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Capture flow:
 *   1. Rep picks the section (Roof / Gutters / Fascia / Soffit /
 *      Chimney / Vents / Flashing / General) and severity (None /
 *      Minor / Major / Hail / Wind / Other) — these defaults
 *      auto-apply to every photo until the rep changes them
 *   2. Tap "📷 Take photo" → triggers a hidden <input type="file"
 *      accept="image/*" capture="environment"> which opens the
 *      device camera on mobile or the file picker on desktop
 *   3. Photo uploads via PhotoEngine.uploadFromFile with tags
 *      [inspection, section, severity, currentInspectionId]
 *   4. Thumbnail appears in the in-session grid with a remove
 *      button so the rep can drop bad shots
 *   5. Tapping "✓ Finish inspection" writes a single inspections
 *      doc summarizing the session: photo IDs, sections covered,
 *      severity histogram, optional rep notes
 *
 * Path-gated to customer.html (lead context required for upload
 * paths). Triggered via window.NBDInspectionCapture.start() —
 * surfaced by W144 supplement-style "Start inspection" button
 * added to the customer page quick-action area.
 *
 * Public API:
 *   window.NBDInspectionCapture.start()
 *   window.NBDInspectionCapture.isOpen()
 */
(function () {
  'use strict';
  if (window.NBDInspectionCapture
      && window.NBDInspectionCapture.__sentinel === 'nbd-inspection-capture-v1') return;

  const MODAL_ID = 'nbd-inspection-modal';
  const SECTIONS = [
    'Roof', 'Gutters', 'Fascia', 'Soffit',
    'Chimney', 'Vents', 'Flashing', 'Siding',
    'Windows', 'Foundation', 'Interior', 'General',
  ];
  const SEVERITIES = [
    { id: 'none',  label: 'None',  color: '#94a3b8' },
    { id: 'minor', label: 'Minor', color: '#fcd34d' },
    { id: 'major', label: 'Major', color: '#f97316' },
    { id: 'hail',  label: 'Hail',  color: '#ef4444' },
    { id: 'wind',  label: 'Wind',  color: '#a855f7' },
    { id: 'other', label: 'Other', color: '#60a5fa' },
  ];
  const SEVERITY_BY_ID = SEVERITIES.reduce((m, s) => { m[s.id] = s; return m; }, {});

  // ─── Path gate ────────────────────────────────────────────────
  function _onCustomerPage() {
    const p = (window.location && window.location.pathname || '').toLowerCase();
    return p.indexOf('/pro/customer') !== -1
      || p.indexOf('customer.html') !== -1;
  }

  // ─── Helpers ──────────────────────────────────────────────────
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function _name(lead) {
    if (!lead) return 'Lead';
    const n = ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim();
    return n || lead.address || lead.email || 'Lead';
  }
  function _newId() {
    return 'insp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  // ─── Session state ────────────────────────────────────────────
  let _session = null; // { id, leadId, photos: [...], section, severity, startedAt }
  let _uploading = false;

  function _resetSession(leadId) {
    _session = {
      id: _newId(),
      leadId,
      photos: [],
      section: SECTIONS[0],
      severity: 'none',
      notes: '',
      startedAt: Date.now(),
    };
  }

  // ─── Render ───────────────────────────────────────────────────
  function _renderHeader(lead) {
    return '<div style="padding:16px 20px;border-bottom:1px solid #1f2937;display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
      '<div>' +
        '<div style="font-size:18px;font-weight:700;color:#fff;">🏠 Inspection — ' + _esc(_name(lead)) + '</div>' +
        '<div style="font-size:11px;color:#94a3b8;margin-top:2px;">Tag each photo as you capture · upload happens in background</div>' +
      '</div>' +
      '<button type="button" id="nbd-ic-close" aria-label="Close" style="background:transparent;color:#94a3b8;border:none;font-size:22px;line-height:1;cursor:pointer;padding:2px 6px;">×</button>' +
    '</div>';
  }

  function _renderTagControls() {
    const sectionOpts = SECTIONS.map(s =>
      '<option value="' + _esc(s) + '"' +
      (s === _session.section ? ' selected' : '') + '>' + _esc(s) + '</option>'
    ).join('');
    const severityOpts = SEVERITIES.map(s =>
      '<option value="' + _esc(s.id) + '"' +
      (s.id === _session.severity ? ' selected' : '') + '>' + _esc(s.label) + '</option>'
    ).join('');
    return '<div style="padding:14px 20px 8px;display:flex;gap:10px;flex-wrap:wrap;">' +
      '<label style="flex:1;min-width:140px;display:flex;flex-direction:column;gap:4px;">' +
        '<span style="font-size:10px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#94a3b8;">Section</span>' +
        '<select id="nbd-ic-section" style="background:rgba(15,23,42,0.55);color:#e2e8f0;border:1px solid #2a3344;border-radius:6px;padding:9px 10px;font:inherit;font-size:13px;">' + sectionOpts + '</select>' +
      '</label>' +
      '<label style="flex:1;min-width:140px;display:flex;flex-direction:column;gap:4px;">' +
        '<span style="font-size:10px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#94a3b8;">Severity</span>' +
        '<select id="nbd-ic-severity" style="background:rgba(15,23,42,0.55);color:#e2e8f0;border:1px solid #2a3344;border-radius:6px;padding:9px 10px;font:inherit;font-size:13px;">' + severityOpts + '</select>' +
      '</label>' +
    '</div>';
  }

  function _renderCaptureButton() {
    return '<div style="padding:8px 20px 14px;">' +
      '<button type="button" id="nbd-ic-capture" style="' +
        'width:100%;padding:18px 16px;border-radius:10px;' +
        'background:rgba(200,84,26,0.18);color:#fcd34d;' +
        'border:2px dashed rgba(200,84,26,0.55);' +
        'font:inherit;font-size:15px;font-weight:700;cursor:pointer;' +
        'display:flex;align-items:center;justify-content:center;gap:8px;' +
        'transition:background 120ms ease;">' +
        '<span style="font-size:22px;">📷</span> Take photo' +
      '</button>' +
      '<input type="file" id="nbd-ic-fileinput" accept="image/*" capture="environment" style="display:none;">' +
    '</div>';
  }

  function _renderPhoto(p) {
    const sev = SEVERITY_BY_ID[p.severity] || SEVERITY_BY_ID.none;
    const thumb = p.thumbDataUrl
      ? '<img src="' + _esc(p.thumbDataUrl) + '" alt="" style="width:100%;height:100%;object-fit:cover;display:block;">'
      : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:24px;">📷</div>';
    const status = p.uploaded
      ? '<span style="position:absolute;top:4px;right:4px;width:18px;height:18px;border-radius:50%;background:rgba(34,197,94,0.85);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;">✓</span>'
      : (p.failed
        ? '<span title="Upload failed — tap photo to retry" style="position:absolute;top:4px;right:4px;width:18px;height:18px;border-radius:50%;background:rgba(239,68,68,0.85);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;">!</span>'
        : '<span style="position:absolute;top:4px;right:4px;width:18px;height:18px;border-radius:50%;background:rgba(168,85,247,0.85);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;animation:nbd-ic-pulse 1.5s ease-in-out infinite;">↑</span>');
    return '<div data-photo-id="' + _esc(p.localId) + '" style="position:relative;background:rgba(15,23,42,0.65);border:1px solid #2a3344;border-radius:8px;overflow:hidden;aspect-ratio:1;display:flex;flex-direction:column;">' +
      '<div style="flex:1;min-height:0;background:#0a0f1c;">' + thumb + '</div>' +
      status +
      '<div style="padding:5px 8px;background:rgba(2,6,23,0.65);font-size:10px;line-height:1.25;">' +
        '<div style="color:#e2e8f0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(p.section) + '</div>' +
        '<div style="color:' + sev.color + ';font-weight:700;text-transform:uppercase;letter-spacing:0.04em;font-size:9px;">' + _esc(sev.label) + '</div>' +
      '</div>' +
      '<button type="button" data-action="remove" data-photo-id="' + _esc(p.localId) + '" aria-label="Remove" style="position:absolute;bottom:4px;right:4px;width:20px;height:20px;border-radius:50%;background:rgba(239,68,68,0.78);color:#fff;border:none;font-size:11px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;">×</button>' +
    '</div>';
  }

  function _renderGrid() {
    if (!_session.photos.length) {
      return '<div style="padding:18px 20px;color:#94a3b8;font-size:12px;text-align:center;line-height:1.5;border:1px dashed #2a3344;border-radius:8px;margin:0 20px;">' +
        'No photos captured yet.<br>Use the section + severity above, then tap the camera button.' +
      '</div>';
    }
    const items = _session.photos.map(_renderPhoto).join('');
    return '<div style="padding:0 20px;display:grid;grid-template-columns:repeat(auto-fill, minmax(110px, 1fr));gap:8px;">' + items + '</div>';
  }

  function _renderSummary() {
    const total = _session.photos.length;
    const sections = new Set(_session.photos.map(p => p.section));
    const sevCount = {};
    for (const p of _session.photos) sevCount[p.severity] = (sevCount[p.severity] || 0) + 1;
    const flaggedCount = (sevCount.major || 0) + (sevCount.hail || 0) + (sevCount.wind || 0);
    if (!total) return '';
    return '<div style="padding:8px 20px;color:#94a3b8;font-size:11px;line-height:1.5;text-align:center;">' +
      total + ' photo' + (total === 1 ? '' : 's') + ' captured · ' +
      sections.size + ' section' + (sections.size === 1 ? '' : 's') + ' · ' +
      (flaggedCount
        ? '<span style="color:#fca5a5;font-weight:700;">' + flaggedCount + ' flagged</span>'
        : 'no major findings')
    + '</div>';
  }

  function _renderFooter() {
    const total = _session.photos.length;
    const allUploaded = total > 0 && _session.photos.every(p => p.uploaded);
    const finishLabel = !total
      ? 'Cancel'
      : (allUploaded ? '✓ Finish inspection' : 'Finish anyway (' + (_session.photos.filter(p => !p.uploaded).length) + ' uploading…)');
    return '<div style="padding:14px 20px;border-top:1px solid #1f2937;display:flex;justify-content:flex-end;gap:8px;">' +
      '<button type="button" id="nbd-ic-finish" style="' +
        'background:' + (total ? '#a855f7' : 'transparent') + ';' +
        'color:' + (total ? '#fff' : '#94a3b8') + ';' +
        'border:' + (total ? 'none' : '1px solid #2a3344') + ';' +
        'border-radius:6px;padding:9px 18px;font:inherit;font-size:13px;font-weight:700;cursor:pointer;">' +
        _esc(finishLabel) +
      '</button>' +
    '</div>';
  }

  function _rerender() {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    const tags = modal.querySelector('#nbd-ic-tags');
    const grid = modal.querySelector('#nbd-ic-grid');
    const summary = modal.querySelector('#nbd-ic-summary');
    const footer = modal.querySelector('#nbd-ic-footer');
    if (tags) tags.innerHTML = _renderTagControls();
    if (grid) grid.innerHTML = _renderGrid();
    if (summary) summary.innerHTML = _renderSummary();
    if (footer) footer.innerHTML = _renderFooter();
    _wireBody(modal);
  }

  // ─── Wiring ───────────────────────────────────────────────────
  function _wireBody(modal) {
    const sectionSel = modal.querySelector('#nbd-ic-section');
    const severitySel = modal.querySelector('#nbd-ic-severity');
    const captureBtn = modal.querySelector('#nbd-ic-capture');
    const fileInput = modal.querySelector('#nbd-ic-fileinput');
    const finishBtn = modal.querySelector('#nbd-ic-finish');
    const grid = modal.querySelector('#nbd-ic-grid');

    if (sectionSel) {
      sectionSel.addEventListener('change', () => {
        _session.section = sectionSel.value;
      });
    }
    if (severitySel) {
      severitySel.addEventListener('change', () => {
        _session.severity = severitySel.value;
      });
    }
    if (captureBtn && fileInput) {
      captureBtn.onclick = () => fileInput.click();
      fileInput.onchange = async () => {
        const file = fileInput.files && fileInput.files[0];
        if (file) await _addPhoto(file);
        // Reset so the same file can be re-picked if rep retakes.
        fileInput.value = '';
      };
    }
    if (finishBtn) {
      finishBtn.onclick = _finish;
    }
    if (grid) {
      grid.onclick = (e) => {
        const btn = e.target && e.target.closest && e.target.closest('[data-action="remove"]');
        if (!btn) return;
        const id = btn.getAttribute('data-photo-id');
        _removePhoto(id);
      };
    }
  }

  // ─── Photo lifecycle ──────────────────────────────────────────
  async function _addPhoto(file) {
    const localId = _newId();
    const photo = {
      localId,
      file,
      section: _session.section,
      severity: _session.severity,
      uploaded: false,
      failed: false,
      photoId: null,
      thumbDataUrl: null,
      capturedAt: Date.now(),
    };
    _session.photos.push(photo);

    // Generate thumbnail (small data URL) for instant preview.
    try {
      photo.thumbDataUrl = await _makeThumb(file, 240);
    } catch (e) { /* fall through — placeholder will show */ }
    _rerender();

    // Kick off upload in background.
    _uploadPhoto(photo).catch(e => {
      console.warn('[inspection-capture] upload failed:', e && e.message);
      photo.failed = true;
      _rerender();
    });
  }

  async function _uploadPhoto(photo) {
    if (!window.PhotoEngine || typeof window.PhotoEngine.uploadFromFile !== 'function') {
      console.warn('[inspection-capture] PhotoEngine missing — photo not uploaded');
      photo.failed = true;
      _rerender();
      return;
    }
    const tags = ['inspection', _session.id, photo.section.toLowerCase(), photo.severity];
    const description = 'Inspection photo · ' + photo.section + ' · ' + (SEVERITY_BY_ID[photo.severity] || {}).label;
    try {
      const result = await window.PhotoEngine.uploadFromFile(_session.leadId, photo.file, tags, description);
      photo.photoId = (result && (result.id || result)) || null;
      photo.uploaded = true;
      _rerender();
    } catch (e) {
      photo.failed = true;
      throw e;
    }
  }

  function _removePhoto(localId) {
    if (!_session) return;
    const idx = _session.photos.findIndex(p => p.localId === localId);
    if (idx === -1) return;
    const photo = _session.photos[idx];
    _session.photos.splice(idx, 1);
    _rerender();
    // Best-effort: if the photo had already uploaded, delete it
    // from Firestore so we don't leave orphans behind.
    if (photo.uploaded && photo.photoId
        && window.PhotoEngine && typeof window.PhotoEngine.deletePhoto === 'function') {
      try { window.PhotoEngine.deletePhoto(photo.photoId); } catch (_) {}
    }
  }

  // ─── Thumbnail generation ─────────────────────────────────────
  function _makeThumb(file, maxDim) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          try {
            resolve(canvas.toDataURL('image/jpeg', 0.7));
          } catch (e) { reject(e); }
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ─── Finish ───────────────────────────────────────────────────
  async function _finish() {
    if (_uploading) return;
    if (!_session.photos.length) {
      _close();
      return;
    }
    _uploading = true;
    const finishBtn = document.getElementById('nbd-ic-finish');
    if (finishBtn) {
      finishBtn.disabled = true;
      finishBtn.textContent = 'Saving inspection…';
    }
    try {
      // Build inspection summary doc. Photo IDs reference whatever
      // PhotoEngine returned; if the caller never resolved, the
      // photo is skipped (we don't want phantom IDs in the doc).
      const photoEntries = _session.photos
        .filter(p => p.uploaded && p.photoId)
        .map(p => ({
          photoId: p.photoId,
          section: p.section,
          severity: p.severity,
          capturedAt: p.capturedAt,
        }));
      const sectionsCovered = Array.from(new Set(_session.photos.map(p => p.section)));
      const severityHistogram = _session.photos.reduce((m, p) => {
        m[p.severity] = (m[p.severity] || 0) + 1;
        return m;
      }, {});

      // Write inspection doc + bump lead activity.
      await _saveInspection({
        id: _session.id,
        leadId: _session.leadId,
        photos: photoEntries,
        sectionsCovered,
        severityHistogram,
        startedAt: _session.startedAt,
        completedAt: Date.now(),
      });

      // Log to communications timeline so the inspection shows
      // up alongside SMS / email / call activity.
      try {
        if (typeof window.logCommunication === 'function') {
          const summary = photoEntries.length + ' photo' + (photoEntries.length === 1 ? '' : 's') +
            ' across ' + sectionsCovered.length + ' section' + (sectionsCovered.length === 1 ? '' : 's');
          window.logCommunication(_session.leadId, 'inspection', summary, {
            source: 'inspection-capture',
            inspectionId: _session.id,
            sections: sectionsCovered,
          });
        }
      } catch (_) {}

      if (typeof window.showToast === 'function') {
        window.showToast('Inspection saved (' + photoEntries.length + ' photos)', 'ok');
      }
      _close();
    } catch (e) {
      console.warn('[inspection-capture] save failed:', e && e.message);
      if (finishBtn) {
        finishBtn.disabled = false;
        finishBtn.textContent = 'Retry save';
      }
      if (typeof window.showToast === 'function') {
        window.showToast('Failed to save inspection — try again', 'error');
      }
    } finally {
      _uploading = false;
    }
  }

  async function _saveInspection(record) {
    const db = window.db || window._db;
    const auth = window.auth || window._auth;
    const addDoc = window.addDoc;
    const collection = window.collection;
    const updateDoc = window.updateDoc;
    const doc = window.doc;
    const serverTimestamp = window.serverTimestamp;
    if (!db || !addDoc || !collection || !serverTimestamp) {
      throw new Error('Firebase globals missing');
    }
    const uid = auth && auth.currentUser && auth.currentUser.uid;
    if (!uid) throw new Error('Not signed in');
    await addDoc(collection(db, 'inspections'), {
      ...record,
      userId: uid,
      createdAt: serverTimestamp(),
    });
    // Bump lead.lastInspectionAt + .inspectionCount so the
    // customer page can surface "Last inspected 3 days ago" badges.
    try {
      if (updateDoc && doc) {
        await updateDoc(doc(db, 'leads', record.leadId), {
          lastInspectionAt: serverTimestamp(),
          inspectionCount: (window._currentLead && Number(window._currentLead.inspectionCount || 0) + 1) || 1,
        });
      }
    } catch (_) {}
  }

  // ─── Open / close ─────────────────────────────────────────────
  function _close() {
    const m = document.getElementById(MODAL_ID);
    if (!m) return;
    m.style.transition = 'opacity 160ms ease';
    m.style.opacity = '0';
    setTimeout(() => { try { m.remove(); } catch (_) {} }, 170);
    _session = null;
    _uploading = false;
  }

  function start() {
    if (!_onCustomerPage()) {
      console.warn('[inspection-capture] not on customer page');
      return;
    }
    if (document.getElementById(MODAL_ID)) return;
    const lead = window._currentLead;
    if (!lead || !lead.id) {
      if (typeof window.showToast === 'function') {
        window.showToast('No lead loaded', 'error');
      }
      return;
    }
    _resetSession(lead.id);

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.style.cssText =
      'position:fixed;inset:0;z-index:10006;background:rgba(2,6,23,0.78);' +
      'display:flex;align-items:flex-start;justify-content:center;' +
      'padding:env(safe-area-inset-top, 12px) 0 env(safe-area-inset-bottom, 12px) 0;' +
      'animation:nbd-ic-fade 200ms ease-out;overflow-y:auto;' +
      '-webkit-overflow-scrolling:touch;';

    modal.innerHTML =
      '<div role="document" style="' +
        'background:#0f1729;color:#e2e8f0;border:1px solid #2a3344;' +
        'border-top:4px solid #a855f7;border-radius:12px;' +
        'width:min(640px, 100%);margin:12px;' +
        'display:flex;flex-direction:column;' +
        'box-shadow:0 18px 60px rgba(0,0,0,0.55);font:inherit;' +
        'animation:nbd-ic-pop 220ms cubic-bezier(0.16, 1, 0.3, 1);' +
      '">' +
        _renderHeader(lead) +
        '<div id="nbd-ic-tags">' + _renderTagControls() + '</div>' +
        _renderCaptureButton() +
        '<div id="nbd-ic-grid">' + _renderGrid() + '</div>' +
        '<div id="nbd-ic-summary">' + _renderSummary() + '</div>' +
        '<div id="nbd-ic-footer">' + _renderFooter() + '</div>' +
      '</div>';

    document.body.appendChild(modal);

    if (!document.getElementById('nbd-ic-css')) {
      const css = document.createElement('style');
      css.id = 'nbd-ic-css';
      css.textContent =
        '@keyframes nbd-ic-fade { from { opacity: 0; } to { opacity: 1; } }' +
        '@keyframes nbd-ic-pop { from { opacity: 0; transform: translateY(20px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }' +
        '@keyframes nbd-ic-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }';
      document.head.appendChild(css);
    }

    // Wire close button + ESC + backdrop.
    const closeBtn = modal.querySelector('#nbd-ic-close');
    if (closeBtn) closeBtn.onclick = () => {
      // Confirm if there are unsaved photos.
      if (_session && _session.photos.length
          && typeof window.confirm === 'function'
          && !window.confirm('Discard ' + _session.photos.length + ' unsaved photo' +
              (_session.photos.length === 1 ? '' : 's') + '?')) {
        return;
      }
      _close();
    };
    function onKey(e) {
      if (e.key === 'Escape' && closeBtn) {
        closeBtn.click();
        document.removeEventListener('keydown', onKey, true);
      }
    }
    document.addEventListener('keydown', onKey, true);

    _wireBody(modal);
  }

  function isOpen() { return !!document.getElementById(MODAL_ID); }

  // ─── Public API ───────────────────────────────────────────────
  window.NBDInspectionCapture = {
    __sentinel: 'nbd-inspection-capture-v1',
    start,
    isOpen,
  };
})();
