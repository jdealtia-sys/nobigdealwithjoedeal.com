# Post-Deploy Checklist — NBD Pro Security Fixes

Ship this checklist end-to-end on the day of deploy. Do not merge to `main` until every box is checked.

## 1. Pre-deploy

- [ ] Read `SECURITY_BATTLE_PLAN.md` end to end.
- [ ] Read `SECRET_ROTATION.md` and rotate every secret listed there.
- [ ] `cd functions && npm install` (picks up any new dependencies).
- [ ] `cd tests && npm install && npm test` — firestore rules unit tests must pass. Do NOT deploy if they fail.

## 2. Grant yourself (Joe) the admin custom claim

Admin access is no longer a Firestore field. It is a custom claim set via the Admin SDK. Run this ONCE from your dev machine (needs a service-account key):

```bash
node -e "
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.applicationDefault() });
(async () => {
  const user = await admin.auth().getUserByEmail('jd@nobigdealwithjoedeal.com');
  await admin.auth().setCustomUserClaims(user.uid, { role: 'admin' });
  console.log('admin claim set for', user.uid);
  process.exit(0);
})();
"
```

Then sign out and back in on `admin/login.html` to pick up the claim.

## 3. Seed `access_codes` in Firestore

The hardcoded access code list in the old `validateAccessCode` is gone. The new function reads codes from the `access_codes` collection. Bootstrap the ones you want to keep:

```bash
node -e "
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();
const codes = {
  'NBD-DEMO':  { active: true, email: 'demo@nobigdeal.pro', role: 'member', plan: 'foundation', trialDays: 14,  displayName: 'Demo User' },
  'DEMO':      { active: true, email: 'demo@nobigdeal.pro', role: 'member', plan: 'foundation', trialDays: 14,  displayName: 'Demo User' },
  'NBD-2026':  { active: true, email: 'invite.2026@nobigdeal.pro', role: 'member', plan: 'foundation', trialDays: 90, displayName: 'Beta Member' },
  'ROOFCON26': { active: true, email: 'invite.2026@nobigdeal.pro', role: 'member', plan: 'foundation', trialDays: 90, displayName: 'Beta Member' }
};
(async () => {
  for (const [code, data] of Object.entries(codes)) {
    await db.doc('access_codes/' + code).set(data);
    console.log('seeded', code);
  }
  process.exit(0);
})();
"
```

The old `NBD-ADMIN` and `NBD-JOE` codes are intentionally NOT seeded. Admin access must go through `setCustomUserClaims` above.

## 4. Deploy in this order

```bash
# 1. Rules first so the client can't exploit anything while functions roll out.
firebase deploy --only firestore:rules
firebase deploy --only storage

# 2. Functions (picks up the new secrets)
firebase deploy --only functions

# 3. Hosting (static site + new CSP headers)
firebase deploy --only hosting
```

## 5. Delete the old stuff

- [ ] In Firebase Console → Functions, delete any lingering `seedDemoData` if the deploy missed it.
- [ ] In Cloudflare → Workers, delete the `nbd-ai-proxy` worker entirely (the repo stub returns 410 as a safety net).
- [ ] In Firebase Console → Authentication → Users, **delete the following service users** created by the old `validateAccessCode`: `demo@nobigdeal.pro`, `vip@nobigdeal.pro`, `admin@nobigdeal.pro`, `invite.2026@nobigdeal.pro`. They were created with a stable leaked password and anyone who has the hash can still sign in. Let them be recreated on demand by the new flow.
- [ ] Force-expire all existing Firebase sessions: `admin.auth().revokeRefreshTokens(uid)` for every existing user, or flip the project's password-reset requirement.

## 6. Turn on the Firebase Console switches

- [ ] **App Check** — Project Settings → App Check → register the web app with **reCAPTCHA Enterprise**. Enforce App Check on every Cloud Function. Enable debug token on localhost for dev.
- [ ] **Authentication → Settings → User actions → Email enumeration protection**: ON.
- [ ] **Authentication → Settings → Authorized domains**: remove any domains you don't control.
- [ ] **Firestore → Usage → Budgets**: set budget alert at $25/day.
- [ ] **Cloud Billing → Budgets**: add a $50/day project-wide budget alert (email + SMS to Joe).
- [ ] **Google Cloud Console → APIs & Services → Credentials → Browser API key**: add HTTP referrer restriction to the three domains (see SECRET_ROTATION.md #8).

## 7. Twilio A2P 10DLC + geo-permissions

- [ ] Verify A2P 10DLC campaign is still active.
- [ ] Messaging Geo Permissions → allow **US & Canada only**. Deny everything else.

## 8. Smoke tests (on production, after deploy)

Run these as a freshly-registered free user, a paid user, and an admin:

- [ ] Free register → dashboard loads → `subscriptions/{uid}` is NOT writable from devtools.
- [ ] Free register → `setDoc(doc(db,'users',uid),{role:'admin'})` → PERMISSION_DENIED.
- [ ] Free register → `getDocs(collection(db,'access_codes'))` → PERMISSION_DENIED.
- [ ] `curl POST /seedDemoData` → 404.
- [ ] `curl POST /validateAccessCode '{"data":{"code":"NBD-ADMIN"}}'` → 403 (App Check missing) or `not-found`.
- [ ] `curl POST /incomingSMS` with an invalid signature → 403.
- [ ] `curl GET /imageProxy?path=photos/<someone_else>/x.jpg` with your ID token → 403.
- [ ] `curl GET https://nbd-ai-proxy.<acct>.workers.dev` → 410 (or 404 if you deleted the worker).
- [ ] Ask-Joe AI works for a paid user → `api_usage` doc appears → 30 calls in 1 min → 429.
- [ ] Stripe checkout works for a paid user → webhook creates `subscriptions/{uid}` → audit_log entry exists.
- [ ] Public estimate form submits → contact_leads doc is created → cannot be read by a free user.
- [ ] Admin vault loads only after setting custom claim.

## 9. 24-hour monitoring

- [ ] Watch Cloud Billing hourly for 24h.
- [ ] Watch Cloud Logging for the functions — filter by `severity=ERROR`.
- [ ] Watch Twilio spend dashboard for 24h.
- [ ] Watch Anthropic usage dashboard for 24h.
- [ ] If any spend spike > $25/hour, revoke keys again and investigate.

## 10. Known follow-ups (not blocking this deploy)

- Full innerHTML sink sweep in `dashboard.html` / `customer.html` / `vault.html` (181 occurrences across 11 files). The CSP header + `dom-safe.js` helper + highest-risk sinks are fixed in this PR; the rest is tracked as a follow-up.
- Migrate public `visualizer.html` to anonymous Firebase Auth + App Check + `claudeProxy` so the AI assessment text can come back online.
- Migrate `rate_limits` out of Firestore to Upstash/Memorystore for per-ms latency.
- Rebuild the marketing site (`nobigdealwithjoedeal` project) with the same hardening. That project's rules are not in this repo and need a separate sweep.
- Replace `docs/pro/sw.js` with an auth-aware service worker that doesn't cache authenticated HTML shells.
- Populate `functions/data/zip-to-county.json` with the full zip→county map for every service area before re-enabling storm alerts.
