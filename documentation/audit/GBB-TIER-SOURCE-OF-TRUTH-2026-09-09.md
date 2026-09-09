# GBB Tier Source-of-Truth Audit — 2026-09-09

Jo: *"we need to do some serious thinkin and recon on the current GBB setup based
on our proposals and estimates written up so far as well as the current state of
the site and all marketing AND the CRM. i feel were starting to drift from one
source of truth across different surfaces"* — plus, mid-session: *"on the site we
market it as standard preferred and elite."*

**Method:** a 31-agent workflow — 7 parallel readers, one per surface (pricing
engine, warranty/guarantee code, public marketing site, product catalog,
real-proposal pipeline, the June 2026 QA trail, rep-facing training) — each told
to read current files first-hand and cite file:line, not summarize. They
surfaced **47 distinct drift candidates**. The 12 highest-severity were then run
through adversarial verification (2 independent skeptics per candidate,
instructed to default to refuting): **21 of 24 verdicts confirmed the drift as
real and current; 3 refuted one candidate as a legitimate documented design, not
drift.** The other 35 were not individually re-verified but in most cases the
same file:line fact was independently surfaced by 2–3 of the 7 map agents
without prompting each other, which is its own form of corroboration. 3.69M
subagent tokens, 739 tool calls, ~21 minutes.

## The headline finding

**There is no single "GBB" system to have drifted from — there are at least
four independently-coded pricing-tier name sets and at least eight
independently-coded warranty-duration/guarantee schemes, live simultaneously,
none of which reference each other in code.** Asking "is it Good/Better/Best or
Standard/Preferred/Elite" doesn't have one answer; different code paths a
customer or rep can hit on the same day give different answers, and in three
places a *single generated document* contradicts itself.

The good news, confirmed by this audit: the one previously-known "one document,
two prices" bug (June 2026, headline total vs. tier-card total) **is fully
fixed today** — see §6. The bad news is everything below it.

---

## §1 — Naming: at least four vocabularies for the same three tiers

| Vocabulary | Where it lives | Reachable by a customer? |
|---|---|---|
| **Good / Better / Best** | `estimate-config.js` (canonical rates), Close Board deal room (`close-board.js` — the actual link sent to homeowners: `☆ Good`/`★★ Better`/`★★★ Best`), V2 "homeowner presentation mode" (`estimate-v2-ui.js:2236`, explicitly commented "homeowner-clean"), the V2 customer PDF (`estimate-v2-ui.js:2827`, literal string `"Good / Better / Best comparison"`), rep training (`how-to.html`), rep sales scripts (`decision-engine.js`) | **Yes** — this is the name on the actual signed deal-room page and the V2 PDF |
| **Standard / Preferred / Elite** | The public marketing site's real branded system (`the-nbd-guarantee`, `the-nbd-build`, homepage) — full FAQ, comparison table, per-tier CTAs; **also** the separate "NBD Guarantee" warranty certificate (`warranty-cert.js`); **also** `dashboard-ui.js`'s printed contract/warranty/completion certificates | **Yes** — on the marketing site AND on some rep-printed paperwork, but never in the same file as Good/Better/Best |
| **Standard Reroof / Reroof Plus / Full Redeck** | The classic 4-step wizard (`estimates.js`) — a **third**, independent name, coexisting on the *same printed customer PDF* as `"Good — Standard Reroof"` line-item text | **Yes** |
| **3-Tab (Good) / Architectural (Better) / Designer (Best)** | The public, no-login Instant Estimate tool (`docs/estimate.html`) and the AI prompt that generates its actual dollar quote (`docs/assets/js/inline/4053149b2f.js`) | **Yes** — this is customer-facing marketing-site copy, not internal-only as first assumed |

**Verified (repo-wide grep, corroborated independently by 2+ map agents): no
code anywhere maps `good→standard`, `better→preferred`, `best→elite`, or vice
versa.** The only place the correspondence is even *stated* is one line of
rep-coaching prose: `decision-engine.js:689` — *"Never say 'cheap' — say 'Good
tier' or 'Standard tier'"* — informal evidence of intent, enforced nowhere.

**Adversarial split worth flagging honestly:** for the marketing-site pair
(estimate tool's 3-Tab/Architectural/Designer vs. the Guarantee page's GAF
Timberline NS/HDZ/UHDZ), one verifier called this real, unreconciled drift
(the estimate tool literally quotes a "3-Tab" price while NBD's own
`gaf-timberline` product page says Timberline NS — the Guarantee page's own
cheapest tier — is explicitly **"not 3-tab"**); the other verifier found the
two pages *do* cross-link (`the-nbd-guarantee:647` → "Try the Instant
Estimate") and read it as an intentional top-of-funnel-ballpark vs.
bottom-of-funnel-branded split. **Both agree the pages never state the mapping
in words.** That disagreement doesn't extend to the CRM-internal documents
(deal room, contracts, certificates) — those have no "it's just a ballpark"
excuse, and independently use two more uncoordinated names.

---

## §2 — Price math: marketing states +15%/+30%, the pricing engine computes +9%/+21% (CONFIRMED, both verifiers)

- `the-nbd-guarantee/index.html` states, **six separate times** (JSON-LD FAQ
  schema, two tier-card price lines, two comparison-table cells, FAQ prose):
  *"Preferred is roughly 15% over Standard, Elite is roughly 30% over
  Standard."* `the-nbd-build/index.html:435` repeats +15%.
- The actual rates (`estimate-config.js` `TIER_RATES`: good $545, better $595,
  best $660 — the same numbers the public estimate tool's own pricing table is
  built from, per its own comment) compute to **+9.17% and +21.10%** — not
  15%/30%. The public estimate tool's asphalt price ranges independently land
  on the same ~+9.3%/+21.3%.
- **This was never correct, not a value that later drifted.** Git-blame:
  `TIER_RATES` was locked 2026-04-10 (`1b0c58ed`); the "+15% over Standard"
  marketing copy was written **11 days later**, 2026-04-21 (`78a319fa`). The
  mismatch has been live for ~5 months.
- No hidden per-tier accessory surcharge explains the gap — `calculatePerSq`'s
  add-ons (permit, dump fee, delivery, pitch/story/access complexity) are flat
  or tier-agnostic, so a real job total would show an even *smaller* gap than
  the raw rate ratio, not a larger one.
- The Guarantee page itself invites the reader to cross-check via *"Try the
  Instant Estimate"* — right next to the comparison table stating the wrong
  percentage.

---

## §3 — Warranty duration: at least eight independently-coded schemes

This is the deepest and highest-stakes mess, because it reaches signed
contracts and certificates a homeowner keeps. A same-day 2026-09-08 fix
(`a3ac83b1`, PR #1501) was supposed to unify workmanship-warranty duration to
**Good=5 / Better=10 / Best=20 years "in sixteen places."** Verified: it landed
correctly in two places and **did not reach at least six more**, several of
which are on documents it directly touched.

| # | Scheme | Where | Status |
|---|---|---|---|
| 1 | **5 / 10 / 20 yr**, per-tier | `doc-preflight.js` `WARRANTY_TIER_OPTIONS` + `renderWarrantyTier()` — the rep-facing dropdown wired into both the "proposal" and "contract" document schemas | The claimed-canonical scheme |
| 2 | **5 / 10 / 20 yr**, per-tier | `document-generator.js` `WARRANTY_TIERS`, feeds `renderWarrantyBadge()` on both the Proposal and Contract PDFs | Matches #1 — but its own `best` entry is self-contradictory: labeled `"20-Year"` two lines above `"Premium protection... for the life of the structure"` (unbounded) in the *same object* |
| 3 | **5 / 10 / 20 yr with real expiry dates** (`'20 years from ' + issueDate`) | `document-generator-templates.js` `DG.renderWarrantyCertificate` — the actual "warranty_certificate" doc type reps generate | Prints an **"Expiration Date: 20 years from issue date"** field on the SAME certificate whose body text tells the homeowner Best is guaranteed *"for as long as you own your home"* (never expires) |
| 4 | **10 / 15 yr / Lifetime** | `estimate-v2-ui.js:2884-2888` — the actual server-PDF proposal's tier-comparison feature bullets (`buildTier()`) | A completely different number set than #1/#2, on the document a customer is most likely to actually see and sign from |
| 5 | **Only Best gets a duration** (20yr); Good/Better get none on their tier card, then a **flat "10-year"** applies to every tier two dozen lines below on the *same* document | `estimate-finalization.js:769-772` (tier cards) vs. `:844` (Warranty section) — the live retail-quote/single-quote PDF | Confirmed via `git show a3ac83b1`: the Sept-8 fix touched **only** line 772 (Best's sub-label), never line 844 |
| 6 | **Flat "25-year limited lifetime"**, every tier, one badge above all three tier cards | `close-board.js:195` — the actual Close Board deal-room link sent to homeowners | **Still unresolved** — the *same* Sept-8 commit's own message flagged this verbatim as "needs a decision, not a guess," and it is unchanged today |
| 7 | **Flat 5 years, hardcoded**, no reference to the estimate's tier anywhere in the function | `customer-bootstrap.module.js:3155` — the 🛡️ "Generate Warranty Certificate" button on the customer detail page, **the one certificate generator confirmed genuinely reachable and wired in the UI today** | A homeowner who bought Best could receive a certificate claiming only 5 years |
| 8 | **All-lifetime**, differentiated only by transferability + annual inspection (Standard/Preferred/Elite) | `warranty-cert.js` (`WC_TIER_DESCS`) — the "NBD Guarantee" certificate | Not touched by the Sept-8 fix; appears to have **no live UI entry point today** (its only caller is gated on a `sessionStorage` key nothing currently sets — flagged medium-confidence, absence-based) |
| — | **Self-contradicting even alone**: `dashboard-ui.js`'s "contract" template says Preferred is *Lifetime + 48hr callback*; its "warranty" template 26 lines later says Preferred is a *10-Year Labor Guarantee*; that same warranty template's own next paragraph then says the guarantee is *"for the lifetime of the installation"* with no carve-out — three different answers inside two files, one of them internally inconsistent with itself | `dashboard-ui.js:1263, 1290, 1293` | Also: the "Certificate of Completion" template ignores tier entirely, asserts a flat `"NBD NBD Lifetime Pledge"` (duplicated-word typo included), for every job regardless of tier — `dashboard-ui.js:1380` |

**Rep training doesn't match any of them.** `how-to.html:1005` tells reps the
Warranty Certificate is *"Tier-specific, matching the terms the generator
prints (Good = 5-year, Better = 10-year, Best = 20-year)"* — but the document
literally titled "NBD Warranty Certificate" that a rep actually opens
(`dashboard-ui.js` `DOC_TEMPLATES.warranty`) prints Standard/Preferred/Elite
and Lifetime/10-Year/Lifetime. A rep following the training doc would expect a
document that does not match what prints.

**Public site is clean on this one axis, for what it's worth:** every
digit-year workmanship-warranty figure anywhere in the repo lives under
`docs/pro/**`. No public marketing page states a workmanship-warranty duration
at all — the public framing is entirely the lifetime-Pledge +
transferability/annual-outreach model, consistent with scheme #8. Reported as
a grounded absence, not proof there's no risk if #1–7 ever gets copy-pasted
onto a public page.

---

## §4 — Material/product: tier is enforced in exactly one code path, and it may not be reachable (CONFIRMED, both verifiers)

Across the two engines a rep actually uses to price a real roof, **the
material is never constrained by the estimate's chosen tier**:

- **Classic engine**: `product-library.js`'s `PRODUCT_MAP` hardcodes a single
  shingle SKU (`shingle_001`, GAF Timberline HDZ) for **every** tier;
  `syncRatesFromProductLibrary(tier)` only changes which of that one product's
  own price sub-keys it reads. The catalog holds 16 other shingle products
  (3-Tab, HD, TAMKO HailGuard, etc.) that this path never touches, at any
  tier.
- **V2 job-template engine**: `estimate-logic-engine.js:847-855` carries an
  explicit code comment admitting the line's `tier` field is
  *"PRESENTATION ONLY — the engine never reads it back and no math above
  branches on it."* A rep can `addToScope()` any of 250+ catalog codes onto a
  "Best" estimate with zero tier gating.
- **The one catalog that DOES enforce a real swap** — `estimate-builder-v2.js`
  `TIER_MATERIAL_MAP` (good/better/best → distinct, but generic/unbranded,
  catalog lines; "best" = `"Impact-Rated Shingles Class 4 · 50yr"`) — only
  fires via `generateLineItemsFromMeasurements → calculateLineItem`, a path
  the live line-item UI (`estimate-v2-ui.js`) never calls; it calls
  `EstimateLogic.resolveEstimate` directly. **The one enforcing mechanism in
  the codebase may be structurally unreachable from the actual rep workflow** —
  flagged high-confidence from tracing the call graph, but this specific claim
  wants a live click-test to fully close, not more code reading.

**Net effect: a rep can currently sell "Best" ($660/SQ) and deliver
materially a 3-Tab or base-architectural roof, with no warning anywhere in
code.**

Additional catalog findings (not individually re-verified, but internally
well-cited):
- `estimate-catalog-xactimate.js` tags Class-4 impact shingles **and** six
  purely-aesthetic luxury/Designer lines (no impact rating, no distinct
  warranty) both `tier:'best'`. One adversarial pass **refuted** calling this
  undocumented drift: the actual shipped "Best Tier" job template
  (`jt_fr_asphalt_best`) explicitly documents both meanings in its own scope
  notes ("impact-rated *or* designer shingles... designer swaps available in
  brand options") and the impact/designer catalog rows do carry a genuine
  distinguishing field (`insuranceDefault`/`ul` rating) even though they share
  the English word "best." Legitimate design, not drift.
- The shipped TAMKO tier tags are one rung off the 2026-07-15 rebrand
  BUILD-BRIEF's own "locked model" (Heritage tagged `good` instead of `value`;
  StormFighter Flex **and** HailGuard both tagged `best`, collapsing a rung the
  brief kept distinct).
- The GAF SKUs both rebrand docs build their good/best rungs on — "Timberline
  NS" and "Timberline UHDZ" — **don't exist** in `product-data.js`'s actual
  product catalog (only HD and HDZ exist there; a "Timberline UHD" exists only
  in the xactimate catalog, tagged `better` not `best`).
- TAMKO sell pricing in both catalogs still carries an explicit 2026-06-24
  "PLACEHOLDER — mirrored from GAF, edit when real TAMKO pricing is set"
  comment, with no later confirming comment found — open question whether this
  was ever revisited after TAMKO certification went live in July.

---

## §5 — Real customer documents bypass all of this anyway

- The seven actual September 2026 client PDFs (Hildeman, Eppert, Gilkey, etc.)
  were rendered from **hand-typed Google Docs** by a generic renderer
  (`scripts/render-estimate-pdf.py`) with **zero tier vocabulary of any kind**
  — whatever a rep typed that day (e.g. `"OPTION 1 — PREMIUM MICROMESH"`) is
  what the customer saw, independent of both Good/Better/Best and
  Standard/Preferred/Elite.
- **Ruling one thing out explicitly, since it was the prompt for this audit:**
  the Becca Hildeman $1,616 undercharge (`SESSION-2026-09-07-client-pdfs-and-drive-tidy.md`)
  was a **document-versioning bug** — the renderer was pointed at a stale
  Sep-2 Google Doc superseded by a Sep-3 reprice — not a tier-naming or
  tier-math mismatch. Don't let it get folded into the naming mess above; it's
  a different failure mode already understood and already has a stated rule
  going forward ("the doc id being newest in a folder does not mean it carries
  the newest numbers").
- The $642 "advanced" record in the June QA summary is an explicitly-labeled
  internal test row, not evidence of real customer confusion.

---

## §6 — What's actually fine (don't re-litigate)

The June 2026 QA campaign's headline bug — one V2 retail-quote document
showing a **$17,000 headline total** next to **$22,825–$27,475 tier cards**,
"one document, two irreconcilable prices" — **is fully fixed today**,
end-to-end, confirmed independently by this audit's own code read (not just
trusting the June remediation doc):

- `getCurrentEstimate()` (`estimate-v2-ui.js:1991-2032`) overwrites
  `estimate.total`/`subtotal`/`tax`/`deposit`/`prices` from the **selected
  tier's per-SQ total**, keeping the old line-item sum as a separate
  `internalLineItemTotal` that's never shown to the customer.
- The save payload persists `grandTotal = estimate.total` plus `prices{}` and
  `selectedTier` (`:3128-3133`).
- `doc-preflight.js`'s line-item editor (`:2082`) refuses to overwrite
  `grandTotal` once a per-SQ total is locked.
- `invoice-pipeline.js` (`:443`) honors the saved `grandTotal`/deposit instead
  of recomputing from rows.
- The "Selected" badge (`estimate-finalization.js:783`) is now keyed by tier
  (`meta.tiers.recommended = state.tier`), not float-equality — the original
  bug's actual root cause.

This is exactly the June `CANONICAL-TOTAL-DESIGN.md`'s recommended Option A,
implemented line-for-line. Good template to reuse for §3/§7 below: put the
canonical value in one config object, thread every consumer through it,
persist the selected key not a derived float.

Also confirmed still-correct and not worth re-checking: `TIER_RATES`
($545/$595/$660) is byte-identical everywhere it's defined; the June
pitch-waste and permit-fail-safe fixes are live in code (`DEFAULT_PERMIT_COST`,
C-1 comment at `estimate-builder-v2.js:883`); the IAM `serviceAccountTokenCreator`
grant referenced in June's `IAM-RUNBOOK.md` is confirmed landed per a
2026-09-08 comment in `functions/render-pdf.js` (the runbook itself was never
updated to say so — a small stale-doc fix, logged in the appendix, not a live
risk).

**Two June/July docs are now stale enough to actively mislead**, flagged here
per the vault's own "correct stale docs in place" rule rather than fixed in
this pass (they're documentation-only, not code):
- `estimate-remediation-2026-06-09/LAUNCH-BLOCKERS.md` frames its blockers
  around a pricing model (Free/Solo $99/Crew $299+$39-seat) and a gating PR
  (#579) that **no longer exist** — PR #579 is closed unmerged, and
  `docs/pro/pricing.html` today ships Free/Starter $99/Team $149/Growth
  $299/Enterprise with no per-seat billing UI at all.
- `estimate-qa-2026-06-08/RATE-SHEET.md` cites `estimate-config.js`'s
  `_version` as `2026-04-25` (live file reads `2026-06-08`) and describes
  `estimate-logic-engine.js`'s `resolveEstimate()` as hardcoding all its
  defaults, which is no longer accurate — it now takes a `settings` parameter
  (whether callers actually thread `NBD_ESTIMATE_CONFIG` into it was not
  traced in this pass; flagged as its own open question below).

---

## §7 — DECIDED 2026-09-09 (Jo, same session as the audit)

1. **Good/Better/Best IS Standard/Preferred/Elite** — one ladder, translated at
   the display layer. Internal/data-model keys (`good`/`better`/`best`) do
   **not** change — they're invisible object/Firestore-field keys across
   dozens of files (`TIER_RATES`, `prices{good,better,best}`, `selectedTier`,
   catalog `tier` fields, doc-preflight schemas) and renaming them is a
   high-risk, zero-customer-value data migration. Every **customer-facing**
   surface renders the display label instead: `good→Standard`,
   `better→Preferred`, `best→Elite`. Rep-facing/internal tool UI (the estimate
   builder's own tier picker, `decision-engine.js` sales scripts,
   `doc-preflight.js`'s rep card) may keep saying Good/Better/Best for speed —
   that's a rep tool, not a customer artifact.
2. **Warranty: retire the 5/10/20-year duration scheme. Standardize on
   lifetime + transferability/inspection** — the model already built and
   marketed on `the-nbd-guarantee` and in `warranty-cert.js`:
   Standard = lifetime workmanship, non-transferable. Preferred = lifetime,
   transferable to one subsequent owner. Elite = lifetime, fully transferable
   + annual courtesy inspection. Reasoning: it's the stronger, already-
   marketed claim (lifetime beats "5 years" on the base tier), and it already
   has the brand investment. **Flagged, not reopened as a question**: this
   raises the company's workmanship-liability commitment on the base tier
   from 5 years to lifetime — confirm before it reaches a real signed
   contract. Everything in §8 reads this from one config constant, so
   reverting to a duration model later is a one-line change, not a
   re-migration.
3. **"NBD Guarantee" is the roofing job's warranty, not a separate add-on
   product** — it is automatically the tier the customer bought, not a
   rep-picked separate selection. `warranty-cert.js`'s wizard (which currently
   lets a rep pick any Guarantee tier independent of the sold pricing tier)
   gets its tier pre-filled from `lead`/estimate's actual tier and locked,
   not left as a free-choice dropdown.
4. **`close-board.js:195`'s warranty default** → becomes
   `deal.tiers[selectedTier].warranty` reading the §7.2 model per-tier,
   replacing the flat `'25-year limited lifetime'` fallback entirely — there
   is no more "default" once every tier has a real answer.
5. **Tier→material enforcement**: **deferred, not decided** — real scope
   (catalog/SKU rules), kept out of this naming/warranty consolidation so
   that PR stays reviewable. Revisit as its own change; §4's findings stand as
   the brief for it.
6. **TAMKO sell-pricing placeholder**: **deferred** — a pricing/vendor
   question, not a naming one; unblocked independently of this work.

---

## §8 — Consolidation plan (decided; sequenced for small, reviewable PRs)

**PR 1 + PR 2 — SHIPPED same session, 2026-09-09 (uncommitted, not yet pushed).**

- `docs/pro/js/estimate-config.js` — added `TIER_DISPLAY` (Standard/Preferred/
  Elite labels + the lifetime/transferability warranty model from §7.2) and
  `tierLabel()`/`tierWarrantyText()` helpers. `_version` bumped to
  `2026-09-09`. Additive only — nothing reads `tierWarrantyText()` yet (that's
  PR 3).
- Customer-facing label call sites repointed to read the new config, each
  with a local fallback matching the codebase's own established
  "config-may-fail-to-load" pattern (`close-board.js`'s `tierDisplayLabel()`,
  `estimate-v2-ui.js`'s `_v2TierLabel()`, `estimate-finalization.js`'s
  `_tierLabel()`, `estimates.js`'s top-level `tierLabel()` + `TIER_DISPLAY`
  const — checked repo-wide for name collisions first, since `estimates.js`
  is one of the ~100 files sharing `dashboard.html`'s global classic-script
  scope; clean).
- **Also fixed while in these files, found via the same session's follow-up
  from Jo ("we never install 3-tab, ever" — new installs, not repairs):**
  the public Instant Estimate tool (`docs/estimate.html` tier tabs +
  `docs/assets/js/inline/4053149b2f.js`'s `TIER_LABELS` and its AI-quote
  prompt) was telling real leads their entry-tier quote was for **3-tab
  shingle** — a shingle class NBD does not install on a new roof at all.
  The dollar figures were never actually 3-tab pricing (they're derived
  straight from `TIER_RATES`/architectural waste factors, confirmed by the
  file's own comments) — only the label was wrong. Now "Standard ·
  Architectural" / "Preferred · Architectural" / "Elite · Lifetime Designer",
  and the AI prompt explicitly instructs the model never to call the entry
  tier "3-tab" or "economy." This was a live factual-accuracy issue on a
  public lead-facing tool, not just a naming-consistency one — worth noting
  separately from the rest of this consolidation.
- `estimates.js` also had a `tierName` field, persisted on saved classic
  estimates and read back by `dashboard-widgets.js`, `portal.js` (the
  **homeowner portal**), `estimate-view.js`, and `rep-report-generator.js` —
  it was writing "Reroof Plus"/"Full Redeck" (the third vocabulary, §1).
  New saves now write "Preferred"/"Elite" etc.; historical documents keep
  whatever they were saved with, same as every other display field in this
  codebase.
- Verified: `check-js-syntax.js` (503 files), `check-site-integrity.js`
  (243 pages, 0 failures), `apply-partials.js --check` (clean), `
  check-inline-html-scripts.js` (0 violations) — all green. Visually
  confirmed the new estimate.html tab labels render in the DOM.
- **Deliberately not touched in this pass** (PR 3+ scope): warranty
  duration/feature text in `estimate-v2-ui.js`'s `buildTier()` subtitles,
  `estimate-finalization.js`'s tier-card `sub` text, and every warranty
  generator in §3's table — those still say the old 5/10/20-yr / 10/15/
  Lifetime / flat-25-year mix. `close-board.js:195`'s warranty default is
  also still the flat `'25-year limited lifetime'` string. Not committed —
  sitting as uncommitted working-tree changes pending review.


**PR 1 — Canonical display config (additive, zero behavior change).**
Add to `docs/pro/js/estimate-config.js` (already the declared single source of
truth for pricing) a frozen `TIER_DISPLAY` object:

```js
TIER_DISPLAY: Object.freeze({
  good:   Object.freeze({ label: 'Standard', warranty: { duration: 'lifetime', transferable: false, transferWindowDays: 0, inspection: false } }),
  better: Object.freeze({ label: 'Preferred', warranty: { duration: 'lifetime', transferable: true,  transferWindowDays: 30, inspection: false } }),
  best:   Object.freeze({ label: 'Elite',    warranty: { duration: 'lifetime', transferable: true,  transferWindowDays: 0,  inspection: true } }),
}),
```
Plus one helper both engines already have a slot for
(`estimate-config.js` is loaded everywhere `TIER_RATES` is): `tierLabel(key)`
and `tierWarranty(key)`. Nothing calls it yet — this PR is pure addition,
trivially reviewable.

**PR 2 — Swap customer-facing tier LABELS to read the config.** Visual-only
diffs, easy to screenshot-verify before/after:
- `close-board.js:186-190` default tiers object + `:446/452/458` tier-name
  divs (keep the ☆/★★/★★★ marks if desired, swap the text)
- `estimate-v2-ui.js:2236` (`LABEL` in homeowner presentation mode),
  `:2827` (the `"Good / Better / Best comparison"` cover-copy string),
  `:2868-2889` (`buildTier()` name args)
- `estimate-finalization.js:769-772` (`tierDefs` labels)
- `estimates.js:412, 472, 841` — **all three** of classic's own label objects
  collapse to one call each; this also kills the "two labels on one printed
  page" bug (§1 finding)

**PR 3 — Consolidate warranty text onto the §7.2 model, and consolidate
generators.** The audit found **four independently-coded certificate
generators** (`warranty-cert.js`, `document-generator.js` +
`document-generator-templates.js`, `dashboard-ui.js`'s `DOC_TEMPLATES`, and
`customer-bootstrap.module.js`'s 🛡️ button). Don't hand-sync text across all
four forever — pick one canonical generator and make the rest call into it:
- `warranty-cert.js` already has the right shape (Standard/Preferred/Elite,
  lifetime+transferability) — becomes the reference copy, now reading
  `TIER_DISPLAY` instead of its own `WC_TIER_DESCS` literal, and pre-filled
  from the lead's actual tier (kills open item §7.3) instead of an
  independent rep-picked dropdown.
- `document-generator.js`'s `WARRANTY_TIERS`/`renderWarrantyBadge` and
  `document-generator-templates.js`'s `renderWarrantyCertificate` are
  rewritten to read the same config (kills the internal
  20-Year-vs-"life of the structure" self-contradiction and the
  20-years-from-issue-date-vs-"as long as you own your home" one).
- `dashboard-ui.js`'s `DOC_TEMPLATES.warranty`/`.contract`/`.completion`
  read the same config text (kills the Lifetime-vs-10-Year-vs-Lifetime
  self-contradiction across two templates in one file).
- `customer-bootstrap.module.js:3155`'s hardcoded `warrantyYears = 5` 🛡️
  button — since it's the one generator confirmed genuinely live and wired —
  either becomes the thin customer-facing trigger for the consolidated
  generator above, or is deleted in its favor.
- `close-board.js:195` per §7.4.
- Bundle `how-to.html:781, 792-794, 857, 1005` rep-training copy into this
  same PR (per this vault's "batch doc-only fixes with the next code push"
  rule) so training never again describes a scheme the code doesn't match.

**PR 4 — Marketing price copy.** Fix `the-nbd-guarantee/index.html` (6
occurrences) and `the-nbd-build/index.html` (1) from the unsupportable
"+15%/+30% over Standard" to the real "+9%/+21%" (or round to "+10%/+20%" for
readability — Jo's call on phrasing, not on the underlying number, which is
not negotiable since it's what the engine actually charges). Fixing the copy
to match the code, not the reverse — the code figures are downstream of real
per-SQ material/labor economics; the marketing percentage was asserted with
no basis at all (git-blame shows it was never correct, not something that
drifted).

**PR 5 (separate, lower priority, own decision cycle)** — tier→material
enforcement (§4) and TAMKO pricing confirmation (§7.6). Not bundled here.

---

**PR 3 — SHIPPED same session, 2026-09-09 (uncommitted, not yet pushed with
PR 1+2).** All eight independently-coded warranty-duration/guarantee schemes
found in §3 now read the lifetime + transferability model from
`estimate-config.js`'s `TIER_DISPLAY`, or state it directly where a per-tier
call wasn't practical:

- `estimate-config.js` — added `tierWarrantyBlurb()` (short differentiator
  phrase, for compact spots) alongside PR 1's `tierWarrantyText()`.
- `close-board.js` — the flat `'25-year limited lifetime'` badge (still
  unresolved as of PR 1+2) is now `'Lifetime Workmanship Warranty'`, true for
  every tier; each tier card gets its own transferability line instead of
  relying on one flat claim above all three.
- `warranty-cert.js` — kept as the reference copy (its content already
  matched the decided model almost verbatim). Added: the Guarantee Tier now
  pre-fills from the estimate's actual sold tier (`lead.warrantyTier`/`tier`/
  `tierName`, mapped through the shared `tierLabel()`) instead of always
  defaulting to Standard — still rep-overridable, not locked (open item §7.3
  substantially addressed; full lock deferred as lower-value/higher-risk for
  this pass).
- `document-generator.js` — `WARRANTY_TIERS` (5/10/20-Year) replaced with a
  `MANUFACTURER_COVERAGE` table (Standard/Enhanced/Premium — the
  manufacturer-coverage axis, deliberately untouched per the Sept-8
  claims-audit ruling) + a `renderWarrantyBadge()` that composes its text
  from the shared config at render time. Fixes the object's own internal
  "20-Year" vs. "life of the structure" contradiction.
- `document-generator-templates.js` — `renderWarrantyCertificate` no longer
  prints a real "N years from issue date" expiration field for a tier whose
  body text also promises it never expires; every tier now says "No
  expiration — lifetime coverage," with the differentiator (transferability,
  inspection) read from the shared config rather than a hardcoded per-tier
  years table. The rep-facing `transferable` checkbox (doc-preflight.js) can
  still upgrade transferability on top of the tier default — it can no
  longer downgrade what a tier already promises.
- `dashboard-ui.js` — `DOC_TEMPLATES.contract`/`.warranty`/`.completion`
  (the blank fillable forms — confirmed by this same audit to have no live
  UI entry point today, fixed anyway since the content is still live in the
  tree) no longer contradict each other or themselves on Preferred's
  duration; the "NBD NBD" typo is gone.
- `customer-bootstrap.module.js` — the one certificate generator confirmed
  genuinely reachable (the 🛡️ button) no longer hardcodes `warrantyYears =
  5` regardless of tier; it now reads the estimate's actual tier and prints
  "Lifetime Workmanship" + the per-tier transferability line, dropping the
  now-meaningless "Warranty Expires" date field.
- `estimate-v2-ui.js` — the proposal PDF's tier-comparison bullets (were
  10/15yr/Lifetime — a NINTH scheme this pass found, not counted in the
  original 47) and its separate flat `terms.warranty` string (was "10 years
  labor minimum") both now state the lifetime model.
- `estimate-finalization.js` — the retail-quote tier-card subtitles (were
  "Standard System"/"System Warranty"/"Impact + 20yr Warranty" — inconsistent
  even in WHAT they described) now state a material differentiator +
  "Lifetime Warranty" uniformly; the flat Warranty-section paragraph below
  the cards (was a contradicting flat "10-year") now says Lifetime too.
- `doc-preflight.js` — `WARRANTY_TIER_OPTIONS` and `renderWarrantyTier()`
  (the rep-facing picker feeding the fields above) updated to match what
  actually prints now, so a rep's selection screen no longer promises a
  duration the generated document doesn't contain.
- `how-to.html` — rep training now states the lifetime model and explicitly
  spells out the Good→Standard/Better→Preferred/Best→Elite correspondence
  in prose (closing the "no documented translation anywhere in rep training"
  finding).

**Verified:** `check-js-syntax.js` (503 files), `check-site-integrity.js`
(243 pages, 0 failures), `apply-partials.js --check` (clean),
`check-inline-html-scripts.js` (0 violations), `node tests/smoke.test.js`
(3810/3810), `node tests/estimate-v2-payload.test.js` (90/90),
`node tests/catalog-cost-privacy.test.js` (126/126, confirms no cost/margin
data was touched or leaked) — all green.

**Deliberately not done in this pass:** fully locking `warranty-cert.js`'s
Guarantee Tier dropdown (kept rep-overridable); removing the now-largely-
redundant `transferable` checkbox from the doc-preflight `warranty_certificate`
schema (harmless — it can only add transferability, never remove what a tier
already promises — but worth a follow-up since a rep could wrongly think they
need to check it for Preferred/Elite); PR 4 (marketing site's +15%/+30% price
copy) and PR 5 (tier→material enforcement, TAMKO pricing) are unchanged from
their §8 status above.

**Guardrail for every PR above**: add one contract test per surface (this
vault's own established pattern — see `photos-timestamp-contract.test.js` for
the shape) that enumerates every writer/reader of a tier label or warranty
string and asserts it calls the shared config rather than containing a
literal `'Good'`/`'Better'`/`'Best'`/`'Preferred'`/duration string. That's
what stops a fifth vocabulary from appearing next quarter — the root cause
here was never any one generator being wrong, it was that nothing enumerated
how many generators existed.

---

## Appendix — full candidate list (47 found; 12 verified, 35 logged)

Severity and surface as returned by the map agents; **Verify** column shows the
adversarial outcome where run (C=confirmed both, C/R=split, R=refuted both),
otherwise "—" (not individually re-verified, but see the relevant §
above for cross-corroboration).

| Sev | Verify | Surface | Finding |
|---|---|---|---|
| High | C,C | Pricing engine | Good/Better/Best never relabeled to Standard/Preferred/Elite anywhere in CRM pricing/document code |
| High | — | Pricing engine | Classic wizard's 4th vocabulary ("Standard Reroof/Reroof Plus/Full Redeck") mixed with "Good—" on the same printed doc |
| High | — | Pricing engine | Workmanship-warranty duration not actually unified to 5/10/20 — 10/15/Lifetime and flat-10yr survive on live docs |
| High | C,C | Marketing site | Public estimate tool's 3-Tab/Architectural/Designer taxonomy doesn't match Guarantee page's GAF NS/HDZ/UHDZ (split on "is this intentional") |
| High | C,C | Marketing site | Stated +15%/+30% price uplift doesn't match the ~+9%/+21% the pricing engine actually computes |
| High | — | Marketing site | "Good/Better/Best" IS customer-facing (public Instant Estimate tool) — not internal-only as assumed |
| High | — | Warranty/Guarantee | Two unmapped tier-naming systems for "warranty" (5/10/20-yr good/better/best vs. all-lifetime Standard/Preferred/Elite), both live |
| High | — | Warranty/Guarantee | `dashboard-ui.js`'s two blank-form templates contradict each other AND themselves on Preferred's duration |
| High | — | Warranty/Guarantee | Same generated certificate states both a 20-year expiration date and "for as long as you own your home" for Best |
| High | — | Real proposals | No customer document anywhere uses the public site's Standard/Preferred/Elite names |
| High | — | Real proposals | Same generated retail-quote PDF states two different warranty durations (tier cards vs. flat Warranty section) |
| High | — | Real proposals | Close Board warranty badge flat, matches no tier — known, still open per the Sept-8 commit itself |
| High | C,C | Product catalog | Tier↔material mapping not enforced in either engine a rep actually uses to build a whole-roof estimate |
| High | R,R | Product catalog | Xactimate catalog tags impact-rated AND unrelated luxury/Designer both `best` — **refuted**, documented by design at the point of sale |
| High | — | Product catalog | Shipped TAMKO tier tags one rung off the rebrand BUILD-BRIEF's own locked model |
| High | — | Historical QA | `LAUNCH-BLOCKERS.md`'s entire pricing/billing model is stale — plan, prices, and gating PR no longer exist |
| High | — | Sales enablement | Rep training doc (`how-to.html`) misdescribes the actual Warranty Certificate generator's names and terms |
| High | — | Sales enablement | Same tier ("Preferred") given two different warranty durations within one rep document-template file |
| Med | — | Pricing engine | `close-board.js:195` warranty default still `'25-year limited lifetime'`, confirmed unresolved |
| Med | — | Warranty/Guarantee | "NBD Guarantee" Standard/Preferred/Elite wizard appears to have no live UI entry point |
| Med | — | Warranty/Guarantee | `DOC_TEMPLATES` blank-form warranty content appears unreachable through any current UI control |
| Med | — | Warranty/Guarantee | Only live customer-facing certificate button (🛡️) ignores tier entirely, hardcodes flat 5 years |
| Med | — | Marketing site | Guarantee page's own comparison table contradicts itself on which tier(s) qualify for GAF System Plus |
| Med | — | Marketing site | Open question: is Good/Better/Best meant to be the same ladder as Standard/Preferred/Elite, or separate? |
| Med | — | Product catalog | Rebrand docs' proposed GAF SKUs (Timberline NS, UHDZ) don't exist in the pricing product catalog |
| Med | — | Product catalog | 2026-06-24 rebrand audit's "funnel already = 3-Tab/Architectural/Designer" claim doesn't match catalog structure |
| Med | — | Product catalog | No code enforces the warranty-required-accessory rules stated in prose (TAMKO underlayment/starter/ridge) |
| Med | — | Historical QA | `RATE-SHEET.md`'s "line-item engine hardcodes, ignores config" description is now stale |
| Med | — | Historical QA | `IAM-RUNBOOK.md`'s action item is completed but the doc was never updated to say so |
| Med | — | Sales enablement | Warranty Certificate template contradicts its own body paragraph about duration |
| Med | — | Sales enablement | Certificate of Completion ignores tier, asserts flat Lifetime ("NBD NBD" typo included) |
| Med | — | Sales enablement | No documented Good/Better/Best → Standard/Preferred/Elite translation anywhere in rep training |
| Low | — | Pricing engine | Canonical-total bug confirmed FIXED (not a live defect — logged for completeness) |
| Low | — | Pricing engine | Customer-facing brand claims per tier hardcoded independently of the internal cost-basis catalog |
| Low | — | Pricing engine | Open Q: does doc-preflight's 5/10/20 warrantyTier value actually reach generated PDF text? |
| Low | — | Warranty/Guarantee | `document-generator.js`'s own `WARRANTY_TIERS.best` internally inconsistent (20-Year vs. "life of the structure") |
| Low | — | Warranty/Guarantee | Rep script equates "Good tier"/"Standard tier" with no code enforcing the correspondence |
| Low | — | Marketing site | Public site shows no leakage of the internal 5/10/20-yr scheme (non-drift, reported for completeness) |
| Low | — | Product catalog | Open Q: is TAMKO sell pricing still an unconfirmed GAF-mirrored placeholder as of today? |
| Low | — | Real proposals | Real filed customer estimates bypass all in-code tier vocabulary entirely (hand-typed Google Docs) |
| Low | — | Real proposals | Open Q: is the Hildeman $1,616 gap tier drift or pure document-versioning? — **ruled: versioning, see §5** |
| Low | — | Historical QA | `RATE-SHEET.md`'s config `_version` citation stale (figures still match) |
| Low | — | Historical QA | Open Q: does B-8's `materialMarkupPct ?? 0.25` fallback caveat still hold in the live insurance path? |
| Low | — | Historical QA | Open Q: was the $642 CLASSIC-below-minimum item ever formally closed? (inferable, never stated) |
| Low | — | Sales enablement | Doorstep ballpark hardcodes `$595` literal instead of reading `NBD_ESTIMATE_CONFIG` |

---

*Filed per the vault's standing audit-logging rule. Linked from
[INDEX.md](../INDEX.md).*
