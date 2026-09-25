/**
 * role-gate.js — the one place the CRM client knows the 'viewer' role is
 * read-only.
 *
 * WHY (2026-09-25, Jo's decision B, final): "The 'viewer' role is READ-ONLY
 * everywhere: a viewer can read what their company role allows but cannot
 * create, update or delete any tenant data — including rows under leads they
 * own." firestore.rules and storage.rules now refuse every such write
 * (notViewer() / ownerWrites(); documentation/audit/ROLE-TIGHTENING-2026-09-25.md).
 * Before that a viewer could add notes, tasks, photos, estimates and leads,
 * and the pages offered every one of those buttons. Once the rules refuse
 * them, the same buttons become silent failures (or, worse, an optimistic UI
 * that shows a note land and then quietly drops it). This file makes the
 * client honest about the role, in three layers:
 *
 *   1. NOT OFFERED. When the signed-in claims say role === 'viewer', <html>
 *      gets `nbd-role-viewer` and the write controls listed below are hidden.
 *      Both pages route their buttons through data-action (customer.html) or
 *      data-action="call" + data-fn (dashboard.html), so the lists name those
 *      handlers rather than tagging markup one button at a time.
 *   2. NOT RUN. A capture-phase click/keydown guard on document stops any
 *      gated control that is still reachable (a menu rendered before claims
 *      resolved, keyboard activation, a control the CSS cannot reach) BEFORE
 *      the pages' bubble-phase delegates see it, and says why.
 *   3. NEVER SILENT. Every Firestore/Storage write the pages make through the
 *      window.* globals (addDoc, setDoc, updateDoc, deleteDoc, writeBatch().
 *      commit, runTransaction, uploadBytes, uploadBytesResumable) is watched:
 *      if it is refused with permission-denied while the user is a viewer,
 *      the user is told "Your role is view-only" instead of the write failing
 *      silently or being reported as a generic error. This covers every write
 *      path layers 1-2 do not list. It never blocks a write itself, so no
 *      other role's behaviour changes, and the rules stay the only authority.
 *
 * Save functions for the core actions (notes, tasks, drawings, documents,
 * warranty claims, photos, estimates, the lead itself) also call
 * NBDRole.guard() first, which covers entry points that are not a click on a
 * listed control: keyboard shortcuts, the command palette, drag-and-drop.
 *
 * A viewer's own user-scoped writes (settings, notification read state,
 * template forks) are untouched: the rules allow them and nothing here blocks
 * a write.
 *
 * Loaded with `defer` BEFORE the page's bootstrap module, so the accessors
 * below exist before the bootstrap assigns window._userClaims / window.addDoc.
 */
(function () {
  'use strict';
  if (window.NBDRole) return;

  var VIEW_ONLY = 'Your role is view-only \u2014 ask an owner or manager to make this change.';

  // ── Layer 1 + 2: write controls, by the handler they dispatch to ──────────
  // customer.html: <el data-action="fnName"> → window[fnName] (customer-tasks-ui.js
  // _nbdCustomerActionDispatch). dashboard.html uses a few bare data-action
  // names too (newEstimate, docgen).
  var WRITE_ACTIONS = [
    // lead edit
    'openEditCustomerModal', 'saveCustomerEdits', 'addServiceAddressRow', 'removeServiceAddressRow',
    'progressStage', 'openClaimEditor', 'saveClaimEdits', '_sendReferralCodeAndSms',
    // kanban card overflow (crm-pipeline.js card actions)
    'edit-lead', 'delete-lead', 'move-card',
    // notes
    'openNotesModal', 'saveNote', 'quickAddNote',
    // tasks + events
    'openTaskModal', 'saveTask', 'openEventModal', 'saveEvent',
    // photos
    'openUploadModal', 'uploadPhotos', 'togglePhotoSelectMode', 'applyBulkPhotoDelete', 'deletePhoto',
    'quickSetPhase', 'quickSetSeverity', 'setCoverPhotoFromPopup', '_openPhotoInEditorAndClose',
    'peDeletePhoto', 'peStagePhoto', 'peTagToggle', 'peBulkAnalyze',
    // documents (generate, upload, signed upload, delete) + photo reports
    'openDocCreateModal', 'openDocUploadModal', 'uploadDocuments', 'uploadSignedDoc',
    '_pickCustomerDoc', 'generateCustomerDoc', 'deleteCustomerDoc',
    'openPhotoReportPicker', 'generatePhotoReport', 'docgen',
    // estimates
    'openEstimateModal', 'saveEstimate', '_openInDashboardEstimate', '_openInDashboardJobTemplates',
    'newEstimate',
    // money + outreach that files a record
    'NBDCustomerInvoices.markPaid', 'ReviewEngine.sendReviewSMS',
  ];
  // dashboard.html: <el data-action="call" data-fn="fnName">.
  var WRITE_FNS = [
    // lead create / edit / delete / bulk
    'openLeadModal', 'saveLead', 'saveQuickLead', '_mCreate', 'editCardDetails', 'cdaEditLead',
    'confirmDeleteLead', 'cdaConfirmPromote', 'openLeadImport', 'loadSampleData',
    'bulkAssignCarrier', 'bulkAssignDamage', 'bulkAssignJobType', 'bulkAssignSource',
    'bulkDelete', 'bulkMoveStage', 'bulkSnoozeLeads',
    // notes + tasks
    'addTask', 'cdaOpenTaskModal', '_mJdQuickAddNote',
    // drawings + map
    'saveDrawingToCustomer', 'saveZone', 'startZoneDraw', 'commitPin', 'importToEstimate',
    // estimates
    'startNewEstimate', 'saveEstimate', 'openQMImportModal', 'applyQMData',
    // documents, invoices, voice memos
    'openUploadDoc', 'saveDocUpload', 'cdaInvoice', 'cdaVoiceMemo',
  ];
  // Controls with no data-action of their own.
  var WRITE_IDS = [
    'quickNoteWrap',        // customer.html inline note composer (textarea + Send)
    'editEstimateBtn',      // estimate viewer: Edit in Builder
    'deleteEstimateBtn',    // estimate viewer: Archive
    'repMsgSend',           // portal-message reply
  ];
  // Stays VISIBLE (it shows state) but a viewer's click does nothing but explain.
  var BLOCK_ONLY = [
    '.nbd-tl-task',         // customer timeline task row: click toggles done
    '.nbd-tl-task-check',   // …and its checkbox
    '.nbd-share-toggle',    // photo "shared with homeowner" pill
    '[data-action="run-next-action"]',                    // kanban next-action chip (logs contact, ...)
    '[data-change-action="toggleJobChecklistItem"]',      // customer job checklist tick box
  ];

  function _attr(v) { return String(v).replace(/["\\]/g, '\\$&'); }
  var HIDE_SELECTORS = []
    .concat(WRITE_ACTIONS.map(function (a) { return '[data-action="' + _attr(a) + '"]'; }))
    .concat(WRITE_FNS.map(function (f) { return '[data-action="call"][data-fn="' + _attr(f) + '"]'; }))
    .concat(WRITE_IDS.map(function (i) { return '#' + i; }));
  var GATED_SELECTOR = HIDE_SELECTORS.concat(BLOCK_ONLY).join(',');

  // ── Role ──────────────────────────────────────────────────────────────────
  function claims() {
    try { return window._userClaims || {}; } catch (_) { return {}; }
  }
  // Only a POSITIVE 'viewer' claim is read-only. No claims yet, or a solo
  // operator with no role claim, is not evidence of restriction (the same
  // stance customer-bootstrap's read-only banner takes).
  function isViewer(c) {
    c = c || claims();
    return !!c && c.role === 'viewer';
  }
  function canWrite(c) { return !isViewer(c); }

  var _lastNotice = 0;
  function notify() {
    var now = Date.now();
    if (now - _lastNotice < 2500) return;   // one toast per burst, not per write
    _lastNotice = now;
    if (typeof window.showToast === 'function') {
      try { window.showToast(VIEW_ONLY, 'info'); return; } catch (_) { /* fall through */ }
    }
    try {
      var el = document.getElementById('nbdRoleViewOnlyNotice');
      if (!el) {
        el = document.createElement('div');
        el.id = 'nbdRoleViewOnlyNotice';
        el.setAttribute('role', 'status');
        el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:100000;'
          + 'background:#1A3057;color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;'
          + 'font-weight:600;max-width:calc(100vw - 32px);box-shadow:0 6px 20px rgba(0,0,0,.3);';
        document.body.appendChild(el);
      }
      el.textContent = VIEW_ONLY;
      clearTimeout(el._t);
      el._t = setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 4000);
    } catch (_) { /* never let the notice itself throw */ }
  }

  // Call at the top of a save/open function: returns false (and explains) for
  // a viewer, true for everyone else.
  function guard() {
    if (!isViewer()) return true;
    notify();
    return false;
  }

  function isDenied(err) {
    if (!err) return false;
    var code = String(err.code || '');
    var msg = String(err.message || err);
    return code === 'permission-denied' || code === 'storage/unauthorized'
      || /PERMISSION_DENIED|insufficient permissions/i.test(msg);
  }
  function onWriteError(err) {
    if (isViewer() && isDenied(err)) notify();
  }

  // ── Layer 3: watch the write globals ──────────────────────────────────────
  // The wrapper returns the ORIGINAL promise/task, so callers see exactly what
  // they saw before (rejection included). The extra .then only observes.
  function watchResult(r) {
    if (r && typeof r.then === 'function') {
      try { r.then(null, onWriteError); } catch (_) { /* not a real thenable */ }
    }
    return r;
  }
  function wrapWrite(fn) {
    if (typeof fn !== 'function' || fn.__nbdRoleGate) return fn;
    var w = function () { return watchResult(fn.apply(this, arguments)); };
    w.__nbdRoleGate = true;
    return w;
  }
  function wrapBatchFactory(fn) {
    if (typeof fn !== 'function' || fn.__nbdRoleGate) return fn;
    var w = function () {
      var b = fn.apply(this, arguments);
      if (b && typeof b.commit === 'function' && !b.__nbdRoleGate) {
        var commit = b.commit;
        try {
          b.commit = function () { return watchResult(commit.apply(b, arguments)); };
          b.__nbdRoleGate = true;
        } catch (_) { /* frozen batch: leave it */ }
      }
      return b;
    };
    w.__nbdRoleGate = true;
    return w;
  }
  // An accessor, not a one-time wrap: the bootstrap modules assign these
  // globals AFTER this file runs (and billing-gate / nbd-auth re-assign
  // _userClaims later), so every assignment passes through the setter.
  function watchGlobal(name, wrapFn, onSet) {
    var current = wrapFn ? wrapFn(window[name]) : window[name];
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get: function () { return current; },
        set: function (v) {
          current = wrapFn ? wrapFn(v) : v;
          if (onSet) onSet();
        },
      });
    } catch (_) {
      // Non-configurable (declared with var/function by some script): wrap
      // what is there now; later reassignments go unwatched.
      if (wrapFn) { try { window[name] = wrapFn(window[name]); } catch (__) { /* ignore */ } }
    }
  }

  // ── Layer 1: the class that drives the CSS ────────────────────────────────
  function sync() {
    var root = document.documentElement;
    if (root && root.classList) root.classList.toggle('nbd-role-viewer', isViewer());
  }

  function injectStyle() {
    if (document.getElementById('nbdRoleGateStyle')) return;
    var st = document.createElement('style');
    st.id = 'nbdRoleGateStyle';
    st.textContent = HIDE_SELECTORS.map(function (s) { return 'html.nbd-role-viewer ' + s; }).join(',\n')
      + '{display:none!important}';
    (document.head || document.documentElement).appendChild(st);
  }

  // ── Layer 2: the capture-phase guard ──────────────────────────────────────
  function gatedEl(target) {
    if (!target || typeof target.closest !== 'function') return null;
    try { return target.closest(GATED_SELECTOR); } catch (_) { return null; }
  }
  function onActivate(e) {
    if (!isViewer()) return;
    if (e.type === 'keydown') {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      // Never eat typing. A Space/Enter on a native control becomes a click,
      // which the click branch catches anyway.
      var t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(t.tagName) || t.isContentEditable)) return;
    }
    if (!gatedEl(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    notify();
  }

  function install() {
    watchGlobal('_userClaims', null, sync);
    ['addDoc', 'setDoc', 'updateDoc', 'deleteDoc', 'runTransaction', 'uploadBytes', 'uploadBytesResumable']
      .forEach(function (n) { watchGlobal(n, wrapWrite); });
    watchGlobal('writeBatch', wrapBatchFactory);
    injectStyle();
    document.addEventListener('click', onActivate, true);
    document.addEventListener('keydown', onActivate, true);
    sync();
  }

  window.NBDRole = {
    VIEW_ONLY: VIEW_ONLY,
    isViewer: isViewer,
    canWrite: canWrite,
    guard: guard,
    notify: notify,
    isDenied: isDenied,
    sync: sync,
    // exposed for tests (tests/role-gate.test.js)
    _gatedSelector: GATED_SELECTOR,
    _hideSelectors: HIDE_SELECTORS,
    _wrapWrite: wrapWrite,
    _wrapBatchFactory: wrapBatchFactory,
    _resetNoticeThrottle: function () { _lastNotice = 0; },
  };
  install();
})();
