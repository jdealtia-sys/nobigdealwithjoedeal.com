#!/usr/bin/env node
/*
 * Replace the full nav with a minimal "tool nav" on conversion/tool pages:
 *   /estimate, /visualizer, /storm-alerts
 *
 * Tool nav = logo (exit to /) + small "Home" exit link + "Call Joe" CTA.
 * Keep everything else on these pages intact (progress bars, body, footer).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'docs');

const TARGETS = ['estimate.html', 'visualizer.html', 'storm-alerts.html'];

const MIN_NAV = `<nav id="mainNav" class="nav tool-nav">
  <a href="/" class="nav-logo">
    <img src="/assets/images/nbd-logo.png" alt="No Big Deal Home Solutions" style="height:42px;width:auto;border-radius:6px;">
    <div class="nav-logo-text">
      <div class="brand">NO BIG DEAL</div>
      <div class="sub">Home Solutions</div>
    </div>
  </a>
  <div class="tool-nav-right">
    <a href="/" class="tool-nav-home">
      <svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;stroke-width:2.2;fill:none;stroke-linecap:round;stroke-linejoin:round;vertical-align:-2px;margin-right:4px"><polyline points="15 18 9 12 15 6"/></svg>Back to site
    </a>
    <a href="tel:8594207382" class="nav-cta">
      <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:currentColor;vertical-align:-2px;margin-right:6px"><path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.36 2.3.56 3.6.56.55 0 1 .45 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.56 3.6a1 1 0 0 1-.25 1z"/></svg>Call Joe
    </a>
  </div>
</nav>`;

const TOOL_NAV_CSS = `
/* tool-nav minimal chrome (injected) */
nav.tool-nav{position:sticky;top:0;z-index:1000;background:var(--navy-dark,#142a52);border-bottom:3px solid var(--orange,#e8720c);padding:0 5%;display:flex;align-items:center;justify-content:space-between;height:70px}
nav.tool-nav .nav-logo{display:flex;align-items:center;gap:10px;text-decoration:none}
nav.tool-nav .nav-logo-text .brand{font-size:1rem;font-weight:800;color:#fff}
nav.tool-nav .nav-logo-text .sub{font-size:.7rem;color:rgba(255,255,255,.6);font-weight:500}
nav.tool-nav .tool-nav-right{display:flex;align-items:center;gap:22px}
nav.tool-nav .tool-nav-home{color:rgba(255,255,255,.7);font-size:.78rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;text-decoration:none;transition:color .2s;display:inline-flex;align-items:center}
nav.tool-nav .tool-nav-home:hover{color:var(--orange-light,#f08030)}
nav.tool-nav .nav-cta{background:var(--orange,#e8720c);color:#fff!important;padding:10px 20px;border-radius:6px;font-weight:700;font-size:.82rem;letter-spacing:.04em;text-decoration:none;display:inline-flex;align-items:center;transition:background .2s}
nav.tool-nav .nav-cta:hover{background:var(--orange-dark,#c45e08)}
@media(max-width:560px){
  nav.tool-nav .tool-nav-home{display:none}
}
`;

// Match full <nav id="mainNav" ...>...</nav> block (no nested <nav>, so greedy-to-close is safe).
const NAV_RE = /<nav id="mainNav"[^>]*>[\s\S]*?<\/nav>/;

let touched = 0;
for (const name of TARGETS) {
  const file = path.join(ROOT, name);
  const orig = fs.readFileSync(file, 'utf8');
  if (!NAV_RE.test(orig)) { console.log('skip (no mainNav):', name); continue; }
  let next = orig.replace(NAV_RE, MIN_NAV);
  if (!/tool-nav minimal chrome \(injected\)/.test(next) && /<\/head>/.test(next)) {
    next = next.replace(/<\/head>/, '<style>' + TOOL_NAV_CSS + '</style>\n</head>');
  }
  if (next !== orig) { fs.writeFileSync(file, next); touched++; }
}
console.log(JSON.stringify({ touched }, null, 2));
