# CLAUDE.md — session ground rules for this repo

## What this is

A hand-authored static marketing site (`docs/` **is** the Firebase Hosting
root — what's committed is what ships) plus a multi-tenant contractor CRM
(`docs/pro/`), Cloud Functions (`functions/`), and a heavy test/CI gate
suite. Strict CSP: no inline scripts, no inline handlers
(`script-src-attr 'none'`).

## Read first

- `documentation/INDEX.md` — the knowledge-base home note (Obsidian vault)
- `documentation/QUICK_START.md` — orientation
- The current `documentation/projects/NEXT_SESSION-*.md` — the standing
  handoff brief; check INDEX.md's "Session handoffs" line for which is current

## Obsidian vault logging (standing rule, per Jo 2026-08-06)

The repo root opens as an Obsidian vault (setup instructions at the top of
`documentation/INDEX.md`). Every deep audit, system-mechanics investigation,
or recon-heavy session **writes its findings back**:

- **Dated note** under `documentation/` — session logs and handoffs in
  `projects/`, audits in `audit/`, QA sweeps in `qa/<campaign>/`.
- **Link it from `INDEX.md` in the same PR** — an unlinked note is invisible.
- **Correct stale docs in place** when your recon contradicts them (dated
  update section at the top or bottom) — append-only rot is how the
  2026-07 audit doc cost a session hours of re-verification.
- Plain relative markdown links only (they work in Obsidian AND on GitHub).
- End multi-lane sessions with a fresh `NEXT_SESSION-<date>.md` handoff.

## Hard invariants (each is CI-enforced — don't fight the gates)

- New client JS = external file under `docs/assets/js/` (or `docs/pro/js/`),
  loaded with `defer`. Never inline `<script>`, never `on*=` attributes.
- Marker regions are **generator-owned** — never hand-edit between
  `<!-- nbd:partial ... -->`, `BLOG-*`, or `OURWORK-*` markers. Edit the
  source (`site-src/partials/`, the POSTS array,
  `docs/assets/data/projects.json`) and restamp with the matching script.
- Never publish cost/contractor/margin keys or figures anywhere under
  `docs/` — retail prices are fine and deliberate
  (`tests/catalog-cost-privacy.test.js` is the guard).
- Never put CRM Storage URLs (`?token=` links) or un-re-encoded photos on a
  public page; photos ship as EXIF-stripped copies under `docs/assets/`
  (see `documentation/runbooks/PUBLISH-PROJECT.md`).
- Money math stays in cents; estimates read `window.NBD_ESTIMATE_CONFIG`.

## Pre-push gates (run what your change touches; all cheap)

```bash
node scripts/check-js-syntax.js
node scripts/check-site-integrity.js --quiet
node scripts/apply-partials.js --check --diff
node scripts/build-sitemap.js          # dry-run drift check
node scripts/build-projects.mjs --check
node scripts/check-inline-html-scripts.js
node scripts/check-image-privacy.js       # EXIF/GPS strip invariant (images)
node tests/smoke.test.js               # CRM changes (needs functions/ deps)
node tests/marketing-polish-contract.test.js
```

Emulator suites in this sandbox need the proxy env scrubbed:
`env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy npx firebase-tools emulators:exec …`
Don't commit `proxy-agent-negotiate` lockfile drift from a local
`npm install` in `tests/`.
