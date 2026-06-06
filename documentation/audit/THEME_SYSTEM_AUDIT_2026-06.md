# NBD Pro — Theme System Audit (Phases 0 + 1)

**Date:** 2026-06-06 · **Branch:** `claude/nbd-theme-audit-hardening-SGeiH` · **Base:** `6656496` (cleanly ahead of `dfa6e65`)
**Scope:** Read-only ground-truth inventory (Phase 0) + ranked findings (Phase 1). **No theme code was modified.**
**Environment:** Local repo only. No prod access used, no Firestore writes, no deploys.

> The architecture summary in the kickoff brief was reconstructed from prior sessions and is **substantially stale**. This document is the corrected map verified against the current code. Items the brief feared that the code shows already-fixed are listed in **§4 Already-mitigated** so we don't re-flag them.

---

## PHASE 0 — Corrected Theme System Map

### Registries (where themes are actually defined)

| Registry | File | Count | Dialect | Live where |
|---|---|---|---|---|
| **CSS `data-theme`** | `docs/pro/css/theme-system.css` | **66** full color themes (+ accent-fg override blocks) | modern/CRM (`--bg --s --s2 --s3 --br --t --m --orange …`) | linked by ~14 pages |
| **JS engine `THEMES`** | `docs/pro/js/theme-engine.js:50–4908` | **186** (10 `locked`) | semantic keys (`bg/surface/surface2/text/muted/accent…`) → **emits** modern dialect via injected `<style>` | `dashboard.html`, `dashboard.legacy.html` |
| **Legacy `NBD_THEMES`** | `docs/pro/js/maps.js:1036` and a near-identical copy in `docs/pro/daily-success/js/app.js:1036` | **88** (legacy slugs: `default`,`batman`…) | palette (`--ac --gold --bar --bg --orange`) | `dashboard.html` (maps.js, `:12814`), daily-success |
| **Daily-Success inline** | `docs/pro/daily-success/index.html:382` (`<style id="ds-theme-system">`) | **176** `:root[data-theme]` rules | palette (`--ac --paper --ink --sbg --stxt …`) | daily-success standalone |

There is **no `nbdApplyTheme` single source of truth** as the brief assumed — that function exists only inside the legacy `maps.js`/`app.js` copies. The modern engine's entry point is `window.ThemeEngine.apply()`.

### The six live CSS-variable dialects (page → dialect matrix)

| Dialect | Distinctive vars | Defined in | Blast radius |
|---|---|---|---|
| **modern / CRM** (canonical) | `--bg --s --s2 --s3 --br --t --m --orange --gold` | `theme-system.css`, `login.html:194`, `customer.html` | primary; ~14 pages |
| **palette / Daily-Success** | `--ac --gold --bar --tabbar --paper --ink --sbg --stxt --grn --blu --pur` | `daily-success/index.html:24,382`; bridged into `dashboard.html:6157,6755` via `--ac:var(--orange)` | 2 surfaces |
| **codex** | `--void --surface --card --lift --border --gold` | `pro/vault.html:23`, `pro/ai-tool-finder.html:14`, `admin/{vault,login,mfa-enroll,analytics}.html` | 6 files |
| **understand** | `--bg --s1 --s2 --s3 --or --grn --tx --bdr` | `pro/understand.html:15`, `pro/project-codex.html:15` | 2 pages |
| **project-codex (cyan)** | `--bg --s --cyan --white --muted` | `admin/project-codex.html:41` | 1 file |
| **base / brand tokens** | `--nbd-navy --nbd-orange --primary --text-primary --status-*` | `docs/pro/css/nbd-brand.css:49+` | customer-facing: `portal.html`, `estimate-view.html`, `photo-review.html`, PDF templates |

> Brief corrections: the `understand` dialect uses `--s1/--tx/--bdr` (not `--sur/--b1/--b2/--rd`); the cyan `project-codex` dialect lives in **`docs/admin/`**, not `docs/pro/`.

### Application mechanisms (the "triple-application" question — CONFIRMED on the dashboard)

A single dashboard load runs **three** mechanisms that all touch `data-theme`:

1. **Hardcoded attribute** — `dashboard.html:3` ships `<html data-theme="nbd-original">`.
2. **Legacy `maps.js`** (`:171`) — sets `document.body.className='theme-'+id` **and** `documentElement[data-theme]=id` **and** inline `--ac/--bg/--orange/--bar` props; persists to `localStorage['nbd-theme']`; Firestore `users/{uid}.set({theme})`. Boots from `localStorage['nbd-theme'] || localStorage['ds-theme'] || 'default'` (`:445`).
3. **Modern `theme-engine.js`** — sets `documentElement[data-theme]` + injects high-specificity `:root[data-theme="X"]` `<style id="te-vars">` (overrides `theme-system.css`); persists to `localStorage['nbd_pro_theme']`; Firestore `userSettings/{uid}`. Boots via `ThemeEngine.init()` (`dashboard-ui.js:2006`).

**They use different localStorage keys** (`nbd-theme` vs `nbd_pro_theme`) and **disjoint ID vocabularies** (legacy `default/batman` vs modern `nbd-original/cobalt`). Whichever boots last wins the shared `data-theme` attribute; the other silently falls back.

### Persistence keys (corrected)

| Key | Owner | Status |
|---|---|---|
| `nbd-theme` | maps.js, daily-success, theme-init.js (login), dashboard-state/ui | **LIVE** (legacy engine's key) |
| `nbd_pro_theme` | theme-engine.js only | **LIVE** (modern engine's key) |
| `nbd_font` | maps.js (`NBD_FONTS`, ~97), dashboard-ui-prefs-boot.js | LIVE |
| `nbd_pro_mode_pref` | theme-mode-preboot.js, engine | LIVE (light/dark) |
| `ds-theme` | live **fallback** at maps.js:445, app.js:1375; r/w in dashboard-actions.js:910/952 | **LIVE — not dead** (brief was wrong) |
| `nbd_gt` | `daily-success/app.js:2` | **Not a theme key** — goal-tracker stats `{d,r,c}` (brief was wrong) |

### Firestore sync

- Modern engine: `userSettings/{uid}` `{theme, themeUpdatedAt}` (`theme-engine.js:5357`), guarded for `db`/`uid`, fire-and-forget `{merge:true}`. Hydrates on fresh device via poll (`:5262`), but **only applies remote themes that exist in the 186-entry JS registry** (CSS-only themes won't hydrate).
- Legacy maps.js: `users/{uid}.set({theme})` — a **different doc path**.
- Dead constant `FIRESTORE_PATH='user_settings/theme'` (`:20`) is never used.

### Tenant brand vs cosmetic (1F)

- **Tenant brand config exists:** `companies/{companyId}.colors` (`functions/seed-companies.js`); Oaks has its own (`{primary:'#333333', accent:'#e8720c', navBg:'#1a1a1a'}`). **But it is data-only — not wired into any rendered CSS surface.**
- **No cross-tenant bleed.** Every public surface picks a brand-locked/static palette: Oaks microsite = hardcoded `sites/oaks/style.css`; portal = `nbd-brand.css` via `data-nbd-brand`; PDFs = `functions/print/design-system.css`. None read `nbd-theme`/`data-theme`.
- **PDF palette is brand-aligned**, not the `#C0272D` red the brief feared (that hex does not exist anywhere). Print uses warm orange `#C8541A` + charcoal `#14181F` — a deliberate "print brand" that differs slightly from screen orange `#E8720C`/navy `#1E3A6E`.

---

## PHASE 1 — Ranked Findings

Severity = user impact × likelihood. Each carries **failure-mode-if-wrong** for the eventual fix (Rule 6).

### 🔴 F-1 — Dual theme engines fight over `data-theme` with split persistence keys (dashboard)
- **Where:** `dashboard.html:12814` (maps.js) + `:12874` (theme-engine.js); keys `nbd-theme` vs `nbd_pro_theme`.
- **Impact:** A user's saved theme can be written under one key and ignored by the other; on boot, last-writer-wins so the theme can silently revert or desync between sessions/devices. Two ID vocabularies mean a legacy value (`batman`) is unknown to the modern registry and vice-versa.
- **Blast radius:** every dashboard user.
- **Recommended fix:** pick the modern engine as sole authority on the dashboard; stop maps.js from applying/persisting a theme at boot (keep it for the maps feature's fonts only, or migrate it). Migrate `nbd-theme` → `nbd_pro_theme` once, reading both during a transition window.
- **Failure-mode-if-wrong:** a botched key migration logs **every** user out of their saved theme (resets to `nbd-original`). Mitigate with dual-read fallback + a one-time copy, never a destructive rename.

### 🔴 F-2 — Guaranteed FOUC on every dashboard load
- **Where:** `dashboard.html:3` hardcodes `data-theme="nbd-original"`; real theme applied only after the `defer` engine (`:12874`) + `ThemeEngine.init()` (`dashboard-ui.js:2006`) run, i.e. after parse. No `data-theme` preboot on the dashboard (only `data-mode` is preboot'd, `:17`).
- **Impact:** non-default themes flash `nbd-original` before swapping. Worse: because the engine injects a **navy** `nbd-original` that overrides the CSS **near-black** `nbd-original`, even the default theme visibly flips color after init. The async Firestore hydrate (250 ms–5 s later) can cause a *second* swap.
- **Blast radius:** every dashboard load.
- **Recommended fix:** add a synchronous `data-theme` preboot (like `theme-init.js`) in the dashboard `<head>`, reading the canonical key, before `theme-system.css`. Resolve the nbd-original double-definition (see F-4).
- **Failure-mode-if-wrong:** preboot reading the wrong key paints a theme the engine then overrides — replacing one flash with another. Must read the exact canonical key chosen in F-1.

### 🟠 F-3 — `nbd-original` defined twice with different colors (brand identity ambiguity)
- **Where:** `theme-system.css:1` = near-black `--bg:#0A0C0F`; `theme-engine.js:58` = navy `bg:#1e3a6e`. Engine's injected style out-specifies the CSS.
- **Impact:** "NBD Original" renders near-black or navy depending on whether the engine has initialized — the brand-default theme is non-deterministic across pages (login/customer use CSS near-black; dashboard ends up navy).
- **Blast radius:** brand default, all surfaces.
- **Recommended fix:** decide the canonical NBD Original palette (navy is the brand per `nbd-brand.css`/`#1E3A6E`) and make both definitions identical.
- **Failure-mode-if-wrong:** changing the default theme's colors changes what existing users see on next load — coordinate with brand, treat as intentional.

### 🟠 F-4 — Plan gate not enforced in `ThemeEngine.apply()`
- **Where:** `theme-engine.js` `apply()` (`:5288–5371`) never calls `isUnlocked()`/checks `theme.locked`. Gating lives only in the picker UI.
- **Impact:** any of the 10 `locked` achievement themes can be fully applied (DOM + localStorage + Firestore) via `ThemeEngine.apply('diamond')` from console, a stale persisted value, or any non-UI caller. **No half-apply** (it applies fully or not at all — the brief's half-apply fear is absent).
- **Blast radius:** cosmetic gating only; low security impact, violates product intent.
- **Recommended fix:** gate inside `apply()` — if `theme.locked && !isUnlocked(key)`, fall back to default and return. Also fix `isUnlocked()` throwing on unknown keys (`:5396` reads `.locked` on `undefined`).
- **Failure-mode-if-wrong:** over-strict gate could lock out a user who legitimately unlocked a theme if the unlock set hasn't hydrated yet — check `locked` only after `hydrateUnlocks()`.

### 🟠 F-5 — Contrast: muted text fails WCAG AA on many themes (incl. the default)
- **Where:** computed across both registries (scripts in `/tmp`, reproducible). Every failure is the `--m`/`muted` token; body text and the Wave 6 accent contract pass everywhere.
  - **CSS themes:** 20/66 fail AA-normal (4.5:1) on muted; **severe (<3:1, fails even large-text):** `terminal` (2.07), `ghost` (2.83). `nbd-original` muted fails (3.54 on card).
  - **JS themes:** 36/186 fail; **severe:** `avatar-fire` (2.59), `avatar-earth` (2.87); `spongebob` fails on **body** text too (yellow on blue, 3.32). Engine auto-tunes accent (3:1) and ink/paper (4.5:1) at runtime but **not muted**.
- **Blast radius:** secondary text legibility on ~1/3 of themes; the default theme included.
- **Recommended fix:** lift each failing `--m`/`muted` toward AA; quarantine themes that can't be saved without losing identity (`terminal`, `spongebob`).
- **Failure-mode-if-wrong:** lightening muted too far flattens the visual hierarchy — target ~4.5:1, not max contrast.

### 🟡 F-6 — Six live dialects / isolated pages the switcher can't restyle
- **Where:** codex/vault (`--void`), understand/project-codex (`--s1/--bdr`), admin cyan project-codex, daily-success palette (176 rules), ai-tree custom `:root`. None load the engine; all pin `data-theme="nbd-original"`.
- **Impact:** theme switching is dashboard-only; isolated pages are maintenance islands in 5 non-canonical vocabularies. Not user-breaking.
- **Recommended fix (Phase 2/3):** remap consumers to the canonical modern dialect; retire `NBD_THEMES`/daily-success palette or bridge via variable aliases.
- **Failure-mode-if-wrong:** remapping a var that a surface reads but you didn't verify breaks that surface's color — keep a compat alias layer during migration.

### 🟡 F-7 — `theme-achievements.js` calls non-existent `ThemeEngine.applyTheme()`
- **Where:** `theme-achievements.js:504,525` call `applyTheme`; engine exposes `apply()`. Guarded by `typeof===function`, so it **silently no-ops** — achievement theme apply/preview is dead via this path.
- **Recommended fix:** call `apply()`. Trivial, low risk.

### 🟡 F-8 — Firestore sync inconsistencies (low impact, latent)
- `db` (theme r/w) vs `_db` (unlock sync) global name mismatch (`:5414`) — unlock sync no-ops if only one is populated.
- Dead `FIRESTORE_PATH` constant.
- Legacy maps.js writes `users/{uid}.theme` while engine writes `userSettings/{uid}.theme` — two doc paths for the same concept.

---

## §4 Already-mitigated (do NOT re-flag)

- ✅ **Accent-on-fill contrast** — Wave 6 `--accent-fg`/`--accent-ring` contract + Wave 5e per-theme overrides clear the floor on all 66 CSS themes (`theme-system.css:91–176`). Engine also auto-tunes accent to 3:1 at runtime.
- ✅ **Cross-tenant theme bleed** — none. Public surfaces are brand-locked/static (§Phase 0 tenant section).
- ✅ **PDF palette drift to `#C0272D`** — does not exist; PDFs are brand-aligned.
- ✅ **Body-text contrast** — passes on every theme in both registries.
- ✅ **Half-applying locked themes** — does not happen; `apply()` is all-or-nothing.
- ✅ **`nbd_gt`/`ds-theme` "dead fallbacks"** — `nbd_gt` is unrelated (goal tracker); `ds-theme` is a live fallback. Neither is safe to "retire" as the brief implied.

---

## §5 Console / dashboard verification handoff (can't be seen from the repo)

1. **`userSettings/{uid}.theme` actually populating** — Firestore console, a few real users. Healthy = field present, recent `themeUpdatedAt`. Check whether legacy `users/{uid}.theme` is *also* populated (the split-write from F-1/F-8).
2. **Which key real browsers hold** — DevTools → Application → Local Storage on a live operator: are both `nbd-theme` and `nbd_pro_theme` set, and do they agree? Disagreement confirms F-1 in the wild.
3. **`companies/{companyId}.colors`** — confirm Oaks's doc exists and whether anything is meant to consume it (currently inert).
4. **Console errors on theme switch** — watch for `[theme-engine] Firestore sync/hydrate failed` warnings and any `isUnlocked` throw on unknown keys.
5. **Visual FOUC capture** — record a dashboard cold-load on a non-default theme; confirm the nbd-original flash + the near-black→navy flip (F-2/F-3).

---

## §6 Decision log (PROPOSED — pending your approval, nothing applied)

| Decision | Proposal | Status |
|---|---|---|
| Canonical vocabulary | modern/CRM (`--bg --s --s2 --s3 --br --t --m --orange …`) | proposed |
| Canonical application mechanism | `data-theme` attribute + engine-injected `<style>`; retire body-class + inline-prop paths | proposed |
| Canonical persistence key | `nbd_pro_theme`, with one-time `nbd-theme`→`nbd_pro_theme` dual-read migration | proposed |
| Legacy keys to retire | none yet — `ds-theme` live, `nbd_gt` unrelated | confirmed |
| Tenant-brand model | keep `companies/{companyId}.colors` authoritative for public surfaces; cosmetic themes stay operator-chrome-only (already true) | proposed |

**STOP — awaiting review of these findings before any Phase 2 fix lands (Rule 5).**
