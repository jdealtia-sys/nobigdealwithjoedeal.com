# NEXT SESSION — 2026-09-15

Supersedes [NEXT_SESSION-2026-09-14](NEXT_SESSION-2026-09-14.md) as the live
brief. That note's own §1 open item (`DEEPGRAM_API_KEY` — ask Jo or have him
run the one `gcloud secrets versions access` check) was **not** touched this
session and still stands exactly as written there.

## §0 — What shipped (2026-09-15)

Five PRs merged, all CI-verified green before merge, each with a real test
suite proven able to fail before being trusted:

| PR | What |
|---|---|
| [#1576](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1576) | **Collections lane** — new `collections` stage, staff-visible invoices, the Money dashboard's aging-bucketed collections queue with one-click stage advancement |
| [#1577](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1577) | **Hotfix** — every server-rendered PDF's brand mark had been illegible since #1570 (the brand refresh); `render-pdf.js`'s `logoUrl` pointed at a non-square asset that the doc band's 1:1 crop box mangled. Found via the brand-pack rollout audit Jo asked for mid-session; fixed same day, fast-tracked ahead of the in-progress lanes given it was a live customer-facing bug |
| [#1578](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1578) | **Paperwork Filing lane** — five gate fields (contract/permit/AOB/warranty-cert/COC filed timestamps) wired into the existing `REQUIRED_FIELDS_BY_TYPE` hard-block machinery; zero new gate infrastructure |
| [#1579](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1579) | **Kanban filter unification** — see §1 below, this is the one worth reading in full if you touch stage classification |
| [#1580](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1580) | **Warranty Claim lane** — see §2 below |

All three lanes from the original ask (Collections, Paperwork Filing,
Warranty Claim) are now done. Nothing is queued or half-built from this
session.

## §1 — Kanban filter unification (#1579) — read this before touching stage classification

Jo reported "click Jobs, almost nothing appears, but I've got jobs in
Contract Signed" — root cause: **~9 independent hand-copied stage-key
lists** across the app had drifted out of sync with each other within
hours of the Collections stage being added (`crm-pipeline.js` ×2,
`ask-joe-proactive.js`, `bottleneck-widget.js`, `money-dashboard.js`,
`analytics-kpi.js`, `weekly-digest.js`, two cosmetic label duplicates).

Fixed by consolidating to **two canonical classifiers** in
`docs/pro/js/crm-stages.js`:
- `isJobStage(stageKey)` — `stageKey === S.CONTRACT_SIGNED || VIEW_JOBS.includes(normalized)`
- `isTerminalStage(stageKey)` — `stageRole() === 'won' || 'lost'`

Both get a **built-in default** and a **tenant-aware re-binding** inside
`applyPipelineConfig()`, mirroring the pre-existing `isWonStage`/
`isLostStage` precedent exactly. A new `VIEW_JOBS_BOARD = [S.CONTRACT_SIGNED,
...VIEW_JOBS]` export drives the Jobs tab's actual column list —
deliberately kept **separate** from `VIEW_JOBS` itself, because
`stageOptionsForType()`'s dropdown splice and `resolveColumn()`'s job-stage
collapse both depend on `VIEW_JOBS`'s exact original scope.

**Two lists were deliberately NOT migrated** (a judgment call, not an
oversight — documented in code): `ask-joe-proactive.js`'s
`_ACTIVE_JOB_KEYS` (a narrower "still in physical production" concept that
excludes final_payment/collections/closed on purpose) and `money-dashboard.js`/
`analytics-kpi.js`'s self-contained `WON_STAGES` literals (those files are
intentionally dependency-free).

Product decisions Jo made explicitly for this lane (binding, don't
relitigate): Jobs tab **includes** Contract Signed; closed jobs **stay
visible** on the board (no roll-off); scope was **"do it right"** — the
full canonical-classifier migration, not a narrow patch.

## §2 — Warranty Claim lane (#1580) — the new subsystem, read before extending it

A claim opened against a job **after** it's already closed (a leak found
months later, a workmanship callback, a manufacturer-defect shingle) —
**distinct** from the pre-existing "warranty" job-type track
(`S.WARRANTY_SCHEDULED`/`S.WARRANTY_REPAIRED`, a homeowner's *original*
need) and from the formal warranty certificate (`warrantyCertFiledAt`).
Naming collision risk was considered and accepted; the STAGE_META label is
"Warranty Claim" (not "Warranty") to disambiguate from "Warranty Visit" /
"Repair Done" in the existing track.

**Data model:** `leads/{leadId}/warrantyClaims/{claimId}` — its own status
machine (`open → scheduled → repaired → resolved|denied`, `crm-stages.js`'s
`CLAIM_STATUSES`/`CLAIM_STATUS_ACTIONS`/`missingClaimFields`) — plus a
denormalized `lead.openWarrantyClaimId` stamped in the **same Firestore
batch** as claim creation, so the two synchronous hard gates
(`missingRequiredFields`, `moveCard()`'s own guard) never need to await a
subcollection read.

**New stage:** `S.WARRANTY_CLAIM`, role WON (doesn't reverse won-revenue
accounting — Jo's call, matching the Collections precedent), appended to
`VIEW_JOBS`/`VIEW_JOBS_BOARD`. A "File Warranty Claim" action lives on
`S.CLOSED` with **no jobTypes filter** (any job type, including
warranty/service, can get a post-close callback reported).

**Guard (the load-bearing piece):** `crm-pipeline.js`'s `moveCard()` and
`customer-bootstrap.module.js`'s `progressStage()` both intercept — entering
`warranty_claim` calls `WarrantyClaim.promptIntake()` (gathers reason +
description, opens the claim atomically) and leaving an OPEN claim calls
`WarrantyClaim.promptResolution()` (resolution notes are a hard requirement,
mirroring `REQUIRED_FIELDS_BY_CLAIM_STATUS.resolved`) — same two-call-site
pattern §1's lane established. New `docs/pro/js/warranty-claim.js` owns both
prompts + the writes; loaded on both dashboard.html and customer.html.

**Homeowner portal:** the old "Digital Warranty Card"'s `sms:` deep link
(tap → opens Messages with a pre-filled body → **no record exists unless
the homeowner actually sends it**) is replaced with a real form posting to
a new `reportWarrantyClaim` Cloud Function. That function deliberately
**never touches `lead.stage`/`openWarrantyClaimId`** — an unauthenticated,
unreviewed report creates a triage record (task + activity + a second
`warrantyClaims` doc with `reportedBy:'homeowner'`), but only a rep's own
"File Warranty Claim" click formalizes it onto the board. This means a
homeowner report and a rep's later formal claim are **two separate docs by
design** — not a bug if you notice it.

**Test coverage:** `tests/warranty-claim.test.js` (103 assertions) real-
executes `promptIntake`/`promptResolution` against a DOM+Firestore stub —
proves the actual atomic-batch write shape, not just that the functions
exist — including a deliberate mutation proving the `resolutionNotes` gate
is a real guard, not a tautology. `firestore.rules`' new
`warrantyClaimWriteOk()`/`openClaimIdOk()` are proven against the real
emulator in `firestore-rules.test.js`.

**Caught mid-build:** a leftover duplicate `document.body.appendChild(overlay)`
line in the first draft of `warranty-claim.js`'s modal helper (harmless —
appending an already-attached node is a no-op in real DOM — but would have
been confusing to debug later); and a stale 6000-char slice window in the
**pre-existing** `tests/customer-stage-advance.test.js` that the new guard
block's ~1400 extra characters pushed past (same "slice too narrow" failure
class this repo has hit before — widened to 7500 with margin).

## §3 — Nothing else is open

No pending PRs, no half-built lanes, no FLOORS drift. `main` is at
`ae61cc67` as of this handoff. If the next session's ask is unrelated to
the CRM stage machinery, §1/§2 above are reference material, not a queue —
skip straight to the new ask.
