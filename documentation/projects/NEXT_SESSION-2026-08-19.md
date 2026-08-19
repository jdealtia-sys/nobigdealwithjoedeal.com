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

## Shipped (continued) — waves 5, 4b, 6

| Commit | What |
|---|---|
| `4c12422b` | **copy + claims.** 4 unsourced stats cut (the GAF "2%" was worse than unsourced — that is GAF's *Master Elite* figure and the page claims GAF *Certified*, a lower tier). The 1–3% home-value claim lived only in JSON-LD with no visible answer, which breaks Google's FAQPage policy too. `login.html` sold an **"Infused" tier that exists in no plan table**; rewritten against pricing.html's real Free/Starter/Team/Growth/Enterprise. `support@`/`pro@` (12 instances, exist nowhere else) → `jd@`. Profanity back inside the documented 1–2 budget. "Text Us" → "Text Joe" ×201. 4 lead forms stopped using NBD's own number as the homeowner placeholder |
| `5342bbe7` | **`/pro` chrome.** `terms.html` wore the full homeowner nav above a contractor footer; `pricing.html` had **no navigation at all** despite being sitemapped. `how-to.html` shipped `visibility:hidden` with a **non-deferred** reveal at line 1300 and no auth gate — an indexable page that renders nothing if that script fails. Canonical added, "NB" → "NBD", favicons un-crossed |
| `52b311d8` | **fonts −594 KB.** 12 byte-identical duplicates. Verified they are *variable* fonts (fvar/gvar/STAT in the woff2 table directory) before collapsing, then proved in-browser that 400/700/900 still render three distinct widths. Caught a preload pointing at a deleted file on the way out. `.qlf-btn` on 154 pages asked for Barlow Condensed, **which no marketing page loads** |
| `23e2290e` | **the gates** — see below |
| `b21e0b99` | last `http-equiv="refresh"` in `docs/` → server 301, using the `/financing` precedent already in `firebase.json` |

## The gate work (`23e2290e`) — read this one

Three guards had failed the same way (list-based selection). All three fixed by
attacking the shape:

- **NEW `scripts/check-chrome-governance.js`**, wired into the zero-install
  `site-integrity` CI job. Walks the tree; `EXEMPT` is a denylist of known-good
  with a reason per entry, so **a new page defaults to failing**. Seeded with 24.
  **Stale exemptions fail too** — and that check immediately rejected three
  entries I had over-seeded, which is the point.
- **`marketing-polish-contract.test.js`** gained a 4th cert-bar assertion keyed
  on the *asset* not a file list (196 pages). `certBarTargets` never matched
  `areas/index.html` or the 7 microsites, which is exactly how 8 pages shipped
  two badges for six days with the suite green.
- **`ensure-nav-css.js`** still carried the stale exclusion list
  `ensure-icon-css.js` was widened out of **one day earlier**, including a dead
  `free-guide` entry, so `docs/sites/**` was never walked.

All three mutation-tested — each fails on the real defect and names the file.

## Still open

1. ~~`nav-tool` stamping~~ and ~~footer logo~~ — **both done**, see
   `a1ed170e` and `1601bc5b`. A **`nav-microsite`** partial for the 7 brand
   microsites is still open; its EXEMPT reasons in
   `check-chrome-governance.js` name it, so landing it will make the gate
   demand those exemptions be deleted.
2. **No footer partial variant covers the slim one-line funnel footer.** The 8
   nav-tool pages now have generator-governed navs but still hand-build that
   footer — that is what their remaining exemptions are for.
3. **17 orphan assets, 1.87 MiB — deliberately NOT deleted.** Most are brand
   *masters* (`gaf-certified-badge.png`, `-800`, the TAMKO logo set) that the
   `-120`/`-320` variants in use were cut from, plus `roofing-3/4.jpg|webp`
   (~950 KB) and 6 project WebP variants. Deleting a master to save bytes
   nobody downloads is a bad trade; `hosting.ignore` is the better lever if the
   goal is deploy size. Jo's call.
4. **`/our-work` ships the same photo as two different jobs** —
   `after-brick-completed.jpg` and `completed-multisection.jpg` are md5-identical
   (`839995285c…`). Fixing it needs a *different* photo of that job, so it is a
   content decision, not a code one. Also note `build-projects.mjs --check`
   already fails at `cfb627bc` (pre-existing, see above) — do not restamp blind.
5. **`dashboard.legacy.html`** still sits beside `dashboard.html`, ~670 diff
   lines apart.
6. **`qc-render-sweep` skips `docs/pro` entirely** (`SKIP_DIRS`, line 63). Now
   that the public funnel has stable chrome, adding the 4 sitemapped pro pages
   + `docs/pro/blog/*` to `PRO_PUBLIC` is cheap coverage.
7. **Deferred for collision:** the footer "pro door" contrast (3.36:1) is in
   `footer-standard.html`, which `nbd-wt-fstd` is rewriting. Rebase first.
8. **Jo's call, untouched:** "The Pledge" is top-level nav on 32 pages and
   absent from 162. Adding it to `nav-standard` changes the primary nav on 159
   pages — a product decision.

## Late additions (same session)

| Commit | What |
|---|---|
| `1601bc5b` | **footer logo on 54 pages.** No footer *variant* used the real mark; 54 pages rendered a bold text wordmark, only 4 hand-rolled the image. Fixed at the source for 41 (footer-blog + footer-extended) and by hand on 13. The homepage block was **not** transplanted — it depends on `.footer-nav-logo`/`.nav-logo` rules none of those pages define, so the injected anchor carries its own inline sizing |
| `a1ed170e` | **`nav-tool` stamped on 5 funnel headers** (`.sc-`/`.sr-`/`.fr-` forks), 44 dead rules removed, and a `--orange-light` CTA hover at **2.68:1** caught inside the lifted CSS block and back-ported to the 3 pages already on nav-tool |

**`inspect.html` was deliberately NOT stamped.** Its CSS carried an on-record
reason — *"Minimal top bar — logo only, no nav (QR funnel: keep them on the
page)"* — and nav-tool would add a Back-to-site link plus a 32-link menu to a
QR capture page. The other five carried no such note. It instead got the defect
it actually had (`position:sticky`, which it was the only funnel header
missing), and its governance exemption now quotes that reason. **If you ever do
want inspect unified, that is a conversion decision, not a consistency one.**

Two contracts had to move with the code, both list-shaped in the same way the
gate work is about:

- `marketing-polish-contract`'s free-roof check pinned the literal
  `<header class="fr-head">`. Its stated intent ("free-roof shipped with no
  chrome at all — lock header + footer") is unchanged, so it now accepts the
  partial or the old class. Mutation-tested.
- `check-chrome-governance`'s EXEMPT reasons for the 8 funnel pages were
  rewritten: their **navs are governed now**, only the slim one-line footer is
  hand-built. The stale-exemption check would not have caught that (they still
  legitimately need an exemption) — the *reason text* going stale is a failure
  mode the gate cannot see, so it needs a human to keep honest.
