#!/usr/bin/env node
/**
 * turnstile-contract.test.js
 *
 * System-stability audit 2026-08-07: the Turnstile client/server pair has a
 * fail-closed landmine. The server (functions/integrations/turnstile.js)
 * rejects every tokenless submission the moment TURNSTILE_SECRET is set (or
 * TURNSTILE_REQUIRED=true), while the client sitekey
 * (docs/assets/js/inline/7cd8e505ab.js) ships EMPTY on all four public lead
 * form pages — so "set the secret first" silently 403s 100% of public leads.
 *
 * CI cannot see prod secrets, so this contract pins every piece that keeps
 * the half-wired states impossible to ship silently:
 *   1. The sitekey stub parses, and every lead-form page loads it BEFORE
 *      public-lead-submit.js (the executor reads it at submit time).
 *   2. EMPTY sitekey ⇒ zero static .cf-turnstile widgets on the served
 *      surface (a widget without a key renders a dead challenge box) and the
 *      client keeps its graceful no-key path.
 *   3. NON-EMPTY sitekey ⇒ the auto-widget executor path is intact, so no
 *      per-page markup is required.
 *   4. The server keeps all three posture branches: unconfigured
 *      passthrough, TURNSTILE_REQUIRED fail-closed, verify-error fail-closed
 *      — plus the bounded verify fetch.
 *   5. The deployment-order warning stays in the stub (it is the only place
 *      a human touches when wiring the real key).
 *
 * Zero dependencies. Run: node tests/turnstile-contract.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const fails = [];
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name); }
}
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

const STUB_REL = 'docs/assets/js/inline/7cd8e505ab.js';
const stub = read(STUB_REL);

// ── 1. Sitekey stub parses; form pages load it before the submit helper ──
const keyMatch = stub.match(/window\.__NBD_TURNSTILE_SITEKEY\s*=\s*"([^"]*)"/);
ok('sitekey stub has a parseable window.__NBD_TURNSTILE_SITEKEY assignment', !!keyMatch);
const siteKey = keyMatch ? keyMatch[1].trim() : '';

const FORM_PAGES = [
  'docs/index.html',
  'docs/estimate.html',
  'docs/storm-alerts.html',
  'docs/sites/free-guide/index.html',
];
for (const page of FORM_PAGES) {
  const html = read(page);
  const stubAt = html.indexOf('7cd8e505ab.js');
  const submitAt = html.indexOf('public-lead-submit.js');
  ok(page + ' loads the sitekey stub', stubAt !== -1);
  ok(page + ' loads public-lead-submit.js', submitAt !== -1);
  ok(page + ' loads the stub BEFORE public-lead-submit.js',
     stubAt !== -1 && submitAt !== -1 && stubAt < submitAt);
}

// ── 2/3. Widget markup must match the key state ──
{
  const SKIP = new Set(['pro', 'admin', 'dev', 'node_modules']);
  const widgetPages = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name)) walk(path.join(dir, entry.name));
        continue;
      }
      if (!/\.html$/.test(entry.name)) continue;
      const p = path.join(dir, entry.name);
      if (/class="[^"]*cf-turnstile\b/.test(fs.readFileSync(p, 'utf8'))) {
        widgetPages.push(path.relative(ROOT, p));
      }
    }
  })(path.join(ROOT, 'docs'));

  if (siteKey === '') {
    ok('empty sitekey ⇒ no static .cf-turnstile widget on the served surface' +
       (widgetPages.length ? ' — found: ' + widgetPages.join(', ') : ''),
       widgetPages.length === 0);
  } else {
    // Key populated: widgets are optional (the executor auto-creates an
    // invisible one), but any hand-placed widget must not pin a different key.
    const mismatched = widgetPages.filter((p) => {
      const html = read(p);
      const m = html.match(/class="[^"]*cf-turnstile[^"]*"[^>]*data-sitekey="([^"]*)"/);
      return m && m[1] && m[1] !== siteKey;
    });
    ok('populated sitekey ⇒ no widget pins a different data-sitekey' +
       (mismatched.length ? ' — found: ' + mismatched.join(', ') : ''),
       mismatched.length === 0);
  }
}

// Client executor keeps the graceful no-key path and the auto-widget path.
{
  const helper = read('docs/assets/js/public-lead-submit.js');
  ok('client skips the Turnstile script load when no key and no widget',
     /if \(!hasKey && !hasWidget\) return resolve\(false\);/.test(helper));
  ok('client auto-creates the invisible widget container when a key exists',
     /cf-turnstile-auto/.test(helper) && /document\.createElement\('div'\)/.test(helper));
  ok('client only attaches turnstileToken when a token was obtained',
     /if \(turnstileToken\) payload\.turnstileToken = turnstileToken;/.test(helper));
  ok('client executor failure resolves empty (never throws into the form path)',
     /'error-callback': \(\) => resolve\(''\)/.test(helper));
}

// ── 4. Server posture branches ──
{
  const server = read('functions/integrations/turnstile.js');
  ok('server keeps the unconfigured passthrough (secret unset ⇒ allow)',
     /return \{ ok: true, configured: false \};/.test(server));
  ok('server keeps the TURNSTILE_REQUIRED fail-closed branch',
     /TURNSTILE_REQUIRED/.test(server) && /reason: 'turnstile-required'/.test(server));
  ok('server rejects short/absent tokens when configured',
     /token\.length < 10/.test(server) && /reason: 'missing-token'/.test(server));
  ok('server fails CLOSED on verifier error',
     /reason: 'verify-error'/.test(server));
  ok('server verify fetch is time-bounded',
     /AbortSignal\.timeout\(/.test(server));
}

// ── 5. Deployment-order warning stays where the human will look ──
ok('sitekey stub carries the populate-key-BEFORE-secret deployment warning',
   /BEFORE TURNSTILE_SECRET/.test(stub));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('Failures:\n' + fails.map((f) => '  - ' + f).join('\n'));
  process.exit(1);
}
