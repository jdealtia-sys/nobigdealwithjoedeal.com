// Tiny service worker registration helper used by the static "simple"
// NBD Pro pages (leaderboard, diagnostic, etc). Replaces an inline
// `<script>if('serviceWorker' in navigator) navigator.serviceWorker.register(...)</script>`
// so strict CSP can drop 'unsafe-inline'.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/pro/sw.js').catch(() => { /* non-fatal */ });
}
