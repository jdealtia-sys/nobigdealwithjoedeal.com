# Homeowner Site Total QC Sweep — Session Status / Handoff

**Date:** 2026-06-11 · **Branch:** `claude/nbd-homeowner-qc-sweep-tlcnrz` · **PR:** #648 (draft)
**Rollback point:** `6e98523` (session start, main)
**Scope:** public homeowner surface (`docs/` excl. `docs/pro/`) — 220 pages. CRM untouched.

## Final ledger

| Phase | Coverage | Found | Fixed inline | Proposed |
|---|---|---|---|---|
| 0 Inventory | 220 pages classified, sitemap reconciled (0 sitemap 404s) | 3 (template files, sitemap gap) | — | 2 |
| 1 Links/assets/console | 220 static + 214 headless | 57 | **54** (20 anchors, 32 canonical breadcrumbs, sitemap entry, robots.txt binding) | 3 |
| 2 Functional | every tool+form walked, payloads diffed vs server allowlists; 41-page button sweep (0 dead) | 6 | 0 (all propose-class) | 6 (F-1..F-6) |
| 3 Visual/brand/mobile | 46 pages × 3 viewports + token/font scan of all files | 8 | **3** (2 squashed logos, 2 overflows incl. guarantee table) | 4 |
| 4 SEO/perf | Lighthouse ×14 + 198-page meta scan | 9 | **4 commits' worth** (twitter cards, og:image, label assoc, honeypot aria, GAF label → a11y 84→94 / 77→88) | 4 |

**Zero on the homeowner surface after this sweep:** dead links, 404 assets, console errors,
JS page errors, mixed content, duplicate titles/descriptions, missing alts, multi-h1, redirect
chains, dead buttons.

## ZZ_QA_ / production-safety closeout
Session network policy blocked ALL egress — every Phase-2 form submission was intercepted at
the network boundary (mocked endpoints, payloads logged). **Zero test records reached
production**: no leads, no SMS, no storm-alert subscribers. Nothing to clean up. ZZ_QA_ naming
was used throughout anyway. Still owed when network/manual access allows: one live ZZ_QA_
submit per form (contact/estimate/inspect/storm/free_roof) → verify Firestore + CRM bridge →
delete; external-link liveness pass (246 URLs); prod Lighthouse re-baseline.

## Where things live
- Reports: `PHASE1-SWEEP.md` … `PHASE4-SEO-PERF.md` (this dir)
- Lighthouse baseline: `LIGHTHOUSE-BASELINE.json` (local-server caveat inside)
- Ranked proposals for Jo: `PROPOSALS.md` — top 3 are revenue-path:
  (1) estimator server allowlist strips lead contact info,
  (2) estimator under-quotes CRM engine 24–39%,
  (3) /inspect noindex⊕sitemap contradiction.
- Evidence: `evidence/` (Phase 2 flows) + `evidence/phase3/` (112 viewport captures).
- Audit #1 (`claude-code-website-audit-prompt.md`): never existed in repo/history — superseded
  by this sweep. Brand-sweep-2026-06-07 carry-ins N1 (→V-1, diagnosed as copy-paste) and N2
  (/free-roof chrome) are tracked in PROPOSALS.md.

## Commits this session (all on the PR branch)
inventory → 4× Phase-1 fixes → P1 report → P2 report+evidence → visual fixes → P3
report+evidence → seo/a11y fixes + P4 report → proposals + this handoff.

---

## Companion docs in this folder

The rest of this campaign, linked so each doc is reachable from the vault:

- [INVENTORY](INVENTORY.md) — Homeowner Site QC Sweep — Page Inventory Ledger
- [PHASE1-SWEEP](PHASE1-SWEEP.md) — Phase 1 — Automated Full-Coverage Sweep (all 220 pages)
- [PHASE2-FUNCTIONAL](PHASE2-FUNCTIONAL.md) — Phase 2 — Functional Deep QC (tools, forms, lead flow)
- [PHASE3-VISUAL](PHASE3-VISUAL.md) — Phase 3 — Visual, Brand & Mobile Sweep
- [PHASE4-SEO-PERF](PHASE4-SEO-PERF.md) — Phase 4 — SEO & Performance Baseline
- [PROPOSALS](PROPOSALS.md) — Big-Fix Proposals — Homeowner QC Sweep 2026-06-11
