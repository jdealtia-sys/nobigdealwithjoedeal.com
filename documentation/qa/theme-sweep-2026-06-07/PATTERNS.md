# Theme Sweep — Systemic Patterns (2026-06-07)

Live visual + computational sweep of all **186 themes × {light, dark}** on the real authenticated dashboard.
This is the cross-theme synthesis: what's systemic, and whether the fix is per-theme or one structural change.

---

## P-1 — The Phase-2 hardening (PR #557/#568) holds across the entire registry ✅
Across all 186 themes in **both** modes, measured on the rendered tokens:
- **Body-text contrast: 0 failures** (dark floor 4.91 spongebob; light floor 7.4). 
- **Muted-text contrast: 0 failures** (dark floor 4.59 obsidian; light floor 4.51 — engine tunes to the AA line).
- **Accent identity hue drift: 0** — every theme's signature accent survives into the rendered vars, **including
  algorithmically-derived light variants** (a light "Inferno" still reads fiery).
- **No "collapse-to-generic-navy."** The fragmentation symptom the brief feared is **absent** — themes render
  visibly distinct; the dual-engine/split-key fight is resolved live (`nbd_pro_theme` == `nbd-theme` on the wire).

**Verdict:** the structural theme work is done and deployed. This sweep is confirmation, not a to-do list — except P-2.

## P-2 — ONE systemic defect: pale/desaturated-light accents → low-contrast accent-fill button labels 🟠
**This is the single actionable finding. It is STRUCTURAL, not per-theme.** See BUG-LOG **B-1**.
- Root cause: the engine's `--accent-fg` (text-on-accent) tuning fails to flip to a **dark** foreground when the
  accent is **near-white / low-saturation** (white, pale-gray, pale-yellow, pale-blue). The accent-fill buttons
  (quick-add **ADD**, and on some themes NEW ESTIMATE) then render light-on-light.
- Affected (~12, cross-category, all same root cause): `stadium-lights`, `snowfall`, `avatar-water` (worst),
  `marble`, `tundra`, `translucent`, `metal`, `steel`, `obsidian`, `spongebob`, `mandalorian` (mild), `hologram`(locked).
- **NOT** vivid light accents — `rick-and-morty`, `simpsons`, `arctic`, `thunderstorm`, `champion-gold` all flip
  correctly. The deciding factor is **chroma+luminance**, not hue.
- **FIX = ONE structural change** (one threshold in the accent-fg derivation: when `contrast(white, accent) < 3`
  OR accent relative-luminance > ~0.7, set `--accent-fg` to dark ink). One edit fixes all ~12 at once.
  Flagged, not applied (touches engine logic, not a single CSS value → Rule 1).

## P-3 — Light-native themes stay light in "dark" mode (behavior, not a bug) ℹ️
~11 themes whose base bg is very light (`easter`, `minimalist`, `polaroid`, `ink`, `lofi`, `sakura`, `typewriter`,
`paper`, `ghost`, `frosted`, `brutalist`, plus `studio-ghibli`/`south-park`/`one-punch-man`) render light/pastel even
when the user's mode pref is **dark**. The derivation preserves their light identity rather than forcing dark.
- All remain legible and on-identity. But a user who picks "dark mode" still sees a light theme for these.
- **If you want them to honor dark mode**, that's also a **single structural change** (force `deriveDarkPalette` to
  actually darken light-native themes) — but it would weaken their identity. Recommend leaving as-is (product call).

## P-4 — The accent-on-surface "dips" (24 themes < 3:1) are non-issues ✅
Computationally, 12 dark + 12 light themes have accent-as-color contrast < 3 on the card surface (worst
`vinland-saga` 2.08). **Visual confirmation across categories: these never harm legibility**, because the accent is
used as **button/element FILLS with the `--accent-fg` contract**, not as foreground text on cards. No action.

## P-5 — Identity fidelity (Axis B) is strong everywhere ✅
Every category's themes read as their intended identity in both modes: trade themes (blueprint-blue, safety-orange,
brick-red), nature (forest-green, ocean-cyan, volcano-red), IPs accurate (batman yellow/black, tron cyan, matrix/terminal
green, naruto orange, DBZ orange). No **dead** themes (every entry changes the UI). Locked themes render **complete**
when force-rendered — they're gated from selection, not unfinished. Only minor identity notes:
synthwave/cyberpunk/neon share a pink-purple family (close but distinguishable).

---

## Bottom line
The theme system is in **excellent** shape after the 2026-06-06 hardening. The sweep surfaced exactly **one**
actionable defect (**B-1**, ~12 pale-accent themes, fixable with a single structural threshold change) plus one
**product decision** (P-3, light-native themes in dark mode). Everything else passes both axes in both modes.
