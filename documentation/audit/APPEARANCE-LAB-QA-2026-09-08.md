# Appearance Lab QA — 2026-09-08

Jo asked whether the Shape & Depth / Material / Live Atmospheres work
(#1522, #1524, #1525, #1527 — the appearance-lab build plan at
[SESSION-2026-09-08-appearance-lab-exploration](../projects/SESSION-2026-09-08-appearance-lab-exploration.md))
had landed cleanly, since it "seemed a bit bugged." It had shipped same-day,
same evening. This note is a live test (real Firebase emulators — auth,
firestore, storage, hosting — plus a seeded rep account) against the
deployed-shape code, not a read-through, followed by a code audit of the
mechanism behind anything that looked off, followed by fixes and re-
verification. Four real defects confirmed and fixed; one suspected defect
investigated and **ruled out** (recorded below so a future session doesn't
re-report it).

## Method

`firebase-tools emulators:start --only auth,firestore,storage,hosting`
against this checkout, seeded via `tests/e2e/fixtures/seed-emulator.js`
(the same fixture `screenshot-demo.spec.js` uses). Interactive exploration
went through the Browser pane; anything timing- or animation-sensitive was
re-verified with a throwaway Playwright script (real headless Chromium),
because **the Browser pane throttles `requestAnimationFrame` when its tab
isn't the actual frontmost one at the OS level, independent of
`document.hidden`/`visibilityState`, which both report `false` regardless**
— see Finding 5. This is the same class of lesson as the standing
"screenshot via Playwright, not the Browser pane" rule (the pane fails
screenshots while hidden; here it silently starved a live rAF loop instead)
— worth treating as one rule, not two: anything the pane can't actually
show live is unreliable to test in the pane.

## Findings — confirmed and fixed

### 1. Shape & Material preferences were write-only to Firestore

`nbdSetShapeStyle()`/`nbdSetMaterial()`
([dashboard-ui-prefs-boot.js](../../docs/pro/js/dashboard-ui-prefs-boot.js))
merge-wrote `shapeStyle`/`materialStyle` to `userSettings/{uid}` on every
change, exactly mirroring the write half of `ThemeEngine.apply()`'s
cross-device sync — but nothing anywhere in the repo ever read either field
back (confirmed by grepping `shapeStyle|materialStyle` across the whole
tree: the only other hits were the two DOM element ids in `dashboard.html`).
The build plan's own Phase 2 spec says persistence should mirror "how theme
choice already persists" — theme choice hydrates from Firestore on boot
(`theme-engine.js` `tryHydrateFromFirestore`, polling for auth); shape/
material never got that half. Net effect: a rep's choice was durable on the
device that made it and invisible everywhere else — clearing localStorage,
or opening the CRM on a second device, silently reset both to their
defaults despite the Firestore document holding the real values the whole
time. Same recurring shape this repo keeps finding elsewhere: a write path
that looks correct in isolation, with no reader anywhere to notice it was
never wired up both ways.

**Fix:** added `_nbdHydratePrefFromFirestore()`, a direct port of
`theme-engine.js`'s poll-for-auth-then-getDoc-then-apply-if-different
pattern, called once at boot for both fields. `nbdSetShapeStyle`/
`nbdSetMaterial` gained a `save` parameter (default `true`, mirroring
`ThemeEngine.apply(key, save)`) so the hydrate path applies the remote
value without echoing an identical write back to Firestore and without
toasting a change the person at this device didn't just make.

**Also fixed in passing:** the existing boot-time re-application of a saved
`shop-copy` material (to reload its Google Font on every fresh page load)
was calling `nbdSetMaterial('shop-copy')` with no way to suppress the
toast — meaning every Shop-Copy user got a "Material: Shop Copy" toast on
**every single page load**, not just when they changed it. Same `save`
parameter fixes this for free.

**Verified:** a fresh browser context (empty localStorage, simulating a
second device) logging in as the same seeded rep now picks up a
`pressed`/`shop-copy` preference set from "another device" within ~1s of
opening Settings → Appearance, no toast, and backfills localStorage.

### 2. Every Shape & Depth preset's motion character was dead CSS

Each of the 8 presets in
[dashboard-app.css](../../docs/pro/css/dashboard-app.css) sets its own
`--shape-ease`/`--shape-dur` (Linework's own comment calls it "near-zero
motion" at `.12s`; Tonal is `.2s` with a different curve) — but grepping the
whole file for `var(--shape-ease` / `var(--shape-dur` returned zero matches
anywhere. Confirmed live: `.btn-orange`'s computed
`transition-timing-function` under every preset was the same hardcoded
`cubic-bezier(0.4, 0, 0.2, 1)` from `.btn`'s own rule, never the preset's
token. Only corner radius and shadow ever actually changed per preset; the
"motion" half of "Shape & Depth" was cosmetic copy on a token nobody read.

**Fix:** `.btn`'s `transition` now reads `var(--shape-dur, var(--t-mid))
var(--shape-ease, cubic-bezier(.4,0,.2,1))` for each animated property. The
root fallback for `--shape-ease` was also **corrected** — it was
`var(--ease-out)`, a bouncy overshoot curve (`cubic-bezier(.18,.89,.32,1.28)`)
used elsewhere in the file, which does **not** match `.btn`'s actual
hardcoded easing. Since the token was never consumed this mismatch was
invisible, but wiring it in as-is would have changed every button's resting
easing curve the moment "Sharp" (the default, no-op preset) rendered —
exactly the "true no-op" invariant this whole feature is built around.
Root default is now the literal `cubic-bezier(.4,0,.2,1)` that `.btn`
already used, so Sharp is provably unchanged.

**Verified:** computed `transitionDuration`/`transitionTimingFunction` on a
real button now differs per preset (Sharp `.18s` / `cubic-bezier(0.4,0,0.2,1…)`,
Linework `.12s` / `cubic-bezier(0.2,…)`, Soft Canvas `.16s` / a third curve)
and Sharp's values are byte-identical to what shipped before this fix.

### 3. `.btn-orange` (the app's primary/CTA button class) never showed Pressed's emboss shadow

`.btn`'s resting `box-shadow: var(--btn-shadow, none)` is where every
preset's shadow recipe lives (Pressed's is a raised/pressed neumorphic
emboss). `.btn-orange` — the class on every primary "Save", "+ New
Estimate", "Add Lead" style button in the app — sets its **own** fixed
`box-shadow` (an inset ring + theme-colored glow) at equal specificity and
later in the file, so it always won outright; `var(--btn-shadow)` was never
read on a single orange button, only on secondary `.btn-ghost` ones (the
only other `.btn-*` variant that doesn't hardcode its own box-shadow, per a
`.btn-orange`-only grep of `.btn-*{...box-shadow`). Confirmed live: under
`data-shape="pressed"`, `.btn-orange`'s computed `boxShadow` was pixel-
identical to Sharp's.

**Fix:** `.btn-orange`'s box-shadow now leads with `var(--btn-shadow)` ahead
of its own ring/glow layers. The root default for `--btn-shadow`/
`--btn-shadow-active` also changed from `none` to `0 0 #0000` — `box-shadow:
none, <other-shadow>` is invalid CSS and drops the **whole** declaration
(would have silently deleted every orange button's shadow entirely under
Sharp), while `0 0 #0000` is a zero-size transparent shadow that composes
safely in a list and paints nothing, the same Tailwind uses for its
`shadow-none` utility.

**Verified:** `.btn-orange`'s computed `boxShadow` under Pressed now
includes the `3px 3px 7px …, -2px -2px 5px …` emboss layer ahead of the
existing ring/glow, and is unchanged under Sharp.

### 4. Shop Copy's critical-aging card kept the default red urgency pulse

`.k-card-aging-critical::before` (the pulsing accent strip pipeline cards
get once a lead sits ≥14 days in a stage) is a separate element from the
card's `border-left`, hardcoded to alarm-red (`#ef4444`) and animating
opacity via `kCardCriticalPulse`. Golden Hour explicitly overrides this
pseudo-element for its own palette (a calm, steady "porch light" tone,
animation off — its own comment says "Dusk is calm, not alarming"). Shop
Copy's critical-card rule only recolors `border-left-color` to carbon
(`#2a2a2c`) and never touches `::before` — so a Shop Copy critical card
showed a carbon border **and** an unthemed bright-red pulsing strip next to
it, the one visual clash in an otherwise coherent cream/orange/carbon
material. Confirmed live via `getComputedStyle(el, '::before').backgroundColor`
(`rgb(239, 68, 68)` under Shop Copy) and by screenshot — visibly two
different, clashing accent colors on the same card edge.

**Fix:** added the missing `:root[data-material="shop-copy"]
.k-card-aging-critical::before { background: #ff8a00; }` — same hi-vis
orange as warming/stale, kept pulsing (not dimmed to steady like Golden
Hour) so critical still reads as more urgent than the stages under it,
while staying inside Shop Copy's own palette.

**Verified:** live `getComputedStyle` now returns `rgb(255, 138, 0)` for
that pseudo-element under Shop Copy; Golden Hour's own override (unrelated
to this fix) still renders correctly.

## Findings — investigated and ruled out

### 5. "Galaxy Drift's animation freezes after ~8 frames" — Browser-pane artifact, not a real bug

While live-testing the new `galaxy` theme's enhanced star-field overlay in
the Browser pane, `ThemeOverlays.frameCount` and `.animationId` were both
completely frozen across a full second of wall-clock time (`canvas.toDataURL()`
identical before/after), even though `document.hidden` was `false` and
`prefers-reduced-motion` was `false`. Before writing this up as a bug, the
exact same scenario was reproduced in a real (non-pane) headless Chromium
via Playwright, logged in against the same emulator: `frameCount` advanced
91→182 over 1.5s (the expected ~30fps after the shared loop's own frame-
skip), the canvas visibly changed, and zero page errors fired. **The freeze
is specific to the Browser pane** — most likely the pane throttling rAF for
a tab that isn't the actual OS-level-frontmost surface, independent of what
the Page Visibility API reports. Recorded here so a future session doesn't
re-file this against the app: if a live-atmosphere overlay looks frozen
when checked through the Browser pane, re-check with a real Playwright run
before trusting it.

## Verified working (no changes needed)

- Shape & Depth and Material segmented-control active-state sync
  (`nbdSyncShapeStyleBtns`/`nbdSyncMaterialBtns`) correctly re-paints on
  Settings → Appearance hydrate; an earlier read of a noisy screenshot
  briefly looked like a stale-active-button bug and was not — confirmed via
  `getComputedStyle` + a clean re-screenshot before concluding anything.
- Shop Copy and Golden Hour both correctly recolor real `k-card-aging-warming/
  stale/critical` cards (verified against 13 real seeded leads spanning all
  three aging tiers, not synthetic DOM) and Shop Copy's stencil column-header
  font loads and applies.
- Galaxy Drift's star-field + two-planet overlay renders and animates
  correctly (see Finding 5) with zero new console errors versus the
  pre-existing (unrelated, functions-emulator-not-running) noise.
- The Firestore hydrate poll pattern this session copied — used by
  `theme-engine.js`, `theme-achievements.js`, and the notifications sync in
  `dashboard-bootstrap.module.js` — is a real, repeated, working pattern in
  this codebase; Finding 1's fix is a straight port of it, not a new design.

## Verification

`node scripts/check-js-syntax.js` (503 files), `node
scripts/check-site-integrity.js --quiet` (243 pages, 0 failures), `node
scripts/check-inline-html-scripts.js` (0 inline scripts), `node
tests/smoke.test.js` (3810/3810 passed — one pre-existing `.btn-orange`
regex assertion needed its inline comment moved outside the CSS rule it was
scanning, not a logic change). All four fixes re-verified live against the
running emulator after the gate suite went green, not just by the gates
passing.

## Files touched

- [docs/pro/js/dashboard-ui-prefs-boot.js](../../docs/pro/js/dashboard-ui-prefs-boot.js) — Finding 1
- [docs/pro/css/dashboard-app.css](../../docs/pro/css/dashboard-app.css) — Findings 2, 3, 4
