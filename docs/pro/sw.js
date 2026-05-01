/**
 * NBD Pro Service Worker v1.0
 * Production-grade offline PWA with intelligent caching and background sync
 *
 * Caching Strategies:
 * - App Shell (cache-first): HTML, CSS, JS, fonts
 * - CDN Libraries (cache-first, long TTL): Leaflet, MarkerCluster, leaflet-heat
 * - Map Tiles (cache-first with limit): ESRI tiles, max 500 tiles
 * - Firebase/API (network-first): Firestore REST API, Cloud Functions
 * - Images (stale-while-revalidate): User photos from Firebase Storage
 */

const CACHE_VERSIONS = {
  shell: 'nbd-shell-v17', // v17 — hotfix: move initializeFirestore into nbd-auth.js so dashboard.html stops throwing
  cdn: 'nbd-cdn-v17',     // v17 — purge broken v16 dashboard.html / nbd-auth.js
  tiles: 'nbd-tiles-v1',
  api: 'nbd-api-v1',
  images: 'nbd-images-v2'
};

// Auth-gated pages — never cached. A stale shell can render after logout or
// after a policy change, which both leaks state and lets an ex-user see the
// old UI. Every path here falls through to network-first with no cache
// storage on success, and a short offline message on failure.
const NO_CACHE_HTML = new Set([
  '/pro/',
  '/pro/dashboard.html',
  '/pro/customer.html',
  '/pro/vault.html',
  '/pro/login.html',
  '/pro/register.html',
  '/pro/analytics.html',
  '/pro/leaderboard.html',
  '/pro/ask-joe.html',
  '/pro/project-codex.html',
  '/pro/ai-tree.html',
  '/pro/ai-tool-finder.html',
  '/pro/understand.html',
  '/pro/stripe-success.html',
  '/pro/landing.html',
  // GDPR erasure confirmation: hosting rewrite → cloud function. Its
  // response is token-specific and destructive; a cached "already
  // processed" response could leak across users or get replayed.
  '/pro/account-erasure',
  // Homeowner portal: public-by-token HTML shell. The HTML itself
  // isn't sensitive, but we don't want a cached shell outliving a
  // security patch, so treat it the same as other pro pages.
  '/pro/portal.html',
]);

function isAuthGatedHTML(url) {
  if (url.origin !== self.location.origin) return false;
  if (NO_CACHE_HTML.has(url.pathname)) return true;
  if (url.pathname.startsWith('/admin/')) return true;
  return false;
}

const OFFLINE_QUEUE_DB_NAME = 'nbd-offline-db';
const OFFLINE_QUEUE_STORE = 'pending-writes';
const SYNC_TAG = 'nbd-sync-queue';

// ─────────────────────────────────────────────────────────
// INSTALL: Precache app shell
// ─────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  // Precache ONLY assets that are never auth-gated: the manifest and the
  // offline fallback page. HTML shells for authenticated pages must never
  // be served from cache — see NO_CACHE_HTML + fetch() handler below.
  event.waitUntil(
    caches.open(CACHE_VERSIONS.shell).then(cache => {
      return cache.addAll([
        '/pro/manifest.json',
        '/offline.html'
      ]).catch(err => {
        console.warn('App shell cache error (non-fatal):', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ─────────────────────────────────────────────────────────
// ACTIVATE: Clean up old cache versions + purge any cached
// auth-gated HTML that leaked into the caches from prior
// versions of this SW. Old SW versions used to precache
// `/pro/dashboard.html`, `/pro/customer.html`, `/pro/login.html`
// and the `handleAssetRequest` offline fallback could have
// cached other pro pages. We explicitly delete those entries
// now so a logged-out user can never see a stale shell after
// the upgrade.
// ─────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // 1. Delete every cache not in the current version set.
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map(name => {
      const isCurrentVersion = Object.values(CACHE_VERSIONS).includes(name);
      if (!isCurrentVersion) return caches.delete(name);
    }));

    // 2. In every surviving cache, delete any auth-gated HTML that leaked
    //    in before v5 started refusing to store them.
    for (const cacheName of Object.values(CACHE_VERSIONS)) {
      try {
        const cache = await caches.open(cacheName);
        const requests = await cache.keys();
        await Promise.all(requests.map(req => {
          try {
            const u = new URL(req.url);
            if (isAuthGatedHTML(u)) return cache.delete(req);
          } catch (_) { /* ignore */ }
        }));
      } catch (_) { /* ignore */ }
    }

    // 3. Claim the currently-controlled clients so this SW version takes
    //    over immediately, then tell every client to soft-reload. The
    //    dashboard / customer / vault pages ignore the message unless the
    //    URL is in the auth-gated set, so the marketing pages don't flap.
    await self.clients.claim();
    const clientList = await self.clients.matchAll({ includeUncontrolled: true });
    clientList.forEach(client => {
      client.postMessage({
        type: 'SW_UPDATE_AVAILABLE',
        version: CACHE_VERSIONS.shell,
      });
    });
  })());
});

// ─────────────────────────────────────────────────────────
// FETCH: Route requests to appropriate cache/network handler
// ─────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests (handled by background sync)
  if (request.method !== 'GET') {
    return;
  }

  // Skip chrome extensions, external domains out of scope
  if (url.protocol === 'chrome-extension:' || url.origin !== self.location.origin) {
    // Allow cross-origin for CDNs and APIs
    if (isExternalCDN(url)) {
      return event.respondWith(handleCDNRequest(request));
    }
    return;
  }

  // Auth-gated HTML pages: never serve from cache, never store in cache.
  // This prevents logged-out users from seeing stale dashboard/vault shells
  // and kills XSS pivots that rely on cached old code still running after
  // a deploy that patches a sink.
  if (isAuthGatedHTML(url)) {
    event.respondWith(handleAuthGatedHTML(request));
    return;
  }

  // Route based on path/resource type
  if (isMapTile(url)) {
    event.respondWith(handleMapTileRequest(request));
  } else if (isAPIRequest(url)) {
    event.respondWith(handleAPIRequest(request));
  } else if (isImageRequest(url)) {
    event.respondWith(handleImageRequest(request));
  } else if (isJSorCSS(url)) {
    event.respondWith(handleAssetRequest(request, CACHE_VERSIONS.cdn));
  } else {
    event.respondWith(handleAssetRequest(request, CACHE_VERSIONS.shell));
  }
});

// Network-only handler for auth-gated HTML. If the network is unreachable,
// fall back to the /offline.html page (a static, non-authenticated notice).
// The goal is to make it IMPOSSIBLE for a logged-out user to see a cached
// authenticated shell.
async function handleAuthGatedHTML(request) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    // Defensive: if the server responds with a redirect to /pro/login.html,
    // honour it; otherwise return the network response unchanged.
    return response;
  } catch (e) {
    const cache = await caches.open(CACHE_VERSIONS.shell);
    const offline = await cache.match('/offline.html');
    return offline || new Response('You are offline. Please reconnect to continue.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

// ─────────────────────────────────────────────────────────
// BACKGROUND SYNC: Replay queued writes on reconnect
// ─────────────────────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(flushOfflineQueue());
  }
});

// ─────────────────────────────────────────────────────────
// MESSAGE: Handle client messages (skip-waiting, etc)
// ─────────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ═════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═════════════════════════════════════════════════════════

function isExternalCDN(url) {
  return url.hostname === 'unpkg.com' ||
         url.hostname === 'cdnjs.cloudflare.com' ||
         url.hostname === 'cdn.jsdelivr.net' ||
         url.hostname.includes('googleapis.com') ||
         url.hostname.includes('gstatic.com') ||
         url.hostname === 'server.arcgisonline.com' ||
         url.hostname === 'tile.openstreetmap.org';
}

function isMapTile(url) {
  // ESRI satellite tiles, OpenStreetMap, etc.
  return url.hostname === 'server.arcgisonline.com' ||
         url.hostname === 'tile.openstreetmap.org' ||
         url.pathname.includes('/tile');
}

function isAPIRequest(url) {
  // Firestore REST API, Cloud Functions
  return url.hostname.includes('firestore.googleapis.com') ||
         url.hostname.includes('cloudfunctions.net') ||
         url.hostname.includes('firebaseio.com') ||
         url.pathname.includes('/api/');
}

function isImageRequest(url) {
  const path = url.pathname.toLowerCase();
  return /\.(png|jpg|jpeg|gif|webp|svg)$/.test(path);
}

function isJSorCSS(url) {
  const path = url.pathname.toLowerCase();
  return path.endsWith('.js') || path.endsWith('.css');
}

// ─────────────────────────────────────────────────────────
// Cache-first for JS/CSS and Leaflet CDN libs
// ─────────────────────────────────────────────────────────
async function handleAssetRequest(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  // Stale-while-revalidate: serve cached immediately, but fetch fresh in background
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  if (cached) {
    // Serve cached now, update in background for next load
    fetchPromise; // fire and forget
    return cached;
  }

  // No cache — wait for network
  try {
    const response = await fetchPromise;
    if (response) return response;
    return new Response('Offline — please check connection', { status: 503 });
  } catch (err) {
    // Never fall back to the dashboard HTML shell — it's auth-gated and
    // should not be served from cache. Return a generic offline response.
    return new Response('Offline — please check connection', { status: 503 });
  }
}

// ─────────────────────────────────────────────────────────
// Cache-first for external CDN libraries (Leaflet, etc)
// ─────────────────────────────────────────────────────────
async function handleCDNRequest(request) {
  const cache = await caches.open(CACHE_VERSIONS.cdn);
  const cached = await cache.match(request);

  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      const responseClone = response.clone();
      cache.add(request);
      return response;
    }
    return response;
  } catch (err) {
    // CDN offline: try stale cache or fail gracefully
    const staleCache = await caches.match(request);
    return staleCache || new Response('CDN unavailable', { status: 503 });
  }
}

// ─────────────────────────────────────────────────────────
// Cache-first (with limit) for map tiles
// Max 500 tiles, evict oldest when full
// ─────────────────────────────────────────────────────────
async function handleMapTileRequest(request) {
  const cache = await caches.open(CACHE_VERSIONS.tiles);
  const cached = await cache.match(request);

  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      // Store with metadata for LRU eviction
      const responseClone = response.clone();
      const tile = {
        url: request.url,
        timestamp: Date.now(),
        response: responseClone
      };

      // Check cache size and evict if needed
      const requests = await cache.keys();
      if (requests.length >= 500) {
        // Get oldest tile (simplistic: just delete first one)
        // In production, could track timestamps in IndexedDB
        const oldest = requests[0];
        await cache.delete(oldest);
      }

      cache.put(request, response.clone());
      return response;
    }
    return response;
  } catch (err) {
    // Tile load failed: return cached or placeholder
    const cached = await cache.match(request);
    return cached || new Response('Tile unavailable', { status: 503 });
  }
}

// ─────────────────────────────────────────────────────────
// Network-first for API calls (Firestore, Cloud Functions)
// ─────────────────────────────────────────────────────────
async function handleAPIRequest(request) {
  const cache = await caches.open(CACHE_VERSIONS.api);

  try {
    const response = await fetch(request);

    // Only cache successful reads (not writes)
    if (response.ok && request.method === 'GET') {
      const responseClone = response.clone();
      cache.put(request, responseClone);
    }

    return response;
  } catch (err) {
    // Network failed: try cache, then queue for sync if it's a write
    const cached = await cache.match(request);

    if (cached) {
      return cached;
    }

    // If this is a write (POST/PUT/DELETE), queue it for background sync
    if (request.method !== 'GET') {
      const body = await request.clone().text();
      await queueOfflineWrite(request.url, request.method, body);
    }

    return new Response(JSON.stringify({
      error: 'Offline',
      message: 'Request queued for sync',
      queued: true
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ─────────────────────────────────────────────────────────
// Stale-while-revalidate for images
// ─────────────────────────────────────────────────────────
async function handleImageRequest(request) {
  const cache = await caches.open(CACHE_VERSIONS.images);
  const cached = await cache.match(request);

  // Return cached immediately, update in background
  if (cached) {
    // Fire-and-forget update
    fetch(request).then(response => {
      if (response.ok) {
        cache.put(request, response);
      }
    }).catch(() => {});

    return cached;
  }

  // No cache: try network
  try {
    const response = await fetch(request);
    if (response.ok) {
      const responseClone = response.clone();
      cache.put(request, responseClone);
      return response;
    }
    return response;
  } catch (err) {
    // Image offline: return placeholder
    return new Response(
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="#ccc"/></svg>',
      { headers: { 'Content-Type': 'image/svg+xml' } }
    );
  }
}

// ─────────────────────────────────────────────────────────
// IndexedDB: Queue offline writes
// ─────────────────────────────────────────────────────────
function getOfflineDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_QUEUE_DB_NAME, 1);

    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(OFFLINE_QUEUE_STORE)) {
        db.createObjectStore(OFFLINE_QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
  });
}

async function queueOfflineWrite(url, method, body) {
  try {
    const db = await getOfflineDB();
    const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(OFFLINE_QUEUE_STORE);

    store.add({
      url,
      method,
      body,
      timestamp: Date.now()
    });
  } catch (err) {
    console.warn('Failed to queue offline write:', err);
  }
}

async function flushOfflineQueue() {
  try {
    const db = await getOfflineDB();
    const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readonly');
    const store = tx.objectStore(OFFLINE_QUEUE_STORE);
    const items = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });

    let synced = 0;
    let failed = 0;

    for (const item of items) {
      try {
        const opts = {
          method: item.method,
          headers: { 'Content-Type': 'application/json' },
          body: item.body
        };

        const response = await fetch(item.url, opts);

        if (response.ok) {
          // Delete from queue
          const delTx = db.transaction(OFFLINE_QUEUE_STORE, 'readwrite');
          delTx.objectStore(OFFLINE_QUEUE_STORE).delete(item.id);
          synced++;
        } else {
          failed++;
        }
      } catch (err) {
        failed++;
      }
    }

    // Notify clients of sync completion
    if (synced > 0) {
      const clients = await self.clients.matchAll();
      clients.forEach(client => {
        client.postMessage({
          type: 'OFFLINE_SYNC_COMPLETE',
          synced,
          failed
        });
      });
    }
  } catch (err) {
    console.warn('Error flushing offline queue:', err);
  }
}
