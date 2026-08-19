# NEXT SESSION — handoff (written 2026-08-18, session archived 2026-08-19)

> **Filename note.** Written as `NEXT_SESSION-2026-08-18.md` and renamed at
> archive time. That name was already taken by the deploy-pipeline lane on
> three other branches (one merged as #1257) — the exact collision
> [SESSION-2026-08-18-site-qc-and-cost-leak](SESSION-2026-08-18-site-qc-and-cost-leak.md)
> warned about. Worth checking `git log --all --diff-filter=A -- <path>` before
> claiming a dated filename in this repo; parallel lanes reach for the same
> ones.

## ⚡ Session archived — CRM documents lane closed

Five commits on `qc/site-sweep-2026-08-18`, unpushed, no PR. The documents lane
is **done and gated**. What remains needs prod credentials, not more code —
see "FIRST PICKUP" below.

### The through-line: an error state that impersonated an empty one

`loadDocuments`' `catch` rendered the **same "No documents yet"** as a genuinely
empty result. Every failed read looked exactly like a customer who had no
paperwork, so for as long as it existed nobody had a reason to investigate. The
data was fine, the rules were fine, the indexes were fine — the only broken
thing was that the page could not tell you it was broken.

This is the same shape as the previous session's *guards defeated by their own
lists*: **a failure that presents as a pass.** Two sessions running.

> An error path must never render the success path's empty state. Say the load
> failed, and say it where the user is looking.

Two more worth carrying:

- **Name-level checks miss path-level drift.** The first sweep — diffing which
  collections are read against which are written — showed `documents` healthy
  on both sides, because the top-level collection and the
  `leads/{id}/documents` subcollection *share a name*. Only comparing full
  paths including nesting exposed it. If you audit this class of bug, compare
  paths, not collection names.
- **Four surfaces, no shared contract.** Nothing asserted that what the page
  reads is what the writers write, so they drifted apart quietly over time. The
  fix was collapsing to one store; the durable part is
  `tests/customer-documents-store.test.js` asserting every writer targets it.

### Already checked — don't redo it

Every collection the customer page reads was diffed against every writer,
including subcollection nesting. `ai_drafts`, `portal_messages`, `recordings`,
`signatures` and `drawings` all have real writers. `drawings` shares the
top-level-vs-subcollection branch shape that caused this bug, but its read and
write use the identical `isUnlinked` condition and cannot diverge. **Documents
was the only broken one.**

---

Cold-start brief. Previous handoff:
[NEXT_SESSION-2026-08-17](NEXT_SESSION-2026-08-17.md) — its marketing/AEO lane
and the older engineering lanes it inherited (tenant cost book, dead-functions
wire-or-retire, rules-test coverage, admin AI-usage endpoint, advisory-CI flip)
are all still open and unchanged. This handoff adds the CRM lanes from
2026-08-18 on top.

## State: branch `qc/site-sweep-2026-08-18`, five commits, tree clean

| commit | lane |
|---|---|
| `ee6c5418` | lead address integrity + multi-property documents |
| `f07ef579` | customer documents read from stores nothing writes |
| `1e3a84ed` | legacy-documents decision aid |
| `01705320` | this handoff |
| `249581d6` | dedupe documents returned by both stores |

All gates green at the tip: js-syntax (467 files), CSP inline-script check,
site-integrity (210 pages), partials, **40/40 node suites**, smoke **3406
passed**. Each commit is individually self-consistent — the manifest balances
at every one, so CI passes at each commit, not only at the tip. Nothing is
pushed and there is no PR yet.

One **pre-existing** smoke failure, unrelated to either lane and untouched:
`advisory literals are limited to the introduction-runway jobs (3)` in
`tests/smoke/functions.test.js`. Confirmed pre-existing by stashing and
re-running.

## FIRST PICKUP — one prod command, then a decision

**`node scripts/audit-legacy-documents.js`** (read-only, always exits 0, not a
CI gate). Needs the admin-script-runner setup — `GOOGLE_APPLICATION_CREDENTIALS`
+ `NODE_PATH` at a firebase-admin **v12** install; v14 breaks Timestamps. The
2026-08-18 session had no credentials, which is the only reason this is open.

It answers: does the legacy merge read in `customer-documents.js` still earn
its keep? Two outcomes, both cheap:

- **"no live lead-scoped rows"** → delete the legacy read in `fetchAll`, the
  `legacy` flag in `normalize`, and the split path in `deleteCustomerDoc`.
  Drop the top-level `documents` read **from the customer page only** —
  `dashboard-api.js` still needs that collection for the company-wide document
  library.
- **"KEEP"** → leave it as is. Nothing else to do: the double-render this
  used to imply was fixed in `249581d6` (the store dedupes on Storage URL), so
  rows reported as "already migrated" are cosmetic housekeeping at most.

Full context: [CRM-DOCUMENTS-STORE-2026-08-18](../audit/CRM-DOCUMENTS-STORE-2026-08-18.md).

## Jo — in order

1. **Run the audit above**, then act on the verdict (or hand it back).
2. **Address backfill** — `ee6c5418` ships `scripts/backfill-legacy-addresses.js`
   and `scripts/legacy-address-corrections.json` but they have **not been
   applied to prod**. 56 of 81 lead addresses are still defective. Dry-run by
   default; `--apply` needs `--yes`. See
   [CRM-ADDRESS-INTEGRITY-2026-08-18](../audit/CRM-ADDRESS-INTEGRITY-2026-08-18.md).
3. **Push the branch and open a PR** when both lanes are settled.

## The 2026-08-18 CRM lanes, in brief

### Documents — fixed

The customer page had four documents surfaces reading three Firestore stores,
and the one documents actually land in (`leads/{id}/documents`) was read by
exactly one of them — buried under the upload buttons, behind a
`setTimeout(…, 2000)` that lost the race to `window._customerId` on cold loads
and never retried. "Shared Documents" read `lead_documents`, which nothing in
the repo has ever written. "Generated Documents" was DOM-only and emptied on
reload.

Indexes and rules were both fine. It stayed hidden because a failed read
painted the same "No documents yet" as an empty one — the new module refuses to
reproduce that, which is the single most important thing not to regress.

Consolidated into `docs/pro/js/customer-documents.js`: one read, one normalized
shape, one cache, every surface painted from it, called from `loadCustomerData`
with the resolved lead id. Guard:
`tests/customer-documents-store.test.js` (44 assertions, runs the real module
against a fake Firestore and asserts rendered HTML).

### Adjacent panels — swept, all clean

Every collection the customer page reads was diffed against every writer,
**including subcollection nesting** — the check a name-only match would have
missed, since the documents bug had `documents` on both sides. `ai_drafts`,
`portal_messages`, `recordings`, `signatures` and `drawings` all have real
writers. `drawings` was worth a second look (same top-level-vs-subcollection
branch shape) but its read and write use the identical `isUnlinked` condition,
so they cannot diverge. **Documents was the only broken one.**

## Traps worth knowing before you touch this area

- The top-level `documents` collection is **not dead** — `dashboard-api.js`
  writes the company-wide document library there. Those rows carry no `leadId`.
  Do not clean it up wholesale.
- `docs/` **is** the Firebase Hosting root; what is committed is what ships.
- Strict CSP: no inline `<script>`, no `on*=` attributes. Clicks on the
  customer page route through the `data-action` delegate in
  `customer-tasks-ui.js`.
- This checkout is shared with parallel sessions. Commit **explicit file
  lists**, never `git add -A` — this session had to split `customer.html`,
  `ci-manifest.json` and `INDEX.md` by hunk because two lanes were entangled in
  all three.

---

# Lane: design & brand consistency sweep (2026-08-19, later session)

Branch **`qc/design-consistency-2026-08-19`** off `qc/site-sweep-2026-08-18`
@ `cfb627bc`. 6 commits, 83 files, unpushed.

Evidence base: [DESIGN-CONSISTENCY-SWEEP-2026-08-19](../audit/DESIGN-CONSISTENCY-SWEEP-2026-08-19.md)
— 253 pages, 8 dimensions, 141 findings → 83 confirmed after one adversarial
verifier per finding. It carries **the variant reference tables** (every
legitimate header and footer variant, who uses it, why it differs) and the
page-to-variant map. Read that before touching chrome.

## Shipped

| Commit | What |
|---|---|
| `bdc0d52c` | the audit note + INDEX link |
| `d616bd30` | **142 contrast rules.** CTA `:hover` was *lighter* than rest and below AA (4.88:1 → 4.24:1) on every primary CTA incl. the homepage and every funnel entry. 122 rules already used the correct `#A64B00`; 110 never got it. Plus 14 white-on-`#e8720c` controls (3.07:1) and two new CRM tokens |
| `c41031ec` | **cert bar completed.** American Operator badge added to the 8 pages that shipped 2 badges where 187 shipped 3; `data-nbd-certbar` added to 53 unmarked bars (23 via 2 partial sources); 4 trademark-disclaimer variants collapsed to 1 across 199 pages; GAF marks reattributed BMIC LLC on 5 self-contradicting pages; "Locally Owned" + "5-Star Rated" chips dropped (105 chips, 55 files) |
| `0eb2d704` | **`mobile-nav-hub` deleted.** It was a stale fork, one whole group short — 7 destinations unreachable from mobile chrome on the 15 pillar pages. 13 service pages' nav CTA retargeted `/#contact` → `#quote` per the rule at `migrate-nav-to-partial.js:20`. 7 microsite navs unified to one spine. 9 blog pages given the `nav-faq.js` their dead `.dropdown.open` CSS was written for |
| `37df69a4` | **privacy reachability.** 18 marketing pages had no route to `/privacy`, five of them lead-capture pages, four collecting name/address/phone → now 8, all deliberate. `blog/roof-financing-cincinnati-explained.html` (the only blog page with zero markers) adopted into all three partials. 7 bare `tel:` → E.164 **and the generator that stamped them fixed**. `/the-pledge` sticky CTA 680 → 768px + safe-area inset |
| `423bb65f` | **the placeholder logo badge** — `index.html:1574` Acorn Finance Arial text card → the real mark, imported from Drive |

Verification each wave: `check-js-syntax`, `check-site-integrity --quiet`,
`apply-partials --check`, `check-inline-html-scripts`, `check-image-privacy`,
`ensure-nav-css`, `ensure-icon-css`, `marketing-polish-contract` (51/51), and
**`qc-render-sweep` — 216 pages × 2 viewports, clean.**

To run the render sweep locally it needs a server; there is no `http-server` in
`tests/`. A 25-line static server with clean-URL fallback is enough:
`node <server> "$(pwd)/docs" 5002` then
`node scripts/qc-render-sweep.js --base http://localhost:5002`.

## Two corrections to the audit note

- **"146 hand-built cert bars" is wrong.** 138 of those are IN-ARTICLE CTA
  verify-links — a different component that must NOT carry `data-nbd-certbar`.
  The real hand-built footer cert bars number **13**. Distinguishing test: a
  footer cert bar has the badge *image* AND the Independent Contractor
  disclaimer; the CTA link has neither.
- **`/sites/free-guide` must NOT get `nav-faq.js`** even though it greps
  identically to the 9 blog pages that needed it. It has no `.dropdown.open`
  rule and opens on hover; adding the script would `preventDefault` the click
  with nothing to show.

## Not mine — pre-existing, verify before touching

`node scripts/build-projects.mjs --check` **fails at `cfb627bc`**, my branch
point, listing `our-work.html`, 8 services pages and `homeowner-wall.json`.
Confirmed by running it in a throwaway worktree at that commit. This branch's
diff contains zero `OURWORK` markers and touches neither `projects.json` nor
`our-work.html`. Either pre-existing drift on `qc/site-sweep-2026-08-18` or a
parallel session's in-flight state — **do not restamp it blind.**

## Still open (from the 83 confirmed)

1. **Wave 6 gate widening — the highest-value item left.** Nothing requires a
   marketing page to carry chrome markers, which is *why* the same ~29 files
   keep coming back. New `check-chrome-governance.js`: walk `docs/` minus
   `pro|admin|dev|assets`; every page with `<footer` or `class="nav-links"`
   needs an `nbd:partial` marker **or** an `EXEMPT` entry with a reason. Seed
   with today's list so page #23 fails CI. Also: assert the cert bar on the
   *asset* not the marker (`gaf-certified-badge-120.png` ⇒
   `american-operator-badge-120.png` + `data-nbd-certbar`) — ~4 lines that
   would have caught both defects this session fixed.
2. **Bytes:** Montserrat ships 6× under 6 filenames, byte-identical — 12 files,
   594 KB, on 206 pages, and it is already a variable font. `quick-lead-form.css`
   asks for Barlow Condensed, which no marketing page loads. 22 orphan assets
   (~2.99 MiB).
3. **`nav-tool` stamping** on the 5 hand-rolled funnel headers
   (`.fr-`/`.sc-`/`.sr-`/`.topbar`). Not a drop-in — needs the mobile-nav
   partial and its CSS block. Own commit.
4. **Footer logo:** no footer *variant* uses the real `nbd-logo.png`; 56 pages
   show a text wordmark, only 4 hand-roll the image. Fix in the partials.
5. **`/pro`:** `terms.html` wears the full homeowner nav above a contractor
   footer; `pricing.html` has no nav at all and is in `sitemap-pro.xml`;
   `how-to.html` starts `visibility:hidden` with a non-deferred reveal at line
   1300 and no canonical; brand mark reads "NB". `qc-render-sweep` skips
   `docs/pro` entirely.
6. **Copy/claims:** "Text Us" → "Text Joe" (202 pages), two blog bios claiming
   20+/15+ years against the canonical "7+", 4 unsourced statistics, invented
   `support@`/`pro@` aliases, an "Infused" tier `login.html` sells that exists
   in no plan table, 4 lead forms using NBD's own number as the homeowner
   placeholder.
7. **Deferred deliberately:** the footer "pro door" contrast (3.36:1) lives in
   `footer-standard.html`, which `nbd-wt-fstd` is rewriting on
   `feat/footer-standard-careers-partners`. Rebase first.
8. **Jo's call, not mine:** "The Pledge" is a top-level nav item on 32 pages
   and absent from 162. Adding it to `nav-standard` changes the primary nav on
   159 pages — a product decision, left alone.
