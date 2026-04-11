# scripts/ — operational one-shots

These are NOT deployed as Cloud Functions. They run locally against the
Firebase Admin SDK using a service account key stored on your laptop.

Every script is idempotent — safe to re-run.

## Prerequisites (once)

1. Install Node 22+.
2. Firebase Console → Project Settings → Service Accounts → "Generate
   new private key". Download the JSON.
3. Store it OUTSIDE this repo, e.g. `~/.nbd/nobigdeal-pro-sa.json`.
   **NEVER commit a service account key to git.**
4. In each shell where you run a script:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS=~/.nbd/nobigdeal-pro-sa.json
   ```
5. Install the Admin SDK. The easiest way:
   ```bash
   cd functions && npm install  # installs firebase-admin for Cloud Functions
   cd ..
   ```
   Then run the scripts from the repo root — they'll find `firebase-admin`
   under `functions/node_modules/`. Or install globally:
   ```bash
   npm install -g firebase-admin
   ```

## `scripts/grant-admin-claim.js`

Sets the Firebase Auth custom claim `role: 'admin'` on
`jd@nobigdealwithjoedeal.com`. This is the ONLY way to become admin in
the hardened app — there's no access code, no Cloud Function, no URL
param that can grant admin. Also revokes existing refresh tokens so the
new claim takes effect on next sign-in.

```bash
node scripts/grant-admin-claim.js
```

Run AFTER `firebase deploy --only firestore:rules` has shipped the new
rules. Joe must sign out + sign in again to pick up the new token.

## `scripts/seed-access-codes.js`

Writes the `access_codes` Firestore collection that the hardened
`validateAccessCode` Cloud Function reads. Without this, the demo and
invite codes return "not recognized".

```bash
node scripts/seed-access-codes.js
```

To add or rotate a code: edit the `codes` object at the top of the file
and re-run. It overwrites by doc id. No code grants the admin role —
admin is claims-only.

## `scripts/delete-compromised-users.js`

Deletes 4 Firebase Auth users created by the pre-audit `validateAccessCode`
with deterministic email-derived passwords. Anyone who reverse-engineered
the old function can still sign in as these users using the leaked
password formula until the accounts themselves are gone.

```bash
node scripts/delete-compromised-users.js
```

Run AFTER `scripts/seed-access-codes.js` so the hardened Cloud Function
can recreate them on demand with secure random passwords.

## `scripts/deploy.sh`

The ordered `firebase deploy` sequence. Run from the repo root after
everything else in `GO_LIVE.md` steps 1–4 is done.

```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

Deploys in this order: Firestore rules → Storage rules → Cloud Functions
→ Hosting → marketing-project Firestore rules.
