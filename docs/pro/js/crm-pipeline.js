/**
 * crm-pipeline.js — kanban render + card builder + moveCard.
 *
 * Extracted from crm.js (Step 4b — 2026-05-16) as one of four
 * sibling modules. Load order is critical and locked in
 * dashboard.html:
 *
 *   leads → pipeline → snooze → portal-bridge → crm (shim)
 *
 * This file holds the render-heavy kanban logic:
 *   - renderLeads / view-switcher counts / stat helpers
 *   - lead-score last-seen cache (_leadScoreLastSeen + persist)
 *   - _damageToChip helper
 *   - buildCard (the biggest function in the codebase)
 *   - wireKanbanCardListeners (delegated handlers per card body)
 *   - handleCardClick + the global dragend cleanup listener
 *   - promptLostReason (lost-stage modal)
 *   - moveCard (stage advance, persistence, optimistic UI)
 *   - updatePipeline / tagClass
 *   - kanbanFilter + kanbanFilterDebounced + clearCrmSearch
 *
 * It references the Firebase shim consts (db, col, _addDoc, etc.)
 * declared in crm-leads.js as outer-scope globals (classic-script
 * sibling scope). `_dragId` remains an implicit global (used by
 * the kanban drag handlers in renderLeads and the dragend
 * cleanup listener at the bottom of this file) — behaviour-
 * identical to pre-split.
 */

// ══════════════════════════════════════════════
// KANBAN CRM — renderLeads / drag-drop / filter
// ══════════════════════════════════════════════

function renderLeads(leads, filtered){
  const all   = (leads  || window._leads || []);
  let list    = (filtered !== undefined && filtered !== null) ? filtered : all;
  window._filteredLeads = (filtered !== undefined && filtered !== null) ? filtered : null;

  // R5.4: per-track counts on the view switcher (Ins/Cash/Fin/War/Svc/Jobs/All).
  // Computed from `all` (pre-filter) so the counts reflect the rep's
  // real workload, not what's currently filtered in. Skipped if the
  // switcher isn't rendered yet (initial boot before kanban mounts).
  (() => {
    const swEl = document.getElementById('kview-count-insurance');
    if (!swEl) return;
    const _jobStageSet = new Set([
      'job_created','permit_pulled','materials_ordered','materials_delivered',
      'crew_scheduled','install_in_progress','install_complete','final_photos',
      'deductible_collected','final_payment','closed'
    ]);
    const _norm = window.normalizeStage;
    const counts = { insurance: 0, cash: 0, finance: 0, warranty: 0, service: 0, jobs: 0, simple: all.length };
    for (const l of all) {
      if (!l) continue;
      const jt = l.jobType || '';
      // Same logic as the view-filter in renderLeads below
      if (!jt || jt === 'insurance') counts.insurance++;
      if (jt === 'cash')             counts.cash++;
      if (jt === 'finance')          counts.finance++;
      if (jt === 'warranty')         counts.warranty++;
      if (jt === 'service')          counts.service++;
      const sk = l._stageKey || (_norm ? _norm(l.stage) : l.stage || 'new');
      if (_jobStageSet.has(sk))      counts.jobs++;
    }
    ['insurance','cash','finance','warranty','service','jobs','simple'].forEach(k => {
      const el = document.getElementById('kview-count-' + k);
      if (el) el.textContent = counts[k] > 0 ? String(counts[k]) : '';
    });
  })();

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

  // Wave 35: hide snoozed leads from the kanban by default. The rep
  // can flip "Show snoozed" in the CRM header to bring them back.
  // We keep snoozed leads in `all` so the stat row totals are
  // unaffected — the filter only narrows what renders as cards.
  const _showSnoozed = (localStorage.getItem('nbd_crm_show_snoozed') === '1');
  if (!_showSnoozed && window.LeadSnooze) {
    list = list.filter(l => !window.LeadSnooze.isSnoozed(l));
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
    // Insurance view still catches unset jobType (NBD's historical default)
    list = list.filter(l => !l.jobType || l.jobType === 'insurance');
  } else if (_view === 'cash') {
    list = list.filter(l => l.jobType === 'cash');
  } else if (_view === 'finance') {
    list = list.filter(l => l.jobType === 'finance');
  } else if (_view === 'warranty') {
    list = list.filter(l => l.jobType === 'warranty');
  } else if (_view === 'service') {
    list = list.filter(l => l.jobType === 'service');
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

  // Notify Prospects page (and any future listener) that the lead set
  // changed so it can refresh its filtered view + badge count.
  try { document.dispatchEvent(new CustomEvent('leadsChanged', { detail: { count: all.length, prospects: _prospectCount } })); } catch (e) {}

  setEl('crmTotalLeads', _realCount);
  setEl('crmPipeVal',    '$'+pipeVal.toLocaleString());
  setEl('crmApproved',  approvedCount);
  setEl('crmClosedRev', '$'+closedRev.toLocaleString());
  // Stat line — span-wrapped so CSS can hide the wordy bits on mobile.
  // Desktop reads:  "13 customers · $126,043 pipeline · 3 prospects"
  // Mobile  reads:  "13 · $126K · 3"  (.crm-stat-word + .crm-stat-money-full
  // hidden, .crm-stat-money-short shown via the responsive rule in
  // dashboard.html).
  const _fmtMoneyShort = pipeVal >= 1000000
    ? '$' + (pipeVal/1000000).toFixed(pipeVal >= 10000000 ? 0 : 1) + 'M'
    : pipeVal >= 1000
      ? '$' + Math.round(pipeVal/1000) + 'K'
      : '$' + pipeVal;
  const _subLineEl = document.getElementById('crmSubLine');
  if (_subLineEl) {
    _subLineEl.innerHTML =
      '<span class="crm-stat-num">' + _realCount + '</span>' +
      '<span class="crm-stat-word"> customers</span>' +
      ' · ' +
      '<span class="crm-stat-money-full">$' + pipeVal.toLocaleString() + '</span>' +
      '<span class="crm-stat-money-short">' + _fmtMoneyShort + '</span>' +
      '<span class="crm-stat-word"> pipeline</span>' +
      (_prospectCount > 0
        ? ' · <span class="crm-stat-num">' + _prospectCount + '</span>' +
          '<span class="crm-stat-word"> prospects</span>'
        : '');
  }
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

  // Show diagnostic panel ONLY if a successful load returned zero leads.
  // Previously this fired any time `all.length === 0`, including the
  // transient empty cache that loadLeads writes when its first Firestore
  // read fails (common on iOS app-wake — the SDK retries internally and
  // recovers within seconds). The user got a scary "Your kanban isn't
  // loading" screen on cold start that vanished on the next refresh.
  // Now we wait for window._leadsLoaded === true before deciding the
  // account is genuinely empty. While the load is still pending we
  // simply hide the diagnostic and let the loader's auto-retry resolve.
  const diagnostic = document.getElementById('crmDiagnostic');
  const diagnosticDetails = document.getElementById('crmDiagnosticDetails');
  const loadCompleted = window._leadsLoaded === true;
  if (loadCompleted && all.length === 0 && window._user?.uid && diagnostic && diagnosticDetails) {
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
          <span style="color:var(--m);font-size:11px;">${escHtml(String(l.address||'').split(',')[0])}</span>
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

    // W93: optional sort within each column by engagement tier
    // descending. Toggled via the kanban header "🔥 Hot first"
    // button. Stable sort — leads with the same tier preserve
    // their original order so the rep sees a consistent shuffle
    // (Hot leads bubble up, everything else stays put).
    const _engSort = (typeof localStorage !== 'undefined') &&
                     (localStorage.getItem('nbd_crm_sort_engagement') === '1');
    if (_engSort && window.CustomerEngagementScore
        && typeof window.CustomerEngagementScore.computeTier === 'function') {
      const allEsts = Array.isArray(window._estimates) ? window._estimates : [];
      const tierFor = (l) => {
        const t = window.CustomerEngagementScore.computeTier(l, allEsts);
        return t ? t.tier : 0;
      };
      stageKeys.forEach(k => {
        // Decorate-sort-undecorate so we don't recompute tier per
        // comparison (N×log(N) computeTier calls becomes N).
        const decorated = byStage[k].map((l, i) => ({ l, i, t: tierFor(l) }));
        decorated.sort((a, b) => (b.t - a.t) || (a.i - b.i));
        byStage[k] = decorated.map(d => d.l);
      });
    }

    stageKeys.forEach(stageKey => {
      const body  = document.getElementById('kbody-'+stageKey);
      const count = document.getElementById('kcount-'+stageKey);
      const total = document.getElementById('ktotal-'+stageKey);
      if(!body) return;
      const cards = byStage[stageKey]||[];
      if(count) count.textContent = cards.length;
      // R5.5: per-column $ total. Sums jobValue across cards in this
      // stage so the rep sees both "how many" and "how much" without
      // counting in their head. Hidden when 0 cards or 0 total value
      // (e.g. all leads at this stage are pre-estimate).
      if (total) {
        const sumVal = cards.reduce((s, l) => s + (Number(l && l.jobValue) || 0), 0);
        if (cards.length && sumVal > 0) {
          const fmt = sumVal >= 1000
            ? (sumVal >= 1000000
                ? '$' + (sumVal / 1000000).toFixed(sumVal >= 10000000 ? 0 : 1) + 'M'
                : '$' + Math.round(sumVal / 1000) + 'K')
            : '$' + sumVal.toLocaleString();
          total.textContent = fmt;
          total.style.display = '';
          total.title = '$' + sumVal.toLocaleString() + ' total in this stage';
        } else {
          total.style.display = 'none';
        }
      }
      if(!cards.length){ body.innerHTML='<div class="k-empty"><div class="k-empty-line">Drop leads here</div></div>'; return; }
      body.innerHTML = cards.map(l=>buildCard(l)).join('');
      _highlightCardMatches(body); // CO-M-1: highlight after parse, text nodes only
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
      // Wave 103: race-safe drop. Read the dragged ID from
      // dataTransfer (event-scoped) rather than the module-global
      // _dragId. On rapid re-drag or multi-touch hybrid input the
      // module global gets overwritten by the second dragstart
      // before the first drop reads it — wrong card moves to the
      // target column with no error surfaced. dataTransfer is per
      // event so it's race-safe by construction. Fall back to
      // _dragId if dataTransfer is empty (some legacy browsers).
      const dropHandler = e => {
        e.preventDefault();
        body.classList.remove('drag-over');
        const draggedId = (e.dataTransfer && e.dataTransfer.getData('text/plain')) || _dragId;
        if (!draggedId) return;
        moveCard(draggedId, stageKey);
        _dragId = null;
      };
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

    // W93: same engagement-tier sort applied to the legacy path
    // for full coverage. Same compute + decorate-sort-undecorate
    // shape as the new-system branch above.
    const _engSortLegacy = (typeof localStorage !== 'undefined') &&
                           (localStorage.getItem('nbd_crm_sort_engagement') === '1');
    if (_engSortLegacy && window.CustomerEngagementScore
        && typeof window.CustomerEngagementScore.computeTier === 'function') {
      const allEsts = Array.isArray(window._estimates) ? window._estimates : [];
      const tierFor = (l) => {
        const t = window.CustomerEngagementScore.computeTier(l, allEsts);
        return t ? t.tier : 0;
      };
      STAGES.forEach(s => {
        const decorated = byStage[s].map((l, i) => ({ l, i, t: tierFor(l) }));
        decorated.sort((a, b) => (b.t - a.t) || (a.i - b.i));
        byStage[s] = decorated.map(d => d.l);
      });
    }

    STAGES.forEach(stage=>{
      const body  = document.getElementById('kbody-'+stage);
      const count = document.getElementById('kcount-'+stage);
      if(!body) return;
      const cards = byStage[stage]||[];
      if(count) count.textContent = cards.length;
      if(!cards.length){ body.innerHTML='<div class="k-empty"><div class="k-empty-line">Drop leads here</div></div>'; return; }
      body.innerHTML = cards.map(l=>buildCard(l)).join('');
      _highlightCardMatches(body); // CO-M-1: highlight after parse, text nodes only
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
      // W103: same race-safe drop as the new-system path above.
      const dropH = e => {
        e.preventDefault();
        body.classList.remove('drag-over');
        const draggedId = (e.dataTransfer && e.dataTransfer.getData('text/plain')) || _dragId;
        if (!draggedId) return;
        moveCard(draggedId, stage);
        _dragId = null;
      };
      body.addEventListener('dragover', overH);
      body.addEventListener('dragleave', leaveH);
      body.addEventListener('drop', dropH);
      body._dragHandlers = { over: overH, leave: leaveH, drop: dropH };
    });
  }
}

// W136: per-page localStorage cache of last-seen score per lead so
// the kanban can render a tiny ↑/↓/─ trend arrow next to the score
// badge. Initialized lazily on first card render.
const _leadScoreLastSeen = (function () {
  try {
    const raw = localStorage.getItem('nbd_lead_score_last_v1');
    return raw ? JSON.parse(raw) : {};
  } catch (_) { return {}; }
})();
function _persistLeadScoreLastSeen() {
  try { localStorage.setItem('nbd_lead_score_last_v1', JSON.stringify(_leadScoreLastSeen)); }
  catch (_) { /* quota / private mode — best effort */ }
}
let _leadScoreFlushTimer = 0;
function _scheduleLeadScorePersist() {
  if (_leadScoreFlushTimer) return;
  _leadScoreFlushTimer = setTimeout(() => {
    _leadScoreFlushTimer = 0;
    _persistLeadScoreLastSeen();
  }, 1500);
}

// ── Damage-type → trade-iconed chip ──
// Sweep R3: was rendering raw "ROOF - WIND" with the dated
// space-hyphen-space format and no visual cue to the trade. Now
// produces { icon, label } from the canonical TRADES icon set
// (defined in crm-stages.js) so cards read like "🏠 Wind" or
// "🧱 Hail" at a glance. Falls back to the raw label for any
// unrecognized damage strings so we never blank-render bad data.
function _damageToChip(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // Map the lowercase trade prefix to an icon. The trade icons mirror
  // window.TRADES from crm-stages.js — duplicated here as a small
  // lookup so the card render doesn't have to wait for the ES module
  // to expose TRADES on window (which only happens after the
  // dashboard.html module script runs).
  const TRADE_ICON = {
    roof:      '🏠',
    gutters:   '🌧️',
    siding:    '🧱',
    windows:   '🪟',
    fascia:    '🔲',
    paint:     '🎨',
    skylights: '☀️',
    other:     '🔧'
  };
  // Common damage strings split on " - " (hyphen with spaces) into
  // <trade> - <cause>. Anything that doesn't match the pattern gets
  // a heuristic icon based on keyword sniff.
  let icon = '';
  let label = s;
  const m = /^([A-Za-z][A-Za-z\/ ]+?)\s*-\s*(.+)$/.exec(s);
  if (m) {
    const tradeWord = m[1].trim().toLowerCase().split(/\s|\//)[0];
    icon = TRADE_ICON[tradeWord] || '';
    label = m[2].trim();
  } else {
    // Single-word damage types from the existing form options.
    const lower = s.toLowerCase();
    if (/^gutters?$/.test(lower))           icon = TRADE_ICON.gutters;
    else if (/^siding/.test(lower))          icon = TRADE_ICON.siding;
    else if (/^windows?$/.test(lower))       icon = TRADE_ICON.windows;
    else if (/^skylights?$/.test(lower))     icon = TRADE_ICON.skylights;
    else if (/^paint/.test(lower))           icon = TRADE_ICON.paint;
    else if (/^fascia|soffit/.test(lower))   icon = TRADE_ICON.fascia;
    else if (/^full\s*exterior$/.test(lower)) icon = '🏘️';
    else if (/^fire$/.test(lower))           icon = '🔥';
    else if (/^water$/.test(lower))          icon = '💧';
    else if (/^storm\s*damage$/.test(lower)) icon = '⛈';
    else if (/^other$/.test(lower))          icon = TRADE_ICON.other;
    else if (/^roof/.test(lower))            icon = TRADE_ICON.roof;
  }
  return { icon, label };
}

function buildCard(l){
  const nameRaw = ((l.firstName||l.fname||'')+'  '+(l.lastName||l.lname||'')).trim() || l.name||'Unknown';
  const name  = escHtml(nameRaw);
  // T1.e: strip the leading-comma artifact some upstream USPS-style
  // formatters insert between house number and street ("3424, Moria Drive").
  // Display as plain "3424 Moria Drive, Cincinnati" by collapsing
  // "<digits>,<space>" → "<digits> ".
  // Audit C — wrap in String() so a malformed lead with `address` stored
  // as an object/array/number (possible via Firestore-console hand edits or
  // bad imports) doesn't blow up the entire kanban column when buildCard
  // throws TypeError on `.replace`. Same defense applied to `phone`/`email`
  // below.
  const _addrRaw = String(l.address||'').replace(/^(\d+),\s+/, '$1 ');
  const addr  = escHtml(_addrRaw.split(',').slice(0,2).join(','));
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
  // R4.4 + R5.11: when the lead has 0 tasks, render an icon-only ghost
  // pill so the CTA stops competing with real action signals (Due /
  // Needs X / next-best-action). Tooltip carries the "+ Tasks" intent
  // for discoverability.
  let taskBadgeClass = totalT ? 'kc-task-badge' : 'kc-task-badge empty';
  let taskBadgeLabel = totalT ? `☑ ${doneT}/${totalT}` : '+';
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

  // ── Wave 17: stage-aging cue ──
  // Distinct from the "days since last contact" badge above — this
  // measures how long the lead has sat AT THE CURRENT STAGE. A lead
  // that was contacted yesterday but stuck at "estimate sent" for 21
  // days is a different problem than a lead that's only 1 day old.
  // Skipped on terminal stages (closed/lost/Complete) since those
  // don't need attention. The visual cue is two parts: a left-border
  // tint via k-card-aging-* classes, and a compact "Nd in stage" pill
  // next to the customer name.
  let stageAgingClass = '';   // applied to .k-card root
  let stageAgeBadge   = '';   // injected next to the name
  const _terminal = ['closed','lost','Complete','Lost','final_payment'];
  if(!_terminal.includes(l.stage||'') && !_terminal.includes(_sk||'')) {
    let stageRef = null;
    const stageStart = l.stageStartedAt;
    if(stageStart?.toDate)        stageRef = stageStart.toDate();
    else if(stageStart instanceof Date) stageRef = stageStart;
    else if(stageStart)           stageRef = new Date(stageStart);
    // Fall back to updatedAt → createdAt so cards predating the
    // stageStartedAt rollout still get an aging signal.
    else if(l.updatedAt?.toDate)  stageRef = l.updatedAt.toDate();
    else if(l.createdAt?.toDate)  stageRef = l.createdAt.toDate();

    if(stageRef && !isNaN(stageRef)) {
      const stageNorm = new Date(stageRef);
      stageNorm.setHours(0,0,0,0);
      const stageDays = Math.floor((today - stageNorm) / 86400000);
      // R4.2: shortened stage-age label. Was '33d in stage' (~13 chars)
      // which forced the top row to compete for space with the value
      // badge + count chips. Now just '33d' — the tooltip carries the
      // full context, and the semantic color already communicates
      // 'this is a stage-age signal, not a generic last-touch one.'
      if(stageDays >= 14) {
        stageAgingClass = 'k-card-aging-critical';
        stageAgeBadge = `<span class="kc-stage-age kc-stage-age-critical" title="In current stage for ${stageDays} days">${stageDays}d</span>`;
      } else if(stageDays >= 7) {
        stageAgingClass = 'k-card-aging-stale';
        stageAgeBadge = `<span class="kc-stage-age kc-stage-age-stale" title="In current stage for ${stageDays} days">${stageDays}d</span>`;
      } else if(stageDays >= 3) {
        stageAgingClass = 'k-card-aging-warming';
        stageAgeBadge = `<span class="kc-stage-age kc-stage-age-warming" title="In current stage for ${stageDays} days">${stageDays}d</span>`;
      }
    }
  }

  // T1.a: dedupe days. Two waves added overlapping signals to the card —
  // W17 "Nd in stage" (action signal: "this lead is stuck") and the older
  // "Nd ago" last-touch (freshness signal). They were both rendered on
  // every card, often showing the SAME number. Pick one:
  //   - stage stuck for 3+ days → show ONLY the stage-age badge
  //   - otherwise → show ONLY the last-touch label on the phone row
  if (stageAgeBadge) daysLabel = '';

  // ── Wave 44: last-shared badge ──
  // Surfaces a small "📤 shared 3d via SMS" pill when the rep has
  // shared the portal link with this customer. Helps reps remember
  // who they've reached out to and through which channel without
  // opening the customer detail page. Skipped when not yet shared.
  let lastSharedBadge = '';
  (function buildLastSharedBadge() {
    const sharedAt = l.lastSharedAt;
    if (!sharedAt) return;
    let ms = 0;
    if (typeof sharedAt.toMillis === 'function')      ms = sharedAt.toMillis();
    else if (typeof sharedAt.toDate === 'function')   ms = sharedAt.toDate().getTime();
    else if (sharedAt instanceof Date)                ms = sharedAt.getTime();
    else if (typeof sharedAt === 'number')            ms = sharedAt;
    if (!ms) return;
    const days = Math.floor((Date.now() - ms) / 86400000);
    let label;
    if (days <= 0)      label = 'today';
    else if (days === 1) label = 'yesterday';
    else if (days < 7)   label = `${days}d ago`;
    else if (days < 30)  label = `${Math.floor(days / 7)}w ago`;
    else                 label = `${Math.floor(days / 30)}mo ago`;
    const viaMap = { copy: 'copied', sms: 'SMS', email: 'email' };
    const via = viaMap[l.lastSharedVia] || 'shared';
    // Wave 57: fresh-share pulse. Shares within the last 24 hours
    // get a subtle 2.4s pulse animation so reps get a passive
    // visual cue when scrolling the kanban: "this just went out
    // a few hours ago." Older shares stay calm — pulsing every
    // single share badge would defeat the purpose.
    const ageMs = Date.now() - ms;
    const isFresh = ageMs >= 0 && ageMs < 24 * 60 * 60 * 1000;
    const freshClass = isFresh ? ' kc-shared-fresh' : '';
    lastSharedBadge = `<span class="kc-tag${freshClass}" style="background:rgba(155,109,255,0.14);color:#cab8ff;border-color:rgba(155,109,255,0.45);" title="Portal link last shared via ${escHtml(via)} — ${escHtml(label)}">📤 ${escHtml(via)} ${escHtml(label)}</span>`;
  })();

  // ── Wave 58: customer-engagement indicator ──
  // Companion to the W44 share badge. Where W44 says "I sent it",
  // this badge says "they OPENED it" — by far the strongest buying
  // signal short of a signature. Pulls from window._estimates:
  // surfaces the latest viewedAt across the lead's estimates that
  // haven't been responded to.
  //
  // Skipped when: any estimate already responded to (signed /
  // declined / replied — the customer's already past the
  // viewing-but-uncommitted state); lead is in a terminal stage;
  // no viewed estimate exists.
  let viewedBadge = '';
  (function buildViewedBadge() {
    const estimates = Array.isArray(window._estimates) ? window._estimates : [];
    if (estimates.length === 0) return;
    const sk = (l._stageKey || l.stage || 'new').toString();
    if (sk === 'closed' || sk === 'lost' || sk === 'Lost' || sk === 'Complete') return;

    let latestViewMs = 0;
    let anyResponded = false;
    for (const e of estimates) {
      if (!e || e.leadId !== l.id) continue;
      if (e.respondedAt) { anyResponded = true; break; }
      let ms2 = 0;
      const v = e.viewedAt;
      if (v && typeof v.toMillis === 'function')      ms2 = v.toMillis();
      else if (v && typeof v.toDate === 'function')   ms2 = v.toDate().getTime();
      else if (v instanceof Date)                     ms2 = v.getTime();
      else if (typeof v === 'number')                 ms2 = v;
      if (ms2 > latestViewMs) latestViewMs = ms2;
    }
    if (anyResponded || latestViewMs === 0) return;

    const days = Math.floor((Date.now() - latestViewMs) / 86400000);
    let label;
    if (days <= 0)      label = 'today';
    else if (days === 1) label = 'yesterday';
    else if (days < 7)   label = `${days}d ago`;
    else if (days < 30)  label = `${Math.floor(days / 7)}w ago`;
    else                 label = `${Math.floor(days / 30)}mo ago`;
    const ageMs2 = Date.now() - latestViewMs;
    const isFreshView = ageMs2 >= 0 && ageMs2 < 24 * 60 * 60 * 1000;
    const freshClass2 = isFreshView ? ' kc-viewed-fresh' : '';
    viewedBadge = `<span class="kc-tag${freshClass2}" style="background:rgba(46,204,138,0.14);color:#5eead4;border-color:rgba(46,204,138,0.45);" title="Customer opened the portal — ${escHtml(label)}">👁 viewed ${escHtml(label)}</span>`;
  })();

  // ── Wave 112: smart-follow-up suggestion pill ──
  // Shows the next-best-action priority + channel as a compact pill
  // in the kc-tags row. Clicking the pill is a no-op for now (the
  // W113 customer page panel hosts the full action UI). Skipped
  // when SmartFollowup isn't loaded or returns 'wait' / 'monitor'
  // — those are explicitly "no action" states and the pill would
  // just be visual noise.
  let smartFollowupBadge = '';
  (function buildSmartFollowupBadge() {
    if (!window.SmartFollowup
        || typeof window.SmartFollowup.computeSuggestion !== 'function') return;
    const sug = window.SmartFollowup.computeSuggestion(l);
    if (!sug) return;
    if (sug.priority === 'wait' || sug.priority === 'monitor') return;
    // T1.b: dedupe with the explicit overdue ⚠ Due chip. If the rep has
    // an overdue follow-up date AND the smart-followup engine also says
    // "Today", they're the same signal — skip this badge so we don't
    // render two-chips-for-one-meaning.
    if (overdue && sug.priority === 'today') return;
    // Color register matches the priority severity:
    //   urgent    → red    (act now)
    //   today     → orange (do today)
    //   this-week → blue   (sometime soon)
    let bg, color, border, icon, label;
    if (sug.priority === 'urgent') {
      bg = 'rgba(239,68,68,0.16)'; color = '#fca5a5'; border = 'rgba(239,68,68,0.45)';
      icon = '⚡'; label = 'Urgent';
    } else if (sug.priority === 'today') {
      bg = 'rgba(245,158,11,0.16)'; color = '#fcd34d'; border = 'rgba(245,158,11,0.45)';
      icon = '💡'; label = 'Today';
    } else { // this-week
      bg = 'rgba(96,165,250,0.16)'; color = '#93c5fd'; border = 'rgba(96,165,250,0.45)';
      icon = '👁'; label = 'Watch';
    }
    // Title attribute carries the headline + reasoning so reps can
    // hover to see WHY the suggestion fires without leaving the
    // kanban. The W113 panel will give the full UI.
    const tooltip = `${sug.headline}\n\n${sug.reasoning}`;
    smartFollowupBadge = `<span class="kc-tag" style="background:${bg};color:${color};border-color:${border};" title="${escHtml(tooltip)}">${icon} ${escHtml(label)}</span>`;
  })();

  // ── Wave 92: engagement tier badge ──
  // Compact aggregate of W44 share + W58 viewed + respondedAt
  // signals into a single chip on the kanban card. The customer
  // page got the same tier in W91; this brings it to the kanban
  // so reps can prioritize their column at a glance without
  // having to read three separate badges.
  //
  // Skipped on tier 0 (no signals) so non-engaged cards stay
  // clean. Also skipped on terminal stages — a "Responded"
  // badge on a closed deal is just visual noise.
  let engagementBadge = '';
  (function buildEngagementBadge() {
    if (!window.CustomerEngagementScore
        || typeof window.CustomerEngagementScore.computeTier !== 'function') return;
    const sk = (l._stageKey || l.stage || 'new').toString().toLowerCase();
    if (sk === 'closed' || sk === 'lost' || sk === 'complete') return;
    const allEsts = Array.isArray(window._estimates) ? window._estimates : [];
    const tier = window.CustomerEngagementScore.computeTier(l, allEsts);
    if (!tier || tier.tier === 0) return;
    engagementBadge = `<span class="kc-tag" style="background:${tier.bg};color:${tier.color};border-color:${tier.border};" title="${escHtml(tier.title || tier.label)}">${tier.icon} ${escHtml(tier.label)}</span>`;
  })();

  // ── Wave 136: Lead Intelligence score badge ──
  // Single 0-100 priority pill in the top-meta row. Tier color +
  // optional trend arrow vs. the last score we persisted for this
  // lead. The number itself is intentionally small and quiet — the
  // colored dot is the at-a-glance signal; the digits answer
  // "exactly how hot?" only when the rep zooms in.
  //
  // Wave 137 will make this clickable to open the breakdown panel
  // on the customer page; for now it's purely visual.
  let leadScoreBadge = '';
  try {
    if (window.NBDLeadScore && typeof window.NBDLeadScore.breakdown === 'function') {
      const b = window.NBDLeadScore.breakdown(l, { estimates: window._estimates || [] });
      const score = b.score;
      const color = window.NBDLeadScore.tierColor(score);
      // Trend arrow vs. previous render. ±2 deadband so the arrow
      // doesn't flicker on every recency-drift point.
      const prev = _leadScoreLastSeen[l.id];
      let trend = '';
      if (typeof prev === 'number') {
        const delta = score - prev;
        if (delta >= 2) trend = '<span style="color:#10b981;font-weight:700;">↑</span>';
        else if (delta <= -2) trend = '<span style="color:#ef4444;font-weight:700;">↓</span>';
      }
      // Persist the new value (debounced to localStorage so we don't
      // hammer it on every kanban re-render).
      if (prev !== score) {
        _leadScoreLastSeen[l.id] = score;
        _scheduleLeadScorePersist();
      }
      const reason = b.topReason || '';
      const titleAttr = escHtml(`Lead score ${score}/100 (${b.label}). ${reason}`);
      leadScoreBadge =
        '<span class="kc-tag" title="' + titleAttr + '" ' +
          'style="background:' + color + '22;color:' + color + ';' +
          'border-color:' + color + '88;display:inline-flex;align-items:center;' +
          'gap:3px;font-variant-numeric:tabular-nums;font-weight:700;">' +
          '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + color + ';"></span>' +
          score + (trend ? ' ' + trend : '') +
        '</span>';
    }
  } catch (e) {
    // Engine threw — silently skip the badge so a single bug doesn't
    // bring down the whole kanban render.
    leadScoreBadge = '';
  }

  // ── Wave 28: jobType badge ──
  // Icon-only pill tinted with the type's brand color from JOB_TYPE_META.
  // Lets reps scan Insurance vs Cash vs Finance at a glance without
  // opening the card. Falls back to inferJobType() for older records
  // that predate the explicit field. Silently empty if unknowable.
  let jobTypeBadge = '';
  try {
    const _jt = l.jobType ||
      (typeof window.inferJobType === 'function' ? window.inferJobType(l) : null);
    const _jtm = (window.JOB_TYPE_META && _jt) ? window.JOB_TYPE_META[_jt] : null;
    if (_jtm) {
      const _c = _jtm.color || '#888';
      jobTypeBadge =
        '<span class="kc-tag kct-jobtype" title="' + escHtml(_jtm.label) + '" ' +
          'style="background:color-mix(in srgb,' + _c + ' 18%, var(--s3));color:' + _c + ';' +
          'border-color:color-mix(in srgb,' + _c + ' 50%, var(--br));font-size:10px;padding:2px 6px;">' +
          (_jtm.icon || '?') +
        '</span>';
    }
  } catch (e) { jobTypeBadge = ''; }

  // ── Wave 75: snoozed-card pills ──
  // Only renders when this lead is snoozed AND the W37 show-snoozed
  // toggle is on (otherwise the lead is filtered out at line 267
  // and we never reach this branch). Two separate pills so reps
  // can scan their snoozed kanban for category + indecision pattern
  // at the same time:
  //
  //   - Snooze pill (purple)  → "💤 <date> · <reason>"
  //   - Stale pill  (amber)   → "⚠️ Snoozed 3×"  (only when count ≥ 3)
  //
  // Mirrors the W36 customer-banner pill row + the W71 cmd+K
  // subtitle so the snooze metadata reads identically across all
  // three surfaces.
  let snoozeBadge = '';
  let staleSnoozeBadge = '';
  (function buildSnoozePills() {
    if (!window.LeadSnooze || !window.LeadSnooze.isSnoozed(l)) return;
    const d = window.LeadSnooze.snoozedUntilDate(l);
    if (!d) return;
    const dateLabel = window.LeadSnooze.formatSnoozeLabel(d);
    const reason = (typeof l.snoozedReason === 'string' && l.snoozedReason.trim())
      ? l.snoozedReason.trim()
      : '';
    const reasonTail = reason ? ` · ${reason}` : '';
    snoozeBadge = `<span class="kc-tag" style="background:rgba(155,109,255,0.14);color:#cab8ff;border-color:rgba(155,109,255,0.45);" title="Snoozed until ${escHtml(dateLabel)}${reasonTail ? ' — ' + escHtml(reason) : ''}">💤 ${escHtml(dateLabel)}${escHtml(reasonTail)}</span>`;

    if (typeof window.LeadSnooze.isStaleSnooze === 'function'
        && window.LeadSnooze.isStaleSnooze(l)) {
      const n = l.snoozeCount || 0;
      staleSnoozeBadge = `<span class="kc-tag" style="background:rgba(245,158,11,0.18);color:#fcd34d;border-color:rgba(245,158,11,0.45);" title="This lead has been snoozed ${n}+ times — consider a different action.">⚠️ Snoozed ${escHtml(String(n))}×</span>`;
    }
  })();

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

  // R4.3: Phone display normalization. Some leads were imported with
  // raw '3046871719', some hand-typed '304-687-1719', some pasted
  // '(513) 555-0192'. Normalize to one consistent display format —
  // '(xxx) xxx-xxxx' — at render time so the kanban scans cleanly.
  // The href:tel: link still strips to digits independently.
  const _phoneRaw = String(l.phone || '').trim();
  let _phoneFmt = _phoneRaw;
  const _phoneDigits = _phoneRaw.replace(/\D/g, '');
  if (_phoneDigits.length === 10) {
    _phoneFmt = `(${_phoneDigits.slice(0,3)}) ${_phoneDigits.slice(3,6)}-${_phoneDigits.slice(6)}`;
  } else if (_phoneDigits.length === 11 && _phoneDigits.startsWith('1')) {
    _phoneFmt = `(${_phoneDigits.slice(1,4)}) ${_phoneDigits.slice(4,7)}-${_phoneDigits.slice(7)}`;
  }
  const phone = escHtml(_phoneFmt);
  // R5.10: emails are case-insensitive per RFC; user-entered casing
  // ('Heatherclymer918@yahoo.com') reads as awkward on the kanban scan.
  // Normalize display to lowercase. mailto: and downstream consumers
  // see the original l.email value via the lead record.
  const email = escHtml(String(l.email||'').toLowerCase());
  // T1.c: normalize carrier. The codebase historically stored under
  // both `insCarrier` and `insuranceCarrier`; some imports wrote
  // "State Farm", others "StateFarm". Collapse whitespace + trim so
  // the kc-carrier pill renders consistently. We do NOT case-normalize
  // because that would mangle acronyms (USAA → Usaa).
  const carrier = escHtml(((l.insCarrier||l.insuranceCarrier||'')+'').replace(/\s+/g,' ').trim());
  const claimNum = escHtml(l.claimNumber||l.claimNum||'');
  // R5.2: humanize raw enum values like 'in_progress' / 'under_review' that
  // some pages (insurance-claim.js, doc-preflight) write to claimStatus.
  // Strip underscores, then title-case each word. CSS still uppercases via
  // text-transform so the chip reads as 'IN PROGRESS' instead of 'IN_PROGRESS'.
  const _humanizeStatus = s => String(s||'').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
  const claimStatus = escHtml(_humanizeStatus(l.claimStatus||''));
  
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

  // ── Missing-required-field badge ──
  // Phase 4 polish — surface what's blocking this lead from advancing
  // to its next stage so the rep can fix it without dragging the card
  // and getting bounced by the required-field gate in moveCard. Only
  // shown for non-terminal stages where requiredFieldsFor() actually
  // declares something. Click target is the card itself (opens edit
  // modal), so we don't add another button — just a clear visual.
  // ── Next-best-action hint chip ──
  // Sweep R3 (B): closes the loop on Phase 1's STAGE_ACTIONS map by
  // surfacing the #1 action for this stage + job type on the card face
  // itself, not just inside the Next Actions panel in the lead modal.
  // Reps see "→ File Claim" / "→ Send AOB" / "→ Pull Permit" on every
  // card so they can scan the column for what to do, not just where
  // each lead sits.
  //
  // Skipped on terminal stages (closed / lost) and skipped if there's
  // already a 'needs X' warning chip — the rep should fix the missing
  // field before doing the next action.
  let nextActionChip = '';
  if (!isTerminal && typeof window.actionsForStage === 'function') {
    try {
      const jt = l.jobType || (typeof window.inferJobType === 'function' ? window.inferJobType(l) : null);
      const actions = window.actionsForStage(l._stageKey || l.stage, jt) || [];
      // Skip purely-cosmetic actions like "Log Contact" / "Follow Up"
      // when the stage has a real document or stage-advance action
      // available; reps want to know the *progression* step, not the
      // catch-all log. Heuristic: prefer kind:'doc' or kind:'stage'
      // first, fall back to the first action otherwise.
      const preferred = actions.find(a => a.kind === 'doc' || a.kind === 'stage') || actions[0];
      if (preferred) {
        const icon = preferred.icon || '→';
        const label = preferred.label || preferred.id || '';
        const kindTag = preferred.kind === 'doc' ? 'kct-action-doc'
                      : preferred.kind === 'stage' ? 'kct-action-stage'
                      : 'kct-action';
        nextActionChip = `<span class="kc-tag ${kindTag}" title="Next: ${escHtml(label)}">${icon} ${escHtml(label)}</span>`;
      }
    } catch (_) { /* degrade silently */ }
  }

  let needsBadge = '';
  if (!isTerminal && typeof window.missingRequiredFields === 'function') {
    try {
      const missing = window.missingRequiredFields(l) || [];
      if (missing.length > 0) {
        const FIELD_LABELS = {
          jobType:              'Job Type',
          insCarrier:           'Carrier',
          claimNumber:          'Claim #',
          policyNumber:         'Policy #',
          dateOfLoss:           'Date of Loss',
          estimateAmount:       'Estimate $',
          deductibleOrOwedByHO: 'Deductible',
          jobValue:             'Job Value',
          financeCompany:       'Lender',
          loanAmount:           'Loan $',
          scheduledDate:        'Schedule Date'
        };
        const niceList = missing.map(f => FIELD_LABELS[f] || f);
        const head = niceList[0];
        const moreCount = niceList.length - 1;
        const text = moreCount > 0 ? `Needs ${head} +${moreCount}` : `Needs ${head}`;
        const tip = niceList.join(', ');
        needsBadge = `<span class="kc-tag kct-needs" title="To advance this stage, fill: ${escHtml(tip)}">⚠ ${escHtml(text)}</span>`;
      }
    } catch (e) { /* missingRequiredFields can throw on malformed lead — degrade silently */ }
  }
  let html = `<div class="k-card nbd-kc-main ${stageAgingClass}" draggable="true" data-id="${safeId}" data-action="card-click">
    <div class="k-card-checkbox nbd-kc-stop" data-action="toggle-select" data-id="${safeId}">
      <span class="k-card-checkbox-icon"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><path d="M4 10.5l4 4 8-9"/></svg></span>
    </div>
    <!-- R6: value gets its own row.
         History: R4 moved value out of the left cluster and into the
         right cluster alongside the est/photo count chips, on the
         theory that money belongs on the right. That looked clean in
         the abstract — but in production the .kc-val-badge has a
         20px-blur orange text-shadow glow that visually bleeds into
         the count badges 4px away, creating the overlap the user
         keeps flagging. Real fix: give the value its own row right-
         aligned, with no horizontal neighbor to collide with. The
         glow now has 12px of empty space to fade into. Plus we
         tightened the glow itself in the CSS rule (8px not 20px). -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;gap:6px;flex-wrap:wrap;">
      <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">${jobTypeBadge}${leadScoreBadge}${stageAgeBadge}</div>
      <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
        ${estCount > 0 ? `<span style="font-size:10px;background:var(--s3);border:1px solid var(--br);border-radius:10px;padding:2px 6px;color:var(--gold);"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><rect x="4" y="3" width="12" height="14" rx="1.5"/><path d="M7 3V1.5h6V3"/><path d="M7 8h6M7 11h4"/></svg> ${estCount}</span>` : ''}
        ${photoCount > 0 ? `<span style="font-size:10px;background:var(--s3);border:1px solid var(--br);border-radius:10px;padding:2px 6px;color:var(--blue);"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><rect x="2" y="6" width="16" height="11" rx="1.5"/><circle cx="10" cy="11" r="3"/><path d="M7 6l1-3h4l1 3"/></svg> ${photoCount}</span>` : ''}
      </div>
    </div>
    ${val ? `<div class="kc-val-row" style="text-align:right;margin-bottom:6px;line-height:1;"><span class="kc-val-badge">${val}</span></div>` : ''}
    <div class="kc-name"${l.customerId ? ` data-customer-id="${escHtml(l.customerId)}" title="${escHtml(l.customerId)}"` : ''}>${name}</div>
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
    <!-- T3.c: inline photo thumbnails removed from card face — the
         📷 count chip in the top-right corner is enough at-a-glance.
         Full gallery still accessible via the lead modal + photo tab. -->
    <div class="kc-tags">
      ${(() => {
        const dc = _damageToChip(l.damageType);
        if (!dc) return '';
        return `<span class="kc-tag kct-dmg" title="${escHtml(l.damageType)}">${dc.icon ? dc.icon + ' ' : ''}${escHtml(dc.label)}</span>`;
      })()}
      ${needsBadge ? '' : nextActionChip}
      ${overdue      ? `<span class="kc-tag kct-due"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><path d="M10 3L2 17h16L10 3z"/><path d="M10 8v4M10 14.5v.5"/></svg> Due</span>` : ''}
      ${needsBadge}
      ${roofBadge}
      ${l.hailHit && l.hailHit.sizeInches ? `<span class="kc-tag kct-dmg" style="background:rgba(255,59,59,.18);color:#ff6b6b;border-color:#ff6b6b;" title="Recent hail near this property">⛈ ${Number(l.hailHit.sizeInches).toFixed(1)}&quot; hail</span>` : ''}
      ${l.measurementReady ? `<span class="kc-tag" style="background:rgba(46,204,138,.14);color:var(--green,#2ecc8a);border-color:var(--green,#2ecc8a);" title="Aerial measurement report is ready">📐 Measurement</span>` : ''}
      ${smartFollowupBadge}
      ${lastSharedBadge}
      ${viewedBadge}
      ${engagementBadge}
      ${snoozeBadge}
      ${staleSnoozeBadge}
    </div>
    <div class="kc-footer">
      <button type="button" class="${taskBadgeClass}" data-action="open-tasks" data-id="${safeId}" title="${totalT ? 'View ' + totalT + ' task' + (totalT===1?'':'s') : 'Add a task'}" aria-label="${totalT ? 'View tasks' : 'Add a task'}">${taskBadgeLabel}</button>
      <div class="kc-actions">
        <div class="kc-move">
          ${prevS ? `<button type="button" class="kc-arrow nbd-kc-stop" title="← ${escHtml(prevLabel)}" aria-label="Move to previous stage: ${escHtml(prevLabel)}" data-action="move-card" data-id="${safeId}" data-target-stage="${escHtml(prevS)}">◀</button>` : '<span style="width:18px;"></span>'}
          ${nextS ? `<button type="button" class="kc-arrow nbd-kc-stop" title="→ ${escHtml(nextLabel)}" aria-label="Move to next stage: ${escHtml(nextLabel)}" data-action="move-card" data-id="${safeId}" data-target-stage="${escHtml(nextS)}">▶</button>` : '<span style="width:18px;"></span>'}
        </div>
        <!-- T2: action-bar consolidation. The four icon buttons (SMS,
             email, edit, delete) all duplicated functionality already
             reachable via right-click / long-press → kanban context
             menu (View / Edit / Add Task / Call / Copy phone-address /
             Open in Maps / Delete). Replaced with a single ⋮ overflow
             that opens that menu next to the button. Prev/next stage
             arrows kept since drag-substitute is core kanban grammar. -->
        <button type="button" class="kc-btn kc-overflow nbd-kc-stop" title="More actions" aria-label="More actions" data-action="card-overflow" data-id="${safeId}">⋮</button>
      </div>
    </div>
  </div>`;

  // CO-M-1 fix: search highlighting is NO LONGER done here by string-
  // replacing across the serialized card HTML — that injected <mark> into
  // the middle of tags/attributes/styles and leaked raw markup as text
  // (e.g. 'content:space-between;...">', 'data-action="card" data-id="...').
  // Highlighting now runs AFTER the card is parsed into the DOM, walking
  // text nodes only via _highlightCardMatches() (called from renderLeads).
  return html;
}

// CO-M-1: TreeWalker-based search highlighter. Walks only TEXT nodes of
// the freshly-rendered column, so existing tag/attribute/style/badge markup
// is never touched. Wraps each case-insensitive match in a <mark> via DOM
// node splitting (no innerHTML reassignment of any element that holds
// markup). Skips text inside <mark>/<script>/<style> and inside elements
// whose text is structural (svg). Reversible by construction: clearing the
// search sets window._searchQuery = null and renderLeads() rebuilds the
// columns from clean buildCard() output, so no un-highlight pass is needed.
function _highlightCardMatches(rootEl){
  const q = window._searchQuery;
  if(!rootEl || !q || q.length < 2) return;
  // Case-insensitive literal match — escape regex metachars in the query.
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let regex;
  try { regex = new RegExp(escaped, 'gi'); } catch(_){ return; }
  const SKIP_TAGS = { MARK:1, SCRIPT:1, STYLE:1, SVG:1, PATH:1, RECT:1, CIRCLE:1 };
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
    acceptNode(node){
      if(!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      // Skip text already inside a <mark> or inside non-text containers.
      let p = node.parentNode;
      while(p && p !== rootEl){
        if(p.nodeType === 1 && SKIP_TAGS[p.nodeName]) return NodeFilter.FILTER_REJECT;
        p = p.parentNode;
      }
      regex.lastIndex = 0;
      return regex.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  // Collect first (mutating during walk invalidates the walker).
  const targets = [];
  let n;
  while((n = walker.nextNode())) targets.push(n);
  targets.forEach(textNode => {
    const text = textNode.nodeValue;
    regex.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0, m;
    while((m = regex.exec(text))){
      if(m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const mark = document.createElement('mark');
      mark.style.cssText = 'background:var(--orange);color:var(--accent-fg);padding:0 2px;border-radius:2px;font-weight:600;';
      mark.textContent = m[0];
      frag.appendChild(mark);
      last = m.index + m[0].length;
      if(m[0].length === 0){ regex.lastIndex++; } // guard against zero-width loops
    }
    if(last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    if(frag.childNodes.length) textNode.parentNode.replaceChild(frag, textNode);
  });
}

function handleCardClick(id, event) {
  // If clicking a button/link inside card, don't open modal
  if(event.target.closest('button,a')) return;
  // Open card detail modal (snapshot view with quick actions)
  openLeadDetail(id);
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
    saveBtn.style.cssText = 'background:var(--orange);border:1px solid var(--orange);color:var(--accent-fg);box-shadow:inset 0 0 0 1px var(--accent-ring);padding:10px 18px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;';
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

// ═══════════════════════════════════════════════════════════
// Required-field gate — modal banner + click-to-jump
// When moveCard's gate blocks an advance, we open the lead modal
// AND surface a sticky banner at the top listing exactly which
// fields are missing for the target stage. Clicking a field name
// scrolls + focuses + pulses that input so the rep knows where to
// type. No toast — the banner is right there in the modal we just
// opened, so a duplicate toast just means two things to dismiss.
// ═══════════════════════════════════════════════════════════
const _GATE_FIELD_META = {
  jobType:              { label: 'Job Type',          inputId: 'lJobType' },
  insCarrier:           { label: 'Insurance Carrier', inputId: 'lInsCarrier' },
  claimNumber:          { label: 'Claim Number',      inputId: 'lClaimNumber' },
  policyNumber:         { label: 'Policy Number',     inputId: 'lPolicyNumber' },
  dateOfLoss:           { label: 'Date of Loss',      inputId: 'lDateOfLoss' },
  estimateAmount:       { label: 'Estimate Amount',   inputId: 'lEstimateAmount' },
  deductibleOrOwedByHO: { label: 'Deductible',        inputId: 'lDeductible' },
  jobValue:             { label: 'Job Value',         inputId: 'lJobValue' },
  financeCompany:       { label: 'Finance Company',   inputId: 'lFinanceCompany' },
  loanAmount:           { label: 'Loan Amount',       inputId: 'lLoanAmount' },
  scheduledDate:        { label: 'Scheduled Date',    inputId: 'lScheduledDate' },
};

function _openLeadModalWithMissingFieldsBanner(lead, targetStage, missingFields) {
  const stageLabel = (window.STAGE_META && window.STAGE_META[targetStage] && window.STAGE_META[targetStage].label) || targetStage;
  const items = (missingFields || []).map(f => _GATE_FIELD_META[f] || { label: f, inputId: null });

  if (typeof window.editLead !== 'function') return;
  try { window.editLead(lead.id); } catch (_) { return; }

  // editLead is sync but lays out the modal across a tick (option
  // groups, smart filter, intel hooks). Defer banner injection + focus
  // until the next frame so the inputs are settled.
  setTimeout(() => {
    const modal = document.getElementById('leadModal');
    if (!modal) return;
    const modalBox = modal.querySelector('.modal');
    if (!modalBox) return;

    const existing = document.getElementById('mFieldGateBanner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'mFieldGateBanner';
    banner.setAttribute('role', 'alert');
    banner.style.cssText = 'background:rgba(234,88,12,.10);border:1px solid var(--orange,#ea580c);border-left:3px solid var(--orange,#ea580c);border-radius:6px;padding:10px 12px;margin:0 0 12px 0;font-size:13px;color:var(--t,#fff);line-height:1.4;';

    const eyebrow = document.createElement('div');
    eyebrow.style.cssText = 'font-weight:700;letter-spacing:.02em;text-transform:uppercase;font-size:11px;color:var(--orange,#ea580c);margin-bottom:4px;';
    eyebrow.textContent = `⚠ Move to "${stageLabel}" blocked — fill these in to advance`;
    banner.appendChild(eyebrow);

    const list = document.createElement('div');
    items.forEach((it, idx) => {
      if (idx > 0) list.appendChild(document.createTextNode(', '));
      if (it.inputId) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = it.label;
        btn.dataset.gateJump = it.inputId;
        btn.style.cssText = 'background:none;border:none;padding:0;color:var(--orange,#ea580c);text-decoration:underline;cursor:pointer;font:inherit;';
        list.appendChild(btn);
      } else {
        list.appendChild(document.createTextNode(it.label));
      }
    });
    banner.appendChild(list);

    const bar = modalBox.querySelector('.m-modal-bar');
    if (bar && bar.nextElementSibling) bar.parentNode.insertBefore(banner, bar.nextElementSibling);
    else modalBox.prepend(banner);

    // Jump to a missing field. When the input is hidden because its
    // parent job-type block (insurance/finance/job) hasn't been
    // unlocked yet, scrolling/focusing it no-ops silently — the rep
    // sees nothing happen. Fall back to focusing the Job Type select
    // so the rep knows the gate is "pick a job type first, then this
    // field appears." (Job Type itself is now included in
    // missingRequiredFields when unset on a stage that needs fields,
    // so this fallback is rare — kept as belt-and-suspenders for the
    // hidden-but-jobType-set case, e.g. finance fields on insurance.)
    const _jumpTo = (inp) => {
      if (!inp) return;
      if (inp.offsetParent === null) {
        const jt = document.getElementById('lJobType');
        if (jt) {
          try { jt.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
          try { jt.focus({ preventScroll: true }); } catch (_) { try { jt.focus(); } catch (__) {} }
          try {
            jt.style.transition = 'box-shadow .25s ease';
            jt.style.boxShadow = '0 0 0 3px rgba(234,88,12,.55)';
            setTimeout(() => { jt.style.boxShadow = ''; }, 1600);
          } catch (_) {}
        }
        return;
      }
      try { inp.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
      try { inp.focus({ preventScroll: true }); } catch (_) { try { inp.focus(); } catch (__) {} }
      try {
        inp.style.transition = 'box-shadow .25s ease';
        inp.style.boxShadow = '0 0 0 3px rgba(234,88,12,.55)';
        setTimeout(() => { inp.style.boxShadow = ''; }, 1600);
      } catch (_) {}
    };

    banner.addEventListener('click', (ev) => {
      const t = ev.target.closest('[data-gate-jump]');
      if (!t) return;
      _jumpTo(document.getElementById(t.dataset.gateJump));
    });

    // Auto-jump to the first missing field so the rep lands on the
    // exact input they need to fill in, not on the modal header.
    const firstId = items.find(i => i.inputId)?.inputId;
    if (firstId) _jumpTo(document.getElementById(firstId));
  }, 30);
}

async function moveCard(id, newStage){
  const lead = (window._leads||[]).find(l=>l.id===id);
  if(!lead) return;
  // Prevent concurrent moves on the same card
  if(lead._pending){ if(typeof showToast==='function') showToast('Move in progress...','info'); return; }

  // ─── Prospect status-change trap ───
  // If the user tries to move a prospect (which shouldn't normally
  // appear on the kanban — they live on the Prospects page now), pop
  // a confirm dialog: "This is a prospect. Promote first?" so we never
  // silently graduate a prospect into the customer pipeline. The
  // exception is moves to 'lost', which we let through so reps can
  // immediately discard a dead prospect without a promote dance.
  if (lead.isProspect && !/^lost$/i.test(String(newStage || ''))) {
    // Prefer the in-app uiConfirm (works in iOS PWA standalone where
    // native confirm() can silently no-op). Fall back to native only
    // if D2D hasn't loaded yet — that's a vanishingly small window.
    let ok;
    if (window.D2D && typeof window.D2D.uiConfirm === 'function') {
      ok = await window.D2D.uiConfirm(
        `This is a prospect that hasn't been promoted yet.\n\nPromote them to a customer and move to "${newStage}"?\n\nClick Cancel to leave them as a prospect.`,
        { okLabel: 'Promote & Move', cancelLabel: 'Cancel' }
      );
    } else {
      ok = confirm(`This is a prospect that hasn't been promoted yet.\n\nPromote them to a customer and move to "${newStage}"?\n\nClick Cancel to leave them as a prospect.`);
    }
    if (!ok) {
      if (typeof showToast === 'function') showToast('Move cancelled — still a prospect', 'info');
      return;
    }
    // Promote first; promoteProspect handles the isProspect flip + serverTimestamp.
    try {
      if (typeof window.promoteProspect === 'function') {
        await window.promoteProspect(id);
      } else {
        lead.isProspect = false;
      }
    } catch (e) {
      if (typeof showToast === 'function') showToast('Promote failed: ' + e.message, 'error');
      return;
    }
    // Fall through to the normal stage-change path below.
  }

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

  // ─── Required-field gate ───
  // Block stage advancement when the destination stage has required fields
  // missing on the lead (e.g., can't move to claim_filed without claimNumber).
  // Skip for moves to 'lost' — reps need to dispose of dead leads regardless.
  // The check uses missingRequiredFields against a hypothetical lead at the
  // new stage so we evaluate the destination's requirements, not the current.
  // The helper opens the lead modal with an in-place banner listing what's
  // missing + click-to-jump anchors; see _openLeadModalWithMissingFieldsBanner
  // above for the UX rationale (banner-instead-of-flash-toast).
  if (!isLostMove && typeof window.missingRequiredFields === 'function') {
    const missing = window.missingRequiredFields({ ...lead, stage: newStage });
    if (missing.length > 0) {
      _openLeadModalWithMissingFieldsBanner(lead, newStage, missing);
      return;
    }
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

  // If the card-detail modal is open on this lead, re-populate its chips
  // so the rep sees the new stage reflected immediately (without this the
  // chip in the header bar stays on the old value until they close + reopen).
  if (typeof window.refreshCardDetailChips === 'function') {
    try { window.refreshCardDetailChips(id); } catch (_) {}
  }

  // Record stage change in history
  const historyEvent = {
    from: oldStage,
    to: newStage,
    timestamp: new Date().toISOString(),
    user: window._currentUser?.email || 'unknown'
  };
  if (isLostMove && lostReason) historyEvent.lostReason = lostReason;

  try {
    // Save to Firebase in background.
    // Cross-tab guard: previous code did a bare updateDoc which let
    // two tabs viewing the same lead each fire `arrayUnion` on
    // stageHistory and a fresh stageStartedAt — duplicate "Stage moved"
    // notes appeared on the timeline and the days-in-stage badge
    // reset to whichever serverTimestamp landed last. Use a Firestore
    // transaction that aborts if the server's `stage` no longer
    // matches the `oldStage` we expect — that means another tab beat
    // us, and we should NOT re-apply our move.
    const leadRef = window.doc(window.db, 'leads', id);
    if (typeof window.runTransaction === 'function') {
      await window.runTransaction(window.db, async (tx) => {
        const snap = await tx.get(leadRef);
        if (!snap.exists()) throw new Error('Lead not found');
        const cur = snap.data() || {};
        // Stage already matches — another tab won. No-op write but
        // throw so the catch path can restore our optimistic state.
        if (cur.stage === newStage) {
          throw new Error('STAGE_RACE_NOOP');
        }
        // Only enforce the from-stage check when we actually have one
        // recorded; brand-new optimistic-inserted leads can have
        // undefined `lead.stage` locally even though Firestore has
        // already settled on 'New'. Treat undefined as "trust me".
        if (oldStage && cur.stage && cur.stage !== oldStage) {
          throw new Error('STAGE_RACE_LOST');
        }
        const payload = {
          stage: newStage,
          updatedAt: window.serverTimestamp(),
          stageStartedAt: window.serverTimestamp(),
          stageHistory: window.arrayUnion(historyEvent)
        };
        if (isLostMove) {
          payload.closedAt = window.serverTimestamp();
          if (lostReason) payload.lostReason = lostReason;
        }
        tx.update(leadRef, payload);
      });
    } else {
      // Fallback for any page where runTransaction isn't exposed yet.
      const updatePayload = {
        stage: newStage,
        updatedAt: window.serverTimestamp(),
        stageStartedAt: window.serverTimestamp(),
        stageHistory: window.arrayUnion(historyEvent)
      };
      if (isLostMove) {
        updatePayload.closedAt = window.serverTimestamp();
        if (lostReason) updatePayload.lostReason = lostReason;
      }
      await window.updateDoc(leadRef, updatePayload);
    }
    
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

    // Render once now to reflect the success state. Wave 103: the
    // t+1s "clear success" callback used to call renderLeads again
    // — full re-serialize of every card on every move just to drop
    // a class on one element. Replaced with a targeted DOM update
    // so the success badge fades on its own card without re-render.
    renderLeads(window._leads, window._filteredLeads);
    setTimeout(() => {
      delete lead._syncSuccess;
      try {
        const card = document.querySelector(`.k-card[data-id="${(window.CSS && CSS.escape) ? CSS.escape(id) : id}"]`);
        if (card) card.classList.remove('k-card-sync-success');
      } catch (_) { /* fall back to next nbd:data-refreshed cycle */ }
    }, 1000);
    
  } catch(e){
    console.error('moveCard error',e);

    // ══════════════════════════════════════════════
    // ROLLBACK — Revert UI if Firebase fails
    // ══════════════════════════════════════════════
    // STAGE_RACE_NOOP: another tab already moved this card to the
    // same stage we wanted. The destination is correct — clear the
    // syncing flag and pull the latest doc so we agree with Firestore.
    if (e && e.message === 'STAGE_RACE_NOOP') {
      lead._syncing = false;
      delete lead._pending;
      try { await loadLeads(); } catch(_) {}
      return;
    }
    // STAGE_RACE_LOST: another tab moved this card to a DIFFERENT
    // stage. Don't override their move — restore from Firestore so
    // the kanban reflects the actual stored stage.
    if (e && e.message === 'STAGE_RACE_LOST') {
      lead._syncing = false;
      delete lead._pending;
      if (typeof window.showToast === 'function') {
        window.showToast('Another tab moved this card — refreshed.', 'info');
      }
      try { await loadLeads(); } catch(_) {}
      return;
    }

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

/**
 * Change a lead's classification (jobType) — Insurance / Cash / Finance /
 * Warranty / Service. Mirrors moveCard's optimistic-update + rollback
 * pattern but leaves `stage` alone; resolveColumn() handles cross-track
 * display in the kanban. We log a timeline note so the change is auditable.
 */
async function changeLeadType(id, newType){
  const lead = (window._leads||[]).find(l=>l.id===id);
  if(!lead) return;
  if(lead._pending){ if(typeof showToast==='function') showToast('Change in progress...','info'); return; }

  const oldType = lead.jobType || (typeof window.inferJobType==='function' ? window.inferJobType(lead) : null) || '';
  if(oldType === newType){ return; }

  // Validate against known types so a typo can't write garbage to Firestore.
  const validTypes = Object.keys(window.JOB_TYPE_META || {});
  if(validTypes.length && !validTypes.includes(newType)){
    if(typeof showToast==='function') showToast(`Unknown classification: ${newType}`,'error');
    return;
  }

  lead._pending = true;

  lead.jobType = newType;
  lead._syncing = true;
  renderLeads(window._leads, window._filteredLeads);

  // Mirror moveCard: refresh the open detail modal so the type chip
  // reflects the new classification right away.
  if (typeof window.refreshCardDetailChips === 'function') {
    try { window.refreshCardDetailChips(id); } catch (_) {}
  }

  const oldLabel = (window.JOB_TYPE_META?.[oldType]?.label) || oldType || 'Unset';
  const newLabel = (window.JOB_TYPE_META?.[newType]?.label) || newType;

  try{
    const leadRef = window.doc(window.db, 'leads', id);
    await window.updateDoc(leadRef, {
      jobType: newType,
      updatedAt: window.serverTimestamp()
    });

    // Auto-log activity note for timeline (best-effort, matches moveCard).
    try{
      await window.addDoc(window.collection(window.db, 'notes'), {
        leadId: id,
        userId: window._user?.uid,
        text: `Classification changed: ${oldLabel} → ${newLabel}`,
        type: 'type_change',
        createdAt: window.serverTimestamp(),
        createdBy: window._user?.email || 'system'
      });
    } catch(e){ console.warn('Activity log write failed:', e.message); }

    lead._syncing = false;
    lead._syncSuccess = true;
    delete lead._pending;
    renderLeads(window._leads, window._filteredLeads);
    setTimeout(() => {
      delete lead._syncSuccess;
      try{
        const card = document.querySelector(`.k-card[data-id="${(window.CSS && CSS.escape) ? CSS.escape(id) : id}"]`);
        if(card) card.classList.remove('k-card-sync-success');
      } catch(_){}
    }, 1000);

    if(typeof showToast==='function') showToast(`Classification → ${newLabel}`, 'success');
  } catch(e){
    console.error('changeLeadType error', e);
    lead.jobType = oldType || undefined;
    lead._syncing = false;
    lead._syncError = true;
    delete lead._pending;
    renderLeads(window._leads, window._filteredLeads);
    if(typeof window.showToast==='function'){
      window.showToast({
        message: `Failed to change classification to ${newLabel}. Reverted.`,
        type: 'error',
        duration: 5000,
        undoAction: () => { changeLeadType(id, newType); },
        undoText: 'Retry'
      });
    }
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
    // T2: ⋮ overflow opens the existing kanban context menu next to the
    // button. Same set of actions (View / Edit / Add Task / Call / Copy /
    // Maps / Delete) the user gets from right-click and long-press, just
    // accessible via a visible tap target. We pass the button's bounding
    // rect so the menu anchors next to it instead of at (100, 100).
    'card-overflow':(el, ev)  => {
      if (!window.KanbanContextMenu || typeof window.KanbanContextMenu.open !== 'function') return;
      const r = el.getBoundingClientRect();
      window.KanbanContextMenu.open(el.dataset.id, r.right, r.bottom);
    },
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
