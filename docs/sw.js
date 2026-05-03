// /sw.js — self-unregistering stub.
//
// This file used to be a second service worker registered at the root
// scope `/`. It precached `/pro/js/d2d-tracker.js` and served it
// cache-first, which on iPhone Safari kept signed-in users on a
// year-old copy of d2d-tracker.js no matter how many cache resets,
// reinstalls, or query-string version bumps we shipped. The codebase
// has not registered this SW for a long time — only `/pro/sw.js` is —
// but devices that registered it back when remember.
//
// Replacing the body with a stub that unregisters itself on activate
// is the only way to evict it. Browsers re-fetch sw.js on every
// navigation (Cache-Control: no-cache, max-age=0 from firebase.json),
// notice the bytes have changed, install the new version, activate it,
// and this code runs once — clearing this SW's caches and unregistering
// the registration. From that point on the device falls through to the
// scope-`/pro/` SW registered by dashboard.html / login.html, which is
// the only one we maintain.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => {})));
    } catch (_) {}
    try {
      await self.registration.unregister();
    } catch (_) {}
    try {
      const list = await self.clients.matchAll({ includeUncontrolled: true });
      list.forEach((c) => {
        try { c.postMessage({ type: 'SW_LEGACY_UNREGISTERED' }); } catch (_) {}
      });
    } catch (_) {}
  })());
});

// No fetch handler — we want the browser to handle requests directly
// while we unregister. (Adding an event listener for 'fetch' that does
// not call respondWith() is harmless but pointless; omitting the
// listener has the same effect and is cleaner.)
