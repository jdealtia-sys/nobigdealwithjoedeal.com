  import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
  import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";
  import { getAuth, onAuthStateChanged, signOut, updateProfile, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
  import { getFirestore, collection, addDoc, getDocs, getDoc, updateDoc, deleteDoc, doc, orderBy, query, serverTimestamp, where, arrayUnion, limit, setDoc, writeBatch, runTransaction, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
  import { getStorage, ref, uploadBytes, getDownloadURL, listAll } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

  // ═══ GLOBAL CRM STATE (MUST BE TOP-LEVEL) ═══
  // Per S27 architectural rule: All CRM global state declared before any function definitions
  // NOTE: Module scope is isolated - must expose to window for global access
  import {
    S, STAGE_META, LEGACY_MAP, KANBAN_VIEWS,
    VIEW_SIMPLE, VIEW_INSURANCE, VIEW_CASH, VIEW_FINANCE, VIEW_JOBS,
    normalizeStage, stageLabel, stageColor, resolveColumn,
    stageOptionsForType, inferJobType, JOB_TYPES, tagClass as _tagClass
  } from './js/crm-stages.js';

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
          <div class="kcol-count" id="kcount-${stageKey}">0</div>
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
      if (jobType === 'insurance') {
        if (label.includes('cash') || label.includes('finance')) show = false;
      } else if (jobType === 'cash') {
        if (label.includes('insurance') || label.includes('finance')) show = false;
      } else if (jobType === 'finance') {
        if (label.includes('insurance') || label.includes('cash')) show = false;
      }
      // jobType === '' → show everything
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

  document.documentElement.style.visibility="hidden";
  const app     = initializeApp(firebaseConfig);

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
  if (APP_CHECK_KEY) {
    try {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(APP_CHECK_KEY),
        isTokenAutoRefreshEnabled: true
      });
    } catch (e) {
      console.error('App Check init failed:', e);
    }
  } else {
    console.warn('App Check not configured. Set window.__NBD_APP_CHECK_KEY via the meta tag in dashboard.html <head>. Callable functions with enforceAppCheck: true WILL reject these requests in production.');
  }

  const auth    = getAuth(app);
  const db      = getFirestore(app);
  const storage = getStorage(app);

  // CRITICAL: Expose Firebase functions to window for drag & drop and other global handlers
  window.db = db;
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
  window.sendPasswordResetEmail = sendPasswordResetEmail;

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
    // Check if user has active subscription (unless demo account)
    const isDemoAccount = user.email === 'demo@nobigdeal.pro';
    
    if (!isDemoAccount) {
      // Subscription check — SOFT. Never block the dashboard load.
      // The billing-gate module handles limits via soft gates.
      // Access code users, free tier, and trial users all have no
      // subscription doc — that's normal, not an error.
      try {
        const subSnap = await getDoc(doc(db, 'subscriptions', user.uid));
        if (subSnap.exists()) {
          const subscription = subSnap.data();
          window._subscription = subscription;
          window._userPlan = subscription.plan || 'free';
          try { localStorage.setItem('nbd_user_plan', subscription.plan); } catch(e) {}
          console.log('✓ Subscription:', subscription.plan, subscription.status);
        } else {
          // No subscription doc — normal for access code / free tier users
          window._subscription = { plan: 'free', status: 'active' };
          window._userPlan = 'free';
          console.log('No subscription doc — defaulting to free tier');
        }
      } catch (error) {
        // Fail open — don't block the app for a Firestore hiccup
        console.warn('Subscription check failed — failing open:', error.message);
        window._subscription = { plan: 'free', status: 'active', _failOpen: true };
        window._userPlan = 'free';
      }
    } else {
      // Demo account - grant access
      window._userPlan = 'professional';
      window._subscription = { plan: 'professional', status: 'active' };
      console.log('Demo account access granted');
    }
    
    document.documentElement.style.visibility="visible";
    
    // Show upgrade banner for lite users
    if (window._userPlan === 'lite') {
      setTimeout(() => {
        const banner = document.createElement('div');
        banner.id = 'liteBanner';
        banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:9999;background:linear-gradient(90deg,var(--s),var(--s2));border-top:2px solid var(--orange);padding:10px 20px;display:flex;align-items:center;justify-content:center;gap:12px;font-size:12px;color:rgba(255,255,255,.8);';
        banner.innerHTML = `
          <span>🚀 You're on <strong style="color:var(--orange);">NBD Pro Lite</strong> (25 leads max)</span>
          <a href="/pro/landing.html#pricing" style="background:var(--orange);color:white;padding:6px 16px;border-radius:6px;text-decoration:none;font-weight:700;font-size:11px;">Upgrade to Pro →</a>
          <button onclick="this.parentElement.remove()" style="background:none;border:none;color:rgba(255,255,255,.4);cursor:pointer;font-size:16px;margin-left:8px;">✕</button>
        `;
        document.body.appendChild(banner);
      }, 2000);
    }
    window._user = user;
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
    requestNotifPermission();
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
            if (typeof openWarrantyCertWizard === 'function') openWarrantyCertWizard(data);
          });
        }, 800);
      }
    } catch(e) {}
    // If subscription check failed open, show a subtle non-blocking warning
    if (window._subscription?._failOpen) {
      setTimeout(() => showToast('Subscription check had a hiccup - you are in. Refreshing will resolve it.', 'warning'), 2000);
    }
    // Show onboarding for new users — delay enough for all data to settle
    setTimeout(() => {
      if (typeof checkAndShowOnboarding === 'function') checkAndShowOnboarding();
    }, 1500);
    const name = user.displayName || user.email.split('@')[0];
    document.getElementById('userName').textContent   = name;
    document.getElementById('userAvatar').textContent = name[0].toUpperCase();
    document.getElementById('dashName').textContent   = name;
    const homeGreet = document.getElementById('homeGreeting');
    if(homeGreet) homeGreet.textContent = 'Welcome Back, ' + name.split(' ')[0];
    document.getElementById('settingsName').value     = user.displayName || '';
    document.getElementById('settingsEmail').value    = user.email || '';
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
      // Retry renderLeads in case crm.js (deferred) hasn't loaded yet
      function retryRender() {
        if (typeof renderLeads === 'function' && window._leads?.length) {
          renderLeads(window._leads);
          if (typeof restoreCrmSearch === 'function') restoreCrmSearch();
          if (typeof updatePipeline === 'function') updatePipeline(window._leads);
          if (typeof calculateWeeklyStats === 'function') calculateWeeklyStats();
          if (typeof refreshTrashBadge === 'function') refreshTrashBadge();
          if (typeof renderKPIRow === 'function') renderKPIRow();
          if (window.NBDWidgets) window.NBDWidgets.render();
          return true;
        }
        return false;
      }
      // Try immediately, then retry at 1s, 2s, 4s until crm.js loads
      if (!retryRender()) {
        setTimeout(() => { if (!retryRender()) {
          setTimeout(() => { if (!retryRender()) {
            setTimeout(retryRender, 4000);
          }}, 2000);
        }}, 1000);
      }
    });
    loadEstimates(); loadPins();
    // B3: wire the live estimates listener so signature webhook
    // updates + V2 saves land in the UI without a reload.
    if (typeof window._subscribeEstimates === 'function') {
      try { window._subscribeEstimates(); } catch (e) { /* degrade to one-shot */ }
    }
    // D9: register device fingerprint so new-device sign-ins fire
    // a Slack alert. Fire-and-forget — failure is non-fatal.
    (async () => {
      try {
        const mod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
        const fns = mod.getFunctions();
        const fn = mod.httpsCallable(fns, 'registerDeviceFingerprint');
        const fp = [
          screen.width + 'x' + screen.height,
          navigator.language,
          new Date().getTimezoneOffset(),
          (navigator.hardwareConcurrency || ''),
          (navigator.deviceMemory || '')
        ].join('|');
        await fn({ fingerprint: fp, userAgent: (navigator.userAgent || '').slice(0, 400) });
      } catch (e) { /* silent */ }
    })();
    
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
  document.addEventListener('keydown', (e) => {
    // Don't trigger if user is typing in input/textarea
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    
    // ESC - Close modals
    if (e.key === 'Escape') {
      closeLeadModal();
      closeCardDetailModal();
      closeTaskModal();
    }
    
    // N - New lead (toggleable)
    if ((e.key === 'n' || e.key === 'N') && isHotkeyEnabled('hk_n')) {
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
      <div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.8);z-index:99999;display:flex;align-items:center;justify-content:center;" onclick="this.remove()">
        <div style="background:var(--s);border:1px solid var(--br);border-radius:12px;padding:24px;max-width:400px;width:90%;" onclick="event.stopPropagation()">
          <div style="font-size:18px;font-weight:700;margin-bottom:16px;font-family:'Barlow Condensed',sans-serif;">⌨️ Keyboard Shortcuts</div>
          <div style="display:grid;grid-template-columns:auto 1fr;gap:8px 16px;font-size:13px;">
            <kbd style="background:var(--s2);border:1px solid var(--br);border-radius:4px;padding:4px 8px;font-family:'DM Mono',monospace;font-size:11px;">N</kbd>
            <span>New Lead</span>
            <kbd style="background:var(--s2);border:1px solid var(--br);border-radius:4px;padding:4px 8px;font-family:'DM Mono',monospace;font-size:11px;">E</kbd>
            <span>New Estimate</span>
            <kbd style="background:var(--s2);border:1px solid var(--br);border-radius:4px;padding:4px 8px;font-family:'DM Mono',monospace;font-size:11px;">/</kbd>
            <span>Focus Search</span>
            <kbd style="background:var(--s2);border:1px solid var(--br);border-radius:4px;padding:4px 8px;font-family:'DM Mono',monospace;font-size:11px;">ESC</kbd>
            <span>Close Modals</span>
            <kbd style="background:var(--s2);border:1px solid var(--br);border-radius:4px;padding:4px 8px;font-family:'DM Mono',monospace;font-size:11px;">?</kbd>
            <span>Show This Help</span>
          </div>
          <button class="btn btn-orange" style="width:100%;margin-top:16px;justify-content:center;" onclick="this.closest('div[style*=fixed]').remove()">Got it</button>
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
      list.innerHTML = recent.map(r => {
        const lead = leads.find(l => l.id === r.id);
        if (!lead) return '';
        const name = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'Unknown';
        const shortAddr = (lead.address || '').split(',')[0];
        return `
          <div class="nbd-recent-row" data-id="${e(r.id)}" style="padding:6px 8px;border-radius:6px;cursor:pointer;transition:background .15s;font-size:12px;"
               onmouseover="this.style.background='var(--s2)'"
               onmouseout="this.style.background='transparent'">
            <div style="font-weight:600;margin-bottom:2px;">${e(name)}</div>
            <div style="font-size:10px;color:var(--m);">${e(shortAddr)}</div>
          </div>
        `;
      }).filter(Boolean).join('');
      list.querySelectorAll('.nbd-recent-row').forEach(row => {
        row.addEventListener('click', () => {
          const id = row.dataset.id;
          if (id) window.location.href = '/pro/customer.html?id=' + encodeURIComponent(id);
        });
      });
    } catch (e) {
      console.error('Failed to render recent:', e);
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

  // Polls window._user?.uid until it resolves or the timeout expires.
  // Avoids the fragile 1-second blind sleep when loadLeads() is called
  // from contexts where onAuthStateChanged may not have fired yet.
  function _waitForUid(timeoutMs = 5000) {
    const uid = window._user?.uid;
    if (uid) return Promise.resolve(uid);
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const iv = setInterval(() => {
        const u = window._user?.uid;
        if (u) { clearInterval(iv); resolve(u); }
        else if (Date.now() - start >= timeoutMs) { clearInterval(iv); reject(new Error('Auth timeout')); }
      }, 100);
    });
  }

  async function loadLeads() {
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
      let uid;
      try {
        uid = await _waitForUid(5000);
      } catch (_) {
        console.error('❌ loadLeads: Still no user after 5s — auth failure');
        window._leads = [];
        if (healthBadge) {
          healthBadge.className = 'health-indicator error';
          healthBadge.title = 'CRM Error: Authentication failed';
        }
        if (typeof renderLeads === 'function') renderLeads([]);
        return;
      }

      const snap = await getDocs(query(collection(db,'leads'), where('userId','==',uid)));
      
      window._leads = snap.docs
        .map(d => ({id:d.id,...d.data()}))
        .filter(l => !l.deleted)
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
      
      // Update health indicator to healthy
      if (healthBadge) {
        healthBadge.className = 'health-indicator healthy';
        healthBadge.title = `CRM Connected • ${window._leads.length} leads loaded`;
      }
      
    } catch(e) {
      console.error('❌ loadLeads failed:', e.message, e.code, e);
      console.error('Full error:', e);
      window._leads = [];
      
      // Update health indicator to error
      if (healthBadge) {
        healthBadge.className = 'health-indicator error';
        const errorMsg = e.code === 'permission-denied' 
          ? 'CRM Error: Firestore rules blocking access' 
          : `CRM Error: ${e.message}`;
        healthBadge.title = errorMsg;
      }
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
    if (typeof renderLeads === 'function') {
      renderLeads(window._leads); 
      restoreCrmSearch();
      updatePipeline(window._leads);
      calculateWeeklyStats();
    } else {
      console.warn('⚠️ renderLeads not loaded yet - crm.js may not be loaded');
      // Retry after crm.js loads
      setTimeout(() => {
        if (typeof renderLeads === 'function') {
          renderLeads(window._leads);
          restoreCrmSearch();
          updatePipeline(window._leads);
          calculateWeeklyStats();
        }
      }, 500);
    }
    // Fire follow-up notifications after leads are fresh
    setTimeout(() => checkAndCreateFollowUpNotifications(window._leads), 1200);
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
    // Init supplier pricing database
    // SupplierPricing archived (see js/_archive/) — feature disabled
  }
  window._loadLeads = loadLeads;
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
  
  // Capture console logs for debug panel
  if (!window._debugLogs) {
    window._debugLogs = [];
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    
    // Safe stringify — Firebase internals can have circular references that
    // crash JSON.stringify. Fall back to String() when that happens.
    function _safeStr(a) {
      if (typeof a !== 'object' || a === null) return String(a);
      try { return JSON.stringify(a); } catch (_) { return String(a); }
    }

    console.log = function(...args) {
      const msg = args.map(_safeStr).join(' ');
      if (msg.includes('loadLeads') || msg.includes('CRM') || msg.includes('🔍') || msg.includes('✅') || msg.includes('❌')) {
        window._debugLogs.push(`[LOG] ${msg}`);
        if (window._debugLogs.length > 50) window._debugLogs.shift(); // Keep last 50
      }
      originalLog.apply(console, args);
    };

    console.warn = function(...args) {
      const msg = args.map(_safeStr).join(' ');
      if (msg.includes('loadLeads') || msg.includes('CRM') || msg.includes('⚠️')) {
        window._debugLogs.push(`[WARN] ${msg}`);
        if (window._debugLogs.length > 50) window._debugLogs.shift();
      }
      originalWarn.apply(console, args);
    };

    console.error = function(...args) {
      const msg = args.map(_safeStr).join(' ');
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
    
    // Update DOM
    document.getElementById('weekNewLeads').textContent = newLeads.length;
    document.getElementById('weekEstimates').textContent = newEstimates.length;
    document.getElementById('weekRevenue').textContent = '$' + weekRevenue.toLocaleString();
    document.getElementById('weekTasks').textContent = weekTasks;
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
              
              // Save lead first to get ID
              const leadRef = await addDoc(collection(db,'leads'), {
                ...data, 
                createdAt: serverTimestamp(), 
                userId: window._user?.uid
              });
              
              // Now save pin with leadId
              pinData.leadId = leadRef.id;
              await window._savePin(pinData);

              // Auto-assign customer ID (NBD-0001 format)
              try {
                const counterRef = doc(db, 'counters', 'customerIds');
                const custId = await runTransaction(db, async (tx) => {
                  const snap = await tx.get(counterRef);
                  let nextNum = snap.exists() ? (snap.data().next || 0) + 1 : 1;
                  tx.set(counterRef, { next: nextNum }, { merge: true });
                  return 'NBD-' + String(nextNum).padStart(4, '0');
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
              return;
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
        const fallbackRef = await addDoc(collection(db,'leads'), {
          ...data,
          createdAt: serverTimestamp(),
          userId: window._user?.uid
        });
        // Auto-assign customer ID
        try {
          const counterRef = doc(db, 'counters', 'customerIds');
          const custId = await runTransaction(db, async (tx) => {
            const snap = await tx.get(counterRef);
            let nextNum = snap.exists() ? (snap.data().next || 0) + 1 : 1;
            tx.set(counterRef, { next: nextNum }, { merge: true });
            return 'NBD-' + String(nextNum).padStart(4, '0');
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
      } else {
        // EDIT EXISTING: Just update
        await updateDoc(doc(db,'leads',editId), {
          ...data, 
          updatedAt: serverTimestamp()
        });
      }
    } catch(e) {
      console.error('saveLead error:', e);
      (window._leads||[]).unshift({id:'d-'+Date.now(),...data,createdAt:new Date()});
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
  }
  window._loadEstimates = loadEstimates;

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
    } catch(e) { console.error('Save estimate error:', e); return null; }
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
    try {
      await updateProfile(window._user, {displayName: name});
      document.getElementById('userName').textContent = name;
      // Persist Cal.com username on the user profile.
      if (window.db && window.doc && window.setDoc) {
        await window.setDoc(window.doc(window.db, 'users', window._user.uid), {
          displayName: name,
          calcomUsername
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
  // NOTIFICATION SETTINGS
  // ═════════════════════════════════════════════════════════
  const NOTIF_TRIGGERS = ['notifOverdue','notifHot','notifStorm','notifApproval','notifInbound','notifD2d'];
  const NOTIF_CHANNELS = ['chInApp','chPush','chEmail','chSms'];

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

  window._loadNotifSettings = function() {
    try {
      const raw = localStorage.getItem('nbd_notif_settings');
      if (!raw) return;
      const data = JSON.parse(raw);
      const modeEl = document.getElementById('notif' + (data.mode || 'critical').charAt(0).toUpperCase() + (data.mode || 'critical').slice(1));
      if (modeEl) modeEl.checked = true;
      if (data.triggers) {
        NOTIF_TRIGGERS.forEach(id => {
          const el = document.getElementById(id);
          if (el && data.triggers[id] != null) el.checked = data.triggers[id];
        });
      }
      if (data.channels) {
        NOTIF_CHANNELS.forEach(id => {
          const el = document.getElementById(id);
          if (el && data.channels[id] != null) el.checked = data.channels[id];
        });
      }
    } catch (e) {}
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
