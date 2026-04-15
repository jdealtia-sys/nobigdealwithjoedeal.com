/**
 * scripts/grant-demo-claim.js
 *
 * Grants the Firebase Auth custom claim `demo: true` to a target user
 * email (defaults to demo@nobigdeal.pro). Landed with H-02 — the
 * nbd-auth client module now gates demo-mode on this claim rather
 * than on a hardcoded email literal, so the demo-tier experience
 * only works for users an operator has explicitly provisioned here.
 *
 * What a demo user sees client-side:
 *   - _userPlan = 'professional'  (unlocks professional-tier UI)
 *   - _role     = 'demo_viewer'   (NEVER 'admin' — no admin screens)
 *   - _subscription = { plan:'professional', status:'active', _demo:true }
 *
 * This DOES NOT grant any server-side privilege. Firestore rules +
 * callable functions consult request.auth.token.role, which remains
 * the empty/default role — so even with the demo claim set, the
 * backend treats this user exactly like a free-tier account. All
 * sensitive reads/writes still fail closed. The claim only unlocks
 * client-side UI for demonstration/sales purposes.
 *
 * SETUP (once):
 *   1. Firebase Console → Project Settings → Service Accounts →
 *      "Generate new private key" → download the JSON.
 *   2. Store it OUTSIDE this repo (e.g. ~/.nbd/nobigdeal-pro-sa.json).
 *   3. export GOOGLE_APPLICATION_CREDENTIALS=~/.nbd/nobigdeal-pro-sa.json
 *
 * USAGE:
 *   # grant demo claim to the default account
 *   node scripts/grant-demo-claim.js
 *
 *   # grant to a specific email
 *   node scripts/grant-demo-claim.js alice@example.com
 *
 *   # revoke demo claim
 *   node scripts/grant-demo-claim.js --remove alice@example.com
 *
 * The script is idempotent: re-running it on an already-demo account
 * is a no-op other than verification.
 */

'use strict';

const admin = require('firebase-admin');

const DEFAULT_EMAIL = 'demo@nobigdeal.pro';

function parseArgs(argv) {
  const args = argv.slice(2);
  let remove = false;
  const rest = [];
  for (const a of args) {
    if (a === '--remove' || a === '-r') { remove = true; continue; }
    rest.push(a);
  }
  const email = rest[0] || DEFAULT_EMAIL;
  return { email, remove };
}

function init() {
  try {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  } catch (e) {
    if (!String(e.message || '').includes('already exists')) throw e;
  }
}

async function main() {
  const { email, remove } = parseArgs(process.argv);
  init();

  const user = await admin.auth().getUserByEmail(email);
  console.log('Found user:', user.uid, user.email);

  // Preserve any other custom claims already set (e.g. role, companyId
  // for a manager who doubles as a sales-demo account). We only toggle
  // the `demo` flag.
  const existing = user.customClaims || {};
  const next = { ...existing };
  if (remove) {
    delete next.demo;
  } else {
    next.demo = true;
  }

  await admin.auth().setCustomUserClaims(user.uid, next);
  console.log(
    (remove ? '✓ demo claim REMOVED on uid=' : '✓ demo claim SET on uid=')
    + user.uid
  );

  // Force the new claim to take effect on the user's next sign-in.
  // Without revocation, an already-signed-in browser tab would keep
  // the old token (no / stale demo flag) until it naturally expires
  // in ~1 hour.
  await admin.auth().revokeRefreshTokens(user.uid);
  console.log('✓ existing sessions revoked — user must sign out + sign in again');

  // Verify by reading back the claim.
  const refreshed = await admin.auth().getUser(user.uid);
  const claims = refreshed.customClaims || {};
  const actual = !!claims.demo;
  const expected = !remove;
  if (actual !== expected) {
    console.error('✗ verification FAILED — custom claim state unexpected');
    console.error('  expected demo=' + expected + ', got demo=' + actual);
    process.exit(1);
  }
  console.log('✓ verified claims =', JSON.stringify(claims));
  console.log('\nDone. ' + (
    remove
      ? 'This account no longer gets demo-tier UI.'
      : 'This account now sees professional-tier UI on next sign-in.'
  ));
  process.exit(0);
}

main().catch(e => {
  console.error('FAILED:', e.message || e);
  console.error(e.stack);
  process.exit(1);
});
