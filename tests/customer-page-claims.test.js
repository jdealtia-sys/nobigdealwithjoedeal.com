/**
 * tests/customer-page-claims.test.js — customer.html must resolve the caller's
 * tenant claims, or every team-scoped panel silently degrades to owner-only.
 *
 * THE BUG: window._userClaims is the tenant/role record that the team-scoped
 * readers on this page branch on. Its only three writers repo-wide —
 * billing-gate.js, dashboard-bootstrap.module.js, nbd-auth.js — are all
 * dashboard-side, and NONE of them is loaded on customer.html. So the value
 * stayed undefined there and every consumer's `window._userClaims || {}`
 * fallback silently selected the owner-only branch of a deliberate
 * owner-vs-team fork.
 *
 * It is invisible to a solo operator (companyId === uid makes both branches
 * identical) and wrong for everyone else. A company_admin or manager opening a
 * rep's job saw:
 *   - "💰 No invoices yet"            (customer-tasks-ui.js loadInvoices)
 *   - an empty Communication Log      (customer-tasks-ui.js)
 *   - an empty photo gallery          (customer-bootstrap.module.js)
 *   - understated job costs           (profit-tracker.js _fetchLeadExpenses)
 *   - "Read-only — this customer belongs to a teammate."
 * Firestore would have served all of it; the queries just never asked for the
 * team scope.
 *
 * This is the same page-scoped-dependency class as #1110 and #1111 — a value
 * defined only on some pages, consumed behind a `|| {}` guard that turns
 * "missing" into "wrong" instead of into an error.
 *
 * Zero deps.  Run: node tests/customer-page-claims.test.js
 */
'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PRO_JS = path.join(ROOT, 'docs/pro/js');
const read = (p) => fs.readFileSync(path.join(PRO_JS, p), 'utf8');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('CUSTOMER PAGE — tenant claims resolve, team scope works');

const BOOT = read('customer-bootstrap.module.js');
const CUSTOMER_HTML = fs.readFileSync(path.join(ROOT, 'docs/pro/customer.html'), 'utf8');

// ── 1. The page must populate the claims itself ───────────────────────
{
  ok('customer bootstrap resolves claims from the ID token',
    /getIdTokenResult\(\)/.test(BOOT) && /window\._userClaims =/.test(BOOT),
    'nothing on customer.html sets window._userClaims');

  // Ordering: the hydration below reads the team branches, so resolving the
  // claims after it would still render the owner-only view.
  const claimsAt = BOOT.indexOf('getIdTokenResult()');
  const hydrateAt = BOOT.indexOf('async function hydrate');
  ok('claims resolve before hydration reads them',
    claimsAt > -1 && (hydrateAt === -1 || claimsAt < hydrateAt));

  ok('a token failure degrades to owner scope rather than blocking the page',
    /catch \(_\) \{\s*window\._userClaims = window\._userClaims \|\| \{\};/.test(BOOT));

  // The writers this page cannot rely on — assert they are still absent, so
  // this test explains WHY the bootstrap has to do it rather than looking
  // redundant later.
  for (const f of ['billing-gate.js', 'dashboard-bootstrap.module.js', 'nbd-auth.js']) {
    ok(`customer.html still does not load ${f} (hence the local resolve)`,
      !CUSTOMER_HTML.includes('js/' + f));
  }
}

// ── 2. The consumers' team branches are still there to be enabled ─────
{
  const tasks = read('customer-tasks-ui.js');
  ok('invoices panel still has a company-scoped branch',
    /teamScope[\s\S]{0,400}where\('companyId', '==', companyId\)/.test(tasks),
    'if this fork is gone the claims fix has nothing to enable');
  const profit = read('profit-tracker.js');
  ok('profit panel still has a company-scoped branch',
    /where\('companyId', '==', claims\.companyId\)/.test(profit));
}

// ── 3. The read-only banner must not fire on an unresolved role ───────
{
  ok('an UNKNOWN role no longer reads as read-only',
    /!!_roRole && !_roIsOwner && !_roIsStaff/.test(BOOT),
    "with claims unresolved this collapsed to !_roIsOwner, so a company_admin who can edit was told the record belongs to a teammate");
  ok("'viewer' is still asserted positively (a real, rules-enforced restriction)",
    /_roRole === 'viewer'\s*\|\|/.test(BOOT));
}

// ── 4. companyId stamping on the two writers that omitted it ──────────
{
  // /reports create REQUIRES companyId (string, non-empty) — pinned there so a
  // crafted write cannot inject a report into another tenant's team-visible
  // feed. window._saveReport never stamped it, so every save through it was
  // rejected, and the error was swallowed (return null) — making a rejection
  // indistinguishable from success to the caller.
  const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
  ok('the /reports rule still requires a non-empty companyId',
    /request\.resource\.data\.companyId is string/.test(rules),
    'if this relaxes, the stamp below stops being load-bearing');

  // NOTE: _saveReport lives in DASHBOARD-bootstrap, not the customer one —
  // BOOT above is customer-bootstrap.module.js and does not contain it.
  const DASH_BOOT = read('dashboard-bootstrap.module.js');
  const _sfStart = DASH_BOOT.indexOf('window._saveReport');
  const saveFn = DASH_BOOT.slice(_sfStart, _sfStart + 4000);
  ok('_saveReport stamps companyId',
    /const companyId = window\._userClaims\?\.companyId \|\| uid;/.test(saveFn)
    && /\bcompanyId,/.test(saveFn));
  ok('_saveReport no longer swallows a failed write', /throw e;/.test(saveFn));

  // ...but the caller must not lose the rendered report over a failed persist.
  // The rep asked to SEE the report; dropping the render because the write
  // failed would be the worse outcome.
  const rep = read('rep-report-generator.js');
  ok('the report still renders when the save fails',
    /catch \(saveErr\)/.test(rep) && /Report generated, but couldn't be saved/.test(rep));

  // Estimates logged from the customer page: the create rule PERMITS companyId
  // to be absent, so omitting it failed at READ time instead — the team
  // estimates listener queries where('companyId','==',claims.companyId), so
  // the estimate was invisible to every teammate, permanently.
  const cprg = read('customer-photo-report-generator.js');
  ok('customer-page Log Estimate stamps companyId',
    /companyId: window\._userClaims\?\.companyId/.test(cprg));
}

console.log('\n──────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
