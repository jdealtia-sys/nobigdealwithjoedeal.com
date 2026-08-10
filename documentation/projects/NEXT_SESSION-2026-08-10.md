# Next Session — after the 2026-08-10 jobs-board + weekly-cadence session

> Cold-start brief, written 2026-08-10 at session end. Self-contained.
> Predecessor [NEXT_SESSION-2026-08-07](NEXT_SESSION-2026-08-07.md) still
> carries the live deferred queue (advisory-CI promotion, offline persistence,
> wizard deletion, …) — this brief only supersedes it for the Featured
> Projects / posting lane. Read the repo-root [CLAUDE.md](../../CLAUDE.md)
> first. The standing weekly checklist now lives in
> [WEEKLY_CADENCE](WEEKLY_CADENCE.md).

## What this session shipped (branch `claude/homeowner-editable-jobs-yl4j0x`)

1. **P0 fix: /our-work shipped UNSTYLED at HEAD.** PR #1194's icon-CSS
   consolidation (`caab17e`, 2026-08-07) deleted the page's entire ~150-line
   style block — `.gallery`, `.project*`, `.filters`,
   `.project.hidden{display:none}` (the rule filtering depends on), hero,
   before/after, CTA — and no gate caught it (zero e2e/visual coverage of
   /our-work; the visual-regression PAGES list is `/pro/*` + `/` only).
   Restored from `f6adb09`; card/filter/gallery rules extracted to shared
   **`docs/assets/css/project-cards.css`**; page one-offs back inline;
   `tests/marketing-polish-contract.test.js` now asserts the stylesheet +
   `.project.hidden` + the page hero rule exist (guard for the regression
   class). Also fixed a double-encoded em-dash in the gallery intro.
2. **Service taxonomy.** `projects.json` entries now carry required
   `services[]` — 1+ of the 7 hub slugs (`roof-replacement`, `roof-repair`,
   `siding-replacement`, `siding-repair`, `gutter-replacement`,
   `storm-damage`, `roof-inspection`); multi-valued so a hail-claim tear-off
   sits on both Storm and Replacement surfaces. `category` demoted to
   optional legacy. Warn-only unknown-field check added (typo net). All 12
   seeds backfilled — **flag for Jo**: the 2 commercial apartment entries +
   A-frame metal are labeled `roof-replacement`; confirm or refine.
3. **/our-work upgrades.** Filter buttons generated from SERVICES (with
   `id="svc-<key>"` so `/our-work#svc-roof-repair` is a real, checkable
   anchor); cards carry `data-services` (multi-match filtering) + crawlable
   service pills linking to hub pages; gallery + all strips render newest
   `published` first (stable sort → new entries are APPENDED to
   projects.json); schema `serviceType` comes from `services[0]`.
4. **"Recent jobs" strips on the 8 service hub pages.** New
   `OURWORK-STRIP-START service="…"` marker regions (distinct namespace,
   placed outside all `nbd:partial` regions, directly above each page's
   `#quote` form), stamped by the SAME `build-projects.mjs` run — so
   ci.yml's existing `--check` (line ~555) and firebase-deploy.yml's
   existing regen step cover them with ZERO workflow edits. ≤3 newest
   matching jobs as pure-anchor cards (no new JS on hubs); 0 matches → CTA
   band, never an empty grid. The hail hub reuses `service="storm-damage"`.
5. **Homepage wall lit up.** `docs/assets/data/homeowner-wall.json` is now
   GENERATED from live projects (12 entries — image/city/alt), so the
   dormant `#homeowner-wall` section on the homepage reveals itself and the
   two manifests can't drift.
6. **Posting flow (phase 1).** [PUBLISH-PROJECT](../runbooks/PUBLISH-PROJECT.md)
   rewritten: phone-paste intake template (Jo → Claude session → PR → Merge
   in the GitHub app), services cheat-sheet, append-at-end rule, all-stamped-
   files commit rule. Repo is PUBLIC → photos must never ride GitHub
   issues/attachments (EXIF + world-readable CDN); they come via CRM export
   or text, and always through `prepare-project-images.mjs`.
7. **Vault**: [WEEKLY_CADENCE](WEEKLY_CADENCE.md) standing note (Jo weekly ·
   agent weekly · one-off queue · session backlog), INDEX.md gained a
   "Standing notes" section, this handoff marked current.

## Verified

All cheap gates green: build-projects --check (12 live, 8 strips),
site-integrity (0 fail / 206 pages), apply-partials --check (549 regions),
sitemap zero-diff, inline-scripts, js-syntax (471 files), catalog-cost-privacy
(42), marketing-polish (51 incl. 5 new). Headless-Chromium screenshots
confirmed: styled gallery + working filter row, roof-repair strip above the
quote form, siding empty-state CTA band.

## Jo actions (new this session — full queue in WEEKLY_CADENCE)

1. Review/merge the draft PR from this branch.
2. Confirm service labels on the 2 commercial entries + A-frame metal.
3. First priced project + real-city backfill on the seeds (~10 min).
4. Post the first siding/gutter/repair job via the phone template — those
   strips run on empty-state CTAs until fed.

## Next session candidates (this lane)

1. **Jobs-posting phase 2 — admin form + PR bot** (decided direction:
   git-native; Firestore CMS and GitHub-issue intake were evaluated and
   rejected — heaviest infra / public-repo photo hazard respectively).
   Pieces: `docs/admin/post-job.html` + `js/pages/post-job-app.js` (vault.html
   claim-gate pattern, mobile-first); `draftProjectPR` Cloud Function
   (adminAI auth pattern, sharp re-encode from Storage originals mirroring
   prepare-project-images.mjs, GitHub contents API via plain fetch, branch
   `post-job/<slug>` + PR); restamp bot workflow on `post-job/**` (must push
   with a PAT — `GITHUB_TOKEN` pushes don't retrigger checks); Jo one-off:
   fine-grained single-repo PAT → `firebase functions:secrets:set`.
   ~4 sessions. Only build it once the phone-template habit proves posting
   volume (>1–2/month) justifies it.
2. **/our-work/<slug> detail pages** (needs a curated build-sitemap.js rule)
   + Haiku blurb drafter over CRM `aiSuggestion` captions.
3. **Add /our-work to visual-regression PAGES** once Jo blesses baselines —
   it was the uncovered page that let the #1194 regression ship.

## Watch-outs discovered

- **Staged dates got wider**: a passed `published` date now makes `--check`
  red across up to ~10 stamped files (one `node scripts/build-projects.mjs`
  restamp fixes all). Phone-template posts use today's date, avoiding this.
- The hail hub page's `footer-extended` partial region has an opening marker
  but **no closing marker** (pre-existing on main; apply-partials --check
  passes anyway). Worth a look during the next partials sweep.
- Sandbox notes from 2026-08-07 still hold (authed e2e can't run here; use
  `npm install` not `npm ci` in tests/; scrub proxy env for emulator suites).
