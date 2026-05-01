// /pro/js/login-reset.js — recovery escape hatch loaded by login.html.
//
// Visit /pro/login?reset=1 to nuke any stuck service-worker / cache /
// IndexedDB / storage state from a bad deploy. Lives in an external file
// (not inline) because the per-page CSP for /pro/login.html does NOT
// permit 'unsafe-inline' for script-src; same-origin scripts are allowed
// via 'self', so this file works.
//
// No-op for normal users — only does anything when ?reset=1 is in the URL.
(function () {
  try {
    var p = new URLSearchParams(location.search);
    if (!p.has('reset')) return;

    document.documentElement.style.background = '#0A0C0F';
    document.documentElement.style.color = '#fff';

    var done = function () {
      try { localStorage.clear(); } catch (_) {}
      try { sessionStorage.clear(); } catch (_) {}
      location.replace('/pro/login.html');
    };

    var jobs = [];

    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      jobs.push(
        navigator.serviceWorker.getRegistrations()
          .then(function (regs) {
            return Promise.all(regs.map(function (r) { return r.unregister(); }));
          })
          .catch(function () {})
      );
    }

    if (window.caches && caches.keys) {
      jobs.push(
        caches.keys()
          .then(function (keys) {
            return Promise.all(keys.map(function (k) { return caches.delete(k); }));
          })
          .catch(function () {})
      );
    }

    if (window.indexedDB && indexedDB.databases) {
      jobs.push(
        indexedDB.databases()
          .then(function (dbs) {
            return Promise.all((dbs || []).map(function (d) {
              return new Promise(function (res) {
                try {
                  var req = indexedDB.deleteDatabase(d.name);
                  req.onsuccess = req.onerror = req.onblocked = res;
                } catch (_) { res(); }
              });
            }));
          })
          .catch(function () {})
      );
    }

    Promise.all(jobs).then(done, done);
  } catch (_) {
    location.replace('/pro/login.html');
  }
})();
