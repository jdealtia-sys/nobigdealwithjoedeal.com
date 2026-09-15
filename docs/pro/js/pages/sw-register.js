// Tiny service worker registration helper used by the static "simple"
// NBD Pro pages (leaderboard, diagnostic, etc). Replaces an inline
// `<script>if('serviceWorker' in navigator) navigator.serviceWorker.register(...)</script>`
// so strict CSP can drop 'unsafe-inline'.
//
// E4 kill-switch (2026-09-14): the third of three /pro/sw.js registration
// sites. dashboard-sw-bootstrap.js and offline-manager.js both honor
// ?nosw=1 and /pro/nosw.txt (docs/pro/README-killswitch.md); this one
// registered unconditionally, so a page using only this helper had no
// kill-switch at all.
(async function () {
  if (!('serviceWorker' in navigator)) return;
  try {
    const urlKill = new URLSearchParams(location.search).has('nosw');
    let remoteKill = false;
    try {
      const r = await fetch('/pro/nosw.txt', { method: 'HEAD', cache: 'no-store' });
      remoteKill = r.ok;
    } catch (_) { /* network flake — fail safe (SW allowed) */ }
    if (urlKill || remoteKill) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) { try { await r.unregister(); } catch (_) {} }
      return;
    }
  } catch (_) { /* kill-switch check itself failed — fail safe (SW allowed) */ }
  navigator.serviceWorker.register('/pro/sw.js').catch(() => { /* non-fatal */ });
})();
