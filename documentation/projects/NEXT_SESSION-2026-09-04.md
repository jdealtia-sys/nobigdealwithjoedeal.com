# Next session — brief as of the end of 2026-09-03

> Supersedes [NEXT_SESSION-2026-09-03](NEXT_SESSION-2026-09-03.md).
> Session record:
> [SESSION-2026-09-03-photo-reaping-and-phone-truth](SESSION-2026-09-03-photo-reaping-and-phone-truth.md).

## State of the world

- **A deleted lead's photos are reaped** (#1353). `onLeadDeleted` skipped
  `photos/` on a docblock premise that was wrong twice over — the dominant
  shape *is* leadId-keyed, and `image-pipeline.js` stamps a permanent
  `firebaseStorageDownloadTokens` on every variant it writes (446 such objects
  found in prod earlier). A hard delete used to leave the whole photo set
  publicly fetchable forever. `docs/` was also missing from the trigger's
  prefix list while the sweep script already swept it; the lockstep test now
  asserts **both** directions.
- **The installed app stopped answering its own "are you sure?"** (#1354).
  `standalone-compat.js` replaces `window.confirm` with a `return true` stub in
  home-screen mode. 31 sites across 19 files converted. The worst was not a
  delete: generating a photo report **silently emailed it to the homeowner**,
  because that confirm was an OK=email / Cancel=download choice.
- **The phone's navigation tells the truth** (#1355). `goTo()` writes `#/crm`
  with a leading slash; the bottom bar stripped only the `#` and so lit nothing
  after any navigation, Back landed on a Dashboard the user never opened, and
  the upgrade modal's billing CTA went to the pipeline.
- **Three new suites, all proven able to fail before being trusted**:
  `lead-photo-reaping` (41), `pwa-confirm-guard` (76), `route-truth` (36).
  Node bucket 45 → 47. Every one had a deliberate breakage staged and reverted
  byte-exactly — see the session note's table.
- **Branch protection on `main` is ON** as of 2026-09-03 (it had been OFF for
  the whole history before that). Seven required checks; direct pushes, force
  pushes and branch deletion are blocked. `gh pr merge --auto` now genuinely
  defers instead of merging on the spot. Full config and the three deliberate
  settings are in Jo's queue #3 — **two of them lock Jo out if "tightened"
  without reading why.** Keep polling checks yourself regardless:
  `enforce_admins` is false by design, so an admin can still push a merge
  through. Every merge still deploys immediately.

## Corrections — briefed claims that are FALSE

A 17-agent recon (each lane reconned, then handed to an adversarial verifier
told to refute it) proved fourteen briefed or reconned claims wrong. **Read
this before picking up any lane below.** Each cost a session otherwise.

1. **The invoice pipeline is not under `functions/` and does not honour a cents
   invariant.** It is `docs/pro/js/invoice-pipeline.js` — 1643 lines of float
   dollars with an inline `round2` and no cents helper. "Money math stays in
   cents" holds only for the classic/per-SQ estimate engines and at the Stripe
   boundary; the V2 line-item engine that produces invoice numbers is float too.
2. **`adjuster-board.js:55` and `ai-texting-stats.js:52` are not unbounded
   reads.** Both carry a tenant/user equality plus a clamped date range. Only a
   hard `.limit()` ceiling is missing — much smaller than briefed.
3. **The dictation lane has no provider seam to flip.** `functions/dictate.js`
   hardcodes one Deepgram helper. This is "build the seam", not "switch a
   default". (The briefed path `docs/pro/js/dictate.js` does not exist; the
   audit doc's own citation was already correct — do not "fix" it.)
4. **No API keys are exposed to the browser on the dictation path.**
   `DEEPGRAM_API_KEY` and `GROQ_API_KEY` are Secret Manager bindings read inside
   the function; all four client call sites go through `httpsCallable`.
5. **There is no `windGust` field to remove.** Zero occurrences repo-wide
   outside two docs that both record its absence.
6. **`{static: true}` does not fix the lead-modal backdrop wipe.**
   `crm-leads.js:165` installs a *second*, direct backdrop listener on the
   element that bypasses nbd-modal's static guard entirely.
7. **`openSettingsTab('billing')` is not the billing-CTA fix.** Its first line
   calls `nbdPickerOpen` (a real global from `maps.js:255`), so it always opens
   the theme picker. #1355 used `goTo('settings')` + `switchSettingsTab('billing')`.
8. **`tests/stripe-payment-link-tax.test.js` is not silently green.** It has
   eight fixtures and S2/S5/S7/S8 assert a *refusal*. The real gap is narrower:
   no fixture proves the guard PASSES on a corrected invoice. Number any new
   fixtures S9+ — S7/S8 already exist.
9. **`crm-audit.js --severity=error` gates nothing** (`totErr` counts over
   findings, not the filtered list), and `docs/pro` carries **zero** executable
   inline scripts, not five — its `node --check` spawn loop never runs.
10. **push-functions' `d2dKnocks != null` index is not missing.** A single-field
    inequality uses Firestore's automatic index, which is never declared in
    `firestore.indexes.json`. The full-collection fallback is likely dormant.
11. **Querying on `autoFollowUp` with a composite index is impossible.** It
    lives inside the `d2dKnocks` *array of maps*; no index can range-filter
    that. It needs a denormalized top-level field — far more than the "M" it
    was sized at.
12. **`OfflineManager.queueWrite` is dead code**, not a live bug — zero callers
    repo-wide. (Still a product question: the UI implies an offline queue that
    does not exist.)
13. **`tests/smoke/portal.test.js:168` and `crm.test.js:400` do assert query
    bounds** — the claim that nothing does was wrong.
14. **The audit doc's `~:78` for `fetchNoaaHail` is an insertion-point
    citation**, not drift. "Correcting" it to `:38` makes the doc worse.

## Lanes, in priority order

> **Status 2026-09-03 (close):** **every lane in this list shipped**
> (#1359–#1363, #1365). Nothing here is open. The next session's work is in
> the two blocked sections below and in §Corrections — start there, not here.
>
> **The top item is now the signed-URL cutover**, which Jo's IAM grant
> unblocked the same evening (queue #2, verified). It needs a Cloud Functions
> deploy window, so it sequences with the other deploy-gated items rather than
> going first by default.
>
> **Branch protection on `main` is now ON** (queue #3, done the same evening)
> with seven required checks, so every gate added today finally enforces
> something. Its three deliberate settings are in queue #3 — two of them would
> lock Jo out if "tightened" without reading why.

1. ~~**Lead entry stops losing data on a phone**~~ **SHIPPED #1360.** Backdrop
   dismiss now asks when anything has been typed (Esc and ✕ still close in one
   action — it guards the accident, not the intent), and the GPS latch clears
   on every completed create, on form reset, and on Quick-Add open/close.
   Three things worth carrying, all found by the adversarial pass rather than
   the brief: the dismiss-side clear covered **one path in three** until it was
   registered as an `onClose` (nbd-modal's backdrop and Esc handlers call its
   internal `close()` directly, which only runs a cleanup callback if one was
   registered at `open()` — a trap for any future modal cleanup); a late
   geolocation callback could re-arm the latch up to 12s after dismissal, so
   there is now a generation counter checked after both awaits; and
   `stopPropagation` on the backdrop silently broke the address autocomplete's
   document-level bubble listener, which now gets an explicit dismiss.
2. ~~**A ticked task that did not save says so**~~ **SHIPPED #1359.** Plus the
   bug the revert logic uncovered, which is the reusable part: the
   `data-tk-action` delegate was bound to BOTH `click` and `change`, and a
   checkbox fires both — so every tick ran its handler **twice**. Harmless
   while the handlers were idempotent fire-and-forget writes (it just doubled
   the Firestore traffic), fatal the moment one snapshots state to revert on
   failure, because the second invocation snapshots the already-flipped value
   and its revert undoes the first one's. Dispatch now routes by event type.
   **If you add any other optimistic-then-revert handler, check its delegate
   first.**
3. ~~**One owner for the kanban filters**~~ **SHIPPED #1363.**
   `docs/pro/js/lead-filter-registry.js` (`window.NBDLeadFilters`) now holds
   the active filter; both modules register a `compute()` and a paint callback
   and keep no state. `deactivate()` is a no-op unless that filter is actually
   the active one — that single guard is the whole bug — and `refresh()`
   recomputes only the active filter, so the 60s poll can no longer resurrect
   one the rep switched off.
   **The brief's framing was wrong in a way worth remembering:** it asked for
   "a registry that is the only writer" of `window._filteredLeads`. But
   `renderLeads()` (`crm-pipeline.js:72`) **already** sets that global from its
   own second argument — the filter modules were writing it *as well*, which is
   what made ownership unanswerable. The fix was removing two writers, not
   adding a better one. The registry never touches the global; it passes
   `filtered` to `renderLeads`. Pinned at the source in
   `tests/lead-filter-registry.test.js`.
   Also carried: a pre-existing smoke assertion pinned
   `classList.toggle('active', active)` **by the literal variable name**, so it
   went red on a semantically identical refactor. If you rename a state
   variable in a filter module, check `tests/smoke/dashboard.test.js` around
   the filter-badge block.
4. ~~**CSV formula injection + `data-export.js`'s first test**~~ **SHIPPED
   #1361** (36 assertions, node bucket). Two findings the brief did not have:
   there are **TWO** export paths, not one — `_csvEscape` in
   `dashboard-bootstrap.module.js` backs the Settings → Data Retention "Export
   All Leads (CSV)" button over the same `window._leads`, and fixing only
   `data-export.js` would have shipped a PR claiming a closed hole with the
   other button still live. And the fix introduced a **round-trip regression**:
   `data-import.js` never stripped the marker, so an ordinary note like
   `- called 3x` re-imported as `'- called 3x`, permanently, with CI green.
   Both fixed; the test now pins all **three** copies of the neutralizer
   (including `expenses.js`) to one character class, and pins the import strip
   as lookahead-guarded so a genuine leading apostrophe survives.
5. ~~**`crm-audit.js` into CI**~~ **SHIPPED #1365.** Both false-green paths
   were fixed before the step was added (`--json` computed the verdict below
   its own early return and always exited 0; zero matched pages exited 0), and
   the step is blocking with no `if:` / `continue-on-error` / `|| true`. It ran
   green in CI on its own PR — the step itself, not just the job around it —
   and was proven able to fail by planting a real broken `<script src>` in
   `dashboard.html`. 32 assertions in `tests/crm-audit.test.js`.
   **Two follow-ups, both deliberately excluded and both written into the
   ci.yml comment so nobody reads more coverage into it than exists:**
   - **The gate makes the CRM pages visible, not protected.** The deploy runs
     from `firebase-deploy.yml`, which has no `needs:` on `ci.yml` and whose
     own pre-flight runs only check-js-syntax / check-site-integrity /
     apply-partials. **A broken CRM page still deploys**; this step just turns
     red beside it. Adding it to that pre-flight is the real fix — after this
     has run green on main a few times, because a false positive there blocks
     the entire site.
   - **Only the 27 top-level `docs/pro/*.html` are read.** The 7 nested pages
     (`docs/pro/blog/*`, `docs/pro/daily-success/`) and all of `docs/admin/**`
     are still guarded by nothing. None is broken today (checked), so this is
     a blind spot rather than a live break — but widening discovery may
     surface findings, so it needs its own attributable red.
   One more thing worth carrying: making `--json` exit honestly created a new
   contradiction, since `findings` is display-filtered while the verdict counts
   over all findings — `--json --severity=info` exited 1 with `findings: []`.
   Closed with an unfiltered `counts` object. **If you add a display filter to
   any gate, check it cannot make a failing run serialize as clean.**
6. ~~**Finish the `confirm()` allowlist question.**~~ **CLOSED same session by
   #1357.** The root cause is gone: the `confirm` and `prompt` overrides in
   `standalone-compat.js` are deleted, because their premise — that iOS blocks
   dialogs in standalone mode — is false and appears never to have been true.
   `alert` stays (no return value, so it cannot answer for the user). Five raw
   `confirm()` sites remain and all five are still legitimate. **Do not
   reintroduce the overrides**; `tests/pwa-confirm-guard.test.js` now asserts
   they stay dead, and the full argument sits next to the code. Details in the
   session note's §#1354 UPDATE.

## The backup alarm — live, and the deploy lesson that came with it

`backupFreshnessCron` (#1369) is **deployed, ACTIVE and verified running**:
scheduler `firebase-schedule-backupFreshnessCron-us-central1` at 06:00 ET,
ENABLED. A live trigger read the real bucket and logged
`backup_freshness.ok  ageHours 0.92  marker 2026-09-03/2026-09-03.overall_export_metadata`
— it found the real marker, computed the real age, and correctly stayed
quiet. The alarm side is covered by 36 unit assertions, proven able to fail.

**BUT THE FIRST DEPLOY SILENTLY DID NOT CREATE IT**, and this is the
carry-forward:

- The run reported 110 **successful updates** and **zero creates**. firebase
  printed `✔ Deploy complete!`. The function did not exist afterwards.
- It WAS targeted — re-running the workflow's own discovery grep locally finds
  `backupFreshnessCron` among 169 functions, so this was not a discovery gap.
- `firebase-deploy.yml`'s own comment claimed the chronic CPU-quota race hits
  updates "never a create". **That is now disproven and corrected in place.** A
  create needs a brand-new Cloud Run service rather than a revision swap, so it
  is the *most* likely thing to lose the race.
- A plain `gh run rerun --failed` created it.

**Why a create losing is worse than an update losing:** an update that loses
leaves the previous revision serving, so nothing breaks. A create that loses
leaves *nothing* — and neither the workflow summary nor a later green deploy
will tell you which function is missing.

> **After deploying a NEW function, verify it exists.**
> `gcloud functions describe <NAME> --gen2 --region=us-central1`
> A merged PR is not a deployed function. This was caught only because the
> deploy was checked rather than trusted — the same habit the alarm exists to
> institutionalise.

The durable fix is Jo's: **raise the Cloud Run CPU quota for us-central1**
(GCP console → IAM & Admin → Quotas). `firebase-deploy.yml` has named this as
the real fix since 2026-07-23 and it has been causing chronic red deploys ever
since.

## Blocked on a Cloud Functions deploy window

Sequenced separately on a quiet evening; **do not bundle any of these with a
client-only PR.**

- **Five billable AI endpoints ignore the emergency kill switch** —
  `dictate.js` (Deepgram + Anthropic), `ai-texting.js`, `voice-memo.js`,
  `voice-intelligence.js`, `handlers/photo.js`. `killswitch.js`'s own docstring
  promises "all billable AI endpoints fail closed" and only four call sites
  honour it, so pulling the switch during a spend incident stops about half the
  bleeding. The coverage *test* is cheap and can land any time — but a
  host-string scan structurally cannot see `handlers/ai-texting-preview.js`
  (it reaches Anthropic via `callClaudeForDraft` with no host string), so build
  the scan from entry points or follow transitive requires.
- **`storm-watch.js` writes the dedupe record BEFORE sending the alert.** If the
  subscriber query throws or the 300s timeout fires mid-run, the hail event is
  permanently marked handled and Jo silently never hears about the storm. A
  static ordering guard can land now; the reorder needs the deploy. Siblings:
  the cooldown stamp is fire-and-forget while `texted++` runs anyway (TCPA
  exposure on a consent list), and unlisted 452xx/410xx zips all collapse to one
  downtown point, so someone 29 miles away is told a storm "hit your zip code".
- **Unbounded / mis-bounded reads in `functions/`** — `health-digest`'s
  full-collection `api_usage_daily` read, two silent-truncation bugs,
  `admin.js`'s four cross-tenant 30-day scans, calcom's lifetime lead-book scan.
  Carry these corrections or the fixes ship broken: the documentId prefix range
  needs a high sentinel (`endAt(dayKey + '')`) or it returns **zero** rows
  and the digest reports zero tokens daily; a `processedAt` range on
  `stripe_events` silently excludes every Connect-webhook event because
  `stripe-connect.js:449` writes `receivedAt`; and `admin.js` can take the clean
  composite path for leads but needs the chunked `userId in` path for
  estimates/measurements/portal_tokens.
- **`depositAmount` half-cent write + the exact-zero fully-paid check** — a
  3-way split leaves 1 cent stuck in Outstanding forever. The paid check exists
  at `docs/pro/js/invoice-pipeline.js:877` **and** `functions/stripe.js:1643`;
  they must change together or client and webhook disagree about "paid".

## Needs a decision, a fixture, or prod access

- **Invoice footing gap — row-based invoices cannot mint a Stripe payment
  link.** Real and load-bearing: the engine snaps `grandTotal` to the nearest
  $25 while items and subtotal stay unrounded, so Σ(items)+tax misses total by
  dollars and `functions/stripe.js` refuses with HTTP 400. **The obvious fix
  does not work** — a "Contract adjustment" line hits `MIN_CENTS=100` at
  `stripe.js:1184`, and the rounding is symmetric so ~half of all deltas are
  *negative* (down to −$12.49), which Stripe rejects outright. Needs a fix
  design, plus one prod log query on `payment_link_total_mismatch`
  (`stripe.js:1247`) to size how much of Jo's traffic is row-based. Per-SQ
  reconciles exactly across 5,505 swept combinations.
- **Firestore audit: estimates with a cost split but `materialMarkupPct`
  missing or zero.** `estimate-logic-engine.js:880` turns an empty-string
  settings field into markup 0 — retail == cost. The damage is written at SAVE
  time (`estimate-v2-ui.js:2823-2837` persists `retailTotal` computed with mk),
  so `invoice-pipeline.js:301` is neither where it is caught nor where it is
  fixed. Needs prod Firestore read access.
- **Wayback historical-imagery slider** (the 🕐 History button on the drawing
  tool) has **three** independent defects, not the two briefed: invented string
  release ids, a missing CSP `img-src` grant, **and** `setZIndex(-1)` stacking
  the historical tiles underneath the opaque Google base. Fixing two of three
  still shows a blank panel. Needs the real numeric release ids from Esri's
  `waybackconfig.json` (hardcode a curated table — do not add a runtime fetch)
  and a preview channel to verify, because the hosting emulator sends no
  custom headers.
- **NCEI SWDI hail + KyFromAbove aerials** need a live response captured as a
  committed fixture first — field names, units (inches vs mm vs a size code)
  and coordinate ordering are all guesses, and `sizeInches` mis-stamps
  *immutable* `storm_proofs` docs if wrong. Non-obvious trap: registering an
  `swdi` fetcher without also adding a **keyless branch** to
  `preferredHailProvider()` makes the env var fall through to `noaa` — the
  feature looks wired and is silently dead. Shares the `firebase.json` `img-src`
  line with the Wayback fix, so sequence them.
- **NWS rain-day chip**: needs no CSP change (`api.weather.gov` is already
  granted, two shipped modules call it) — but the brief asks for a chip on
  "day cells" and `smart-calendar.js` renders **today only**. Placement is Jo's
  call: a chip per appointment row, or one tile in the 3-tile summary header.

## Jo's queue — the precise asks (newest first)

1. ~~Do you open the CRM from the home-screen icon or in Safari, and does
   native `confirm()` still fail there?~~ **WITHDRAWN — answered without him.**
   The research settled it in a way that made his answer unnecessary: WebKit
   has no standalone gate on dialogs, and every suppression path returns
   `false`, so `true` was the one value the platform cannot produce. The
   overrides are deleted (#1357). Two loose ends if anyone wants certainty
   rather than inference:
   - **No first-hand post-2023 report exists in either direction** of running
     `confirm()` in an installed iOS web app. The conclusion rests on current
     WebKit source plus a very well-structured absence, not a measurement. It
     does not need to be closed — the decision is the same in both worlds —
     but a device reading would convert "inferred" into "observed".
   - Getting one needs a **top-level** page: a Claude artifact is served in a
     sandboxed iframe, which blocks modals for an unrelated reason and reads
     as a false negative (confirmed on Jo's iOS 18.7 — `false`/`null`/
     `undefined`, which incidentally demonstrated the fail-closed direction).
     Use a Firebase preview channel with an external-JS page, per the repo's
     usual hosting-verification route. Low priority.
2. ~~**Grant `roles/iam.serviceAccountTokenCreator` on the compute SA**~~
   **DONE 2026-09-03 — Jo granted it in the console, and it is verified.**
   Not taken on trust: a grant on the wrong account looks identical to no
   grant, so all three halves were checked. `gcloud` is on PATH here and
   already authed as jonathandeal459@gmail.com, so these are one-line reads —
   **do this before believing any future console ask is done:**
   ```
   gcloud iam service-accounts get-iam-policy \
     717435841570-compute@developer.gserviceaccount.com --project=nobigdeal-pro
     → roles/iam.serviceAccountTokenCreator, member = that SAME SA
       (self-impersonation, which is correct — signing means impersonating
       yourself via the IAM Credentials API)
   gcloud functions describe renderPdf --gen2 --region=us-central1 \
     --format='value(serviceConfig.serviceAccountEmail)'
     → 717435841570-compute@developer.gserviceaccount.com  ← the granted SA
       IS the runtime identity, which is the half that is easy to get wrong
   gcloud services list --enabled --filter=config.name:iamcredentials.googleapis.com
     → enabled
   ```
   **What this unblocks, and what it does NOT.** `render-pdf.js` already
   self-heals — it tries `getSignedUrl` and falls back to a download token —
   so it starts issuing signed URLs with no redeploy. The cutover itself is
   still to do: stop `image-pipeline.js:224-243` minting a permanent token per
   variant, stop `render-pdf.js:455-462` doing it for `pdf-renders/`, then reap
   the 446 existing tokened objects. 29 client `getDownloadURL` call sites in
   16 files remain; the worst is `customer-signed-doc-upload.js:46-56`
   (a signed contract). **The reaping half already shipped as #1353 — do not
   rebuild it.**
3. ~~**Turn on branch protection for `main`**~~ **DONE 2026-09-03 — Jo asked
   for it and it is enabled and verified.** Seven required checks:
   `Smoke tests`, `Unit suites (manifest)`, `Site integrity`,
   `Node syntax check`, `Secret scan`, `Firestore rules tests`,
   `Functions parse + dep install`. Direct pushes to `main` are blocked; force
   pushes and branch deletion are off.
   **Three settings are deliberate — read this before "tightening" any of
   them, because two of the three would lock Jo out:**
   - `required_approving_review_count: 0` — this is what forces the PR flow
     without demanding an approval. **Setting it to 1 locks Jo out
     permanently:** he is the sole admin and GitHub does not let anyone
     approve their own PR.
   - `enforce_admins: false` — an escape hatch. A one-person business cannot
     afford "a required check is stuck, so nothing ships". It means an admin
     CAN still force a merge through, so treat the required checks as a strong
     speed bump rather than an absolute bar, and keep polling checks before
     merging.
   - `strict: false` — main moves several times an evening here; `strict: true`
     would force a rebase and a full CI re-run on every open PR each time.
   The 12 emulator/browser checks (the Authed E2E shards, visual regression,
   Public-surface E2E, Rendered QC, Brand-token) are deliberately NOT required
   — they are the flake-prone class, and a Playwright-install flake already
   forced a rerun on #1351. Promote one only after it has been reliably green
   for a while.
   Read the live config rather than trusting this note:
   `gh api repos/jdealtia-sys/nobigdealwithjoedeal.com/branches/main/protection`
4. ~~**Cloud Storage backup**~~ **MOSTLY DONE 2026-09-03 — and it uncovered
   something far worse than the thing it asked for.**

   **THE FIRESTORE BACKUPS HAD NEVER ONCE RUN.** Three functions
   (`dailyFirestoreBackup` 03:15, `nightlyFirestoreBackup` 04:00,
   `firestoreBackupRetention` 03:45) were ACTIVE and scheduled, and every one
   failed every night, for two independent reasons:
   - **The destination bucket never existed.** `firestore-backup.js` writes to
     `gs://${PROJECT}-firestore-backups`, and its own docstring says the
     operator must create it. Nobody had. FIXED: created
     `gs://nobigdeal-pro-firestore-backups`, **US multi-region** — the
     docstring's `-l us-central1` advice is WRONG for this project, because
     the database is `nam5` (US multi-region) and an export wants a
     location-compatible bucket.
   - **The runtime SA could not export.** It holds `roles/editor`, which
     deliberately **excludes** `datastore.databases.export` — verified against
     the role definition, not assumed. That was the `PERMISSION_DENIED` / 403.
     FIXED: granted `roles/datastore.importExportAdmin` to
     `717435841570-compute@developer.gserviceaccount.com`.

   Proven, not declared: triggered the real scheduler job and watched
   `dailyFirestoreBackup.started` with no error, then confirmed
   `2026-09-03/2026-09-03.overall_export_metadata` (the completion marker the
   function's own comment says to check for) plus `output-0…13` land in the
   bucket. 7.3 MB. **That is the first Firestore backup this project has ever
   had.** The first trigger right after the grant still 403'd — IAM
   propagation takes a couple of minutes, so re-run before diagnosing.

   **The "two Firestore backup buckets" question in the old brief was a false
   premise.** There are no two. `nobigdeal-pro.appspot.com` and
   `staging.nobigdeal-pro.appspot.com` both exist and are both **empty**;
   neither was ever a backup target. The real one is the one just created.

   **Photos** (`nobigdeal-pro.firebasestorage.app`, 583 MB): Object Versioning
   is ON and verified. Also a correction — the brief said photos were
   "unrecoverable today", and they were not: the bucket already carried a
   **7-day soft-delete policy** (a GCS default since 2024). Versioning adds
   overwrite protection, which soft delete does not cover, and removes the
   7-day cliff. Cost is about a penny a month at this size.
   No lifecycle rule was added on purpose: it would save ~$0.01/month, and any
   lifecycle rule on the bucket holding every customer photo and signed
   contract is a place where one typo is unrecoverable. Revisit if storage
   grows 100x.

   **THE OFF-PROJECT COPY IS DONE 2026-09-03, and verified by byte parity.**
   Everything used to live in one project, so every protection above defended
   against mistakes *inside* `nobigdeal-pro` and none against losing the
   project itself.

   New project **`nobigdeal-backups`** (org `jonathandeal459-org`, billing
   `01090D-87C689-0FE40E`), holding two buckets, both US multi-region with
   versioning:

   | job (daily, `86400s`, ENABLED) | source | destination |
   |---|---|---|
   | `nbd-firestore-offsite` | `gs://nobigdeal-pro-firestore-backups` | `gs://nobigdeal-offsite-firestore` |
   | `nbd-photos-offsite` | `gs://nobigdeal-pro.firebasestorage.app` | `gs://nobigdeal-offsite-photos` |

   Both have completed a REAL run, not just been scheduled — which is exactly
   the distinction that hid the broken backups all day:
   - Firestore: **94 objects source / 94 offsite**, 7,275,641 bytes both sides,
     and the `overall_export_metadata` completion marker is present in the
     copy, so it is a restorable export rather than a partial one.
   - Photos: **610,852,034 bytes both sides.**

   The Storage Transfer service agent
   (`project-760414839970@storage-transfer-service.iam.gserviceaccount.com`)
   holds only `objectViewer` + `legacyBucketReader`, and only **on the two
   source buckets** — not project-wide. It cannot write to or delete anything
   in `nobigdeal-pro`.

   **WHAT THIS STILL DOES NOT PROTECT AGAINST — be honest about it.** Both
   projects sit under the same Google account and the same billing account. It
   defends against project deletion, a bad script, and a bucket-level mistake.
   It does NOT defend against losing the Google account itself, or billing
   lapsing across the org. If that matters, the next rung is a copy under a
   different account or off Google entirely — a decision for Jo, not an
   engineering task.

   Cost: ~600 MB duplicated, so cents per month.
5. ~~**Raise the Cloud Run CPU quota for us-central1**~~ **DONE 2026-09-03,
   auto-approved.** 200,000 -> 600,000 mCPU (200 -> 600 vCPU), verified live
   with us-east1 left at 200,000 as a control. The numbers explain why this
   was never survivable: **179 Cloud Run services x 1 vCPU = 179 vCPU at rest,
   90% of the old 200 limit**, and a full rollout doubles that to ~358 vCPU —
   i.e. a complete deploy could not fit under any circumstances, and the
   project sat ~21 functions away from breaking without deploying at all.
   Now 30% at rest, ~60% mid-rollout.
   The retry/chunking machinery in firebase-deploy.yml was KEPT on purpose —
   it is what made these failures legible, it guards three documented
   false-greens, and a quota is a ceiling not a guarantee. Thin it only after
   a long run of clean deploys.
   **Still unproven behaviourally:** the config is verified, but the real
   proof is the next functions deploy going green on the FIRST attempt.
   Watch that one.
6. **For free-API wave 1**: a Healthchecks.io account and a Better Stack
   account; a Census API key (instant); enable the Solar API on the GCP project;
   **start Meta App Review** for Lead Ads (mandatory, days-to-weeks) and the
   **GBP API access request** (blocks Local Posts) so wave 2 is not blocked.
   Optional: an ArcGIS Location Platform free key. Also: confirm
   `GROQ_API_KEY` is actually provisioned in `nobigdeal-pro`.
6. Which payment handles belong on invoices (Zelle is deliberately `info@`;
   PayPal/Venmo absent) — needed before touching the invoice block.
8. Do you want an **offline write queue** at all? `OfflineManager.queueWrite`
   has zero callers, so the UI and IndexedDB machinery imply a queue that does
   not exist. That is a product decision, not a bug.
9. Unchanged: seat price + `STRIPE_PRICE_SEAT`, App Check console enforce,
   delete the 7 retired functions, cost-basis rotation, Turnstile order,
   Copycat PAT (optional), Cal.com real booking.

## Watch-outs (carried + new)

- `main` is held by the `nbd-wt-ledger-recon` worktree — branch from
  `origin/main`, never check out `main` here. **`gh pr merge --delete-branch`
  will print `fatal: 'main' is already used by worktree…`; the merge itself
  still succeeded** — check `gh pr view --json state` before believing it.
- **The hosting emulator applies neither redirects nor headers.** Any
  `firebase.json` hosting change: preview channel, Node probe, delete the
  channel.
- **Visual-regression compares for real now.** A PR touching login, register,
  pricing or the landing page must delete
  `tests/e2e/visual-regression.spec.js-snapshots/` in the same PR.
- **A new `tests/*.test.js` must be registered in `tests/ci-manifest.json`** or
  the completeness tripwire fails CI. Node bucket is a plain array; the smoke
  bucket needs per-suite documentation.
- **NEW — `perl -0pi -e "s/…\n//"` silently no-ops on this checkout.** Files are
  CRLF, so `\n` never matches at a line end. It reports success and changes
  nothing — which briefly looked like a gate that could not fail. Match `\r?\n`.
- **NEW — the shell's cwd persists across Bash calls.** A `cd tests && node …`
  leaves every later call in `tests/`, where `functions/` "does not exist".
  Use absolute paths.
- **NEW — `gh pr checks <n>` returns empty for the first seconds after a push**,
  so `until [ "$(… | grep -c pending)" = "0" ]` exits immediately on a false
  green. Guard on non-empty output too.
- **Workflow runs can be wiped by an API capacity outage** — the first recon
  lost all 10 agents to 529s on their *final* structured-output call, after the
  reading was done. Wrap `agent()` in a retry loop; the retry run lost nothing.
- Two PRs inserting a section before the same `section(...)` line will
  merge-conflict; anchor new sections on distinct neighbours.
- **Per the shared-checkout lesson: whole slices have been rebuilt three times
  here, and a precise task prompt can itself be stale.** Check open PRs and
  worktree branches before starting any named slice — including one from this
  brief.
