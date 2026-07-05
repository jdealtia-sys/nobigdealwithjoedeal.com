# Prod Homework Verification — 2026-07

Five prod-console items came out of the 2026-07-04/05 marathon session and
none of them are verifiable from the repo. This is the paste-in kit to turn
"I don't know if we've done any of this" into a yes/no per item, following
the LIVE_VERIFICATION.md pattern: run each check, paste the output back to
the assistant, and it unblocks the gated work listed under **Why it matters**.

Run browser checks in **Chrome on the live dashboard**
(`https://nobigdealwithjoedeal.com/pro/dashboard`), signed in, DevTools
console open. `gcloud` checks run from any terminal with
`gcloud auth login` + `gcloud config set project nobigdeal-pro`.

---

## 1. Owner claims minted on BOTH owner accounts

**Why it matters:** gates Phase 2 of the owner-claims migration (removing the
deprecated email fallbacks). If we remove the fallbacks before BOTH accounts
carry `claims.owner === true`, whichever account wasn't minted loses owner
access — that's the exact lockout the fallbacks exist to prevent.

Sign in to the dashboard as **jd@nobigdealwithjoedeal.com**, paste:

```js
const tr = await window._user.getIdTokenResult(true); // true = force refresh
console.log('account:', window._user.email);
console.log('owner claim:', tr.claims.owner === true);
console.log('all claims:', JSON.stringify(tr.claims));
```

Then sign out, sign in as **jonathandeal459@gmail.com**, paste the same thing.

- ✅ Done = `owner claim: true` on **both** accounts.
- ❌ If false: just being signed in should have triggered the mint request
  (`_requestOwnerClaimMint` fires on sign-in while the email fallback still
  exists). Wait ~30s, re-run the snippet (it force-refreshes the token). If
  still false, paste the console output + any errors back.

## 2. IAM grant — roles/iam.serviceAccountTokenCreator

**Why it matters:** access-code login mints a Firebase custom token
(`handlers/portal.js` → `createCustomToken`), and PDF signed URLs use the
same IAM `signBlob` API (`render-pdf.js`). Both fail in prod until the
functions runtime service account can sign as itself.

Terminal check (covers both the project-level and SA-level grant shapes):

```bash
# Which SA do the functions run as? (gen2 default is the compute SA)
gcloud functions list --gen2 --format="table(name,serviceConfig.serviceAccountEmail)" --limit=3

# Project-level grant?
gcloud projects get-iam-policy nobigdeal-pro \
  --flatten="bindings[].members" \
  --filter="bindings.role:roles/iam.serviceAccountTokenCreator" \
  --format="table(bindings.members)"

# SA-level self-grant? (substitute the SA email from the first command)
gcloud iam service-accounts get-iam-policy <SA_EMAIL_FROM_ABOVE>
```

- ✅ Done = the runtime SA appears under a `tokenCreator` binding in either
  the project policy or its own SA policy.
- Functional double-check: redeem any access code end-to-end — if the
  sign-in completes, the grant is in place.

## 3. Notification channels for the 13 alert policies

**Why it matters:** the policies in `monitoring/` fire into the void until
each one has a notification channel attached.

```bash
gcloud beta monitoring channels list --format="table(name,displayName,type,enabled)"
gcloud alpha monitoring policies list --format="table(displayName,notificationChannels)"
```

- ✅ Done = at least one enabled channel exists AND every policy row shows a
  non-empty `notificationChannels`.
- Console alternative: https://console.cloud.google.com/monitoring/alerting
  (project `nobigdeal-pro`) — each policy should list a channel.

## 4. Backup bucket decision

**Why it matters:** `functions/firestore-backup.js` exports nightly to
`gs://nobigdeal-pro-firestore-backups` and prunes old exports; without the
bucket the cron fails every night (and the `backup-cron-stale` alert policy
is watching for exactly that).

```bash
gcloud storage ls gs://nobigdeal-pro-firestore-backups/ 2>&1 | head
```

- ✅ Done = bucket exists and contains dated export folders.
- ❌ `BucketNotFound` = still pending. Creation steps are in the header
  comment of `functions/firestore-backup.js` (same region as Firestore).
- If the decision is "defer backups", say so and we'll disable the cron +
  alert policy instead of leaving a nightly failure in the logs.

## 5. Shadow flag — feature_flags/_default.serverAggregatesShadow

**Why it matters:** gates pagination Stage B. With the flag on, the client
logs `window.NBDServerAggregates` shadow counts next to client counts; after
some hours/days of data we compare them, and if they agree Stage B starts
trusting server aggregates.

In the signed-in dashboard console (any authed user can read):

```js
const snap = await window.getDoc(window.doc(window.db, 'feature_flags', '_default'));
console.log('exists:', snap.exists(), 'flags:', JSON.stringify(snap.data() || {}));
```

- ✅ Flipped = `serverAggregatesShadow: true` in the output.
- To flip it (owner/platform-admin account only — rules restrict writes):

```js
await window.setDoc(window.doc(window.db, 'feature_flags', '_default'),
  { serverAggregatesShadow: true }, { merge: true });
```

---

## Result ledger

| # | Item | Status | Verified on |
|---|------|--------|-------------|
| 1 | Owner claims (jd@) | ☐ | |
| 1 | Owner claims (jonathandeal459@) | ☐ | |
| 2 | IAM tokenCreator grant | ☐ | |
| 3 | Notification channels (13 policies) | ☐ | |
| 4 | Backup bucket | ☐ | |
| 5 | Shadow flag flipped | ☐ | |

Fill the ledger as you go (or just paste raw console output back and the
assistant fills it). Items 1 and 5 unblock queued engineering work — they're
the ones to do first.
