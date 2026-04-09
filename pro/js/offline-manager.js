/**
 * NBD Pro Offline Manager v2.0
 * Client-side offline queue management and UI
 *
 * v2: Online bar replaced with subtle centered pill button in header
 *
 * Handles:
 * - Service worker registration
 * - Online/offline status detection
 * - IndexedDB queue for Firestore writes
 * - UI indicators and toast notifications
 * - Background sync coordination
 */

(function() {
  'use strict';

  const DB_NAME = 'nbd-offline-db';
  const DB_STORE = 'pending-writes';
  const DB_VERSION = 1;

  let db = null;
  let isOnline = navigator.onLine;
  let swRegistration = null;

  // ─────────────────────────────────────────────────────────
  // Initialize
  // ─────────────────────────────────────────────────────────
  async function init() {
    await initIndexedDB();

    if ('serviceWorker' in navigator) {
      try {
        swRegistration = await navigator.serviceWorker.register('/pro/sw.js', {
          scope: '/pro/'
        });
        console.log('✓ Service Worker registered');

        navigator.serviceWorker.addEventListener('controllerchange', () => {
          showUpdateNotification();
        });

        navigator.serviceWorker.addEventListener('message', handleSWMessage);
      } catch (err) {
        console.warn('Service Worker registration failed:', err);
      }
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    createStatusIndicator();

    if (isOnline) {
      flushQueue();
    }
  }

  // ─────────────────────────────────────────────────────────
  // IndexedDB Management
  // ─────────────────────────────────────────────────────────
  function initIndexedDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onerror = () => {
        console.warn('IndexedDB open failed:', req.error);
        reject(req.error);
      };

      req.onsuccess = () => {
        db = req.result;
        resolve();
      };

      req.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains(DB_STORE)) {
          database.createObjectStore(DB_STORE, {
            keyPath: 'id',
            autoIncrement: true
          });
        }
      };
    });
  }

  // ─────────────────────────────────────────────────────────
  // Public API: Queue a Firestore write for offline
  // ─────────────────────────────────────────────────────────
  function queueWrite(collection, docId, data, method = 'set') {
    if (!db) {
      console.warn('IndexedDB not initialized');
      return Promise.reject(new Error('IndexedDB unavailable'));
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      const store = tx.objectStore(DB_STORE);

      const item = {
        collection,
        docId,
        data,
        method,
        timestamp: Date.now(),
        url: `/pro/api/firestore/${collection}/${docId}`,
        status: 'pending'
      };

      const req = store.add(item);

      req.onerror = () => {
        console.warn('Failed to queue write:', req.error);
        reject(req.error);
      };

      req.onsuccess = () => {
        showOfflineToast('Saved offline — will sync when connected');
        resolve(req.result);
      };

      tx.onerror = () => reject(tx.error);
    });
  }

  // ─────────────────────────────────────────────────────────
  // Flush the offline queue
  // ─────────────────────────────────────────────────────────
  function flushQueue() {
    if (!db) return Promise.resolve();

    return new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const store = tx.objectStore(DB_STORE);
      const req = store.getAll();

      req.onerror = () => {
        console.warn('Failed to read queue:', req.error);
        resolve();
      };

      req.onsuccess = async () => {
        const items = req.result;

        if (items.length === 0) {
          resolve();
          return;
        }

        let synced = 0;
        let failed = 0;

        for (const item of items) {
          try {
            const response = await performFirestoreWrite(item);

            if (response.ok) {
              await deleteQueueItem(item.id);
              synced++;
            } else {
              failed++;
            }
          } catch (err) {
            console.warn('Failed to sync item:', err);
            failed++;
          }
        }

        if (synced > 0) {
          showOfflineToast(
            `Synced ${synced} offline ${synced === 1 ? 'item' : 'items'}`,
            'success'
          );
        }

        if (failed > 0) {
          console.warn(`${failed} items failed to sync`);
        }

        resolve();
      };

      tx.onerror = () => {
        console.warn('Transaction error:', tx.error);
        resolve();
      };
    });
  }

  // ─────────────────────────────────────────────────────────
  // Perform actual Firestore write (requires auth token)
  // ─────────────────────────────────────────────────────────
  async function performFirestoreWrite(item) {
    const token = await getAuthToken();

    if (!token) {
      throw new Error('No auth token available');
    }

    const method = item.method || 'set';
    const payload = {
      fields: {
        ...Object.entries(item.data).reduce((acc, [k, v]) => {
          acc[k] = encodeFirestoreValue(v);
          return acc;
        }, {})
      }
    };

    const url = `https://firestore.googleapis.com/v1/projects/${window._project}/databases/(default)/documents/${item.collection}/${item.docId}`;

    const opts = {
      method: method === 'delete' ? 'DELETE' : 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    if (method !== 'delete') {
      opts.body = JSON.stringify(payload);
    }

    return fetch(url, opts);
  }

  function encodeFirestoreValue(val) {
    if (val === null) return { nullValue: null };
    if (typeof val === 'boolean') return { booleanValue: val };
    if (typeof val === 'number') {
      if (Number.isInteger(val)) {
        return { integerValue: String(val) };
      }
      return { doubleValue: val };
    }
    if (typeof val === 'string') return { stringValue: val };
    if (val instanceof Date) return { timestampValue: val.toISOString() };
    if (Array.isArray(val)) {
      return { arrayValue: { values: val.map(encodeFirestoreValue) } };
    }
    if (typeof val === 'object') {
      return {
        mapValue: {
          fields: Object.entries(val).reduce((acc, [k, v]) => {
            acc[k] = encodeFirestoreValue(v);
            return acc;
          }, {})
        }
      };
    }
    return { stringValue: String(val) };
  }

  function getAuthToken() {
    if (window._user && typeof window._user.getIdToken === 'function') {
      return window._user.getIdToken();
    }
    return Promise.resolve(localStorage.getItem('_firebase_token'));
  }

  function deleteQueueItem(id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      const store = tx.objectStore(DB_STORE);
      const req = store.delete(id);

      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ─────────────────────────────────────────────────────────
  // Service Worker message handler
  // ─────────────────────────────────────────────────────────
  function handleSWMessage(event) {
    const msg = event.data;

    if (msg.type === 'SW_UPDATE_AVAILABLE') {
      showUpdateNotification();
    } else if (msg.type === 'OFFLINE_SYNC_COMPLETE') {
      if (msg.synced > 0) {
        showOfflineToast(
          `Synced ${msg.synced} offline ${msg.synced === 1 ? 'item' : 'items'}`,
          'success'
        );
      }
    }
  }

  function showUpdateNotification() {
    if (typeof window.showToast === 'function') {
      window.showToast('Update available — tap to refresh', 'info');
    }
  }

  // ─────────────────────────────────────────────────────────
  // Online/Offline handlers
  // ─────────────────────────────────────────────────────────
  function handleOnline() {
    isOnline = true;
    updateStatusIndicator();
    flushQueue();
  }

  function handleOffline() {
    isOnline = false;
    updateStatusIndicator();
  }

  // ─────────────────────────────────────────────────────────
  // Status indicator UI — SUBTLE PILL BUTTON
  // Centered in header, matches existing button aesthetic
  // Green when online, red when offline
  // ─────────────────────────────────────────────────────────
  function createStatusIndicator() {
    // Remove old full-width bar if it exists
    const oldBar = document.getElementById('nbd-offline-status');
    if (oldBar) oldBar.remove();

    // Add styles
    if (!document.getElementById('nbd-offline-styles')) {
      const style = document.createElement('style');
      style.id = 'nbd-offline-styles';
      style.textContent = `
        .nbd-conn-pill {
          display:inline-flex;
          align-items:center;
          gap:5px;
          padding:4px 10px;
          border-radius:20px;
          font-size:10px;
          font-family:'Barlow Condensed',system-ui,-apple-system,sans-serif;
          font-weight:700;
          letter-spacing:.06em;
          text-transform:uppercase;
          border:1px solid transparent;
          cursor:default;
          transition:all .25s ease;
          -webkit-tap-highlight-color:transparent;
          line-height:1;
        }

        .nbd-conn-pill.online {
          background:rgba(16,185,129,.1);
          border-color:rgba(16,185,129,.25);
          color:#10b981;
        }

        .nbd-conn-pill.offline {
          background:rgba(239,68,68,.1);
          border-color:rgba(239,68,68,.3);
          color:#ef4444;
        }

        .nbd-conn-pill.syncing {
          background:rgba(251,191,36,.1);
          border-color:rgba(251,191,36,.25);
          color:#fbbf24;
        }

        .nbd-conn-dot {
          width:6px;
          height:6px;
          border-radius:50%;
          background:currentColor;
          flex-shrink:0;
        }

        .nbd-conn-pill.online .nbd-conn-dot {
          box-shadow:0 0 6px rgba(16,185,129,.5);
        }

        .nbd-conn-pill.offline .nbd-conn-dot {
          animation:nbd-conn-pulse 1.4s ease-in-out infinite;
        }

        .nbd-conn-pill.syncing .nbd-conn-dot {
          animation:nbd-conn-pulse 1s ease-in-out infinite;
        }

        @keyframes nbd-conn-pulse {
          0%,100% { opacity:1; }
          50%     { opacity:.4; }
        }
      `;
      document.head.appendChild(style);
    }

    // Create the pill
    const pill = document.createElement('span');
    pill.id = 'nbd-offline-status';
    pill.className = 'nbd-conn-pill ' + (isOnline ? 'online' : 'offline');
    pill.innerHTML = `<span class="nbd-conn-dot"></span><span class="nbd-conn-text">${isOnline ? 'Online' : 'Offline'}</span>`;

    // Insert into header — between logo and back button / right side
    const header = document.querySelector('header');
    if (header) {
      // Check if header uses flexbox with space-between (logo left, buttons right)
      // Insert pill after the logo or first child
      const logo = header.querySelector('.logo');
      const hright = header.querySelector('.hright');

      if (hright) {
        // Dashboard-style header: logo | [pill] | hright
        header.insertBefore(pill, hright);
      } else if (logo && logo.nextSibling) {
        // Customer-style header: logo | [pill] | back-btn
        logo.parentNode.insertBefore(pill, logo.nextSibling);
      } else {
        // Fallback: append to header
        header.appendChild(pill);
      }
    }

    updateStatusIndicator();
  }

  function updateStatusIndicator() {
    const pill = document.getElementById('nbd-offline-status');
    if (!pill) return;

    const text = pill.querySelector('.nbd-conn-text');

    if (isOnline) {
      pill.className = 'nbd-conn-pill online';
      if (text) text.textContent = 'Online';
    } else {
      pill.className = 'nbd-conn-pill offline';
      if (text) text.textContent = 'Offline';
    }
  }

  // ─────────────────────────────────────────────────────────
  // Offline toast notifications
  // ─────────────────────────────────────────────────────────
  function showOfflineToast(message, type = 'warning') {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
      return;
    }

    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
      position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
      padding:10px 18px; background:${type === 'success' ? '#10b981' : '#ef4444'};
      color:white; border-radius:8px; font-size:12px; font-weight:600;
      z-index:9999; white-space:nowrap; box-shadow:0 4px 12px rgba(0,0,0,.3);
      animation:nbd-toast-in .25s ease;
    `;

    if (!document.getElementById('nbd-toast-anim')) {
      const s = document.createElement('style');
      s.id = 'nbd-toast-anim';
      s.textContent = `
        @keyframes nbd-toast-in { from { opacity:0; transform:translateX(-50%) translateY(8px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
        @keyframes nbd-toast-out { from { opacity:1; } to { opacity:0; transform:translateX(-50%) translateY(8px); } }
      `;
      document.head.appendChild(s);
    }

    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'nbd-toast-out .25s ease forwards';
      setTimeout(() => toast.remove(), 250);
    }, 3000);
  }

  // ─────────────────────────────────────────────────────────
  // Expose public API
  // ─────────────────────────────────────────────────────────
  window.OfflineManager = {
    init,
    queueWrite,
    flushQueue,
    isOnline: () => isOnline,
    getQueueSize: () => {
      if (!db) return 0;
      return new Promise((resolve) => {
        const tx = db.transaction(DB_STORE, 'readonly');
        const store = tx.objectStore(DB_STORE);
        const req = store.count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(0);
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
