# NBD Pro — Theme System Phase 3 (Durability)

**Date:** 2026-06-06 · Follows `THEME_SYSTEM_AUDIT_2026-06.md` (Phases 0–2).
Phase 2 fixed correctness; Phase 3 makes the system durable. One item shipped as
code (the automated QA gate); the rest are the design + flow this doc records so
the next change is a config edit, not an archaeology dig.

---

## 1. Automated theme QA — SHIPPED ✅

`tests/theme-qa.test.js`, wired into the CI smoke job + `npm test`. For every
theme in both registries (186 engine + 66 static) it asserts required vars exist
and text/muted/accent clear the WCAG floor **as rendered** (it extracts the real
engine colour helpers and replicates the tune contract). A broken or illegible
theme now fails CI. 1012 assertions; verified to fail on an injected bad theme.

**This is the safety net for everything below** — any token refactor or new theme
is guarded by it.

---

## 2. Token architecture — proposed two-tier model

Today themes set the *semantic* vars directly (`--bg --s --s2 --t --m --orange`),
and the engine derives a few more at render (`--bg`=bgDerived, `--ink/--paper`,
tuned accent/muted). That already behaves like a one-and-a-half-tier system. The
durable target is an explicit **primitive → semantic** split:

```
Tier 1  PRIMITIVES   raw palette a theme authors: --p-bg, --p-surface,
                     --p-accent, --p-text, --p-muted …  (THEMES[x].colors)
Tier 2  SEMANTICS    what components read, NEVER a primitive:
                     --bg --s --s2 --s3 --t --m --orange --paper --ink …
                     (emitted by generateCSSVariables, already the case)
Tier 3  THEME        a theme is just a Tier-1 primitive set + flags
                     (mode, overlay, font); Tier 2 is computed from it.
```

**Migration path (low-risk, already half-done):**
- The engine's `generateCSSVariables` is the Tier-1→Tier-2 compiler. It already
  derives `--bg/--paper/--ink` and tunes `--orange/--m`. Extending it to emit the
  full semantic set from named primitives is incremental.
- The **F-6 compat-alias bridge** (in `theme-system.css`) is the Tier-2 alias
  layer for legacy dialect names — the seam where isolated pages join the model.
- **Rule for components:** read semantics only (`var(--s2)`, never a raw hex or a
  primitive). The `.dn.dn`/utility-class layer already follows this.

**Why not rip-and-replace now:** every isolated page (vault/understand/
project-codex/ai-tree, daily-success) hardcodes a Tier-2 dialect; converting them
needs per-page visual QA (no headless way to verify). Do it page-by-page behind
the QA gate, deleting each page's hardcoded `:root` so it inherits via the bridge.

---

## 3. Theme-authoring path — "one validated entry"

**Canonical path (engine themes):** add one object to `THEMES` in
`docs/pro/js/theme-engine.js`:

```js
'my-theme': {
  name: 'My Theme', category: 'professional', locked: false, unlockCondition: null,
  colors: { bg, surface, surface2, text, muted, border, accent, accentBg,
            green, red, gold, blue },           // ← required keys (QA-enforced)
  overlay: { type: 'none' }, font: { heading: null, body: null },
  cursor: null, borderRadius: '12px', borderStyle: 'solid',
  transition: '0.2s ease', cardEffect: null, specialClass: null
}
```

That single entry gives you: data-theme rendering (engine injects the CSS),
picker swatch, persistence, Firestore sync, and **automatic contrast tuning**
(muted/accent/ink). `theme-qa.test.js` then validates it on commit — if its
muted can't reach AA on its card or a required var is missing, CI blocks it.
**No CSS hand-editing, no edits in N places.**

**Legacy path to retire:** the 66 static `:root[data-theme]` blocks in
`theme-system.css` and the 88-entry `NBD_THEMES` in `maps.js` are parallel
hand-maintained copies. Target end-state: `theme-system.css` carries only
`nbd-original` (the no-engine fallback) + the compat bridge; everything else is
engine-generated. The static themes that remain are the QA test's static arm.

---

## 4. Tenant-brand onboarding — config, not code

**Current state (from the audit):** `companies/{companyId}` carries an
authoritative brand record — `{ logo, colors: { primary, accent, navBg } }`
(`functions/seed-companies.js`). Oaks has its own. **But it drives no rendered
surface** — public pages (microsite, portal, PDFs) each hardcode their palette.
Cosmetic per-user themes correctly never touch public surfaces (no bleed).

**Target flow — spin up a new tenant's brand as a config entry:**

1. **Brand record** — create `companies/{companyId}` with `{ name, logo,
   colors:{ primary, accent, navBg } }`. This is the single source of truth for
   anything client-facing.
2. **Public surfaces read it** — give the portal / microsite / PDF templates a
   small boot step that resolves `companyId` (already done via the `companyId`
   custom claim + `myCompanyId()` in `firestore.rules`) and writes the brand
   colors into `--primary/--accent/--nav-bg` on `:root` (mirroring the existing
   `data-nbd-brand` lock in `nbd-brand.css`). Replaces today's hardcoded
   `sites/<tenant>/style.css` per-file palette with one dynamic read.
3. **PDF brand** — pass the tenant's `colors` into `functions/print/design-system.css`
   generation instead of the static print palette, so documents match the tenant.
4. **Cosmetic themes stay operator-chrome-only** — unchanged; the dashboard's
   `nbd-theme`/`nbd_pro_theme` never feed any of the above.

**Onboarding checklist addition** (extend `runbooks/ONBOARD_TENANT.md`):
> Set `companies/{id}.colors` (primary/accent/navBg) + `logo`. Verify the
> microsite, a shared portal link, and a generated PDF all render the new brand —
> and that switching the operator's cosmetic theme does NOT change any of them.

This keeps Scott/Oaks and every future tenant a **config entry**, and preserves
the audited tenant/cosmetic separation.

---

## Status

| Phase 3 item | State |
|---|---|
| Automated theme QA wired to CI | ✅ shipped (`tests/theme-qa.test.js`) |
| Two-tier token architecture | designed; incremental migration behind the QA gate |
| One-entry validated theme authoring | engine path already true + now QA-validated; legacy static/`NBD_THEMES` copies to retire |
| Tenant-brand onboarding (config not code) | flow documented; wiring `companies.colors` → public surfaces is the build step |
