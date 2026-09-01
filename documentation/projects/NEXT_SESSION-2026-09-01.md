# Next session — brief as of 2026-09-01

> Read this first. It supersedes
> [NEXT_SESSION-2026-08-31](NEXT_SESSION-2026-08-31.md), whose lanes are now
> almost all closed. Session record for the long 08-31 run:
> [SESSION-2026-08-31-sweep-rocks-and-four-cards](SESSION-2026-08-31-sweep-rocks-and-four-cards.md).

## State of the world

**22 PRs merged across the 08-31 → 09-01 run** (#1301–#1320, #1325, #1326),
several of them from background sessions working in parallel.

- **/our-work: 44 live projects, 37 priced.**
- **Marketing is fully caught up** and was the biggest surprise of the run —
  see [POSTING-LOG](../marketing/POSTING-LOG.md). The whole 08-28 kit shipped
  (4 GBP posts + 2 Facebook, the FB page's first posts ever), every unreplied
  Google review was answered, the service area was fixed at the 20-area cap,
  and the photo gallery got its first refresh in 147 days.
- **Rock 2** — the wizard-deletion gate was proven *unobservable* and fixed
  (#1303). The real 30-day Sentry clock runs to **~2026-09-30**. Both Jo
  decisions are recorded: pre-V2 docs stay READ-ONLY, legacy snapshot
  refreshed. Nothing to do but check Sentry weekly.
- **Rock 4 Tranche 3** — moving fast: **T3-0 ✅** (#1316), **T3-A slice 1 ✅**
  (#1319, 86 inert re-exports deleted), **T3-M ✅** (#1326), plus a wiring
  test (#1320).
- **The `_admin` migration is nearly done** — four of six scripts ported
  (#1318, #1325), with a real bug fixed along the way.

## Lanes, in priority order

1. **Rock 4 Tranche 3 — keep going.**
   [globals-tranche3-plan](../../docs/dev/globals-tranche3-plan.md) is the
   map and it is being kept current as slices land.

   **Do not start from "the rest of T3-A (~2 more mechanical PRs)".** Slice 1
   disproved that framing and the plan now carries a ⚠ CORRECTION block saying
   so: of the 34 candidate names the census produced for `dashboard-actions.js`,
   **zero were mechanically safe** and 26 were not even owned by that file. The
   filter behind the "277 mechanically-safe" band cannot see bare cross-file
   calls or `window[fnName]` map dispatch, so its output is a starting list, not
   a work list. Re-derive any T3-A slice with a checker that tests both — see
   [SESSION-2026-08-31-t3-a-slice1](SESSION-2026-08-31-t3-a-slice1.md).

   **The concrete next work is the 15 names T3-M just unblocked.** Making the
   two dispatch maps registry-first freed 17 of their 36 names; 2 landed with
   that slice, and the other 15 are grouped by owning file, one slice each:
   `dashboard-ui.js` (8), `maps-routing.js` (6), `crm-portal-bridge.js` (1).
   Each is measured, not estimated — the map is their only reach. Expect real
   work rather than a one-line move: they are top-level auto-globals, so
   converting them means IIFE-wrapping regions of large files.

   After that: **T3-B** (177 names with HTML hits or twin assigners), **T3-C**
   (176 one-consumer by edge, ~5–6 PRs), **T3-D** (the 131-name 2–5 band →
   NBD-prefixed singleton APIs), **T3-E** (docs-only spine disposition, half a
   session).

   Re-run `node scripts/globals-xref.js` before trusting any number in the plan
   — that habit already caught a 4× overestimate once. **But the census alone is
   not enough**: it reproduces the plan's numbers exactly and still missed all
   three defects slice 1 found. When a slice is defined by a tool's output,
   audit the tool before executing the slice.

2. **Four dependabot PRs are open and unreviewed** — #1321 (setup-java),
   #1322 (firebase), #1323 (firebase-tools), #1324 (playwright). All opened
   09-01, all still running checks. These are the weekly-sweep item; merge on
   green.

3. **Finish the `_admin` migration** — a chip is queued for the last two
   (`import-cost-rotation.js`, `import-job-template-costs.js`). **They break
   differently from the first four:** they resolve fine via their own
   `createRequire` fallback and then die at first use of `admin.apps`,
   `admin.firestore()` and `admin.firestore.FieldValue.serverTimestamp()`.
   And unlike the previous pair, **these two genuinely write a server
   timestamp**, so the "the Timestamp warning is false" finding from #1325
   must NOT be copy-pasted onto them. They write tenant cost data to
   `catalogCosts/{companyId}` — the most sensitive data in the repo.

4. **`.github/workflows/address-audit.yml` still pins firebase-admin@12 via
   `NODE_PATH`** on a rationale that #1325 disproved. `_admin` tries a bare
   `require.resolve` FIRST, so `NODE_PATH` *beats* `functions/` and defeats
   the single-resolver guarantee that pin was meant to protect. Fix as its
   own PR — quietly breaking a scheduled job nobody watches is its own
   failure mode.

## Marketing — what the 08-31 run learned

**Photos out-reach posts on this profile.** Gallery images show 188, 308 and
**one past 1,000 views** — more than a typical post earns, on the surface
that had been neglected for 147 days. Start the next marketing session with
photos, not copy.

The biggest open gap costs nothing: **no photo on the profile shows a human
face.** For a brand built on "Talk to Joe — not a salesman," that is the
single best fix available, and `docs/assets/images/joe-hero.jpg` is already
in the repo. Six more gaps are listed in POSTING-LOG.

**Two constraints, so no future handoff assigns impossible work:** Jo drives
an **unbranded work wagon and has no magnets**, so "photograph your truck
door" is not available. And the **storefront slot does not apply** to a
service-area business — Profile Strength may never read full. Do not upload
a customer's house to satisfy it.

## Held content (Jo's calls, no agent action)

- **Sharon Batavia / Southman** — the siding-replacement strip is still
  empty and unfillable from Drive (settled 08-28, do not re-run that search).
  Live path is the Southman proposal (NBD-2026-0811-STH Option B, $4,600); if
  Jo closes it, document as it happens.
- **Review authenticity** — the 7–18-week review cluster has hallmarks of
  purchased reviews (one describes a *plumbing* job; one account is an Indian
  engineering college). Jo states they are genuine; replies went out on his
  instruction, deliberately worded to claim nothing. Recorded in POSTING-LOG
  because a fake-review purge can suspend an entire profile.

## Watch-outs

- **`main` is held by a worktree** at `C:/Users/jonat/nbd-wt-ledger-recon` —
  branch from `origin/main`, never check out `main` in the primary checkout.
- **Three `.claude/worktrees` are live.** Removing one deletes THROUGH a
  node_modules junction — gated procedure, see the 08-26 session note.
- **Two branches are deliberately kept**: `chore/stripe-pin-harden` carries
  an explicit `[DO NOT MERGE w/o test-mode verify]`, and
  `claude/silly-archimedes-2eabef` is now redundant (its work shipped as
  #1318) but is held by a worktree.
- **The 08-28 photo scratchpad was preserved** to
  `C:\Users\jonat\NBD-photo-staging-2026-08-31` (1.7 GB) before Windows temp
  could evaporate it. EXIF-bearing originals — never commit or publish
  directly.
- **Verify before trusting a docstring.** This run disproved two: the
  "v14 breaks Timestamps" line that had copy-pasted itself into seven
  scripts, and the `NODE_PATH` remedy that turned out to cause the very
  problem it warned about.
