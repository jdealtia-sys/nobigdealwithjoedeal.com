# The 37-effect theme overlay engine is entirely dormant, plus a live ember bug — 2026-09-08

Found while speccing a possible "live wallpaper" Appearance feature (see the exploration note:
[SESSION-2026-09-08-appearance-lab-exploration](../projects/SESSION-2026-09-08-appearance-lab-exploration.md)).
None of this is new-feature work — these are real, independent defects in code that already ships,
verified by grep and line-by-line reading, not inferred. Fix effort for all of it is small and each
item is independent of the others and of anything in the exploration note.

## Finding 1 — the whole overlay system never fires, for anyone, ever

`docs/pro/js/theme-overlays.js` implements a real, reasonably well-built particle/CSS overlay
engine — 37 registered effect types in `overlayLibrary`, a shared canvas
(`#te-canvas`/`#te-overlay`, `position:fixed`, `z-index:0`, `pointer-events:none`, inserted as
`document.body.firstChild`), a density/speed config convention, a 30fps frame-skip loop. Every
theme entry in `theme-engine.js`'s `THEMES` object can declare an `overlay: {type, ...config}`
field — several already do (galaxy, underwater, ocean, avatar-fire, etc.).

**`ThemeEngine.apply()` (`theme-engine.js:5344-5454`) never reads `theme.overlay` and never calls
`ThemeOverlays.apply()` at all.** Grepped the entire `docs/pro/js` tree for both `ThemeOverlays.apply`
and `theme.overlay`: zero matches anywhere except decorative UI badge code (`maps.js:328`,
`ui.js:899`). Every one of the 37 implemented effects, on every theme that declares one, has been
inert since whichever commit added this architecture — selecting "Galaxy" or "Underwater" today
changes colors only; the overlay it's configured to also run has never once painted a frame.

**The fix is one line** in `ThemeEngine.apply()`:
```js
if (window.ThemeOverlays) window.ThemeOverlays.apply(theme.overlay || {type: 'none'});
```

## Finding 2 — avatar-fire's ember effect goes permanently blank ~6 seconds after selection

Independent of Finding 1 (this would still be broken even after the wiring gap above is closed).
`theme-overlays.js:1203` decrements ember life with a hardcoded frame constant:
```js
p.life -= 16;   // assumes 60fps
```
but the engine's own animation loop only invokes the update callback on every other
`requestAnimationFrame` tick (`theme-overlays.js:162-166`) — i.e. ~30fps, not 60. A particle
configured with `life: 3000` (3 seconds) therefore needs ~188 callback ticks × ~33ms ≈ **6.3 real
seconds** to actually expire. Worse, `updateParticles()` removes dead particles via
`this.particles.splice(i,1)` (`theme-overlays.js:1205-1207`) and **nothing ever adds a replacement**
— the pool only ever shrinks. Net effect, verified by reading the full call path: the
"ember-particles" overlay `avatar-fire` targets renders correctly for a few seconds, then goes
permanently blank for the rest of the session the first time someone selects that theme.

The same block also iterates with `.forEach()` while calling `splice()` mid-iteration inside it
(a classic skip-the-next-element bug) — worth fixing in the same pass.

**Fix:** decrement `life` by measured delta time (`performance.now()` diff) instead of a hardcoded
constant; on death, reset the particle in place (new x/y/vx/vy/life) rather than removing it, so the
pool count stays constant; iterate with a reverse `for` loop instead of `.forEach`.

## Finding 3 — two sibling fire themes declare overlay types that don't exist

`summer-heat` declares `overlay:{type:'heat-shimmer'}` (`theme-engine.js:2735`) and `eternal-flame`
declares `overlay:{type:'flame-burst'}` (`theme-engine.js:4260`). Neither key exists in
`overlayLibrary`. `apply()`'s own guard (`theme-overlays.js:95-98`,
`if(!overlayFunc){console.warn(...);return;}`) fires silently on both, so — once Finding 1 is fixed
and this code path actually runs — both themes would still render no overlay at all until these are
either registered or repointed at a real effect (e.g. a mood-parameterized version of
`ember-particles`).

## Finding 4 — two more themes' overlay config is simply wrong

`galaxy`'s overlay is left at `'none'` (presumably a placeholder that was never filled in), and
`deep-space`'s overlay key is spelled `'starfield'` while the actually-registered key in
`overlayLibrary` is `'star-field'` — a typo that would silently no-op the same way as Finding 3.

## Finding 5 — the tab-hidden pause is fake

`visibilitychange` (`theme-overlays.js:59-61`) only flips an `isHidden` boolean that the loop
*checks* — `requestAnimationFrame` keeps getting rescheduled every tick regardless
(`theme-overlays.js:155-171`), it just skips the draw call while hidden. Browsers self-throttle a
hidden tab's rAF to ~1Hz on their own, so the real-world cost of this is small, but it is not zero
and it is not actually cancelled. **Fix:** `cancelAnimationFrame` on `document.hidden`, a single
fresh `requestAnimationFrame` on visibility restore.

## Finding 6 — zero reduced-motion support anywhere in this file

Grepped `theme-overlays.js` for `matchMedia` and `reduce`: zero matches. The only precedent for this
check anywhere in the codebase is `theme-sounds.js:68-70`'s `respectsReducedMotion()` — for audio
only. Anyone with `prefers-reduced-motion: reduce` set at the OS level, or this app's own Comfort-tab
`data-motion="reduce"` toggle (`nbdComfortSetMotion`, `dashboard-ui-prefs-boot.js:1655-1661`), gets
full animated overlays today with no opt-out — once Finding 1 is fixed and overlays start actually
rendering, this becomes a real accessibility gap, not a latent one.

## Finding 7 — the master "Visual overlays" toggle doesn't persist

`nbdOverlaysSetEnabled` (`dashboard-ui-prefs-boot.js:320`) calls only
`ThemeOverlays.setEnabled(on)` — no `localStorage` write, no Firestore write. Grepped the full
`docs/pro/js` tree for any persistence of that flag: none. `ThemeOverlays.enabled` is hardcoded
`true` (`theme-overlays.js:11`) and nothing on boot ever overrides it from storage. Turning the
toggle off today does not survive a page reload, let alone follow a rep to another device. The
sibling `ThemeSounds` module does this correctly (`nbd-theme-sound` in `localStorage`, read on init,
a real pause via `stopAndDisconnectNodes` on `document.hidden` — `theme-sounds.js:499,631-634,646-648,677-679`)
and is the pattern to copy.

## Net

None of the 37 overlay effects this codebase already built have ever been seen by a real user. All
seven findings above are small, independent, and worth fixing regardless of whether any new
atmosphere effect ever gets added on top — see the exploration note's Phase 0 for the fix order.
