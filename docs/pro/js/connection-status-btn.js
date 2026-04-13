// ══════════════════════════════════════════════════════════════
// NBD PRO — CONNECTION STATUS BUTTON
// Subtle status indicator in header icon row
// Green = online + connected, Yellow = loading, Red = offline/error
// Tap to refresh CRM data
// ══════════════════════════════════════════════════════════════

(function() {
'use strict';

// ── CSS ──────────────────────────────────────────────────────
function injectCSS() {
  if (document.getElementById('nbd-conn-btn-css')) return;
  const style = document.createElement('style');
  style.id = 'nbd-conn-btn-css';
  style.textContent = `

#nbd-conn-btn {
  background:transparent;
  border:none;
  cursor:pointer;
  font-size:15px;
  padding:4px 6px;
  transition:color .15s, transform .15s;
  line-height:1;
  position:relative;
  -webkit-tap-highlight-color:transparent;
  display:flex;
  align-items:center;
  justify-content:center;
}
#nbd-conn-btn:active {
  transform:scale(.88);
}

/* The dot indicator */
.conn-dot {
  width:8px;
  height:8px;
  border-radius:50%;
  transition:background .3s, box-shadow .3s;
}

/* States */
.conn-dot.online {
  background:#10b981;
  box-shadow:0 0 6px rgba(16,185,129,.5);
}
.conn-dot.loading {
  background:#fbbf24;
  box-shadow:0 0 6px rgba(251,191,36,.4);
  animation:conn-pulse 1.4s ease-in-out infinite;
}
.conn-dot.offline {
  background:#ef4444;
  box-shadow:0 0 6px rgba(239,68,68,.4);
  animation:conn-pulse 1.4s ease-in-out infinite;
}

@keyframes conn-pulse {
  0%,100% { opacity:1; transform:scale(1); }
  50%     { opacity:.5; transform:scale(.85); }
}

/* Spin animation on refresh tap */
#nbd-conn-btn.refreshing .conn-dot {
  animation:conn-spin .6s ease;
}
@keyframes conn-spin {
  from { transform:rotate(0deg); }
  to   { transform:rotate(360deg); }
}

/* Tooltip on hover (desktop) */
#nbd-conn-btn::after {
  content:attr(data-tooltip);
  position:absolute;
  top:calc(100% + 6px);
  left:50%;
  transform:translateX(-50%);
  background:var(--s, #111318);
  border:1px solid var(--br, #1e2530);
  color:var(--t, #e8eaf0);
  font-family:'Barlow Condensed',sans-serif;
  font-size:10px;
  font-weight:600;
  letter-spacing:.04em;
  white-space:nowrap;
  padding:4px 10px;
  border-radius:6px;
  pointer-events:none;
  opacity:0;
  transition:opacity .15s;
  z-index:9999;
}
#nbd-conn-btn:hover::after {
  opacity:1;
}
@media (max-width:768px) {
  #nbd-conn-btn::after { display:none; }
}

  `;
  document.head.appendChild(style);
}


// ── STATE ────────────────────────────────────────────────────
let _status = 'loading'; // 'online' | 'loading' | 'offline'
let _refreshing = false;


// ── CREATE & INSERT BUTTON ───────────────────────────────────
function createButton() {
  if (document.getElementById('nbd-conn-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'nbd-conn-btn';
  btn.setAttribute('data-tooltip', 'Checking connection…');
  btn.title = 'Tap to refresh / sync data';
  btn.innerHTML = '<span class="conn-dot loading"></span><span style="font-size:11px;margin-left:2px;opacity:.5;transition:opacity .15s;">↻</span>';
  btn.onmouseenter = function() { btn.querySelector('span:last-child').style.opacity = '1'; };
  btn.onmouseleave = function() { btn.querySelector('span:last-child').style.opacity = '.5'; };
  btn.onclick = handleTap;

  // Find the header icon row — it's the div with gap:4px inside .hright
  const iconRow = document.querySelector('.hright > div');
  if (iconRow) {
    // Insert as the first button in the row (before 🕒)
    const firstBtn = iconRow.querySelector('div, button');
    if (firstBtn) {
      iconRow.insertBefore(btn, firstBtn);
    } else {
      iconRow.appendChild(btn);
    }
  }
}


// ── UPDATE STATUS ────────────────────────────────────────────
function updateStatus(newStatus, tooltip) {
  _status = newStatus;
  const btn = document.getElementById('nbd-conn-btn');
  if (!btn) return;

  const dot = btn.querySelector('.conn-dot');
  if (dot) {
    dot.className = 'conn-dot ' + newStatus;
  }
  if (tooltip) {
    btn.setAttribute('data-tooltip', tooltip);
  }
}


// ── DETERMINE STATUS ─────────────────────────────────────────
function checkStatus() {
  // Check browser online status first
  if (!navigator.onLine) {
    updateStatus('offline', 'Offline — tap to retry');
    return;
  }

  // Check CRM health badge if it exists
  const healthBadge = document.getElementById('crmHealthBadge');
  if (healthBadge) {
    if (healthBadge.classList.contains('healthy')) {
      const leadCount = window._leads?.length || 0;
      updateStatus('online', `Connected · ${leadCount} leads`);
    } else if (healthBadge.classList.contains('loading')) {
      updateStatus('loading', 'Syncing data…');
    } else if (healthBadge.classList.contains('error')) {
      updateStatus('offline', 'Connection error — tap to retry');
    } else {
      // Default: check if we have auth
      if (window.auth?.currentUser) {
        updateStatus('online', 'Connected');
      } else {
        updateStatus('loading', 'Authenticating…');
      }
    }
  } else {
    // No health badge — just use navigator.onLine + auth
    if (window.auth?.currentUser) {
      updateStatus('online', 'Connected');
    } else {
      updateStatus('loading', 'Connecting…');
    }
  }
}


// ── TAP TO REFRESH ───────────────────────────────────────────
async function handleTap() {
  if (_refreshing) return;
  _refreshing = true;

  const btn = document.getElementById('nbd-conn-btn');
  if (btn) btn.classList.add('refreshing');

  updateStatus('loading', 'Refreshing…');

  try {
    // Try to call loadLeads if exposed (it's inside the module scope,
    // so we trigger it by re-dispatching the auth state)
    if (window.auth?.currentUser && window.db) {
      // Method 1: Direct reload via exposed functions
      if (typeof window.loadLeads === 'function') {
        await window.loadLeads();
      }
      if (typeof window.loadEstimates === 'function') {
        await window.loadEstimates();
      }

      // Method 2: If functions aren't exposed, do a quick Firestore ping
      // to verify connectivity + update health badge
      if (typeof window.loadLeads !== 'function' && window.getDoc && window.doc) {
        try {
          await window.getDoc(window.doc(window.db, 'users', window.auth.currentUser.uid));
        } catch(e) {}
      }
    }

    // Brief delay then recheck
    await new Promise(r => setTimeout(r, 500));
    checkStatus();

  } catch(e) {
    updateStatus('offline', 'Refresh failed — tap to retry');
  }

  if (btn) btn.classList.remove('refreshing');
  _refreshing = false;
}


// ── OBSERVE HEALTH BADGE CHANGES ─────────────────────────────
function watchHealthBadge() {
  const healthBadge = document.getElementById('crmHealthBadge');
  if (!healthBadge) return;

  const observer = new MutationObserver(() => checkStatus());
  observer.observe(healthBadge, { attributes: true, attributeFilter: ['class'] });
}


// ── INIT ─────────────────────────────────────────────────────
function init() {
  injectCSS();
  createButton();

  // Listen for online/offline events
  window.addEventListener('online', () => {
    checkStatus();
    // Auto-refresh on reconnect
    setTimeout(() => handleTap(), 300);
  });
  window.addEventListener('offline', () => {
    updateStatus('offline', 'Offline — tap to retry');
  });

  // Initial status check
  checkStatus();

  // Watch the CRM health badge for class changes
  watchHealthBadge();

  // Poll periodically in case health badge updates outside MutationObserver
  setInterval(checkStatus, 10000);

  // Also check once auth settles
  if (window.auth && window._onAuthStateChanged) {
    window._onAuthStateChanged(window.auth, user => {
      setTimeout(checkStatus, 1000);
    });
  } else {
    // Fallback poll for auth
    const poll = setInterval(() => {
      if (window.auth?.currentUser) {
        clearInterval(poll);
        checkStatus();
        watchHealthBadge();
      }
    }, 1000);
    setTimeout(() => clearInterval(poll), 15000);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
