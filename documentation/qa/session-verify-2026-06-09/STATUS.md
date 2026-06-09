# Session Verification & Takeover — 2026-06-09 (evening)

> Mission: independent ground-truth verification of the just-finished session(s), per the
> "NBD Pro — Session Verification & Takeover Brief". Run from a fresh remote container
> (clean clone, no prod Firestore creds, outbound HTTP to prod blocked by network policy).
> Note: the brief's `cd-session/STATUS.md` path no longer exists — session trackers live
> under `documentation/qa/<session-dir>/`; this doc follows that convention.

## PHASE 0 — Ground truth

**What the previous session was:** the 2026-06-09 confirmed-bug remediation session
(`documentation/qa/remediation-2026-06-09/REMEDIATION-LOG.md`). It merged the pre-built,
CI-green QA-fix PRs #595 → #596 → #597 → #598, then #600, rode the auto-deploy, and
artifact-verified every fix against served prod content. Before it, on 2026-06-08, a
separate session ran the **estimate engine reconciliation** (this brief's Phase 3 —
already done, see below).

**Git evidence (all claims matched):**
- HEAD = `996e13f` (#601, docs: sweep ground truth + remediation tracker). Working tree
  clean, nothing uncommitted/untracked, no `.bak`/`.tmp` scratch files.
- Session start commit `2d2349a` (#591). Blast radius `2d2349a..HEAD`: 57 files,
  +46,144/−74 — ~45.5k of that is QA ledger JSON/docs; real code changes confined to
  ~20 `docs/pro/js/` modules, `firestore.rules`, `customer.html`/`dashboard.html`/
  `pricing.html`, `docs/sites/oaks/style.css`, and smoke/rules tests. Matches the
  PR → bug-family map in the remediation log.
- Open PRs exactly match the log's "explicitly NOT merged" list: #599 (Jo auditing),
  #592/#593/#594 (out of scope), #579 (gated on Stripe Price action), + dependabot.
- Deploy run **27239108944** independently confirmed via the Actions API:
  `conclusion: success`, on `main` @ `d72ae4f` (#600).
- One doc-internal inconsistency (cosmetic): REMEDIATION-LOG's PR table row for #600
  says "open — merge on green CI" while its fix ledger + session log say merged.
  Git confirms **merged** (`d72ae4f` on main, deployed). The table row is stale.

## PHASE 1 — Verification

**Test suites (run in this container, functions deps installed via `npm ci`):**
| suite | result |
|---|---|
| smoke | **1819 / 0** (matches documented count) |
| tenant-brand / tenant-hardening | 30/0 · 51/0 |
| estimate: engine-parity / pricing / profit / formula-eval / v2-payload / render | 22/0 · 50/0 · 43/0 · 20/0 · 51/0 · 74/0 |
| docgen-brand / docgen-render | 22/0 · 203/0 |
| billing-gate, lead-pipeline, customer-portal, scheduling, team-roles, storm-geo, dashboard-kpi, theme-contrast, theme-qa (2686), pwa, webhooks, security-headers, address, state, lead-bridge | **all green, 0 failures** |

(First smoke run showed 2 failures — both `Cannot find module 'firebase-functions/v2/https'`
from the fresh container missing `functions/node_modules`; green after `npm ci`. Not a
code regression. Emulator-gated suites (rules/x-tenant/etc.) not re-run here; they ran
green inside deploy run 27239108944's rules-test gate.)

**Headline-deliverable spot checks (code-level):**
- BILLING-B1: `pricing.html` $299 ✓; `billing-gate.js` PLANS growth/professional
  `price: 299` ✓, zero `249` ✓; deploy carried both (#598/#600).
- NEW-5/CO-H-5: `firestore.rules:88` uses `token.get('role','') != 'viewer'` (absent-claim
  safe) with the NEW-5 comment + regression test ✓.
- Global contracts intact: `window._leads` (nbd-auth/bootstrap), `CompanyAdmin`
  (admin-manager.js), `NBDAuth` (nbd-auth.js), `ScriptLoader` (script-loader.js) ✓
  (smoke contract assertions green).
- Estimate business rules in `estimate-config.js`: tiers **545/595/660**,
  `JOB_MINIMUM_DOLLARS: 2500` (+ cents twin), $25 grand-total rounding step,
  pitch-based waste (classic takes pitch FACTOR, V2 takes RATIO — input shapes
  documented in-file) ✓ — all asserted by the green estimate suites.

**Could NOT be verified from this container (environment limits, not findings):**
- In-browser behavioral round-trips (the ~5-min checklist in REMEDIATION-LOG) — needs
  Jo's logged-in normal Chrome window. Artifact level already proven by the previous
  session over cache-busted HTTP.
- Live prod fetch (HTTP 403 — network policy) and prod Firestore state (no creds).

## CLASSIFICATION: ⚠ CLEAN WITH DEBT

Everything claimed is verified by git/CI/code/tests. Debt is all documented, none of it
fixable from this container:
1. **ZZ_QA_ "Inspect Bridge Test"** lead (222 ZZ_QA Inspect Ln) still in the live NBD
   pipeline + its `inspect_leads` doc — deletable via normal CRM flow now that #596 is
   deployed (doubles as the NEW-5 behavioral verify). **Jo: checklist item 6.**
2. Behavioral re-verify checklist (8 items, ~5 min) pending a real Chrome session.
3. Stripe Price re-point to $299 (`STRIPE_PRICE_PROFESSIONAL` still $249) — Jo's manual
   action; unblocks #579.
4. #599 security hardening awaiting Jo's personal audit.
5. Deleted-bin ZZ_QA leads await Jo's OK to purge; ~3 unexplained extra active leads
   (non-ZZ_QA) flagged in exhaustive-sweep CLEANUP.md for Jo to confirm legitimate.
6. Watch items from #597 pre-merge review (Team-tab innerHTML escaping follow-up, etc.)
   — listed in REMEDIATION-LOG.

## PHASE 3 — SKIPPED (already done)

The Estimate Engine Reconciliation this brief queues up **was the 2026-06-08 estimate
session** (`documentation/qa/estimate-qa-2026-06-08/` — RATE-SHEET, MATH-RECONCILIATION,
ENGINE-AGREEMENT, PROPOSED-FIXES, SUMMARY). Its proposals were approved and shipped in
PRs #580–#591, culminating in **#591 "unify Classic onto V2/config (D-1/D-2/D-4)"** —
the drift areas named in the brief (county tax key shapes, permit shapes, pitch→waste)
were reconciled onto the single shared `NBD_ESTIMATE_CONFIG`, and the parity/pricing
suites now lock the agreement (22 + 50 assertions, green above). Remaining estimate
loose end is #593 (C-1 permit fail-safe), open and out of this session's scope.
Per the brief: verification of that work is the whole job — done; no estimate code
touched.

## Follow-up landed (Jo approved 2026-06-09): Team-tab innerHTML escaping

The #597 watch item ("HTML-escape member fields in the newly-live Team-tab renderer
+ sibling #597 renderers") is closed in this branch:
- `dashboard-team-tab.js` — added the in-tree `escapeHtml` idiom; `m.email`, `m.role`,
  `m.status` (and the avatar initial) now escape before `innerHTML` interpolation.
  `roleColors[m.role]` is a lookup with CSS-var fallback — safe, unchanged.
- Sibling #597 renderers audited: billing-tab + hotkey-toggles interpolate static
  config only (`NBDBilling.PLANS`, `_HOTKEYS`); close-board already escapes via its
  own `esc()`; admin-manager/maps #597 changes render no user data. No changes needed.
- Smoke guard added (`tests/smoke/dashboard.test.js`): asserts the helper exists, all
  three member-field interpolations are escaped, and no bare interpolation remains —
  negative-tested (guard fails on a sabotaged copy). Smoke: **1822/0**.

## No ZZ_QA_ records created by this session. No prod writes of any kind (read-only + tests).
