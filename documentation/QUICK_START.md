# Quick Start — orientation for a new session

> **Rewritten 2026-08-10** (site-wide audit): the previous content here was
> the original multi-tenant bolt-on integration guide from the legacy era —
> it walked through wiring files (`pro/js/company-admin.js`,
> `pro/js/nbd-auth-enhancement.js`, …) that no longer exist anywhere in the
> repo, and linked companion docs that now live in
> [archive/legacy/](archive/legacy/README.md). It was actively misleading as
> a "read-first" note. This is the current orientation.

## The read-first chain (in order)

1. [../CLAUDE.md](../CLAUDE.md) — session ground rules: hard invariants
   (strict CSP, generator-owned marker regions, cost privacy, cents-only
   money math), the pre-push gate list, and the vault-logging convention.
2. [INDEX.md](INDEX.md) — the map of this knowledge base. Its "Standing
   notes" section names the **current session handoff** — that handoff is
   your actual briefing for what's in flight.
3. [projects/WEEKLY_CADENCE.md](projects/WEEKLY_CADENCE.md) — the standing
   weekly checklist, Jo's one-off queue, and the ranked agent-session
   backlog (pick one per session).

## What this repo is

- `docs/` **is** the Firebase Hosting root — what's committed is what
  ships, publicly, and the repo itself is public. Marketing site at the
  root, multi-tenant contractor CRM under `docs/pro/`, admin tools under
  `docs/admin/`.
- `functions/` — Cloud Functions (see
  [../functions/FUNCTIONS_INDEX.md](../functions/FUNCTIONS_INDEX.md), the
  CI-enforced taxonomy).
- `site-src/partials/` — the generator-owned sources for the
  `<!-- nbd:partial -->` regions stamped across ~186 pages. Never hand-edit
  inside marker regions; edit the partial and restamp.
- `tests/` + `scripts/` — the gate suite. `tests/ci-manifest.json` is the
  suite registry; every gate is cheap and most run in plain Node.
- Architecture overview: [ARCHITECTURE.md](ARCHITECTURE.md) ·
  multi-tenant design:
  [architecture/MULTI-TENANT-ARCHITECTURE.md](architecture/MULTI-TENANT-ARCHITECTURE.md).

## Before you push anything

Run the gates your change touches — the list lives in
[../CLAUDE.md](../CLAUDE.md) §"Pre-push gates". All of them together take
under a minute.

## Sandbox quirks (remote/CI sessions)

See the "Environment notes" section of the current handoff — persistent
learnings (authed-e2e can't run in the sandbox, `npm install` not `npm ci`
in `tests/`, scrub the proxy env for emulator suites) are kept current
there, not here.
