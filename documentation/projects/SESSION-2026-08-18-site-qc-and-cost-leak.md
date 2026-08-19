# Session archive — site QC sweep, /pro claim audit, cost leak (2026-08-18)

Branch `qc/site-sweep-2026-08-18`, 19 commits off `b8e160b9`. Started as "run QC
checks across the site — here are a few URLs with visual issues"; ended in a live
contractor-cost leak and a money-math fix.

Filename note: `NEXT_SESSION-2026-08-18.md` was already taken by the
deploy-pipeline lane on another branch, so this uses the `SESSION-<date>-<topic>`
convention to avoid a merge collision.

Companion notes:
[SITE-QC-SWEEP-2026-08-18](../audit/SITE-QC-SWEEP-2026-08-18.md) ·
[JOB-TEMPLATE-COST-LEAK-2026-08-18](../audit/JOB-TEMPLATE-COST-LEAK-2026-08-18.md) ·
[JOB-TEMPLATE-COST-MIGRATION-PLAN-2026-08-18](JOB-TEMPLATE-COST-MIGRATION-PLAN-2026-08-18.md)

## The through-line: guards defeated by their own lists

Three separate failures this session shared one shape. Worth naming because a
fourth is presumably waiting somewhere.

| guard | how it was defeated |
|---|---|
| `ensure-icon-css.js` | walk skipped `sites`/`pro` + a stale `free-guide` entry → `/sites/free-guide` shipped `svg.ico` at **1227px** |
| `catalog-cost-privacy.test.js` | `STRICT_FILES` allowlist never included `job-templates-data.js` → 146 contractor cost values published, suite green at 48/48 |
| `check-site-integrity.js` | skips `docs/pro/**` entirely → the public `/pro` pages had no link/asset coverage at all |

**A guard with an inclusion or exclusion list is only as strong as that list, and
a hole in it is indistinguishable from a pass.** The durable pattern is scan by
default, exempt explicitly, and state the reason at the exemption.

## Shipped

**Visual / QC**
- `/sites/free-guide` icon fixed (1227px → 13px); also 5 unstyled `.mnav-group`
  headers and a double-escaped `&rarr;` on the same line.
- `ensure-icon-css.js` walk widened; 6 further pages normalised off legacy inline
  blocks (113 lines of duplicated CSS removed).
- **`scripts/qc-render-sweep.js` — the first *rendered* gate in the repo.** Every
  other docs/ check is grep-shaped and cannot compute a style, which is why four
  cascade/layout bugs in two days were all caught by eye. 216 pages × 2 viewports.
  Advisory in CI. **Validated against the real defect** — with the free-guide fix
  reverted it reports the 1242px icon; a checker that has only ever printed
  "clean" proves nothing.
- Its one further finding: `/services/gutter-replacement` overflowed 20px at
  390px (`.content-card` min-content 379px = padding + a stat-grid whose widest
  cell can't wrap). 12 sibling pages share the pattern and don't overflow *today*.

**/pro**
- Byte-identical `landing.html` duplicate folded into `/pro` with a 301; 78
  inbound refs rewritten rather than left leaning on the redirect.
- **A 24-agent claim audit** verified 12 high-risk claims against source, each
  adversarially re-checked. 4 confirmed, 2 unverifiable, **6 wrong** — the
  "5-year storm report for any US address" (three ways wrong), "9 are e-sign
  ready" (actually 3), "your data is backed up" (Storage binaries are not),
  "owner history" (no such feature; for a rep it's a Haiku guess), 15→16
  outcomes. Stripe's 3.4% survived.
- CTAs said "Start Free Trial" but carry no plan param → free signup, not a
  trial. Price ratio contradicted itself across four surfaces ("one-third the
  price" vs "1/3 less").
- Hero figures labelled **Sample data**, 11 panels **Illustration**, 2 real
  captures **Live sandbox**.
- WCAG: white-on-orange CTAs were 3.07:1. Fixed to the `#B85400` the homeowner
  site *already* used — plus hover states that were *less* legible than rest
  (2.68:1 on `/pro`, and an `--orange-dark` token on `/inspect` that was lighter
  than the colour it darkened).

**Money math**
- **PR-A landed** (`d8afd7e3`): a reopened estimate no longer re-prices itself
  off the live catalog. Pre-existing bug — any edit after reopen flipped
  `_reopenedClean` false while `_editingEstimateId` still pointed at the customer
  doc, so a nudge-and-save rewrote quoted work. `tests/estimate-reopen-cost-basis.test.js`
  pins it (10 assertions; 7 fail with the fix reverted).

## Open — in priority order

1. **PR-B — the cost leak is still live.** `docs/pro/js/job-templates-data.js`
   publishes 146 contractor cost values, and `estimate-logic-engine.js` publishes
   the markup beside it. Plan is written and executable; a background task was
   spun off for it. Two findings there are counter-intuitive — **emit explicit
   zeros, never omit the keys** (omitting activates `inferLaborId` against the
   still-public labor catalog and repriced 14 items in testing), and PR-A was its
   prerequisite.
2. **Rotate the cost figures.** The only step that touches copies already in git
   history, forks and clones. Independent of PR-B; smaller than it.
3. **Change the privacy guard to scan-by-default.** Adding one filename fixes
   today and leaves the mechanism.
4. **Seeded demo route.** All 11 `/pro` panels are drivable (9 small effort, 0
   blocked); plan recommends 4 worth building, ~3 sessions. **Hazard:** the
   engines read origin-scoped storage keys production owns, so a signed-in rep
   visiting a public demo would have their real Academy progress and Ask Joe
   transcript overwritten. Needs a ~25-line storage shim first.
5. `/pro` copy/visual redesign — objective defects are fixed and the "thin
   responsive coverage" premise **did not survive measurement** (zero horizontal
   overflow at 320→1440). What remains is subjective and needs Jo's direction.
6. Tap targets: 14–24 controls under 32px on `/pro`. Site-wide item already
   awaiting Jo's call in the June sweep.

## Retracted — do not re-investigate

- **`the-pledge` missing `mobile-cta.css`** — deliberate. That CSS file's own
  header says the homepage and `/the-pledge` keep their own bottom bars; the page
  ships its own `.stickybar`.
- **`sitemap.xml` drift** — pure Windows line endings (`git ls-files --eol` →
  `i/lf w/crlf`). Normalise both sides and the entire difference is two blank
  lines. 203 URLs identical. **Do not run `--write`.**

## Notes for whoever picks this up

- This checkout is shared with parallel sessions (~10 worktrees). An uncommitted
  CRM address-audit lane (16 files incl. `tests/ci-manifest.json`,
  `docs/pro/customer.html`) sat in the tree all session and was never touched —
  commit **explicit file lists**, never `git add -A`. `INDEX.md` and
  `ci-manifest.json` both needed reset-add-restore to stage only this lane's line.
- A stale `.git/index.lock` (0 bytes, 4h old, no git process) silently failed a
  `git stash` mid-session and invalidated a check — verify stash/checkout actually
  did what you asked.
- `documentation/` is in the **same public repo** as `docs/`. A note about a leak
  must not quote the leaked values; both cost notes had to be redacted before
  push.
- Browser-pane screenshots fail whenever the pane is hidden. Drive Playwright
  from `tests/node_modules` instead, and note `firebase serve` does **not**
  process redirects — pre-existing `/yardsign` and `/sites/oaks` 404 locally too.
