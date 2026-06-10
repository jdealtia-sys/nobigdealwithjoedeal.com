# NBD Pro — Exhaustive QA — Ranked Bug Log

Failures and known-open issues, ranked, with repro + likely file, scoped for a **separate remediation pass.** Trivial bugs are fixed inline during the sweep (logged as `FIXED` in the ledger, not here). This log is for everything bigger.

- **CO-\*** = carried over from prior QA runs (`carryover.json`), still open or pending re-verify.
- **NEW-\*** = found during this exhaustive sweep (appended as testing proceeds).

Severity: **BLOCKER** > **HIGH** > **MEDIUM** > **LOW**.

---

## ✅ TIER A REMEDIATION — MERGED + DEPLOYED (2026-06-09, remediation session)

**Status update 2026-06-09 (later session): PRs #595, #596, #597, #598 (+#600 pricing page) are all squash-merged to main and deployed (run 27239108944 green: rules→indexes→storage→functions→hosting). Each fix artifact-verified in served prod content; ledger FAIL rows flipped to FIXED. Behavioral round-trips pending (Chrome tab-grouping unavailable that session) — checklist in `documentation/qa/remediation-2026-06-09/REMEDIATION-LOG.md`.**

Seven Tier A bugs fixed on two branches off `origin/main`, each confirmed by a parallel investigation pass + a 4-lens adversarial review, and verified (smoke 1819/0, theme-qa 2686/0, firestore-rules incl. cross-tenant 56/0, JS syntax sweep).

**PR #595** (client JS, pure hosting deploy) — https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/595
- **NEW-1** (d2-home-011/029) — CSP-dead widget handlers → CSP-safe change/input/keydown delegation.
- **CO-M-1** (d3-pipeline-001) — search HTML leak → TreeWalker text-node highlighter.
- **NEW-2** (d7-settings-020/021) — Profile digest/dormant round-trip → `_loadProfileSettings` + profile-tab hook. Root cause was a lazy `<template>` hydration timing bug, NOT the originally-logged "load always renders checked" mechanism.
- **NEW-4** (d7-settings-087) — North Star key mismatch → `dsSaveConfig` mirrors `nbd_ds_config`.
- **CO-L-1** (d2-home-020) — Quick-Add blank modal → real field ids + name split + aligned damage options.
- **NEW-C9** (d2-home-009/011/013/020) — in-card bubble → per-card nav bails on interactive targets.

**PR #596** (firestore.rules — auto-deploys rules on merge) — https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/596
- **NEW-5 + CO-H-5** — the `leads` update/delete rule `request.auth.token.role != 'viewer'` THROWS on an absent role claim → PERMISSION_DENIED for every no-role owner (ALL lead update/delete/move/restore, not just bridged leads). Fix: `request.auth.token.get('role','')`. Emulator-verified before/after + a new regression test; cross-tenant isolation unaffected. **This rule bug is the true root cause of BOTH NEW-5 and the carryover HIGH CO-H-5** — original NEW-5 "bridge re-sync" hypothesis was refuted.

Deferred (flagged for Jo): NEW-2 dead Company/Phone/Role/License fields (wiring needs a product decision — Company overlaps Company Profile); NEW-4 'Other' category fallthrough (byte-parity w/ daily-success bridge); pre-existing booking-link unescaped URL.

---

## Carried-over open bugs (verify still present before remediating)

### BLOCKER

**CO-BILLING-B1 — Crew price mismatch: marketing $299 vs live Stripe $249**
Pricing page asserts Crew $299/mo, but live `STRIPE_PRICE_PROFESSIONAL` is $249 — a customer clicking "Start Crew" is charged $249 while promised $299. Gates PR #579.
*Likely:* `docs/pro/pricing.html` copy + meta/JSON-LD/FAQ/Terms; functions `STRIPE_PRICE_PROFESSIONAL`. Decision pending Jo (align Stripe up, or rewrite copy down).
*2026-06-09 corroboration:* the in-app **Settings → Team** tab copy also states "**Growth tier ($249/mo, up to 5 reps)**" — so the app itself is internally inconsistent with the marketing "Crew $299". Align all three (marketing page, Team-tab copy, Stripe price).

**CO-BILLING-B2 — Per-seat billing ($39/seat Crew) not built**
Crew lists +$39/seat but no metered/quantity Stripe sub, no seat enforcement, no add/remove-seat UI. Gates public self-serve launch + PR #579.
*Likely:* Phase D (unbuilt) — `subscriptions/{companyId}`, base+per-seat Price, webhook, Settings→Billing seat UI. Needs Stripe test keys + amounts + Firestore backup gate first.

### HIGH

**CO-H-1 — Public lead → CRM bridge (RE-VERIFY FIRST)**
Originally: `/inspect` submissions emailed + Gmail-labeled but never surfaced in the CRM UI. Memory says the bridge shipped + was live-verified (`phase-cd-leadbridge-2026-06-08`). **Re-verify before treating as fixed:** submit a `ZZ_QA_` lead at `/inspect`, then confirm it appears in Pipeline/Prospects/Recent Activity.
*Likely:* `docs/pro/js/public-lead-submit.js` write target + crm read scope; public→tenant bridge function.

**CO-H-3/M-2 — Reports `loadReports` throws Firestore INTERNAL ASSERTION, poisons the session**
Insights → Reports logs `FIRESTORE INTERNAL ASSERTION FAILED: Unexpected state` (×2); subsequent Firestore ops on the same SPA session then fail (e.g. `loadNotifications` onSnapshot) until a full reload. Silent (page uses preloaded `window._leads`).
*Likely:* `rep-report-generator.js listSavedReports` (:2098) + `dashboard-bootstrap.module.js _loadReports` (:2783); firebase-js-sdk async-queue bug, maybe WebChannel-provoked.

**CO-H-5-rules — Deployed firestore.rules stale vs repo (owner write path)**
Owner lead move/edit/delete was denied in prod though the repo `leads` rule is `isOwner`-based and would allow it → deployed ≠ repo. JD's claims were backfilled manually as a stopgap; future solo operators will hit the wall.
*Likely:* re-deploy current `firestore.rules`; reconcile with `onRepSignup` (undeployed, GCIP gap). **Rules/IAM = devops; Claude must not run the IAM grant.**

**CO-BLEED-O2 — NBD navy bleeds onto Oaks microsite**
Oaks pages under `/sites/oaks/` paint NBD navy `#142a52` as `<html>` background (should be Oaks dark). Plus O3 (shared NBD canonical/og), O4 (Oaks accent == NBD orange), O-N1 (Oaks /contact map broken).
*Likely:* `docs/assets/css/nbd-mobile.css:43` + Oaks `<head>`. Public Oaks bleeds were out of scope of the multi-tenant docgen build.

### MEDIUM

**CO-M-1 — Pipeline search leaks raw HTML into matching lead cards — ✅ CONFIRMED LIVE 2026-06-09 (more severe than logged)**
Searching `#crmSearch` (term "co") corrupted **all 11 matching cards**: leaked markup rendered as literal text — `content:space-between;margin-bottom:4px;gap:6px;flex-wrap:wrap;">`, `COLOR:#CAB8FF;BORDER-COLOR:RGBA(155,108,255,0.45)`, `TITLE="SNOOZED UNTIL TOMORROW">`, `data-action="card" data-id="…"`. Cards become near-unreadable while a search is active; clearing the box restores them. Search still *filters* correctly. *Likely:* `crm-pipeline.js` search-highlight runs on `innerHTML` and mangles existing badge/attribute markup — must highlight text nodes only (TreeWalker), never re-`innerHTML` the card. *Row:* d3-pipeline-001 (FAIL).

**CO-M-3 — Pro sidebar nav invisible in Brave (Chrome fine)**
Left sidebar renders blank in Brave (DOM intact, computed colors normal); survives hard-refresh/SW-unregister. Theme CSS-variable init vs Brave Shields.
*Likely:* add non-variable fallback color on `.sidebar`/`.ni`. **Needs a dedicated Brave pass — the Chrome-driven sweep cannot see it.**

### LOW

**CO-L-1 — Quick Add Lead discards typed name/address when opening the full modal — ✅ CONFIRMED LIVE 2026-06-09 (root cause found)**
Type name+address+damage in Quick Add → "Add →" → full Add Lead modal opens **blank** (all 30 fields empty; verified). Root cause: `_wQuickAddLead` (widgets.js ~:788) prefills `#leadName` / `#leadAddr` / `#leadDamage`, but the actual modal field ids are **`#lFname` / `#lAddr` / `#lDamageType`** — a stale field-id mismatch, so the prefill silently writes to non-existent elements. *Fix:* update the prefill target ids (and split name → lFname/lLname). *Row:* d2-home-020.

**CO-L-2 — Customer timeline "Invalid Date" on Lead-created entry**
Fresh lead → Customer → Timeline → "Lead created · Source Unknown · Invalid Date". Likely serverTimestamp not yet materialized.
*Likely:* `customer.js` timeline date formatting on an unresolved Firestore Timestamp.

**CO-H4-followup — `saveCustomTheme` button references a window fn that doesn't exist**
From the H-4 allowlist fix follow-up: the custom-theme save button calls a `data-fn` not defined on `window`. Also audit other standalone `/pro/` pages for the same allowlist gap.
*Likely:* theme custom-builder save handler + `_NBD_CALL_ALLOWLIST`.

---

## NEW findings (this exhaustive sweep)

Format: `NEW-<n> — <sev> — <title>` · repro · likely file · ledger row id(s) · evidence.

### Candidates from Phase-0 gap-fill static analysis (NOT yet live-verified — confirm before remediating)

**NEW-C1 — HIGH (candidate) — PWA mode patches `window.confirm` to always return `true`, bypassing destructive cancel gates**
`standalone-compat.js:154` overrides `window.confirm` to always resolve true when running as an installed PWA. Account deletion ("Permanently Delete My Account", `_gdprRequestErasure`, `dashboard-api.js:382`) and `customer.html` photo delete (:7039) both gate on a *native* `window.confirm` → in PWA mode the user cannot cancel; "Cancel" still proceeds. *Verify:* install the PWA, trigger account-delete, click Cancel → does it still delete? *Rows:* gap-deleteconfirm-001..008, customer photo-delete. **Drive to boundary only; do NOT confirm account deletion on the real account.**

**NEW-C2 — MEDIUM (candidate) — Close Board: edit/delete deal unwired + insurance-toggle listener goes dead after tab round-trip**
`close-board.js`: `updateDeal`/`deleteDeal` exist on the API but no Edit/Delete control is rendered on deal cards; the New-Deal insurance toggle's change listener is bound once in `init()` via `setTimeout`, not re-bound on `render()`, so it may stop revealing carrier/deductible fields after switching tabs and back. *Rows:* gap-storm-cb-repos-011..024.

**NEW-C3 — MEDIUM (candidate) — Storm Analytics counters always zero**
`storm-center.js`: `knockCount`/`leadCount` are never incremented, so Storm Analytics always shows zeros regardless of activity. *Rows:* gap-storm-cb-repos-001..010.

**NEW-C4 — LOW (candidate) — destructive actions with no confirmation**
Dashboard task-list delete (`removeTask` → `deleteDoc`, no confirm) and `clearAllNotifications` (immediate dismiss to localStorage, no confirm). *Rows:* gap-carddetail (task ×), gap-deleteconfirm-013.

**NEW-C5 — LOW / TEST-HAZARD (candidate) — CRM Diagnostic panel writes live data**
CRM Diagnostic panel (dashboard.html:8993): "Load Sample Data" writes demo leads into the real `leads` collection; "Test Rules" writes+deletes a `_test` lead and may leave a stray on a rule-block. *Do not exercise these on the live tenant without cleanup.* *Rows:* gap-prospects (diagnostic buttons).

**NEW-C6 — LOW (candidate) — Rep OS tel: link regex double-escaped**
`rep-os.js` follow-up `tel:` href uses a double-escaped `\\D` digit-strip regex — verify the phone digits actually strip. *Rows:* gap-storm-cb-repos-025..035.

**NEW-C7 — MEDIUM (candidate) — "Team Manager" admin nav stays hidden for a company_admin**
`#nav-admin` (Team Manager / admin view) is `.dn`-hidden in static HTML and only un-hidden by JS for admin/manager role — but it remained hidden in JD's live session, though JD is `company_admin` (per `set-jd-claims`). The admin un-hide didn't run for this admin. *Verify:* does `goTo('admin')` reach the view directly? Is the role/claim read at the time the nav renders? *Likely:* nav role-gate vs claim-load timing. *Row:* d1-chrome-065. (May relate to CO-H-5 claim/rules staleness.)

**NEW-C8 — LOW (candidate) — Appearance picker labels "NBD Default" active while applied theme is `ios`**
Opening the theme picker showed header + footer "Active: NBD Default", but `html[data-theme]` was `ios` (Jo's actual saved theme). Possible picker active-state desync (memory says PR #568 addressed picker sync — re-verify it holds). *Verify during d7 Appearance:* open picker on a non-default saved theme → does it highlight the correct active swatch? *Row:* d1-chrome-021 / d7 appearance.

**NEW-C10 — MEDIUM (candidate) — Settings → Team member row stuck on "Loading…"**
On the Team tab, the owner's own member row (JD) renders **"JD … Loading…"** and never resolves to the member's details — a pending Firestore team-member fetch that doesn't complete. Also kept the page off `document_idle` (hung the CDP tooling until reload). *Verify:* open Settings → Team in a normal session, does the member row ever populate? *Likely:* team-members load (`dashboard-bootstrap`/admin-manager) query/permission; may relate to the same claim/rules staleness as CO-H-5. *Row:* d7-settings Team tab (007 + member rows).

**NEW-3 — ✅ RESOLVED / FALSE POSITIVE (2026-06-09) — Settings → Estimates tier-rate DOES take effect**
Initial suspicion: changing Better $/SQ persisted in the Settings store but the engine config `nbd_est_settings_v2.tierRates.better` stayed 595 → looked decoupled. **Refuted by a real estimate build:** with the Better rate set to 999, a Cash/retail Better estimate (3000 SF / 6-12 / Hamilton) produced **GRAND TOTAL $37,950** vs the documented **$22,925 at rate 595** → the rate **does** drive pricing. Root of the red herring: `nbd_est_settings_v2.tierRates` is a **stale LS cache**, not the engine's runtime source; the engine applies the saved rate at calc time. **No bug.** (Also re-verified the estimate canonical total: $22,925 Better-retail @595.)

**NEW-C11 — ✅ RESOLVED / NOT A BUG (2026-06-09) — empty Company Profile letterhead falls back to the tenant brand**
Verified at doc-gen: `NBDDocGen.COMPANY` (resolved) is populated from the tenant brand — name "No Big Deal Home Solutions", phone (859) 420-7382, email info@…, website nobigdealwithjoedeal.com — and a generated Contract renders that letterhead. So the empty Company-Profile letterhead fields are **optional overrides**, not a blank-doc bug. (Minor: resolved `address` + `license` are still empty even after fallback — cosmetic.) _Original concern below, for reference:_
**~~Company Profile letterhead fields are all empty~~**
Settings → Company Profile: the legal/payment/warranty clauses are populated, but the **letterhead fields are blank** — `cp_businessName`, `cp_businessPhone`, `cp_businessEmail`, `cp_businessWebsite`, `cp_businessAddress`, `cp_businessLicense` all `""`. `companyProfile/main` is the shop-wide doc-gen source. *Verify:* generate a Proposal/Contract → does the letterhead populate from the tenant brand fallback, or render blank/missing? If blank → customer-facing docs ship with no business name/contact in the header (real problem). If a brand fallback fills it → not a bug (these fields are optional overrides). *Rows:* d7-settings-114..119 area. (Test during d5-docs.)

**NEW-C12 — LOW (candidate) — Settings → Help "Hotkey Toggles" section renders no toggles**
The Help tab's "HOTKEY TOGGLES" section shows its header + description ("Toggle individual keyboard shortcuts on or off…") but **zero toggle controls render** (toggleCount 0). Either the feature is unbuilt/empty or the toggles fail to inject. *Verify + either populate or remove the section.* *Row:* d7-settings (Help panel).

**NEW-C13 — LOW/MEDIUM (candidate) — Settings → Billing: plan status stuck "Loading…" + "Manage Subscription" goes to pricing page, not a billing portal**
Billing tab shows **"Current Plan: Loading… — Checking subscription"** that doesn't resolve (same async-stall family as NEW-C10's Team "Loading…"). All three buttons (View All Plans / **Manage Subscription** / View pricing) link to `/pro/pricing.html` — there's **no in-app subscription management / Stripe billing portal** (consistent with BILLING-B2 per-seat billing unbuilt). *Verify:* should "Current Plan" resolve to the actual plan, and should "Manage Subscription" reach a Stripe customer portal? *Rows:* d7-settings-008 + billing controls.

**NEW-5 — MEDIUM (CONFIRMED LIVE) — Bridged public leads can't be deleted from the CRM**
A lead created via the public `/inspect` form (`publicLeadCollection: "inspect_leads"`, `webLead`, `publicLeadId`) **cannot be removed via the CRM delete flow** — overflow → Delete lead → `#delConfirmOverlay` → confirmDeleteLead all fire (verified each step), but the lead **persists in the pipeline** (count unchanged, lead still present), reproduced twice. Likely the bridge re-syncs the CRM copy from `inspect_leads/<publicLeadId>` (public record is source-of-truth), OR webLead deletes hit a rules path that silently fails. **Impact:** spam/duplicate/test public leads can't be cleared from the pipeline by the operator. *Verify:* does deleting also require removing the `inspect_leads` source record? Should the CRM delete tombstone the public record? *Likely:* the public→CRM bridge function + `_deleteLead` interaction. *Row:* d3-pipeline delete on a webLead.

### Confirmed this sweep (live)

**NEW-4 — MEDIUM (CONFIRMED LIVE) — Daily OS "North Star" saves to one key but the Home widget reads another → never displays**
Settings → Daily OS → set **Target/Goal** (`#ds-target`) → Save Daily Program ("Daily Program settings saved") → the value persists to **`nbd_user_config.northStar.target`**. But the **Home North-Star widget reads `nbd_ds_config.northStar`** (a different, legacy key that stays `""`), so after reload the widget **still shows the placeholder "Set your North Star in Settings → Daily OS"** — the saved North Star never appears. Classic save-but-no-effect via a localStorage **key mismatch** (`nbd_user_config` vs `nbd_ds_config`). *Fix:* point the Home north-star widget (`widgets.js`) at `nbd_user_config.northStar.target`, or have `dsSaveConfig` write both keys. *Likely also affects* the Daily Floors widget if it reads `nbd_ds_config.floors` while the config saves to `nbd_user_config.floors` — verify. *Row:* d7-settings-087 (FAIL).

**NEW-2 — MEDIUM (CONFIRMED LIVE) — Settings → Profile: email-pref checkbox doesn't round-trip (always renders checked on reload); + several Profile fields are dead**
Uncheck **Weekly Digest** (`#settingsWeeklyDigest`) → **Save Profile** (`_saveSettings`, toast "Settings saved!", no error) → **reload → checkbox is CHECKED again** (reproduced over 2 reload cycles). The save fires and writes `users/{uid}.weeklyDigestEnabled=false`, but the Profile **load always renders the checkbox checked** — it doesn't apply the saved value. So a user cannot reliably disable the weekly digest via the UI, and the displayed state can't be trusted (UI may show ON while persisted OFF). Same load path likely affects **Dormant-lead reminders** (`#settingsDormantNudge`, untested individually). *Likely:* the profile-populate code (`dashboard-bootstrap.module.js` ~2888 `_saveSettings` / the profile loader) sets the checkboxes to a hardcoded default instead of reading `weeklyDigestEnabled`/`dormantNudgeEnabled`. *Rows:* d7-settings-020 (FAIL), 021.
*Related (inventory-flagged, not individually live-tested):* Profile **Company (014), Phone (015), Role (016), License (017)** are placeholder/display-only — **not read by `_saveSettings`** (it only persists displayName/calcom/digest/dormant). Editing them does nothing. Confirm + either wire them up or remove them.

**NEW-1 — MEDIUM-HIGH (CONFIRMED LIVE) — CSP blocks inline `on*` handlers in dashboard widgets → Task-checklist completion + Widget-Library toggles are dead (look fine, do nothing)**
`/pro/dashboard` ships CSP via HTTP header with no `unsafe-inline` in `script-src`, so **inline event handlers never execute** (proven: an injected `<button onclick="window.__x='FIRED'">` left the flag `not-fired`). `widgets.js` renders widget HTML via `innerHTML` with inline handlers, so those controls are dead:
- **Task Checklist complete-checkbox** (`onchange="window._wToggleTask(idx,this.checked)"`): the checkmark flips visually but `nbd_home_tasks[idx].d` never updates → checking off a task does **not** persist (survives reload as unchecked). Row **d2-home-011** (FAIL).
- **Widget Library add/remove toggles** (`onchange="window.NBDWidgets.toggleWidget(id,this.checked)"`): checkbox flips visually but `nbd_home_widgets` is unchanged → the picker **cannot add or remove widgets**. Row **d2-home-029** (FAIL).
- Likely same defect (not yet live-confirmed): Quick Estimate widget number inputs (`oninput="_wQuickEst()"`, d2-home-033) and Ask Joe widget input (`onkeydown` Enter, d2-home-035).
- Delegated `data-w-action` buttons (addTask, removeWidget, resetDefaults, quickAddLead, etc.) are **unaffected** and work.
*Repro:* Home → Task Checklist → check any task → reload → it's unchecked again. / Home → Customize → toggle any widget → grid doesn't change.
*Likely file:* `docs/pro/js/widgets.js` render templates (≈ lines 301, 315, 382, 709) — convert inline `on*` to delegated `data-w-*` handlers. The PR #464/#468 onchange/onclick sweeps fixed **static** `dashboard.html` but missed **runtime-rendered** widget HTML in `widgets.js`.

**NEW-C9 — LOW — Home-widget in-card action controls bubble to the card's `goTo` navigation (missing `data-w-stop`)**
Inner controls on Home widget cards lack `stopPropagation`/`data-w-stop`, so clicking them ALSO fires the card's whole-card `goTo` nav → the user is bounced to `/crm` after the action. Confirmed on the Revenue **goal ✎** (d2-home-009 → navigates to crm after the prompt) and the task checkbox (011). Likely also the add-task **+** (013) and Quick Add **ADD** (020). The action's data still saves (where its handler works); the unwanted navigation is the bug. *Likely file:* `widgets.js` — add `data-w-stop='1'` to inner interactive elements. *Rows:* d2-home-009/011/013/020.

---

## 2026-06-09-B verify-sweep session — behavioral verification + new d5-docs findings

**Behavioral verification of the deployed fixes: ALL 8 checklist items PASS in-browser** (normal Chrome window; full round-trips with reloads; all real settings restored). NEW-1 (both halves), NEW-2, NEW-4, CO-M-1, CO-L-1/NEW-C9, NEW-5 (fresh /inspect bridge → delete → stays gone), NEW-C10, NEW-C13, NEW-C12 are **fixed and verified working live**. Ledger rows annotated (session `2026-06-09-B`).

### New findings (d5-docs deep pass)

**NEW-D1 — HIGH — Template-library Invoice / Change Order / Contract previews are BLANK in Chrome (server-PDF cross-origin iframe, PR #594 rule violated)**
These 3 types sit in `SERVER_TYPE_MAP` and, with no signers (the template-library path never sets `data.signers`), `generate()` takes `_tryServerRender` → the rendered PDF's `storage.googleapis.com/...pdf-renders/...` URL is set as **`nbdv-iframe.src`** → Chrome renders **"This page has been blocked by Chrome"** (sandbox without `allow-same-origin` + cross-origin PDF). The viewer chrome (title/filename/footer) looks normal; the document area is blank. The other 20 types render fine as sandboxed srcdoc (86–98KB). **Impact:** the 3 most customer-critical docs (contract!) preview blank from Templates. *Fix direction:* per the PR #594 rule — server-PDF results must NOT be iframed; show the srcdoc HTML preview and offer the server PDF via Download only (or add a same-origin proxy). *Likely:* `document-generator.js generate()` server-render branch / `_tryServerRender` viewer handoff. *Rows:* d5-docs-011/018/019 (FAIL). Side effect: each attempt still uploads a `pdf-renders/` artifact + burns a server render.

**NEW-D2 — HIGH — "Save to Customer" from the Template Library is a silent no-op that toasts "✓ Document saved" (lead context dropped)**
`_docgenSubmit` assembles `data` from fill-field values only — **it never sets `data.leadId`** from the "Auto-fill from Lead" select — so `_leadIdEarly` is always null on this path: `_persistPromise` never runs, nothing is written to `leads/{id}/documents` or Storage (verified live: subcollection empty after lead-selected generates), and the e-sign button can never appear. Clicking **Save to Customer** then runs a no-op `onSave` and `handleSave` still toasts **"✓ Document saved"**. **Impact:** users generating docs from Templates believe docs are attached to the customer; they aren't. *Fix direction:* thread the selected lead id through `_docgenSubmit` → `data.leadId`; make `handleSave` toast reflect whether a persist actually happened. *Likely:* `document-generator.js` (`_docgenSubmit`, `generate()` persist guard) + `nbd-doc-viewer.js handleSave`. *Row:* d5-docs-046 (FAIL); explains d5-docs-050..053 BLOCKED.

**NEW-D3 — LOW — "Blank" print button missing while header copy still references it**
`#/docs` header says "Use the **Blank** button to print an empty copy for hand-fill", but **no Blank button exists anywhere in the DOM** (zero buttons inside `.tl-doc-row`). Either restore the control or fix the copy. Also makes the standalone doc-action-bar window unreachable. *Rows:* d5-docs-034 (FAIL), 054/055 (BLOCKED).

**NEW-D4 — LOW — `dsSaveConfig` mirror writes the focus *category* as the legacy `northStar` when the target is empty**
Phase-1 behavioral check of NEW-4: saving Daily OS with an **empty** target sets `nbd_ds_config.northStar = "Roofing Sales"` (the category string), so the Home widget headline shows "ROOFING SALES" instead of the set-your-north-star placeholder. Cosmetic; empty target should mirror as `""`. *Likely:* `dsSaveConfig` mirror in `dashboard-bootstrap` (PR #595). 

**Tooling notes (not bugs):** html2pdf Download-PDF rasterization keeps the renderer busy 45s+ on an 89KB doc (CDP times out; user likely sees multi-second jank — borderline perf item). The `pdf-renders/` Storage artifacts from NEW-D1 repros (3–4 objects, 2026-06-09/10) can be purged.

### New findings (d8-tools deep pass)

**NEW-D5 — HIGH — Product Library (#/products) is 100% dead chrome (no delegate + CSP-dead inline inputs) — FIX OPEN: PR #607**
`product-library.js` renders every control with `data-pl-action` attributes, but **no data-pl-action click delegate exists on the dashboard** — the only one in the codebase is in `landing-page.js` (landing's own goRegister/toggleFAQ actions; naming collision, not loaded on dashboard). Additionally the search input (~:324) and product-modal pricing inputs (~:423/427/442) use inline `oninput="window._productLib…"` which CSP blocks. Verified by REAL clicks on prod: tier filter, category chips, search ("fence" → no change), Add Product, Export CSV, category collapse — all no-ops. `window._productLib` exposes the full method API (21 methods) — only the wiring is missing. **Impact:** can't search/filter/add/edit/archive/export products; the view is a static pricing reference only. *Fix:* CSP-safe delegated click (typeof-method guard against the landing collision) + delegated input. *Rows:* d8-tools-087..096 (FAIL). **Task chip spawned** (Jo already started the first Products-only chip; a second chip covers Products+Training).
*Fix status (2026-06-09, PR #607 `fix/tools-views-event-wiring`):* document-scope `data-pl-action` click delegate through `window._productLib` (typeof guard against the landing collision) + delegated `input` handler (search keeps focus/caret across the re-render; modal sell/cost/labor margin recalc); dead inline `onmouseenter/onmouseleave` card hover → `.pl-card:hover` CSS; latent `saveFromModal` toast bug fixed (read `editingProduct` after `closeModal()` nulled it → every edit toasted "Product added"); `script-loader.js` bumps `product-library.js?v=3`. **27/27 harness assertions green** (real scripts in bundle order, real bubbling events: add→edit→archive round-trip on a ZZ_QA product, CSV export, reset-cancel boundary, search focus-restore, tier/category filters, accordion). Re-verify live on prod post-merge.

**NEW-D6 — MEDIUM-HIGH — Academy course modules never expand → all lessons/quizzes unreachable — FIX OPEN: PR #606**
`renderCourse()` (real-deal-academy.js) renders `.rda-collapsible-header` module accordions and auto-expands the first via `.click()`, but never attaches a click handler in the course view (the collapsible wiring at ~:1332 only covers the tree-node modal) → no module can expand; lessons, mark-complete, and quizzes are unreachable from the Courses catalog. Handlers themselves verified working via direct invocation (lesson view, mark-complete, quiz grading, back-nav all PASS). **PR #606** (fix/academy-module-accordion, 9 lines, smoke 1825/0) adds the same toggle wiring the in-file modal uses. *Rows:* d8-tools-102..107.

**NEW-D7 — HIGH — Sales Training (#/training) is 100% dead chrome (no listeners at all) — FIX OPEN: PR #607**
`sales-training-ui.js` renders 15 `data-st-action` controls (rapid-fire START, My Profile, scenario cards, options, answers) and contains **zero `addEventListener` calls** — no delegate, no public API object (only `window._SalesTrainingState` exported), so the fix delegate must be installed inside the IIFE where the handlers are in scope. Verified by real clicks: My Profile + scenario cards are no-ops. **Impact:** the whole training feature is non-functional. *Rows:* d8-tools-097..101 (FAIL). Covered by the spawned Products+Training task chip.
*Fix status (2026-06-09, PR #607 `fix/tools-views-event-wiring`):* document-scope click delegate installed inside the UI IIFE, dispatching `data-st-action` to the engine actions the engine publishes on `window._SalesTrainingState` (`advance` → `advanceAfterFeedback`; option indexes coerced to `Number`; typeof guard + warn on unknown action, d2d delegate house pattern); `script-loader.js` bumps `sales-training-ui.js?v=2`. Harness-verified: profile open/back, scenario open→option→feedback→advance, rapid-fire start→answer→next→exit (all green, zero console errors). Re-verify live on prod post-merge.

**NEW-D8 — LOW/MEDIUM — `academy_progress` has no firestore.rules block → cross-device academy sync silently dead**
`real-deal-academy.js` mirrors progress to Firestore `academy_progress/{uid}` via setDoc(merge), but there is **no rules match for academy_progress** (grep: zero hits in firestore.rules) → owner reads AND writes are permission-denied; the catch silently console.warns. Progress therefore persists only in localStorage (per-browser). *Fix:* owner-only rules block (`allow read, write: if request.auth.uid == uid`) — rules change, gated deploy, NOT done inline. *Row:* d8-tools-105 note.

**NEW-D9 — LOW (candidate) — D2D date-filter pills may be a no-op**
Feed pills Today/Week/Month/All all yielded identical item counts (25) when cycled; either the probe counted unfiltered feed entries or `setDateFilter` doesn't filter. Needs a data-shape check (knock timestamps span multiple days, so counts should differ). *Row:* d8-tools-121 (BLOCKED).

### New findings (d9-insights + storm/closeboard/repos deep pass, same session cont.)

**NEW-D13 — HIGH — Close Board share links have NEVER worked (storage rule blocks text/html) — FIX OPEN: PR #610**
`close-board.js uploadDealPage()` uploads the shareable deal page to Storage `deal_rooms/{uid}/{dealId}.html` as `text/html`, but the `deal_rooms` storage rule gates writes on `isDocType()` which does NOT match text/html → every upload is `storage/unauthorized` (verified live, console captured). So 🔗 Copy ("Could not generate link"), 📱 Text ("Upload failed — share manually"), and 📧 Email (compose opens but link-less) all fail — the product's core "one link to close" flow is dead. Preview works (in-page viewer). **PR #610** switches the gate to `isHtmlOnly()` (the `documents/` pattern) + 3 storage-rules test cases. *Rows:* d9-insights-046/047/048, gap-storm-cb-repos-021/022/023 (FAIL).

**NEW-D11 — MEDIUM — Saved reports can't be deleted (rules deny owner delete; UI fails silently) — FIX OPEN: PR #609**
My Reports renders a 🗑 for every owner; `deleteSavedReport` confirms "This cannot be undone", calls `_deleteReport` → `deleteDoc(reports/{id})` → PERMISSION_DENIED (`allow update, delete: if isAdmin()`), returns false, and the UI's `if (ok)` swallows it — no toast, report stays. **PR #609**: owner-scoped delete + error toast + rules regression test (case 24). *Rows:* d9-insights-028, gap-storm-cb-repos-053 (FAIL).

**NEW-D12 — MEDIUM — Storm Center map is a gray void: Esri-primary tiles load 0/12 even in Chrome**
`storm-center.js:618` still uses `server.arcgisonline.com` World_Imagery as the ONLY tile layer — the PR #486 rule (Google `mt{s}` primary + Esri tileerror fallback, because Brave hard-blocks arcgisonline) was never applied here. Live check: 12 tile imgs, **0 loaded** — the map pane renders as a uniform gray void in Chrome too (alert/zone markers float on nothing). *Fix:* same tile stack as the D2D map. *Row:* map pane observed across all storm tabs.

**NEW-D14 — MEDIUM — `deal_rooms` Firestore collection has NO rules block → the deal "backup" sync layer is entirely dead, deals are localStorage-only**
`syncDealToFirestore` setDocs to `deal_rooms/{dealId}` on every create/update, but firestore.rules has no deal_rooms match → default deny for create/read/delete (verified: owner read + delete both PERMISSION_DENIED). Net effect: Close Board deals live ONLY in `nbd_deal_rooms` localStorage (single browser, no recovery), while the code pretends to back them up. Also `deleteDeal()` never deletes the Firestore copy even where it could. *Fix direction:* add an owner-scoped deal_rooms rules block (and make deleteDeal clean up), or drop the dead sync. *Row:* d9-insights-044 note.

**NEW-D15 — MEDIUM — Ask Joe "⚡ Scenarios" button is permanently dead on #/joe**
`openDecisionPicker` requires `window.DecisionEngine`, but `decision-engine.js` only lazy-loads via ScriptLoader for the `aitree`/`understand` views — it is never loaded on #/joe, so the button error-toasts "Decision engine loading..." forever (real click + direct call verified: nothing renders). *Fix direction:* have `openDecisionPicker` lazy-load the `decision` bundle (ScriptLoader) before calling `DecisionEngine.openPicker()`. *Row:* d9-insights-010 (FAIL).

**NEW-D10 — LOW/MEDIUM — Generated report's funnel chart renders blank in the viewer**
The Pipeline Health report renders real data in all CSS-bar sections, but the "Your Pipeline Shape" funnel-chart box is an empty white area (waited + scrolled; never paints). Likely the chart script can't execute/load inside the sandboxed srcdoc iframe. Print/PDF presumably inherit the blank box. *Row:* d9-insights-026 note.

**NEW-D16 — LOW — Ask Joe "New Chat" doesn't clear the transcript (+ greeting says "Hey the —")**
NEW CHAT appends a fresh greeting UNDER the existing conversation instead of resetting the thread. Separately, the greeting renders "**Hey the** — I've got eyes on your pipeline…" — a broken name interpolation. *Row:* d9-insights-011 (FAIL).

### New findings (customer.html deep pass, 2026-06-10 cont.)

**NEW-D19 — HIGH — customer.html "Log Estimate" has NEVER saved (missing userId vs create rule) — FIX OPEN: PR #611**
`saveEstimate` writes `/estimates` without a `userId` field, but the create rule requires `request.resource.data.userId == request.auth.uid` → every save alerts "Failed to save estimate. Please try again." (console: permission-denied, reproduced on a ZZ_QA lead). `loadEstimates` already queries `leadId+userId`, so reads were fine. **PR #611** stamps userId on the payload. *Rows:* customer-114 (FAIL), 116–118 + 045–048 (BLOCKED until fixed).

**NEW-D18 — MEDIUM-HIGH — customer.html "Inspection Reports" panel fails on EVERY page load (rules-incompatible query) — FIX OPEN: PR #611**
`window.loadReports` queries `/reports` by `leadId` + `orderBy(date)` with no userId clause; the owner-scoped read rule denies any query that can't prove ownership → "⚠️ Failed to load reports" on every customer page (console captured). **PR #611** adds the userId equality clause + client-side date sort (avoids a composite index). *Row:* the reports panel (082–085 family).

**NEW-D20 — MEDIUM-HIGH — Portal message reply always fails "Error: Unauthenticated"**
The rep-side reply box calls the `replyToPortalMessage` callable with `{leadId, text}`; it rejects the signed-in OWNER with `unauthenticated` (status element shows "Error: Unauthenticated", reproduced twice on a ZZ_QA lead). Either the page's `getFunctions()` instance isn't carrying the auth context or the function's auth check is wrong — two-way portal chat is rep-side dead either way. *Likely:* customer.html ~:8530 (httpsCallable wiring) vs functions `replyToPortalMessage` auth guard. *Rows:* customer-087 (FAIL), 086 PASS.

**NEW-D17 — LOW/MEDIUM — customer.html panels don't refresh after their own saves (data persists; UI stale until reload)**
Pattern confirmed across three independent saves: Edit Customer (header JOB VALUE stays stale), Job Costs & Profit (totals stay stale after Save Costs), Insurance Claim Workflow (stage label stays stale after Advance). All three persist correctly (verified across reload) — only the in-page re-render is missing. Timeline appends (notes/tasks) DO render live, so it's panel-specific. One refresh hook per panel save would close all three. *Rows:* customer-010/136/145/146 notes.

**NEW-D21 — LOW (candidate) — "Review & Sort" photo link renders with an empty id (`photo-review.html?id=`)**
On a lead with no photos the href has no lead id at all → clicking navigates to photo-review without context. Verify whether the id populates once photos exist; as rendered it's a broken nav. *Row:* customer-052 (FAIL).

_Also re-confirmed on a fresh lead: CO-L-2 ("Invalid Date" on the Lead-created timeline entry) did NOT reproduce — timeline dates render correctly._

### New finding (gap-carddetail pass, 2026-06-10 cont.)

**NEW-D22 — MEDIUM — Card-detail Tasks: per-task DELETE (×) is a no-op that freezes the renderer**
In the lead card-detail → Tasks modal, the per-task **×** button (`data-tk-action="removeTask"` → `removeTask()` in `tasks.js:194`) does not remove the task: real AND synthetic clicks both leave the task present across full reloads, and the click wedges the renderer (CDP 45s timeout). Yet a direct `deleteDoc(leads/{id}/tasks/{tid})` succeeds immediately (rules allow it — that's how the QA task was cleaned up), and the sibling checkbox toggle (`checkTask`) works + persists. So the bug is in `removeTask`'s UI path — `await _deleteTask(...); renderTaskList(await _loadTasks(...))` — most likely `_loadTasks`/`renderTaskList` hangs (or `removeTask` throws before the delete). *Likely:* `tasks.js` `removeTask`/`_deleteTask`/`_loadTasks`. *Row:* gap-carddetail-033 (FAIL). (Note: this is the card-detail Tasks modal — distinct from the customer.html timeline task checkbox, which works.)

### New findings (pages-b / portal pass, 2026-06-10 cont.)

**NEW-D23 — P1 — Strict `**` CSP killed 5 standalone pages (homeowner portal hard-down) — FIXED: PR #619 (interim CSP exception) + PR #620 (extraction, final)**
The global `**` CSP (firebase.json) has no `script-src 'unsafe-inline'`, so every page still booting from an inline `<script>` IIFE silently died: **/pro/portal** (homeowner portal — `loadView()` never ran, every homeowner saw "Loading your project..." forever; the 06-10 Firestore 503 outage masked it because the symptom was identical), **/pro/estimate-view** (remote estimate view — token fetch never ran), **/pro/refer** (referral landing — form never wired), **/pro/demo** (`.reveal{opacity:0}` sections stayed invisible), **/pro/codex** (inline redirect never fired → stuck on "Redirecting..."). Only `/pro/customer` had the per-route exception. Diagnostic tell: ZERO network calls + ZERO console errors + complete HTML = refused inline script. **#619** mirrored the customer exception for the 4 pages + meta-refresh for codex (+ KNOWN_UNSAFE_EXCEPTIONS guard update); **#620** (spawned chip, Jo ran it) extracted the inline scripts to external js/ files and dropped the exception again. Both MERGED + DEPLOYED 2026-06-10. *Note:* `/admin/project-codex.html` + `/admin/vault.html` also ship inline `<script>` blocks under the same strict CSP — admin is out-of-sweep-scope; flagged for Jo. *Rows:* portal surface (all), pages-b-045–048 (demo), pages-b-038–044 (refer).

**NEW-D24 — MEDIUM — how-to "▶ Restart Tour" is a no-op for any user WITH leads — FIX OPEN: PR #621**
The button removes `nbd-onboarding-complete` and navigates to the dashboard, but `onboarding-tour.js maybeAutoStart()` only starts the tour when `leads.length === 0` — with data it hits the has-leads branch and silently RE-SETS the complete-key. Round-trip proven live (LS key back to "1", no overlay, 22 leads). **#621** adds a one-shot `nbd-tour-force` LS flag set by how-to.js and consumed by maybeAutoStart → `start(true)`. *Row:* pages-b-049 (FAIL→FIXED when #621 lands).

**NEW-D25 — MEDIUM-HIGH (open) — Failed login with remember-me unchecked silently downgrades an EXISTING session to session-persistence**
`login.js doLogin()` (~line 109) runs `setPersistence(auth, browserSessionPersistence)` BEFORE `signInWithEmailAndPassword` whenever remember-me is unchecked. `setPersistence` migrates the CURRENT user's persisted session — so an already-signed-in user who visits /pro/login and merely ATTEMPTS a login (even a failed one) gets their durable session converted to session-only; it evaporates on the next browser/tab close. Live repro: the QA browser's signed-in session was lost this way (bogus-credentials error-path test). Fix direction: redirect already-signed-in users away from /pro/login, or defer the persistence change until after a successful sign-in (re-auth with the chosen persistence), or snapshot/restore persistence on failure. *Row:* pages-b-009 note.

**NEW-D26 — HIGH — Portal card senders all threw ReferenceError (TOKEN undeclared; repName out of scope) — FIXED: PR #622 + PR #624**
Once NEW-D23 let the portal boot, every interactive send crashed: photo upload/message/rating/callback/audit POST `token: TOKEN` with TOKEN never declared (live: "Network error: TOKEN is not defined") — **#622** declares `const TOKEN = getToken().trim()`. Then callback's SUCCESS line (and rating thank-yous + incoming thread bubbles) referenced `repName`, a renderView local — POST succeeded but the homeowner saw "Network error: repName is not defined" with the button re-enabled (double-send bait) — **#624** hoists `let repName` to module scope. Both latent since the code was written: unreachable in prod while the whole script was CSP-dead. Post-deploy live-verified: upload "✓ → Got more? Upload another.", message bubble settles clean. *Rows:* portal-013 (FIXED), portal-021 (PASS), portal-025 (FIXED).

**NEW-D27 — HIGH — Homepage contact form's email path CSP-blocked: every submitter saw "Something went wrong" — FIXED: PR #623**
`submitForm` (assets/js/inline/72f02d79d0.js) POSTs to `https://formsubmit.co/jd@…` after the Firestore backup capture; formsubmit.co was missing from the `**` CSP connect-src, so the fetch was refused before the network (zero requests in the log) → catch path → alert "Something went wrong. Please call or text Joe directly…". The lead still reached Firestore via `_captureContactLead`→submitPublicLead (so Jo got lead-alerts), but the homeowner was told it failed and the formsubmit email never sent. **#623** adds formsubmit.co to the `**` connect-src pair only (per-page strict CSPs unchanged). *Row:* public-016 (FIXED; re-verify success panel post-deploy).

**INFRA-1 follow-up — PR #592 was OPEN, not merged (now MERGED 2026-06-10)**
The sw.js navigation-stall fix authored 2026-06-09 never landed; this session's recurring login/register/portal nav-wedges (head streamed, body never arrives, renderer frozen) were live INFRA-1. The stall disproportionately hits the `no-store` routes (login/register/dashboard/customer/portal) because they always stream the full document through the SW pipe; the `max-age=300` pages (leaderboard/analytics/ask-joe/how-to) mostly load fine. Merged #592 (squash 762a8ef1) → sw v30 (nav bypass + skipWaiting). QA-client workaround while v29 was live: unregister the /pro/ SW.

### New findings (static bug-class audit, 2026-06-10 — full report in `documentation/qa/static-audit-2026-06-10/`)

13 distinct defects, every one upheld by a 3-skeptic adversarial verification panel (one 2-1, rest unanimous). Fixed same-day: NEW-D28 (#628), NEW-D29 (#629), and the five small ones in #630. Open items below.

**NEW-D28 — P1 — /estimate AI estimate + /storm-check AI silently dead: workers.dev proxy CSP-blocked at the header — FIXED: PR #628**
The funnel's `submitAndGetEstimate()` (assets/js/inline/4053149b2f.js:817) and storm-check.js POST to `nbd-ai-proxy.jonathandeal459.workers.dev`. estimate.html's meta allowlists `*.workers.dev` (proving intent) but the global `**` header CSP never did — strictest-per-directive wins, the fetch is refused, and the catch path runs `buildFallbackEstimate()`: every homeowner got the generic size-table price + the canned "the live estimate engine couldn't reach me right now" apology. The graceful fallback MASKED the failure, which is why funnel QA passed. Panel note: on /estimate the AI call sits behind the Twilio-blocked OTP gate today, so the live manifestation is /storm-check; both unblock with the header fix. *Live re-verify once Twilio/OTP works.*

**NEW-D29 — P1 — Daily Success cloud sync has NEVER worked: rules-denied leaderboard write poisoned the atomic batch — FIXED (containment): PR #629**
`pushToFirestore()` batched the owner-allowed `users/{uid}/ds_pages` + `ds_meta/streaks` writes together with a `leaderboard/{uid}` set that firestore.rules deliberately denies (`allow write: if false`, anti-inflation policy). Batches are atomic → every signed-in save failed wholesale ("Sync failed" badge); all DS data is localStorage-only per device. #629 drops the client leaderboard write. **Open design follow-up:** no server-side leaderboard writer exists either, so `/pro/leaderboard` has been rendering zeroes since birth — if the leaderboard product is wanted, build a Cloud Function aggregator (e.g. trigger on `users/{uid}/ds_meta/streaks`) that admin-SDK-writes `leaderboard/{uid}` with a server-derived companyId.

**NEW-D30 — P1 cluster (OPEN — needs Jo's keep-or-kill decision) — /pro/vault.html data layer is entirely dead, four ways**
(a) vault-page.js gates ALL boot work on a `firebase-ready` window event that nothing loaded on the page ever dispatches (the only dispatcher is legacy `docs/admin/vault.html:54`), and `window._firestore` — which every load/save destructures — is never set anywhere: Overview stuck at "Loading..." forever, every Save toasts "Firestore still loading". (b) Even past boot, every Firestore op targets `codex/*` + `codex-sessions/*` which have NO match block in firestore.rules → default deny, even for admins. (c) Both vault search inputs ship inline `oninput=` refused by `script-src-attr 'none'` — the CSP-safe delegate at vault-page.js:2294 claims they were converted to data-v-action, but they weren't; typing does nothing. (d) "🧠 Analyze with AI" fetches `api.anthropic.com` directly (CSP-blocked AND keyless — should route through the claude-proxy function), and the session-import FORMAT-1 path runs `eval(payload)` on pasted text (CSP-refused; replace with JSON.parse — the eval being blocked is the one good outcome here). **Decision gate:** if /pro/vault is a real surface → fix the bootstrap contract (dispatch firebase-ready + set window._firestore in vault-auth.module.js), add admin-scoped codex rules + regression test, convert the two inputs, and proxy the AI call. If it's superseded by /admin/vault.html → delete vault.html + vault-page.js + vault-auth.module.js and all four close at once. Do NOT fix (a) alone — it just exposes (b). Related: docs/admin/vault.html still ships large inline `<script>` blocks → likely NEW-D23-dead under the strict CSP (admin out of sweep scope).

**NEW-D31 — P3 (OPEN) — photo-review bulk Share: the portal-link copy half always throws, and its error toast is invisible**
`PortalLinkHelpers.copyForLead → resolveUrl` hard-requires `window.CustomerPortal` (only defined in customer-portal.js, not loaded on photo-review) and `window.doc/getDoc` (never set there) → always throws 'Portal module not loaded'; the helper's `_toast` needs `window.showToast`, which photo-review keeps module-scoped → the failure is silent. Photos DO share; the link copy never happens. Fix choice: (a) load customer-portal.js + expose modular doc/getDoc on the page, or (b — smaller, recommended) drop copyForLead and use `state.lead.portalUrl` with photo-review's own clipboard + toast; either way bridge `window.showToast`.

**Fixed-in-#630 (for the record):** Turnstile latent block on the 3 lead pages' meta CSPs (would have silently no-opd or 403'd every lead the day `__NBD_TURNSTILE_SITEKEY` gets configured — land BEFORE key setup); estimate-view CTA row styled `a` but renders `<button>` (unstyled homeowner-facing CTAs); photo-review "+ Location" chip picker had zero options (FIELD_OPTIONS lacked the key; now mirrors photo-engine's QUICK_LOCATIONS); /review avatar inline `onerror` CSP-dead (broken-image icons); daily-success welcome-modal "Pick Your Color Theme" heading over a permanently-empty container + vestigial compat-SDK theme write.

**NEW-D32 — HIGH — /pro/photo-review bounced EVERY signed-in user to login: fabricated firebaseConfig — FIXED: PR #634**
Live repro post-login (2/2 cold loads bounced while the dashboard was authed in the same browser). photo-review.js shipped its own firebaseConfig with a fabricated apiKey/senderId/appId (555556015293 — exists nowhere else; canonical is 717435841570 in nbd-auth.js). Firebase Auth keys persisted sessions by apiKey → getAuth() on the wrong key never sees the user → onAuthStateChanged(null) → unconditional redirect. The page was unreachable since its CSP extraction. The static audit's dead-chrome finder flagged the config-blob drift as exactly this risk. **#634** uses the canonical config + ds-firebase-sync's getApps() guard. LIVE RE-VERIFIED: page loads, filters/chips/picker/bulk all work; #630's location options confirmed live in the same pass.

**Same-day status flips (2026-06-10 authed re-verify pass):** NEW-D1 → FIXED (#633 — _tryServerRender now passes client HTML; invoice preview = 88KB srcdoc live); NEW-D5/D7 → FIXED (#607 live-verified, 15 d8 rows flipped); NEW-D24 → verified (force flag consumed, complete-key not re-set); NEW-D29 → verified ("Backed up"→"Synced" badge while signed in — first successful DS cloud sync ever); portal-002 live banner → PASS (caught via MutationObserver). FAIL count 27→9.

**Hygiene notes from the panel (no action urgency):** the per-route header rules for `/pro/login.html`/`/pro/register.html`/`/pro/stripe-success.html` etc. keyed on `.html` paths NEVER match real requests (cleanUrls rewrites before header matching — the line-29 comment in firebase.json already documents this for other rules) — dead config that misleads CSP audits; delete or re-key extensionless. visualizer.html's App Check init is inert (nothing sets `__NBD_RECAPTCHA_KEY__`) — if publicVisualizerAI ever enforces App Check the page breaks for a non-CSP reason. photo-review.html + ds-firebase-sync.js embed firebaseConfig blobs with a different appId/senderId than canonical nbd-auth.js (same project; confirm the keys are real). firestore.rules' `daily_entries` block is orphaned (no client writes it). The leads read rule grants no manager/company-scope read despite the role-taxonomy comment promising it — matters for future team dashboards. /pro/vault.html has a duplicated `</body></html>` before its script tag (parser-tolerated, cosmetic).
