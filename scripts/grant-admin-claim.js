/**
 * scripts/grant-admin-claim.js
 *
 * Grants the Firebase Auth custom claim `role: 'admin'` to Joe.
 *
 * This is the ONLY way to become admin in the hardened app. There is no
 * access code, no URL param, no Cloud Function that can grant the admin
 * role — the hardened validateAccessCode explicitly refuses to issue it.
 * So you must run this script once, locally, using an admin SDK
 * service-account credential.
 *
 * SETUP (once):
 *   1. Firebase Console → Project Settings → Service Accounts →
 *      "Generate new private key" → download the JSON.
 *   2. Store it OUTSIDE this repo, e.g. ~/.nbd/nobigdeal-pro-sa.json.
 *   3. NEVER commit the service account JSON.
 *   4. export GOOGLE_APPLICATION_CREDENTIALS=~/.nbd/nobigdeal-pro-sa.json
 *
 * RUN:
 *   node scripts/grant-admin-claim.js
 *
 * The script also revokes existing refresh tokens so the new claim takes
 * effect on the next sign-in. If you were signed in before running this,
 * sign out and sign in again.
 */

const admin = require('firebase-admin');

const JOE_EMAIL = 'jd@nobigdealwithjoedeal.com';

function init() {
  try {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  } catch (e) {
    if (!String(e.message || '').includes('already exists')) throw e;
  }
}

async function main() {
  init();

  const user = await admin.auth().getUserByEmail(JOE_EMAIL);
  console.log('Found user:', user.uid, user.email);

  await admin.auth().setCustomUserClaims(user.uid, { role: 'admin' });
  console.log('✓ admin claim set on uid=' + user.uid);

  // Revoke existing refresh tokens so Joe's next sign-in carries the
  // updated claim. Without this, an already-signed-in tab would keep
  // the old token (no admin) until it naturally expires in ~1 hour.
  await admin.auth().revokeRefreshTokens(user.uid);
  console.log('✓ existing sessions revoked — Joe must sign out + sign in again');

  // Verify by reading back the claim.
  const refreshed = await admin.auth().getUser(user.uid);
  const claims = refreshed.customClaims || {};
  if (claims.role !== 'admin') {
    console.error('✗ verification FAILED — custom claim not set. Aborting.');
    process.exit(1);
  }
  console.log('✓ verified claims =', JSON.stringify(claims));
  console.log('\nDone. Open /admin/vault.html after signing in.');
  process.exit(0);
}

main().catch(e => {
  console.error('FAILED:', e.message || e);
  console.error(e.stack);
  process.exit(1);
});
