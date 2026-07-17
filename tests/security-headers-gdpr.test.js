/**
 * tests/security-headers-gdpr.test.js — Phase 13 CSP/security headers + GDPR.
 *
 * Two compliance-critical, headless-verifiable surfaces:
 *
 *  1. CSP & security headers (firebase.json hosting.headers) — the codebase has
 *     a history of CSP hotfixes, so we assert the global policy is strict
 *     (script-src has NO 'unsafe-inline'/'unsafe-eval'; object-src/base-uri/
 *     frame-ancestors 'none'; HSTS preload; nosniff; DENY framing) AND that the
 *     invariant holds for EVERY enforced CSP header (incl. per-page overrides).
 *
 *  2. GDPR erasure/export registry (functions/integrations/user-owned.js
 *     FLAT_USER_COLLECTIONS) — the single source of truth for which collections
 *     get exported + erased. A PII collection missing here is a silent
 *     compliance gap, so we assert coverage of the known PII collections + the
 *     documented shape (leads recursive, invoices keyed on createdBy).
 *
 * Zero deps. Run: node tests/security-headers-gdpr.test.js
 */
'use strict';

const path = require('path');
const fb = require(path.join(__dirname, '..', 'firebase.json'));
const userOwned = require(path.join(__dirname, '..', 'functions', 'integrations', 'user-owned.js'));

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

const rules = fb.hosting.headers;
const headerVal = (rule, key) => (rule.headers.find(h => h.key.toLowerCase() === key.toLowerCase()) || {}).value;
function parseCSP(str) {
  const out = {};
  str.split(';').map(s => s.trim()).filter(Boolean).forEach(d => {
    const [name, ...toks] = d.split(/\s+/);
    out[name] = toks;
  });
  return out;
}

// ── 1. CSP & security headers ────────────────────────────────
console.log('SECURITY HEADERS — global ** rule');
const global = rules.find(r => r.source === '**');
ok('global ** header rule exists', !!global);
ok('X-Content-Type-Options: nosniff', headerVal(global, 'X-Content-Type-Options') === 'nosniff');
ok('X-Frame-Options: DENY', headerVal(global, 'X-Frame-Options') === 'DENY');
ok('Referrer-Policy present', !!headerVal(global, 'Referrer-Policy'));
ok('Cross-Origin-Opener-Policy: same-origin', headerVal(global, 'Cross-Origin-Opener-Policy') === 'same-origin');
{
  const hsts = headerVal(global, 'Strict-Transport-Security') || '';
  const maxAge = (hsts.match(/max-age=(\d+)/) || [])[1];
  ok('HSTS max-age >= 1 year', Number(maxAge) >= 31536000);
  ok('HSTS includeSubDomains + preload', /includeSubDomains/.test(hsts) && /preload/.test(hsts));
}

console.log('\nCONTENT SECURITY POLICY — global directives');
const gcsp = parseCSP(headerVal(global, 'Content-Security-Policy'));
ok("default-src 'self'", (gcsp['default-src'] || []).includes("'self'"));
ok("object-src 'none'", JSON.stringify(gcsp['object-src']) === JSON.stringify(["'none'"]));
ok("base-uri 'none'", JSON.stringify(gcsp['base-uri']) === JSON.stringify(["'none'"]));
ok("frame-ancestors 'none' (clickjacking guard)", JSON.stringify(gcsp['frame-ancestors']) === JSON.stringify(["'none'"]));
ok("script-src includes 'self'", (gcsp['script-src'] || []).includes("'self'"));
ok("script-src has NO 'unsafe-inline'", !(gcsp['script-src'] || []).includes("'unsafe-inline'"));
ok("script-src has NO 'unsafe-eval'", !(gcsp['script-src'] || []).includes("'unsafe-eval'"));
ok("script-src-attr 'none' (no inline event handlers)", (gcsp['script-src-attr'] || []).includes("'none'"));

console.log('\nCSP INVARIANT — every enforced CSP across all pages');
// F-4 (Audit #3 → Audit #2): /pro/customer still allows 'unsafe-inline' in
// script-src because customer.html ships 9 un-extracted inline <script> blocks
// (the CSP hardening done for login/dashboard was never finished there). It's a
// PII-rendering page, so this weakens its XSS posture. Tracked as a known
// exception here; this stays a REGRESSION GUARD — any OTHER page that introduces
// unsafe-inline fails the build, and removing the customer exception (once
// hardened) also flags so the list is kept honest.
const KNOWN_UNSAFE_EXCEPTIONS = ['/pro/customer'];
let cspCount = 0; const offenders = [];
for (const rule of rules) {
  const csp = headerVal(rule, 'Content-Security-Policy');
  if (!csp) continue;
  cspCount++;
  const p = parseCSP(csp);
  for (const dir of ['script-src', 'script-src-elem']) {
    const toks = p[dir] || [];
    if (toks.includes("'unsafe-inline'") || toks.includes("'unsafe-eval'")) { offenders.push(rule.source); break; }
  }
}
ok(`found multiple enforced CSP headers (${cspCount})`, cspCount >= 5);
ok(`only the known exception(s) allow unsafe script (offenders: ${offenders.join(', ') || 'none'})`,
  offenders.every(s => KNOWN_UNSAFE_EXCEPTIONS.includes(s)));
ok('global policy + login/register/stripe-success are strict (no unsafe script)',
  !offenders.includes('**') && !offenders.includes('/pro/login') && !offenders.includes('/pro/register') && !offenders.includes('/pro/stripe-success'));

// strict per-page overrides exist for the sensitive pages — keyed to the
// CANONICAL extensionless sources (cleanUrls strips .html before header
// matching, so a .html-keyed rule never fires; re-keyed 2026-07-16).
for (const src of ['/pro/login', '/pro/register', '/pro/stripe-success']) {
  const rule = rules.find(r => r.source === src && headerVal(r, 'Content-Security-Policy'));
  const csp = rule && headerVal(rule, 'Content-Security-Policy');
  ok(`${src} ships its own strict CSP`, !!csp && !parseCSP(csp)['script-src'].includes("'unsafe-inline'"));
}

// the header sources must never regress to dead .html keys
ok('no header rule is keyed to a /pro or /admin .html source (dead under cleanUrls)',
  !rules.some(r => /^\/(pro|admin)\/.*\.html$/.test(r.source)));

// private /pro app pages carry the authoritative noindex header
{
  const noindexSources = rules
    .filter(r => (headerVal(r, 'X-Robots-Tag') || '').includes('noindex'))
    .map(r => r.source);
  for (const page of ['dashboard', 'vault', 'login', 'register', 'customer', 'analytics', 'leaderboard', 'demo', 'stripe-success']) {
    ok(`/pro/${page} is covered by an X-Robots-Tag noindex rule`,
      noindexSources.some(s => s === `/pro/${page}` || (s.startsWith('/pro/@(') && s.includes(page))));
  }
}

// ── 2. GDPR erasure/export registry ──────────────────────────
console.log('\nGDPR REGISTRY — FLAT_USER_COLLECTIONS coverage');
const reg = userOwned.FLAT_USER_COLLECTIONS;
const names = reg.map(c => c.name);
ok('registry is a non-trivial list (>=20 collections)', reg.length >= 20);
const mustCover = ['leads', 'estimates', 'photos', 'tasks', 'notes', 'communications', 'invoices', 'knocks', 'documents', 'appointments', 'measurements', 'notifications'];
for (const c of mustCover) ok(`erasure/export covers PII collection "${c}"`, names.includes(c));
ok('leads is recursive (subcollections cascade)', reg.find(c => c.name === 'leads').recursive === true);
ok('invoices keyed on createdBy (documented exception)', reg.find(c => c.name === 'invoices').ownerField === 'createdBy');
ok('no duplicate collection entries', new Set(names).size === names.length);
ok('storage prefixes are part of erasure (user files)', Array.isArray(userOwned.STORAGE_PREFIXES) && userOwned.STORAGE_PREFIXES.length > 0);

// Every collectionGroup the erasure/export cascade sweeps by userId
// (collectionGroup(g).where('userId','==')) needs a SINGLE-FIELD
// COLLECTION_GROUP index on userId. A composite like [userId, recordedAt]
// does NOT serve the equality-only query (it orders by __name__), so a
// missing override makes the sweep throw FAILED_PRECONDITION — which
// compliance.js swallows, silently leaving those rows un-erased/un-exported.
console.log('\nGDPR REGISTRY — collectionGroup sweeps have a COLLECTION_GROUP index');
{
  const idxSpec = require(path.join(__dirname, '..', 'firestore.indexes.json'));
  const overrides = idxSpec.fieldOverrides || [];
  for (const g of userOwned.COLLECTION_GROUPS_WITH_USERID) {
    const covered = overrides.some(f => f.collectionGroup === g && f.fieldPath === 'userId'
      && (f.indexes || []).some(i => i.queryScope === 'COLLECTION_GROUP'));
    ok(`collectionGroup "${g}".userId has a COLLECTION_GROUP single-field index`, covered);
  }
}

console.log('\n──────────────────────────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
