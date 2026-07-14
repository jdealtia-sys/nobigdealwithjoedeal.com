# Next Session — Globals Tranche 2c-4a (card-detail `cda*` cluster)

> **STATUS: EXECUTED 2026-07-07 — do not re-run (verified 2026-07-14).**
> This brief shipped the same day it was written: PR #899 landed Tranches
> 2c-4a…2c-4e (including this brief's 18-name cda cluster, full E2E matrix
> green), and the registry lane then continued through 2c-4f (#901,
> `dashboard-bootstrap.module.js` settings cluster), 2c-4g (#902) and
> 2c-4h Slices H1/H2 (#903–#905, `dashboard-ui.js` — leaf handlers, the 9
> clean-needs-wrap names, and the 10 entangled twins/shims). All merged to
> main. Remaining in the lane: only the shim-blocked residual (zone-draw /
> `damagNearMe` / the `goTo` router) and Tranche 3 — see
> `docs/dev/dashboard-actions-globals-audit.md` (tranche table) and
> `docs/dev/globals-decomposition-HANDOFF.md`. Original brief follows
> unchanged for reference.

> Cold-start brief, 2026-07-07. First execution slice of the
> `dashboard-actions.js` globals decomposition. Self-contained: a fresh agent
> can pick this up cold. Full analysis:
> `docs/dev/dashboard-actions-globals-audit.md`. Tracker row:
> `docs/dev/dashboard-decomposition-plan.md` (tranche table, `2c-4a`).

## Goal

Move the 18 card-detail action wrappers OFF `window` in `dashboard-actions.js`:
into a single module-local IIFE, registered in `window.__NBD_CALL_REGISTRY`,
removed from `_NBD_CALL_ALLOWLIST`. This proves the in-file-IIFE pattern for
the hardest god-file and unblocks slices 2c-4b…2c-4e.

**Do NOT** attempt any MUST-STAY name (the `goTo` router, zone-draw, etc.) —
see the audit's MUST-STAY table. This slice is the 18 CONVERTIBLE cda names
only.

## The 18 names (all proven CONVERTIBLE)

`cdaReport`, `cdaEnrich`, `cdaPhotos`, `cdaInvoice`, `cdaInspection`,
`cdaInspectionDeep`, `cdaMjdAct`, `cdaEditLead`, `cdaOpenMobileInspection`,
`cdaVoiceMemo`, `cdaOpenVoicemail`, `cdaSharePortalLink`, `cdaRevokePortalLink`,
`cdaConfirmPromote`, `cdaOpenTaskModal`, `cdPickStage`, `cdPickType`,
`_mCreatePhotoPicked`.

Current definitions are **scattered** in `dashboard-actions.js` — lines
44–262 (interleaved with non-cda handlers) plus `_mCreatePhotoPicked` at 1399.
So this is a **relocate-into-one-IIFE**, not an in-place wrap. They share no
top-level lexical state with surrounding code (each delegates to other modules
— `NBDReports`, `PhotoEngine`, `NBDTemplateSuite` — or to `window`-scoped
globals), so relocation is safe.

> Optional: `_mCreatePhotoPicked` is functionally mobile-create, not
> card-detail. Keeping it here matches the audit, but moving it to 2c-4b is
> also fine — just be consistent between the code, the allowlist edit, and the
> smoke test.

## Cross-cluster call fixes (REQUIRED — this is the trap)

Two cda functions call names that belong to a LATER slice (2c-4b). Once those
callees go IIFE-local, a bare cross-IIFE call `ReferenceError`s. Rewrite both
to resolve via `window.` before moving:

- `cdaMjdAct` (L148): `_mJdAct(actionType, window._cardDetailLeadId)` →
  `window._mJdAct(actionType, window._cardDetailLeadId)` (and update the
  `typeof _mJdAct` guard to `typeof window._mJdAct`).
- `cdaOpenMobileInspection` (L164): `openMobileInspection(window._cardDetailLeadId)`
  → `window.openMobileInspection(...)` (update its `typeof` guard too).

`cdaEditLead` already calls `window.editLead` / `window.closeMobileJobDetail` —
no change needed. Verify no other cda function makes a bare call to a name
outside the 18 before finishing.

## Mechanical steps

1. **Relocate + wrap.** Gather the 18 definitions into one IIFE (top of file,
   after the header comment, is fine). Convert each
   `window.cdaReport = function cdaReport()` → `function cdaReport()`. Apply the
   two cross-cluster `window.` fixes above.
2. **Register.** At the file's existing registry pattern (mirror
   `dashboard-ui-prefs-boot.js:435`):
   ```js
   window.__NBD_CALL_REGISTRY = window.__NBD_CALL_REGISTRY || Object.create(null);
   Object.assign(window.__NBD_CALL_REGISTRY, {
     cdaReport, cdaEnrich, cdaPhotos, cdaInvoice, cdaInspection,
     cdaInspectionDeep, cdaMjdAct, cdaEditLead, cdaOpenMobileInspection,
     cdaVoiceMemo, cdaOpenVoicemail, cdaSharePortalLink, cdaRevokePortalLink,
     cdaConfirmPromote, cdaOpenTaskModal, cdPickStage, cdPickType,
     _mCreatePhotoPicked,
   });
   ```
   Put this registration INSIDE (or immediately after) the same IIFE so the
   names are in scope.
3. **De-allowlist.** Remove those 18 from `_NBD_CALL_ALLOWLIST` in
   `dashboard-state.js` (the cda entries near L233-235, the chip pickers
   L264-265, `_mCreatePhotoPicked` L298). Leave a dated comment in the 2c-2/2c-3
   style pointing at 2c-4a — do NOT re-add registered names (a stale window
   fallback shadow-resurrects the global).
4. **Smoke test migration** (`tests/smoke/dashboard.test.js`):
   - Remove the 14 cda names from the on-window spot-check list at **L1354**
     (`cdaReport`…`cdaOpenTaskModal`).
   - Add all 18 to the off-window assertion section (~L2560, "Globals Tranches
     0+1: converted names stay off window") and the `__NBD_CALL_REGISTRY`
     registration assertion (~L2752, "Globals Tranche 2c") — mirror how the
     crm-portal-bridge 2c-3 block does it.
5. **Hard-won lesson #1 guardrail:** confirm no top-level `let`/`const` got
   anchored inside the new IIFE that other code reads. The cda cluster declares
   none, so this should be clean — but grep-verify.

## Verification (per the audit's per-slice checklist)

- `cd tests && npm test` (full non-emulator battery) green. Baseline today:
  smoke is `2205 passed, 4 failed` where the 4 are the environmental
  `functions/node_modules` gap (`firebase-functions/v2/https`) — unrelated;
  do not chase them. Your change must not add failures and must flip the
  wiring-audit + off-window assertions green.
- The authed E2E emulator matrix (`@stranger` + advisory shards) green in CI —
  **this is the one that catches the boot-break class from lesson #1; a clean
  smoke run is necessary but not sufficient.** Do not merge on smoke alone.
- Manual (device-in-the-loop ideal): open a card-detail modal on a phone
  viewport, exercise Report / Enrich / Photos / Invoice / Inspection / the
  stage+type chip pickers / share+revoke portal link / promote / task — every
  button must still fire. The delegate silently no-ops a missing name, so a
  broken wire looks like a dead button (the exact H-4 class this whole tranche
  hardened against).

## Definition of done

- 18 cda names module-local, registered, off `window`, off the allowlist.
- Smoke wiring-audit + off-window + registry assertions all green; 14-name
  on-window spot-check updated.
- E2E matrix green in CI.
- One PR (`docs`/`refactor(globals)` scope). Then 2c-4b (mobile cluster) is
  next — reconcile the `window._mJdAct` / `window.openMobileInspection` calls
  there.
