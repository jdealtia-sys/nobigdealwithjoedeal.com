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
document.getElementById('leadModal').addEventListener('click',e=>{if(e.target===document.getElementById('leadModal'))closeLeadModal();});
document.addEventListener('DOMContentLoaded',()=>{const tm=document.getElementById('taskModal');if(tm)tm.addEventListener('click',e=>{if(e.target===tm)closeTaskModal();});});

async function saveLead(){
  const mErr=document.getElementById('mErr'),mOk=document.getElementById('mOk');
  const saveBtn=document.querySelector('#leadModal .msave');
  mErr.style.display='none';mOk.style.display='none';
  const fname=document.getElementById('lFname').value.trim();
  const addr=document.getElementById('lAddr').value.trim();
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
  const list  = (filtered !== undefined && filtered !== null) ? filtered : all;
  window._filteredLeads = (filtered !== undefined && filtered !== null) ? filtered : null;

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
  const alertBox=document.getElementById('followUpAlerts');
  if(alertBox){
    if(overdue.length){
      alertBox.style.display='block';
      alertBox.innerHTML=overdue.slice(0,5).map(l=>`
        <div class="follow-up-alert">
          <span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;vertical-align:middle;"><rect x="3" y="4" width="14" height="13" rx="1.5"/><path d="M3 8h14"/><path d="M7 2v4M13 2v4"/></svg></span>
          <span class="fa-name">${l.firstName||''} ${l.lastName||''}</span>
          <span style="color:var(--m);font-size:11px;">${(l.address||'').split(',')[0]}</span>
          <span class="fa-date">Due: ${l.followUp}</span>
          <button class="fa-btn" onclick="editLead('${l.id}')">View →</button>
        </div>`).join('');
    } else { alertBox.style.display='none'; }
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

  let html = `<div class="k-card" draggable="true" data-id="${l.id}" onclick="handleCardClick('${l.id}',event)">
    <div class="k-card-checkbox" onclick="event.stopPropagation();toggleCardSelection('${l.id}')">
      <span class="k-card-checkbox-icon"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><path d="M4 10.5l4 4 8-9"/></svg></span>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <div style="display:flex;align-items:center;gap:4px;">${val ? `<div class="kc-val-badge">${val}</div>` : ''}${window.LeadScoring?.badge ? window.LeadScoring.badge(l) : ''}</div>
      <div style="display:flex;gap:4px;">
        ${estCount > 0 ? `<span style="font-size:10px;background:var(--s3);border:1px solid var(--br);border-radius:10px;padding:2px 6px;color:var(--gold);"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><rect x="4" y="3" width="12" height="14" rx="1.5"/><path d="M7 3V1.5h6V3"/><path d="M7 8h6M7 11h4"/></svg> ${estCount}</span>` : ''}
        ${photoCount > 0 ? `<span style="font-size:10px;background:var(--s3);border:1px solid var(--br);border-radius:10px;padding:2px 6px;color:var(--blue);"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><rect x="2" y="6" width="16" height="11" rx="1.5"/><circle cx="10" cy="11" r="3"/><path d="M7 6l1-3h4l1 3"/></svg> ${photoCount}</span>` : ''}
      </div>
    </div>
    <div class="kc-name">${name}${l.customerId ? ` <span style="font-family:monospace;font-size:10px;font-weight:600;color:var(--orange,#C8541A);opacity:.8;margin-left:4px;">${escHtml(l.customerId)}</span>` : ''}</div>
    ${addr ? `<div class="kc-addr" title="${l.address||''}">${addr}</div>` : ''}
    ${phone ? `<div class="kc-phone-row">
      <a class="kc-phone-link" href="tel:${phone.replace(/\D/g,'')}" onclick="event.stopPropagation()"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><path d="M4 3h3l2 4-2.5 1.5A9 9 0 0011.5 13.5L13 11l4 2v3a1 1 0 01-1 1C8.4 17 3 11.6 3 4a1 1 0 011-1z"/></svg> ${phone}</a>
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
      ${l.damageType ? `<span class="kc-tag kct-dmg">${l.damageType}</span>` : ''}
      ${overdue      ? `<span class="kc-tag kct-due"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><path d="M10 3L2 17h16L10 3z"/><path d="M10 8v4M10 14.5v.5"/></svg> Due</span>` : ''}
      ${roofBadge}
    </div>
    <div class="kc-footer">
      <button class="${taskBadgeClass}" onclick="openTaskModal('${l.id}',event)">${taskBadgeLabel}</button>
      <div class="kc-actions">
        <div class="kc-move">
          ${prevS ? `<button class="kc-arrow" title="← ${prevLabel}" onclick="event.stopPropagation();moveCard('${l.id}','${prevS}')">◀</button>` : '<span style="width:18px;"></span>'}
          ${nextS ? `<button class="kc-arrow" title="→ ${nextLabel}" onclick="event.stopPropagation();moveCard('${l.id}','${nextS}')">▶</button>` : '<span style="width:18px;"></span>'}
        </div>
        ${['new','contacted','inspected'].includes(_sk) && phone ? `<button class="kc-btn" title="Send booking link via SMS" onclick="event.stopPropagation();sendBookingSMS('${l.id}','${phone.replace(/'/g,'&#39;')}','${nameRaw.replace(/'/g,'&#39;').split(' ')[0]}')"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;"><rect x="3" y="4" width="14" height="13" rx="1.5"/><path d="M3 8h14"/><path d="M7 2v4M13 2v4"/></svg></button>` : ''}
        ${email ? `<button class="kc-btn" title="Email" onclick="event.stopPropagation();if(typeof emailByStage==='function')emailByStage('${l.id}');else if(typeof window.emailByStage==='function')window.emailByStage('${l.id}');"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;"><rect x="2" y="4" width="16" height="12" rx="1.5"/><path d="M2 6l8 5 8-5"/></svg></button>` : ''}
        <button class="kc-btn edit" onclick="event.stopPropagation();editLead('${l.id}')"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;"><path d="M12.5 3.5l4 4L7 17H3v-4l9.5-9.5z"/></svg></button>
        <button class="kc-btn del"  onclick="event.stopPropagation();deleteLead('${l.id}')"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;"><path d="M5 5h10l-1 12H6L5 5z"/><path d="M3 5h14"/><path d="M8 5V3h4v2"/></svg></button>
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
  // Prevent concurrent moves on the same card
  if(lead._pending){ if(typeof showToast==='function') showToast('Move in progress...','info'); return; }
  lead._pending = true;

  const oldStage = lead.stage || 'New';
  const oldStageKey = lead._stageKey || oldStage;

  // ══════════════════════════════════════════════
  // OPTIMISTIC UPDATE — Update UI immediately
  // ══════════════════════════════════════════════
  lead.stage = newStage;
  lead._stageKey = window.normalizeStage ? window.normalizeStage(newStage) : newStage;
  
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

  return `
    <div style="padding:10px 14px;border-bottom:1px solid var(--br);cursor:pointer;transition:background .15s;${isUnread && !isDismissed ? 'background:var(--og);' : ''}${isDismissed ? 'opacity:0.65;' : ''}"
         onclick="notifAction('${n.id}','${n.leadId||''}',${isDismissed})"
         onmouseenter="this.style.background='var(--s2)'"
         onmouseleave="this.style.background='${isUnread && !isDismissed ? 'var(--og)' : ''}'">
      <div style="display:flex;gap:10px;align-items:start;">
        <div style="font-size:20px;flex-shrink:0;">${icon}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:${isUnread ? '600' : '400'};margin-bottom:3px;color:var(--t);">
            ${n.title || 'Notification'}
          </div>
          <div style="font-size:12px;color:var(--m);margin-bottom:3px;line-height:1.4;">
            ${n.message || ''}
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:10px;color:var(--m);opacity:0.8;">${timeAgo}</span>
            ${hasLead && !isDismissed ? `<span style="font-size:9px;color:var(--blue);font-weight:600;letter-spacing:.03em;">→ VIEW LEAD</span>` : ''}
            ${hasLead && !isDismissed && (n.type === 'follow_up' || n.type === 'task_overdue') ? `<span onclick="event.stopPropagation();sendFollowUpSMS('${n.leadId}')" style="font-size:9px;color:var(--green,#2ECC8A);font-weight:600;letter-spacing:.03em;cursor:pointer;">📱 SMS</span>` : ''}
            ${isDismissed ? `<span onclick="event.stopPropagation();restoreNotification('${n.id}')" style="font-size:9px;color:var(--orange);font-weight:600;letter-spacing:.03em;cursor:pointer;">↩ RESTORE</span>` : ''}
          </div>
        </div>
        ${isUnread && !isDismissed ? `<div style="width:8px;height:8px;background:var(--orange);border-radius:50%;flex-shrink:0;margin-top:4px;"></div>` : ''}
        ${!isDismissed ? `<button onclick="event.stopPropagation();dismissNotification('${n.id}')" title="Dismiss" style="background:none;border:none;color:var(--m);cursor:pointer;font-size:14px;padding:2px 4px;opacity:0.4;flex-shrink:0;line-height:1;" onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='0.4'">✕</button>` : ''}
      </div>
    </div>`;
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

// Request browser notification permission on first load (once)
async function requestNotifPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}
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
    body.innerHTML = '<div class="empty"><div class="empty-icon"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><circle cx="10" cy="10" r="7"/><path d="M7 10l2 2 4-5"/></svg></div><div class="empty-title">All Clear</div><div class="empty-sub">No deleted leads in the trash.</div></div>';
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
        <button class="dc-restore" onclick="restoreDeletedLead('${l.id}')">Restore</button>
        <button class="dc-perm" onclick="permanentDeleteLead('${l.id}','${name.replace(/'/g,'&#39;')}')">Remove</button>
      </div>
    </div>`;
  }).join('');
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
window.sendBookingSMS = function(leadId, phone, firstName) {
  const calSettings = JSON.parse(localStorage.getItem('nbd_cal_settings') || '{}');
  const calUser = calSettings.username || 'nobigdeal';
  const calSlug = calSettings.eventSlug || 'roof-inspection';
  const bookingUrl = `https://cal.com/${calUser}/${calSlug}`;
  const cleanPhone = phone.replace(/\D/g, '');
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
  const calSettings = JSON.parse(localStorage.getItem('nbd_cal_settings') || '{}');
  const calUser = calSettings.username || 'nobigdeal';
  const calSlug = calSettings.eventSlug || 'roof-inspection';
  const bookingUrl = `https://cal.com/${calUser}/${calSlug}`;
  const body = encodeURIComponent(
    `Hi${firstName ? ' ' + firstName : ''}, this is Joe from No Big Deal Home Solutions. Just following up on your project — wanted to check in and see if you have any questions. If you'd like to schedule a time to chat: ${bookingUrl}`
  );
  window.open(`sms:${cleanPhone}?body=${body}`, '_self');
};

