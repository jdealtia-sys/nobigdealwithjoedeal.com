/**
 * crm-portal-bridge.js — bulk operations, trash drawer, prospect
 * promote, and SMS helpers.
 *
 * Extracted from crm.js (Step 4b — 2026-05-16) as one of four
 * sibling modules. Load order is critical and locked in
 * dashboard.html:
 *
 *   leads → pipeline → snooze → portal-bridge → crm (shim)
 *
 * This file holds:
 *   - the NBDStore-backed bulk-selection model
 *     (getBulkSelected / updateBulkSelection / toggleBulkMode /
 *     exitBulkMode / toggleCardSelection / selectAllVisibleLeads /
 *     clearBulkSelection / updateBulkToolbar)
 *   - bulk actions (bulkMoveStage / bulkDelete / bulkAssignField
 *     and its bulkAssignCarrier / bulkAssignDamage /
 *     bulkAssignSource / bulkAssignJobType wrappers, bulkSnoozeLeads)
 *   - the writeBatch chunker (commitBulkLeadOp)
 *   - misc CRM helpers (restoreCrmSearch / scrollToFollowUps /
 *     isOverdue)
 *   - editLead / deleteLead + the delete-confirm modal helpers
 *   - the deleted-leads drawer (openDeletedDrawer /
 *     renderDeletedDrawer / restoreDeletedLead /
 *     permanentDeleteLead / refreshTrashBadge)
 *   - prospect surface (window.toggleProspectsView /
 *     window.promoteProspect)
 *   - booking-link + follow-up SMS helpers (window._repBookingUrl /
 *     window.sendBookingSMS / window.sendFollowUpSMS)
 *
 * "portal-bridge" in the module name refers to this file owning the
 * link between the CRM and the homeowner portal (sendBookingSMS /
 * _repBookingUrl) plus the bulk surface reps use to clean up batches
 * of leads before sending. It references the Firebase shim consts
 * (col, _serverTimestamp, …) declared in crm-leads.js as outer-
 * scope globals (classic-script sibling scope).
 */


// ═══════════════════════════════════════════════════════════════
// BULK ACTIONS SYSTEM
//
// Selection state lives at `leads.bulkSelected` in NBDStore (see
// docs/pro/js/state-store.js). The legacy `window._bulkSelected`
// global is mirrored read-only via store.bind so any older read
// site keeps working during migration. All writes go through
// updateBulkSelection() which swaps the Set ref to trigger
// subscriber notify (mutate-in-place would identity-equal and
// be silently ignored by the store).
//
// Bulk toolbar now refreshes via a store subscriber rather than
// every call site remembering to call updateBulkToolbar() — the
// pattern matches the photos.selected migration in PR #76.
// ═══════════════════════════════════════════════════════════════

window._bulkMode = false;
if (window.NBDStore) {
  window.NBDStore.set('leads.bulkSelected', new Set());
  window.NBDStore.bind('_bulkSelected', 'leads.bulkSelected');
  window.NBDStore.subscribe('leads.bulkSelected', function () {
    if (typeof updateBulkToolbar === 'function') updateBulkToolbar();
  });
} else {
  window._bulkSelected = window._bulkSelected || new Set();
}

function getBulkSelected() {
  return (window.NBDStore && window.NBDStore.get('leads.bulkSelected'))
    || window._bulkSelected
    || new Set();
}

function updateBulkSelection(mutate) {
  const prev = getBulkSelected();
  const next = new Set(prev);
  mutate(next);
  if (window.NBDStore) {
    window.NBDStore.set('leads.bulkSelected', next);
  } else {
    window._bulkSelected = next;
    if (typeof updateBulkToolbar === 'function') updateBulkToolbar();
  }
}

function toggleBulkMode() {
  window._bulkMode = !window._bulkMode;
  const btn = document.getElementById('bulkModeBtn');
  const kanbanBoard = document.querySelector('.kanban-board');

  if (window._bulkMode) {
    if (btn) { btn.textContent = 'Cancel'; btn.classList.add('btn-orange'); btn.classList.remove('btn-ghost'); }
    if (kanbanBoard) kanbanBoard.classList.add('bulk-mode-active');
  } else {
    if (btn) { btn.textContent = 'Select'; btn.classList.remove('btn-orange'); btn.classList.add('btn-ghost'); }
    if (kanbanBoard) kanbanBoard.classList.remove('bulk-mode-active');
    clearBulkSelection();
  }
}

// Force-exit bulk mode regardless of current state. Called on view changes
// so a bulk selection started on the kanban can't bleed into another view's
// click handlers.
function exitBulkMode() {
  if (!window._bulkMode) return;
  window._bulkMode = false;
  const btn = document.getElementById('bulkModeBtn');
  const kanbanBoard = document.querySelector('.kanban-board');
  if (btn) { btn.textContent = 'Select'; btn.classList.remove('btn-orange'); btn.classList.add('btn-ghost'); }
  if (kanbanBoard) kanbanBoard.classList.remove('bulk-mode-active');
  clearBulkSelection();
}
window.exitBulkMode = exitBulkMode;

function toggleCardSelection(leadId) {
  if (!window._bulkMode) return;

  const card = document.querySelector(`.k-card[data-id="${leadId}"]`);
  if (!card) return;

  const sel = getBulkSelected();
  const isSelectedNow = !sel.has(leadId);
  updateBulkSelection(function (next) {
    if (next.has(leadId)) next.delete(leadId);
    else next.add(leadId);
  });
  card.classList.toggle('bulk-selected', isSelectedNow);
  // updateBulkToolbar runs via store subscriber when NBDStore is
  // present; manual fallback otherwise.
  if (!window.NBDStore) updateBulkToolbar();
}

// Select every currently-rendered (visible) kanban card. Matches
// the kanban filter — anything filtered out via search/stage isn't
// in the DOM, so it isn't selected. Joe's most common need is "all
// cards in this column" or "all visible after filter".
function selectAllVisibleLeads() {
  if (!window._bulkMode) return;
  const cards = document.querySelectorAll('.kanban-board .k-card');
  if (!cards.length) {
    if (typeof showToast === 'function') showToast('No leads visible to select', 'info');
    return;
  }
  updateBulkSelection(function (next) {
    cards.forEach(function (c) {
      const id = c.dataset.id;
      if (id) next.add(id);
    });
  });
  cards.forEach(function (c) { c.classList.add('bulk-selected'); });
  if (!window.NBDStore) updateBulkToolbar();
}

function updateBulkToolbar() {
  const count = getBulkSelected().size;
  const toolbar = document.getElementById('bulkActionBar');
  const countSpan = document.getElementById('bulkSelectedCount');

  if (countSpan) countSpan.textContent = count + ' selected';

  if (!toolbar) return;
  if (count > 0) {
    toolbar.classList.add('active');
    toolbar.style.display = 'flex';
  } else {
    toolbar.classList.remove('active');
    toolbar.style.display = 'none';
  }
}

function clearBulkSelection() {
  updateBulkSelection(function (next) { next.clear(); });
  document.querySelectorAll('.k-card.bulk-selected').forEach(card => {
    card.classList.remove('bulk-selected');
  });
  if (!window.NBDStore) updateBulkToolbar();
}

async function bulkMoveStage() {
  const stageSelect = document.getElementById('bulkStageSelect');
  const newStage = stageSelect.value;

  if (!newStage) {
    showToast('Please select a stage', 'error');
    return;
  }

  // Wave 103: read selection through getBulkSelected() so the
  // NBDStore-backed selection is honored. Previously this read
  // `window._bulkSelected` directly, which becomes stale when the
  // store replaces the reference on every mutation. The guard
  // could pass with stale `.size === 0` while the store held a
  // real selection — bulk-move on zero cards or wrong cards.
  const sel = getBulkSelected();
  if (sel.size === 0) {
    showToast('No cards selected', 'error');
    return;
  }

  const _ask = window.nbdConfirm || ((m) => Promise.resolve(window.confirm(m)));
  if (!(await _ask(`Move ${sel.size} lead(s) to "${newStage}"?`))) {
    return;
  }

  const selectedIds = Array.from(sel);

  try {
    // Wave 103: collect failures separately so we can report
    // partial success accurately. Previously a mid-loop failure
    // jumped straight to the catch and the toast claimed all
    // moves succeeded — but the first N had committed and N+1
    // through M had not. Cards 1-N were silently in the new
    // stage, cards N+1 to M still in the old. No way for the
    // rep to know which.
    const failures = [];
    for (const leadId of selectedIds) {
      try { await moveCard(leadId, newStage); }
      catch (err) {
        console.warn('[bulkMoveStage] failed for', leadId, err);
        failures.push(leadId);
      }
    }

    // Clear selection and exit bulk mode regardless — partial
    // success still moved at least some cards, and re-trying the
    // failed ones via individual drag is the cleaner UX.
    clearBulkSelection();
    toggleBulkMode();

    const movedCount = selectedIds.length - failures.length;
    if (failures.length > 0) {
      showToast(`Moved ${movedCount}/${selectedIds.length}. ${failures.length} failed — try again.`, 'error');
    } else {
      showToast(`Moved ${movedCount} lead(s) to ${newStage}`, 'ok');
    }
    return; // skip the outer catch — we handled failures explicitly
    
  } catch (error) {
    console.error('Bulk move error:', error);
    showToast('Some moves failed. Please try again.', 'error');
  }
}

async function bulkDelete() {
  const selSet = getBulkSelected();
  if (selSet.size === 0) {
    showToast('No cards selected', 'error');
    return;
  }

  const _askDel = window.nbdConfirm || ((m) => Promise.resolve(window.confirm(m)));
  if (!(await _askDel(`Delete ${selSet.size} lead(s)? They will be moved to the trash.`))) {
    return;
  }

  const selectedIds = Array.from(selSet);

  // writeBatch is atomic + 1 round-trip vs N for a serial loop. Caps
  // at 500 ops per batch (Firestore hard limit). Joe's biggest manual
  // selection in practice is ~30, but the chunk loop is here for the
  // someday-flat-CSV-import case that sweeps a few hundred dupes.
  if (!window.writeBatch || !window.db || !window.doc) {
    showToast('Bulk delete unavailable — Firestore not loaded', 'error');
    return;
  }

  try {
    await commitBulkLeadOp(selectedIds, function (batch, ref) {
      batch.update(ref, { deleted: true, deletedAt: _serverTimestamp() });
    });

    await loadLeads();
    clearBulkSelection();
    toggleBulkMode();
    showToast(`Deleted ${selectedIds.length} lead(s)`, 'ok');
  } catch (error) {
    console.error('Bulk delete error:', error);
    showToast('Bulk delete failed: ' + (error && error.message || 'unknown error'), 'error');
  }
}

// Apply a single field write to every selected lead via writeBatch.
// Used by bulkAssignCarrier + bulkAssignDamage. Field allowlist is
// enforced so a future caller can't accidentally bulk-write
// privileged fields (companyId, role, isAdmin) — those are blocked
// by firestore.rules anyway, but a client-side allowlist gives a
// faster failure than a write that the rules silently reject for
// the entire batch.
// Wave 32: extended allowlist — source + jobType are common
// post-import cleanup ops, e.g. fixing 50 imported leads' source
// to "Spring Hailstorm" or routing all cash deals to the cash
// pipeline at once.
const BULK_LEAD_FIELDS = new Set(['carrier', 'damageType', 'followUp', 'tags', 'source', 'jobType']);

async function bulkAssignField(field, value, label) {
  if (!BULK_LEAD_FIELDS.has(field)) {
    console.error('Bulk field not allowlisted:', field);
    showToast('Bulk field not supported', 'error');
    return;
  }
  const selSet = getBulkSelected();
  if (selSet.size === 0) { showToast('No cards selected', 'error'); return; }

  const _askSet = window.nbdConfirm || ((m) => Promise.resolve(window.confirm(m)));
  if (!(await _askSet(`Set ${label || field} on ${selSet.size} lead(s) to "${value}"?`))) return;

  if (!window.writeBatch || !window.db || !window.doc) {
    showToast('Bulk update unavailable — Firestore not loaded', 'error');
    return;
  }

  const ids = Array.from(selSet);
  try {
    await commitBulkLeadOp(ids, function (batch, ref) {
      const patch = {};
      patch[field] = value;
      patch.updatedAt = _serverTimestamp();
      batch.update(ref, patch);
    });

    // Optimistic local state update so the kanban reflects without
    // a full reload.
    (window._leads || []).forEach(function (l) {
      if (selSet.has(l.id)) l[field] = value;
    });
    if (typeof renderLeads === 'function') {
      renderLeads(window._leads, window._filteredLeads);
    }

    clearBulkSelection();
    toggleBulkMode();
    showToast(`Updated ${ids.length} lead(s) → ${label || field}: ${value}`, 'ok');
  } catch (error) {
    console.error('Bulk assign error:', error);
    showToast('Bulk update failed: ' + (error && error.message || 'unknown error'), 'error');
  }
}

async function bulkAssignCarrier() {
  const sel = document.getElementById('bulkCarrierSelect');
  const value = sel && sel.value;
  if (!value) { showToast('Pick a carrier first', 'error'); return; }
  return bulkAssignField('carrier', value, 'Carrier');
}

async function bulkAssignDamage() {
  const sel = document.getElementById('bulkDamageSelect');
  const value = sel && sel.value;
  if (!value) { showToast('Pick a damage type first', 'error'); return; }
  return bulkAssignField('damageType', value, 'Damage');
}

// Wave 32: bulk-set source — useful after a CSV import where the
// source column was missing or mis-labeled (e.g. all imports come
// in tagged 'Unknown' and need to be re-classified to 'Spring
// Hailstorm Campaign' or similar).
async function bulkAssignSource() {
  const sel = document.getElementById('bulkSourceSelect');
  const customEl = document.getElementById('bulkSourceCustom');
  // Prefer an explicit free-text entry if the rep typed one. Lets
  // them tag a custom campaign without needing to add it to the
  // dropdown first.
  const custom = customEl && customEl.value.trim();
  const value = custom || (sel && sel.value);
  if (!value) { showToast('Pick or type a source first', 'error'); return; }
  return bulkAssignField('source', value, 'Source');
}

// Wave 32: bulk-set jobType — primary use is post-import routing
// (e.g. an export from a finance CRM comes in flat, all rows need
// to be flagged jobType:'finance' so the kanban view filter picks
// them up correctly).
async function bulkAssignJobType() {
  const sel = document.getElementById('bulkJobTypeSelect');
  const value = sel && sel.value;
  if (!value) { showToast('Pick a job type first', 'error'); return; }
  return bulkAssignField('jobType', value, 'Job Type');
}

// Wave 37: bulk-snooze. Hands selected lead IDs to LeadSnooze.bulkPrompt
// which handles the modal + writeBatch commit + cache patch + clear-
// bulk-selection. We just gather + delegate.
async function bulkSnoozeLeads() {
  const selSet = getBulkSelected();
  if (selSet.size === 0) { showToast('No cards selected', 'error'); return; }
  if (!window.LeadSnooze || typeof window.LeadSnooze.bulkPrompt !== 'function') {
    showToast('Snooze module not loaded — refresh and try again', 'error');
    return;
  }
  window.LeadSnooze.bulkPrompt(Array.from(selSet));
}

// Chunk a single Firestore writeBatch op across an arbitrary list of
// lead ids. Each chunk is committed independently — a network blip
// on chunk 2 leaves chunks 0-1 committed and the toast surfaces a
// partial-failure error. Joe's manual selections (~30) fit in one
// chunk; the loop is defense for someday-larger sweeps.
async function commitBulkLeadOp(ids, applyToBatch) {
  const CHUNK = 450; // Firestore hard limit is 500; leave headroom.
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const batch = window.writeBatch(window.db);
    for (const id of slice) {
      const ref = window.doc(window.db, 'leads', id);
      applyToBatch(batch, ref);
    }
    await batch.commit();
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
  // Repopulate sub-type options for this job type BEFORE setting the value
  if (typeof window.refreshSubTypeAndTrades === 'function') {
    window.refreshSubTypeAndTrades(l.jobType || '');
  }
  setV('lSubType', l.subType || '');
  // Restore selected trades on the chip UI
  if (typeof window.setSelectedTrades === 'function') {
    window.setSelectedTrades(Array.isArray(l.trades) ? l.trades : []);
  }
  setV('lSource',l.source||'Door Knock');
  setV('lDamageType',l.damageType||'');
  setV('lClaimStatus',l.claimStatus||'No Claim');
  setV('lJobValue',l.jobValue||'');
  setV('lFollowUp',l.followUp||'');
  setV('lInsCarrier',l.insCarrier||l.insuranceCarrier||'');
  // Insurance fields
  setV('lClaimNumber', l.claimNumber||'');
  setV('lClaimFiledBy', l.claimFiledBy||'');
  setV('lPolicyNumber', l.policyNumber||'');
  setV('lDateOfLoss', l.dateOfLoss||'');
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
  const _ask = window.nbdConfirm || ((m) => Promise.resolve(window.confirm(m)));
  if (!(await _ask(`Permanently delete "${name}"? This CANNOT be undone.`))) return;
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
