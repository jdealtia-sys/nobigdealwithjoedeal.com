# Big Rocks — Multi-Session Briefs

Four architectural projects too large to land in a single chat session. Each
is written self-contained so a fresh agent can pick it up cold.

When you start one of these, branch off `main`, ship in small PRs (not one
giant one), and verify each step on the live site at `https://nobigdealwithjoedeal.com`
before moving to the next. All previous fixes (PRs #28–#42) are live on main —
do not re-do work that's already shipped.

Run tests with `cd tests && npm install && npm test`. Smoke + pricing + address
+ inline-html-scripts should all pass green before opening any PR.

---

## ROCK 1 — Hosting cutover to Firebase (mostly DNS)

### Goal
Swap public `nobigdealwithjoedeal.com` from GitHub Pages → Firebase Hosting so
the security headers in `firebase.json` (Referrer-Policy, dev/** ignore,
Permissions-Policy, etc.) actually apply to live traffic.

### Why it matters
GitHub Pages serves `Server: GitHub.com` and ignores every header in
`firebase.json`. Every Referrer-Policy / dev/** ignore / `unsafe-inline`
hardening from PRs #32, #33, #38 is currently dead code on the public domain.
The Firebase deploy already pushes the live site to `nobigdeal-pro.web.app`
with all headers working — verified via `curl -I https://nobigdeal-pro.web.app/pro/js/ai.js`.

### What's already done
- `firebase.json` is fully configured with hosting + CSP + cache rules
- `.github/workflows/firebase-deploy.yml` runs on every push to main and has
  succeeded on every recent PR
- Firebase Hosting is serving `nobigdeal-pro.web.app` with the latest content
- The `FIREBASE_SERVICE_ACCOUNT` GitHub secret is set (deploys would skip
  cleanly otherwise)
- `_legacy/` folder lives outside `docs/` so the dev/** ignore is moot now;
  it's already private regardless of host

### What's left
1. **Add custom domain in Firebase Console** (Joe action, but agent should
   write the exact runbook):
   - Firebase Console → `nobigdeal-pro` project → Hosting → "Add custom domain"
   - Enter `nobigdealwithjoedeal.com` and `www.nobigdealwithjoedeal.com`
   - Firebase will issue TXT records for verification, then A/AAAA records
     for the cutover
2. **Update DNS** at the registrar (Joe action — likely Cloudflare DNS or
   GoDaddy):
   - Replace GitHub Pages A records (`185.199.108.153`, `.109.153`, `.110.153`,
     `.111.153`) with Firebase Hosting A records (issued by step 1)
   - Update CNAME on `www` if applicable
3. **Wait for SSL provisioning** (Firebase issues Let's Encrypt cert, takes
   15–60 min after DNS propagates)
4. **Disable GitHub Pages** in repo Settings → Pages → set to "None" so it
   stops serving stale content
5. **Update workflows**:
   - `.github/workflows/pages.yml` (if it exists) — disable
   - Keep `firebase-deploy.yml` as-is
6. **Verify post-cutover**:
   - `curl -I https://nobigdealwithjoedeal.com/pro/js/ai.js` should return
     `Server: Google Frontend` (not `Server: GitHub.com`) and include
     `Referrer-Policy: strict-origin-when-cross-origin`
   - `curl -I https://nobigdealwithjoedeal.com/dev/legacy/POST_DEPLOY_CHECKLIST.md`
     should return 404 (file lives under `_legacy/` outside the public root —
     was already 404 on Pages too)

### Risk
LOW — infra-only, no app code touched. Worst case: DNS rollback to GitHub
Pages records restores the prior state immediately.

### Estimated work
60 min agent + 30 min Joe (DNS + cert wait).

### Files touched
- Possibly `.github/workflows/pages.yml` (disable)
- Possibly `firebase.json` (add `redirects` for legacy paths if any breakage)
- New `docs/dev/legacy/HOSTING_MIGRATION.md` runbook (or keep at repo root)

### Definition of done
- `curl -sI https://nobigdealwithjoedeal.com/pro/js/ai.js | grep Referrer-Policy` returns the header
- `curl -sI https://nobigdealwithjoedeal.com | grep "^Server"` returns Google, not GitHub
- All 769 tests still pass
- A test PR (no app changes) confirms the firebase deploy still completes

---

## ROCK 2 — Estimate engine consolidation (3 → 1)

### Goal
Eliminate `estimates.js` and `estimate-logic-engine.js` as live calculation
paths; make `estimate-builder-v2.js` (EBv2) the single source of truth for all
pricing math.

### Why it matters
Three independent pricing engines run today:
- [estimates.js](docs/pro/js/estimates.js) — 1,276 lines, classic builder; has
  fallback paths still wired into one menu item
- [estimate-builder-v2.js](docs/pro/js/estimate-builder-v2.js) — 893 lines, the
  spec-compliant canonical engine ($545/$595/$660 per-SQ, county tax, etc.)
- [estimate-logic-engine.js](docs/pro/js/estimate-logic-engine.js) — 898 lines,
  formula-evaluator catalog used by the line-item path

Each can drift independently. Customer A signs a $23,750 estimate; the same
inputs through the other engine produce $24,100. The Session 1 fix made
`_saveEstimate` re-throw instead of silently returning null, so failed saves
surface — but nothing prevents the engines themselves from disagreeing.

The pricing test suite [tests/estimate-pricing.test.js](tests/estimate-pricing.test.js)
locks in EBv2's behavior. Use it as the canonical reference.

### What's already done
- 23 unit tests in `tests/estimate-pricing.test.js` lock in TIER_RATES,
  county tax, $2,500 minimum, $25 rounding, tear-off layers, pipe boots
- Custom presets API (`saveCustomPreset`, etc.) shipped on EBv2
- `_saveEstimate` re-throws on Firestore failure (no more silent loss)
- Address-match regression test in `tests/address-match.test.js`

### What's left
This is a multi-PR migration. **Do not collapse it into one giant PR.**

1. **PR 1: Audit pass — find every call site** (no code changes)
   ```bash
   grep -rn "calcEstimateTotalCents\|updateEstCalc\|getLineItems\|buildReview" docs/pro/
   grep -rn "resolveLineItem\|resolveEstimate\|calculatePerSq" docs/pro/
   grep -rn "calculateEstimate\|calculateAllTiers\|EstimateBuilderV2\." docs/pro/
   ```
   Document who calls what in `docs/dev/estimate-engines-audit.md`.

2. **PR 2: Mark legacy paths @deprecated** in `estimates.js` JSDoc + console.warn
   when the legacy path runs. Don't delete yet.

3. **PR 3: Migrate the menu-item entry point** (`startNewEstimateOriginal`,
   referenced once at line ~922) to call EBv2. If that path is genuinely
   unused after 30 days of warning logs from PR 2, delete it.

4. **PR 4: Migrate any line-item rendering** that still uses
   `estimate-logic-engine.js` formulas. The engine itself can stay (the
   sandboxed `new Function()` evaluator is sound) but it should only be
   reachable from EBv2's line-item path, not from a parallel route.

5. **PR 5: Final consolidation** — delete the deprecated functions, drop the
   `estimates.js` module if empty, update `tests/estimate-pricing.test.js` to
   import EBv2 directly with no aliasing.

### Risk
MEDIUM. Pricing math is high-stakes. Each PR must:
- Run `node tests/estimate-pricing.test.js` (23 tests must pass)
- Manually save 3–5 estimates via the live UI and verify totals match the
  legacy values to the dollar
- Use feature flags (`window.NBD_ENGINE_V2 = true|false`) so any single PR
  can be toggled off without a revert

### Estimated work
3–5 sessions, one PR each. Don't rush.

### Files touched
- `docs/pro/js/estimates.js`
- `docs/pro/js/estimate-builder-v2.js`
- `docs/pro/js/estimate-logic-engine.js`
- `docs/pro/js/estimate-v2-ui.js`
- `docs/pro/js/estimate-finalization.js`
- `docs/pro/js/estimate-supplement.js`
- `docs/pro/dashboard.html` (if any inline estimate code remains)
- `tests/estimate-pricing.test.js`

### Definition of done
- `estimates.js` is deleted OR contains only thin compat shims that delegate
  to EBv2
- All 23 pricing tests still pass
- Live save test: 5 distinct estimate scenarios produce identical dollar
  amounts before/after the migration
- Code-reviewer agent gives a clean review

---

## ROCK 3 — Authenticated E2E test suite

### Goal
Stand up a real Playwright test suite that exercises authenticated flows end
to end: login → save lead → save estimate → move kanban card → generate doc →
upload photo → send invoice. Run them in CI.

### Why it matters
The current `tests/e2e/pro-public.spec.js` only covers unauthenticated public
pages (login screen, register, marketing). `tests/e2e/pro-authed.spec.js`
exists as a stub but is gated behind a `PLAYWRIGHT_TEST_USER` secret that's
not wired. Every "money path" — save lead, save estimate, move card, send
invoice — has zero behavioral coverage. The Session 1–5 fixes added unit tests
for pricing math and the address match, but those don't catch UI regressions.

### What's already done
- Playwright is configured (`tests/playwright.config.js`)
- `tests/e2e/pro-public.spec.js` runs in CI via `npm run test:e2e`
- `pro-authed.spec.js` skeleton exists with TODO comments
- Firestore rules + storage rules tests run against the emulator (those are
  already authoritative for security boundaries)

### What's left

1. **Provision a test Firebase auth user**:
   - Create a dedicated GCP project `nbd-pro-test` OR a sandboxed user in
     `nobigdeal-pro` with email `playwright-e2e@nbd.test` (use Firebase Auth
     Emulator for full isolation)
   - Add `PLAYWRIGHT_TEST_USER_EMAIL` and `PLAYWRIGHT_TEST_USER_PASSWORD` as
     GitHub Actions secrets
   - Build a test-data setup script (`tests/e2e/fixtures/seed.js`) that runs
     before each test to reset to a known state

2. **Write the journeys** — these specifically cover Session 1–5 fixes:
   - **Login flow**: enter credentials → land on dashboard → kanban renders
   - **Save lead**: open new lead modal → fill all fields → save → assert it
     appears in kanban + Firestore has `customerId` set to `NBD-####` (locks
     in PR #38 T1)
   - **Move stage**: drag card to next column → assert timeline note appears,
     `stageStartedAt` updates in Firestore (locks in PR #40 T18 + PR #42 #6)
   - **Save estimate**: build per-SQ estimate at $545/SQ × 30 SQ → assert
     grand total matches expected math, doc persists, address-match links
     to the right lead (locks in PR #29 + #38 T6)
   - **Generate document**: from customer page, generate proposal → assert
     `leads/{id}/documents` subcollection has the new entry with `htmlPath`
     set (locks in PR #38 T2 + #42 #1)
   - **Send invoice**: create + send via portal method → assert atomic
     batch write succeeds (locks in PR #28 + #39 T19)
   - **Photo upload with phase**: upload with "before" tag → assert
     Firestore `photos` doc has `phase: 'Before'` (locks in PR #41 T16)
   - **Trial banner**: with `_subscription.status='trialing'` user, dashboard
     shows trial countdown banner (locks in PR #40 T11)

3. **Wire CI**:
   - Update `.github/workflows/ci.yml` to run `npm run test:e2e:authed`
     against the deployed preview URL (or the firebase preview channel, since
     hosting is on Firebase)
   - Mark the job as `continue-on-error: true` initially so failures don't
     block merges; flip to required after 2 weeks of green runs

4. **Add visual snapshots**:
   - Use `@playwright/test` snapshot testing on the kanban view, customer hero,
     and estimate builder — catches CSS regressions

### Risk
MEDIUM. E2E tests are notoriously flaky. Mitigations:
- Use Firebase Auth Emulator + Firestore Emulator instead of hitting prod
- Idempotent seeds (each test starts from a known state)
- Hard timeouts + retries on flaky network calls
- Run on Firebase preview channels, not production

### Estimated work
1–2 sessions. The journeys are well-defined; the fiddly part is auth + seed.

### Files touched
- `tests/e2e/pro-authed.spec.js` (build it out)
- `tests/e2e/fixtures/seed.js` (new — reset state)
- `tests/e2e/fixtures/auth.js` (new — login helper)
- `tests/playwright.config.js` (add authed project)
- `.github/workflows/ci.yml` (add e2e:authed job)
- `tests/package.json` (add scripts)

### Definition of done
- 8+ authed journeys passing locally and in CI
- Visual snapshots for 3+ key views
- Documentation in `tests/e2e/README.md` for how to run + extend

---

## ROCK 4 — `dashboard.html` decomposition

### Goal
Break the 14,751-line `docs/pro/dashboard.html` god file into focused modules.

### Why it matters
- One file with 19 views, 16 modals, 9 inline `<style>` blocks, 77 `<script>`
  tags, ~415 inline `onclick` handlers
- Critical-path JS exceeds ~1.5MB uncompressed; iOS LTE first paint is 5–8s
- CSP can't tighten beyond `unsafe-inline` until inline handlers migrate to
  delegation
- Any structural change requires grepping 15K lines
- Theme system embeds 147 themes inline (~80KB CSS) on every page load

### Why this is HARD
- Every view shares `window.*` globals (`_leads`, `_user`, `_db`, `_estimates`,
  `_photoCache`, `_taskCache`, etc.). Extracting one view doesn't free those
  globals — the whole shell still loads them
- `goTo()` navigation, theme switching, and auth gate are all coupled at the
  page level. View-by-view extraction needs a router
- 79 separate JS modules already shipped and wired; extracting HTML/CSS doesn't
  reduce JS load
- Dragging breakage is invisible until users hit it on iPhone in the field

### What's already done
- Z-index design tokens introduced in PR #30 (`--z-base/sticky/dropdown/.../emergency`)
- `console-quiet.js` silences prod logs (PR #30)
- Critical fonts split from theme alt-fonts (deferred preload, PR #30)
- iOS auto-zoom kill (PR #30)
- Mobile dropdown fixed-position (PR #36)
- Mobile kanban density (PR #35)
- Some dropdowns + modals already use delegated `data-action` listeners

### What's left

This is **5+ sessions, one PR per phase**. Don't merge any phase that hasn't
been individually verified on iPhone Safari in the field.

#### Phase 1: Inventory + extraction plan (1 session, 0 code changes)
- Generate a manifest of every view (`view-crm`, `view-d2d`, `view-photos`,
  etc.) with: line range, dependencies on `window.*` globals, inline handler
  count, modal references
- Output: `docs/dev/dashboard-decomposition-plan.md`
- Decide extraction order — start with smallest, lowest-risk views

#### Phase 2: Extract one CSS block (1 session)
- Move the 147-theme `<style id="theme-system">` block (lines ~6-84) to
  `docs/pro/css/theme-system.css`. Already has a corresponding file.
- Verify dashboard still renders + theme picker still works
- This alone reclaims ~80KB of inline CSS from every page load

#### Phase 3: Extract one self-contained view (1 session)
- Pick `view-storm` or `view-aitree` — these are already mostly standalone
- Move the HTML to `docs/pro/views/storm.html` (template fragment)
- Move the inline `<style>` for that view to `docs/pro/css/views/storm.css`
- Replace inline `onclick=` with `data-action` + delegate
- Use `<template>` tag + JS clone-on-show for lazy mount
- Verify the view still works end-to-end

#### Phase 4: Repeat for next 3 views (1–2 sessions each)
- Apply the Phase 3 pattern to additional views
- After 3 views successfully extracted, the pattern is proven and the
  remaining ones are mechanical

#### Phase 5: Migrate inline handlers (1 session)
- The 415 `onclick=` handlers need a delegated listener at the body level.
  Search-and-replace tooling can do most of this:
  ```bash
  # Find every inline handler
  grep -oE 'onclick="[^"]+"' docs/pro/dashboard.html | sort -u
  ```
- Convert to `data-action="$NAME" data-args='{"id":"$ID"}'` with a single
  delegate at body level

#### Phase 6: Tighten CSP (1 session)
- Once inline handlers are gone, drop `'unsafe-inline'` from `script-src` in
  `firebase.json` (Hosting must be authoritative — see Rock 1)
- Use a per-request nonce or hash-based allowlist for the few remaining
  inline `<script>` blocks

### Risk
HIGH. This codebase is the daily driver — every regression hits Joe on his
iPhone in a yard. Mitigations:
- Feature-flag every phase with `?legacy=1` query string fallback that
  re-loads the old monolithic dashboard for emergency rollback
- Test EVERY phase on iPhone Safari (PWA + browser mode) before merging
- Visual regression snapshots (see Rock 3) catch CSS drift

### Estimated work
5–8 sessions. This is a multi-month project, not a multi-day one.

### Definition of done
- `dashboard.html` is under 5,000 lines
- Critical-path JS under 800KB uncompressed
- CSP `script-src` no longer needs `'unsafe-inline'` (or only with a nonce)
- iOS LTE first paint under 3s

---

## How to pick which to start

| If you have… | Start with |
|---|---|
| Full DNS + 1 hour | **Rock 1** — biggest leverage for least risk |
| 2-3 hours, want safer pricing | **Rock 2 PR 1+2** — audit + deprecation |
| Care most about preventing regressions | **Rock 3** — E2E coverage |
| Patience for a multi-month project | **Rock 4 Phase 1+2** — inventory + theme CSS extract |

Don't start more than one rock concurrently. Each one's failure modes are
different, and parallel context-switching across them is how regressions ship.
