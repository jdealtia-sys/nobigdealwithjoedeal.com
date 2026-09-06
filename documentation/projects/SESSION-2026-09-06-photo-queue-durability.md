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
two. Total eager cost of the two files is ~18 KB uncompressed, DOM-free at
load, and on the common boot the work is one `localStorage.getItem`.

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
