# SESSION 2026-09-09 — Storm History Report (CRM doc gen) + mobile audit

Jo's ask: reuse the free 5-year NOAA storm data the public `/storm-report`
lead-magnet already pulls, inside the CRM, as a one-click document — "save me
from having to buy a GAF weather report." Then, on his own follow-up: triple-
check the new doc for tone/branding, and separately, a real complaint —
"I couldn't find where files show up on NBD web app or my phone-sized
profile" — turned into a scoped mobile audit of the CRM.

Branch: `fix/gbb-tier-consolidation` (uncommitted at session end — Jo has not
asked for a commit/PR yet). All work verified against the local Firebase
emulator suite (auth + firestore + storage + hosting + functions), not just
read.

---

## 1. What shipped: Storm History Report (5-Yr) document type

**No new Cloud Function, no new secret, no per-report cost.** Reuses the
exact same free, cached, unauthenticated `/api/storm-report?lat=&lon=`
endpoint (`functions/storm-report.js`) the public `/storm-report` page
already calls — NWS Local Storm Reports via Iowa Environmental Mesonet, 5
years, 30 mi radius. The CRM doc and the public page are **two separate
renderers sharing one data source**, not the same generator — worth knowing
if anyone goes looking for "the" storm report code.

**Files:**
- [`docs/pro/js/document-generator-templates.js`](../../docs/pro/js/document-generator-templates.js) —
  new `DG.renderStormHistoryReport(data)`: hero + 6 summary stats + a
  notable-events table (hail/tornado/non-minor-wind, capped 60 rows, newest
  first) + NOAA/IEM source citation + CTA. Registered in `DOCUMENT_TYPES` and
  `FORM_FIELDS`.
- [`docs/pro/js/document-generator.js`](../../docs/pro/js/document-generator.js) —
  new `_attachStormHistory(data)`, called from `generate()` before render.
  Uses `data.lat`/`data.lng` if the lead already has them (stamped by the
  existing geocode-on-save path), else free-geocodes `data.address` via
  Nominatim (already CSP-allowlisted, already used elsewhere in this
  codebase), then fetches `/api/storm-report` **same-origin, relative URL** —
  no CORS/CSP wiring needed regardless of which tenant domain serves `/pro`.
  Never throws; sets `data._stormReportError` on any failure so the template
  renders a graceful "unavailable" branch instead of a blank/broken doc.
- [`docs/pro/js/customer-tasks-ui.js`](../../docs/pro/js/customer-tasks-ui.js),
  [`dashboard-bootstrap.module.js`](../../docs/pro/js/dashboard-bootstrap.module.js) —
  `lat`/`lng` added to both `getCustomerDocData()` bridges; prerequisite gate
  (`needs:['address']`) added to both `DOC_PREREQUISITES` registries; catalog
  entry added to the searchable "Create Document" picker.
- [`docs/pro/customer.html`](../../docs/pro/customer.html),
  [`docs/pro/dashboard.html`](../../docs/pro/dashboard.html) — a card in the
  customer page's "Generate Documents" panel, and a row under "Insurance
  Documents" (5→6 docs) in the dashboard's Template Library.
- [`tests/docgen-render.test.js`](../../tests/docgen-render.test.js) —
  extended with the new type (both tenant-brand-leak passes it already runs
  for every type), plus dedicated cases: populated data (real event table,
  XSS-escaping a hostile city name), and a zero-events case (see honesty-gate
  fix below). 366 → **377 assertions, all green.**

### Two real bugs the live emulator test caught that reading the code would not have

1. **Cold-cache timeout was too short.** `functions/storm-report.js` chains
   FIVE sequential yearly IEM fetches on a cache miss; measured **38s**
   server-side against the emulator for a real Loveland, OH address. The
   client fetch had the usual 15-20s CRM budget and aborted before the answer
   came back, so the FIRST click for any new area silently failed into the
   "unavailable" branch. Bumped to 60s
   (`document-generator.js:_attachStormHistory`). A repeat call for the same
   coordinates (or any nearby address, since the cache is keyed on rounded
   lat/lon) returns in **2ms** — this is a first-lookup-only cost, and it's
   shared with the public page's own cache.
2. **Honesty-gate overclaim at zero events.** The CTA banner unconditionally
   said *"Verified storm activity near this property"* even when the report
   found **zero** events — a real problem for a document meant to be handed
   to an adjuster. Found on Jo's explicit request to check for anything
   "hurtful or harmful." Now conditional on `counts.total` and whether any
   notable (hail/tornado/non-minor-wind) event exists, mirroring the public
   page's own three-tier `verdict()` in `storm-report-page.js`. Locked in
   with a new test asserting the zero-events render does NOT contain that
   claim.

### Content/branding triple-check (Jo's request)

- **Branding**: CRM doc uses the shared `letterhead()`/`footer()` helpers —
  identical mechanism as all 20+ other document types, tenant-branded
  (logo/name/colors), on both the success and "unavailable" branches.
  Already covered by the existing multi-tenant brand-leak suite (NBD shows
  NBD, Oaks shows Oaks, no leak either direction) — no new test needed
  there, the type just rides the existing one.
- **Public `/storm-report` page + `stormReportEmail.js` follow-up email**
  (pre-existing, NOT touched this session): nav logo present and NOT
  stripped by print CSS (a rule that looked like it would hide it targets a
  dead `.sr-head` class that matches no element — false alarm, verified by
  grep). Email's text-only header (no `<img>` logo) is consistent with every
  other NBD transactional email checked (`estimate-email.js`,
  `lead-alert.js`) — a deliberate site-wide pattern, not a gap.
- **Tone**: neither pipeline ever surfaces NOAA narrative/injury text — the
  event objects only ever carry date/type/magnitude/distance/city, checked
  at the source (`functions/storm-report.js:buildReport`) and confirmed the
  CRM table only renders those five fields.

### Not verified / open

- **Non-NBD tenant reachability untested.** The same-origin design should
  work for any tenant custom domain (same Firebase Hosting site, same
  rewrite), but this was reasoned from `firebase.json`, not verified against
  an actual second tenant domain.
- **The Templates-library fill-form path is one field, not zero-click** —
  `storm_history_report` intentionally has ONE manual field (`address`) in
  `document-generator.js`'s `typeSpecificFields` fallback map, because that
  map is a THIRD, separate field registry from `DG.FORM_FIELDS`
  (document-generator-templates.js) and from `DOC_SCHEMAS`
  (doc-preflight.js) — three different mechanisms answer "what fields does
  type X need," and they are not kept in sync automatically. Worth knowing
  before adding a fourth doc type that needs live-fetched data: check all
  three, not just `DG.FORM_FIELDS`.
- **No loading-state UX for the cold-cache case.** A rep who hits this for a
  genuinely new area sees no spinner/progress for up to ~40s. Flagged, not
  built — Jo didn't ask for it and it's a UI-polish item, not a defect.

---

## 2. Mobile audit (Jo's second ask, same session)

Jo's literal complaint: *"I couldn't find where files show up on NBD web app
or my phone sized profile."* Investigated at 375×812 (iPhone SE-class) via
the emulator, both `customer.html` and `dashboard.html`.

### Root cause, found three times

A recurring pattern across the CRM: a row of tab/chip/pill elements styled
`overflow-x:auto` with the scrollbar hidden or effectively invisible on
mobile (iOS's overlay scrollbar is only visible mid-drag) — so at rest the
row reads as "that's everything" instead of "swipe for more." Fixed all
three with a right-edge CSS `mask-image` fade (pure CSS, no JS, no layout
change) — a persistent "there's more" cue that composites correctly under
any theme:

1. **`customer.html` `.jump-nav`** — Overview/Timeline/Photos/**Files**/
   Messages/Contact. This is almost certainly what Jo actually hit — Files
   is the 4th of 6 links and was invisible past "Photos" on a 375px screen.
2. **`dashboard.html` `#kanbanViewSwitcher` / `.crm-hdr-views`** — the
   pipeline's Ins/Cash/Fin/War/Svc/**Jobs**/**All** stage filters, in
   `css/dashboard-app.css`. Same shape, same fix.
3. **`close-board.js`'s stats row** (`.cb-stats-row`, class added this
   session — it was unnamed inline styles) — Active Deals/Viewed/**Signed**/
   **Closed Value**. 4 cards at `min-width:100px` + gaps = 430px, always
   wider than any phone.

All three verified live in the browser (computed `mask-image` present,
non-`none`), not just by reading the CSS. Note for future testing in this
environment: the hosting emulator's `Cache-Control: public, max-age=300`
applies to CSS/JS too, so a CSS-only edit needs either a hard cache-bust
(swap the `<link>`'s `href` with a fresh query string) or a 5-minute wait to
observe live — a stale read here cost real time this session before the
cause was identified.

### False leads — checked and correctly left alone

Three more `overflow-x:auto` matches turned out to be dead code, not live
bugs. Each was "fixed" first, then caught by grep-checking whether any
element actually carries the class, then **reverted** rather than leave an
inert change in the diff:

- **`.map-fab-bar`** (dashboard.html:1166, `#view-map`) — a real 9-button
  toolbar, but `#view-map` is a **legacy view** explicitly superseded by
  `#view-d2d` (`dashboard-actions.js:277`, "legacy 'map' key to 'd2d'").
  `goTo('map')` redirects to the new D2D map, which was checked separately
  and has no invisible-scroll issue at all (swept with the same detector,
  zero scrollers found).
- **`.step-bar`** and **`.crm-rev-strip`** (`dashboard-app.css`) — neither
  class is emitted by any JS or HTML in the repo (`grep -rl` came back
  empty for both outside the CSS file itself). Selectors with nothing to
  select.

### Views swept clean (detector found zero page-overflow, zero invisible
scrollers)

Dashboard Home, Estimates (empty state — the actual V2 builder body was
**not** reached, see below), Templates library content itself (once you get
past the tab bar), Photos, the D2D map, and the customer detail page body.

### Explicitly NOT covered — scoped audit, not exhaustive

Prospects, Drawing Tool, Sales Training, Real Deal Academy, Products, Job
Templates, Expenses, Money, Settings, Leaderboard, Rep OS, and — importantly
— **the actual estimate builder (V2) line-item/pricing UI was never
reached** (clicking "+ New Estimate" from the empty Estimates state opened a
"From Template / Start Blank" picker that wasn't followed further). Given
estimates are dense, table-heavy UI, this is the single highest-value
remaining page to check next.

### A genuine but unrelated finding, not fixed (out of scope for this lane)

Re-opening an **already-generated** document via "View" in the customer
page's Generated Documents list hits **production** `cloudfunctions.net`
against the local emulator and CORS-fails
(`customer-documents.js:viewGeneratedDoc` calls `getFunctions()` lazily on
first use, without ever calling `connectFunctionsEmulator` — that only
happens for whichever `functions` instance a page's bootstrap module
connects at load time). Same shape in `document-generator.js:_tryServerRender`
for the four server-rendered doc types (contract/invoice/change_order/
receipt). **Local-dev-testing-only** — does not affect production, since
prod doesn't need emulator wiring. Not fixed: out of scope for this session,
and the fix (making every lazy `getFunctions()` call site route through
`nbd-emulator-connect.js`) touches shared infrastructure beyond what was
asked. Worth a session of its own if local manual testing of doc-gen keeps
coming up.

---

## 3. How to reproduce / continue this locally

```bash
# terminal A — start the rig (stays up)
env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy \
  npx firebase-tools emulators:start --only auth,firestore,storage,hosting,functions --project nobigdeal-pro

# terminal B — seed the test tenant (re-run after every emulator restart — no export/import was set up, so Firestore data does not persist across restarts)
export FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"
export FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"
node tests/e2e/fixtures/seed-emulator.js
```

Login at `http://127.0.0.1:5000/pro/login.html` — `playwright-e2e@nbd.test`
/ `nbd-e2e-password-1`. `goTo('<name>')` in the browser console jumps
dashboard.html views directly (`est`, `crm`, `photos`, `map`→redirects to
`d2d`, `closeboard`, etc.) — faster and more reliable than clicking the
mobile bottom-nav's "More" drawer, which was flaky to drive via automation
this session (unclear if that flakiness reflects a real UX issue or just the
test harness; not conclusively either way).

Regression suite for the doc type: `node tests/docgen-render.test.js`
(377 assertions). Repo-wide gates all still green after every change this
session: `check-js-syntax.js`, `check-site-integrity.js --quiet`,
`check-inline-html-scripts.js`.

**Pre-existing, unrelated to this session:** `node tests/docgen-preflight-contract.test.js`
has one failing assertion, `warranty: transferable clause shows only when
checked` — confirmed via `git stash` to fail on this branch **before** any
of this session's changes (from the warranty-consolidation commit already
on `fix/gbb-tier-consolidation`, `c23e9f63`). Not investigated further —
not this lane's to fix.

**Housekeeping carried forward, not this lane's to touch:**
`tests/_tmp-lanef-probe.test.js` is still sitting untracked in this
checkout, exactly as §11 of
[NEXT_SESSION-2026-09-09](NEXT_SESSION-2026-09-09.md) already noted — CI
never sees it, but it still fails `run-test-manifest.js --check` locally.
Left in place for the same reason that note gives: deleting an untracked
file is unrecoverable and it was never this lane's to remove.

---

## 4. Suggested next steps, ranked

1. **Estimate builder (V2) at mobile width** — never reached this session,
   highest density of tables/line-items/pricing UI in the CRM, highest risk
   of the same invisible-overflow class of bug.
2. **Finish the mobile sweep** on the views listed as not-covered above,
   if Jo wants full coverage rather than the two confirmed complaint-adjacent
   fixes.
3. **Cross-tenant verification** of the Storm History Report's same-origin
   assumption, if/when a second tenant is actively onboarded.
4. **Local emulator-wiring gap** for `getDocumentHtml`/`_tryServerRender`
   (§2 above) — only worth doing if local manual doc-gen testing becomes a
   recurring need.
