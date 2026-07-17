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
  assert('team → 2 invite seats (mid-tier; makes the seat-picker reachable)', f('team') === 2);
  assert('growth → 5 invite seats', f('growth') === 5);
  assert('enterprise → Infinity', f('enterprise') === Infinity);
  assert('unknown plan falls back to free (0)', f('definitely-not-a-plan') === 0);
  assert('undefined plan falls back to free (0)', f(undefined) === 0);
}

console.log('\nTeam plan ($149, 2 seats) — wired server + client + stripe + pricing');
{
  const { _test } = require(path.join(ROOT, 'functions/billing.js'));
  const t = _test.PLAN_LIMITS.team;
  assert('server PLAN_LIMITS.team = 150 leads / 2 reps / 100 aiCalls / unlimited reports',
    !!t && t.leads === 150 && t.reps === 2 && t.aiCalls === 100 && t.reports === Infinity);
  const bg = read('docs/pro/js/billing-gate.js');
  assert('client PLANS.team = Team $149, 2 reps, matching caps',
    /team:\s*\{ label: 'Team',\s*leads: 150,[\s\S]{0,90}reps: 2,[\s\S]{0,40}price: 149/.test(bg));
  assert('client upgrade ladder is free→starter→team→growth',
    /_plan === 'starter' \? 'team'[\s\S]{0,60}_plan === 'team' \? 'growth'/.test(bg));
  const st = read('functions/stripe.js');
  assert('stripe: team accepted + price mapped + trial granted + metadata-allowed',
    /VALID_PLANS = \[[^\]]*'team'/.test(st)
    && /\[STRIPE_PRICE_TEAM\.value\(\)\]:\s*'team'/.test(st)
    && /normalizedPlan === 'growth' \|\| normalizedPlan === 'team'/.test(st)
    && /ALLOWED_FROM_METADATA = new Set\(\['starter', 'team', 'growth'\]\)/.test(st));
  assert('STRIPE_PRICE_TEAM secret declared + bound (checkout + webhook + price map)',
    /STRIPE_PRICE_TEAM\s*=\s*defineSecret\('STRIPE_PRICE_TEAM'\)/.test(st)
    && (st.match(/STRIPE_PRICE_TEAM/g) || []).length >= 5);
  const pr = read('docs/pro/pricing.html');
  assert('pricing page has a Team card (data-plan="team", $149)',
    /data-plan="team"/.test(pr) && /tier-name">Team</.test(pr) && /\$149/.test(pr));
  const pp = read('docs/pro/js/pricing-page.module.js');
  assert('pricing-page resume-checkout allows team',
    /plan !== 'starter' && plan !== 'team' && plan !== 'growth'/.test(pp));
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

console.log('\nInvite/claim hardening (Phase-3 QA sweep)');
{
  const src = read('functions/handlers/invites.js');
  // Cross-tenant ambiguous claim: limit(2) + refuse when two companies match,
  // instead of limit(1) silently claiming the smallest-path companyId.
  assert('claimInvite looks up with limit(2), not limit(1)',
    /collectionGroup\('members'\)[\s\S]{0,160}\.limit\(2\)/.test(src)
    && !/\.limit\(1\)\s*\n\s*\.get\(\);\s*\n\s*if \(inviteSnap\.empty\)/.test(src),
    'limit(1) silently claims the lexicographically-smallest companyId on a same-email collision');
  assert('claimInvite refuses an ambiguous cross-tenant invite',
    /companies\.size > 1[\s\S]{0,200}reason: 'ambiguous_invite'/.test(src),
    'two tenants inviting the same email must not silently claim one — cross-tenant leak + lockout');
  // Email-verify wall reads the authoritative Auth record, not just the token,
  // so a just-verified rep with a stale ID token is not stranded.
  assert('claimInvite rechecks emailVerified on the Auth record',
    /getAuth\(\)\.getUser\(uid\)[\s\S]{0,120}rec\.emailVerified === true/.test(src),
    'a stale ID token (verified in another tab) must not strand a rep behind the verify wall');
  // Expired-invite seat-cap: re-inviting an EXPIRED pending invite must take a
  // fresh seat (occupied[] already freed it), not be credited a reused seat.
  assert('seat reuse credited only for a NON-expired existing invite',
    /reusesSeat = existingStatus === 'invited' && !isInviteExpired\(existing\.data\(\)\)/.test(src)
    && /seatsAfter = occupied\.length \+ \(reusesSeat \? 0 : 1\)/.test(src),
    're-inviting an expired invite must not bypass the seat cap by one');
  const boot = read('docs/pro/js/dashboard-bootstrap.module.js');
  assert('client keeps ambiguous_invite non-terminal (self-heals on resolution)',
    /out\.reason === 'ambiguous_invite'/.test(boot),
    'a terminal flag would strand the rep after the owner cancels the stray invite');
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

console.log('\nSeat picker — assignSeats (over-capacity cap-enforced choice)');
{
  const inv = read('functions/handlers/invites.js');
  assert('assignSeats callable is defined + App Check enforced',
    /exports\.assignSeats = onCall\(/.test(inv)
    && /assignSeats[\s\S]{0,300}enforceAppCheck: true/.test(inv));
  assert('assignSeats hard-caps chosen-active at seatLimitForPlan(plan)',
    /targetActive = claimed\.filter[\s\S]{0,200}cap !== Infinity && targetActive\.length > cap[\s\S]{0,160}resource-exhausted/.test(inv),
    'the picker must not activate more reps than the plan allows');
  assert('assignSeats benches with a NON-lapse reason (checkout must not un-bench)',
    /deactivatedReason: 'seat-unassigned'/.test(inv)
    && !/deactivatedReason: 'lapse'[\s\S]{0,200}assignSeats/.test(inv),
    "seat-unassigned (not 'lapse') so reactivateLapsedSeats leaves an owner's choice intact");
  assert('assignSeats never touches the owner or pending invites',
    /md\.uid && md\.uid !== ownerId/.test(inv));
  const idx = read('functions/index.js');
  assert('assignSeats exported from functions/index.js',
    /exports\.assignSeats = inviteHandlers\.assignSeats/.test(idx));
  const tab = read('docs/pro/js/dashboard-team-tab.js');
  assert('team tab renders the seat picker + calls assignSeats',
    /_renderSeatPanel\(/.test(tab) && /_teamCallable\('assignSeats'/.test(tab));
  assert('seat picker cap mirrors server seatLimitForPlan (reps<=1 => 0)',
    /reps <= 1 \? 0 : reps/.test(tab));
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
  // requirePaidSubscription gates sendSMS + sendD2DSMS. It was the last
  // billable gate still uid-keyed + active-only, so every rep of a paying
  // tenant (no subscriptions/{repUid} doc) and every trialing owner got 402.
  const shared = read('functions/shared.js');
  assert('shared.js requirePaidSubscription keys on companyId || uid',
    /billingKey = decoded\.companyId \|\| uid/.test(shared)
    && /subscriptions\/'\s*\+\s*billingKey/.test(shared),
    'a rep of a paying tenant must not be gated as free on SMS');
  assert('shared.js requirePaidSubscription accepts trialing as paid',
    /sub\.status === 'active' \|\| sub\.status === 'trialing'/.test(shared),
    'SMS must work during the Growth trial (parity with the AI gate)');
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

console.log('\nClient billing gate — primed at boot + no silent hard-block');
{
  const boot = read('docs/pro/js/dashboard-bootstrap.module.js');
  assert('billing gate is primed once at login (loadSubscription at boot)',
    /window\.NBDBilling\.loadSubscription\(\)/.test(boot),
    'without a boot load _loaded stays false and enforceGate/softGate fail open all session (free = unlimited leads)');
  const bg = read('docs/pro/js/billing-gate.js');
  assert('growth-cap hard-block surfaces a toast instead of a silent no-op',
    /if \(!nextPlan\) \{/.test(bg)
    && /showToast\(/.test(bg)
    && /reached your monthly limit/.test(bg),
    'a Growth tenant at the lead cap had Add-Lead silently do nothing (no modal, no toast)');
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

console.log('\nStripe webhook idempotency — marker cleared on failure so retries recover');
{
  const stripe = read('functions/stripe.js');
  assert('processing-error path deletes the stripe_events marker so Stripe retries re-process',
    /stripeWebhook processing error/.test(stripe)
    && /getFirestore\(\)\.doc\(`stripe_events\/\$\{event\.id\}`\)\.delete\(\)/.test(stripe),
    'marker written before processing + kept on error => Stripe retry short-circuits as duplicate, paid tenant never activated');
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

// ═══════════════════════════════════════════════════════════════════
// BATCH 2 (2026-07-16 product decisions): enforced caps + nudges,
// lapse grace → reversible seat pause, 30-day invite expiry.
// ═══════════════════════════════════════════════════════════════════

console.log('\nInvite expiry — 30-day TTL (real import)');
{
  const { _test } = require(path.join(ROOT, 'functions/handlers/invites.js'));
  assert('INVITE_TTL_DAYS is 30', _test.INVITE_TTL_DAYS === 30);
  const day = 24 * 3600 * 1000;
  const now = Date.now();
  const inv = (ageDays, status = 'invited') => ({ status, invitedAt: { toMillis: () => now - ageDays * day } });
  assert('fresh invite valid', _test.isInviteExpired(inv(1), now) === false);
  assert('29-day invite still valid', _test.isInviteExpired(inv(29), now) === false);
  assert('31-day invite expired', _test.isInviteExpired(inv(31), now) === true);
  assert('active member never expires', _test.isInviteExpired(inv(90, 'active'), now) === false);
  assert('legacy invite without invitedAt never expires',
    _test.isInviteExpired({ status: 'invited' }, now) === false);
  const src = read('functions/handlers/invites.js');
  assert('claimInvite returns terminal invite_expired reason',
    /isInviteExpired\(memberData\)[\s\S]{0,120}reason: 'invite_expired'/.test(src));
  assert('expired invites stop consuming a seat',
    /md\.status === 'invited'\) return !isInviteExpired\(md\)/.test(src));
}

console.log('\nLapse lifecycle — grace, pause, reactivation');
{
  const { _test } = require(path.join(ROOT, 'functions/lapse-enforcement.js'));
  assert('LAPSE_GRACE_DAYS is 14', _test.LAPSE_GRACE_DAYS === 14);
  const src = read('functions/lapse-enforcement.js');
  assert('cron scans cancelled + unenforced + past-grace subscriptions',
    /where\('status', '==', 'cancelled'\)[\s\S]{0,120}where\('lapseEnforced', '==', false\)[\s\S]{0,120}where\('cancelledAt', '<=', cutoff\)/.test(src));
  assert('pause disables Auth + revokes tokens + flags deactivatedReason lapse',
    /disabled: true[\s\S]{0,300}revokeRefreshTokens[\s\S]{0,600}deactivatedReason: 'lapse'/.test(src));
  assert('pause only touches ACTIVE member docs (owner has no member doc)',
    /\.status === 'active'\)/.test(src));
  assert('reactivation restores ONLY lapse-paused members',
    /where\('deactivatedReason', '==', 'lapse'\)/.test(src));
  // deactivateUser MUST stamp a non-lapse deactivatedReason on manual disable
  // (and clear it on reactivate). Otherwise a member the cron paused
  // (reason:'lapse'), then owner-reactivated, then owner-deactivated, keeps a
  // stale 'lapse' reason and a later re-checkout silently un-disables an
  // intentionally removed rep — breaking "owner-deactivated members stay off".
  const admin = read('functions/handlers/admin.js');
  assert('deactivateUser stamps deactivatedReason (owner-removed / null)',
    /deactivatedReason: reactivate \? null : 'owner-removed'/.test(admin),
    'manual deactivate must not leave a stale lapse reason that re-checkout auto-restores');
  const stripe = read('functions/stripe.js');
  assert('subscription.deleted stamps cancelledAt + lapseEnforced:false',
    /status: 'cancelled',[\s\S]{0,400}cancelledAt: FieldValue\.serverTimestamp\(\),\s*lapseEnforced: false/.test(stripe));
  assert('checkout reactivates lapse-paused seats + clears lapse state',
    /reactivateLapsedSeats\(db, uid, plan\)/.test(stripe)
    && /cancelledAt: FieldValue\.delete\(\)/.test(stripe));
  // Downgrade-on-return: reactivateLapsedSeats must cap restorations at the new
  // plan's seat limit (oldest-activated first), not restore every paused rep —
  // otherwise a Growth→Starter return keeps reps over the new cap (billing
  // under-enforcement). Legacy 2-arg callers (plan omitted) restore all.
  assert('reactivateLapsedSeats caps restorations at the new plan seat limit',
    /reactivateLapsedSeats\(db, companyId, plan\)/.test(src)
    && /cap = plan == null \? Infinity : seatLimitForPlan\(plan\)/.test(src)
    && /if \(restored >= cap\) break/.test(src),
    'a downgrade-on-return must not restore reps over the new plan cap');
  const idx = read('firestore.indexes.json');
  assert('composite index for the lapse-cron query exists',
    /"subscriptions"[\s\S]{0,300}"status"[\s\S]{0,120}"lapseEnforced"[\s\S]{0,120}"cancelledAt"/.test(idx),
    'equality+equality+range needs a composite or the cron silently FAILED_PRECONDITIONs');
  const fnIdx = read('functions/index.js');
  assert('enforceLapsedSeats exported from functions/index.js',
    /exports\.enforceLapsedSeats = lapseEnforcement\.enforceLapsedSeats/.test(fnIdx));
}

console.log('\nUsage caps — enforced with nudges (metering wired)');
{
  const { _test } = require(path.join(ROOT, 'functions/billing.js'));
  assert('free plan caps 10 leads/mo (server truth)', _test.PLAN_LIMITS.free.leads === 10);
  const billing = read('functions/billing.js');
  assert('trackUsage rolls the cycle when the month changes (free tenants have no invoices)',
    /cycleMonth !== nowMonth/.test(billing) && /rolled/.test(billing));
  assert('rollover zeroes every metered feature explicitly (merge:true merges map fields)',
    /resetZeros/.test(billing) && /ALLOWED_FEATURES\]\.map\(\(f\) => \[f, 0\]\)/.test(billing));
  const gate = read('docs/pro/js/billing-gate.js');
  assert('enforceGate exists and blocks at the cap',
    /function enforceGate\(feature, featureLabel\)/.test(gate)
    && /if \(!canUse\(feature\)\) \{[\s\S]{0,200}return false/.test(gate));
  assert('enforceGate fails open before plan load + for owners',
    /function enforceGate[\s\S]{0,200}if \(!_loaded\) return true;[\s\S]{0,80}_isOwner\(\)\) return true/.test(gate));
  assert('enforceGate exported on NBDBilling', /enforceGate,/.test(gate));
  const boot = read('docs/pro/js/dashboard-bootstrap.module.js');
  assert('_saveLead gates new leads through enforceGate',
    /NBDBilling\.enforceGate === 'function'[\s\S]{0,120}enforceGate\('leads', 'leads'\)/.test(boot));
  assert('both create branches meter via trackUsage',
    (boot.match(/NBDBilling\.trackUsage\('leads'\)/g) || []).length >= 2,
    'geocoded AND no-address fallback paths must both count');
  assert('lapse banner renders for cancelled subscriptions',
    /lapseBanner/.test(boot) && /lapseEnforced === true/.test(boot));
  assert("invite_expired is non-terminal in the claim check",
    /out\.reason === 'invite_expired'/.test(boot));
  const tab = read('docs/pro/js/dashboard-team-tab.js');
  assert('roster shows expired-invite state (30d mirror)',
    /inviteExpired/.test(tab) && /30 \* 24 \* 3600 \* 1000/.test(tab));
}

console.log('\n──────────────────────────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFailures:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
