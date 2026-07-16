/**
 * tests/gauntlet-regressions.test.js — locks in the 2026-07-16 stranger-
 * gauntlet Fix Batch 1 (invite-claim flag, seat/billing gates, tenant-zero
 * brand leaks, invitee register bypass, CI gate).
 *
 * Part A imports the real seatLimitForPlan via functions/handlers/invites.js
 * _test export (needs functions/node_modules installed — same requirement as
 * the smoke suite). Part B is source-contract regex guards in the repo's
 * smoke idiom: they pin the FIX SHAPES so a refactor can't silently revert
 * the gauntlet blockers.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let passed = 0, failed = 0;
const fails = [];
function assert(name, cond, hint) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name + (hint ? ' — ' + hint : '')); console.log('  ✗ ' + name); }
}

// ── Part A: seatLimitForPlan matrix (real import) ─────────────────────
console.log('seatLimitForPlan — plan → invited-seat matrix');
{
  const { _test } = require(path.join(ROOT, 'functions/handlers/invites.js'));
  const f = _test.seatLimitForPlan;
  assert('free → 0 invite seats', f('free') === 0);
  assert('starter → 0 invite seats (solo: 1 user total)', f('starter') === 0);
  assert('growth → 5 invite seats', f('growth') === 5);
  assert('enterprise → Infinity', f('enterprise') === Infinity);
  assert('unknown plan falls back to free (0)', f('definitely-not-a-plan') === 0);
  assert('undefined plan falls back to free (0)', f(undefined) === 0);
}

// ── Part B: source-contract guards ────────────────────────────────────
console.log('\nInvite lifecycle — past_due entitlement + invitee email link');
{
  const src = read('functions/handlers/invites.js');
  assert('past_due keeps seat entitlement during dunning',
    /subData\.status === 'active' \|\| subData\.status === 'trialing'\s*\|\| subData\.status === 'past_due'/.test(src),
    'a paying owner mid-dunning must not get the free-tier "solo" refusal');
  assert('invite email (HTML) links register.html?invite=1',
    /register\.html\?invite=1/.test(src) && src.indexOf('register.html?invite=1') !== src.lastIndexOf('register.html?invite=1'),
    'both the HTML button and the text fallback must carry the invite marker');
}

console.log('\nremoveMember — pending-invite cancel frees the seat');
{
  const src = read('functions/handlers/admin.js');
  assert('pending-invite state detected (status invited, no uid)',
    /isPendingInvite = member\.status === 'invited' && !lookupUid/.test(src));
  assert('foreign-claim guard exempts pending invites from the throw',
    /if \(!managesTarget && !isPendingInvite\)/.test(src),
    'cancelling an invite whose recipient registered elsewhere must not throw');
  assert('claim mutation still gated on managesTarget',
    /if \(managesTarget\) \{[\s\S]{0,400}setCustomUserClaims/.test(src),
    'never strip claims of an account scoped to another company');
}

console.log('\nCompany-keyed billing reads (AI surfaces)');
{
  const ai = read('functions/handlers/ai.js');
  assert('ai.js resolves billingKey = companyId || uid',
    /billingKey = decoded\.companyId \|\| decoded\.uid/.test(ai)
    && /subscriptions\/\$\{billingKey\}/.test(ai));
  assert('ai.js accepts trialing as paid',
    /sub\.status === 'active' \|\| sub\.status === 'trialing'/.test(ai),
    'a Growth trial is the conversion window — AI must work during it');
  const pv = read('functions/photo-vision.js');
  assert('photo-vision.js plan read keyed by companyId claim',
    /billingKey = \(request\.auth\.token && request\.auth\.token\.companyId\) \|\| uid/.test(pv)
    && /subscriptions\/\$\{billingKey\}/.test(pv));
  const rv = read('functions/receipt-vision.js');
  assert('receipt-vision.js plan read keyed by companyId claim',
    /billingKey = \(request\.auth\.token && request\.auth\.token\.companyId\) \|\| uid/.test(rv)
    && /subscriptions\/\$\{billingKey\}/.test(rv));
}

console.log('\nInvite-claim flag — uid-keyed, sign-out cleared, young-account grace');
{
  const boot = read('docs/pro/js/dashboard-bootstrap.module.js');
  assert('invite-checked flag is keyed by uid',
    /'nbd_invite_checked_' \+ user\.uid/.test(boot),
    'device-global flag bricked shared devices + out-of-order signups');
  assert('rep-activated flag is keyed by uid',
    /'nbd_rep_activated_' \+ user\.uid/.test(boot));
  assert('sign-out clears both flag families',
    /_signOut[\s\S]{0,700}nbd_invite_checked[\s\S]{0,200}nbd_rep_activated[\s\S]{0,200}removeItem/.test(boot));
  assert("young accounts keep re-checking on 'no_invite'",
    /out\.reason === 'no_invite' && _youngAccount/.test(boot),
    'a fresh signup often precedes the invite — no_invite must not be terminal for 14 days');
  assert('unverified-email invite failure renders the banner + resend',
    /nbdVerifyBanner/.test(boot) && /sendEmailVerification\(user\)/.test(boot),
    'console-only failure left reps believing they had joined');
}

console.log('\nManual invite-claim recovery (Team tab)');
{
  const html = read('docs/pro/dashboard.html');
  assert('dashboard has the "Check my invite now" action',
    /data-team-action="checkMyInvite"/.test(html) && /id="inviteCheckResult"/.test(html));
  const tab = read('docs/pro/js/dashboard-team-tab.js');
  assert('checkMyInvite delegate calls claimInvite directly',
    /checkMyInvite/.test(tab) && /_teamCallable\('claimInvite'/.test(tab));
  assert('recovery delegate guarded against re-hydration double-wiring',
    /_NBD_INVITE_CHECK_DELEGATE/.test(tab));
}

console.log('\nInvitee register bypass (?invite=1)');
{
  const reg = read('docs/pro/js/pages/register.js');
  assert('invite intent parsed from ?invite=1',
    /get\('invite'\) === '1'/.test(reg));
  assert('email path: invitees skip solo provisioning + owner wizard',
    /if \(inviteIntent\) \{\s*window\.location\.replace\('\/pro\/dashboard\.html'\);/.test(reg));
  assert('google path: invitees not provisioned, routed to dashboard',
    /isNewUser && !inviteIntent/.test(reg)
    && /\(!code && isNewUser && !inviteIntent\) \? '\/pro\/onboarding\.html'/.test(reg));
  assert('google + access-code path provisions a tenant (#945 parity)',
    /signInWithCustomToken\(auth, result\.data\.customToken\);[\s\S]{0,700}createCompanyFn\(/.test(reg),
    'paid code-holders on the Google branch landed with no companies doc/claims');
}

console.log('\nTenant-zero brand leak — letterhead tagline');
{
  const dg = read('docs/pro/js/document-generator.js');
  assert('_letterhead tagline gated on NBD identity (non-NBD: C.tagline only)',
    /tagline: esc\(\(C\.name === 'No Big Deal Home Solutions'\)[\s\S]{0,120}: \(C\.tagline \|\| ''\)\)/.test(dg),
    "cp.tagline falls through merged defaults to NBD's tagline on stranger paper");
}

console.log('\nCI gate — @stranger shard is required');
{
  const ci = read('.github/workflows/ci.yml');
  assert('continue-on-error exempts the @stranger shard',
    /continue-on-error: \$\{\{ matrix\.shard != '@stranger' \}\}/.test(ci),
    'the only runtime proof of stranger self-provisioning must gate merges');
  assert('this suite runs in CI',
    /gauntlet-regressions\.test\.js/.test(ci),
    'add a node tests/gauntlet-regressions.test.js step to ci.yml');
}

console.log('\nMembers roster rules — same-company claim read');
{
  const rules = read('firestore.rules');
  assert('members read grants same-company claim holders',
    /allow read: if isAdmin\(\)[\s\S]{0,400}request\.auth\.token\.companyId == companyId/.test(rules));
  const rulesCode = rules.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert('dead uid==memberId grant removed (docs are keyed by email)',
    !/request\.auth\.uid == memberId/.test(rulesCode));
}

console.log('\n──────────────────────────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFailures:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
