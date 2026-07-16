# Axis A (Legibility) — Computational Sweep, all 186 themes × {dark, light}

**Method:** for every theme, `ThemeEngine.apply(id,false)` in each mode, read the *actually rendered*
CSS tokens off `documentElement` computed style, compute WCAG contrast. Alpha colors composited
over their surface before measuring. (Live, 2026-06-07, authenticated session.)

## Verdict: PASS in both modes
| Metric | Dark floor | Light floor | AA target | Result |
|---|---|---|---|---|
| Body text (`--t` on card `--s2`) | **4.91** (spongebob) | **7.40** (avatar-air) | 4.5 | ✅ all pass |
| Muted text (`--m` on card) | **4.59** (obsidian) | **4.51** (glow/diesel/dexters-lab) | 4.5 | ✅ all pass (engine tunes to ~4.5 floor) |
| Accent invisible on BOTH surfaces | none | none | 3.0 | ✅ none |
| Accent hue drift from identity (>40°, saturated) | 0 | 0 | — | ✅ identity accent preserved incl. derived light |

This corroborates the deployed Phase-2 fixes (PR #557/#568): runtime tuning of `--m` and the
accent contract are working live, in both modes.

## Caveats / visual-priority items (where math can't decide — confirm by eye)

### Gradient-surface themes (parser can't auto-contrast → visual-only Axis A)
- `mob-psycho` (anime) — surface is a `linear-gradient` deep-indigo; text `#f5f5f5` is clearly legible by eye, but not auto-scored.

### Accent-as-color on surface dips below 3:1 (only a problem IF accent is used as TEXT/ICON on a card, not as a fill)
Saturated ("chromatic") accents whose contrast on the card/bg surface is < 3:1. To be visually
checked: does the UI render accent-colored text/icons on cards in these themes, and does it read poorly?

**Dark (12):** vinland-saga 2.08 · akira 2.62 · canyon 2.63 · brick 2.68 · gravity-falls 2.70 ·
teen-titans 2.74 · spy-x-family 2.83 · tmnt 2.95 · concrete 2.97 · iron-door 2.97 · easter 2.98 · chainsaw-man 2.99

**Light (12):** ghost-in-shell 2.92 · desert 2.93 · top-gun 2.93 · trophy 2.93 · art-deco 2.93 ·
one-piece 2.93 · grunge 2.94 · dragon-ball-z 2.95 · lo-fi 2.97 · high-contrast 2.98 · john-wick 2.99 · dark-academia 2.99

> Note: primary CTA buttons use `--accent-fg` over the accent FILL (contract-tuned), which is a
> separate, passing contrast. These dips are only about accent-as-foreground-color on a surface.

### Known-residual identity/legibility watch (from the 2026-06 audit, Phase-3 candidates)
spongebob (dark body floor 4.91, yellow-on-blue), avatar-fire / avatar-earth (mixed-luminance panels),
ghost (very low-chroma), terminal (CSS-only theme, not in JS registry).
