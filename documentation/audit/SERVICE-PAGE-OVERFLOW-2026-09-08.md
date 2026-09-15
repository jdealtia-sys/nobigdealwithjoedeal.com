# Service-page horizontal overflow — 2026-09-08

Acting on [NAV-DRAWER-RELIABILITY-2026-09-08](NAV-DRAWER-RELIABILITY-2026-09-08.md)
§6.3, which filed "`/services/*` has 59px of horizontal overflow at 320px" as a
design decision for a later session: wrap the trust bar, or make it a deliberate
horizontal scroller.

**Neither. The trust bar has been a deliberate horizontal scroller since
2026-04-22, and at 320px it was never the cause.** The 59px is real; every other
part of the filed finding is wrong. What follows is what the measurements say.

Measured on Playwright **WebKit** at 320x508 against the local `docs/` tree,
and re-measured on Chromium (identical pixel values, so the CI gate can use the
browser CI already installs).

---

## 1. What the filed finding got wrong

| Filed (§6.3) | Measured |
|---|---|
| Cause is `.trust-item{flex:1}` | Cause is `.content-grid` / `.stat-grid` / `.footer-grid` tracks written `1fr` |
| "spans ~163 service pages" | **11** of the 146-page service surface (139 top-level + 7 directory indexes). 135 were always clean |
| "the fix is a design decision (wrap vs. scroller)" | The scroller already exists and ships; nothing to decide at 320px |
| CSS "is inlined per-page and has probably drifted" | True but irrelevant — `.trust-item` has **17 identical** copies, and the live rule is an external file |

### Why the trust bar looked guilty

§6.3 reports "individual items report right edges of 523 and 782 against a 320px
viewport". Both numbers reproduce exactly. They are also **not** document
overflow: `service-mobile-polish.css` has made `.trust-bar-inner` an
`overflow-x:auto` scroll container on every service page since 2026-04-22
(commit `1e93189d`), and the children of a scroll container are *supposed* to sit
past the viewport edge — that is what scrolling means.

An overflow detector that walks `getBoundingClientRect().right > innerWidth`
cannot tell those apart. To attribute overflow correctly it has to walk each
element's ancestors and discount any that establishes a scroll/clip container on
the x axis:

```js
for (let p = el.parentElement; p && p !== de && p !== document.body; p = p.parentElement) {
  const ox = getComputedStyle(p).overflowX;
  if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return CLIPPED;
}
```

**Stop that walk before `<body>`.** `nbd-mobile.css` sets `body{overflow-x:clip}`,
so a walk that includes `<body>` marks *every* element clipped and reports zero
offenders on a page that genuinely overflows by 59px. That mistake cost a pass
here: the first corrected run said "0 real offenders" and looked like proof the
bug did not exist.

---

## 2. The actual cause

A grid or flex item's **automatic minimum size is `min-content`**. A track
written `1fr` is `minmax(auto, 1fr)`, and that `auto` minimum is the item's
min-content width — so the track **cannot shrink to the viewport**, and the row
pushes `<html>` wider instead.

On `/services/roof-replacement` at 320px: `.content-grid` is correctly 288px
wide, and its single column resolves to **362.6px**.

| Selector | Pages | Worst | Note |
|---|---|---|---|
| `.content-grid` | 9 | 59px | `/services/roof-replacement` |
| `.stat-grid` | 3 | 27px | only appears once `.content-grid` can shrink |
| `.footer-grid` | 2 | 33px | `gaf-timberline`, `tamko-storm-series` |

Right edge minus viewport matches the document overflow exactly on every page
(`379 − 320 = 59`; storm-damage `355 − 320 = 35`), which is what confirms the
attribution rather than merely correlating with it.

### The trust bar IS guilty — at 820px, not 320px

Found while sweeping widths rather than trusting the single reported viewport.
The scroller's media query stopped at `768px`, but the five trust items need
**920px** to sit side by side. Between 769px and 919px the query was off and the
desktop `.trust-item{flex:1}` rule was back in charge, with the same min-content
floor:

```
770:150  800:120  820:100  860:60  900:20  910:10  920:0  1024:0
```

Up to **150px** of overflow, at widths neither the audit (320px) nor the existing
CI sweep (390px and 1280px) ever rendered.

---

## 3. The fix, and the two things that went wrong on the way to it

`min-width: 0` on the items — not a rewrite of the templates. `.footer-grid`
alone has **300+ inline `grid-template-columns` declarations in 20 variants**
across `docs/`; `min-width:0` is one rule, is column-count agnostic, and works at
every breakpoint. Both were measured as equivalent before choosing.

**Measurement caught two regressions in the obvious version of that fix:**

1. **`min-width:0` alone made two pages worse** (33px → 69px at 320px). Once a
   track can shrink, an unbreakable token spills out of it instead: the footer
   email is one 27-character word ~213px wide. It also appeared as a *new* 13px
   of overflow at 1024px, a width that had been clean.
   Fixed with `overflow-wrap: anywhere` — **not** `break-word`, which does
   not reduce the min-content contribution and leaves the track just as wide.
   Scoped to `a[href^="mailto:"]` so `tel:` links keep the `white-space:nowrap`
   this same file gives them at ≤380px.

2. **`min-width:0` on `.trust-item` fixed the 820px overflow but looked bad** —
   the five items wrapped to four ragged lines. Screenshotted, rejected. The
   scroller's breakpoint moved to **919.98px** instead, which keeps the design
   that was already chosen for ≤768px. `min-width:0` stays on `.trust-item` as a
   content-drift guard: if the trust copy ever grows past 920px the failure mode
   is wrapped text, not a sideways-scrolling page.

Deliberately **not** `overflow-x:hidden` on `html`/`body` — see
[NAV-DRAWER-RELIABILITY-2026-09-08](NAV-DRAWER-RELIABILITY-2026-09-08.md) §6.2:
one axis at `hidden` computes the other to `auto`, making `<body>` a scroll
container and killing `position:sticky`.

### Verification

Same-load A/B (render once, toggle the guards, measure twice) over **852
page-widths** — 284 pages × 320/375/820:

- **0 pages made worse**
- 13 page-width entries fixed — **12 distinct pages**: all 11 service pages,
  plus `/pro/customer.html` as a bonus (`/services/roof-replacement` is counted
  twice because it overflowed at both 320px and 375px)
- **0 service pages left overflowing**

Same-load matters: `/pro/*` and `/sites/oaks/*` are JS-rendered and their
overflow figures move by tens of pixels between runs, so comparing two separate
runs would have reported regressions that were only render timing.

---

## 4. The gate

Extended `scripts/qc-render-sweep.js` — the existing CI-wired sweep that already
asserts `horizontal-overflow` — rather than adding a competing suite. It rendered
only **390px and 1280px**, which is precisely why it called these pages clean for
three weeks: `/services/roof-replacement` is 59px over at 320px and **0px at
390px**.

Now also renders **320px** (narrow-phone floor; iPhone SE and Android at 200%
text zoom) and **820px** (the trust-bar band) — **on `/services/` only**.

That scope is deliberate and is the honest part of this note. At 320px the blog
surface (**12 pages, 37px**, `.author-box` flex items) and two `/pro` pages
(46px, a long `<code>` URL) carry the **same class** of pre-existing defect.
Widening the gate to them today would either have reddened CI on work nobody
reviewed, or forced those layout decisions through unexamined. They are filed in
§5. `NARROW_SURFACE` is a one-line predicate; widen it as each surface is fixed.

**Break-tested**, and the second break test is the interesting one — it came
back **green**, which is a finding rather than a formality:

| Reverted | Gate result |
|---|---|
| neither (as shipped) | **clean** — 248 pages, no findings, exit 0 |
| `nbd-mobile.css` guards only | **red** — `horizontal-overflow @narrow` on the 11 service pages, with the expected figures (379px on roof-replacement, 355px on storm-damage). No `@band` findings |
| `service-mobile-polish.css` breakpoint only | **GREEN — the gate does not catch it** |
| **both** files | **red** — 8 × `horizontal-overflow @band` |

The third row is why this table exists. **The two guards are redundant at 820px
by design**, and each independently prevents the *overflow*:

- `min-width:0` prevents it by letting the items **wrap**;
- the 919.98px breakpoint prevents it by letting the row **scroll**.

So restoring the 768px breakpoint on its own reintroduces nothing an overflow
assertion can see — `min-width:0` catches it, and the page merely goes ugly.
`@band` only fails when **both** are removed, which is what the fourth row
proves and is the only reason that viewport is not a permanently-green
assertion.

**The practical consequence, for whoever touches this next:** moving the
breakpoint back is a **design** regression (the ragged four-line trust bar in
§3.2), and **CI cannot see design**. No overflow gate will warn you. That is a
real gap in coverage, not a solved problem — a visual-regression baseline of
`.trust-bar` at 820px is what would actually close it, and none exists (the
existing baselines cover 4 of 286 pages).

---

## 5. Still open (measured, not fixed)

Same defect class, different surfaces and different layout decisions:

1. **Blog, 12 pages, 37px at 320px.** `.author-box` → `.author-info` is a flex
   item at `min-width:auto`. `/blog/index.html` is 32px over from its
   `.blog-main` sidebar grid.
2. **`/pro/how-to.html`, 46px at 320px** — a `<code>` holding
   `nobigdealwithjoedeal.com/pro/login.html` with nowhere to break.
3. **`/pro/ai-tool-finder.html` (596px) and `/pro/vault.html` (219px)** at 320px.
   Both are app surfaces with fixed-width topbars; figures move between runs
   because the pages render asynchronously — measure them same-load.
4. **`/sites/oaks/*` tenant microsites, 588–1288px at 320px.** These load only
   their own `assets/css/site.css` and share nothing with the marketing CSS.
   Related: `/sites/oaks` served without a trailing slash breaks that page's
   relative asset paths — the hazard already recorded for `cleanUrls` on a
   directory index. CI's `http-server` redirects and hides it.

## 6. Provenance

- Fix: `docs/assets/css/nbd-mobile.css`, `docs/assets/css/service-mobile-polish.css`
- Gate: `scripts/qc-render-sweep.js`
- Filed by: [NAV-DRAWER-RELIABILITY-2026-09-08](NAV-DRAWER-RELIABILITY-2026-09-08.md) §6.3

PR #1494 merged on 2026-09-08, so those references are real links.
