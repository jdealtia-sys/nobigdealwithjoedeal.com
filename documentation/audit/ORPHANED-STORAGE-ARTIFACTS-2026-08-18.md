# Orphaned Storage artifacts — deleting a lead left its customer HTML live

**Date:** 2026-08-18
**Severity:** P0 (customer data publicly reachable, indefinitely, with no revocation path)
**Status:** CLOSED for the lead-keyed prefixes — **0 orphans, 0 public tokens remaining.** 4 tokens revoked in prod 2026-08-18 and verified dead. Two follow-ups open (`audio/d2d/`, other `getDownloadURL` sites).

---

## The finding in one line

Hard-deleting a lead removed the Firestore document and **nothing else** — every
baked HTML artifact that lead had accumulated stayed live in Firebase Storage,
fetchable by anyone holding the URL, while the only record that it existed was
destroyed.

## How it surfaced

While purging legacy portals (`scripts/purge-legacy-storage-portals.js --all
--apply`), five objects under `portals/` turned out to be invisible to the
script. Three belonged to leads that had been **deleted**
(`HWfAcHhMJ03iZPKabVHi`, `W5VbLJAeFXoGPCku93yf`); two sat at an older path shape
its patterns did not match (`JoKt4d0yJeF51MTmjaJh.html`,
`pptQX1KZWSXYBs7oTTMO.html`).

A bucket survey then found the same pattern in prefixes the script never looks
at at all:

| Prefix | Objects | Notes |
|---|---|---|
| `portals/{uid}/{leadId}…` | 10 | deleted 2026-08-18 (backed up first) |
| `documents/{uid}/{leadId}/d-*.html` | 6 | ≥3 belong to the same deleted leads |
| `galleries/{uid}/{leadId}.html` | 1 | same deleted lead |

Every one carried a `firebaseStorageDownloadTokens` value.

## Why the existing purge script could not see them

Its discovery is **lead-driven**: enumerate leads carrying legacy portal fields,
derive object paths from each. Two blind spots follow directly from that design,
and both were realised in prod:

1. `if (!leadSnap.exists) continue;` — a deleted lead is skipped *by
   construction*. The orphans nobody can find are exactly the ones it refuses to
   look at.
2. It only matches path shapes it already knows. An object written at any other
   shape is invisible regardless of which lead owns it.

The general lesson: **an orphan sweep whose discovery starts from the pointer can
never find the objects whose pointer is gone.** Discovery has to start from
storage.

## Why a download token is the whole problem

`getDownloadURL()` stamps a `firebaseStorageDownloadTokens` value on the object
and returns a URL that:

- bypasses Storage Security Rules entirely,
- never expires,
- has no revocation path short of rewriting the object's metadata,
- and — where it was persisted to Firestore as `htmlUrl` — leaked into every
  export, backup and support screenshot of that lead.

Revoking a `portal_token` only flips Firestore state. It does not touch the
Storage object. That is the defect `scripts/purge-legacy-storage-portals.js`
already documented in its own header for `portals/`; what this audit establishes
is that `documents/` had it too, on the **live** path, still minting new ones.

## Subsystem verdicts

Checked before deleting anything, because the two prefixes are not alike.

### `documents/` — **LIVE. Do not bulk-delete.**

- Written by `docs/pro/js/document-generator.js` on every doc generation, and
  re-uploaded with embedded signatures by `onPersistFinalized`.
- Read by `functions/remote-signing.js` (`getSignDocument`, `submitSignature`)
  over the admin SDK from `htmlPath` — **not** via the token.
- Linked from the customer Documents tab (`customer-signed-doc-upload.js`).

Only orphans (lead gone) are safe to delete. Live-lead objects keep the object
and lose the token.

### `galleries/` — **RETIRED. Safe to delete.**

- `ShareGallery.generate` was removed; `docs/pro/customer.html` records why — it
  "could never succeed", because the `galleries/` write rule requires
  `isImage()` and it uploaded a `text/html` blob, so `uploadBytes` always
  returned `storage/unauthorized`.
- Nothing reads the prefix. The one object is a pre-hardening relic.

## What shipped

| Change | File |
|---|---|
| `onLeadDeleted` trigger — reaps `documents/` `portals/` `galleries/` `audio/` under `{uid}/{leadId}/`, the orphaned `documents` subcollection, and outstanding `portal_tokens` / `doc_sign_tokens` | `functions/lead-artifact-cleanup.js` |
| Docgen stops minting the permanent token; `htmlUrl` no longer written | `docs/pro/js/document-generator.js` |
| Authed read-back replacing it — owner/manager/admin, admin-SDK read, rendered first-party in the sandboxed viewer | `functions/document-view.js`, `docs/pro/js/customer-signed-doc-upload.js` |
| Storage-driven orphan sweep + `--revoke-tokens` for live-lead objects | `scripts/sweep-orphan-lead-artifacts.js` |
| Path-parser regression test (26 cases) | `tests/orphan-sweep-parser.test.js` |
| e2e assertion inverted: `htmlUrl` must now be **absent** | `tests/e2e/pro-authed.spec.js` |

### Why not a signed URL

The obvious fix — swap `getDownloadURL` for the existing `signImageUrl`
(15-minute v4 signed URL) — is wrong, and the codebase already says so.
`functions/handlers/photo.js`'s **H-01** note explains that `portals/` is
deliberately excluded from that endpoint's allowlist because *HTML fetched from
`storage.googleapis.com` executes in that origin*. Its allowlist is
`(photos|galleries|reports|docs)` — no HTML prefix. A signed URL would have
traded a permanent leak for a same-origin-as-Google script execution surface.

So the document HTML is read back the way `/share/**`, `/report/**` and
`/deal/**` already work: bytes through a function, over the admin SDK, after an
explicit authorization check. The difference is that those three serve no-login
homeowners and therefore need a token; this one serves the authenticated rep, so
their own Firebase auth **is** the check and no token needs to exist at all.

### The false positive that nearly shipped

The sweep's first path parser accepted `{prefix}/{uid}/{X}` as a flat shape for
every prefix. But `docs/{uid}/{file}` is a real flat shape — so
`docs/UID/1755_signed_contract.pdf` would have parsed `1755_signed_contract.pdf`
as a leadId, found no such lead, and **deleted a customer's signed contract as an
orphan**. Flat shapes are now accepted only for the prefixes that actually had
one, and a leadId candidate must look like a Firestore auto-ID; anything
ambiguous is reported for human review, never acted on. The two directions are
not symmetric — a false negative costs a manual look, a false positive destroys
customer data — and `tests/orphan-sweep-parser.test.js` pins both.

## Prod sweep result (2026-08-18, dry-run)

Ran `node scripts/sweep-orphan-lead-artifacts.js` against `nobigdeal-pro` /
`nobigdeal-pro.firebasestorage.app`, read-only. **6 objects total** under the
lead-keyed prefixes, all belonging to one tenant uid.

| Bucket | Count | Meaning |
|---|---|---|
| **Orphans** (lead absent) | **0** | nothing left to reap |
| Soft-deleted lead + public token | 2 | `documents/…/1ZBpsX4dwmdwS1MyoLAT/…`, `documents/…/qLaMKPu3zkgXUeaJBn1g/…` |
| Active lead + public token | 2 | `galleries/…/JoKt4d0yJeF51MTmjaJh.html`, `documents/…/WKzo8n8ItkxFBVWxOc1r/…` |
| Unparsed (no leadId in path) | 2 | `audio/{uid}/d2d/{ts}_{ts}.webm` — both tokened |

`portals/` is now **empty** — the 2026-08-18 purge cleared it.

### Two corrections to the original report

The survey that opened this audit made two assumptions the sweep disproves.
Recorded here because both would otherwise be re-derived by the next session:

1. **The `documents/` objects for the hard-deleted leads are already gone.**
   `HWfAcHhMJ03iZPKabVHi` and `W5VbLJAeFXoGPCku93yf` are confirmed absent from
   Firestore (genuinely hard-deleted), and no object under either leadId remains
   in the bucket. The survey's "6 objects under `documents/`, ≥3 belonging to
   deleted leads" no longer holds — 3 remain, none orphaned.
2. **`galleries/…/JoKt4d0yJeF51MTmjaJh.html` is not an orphan.** That lead
   **exists and is not even soft-deleted**. It is still a retired-subsystem
   artifact carrying a permanent token — worth deleting on those grounds — but
   it is not evidence of the delete-leaves-artifacts bug.

### New finding: soft delete ≠ hard delete

Deleting a lead in the CRM is a **soft** delete (`deleted: true` — the
restorable trash bin); only `_permanentDeleteLead` removes the doc. There are
**18 soft-deleted leads** in prod. Two of the four tokened objects belong to
them: the rep considers those leads deleted and cannot see them in the UI, while
their generated documents stay fetchable by anyone with the URL.

That is not an orphan — the lead is restorable, so the artifact must survive —
but it is the least defensible token population, so the sweep now reports it as
its own bucket rather than lumping it in with active leads. `onLeadDeleted`
correctly does **not** fire for soft delete.

### `audio/{uid}/d2d/…` is a shape the parser does not cover

Both remaining unparsed objects are d2d voice memos keyed by **timestamp, not
leadId**. They are knock-scoped, so they are not orphans in the leadId sense —
but they carry permanent tokens and no lead-driven sweep will ever see them.
Reaping them needs a knocks-collection pass. Correctly reported rather than
guessed at, which is the behaviour the parser guard exists to produce.

## Token revocation (2026-08-18, executed on Jo's instruction)

`--revoke-tokens --apply --yes` against prod. **4 tokens revoked, 0 failures.**
Token values *and* object bytes were captured to disk outside the repo first — a
revoke is metadata-only, but the token value itself is unrecoverable once
stripped, and the script's backup path covers deletes, not revokes.

Verified afterwards, per object: metadata carries no
`firebaseStorageDownloadTokens`, the object still exists with byte-identical
size, and **the exact URL that was public before now returns HTTP 403**. A
metadata read alone would not have proven revocation; fetching the old URL does.

Post-revoke sweep: `orphans 0 · soft-deleted w/ token 0 · active w/ token 0`.

### Nothing broke — and the htmlPath-preference is why

Both revoked `documents/` rows that a rep can still reach carry **`htmlPath` and
a stale `htmlUrl`**. The client prefers the callable whenever `htmlPath` is
present precisely so those rows do not render a now-dead token link:

```js
var href = d.url || d.signedDocumentUrl || (d.htmlPath ? '' : (d.htmlUrl || ''));
```

Without that ordering, revoking would have left two documents showing a View
link that 403s. Verified post-revoke: both resolve through `getDocumentHtml`.

The stale `htmlUrl` values themselves are now dead data on those two Firestore
rows. Harmless (nothing reads them), not cleaned up — that would be an unasked
prod write.

### Pre-existing: documents with no artifact pointer at all

Unrelated to this fix, surfaced while verifying it. Several metadata rows under
`leads/{leadId}/documents` carry **no** `htmlPath`, `htmlUrl`, `url` or
`signedDocumentUrl` — one under `qLaMKPu3zkgXUeaJBn1g`, and **all 40** under
`JoKt4d0yJeF51MTmjaJh` (contracts, proposals, work authorizations, certificates
of completion). Their View link was already dead before this change — the old
code rendered no anchor when every URL field was empty — so this is not a
regression, and the new code behaves identically for them.

The likely cause is docgen's swallowed upload failure: `_persistPromise`
`console.warn`s and continues when the Storage leg fails, so the metadata doc
lands without a path. Worth its own investigation — 40 documents a rep believes
they generated have no retrievable artifact.

## Open actions

1. ~~Run the sweep against prod~~ — **done 2026-08-18: 0 orphans.** Nothing to delete.
2. ~~Decide on `--revoke-tokens`~~ — **done 2026-08-18: 4 revoked, verified 403.**
3. **The 2 `audio/{uid}/d2d/…` objects** still carry permanent tokens and are
   outside every lead-keyed sweep (timestamp-keyed, knock-scoped). Separate pass.
4. **40+ document rows with no artifact pointer** (see above) — a rep believes
   these documents exist; nothing can retrieve them.
5. **`photos/` is structurally unsweepable** by this script: it is
   `photos/{uid}/{file}`, flat, not leadId-keyed. Orphans there need a
   photos-collection query by leadId. Lower urgency — photo reads go through
   `signImageUrl` (15-min signed URL, no permanent token), so an orphan is not
   publicly fetchable.
6. **~13 other `getDownloadURL` call sites** remain across `docs/pro/js/`
   (close-board, customer-dnd-upload, photo-engine, voice-intelligence,
   d2d-tracker, expenses, …). Each mints the same permanent unrevocable URL.
   Out of scope for this fix, which addressed the prefixes named in the report;
   worth its own pass.

## Related

- [SITE-AUDIT-LOOSE-ENDS-2026-08-10](SITE-AUDIT-LOOSE-ENDS-2026-08-10.md) — prior
  security fix wave (EXIF-GPS P0, rules hardening)
- `scripts/purge-legacy-storage-portals.js` — the one-time backfill whose blind
  spots this audit documents
- `functions/FUNCTIONS_INDEX.md` — rows for `getDocumentHtml`, `onLeadDeleted`
