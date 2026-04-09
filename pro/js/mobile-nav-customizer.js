// ══════════════════════════════════════════════════════════════
// NBD PRO — CUSTOMIZABLE MOBILE BOTTOM NAV
// Drop-in: replaces hardcoded #mobile-nav with user-configurable tabs
// localStorage for instant load, Firestore for cross-device sync
// ══════════════════════════════════════════════════════════════

(function() {
'use strict';

// ── MASTER TAB REGISTRY ──────────────────────────────────────
const TAB_REGISTRY = [
  { id: 'dash',       icon: '📊', label: 'Home',        action: 'dash',       category: 'Core' },
  { id: 'home',       icon: '🏠', label: 'Widgets',     action: 'home',       category: 'Core' },
  { id: 'crm',        icon: '👥', label: 'CRM',         action: 'crm',        category: 'Core',  badge: true },
  { id: 'est',        icon: '📋', label: 'Estimates',   action: 'est',        category: 'Core' },
  { id: 'map',        icon: '🗺️', label: 'Map',         action: 'map',        category: 'Tools' },
  { id: 'd2d',        icon: '🚪', label: 'D2D',         action: 'd2d',        category: 'Tools' },
  { id: 'photos',     icon: '📸', label: 'Photos',      action: 'photos',     category: 'Tools' },
  { id: 'docs',       icon: '📁', label: 'Templates',   action: 'docs',       category: 'Tools' },
  { id: 'products',   icon: '📦', label: 'Products',    action: 'products',   category: 'Tools' },
  { id: 'draw',       icon: '✏️', label: 'Draw',         action: 'draw',       category: 'Tools' },
  { id: 'training',   icon: '🎯', label: 'Training',    action: 'training',   category: 'Tools' },
  { id: 'academy',    icon: '🎓', label: 'Academy',     action: 'academy',    category: 'Tools' },
  { id: 'storm',      icon: '⛈️', label: 'Storm',        action: 'storm',      category: 'Insights' },
  { id: 'closeboard', icon: '📋', label: 'Close Board', action: 'closeboard', category: 'Insights' },
  { id: 'repos',      icon: '🧠', label: 'Rep OS',      action: 'repos',      category: 'Insights' },
  { id: 'board',      icon: '🏆', label: 'Leaderboard', action: 'board',      category: 'Insights' },
  { id: 'joe',        icon: '🤖', label: 'Ask Joe',     action: 'joe',        category: 'System' },
  { id: 'settings',   icon: '⚙️', label: 'Settings',    action: 'settings',   category: 'System' },
];

const DEFAULT_TABS = ['dash', 'map', 'crm', 'joe'];
const STORAGE_KEY  = 'nbd_mobile_tabs';
const MAX_TABS     = 4;

// Firestore path: users/{uid}/preferences/mobileNav
// Document shape: { tabs: ['dash','map','crm','joe'], updatedAt: serverTimestamp() }


// ══════════════════════════════════════════════════════════════
//  STORAGE LAYER — localStorage + Firestore
// ══════════════════════════════════════════════════════════════

function loadTabsLocal() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      const valid = parsed.filter(id => TAB_REGISTRY.find(t => t.id === id));
      if (valid.length > 0 && valid.length <= MAX_TABS) return valid;
    }
  } catch(e) {}
  return [...DEFAULT_TABS];
}

function saveTabsLocal(tabIds) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tabIds)); } catch(e) {}
}

function _getUid() {
  try { return window.auth?.currentUser?.uid || null; } catch(e) { return null; }
}

function _firestoreReady() {
  return !!(window.db && window.doc && window.getDoc && window.setDoc && _getUid());
}

async function loadTabsFirestore() {
  if (!_firestoreReady()) return null;
  try {
    const uid = _getUid();
    const snap = await window.getDoc(window.doc(window.db, 'users', uid, 'preferences', 'mobileNav'));
    if (snap.exists()) {
      const data = snap.data();
      if (Array.isArray(data.tabs)) {
        const valid = data.tabs.filter(id => TAB_REGISTRY.find(t => t.id === id));
        if (valid.length > 0 && valid.length <= MAX_TABS) return valid;
      }
    }
  } catch(e) {
    console.warn('[NavCustomizer] Firestore read failed:', e.message);
  }
  return null;
}

async function saveTabsFirestore(tabIds) {
  if (!_firestoreReady()) return false;
  try {
    const uid = _getUid();
    const docRef = window.doc(window.db, 'users', uid, 'preferences', 'mobileNav');
    const payload = { tabs: tabIds, updatedAt: window.serverTimestamp ? window.serverTimestamp() : new Date().toISOString() };
    await window.setDoc(docRef, payload, { merge: true });
    console.log('[NavCustomizer] ✓ Saved to Firestore');
    return true;
  } catch(e) {
    console.warn('[NavCustomizer] Firestore write failed:', e.message);
    return false;
  }
}

function loadTabs() {
  return loadTabsLocal();
}

async function saveTabs(tabIds) {
  saveTabsLocal(tabIds);
  saveTabsFirestore(tabIds);
}

async function syncFromFirestore() {
  const remote = await loadTabsFirestore();
  if (remote) {
    const local = loadTabsLocal();
    if (JSON.stringify(remote) !== JSON.stringify(local)) {
      saveTabsLocal(remote);
      renderBottomNav();
      console.log('[NavCustomizer] ✓ Synced from Firestore:', remote);
    }
  }
}


// ══════════════════════════════════════════════════════════════
//  CSS INJECTION
// ══════════════════════════════════════════════════════════════

function injectCSS() {
  if (document.getElementById('nbd-nav-customizer-css')) return;
  const style = document.createElement('style');
  style.id = 'nbd-nav-customizer-css';
  style.textContent = `

#navCustomizeModal {
  display:none; position:fixed; top:0; left:0; right:0; bottom:0;
  z-index:10000; background:rgba(0,0,0,.85);
  -webkit-backdrop-filter:blur(20px); backdrop-filter:blur(20px);
  align-items:flex-end; justify-content:center;
}
#navCustomizeModal.open { display:flex; }

.ncm-sheet {
  width:100%; max-width:500px; max-height:88vh;
  background:var(--s, #111318); border-radius:20px 20px 0 0;
  display:flex; flex-direction:column; overflow:hidden;
  border:1px solid var(--br, #1e2530); border-bottom:none;
  animation: ncm-slide-up .3s cubic-bezier(.32,.72,0,1);
}
@keyframes ncm-slide-up {
  from { transform:translateY(100%); opacity:0; }
  to   { transform:translateY(0); opacity:1; }
}

.ncm-handle { display:flex; justify-content:center; padding:12px 0 4px; }
.ncm-handle::after {
  content:''; width:40px; height:4px; border-radius:3px;
  background:var(--br, #2a3040);
}

.ncm-head {
  display:flex; align-items:center; justify-content:space-between;
  padding:8px 20px 14px;
}
.ncm-title {
  font-family:'Barlow Condensed',sans-serif; font-size:20px;
  font-weight:800; color:var(--t, #e8eaf0); letter-spacing:.03em;
}
.ncm-subtitle {
  font-size:11px; color:var(--m, #8a8f9e); margin-top:2px;
  font-family:'Barlow Condensed',sans-serif; letter-spacing:.02em;
}
.ncm-close {
  background:none; border:1px solid var(--br, #2a3040);
  border-radius:10px; color:var(--m, #8a8f9e); font-size:18px;
  width:38px; height:38px; display:flex; align-items:center;
  justify-content:center; cursor:pointer;
  -webkit-tap-highlight-color:transparent;
}
.ncm-close:active { background:rgba(255,255,255,.05); }

.ncm-current { padding:0 16px 12px; display:flex; gap:8px; }
.ncm-current-label {
  padding:0 20px 8px; font-size:10px;
  font-family:'Barlow Condensed',sans-serif;
  text-transform:uppercase; letter-spacing:.12em;
  color:var(--m, #8a8f9e); font-weight:700;
}
.ncm-slot {
  flex:1; display:flex; flex-direction:column; align-items:center;
  gap:4px; padding:12px 4px; border-radius:14px;
  background:var(--s2, rgba(255,255,255,.04));
  border:2px solid var(--br, #1e2530);
  position:relative; cursor:grab; min-width:0;
  transition:border-color .15s, background .15s, transform .15s;
  -webkit-tap-highlight-color:transparent;
}
.ncm-slot.dragging { opacity:.5; transform:scale(.92); border-color:var(--orange, #e8720c); }
.ncm-slot.drag-over { border-color:var(--orange, #e8720c); background:rgba(232,114,12,.1); transform:scale(1.04); }
.ncm-slot-icon { font-size:22px; line-height:1; }
.ncm-slot-label {
  font-size:9px; font-family:'Barlow Condensed',sans-serif;
  text-transform:uppercase; letter-spacing:.06em;
  color:var(--t, #e8eaf0); font-weight:600;
  text-align:center; white-space:nowrap; overflow:hidden;
  text-overflow:ellipsis; max-width:100%;
}
.ncm-slot-num {
  position:absolute; top:4px; left:6px; font-size:8px;
  font-weight:800; color:var(--orange, #e8720c);
  font-family:'Barlow Condensed',sans-serif;
}
.ncm-slot-remove {
  position:absolute; top:2px; right:4px; font-size:12px;
  background:none; border:none; color:var(--m, #8a8f9e);
  cursor:pointer; padding:2px 4px; border-radius:6px;
  line-height:1; -webkit-tap-highlight-color:transparent;
}
.ncm-slot-remove:active { color:var(--red, #e85454); }

.ncm-pool { flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; padding:0 16px 24px; }
.ncm-pool-label {
  padding:12px 4px 6px; font-size:9px;
  font-family:'Barlow Condensed',sans-serif;
  text-transform:uppercase; letter-spacing:.12em;
  color:var(--m, #8a8f9e); font-weight:700;
}
.ncm-pool-grid { display:grid; grid-template-columns:repeat(4, 1fr); gap:8px; }
.ncm-pool-item {
  display:flex; flex-direction:column; align-items:center;
  gap:4px; padding:12px 4px; border-radius:12px;
  background:var(--s2, rgba(255,255,255,.04));
  border:1px solid var(--br, #1e2530);
  cursor:pointer; transition:all .15s;
  -webkit-tap-highlight-color:transparent;
}
.ncm-pool-item:active { background:rgba(232,114,12,.12); border-color:var(--orange, #e8720c); transform:scale(.95); }
.ncm-pool-item.in-bar { opacity:.35; pointer-events:none; border-style:dashed; }
.ncm-pool-icon { font-size:20px; line-height:1; }
.ncm-pool-name {
  font-size:9px; font-family:'Barlow Condensed',sans-serif;
  text-transform:uppercase; letter-spacing:.04em;
  color:var(--t, #e8eaf0); font-weight:600;
  text-align:center; white-space:nowrap; overflow:hidden;
  text-overflow:ellipsis; max-width:100%;
}

.ncm-sync {
  display:flex; align-items:center; gap:6px;
  padding:0 20px 8px; font-size:10px;
  color:var(--m, #8a8f9e);
  font-family:'Barlow Condensed',sans-serif; letter-spacing:.04em;
}
.ncm-sync-dot { width:6px; height:6px; border-radius:50%; background:var(--green, #4ade80); flex-shrink:0; }
.ncm-sync-dot.offline { background:var(--yellow, #facc15); }
.ncm-sync-dot.error   { background:var(--red, #e85454); }

.ncm-actions {
  display:flex; gap:10px; padding:12px 16px;
  border-top:1px solid var(--br, #1e2530);
  padding-bottom:calc(16px + env(safe-area-inset-bottom, 0px));
}
.ncm-btn {
  flex:1; padding:14px; border-radius:12px; font-size:14px;
  font-family:'Barlow Condensed',sans-serif; font-weight:700;
  letter-spacing:.06em; text-transform:uppercase;
  cursor:pointer; border:none; text-align:center;
  -webkit-tap-highlight-color:transparent;
  transition:background .15s, transform .1s;
}
.ncm-btn:active { transform:scale(.97); }
.ncm-btn-reset {
  background:var(--s2, rgba(255,255,255,.06));
  color:var(--m, #8a8f9e); border:1px solid var(--br, #1e2530);
}
.ncm-btn-save { background:var(--orange, #e8720c); color:#fff; }
.ncm-btn-save.saving { opacity:.6; pointer-events:none; }

.mm-item-customize {
  border-top:1px solid var(--br, #1e2530);
  margin-top:8px; padding-top:14px;
  color:var(--orange, #e8720c) !important;
}
.mm-item-customize:hover,
.mm-item-customize:active { background:rgba(232,114,12,.1) !important; }

  `;
  document.head.appendChild(style);
}


// ══════════════════════════════════════════════════════════════
//  RENDER BOTTOM NAV
// ══════════════════════════════════════════════════════════════

function renderBottomNav() {
  const nav = document.getElementById('mobile-nav');
  if (!nav) return;

  const tabIds = loadTabs();
  let html = '';

  tabIds.forEach(id => {
    const tab = TAB_REGISTRY.find(t => t.id === id);
    if (!tab) return;
    html += `<div class="mn-item" id="mni-${tab.id}" onclick="mobileNav('${tab.action}')">
      <span class="mn-icon">${tab.icon}</span>
      <span class="mn-lbl">${tab.label}</span>
      ${tab.badge ? '<span class="mn-badge" id="mni-crm-badge" style="display:none;"></span>' : ''}
    </div>`;
  });

  html += `<div class="mn-item" id="mni-more" onclick="toggleMobileMore()">
    <span class="mn-icon">⋯</span>
    <span class="mn-lbl">More</span>
  </div>`;

  nav.innerHTML = html;

  if (typeof window.MOBILE_NAV_TABS !== 'undefined') {
    window.MOBILE_NAV_TABS.length = 0;
    tabIds.forEach(id => window.MOBILE_NAV_TABS.push(id));
  }

  setActiveTab();
}

function setActiveTab() {
  const hash = window.location.hash?.replace('#','') || 'dash';
  const tabIds = loadTabs();
  tabIds.forEach(id => {
    const el = document.getElementById('mni-' + id);
    if (el) el.classList.toggle('active', id === hash || (hash === '' && id === 'dash'));
  });
}


// ══════════════════════════════════════════════════════════════
//  CUSTOMIZE MODAL
// ══════════════════════════════════════════════════════════════

let _pendingTabs = [];
let _syncStatus = 'unknown';

function openCustomizeModal() {
  if (typeof closeMobileMore === 'function') closeMobileMore();

  let modal = document.getElementById('navCustomizeModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'navCustomizeModal';
    document.body.appendChild(modal);
  }

  _pendingTabs = loadTabs();
  _syncStatus = _firestoreReady() ? 'synced' : 'offline';
  renderModal(modal);
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeCustomizeModal() {
  const modal = document.getElementById('navCustomizeModal');
  if (modal) modal.classList.remove('open');
  document.body.style.overflow = '';
}

function renderModal(modal) {
  const categories = {};
  TAB_REGISTRY.forEach(t => {
    if (!categories[t.category]) categories[t.category] = [];
    categories[t.category].push(t);
  });

  let poolHTML = '';
  Object.keys(categories).forEach(cat => {
    poolHTML += `<div class="ncm-pool-label">${cat}</div><div class="ncm-pool-grid">`;
    categories[cat].forEach(t => {
      const inBar = _pendingTabs.includes(t.id);
      poolHTML += `<div class="ncm-pool-item ${inBar ? 'in-bar' : ''}"
        data-tab-id="${t.id}" onclick="window._ncmAddTab('${t.id}')">
        <span class="ncm-pool-icon">${t.icon}</span>
        <span class="ncm-pool-name">${t.label}</span>
      </div>`;
    });
    poolHTML += '</div>';
  });

  let slotsHTML = '';
  _pendingTabs.forEach((id, i) => {
    const tab = TAB_REGISTRY.find(t => t.id === id);
    if (!tab) return;
    slotsHTML += `<div class="ncm-slot" draggable="true" data-slot="${i}" data-tab-id="${id}"
      ontouchstart="window._ncmTouchStart(event, ${i})"
      ontouchmove="window._ncmTouchMove(event)"
      ontouchend="window._ncmTouchEnd(event)"
      ondragstart="window._ncmDragStart(event, ${i})"
      ondragover="window._ncmDragOver(event, ${i})"
      ondrop="window._ncmDrop(event, ${i})"
      ondragend="window._ncmDragEnd(event)">
      <span class="ncm-slot-num">${i+1}</span>
      <span class="ncm-slot-remove" onclick="event.stopPropagation();window._ncmRemoveTab(${i})">✕</span>
      <span class="ncm-slot-icon">${tab.icon}</span>
      <span class="ncm-slot-label">${tab.label}</span>
    </div>`;
  });

  for (let i = _pendingTabs.length; i < MAX_TABS; i++) {
    slotsHTML += `<div class="ncm-slot" data-slot="${i}" style="border-style:dashed;opacity:.4;"
      ondragover="window._ncmDragOver(event, ${i})"
      ondrop="window._ncmDrop(event, ${i})">
      <span class="ncm-slot-num">${i+1}</span>
      <span class="ncm-slot-icon" style="opacity:.3;">+</span>
      <span class="ncm-slot-label" style="opacity:.3;">Tap below</span>
    </div>`;
  }

  const syncDotClass = _syncStatus === 'synced' ? '' : _syncStatus === 'offline' ? 'offline' : 'error';
  const syncLabel = _syncStatus === 'synced' ? 'Syncs across devices'
    : _syncStatus === 'offline' ? 'Local only (not signed in)' : 'Sync error — saving locally';

  modal.innerHTML = `
    <div class="ncm-sheet" onclick="event.stopPropagation()">
      <div class="ncm-handle"></div>
      <div class="ncm-head">
        <div>
          <div class="ncm-title">⚡ Customize Tab Bar</div>
          <div class="ncm-subtitle">Pick 4 tabs · drag to reorder</div>
        </div>
        <button class="ncm-close" onclick="window._ncmClose()">✕</button>
      </div>
      <div class="ncm-sync">
        <span class="ncm-sync-dot ${syncDotClass}"></span>
        ${syncLabel}
      </div>
      <div class="ncm-current-label">YOUR TABS</div>
      <div class="ncm-current" id="ncm-slots">${slotsHTML}</div>
      <div class="ncm-pool" id="ncm-pool">${poolHTML}</div>
      <div class="ncm-actions">
        <button class="ncm-btn ncm-btn-reset" onclick="window._ncmReset()">Reset</button>
        <button class="ncm-btn ncm-btn-save" id="ncm-save-btn" onclick="window._ncmSave()">Save</button>
      </div>
    </div>
  `;

  modal.onclick = function(e) { if (e.target === modal) window._ncmClose(); };
}

function _syncPending() {
  const modal = document.getElementById('navCustomizeModal');
  if (modal) renderModal(modal);
}


// ══════════════════════════════════════════════════════════════
//  DRAG & DROP (desktop)
// ══════════════════════════════════════════════════════════════

let _dragIdx = null;

window._ncmDragStart = function(e, idx) {
  _dragIdx = idx;
  e.target.closest('.ncm-slot').classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
};
window._ncmDragOver = function(e, idx) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.ncm-slot').forEach(s => s.classList.remove('drag-over'));
  e.target.closest('.ncm-slot')?.classList.add('drag-over');
};
window._ncmDrop = function(e, targetIdx) {
  e.preventDefault();
  if (_dragIdx === null || _dragIdx === targetIdx) return;
  if (_dragIdx < _pendingTabs.length && targetIdx < _pendingTabs.length) {
    const temp = _pendingTabs[_dragIdx];
    _pendingTabs[_dragIdx] = _pendingTabs[targetIdx];
    _pendingTabs[targetIdx] = temp;
    _syncPending();
  }
  _dragIdx = null;
};
window._ncmDragEnd = function(e) {
  document.querySelectorAll('.ncm-slot').forEach(s => s.classList.remove('dragging','drag-over'));
  _dragIdx = null;
};


// ══════════════════════════════════════════════════════════════
//  TOUCH REORDER (mobile)
// ══════════════════════════════════════════════════════════════

let _touchIdx = null;
let _touchStartX = 0;

window._ncmTouchStart = function(e, idx) {
  _touchIdx = idx;
  _touchStartX = e.touches[0].clientX;
  e.target.closest('.ncm-slot')?.classList.add('dragging');
};
window._ncmTouchMove = function(e) {
  if (_touchIdx !== null) e.preventDefault();
};
window._ncmTouchEnd = function(e) {
  if (_touchIdx === null) return;
  const endX = e.changedTouches[0].clientX;
  const diff = endX - _touchStartX;
  const slots = document.querySelectorAll('#ncm-slots .ncm-slot');
  const slotWidth = slots[0]?.offsetWidth || 80;

  if (Math.abs(diff) > slotWidth * 0.4) {
    const dir = diff > 0 ? 1 : -1;
    const targetIdx = _touchIdx + dir;
    if (targetIdx >= 0 && targetIdx < _pendingTabs.length) {
      const temp = _pendingTabs[_touchIdx];
      _pendingTabs[_touchIdx] = _pendingTabs[targetIdx];
      _pendingTabs[targetIdx] = temp;
      _syncPending();
    }
  }

  document.querySelectorAll('.ncm-slot').forEach(s => s.classList.remove('dragging'));
  _touchIdx = null;
};


// ══════════════════════════════════════════════════════════════
//  ADD / REMOVE / SAVE / RESET
// ══════════════════════════════════════════════════════════════

window._ncmAddTab = function(tabId) {
  if (_pendingTabs.includes(tabId)) return;
  if (_pendingTabs.length >= MAX_TABS) {
    _pendingTabs[MAX_TABS - 1] = tabId;
  } else {
    _pendingTabs.push(tabId);
  }
  _syncPending();
};

window._ncmRemoveTab = function(idx) {
  if (_pendingTabs.length <= 1) return;
  _pendingTabs.splice(idx, 1);
  _syncPending();
};

window._ncmSave = async function() {
  const btn = document.getElementById('ncm-save-btn');
  if (btn) { btn.classList.add('saving'); btn.textContent = 'Saving…'; }

  saveTabsLocal(_pendingTabs);
  renderBottomNav();

  const ok = await saveTabsFirestore(_pendingTabs);
  _syncStatus = ok ? 'synced' : (_firestoreReady() ? 'error' : 'offline');

  closeCustomizeModal();

  if (typeof showToast === 'function') {
    showToast(ok ? 'Tab bar saved & synced!' : 'Tab bar saved locally!', ok ? 'success' : 'info');
  }
};

window._ncmReset = function() {
  _pendingTabs = [...DEFAULT_TABS];
  _syncPending();
};

window._ncmClose = closeCustomizeModal;


// ══════════════════════════════════════════════════════════════
//  INJECT "CUSTOMIZE TABS" INTO MORE MENU
// ══════════════════════════════════════════════════════════════

function addCustomizeToMoreMenu() {
  const moreMenu = document.getElementById('mobile-more-menu');
  if (!moreMenu || moreMenu.querySelector('.mm-item-customize')) return;

  const item = document.createElement('div');
  item.className = 'mm-item mm-item-customize';
  item.onclick = function() { openCustomizeModal(); };
  item.innerHTML = '<span class="mm-item-icon">⚡</span>Customize Tab Bar';
  moreMenu.appendChild(item);
}


// ══════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════

function init() {
  injectCSS();
  renderBottomNav();
  addCustomizeToMoreMenu();

  // Background Firestore sync once auth is ready
  if (window.auth && window._onAuthStateChanged) {
    window._onAuthStateChanged(window.auth, user => {
      if (user) setTimeout(() => syncFromFirestore(), 800);
    });
  } else {
    const poll = setInterval(() => {
      if (window.auth?.currentUser && _firestoreReady()) {
        clearInterval(poll);
        syncFromFirestore();
      }
    }, 1000);
    setTimeout(() => clearInterval(poll), 10000);
  }

  window.openNavCustomizer = openCustomizeModal;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
