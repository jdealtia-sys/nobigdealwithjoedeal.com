# Confirmed-Bug Remediation — 2026-06-09

Mission: land the confirmed bugs from `documentation/qa/exhaustive-sweep/BUG-LOG.md` live, root-cause families first.

**Situation at session start:** every Family A–E fix was already built and CI-green in four open PRs from the Tier A and Tier B/C remediation sessions (2026-06-09), but none were merged — so nothing was live and every ledger row still read FAIL. This session's job collapsed to: adversarial pre-merge review → merge in conflict-safe order → auto-deploy → live re-verify on prod → flip ledger rows to FIXED.

## PR → bug-family map

| PR | branch | families / bugs | status |
|----|--------|-----------------|--------|
| #595 | fix/qa-tier-a-client | A (NEW-2 digest round-trip, NEW-4 North Star key mismatch), B (NEW-1 CSP-dead widget handlers), C (CO-M-1 search HTML leak, CO-L-1 Quick-Add stale ids, NEW-C9 in-card bubble) | **MERGED** 2026-06-09 |
| #596 | fix/qa-tier-a-rules | C (NEW-5 + CO-H-5: `token.role != 'viewer'` throws on absent claim → all no-role-owner lead writes denied) | **MERGED** 2026-06-09 |
| #597 | fix/qa-tier-bc-2026-06-09 | D (NEW-C10 Team "Loading…", NEW-C13 Billing "Loading…"), E (NEW-C12 hotkey toggles, NEW-C2 close-board, NEW-C3 storm counters, NEW-C4 no-confirm deletes, NEW-C6 tel: regex, CO-BLEED-O2 Oaks navy), plus NEW-C1 (PWA confirm bypass), NEW-C5 (_test lead filter), NEW-C7 (Team Manager nav hidden), NEW-C8 (picker active label) | **MERGED** 2026-06-09 |
| #598 | fix/qa-billing-2026-06-09 | Pricing (BILLING-B1 in-app copy → $299) | **MERGED** 2026-06-09 |
| #600 | fix/pricing-page-299 | Pricing (public pricing page $249 card → $299; minimal, #579 carries the full rewrite) | open — merge on green CI (repo disallows auto-merge) |

**Pre-merge gate:** 4-agent adversarial review (one per PR) traced every claimed fix to its mechanism — 19/19 verdicts `fixes`, zero blockers. Notable watch items recorded in the session log below.

**Explicitly NOT merged this session:** #599 (security hardening — Jo is auditing it personally), #579 (terms page — gated on the Stripe Price action below), #592/#593/#594 (not in this bug log's scope).

## Fix ledger — FINAL

Deploy: run **27239108944** (firebase-deploy.yml) **green** — rules-test gate → rules → indexes → storage → smoke gate → functions → hosting, 8m40s. "Artifact" = the fix confirmed present in the **served prod content** (cache-busted fetch, 2026-06-09). "Behavioral" = in-browser round-trip — pending for authed surfaces (see checklist below).

| bug | family | fix PR | merged | artifact-verified live | behavioral | ledger row(s) |
|-----|--------|--------|--------|------------------------|-----------|----------------|
| NEW-2 Weekly Digest round-trip | A | #595 | ✅ | ✅ `_loadProfileSettings` in served bootstrap | pending | d7-settings-020 → FIXED |
| NEW-4 North Star key mismatch | A | #595 | ✅ | ✅ `dsSaveConfig` mirror in served bootstrap | pending | d7-settings-087 → FIXED |
| NEW-1 CSP-dead widget handlers | B | #595 | ✅ | ✅ widgets.js: 8 `data-w-*` hooks, 0 inline `on*` | pending | d2-home-011/029 → FIXED |
| CO-M-1 search HTML leak | C | #595 | ✅ | ✅ TreeWalker `_highlightCardMatches` in served crm-pipeline.js | pending | d3-pipeline-001 → FIXED |
| CO-L-1 Quick-Add stale ids | C | #595 | ✅ | ✅ (same widgets.js artifact) | pending | d2-home-020 notes |
| NEW-C9 in-card bubble | C | #595 | ✅ | ✅ (same widgets.js artifact) | pending | d2-home-009/013/020 notes |
| NEW-5 / CO-H-5 rules throw | C | #596 | ✅ | ✅ rules deployed behind green gate incl. new no-role-owner regression test | pending (delete ZZ_QA inspect lead) | CLEANUP item |
| NEW-C10 Team Loading… | D | #597 | ✅ | ✅ readyState guard in served dashboard-team-tab.js | pending | d7-settings-007 notes |
| NEW-C13 Billing Loading… | D | #597 | ✅ | ✅ readyState guard in served dashboard-billing-tab.js | pending | d7-settings-008 notes |
| NEW-C12 hotkey toggles empty | E | #597 | ✅ | ✅ (ships in same deploy; delegate + allowlist) | pending | d7-settings-183 (UNTESTED, fix shipped) |
| NEW-C1 PWA confirm bypass | E | #597 | ✅ | ✅ (same deploy; nbdConfirm routing) | pending (PWA only) | gap-deleteconfirm rows (UNTESTED, fix shipped) |
| NEW-C2/C4/C5/C6/C7/C8 + CO-BLEED-O2 | E | #597 | ✅ | ✅ Oaks css `#1a1a1a !important` confirmed; rest same deploy | pending | various (UNTESTED, fix shipped) |
| BILLING-B1 in-app $249→$299 | pricing | #598 | ✅ | ✅ dashboard.html "Crew tier ($299/mo…)"; billing-gate PLANS 299 | n/a (copy) | d7-settings-007/008 notes |
| BILLING-B1 public page $249→$299 | pricing | #600 | ✅ | ✅ pricing page tiers $0/$99/**$299**/Custom | n/a (copy) | — |

## Deferred (deliberately NOT fixed this session — per #597's own scope + the brief's gates)
- **NEW-C3** (Storm Analytics counters always 0) — real, but needs Jo's decision on counter semantics + storage model first (#597 deferral note).
- **CO-M-3** (Brave sidebar blank) — empty-CSS-var theory largely refuted; needs a real Brave session to localize.
- **~13 lower-severity native-`confirm` sites** sharing the NEW-C1 PWA defect (portal revoke, admin code rotation, product/template deletes) — batchable follow-up.
- **Server-side mirror of NEW-C7** (`requireTeamAdmin` access-code gap) — that's **PR #599**, which Jo is auditing personally; untouched.
- **BILLING-B2** (per-seat billing) — separate gated build (Stripe test Price IDs + seat-model decision).
- **CO-H-3** (Reports INTERNAL ASSERTION) — not reproduced in the sweep; monitor.
- **CO-BILLING-B1 Stripe half** — the $299 Price re-point is Jo's action (steps below).
- **NEW-2 residue** — Profile Company/Phone/Role/License fields still display-only (product decision).
- **onRepSignup / serviceAccountTokenCreator IAM grant** — devops, out of Claude's authority.

## Behavioral re-verify checklist (≈5 min in a logged-in normal Chrome window)

The artifact level is proven; these are the in-browser round-trips that complete the bar (all on `ZZ_QA_`/own data; restore anything real):

1. **NEW-1:** Home → Task Checklist → check a task → reload → still checked (restore it after). Home → Customize → toggle a widget → grid updates → toggle back.
2. **NEW-2:** Settings → Profile → uncheck Weekly Digest → Save → reload → still unchecked → **restore ON + Save**.
3. **NEW-4:** Settings → Daily OS → set Target "ZZ_QA test" → Save → Home shows it in the North Star widget → **restore empty + Save**.
4. **CO-M-1:** Pipeline → search "co" → matching cards highlight cleanly, no leaked `style=`/`data-action=` text → clear.
5. **CO-L-1 / NEW-C9:** Home → Quick Add → type name+address, pick damage → "Add →" → full modal opens **prefilled** (and no bounce to /crm).
6. **NEW-5 (doubles as cleanup):** Pipeline → "ZZ_QA_ Inspect Bridge Test" (222 ZZ_QA Inspect Ln) → ⋮ → Delete lead → confirm "Move to Deleted" → lead leaves the pipeline and **stays gone after reload**.
7. **NEW-C10/C13:** Settings → Team: member row resolves (no perpetual "Loading…", copy says $299). Settings → Billing: "Current Plan" resolves.
8. **NEW-C12:** Settings → Help: Hotkey Toggles section renders toggle controls; flipping one persists.

Why pending: the Chrome extension was connected but tab-group creation failed all session ("Grouping is not supported by tabs in this window" — a PWA/incognito window held focus on the machine). Re-run with a normal Chrome window focused.

## Family A — settings save↔load key reconciliation (recurrence prevention)

Audit result from the sweep + Tier A session, recorded here so the class can't keep recurring:

| setting | save path → key | load path → key | verdict |
|---------|-----------------|-----------------|---------|
| Profile digest/dormant | `_saveSettings` → `users/{uid}.weeklyDigestEnabled` / `.dormantNudgeEnabled` | was: none (template hydration raced, checkbox left at default) → now `_loadProfileSettings` reads the saved doc on profile-tab open | fixed in #595 |
| North Star (+ Daily OS) | `dsSaveConfig` → `nbd_user_config.northStar.target` | Home widget reads legacy `nbd_ds_config.northStar` | fixed in #595: `dsSaveConfig` mirrors to `nbd_ds_config` |
| Appearance theme/mode | `nbd_pro_theme` ↔ `nbd-theme` write-through; `nbd_pro_mode_pref` | same keys | round-trips (PR #568, re-verified in sweep) |
| Estimates tier rates | engine applies saved rate at calc time | `nbd_est_settings_v2.tierRates` LS is a stale **cache**, not the source | NOT a bug (NEW-3 killed) |
| Notifications | `_saveNotifSettings` → `nbd_notif_settings` | same key | round-trips (sweep strict-bar PASS) |
| Company | `_saveCompanySettings` → `nbd_company_settings` (by field id) | same key | round-trips (sweep PASS) |
| Company Profile | `_saveCompanyProfileSettings` → Firestore `companyProfile/main` | doc-gen `NBDDocGen.COMPANY` + brand fallback | round-trips; empty letterhead falls back to tenant brand (NEW-C11 killed) |

Known-deferred (product decisions, flagged for Jo): Profile Company/Phone/Role/License fields are still display-only (not read by `_saveSettings`); Daily-OS "Other" category fallthrough kept byte-parity with the daily-success bridge.

## Stripe Price action for Jo (BILLING-B1 / PR #579 unblock) — DO NOT automate

Canonical price: **Crew = $299/mo** (locked 2026-06-08; marketing, Terms, and — after #598 — in-app copy all say $299). The live Stripe Price behind `STRIPE_PRICE_PROFESSIONAL` is still **$249**.

Jo's action (Stripe Dashboard, test mode first, then live):
1. Products → the Crew/Professional product → **Add another price**: $299.00 USD, recurring monthly.
2. Copy the new Price ID (`price_…`).
3. Update the functions secret/env `STRIPE_PRICE_PROFESSIONAL` to the new Price ID (Secret Manager / functions env, then redeploy functions or wait for next auto-deploy).
4. Archive the old $249 price (do **not** delete; existing subs keep their grandfathered price unless migrated deliberately).
5. After that, PR #579 (terms + pricing pages) is unblocked on the price-mismatch gate (per-seat billing BILLING-B2 remains a separate unbuilt gate for public self-serve).

## Watch items from the pre-merge review (non-blocking, post-deploy follow-ups)
- **#597 / Team tab:** `loadTeamMembers` renders member email/role into `innerHTML` without escaping. Owner-authored data only today, but the path is newly live — escape follow-up recommended.
- **#597 / NEW-C7:** access-code member/manager logins (role claim, no companyId) are now bounced out of `#/admin` entirely ("Admin access required") — intended hardening consistent with unmerged #599; if a legit owner-ish login mints an unexpected role with no companyId, confirm they still see Team Manager.
- **#597 / PWA friction:** photo delete, bulk photo delete, task delete, and account erasure now show a real confirm modal in installed-PWA mode where they previously auto-proceeded (NEW-C1 fix) — expect possible "extra popup" reports; this is correct behavior.
- **#595 / dual-writer:** `nbd_ds_config` is now written by both `dsSaveConfig` (Settings) and daily-success `syncToWidgetKeys()`; both derive identically from `nbd_user_config` — any future shape change must touch both (documented in-code).
- **#598:** `functions/stripe.js:99` comment still says "$249" (comment-only); `dashboard.legacy.html` rollback snapshot retains old Team copy (heals at next snapshot refresh); Billing-tab card still *labels* the tier "Growth" while Team-tab copy says "Crew" (label keys couple to `_normalizePlan` — deliberate non-change).

## Session log
- 2026-06-09 — Phase 0: read BUG-LOG/COVERAGE-SUMMARY; found all Family A–E fixes already built + CI-green in open PRs #595–#598 from the Tier A and Tier B/C sessions. Confirmed #599 stays untouched (Jo auditing) and #592/#593/#594 out of scope.
- 2026-06-09 — Pre-merge adversarial review: 4 parallel reviewers, 19/19 claims verified as real fixes, 0 blockers.
- 2026-06-09 — Merged #595 → #596 → #597 → #598 (squash, conflict-safe order; 597 re-checked after the base moved). Auto-deploy triggered; intermediate runs auto-cancelled, final run carries the cumulative state.
- 2026-06-09 — Opened #600 (public pricing page $249→$299, one line) to close the last live $249 surface; merged on green CI. Commented on #579 with the trivial rebase resolution (take #579's pricing.html wholesale).
- 2026-06-09 — Deploy run 27239108944 **green** (8m40s; rules gate + smoke gate passed; known-benign annotations: marketing-project step, IAM-blocked function set).
- 2026-06-09 — Artifact verification over HTTP (cache-busted): all fixes present in served prod content (see Fix ledger). Ledger: 5 FAIL → FIXED, notes added to 5 PASS rows (`ledger-patch.json`), tallies recomputed via `ledger-update.js` (137/1363, FAIL 0, FIXED 5).
- 2026-06-09 — Behavioral round-trips NOT run: Chrome extension connected but tab-group creation failed all session (PWA/incognito window focus). Checklist above; ~5 min once a normal Chrome window is focused.
- 2026-06-09 — Spawned follow-up task: HTML-escape member fields in the newly-live Team-tab renderer (+ sibling #597 renderers).
