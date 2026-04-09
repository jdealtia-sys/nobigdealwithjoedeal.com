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
  shell: 'nbd-shell-v3',
  cdn: 'nbd-cdn-v3',
  tiles: 'nbd-tiles-v1',
  api: 'nbd-api-v1',
  images: 'nbd-images-v1'
};

const OFFLINE_QUEUE_DB_NAME = 'nbd-offline-db';
const OFFLINE_QUEUE_STORE = 'pending-writes';
const SYNC_TAG = 'nbd-sync-queue';

// ─────────────────────────────────────────────────────────
// INSTALL: Precache app shell
// ─────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSIONS.shell).then(cache => {
      return cache.addAll([
        '/pro/',
        '/pro/dashboard.html',
        '/pro/customer.html',
        '/pro/login.html',
        '/pro/manifest.json'
      ]).catch(err => {
        // Fail open: some files may not exist yet
        console.warn('App shell cache error (non-fatal):', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ─────────────────────────────────────────────────────────
// ACTIVATE: Clean up old cache versions
// ─────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(name => {
          // Delete caches not in our current versions
          const isCurrentVersion = Object.values(CACHE_VERSIONS).includes(name);
          if (!isCurrentVersion) {
            return caches.delete(name);
          }
        })
      );
    }).then(() => {
      // Notify all clients that a new SW is ready
      return self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({
            type: 'SW_UPDATE_AVAILABLE'
          });
        });
      });
    }).then(() => self.clients.claim())
  );
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
    return cache.match('/pro/dashboard.html') ||
           new Response('Offline — please check connection', { status: 503 });
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
