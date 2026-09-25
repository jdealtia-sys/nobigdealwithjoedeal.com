# Firestore rules: deletes denied by a shape validator (2026-09-25)

**Result.** Two lead subcollections, `leads/{id}/documents` and
`leads/{id}/warrantyClaims`, could not be deleted by any client, the lead's
owner included. A scripted audit of every rule in `firestore.rules` found no
third case. Fixed on branch `fix/rules-subcollection-delete`.

## The trap

Both blocks had one `allow write` line that ended in a shape validator:

```
allow write: if isAuth()
  && (isOwner(get(.../leads/$(leadId)).data.userId)
      || (isCompanyStaff() && parentLeadInMyCompany(leadId)))
  && documentStatusWriteOk();      // warrantyClaimWriteOk() on the claims block
```

`write` covers create, update **and delete**. Both validators read
`request.resource.data`. On a delete `request.resource` is null, so the helper
throws, and a throw inside `&&` denies. The owner got a 403 on every delete.

Confirmed live on the shared emulator against origin/main's rules, with a
delete of a row that does not exist (so the probe changes nothing):

```
403  evaluation error at L484:25 for 'delete' @ L484 ... Null value error.
```

PR #1770 (tests-only) hit the same 403 in the phone-chrome cleanup: the report
rows the doc viewer files outlived their lead. It left the rules alone.

## The fix

Each block now has two lines:

- `allow create, update:` keeps the writer check and the validator.
- `allow delete:` has the same writer check and no validator.

Who can delete is exactly who could already create and update: the lead owner,
or a company_admin or manager whose tenant matches the parent lead. Viewers,
same-tenant sales reps, the platform admin, other tenants, signed-out users and
homeowner sessions are still denied. A homeowner has no identity at the rules
layer. The portal reaches lead data only through token-checked Cloud Functions.

The delete check reads the parent lead, so after a lead is hard-deleted no
client can delete its rows. `onLeadDeleted` (`functions/lead-artifact-cleanup.js`)
has always swept `documents`. It now sweeps `warrantyClaims` too (step 1b).

## Audit of the rest of the rules

A script parsed every `allow` statement in `firestore.rules`, expanded helper
calls recursively, and flagged any rule that allows `write` or `delete` and
reads `request.resource`:

| Rules | Flagged |
|---|---|
| origin/main | 2: the `documents` and `warrantyClaims` blocks |
| this branch | 0 |

Every other `allow write` on a subcollection (`tasks`, `notes`, `drawings`,
`signatures`, the `users/{uid}/…` mirrors) checks only the caller and the
parent. `activity`, `recordings`, `storm_proofs`, `portal_messages` and
`ai_drafts` deny client deletes on purpose (`if false`).

`storage.rules` does not have the trap. Every `allow write` that checks
`request.resource` sits next to its own `allow delete` line, and rules combine
with OR.

A mirror check looked for create-capable rules that read the existing doc
(`resource.data`, which is null on a create). It found none. As a control, the
same script flags 33 update rules, which do read `resource.data`, as expected.

## What the client does today

No client code hard-deletes these rows. The customer page's document delete is
a soft delete: an `updateDoc` that sets `deleted: true`, which the rules always
allowed. Warranty claims are opened and closed, never deleted. The only
deletes affected were E2E cleanup and any future hard-delete.

## Tests, and how each was proven

- `tests/firestore-rules.test.js` §28d, for both subcollections:
  - 8 callers are denied: a viewer, a same-tenant rep, the platform admin,
    another tenant's manager, company_admin and rep, a signed-out user, and a
    homeowner session.
  - The owner, a same-tenant manager and a same-tenant company_admin are
    allowed, and the rows are then gone.
  - A legacy lead with no companyId allows the owner only.
  - A row under an already-deleted lead is denied.
- `tests/firestore-rules.cross-tenant.test.js`: 12 checks. Each subcollection
  gets 5 denials (the other tenant's rep, manager and company_admin, a
  same-tenant rep, signed-out) and 1 owner allow. The suite now reports 130 of
  130.
- `tests/lead-artifact-cleanup.integration.test.js`: after a hard delete, the
  lead's `documents` and `warrantyClaims` rows are gone and another lead's
  claim row is still there.

Break-tests. Each mutation was applied, the suite run, and the original bytes
restored:

- **The fix reverted (origin/main rules).** §28d goes red at the owner delete,
  denied at the documents block. The two cross-tenant owner checks fail.
- **Only the claims split reverted.** The owner delete goes red again, this
  time denied at the warrantyClaims block.
- **Documents delete widened, one audience at a time.** Each widening turned
  exactly its own assertion red. The audiences were: viewer, same-tenant rep,
  platform admin, cross-tenant manager, cross-tenant company_admin,
  cross-tenant rep, signed-out, anonymous session, staff on a legacy lead, and
  a row whose lead is gone.
- **Claims delete widened to any signed-in user.** The claims viewer denial
  goes red, and so do 4 cross-tenant claim checks.
- **Test-side: the owner delete skipped.** The "row is gone" read goes red.
- **Trigger mutations.** These ran through the real handler, in-process,
  against a dedicated project:
  - Step 1b removed: the claims-swept assertion goes red.
  - The claims sweep widened to a collectionGroup: the confinement assertion
    goes red.
  - The documents row delete removed: the documents-swept assertion goes red.

Rules suites run locally against the shared emulator used a fresh dedicated
project id per run (`RULES_TEST_PROJECT_ID`, new in both suites). Both suites
refuse the ids in `.firebaserc`. A probe of `nobigdeal-pro` before and after
confirmed the rig kept origin/main's rules.

## Left open

- `onLeadDeleted` still does not sweep `tasks`, `notes`, `activity`,
  `drawings`, `signatures`, `recordings`, `storm_proofs`, `portal_messages` or
  `ai_drafts` under a hard-deleted lead. Clients cannot reach those rows either.
  Account erasure removes them only for leads that still exist.
- `cleanupE2ETestData` walks `activity`, `notes`, `documents` and `signatures`,
  but not `tasks` or `warrantyClaims`. On a rig with functions, `onLeadDeleted`
  now sweeps the claims when the callable deletes the lead.
