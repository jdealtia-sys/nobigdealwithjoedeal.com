/**
 * d2d-tracker-core-2026b.js — D2D core (state + data layer)
 *
 * Step 4f (2026-05-16): the 3539-line d2d-tracker-2026b.js IIFE got
 * split into a CORE module (this file) and a UI module
 * (d2d-tracker-ui-2026b.js), with the original filename retained as
 * a thin shim that publishes window.D2D. Behavior unchanged.
 *
 * Core owns:
 *   - All shared state (knocks, currentRep, currentLocation, maps,
 *     offline queue, voice/photo state, …) on window._D2DState
 *   - Constants (DISPOSITIONS, DISPO_ORDER, CARRIERS, SMS_TEMPLATES,
 *     DAILY_CHALLENGES, STREAK_MILESTONES, MAX_ATTEMPTS, …)
 *   - iOS-safe modal helpers (uiConfirm/uiPrompt)
 *   - Date / address / escape utilities
 *   - Offline sync queue
 *   - Reverse geocoding + Nominatim autocomplete wiring
 *   - Weather, neighborhood scoring, street sequencing
 *   - Walking-route nearest-neighbor + 2-opt optimizer
 *   - Firestore CRUD: loadRepProfile, loadKnocks, submitKnock,
 *     updateKnock, deleteKnock, convertToLead, convertToLeadWithEdit,
 *     loadTeamKnocks, loadTerritories, saveTerritory, deleteTerritory
 *   - Map init + layer panel + jobs/weather/territory overlays
 *   - Photo + voice upload helpers (Firebase Storage)
 *   - Metrics, gamification, filters
 *   - initD2D entry point
 *
 * UI module (d2d-tracker-ui-2026b.js) is loaded NEXT and reads
 * everything via window._D2DState.
 */
(function() {
  'use strict';

  // ============================================================================
  // CONSTANTS & DISPOSITIONS
  // ============================================================================
  const DISPOSITIONS = {
    not_home:       { label: 'Not Home',                color: '#6B7280', icon: '🏠', short: 'NH',   autoFollowUp: 1 },
    not_interested: { label: 'Not Interested',          color: '#E05252', icon: '✋', short: 'NI',   autoFollowUp: null },
    interested:     { label: 'Interested',              color: '#EAB308', icon: '👍', short: 'INT',  autoFollowUp: 3 },
    appointment:    { label: 'Appointment Set',         color: '#2ECC8A', icon: '📅', short: 'APT',  autoFollowUp: null },
    come_back:      { label: 'Come Back Later',         color: '#4A9EFF', icon: '🔄', short: 'CBL',  autoFollowUp: null },
    storm_damage:   { label: 'Storm Damage Noted',      color: '#e8720c', icon: '⛈️', short: 'DMG', autoFollowUp: 1 },
    ins_has_claim:  { label: 'Insurance - Has Claim',   color: '#9B6DFF', icon: '📋', short: 'CLM',  autoFollowUp: 2 },
    ins_needs_file: { label: 'Insurance - Needs Filing', color: '#D946EF', icon: '📝', short: 'FIL', autoFollowUp: 1 },
    ins_denied:     { label: 'Insurance - Denied',      color: '#78350F', icon: '❌', short: 'DEN',  autoFollowUp: 3 },
    do_not_knock:   { label: 'Do Not Knock',            color: '#1F2937', icon: '🚫', short: 'DNK',  autoFollowUp: null },
    cold_dead:      { label: 'Cold / Dead Lead',        color: '#374151', icon: '💀', short: 'DEAD', autoFollowUp: null },
    // ── New dispositions (April 2026) ──
    left_material:  { label: 'Left Material',           color: '#0EA5E9', icon: '📬', short: 'MAT',  autoFollowUp: 3 },
    callback:       { label: 'Callback Requested',      color: '#14B8A6', icon: '📞', short: 'CBR',  autoFollowUp: 1 },
    tenant:         { label: 'Tenant (Not Owner)',       color: '#94A3B8', icon: '🔑', short: 'TNT',  autoFollowUp: null },
    vacant:         { label: 'Vacant Property',          color: '#475569', icon: '🏚️', short: 'VAC', autoFollowUp: 7 }
  };

  const DISPO_ORDER = [
    'appointment','interested','storm_damage','come_back','callback',
    'left_material','ins_has_claim','ins_needs_file','ins_denied',
    'not_home','tenant','vacant','not_interested','do_not_knock','cold_dead'
  ];

  const INS_DISPOSITIONS = ['ins_has_claim','ins_needs_file','ins_denied'];

  const CARRIERS = [
    'State Farm','Allstate','Progressive','USAA','Liberty Mutual','Nationwide',
    'Farmers','Travelers','American Family','Erie Insurance','Cincinnati Insurance',
    'Auto-Owners','Safeco','Westfield','Grange','Other'
  ];

  const MAX_ATTEMPTS = 5;
  const CINCINNATI = [39.10, -84.51];

  // ============================================================================
  // iOS-SAFE MODAL CONFIRM / PROMPT
  // ----------------------------------------------------------------------------
  // Native `confirm()` / `prompt()` are unreliable on iOS Safari/PWA installs —
  // they're blocked inside WKWebView standalone contexts and can no-op silently,
  // especially after a gesture boundary (e.g. touchend → async handler). These
  // helpers render a real DOM modal that works everywhere and returns a Promise.
  // ============================================================================
  function uiConfirm(message, { okLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'd2d-modal-overlay open';
      overlay.style.zIndex = '10005';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      const okColor = danger ? '#E05252' : 'var(--accent, #2ECC8A)';
      overlay.innerHTML = `
        <div class="d2d-modal" style="padding:20px;max-width:360px;width:92%;">
          <div style="font-size:15px;line-height:1.45;margin-bottom:18px;color:var(--text, #111);white-space:pre-wrap;">${escapeHtml(message)}</div>
          <div style="display:flex;gap:10px;justify-content:flex-end;">
            <button type="button" data-act="cancel" style="padding:10px 16px;border-radius:10px;border:1px solid var(--border,#D1D5DB);background:transparent;color:var(--text,#111);font-weight:600;cursor:pointer;">${escapeHtml(cancelLabel)}</button>
            <button type="button" data-act="ok" style="padding:10px 16px;border-radius:10px;border:none;background:${okColor};color:#fff;font-weight:700;cursor:pointer;">${escapeHtml(okLabel)}</button>
          </div>
        </div>`;
      function close(result) {
        overlay.removeEventListener('click', onOverlay);
        overlay.remove();
        resolve(result);
      }
      function onOverlay(ev) {
        if (ev.target === overlay) return close(false);
        const btn = ev.target.closest('button[data-act]');
        if (!btn) return;
        close(btn.dataset.act === 'ok');
      }
      overlay.addEventListener('click', onOverlay);
      document.body.appendChild(overlay);
    });
  }

  function uiPrompt(message, defaultValue = '', { okLabel = 'Save', cancelLabel = 'Cancel', maxLength = 200 } = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'd2d-modal-overlay open';
      overlay.style.zIndex = '10005';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.innerHTML = `
        <div class="d2d-modal" style="padding:20px;max-width:380px;width:92%;">
          <div style="font-size:15px;line-height:1.45;margin-bottom:12px;color:var(--text, #111);">${escapeHtml(message)}</div>
          <input type="text" data-role="input" maxlength="${Number(maxLength)}" style="width:100%;padding:11px 12px;border-radius:10px;border:1px solid var(--border,#D1D5DB);background:var(--surface,#fff);color:var(--text,#111);font-size:15px;margin-bottom:16px;box-sizing:border-box;" />
          <div style="display:flex;gap:10px;justify-content:flex-end;">
            <button type="button" data-act="cancel" style="padding:10px 16px;border-radius:10px;border:1px solid var(--border,#D1D5DB);background:transparent;color:var(--text,#111);font-weight:600;cursor:pointer;">${escapeHtml(cancelLabel)}</button>
            <button type="button" data-act="ok" style="padding:10px 16px;border-radius:10px;border:none;background:var(--accent,#2ECC8A);color:#fff;font-weight:700;cursor:pointer;">${escapeHtml(okLabel)}</button>
          </div>
        </div>`;
      const input = overlay.querySelector('input[data-role="input"]');
      input.value = defaultValue || '';
      function close(result) {
        overlay.removeEventListener('click', onOverlay);
        overlay.removeEventListener('keydown', onKey, true);
        overlay.remove();
        resolve(result);
      }
      function onOverlay(ev) {
        if (ev.target === overlay) return close(null);
        const btn = ev.target.closest('button[data-act]');
        if (!btn) return;
        close(btn.dataset.act === 'ok' ? (input.value || '') : null);
      }
      function onKey(ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); close(input.value || ''); }
        else if (ev.key === 'Escape') { ev.preventDefault(); close(null); }
      }
      overlay.addEventListener('click', onOverlay);
      overlay.addEventListener('keydown', onKey, true);
      document.body.appendChild(overlay);
      setTimeout(() => input.focus(), 20);
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Google satellite primary (mt{s}.google.com — already on the CSP
  // script-src/img-src allow-list). Esri/ArcGIS as a per-tile fallback
  // via tileerror in initD2DMap. Esri was the previous primary, but
  // Brave Shields (and several other tracker-blocker extensions) block
  // server.arcgisonline.com at the network layer — the request fails
  // before it ever hits the server, the SW falls through to a synthetic
  // 503, and Leaflet renders a black void. Google's tile endpoint is on
  // every blocker's allowlist, so it ships universally. We keep Esri
  // around for the rare case Google rate-limits a specific tile.
  const SAT_TILES_PRIMARY = 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}';
  const SAT_TILES_FALLBACK = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search?format=json&countrycodes=us&limit=5&q=';
  const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1';
  const WEATHER_KEY_STORE = 'nbd_weather_key';
  const SYNC_QUEUE_KEY = 'nbd_d2d_sync_queue';
  const PAGE_SIZE = 200;

  // SMS templates
  const SMS_TEMPLATES = {
    interested: { label: 'Thanks for Chatting', body: 'Hey {name}! This is {rep} from NBD Home Solutions. Great chatting today — I\'d love to take a closer look at your roof. Let me know a good time!' },
    appointment: { label: 'Appointment Confirmation', body: 'Hi {name}! {rep} from NBD confirming our upcoming roof inspection. Looking forward to it!' },
    storm_damage: { label: 'Storm Damage Alert', body: 'Hi {name}, {rep} from NBD. I noticed some storm damage on your roof today. I offer free inspections — would you like me to come take a closer look?' },
    ins_has_claim: { label: 'Insurance Help', body: 'Hi {name}, {rep} from NBD. I can help guide you through your insurance claim process. Want to set up a time to chat?' },
    follow_up: { label: 'General Follow-up', body: 'Hi {name}! {rep} from NBD checking in. We chatted recently about your roof — any updates on your end? Happy to answer any questions.' },
    not_home: { label: 'Missed You', body: 'Hi {name}, {rep} from NBD Home Solutions. I stopped by {address} today but missed you. I noticed a few things on your roof I\'d love to discuss. When works best for a quick chat?' }
  };

  // Gamification challenges
  const DAILY_CHALLENGES = [
    { id: 'knock_30', label: 'Knock 30 Doors', target: 30, metric: 'today', icon: '🚪' },
    { id: 'appt_3', label: 'Set 3 Appointments', target: 3, metric: 'appointments_today', icon: '📅' },
    { id: 'ins_5', label: 'Log 5 Insurance Leads', target: 5, metric: 'insurance_today', icon: '📋' },
    { id: 'conv_3', label: 'Get 3 Conversations', target: 3, metric: 'conversations_today', icon: '💬' },
    { id: 'photo_5', label: 'Take 5 Roof Photos', target: 5, metric: 'photos_today', icon: '📷' }
  ];

  const STREAK_MILESTONES = [
    { days: 3, label: 'Getting Started', badge: '🔥' },
    { days: 7, label: 'One Week Warrior', badge: '⚡' },
    { days: 14, label: 'Two Week Titan', badge: '💪' },
    { days: 30, label: 'Monthly Master', badge: '🏆' },
    { days: 60, label: 'Relentless', badge: '👑' },
    { days: 100, label: 'Century Club', badge: '💎' }
  ];

  // Dispositions that should auto-offer lead conversion
  const HOT_DISPOSITIONS = ['appointment', 'interested', 'storm_damage', 'ins_has_claim', 'ins_needs_file', 'callback'];

  // ============================================================================
  // SHARED STATE (mirrored on window._D2DState so UI module can read/write)
  // ----------------------------------------------------------------------------
  // Step 4f rationale: the UI module (renderD2D, modals, voice/photo UI) needs
  // to read and occasionally mutate the same state that the core module owns.
  // Rather than pass arguments through every render/modal-open call, we publish
  // a single state object that both modules close over via window._D2DState.
  // Mirrors the dashboard-state.js pattern from Step 4a.
  // ============================================================================
  const state = window._D2DState = window._D2DState || {};
  state.knocks = [];
  state.d2dMap = null;
  state.d2dCluster = null;
  state.d2dHeat = null;
  state.d2dInited = false;
  state.d2dInitializing = false; // guard against concurrent initD2D() calls
  state.locationMarker = null;
  state.accuracyCircle = null;
  state.watchId = null;
  state.currentLocation = null;
  state.currentKnockEntry = null;
  state.filterDispo = null;
  state.filterDateRange = 'today';
  state.showHeat = false;
  state.currentRep = null;
  state.teamMode = false;
  state.teamKnocks = [];
  state.territories = [];
  state.walkingRoute = null;
  state.walkingRouteLine = null;
  state.streetSequences = {};
  state.weatherData = null;
  state.neighborhoodScores = {};
  state.offlineQueue = [];
  state.isOnline = navigator.onLine;
  state.autocompleteTimeout = null;
  state.voiceRecorder = null;
  state.voiceChunks = [];
  state.voiceBlob = null;
  state.currentTab = 'feed'; // 'feed' | 'routes' | 'gamify' | 'analytics'

  // Constants the UI module also needs to read
  state.DISPOSITIONS = DISPOSITIONS;
  state.DISPO_ORDER = DISPO_ORDER;
  state.INS_DISPOSITIONS = INS_DISPOSITIONS;
  state.CARRIERS = CARRIERS;
  state.MAX_ATTEMPTS = MAX_ATTEMPTS;
  state.SMS_TEMPLATES = SMS_TEMPLATES;
  state.DAILY_CHALLENGES = DAILY_CHALLENGES;
  state.STREAK_MILESTONES = STREAK_MILESTONES;
  state.HOT_DISPOSITIONS = HOT_DISPOSITIONS;
  state.PAGE_SIZE = PAGE_SIZE;

  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================
  function esc(s) {
    const div = document.createElement('div');
    div.textContent = s || '';
    return div.innerHTML;
  }

  // Audit finding #10: Safari's date-string parser is much stricter
  // than Chrome/Firefox. `new Date('2026-04-15 14:30')` (no T
  // separator) returns Invalid Date in Safari but a valid Date in
  // Chrome. Code downstream then does `.toDateString()` which
  // returns the literal string "Invalid Date" — the isToday
  // comparison silently never matches, follow-up reminders never
  // fire, and the user has no idea their pipeline is broken.
  //
  // Hardened toDate(): try toDate() (Firestore Timestamp), then
  // direct Date construction, then a normalized retry with the
  // common Safari-incompatible patterns fixed (space → T,
  // /-separated → -separated). Returns null on any unparseable
  // input so callers can guard with a nullcheck instead of
  // silently working with NaN-valued Dates.
  function toDate(d) {
    if (!d) return null;
    if (d instanceof Date) return isNaN(d.getTime()) ? null : d;
    if (typeof d.toDate === 'function') {
      try { const t = d.toDate(); return (t && !isNaN(t.getTime())) ? t : null; }
      catch (_) { return null; }
    }
    if (typeof d === 'number') {
      const t = new Date(d);
      return isNaN(t.getTime()) ? null : t;
    }
    if (typeof d === 'string') {
      let t = new Date(d);
      if (!isNaN(t.getTime())) return t;
      // Safari rescue: replace space-separator with T.
      t = new Date(d.replace(' ', 'T'));
      if (!isNaN(t.getTime())) return t;
      // Safari rescue: yyyy/mm/dd → yyyy-mm-dd
      t = new Date(d.replace(/\//g, '-'));
      if (!isNaN(t.getTime())) return t;
      return null;
    }
    return null;
  }

  function timeAgo(d) {
    const date = toDate(d);
    if (!date) return '';
    const now = new Date();
    const sec = Math.floor((now - date) / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return min + 'm ago';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    const day = Math.floor(hr / 24);
    if (day < 7) return day + 'd ago';
    return formatDate(date);
  }

  function formatTime(d) {
    const date = toDate(d);
    if (!date) return '';
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function formatDate(d) {
    const date = toDate(d);
    if (!date) return '';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function isToday(d) {
    const date = toDate(d);
    if (!date) return false;
    return date.toDateString() === new Date().toDateString();
  }

  function isThisWeek(d) {
    const date = toDate(d);
    if (!date) return false;
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    return date >= weekAgo && date <= now;
  }

  function isThisMonth(d) {
    const date = toDate(d);
    if (!date) return false;
    const now = new Date();
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  }

  function normalizeAddress(addr) {
    return (addr || '').toLowerCase().trim().replace(/\s+/g, ' ');
  }

  function getAttemptCount(address) {
    const norm = normalizeAddress(address);
    return state.knocks.filter(k => normalizeAddress(k.address) === norm).length;
  }

  function getAddressHistory(address) {
    const norm = normalizeAddress(address);
    return state.knocks
      .filter(k => normalizeAddress(k.address) === norm)
      .sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0));
  }

  function parseHouseNumber(address) {
    const m = (address || '').match(/^(\d+)\s/);
    return m ? parseInt(m[1]) : 0;
  }

  function parseStreetName(address) {
    return (address || '').replace(/^\d+\s+/, '').split(',')[0].trim().toLowerCase();
  }

  // ============================================================================
  // OFFLINE SYNC QUEUE
  // ============================================================================
  // Audit findings #5, #14 (D2D-local copy of the protections that
  // landed in offline-manager.js). D2D's queue lives in localStorage
  // — Safari purges it after 7 days of PWA inactivity AND quotas it
  // around 5MB.
  const D2D_QUEUE_MAX = 500;
  const D2D_QUEUE_LAST_KNOWN_KEY = 'nbd_d2d_queue_last_known_size';

  function loadOfflineQueue() {
    try {
      state.offlineQueue = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || '[]');
      if (!Array.isArray(state.offlineQueue)) state.offlineQueue = [];
    } catch(e) {
      // JSON corruption — log loudly rather than silently wiping
      // the queue. Stash the corrupt value in case we want to
      // recover by hand. Only THEN reset.
      console.error('D2D: offline queue JSON corrupt, stashing for recovery', e);
      try { localStorage.setItem(SYNC_QUEUE_KEY + '_corrupt_' + Date.now(), localStorage.getItem(SYNC_QUEUE_KEY) || ''); } catch (_) {}
      state.offlineQueue = [];
    }

    // Audit finding #5: detect Safari 7-day purge. localStorage
    // _can_ survive the IDB purge (different rules across iOS
    // versions), but it can also vanish. Bumped to lastKnown on
    // every save; if the queue is empty here AND lastKnown > 0,
    // we lost the queue between sessions.
    try {
      const lastKnown = Number(localStorage.getItem(D2D_QUEUE_LAST_KNOWN_KEY) || '0');
      if (lastKnown > 0 && state.offlineQueue.length === 0) {
        console.warn('D2D: offline queue loss detected', lastKnown, '→ 0');
        // Defer the toast slightly so it lands after the page is
        // visible (showToast called pre-render is a no-op).
        setTimeout(() => {
          window.showToast?.(
            'Heads up — ' + lastKnown + ' offline knock'
            + (lastKnown === 1 ? '' : 's') + ' from your last session were lost (browser cleared offline storage).',
            'warning'
          );
        }, 1500);
        try { localStorage.setItem(D2D_QUEUE_LAST_KNOWN_KEY, '0'); } catch (_) {}
      }
    } catch (_) { /* localStorage may be inaccessible in private mode */ }
  }

  function saveOfflineQueue() {
    try {
      localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(state.offlineQueue));
      try { localStorage.setItem(D2D_QUEUE_LAST_KNOWN_KEY, String(state.offlineQueue.length)); } catch (_) {}
    } catch (e) {
      // QuotaExceededError lands here — surface it instead of
      // letting the user think their knock saved.
      console.error('D2D: localStorage write failed', e && e.name);
      window.showToast?.(
        e && e.name === 'QuotaExceededError'
          ? 'Browser storage is full. Reconnect to sync, or clear some space.'
          : 'Could not save offline — please retry',
        'error'
      );
    }
  }

  function enqueueOffline(action, data) {
    if (state.offlineQueue.length >= D2D_QUEUE_MAX) {
      window.showToast?.(
        'Offline queue is full (' + D2D_QUEUE_MAX + ' knocks). Reconnect to sync.',
        'error'
      );
      return false;
    }
    state.offlineQueue.push({ action, data, timestamp: Date.now() });
    saveOfflineQueue();
    window.showToast?.('Saved offline — will sync when connected', 'warning');
    return true;
  }

  async function flushOfflineQueue() {
    if (state.offlineQueue.length === 0) return;
    // Snapshot the queue, clear it, persist the empty queue. Items
    // that fail re-enter via the catch below + saveOfflineQueue at
    // the end — so the persisted state always reflects the in-memory
    // state at flush exit, not at flush entry.
    const queue = [...state.offlineQueue];
    state.offlineQueue = [];
    saveOfflineQueue();

    let synced = 0;
    let failed = 0;
    let authFailures = 0;
    for (const item of queue) {
      try {
        if (item.action === 'submitKnock') {
          await submitKnock(item.data, true);
          synced++;
        } else if (item.action === 'updateKnock') {
          await updateKnock(item.data.id, item.data.fields);
          synced++;
        } else if (item.action === 'deleteKnock') {
          await deleteKnock(item.data.id);
          synced++;
        }
      } catch(e) {
        state.offlineQueue.push(item);
        failed++;
        // Firestore SDK error codes for auth failures.
        const code = e && (e.code || '');
        if (/permission-denied|unauthenticated/i.test(code)) authFailures++;
      }
    }
    saveOfflineQueue();
    if (synced > 0) window.showToast?.(`Synced ${synced} offline knock${synced !== 1 ? 's' : ''}`, 'success');
    // Surface persistent failures — auth-related ones are the worst
    // because the items will keep failing every flush until the user
    // re-authenticates.
    if (authFailures > 0) {
      window.showToast?.(
        authFailures + ' knock' + (authFailures === 1 ? '' : 's')
        + " couldn't sync — please sign in again",
        'warning'
      );
    } else if (failed > 0) {
      console.warn('D2D flush: ' + failed + ' items failed (non-auth), will retry next online window');
    }
  }

  window.addEventListener('online', () => {
    state.isOnline = true;
    if (window.D2D && typeof window.D2D.renderD2D === 'function') window.D2D.renderD2D();
    flushOfflineQueue();
  });
  window.addEventListener('offline', () => {
    state.isOnline = false;
    if (window.D2D && typeof window.D2D.renderD2D === 'function') window.D2D.renderD2D();
  });

  // Register background sync for offline knocks (if SW supports it)
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready.then(reg => {
      window.addEventListener('online', () => {
        reg.sync.register('nbd-d2d-sync').catch(() => {});
      });
    });
  }

  // Listen for SW flush message
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'FLUSH_OFFLINE_QUEUE') {
        flushOfflineQueue();
      }
    });
  }

  // ============================================================================
  // REVERSE GEOCODING & ADDRESS AUTOCOMPLETE
  // ============================================================================
  async function reverseGeocode(lat, lng) {
    try {
      const resp = await fetch(`${NOMINATIM_REVERSE}&lat=${lat}&lon=${lng}`);
      // Nominatim returns a 200 with an HTML error page on rate-limit and
      // 429/5xx on outages. Calling .json() on a non-OK body either throws
      // or returns useless data, but the exception was being swallowed.
      if (!resp.ok) { console.warn('Reverse geocode HTTP', resp.status); return ''; }
      const data = await resp.json();
      // Wave 156: route through window.formatMailingAddress (W141) so
      // D2D knock addresses match the USPS-formatted strings the rest
      // of the system uses. Same fix applied to d2d-tracker.js. See
      // sister comment there for full rationale.
      if (typeof window.formatMailingAddress === 'function') {
        const formatted = window.formatMailingAddress(data);
        if (formatted) return formatted;
      }
      if (data.address) {
        const a = data.address;
        const num = a.house_number || '';
        const road = a.road || a.street || '';
        const city = a.city || a.town || a.village || a.hamlet || '';
        const st = a.state || '';
        return `${num} ${road}${city ? ', ' + city : ''}${st ? ', ' + st : ''}`.trim();
      }
    } catch (e) { console.warn('Geocode failed:', e); }
    return '';
  }

  async function searchAddresses(query) {
    if (!query || query.length < 3) return [];
    try {
      const resp = await fetch(NOMINATIM_SEARCH + encodeURIComponent(query));
      if (!resp.ok) { console.warn('Address search HTTP', resp.status); return []; }
      return await resp.json();
    } catch(e) { return []; }
  }

  function setupAddressAutocomplete(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;

    let dropdown = document.getElementById(inputId + '-ac');
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.id = inputId + '-ac';
      dropdown.className = 'd2d-ac-dropdown';
      dropdown.style.cssText = 'position:absolute;left:0;right:0;top:100%;z-index:10;background:var(--s);border:1px solid var(--br);border-radius:0 0 6px 6px;max-height:200px;overflow-y:auto;display:none;box-shadow:0 4px 12px rgba(0,0,0,.15);';
      input.parentElement.style.position = 'relative';
      input.parentElement.appendChild(dropdown);
    }

    input.addEventListener('input', () => {
      clearTimeout(state.autocompleteTimeout);
      state.autocompleteTimeout = setTimeout(async () => {
        const val = input.value.trim();
        if (val.length < 3) { dropdown.style.display = 'none'; return; }

        // Search local knocks first
        const localMatches = state.knocks
          .filter(k => k.address && normalizeAddress(k.address).includes(normalizeAddress(val)))
          .slice(0, 3)
          .map(k => ({ display_name: k.address, lat: k.lat, lon: k.lng, local: true }));

        // Then Nominatim
        const remoteMatches = await searchAddresses(val);
        const allMatches = [...localMatches, ...remoteMatches.slice(0, 5 - localMatches.length)];

        if (allMatches.length === 0) { dropdown.style.display = 'none'; return; }

        dropdown.innerHTML = allMatches.map((r, i) => {
          const label = r.local ? '📍 ' + esc(r.display_name) : esc(r.display_name);
          return `<div class="d2d-ac-item" data-idx="${i}" style="padding:8px 12px;cursor:pointer;font-size:12px;color:var(--t);border-bottom:1px solid var(--br);transition:background .1s;" onmouseenter="this.style.background='var(--s2)'" onmouseleave="this.style.background='var(--s)'">${label}</div>`;
        }).join('');
        dropdown.style.display = 'block';

        dropdown.querySelectorAll('.d2d-ac-item').forEach((el, i) => {
          el.onclick = () => {
            const match = allMatches[i];
            input.value = match.display_name?.split(',').slice(0, 3).join(',').trim() || match.display_name;
            if (state.currentKnockEntry) {
              state.currentKnockEntry.lat = parseFloat(match.lat) || null;
              state.currentKnockEntry.lng = parseFloat(match.lon) || null;
            }
            dropdown.style.display = 'none';
          };
        });
      }, 350);
    });

    input.addEventListener('blur', () => {
      setTimeout(() => { dropdown.style.display = 'none'; }, 200);
    });
  }

  // ============================================================================
  // WEATHER INTEGRATION
  // ============================================================================
  async function loadWeather() {
    const key = localStorage.getItem(WEATHER_KEY_STORE);
    if (!key) return;
    const loc = state.currentLocation || CINCINNATI;
    try {
      const resp = await fetch(`https://api.openweathermap.org/data/2.5/onecall?lat=${loc[0]}&lon=${loc[1]}&exclude=minutely,hourly&appid=${key}&units=imperial`);
      if (resp.ok) {
        state.weatherData = await resp.json();
      }
    } catch(e) { console.warn('Weather load failed:', e); }
  }

  function getWeatherAlerts() {
    if (!state.weatherData) return [];
    const alerts = [];
    if (state.weatherData.alerts) {
      state.weatherData.alerts.forEach(a => {
        if (/hail|wind|storm|tornado|thunder/i.test(a.event)) {
          alerts.push({ event: a.event, description: a.description?.substring(0, 200), start: new Date(a.start * 1000), end: new Date(a.end * 1000) });
        }
      });
    }
    // Check recent weather for storm indicators
    const recent = state.weatherData.daily?.slice(0, 3) || [];
    recent.forEach(day => {
      if (day.wind_speed > 30 || day.weather?.some(w => /storm|hail|thunder/i.test(w.main))) {
        alerts.push({ event: 'Recent Storm Activity', description: `Wind: ${Math.round(day.wind_speed)}mph — ${day.weather?.[0]?.description || ''}`, start: new Date(day.dt * 1000) });
      }
    });
    return alerts;
  }

  // ============================================================================
  // NEIGHBORHOOD SCORING
  // ============================================================================
  function calculateNeighborhoodScores() {
    // Group knocks by approximate neighborhood (0.005 degree grid ~500m)
    const grid = {};
    state.knocks.forEach(k => {
      if (!k.lat || !k.lng) return;
      const key = `${(Math.round(k.lat / 0.005) * 0.005).toFixed(3)},${(Math.round(k.lng / 0.005) * 0.005).toFixed(3)}`;
      if (!grid[key]) grid[key] = { lat: k.lat, lng: k.lng, knocks: [], appointments: 0, stormDmg: 0, conversations: 0 };
      grid[key].knocks.push(k);
      if (k.disposition === 'appointment') grid[key].appointments++;
      if (k.disposition === 'storm_damage') grid[key].stormDmg++;
      if (!['not_home', 'do_not_knock', 'cold_dead'].includes(k.disposition)) grid[key].conversations++;
    });

    const scores = {};
    Object.keys(grid).forEach(key => {
      const g = grid[key];
      const totalKnocks = g.knocks.length;
      const convRate = totalKnocks > 0 ? g.conversations / totalKnocks : 0;
      const apptRate = totalKnocks > 0 ? g.appointments / totalKnocks : 0;
      const stormFactor = g.stormDmg > 0 ? 20 : 0;
      const densityFactor = Math.min(totalKnocks / 20, 1) * 15;
      const convFactor = convRate * 40;
      const apptFactor = apptRate * 25;
      const score = Math.min(Math.round(densityFactor + convFactor + apptFactor + stormFactor), 100);
      scores[key] = { ...g, score };
    });
    state.neighborhoodScores = scores;
    return scores;
  }

  // ============================================================================
  // STREET SEQUENCING
  // ============================================================================
  function buildStreetSequences() {
    const streets = {};
    state.knocks.forEach(k => {
      if (!k.address) return;
      const street = parseStreetName(k.address);
      if (!street || street.length < 3) return;
      if (!streets[street]) streets[street] = [];
      const num = parseHouseNumber(k.address);
      const existing = streets[street].find(d => d.address === k.address);
      if (!existing) {
        streets[street].push({ address: k.address, houseNum: num, lat: k.lat, lng: k.lng, knocked: true, disposition: k.disposition, knockId: k.id });
      }
    });

    // Sort each street by house number
    Object.keys(streets).forEach(st => {
      streets[st].sort((a, b) => a.houseNum - b.houseNum);
      // Fill in gaps (even numbers on one side, odd on the other)
      const nums = streets[st].map(d => d.houseNum).filter(n => n > 0);
      if (nums.length >= 2) {
        const min = Math.min(...nums);
        const max = Math.max(...nums);
        // Audit #17: both ternary branches returned 2 — so mixed-parity streets
        // (e.g. odd-west + even-east side of the same street) produced duplicate
        // ghost addresses. If all house numbers share parity we step 2 (skip
        // the opposite side), otherwise 1 (canvas both sides sequentially).
        const allEven = nums.every(n => n % 2 === 0);
        const allOdd = nums.every(n => n % 2 === 1);
        const step = (allEven || allOdd) ? 2 : 1;
        for (let n = min; n <= max; n += step) {
          if (!streets[st].find(d => d.houseNum === n)) {
            streets[st].push({ address: `${n} ${st}`, houseNum: n, lat: null, lng: null, knocked: false, disposition: null, knockId: null });
          }
        }
        streets[st].sort((a, b) => a.houseNum - b.houseNum);
      }
    });

    state.streetSequences = streets;
    return streets;
  }

  // ============================================================================
  // WALKING ROUTE OPTIMIZATION
  // ----------------------------------------------------------------------------
  // Strategy: nearest-neighbor for an initial path, then a 2-opt swap pass to
  // remove crossings. Real haversine distance (window.hav from maps.js, feet)
  // is used instead of planar Euclidean so the route is accurate even when
  // the route spans a few miles in WGS-84 coordinates. Falls back to Euclidean
  // if maps.js hasn't loaded yet — same behavior as before for that branch.
  //
  // Step 5: route is decorated with `_stats` so the renderer + toast can show
  // total distance and walking time (3 mph) without recomputing.
  // ============================================================================

  // Pace constants. 3 mph is a moderate D2D walking pace including pauses at
  // each door — conservative enough that reps don't underestimate timing.
  const WALK_SPEED_MPH = 3;
  const FEET_PER_MILE = 5280;

  function _segmentFeet(a, b) {
    if (typeof window.hav === 'function') {
      // hav() returns feet; signature expects { lat, lng } pairs.
      return window.hav({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
    }
    // Fallback: degrees-squared. Wildly imprecise but keeps the sort order
    // self-consistent so the route is still nearest-neighbor-ish.
    return Math.sqrt(
      Math.pow(b.lat - a.lat, 2) + Math.pow(b.lng - a.lng, 2)
    ) * 364000; // rough degrees → feet at mid-latitudes (~1 deg ≈ 69 miles)
  }

  function _routeLengthFeet(points) {
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
      total += _segmentFeet(points[i], points[i + 1]);
    }
    return total;
  }

  // 2-opt swap pass — for each pair of non-adjacent edges (i,i+1) and (j,j+1),
  // try reversing the slice between them. If the resulting route is shorter,
  // keep the swap. Repeat until no improvement is found OR we hit MAX_PASSES,
  // which guards against pathological inputs. O(n²) per pass; cheap up to ~50
  // stops, which is well above what a rep walks in a day.
  function _twoOpt(points) {
    if (points.length < 4) return points;
    const MAX_PASSES = 50;
    let best = points.slice();
    let bestLen = _routeLengthFeet(best);
    let improved = true;
    let passes = 0;

    while (improved && passes < MAX_PASSES) {
      improved = false;
      passes++;
      for (let i = 1; i < best.length - 2; i++) {
        for (let j = i + 1; j < best.length - 1; j++) {
          // Reverse the slice [i..j] and measure. Cheap to do as a copy here
          // since path lengths are small; profiler can switch to delta-cost
          // if this ever becomes hot.
          const candidate = best.slice(0, i)
            .concat(best.slice(i, j + 1).reverse())
            .concat(best.slice(j + 1));
          const len = _routeLengthFeet(candidate);
          if (len + 0.5 < bestLen) { // 0.5ft tolerance avoids float noise
            best = candidate;
            bestLen = len;
            improved = true;
          }
        }
      }
    }
    return best;
  }

  function calculateWalkingRoute() {
    const unvisited = [];

    // Get latest knock per address for pins
    // Audit #18: raw `k.createdAt > other.createdAt` compared Firestore
    // Timestamp objects, which coerce to `NaN > NaN === false` — meaning the
    // "latest" rule never actually replaced the first-seen knock. Normalize
    // both sides through toDate() so the comparison is numeric.
    const addrMap = new Map();
    state.knocks.forEach(k => {
      if (!k.lat || !k.lng) return;
      const norm = normalizeAddress(k.address);
      const existing = addrMap.get(norm);
      const kMs = (toDate(k.createdAt) || new Date(0)).getTime();
      const eMs = existing ? (toDate(existing.createdAt) || new Date(0)).getTime() : -Infinity;
      if (!existing || kMs > eMs) {
        addrMap.set(norm, k);
      }
    });

    // Filter to "not home" / "come back" that haven't been fully resolved
    addrMap.forEach(k => {
      if (['not_home', 'come_back'].includes(k.disposition) && getAttemptCount(k.address) < MAX_ATTEMPTS) {
        unvisited.push({ lat: k.lat, lng: k.lng, address: k.address, disposition: k.disposition });
      }
    });

    if (unvisited.length < 2) {
      state.walkingRoute = unvisited;
      if (state.walkingRoute) state.walkingRoute._stats = { stopCount: unvisited.length, totalFeet: 0, totalMiles: 0, walkMinutes: 0 };
      return unvisited;
    }

    // ─── Pass 1: nearest-neighbor from current location or first point ───
    const start = state.currentLocation ? { lat: state.currentLocation[0], lng: state.currentLocation[1] } : unvisited[0];
    let route = [];
    const remaining = [...unvisited];
    let current = start;

    while (remaining.length > 0) {
      let nearestIdx = 0;
      let nearestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = _segmentFeet(current, remaining[i]);
        if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
      }
      const next = remaining.splice(nearestIdx, 1)[0];
      route.push(next);
      current = next;
    }

    // ─── Pass 2: 2-opt swap pass to remove crossings ───
    // We prepend `start` to the path during optimization so the 2-opt knows
    // the rep's anchor point. Strip it back off afterward so the public
    // route array still represents "stops" (not including the rep's
    // starting position, which the renderer adds as an implicit origin).
    const withAnchor = [start, ...route];
    const optimized = _twoOpt(withAnchor);
    // Drop the anchor from index 0 — but only if 2-opt didn't move it.
    // If it did, the path is still valid; we just keep the new order.
    route = optimized[0] === start ? optimized.slice(1) : optimized;

    // ─── Stats: total distance + walking time at 3 mph ───
    const totalFeet = _routeLengthFeet([start, ...route]);
    const totalMiles = totalFeet / FEET_PER_MILE;
    const walkMinutes = (totalMiles / WALK_SPEED_MPH) * 60;
    route._stats = {
      stopCount: route.length,
      totalFeet,
      totalMiles,
      walkMinutes
    };

    state.walkingRoute = route;
    return route;
  }

  function drawWalkingRoute() {
    if (state.walkingRouteLine && state.d2dMap) state.d2dMap.removeLayer(state.walkingRouteLine);
    if (!state.walkingRoute || state.walkingRoute.length < 2 || !state.d2dMap) return;

    const coords = state.walkingRoute.map(p => [p.lat, p.lng]);
    if (state.currentLocation) coords.unshift(state.currentLocation);

    state.walkingRouteLine = L.polyline(coords, {
      color: '#4A9EFF',
      weight: 3,
      opacity: 0.7,
      dashArray: '10, 8',
      className: 'd2d-route-line'
    }).addTo(state.d2dMap);

    // Number markers
    state.walkingRoute.forEach((p, i) => {
      const numIcon = L.divIcon({
        html: `<div style="background:#4A9EFF;color:white;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;border:2px solid white;">${i + 1}</div>`,
        iconSize: [20, 20],
        className: ''
      });
      L.marker([p.lat, p.lng], { icon: numIcon }).addTo(state.d2dMap).bindPopup(`<b>Stop ${i + 1}</b><br>${esc(p.address)}`);
    });
  }

  function clearWalkingRoute() {
    if (state.walkingRouteLine && state.d2dMap) state.d2dMap.removeLayer(state.walkingRouteLine);
    state.walkingRouteLine = null;
    state.walkingRoute = null;
  }

  // ============================================================================
  // FIRESTORE CRUD
  // ============================================================================
  async function loadRepProfile() {
    try {
      const docSnap = await window.getDoc(window.doc(window._db, 'reps', window._user.uid));
      if (docSnap.exists()) {
        state.currentRep = docSnap.data();
      } else {
        const initials = (window._user.displayName || 'R').split(' ').map(n => n[0]).join('').toUpperCase();
        const {setDoc} = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        await setDoc(window.doc(window._db, 'reps', window._user.uid), {
          userId: window._user.uid,
          name: window._user.displayName || 'Rep',
          initials: initials,
          role: 'rep',
          companyId: 'default',
          createdAt: window.serverTimestamp()
        });
        state.currentRep = { userId: window._user.uid, name: window._user.displayName || 'Rep', initials, role: 'rep', companyId: 'default' };
      }
    } catch (e) {
      console.error('loadRepProfile failed:', e);
      state.currentRep = { userId: window._user.uid, name: window._user.displayName || 'Rep', companyId: 'default' };
    }
  }

  // Max knocks loaded per call. A rep doing 40/day for a full year is ~14k
  // docs — loading all of them at once blows mobile RAM and stalls the UI
  // for ~8–10s on cold start. 500 is ~12 active days for a heavy knocker,
  // which covers every practical feed filter (`today` / `week` / `month`).
  // `Load older knocks` button extends via a cursor query when needed.
  const KNOCK_PAGE_SIZE = 500;

  async function loadKnocks() {
    try {
      let q;
      // orderBy + limit require the composite index at
      // firestore.indexes.json:62 (userId + createdAt desc) which already
      // exists. Team-mode needs companyId + createdAt; if that index is
      // missing the query throws and the catch falls back gracefully.
      if (state.teamMode && state.currentRep?.role === 'manager') {
        q = window.query(
          window.collection(window._db, 'knocks'),
          window.where('companyId', '==', state.currentRep.companyId),
          window.orderBy('createdAt', 'desc'),
          window.limit(KNOCK_PAGE_SIZE)
        );
      } else {
        q = window.query(
          window.collection(window._db, 'knocks'),
          window.where('userId', '==', window._user.uid),
          window.orderBy('createdAt', 'desc'),
          window.limit(KNOCK_PAGE_SIZE)
        );
      }
      const snap = await window.getDocs(q);
      state.knocks = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          createdAt: toDate(data.createdAt) || new Date(0),
          updatedAt: toDate(data.updatedAt) || new Date(0),
          followUpDate: toDate(data.followUpDate) || null
        };
      }).sort((a, b) => b.createdAt - a.createdAt);

      // Rebuild derived data
      buildStreetSequences();
      calculateNeighborhoodScores();
      updateNavBadge();
    } catch (e) {
      console.error('loadKnocks failed:', e);
      // Common failure: composite index missing. Fall back to unbounded
      // query (old behavior) so the rep isn't stranded, but warn.
      if (String(e.message || '').toLowerCase().includes('index')) {
        console.warn('Knocks index missing — falling back to unbounded query. Deploy firestore.indexes.json.');
        try {
          const fallback = state.teamMode && state.currentRep?.role === 'manager'
            ? window.query(window.collection(window._db, 'knocks'), window.where('companyId', '==', state.currentRep.companyId))
            : window.query(window.collection(window._db, 'knocks'), window.where('userId', '==', window._user.uid));
          const snap2 = await window.getDocs(fallback);
          state.knocks = snap2.docs.map(d => {
            const data = d.data();
            return {
              id: d.id,
              ...data,
              createdAt: toDate(data.createdAt) || new Date(0),
              updatedAt: toDate(data.updatedAt) || new Date(0),
              followUpDate: toDate(data.followUpDate) || null
            };
          }).sort((a, b) => b.createdAt - a.createdAt);
          buildStreetSequences();
          calculateNeighborhoodScores();
          updateNavBadge();
          return;
        } catch (e2) { console.error('fallback loadKnocks also failed:', e2); }
      }
      window.showToast?.('Failed to load knocks', 'error');
    }
  }

  // Wrap a Firestore promise in a timeout so iOS Safari bfcache zombies
  // (where the SDK has a dead WebSocket but never rejects) surface as
  // an error the caller can handle instead of hanging the UI forever.
  function _withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(label + ' timeout after ' + ms + 'ms')), ms))
    ]);
  }

  async function submitKnock(data, fromSync) {
    if (!state.isOnline && !fromSync) {
      enqueueOffline('submitKnock', data);
      return null;
    }

    try {
      const attemptNumber = getAttemptCount(data.address) + 1;
      let disposition = data.disposition;

      if (attemptNumber > MAX_ATTEMPTS && disposition === 'not_home') {
        disposition = 'cold_dead';
        window.showToast?.('5 attempts reached — marked as Cold/Dead', 'warning');
      }

      let followUpDate = null;
      const fupInput = data.followUpDate;
      if (fupInput) {
        followUpDate = new Date(fupInput);
      } else {
        const autoDays = DISPOSITIONS[disposition]?.autoFollowUp;
        if (autoDays) {
          followUpDate = new Date();
          followUpDate.setDate(followUpDate.getDate() + autoDays);
        }
      }

      let stage = 'knock';
      if (disposition === 'appointment') stage = 'appointment';
      else if (INS_DISPOSITIONS.includes(disposition)) stage = 'insurance';

      const knockDoc = {
        userId: window._user.uid,
        repId: window._user.uid,
        companyId: state.currentRep?.companyId || 'default',
        address: data.address,
        lat: data.lat || null,
        lng: data.lng || null,
        homeowner: data.homeowner || '',
        phone: data.phone || '',
        email: data.email || '',
        disposition: disposition,
        notes: data.notes || '',
        stage: stage,
        attemptNumber: attemptNumber,
        createdAt: window.serverTimestamp(),
        updatedAt: window.serverTimestamp(),
        convertedToLead: false,
        estimateValue: data.estimateValue || 0,
        closedDealValue: data.closedDealValue || 0,
        insCarrier: data.insCarrier || '',
        claimNumber: data.claimNumber || '',
        photoUrls: data.photoUrls || [],
        voiceUrl: data.voiceUrl || '',
        followUpTime: data.followUpTime || ''
      };

      if (followUpDate) knockDoc.followUpDate = followUpDate;

      // 12s timeout — addDoc on a stale iOS bfcache connection never
      // resolves or rejects. Without this the Save button is stuck on
      // "Saving..." forever (handleSubmitKnock can't reach its finally).
      const ref = await _withTimeout(
        window.addDoc(window.collection(window._db, 'knocks'), knockDoc),
        12000,
        'addDoc(knocks)'
      );
      await loadKnocks();
      if (window.D2D && typeof window.D2D.renderD2D === 'function') window.D2D.renderD2D();
      refreshMapMarkers();
      window.showToast?.(`${DISPOSITIONS[disposition].icon} ${DISPOSITIONS[disposition].label} — ${data.address}`, 'success');

      // ── Auto-convert hot dispositions into CRM leads ──
      // Appointment/Interested/Storm Damage/Insurance dispositions auto-create
      // a CRM lead with pre-filled data + auto-assigned follow-up.
      // This fixes the D2D→CRM gap: D2D is the primary lead source but knocks
      // did not flow into the pipeline automatically.
      if (HOT_DISPOSITIONS.includes(disposition)) {
        // Non-blocking — don't fail the knock if lead creation has issues
        convertToLead(ref.id).catch(err => {
          console.warn('Auto-convert to lead failed:', err);
        });
      }
      return ref.id;
    } catch (e) {
      console.error('submitKnock failed:', e);
      window.showToast?.('Failed to save knock', 'error');
      return null;
    }
  }

  async function updateKnock(id, data) {
    try {
      await window.updateDoc(window.doc(window._db, 'knocks', id), {
        ...data,
        updatedAt: window.serverTimestamp()
      });
      await loadKnocks();
    } catch (e) {
      console.error('updateKnock failed:', e);
      window.showToast?.('Failed to update knock', 'error');
    }
  }

  async function deleteKnock(id) {
    if (!(await uiConfirm('Delete this knock?', { okLabel: 'Delete', danger: true }))) return;
    if (!state.isOnline) { enqueueOffline('deleteKnock', { id }); return; }
    try {
      await window.deleteDoc(window.doc(window._db, 'knocks', id));
      if (window.D2D && typeof window.D2D.closeKnockDetail === 'function') window.D2D.closeKnockDetail();
      await loadKnocks();
      if (window.D2D && typeof window.D2D.renderD2D === 'function') window.D2D.renderD2D();
      refreshMapMarkers();
      window.showToast?.('Knock deleted', 'info');
    } catch (e) {
      console.error('deleteKnock failed:', e);
      window.showToast?.('Failed to delete knock', 'error');
    }
  }

  async function convertToLead(knockId) {
    try {
      const knock = state.knocks.find(k => k.id === knockId);
      if (!knock || knock.convertedToLead) return;

      // ─── Cross-call double-convert guard ───
      // Hot dispositions auto-fire convertToLead from submitKnock(), and
      // 400 ms later showConversionPrompt opens with another button that
      // also calls convertToLead. The local `knocks` cache hasn't been
      // refreshed yet so both calls pass the `knock.convertedToLead`
      // check above. Result: two pipeline leads, two map pins, two
      // customer-ID counter increments per hot knock.
      //
      // Use a Firestore transaction on knocks/{id} to flip
      // convertedToLead atomically — only the FIRST call past the
      // transaction wins; the second sees convertedToLead:true and
      // bails before _saveLead runs again.
      if (typeof window.runTransaction === 'function' && window._db) {
        try {
          await window.runTransaction(window._db, async (tx) => {
            const knockRef = window.doc(window._db, 'knocks', knockId);
            const snap = await tx.get(knockRef);
            if (!snap.exists()) throw new Error('Knock not found');
            const cur = snap.data() || {};
            if (cur.convertedToLead) {
              // Another call already won — abort with a sentinel that
              // the outer catch translates into a quiet no-op.
              throw new Error('KNOCK_ALREADY_CONVERTED');
            }
            tx.update(knockRef, {
              convertedToLead: true,
              conversionStartedAt: window.serverTimestamp ? window.serverTimestamp() : new Date()
            });
          });
        } catch (txErr) {
          if (txErr && txErr.message === 'KNOCK_ALREADY_CONVERTED') {
            // The other call beat us. Refresh and quietly bail.
            try { await loadKnocks(); } catch (_) {}
            return;
          }
          // Any other transaction error — re-throw to outer catch.
          throw txErr;
        }
        // Reflect the lock in our local cache so subsequent renders
        // know this knock is converting and don't re-offer the prompt.
        knock.convertedToLead = true;
      }

      const firstName = (knock.homeowner || '').split(' ')[0] || 'D2D';
      const lastName = (knock.homeowner || '').split(' ').slice(1).join(' ') || 'Lead';

      // Map D2D disposition → CRM stage key (snake_case, matches crm-stages.js)
      let stage = 'new';
      if (knock.disposition === 'appointment') stage = 'inspected';
      else if (knock.disposition === 'interested') stage = 'contacted';
      else if (knock.disposition === 'callback') stage = 'contacted';
      else if (knock.disposition === 'left_material') stage = 'contacted';
      else if (INS_DISPOSITIONS.includes(knock.disposition)) stage = 'claim_filed';
      else if (knock.disposition === 'storm_damage') stage = 'contacted';

      // Map D2D disposition → CRM job type
      let jobType = '';
      if (INS_DISPOSITIONS.includes(knock.disposition)) jobType = 'insurance';

      // Map D2D disposition → claim status
      let claimStatus = 'No Claim';
      if (knock.disposition === 'ins_has_claim') claimStatus = 'Has Claim';
      else if (knock.disposition === 'ins_needs_file') claimStatus = 'Needs Filing';
      else if (knock.disposition === 'ins_denied') claimStatus = 'Denied';

      // Auto-assign follow-up date — use the knock's follow-up if set, otherwise
      // smart defaults per disposition (Interested: 2d, Appointment: 1d, Storm: 3d)
      let followUpStr = '';
      if (knock.followUpDate) {
        followUpStr = (typeof knock.followUpDate === 'object' && knock.followUpDate.toISOString
          ? knock.followUpDate.toISOString().split('T')[0]
          : String(knock.followUpDate));
      } else {
        const defaultDays = (
          knock.disposition === 'appointment' ? 1 :
          knock.disposition === 'interested' ? 2 :
          knock.disposition === 'storm_damage' ? 3 :
          INS_DISPOSITIONS.includes(knock.disposition) ? 2 : 0
        );
        if (defaultDays > 0) {
          const d = new Date();
          d.setDate(d.getDate() + defaultDays);
          followUpStr = d.toISOString().split('T')[0];
        }
      }

      // ─── Prospect segregation (April 2026) ───
      // Appointment dispositions become full customers immediately
      // (isProspect: false) because a set meeting is already a
      // qualified customer worth tracking in the kanban.
      // All other hot dispositions (interested, storm_damage, ins_*)
      // become PROSPECTS — they auto-create a lead record for data
      // integrity, but the lead is hidden from the kanban by default
      // until the user explicitly promotes it via the CRM lead detail
      // modal (Promote to Customer button).
      const isAppointment = knock.disposition === 'appointment';
      const leadData = {
        firstName,
        lastName,
        address: knock.address || '',
        phone: knock.phone || '',
        email: knock.email || '',
        stage,
        jobType,
        source: 'Door-to-Door',
        damageType: knock.disposition === 'storm_damage' ? 'Storm Damage' : '',
        insCarrier: knock.insCarrier || '',
        claimNumber: knock.claimNumber || '',
        claimStatus,
        notes: `D2D Knock #${knock.attemptNumber || 1}: ${DISPOSITIONS[knock.disposition]?.label || ''}${knock.notes ? '\n' + knock.notes : ''}`,
        d2dKnockId: knockId,
        lat: knock.lat || null,
        lng: knock.lng || null,
        // Carry photos from the knock onto the freshly-minted lead so
        // the rep doesn't lose the property/damage shots when the lead
        // is auto-created. The CRM card render pulls from this same
        // field, so they appear immediately on the kanban tile.
        photoUrls: Array.isArray(knock.photoUrls) ? knock.photoUrls.slice() : [],
        followUp: followUpStr,
        // Prospect flag: appointments land in the kanban immediately,
        // everything else waits for manual promotion.
        isProspect: !isAppointment
      };

      // Use _saveLead which also creates map pin and geocodes
      if (typeof window._saveLead === 'function') {
        await window._saveLead(leadData);
      } else {
        // Fallback: direct Firestore write. stageStartedAt anchors the
        // days-in-stage badge to actual lead-create time.
        await window.addDoc(window.collection(window._db, 'leads'), {
          ...leadData,
          userId: window._user.uid,
          createdAt: window.serverTimestamp(),
          stageStartedAt: window.serverTimestamp()
        });
        if (typeof window._loadLeads === 'function') await window._loadLeads();
      }

      await updateKnock(knockId, { convertedToLead: true });
      if (window.D2D && typeof window.D2D.closeKnockDetail === 'function') window.D2D.closeKnockDetail();
      if (window.D2D && typeof window.D2D.renderD2D === 'function') window.D2D.renderD2D();
      window.showToast?.('✅ Converted to CRM Lead — visible in your pipeline', 'success');
    } catch (e) {
      console.error('convertToLead failed:', e);
      window.showToast?.('Failed to convert to lead', 'error');
    }
  }

  // Quick-convert: open lead modal pre-filled from a knock (for manual editing before save)
  function convertToLeadWithEdit(knockId) {
    const knock = state.knocks.find(k => k.id === knockId);
    if (!knock) return;

    if (window.D2D && typeof window.D2D.closeKnockDetail === 'function') window.D2D.closeKnockDetail();

    // Open the CRM lead modal
    if (typeof openLeadModal === 'function') openLeadModal();
    else if (typeof window.openLeadModal === 'function') window.openLeadModal();
    else { document.getElementById('leadModal')?.classList.add('open'); }

    // Pre-fill fields from knock data
    setTimeout(() => {
      const firstName = (knock.homeowner || '').split(' ')[0] || '';
      const lastName = (knock.homeowner || '').split(' ').slice(1).join(' ') || '';

      const fill = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
      fill('lFname', firstName);
      fill('lLname', lastName);
      fill('lAddr', knock.address);
      fill('lPhone', knock.phone);
      fill('lEmail', knock.email);
      fill('lInsCarrier', knock.insCarrier);
      fill('lClaimNumber', knock.claimNumber);
      fill('lNotes', `D2D Knock: ${DISPOSITIONS[knock.disposition]?.label || ''}${knock.notes ? '\n' + knock.notes : ''}`);

      // Set source to Door-to-Door
      const sourceEl = document.getElementById('lSource');
      if (sourceEl) {
        const opt = Array.from(sourceEl.options).find(o => o.value.toLowerCase().includes('door'));
        if (opt) sourceEl.value = opt.value;
        else sourceEl.value = 'Door-to-Door';
      }

      // Set stage based on disposition. Values must match the lStage
      // <select> options in dashboard.html (snake_case stage keys —
      // see crm-stages.js). Previously assigned 'Inspection' /
      // 'Contacted' / 'New' which don't match any option, so the
      // select silently stayed on the placeholder.
      const stageEl = document.getElementById('lStage');
      if (stageEl) {
        if (knock.disposition === 'appointment') stageEl.value = 'inspected';
        else if (knock.disposition === 'interested') stageEl.value = 'contacted';
        else stageEl.value = 'new';
      }

      // Set job type for insurance dispositions
      if (INS_DISPOSITIONS.includes(knock.disposition)) {
        const jtEl = document.getElementById('lJobType');
        if (jtEl) jtEl.value = 'insurance';
      }

      // Mark knock as converted after modal is open (will be finalized on save)
      window._pendingD2DConvertId = knockId;
    }, 150);
  }

  async function loadTeamKnocks() {
    if (!state.teamMode || !state.currentRep) return;
    try {
      const q = window.query(window.collection(window._db, 'knocks'), window.where('companyId', '==', state.currentRep.companyId));
      const snap = await window.getDocs(q);
      state.teamKnocks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { console.error('loadTeamKnocks failed:', e); }
  }

  async function loadTerritories() {
    try {
      const q = window.query(window.collection(window._db, 'territories'), window.where('companyId', '==', state.currentRep?.companyId || 'default'));
      const snap = await window.getDocs(q);
      state.territories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { console.error('loadTerritories failed:', e); }
  }

  async function saveTerritory(data) {
    try {
      const territoryData = { ...data, companyId: state.currentRep?.companyId || 'default', userId: window._user.uid, updatedAt: window.serverTimestamp() };
      let id = data.id;
      if (id) {
        await window.updateDoc(window.doc(window._db, 'territories', id), territoryData);
      } else {
        const ref = await window.addDoc(window.collection(window._db, 'territories'), { ...territoryData, createdAt: window.serverTimestamp() });
        id = ref && ref.id;
      }
      await loadTerritories();
      return id || null;
    } catch (e) { console.error('saveTerritory failed:', e); return null; }
  }

  async function deleteTerritory(id) {
    if (!id) return false;
    try {
      await window.deleteDoc(window.doc(window._db, 'territories', id));
      state.territories = state.territories.filter(t => t.id !== id);
      return true;
    } catch (e) { console.error('deleteTerritory failed:', e); return false; }
  }

  // ============================================================================
  // NAV BADGE (follow-ups due)
  // ============================================================================
  function updateNavBadge() {
    const followUpsDue = state.knocks.filter(k => {
      const fup = toDate(k.followUpDate);
      return fup && fup <= new Date() && !k.convertedToLead;
    });
    const navEl = document.getElementById('nav-d2d');
    if (!navEl) return;
    let badge = navEl.querySelector('.d2d-badge');
    if (followUpsDue.length > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'd2d-badge';
        badge.style.cssText = 'position:absolute;top:4px;right:4px;background:var(--red, #E05252);color:white;font-size:9px;font-weight:700;padding:1px 5px;border-radius:10px;min-width:16px;text-align:center;';
        navEl.style.position = 'relative';
        navEl.appendChild(badge);
      }
      badge.textContent = followUpsDue.length;
    } else if (badge) {
      badge.remove();
    }
  }

  // ============================================================================
  // FILTERING
  // ============================================================================
  function applyFilters() {
    let filtered = state.knocks;
    if (state.filterDateRange === 'today') filtered = filtered.filter(k => isToday(k.createdAt));
    else if (state.filterDateRange === 'week') filtered = filtered.filter(k => isThisWeek(k.createdAt));
    else if (state.filterDateRange === 'month') filtered = filtered.filter(k => isThisMonth(k.createdAt));
    if (state.filterDispo) filtered = filtered.filter(k => k.disposition === state.filterDispo);
    return filtered;
  }

  // ============================================================================
  // METRICS
  // ============================================================================
  function getMetrics() {
    const today = state.knocks.filter(k => isToday(k.createdAt));
    const week = state.knocks.filter(k => isThisWeek(k.createdAt));
    const month = state.knocks.filter(k => isThisMonth(k.createdAt));
    const uniqueAddrs = new Set(state.knocks.map(k => normalizeAddress(k.address)));
    const appointments = state.knocks.filter(k => k.disposition === 'appointment');
    const appointmentsWeek = week.filter(k => k.disposition === 'appointment');
    const appointmentsToday = today.filter(k => k.disposition === 'appointment');
    const insuranceToday = today.filter(k => INS_DISPOSITIONS.includes(k.disposition));
    const conversations = state.knocks.filter(k => !['not_home', 'do_not_knock', 'cold_dead'].includes(k.disposition));
    const conversationsToday = today.filter(k => !['not_home', 'do_not_knock', 'cold_dead'].includes(k.disposition));

    let streak = 0;
    const checkDate = new Date();
    checkDate.setHours(0, 0, 0, 0);
    let found = true;
    while (found) {
      const dayStr = checkDate.toDateString();
      found = state.knocks.some(k => {
        const kd = toDate(k.createdAt) || new Date(0);
        return kd.toDateString() === dayStr;
      });
      if (found) { streak++; checkDate.setDate(checkDate.getDate() - 1); }
    }

    const followUpsDue = state.knocks.filter(k => {
      const fup = toDate(k.followUpDate);
      return fup && fup <= new Date() && !k.convertedToLead;
    });

    return {
      today: today.length,
      week: week.length,
      month: month.length,
      all: state.knocks.length,
      uniqueAddrs: uniqueAddrs.size,
      appointments: appointments.length,
      appointments_today: appointmentsToday.length,
      insurance_today: insuranceToday.length,
      conversations_today: conversationsToday.length,
      photos_today: today.filter(k => k.photoUrls?.length > 0).length,
      interested: state.knocks.filter(k => k.disposition === 'interested').length,
      stormDmg: state.knocks.filter(k => k.disposition === 'storm_damage').length,
      conversations: conversations.length,
      // Audit #16: prior formula divided all-time appointments by this-week
      // knocks, which could produce >100% conversion rates. Both sides of the
      // ratio are now week-bounded so the metric is interpretable.
      conversionRate: week.length > 0 ? Math.round(appointmentsWeek.length / week.length * 100) : 0,
      knocksPerAppt: appointmentsWeek.length > 0 ? Math.round(week.length / appointmentsWeek.length) : '—',
      followUpsDue,
      streak
    };
  }

  function getRevenueMetrics() {
    const doorsKnocked = new Set(state.knocks.map(k => normalizeAddress(k.address))).size;
    const conversations = state.knocks.filter(k => !['not_home', 'do_not_knock', 'cold_dead'].includes(k.disposition)).length;
    const appointments = state.knocks.filter(k => k.disposition === 'appointment').length;
    const estimates = state.knocks.filter(k => k.estimateValue > 0).length;
    const closed = state.knocks.filter(k => k.closedDealValue > 0).length;
    const revenue = state.knocks.reduce((sum, k) => sum + (k.closedDealValue || 0), 0);

    return {
      totalDoorsKnocked: doorsKnocked,
      totalConversations: conversations,
      totalAppointments: appointments,
      totalEstimates: estimates,
      totalClosed: closed,
      totalRevenue: revenue,
      revenuePerDoor: doorsKnocked > 0 ? Math.round(revenue / doorsKnocked) : 0,
      avgDealSize: closed > 0 ? Math.round(revenue / closed) : 0,
      conversionFunnel: { doors: doorsKnocked, conversations, appointments, estimates, closed }
    };
  }

  function getDispositionBreakdown() {
    const filtered = applyFilters();
    const breakdown = {};
    DISPO_ORDER.forEach(key => { breakdown[key] = 0; });
    filtered.forEach(k => { if (breakdown.hasOwnProperty(k.disposition)) breakdown[k.disposition]++; });
    return breakdown;
  }

  function getTimeOfDayStats() {
    const hourCounts = new Array(24).fill(0);
    const hourConversions = new Array(24).fill(0);
    const dayHour = {};
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    state.knocks.forEach(k => {
      const kdate = toDate(k.createdAt) || new Date(0);
      const hr = kdate.getHours();
      const day = kdate.getDay();
      hourCounts[hr]++;
      const key = `${day}-${hr}`;
      if (!dayHour[key]) dayHour[key] = { total: 0, conversions: 0 };
      dayHour[key].total++;
      if (['appointment', 'interested', 'storm_damage'].includes(k.disposition)) {
        hourConversions[hr]++;
        dayHour[key].conversions++;
      }
    });

    let bestStart = 0, bestCount = 0;
    for (let i = 8; i <= 19; i++) {
      const windowCount = (hourConversions[i] || 0) + (hourConversions[i + 1] || 0) + (hourConversions[i + 2] || 0);
      if (windowCount > bestCount) { bestCount = windowCount; bestStart = i; }
    }
    return { hourCounts, hourConversions, dayHour, days, bestWindow: { start: bestStart, end: bestStart + 3, conversions: bestCount } };
  }

  function getInsuranceMetrics() {
    const insKnocks = state.knocks.filter(k => INS_DISPOSITIONS.includes(k.disposition));
    const carrierMap = {};
    insKnocks.forEach(k => {
      const carrier = k.insCarrier || 'Unknown';
      if (!carrierMap[carrier]) carrierMap[carrier] = { total: 0, hasClaim: 0, needsFiling: 0, denied: 0 };
      carrierMap[carrier].total++;
      if (k.disposition === 'ins_has_claim') carrierMap[carrier].hasClaim++;
      if (k.disposition === 'ins_needs_file') carrierMap[carrier].needsFiling++;
      if (k.disposition === 'ins_denied') carrierMap[carrier].denied++;
    });
    return { total: insKnocks.length, carriers: carrierMap };
  }

  // ============================================================================
  // GAMIFICATION
  // ============================================================================
  function getGamificationData() {
    const metrics = getMetrics();
    const revenue = getRevenueMetrics();

    // Daily challenges
    const challenges = DAILY_CHALLENGES.map(ch => {
      let current = 0;
      if (ch.metric === 'today') current = metrics.today;
      else if (ch.metric === 'appointments_today') current = metrics.appointments_today;
      else if (ch.metric === 'insurance_today') current = metrics.insurance_today;
      else if (ch.metric === 'conversations_today') current = metrics.conversations_today;
      else if (ch.metric === 'photos_today') current = metrics.photos_today;
      return { ...ch, current, pct: Math.min(Math.round(current / ch.target * 100), 100), complete: current >= ch.target };
    });

    // Streak milestone
    const currentMilestone = STREAK_MILESTONES.filter(m => metrics.streak >= m.days).pop();
    const nextMilestone = STREAK_MILESTONES.find(m => metrics.streak < m.days);

    // Commission projection (based on avg deal size and conversion rate)
    const daysLeft = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() - new Date().getDate();
    const avgKnocksPerDay = metrics.month > 0 ? metrics.month / new Date().getDate() : metrics.today || 0;
    const projectedKnocks = metrics.month + (avgKnocksPerDay * daysLeft);
    const projectedAppts = metrics.conversionRate > 0 ? Math.round(projectedKnocks * metrics.conversionRate / 100) : 0;
    const projectedRevenue = projectedAppts * (revenue.avgDealSize || 8500);

    return {
      challenges,
      streak: metrics.streak,
      currentMilestone,
      nextMilestone,
      projectedKnocks: Math.round(projectedKnocks),
      projectedAppts,
      projectedRevenue,
      completedChallenges: challenges.filter(c => c.complete).length,
      totalChallenges: challenges.length
    };
  }

  // ============================================================================
  // MAP INITIALIZATION
  // ============================================================================
  function initD2DMap() {
    const mapEl = document.getElementById('d2dMap');
    if (!mapEl) return;

    if (state.d2dMap) { state.d2dMap.invalidateSize(); return; }

    // Leaflet loads asynchronously from CDN. If it hasn't arrived yet,
    // show a soft placeholder and retry once — covers the case where the
    // CDN is slow but not down. If L is genuinely unavailable (blocked,
    // offline, etc.) the D2D feed/stats still work; only the map is
    // affected.
    if (typeof L === 'undefined') {
      mapEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--m,#9ca3af);font-size:13px;gap:8px;">⏳ Loading map…</div>';
      setTimeout(() => { if (typeof L !== 'undefined') { mapEl.innerHTML = ''; initD2DMap(); } else { mapEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--m,#9ca3af);font-size:13px;">🗺️ Map unavailable — check connection</div>'; } }, 3000);
      return;
    }

    // Leaflet 1.9+ fixed the iOS standalone ghost-click bug, so we
    // no longer need to disable the tap handler. Re-enabled for full
    // touch interactivity in both browser and PWA modes.
    const isStandalone = window.navigator.standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches;

    state.d2dMap = L.map('d2dMap', {
      tap: true,                    // re-enabled — Leaflet 1.9 fixed iOS tap bug
      bounceAtZoomLimits: false     // smoother UX on iOS
    }).setView(CINCINNATI, 13);

    const sat = L.tileLayer(SAT_TILES_PRIMARY, {
      subdomains: '0123',
      attribution: 'Imagery © Google',
      maxNativeZoom: 22,
      maxZoom: 23
    });
    // Per-tile fallback to Esri if Google returns an error for a given
    // tile. Mirrors the Maps view pattern (maps-core.js initMainMap).
    // The dataset guard ensures we only retry once — if the fallback
    // ALSO fails, Leaflet renders nothing for that tile rather than
    // looping forever.
    sat.on('tileerror', function (ev) {
      if (!ev.tile || !ev.coords || ev.tile.dataset.nbdFallbackTried === '1') return;
      ev.tile.dataset.nbdFallbackTried = '1';
      const c = ev.coords;
      ev.tile.src = SAT_TILES_FALLBACK
        .replace('{z}', c.z).replace('{x}', c.x).replace('{y}', c.y);
    });
    sat.addTo(state.d2dMap);

    // Force map to recalculate size after standalone viewport settles
    if (isStandalone) {
      setTimeout(() => { if (state.d2dMap) state.d2dMap.invalidateSize(); }, 500);
      setTimeout(() => { if (state.d2dMap) state.d2dMap.invalidateSize(); }, 1500);
    }

    state.d2dCluster = L.markerClusterGroup({ maxClusterRadius: 40, disableClusteringAtZoom: 17 });
    state.d2dMap.addLayer(state.d2dCluster);

    state.d2dMap.on('click', function(e) {
      if (window.D2D && typeof window.D2D.openQuickKnock === 'function') {
        window.D2D.openQuickKnock({ lat: e.latlng.lat, lng: e.latlng.lng });
      }
    });

    watchLocationAndCenter();
    refreshMapMarkers();
    createLayerPanel();
  }

  // Tracks whether we've surfaced a GPS-denial/error toast this session —
  // suppresses a stream of identical toasts when watchPosition emits repeatedly.
  let _gpsErrorNotified = false;

  function watchLocationAndCenter() {
    if (!navigator.geolocation) {
      // Audit #15: was a silent return. Now give the rep a clear explanation
      // so they know why the blue-dot location marker isn't appearing.
      window.showToast?.('GPS not available on this device. D2D map will still work, but your location won\'t auto-track.', 'warning', 6000);
      return;
    }
    // Require HTTPS for geolocation — iOS Safari silently denies on http://
    if (typeof window !== 'undefined' && window.location && window.location.protocol === 'http:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      window.showToast?.('GPS requires HTTPS. Open this site via https:// to enable location tracking.', 'warning', 6000);
      return;
    }
    // Defensive: clear any prior watch before opening a new one. Without
    // this, a route that re-enters D2D (e.g. tab switch + return) leaks
    // multiple GPS subscribers, each draining battery.
    stopLocationWatch();
    state.watchId = navigator.geolocation.watchPosition(
      function(pos) {
        _gpsErrorNotified = false; // clear on first successful fix
        state.currentLocation = [pos.coords.latitude, pos.coords.longitude];
        if (state.locationMarker) state.d2dMap.removeLayer(state.locationMarker);
        if (state.accuracyCircle) state.d2dMap.removeLayer(state.accuracyCircle);

        state.accuracyCircle = L.circle(state.currentLocation, { radius: pos.coords.accuracy, color: '#4A9EFF', fillColor: '#4A9EFF', fillOpacity: 0.1, weight: 1 }).addTo(state.d2dMap);
        state.locationMarker = L.circleMarker(state.currentLocation, { radius: 8, color: '#ffffff', weight: 3, fillColor: '#4A9EFF', fillOpacity: 1, className: 'd2d-location-pulse' }).addTo(state.d2dMap);
      },
      function(err) {
        console.warn('Geolocation error:', err);
        if (_gpsErrorNotified) return; // only surface once per session
        _gpsErrorNotified = true;
        // err.code: 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
        let msg;
        if (err && err.code === 1) {
          msg = 'Location permission denied. Enable it in Settings → Safari → Location to track knocks on the map.';
        } else if (err && err.code === 2) {
          msg = 'Can\'t determine your location right now. Try moving to an area with a clearer sky view.';
        } else if (err && err.code === 3) {
          msg = 'GPS is slow to respond. You can still tap the map to log knocks manually.';
        } else {
          msg = 'GPS is unavailable. Tap on the map to log knocks manually.';
        }
        window.showToast?.(msg, 'warning', 7000);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }

  // Audit findings #3 + #12: the GPS watch was never released. Safari
  // throttles aggressively in background but does NOT auto-cancel a
  // watchPosition() handle on tab hide — battery drain on iPhone D2D
  // sessions was severe (60-min session ≈ 30% battery). Three exit
  // paths now stop the watch:
  //   (a) explicit stopLocationWatch() called from D2D teardown
  //   (b) page visibility change → hidden  → stop; visible → restart
  //   (c) beforeunload / pagehide → stop unconditionally
  // Resume on visibility-restore is conditional on the map still being
  // mounted; D2D module unload paths leave d2dMap === null which short-
  // circuits the resume.
  function stopLocationWatch() {
    if (state.watchId !== null && navigator.geolocation) {
      try { navigator.geolocation.clearWatch(state.watchId); } catch (_) {}
      state.watchId = null;
    }
    if (state.locationMarker && state.d2dMap) { try { state.d2dMap.removeLayer(state.locationMarker); } catch (_) {} state.locationMarker = null; }
    if (state.accuracyCircle && state.d2dMap) { try { state.d2dMap.removeLayer(state.accuracyCircle); } catch (_) {} state.accuracyCircle = null; }
  }
  if (typeof document !== 'undefined' && !document._nbdD2DGeoLifecycle) {
    document._nbdD2DGeoLifecycle = true;
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        stopLocationWatch();
      } else if (document.visibilityState === 'visible' && state.d2dMap && state.d2dInited) {
        watchLocationAndCenter();
      }
    });
    // pagehide is the only event that fires reliably across Safari
    // back/forward cache + iOS PWA tab close. beforeunload doesn't
    // fire in iOS Safari standalone.
    window.addEventListener('pagehide', stopLocationWatch);
  }

  function centerOnMe() {
    if (state.currentLocation && state.d2dMap) {
      state.d2dMap.setView(state.currentLocation, 16);
      window.showToast?.('Centered on your location', 'info');
    }
  }

  function refreshMapMarkers() {
    if (!state.d2dMap || !state.d2dCluster) return;
    state.d2dCluster.clearLayers();
    if (state.d2dHeat) state.d2dMap.removeLayer(state.d2dHeat);

    // Audit #18 (same class of bug): Timestamp > Timestamp is NaN > NaN.
    // Normalize both sides through toDate() so the map pins reflect the most
    // recent disposition per address instead of the first-seen one.
    const addrMap = new Map();
    state.knocks.forEach(k => {
      const norm = normalizeAddress(k.address);
      const existing = addrMap.get(norm);
      const kMs = (toDate(k.createdAt) || new Date(0)).getTime();
      const eMs = existing ? (toDate(existing.createdAt) || new Date(0)).getTime() : -Infinity;
      if (!existing || kMs > eMs) {
        addrMap.set(norm, k);
      }
    });

    const heatData = [];
    addrMap.forEach(knock => {
      if (!knock.lat || !knock.lng) return;
      const dispo = DISPOSITIONS[knock.disposition];
      const attempts = getAttemptCount(knock.address);
      const label = document.createElement('div');
      label.style.cssText = `background:${dispo?.color || '#666'};width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:bold;border:2px solid white;`;
      label.textContent = dispo?.short || '?';

      const icon = L.divIcon({ html: label.outerHTML, iconSize: [30, 30], className: '' });

      // Build popup with data-attributes + touchend listeners instead of inline onclick
      // (iOS Safari standalone swallows inline onclick in Leaflet popups)
      const popupDiv = document.createElement('div');
      popupDiv.style.cssText = 'font-size:12px;';
      popupDiv.innerHTML = `<strong>${esc(knock.address)}</strong><br/>${dispo?.icon} ${dispo?.label}<br/>Knock #${attempts}/${MAX_ATTEMPTS}<br/><small>${timeAgo(knock.createdAt)}</small><br/>`;

      const detailBtn = document.createElement('button');
      detailBtn.textContent = 'Details';
      detailBtn.style.cssText = 'margin-top:8px;padding:4px 8px;background:var(--blue, #4A9EFF);color:white;border:none;border-radius:3px;cursor:pointer;font-size:11px;';
      detailBtn.addEventListener('click', function(ev) { ev.stopPropagation(); window.D2D.openKnockDetail(knock.id); });
      detailBtn.addEventListener('touchend', function(ev) { ev.stopPropagation(); ev.preventDefault(); window.D2D.openKnockDetail(knock.id); });

      const reknockBtn = document.createElement('button');
      reknockBtn.textContent = 'Re-Knock';
      reknockBtn.style.cssText = 'margin-top:8px;margin-left:4px;padding:4px 8px;background:var(--orange, #e8720c);color:white;border:none;border-radius:3px;cursor:pointer;font-size:11px;';
      reknockBtn.addEventListener('click', function(ev) { ev.stopPropagation(); window.D2D.openQuickKnock({address:knock.address, lat:knock.lat, lng:knock.lng}); });
      reknockBtn.addEventListener('touchend', function(ev) { ev.stopPropagation(); ev.preventDefault(); window.D2D.openQuickKnock({address:knock.address, lat:knock.lat, lng:knock.lng}); });

      popupDiv.appendChild(detailBtn);
      popupDiv.appendChild(reknockBtn);

      const marker = L.marker([knock.lat, knock.lng], { icon }).bindPopup(popupDiv);
      state.d2dCluster.addLayer(marker);
      heatData.push([knock.lat, knock.lng, 0.5]);
    });

    if (state.showHeat && heatData.length > 0) {
      state.d2dHeat = L.heatLayer(heatData, { radius: 30, blur: 20, maxZoom: 17 }).addTo(state.d2dMap);
    }

    // Draw neighborhood score overlay
    if (Object.keys(state.neighborhoodScores).length > 0) {
      Object.values(state.neighborhoodScores).forEach(n => {
        if (n.score > 30 && n.knocks.length >= 3) {
          const scoreColor = n.score >= 70 ? '#2ECC8A' : n.score >= 40 ? '#EAB308' : '#E05252';
          L.circle([n.lat, n.lng], { radius: 250, color: scoreColor, fillColor: scoreColor, fillOpacity: 0.08, weight: 1 }).addTo(state.d2dMap).bindPopup(`<b>Neighborhood Score: ${n.score}/100</b><br>${n.knocks.length} knocks · ${n.appointments} apts · ${n.stormDmg} storm dmg`);
        }
      });
    }
  }

  function toggleHeatMap() {
    state.showHeat = !state.showHeat;
    refreshMapMarkers();
    window.showToast?.(state.showHeat ? 'Heat map enabled' : 'Heat map disabled', 'info');
    updateLayerPanel();
  }

  // ════════════════════════════════════════════════════════════
  // FLOATING LAYER TOGGLE PANEL (April 2026)
  //
  // A small panel that floats over the D2D map. Each toggle
  // controls a visual layer: Knocks, Jobs, Weather, Heatmap.
  // This replaces the separate Maps & Pins view — all map
  // features are now consolidated into D2D.
  //
  // Layers:
  //   Knocks  — the default knock markers (disposition circles)
  //   Jobs    — active CRM leads with $ value labels (green/blue)
  //   Weather — NOAA NEXRAD radar overlay
  //   Heat    — knock density heatmap
  // ════════════════════════════════════════════════════════════
  let d2dLayerState = { knocks: true, jobs: false, weather: false, heat: false, territory: false };
  let d2dJobMarkers = [];
  let d2dStormLayer = null;
  let d2dWeatherLayer = null;
  let d2dDrawControl = null;
  let d2dTerritoryGroup = null;  // L.featureGroup holding drawn polygons

  function createLayerPanel() {
    if (!state.d2dMap) return;
    // Don't re-create if it already exists
    if (document.getElementById('d2d-layer-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'd2d-layer-panel';
    panel.style.cssText = 'position:absolute;top:10px;right:10px;z-index:1000;'
      + 'background:rgba(10,12,15,.92);border:1px solid color-mix(in srgb, var(--orange) 30%, transparent);'
      + 'border-radius:10px;padding:8px;display:flex;gap:4px;'
      + '-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);'
      + 'box-shadow:0 4px 20px rgba(0,0,0,.5);';

    const layers = [
      { key: 'knocks',    icon: '📍', label: 'Knocks' },
      { key: 'jobs',      icon: '💰', label: 'Jobs' },
      { key: 'weather',   icon: '⛈️', label: 'Radar' },
      { key: 'heat',      icon: '🔥', label: 'Heat' },
      { key: 'territory', icon: '🗺️', label: 'Zone' }
    ];

    layers.forEach(ly => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'd2d-layer-' + ly.key;
      btn.title = ly.label;
      btn.style.cssText = 'background:' + (d2dLayerState[ly.key] ? 'color-mix(in srgb, var(--orange) 20%, transparent)' : 'transparent') + ';'
        + 'border:1px solid ' + (d2dLayerState[ly.key] ? '#e8720c' : 'rgba(255,255,255,.12)') + ';'
        + 'color:' + (d2dLayerState[ly.key] ? '#fff' : '#8b8e96') + ';'
        + 'padding:6px 10px;border-radius:6px;cursor:pointer;'
        + "font-family:'Barlow Condensed',sans-serif;font-size:11px;"
        + 'font-weight:700;letter-spacing:.04em;display:flex;align-items:center;'
        + 'gap:4px;transition:all .15s;-webkit-tap-highlight-color:transparent;'
        + 'min-height:36px;';
      btn.innerHTML = ly.icon + ' ' + ly.label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleLayer(ly.key);
      });
      panel.appendChild(btn);
    });

    // Append to the map container (not the map tiles) so it floats above
    const mapEl = document.getElementById('d2dMap');
    if (mapEl) {
      mapEl.style.position = 'relative';
      mapEl.appendChild(panel);
    }
  }

  function updateLayerPanel() {
    Object.keys(d2dLayerState).forEach(key => {
      const btn = document.getElementById('d2d-layer-' + key);
      if (!btn) return;
      const on = d2dLayerState[key];
      btn.style.background = on ? 'color-mix(in srgb, var(--orange) 20%, transparent)' : 'transparent';
      btn.style.borderColor = on ? '#e8720c' : 'rgba(255,255,255,.12)';
      btn.style.color = on ? '#fff' : '#8b8e96';
    });
  }

  function toggleLayer(key) {
    d2dLayerState[key] = !d2dLayerState[key];
    switch (key) {
      case 'knocks':
        if (d2dLayerState.knocks) {
          state.d2dMap.addLayer(state.d2dCluster);
        } else {
          state.d2dMap.removeLayer(state.d2dCluster);
        }
        break;
      case 'jobs':
        if (d2dLayerState.jobs) {
          buildD2DJobsLayer();
        } else {
          d2dJobMarkers.forEach(m => state.d2dMap.removeLayer(m));
        }
        break;
      case 'weather':
        if (d2dLayerState.weather) {
          showD2DWeatherLayer();
        } else {
          if (d2dStormLayer) state.d2dMap.removeLayer(d2dStormLayer);
          if (d2dWeatherLayer) state.d2dMap.removeLayer(d2dWeatherLayer);
        }
        break;
      case 'heat':
        state.showHeat = d2dLayerState.heat;
        refreshMapMarkers();
        break;
      case 'territory':
        if (d2dLayerState.territory) {
          showTerritoryDrawing();
        } else {
          hideTerritoryDrawing();
        }
        break;
    }
    updateLayerPanel();
    window.showToast?.((d2dLayerState[key] ? 'Showing ' : 'Hiding ') + key, 'info');
  }

  // ── Jobs layer (ported from maps.js) ──
  // Shows active CRM leads as markers with $ value labels.
  // Uses lead lat/lng directly if available (from D2D knock
  // auto-convert or manual entry), falling back to Nominatim
  // geocoding for leads that only have an address string.
  //
  // Audit #20: Nominatim fair-use policy is ≥1 request/second. The prior
  // 200ms sleep was 5× over the rate limit and would eventually get the
  // app IP-banned. We now: (1) share a long-lived cache keyed on address
  // so repeated toggles don't re-geocode, (2) sleep 1100ms between live
  // requests, (3) cap a single build at 15 live geocodes to avoid pinning
  // the user on one operation for 20+ seconds.
  const D2D_GEOCODE_CACHE = new Map(); // addr → { lat, lng } | null
  const D2D_GEOCODE_PER_BUILD_CAP = 15;

  async function buildD2DJobsLayer() {
    if (!state.d2dMap) return;
    d2dJobMarkers.forEach(m => state.d2dMap.removeLayer(m));
    d2dJobMarkers = [];

    const leads = window._leads || [];
    const JOB_STAGES = new Set([
      'contract_signed', 'job_created', 'permit_pulled', 'materials_ordered',
      'materials_delivered', 'crew_scheduled', 'install_in_progress',
      'install_complete', 'final_photos', 'deductible_collected',
      'final_payment', 'closed', 'In Progress', 'Complete', 'Finalizing'
    ]);
    const active = leads.filter(l => {
      const sk = l._stageKey || l.stage || '';
      return JOB_STAGES.has(sk);
    });

    let liveRequests = 0;
    let skippedDueToCap = 0;
    for (const lead of active) {
      let lat = Number(lead.lat);
      let lng = Number(lead.lng);
      // If no coords, try Nominatim geocoding (cache-first, rate-limited)
      if (!lat || !lng) {
        const addr = (lead.address || '').trim();
        if (!addr) continue;
        const cacheKey = addr.toLowerCase();
        if (D2D_GEOCODE_CACHE.has(cacheKey)) {
          const hit = D2D_GEOCODE_CACHE.get(cacheKey);
          if (!hit) continue;
          lat = hit.lat; lng = hit.lng;
        } else {
          if (liveRequests >= D2D_GEOCODE_PER_BUILD_CAP) { skippedDueToCap++; continue; }
          try {
            const res = await fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(addr) + '&limit=1',
              { headers: { 'Accept': 'application/json' } });
            const data = await res.json();
            if (data && data[0]) {
              lat = parseFloat(data[0].lat); lng = parseFloat(data[0].lon);
              D2D_GEOCODE_CACHE.set(cacheKey, { lat, lng });
            } else {
              D2D_GEOCODE_CACHE.set(cacheKey, null);
            }
            liveRequests++;
            await new Promise(r => setTimeout(r, 1100)); // Nominatim fair-use ≥ 1 req/s
          } catch (e) { continue; }
        }
      }
      if (!lat || !lng) continue;

      const val = parseFloat(lead.jobValue || lead.contractValue || lead.value || 0);
      const label = val > 0 ? '$' + val.toLocaleString() : (lead.stage || 'Job');
      const stageLower = (lead._stageKey || lead.stage || '').toLowerCase();
      const color = stageLower.includes('complete') || stageLower === 'closed' ? '#34D399'
        : stageLower.includes('install') ? '#4A9EFF' : '#EAB308';
      const name = esc([lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.address || 'Lead');

      const icon = L.divIcon({
        html: '<div style="background:' + color + ';color:#0A0C0F;font-family:\'Barlow Condensed\',sans-serif;font-size:11px;font-weight:800;padding:3px 7px;border-radius:5px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.2);">💰 ' + label + '</div>',
        iconAnchor: [0, 0], className: ''
      });
      const marker = L.marker([lat, lng], { icon })
        .bindPopup('<div style="font-family:sans-serif;min-width:160px;">'
          + '<b style="font-size:13px;color:' + color + ';">' + name + '</b>'
          + '<p style="font-size:11px;color:#666;margin:4px 0;">' + esc(lead.address || '') + '</p>'
          + '<p style="font-size:11px;margin:2px 0;"><b>Stage:</b> ' + esc(lead.stage || '') + '</p>'
          + (val > 0 ? '<p style="font-size:12px;font-weight:700;color:' + color + ';">$' + val.toLocaleString() + '</p>' : '')
          + '</div>');
      d2dJobMarkers.push(marker);
      marker.addTo(state.d2dMap);
    }
    if (d2dJobMarkers.length === 0) {
      window.showToast?.('No active jobs with locations to display', 'info');
    } else if (skippedDueToCap > 0) {
      window.showToast?.(`${skippedDueToCap} job${skippedDueToCap > 1 ? 's' : ''} skipped — address lookup limit reached. Toggle the layer again to load more.`, 'info', 5000);
    }
  }

  // ── Weather layer (ported from maps.js) ──
  // NOAA NEXRAD radar composite + RainViewer precipitation
  function showD2DWeatherLayer() {
    if (!state.d2dMap) return;
    if (!d2dStormLayer) {
      d2dStormLayer = L.tileLayer(
        'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png',
        { opacity: 0.6, attribution: 'NOAA/IEM', maxZoom: 20, tms: false }
      );
    }
    d2dStormLayer.addTo(state.d2dMap);
    // RainViewer layer
    if (!d2dWeatherLayer) {
      const now = Math.floor(Date.now() / 600000) * 600;
      d2dWeatherLayer = L.tileLayer(
        'https://tilecache.rainviewer.com/v2/radar/' + now + '/256/{z}/{x}/{y}/2/1_1.png',
        { opacity: 0.45, attribution: 'RainViewer', maxZoom: 20 }
      );
    }
    d2dWeatherLayer.addTo(state.d2dMap);
    window.showToast?.('Storm radar + precipitation loaded', 'info');
  }

  // ── Territory drawing (Leaflet.Draw) ──
  // Lets the user draw polygons on the map to define "zones" (territories).
  // Saved polygons persist to the Firestore 'territories' collection via
  // the existing saveTerritory() function that was already in the codebase.
  // Drawn polygons are orange-outlined so they're visually distinct from
  // knock markers and job overlays.
  function showTerritoryDrawing() {
    if (!state.d2dMap) return;
    if (typeof L.Draw === 'undefined') {
      window.showToast?.('Drawing library not loaded — refresh and try again', 'error');
      return;
    }

    // Create the feature group that holds drawn shapes
    if (!d2dTerritoryGroup) {
      d2dTerritoryGroup = new L.FeatureGroup();
      state.d2dMap.addLayer(d2dTerritoryGroup);
    }

    // Load existing territories from Firestore and render them
    renderSavedTerritories();

    // Add the Leaflet.Draw control if not already present
    if (!d2dDrawControl) {
      d2dDrawControl = new L.Control.Draw({
        position: 'topright',
        draw: {
          polygon: {
            allowIntersection: false,
            shapeOptions: {
              color: '#e8720c',
              weight: 3,
              fillColor: '#e8720c',
              fillOpacity: 0.08
            }
          },
          rectangle: {
            shapeOptions: {
              color: '#e8720c',
              weight: 3,
              fillColor: '#e8720c',
              fillOpacity: 0.08
            }
          },
          // Disable non-polygon shapes — territories are areas
          polyline: false,
          circle: false,
          circlemarker: false,
          marker: false
        },
        edit: {
          featureGroup: d2dTerritoryGroup,
          remove: true
        }
      });
      state.d2dMap.addControl(d2dDrawControl);

      // Listen for new shapes drawn
      state.d2dMap.on(L.Draw.Event.CREATED, async function (e) {
        const layer = e.layer;
        d2dTerritoryGroup.addLayer(layer);

        // Prompt for a name (iOS-safe modal — native prompt() is blocked in iOS PWA)
        const name = await uiPrompt('Name this territory zone:', 'Zone ' + (state.territories.length + 1), { okLabel: 'Save Zone' });
        if (!name) {
          d2dTerritoryGroup.removeLayer(layer);
          return;
        }

        // Extract GeoJSON coordinates for Firestore storage
        const geoJSON = layer.toGeoJSON();
        const newId = await saveTerritory({
          name: name.trim().substring(0, 80),
          type: e.layerType,
          geoJSON: geoJSON,
          bounds: layer.getBounds ? {
            north: layer.getBounds().getNorth(),
            south: layer.getBounds().getSouth(),
            east: layer.getBounds().getEast(),
            west: layer.getBounds().getWest()
          } : null
        });
        // Audit #19: tag the layer with its Firestore doc id so the DELETED
        // handler can actually remove it from the backend — previously the
        // save returned no id and deletions only cleared the map client-side.
        if (newId) layer._nbdTerritoryId = newId;
        window.showToast?.('✓ Territory "' + name + '" saved', 'success');

        // Add label to the polygon
        addTerritoryLabel(layer, name);
      });

      // Listen for deleted shapes
      state.d2dMap.on(L.Draw.Event.DELETED, async function (e) {
        // Audit #19: actually delete from Firestore now that each layer has a
        // _nbdTerritoryId tag (assigned on create and on render of saved docs).
        const ids = [];
        try {
          e.layers.eachLayer(function (l) { if (l && l._nbdTerritoryId) ids.push(l._nbdTerritoryId); });
        } catch (_) {}
        if (ids.length === 0) {
          window.showToast?.('Territory removed from map (no saved copy to delete)', 'info');
          return;
        }
        const results = await Promise.all(ids.map(id => deleteTerritory(id)));
        const ok = results.filter(Boolean).length;
        if (ok === ids.length) window.showToast?.(`✓ ${ok} territory zone${ok > 1 ? 's' : ''} deleted`, 'success');
        else window.showToast?.(`Deleted ${ok}/${ids.length} — some zones may still exist on the server`, 'warning');
      });
    }

    window.showToast?.('Draw a polygon to define your territory zone', 'info');
  }

  function hideTerritoryDrawing() {
    if (d2dDrawControl && state.d2dMap) {
      state.d2dMap.removeControl(d2dDrawControl);
      d2dDrawControl = null;
    }
    if (d2dTerritoryGroup && state.d2dMap) {
      state.d2dMap.removeLayer(d2dTerritoryGroup);
      d2dTerritoryGroup = null;
    }
  }

  // Render previously saved territories from Firestore
  async function renderSavedTerritories() {
    if (!state.d2dMap || !d2dTerritoryGroup) return;
    // Load if not already loaded
    if (state.territories.length === 0) await loadTerritories();

    state.territories.forEach(t => {
      if (!t.geoJSON) return;
      try {
        const layer = L.geoJSON(t.geoJSON, {
          style: {
            color: '#e8720c',
            weight: 2,
            fillColor: '#e8720c',
            fillOpacity: 0.06,
            dashArray: '6,4'
          }
        });
        layer.addTo(d2dTerritoryGroup);
        // Audit #19: tag every sub-layer with the Firestore doc id so delete
        // events know which docs to remove server-side.
        layer.eachLayer(function (l) { l._nbdTerritoryId = t.id; });
        // Add a label tooltip with the territory name
        layer.eachLayer(function (l) {
          if (l.getBounds) {
            addTerritoryLabel(l, t.name || 'Zone');
          }
        });
      } catch (e) {
        console.warn('Failed to render territory:', t.name, e.message);
      }
    });
  }

  // Add a text label at the center of a territory polygon
  function addTerritoryLabel(layer, name) {
    if (!layer.getBounds) return;
    const center = layer.getBounds().getCenter();
    const label = L.divIcon({
      html: '<div style="background:color-mix(in srgb, var(--orange) 85%, transparent);color:#fff;font-family:\'Barlow Condensed\',sans-serif;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;white-space:nowrap;letter-spacing:.04em;text-transform:uppercase;">' + esc(name) + '</div>',
      className: '',
      iconAnchor: [0, 0]
    });
    L.marker(center, { icon: label, interactive: false }).addTo(d2dTerritoryGroup);
  }

  // ============================================================================
  // PHOTO + VOICE UPLOAD HELPERS (Firebase Storage)
  // ----------------------------------------------------------------------------
  // These are pure-upload helpers (no DOM). The capture/record UI lives in the
  // UI module and calls back into these helpers from handleSubmitKnock.
  // ============================================================================

  // Derive a Firebase-Storage-rule-acceptable contentType from a File.
  // Safari iPhone leaves File.type as the empty string for HEIC/HEIF
  // pulled from the photo library in some configurations — uploadBytes
  // with no contentType then either lets Storage guess (which it does
  // poorly) or sends `application/octet-stream`, both of which the
  // storage.rules:29 isImage() regex rejects with an opaque 403.
  // Map by lowercase extension to one of the rule's accepted MIMEs.
  // Returns null when the extension isn't an allowed image type, so
  // the caller can surface a clear "unsupported format" error rather
  // than letting the upload fail silently with 403.
  function inferImageContentType(file) {
    const declared = (file && file.type || '').toLowerCase().trim();
    // image/* declared types are accepted as-is provided they're in
    // the rules' allowlist. Lowercase normalize handles browsers that
    // ship "Image/JPEG" or similar.
    if (/^image\/(jpeg|jpg|png|webp|heic|heif|avif|gif)$/.test(declared)) {
      // Storage rules allowlist uses 'jpeg' canonical; 'jpg' is the
      // same byte stream so coerce the alias.
      return declared === 'image/jpg' ? 'image/jpeg' : declared;
    }
    const name = String(file && file.name || '').toLowerCase();
    const ext = name.split('.').pop() || '';
    const map = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
      avif: 'image/avif', gif: 'image/gif'
    };
    return map[ext] || null;
  }

  async function uploadPhotos(files, knockId) {
    if (!files || !files.length) return [];
    const urls = [];
    // Storage rules only permit photos under `photos/{uid}/...`.
    // Route door-knock photos through `photos/{uid}/d2d/{knockId}/...`
    // so they inherit the existing photos rule instead of hitting
    // the default-deny that d2d_photos/{uid}/... falls under.
    const { ref, getDownloadURL } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js');
    const uid = window._user && window._user.uid;
    if (!uid) {
      console.error('d2d photo upload: not signed in');
      return [];
    }
    let rejected = 0;
    for (const file of files) {
      try {
        const contentType = inferImageContentType(file);
        if (!contentType) {
          // Unsupported format — surface to the user rather than
          // letting Storage reject with an opaque 403.
          console.warn('d2d photo upload: unsupported file', file && file.name, file && file.type);
          rejected++;
          continue;
        }
        const safeName = String(file.name || 'knock').replace(/[^A-Za-z0-9._-]+/g, '_').substring(0, 120);
        const storageRef = ref(window._storage, `photos/${uid}/d2d/${knockId}/${Date.now()}_${safeName}`);
        // Pass contentType explicitly so Storage doesn't infer
        // application/octet-stream for HEIC files where Safari left
        // file.type empty.
        // 20s upload timeout — Storage uploads on a stale iOS bfcache
        // connection hang the same way Firestore writes do. Per-photo
        // timeout so one bad photo doesn't block the rest of the batch.
        await _withTimeout(window.uploadBytes(storageRef, file, { contentType }), 20000, 'uploadBytes(photo)');
        const url = await _withTimeout(getDownloadURL(storageRef), 10000, 'getDownloadURL(photo)');
        urls.push(url);
      } catch(e) {
        console.error('Photo upload failed:', e && e.code, e && e.message, file && file.name, file && file.type);
        rejected++;
      }
    }
    if (rejected > 0 && window.showToast) {
      const ok = files.length - rejected;
      if (ok === 0) {
        window.showToast('Photo upload failed — unsupported format or network error', 'error');
      } else {
        window.showToast(`${rejected} of ${files.length} photo${files.length > 1 ? 's' : ''} failed to upload`, 'warning');
      }
    }
    return urls;
  }

  async function uploadVoiceMemo(blob, knockId) {
    if (!blob) return '';
    try {
      const { ref, getDownloadURL } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js');
      // Path must live under `audio/{uid}/...` — storage.rules:146 is the
      // only allowlisted path for audio uploads, everything else hits the
      // default-deny at storage.rules:155. Keep the `d2d/` prefix for
      // lineage and so onAudioUploaded can tell D2D memos apart from
      // Voice Intelligence recordings.
      const storageRef = ref(window._storage, `audio/${window._user.uid}/d2d/${knockId}_${Date.now()}.webm`);
      // Same iOS bfcache timeout treatment as photo uploads — voice
      // memos are typically larger so allow a longer ceiling (30s).
      await _withTimeout(window.uploadBytes(storageRef, blob), 30000, 'uploadBytes(voice)');
      return await _withTimeout(getDownloadURL(storageRef), 10000, 'getDownloadURL(voice)');
    } catch(e) {
      console.error('Voice upload failed:', e);
      window.showToast?.('Voice memo upload failed — will retry when you reopen this knock', 'error');
      return '';
    }
  }

  // ============================================================================
  // SMS / EMAIL TEMPLATES (data layer — chooser UI lives in ui module)
  // ============================================================================
  function sendFollowUpSMS(knock, templateKey) {
    const phone = knock.phone;
    if (!phone) { window.showToast?.('No phone number for this contact', 'error'); return; }
    const repName = state.currentRep?.name || window._user?.displayName || 'your local roofer';
    const tmpl = SMS_TEMPLATES[templateKey] || SMS_TEMPLATES[knock.disposition] || SMS_TEMPLATES.follow_up;
    const body = tmpl.body
      .replace(/\{name\}/g, knock.homeowner || 'there')
      .replace(/\{rep\}/g, repName)
      .replace(/\{address\}/g, knock.address || '')
      .replace(/\{follow_up_date\}/g, knock.followUpDate ? formatDate(knock.followUpDate) : 'soon');

    // Try NBDComms first
    if (window.NBDComms && typeof window.NBDComms.sendSMS === 'function') {
      window.NBDComms.sendSMS(phone, body, knock.id).then(result => {
        if (result.success) {
          const nameDisplay = knock.homeowner || 'contact';
          window.showToast?.(`Text sent to ${nameDisplay}`, 'ok');
        } else {
          // Fallback on failure
          const cleanPhone = phone.replace(/[^0-9+]/g, '');
          window.open(`sms:${cleanPhone}?body=${encodeURIComponent(body)}`, '_blank');
          window.showToast?.('Opening SMS...', 'info');
        }
      });
    } else {
      // Fallback: sms: link
      const cleanPhone = phone.replace(/[^0-9+]/g, '');
      window.open(`sms:${cleanPhone}?body=${encodeURIComponent(body)}`, '_blank');
      window.showToast?.('Opening SMS...', 'info');
    }
  }

  function sendFollowUpEmail(knock, templateKey) {
    if (!knock.email) { window.showToast?.('No email for this contact', 'error'); return; }
    const repName = state.currentRep?.name || window._user?.displayName || 'NBD Home Solutions';
    const tmpl = SMS_TEMPLATES[templateKey] || SMS_TEMPLATES[knock.disposition] || SMS_TEMPLATES.follow_up;
    const body = tmpl.body
      .replace(/\{name\}/g, knock.homeowner || 'there')
      .replace(/\{rep\}/g, repName)
      .replace(/\{address\}/g, knock.address || '');
    window.open(`mailto:${knock.email}?subject=NBD Home Solutions — ${tmpl.label}&body=${encodeURIComponent(body)}`, '_blank');
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================
  async function initD2D() {
    if (state.d2dInited) {
      if (window.D2D && typeof window.D2D.renderD2D === 'function') window.D2D.renderD2D();
      if (state.d2dMap) setTimeout(() => state.d2dMap.invalidateSize(), 100);
      return;
    }
    // Prevent concurrent inits (e.g. rapid D2D tab clicks)
    if (state.d2dInitializing) return;
    state.d2dInitializing = true;

    // No standalone auth gate here. NBDAuth gates dashboard access on
    // load (dashboard.html runs NBDAuth.init with requiredPlan); if a
    // user is on this page and tapping the D2D nav button, they've
    // already passed that gate. The previous double-gate did its own
    // window._user / _auth.currentUser / authStateReady check and
    // redirected to /pro/login?from=d2d on failure — which on iOS
    // Safari was firing for SIGNED-IN users because ITP delays the
    // IndexedDB session restore past whatever timeout we used. Net
    // effect: a working app on Brave / desktop, but a permanent
    // login bounce on iPhone Safari for the same account.
    //
    // The Firestore reads inside this init still require window._user.uid
    // and are wrapped in try/catch + a 6s Promise.race below, so an
    // edge case where the user really isn't signed in degrades to an
    // empty D2D shell rather than data exposure. Best-effort hydrate
    // window._user from _auth.currentUser if missing so loadKnocks /
    // loadRepProfile have what they need.
    if (!window._user && window._auth && window._auth.currentUser) {
      window._user = window._auth.currentUser;
    }

    try {
      loadOfflineQueue();
      // Wrap Firestore reads in a combined 6-second timeout so that
      // renderD2D() is always reached — even on iOS Safari with poor
      // or no connectivity where getDoc/getDocs can hang indefinitely.
      // On timeout we proceed with whatever partial data loaded (empty
      // knocks array is fine; the UI shell renders and the user can
      // refresh manually).
      await Promise.race([
        (async () => { await loadRepProfile(); await loadKnocks(); })(),
        new Promise(resolve => setTimeout(resolve, 6000))
      ]);
      if (window.D2D && typeof window.D2D.renderD2D === 'function') window.D2D.renderD2D();
      setTimeout(() => initD2DMap(), 200);
      state.d2dInited = true;
      state.d2dInitializing = false;

      // Async background tasks
      if (state.isOnline) {
        flushOfflineQueue();
        loadWeather();
      }
    } catch (e) {
      state.d2dInitializing = false;
      console.error('initD2D failed:', e);
      window.showToast?.('Failed to initialize D2D', 'error');
      // Always render the shell so the spinner clears — a hung
      // spinner on a thrown init is the worst UX failure mode.
      try { if (window.D2D && typeof window.D2D.renderD2D === 'function') window.D2D.renderD2D(); } catch (_) {}
    }
  }

  // ============================================================================
  // EXPORT TO STATE OBJECT (so UI module + shim can call into core)
  // ============================================================================
  state.uiConfirm = uiConfirm;
  state.uiPrompt = uiPrompt;
  state.escapeHtml = escapeHtml;
  state.esc = esc;
  state.toDate = toDate;
  state.timeAgo = timeAgo;
  state.formatTime = formatTime;
  state.formatDate = formatDate;
  state.normalizeAddress = normalizeAddress;
  state.getAttemptCount = getAttemptCount;
  state.getAddressHistory = getAddressHistory;
  state.parseStreetName = parseStreetName;
  state.parseHouseNumber = parseHouseNumber;
  state.loadOfflineQueue = loadOfflineQueue;
  state.flushOfflineQueue = flushOfflineQueue;
  state.reverseGeocode = reverseGeocode;
  state.searchAddresses = searchAddresses;
  state.setupAddressAutocomplete = setupAddressAutocomplete;
  state.loadWeather = loadWeather;
  state.getWeatherAlerts = getWeatherAlerts;
  state.calculateWalkingRoute = calculateWalkingRoute;
  state.drawWalkingRoute = drawWalkingRoute;
  state.clearWalkingRoute = clearWalkingRoute;
  state.loadRepProfile = loadRepProfile;
  state.loadKnocks = loadKnocks;
  state.submitKnock = submitKnock;
  state.updateKnock = updateKnock;
  state.deleteKnock = deleteKnock;
  state.convertToLead = convertToLead;
  state.convertToLeadWithEdit = convertToLeadWithEdit;
  state.loadTeamKnocks = loadTeamKnocks;
  state.loadTerritories = loadTerritories;
  state.saveTerritory = saveTerritory;
  state.deleteTerritory = deleteTerritory;
  state.updateNavBadge = updateNavBadge;
  state.applyFilters = applyFilters;
  state.getMetrics = getMetrics;
  state.getRevenueMetrics = getRevenueMetrics;
  state.getDispositionBreakdown = getDispositionBreakdown;
  state.getTimeOfDayStats = getTimeOfDayStats;
  state.getInsuranceMetrics = getInsuranceMetrics;
  state.getGamificationData = getGamificationData;
  state.initD2DMap = initD2DMap;
  state.centerOnMe = centerOnMe;
  state.refreshMapMarkers = refreshMapMarkers;
  state.toggleHeatMap = toggleHeatMap;
  state.uploadPhotos = uploadPhotos;
  state.uploadVoiceMemo = uploadVoiceMemo;
  state.sendFollowUpSMS = sendFollowUpSMS;
  state.sendFollowUpEmail = sendFollowUpEmail;
  state.initD2D = initD2D;

})();
