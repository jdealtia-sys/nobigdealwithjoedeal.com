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
- **Branch protection on `main` is still OFF.** Every merge deploys
  immediately; poll checks yourself.

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

> **Status 2026-09-03 (late):** lanes 1-4 and 6 all shipped in the same
> session (#1359–#1363). **Lane 5 is the only client-side lane left**, and it
> is worth less than Jo's branch-protection toggle — see Jo's queue #3. The
> real remaining weight is in the two blocked sections below, and every item
> there is gated on a deploy window, prod access, a fixture, or a decision.
> **Start the next session by reading §Corrections, not this list.**

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
5. **`crm-audit.js` into CI** (M, low value until branch protection exists).
   `docs/pro/**` HTML is guarded by nothing — both `check-site-integrity.js:168`
   and `check-inline-html-scripts.js:60` exclude `pro`. But wiring it as-is
   creates the next silently-green gate: `--json` returns before the exit call
   so it **always exits 0**, and a typo'd `--page` reports success over zero
   pages. Fix the exit contract first, refuse to pass over zero matched pages,
   then wire it bare (no `--json`, no `--severity`). Do **not** include the
   recursion widening into `docs/pro/blog` and `docs/pro/daily-success` — that
   surfaces new findings and deserves its own attributable red.
6. ~~**Finish the `confirm()` allowlist question.**~~ **CLOSED same session by
   #1357.** The root cause is gone: the `confirm` and `prompt` overrides in
   `standalone-compat.js` are deleted, because their premise — that iOS blocks
   dialogs in standalone mode — is false and appears never to have been true.
   `alert` stays (no return value, so it cannot answer for the user). Five raw
   `confirm()` sites remain and all five are still legitimate. **Do not
   reintroduce the overrides**; `tests/pwa-confirm-guard.test.js` now asserts
   they stay dead, and the full argument sits next to the code. Details in the
   session note's §#1354 UPDATE.

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
2. **Grant `roles/iam.serviceAccountTokenCreator` on the compute SA** (~2 min,
   GCP Console → IAM). Still the highest-leverage console item: it unblocks
   signed photo URLs, `renderPdf` signed URLs and the whole token migration.
   #1353 closed the *reaping* half; the signed-URL cutover still waits on this.
3. **Turn on branch protection for `main`** (~2 min): require at least
   `Smoke tests` and `Unit suites (manifest)`. Verified OFF again today — until
   it exists, every CI gate is signal, not enforcement, and `gh pr merge --auto`
   merges immediately.
4. **Cloud Storage backup**: Object Versioning on
   `nobigdeal-pro.firebasestorage.app` + a daily Storage Transfer to a second
   bucket (photos and contracts are unrecoverable today) — and tell a session
   which of the two Firestore backup buckets is canonical. **This matters more
   now**: #1353 made lead deletion genuinely delete photos, so an accidental
   hard delete is no longer silently survivable.
5. **For free-API wave 1**: a Healthchecks.io account and a Better Stack
   account; a Census API key (instant); enable the Solar API on the GCP project;
   **start Meta App Review** for Lead Ads (mandatory, days-to-weeks) and the
   **GBP API access request** (blocks Local Posts) so wave 2 is not blocked.
   Optional: an ArcGIS Location Platform free key. Also: confirm
   `GROQ_API_KEY` is actually provisioned in `nobigdeal-pro`.
6. Which payment handles belong on invoices (Zelle is deliberately `info@`;
   PayPal/Venmo absent) — needed before touching the invoice block.
7. Do you want an **offline write queue** at all? `OfflineManager.queueWrite`
   has zero callers, so the UI and IndexedDB machinery imply a queue that does
   not exist. That is a product decision, not a bug.
8. Unchanged: seat price + `STRIPE_PRICE_SEAT`, App Check console enforce,
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
