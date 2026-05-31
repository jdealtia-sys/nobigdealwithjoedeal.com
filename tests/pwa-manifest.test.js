/**
 * tests/pwa-manifest.test.js — Phase 11 PWA / offline / service worker.
 *
 * Static-but-real integrity checks that catch install-breaking PWA regressions:
 *   - manifest.json (pro + root): valid JSON, required install fields, 192/512 +
 *     maskable icons whose files actually exist on disk, valid theme colors,
 *     start_url inside scope.
 *   - sw.js: parses, declares a shell cache version, wires install/activate/
 *     fetch handlers, every precached URL exists on disk, and NO_CACHE_HTML
 *     excludes the auth-gated + destructive pages (post-logout stale-shell leak
 *     guard). Offline-queue behaviour itself is IndexedDB/browser → needs-browser.
 *
 * Zero deps. Run: node tests/pwa-manifest.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const docPath = (url) => path.join(ROOT, 'docs', url.replace(/^\//, ''));
const isHex = (s) => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

function checkManifest(rel, { scope } = {}) {
  console.log(`MANIFEST — ${rel}`);
  const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  let m = null; try { m = JSON.parse(raw); } catch {}
  ok(`${rel} is valid JSON`, !!m);
  if (!m) return;
  for (const f of ['name', 'short_name', 'start_url', 'display', 'icons']) {
    ok(`${rel} has "${f}"`, m[f] !== undefined);
  }
  ok(`${rel} display is a standalone-capable mode`, ['standalone', 'fullscreen', 'minimal-ui'].includes(m.display));
  ok(`${rel} theme_color is valid hex`, isHex(m.theme_color));
  ok(`${rel} background_color is valid hex`, isHex(m.background_color));
  ok(`${rel} has >=1 icon`, Array.isArray(m.icons) && m.icons.length >= 1);
  const sizes = (m.icons || []).map(i => i.sizes);
  ok(`${rel} has a 192x192 icon`, sizes.includes('192x192'));
  ok(`${rel} has a 512x512 icon`, sizes.includes('512x512'));
  ok(`${rel} has a maskable icon`, (m.icons || []).some(i => /maskable/.test(i.purpose || '')));
  for (const ic of (m.icons || [])) {
    ok(`${rel} icon file exists: ${ic.src}`, fs.existsSync(docPath(ic.src)));
  }
  if (scope) ok(`${rel} start_url is within scope ${scope}`, m.start_url.startsWith(scope));
}

checkManifest('docs/pro/manifest.json', { scope: '/pro/' });
checkManifest('docs/manifest.json');

// ── Service worker ──
console.log('\nSERVICE WORKER — docs/pro/sw.js');
const swFile = path.join(ROOT, 'docs/pro/sw.js');
let syntaxOk = true;
try { execSync(`node --check "${swFile}"`, { stdio: 'pipe' }); } catch { syntaxOk = false; }
ok('sw.js parses (node --check)', syntaxOk);

const sw = fs.readFileSync(swFile, 'utf8');
ok('declares a shell cache version', /shell:\s*'nbd-shell-v\d+'/.test(sw));
ok('wires install handler', /addEventListener\(\s*'install'/.test(sw));
ok('wires activate handler (old-cache cleanup)', /addEventListener\(\s*'activate'/.test(sw));
ok('wires fetch handler', /addEventListener\(\s*'fetch'/.test(sw));

// precache list — every URL must exist on disk (a missing one fails SW install)
const addAll = sw.match(/addAll\(\[([\s\S]*?)\]\)/);
ok('has a precache addAll() list', !!addAll);
if (addAll) {
  const urls = [...addAll[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  ok('precache list is non-empty', urls.length > 0);
  for (const u of urls) ok(`precached file exists: ${u}`, fs.existsSync(docPath(u)));
}

// security: auth-gated + destructive pages must be in NO_CACHE_HTML
const noCache = sw.match(/NO_CACHE_HTML\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
ok('declares NO_CACHE_HTML set', !!noCache);
if (noCache) {
  const block = noCache[1];
  for (const p of ['/pro/dashboard.html', '/pro/login.html', '/pro/customer.html', '/pro/vault.html', '/pro/register.html']) {
    ok(`NO_CACHE_HTML excludes auth-gated ${p}`, block.includes(`'${p}'`));
  }
  ok('NO_CACHE_HTML excludes destructive account-erasure', /account-erasure/.test(block));
}

console.log('\n──────────────────────────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
