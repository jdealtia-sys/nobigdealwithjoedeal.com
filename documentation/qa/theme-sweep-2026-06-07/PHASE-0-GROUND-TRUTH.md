# Theme Visual Sweep — Phase 0 Ground Truth (2026-06-07)

**Run owner:** Jo Deal · **Repo:** `nobigdealwithjoedeal.com` · **Branch:** `main` · **HEAD:** `fe1f06c8`
**Live target:** https://nobigdealwithjoedeal.com/pro → redirects to `/pro/dashboard`
**Method:** code read (repo) + live engine probe (Chrome MCP, read-only). No theme applied, no writes.

---

## 0.1 — The brief's map was stale; here is the corrected one

A full theme audit already exists at `documentation/audit/THEME_SYSTEM_AUDIT_2026-06.md`
(dated 2026-06-06) and its **Phase-2 fix wave shipped and is LIVE on prod**:

- Merged via **PR #557** "Theme system audit + hardening (Phases 0–3)" (squash → `1c9c9b3a`)
  and **PR #568** follow-ups (`80556c79`, 2026-06-07). Per the auto-deploy-on-main pipeline,
  both are deployed to prod.
- The individual audit-branch commit hashes (`c611455`, `ce9472b`, `c9c3b48`, …) are **not**
  ancestors of `main` only because they were squashed — the *content* is in.

**Live confirmation the fix is deployed:** on the live dashboard, `localStorage.nbd_pro_theme`
and `localStorage['nbd-theme']` now **agree** (`nbd-original`) — that is exactly the F-1
key-convergence / write-through fix rendering in the wild.

### What that means for THIS sweep
| Brief assumption | Reality |
|---|---|
| ~112 themes | **186** in the JS engine registry (10 locked); 66 in the CSS registry |
| Fragmentation (6 dialects, dual-engine `data-theme` fight, split keys) unconfirmed | **Already mapped AND fixed** (F-1/F-2/F-3/F-6). Keys converge live. |
| Axis A (contrast) needs a live sweep | **Already swept computationally + fixed.** All 66 CSS themes pass AA; engine auto-tunes `--m`/accent/ink-paper at runtime. CI gate `tests/theme-qa.test.js` checks BOTH modes + raw `--t`. |
| `nbdApplyTheme(id)` is the single apply fn | No such global. Canonical = **`window.ThemeEngine.apply()`**. |

➡ The genuinely-NEW, un-done payload of this brief is **Axis B (identity fidelity)** —
which the computational audit explicitly did *not* cover — plus **live visual confirmation**
that the landed fixes actually render, plus the **known residual problem themes**.

---

## 0.2 — Light/Dark model (RESOLVED from `theme-engine.js`)

**Model = one global mode toggle that overlays the active theme, with per-theme algorithmic derivation.**

- Pref key: `localStorage.nbd_pro_mode_pref` = `light | dark | auto` (auto follows OS).
- Engine derives the variant: `deriveLightPalette()` (`:5061`) / `deriveDarkPalette()` (`:5087`)
  → `resolvePalette(theme, mode)` (`:5117`); stamps `<html data-mode="light|dark">`.
- Preboot: `js/theme-mode-preboot.js` stamps `data-mode` in `<head>` before CSS (anti-FOUC).
- ⇒ **Every theme supports both modes** (derived). The matrix is `186 themes × {light, dark}`.
- Engine API live: `apply, get, getAll, getByCategory, getCategories, getCurrent, isUnlocked,
  unlock, hydrateUnlocks, previewCSS, previewResolvedColors, getMode, getModePref,
  setModePref, getResolvedMode`.

## 0.3 — Registry (live `ThemeEngine.getAll()`, 186 total, 12 categories)

| Category | Count | Category | Count |
|---|---|---|---|
| professional | 15 | mood | 22 |
| nature | 14 | seasonal | 9 |
| luxury | 12 | anime | 25 |
| scifi | 18 | cartoon | 25 |
| popculture | 18 | achievement | 7 |
| sports | 8 | construction | 13 |

**10 locked themes** (achievement-gated): `diamond, hologram, dragon-ball-super, gold-rush,
eternal-flame, iron-door, completionist, night-owl, road-warrior, legend`.
Note: locked themes span categories (e.g. `diamond`∈luxury) — "achievement" category (7) ≠ the 10 locked.

## 0.4 — Restore baseline (Rule 0) — captured PRE-sweep, from live localStorage
- `nbd_pro_theme` = `nbd-original`
- `nbd-theme` = `nbd-original`
- `nbd_pro_mode_pref` = `dark`
- `nbd_font` = `null` (engine default)
- `ds-theme` = `nbd-original`
- ⚠ Authoritative copy is Firestore `userSettings/{uid}` — can only be read once Jo is logged in.
  Will reconcile + record final restore values in `RESTORE.md` after handoff.

## 0.5 — Blockers / open items before Phase 1
1. **Jo is NOT logged in** (`firebase.auth().currentUser === null`). The dashboard shell renders,
   but data-dense surfaces (leads, kanban, charts) need auth. Need Jo's authenticated handoff.
2. **Scope decision pending** (see chat) — full 186×2 grind vs. focused Axis-B + fix-confirmation pass.
