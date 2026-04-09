/**
 * NBD Pro Offline Manager v1.0
 * Client-side offline queue management and UI
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
    // Open IndexedDB
    await initIndexedDB();

    // Register service worker
    if ('serviceWorker' in navigator) {
      try {
        swRegistration = await navigator.serviceWorker.register('/pro/sw.js', {
          scope: '/pro/'
        });
        console.log('✓ Service Worker registered');

        // Listen for SW controller changes (updates)
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          showUpdateNotification();
        });

        // Listen for messages from SW
        navigator.serviceWorker.addEventListener('message', handleSWMessage);
      } catch (err) {
        console.warn('Service Worker registration failed:', err);
      }
    }

    // Listen for online/offline events
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Create status indicator UI
    createStatusIndicator();

    // Sync on page load if online
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
        method, // 'set', 'update', 'delete'
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
        showOfflineToast(`Saved offline — will sync when connected`);
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
            // Construct Firestore write request
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
    // Get auth token from window (Firebase auth must be initialized)
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
    // If Firebase auth is loaded, get the token
    if (window._user && typeof window._user.getIdToken === 'function') {
      return window._user.getIdToken();
    }
    // Fallback: try to get from storage (not ideal but works for offline scenarios)
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
      // SW has synced items from queue
      if (msg.synced > 0) {
        showOfflineToast(
          `Synced ${msg.synced} offline ${msg.synced === 1 ? 'item' : 'items'}`,
          'success'
        );
      }
    }
  }

  function showUpdateNotification() {
    const indicator = document.getElementById('nbd-offline-status');
    if (indicator) {
      const updateMsg = document.createElement('div');
      updateMsg.className = 'nbd-update-msg';
      updateMsg.innerHTML = `
        <span>Update available</span>
        <button onclick="window.location.reload()">Refresh</button>
      `;
      indicator.appendChild(updateMsg);
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
  // Status indicator UI
  // ─────────────────────────────────────────────────────────
  function createStatusIndicator() {
    if (document.getElementById('nbd-offline-status')) return;

    const indicator = document.createElement('div');
    indicator.id = 'nbd-offline-status';
    indicator.className = 'nbd-offline-status online';
    indicator.innerHTML = `
      <div class="nbd-status-inner">
        <span class="nbd-status-dot"></span>
        <span class="nbd-status-text">Online</span>
      </div>
    `;

    // Add styles if not already present
    if (!document.getElementById('nbd-offline-styles')) {
      const style = document.createElement('style');
      style.id = 'nbd-offline-styles';
      style.textContent = `
        #nbd-offline-status {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 32px;
          z-index: 10000;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          font-weight: 600;
          transition: all 0.2s ease;
          pointer-events: none;
          font-family: system-ui, -apple-system, sans-serif;
        }

        #nbd-offline-status.online {
          background: rgba(46, 204, 138, 0.1);
          color: #2ecc8a;
          border-bottom: 1px solid rgba(46, 204, 138, 0.2);
        }

        #nbd-offline-status.offline {
          background: rgba(224, 82, 82, 0.1);
          color: #e05252;
          border-bottom: 1px solid rgba(224, 82, 82, 0.2);
        }

        .nbd-status-inner {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .nbd-status-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: currentColor;
          animation: nbd-pulse 2s infinite;
        }

        #nbd-offline-status.offline .nbd-status-dot {
          animation: none;
        }

        @keyframes nbd-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .nbd-update-msg {
          position: absolute;
          top: 40px;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          background: rgba(74, 158, 255, 0.1);
          border: 1px solid rgba(74, 158, 255, 0.2);
          border-radius: 8px;
          color: #4a9eff;
          font-size: 12px;
          pointer-events: auto;
          animation: slideDown 0.3s ease;
        }

        .nbd-update-msg button {
          padding: 4px 12px;
          background: #4a9eff;
          color: white;
          border: none;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s;
        }

        .nbd-update-msg button:hover {
          background: #3a8eef;
        }

        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.insertBefore(indicator, document.body.firstChild);
    updateStatusIndicator();
  }

  function updateStatusIndicator() {
    const indicator = document.getElementById('nbd-offline-status');
    if (!indicator) return;

    if (isOnline) {
      indicator.classList.remove('offline');
      indicator.classList.add('online');
      const text = indicator.querySelector('.nbd-status-text');
      if (text) text.textContent = 'Online';
    } else {
      indicator.classList.remove('online');
      indicator.classList.add('offline');
      const text = indicator.querySelector('.nbd-status-text');
      if (text) text.textContent = 'Offline — no internet connection';
    }
  }

  // ─────────────────────────────────────────────────────────
  // Offline toast notifications
  // ─────────────────────────────────────────────────────────
  function showOfflineToast(message, type = 'warning') {
    // Use existing toast system if available
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
      return;
    }

    // Fallback: create simple toast
    const toast = document.createElement('div');
    toast.className = `nbd-offline-toast nbd-offline-toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 12px 16px;
      background: ${type === 'success' ? '#2ecc8a' : '#e05252'};
      color: white;
      border-radius: 6px;
      font-size: 13px;
      z-index: 9999;
      animation: toastIn 0.3s ease;
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toastOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
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

  // Auto-init on page load if DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
