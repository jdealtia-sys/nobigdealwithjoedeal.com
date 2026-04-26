// NBD Pro Service Worker v2.1 — Cross-origin passthrough fix
const CACHE_VERSION = 3;
const CACHE_NAME = 'nbd-pro-v' + CACHE_VERSION;
const STATIC_CACHE = 'nbd-static-v' + CACHE_VERSION;
const D2D_CACHE = 'nbd-d2d-v' + CACHE_VERSION;

// Core pages that must work offline
const PRECACHE_URLS = [
  '/pro/login.html',
  '/pro/landing.html',
  '/pro/dashboard.html',
  '/pro/customer.html',
  '/pro/daily-success/',
  '/pro/register.html',
  '/offline.html'
];

// D2D critical assets — precache for zero-signal door knocking
const D2D_ASSETS = [
  '/pro/js/d2d-tracker.js',
  '/pro/js/crm.js',
  '/pro/js/maps.js',
  '/pro/js/storm-alerts.js',
  '/pro/js/profit-tracker.js',
  '/pro/js/crew-calendar.js',
  '/pro/js/analytics-kpi.js',
  '/pro/js/review-engine.js',
  '/pro/js/email-drip.js',
  '/pro/js/customer-portal.js',
  '/pro/js/photo-report.js',
  '/pro/js/onboarding.js'
];

// External CDN resources to cache on first use
const CDN_CACHE_PATTERNS = [
  'cdnjs.cloudflare.com',
  'unpkg.com/leaflet',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all([
      caches.open(STATIC_CACHE).then(cache =>
        cache.addAll(PRECACHE_URLS).catch(err => console.warn('[SW] precache partial:', err))
      ),
      caches.open(D2D_CACHE).then(cache =>
        cache.addAll(D2D_ASSETS).catch(err => console.warn('[SW] D2D cache partial:', err))
      )
    ]).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k =>
          (k.startsWith('nbd-pro-') || k.startsWith('nbd-static-') || k.startsWith('nbd-d2d-')) &&
          k !== CACHE_NAME && k !== STATIC_CACHE && k !== D2D_CACHE
        ).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and Firebase/Google API requests
  if (request.method !== 'GET') return;
  if (/firebase|firestore|googleapis\.com\/identitytoolkit/.test(url.hostname)) return;

  // Skip ALL cross-origin requests. The page's strict CSP whitelists
  // CDNs (unpkg, cdnjs, jsdelivr, www.gstatic.com, fonts.gstatic.com,
  // openstreetmap tiles, arcgisonline) under script-src / style-src /
  // img-src / font-src — but NOT under connect-src. A SW that calls
  // fetch() for a cross-origin URL is checked against connect-src, so
  // proxying these via the SW returned 503 on every CDN load and
  // killed Firebase SDK boot, Leaflet, jspdf, fonts, etc. Letting the
  // browser load them directly via the originating <script>/<link>/
  // <img> tag uses the broader allowlist and works.
  // Trade-off: cross-origin assets are no longer offline-cached. The
  // app's same-origin /pro/* JS/CSS still get strategies 2–4 below.
  if (url.origin !== self.location.origin) return;

  // Strategy 1: HTML pages — Network first, fall back to cache
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then(r => {
          if (r && r.status === 200) {
            const clone = r.clone();
            caches.open(STATIC_CACHE).then(c => c.put(request, clone));
          }
          return r;
        })
        .catch(() => caches.match(request).then(r => r || caches.match('/offline.html')))
    );
    return;
  }

  // Strategy 2: D2D JS assets — Cache first (they're precached), then network
  if (D2D_ASSETS.some(a => url.pathname.endsWith(a.replace('/pro/', '')))) {
    event.respondWith(
      caches.match(request).then(cached => {
        // Return cached immediately, but also update in background
        const fetchPromise = fetch(request).then(r => {
          if (r && r.status === 200) {
            caches.open(D2D_CACHE).then(c => c.put(request, r.clone()));
          }
          return r;
        }).catch(() => null);

        return cached || fetchPromise;
      })
    );
    return;
  }

  // Strategy 3: CDN resources (Leaflet, fonts) — Cache first
  if (CDN_CACHE_PATTERNS.some(p => url.hostname.includes(p))) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(r => {
          if (r && r.status === 200) {
            caches.open(CACHE_NAME).then(c => c.put(request, r.clone()));
          }
          return r;
        });
      })
    );
    return;
  }

  // Strategy 4: Static assets (CSS, JS, images) — Stale-while-revalidate
  if (/\.(css|js|woff2?|png|jpg|jpeg|svg|ico|webp|gif)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(cached => {
        const fetchPromise = fetch(request).then(r => {
          if (r && r.status === 200) {
            caches.open(CACHE_NAME).then(c => c.put(request, r.clone()));
          }
          return r;
        }).catch(() => null);

        return cached || fetchPromise;
      })
    );
    return;
  }

  // Strategy 5: Tile servers (maps) — Cache first with generous caching
  if (/arcgisonline|tile\.openstreetmap/.test(url.hostname)) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(r => {
          if (r && r.status === 200) {
            caches.open(CACHE_NAME).then(c => c.put(request, r.clone()));
          }
          return r;
        }).catch(() => new Response('', { status: 404 }));
      })
    );
    return;
  }

  // Default: network with cache fallback
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// Push notifications
self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  event.waitUntil(self.registration.showNotification(data.title || 'NBD Pro', {
    body: data.body || 'New NBD Pro alert.',
    icon: data.icon || '/pro/icon-192.png',
    badge: '/pro/badge-72.png',
    tag: data.tag || 'nbd-alert',
    data: { url: data.url || '/pro/dashboard.html' },
    vibrate: [100, 50, 100],
    actions: data.actions || []
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/pro/dashboard.html';

  // Handle action buttons
  if (event.action === 'view') {
    event.waitUntil(clients.openWindow(url));
    return;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes(url) && 'focus' in c) return c.focus();
      }
      return clients.openWindow(url);
    })
  );
});

// Background sync — flush offline D2D knocks when connection returns
self.addEventListener('sync', event => {
  if (event.tag === 'nbd-d2d-sync') {
    event.waitUntil(
      clients.matchAll().then(all => {
        all.forEach(client => client.postMessage({ type: 'FLUSH_OFFLINE_QUEUE' }));
      })
    );
  }
});

// Message handler for cache management
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'CACHE_D2D_TILES') {
    // Pre-cache map tiles for a specific area
    const { tiles } = event.data;
    if (tiles && Array.isArray(tiles)) {
      caches.open(CACHE_NAME).then(cache => {
        tiles.forEach(url => {
          fetch(url).then(r => { if (r.ok) cache.put(url, r); }).catch(() => {});
        });
      });
    }
  }
});
