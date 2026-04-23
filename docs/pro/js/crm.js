// ============================================================
// NBD Pro — crm.js
// CRM: Lead modal, kanban render, card builder, kanban filter,
//      notifications, bulk operations, trash/restore, CSV export
// All functions use window globals (window._db, window._user, etc.)
// ============================================================

// ══════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════
function escHtml(s) { return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// Debounce helper — returns a wrapper that delays invocation by `ms`
let _debounceTimers = {};
function debounce(fn, ms, key){
  key = key || fn.name || 'default';
  return function(...args){
    clearTimeout(_debounceTimers[key]);
    _debounceTimers[key] = setTimeout(()=> fn.apply(this, args), ms);
  };
}

// ══════════════════════════════════════════════
// CRM
// ══════════════════════════════════════════════
// Firebase shim — aliases window globals for use in this file.
//
// LOAD-ORDER CONTRACT: crm.js MUST load after the Firebase ES-module
// script in the host page (dashboard.html / customer.html) populates
// window.db, window.collection, etc. If any of these are undefined at
// parse time the module locks them in as undefined forever and every
// Firestore call below silently no-ops. The assertion below fails loud
// at load time so misordered script tags show up in the console
// immediately instead of as invisible "nothing saved" bugs later.
const db = window.db;
const col = window.collection;
const _addDoc = window.addDoc;
const _updateDoc = window.updateDoc;
const _deleteDoc = window.deleteDoc;
const _doc = window.doc;
const _getDoc = window.getDoc;
const _getDocs = window.getDocs;
const _where = window.where;
const _orderBy = window.orderBy;
const _query = window.query;
const _serverTimestamp = window.serverTimestamp;
const _arrayUnion = window.arrayUnion;
(function _assertFirebaseLoaded() {
  const missing = [
    ['db', db], ['collection', col], ['addDoc', _addDoc], ['updateDoc', _updateDoc],
    ['deleteDoc', _deleteDoc], ['doc', _doc], ['getDoc', _getDoc], ['getDocs', _getDocs],
    ['where', _where], ['orderBy', _orderBy], ['query', _query],
    ['serverTimestamp', _serverTimestamp], ['arrayUnion', _arrayUnion]
  ].filter(([, v]) => !v).map(([n]) => n);
  if (missing.length) {
    console.error('[crm.js] Firebase not ready at parse time — missing: ' + missing.join(', ') +
                  '. Every Firestore call in this file will silently no-op. Check script order in the host page.');
  }
})();


function openLeadModal(){
  const modal = document.getElementById('leadModal');
  if (!modal) return; // standalone compat — modal not in DOM
  modal.classList.add('open');
  // Auto-infer jobType from current view: when user is on Cash view and clicks Add Lead,
  // default the new lead to jobType=cash (same for Insurance/Finance).
  const jtEl = document.getElementById('lJobType');
  const isEdit = !!(document.getElementById('lEditId')?.value);
  if (jtEl && !isEdit && !jtEl.value) {
    const view = window._currentViewKey || '';
    if (['insurance','cash','finance'].includes(view)) {
      jtEl.value = view;
    }
  }
  // Apply smart stage dropdown filter based on current jobType
  if (typeof window.filterStageDropdownByJobType === 'function') {
    window.filterStageDropdownByJobType(jtEl?.value || '');
  }
}
function closeLeadModal(){
  // Null-safe one-liner helpers — DOM elements may be absent in
  // standalone/compat mode or if the modal was removed from the view.
  const setVal = (id) => { const el = document.getElementById(id); if (el) el.value = ''; };
  const hide   = (id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };

  const modal = document.getElementById('leadModal');
  if (modal) modal.classList.remove('open');
  hide('mErr'); hide('mOk');

  ['lFname','lLname','lAddr','lPhone','lEmail','lNotes',
   'lJobValue','lFollowUp','lInsCarrier'].forEach(setVal);

  const editId = document.getElementById('lEditId'); if(editId) editId.value='';
  const title = document.getElementById('leadModalTitle'); if(title) title.textContent='Add Lead';
  const jt=document.getElementById('lJobType'); if(jt) jt.value='';
  // Clear insurance/finance/job fields
  ['lClaimNumber','lEstimateAmount','lDeductible','lScopeOfWork','lFinanceCompany','lLoanAmount','lPreQualLink','lScheduledDate','lCrew'].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; });
  ['lClaimFiledBy','lSupplementStatus','lLoanStatus'].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; });
  // Hide conditional field blocks
  ['insuranceFieldsBlock','financeFieldsBlock','jobFieldsBlock'].forEach(id=>{ const e=document.getElementById(id); if(e) e.style.display='none'; });
  window._modalIntel = null;
  const mir = document.getElementById('modalIntelResult');
  if(mir) { mir.classList.remove('visible'); mir.innerHTML=''; }
  const pib = document.getElementById('pullIntelBtn');
  if(pib) { pib.classList.remove('loading'); pib.innerHTML='<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><path d="M2 10l8-7 8 7"/><path d="M4 9v7a1 1 0 001 1h10a1 1 0 001-1V9"/></svg> Pull Property Intel'; }
}
// Null-guarded — if leadModal doesn't exist yet (deferred script
// running before DOM is fully painted in web app standalone mode),
// this would crash and kill ALL of crm.js including renderLeads().
const _leadModal = document.getElementById('leadModal');
if (_leadModal) _leadModal.addEventListener('click',e=>{if(e.target===document.getElementById('leadModal'))closeLeadModal();});
document.addEventListener('DOMContentLoaded',()=>{const tm=document.getElementById('taskModal');if(tm)tm.addEventListener('click',e=>{if(e.target===tm)closeTaskModal();});});

async function saveLead(){
  const mErr=document.getElementById('mErr'),mOk=document.getElementById('mOk');
  const saveBtn=document.querySelector('#leadModal .msave');
  // Lead modal may be absent in standalone/compat mode — bail cleanly.
  if(!mErr||!mOk||!saveBtn){console.warn('saveLead: lead modal not in DOM');return;}
  mErr.style.display='none';mOk.style.display='none';
  const fnameEl=document.getElementById('lFname');
  const addrEl =document.getElementById('lAddr');
  if(!fnameEl||!addrEl){mErr.textContent='Lead form missing — reload the page.';mErr.style.display='block';return;}
  const fname=fnameEl.value.trim();
  const addr=addrEl.value.trim();
  if(!fname||!addr){mErr.textContent='Name and address required.';mErr.style.display='block';return;}
  // Prevent double-submit
  if(saveBtn.disabled) return;
  saveBtn.disabled=true;
  const origText=saveBtn.textContent;
  saveBtn.textContent='Saving...';
  const intelData = window._modalIntel || {};
  // saveLead: proceed with save
  try {
    await window._saveLead({
      id: (document.getElementById('lEditId')?.value||undefined)||undefined,
      firstName: fname,
      lastName: document.getElementById('lLname').value.trim(),
      address: addr,
      phone: document.getElementById('lPhone').value.trim(),
      email: document.getElementById('lEmail').value.trim(),
      stage: document.getElementById('lStage').value,
      jobType: document.getElementById('lJobType')?.value || '',
      source: document.getElementById('lSource').value,
      damageType: document.getElementById('lDamageType')?.value||'',
      claimStatus: document.getElementById('lClaimStatus')?.value||'No Claim',
      jobValue: parseFloat(document.getElementById('lJobValue')?.value)||0,
      followUp: document.getElementById('lFollowUp')?.value||'',
      insCarrier: document.getElementById('lInsCarrier')?.value?.trim()||'',
      // Insurance fields
      claimNumber: document.getElementById('lClaimNumber')?.value?.trim()||'',
      claimFiledBy: document.getElementById('lClaimFiledBy')?.value||'',
      estimateAmount: parseFloat(document.getElementById('lEstimateAmount')?.value)||0,
      deductibleOrOwedByHO: parseFloat(document.getElementById('lDeductible')?.value)||0,
      supplementStatus: document.getElementById('lSupplementStatus')?.value||'',
      scopeOfWork: document.getElementById('lScopeOfWork')?.value?.trim()||'',
      // Finance fields
      financeCompany: document.getElementById('lFinanceCompany')?.value?.trim()||'',
      loanAmount: parseFloat(document.getElementById('lLoanAmount')?.value)||0,
      loanStatus: document.getElementById('lLoanStatus')?.value||'',
      preQualLink: document.getElementById('lPreQualLink')?.value?.trim()||'',
      // Job fields
      scheduledDate: document.getElementById('lScheduledDate')?.value||'',
      crew: document.getElementById('lCrew')?.value?.trim()||'',
      notes: document.getElementById('lNotes').value.trim(),
      yearBuilt:     intelData.yearBuilt   || null,
      marketValue:   intelData.marketValue || null,
      lastSaleDate:  intelData.lastSaleDate || null,
      lastSaleAmt:   intelData.lastSaleAmount || null,
      propertyType:  intelData.propertyType || null,
      parcelId:      intelData.parcelId || null,
      isLLC:         intelData.isLLC || false,
      homestead:     intelData.homestead || false,
      // D2D knock linkage (set by convertToLeadWithEdit flow)
      d2dKnockId:    window._pendingD2DConvertId || null
    });
    window._modalIntel = null;
    // If this save came from a D2D conversion (Edit First flow), mark the knock as converted
    if (window._pendingD2DConvertId) {
      try {
        if (window.updateDoc && window.doc && window._db) {
          await window.updateDoc(window.doc(window._db, 'knocks', window._pendingD2DConvertId), {
            convertedToLead: true,
            updatedAt: window.serverTimestamp()
          });
        }
        if (window.D2D?.renderD2D) window.D2D.renderD2D();
      } catch (d2dErr) { console.warn('Could not mark D2D knock as converted:', d2dErr); }
      window._pendingD2DConvertId = null;
    }
    mOk.textContent='Lead saved!';mOk.style.display='block';
    setTimeout(closeLeadModal,800);
  } catch(e) {
    console.error('saveLead error:', e);
    mErr.textContent='Save failed — check your connection and try again.';mErr.style.display='block';
  } finally {
    saveBtn.disabled=false;
    saveBtn.textContent=origText;
  }
}


// ══════════════════════════════════════════════
// KANBAN CRM — renderLeads / drag-drop / filter
// ══════════════════════════════════════════════

function renderLeads(leads, filtered){
  const all   = (leads  || window._leads || []);
  let list    = (filtered !== undefined && filtered !== null) ? filtered : all;
  window._filteredLeads = (filtered !== undefined && filtered !== null) ? filtered : null;

  // ─── Prospect segregation (April 2026) ─────────────────
  // Leads marked { isProspect: true } represent knocks that
  // auto-created a lead record but haven't been qualified yet
  // (i.e. not-home, interested, storm-damage, etc. dispositions).
  // By default the kanban HIDES prospects so they don't crowd real
  // customer data. A toggle in the CRM header lets the user flip
  // 'Show prospects' on when they want to triage.
  //
  // Appointments are the exception — they skip the Prospect stage
  // entirely because a set meeting is already a qualified customer.
  // See convertToLead() in d2d-tracker.js for the routing logic.
  const _showProspects = (localStorage.getItem('nbd_crm_show_prospects') === '1');
  if (!_showProspects) {
    list = list.filter(l => !l.isProspect);
  }

  // ─── Rep scoping (Enterprise) ─────────────────
  // When a user has a 'role' custom claim that is NOT 'admin' or
  // 'owner', they only see their own leads. Managers see all leads
  // in their company. Owners/admins see everything (no filter).
  // The claims are set by the onRepSignup blocking auth trigger
  // and are available on window._userClaims after login.
  const _userRole = (window._userClaims && window._userClaims.role) || null;
  if (_userRole === 'sales_rep') {
    // Sales reps see only their own leads
    list = list.filter(l => l.userId === window._user?.uid);
  } else if (_userRole === 'viewer') {
    // Viewers see all leads but read-only (handled in UI, not here)
  }
  // Owners, admins, managers see all leads (no filter)

  // ── Per-pipeline filter: only show leads that belong to the active track ──
  // Simple view: show all leads (no filter)
  // Insurance view: show insurance + unset jobType leads (NBD defaults to insurance)
  // Cash view: show only cash leads
  // Finance view: show only finance leads
  // Jobs view: show only leads in post-contract (job) stages
  const _view = window._currentViewKey || 'simple';
  const _norm = window.normalizeStage;
  const _jobStageSet = new Set([
    'job_created','permit_pulled','materials_ordered','materials_delivered',
    'crew_scheduled','install_in_progress','install_complete','final_photos',
    'deductible_collected','final_payment','closed'
  ]);
  if (_view === 'insurance') {
    list = list.filter(l => !l.jobType || l.jobType === 'insurance');
  } else if (_view === 'cash') {
    list = list.filter(l => l.jobType === 'cash');
  } else if (_view === 'finance') {
    list = list.filter(l => l.jobType === 'finance');
  } else if (_view === 'jobs') {
    list = list.filter(l => {
      const sk = l._stageKey || (_norm ? _norm(l.stage) : l.stage || 'new');
      return _jobStageSet.has(sk);
    });
  }
  // simple view: no filter (list stays as-is)

  // ── stat helpers ──
  const setEl = (id,v)=>{ const e=document.getElementById(id); if(e) e.textContent=v; };

  // Revenue calcs — use stage keys when available
  let pipeVal=0, closedRev=0, approvedCount=0;
  const _lostKeys = ['lost', 'Lost'];
  const _closedKeys = ['contract_signed','job_created','permit_pulled','materials_ordered','materials_delivered','crew_scheduled','install_in_progress','install_complete','final_photos','deductible_collected','final_payment','closed','Approved','In Progress','Complete'];
  const _approvedKeys = ['contract_signed','Approved'];
  all.forEach(l=>{
    const v=parseFloat(l.jobValue||0);
    const sk = l._stageKey || l.stage || 'new';
    if(!_lostKeys.includes(sk)) pipeVal+=v;
    if(_closedKeys.includes(sk)) closedRev+=v;
    if(_approvedKeys.includes(sk)) approvedCount++;
  });
  // Count prospects (hidden from kanban when toggle is off)
  const _prospectCount = all.filter(l => l.isProspect).length;
  const _realCount = all.length - _prospectCount;
  // Update the Prospects toggle button label + badge so user
  // knows how many are hiding.
  const _prospectBadge = document.getElementById('prospectsCountBadge');
  const _prospectLabel = document.getElementById('prospectsBtnLabel');
  const _prospectBtn = document.getElementById('prospectsToggleBtn');
  if (_prospectBadge) {
    _prospectBadge.textContent = _prospectCount;
    _prospectBadge.style.display = _prospectCount > 0 ? 'inline-block' : 'none';
  }
  if (_prospectLabel) {
    _prospectLabel.textContent = _showProspects ? 'Hide Prospects' : 'Show Prospects';
  }
  if (_prospectBtn) {
    if (_showProspects) {
      _prospectBtn.style.background = 'rgba(232,114,12,.1)';
      _prospectBtn.style.borderColor = 'var(--orange)';
      _prospectBtn.style.color = 'var(--orange)';
    } else {
      _prospectBtn.style.background = '';
      _prospectBtn.style.borderColor = '';
      _prospectBtn.style.color = '';
    }
  }

  setEl('crmTotalLeads', _realCount);
  setEl('crmPipeVal',    '$'+pipeVal.toLocaleString());
  setEl('crmApproved',  approvedCount);
  setEl('crmClosedRev', '$'+closedRev.toLocaleString());
  setEl('crmSubLine',   _realCount + ' customers · $' + pipeVal.toLocaleString() + ' pipeline' + (_prospectCount > 0 ? ' · ' + _prospectCount + ' prospects' : ''));
  // dashboard cards
  setEl('statLeads', all.length);
  setEl('statVal',   '$'+pipeVal.toLocaleString());
  setEl('statClosed','$'+closedRev.toLocaleString());
  const lb=document.getElementById('leadBadge'); if(lb) lb.textContent=all.length;

  // Dashboard pipeline stage counts
  const _normalize = window.normalizeStage || (s => s);
  const _stageCounts = { new:0, contacted:0, estimate_sent:0, negotiating:0, closed:0, lost:0 };
  const _stageMap = {
    'new':['new','New','New Lead'],
    'contacted':['contacted','Contacted','contact_made','inspection_scheduled','inspection_completed'],
    'estimate_sent':['estimate_sent','estimate_created','Estimate Sent','Estimate Created','estimate_approved','contract_signed'],
    'negotiating':['negotiating','Negotiating','job_created','permit_pulled','materials_ordered','materials_delivered','crew_scheduled','install_in_progress'],
    'closed':['closed','install_complete','final_photos','deductible_collected','final_payment','Approved','In Progress','Complete'],
    'lost':['lost','Lost','Closed Lost']
  };
  all.forEach(l => {
    const sk = l._stageKey || _normalize(l.stage || 'new');
    for (const [bucket, keys] of Object.entries(_stageMap)) {
      if (keys.includes(sk) || keys.includes(l.stage || '')) { _stageCounts[bucket]++; break; }
    }
  });
  setEl('dp-new', _stageCounts.new);
  setEl('dp-ct', _stageCounts.contacted);
  setEl('dp-es', _stageCounts.estimate_sent);
  setEl('dp-ng', _stageCounts.negotiating);
  setEl('dp-won', _stageCounts.closed);
  setEl('dp-lost', _stageCounts.lost);

  // Show/hide Load Sample Data button (only when zero leads)
  const sampleBtn = document.getElementById('loadSampleDataBtn');
  if (sampleBtn) {
    sampleBtn.style.display = (all.length === 0) ? 'inline-block' : 'none';
  }

  // Show diagnostic panel if zero leads and user is authenticated
  const diagnostic = document.getElementById('crmDiagnostic');
  const diagnosticDetails = document.getElementById('crmDiagnosticDetails');
  if (all.length === 0 && window._user?.uid && diagnostic && diagnosticDetails) {
    const details = [
      `✓ User authenticated: ${window._user.email}`,
      `✓ User ID: ${window._user.uid}`,
      `✓ Database connected: ${window.db ? 'Yes' : 'No'}`,
      `✓ Leads in memory: ${all.length}`,
      ``,
      `Possible causes:`,
      `1. No leads created yet for this account`,
      `2. Firestore rules blocking reads (check Firebase Console)`,
      `3. Network connectivity issue`,
      ``,
      `Click Load Sample Data to add 5 test leads`
    ];
    diagnosticDetails.textContent = details.join('\n');
    diagnostic.style.display = 'block';
  } else if (diagnostic) {
    diagnostic.style.display = 'none';
  }

  // Follow-up overdue
  const today=new Date(); today.setHours(0,0,0,0);
  const _terminalStages = ['closed','lost','Complete','Lost'];
  const overdue = all.filter(l=>{
    const sk = l._stageKey || l.stage || '';
    if(!l.followUp||_terminalStages.includes(sk)||_terminalStages.includes(l.stage||'')) return false;
    const d=new Date(l.followUp); d.setHours(0,0,0,0); return d<=today;
  });
  setEl('crmFollowUps', overdue.length);
  const fp=document.getElementById('followUpPill');
  if(fp) fp.style.display = overdue.length ? 'flex':'none';
  // Follow-up alerts — render into the inner div, show/hide the wrapper.
  // Respect the dismiss flag so the user can hide them for the session.
  const alertWrap=document.getElementById('followUpAlertsWrap');
  const alertBox=document.getElementById('followUpAlerts');
  const dismissed = localStorage.getItem('nbd_crm_followup_hidden') === '1';
  if(alertWrap && alertBox){
    if(overdue.length && !dismissed){
      alertWrap.style.display='block';
      const label = document.getElementById('followUpAlertsLabel');
      if (label) label.textContent = overdue.length + ' Follow-up' + (overdue.length === 1 ? '' : 's') + ' Due';
      alertBox.innerHTML=overdue.slice(0,5).map(l=>`
        <div class="follow-up-alert">
          <span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;vertical-align:middle;"><rect x="3" y="4" width="14" height="13" rx="1.5"/><path d="M3 8h14"/><path d="M7 2v4M13 2v4"/></svg></span>
          <span class="fa-name">${escHtml(l.firstName||'')} ${escHtml(l.lastName||'')}</span>
          <span style="color:var(--m);font-size:11px;">${escHtml((l.address||'').split(',')[0])}</span>
          <span class="fa-date">Due: ${escHtml(l.followUp)}</span>
          <button class="fa-btn nbd-fa-edit" data-lead-id="${escHtml(l.id)}">View →</button>
        </div>`).join('')
        + (overdue.length > 5 ? `<div style="font-size:11px;color:var(--m);padding:6px 0;">+ ${overdue.length - 5} more</div>` : '');
      alertBox.querySelectorAll('.nbd-fa-edit').forEach(btn => {
        btn.addEventListener('click', () => editLead(btn.dataset.leadId));
      });
    } else { alertWrap.style.display='none'; }
  }

  // ── Build kanban columns ──
  // Use stage keys if available (new system), fall back to legacy display names
  const stageKeys = window._stageKeys || null;
  const byStage = {};

  if (stageKeys) {
    // NEW SYSTEM: Use internal stage keys + resolveColumn for mapping
    stageKeys.forEach(k => byStage[k] = []);
    const _resolve = window.resolveColumn;
    const _normalize = window.normalizeStage;
    list.forEach(l => {
      const sk = l._stageKey || (_normalize ? _normalize(l.stage) : (l.stage || 'new'));
      const col = _resolve ? _resolve(sk, stageKeys) : sk;
      if (byStage[col]) byStage[col].push(l);
      else if (byStage[stageKeys[0]]) byStage[stageKeys[0]].push(l);
    });

    stageKeys.forEach(stageKey => {
      const body  = document.getElementById('kbody-'+stageKey);
      const count = document.getElementById('kcount-'+stageKey);
      if(!body) return;
      const cards = byStage[stageKey]||[];
      if(count) count.textContent = cards.length;
      if(!cards.length){ body.innerHTML='<div class="k-empty"><div class="empty-icon"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><rect x="4" y="3" width="12" height="14" rx="1.5"/><path d="M7 3V1.5h6V3"/><path d="M7 8h6M7 11h4"/></svg></div><div style="font-size:11px;opacity:.7;">Drop leads here</div></div>'; return; }
      body.innerHTML = cards.map(l=>buildCard(l)).join('');
      wireKanbanCardListeners(body);
      // attach drag events to cards
      body.querySelectorAll('.k-card').forEach(card=>{
        card.addEventListener('dragstart', e=>{ _dragId=card.dataset.id; card.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', card.dataset.id); });
        card.addEventListener('dragend',   e=>{ card.classList.remove('dragging'); });
      });
      // Clean up previous drag listeners before adding new ones (prevents memory leak)
      if (body._dragHandlers) {
        body.removeEventListener('dragover', body._dragHandlers.over);
        body.removeEventListener('dragleave', body._dragHandlers.leave);
        body.removeEventListener('drop', body._dragHandlers.drop);
      }
      const overHandler = e=>{ e.preventDefault(); e.dataTransfer.dropEffect='move'; body.classList.add('drag-over'); };
      const leaveHandler = e=>{ if(e.target===body) body.classList.remove('drag-over'); };
      const dropHandler = e=>{ e.preventDefault(); body.classList.remove('drag-over'); if(!_dragId) return; moveCard(_dragId, stageKey); _dragId=null; };
      body.addEventListener('dragover', overHandler);
      body.addEventListener('dragleave', leaveHandler);
      body.addEventListener('drop', dropHandler);
      body._dragHandlers = { over: overHandler, leave: leaveHandler, drop: dropHandler };
    });
  } else {
    // LEGACY FALLBACK: Use display name stages
    const STAGES = window.STAGES || ['New','Inspected','Estimate Sent','Approved','In Progress','Complete','Lost'];
    STAGES.forEach(s=>byStage[s]=[]);
    list.forEach(l=>{ const s=l.stage||'New'; if(byStage[s]) byStage[s].push(l); else byStage['New'].push(l); });

    STAGES.forEach(stage=>{
      const body  = document.getElementById('kbody-'+stage);
      const count = document.getElementById('kcount-'+stage);
      if(!body) return;
      const cards = byStage[stage]||[];
      if(count) count.textContent = cards.length;
      if(!cards.length){ body.innerHTML='<div class="k-empty"><div class="empty-icon"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><rect x="4" y="3" width="12" height="14" rx="1.5"/><path d="M7 3V1.5h6V3"/><path d="M7 8h6M7 11h4"/></svg></div><div style="font-size:11px;opacity:.7;">Drop leads here</div></div>'; return; }
      body.innerHTML = cards.map(l=>buildCard(l)).join('');
      body.querySelectorAll('.k-card').forEach(card=>{
        card.addEventListener('dragstart', e=>{ _dragId=card.dataset.id; card.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', card.dataset.id); });
        card.addEventListener('dragend',   e=>{ card.classList.remove('dragging'); });
      });
      // Clean up previous drag listeners (prevents memory leak on re-render)
      if (body._dragHandlers) {
        body.removeEventListener('dragover', body._dragHandlers.over);
        body.removeEventListener('dragleave', body._dragHandlers.leave);
        body.removeEventListener('drop', body._dragHandlers.drop);
      }
      const overH = e=>{ e.preventDefault(); e.dataTransfer.dropEffect='move'; body.classList.add('drag-over'); };
      const leaveH = e=>{ if(e.target===body) body.classList.remove('drag-over'); };
      const dropH = e=>{ e.preventDefault(); body.classList.remove('drag-over'); if(!_dragId) return; moveCard(_dragId, stage); _dragId=null; };
      body.addEventListener('dragover', overH);
      body.addEventListener('dragleave', leaveH);
      body.addEventListener('drop', dropH);
      body._dragHandlers = { over: overH, leave: leaveH, drop: dropH };
    });
  }
}

function buildCard(l){
  const nameRaw = ((l.firstName||l.fname||'')+'  '+(l.lastName||l.lname||'')).trim() || l.name||'Unknown';
  const name  = escHtml(nameRaw);
  const addr  = escHtml((l.address||'').split(',').slice(0,2).join(','));
  const val   = l.jobValue ? '$'+parseFloat(l.jobValue).toLocaleString() : '';
  const today = new Date(); today.setHours(0,0,0,0);
  const _sk = l._stageKey || (window.normalizeStage ? window.normalizeStage(l.stage) : l.stage || 'new');
  const isTerminal = ['closed','lost','Complete','Lost'].includes(_sk) || ['closed','lost','Complete','Lost'].includes(l.stage||'');
  const overdue = l.followUp && new Date(l.followUp)<=today && !isTerminal;
  // Prev/next arrows use stage keys
  const _keys = window._stageKeys || [];
  const stageIdx = _keys.indexOf(_sk);
  const prevS = stageIdx>0 ? _keys[stageIdx-1] : null;
  const nextS = stageIdx>=0 && stageIdx<_keys.length-1 ? _keys[stageIdx+1] : null;
  const prevLabel = prevS && window.STAGE_META?.[prevS]?.label || prevS || '';
  const nextLabel = nextS && window.STAGE_META?.[nextS]?.label || nextS || '';

  // Task badge
  const tasks = window._taskCache?.[l.id] || [];
  const totalT = tasks.length;
  const doneT  = tasks.filter(t=>t.done).length;
  
  // Task completion rate
  let completionRate = 0;
  if(totalT > 0) {
    completionRate = Math.round((doneT / totalT) * 100);
  }
  const overdueT = tasks.filter(t=>!t.done && t.dueDate && new Date(t.dueDate+'T23:59:59') < new Date()).length;
  let taskBadgeClass = 'kc-task-badge';
  let taskBadgeLabel = totalT ? `☑ ${doneT}/${totalT}` : '+ Tasks';
  if(totalT && overdueT){ taskBadgeClass += ' has-overdue'; taskBadgeLabel = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><path d="M10 3L2 17h16L10 3z"/><path d="M10 8v4M10 14.5v.5"/></svg> ${overdueT} overdue`; }
  else if(totalT && doneT===totalT) { 
    taskBadgeClass += ' all-done'; 
    taskBadgeLabel = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><circle cx="10" cy="10" r="7"/><path d="M7 10l2 2 4-5"/></svg> 100%`;
  }
  else if(totalT && completionRate >= 50) {
    taskBadgeClass += ' has-tasks';
    taskBadgeLabel = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><path d="M4 10.5l4 4 8-9"/></svg> ${doneT}/${totalT} (${completionRate}%)`;
  }
  else if(totalT) taskBadgeClass += ' has-tasks';

  // Days since last contact / created
  let daysLabel = '', daysClass = 'kc-days-fresh';
  if(!['Complete','Lost'].includes(l.stage||'')) {
    let ref = null;
    if(l.updatedAt?.toDate) ref = l.updatedAt.toDate();
    else if(l.createdAt?.toDate) ref = l.createdAt.toDate();
    else if(l.createdAt instanceof Date) ref = l.createdAt;
    else if(l.createdAt) ref = new Date(l.createdAt);
    
    if(ref && ref instanceof Date && !isNaN(ref)) {
      // Normalize ref to midnight for accurate day comparison
      const refNorm = new Date(ref);
      refNorm.setHours(0,0,0,0);
      const days = Math.floor((today - refNorm) / 86400000);
      
      if(days < 0)        { daysLabel = 'Today';        daysClass = 'kc-days-fresh'; } // Future date edge case
      else if(days === 0) { daysLabel = 'Today';        daysClass = 'kc-days-fresh'; }
      else if(days === 1) { daysLabel = '1d ago';       daysClass = 'kc-days-fresh'; }
      else if(days <= 5)  { daysLabel = `${days}d ago`; daysClass = 'kc-days-warm'; }
      else                { daysLabel = `${days}d ago`; daysClass = 'kc-days-cold'; }
    }
  }

  // Photo thumbnails (from cache). Click behavior is wired via data-* +
  // delegated event listener in wireKanbanCardListeners(), so attacker-
  // controlled fields like `l.address` can never break out of an onclick
  // attribute. Only http(s) photo URLs are rendered.
  const photos = window._photoCache?.[l.id] || [];
  const safePhotos = photos.filter(p => /^https?:/i.test(String(p.url || '')));
  const photoHTML = safePhotos.length ? `<div class="kc-photos">
    ${safePhotos.slice(0,3).map(p=>`<img class="kc-photo-thumb nbd-kc-photo" data-lead-id="${escHtml(l.id)}" src="${escHtml(p.url)}" loading="lazy">`).join('')}
    ${safePhotos.length > 3 ? `<div class="kc-photo-more nbd-kc-photo" data-lead-id="${escHtml(l.id)}">+${safePhotos.length-3}</div>` : ''}
  </div>` : '';

  // Roof age
  const roofBadge = (()=>{
    if(!l.yearBuilt) return '';
    const age = new Date().getFullYear() - parseInt(l.yearBuilt);
    const cls = age<10?'kct-roof-new':age<20?'kct-roof-mid':age<30?'kct-roof-old':'kct-roof-ancient';
    return `<span class="kc-tag kct-roof ${cls}"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><path d="M2 10l8-7 8 7"/><path d="M4 9v7a1 1 0 001 1h10a1 1 0 001-1V9"/></svg> ${age}yr</span>`;
  })();

  const phone = escHtml(l.phone||'');
  const email = escHtml(l.email||'');
  const carrier = escHtml(l.insCarrier||l.insuranceCarrier||'');
  const claimNum = escHtml(l.claimNumber||l.claimNum||'');
  const claimStatus = escHtml(l.claimStatus||'');
  
  // Count badges for estimates and photos
  const estimates = (window._estimates || []).filter(e => e.leadId === l.id);
  const estCount = estimates.length;
  const photoCount = photos.length;

  // Sync status indicators
  const syncClass = l._syncing ? 'k-card-syncing' : (l._syncSuccess ? 'k-card-sync-success' : (l._syncError ? 'k-card-sync-error' : ''));
  const syncIndicator = l._syncing ? '<div class="k-card-sync-icon"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><path d="M5 2h10v4l-3 3 3 3v4H5v-4l3-3-3-3V2z"/></svg></div>' : 
                        l._syncSuccess ? '<div class="k-card-sync-icon"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><path d="M4 10.5l4 4 8-9"/></svg></div>' : 
                        l._syncError ? '<div class="k-card-sync-icon"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><path d="M10 3L2 17h16L10 3z"/><path d="M10 8v4M10 14.5v.5"/></svg></div>' : '';

  // All click behavior is wired by wireKanbanCardListeners() via delegation
  // off the kanban body. Each action is encoded as a data-action attribute
  // and every user-controlled value (id, phone, nameRaw) is escaped via
  // escHtml before interpolation. An attacker-controlled lead field can
  // therefore never break out of an attribute or inject a handler.
  const safeId = escHtml(l.id);
  const firstName = escHtml(nameRaw.split(' ')[0] || '');
  const showSmsBtn = ['new','contacted','inspected'].includes(_sk) && phone;
  let html = `<div class="k-card nbd-kc-main" draggable="true" data-id="${safeId}" data-action="card-click">
    <div class="k-card-checkbox nbd-kc-stop" data-action="toggle-select" data-id="${safeId}">
      <span class="k-card-checkbox-icon"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><path d="M4 10.5l4 4 8-9"/></svg></span>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <div style="display:flex;align-items:center;gap:4px;">${val ? `<div class="kc-val-badge">${val}</div>` : ''}${window.LeadScoring?.badge ? window.LeadScoring.badge(l) : ''}</div>
      <div style="display:flex;gap:4px;">
        ${estCount > 0 ? `<span style="font-size:10px;background:var(--s3);border:1px solid var(--br);border-radius:10px;padding:2px 6px;color:var(--gold);"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><rect x="4" y="3" width="12" height="14" rx="1.5"/><path d="M7 3V1.5h6V3"/><path d="M7 8h6M7 11h4"/></svg> ${estCount}</span>` : ''}
        ${photoCount > 0 ? `<span style="font-size:10px;background:var(--s3);border:1px solid var(--br);border-radius:10px;padding:2px 6px;color:var(--blue);"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><rect x="2" y="6" width="16" height="11" rx="1.5"/><circle cx="10" cy="11" r="3"/><path d="M7 6l1-3h4l1 3"/></svg> ${photoCount}</span>` : ''}
      </div>
    </div>
    <div class="kc-name">${name}${l.customerId ? ` <span style="font-family:monospace;font-size:10px;font-weight:600;color:var(--orange,var(--orange));opacity:.8;margin-left:4px;">${escHtml(l.customerId)}</span>` : ''}</div>
    ${addr ? `<div class="kc-addr" title="${escHtml(l.address||'')}">${addr}</div>` : ''}
    ${phone ? `<div class="kc-phone-row">
      <a class="kc-phone-link nbd-kc-stop" href="tel:${phone.replace(/\D/g,'')}"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><path d="M4 3h3l2 4-2.5 1.5A9 9 0 0011.5 13.5L13 11l4 2v3a1 1 0 01-1 1C8.4 17 3 11.6 3 4a1 1 0 011-1z"/></svg> ${phone}</a>
      ${daysLabel ? `<span class="kc-days ${daysClass}" style="margin-left:auto;">${daysLabel}</span>` : ''}
    </div>` : (daysLabel ? `<div style="text-align:right;margin-bottom:4px;"><span class="kc-days ${daysClass}">${daysLabel}</span></div>` : '')}
    ${email ? `<div class="kc-email-line" title="${email}"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><rect x="2" y="4" width="16" height="12" rx="1.5"/><path d="M2 6l8 5 8-5"/></svg> ${email}</div>` : ''}
    ${carrier || claimStatus !== 'No Claim' ? `<div class="kc-ins-row">
      ${carrier ? `<span class="kc-carrier">${carrier}</span>` : ''}
      ${claimStatus && claimStatus!=='No Claim' ? `<span class="kc-tag kct-claim">${claimStatus}</span>` : ''}
      ${claimNum ? `<span class="kc-claim-num">#${claimNum}</span>` : ''}
    </div>` : ''}
    ${photoHTML}
    <div class="kc-tags">
      ${l.damageType ? `<span class="kc-tag kct-dmg">${escHtml(l.damageType)}</span>` : ''}
      ${overdue      ? `<span class="kc-tag kct-due"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><path d="M10 3L2 17h16L10 3z"/><path d="M10 8v4M10 14.5v.5"/></svg> Due</span>` : ''}
      ${roofBadge}
      ${l.hailHit && l.hailHit.sizeInches ? `<span class="kc-tag kct-dmg" style="background:rgba(255,59,59,.18);color:#ff6b6b;border-color:#ff6b6b;" title="Recent hail near this property">⛈ ${Number(l.hailHit.sizeInches).toFixed(1)}&quot; hail</span>` : ''}
      ${l.measurementReady ? `<span class="kc-tag" style="background:rgba(46,204,138,.14);color:var(--green,#2ecc8a);border-color:var(--green,#2ecc8a);" title="Aerial measurement report is ready">📐 Measurement</span>` : ''}
    </div>
    <div class="kc-footer">
      <button type="button" class="${taskBadgeClass}" data-action="open-tasks" data-id="${safeId}">${taskBadgeLabel}</button>
      <div class="kc-actions">
        <div class="kc-move">
          ${prevS ? `<button type="button" class="kc-arrow nbd-kc-stop" title="← ${escHtml(prevLabel)}" data-action="move-card" data-id="${safeId}" data-target-stage="${escHtml(prevS)}">◀</button>` : '<span style="width:18px;"></span>'}
          ${nextS ? `<button type="button" class="kc-arrow nbd-kc-stop" title="→ ${escHtml(nextLabel)}" data-action="move-card" data-id="${safeId}" data-target-stage="${escHtml(nextS)}">▶</button>` : '<span style="width:18px;"></span>'}
        </div>
        ${showSmsBtn ? `<button type="button" class="kc-btn nbd-kc-stop" title="Send booking link via SMS" data-action="booking-sms" data-id="${safeId}" data-phone="${phone}" data-first-name="${firstName}"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;"><rect x="3" y="4" width="14" height="13" rx="1.5"/><path d="M3 8h14"/><path d="M7 2v4M13 2v4"/></svg></button>` : ''}
        ${email ? `<button type="button" class="kc-btn nbd-kc-stop" title="Email" data-action="email-lead" data-id="${safeId}"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;"><rect x="2" y="4" width="16" height="12" rx="1.5"/><path d="M2 6l8 5 8-5"/></svg></button>` : ''}
        <button type="button" class="kc-btn edit nbd-kc-stop" data-action="edit-lead" data-id="${safeId}"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;"><path d="M12.5 3.5l4 4L7 17H3v-4l9.5-9.5z"/></svg></button>
        <button type="button" class="kc-btn del nbd-kc-stop" data-action="delete-lead" data-id="${safeId}"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;"><path d="M5 5h10l-1 12H6L5 5z"/><path d="M3 5h14"/><path d="M8 5V3h4v2"/></svg></button>
      </div>
    </div>
  </div>`;

  // Apply search highlighting to the card HTML.
  // SECURITY: running a naive regex.replace across already-rendered HTML can
  // corrupt tags/attributes (e.g. searching for `class` or `"` matches inside
  // `class="kc-card"` and injects <mark> into the opening tag). Refuse any
  // query containing characters that appear in HTML structure so the regex
  // can only hit user-visible text. This is a self-XSS guard; real fix is
  // text-node based highlighting — tracked separately.
  if(window._searchQuery && window._searchQuery.length >= 2){
    const sq = window._searchQuery;
    if(/[<>"'&=\/]/.test(sq)) return html;
    const escaped = sq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp('(' + escaped + ')', 'gi');
    return html.replace(regex, '<mark style="background:var(--orange);color:#000;padding:0 2px;border-radius:2px;font-weight:600;">$1</mark>');
  }
  return html;
}

function handleCardClick(id, event) {
  // If clicking a button/link inside card, don't open modal
  if(event.target.closest('button,a')) return;
  // Open card detail modal (snapshot view with quick actions)
  openCardDetailModal(id);
}

// Drag & drop — handlers now attached per-column in renderLeads()
// Global cleanup of drag state
document.addEventListener('dragend', e=>{
  document.querySelectorAll('.kcol-body').forEach(b=>b.classList.remove('drag-over'));
  _dragId = null;
});

// ═══════════════════════════════════════════════════════════
// Lost reason prompt — shown once when a lead is first moved to
// the 'Lost' stage. Captures a reason (optional) so the Rep
// Report Generator's Win/Loss Analysis metric has data to
// pattern-match on. Returns:
//   - string    (user picked a reason or typed a custom one)
//   - null      (user skipped, no reason recorded)
//   - false     (user hit Cancel — caller should abort the move)
// DOM built with createElement so no XSS risk from user notes.
// ═══════════════════════════════════════════════════════════
function promptLostReason(lead) {
  return new Promise((resolve) => {
    const existing = document.getElementById('nbd-lost-reason-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'nbd-lost-reason-modal';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;padding:20px;';

    const sheet = document.createElement('div');
    sheet.style.cssText = 'background:var(--s, #1a1d23);border:1px solid var(--br, #2a2d35);border-radius:12px;padding:28px;max-width:480px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.5);';

    const hdr = document.createElement('div');
    hdr.style.cssText = 'margin-bottom:16px;';
    const hdrTitle = document.createElement('div');
    hdrTitle.style.cssText = "font-family:'Barlow Condensed',sans-serif;font-size:20px;font-weight:800;color:var(--t);text-transform:uppercase;letter-spacing:.04em;";
    hdrTitle.textContent = 'Why Lost?';
    const hdrSub = document.createElement('div');
    hdrSub.style.cssText = 'font-size:12px;color:var(--m);margin-top:4px;';
    const customerName = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.address || 'This customer';
    hdrSub.textContent = customerName + ' — pick a reason to help future reporting (optional)';
    hdr.appendChild(hdrTitle);
    hdr.appendChild(hdrSub);
    sheet.appendChild(hdr);

    const reasons = [
      { key: 'price',              label: 'Price — too expensive' },
      { key: 'timing',             label: 'Timing — not ready yet' },
      { key: 'no_claim',           label: 'No insurance claim approved' },
      { key: 'no_response',        label: 'Ghosted / no response' },
      { key: 'competitor',         label: 'Chose a competitor' },
      { key: 'insurance_denial',   label: 'Insurance denied the claim' },
      { key: 'other',              label: 'Other (type below)' }
    ];
    let selected = null;

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;';
    reasons.forEach(r => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = r.label;
      btn.style.cssText = 'background:var(--s2);border:1px solid var(--br);color:var(--t);padding:10px 12px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px;text-align:left;transition:all .15s;';
      btn.addEventListener('mouseenter', () => { btn.style.borderColor = 'var(--orange)'; });
      btn.addEventListener('mouseleave', () => { if (selected !== r.key) btn.style.borderColor = 'var(--br)'; });
      btn.addEventListener('click', () => {
        selected = r.key;
        grid.querySelectorAll('button').forEach(b => { b.style.borderColor = 'var(--br)'; b.style.background = 'var(--s2)'; });
        btn.style.borderColor = 'var(--orange)';
        btn.style.background = 'rgba(232,114,12,.08)';
        if (r.key === 'other') customInput.focus();
      });
      grid.appendChild(btn);
    });
    sheet.appendChild(grid);

    const customLabel = document.createElement('label');
    customLabel.style.cssText = 'display:block;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--m);margin-bottom:6px;';
    customLabel.textContent = 'Or type a custom reason';
    const customInput = document.createElement('textarea');
    customInput.rows = 2;
    customInput.placeholder = 'Optional — e.g. adjuster lowballed and customer would not negotiate';
    customInput.style.cssText = 'width:100%;background:var(--s2);border:1px solid var(--br);border-radius:6px;padding:10px 12px;color:var(--t);font-family:inherit;font-size:12px;outline:none;resize:vertical;';
    sheet.appendChild(customLabel);
    sheet.appendChild(customInput);

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-top:18px;gap:8px;';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel Move';
    cancelBtn.style.cssText = 'background:none;border:1px solid var(--br);color:var(--m);padding:10px 16px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px;';
    cancelBtn.addEventListener('click', () => { overlay.remove(); resolve(false); });

    const right = document.createElement('div');
    right.style.cssText = 'display:flex;gap:8px;';

    const skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.textContent = 'Skip — no reason';
    skipBtn.style.cssText = 'background:var(--s2);border:1px solid var(--br);color:var(--m);padding:10px 16px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px;';
    skipBtn.addEventListener('click', () => { overlay.remove(); resolve(null); });

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = 'Mark Lost';
    saveBtn.style.cssText = 'background:var(--orange);border:1px solid var(--orange);color:#fff;padding:10px 18px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;';
    saveBtn.addEventListener('click', () => {
      const custom = customInput.value.trim();
      let reason = null;
      if (custom) {
        // Custom takes precedence over preset if both are present
        reason = custom.substring(0, 300);
      } else if (selected) {
        const r = reasons.find(x => x.key === selected);
        reason = r ? r.label : null;
      }
      overlay.remove();
      resolve(reason);
    });

    right.appendChild(skipBtn);
    right.appendChild(saveBtn);
    footer.appendChild(cancelBtn);
    footer.appendChild(right);
    sheet.appendChild(footer);

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    // Click outside cancels (same as Cancel button)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { overlay.remove(); resolve(false); }
    });
    // Esc cancels
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
        resolve(false);
      }
    };
    document.addEventListener('keydown', escHandler);
  });
}

async function moveCard(id, newStage){
  const lead = (window._leads||[]).find(l=>l.id===id);
  if(!lead) return;
  // Prevent concurrent moves on the same card
  if(lead._pending){ if(typeof showToast==='function') showToast('Move in progress...','info'); return; }

  const oldStage = lead.stage || 'New';
  const oldStageKey = lead._stageKey || oldStage;

  // ─── Lost-reason prompt ───
  // When a lead moves to 'lost' (or 'Lost'), capture an optional
  // reason so the Win/Loss Analysis metric in the Rep Report
  // Generator can show patterns. User can pick a preset, type a
  // custom reason, or skip entirely. Canceling the prompt cancels
  // the move.
  let lostReason = null;
  const isLostMove = /^lost$/i.test(String(newStage || ''));
  if (isLostMove && !lead.lostReason) {
    lostReason = await promptLostReason(lead);
    if (lostReason === false) {
      // User canceled the prompt — do NOT move the card
      if (typeof showToast === 'function') showToast('Move canceled', 'info');
      return;
    }
    // lostReason is either a string or null (skip)
  }

  lead._pending = true;

  // ══════════════════════════════════════════════
  // OPTIMISTIC UPDATE — Update UI immediately
  // ══════════════════════════════════════════════
  lead.stage = newStage;
  lead._stageKey = window.normalizeStage ? window.normalizeStage(newStage) : newStage;
  if (isLostMove && lostReason) lead.lostReason = lostReason;

  // Mark as syncing (add visual indicator)
  lead._syncing = true;

  // Render immediately with new stage
  renderLeads(window._leads, window._filteredLeads);

  // Record stage change in history
  const historyEvent = {
    from: oldStage,
    to: newStage,
    timestamp: new Date().toISOString(),
    user: window._currentUser?.email || 'unknown'
  };
  if (isLostMove && lostReason) historyEvent.lostReason = lostReason;

  try {
    // Save to Firebase in background
    const leadRef = window.doc(window.db, 'leads', id);
    const updatePayload = {
      stage: newStage,
      updatedAt: window.serverTimestamp(),
      stageHistory: window.arrayUnion(historyEvent)
    };
    if (isLostMove) {
      updatePayload.closedAt = window.serverTimestamp();
      if (lostReason) updatePayload.lostReason = lostReason;
    }
    await window.updateDoc(leadRef, updatePayload);
    
    // Update local state with history
    if(!lead.stageHistory) lead.stageHistory = [];
    lead.stageHistory.push(historyEvent);

    // Auto-log activity note for timeline
    try {
      const stageLabel = window.STAGE_META?.[newStage]?.label || newStage;
      await window.addDoc(window.collection(window.db, 'notes'), {
        leadId: id,
        userId: window._user?.uid,
        text: `Stage moved to "${stageLabel}"`,
        type: 'stage_change',
        createdAt: window.serverTimestamp(),
        createdBy: window._user?.email || 'system'
      });
    } catch(e) { console.warn('Activity log write failed:', e.message); }

    // Trigger email drip automation on stage change
    try {
      if (window.EmailDrip?.onStageChange) {
        window.EmailDrip.onStageChange(id, oldStageKey, lead._stageKey || newStage);
      }
    } catch(e) { console.warn('Drip trigger failed:', e.message); }

    // Mark as synced
    lead._syncing = false;
    lead._syncSuccess = true;
    delete lead._pending;
    
    // Show success briefly
    setTimeout(() => {
      delete lead._syncSuccess;
      renderLeads(window._leads, window._filteredLeads);
    }, 1000);
    
    renderLeads(window._leads, window._filteredLeads);
    
  } catch(e){ 
    console.error('moveCard error',e);
    
    // ══════════════════════════════════════════════
    // ROLLBACK — Revert UI if Firebase fails
    // ══════════════════════════════════════════════
    lead.stage = oldStage;
    lead._stageKey = oldStageKey;
    lead._syncing = false;
    lead._syncError = true;
    delete lead._pending;
    
    renderLeads(window._leads, window._filteredLeads);
    
    // Show error toast with undo action
    if (typeof window.showToast === 'function') {
      window.showToast({
        message: `Failed to move "${lead.firstName || lead.name || 'lead'}" to ${newStage}. Changes reverted.`,
        type: 'error',
        duration: 5000,
        undoAction: () => {
          // Retry the move
          moveCard(id, newStage);
        },
        undoText: 'Retry'
      });
    }
    
    // Clear error flag
    setTimeout(() => {
      delete lead._syncError;
      renderLeads(window._leads, window._filteredLeads);
    }, 3000);
  }
}

function updatePipeline(leads){ renderLeads(leads); }

function tagClass(s){
  // Use new stage system if available
  if (window.normalizeStage) {
    const key = window.normalizeStage(s);
    return `tag-${key.replace(/_/g, '-')}`;
  }
  // Legacy fallback
  return({'New':'tag-new','Inspected':'tag-insp','Estimate Sent':'tag-es',
    'Approved':'tag-appr','In Progress':'tag-prog','Complete':'tag-won','Lost':'tag-lost',
    'New Lead':'tag-new','Contacted':'tag-insp','Negotiating':'tag-appr',
    'Closed Won':'tag-won','Closed Lost':'tag-lost'}[s]||'tag-new');
}

function kanbanFilter(){
  const searchInput = document.getElementById('crmSearch');
  const search = (searchInput?.value||'').toLowerCase().trim();
  const dmg    = (document.getElementById('crmDmgFilter')?.value||'').toLowerCase();
  
  // Persist search state
  if(search) localStorage.setItem('nbd_crm_search', search);
  else localStorage.removeItem('nbd_crm_search');
  
  // Show/hide clear button
  const clearBtn = document.getElementById('crmSearchClear');
  if(clearBtn) clearBtn.style.display = search ? 'flex' : 'none';
  
  if(!search && !dmg){ 
    window._searchQuery = null;
    const countSpan = document.getElementById('crmSearchCount');
    if(countSpan) countSpan.textContent = '';
    renderLeads(window._leads); 
    return; 
  }
  
  window._searchQuery = search;
  
  // Filter with email + notes included
  const filtered = (window._leads||[]).filter(l=>{
    const searchStr = [
      l.firstName||'', l.lastName||'', l.address||'', 
      l.damageType||'', l.phone||'', l.email||'', l.notes||''
    ].join(' ').toLowerCase();
    
    const matchS = !search || searchStr.includes(search);
    const matchD = !dmg    || (l.damageType||'').toLowerCase()===dmg;
    return matchS && matchD;
  });
  
  const countSpan = document.getElementById('crmSearchCount');
  if(countSpan) countSpan.textContent = `${filtered.length} match${filtered.length===1?'':'es'}`;
  
  renderLeads(window._leads, filtered);
}


// Debounced version for keystroke events (250ms delay)
const kanbanFilterDebounced = debounce(kanbanFilter, 250, 'kanbanFilter');

function clearCrmSearch(){
  const searchInput = document.getElementById('crmSearch');
  const dmgFilter = document.getElementById('crmDmgFilter');
  if(searchInput) searchInput.value = '';
  if(dmgFilter) dmgFilter.value = '';
  localStorage.removeItem('nbd_crm_search');
  window._searchQuery = null;
  kanbanFilter();
}



// ═══════════════════════════════════════════════════════════════
// NOTIFICATION SYSTEM
// ═══════════════════════════════════════════════════════════════

window._notifications = [];
window._notifDropdownOpen = false;

async function loadNotifications() {
  try {
    const _auth = window._auth;
    const _db   = window._db;
    if (!_auth || !_db) return;
    const user  = _auth.currentUser;
    if (!user) return;

    // Load notifications from Firestore (including dismissed, we filter client-side)
    const {getDocs: _getDocs, query: _query, collection: _col, where: _where, orderBy: _order, limit: _limit} =
      await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    const notifSnap = await _getDocs(
      _query(
        _col(_db, 'notifications'),
        _where('userId', '==', user.uid),
        _order('createdAt', 'desc'),
        _limit(50)
      )
    );

    const allNotifs = notifSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    window._notifications = allNotifs.filter(n => !n.dismissed);
    window._dismissedNotifications = allNotifs.filter(n => n.dismissed);

    // Count unread (non-dismissed)
    const unreadCount = window._notifications.filter(n => !n.read).length;

    // Update badge
    const badge = document.getElementById('notifBadge');
    if (badge) {
      if (unreadCount > 0) {
        badge.style.display = 'block';
        badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
      } else {
        badge.style.display = 'none';
      }
    }

    // Render list if dropdown is open
    if (window._notifDropdownOpen) {
      renderNotifications();
    }

  } catch (error) {
    console.error('Error loading notifications:', error);
  }
}

const NOTIF_ICONS = {
  'task_due': '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><path d="M5 2h10v4l-3 3 3 3v4H5v-4l3-3-3-3V2z"/></svg>',
  'task_overdue': '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><path d="M10 3L2 17h16L10 3z"/><path d="M10 8v4M10 14.5v.5"/></svg>',
  'estimate_approved': '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><circle cx="10" cy="10" r="7"/><path d="M7 10l2 2 4-5"/></svg>',
  'stage_change': '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><path d="M3 10a7 7 0 0112.9-3.7L17 5"/><path d="M17 10a7 7 0 01-12.9 3.7L3 15"/><path d="M17 2v3h-3M3 18v-3h3"/></svg>',
  'follow_up': '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;vertical-align:middle;"><rect x="3" y="4" width="14" height="13" rx="1.5"/><path d="M3 8h14"/><path d="M7 2v4M13 2v4"/></svg>',
  'new_lead': '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><circle cx="10" cy="7" r="3"/><path d="M4 17a6 6 0 0112 0"/></svg>',
  'default': '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><path d="M10 2a5 5 0 00-5 5c0 4-2 6-2 6h14s-2-2-2-6a5 5 0 00-5-5z"/><path d="M8.5 16a1.5 1.5 0 003 0"/></svg>'
};

function renderNotifItem(n, opts = {}) {
  const isUnread = !n.read;
  const isDismissed = opts.dismissed || false;
  const timestamp = n.createdAt?.toDate ? n.createdAt.toDate() : new Date(n.createdAt || Date.now());
  const timeAgo = getTimeAgo(timestamp);
  const icon = NOTIF_ICONS[n.type] || NOTIF_ICONS.default;
  const hasLead = n.leadId && !n.leadId.startsWith('d-');

  // Notification.message is populated from incoming SMS + push content via
  // Cloud Functions, so it can contain attacker-controlled HTML. Every field
  // is escaped and all IDs are data-attributes consumed by event listeners
  // (see wireNotifListeners below) instead of inline onclick handlers.
  return `
    <div class="nbd-notif-row" data-notif-id="${escHtml(n.id)}" data-notif-lead="${escHtml(n.leadId||'')}" data-notif-dismissed="${isDismissed ? '1' : '0'}" data-notif-type="${escHtml(n.type||'')}" style="padding:10px 14px;border-bottom:1px solid var(--br);cursor:pointer;transition:background .15s;${isUnread && !isDismissed ? 'background:var(--og);' : ''}${isDismissed ? 'opacity:0.65;' : ''}">
      <div style="display:flex;gap:10px;align-items:start;">
        <div style="font-size:20px;flex-shrink:0;">${icon}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:${isUnread ? '600' : '400'};margin-bottom:3px;color:var(--t);">
            ${escHtml(n.title || 'Notification')}
          </div>
          <div style="font-size:12px;color:var(--m);margin-bottom:3px;line-height:1.4;">
            ${escHtml(n.message || '')}
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:10px;color:var(--m);opacity:0.8;">${escHtml(timeAgo)}</span>
            ${hasLead && !isDismissed ? `<span style="font-size:9px;color:var(--blue);font-weight:600;letter-spacing:.03em;">→ VIEW LEAD</span>` : ''}
            ${hasLead && !isDismissed && (n.type === 'follow_up' || n.type === 'task_overdue') ? `<span class="nbd-notif-sms" style="font-size:9px;color:var(--green,var(--green));font-weight:600;letter-spacing:.03em;cursor:pointer;">📱 SMS</span>` : ''}
            ${isDismissed ? `<span class="nbd-notif-restore" style="font-size:9px;color:var(--orange);font-weight:600;letter-spacing:.03em;cursor:pointer;">↩ RESTORE</span>` : ''}
          </div>
        </div>
        ${isUnread && !isDismissed ? `<div style="width:8px;height:8px;background:var(--orange);border-radius:50%;flex-shrink:0;margin-top:4px;"></div>` : ''}
        ${!isDismissed ? `<button class="nbd-notif-dismiss" title="Dismiss" style="background:none;border:none;color:var(--m);cursor:pointer;font-size:14px;padding:2px 4px;opacity:0.4;flex-shrink:0;line-height:1;">✕</button>` : ''}
      </div>
    </div>`;
}

// Wire event listeners on all rendered notification rows. Called after every
// innerHTML = list.map(renderNotifItem) so handlers attach to the new DOM.
// Delegated click listener for every kanban card. Replaces the inline
// onclick="..." attributes that buildCard() used to emit. Each action
// button has a data-action attribute naming the handler, plus data-id /
// data-* payloads. Called by the kanban render functions after every
// innerHTML update so listeners survive re-renders.
function wireKanbanCardListeners(container) {
  if (!container || container.__nbdWired) return;
  container.__nbdWired = true;

  const handlers = {
    'card-click':   (el, ev) => typeof handleCardClick === 'function' && handleCardClick(el.dataset.id, ev),
    'toggle-select':(el)     => typeof toggleCardSelection === 'function' && toggleCardSelection(el.dataset.id),
    'open-tasks':   (el, ev) => typeof openTaskModal === 'function' && openTaskModal(el.dataset.id, ev),
    'move-card':    (el)     => typeof moveCard === 'function' && moveCard(el.dataset.id, el.dataset.targetStage),
    'edit-lead':    (el)     => typeof editLead === 'function' && editLead(el.dataset.id),
    'delete-lead':  (el)     => typeof deleteLead === 'function' && deleteLead(el.dataset.id),
    'booking-sms':  (el)     => typeof sendBookingSMS === 'function' && sendBookingSMS(el.dataset.id, el.dataset.phone, el.dataset.firstName),
    'email-lead':   (el)     => {
      if (typeof emailByStage === 'function') return emailByStage(el.dataset.id);
      if (typeof window.emailByStage === 'function') return window.emailByStage(el.dataset.id);
    },
    'open-photo':   (el)     => typeof openPhotoFor === 'function' && openPhotoFor(el.dataset.leadId, ''),
  };

  container.addEventListener('click', (ev) => {
    // Let <a href="tel:..."> links and elements marked nbd-kc-stop swallow
    // propagation before we dispatch, so they don't open the card behind.
    const stopEl = ev.target.closest('.nbd-kc-stop');
    const actionEl = ev.target.closest('[data-action]');
    if (!actionEl || !container.contains(actionEl)) return;
    const action = actionEl.dataset.action;

    // Every non-card-click action must not bubble up to re-open the card.
    if (action !== 'card-click') ev.stopPropagation();
    if (stopEl && stopEl !== actionEl && action === 'card-click') return;

    const fn = handlers[action];
    if (fn) fn(actionEl, ev);
  });

  // Photo thumbs use a separate class because they don't have a data-action.
  container.addEventListener('click', (ev) => {
    const photo = ev.target.closest('.nbd-kc-photo');
    if (!photo || !container.contains(photo)) return;
    ev.stopPropagation();
    if (typeof openPhotoFor === 'function') openPhotoFor(photo.dataset.leadId, '');
  });
}

function wireNotifListeners(container) {
  if (!container) return;
  container.querySelectorAll('.nbd-notif-row').forEach(row => {
    const id = row.dataset.notifId;
    const leadId = row.dataset.notifLead || '';
    const dismissed = row.dataset.notifDismissed === '1';
    row.addEventListener('mouseenter', () => { row.style.background = 'var(--s2)'; });
    row.addEventListener('mouseleave', () => { row.style.background = dismissed ? '' : row.dataset.notifBg || ''; });
    row.addEventListener('click', () => notifAction(id, leadId, dismissed));

    const smsBtn = row.querySelector('.nbd-notif-sms');
    if (smsBtn) smsBtn.addEventListener('click', (e) => { e.stopPropagation(); sendFollowUpSMS(leadId); });

    const restoreBtn = row.querySelector('.nbd-notif-restore');
    if (restoreBtn) restoreBtn.addEventListener('click', (e) => { e.stopPropagation(); restoreNotification(id); });

    const dismissBtn = row.querySelector('.nbd-notif-dismiss');
    if (dismissBtn) dismissBtn.addEventListener('click', (e) => { e.stopPropagation(); dismissNotification(id); });
  });
}

function renderNotifications() {
  const list = document.getElementById('notifList');
  if (!list) return;

  const unreadCount = window._notifications.filter(n => !n.read).length;
  const dismissedCount = (window._dismissedNotifications||[]).length;

  // Show/hide header buttons
  const markAllBtn = document.querySelector('[onclick="markAllNotificationsRead()"]');
  if (markAllBtn) markAllBtn.style.display = unreadCount > 0 ? 'inline-block' : 'none';
  const clearAllBtn = document.getElementById('clearAllNotifBtn');
  if (clearAllBtn) clearAllBtn.style.display = window._notifications.length > 0 ? 'inline-block' : 'none';

  // Show/hide dismissed toggle
  const dismissedToggle = document.getElementById('notifDismissedToggle');
  if (dismissedToggle) dismissedToggle.style.display = dismissedCount > 0 ? 'block' : 'none';
  const dismissedCountEl = document.getElementById('dismissedCount');
  if (dismissedCountEl) dismissedCountEl.textContent = dismissedCount > 0 ? `(${dismissedCount})` : '';

  if (window._notifications.length === 0) {
    list.innerHTML = `
      <div style="padding:40px 20px;text-align:center;color:var(--m);">
        <div style="margin-bottom:8px;opacity:0.5;"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:28px;height:28px;"><path d="M10 2a5 5 0 00-5 5c0 4-2 6-2 6h14s-2-2-2-6a5 5 0 00-5-5z"/><path d="M8.5 16a1.5 1.5 0 003 0"/></svg></div>
        <div style="font-size:13px;">${dismissedCount > 0 ? 'All caught up' : 'No notifications yet'}</div>
        ${dismissedCount > 0 ? '<div style="font-size:11px;color:var(--m);margin-top:4px;">Dismissed items are below</div>' : ''}
      </div>`;
    return;
  }

  list.innerHTML = window._notifications.map(n => renderNotifItem(n)).join('');
  wireNotifListeners(list);

  // Render dismissed list if open
  renderDismissedNotifications();
}

function getTimeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}

window.toggleNotificationDropdown = function() {
  const dropdown = document.getElementById('notifDropdown');
  if (!dropdown) return;
  
  window._notifDropdownOpen = !window._notifDropdownOpen;
  
  if (window._notifDropdownOpen) {
    dropdown.style.display = 'flex';
    renderNotifications();
  } else {
    dropdown.style.display = 'none';
  }
};

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const notifBtn = document.getElementById('notifBtn');
  const dropdown = document.getElementById('notifDropdown');
  if (notifBtn && dropdown && window._notifDropdownOpen) {
    if (!notifBtn.contains(e.target) && !dropdown.contains(e.target)) {
      window._notifDropdownOpen = false;
      dropdown.style.display = 'none';
    }
  }
});

// ── Click a notification: mark read + navigate to lead ──
async function notifAction(notifId, leadId, isDismissed) {
  if (isDismissed) {
    // If clicking a dismissed notification, restore it
    await restoreNotification(notifId);
    return;
  }
  // Mark as read
  await markNotificationRead(notifId);
  // Navigate to the lead if we have one
  if (leadId && !leadId.startsWith('d-')) {
    // Close dropdown
    window._notifDropdownOpen = false;
    const dropdown = document.getElementById('notifDropdown');
    if (dropdown) dropdown.style.display = 'none';
    // Go to CRM and open the lead
    if (typeof goTo === 'function') goTo('crm');
    // Small delay to let CRM view render, then trigger lead card click
    setTimeout(() => {
      if (typeof handleCardClick === 'function') {
        handleCardClick(leadId);
      } else {
        // Fallback: find card and click it
        const card = document.querySelector(`.lead-card[data-id="${leadId}"]`);
        if (card) card.click();
      }
    }, 300);
  }
}

async function markNotificationRead(notifId) {
  try {
    const _db = window._db || window.db;
    if (!_db) return;
    const { updateDoc, doc, serverTimestamp } =
      await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

    await updateDoc(doc(_db, 'notifications', notifId), {
      read: true,
      readAt: serverTimestamp()
    });

    // Update local state
    const notif = window._notifications.find(n => n.id === notifId);
    if (notif) notif.read = true;

    // Refresh display
    await loadNotifications();

  } catch (error) {
    console.error('Error marking notification as read:', error);
  }
}

// ── Dismiss a single notification ──
async function dismissNotification(notifId) {
  try {
    const _db = window._db || window.db;
    if (!_db) return;
    const { updateDoc, doc, serverTimestamp } =
      await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

    await updateDoc(doc(_db, 'notifications', notifId), {
      dismissed: true,
      dismissedAt: serverTimestamp(),
      read: true
    });

    await loadNotifications();
    window.showToast?.('Notification dismissed', 'success');
  } catch (error) {
    console.error('Error dismissing notification:', error);
  }
}

// ── Clear ALL visible notifications ──
async function clearAllNotifications() {
  try {
    const _db = window._db || window.db;
    if (!_db) return;
    const { updateDoc, doc, serverTimestamp } =
      await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

    const visible = window._notifications.filter(n => !n.dismissed);
    if (!visible.length) return;

    await Promise.all(visible.map(n =>
      updateDoc(doc(_db, 'notifications', n.id), {
        dismissed: true,
        dismissedAt: serverTimestamp(),
        read: true
      })
    ));

    await loadNotifications();
    window.showToast?.(`${visible.length} notification${visible.length!==1?'s':''} cleared`, 'success');
  } catch (error) {
    console.error('Error clearing all notifications:', error);
  }
}

// ── Restore a dismissed notification ──
async function restoreNotification(notifId) {
  try {
    const _db = window._db || window.db;
    if (!_db) return;
    const { updateDoc, doc, serverTimestamp } =
      await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

    await updateDoc(doc(_db, 'notifications', notifId), {
      dismissed: false,
      read: false,
      restoredAt: serverTimestamp()
    });

    await loadNotifications();
    window.showToast?.('Notification restored', 'success');
  } catch (error) {
    console.error('Error restoring notification:', error);
  }
}

// ── Toggle dismissed notifications drawer ──
window._dismissedDrawerOpen = false;
function toggleDismissedNotifications() {
  window._dismissedDrawerOpen = !window._dismissedDrawerOpen;
  const dismissedList = document.getElementById('notifDismissedList');
  const toggleLabel = document.getElementById('dismissedToggleLabel');
  if (dismissedList) {
    dismissedList.style.display = window._dismissedDrawerOpen ? 'block' : 'none';
  }
  if (toggleLabel) {
    toggleLabel.textContent = window._dismissedDrawerOpen ? 'Hide dismissed' : 'Show dismissed';
  }
  if (window._dismissedDrawerOpen) renderDismissedNotifications();
}

function renderDismissedNotifications() {
  const list = document.getElementById('notifDismissedList');
  if (!list || !window._dismissedDrawerOpen) return;
  const dismissed = window._dismissedNotifications || [];
  if (!dismissed.length) {
    list.innerHTML = `<div style="padding:16px;text-align:center;font-size:11px;color:var(--m);">No dismissed notifications</div>`;
    return;
  }
  list.innerHTML = dismissed.map(n => renderNotifItem(n, {dismissed:true})).join('');
  wireNotifListeners(list);
}

async function markAllNotificationsRead() {
  try {
    const _db = window._db || window.db;
    if (!_db) return;
    const { updateDoc, doc, serverTimestamp } =
      await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

    const unread = window._notifications.filter(n => !n.read);

    await Promise.all(unread.map(n =>
      updateDoc(doc(_db, 'notifications', n.id), {
        read: true,
        readAt: serverTimestamp()
      })
    ));

    // Update local state
    window._notifications.forEach(n => n.read = true);

    // Refresh display
    await loadNotifications();

  } catch (error) {
    console.error('Error marking all as read:', error);
  }
}

// Helper function to create notifications (for system use)
async function createNotification(userId, type, title, message, leadId = null) {
  try {
    const _db = window._db || window.db;
    if (!_db) return;
    const { addDoc, collection, serverTimestamp } =
      await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

    await addDoc(collection(_db, 'notifications'), {
      userId: userId,
      type: type,
      title: title,
      message: message,
      leadId: leadId,
      read: false,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Error creating notification:', error);
  }
}

// ══════════════════════════════════════════════════════════════════════
// FOLLOW-UP NOTIFICATION ENGINE
// ══════════════════════════════════════════════════════════════════════
async function checkAndCreateFollowUpNotifications(leads) {
  if (!window._user || !leads || !leads.length) return;
  const userId = window._user.uid;

  const today = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

  // Categorize leads
  const overdue = [];
  const dueToday = [];
  const dueTomorrow = [];

  leads.forEach(l => {
    if (!l.followUp || ['Complete','Lost'].includes(l.stage||'')) return;
    const d = new Date(l.followUp); d.setHours(0,0,0,0);
    if (d < today) overdue.push(l);
    else if (d.getTime() === today.getTime()) dueToday.push(l);
    else if (d.getTime() === tomorrow.getTime()) dueTomorrow.push(l);
  });

  if (!overdue.length && !dueToday.length && !dueTomorrow.length) return;

  // Deduplicate — only create one notification per lead per day
  const todayKey = today.toISOString().split('T')[0];
  const existingKeys = new Set(
    (window._notifications || [])
      .filter(n => n.type === 'follow_up' && (n.dateKey === todayKey))
      .map(n => n.leadId)
  );

  const toCreate = [];

  overdue.forEach(l => {
    if (existingKeys.has(l.id)) return;
    const name = `${l.firstName||''} ${l.lastName||''}`.trim() || (l.address||'').split(',')[0] || 'Lead';
    const daysLate = Math.round((today - new Date(l.followUp)) / 86400000);
    toCreate.push({
      userId, type: 'follow_up', leadId: l.id, dateKey: todayKey,
      title: `Overdue Follow-Up — ${name}`,
      message: `${daysLate} day${daysLate!==1?'s':''} overdue${l.address ? ' · ' + l.address.split(',')[0] : ''}. ${l.stage ? 'Stage: ' + l.stage : ''}`,
      priority: 'high', read: false
    });
  });

  dueToday.forEach(l => {
    if (existingKeys.has(l.id)) return;
    const name = `${l.firstName||''} ${l.lastName||''}`.trim() || (l.address||'').split(',')[0] || 'Lead';
    toCreate.push({
      userId, type: 'follow_up', leadId: l.id, dateKey: todayKey,
      title: `Follow-Up Today — ${name}`,
      message: `${l.address ? l.address.split(',')[0] + ' · ' : ''}${l.stage ? 'Stage: ' + l.stage : ''}${l.insCarrier ? ' · ' + l.insCarrier : ''}`,
      priority: 'normal', read: false
    });
  });

  dueTomorrow.forEach(l => {
    if (existingKeys.has(l.id)) return;
    const name = `${l.firstName||''} ${l.lastName||''}`.trim() || (l.address||'').split(',')[0] || 'Lead';
    toCreate.push({
      userId, type: 'follow_up', leadId: l.id, dateKey: todayKey,
      title: `Follow-Up Tomorrow — ${name}`,
      message: `${l.address ? l.address.split(',')[0] + ' · ' : ''}${l.stage ? 'Stage: ' + l.stage : ''}`,
      priority: 'low', read: false
    });
  });

  if (!toCreate.length) return;

  // Write to Firestore
  try {
    const _db = window._db || window.db;
    if (!_db) return;
    const { addDoc, collection: firestoreCol, serverTimestamp } =
      await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

    await Promise.all(toCreate.map(n =>
      addDoc(firestoreCol(_db, 'notifications'), {
        ...n,
        createdAt: serverTimestamp()
      })
    ));
    // Reload notifications so badge updates immediately
    await loadNotifications();

    // Browser notification if permitted
    if ('Notification' in window && Notification.permission === 'granted') {
      const overdueCount = overdue.filter(l => !existingKeys.has(l.id)).length;
      const todayCount = dueToday.filter(l => !existingKeys.has(l.id)).length;
      let body = '';
      if (overdueCount) body += `${overdueCount} overdue follow-up${overdueCount!==1?'s':''}. `;
      if (todayCount) body += `${todayCount} due today.`;
      if (body) new Notification('NBD Pro — Follow-Ups', { body: body.trim(), icon: '/favicon.ico' });
    }
  } catch(e) {
    console.error('Follow-up notification error:', e);
  }
}
window.checkAndCreateFollowUpNotifications = checkAndCreateFollowUpNotifications;
window.markNotificationRead = markNotificationRead;
window.markAllNotificationsRead = markAllNotificationsRead;
window.loadNotifications = loadNotifications;
window.renderNotifications = renderNotifications;
window.notifAction = notifAction;
window.dismissNotification = dismissNotification;
window.clearAllNotifications = clearAllNotifications;
window.restoreNotification = restoreNotification;
window.toggleDismissedNotifications = toggleDismissedNotifications;
window.renderDismissedNotifications = renderDismissedNotifications;

// Request browser notification permission.
// Must be called from a user-gesture handler (click/tap) per Chrome 80+,
// Firefox 72+, and Safari. Calling on page load gets silently denied on
// every modern browser and poisons the permission state until the user
// manually resets it. We now defer until the user clicks "Enable
// notifications" — wired via enableNotifCTA below.
async function requestNotifPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch (e) {
    console.warn('[notif] permission request threw:', e);
    return 'denied';
  }
}
// Attach to any element tagged data-action="enable-notifications" so the
// call happens inside the click handler. Safe to call multiple times.
window.addEventListener('click', (e) => {
  const el = e.target && e.target.closest && e.target.closest('[data-action="enable-notifications"]');
  if (!el) return;
  requestNotifPermission().then(state => {
    if (typeof showToast === 'function') {
      if (state === 'granted') showToast('Notifications enabled', 'success');
      else if (state === 'denied') showToast('Notifications blocked — check browser settings', 'error');
    }
  });
});
// ══ END FOLLOW-UP NOTIFICATION ENGINE ═════════════════════════════════

// Load notifications on auth - poll for window._user set by main auth callback
let _notifInterval = null;
(function waitForNotifAuth() {
  if (window._user) {
    loadNotifications();
    if (_notifInterval) clearInterval(_notifInterval);
    _notifInterval = setInterval(loadNotifications, 120000);
  } else {
    setTimeout(waitForNotifAuth, 300);
  }
})();


// ═══════════════════════════════════════════════════════════════
// BULK ACTIONS SYSTEM
// ═══════════════════════════════════════════════════════════════

window._bulkMode = false;
window._bulkSelected = new Set();

function toggleBulkMode() {
  window._bulkMode = !window._bulkMode;
  const btn = document.getElementById('bulkModeBtn');
  const kanbanBoard = document.querySelector('.kanban-board');
  
  if (window._bulkMode) {
    btn.textContent = 'Cancel';
    btn.classList.add('btn-orange');
    btn.classList.remove('btn-ghost');
    kanbanBoard.classList.add('bulk-mode-active');
  } else {
    btn.textContent = 'Select';
    btn.classList.remove('btn-orange');
    btn.classList.add('btn-ghost');
    kanbanBoard.classList.remove('bulk-mode-active');
    clearBulkSelection();
  }
}

function toggleCardSelection(leadId) {
  if (!window._bulkMode) return;
  
  const card = document.querySelector(`.k-card[data-id="${leadId}"]`);
  if (!card) return;
  
  if (window._bulkSelected.has(leadId)) {
    window._bulkSelected.delete(leadId);
    card.classList.remove('bulk-selected');
  } else {
    window._bulkSelected.add(leadId);
    card.classList.add('bulk-selected');
  }
  
  updateBulkToolbar();
}

function updateBulkToolbar() {
  const count = window._bulkSelected.size;
  const toolbar = document.getElementById('bulkActionBar');
  const countSpan = document.getElementById('bulkSelectedCount');
  
  if (countSpan) countSpan.textContent = count + ' selected';
  
  if (count > 0) {
    toolbar.classList.add('active');
    toolbar.style.display = 'flex';
  } else {
    toolbar.classList.remove('active');
    toolbar.style.display = 'none';
  }
}

function clearBulkSelection() {
  window._bulkSelected.clear();
  document.querySelectorAll('.k-card.bulk-selected').forEach(card => {
    card.classList.remove('bulk-selected');
  });
  updateBulkToolbar();
}

async function bulkMoveStage() {
  const stageSelect = document.getElementById('bulkStageSelect');
  const newStage = stageSelect.value;
  
  if (!newStage) {
    showToast('Please select a stage', 'error');
    return;
  }
  
  if (window._bulkSelected.size === 0) {
    showToast('No cards selected', 'error');
    return;
  }

  if (!confirm(`Move ${window._bulkSelected.size} lead(s) to "${newStage}"?`)) {
    return;
  }
  
  const selectedIds = Array.from(window._bulkSelected);
  
  try {
    // Move each card
    for (const leadId of selectedIds) {
      await moveCard(leadId, newStage);
    }
    
    // Clear selection and exit bulk mode
    clearBulkSelection();
    toggleBulkMode();
    
    showToast(`Moved ${selectedIds.length} lead(s) to ${newStage}`, 'ok');
    
  } catch (error) {
    console.error('Bulk move error:', error);
    showToast('Some moves failed. Please try again.', 'error');
  }
}

async function bulkDelete() {
  if (window._bulkSelected.size === 0) {
    showToast('No cards selected', 'error');
    return;
  }

  if (!confirm(`Delete ${window._bulkSelected.size} lead(s)? They will be moved to the trash.`)) {
    return;
  }
  
  const selectedIds = Array.from(window._bulkSelected);
  
  try {
    for (const leadId of selectedIds) {
      // Soft delete - mark as deleted
      await _updateDoc(_doc(window.db, 'leads', leadId), {
        deleted: true,
        deletedAt: _serverTimestamp()
      });
    }
    
    // Reload leads
    await loadLeads();
    
    // Clear selection and exit bulk mode
    clearBulkSelection();
    toggleBulkMode();
    
    showToast(`Deleted ${selectedIds.length} lead(s)`, 'ok');
    
  } catch (error) {
    console.error('Bulk delete error:', error);
    showToast('Some deletions failed. Please try again.', 'error');
  }
}


function restoreCrmSearch(){
  const saved = localStorage.getItem('nbd_crm_search');
  if(saved){
    const searchInput = document.getElementById('crmSearch');
    if(searchInput){
      searchInput.value = saved;
      kanbanFilter();
    }
  }
}

function scrollToFollowUps(){
  const el=document.getElementById('followUpAlerts');
  if(el){ el.style.display='block'; el.scrollIntoView({behavior:'smooth'}); }
}

function isOverdue(d){ if(!d) return false; const dt=new Date(d); dt.setHours(0,0,0,0); const t=new Date(); t.setHours(0,0,0,0); return dt<t; }

// (exportLeadsCSV removed — canonical definition is in tools.js)

// Edit lead
function editLead(id){
  const l=(window._leads||[]).find(x=>x.id===id);
  if(!l) return;
  const setV=(eid,val)=>{ const e=document.getElementById(eid); if(e) e.value=val||''; };
  setV('lFname',l.firstName||l.fname||'');
  setV('lLname',l.lastName||l.lname||'');
  setV('lAddr',l.address||'');
  setV('lPhone',l.phone||'');
  setV('lEmail',l.email||'');
  setV('lStage', l._stageKey || l.stage || 'new');
  setV('lJobType', l.jobType || '');
  setV('lSource',l.source||'Door Knock');
  setV('lDamageType',l.damageType||'');
  setV('lClaimStatus',l.claimStatus||'No Claim');
  setV('lJobValue',l.jobValue||'');
  setV('lFollowUp',l.followUp||'');
  setV('lInsCarrier',l.insCarrier||l.insuranceCarrier||'');
  // Insurance fields
  setV('lClaimNumber', l.claimNumber||'');
  setV('lClaimFiledBy', l.claimFiledBy||'');
  setV('lEstimateAmount', l.estimateAmount||'');
  setV('lDeductible', l.deductibleOrOwedByHO||'');
  setV('lSupplementStatus', l.supplementStatus||'');
  setV('lScopeOfWork', l.scopeOfWork||'');
  // Finance fields
  setV('lFinanceCompany', l.financeCompany||'');
  setV('lLoanAmount', l.loanAmount||'');
  setV('lLoanStatus', l.loanStatus||'');
  setV('lPreQualLink', l.preQualLink||'');
  // Job fields
  setV('lScheduledDate', l.scheduledDate||'');
  setV('lCrew', l.crew||'');
  setV('lNotes',l.notes||'');
  const editId=document.getElementById('lEditId'); if(editId) editId.value=id;
  const title=document.getElementById('leadModalTitle'); if(title) title.textContent='Edit Lead';
  openLeadModal();
  // Toggle field visibility based on job type
  if(typeof window.toggleInsuranceFields === 'function') setTimeout(window.toggleInsuranceFields, 50);
}

// Delete lead — soft delete with confirm modal
let _pendingDeleteId = null;

function deleteLead(id) {
  const lead = (window._leads||[]).find(l=>l.id===id);
  const name = lead ? (((lead.firstName||'')+' '+(lead.lastName||'')).trim() || lead.address || 'This Lead') : 'This Lead';
  showDeleteConfirm(id, name);
}

function showDeleteConfirm(id, name) {
  _pendingDeleteId = id;
  const nameEl = document.getElementById('delConfirmName');
  const overlay = document.getElementById('delConfirmOverlay');
  if (nameEl) nameEl.textContent = name;
  if (overlay) overlay.classList.add('open');
}

function cancelDeleteConfirm() {
  _pendingDeleteId = null;
  const overlay = document.getElementById('delConfirmOverlay');
  if (overlay) overlay.classList.remove('open');
}

async function confirmDeleteLead() {
  if(!_pendingDeleteId) return;
  const id = _pendingDeleteId;
  const overlay = document.getElementById('delConfirmOverlay');
  if (overlay) overlay.classList.remove('open');
  _pendingDeleteId = null;
  try {
    await window._deleteLead(id);
    showToast('Lead moved to Deleted bin');
    refreshTrashBadge();
  } catch(e) { showToast('Delete failed','error'); }
}

// ── DELETED LEADS DRAWER ─────────────────────
async function openDeletedDrawer() {
  const drawer = document.getElementById('deletedDrawer');
  if (!drawer) return;
  drawer.classList.add('open');
  await renderDeletedDrawer();
}
function closeDeletedDrawer() {
  const drawer = document.getElementById('deletedDrawer');
  if (drawer) drawer.classList.remove('open');
}

async function renderDeletedDrawer() {
  const body = document.getElementById('deletedDrawerBody');
  if (!body) return; // drawer not in DOM
  body.innerHTML = '<div class="deleted-empty">Loading...</div>';
  const deleted = await window._loadDeletedLeads();
  if(!deleted.length) {
    body.innerHTML = '<div class="empty"><div class="empty-icon"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><circle cx="10" cy="10" r="7"/><path d="M7 10l2 2 4-5"/></svg></div><div class="empty-title">All Clear</div><div class="empty-sub">No deleted leads in the trash.</div></div>';
    return;
  }
  // Every deleted-lead field is escaped via escHtml before interpolation,
  // and the action buttons use data-* + event delegation so an attacker-
  // controlled lead name/address can never break out of an attribute.
  body.innerHTML = deleted.map(l => {
    const rawName = ((l.firstName||'')+' '+(l.lastName||'')).trim() || l.address || 'Lead';
    const name = escHtml(rawName);
    const addr = escHtml((l.address||'').split(',').slice(0,2).join(','));
    const deletedDate = escHtml(l.deletedAt?.toDate ? l.deletedAt.toDate().toLocaleDateString() : 'Recently');
    const val = l.jobValue ? ' · $'+parseFloat(l.jobValue).toLocaleString() : '';
    const stage = escHtml(l.stage || 'New');
    const safeId = escHtml(l.id);
    return `<div class="deleted-card" id="dc-${safeId}">
      <div class="deleted-card-name">${name}</div>
      <div class="deleted-card-addr">${addr}</div>
      <div class="deleted-card-meta">Stage: ${stage}${val} · Deleted ${deletedDate}</div>
      <div class="deleted-card-btns">
        <button type="button" class="dc-restore nbd-dc-restore" data-id="${safeId}">Restore</button>
        <button type="button" class="dc-perm nbd-dc-perm" data-id="${safeId}" data-name="${name}">Remove</button>
      </div>
    </div>`;
  }).join('');
  // Wire delegated listeners.
  body.querySelectorAll('.nbd-dc-restore').forEach(btn => {
    btn.addEventListener('click', () => {
      if (typeof restoreDeletedLead === 'function') restoreDeletedLead(btn.dataset.id);
    });
  });
  body.querySelectorAll('.nbd-dc-perm').forEach(btn => {
    btn.addEventListener('click', () => {
      if (typeof permanentDeleteLead === 'function') permanentDeleteLead(btn.dataset.id, btn.dataset.name || '');
    });
  });
}

async function restoreDeletedLead(id) {
  const card = document.getElementById('dc-'+id);
  if(card) { card.style.opacity='0.4'; card.style.pointerEvents='none'; }
  await window._restoreLead(id);
  await window._loadLeads();
  showToast('Lead restored');
  refreshTrashBadge();
  await renderDeletedDrawer();
}

async function permanentDeleteLead(id, name) {
  if(!confirm(`Permanently delete "${name}"? This CANNOT be undone.`)) return;
  const card = document.getElementById('dc-'+id);
  if(card) { card.style.opacity='0.4'; card.style.pointerEvents='none'; }
  await window._permanentDeleteLead(id);
  showToast('Permanently deleted');
  refreshTrashBadge();
  await renderDeletedDrawer();
}

async function refreshTrashBadge() {
  try {
    const deleted = await window._loadDeletedLeads();
    const badge = document.getElementById('trashCountBadge');
    if(badge) {
      badge.textContent = deleted.length || '';
      badge.style.display = deleted.length ? 'flex' : 'none';
    }
  } catch(e) { console.warn('refreshTrashBadge:', e.message); }
}

// ─── Prospects toggle (April 2026) ───
// Flips the 'nbd_crm_show_prospects' localStorage flag and re-renders
// the kanban. When ON, raw unqualified knocks that auto-created leads
// with isProspect:true show up alongside real customers. When OFF
// (default), they're hidden to keep the kanban clean.
window.toggleProspectsView = function() {
  const current = localStorage.getItem('nbd_crm_show_prospects') === '1';
  if (current) {
    localStorage.removeItem('nbd_crm_show_prospects');
    if (typeof window.showToast === 'function') window.showToast('Prospects hidden', 'info');
  } else {
    localStorage.setItem('nbd_crm_show_prospects', '1');
    if (typeof window.showToast === 'function') window.showToast('Prospects visible', 'info');
  }
  renderLeads(window._leads, window._filteredLeads);
};

// ─── Promote a prospect to a full customer ───
// Strips the isProspect flag + bumps stage from 'prospect' to 'new'
// if that's the current stage. Called from the lead detail modal's
// "Promote to Customer" button (added in a separate edit) or
// programmatically after a photo is uploaded / phone is captured.
window.promoteProspect = async function(leadId) {
  if (!leadId) return;
  const lead = (window._leads || []).find(l => l.id === leadId);
  if (!lead) { if (typeof window.showToast === 'function') window.showToast('Lead not found', 'error'); return; }
  if (!lead.isProspect) { if (typeof window.showToast === 'function') window.showToast('Already a full customer', 'info'); return; }
  try {
    const leadRef = window.doc(window.db, 'leads', leadId);
    const patch = { isProspect: false, promotedAt: window.serverTimestamp(), updatedAt: window.serverTimestamp() };
    // If the lead is still sitting in 'prospect' pseudo-stage, bump
    // it to 'new' so the kanban has a real home for it.
    if ((lead.stage || '').toLowerCase() === 'prospect') patch.stage = 'new';
    await window.updateDoc(leadRef, patch);
    lead.isProspect = false;
    if (patch.stage) lead.stage = patch.stage;
    renderLeads(window._leads, window._filteredLeads);
    if (typeof window.showToast === 'function') window.showToast('✓ Promoted to customer', 'success');
  } catch (e) {
    console.error('promoteProspect failed:', e);
    if (typeof window.showToast === 'function') window.showToast('Failed to promote: ' + e.message, 'error');
  }
};

// Expose CRM functions to window for onclick handlers
window.openLeadModal = openLeadModal;
window.closeLeadModal = closeLeadModal;
window.saveLead = saveLead;
window.deleteLead = deleteLead;
window.editLead = editLead;
window.moveCard = moveCard;
// exportLeadsCSV is defined in tools.js
window.scrollToFollowUps = scrollToFollowUps;
window.kanbanFilter = kanbanFilter;
window.kanbanFilterDebounced = kanbanFilterDebounced;
window.clearCrmSearch = clearCrmSearch;
window.filterByStage = function(stageKey) {
  const _normalize = window.normalizeStage || (s => s);
  const filtered = (window._leads || []).filter(l => {
    const sk = l._stageKey || _normalize(l.stage || 'new');
    return sk === stageKey;
  });
  renderLeads(window._leads, filtered);
  const searchInput = document.getElementById('crmSearch');
  if (searchInput) { searchInput.value = ''; }
  const countSpan = document.getElementById('crmSearchCount');
  if (countSpan) countSpan.textContent = filtered.length + ' in stage';
};
window.restoreCrmSearch = restoreCrmSearch;
window.openDeletedDrawer = openDeletedDrawer;
window.closeDeletedDrawer = closeDeletedDrawer;
window.handleCardClick = handleCardClick;
window.cancelDeleteConfirm = cancelDeleteConfirm;
window.confirmDeleteLead = confirmDeleteLead;
// Bulk operations
window.toggleBulkMode = toggleBulkMode;
window.toggleCardSelection = toggleCardSelection;
window.clearBulkSelection = clearBulkSelection;
window.bulkMoveStage = bulkMoveStage;
window.bulkDelete = bulkDelete;
window.refreshTrashBadge = refreshTrashBadge;
// restoreLead and permanentlyDelete are defined in dashboard.html as _restoreLead and _permanentDeleteLead
window.restoreLead = (id) => window._restoreLead(id);
window.permanentlyDelete = (id) => window._permanentDeleteLead(id);
// Aliases for dashboard.html references
window.restoreDeletedLead = (id) => window._restoreLead(id);
window.permanentDeleteLead = (id) => window._permanentDeleteLead(id);

// ── Booking SMS from Kanban Card ─────────────────────
// ── Rep booking URL helper ─────────────────────
// Returns the Cal.com URL for the signed-in rep. Priority:
//   1. window._currentRep.calcomUsername (hydrated from users/{uid}
//      on auth state change — authoritative).
//   2. localStorage 'nbd_cal_settings' (legacy cache from older
//      versions of the app; kept so reps who haven't re-saved
//      still get a link).
//   3. Default nobigdeal/roof-inspection (Joe's pooled link).
// Usage:
//   const url = window._repBookingUrl();
// Exposed so any other surface (customer portal, email templates,
// notifications) can reuse the same resolution logic instead of
// re-implementing it.
window._repBookingUrl = function () {
  const rep = window._currentRep || {};
  const username = (rep.calcomUsername || '').trim();
  if (username) {
    const slug = (rep.calcomEventSlug || 'roof-inspection').trim();
    return 'https://cal.com/' + encodeURIComponent(username) + '/' + encodeURIComponent(slug);
  }
  // Legacy fallback
  try {
    const legacy = JSON.parse(localStorage.getItem('nbd_cal_settings') || '{}');
    if (legacy.username) {
      const slug = legacy.eventSlug || 'roof-inspection';
      return 'https://cal.com/' + encodeURIComponent(legacy.username) + '/' + encodeURIComponent(slug);
    }
  } catch (e) {}
  // House account
  return 'https://cal.com/nobigdeal/roof-inspection';
};

window.sendBookingSMS = function(leadId, phone, firstName) {
  const bookingUrl = window._repBookingUrl();
  const cleanPhone = (phone || '').replace(/\D/g, '');
  const body = encodeURIComponent(`Hey${firstName ? ' ' + firstName : ''}, this is Joe from No Big Deal Roofing! I'd love to set up a free roof inspection at your convenience. Pick a time that works for you here: ${bookingUrl}`);
  window.open(`sms:${cleanPhone}?body=${body}`, '_self');
};

// ── Follow-Up SMS Reminder ─────────────────────
// Quick SMS from notification or follow-up alert
window.sendFollowUpSMS = function(leadId) {
  const lead = (window._leads || []).find(l => l.id === leadId);
  if (!lead || !lead.phone) {
    if (typeof showToast === 'function') showToast('No phone number on file for this lead', 'error');
    return;
  }
  const firstName = lead.firstName || lead.fname || '';
  const cleanPhone = lead.phone.replace(/\D/g, '');
  const bookingUrl = window._repBookingUrl();
  const body = encodeURIComponent(
    `Hi${firstName ? ' ' + firstName : ''}, this is Joe from No Big Deal Home Solutions. Just following up on your project — wanted to check in and see if you have any questions. If you'd like to schedule a time to chat: ${bookingUrl}`
  );
  window.open(`sms:${cleanPhone}?body=${body}`, '_self');
};

