// ============================================================
// NBD Pro — crm.js
// CRM: Lead modal, kanban render, card builder, kanban filter,
//      notifications, bulk operations, trash/restore, CSV export
// All functions use window globals (window._db, window._user, etc.)
// ============================================================

// ══════════════════════════════════════════════
// CRM
// ══════════════════════════════════════════════
// Firebase shim — aliases window globals for use in this file
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


function openLeadModal(){document.getElementById('leadModal').classList.add('open');}
function closeLeadModal(){
  document.getElementById('leadModal').classList.remove('open');
  document.getElementById('mErr').style.display='none';
  document.getElementById('mOk').style.display='none';
  ['lFname','lLname','lAddr','lPhone','lEmail','lNotes'].forEach(id=>document.getElementById(id).value='');

  const editId = document.getElementById('lEditId'); if(editId) editId.value='';
  const title = document.getElementById('leadModalTitle'); if(title) title.textContent='Add Lead';
  document.getElementById('lFname').value=''; document.getElementById('lLname').value='';
  document.getElementById('lAddr').value=''; document.getElementById('lPhone').value='';
  document.getElementById('lEmail').value=''; document.getElementById('lNotes').value='';
  document.getElementById('lJobValue').value=''; document.getElementById('lFollowUp').value='';
  document.getElementById('lInsCarrier').value='';
  window._modalIntel = null;
  const mir = document.getElementById('modalIntelResult');
  if(mir) { mir.classList.remove('visible'); mir.innerHTML=''; }
  const pib = document.getElementById('pullIntelBtn');
  if(pib) { pib.classList.remove('loading'); pib.innerHTML='🏠 Pull Property Intel'; }
}
document.getElementById('leadModal').addEventListener('click',e=>{if(e.target===document.getElementById('leadModal'))closeLeadModal();});
document.addEventListener('DOMContentLoaded',()=>{const tm=document.getElementById('taskModal');if(tm)tm.addEventListener('click',e=>{if(e.target===tm)closeTaskModal();});});

async function saveLead(){
  const mErr=document.getElementById('mErr'),mOk=document.getElementById('mOk');
  mErr.style.display='none';mOk.style.display='none';
  const fname=document.getElementById('lFname').value.trim();
  const addr=document.getElementById('lAddr').value.trim();
  if(!fname||!addr){mErr.textContent='Name and address required.';mErr.style.display='block';return;}
  document.querySelector('#leadModal .msave').disabled=true;
  const intelData = window._modalIntel || {};
  await window._saveLead({
    id: (document.getElementById('lEditId')?.value||undefined)||undefined,
    firstName: fname,
    lastName: document.getElementById('lLname').value.trim(),
    address: addr,
    phone: document.getElementById('lPhone').value.trim(),
    email: document.getElementById('lEmail').value.trim(),
    stage: document.getElementById('lStage').value,
    source: document.getElementById('lSource').value,
    damageType: document.getElementById('lDamageType')?.value||'',
    claimStatus: document.getElementById('lClaimStatus')?.value||'No Claim',
    jobValue: document.getElementById('lJobValue')?.value||0,
    followUp: document.getElementById('lFollowUp')?.value||'',
    insCarrier: document.getElementById('lInsCarrier')?.value?.trim()||'',
    notes: document.getElementById('lNotes').value.trim(),
    // Property intel fields
    yearBuilt:     intelData.yearBuilt   || null,
    marketValue:   intelData.marketValue || null,
    lastSaleDate:  intelData.lastSaleDate || null,
    lastSaleAmt:   intelData.lastSaleAmount || null,
    propertyType:  intelData.propertyType || null,
    parcelId:      intelData.parcelId || null,
    isLLC:         intelData.isLLC || false,
    homestead:     intelData.homestead || false
  });
  window._modalIntel = null;
  document.querySelector('#leadModal .msave').disabled=false;
  mOk.textContent='Lead saved!';mOk.style.display='block';
  setTimeout(closeLeadModal,800);
}


// ══════════════════════════════════════════════
// KANBAN CRM — renderLeads / drag-drop / filter
// ══════════════════════════════════════════════

function renderLeads(leads, filtered){
  const all   = (leads  || window._leads || []);
  const list  = (filtered !== undefined && filtered !== null) ? filtered : all;
  window._filteredLeads = (filtered !== undefined && filtered !== null) ? filtered : null;

  // ── stat helpers ──
  const setEl = (id,v)=>{ const e=document.getElementById(id); if(e) e.textContent=v; };

  // Revenue calcs
  let pipeVal=0, closedRev=0, approvedCount=0;
  all.forEach(l=>{
    const v=parseFloat(l.jobValue||0);
    if(!['Lost'].includes(l.stage||'New')) pipeVal+=v;
    if(['Approved','In Progress','Complete'].includes(l.stage||'')) closedRev+=v;
    if((l.stage||'')==='Approved') approvedCount++;
  });
  setEl('crmTotalLeads', all.length);
  setEl('crmPipeVal',    '$'+pipeVal.toLocaleString());
  setEl('crmApproved',  approvedCount);
  setEl('crmClosedRev', '$'+closedRev.toLocaleString());
  setEl('crmSubLine',   all.length+' leads · $'+pipeVal.toLocaleString()+' pipeline');
  // dashboard cards
  setEl('statLeads', all.length);
  setEl('statVal',   '$'+pipeVal.toLocaleString());
  setEl('statClosed','$'+closedRev.toLocaleString());
  const lb=document.getElementById('leadBadge'); if(lb) lb.textContent=all.length;

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
      `✅ Click "Load Sample Data" to add 5 test leads`
    ];
    diagnosticDetails.textContent = details.join('\n');
    diagnostic.style.display = 'block';
  } else if (diagnostic) {
    diagnostic.style.display = 'none';
  }

  // Follow-up overdue
  const today=new Date(); today.setHours(0,0,0,0);
  const overdue = all.filter(l=>{
    if(!l.followUp||['Complete','Lost'].includes(l.stage||'')) return false;
    const d=new Date(l.followUp); d.setHours(0,0,0,0); return d<=today;
  });
  setEl('crmFollowUps', overdue.length);
  const fp=document.getElementById('followUpPill');
  if(fp) fp.style.display = overdue.length ? 'flex':'none';
  const alertBox=document.getElementById('followUpAlerts');
  if(alertBox){
    if(overdue.length){
      alertBox.style.display='block';
      alertBox.innerHTML=overdue.slice(0,5).map(l=>`
        <div class="follow-up-alert">
          <span>📅</span>
          <span class="fa-name">${l.firstName||''} ${l.lastName||''}</span>
          <span style="color:var(--m);font-size:11px;">${(l.address||'').split(',')[0]}</span>
          <span class="fa-date">Due: ${l.followUp}</span>
          <button class="fa-btn" onclick="editLead('${l.id}')">View →</button>
        </div>`).join('');
    } else { alertBox.style.display='none'; }
  }

  // ── Build kanban columns ──
  const byStage = {};
  const STAGES = window.STAGES || ['New','Inspected','Estimate Sent','Approved','In Progress','Complete','Lost'];
  STAGES.forEach(s=>byStage[s]=[]);
  list.forEach(l=>{ const s=l.stage||'New'; if(byStage[s]) byStage[s].push(l); else byStage['New'].push(l); });

  STAGES.forEach(stage=>{
    const body  = document.getElementById('kbody-'+stage);
    const count = document.getElementById('kcount-'+stage);
    if(!body) return;
    const cards = byStage[stage]||[];
    if(count) count.textContent = cards.length;
    if(!cards.length){ body.innerHTML='<div class="k-empty">No leads</div>'; return; }
    body.innerHTML = cards.map(l=>buildCard(l)).join('');
    // attach drag events to cards
    body.querySelectorAll('.k-card').forEach(card=>{
      card.addEventListener('dragstart', e=>{ _dragId=card.dataset.id; card.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', card.dataset.id); });
      card.addEventListener('dragend',   e=>{ card.classList.remove('dragging'); });
    });
    // attach drop handlers to kanban column body
    body.addEventListener('dragover', e=>{
      e.preventDefault();
      e.dataTransfer.dropEffect='move';
      body.classList.add('drag-over');
    });
    body.addEventListener('dragleave', e=>{
      if(e.target===body) body.classList.remove('drag-over');
    });
    body.addEventListener('drop', e=>{
      e.preventDefault();
      body.classList.remove('drag-over');
      if(!_dragId) return;
      moveCard(_dragId, stage);
      _dragId=null;
    });
  });
}

function buildCard(l){
  const name  = ((l.firstName||l.fname||'')+'  '+(l.lastName||l.lname||'')).trim() || l.name||'Unknown';
  const addr  = (l.address||'').split(',').slice(0,2).join(',');
  const val   = l.jobValue ? '$'+parseFloat(l.jobValue).toLocaleString() : '';
  const today = new Date(); today.setHours(0,0,0,0);
  const overdue = l.followUp && new Date(l.followUp)<=today && !['Complete','Lost'].includes(l.stage||'');
  const stageIdx = STAGES.indexOf(l.stage||'New');
  const prevS = stageIdx>0 ? STAGES[stageIdx-1] : null;
  const nextS = stageIdx<STAGES.length-1 ? STAGES[stageIdx+1] : null;

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
  if(totalT && overdueT){ taskBadgeClass += ' has-overdue'; taskBadgeLabel = `⚠ ${overdueT} overdue`; }
  else if(totalT && doneT===totalT) { 
    taskBadgeClass += ' all-done'; 
    taskBadgeLabel = `✓ 100%`;
  }
  else if(totalT && completionRate >= 50) {
    taskBadgeClass += ' has-tasks';
    taskBadgeLabel = `☑ ${doneT}/${totalT} (${completionRate}%)`;
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

  // Photo thumbnails (from cache)
  const photos = window._photoCache?.[l.id] || [];
  const photoHTML = photos.length ? `<div class="kc-photos">
    ${photos.slice(0,3).map(p=>`<img class="kc-photo-thumb" src="${p.url}" onclick="openPhotoFor('${l.id}','${(l.address||'').replace(/'/g,'&#39;')}')" loading="lazy">`).join('')}
    ${photos.length > 3 ? `<div class="kc-photo-more" onclick="openPhotoFor('${l.id}','${(l.address||'').replace(/'/g,'&#39;')}')">+${photos.length-3}</div>` : ''}
  </div>` : '';

  // Roof age
  const roofBadge = (()=>{
    if(!l.yearBuilt) return '';
    const age = new Date().getFullYear() - parseInt(l.yearBuilt);
    const cls = age<10?'kct-roof-new':age<20?'kct-roof-mid':age<30?'kct-roof-old':'kct-roof-ancient';
    return `<span class="kc-tag kct-roof ${cls}">🏠 ${age}yr</span>`;
  })();

  const phone = l.phone||'';
  const email = l.email||'';
  const carrier = l.insCarrier||l.insuranceCarrier||'';
  const claimNum = l.claimNumber||l.claimNum||'';
  const claimStatus = l.claimStatus||'';
  
  // Count badges for estimates and photos
  const estimates = (window._estimates || []).filter(e => e.leadId === l.id);
  const estCount = estimates.length;
  const photoCount = photos.length;

  // Sync status indicators
  const syncClass = l._syncing ? 'k-card-syncing' : (l._syncSuccess ? 'k-card-sync-success' : (l._syncError ? 'k-card-sync-error' : ''));
  const syncIndicator = l._syncing ? '<div class="k-card-sync-icon">⏳</div>' : 
                        l._syncSuccess ? '<div class="k-card-sync-icon">✓</div>' : 
                        l._syncError ? '<div class="k-card-sync-icon">⚠️</div>' : '';

  let html = `<div class="k-card" draggable="true" data-id="${l.id}" onclick="handleCardClick('${l.id}',event)">
    <div class="k-card-checkbox" onclick="event.stopPropagation();toggleCardSelection('${l.id}')">
      <span class="k-card-checkbox-icon">✓</span>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      ${val ? `<div class="kc-val-badge">${val}</div>` : '<div></div>'}
      <div style="display:flex;gap:4px;">
        ${estCount > 0 ? `<span style="font-size:10px;background:var(--s3);border:1px solid var(--br);border-radius:10px;padding:2px 6px;color:var(--gold);">📋 ${estCount}</span>` : ''}
        ${photoCount > 0 ? `<span style="font-size:10px;background:var(--s3);border:1px solid var(--br);border-radius:10px;padding:2px 6px;color:var(--blue);">📸 ${photoCount}</span>` : ''}
      </div>
    </div>
    <div class="kc-name">${name}</div>
    ${addr ? `<div class="kc-addr" title="${l.address||''}">${addr}</div>` : ''}
    ${phone ? `<div class="kc-phone-row">
      <a class="kc-phone-link" href="tel:${phone.replace(/\D/g,'')}" onclick="event.stopPropagation()">📞 ${phone}</a>
      ${daysLabel ? `<span class="kc-days ${daysClass}" style="margin-left:auto;">${daysLabel}</span>` : ''}
    </div>` : (daysLabel ? `<div style="text-align:right;margin-bottom:4px;"><span class="kc-days ${daysClass}">${daysLabel}</span></div>` : '')}
    ${email ? `<div class="kc-email-line" title="${email}">✉ ${email}</div>` : ''}
    ${carrier || claimStatus !== 'No Claim' ? `<div class="kc-ins-row">
      ${carrier ? `<span class="kc-carrier">${carrier}</span>` : ''}
      ${claimStatus && claimStatus!=='No Claim' ? `<span class="kc-tag kct-claim">${claimStatus}</span>` : ''}
      ${claimNum ? `<span class="kc-claim-num">#${claimNum}</span>` : ''}
    </div>` : ''}
    ${photoHTML}
    <div class="kc-tags">
      ${l.damageType ? `<span class="kc-tag kct-dmg">${l.damageType}</span>` : ''}
      ${overdue      ? `<span class="kc-tag kct-due">⚠ Due</span>` : ''}
      ${roofBadge}
    </div>
    <div class="kc-footer">
      <button class="${taskBadgeClass}" onclick="openTaskModal('${l.id}',event)">${taskBadgeLabel}</button>
      <div class="kc-actions">
        <div class="kc-move">
          ${prevS ? `<button class="kc-arrow" title="← ${prevS}" onclick="event.stopPropagation();moveCard('${l.id}','${prevS}')">◀</button>` : '<span style="width:18px;"></span>'}
          ${nextS ? `<button class="kc-arrow" title="→ ${nextS}" onclick="event.stopPropagation();moveCard('${l.id}','${nextS}')">▶</button>` : '<span style="width:18px;"></span>'}
        </div>
        <button class="kc-btn edit" onclick="event.stopPropagation();editLead('${l.id}')">✏️</button>
        <button class="kc-btn del"  onclick="event.stopPropagation();deleteLead('${l.id}')">🗑</button>
      </div>
    </div>
  </div>`;

  // Apply search highlighting to the card HTML
  if(window._searchQuery && window._searchQuery.length >= 2){
    const sq = window._searchQuery;
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

async function moveCard(id, newStage){
  const lead = (window._leads||[]).find(l=>l.id===id);
  if(!lead) return;
  
  const oldStage = lead.stage || 'New';
  
  // ══════════════════════════════════════════════
  // OPTIMISTIC UPDATE — Update UI immediately
  // ══════════════════════════════════════════════
  lead.stage = newStage;
  
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
  
  try {
    // Save to Firebase in background
    const leadRef = window.doc(window.db, 'leads', id);
    await window.updateDoc(leadRef, {
      stage: newStage,
      updatedAt: window.serverTimestamp(),
      stageHistory: window.arrayUnion(historyEvent)
    });
    
    // Update local state with history
    if(!lead.stageHistory) lead.stageHistory = [];
    lead.stageHistory.push(historyEvent);
    
    // Mark as synced
    lead._syncing = false;
    lead._syncSuccess = true;
    
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
    lead._syncing = false;
    lead._syncError = true;
    
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
    
    // Load notifications from Firestore
    const {getDocs: _getDocs, query: _query, collection: _col, where: _where, orderBy: _order, limit: _limit} =
      await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    const notifSnap = await _getDocs(
      _query(
        _col(_db, 'notifications'),
        _where('userId', '==', user.uid),
        _order('createdAt', 'desc'),
        _limit(20)
      )
    );
    
    window._notifications = notifSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // Count unread
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

function renderNotifications() {
  const list = document.getElementById('notifList');
  if (!list) return;
  
  // Count unread notifications
  const unreadCount = window._notifications.filter(n => !n.read).length;
  
  // Show/hide "Mark all read" button based on unread count
  const markAllBtn = document.querySelector('[onclick="markAllNotificationsRead()"]');
  if (markAllBtn) {
    markAllBtn.style.display = unreadCount > 0 ? 'inline-block' : 'none';
  }
  
  if (window._notifications.length === 0) {
    list.innerHTML = `
      <div style="padding:40px 20px;text-align:center;color:var(--m);">
        <div style="font-size:32px;margin-bottom:8px;opacity:0.5;">🔔</div>
        <div style="font-size:13px;">No notifications yet</div>
      </div>
    `;
    return;
  }
  
  const html = window._notifications.map(n => {
    const isUnread = !n.read;
    const timestamp = n.createdAt?.toDate ? n.createdAt.toDate() : new Date(n.createdAt || Date.now());
    const timeAgo = getTimeAgo(timestamp);
    
    const iconMap = {
      'task_due': '⏰',
      'task_overdue': '⚠️',
      'estimate_approved': '✅',
      'stage_change': '🔄',
      'follow_up': '📅',
      'new_lead': '👤',
      'default': '🔔'
    };
    
    const icon = iconMap[n.type] || iconMap.default;
    
    return `
      <div style="padding:12px 14px;border-bottom:1px solid var(--br);cursor:pointer;transition:background .15s;${isUnread ? 'background:var(--og);' : ''}" 
           onclick="markNotificationRead('${n.id}')"
           onmouseenter="this.style.background='var(--s2)'"
           onmouseleave="this.style.background='${isUnread ? 'var(--og)' : ''}'">
        <div style="display:flex;gap:10px;align-items:start;">
          <div style="font-size:20px;flex-shrink:0;">${icon}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:${isUnread ? '600' : '400'};margin-bottom:4px;color:var(--t);">
              ${n.title || 'Notification'}
            </div>
            <div style="font-size:12px;color:var(--m);margin-bottom:4px;line-height:1.4;">
              ${n.message || ''}
            </div>
            <div style="font-size:10px;color:var(--m);opacity:0.8;">
              ${timeAgo}
            </div>
          </div>
          ${isUnread ? `<div style="width:8px;height:8px;background:var(--orange);border-radius:50%;flex-shrink:0;margin-top:4px;"></div>` : ''}
        </div>
      </div>
    `;
  }).join('');
  
  list.innerHTML = html;
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

async function markNotificationRead(notifId) {
  try {
    await _updateDoc(_doc(window.db, 'notifications', notifId), {
      read: true,
      readAt: _serverTimestamp()
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

async function markAllNotificationsRead() {
  try {
    const unread = window._notifications.filter(n => !n.read);
    
    await Promise.all(unread.map(n => 
      _updateDoc(_doc(window.db, 'notifications', n.id), {
        read: true,
        readAt: _serverTimestamp()
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
    await _addDoc(col(window.db, 'notifications'), {
      userId: userId,
      type: type,
      title: title,
      message: message,
      leadId: leadId,
      read: false,
      createdAt: _serverTimestamp()
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
      title: `⚠️ Overdue Follow-Up — ${name}`,
      message: `${daysLate} day${daysLate!==1?'s':''} overdue${l.address ? ' · ' + l.address.split(',')[0] : ''}. ${l.stage ? 'Stage: ' + l.stage : ''}`,
      priority: 'high', read: false
    });
  });

  dueToday.forEach(l => {
    if (existingKeys.has(l.id)) return;
    const name = `${l.firstName||''} ${l.lastName||''}`.trim() || (l.address||'').split(',')[0] || 'Lead';
    toCreate.push({
      userId, type: 'follow_up', leadId: l.id, dateKey: todayKey,
      title: `📅 Follow-Up Today — ${name}`,
      message: `${l.address ? l.address.split(',')[0] + ' · ' : ''}${l.stage ? 'Stage: ' + l.stage : ''}${l.insCarrier ? ' · ' + l.insCarrier : ''}`,
      priority: 'normal', read: false
    });
  });

  dueTomorrow.forEach(l => {
    if (existingKeys.has(l.id)) return;
    const name = `${l.firstName||''} ${l.lastName||''}`.trim() || (l.address||'').split(',')[0] || 'Lead';
    toCreate.push({
      userId, type: 'follow_up', leadId: l.id, dateKey: todayKey,
      title: `🔔 Follow-Up Tomorrow — ${name}`,
      message: `${l.address ? l.address.split(',')[0] + ' · ' : ''}${l.stage ? 'Stage: ' + l.stage : ''}`,
      priority: 'low', read: false
    });
  });

  if (!toCreate.length) return;

  // Write to Firestore
  try {
    await Promise.all(toCreate.map(n =>
      _addDoc(col(window.db, 'notifications'), {
        ...n,
        createdAt: _serverTimestamp()
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

// Request browser notification permission on first load (once)
async function requestNotifPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}
// ══ END FOLLOW-UP NOTIFICATION ENGINE ═════════════════════════════════

// Load notifications on auth - poll for window._user set by main auth callback
(function waitForNotifAuth() {
  if (window._user) {
    loadNotifications();
    setInterval(loadNotifications, 120000);
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
    btn.textContent = '✕ Cancel';
    btn.classList.add('btn-orange');
    btn.classList.remove('btn-ghost');
    kanbanBoard.classList.add('bulk-mode-active');
  } else {
    btn.textContent = '☑ Select';
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
  
  if (countSpan) countSpan.textContent = count;
  
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
    alert('Please select a stage');
    return;
  }
  
  if (window._bulkSelected.size === 0) {
    alert('No cards selected');
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
    alert('No cards selected');
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

// Export CSV
function exportLeadsCSV(){
  const leads=window._leads||[];
  if(!leads.length){ showToast('No leads to export','error'); return; }
  const headers=['First','Last','Address','Phone','Email','Stage','Damage','Claim','Value','Follow-Up','Carrier','Source','Notes'];
  const rows=leads.map(l=>[
    l.firstName||'',l.lastName||'',l.address||'',l.phone||'',l.email||'',
    l.stage||'',l.damageType||'',l.claimStatus||'',l.jobValue||'',
    l.followUp||'',l.insCarrier||'',l.source||'',(l.notes||'').replace(/,/g,';')
  ]);
  const csv=[headers,...rows].map(r=>r.map(v=>`"${v}"`).join(',')).join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download='nbd-leads-'+new Date().toISOString().slice(0,10)+'.csv';
  a.click(); showToast('CSV exported!','ok');
}

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
  setV('lStage',l.stage||'New');
  setV('lSource',l.source||'Door Knock');
  setV('lDamageType',l.damageType||'');
  setV('lClaimStatus',l.claimStatus||'No Claim');
  setV('lJobValue',l.jobValue||'');
  setV('lFollowUp',l.followUp||'');
  setV('lInsCarrier',l.insCarrier||'');
  setV('lNotes',l.notes||'');
  const editId=document.getElementById('lEditId'); if(editId) editId.value=id;
  const title=document.getElementById('leadModalTitle'); if(title) title.textContent='Edit Lead';
  openLeadModal();
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
  document.getElementById('delConfirmName').textContent = name;
  document.getElementById('delConfirmOverlay').classList.add('open');
}

function cancelDeleteConfirm() {
  _pendingDeleteId = null;
  document.getElementById('delConfirmOverlay').classList.remove('open');
}

async function confirmDeleteLead() {
  if(!_pendingDeleteId) return;
  const id = _pendingDeleteId;
  document.getElementById('delConfirmOverlay').classList.remove('open');
  _pendingDeleteId = null;
  try {
    await window._deleteLead(id);
    showToast('Lead moved to Deleted bin');
    refreshTrashBadge();
  } catch(e) { showToast('Delete failed','error'); }
}

// ── DELETED LEADS DRAWER ─────────────────────
async function openDeletedDrawer() {
  document.getElementById('deletedDrawer').classList.add('open');
  await renderDeletedDrawer();
}
function closeDeletedDrawer() {
  document.getElementById('deletedDrawer').classList.remove('open');
}

async function renderDeletedDrawer() {
  const body = document.getElementById('deletedDrawerBody');
  body.innerHTML = '<div class="deleted-empty">Loading...</div>';
  const deleted = await window._loadDeletedLeads();
  if(!deleted.length) {
    body.innerHTML = '<div class="deleted-empty">🎉 No deleted leads — all clear.</div>';
    return;
  }
  body.innerHTML = deleted.map(l => {
    const name = ((l.firstName||'')+' '+(l.lastName||'')).trim() || l.address || 'Lead';
    const addr = (l.address||'').split(',').slice(0,2).join(',');
    const deletedDate = l.deletedAt?.toDate ? l.deletedAt.toDate().toLocaleDateString() : 'Recently';
    const val = l.jobValue ? ' · $'+parseFloat(l.jobValue).toLocaleString() : '';
    return `<div class="deleted-card" id="dc-${l.id}">
      <div class="deleted-card-name">${name}</div>
      <div class="deleted-card-addr">${addr}</div>
      <div class="deleted-card-meta">Stage: ${l.stage||'New'}${val} · Deleted ${deletedDate}</div>
      <div class="deleted-card-btns">
        <button class="dc-restore" onclick="restoreDeletedLead('${l.id}')">↩ Restore</button>
        <button class="dc-perm" onclick="permanentDeleteLead('${l.id}','${name.replace(/'/g,'&#39;')}')">✕ Remove Forever</button>
      </div>
    </div>`;
  }).join('');
}

async function restoreDeletedLead(id) {
  const card = document.getElementById('dc-'+id);
  if(card) { card.style.opacity='0.4'; card.style.pointerEvents='none'; }
  await window._restoreLead(id);
  await window._loadLeads();
  showToast('Lead restored ✓');
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
  } catch(e) {}
}

// Expose CRM functions to window for onclick handlers
window.openLeadModal = openLeadModal;
window.closeLeadModal = closeLeadModal;
window.saveLead = saveLead;
window.deleteLead = deleteLead;
window.editLead = editLead;
window.moveCard = moveCard;
window.exportLeadsCSV = exportLeadsCSV;
window.scrollToFollowUps = scrollToFollowUps;
window.kanbanFilter = kanbanFilter;
window.clearCrmSearch = clearCrmSearch;
window.restoreCrmSearch = restoreCrmSearch;
window.openDeletedDrawer = openDeletedDrawer;
window.closeDeletedDrawer = closeDeletedDrawer;
window.handleCardClick = handleCardClick;
window.cancelDeleteConfirm = cancelDeleteConfirm;
window.confirmDeleteLead = confirmDeleteLead;
// restoreLead and permanentlyDelete are defined in dashboard.html as _restoreLead and _permanentDeleteLead
window.restoreLead = (id) => window._restoreLead(id);
window.permanentlyDelete = (id) => window._permanentDeleteLead(id);
// Aliases for dashboard.html references
window.restoreDeletedLead = (id) => window._restoreLead(id);
window.permanentDeleteLead = (id) => window._permanentDeleteLead(id);


