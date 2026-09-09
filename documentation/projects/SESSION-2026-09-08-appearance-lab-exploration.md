# Appearance Lab exploration — 2026-09-08

Jo asked for the CRM's Settings > Appearance to feel less sharp/flat. That escalated over one
session into a full multi-tier design exploration — six published Claude Artifacts, 24 built
interactive concepts, and one real codebase finding (see
[THEME-OVERLAYS-DORMANT-2026-09-08](../audit/THEME-OVERLAYS-DORMANT-2026-09-08.md): the CRM's
existing 37-effect particle overlay engine has never actually run for anyone). **Nothing in this
session touched `docs/pro/` or any other production file** — every artifact below is a private,
interactive HTML mockup on Jo's own claude.ai account, not code in this repo. This note and the
audit note above are the session's only real-repo output. A future session picking this up starts
from the build plan at the bottom, not from re-deriving any of the exploration.

## What was explored, and what Jo said about each

Escalated in stages as Jo kept asking for more/bolder each round — each stage is its own Claude
Artifact (Jo's private link, listed for reference; a future session cannot open these directly
without Jo sharing them, since Artifacts are per-account):

1. **Shape & Depth Lab** — 8 corner-radius/shadow/motion presets, from a Linear-style crisp
   tightening to a full Material-3-style tonal system. **Jo liked this one.**
2. **Big Swings** — 6 status/identity systems going further than shape alone: light-as-urgency
   (cards glow warm near due, dusk when overdue, sunrise animation on payment), a Stripe-style
   floating-card system, a torn-carbon-copy-paper-and-ink-stamp material system, a Fluent-style
   cursor-tracked glow, a frosted-glass system, and a real physics-based drag-and-drop pipeline
   board (Pointer Events, velocity-driven tilt, spring settle — not a CSS transition). **Jo liked
   this one too, and named the physics drag board as an all-time favorite.**
3. **Real Moves** — 3 genuine interaction-mechanism reinventions for OTHER specific screens (a
   commit-gate lever for job milestones, a velocity-scrubbed visual job browser for when you can't
   remember a name, a live-filtering date/amount dial pair for invoice review). **Jo's read: cool,
   but these are point fixes for specific screens, not a global appearance toggle — wants a
   concrete per-screen use case before committing build effort.** Correctly shelved, not rejected:
   revisit each one when its actual screen is up for work (photo review, job search, invoice
   filtering respectively).
4. **Spectacle** — unrestrained celebration/sound concepts (a business-health weather system that
   resolves into a real rainbow when an overdue invoice gets paid; a dollar-tiered confetti/
   fireworks sequence; a synthesized one-instrument sonic identity with a playable-cursor
   milestone moment). **Jo didn't fully follow this one even after a plain-language recap.**
5. **Unhinged** — deliberately mold-breaking concepts on different axes (a permanent deadpan
   narrator that writes itself into a job's activity history forever; a hidden midnight-only
   terminal mode found by an unlikely gesture; a control that "clocks out" for a few minutes once
   a day, always naming its working alternate). **Also didn't land for Jo, even re-explained
   plainly — treat as explored-and-declined, not a presentation problem.**
6. **Live Atmospheres** — canvas-based "living wallpaper" backgrounds behind the actual CRM
   content: rain with real condensation drips and distant lightning, buoyant fire embers, ocean
   bubbles with CSS-only caustic light-ripples, a parallax starfield with drifting planets, drifting
   clouds under a time-of-day tint, and a slow searchlight sweeping through fog. Speccing this is
   what surfaced the dormant-overlay-engine finding above — the spec agents grounded every
   atmosphere in the actual `theme-overlays.js`/`theme-engine.js` code rather than proposing from
   scratch. **"Pretty much what I envisioned" — Jo's clearest win of the session.**

## The picks (Jo's answers, 2026-09-08)

- **Shape & Depth:** all 8 presets stay in play as selectable options — no single one picked over
  the others.
- **Status/Identity (Big Swings):** Shop Copy and Golden Hour explicitly named as priorities;
  Signal Board, The Deck, and The Corkboard should stay available as future additions to the same
  picker rather than being designed out.
- **Live Atmospheres:** start with one to prove the engine end-to-end rather than building all six
  at once; Jo didn't name which, so this note defers to the atmosphere specs' own recommended
  order (Galaxy Drift first — cheapest, no physics, no audio dependency).
- **Next step Jo asked for:** a real, sequenced build plan (not code yet) — reproduced below.

## The build plan (as given to Jo; not yet started)

Three orthogonal `data-*` attributes on `<html>`, matching the existing `data-theme` (color) /
`data-density` (spacing) pattern exactly, so all three compose with each other and with the ~100
existing color themes rather than fighting them.

### Phase 0 — foundational fixes (blocks Phase 3; ship independently regardless of the rest)

All five items in [THEME-OVERLAYS-DORMANT-2026-09-08](../audit/THEME-OVERLAYS-DORMANT-2026-09-08.md):
wire `ThemeEngine.apply()` → `ThemeOverlays.apply()` (currently zero calls anywhere), fix the fire
ember life-decrement bug, replace the fake visibility pause with a real
`cancelAnimationFrame`/resume cycle, add `prefers-reduced-motion` + `data-motion` gating (currently
absent from `theme-overlays.js` entirely), and give the master "Live Backgrounds" toggle real
persistence (currently none at all).

### Phase 1 — Shape & Depth (`data-shape`)

New attribute, sibling to `data-theme`/`data-density`. Token set (`--radius-*`, `--elevation-*`,
`--ease-*`) declared once at `:root` with today's exact values (true no-op default = "Sharp"), then
re-declared per preset. All 8 presets as selectable values: `sharp` (default), `linear`, `pressed`,
`soft`, `elevated`, `fluent` (Mica-style), `glass`, `tonal`. Refactor the ~30-50 hardcoded
`border-radius`/`box-shadow` component selectors in `dashboard-app.css` to reference the new
tokens. New file `docs/pro/js/dashboard-shape-style.js` (`nbdSetShapeStyle()`, registered in
`__NBD_CALL_REGISTRY`, pre-paint boot IIFE matching `theme-mode-preboot.js`). Settings UI: a
segmented control in Appearance, same markup pattern as the existing UI Size row.

### Phase 2 — Status & Identity (`data-material`)

New attribute. Ship Shop Copy and Golden Hour first; architect the enum so Signal Board, The Deck,
and The Corkboard can be added later without redesigning the mechanism.

- **Shop Copy:** `theme-shop-copy.css`; 2 hand-authored inline SVG ink stamps (PAID/VOID sharing
  one `feTurbulence` filter); one Google Fonts stencil face scoped to headers only; new
  `.carbon-edge`/`.stamp-slot` DOM hooks in `crm-pipeline.js`/`invoice-pipeline.js` (hidden unless
  the attribute is set); its own "Material" section in Settings, not folded into the 100-theme
  color grid; verify the stamp's SVG filter survives the actual invoice PDF export path before
  shipping (Chromium print has dropped CSS features here before — see prior handoffs on the
  photo-report footer).
- **Golden Hour:** a shared `data-light-state` classifier (morning/golden/dusk) computed from
  deadline proximity — one pure function reused by job cards, leads, and invoice headers. Drag
  weight extends the Corkboard's existing tilt-with-lag spring math rather than a new physics
  engine. One hand-authored sun-arc SVG sprite (4 states). Mark Paid gets a one-shot sunrise
  animation.
- Persistence for both: `userSettings/{uid}`, mirroring how theme choice already persists.

### Phase 3 — Live Atmospheres (`theme.overlay`, riding the existing per-theme field)

No second picker — atmosphere selection rides the *existing* `THEMES[key].overlay:{type,...}`
field once Phase 0 wires it up. One new orthogonal boolean ("Live Backgrounds") plus a quality dial
(Auto/Reduced/Off). Build order, cheapest/lowest-risk first so shared engine infrastructure
(`engine.createSprite()`, `engine.scheduleRareEvent()`) gets proven before the hardest atmosphere
leans on it:

1. **Galaxy Drift** — no physics beyond constant velocity + sine terms, cached gradients, no
   audio. Also fixes Finding 4 above for free (galaxy's `overlay:'none'`, deep-space's
   `'starfield'`/`'star-field'` typo).
2. **Cloudy Sky** — introduces the sprite-cache utility (pre-rasterize once, blit per frame) that
   Deep Current and Night Watch both reuse.
3. **Night Watch** — introduces the rare-event scheduler (the searchlight sweep); five of the six
   atmosphere specs independently reinvented this same pattern, so it's worth building once.
4. **Ripples of Fire** — the urgent bug fix (Finding 2) already ships in Phase 0 independently; the
   full mood-parameterized port (banked coals vs. real blaze) lands here once the sprite cache and
   scheduler exist.
5. **Deep Current** — heaviest non-audio atmosphere, but needs no new engine capability beyond
   what 2-3 already proved.
6. **Storm Glass** (rain) — last, because it's the only one needing a genuinely new hook:
   theme-color-driven audio (`ThemeEngine` currently never calls `ThemeSounds` at all).

## Status

Conceptual only, as of this note. Not in the current live brief
([NEXT_SESSION-2026-09-09](NEXT_SESSION-2026-09-09.md)) — this is a parallel, not-yet-scheduled
lane. Whoever picks it up next should start with Phase 0, since it ships value independent of
whether any of Phases 1-3 ever get built.
