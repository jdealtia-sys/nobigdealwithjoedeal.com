/**
 * signed-image-url.js — client helper for the C1 signImageUrl function.
 *
 * Two entry points:
 *   window.NBDSignedUrl.get(path)            → Promise<string>
 *   window.NBDSignedUrl.mount(imgEl, path)   → sets <img src> after signing
 *
 * Caches signed URLs in-memory for 14 minutes (we issue 15-minute
 * tokens) so repeat renders of the same photo grid don't hammer the
 * function. Cache key is the storage path, not the URL, so the
 * refresh-on-expiry is transparent.
 *
 * Safe to include as a <script defer> — it just hangs a helper on
 * window; no side effects on load.
 */
(function () {
  'use strict';

  if (window.NBDSignedUrl && window.NBDSignedUrl.__sentinel === 'nbd-signed-url-v1') return;

  const FUNCTIONS_BASE = (window.__NBD_FUNCTIONS_BASE
    || 'https://us-central1-nobigdeal-pro.cloudfunctions.net').replace(/\/+$/, '');
  const CACHE_TTL_MS = 14 * 60 * 1000;
  const cache = new Map();
  const inflight = new Map();

  async function getIdToken() {
    try {
      if (window.auth && window.auth.currentUser) {
        return await window.auth.currentUser.getIdToken();
      }
    } catch (e) {}
    return null;
  }

  async function get(path) {
    if (typeof path !== 'string' || !path) return null;
    const now = Date.now();
    const cached = cache.get(path);
    if (cached && cached.expires > now) return cached.url;
    if (inflight.has(path)) return inflight.get(path);

    const p = (async () => {
      const token = await getIdToken();
      if (!token) throw new Error('Not signed in');
      const res = await fetch(FUNCTIONS_BASE + '/signImageUrl', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ path })
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error('signImageUrl ' + res.status + ' ' + txt.slice(0, 120));
      }
      const data = await res.json();
      cache.set(path, { url: data.url, expires: now + CACHE_TTL_MS });
      return data.url;
    })().finally(() => inflight.delete(path));

    inflight.set(path, p);
    return p;
  }

  // mount: sets the <img> src once the signed URL resolves. Shows a
  // transparent 1×1 placeholder meanwhile so layout doesn't shift.
  const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  function mount(imgEl, path, opts) {
    if (!imgEl || !path) return;
    opts = opts || {};
    imgEl.src = BLANK;
    imgEl.dataset.nbdSignedPath = path;
    get(path)
      .then(url => {
        // Guard against rapid re-assignments swapping the path.
        if (imgEl.dataset.nbdSignedPath === path) imgEl.src = url;
      })
      .catch(err => {
        console.warn('[NBDSignedUrl]', err.message);
        if (typeof opts.onError === 'function') opts.onError(err);
      });
  }

  window.NBDSignedUrl = {
    __sentinel: 'nbd-signed-url-v1',
    get,
    mount,
    // exposed for tests + debug
    _cacheSize: () => cache.size,
    _clear: () => { cache.clear(); }
  };
})();
