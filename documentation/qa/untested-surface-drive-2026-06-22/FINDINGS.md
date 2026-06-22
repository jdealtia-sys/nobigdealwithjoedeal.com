# Untested-surface live drive — 2026-06-22

Resuming the prior session's "25-item untested-surface checklist" (the session
that lagged out on a 529). Driving the live prod site (`/pro/dashboard`, logged
in as Jo) since these surfaces are on main; the qa-round4 branch fixes don't
touch them.

Legend: ✅ works · 🐞 bug found · ⚠️ needs decision · ⏭️ deferred

## Findings

### 🐞 DUP-1 (MED) — Two command palettes both bind Ctrl+K (and `/`) → open stacked
- **Confirmed live:** one `Ctrl+K` opens BOTH palettes at once (`bothOpenSimultaneously: true`).
  - `command-palette.js:489` — `document.addEventListener('keydown', …)`, opens the
    "Search actions, leads, or pages…" palette (Navigation + Leads). Renders on top.
  - `global-search.js:628` + `:683` — second `keydown` listener, drives the
    `#cmdPalette` "Search or jump to…" modal (Actions + mic). Left open underneath.
- Both also bind `/` (command-palette.js:497, global-search.js:635).
- Symptom: press Ctrl+K → palette A on top; pick an item → A navigates & closes →
  palette B is revealed still open underneath (looks like a ghost popup).
- `global-search.js:5` comment notes the `#cmdPalette` modal "already" existed —
  i.e. command-palette.js was added as a second system without retiring the first.
- **Fix (needs decision):** keep ONE. Which is canonical — the newer
  command-palette.js (Nav/Leads) or the older #cmdPalette/global-search (Actions)?
  Then remove the other's Ctrl+K/`/` binding (and ideally its DOM/JS).

### ✅ Notifications dropdown — works
- `#notifBtn` (`data-action="toggle" data-target="notifications"`) toggles `#notifDropdown`
  open (verified via element click → `display: flex`). `#notifList` renders 16 items
  with per-item actions (call/text/view/snooze/dismiss). Badge count "50".
- Minor data observation (not a UI bug): several items show "Unknown" sender +
  "$0 estimate" — estimates with no customer name/amount (likely old/test data).

_Note: CDP screenshots time out on this tab (renderer responds to JS fine) — verifying via DOM._

### ✅ Bulk-ops bar — works
- `#bulkModeBtn` (`toggleBulkMode`) flips bulk mode (button → "CANCEL"); each `.k-card`
  has a `.k-card-checkbox[data-action="toggle-select"]` revealed in bulk mode.
- Selecting cards via `toggleCardSelection` → `#bulkSelectedCount` "2 selected",
  `#bulkActionBar` shows (h=262) with move-stage / carrier / damage / source / jobtype /
  snooze controls (all `data-fn` allowlisted). Did NOT execute any (writes).
- Gotcha (not a bug): the card BODY is `card-click` (opens lead); selection is the
  separate checkbox affordance. Correct by design.

### ✅ Card-detail action bar — works (no dead buttons)
- Lead detail = `#cardDetailModal` (modal-bg open, z:2000). All 13 action `data-fn`s
  exist; all 10 backing modules loaded; each `cda*` fn is a thin wrapper guarded on
  `window._cardDetailLeadId`.
- Live-confirmed open: **Invoice** (`cdaInvoice`→`#nbd-invoice-modal`), **Report**
  (`cdaInspectionDeep`→`#inspectionBuilderOverlay`), **Stage picker**
  (`cdPickStage`→`#nbd-kanban-ctx-menu`, all stages listed).
- Wired + module loaded, not click-executed (camera permission / writes): Camera
  (`PhotoEngine.openCamera`), Voice Memo (`NBDVoiceMemo.recordForLead`), Voicemail
  (`NBDVoicemail.openForLead`), Share (`_sharePortalLink`), Revoke (`_revokePortalLink`).

## Checklist status
- [x] Ctrl+K command palette — 🐞 DUP-1 (the palette itself works; duplication is the bug)
- [x] Notifications dropdown — ✅ works
- [x] Bulk-ops bar — ✅ works
- [x] Card-detail action bar — ✅ works (Invoice/Report/Stage live-confirmed; rest wired)
- [x] Pull Property Intel — ✅ works (selection modal opens; paid pull correctly gated, not executed)
- [x] Maps power-tools — ✅ tools present/wired (route is `goTo('draw')` not `'drawing'`); ⚠️ map-render needs human visual confirm
- [x] Comparison mode — ✅ works (`openComparisonMode()` → `#comparisonModal` display:flex, no errors)
- [x] Warranty-cert wizard — ✅ reachable (NOT an orphan)
- [x] Data export / GDPR — ✅ wired
- [x] Mobile job-detail overlays — ✅ wired + populates

### ✅ Mobile job-detail overlays — wired + populates
- `openMobileJobDetail(leadId)` populates `#mJobDetail` (content 6170→6571 chars), no errors.
- Stays `display:none` at desktop width (1568px) — correct: the mobile overlay is CSS-gated to
  mobile breakpoints. The same `openLeadDetail`→`#cardDetailModal` path (already verified) is
  what renders responsively. Actual mobile-viewport *visual* needs a human (this tab's paint is
  wedged); JS path is clean.

## SUMMARY — 10/10 surfaces driven
- 🐞 **1 real bug:** DUP-1 — two command palettes both bind Ctrl+K + `/` → open stacked. (MED)
- ⚠️ **2 need a human visual confirm** (likely automation-tab paint artifacts, not app bugs):
  drawing-tool Leaflet map render (`#/draw`), mobile-viewport overlay rendering.
- ✅ **Everything else works:** notifications, bulk-ops, full card-detail action bar
  (Invoice/Report/Stage live-confirmed), Property Intel (paid gate correct), maps power-tools,
  comparison mode, data export + GDPR.
- ✅ **Resolved:** warranty-cert is NOT an orphan (wired via docgen → `generateWarrantyCertPDF`).
- No dead buttons found (the C-1 class held); no CSP-dead handlers on the surfaces driven.

_None of the writes/paid/destructive paths were executed (bulk ops, property pull, GDPR
erasure/export download, share/revoke, camera) — verified by wiring + module presence only._

### ✅ Comparison mode — works
- `openComparisonMode()` opens `#comparisonModal` (display:flex), no errors; closes clean.
  Compares a drawn measurement against an uploaded EagleView/RoofScope report.

### ✅ Warranty-cert wizard — reachable (prior "possible orphan" RESOLVED)
- Live dashboard.html wires it: Documents row `data-action="docgen"
  data-target="warranty_certificate"` → `#warrantyCertModal` → `data-fn="generateWarrantyCertPDF"`
  (🛡️ Generate PDF Certificate). Gated by doc-preflight (job must be marked Complete).
- The undefined `openWarrantyCertWizard` earlier was just lazy-load (warranty-cert.js /
  NBDDocGen load on the docgen flow) — current path uses `generateWarrantyCertPDF`, not the
  legacy wizard fn. Not an orphan.

### ✅ Data export / GDPR — wired
- CRM CSV export: `data-fn="exportLeadsCSV"` (2 buttons) — fn present. Settings export uses
  `exportLeadsCsv` (lowercase) — checked for a casing-mismatch dead button, but BOTH casings
  exist on window (alias), so no dead button.
- GDPR (Settings → Your Rights): `_gdprExport` + `_gdprRequestErasure` both functions, each
  calls a Cloud Function. Not executed (download / destructive erasure).

### ✅ Maps power-tools (Drawing tool) — tools wired; ⚠️ one render caveat
- NOTE: the route key is **`draw`** (`#view-draw`, lazy-hydrated from `tpl-view-draw`),
  NOT `drawing`. `goTo('drawing')` lands on an empty/non-view.
- Toolbar hydrates with 47 controls: Lines/Perimeter/Eave-Rake/Gutters modes; 11 line
  types (Ridge/Hip/Valley/Rake/Eave/Flashing/…); ▶ Draw toggle; Undo; 🧠 Smart Waste (AI);
  📋 Generate Estimate; 💾 Save / 📂 Load from Customer; 📤 Measurement Report;
  🧱 Material Takeoff; 📎 Xactimate Export; ☀️ Solar Analysis.
- ✅ Draw toggle flips ▶ Draw → ⏹ Stop. ✅ Material Takeoff + Solar Analysis wired —
  both correctly guard with toast "Draw some lines first" when no roof drawn.
- ⚠️ Observed `.leaflet-container` at **0×0** + `TypeError: …reading 'getContainer'` on
  draw-toggle. BUT this automation tab's compositor is wedged (all CDP screenshots time
  out), which by itself starves a Leaflet map of layout → 0×0 → undefined map ref. Most
  likely an automation-tab paint artifact, NOT a confirmed app bug. **Needs a human to
  open `/pro/dashboard#/draw` and confirm the map renders + drawing works.**

### ✅ Pull Property Intel — works (paid feature, gate verified, NOT executed)
- `pullIntelForModal()` opens `#propertyIntelModal` (display:flex) with itemized data
  sources (Owner $0.30 / Details $0.15 / Zestimate $0.05 / Tax $0.10).
- Safety gate confirmed: with nothing selected, total `$0.00` and `#piPullBtn` is
  **disabled**; a separate `#propertyIntelConfirmModal` requires explicit confirm before
  `executePullPropertyIntel()` hits the (paid) API. I opened + closed the modal only —
  no pull executed, no charge.
- [ ] Bulk-ops bar
- [ ] Card-detail action bar (Invoice/Report/Camera/Share-Revoke/Voicemail/Voice-Memo/stage-picker)
- [ ] Pull Property Intel
- [ ] Maps power-tools (takeoff/solar/angles)
- [ ] Comparison mode
- [ ] Warranty-cert wizard (possible orphan)
- [ ] Data-export / GDPR
- [ ] Mobile job-detail overlays
