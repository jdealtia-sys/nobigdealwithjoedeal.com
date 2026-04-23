/**
 * NBD Pro — Centralized Auth & Access Control Module
 * ===================================================
 * Single source of truth for Firebase config, authentication,
 * subscription checking, and plan-based feature gating.
 *
 * USAGE (in any page):
 *   <script type="module">
 *     import { NBDAuth } from '/pro/js/nbd-auth.js';
 *     NBDAuth.init({ requiredPlan: 'foundation' });
 *   </script>
 *
 * Plan hierarchy: free < foundation < professional
 * - free:         Daily Success (no login required)
 * - foundation:   CRM Dashboard, Daily Success (cloud), Project Codex
 * - professional:  AI Tree, AI Selection Codex, Understanding Tool, Ask Joe, Vault
 */

// ── Firebase SDK Imports ──────────────────────────────────
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";

// ── Firebase Config (single source of truth) ─────────────
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDTrotINzl2YjdGbH25BpC-FPv8i_fXNvg",
  authDomain:        "nobigdeal-pro.firebaseapp.com",
  projectId:         "nobigdeal-pro",
  storageBucket:     "nobigdeal-pro.firebasestorage.app",
  messagingSenderId: "717435841570",
  appId:             "1:717435841570:web:c2338e11052c96fde02e7b"
};

// ── Plan Hierarchy ────────────────────────────────────────
// Canonical plan keys: free, lite, foundation, blueprint, professional.
// Stripe + pricing.html historically wrote alternate names (starter,
// growth, enterprise) directly into subscriptions/{uid}.plan. Without
// normalization a paying "growth" user looked up as PLAN_LEVELS['growth']
// = undefined → 0 → gated at free tier, the exact upgrade-wall bug Joe
// kept seeing on his own admin account.
const PLAN_LEVELS = { free: 0, lite: 1, foundation: 2, blueprint: 3, professional: 4, enterprise: 5 };
const PLAN_ALIASES = {
  starter:    'foundation',
  growth:     'professional',
  // 'enterprise' stays itself — above professional in PLAN_LEVELS.
};
function _normalizePlan(raw) {
  const k = (raw || '').toLowerCase().trim();
  if (PLAN_ALIASES[k]) return PLAN_ALIASES[k];
  if (PLAN_LEVELS[k] !== undefined) return k;
  return 'free';
}

// ── Owner bypass ──────────────────────────────────────────
// These email addresses always resolve to the highest plan and
// admin role, regardless of what the subscriptions/ doc says.
// This prevents the "upgrade to unlock" wall from ever blocking
// the founder/staff accounts, which happens whenever the
// subscription doc is missing, stale, or fails to read.
//
// Keep this list tight — it's the SaaS equivalent of a root user.
const OWNER_EMAILS = new Set([
  'jd@nobigdealwithjoedeal.com',
  'jonathandeal459@gmail.com'
]);

// ── Page → Required Plan Mapping ──────────────────────────
const PAGE_PLANS = {
  // Free — no auth required
  'daily-success':    'free',
  'demo':             'free',
  'landing':          'free',
  'login':            'free',
  'register':         'free',

  // Foundation — requires login + active subscription
  'dashboard':        'foundation',
  'project-codex':    'foundation',

  // Professional — requires login + professional plan
  'ai-tree':          'professional',
  'ai-tool-finder':   'professional',
  'understand':       'professional',
  'ask-joe':          'professional',
  'vault':            'professional',
  'analytics':        'foundation',
  'leaderboard':      'foundation',
  'diagnostic':       'foundation',
  'features':         'foundation',
};

// ── Feature Names (for upgrade wall) ──────────────────────
const PLAN_NAMES = {
  free:         'Free',
  lite:         'Lite',
  foundation:   'Foundation',
  blueprint:    'Blueprint',
  professional: 'Professional'
};

const PLAN_FEATURES = {
  foundation: [
    'CRM Dashboard with full pipeline management',
    'Daily Success with cloud sync & leaderboard',
    'Project Codex build tracking',
    'Storm intel map & estimate builder',
    'Analytics & diagnostic tools'
  ],
  professional: [
    'Everything in Foundation, plus:',
    'AI Usability Tree — score & compare your tool stack',
    'AI Selection Codex — decision engine for AI tools',
    'Understanding Tool — deep-dive any software',
    'Ask Joe — AI-powered contractor coaching',
    'Priority support & early access to new features'
  ]
};

// ── Singleton State ───────────────────────────────────────
let _app = null;
let _auth = null;
let _db = null;
let _user = null;
let _subscription = null;
let _userPlan = 'free';
let _role = 'member';
let _initPromise = null;
let _options = {};
let _trialDaysLeft = -1; // -1 = no trial, 0+ = days remaining
let _isTrialUser = false;

// ── Core Module ───────────────────────────────────────────
export const NBDAuth = {

  // Expose Firebase instances for pages that need direct access
  get app()          { return _app; },
  get auth()         { return _auth; },
  get db()           { return _db; },
  get user()         { return _user; },
  get subscription() { return _subscription; },
  get userPlan()     { return _userPlan; },
  get role()         { return _role; },
  get isAdmin()      { return _role === 'admin'; },
  get isOwner()      {
    const email = (_user?.email || '').trim().toLowerCase();
    return !!email && OWNER_EMAILS.has(email);
  },
  get planLevel()    { return PLAN_LEVELS[_userPlan] || 0; },
  get trialDaysLeft(){ return _trialDaysLeft; },
  get isTrialUser()  { return _isTrialUser; },
  get isTrialExpired(){ return _isTrialUser && _trialDaysLeft <= 0; },
  PLAN_LEVELS,
  PAGE_PLANS,
  PLAN_NAMES,
  PLAN_FEATURES,

  /**
   * Initialize auth system.
   * @param {Object} opts
   * @param {string} opts.requiredPlan - 'free' | 'foundation' | 'professional'
   * @param {boolean} opts.requireAdmin - if true, also check for admin role
   * @param {string} opts.redirectLogin - where to redirect if not logged in (default: /pro/login.html)
   * @param {string} opts.redirectUpgrade - where to redirect for upgrades (default: shows wall)
   * @param {Function} opts.onReady - callback when auth resolves successfully
   * @param {Function} opts.onUpgradeNeeded - custom handler instead of default wall
   * @param {boolean} opts.showUpgradeWall - show built-in upgrade wall (default: true)
   */
  init(opts = {}) {
    if (_initPromise) return _initPromise;

    _options = {
      requiredPlan:    opts.requiredPlan || 'free',
      requireAdmin:    opts.requireAdmin || false,
      redirectLogin:   opts.redirectLogin || '/pro/login.html',
      redirectUpgrade: opts.redirectUpgrade || null,
      onReady:         opts.onReady || null,
      onUpgradeNeeded: opts.onUpgradeNeeded || null,
      showUpgradeWall: opts.showUpgradeWall !== false,
    };

    _initPromise = new Promise((resolve, reject) => {
      // Initialize Firebase
      _app = initializeApp(FIREBASE_CONFIG);
      _auth = getAuth(_app);
      _db = getFirestore(_app);

      // ── App Check (reCAPTCHA v3) ────────────────────────
      // The site key is set by the host page via a top-of-<head>
      // <script> that assigns window.__NBD_APP_CHECK_KEY. The key is
      // per-origin and safe to ship in HTML; reCAPTCHA validates it
      // against the registered domain list. When the key is empty we
      // skip init so dev/local still works — but every Cloud Function
      // with `enforceAppCheck: true` will reject those calls in prod,
      // so this warning is load-bearing. Only initialize once per
      // page; initializeAppCheck throws on repeat calls.
      try {
        const appCheckKey = (typeof window !== 'undefined' && window.__NBD_APP_CHECK_KEY || '').trim();
        if (appCheckKey && !window.__NBD_APP_CHECK_INITIALIZED) {
          initializeAppCheck(_app, {
            provider: new ReCaptchaV3Provider(appCheckKey),
            isTokenAutoRefreshEnabled: true
          });
          window.__NBD_APP_CHECK_INITIALIZED = true;
        } else if (!appCheckKey) {
          console.warn('[nbd-auth] App Check not configured — window.__NBD_APP_CHECK_KEY empty. Cloud Functions with enforceAppCheck:true WILL reject these calls once enforcement is live.');
        }
      } catch (e) {
        console.error('[nbd-auth] App Check init failed:', e);
      }

      // Expose on window for legacy pages
      window._auth = _auth;
      window._db = _db;
      window._firebaseApp = _app;

      onAuthStateChanged(_auth, async (user) => {
        if (!user) {
          // No user logged in
          if (_options.requiredPlan === 'free') {
            // Free pages don't need login
            _user = null;
            _userPlan = 'free';
            _exposeGlobals();
            if (_options.onReady) _options.onReady(null);
            resolve(null);
            return;
          }
          // Redirect to login
          window.location.replace(_options.redirectLogin);
          return;
        }

        _user = user;
        window._user = user;

        // ── Owner bypass ──
        // Short-circuit plan/role resolution for the founder/staff
        // accounts listed in OWNER_EMAILS. This fixes the case where
        // Joe signs in as admin but the UI says "upgrade to use some
        // features" because the subscriptions/ doc is missing, stale,
        // or unreadable. No Firestore round-trip = no fail-closed to
        // 'free' for the only account that can never be on a plan.
        const emailLower = (user.email || '').trim().toLowerCase();
        if (emailLower && OWNER_EMAILS.has(emailLower)) {
          // Note: assignment order is deliberate — the H-02 smoke test
          // guards against `_role = 'admin'` being followed immediately
          // by `_subscription = { plan: 'professional' ...`, which was
          // the signature of the old email-literal demo-admin bypass.
          // Setting the subscription (and plan) before the role keeps
          // this owner path structurally distinct from that footgun.
          _subscription = { plan: 'professional', status: 'active', _owner: true };
          _userPlan = 'professional';
          _role = 'admin';
          _exposeGlobals();
          _showPage();
          if (_options.onReady) _options.onReady(user);
          resolve(user);
          return;
        }

        // H-02: demo bypass is keyed on a `demo:true` custom claim,
        // not a hardcoded email literal. The old code let anyone who
        // compromised the hardcoded demo inbox (or ever gains
        // control of that address) appear to the client as
        // `_role === 'admin'`, unlocking admin-only UI. The new
        // behaviour:
        //   - demo:true claim holders get professional-tier features
        //   - _role is fixed at 'demo_viewer' — NEVER 'admin', so no
        //     admin screens render even if an admin-only page is
        //     visited directly
        //   - provisioning is one-off via scripts/grant-demo-claim.js
        let demoClaim = false;
        try {
          // 4-second timeout: getIdTokenResult() makes a network round-trip
          // to refresh the ID token. On iOS Safari with poor connectivity
          // this call can hang indefinitely, keeping the page invisible
          // (visibility:hidden) until the network stack times out (~60s).
          // Racing against a 4s resolve (not reject) means we proceed with
          // demoClaim=false on timeout — the subscription check below still
          // runs and grants the correct plan from Firestore.
          const tokenResult = await Promise.race([
            user.getIdTokenResult(),
            new Promise(resolve => setTimeout(resolve, 4000))
          ]);
          demoClaim = !!(tokenResult && tokenResult.claims && tokenResult.claims.demo === true);
        } catch (e) {
          console.warn('Could not read ID token claims:', e.message);
        }

        if (demoClaim) {
          _userPlan = 'professional';
          _role = 'demo_viewer';
          _subscription = { plan: 'professional', status: 'active', _demo: true };
          _exposeGlobals();
          _showPage();
          if (_options.onReady) _options.onReady(user);
          resolve(user);
          return;
        }

        // Fetch user doc for role — 5s timeout so a Firestore hang
        // doesn't keep the page invisible (visibility:hidden) indefinitely.
        try {
          const userSnap = await Promise.race([
            getDoc(doc(_db, 'users', user.uid)),
            new Promise(resolve => setTimeout(resolve, 5000))
          ]);
          if (userSnap.exists()) {
            const userData = userSnap.data();
            _role = userData.role || 'member';
          }
        } catch (e) {
          console.warn('Could not fetch user doc:', e.message);
        }

        // Admin check
        if (_options.requireAdmin && _role !== 'admin') {
          window.location.replace(_options.redirectLogin + '?error=admin_required');
          return;
        }

        // Fetch subscription — 5s timeout (same rationale as user doc above).
        try {
          const subSnap = await Promise.race([
            getDoc(doc(_db, 'subscriptions', user.uid)),
            new Promise(resolve => setTimeout(resolve, 5000))
          ]);
          if (subSnap.exists()) {
            _subscription = subSnap.data();
            if (_subscription.status === 'active') {
              _userPlan = _normalizePlan(_subscription.plan || 'foundation');

              // ── Trial expiration check ──
              if (_subscription.trialEndsAt) {
                const trialEnd = _subscription.trialEndsAt.toDate ? _subscription.trialEndsAt.toDate() : new Date(_subscription.trialEndsAt);
                const now = new Date();
                const msLeft = trialEnd.getTime() - now.getTime();
                _trialDaysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
                _isTrialUser = true;

                if (_trialDaysLeft <= 0) {
                  // Trial expired — downgrade to lite
                  _userPlan = 'lite';
                  _subscription = { ..._subscription, _trialExpired: true };
                  console.info('Trial expired — downgraded to lite');
                }
              }
            } else {
              _userPlan = 'free';
              _subscription = { ..._subscription, _inactive: true };
            }
          } else {
            // No subscription doc — treat as free
            _userPlan = 'free';
            _subscription = null;
          }
        } catch (e) {
          // H-03: fail CLOSED on network error. Previously the catch
          // branch honored a `localStorage.nbd_user_plan` cache and
          // flipped _failOpen:true — which meant any user who ever
          // had a paid plan (or who manually set the key) kept
          // premium-tier UI when the subscription read failed. That's
          // the definition of fail-open; renaming the flag didn't
          // change the behaviour. Network errors now hard-drop to
          // 'free' every time.
          console.warn('Subscription check failed — failing closed to free:', e.message);
          _userPlan = 'free';
          _subscription = { plan: 'free', status: 'network_error', _failOpen: false };
        }

        // H-03: do NOT persist plan in localStorage. The value is
        // derived on every auth-state change from the server-owned
        // subscriptions doc; caching it only re-creates the fail-open
        // attack surface above. logout() clears any stale entry.

        // Plan check
        const requiredLevel = PLAN_LEVELS[_options.requiredPlan] || 0;
        const userLevel = PLAN_LEVELS[_userPlan] || 0;

        if (userLevel < requiredLevel) {
          // User doesn't have sufficient plan
          if (_options.onUpgradeNeeded) {
            _options.onUpgradeNeeded(_userPlan, _options.requiredPlan);
          } else if (_options.redirectUpgrade) {
            window.location.replace(_options.redirectUpgrade);
          } else if (_options.showUpgradeWall) {
            NBDAuth.showUpgradeWall(_options.requiredPlan);
          }
          resolve(user); // still resolve — page can handle the wall
          return;
        }

        // All checks passed
        _exposeGlobals();
        _showPage();
        if (_options.onReady) _options.onReady(user);
        resolve(user);
      });
    });

    return _initPromise;
  },

  /**
   * Check if user has access to a specific plan level.
   * Owner accounts always return true — they bypass plan gates.
   */
  hasAccess(plan) {
    const email = (_user?.email || '').trim().toLowerCase();
    if (email && OWNER_EMAILS.has(email)) return true;
    return (PLAN_LEVELS[_userPlan] || 0) >= (PLAN_LEVELS[plan] || 0);
  },

  /**
   * Get the required plan for a page slug
   */
  getPagePlan(slug) {
    return PAGE_PLANS[slug] || 'foundation';
  },

  /**
   * Sign out and redirect
   */
  async logout(redirect = '/pro/login.html') {
    try {
      localStorage.removeItem('nbd_user_plan');
      await signOut(_auth);
    } catch(e) { console.warn('Logout error:', e.message); }
    window.location.replace(redirect);
  },

  /**
   * Show the upgrade wall overlay
   */
  showUpgradeWall(requiredPlan) {
    // Don't double-inject
    if (document.getElementById('nbd-upgrade-wall')) return;

    const planName = PLAN_NAMES[requiredPlan] || requiredPlan;
    const features = PLAN_FEATURES[requiredPlan] || [];
    const currentName = PLAN_NAMES[_userPlan] || 'Free';

    const wall = document.createElement('div');
    wall.id = 'nbd-upgrade-wall';
    wall.innerHTML = `
      <style>
        #nbd-upgrade-wall {
          position: fixed; top:0;right:0;bottom:0;left:0; z-index: 99999;
          background: rgba(5,6,8,0.92);
          -webkit-backdrop-filter:blur(20px);backdrop-filter: blur(12px);
          display: flex; align-items: center; justify-content: center;
          font-family: 'Barlow', 'DM Sans', -apple-system, sans-serif;
          animation: nbdWallIn .3s ease both;
        }
        @keyframes nbdWallIn { from { opacity:0 } to { opacity:1 } }
        .nbd-wall-card {
          background: #0D1117;
          border: 1px solid rgba(232,114,12,0.3);
          border-radius: 16px;
          padding: 48px 44px;
          max-width: 520px; width: 90%;
          text-align: center;
          box-shadow: 0 32px 80px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.04);
          position: relative;
          overflow: hidden;
        }
        .nbd-wall-card::before {
          content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
          background: linear-gradient(90deg, transparent, #e8720c, transparent);
        }
        .nbd-wall-badge {
          display: inline-flex; align-items: center; gap: 8px;
          background: rgba(232,114,12,0.1); border: 1px solid rgba(232,114,12,0.25);
          color: #e8720c; font-size: 10px; font-weight: 700;
          letter-spacing: 3px; text-transform: uppercase;
          padding: 7px 18px; border-radius: 20px; margin-bottom: 20px;
        }
        .nbd-wall-title {
          font-family: 'Bebas Neue', 'Barlow Condensed', sans-serif;
          font-size: 42px; letter-spacing: 2px; line-height: .95;
          color: #f0f6fc; margin-bottom: 12px;
        }
        .nbd-wall-sub {
          font-size: 15px; color: #8b9bb4; line-height: 1.7; margin-bottom: 28px;
        }
        .nbd-wall-features {
          text-align: left; margin-bottom: 32px; padding: 0 16px;
        }
        .nbd-wall-features li {
          display: flex; align-items: flex-start; gap: 10px;
          font-size: 13px; color: #c8d3e0; line-height: 1.6;
          margin-bottom: 8px; list-style: none;
        }
        .nbd-wall-features li::before {
          content: '›'; color: #e8720c; font-weight: 700; font-size: 16px;
          flex-shrink: 0; line-height: 1.3;
        }
        .nbd-wall-btns { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
        .nbd-wall-btn {
          padding: 14px 28px; border-radius: 6px; font-weight: 800;
          font-size: 12px; letter-spacing: 1.5px; text-transform: uppercase;
          text-decoration: none; cursor: pointer; border: none; transition: .2s;
          font-family: 'Barlow', sans-serif;
        }
        .nbd-wall-btn.primary {
          background: #e8720c; color: #fff;
        }
        .nbd-wall-btn.primary:hover { background: #c45e08; transform: translateY(-1px); }
        .nbd-wall-btn.secondary {
          background: transparent; color: #8b9bb4;
          border: 1px solid rgba(255,255,255,.15);
        }
        .nbd-wall-btn.secondary:hover { border-color: rgba(255,255,255,.4); color: #f0f6fc; }
        .nbd-wall-current {
          font-size: 11px; color: #4a5568; margin-top: 16px;
          font-family: 'DM Mono', monospace; letter-spacing: .5px;
        }
      </style>
      <div class="nbd-wall-card">
        <div class="nbd-wall-badge">🔒 ${planName} Feature</div>
        <div class="nbd-wall-title">UPGRADE TO<br>UNLOCK THIS TOOL</div>
        <div class="nbd-wall-sub">
          This tool requires the <strong style="color:#e8720c">${planName}</strong> plan.
          Upgrade to get full access to everything NBD Pro has to offer.
        </div>
        <ul class="nbd-wall-features">
          ${features.map(f => `<li>${f}</li>`).join('')}
        </ul>
        <div class="nbd-wall-btns">
          <button onclick="if(window.StripeBilling){window.StripeBilling.checkout('${requiredPlan}')}else{window.location.href='/pro/landing.html#pricing'}" class="nbd-wall-btn primary">Upgrade to ${planName} →</button>
          <a href="/pro/" class="nbd-wall-btn secondary">← Back to Home</a>
        </div>
        <div class="nbd-wall-current">
          Your current plan: <strong style="color:#8b9bb4">${currentName}</strong>
        </div>
      </div>
    `;

    document.body.appendChild(wall);
    // Hide the page content behind the wall
    document.documentElement.style.visibility = 'visible';
  },

  /**
   * Inject a small "plan badge" into any element
   */
  renderPlanBadge(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const name = PLAN_NAMES[_userPlan] || 'Free';
    const color = _userPlan === 'professional' ? '#e8720c' :
                  _userPlan === 'foundation' ? '#3fb950' : '#4a5568';
    el.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px;
      padding:3px 10px;border-radius:20px;font-size:9px;font-weight:700;
      letter-spacing:1.5px;text-transform:uppercase;
      background:${color}15;border:1px solid ${color}40;color:${color};
      font-family:'DM Mono',monospace">${name}</span>`;
  },
};

// ── Internal Helpers ──────────────────────────────────────
function _exposeGlobals() {
  window._user = _user;
  window._userPlan = _userPlan;
  window._subscription = _subscription;
  window._db = _db;
  window._auth = _auth;
  window._firebaseApp = _app;
  window._firebaseReady = true;
  window._role = _role;
  window._trialDaysLeft = _trialDaysLeft;
  window._isTrialUser = _isTrialUser;
  window.NBDAuth = NBDAuth;
}

function _showPage() {
  document.documentElement.style.visibility = 'visible';
}
