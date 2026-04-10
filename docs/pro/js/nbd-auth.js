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
const PLAN_LEVELS = { free: 0, lite: 1, foundation: 2, blueprint: 3, professional: 4 };

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

        // Demo account bypass
        const isDemoAccount = user.email === 'demo@nobigdeal.pro';

        if (isDemoAccount) {
          _userPlan = 'professional';
          _role = 'admin';
          _subscription = { plan: 'professional', status: 'active' };
          _exposeGlobals();
          _showPage();
          if (_options.onReady) _options.onReady(user);
          resolve(user);
          return;
        }

        // Fetch user doc for role
        try {
          const userSnap = await getDoc(doc(_db, 'users', user.uid));
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

        // Fetch subscription
        try {
          const subSnap = await getDoc(doc(_db, 'subscriptions', user.uid));
          if (subSnap.exists()) {
            _subscription = subSnap.data();
            if (_subscription.status === 'active') {
              _userPlan = _subscription.plan || 'foundation';

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
          // Fail closed on network error — default to free tier for security
          console.warn('Subscription check failed — defaulting to free:', e.message);
          const cached = localStorage.getItem('nbd_user_plan');
          _userPlan = (cached === 'professional' || cached === 'foundation') ? cached : 'free';
          _subscription = { plan: _userPlan, status: 'network_error', _failOpen: true };
        }

        // Cache plan in localStorage
        try { localStorage.setItem('nbd_user_plan', _userPlan); } catch(e) {}

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
   * Check if user has access to a specific plan level
   */
  hasAccess(plan) {
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
