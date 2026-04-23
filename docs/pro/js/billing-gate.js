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
  // Canonical keys match the Stripe price tiers. `foundation`/`professional`
  // are alias entries so billing-gate stays in sync with nbd-auth.js when
  // a user doc happens to carry those names (the two modules developed
  // independently and diverged — see _normalizePlan in nbd-auth.js).
  const PLANS = {
    free:         { label: 'Free',         leads: 10,  reports: 0,        aiCalls: 0,        reps: 1,        price: 0 },
    starter:      { label: 'Starter',      leads: 50,  reports: 2,        aiCalls: 20,       reps: 1,        price: 99 },
    foundation:   { label: 'Foundation',   leads: 50,  reports: 2,        aiCalls: 20,       reps: 1,        price: 99 },
    growth:       { label: 'Growth',       leads: 500, reports: Infinity, aiCalls: Infinity, reps: 5,        price: 249 },
    professional: { label: 'Professional', leads: 500, reports: Infinity, aiCalls: Infinity, reps: 5,        price: 249 },
    enterprise:   { label: 'Enterprise',   leads: Infinity, reports: Infinity, aiCalls: Infinity, reps: Infinity, price: null }
  };

  let _plan = 'free';
  let _status = 'none';  // none | active | trialing | past_due | cancelled
  let _usage = { leads: 0, reports: 0, aiCalls: 0, cycleStart: null };
  let _trialEndsAt = null;
  let _loaded = false;

  // Owner bypass — mirrors nbd-auth.js OWNER_EMAILS. The two modules
  // stay independent so a single import change doesn't pull in the
  // firestore SDK at billing-gate.js load time.
  const OWNER_EMAILS = new Set([
    'jd@nobigdealwithjoedeal.com',
    'jonathandeal459@gmail.com'
  ]);

  function _isOwner() {
    const email = (window._user?.email || '').trim().toLowerCase();
    return !!email && OWNER_EMAILS.has(email);
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

      const snap = await window.getDoc(window.doc(window.db, 'subscriptions', uid));
      if (snap.exists()) {
        const data = snap.data();
        _plan = data.plan || 'free';
        _status = data.status || 'none';
        _usage = data.usage || { leads: 0, reports: 0, aiCalls: 0 };
        _trialEndsAt = data.trialEndsAt || null;
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
  // Called by the app when a gated action happens (lead created,
  // report generated, AI call made). Writes to Firestore immediately.
  async function trackUsage(feature) {
    if (!window._user?.uid) return;
    _usage[feature] = (_usage[feature] || 0) + 1;
    try {
      await window.updateDoc(window.doc(window.db, 'subscriptions', window._user.uid), {
        [`usage.${feature}`]: _usage[feature],
        updatedAt: window.serverTimestamp()
      });
    } catch (e) {
      // Firestore write failed — local count is still incremented
      // so the gate catches it even if the write is delayed.
      console.warn('[Billing] trackUsage write failed:', e.message);
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
        <button onclick="document.getElementById('nbd-upgrade-modal').remove()" style="background:var(--s2);border:1px solid var(--br);color:var(--m);padding:10px 20px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px;">Maybe Later</button>
        <button onclick="document.getElementById('nbd-upgrade-modal').remove();if(typeof goTo==='function'){goTo('settings');setTimeout(function(){if(typeof switchSettingsTab==='function')switchSettingsTab('billing')},200)}else{window.location.href='/pro/pricing.html'}" style="background:#e8720c;border:none;color:#fff;padding:10px 24px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;">View Plans</button>
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
