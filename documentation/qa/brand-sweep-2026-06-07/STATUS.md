# STATUS.md — Brand-consistency sweep tracker

Run date: **2026-06-07** · Anchor commit: **`6fefcd25`** (main; brief's `dfa6e65` not in history) · Owner: Jo Deal

## Phase progress
- [x] **Phase 0 — Ground truth + lock specs** (checkpoint cleared by Jo)
- [x] **Phase 1 — NBD public surface (Axis A)** — 10/10 representative kinds PASS; desktop walked live; mobile via source (tooling limit)
- [x] **Phase 2 — Oaks microsite** — Axis A PASS (distinct identity); **Axis B BLEED found** (5 shared-source leaks); vanity domain is parked Squarespace
- [x] **Phase 3 — Multi-tenant artifact layer** — code-inspection (Jo's call). 3+ doc paths all hardcode NBD; customer portal worst (CRIT-3); `NBD-` numbering (CRIT-4); "red/black/white" claim = FALSE
- [x] **Phase 4 — Separation verdict** — FINAL in SEPARATION.md: **structural**, not token swaps

## VERDICT (Phase 4)
Brand is hardcoded on every customer-facing surface (3+ doc generators, customer portal,
SMS/email, doc-number prefixes) AND the Oaks public site (shared NBD sources). Per-tenant
config exists but is ignored + stale. → **One structural "resolve brand from the active
tenant" initiative**, not a pile of token fixes. Only trivial swap available: print orange
`#C8541A → #E8720C` (Axis A only; does nothing for separation). No fixes applied this run
(none greenlit). See SEPARATION.md for the 5-step payload.

## Phase 0 — decisions & findings
1. **Repo/commit:** single repo `nobigdealwithjoedeal.com`, on `main` @ `6fefcd25`, clean.
   Brief reference base `dfa6e65` not found → anchored to current main.
2. **Surface ownership:** ALL THREE surfaces live in THIS repo.
   - NBD public = `docs/` (Firebase Hosting, domain `nobigdealwithjoedeal.com`).
   - **Oaks microsite = `docs/sites/oaks/`**, served at `/sites/oaks/` (rewrite, `noindex`),
     canonical → `nobigdealwithjoedeal.com/sites/oaks/`. **NOT a separate repo/deploy.**
     → Oaks public-site fixes ARE possible here. **TODO Phase 2:** confirm whether the vanity
     domain `oaksroofingandconstruction.com` actually resolves and where it points (live check).
   - Artifacts = `functions/render-pdf.js` + `functions/print/*.hbs` (server) and
     `docs/pro/js/document-generator.js` (client).
3. **Two doc systems**, both hardcode NBD brand (see SEPARATION.md B1–B5).
4. **Per-tenant brand config exists but ignored + stale** (see BRAND-SPEC + SEPARATION).
5. **Oaks artifact path decision (RECOMMENDED): CODE-INSPECTION is conclusive.**
   `renderPdf` accepts no tenant/brand param, so it *cannot* emit Oaks branding —
   the bleed is proven, a live Oaks render would only re-prove it. Will still generate
   **live NBD `ZZ_QA_` PDFs** in Phase 3 for the real rendered baseline + red/black/white hunt.
   Optional: Jo hands off an Oaks session for a confirmation screenshot.
6. **"Hardcoded red/black/white" claim — partially stale.** The server `.hbs` system is
   actually orange+charcoal (on-brand-ish, no red); reds present are *severity badges* only.
   Real rendered colors to be verified in Phase 3.

## Deliverables (folder: documentation/qa/brand-sweep-2026-06-07/)
- [x] BRAND-SPEC.md  [x] SEPARATION.md (prelim)  [x] BUG-LOG.md (seeded)
- [x] BRAND-MATRIX.md (skeleton)  [x] CLEANUP.md  [ ] screenshot library (phases 1-3)

## Fixes landed (branch `brand-fixes-2026-06-07`, off main `6fefcd25`)
- **A1 — print orange unified to canonical `#E8720C`** (`functions/print/design-system.css`
  orange family). Smoke-tested. NOT deployed (awaiting Jo one-tap OK). Visual render-verify
  deferred (code-inspect mode → no live PDF gen). Caveat: `#C8541A` may have been a deliberate
  warm-print orange; 1-commit revert if it reads too web-bright on cream.
- Structural tenant-brand work → see `TENANT-BRAND-PLAN.md` (flagged, not started).

## Decisions from Jo (Phase 0 checkpoint, 2026-06-07)
- **Oaks orange = SHOULD BE DISTINCT.** Shared `#E8720C` is treated as drift/near-bleed;
  report will flag it + propose an Oaks-specific accent. (Logged as finding A5 / Oaks-OB1.)
- **Oaks artifact path = CODE-INSPECTION ONLY.** No Oaks live handoff. Will still render
  live NBD `ZZ_QA_` PDFs in Phase 3 for the baseline + color check.
- **Phase 1 = GO.** Live NBD public walk, desktop + mobile, via Claude-in-Chrome.
