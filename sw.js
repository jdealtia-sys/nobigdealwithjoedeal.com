// NBD Pro Service Worker v1.0
const CACHE_NAME = 'nbd-pro-v1';
const STATIC_CACHE = 'nbd-static-v1';

const PRECACHE_URLS = [
  '/pro/login.html','/pro/landing.html','/pro/dashboard.html',
  '/pro/daily-success/','/pro/register.html','/offline.html'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache =>
      cache.addAll(PRECACHE_URLS).catch(err => console.warn('[SW]', err))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== STATIC_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;
  if (/firebase|googleapis|gstatic|fonts\./.test(url.hostname)) return;
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request).then(r => { caches.open(STATIC_CACHE).then(c => c.put(request, r.clone())); return r; })
        .catch(() => caches.match(request).then(r => r || caches.match('/offline.html')))
    );
    return;
  }
  if (/\.(css|js|woff2?|png|jpg|jpeg|svg|ico|webp)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(r => {
        if (r && r.status === 200) caches.open(CACHE_NAME).then(c => c.put(request, r.clone()));
        return r;
      }))
    );
    return;
  }
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});

self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  event.waitUntil(self.registration.showNotification(data.title || 'NBD Pro', {
    body: data.body || 'New NBD Pro alert.',
    tag: data.tag || 'nbd-alert',
    data: { url: data.url || '/pro/dashboard.html' },
    vibrate: [100, 50, 100]
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/pro/dashboard.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if (c.url.includes(url) && 'focus' in c) return c.focus(); }
      return clients.openWindow(url);
    })
  );
});
