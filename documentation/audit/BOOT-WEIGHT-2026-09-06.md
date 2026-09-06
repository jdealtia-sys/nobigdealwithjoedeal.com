# CRM boot weight + three duplicate-execution bugs — 2026-09-06

Acting on §Weight of [ESIGN-CRM-RECON-2026-09-06](ESIGN-CRM-RECON-2026-09-06.md).
Every finding was re-verified against `main` (`3f61313d`) before anything
changed, because this repo's notes have a documented history of confident
claims that were wrong. Corrections to the recon are appended to it in place.

**Rule followed throughout: measure, do not assume.** A "lazy" file that every
boot immediately fetches has saved nothing, and a lazy file the page needs but
never fetches breaks only on the one interaction that needs it — silently.

## Baseline (reproduced, not trusted)

The recon's numbers reproduce **exactly**, but only after excluding two things
a naive `<script>` scan counts: tags inside HTML comments (5 on the dashboard)
and tags inside `<template>` (9 files, 109 KiB) — template content is an inert
`DocumentFragment` the browser never fetches. Without that filter the count is
138 files / 26 blocking, and the 17-vs-26 "discrepancy" would have sent a
session chasing nine files that never load.

Numbers below are measured against **`5a19dd92` (PR #1418)**. Main moved twice
while this branch was in flight — #1417 and then #1418 — and the branch was
rebased and **fully re-measured against each** rather than carrying forward the
earlier figures. Neither touches `customer.html`, so its numbers are unchanged
to the byte; #1418 adds its two eager tags to `dashboard.html`, which is why the
dashboard baseline below is **131 files, not the 129 of the original recon**.

| page | boot JS files | bytes | gzip | render-blocking CSS |
|---|---|---|---|---|
| dashboard.html | 131 (incl. #1418's two queue tags) | 3041.5 KiB | 934.3 KiB | 484.1 KiB / 11 sheets |
| customer.html | 74 (70 defer · 4 module) | 1888.5 KiB | 569.8 KiB | 87.4 KiB / 5 sheets |

## Result

| page | boot JS requests | boot JS bytes | boot JS gzip | render-blocking CSS |
|---|---|---|---|---|
| **customer.html** | 74 → **70** (−4) | 1888.5 → **1395.0 KiB** (**−493.5, −26%**) | 569.8 → **421.9 KiB** (−147.9) | unchanged |
| **dashboard.html** | 131 → 131 | 3041.5 → 3045.9 KiB (+4.4, loader code) | 934.3 → 935.8 KiB | 484.1 → **462.3 KiB** (−21.8) · 11 → **7 sheets** (−4) |

The customer.html saving is **byte-identical across all three baselines**
(497,436 B measured at #1416, #1417 and #1418) — the absolutes moved, the
delta did not.

Both measured by the same script before and after (comments + templates
excluded, gzip level 9). Dashboard JS grew 4.4 KiB: that is the new
`cacheKey()` + `loadCss()` in `script-loader.js`, which every page carries.

**Intentional eager weight, now MERGED as PR #1418 (this branch is rebased on it) —
do not sweep it in a future weight pass.** The offline photo queue adds two
`defer` tags to `dashboard.html`: `photo-queue-store.js` (20,717 B) and
`photo-queue-recovery.js` (5,698 B) — **25.8 KiB**, +2 requests, so the
dashboard baseline is **131 files**, not 129 — confirmed by measurement above,
not prediction. (Sizes are the **merged** `5a19dd92` blobs on disk. An earlier
revision of this note cited 14,425 + 5,252 B, read from that PR's pre-review
branch head; its review pass grew both files. The dashboard totals in the
tables were always measured against merged main and are unaffected.) They are eager for the
same reason `profit-tracker` and `supplement-ui` stay eager above: no user
intent precedes the need. `dashboard-sw-bootstrap.js:69-72` reloads on every
iOS bfcache resume, and recovery's job is to drain a photo queued *before*
that reload without the rep navigating back to Photos — loaded "at point of
use", there is no point of use and the photo never uploads (the app said
"queued"). Boot cost is bounded on their side: a synchronous
`localStorage` count, returning on 0 before `IndexedDB` is opened; DOM-free
at load. `photo-engine.js` itself stays lazy in the `photos` bundle —
recovery pulls it via `ScriptLoader.loadBundle('photos')` only when
something is queued, which the resolved-path dedupe here handles unchanged.
The e2e spec in this change asserts behaviour, not a byte budget, so neither
PR trips the other. #1418 landed first; this branch was rebased onto it and
every figure above re-measured against `5a19dd92`, so the tables already
include those two tags in both the before and the after column.

## The four items

### 1. customer.html eager-loads what the dashboard proves lazy — `[high/confirmed]`, done for 498.7 of 656 KiB

Eight files on the customer boot path sit in a dashboard `ScriptLoader`
bundle: 656.0 KiB (the recon's 653.6 plus version drift). **Only four were
safe to move**, and the reason the other four were not is the whole point of
the rule above:

- **Moved — the docgen cluster, 498.7 KiB**: `nbd-logo-asset`,
  `document-generator`, `document-generator-templates`, `doc-preflight`.
  A sweep of every file on the customer boot path found exactly three
  consumers, none at render time, each already guarded on the global and
  showing a dead-end *"not loaded — refresh"* toast:
  `exportCustomerPDF` (customer-bootstrap.module.js), `generateCustomerDoc`
  and `_previewBlankDoc` (customer-tasks-ui.js). Each now awaits
  `ScriptLoader.loadBundle('docgen')` in place of that toast. The one
  `company-profile.js` mention is a comment.
- **Kept eager — `profit-tracker.js` (18.8 KiB)**: `renderCostPanel('profitPanel')`
  runs during the initial customer render (customer-bootstrap.module.js:838).
  Lazy = a blank cost panel with no error.
- **Kept eager — `supplement-ui.js` + `estimate-supplement.js` (91.1 KiB)**:
  `supplement-ui` paints the **"+ Supplement" button onto every estimate row**
  at load and on every DOM mutation. There is no user intent before the
  button exists — the button *is* the intent surface. Lazy = a revenue surface
  disappears. Their real fix is item 2.
- **Kept eager — `photo-report.js` (47.6 KiB)**: it and
  `customer-photo-report-generator.js` **both assign `window.generatePhotoReport`**,
  and `photo-report.js` loads later so it wins. Making it lazy would silently
  switch the customer page to the *other* generator (a zero-arg version the
  picker calls with two args). Follow-up, not this change — see below.
  → **RESOLVED later the same day: the dead rival was deleted and this file is
  now lazy too.** See §Untangle below; a further −54.9 KiB off customer boot.

### 2. ScriptLoader dedupes on the raw `src` string — `[high/partly]` → confirmed live, fixed

`customer.html` writes its tags absolute (`/pro/js/supplement-ui.js?v=1`);
the bundles are page-relative (`js/supplement-ui.js?v=1`). Both the
`loaded` Set and the `querySelector('script[src="…"]')` guard compared raw
strings, so `loadBundle('estimates')` — which `customer-estimate-hub.js:408`
calls on the customer page — re-injected and **re-executed** `supplement-ui.js`,
whose top-level `_bootstrap()` registers a `document.body` subtree
`MutationObserver` and has no re-entry guard. Two observers, both calling
`attachButtons()` on every mutation of the page.

Fix: script identity is now `cacheKey(src)` = resolved `origin + pathname`
(`new URL(src, document.baseURI)`, query and hash dropped). That collapses
both the path-form and the `?v=` cache-buster variants. The eager-tag guard
scans all `script[src]` and compares keys.

**Proven live in Chromium**: with the raw-src compare restored, the customer
page ends up with **two `supplement-ui.js` tags in the DOM**. Note the trap:
the *fetch* count did not change (the browser served the second from cache),
so a network assertion passes while the file re-executes. The e2e gate asserts
the tag count.

### 3. Three live Cmd+K handlers — `[high/partly]` → confirmed, dashboard-only, fixed

Found all three: `command-palette.js:612` (canonical, `window.NBDCommand`),
`global-search.js:636`, `ui.js:211`. `global-search.js` **already stands
down** for `NBDCommand` (its comment names command-palette as canonical).
`ui.js` did not, and `dashboard.html` loads all three with `#cmdPalette`
present — so one keypress opened two palettes stacked. `customer.html` loads
only `command-palette.js`, so the bug never reached it. `ui.js` now uses the
same per-event `!window.NBDCommand` guard as global-search; its palette remains
the fallback if the canonical one is absent.

### 4. `markLoaded` exported, never called — `[medium/confirmed]`, removed

Zero callers across `docs/`, `tests/`, `scripts/` in the four months it
shipped; the only reference was a smoke test asserting it was exported. The
task offered "wire it or remove it": with item 2's resolved-path key, the live
tag scan already does its documented job on every page with no list to
maintain, so it was removed. The smoke assertion now pins the replacement
invariant (`cacheKey` exists, drops the query, and the tag scan uses it)
instead of a dead name.

**Version drift — 7 files, all unified.** `command-palette` (1/2),
`document-generator` (7/10), `document-generator-templates` (7/8),
`lead-snooze` (1/2), `profit-tracker` (1/2), `review-engine` (2/3),
`script-loader` (1/2) — each was identical bytes fetched under two cache keys
by anyone who opened both pages. Now one key each, repo-wide (the bundle took
the newest string).

## The two "also worth checking" items

- **Leaflet CSS — done, with an honest scope.** Four stylesheets (21.8 KiB)
  were render-blocking `<link>`s in the dashboard `<head>` while the JS had
  been lazy since 2026-08-07. `ScriptLoader.load()` now handles `.css` entries
  (injected `<link>`, same dedupe key, same sequential order), and the four
  lead the `mapvendor` bundle so they apply before `leaflet.js` builds a map
  — the original "first map paint isn't unstyled" guarantee holds. **But**
  `weather-radar` is in `DEFAULT_WIDGETS` and its `render()` calls
  `_withLeaflet` → `loadBundle('mapvendor')`, so on a default home view the
  bytes still arrive moments after first paint. The win is first-paint
  (nothing parser-blocking), not boot bytes, for that user; it is the full
  21.8 KiB only for a user who removed the radar widget. The e2e gate was
  rewritten to assert the true invariant after a first version that asserted
  "never fetched" failed for exactly this reason.
- **Sentry tracing bundle — verified, deliberately not shipped.**
  `sentry-init.js` loads `bundle.tracing.min.js` at `tracesSampleRate: 0.05`.
  Switching to the error-only bundle needs a new SRI `integrity` hash for
  that exact file, which cannot be produced safely offline; a wrong hash makes
  error reporting die silently. It is also CDN-served, async, and only loads
  when a DSN is set — so it is off the measured boot path. Low value, real
  risk: recorded, not done.

## Verification

- **Gates run**: `check-js-syntax` (489 clean), `check-inline-html-scripts`
  (0 inline), `check-site-integrity` (0 failures), `run-test-manifest --check`
  (154 classified, coverage clean), `smoke.test.js` (**3599 passed**, up from
  3592 — two existing assertions caught the `async` change and were updated),
  `run-test-manifest --bucket node` (71/71), `crm-audit` (0 errors; the one
  warn is a pre-existing `vault.html` empty anchor, untouched here).
- **Every new gate was proven able to fail first**: the resolved-key smoke
  assertion (regressed the scan → 1 failure), the Cmd+K ownership scanner
  (reverted `ui.js` to `main` → `ui.js stands down` fails), and the e2e
  dedupe test (regressed the scan → **2 tags in the DOM**).
- **Real pages, real auth, Chromium** — `tests/e2e/boot-weight.spec.js`,
  wired into `test:e2e:authed:emu` (the manifest gate refused it until it
  was). A first "verification" that loaded `customer.html` unauthenticated
  passed every assertion and was **worthless**: the auth gate had redirected
  to `login.html`, so of course nothing was fetched. Against the emulator with
  the seeded tenant, all 5 pass: docgen absent at boot and resolving on
  demand, the render-time modules eager, one `supplement-ui` tag after the
  estimates bundle, one palette on Cmd+K, Leaflet CSS not parser-blocking and
  applied (`.leaflet-pane` computes `position:absolute`) with the radar widget
  building a real map.
- **Full authed suite (49 specs), without the functions emulator**: 42 pass,
  2 fail, 5 skipped as dependents. Both failures are registration/onboarding
  flows — `stranger:194` (the wizard's `#finishBtn` shows *"Could not finish
  setting up your workspace"*, its error state when
  `httpsCallable('createCompany')` fails, onboarding.js:258-265) and
  `gauntlet:284` (`redeemAccessCode` never runs). The run was `--only
  auth,firestore,storage,hosting`; the npm script treats `,functions` as
  opt-in. **Re-run with the functions emulator: both pass.** Environmental,
  confirmed by measurement, not by the (correct) observation that neither
  page loads a changed file.
- **One further failure, proven pre-existing.** With functions on, a
  *different* test fails: `stranger:346` — a `waitForFunction` on
  `window._user.uid` on the owner's dashboard right after login — 2/2 with
  this change. The snapshot shows the dashboard fully booted ("Connected · 2
  leads"), and `_user` is set only by `dashboard-bootstrap.module.js:1424` /
  `nbd-auth.js`, neither touched. That is reasoning, not measurement, so the
  six changed `docs/pro` files were reverted byte-for-byte to `main`
  (verified by an empty diff) and the spec re-run on that tree: **it fails
  identically on `main`** — same timeout, same 3 passed / 1 failed / 1 did
  not run. A pre-existing red on this machine, recorded in the handoff so
  nobody chases it as a regression. Net: **zero failures attributable to
  this change.**
## RETRACTED: the "stale worktree copy reverted #1416" claim was wrong

An earlier revision of this note, the PR body and a memory file all reported
that a stale worktree copy had silently reverted PR #1416's markPaid fix.
**That did not happen. There was no stale copy and no revert.** The claim is
retracted here rather than deleted, because the mistake is the useful part.

What actually happened, established by command:

- **#1416 (`3f61313d`) itself ADDED the `setTimeout(..., 600)` repaint** —
  `git show 3f61313d -- docs/pro/js/customer-tasks-ui.js` shows it as an
  added line. It was #1416's own code, not a pre-#1416 leftover.
- **#1417 (`6e8b14b9`) landed later, while this branch was being worked**,
  and replaced that timer with `const paid = await …markPaidUI(invoiceId)`
  plus `if (paid && …)`. `git log -S` confirms #1417 introduced both.
- This branch was cut from `3f61313d`, so its copy **legitimately** held the
  timer form, and commit `50cc2ee4` left that hunk **byte-identical to its
  own parent** — it changed nothing there.
- A `git fetch` then advanced `origin/main` to include #1417. Diffing the
  branch against the *moved* `origin/main` showed a difference, which was
  misread as "my file went backwards" when the truth was "main went
  forwards". The follow-up commit then pulled #1417's hunk onto the branch
  and added a test assertion duplicating one #1417 already had.

**The real lesson, and it is not the one first reported**: before diagnosing
a content difference against `origin/main`, check whether `origin/main`
moved — `git rev-list --left-right --count origin/main...HEAD` and
`git log <base>..origin/main`. A diff against a moving target says nothing
about your own tree until you know where the target is. The corrected
account was adversarially re-verified by three independent lenses before
being written here.

**The hazard is real, though — it just arrived later.** Rebasing this branch
onto the new main with `git reset --mixed origin/main` left the working tree
holding **pre-#1417 copies of three files this change never authored**
(`invoice-pipeline.js`, `photo-engine.js`, `photo-offline-queue.test.js`).
Committing the modified set at that moment *would* have genuinely reverted
#1417. Caught by listing, for every file, the count of lines it removes
relative to the new `origin/main` and requiring each one to be
self-authored. That check is worth keeping regardless of how the earlier
claim turned out:

```
for f in $(git diff --name-only origin/main); do
  echo "-$(git diff origin/main -- "$f" | grep -cE '^-[^-]')  $f"; done
```

The redundant assertion added under the false premise was dropped;
`tests/customer-invoice-markpaid.test.js` is #1417's version unmodified,
whose own four assertions cover that ground better.

## Untangle: the `generatePhotoReport` double assignment (2026-09-06)

`customer.html` loaded two rival definitions of `window.generatePhotoReport`:
`customer-photo-report-generator.js:8` (zero-arg) at :2156, and
`photo-report.js` at :2191. Both `defer`, so they run in document order and
**photo-report.js won** — the first was dead code that had been shipped, parsed
and executed on every customer page load since it was written.

**What changed.** Deleted the dead definition (lines 8–223) plus its
now-orphaned `fetchImageAsBase64` helper (225–251) and export (838) — keeping
line 7's `removeDocFromQueue`, which the live doc-upload queue uses. That is
**245 lines / 9,375 B** off a file that stays otherwise intact: it still owns
the doc-upload queue, the notes modal, the estimate modal and `loadNotes`.
With the race gone, `photo-report.js`'s eager tag went too — it now rides the
`photos` bundle it was already in for the dashboard, behind a load-then-run
stub in `customer-photo-report-picker.js`. The tag must stay **removed**, not
reordered: the resolved-path dedupe would make `loadBundle('photos')` a no-op
for a file that still has an eager tag, and nothing would defer.

| | before | after |
|---|---|---|
| customer.html boot JS | 1395.0 KiB | **1340.1 KiB** (−54.9) |
| gzip | 421.9 KiB | **405.6 KiB** (−16.3) |
| requests | 70 | **69** |

**Two live bugs the dead code was masking.** Four smoke assertions covering
this area were green *because they read the dead file* — `readCustomer()`
concatenates it. With the dead block gone they went red, and each one turned
out to be guarding a behaviour the shipping renderer does not have:

1. **Tenant filename leak.** `photo-report.js` hardcodes `'NBD-'` as the PDF
   filename prefix (`:147`, `:1005`), and `functions/render-pdf.js` takes the
   filename **from the client** — so every non-NBD tenant's photo report ships
   named `NBD-…`. The tenant-correct resolver (`_custIdPrefix()` /
   `docPrefix`) existed only in the dead block. Three assertions in
   `photo.test.js` claimed to guard exactly this (*"the `docPrefix || 'NBD'`
   fallback must never return"*) while reading the file that never ran.
2. **Drag order ignored.** The dead renderer sorted by `nbdComparePhotos`, the
   comparator that honours the rep's drag-rearranged gallery order. The live
   one sorts by `createdAt` only (`:92`). `crm.test.js:275` asserted the drag
   order *was* honoured — again against dead text.

Neither is fixed here: both change a customer-facing document and deserve
their own change and proof. The assertions were **retargeted at the renderer
that actually runs** and now pin the current, broken behaviour as an explicit
`KNOWN GAP`, so the gap is visible instead of hidden — each one flips to the
correct form when the fix lands, and each was **proven able to fail** first.

**Verification.** smoke **3607 passed / 0 failed** (was 3604; four dead
assertions retargeted, three stub gates added) · node bucket **75/75** ·
site-integrity, manifest, vault-index, crm-audit clean · `boot-weight.spec.js`
**6/6 in Chromium against the emulator**, including a new test proving
photo-report.js is absent at boot, the stub is installed, `fetchImageAsBase64`
is gone, and `loadBundle('photos')` swaps in the real renderer with
`pageErrors: []`. All three new gates proven able to fail before being trusted
(removing the stub marker → 2 red; restoring the eager tag → 1 red; changing
the hardcoded prefix → 1 red).

**Method note.** The investigation ran as four adversarially-verified
dimensions. One verifier flagged that the worktree changed under it
mid-investigation — that was me, editing while agents were still reading. It
did not corrupt the result (their corrections matched what the test run found
independently), but it is a real flaw: **do not mutate the tree that
investigating agents are reading.**

## Tenant filename leak — the `NBD-` prefix on other tenants' documents (2026-09-06)

Surfaced while untangling `generatePhotoReport` above: three smoke assertions
*claimed* to guard `"the docPrefix || 'NBD' fallback must never return"` while
reading a file that never executed. With the dead code gone the guard was real
again — and the shipping renderers failed it.

**The defect.** Ten customer-facing renderers hardcoded `'NBD-'` as the PDF
filename prefix. `functions/render-pdf.js:387` takes the filename **from the
client, verbatim** (it only charset-sanitises and truncates), so a non-NBD
contractor's estimate, inspection report, photo report and rep report all
reached the homeowner — and the *adjuster* — named `NBD-…`.

**Why the obvious fix is wrong.** Swapping `'NBD-'` for `window._custIdPrefix()`
does **not** fix it. `company-profile.js:276` seeds `_companyProfile` with the
NBD defaults at parse time, and `_isNbdBrand()` (`:396`) cannot tell those
defaults from the real NBD tenant — so `_custIdPrefix()` answers `'NBD'` for
**every** tenant until `_loadCompanyProfile()` resolves, which both pages fire
un-awaited. A synchronous read converts a deterministic leak into a race, plus
a **permanent session-long leak** whenever hydration fails (`getDoc` throws →
swallowed at `:331` → the profile never loads → every PDF that session is still
`NBD-`). `customer-bootstrap.module.js:404-421` documents this exact race for
the customer-ID mint, in almost the same words.

**The fix.** A new `window._tenantFilePrefix()` in `company-profile.js` — async,
awaiting hydration then *requiring* `_companyProfileLoaded === true` (the same
gate the ID mint uses), returning `''` when the answer is unknowable. Never
`'NBD'`: the rule was already written down at `estimate-finalization.js:210`
("callers must not substitute 'NBD'"). `window._tenantFileName(rest)` builds the
name and guarantees it is non-empty, because `nbd-doc-viewer.js` used to default
a blank filename to `NBD-Document.pdf` — which would have re-leaked the prefix
through the back door. That default is now `Document.pdf`.

**Ten sites fixed** — every server-rendered PDF (Tier A: the filename becomes a
Storage path and lands on an external party's disk verbatim) plus the main
doc-viewer paths:

| file | site | reaches |
|---|---|---|
| `photo-report.js` | `:147`, `:1005` | homeowner / adjuster |
| `estimate-v2-ui.js` | `:2548` **primary server render**, `:3285` fallback, `:3596` signature | homeowner |
| `inspection-report-engine.js` | `:2787` | homeowner / adjuster |
| `estimates.js` | `:915` | homeowner |
| `rep-report-generator.js` | `:1006`, `:2153` | internal / rep |
| `nbd-doc-viewer.js` | `:614`, `:715` last-resort default | anything unnamed |

`estimate-v2-ui.js:2548` was **not** in the original five-site list and matters
most of the six: it is the server render `finalize()` returns on, so `:3285`
only runs when it fails. Fixing the fallback alone would have left the estimate
a homeowner actually receives still `NBD-` branded.

**Deliberately deferred — five sites, all doc-viewer downloads:**
`close-board.js:578` (Deal) · `maps-routing.js:1882` (Scope of Work),
`:1934` (Measurements), `:2268` (Takeoff), `:3448` (Supplement Request).
Scope and Supplement go to **adjusters**, so these are real. Each sits in a
**synchronous** enclosing function, so each needs a sync→async conversion with
its own caller audit — a different risk profile from the ten above, and its own
change. `exportEstimate` and `openSavedReport` needed exactly that conversion
here and were verified safe (both are dispatched fire-and-forget via
`data-action="call"`, return value discarded).

**Also the same defect class, not filenames:** the `|| 'NBD'` fallbacks in
`warranty-cert.js:79`/`:301`, `estimate-v2-ui.js:56` and
`document-generator.js:155` should move to `_tenantFilePrefix()`. And
`dashboard-ui.js:1263-1289` was flagged by a verifier as an NBD **body** leak in
the doc templates — unexamined here, worth its own look.

**Verification.** smoke **3614 / 0** · node bucket **75/75** ·
`cust-id-prefix.test.js` 45/45 (the resolver's own suite, untouched) ·
`tenant-filename-prefix.spec.js` **passes in Chromium against the emulator**
with a real seeded non-NBD tenant: the resolver returns that tenant's prefix,
never `'NBD'`, the filename carries it, and — simulating the failure mode that
made the naive fix dangerous — an unhydrated profile yields an **unprefixed**
name rather than guessing. All three new gate classes proven able to fail first
(re-introduce a hardcoded prefix → 2 red; make the resolver guess `NBD` → 1 red;
drop the `await` → 1 red).

**Method note.** Four adversarially-verified dimensions; **1 of 4 refuted**, and
the refutation is why this is right: the naive swap would have shipped a race.
The verifiers also found the leak inventory kept growing under them — the brief
said five sites, they found ten, then sixteen. Treat any "complete list" here as
a floor.

## Follow-ups found, not done here

- ~~**`window.generatePhotoReport` is assigned twice on `customer.html`**~~ —
  **DONE 2026-09-06 (see §Untangle below).** `customer.html` boot JS
  1395.0 → **1340.1 KiB** (−54.9, −16.3 gzip), 70 → 69 requests. Removing the
  dead rival exposed **two live bugs it had been masking** — details below.

  **CORRECTED 2026-09-06 (later): an earlier revision of this bullet said the
  former is "dead on that page, and its 32.5 KiB is fetched for nothing."
  That is wrong and would be dangerous to act on.** The FILE is load-bearing:
  839 lines / 33,264 B, and it also defines the doc-upload queue
  (`openDocUploadModal`, `uploadDocuments`), the notes modal (`saveNote`,
  `quickAddNote`), the estimate modal (`saveEstimate`), plus `window.loadNotes`
  and `window.fetchImageAsBase64`. Deleting it would break the customer page.
  What is dead is only the **`generatePhotoReport` definition itself — lines
  8–258, 251 lines / 9,208 B** — which `photo-report.js` overwrites at load.
  Note the trap for whoever does this: that dead block calls
  `fetchImageAsBase64`, which is defined OUTSIDE it and exported at line 838,
  so the helper must survive the removal.
- **`supplement-ui.js` has no re-entry sentinel** (unlike `script-loader` /
  `sentry-init`). Item 2 stops the double-injection; a sentinel would make the
  file safe against *any* future double-load, not just this path.

## Files

`docs/pro/js/script-loader.js` · `docs/pro/js/ui.js` · `docs/pro/customer.html` ·
`docs/pro/dashboard.html` · `docs/pro/js/customer-bootstrap.module.js` ·
`docs/pro/js/customer-tasks-ui.js` · `tests/e2e/boot-weight.spec.js` (new) ·
`tests/smoke/dashboard.test.js` · `tests/smoke/photo.test.js` · `tests/package.json`
