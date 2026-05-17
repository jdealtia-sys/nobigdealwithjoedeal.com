/**
 * crm-leads.js — lead CRUD: utilities, Firebase shim, lead modal,
 * saveLead.
 *
 * Extracted from crm.js (Step 4b — 2026-05-16) as one of four
 * sibling modules. Load order is critical and locked in
 * dashboard.html:
 *
 *   leads → pipeline → snooze → portal-bridge → crm (shim)
 *
 * This file is loaded FIRST so every later split module + the shim
 * can rely on:
 *   - escHtml + debounce (used by every render path)
 *   - the Firebase aliases (db, col, _addDoc, _updateDoc, _doc,
 *     _getDoc, _getDocs, _where, _orderBy, _query, _serverTimestamp,
 *     _arrayUnion) — declared ONCE here so later modules just read
 *     them as outer-scope globals (classic-script sibling scope)
 *   - openLeadModal / closeLeadModal / saveLead (window-exposed)
 *
 * LOAD-ORDER CONTRACT: crm-leads.js MUST load after the Firebase
 * ES-module script in the host page (dashboard.html / customer.html)
 * populates window.db, window.collection, etc. The _assertFirebaseLoaded
 * IIFE below fails loud at load time so misordered script tags show
 * up in the console immediately instead of as invisible "nothing
 * saved" bugs later.
 */

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

  // Email + phone validation. The native <input type="email"> validation
  // is bypassed when this function is called via the Save button's
  // onclick handler (no form submit), so we have to validate explicitly
  // before passing the data to _saveLead. Failing here means the rep
  // sees a clear inline error instead of the data silently writing
  // through and breaking the SMS/email-prefill flows downstream.
  const phoneEl = document.getElementById('lPhone');
  const emailEl = document.getElementById('lEmail');
  const phoneRaw = (phoneEl?.value || '').trim();
  const emailRaw = (emailEl?.value || '').trim();
  if (emailRaw) {
    // RFC-5322-lite — good enough to catch typos without rejecting valid edge cases.
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw);
    if (!emailOk) {
      mErr.textContent = 'Email looks invalid (e.g. name@example.com).';
      mErr.style.display = 'block';
      emailEl?.focus();
      return;
    }
  }
  if (phoneRaw) {
    // Accept any input with at least 10 digits. The display normalization
    // happens downstream — we just want to reject obvious junk.
    const digits = phoneRaw.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) {
      mErr.textContent = 'Phone needs at least 10 digits.';
      mErr.style.display = 'block';
      phoneEl?.focus();
      return;
    }
  }

  // Prevent double-submit
  if(saveBtn.disabled) return;
  saveBtn.disabled=true;
  const origText=saveBtn.textContent;
  saveBtn.textContent='Saving...';
  const intelData = window._modalIntel || {};
  // saveLead: proceed with save
  try {
    // Field reads below all use optional chaining; the 6 that previously
    // assumed `.value` directly (lLname/lPhone/lEmail/lStage/lSource/lNotes)
    // would null-deref if the lead-modal markup ever ships without one of
    // them. The entry guards on lines 139/143 cover the common case but
    // we make the field-level reads safe too for consistency with the
    // rest of the object literal.
    await window._saveLead({
      id: (document.getElementById('lEditId')?.value||undefined)||undefined,
      firstName: fname,
      lastName: document.getElementById('lLname')?.value?.trim() || '',
      address: addr,
      phone: document.getElementById('lPhone')?.value?.trim() || '',
      email: document.getElementById('lEmail')?.value?.trim() || '',
      stage: document.getElementById('lStage')?.value || '',
      jobType: document.getElementById('lJobType')?.value || '',
      subType: document.getElementById('lSubType')?.value || '',
      trades: (typeof window.getSelectedTrades === 'function') ? window.getSelectedTrades() : [],
      source: document.getElementById('lSource')?.value || '',
      damageType: document.getElementById('lDamageType')?.value||'',
      claimStatus: document.getElementById('lClaimStatus')?.value||'No Claim',
      jobValue: parseFloat(document.getElementById('lJobValue')?.value)||0,
      followUp: document.getElementById('lFollowUp')?.value||'',
      insCarrier: document.getElementById('lInsCarrier')?.value?.trim()||'',
      // Insurance fields
      claimNumber: document.getElementById('lClaimNumber')?.value?.trim()||'',
      claimFiledBy: document.getElementById('lClaimFiledBy')?.value||'',
      policyNumber: document.getElementById('lPolicyNumber')?.value?.trim()||'',
      dateOfLoss: document.getElementById('lDateOfLoss')?.value||'',
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
      notes: document.getElementById('lNotes')?.value?.trim() || '',
      yearBuilt:     intelData.yearBuilt   || null,
      marketValue:   intelData.marketValue || null,
      lastSaleDate:  intelData.lastSaleDate || null,
      lastSaleAmt:   intelData.lastSaleAmount || null,
      propertyType:  intelData.propertyType || null,
      parcelId:      intelData.parcelId || null,
      isLLC:         intelData.isLLC || false,
      homestead:     intelData.homestead || false,
      // Audit batch 11: stamp the parcel polygon when the Regrid lookup
      // returned one. photo-smart-ingest.js:getPropertyPolygon reads
      // `lead.parcel.geometry.coordinates` to power the photo-system
      // Phase 2 slope inference; without this the slope suggestion
      // falls back to heading-only mode.
      parcel:        intelData.parcelGeometry ? {
        geometry: intelData.parcelGeometry,
        center:   intelData.parcelCenter || null,
        source:   'regrid',
        fetchedAt: new Date().toISOString()
      } : null,
      // D2D knock linkage (set by convertToLeadWithEdit flow)
      d2dKnockId:    window._pendingD2DConvertId || null
    });
    window._modalIntel = null;
    // If this save came from a D2D conversion (Edit First flow), mark the knock as converted.
    // The lead was already saved successfully above — only the knock-side
    // bookkeeping is at risk here. We toast the rep so they know to remove
    // the duplicate knock manually if the conversion mark didn't land.
    if (window._pendingD2DConvertId) {
      try {
        if (window.updateDoc && window.doc && window._db) {
          await window.updateDoc(window.doc(window._db, 'knocks', window._pendingD2DConvertId), {
            convertedToLead: true,
            updatedAt: window.serverTimestamp()
          });
        }
        if (window.D2D?.renderD2D) window.D2D.renderD2D();
      } catch (d2dErr) {
        console.warn('Could not mark D2D knock as converted:', d2dErr);
        if (typeof showToast === 'function') {
          showToast('Lead saved, but the D2D knock didn’t flip to "converted". Remove the duplicate knock manually.', 'warning');
        }
      }
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
