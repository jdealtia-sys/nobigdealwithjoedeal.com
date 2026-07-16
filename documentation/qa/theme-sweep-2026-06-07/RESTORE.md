# Theme Sweep — Restore Record (2026-06-07)

## Pre-sweep baseline (from live localStorage, unauthenticated read)
- nbd_pro_theme = nbd-original
- nbd-theme = nbd-original
- nbd_pro_mode_pref = dark
- nbd_font = null (engine default)
- ds-theme = nbd-original

## Authoritative baseline (Firestore userSettings/{uid}) — PENDING login handoff
_(to be recorded once Jo logs in)_

## Post-sweep restore — ✅ CONFIRMED (2026-06-07, end of run)
Ran `ThemeEngine.setModePref('dark')` + `ThemeEngine.apply('nbd-original', true)` (write-through to localStorage + Firestore).
Verified live read-back:
- `ThemeEngine.getCurrent()` = `nbd-original` ✓
- `ThemeEngine.getModePref()` = `dark` ✓ · resolved mode = `dark`
- `localStorage.nbd_pro_theme` = `nbd-original` ✓ · `localStorage['nbd-theme']` = `nbd-original` ✓ (keys agree)
- `localStorage.nbd_pro_mode_pref` = `dark` ✓ · `nbd_font` = null ✓
- `<html data-theme>` = `nbd-original` · `<html data-mode>` = `dark` ✓

**Matches the pre-sweep baseline exactly. Jo's account is exactly as it started.**
The sweep applied every theme with `save=false` (render-only, no persistence); the only persisted writes all run
were the mode pref (toggled light/dark during the sweep) and this final restore — fully reversible, now reverted.
