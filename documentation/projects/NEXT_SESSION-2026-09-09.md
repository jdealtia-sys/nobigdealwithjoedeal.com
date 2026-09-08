# NEXT SESSION — 2026-09-09

Supersedes [NEXT_SESSION-2026-09-08](NEXT_SESSION-2026-09-08.md), which had
grown to four lanes from three parallel sessions and had gone stale in places
that matter. That brief is still the **full write-up** for each lane — this one
carries what is still true and still open, and says where it disagrees.

**How this brief was built, because it changes how much you should trust it.**
Every open item in the 09-08 brief was re-checked against `main` at `9204c849`
by independent agents, and everything they called closed or changed was
re-checked again by a second agent that was told not to trust the first.
**73 verdicts: 21 still open, 18 closed, 32 changed, 2 unverifiable.** The
"changed" pile is the point — a third of the live brief described the repo
inaccurately after two days. Claims below that rest on **production** state
(Secret Manager, Cloud Run revisions, Firestore counts, prod logs) came from
those agents and are marked ⚠︎; I verified the repo-side mechanism of §1 myself
and marked it accordingly. Treat ⚠︎ lines as leads to re-run, not as facts.

---

## §0 — Jo's queue

1. **Sunday 2026-09-13: do NOT set `TURNSTILE_SECRET`.** The scheduled task
   frames it as a go/no-go on a token-rate report. Both halves of that framing
   are wrong: the report will be empty, and enforcing today would **reject
   every lead from six of the ten public forms**. Read §1 before touching it.
   Nothing bad happens if you do nothing — the secret is still the 2026-04-14
   `__unset__` stub and the verifier fails **open** while unconfigured.
2. **Sunday is also the first Instant Roofer weekly invoice.** Worth opening
   Billing then — and it is still the only authority on the open question of
   whether a 404 ("roof not found") or 422 ("too large or irregular") is
   billed. Neither has happened yet, so the hole in
   [INSTANTROOFER-SETUP](../runbooks/INSTANTROOFER-SETUP.md) stands.
3. **One warranty number is yours to set.** `docs/pro/js/close-board.js:195`
   defaults the close-board warranty field to `'25-year limited lifetime'` —
   self-contradictory, and it matches none of the tiers you set on 09-08
   (Good 5 / Better 10 / Best 20). It is a rep-overridable default that ships
   on a customer-facing document. Left alone deliberately rather than guessed
   at. See §7.
4. **Nothing else.** Auto-measure is done and worked — see §2.

---

## §7 — Added 2026-09-08 evening: the claims audit lane

This brief was written before that lane ran and has no knowledge of it. Eight
PRs merged; full write-up in
[SESSION-2026-09-08-claims-audit](SESSION-2026-09-08-claims-audit.md) and
[PULSERELATE-RECON-AND-PRO-DOMAIN-2026-09-07](../audit/PULSERELATE-RECON-AND-PRO-DOMAIN-2026-09-07.md).
Nothing here contradicts §§1–6 — it is a different lane, on the `/pro`
marketing and help surface.

**What changed under you, if you are working anywhere near `/pro`:**

- **Warranty is now 5 / 10 / 20** (Jo's call) in sixteen places — the
  generator, certificate rows and expiry dates, tier dropdown and card, the
  company value prop, both price comments and the how-to. The tree had
  previously carried *three different answers*. **Manufacturer warranties were
  deliberately not touched**: the three TAMKO Limited Lifetime shingle refs,
  Class 4 50yr, RoofIVent 50yr, GAF Pivot Boot 50yr, the 3-Tab 25yr catalog
  entry and the 40yr standing-seam finish are the manufacturers' terms and are
  correct as written. Do not "tidy" those to match the tiers.
- **Fourteen false `/pro` claims corrected**, from an audit that checked every
  claim against the code with two skeptics per finding. The load-bearing ones:
  *"sign out of all devices"* did nothing (really fixed in #1500), *"we never
  lock you out mid-cycle"* is a hard stop that **only owners are exempt from**,
  the trial's *"no credit card"* collects one via Stripe, and the
  *"one-third the price of JobNimbus/AccuLynx"* line was unsupportable —
  **neither company publishes a price at all**.
- **`/pro` is now inside `check-seo-surface.js`** for the four sitemapped
  pages, and the orphan check honours firebase.json redirects/rewrites.

**Still open from that lane, ranked:**

1. **`close-board.js:195`** — see §0.3. Needs a number, not a guess.
2. **`sitemap-orphan` guards only the 4 skipped-dir pages**, not the 224 URLs
   in the main sitemap. Same defect class, unreported. Extending it changes
   what the walk owns, so it wants its own change.
3. **Only `pro` of the five `SKIP_DIRS` has fixture coverage.** `sites` is the
   live risk — tenant microsites are noindexed on purpose, and the
   `sitemap-noindex` branch would turn that into a CI-blocking ERROR.
4. **Internal team chat** — the one capability the competitor has that we do
   not. Unbuilt, deliberately; a crew this size solves it with a group text.

**Two process traps this lane hit, both cheap to avoid:**

- **A merged PR's "still stale / not touched" line is a duplication magnet.**
  #1481 flagged `ci.yml:241`; a peer lane shipped it as #1482 **eight minutes**
  ahead of the duplicate. Treat such a line as claimed, and run the
  start-of-slice checks even for a one-line fix handed to you directly.
- **Re-check every finding against `main` before re-applying it.** Three copy
  fixes had become *wrong* between audit and application, because #1500 built
  the capability they said did not exist. Shipping them would have put a false
  claim in the opposite direction.

---

## §1 — Turnstile: enforcing it today would 403 six of ten forms

**This is the one thing in this brief that can break production, and the live
brief pointed straight at it.** I verified the repo side of this myself, by
scanning every HTML file under `docs/` rather than trusting a summary.

Ten pages load the lead client `docs/assets/js/public-lead-submit.js`. Only
**four** also load the site-key stub `docs/assets/js/inline/7cd8e505ab.js`:

| ships the site key | does **not** |
|---|---|
| `estimate.html` · `index.html` · `sites/free-guide/index.html` · `storm-alerts.html` | `inspect.html` · `roof-score.html` · `storm-check.html` · `storm-report.html` · `free-roof/index.html` · **`sites/t/index.html`** (the tenant microsite template) |

There is **zero** `cf-turnstile` markup anywhere under `docs/` — the widget is
created entirely from that key. So on the six unkeyed pages the client cannot
mint a token, and it omits the field entirely:

```js
// docs/assets/js/public-lead-submit.js:117
if (turnstileToken) payload.turnstileToken = turnstileToken;
```

Server-side, `functions/integrations/turnstile.js` is what makes this safe
*today* and dangerous *the moment the secret is set*:

```js
:50  return { ok: true,  configured: false };                        // allow when not configured
:53  return { ok: false, configured: true, reason: 'missing-token' }; // once configured
```

Setting `TURNSTILE_SECRET` flips every unkeyed page from line 50 to line 53 —
**100% rejection on those six surfaces, tenant microsites included.**
⚠︎ Agents report 7 of the 13 historical public leads came from `/storm-report`
and `/storm-check`, i.e. from pages in the unkeyed column.

`tests/turnstile-contract.test.js` cannot catch this: it hardcodes the same
four pages the key ships on, so it is green by construction.

**The order of work, which is not what the old brief said:**

1. Ship the site key on the other six surfaces — or hoist it into the shared
   partial so page-by-page drift stops being possible.
2. **Rewrite the contract test to derive its page list from whoever loads
   `public-lead-submit.js`**, not from a hardcoded array. Prove it fails by
   removing the key from one page.
3. Fix the `render()`-instead-of-`reset()` bug in `public-lead-submit.js`
   (:87/:98 — it calls `render()` on the same container each submit, then
   `execute()` on an already-executing invisible widget). It tokenlessly 403s
   the *second* submit even on keyed pages. The 09-08 brief filed this as a
   cosmetic console warning; under enforcement it is a lost lead.
4. Only then reopen the enforcement question.

**And the report itself will not answer anything.** ⚠︎ `submitPublicLead` took
**one** request in thirty days (2026-09-04), and that lead predates the
`turnstileTokenPresent` field, which shipped with #1425 on 09-06. Across all
six public-lead collections there are ⚠︎ **13 documents in total history** —
about two a month, not the "~1 lead/day" §3 assumed. Every risk number derived
from that rate (including "a customer every ten days") is off by 15–30×.

Sunday is therefore a **judgement call, not a measurement**. Either extend the
watch, or convert the task into a standing alert on the first
`turnstileTokenPresent:true`.

> **The separate question nobody has asked:** why did the public forms take
> *one* submission in a month? The drought predates Turnstile by four weeks, so
> the widget did not cause it — but nothing in any brief treats it as a
> problem, and it is a bigger one than anything else here.

---

## §2 — What is live

Rewritten; the 09-08 table cited merge commits that do not mean what they
looked like. ⚠︎ on every row whose evidence is production state.

| Thing | State |
|---|---|
| Instant Roofer, rep-facing | ⚠︎ **LIVE and now exercised for real** — two authenticated measures 09-06 ~20:04 EDT on lead NBD-0187, both 200. One genuine vendor call (14.9 sq, 8/12 pitch) plus one 90-day reuse copy 4m42s later that never touched the vendor (529 ms vs 9.2 s, `billed:false`). Both paths proven. |
| …but **not** proven rep-facing | The caller was the tenant **owner**. `integrationStatus` is admin-only, so an ordinary rep still gets "integration not set up" on the V2 📐 button. See §3.1. |
| Automated web-lead measurement | ⚠︎ **Deployed and bound — never once executed.** 6 trigger firings, every one returned at the `webLead`/`publicLeadKind` guard (`public-measure.js:232`). No lead with `publicLeadKind == 'estimate'` has ever existed. **The test is the first real `/estimate` submission** — watch for a `measurements/weblead-<leadId>` doc. |
| Turnstile site key | **LIVE** on four pages — and that is the problem. §1. |
| `TURNSTILE_SECRET` | **Still the 2026-04-14 `__unset__` stub.** Do not set it. §1. |
| $75 pass-through | ⚠︎ **LIVE** and now visible in real data — both measurement docs carry `passThruEligible:true` / `passThruHasDocument:false`, so the line reads "Aerial roof measurement". Do not merge the two wording strings; `tests/instantroofer-measurement.test.js` pins them. |
| Photo queue — durable, drains on boot, idempotent, honest loss reporting | **LIVE as of deploy 34123964356 (`0cab5372`, 09-07 13:08 UTC).** Ten PRs, #1418 → #1451. |
| Human-report webhook | ⚠︎ Secret exists and is bound; the "43 chars" and the vendor-side config are **unverified since 09-06** and can only be settled in Instant Roofer's dashboard. No human report has been ordered. |

**Cite the run that ran the tree, never the run named after the PR.** The old
table credited the photo queue to `2c32fa59` — that is #1433, a
tenant-filename PR from a different lane, and its deploy predates four later
queue merges. #1451's own deploy run was *cancelled* and its code shipped on
the back of #1452's and #1454's runs.

⚠︎ Nothing merged 2026-09-07 touched the Instant Roofer adapter, the
measurement webhook, Turnstile wiring, or the $75 pass-through. `functions/`
has not been touched since #1434.

---

## §3 — Open, in the order I would take them

1. **Let reps use V2 Auto-measure.** `integrationStatus` is admin/company_admin
   only (`functions/handlers/integrations.js:63`); `integrations-client.js:57`
   short-circuits non-admins to `{configured:{}}`, and `requireConfigured`
   then blocks `estimate-v2-ui.js:1361` with "integration not set up. Contact
   support." The D2D button (`d2d-tracker-core-2026b.js:1298`) is a direct
   callable and works for everyone — so the two entry points have different
   auth behaviour, and only one of them is the one reps are told to use. The
   09-06 measure proved nothing about this: it was the owner.
2. **`generateBlank()` is an ungated sibling of #1447's hydration fix — new,
   found while auditing.** `document-generator.js:976` reads the brand five
   times at `:992-996` via `_resolveCompany()` and only *then* calls
   `this.generate()` at `:998`, so #1447's gate runs too late for those
   fields; `mergeFields`' `...data` spread at `:1044` lets the stale values
   win. Reachable from `dashboard-ui.js:1489`. **Fix it the same way as #1447
   and #1449 — gate at the async boundary, do not make `_resolveCompany()`
   async.** That instinct has been wrong three times running.
3. **Turnstile site-key coverage** — §1, steps 1–3. Ranked below the two above
   only because nothing breaks while the secret stays unset.
4. **Human report CSV → linear feet.** Unchanged: the webhook delivers a file
   URL only, and the AI measure has no ridge/hip/valley/eave/rake. Jo chose to
   wait for the vendor's API V3, which adds them. Watch for the migration doc.
5. **Company-scoped `measurements/` rules.** Read is uid-owner or platform
   admin today, which is *why* the 90-day reuse copies a document instead of
   pointing at one.
6. **Measurement before contact capture.** Needs Turnstile actually enforced
   (§1) plus a CSP `img-src` entry for the roof-outline image — `firebase.json`
   lists no instantroofer host, so the image is blocked today.

---

## §4 — The photo-queue lane (nine PRs, and one item that was already closed)

#1418 → #1437 → #1446 → **#1451**. The 09-08 brief says eight and stops at
#1446; **#1451 appears nowhere in it.**

**#1451 is the sequel worth reading**, because it is the same lesson twice:
#1446 serialised and bounded the marker write to stop a hung `setDoc` wedging
the chain — and that bound **opened a skip one line away.** `_bounded()`
abandons the *wait* at 5 s while Firestore keeps the *write* buffered, so a
mirror recorded on the ack let the next chain link read a pre-write value, drop
itself as "unchanged", and the abandoned write land afterwards — leaving the
server owing photos already uploaded and the rep told to reshoot. Serialising
made it deterministic rather than merely likely. Fixed by recording the mirror
at **issue** time with rollback only if the key still holds our own value
(`photo-queue-recovery.js:276-318`).

Its test lesson is the sharper half: the old regression test could not see it
because its write never landed *at all* (`last === null` skips the guard). **The
dangerous shape was a slow write, not a hung one.**

> **§5 item 9 of the old brief is stale and should not be worked.** It says the
> mirror is set "only after `setDoc` resolves" — #1451 changed that 35 minutes
> before the PR that added the item. The narrow residual that survives: **no
> photo suite makes `setDoc` reject, so the rollback branch is unproven.**
> Item 8 re-verified and still accurate.

**Standing context, so nobody re-opens it:** ⚠︎ Storage orphans were measured
twice and there are none (4 unreferenced objects, all explained, none costing
money). The fact worth carrying instead — **the camera capture path has still
never produced a surviving production photo.** ⚠︎ 0 of 111 photo docs carry
`quality`/`capturedAt`/`thumbStoragePath`, and the count did not move in a day.
The path is wired and reachable from six call sites, so this is "not used yet",
not dead code — but the whole lane is **insurance on a path carrying no
traffic.** That is the honest reason everything below ranks last.

Still open, unchanged in substance: no true background upload (`sw.js:152`
early-returns non-GET; `SYNC_TAG 'nbd-sync-queue'` is registered by nothing —
and reviving it would not do it, since that queue is JSON replay over a
different database); the rep who never reopens with signal; `all()` rebuilding
a Blob per row; and the two non-queueing upload callers (`photo-engine.js:992`
and `:2289`).

**Two corrections to that lane's own notes:**

- **`customer.html` DOES load PhotoEngine** — lazily, via `ScriptLoader`, since
  #1117. The old §5.7 said the opposite. What it never loads is the **queue**:
  `photo-queue-store.js` / `photo-queue-recovery.js` are statically tagged only
  on `dashboard.html` and are in no bundle, so `_store()` returns null there.
  Closing it means adding them to the `photos` bundle *and* giving the
  customer-page upload path an enqueue-first route — **not** adding a static
  tag, which would turn `loadBundle('photos')` into a no-op via the resolved-path
  dedupe.
- **`offline-manager.js`'s queue API is dead; the file is not.** `queueWrite`
  has zero callers, but the file is a self-starting IIFE loaded by
  `customer.html:2218` and `login.html:366`, where it **registers `/pro/sw.js`
  and installs a `controllerchange` force-reload**. "Delete it" is not a safe
  cleanup — it would drop a service-worker registration on the login page.

---

## §5 — The boot-weight / brand-hydration lane — closed

#1419 → #1449, nine PRs, all merged and deployed
([BOOT-WEIGHT-2026-09-06](../audit/BOOT-WEIGHT-2026-09-06.md), and §6 of the
09-08 brief). `customer.html` boot JS 1888.5 → 1340.1 KiB (−29%), 74 → 69
requests; the three duplicate-execution bugs fixed; the multi-tenant `NBD-`
filename leak closed at every site found.

**The one reusable sentence:** *do not make the sync thing async — gate the
async caller once.* The derivation was faithful three times running; the input
was stale. §3.2 above is the fourth instance, already located.

Still open and unchanged: the Leaflet CSS win is first-paint only while
`weather-radar` sits in `DEFAULT_WIDGETS`; `estimate-supplement.js` has no
re-entry sentinel (defence-in-depth only — `ScriptLoader` already dedupes it by
resolved path); the Sentry error-only bundle needs an SRI hash that cannot be
produced offline; and `_tenantFilePrefix()` returns `''` **on purpose** while
`_tenantIdPrefix()` falls back to `'CUS'` — anyone "fixing" the blank one
reintroduces the leak.

One correction to §6's own text: `profit-tracker.js` is an **expenses**-bundle
entry, not estimates.

---

## §6 — Two things landed with no write-up at all

Neither appears in any brief. That is how work silently drops out.

- **#1448 — the Drive → CRM document importer.**
  `scripts/import-drive-docs-to-crm.js` (dry-run by default; `--apply --yes`,
  `--company` required) plus read-only `scripts/audit-document-shape.js`. It
  was run against prod. ⚠︎ Open: verify with
  `node scripts/audit-imported-docs-placement.js --company=<id>`, then resolve
  the three skipped duplicate-lead customers and the 7 `.gdoc`/`.gsheet` stubs
  that need real PDF exports. **Also: its own file header is wrong** —
  `:25-26` claims "unique normalized full-name match" only, while `matchLead()`
  ships four paths (exact, household surname + first name, joiner variants,
  and edit-distance ≤ 2). Loose matches *are* printed before the dry-run exit,
  so nothing is mis-filed today; the risk is an operator trusting the header
  on a `--apply` run for a new tenant.
- **#1450 — estimate PDF renderer + two read-only audits.**
  `scripts/render-estimate-pdf.py` (strips the INTERNAL NOTES block and asserts
  no source line is lost), `audit-duplicate-leads.js`,
  `audit-imported-docs-placement.js`. Nothing deploys. **The renderer has never
  been run end-to-end** — it needs `pip install weasyprint`, and its
  completeness assertion has never fired against a real document.

---

## §7 — Traps worth carrying

- **A `docs(...)` PR is not a doc-only PR here.** `docs/**` is in
  `firebase-deploy.yml`'s `paths:` include list; `documentation/**` is not.
  #1454 was a handoff PR that carried two comment-only edits under `docs/` and
  triggered ⚠︎ a full production deploy — Hosting, rules, indexes and ~180
  function update lines, 17 minutes, for zero behaviour change. It also
  displaced #1453's pending deploy. **Bundle a comment fix with the next code
  push that was going to deploy anyway; never as the payload of a prose PR.**
- **`firebase deploy --only` is all-or-nothing.** One unresolvable name
  invalidates the entire filter, so a parse of firebase-tools' human-facing
  output must never reach `--only` unvalidated. That is what #1452 fixed, and
  it is why one bad name cost every straggler in the batch.
- **Diffing against a moved `origin/main` misreads.** Check
  `git rev-list --left-right --count HEAD...origin/main` *before* describing a
  difference, and test a suspected revert against your **own parent**.
- **Prove a gate can fail against the defect's real shape**, not a strawman —
  and prefer structural matching (strip comments, anchor to `{\s*await`) over
  positional `{0,N}` windows, which pass or fail on comment length.
- **Run every runnable bucket.** `run-test-manifest.js` accepts only `node` and
  `smoke` (`RUNNABLE`, `:51`); `smoke.test.js` is itself one of the 14
  `wired-individually` entries, so it needs its own line:

  ```bash
  node tests/smoke.test.js
  node scripts/run-test-manifest.js --bucket node
  node scripts/run-test-manifest.js --bucket smoke
  ```

  That still leaves most of `wired-individually` and all 4 `emulator` suites
  local-unrun. **A green local sweep is not a green CI.**
- **When two sessions append to the same brief**, re-grep the INDEX summary for
  every `§` reference before merging. #1455 renumbered a heading and left the
  prose pointing at the old one; that is the second doc-numbering slip in two
  days.
- **The removed-lines screen this vault recommends is blind to markdown.** The
  09-08 brief (§5) and its predecessors give this as the check to run before
  every commit:

  ```bash
  for f in $(git diff --cached --name-only); do echo "-$(git diff --cached origin/main -- "$f" | grep -cE '^-[^-]')  $f"; done
  ```

  `^-[^-]` excludes `--` to skip the `--- a/file` header — but a removed
  **markdown list item** also renders as `-- [text](link)` in a diff, so every
  deleted bullet is invisible to it. Writing this brief, it reported **1**
  removed line in `INDEX.md` where there were **2**; the missed one was the
  live-handoff pointer, i.e. the single most consequential line in the file.
  In a repo where most edits are prose, the screen is quietly weakest exactly
  where it is used most. Use `grep -cE '^-([^-]|$)' | ` on code, and for
  markdown read `git diff -U0 <base> -- <file> | grep '^-' | grep -v '^---'`
  and look at the lines rather than counting them.

---

## §8 — Doc chores (batch these; do not spend a CI run on them alone)

- `documentation/INDEX.md:13` sends readers to **§6** for the "Enable required
  Google APIs" correction. It lives in **§7**. §6 is the boot-weight lane.
- `documentation/INDEX.md:132` still ends "the deploy service account cannot
  enable APIs, so that step logs a permission error on every run" — retracted
  by #1453 and false since `43124ba3`. The SA still lacks the role, which is
  deliberate and self-heals if ever granted.
- The 09-08 brief's §6 labels `estimate-v2-ui.js:3511` "pre-#1449"; 3511 is the
  post-merge line.
- `BOOT-WEIGHT-2026-09-06.md`'s last section is dated 09-06 for work that
  merged 09-07 and never spells "#1449", so it is unfindable by PR number.

---

## §9 — The photo-report lane (added 2026-09-08, PR #1483)

Added to THIS brief rather than superseding it. §0–§8 are another lane's work
that I did not re-verify, and §1 carries a Sunday-09-13 production warning —
demoting all of that behind a photo-report brief would bury it. Full write-up:
[SESSION-2026-09-08-photo-report-builder](SESSION-2026-09-08-photo-report-builder.md).

**Ten commits, CI green on `bf299ab2`. Not merged yet.**

### The one finding that reaches beyond this lane

`functions/print/design-system.css` asked for its per-page footer with CSS
Paged Media — `position: running(footer)` + `@page { @bottom-center { content:
element(footer) } }`. **Chromium implements neither**, and an invalid `position`
is discarded silently, so the seal band rendered ONCE in normal flow at the top
of page one and **no PDF this renderer has ever produced carried a page
number** — warranty, estimate, invoice, contract, change order, receipt,
inspection, photo report, all eight. Measured, not reasoned:
`CSS.supports('position','running(footer)')` → `false`.

If you touch `functions/print/`, know that page numbers are reachable **only**
through `page.pdf({displayHeaderFooter, footerTemplate})`, that the footer
template is an isolated document whose default font-size is 0, and that with
`preferCSSPageSize: true` the `margin` option is **ignored entirely** (two
strategies with different margins rendered byte-identical). Do not re-add a
Paged Media margin box; nothing in the pipeline can honour it.

### Also fixed, each its own defect

- `p.urls.lg || p.urls.md` — variant names that have **never existed**
  (`image-pipeline.js` writes `thumb`/`med`/`full`), so every server-rendered
  report pulled full-resolution camera originals, ~20 of them inside a 25s
  `setContent` budget. Six sites, incl. four in `inspection-report-engine.js`.
- `_captionFor` led with `p.caption`, a field **nothing writes**. Reps type into
  `description`; the portal uses `homeownerCaption`. No rep-typed caption had
  ever appeared in a report. `photo-review.js:285` still has a dead `'rep'`
  caption state for the same reason.
- The homeowner report ignored `sharedWithHomeowner`, which
  `functions/portal.js:479` gates the homeowner *portal* on for the reason
  written at `:463`. Now `'auto'` — honoured only when the rep has curated
  something, because a hard gate turns every untouched lead into an empty PDF.
- The adjuster attestation asserted images were "unmodified"; `photo-editor.js`
  bakes markup into the saved file. That was a false statement to a carrier.
- The report queried photos by `leadId + userId` while the gallery uses
  `_photoQueryScopes`, so a **manager on a teammate's lead got "No photos found
  — upload some first"** in front of a full grid.
- **`firestore.rules`**: the 2026-07 manager-edit-rights pass gave same-company
  staff write on `activity`/`tasks`/`notes` and skipped `/documents` and
  `/drawings`, whose READ was already widened. A manager could see every
  document on a teammate's lead and attach none. Fixed with that clause
  verbatim; emulator-tested in both directions.

### Open, in the order I would take them

1. **No share link.** `createReportShareToken` only accepts a `reportId` in the
   top-level `reports` collection; a filed photo report is a `documents` row.
2. **`pdf-renders/` has no Storage rule**, and in download-token mode the URL
   never expires.
3. **Annotations are destructive** — `photo-editor.js` builds arrows, callouts,
   stamps and measurements and persists none of it.
4. **Three incompatible `damageType` vocabularies** collide in one count.
5. **Customer-page uploads write no `createdAt`**, so report order is arbitrary
   for them.
6. **The report number is `Date.now().toString().slice(-6)`** — unsequenced,
   and it changes on every regeneration.

### Trust level on that list

It came from a ten-agent recon that produced **108 unique gaps**, but the
adversarial verification pass **lost 87 of its 226 agents to a session limit**.
Anything above that this session did not fix directly is a **lead, not a
finding** — re-check before acting. Filing unverified leads as refuted is the
2026-09-04 mistake.

### One process trap worth carrying

A break script that silently no-ops makes a test suite look **stronger** than it
is. Two of three breaks here never applied — multi-line `\n` anchors against
CRLF files — and the script still printed "broke 3 things". Assert the match
count and throw on a missing anchor before reading anything into which
assertions reddened.
