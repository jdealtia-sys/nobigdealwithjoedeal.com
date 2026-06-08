// Firebase bootstrap module + dashboard top-level wiring (extracted
// from an inline <script type="module"> in dashboard.html for CSP
// compliance — production `script-src-elem 'self'` blocks inline
// scripts, which had been hanging the dashboard at the load screen).
//
// Module scripts are implicitly deferred and execute in document
// order, so this still runs after dashboard-appcheck-config.js sets
// window.__NBD_APP_CHECK_KEY and after dashboard-auth-gate.module.js.
  import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
  import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";
  import { getAuth, onAuthStateChanged, signOut, updateProfile, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
  import { getFirestore, collection, addDoc, getDocs, getDoc, updateDoc, deleteDoc, doc, orderBy, query, serverTimestamp, where, arrayUnion, limit, startAfter, setDoc, writeBatch, runTransaction, onSnapshot, disableNetwork, enableNetwork } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
  import { getStorage, ref, uploadBytes, getDownloadURL, listAll } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
  import { connectEmulatorsIfLocal } from "./nbd-emulator-connect.js"; // Audit #3: localhost-only, no-op in prod

  // ═══ GLOBAL CRM STATE (MUST BE TOP-LEVEL) ═══
  // Per S27 architectural rule: All CRM global state declared before any function definitions
  // NOTE: Module scope is isolated - must expose to window for global access
  import {
    S, STAGE_META, LEGACY_MAP, KANBAN_VIEWS,
    VIEW_SIMPLE, VIEW_INSURANCE, VIEW_CASH, VIEW_FINANCE, VIEW_WARRANTY, VIEW_SERVICE, VIEW_JOBS,
    normalizeStage, stageLabel, stageColor, resolveColumn,
    stageOptionsForType, inferJobType, JOB_TYPES, JOB_TYPE_META, jobTypeLabel,
    SUB_TYPES, subTypeOptionsFor, subTypeLabel,
    TRADES, tradeLabel, tradesLabel,
    STAGE_ACTIONS, actionsForStage,
    REQUIRED_FIELDS_BY_TYPE, requiredFieldsFor, missingRequiredFields,
    tagClass as _tagClass
  } from './crm-stages.js';
  // Expose the new helpers to non-module scripts (crm.js)
  window.actionsForStage = actionsForStage;
  window.requiredFieldsFor = requiredFieldsFor;
  window.missingRequiredFields = missingRequiredFields;
  window.subTypeOptionsFor = subTypeOptionsFor;
  window.subTypeLabel = subTypeLabel;
  window.tradeLabel = tradeLabel;
  window.tradesLabel = tradesLabel;
  window.jobTypeLabel = jobTypeLabel;
  window.TRADES = TRADES;
  window.SUB_TYPES = SUB_TYPES;
  window.JOB_TYPE_META = JOB_TYPE_META;
  // Phase marker for the pre-module error trap (v159.5+) so the diag
  // banner can pinpoint where init died if a downstream import throws.
  window.__nbdMark && window.__nbdMark('m2:stagesImport');

  // Legacy compat — default to insurance pipeline view
  const _currentViewKey = localStorage.getItem('nbd_kanban_view') || 'insurance';
  const _currentViewStages = KANBAN_VIEWS[_currentViewKey]?.stages || VIEW_INSURANCE;

  // Legacy STAGES array — now derived from current view's stage labels
  const STAGES = _currentViewStages.map(k => STAGE_META[k]?.label || k);
  let _dragId = null;
  let _filteredLeads = null;

  // Expose stage system to window for non-module scripts (crm.js, etc.)
  window.STAGES = STAGES;
  window._stageKeys = _currentViewStages;        // Internal stage keys for current view
  window._currentViewKey = _currentViewKey;
  window.S = S;
  window.STAGE_META = STAGE_META;
  window.KANBAN_VIEWS = KANBAN_VIEWS;
  window.normalizeStage = normalizeStage;
  window.stageLabel = stageLabel;
  window.stageColor = stageColor;
  window.resolveColumn = resolveColumn;
  window.stageOptionsForType = stageOptionsForType;
  window.inferJobType = inferJobType;
  window.JOB_TYPES = JOB_TYPES;
  window._dragId = _dragId;
  window._filteredLeads = _filteredLeads;

  // ── Dynamic kanban column builder ──
  window.buildKanbanColumns = function(viewKey) {
    const view = KANBAN_VIEWS[viewKey || _currentViewKey];
    if (!view) return;
    const stages = view.stages;
    const board = document.getElementById('kanbanBoard');
    if (!board) return;
    board.innerHTML = stages.map(stageKey => {
      const meta = STAGE_META[stageKey] || {};
      const label = meta.label || stageKey;
      const hdrClass = meta.headerClass || 'kh-new';
      return `
      <div class="kanban-col" id="kcol-${stageKey}">
        <div class="kcol-header ${hdrClass}">
          <div class="kcol-label">${label}</div>
          <div class="kcol-meta">
            <div class="kcol-count" id="kcount-${stageKey}">0</div>
            <div class="kcol-total dn" id="ktotal-${stageKey}"></div>
          </div>
        </div>
        <div class="kcol-body" id="kbody-${stageKey}"
          ondragover="event.preventDefault()" ondrop="drop(event,'${stageKey}')">
          <div class="k-empty">No leads</div>
        </div>
      </div>`;
    }).join('');

    // Update STAGES + _stageKeys for crm.js compat
    window.STAGES = stages.map(k => STAGE_META[k]?.label || k);
    window._stageKeys = stages;
    window._currentViewKey = viewKey || _currentViewKey;
    localStorage.setItem('nbd_kanban_view', window._currentViewKey);
  };

  // ── Job type field toggle ──
  window.toggleInsuranceFields = function() {
    const jt = document.getElementById('lJobType')?.value || '';
    const ins = document.getElementById('insuranceFieldsBlock');
    const fin = document.getElementById('financeFieldsBlock');
    const job = document.getElementById('jobFieldsBlock');
    if (ins) ins.style.display = (jt === 'insurance' || jt === '') ? (document.getElementById('lInsCarrier')?.value ? 'block' : (jt === 'insurance' ? 'block' : 'none')) : 'none';
    if (ins && jt === 'insurance') ins.style.display = 'block';
    if (fin) fin.style.display = jt === 'finance' ? 'block' : 'none';
    // Show job fields if stage is post-contract
    const stageVal = document.getElementById('lStage')?.value || '';
    const jobStages = ['job_created','permit_pulled','materials_ordered','materials_delivered','crew_scheduled','install_in_progress','install_complete','final_photos','deductible_collected','final_payment','closed'];
    if (job) job.style.display = jobStages.includes(stageVal) ? 'block' : 'none';
    // Smart stage dropdown — hide irrelevant track optgroups based on jobType
    window.filterStageDropdownByJobType && window.filterStageDropdownByJobType(jt);
    // Sub-type + trades row: visible only when a job type is set
    window.refreshSubTypeAndTrades && window.refreshSubTypeAndTrades(jt);
    // Next Actions panel: refreshes whenever job type or stage changes
    window.renderNextActionsPanel && window.renderNextActionsPanel();
  };

  // ── Sub-type + trades row population ──
  // Sub-type options come from SUB_TYPES[jobType]. Trades is a fixed list
  // of multi-select chips; the selection lives on the chip's data-selected
  // attribute and is read on save. Both hide together until job type is set.
  window.refreshSubTypeAndTrades = function(jobType) {
    const row = document.getElementById('lSubTypeRow');
    if (!row) return;
    if (!jobType) { row.style.display = 'none'; return; }
    row.style.display = '';

    // Sub-type select — preserve current value if still valid for the new type
    const subSel = document.getElementById('lSubType');
    if (subSel) {
      const prev = subSel.value;
      const options = (window.subTypeOptionsFor ? window.subTypeOptionsFor(jobType) : []);
      subSel.innerHTML = '<option value="">— optional —</option>' +
        options.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
      const stillValid = options.some(o => o.value === prev);
      if (stillValid) subSel.value = prev;
    }

    // Trades chips — render once, preserve selection across job type changes
    const tradeGroup = document.getElementById('lTradesGroup');
    if (tradeGroup && tradeGroup.children.length === 0 && Array.isArray(window.TRADES)) {
      tradeGroup.innerHTML = window.TRADES.map(t => `
        <button type="button" class="trade-chip" data-value="${t.value}" data-selected="0"
          style="font-size:11px;padding:4px 10px;border-radius:14px;border:1px solid var(--br);background:var(--s2);color:var(--m);cursor:pointer;font-family:inherit;letter-spacing:.02em;"
          data-action="tradeChip">${t.icon || ''} ${t.label}</button>
      `).join('');
    }
  };

  // Toggle a trade chip selection on/off (visual + data-selected flag)
  window.toggleTradeChip = function(btn) {
    const on = btn.dataset.selected === '1';
    btn.dataset.selected = on ? '0' : '1';
    if (on) {
      btn.style.background = 'var(--s2)';
      btn.style.color = 'var(--m)';
      btn.style.borderColor = 'var(--br)';
    } else {
      btn.style.background = 'var(--orange)';
      btn.style.color = '#fff';
      btn.style.borderColor = 'var(--orange)';
    }
  };

  // Read currently-selected trades as an array of values
  window.getSelectedTrades = function() {
    const group = document.getElementById('lTradesGroup');
    if (!group) return [];
    return Array.from(group.querySelectorAll('.trade-chip[data-selected="1"]'))
      .map(b => b.dataset.value);
  };

  // Reflect a saved trades array onto the chip UI
  window.setSelectedTrades = function(trades) {
    const group = document.getElementById('lTradesGroup');
    if (!group) return;
    const set = new Set(Array.isArray(trades) ? trades : []);
    group.querySelectorAll('.trade-chip').forEach(b => {
      const on = set.has(b.dataset.value);
      b.dataset.selected = on ? '1' : '0';
      b.style.background = on ? 'var(--orange)' : 'var(--s2)';
      b.style.color = on ? '#fff' : 'var(--m)';
      b.style.borderColor = on ? 'var(--orange)' : 'var(--br)';
    });
  };

  // ── Next Actions panel ──
  // Driven by STAGE_ACTIONS in crm-stages.js. Renders the context-aware
  // list of actions for the current stage + job type. Buttons emit a
  // CustomEvent('nbd:lead-action', {detail:{actionId, ...}}) — wire-up
  // happens incrementally as each action lands.
  window.renderNextActionsPanel = function() {
    const panel = document.getElementById('nextActionsPanel');
    if (!panel) return;
    const stage = document.getElementById('lStage')?.value || '';
    const jt    = document.getElementById('lJobType')?.value || '';
    const editId = document.getElementById('lEditId')?.value || '';
    if (!editId) { panel.style.display = 'none'; return; } // hide on new lead
    const actions = (window.actionsForStage ? window.actionsForStage(stage, jt) : []);
    if (!actions.length) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    const stageName = (window.STAGE_META && window.STAGE_META[stage])?.label || stage || 'this stage';
    panel.querySelector('.nap-title').textContent = `Next actions — ${stageName}`;
    const body = panel.querySelector('.nap-body');
    body.innerHTML = actions.map(a => `
      <button type="button" class="nap-btn" data-action-id="${a.id}" data-kind="${a.kind}"
        data-action="call" data-fn="runLeadAction" data-arg="${a.id}" data-arg2="${a.kind}"
        title="${a.kind === 'doc' ? 'Generate document' : a.kind === 'stage' ? 'Advance stage' : 'Action'}">
        <span class="nap-ico">${a.icon || ''}</span>
        <span class="nap-lbl">${a.label}</span>
        <span class="nap-kind nap-kind-${a.kind}">${a.kind}</span>
      </button>
    `).join('');
  };

  // ── Next Actions dispatch ──
  // Routes a chip click to the right handler. Three families:
  //   - kind: 'stage'  → advance the lead to a target stage via moveCard
  //   - kind: 'doc'    → route to the doc generator (estimate, photo report,
  //                      etc.) when we have an implementation; otherwise
  //                      log a timeline note + honest toast.
  //   - kind: 'action' → log a timeline note + honest toast (most are
  //                      "log that you did this" workflow markers).
  // Every action also emits the nbd:lead-action CustomEvent so callers
  // (Ask Joe proactive, telemetry) can observe.
  //
  // ACTION_MAP keys are action IDs from STAGE_ACTIONS (crm-stages.js).
  // The default branch is reached for anything not yet enumerated;
  // those still get the timeline-log fallback so the chip is useful
  // even without a custom handler.
  const STAGE_TARGETS = {
    mark_adj_done:  'adjuster_inspection_done',
    create_job:     'job_created',
    start_install:  'install_in_progress',
    close_job:      'closed'
  };

  // Map our Next-Action chip IDs → NBDDocGen document types. The doc
  // templates already exist in document-generator.js + -templates.js;
  // we're just wiring the chips to them. inspect_report is special-cased
  // below to pick the homeowner vs insurance variant by job type.
  const ACTION_DOC_MAP = {
    send_aob:        'assignment_of_benefits',
    send_contract:   'contract',
    work_order:      'work_authorization',
    change_order:    'change_order',
    closeout:        'certificate_of_completion',
    final_invoice:   'invoice',
    warranty_cert:   'warranty_certificate',
    warranty_report: 'before_after_report'
  };

  // Convert a lead record to the merge-data shape the NBDDocGen templates
  // expect. Different templates pull different fields out of the bag —
  // this helper populates the superset so any template gets what it needs.
  // Missing values become empty strings; the templates already substitute
  // their own placeholders ("[Homeowner Name]") for falsy values.
  function _leadToDocData(lead) {
    if (!lead) return {};
    const fname = (lead.firstName || lead.fname || '').trim();
    const lname = (lead.lastName  || lead.lname || '').trim();
    const homeownerName = (fname + ' ' + lname).trim() || lead.address || '';
    const job = Number(lead.jobValue) || Number(lead.estimateAmount) || 0;
    const ded = Number(lead.deductibleOrOwedByHO) || 0;
    return {
      // Universal fields used by most templates + the simple {{token}} renderer
      homeownerName,
      address:           lead.address || '',
      homeownerPhone:    lead.phone || '',
      homeownerEmail:    lead.email || '',
      phone:             lead.phone || '',
      email:             lead.email || '',
      // Insurance fields (renderAssignmentOfBenefits, renderSupplementRequest, renderClaimGuide, etc.)
      insuranceCompany:  lead.insCarrier || lead.insuranceCarrier || '',
      claimNumber:       lead.claimNumber || '',
      policyNumber:      lead.policyNumber || '',
      dateOfLoss:        lead.dateOfLoss || '',
      scopeSummary:      lead.scopeOfWork || (lead.damageType ? lead.damageType + ' repair' : ''),
      // Financial fields (invoice, change order, contract)
      originalTotal:     job || undefined,
      totalPrice:        job ? '$' + job.toLocaleString() : '$0.00',
      deductible:        ded || undefined,
      // Project description for {{token}} templates
      projectDescription: lead.scopeOfWork || lead.damageType || '',
      // Job-type / sub-type / trades (Pre-W159 data compat sweep) —
      // Future doc variants will switch on sub-type (storm AOB vs
      // fire AOB) and trades (roof+gutters combo line items). Surface
      // them defensively here so templates can read data.subType
      // and data.trades without guards.
      jobType:           lead.jobType || '',
      subType:           lead.subType || '',
      trades:            Array.isArray(lead.trades) ? lead.trades : [],
      tradesLabel:       Array.isArray(lead.trades) && lead.trades.length
                           ? (typeof window.tradesLabel === 'function' ? window.tradesLabel(lead.trades) : lead.trades.join(', '))
                           : '',
      // Identifiers
      leadId:            lead.id,
      customer:          { id: lead.id, name: homeownerName, address: lead.address, phone: lead.phone, email: lead.email },
      // Pass through the whole lead so any template can dig in if needed
      lead:              lead
    };
  }

  function _findLead(id) {
    if (!id || !Array.isArray(window._leads)) return null;
    return window._leads.find(l => l && l.id === id) || null;
  }

  function _logLeadActivity(leadId, actionId, label) {
    // Append a lightweight activity entry. We use updateDoc with
    // arrayUnion so concurrent activity entries from other tabs don't
    // clobber each other. If Firestore isn't loaded yet this no-ops
    // gracefully — the toast still fires.
    if (!leadId || !window.db || !window.doc || !window.updateDoc || !window.arrayUnion) return Promise.resolve(false);
    const entry = {
      type: 'next_action',
      actionId: actionId,
      label: label || actionId,
      ts: new Date().toISOString(),
      user: (window._user && window._user.email) || 'unknown'
    };
    return window.updateDoc(window.doc(window.db, 'leads', leadId), {
      activityLog: window.arrayUnion(entry),
      updatedAt: window.serverTimestamp ? window.serverTimestamp() : new Date()
    }).then(() => true).catch(err => {
      console.warn('logLeadActivity failed:', err && err.message);
      return false;
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Doc-data bridge — lets DocPreflight (js/doc-preflight.js) run from
  // the dashboard the same way it runs on customer.html. The customer
  // page defines its own getCustomerDocData / checkPrerequisites /
  // DOC_PREREQUISITES; we mirror the shape here for the dashboard
  // context, sourcing from window._leads / _estimates / _photoCache.
  //
  // We don't clobber the customer-page versions — these only assign
  // to window.* when the customer-page copies haven't been set yet.
  // ─────────────────────────────────────────────────────────────────
  const _DASH_DOC_PREREQUISITES = {
    proposal:                   { needs: ['estimate'],                  label: 'Proposal / Estimate', msg: 'Build an estimate first.' },
    contract:                   { needs: ['estimate', 'contact'],       label: 'Roofing Contract',    msg: 'Build an estimate and add customer contact info.' },
    work_authorization:         { needs: ['address', 'scope'],          label: 'Work Authorization',  msg: 'Add property address and scope of work.' },
    scope_of_work:              { needs: ['estimate'],                  label: 'Scope of Work',       msg: 'Build an estimate to generate scope details.' },
    inspectionHomeowner:        { needs: ['photos'],                    label: 'Inspection Report',   msg: 'Upload inspection photos first.' },
    inspectionInsurance:        { needs: ['photos', 'claim'],           label: 'Insurance Report',    msg: 'Upload photos and add insurance carrier + claim #.' },
    supplement_request:         { needs: ['estimate', 'claim'],         label: 'Supplement Request',  msg: 'Requires an estimate and filed insurance claim.' },
    warranty_certificate:       { needs: ['jobComplete'],               label: 'Warranty Certificate',msg: 'Job must be marked Complete to generate warranty.' },
    certificate_of_completion:  { needs: ['jobComplete', 'beforeAfterPhotos'], label: 'Certificate of Completion', msg: 'Job must be complete with before & after photos.' },
    invoice:                    { needs: ['jobValue'],                  label: 'Invoice',             msg: 'Add a job value or build an estimate first.' },
    change_order:               { needs: ['estimate'],                  label: 'Change Order',        msg: 'Requires an existing estimate to modify.' },
    before_after_report:        { needs: ['beforeAfterPhotos'],         label: 'Before & After Report', msg: 'Need BOTH before and after photos uploaded.' },
    financing_options:          { needs: ['jobValue'],                  label: 'Financing Options',   msg: 'Add a job value or build an estimate.' },
    assignment_of_benefits:     { needs: ['claim'],                     label: 'Assignment of Benefits', msg: 'Requires an insurance claim (carrier + claim #).' },
    payment_agreement:          { needs: ['jobValue', 'contact'],       label: 'Payment Agreement',   msg: 'Add job value and customer contact info.' }
  };

  function _dashGetCustomerDocData(leadId) {
    const lead = (window._leads || []).find(l => l && l.id === leadId) || {};
    const id = leadId;
    const estimates = (window._estimates || []).filter(e => e && (e.leadId === leadId || e.customerId === leadId));
    const photoBag = (window._photoCache && window._photoCache[leadId]) || [];
    const est = estimates.length > 0 ? estimates[0] : null;
    const before = photoBag.filter(p => (p.phase || '').toLowerCase() === 'before');
    const after  = photoBag.filter(p => (p.phase || '').toLowerCase() === 'after');
    const during = photoBag.filter(p => (p.phase || '').toLowerCase() === 'during');
    const fname = (lead.firstName || lead.fname || '').trim();
    const lname = (lead.lastName  || lead.lname || '').trim();
    const name  = (fname + ' ' + lname).trim();
    const jobVal = lead.jobValue || (est ? est.grandTotal : 0);
    const isComplete = (lead.stage || '').toLowerCase().includes('complete') ||
                       (lead.stage || '').toLowerCase().includes('closed');
    return {
      // Customer
      homeownerName: name, customerName: name,
      firstName: fname, lastName: lname,
      address: lead.address || '', homeownerAddress: lead.address || '',
      phone:   lead.phone   || '', customerPhone:   lead.phone   || '',
      email:   lead.email   || '', customerEmail:   lead.email   || '',
      // Job — subType + trades added for parity with customer.html's
      // getCustomerDocData (Pre-W159 data compat sweep). Without these,
      // doc templates that switch on sub-type (e.g. storm AOB vs fire
      // AOB) or list trades (e.g. roof+gutters line items) would see
      // undefined and either crash on .join() or render blank.
      damageType: lead.damageType || '', stage: lead.stage || '',
      source: lead.source || '', notes: lead.notes || '',
      jobType: lead.jobType || '', jobValue: jobVal,
      subType: lead.subType || '',
      trades:  Array.isArray(lead.trades) ? lead.trades : [],
      tradesLabel: Array.isArray(lead.trades) && lead.trades.length
                     ? (typeof window.tradesLabel === 'function' ? window.tradesLabel(lead.trades) : lead.trades.join(', '))
                     : '',
      scopeOfWork: lead.scopeOfWork || '',
      projectDescription: lead.scopeOfWork || (est && est.description) || '',
      // Insurance
      insCarrier: lead.insCarrier || '', insuranceCompany: lead.insCarrier || '',
      claimNumber: lead.claimNumber || '', claimStatus: lead.claimStatus || '',
      policyNumber: lead.policyNumber || '',
      dateOfLoss: lead.dateOfLoss || '',
      deductible: lead.deductibleOrOwedByHO || '',
      supplementStatus: lead.supplementStatus || '',
      // Estimate
      totalPrice:     jobVal ? '$' + Number(jobVal).toLocaleString() : '',
      estimateAmount: jobVal ? '$' + Number(jobVal).toLocaleString() : '',
      contractPrice:  jobVal ? '$' + Number(jobVal).toLocaleString() : '',
      warrantyTier:   (est && (est.tier || est.tierName)) || lead.warrantyTier || '',
      estimateLineItems: (est && est.lineItems) || [],
      // Photos
      beforePhotoUrl: (before[0] && before[0].url) || '',
      afterPhotoUrl:  (after[0]  && after[0].url)  || '',
      beforePhotos: before, afterPhotos: after, duringPhotos: during,
      photoCount: photoBag.length, allPhotos: photoBag,
      // Meta
      date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      leadId: id,
      // Prerequisite flags
      _hasEstimate: estimates.length > 0,
      _hasPhotos:   photoBag.length > 0,
      _hasBeforeAfterPhotos: before.length > 0 && after.length > 0,
      _hasClaim:    !!(lead.claimNumber && lead.insCarrier),
      _hasContact:  !!(lead.phone || lead.email),
      _hasAddress:  !!lead.address,
      _hasScope:    !!(lead.scopeOfWork || (est && est.description)),
      _hasJobValue: !!jobVal,
      _isJobComplete: isComplete
    };
  }

  function _dashCheckPrerequisites(type, data) {
    const prereq = _DASH_DOC_PREREQUISITES[type];
    if (!prereq) return { ok: true };
    const missing = [];
    for (const need of prereq.needs) {
      switch (need) {
        case 'estimate':  if (!data._hasEstimate)  missing.push('Build an estimate'); break;
        case 'contact':   if (!data._hasContact)   missing.push('Add phone or email'); break;
        case 'address':   if (!data._hasAddress)   missing.push('Add property address'); break;
        case 'scope':     if (!data._hasScope)     missing.push('Add scope of work'); break;
        case 'photos':    if (!data._hasPhotos)    missing.push('Upload inspection photos'); break;
        case 'claim':     if (!data._hasClaim)     missing.push('Add insurance carrier & claim number'); break;
        case 'jobValue':  if (!data._hasJobValue)  missing.push('Add job value or build estimate'); break;
        case 'jobComplete': if (!data._isJobComplete) missing.push('Mark job as Complete / Closed'); break;
        case 'beforeAfterPhotos': if (!data._hasBeforeAfterPhotos) missing.push('Upload both Before AND After photos'); break;
      }
    }
    return missing.length ? { ok: false, missing, label: prereq.label, msg: prereq.msg } : { ok: true };
  }

  // Expose only if the customer-page versions aren't there. Customer
  // page wins because it has fresh-loaded estimates/photos for the
  // open lead; the dashboard variant pulls from cached _leads /
  // _estimates / _photoCache.
  if (typeof window.getCustomerDocData !== 'function') {
    window.getCustomerDocData = function(maybeLeadId) {
      const id = maybeLeadId || window._customerId || document.getElementById('lEditId')?.value;
      return _dashGetCustomerDocData(id);
    };
  }
  if (typeof window.checkPrerequisites !== 'function') {
    window.checkPrerequisites = _dashCheckPrerequisites;
  }

  // Stage the window globals doc-preflight.js reads from. The preflight
  // module uses window._leadDoc / _customerId / _customerEstimates /
  // _allPhotos as its source of truth; on the dashboard these aren't
  // set, so we mirror them just-in-time before opening the modal.
  function _stageWindowStateForLead(leadId) {
    const lead = (window._leads || []).find(l => l && l.id === leadId);
    if (!lead) return false;
    window._leadDoc = lead;
    window._customerId = leadId;
    window._customerEstimates = (window._estimates || []).filter(e => e && (e.leadId === leadId || e.customerId === leadId));
    window._allPhotos = (window._photoCache && window._photoCache[leadId]) || [];
    return true;
  }

  // Render the "Can't generate — missing X" modal. Copy of the same UX
  // pattern used on customer.html, so the rep sees the same message
  // regardless of where they triggered generation from.
  function _showPrereqModal(check) {
    const escFn = window.nbdEsc || (s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `
      <div style="background:var(--s,#111);border:1px solid var(--br,#333);border-radius:14px;padding:32px;max-width:440px;width:90%;text-align:center;">
        <div style="font-size:32px;margin-bottom:12px;">⚠️</div>
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:20px;font-weight:700;color:var(--t,#fff);margin-bottom:8px;">Can't generate ${escFn(check.label || 'document')}</div>
        <div style="font-size:13px;color:var(--m,#888);margin-bottom:16px;">${escFn(check.msg || 'This document needs data that hasn’t been added yet:')}</div>
        <div style="text-align:left;background:var(--s2,#1a1a2e);border-radius:8px;padding:14px;margin-bottom:20px;">
          ${check.missing.map(m => '<div style="font-size:13px;color:var(--orange,#e8720c);padding:4px 0;">• ' + escFn(m) + '</div>').join('')}
        </div>
        <button class="nbd-preq-close" style="padding:12px 28px;background:var(--orange,#e8720c);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;">Got it</button>
      </div>`;
    modal.querySelector('.nbd-preq-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
  }

  // Helper used by the doc branch — runs prerequisites + opens the
  // preflight modal (which calls NBDDocGen.generate on submit). Falls
  // through to direct generate if DocPreflight isn't loaded yet.
  function _generateDocWithPreflight(docType, leadId) {
    if (!leadId) {
      if (typeof showToast === 'function') showToast('Open a lead first', 'warning');
      return;
    }
    if (!_stageWindowStateForLead(leadId)) {
      if (typeof showToast === 'function') showToast('Lead not found — refresh the page and try again', 'error');
      return;
    }
    const data = _dashGetCustomerDocData(leadId);
    const check = _dashCheckPrerequisites(docType, data);
    if (!check.ok) {
      _showPrereqModal(check);
      return;
    }
    // PR 2b: the doc-generation cluster (DocPreflight + NBDDocGen) is now
    // lazy. If the rep hit a doc chip before the `docgen` bundle loaded
    // (e.g. before ever opening the Docs view), load it on demand, then run.
    // DocPreflight is preferred; NBDDocGen.generate is the fall-through so
    // the rep isn't blocked.
    const _run = () => {
      if (window.DocPreflight && typeof window.DocPreflight.open === 'function') {
        window.DocPreflight.open(docType, leadId);
        return;
      }
      if (window.NBDDocGen && typeof window.NBDDocGen.generate === 'function') {
        window.NBDDocGen.generate(docType, data);
      } else if (typeof showToast === 'function') {
        showToast('Document generator is still loading — try again in a moment', 'warning');
      }
    };
    if (window.DocPreflight || window.NBDDocGen) { _run(); return; }
    if (window.ScriptLoader && typeof window.ScriptLoader.loadBundle === 'function') {
      window.ScriptLoader.loadBundle('docgen').then(_run);
      return;
    }
    _run();
  }

  window.runLeadAction = function(actionId, kind) {
    const leadId = document.getElementById('lEditId')?.value || null;
    const lead = _findLead(leadId);
    // Emit for observers regardless of how the action is handled.
    document.dispatchEvent(new CustomEvent('nbd:lead-action', {
      detail: { actionId, kind, leadId }
    }));

    // ── Stage advances ──
    if (kind === 'stage') {
      const target = STAGE_TARGETS[actionId];
      if (target && leadId && typeof window.moveCard === 'function') {
        // Close the lead modal first so the kanban renders the new stage
        if (typeof window.closeLeadModal === 'function') window.closeLeadModal();
        window.moveCard(leadId, target);
        return;
      }
      // Fall through — stage actions without a target shouldn't happen,
      // but if they do we toast honestly rather than silently doing nothing.
      if (typeof showToast === 'function') showToast('Stage target not configured for this action', 'warning');
      return;
    }

    // ── Document generators ──
    if (kind === 'doc') {
      // 1. Native (lead-aware) handlers first — these have their own
      //    UI flows and don't route through the generic NBDDocGen viewer.
      if (actionId === 'photo_report') {
        if (typeof window.generatePhotoReport === 'function' && leadId) {
          try { window.generatePhotoReport(leadId); return; } catch (e) { console.warn('generatePhotoReport threw:', e.message); }
        }
      } else if (actionId === 'send_estimate' || actionId === 'send_quote' || actionId === 'revise_estimate') {
        if (typeof window.startNewEstimate === 'function' && leadId) {
          try { window.startNewEstimate(leadId); return; } catch (e) { console.warn('startNewEstimate threw:', e.message); }
        }
      } else if (actionId === 'inspect_report') {
        // Pick the right inspection variant — insurance leads get the
        // technical (code citations) report, others get the homeowner
        // (cleaner, readable) variant.
        const docType = (lead && lead.jobType === 'insurance') ? 'inspectionInsurance' : 'inspectionHomeowner';
        _generateDocWithPreflight(docType, leadId);
        return;
      } else if (actionId === 'request_supp') {
        // request_supp is wired as kind:'action' in STAGE_ACTIONS (it
        // changes supplementStatus), but if it ever arrives as a doc
        // generation request, route to the supplement_request letter.
        _generateDocWithPreflight('supplement_request', leadId);
        return;
      } else if (ACTION_DOC_MAP[actionId]) {
        // 2. Mapped doc types — every other chip with a doc kind whose
        //    action ID is in ACTION_DOC_MAP (AOB, contract, change order,
        //    invoice, warranty cert, etc.) goes through DocPreflight,
        //    which gathers any missing merge fields and persists the
        //    rep's edits (LEAD / DOCUMENT / EPHEMERAL) before calling
        //    NBDDocGen.generate. Prereq check happens inside the
        //    helper — if the lead is missing required data (claim #,
        //    estimate, before/after photos, etc.) we show a clear
        //    modal listing what's needed instead of generating a doc
        //    full of placeholder strings.
        _generateDocWithPreflight(ACTION_DOC_MAP[actionId], leadId);
        return;
      }
      // 3. Generic fallback for any doc-kind chip we haven't mapped yet.
      //    Logs to the lead activity so the rep at least has a marker.
      const docLabel = (actionId || 'document').replace(/_/g, ' ');
      if (typeof showToast === 'function') {
        showToast(`"${docLabel}" — logged on the lead (generator wiring pending)`, 'info');
      }
      if (leadId) _logLeadActivity(leadId, actionId, docLabel);
      return;
    }

    // ── Plain workflow actions ──
    // No doc, no stage change — just record that the rep did the thing.
    // Useful for "Log Contact", "Follow Up", "Order Materials", etc.
    const label = (actionId || 'action').replace(/_/g, ' ');
    if (leadId) {
      _logLeadActivity(leadId, actionId, label).then(ok => {
        if (typeof showToast === 'function') {
          showToast(ok ? `✓ Logged: ${label}` : `Couldn't log ${label} — try again`, ok ? 'success' : 'warning');
        }
      });
    } else {
      if (typeof showToast === 'function') showToast('Open a lead first to log this action', 'warning');
    }
  };

  // ── Smart stage dropdown filter ──
  // Hide optgroups from other tracks based on the selected jobType.
  // Preserves the current selection even if its track would be hidden —
  // shows a small warning instead of silently switching stages.
  window.filterStageDropdownByJobType = function(jobType) {
    const sel = document.getElementById('lStage');
    if (!sel) return;
    const currentVal = sel.value;
    const groups = sel.querySelectorAll('optgroup');
    let currentOptVisible = true;
    groups.forEach(g => {
      const label = (g.label || '').toLowerCase();
      let show = true;
      // Hide optgroups labeled for other tracks. Empty jobType shows everything.
      if (jobType === 'insurance') {
        if (label.includes('cash') || label.includes('finance') || label.includes('warranty') || label.includes('service')) show = false;
      } else if (jobType === 'cash') {
        if (label.includes('insurance') || label.includes('finance') || label.includes('warranty') || label.includes('service')) show = false;
      } else if (jobType === 'finance') {
        if (label.includes('insurance') || label.includes('cash') || label.includes('warranty') || label.includes('service')) show = false;
      } else if (jobType === 'warranty') {
        if (label.includes('insurance') || label.includes('cash') || label.includes('finance') || label.includes('service')) show = false;
      } else if (jobType === 'service') {
        if (label.includes('insurance') || label.includes('cash') || label.includes('finance') || label.includes('warranty')) show = false;
      }
      g.style.display = show ? '' : 'none';
      // Check if the currently selected option lives in a hidden group
      g.querySelectorAll('option').forEach(o => {
        if (o.value === currentVal && !show) currentOptVisible = false;
      });
    });
    // Show or hide a warning about cross-track stage mismatch
    let warn = document.getElementById('lStageWarning');
    if (!currentOptVisible && currentVal) {
      if (!warn) {
        warn = document.createElement('div');
        warn.id = 'lStageWarning';
        warn.style.cssText = 'font-size:10px;color:#ea580c;margin-top:4px;padding:4px 8px;background:rgba(234,88,12,.08);border-left:2px solid #ea580c;border-radius:3px;';
        sel.parentElement.appendChild(warn);
      }
      warn.textContent = '⚠ Current stage is from a different track. Change stage to match the new job type.';
      warn.style.display = 'block';
    } else if (warn) {
      warn.style.display = 'none';
    }
  };

  // Attach listener after DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    const jtSel = document.getElementById('lJobType');
    if (jtSel) jtSel.addEventListener('change', window.toggleInsuranceFields);
    const stSel = document.getElementById('lStage');
    if (stSel) stSel.addEventListener('change', window.toggleInsuranceFields);

    // Drop "?" help icons next to high-impact labels. The helper is
    // defer-loaded so we retry a couple times until it's available.
    function _attachHelpIcons() {
      if (!window.HelpIcon) return false;
      const findLabel = (id) => {
        const el = document.getElementById(id);
        return el?.closest('.mfield')?.querySelector('label') || null;
      };
      // Job Type — links to the new job-types section since we just shipped it
      const jtLbl = findLabel('lJobType');
      if (jtLbl) window.HelpIcon.attach(jtLbl, 'job-types', { position: 'inside' });
      // Stage — links to the kanban section
      const stLbl = findLabel('lStage');
      if (stLbl) window.HelpIcon.attach(stLbl, 'kanban', { position: 'inside' });
      return true;
    }
    if (!_attachHelpIcons()) {
      let n = 0;
      const t = setInterval(() => {
        if (_attachHelpIcons() || ++n > 20) clearInterval(t);
      }, 250);
    }
  });

  // ── Global drop handler for kanban columns ──
  window.drop = function(event, stageKey) {
    event.preventDefault();
    const el = event.currentTarget || event.target.closest('.kcol-body');
    if (el) el.classList.remove('drag-over');
    const dragId = window._dragId || event.dataTransfer?.getData('text/plain');
    if (!dragId) return;
    if (typeof moveCard === 'function') moveCard(dragId, stageKey);
    window._dragId = null;
  };

  // ── View switcher ──
  window.switchKanbanView = function(viewKey) {
    window.buildKanbanColumns(viewKey);
    // Update active button state
    document.querySelectorAll('.kview-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewKey);
    });
    // Re-render leads into new columns
    if (typeof renderLeads === 'function') {
      renderLeads(window._leads, window._filteredLeads);
    }
  };

  const firebaseConfig = {
    apiKey: "AIzaSyDTrotINzl2YjdGbH25BpC-FPv8i_fXNvg",
    authDomain: "nobigdeal-pro.firebaseapp.com",
    projectId: "nobigdeal-pro",
    storageBucket: "nobigdeal-pro.firebasestorage.app",
    messagingSenderId: "717435841570",
    appId: "1:717435841570:web:c2338e11052c96fde02e7b"
  };

  // v159.7: stop hiding the page during init.
  // Up through v159.6 we set visibility:hidden here, relying on either
  // _showPage() in nbd-auth.js or the catch handler to restore it. On
  // mobile this has been failing — the hide DOES land but the show
  // never fires because module 1's promise hangs. Removing the hide is
  // a deliberate trade-off: the page may flash unauth content for a
  // few hundred ms, but at least it never gets stuck on a permanently
  // invisible page if module init dies. The diagnostic banner is the
  // only ground-truth we have right now and it must be visible.
  // (Original line: document.documentElement.style.visibility="hidden";)
  window.__nbdMark && window.__nbdMark('m2:beforeApp');
  // v159.6: Singleton-aware app init.
  // nbd-auth.js (the FIRST module on this page) already calls
  // initializeApp(FIREBASE_CONFIG) and exposes the result on
  // window._firebaseApp. Reusing the already-initialized instance
  // removes any duplicate-app risk and — equally important —
  // guarantees we share the SAME long-polling-enabled Firestore
  // instance that nbd-auth.js created via initializeFirestore(_app, {
  // experimentalForceLongPolling: true }). Without this share, our
  // getFirestore(app) below would silently get the default WebChannel
  // transport, which is the very thing PR #289 was trying to avoid.
  const app     = window._firebaseApp || initializeApp(firebaseConfig);
  window.__nbdMark && window.__nbdMark(window._firebaseApp ? 'm2:app:reused' : 'm2:app:fresh');

  // ─── App Check (C-4) ──────────────────────────────────────
  // Functions declare `enforceAppCheck: true` but previously nothing
  // on this page was minting attestation tokens. That meant either:
  //  (a) enforcement was silently off in the project (curl could
  //      hit claudeProxy / imageProxy with just an ID token), or
  //  (b) enforcement was on and half the app was failing silently.
  // Either way the guarantee was broken. We now initialize App Check
  // with ReCaptchaV3 so every Firebase SDK request (auth callables,
  // Firestore, Functions) carries a real token.
  //
  // The site key lives in window.__NBD_APP_CHECK_KEY, set via a
  // <meta> tag below. Keys are per-origin and safe to include in
  // HTML (they're validated by reCAPTCHA, not secret). An unset key
  // falls back to an init-skipped warning so dev/local still works.
  const APP_CHECK_KEY = (window.__NBD_APP_CHECK_KEY || '').trim();
  if (APP_CHECK_KEY && !window.__NBD_APP_CHECK_INITIALIZED) {
    try {
      initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(APP_CHECK_KEY),
        isTokenAutoRefreshEnabled: true
      });
      window.__NBD_APP_CHECK_INITIALIZED = true;
    } catch (e) {
      console.error('App Check init failed:', e);
    }
  } else if (!APP_CHECK_KEY) {
    console.warn('App Check not configured. Set window.__NBD_APP_CHECK_KEY via the meta tag in dashboard.html <head>. Callable functions with enforceAppCheck: true WILL reject these requests in production.');
  }

  const auth    = getAuth(app);
  const db      = getFirestore(app);
  const storage = getStorage(app);
  // Audit #3: localhost-only emulator wiring. On dashboard.html, auth+db were
  // already wired by nbd-auth (reused instances → deduped); this connects the
  // fresh storage instance (uploads happen far later, so no await needed) and
  // covers the no-nbd-auth fallback path. Hard no-op in production.
  connectEmulatorsIfLocal({ auth, db, storage });

  // CRITICAL: Expose Firebase functions to window for drag & drop and other global handlers
  window.db = db;
  // _db mirror — invoice-pipeline.js and a handful of other modules
  // were written against this name before the codebase settled on
  // window.db. Expose both so existing call sites keep working.
  window._db = db;
  // _project — offline-manager.js uses this when building Firestore
  // REST URLs to flush the queued writes. Without it the URL became
  // /v1/projects/undefined/databases/(default)/... and every flush
  // 404'd. Stamp it from the canonical config.
  window._project = firebaseConfig.projectId;
  window.storage = storage;
  window.auth = auth;
  window.doc = doc;
  window.getDoc = getDoc;
  window.getDocs = getDocs;
  window.addDoc = addDoc;
  window.updateDoc = updateDoc;
  window.deleteDoc = deleteDoc;
  window.collection = collection;
  window.query = query;
  window.where = where;
  window.orderBy = orderBy;
  window.limit = limit;
  window.startAfter = startAfter;  // Audit #4 / 5.1: enables cursor pagination
  window.serverTimestamp = serverTimestamp;
  window.arrayUnion = arrayUnion;
  window.ref = ref;
  window.uploadBytes = uploadBytes;
  window.getDownloadURL = getDownloadURL;
  window.listAll = listAll;
  window._signOut = signOut;
  window._onAuthStateChanged = onAuthStateChanged;
  window.setDoc = setDoc;
  window.writeBatch = writeBatch;
  // Expose runTransaction so crm.js can use a stage-compare transaction
  // to prevent two-tab double-moves from creating duplicate stageHistory
  // entries (T18). Already used inside this module for the customer-ID
  // counter; the export just lets it run in a different file.
  window.runTransaction = runTransaction;
  window.sendPasswordResetEmail = sendPasswordResetEmail;
  // Expose connection cycling so the visibilitychange handler in the
  // outer (non-module) script block at the bottom of this page can
  // call them when the tab returns to foreground after iOS suspended JS.
  window.disableNetwork = disableNetwork;
  window.enableNetwork = enableNetwork;

  // ── GLOBAL ERROR BOUNDARY ──────────────────────────────────
  // Log errors to console only. NEVER show toasts from global
  // handlers — they fire on benign Firebase rejections, network
  // hiccups, and deferred-script timing issues that don't affect
  // the user. Real errors should be caught locally by the
  // functions that throw them, with specific user-friendly messages.
  window.addEventListener('error', e => {
    console.error('Uncaught error:', e.error || e.message);
  });
  window.addEventListener('unhandledrejection', e => {
    console.warn('Unhandled promise rejection:', e.reason);
  });

  onAuthStateChanged(auth, async user => {
    if (!user) { window.location.replace("/pro/login.html"); return; }
    
    // ── SUBSCRIPTION CHECK ────────────────────────────────────
    // Owner bypass — founder/staff emails always resolve to professional.
    // Must mirror OWNER_EMAILS in js/nbd-auth.js + js/billing-gate.js so
    // a missing/stale subscriptions/ doc never flips Joe to 'free' and
    // triggers the "upgrade to unlock" wall for his own product.
    //
    // NOTE: the previous `isDemoAccount = user.email === 'demo@nobigdeal.pro'`
    // hardcoded bypass was REMOVED (2026-04-23). Demo accounts now flow
    // through NBDAuth's claim-based demo path (H-02). Trusting an email
    // literal here was a second auth surface that could diverge from the
    // claim-based path and silently grant professional-tier access.
    const _emailLower = (user.email || '').trim().toLowerCase();
    const isOwnerAccount = _emailLower === 'jd@nobigdealwithjoedeal.com'
                        || _emailLower === 'jonathandeal459@gmail.com';

    if (isOwnerAccount) {
      window._userPlan = 'professional';
      window._subscription = { plan: 'professional', status: 'active', _owner: true };
      console.log('✓ Owner account — professional plan granted');
    } else {
      // Subscription check — SOFT. Never block the dashboard load.
      // The billing-gate module handles limits via soft gates.
      // Access code users, free tier, and trial users all have no
      // subscription doc — that's normal, not an error.
      try {
        // 4s timeout — on iOS bfcache restore this getDoc can hang
        // forever instead of rejecting, blocking the visibility=visible
        // flip below and leaving the dashboard invisible. Soft failure
        // here drops to free tier (billing-gate enforces real limits).
        const subSnap = await Promise.race([
          getDoc(doc(db, 'subscriptions', user.uid)),
          new Promise((_, rej) => setTimeout(() => rej(new Error('Subscription check timed out')), 4000))
        ]);
        if (subSnap.exists()) {
          const subscription = subSnap.data();
          window._subscription = subscription;
          window._userPlan = subscription.plan || 'free';
          // H-03: do NOT persist plan in localStorage — it reintroduces
          // the fail-open hole that nbd-auth.js explicitly removed.
          console.log('✓ Subscription:', subscription.plan, subscription.status);
        } else {
          // No subscription doc — normal for access code / free tier users
          window._subscription = { plan: 'free', status: 'active' };
          window._userPlan = 'free';
          console.log('No subscription doc — defaulting to free tier');
        }
      } catch (error) {
        // Fail CLOSED — on Firestore error, restrict to the most limited
        // tier. The old comment here said "Fail open" but the code already
        // set plan='free' (which IS fail-closed). Renamed the flag and
        // comment to match intent so this doesn't get "fixed" back to
        // actually-fail-open by a future reader misled by the label.
        console.warn('Subscription check failed — failing closed to free:', error.message);
        window._subscription = { plan: 'free', status: 'active', _failClosed: true };
        window._userPlan = 'free';
      }
    }
    
    document.documentElement.style.visibility="visible";
    
    // Show upgrade banner for lite users
    if (window._userPlan === 'lite') {
      setTimeout(() => {
        const banner = document.createElement('div');
        banner.id = 'liteBanner';
        banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:9999;background:linear-gradient(90deg,var(--s),var(--s2));border-top:2px solid var(--orange);padding:10px 20px;display:flex;align-items:center;justify-content:center;gap:12px;font-size:12px;color:rgba(255,255,255,.8);';
        banner.innerHTML = `
          <span>🚀 You're on <strong class="fg-orange">NBD Pro Lite</strong> (25 leads max)</span>
          <a href="/pro/landing.html#pricing" style="background:var(--orange);color:var(--accent-fg);padding:6px 16px;border-radius:6px;text-decoration:none;font-weight:700;font-size:11px;">Upgrade to Pro →</a>
          <button data-action="removeParent" style="background:none;border:none;color:rgba(255,255,255,.4);cursor:pointer;font-size:16px;margin-left:8px;">✕</button>
        `;
        document.body.appendChild(banner);
      }, 2000);
    }
    window._user = user;
    // Fetch the shop-wide Company Profile so every doc generated this
    // session uses the rep's saved legal text / financing / marketing.
    // Fire-and-forget — defaults are already in window._companyProfile,
    // so docs work even if this hangs.
    if (typeof window._loadCompanyProfile === 'function') {
      window._loadCompanyProfile().catch(() => {});
    }
    // Pre-warm the notification-settings cache from Firestore so a rep
    // signing in on a new device gets their saved preferences before
    // they ever open Settings → Notifications. Fire-and-forget — the
    // tab-open path falls back to localStorage if this is still pending.
    if (typeof _syncNotifSettingsFromFirestore === 'function') {
      _notifFirestoreSynced = true;
      _syncNotifSettingsFromFirestore();
    }
    // Load custom claims for role-based access (Enterprise)
    // Claims include: companyId, role, plan, subscriptionStatus
    try {
      const tokenResult = await user.getIdTokenResult();
      window._userClaims = tokenResult.claims || {};
      // If this is a newly invited rep, activate their membership
      if (window._userClaims.companyId && !localStorage.getItem('nbd_rep_activated')) {
        try {
          const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
          const fn = httpsCallable(getFunctions(), 'activateInvitedRep');
          await fn({});
          localStorage.setItem('nbd_rep_activated', '1');
        } catch (e) { console.warn('Rep activation skipped:', e.message); }
      }
    } catch (e) { window._userClaims = {}; }
    // Notification permission is now opt-in via a user gesture.
    // A page-load requestPermission() call is auto-denied by modern
    // browsers and poisons the permission state. See crm.js enable-
    // notifications click handler.
    // Pick up pending warranty cert from customer page.
    // warranty-cert.js is lazy-loaded via ScriptLoader when the Docs
    // view activates, so wait for that before invoking the wizard.
    try {
      const pending = sessionStorage.getItem('_pendingCert');
      if (pending) {
        sessionStorage.removeItem('_pendingCert');
        const data = JSON.parse(pending);
        setTimeout(() => {
          goTo('docs');
          const preload = (window.ScriptLoader && window.ScriptLoader.preloadForView)
            ? window.ScriptLoader.preloadForView('docs')
            : Promise.resolve();
          preload.then(() => {
            if (typeof openWarrantyCertWizard === 'function') {
              openWarrantyCertWizard(data);
            } else {
              // Previously this silently returned — users clicked "Generate
              // Cert" from customer.html and landed on Docs with nothing
              // happening. Surface the failure so we at least know the
              // handoff dropped the data.
              console.warn('[dashboard] _pendingCert pickup failed: openWarrantyCertWizard not loaded');
              if (typeof showToast === 'function') showToast('Warranty wizard failed to load — open Docs → Warranty manually', 'warning');
            }
          }).catch(err => {
            console.warn('[dashboard] _pendingCert preload failed:', err);
            if (typeof showToast === 'function') showToast('Warranty wizard couldn\u2019t load — try again from Docs', 'error');
          });
        }, 800);
      }
    } catch(e) {
      // JSON.parse failure means the sessionStorage payload is corrupt —
      // clear it so we don't keep retrying with bad data on every reload.
      console.warn('[dashboard] _pendingCert parse failed, clearing:', e);
      try { sessionStorage.removeItem('_pendingCert'); } catch(_) {}
    }
    // If subscription check failed open, show a subtle non-blocking warning
    if (window._subscription?._failOpen) {
      setTimeout(() => showToast('Subscription check had a hiccup - you are in. Refreshing will resolve it.', 'warning'), 2000);
    }
    // New-user onboarding is handled by OnboardingTour (js/onboarding-tour.js).
    // The legacy modal-based flow that lived here referenced DOM that was
    // never built (#onboardingModal, #onbStep1, etc.); call removed.
    const name = user.displayName || user.email.split('@')[0];
    // Template-hydration safety: #dashName, #homeGreeting, and the
    // settings inputs live inside <template id="tpl-view-*"> mounts
    // that don't exist in the live DOM until dashboard-main.js
    // hydrates the view. Without these guards, the first null throw
    // aborts the rest of onAuthStateChanged → loadLeads is never
    // called → kanban shows zero cards. View-hydrate code re-populates
    // these from window._user when the view becomes active.
    const _setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const _setVal  = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    _setText('userName',     name);
    _setText('userAvatar',   name[0].toUpperCase());
    _setText('dashName',     name);
    _setText('homeGreeting', 'Welcome Back, ' + name.split(' ')[0]);
    _setVal('settingsName',  user.displayName || '');
    _setVal('settingsEmail', user.email || '');
    // Cal.com username — pull from the user profile if set and prime
    // the shareable link preview so reps can copy the URL straight
    // into an SMS / email. Also stash on window._currentRep so
    // sendBookingSMS / sendFollowUpSMS (crm.js) + homeowner portal
    // resolve the right URL without a second Firestore read.
    try {
      const usrSnap = await getDoc(doc(db, 'users', user.uid));
      if (usrSnap.exists()) {
        const d = usrSnap.data();
        const calVal = d.calcomUsername || '';
        window._currentRep = Object.assign({}, window._currentRep || {}, {
          uid: user.uid,
          displayName: d.displayName || user.displayName || '',
          email: d.email || user.email || '',
          calcomUsername: calVal,
          calcomEventSlug: d.calcomEventSlug || 'roof-inspection'
        });
        const calEl = document.getElementById('settingsCalcom');
        const calPrev = document.getElementById('settingsCalcomPreview');
        if (calEl) calEl.value = calVal;
        if (calPrev) {
          if (calVal) {
            const url = 'https://cal.com/' + calVal;
            calPrev.textContent = url;
            calPrev.href = url;
            calPrev.style.display = '';
          } else {
            calPrev.style.display = 'none';
          }
        }
        // Wave 16: prime the digest opt-in checkbox from the user
        // doc. Default ON when the field is missing or true; only OFF
        // when explicitly false.
        const digestEl = document.getElementById('settingsWeeklyDigest');
        if (digestEl) digestEl.checked = d.weeklyDigestEnabled !== false;
        // Wave 28: prime the dormant-nudge opt-in checkbox using the
        // same default-ON semantics.
        const dormantEl = document.getElementById('settingsDormantNudge');
        if (dormantEl) dormantEl.checked = d.dormantNudgeEnabled !== false;
      }
    } catch (e) { /* silent — rules may deny during bootstrap */ }
    // Seed demo data first if this is the demo account, then load normally
    if(typeof maybeSeedDemoData==='function') await maybeSeedDemoData(user).catch(()=>{});
    // Build dynamic kanban columns before loading leads
    const savedView = localStorage.getItem('nbd_kanban_view') || 'insurance';
    if (typeof window.buildKanbanColumns === 'function') {
      window.buildKanbanColumns(savedView);
      // Sync view switcher button active state
      document.querySelectorAll('.kview-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === savedView);
      });
    }
    loadLeads().then(() => {
      // ── Wave 120: stuck-skeleton reliability fix ────────────────────
      // Previously this gated render on `window._leads?.length` — which
      // meant any user with ZERO leads (brand-new accounts, or leads
      // filtered out by stage/sales_rep) would NEVER escape the kanban
      // skeleton. Combined with the 3-step nested setTimeout, that
      // produced the ~50% "stuck on loading" bug.
      //
      // New behaviour:
      //   1. Render path no longer requires leads to exist — an empty
      //      array is a valid state (we render the empty kanban cleanly).
      //   2. Retry loop polls every 250ms for up to 30s. Each tick
      //      checks if renderLeads is now available; first hit wins.
      //   3. If the 30s window elapses without renderLeads arriving,
      //      we fall back to a plain "Couldn't load — refresh" state
      //      instead of leaving the user on a forever-skeleton.
      function _attemptRender() {
        if (typeof renderLeads !== 'function') return false;
        // If the kanban container has no stage columns, rebuild them
        // before rendering — otherwise renderLeads has no `#kbody-{key}`
        // targets and silently produces an empty board (the symptom
        // observed in the W158 "blank kanban" report). buildKanbanColumns
        // can no-op if it ran earlier and was wiped, or if the auth-time
        // call at line ~609 raced the DOM.
        const _board = document.getElementById('kanbanBoard');
        if (_board && !_board.querySelector('.kanban-col') &&
            typeof window.buildKanbanColumns === 'function') {
          try { window.buildKanbanColumns(window._currentViewKey || 'insurance'); }
          catch (e) { console.warn('[render-retry] buildKanbanColumns threw:', e.message); }
        }
        // window._leads may be undefined if loadLeads catch-path never
        // assigned it; coalesce to [] so renderLeads never throws.
        const leads = Array.isArray(window._leads) ? window._leads : [];
        try {
          renderLeads(leads);
          if (typeof restoreCrmSearch === 'function') restoreCrmSearch();
          if (typeof updatePipeline === 'function') updatePipeline(leads);
          if (typeof calculateWeeklyStats === 'function') calculateWeeklyStats();
          if (typeof refreshTrashBadge === 'function') refreshTrashBadge();
          if (typeof renderKPIRow === 'function') renderKPIRow();
          if (window.NBDWidgets) window.NBDWidgets.render();
        } catch (renderErr) {
          console.warn('[render-retry] renderLeads threw:', renderErr.message);
          return false;
        }
        return true;
      }
      function _renderFallback() {
        const board = document.getElementById('kanbanBoard');
        if (!board) return;
        board.innerHTML =
          '<div style="grid-column:1/-1;padding:40px 20px;text-align:center;color:var(--m, #888);">' +
          '<div style="font-size:32px;margin-bottom:12px;">⚠️</div>' +
          '<div style="font-size:16px;font-weight:600;margin-bottom:8px;color:var(--t, #fff);">Couldn\'t finish loading the CRM.</div>' +
          '<div style="font-size:13px;margin-bottom:18px;">Your data is safe — this is usually a slow connection during cold start.</div>' +
          '<button type="button" data-action="reload" style="padding:10px 22px;border-radius:6px;background:var(--orange, #c8541a);color:#fff;border:none;cursor:pointer;font:inherit;font-size:14px;">Reload</button>' +
          '</div>';
      }
      // First attempt fires synchronously after loadLeads resolves.
      if (_attemptRender()) return;
      // W134 fix: track the poll handle on window so a second
      // loadLeads call (e.g. visibilitychange or auth re-fire) can
      // clearInterval it instead of double-running the poll. Same
      // class of bug as the W120 _loadLeadsRetryTimer fix, but for
      // the 30s render-retry interval.
      if (window._renderRetryHandle) {
        try { clearInterval(window._renderRetryHandle); } catch (_) {}
      }
      let _ticks = 0;
      const _MAX_TICKS = 120;
      window._renderRetryHandle = setInterval(() => {
        _ticks++;
        if (_attemptRender()) {
          clearInterval(window._renderRetryHandle);
          window._renderRetryHandle = null;
          return;
        }
        if (_ticks >= _MAX_TICKS) {
          clearInterval(window._renderRetryHandle);
          window._renderRetryHandle = null;
          console.error('[render-retry] renderLeads never became available after 30s');
          _renderFallback();
        }
      }, 250);
    });
    loadEstimates(); loadPins();
    // B3: wire the live estimates listener so signature webhook
    // updates + V2 saves land in the UI without a reload.
    if (typeof window._subscribeEstimates === 'function') {
      try { window._subscribeEstimates(); } catch (e) { /* degrade to one-shot */ }
    }
    // D9 was: register device fingerprint so new-device sign-ins fire
    // a Slack alert. The backend `registerDeviceFingerprint` callable
    // was never deployed, so every dashboard load produced a 401 (no
    // AppCheck) and later a CORS-failed preflight in the console.
    // Removed the call until the function actually ships — silent
    // failure was masking the dead path.

    // Check for query params (edit=xxx or tasks=xxx from customer.html)
    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get('edit');
    const tasksId = urlParams.get('tasks');
    
    const estParam = urlParams.get('est');
    const leadParam = urlParams.get('lead');

    if (estParam && editId) {
      // ── REOPEN SAVED ESTIMATE from customer page ──
      // URL: ?edit=LEAD_ID&est=ESTIMATE_ID  (edit here = lead context, est = estimate to reopen)
      (async () => {
        // Wait for estimates to actually finish loading
        try { await loadEstimates(); } catch(e) { console.warn('loadEstimates retry:', e); }
        goTo('est');
        // If the estimate isn't in the loaded list, try fetching it directly
        const tryReopen = async (attempts) => {
          let estimates = window._estimates || [];
          let found = estimates.find(e => e.id === estParam);
          if (!found && attempts < 15) {
            await new Promise(r => setTimeout(r, 400));
            estimates = window._estimates || [];
            found = estimates.find(e => e.id === estParam);
            if (!found) return tryReopen(attempts + 1);
          }
          if (!found) {
            // Last resort: fetch the single estimate directly from Firestore
            try {
              const snap = await getDoc(doc(db, 'estimates', estParam));
              if (snap.exists()) {
                found = { id: snap.id, ...snap.data() };
                window._estimates = [...(window._estimates || []), found];
              }
            } catch(e) { console.error('Direct estimate fetch failed:', e); }
          }
          if (typeof viewEstimate === 'function') {
            viewEstimate(estParam);
            window._estLinkedLeadId = editId;
            const titleEl = document.getElementById('estBuilderTitle');
            if (titleEl) titleEl.textContent = 'Edit Estimate';
          } else {
            showToast('Estimate builder not ready — try again', 'error');
          }
        };
        await tryReopen(0);
        window.history.replaceState({}, '', '/pro/dashboard.html');
      })();
    } else if (editId && !estParam) {
      // ── EDIT LEAD in CRM ──
      setTimeout(() => {
        goTo('crm');
        editLead(editId);
        window.history.replaceState({}, '', '/pro/dashboard.html');
      }, 500);
    } else if (estParam || leadParam) {
      // ── NEW ESTIMATE (optionally pre-filled from lead) ──
      (async () => {
        try { await loadEstimates(); } catch(e) { console.warn('loadEstimates failed:', e); }
        goTo('est');
        if (estParam && !editId) {
          // Reopen estimate by ID (direct link, no lead context)
          let found = (window._estimates || []).find(e => e.id === estParam);
          if (!found) {
            try {
              const snap = await getDoc(doc(db, 'estimates', estParam));
              if (snap.exists()) {
                found = { id: snap.id, ...snap.data() };
                window._estimates = [...(window._estimates || []), found];
              }
            } catch(e) { console.error('Direct estimate fetch failed:', e); }
          }
          if (typeof viewEstimate === 'function') viewEstimate(estParam);
        } else {
          if (typeof startNewEstimateOriginal === 'function') startNewEstimateOriginal();
          else if (typeof startNewEstimate === 'function') startNewEstimate();
          // Pre-fill address from lead if leadParam provided
          if (leadParam && window._leads) {
            const lead = window._leads.find(l => l.id === leadParam);
            if (lead) {
              const addrEl = document.getElementById('estAddr');
              const ownerEl = document.getElementById('estOwner');
              if (addrEl && lead.address) addrEl.value = lead.address;
              if (ownerEl) ownerEl.value = `${lead.firstName||''} ${lead.lastName||''}`.trim();
              // Store linked leadId so saveEstimate can attach it
              window._estLinkedLeadId = leadParam;
              updateEstCalc();
              const note = document.getElementById('drawImportNote');
              if (note) { note.textContent = '✓ Pre-filled from customer record — estimate will auto-link on save'; note.style.display='block'; }
            }
          }
        }
        window.history.replaceState({}, '', '/pro/dashboard.html');
      })();
    } else if (tasksId) {
      // Wait for leads to load, then open task modal
      setTimeout(() => {
        goTo('crm');
        openTaskModal(tasksId);
        // Clean URL
        window.history.replaceState({}, '', '/pro/dashboard.html');
      }, 500);
    }
  });

  window._auth    = auth;
  window._db      = db;
  window._storage = storage;
  window._signOut = () => signOut(auth).then(() => window.location.replace("/pro/login.html"));
  window.firebase_onAuthStateChanged = onAuthStateChanged;

  // ── ACCOUNT ACTIVATION HELPER (run once per user from console) ──
  window.activateMyAccount = async () => {
    const user = window._auth?.currentUser;
    if (!user) { console.error('❌ Not logged in or auth not ready'); return; }
    try {
      const {setDoc, doc: _doc} = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      await setDoc(_doc(window._db, 'subscriptions', user.uid), {
        status: 'active',
        plan: 'professional',
        email: user.email,
        activatedAt: new Date().toISOString()
      });
      console.log('✅ Account activated for', user.email, '| UID:', user.uid);
      alert('✅ Activated! Refresh the page.');
    } catch(e) { console.error('❌ Activation failed:', e); }
  };

  // ── GLOBAL KEYBOARD SHORTCUTS ──
  // isHotkeyEnabled is defined inside an IIFE in dashboard-hotkey-toggles.js
  // (a classic script), so this ES module can't see it — a bare reference
  // threw `ReferenceError: isHotkeyEnabled is not defined` on EVERY keydown,
  // which both spammed the console and broke all the shortcuts below. Mirror
  // the same localStorage flag here so the module is self-sufficient and
  // stays in sync with the toggle settings.
  const isHotkeyEnabled = (id) => {
    try { return localStorage.getItem('nbd_hk_disabled_' + id) !== '1'; }
    catch (_) { return true; }
  };

  document.addEventListener('keydown', (e) => {
    // Don't trigger if user is typing in input/textarea
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    
    // ESC - Close modals
    if (e.key === 'Escape') {
      closeLeadModal();
      closeCardDetailModal();
      closeTaskModal();
    }
    
    // Shift+N - Quick Add Lead (one-tap / GPS-first flow) — checked
    // BEFORE the bare 'N' branch so the shifted variant doesn't
    // accidentally fire both handlers.
    if ((e.key === 'N') && e.shiftKey && isHotkeyEnabled('hk_n')) {
      e.preventDefault();
      if (typeof window.openQuickAddLead === 'function') window.openQuickAddLead();
      return;
    }

    // N - New lead (toggleable)
    if ((e.key === 'n' || e.key === 'N') && !e.shiftKey && isHotkeyEnabled('hk_n')) {
      goTo('crm');
      setTimeout(() => openLeadModal(), 100);
    }

    // E - New estimate (toggleable)
    if ((e.key === 'e' || e.key === 'E') && isHotkeyEnabled('hk_e')) {
      goTo('est');
      setTimeout(() => startNewEstimate(), 100);
    }

    // / - Focus search (toggleable)
    if (e.key === '/' && isHotkeyEnabled('hk_slash')) {
      e.preventDefault();
      const searchInput = document.querySelector('#crmSearch, #mapSearch');
      if (searchInput) searchInput.focus();
    }

    // ? - Show shortcuts help (toggleable)
    if (e.key === '?' && isHotkeyEnabled('hk_help')) {
      showShortcutsHelp();
    }
  });
  
  function showShortcutsHelp() {
    const helpHTML = `
      <div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.8);z-index:99999;display:flex;align-items:center;justify-content:center;" data-action="removeSelf">
        <div style="background:var(--s);border:1px solid var(--br);border-radius:12px;padding:24px;max-width:400px;width:90%;" data-action="stopProp">
          <div style="font-size:18px;font-weight:700;margin-bottom:16px;font-family:'Barlow Condensed',sans-serif;">⌨️ Keyboard Shortcuts</div>
          <div style="display:grid;grid-template-columns:auto 1fr;gap:8px 16px;font-size:13px;">
            <kbd class="kbd-input">N</kbd>
            <span>New Lead</span>
            <kbd class="kbd-input">E</kbd>
            <span>New Estimate</span>
            <kbd class="kbd-input">/</kbd>
            <span>Focus Search</span>
            <kbd class="kbd-input">ESC</kbd>
            <span>Close Modals</span>
            <kbd class="kbd-input">?</kbd>
            <span>Show This Help</span>
          </div>
          <button class="btn btn-orange" style="width:100%;margin-top:16px;justify-content:center;" data-action="removeClosest" data-target="div[style*=fixed]">Got it</button>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', helpHTML);
  }
  window.showShortcutsHelp = showShortcutsHelp;

  // ── RECENTLY VIEWED CUSTOMERS ──
  function toggleRecentDropdown() {
    const dropdown = document.getElementById('recentDropdown');
    const isOpen = dropdown.style.display === 'block';
    dropdown.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) renderRecentCustomers();
  }
  window.toggleRecentDropdown = toggleRecentDropdown;
  
  function renderRecentCustomers() {
    try {
      const recent = JSON.parse(localStorage.getItem('nbd_recent_customers') || '[]');
      const list = document.getElementById('recentList');
      if (!recent.length) {
        list.innerHTML = '<div style="font-size:12px;color:var(--m);padding:8px;">No recent customers</div>';
        return;
      }
      const leads = window._leads || [];
      const e = window.nbdEsc || (s => String(s == null ? '' : s));

      // Wave 53: inline reshare buttons. Last priority-ish surface
      // to get the share trio. Recent dropdown rows already navigate
      // to the customer page on click; this just adds 📞/💬/📧
      // affordances next to the name so the rep can re-text/recall
      // a customer they were just looking at without opening the
      // detail page first.
      function _recentActions(lead) {
        const phoneDigits = String(lead.phone || '').replace(/\D+/g, '');
        const email = String(lead.email || '').trim();
        const buttons = [];
        if (phoneDigits) {
          buttons.push(
            `<a class="rc-action" href="tel:${e(phoneDigits)}" title="Call ${e(lead.phone)}"
               style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:4px;background:rgba(16,185,129,0.14);color:#10b981;text-decoration:none;font-size:11px;-webkit-tap-highlight-color:transparent;transition:transform .12s;"
               data-action="stopProp"
             >📞</a>`);
          buttons.push(
            `<button class="rc-action" type="button" data-action="sms" data-lead-id="${e(lead.id)}" title="Text portal link to ${e(lead.phone)}"
               style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:4px;background:rgba(59,130,246,0.14);color:#3b82f6;border:none;font-size:11px;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s;"
             >💬</button>`);
        }
        if (email) {
          buttons.push(
            `<button class="rc-action" type="button" data-action="email" data-lead-id="${e(lead.id)}" title="Email portal link to ${e(email)}"
               style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:4px;background:rgba(139,92,246,0.14);color:#8b5cf6;border:none;font-size:11px;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s;"
             >📧</button>`);
        }
        // Wave 67: portal preview action — finishes the recent-
        // dropdown action row to match cmd+K (W63) and the home
        // widgets (W64/W65/W66). Mirrors W63 like W62 mirrored
        // W61. Always available, no contact gate. Sits between
        // share trio and snooze so the row reads "talk / look /
        // set aside" everywhere it appears.
        if (window.PortalLinkHelpers
            && typeof window.PortalLinkHelpers.previewForLead === 'function') {
          buttons.push(
            `<button class="rc-action" type="button" data-action="preview" data-lead-id="${e(lead.id)}" title="Preview the portal — see what the customer will see"
               style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:4px;background:rgba(245,158,11,0.14);color:#f59e0b;border:none;font-size:11px;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s;"
             >🔍</button>`);
        }
        // Wave 62: state-aware snooze/unsnooze button on the recent
        // dropdown. Mirrors W61 cmd+K — power-user workflow where
        // the rep just looked at a customer and wants to push it
        // out for follow-up without opening the detail page.
        // Always available (snoozing doesn't need contact info),
        // so it shows even when phone/email are missing.
        if (window.LeadSnooze) {
          const isSnoozed = window.LeadSnooze.isSnoozed(lead);
          if (isSnoozed) {
            const untilLabel = window.LeadSnooze.formatSnoozeLabel(window.LeadSnooze.snoozedUntilDate(lead));
            buttons.push(
              `<button class="rc-action" type="button" data-action="unsnooze" data-lead-id="${e(lead.id)}" title="Unsnooze (was until ${e(untilLabel)})"
                 style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:4px;background:rgba(155,109,255,0.14);color:#cab8ff;border:none;font-size:11px;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s;"
               >⏰</button>`);
          } else {
            buttons.push(
              `<button class="rc-action" type="button" data-action="snooze" data-lead-id="${e(lead.id)}" title="Snooze this lead"
                 style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:4px;background:rgba(155,109,255,0.10);color:#a890e8;border:none;font-size:11px;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s;"
               >💤</button>`);
          }
        }
        if (buttons.length === 0) return '';
        return `<div style="display:flex;gap:3px;flex-shrink:0;">${buttons.join('')}</div>`;
      }

      list.innerHTML = recent.map(r => {
        const lead = leads.find(l => l.id === r.id);
        if (!lead) return '';
        const name = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'Unknown';
        const shortAddr = (lead.address || '').split(',')[0];
        return `
          <div class="nbd-recent-row" data-id="${e(r.id)}" style="display:flex;gap:8px;align-items:center;padding:6px 8px;border-radius:6px;cursor:pointer;transition:background .15s;font-size:12px;">
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${e(name)}</div>
              <div style="font-size:10px;color:var(--m);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${e(shortAddr)}</div>
            </div>
            ${_recentActions(lead)}
          </div>
        `;
      }).filter(Boolean).join('');

      // Wave 53: action button handlers fire BEFORE row click so
      // stopPropagation takes effect. SMS + Email delegate to
      // PortalLinkHelpers (W42) for the prefilled-body flow + W44
      // lastSharedAt tracking. Call uses native <a href="tel:...">.
      list.querySelectorAll('.rc-action[data-action]').forEach(btn => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const action = btn.getAttribute('data-action');
          const id = btn.getAttribute('data-lead-id');
          if (!id) return;
          const lead = (window._leads || []).find(l => l && l.id === id);
          if (!lead) return;
          let closeDropdown = true;
          if (action === 'sms' && window.PortalLinkHelpers) {
            window.PortalLinkHelpers.smsForLead(lead);
          } else if (action === 'email' && window.PortalLinkHelpers) {
            window.PortalLinkHelpers.emailForLead(lead);
          } else if (action === 'preview' && window.PortalLinkHelpers) {
            // Wave 67: preview opens the W56 iframe modal on top
            // of the dropdown. Modal z-index 99997 > dropdown
            // 9999. Don't close the dropdown — when the rep
            // dismisses the preview they keep their recent-
            // customers context, useful for chaining previews
            // across the four most-recent leads.
            window.PortalLinkHelpers.previewForLead(lead);
            closeDropdown = false;
          } else if (action === 'snooze' && window.LeadSnooze) {
            // Wave 62: opens the W35 preset modal on top of the
            // dropdown. Modal z-index (99996) > dropdown z-index
            // (9999) so it stacks correctly. Don't close the
            // dropdown — when the rep dismisses the modal they
            // can keep glancing at recent customers.
            const fullName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim();
            window.LeadSnooze.prompt(lead.id, fullName);
            closeDropdown = false;
          } else if (action === 'unsnooze' && window.LeadSnooze) {
            // Wave 62: unsnooze fires immediately + re-renders the
            // dropdown so the button flips 💤/⏰ in place. Keep
            // the dropdown open so the rep can verify + keep
            // working.
            window.LeadSnooze.promptUnsnooze(lead.id).then(() => {
              renderRecentCustomers();
            });
            closeDropdown = false;
          }
          // Close the dropdown only on share actions so the rep
          // sees the SMS composer / mail client without the
          // dropdown obscuring. Snooze/unsnooze stay open.
          if (closeDropdown) {
            const dd = document.getElementById('recentDropdown');
            if (dd) dd.style.display = 'none';
          }
        });
      });

      list.querySelectorAll('.nbd-recent-row').forEach(row => {
        row.addEventListener('click', (ev) => {
          // Defensive: a click on a child element of an action
          // button should already have been stopped by the action
          // handler, but guard anyway.
          if (ev.target && ev.target.closest && ev.target.closest('.rc-action')) return;
          const id = row.dataset.id;
          if (!id) return;
          // Reuse Wave 11 handoff for instant render.
          try {
            if (typeof window._stashLeadForCustomerPage === 'function') {
              window._stashLeadForCustomerPage(id);
            }
          } catch (_) {}
          window.location.href = '/pro/customer.html?id=' + encodeURIComponent(id);
        });
      });
    } catch (err) {
      console.error('Failed to render recent:', err);
    }
  }
  
  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('recentDropdown');
    const btn = document.getElementById('recentBtn');
    if (dropdown && !dropdown.contains(e.target) && !btn.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });

  // STAGES, _dragId, _filteredLeads now declared at top-level (lines 91-93)

  // ── LEADS ──────────────────────────────────────
  async function loadLeads() {
    // Wave 120: clear any stale retry timer from a prior loadLeads
    // call. Without this, a setTimeout-scheduled retry from the
    // previous load could fire mid-way through a fresh load — the
    // retry would see stale window._user state from before bfcache
    // restore + auth resettling, hit the 1-second wait + bail path
    // below, and call renderLeads([]) right when fresh data was
    // about to render. (One source of the 50% reload-stuck bug.)
    if (window._loadLeadsRetryTimer) {
      try { clearTimeout(window._loadLeadsRetryTimer); } catch (_) {}
      window._loadLeadsRetryTimer = null;
    }
    // Wave 134: same cleanup for the W120 30s render-retry interval —
    // a stale poll from a prior loadLeads call could call renderLeads
    // mid-fresh-load and stomp on the new data with old leads. The
    // .then() block below installs a fresh _renderRetryHandle on
    // every call; clearing here ensures only one is ever live.
    if (window._renderRetryHandle) {
      try { clearInterval(window._renderRetryHandle); } catch (_) {}
      window._renderRetryHandle = null;
    }
    // Update health indicator to loading
    const healthBadge = document.getElementById('crmHealthBadge');
    if (healthBadge) {
      healthBadge.className = 'health-indicator loading';
      healthBadge.title = 'Loading CRM data...';
    }
    
    // Show skeleton loading state (replaces old spinner)
    const kanbanBoard = document.getElementById('kanbanBoard');
    if (kanbanBoard && !window._leads?.length) {
      showKanbanSkeleton();
    }
    
    try {
      const uid = window._user?.uid;
      
      if (!uid) { 
        console.warn('⚠️ loadLeads: No user ID — waiting for auth...');
        // Wait a bit for auth to settle
        await new Promise(resolve => setTimeout(resolve, 1000));
        const retryUid = window._user?.uid;
        if (!retryUid) {
          console.error('❌ loadLeads: Still no user after retry — auth failure');
          window._leads = [];
          // Update health indicator to error
          if (healthBadge) {
            healthBadge.className = 'health-indicator error';
            healthBadge.title = 'CRM Error: Authentication failed';
          }
          // Restore kanban empty state
          if (typeof renderLeads === 'function') renderLeads([]);
          return;
        }
      }
      
      const finalUid = window._user?.uid;

      // Wave 187: PRE-FLIGHT connection cycle on FIRST loadLeads per
      // page load. The Firestore SDK's WebSocket/long-poll often
      // survives same-tab reloads in a "warm-but-dead" state — the
      // browser killed the underlying socket during navigation but
      // the SDK doesn't notice until getDocs hits the 10s timeout
      // below. Doing the cycle BEFORE the first query (instead of
      // reactively in the catch path) eliminates the "every other
      // reload shows skeleton" alternation pattern: the user used to
      // hit 50% stuck loads because each successful load "warmed" a
      // socket that the next reload would inherit and then hang on.
      //
      // Cost: ~250-400ms added to cold start, ONCE per tab (gated by
      // window._firestoreCycledOnBoot so subsequent loadLeads calls
      // — view switches, manual refreshes — skip the cycle).
      //
      // Escape hatch: append ?nocycle=1 to the URL to skip this if it
      // ever regresses on a specific browser. Mirror of ?nosw=1.
      const _nocycle = new URLSearchParams(location.search).has('nocycle');
      if (!window._firestoreCycledOnBoot && !_nocycle) {
        window._firestoreCycledOnBoot = true;
        try {
          await disableNetwork(db);
          await new Promise(r => setTimeout(r, 100));
          await enableNetwork(db);
        } catch (preflightErr) {
          console.warn('Pre-flight network cycle failed (non-fatal):', preflightErr.message);
        }
      }

      // 10s timeout — getDocs on a stale iOS bfcache connection hangs
      // forever instead of rejecting, leaving healthBadge stuck on the
      // 'loading' class (yellow dot in connection-status-btn).
      //
      // On failure (despite the pre-flight cycle above), cycle the
      // Firestore connection AGAIN and retry once. The pre-flight covers
      // the common reload-stale case; this reactive cycle remains the
      // belt-and-suspenders fallback for transient iOS background-tab
      // throttling and other in-session connection deaths.
      // Audit #4 / 5.1 — Stage A: paginate the FETCH instead of pulling
      // every lead in one unbounded getDocs. A rep with thousands of leads
      // used to load them all in a single query that (a) risked the 10s
      // timeout on a big book and (b) spiked memory. We now page by
      // document id (limit + startAfter) and concatenate. The RESULT is
      // identical — same docs, just assembled from N round-trips — so the
      // `snap.docs` consumer below and all 68 window._leads readers are
      // unchanged. Each page keeps the original 10s timeout. Stage B
      // (later) moves KPI counts/search server-side to actually bound reads.
      //
      // Page by __name__ (documentId) ordering, which is implicit and
      // needs no composite index for a single equality filter. Verified in
      // the emulator: identical set, no dupes/gaps across pages.
      const _PAGE = 500;
      const _runQuery = async () => {
        const allDocs = [];
        let cursor = null;
        // Hard ceiling so a pathological/corrupt cursor can't loop forever:
        // 200 pages × 500 = 100k leads, far beyond any real rep.
        for (let page = 0; page < 200; page++) {
          let q = query(collection(db,'leads'), where('userId','==',finalUid), limit(_PAGE));
          if (cursor) q = query(collection(db,'leads'), where('userId','==',finalUid), startAfter(cursor), limit(_PAGE));
          const pageSnap = await Promise.race([
            getDocs(q),
            new Promise((_, reject) => setTimeout(() => reject(new Error('getDocs(leads) timeout after 10000ms')), 10000))
          ]);
          for (const d of pageSnap.docs) allDocs.push(d);
          if (pageSnap.size < _PAGE) break;   // last (partial) page
          cursor = pageSnap.docs[pageSnap.docs.length - 1];
        }
        // Return a snapshot-shaped object so downstream code is untouched.
        return { docs: allDocs, size: allDocs.length };
      };

      let snap;
      try {
        snap = await _runQuery();
      } catch (firstErr) {
        console.warn('loadLeads first attempt failed, cycling connection and retrying:', firstErr.message);
        if (healthBadge) {
          healthBadge.className = 'health-indicator loading';
          healthBadge.title = 'Reconnecting…';
        }
        try {
          await disableNetwork(db);
          await new Promise(r => setTimeout(r, 250));
          await enableNetwork(db);
        } catch (cycleErr) {
          console.warn('Network cycle failed (non-fatal):', cycleErr.message);
        }
        // Second attempt — if this fails the outer catch handles it.
        snap = await _runQuery();
        console.log('✅ loadLeads recovered on retry');
      }

      // Wave 110: when the rep has the 'sales_rep' role claim,
      // narrow the in-memory cache to ONLY leads they own. Was
      // previously a render-time filter in crm.js — meaning all
      // leads still lived in window._leads and any rep with
      // DevTools could read teammates' data. Firestore rules
      // already restrict writes (a rep can't mutate someone else's
      // lead), but the client-side cache leaked the read shape.
      // Sourcing the filter at hydration so the data isn't in the
      // browser at all.
      const _userRole = (window._userClaims && window._userClaims.role) || null;
      window._leads = snap.docs
        .map(d => ({id:d.id,...d.data()}))
        .filter(l => !l.deleted)
        .filter(l => {
          if (_userRole !== 'sales_rep') return true;
          // sales_rep: keep only own leads
          return l.userId === (window._user && window._user.uid);
        })
        .sort((a,b) => {
          const ta = a.createdAt?.toDate?.()?.getTime() || 0;
          const tb = b.createdAt?.toDate?.()?.getTime() || 0;
          return tb - ta;
        });
      // Normalize stages: convert legacy display names → internal keys
      window._leads.forEach(l => {
        if (l.stage) l._stageKey = normalizeStage(l.stage);
        else l._stageKey = S.NEW;
      });
      // Flag so downstream modules (Ask Joe Proactive morning briefing,
      // widgets, etc.) know the lead cache is hydrated vs still pending.
      window._leadsLoaded = true;
      console.log('✅ loadLeads: Processed', window._leads.length, 'leads after filtering deleted');
      // Wave 13: tell the notification bell + any other listeners that
      // the lead cache just refreshed so they can recompute counts.
      try { window.dispatchEvent(new CustomEvent('nbd:data-refreshed', { detail: { source: 'leads' } })); } catch (_) {}
      
      // Update health indicator to healthy
      if (healthBadge) {
        healthBadge.className = 'health-indicator healthy';
        healthBadge.title = `CRM Connected • ${window._leads.length} leads loaded`;
      }
      
    } catch(e) {
      console.error('❌ loadLeads failed:', e.message, e.code, e);
      console.error('Full error:', e);
      // W159 P1: stash last error so the on-page mobile diagnostic
      // banner can show it without devtools.
      try {
        window._loadLeadsLastError = {
          message: String(e && e.message || e),
          code: String(e && e.code || ''),
          name: String(e && e.name || ''),
          ts: Date.now()
        };
      } catch (_) {}
      // Only zero out the cache on FIRST load. On subsequent failures
      // (e.g. transient iOS connection drop after the user saved a
      // lead), keep the existing cache so just-saved leads added via
      // optimistic update don't vanish from the kanban while we're
      // offline. The next successful loadLeads — or the visibilitychange
      // handler — will overwrite with fresh data.
      if (!window._leadsLoaded) {
        window._leads = [];
      } else {
        console.warn('loadLeads kept stale cache of ' + (window._leads?.length || 0) + ' leads (transient failure)');
      }

      // Update health indicator to error
      if (healthBadge) {
        healthBadge.className = 'health-indicator error';
        const errorMsg = e.code === 'permission-denied'
          ? 'CRM Error: Firestore rules blocking access'
          : `CRM Error: ${e.message}`;
        healthBadge.title = errorMsg;
      }

      // iOS Safari frequently fails its first Firestore read on cold
      // start (app coming back from background, network re-handshake).
      // The user used to fix this by spam open/close. Now we auto-retry
      // a few times with exponential backoff before giving up — only on
      // the FIRST cold-start failure (when nothing was ever loaded), and
      // only for transient error codes. Permission-denied is permanent
      // and we let the user see it normally.
      const isTransient = e.code === 'unavailable'
        || e.code === 'deadline-exceeded'
        || e.code === 'cancelled'
        || e.code === 'internal'
        || /network|offline|timeout|failed to fetch/i.test(e.message || '');
      if (!window._leadsLoaded && isTransient) {
        const attempt = (window._loadLeadsRetryAttempt = (window._loadLeadsRetryAttempt || 0) + 1);
        if (attempt <= 3) {
          const delay = 600 * attempt; // 600ms, 1.2s, 1.8s
          console.warn(`loadLeads cold-start retry ${attempt}/3 in ${delay}ms`);
          // Wave 120: track the timer handle so a fresh loadLeads call
          // can cancel a stale retry before scheduling new work.
          window._loadLeadsRetryTimer = setTimeout(() => {
            window._loadLeadsRetryTimer = null;
            // Bail if a successful load happened in the meantime.
            if (window._leadsLoaded) return;
            try { loadLeads(); } catch (_) {}
          }, delay);
        } else {
          // ── Slow-loop fallback ──
          // The 3 fast retries already failed. Instead of giving up
          // entirely, keep trying at a 15s cadence for another 5 attempts
          // (~75s recovery window). This catches the iOS Safari case
          // where the network handshake takes longer than the fast-retry
          // budget allows. The diag banner shows the live state.
          const slowAttempt = (window._loadLeadsSlowAttempt = (window._loadLeadsSlowAttempt || 0) + 1);
          if (slowAttempt <= 5) {
            const slowDelay = 15000;
            window._loadLeadsNextRetryAt = Date.now() + slowDelay;
            console.warn(`loadLeads slow retry ${slowAttempt}/5 in ${slowDelay}ms`);
            window._loadLeadsRetryTimer = setTimeout(() => {
              window._loadLeadsRetryTimer = null;
              window._loadLeadsNextRetryAt = null;
              if (window._leadsLoaded) return;
              try { loadLeads(); } catch (_) {}
            }, slowDelay);
          } else {
            console.error('loadLeads exhausted slow-loop retries — user can tap the diag banner to retry');
            window._loadLeadsExhausted = true;
            window._loadLeadsNextRetryAt = null;
          }
        }
      }
    }
    // Reset retry counters on success so the next transient failure gets
    // the full retry budget again. Without this, a single recovered load
    // followed by a later failure would skip straight to slow-loop / give-up.
    if (window._leadsLoaded) {
      window._loadLeadsRetryAttempt = 0;
      window._loadLeadsSlowAttempt = 0;
      window._loadLeadsExhausted = false;
      window._loadLeadsNextRetryAt = null;
    }
    // Load photo cache for thumbnails
    try {
      const _puid = window._user?.uid;
      const psnap = _puid
        ? await getDocs(query(collection(db,'photos'), where('userId','==',_puid)))
        : { docs: [] };
      window._photoCache = {};
      psnap.docs.forEach(d => {
        const p = {id:d.id,...d.data()};
        if(!window._photoCache[p.leadId]) window._photoCache[p.leadId] = [];
        window._photoCache[p.leadId].push(p);
      });
    } catch(e) { window._photoCache = {}; }
    // Wave 120: replace one-shot 500ms retry with a polling loop so
    // a slow crm.js load doesn't leave the kanban skeleton up forever.
    // The OUTER loadLeads().then() block at line ~611 also runs a
    // 30s polling loop; this inner block is the fast path when crm.js
    // is already there. We coalesce window._leads to [] so a transient
    // failure that left it undefined doesn't render-throw.
    function _innerRender() {
      if (typeof renderLeads !== 'function') return false;
      // Same kanban-column rebuild guard as the outer _attemptRender —
      // see the W158 comment there. Without this the fast-path render
      // can paint into a board that has no columns.
      const _board = document.getElementById('kanbanBoard');
      if (_board && !_board.querySelector('.kanban-col') &&
          typeof window.buildKanbanColumns === 'function') {
        try { window.buildKanbanColumns(window._currentViewKey || 'insurance'); }
        catch (e) { console.warn('[loadLeads] buildKanbanColumns threw:', e.message); }
      }
      const leads = Array.isArray(window._leads) ? window._leads : [];
      try {
        renderLeads(leads);
        if (typeof restoreCrmSearch === 'function') restoreCrmSearch();
        if (typeof updatePipeline === 'function') updatePipeline(leads);
        if (typeof calculateWeeklyStats === 'function') calculateWeeklyStats();
        return true;
      } catch (e) {
        console.warn('[loadLeads] inner render threw:', e.message);
        return false;
      }
    }
    if (!_innerRender()) {
      console.warn('⚠️ renderLeads not loaded yet — outer poll loop will pick it up');
      // The outer loadLeads().then() block runs its own 30s poll loop.
      // Don't double-poll here — single source of truth for the retry.
    }
    // Fire follow-up notifications after leads are fresh
    setTimeout(() => checkAndCreateFollowUpNotifications(window._leads), 1200);
    // Needs-field auto-notifier — flags leads stuck without a required
    // field for their current stage so the rep doesn't discover it
    // mid-drag. Delayed slightly past the follow-up check so the
    // existing-keys dedupe (which reads window._notifications) sees
    // any fresh follow-ups before deciding what to add on top.
    setTimeout(() => {
      if (typeof window.checkAndCreateNeedsFieldNotifications === 'function') {
        window.checkAndCreateNeedsFieldNotifications(window._leads);
      }
    }, 2400);
    // Render KPI analytics row on home dashboard (with margin card)
    if (typeof renderKPIRow === 'function') setTimeout(() => {
      renderKPIRow();
      // Inject margin KPI card if profit data exists
      if (window.ProfitTracker?.getMarginKPICard) {
        const kpiGrid = document.querySelector('#kpiRow .kpi-grid');
        if (kpiGrid) {
          const marginHTML = window.ProfitTracker.getMarginKPICard();
          if (marginHTML) kpiGrid.insertAdjacentHTML('beforeend', marginHTML);
        }
      }
    }, 200);
    // Auto-check for review requests on recently closed jobs
    if (window.ReviewEngine?.checkAutoReviews) setTimeout(() => window.ReviewEngine.checkAutoReviews(), 3000);
    // Supplier pricing: feature was removed; archive folder deleted with
    // the 2026-04-23 dead-code cleanup.
  }
  window._loadLeads = loadLeads;
  // Alias without the underscore prefix so external callers (refresh
  // button in connection-status-btn.js, Cypress/Playwright scripts,
  // browser-console debugging) can use the documented short name too.
  // The underscore convention is the older internal style; we keep
  // both pointing at the same function so neither breaks.
  window.loadLeads = loadLeads;
  // DO NOT call loadLeads() here at module parse time.
  // Auth hasn't fired yet so window._user is null → loadLeads
  // gets no uid → returns empty → kanban shows 0 cards.
  // loadLeads() is called at line 486 INSIDE onAuthStateChanged
  // where the user is guaranteed to exist.

  // ══════════════════════════════════════════════════════════════
  // LOAD SAMPLE DATA (for testing when account has zero leads)
  // ══════════════════════════════════════════════════════════════
  async function loadSampleData() {
    if (!window._user?.uid) {
      showToast('Please sign in first', 'error');
      return;
    }
    
    const sampleLeads = [
      {
        firstName: 'Sarah', lastName: 'Martinez',
        address: '1234 Oakwood Drive, Cincinnati, OH 45202',
        phone: '513-555-0123', email: 'sarah.martinez@email.com',
        damageType: 'Roof - Hail', stage: 'New',
        jobValue: 8500, source: 'Referral',
        claimNumber: 'HO-2024-8472',
        carrier: 'State Farm',
        notes: 'Called about hail damage from March storm. Needs inspection ASAP.'
      },
      {
        firstName: 'Michael', lastName: 'Chen',
        address: '5678 Maple Street, Mason, OH 45040',
        phone: '513-555-0456', email: 'm.chen@email.com',
        damageType: 'Roof - Wind', stage: 'Inspected',
        jobValue: 12300, source: 'Door Knock',
        claimNumber: 'WS-2024-3391',
        carrier: 'Allstate',
        notes: 'Inspection complete. Several missing shingles on north slope.'
      },
      {
        firstName: 'Jennifer', lastName: 'Williams',
        address: '910 Birch Lane, West Chester, OH 45069',
        phone: '513-555-0789', email: 'jen.williams@email.com',
        damageType: 'Siding - Hail', stage: 'Estimate Sent',
        jobValue: 15700, source: 'Web Lead',
        claimNumber: 'SI-2024-5612',
        carrier: 'Liberty Mutual',
        notes: 'Estimate sent 2 days ago. Waiting for adjuster approval.'
      },
      {
        firstName: 'Robert', lastName: 'Thompson',
        address: '2468 Cedar Court, Hamilton, OH 45011',
        phone: '513-555-0321', email: 'rob.thompson@email.com',
        damageType: 'Full Exterior', stage: 'Approved',
        jobValue: 24500, source: 'Referral',
        claimNumber: 'FE-2024-7823',
        carrier: 'Nationwide',
        notes: 'Full exterior replacement approved. Scheduling start date.'
      },
      {
        firstName: 'Emily', lastName: 'Davis',
        address: '1357 Pine Ridge Road, Lebanon, OH 45036',
        phone: '513-555-0654', email: 'emily.davis@email.com',
        damageType: 'Gutters', stage: 'In Progress',
        jobValue: 3200, source: 'Door Knock',
        claimNumber: 'GU-2024-9104',
        carrier: 'Farmers',
        notes: 'Gutter replacement in progress. 60% complete.'
      }
    ];

    try {
      showToast('Loading sample data...', 'info');
      const batch = [];
      
      for (const lead of sampleLeads) {
        const docRef = await addDoc(collection(db, 'leads'), {
          ...lead,
          userId: window._user.uid,
          companyId: window._userClaims?.companyId || window._user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          deleted: false
        });
        batch.push(docRef.id);
      }
      
      console.log('✅ Created', batch.length, 'sample leads');
      showToast(`✅ Added ${batch.length} sample leads to your CRM`, 'success');
      
      // Reload leads and refresh kanban
      await loadLeads();
      
      // Hide the sample data button
      const btn = document.getElementById('loadSampleDataBtn');
      if (btn) btn.style.display = 'none';
      
    } catch (error) {
      console.error('❌ loadSampleData error:', error);
      showToast('Failed to load sample data: ' + error.message, 'error');
    }
  }
  window.loadSampleData = loadSampleData;

  // ══════════════════════════════════════════════════════════════
  // DEBUG CONSOLE HELPERS
  // ══════════════════════════════════════════════════════════════
  function toggleDebugConsole() {
    const console = document.getElementById('debugConsole');
    const toggle = document.getElementById('debugConsoleToggle');
    if (!console || !toggle) return;
    
    const isHidden = console.style.display === 'none';
    console.style.display = isHidden ? 'block' : 'none';
    toggle.textContent = isHidden ? '▼' : '▶';
    
    if (isHidden) {
      // Populate with recent console logs
      const content = document.getElementById('debugConsoleContent');
      if (content && window._debugLogs) {
        content.textContent = window._debugLogs.join('\n');
      }
    }
  }
  window.toggleDebugConsole = toggleDebugConsole;
  
  function retryLoadLeads() {
    const healthBadge = document.getElementById('crmHealthBadge');
    if (healthBadge) {
      healthBadge.className = 'health-indicator loading';
      healthBadge.title = 'Retrying...';
    }
    showToast('Retrying CRM data load...', 'info');
    loadLeads();
  }
  window.retryLoadLeads = retryLoadLeads;
  
  function copyDebugInfo() {
    const debugText = [
      '═══ NBD PRO CRM DEBUG INFO ═══',
      '',
      'User:',
      `  Email: ${window._user?.email || 'Not authenticated'}`,
      `  UID: ${window._user?.uid || 'None'}`,
      '',
      'Database:',
      `  Connected: ${window.db ? 'Yes' : 'No'}`,
      `  Auth State: ${window._auth?.currentUser?.uid || 'No current user'}`,
      '',
      'CRM State:',
      `  Leads in Memory: ${window._leads?.length || 0}`,
      `  Filtered Leads: ${window._filteredLeads?.length || 'N/A'}`,
      '',
      'Console Logs:',
      ...(window._debugLogs || ['No debug logs captured']),
      '',
      '═══ END DEBUG INFO ═══'
    ].join('\n');
    
    navigator.clipboard.writeText(debugText).then(() => {
      showToast('✅ Debug info copied to clipboard', 'success');
    }).catch(() => {
      showToast('❌ Failed to copy — check console', 'error');
      console.log(debugText);
    });
  }
  window.copyDebugInfo = copyDebugInfo;
  
  // Test Firestore Rules
  async function testFirestoreRules() {
    if (!window._user?.uid) {
      showToast('❌ Not authenticated — sign in first', 'error');
      return;
    }
    
    showToast('Testing Firestore rules...', 'info');
    const results = [];
    const uid = window._user.uid;
    
    try {
      // Test 1: Read own leads
      results.push('Testing: Read leads collection...');
      const leadsSnap = await getDocs(query(collection(db,'leads'), where('userId','==',uid)));
      results.push(`✅ Read leads: Success (${leadsSnap.docs.length} docs)`);
      
      // Test 2: Write to leads
      results.push('Testing: Write to leads collection...');
      const testDoc = await addDoc(collection(db, 'leads'), {
        userId: uid,
        companyId: window._userClaims?.companyId || uid,
        firstName: 'Test',
        lastName: 'Rule Check',
        address: 'Rule Validator',
        stage: 'New',
        createdAt: serverTimestamp(),
        deleted: false,
        _test: true
      });
      results.push(`✅ Write leads: Success (id: ${testDoc.id})`);
      
      // Test 3: Delete test doc
      results.push('Testing: Delete from leads collection...');
      await deleteDoc(doc(db, 'leads', testDoc.id));
      results.push(`✅ Delete leads: Success`);
      
      // Test 4: Read estimates
      results.push('Testing: Read estimates collection...');
      const estSnap = await getDocs(query(collection(db,'estimates'), where('userId','==',uid)));
      results.push(`✅ Read estimates: Success (${estSnap.docs.length} docs)`);
      
      // Test 5: Read photos
      results.push('Testing: Read photos collection...');
      const photoSnap = await getDocs(query(collection(db,'photos'), where('userId','==',uid)));
      results.push(`✅ Read photos: Success (${photoSnap.docs.length} docs)`);
      
      results.push('');
      results.push('🎉 All tests passed! Firestore rules are correctly configured.');
      
    } catch(e) {
      results.push('');
      results.push(`❌ Test failed: ${e.message}`);
      results.push(`Error code: ${e.code || 'unknown'}`);
      
      if (e.code === 'permission-denied') {
        results.push('');
        results.push('⚠️ PERMISSION DENIED — Your Firestore rules are blocking access.');
        results.push('Fix: Deploy rules from FIRESTORE_RULES.txt in repo');
        results.push('Firebase Console → Firestore → Rules tab');
      }
    }
    
    // Show results in diagnostic panel
    const detailsEl = document.getElementById('crmDiagnosticDetails');
    if (detailsEl) {
      detailsEl.textContent = results.join('\n');
    }
    
    // Also log to console
    console.log('═══ FIRESTORE RULES TEST ═══');
    results.forEach(r => console.log(r));
    console.log('═══ END TEST ═══');
    
    const lastLine = results[results.length - 1];
    if (lastLine.includes('passed')) {
      showToast('✅ Firestore rules test passed!', 'success');
    } else {
      showToast('❌ Firestore rules test failed — check diagnostic panel', 'error');
    }
  }
  window.testFirestoreRules = testFirestoreRules;
  
  // Capture console logs for debug panel.
  //
  // CRITICAL: stringify must NOT throw — Firebase's WebChannel error
  // objects are circular (Y.i = Ka with src closing the cycle), and
  // a previous version of this block called JSON.stringify directly
  // on every object arg. On any transient Firestore network blip the
  // SDK would call console.warn(circularError), our override would
  // throw inside JSON.stringify, that uncaught throw killed Firebase's
  // internal logger, the logger threw on every retry, and Firestore
  // wedged into the offline state with no recovery. Symptoms in the
  // field: "Failed to get document because the client is offline",
  // kanban never loads, theme-achievements + mobile-nav-customizer
  // both error out, all originating from the same JSON.stringify trap.
  //
  // _safeStringify uses a circular-ref-aware replacer that returns
  // '[Circular]' instead of throwing, plus a try/catch as last-resort
  // so even getter-throwing objects can't kill the override.
  if (!window._debugLogs) {
    window._debugLogs = [];
    const originalLog   = console.log;
    const originalWarn  = console.warn;
    const originalError = console.error;

    function _safeStringify(value) {
      try {
        const seen = new WeakSet();
        return JSON.stringify(value, function (_key, v) {
          if (typeof v === 'object' && v !== null) {
            if (seen.has(v)) return '[Circular]';
            seen.add(v);
          }
          if (typeof v === 'function') return '[Function]';
          return v;
        });
      } catch (_e) {
        try { return String(value); } catch (_e2) { return '[Unstringifiable]'; }
      }
    }

    function _formatArgs(args) {
      return args.map(a => typeof a === 'object' && a !== null ? _safeStringify(a) : String(a)).join(' ');
    }

    console.log = function(...args) {
      const msg = _formatArgs(args);
      if (msg.includes('loadLeads') || msg.includes('CRM') || msg.includes('🔍') || msg.includes('✅') || msg.includes('❌')) {
        window._debugLogs.push(`[LOG] ${msg}`);
        if (window._debugLogs.length > 50) window._debugLogs.shift(); // Keep last 50
      }
      originalLog.apply(console, args);
    };

    console.warn = function(...args) {
      const msg = _formatArgs(args);
      if (msg.includes('loadLeads') || msg.includes('CRM') || msg.includes('⚠️')) {
        window._debugLogs.push(`[WARN] ${msg}`);
        if (window._debugLogs.length > 50) window._debugLogs.shift();
      }
      originalWarn.apply(console, args);
    };

    console.error = function(...args) {
      const msg = _formatArgs(args);
      if (msg.includes('loadLeads') || msg.includes('CRM') || msg.includes('❌')) {
        window._debugLogs.push(`[ERROR] ${msg}`);
        if (window._debugLogs.length > 50) window._debugLogs.shift();
      }
      originalError.apply(console, args);
    };
  }

  function calculateWeeklyStats() {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    // New leads this week
    const newLeads = (window._leads || []).filter(l => {
      if (!l.createdAt) return false;
      const createdDate = l.createdAt.toDate ? l.createdAt.toDate() : new Date(l.createdAt);
      return createdDate >= weekAgo;
    });
    
    // Estimates this week
    const newEstimates = (window._estimates || []).filter(e => {
      if (!e.createdAt) return false;
      const createdDate = e.createdAt.toDate ? e.createdAt.toDate() : new Date(e.createdAt);
      return createdDate >= weekAgo;
    });
    
    // Revenue added this week (from new leads)
    const weekRevenue = newLeads.reduce((sum, l) => sum + parseFloat(l.jobValue || 0), 0);
    
    // Tasks completed this week
    let weekTasks = 0;
    Object.values(window._taskCache || {}).forEach(tasks => {
      tasks.forEach(t => {
        if (!t.done || !t.completedAt) return;
        const completedDate = t.completedAt.toDate ? t.completedAt.toDate() : new Date(t.completedAt);
        if (completedDate >= weekAgo) weekTasks++;
      });
    });
    
    // Update DOM — all 4 stat tiles live inside the lazy-hydrated
    // tpl-view-home template. When loadLeads resolves before the home
    // view has been mounted (cold-load race), getElementById returns
    // null and the first textContent assignment throws — the catch in
    // _attemptRender then kicks in a 30s retry loop that the user sees
    // as a half-loaded / blank dashboard. Guard each access so the
    // function is a clean no-op when its targets don't exist yet, and
    // the retry only fires when there's actually something to do.
    const _setStat = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    _setStat('weekNewLeads',  newLeads.length);
    _setStat('weekEstimates', newEstimates.length);
    _setStat('weekRevenue',   '$' + weekRevenue.toLocaleString());
    _setStat('weekTasks',     weekTasks);
  }

  // Optimistic kanban refresh helper — push the just-saved lead into
  // window._leads in-memory and re-render so the card appears IMMEDIATELY,
  // before loadLeads makes its round-trip. On iOS where loadLeads can
  // fail intermittently, this is the difference between "I saved a lead
  // and I see it on the kanban" and "I saved a lead and nothing happened".
  function _optimisticInsertLead(leadId, data) {
    if (!leadId) return;
    window._leads = window._leads || [];
    // If we already have this lead (edit case), replace it; otherwise prepend.
    const idx = window._leads.findIndex(l => l.id === leadId);
    const merged = {
      id: leadId,
      ...data,
      userId: window._user?.uid,
      createdAt: window._leads[idx]?.createdAt || new Date(),
      _stageKey: typeof normalizeStage === 'function'
        ? normalizeStage(data.stage)
        : (data.stage || 'new')
    };
    if (idx >= 0) window._leads[idx] = merged;
    else window._leads.unshift(merged);
    window._leadsLoaded = true; // ensure stale-cache guard treats this as populated
    if (typeof renderLeads === 'function') {
      try { renderLeads(window._leads); } catch (_) {}
    }
  }

  window._saveLead = async (data) => {
    try {
      const editId = data.id;
      delete data.id;

      // LITE PLAN: enforce 25-lead limit on new leads
      if ((!editId || editId.startsWith('d-')) && window._userPlan === 'lite') {
        const currentCount = (window._leads || []).length;
        if (currentCount >= 25) {
          showToast('Free tier limit: 25 leads. Upgrade to Pro for unlimited leads.', 'error');
          return null;
        }
      }

      // Wave 15: dedup guard — only on new leads (not edits). Surfaces
      // matching existing leads before we write so reps can open the
      // dupe instead of creating a second one. Skipped if the dedup
      // module hasn't loaded yet (degrades gracefully).
      let _duplicateOf = null;
      if ((!editId || editId.startsWith('d-')) && window.LeadDedup) {
        try {
          const result = await window.LeadDedup.checkAndPrompt(data, window._leads || []);
          if (!result.proceed) {
            if (result.openLeadId) {
              // Rep chose to open the existing lead — navigate there.
              window.location.href = `/pro/customer.html?id=${encodeURIComponent(result.openLeadId)}`;
            }
            return null;
          }
          if (result.duplicateOf) _duplicateOf = result.duplicateOf;
        } catch (dedupErr) {
          console.warn('[lead-dedup] check failed; proceeding without dedup:', dedupErr);
        }
      }
      // Stamp duplicateOf on the payload so it persists in Firestore
      // for audit / future cleanup. Falsy values won't get written.
      if (_duplicateOf) data.duplicateOf = _duplicateOf;

      // NEW LEAD: Geocode address and create map pin
      if (!editId || editId.startsWith('d-')) {
        if (data.address) {
          try {
            const geo = await geocode(data.address);
            if (geo && geo.lat && geo.lon) {
              // Store lat/lng on lead
              data.lat = parseFloat(geo.lat);
              data.lng = parseFloat(geo.lon);
              
              // Create map pin
              const pinData = {
                lat: data.lat,
                lng: data.lng,
                name: `${data.firstName || ''} ${data.lastName || ''}`.trim(),
                address: data.address,
                leadId: null, // Will be set after lead is created
                stage: data.stage || 'New',
                type: 'customer'
              };
              
              // Save lead first to get ID. stageStartedAt is stamped at
              // create-time so the days-in-stage badge has a real
              // anchor for brand-new leads (without it, the badge fell
              // back to updatedAt/createdAt — usable but not the same
              // semantic).
              //
              // companyId scoping (Rock 3 PR 2): every lead is now
              // tagged with the caller's companyId so multi-tenant
              // queries and the upcoming E2E test cleanup can reliably
              // filter by tenant. Solo operators get their own uid as
              // companyId (matches the convention in functions/index.js
              // line 283: "callerCompanyId = decoded.companyId || decoded.uid").
              //
              // Audit batch 6 (2026-05-13): migrated to NBDRepos.leads.create
              // which centralizes the userId/companyId/createdAt/updatedAt
              // stamping. Falls back to the inline addDoc when NBDRepos
              // isn't loaded (defensive; the repos module is now in the
              // defer chain so this should always be available, but a
              // failed lazy-load shouldn't break lead creation).
              let leadRef;
              if (window.NBDRepos && window.NBDRepos.leads && typeof window.NBDRepos.leads.create === 'function') {
                const { id } = await window.NBDRepos.leads.create({
                  ...data,
                  stageStartedAt: serverTimestamp(),
                });
                leadRef = doc(db, 'leads', id);
              } else {
                leadRef = await addDoc(collection(db,'leads'), {
                  ...data,
                  createdAt: serverTimestamp(),
                  stageStartedAt: serverTimestamp(),
                  userId: window._user?.uid,
                  companyId: window._userClaims?.companyId || window._user?.uid || null
                });
              }

              // Optimistic insert — show on kanban immediately, even
              // if loadLeads later fails on a flaky iOS connection.
              _optimisticInsertLead(leadRef.id, data);

              // Now save pin with leadId
              pinData.leadId = leadRef.id;
              await window._savePin(pinData);

              // Auto-assign customer ID (NBD-0001 format)
              try {
                const _cid = window._userClaims?.companyId || window._user?.uid;
                const _ctrId = (typeof window._custCounterId === 'function') ? window._custCounterId(_cid) : 'customerIds';
                const _pfx = (typeof window._custIdPrefix === 'function') ? window._custIdPrefix() : 'NBD';
                const counterRef = doc(db, 'counters', _ctrId);
                const custId = await runTransaction(db, async (tx) => {
                  const snap = await tx.get(counterRef);
                  let nextNum = snap.exists() ? (snap.data().next || 0) + 1 : 1;
                  tx.set(counterRef, { next: nextNum }, { merge: true });
                  return _pfx + '-' + String(nextNum).padStart(4, '0');
                });
                await updateDoc(doc(db, 'leads', leadRef.id), { customerId: custId });
                console.log('✓ Assigned customer ID:', custId);
              } catch (cidErr) { console.warn('Customer ID assignment failed:', cidErr); }

              console.log('✓ Auto-pinned lead:', leadRef.id);

              // If this came from a D2D knock, mark it as converted
              if (data.d2dKnockId) {
                try {
                  await updateDoc(doc(db, 'knocks', data.d2dKnockId), { convertedToLead: true, leadId: leadRef.id, updatedAt: serverTimestamp() });
                } catch (d2dErr) { console.warn('Could not mark D2D knock as converted:', d2dErr); }
              }
              // If this came from a pin, link the pin to the lead
              if (window._pendingPinId) {
                try {
                  await window._savePin({ id: window._pendingPinId, leadId: leadRef.id });
                } catch (pinErr) { console.warn('Could not link pin:', pinErr); }
                window._pendingPinId = null;
                window._pendingPinLatLng = null;
              }

              await loadPins(); // Refresh map pins
              await loadLeads();
              // Return the new leadId so callers (e.g. Quick Add) can
              // chain follow-up writes — initial activity entry, first
              // task, etc. — without re-querying Firestore.
              return leadRef.id;
            }
          } catch (geoError) {
            console.warn('Geocoding failed, creating lead without pin:', geoError);
            // Continue to create lead without pin
          }
        }
        
        // Fallback: create lead without geocoding
        // Use lat/lng from D2D knock or pin if available
        if (!data.lat && window._pendingPinLatLng) {
          data.lat = window._pendingPinLatLng.lat;
          data.lng = window._pendingPinLatLng.lng;
        }
        // companyId tagged here too — see comment on the geocoded path above.
        const fallbackRef = await addDoc(collection(db,'leads'), {
          ...data,
          createdAt: serverTimestamp(),
          stageStartedAt: serverTimestamp(),
          userId: window._user?.uid,
          companyId: window._userClaims?.companyId || window._user?.uid || null
        });
        // Optimistic insert — show on kanban immediately even if the
        // post-save loadLeads fails (iOS flaky connection scenario).
        _optimisticInsertLead(fallbackRef.id, data);
        // Auto-assign customer ID
        try {
          const _cid = window._userClaims?.companyId || window._user?.uid;
          const _ctrId = (typeof window._custCounterId === 'function') ? window._custCounterId(_cid) : 'customerIds';
          const _pfx = (typeof window._custIdPrefix === 'function') ? window._custIdPrefix() : 'NBD';
          const counterRef = doc(db, 'counters', _ctrId);
          const custId = await runTransaction(db, async (tx) => {
            const snap = await tx.get(counterRef);
            let nextNum = snap.exists() ? (snap.data().next || 0) + 1 : 1;
            tx.set(counterRef, { next: nextNum }, { merge: true });
            return _pfx + '-' + String(nextNum).padStart(4, '0');
          });
          await updateDoc(doc(db, 'leads', fallbackRef.id), { customerId: custId });
          console.log('✓ Assigned customer ID:', custId);
        } catch (cidErr) { console.warn('Customer ID assignment failed:', cidErr); }
        // Mark D2D knock as converted
        if (data.d2dKnockId) {
          try {
            await updateDoc(doc(db, 'knocks', data.d2dKnockId), { convertedToLead: true, leadId: fallbackRef.id, updatedAt: serverTimestamp() });
          } catch (d2dErr) { console.warn('Could not mark D2D knock as converted:', d2dErr); }
        }
        // Link pin if pending
        if (window._pendingPinId) {
          try { await window._savePin({ id: window._pendingPinId, leadId: fallbackRef.id }); } catch (pe) {}
          window._pendingPinId = null;
          window._pendingPinLatLng = null;
        }
        await loadLeads();
        // Return the newly-created lead's id (no-geocode fallback path).
        return fallbackRef.id;
      } else {
        // EDIT EXISTING: Just update
        await updateDoc(doc(db,'leads',editId), {
          ...data,
          updatedAt: serverTimestamp()
        });
        // Optimistic merge — reflect the edit on the kanban immediately
        // (e.g. stage changes that should move the card to a new column)
        // without waiting on the loadLeads round-trip.
        _optimisticInsertLead(editId, data);
        await loadLeads();
        // Return the edited lead's id so callers know which doc was touched.
        return editId;
      }
    } catch(e) {
      // Surface the failure rather than fabricating a ghost lead. The
      // previous catch unshifted a {id:'d-...', ...data} record into
      // window._leads — but the very next line called loadLeads()
      // which overwrites that array, so the ghost flashed on the
      // kanban for ~200ms then vanished with no error toast. Result:
      // silent lead-loss. Now toast the error AND re-throw so the
      // caller can react (e.g., D2D auto-convert can leave the knock
      // unmarked instead of claiming it converted).
      console.error('saveLead error:', e);
      const msg = (e && e.message) ? e.message : 'unknown error';
      if (typeof showToast === 'function') {
        showToast('Lead save failed — ' + msg + '. Try again or check connection.', 'error');
      }
      throw e;
    }
    await loadLeads();
  };

  window._deleteLead = async (id) => {
    try {
      if(!id.startsWith('d-')) {
        await updateDoc(doc(db,'leads',id), {
          deleted: true,
          deletedAt: serverTimestamp()
        });
      }
      window._leads = (window._leads||[]).filter(l=>l.id!==id);
      renderLeads(window._leads);
    } catch(e) { console.error('deleteLead error:', e); }
  };

  window._restoreLead = async (id) => {
    try {
      if(!id.startsWith('d-')) await updateDoc(doc(db,'leads',id), { deleted: false, deletedAt: null });
    } catch(e) { console.error('restoreLead error:', e); }
  };

  window._permanentDeleteLead = async (id) => {
    try {
      if(!id.startsWith('d-')) await deleteDoc(doc(db,'leads',id));
    } catch(e) { console.error('permanentDelete error:', e); }
  };

  window._loadDeletedLeads = async () => {
    try {
      const uid = window._user?.uid;
      if (!uid) return;
      const snap = await getDocs(query(collection(db,'leads'), where('userId','==',uid), where('deleted','==',true)));
      return snap.docs.map(d => ({id:d.id,...d.data()}));
    } catch(e) { return []; }
  };

  // ── ESTIMATES ──────────────────────────────────
  async function loadEstimates() {
    try {
      const uid = window._user?.uid;
      if (!uid) { window._estimates = []; return; }
      const snap = await getDocs(query(collection(db,'estimates'), where('userId','==',uid)));
      window._estimates = snap.docs
        .map(d => ({id:d.id,...d.data()}))
        .sort((a,b) => {
          const ta = a.createdAt?.toDate?.()?.getTime() || 0;
          const tb = b.createdAt?.toDate?.()?.getTime() || 0;
          return tb - ta;
        });
    } catch(e) { window._estimates = []; }
    renderEstimatesList(window._estimates);
    // Wave 13: notify the bell so stale-estimate counts update.
    try { window.dispatchEvent(new CustomEvent('nbd:data-refreshed', { detail: { source: 'estimates' } })); } catch (_) {}
  }
  window._loadEstimates = loadEstimates;
  // Alias for consistency with window.loadLeads above.
  window.loadEstimates = loadEstimates;

  // B3: Live Firestore listener for estimates. Wire-once on auth.
  // BoldSign webhooks land on the server, flip
  // estimates/{id}.signatureStatus → the snapshot fires → UI rerenders.
  // Handles create + update + delete. Idempotent re-subscribe safe.
  let _estimatesUnsub = null;
  window._subscribeEstimates = function () {
    if (_estimatesUnsub) { try { _estimatesUnsub(); } catch(e) {} _estimatesUnsub = null; }
    const uid = window._user?.uid;
    if (!uid) return;
    const q = query(collection(db, 'estimates'), where('userId', '==', uid));
    _estimatesUnsub = onSnapshot(q, (snap) => {
      const next = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const ta = a.createdAt?.toDate?.()?.getTime() || 0;
          const tb = b.createdAt?.toDate?.()?.getTime() || 0;
          return tb - ta;
        });
      window._estimates = next;
      renderEstimatesList(next);
    }, (err) => {
      console.warn('estimates snapshot error:', err && err.message);
      // Fall back to one-shot fetch so the UI isn't stuck empty.
      loadEstimates();
    });
  };

  window._saveEstimate = async (data) => {
    try {
      const editId = window._editingEstimateId;
      if (editId) {
        // Update existing estimate
        await updateDoc(doc(db,'estimates',editId), {...data, updatedAt:serverTimestamp()});
        window._editingEstimateId = null;
        await loadEstimates();
        return editId;
      } else {
        // Create new estimate
        const ref2 = await addDoc(collection(db,'estimates'), {...data, createdAt:serverTimestamp(), userId:window._user?.uid});
        await loadEstimates();
        return ref2.id;
      }
    } catch (e) {
      // Re-throw — the previous swallow + return-null was making the
      // caller in estimates.js fire its success toast even when the
      // Firestore write failed. Silent estimate-loss in production.
      // The caller now gets a real exception it can surface to the user.
      console.error('Save estimate error:', e);
      throw e;
    }
  };

  // ── ESTIMATE CRUD HELPERS ─────────────────────
  // Delete an estimate by document id. Cascade: we don't have
  // child collections under an estimate, so a single deleteDoc is
  // enough. Called from the estimates list overflow menu.
  window._deleteEstimate = async (id) => {
    try {
      if (!id) return false;
      await deleteDoc(doc(db, 'estimates', id));
      await loadEstimates();
      return true;
    } catch (e) {
      console.error('Delete estimate error:', e);
      return false;
    }
  };

  // Duplicate an existing estimate. Clones the document into a new
  // one with a new id and a "(copy)" name suffix so it shows up as
  // a separate row in the list. The duplicate is intentionally
  // unassigned (leadId = null) so the user can re-assign it.
  window._duplicateEstimate = async (id) => {
    try {
      if (!id) return null;
      const src = (window._estimates || []).find(e => e.id === id);
      if (!src) return null;
      // Strip fields that should not carry over: id, createdAt,
      // updatedAt, leadId. Keep everything else verbatim so the
      // copy opens in the same builder with the same numbers.
      const copy = { ...src };
      delete copy.id;
      delete copy.createdAt;
      delete copy.updatedAt;
      copy.leadId = null;
      const baseName = (src.name || src.addr || 'Estimate').toString().substring(0, 80);
      copy.name = baseName + ' (copy)';
      const ref2 = await addDoc(collection(db, 'estimates'), {
        ...copy,
        createdAt: serverTimestamp(),
        userId: window._user?.uid
      });
      await loadEstimates();
      return ref2.id;
    } catch (e) {
      console.error('Duplicate estimate error:', e);
      return null;
    }
  };

  // Rename an estimate in place — just writes back the name field.
  // Cheap and atomic.
  window._renameEstimate = async (id, newName) => {
    try {
      if (!id) return false;
      const name = String(newName || '').trim().substring(0, 120);
      if (!name) return false;
      await updateDoc(doc(db, 'estimates', id), { name, updatedAt: serverTimestamp() });
      await loadEstimates();
      return true;
    } catch (e) {
      console.error('Rename estimate error:', e);
      return false;
    }
  };

  // Assign (or re-assign) an estimate to a customer/lead. Writes
  // leadId and also copies the lead's address/owner over for faster
  // list display. Passing leadId=null clears the assignment.
  window._assignEstimateToLead = async (id, leadId) => {
    try {
      if (!id) return false;
      const patch = { leadId: leadId || null, updatedAt: serverTimestamp() };
      if (leadId) {
        const lead = (window._leads || []).find(l => l.id === leadId);
        if (lead) {
          if (lead.address) patch.addr = lead.address;
          if (lead.firstName || lead.lastName) {
            patch.owner = [lead.firstName, lead.lastName].filter(Boolean).join(' ');
          }
        }
      }
      await updateDoc(doc(db, 'estimates', id), patch);
      await loadEstimates();
      return true;
    } catch (e) {
      console.error('Assign estimate error:', e);
      return false;
    }
  };
  // ── END ESTIMATE CRUD HELPERS ─────────────────

  // ── REPORTS CRUD HELPERS ──────────────────────
  // Firestore-backed persistence for generated reports. Every report
  // that gets saved goes into a `reports` collection scoped by userId.
  // The Rep Report Generator UI calls these helpers; the viewer lists
  // them in the My Reports history panel.
  window._loadReports = async () => {
    try {
      const uid = window._user?.uid;
      if (!uid) { window._reports = []; return []; }
      const snap = await getDocs(query(
        collection(db, 'reports'),
        where('userId', '==', uid),
        orderBy('createdAt', 'desc'),
        limit(100)
      ));
      window._reports = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      return window._reports;
    } catch (e) {
      console.error('[Reports] loadReports failed:', e);
      window._reports = [];
      return [];
    }
  };

  window._saveReport = async (data) => {
    try {
      const uid = window._user?.uid;
      if (!uid) throw new Error('Not signed in');
      const ref2 = await addDoc(collection(db, 'reports'), {
        ...data,
        userId: uid,
        createdAt: serverTimestamp()
      });
      await window._loadReports();
      return ref2.id;
    } catch (e) {
      console.error('[Reports] saveReport failed:', e);
      return null;
    }
  };

  window._deleteReport = async (id) => {
    try {
      if (!id) return false;
      await deleteDoc(doc(db, 'reports', id));
      await window._loadReports();
      return true;
    } catch (e) {
      console.error('[Reports] deleteReport failed:', e);
      return false;
    }
  };
  // ── END REPORTS CRUD HELPERS ──────────────────

  // ── PINS ───────────────────────────────────────
  async function loadPins() {
    try {
      const uid = window._user?.uid;
      if (!uid) { console.warn('📌 loadPins: no uid, skipping'); window._pins = []; return; }
      const snap = await getDocs(query(collection(db,'pins'), where('userId','==',uid)));
      window._pins = snap.docs.map(d => ({id:d.id,...d.data()}));
    } catch(e) { console.error('📌 loadPins FAILED:', e.code, e.message, e); window._pins = []; }
  }
  window._savePin = async (data) => {
    try {
      if (data.id) {
        // Update existing pin
        const pinId = data.id;
        delete data.id;
        await updateDoc(doc(db,'pins',pinId), {...data, updatedAt:serverTimestamp()});
        return pinId;
      }
      // Create new pin
      const pinDoc = {...data, userId:window._user?.uid, createdAt:serverTimestamp()};
      const r = await addDoc(collection(db,'pins'), pinDoc);
      return r.id;
    }
    catch(e) { console.error('📌 savePin FAILED:', e.code, e.message, e); return 'd-'+Date.now(); }
  };
  window._deletePin = async (id) => { try { await deleteDoc(doc(db,'pins',id)); } catch(e){ console.warn('deletePin failed:', e); showToast('Failed to delete pin','error'); } };

  // ── PHOTOS ─────────────────────────────────────
  // Storage rules (storage.rules, 2026-04-11 hardening) require
  // `photos/{uid}/{...}`. The old `photos/{leadId}/...` path
  // hits the default-deny rule and returns permission-denied —
  // root cause of "upload failed" errors reported by users.
  window._uploadPhoto = async (leadId, file) => {
    try {
      const uid = window._user?.uid;
      if (!uid) throw new Error('Not signed in');
      const safeName = (file.name || 'upload').replace(/[^A-Za-z0-9._-]+/g, '_').substring(0, 120);
      const r = ref(storage, `photos/${uid}/${leadId}/${Date.now()}_${safeName}`);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      await addDoc(collection(db,'photos'), {leadId, url, name:file.name, userId:uid, createdAt:serverTimestamp()});
      return url;
    } catch(e) { console.error('Upload failed',e); return null; }
  };

  window._getPhotos = async (leadId) => {
    try {
      const uid = window._user?.uid;
      const snap = await getDocs(query(collection(db,'photos'), where('leadId','==',leadId), where('userId','==',uid)));
      return snap.docs.map(d => ({id:d.id,...d.data()}));
    } catch(e) { return []; }
  };

  // ── SETTINGS ───────────────────────────────────
  window._saveSettings = async () => {
    const name = document.getElementById('settingsName').value.trim();
    // Cal.com username — stored on users/{uid}.calcomUsername so the
    // calcomWebhook can resolve incoming bookings back to this rep.
    // Normalize: lowercase, strip trailing slashes / leading @.
    const rawCal = (document.getElementById('settingsCalcom')?.value || '').trim();
    const calcomUsername = rawCal.replace(/^@+/, '').replace(/\/+$/,'')
                                 .toLowerCase().slice(0, 60) || null;
    // Wave 16: weekly digest opt-in/out. Stored as a boolean so the
    // weeklyDigest cron's `=== false` check works as expected (default
    // is "send" if the field is missing or true).
    const digestEl = document.getElementById('settingsWeeklyDigest');
    const weeklyDigestEnabled = digestEl ? !!digestEl.checked : true;
    // Wave 28: dormant-nudge opt-in/out. Same default-ON semantics as
    // weeklyDigestEnabled; the dormantLeadNudge cron does an explicit
    // `=== false` skip check.
    const dormantEl = document.getElementById('settingsDormantNudge');
    const dormantNudgeEnabled = dormantEl ? !!dormantEl.checked : true;
    try {
      await updateProfile(window._user, {displayName: name});
      document.getElementById('userName').textContent = name;
      // Persist Cal.com username on the user profile.
      if (window.db && window.doc && window.setDoc) {
        await window.setDoc(window.doc(window.db, 'users', window._user.uid), {
          displayName: name,
          calcomUsername,
          weeklyDigestEnabled,
          dormantNudgeEnabled
        }, { merge: true });
      }
      // Refresh the in-memory rep shadow so the next booking SMS
      // uses the new URL immediately (no page reload needed).
      window._currentRep = Object.assign({}, window._currentRep || {}, {
        calcomUsername: calcomUsername || '',
        displayName: name
      });
      showToast('Settings saved!');
    } catch(e) { showToast('Save failed','error'); }
  };

  // V2 Estimate Engine settings — read from EstimateBuilderV2 settings store
  // and sync to/from localStorage + Firestore.
  function _v2ReadSettings() {
    const EB2 = window.EstimateBuilderV2;
    if (!EB2 || typeof EB2.loadSettings !== 'function') return null;
    return EB2.loadSettings();
  }

  function _v2WriteSettings(patch) {
    const EB2 = window.EstimateBuilderV2;
    if (!EB2 || typeof EB2.updateSettings !== 'function') return null;
    return EB2.updateSettings(patch);
  }

  // Populate the Estimates settings tab from current v2 engine settings
  window._loadEstimateDefaultsV2 = function() {
    const s = _v2ReadSettings();
    if (!s) return;
    const byId = (id) => document.getElementById(id);

    if (byId('v2rateGood'))   byId('v2rateGood').value   = s.tierRates?.good   ?? 545;
    if (byId('v2rateBetter')) byId('v2rateBetter').value = s.tierRates?.better ?? 595;
    if (byId('v2rateBest'))   byId('v2rateBest').value   = s.tierRates?.best   ?? 660;

    if (byId('v2costGood'))   byId('v2costGood').value   = s.costBasis?.good   ?? 340;
    if (byId('v2costBetter')) byId('v2costBetter').value = s.costBasis?.better ?? 385;
    if (byId('v2costBest'))   byId('v2costBest').value   = s.costBasis?.best   ?? 430;

    if (byId('v2minJob'))   byId('v2minJob').value   = s.minJobCharge ?? 2500;
    if (byId('v2roundTo'))  byId('v2roundTo').value  = s.roundTo ?? 25;

    if (byId('v2matMarkup')) byId('v2matMarkup').value = Math.round((s.materialMarkupPct ?? 0.25) * 100);
    if (byId('v2overhead'))  byId('v2overhead').value  = Math.round((s.overheadPct ?? 0.10) * 100);
    if (byId('v2profit'))    byId('v2profit').value    = Math.round((s.profitPct ?? 0.10) * 100);

    if (byId('defDumpFee'))    byId('defDumpFee').value    = s.dumpFee ?? 550;
    if (byId('defExtraLayer')) byId('defExtraLayer').value = s.tearOffExtraPerSq ?? 50;
    if (byId('defTaxRate'))    byId('defTaxRate').value    = ((s.fallbackTaxRate ?? 0.07) * 100).toFixed(2);

    // Permit costs
    const permits = s.permits || {};
    const permMap = {
      'permHamOh': 'hamilton-oh', 'permButOh': 'butler-oh',
      'permWarOh': 'warren-oh',   'permCleOh': 'clermont-oh',
      'permKenKy': 'kenton-ky',   'permBooKy': 'boone-ky',
      'permCamKy': 'campbell-ky'
    };
    Object.keys(permMap).forEach(id => {
      const el = byId(id);
      if (el && permits[permMap[id]]) el.value = permits[permMap[id]].cost;
    });

    // County tax
    const tax = s.countyTax || {};
    const taxMap = {
      'taxHamOh': 'hamilton-oh', 'taxButOh': 'butler-oh',
      'taxWarOh': 'warren-oh',   'taxCleOh': 'clermont-oh',
      'taxKenKy': 'kenton-ky',   'taxBooKy': 'boone-ky',
      'taxCamKy': 'campbell-ky'
    };
    Object.keys(taxMap).forEach(id => {
      const el = byId(id);
      if (el && tax[taxMap[id]] != null) el.value = (tax[taxMap[id]] * 100).toFixed(2);
    });

    // Catalog summary
    if (byId('v2matCount'))  byId('v2matCount').textContent  = (window.NBD_PRODUCTS || []).length;
    if (byId('v2labCount'))  byId('v2labCount').textContent  = (window.NBD_LABOR?.count) || 0;
    if (byId('v2xactCount')) byId('v2xactCount').textContent = (window.NBD_XACT_CATALOG?.count) || 0;
  };

  // Save every v2 engine setting from the Estimates tab form
  window._saveEstimateDefaultsV2 = async function() {
    const byId = (id) => document.getElementById(id);
    const num = (id, fallback) => {
      const v = parseFloat(byId(id)?.value);
      return isNaN(v) ? fallback : v;
    };

    const patch = {
      tierRates: {
        good:   num('v2rateGood', 545),
        better: num('v2rateBetter', 595),
        best:   num('v2rateBest', 660)
      },
      costBasis: {
        good:   num('v2costGood', 340),
        better: num('v2costBetter', 385),
        best:   num('v2costBest', 430)
      },
      minJobCharge: num('v2minJob', 2500),
      roundTo: num('v2roundTo', 25),
      materialMarkupPct: num('v2matMarkup', 25) / 100,
      overheadPct: num('v2overhead', 10) / 100,
      profitPct: num('v2profit', 10) / 100,
      dumpFee: num('defDumpFee', 550),
      tearOffExtraPerSq: num('defExtraLayer', 50),
      fallbackTaxRate: num('defTaxRate', 7) / 100
    };

    // Permit map
    const current = _v2ReadSettings() || {};
    patch.permits = Object.assign({}, current.permits);
    const permMap = {
      'permHamOh': { key: 'hamilton-oh', name: 'Hamilton County, OH' },
      'permButOh': { key: 'butler-oh',   name: 'Butler County, OH' },
      'permWarOh': { key: 'warren-oh',   name: 'Warren County, OH' },
      'permCleOh': { key: 'clermont-oh', name: 'Clermont County, OH' },
      'permKenKy': { key: 'kenton-ky',   name: 'Kenton County, KY' },
      'permBooKy': { key: 'boone-ky',    name: 'Boone County, KY' },
      'permCamKy': { key: 'campbell-ky', name: 'Campbell County, KY' }
    };
    Object.keys(permMap).forEach(id => {
      const v = num(id, null);
      if (v != null) patch.permits[permMap[id].key] = { name: permMap[id].name, cost: v };
    });

    // County tax
    patch.countyTax = Object.assign({}, current.countyTax);
    const taxMap = {
      'taxHamOh': 'hamilton-oh', 'taxButOh': 'butler-oh',
      'taxWarOh': 'warren-oh',   'taxCleOh': 'clermont-oh',
      'taxKenKy': 'kenton-ky',   'taxBooKy': 'boone-ky',
      'taxCamKy': 'campbell-ky'
    };
    Object.keys(taxMap).forEach(id => {
      const v = num(id, null);
      if (v != null) patch.countyTax[taxMap[id]] = v / 100;
    });

    // Apply locally (flows through EstimateBuilderV2.updateSettings → localStorage)
    _v2WriteSettings(patch);

    // Sync to Firestore for cross-device
    try {
      if (window._db && window._user) {
        const { setDoc, doc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
        await setDoc(
          doc(window._db, 'userSettings', window._user.uid),
          { estimateSettingsV2: patch, updatedAt: new Date().toISOString() },
          { merge: true }
        );
      }
    } catch (e) { console.warn('Firestore sync failed:', e); }

    const msg = document.getElementById('v2save-msg');
    if (msg) {
      msg.style.display = 'block';
      msg.textContent = '✓ Estimate settings saved. Every linked estimate will use these rates.';
      setTimeout(() => msg.style.display = 'none', 3500);
    }
    if (typeof showToast === 'function') showToast('✓ Estimate settings saved', 'success');
  };

  window._resetEstimateDefaultsV2 = function() {
    if (!confirm('Reset all estimate settings to factory defaults? This cannot be undone.')) return;
    const EB2 = window.EstimateBuilderV2;
    if (!EB2) return;
    const defaults = EB2.getDefaultSettings();
    EB2.saveSettings(defaults);
    window._loadEstimateDefaultsV2();
    if (typeof showToast === 'function') showToast('↺ Reset to factory defaults', 'success');
  };

  // Legacy stubs kept for backwards compat with any other caller
  window._saveEstimateDefaults = function() { return window._saveEstimateDefaultsV2(); };
  window._loadEstimateDefaults = function() { return window._loadEstimateDefaultsV2(); };

  // ═════════════════════════════════════════════════════════
  // COMPANY SETTINGS
  // ═════════════════════════════════════════════════════════
  const CO_FIELDS = [
    'coName','coDba','coEin','coState','coPhone','coEmail','coAddress','coCity',
    'coWebsite','coGbp','coLicOh','coLicKy','coGl','coWc','coGaf','coCerts',
    'coTerritory','coRadius'
  ];

  window._saveCompanySettings = async function() {
    const data = {};
    CO_FIELDS.forEach(f => {
      const el = document.getElementById(f);
      if (el) data[f] = el.value || '';
    });
    try { localStorage.setItem('nbd_company_settings', JSON.stringify(data)); } catch(e){}
    try {
      if (window._db && window._user) {
        const { setDoc, doc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
        await setDoc(
          doc(window._db, 'userSettings', window._user.uid),
          { company: data, updatedAt: new Date().toISOString() },
          { merge: true }
        );
      }
    } catch (e) { console.warn('Company settings Firestore sync failed:', e); }

    const msg = document.getElementById('co-save-msg');
    if (msg) {
      msg.style.display = 'block';
      msg.textContent = '✓ Company info saved';
      setTimeout(() => msg.style.display = 'none', 3000);
    }
    if (typeof showToast === 'function') showToast('✓ Company info saved', 'success');
  };

  window._loadCompanySettings = async function() {
    let data = {};
    try {
      const raw = localStorage.getItem('nbd_company_settings');
      if (raw) data = JSON.parse(raw);
    } catch(e){}

    // Firestore wins if present
    try {
      if (window._db && window._user) {
        const { getDoc, doc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
        const snap = await getDoc(doc(window._db, 'userSettings', window._user.uid));
        if (snap.exists() && snap.data().company) {
          data = Object.assign({}, data, snap.data().company);
        }
      }
    } catch (e) {}

    CO_FIELDS.forEach(f => {
      const el = document.getElementById(f);
      if (el && data[f] != null) el.value = data[f];
    });
  };

  // ═════════════════════════════════════════════════════════
  // COMPANY PROFILE — doc-constants editable from Settings UI
  // (legal text, financing tiers, marketing copy, code refs)
  // Backed by Firestore singleton `companyProfile/main` via
  // company-profile.js. _loadCompanyProfile() runs on boot, this
  // tab just populates form fields from window._companyProfile.
  // ═════════════════════════════════════════════════════════
  const _CP_LEGAL_FIELDS = [
    'cancellationWindowText','cancellationStatute',
    'cancellationContractClause','cancellationProposalShort',
    'changeOrderClause','changeOrderClauseShort',
    'disputeResolutionClause','insuranceAssignmentClause','entireAgreementClause',
    'paymentTermsContract','paymentTermsProposal','paymentMethodsNoCash',
    'materialsWarrantyDisclaimer','limitationOfLiability','latePaymentChargeText',
    'proposalValidityDays'
  ];
  const _CP_MARKETING_FIELDS = ['tagline','serviceArea','financePartner','codeCycle','codeJurisdiction'];
  const _CP_LETTERHEAD_FIELDS = ['businessName','businessPhone','businessEmail','businessWebsite','businessAddress','businessLicense'];

  function _cpReadFormToProfile() {
    const defaults = window.NBD_COMPANY_PROFILE_DEFAULTS || {};
    const out = {};
    _CP_LEGAL_FIELDS.concat(_CP_MARKETING_FIELDS).concat(_CP_LETTERHEAD_FIELDS).forEach(k => {
      const el = document.getElementById('cp_' + k);
      if (!el) return;
      const v = el.value;
      if (k === 'proposalValidityDays') {
        const n = parseInt(v, 10);
        out[k] = Number.isFinite(n) && n > 0 ? n : (defaults[k] || 30);
      } else {
        out[k] = v == null ? '' : String(v);
      }
    });
    // Financing tiers — 3 fixed slots.
    out.financingTiers = [0, 1, 2].map(i => {
      const apr = parseFloat(document.getElementById('cp_tier' + i + '_apr')?.value);
      const months = parseInt(document.getElementById('cp_tier' + i + '_months')?.value, 10);
      const label = document.getElementById('cp_tier' + i + '_label')?.value || '';
      const badge = document.getElementById('cp_tier' + i + '_badge')?.value || '';
      const def = (defaults.financingTiers || [])[i] || {};
      return {
        apr: Number.isFinite(apr) ? apr : (def.apr || 0),
        months: Number.isFinite(months) && months > 0 ? months : (def.months || 12),
        label: label || def.label || '',
        badge: badge || def.badge || '',
        color: def.color || '#0ea5e9'
      };
    });
    // Services — 6 fixed slots; skip rows where all three fields are blank.
    out.services = [];
    for (let i = 0; i < 6; i++) {
      const icon = document.getElementById('cp_svc' + i + '_icon')?.value || '';
      const name = document.getElementById('cp_svc' + i + '_name')?.value || '';
      const desc = document.getElementById('cp_svc' + i + '_desc')?.value || '';
      if (icon || name || desc) out.services.push({ icon, name, desc });
    }
    // Value props — 4 fixed slots; skip blanks.
    out.valueProps = [];
    for (let i = 0; i < 4; i++) {
      const icon = document.getElementById('cp_vp' + i + '_icon')?.value || '';
      const title = document.getElementById('cp_vp' + i + '_title')?.value || '';
      const desc = document.getElementById('cp_vp' + i + '_desc')?.value || '';
      if (icon || title || desc) out.valueProps.push({ icon, title, desc });
    }
    return out;
  }

  function _cpPopulateFormFromProfile(profile) {
    const defaults = window.NBD_COMPANY_PROFILE_DEFAULTS || {};
    const p = profile || defaults;
    _CP_LEGAL_FIELDS.concat(_CP_MARKETING_FIELDS).concat(_CP_LETTERHEAD_FIELDS).forEach(k => {
      const el = document.getElementById('cp_' + k);
      if (el) el.value = p[k] != null ? p[k] : (defaults[k] != null ? defaults[k] : '');
    });
    const tiers = (Array.isArray(p.financingTiers) && p.financingTiers.length === 3) ? p.financingTiers : (defaults.financingTiers || []);
    [0, 1, 2].forEach(i => {
      const t = tiers[i] || {};
      const apr = document.getElementById('cp_tier' + i + '_apr');     if (apr)    apr.value = t.apr != null ? t.apr : '';
      const months = document.getElementById('cp_tier' + i + '_months'); if (months) months.value = t.months != null ? t.months : '';
      const label = document.getElementById('cp_tier' + i + '_label');   if (label)  label.value = t.label || '';
      const badge = document.getElementById('cp_tier' + i + '_badge');   if (badge)  badge.value = t.badge || '';
    });
    const services = (Array.isArray(p.services) ? p.services : (defaults.services || []));
    for (let i = 0; i < 6; i++) {
      const s = services[i] || {};
      const iconEl = document.getElementById('cp_svc' + i + '_icon'); if (iconEl) iconEl.value = s.icon || '';
      const nameEl = document.getElementById('cp_svc' + i + '_name'); if (nameEl) nameEl.value = s.name || '';
      const descEl = document.getElementById('cp_svc' + i + '_desc'); if (descEl) descEl.value = s.desc || '';
    }
    const valueProps = (Array.isArray(p.valueProps) ? p.valueProps : (defaults.valueProps || []));
    for (let i = 0; i < 4; i++) {
      const v = valueProps[i] || {};
      const iconEl = document.getElementById('cp_vp' + i + '_icon');   if (iconEl)  iconEl.value = v.icon || '';
      const titleEl = document.getElementById('cp_vp' + i + '_title'); if (titleEl) titleEl.value = v.title || '';
      const descEl = document.getElementById('cp_vp' + i + '_desc');   if (descEl)  descEl.value = v.desc || '';
    }
  }

  window._loadCompanyProfileSettings = async function () {
    // Refresh from Firestore (sets window._companyProfile), then mirror
    // into the form. Falls back to whatever's already in memory if the
    // network call fails.
    try {
      if (typeof window._loadCompanyProfile === 'function') await window._loadCompanyProfile();
    } catch (_) {}
    _cpPopulateFormFromProfile(window._companyProfile);
  };

  window._saveCompanyProfileSettings = async function () {
    const overrides = _cpReadFormToProfile();
    try {
      if (typeof window._saveCompanyProfile !== 'function') {
        throw new Error('company-profile.js not loaded');
      }
      await window._saveCompanyProfile(overrides);
      const msg = document.getElementById('cp-save-msg');
      if (msg) {
        msg.style.display = 'block';
        setTimeout(() => msg.style.display = 'none', 3000);
      }
      if (typeof showToast === 'function') showToast('✓ Company profile saved — new docs will use these values', 'success');
    } catch (e) {
      console.warn('Company profile save failed:', e);
      if (typeof showToast === 'function') showToast('Save failed: ' + (e && e.message || 'unknown'), 'error');
    }
  };

  window._resetCompanyProfileSettings = function () {
    const defaults = window.NBD_COMPANY_PROFILE_DEFAULTS;
    if (!defaults) return;
    if (!confirm('Reset every Company Profile field to factory defaults? Unsaved edits will be lost. (You still need to click Save to persist.)')) return;
    _cpPopulateFormFromProfile(defaults);
    if (typeof showToast === 'function') showToast('↶ Fields reset to defaults — click Save to persist', 'info');
  };

  // ═════════════════════════════════════════════════════════
  // NOTIFICATION SETTINGS
  // ═════════════════════════════════════════════════════════
  // Trigger IDs match the checkbox element IDs in the Notifications
  // settings tab. notifNeedsField is new (added with the auto-needs-
  // field notifier) so the user can opt out of the "this lead is
  // missing required data" pings.
  const NOTIF_TRIGGERS = ['notifOverdue','notifHot','notifStorm','notifApproval','notifInbound','notifD2d','notifNeedsField'];
  const NOTIF_CHANNELS = ['chInApp','chPush','chEmail','chSms'];

  // Default state — used when no localStorage settings exist yet.
  // Matches the defaults baked into the settings UI HTML (notifOverdue
  // through notifApproval default on; notifD2d off; needs-field on).
  const _NOTIF_DEFAULTS = {
    mode: 'critical',
    triggers: {
      notifOverdue: true,  notifHot: true,    notifStorm: true,
      notifApproval: true, notifInbound: true, notifD2d: false,
      notifNeedsField: true
    },
    channels: { chInApp: true, chPush: false, chEmail: true, chSms: false }
  };

  // Map a notification's `type` field to the settings trigger that
  // gates it. Anything not in the map is treated as "no specific
  // trigger" and falls through to the mode check only.
  const _NOTIF_TYPE_TO_TRIGGER = {
    follow_up:    'notifOverdue',
    task_overdue: 'notifOverdue',
    needs_field:  'notifNeedsField',
    lead_review:  'notifApproval',
    estimate_approved: 'notifApproval',
    inbound_msg:  'notifInbound',
    storm_alert:  'notifStorm',
    hot_lead:     'notifHot',
    d2d_update:   'notifD2d'
  };

  function _readNotifSettings() {
    try {
      const raw = localStorage.getItem('nbd_notif_settings');
      if (!raw) return _NOTIF_DEFAULTS;
      const data = JSON.parse(raw) || {};
      // Merge against defaults so missing keys (e.g. brand-new
      // notifNeedsField on accounts that saved settings before it
      // existed) still get a sane value.
      return {
        mode: data.mode || _NOTIF_DEFAULTS.mode,
        triggers: Object.assign({}, _NOTIF_DEFAULTS.triggers, data.triggers || {}),
        channels: Object.assign({}, _NOTIF_DEFAULTS.channels, data.channels || {})
      };
    } catch (_) { return _NOTIF_DEFAULTS; }
  }

  // Public predicate: "should this notification fire?"
  //   notifType  — string from the canonical list (or any string;
  //                unknown types skip the trigger check).
  //   channel    — 'inApp' | 'push' | 'email' | 'sms' | 'firestore'
  //                ('firestore' = persisting into the notifications
  //                collection, the in-app bell dropdown source).
  //   priority   — 'high' | 'normal' | 'low'. Critical mode only
  //                fires 'high'. Digest mode suppresses 'normal'/'low'
  //                in real time (they accumulate for the digest).
  // Returns true if the firing code should proceed.
  window.shouldFireNotif = function (notifType, channel, priority) {
    const s = _readNotifSettings();

    // Mode check
    const pr = priority || 'normal';
    if (s.mode === 'critical' && pr !== 'high') return false;
    if (s.mode === 'digest' && pr !== 'high') {
      // Digest mode: only the digest scheduler should fire normal/low
      // priority items at 7am / 3pm. The digest scheduler passes a
      // 'digest' channel marker; everything else is suppressed.
      if (channel !== 'digest') return false;
    }
    // Firehose mode: every priority passes the mode check.

    // Trigger check — if the type maps to a known trigger and the user
    // turned that trigger off, suppress.
    const triggerId = _NOTIF_TYPE_TO_TRIGGER[notifType];
    if (triggerId && s.triggers[triggerId] === false) return false;

    // Channel check — translate channel name to its setting ID.
    if (channel) {
      const channelMap = {
        inApp:     'chInApp',
        push:      'chPush',
        email:     'chEmail',
        sms:       'chSms',
        // 'firestore' / 'digest' aren't user-gated channels (they're
        // internal persistence / scheduling, not delivery surfaces).
      };
      const channelId = channelMap[channel];
      if (channelId && s.channels[channelId] === false) return false;
    }

    return true;
  };

  // Convenience peek (mostly for tests/devtools).
  window._getNotifSettings = _readNotifSettings;

  window._saveNotifSettings = async function() {
    const modeEl = document.querySelector('input[name="notifMode"]:checked');
    const data = {
      mode: modeEl ? modeEl.value : 'critical',
      triggers: {},
      channels: {}
    };
    NOTIF_TRIGGERS.forEach(id => {
      const el = document.getElementById(id);
      if (el) data.triggers[id] = !!el.checked;
    });
    NOTIF_CHANNELS.forEach(id => {
      const el = document.getElementById(id);
      if (el) data.channels[id] = !!el.checked;
    });

    try { localStorage.setItem('nbd_notif_settings', JSON.stringify(data)); } catch(e){}
    try {
      if (window._db && window._user) {
        const { setDoc, doc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
        await setDoc(
          doc(window._db, 'userSettings', window._user.uid),
          { notifications: data, updatedAt: new Date().toISOString() },
          { merge: true }
        );
      }
    } catch (e) {}

    const msg = document.getElementById('notif-save-msg');
    if (msg) {
      msg.style.display = 'block';
      setTimeout(() => msg.style.display = 'none', 3000);
    }
    if (typeof showToast === 'function') showToast('✓ Notification preferences saved', 'success');
  };

  // Apply a settings object to the Notifications-tab form controls.
  // Tolerates partial objects (missing triggers / channels / mode are
  // skipped, not zeroed).
  function _applyNotifSettingsToUI(s) {
    if (!s) return;
    try {
      const mode = s.mode || 'critical';
      const modeId = 'notif' + mode.charAt(0).toUpperCase() + mode.slice(1);
      const modeEl = document.getElementById(modeId);
      if (modeEl) modeEl.checked = true;
      if (s.triggers) {
        NOTIF_TRIGGERS.forEach(id => {
          const el = document.getElementById(id);
          if (el && s.triggers[id] != null) el.checked = !!s.triggers[id];
        });
      }
      if (s.channels) {
        NOTIF_CHANNELS.forEach(id => {
          const el = document.getElementById(id);
          if (el && s.channels[id] != null) el.checked = !!s.channels[id];
        });
      }
    } catch (_) {}
  }

  // Cross-device sync flag — keeps the Firestore fetch single-flight
  // per page load. If the user switches to the Notifications tab a
  // second time we just re-read the (now-populated) localStorage cache.
  let _notifFirestoreSynced = false;

  // Pull saved settings from Firestore userSettings/{uid}, cache to
  // localStorage, and refresh the UI if the panel is open. Tolerates
  // missing doc / missing notifications subfield (returns silently).
  async function _syncNotifSettingsFromFirestore() {
    const _db = window._db || window.db;
    const uid = window._user && window._user.uid;
    if (!_db || !uid) return;
    try {
      const { getDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const snap = await getDoc(doc(_db, 'userSettings', uid));
      if (!snap.exists()) return;
      const data = snap.data();
      if (!data || !data.notifications) return;
      try { localStorage.setItem('nbd_notif_settings', JSON.stringify(data.notifications)); } catch (_) {}
      _applyNotifSettingsToUI(_readNotifSettings());
    } catch (e) {
      console.warn('Notif settings server sync failed:', e && e.message);
    }
  }

  window._loadNotifSettings = function() {
    // Fast path — always paint from the localStorage cache (instant, sync).
    _applyNotifSettingsToUI(_readNotifSettings());
    // Slow path — once per page load, pull the source of truth from
    // Firestore so a rep signing in on a new device gets their saved
    // preferences instead of seeing the on-disk defaults.
    if (!_notifFirestoreSynced && window._user && window._user.uid) {
      _notifFirestoreSynced = true;
      _syncNotifSettingsFromFirestore();
    }
  };

  window._testNotif = function() {
    if (typeof showToast === 'function') {
      showToast('🔔 Test notification — your alerts work!', 'success');
    } else {
      alert('🔔 Test notification — your alerts work!');
    }
  };

  // ── Data Retention exports ─────────────────────────
  // Three buttons in Settings → Access → Data Retention pointed at
  // these functions but nothing defined them — the short-circuit
  // `window._exportAllData && ...` just silently no-oped. Real
  // implementations below. For a full GDPR-compliant JSON dump use
  // window._gdprExport (Settings → Your Rights panel); these are
  // convenience CSVs for the common ops workflows.
  function _csvEscape(v) {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function _downloadCsv(rows, filename) {
    if (!rows || !rows.length) {
      if (typeof showToast === 'function') showToast('Nothing to export — the list is empty.', 'info');
      return;
    }
    const keys = Object.keys(rows[0]);
    const lines = [keys.join(',')].concat(
      rows.map(r => keys.map(k => _csvEscape(r[k])).join(','))
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 250);
    if (typeof showToast === 'function') showToast('✓ ' + filename + ' downloaded.', 'success');
  }

  window._exportAllData = function () {
    const leads = (window._leads || []).map(l => ({
      id:         l.id,
      firstName:  l.firstName || l.fname || '',
      lastName:   l.lastName  || l.lname || '',
      email:      l.email     || '',
      phone:      l.phone     || '',
      address:    l.address   || '',
      stage:      l.stage     || '',
      source:     l.source    || '',
      damageType: l.damageType || '',
      jobValue:   l.jobValue  || '',
      carrier:    l.carrier   || '',
      claimNumber: l.claimNumber || '',
      notes:      l.notes || '',
      createdAt:  l.createdAt?.toDate?.()?.toISOString() || '',
      updatedAt:  l.updatedAt?.toDate?.()?.toISOString() || ''
    }));
    _downloadCsv(leads, 'nbd-leads-' + new Date().toISOString().slice(0, 10) + '.csv');
  };

  window._exportEstimates = function () {
    const rows = (window._estimates || []).map(e => ({
      id:          e.id,
      address:     e.addr || e.address || '',
      tierName:    e.tierName || '',
      grandTotal:  e.grandTotal || e.total || '',
      builder:     e.builder || 'classic',
      signatureStatus: e.signatureStatus || 'none',
      signedAt:    e.signedAt?.toDate?.()?.toISOString() || '',
      leadId:      e.leadId || '',
      createdAt:   e.createdAt?.toDate?.()?.toISOString() || ''
    }));
    _downloadCsv(rows, 'nbd-estimates-' + new Date().toISOString().slice(0, 10) + '.csv');
  };

  // Photos ZIP — we don't bundle every photo blob client-side (too
  // much memory for a big account). Instead export a CSV manifest
  // with direct download links; reps can wget / curl the list.
  window._exportPhotos = async function () {
    try {
      const uid = window._user?.uid;
      if (!uid) { if (typeof showToast === 'function') showToast('Sign in first', 'error'); return; }
      const snap = await getDocs(query(collection(db, 'photos'), where('userId', '==', uid)));
      const rows = snap.docs.map(d => {
        const p = d.data();
        return {
          id:         d.id,
          leadId:     p.leadId || '',
          url:        p.url || '',
          thumbUrl:   p.thumbUrl || '',
          description: p.description || '',
          tags:       Array.isArray(p.tags) ? p.tags.join('|') : '',
          quality:    p.quality || '',
          fileSize:   p.fileSize || '',
          uploadedAt: p.uploadedAt?.toDate?.()?.toISOString() || (p.capturedAt ? new Date(p.capturedAt).toISOString() : '')
        };
      });
      _downloadCsv(rows, 'nbd-photos-manifest-' + new Date().toISOString().slice(0, 10) + '.csv');
    } catch (e) {
      console.error('export photos failed:', e);
      if (typeof showToast === 'function') showToast('Export failed: ' + e.message, 'error');
    }
  };

  // ═════════════════════════════════════════════════════════
  // ACCESS TAB — populate current session info
  // ═════════════════════════════════════════════════════════
  window._loadAccessInfo = function() {
    const byId = (id) => document.getElementById(id);
    if (byId('accSignedInAs') && window._user) {
      byId('accSignedInAs').textContent = window._user.displayName || window._user.email || 'Joe';
    }
    if (byId('accUserId') && window._user) {
      byId('accUserId').textContent = window._user.uid || '—';
    }
    if (byId('accLoginMethod') && window._user) {
      const method = window._user.providerData?.[0]?.providerId || 'email';
      byId('accLoginMethod').textContent = method === 'password' ? 'Email + Password' :
                                           method === 'google.com' ? 'Google OAuth' :
                                           'Access Code';
    }
    if (byId('accSessionStarted')) {
      const start = sessionStorage.getItem('nbd_session_start') || new Date().toISOString();
      if (!sessionStorage.getItem('nbd_session_start')) sessionStorage.setItem('nbd_session_start', start);
      byId('accSessionStarted').textContent = new Date(start).toLocaleString();
    }
  };

  // ═════════════════════════════════════════════════════════
  // BILLING TAB — populate Ask Joe AI usage stats
  // ═════════════════════════════════════════════════════════
  window._loadBillingInfo = function() {
    const byId = (id) => document.getElementById(id);
    try {
      const usageRaw = localStorage.getItem('nbd_ai_usage') || '{}';
      const usage = JSON.parse(usageRaw);
      const now = new Date();
      const monthKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
      const thisMonth = usage[monthKey] || { calls: 0, tokens: 0, cost: 0 };
      if (byId('aiUsageMonth'))  byId('aiUsageMonth').textContent  = thisMonth.calls || 0;
      if (byId('aiUsageTokens')) byId('aiUsageTokens').textContent = (thisMonth.tokens || 0).toLocaleString();
      if (byId('aiUsageCost'))   byId('aiUsageCost').textContent   = '$' + (thisMonth.cost || 0).toFixed(2);
    } catch (e) {
      if (byId('aiUsageMonth'))  byId('aiUsageMonth').textContent  = '0';
      if (byId('aiUsageTokens')) byId('aiUsageTokens').textContent = '0';
      if (byId('aiUsageCost'))   byId('aiUsageCost').textContent   = '$0.00';
    }
  };
