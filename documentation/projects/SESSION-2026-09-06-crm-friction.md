# Session 2026-09-06 (part 2) — CRM friction: the silent ones

Follows [the e-sign rebuild](SESSION-2026-09-06-esign-rebuild.md) the same day.
Jo: *"now do the CRM friction stuff."*

The lane was already mapped, with citations and adversarial verdicts, in
[ESIGN-CRM-RECON-2026-09-06](../audit/ESIGN-CRM-RECON-2026-09-06.md). **Every
claim was re-verified against current `main` before anything was touched** —
the recon was cut 12 commits earlier.

Branch `crm-friction`, five commits.

---

## The through-line

Nothing here was a "make it prettier" item. Every one of these **reported
success while losing something**, which is why they survived: the failure
was invisible from the outside.

| what the app said | what actually happened |
|---|---|
| contract generated | scope was empty; the rep re-typed it from the estimate they had just built |
| warranty certificate issued | it named GAF on a TAMKO job |
| stage moved | `stageRole` went stale, no activity note, no drip |
| crew scheduled | with no date, so the job never reached the schedule |
| photo captured | the file was read, confirmed, and thrown away |
| "Photo queued (offline)" | the queue was read by nothing, ever |
| — | the notification poll tore down its own live listener every 2 minutes |

---

## 1. Two bugs, one root cause: `lineItems` vs `rows`

The document generator and its pre-flight read `est.lineItems`. **V2 — the
builder every estimate goes through now — writes `est.rows`, and the string
`lineItems` does not appear in `estimate-v2-ui.js` even once.**

- `lineItems` is `required:true` on proposal, contract, supplement_request and
  invoice, so all four opened with an empty REQUIRED field.
- The same empty array reached `resolveDocManufacturer`, which finds no
  shingle line and falls back to its hardcoded `manufacturer = 'GAF'`. **The
  manufacturer named on a customer-facing warranty document was the default,
  not what was sold.**

Fixed with one new reader, `buildDocLineItems`, added to
`customer-estimate-rows.js` — the pure, CI-gated home of the retail ladder.
Deliberately not a local rows[] reader: deriving a customer price from saved
rows is exactly the math whose private copies leaked the contractor's cost
basis to homeowners in the 2026-07-18 sweep. A fourth copy was not the answer.

Per-SQ estimates get **one summary line at the locked tier price** (mirroring
`InvoicePipeline`) rather than `buildDisplayRows`' deliberate empty list — a
contract with no scope is the bug being fixed.

> `functions/customer-estimate-rows.js` is a byte-identical copy of the docs
> file, and its own test is what caught the drift. Re-sync it after any edit.

## 2. A rep could not record a check

Once the modal shown right after invoice creation was dismissed, there was **no
path to Mark Paid anywhere in the app**:

- the customer page's invoice list is read-only — its "Pay" link is the
  *homeowner's* Stripe link, not a rep action;
- `markPaid` / `markPaidUI` ship only on the dashboard; and
- **`renderInvoicePanel` and `renderInvoiceList` — which both carry the right
  View / Send / Mark Paid buttons — are mounted NOWHERE.** Two complete,
  working invoice UIs that are never rendered.

The customer invoice row now offers Mark Paid, lazy-loading the 82 KB module
through `ScriptLoader` on the click rather than adding it to an already-heavy
boot.

**Trap worth carrying:** `invoice-pipeline.js` is dashboard code whose
`getDb()` reads `window._db`; the customer bootstrap sets only `window.db`. The
first tap would have thrown *"Firestore (v9) not initialized"* with no visible
cause. The dashboard sets both to the same instance, so the handler aliases it —
and the test pins **both** sides, so if either changes the alias gets
re-examined instead of silently becoming wrong.

## 3. The customer page advanced stages with none of the kanban's bookkeeping

`moveCard` does five things; `progressStage` did one (it wrote `stage`). The
strings `stageRole`, `missingRequiredFields` and `EmailDrip` did not appear in
`customer-bootstrap.module.js` at all. So: `stageRole` drifted from `stage`
while analytics-kpi, money-dashboard, the leaderboard and the forecast all
bucket on `stageRole`; the customer's own activity feed showed no record of a
stage change made from that page; and a lead moved to `contract_signed` there
got none of the follow-up the same move triggers on the board.

Now imports the canonical config from `crm-stages.js`. **Verified in a real
browser that the import resolves** — a module script whose import 404s takes
the whole page down, and this is the customer page's bootstrap.

**The gate is a WARNING here, not a block, and that is deliberate.** Every
gated field has an input in the dashboard lead modal, so blocking there is
satisfiable. The customer page's edit modal carries only `jobValue` of them —
`insCarrier`, `claimNumber`, `estimateAmount`, `deductibleOrOwedByHO`,
`financeCompany`, `loanAmount` and `scheduledDate` have no input on that page
at all. Blocking would strand the rep. The test asserts the modal **still**
lacks those inputs, so the day it gains them the suite goes red and the
trade-off is re-decided rather than quietly outliving its reason.

## 4. `crew_scheduled` needed no date

A `track: 'shared'` stage reachable from the Jobs view by a lead of any type,
but the required-field lookup is keyed by `jobType` and only `warranty` listed
`scheduledDate`. `smart-calendar` builds the day's job list from
`leads.filter(l => l.scheduledDate === todayStr)` — so a job moved to Crew
Scheduled without a date **never appeared on the schedule**. The crew was
scheduled and the schedule did not know.

Now gated on every track, using machinery that already existed
(`scheduledDate` has had a label, a quick-fix mapping and the
`#lScheduledDate` input all along).

The new suite also asserts **every gated field is reachable** — label plus a
real input id — so the gate can never demand something a rep cannot fill.

## 5. Mobile: the camera threw photos away

`"+"` → Photo opened the camera through a hidden `<input capture>`, and
`_mCreatePhotoPicked` read the file, confirmed it existed, and **discarded
it** — opening the lead modal with "Create or open a lead, then add photos from
its gallery". Four taps, a climb, and the shot was gone.

The camera now opens only when there is somewhere to put the picture, through
`PhotoEngine.openCamera` (the real flow, with tagging and phase) rather than a
raw input nothing consumed. With no customer in context it asks **first**.

## 6. "Photo queued (offline)" was false

Every failed upload was pushed into `state.uploadQueue`. **That push was the
only reference to it in the entire repo** — never drained, never retried, never
persisted.

Now drained on `online` **and** after any successful upload (better evidence
that signal is back than an event that may never fire on a connection that
never fully dropped). Failures re-queue and the drain stops rather than
spinning; unrecoverable items drop rather than retry forever; re-entrancy
guarded.

**The copy is now honest about its limits.** The queue is memory-only, and
`dashboard-sw-bootstrap` reloads the page on every bfcache resume — exactly
when a rep backgrounds the app — so a queued photo does *not* survive leaving
the page. It says "Keep this page open" rather than promising durability the
code cannot deliver. Persisting it properly is §Next.

## 7. The notification poll fought its own live listener

`loadNotifications` establishes an `onSnapshot` subscription, and a
`setInterval(…, 120000)` re-ran it every two minutes — tearing that listener
down and re-subscribing, re-reading the whole 50-document query. A billed read
set and a radio wake every two minutes, forever, to learn what the listener had
already pushed.

The poll now covers only the two states with no live listener (no `onSnapshot`
in the SDK; a listener that errored) and both turn it back on.

---

## Gates

Four new suites and two extended, all green, and **the two new behaviours were
proven able to fail before being trusted**:

| suite | assertions | fail-proof |
|---|---|---|
| `customer-estimate-rows` (extended) | 37 → 46 | old reader restored → 6 red, incl. TAMKO flipping back to GAF |
| `crm-required-fields` (new) | 41 | cash `crew_scheduled` entry removed → 3 red |
| `customer-invoice-markpaid` (new) | 20 | — wiring contract |
| `customer-stage-advance` (new) | 19 | — wiring contract |
| `photo-offline-queue` (new) | 17 | converter exercised for real |
| `notif-bell-merge` (extended) | 41 → 48 | — |

Plus: node bucket 71/71, smoke 3591, `crm-audit`, `check-js-syntax`,
`check-inline-html-scripts`, `check-site-integrity`, `apply-partials`,
`build-sitemap`, `build-projects`, `build-feed`.

---

## Deliberately NOT done

- **`"＋ New Estimate"` opening a customer-less builder.** `startNewEstimate`
  already accepts a leadId; the Estimates-view toolbar genuinely has no
  customer in context, and `_cardDetailLeadId` is nulled on every card-detail
  dismiss. Guessing a customer onto an estimate is worse than asking for one.
  The fix is a customer-picker step in the chooser, not a fallback global.
- **A persistent (IndexedDB) photo queue.** `offline-manager.js` already
  contains a complete one — quota caps, Safari 7-day purge detection,
  auth-token pre-flight — exposed as a module-local `const` that is never
  assigned to `window`, with zero callers, and the file is not loaded on the
  dashboard at all. Mounting it is the real fix and its own slice.
- **Blocking the required-field gate on the customer page.** See §3 — it needs
  the edit modal to gain the fields first.
- **`customer.html`'s 653 KiB of eager loading**, the three Cmd+K handlers, and
  the four hardcoded pipeline ladders. All still open, all still cited in the
  recon note.
