# NBD Pro CRM — Visibility & Functionality Audit

**Branch:** `claude/crm-audit-testing-5q88n`
**Date:** 2026-05-08
**Scope:** Every HTML page under `docs/pro/` (the NBD Pro CRM surface) plus
the JS modules that power them, plus the existing test suite.

This audit answers: does the CRM **load**, are elements **visible**, are
buttons **clickable**, and are handlers **wired**?

---

## TL;DR

| Layer | Status |
|---|---|
| Existing unit/smoke tests | **899 + 38 + 10 + 8 = 955 / 955 passing** |
| Static page audit (22 CRM pages) | **0 hard errors**, 3 guarded warnings, 11 minor info findings |
| Cloud functions parse | ✅ all 36 exports load |
| Firestore rules structure | ✅ role-based, sane defaults |

The CRM is in good shape. No broken script paths, no stale handler
references, no dead-end navigation, no parse errors. The remaining
findings are minor cosmetic items, all triaged below.

---

## What was tested

### 1. Pages audited (22)

`ai-tool-finder.html` · `ai-tree.html` · `analytics.html` ·
`ask-joe.html` · `codex.html` · `customer.html` · `dashboard.html` ·
`dashboard.legacy.html` · `demo.html` · `diagnostic.html` ·
`estimate-view.html` · `index.html` · `landing.html` ·
`leaderboard.html` · `login.html` · `portal.html` · `pricing.html` ·
`project-codex.html` · `register.html` · `stripe-success.html` ·
`understand.html` · `vault.html`

### 2. JS surface indexed

**2,403** function/global symbols across the entire `docs/pro/js/`
tree (~140 files), used to resolve every `onclick="foo(...)"` inline
handler back to a real definition.

### 3. Checks performed (per page)

1. Every `<script src="...">` resolves to a real file
2. Every `<link rel="stylesheet|preload|icon|manifest" href="...">` resolves
3. Every `onclick` / `onsubmit` / `onchange` / `oninput` / `onkeydown`
   etc. attribute resolves to a function defined either inline or in
   one of the loaded JS modules
4. Every `<a href="#someId">` has a matching id on the page
5. Buttons + anchors have visible text, aria-label, or title
6. No duplicate `id="..."` attributes (outside `<script>` blocks)
7. Inline `<script>` blocks parse cleanly under `node --check`
   (skips JSON-LD / JSON / importmap blocks correctly)
8. Forms with an id are wired by either the page or an external module
9. Images carry an `alt` attribute
10. **Visibility:** any `id="X" style="display:none"` element is
    actually referenced somewhere (so the user can ever see it).
    Recognises ids constructed dynamically via `'prefix' + suffix`
    (e.g. `'estStep' + i`, `'stab-panel-' + tab`).

### 4. Tooling

`scripts/crm-audit.js` — single dependency-free Node script.
**Usage:**

```bash
node scripts/crm-audit.js                 # full audit
node scripts/crm-audit.js --json          # machine-readable
node scripts/crm-audit.js --quiet         # errors + warnings only
node scripts/crm-audit.js --page=dashboard.html
node scripts/crm-audit.js --severity=error
```

Returns exit code 1 if any `[ERROR]` finding is present so it can
slot into CI as a regression gate.

---

## Existing test suite results

| Suite | Result | Notes |
|---|---|---|
| `tests/smoke.test.js` | **899 / 899 passed** | Static smoke over critical JS contracts |
| `tests/estimate-pricing.test.js` | **38 / 38 passed** | Pricing math, deposit calc, add-ons |
| `tests/state-store.test.js` | **10 / 10 passed** | Cross-tab pub/sub state-store |
| `tests/address-match.test.js` | **8 / 8 passed** | Estimate→lead address resolver |
| `tests/firestore-rules.test.js` | **not run** | Requires Firebase emulator (not in this env) |
| `tests/storage-rules.test.js` | **not run** | Requires Firebase Storage emulator |
| `tests/rate-limit.test.js` | **not run** | Requires emulator |
| `tests/e2e/*.spec.js` (Playwright) | **not run** | Requires `playwright install` + live URL |

Recommendation: run `npm --prefix tests run test:rules`,
`test:storage`, `test:ratelimit` and `test:e2e:public` in CI to lock
in the parts that need live infra.

---

## Findings

### [ERROR] — 0 issues

No broken scripts, no broken stylesheets, no inline-syntax errors.

### [WARN] — 3 issues, all guarded

These are **not bugs** — every call site is wrapped in
`if (typeof X === 'function') X(); else showToast('...')`. Listing them
so the team can decide whether to define the function or remove the
guarded button. Each click currently shows a toast instead of opening
the intended modal.

| # | Page | Handler | Current behaviour |
|---|---|---|---|
| 1 | `dashboard.html:10819` | `openUploadDocModal()` | Toast "Click ＋ Upload above" |
| 2 | `dashboard.html:12135` | `openCustomerPortalSession()` | Toast "Manage subscription from the pricing page" |
| 3 | `dashboard.legacy.html` | `openCustomerPortalSession()` | Same as #2 (legacy fallback page) |

**Recommendation:** either implement these helpers or replace the
button with the actual fallback path (a link to `/pro/pricing.html`,
or just remove the "Upload a document" button and have the user use
the existing `+` Upload control above).

### [INFO] — 11 minor findings

| Page | Code | Count | Detail |
|---|---|---|---|
| `dashboard.legacy.html` | `DEAD_HIDDEN` | 1 | `id="tierBadge"` left in the legacy fallback (intentional — kept identical to legacy snapshot) |
| `index.html` | `EMPTY_ANCHOR` | 3 | nav-logo `<a href="#">` and footer "Privacy Policy" / "Terms of Service" placeholders |
| `landing.html` | `EMPTY_ANCHOR` | 3 | Same pattern as index.html |
| `project-codex.html` | `EMPTY_BUTTON` | 2 | Refresh + close icons rendered as HTML entities (`&#x21bb;`, `&#10005;`) — visible to users, audit's strip just doesn't reconstruct entities |
| `understand.html` | `EMPTY_BUTTON` | 2 | Send arrow + close X — same pattern as project-codex |

The `EMPTY_BUTTON` items are **false positives by audit limitation** —
the buttons render correctly because HTML entities decode in the
browser. Documented for completeness.

The `EMPTY_ANCHOR` findings on `index.html` / `landing.html` are
real-but-minor: the nav-logo and footer "Privacy Policy" / "Terms of
Service" links currently have `href="#"` and no onclick, so clicking
them does nothing. **Recommended fix:** point them at `/privacy.html`
(which exists) and replace `nav-logo`'s `href="#"` with `/`.

---

## Fixes applied in this PR

1. **`docs/pro/stripe-success.html`** — Removed dead `<div id="statusBox">`.
   The post-rewrite controller (`js/pages/stripe-success.js`) only ever
   shows `stepActivate` / `stepCreate` / `stepDone`; `statusBox` was an
   orphan from the previous implementation, set to `display:none` and
   never revealed.

2. **`docs/pro/dashboard.html`** — Removed dead `<span id="tierBadge">`.
   The element sat next to the Settings page title with `display:none`
   and no JS path to ever populate or reveal it. Saves a few bytes on
   the largest file in the codebase.

3. **`docs/pro/portal.html`** — Added `alt="Photo preview"` to the
   dynamically-inserted preview thumbnail in the customer photo upload
   helper (line 1145). Other portal images already had alt text via
   `alt="' + esc(p.caption || p.phase || '') + '"`.

4. **`scripts/crm-audit.js`** — New static audit tool (this report's
   engine). Re-runnable in CI as a visibility/wiring regression gate.

---

## How to run the audit again

```bash
# Full audit, shows everything:
node scripts/crm-audit.js

# CI-friendly: only fail on hard errors:
node scripts/crm-audit.js --severity=error

# Audit a single page:
node scripts/crm-audit.js --page=dashboard.html

# JSON for downstream tooling:
node scripts/crm-audit.js --json
```

The audit exits with code 1 if any `[ERROR]`-severity finding is
recorded, so a single line in CI catches future regressions:

```yaml
- run: node scripts/crm-audit.js --severity=error
```

---

## Coverage gaps (worth doing next)

1. **Live in-browser smoke** — the static audit can't catch runtime
   visibility bugs (e.g. CSS that hides an element on a specific
   breakpoint, or a JS error during initial paint). The Playwright
   `pro-public.spec.js` covers some of this for `/pro/login.html` and
   `/pro/pricing.html`; expand to all 22 pages with a single
   parameterised "loads, no console errors, no visible-but-empty
   regions" test.

2. **Authenticated kanban smoke** — `pro-authed.spec.js` already
   covers login → kanban → drag-stage. Wire `PLAYWRIGHT_TEST_USER_*`
   secrets in CI to actually run it.

3. **Firestore rules + storage rules + rate limit** — three separate
   emulator-backed test suites already exist (`firestore-rules.test.js`,
   `storage-rules.test.js`, `rate-limit.test.js`). They aren't run
   here because the Firebase emulator isn't installed in this
   environment. Run them in CI.

4. **A11y sweep** — beyond `alt` text and aria-label coverage, run
   axe-core / Lighthouse against every page in the matrix to catch
   contrast / focus-trap / heading-order regressions.
