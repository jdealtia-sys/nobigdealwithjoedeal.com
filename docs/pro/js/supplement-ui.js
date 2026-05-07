/**
 * supplement-ui.js — Wave 144 (Supplement UI entry point)
 *
 * Wires the existing EstimateSupplement engine (which was a
 * fully-built, Firestore-ready module with no UI surface) into
 * an actionable button + modal flow. Engine handles createSupplement,
 * addFromCatalog, modifyItemQuantity, formatSupplementLetter, and
 * saveToFirestore. This module is the wrapper that the rep
 * actually clicks.
 *
 * UX:
 *   1. Tiny "+ Supplement" button on every estimate row in the
 *      customer-page estimates list (rendered by attaching to
 *      `.estimate-row` elements at boot + on data refresh)
 *   2. Click → full-screen modal: header (parent estimate ref +
 *      version), reason input, item picker (catalog search),
 *      list of added/modified items with delete buttons,
 *      live total + delta from parent
 *   3. Preview button → opens NBDDocViewer with formatted
 *      supplement letter HTML
 *   4. Save button → EstimateSupplement.saveToFirestore + toast
 *
 * Path-gated to customer.html (the only page where the
 * .estimate-row markup lives). dashboard.html doesn't expose
 * supplements directly — reps will navigate to the customer page
 * to trigger one.
 *
 * Public API:
 *   window.NBDSupplementUI.openForEstimate(estimateId, parentEstimateData)
 *   window.NBDSupplementUI.attachButtons()  // re-attaches on refresh
 */
(function () {
  'use strict';
  if (window.NBDSupplementUI && window.NBDSupplementUI.__sentinel === 'nbd-sup-ui-v1') return;

  const MODAL_ID = 'nbd-supplement-modal';
  let _currentSupplement = null;
  let _parentEstimate = null;
  let _existingVersions = 0;

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function _toast(msg, kind) {
    if (typeof window.showToast === 'function') window.showToast(msg, kind || 'info');
  }
  function _money(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '$0';
    return '$' + Math.round(n).toLocaleString();
  }

  // ─── Open the supplement modal for a given estimate ────────────
  async function openForEstimate(estimateId, parentEstimateData) {
    if (!window.EstimateSupplement) {
      _toast('Supplement engine not loaded.', 'error');
      return;
    }
    if (!parentEstimateData || !estimateId) {
      _toast('Missing estimate context.', 'error');
      return;
    }

    _parentEstimate = parentEstimateData;

    // Look up existing supplements to pick the next version number.
    let existing = [];
    try {
      existing = await window.EstimateSupplement.loadForEstimate(estimateId) || [];
    } catch (_) { /* empty list is fine */ }
    _existingVersions = existing.length;

    _currentSupplement = window.EstimateSupplement.createSupplement(parentEstimateData, {
      leadId: parentEstimateData.leadId || window._customerId || null,
      parentEstimateId: estimateId,
      version: _existingVersions + 1,
      reason: '',
    });

    _renderModal();
  }

  // ─── Modal render ──────────────────────────────────────────────
  function _renderModal() {
    let modal = document.getElementById(MODAL_ID);
    if (!modal) {
      modal = document.createElement('div');
      modal.id = MODAL_ID;
      modal.style.cssText =
        'position:fixed;inset:0;z-index:10015;background:rgba(10,12,15,0.92);' +
        'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);' +
        'display:flex;align-items:flex-start;justify-content:center;padding:20px;' +
        'overflow-y:auto;';
      document.body.appendChild(modal);
      // ESC closes
      const esc = (e) => { if (e.key === 'Escape') _close(); };
      document.addEventListener('keydown', esc);
      modal.addEventListener('click', (e) => { if (e.target === modal) _close(); });
      modal._escHandler = esc;
    }
    modal.innerHTML = _renderModalBody();
    _wireModalEvents(modal);
  }

  function _renderModalBody() {
    const sup = _currentSupplement;
    const parent = _parentEstimate;
    const delta = window.EstimateSupplement.calculateDelta(sup, parent);
    const parentTotal = (parent && (parent.grandTotal || parent.total)) || 0;
    const newTotal = parentTotal + (delta.totalDelta || 0);

    const addedRows = (sup.addedItems || []).map((it, idx) =>
      '<tr style="border-top:1px solid var(--br, #2a3344);">' +
        '<td style="padding:8px 6px;font-size:12px;font-family:monospace;">' + _esc(it.code || '') + '</td>' +
        '<td style="padding:8px 6px;font-size:13px;">' + _esc(it.name || '') + '</td>' +
        '<td style="padding:8px 6px;font-size:12px;text-align:right;">' + _esc(String(it.quantity || 0)) + '</td>' +
        '<td style="padding:8px 6px;font-size:12px;text-align:right;font-variant-numeric:tabular-nums;">' + _money(it.lineTotal || 0) + '</td>' +
        '<td style="padding:8px 6px;text-align:right;">' +
          '<button type="button" class="nbd-sup-remove-add" data-idx="' + idx + '" style="background:transparent;border:1px solid var(--br, #2a3344);color:#fca5a5;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:11px;">Remove</button>' +
        '</td>' +
      '</tr>'
    ).join('');

    const modRows = (sup.modifications || []).map((m, idx) =>
      '<tr style="border-top:1px solid var(--br, #2a3344);">' +
        '<td style="padding:8px 6px;font-size:12px;font-family:monospace;">' + _esc(m.code || '') + '</td>' +
        '<td style="padding:8px 6px;font-size:13px;">' + _esc(m.name || '') + '</td>' +
        '<td style="padding:8px 6px;font-size:12px;text-align:right;">' + _esc(String(m.originalQuantity)) + ' → ' + _esc(String(m.newQuantity)) + '</td>' +
        '<td style="padding:8px 6px;font-size:12px;text-align:right;font-variant-numeric:tabular-nums;">' + _money(m.delta || 0) + '</td>' +
        '<td style="padding:8px 6px;text-align:right;">' +
          '<button type="button" class="nbd-sup-remove-mod" data-idx="' + idx + '" style="background:transparent;border:1px solid var(--br, #2a3344);color:#fca5a5;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:11px;">Remove</button>' +
        '</td>' +
      '</tr>'
    ).join('');

    return (
      '<div style="background:#0f1729;border:1px solid #2a3344;border-radius:14px;' +
        'width:100%;max-width:900px;color:#e2e8f0;font:inherit;padding:22px;' +
        'box-shadow:0 24px 60px rgba(0,0,0,0.6);">' +

        // Header
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:14px;">' +
          '<div>' +
            '<div style="font-size:11px;color:#94a3b8;letter-spacing:0.06em;font-weight:600;text-transform:uppercase;margin-bottom:3px;">' +
              'Supplement #' + sup.version +
            '</div>' +
            '<div style="font-size:18px;font-weight:700;">' +
              'Insurance Supplement' +
              (parent.number ? ' — ' + _esc(parent.number) : '') +
            '</div>' +
          '</div>' +
          '<button type="button" id="nbd-sup-close" style="background:transparent;border:none;color:#94a3b8;font-size:22px;cursor:pointer;padding:4px 10px;line-height:1;">×</button>' +
        '</div>' +

        // Reason input
        '<div style="margin-bottom:14px;">' +
          '<label style="display:block;font-size:11px;color:#94a3b8;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:5px;font-weight:600;">Reason for supplement</label>' +
          '<input type="text" id="nbd-sup-reason" value="' + _esc(sup.reason) + '" placeholder="Newly discovered hail damage on rear elevation" ' +
            'style="width:100%;padding:10px 12px;border-radius:6px;border:1px solid #2a3344;background:#0a1424;color:inherit;font:inherit;font-size:14px;box-sizing:border-box;">' +
        '</div>' +

        // Add line item
        '<div style="background:#0a1424;border:1px solid #2a3344;border-radius:8px;padding:12px;margin-bottom:14px;">' +
          '<div style="font-size:11px;color:#94a3b8;letter-spacing:0.06em;text-transform:uppercase;font-weight:600;margin-bottom:8px;">Add line item from catalog</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
            '<input type="text" id="nbd-sup-search" placeholder="Search by code, name, or tag…" ' +
              'style="flex:2;min-width:200px;padding:8px 10px;border-radius:5px;border:1px solid #2a3344;background:#13171d;color:inherit;font:inherit;font-size:13px;box-sizing:border-box;">' +
            '<input type="number" id="nbd-sup-qty" placeholder="Qty" min="0" step="0.5" ' +
              'style="width:90px;padding:8px 10px;border-radius:5px;border:1px solid #2a3344;background:#13171d;color:inherit;font:inherit;font-size:13px;box-sizing:border-box;">' +
            '<button type="button" id="nbd-sup-search-btn" style="padding:8px 14px;background:#1a2540;color:#cbd5e1;border:1px solid #2a3344;border-radius:5px;cursor:pointer;font-size:13px;">Search</button>' +
          '</div>' +
          '<div id="nbd-sup-search-results" style="margin-top:8px;display:none;max-height:200px;overflow-y:auto;border:1px solid #2a3344;border-radius:5px;"></div>' +
        '</div>' +

        // Tables
        ((addedRows || modRows) ? (
          '<div style="margin-bottom:14px;">' +
            '<div style="font-size:11px;color:#94a3b8;letter-spacing:0.06em;text-transform:uppercase;font-weight:600;margin-bottom:8px;">Supplement scope</div>' +
            '<table style="width:100%;border-collapse:collapse;background:#0a1424;border:1px solid #2a3344;border-radius:6px;overflow:hidden;">' +
              '<thead style="background:#13171d;">' +
                '<tr style="font-size:10px;color:#94a3b8;letter-spacing:0.05em;text-transform:uppercase;">' +
                  '<th style="text-align:left;padding:8px 6px;font-weight:600;">Code</th>' +
                  '<th style="text-align:left;padding:8px 6px;font-weight:600;">Item</th>' +
                  '<th style="text-align:right;padding:8px 6px;font-weight:600;">Qty</th>' +
                  '<th style="text-align:right;padding:8px 6px;font-weight:600;">Delta</th>' +
                  '<th style="text-align:right;padding:8px 6px;font-weight:600;">' +
                  '</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody>' +
                addedRows + modRows +
              '</tbody>' +
            '</table>' +
          '</div>'
        ) : (
          '<div style="text-align:center;padding:24px 12px;color:#94a3b8;font-size:13px;background:#0a1424;border-radius:8px;border:1px dashed #2a3344;margin-bottom:14px;">' +
            'No items added yet. Search for a line item above.' +
          '</div>'
        )) +

        // Totals + actions
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding-top:14px;border-top:1px solid #2a3344;">' +
          '<div>' +
            '<div style="font-size:11px;color:#94a3b8;letter-spacing:0.06em;text-transform:uppercase;font-weight:600;">Supplement delta</div>' +
            '<div style="font-size:24px;font-weight:800;color:#5eead4;font-variant-numeric:tabular-nums;">' +
              (delta.totalDelta >= 0 ? '+' : '') + _money(delta.totalDelta || 0) +
            '</div>' +
            '<div style="font-size:11px;color:#94a3b8;">' +
              'Original: ' + _money(parentTotal) + ' → Revised: ' + _money(newTotal) +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
            '<button type="button" id="nbd-sup-preview" style="padding:10px 16px;background:#1a2540;color:#cbd5e1;border:1px solid #2a3344;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">Preview Letter</button>' +
            '<button type="button" id="nbd-sup-save" style="padding:10px 18px;background:var(--orange, #c8541a);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:700;">Save Supplement</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function _wireModalEvents(modal) {
    modal.querySelector('#nbd-sup-close').addEventListener('click', _close);

    const reasonEl = modal.querySelector('#nbd-sup-reason');
    if (reasonEl) reasonEl.addEventListener('input', (e) => {
      _currentSupplement.reason = e.target.value;
    });

    const searchBtn = modal.querySelector('#nbd-sup-search-btn');
    const searchEl = modal.querySelector('#nbd-sup-search');
    const qtyEl = modal.querySelector('#nbd-sup-qty');
    if (searchBtn && searchEl) {
      const runSearch = () => _runCatalogSearch(searchEl.value, qtyEl ? Number(qtyEl.value) || 1 : 1);
      searchBtn.addEventListener('click', runSearch);
      searchEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } });
    }

    Array.from(modal.querySelectorAll('.nbd-sup-remove-add')).forEach(b => {
      b.addEventListener('click', () => {
        const idx = Number(b.dataset.idx);
        const item = _currentSupplement.addedItems[idx];
        if (item) {
          window.EstimateSupplement.removeAddedItem(_currentSupplement, item.id);
          _renderModal();
        }
      });
    });
    Array.from(modal.querySelectorAll('.nbd-sup-remove-mod')).forEach(b => {
      b.addEventListener('click', () => {
        const idx = Number(b.dataset.idx);
        const m = _currentSupplement.modifications[idx];
        if (m) {
          window.EstimateSupplement.removeModification(_currentSupplement, m.code);
          _renderModal();
        }
      });
    });

    const previewBtn = modal.querySelector('#nbd-sup-preview');
    if (previewBtn) previewBtn.addEventListener('click', _previewLetter);

    const saveBtn = modal.querySelector('#nbd-sup-save');
    if (saveBtn) saveBtn.addEventListener('click', _save);
  }

  function _runCatalogSearch(query, qty) {
    const wrap = document.getElementById('nbd-sup-search-results');
    if (!wrap) return;
    const cat = window.NBD_XACT_CATALOG;
    if (!cat || typeof cat.search !== 'function') {
      wrap.style.display = 'block';
      wrap.innerHTML = '<div style="padding:10px;color:#fca5a5;font-size:12px;">Catalog not loaded.</div>';
      return;
    }
    const q = String(query || '').trim();
    if (!q) { wrap.style.display = 'none'; return; }
    const hits = cat.search(q).slice(0, 8);
    if (hits.length === 0) {
      wrap.style.display = 'block';
      wrap.innerHTML = '<div style="padding:10px;color:#94a3b8;font-size:12px;">No catalog matches.</div>';
      return;
    }
    wrap.style.display = 'block';
    wrap.innerHTML = hits.map(h =>
      '<button type="button" class="nbd-sup-pick" data-code="' + _esc(h.code) + '" ' +
        'style="display:block;width:100%;text-align:left;padding:8px 10px;background:transparent;border:none;border-bottom:1px solid #1a2540;color:inherit;font:inherit;font-size:12px;cursor:pointer;">' +
        '<span style="font-family:monospace;color:var(--orange, #c8541a);font-weight:600;">' + _esc(h.code) + '</span> ' +
        _esc(h.name) +
      '</button>'
    ).join('');
    Array.from(wrap.querySelectorAll('.nbd-sup-pick')).forEach(b => {
      b.addEventListener('click', () => {
        const code = b.dataset.code;
        try {
          window.EstimateSupplement.addFromCatalog(_currentSupplement, code, qty || 1, {});
          _renderModal();
        } catch (e) {
          _toast('Could not add: ' + (e.message || 'unknown error'), 'error');
        }
      });
    });
  }

  function _previewLetter() {
    if (!_currentSupplement) return;
    const reason = _currentSupplement.reason || '';
    if (!reason.trim()) {
      _toast('Add a reason for the supplement first.', 'error');
      return;
    }
    if (!(_currentSupplement.addedItems || []).length
        && !(_currentSupplement.modifications || []).length) {
      _toast('Add at least one item before previewing.', 'error');
      return;
    }
    try {
      const html = window.EstimateSupplement.formatSupplementLetter(_currentSupplement, {
        parentEstimate: _parentEstimate,
        rep: window._currentRep || {},
        company: { name: 'No Big Deal Home Solutions' },
      });
      if (window.NBDDocViewer && typeof window.NBDDocViewer.open === 'function') {
        window.NBDDocViewer.open({
          title: 'Supplement #' + _currentSupplement.version + ' — preview',
          html,
        });
      } else {
        // Fallback — open in a new window.
        const w = window.open('', '_blank');
        if (w) { w.document.write(html); w.document.close(); }
      }
    } catch (e) {
      _toast('Preview failed: ' + (e.message || 'unknown error'), 'error');
    }
  }

  async function _save() {
    if (!_currentSupplement) return;
    const reason = (_currentSupplement.reason || '').trim();
    if (!reason) {
      _toast('Add a reason for the supplement first.', 'error');
      return;
    }
    if (!(_currentSupplement.addedItems || []).length
        && !(_currentSupplement.modifications || []).length) {
      _toast('Add at least one item before saving.', 'error');
      return;
    }
    const saveBtn = document.getElementById('nbd-sup-save');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
    try {
      const id = await window.EstimateSupplement.saveToFirestore(_currentSupplement);
      if (id) {
        _toast('Supplement #' + _currentSupplement.version + ' saved ✓', 'success');
        _close();
      } else {
        _toast('Save failed — check console.', 'error');
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Supplement'; }
      }
    } catch (e) {
      _toast('Save failed: ' + (e.message || 'try again'), 'error');
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Supplement'; }
    }
  }

  function _close() {
    const modal = document.getElementById(MODAL_ID);
    if (modal) {
      if (modal._escHandler) document.removeEventListener('keydown', modal._escHandler);
      modal.remove();
    }
    _currentSupplement = null;
    _parentEstimate = null;
  }

  // ─── Attach "+ Supplement" buttons to estimate rows ────────────
  // The customer page renders estimate cards via a few different
  // code paths (estimate-list module, inline render in customer.html
  // bootstrap, etc). We attach by watching for any element with
  // `data-estimate-id` that's NOT already wired, then injecting a
  // small button inline. Mutation observer handles re-renders.
  function attachButtons() {
    // The customer-page estimate list (customer.html line ~3722)
    // renders rows with `class="nbd-est-row"` and `data-est-id`.
    // Other surfaces (dashboard estimates view, future modules) may
    // emit `data-estimate-id`. Match both.
    const sel = [
      '.nbd-est-row:not([data-supplement-wired])',
      '[data-estimate-id]:not([data-supplement-wired])',
    ].join(', ');
    const candidates = document.querySelectorAll(sel);
    candidates.forEach(el => {
      const estId = el.dataset.estId || el.dataset.estimateId;
      if (!estId) return;
      el.dataset.supplementWired = '1';
      if (el.querySelector('.nbd-sup-trigger')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nbd-sup-trigger';
      btn.textContent = '+ Supplement';
      btn.title = 'Build an insurance supplement for this estimate';
      btn.style.cssText =
        'margin-left:6px;padding:4px 10px;background:transparent;color:var(--orange, #c8541a);' +
        'border:1px solid var(--orange, #c8541a);border-radius:5px;font:inherit;font-size:11px;' +
        'font-weight:600;cursor:pointer;letter-spacing:0.04em;text-transform:uppercase;' +
        '-webkit-tap-highlight-color:transparent;';
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        // Try in-memory caches first — the customer page populates
        // window._customerEstimates, the dashboard populates
        // window._estimates. Either is fine.
        let parent = (window._customerEstimates || window._estimates || [])
          .find(es => es.id === estId);
        if (!parent && window.db && window.getDoc && window.doc) {
          try {
            const snap = await window.getDoc(window.doc(window.db, 'estimates', estId));
            if (snap.exists()) parent = { id: snap.id, ...snap.data() };
          } catch (_) {}
        }
        if (!parent) {
          _toast('Could not load that estimate.', 'error');
          return;
        }
        openForEstimate(estId, parent);
      });
      el.appendChild(btn);
    });
  }

  // Run on load + watch for DOM mutations (estimate list re-renders).
  function _bootstrap() {
    attachButtons();
    if (typeof MutationObserver === 'function') {
      const obs = new MutationObserver(() => { attachButtons(); });
      obs.observe(document.body, { childList: true, subtree: true });
    }
    // Also re-attach on data refresh events.
    window.addEventListener('nbd:data-refreshed', attachButtons);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bootstrap, { once: true });
  } else {
    setTimeout(_bootstrap, 0);
  }

  window.NBDSupplementUI = {
    __sentinel: 'nbd-sup-ui-v1',
    openForEstimate,
    attachButtons,
  };
})();
