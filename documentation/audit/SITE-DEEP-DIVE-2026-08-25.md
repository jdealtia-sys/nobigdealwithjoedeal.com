# SITE DEEP-DIVE — 2026-08-25

Jo asked for "the works": a general review of the whole site — bugs, breaks,
mistakes, format, fonts, sizing — changing nothing without a reason. This note is
the evidence trail. Companion session note (the two new blog posts shipped the same
day): [SESSION-2026-08-25-lexington-call-posts](../projects/SESSION-2026-08-25-lexington-call-posts.md).

**Headline: the site is clean.** Every CI gate green at baseline, zero broken
internal references across 231 pages, zero JSON-LD parse errors, zero placeholder
text, zero mixed content, and the rendered sweep verdict below. Three small
metadata fixes were the only defects worth touching; ten other flags all resolved
to *deliberate* on inspection.

## Method

1. **All repo gates, on the untouched tree** (baseline), then again after changes:
   check-js-syntax · check-site-integrity · apply-partials --check · build-sitemap
   (drift) · build-feed (drift) · build-projects --check · check-inline-html-scripts ·
   check-image-privacy · marketing-polish-contract (53 checks) ·
   check-chrome-governance · ensure-icon-css · ensure-nav-css. **All green, both runs.**
2. **Static passes the gates don't cover** (session script, 231 pages = marketing
   surface + public /pro pages): every `href`/`src` resolves on disk under
   cleanUrls rules; every JSON-LD block parses; title present/≤68 + duplicate
   detection; meta description present/≤165; lorem/TODO/FIXME/`JO:` in visible
   text; `http://` subresources.
3. **Rendered sweep** — `qc-render-sweep.js` (208+ pages × desktop + 390px mobile,
   real Chromium). Sandbox note for future sessions: the repo's Playwright wants a
   browser build the remote container lacks and `playwright install` is blocked
   there; a symlink shim of the preinstalled Chromium under
   `PLAYWRIGHT_BROWSERS_PATH` works (Chromium 141 vs. pinned 1228 build — rendering
   parity fine for these assertions).
4. **Eyeball pass** — full-page screenshots of the two new posts (both widths),
   blog index (featured card + static/JS card parity), homepage; horizontal-overflow
   probe at 390px: 0px everywhere checked.

## Fixed (3 — all indexed-page SERP-truncation nits)

| Page | Was | Now |
|---|---|---|
| `docs/careers.html` | meta description 193 chars | 154 (dropped the workers'-comp tail, kept W2/paid-weekly) |
| `docs/services/emergency-roof-tarping.html` | meta description 171 chars | 141 (tightened the middle clause) |
| `docs/partners.html` | title 69 chars | 62 ("\| No Big Deal Home Solutions" → "\| NBD Home Solutions") |

## Flagged but deliberate (10 — do NOT "fix" these)

- `googlee5b8f461f0f8e74b.html` (no title/desc) — Google verification file; must stay bare.
- `offline.html` (no desc) — PWA offline fallback, not a search surface.
- `tools/index.html` (no desc) — internal ops hub, `noindex,nofollow`.
- `sites/index.html` + `sites/free-guide/index.html` (long titles) — both
  deliberately noindexed (free-guide via meta; sites/index kept out of robots.txt
  precisely so crawlers can see its noindex). Title length is tab-cosmetic only.
- `sites/oaks/**` (1 missing desc on its 404, 3 long titles) — Scott's portable
  microsite: robots-blocked here, ships to his own domain, and the 2026-08-20
  handoff says hands off beyond the launch checklist.

## Rendered sweep result

See `RENDER-SWEEP-RESULT` addendum at the bottom of this note (the sweep finishes
after the static passes; result recorded same-session).

## What this audit did NOT re-litigate

The 2026-08-19 design-consistency sweep adjudicated 141 chrome/type/color findings
(83 fixed, 43 refuted, 15 deliberate) and its variant tables remain the authority
on which header/footer variants are legitimate. Nothing in this pass contradicted
it, and no re-audit of those dimensions was attempted nine days later.

## Session takeaways

- The gate suite plus chrome governance now catches essentially everything
  grep-shaped; the residual finding class is *metadata length hygiene*, which no
  gate asserts. If it recurs, fold title/desc length checks into
  `check-site-integrity.js` rather than hand-sweeping. Not done now — two
  occurrences in one sweep isn't a pattern yet.
- `tests/package-lock.json` drifts the moment anything `npm install`s in `tests/`
  under the sandbox proxy (the known `proxy-agent-negotiate` churn, warned about in
  CLAUDE.md) — reverted before commit here; watch for it in any session that runs
  the emulator or Playwright suites.

---

## RENDER-SWEEP-RESULT (recorded 2026-08-25, same session)

**229 pages × 2 viewports rendered; zero style/layout findings.** No icon-sizing
regressions, no nav splatter, no duplicated style blocks, no cascade defects — the
four historical failure signatures the sweep asserts all stayed closed, including
on the two new blog posts.

The only 4 findings were `page-error` navigation timeouts on **/pro/login** and
**/pro/register** (both viewports) — **sandbox artifact, not a defect**: both pages
serve 200 locally and load fine; they block their `load` event on *external Google
Fonts stylesheets*, which stall through the remote container's proxy. CI (with
normal egress) is unaffected.

Real observation extracted from the noise, filed as observation-not-defect: the
homeowner surface self-hosts fonts (`/assets/css/nbd-fonts.css`, after the 2026-07
font-preconnect cleanup) while `/pro` auth pages still load Google Fonts CSS
synchronously — a render-blocking third-party dependency the rest of the site
deliberately shed. Whether Pro should self-host too is a product/perf decision for
a Pro-focused session, not a cleanup fix; noting it here so the next Pro session
sees it.
