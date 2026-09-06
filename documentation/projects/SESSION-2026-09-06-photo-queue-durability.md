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

> ⚠️ **The sentence immediately above was WRONG, and it was the load-bearing
> justification for the whole mechanism.** As shipped in this PR, `detectLoss()`
> could not see the eviction it names: WebKit's 7-day purge clears localStorage
> and IndexedDB *together*, so the counter died with the photos and there was
> nothing left to compare. A second defect compounded it — the app's own
> `purgeAccountStorage()` deleted the counter on every logout. Both are fixed on
> `main` (#1422 moved the witness to the server, #1426 added `seedLastKnown()`),
> and both are written up in full at the bottom of this note. Corrected in place
> here so a reader meeting this claim first is not misled by it.

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
two. Total eager cost of the two files was 25,781 B uncompressed as #1418
merged (`photo-queue-store.js` 20,225 + `photo-queue-recovery.js` 5,556, LF
blob sizes at `5a19dd92`; ~25.8 KiB on disk with CRLF), DOM-free at
load, and on the common boot the work is one `localStorage.getItem`.
**Superseded** — the server-witness follow-up below grew both files; the
current figure is in that section. Pin any future quote to a named commit,
which is the lesson of the correction two sections down.

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

---

## Update, 2026-09-06 (later, same PR) — the eviction detector could not see the eviction

**Correcting this note.** Above, under *Gates run*, it records
`navigator.storage.persist()` returning **`false`** in desktop Chrome and then
says:

> `detectLoss()` exists precisely for the case where it is refused and the
> browser later clears the store: the rep is told photos were lost rather than
> discovering it weeks later.

That was the justification for the whole mechanism, and it was **wrong for the
eviction it names**. A post-merge review of this PR found it.

`detectLoss()` infers loss by finding its localStorage counter alive next to an
empty object store. WebKit's 7-day ITP purge — and Safari's *Clear History and
Website Data* — delete **every script-writable store the origin owns in one
operation**: localStorage and IndexedDB together. So in the exact scenario the
comments kept naming, the counter dies with the photos, `detectLoss()` has
nothing left to compare, and it returns `0`. The rep was told nothing at all.

The durability suite stayed green because it only ever simulated the *partial*
case — it cleared the IDB table and left `disk.localStorage` intact. A test
that models half the failure is how a claim like the one quoted above survives.

Two consequences worth keeping:

- **No client-side detector is possible.** Nothing a page can write survives a
  full site-data clear, so this is not a bug to fix inside
  `photo-queue-store.js`. Its `detectLoss()` now says so in a comment and reads
  the counter through the null-aware `lastKnownCount()` (the duplicate
  0-defaulting `_readLastKnown()` is gone, so "counter absent" can no longer be
  silently read as "queue was empty"). Its return value is unchanged: a `0`
  from it means *"no loss this device can still prove"*, never *"no loss"*.
- **The witness has to live off the device.** `photo-queue-recovery.js` now
  mirrors the pending count to `userSettings/{uid}` — a doc the CRM already
  keeps and that `firestore.rules` already makes owner read/write, so **no
  rules change and no new collection**. It writes before attempting a drain
  and again after, and only from a device that still has its own counter. When
  it boots to find the counter *gone*, it asks the server whether photos were
  owed. That branch is reached once per device install, so a normal boot still
  costs one `localStorage.getItem` and no network.

> ⚠️ **"Once per device install" was not true when written.** A rep who had
> never queued a photo had no counter to write and nothing seeded one, so the
> empty-and-unknown branch re-read the marker on *every* dashboard load — for
> the majority of reps. #1426 made the claim true by seeding a baseline (see the
> 2026-09-06 update at the bottom). Left in place with this marker rather than
> silently edited, because the claim was asserted in a shipped PR body and code
> comment as well as here.

**The copy is deliberately true in two readings.** From a wiped device, "not on
this device" is literal. From the rep's *second* phone signing in for the first
time — indistinguishable from a wipe, because both states are "empty store, no
counter" — the photos really are still on the first phone, and the same
sentence sends them to the right place:

> *N photos taken offline never finished uploading and are not on this device.
> Open the app on the phone you shot them with, or reshoot them.*

That ambiguity is also why the knows-nothing branch **writes nothing back**: a
`0` from the second phone would erase the record of photos still held on the
first.

### Still not covered — say it plainly

The marker is only as fresh as the last boot that had **auth and a network**.
A rep who queues photos on a roof, never reopens the app with signal, and comes
back after the 7-day purge gets no warning, because nothing ever reached the
server to warn from. Closing that needs the loss not to happen — requesting
persistence at the first enqueue rather than on a later boot, and warning while
the photos still *exist* rather than after they are gone. Both are open.
*(Both closed in #1430 — see the last section.)*

### Gates

- `tests/photo-queue-loss-witness.test.js` — **new**, 24 assertions. Drives the
  real `photo-queue-recovery.js` in a `vm` sandbox against a fake store and a
  fake Firestore. Proven able to fail three ways: removing the full-wipe branch
  reddens 7 (including *"a full site-data wipe IS reported to the rep"*),
  removing the pre-drain marker write reddens 2, and letting the knows-nothing
  device write `0` reddens the clobber-protection assertion.
- `tests/photo-queue-durability.test.js` — 56 → 59. The new block pins the
  platform limit itself: after a full wipe `lastKnownCount()` is `null`,
  `detectLoss()` returns `0`, and that `0` is documented in the assertion text
  as *unprovable here*, not *nothing was lost*.
- `node scripts/run-test-manifest.js --bucket node` 73/73 ·
  `node tests/smoke.test.js` 3591/0 · `check-js-syntax` 491 files ·
  `check-inline-html-scripts` 0 across 227 · `check-vault-index` clean.

### Three defects in that fix, found by reviewing it the same way

A design workflow run against this same defect returned facts that indicted my
own first version. All three were verified in the source before acting, and all
three are fixed in the second commit.

1. **The marker was filed under the wrong person.** `writeMarker()` took
   `store.count()`, which is unfiltered by design — the drain gate only asks
   *"is there anything here at all"*. But the drain itself filters by uid
   (`photo-engine.js:1495`), so on a shared device a rep signing in after
   another rep left rows behind had that backlog written to **their**
   `userSettings` doc, where it would sit forever and eventually accuse them of
   losing photos they never took. The store gained `pendingForUid(uid)` —
   counted off the raw records, so no Blob is built to answer a number — and
   recovery uses it for every marker write. `count()` is unchanged and still
   correct for the gate it serves.
2. **The warning was delivered by something that vanishes.**
   `window.showToast` removes itself after 2600 ms
   (`dashboard-ui-prefs-boot.js:44`) — on a *boot*, before a rep on a roof has
   looked at the phone. `offline-manager.js:123` had already made this call for
   the strictly lower-stakes JSON queue, with the reason in a comment: *"a 3s
   toast vanishes before a contractor in the field ever notices"*. Photos got
   the weaker surface. Both loss messages now go to a dismissable sticky
   banner, falling back to the toast only when there is no DOM to hang it on.
3. **The "already told you" flag was erased by an ordinary sign-out.**
   `nbd-auth.js:727` `purgeAccountStorage()` drops every `nbd_`-prefixed
   localStorage key outside its KEEP set on **every** logout and account
   switch — which includes `nbd_photo_queue_last_known_size` and both keys this
   change added. A local acknowledgement therefore could not survive a sign-out,
   and the rep would be accused a second time. The acknowledgement moved to the
   server as `photoQueueLossAckAt`; the knows-nothing device writes **only**
   that field, never the pending count.

Worth recording separately, because it is a live hole nobody has closed: that
same purge deletes `nbd_photo_queue_last_known_size` on every logout while the
IndexedDB rows survive, so after any sign-out the store's own partial-eviction
detector is blind until the next `add()` or `remove()` re-seeds the counter.
Re-seeding it on boot is a small change and is **not** in this PR.
*(Closed in #1426 — see the next section.)*

### Eager cost, restated

This grew `photo-queue-recovery.js`, so the figure corrected two sections above
is now stale in turn — restating it rather than leaving the same trap:
**39,145 B** uncompressed (`photo-queue-store.js` 22,449 +
`photo-queue-recovery.js` 16,696; LF blob sizes at `3f9c0d15`, ~38.2 KiB on
disk with CRLF). Both files are still DOM-free at load, and the common boot is
still one `localStorage.getItem` and no network — the server read happens only
on the once-per-device branch where the counter is missing.

## Update, 2026-09-06 (later still, #1426) — we were deleting the counter ourselves

Closing the hole flagged two sections above, plus a false claim I made about it.

`nbd-auth.js:727` `purgeAccountStorage()` drops every `nbd_`-prefixed
localStorage key outside its KEEP set on **every** logout and account switch,
while the IndexedDB rows sit untouched. Nothing re-created the counter, so an
ordinary sign-out left `detectLoss()` with no baseline and **no way back** —
blind until the next `add()`/`remove()` happened to rewrite it. A rep who signs
out on Friday and is evicted on Monday was told nothing.

**And the same gap made the sentence directly above this section wrong.** The
server read was *not* once per device: a rep who has never queued a photo has
no counter to write, and nothing in the empty-and-unknown branch wrote one — so
every dashboard load re-opened IndexedDB, waited for auth and re-read the
marker. Forever, for the majority of reps. I asserted the opposite in the code
comment, the #1422 PR body and here. It is now true because this change makes
it true, not because it was.

Both are one mechanism: `seedLastKnown(n)` on the store, which can only ever
**establish** a baseline and refuses to overwrite one — so a re-seed can never
mask a loss the counter already had the evidence for. Recovery calls it in two
places: with the real row count when rows exist and no baseline does, and with
`0` after the server has actually **answered**. That second guard matters — the
marker read now distinguishes "consulted, nothing owed" (including a doc that
does not exist, which is every new device) from "could not reach the server".
Seeding after an unreachable server would send every later boot down the fast
path and the wipe would never be reported at all.

`nbd-auth.js` is untouched. Adding the key to its KEEP set would fix one cause;
re-seeding fixes the class, including `?reset` and a hand-cleared key, without
editing a security-sensitive purge list.

### Gates

- `photo-queue-durability.test.js` 64 → 74, including the sign-out hole end to
  end against the real store: queue two, purge localStorage, re-seed from the
  surviving rows, evict — `detectLoss()` reports 2. Paired with a **control**
  that runs the identical sequence *without* the re-seed and asserts the
  silence, so the first assertion cannot pass by accident.
- `photo-queue-loss-witness.test.js` 32 → 40, proven able to fail three ways:
  dropping the rows re-seed reddens 1, seeding regardless of the server's
  answer reddens 1, and treating a missing marker doc as a failed read
  reddens 1.
- `run-test-manifest --bucket node` 75/75 · `smoke` 3604/0 ·
  `check-js-syntax` 493 · `check-inline-html-scripts` 0/227.

## Post-mortem — why the adversarial review missed both, and what changes

Two defects shipped in this PR and were found by others afterwards (#1422,
#1426). Both went past a 49-agent adversarial review that had a dedicated
`ios-safari` dimension, a dedicated `silent-failure` dimension, and three
independent refuters per finding. Recording why, because the review was the
expensive part and it should have earned its cost here.

**Both misses are one blind spot, in two directions.** The review's
`invariants` dimension checked *registration*: does the new global trip
`crm-audit.js`'s allowlist, are the script tags `defer`, is the suite in
`ci-manifest.json`. It never asked the mirror question — **what destroys what
I store?**

- Platform direction (#1422): WebKit's ITP purge and "Clear History and
  Website Data" delete every script-writable store an origin owns in ONE
  operation. The review confirmed the eviction exists and that `persist()`
  can be refused; it never asked what else the purge takes with it.
- Repo direction (#1426): `nbd-auth.js:740` drops every localStorage key
  matching `/^(nbd[_-]|nav-)/` outside its `KEEP` set, on every logout. The
  counter was named `nbd_photo_queue_last_known_size` in this PR. **One grep
  at the moment the key was named would have found it.** No platform
  expertise required.

**The fixture taught the reviewers a false model.** The eviction test cleared
the IndexedDB table and left `disk.localStorage` intact. Every agent that read
it absorbed "eviction = IDB only". A fixture does not merely fail to catch a
bug — it *asserts* a model of the world to everyone who reads it, and this one
asserted something untrue. That is why #1422 was invisible: the suite was
green, and green against a milder hazard reads exactly like green.

**The clue was in my own prose.** This note said `detectLoss()` "exists
precisely for the case where [persist] is refused and the browser later clears
the store". Taking that sentence literally and checking whether the code could
deliver it is exactly how #1422 was found. The review checked code against
code; it never checked code against the claims made *about* it.

### What this changes for the next review of this kind

1. Add a **destruction sweep** as a first-class dimension: for every key,
   store, or file a change writes, enumerate everything that can delete it —
   platform eviction, the app's own logout/purge paths, service-worker cache
   clears, another tab — and confirm a gate covers each.
2. Treat **every fixture as a claim about reality** and review it as such. For
   each simulated failure, ask "is this milder than what really happens?"
   before trusting any green run built on it.
3. Feed the **prose** into the review as a finder input, not just the code. A
   sentence of the form "this handles X" is a testable assertion.

These are folded into the follow-up hunt this session ran; its findings, if
any, are recorded separately.

## Update, 2026-09-06 (#1430) — stop mourning the loss, prevent it

Closing the two gaps this note has now listed as open twice. Everything before
this point is detection: it tells the rep about a queue the browser has already
destroyed, and they can do nothing but reshoot. These two are the first parts of
the feature that act *before* the photos are gone.

### 1. The eviction exemption was requested after the window it covers opened

`requestPersistence()` had exactly one caller — `photo-queue-recovery.js`,
behind the early return that fires whenever the counter says the queue is
empty. So on a settled device **nobody ever asked**, and the first photo of a
job was queued into a non-persisted origin and stayed there until the next
dashboard load. The one thing that actually prevents WebKit's 7-day purge was
being requested strictly after the risk began.

It now runs from `add()`, at the moment the data becomes worth something. It is
deliberately **not awaited**: #1418 inverted this flow to enqueue-first
precisely so the write costs milliseconds, and blocking it on a permission
round-trip would hand that straight back. It is memoised per page, because
otherwise a 40-photo roof set is 40 permission round-trips.

A refusal stays non-fatal, and the toast copy is unchanged on purpose:
*"even if you close the app"* is true with or without the grant — IndexedDB
survives closing the app either way. What the grant buys is exemption from the
7-day purge, which is a longer-horizon claim the toast never made. Weakening
that sentence on a refusal would have been a false downgrade.

### 2. Nothing warned while the photos still existed

The queue was invisible from capture until it uploaded or died —
`queuedPhotoCount` has no consumers anywhere in `docs/`. So the rep's first
signal was always an autopsy.

`pendingStats(uid)` now returns `{ count, oldestAt }` from the same single scan
that already produced the count (no second read), and recovery warns on the
sticky banner when the oldest photo has been waiting **two days or more**:

> *N photos have been waiting 3 days to upload. Connect to Wi-Fi and keep this
> app open until they finish.*

Two days is early enough to leave room to act and late enough that a rep out of
signal for an afternoon is not nagged. The warning fires **offline too** — that
is the state which produces a stale queue in the first place — and it does not
depend on the lazy `photos` bundle loading. A row with no usable timestamp
reads as **old**, never as new: an unstamped row is unknown age, and guessing
young on unknown is how a stale queue stays quiet.

When a loss banner is already up the stale message is dropped rather than
stacking two fixed banners. That ordering is deliberate — "photos are gone"
outranks "photos are late" — and the two can only co-occur after a partial
eviction.

### What is left

The narrow case genuinely remains: a rep who queues on a roof, never reopens
the app with signal at all, and returns after the purge. Nothing reached the
server to warn from and no boot happened to warn on. It is now a smaller hole
than it was — the persistence grant is requested at the first photo rather than
never — but it is not zero, and no client-side mechanism can make it zero.

### Gates

- `photo-queue-durability.test.js` 74 → 86: persistence is requested by `add()`
  itself (asserted against a fresh page that has not asked), memoised to one
  ask for three photos, non-fatal when refused; `pendingStats` reports the
  oldest of the signed-in rep's rows and ignores another rep's older photo.
- `photo-queue-loss-witness.test.js` 40 → 53: the stale warning fires with the
  right count and age, stays quiet at a few hours old, fires offline, survives
  a failed drain and a missing photos bundle, and goes silent once a drain
  clears the queue.
- Proven able to fail four ways: dropping the `add()` request reddens 2,
  dropping the memoisation reddens 1, dropping the offline warning reddens 1,
  and removing every `warnIfStale` call reddens 8.
- One of those probes caught a **false green in my own new test**: the legacy
  unstamped-row case asserted `oldestAt === 1`, but the `photo()` helper
  defaults to `timestamp: 1`, so the assertion passed under both the correct
  and the broken behaviour. Restamped the real row to `Date.now()` so the two
  are distinguishable, and only then did the regression redden it.
- `run-test-manifest --bucket node` 75/75 · `smoke` 3604/0 ·
  `check-js-syntax` 493 · `check-inline-html-scripts` 0/227.
## Update, 2026-09-06 (later still) — the hunt for more of the #1422 class

The post-mortem above named three changes for the next review of this kind: a
**destruction sweep**, treating **every fixture as a claim about reality**, and
feeding the **prose** in as a finder input. Those were then run as an actual
hunt (6 finders × 3 refuters) over the merged feature. It returned **4
confirmed, all unanimous 3/3, all genuine class matches** — so the three
changes were not theoretical. Three are fixed here; the fourth is split out.

### 1. A false "reshoot the roof" accusation — `photo-queue-recovery.js`

`writeMarker()` was reachable only from `recover()`. Verified by grep:
`photo-engine.js` never touched the marker. But the two drains that do most of
the real work — the `online` listener and the post-capture flush — clear the
**local** counter via `store.remove()` while leaving the **server** marker
frozen at the old number. Harmless until `purgeAccountStorage()` deletes the
counter on sign-out; the sign-in after that reads the stale marker, finds no
local evidence, and paints the sticky red banner telling the rep to redrive a
job and reshoot a roof **whose photos are already in the customer's gallery**.
No wipe needed — an ordinary logout is enough.

Fixed at both ends: `window.NBDPhotoQueueRecovery.syncMarker()` is exported and
called from `flushUploadQueue()` after any successful drain (feature-detected,
because photo-engine can load where recovery is absent, and a stale SW cache
can pair a new engine with an old recovery module); and the `known === 0` early
return now reconciles a mirror key that still claims photos are owed.

### 2. One failed `indexedDB.open()` latched the store off for the page's life

`_openPromise` is memoised so concurrent callers share one attempt — but a
**failed** attempt stayed memoised, and `_available` was never reset (the only
occurrence in the file was its declaration). One transient open failure meant
`available()` false forever: photos already committed became invisible, and new
ones fell into the memory queue the next resume-reload destroys. iOS relaunching
a PWA it killed under memory pressure produces exactly this — the first open
errors while WebKit's storage process is still coming back, and the next one
would have succeeded. `_failOpen()` now drops the memo so the next call retries.

### 3. Nothing gated the wiring — and that one was mine twice over

The entire feature reaches the running app through **two `<script>` tags**, and
no test asserted they exist. All three suites read the modules off disk and run
them in a `vm`. A `dashboard.html` merge could drop them — plausible, since
another session had actively argued to move these exact tags — and every suite
would stay green while reps kept being told *"it will upload even if you close
the app"* by a feature that was not loaded.

This is the destruction-sweep blind spot a **third** time: modules gated, their
attachment to the app not. `photo-queue-durability.test.js` now asserts both
tags, `defer`, their order, and that neither became inline (CSP).

### Split out: uploads are not atomic

`uploadPhotoToFirebase` commits the ~1.5 MB Storage object and then does four
more failable things, with no idempotency key. A thumbnail timeout on flaky LTE
— the *ordinary* case — means every retry uploads another full-size orphan that
nothing reaps, and a reload after `setDoc` can leave a visible duplicate. Fixing
that is an idempotency-key change to the upload path everything else depends on,
so it gets its own PR rather than riding along here.

### The break test found two weak assertions of my own

Worth recording, because it is the same failure this whole thread is about.
Proving the new gates could fail showed that two assertions I had just written
passed under the regression:

- the "photo committed before a transient open failure" case set `failOpen`
  on a store that had **already opened successfully**, so `_open()` returned
  the cached `_db` and never exercised the latch at all. Rewritten to model the
  real shape — a fresh page instance whose *first* open fails.
- the sign-out boot passed a fresh `localStorage` object but a store closure
  still reading the **old** one, so it never looked purged. Rewritten so the
  store reads whatever object that boot actually got.

A third assertion threw out of the suite under regression instead of reddening,
hiding every block below it; it now returns a reason rather than throwing.

**Gates:** durability 74 → 85, offline-queue 51 → 54, loss-witness 40 → 43; all
four regressions proven to redden the named assertions. `node` bucket 75/75,
smoke 3607/0, `crm-audit` 0 errors, site-integrity clean.

## Update, 2026-09-06 (final) — uploads are idempotent

The last open item from the hunt. `uploadPhotoToFirebase` commits the ~1.5MB
Storage object, then does four more failable things (thumbnail generate +
upload, two `getDownloadURL`, `setDoc`), and nothing leaves the queue until the
last one resolves. Both the Storage filenames and the Firestore doc id were
minted **inside** the function — `Date.now()` and `generateId()` — so every
retry wrote a new path under a new doc id. On flaky LTE, where the big PUT gets
through and the thumbnail times out, that is the ordinary case: an unreaped
full-size orphan per attempt, and a visible duplicate if a reload landed after
`setDoc`.

The photo's identity is now pinned at capture and threaded through: a pure
`_uploadIdentity(uid, leadId, opts)` derives
`{uploadId, capturedAt, preset, photoId, photoPath, thumbPath}`; the capture
flow generates it once and passes it to both `enqueueForRetry` and the first
attempt; the store persists `uploadId` + `preset` on the row; the drain passes
them back. A retry overwrites the same two objects and writes the same document.

`capturedAt` and `preset` are pinned for the same reason plus a second one: a
photo queued Monday and drained Wednesday was being stamped Wednesday, at
whatever quality preset the rep had selected by then.

Rows queued before the field existed get `_legacyUploadId()` —
`q_<uid>_<rowid>_<timestamp>`. It is uid-scoped deliberately: a bare
autoIncrement row id would collide between two reps' first queued photo, and
this value becomes a Firestore document id.

### The review caught a regression the fix itself introduced

A stable doc id means a retry now lands on the **same** document — and the
write was still an unmerged `setDoc` built from capture-time data. Where the
old code left a duplicate, the new code would **reset the surviving document to
its capture-time state**, discarding everything written since the first
successful upload: the rep's own edits to tags/phase/description via
`updatePhotoTags`, `reportSections`, and — depending on ordering against the
Storage finalize trigger — `urls`/`variantsGeneratedAt`.

`{ merge: true }` would not have fixed it: `photoData` carries capture-time
tags/phase/description plus `reportSections: []`, so a merged write still
overwrites rep edits and blanks the sections. So the write is now create-once,
and a later attempt repairs only what a re-upload can legitimately change (the
download URLs, whose tokens are re-minted by the overwrite). When the existence
read itself fails, it repairs first and creates only if the document really is
absent — an unknown state must never clobber rep edits. `_autoTagPhotoBackground`
now fires on create only, so a retry cannot re-spend the per-lead AI budget on a
photo that is already tagged.

### And a test hole, for the third time this session

The first version of these idempotency tests passed while the real code minted
a fresh id per attempt, because the harness **stubs the uploader** — the
assertions were checking what the drain *passed*, not what
`uploadPhotoToFirebase` *used*. Extracting the pure `_uploadIdentity` and
running it for real fixed half of it. The review then proved the other half
empirically: inline the path construction back into the caller and all 70
assertions stayed green, because the derivation tests run the pure function in
isolation and the drain tests stub the uploader. **Nothing watched the seam.**

There is now a `wiring:` block that does: the caller must call
`_uploadIdentity(uid, leadId, opts)`, must not contain `generateId()`, must not
build a `photos/…` path inline, must not re-read the clock, must pass the
derived paths to both `ref()` calls, must use the derived doc id, must not
blind-`setDoc`, and must gate auto-tag on create. Proven by replaying the
review's own mutation: inlining the paths back now reddens three assertions.

**Gates:** offline-queue 54 → **79**, durability 97 → **100**, loss-witness 56.
Eight regressions proven to redden their named assertions across the two break
harnesses. `node` 75/75, smoke 3614/0, `crm-audit` 0 errors.

### The through-line of this whole session

Three separate defects, all the same shape: **a test that models a milder world
than the one the code runs in.** #1422 (the fixture cleared IndexedDB but left
localStorage, so a full wipe was invisible), the hunt's own weak assertions (a
store that had already opened successfully could not exercise the open latch),
and this one (a stubbed uploader cannot see what the real uploader does). Each
was found only by *breaking the code and checking which named assertions went
red* — not by watching a suite go green, and not even by watching it go red.
