// ═══════════════════════════════════════════════════════════════
// NBD Pro — Billing Gate Module
//
// Client-side plan checking, usage tracking, and soft feature
// gates. Reads the user's plan from Firestore (subscriptions/{uid})
// and enforces limits with warnings (not hard locks).
//
// Tier limits:
//   free:       10 leads/mo,  0 reports,  0 AI calls, solo
//   starter:    50 leads/mo,  2 reports, 20 AI calls, solo
//   growth:    500 leads/mo,  ∞ reports,  ∞ AI calls, 5 reps
//   enterprise:  ∞ everything
//
// Soft gating: warns at 80%, modal at 100%, no lockout mid-cycle.
//
// Usage is tracked per billing cycle in Firestore and reset
// by the webhook when a new invoice is paid.
//
// Exposes: window.NBDBilling
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';
  if (window.NBDBilling) return;

  // ── Plan definitions ──
  // Canonical keys match the Stripe price tiers (functions/stripe.js
  // VALID_PLANS / functions/billing.js PLAN_LIMITS). Legacy doc values
  // (foundation/blueprint/professional — written forever by old
  // access-code grants and Stripe metadata) are resolved to canonical
  // ONCE, in loadSubscription() via PLAN_ALIASES, so `_plan` (and
  // getPlan().plan) is always a canonical key. The foundation/
  // professional alias rows below are belt-and-braces for any code
  // that indexes PLANS with a raw doc value directly.
  const PLANS = {
    free:         { label: 'Free',         leads: 10,  reports: 0,        aiCalls: 0,        reps: 1,        price: 0 },
    starter:      { label: 'Starter',      leads: 50,  reports: 2,        aiCalls: 20,       reps: 1,        price: 99 },
    foundation:   { label: 'Starter',      leads: 50,  reports: 2,        aiCalls: 20,       reps: 1,        price: 99 },
    growth:       { label: 'Growth',       leads: 500, reports: Infinity, aiCalls: Infinity, reps: 5,        price: 299 },
    professional: { label: 'Growth',       leads: 500, reports: Infinity, aiCalls: Infinity, reps: 5,        price: 299 },
    enterprise:   { label: 'Enterprise',   leads: Infinity, reports: Infinity, aiCalls: Infinity, reps: Infinity, price: null }
  };

  // Read-boundary alias resolution — mirrors PLAN_ALIASES in
  // nbd-auth.js. Production subscription docs carry legacy values
  // FOREVER; this map can never be removed.
  const PLAN_ALIASES = { foundation: 'starter', blueprint: 'starter', professional: 'growth' };
  function _normalizePlan(raw) {
    const k = (typeof raw === 'string' ? raw : '').toLowerCase().trim();
    return PLAN_ALIASES[k] || k || 'free';
  }

  let _plan = 'free';
  let _status = 'none';  // none | active | trialing | past_due | cancelled
  let _usage = { leads: 0, reports: 0, aiCalls: 0, cycleStart: null };
  let _trialEndsAt = null;
  let _loaded = false;

  // Owner bypass — claims-based: keyed on the { owner: true } custom
  // claim minted server-side by mintOwnerClaims (functions/handlers/
  // auth.js) from the single server-side list in handlers/_shared.js.
  // Claim-only since Phase 2 (2026-07): the transition email fallback
  // was removed after claims were verified minted on both founder
  // accounts — a failed claims read means no owner bypass (fail closed
  // to the normal plan path), never an email match.
  function _isOwner() {
    // window._userClaims is populated by nbd-auth.js /
    // dashboard-bootstrap (and by loadSubscription below).
    try {
      if (window._userClaims && window._userClaims.owner === true) return true;
    } catch (_) { /* no claims → no owner bypass */ }
    return false;
  }

  // Wait up to `ms` for the Firestore window globals to exist. The
  // modular Firebase SDK is imported in an ES module script in the page
  // head; if loadSubscription() races it, the first call would throw and
  // silently fall back to 'free'. Poll briefly so the caller can see the
  // real sub doc on the first successful tick.
  function _waitForFirestore(ms) {
    const deadline = Date.now() + ms;
    return new Promise((resolve) => {
      (function tick() {
        const ready = typeof window.getDoc === 'function'
                   && typeof window.doc === 'function'
                   && window.db;
        if (ready) return resolve(true);
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(tick, 50);
      })();
    });
  }

  // ── Load subscription data from Firestore ──
  async function loadSubscription() {
    try {
      const uid = window._user?.uid;
      if (!uid) return;

      // Resolve token claims once, up front, so the owner short-circuit
      // below can key on claims.owner === true. A failed claims read
      // leaves window._userClaims unset → no owner bypass on this load
      // (claim-only, fail closed); the normal plan path still runs.
      try {
        if (!window._userClaims && window._user
            && typeof window._user.getIdTokenResult === 'function') {
          const tr = await window._user.getIdTokenResult();
          if (tr && tr.claims) window._userClaims = tr.claims;
        }
      } catch (_) { /* claims read failed — no owner bypass */ }

      // Owner short-circuit: always enterprise, never gated, never
      // warned about usage. Skip the Firestore read entirely so an
      // auth/permission hiccup can't downgrade the founder.
      if (_isOwner()) {
        _plan = 'enterprise';
        _status = 'active';
        _usage = { leads: 0, reports: 0, aiCalls: 0, cycleStart: null };
        _trialEndsAt = null;
        _loaded = true;
        return;
      }

      const firestoreReady = await _waitForFirestore(3000);
      if (!firestoreReady) {
        // Surface the race explicitly instead of silently becoming 'free'.
        // Leave _loaded=false so softGate()/hardGate() treat the user as
        // "plan unknown — allow the action" rather than falsely free.
        console.error('[Billing] Firestore SDK not ready after 3s — plan unknown, deferring gating.');
        return;
      }

      // Pillar 4: billing is company-level — resolve the subscription from
      // the companyId claim (== owner uid) so team members see the team
      // plan, not a phantom 'free' under their own uid. Solo owners:
      // companyId == uid, byte-identical behavior.
      let billingKey = uid;
      try {
        if (window._userClaims && window._userClaims.companyId) {
          billingKey = window._userClaims.companyId;
        } else if (window._user && typeof window._user.getIdTokenResult === 'function') {
          const tr = await window._user.getIdTokenResult();
          billingKey = (tr && tr.claims && tr.claims.companyId) || uid;
        }
      } catch (_) { /* fall back to uid */ }
      const snap = await window.getDoc(window.doc(window.db, 'subscriptions', billingKey));
      if (snap.exists()) {
        const data = snap.data();
        _plan = _normalizePlan(data.plan || 'free');
        _status = data.status || 'none';
        _usage = data.usage || { leads: 0, reports: 0, aiCalls: 0 };
        _trialEndsAt = data.trialEndsAt || null;
        // Access-code trial expiry — mirror of the read-time check in
        // functions/billing.js trackUsage (the server meter is the real
        // gate; this keeps the UI honest). A code-granted subscription
        // past its trialEndsAt gates as the free plan. Stripe subs and
        // untimed code comps are untouched.
        if (
          data.source === 'access_code'
          && _trialEndsAt
          && typeof _trialEndsAt.toMillis === 'function'
          && _trialEndsAt.toMillis() < Date.now()
        ) {
          _plan = 'free';
          _status = 'trial_expired';
        }
      } else {
        _plan = 'free';
        _status = 'none';
      }
      _loaded = true;
    } catch (e) {
      console.warn('[Billing] loadSubscription failed:', e.message);
      _plan = 'free';
      _loaded = true;
    }
  }

  // ── Check if a feature is available on the current plan ──
  function canUse(feature) {
    if (_isOwner()) return true; // owner accounts are never limit-gated
    const limits = PLANS[_plan] || PLANS.free;
    switch (feature) {
      case 'leads':   return _usage.leads < limits.leads;
      case 'reports': return limits.reports === Infinity || _usage.reports < limits.reports;
      case 'aiCalls': return limits.aiCalls === Infinity || _usage.aiCalls < limits.aiCalls;
      case 'team':    return limits.reps > 1;
      default:        return true;
    }
  }

  // ── Get usage percentage for a feature (0-1) ──
  function usagePct(feature) {
    const limits = PLANS[_plan] || PLANS.free;
    switch (feature) {
      case 'leads':   return limits.leads === Infinity ? 0 : (_usage.leads / limits.leads);
      case 'reports': return limits.reports === Infinity ? 0 : (_usage.reports / limits.reports);
      case 'aiCalls': return limits.aiCalls === Infinity ? 0 : (_usage.aiCalls / limits.aiCalls);
      default:        return 0;
    }
  }

  // ── Increment usage counter ──
  // Called by the app when a gated action happens (lead created, report
  // generated, AI call made).
  //
  // Audit batch 3 (2026-05-13): closes the Audit A KNOWN GAP. Routes
  // through the trackUsage Cloud Function (admin SDK) which atomically
  // increments subscriptions/{uid}.usage[feature] in a transaction.
  // Firestore rules still block direct client writes — only the callable
  // touches the doc. The server returns the post-increment usage + plan
  // limit + overage flag so we can sync local state to the server truth.
  //
  // Local counter is patched optimistically so the gate-check renders
  // instantly; the server call is fire-and-forget for the increment but
  // we reconcile if the server reports a different number (e.g. counter
  // drift from another device).
  let _httpsCallableTrackUsage = null;
  async function _getCallable() {
    if (_httpsCallableTrackUsage) return _httpsCallableTrackUsage;
    if (window._functions && window._httpsCallable) {
      _httpsCallableTrackUsage = window._httpsCallable(window._functions, 'trackUsage');
      return _httpsCallableTrackUsage;
    }
    try {
      const mod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
      window._functions    = window._functions    || mod.getFunctions();
      window._httpsCallable = window._httpsCallable || mod.httpsCallable;
      _httpsCallableTrackUsage = window._httpsCallable(window._functions, 'trackUsage');
      return _httpsCallableTrackUsage;
    } catch (e) {
      console.warn('[Billing] couldn\'t load functions SDK:', e.message);
      return null;
    }
  }
  async function trackUsage(feature) {
    if (!window._user?.uid) return;
    // Optimistic local bump — UI updates immediately.
    _usage[feature] = (_usage[feature] || 0) + 1;
    const call = await _getCallable();
    if (!call) return; // SDK didn't load (offline / blocked); local counter is best-effort
    try {
      const res = await call({ feature });
      const data = res && res.data;
      if (data && typeof data.usage === 'number') {
        // Server authoritative — keep local in sync. If the server
        // reports higher (another device incremented too) we accept it.
        _usage[feature] = data.usage;
      }
    } catch (e) {
      // Soft fail — local counter still tracks within the session, just
      // doesn't survive to other devices on this iteration.
      console.warn('[Billing] trackUsage callable failed:', e.message);
    }
  }

  // ── Soft gate check — warn at 80%, modal at 100% ──
  // Returns true if the action should proceed, false if blocked.
  // Never actually blocks — just shows warnings/modals.
  function softGate(feature, featureLabel) {
    if (!_loaded) return true; // Don't block before plan loads
    if (_isOwner()) return true; // owner accounts bypass warnings + upgrade modal
    const pct = usagePct(feature);
    const limits = PLANS[_plan] || PLANS.free;
    const limit = limits[feature === 'aiCalls' ? 'aiCalls' : feature];

    if (limit === Infinity || limit === 0) return true; // unlimited or not tracked

    if (pct >= 1.0) {
      // At limit — show upgrade modal but allow action
      showUpgradeModal(feature, featureLabel, _usage[feature], limit);
      return true; // soft gate — still allow
    }
    if (pct >= 0.8) {
      // Approaching limit — show warning toast
      const remaining = limit - (_usage[feature] || 0);
      if (typeof showToast === 'function') {
        showToast(remaining + ' ' + featureLabel + ' remaining this month. Upgrade for more.', 'warning');
      }
    }
    return true;
  }

  // ── Upgrade modal ──
  function showUpgradeModal(feature, featureLabel, used, limit) {
    const existing = document.getElementById('nbd-upgrade-modal');
    if (existing) existing.remove();

    const nextPlan = _plan === 'free' ? 'starter' : (_plan === 'starter' ? 'growth' : null);
    if (!nextPlan) return; // enterprise/growth users don't see this

    const nextInfo = PLANS[nextPlan];
    const overlay = document.createElement('div');
    overlay.id = 'nbd-upgrade-modal';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;padding:20px;';

    const card = document.createElement('div');
    card.style.cssText = 'background:var(--s,#1a1d23);border:2px solid #e8720c;border-radius:14px;padding:32px;max-width:440px;width:100%;text-align:center;';
    card.innerHTML = `
      <div style="font-size:36px;margin-bottom:12px;">📈</div>
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:24px;font-weight:800;color:var(--t,#fff);text-transform:uppercase;margin-bottom:8px;">Plan Limit Reached</div>
      <div style="font-size:13px;color:var(--m,#888);margin-bottom:20px;line-height:1.5;">
        You've used <strong style="color:#e8720c;">${used} of ${limit}</strong> ${featureLabel} this month on the <strong>${(PLANS[_plan] || {}).label || 'Free'}</strong> plan.
      </div>
      <div style="font-size:13px;color:var(--t,#fff);margin-bottom:20px;">
        Upgrade to <strong style="color:#e8720c;">${nextInfo.label}</strong> for ${nextInfo[feature === 'aiCalls' ? 'aiCalls' : feature] === Infinity ? 'unlimited' : nextInfo[feature === 'aiCalls' ? 'aiCalls' : feature]} ${featureLabel}/mo — <strong>$${nextInfo.price}/mo</strong>
      </div>
      <div style="display:flex;gap:10px;justify-content:center;">
        <button data-bg-action="closeUpgrade" style="background:var(--s2);border:1px solid var(--br);color:var(--m);padding:10px 20px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px;">Maybe Later</button>
        <button data-bg-action="closeUpgradeAndGoBilling" style="background:#e8720c;border:none;color:#fff;padding:10px 24px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;">View Plans</button>
      </div>
      <div style="font-size:10px;color:var(--m,#888);margin-top:14px;">You can still use this feature — we won't lock you out mid-cycle.</div>
    `;
    overlay.appendChild(card);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  // ── Get current plan info ──
  function getPlan() {
    return {
      plan: _plan,
      label: (PLANS[_plan] || PLANS.free).label,
      status: _status,
      usage: { ..._usage },
      limits: PLANS[_plan] || PLANS.free,
      trialEndsAt: _trialEndsAt,
      isTrialing: _status === 'trialing',
      isPastDue: _status === 'past_due',
      isCancelled: _status === 'cancelled',
      isActive: _status === 'active' || _status === 'trialing'
    };
  }

  // ── Expose ──
  window.NBDBilling = {
    PLANS,
    loadSubscription,
    canUse,
    usagePct,
    trackUsage,
    softGate,
    getPlan,
    showUpgradeModal
  };

  console.log('[NBDBilling] Module ready');
})();


// CSP-safe delegation (replaces 2 inline onclicks).
(function(){if(window._NBD_BG_DELEGATE)return;window._NBD_BG_DELEGATE=true;document.addEventListener('click',function(ev){var t=ev.target.closest&&ev.target.closest('[data-bg-action]');if(!t)return;var a=t.dataset.bgAction;try{var m=document.getElementById('nbd-upgrade-modal');if(m)m.remove();if(a==='closeUpgradeAndGoBilling'&&typeof goTo==='function')goTo('billing');}catch(e){console.error('[billing-gate]',e);}});})();
