# Nav reliability audit — header, mobile drawer, Services dropdown (2026-09-08)

Jo reported: *"on my iPod or some phones the slider seems to move without the
page itself sliding, therefore breaking it or making it unnavigable."*

That turned out to be a literal description of the mechanism, not a vague
impression. It is reproduced, root-caused and fixed below.

Reproduction harness: Playwright **WebKit** (the iOS engine) at **320x508**,
an iPod touch with Safari's chrome subtracted, driving the real `docs/` tree
over a local static server. Chromium hides most of this, which is part of why
it survived — see §5.

---

## 1. What was actually broken

Four independent defects, all live at once on every phone-width page.

### 1.1 The drawer's top offset was a constant; the header's height is not

`<nav id="mainNav">` is `position:sticky;top:0;height:70px;z-index:1000`. The
announcement bar above it is **in normal flow** (`position:relative`,
`min-height:38px`, 40px under the ≤640px override). So the header's bottom edge
is at **y≈108-129 at scroll 0** and **y=70 once the ann-bar has scrolled away**.

The drawer was pinned to a hardcoded `top`. Measured:

| pages | drawer `top` | at scroll 0 | scrolled |
|---|---|---|---|
| 203 | `70px` | **40px of the drawer hidden behind the header** | aligned |
| 17 | `108px` | aligned | **38px gap, page content showing through** |
| 2 | *(none — in flow)* | opens at document-y≈108 | **opens ~1400px off-screen** |

No constant can be correct, because the value it approximates changes as the
user scrolls. Confirmed with `elementFromPoint` at the drawer's own top edge:
at scroll 0 it returned `mainNav` (the logo's `.sub` text), not the drawer.

On `/pro/blog/*` the header is taller still and **59px** was covered.

The two in-flow pages (`docs/sites/free-guide/`, `docs/pro/blog/index.html`)
are the worst case and were independently confirmed by an adversarial verifier
that parsed the cascade-winning `.mobile-nav` rule on all 232 drawer pages:
exactly those two had no `position` at all. Tapping the hamburger there while
scrolled inserts a block ~1400px above the viewport — **the layout shifts and
no menu ever appears.**

### 1.2 Nothing locked body scroll — the reported symptom

Measured on WebKit: with the drawer open, `window.scrollBy(0, 400)` moved the
page from y=0 to y=600 while the drawer stayed pinned at `top:70`. The drawer
is `position:fixed`; the page behind it is not. **The panel holds still while
the page slides underneath it**, and closing the drawer leaves the reader
somewhere they never navigated to.

No page anywhere in `docs/` set `overscroll-behavior`, so a swipe that reached
the end of the drawer's own list chained straight through to the document.

### 1.3 The Call/Text bar painted over the drawer

`.mobile-cta-strip` (223 pages) is `position:fixed;bottom:0;z-index:999` — the
**same** z-index as the drawer and later in the DOM, so it wins. It is ~100px
tall and covered the drawer's bottom rows, which is where *Book Inspection*
lives.

### 1.4 Net effect: 6 of 32 links reachable

508px viewport − 110px header − ~100px CTA bar ≈ **298px of usable drawer for
1678px of links**. The other 25 required scrolling a `position:fixed` overflow
container with no `-webkit-overflow-scrolling` and no scroll containment —
the least reliable thing you can ask of an old iOS Safari.

### 1.5 The Services dropdown ran off the screen

24 items render **993px tall** with no `max-height` and no `overflow`. On a
1366x768 laptop it overflowed the viewport by **311px**; on an iPad Pro by
245px. Because the menu is `position:absolute`, there was nothing to scroll —
the bottom eight links (Roof Cleaning → Free 24-Hr Inspection) were simply
unreachable. Its `.open` class had CSS support but **nothing set it** except
`nav-faq.js`, which never removed it on outside click or Escape.

### 1.6 Why it drifted this far

Every one of these rules was hand-inlined into each page's `<style>` block.
**233 copies had drifted into 6 different `.mobile-nav` variants, and 46 files
carried 2-4 competing definitions of it in the same file** — so which geometry
a page got depended on which `<style>` block happened to be last.

---

## 2. The fix

Two new files own the header now:

- **`docs/assets/css/nbd-nav.css`** — the positioning contract
- **`docs/assets/js/nbd-nav.js`** — the single controller

Selectors are id+class (`#mobileNav.mobile-nav`, specificity 1,1,0) so they beat
every inlined `.mobile-nav` (0,1,0) copy regardless of source order, without
`!important` and without editing 233 `<style>` blocks.

**The drawer is now a full-viewport sheet** — `top/right/bottom/left: 0`. It
cannot misalign with the header because it no longer references the header's
position at all; the header simply paints on top (z-index raised to 1200 vs the
drawer's 1100, so the X is always reachable), and the drawer reserves room with
`padding-top: var(--nbd-header-h, 130px)`, which JS keeps in sync from the
nav's measured `getBoundingClientRect().bottom` on open, scroll, resize and
orientation change. If that variable is never set the drawer is *still* a
full-viewport scrollable panel with no gap and no leak — the failure mode is
cosmetic, never unnavigable.

`top`+`bottom` rather than `height:100vh` deliberately: on iOS `100vh` is the
URL-bar-hidden height and overflows the real viewport.

Also: body scroll lock (the iOS-safe `position:fixed` + restored offset —
`overflow:hidden` on body is ignored there), `overscroll-behavior:contain`,
the CTA strip hidden while open, focus trap, `role="dialog"`, and close paths
for Escape / outside tap / link tap / resize past the breakpoint / bfcache
`pageshow` / `hashchange` / `popstate`.

Dropdown: `max-height:calc(100vh - 140px)` + `overflow-y:auto`, an explicit
JS-driven `.open` for touch and keyboard, Escape and outside-click close, and
modifier-clicks passed through so Cmd/Ctrl-click opens a new tab again.

### 2.1 Two bugs found *in the fix itself*, before shipping

Recorded because both are the kind that would have shipped silently:

1. **`max-height` survived the rewrite.** Setting `top`/`bottom` does **not**
   beat the inherited `max-height:calc(100vh - 70px)` — max-height still clips
   the box. The first pass left the drawer 438px tall on a 508px screen with
   live page content visible underneath it. Caught by screenshot, not by
   reasoning. Fixed with an explicit `max-height:none`.

2. **A transition guard would have frozen the homepage.** `docs/index.html`,
   `docs/sites/free-guide/` and `docs/privacy.html` ship their own
   `closeMobileNav()` bound to the `<a>` itself. A target-phase listener on the
   link runs **before** the controller's bubble-phase listener on the drawer,
   so `.open` is already gone by the time `setOpen(false)` is reached — and an
   `if (isOpen() === open) return;` guard would skip `unlockScroll()`, leaving
   the body `position:fixed` and the page **unrecoverably frozen**. Fixed by
   never guarding the close path, plus a `MutationObserver` backstop that
   releases the lock if anything strips `.open` by any route.

### 2.2 One conflict the fix would have introduced

`nav-faq.js` (210 pages) also toggled the Services dropdown, from a
**document-level delegate**. The new controller binds to the trigger itself, so
it opened the menu in the target phase and `nav-faq`'s delegate — seeing it
already open — closed it again in the same click. **On any touch device wider
than 900px the menu would have opened and vanished.** Dropdown handling was
removed from `nav-faq.js` (which keeps its FAQ accordion duty); `nbd-nav.js`
owns the header. `nav-faq.js` also called `a.blur()` (dumping keyboard focus to
`<body>`) and `preventDefault()`ed modifier-clicks — both gone with it.

---

## 3. Rollout

`apply-partials.js` restamped **222 files** from the four nav partials. That is
not everything: **10 pages carry drawer markup outside the markers**, including
the **homepage**, and a partials-only fix silently misses them. They were wired
by a Node script that detects and preserves each file's EOL (a blanket LF
rewrite is how this repo got 78 phantom-modified files once), and each file was
verified individually rather than in aggregate.

Coverage is now 232/232, and that is the first assertion in the new gate.

---

## 4. Verification

- **WebKit @ 320x508, 6 pages × 15 behavioural checks — 90/90**, stable over
  three consecutive runs. Covers: opens, covers the full viewport, opaque
  background, first link clear of the header, CTA hidden, body locked, **page
  does not scroll behind**, last of 32 links reachable, closes on the X, body
  unlocked, scroll position restored exactly, not frozen when a third party
  strips `.open`, page scrollable after that, Escape closes, zero JS errors.
- **`tests/nav-contract.test.js` — 44 assertions**, node bucket.
- **`tests/e2e/nav-drawer.spec.js` — 6 specs on a new `mobile-webkit`
  Playwright project**, run against the hosting emulator exactly as CI does.
- **Break-tested 10/10**: each reintroduced defect reddens the *specific*
  assertion that covers it, and the files restore to green.
- **The e2e spec was break-tested against the real pre-fix contract** — all 5
  page specs fail on `drawer top: received 70, expected ≤ 0`.

---

## 5. Why no gate caught any of this

- **Not one test in the repo had ever clicked the hamburger.** Every nav gate
  was string-shaped, so all of them were green while the drawer was broken.
- **Playwright ran Desktop Chrome only** — the webkit and mobile projects were
  commented out. The entire failure class is iOS-shaped (`100vh` semantics,
  fixed-overflow scrolling, `overflow:hidden` ignored as a scroll lock), so the
  reported symptom was *not reproducible by any gate that existed*.
- `apply-partials.js` validated the toggle `<script>` inside the partial
  **source**, never that a shipped page loads it — which is exactly how 10
  pages including `/` ended up outside the fix.
- Nothing compared nav CSS **across** pages, so the 6-variant drift could grow
  without limit.

New gates close all four: coverage over all 232 pages, a single-owner check, a
numeric z-index comparison parsed from both real files (so bumping the CTA
strip's z-index tomorrow fails here instead of silently re-covering the
drawer), and a WebKit project that actually opens the thing.

---

## 6. Still open — NOT fixed here

Confirmed by the audit, deliberately out of scope:

1. **`docs/index.html`'s main bundle (`inline/72f02d79d0.js`) uses optional
   chaining**, so on iOS ≤13.3 the whole file fails to parse — taking the
   homepage contact form's `submitForm()` with it. Same in
   `inline/307ae4e90e.js` (privacy, pro/terms), `inline/4053149b2f.js` and
   `inline/c5a2295382.js`. One-character fixes each, but they are `@generated`
   bundles carrying live form and smooth-scroll code — worth its own change
   with its own verification.
2. **`body{overflow-x:clip}`** (nbd-mobile.css, 196 pages) is iOS 16+. On the
   reported device it does nothing. Adding an `overflow-x:hidden` fallback is
   the obvious move but it makes `<body>` a scroll container, which can kill
   `position:sticky` — needs device verification before shipping, not
   reasoning.
3. **Every legacy smooth-scroll passes a `ScrollToOptions` object**, which
   Safari <14 does not accept. (`nbd-nav.js` itself uses the two-argument form.)
4. **The Roof Visualizer is in the mobile drawer but in neither the desktop
   dropdown nor the top-level nav** — a content gap, not a reliability one.
5. **`pro/sign.html` sets `user-scalable=no`** — pinch-zoom disabled.
6. Visual-regression baselines cover 4 of 286 pages, one of them marketing, and
   every baseline is the **closed** drawer. `maxDiffPixelRatio 0.02` on a
   full-page screenshot is larger than the entire nav band, so no header change
   can fail that gate.

## 7. Audit provenance

Six-lens adversarial workflow (drawer CSS, drawer JS, dropdown, header
stacking, legacy devices, CI gates), each dimension's findings adjudicated by a
separate refuter: **63 findings, 61 surviving, 2 refuted**. Four agents
(`find:drawer-css`, `verify:legacy-device`, `verify:gates`, `synthesize`) died
on the session limit, so the drawer-CSS lens and the final synthesis are
**agent-unverified** — their ground is the direct WebKit measurements in §1,
which are first-hand. The full result is in the session's task output.
