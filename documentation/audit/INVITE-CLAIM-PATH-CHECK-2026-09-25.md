# Team invites: only read from companies/{id}/members (2026-09-25)

**Result.** `claimInvite` and `onRepSignup` could accept a document that was
not a team invite as if it were one. Found by the review of #1776 and
reproduced on the emulator. Fixed in three layers on branch
`fix/invite-claim-path-check`: the invite lookup checks the document's path
and contents, `firestore.rules` no longer lets a user write arbitrary
subcollection names under their own `users/{uid}` doc, and the recording
retention cron (same query pattern, destructive) checks its path too.
**Production had no affected data**: a read-only count on 2026-09-25 found
zero `members` documents anywhere (see [Production check](#production-check)).
Nothing was deleted and nothing needs deleting.

## The defect

Both invite claimers found an invite with a collection-group query:

```
db.collectionGroup('members')
  .where('email', '==', email).where('status', '==', 'invited')
```

and took the tenant from `ref.parent.parent.id`. A collection-group query
matches **every** collection named `members`, under any parent at any depth.
Invites are only ever written at `companies/{companyId}/members/{email}` (by
`createTeamInvite` and `createTeamMember`, admin SDK; the rules deny client
writes there), but nothing in the lookup checked that.

The rule that made another parent reachable was the generic wildcard under
`match /users/{uid}`:

```
match /{subcol}/{docId} { allow read, write: if isOwner(uid) || isAdmin(); }
```

It let a signed-in user write a subcollection of **any** name under their own
`users/{uid}` doc, `members` included, and the lookup accepted a matching
document there as a team invite. That skipped everything `createTeamInvite`
enforces (plan seat cap, role allowlist at write time, who may invite),
resolved the tenant to the writer's uid, and could also make a real invite for
the same address come back as `ambiguous_invite`, which blocked it.

`claimInvite` is called from the dashboard (`dashboard-bootstrap.module.js`),
so the path was live in production. `onRepSignup` is a
blocking trigger that production never runs (GCIP, see
[BLOCKING-TRIGGERS-NOT-GCIP-2026-08-17](BLOCKING-TRIGGERS-NOT-GCIP-2026-08-17.md));
it is fixed anyway because the emulator rig and any future GCIP upgrade run
it. The `members(email, status)` COLLECTION_GROUP index ships in
`firestore.indexes.json`, so the query worked in production.

## The fix

**1. One lookup, used by both handlers:** `functions/handlers/invite-lookup.js`
`findPendingInvite(db, email)`. A collection-group hit is an invite only when:

1. its path is **exactly** `companies/{companyId}/members/{memberId}`
   (`matchDocPath` in `functions/collection-group-paths.js`: same depth, same
   collection names; anything else is null);
2. `memberId` equals the document's own `email` field and the email being
   claimed (every writer keys the doc by the normalized email);
3. its `role` is one `createTeamInvite` can issue (`INVITE_ALLOWED_ROLES`);
4. `companies/{companyId}` exists (one batched `getAll`).

Everything else is counted and dropped **before** the ambiguity check, so a
stray document can neither be claimed nor block a real invite. The handlers log
the counts (`nonCanonical`, `invalid`, `orphaned`, `truncated`), never an
email. The old reads took 2 hits (`claimInvite`) or 1 (`onRepSignup`), and
hits come back in full-path order, so a stray document under a parent that
sorts before `companies` used up the page and pushed the real invite out of
it. The lookup now reads **every** page (50 hits each, `startAfter` the last
doc) until a short page, up to 20 pages; a scan that reaches that cap answers
`ambiguous`, which both callers refuse, never `found` or `none` (see
[Review fixup](#review-fixup-2026-09-25)). `claimInvite` also reuses the
company doc the lookup read instead of reading it again.

Behaviour changes, both deliberate:

- An invite at the right path with a role outside the allowlist is now **not
  an invite** (`no_invite`). It used to be claimed with the role clamped to
  `sales_rep`. The clamp is still there as a second layer.
- `onRepSignup` with two real invites from different companies now signs up
  with no claims (it used to take whichever path sorted first).
  `claimInvite` reports `ambiguous_invite` at first dashboard load, as it
  already did.

**2. Rules:** the `users/{uid}` wildcard keeps `read` as it was, and `write`
is an allowlist of the subcollection names the app writes. Every client write
under `users/{uid}/...` in `docs/` and `functions/` (grepped 2026-09-25):

| Name | Client writer |
|---|---|
| `captures` | `quick-capture.js`, `quick-capture-inbox.js`, `talk-tank.js` |
| `ds_meta` | `daily-success/ds-firebase-sync.js` (streaks doc) |
| `ds_pages` | `daily-success/ds-firebase-sync.js` |
| `fcmTokens` | `push-registration.js` |
| `preferences` | `mobile-nav-customizer.js` |
| `settings` | `ai-texting-persona.js` (`settings/aiPersona`); `email_system.js` only reads `settings/emailjs` |
| `jobTemplates`, `templates` | `job-templates.js`; both keep their own explicit matches |

`notificationLogs` is written only by the admin SDK (`push-functions.js`) and
needs no rule. The production census below found exactly these names in use
(`notificationLogs`, `ds_meta`, `ds_pages`, `fcmTokens`, `jobTemplates`,
`preferences`), so no live data sits under a name that is now read-only.
**A new client-written subcollection under `users/{uid}` must be added to
`userWritableSubcollection()`**, or its writes are denied; section 35 of
`tests/firestore-rules.test.js` pins the list, and section 34's viewer matrix
covers most of it a second time.

**3. The recording retention cron** (`recordingRetentionCron`,
`functions/integrations/voice-intelligence.js`) finds recordings with
`collectionGroup('recordings')` and, in its hard-delete phase, deletes the
Storage object named by the document's own `audioPath` field. The old wildcard
made `users/{uid}/recordings` writable too, so a document there could name any
object for deletion. `retentionAudioPathFor()` now returns a path only for a
document at `leads/{leadId}/recordings/{recordingId}` whose `audioPath` is
`audio/{uid}/{leadId}/{recordingId}.ext` for that same lead and recording,
which is the only pairing `processRecording` writes. Anything else keeps its
audio and logs a warning.

## Other collection-group queries in functions/

No other one reads a tenant from `ref.parent.parent`. The ones that trust a
**field** on a hit, and what now protects them:

| File | Query | Trusts | Protection |
|---|---|---|---|
| `handlers/invites.js` `claimInvite` | `members` by email + status | parent path | **fixed** (lookup) + rules |
| `handlers/auth.js` `onRepSignup` | same | parent path | **fixed** (lookup) + rules |
| `integrations/voice-intelligence.js` `recordingRetentionCron` | `recordings` by status + dates | `audioPath` (Storage delete) | **fixed** (path pairing) + rules |
| `handlers/adjuster-board.js` | `recordings` where `companyId ==` caller's | `companyId`, `summary` | rules only: `leads/{id}/recordings` is admin-SDK write, and `users/{uid}/recordings` is no longer writable |
| `handlers/ai-texting-stats.js` | `ai_drafts` where `userId ==` caller | `userId` | rules only, same reasoning (`ai_drafts` create is admin-SDK only) |
| `integrations/compliance.js` export + erasure | `recordings`, `activity` where `userId == uid` | `userId` | rules only; `leads/{id}/activity` creates pin `userId` to the caller |

The three "rules only" rows could take a path check too; they were left as
they are because the only client-writable parent that reached them is closed
and none of them deletes anything a stray document could choose.
`adjuster-board-handler-tenancy.test.js` stubs hits without a `ref`, so a path
check there also means updating that stub.

## Production check

Read-only, counts and path shapes only, no emails or ids printed. ADC was
verified as `nobigdeal-pro` (`GoogleAuth().getProjectId()`), with every
emulator host variable unset.

| Query | Result |
|---|---|
| `collectionGroup('members')`, all docs, classified by path shape | **0 docs** (0 canonical, 0 elsewhere) |
| `collectionGroup('recordings')` | 0 docs |
| `collectionGroup('ai_drafts')` | 0 docs |
| subcollection names under `users/*` (6 user docs listed) | `notificationLogs` 2, `ds_meta` 1, `ds_pages` 1, `fcmTokens` 1, `jobTemplates` 1, `preferences` 1 |
| positive control: `collectionGroup('ds_pages').count()` / `jobTemplates` | 4 / 1 (the queries do see data) |
| positive control: `companies` / `users` / `leads` counts | 3 / 5 / 262 |

So no stray invite exists in production, and there are no team invite or
roster documents at all right now. Nothing for Jo to decide about existing
data.

## Tests

- `tests/invite-claim-path.integration.test.js`, **41 checks** (32 before the
  review fixup), emulator
  bucket, new CI step in the `emulator-orphan-suites` job. Drives the real
  `claimInvite.run()` and `onRepSignup.run()` in-process against the Auth +
  Firestore emulators (no functions emulator). Stray documents are seeded with
  the admin SDK on purpose: the handler must hold even if one exists. Cases:
  a `users/{uid}/members` doc (two claimant token shapes), a real invite, a
  real invite beside a stray doc, five
  stray docs that sort ahead of a real invite, two real invites (still
  ambiguous), four "right name, wrong shape" docs (no company doc, role
  outside the allowlist, doc id not the email, nested deeper under a company),
  and (fixup) more stray hits than one page (10) and the page cap (11).
  Every stray-doc writer owns a `companies/{uid}` doc and the nested case sits
  under a real company id, so the company-exists check alone cannot pass them;
  every `onRepSignup` leg uses its own address (a wrongly successful claim leg
  flips its doc to active, which hid a signup failure in the first break run).
- `tests/collection-group-paths.test.js`, **23 checks**, node bucket:
  `matchDocPath` shapes and `retentionAudioPathFor` pairings.
- `tests/firestore-rules.test.js` section 35, **71 checks**: the owner and a
  platform admin cannot create `members`, `recordings`, `ai_drafts`,
  `notificationLogs` or an arbitrary name under `users/{uid}`, nor update or
  delete a seeded `members` doc; every allowlisted name plus the two template
  collections is create/update/read/delete-able by the owner, admin-writable,
  and closed to another user; reads of a server-written name are unchanged.
- Updated source-shape checks: `gauntlet-regressions.test.js` (the lookup
  moved; its absence check strips comments first), `smoke/functions.test.js`
  C5 (the cron deletes the path-checked `audioPath`),
  `session-revocation.test.js` (stub for the new require in `auth.js`).
- Floors 191/68/280 → 192/68/282.

Run on the shared emulator: invite suite `INVITE_TEST_PROJECT_ID=demo-invite-1`,
rules suites `RULES_TEST_PROJECT_ID=demo-rules-invite-1` / `demo-xtenant-invite-1`
(firestore-rules green incl. 35; cross-tenant 146/146). Node bucket 192/192,
smoke bucket 68/68, `smoke.test.js` 4421/4421.

## Break-tests

Each fix piece reverted alone (committed first, restored with
`git checkout`, tree verified clean after every run):

| Reverted | Suite | Reddened (and nothing else) |
|---|---|---|
| `claimInvite` back to the pre-fix file | invite | 15 claimInvite checks across cases 1, 3, 4, 6, 7, 8, 9 (the defect, reproduced) |
| `onRepSignup` back to the pre-fix file | invite | 7: signup legs of cases 1, 4, 5, 6, 7, 8, 9 (case 3 stays green: the real invite sorts first) |
| path check → `ref.parent.parent.id` | invite | 13: cases 1, 3, 9 (claim + signup) |
| page size 50 → 2 | invite | 2: case 4 claim + signup |
| ambiguity counted over every hit | invite | 6: cases 3 and 4 |
| company-exists check removed | invite | 2: case 6 |
| role check removed | invite | 3: case 7 (the clamp then grants `sales_rep`) |
| doc id / email check removed | invite | 2: case 8 |
| rules wildcard write back to any name | rules | 12 section-35 denies |
| `ds_pages` dropped from the allowlist | rules | 4 section-35 allows for `ds_pages` |
| `captures` dropped from the allowlist | rules | section 34's viewer-self `captures` allow (34 throws before 35 runs) |
| `retentionAudioPathFor` returns any path | unit | 6 pairing checks |
| `matchDocPath` depth check removed | unit | 1: longer path whose first four segments match |
| cron call site back to `rec.audioPath` | smoke | C5 only (the unit suite stays green: it tests the helper, not the call site) |

## Review fixup (2026-09-25)

The review of PR #1779 approved it with four minor points. What was done:

- **One page was treated as the whole answer.** The first version read a
  single page of 50 hits. Reproduced on the emulator with admin-seeded stray
  documents: more than 50 sorting ahead of `companies/` made the real invite
  `no_invite`, and a full page sorting *between* two real invites hid the
  second one, so the first company was claimed where the answer is
  `ambiguous_invite`. No client can write such a document after the rules
  change, so this was defence in depth, but the first PR body overstated it.
  Fixed: `findPendingInvite` pages to the end (cap `INVITE_MAX_PAGES` = 20
  pages of `INVITE_SCAN_LIMIT` = 50), and a scan that hits the cap answers
  `ambiguous` with `truncated: true` (fail closed; `claimInvite` keeps
  `ambiguous_invite` non-terminal, so it re-checks). Cases 10 and 11 of the
  invite suite; case 11 uses test-only small pages (`opts`).
- **This note was more operational than it needed to be** for a public repo
  while the fix is undeployed. The defect section now states what the lookup
  accepted and what that bypassed, without field values, the highest reachable
  role or which accounts were exposed.
- Two out-of-lane points were passed back to the orchestrator for separate
  follow-ups rather than folded into this PR.

Fixup break-tests (each alone on `invite-lookup.js`, restored byte-for-byte,
SHA checked):

| Reverted | Invite suite reddened (and nothing else) | `gauntlet-regressions` wiring pin |
|---|---|---|
| read one page again (`truncated = size >= pageSize`, no loop) | 3: case 10a claim + signup, case 11 control | stays green (the cursor code is still there; the suite is the real guard) |
| cap no longer fails closed | 2: both case 11 cap checks (`found` / `none`) | "fails closed when it hits its page cap" |
| `startAfter` cursor dropped (re-reads page 1) | 3: case 10a claim + signup, case 11 control | "pages through every hit" |

The unfixed lookup reddened 7 (10a ×2, 10b ×3, 11 ×2): the reproduction.

## Left open

- The retention cron itself is not run end to end (it needs Storage + a
  scheduled trigger); its call site is pinned by the smoke source check only.
- The three "rules only" collection-group readers above.
- `teamInviteEmail` (`onDocumentCreated companies/{companyId}/members/{id}`)
  is path-specific already and needed no change.
- Invite acceptance is implicit: a pending invite is claimed at dashboard load
  with no accept step. An explicit accept step is a separate product
  follow-up (pre-existing, out of this lane).
