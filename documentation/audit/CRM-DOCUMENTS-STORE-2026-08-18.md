# CRM Documents — four surfaces, three stores, one real one

**Date:** 2026-08-18
**Trigger:** Jo — "when I click a customer full details I don't see any documents even though they have a job value."
**Scope:** `docs/pro/customer.html` and its documents modules.
**Status:** fixed on `qc/site-sweep-2026-08-18`.

---

## Symptom

A customer with real work on the record — generated contracts, invoices,
uploaded signed paperwork — showed **"No documents yet"** on the customer page.

## Root cause

Not one bug. The page had grown **four documents surfaces reading three
different Firestore locations**, and the one location documents actually land
in was read by only one of them.

### Where documents are actually written

All three real creation paths write the **`leads/{leadId}/documents`
subcollection**:

| Path | Writer |
|---|---|
| Generate Documents | `document-generator.js:464` |
| Upload Signed Documents (camera / file) | `customer-signed-doc-upload.js:44` |
| Drag-and-drop | `customer-dnd-upload.js:178` |

### Where the page was looking

| Panel | Read | Outcome |
|---|---|---|
| Overview → **Documents** (`#docList`) | top-level `documents`, `leadId + userId` | **Wrong store.** Only the legacy Overview upload modal ever wrote there. Everything else invisible. |
| Documents tab → **Shared Documents** (`#sharedDocList`) | `lead_documents` | **Dead store.** Nothing in the client *or* `functions/` has ever written `lead_documents`. Structurally impossible to populate. |
| Documents tab → **Generated Documents** (`#generatedDocList`) | nothing — `logGeneratedDoc` built a DOM row | **Not persisted.** Emptied itself on every reload, even though the generator *does* persist. |
| Documents tab → list under **Upload Signed Documents** (`#signedDocsList`) | `leads/{id}/documents` | The only correct reader — and buried under the upload buttons. |

### And the one correct reader had a race

```js
document.addEventListener('DOMContentLoaded', function () {
  setTimeout(loadSignedDocs, 2000);   // customer-signed-doc-upload.js:140
});
```

`window._customerId` is set at `customer-bootstrap.module.js:349`, after the
auth handshake and the lead fetch. On a cold load that regularly exceeds 2s.
`loadSignedDocs` hit `if (!list || !window._customerId) return;` and **never
retried** — `loadCustomerData` didn't call it and it wasn't in
`loadNewPortalSections`. Lose the race, see nothing, forever.

### Ruled out

- **Indexes** — the composite indexes for both top-level queries exist in
  `firestore.indexes.json`.
- **Rules** — `firestore.rules:376` allows the lead owner and same-company
  staff to read the subcollection.

The data was always there and always readable. The page was reading the wrong
places.

### The failure that hid it

`loadDocuments`' `catch` rendered the **same "No documents yet" empty state**
as a genuinely empty result. Any read failure was indistinguishable from a
customer with no documents. That is why this survived so long, and it is the
specific behaviour the new module refuses to reproduce.

---

## Fix — consolidation, not a patch

New module **`docs/pro/js/customer-documents.js`** owns the store: one read,
one normalized shape, one cache, every surface painted from it.

- Reads `leads/{leadId}/documents` **unfiltered and unordered** — no composite
  index required, so it cannot fail closed the way an index-less query does.
  Sorting and the soft-delete filter happen in memory; the collection is
  per-lead and small.
- Best-effort second read merges surviving **legacy** rows from the top-level
  `documents` collection so nothing predating the consolidation is orphaned.
  They carry `legacy: true` so deletes target the right path.
- **Normalizes the three field shapes** the writers stamp for the same thing:
  `name | filename | typeName`, `url | htmlUrl | signedDocumentUrl`,
  `uploadedAt | createdAt | date`. No renderer has to know that any more.
- **A failed read paints an error, never an empty state.**
- Publishes `window.loadDocuments`, called from `loadCustomerData` with the
  resolved lead id. **No timer, nothing to race.**

### Surfaces after

| Surface | Contents |
|---|---|
| Overview → Documents | everything on the lead |
| Documents tab → Generated Documents | generator output (persisted, survives reload) |
| Documents tab → list under Upload Signed Documents | uploads: camera, file, drag-and-drop |
| ~~Shared Documents~~ | **removed** — it read a store nothing writes |

### Other changes

- `customer-photo-report-generator.js` — legacy `loadDocuments` removed; its
  upload modal now writes the canonical subcollection instead of the top-level
  collection (it was the sole writer of the split).
- `customer-signed-doc-upload.js` — upload-only now; no list, no delete.
- `customer-tasks-ui.js` — dead `loadSharedDocuments` removed;
  `logGeneratedDoc` re-reads the store instead of inserting a DOM row.
- `document-generator.js` — repaints after the metadata write and after
  signing, so a doc appears and gains its ✓ Signed state without a reload.
- Soft delete (`deleted: true`) moved to the store, and now routes legacy rows
  to the top-level collection rather than blindly patching the subcollection.

### Guards added

- `tests/customer-documents-store.test.js` (**new**, 38 assertions) — every
  writer targets the canonical subcollection; no surface reads a store nothing
  writes; the loader runs off the real lead id, never a timer; and **a failed
  read never renders as an empty one**. Behavioural half runs the real module
  against a fake Firestore and asserts the rendered HTML.
- `tests/customer-doc-delete.test.js` — followed the delete to its new home,
  plus a new case for legacy-row path routing.
- `tests/smoke/crm.test.js` — documents count assertions repointed at the store.
- Registered in `tests/ci-manifest.json` (node bucket).

---

## Note for whoever touches this next

The top-level `documents` collection is still written by `dashboard-api.js` for
the **company-wide** document library. Those rows carry no `leadId`, so the
legacy merge query (`where('leadId','==',leadId)`) excludes them. Don't
"clean up" that collection assuming it is dead — it isn't, it is just a
different feature.

## Open question: is the legacy merge read still load-bearing?

The store does a second, best-effort read against the top-level collection so
rows written by the old Overview upload modal aren't orphaned. That costs a
query on every customer-page load. If no live lead-scoped rows survive in prod,
it can be deleted along with the `legacy` flag and the split delete path in
`deleteCustomerDoc`.

Unanswered as of this note — it needs prod credentials, which the session that
wrote this didn't have. **`scripts/audit-legacy-documents.js`** answers it in
one read-only run:

```bash
node scripts/audit-legacy-documents.js
```

It buckets the collection into live lead-scoped rows (the merge read's whole
reason to exist), soft-deleted lead rows (filtered by the store, so they don't
count), and the company library (not ours — it never proposes touching those).
It also flags rows duplicated across both stores, which render twice today
since the store merges without deduping. Read-only, always exits 0, not a CI
gate. Guarded by `tests/legacy-documents-audit.test.js`.

## Related

- [SITE-QC-SWEEP-2026-08-18](SITE-QC-SWEEP-2026-08-18.md) — same branch
- [CRM-ADDRESS-INTEGRITY-2026-08-18](CRM-ADDRESS-INTEGRITY-2026-08-18.md) — same branch
