# Session 2026-09-06 — the offline photo queue now survives leaving the page

**Lane:** CRM / mobile field reliability
**Branch:** `claude/offline-photo-queue-durable`
**Follows:** [SESSION-2026-09-06-crm-friction](SESSION-2026-09-06-crm-friction.md) §6, which
shipped the drain and explicitly left persistence as the remaining gap.

---

## The one-sentence version

A photo queued while offline used to exist only in a JavaScript array, on a page
that **reloads itself on every iOS resume** — so the exact gesture a rep makes
on a roof (background the app, come back) destroyed it. It is now in IndexedDB,
drained on boot, and the toast finally makes a promise the code keeps.

## Why the previous fix was not enough

PR #1416 made `state.uploadQueue` actually drain — on `online`, and after any
successful upload. That closed the "queued and never retried" hole. It could not
close the loss hole, and said so: the toast was deliberately worded
*"Photo held — retrying when you're back online. **Keep this page open.**"*

That caveat existed because of one line, verified again this session:

> `docs/pro/js/dashboard-sw-bootstrap.js:69-72` — `pageshow` → `if
> (event.persisted) window.location.reload()`

That is a full navigation on **every bfcache restore**. iOS Safari puts a page
in bfcache when the user swipes up to close or switches apps. So the reload is
not an edge case for a field rep; it is the normal path, and a memory-only
queue could not survive it.

## Verification pass first (this brief's claims, re-checked against `main` @ 3f61313d)

The task brief was written 2026-09-06 and this repo has a documented history of
confident-but-false claims in its own notes, so every cite was opened. All held:

| Claim | Verdict |
|---|---|
| `OfflineManager` has zero callers | **True.** Repo-wide grep finds the definition (`offline-manager.js:764`), two doc mentions, an allowlist entry in `crm-audit.js`, a name in a smoke-test list. No call site. |
| `const OfflineManager` is never put on `window` | **True.** Module-local const inside the IIFE. |
| `offline-manager.js` is not loaded on `dashboard.html` | **True** — *and worth stating more precisely than the brief did:* it IS loaded on `customer.html:2202` and `login.html:366`, so its `init()` does run there. It is only absent from the dashboard. |
| `sw.js:152` short-circuits non-GET, so the queue branch at :475 is dead | **True.** |
| `queueOfflineWrite` (:547) is never called | **True.** |
| `SYNC_TAG` `'nbd-sync-queue'` is registered by nothing | **True.** The only `sync.register` in `docs/` is `d2d-tracker-core-2026b.js:615`, for a *different* tag (`nbd-d2d-sync`). |

## The decision: a dedicated store, not `OfflineManager`

Mounting the existing queue was the tempting option — it is complete, careful,
and unused. It is the wrong shape for photos on four counts, each a defect
rather than a matter of taste:

1. **Its flush is a Firestore REST write.** `flushQueue()` calls
   `performFirestoreWrite(item, token)`, built from `item.url` / `method` /
   `data`. A photo is a *Storage* upload followed by a Firestore doc write.
   Reuse means branching one drain loop across two unrelated protocols.
2. **Its cap is sized for JSON, and its own comment admits it** —
   `MAX_QUEUE_SIZE = 500`, commented *"500 items at ~2KB each ≈ 1MB"*. A
   high-res photo is ~1.2MB **after** `resizeImage()`. 500 of those is ~600MB,
   so the cap would never fire before the browser threw `QuotaExceededError` —
   the precise silent-loss failure that cap was written to prevent. This is the
   check the brief asked for, and it is the decisive one.
3. **Its store is shared with the service worker.** DB `nbd-offline-db` / store
   `pending-writes` is also read by `sw.js`'s `flushOfflineQueue()`, which
   replays each row as `fetch(item.url, {method, body})` **and deletes it**. A
   photo row has no meaningful `url`. That path is dead today (see the table
   above) but writing photos into a store another component believes it owns is
   a grenade for whoever revives it.
4. **Loading it on the dashboard adds a second reload driver.** It registers its
   own `controllerchange` handler that force-reloads auth-gated pages, on top of
   `dashboard-sw-bootstrap.js`'s. Two independent reload drivers with separate
   guard flags, on a page with a documented history of reload loops.

So: **`docs/pro/js/photo-queue-store.js`** — own DB (`nbd-photo-queue-db`), own
store, caps sized for image blobs. `offline-manager.js` is left untouched and
still dead; killing or mounting it is a separate call, noted below.

### Two implementation choices worth recording

- **Records hold `ArrayBuffer` + mime, not `Blob`.** IndexedDB accepts Blobs and
  that would be less code, but WebKit has a long history of Blob-in-IDB
  references going unreadable *after a browser restart*. Surviving a restart is
  this module's whole purpose, so the bytes are stored and the Blob rebuilt on
  read. (This also drops the base64 the old memory queue carried — a queued
  photo is now ~33% smaller than the `dataUrl` it replaced.)
- **Caps: 80 items / 80MB.** Sized against the real presets after
  `resizeImage()`: quick ~40–80KB, standard ~200–400KB, high-res ~0.8–1.5MB. A
  full high-res roof set (~40 photos, ~50MB) fits with headroom; the 81st is
  refused **out loud**, with the modal left open and the Save button re-enabled,
  rather than silently discarded.

## What shipped

| File | Change |
|---|---|
| `docs/pro/js/photo-queue-store.js` | **new** — the IndexedDB store. Caps, quota/eviction handling, `requestPersistence()`, `detectLoss()`. Side-effect-free and unit-testable. |
| `docs/pro/js/photo-queue-recovery.js` | **new** — boot drain. Waits for Firebase auth, pulls the lazy `photos` bundle via `ScriptLoader`, calls `flushUploadQueue()`. |
| `docs/pro/js/photo-engine.js` | queue writes go through `enqueueForRetry()`; the drain reads from the store and deletes **only after a confirmed upload**; toast copy now branches on the real outcome. |
| `docs/pro/dashboard.html` | loads both new files with `defer`. |
| `tests/photo-queue-durability.test.js` | **new** — behavioural, 29 assertions. |
| `tests/photo-offline-queue.test.js` | updated: the copy assertion **inverted, not deleted** (see below). |
| `tests/ci-manifest.json` | new suite classified in the `node` bucket. |

### The recovery module is the half that is easy to forget

`photo-engine.js` is lazy — it arrives with the `photos` bundle when a rep opens
a photos view. Persisting the queue without a boot drain would mean a photo that
*survives* the reload still uploads nothing until the rep happens to navigate
back to photos. `photo-queue-recovery.js` is loaded eagerly and closes that loop
with no rep action.

### A latent bug fixed on the way past

The old drain did `state.uploadQueue.splice(0, length)` into a local `batch`,
then on failure re-queued **only the item that threw** and `break`ed. On a
five-photo queue failing at #3, photos #4 and #5 existed solely in that local
array and were destroyed when it went out of scope — silently. The new drain
never splices up front: items leave storage one at a time, only after a
confirmed upload, so a mid-drain failure leaves the failing photo *and
everything behind it* exactly where they were.

> **Resolved mid-session:** that other branch
> (`claude/fix-markpaid-repaint-and-queue-drop`) merged as **#1417** while this
> was being built — it fixed the same bug by re-queueing `batch.slice(i)`. This
> PR's first commit sits directly on top of it (parent `6e8b14b9`) and
> supersedes #1417's `photo-engine.js` drain and its
> `photo-offline-queue.test.js` wholesale; the no-splice design makes the bug
> structurally impossible rather than compensating for it. The one thing from
> #1417 worth keeping was its **behavioural harness** — it extracted
> `flushUploadQueue` and actually ran it, because the regex assertions had
> matched while the code destroyed photos. That harness is ported and
> re-targeted at the store (items must remain *in storage* after a mid-drain
> failure), plus the memory-only fallback path where #1417's original property
> must still hold. #1417's other files (`customer-tasks-ui.js`,
> `invoice-pipeline.js`, `customer-invoice-markpaid.test.js`) are untouched.

## The toast copy

The old test asserted the toast did **not** say "will upload when connected",
because nothing implemented that promise. That assertion was not deleted — it
was **inverted and tied to the thing that earns it**:

- Durable write succeeded → *"Photo held — it will upload when you're back
  online, even if you close the app."* The test requires this string to
  co-occur with a real `await store.add(item)` **inside the `outcome.durable`
  branch**, so the copy cannot drift ahead of the code again.
- IndexedDB genuinely unavailable (private mode, disabled storage) → the old
  *"Keep this page open"* wording, which is still the truth on that path.
- Queue full / device out of space → an error, modal stays open.

## Proving the gates can fail

Per the standing rule, neither suite was trusted on a green run alone:

1. **Durability gate** — regressed `photo-queue-store.js` to a memory-only
   array. `photo-queue-durability.test.js` went red on exactly the 8 reload
   assertions (`BOTH photos survive a page reload`, the metadata round-trip, the
   byte check). Restored → 29/29.
2. **Copy gate** — reverted the toast to the weak wording.
   `photo-offline-queue.test.js` went red on `the toast makes the durable
   promise` and `...and it is only shown when the write SUCCEEDED`. Restored →
   22/22.

## Verified against a real browser, not only the shim

The unit suite drives a hand-written in-memory IndexedDB, which could be wrong
about real IDB semantics. So the store was also exercised in Chrome against the
genuine implementation via a temporary harness under `docs/pro/` (served with
the `http-server` launch config, **removed before commit**):

- seed → `available=true`, ids 1,2, `count=2`, `bytes=6144` (4096+2048 exactly)
- **full page reload** → `count after reload=2`, and every check `ok`: leadId,
  tags, description, location, timestamp, blob type, blob size, **byte values at
  both ends of the buffer**, and ordering
- `remove()` → count drops to 1; `clear()` → 0
- console clean apart from a favicon 404 from the bare harness page

One honest result to record: **`navigator.storage.persist()` returned `false`**
in desktop Chrome (no user engagement / not installed). The code treats a
refusal as non-fatal, which is right — but it means the WebKit 7-day-eviction
exemption is *requested*, not guaranteed. `detectLoss()` exists precisely for
the case where it is refused and the browser later clears the store: the rep is
told photos were lost rather than discovering it weeks later.

## Gates run

```
node scripts/check-js-syntax.js              491 files clean
node scripts/check-inline-html-scripts.js    0 inline scripts / 227 files
node scripts/check-site-integrity.js         242 pages, 26874 refs — 0 failures
node scripts/apply-partials.js --check       644 regions clean
node scripts/run-test-manifest.js --check    155 suites classified
node scripts/run-test-manifest.js --bucket node   72/72 passed
node tests/smoke.test.js                     3591 passed, 0 failed
node tests/marketing-polish-contract.test.js 53 passed
node scripts/crm-audit.js                    0 error (1 pre-existing warn in customer.html)
```

> Worktree note: `tests/smoke.test.js` first died with `MODULE_NOT_FOUND` —
> this worktree had no `functions/node_modules`. Fixed with a **junction** to
> the main checkout's copy rather than `npm install`, which would have caused
> the lockfile drift CLAUDE.md warns about.

## Update, same day — the boot-cost fast path, and a peer overlap that wasn't

A parallel session (branch `claude/silly-chaum-05501e`, "cut customer.html's
boot weight") sent a heads-up claiming two overlaps with this PR and urging the
new scripts be moved to `ScriptLoader` on-demand loading. Checked against that
worktree's actual uncommitted diff rather than the message:

| Claimed | Found |
|---|---|
| `dashboard.html` will conflict | Its **only** hunk is at `:101` (Leaflet CSS). This PR's insertion is at `:5472`. No conflict. |
| `tests/ci-manifest.json` will conflict | That session does not touch it (it edits `tests/package.json` and adds an `e2e/*.spec.js`, which the manifest does not classify). |
| prefer a `script-loader.js` bundle entry to avoid conflict | Backwards: `script-loader.js` **is** in that session's dirty set. Editing it would *create* the conflict the message was trying to avoid. |

The premise — *"the queue only matters once an upload has failed, so paying
for it on every boot is waste"* — is wrong for `photo-queue-recovery.js`
specifically. Its entire job is the boot path: after the guaranteed bfcache
reload, drain **without** the rep navigating back to photos. Loaded "at point
of use", there is no point of use, and the photo that survived the reload
uploads nothing. That is the exact hole the module closes. So the two eager
tags stay.

The *concern* underneath — boot cost — was legitimate, and the right fix was
not lazy-loading but making the boot check nearly free. Recovery was opening
IndexedDB (and requesting persistence) on every dashboard load to discover
nothing was queued. Now:

- `NBDPhotoQueueStore.lastKnownCount()` — **synchronous**, reads only the
  localStorage counter that every add/remove already maintains.
- Recovery (and photo-engine's mirror hydration) return immediately when it
  is `0`. A `null` (never written / localStorage cleared) **must** fall
  through to a real check, or a cleared counter over a surviving IndexedDB
  would strand real photos permanently.

Proven in real Chrome with `indexedDB.open` instrumented: empty queue on boot
→ **`IDB opens = 0`**; one photo queued → counter reads `1` after a full
reload, slow path opens exactly once. The `null`-vs-`0` distinction is gated
by two assertions in `photo-queue-durability.test.js` (now 36), and that gate
was **proven able to fail**: collapsing `null` to `0` reddened exactly those
two. Total eager cost of the two files is 25,781 B uncompressed as merged
(`photo-queue-store.js` 20,225 + `photo-queue-recovery.js` 5,556, LF blob
sizes at `5a19dd92`; ~25.8 KiB on disk with CRLF), DOM-free at
load, and on the common boot the work is one `localStorage.getItem`.

## Pre-merge adversarial review — and the seven defects it found in MY code

Before merging, a 7-dimension × 3-refuter workflow (49 agents) reviewed the
diff: dimension finders over IndexedDB correctness, drain logic, boot
recovery, iOS/WebKit platform behaviour, test fidelity, repo invariants, and a
dedicated silent-failure hunt; then three *independent refuters per finding*,
each with a different lens (code-path / platform / consequence), instructed to
default to "refuted". 25 raw → 14 deduplicated → **12 confirmed, 1 contested,
1 refuted**.

It was worth doing. The confirmed findings were not nits — several were the
same class of defect this PR exists to remove, reintroduced by me one layer
down. All are fixed in the final commit.

### 1. `add()` resolved on request success, not commit — the worst one

`add()` resolved from `req.onsuccess` and attached nothing to the transaction.
In **Chromium and Firefox the storage-quota check runs at COMMIT**: the put
fires `success` with a fresh id, then the transaction aborts with
`QuotaExceededError`. Nothing observed that abort. So on a near-full device
`add()` resolved an id for a row that was never written, the rep got *"it will
upload even if you close the app"*, and the counter recorded a row that did
not exist — so the **next boot's `detectLoss()` would blame the browser for
"clearing" a photo that was never stored.** The exact silent-success failure
mode of #1416, rebuilt.

A refuter did not take this on trust: it read Chromium's
`content/browser/indexed_db/instance/transaction.cc` (`Transaction::Commit()`
→ `CheckCanUseDiskSpace` → `Abort(kQuotaError)`) *and* reproduced it in real
Chromium with the quota pinned via CDP.

Fixed: every write now awaits `transaction.oncomplete`, rejects on `onabort`
with the abort's reason, and derives the localStorage counter from a `count()`
issued **inside the same transaction**. The contract is stated at the top of
the file: *resolved means committed*.

### 2–3. Deterministic failures were queued as if retryable

`uploadPhotoToFirebase` throws **before any network call** when `leadId` is
missing or Firebase globals are absent. The Save & Next catch treated every
throw as a dead network and queued the photo: durable-success toast, then the
drain's `!item.leadId` branch deleted it as unrecoverable. Reported saved,
silently destroyed.

Fixed three ways: those two throws are tagged `retryable = false` via
`_uploadPreflightError()`; the capture flow checks it *before* attempting
anything and refuses with the real message; and the store itself rejects a
record with no `leadId`, so no caller can store one by accident.

### 4. The photo reached storage only after a ~10-minute retry budget

The queue was written **only from the catch** — i.e. only after
`uploadPhotoToFirebase` rejected. Firebase Storage retries a failed upload
until `maxUploadRetryTime`, **default 600 000 ms**, set nowhere in this repo.
So on a roof with no signal the photo sat in a local variable behind a
"SAVING..." button for ten minutes before it was durable, and a bfcache resume
in that window — the exact event this PR exists for — destroyed it.

Fixed by inverting the order: **enqueue first, then upload.** The write costs
milliseconds, so the retry budget stops mattering. The capture flow races the
upload against `SAVE_CONFIRM_MS` (10 s) purely to pick which *true* sentence
to show — "Photo N saved" if it confirmed, "held, will upload even if you
close the app" otherwise — and hands the camera back either way while the
attempt continues in the background. A new `_inFlight` claim set stops a
concurrent drain uploading a row the capture flow is already sending.

### 5. Queued rows had no owner — shared-device cross-upload

Records carried no `uid`, and the boot drain waited only for *some* user. On a
shared iPad, rep A signing out with photos held meant rep B's next boot
uploaded them **under B's uid and company**. Fixed: `add()` requires a `uid`
and refuses without one; the drain filters to the signed-in user; other reps'
rows wait in storage for their owner.

### 6. Memory-only entries were never drained

When storage refused a photo, `enqueueForRetry` fell back to
`state.uploadQueue` and told the rep it was held — but `_pendingItems`
returned `store.all()` *exclusively* whenever `available()` was true, and only
looked at the array when it was false. So every fallback photo was held under
a toast and never retried. Fixed: `_pendingItems` merges both sources.

### 7. A failed `count()` was indistinguishable from an empty queue

`count()` returned `0` on error as well as when empty. `detectLoss()` read
that as an eviction, toasted phantom loss, **and persisted the 0** — after
which the `lastKnownCount() === 0` fast path meant no later boot ever opened
the database again. A transient read error permanently stranded real photos.
Fixed: `count()` returns `null` for "unknown", `detectLoss()` treats `null` as
no-evidence, and recovery only stops on a definite `0` (`null <= 0` is `true`
in JS — that comparison was itself the bug).

Also fixed: no `onclose`/`onversionchange` handler meant a browser-closed
connection was cached forever, so `available()` stayed true while every
transaction threw and the drain saw an "empty" store (**#8**); `add()` wrote a
pre-write snapshot count that a concurrent `remove()` could make wrong
(**#12**, subsumed by the in-transaction count).

### The test suite was part of the problem

Two findings (**#9**, **#11**) were about the shim, and they were fair: it
returned a live object store forever and completed nothing, so it could not
detect the *transaction-inactive* hazard the store code explicitly re-opens a
transaction to avoid, and it modelled quota as a request-level error — which
is why the original suite was green against defect #1. It now models
transaction lifetime (auto-commit, `TransactionInactiveError` after), request
failures that abort their transaction, and `abortAtCommit` for the Chromium
quota shape. **#10** noted the durable-toast assertion was source-shape only;
`enqueueForRetry` is now driven behaviourally against stores that succeed,
that are unavailable, and that refuse.

Suites: `photo-queue-durability` 29 → **56**, `photo-offline-queue` 22 → **51**.

### Six new gates, each proven able to fail

Not trusted on a green run. Each regression was applied, the named assertions
watched go red, and the file restored from git:

| Regression | Reddens |
|---|---|
| `add()` resolves on request success | commit-quota assertions (2) |
| `count()` collapses a failed read to 0 | null/eviction assertions (3) |
| store accepts a record with no owner | uid refusal |
| drain ignores ownership | cross-account upload |
| drain reads storage OR memory | memory-only entry never drained |
| drain ignores in-flight claims | double upload with capture |

### Verified again in real Chromium

Reload: 2 rows, every field, blob bytes at both ends, ordering, and the
in-transaction counter all intact. Validation: `uid`/`leadId`/`blob` refusals
all return `bad-item` and store nothing. Fill test: **26 rows committed
(78 MB), then our own 80 MB cap fires with `queue-full` before the browser's
quota, and `count()` equals exactly the number of resolved `add()` calls** —
no phantom saves.

### The one contested and one refuted finding

*Contested (1 of 3 refuters):* `all()` rebuilds every Blob on each drain, so a
near-full queue is memory-heavy. Real but not a correctness bug; a
`byteLength` index would fix it. **Left undone and recorded here** rather than
silently dropped.

*Refuted:* "a permanently failing head item blocks the queue forever" — the
`!blob || !item.leadId` branch drops undecodable items, and with #2/#3 fixed
no deterministic failure can be enqueued in the first place.

### Correction — the eager-cost figure, and how I got it wrong twice

The "~18 KB" above was originally quoted from commit `87713ea0`, the FIRST of
this PR's four commits. Two later commits grew both files (the boot fast path,
then the review fixes), so the merged cost is **25,781 B**, not 18 KB.

Worse, I used those stale numbers to tell the boot-weight session that *their*
figures (14,425 + 5,252) were out of date. They were not: those were exactly
right for `e7f5b666`, the tip when they measured. Mine were from an earlier
commit still, presented as "as merged". The direction of my correction was
right — the review pass really did change both files — but the replacement
numbers were older than the ones I was correcting.

The lesson is narrow and worth keeping: **a size taken from the working tree
mid-PR is not the size that ships.** Measure a merged artefact from the merge
commit's blob (`git cat-file -s <sha>:<path>`), never from a `wc -c` taken
earlier in the session. Blob sizes are LF; the working copy is CRLF here and
runs ~1 byte per line larger, so say which you mean.

## Left undone, deliberately

- **`offline-manager.js` is still dead code** — still zero callers, now with a
  written explanation of why photos did not adopt it. Deciding between deleting
  it and mounting it for Firestore writes is its own lane; this session only
  established that it should not be bent into a photo queue.
- **`sw.js`'s dead write-queue path** (`:152` short-circuit, `queueOfflineWrite`,
  the unregistered `SYNC_TAG`) is untouched. Confirmed dead, documented above.
  Reviving it would give true background upload *after the tab is closed*, which
  this change does not provide — this queue drains on next open, not in the
  background. That is a real remaining limitation and the honest next step.
- **`customer.html` does not load PhotoEngine**, so this covers the dashboard
  capture flow only.
- **`all()` deserialises every queued blob on each read** (the contested
  finding above). A `byteLength` index plus a metadata-only `list()` would let
  the cap check and the mirror avoid materialising bytes. Not a correctness
  bug; worth doing if the queue is ever routinely deep.
- **The other two `uploadPhotoToFirebase` callers** (the file-picker paths at
  ~992 and the public `uploadFromFile`) still upload without queueing. They
  are desk workflows, not the roof, and they never queued before this PR —
  but the same enqueue-first treatment would help them on a bad connection.
