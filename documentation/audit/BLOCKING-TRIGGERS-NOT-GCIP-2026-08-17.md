# Blocking auth triggers have never worked in prod — the project isn't on GCIP (2026-08-17)

**Trigger for this investigation:** `beforeAdminSignIn` sitting in state
`FAILED` in `nobigdeal-pro` since `2026-08-11T01:32:06Z`, flagged as an open
item in
[DEPLOY-FALSE-GREEN-MODES-2026-08-17](DEPLOY-FALSE-GREEN-MODES-2026-08-17.md)
(PR #1233 — see [the corrections](#corrections-to-existing-docs) below, the
open item's stated hypothesis was wrong).

**Bottom line:** admin sign-in is **not** impaired and never was. The FAILED
record is an inert orphan. But the investigation turned up something larger:
**no blocking auth trigger in this project has ever fired**, including the
one everybody believes is live (`onRepSignup`), and the reason is not IAM.

## Is admin sign-in impaired? No — four independent confirmations

1. **Identity Platform has no blocker registered.** The project config's
   `blockingFunctions` is `{}`. Identity Platform invokes what is in that
   config and nothing else, so there is no code path from a sign-in to the
   FAILED function. Fail-open vs fail-closed never comes up — the blocker is
   not merely broken, it is *unregistered*.
2. **The function has no backing Cloud Run service.** Its `stateMessages`
   reads `CloudRunServiceNotFound` ("Cloud Run service … was not found"), and
   `gcloud run services describe beforeadminsignin` returns
   `Cannot find service`. `serviceConfig.service` is empty — one was never
   successfully attached.
3. **It is not in the source tree.** `functions/handlers/auth.js` defines it
   as `const _beforeAdminSignInHandler`, not `exports.beforeAdminSignIn`.
4. **No blocking-function invocation errors** appear in any log over 30 days.

`beforeAdminSignIn` is a metadata tombstone. Nothing calls it.

## Root cause of the FAILED record: an aborted 2026-04-14 registration

The timestamps line up to the minute:

| When (UTC) | What |
| --- | --- |
| 2026-04-14 ~19:2x | `545ce31e` "feat(security): Q3 admin MFA enforcement" merges with `exports.beforeAdminSignIn = beforeUserSignedIn(...)` **live** |
| 2026-04-14 19:34:59 | Cloud Functions record **created** (`createTime`) — blocking-trigger registration then fails, no Cloud Run service is ever attached |
| 2026-04-14 19:42:18 | `d8dee687` "fix(deploy): Q3 defer beforeAdminSignIn export until Identity Platform prereqs land" demotes the export to a non-exported `const` — **7 minutes later** |
| 2026-05-16 | `0e80c3f9` carries the already-disabled handler into `handlers/auth.js` during the `index.js` decomposition |
| 2026-08-11 01:32:06 | `updateTime` — a control-plane state refresh that stamped the record `FAILED` / `CloudRunServiceNotFound`. **No API caller**: there are zero `cloudfunctions.googleapis.com` audit entries between 01:20 and 01:39 that day. This is not a new incident; it is the platform noticing a four-month-old orphan. |

The `2026-08-11` date in the alert is a red herring — the failure is from
April, and `auth.js` has not been touched since 2026-07-06.

## The real blocker: GCIP, not IAM

Every deploy makes an `identitytoolkit` `UpdateConfig` call, and every one of
them fails:

```
principal:  firebase-adminsdk-fbsvc@nobigdeal-pro.iam.gserviceaccount.com
status:     code 3
message:    OPERATION_NOT_ALLOWED : Blocking Functions may only be
            configured for GCIP projects.
request:    blockingFunctions.triggers.beforeCreate.functionUri =
            https://onrepsignup-5okp4s3siq-uc.a.run.app
```

**162 consecutive failures in the last 30 days.** `nobigdeal-pro` is
`subtype: FIREBASE_AUTH` — it has never been upgraded to Google Cloud
Identity Platform, and blocking functions are a GCIP-only feature.

This contradicts three years of comments in `auth.js`,
`.github/workflows/firebase-deploy.yml`, and `POST_DEPLOY_CHECKLIST` §16, all
of which say the deploy SA is missing `roles/identityplatform.admin`.
**Granting that role cannot fix this.** The error is `OPERATION_NOT_ALLOWED`,
not `PERMISSION_DENIED`; the API is refusing the *project*, not the caller.

### Blast radius: `onRepSignup` has never been invoked

The failing call above is for `beforeCreate` → `onRepSignup`, the blocking
trigger the repo treats as shipped. It is deployed and `ACTIVE` with a live
Cloud Run URL, but because `blockingFunctions` is `{}`:

- **Zero HTTP requests to `onrepsignup` in 30 days.** It has never run.
- Claim-minting for reps runs entirely through the callable fallbacks —
  `claimInvite` (`handlers/invites.js`), `activateInvitedRep` and
  `mintOwnerClaims` (`handlers/auth.js`). The code comments describe these as
  a "de-GCIP'd claim-at-login pattern" and as a safety net; in fact they are
  the **only** minting path that executes.

No user-visible breakage follows from this — the callables cover it, which is
presumably why it went unnoticed. But the mental model in the comments was
inverted, and anyone reasoning about auth from those comments would reason
wrongly.

### Corollary: MFA is off at the platform level

`mfa.state` is `DISABLED` — also a GCIP-gated feature. So the Q3 admin-MFA
work is doubly blocked: admins cannot enroll a second factor today, and the
trigger that would enforce it cannot register. `/admin/mfa-enroll.html` is
guidance only right now.

## Why ~6 days of deploys didn't surface it

Not for the reason the open item assumed. The premise was that the strict
deploy step targets `beforeAdminSignIn` because it is absent from
`NBD_DEPLOY_SKIP_LIST`. **It never targets it.** The step builds its
`--only functions:…` list by grepping

```
^exports\.NAME = (onRequest|onCall|beforeUserCreated|beforeUserSignedIn|…)
```

across `functions/**`. `beforeAdminSignIn` is a `const`, not an `export`, so
the name never enters the candidate list — the skip-list is irrelevant to it.
Reproducing the grep against `main` yields **168** names, and
`beforeAdminSignIn` is not among them. There are no `beforeUserSignedIn`
exports in the tree at all.

So the strict step's narrow failure parse (`Failed to (create|update)
function NAME`, which does miss `Failed to register blocking trigger function
NAME`) is a real gap — but it is *not* what hid this one. This function was
never in scope for any deploy after 2026-04-14. It is invisible to the deploy
pipeline by construction, which is exactly why only an out-of-band
`gcloud functions list` found it.

## Did the new completion accounting fire? No — it isn't merged

Completion accounting (every targeted function must print a terminal
per-function line) lives on `3831f1d2`, which is on branch
`claude/laughing-mestorf-adc0a9` / **PR #1233, still open**. It is not an
ancestor of `main` (checked across all 450 remote branches — no other branch
carries it). No deploy has ever run it.

And even once merged it would not catch this: accounting covers *targeted*
functions, and `beforeAdminSignIn` is never targeted. Detecting orphans like
this needs a state sweep (`gcloud functions list | grep -v ACTIVE`), not
deploy-log parsing — see the recommendation below.

## Recommendations

1. ~~**Delete the orphan record.**~~ **DONE 2026-08-17** (Jo approved in
   session). `beforeAdminSignIn` had no Cloud Run service, no Identity
   Platform registration, and no source export, so removing it changed no
   auth behavior — it only cleared the FAILED state.
   ```
   gcloud functions delete beforeAdminSignIn --project nobigdeal-pro --region us-central1 --gen2
   ```
   `gcloud functions list | grep -v ACTIVE` is now clean (modulo functions
   transiently in `DEPLOYING` during a deploy). If this name ever reappears
   in a non-`ACTIVE` state, something re-exported the trigger — see the
   re-enablement runbook in `functions/handlers/auth.js`, and note it will
   keep failing until the GCIP decision below is made.
2. **Do not grant `roles/identityplatform.admin` expecting a fix.** It is
   necessary-but-not-sufficient, and only after a GCIP upgrade. Granting it
   now changes nothing and would leave a misleading "we fixed it" trail.
3. **Decide on GCIP explicitly.** Upgrading unblocks blocking triggers *and*
   MFA together. It is a paid-tier product decision (Jo's), not an ops task.
   If the answer is "not now", say so in the code comments so the next
   session doesn't re-derive this — the comments have already misled two
   rounds of work.
4. **Add a post-deploy state sweep** for non-`ACTIVE` functions. A green
   deploy plus completion accounting still cannot see a function that is not
   in the deploy list; only a state query can.

## Corrections to existing docs

Corrected in place in this PR, per the vault's standing rule:

- `functions/handlers/auth.js` — the Q3 header's re-enablement runbook
  (step 2 was "grant the SA `roles/identityplatform.admin`") and the
  `mintOwnerClaims` "why a callable" block, which described the callables as
  a fallback rather than the only live path.
- `.github/workflows/firebase-deploy.yml` — the skip-list rationale comment
  and the tolerant-retry step's failure summary, which told operators to
  grant an IAM role that cannot help. The summary now separates the
  scheduler cause (real IAM gap, fixable) from the blocking-trigger cause
  (GCIP, not fixable by IAM).
- [DEPLOY-FALSE-GREEN-MODES-2026-08-17](DEPLOY-FALSE-GREEN-MODES-2026-08-17.md)'s
  open item asserted the strict step "has been targeting it" — superseded by
  this note. That doc is on PR #1233 and not yet merged; the correction
  belongs there when it lands.
