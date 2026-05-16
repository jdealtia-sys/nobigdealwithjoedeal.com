// Rock 4 Phase 3 prep: emergency rollback via ?legacy=1 query string.
// Loads /pro/dashboard.legacy.html, which is a snapshot of the
// previous phase's dashboard.html. Each Phase 3+ PR's first step is
// to refresh the snapshot (cp dashboard.html dashboard.legacy.html)
// BEFORE applying its extraction. Convention documented in
// docs/dev/dashboard-decomposition-plan.md. The pathname check
// prevents the legacy snapshot from re-redirecting to itself if a
// bookmarked URL still carries ?legacy=1.
//
// CSP hotfix: was an inline <script> in dashboard.html, blocked by
// `script-src-elem 'self'`. Now loaded as an external classic
// script (non-deferred) so it runs synchronously at parse-time
// like the original inline.
(function(){
  var p = location.pathname.replace(/\.html$/, '');
  if (p === '/pro/dashboard' && new URLSearchParams(location.search).has('legacy')) {
    location.replace('/pro/dashboard.legacy.html' + location.hash);
  }
})();
