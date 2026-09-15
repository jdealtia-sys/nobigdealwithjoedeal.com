# pdf-renders/ — the prefix with no rule, no reaper, and a public URL on every object

**2026-09-08.** Opened from open item 2 of
[SESSION-2026-09-08-photo-report-builder](../projects/SESSION-2026-09-08-photo-report-builder.md)
and §9 of [NEXT_SESSION-2026-09-09](../projects/NEXT_SESSION-2026-09-09.md), both
of which landed with PR #1483.
Related: [ORPHANED-STORAGE-ARTIFACTS-2026-08-18](ORPHANED-STORAGE-ARTIFACTS-2026-08-18.md)
(same leak class, different prefix) and [STABILITY-AUDIT-2026-09-04](STABILITY-AUDIT-2026-09-04.md).

---

## What was measured, not assumed

The brief said the download-token URL was "often" the one handed back, and asked
whether tokens are actually minted in prod rather than reasoning about it. Both
halves of that turned out to be worth checking, and one of them was wrong.

**Prod survey of `gs://nobigdeal-pro.firebasestorage.app/pdf-renders/`:**

| | |
|---|---|
| Objects under the prefix | **21**, all under one uid |
| Carrying `firebaseStorageDownloadTokens` | **19** |
| Not carrying one | 2 — the two oldest, predating the fallback code |
| Newest object | 2026-06-21 (~11 weeks old) |
| In `nobigdeal-pro.appspot.com` | 0 — the whole set lives in the `.firebasestorage.app` bucket |

**The exposure is real, and it was proven with a matched control** rather than
inferred from the presence of a token. On a customer roofing contract:

```
unauthenticated HEAD, token present  → 200 OK, application/pdf
unauthenticated HEAD, token stripped → 403 Forbidden
```

The token is exactly what grants access. No credentials were sent in either
request.

### The premise that was wrong: the IAM gap is already closed

`render-pdf.js` falls back to a token URL when `getSignedUrl()` cannot reach the
IAM signBlob API. That gap is **shut**:

```
roles/iam.serviceAccountTokenCreator
  → serviceAccount:717435841570-compute@developer.gserviceaccount.com
```

verified against the live project IAM policy. `717435841570-compute@` is the SA
Gen-2 functions run as, so signing is the live path and the fallback should not
be firing at all.

**So why does every recent object carry a token?** Because the token was never
conditional. It was minted and stamped into the upload metadata *before* signing
was attempted, on the happy path as much as the failure path — the object got a
permanent public URL whether or not anything ever used it. `urlMode` in the
success log described which URL was *returned*, never which objects were
*reachable*. That is the actual defect, and it is independent of the IAM
question the brief framed it around.

---

## What changed

1. **`storage.rules` — an explicit `pdf-renders/{uid}/{allPaths=**}` block.**
   `read: isOwner(uid) || isAdmin()`, `write: if false`. There is no separate
   `allow delete` line on purpose: in Storage rules `write` already covers
   create, update and delete, so this denies a rep overwriting a rendered
   invoice or destroying the record. Only the admin SDK writes here, and it
   bypasses rules entirely.

2. **`functions/pdf-render-retention.js` — a daily reaper, 30-day window.**
   Deletes objects under the prefix past `RETENTION_DAYS`, 04:20 ET (after the
   03:15 Firestore export and its 03:45 retention pass).

3. **`functions/render-pdf.js` — the token is minted lazily.** The upload no
   longer stamps one. If `getSignedUrl()` fails, the handler mints a token *then*
   and attaches it via `setMetadata`, so only genuinely unsignable renders carry
   one and `urlMode` becomes a true record of which objects are reachable. If the
   token stamp also fails, it now throws instead of returning a URL that 403s.
   `cacheControl` went `public` → `private`: these are customer invoices and
   contracts, and while `public` is a caching directive rather than an ACL, it
   licenses shared caches to retain the bytes.

4. **`pdf-renders` added to `STORAGE_PREFIXES`** (`functions/integrations/user-owned.js`).
   The prefix was in neither the GDPR export nor the erasure sweep, so a
   right-to-be-forgotten request left every rendered customer document sitting
   in the bucket.

### Why a scheduled reaper and not a bucket lifecycle rule

A GCS lifecycle rule (`matchesPrefix: ["pdf-renders/"]`, `age: 30`) does the same
deletion for free with no function to cold-start, and it was the first choice.
Rejected for two repo-specific reasons:

- **Lifecycle config is bucket state, not repo state.** Nothing in the tree would
  record that the policy exists, no review would see it change, and a console
  edit could silently disable it. The one-time-operator-setup pattern is exactly
  what bit us before: `firestore-backup.js`'s setup had never been run, and all
  three backup functions failed nightly from the day they shipped.
- **A lifecycle rule cannot log.** The reaper emits a completion line on every
  run including the zero run, which is how you tell "no old renders" apart from
  "the job is dead".

**30 days** because the signed URL the callable returns lives 7 — an object older
than that is already unreachable through the intended path. 30 leaves margin for
support and for a bookmarked link, while bounding how long a leaked token URL
stays live. Renders are derived artifacts; the Firestore row each was built from
is the system of record.

**On its first run the reaper will delete all 21 current objects** — the newest is
~11 weeks old. That is the intended outcome: those are the 19 tokened, publicly
fetchable ones, and for a download token, deleting the object is the only
revocation there is.

---

## Two methodology traps, both of which produced a confidently wrong answer

Recorded because either one alone would have put a false claim in this note, and
the first survey did exactly that.

**1. `gcloud storage objects describe --format="value(metadata)"` returns empty
for custom metadata.** The field is rendered as `custom_fields` in the object
description, and `--format="value(custom_fields)"` *also* returns empty. Both
produce a clean, plausible "0 objects carry a token" across all 21 — the exact
opposite of the truth. Only the unformatted output shows it:

```
custom_fields:
  firebaseStorageDownloadTokens: d9097238-…
```

A prior survey had already been burned by this once — a bulk listing filter
mis-reported `documents/` and `galleries/` as tokened when explicit metadata
reads showed they never were. Same trap, one layer down. **Grep the raw
description; do not trust a `--format` key you have not seen produce a non-empty
value.**

**2. A path list written on Windows carries `\r`.** `gcloud storage ls > file`
then `while read -r o` feeds `describe` a path ending in a carriage return; it
fails, `2>/dev/null` hides it, and every object reports "no token" *uniformly* —
which reads as a clean negative result rather than a broken loop. `tr -d '\r'`
fixed it and the count went 0 → 19.

What caught both: a **positive control**. Dumping one object's full description
showed a token that the survey had just reported as absent. A survey that can
only return "clean" is not evidence.

---

## Still open — deliberately not fixed here

### 1. `renderPdf` is down in production, and has been for at least three weeks

Not part of this lane, found while reading logs for `urlMode`. **Every single
`renderPdf` invocation in the 30-day log retention window failed.** There is not
one success line in the window.

```
stage: launch
err:   chromium.executablePath is not a function
```

Newest failure 2026-09-07T17:42Z; the pattern runs back to the start of retention
(2026-08-16). `functions/package.json` pins `@sparticuz/chromium: 149.0.0` and
`render-pdf.js` calls `await chromium.executablePath()` after a bare
`require('@sparticuz/chromium')`. A CJS/ESM interop change in that package would
produce exactly this symptom (`require()` yielding `{ default: … }`), but the
package is **not installed in this worktree**, so that is a hypothesis and not a
measurement — do not act on it without checking the deployed export shape.

Every server-side PDF — warranty, estimate, invoice, contract, change order,
receipt, inspection, photo report — is currently failing over to the client-side
html2canvas path. This is a bigger live problem than the one this note fixes.

**Picked up and fixed in PR #1505** (`RENDERPDF-CHROMIUM-INTEROP-2026-09-08.md`),
which dates the outage to **June** — further back than the 30-day log window used
here could show. Treat "at least three weeks" above as the floor my evidence
supported, not the extent of it.

### 2. `documents` and `esign` are missing from `STORAGE_PREFIXES`

`user-owned.js` says the list is "every Storage bucket path of the shape
`<prefix>/{uid}/...` per storage.rules". It is not: `documents/` (generated and
signed customer HTML) and `esign/` (counter-signed PDF envelopes) are both absent,
so **account erasure leaves them behind.**

Not fixed here on purpose. Widening what an irreversible erasure destroys is a
decision with legal weight — `esign/` holds executed contracts — and it does not
belong in a storage-rules PR.

### 3. The gate that should have caught all of this cannot

`tests/smoke/auth.test.js` asserts `STORAGE_PREFIXES` covers the storage.rules
prefixes against a **hand-maintained list of 8**, while storage.rules defined
**eleven**. Because it only checks `listed ⊆ STORAGE_PREFIXES`, a prefix missing
from both the list and the registry is invisible to it — which is precisely how
`pdf-renders` came to hold customer contracts that erasure never touched.
`receipts` had drifted the same way: registered, but ungated.

The list now includes `receipts` and `pdf-renders`, and the stale "all 8" label is
gone. **The structural fix is to derive the prefixes from `storage.rules` itself**
rather than retype them; that was not done here because it fails immediately on
item 2 above, and the honest order is to decide item 2 first.

---

## Verification

- `tests/storage-rules.test.js` — new section 27, run against the storage
  emulator. **Break-tested in both directions**, with markers to confirm *which*
  assertion reddened rather than just that something did:
  - `write: if false` → `isOwner(uid)`: fails at 27c's first write-denial (the
    marker before it prints, the one after it does not).
  - `read: … ` → `if true`: fails earlier, inside 27a/27b, at the cross-tenant
    and anonymous reads.
  - Read fixtures are seeded through `withSecurityRulesDisabled` — uploading as
    the owner is impossible by design now, and without seeding the read
    assertions would pass vacuously against an object that never existed.
- `tests/pdf-render-retention.test.js` — new, 45 assertions. Confinement against
  all eleven sibling prefixes plus the `pdf-renders-archive/` `startsWith` trap,
  fail-closed dating, and the renderer's upload block. **Break-tested**: putting
  the token back into the upload reddens exactly 3 assertions while "found the
  upload block to inspect" stays green, which is what proves the negative regexes
  are not matching an empty string.
- `node tests/smoke.test.js` — 3641 passed, 0 failed. It caught the new export
  before I did: `pdfRenderRetention` had no `FUNCTIONS_INDEX.md` row.
- `node scripts/run-test-manifest.js --check` — clean at `{ node: 97, smoke: 65,
  disk: 180 }`; the floors were bumped by one, per
  [SUITE-COUNT-FLOORS-2026-09-08](SUITE-COUNT-FLOORS-2026-09-08.md).
- `node scripts/check-js-syntax.js` — 497 files clean.
