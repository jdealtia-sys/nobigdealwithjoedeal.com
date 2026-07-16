# Theme Sweep — Bug Log (2026-06-07)

Live visual + computational sweep, authenticated session, prod `main`. Ranked by severity.

---

## 🟠 B-1 — Near-white / desaturated-light accents → invisible "ADD" button label
**Severity:** Medium (legibility) · **Axis A** · **Mode:** both (confirmed dark) · **Status:** ✅ RESOLVED — PR #572 squash-merged `6fefcd25` (2026-06-07), auto-deployed to prod & confirmed live.

> **Resolution (2026-06-07):** `generateCSSVariables` now computes + emits `--accent-fg` in the high-specificity `te-vars` block (alongside `--orange`), gated on measured contrast vs the FINAL per-mode accent: `(contrast(#fff, accentFinal) < 3 || luminance(accentFinal) > 0.7) ? '#0a0a0a' : '#ffffff'`. Engine now OWNS the token (always present, mode-correct, wins the cascade over the static theme-system.css flip-list — proven live on `steel`/light: static `#11151c` → engine `#fff`). Static list kept as fallback for CSS-only themes + first paint. nbd-original keeps brand white (3.07; the `<3` threshold protects it). Accepted side-effect: ember/wildwest/neon-rain/slate shift curated-dark→white, all still ≥3:1 AA-UI. Added a mandatory `--accent-fg` assertion to `tests/theme-qa.test.js` (present & ≥3:1 on `--orange`, both modes; proven tripwire). All node tests + CI (5 checks) green.

**What:** The quick-add **"ADD →" button** (Home → Quick Add Lead) fills with the theme **accent** color
and labels it with **`--accent-fg`**. For themes whose accent is **light AND low-saturation** (near-white /
light-gray), `--accent-fg` stays light instead of flipping to dark → **near-white text on near-white fill**.

**Proven (visual zoom/screenshot, dark mode):**
- **Worst (white-on-white, ~invisible):** `stadium-lights` (accent `#f8fafc`, contrast ≈1.05), `snowfall` (`#f1f5f9`),
  `avatar-water` (`#e3f2fd`, near-white-blue — NEW ESTIMATE *and* ADD both blank).
- **Faint (pale fill + light label, poor):** `marble` (`#e2e8f0`), `tundra` (`#e2e8f0`), `translucent` (`#e8eeff`),
  `metal` (`#c8ccd8`), `steel` (`#bac4d2`), `obsidian` (`#dadcde`), `spongebob` (pale yellow `#fff176`).
- Borderline / milder: `mandalorian` (`#94a3b8` mid-gray), `hologram` (`#bbdefb`, locked), `avatar-earth` (`#9ccc65`, verify).

**NOT affected (contract flips to dark correctly):** SATURATED light accents render the same button with **dark** text and
read fine — verified `arctic` (`#7dd3fc`), `thunderstorm` (`#fbbf24`), `champion-gold`/`champagne` (`#eab308`/`#fbbf24`),
`rick-and-morty` (`#76ff03`), `simpsons` (`#ffd600`). So the contract works for vivid accents; it fails only for
**near-white / low-saturation / pale** accents. The deciding factor is **chroma + luminance**, not hue.

**CSS variable responsible:** `--accent-fg` (engine `generateCSSVariables` accent-contrast tuning) used by the
quick-add ADD button's `background:var(--accent)/--orange; color:var(--accent-fg)`. The auto-tune picks white
when it should pick a dark fg for very-light accents.

**Why it slipped past prior audits:** the audit verified accent-fg on the 66 CSS themes + "auto-tunes accent to 3:1
at runtime"; this is the **JS-registry** near-white-accent subset and the **`--accent-fg` (text-on-accent)** axis on
one specific gradient/fill button — a corner the contract's threshold doesn't cover. The primary **"NEW ESTIMATE"**
CTA is unaffected (it uses a fixed copper `#c8620a` + white = 4.03, readable).

**Recommended fix (flagged, not applied — touches engine logic, ~8 themes):** in the accent-fg derivation, when the
accent's luminance is very high (e.g. relative luminance > ~0.7) OR contrast(white, accent) < 3, set `--accent-fg`
to a dark ink (e.g. `#0a0a0a`) regardless of mode. One threshold change in the engine fixes all ~8 at once.
**Failure-mode-if-wrong:** flipping fg dark on a mid-light accent could under-contrast on a *dark* accent variant —
gate strictly on measured contrast, not a hue guess.

### Root-cause deep-dive (2026-06-07, extended coverage pass)
Confirmed across dashboard + kanban + modal that B-1 hits every accent-FILL surface that pairs `background:var(--orange)`
with `color:var(--accent-fg)` — quick-add **.btn-orange ADD**, the modal **"View Full Customer Details" CTA**, kanban
**active filter tab**, and **toggles**. Verified live: `.btn-orange` DOES consume `var(--accent-fg)` (setting it on the
button element flips the text dark), and `--accent-fg` resolves to the `:root` default **#fff** for pale-accent JS
themes (no per-theme CSS override). The CSS override list (theme-system.css:136-154 + Wave 5e) only covers
CSS-registry themes, so the JS-registry pale themes fall through.

**Two complications that mean this needs a deterministic LOCAL render-verify, not a live prod hot-patch:**
1. **`--accent-fg` resolution:** an engine-emitted `:root[data-theme="X"]{--accent-fg}` did NOT reach the button in
   testing — the value is read from the `:root` default and the engine block didn't override it in the observed state.
   So the fix likely needs the engine to emit `--accent-fg` in the SAME high-specificity `te-vars` block as `--orange`
   AND confirmation it wins the cascade for the button (or, simpler, give `.btn-orange` etc. a computed-contrast fg).
2. **Dual-engine `--orange` desync:** the accent-button BACKGROUND renders inconsistently — sometimes the theme accent
   (`#f8fafc` white → broken), sometimes a fixed copper (`#e8720c` → readable) — depending on apply/boot sequence
   (the F-1 seam). After a hard reload, console `apply(id,false)` set `data-theme` but left vars desynced. This makes
   the live prod console unreliable for verifying a theme fix.

**Decision:** do NOT hot-patch prod. Implement on a branch (engine emits computed `--accent-fg`, gated on measured
contrast) and verify rendering in a local serve/emulator across the ~12 affected themes in both modes + the smoke /
theme-qa contrast tests, THEN deploy. Spawned background task covers this.

---

## 🟡 B-2 — `underwater` (light mode): primary CTA button slightly washed
**Severity:** Low · Axis A · light mode. The "NEW ESTIMATE"/"ADD" buttons in `underwater`'s light variant look
pale/low-emphasis (saturated-but-light teal). Legible but weak. Likely same accent-fg threshold family as B-1 on the
light end; lower priority (still readable). Confirm + fold into the B-1 fix.

---

## ℹ️ Behavior notes (NOT bugs — see PATTERNS.md)
- **Light-native themes stay light in "dark" mode.** `easter`, `minimalist`, `polaroid`, `ink`, `lofi`, `sakura`,
  `typewriter`, `paper`, `ghost`, `frosted`, `brutalist` render light/pastel even when mode pref = dark (the derivation
  preserves their light identity). Legible and on-identity — but a user who selects "dark" still sees a light theme.
  Product decision, not a defect.
- **`ghost`** is intentionally ultra-low-chroma (washed by design) — legible, low emphasis.
- **synthwave / cyberpunk / neon** share a pink-purple family — distinguishable but visually close.
