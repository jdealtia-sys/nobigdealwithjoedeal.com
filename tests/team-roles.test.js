/**
 * tests/team-roles.test.js — Phase 6 team / multi-tenant / role guards.
 *
 * Unit-tests the REAL guard primitives the admin callables (createTeamMember /
 * updateUserRole / deactivateUser) gate on, imported directly from
 * functions/handlers/_shared.js and run in plain node (where firebase-admin is
 * intact):
 *   - normalizeRole        — blocks 'admin' escalation, rejects unknown roles,
 *                            normalizes case, accepts the 4 team roles
 *   - INVITE_ALLOWED_ROLES / TEAM_ROLES — the allowlists (no 'admin')
 *   - requireTeamAdmin     — unauthenticated → throws; cross-company non-admin
 *                            → throws permission-denied (both fire before any
 *                            Firestore read)
 *
 * Why not drive the callables over the emulator? The functions emulator in this
 * sandbox can't establish auth context (E-1: no credentials → tokens verify as
 * UNAUTHENTICATED), so authenticated callable guards aren't drivable here. The
 * guard LOGIC is verified below; cross-tenant DATA isolation is covered by
 * firestore-rules.cross-tenant.test.js.
 *
 * Zero deps (uses functions/node_modules via the required module). Run:
 *   node tests/team-roles.test.js
 */
'use strict';

const path = require('path');
const shared = require(path.join(__dirname, '..', 'functions', 'handlers', '_shared.js'));
const { normalizeRole, requireTeamAdmin, INVITE_ALLOWED_ROLES, TEAM_ROLES } = shared;

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }
async function throwsCode(name, p, code) {
  try { await p(); ok(name + ' (expected throw)', false); }
  catch (e) { ok(`${name} → ${code}`, e && e.code === code); }
}

(async () => {
  console.log('ROLE NORMALIZATION — normalizeRole');
  ok("'admin' is blocked (escalation) → null", normalizeRole('admin') === null);
  ok("'sales_rep' valid", normalizeRole('sales_rep') === 'sales_rep');
  ok("'company_admin' valid", normalizeRole('company_admin') === 'company_admin');
  ok("'manager' valid", normalizeRole('manager') === 'manager');
  ok("'viewer' valid", normalizeRole('viewer') === 'viewer');
  ok("case-insensitive ('Sales_Rep' → 'sales_rep')", normalizeRole('Sales_Rep') === 'sales_rep');
  ok("whitespace trimmed ('  manager ' → 'manager')", normalizeRole('  manager ') === 'manager');
  ok("unknown role → null", normalizeRole('superuser') === null);
  ok("non-string → null", normalizeRole(123) === null && normalizeRole(null) === null);

  console.log('\nROLE ALLOWLISTS');
  ok('INVITE_ALLOWED_ROLES excludes admin', !INVITE_ALLOWED_ROLES.has('admin'));
  ok('INVITE_ALLOWED_ROLES has the 4 team roles',
    ['company_admin', 'manager', 'sales_rep', 'viewer'].every(r => INVITE_ALLOWED_ROLES.has(r)));
  ok('TEAM_ROLES is exactly the 4 team roles (no admin)',
    JSON.stringify(TEAM_ROLES) === JSON.stringify(['company_admin', 'manager', 'sales_rep', 'viewer']));

  console.log('\nrequireTeamAdmin — pre-read guards');
  await throwsCode('unauthenticated caller', () => requireTeamAdmin({}), 'unauthenticated');
  await throwsCode('no uid in auth', () => requireTeamAdmin({ auth: { token: {} } }), 'unauthenticated');
  await throwsCode('non-admin managing another company',
    () => requireTeamAdmin({ auth: { uid: 'u1', token: { companyId: 'mine', role: 'sales_rep' } } }, 'other-co'),
    'permission-denied');
  await throwsCode('non-admin (company_admin) still blocked cross-company',
    () => requireTeamAdmin({ auth: { uid: 'u2', token: { companyId: 'co-A', role: 'company_admin' } } }, 'co-B'),
    'permission-denied');

  console.log('\n──────────────────────────────────────────────────');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
})();
