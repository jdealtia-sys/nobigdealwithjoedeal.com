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
   — PR #1499 open against this.
2. **`pdf-renders/` has no Storage rule**, and in download-token mode the URL
   never expires. — PR #1504 open against this.
3. **Annotations are destructive** — `photo-editor.js` builds arrows, callouts,
   stamps and measurements and persists none of it. **Still open, no PR.**
4. ~~**Three incompatible `damageType` vocabularies** collide in one count.~~
   **CLOSED — #1503, merged and deployed 2026-09-08.** It was **four**, not
   three: the `customer.html` bulk bar wrote a fourth, kebab-case set, and the
   two Title Case lists disagree with each other. Case was never the break —
   `normKey` already lowercased — so the damage was separator/wording drift,
   which silently downgraded a tier-2 pair into a **mislabeled "Project
   overview"** tier-3 pair. Full write-up:
   [PHOTO-DAMAGETYPE-VOCABULARY-2026-09-08](../audit/PHOTO-DAMAGETYPE-VOCABULARY-2026-09-08.md).
   **One thing carried forward:** `scripts/backfill-photos-damageType.js` is
   written, gated and tested but **has not been run against prod**. It is
   optional — the fix normalises on read as well as on write, so the app is
   already correct — but stored data still holds all four spellings, so a raw
   export or a `where('damageType','==',…)` filter will not agree with the UI.
   Dry-run prints a fold map with counts before writing anything.
5. ~~**Customer-page uploads write no `createdAt`**, so report order is arbitrary
   for them.~~ **CLOSED — #1497, merged.**
6. **The report number is `Date.now().toString().slice(-6)`** — unsequenced,
   and it changes on every regeneration. — PR #1499 open against this.

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

## §10 — The nav / mobile-drawer lane (added 2026-09-08, PRs #1494 + #1506)

Jo reported: *"on my iPod or some phones the slider seems to move without the
page itself sliding, therefore breaking it or making it unnavigable."* That was
a literal description of the mechanism. Full write-up:
[NAV-DRAWER-RELIABILITY-2026-09-08](../audit/NAV-DRAWER-RELIABILITY-2026-09-08.md).

### What was broken

Four defects, live simultaneously on every phone-width page, measured on
Playwright **WebKit at 320x508** (an iPod touch):

1. **No body scroll lock.** The drawer is `position:fixed`; the page behind it
   was not. `scrollBy(0,400)` moved the page 0 → 600 while the drawer held
   still. That IS the reported symptom.
2. **The drawer's `top` was a constant; the header's height is not.** The
   announcement bar is in flow above a `position:sticky` nav, so the header's
   bottom edge moves between **70px and 129px** with scroll. 203 pages hid 40px
   of the drawer behind the header; 17 left a **38px gap leaking page content**;
   2 had no `position` at all (menu opens ~1400px off-screen, only the layout
   twitches). No constant can be right.
3. **`.mobile-cta-strip` shares `z-index:999`** with the drawer and sits later
   in the DOM, so the Call/Text bar painted over *Book Inspection*.
4. Net: **6 of 32 links reachable.** The Services dropdown separately renders
   **993px tall** and was cut off by 311px on a 1366x768 laptop with nothing to
   scroll.

Root cause of the drift: every rule was hand-inlined per page — **233 copies,
6 `.mobile-nav` variants, 46 files with 2-4 competing definitions of the same
selector.**

### What shipped

`docs/assets/css/nbd-nav.css` + `docs/assets/js/nbd-nav.js` are now the single
owner, at **id+class specificity (1,1,0)** so they beat every inlined
`.mobile-nav` (0,1,0) copy without `!important` and without touching 233
`<style>` blocks. The drawer is a **full-viewport sheet** that never references
the header's position, so it cannot misalign with it.

Also closed: optional chaining in four shipped bundles (**nine in the homepage's,
seven inside `submitForm()`** — the contact form had no submit handler on
iOS ≤13.3); the `ScrollToOptions` form Safari <14 ignores (13 sites, one
feature-gated shim); pinch-zoom re-enabled on `pro/sign.html`; Roof Visualizer
added to the desktop nav.

**Verified against production after deploy: 60/60 behavioural checks.**

### Open, in the order I would take them

1. **`/services/*` scrolls sideways 59px at 320px.** `.trust-item{flex:1}` in
   `.trust-bar` — five flex items whose `min-width:auto` refuses to shrink below
   their content (~1140px row on a 320px screen). ~163 pages. The fix is a
   design call (wrap vs. deliberate horizontal scroller), which is why it was
   not bundled into a nav PR. **A session was already started on this on
   2026-09-08** — check for its PR before re-doing it.
2. **`body{overflow-x:clip}` (nbd-mobile.css, 196 pages) is iOS 16+**, so it
   does nothing on the reported device. ⚠️ **The obvious `overflow-x:hidden`
   fallback was measured and REJECTED** — one axis at `hidden` computes the
   other to `auto`, making `<body>` a scroll container, and the sticky header
   scrolled away to **y=-1460** on WebKit. Do not "fix" this the obvious way.
   §6.2 of the audit note has the table.
3. **Visual baselines cover 4 of 286 pages**, one marketing, and every baseline
   is the **closed** drawer. `maxDiffPixelRatio 0.02` on a full-page shot is
   larger than the entire nav band, so no header change can fail that gate.

### The gate that now exists

Before this, **no test in the repo had ever clicked the hamburger**, and
Playwright ran Desktop Chrome only — so the entire iOS-shaped failure class was
unreproducible by any gate. Now:

- `tests/nav-contract.test.js` — 53 static assertions, node bucket
- `tests/e2e/nav-drawer.spec.js` — 6 specs on a new **`mobile-webkit`**
  Playwright project (320x508), wired into the public-e2e CI job
- Break-tested **12/12** on the intended assertion, and the e2e spec re-run
  against the real pre-fix CSS to confirm it catches the original bug

### Traps worth carrying

**A settle time longer than the animation skips the transient.** Two of the
four bugs in this fix were mine, survived **three green local runs**, and were
caught by CI: a reveal animation that lifted the full-viewport sheet 6px off the
bottom edge (`translateY(-6px)`, measured 502 against a 508px viewport), and a
scroll restore that *glided* because `html{scroll-behavior:smooth}` is sitewide
(CI read 410 against a saved 1200). Both are invisible after the 180ms animation
finishes; the local harness settled at 400ms and had **never once observed the
state it was asserting about**. It settles at 60ms now. Treat "passed locally,
failed in CI" as CI finding a real bug until a break-test says otherwise.

**`main` moved four times in one afternoon** and every collision was on the same
line — the `FLOORS` ratchet in `scripts/run-test-manifest.js`, where two branches
each raised it. Resolve by re-measuring the merged tree (`--check` prints the
literal to paste), never by arithmetic. One collision landed both sides on the
**same literal by coincidence**, which looked like agreement and was wrong.

**A PR that conflicts with `main` runs NO workflows** and reports *"no checks
reported"* — not "pending". A poller waiting for checks waits forever; check
`mergeStateStatus` (`CONFLICTING`/`DIRTY`) when checks never appear.

**The shared checkout switched branches mid-merge.** A commit landed on another
session's branch because it was checked out between my `git merge` and my
`git commit`. Read the branch name in every commit's output — it is the only
tripwire that fires. To recover: `git reflog` for the checkout event,
`git ls-remote origin <stray>` and `git worktree list` to confirm nobody else
owns it, then `git branch -f <stray> <the SHA the reflog says they left it at>`
and redo the work on your own branch. Never reset a stray branch carrying
commits you did not author.
---

## §11 — The portal lane (added 2026-09-08, PRs #1491 #1493 #1495 #1502)

Numbered §11 because §10 was already claimed by the nav lane (PR #1511) while
this was being written. Session note:
[SESSION-2026-09-08-portal-preview-and-recon](SESSION-2026-09-08-portal-preview-and-recon.md)
— it carries the full evidence for everything below.

Jo's report was "the preview doesn't load". It never had.

### Shipped, deployed and verified in production

All four code PRs are ancestors of the deploy that succeeded — checked, not
assumed, because the deploy for #1502's own merge was **cancelled** by the
burst-concurrency behaviour and a later run carried it.

- **#1491** — the preview modal. Two independent faults, and either fix alone
  still leaves it broken. `/pro/portal` inherited the global `**` rule's
  `X-Frame-Options: DENY` (only the four AI-TOOLS routes had an override), and
  the block-detector was inverted in **both** directions: written for the
  retired cross-origin Storage URL, it read a healthy same-origin load as
  blocked, and on the refusal it existed to catch it scored the SecurityError
  as success and **hid the overlay over an empty frame**. That second half is
  why the symptom was a blank panel and the modal's own warning never rendered.
  Same PR: rep previews no longer emit the homeowner's `estimate_view` (it was
  pushing the rep a "your customer is reading the estimate" alert about
  *themselves*, then de-duping the genuine open away), and two dead-end error
  states — a truncated link (400) and the `maxUses: 100` replay cap (429) —
  stopped telling the customer to "try again in a moment" when retrying can
  never work.
- **#1493** — Copy / Text Portal Link on the customer page **never recorded the
  share**, so smart-followup kept saying "send portal link" for links already
  sent. Three of four controls in `customer-gallery-share.js`; the third was
  found by enumerating the file, not from the report. Also removed a fallback
  that could still hand out a legacy **unrevocable** Storage `portalUrl`.
- **#1495** — the portal now links to `/pro/estimate-view.html`, a deployed,
  cost-redacted itemized viewer the portal referenced **zero** times. Plus the
  half that makes it worth having: `getEstimateForView` returned an empty scope
  for any estimate whose lines live in `lineItems` rather than `rows`, so a rep
  could export a full scope to PDF and share a link showing none.
- **#1502** — the rating card rendered on `progressKey === 'complete'` while its
  submit gate used a hardcoded list, so a legacy `Closed Won`/`Complete`/`Won`
  stage (or any tenant custom stage with role `won`) rendered the card and then
  answered **409 "You can rate once the job is complete"** on a finished roof.
  One `progressKeyFor(lead)` owns both now. Plus: homeowner photo uploads bake a
  **7-day** signed URL into the doc, so after a week the customer's own photo is
  a broken tile — and the same doc feeds the rep gallery. Re-signed lazily, with
  write-back and an `uploadedAt` fallback so the existing backlog is covered.

Five suites, 173 assertions, 50 break-tests — every one reddening, each checked
for **which** assertion fired.

### Two corrections to the recon that produced this

- **"WON means the deal is won, not the roof is on" does not survive reading the
  set.** `install_complete / final_photos / final_payment /
  deductible_collected / closed` all genuinely mean the roof is on, and every
  one is in `STAGE_TO_PROGRESS` so the role fallback never fires for them. The
  defect was two gates disagreeing, not the role's meaning.
- A post-deploy "still blocked" reading was **my own browser cache**, not a
  failure. Real portal links always carry a unique token, so nobody hits it.

### Still open — LEADS, not findings

The 120-agent recon **lost 40 agents to the session rate limit**, including all
three verify passes for the preview / portal-defects / portal-ux lanes and the
security recon entirely. It returned 27 survivors, 13 unverified and **0
refuted** — and zero refutations is a warning sign, not a clean sweep. The top
cluster was spot-checked by hand; the rest was not. Re-check before acting.

Verified by three refuters each:

- **portal views are never recorded**, so the CRM permanently says "waiting for
  the customer to open it"
- the **warranty certificate names NBD on other tenants' certificates**, and is
  dated a day early off `lead.scheduledDate` — the *scheduled*, not actual, date
- the 30s poll **destroys an in-flight photo upload** — the same shape as the
  signature guard added 09-07, one branch over
- a before/after slider script that fails to load burns a **200ms timer for the
  life of the tab**, re-armed on every repaint
- the homeowner's own upload is announced back to them as *"new photo from your
  rep"*

**Unverified** (every verifier died — treat as leads):

- every portal card is **clipped 39–149px off the right edge of every phone**,
  and the overflow cannot be scrolled to
- the 09-07 `--accent → --nbd-orange-cta` contrast fix was a **no-op, because
  the two tokens are the same colour**
- a revoked link never stops the 30s poll — the `finally` re-arms the timer the
  410/404 branch just cleared
- the photo input is camera-only (`capture="environment"`), so a homeowner
  cannot send a photo they already took
- **every preview click mints a real 30-day / 100-use homeowner credential**, and
  nothing bounds, distinguishes or reaps them
- the preview iframe's sandbox strips capabilities the portal's nested
  BoldSign / Cal.com frames need
- printing the portal for an adjuster yields 6 pages, two of them blank iframe
  boxes; there is no `@media print` rule

### Growth — all four opportunity lanes converged

Three of the top five are **mounting code that already exists**:

1. ~~link the estimate card to the itemized scope~~ — **done, #1495**
2. **ship `lead.scheduledDate` to the portal** (S) — CI-required to reach Crew
   Scheduled, and the portal never sees it. "Crew arrives Tuesday, September 16"
   instead of a bar. The next cheap win.
3. documents shelf — contract, completion cert, warranty, permits (L)
4. balance due / pay (M)
5. **`/share/<token>`** (S) — `shareSSR` is deployed with **zero producers**, so
   texted links unfurl as bare URLs that read like spam

### Traps this lane paid for

- **A preview channel cannot verify the portal's data path.**
  `getHomeownerPortalView` allowlists the **production origin only**; a channel
  origin gets a 204 preflight with no `access-control-allow-origin`. Framing,
  headers and static rendering *can* be proved there — anything
  portal-data-related cannot. Drive the module from a production-origin page
  instead (load the script, stub the minter, call the real function).
- **`gh pr checks` and the gate GitHub enforces disagree.** After a force-push
  it reported 21 pass while `statusCheckRollup` showed 20 unconcluded and
  `mergeStateStatus: BLOCKED`. Poll the rollup. `BLOCKED` usually means "not
  concluded yet" and clears itself; `DIRTY` means a real conflict.
- **The deploy does not wait for CI**, and burst-cancels middle runs. Verify the
  last *successful* deploy's SHA is a descendant of your merge.
- **Manifest floors collided five times in one afternoon.** The fifth time both
  sides carried the *same* literal, so only the comments conflicted — and the
  merged tree still measured one higher. A matching number is not evidence;
  re-measure the merged tree.
- **An absence assertion matched its own explanatory comment three times**, once
  per new suite. Slice the region out of raw source first, then strip comments
  from the slice; a whole-file percentage guard is useless here
  (`functions/portal.js` is 43% comment lines).
- **A crashed suite is not a vacuous guard.** A break-test deleted 1,683 chars
  instead of two lines; the harness saw no `✗` and reported the guard did
  nothing. Assert the summary line before interpreting a failure count.
- `sed -i` flips EOLs **on a single named file**, not just across a glob.

### Deliberately not done

- the other six portal endpoints still have no error `code`
- rep-initiated `estimate_view` still writes a server-side activity record; a
  client `?preview=1` tag cannot suppress that, and pretending otherwise would
  be worse than the gap
- `/pro/ai-tree` still ships an enforced `frame-ancestors 'self'` beside a
  Report-Only `'none'` — they contradict on every dashboard embed

### One housekeeping item that will waste someone's time

`tests/_tmp-lanef-probe.test.js` is sitting **untracked** in the main checkout
(10:04 today, from another lane). CI never sees it, but it fails the manifest
completeness tripwire **locally** for everyone —
`run-test-manifest.js --check` reports `test file(s) not classified`. Left in
place rather than deleted, because deleting an untracked file is unrecoverable
and it is not this lane's to remove.

## §12 — The server-PDF lane (added 2026-09-08, PR #1505)

Every server-rendered document — warranty, estimate, invoice, contract, change
order, receipt, inspection, photo report — had been failing **100% of the time**
at `stage: launch` since **2026-06-24**. About eleven weeks. Full write-up:
[RENDERPDF-CHROMIUM-INTEROP-2026-09-08](../audit/RENDERPDF-CHROMIUM-INTEROP-2026-09-08.md).

### What was broken

`@sparticuz/chromium` **149 dropped its CommonJS build**. Its package.json is
`"type":"module"` with a single `"default"` export condition, so `require()` on
the nodejs22 runtime takes the `require(esm)` path and returns the ES module
**namespace** — `{ __esModule, default, inflate, setupLambdaEnvironment }` — not
the module. The API is a class on `.default`, so `chromium.executablePath` read
`undefined` and `await undefined()` threw.

**148 had no `.default` at all** (dual CJS/ESM, with a `"require"` condition), so
the version bump alone broke it with **no code change**. Verified by installing
both versions and comparing their `exports`, not by reasoning about interop.

`chromium.args` was `undefined` too — the error surfaced on `executablePath`
only because that one is *called*. A fix touching just the thrower would have
launched Chromium with **none of its 22 flags**, `--no-sandbox` and
`--single-process` included, and failed one line later.

### Why it survived eleven weeks

**The client fallback hid it.** `docs/pro/` catches the `HttpsError` and falls
back to `html2canvas`, so customers kept receiving *a* document and nothing ever
looked broken from outside. This is the finding that reaches past this lane: when
auditing a server path, **ask what the client does when it fails** — a graceful
fallback is exactly where a total outage hides.

### The bigger finding: no alert policy is deployed

`monitoring/alert-functions-error-rate.json` *does* name `renderpdf`, so on paper
this was covered. Two independent reasons it was never going to fire:

```bash
gcloud alpha monitoring policies list --project=nobigdeal-pro --format=json
# []
```

**Ten policy definitions in `monitoring/`; zero exist in the project.** Positive-
controlled — `channels list` returns the two channels those same files reference,
so the empty array is real, not a format quirk or a credentials problem.
Everything the repo believes it watches is unwatched: backup-cron-stale,
claude-budget-exceeded, email-queue-worker-stale, function-latency,
functions-error-rate, migrations-tick-stale, rate-limit-spike,
tenant-microsite-errors, validateAccessCode-bruteforce, voice-processing-failures.

And **even deployed it could not have caught this**: the condition is `>50` errors
over a `300s` `ALIGN_RATE` window — a *spike* detector — against **22 failures in
three weeks**. The threshold alone is double the outage's entire failure volume.

### What shipped

- `resolveChromium()` probes for the API rather than unwrapping `.default`
  unconditionally, so it survives the package flipping back to CJS. An
  unrecognised shape throws a message naming the package and the keys it saw.
- `metrics/renderPdf` records both outcomes; the health digest reports it **in
  the subject line**, keyed on `failRecent && !okRecent` — a **missing success**,
  not a failure count. At 22 calls in three weeks, any volume threshold sleeps
  through a total outage. Reuse that shape for other low-volume paths.
- Two zero-dep suites that vm-sandbox the real functions, because a source regex
  for `.default` matches the broken code just as happily.

### Open, in the order I would take them

1. **Confirm a `[renderPdf] ok` line in production.** Chromium ships a Linux x64
   binary and cannot be launched off Linux, so *nothing in this repo proves the
   browser actually boots in the deployed function*. This path has never once
   succeeded on 149, so a second failure further down the launch sequence is
   possible. Render any document and check. **This is the one item that decides
   whether the lane actually worked.**
2. **Deploy the ten alert policies**, then re-run the `list` above to confirm they
   exist. Deliberately not done in #1505 — a prod change, and Jo's call. Worth
   doing, but it would not by itself have caught this outage.
3. **Consider whether other paths have the same shape**: a server failure behind
   a client fallback, on low enough volume that a spike threshold cannot see it.

### Traps worth carrying

- **A dependency bump can break a call site with no code change.** Check interop
  empirically — install both versions and diff their `exports` — never reason
  about it. On a Node without `require(esm)` this would have been a loud
  `ERR_REQUIRE_ESM`; because the runtime *supports* it, the failure degraded into
  a property read returning `undefined`, which is why it read as a code bug.
- **After an interop fix, check every sibling read off the same object.**
  `args` was broken identically and silently.
- **The `FLOORS` line in `run-test-manifest.js` collided twice in this one lane**
  (the sixth and seventh times on 2026-09-08). Both resolved by **measuring the
  merged tree**, never arithmetic — and one of those merges silently produced a
  **duplicate INDEX row**, caught only by scanning for duplicated links rather
  than trusting a clean auto-merge. If this line keeps costing sessions, how the
  ratchet is stored may be worth revisiting.
- **The brief that opened this lane cited
  `documentation/audit/PDF-RENDER-RETENTION-2026-09-08.md`** as recording the
  finding in full. That file **does not exist** — not in any worktree, not on
  `main`, not anywhere in history. A precise-sounding task prompt can name a
  document that was never written.
## §13 — The pdf-renders lane (added 2026-09-08, PR #1504)

**Numbering note:** this was written as §12 and renumbered on rebase — #1516
took §12 (the server-PDF lane) by merging first, exactly as predicted when this
section was drafted. #1508 also edits this file and is still open, so a further
renumber is possible. Nothing else here depends on the number.

Closes open item 2 of [SESSION-2026-09-08-photo-report-builder](SESSION-2026-09-08-photo-report-builder.md)
and §9's open item 2. Full write-up:
[PDF-RENDER-RETENTION-2026-09-08](../audit/PDF-RENDER-RETENTION-2026-09-08.md).

`pdf-renders/{uid}/` held every server-rendered customer document — invoice,
contract, change order, warranty, inspection, photo report — with **no
`storage.rules` block and no reaper**, so it only ever grew and its posture was
stated nowhere. It was also not private: `render-pdf.js` stamped a
`firebaseStorageDownloadTokens` value at **upload**, unconditionally, on the
happy path as much as the signing-failure path it was added for. **19 of 21 prod
objects carried one**, and an unauthenticated HEAD on a customer roofing
contract returned `200 OK, application/pdf` — the same URL with the token
stripped returned `403`, which is the control that proves the token is what
granted access.

**The brief's premise was half wrong, and it mattered.** The IAM signBlob gap it
blamed is **closed** — `717435841570-compute@` holds
`roles/iam.serviceAccountTokenCreator`, so signing is the live path and the
fallback should never fire. `urlMode` recorded which URL was *returned*; it
never described which objects were *reachable*. The token is now minted lazily
inside the signing-failure handler, so only genuinely unsignable renders carry
one and `urlMode` becomes a true record.

Shipped: the explicit rules block (owner/admin read, `write: if false` — which
also denies delete, so a rep cannot overwrite a rendered invoice), a 30-day
reaper (`functions/pdf-render-retention.js`), the lazy token, `cacheControl`
`public` → `private`, and `pdf-renders` added to `STORAGE_PREFIXES`.

### Before you merge

- **#1508 adds `pdf-renders` to `STORAGE_PREFIXES` as well** — its own note says
  so. **Second one in drops the duplicate line.** #1508 also replaces the
  hand-maintained smoke assertion this branch edited with a derived gate
  (`scripts/check-storage-prefix-registry.js`); if #1508 lands first, this
  branch's edit to that assertion in `tests/smoke/auth.test.js` is superseded
  and should go.
- **One-way door.** The reaper's first run after deploy deletes **all 21
  current objects** — the newest is ~11 weeks old. That IS the remediation,
  since deleting is a download token's only revocation. But if any of those
  links are live in a customer's inbox, they break.

### Why a reaper and not a bucket lifecycle rule

A `matchesPrefix` lifecycle rule does the same deletion for free and was the
first choice. Rejected because lifecycle config is **bucket state, not repo
state** — nothing in the tree would record it and a console edit could silently
disable it, which is exactly how `firestore-backup.js`'s "one-time operator
setup" never got run and all three backup functions failed nightly from the day
they shipped. And a lifecycle rule cannot log the zero run that distinguishes
"nothing old" from "job is dead".

### Carry this: a survey that can only return "clean" is not evidence

The first token survey reported **0 of 21 tokened** — twice, confidently, and
wrongly. Two independent causes, either alone sufficient:

- `gcloud storage objects describe --format="value(metadata)"` returns **empty**
  for custom metadata. So does `--format="value(custom_fields)"`, even though
  `custom_fields:` is the key the unformatted output prints. Grep the raw
  description; never trust a `--format` key you have not watched produce a
  non-empty value.
- A path list built with `gcloud storage ls > file` on Windows carries `\r`.
  Fed to `while read -r`, every `describe` fails, `2>/dev/null` hides it, and
  all N objects report "no token" **uniformly**. `tr -d '\r'` took it 0 → 19.

What caught both was a **positive control** — dumping one object's full
description showed a token the survey had just called absent. Uniform negatives
across every object are the tell.

### Still open

- **`homeowner-uploads/` has no rules block** and `esign/` has no reaper — both
  from #1508's sweep, neither this lane's to close.
- Nothing diffs the live bucket's actual prefixes against `storage.rules`, so a
  prefix that exists only as an admin-SDK write is still discoverable only by
  reading code.
