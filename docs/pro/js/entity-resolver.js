/**
 * entity-resolver.js — shared "find or create a lead" picker.
 *
 * First consumer: Job Templates (job-templates-ui.js), replacing its plain
 * lead <select> with real search (wrapping global-search.js's existing
 * scoring logic) plus inline quick-create (reusing crm-leads.js's lead
 * modal unmodified — name+address is already all it requires).
 *
 * Deliberately NOT built here yet: a generalized "redirect to full setup,
 * then resume" flow. crm-leads.js's modal already covers create, and no
 * second consumer has asked for redirect-and-resume. Build that only when
 * a real second surface (D2D, Storm Center) needs it — see the five
 * existing bespoke lead pickers (estimates.js, quick-capture.js,
 * quick-capture-inbox.js, rep-report-generator.js, nbd-doc-viewer.js) this
 * is meant to spare future consumers from duplicating.
 */
(function () {
  'use strict';

  function leadDisplayName(l) {
    if (!l) return '';
    return l.name || l.customerName ||
      ((l.firstName || '') + ' ' + (l.lastName || '')).trim() || l.address || l.id;
  }

  function leadSubline(l) {
    if (!l) return '';
    return [l.address, l.phone].filter(Boolean).join(' · ');
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Opens the existing lead-create modal (crm-leads.js) and resolves with
  // the newly created lead once saveLead() dispatches nbd:lead-created.
  // Resolves null if the modal isn't on this page (defensive — no page
  // currently mounts Job Templates without it, but this keeps the widget
  // from hanging forever if that ever changes).
  function openQuickCreate() {
    return new Promise(function (resolve) {
      if (typeof window.openLeadModal !== 'function' || !document.getElementById('leadModal')) {
        resolve(null);
        return;
      }
      function onCreated(ev) {
        document.removeEventListener('nbd:lead-created', onCreated);
        resolve((ev && ev.detail && ev.detail.lead) || null);
      }
      document.addEventListener('nbd:lead-created', onCreated);
      window.openLeadModal();
    });
  }

  // Mounts an explicit "Add to Existing Customer" / "+ New Customer"
  // chooser into `root` (an existing DOM node) — browsing/configuring a
  // template never requires this to be touched; it's a deliberate action.
  // Keeps `opts.hiddenInput`'s value in sync with the resolved leadId so a
  // caller that already reads one element's .value (e.g. job-templates-
  // ui.js's doCreateEstimate) needs zero other changes.
  function mountLeadPicker(root, opts) {
    opts = opts || {};
    var hiddenInput = opts.hiddenInput || null;
    var onSelect = typeof opts.onSelect === 'function' ? opts.onSelect : function () {};
    var initialLead = opts.initialLead || null;

    root.innerHTML =
      '<div class="er-picker">' +
        '<div class="er-choice">' +
          '<button type="button" class="jt-btn jt-btn-primary er-choice-existing">Add to Existing Customer</button>' +
          '<button type="button" class="jt-btn er-choice-new">+ New Customer</button>' +
        '</div>' +
        '<div class="er-search-wrap" style="display:none;">' +
          '<input type="text" class="jt-in er-search" placeholder="Search by name, address, phone, customer ID…" autocomplete="off">' +
          '<div class="er-results" style="display:none;"></div>' +
          '<button type="button" class="jt-btn jt-btn-sm er-back">← Back</button>' +
        '</div>' +
        '<div class="er-selected" style="display:none;"></div>' +
      '</div>';

    var choiceEl = root.querySelector('.er-choice');
    var searchWrapEl = root.querySelector('.er-search-wrap');
    var searchEl = root.querySelector('.er-search');
    var selectedEl = root.querySelector('.er-selected');
    var resultsEl = root.querySelector('.er-results');
    var debounceTimer = null;

    function setHidden(id) {
      if (hiddenInput) hiddenInput.value = id || '';
    }

    function hideResults() {
      resultsEl.style.display = 'none';
    }

    function showChoice() {
      selectedEl.style.display = 'none';
      searchWrapEl.style.display = 'none';
      hideResults();
      choiceEl.style.display = 'flex';
    }

    function showSearch() {
      choiceEl.style.display = 'none';
      searchWrapEl.style.display = 'block';
      searchEl.value = '';
      renderResults('');
      searchEl.focus();
    }

    function showSelected(lead) {
      choiceEl.style.display = 'none';
      searchWrapEl.style.display = 'none';
      hideResults();
      selectedEl.style.display = 'flex';
      selectedEl.innerHTML =
        '<span class="er-selected-name">' + escHtml(leadDisplayName(lead)) + '</span>' +
        '<span class="er-selected-sub">' + escHtml(leadSubline(lead)) + '</span>' +
        '<button type="button" class="jt-btn jt-btn-sm er-change">Change</button>';
      selectedEl.querySelector('.er-change').addEventListener('click', function () {
        setHidden('');
        onSelect(null);
        showChoice();
      });
    }

    function selectLead(lead) {
      if (!lead || !lead.id) return;
      setHidden(lead.id);
      showSelected(lead);
      onSelect(lead);
    }

    function renderResults(query) {
      var hits = (window.NbdGlobalSearch && typeof window.NbdGlobalSearch.searchLeads === 'function')
        ? window.NbdGlobalSearch.searchLeads(query)
        : [];
      resultsEl.innerHTML = hits.slice(0, 8).map(function (hit) {
        var l = hit.lead;
        return '<div class="er-row" data-er-lead-id="' + escHtml(l.id) + '">' +
          '<span class="er-row-name">' + escHtml(leadDisplayName(l)) + '</span>' +
          '<span class="er-row-sub">' + escHtml(leadSubline(l)) + '</span>' +
          '</div>';
      }).join('') || '<div class="er-row er-row-empty">No matches — try a different search, or ← Back to create new.</div>';
      resultsEl.style.display = 'block';

      Array.prototype.forEach.call(resultsEl.querySelectorAll('[data-er-lead-id]'), function (row) {
        row.addEventListener('click', function () {
          var id = row.getAttribute('data-er-lead-id');
          var hit = hits.filter(function (h) { return String(h.lead.id) === String(id); })[0];
          if (hit) selectLead(hit.lead);
        });
      });
    }

    choiceEl.querySelector('.er-choice-existing').addEventListener('click', showSearch);
    choiceEl.querySelector('.er-choice-new').addEventListener('click', function () {
      openQuickCreate().then(function (lead) {
        if (lead) selectLead(lead);
      });
    });
    searchWrapEl.querySelector('.er-back').addEventListener('click', showChoice);

    searchEl.addEventListener('input', function () {
      var q = searchEl.value || '';
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () { renderResults(q); }, 80);
    });

    if (initialLead) {
      setHidden(initialLead.id);
      showSelected(initialLead);
    } else {
      setHidden('');
      showChoice();
    }
  }

  window.EntityResolver = {
    mountLeadPicker: mountLeadPicker,
    openQuickCreate: openQuickCreate
  };
})();
