
let toggleCustomerPhotoReorder, _lightboxIndex, _lightboxSource; // module-local (globals Tranche 1 — was window.*)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, getDocs, getDoc, doc, query, orderBy, where, updateDoc, deleteDoc, serverTimestamp, addDoc, arrayUnion, arrayRemove, limit, runTransaction, setDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, ref, uploadBytesResumable, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { connectEmulatorsIfLocal } from "./nbd-emulator-connect.js"; // Audit #3: localhost-only, no-op in prod

const firebaseConfig = {
  apiKey: "AIzaSyDTrotINzl2YjdGbH25BpC-FPv8i_fXNvg",
  authDomain: "nobigdeal-pro.firebaseapp.com",
  projectId: "nobigdeal-pro",
  storageBucket: "nobigdeal-pro.firebasestorage.app",
  messagingSenderId: "717435841570",
  appId: "1:717435841570:web:c2338e11052c96fde02e7b"
};

const app = initializeApp(firebaseConfig);
// App Check (NEW-D20): init BEFORE any callable fires so requests carry a
// real App Check token. replyToPortalMessage (and createPortalToken) are
// onCall with enforceAppCheck:true and reject with 'unauthenticated' in
// production without it. Mirrors dashboard-bootstrap.module.js. The site key
// is set by the classic js/dashboard-appcheck-config.js script in <head>.
const __APP_CHECK_KEY = (window.__NBD_APP_CHECK_KEY || '').trim();
if (__APP_CHECK_KEY && !window.__NBD_APP_CHECK_INITIALIZED) {
  try {
    // Expose instance so NBDComms / claude-proxy can attach App Check headers.
    window.__NBD_APP_CHECK = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(__APP_CHECK_KEY),
      isTokenAutoRefreshEnabled: true
    });
    window.__NBD_APP_CHECK_INITIALIZED = true;
  } catch (e) {
    console.error('[customer] App Check init failed:', e);
  }
} else if (!__APP_CHECK_KEY) {
  console.warn('[customer] App Check not configured — callables with enforceAppCheck WILL reject in production.');
}
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
await connectEmulatorsIfLocal({ auth, db, storage }); // Audit #3: localhost-only, no-op in prod

// Make them globally accessible
// Expose Firebase to window scope for cross-boundary access
window.db = db;
window.auth = auth;
window.storage = storage;
window.getDoc = getDoc;
window.getDocs = getDocs;
window.doc = doc;
window.query = query;
window.orderBy = orderBy;
window.where = where;
window.limit = limit;
window.updateDoc = updateDoc;
window.writeBatch = writeBatch;
window.arrayUnion = arrayUnion;
window.arrayRemove = arrayRemove;
window.addDoc = addDoc;
    window.deleteDoc = deleteDoc;
window.collection = collection;
window.serverTimestamp = serverTimestamp;
window.ref = ref;
window.uploadBytesResumable = uploadBytesResumable;
window.uploadBytes = uploadBytes;
window.getDownloadURL = getDownloadURL;

// Initialize globals needed by external modules (customer-portal, photo-report, review-engine, profit-tracker)
window._user = null;  // Set in onAuthStateChanged
window._leads = [];   // Populated with current customer data

// ── iOS bfcache reload guard ──
// Same fix as dashboard.html — when iOS restores this page from bfcache
// (swipe-up close → reopen), the Firestore SDK's connection is dead.
// Force a fresh navigation so loadCustomerData gets a live connection
// instead of hanging on a zombie WebSocket.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    console.log('[bfcache] customer page restored from bfcache — reloading');
    window.location.reload();
  }
});

// Auth guard
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // Flush per-uid IDB cache so a future signin to a different
    // account doesn't read the previous rep's leftovers. Best-effort.
    try { window.NBDIDBCache && window.NBDIDBCache.clearAll(); } catch (_) {}
    window.location.href = '/pro/login.html';
    return;
  }

  // CRITICAL: Set global _user for external modules (customer-portal, photo-report, review-engine, profit-tracker)
  window._user = user;

  // window._userClaims is the tenant/role record every team-scoped reader on
  // this page branches on — and NOTHING on customer.html was setting it. Its
  // only three writers repo-wide (billing-gate.js, dashboard-bootstrap.module.js,
  // nbd-auth.js) are all dashboard-side, so here it stayed undefined and every
  // consumer's `window._userClaims || {}` fallback silently selected the
  // owner-only branch of a deliberate owner-vs-team fork.
  //
  // The effect is invisible to a solo operator (companyId === uid makes both
  // branches identical) and wrong for everyone else: a company_admin or manager
  // opening a rep's job saw an empty Invoices panel, an empty Communication Log,
  // an empty photo gallery, understated job costs in the Profit panel, and a
  // "Read-only — this customer belongs to a teammate" banner they should never
  // get. Firestore would have served all of it — the rules already allow it
  // (leads/invoices/expenses are company-readable); the queries just never
  // asked for the team scope.
  //
  // Awaited, not fire-and-forget: the hydration below reads these branches, so
  // resolving late would still render the owner-only view. getIdTokenResult()
  // is served from the in-memory token unless it is expiring, so this does not
  // add a round trip on a normal load. Failure is non-fatal — falling back to
  // {} is exactly today's behaviour, so a token hiccup degrades to owner-scope
  // rather than blocking the page.
  try {
    const _tr = await user.getIdTokenResult();
    window._userClaims = (_tr && _tr.claims) || {};
  } catch (_) {
    window._userClaims = window._userClaims || {};
  }
  // Fetch the shop-wide Company Profile so generated docs use the rep's
  // saved legal text / financing / marketing. Fire-and-forget — defaults
  // are already in window._companyProfile.
  if (typeof window._loadCompanyProfile === 'function') {
    window._loadCompanyProfile().catch(() => {});
  }
  // Partition the IDB cache by uid so two reps sharing a device
  // don't bleed cached lead/photo data across accounts.
  try { window.NBDIDBCache && window.NBDIDBCache.setActiveUid(user.uid); } catch (_) {}

  // Get customer ID from URL
  const params = new URLSearchParams(window.location.search);
  const customerId = params.get('id');

  if (!customerId) return;

  // Bug fix 2026-05-05: on iOS Safari (especially as a PWA), the first
  // getDoc after a fresh navigation occasionally hangs forever instead of
  // rejecting — the page just sits behind opacity:0 with no error. We
  // surface a "Connection is slow — Tap to retry" overlay after 8s so
  // the user has a visible escape hatch. Tapping it forces a hard reload,
  // which renegotiates the Firestore long-poll.
  const slowLoadWatchdog = setTimeout(() => {
    if (document.documentElement.style.opacity !== '1') {
      try { showSlowLoadHint(); } catch (e) { console.warn(e); }
    }
  }, 8000);

  try {
    await loadCustomerData(customerId);
    clearTimeout(slowLoadWatchdog);
    hideSlowLoadHint();
    document.documentElement.style.opacity = '1';
  } catch (error) {
    clearTimeout(slowLoadWatchdog);
    hideSlowLoadHint();
    console.error('Critical error:', error);
    document.documentElement.style.opacity = '1';
    showError('Something went wrong', 'Unable to load customer data. Please try again.');
  }
});

// ── Slow-load hint UI (escape hatch for hung iOS connections) ──
function showSlowLoadHint() {
  if (document.getElementById('slow-load-hint')) return;
  const overlay = document.createElement('div');
  overlay.id = 'slow-load-hint';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,18,25,0.94);z-index:var(--z-overlay);display:flex;align-items:center;justify-content:center;padding:24px;opacity:1;';
  overlay.innerHTML = `
    <div style="max-width:380px;text-align:center;color:var(--t);font-family:'Barlow',-apple-system,system-ui,sans-serif;">
      <div style="font-size:32px;margin-bottom:12px;">⏳</div>
      <div style="font-size:18px;font-weight:600;margin-bottom:8px;">Loading is taking a while</div>
      <div style="font-size:14px;color:var(--m);line-height:1.5;margin-bottom:20px;">
        This usually means the connection went stale (common on iOS after switching apps). Tap below to refresh — your data is safe.
      </div>
      <button id="slow-load-retry" style="
        background:var(--orange);
        color:#fff;border:none;padding:14px 28px;border-radius:8px;
        font-size:15px;font-weight:600;cursor:pointer;
        box-shadow:0 4px 12px rgba(200,84,26,0.3);
        -webkit-tap-highlight-color:transparent;">Refresh now</button>
      <div style="margin-top:14px;">
        <button id="slow-load-back" style="
          background:transparent;color:var(--m);border:1px solid var(--br);
          padding:10px 22px;border-radius:8px;font-size:13px;cursor:pointer;
          -webkit-tap-highlight-color:transparent;">← Back to dashboard</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const retry = document.getElementById('slow-load-retry');
  if (retry) retry.addEventListener('click', () => window.location.reload(), { once: true });
  const back = document.getElementById('slow-load-back');
  if (back) back.addEventListener('click', () => { window.location.href = '/pro/dashboard'; }, { once: true });
}
function hideSlowLoadHint() {
  const el = document.getElementById('slow-load-hint');
  if (el) el.remove();
}

// Wave 11 (2026-05-05): consume the handoff stashed by dashboard.html
// before navigation. If we have it, we can skip the initial Firestore
// getDoc entirely and render the page from already-loaded data —
// eliminating the iOS Safari cold-start hang. The handoff is age-
// limited (5 minutes) so a stale tab doesn't render ancient data.
//
// Audit CA defense-in-depth: also verify the handoff's userId matches
// the signed-in user. sessionStorage is shared across signin/signout
// in the same tab, so Rep A could stash a lead, fail to navigate, sign
// out; Rep B signs in same tab and visits the same lead URL — without
// this check Rep B would see Rep A's stashed lead. Firestore rules
// would deny the background revalidate, but the cached data already
// rendered. Fall back to Firestore (which fails closed) on mismatch.
function _readLeadHandoff(id) {
  try {
    const raw = sessionStorage.getItem('nbd_lead_handoff_' + id);
    if (!raw) return null;
    sessionStorage.removeItem('nbd_lead_handoff_' + id); // one-shot
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.lead) return null;
    if (typeof parsed.stashedAt === 'number' && Date.now() - parsed.stashedAt > 5 * 60 * 1000) {
      return null; // too old; fall back to Firestore
    }
    // Audit CA: reject handoff if the cached userId doesn't match the
    // currently signed-in user. Defense-in-depth — Firestore rules
    // still fail closed for non-owners on the cold path.
    const currentUid = window._user && window._user.uid;
    if (currentUid && parsed.lead.userId && parsed.lead.userId !== currentUid) {
      console.warn('[customer] handoff userId mismatch — ignoring stash');
      return null;
    }
    // Rehydrate Timestamp markers we serialized as { __ts: ms }.
    const out = { id };
    for (const k of Object.keys(parsed.lead)) {
      const v = parsed.lead[k];
      if (v && typeof v === 'object' && typeof v.__ts === 'number') {
        out[k] = { toMillis: () => v.__ts, seconds: Math.floor(v.__ts / 1000) };
      } else {
        out[k] = v;
      }
    }
    return out;
  } catch (e) { return null; }
}

// Wave 14: background revalidate for the handoff path. Fetches the
// canonical lead from Firestore and, if it's newer than what we
// rendered, updates window._currentLead + shows a small "Refreshed"
// indicator so the rep knows fresh data has arrived. Soft-fails on
// network errors — the page already has handoff data showing and we
// don't want to surface noise when the connection flakes briefly.
//
// Defers 1.5 seconds so the initial render completes first; we don't
// want the revalidate competing with sub-loaders for the iOS
// connection.
function _revalidateLeadInBackground(id, hydratedLead) {
  const REVALIDATE_DELAY_MS = 1500;
  const REVALIDATE_TIMEOUT_MS = 12_000;
  setTimeout(async () => {
    try {
      const fetched = await Promise.race([
        getDoc(doc(db, 'leads', id)),
        new Promise((_, rej) => setTimeout(() => rej(new Error('revalidate-timeout')), REVALIDATE_TIMEOUT_MS))
      ]);
      if (!fetched || !fetched.exists?.()) return;
      const fresh = { id: fetched.id, ...fetched.data() };
      const _toMs = (v) => {
        if (!v) return 0;
        if (typeof v.toMillis === 'function') return v.toMillis();
        if (typeof v === 'object' && typeof v.__ts === 'number') return v.__ts;
        return 0;
      };
      const handoffTs = _toMs(hydratedLead.updatedAt) || _toMs(hydratedLead.createdAt);
      const freshTs   = _toMs(fresh.updatedAt)        || _toMs(fresh.createdAt);
      // Only show the indicator + swap state if the server doc is
      // demonstrably newer. If they're identical, the handoff was
      // already current; quietly noop.
      if (freshTs > 0 && handoffTs > 0 && freshTs <= handoffTs) {
        console.log('[customer] background revalidate: handoff was current');
        return;
      }
      console.log('[customer] background revalidate: fresh data found, updating');
      window._leads = [fresh];
      window._currentLead = fresh;
      window._leadDoc = fresh;
      _showRefreshedIndicator();
      // Let any module that cares re-render off the new data. Sub-
      // pages (photos, documents, estimates) have their own loaders
      // and don't need to know; we just refresh the header bits we
      // know about.
      try {
        const nameEl  = document.getElementById('customerName');
        if (nameEl) {
          const n = `${fresh.firstName || ''} ${fresh.lastName || ''}`.trim();
          if (n) nameEl.textContent = n;
        }
        const stageEl = document.getElementById('customerStage');
        if (stageEl && fresh.stage) {
          // Best-effort label refresh; falls back to raw key if we
          // don't have the STAGE_LABELS map in scope here.
          stageEl.textContent = (window.__STAGE_LABELS && window.__STAGE_LABELS[fresh.stage]) || fresh.stage;
        }
      } catch (e) { /* non-fatal */ }
    } catch (e) {
      console.warn('[customer] background revalidate failed:', e.message);
    }
  }, REVALIDATE_DELAY_MS);
}

// Small "↻ Refreshed" indicator that fades in then out. Called when
// background revalidate finds newer data than what handoff rendered.
function _showRefreshedIndicator() {
  let pill = document.getElementById('nbd-refreshed-pill');
  if (pill) {
    // Already showing — re-trigger the fade.
    pill.style.opacity = '1';
    return;
  }
  pill = document.createElement('div');
  pill.id = 'nbd-refreshed-pill';
  pill.textContent = '↻ Refreshed with latest data';
  pill.style.cssText = `
    position:fixed; top:12px; left:50%; transform:translateX(-50%);
    background:var(--s2); color:var(--t); font-family:'Barlow',-apple-system,system-ui,sans-serif;
    font-size:12px; font-weight:600; padding:8px 14px; border-radius:999px;
    box-shadow:0 4px 12px rgba(0,0,0,0.25);
    z-index:var(--z-toast); opacity:0; transition:opacity .3s ease;
    pointer-events:none;`;
  document.body.appendChild(pill);
  // Trigger fade-in on next frame.
  requestAnimationFrame(() => {
    pill.style.opacity = '1';
    // Auto-fade after 3.2s.
    setTimeout(() => {
      pill.style.opacity = '0';
      setTimeout(() => pill.remove(), 350);
    }, 3200);
  });
}

async function loadCustomerData(id) {
  try {
    // CRITICAL: Set global customerId FIRST so all sub-loaders have it
    window._customerId = id;

    // Track recently viewed
    trackRecentlyViewed(id);

    // Wave 11: try the in-memory handoff first. If present, skip the
    // initial Firestore round-trip — the page renders instantly from
    // dashboard's already-loaded copy. We still kick a background
    // revalidate after the rest of the page is wired up so any stale
    // fields catch up.
    const handoff = _readLeadHandoff(id);
    let lead;
    if (handoff) {
      console.log('[customer] hydrating from handoff cache (instant render)');
      lead = handoff;
      // Wave 14: fire a background revalidate so the page self-heals
      // if the cached lead is stale (e.g. another rep updated it
      // since the dashboard's last load). Don't await — the page is
      // already showing handoff data and we don't want to gate that
      // on a network round-trip that might hang on iOS Safari.
      _revalidateLeadInBackground(id, handoff);
    } else {
      // Cold path: fetch from Firestore.
      const leadSnap = await getDoc(doc(db, 'leads', id));
      if (!leadSnap.exists()) {
        showError('Customer not found', 'The customer you\'re looking for doesn\'t exist or has been deleted.');
        return;
      }
      lead = { id: leadSnap.id, ...leadSnap.data() };
    }


    // CRITICAL: Populate window._leads so external modules can find this lead
    window._leads = [lead];
    window._currentLead = lead;
    window._leadDoc = lead; // Used by document generator data bridge

    // ── Auto-assign Customer ID (NBD-0001 format) if missing ──
    // WRITER-ONLY (team visibility → manager edit rights, 2026-07): only
    // mint from the shared counter when THIS user can actually stamp the
    // lead — the owner, or same-company staff now that the rules'
    // staff-update clause exists. Anyone else (viewer, stale claims)
    // would burn a tenant ID in the counter transaction and then fail
    // the updateDoc, leaving permanent NBD-XXXX gaps.
    const _cidClaims = window._userClaims || {};
    const _cidCanWrite = lead.userId && window._user && (
      lead.userId === window._user.uid
      || (['company_admin', 'manager'].includes(_cidClaims.role || '')
          && !!_cidClaims.companyId && lead.companyId === _cidClaims.companyId)
    );
    if (!lead.customerId && _cidCanWrite) {
      try {
        // NBD-leak gate (2026-07-29): this mint used to race company-profile
        // hydration. The auth callback fires _loadCompanyProfile() UN-awaited
        // and reaches here synchronously on the dashboard-handoff path, so
        // _custIdPrefix() still saw the bare NBD defaults and DETERMINISTICALLY
        // stamped a non-NBD tenant's lead 'NBD-00NN' from the shared platform
        // counter (un-salted, never self-heals — mint only runs when the ID is
        // absent). Await hydration; if the profile still isn't loaded, or any
        // helper is missing (page-scoped-helper rule: a typeof fallback here is
        // a silent wrong answer, not a safety net), SKIP the mint — the badge
        // stays hidden and a later visit mints correctly.
        if (window._companyProfileLoaded !== true && typeof window._loadCompanyProfile === 'function') {
          await window._loadCompanyProfile();
        }
        if (window._companyProfileLoaded !== true
            || typeof window._custCounterId !== 'function'
            || typeof window._custIdPrefix !== 'function'
            || typeof window._formatCustomerId !== 'function') {
          throw new Error('company profile not hydrated — customer-ID mint skipped this visit');
        }
        const _cid = (lead && lead.companyId) || (window._user && window._user.uid);
        const _ctrId = window._custCounterId(_cid);
        const _pfx = window._custIdPrefix();
        const counterRef = doc(db, 'counters', _ctrId);
        const newId = await runTransaction(db, async (transaction) => {
          const counterSnap = await transaction.get(counterRef);
          let nextNum = 1;
          if (counterSnap.exists()) {
            nextNum = (counterSnap.data().next || 0) + 1;
          }
          transaction.set(counterRef, { next: nextNum }, { merge: true });
          return window._formatCustomerId(_pfx, nextNum, _cid);
        });
        await updateDoc(doc(db, 'leads', id), { customerId: newId });
        lead.customerId = newId;
        console.log('✓ Assigned customer ID:', newId);
      } catch (cidErr) {
        console.warn('Could not assign customer ID:', cidErr);
      }
    }

    // Display customer ID badge
    if (lead.customerId) {
      document.getElementById('customerIdDisplay').textContent = lead.customerId;
      document.getElementById('customerIdBadge').style.display = '';
    }

    // Read-only affordance (team visibility, 2026-07): viewers — and any
    // session that can see this lead but not write it — get an explicit
    // banner instead of edit controls that silently bounce at the rules
    // layer. Staff (company_admin/manager) genuinely edit since the
    // manager-edit-rights change, so they get no banner.
    try {
      const _roClaims = window._userClaims || {};
      const _roRole = _roClaims.role || '';
      const _roIsOwner = lead.userId && window._user && lead.userId === window._user.uid;
      const _roIsStaff = ['company_admin', 'manager'].includes(_roRole)
        && !!_roClaims.companyId && lead.companyId === _roClaims.companyId;
      // Defence in depth on top of the claims fix above. With claims
      // unresolved, _roRole is '' and this collapsed to `!_roIsOwner` — so a
      // company_admin who genuinely can edit was told the record was read-only.
      // An UNKNOWN role is not evidence of restriction: claiming "belongs to a
      // teammate" on a lead the user can in fact edit is worse than showing no
      // banner, because the banner is the only thing telling them to stop.
      // 'viewer' is still asserted positively, since that one IS a real
      // restriction the rules enforce.
      const _roReadOnly = _roRole === 'viewer'
        || (!!_roRole && !_roIsOwner && !_roIsStaff && _roRole !== 'admin');
      if (_roReadOnly && !document.getElementById('nbdReadOnlyBanner')) {
        document.body.classList.add('nbd-readonly-customer');
        const b = document.createElement('div');
        b.id = 'nbdReadOnlyBanner';
        b.setAttribute('role', 'status');
        b.style.cssText = 'position:sticky;top:0;z-index:50;background:#1e3a6e;color:#fff;'
          + 'padding:8px 14px;font-size:13px;font-weight:600;text-align:center;';
        b.textContent = _roRole === 'viewer'
          ? 'Read-only — your role can view this customer but not make changes.'
          : "Read-only — this customer belongs to a teammate.";
        document.body.prepend(b);
      }
    } catch (_) { /* affordance is best-effort — never block hydration */ }

    // Step 16: Referred-by badge — surfaces the upstream relationship
    // so the rep knows this lead came in via a past customer's share
    // link. Falls back to the customerId when the name isn't set
    // (older referrals before Step 16's name capture).
    if (lead.referredByLeadId) {
      const badge = document.getElementById('referredByBadge');
      const nameEl = document.getElementById('referredByName');
      const link = document.getElementById('referredByLink');
      if (badge && nameEl && link) {
        nameEl.textContent = lead.referredByName
          || lead.referredByCustomerId
          || 'a past customer';
        link.href = '/pro/customer.html?id=' + encodeURIComponent(lead.referredByLeadId);
        badge.style.display = '';
      }
    }

    // Populate header
    const name = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'Unknown Customer';
    document.getElementById('customerName').textContent = name;
    
    const stageBadge = document.getElementById('customerStage');
    const stage = lead.stage || 'new';
    // Display-friendly label for new stage keys
    const STAGE_LABELS = {
      'new': 'New Lead', 'contacted': 'Contacted', 'inspected': 'Inspected',
      'claim_filed': 'Claim Filed', 'adjuster_meeting_scheduled': 'Adjuster Meeting',
      'adjuster_inspection_done': 'Adjuster Done', 'scope_received': 'Scope Received',
      'estimate_submitted': 'Estimate Sent', 'supplement_requested': 'Supplement',
      'supplement_approved': 'Supp. Approved', 'contract_signed': 'Contract Signed',
      'estimate_sent_cash': 'Est. Sent (Cash)', 'negotiating': 'Negotiating',
      'prequal_sent': 'Pre-Qual Sent', 'loan_approved': 'Loan Approved',
      'job_created': 'Job Created', 'permit_pulled': 'Permit', 'materials_ordered': 'Materials Ordered',
      'materials_delivered': 'Materials Here', 'crew_scheduled': 'Crew Scheduled',
      'install_in_progress': 'Installing', 'install_complete': 'Install Done',
      'final_photos': 'Final Photos', 'deductible_collected': 'Deductible',
      'final_payment': 'Final Payment', 'closed': 'Closed', 'lost': 'Lost'
    };
    // Wave 14: expose globally so the background-revalidate label
    // refresher can resolve stage keys without redefining the map.
    window.__STAGE_LABELS = STAGE_LABELS;
    stageBadge.textContent = STAGE_LABELS[stage] || stage;
    stageBadge.className = 'stage-badge stage-' + stage.toLowerCase().replace(/[_\s]+/g, '-');

    // ── Days-in-stage badge ──
    // Spec gap closed: shows how many days the lead has sat at the
    // current stage. Pulls from lead.stageStartedAt if present, otherwise
    // falls back to updatedAt (good-enough proxy until the stage-change
    // handler in crm.js writes the dedicated field). Hidden if we can't
    // resolve a date or the stage is terminal (closed/lost).
    // R3-2: shared timestamp coercion. Firestore Timestamps arrive as
    // plain {seconds,nanoseconds} objects (no .toDate()) on REST / portal /
    // bridged-lead reads, which new Date() can't parse — that silently
    // hid the days-in-stage badge and wedged "Last Updated" on "Loading…".
    // Coerce every shape: Timestamp, {seconds}/{_seconds}, Date, ISO, epoch.
    const tsToDate = (v) => {
      if (!v) return null;
      if (typeof v.toDate === 'function') return v.toDate();
      if (v instanceof Date) return isNaN(v) ? null : v;
      if (typeof v === 'object' && (typeof v.seconds === 'number' || typeof v._seconds === 'number')) {
        const secs = (typeof v.seconds === 'number') ? v.seconds : v._seconds;
        const d = new Date(secs * 1000);
        return isNaN(d) ? null : d;
      }
      const d = new Date(v);
      return isNaN(d) ? null : d;
    };
    window._nbdTsToDate = tsToDate;

    (function renderDaysInStage() {
      const badge = document.getElementById('daysInStageBadge');
      if (!badge) return;
      const isTerminal = stage === 'closed' || stage === 'lost' || stage === 'Complete' || stage === 'Lost';
      if (isTerminal) { badge.style.display = 'none'; return; }
      const ref = tsToDate(lead.stageStartedAt) || tsToDate(lead.updatedAt) || tsToDate(lead.createdAt);
      if (!ref) { badge.style.display = 'none'; return; }
      const today = new Date(); today.setHours(0,0,0,0);
      const refNorm = new Date(ref); refNorm.setHours(0,0,0,0);
      const days = Math.max(0, Math.floor((today - refNorm) / 86400000));
      badge.textContent = days === 0 ? 'Today' : days === 1 ? '1 day in stage' : days + ' days in stage';
      // Color escalates with stagnation: <3 muted, 3-7 amber, 8+ red.
      if (days >= 8) { badge.style.color = '#fff'; badge.style.background = 'rgba(220,38,38,.85)'; badge.style.borderColor = 'rgba(220,38,38,.95)'; }
      else if (days >= 3) { badge.style.color = '#fff'; badge.style.background = 'rgba(217,119,6,.75)'; badge.style.borderColor = 'rgba(217,119,6,.85)'; }
      else { badge.style.color = 'var(--m)'; badge.style.background = 'var(--s)'; badge.style.borderColor = 'var(--br)'; }
      badge.style.display = '';
    })();

    document.getElementById('customerAddress').textContent = lead.address || '—';
    document.getElementById('customerPhone').textContent = lead.phone || '—';
    document.getElementById('customerEmail').textContent = lead.email || '—';
    
    // Last updated indicator (R3-2: tsToDate handles plain {seconds} reads)
    const updatedAt = tsToDate(lead.updatedAt) || tsToDate(lead.createdAt);
    if (updatedAt) {
      const elapsed = Date.now() - updatedAt.getTime();
      const hours = Math.floor(elapsed / (1000 * 60 * 60));
      const days = Math.floor(hours / 24);
      let timeAgo = '';
      if (days > 0) timeAgo = `Updated ${days}d ago`;
      else if (hours > 0) timeAgo = `Updated ${hours}h ago`;
      else timeAgo = 'Updated recently';
      document.getElementById('lastUpdated').innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:middle;"><circle cx="10" cy="10" r="7"/><path d="M10 6v4l2.5 2.5"/></svg> ' + timeAgo;
    }
    
    // Contact links
    if (lead.phone) {
      // Audit CC: String() coerces non-string phones (number imports
      // are common — CSV that stored '1234567890' as numeric) so
      // .replace doesn't throw and break the whole customer-header
      // render for one bad data row.
      document.getElementById('callLink').href = `tel:${String(lead.phone).replace(/\D/g, '')}`;
    }
    if (lead.email) {
      document.getElementById('emailLink').href = `mailto:${lead.email}`;
    }

    // ── Communication auto-logging: wire quick-action buttons ──
    // Mark each anchor so the crm.js delegated logger skips it (these
    // have richer inline logging and we don't want a duplicate row).
    ['callLink','emailLink','smsBookingLink','contactCallBtn','contactTextBtn','contactEmailBtn'].forEach(i => {
      const el = document.getElementById(i);
      if (el) el.dataset.nbdLogSkip = '1';
    });
    // Header Call button
    const callBtn = document.getElementById('callLink');
    if (callBtn) {
      callBtn.onclick = () => {
        logCommunication(id, 'call', `Called ${lead.firstName || lead.name || 'customer'} at ${lead.phone || ''}`.trim());
      };
    }
    // Header Email button
    const emailBtn = document.getElementById('emailLink');
    if (emailBtn) {
      emailBtn.onclick = () => {
        logCommunication(id, 'email', `Opened email to ${lead.firstName || lead.name || 'customer'} (${lead.email || ''})`.trim());
      };
    }
    // Header SMS booking button
    const smsBooking = document.getElementById('smsBookingLink');
    if (smsBooking) {
      smsBooking.addEventListener('click', () => {
        logCommunication(id, 'sms', 'Sent booking link via SMS');
      });
    }
    // Sidebar Call button
    const sideCall = document.getElementById('contactCallBtn');
    if (sideCall) {
      sideCall.onclick = () => {
        logCommunication(id, 'call', `Called ${lead.firstName || lead.name || 'customer'} at ${lead.phone || ''}`.trim());
      };
    }
    // Sidebar Text button
    const sideText = document.getElementById('contactTextBtn');
    if (sideText) {
      sideText.onclick = () => {
        logCommunication(id, 'sms', `Texted ${lead.firstName || lead.name || 'customer'} at ${lead.phone || ''}`.trim());
      };
    }
    // Sidebar Email button
    const sideEmail = document.getElementById('contactEmailBtn');
    if (sideEmail) {
      sideEmail.onclick = () => {
        logCommunication(id, 'email', `Opened email to ${lead.firstName || lead.name || 'customer'} (${lead.email || ''})`.trim());
      };
    }

    // Booking link buttons — show for early-stage leads
    const earlyStages = ['new','contacted','inspected'];
    if (earlyStages.includes(stage)) {
      const calSettings = JSON.parse(localStorage.getItem('nbd_cal_settings') || '{}');
      const calUser = calSettings.username || 'nobigdeal';
      const calSlug = calSettings.eventSlug || 'roof-inspection';
      const bookingUrl = `https://cal.com/${calUser}/${calSlug}`;
      // Audit CC: String() coerces non-string firstName before .trim().
      const custName = String(lead.firstName || '').trim();

      // SMS booking link
      const smsBtn = document.getElementById('smsBookingLink');
      if (smsBtn && lead.phone) {
        // Audit CC: same defense as the call link above — phone may
        // arrive as a number from a CSV import.
        const cleanPhone = String(lead.phone).replace(/\D/g, '');
        // M1: NBD keeps 'Joe from No Big Deal Roofing'; a non-NBD tenant uses its
        // own smsSignOff, or its legalName if unset — never NBD's sign-off.
        const _bSms = (window._brand && window._brand()) || {};
        const _signOff = _bSms.smsSignOff || ((!_bSms.legalName || _bSms.legalName === 'No Big Deal Home Solutions') ? 'Joe from No Big Deal Roofing' : _bSms.legalName);
        const smsBody = encodeURIComponent(`Hey${custName ? ' ' + custName : ''}, this is ${_signOff}! I'd love to set up a free roof inspection at your convenience. Pick a time that works for you here: ${bookingUrl}`);
        smsBtn.href = `sms:${cleanPhone}?body=${smsBody}`;
        smsBtn.style.display = '';
      }

      // Copy booking link button
      const copyBtn = document.getElementById('copyBookingBtn');
      if (copyBtn) copyBtn.style.display = '';

      // Store booking URL for copy function
      window._bookingUrl = bookingUrl;
      window._bookingCustomerName = custName;
    }

    // Populate info
    document.getElementById('infoJobValue').textContent = 
      lead.jobValue ? `$${parseFloat(lead.jobValue).toLocaleString()}` : '—';
    document.getElementById('infoDamageType').textContent = lead.damageType || '—';
    document.getElementById('infoSource').textContent = lead.source || '—';
    document.getElementById('infoCarrier').textContent = lead.insCarrier || lead.insuranceCarrier || '—';
    document.getElementById('infoClaimStatus').textContent = lead.claimStatus || '—';
    document.getElementById('infoFollowUp').textContent = lead.followUp || '—';

    // Job type — must stay in sync with JOB_TYPES in js/crm-stages.js.
    // Adding warranty + service here so the detail page displays them
    // correctly (previously they fell to '—').
    const jobType = lead.jobType || '';
    const jobTypeLabels = { 'insurance': 'Insurance', 'cash': 'Cash', 'finance': 'Finance', 'warranty': 'Warranty', 'service': 'Service' };
    document.getElementById('infoJobType').textContent = jobTypeLabels[jobType] || jobType || '—';

    // Cover photo hero (RoofLink "Set Cover") — typeof-guarded: the
    // renderer lives in customer-tasks-ui.js and defer order can race
    // this module on a cold cache.
    if (typeof window.renderCoverHero === 'function') {
      window.renderCoverHero(lead.coverPhotoUrl || null);
    }

    // Job checklist (RoofLink "View Checklist") — persisted check-off
    // state on lead.jobChecklist; same defer-race guard.
    if (window.JobChecklist?.render) {
      window.JobChecklist.render(lead);
    }

    // Insurance panel — rendered by ClaimPanel (js/claim-core.js): the
    // unified Claim Details card (deductible hero, synced status chip,
    // contact slots). Also show it when a claim status exists even if the
    // jobType was never flipped to insurance — a filed claim IS the signal.
    const isInsurance = jobType === 'insurance' || lead.insCarrier || lead.insuranceCarrier || lead.claimNumber
      || (lead.claimStatus && lead.claimStatus !== 'No Claim');
    if (isInsurance) {
      document.getElementById('insurancePanel').style.display = 'block';
      if (window.ClaimPanel?.render) {
        window.ClaimPanel.render('insurancePanel', lead);
      }
      // else: claim-core.js self-renders on parse (defer races the module).
    }

    // Finance panel
    const isFinance = jobType === 'finance' || lead.loanAmount || lead.softPullStatus;
    if (isFinance) {
      document.getElementById('financePanel').style.display = 'block';
      document.getElementById('infoFinanceCompany').textContent = lead.financeCompany || '—';
      document.getElementById('infoLoanAmount').textContent = lead.loanAmount ? '$' + parseFloat(lead.loanAmount).toLocaleString() : '—';
      document.getElementById('infoLoanStatus').textContent = lead.loanStatus || lead.softPullStatus || '—';
      const preQualLink = lead.preQualLink;
      if (preQualLink && /^https?:/i.test(String(preQualLink))) {
        const esc = window.nbdEsc || (s => String(s == null ? '' : s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
        document.getElementById('infoPreQualLink').innerHTML =
          `<a href="${esc(preQualLink)}" target="_blank" rel="noopener noreferrer" style="color:var(--blue);text-decoration:underline;">Open Link</a>`;
      }
    }

    // Notes now loaded from separate collection via loadNotes()

    // Stage progression button — uses full insurance pipeline
    const insurancePipeline = [
      'new', 'contacted', 'inspected', 'claim_filed',
      'adjuster_meeting_scheduled', 'adjuster_inspection_done',
      'scope_received', 'estimate_submitted',
      'supplement_requested', 'supplement_approved',
      'contract_signed',
      'job_created', 'permit_pulled', 'materials_ordered', 'materials_delivered',
      'crew_scheduled', 'install_in_progress', 'install_complete',
      'final_photos', 'deductible_collected', 'final_payment', 'closed'
    ];
    const NEXT_LABELS = {
      // Shared lead stages
      'new': 'Contacted', 'contacted': 'Inspected', 'inspected': 'Claim Filed',
      // Insurance track
      'claim_filed': 'Adjuster Meeting', 'adjuster_meeting_scheduled': 'Adjuster Done',
      'adjuster_inspection_done': 'Scope Received', 'scope_received': 'Estimate Sent',
      'estimate_submitted': 'Supplement', 'supplement_requested': 'Supp. Approved',
      'supplement_approved': 'Contract Signed',
      // Cash track
      'estimate_sent_cash': 'Negotiating', 'negotiating': 'Contract Signed',
      // Finance track
      'prequal_sent': 'Loan Approved', 'loan_approved': 'Contract Signed',
      // Warranty track
      'warranty_scheduled': 'Repair Done', 'warranty_repaired': 'Closed',
      // Service track
      'service_quoted': 'Service Approved', 'service_approved': 'Installing',
      // Job stages (shared)
      'contract_signed': 'Job Created',
      'job_created': 'Permit', 'permit_pulled': 'Materials Ordered',
      'materials_ordered': 'Materials Here', 'materials_delivered': 'Crew Scheduled',
      'crew_scheduled': 'Installing', 'install_in_progress': 'Install Done',
      'install_complete': 'Final Photos', 'final_photos': 'Deductible',
      'deductible_collected': 'Final Payment', 'final_payment': 'Closed',
      // Legacy display-name compat
      'New': 'Contacted', 'Inspected': 'Claim Filed', 'Estimate Sent': 'Contract Signed',
      'Approved': 'Job Created', 'In Progress': 'Install Done'
    };

    window._currentStage = lead.stage || 'new';

    // Pick the right next label based on the lead's jobType. The default
    // (insurance) tracks 'inspected' → 'claim_filed'. Each other track
    // diverges at 'inspected' into its own next-step.
    let nextLabel = NEXT_LABELS[lead.stage];
    if (lead.stage === 'inspected') {
      if (lead.jobType === 'cash')          nextLabel = 'Est. Sent (Cash)';
      else if (lead.jobType === 'finance')  nextLabel = 'Pre-Qual Sent';
      else if (lead.jobType === 'warranty') nextLabel = 'Warranty Visit';
      else if (lead.jobType === 'service')  nextLabel = 'Service Quoted';
      // insurance default stays 'Claim Filed'
    }
    if (nextLabel) {
      const btn = document.getElementById('stageProgressBtn');
      btn.style.display = 'inline-flex';
      btn.innerHTML = `→ Move to ${nextLabel}`;
    }

    // Load related data with individual error handling
    try { 
      await window.loadTimeline(id, lead); 
    } catch (e) { 
      console.error('Timeline load failed:', e); 
      document.getElementById('timelineList').innerHTML = '<div class="empty"><div class="empty-icon"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:middle;"><rect x="3" y="4" width="14" height="13" rx="1.5"/><path d="M3 8h14"/><path d="M7 2v4M13 2v4"/></svg></div>No activity yet</div>';
    }
    
    // Load photos into overview grid
    try { await loadPhotos(id); } catch (e) {
      console.error('Photos load failed:', e);
      var pl = document.getElementById('photoList');
      if (pl) pl.innerHTML = '<div class="empty"><div class="empty-icon">No photos yet</div></div>';
    }
    
    try {
      await window.loadDocuments(id);
    } catch (e) {
      console.error('Documents load failed:', e);
      // Real ID is docList (the loadDocuments fn writes into #docList).
      // The catch fallback used to target #documentList which doesn't
      // exist, throwing a TypeError on top of the documents-load failure.
      const dl = document.getElementById('docList');
      if (dl) dl.innerHTML = `
        <div class="upload-zone" data-action="openDocUploadModal">
          <div class="upload-icon"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:32px;height:32px;"><path d="M5 2h7l4 4v11a1 1 0 01-1 1H5a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M12 2v4h4"/></svg></div>
          <div class="upload-text">Click to upload documents</div>
          <div class="upload-hint">Drag & drop PDFs, contracts, or images</div>
        </div>`;
    }
    
    try { await window.loadEstimates(id); } 
    catch (e) { console.error('Estimates load failed:', e); }
    
    try { await window.loadNotes(id); }
    catch (e) { console.error('Notes load failed:', e); }

    // Render Profit Tracker cost panel (external module)
    try {
      if (window.ProfitTracker?.renderCostPanel) {
        window.ProfitTracker.renderCostPanel('profitPanel', id);
      }
    } catch (e) { console.warn('Profit panel render failed:', e.message); }

    // Render Lead Scoring panel
    try {
      if (window.LeadScoring?.renderScorePanel) {
        window.LeadScoring.renderScorePanel('leadScoringPanel', id);
      }
    } catch (e) { console.warn('Lead scoring render failed:', e.message); }

    // Render Insurance Claim Workflow
    try {
      if (window.InsuranceClaim?.renderClaimWorkflow) {
        window.InsuranceClaim.renderClaimWorkflow('insuranceClaimWorkflow', id);
      }
    } catch (e) { console.warn('Claim workflow render failed:', e.message); }

    // Load new portal sections (timeline, invoices, photos by phase, reports, documents, communication log)
    try {
      await window.loadNewPortalSections(id);
      // Setup contact tab
      window.setupContactTab(lead);
    } catch (e) { console.warn('Portal sections render failed:', e.message); }

  } catch (error) {
    console.error('Error loading customer data:', error);
    showError('Load Error', 'Could not load customer data');
  }
}

// Recently viewed tracking
function trackRecentlyViewed(leadId) {
  // Sweep Pass 4: this function was writing to localStorage key
  // 'nbd_recent_views' as an array of IDs, but dashboard.html's
  // renderRecentCustomers() reads from 'nbd_recent_customers' and
  // expects an array of {id, ts} objects. Two mismatches (key name +
  // shape) meant the Recent Customers dropdown in the dashboard topbar
  // was permanently empty even though this writer fired on every
  // customer-page visit. Now writes to the dashboard's expected key
  // and shape, so the dropdown finally populates.
  try {
    const KEY = 'nbd_recent_customers';
    let recent = JSON.parse(localStorage.getItem(KEY) || '[]');
    // Normalize: tolerate the legacy array-of-strings shape in case any
    // old browser has the prior format cached.
    recent = recent
      .map(r => (typeof r === 'string' ? { id: r } : r))
      .filter(r => r && r.id && r.id !== leadId);
    recent.unshift({ id: leadId, ts: Date.now() });
    recent = recent.slice(0, 10);
    localStorage.setItem(KEY, JSON.stringify(recent));
  } catch (e) {
    console.log('Could not track recent view');
  }
}

// ─────────────────────────────────────────────────────────────
// Communication auto-logging
// Creates a `communications` Firestore entry when the user calls,
// emails, or texts the customer from the customer page.
// ─────────────────────────────────────────────────────────────
async function logCommunication(leadId, type, content, extra = {}) {
  if (!leadId || !auth.currentUser) return null;
  try {
    const ref = await addDoc(collection(db, 'communications'), {
      leadId,
      userId: auth.currentUser.uid,
      type,                          // 'call' | 'email' | 'sms'
      direction: extra.direction || 'outbound',
      content: content || '',
      timestamp: serverTimestamp(),
      source: 'customer_page'
    });
    // Refresh timeline so the user sees the new entry right away
    if (window._customerId === leadId && window._leadDoc) {
      try { await loadTimeline(leadId, window._leadDoc); } catch(e){}
    }
    // Update lastContactedAt on the lead for follow-up logic
    try {
      await updateDoc(doc(db, 'leads', leadId), {
        lastContactedAt: serverTimestamp(),
        lastContactType: type
      });
    } catch(e){}
    return ref.id;
  } catch (err) {
    console.warn('Failed to log communication:', err);
    return null;
  }
}
// Expose globally so inline handlers can use it
window.logCommunication = logCommunication;

// Audit batch 7: load customer-side audit events for this lead and
// render them into #customerActivityList. Fire-and-forget alongside
// loadTimeline — telemetry, not load-bearing for the rest of the page.
async function loadCustomerActivity(leadId) {
  const listEl = document.getElementById('customerActivityList');
  if (!listEl) return;
  try {
    const snap = await getDocs(query(
      collection(db, 'customerAuditEvents'),
      where('leadId', '==', leadId),
      where('ownerUid', '==', auth.currentUser?.uid),
      orderBy('createdAt', 'desc'),
      limit(50)
    ));
    const events = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (events.length === 0) {
      listEl.innerHTML = '<div class="empty" style="padding:18px;font-size:13px;color:var(--m);">No activity yet. Activity appears here when the homeowner opens their portal link.</div>';
      return;
    }
    const ICON = {
      portal_open:    '🔓',
      photo_view:     '📷',
      estimate_view:  '📋',
      document_view:  '📄',
      photo_upload:   '⬆️',
    };
    const LABEL = {
      portal_open:    'Opened portal',
      photo_view:     'Viewed photo',
      estimate_view:  'Viewed estimate',
      document_view:  'Viewed document',
      photo_upload:   'Uploaded photo',
    };
    // Render-safety: escape every dynamic field before innerHTML. The local
    // fallback MUST also escape — an identity fallback (s => String(s)) is a
    // stored-XSS footgun if dom-safe.js ever fails to define window.nbdEsc first.
    // e.type/e.resourceId are server-written audit fields today, but this render
    // path is homeowner-activity data, so it stays on the escape-everything rule.
    const esc = window.nbdEsc || (s => String(s == null ? '' : s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
    listEl.innerHTML = events.map(e => {
      const t = e.createdAt && e.createdAt.toDate ? e.createdAt.toDate() : null;
      const when = t ? t.toLocaleString() : '';
      const icon = ICON[e.type] || '•';
      const label = LABEL[e.type] || esc(e.type);
      const detail = e.resourceId ? ' · <span style="color:var(--m);font-size:11px;">' + esc(e.resourceId.slice(0, 32)) + '</span>' : '';
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--br);font-size:13px;">' +
        '<span style="font-size:18px;line-height:1;">' + icon + '</span>' +
        '<span style="flex:1;color:var(--t);">' + label + detail + '</span>' +
        '<span style="color:var(--m);font-size:11px;white-space:nowrap;">' + esc(when) + '</span>' +
        '</div>';
    }).join('');
  } catch (e) {
    console.warn('[customer-activity] load failed:', e.message);
    listEl.innerHTML = '<div class="empty" style="padding:18px;font-size:13px;color:var(--m);">Activity unavailable.</div>';
  }
}
window.loadCustomerActivity = loadCustomerActivity;

async function loadTimeline(leadId, lead) {
  const timeline = [];
  // Audit batch 7: kick off the customer-activity load in parallel
  // (fire-and-forget — never blocks the timeline render).
  loadCustomerActivity(leadId).catch(() => {});

  // Load stage history
  if(lead.stageHistory && Array.isArray(lead.stageHistory)){
    lead.stageHistory.forEach(h => {
      timeline.push({
        time: h.timestamp ? new Date(h.timestamp) : new Date(),
        icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:middle;"><path d="M3 10a7 7 0 0112.9-3.7L17 5"/><path d="M17 10a7 7 0 01-12.9 3.7L3 15"/><path d="M17 2v3h-3M3 18v-3h3"/></svg>',
        title: `Stage: ${h.from} → ${h.to}`,
        desc: h.user || 'System',
        type: 'stage'
      });
    });
  }


  // Lead created event
  if (lead.createdAt) {
    timeline.push({
      time: lead.createdAt?.toDate ? lead.createdAt.toDate() : new Date(lead.createdAt),
      icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:middle;"><circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="4"/><circle cx="10" cy="10" r="1"/></svg>',
      title: 'Lead created',
      desc: `Source: ${lead.source || 'Unknown'}`,
      type: 'stage'
    });
  }

  // Load tasks — UNIFIED store: leads/{leadId}/tasks subcollection (same
  // one the dashboard, notification bell, and quick-capture use; the old
  // top-level 'tasks' query couldn't see any of those). Docs may carry
  // `title` (customer page) or `text` (dashboard/quick-capture) — read
  // both. type:'event' docs are Add-Event entries, rendered as dated
  // 📅 milestones instead of checkable todos.
  try {
    const taskSnap = await getDocs(
      query(collection(db, 'leads', leadId, 'tasks'))
    );
    taskSnap.docs.forEach(d => {
      const task = d.data();
      if (task.type === 'event') {
        const when = task.eventAt ? new Date(task.eventAt) : (task.createdAt?.toDate ? task.createdAt.toDate() : new Date());
        timeline.push({
          time: when,
          icon: '📅',
          title: task.title || task.text || 'Event',
          desc: (task.eventAt ? when.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')
            + (task.notes ? ' — ' + task.notes : ''),
          type: 'event'
        });
        return;
      }
      timeline.push({
        time: task.createdAt?.toDate ? task.createdAt.toDate() : new Date(task.createdAt || Date.now()),
        icon: task.done ? '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:middle;"><path d="M4 10.5l4 4 8-9"/></svg>' : '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:middle;"><path d="M5 2h10v4l-3 3 3 3v4H5v-4l3-3-3-3V2z"/></svg>',
        title: task.title || task.text || 'Task',
        desc: task.dueDate || '',
        isTask: true,
        taskId: d.id,
        taskDone: task.done || false,
        type: 'task'
      });
    });
    // Jump-nav OPEN-task badge (RoofLink ToDo count) — done tasks and
    // Add-Event entries don't count.
    if (typeof window.nbdNavCount === 'function') {
      window.nbdNavCount('navCountTasks',
        taskSnap.docs.filter(d => { const t = d.data() || {}; return !t.done && t.type !== 'event'; }).length);
    }
  } catch (e) {
    console.log('No tasks found for timeline');
  }

  // Appointments (Cal.com webhook writes /appointments with leadId +
  // startTime + title; manual events live in the tasks subcollection
  // above). Merged here so booked meetings finally show on the timeline.
  try {
    const uid0 = auth.currentUser?.uid;
    if (uid0) {
      const apptSnap = await getDocs(
        query(collection(db, 'appointments'), where('leadId', '==', leadId), where('userId', '==', uid0))
      );
      apptSnap.docs.forEach(d => {
        const a = d.data();
        const when = a.startTime?.toDate ? a.startTime.toDate() : (a.startTime ? new Date(a.startTime) : null);
        if (!when) return;
        timeline.push({
          time: when,
          icon: '📅',
          title: a.title || 'Appointment',
          desc: when.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
            + (a.status ? ' · ' + a.status : ''),
          type: 'event'
        });
      });
    }
  } catch (e) { /* appointments are optional — older tenants have none */ }

  // Load estimates (two-scope: owner + company reader — see _estimateQueryScopes)
  try {
    const estDocs = await _getEstimateDocsForLead(leadId);
    estDocs.forEach(d => {
      const est = d.data();
      if (est.createdAt) {
        timeline.push({
          time: est.createdAt?.toDate ? est.createdAt.toDate() : new Date(est.createdAt),
          icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:middle;"><rect x="4" y="3" width="12" height="14" rx="1.5"/><path d="M7 3V1.5h6V3"/><path d="M7 8h6M7 11h4"/></svg>',
          title: 'Estimate created',
          desc: est.amount ? `$${parseFloat(est.amount).toLocaleString()}` : 'Draft',
          type: 'document'
        });
      }
    });
  } catch (e) {
    console.log('No estimates found for timeline');
  }

  // Load photos for timeline
  try {
    const photoSnap = await getDocs(
      query(collection(db, 'photos'), ..._photoQueryScopes(leadId))
    );
    photoSnap.docs.forEach(d => {
      const photo = d.data();
      if (photo.uploadedAt) {
        timeline.push({
          time: photo.uploadedAt?.toDate ? photo.uploadedAt.toDate() : new Date(photo.uploadedAt),
          icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:middle;"><rect x="2" y="6" width="16" height="11" rx="1.5"/><circle cx="10" cy="11" r="3"/><path d="M7 6l1-3h4l1 3"/></svg>',
          title: 'Photo uploaded',
          desc: photo.category || 'Property photo',
          type: 'photo'
        });
      }
    });
  } catch (e) {
    console.log('No photos found for timeline');
  }

  // Load communications log (call/email/SMS entries from the quick-action buttons)
  try {
    const commSnap = await getDocs(
      query(collection(db, 'communications'), where('leadId', '==', leadId), where('userId', '==', auth.currentUser?.uid))
    );
    const COMM_ICONS = {
      call:  '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:middle;"><path d="M4 3h3l2 4-2.5 1.5A9 9 0 0011.5 13.5L13 11l4 2v3a1 1 0 01-1 1C8.4 17 3 11.6 3 4a1 1 0 011-1z"/></svg>',
      email: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:middle;"><rect x="2" y="4" width="16" height="12" rx="1.5"/><path d="M2 6l8 5 8-5"/></svg>',
      sms:   '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:middle;"><path d="M3 5h14v9h-4l-3 3-3-3H3V5z"/></svg>',
      // 'note' = a system/audit entry (e.g. a primary-estimate switch) rather
      // than an outbound call/email/sms; pencil icon + explicit title.
      note:  '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:middle;"><path d="M4 13.5V16h2.5l7-7L11 6.5l-7 7z"/><path d="M12.5 5l2.5 2.5"/></svg>'
    };
    const COMM_LABELS = { call: 'Called', email: 'Emailed', sms: 'Texted', note: 'Note' };
    commSnap.docs.forEach(d => {
      const c = d.data();
      const t = c.type || 'call';
      timeline.push({
        time: c.timestamp?.toDate ? c.timestamp.toDate() : new Date(c.timestamp || Date.now()),
        icon: COMM_ICONS[t] || COMM_ICONS.call,
        // Honor an explicit title when the writer set one (note/audit entries);
        // existing call/email/sms docs have no `title`, so they keep the old label.
        title: c.title || `${COMM_LABELS[t] || 'Contacted'} ${c.direction === 'inbound' ? 'from' : ''} customer`,
        desc: c.content || c.note || '',
        // Don't flatten every comm doc to 'communication': setPrimaryEstimate
        // writes its audit row here as type:'note', and the Notes filter pill
        // matches on data-type, so flattening hid those rows under Calls/Texts.
        type: (t === 'note' ? 'note' : 'communication')
      });
    });
  } catch (e) {
    console.log('No communications found for timeline');
  }

  // Load notes. The Notes filter pill matched data-type="note", but this
  // function never queried /notes — clicking Notes emptied the timeline and
  // told the rep the customer had none while the Notes panel beside it was
  // full. Mirrors _gatherTimelineForReport's notes block: leadId only, no
  // author filter, so a manager's note on a rep's lead shows too (the /notes
  // rule authorizes by parent lead ownership / same company).
  try {
    const noteSnap = await getDocs(
      query(collection(db, 'notes'), where('leadId', '==', leadId))
    );
    noteSnap.docs.forEach(d => {
      const n = d.data();
      timeline.push({
        time: n.createdAt?.toDate ? n.createdAt.toDate() : new Date(n.createdAt || Date.now()),
        icon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:middle;"><path d="M4 13.5V16h2.5l7-7L11 6.5l-7 7z"/><path d="M12.5 5l2.5 2.5"/></svg>',
        title: 'Note added',
        desc: (n.text || '').substring(0, 200),
        type: 'note'
      });
    });
  } catch (e) {
    console.log('No notes found for timeline');
  }

  // Sort by time (newest first)
  timeline.sort((a, b) => b.time - a.time);

  // Render. `item.icon` is a hardcoded SVG literal built above; every other
  // field is potentially user-controlled (title, desc from lead notes /
  // communication content) so it MUST be escaped before innerHTML assignment.
  const esc = window.nbdEsc || (s => String(s == null ? '' : s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
  const html = timeline.map(item => {
    const dtype = esc(item.type || 'note');
    if (item.isTask) {
      return `
        <div class="timeline-item nbd-tl-task" data-type="${dtype}" data-task-id="${esc(item.taskId)}" data-task-done="${item.taskDone ? '1' : '0'}" style="cursor:pointer;">
          <div class="timeline-icon">${item.icon}</div>
          <div class="timeline-content">
            <div class="timeline-title" style="display:flex;align-items:center;gap:8px;">
              <input type="checkbox" ${item.taskDone ? 'checked' : ''} class="nbd-tl-task-check" data-task-id="${esc(item.taskId)}"
                style="width:16px;height:16px;cursor:pointer;">
              <span style="${item.taskDone ? 'text-decoration:line-through;opacity:0.6;' : ''}">${esc(item.title)}</span>
            </div>
            <div class="timeline-desc" style="${item.taskDone ? 'text-decoration:line-through;opacity:0.6;' : ''}">${esc(item.desc)}</div>
            <div class="timeline-time">${esc(item.time.toLocaleString())}</div>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="timeline-item" data-type="${dtype}">
          <div class="timeline-icon">${item.icon}</div>
          <div class="timeline-content">
            <div class="timeline-title">${esc(item.title)}</div>
            <div class="timeline-desc">${esc(item.desc)}</div>
            <div class="timeline-time">${esc(item.time.toLocaleString())}</div>
          </div>
        </div>
      `;
    }
  }).join('');

  document.getElementById('timelineList').innerHTML = html ||
    '<div class="empty"><div class="empty-icon"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:middle;"><rect x="3" y="4" width="14" height="13" rx="1.5"/><path d="M3 8h14"/><path d="M7 2v4M13 2v4"/></svg></div><div style="margin-bottom:10px;">No activity yet</div><button class="btn btn-orange" data-action="openTaskModal" style="font-size:13px;padding:8px 16px;"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:12px;height:12px;vertical-align:middle;"><path d="M10 4v12M4 10h12"/></svg> Add First Task</button></div>';

  // Wire task toggles via event listeners rather than inline onclick.
  const tlListEl = document.getElementById('timelineList');
  tlListEl.querySelectorAll('.nbd-tl-task').forEach(row => {
    row.addEventListener('click', (ev) => {
      // Ignore clicks on the checkbox itself — handled below.
      if (ev.target.closest('.nbd-tl-task-check')) return;
      const id = row.dataset.taskId;
      const done = row.dataset.taskDone === '1';
      if (id) toggleTask(id, !done);
    });
  });
  tlListEl.querySelectorAll('.nbd-tl-task-check').forEach(cb => {
    cb.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const id = cb.dataset.taskId;
      if (id) toggleTask(id, !cb.checked);
    });
  });

  // Apply collapse (show only last 5 by default)
  window._tlCollapsed = true;
  window._tlActiveFilter = 'all';
  applyTimelineCollapse();
}

// Customer-overview photo strip: 25-cap with "Show all" toggle + drag
// reorder. Photos are sorted by an integer `order` field if present
// (set by drag-reorder); fall back to uploadedAt for legacy photos.
window.PHOTO_OVERVIEW_CAP = 25;
window._customerPhotosExpanded = false;

function nbdComparePhotos(a, b) {
  // Sort by .order if either side has it; integer ascending puts the
  // user's drag-rearranged sequence first. Photos without .order fall
  // back to uploadedAt timestamp (newest first), so legacy photos
  // still render in a sensible order until the user drags them.
  var ao = (typeof a.order === 'number') ? a.order : null;
  var bo = (typeof b.order === 'number') ? b.order : null;
  if (ao !== null && bo !== null) return ao - bo;
  if (ao !== null) return -1;
  if (bo !== null) return 1;
  // Fallback: newest first (Firestore Timestamp or numeric millis).
  var at = a.uploadedAt && a.uploadedAt.toMillis ? a.uploadedAt.toMillis() : Number(a.uploadedAt) || 0;
  var bt = b.uploadedAt && b.uploadedAt.toMillis ? b.uploadedAt.toMillis() : Number(b.uploadedAt) || 0;
  return bt - at;
}

window.toggleCustomerPhotosExpanded = function() {
  window._customerPhotosExpanded = !window._customerPhotosExpanded;
  renderCustomerPhotoStrip();
};

toggleCustomerPhotoReorder = function() {
  var on = document.body.classList.toggle('nbd-photo-reorder');
  var btn = document.getElementById('nbdReorderToggle');
  if (btn) {
    btn.classList.toggle('active', on);
    btn.textContent = on ? 'Done reordering' : 'Reorder';
  }
};

// Persists the current order of window._customerPhotos by writing an
// integer .order field on every photo doc. One writeBatch round-trip
// for the whole sequence — same pattern as the multi-select feature.
async function persistCustomerPhotoOrder() {
  if (!window.writeBatch || !window.db || !window.doc) return;
  var photos = window._customerPhotos || [];
  if (!photos.length) return;
  try {
    var batch = window.writeBatch(window.db);
    for (var i = 0; i < photos.length; i++) {
      var p = photos[i];
      p.order = i;
      batch.update(window.doc(window.db, 'photos', p.id), { order: i });
    }
    await batch.commit();
    if (window.showToast) window.showToast('Photo order saved', 'success');
  } catch (err) {
    console.error('Photo reorder save failed:', err);
    if (window.showToast) window.showToast('Couldn\'t save order: ' + (err && err.message || 'unknown'), 'error');
  }
}

function renderCustomerPhotoStrip() {
  var photos = window._customerPhotos || [];
  var listEl = document.getElementById('photoList');
  if (!listEl) return;

  if (photos.length === 0) {
    listEl.innerHTML = '<div class="upload-zone" data-action="openUploadModal">'
      + '<div class="upload-icon"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:32px;height:32px;"><rect x="2" y="6" width="16" height="11" rx="1.5"/><circle cx="10" cy="11" r="3"/><path d="M7 6l1-3h4l1 3"/></svg></div>'
      + '<div class="upload-text">No photos yet</div>'
      + '<div class="upload-hint">Click to upload your first photo</div></div>';
    return;
  }

  var esc = window.nbdEsc || (function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]});});
  var cap = window.PHOTO_OVERVIEW_CAP;
  var expanded = !!window._customerPhotosExpanded;
  var visible = (expanded || photos.length <= cap) ? photos : photos.slice(0, cap);
  var hidden = photos.length - visible.length;

  var html = '<div class="photo-grid">';
  for (var i = 0; i < visible.length; i++) {
    var photo = visible[i];
    var imgAttrs = (window.buildPhotoImgAttrs || function(p, e){
      var u = /^https?:/i.test(String(p.url || '')) ? p.url : '';
      return 'src="' + e(u) + '"';
    })(photo, esc, { sizes: '160px' });
    html += '<div class="photo-item nbd-photo-item" draggable="true" data-photo-id="' + esc(photo.id) + '" data-photo-idx="' + i + '">'
         + '<img ' + imgAttrs + ' alt="Property photo" referrerpolicy="no-referrer" loading="lazy" decoding="async">'
         + '</div>';
  }
  html += '</div>';

  if (photos.length > cap) {
    var label = expanded ? ('Show first ' + cap) : ('Show all ' + photos.length);
    html += '<button type="button" class="nbd-photo-show-all-btn" data-action="toggleCustomerPhotosExpanded">'
         + label + ' (' + photos.length + ' total)</button>';
  }

  html += '<div style="display:flex;gap:8px;margin-top:12px;align-items:center;">'
       + '<button class="btn btn-orange" style="flex:1;" data-action="openUploadModal">📤 Upload More</button>'
       + '<button class="btn" style="flex:1;background:var(--blue);border-color:var(--blue);color:#fff;" data-action="generatePhotoReport" data-pass-customer-id="true">📋 Generate Report</button>'
       // QA wiring audit 2026-07-27: NO data-action here. The Tranche-1
       // globals cleanup made toggleCustomerPhotoReorder module-local (and
       // a tripwire test bans re-windowing it), but the page delegate
       // resolves data-action names on WINDOW — so this button was a
       // silent console.error, dead on every customer photo gallery. It
       // now binds inside attachCustomerPhotoStripHandlers below, module
       // scope end to end.
       + '<button type="button" class="nbd-photo-reorder-btn" id="nbdReorderToggle">Reorder</button>'
       + '</div>';

  listEl.innerHTML = html;
  attachCustomerPhotoStripHandlers();
}

function attachCustomerPhotoStripHandlers() {
  var listEl = document.getElementById('photoList');
  if (!listEl || listEl.dataset.nbdDelegated === '1') return;
  listEl.dataset.nbdDelegated = '1';

  // Click → open editor or lightbox (suppressed in reorder mode).
  listEl.addEventListener('click', function(ev) {
    // Reorder toggle — handled here (module scope) because the function
    // is module-local and the page's data-action delegate only resolves
    // window names. Fires in AND out of reorder mode (it's the exit too).
    if (ev.target.closest && ev.target.closest('#nbdReorderToggle')) {
      toggleCustomerPhotoReorder();
      return;
    }
    if (document.body.classList.contains('nbd-photo-reorder')) return;
    var tile = ev.target.closest('.nbd-photo-item');
    if (!tile) return;
    var idx = Number(tile.dataset.photoIdx);
    var photo = (window._customerPhotos || [])[idx];
    if (!photo) return;
    if (window.NBDPhotoEditor && /^https?:/i.test(photo.url || '')) {
      window.NBDPhotoEditor.open(photo.url, photo.id, window._customerId);
    } else if (typeof openLightbox === 'function') {
      openLightbox(idx);
    }
  });

  // HTML5 drag-and-drop reorder. Persists once on drop. We track the
  // dragged photo by id so the visible-vs-full slice doesn't matter:
  // dragging a tile in the first 25 reorders within the first 25;
  // expanding to all-N enables full reordering.
  var dragId = null;
  listEl.addEventListener('dragstart', function(ev) {
    if (!document.body.classList.contains('nbd-photo-reorder')) { ev.preventDefault(); return; }
    var tile = ev.target.closest('.nbd-photo-item');
    if (!tile) return;
    dragId = tile.dataset.photoId;
    tile.classList.add('is-dragging');
    try { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', dragId); } catch(_) {}
  });
  listEl.addEventListener('dragend', function(ev) {
    var tile = ev.target.closest('.nbd-photo-item');
    if (tile) tile.classList.remove('is-dragging');
    listEl.querySelectorAll('.drop-before, .drop-after').forEach(function(t){ t.classList.remove('drop-before','drop-after'); });
    dragId = null;
  });
  listEl.addEventListener('dragover', function(ev) {
    if (!document.body.classList.contains('nbd-photo-reorder')) return;
    var tile = ev.target.closest('.nbd-photo-item');
    if (!tile || !dragId || tile.dataset.photoId === dragId) return;
    ev.preventDefault();
    listEl.querySelectorAll('.drop-before, .drop-after').forEach(function(t){ t.classList.remove('drop-before','drop-after'); });
    var rect = tile.getBoundingClientRect();
    var before = (ev.clientX - rect.left) < (rect.width / 2);
    tile.classList.add(before ? 'drop-before' : 'drop-after');
  });
  listEl.addEventListener('drop', function(ev) {
    if (!document.body.classList.contains('nbd-photo-reorder')) return;
    var tile = ev.target.closest('.nbd-photo-item');
    if (!tile || !dragId) return;
    ev.preventDefault();
    var targetId = tile.dataset.photoId;
    if (targetId === dragId) return;
    var arr = window._customerPhotos || [];
    var fromIdx = arr.findIndex(function(p){ return p.id === dragId; });
    var toIdx = arr.findIndex(function(p){ return p.id === targetId; });
    if (fromIdx < 0 || toIdx < 0) return;
    var rect = tile.getBoundingClientRect();
    var before = (ev.clientX - rect.left) < (rect.width / 2);
    var insertAt = before ? toIdx : toIdx + 1;
    var moved = arr.splice(fromIdx, 1)[0];
    if (fromIdx < insertAt) insertAt -= 1;
    arr.splice(insertAt, 0, moved);
    listEl.querySelectorAll('.drop-before, .drop-after').forEach(function(t){ t.classList.remove('drop-before','drop-after'); });
    renderCustomerPhotoStrip();
    persistCustomerPhotoOrder();
  });
}


// Team visibility (2026-07): photo queries drop the userId filter when a
// company reader (company_admin/manager/viewer) is viewing a lead in their
// tenant — the photos rules' docLeadInMyCompany clause makes the
// leadId-only list query provable, so a manager opening a teammate's
// customer page gets the gallery instead of an empty grid. Everyone else
// keeps the classic owner-scoped pair (provable under isOwner).
function _photoQueryScopes(leadId) {
  const claims = window._userClaims || {};
  const lead = window._currentLead || {};
  const teamReader = ['company_admin', 'manager', 'viewer'].includes(claims.role || '')
    && !!claims.companyId
    && lead.userId && window._user && lead.userId !== window._user.uid;
  return teamReader
    ? [where('leadId', '==', leadId)]
    : [where('leadId', '==', leadId), where('userId', '==', auth.currentUser?.uid)];
}

// Team visibility for ESTIMATES (audit 2026-08-02): the three estimate reads
// on this page hard-scoped to the signed-in uid, so a company_admin/manager
// opening a rep's job saw "No estimates yet" — while the dashboard shell
// already runs the two-scope shape (dashboard-bootstrap loadEstimates). The
// /estimates rule only proves a team read when the query carries
// companyId == the caller's claim, so unlike photos the leadId-only form
// isn't usable here: own-userId scope ALWAYS runs (covers legacy
// pre-companyId docs), company scope is added for company readers, results
// dedupe by doc id.
function _estimateQueryScopes(leadId) {
  const claims = window._userClaims || {};
  const scopes = [[where('leadId', '==', leadId), where('userId', '==', auth.currentUser?.uid)]];
  if (['company_admin', 'manager', 'viewer'].includes(claims.role || '') && claims.companyId) {
    scopes.push([where('leadId', '==', leadId), where('companyId', '==', claims.companyId)]);
  }
  return scopes;
}

async function _getEstimateDocsForLead(leadId) {
  const byId = new Map();
  for (const scope of _estimateQueryScopes(leadId)) {
    const snap = await getDocs(query(collection(db, 'estimates'), ...scope));
    snap.docs.forEach(d => { if (!byId.has(d.id)) byId.set(d.id, d); });
  }
  return [...byId.values()];
}

async function loadPhotos(leadId) {
  try {
    const photoSnap = await getDocs(
      query(collection(db, 'photos'), ..._photoQueryScopes(leadId))
    );

    if (photoSnap.empty) {
      window._customerPhotos = [];
      renderCustomerPhotoStrip();
      return;
    }

    window._customerPhotos = photoSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort(nbdComparePhotos);

    renderCustomerPhotoStrip();
  } catch (e) {
    console.error('Error loading photos:', e);
    document.getElementById('photoList').innerHTML = `
      <div class="upload-zone" data-action="openUploadModal">
        <div class="upload-icon"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:32px;height:32px;"><rect x="2" y="6" width="16" height="11" rx="1.5"/><circle cx="10" cy="11" r="3"/><path d="M7 6l1-3h4l1 3"/></svg></div>
        <div class="upload-text">Click to upload photos</div>
      </div>`;
  }
}



// Rep picks which of a lead's estimates drives the pipeline job value.
// Writes the SAME 3-field shape #1036's revision branch uses
// (dashboard-bootstrap.module.js:3194) — jobValue/primaryEstimateId/
// lastEstimateAt — and deliberately does NOT touch stage: switching primary
// on an existing lead is not a funnel event (only CREATING the first estimate
// bumps new→contacted). Leads have no snapshot listener, so the refresh is
// manual and mirrors customer-edit-modal.js.
async function setPrimaryEstimate(estId) {
  const est = (window._customerEstimates || []).find(e => e.id === estId);
  const leadId = window._customerId;
  if (!est || !leadId) return;
  const current = window._currentLead || window._leadDoc || {};
  if (String(current.primaryEstimateId || '') === String(estId)) {
    if (typeof showToast === 'function') showToast('That estimate is already primary', 'info');
    return;
  }
  // Money + label come from the shared two-shape readers. Reading grandTotal
  // alone was a data-loss bug: Classic docs (title/amount|total/lineItems —
  // including everything the page's own Log Estimate modal writes) rendered
  // $14,500 in the row beside this button while newVal computed 0, so the rep
  // got the "$0" confirm and, clicking through, wrote jobValue:0 over a live
  // deal. customer-estimate-rows.js is loaded on customer.html; the inline
  // fallback mirrors its ladder so a missing script can't resurrect the $0 write.
  const _rowsApi = window.NBDCustomerEstimateRows || {};
  const newVal = typeof _rowsApi.estimateValue === 'function'
    ? _rowsApi.estimateValue(est)
    : Number(est.grandTotal != null ? est.grandTotal : est.total != null ? est.total : est.amount) || 0;
  const oldVal = Number(current.jobValue) || 0;
  const estName = typeof _rowsApi.estimateName === 'function'
    ? _rowsApi.estimateName(est)
    : (est.title || est.name || est.addr || 'Estimate');
  // Validate: a Draft/$0 estimate would zero out the lead's job value —
  // confirm before letting a rep silently shrink a live deal.
  if (newVal <= 0) {
    const ask = window.nbdConfirm || (m => Promise.resolve(window.confirm(m)));
    const ok = await ask('This estimate has no dollar value yet — set it as primary and make the lead job value $0?');
    if (!ok) return;
  }
  try {
    await updateDoc(doc(db, 'leads', leadId), {
      jobValue: newVal,
      primaryEstimateId: estId,
      lastEstimateAt: serverTimestamp(),
    });
    // Audit trail on the customer timeline. `communications` is the timeline's
    // note store (see loadTimeline's comm section); a 'note'-typed entry with an
    // explicit title renders as a proper activity row.
    try {
      const fmt = (n) => '$' + Number(n || 0).toLocaleString();
      await addDoc(collection(db, 'communications'), {
        leadId,
        userId: auth.currentUser?.uid,
        type: 'note',
        title: 'Job value updated',
        content: `Primary estimate set to "${estName}" — job value ${fmt(oldVal)} → ${fmt(newVal)}`,
        timestamp: serverTimestamp(),
        source: 'primary_switch',
      });
    } catch (logErr) { console.warn('primary-switch audit log failed:', logErr); }
    // Live refresh — no leads snapshot listener exists, so update the in-memory
    // lead globals + header cell + profit panel exactly like customer-edit-modal.js.
    if (window._currentLead) Object.assign(window._currentLead, { primaryEstimateId: estId, jobValue: newVal });
    if (window._leadDoc) Object.assign(window._leadDoc, { primaryEstimateId: estId, jobValue: newVal });
    const jv = document.getElementById('infoJobValue');
    if (jv) jv.textContent = newVal ? '$' + newVal.toLocaleString() : '—';
    if (window.ProfitTracker && typeof window.ProfitTracker.renderCostPanel === 'function') {
      try { window.ProfitTracker.renderCostPanel('profitPanel', leadId); } catch (e) {}
    }
    await loadEstimates(leadId);                                   // move the ★ badge
    try { await loadTimeline(leadId, window._leadDoc); } catch (e) {}  // show the audit entry
    if (typeof showToast === 'function') showToast('Primary estimate set — job value updated', 'success');
  } catch (e) {
    console.error('setPrimaryEstimate failed:', e);
    if (typeof showToast === 'function') showToast('Failed to set primary: ' + ((e && e.message) || 'unknown error'), 'error');
  }
}

async function loadEstimates(leadId) {
  try {
    const estDocs = await _getEstimateDocsForLead(leadId);

    if (!estDocs.length) {
      document.getElementById('estimateList').innerHTML = `
        <div class="empty">
          <div class="empty-icon"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:middle;"><rect x="4" y="3" width="12" height="14" rx="1.5"/><path d="M7 3V1.5h6V3"/><path d="M7 8h6M7 11h4"/></svg></div>
          No estimates yet
        </div>`;
      return;
    }

    // Store estimates globally — filter soft-deleted records. Sort createdAt
    // DESC to match the dashboard shell (audit 2026-08-02: this array was
    // doc-id-ordered here but newest-first there, and doc-preflight takes
    // [0] — the same lead could generate a contract from a DIFFERENT
    // estimate depending on which page the rep opened it from).
    window._customerEstimates = estDocs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(e => !e.deleted)
      .sort((a, b) => {
        const ta = a.createdAt?.toDate?.()?.getTime() || 0;
        const tb = b.createdAt?.toDate?.()?.getTime() || 0;
        return tb - ta;
      });

    if (typeof window.nbdTitleCount === 'function') {
      window.nbdTitleCount('estimatesPanelTitle', 'Estimates', window._customerEstimates.length);
    }

    if (!window._customerEstimates.length) {
      document.getElementById('estimateList').innerHTML = `
        <div class="empty"><div class="empty-icon"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:middle;"><rect x="4" y="3" width="12" height="14" rx="1.5"/><path d="M7 3V1.5h6V3"/><path d="M7 8h6M7 11h4"/></svg></div>No estimates yet</div>`;
      return;
    }

    const esc = window.nbdEsc || (s => String(s == null ? '' : s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
    // Which of this lead's estimates is the primary (job-value driver)?
    // primaryEstimateId is stamped on the lead by #1036 on estimate create;
    // this list is the first UI that reads it. Fall back across the two lead
    // globals the customer page keeps in sync (_currentLead / _leadDoc).
    const primaryId = (window._currentLead || window._leadDoc || {}).primaryEstimateId || null;
    const html = window._customerEstimates.map(est => {
      const tier = String(est.tier || est.tierName || '');
      const tierColor = tier==='best'?'var(--green)':tier==='better'?'#9B6DFF':'var(--orange)';
      const tierLabel = tier ? `<span style="font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${tierColor};border:1px solid ${tierColor};padding:1px 6px;border-radius:3px;margin-left:6px;">${esc(tier)}</span>` : '';
      const dateStr = est.createdAt?.toDate ? est.createdAt.toDate().toLocaleDateString() : '—';
      const isPrimary = primaryId && String(est.id) === String(primaryId);
      const primaryControl = isPrimary
        ? '<span class="nbd-est-primary-badge" style="font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--green);border:1px solid var(--green);padding:2px 7px;border-radius:3px;white-space:nowrap;">★ Primary</span>'
        : `<button class="nbd-est-primary" data-est-id="${esc(est.id)}" style="background:transparent;border:1px solid var(--br);border-radius:4px;padding:4px 8px;font-size:10px;color:var(--m);cursor:pointer;font-family:inherit;white-space:nowrap;" title="Make this the lead&#39;s primary estimate">☆ Make primary</button>`;
      return `
        <div class="estimate-item nbd-est-row" data-est-id="${esc(est.id)}" style="cursor:pointer;transition:all .2s;display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--br);">
          <div>
            <div class="estimate-title" style="display:flex;align-items:center;">${esc(est.title || est.name || 'Estimate')}${tierLabel}</div>
            <div style="font-size:11px;color:var(--m);margin-top:2px;">${esc(dateStr)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="estimate-amount" style="font-size:15px;font-weight:700;color:var(--green);">${est.grandTotal ? '$'+parseFloat(est.grandTotal).toLocaleString() : est.amount ? '$'+parseFloat(est.amount).toLocaleString() : 'Draft'}</div>
            ${primaryControl}
            <button class="nbd-est-export" data-est-id="${esc(est.id)}" style="background:transparent;border:1px solid var(--br);border-radius:4px;padding:4px 8px;font-size:10px;color:var(--m);cursor:pointer;font-family:inherit;" title="Export PDF">📤</button>
            <button class="nbd-est-share" data-est-id="${esc(est.id)}" style="background:transparent;border:1px solid rgba(46,204,138,0.45);border-radius:4px;padding:4px 8px;font-size:10px;color:#5eead4;cursor:pointer;font-family:inherit;" title="Copy customer view link">🔗</button>
            <button class="nbd-est-cert" data-est-id="${esc(est.id)}" style="background:transparent;border:1px solid color-mix(in srgb, var(--orange) 40%, transparent);border-radius:4px;padding:4px 8px;font-size:10px;color:var(--orange);cursor:pointer;font-family:inherit;" title="Generate Warranty Certificate">🛡️</button>
          </div>
        </div>
      `;
    }).join('');

    const estListEl = document.getElementById('estimateList');
    estListEl.innerHTML = '<div style="font-size:11px;color:var(--m);padding:8px 14px 2px;">Job value follows the ★ primary estimate.</div>' + html;
    estListEl.querySelectorAll('.nbd-est-row').forEach(row => {
      row.addEventListener('click', () => viewEstimate(row.dataset.estId));
    });
    estListEl.querySelectorAll('.nbd-est-primary').forEach(btn => {
      btn.addEventListener('click', (ev) => { ev.stopPropagation(); setPrimaryEstimate(btn.dataset.estId); });
    });
    estListEl.querySelectorAll('.nbd-est-export').forEach(btn => {
      btn.addEventListener('click', (ev) => { ev.stopPropagation(); exportCustomerEstimate(btn.dataset.estId); });
    });
    estListEl.querySelectorAll('.nbd-est-share').forEach(btn => {
      btn.addEventListener('click', (ev) => { ev.stopPropagation(); shareEstimateViewLink(btn.dataset.estId); });
    });
    estListEl.querySelectorAll('.nbd-est-cert').forEach(btn => {
      btn.addEventListener('click', (ev) => { ev.stopPropagation(); generateCertFromEstimate(btn.dataset.estId); });
    });

    // Add hover effect via CSS
    document.querySelectorAll('.estimate-item').forEach(item => {
      item.addEventListener('mouseenter', () => {
        item.style.background = 'var(--s2)';
        item.style.borderLeft = '3px solid var(--orange)';
      });
      item.addEventListener('mouseleave', () => {
        item.style.background = '';
        item.style.borderLeft = '';
      });
    });
  } catch (e) {
    console.error('Error loading estimates:', e);
  }
}

// ── W146: Share estimate view link ────────────────────────────────────────
// Mints a portal token (or reuses an active one in localStorage) and
// builds the customer-facing URL: /pro/estimate-view.html?token=…&estimateId=…
// The viewer page calls getEstimateForView (W146) which validates the
// token, stamps `viewedAt` + bumps `viewCount` on the estimate doc,
// and returns the redacted estimate for client-side render.
//
// The same token can be reused across multiple estimates that belong
// to the lead (the function checks lead-id match) so reps don't pile
// up tokens.
window.shareEstimateViewLink = async function(estId) {
  const leadId = window._customerId;
  if (!leadId || !estId) {
    if (typeof showToast === 'function') showToast('Missing estimate or lead context.', 'error');
    return;
  }
  // Check localStorage for a recently-minted token for this lead.
  // Tokens last 30 days by default; we also stash the expiry so we
  // skip stale ones without a round-trip to Firestore.
  //
  // Audit CA: partition the cache by uid. localStorage persists across
  // signin/signout (Firebase doesn't clear app-owned keys), so without
  // uid partitioning a token Rep A minted for Lead L would survive
  // sign-out and be readable by Rep B signing in to the same device.
  // Token grants homeowner-level access to the portal view — Rep B
  // shouldn't get any data for a lead they don't own. Falling back to
  // mint-fresh on cache miss is cheap (single callable round-trip).
  const _uid = (window._user && window._user.uid) || 'anon';
  const cacheKey = 'nbd_view_token_' + _uid + '_' + leadId;
  let token = null;
  try {
    // Also drop the legacy unpartitioned key if present, so the cache
    // doesn't keep a stale entry tied to a previous device user.
    const legacyKey = 'nbd_view_token_' + leadId;
    if (localStorage.getItem(legacyKey)) {
      try { localStorage.removeItem(legacyKey); } catch (_) {}
    }
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached.token && cached.expiresAt && cached.expiresAt > Date.now() + 60_000) {
        token = cached.token;
      }
    }
  } catch (_) { /* fall through to mint */ }

  if (!token) {
    // Mint a new token via the existing createPortalToken callable
    // (already used by W118 portal flow + W144 supplements).
    try {
      if (!window._functions || !window._httpsCallable) {
        const mod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
        window._functions = mod.getFunctions();
        window._httpsCallable = mod.httpsCallable;
      }
      const fn = window._httpsCallable(window._functions, 'createPortalToken');
      const result = await fn({ leadId, ttlDays: 30 });
      token = result?.data?.token;
      const expiresAt = result?.data?.expiresAt;
      if (token && expiresAt) {
        try { localStorage.setItem(cacheKey, JSON.stringify({ token, expiresAt })); } catch (_) {}
      }
    } catch (e) {
      if (typeof showToast === 'function') showToast('Could not mint share link: ' + (e.message || 'try again'), 'error');
      return;
    }
  }
  if (!token) {
    if (typeof showToast === 'function') showToast('Could not mint share link.', 'error');
    return;
  }

  const url = window.location.origin + '/pro/estimate-view.html'
    + '?token=' + encodeURIComponent(token)
    + '&estimateId=' + encodeURIComponent(estId);

  // Try the modern Web Share API first (mobile, opens native share
  // sheet straight to SMS/Messenger/email). Fall back to clipboard
  // copy for desktop. Final fallback: prompt() for legacy browsers.
  if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
    try {
      await navigator.share({
        title: 'Your estimate from ' + ((window._brand && window._brand().displayName) || 'No Big Deal'),
        text: 'Here’s your estimate. Tap the link to review:',
        url,
      });
      return;
    } catch (_) { /* user cancelled; fall through to clipboard */ }
  }
  try {
    await navigator.clipboard.writeText(url);
    if (typeof showToast === 'function') showToast('Customer view link copied ✓', 'success');
  } catch (_) {
    // Last resort prompt — user can manually copy.
    try { window.prompt('Copy this link:', url); } catch (_) {}
  }
};

// NOTE: a second, dead window.generateCertFromEstimate definition used to live
// here (a sessionStorage '_pendingCert' → cert-wizard pre-fill flow). It was
// shadowed at runtime by the later async definition below (window assignments —
// last one wins), so it never executed. Removed as dead code. Its consumer
// (dashboard-bootstrap.module.js reads '_pendingCert' to pre-fill the wizard)
// is intentionally kept: that wizard-prefill was likely the *intended* UX and
// also routes through the sandboxed NBDDocViewer — restoring it (in place of
// the document.write popup below) is a UX call left to the owner.

// NOTE: a first, dead window.exportCustomerEstimate (a document.write print
// popup) used to live here. It was shadowed by the later jsPDF definition —
// window assignments, last one wins — so it never ran. Its two behaviours the
// winner lacked (buildDisplayRows retail lines, window._brand() tenant
// branding) were ported into that jsPDF export before this was deleted; see
// the "EXPORT ESTIMATE AS PDF" block below.

// Lightbox functionality.
//
// The ‹ › arrows used to walk window._customerPhotos regardless of which array
// actually opened the viewer. customer-tasks-ui.js's openPhotoLightbox() opens
// the SAME #lightbox from window._allPhotos and can't reach this module's
// _lightboxIndex, so paging out of one of its photos indexed a different array
// — and these two arrays differ in LENGTH, not just order (_customerPhotos
// drops the userId filter for team readers, see _photoQueryScopes; _allPhotos
// always filters by uid). So the cursor and the array it indexes must travel
// together: _lightboxSource is whatever array opened the viewer.
window._customerPhotos = [];
_lightboxIndex = 0;
_lightboxSource = null;

// srcArray is optional — callers on this page pass an index into
// window._customerPhotos and get the historical behaviour.
window.openLightbox = function(index, srcArray) {
  const src = Array.isArray(srcArray) ? srcArray : (window._customerPhotos || []);
  const photo = src[index];
  if (!photo) return;
  _lightboxSource = src;
  _lightboxIndex = index;
  document.getElementById('lightboxImg').src = photo.url;
  document.getElementById('lightbox').classList.add('active');
  document.body.style.overflow = 'hidden';
};

// Handshake for foreign openers (customer-tasks-ui.js's openPhotoLightbox,
// which is handed a bare url): tell the arrows which array they're paging and
// where in it the visible photo sits. Pass an empty array to disable paging.
window.setLightboxSource = function(srcArray, idx) {
  _lightboxSource = Array.isArray(srcArray) ? srcArray : null;
  _lightboxIndex = Number(idx) || 0;
};

window.closeLightbox = function() {
  document.getElementById('lightbox').classList.remove('active');
  document.body.style.overflow = '';
};

// Empty/absent source: `idx % 0` is NaN and src[NaN].url throws, so page nowhere.
function _stepLightbox(delta) {
  const src = _lightboxSource || window._customerPhotos || [];
  if (!src.length) return;
  _lightboxIndex = (_lightboxIndex + delta + src.length) % src.length;
  const photo = src[_lightboxIndex];
  if (!photo || !photo.url) return;
  document.getElementById('lightboxImg').src = photo.url;
}

window.nextPhoto = function() { _stepLightbox(1); };

window.prevPhoto = function() { _stepLightbox(-1); };

// Keyboard navigation for lightbox
document.addEventListener('keydown', (e) => {
  if (!document.getElementById('lightbox').classList.contains('active')) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowRight') nextPhoto();
  if (e.key === 'ArrowLeft') prevPhoto();
});

// Escape-key dismissal for the gallery share panel. Every .modal-bg modal on
// the page is now nbdModal-managed (batch-4 consolidation) and closes via the
// helper's own Esc handler, so this only needs to cover gallerySharePanel,
// which opens inline (display:block via flex container) and has no named
// close fn. The lightbox has its own handler above and returns early there.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('lightbox')?.classList.contains('active')) return;
  const share = document.getElementById('gallerySharePanel');
  if (share && share.style.display && share.style.display !== 'none') {
    share.style.display = 'none';
  }
});

// Stage progression — picks the right pipeline based on lead jobType
window.progressStage = async function() {
  // Per-track pipelines — mirror VIEW_INSURANCE / VIEW_CASH / VIEW_FINANCE /
  // VIEW_WARRANTY / VIEW_SERVICE in js/crm-stages.js. If those change,
  // update here too. Warranty + service don't converge through
  // contract_signed — they skip into their own short close-out paths.
  const PIPELINES = {
    insurance: [
      'new', 'contacted', 'inspected', 'claim_filed',
      'adjuster_meeting_scheduled', 'adjuster_inspection_done',
      'scope_received', 'estimate_submitted',
      'supplement_requested', 'supplement_approved',
      'contract_signed',
      'job_created', 'permit_pulled', 'materials_ordered', 'materials_delivered',
      'crew_scheduled', 'install_in_progress', 'install_complete',
      'final_photos', 'deductible_collected', 'final_payment', 'closed'
    ],
    cash: [
      'new', 'contacted', 'inspected',
      'estimate_sent_cash', 'negotiating', 'contract_signed',
      'job_created', 'permit_pulled', 'materials_ordered', 'materials_delivered',
      'crew_scheduled', 'install_in_progress', 'install_complete',
      'final_photos', 'final_payment', 'closed'
    ],
    finance: [
      'new', 'contacted', 'inspected',
      'prequal_sent', 'loan_approved', 'contract_signed',
      'job_created', 'permit_pulled', 'materials_ordered', 'materials_delivered',
      'crew_scheduled', 'install_in_progress', 'install_complete',
      'final_photos', 'final_payment', 'closed'
    ],
    warranty: [
      'new', 'contacted', 'inspected',
      'warranty_scheduled', 'warranty_repaired', 'closed'
    ],
    service: [
      'new', 'contacted', 'inspected',
      'service_quoted', 'service_approved',
      'install_in_progress', 'install_complete', 'closed'
    ]
  };

  // Legacy stage mapping for backward compat
  const legacyMap = {
    'New': 'contacted', 'Inspection': 'inspected', 'Inspected': 'claim_filed',
    'Estimate': 'contract_signed', 'Estimate Sent': 'contract_signed',
    'Approved': 'job_created', 'In Progress': 'install_complete', 'Complete': 'closed'
  };

  const current = window._currentStage || 'new';
  // Pick pipeline based on lead jobType (defaults to insurance)
  const lead = window._leadDoc || {};
  const jobType = lead.jobType || 'insurance';
  const pipeline = PIPELINES[jobType] || PIPELINES.insurance;
  let nextStage;

  // Try track-specific pipeline first
  const idx = pipeline.indexOf(current);
  if (idx >= 0 && idx < pipeline.length - 1) {
    nextStage = pipeline[idx + 1];
  } else if (legacyMap[current]) {
    nextStage = legacyMap[current];
  }

  if (!nextStage) return;

  // Get display label for confirmation
  const STAGE_LABELS = {
    'new': 'New Lead', 'contacted': 'Contacted', 'inspected': 'Inspected',
    'claim_filed': 'Claim Filed', 'adjuster_meeting_scheduled': 'Adjuster Meeting',
    'adjuster_inspection_done': 'Adjuster Done', 'scope_received': 'Scope Received',
    'estimate_submitted': 'Estimate Sent', 'supplement_requested': 'Supplement',
    'supplement_approved': 'Supp. Approved', 'contract_signed': 'Contract Signed',
    'job_created': 'Job Created', 'permit_pulled': 'Permit', 'materials_ordered': 'Materials Ordered',
    'materials_delivered': 'Materials Here', 'crew_scheduled': 'Crew Scheduled',
    'install_in_progress': 'Installing', 'install_complete': 'Install Done',
    'final_photos': 'Final Photos', 'deductible_collected': 'Deductible',
    'final_payment': 'Final Payment', 'closed': 'Closed'
  };

  const label = STAGE_LABELS[nextStage] || nextStage;

  // Use nbdConfirm when available — native confirm() is patched by
  // standalone-compat.js to silently return true in PWA mode, which
  // means the user never actually sees the prompt. nbdConfirm renders
  // a real themed modal in both modes.
  const ask = window.nbdConfirm || ((m) => Promise.resolve(window.confirm(m)));
  const ok = await ask(`Move customer to "${label}" stage?`);
  if (!ok) return;

  // Pre-flight: surface common failure causes immediately rather than
  // letting the writer fail silently. The original implementation
  // swallowed errors via patched alert() (also a 4s toast in PWA),
  // which is why "the button does nothing" felt accurate.
  if (!window._customerId) {
    if (window.showToast) window.showToast('Could not find this customer record (try reloading).', 'error');
    return;
  }
  if (!window.db || !window.updateDoc || !window.doc) {
    if (window.showToast) window.showToast('Firebase not ready yet — wait a moment and retry.', 'error');
    return;
  }

  const btnEl = document.getElementById('stageProgressBtn');
  const btnText = btnEl ? btnEl.innerHTML : '';
  if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '… Saving'; }

  try {
    const oldStage = current;
    const historyEvent = {
      from: oldStage,
      to: nextStage,
      timestamp: new Date().toISOString(),
      user: window.auth?.currentUser?.email || 'unknown'
    };

    await window.updateDoc(window.doc(window.db, 'leads', window._customerId), {
      stage: nextStage,
      updatedAt: window.serverTimestamp(),
      // Keep parity with crm.js moveCard so the days-in-stage badge on
      // the hero (PR #31) resets correctly when moves happen here too.
      stageStartedAt: window.serverTimestamp(),
      stageHistory: window.arrayUnion(historyEvent)
    });

    if (window.showToast) window.showToast('✓ Stage moved to ' + (STAGE_LABELS[nextStage] || nextStage), 'success');
    // Brief delay so the toast is seen before reload.
    setTimeout(() => window.location.reload(), 600);
  } catch (e) {
    console.error('Error updating stage:', e);
    if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = btnText; }
    const msg = (e && e.message) ? e.message : 'unknown error';
    if (window.showToast) {
      window.showToast('Failed to move stage: ' + msg, 'error');
    } else {
      // Last-resort fallback if showToast somehow isn't available.
      window.alert('Failed to update stage: ' + msg);
    }
  }
};

// Task toggle
window.toggleTask = async function(taskId, newDoneState) {
  try {
    await updateDoc(doc(db, 'tasks', taskId), {
      done: newDoneState,
      completedAt: newDoneState ? serverTimestamp() : null,
      updatedAt: serverTimestamp()
    });
    
    // Reload timeline
    await loadTimeline(window._customerId, { createdAt: new Date() });
  } catch (e) {
    console.error('Error toggling task:', e);
  }
};

// Error display
function showError(title, message) {
  const container = document.querySelector('.container');
  const esc = window.nbdEsc || (s => String(s == null ? '' : s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
  container.innerHTML = `
    <div style="text-align:center; padding:60px 20px;">
      <div style="font-size:64px; margin-bottom:20px;">⚠️</div>
      <div style="font-size:24px; font-weight:700; margin-bottom:12px;">${esc(title)}</div>
      <div style="color:var(--m); margin-bottom:24px;">${esc(message)}</div>
      <a href="/pro/dashboard" class="btn btn-orange">← Back to Dashboard</a>
    </div>
  `;
}

// ============================================
// PHOTO UPLOAD SYSTEM
// ============================================

window._uploadQueue = [];

// Background-safe close cleanup — runs on EVERY dismiss path (Cancel/×
// button, Esc, backdrop) via nbdModal's onClose. If any item is mid-upload,
// keep the queue + uploads running and just refresh the global widget (the
// queue clears itself in uploadPhotos()'s post-loop reload); otherwise clear
// the queue + preview + file input so the next open starts fresh.
function _uploadModalOnClose() {
  var hasInflight = (window._uploadQueue || []).some(function(it){
    return it && it.uploading && (it.progress == null || it.progress < 100);
  });
  if (hasInflight) {
    updateGlobalUploadStatus();
    return;
  }
  window._uploadQueue = [];
  const preview = document.getElementById('uploadPreview');
  if (preview) preview.innerHTML = '';
  const fileInput = document.getElementById('fileInput');
  if (fileInput) fileInput.value = '';
  updateUploadPreview();
  updateGlobalUploadStatus();
}

window.openUploadModal = function() {
  // Belt-and-suspenders reset — Joe reported the prior batch's photos
  // still showing when reopening the modal. Likely cause: iOS Safari
  // BFCache or PWA state preservation can leave the queue + preview
  // DOM intact across navigations, and reopening the modal didn't fully
  // clear them. Force-reset all three sources of stale state:
  //   1) the JS queue array
  //   2) the preview container's innerHTML
  //   3) the file input's selection (so the same files can be picked again)
  window._uploadQueue = [];
  const preview = document.getElementById('uploadPreview');
  if (preview) preview.innerHTML = '';
  const fileInput = document.getElementById('fileInput');
  if (fileInput) fileInput.value = '';
  updateUploadPreview();
  window.nbdModal.open('uploadModal', { onClose: _uploadModalOnClose });
};

window.closeUploadModal = function() {
  // Routes through nbdModal → _uploadModalOnClose, which preserves in-flight
  // uploads (the modal hides but the queue + widget keep running).
  window.nbdModal.close('uploadModal');
};

// Drag and drop handlers - Initialize after DOM loads
function initPhotoUploadHandlers() {
  const uploadZone = document.getElementById('uploadZone');
  if (!uploadZone) return;

  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });

  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('drag-over');
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');

    const files = Array.from(e.dataTransfer.files).filter(isSupportedImageFile);
    addFilesToQueue(files);
  });
}

// ── HEIC-aware image detector ──
// Chrome on Windows / some Firefox versions return an EMPTY MIME type
// for HEIC files from iPhone. Falling back to filename extension fixes
// the false-negative. Also accepts jpeg/png/webp/gif/heic/heif/avif.
const SUPPORTED_IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp|tiff?)$/i;
const SUPPORTED_IMAGE_MIME = /^image\/(jpe?g|png|webp|gif|heic|heif|avif|bmp|tiff?)$/i;
function isSupportedImageFile(file) {
  if (!file) return false;
  // Prefer MIME type when the browser fills it in
  if (file.type && SUPPORTED_IMAGE_MIME.test(file.type)) return true;
  // Generic 'image/*' match (browser told us it's an image)
  if (file.type && file.type.startsWith('image/')) return true;
  // Fallback: check filename extension (handles empty-MIME HEIC case)
  if (file.name && SUPPORTED_IMAGE_EXT.test(file.name)) return true;
  return false;
}
// Expose globally so other handlers can reuse it
window.isSupportedImageFile = isSupportedImageFile;

// Call initialization when modal is opened
const originalOpenUploadModal = window.openUploadModal;
window.openUploadModal = function() {
  originalOpenUploadModal();
  initPhotoUploadHandlers();
};

window.handleFileSelect = function(event) {
  const files = Array.from(event.target.files);
  addFilesToQueue(files);
  event.target.value = ''; // Reset input
};

// Batch size cap — iPhone "Select All" can grab 200+ photos. Without
// a cap, the browser tab can hang, Firebase Storage accumulates
// half-uploaded bytes, and the customer demo locks up. 25 is the
// sweet spot: covers a full slope set (before/during/after) but
// stays responsive. Users can run multiple batches back-to-back.
const PHOTO_MAX_BATCH = 25;
window.PHOTO_MAX_BATCH = PHOTO_MAX_BATCH;

function addFilesToQueue(files) {
  // Enforce batch cap up-front before any per-file work. If the
  // user dropped more than PHOTO_MAX_BATCH, take the first 25 and
  // warn via toast — don't reject the whole batch.
  if (files.length > PHOTO_MAX_BATCH) {
    const dropped = files.length - PHOTO_MAX_BATCH;
    files = files.slice(0, PHOTO_MAX_BATCH);
    const msg = `Only the first ${PHOTO_MAX_BATCH} photos will upload. ${dropped} skipped — you can add them in the next batch.`;
    if (typeof showToast === 'function') showToast(msg, 'warning');
    else alert(msg);
  }

  files.forEach(file => {
    // Validate file size (max 15MB — iPhone HEIC photos often exceed 10MB)
    if (file.size > 15 * 1024 * 1024) {
      alert(`File ${file.name} is too large (${(file.size/1024/1024).toFixed(1)} MB). Max size is 15 MB.`);
      return;
    }

    // Validate file type — HEIC-aware (checks MIME + filename extension)
    if (!isSupportedImageFile(file)) {
      alert(`File ${file.name} is not a supported image type. Supported: JPG, PNG, HEIC, HEIF, WebP, GIF, AVIF.`);
      return;
    }

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      window._uploadQueue.push({
        file: file,
        preview: e.target.result,
        progress: 0,
        uploading: false
      });
      updateUploadPreview();
    };
    reader.readAsDataURL(file);
  });
}

// updateUploadPreview() runs on every state_changed tick (potentially
// multiple times per second per file). The original blew away the
// container's innerHTML on every call — re-decoding 25 thumbnails and
// re-creating 25 progress bars per tick. This split keeps the structure
// stable and only patches the bar/percent text via direct refs.
function renderUploadPreviewStructure() {
  const container = document.getElementById('uploadPreview');
  const uploadBtn = document.getElementById('uploadBtn');
  const uploadCount = document.getElementById('uploadCount');
  if (!container || !uploadBtn || !uploadCount) return;

  if (window._uploadQueue.length === 0) {
    container.innerHTML = '';
    uploadBtn.style.display = 'none';
    var _metaSecEmpty = document.getElementById('uploadMetaSection');
    if (_metaSecEmpty) _metaSecEmpty.style.display = 'none';
    return;
  }

  var html = '';
  for (var i = 0; i < window._uploadQueue.length; i++) {
    var item = window._uploadQueue[i];
    html += '<div class="preview-item" data-upload-idx="' + i + '">';
    html += '<img src="' + item.preview + '" alt="Preview" loading="lazy" decoding="async">';
    if (!item.uploading) {
      html += '<button class="preview-remove" data-action="removeFromQueue" data-arg=" + i + ">×</button>';
    }
    html += '<div class="preview-progress" style="display:' + (item.uploading ? 'block' : 'none') + ';">';
    html += '<div class="preview-progress-bar" style="width:' + (item.progress || 0) + '%"></div>';
    html += '</div>';
    html += '<div class="preview-progress-pct" style="display:' + (item.uploading ? 'block' : 'none') + ';">' + Math.round(item.progress || 0) + '%</div>';
    html += '</div>';
  }
  container.innerHTML = html;
  uploadBtn.style.display = 'block';
  uploadCount.textContent = window._uploadQueue.length;
  var _metaSec = document.getElementById('uploadMetaSection');
  if (_metaSec) _metaSec.style.display = window._uploadQueue.length > 0 ? '' : 'none';
}

// Surgical per-tick update — only touches the bar width + percent text
// for the one item that just ticked. Falls back to full structure
// render when the count of items doesn't match (add/remove from queue).
function updateUploadPreviewItem(idx) {
  const container = document.getElementById('uploadPreview');
  if (!container) return;
  var tile = container.querySelector('.preview-item[data-upload-idx="' + idx + '"]');
  if (!tile) {
    renderUploadPreviewStructure();
    return;
  }
  var item = window._uploadQueue[idx];
  if (!item) {
    renderUploadPreviewStructure();
    return;
  }
  var bar = tile.querySelector('.preview-progress-bar');
  var barWrap = tile.querySelector('.preview-progress');
  var pct = tile.querySelector('.preview-progress-pct');
  if (bar) bar.style.width = (item.progress || 0) + '%';
  if (barWrap) barWrap.style.display = item.uploading ? 'block' : 'none';
  if (pct) {
    pct.textContent = Math.round(item.progress || 0) + '%';
    pct.style.display = item.uploading ? 'block' : 'none';
  }
  // Hide the remove button once the upload starts.
  if (item.uploading) {
    var rm = tile.querySelector('.preview-remove');
    if (rm) rm.style.display = 'none';
  }
}

// Backwards-compatible alias — existing call sites that change the
// queue length (add/remove) still fire a full structure render.
function updateUploadPreview() {
  renderUploadPreviewStructure();
  updateGlobalUploadStatus();
}

// Drives the floating upload widget (right-bottom corner). Visible
// whenever any queue item is mid-upload. Aggregates byte progress
// across all in-flight uploads for the bar fill.
function updateGlobalUploadStatus() {
  var widget = document.getElementById('nbdUploadWidget');
  if (!widget) return;
  var queue = window._uploadQueue || [];
  var inflight = queue.filter(function(it){ return it && it.uploading && (it.progress == null || it.progress < 100); });
  // Hide widget when nothing is in-flight.
  if (inflight.length === 0) {
    widget.classList.remove('active');
    return;
  }
  var done = queue.filter(function(it){ return it && it.uploading && it.progress >= 100; }).length;
  var total = queue.filter(function(it){ return it && it.uploading; }).length;
  // Aggregate progress = average of all uploading-or-done items.
  var sum = 0;
  for (var i = 0; i < queue.length; i++) {
    if (queue[i] && queue[i].uploading) sum += Math.min(100, queue[i].progress || 0);
  }
  var pct = total ? Math.round(sum / total) : 0;
  var label = document.getElementById('nbdUploadWidgetLabel');
  var count = document.getElementById('nbdUploadWidgetCount');
  var fill = document.getElementById('nbdUploadWidgetBarFill');
  var reopen = document.getElementById('nbdUploadWidgetReopen');
  if (label) label.textContent = 'Uploading photos…';
  if (count) count.textContent = (done + 1 > total ? total : done + 1) + ' / ' + total + ' • ' + pct + '%';
  if (fill) fill.style.width = pct + '%';
  // Only show the "View details" button when the modal is closed.
  // (uploadModal is nbdModal-managed now — open state is the .open class.)
  var modal = document.getElementById('uploadModal');
  var modalOpen = modal && modal.classList.contains('open');
  if (reopen) reopen.style.display = modalOpen ? 'none' : 'block';
  widget.classList.add('active');
}

window.removeFromQueue = function(index) {
  window._uploadQueue.splice(index, 1);
  updateUploadPreview();
};

window.uploadPhotos = async function() {
  if (window._uploadQueue.length === 0) return;
  if (!window._customerId) {
    if (window.showToast) window.showToast('Customer ID not found', 'error');
    else alert('Customer ID not found');
    return;
  }

  const uploadBtn = document.getElementById('uploadBtn');
  if (uploadBtn) {
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';
  }
  var queueSnapshot = window._uploadQueue.length;

  try {
    for (let i = 0; i < window._uploadQueue.length; i++) {
      const item = window._uploadQueue[i];
      item.uploading = true;
      // Render the structure once so the DOM has the bar/% nodes;
      // per-tick updates from uploadSinglePhoto are surgical.
      renderUploadPreviewStructure();
      updateGlobalUploadStatus();

      await uploadSinglePhoto(item, i);
      // Mark complete so the global widget stops counting it.
      item.progress = 100;
      updateUploadPreviewItem(i);
      updateGlobalUploadStatus();
    }

    // All uploads finished. Toast + close + reload (no blocking alert).
    if (window.showToast) {
      window.showToast('✓ Uploaded ' + queueSnapshot + ' photo' + (queueSnapshot === 1 ? '' : 's'), 'success');
    }
    // Force a full close — the queue is done, so the background-safe
    // guard in closeUploadModal sees no in-flight items and clears.
    closeUploadModal();
    if (window.loadPhotosByPhase) await window.loadPhotosByPhase(window._customerId);
    try { await loadPhotos(window._customerId); } catch(e) {}

    // Reload timeline to show photo upload events
    const leadSnap3 = await window.getDoc(window.doc(window.db, 'leads', window._customerId));
    if (leadSnap3.exists()) {
      if (window.loadTimeline) await window.loadTimeline(window._customerId, leadSnap3.data());
    }

  } catch (error) {
    console.error('Upload error:', error);
    if (window.showToast) {
      window.showToast('Some uploads failed: ' + (error?.message || 'unknown error'), 'error');
    }
    // Mark failed items so the preview can render their state, then
    // clear the queue so stuck files disappear.
    window._uploadQueue.forEach(item => { item.failed = true; });
    renderUploadPreviewStructure();
    window._uploadQueue = [];
    renderUploadPreviewStructure();
    updateGlobalUploadStatus();
  } finally {
    if (uploadBtn) {
      uploadBtn.disabled = false;
      uploadBtn.textContent = '📤 Upload Photos';
    }
  }
};

async function uploadSinglePhoto(item, index) {
  const file = item.file;
  const timestamp = Date.now();
  // Storage rules (storage.rules, 2026-04-11 hardening) require
  // path `photos/{uid}/{file}`. The legacy `photos/{file}` path
  // was blocked by the default-deny rule at the bottom of the
  // rules file, which is why photo uploads were failing.
  const uid = window.auth?.currentUser?.uid;
  if (!uid) throw new Error('Not signed in — cannot upload');
  // Sanitize the filename: keep ASCII word chars, dots, dashes;
  // replace everything else with underscore. Prevents Unicode /
  // space / paren issues that can choke the storage path parser.
  const safeName = (file.name || 'upload').replace(/[^A-Za-z0-9._-]+/g, '_').substring(0, 120);
  const filename = `${window._customerId}_${timestamp}_${safeName}`;
  const storageRef = window.ref(window.storage, `photos/${uid}/${filename}`);

  // Photo system Phase 2: kick off EXIF + slope inference IN PARALLEL
  // with the upload. The result lands while bytes are still flying;
  // we merge it into the photo doc when the upload completes. Failing
  // to parse EXIF (drone DNG, screenshot, stripped-metadata file) is
  // not fatal — the photo doc just lacks `exif` + `inferredLocation`.
  const ingestPromise = (window.PhotoSmartIngest
    && typeof window.PhotoSmartIngest.analyze === 'function')
    ? window.PhotoSmartIngest.analyze(file, window._currentLead || null)
        .catch(e => { console.warn('[smart-ingest] analyze failed:', e.message); return null; })
    : Promise.resolve(null);

  const uploadTask = window.uploadBytesResumable(storageRef, file);

  return new Promise((resolve, reject) => {
    uploadTask.on('state_changed',
      (snapshot) => {
        // Progress tracking — surgical update (only the bar + % text
        // for this one item), plus the global floating widget.
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        window._uploadQueue[index].progress = progress;
        updateUploadPreviewItem(index);
        updateGlobalUploadStatus();
      },
      (error) => {
        console.error('Upload error:', error);
        reject(error);
      },
      async () => {
        // Upload complete - get download URL and save to Firestore
        try {
          const downloadURL = await window.getDownloadURL(uploadTask.snapshot.ref);
          // storagePath is the canonical Storage object name. The
          // image-pipeline Cloud Function (functions/image-pipeline.js)
          // looks up the photo doc by this field after generating
          // _thumb/_med/_full WebP variants — so the trigger can
          // stamp `urls: {thumb,med,full}` without cracking the
          // tokenized download URL.
          const storagePath = `photos/${uid}/${filename}`;

          // Wait for the parallel smart-ingest analysis. At this point
          // bytes have finished uploading; EXIF parsing on the head
          // 256KB of file usually finishes long before, so this is a
          // no-op await in the common case.
          const ingest = await ingestPromise;

          const photoDoc = {
            leadId: window._customerId,
            userId: window.auth.currentUser.uid,
            // Tenant key (claims.companyId || uid — the Phase-1.5 rule):
            // lets the dashboard thumbnail cache and team galleries find
            // this photo with one company-scoped query instead of a
            // per-lead parent lookup.
            companyId: (window._userClaims && window._userClaims.companyId) || window.auth.currentUser.uid,
            url: downloadURL,
            storagePath: storagePath,
            filename: file.name,
            size: file.size,
            type: file.type,
            date: window.serverTimestamp(),
            uploadedAt: window.serverTimestamp(),
            phase: window._uploadPhase || 'During',
            category: 'Property',
            damageType: document.getElementById('uploadDamageType')?.value || '',
            severity: window._uploadSeverity || '',
            location: document.getElementById('uploadLocation')?.value || ''
          };

          if (ingest && ingest.exif) {
            // Strip undefined-valued fields so Firestore doesn't choke.
            const e = {};
            for (const k of Object.keys(ingest.exif)) {
              if (ingest.exif[k] !== undefined && ingest.exif[k] !== null) e[k] = ingest.exif[k];
            }
            if (Object.keys(e).length) photoDoc.exif = e;
          }
          if (ingest && ingest.inferredLocation) {
            photoDoc.inferredLocation = ingest.inferredLocation;
            // If the rep hasn't manually typed a location, prefill the
            // location field with the inferred one. They can override
            // in the Review UI (Phase 4) — this just gives the field
            // a sensible default at upload time so the photo isn't
            // un-located if the rep never opens Review.
            if (!photoDoc.location) {
              photoDoc.location = ingest.inferredLocation.label;
            }
          }

          const newPhotoRef = await window.addDoc(window.collection(window.db, 'photos'), photoDoc);

          // Photo system Phase 3: fire-and-forget AI classification.
          // analyzePhotoVision writes the suggestion back to the photo
          // doc as `aiSuggestion`, so the Review UI (Phase 4) just
          // reads it from Firestore. Capped at $10/lead + $50/user/mo
          // server-side; UI listens for nbd:ai-classify-skipped to
          // surface cap-reached toasts. We don't await — keeps the
          // upload progress UI snappy.
          if (window.PhotoAIClassifier && newPhotoRef && newPhotoRef.id) {
            window.PhotoAIClassifier.classify(newPhotoRef.id).catch(() => {});
          }

          resolve();
        } catch (error) {
          reject(error);
        }
      }
    );
  });
}


// ============================================
// ESTIMATE DETAIL MODAL
// ============================================

window._currentEstimateId = null;

window.viewEstimate = function(estimateId) {
  const estimate = (window._customerEstimates || []).find(e => e.id === estimateId);
  if (!estimate) {
    alert('Estimate not found');
    return;
  }

  window._currentEstimateId = estimateId;

  // Phase 1a (RoofLink rebuild): the shared preview sheet understands BOTH
  // estimate shapes. The legacy modal below reads the classic fields only
  // (lineItems/title/amount), so a V2 doc (rows/name/grandTotal) rendered
  // as "Untitled, $0, no lines" — the reported can't-preview-Joe's-
  // estimates bug. Legacy modal stays as the fallback if the module
  // didn't load.
  if (window.EstimatePreview) {
    window.EstimatePreview.open(estimate, {
      onEdit: function () {
        window.location.href = '/pro/dashboard?edit=' + encodeURIComponent(window._customerId) + '&est=' + encodeURIComponent(estimateId);
      },
      onArchive: async function () {
        const ask = window.nbdConfirm || ((m) => Promise.resolve(window.confirm(m)));
        if (!(await ask('Archive this estimate? It will be hidden but never permanently deleted.'))) return;
        try {
          // SOFT DELETE — never deleteDoc on estimates (standing rule).
          await updateDoc(doc(db, 'estimates', estimateId), {
            deleted: true,
            deletedAt: serverTimestamp()
          });
          window._currentEstimateId = null;
          await loadEstimates(window._customerId);
          const leadSnap = await getDoc(doc(db, 'leads', window._customerId));
          if (leadSnap.exists()) {
            await loadTimeline(window._customerId, leadSnap.data());
          }
        } catch (error) {
          console.error('Archive error:', error);
          alert('Failed to archive estimate.');
        }
      }
    });
    return;
  }

  const esc = window.nbdEsc || (s => String(s == null ? '' : s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));

  // Parse line items if they exist
  let lineItemsHTML = '';
  if (estimate.lineItems && Array.isArray(estimate.lineItems) && estimate.lineItems.length > 0) {
    lineItemsHTML = `
      <div style="margin-bottom:20px;">
        <div style="font-size:12px;font-weight:600;color:var(--m);margin-bottom:10px;text-transform:uppercase;letter-spacing:.06em;">Line Items</div>
        <div style="background:var(--s2);border:1px solid var(--br);border-radius:6px;overflow:hidden;">
          ${estimate.lineItems.map(item => `
            <div style="display:flex;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--br);">
              <div>
                <div style="font-size:13px;font-weight:600;margin-bottom:2px;">${esc(item.description || item.name || 'Item')}</div>
                ${item.quantity ? `<div style="font-size:11px;color:var(--m);">Qty: ${esc(item.quantity)} ${esc(item.unit || '')}</div>` : ''}
              </div>
              <div style="font-size:14px;font-weight:700;color:var(--orange);">
                ${item.amount ? `$${parseFloat(item.amount).toLocaleString()}` : '—'}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
  
  // Build pricing breakdown
  const subtotal = parseFloat(estimate.subtotal || estimate.amount || 0);
  const tax = parseFloat(estimate.tax || 0);
  const total = parseFloat(estimate.total || estimate.amount || 0);
  
  const pricingHTML = `
    <div style="background:var(--s2);border:1px solid var(--br);border-radius:6px;padding:16px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
        <div style="font-size:13px;color:var(--m);">Subtotal</div>
        <div style="font-size:14px;font-weight:600;">$${subtotal.toLocaleString()}</div>
      </div>
      ${tax > 0 ? `
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <div style="font-size:13px;color:var(--m);">Tax</div>
          <div style="font-size:14px;font-weight:600;">$${tax.toLocaleString()}</div>
        </div>
      ` : ''}
      <div style="border-top:1px solid var(--br);margin:12px 0;"></div>
      <div style="display:flex;justify-content:space-between;">
        <div style="font-size:15px;font-weight:700;">Total</div>
        <div style="font-size:18px;font-weight:700;color:var(--orange);">$${total.toLocaleString()}</div>
      </div>
    </div>
  `;
  
  // Estimate metadata
  const createdDate = estimate.createdAt?.toDate ? estimate.createdAt.toDate().toLocaleDateString() : '—';
  const status = estimate.status || 'Draft';
  const statusColor = {
    'Draft': 'var(--m)',
    'Sent': 'var(--blue)',
    'Approved': 'var(--green)',
    'Rejected': 'var(--red)'
  }[status] || 'var(--m)';
  
  const metadataHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
      <div>
        <div style="font-size:11px;color:var(--m);margin-bottom:4px;">Title</div>
        <div style="font-size:14px;font-weight:600;">${esc(estimate.title || 'Untitled Estimate')}</div>
      </div>
      <div>
        <div style="font-size:11px;color:var(--m);margin-bottom:4px;">Status</div>
        <div style="font-size:13px;font-weight:600;color:${statusColor};">${esc(status)}</div>
      </div>
      <div>
        <div style="font-size:11px;color:var(--m);margin-bottom:4px;">Created</div>
        <div style="font-size:13px;">${esc(createdDate)}</div>
      </div>
      <div>
        <div style="font-size:11px;color:var(--m);margin-bottom:4px;">Estimate #</div>
        <div style="font-size:13px;font-family:'DM Mono',monospace;">${esc(String(estimate.id || '').substring(0,8).toUpperCase())}</div>
      </div>
    </div>
  `;

  // Notes — escape + convert newlines to <br>
  const notesBodyHtml = estimate.notes ? esc(estimate.notes).replace(/\n/g, '<br>') : '';
  const notesHTML = notesBodyHtml ? `
    <div style="margin-bottom:20px;">
      <div style="font-size:12px;font-weight:600;color:var(--m);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em;">Notes</div>
      <div style="background:var(--s2);border:1px solid var(--br);border-radius:6px;padding:12px;font-size:13px;line-height:1.6;color:var(--m);">
        ${notesBodyHtml}
      </div>
    </div>
  ` : '';
  
  // Assemble modal content
  document.getElementById('estimateModalContent').innerHTML = metadataHTML + lineItemsHTML + notesHTML + pricingHTML;
  
  // Wire up action buttons
  document.getElementById('editEstimateBtn').onclick = () => {
    // Navigate to dashboard estimate builder with this lead pre-loaded
    window.location.href = `/pro/dashboard?edit=${window._customerId}&est=${estimateId}`;
  };
  
  document.getElementById('deleteEstimateBtn').onclick = async () => {
    if (!confirm('Archive this estimate? It will be hidden but never permanently deleted.')) return;
    
    try {
      // SOFT DELETE — never use deleteDoc on estimates (standing rule: never lose a job)
      await updateDoc(doc(db, 'estimates', estimateId), {
        deleted: true,
        deletedAt: serverTimestamp()
      });
      // Close the viewer (not the create modal). Pre-fix this called
      // closeEstimateModal() which would have hidden the wrong modal
      // even if the viewer had been working.
      closeEstimateViewerModal();
      await loadEstimates(window._customerId);
      
      // Reload timeline
      const leadSnap = await getDoc(doc(db, 'leads', window._customerId));
      if (leadSnap.exists()) {
        await loadTimeline(window._customerId, leadSnap.data());
      }
    } catch (error) {
      console.error('Archive error:', error);
      alert('Failed to archive estimate.');
    }
  };
  
  // Show viewer modal (NOT the same as #estimateModal, which is the
  // create-estimate form). Pre-fix this targeted #estimateModal and
  // tried to render into a non-existent #estimateModalContent inside it.
  // onClose clears the working estimate id on any dismiss (Close button, Esc,
  // backdrop) so a stale id can't leak into a later edit/delete action.
  window.nbdModal.open('estimateViewerModal', { onClose: function() {
    window._currentEstimateId = null;
  } });
};

window.closeEstimateModal = function() {
  // Backwards-compat: keep the old name so any external callers still
  // dismiss the create modal as before. (onClose in openEstimateModal
  // nulls _currentEstimateId on every dismiss path.)
  window.nbdModal.close('estimateModal');
};

window.closeEstimateViewerModal = function() {
  window.nbdModal.close('estimateViewerModal');
};


// ============================================
// EXPORT ESTIMATE AS PDF
// ============================================
window.exportCustomerEstimate = async function(estimateId) {
  if (!estimateId || !window._customerEstimates) {
    if (typeof showToast === 'function') showToast('Estimate not found', 'error');
    return;
  }
  const est = window._customerEstimates.find(e => e.id === estimateId);
  if (!est) { if (typeof showToast === 'function') showToast('Estimate not found', 'error'); return; }

  try {
    // PR 2b3: jsPDF lazy-loads via the pdfexport bundle (~1.1 MB off boot).
    if (typeof window.jspdf === 'undefined' && window.ScriptLoader) {
      await window.ScriptLoader.loadBundle('pdfexport');
    }
    if (typeof window.jspdf === 'undefined') {
      if (typeof showToast === 'function') showToast('PDF tools failed to load — retry.', 'error');
      return;
    }
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'letter');
    const pw = pdf.internal.pageSize.getWidth();
    let y = 20;

    // Branding — tenant-aware (Phase B). This export hardcoded NBD's legal name
    // and navy, so a homeowner of ANY other tenant received a quote carrying
    // Joe's company. Same resolver + hex idiom as customer-photo-report-generator.js;
    // NBD renders byte-identical (its own colors ARE #1E3A6E / #E8720C).
    const _b = (window._brand && window._brand()) || {};
    const _isNbd = !_b.legalName || _b.legalName === 'No Big Deal Home Solutions';
    const _hx = (h) => { const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(h || '')); return m ? [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16)] : null; };
    const _pri = (!_isNbd && _hx(_b.colors && _b.colors.primary)) || [30, 58, 110];
    const _acc = (!_isNbd && _hx(_b.colors && _b.colors.accent)) || [232, 114, 12];
    const _legalName = _isNbd ? 'No Big Deal Home Solutions' : String(_b.legalName || '');

    // Header
    pdf.setFillColor(_pri[0], _pri[1], _pri[2]);
    pdf.rect(0, 0, pw, 28, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(18);
    pdf.text(_legalName, 14, 14);
    pdf.setFontSize(9);
    pdf.text('ESTIMATE', 14, 22);
    pdf.setFontSize(9);
    pdf.text(new Date().toLocaleDateString(), pw - 14, 14, { align: 'right' });
    y = 38;

    // Customer info
    const lead = window._currentLead || {};
    pdf.setTextColor(30, 30, 30);
    pdf.setFontSize(11);
    pdf.text(`Customer: ${(lead.firstName || '') + ' ' + (lead.lastName || '')}`.trim(), 14, y); y += 6;
    if (lead.address) { pdf.text(`Address: ${lead.address}`, 14, y); y += 6; }
    if (lead.phone) { pdf.text(`Phone: ${lead.phone}`, 14, y); y += 6; }
    y += 4;

    // Estimate details. Title reads through the two-shape helper: V2 docs name
    // the estimate in `name`, Classic docs in `title`.
    const _rowsApi = window.NBDCustomerEstimateRows;
    pdf.setFontSize(13);
    pdf.setTextColor(_acc[0], _acc[1], _acc[2]);
    pdf.text((_rowsApi && typeof _rowsApi.estimateName === 'function')
      ? _rowsApi.estimateName(est)
      : (est.title || est.name || est.addr || 'Estimate'), 14, y); y += 8;
    const tier = est.tier || est.tierName || '';
    if (tier) { pdf.setFontSize(9); pdf.setTextColor(100,100,100); pdf.text(`Tier: ${tier.toUpperCase()}`, 14, y); y += 6; }

    // Customer-facing lines at RETAIL. Reading est.lineItems ONLY printed a
    // homeowner PDF with no lines at all for V2 docs (rows/name/grandTotal — the
    // default for every new estimate): a header, the customer block and a Total.
    // buildDisplayRows is the shared derivation (rows[].retailTotal →
    // material×(1+markup)+labor → face value, plus the O&P line that makes the
    // lines foot to the subtotal); pre-sweep V2 rows hold the internal COST basis
    // in rate/total, so printing est.rows verbatim would expose the margin.
    // If that script is missing we fail CLOSED for margin data: V2-priced docs
    // print no lines (the Total still renders), classic rows/lineItems still do.
    // buildDisplayRows deliberately returns NO rows for per-SQ docs, whose rows
    // are the internal cost basis — empty rows AND no lineItems is the correct
    // summary-only render, not an error.
    const _hasV2Cost = Number.isFinite(Number(est.materialMarkupPct))
      || est.priceMode === 'per-sq' || est.prices != null;
    const displayRows = (_rowsApi && typeof _rowsApi.buildDisplayRows === 'function')
      ? _rowsApi.buildDisplayRows(est)
      : (_hasV2Cost ? [] : (est.rows || []));
    const lineItems = Array.isArray(est.lineItems) ? est.lineItems : [];
    // One print shape for both doc families: {desc, qty, rate(string), total(number)}.
    const printRows = displayRows.length
      ? displayRows.map(r => ({
          desc:  r.desc || r.description || '—',
          qty:   r.qty == null ? '' : r.qty,
          rate:  r.rate == null ? '' : r.rate,
          total: Number(r.total) || 0
        }))
      : lineItems.map(item => ({
          desc:  item.description || item.name || '—',
          qty:   item.qty || item.quantity || 1,
          rate:  '$' + (parseFloat(item.unitPrice || item.price || 0) || 0).toFixed(2),
          total: parseFloat(item.total || item.lineTotal || 0) || 0
        }));

    if (printRows.length > 0) {
      pdf.setFontSize(9);
      pdf.setTextColor(100,100,100);
      pdf.text('DESCRIPTION', 14, y);
      pdf.text('QTY', 120, y);
      pdf.text('PRICE', 150, y);
      pdf.text('TOTAL', 180, y);
      y += 2;
      pdf.setDrawColor(200, 200, 200);
      pdf.line(14, y, pw - 14, y);
      y += 5;

      pdf.setTextColor(30, 30, 30);
      printRows.forEach(r => {
        if (y > 250) { pdf.addPage(); y = 20; }
        pdf.text(String(r.desc).substring(0, 40), 14, y);
        pdf.text(String(r.qty), 125, y);
        pdf.text(String(r.rate), 148, y);
        pdf.text('$' + r.total.toFixed(2), 178, y);
        y += 6;
      });
      y += 4;
      pdf.line(14, y, pw - 14, y); y += 6;
    }

    // Totals
    pdf.setFontSize(12);
    pdf.setTextColor(_pri[0], _pri[1], _pri[2]);
    const total = (_rowsApi && typeof _rowsApi.estimateValue === 'function')
      ? _rowsApi.estimateValue(est)
      : (Number(est.grandTotal != null ? est.grandTotal : est.total != null ? est.total : est.amount) || 0);
    pdf.text(`Total: $${total.toLocaleString()}`, pw - 14, y, { align: 'right' });

    // Notes
    if (est.notes) {
      y += 12;
      pdf.setFontSize(9);
      pdf.setTextColor(100,100,100);
      pdf.text('Notes:', 14, y); y += 5;
      pdf.setTextColor(60,60,60);
      const noteLines = pdf.splitTextToSize(est.notes, pw - 28);
      pdf.text(noteLines, 14, y);
    }

    const custName = ((lead.firstName || '') + '_' + (lead.lastName || '')).trim().replace(/\s+/g, '_') || 'customer';
    // Doc-number prefix is per-tenant too — a non-NBD download shouldn't land
    // in the homeowner's folder named NBD_*.
    const _filePrefix = _isNbd ? 'NBD' : (String(_b.docPrefix || '').replace(/[^A-Za-z0-9]+/g, '') || 'Estimate');
    pdf.save(`${_filePrefix}_Estimate_${custName}_${estimateId.slice(0,6)}.pdf`);
    if (typeof showToast === 'function') showToast('Estimate PDF exported', 'ok');
  } catch (e) {
    console.error('Estimate export failed:', e);
    if (typeof showToast === 'function') showToast('Export failed — ' + e.message, 'error');
  }
};
// ── END EXPORT ─────────────────────────────────────────────────────────────

// ============================================
// GENERATE WARRANTY CERTIFICATE FROM ESTIMATE
// ============================================
window.generateCertFromEstimate = async function(estimateId) {
  if (!estimateId || !window._customerEstimates) {
    if (typeof showToast === 'function') showToast('Estimate not found', 'error');
    return;
  }
  const est = window._customerEstimates.find(e => e.id === estimateId);
  if (!est) { if (typeof showToast === 'function') showToast('Estimate not found', 'error'); return; }

  const lead = window._currentLead || {};
  // SECURITY: firstName/lastName/address come from public lead intake, and
  // est.title re-carries the address. This HTML is written via document.write
  // into a window.open('','_blank') popup that inherits THIS dashboard's origin
  // (no sandbox, no CSP) — an unescaped value is stored XSS executing in the
  // logged-in rep's session. Escape every attacker-controlled field.
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const custName = esc(((lead.firstName || '') + ' ' + (lead.lastName || '')).trim() || 'Customer');
  const installDate = lead.scheduledDate || new Date().toISOString().split('T')[0];
  const warrantyYears = 5;
  const expiryDate = new Date(installDate);
  expiryDate.setFullYear(expiryDate.getFullYear() + warrantyYears);

  // Accent is a literal here, not var(--orange): this popup links only
  // nbd-mobile.css, which never DECLARES --orange (it only reads it with a
  // fallback). Every var(--orange) resolved to nothing, which made the Print
  // button's background transparent — white text on the white certificate. The
  // theme tokens live on the app shell, which a document.write popup never loads.
  //
  // Print Certificate is wired by a <script> injected into the popup document,
  // the same way warranty-cert.js:250 does it. The button carried
  // data-action="print", but this page's delegated click listener lives in the
  // PARENT document and cannot see a click inside the popup, so it was dead. A
  // popup written by document.write is not a /pro page under the site CSP, so
  // the no-inline-script rule doesn't reach it (warranty-cert.js is precedent).
  // The certificate opens in a popup whose only stylesheet is nbd-mobile.css,
  // which never DECLARES --orange — so var(--orange) resolved to nothing there
  // and the accent rendered white-on-white. Resolve the tenant's accent from
  // THIS document (where the theme engine has set it) and interpolate a literal
  // into the popup. That keeps the popup on-theme for white-label tenants
  // instead of hardcoding NBD orange, and satisfies the bare-hex drift guard
  // in tests/crm-theme-contract.test.js.
  const accent = (getComputedStyle(document.documentElement)
    .getPropertyValue('--orange') || '').trim() || '#e8720c';
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Warranty Certificate — ${custName}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'Georgia',serif;background:#f8f6f1;display:flex;justify-content:center;align-items:center;min-height:100vh;min-height:100dvh;padding:20px;}
  .cert{background:#fff;border:3px double ${accent};padding:50px 60px;max-width:700px;width:100%;text-align:center;position:relative;}
  .cert::before{content:'';position:absolute;inset:8px;border:1px solid #d4a017;pointer-events:none;}
  .logo{font-family:'Arial Black',sans-serif;font-size:28px;color:${accent};letter-spacing:3px;margin-bottom:4px;}
  .logo-sub{font-size:11px;color:${accent};letter-spacing:4px;text-transform:uppercase;margin-bottom:30px;}
  h1{font-size:32px;color:${accent};margin-bottom:6px;letter-spacing:2px;}
  .seal{font-size:14px;color:#666;margin-bottom:30px;letter-spacing:1px;}
  .details{text-align:left;margin:24px 0;padding:20px;background:#fafaf8;border:1px solid #e8e4d8;border-radius:4px;}
  .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dotted #ddd;}
  .row:last-child{border:none;}
  .label{color:#888;font-size:13px;}
  .value{color:${accent};font-weight:bold;font-size:14px;}
  .footer{margin-top:30px;display:flex;justify-content:space-between;align-items:flex-end;}
  .sig{text-align:center;}
  .sig-line{width:180px;border-top:1px solid #333;margin-top:40px;padding-top:6px;font-size:11px;color:#888;}
  .print-btn{margin-top:24px;padding:12px 32px;background:${accent};color:#fff;border:none;border-radius:6px;font-size:14px;cursor:pointer;}
  @media print{.print-btn{display:none;} body{background:#fff;} .cert{border:3px double ${accent};}}
</style><link rel="stylesheet" href="/assets/css/nbd-mobile.css">
</head><body>
<div class="cert">
  <img src="/assets/images/nbd-logo.png" alt="No Big Deal Home Solutions" style="height:64px;width:auto;display:block;margin:0 auto 10px;" loading="lazy" decoding="async" />
  <div class="logo">NBD</div>
  <div class="logo-sub">No Big Deal Home Solutions</div>
  <h1>WARRANTY CERTIFICATE</h1>
  <div class="seal">Certificate of Workmanship Warranty</div>
  <div class="details">
    <div class="row"><span class="label">Customer</span><span class="value">${custName}</span></div>
    <div class="row"><span class="label">Property</span><span class="value">${esc(lead.address || '—')}</span></div>
    <div class="row"><span class="label">Work Performed</span><span class="value">${esc(est.title || 'Roofing Installation')}</span></div>
    <div class="row"><span class="label">Completion Date</span><span class="value">${new Date(installDate).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</span></div>
    <div class="row"><span class="label">Warranty Period</span><span class="value">${warrantyYears} Years</span></div>
    <div class="row"><span class="label">Warranty Expires</span><span class="value">${expiryDate.toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</span></div>
    <div class="row"><span class="label">Certificate #</span><span class="value">NBD-${estimateId.slice(0,8).toUpperCase()}</span></div>
  </div>
  <p style="font-size:12px;color:#666;line-height:1.7;margin:20px 0;">This certificate warrants that all work performed by No Big Deal Home Solutions at the above property was completed using industry-standard materials and craftsmanship. This warranty covers defects in workmanship for the period specified above.</p>
  <div class="footer">
    <div class="sig"><div class="sig-line">Contractor Signature</div></div>
    <div class="sig"><div class="sig-line">Date Issued: ${new Date().toLocaleDateString()}</div></div>
  </div>
  <button class="print-btn" id="certPrintBtn">🖨️ Print Certificate</button>
</div>
<script>document.getElementById('certPrintBtn').addEventListener('click',function(){window.print();});<\/script>
</body></html>`;

  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
    if (typeof showToast === 'function') showToast('Warranty certificate generated', 'ok');
  } else {
    if (typeof showToast === 'function') showToast('Pop-up blocked — allow pop-ups to generate certificates', 'error');
  }
};

// ============================================
// CUSTOMER PDF EXPORT
// ============================================

window.exportCustomerPDF = async function() {
  if (!window._customerId) {
    if (typeof showToast === 'function') showToast('Customer data not loaded', 'error');
    else alert('Customer data not loaded');
    return;
  }
  if (!window.NBDDocGen || typeof window.NBDDocGen.generate !== 'function') {
    if (typeof showToast === 'function') showToast('Document generator not loaded — refresh and try again', 'error');
    else alert('Document generator not loaded — refresh and try again');
    return;
  }

  try {
    if (typeof showToast === 'function') showToast('Generating customer report…', 'info');

    // Pull the latest shop-wide profile so the letterhead reflects any
    // recent Settings edits. Best-effort — cached/default profile is
    // already in window._companyProfile if the network call fails.
    if (typeof window._loadCompanyProfile === 'function') {
      try { await window._loadCompanyProfile(); } catch (_) { /* ignore */ }
    }

    const lead = window._currentLead || {};

    const customer = {
      id: window._customerId,
      firstName: lead.firstName || '',
      lastName: lead.lastName || '',
      name: ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim() || lead.name || 'Customer',
      address: lead.address || '',
      phone: lead.phone || '',
      email: lead.email || '',
      stage: lead.stage || '',
      createdAt: lead.createdAt || null
    };

    const project = {
      jobType:       lead.jobType || '',
      damageType:    lead.damageType || lead.serviceType || '',
      insCarrier:    lead.insCarrier || lead.insuranceCarrier || '',
      claimNumber:   lead.claimNumber || '',
      claimStatus:   lead.claimStatus || '',
      deductible:    lead.deductibleOrOwedByHO || lead.deductible || '',
      jobValue:      lead.jobValue || '',
      crew:          lead.crew || '',
      scheduledDate: lead.scheduledDate || '',
      scopeOfWork:   lead.scopeOfWork || ''
    };

    // Best-effort full-history gather. If any sub-query fails the section
    // just renders with whatever events did come back; the report still
    // ships rather than blocking on a partial Firestore outage.
    const [timeline, notes] = await Promise.all([
      _gatherTimelineForReport(window._customerId, lead).catch(() => []),
      _gatherNotesForReport(window._customerId).catch(() => [])
    ]);

    const estimates = Array.isArray(window._customerEstimates) ? window._customerEstimates : [];

    const slug = ((lead.lastName || '') + '-' + (lead.firstName || ''))
      .replace(/^-+|-+$/g, '').replace(/[^A-Za-z0-9]+/g, '-') || 'Customer';
    const filename = `${slug}-Report-${new Date().toISOString().slice(0,10)}.pdf`;

    await window.NBDDocGen.generate('customer_report', {
      leadId: window._customerId,
      filename,
      customer,
      project,
      timeline,
      estimates,
      notes
    });

  } catch (error) {
    console.error('Customer PDF export error:', error);
    if (typeof showToast === 'function') showToast('Failed to generate report — see console', 'error');
    else alert('Failed to generate PDF. Please try again.');
  }
};

// Rebuild the activity timeline from source collections so the exported
// PDF isn't capped by what the on-screen timeline happened to render.
// Mirrors loadTimeline() above but returns a plain array instead of HTML.
async function _gatherTimelineForReport(leadId, lead) {
  const timeline = [];

  if (lead && Array.isArray(lead.stageHistory)) {
    lead.stageHistory.forEach(h => {
      timeline.push({
        time: h.timestamp ? new Date(h.timestamp) : new Date(0),
        title: `Stage: ${h.from || '?'} → ${h.to || '?'}`,
        desc:  h.user || 'System',
        type:  'stage'
      });
    });
  }
  if (lead && lead.createdAt) {
    timeline.push({
      time: lead.createdAt?.toDate ? lead.createdAt.toDate() : new Date(lead.createdAt),
      title: 'Lead created',
      desc:  `Source: ${lead.source || 'Unknown'}`,
      type:  'stage'
    });
  }

  const uid = window.auth?.currentUser?.uid || null;
  const getDocs    = window.getDocs;
  const query      = window.query;
  const collection = window.collection;
  const where      = window.where;
  if (!window.db || !uid || typeof getDocs !== 'function' || typeof query !== 'function' || typeof collection !== 'function' || typeof where !== 'function') {
    return timeline.sort((a, b) => b.time - a.time);
  }

  try {
    // Unified store: leads/{leadId}/tasks (title on customer-created
    // docs, text on dashboard/quick-capture ones).
    const snap = await getDocs(query(collection(window.db, 'leads', leadId, 'tasks')));
    snap.docs.forEach(d => {
      const t = d.data();
      const created = t.createdAt?.toDate ? t.createdAt.toDate() : (t.createdAt ? new Date(t.createdAt) : new Date());
      timeline.push({
        time:  t.type === 'event' && t.eventAt ? new Date(t.eventAt) : created,
        title: (t.type === 'event' ? '📅 ' : (t.done ? '✓ ' : '')) + (t.title || t.text || 'Task'),
        desc:  t.type === 'event' ? (t.notes || '') : (t.dueDate ? `Due ${t.dueDate}` : ''),
        type:  t.type === 'event' ? 'event' : 'task'
      });
    });
  } catch (_) { /* ignore */ }

  try {
    const estDocs = await _getEstimateDocsForLead(leadId);
    estDocs.forEach(d => {
      const e = d.data();
      if (!e.createdAt) return;
      const created = e.createdAt?.toDate ? e.createdAt.toDate() : new Date(e.createdAt);
      timeline.push({
        time:  created,
        title: 'Estimate created',
        desc:  e.amount ? `$${parseFloat(e.amount).toLocaleString()}` : 'Draft',
        type:  'document'
      });
    });
  } catch (_) { /* ignore */ }

  try {
    const snap = await getDocs(query(collection(window.db, 'photos'), ..._photoQueryScopes(leadId)));
    snap.docs.forEach(d => {
      const p = d.data();
      if (!p.uploadedAt) return;
      const up = p.uploadedAt?.toDate ? p.uploadedAt.toDate() : new Date(p.uploadedAt);
      timeline.push({
        time:  up,
        title: 'Photo uploaded',
        desc:  p.category || 'Property photo',
        type:  'photo'
      });
    });
  } catch (_) { /* ignore */ }

  try {
    const snap = await getDocs(query(collection(window.db, 'communications'), where('leadId', '==', leadId), where('userId', '==', uid)));
    const COMM_LABELS = { call: 'Called', email: 'Emailed', sms: 'Texted' };
    snap.docs.forEach(d => {
      const c = d.data();
      const t = c.type || 'call';
      const when = c.createdAt?.toDate ? c.createdAt.toDate() : (c.createdAt ? new Date(c.createdAt) : new Date());
      timeline.push({
        time:  when,
        title: `${COMM_LABELS[t] || 'Contacted'} ${c.direction === 'inbound' ? 'from' : ''} customer`,
        desc:  c.content || c.note || '',
        type:  'communication'
      });
    });
  } catch (_) { /* ignore */ }

  try {
    // Read by leadId only (no author filter) so the timeline shows EVERY note on
    // this lead — including a manager's stage-change note on a rep's lead. The
    // /notes rule authorizes this by parent-lead ownership / same-company, so a
    // leadId-scoped query is rule-valid for the owner and same-company members.
    const snap = await getDocs(query(collection(window.db, 'notes'), where('leadId', '==', leadId)));
    snap.docs.forEach(d => {
      const n = d.data();
      const when = n.createdAt?.toDate ? n.createdAt.toDate() : (n.createdAt ? new Date(n.createdAt) : new Date());
      timeline.push({
        time:  when,
        title: 'Note added',
        desc:  (n.text || '').substring(0, 200),
        type:  'note'
      });
    });
  } catch (_) { /* ignore */ }

  return timeline.sort((a, b) => b.time - a.time);
}

async function _gatherNotesForReport(leadId) {
  if (!window.db) return [];
  const uid = window.auth?.currentUser?.uid || null;
  if (!uid) return [];
  const getDocs    = window.getDocs;
  const query      = window.query;
  const collection = window.collection;
  const where      = window.where;
  if ([getDocs, query, collection, where].some(fn => typeof fn !== 'function')) return [];
  try {
    // leadId-only (no author filter) so a report includes the whole lead's
    // notes; the /notes rule authorizes by parent lead. Sort createdAt desc in
    // JS instead of orderBy so no [leadId, createdAt] composite index is needed.
    const snap = await getDocs(
      query(collection(window.db, 'notes'), where('leadId', '==', leadId))
    );
    const ms = (v) => (v && v.toDate ? v.toDate().getTime() : (v ? new Date(v).getTime() : 0)) || 0;
    return snap.docs
      .map(d => {
        const n = d.data();
        const when = n.createdAt?.toDate ? n.createdAt.toDate() : (n.createdAt ? new Date(n.createdAt) : null);
        return { text: n.text || '', createdBy: n.createdBy || '', createdAt: when };
      })
      .sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
  } catch (_) {
    return [];
  }
}



// ============================================
// PHOTO REPORT GENERATOR
// ============================================


// ============================================
// DOCUMENT UPLOAD SYSTEM
// ============================================

window._docUploadQueue = [];

window.openDocUploadModal = function() {
  window._docUploadQueue = [];
  updateDocUploadPreview();
  // nbdModal owns visibility + Esc/backdrop close; onClose resets the queue
  // so every dismiss path (button, Esc, backdrop) clears in-progress picks.
  window.nbdModal.open('docUploadModal', { onClose: function() {
    window._docUploadQueue = [];
    updateDocUploadPreview();
  } });
};

window.closeDocUploadModal = function() {
  window.nbdModal.close('docUploadModal');
};

// Document drop zone
document.addEventListener('DOMContentLoaded', () => {
  const dropZone = document.getElementById('docDropZone');
  const fileInput = document.getElementById('docFileInput');
  
  if (dropZone && fileInput) {
    dropZone.addEventListener('click', () => fileInput.click());
    
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-over');
    });
    
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer.files);
      addDocumentsToQueue(files);
    });
    
    fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      addDocumentsToQueue(files);
    });
  }
});



// NOTE: Duplicate NOTES / ESTIMATE definitions were removed here (audit C1 fix).
// Canonical definitions live earlier in this file:
//   - openNotesModal/closeNotesModal/saveNote: lines ~1748-1793
//   - openEstimateModal (creation form): line ~1855
//   - viewEstimate(estimateId) (detail viewer): line ~2971
//   - getTimeAgo: line ~1840

// Expose module-scope functions to window for cross-script access
window.loadTimeline = loadTimeline;
window.loadEstimates = loadEstimates;

// ── TIMELINE FILTER & COLLAPSE ──
window._tlCollapsed = true;
window._tlActiveFilter = 'all';

window.filterTimeline = function(filter, pill) {
  window._tlActiveFilter = filter;
  document.querySelectorAll('#tlFilters .tl-pill').forEach(function(p) { p.classList.remove('active'); });
  if (pill) pill.classList.add('active');

  var items = document.querySelectorAll('#timelineList .timeline-item');
  items.forEach(function(el) {
    if (filter === 'all' || el.getAttribute('data-type') === filter) {
      el.classList.remove('tl-hidden');
    } else {
      el.classList.add('tl-hidden');
    }
  });

  // Re-apply collapse after filtering
  applyTimelineCollapse();
};

window.toggleTimelineCollapse = function() {
  window._tlCollapsed = !window._tlCollapsed;
  applyTimelineCollapse();
};

window.applyTimelineCollapse = function() {
  var items = document.querySelectorAll('#timelineList .timeline-item:not(.tl-hidden)');
  var showAllBtn = document.getElementById('tlShowAll');
  var totalVisible = items.length;

  if (window._tlCollapsed && totalVisible > 5) {
    items.forEach(function(el, i) {
      el.style.display = i < 5 ? '' : 'none';
    });
    showAllBtn.style.display = 'block';
    showAllBtn.querySelector('button').textContent = 'Show all ' + totalVisible + ' items';
  } else {
    items.forEach(function(el) {
      el.style.display = '';
    });
    if (totalVisible > 5) {
      showAllBtn.style.display = 'block';
      showAllBtn.querySelector('button').textContent = 'Collapse timeline';
    } else {
      showAllBtn.style.display = 'none';
    }
  }
};
