# Session handoff — 2026-09-18

## Status: nothing queued, nothing in-flight

Two PRs shipped and merged this session. No open PR, no uncommitted
changes, no background task left running.

## What shipped

**PR #1641 — our-work/&lt;slug&gt; footer + nav CSS leak, full page this
time.** Jo screenshotted one `/our-work/<slug>` page showing a massive
unsized Google "G" icon and giant triangle SVGs in the footer, with direct
feedback that an earlier fix (PR #1638) had only addressed the specific
region an *earlier* screenshot showed, not the whole page. Two real bugs,
found by screenshotting the full page instead of just the reported region
and diffing computed styles against the reference page (`our-work.html`)
rather than eyeballing it:
- The footer had no social-icon CSS at all on the generated detail-page
  template (`scripts/build-projects.mjs`) — added, matching the reference
  page's actual rendered values (verified via `getComputedStyle()`, not
  copied from source — the reference page's `.5`-opacity base rule is
  overridden by a `!important` in an otherwise-dead "footer contrast fix"
  block, so the real live value is `.7`).
- PR #1638's `nav{...}` rule (scoped by *tag*, not class) was also matching
  the detail-page template's *second* `<nav>` — the breadcrumb — giving "←
  Back to Our Work" full navy site-header styling. Scoped to `nav.nav`,
  matching `nbd-nav.css`'s own `nav#mainNav.nav` precedent.

All 45 `/our-work/<slug>.html` pages regenerated via `build-projects.mjs`.
**Lesson for next time a screenshot bug comes in: screenshot the whole
page, not just the region shown, and diff live computed styles against a
known-good reference page rather than trusting what looks visually
plausible.**

**PR #1642 — Globals Tranche 3, two more T3-C edges.** Converted
`crm-portal-bridge.js`'s and `rep-report-generator.js`'s consumption of
`dashboard-bootstrap.module.js` globals (8 names total) from bare
`window.X` reads to `__NBD_CALL_REGISTRY` reads, following the established
T3-C pattern. Full detail, including the two corrections to the plan
doc's edge-count table (the `_reports` cache doesn't convert; the
`crm-pipeline.js` edge listed as "4" is actually zero real candidates plus
a `_dragId` landmine), is in
[globals-tranche3-plan.md](../../docs/dev/globals-tranche3-plan.md)'s
2026-09-18 update — read that before picking up the next T3-C edge so the
same misattribution doesn't get re-derived.

**Real CI failure caught and fixed mid-session, worth remembering
regardless of Tranche 3 progress:** `tests/customer-page-claims.test.js`
located `_saveReport`'s function body by `DASH_BOOT.indexOf('window.
_saveReport')` — a literal-string anchor that the T3-C conversion deleted,
so the lookup silently returned an empty slice and both assertions failed
quietly instead of erroring loudly. Root cause of missing this locally
before pushing: **this repo's CI "Smoke tests" job runs two separate
things** — `node tests/smoke.test.js` (the ~17-file orchestrator with its
own hardcoded `DOMAINS` list) AND `node scripts/run-test-manifest.js
--bucket smoke` (68 standalone manifest-bucket files, including the one
that broke). Only the first had been run locally all session; the second
is what actually caught this in CI. **Run both before trusting a green
local check on anything that touches `docs/pro/js/`.**

## Verification approach this session (worth keeping)

The sandbox's Playwright headless-shell binary is still missing (known,
pre-existing), so the authed E2E suite can't run locally — only plain
`/opt/pw-browsers/chromium` (non-headless-shell) works, via a direct
screenshot script with `executablePath` set explicitly. For the JS-globals
migration work, used two independent background adversarial-review agents
(one per file-group) to re-read the diff and hunt for correctness bugs
rather than trusting self-review alone, since live interactive-CRM E2E
wasn't feasible here. Both came back clean on the actual migration; both
also independently found the same real test-anchor bug above (one of them
mid-review, before I'd even reported it). Worth repeating on the next
Tranche 3 slice, especially T3-D's bigger single-owner clusters.

## If you're picking this up cold

Nothing is blocked, nothing is waiting on Jo. The next natural work is
either more WEEKLY_CADENCE backlog (check its current state — item 12 is
Tranche 3, now at T3-C ~162 names left) or whatever Jo asks for next.
Two things worth knowing before touching Tranche 3 again:

1. **Don't re-attempt the `crm-pipeline.js` edge as a T3-C edge.** It was
   listed as "4 names, 1 PR" and is actually zero — the candidates are
   `crm-stages.js` re-exports with real consumers elsewhere. It also has a
   `_dragId` bare-implicit-global landmine that needs a coordinated
   cross-file fix before any scoping attempt, or drag state will
   split-brain. See the plan doc.
2. **A pre-existing (not-this-session's-bug) landmine flagged but not
   fixed:** `dashboard-bootstrap.module.js`'s `_loadDeletedLeads` does a
   bare `return;` on its early-out (unlike its sibling `_loadReports`,
   which correctly does `return [];`). `crm-portal-bridge.js`'s
   `renderDeletedDrawer` calls `.length` on the result with no try/catch,
   so opening the Deleted drawer before claims resolve could throw. One-
   line fix (`return [];`) whenever someone's next in that file — not
   worth its own PR alone.

This session ended by choice, not because anything was blocked — the
transcript had already been compacted once and the standing judgment was
that a fresh session (starting from this file and the plan doc, not from
re-derived memory) beats pushing one compacted context further.
