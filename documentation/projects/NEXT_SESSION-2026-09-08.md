# NEXT SESSION — 2026-09-08

Prior session: 2026-09-06, Instant Roofer + public-funnel measurement + Turnstile.
Session note: [SESSION-2026-09-06-instantroofer-adapter](SESSION-2026-09-06-instantroofer-adapter.md) ·
runbooks: [INSTANTROOFER-SETUP](../runbooks/INSTANTROOFER-SETUP.md), [TURNSTILE-SETUP](../runbooks/TURNSTILE-SETUP.md)

Five PRs merged: **#1420** (Instant Roofer adapter), **#1424** (the public
funnel measures the roof), **#1425** (Turnstile wired), **#1429** (this
handoff), **#1434** (bill the $75 pass-through on AI measures too).

**#1434 landed after this handoff was first written and amends #1424's
behaviour.** Every measurement is now `passThruEligible` — AI measures, 90-day
reuse copies and web-lead auto-measures included. The original exclusion was
mine, on the reasoning that a $3 internal cost with no deliverable should not
carry a $75 line; Jo's call is that the measurement is work performed either
way. What survived is the wording: a `passThruHasDocument` flag makes the quote
line read "Aerial measurement report" only when a document actually exists
(HOVER/EagleView PDF, human report) and "Aerial roof measurement" otherwise, so
no invoice claims a report that could never be produced. **Do not merge those
two strings** — the wording and its reasoning comment are both pinned by
`tests/instantroofer-measurement.test.js`. Verified deployed: run 34054579976
succeeded and `requestMeasurement`'s revision updated 19:47 UTC, after the
19:20 merge.

> **A second lane ran in parallel the same day** and is not covered above: the
> offline photo queue, #1418 → #1437 plus #1435 (eight PRs). It is deployed;
> its state, its open items and its traps are in **§5**, and the full write-up
> is [SESSION-2026-09-06-photo-queue-durability](SESSION-2026-09-06-photo-queue-durability.md).

---

## §0 — Jo's queue

1. **Nothing, until Sunday.** Two scheduled tasks are already booked: a day-1
   sanity check (2026-09-07 14:00) and the **7-day Turnstile token-rate report
   (2026-09-13 14:00)**, which is the go/no-go on setting `TURNSTILE_SECRET`.
   Scheduled tasks only run while the app is open; if it is closed they fire on
   next launch.
2. **Try the thing.** Open any CRM lead with an address → V2 builder → 📐
   Auto-measure. It works now for the first time since April. 9 free AI
   measurements remain, then $3 each.
3. **Optional:** check the Instant Roofer Billing page after the first 404
   ("roof not found") or 422 ("too large or irregular") — nobody knows yet
   whether those are billed, and the runbook has a hole where that fact goes.

## §1 — What is live

| Thing | State |
|---|---|
| Instant Roofer adapter, rep-facing | **LIVE, verified on the deployed revisions** — `requestMeasurement` and `measurementWebhook` carry `INSTANTROOFER_API_KEY` / `INSTANTROOFER_WEBHOOK_SECRET` |
| Human-report webhook | Configured in their dashboard (PDF format, 10 payload fields, bearer token); secret set and verified 43 chars |
| Automated web-lead measurement | **LIVE and verified** — deploy 34049215929 succeeded and `measureNewWebLead` carries `INSTANTROOFER_API_KEY` on the deployed revision |
| Turnstile site key | **LIVE and verified** by curl against the real URL, despite its own deploy being cancelled — see §2 |
| `TURNSTILE_SECRET` | **Deliberately NOT set.** Step 4 of 4, gated on the Sunday report |
| $75 pass-through on every measurement | **LIVE and verified deployed** (#1434) — wording varies by `passThruHasDocument` |
| Offline photo queue (durable, drains on boot) | **LIVE** — deploy `2c32fa59` succeeded |
| Idempotent photo uploads (no orphans, no duplicates) | **LIVE** — deploy `ca0dbf59` succeeded |

## §2 — Both "is it actually running?" checks came back CLEAN

Both were the same failure shape — merged code that looks fine and does
nothing — and both were verified before this handoff was written. Kept here as
the recipe, because it is the check this repo keeps needing.

**(a) ~~`measureNewWebLead` must carry `INSTANTROOFER_API_KEY`.~~ CONFIRMED.**
Deploy 34049215929 completed successfully and the deployed revision carries the
key. `publicRoofMeasure` shows no secrets, which is **correct** — it is
read-only and declares none by design.

```bash
gcloud functions describe measureNewWebLead --region us-central1 \
  --project nobigdeal-pro --gen2 \
  --format="value(serviceConfig.secretEnvironmentVariables)"
```

If the key were ever absent, `hasSecret()` reads an unbound `process.env`, the
adapter returns `notConfigured`, and **every public estimate lead silently goes
unmeasured while the logs say "not configured" forever.** Fix: re-run the
deploy workflow (`scope=functions`).

**(b) ~~The Turnstile site key must actually be serving.~~ CONFIRMED LIVE** —
`curl` against the real URL returns `SITEKEY = "0x4AAAAAAEqcVVOXW3xyusXQ"`.
Worth knowing anyway: its own deploy run (34049872527) was **cancelled**
(`concurrency: firebase-deploy` + `cancel-in-progress: false` keeps exactly one
pending run, so a third merge drops the middle one) and a later deploy carried
it. "Merged" is not "served" here; re-check with that curl if in doubt.

## §2b — The live-page token probe came back EMPTY. Read this before Sunday.

After the key went live, `window.nbdTurnstileExecute()` was run on the real
`https://nobigdealwithjoedeal.com/estimate` in an automated browser. It
returned **no token** in 6.7 s. Do not panic and do not dismiss it — the
evidence points one way but is not proof:

- The console shows `[Cloudflare Turnstile] Error: 600010` — a **challenge**
  failure. It is NOT `110200` ("domain not allowed") and not a sitekey error.
- The Turnstile script loaded (the warnings come from it), the widget
  container rendered, and `__NBD_TURNSTILE_SITEKEY` read back correctly.

So the wiring and hostname config look right, and the most likely explanation
is Turnstile correctly refusing a **CDP-automated browser** — i.e. bot
detection doing its job on the probe itself. The earlier local probe got tokens
only because Cloudflare's *test* keys always pass regardless of signals; the
real key applies real detection.

**What this does NOT establish:** that a real human on a real browser gets a
token. Only live traffic answers that, which is exactly what the 7-day watch
is for. **Do not set `TURNSTILE_SECRET` on the strength of "the code looks
right"** — if the true cause were a config fault rather than bot detection,
every public lead would 403.

Small real defect noticed in the same console output, not fixed: the client
calls `turnstile.render()` (which auto-executes an invisible widget) and then
`turnstile.execute(id)` again, producing `Call to execute() on a widget that is
already executing`. Benign today — the widget still runs — but it is a
reset()-vs-execute() bug in `docs/assets/js/public-lead-submit.js` worth
tidying when someone is next in that file.

## §3 — Open follow-ups, in the order I would take them

1. **Set `TURNSTILE_SECRET`** — after Sunday's report, and only if the token
   rate justifies it. The trade is real: once set, a visitor whose browser
   blocks `challenges.cloudflare.com` gets a 403 and loses their lead. At
   ~1 lead/day a 10% false-negative rate is a customer every ten days.
   Rollback is instant (blank the secret, redeploy).
2. **Human report CSV → linear feet.** The webhook delivers a file URL only;
   the AI measure has no ridge/hip/valley/eave/rake. Jo chose to wait — their
   announced **API V3** adds those to the AI response and has already dropped
   raw LiDAR, which may make this obsolete. Watch for the migration doc before
   building it.
3. **Measurement before contact capture** (the "instant" experience Instant
   Roofer sells). Needs Turnstile *enforced* first, plus a CSP `img-src` entry
   or a re-host for the roof-outline image — `firebase.json:89` lists no
   instantroofer host, so the image is silently blocked today.
4. **Company-scoped `measurements/` rules.** Today read is uid-owner or platform
   admin, which is why the 90-day reuse copies a doc rather than pointing at it.
5. **Let reps use V2 Auto-measure.** `integrationStatus` is admin-only, so the
   gate reports "not set up" to ordinary reps. The D2D button bypasses it and
   works for everyone — the two entry points have different auth behaviour.

## §4 — Traps this session paid for

- **A squash-merged branch cannot be built on.** Committing on top of the
  already-merged branch produced a PR that would have **reverted 3,008 lines**
  of other people's work. Fix: branch fresh from `origin/main` and cherry-pick.
  The handoff commit sitting on main at the time literally warned about this.
- **`gh pr checks --watch` exits while runs are still queuing.** It reported
  "not all passed" when nothing had failed. Poll for `pending == 0 && failing
  == 0` instead.
- **`esc()` is not defined in `crm-pipeline.js`.** Using it in the kanban card
  would have thrown and blanked every card. Server-side sanitising to a
  digits-only shape is the pattern that file can actually support.
- **A green deploy is not a bound secret, and a merged file is not a served
  file.** Both were checked against the deployed revision and the live URL this
  session and both came back clean (§2) — but only because they were checked.
  Two of this session's deploys were cancelled mid-queue by concurrent merges.
- **The measurement lane had been dark since April** — all three legacy
  provider keys were the deploy's `__unset__` stub, created 2026-04-14 within
  three seconds of each other. `GOOGLE_GEOCODING_API_KEY`, `REGRID_API_TOKEN`
  and `TURNSTILE_SECRET` are the same stub. Assume nothing is configured
  without checking Secret Manager version metadata.

---

## §5 — The photo-queue lane (parallel session, 2026-09-06)

Seven PRs, all merged and deployed: **#1418** (durable queue) → **#1421** (a
figure correction) → **#1422** (the eviction detector could not see the
eviction) → **#1426** (we were deleting the counter ourselves) → **#1428**
(post-mortem) → **#1431** (three defects a hunt found) → **#1437** (idempotent
uploads) — and **#1435**, a post-merge review of #1431 that found two of its
three fixes half done. Full write-up:
[SESSION-2026-09-06-photo-queue-durability](SESSION-2026-09-06-photo-queue-durability.md).

**What a rep gets now.** A photo queued with no signal survives the iOS
bfcache reload (`dashboard-sw-bootstrap.js` reloads on every resume — that
reload is *why* the memory queue was worthless), drains on the next boot with
no navigation, and is reported honestly if the browser evicts it. A retry
overwrites the same two Storage objects and writes the same Firestore document
instead of leaving an orphan and a duplicate.

### Open, in the order I would take them

1. ~~**Storage orphans from before #1437.**~~ **MEASURED — there are none.
   Closed, nothing to do.** This was ranked first here as "the only item
   costing money today". That ranking was wrong: the mechanism was real, the
   volume was assumed and never checked. Measured 2026-09-06 against prod,
   read-only:

   - **0** objects in any bucket match the camera path's filename shape
     (`*_{quick|standard|high-res}.jpg`). Checked
     `nobigdeal-pro.firebasestorage.app`, `nobigdeal-pro.appspot.com` and
     `staging.` — the last two hold no `photos/` objects at all.
   - Joining all **446** `photos/` objects against every reference a `photos`
     doc can hold (`storagePath`, `thumbStoragePath`, and the paths decoded out
     of `url`/`thumbUrl`/`urls.*`) leaves **6 unreferenced** — 3 of which are
     d2d knock photos referenced from the *knocks* collection
     (`knock.photoUrls`/`photoPaths`), so not orphans. The remainder is 2
     legacy PNGs and 1 file literally named `sweep-test-…`.

   **The larger fact behind it: the camera capture path has never produced a
   surviving production photo.** Three independent signals agree — no Storage
   object with its filename shape; **0 of 111** photo docs carry `quality`,
   `capturedAt` or `thumbStoragePath` (written *only* by
   `uploadPhotoToFirebase`); and **0 of 111** doc ids match `generateId()`'s
   `<ts>_<rand>` shape — all 111 are 20-char Firestore auto-IDs, i.e. every
   production photo came from the customer-page/quick-upload writers instead.

   The path *is* wired and reachable (`customer-photo-hub.js:332`,
   `dashboard-actions.js:137/158/1676`), so this is "not used yet", not "dead
   code". But it means the whole #1418→#1437 queue lane is **insurance on a
   path that has not yet carried traffic**. That is worth knowing before
   spending more on it — and it is the honest reason to demote everything below
   rather than treat this lane as urgent.

   Reproduce: `gcloud storage ls -r 'gs://nobigdeal-pro.firebasestorage.app/photos/**'`
   joined against the `photos` collection over the Firestore REST API with
   `gcloud auth print-access-token`. No ADC file is needed; `gcloud`'s own
   credentials work for both.
2. **No true background upload.** The queue drains on next *open*, not after
   the tab closes. `sw.js`'s write-queue path is still dead — `:152` returns
   early on non-GET, and `SYNC_TAG 'nbd-sync-queue'` is registered by nothing
   (verified again 2026-09-06). Reviving it is the honest next step and was
   deliberately not attempted.
3. **The rep who never reopens with signal.** Queue on a roof, never open the
   app with a network, come back after WebKit's 7-day purge: nothing reached
   the server to warn from and no boot happened to warn on. Closing it means
   *prevention*, not detection. #1430 moved `requestPersistence()` into `add()`
   and added a 2-day "still waiting" banner, which shrinks the window; it does
   not close it.
4. **`offline-manager.js` is still dead** — re-verified zero callers today.
   It was deliberately NOT adopted for photos (its cap is commented for "~2KB"
   JSON writes, its flush is a Firestore REST call, and its store is shared
   with `sw.js`). Deleting it or mounting it for Firestore writes is its own
   decision; the reasons not to bend it into a photo queue are in the header of
   `photo-queue-store.js`.
5. **`all()` deserialises every queued blob on each read** (the review's one
   contested finding — real, not a correctness bug). A `byteLength` index plus
   a metadata-only `list()` would fix it. Worth doing only if queues get deep.
6. **The other two upload callers do not queue** — the file-picker path
   (~`photo-engine.js:992`) and the public `uploadFromFile`. Desk workflows,
   not the roof, and they never queued before; the same enqueue-first treatment
   would still help them on a bad connection.
7. **`customer.html` does not load PhotoEngine**, so all of this covers the
   dashboard capture flow only.

### Traps this lane paid for — the same one, three times

Every defect that shipped and had to be fixed afterwards was **a test that
modelled a milder world than the code runs in**:

- **#1422** — the eviction fixture cleared IndexedDB and left `localStorage`
  intact. WebKit's purge clears both in one operation, so the suite was green
  against a wipe it could not represent. A fixture does not merely fail to
  catch a bug; it *asserts a model of the world* to everyone who reads it.
- **The hunt's own new assertions** — one set `failOpen` on a store that had
  already opened successfully, so it never exercised the open latch it claimed
  to guard. Another handed a boot a fresh `localStorage` while its store
  closure still read the old one, so the "purged" device never looked purged.
- **#1437** — the idempotency tests stubbed the uploader, so they proved what
  the *drain passed*, not what `uploadPhotoToFirebase` *used*. A review proved
  it by mutation: inline the paths back into the caller and all 70 assertions
  stayed green.
- **#1435, the sharpest of them.** A review after #1431 merged found two of its
  three fixes covered the route their author was reasoning about and not the
  one a line away. `flushUploadQueue` gated the marker re-file on `if (sent)`,
  but an unrecoverable row is removed by `_dropItem()` *without* an upload — so
  a drain can empty the queue with `sent === 0`, walk the local counter to 0,
  and leave the server marker accusing the rep. Exactly the bug #1431 existed
  to prevent, through the one route its gate did not cover. And `_failOpen`
  cleared `_openPromise` from *inside the Promise executor*, which runs
  synchronously during construction — so the assignment put the failed promise
  straight back, and the two synchronous paths (absent `indexedDB`, a throwing
  `open()`) stayed latched off. The test only exercised `onerror`, which fires
  in a later task and therefore worked.
  **Worst part: #1431's own test asserted the bug as correct.** "a drain that
  sent nothing does not touch the marker" was written as a general rule about
  `sent === 0`, while its setup only produced the case where nothing was
  removed either. #1435 had to narrow it to "a drain that changed nothing" to
  fix the bug. *A gate that must be deleted to fix a bug is worse than no
  gate* — when writing an assertion, check that its NAME and its SETUP describe
  the same rule.

**What actually caught these:** breaking the code and checking **which named
assertion** went red. Not a green suite, and not even a red one — twice, a
regression reddened a *different* assertion than expected and the gap was the
finding. If you add a gate in this area, mutate the thing it guards and read
the failure names.

Two more, cheaper:

- **`git reset --soft origin/main` onto a moved `main`** stages other people's
  files as reverts. It bit this lane twice and a parallel session once. The
  screen that catches it, run before every commit:
  `for f in $(git diff --cached --name-only); do echo "-$(git diff --cached origin/main -- "$f" | grep -cE '^-[^-]')  $f"; done`
  — every removed line must be one you wrote.
- **`git checkout -- <file>` to undo a temporary test-break discards ALL
  uncommitted work in that file** (and silently does *nothing* for an untracked
  one). Commit a `wip:` first, or undo with the editor.
