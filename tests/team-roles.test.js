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
const { normalizeRole, requireTeamAdmin, callerMayManageTarget, INVITE_ALLOWED_ROLES, TEAM_ROLES, SUBORDINATE_ROLES } = shared;

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }
async function throwsCode(name, p, code) {
  try { await p(); ok(name + ' (expected throw)', false); }
  catch (e) { ok(`${name} → ${code}`, e && e.code === code); }
}
// Assert the caller is NOT rejected by requireTeamAdmin's pre-read guards
// (subordinate-role / cross-company). A legitimate owner/admin gets PAST the
// guards and then either succeeds or — in this plain-node harness, where no
// Firebase app is initialized — fails at the `admin.firestore()` read with a
// non-'permission-denied' error. Either outcome proves the guards let them
// through; only a 'permission-denied' (which can only come from the pre-read
// guards here) is a failure.
async function passesPreReadGuard(name, p) {
  try { await p(); ok(`${name} (reached company read)`, true); }
  catch (e) {
    if (e && e.code === 'permission-denied') ok(`${name} (wrongly rejected pre-read)`, false);
    else ok(`${name} (passed guard, failed at company read)`, true);
  }
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
  ok('SUBORDINATE_ROLES = access-code/member + team subordinates (no owner roles)',
    SUBORDINATE_ROLES instanceof Set
    && ['member', 'manager', 'sales_rep', 'viewer'].every(r => SUBORDINATE_ROLES.has(r))
    && !SUBORDINATE_ROLES.has('company_admin') && !SUBORDINATE_ROLES.has('admin'));

  console.log('\nrequireTeamAdmin — pre-read guards');
  await throwsCode('unauthenticated caller', () => requireTeamAdmin({}), 'unauthenticated');
  await throwsCode('no uid in auth', () => requireTeamAdmin({ auth: { token: {} } }), 'unauthenticated');
  await throwsCode('non-admin managing another company',
    () => requireTeamAdmin({ auth: { uid: 'u1', token: { companyId: 'mine', role: 'sales_rep' } } }, 'other-co'),
    'permission-denied');
  await throwsCode('non-admin (company_admin) still blocked cross-company',
    () => requireTeamAdmin({ auth: { uid: 'u2', token: { companyId: 'co-A', role: 'company_admin' } } }, 'co-B'),
    'permission-denied');

  // ── Access-code solo-owner-fallback escalation (the bug this guards) ──
  // validateAccessCode mints a bare { role: 'member' | 'manager' } claim with
  // NO companyId and creates NO companies/{uid} doc. The solo-owner fallback
  // (`!companySnap.exists && companyId === uid`) would otherwise treat such a
  // caller as owner of companies/{uid} → requireTeamAdmin passes → they could
  // drive createTeamMember / updateUserRole / deactivateUser and self-escalate
  // to company_admin. All of these MUST be rejected before any Firestore read.
  console.log('\nrequireTeamAdmin — access-code subordinate w/o companyId (escalation guard)');
  await throwsCode("access-code 'member' (no companyId) → blocked",
    () => requireTeamAdmin({ auth: { uid: 'attacker', token: { role: 'member' } } }),
    'permission-denied');
  await throwsCode("access-code 'manager' (no companyId) → blocked",
    () => requireTeamAdmin({ auth: { uid: 'attacker', token: { role: 'manager' } } }),
    'permission-denied');
  await throwsCode("'member' explicitly targeting companies/{own uid} → blocked",
    () => requireTeamAdmin({ auth: { uid: 'attacker', token: { role: 'member' } } }, 'attacker'),
    'permission-denied');
  await throwsCode("'sales_rep' (no companyId) → blocked",
    () => requireTeamAdmin({ auth: { uid: 'attacker', token: { role: 'sales_rep' } } }),
    'permission-denied');
  await throwsCode("'viewer' (no companyId) → blocked",
    () => requireTeamAdmin({ auth: { uid: 'attacker', token: { role: 'viewer' } } }),
    'permission-denied');
  await throwsCode("case/whitespace dodge ('  Member ', no companyId) → blocked",
    () => requireTeamAdmin({ auth: { uid: 'attacker', token: { role: '  Member ' } } }),
    'permission-denied');

  // ── Legitimate callers must NOT be caught by the new guard ──
  // These get past the pre-read guards; in this no-Firebase-app harness they
  // then fail at admin.firestore() — which proves the guard let them through.
  console.log('\nrequireTeamAdmin — legitimate callers pass the new guard');
  await passesPreReadGuard("self-signup solo owner (NO role claim, no companyId)",
    () => requireTeamAdmin({ auth: { uid: 'solo', token: {} } }));
  await passesPreReadGuard("global admin (role 'admin', no companyId)",
    () => requireTeamAdmin({ auth: { uid: 'plat', token: { role: 'admin' } } }));
  await passesPreReadGuard("team member WITH companyId managing own company",
    () => requireTeamAdmin({ auth: { uid: 'm1', token: { role: 'manager', companyId: 'co-X' } } }, 'co-X'));
  await passesPreReadGuard("company_admin WITH companyId managing own company",
    () => requireTeamAdmin({ auth: { uid: 'ca1', token: { role: 'company_admin', companyId: 'co-Y' } } }, 'co-Y'));

  // ── Target-side guard: callerMayManageTarget (createTeamMember/updateUserRole/
  //    deactivateUser). The OLD guard `targetClaims.companyId && ... !== companyId`
  //    failed OPEN when the target had no companyId, letting a company_admin of
  //    company A re-role/disable/adopt any no-companyId account cross-tenant.
  console.log('\ncallerMayManageTarget — target-side cross-tenant guard (fail closed)');
  // BLOCKED: no-companyId targets (the bug) — solo owner {} and access-code member.
  ok("no-companyId target {} → NOT manageable by company_admin of 'co-A'",
    callerMayManageTarget({}, 'co-A', false, false) === false);
  ok("access-code member {role:'member'} (no companyId) → NOT manageable",
    callerMayManageTarget({ role: 'member' }, 'co-A', false, false) === false);
  ok("self-keyed {role:'company_admin'} but no companyId → NOT manageable",
    callerMayManageTarget({ role: 'company_admin' }, 'co-A', false, false) === false);
  // BLOCKED: target belonging to a different company.
  ok("target in another company ('co-B') → NOT manageable from 'co-A'",
    callerMayManageTarget({ companyId: 'co-B', role: 'viewer' }, 'co-A', false, false) === false);
  // BLOCKED: degenerate falsy caller company can't match a no-companyId target.
  ok("falsy caller companyId + no-companyId target → NOT manageable",
    callerMayManageTarget({}, '', false, false) === false
    && callerMayManageTarget({}, undefined, false, false) === false);
  // ALLOWED: legitimate cases.
  ok("target already in 'co-A' → manageable from 'co-A'",
    callerMayManageTarget({ companyId: 'co-A', role: 'sales_rep' }, 'co-A', false, false) === true);
  ok("brand-new invitee (justCreated) → manageable (no prior tenant)",
    callerMayManageTarget({}, 'co-A', false, true) === true);
  ok("global admin → manageable regardless of target companyId",
    callerMayManageTarget({ companyId: 'co-B' }, 'co-A', true, false) === true
    && callerMayManageTarget({}, 'co-A', true, false) === true);

  console.log('\n──────────────────────────────────────────────────');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
})();
