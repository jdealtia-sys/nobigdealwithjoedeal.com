# Resend `.error`-check sweep — 2026-09-08

Follow-up to [STRIPE-INVOICING-STATUS-2026-09-08](STRIPE-INVOICING-STATUS-2026-09-08.md)
§"UPDATE 2026-09-08, round 2", which fixed `sendEmail`
(`functions/email-functions.js`) and flagged ~18 more `resend.emails.send()`
call sites at the identical unchecked shape as a follow-up, "bigger than
this session's scope." This is that follow-up.

## The bug, in one line

The Resend SDK (v6.24.0) does **not** throw on an API-level rejection (bad
or expired key, suspended account, rejected sender domain, 429 rate limit,
5xx) — it resolves normally to `{ data: null, error: {...} }`. Every call
site that wraps the send in try/catch and never inspects `.error` treats
that rejection as a genuine delivery.

## What actually exists

A repo-wide `resend.emails.send(` grep found **19 files, 20 call sites** —
one more file (`esign-envelope.js`) than the 17 the follow-up note named,
plus `email-functions.js` itself. All 20 shared the same defect before this
sweep.

## Shared fix

[`functions/resend-guard.js`](../../functions/resend-guard.js) — a
dependency-free pair, `resendRejected(response)` /
`resendErrorMessage(response, fallback)` — factored out so every site gets
the same one-line check instead of 12 hand-rolled `response.error` reads,
and so it has one real (non-regex) unit test
(`tests/smoke/resend-error-surfacing.test.js` §1).
`functions/email-functions.js`'s own fix was refactored onto this helper
too, superseding the inline `if (response && response.error)` version
committed in parallel on `fix/invoice-send-email-error-check` — same
behavior, one shared implementation.

## Disposition — file by file

**Fixed (13 files, 14 call sites incl. `email-functions.js`)** — each now
checks `resendRejected(...)` immediately after the send and routes a
rejection through the file's own existing failure path (the same one that
already runs on a thrown exception), so nothing had to be invented, just
connected:

| File | Consequence of the bug, unfixed |
|---|---|
| `email-functions.js` (`sendEmail`) | reference fix — see STRIPE-INVOICING-STATUS |
| `esign-envelope.js` (`sendEsignEnvelope`) | `emailed` (persisted + returned to the rep) true for a homeowner e-sign link that never sent |
| `lead-alert.js` — `ackHomeowner` | `ackEmailSentAt` stamped, "email sent" logged, for a homeowner ack that never sent |
| `lead-alert.js` — tenant alert email | `outcomes.email = 'sent'` feeds `alert_outbox`, the **exact ledger built (2026-07-06) to catch a silent delivery failure** — defeated by this bug |
| `handlers/invites.js` (`teamInviteEmail`) | same `alert_outbox`/dashboard-banner defeat; the file's own comment says the banner exists so "invites silently never arrive" is caught — it wasn't |
| `storm-report-email.js` | customer storm-history report marked delivered; doc already claims itself pre-send (redelivery guard) so there's no retry either way |
| `estimate-email.js` | `estimateEmailStatus:'sent'` for a customer estimate that never sent |
| `funnel-recovery.js` | `recoveryEmailSentAt` stamped, and the loop's own `if (data.recoveryEmailSentAt) skip` guard means that funnel is **never retried, ever** |
| `lead-followup.js` | `followUpEmailSentAt` stamped; file header says "one send ever per lead" — same permanent-loss shape as funnel-recovery |
| `report-sharing.js` (`createReportShareToken`) | `emailed` (returned to caller) true for a homeowner report link that never sent |
| `remote-signing.js` (`createSignRequest`) | same `emailed`-returned-true shape; the file's own comment promises "a transient mail failure surfaces to the rep" — broken by exactly this bug |
| `verify-functions.js` (`notifyNewLead`) | `{ success: true }` returned for Joe's own new-estimate-lead alert that never sent |
| `integrations/email-queue-worker.js` | `status:'sent'` with no retry — defeats the `MAX_ATTEMPTS` state machine the file exists to provide, for GDPR-erasure-confirmation and Stripe-dunning mail |

**Left as-is (6 files)** — internal rep/ops digests where the `*SentAt`
field written after the send is never read back anywhere to gate or skip
anything (confirmed by grep, not assumption — see the test's "deliberately
left" section), so a silently-dropped send costs one cycle, not a
permanent loss, and the next scheduled run picks the same
leads/users/events back up:

- `anniversary-touch.js` — the file's own comment already reasons about
  this: the CRM bell (`writeAnniversaryActivity` + `markAnniversaryTouched`)
  fires **before** the send and is the canonical "handled" signal; the email
  is an unguaranteed secondary nudge by design.
- `dormant-leads.js` — `lastDormantNudgeSentAt` is write-only; dormancy is
  re-evaluated fresh from lead activity every run, so a dropped nudge just
  means tomorrow's run re-finds the same dormant lead.
- `weekly-digest.js` — `lastDigestSentAt` is write-only; no re-send
  suppression exists to defeat.
- `review-request-nudge.js` — the per-lead "asked" flag
  (`reviewRequested`/`reviewNudgedAt`) is written unconditionally before the
  send attempt, mirroring anniversary-touch's design exactly.
- `lead-digest.js`, `marketing-report.js`, `storm-watch.js` — fixed
  recipient lists (Jo/team ops inboxes), no per-recipient state at all.

None of the six were *not* touched because the bug isn't real there — it
is, equally — but because fixing them would only correct a log line
("sent" vs. "rejected") with no functional consequence, and the task was to
fix silent failures that **mislead someone**, not to chase every incorrect
log line in the tree. If any of these six later grows a gate that reads
its `*SentAt`/flag field to skip a retry, it moves into the fixed bucket
above and picks up the same one-line check.

## Verification

`tests/smoke/resend-error-surfacing.test.js`, wired into
`tests/smoke.test.js`'s `DOMAINS` array:

- **§1** — real function calls (not regex) against `resend-guard.js`
  directly: both the rejected `{data:null,error:{...}}` shape and the
  success `{data:{...},error:null}` shape, plus `null`/`undefined`/`{}`.
  Zero external requires, so it runs with plain Node.
- **§2** — regex-over-source for the 13 fixed sites, each assertion
  anchored on the specific post-fix token sequence (the `resendRejected(...)`
  guard immediately followed by *that file's own* downstream
  success/failure marker — `outcomes.email = 'sent'`,
  `estimateEmailStatus: 'sent'`, `status: 'sent'`, etc.) rather than a bare
  "does `resendRejected` appear anywhere" check, so a fix that guarded the
  wrong response variable or landed in the wrong branch would still fail.
- **§3** — pins the "left as-is" reasoning as an assertion (e.g.
  `lastDormantNudgeSentAt` appears exactly once in `dormant-leads.js` — the
  write, never a read), so a future edit that adds a retry-suppressing read
  of one of these fields is caught rather than silently invalidating this
  note's rationale.

**Proven able to fail first**, per house style: `git stash push -u -- functions/`
(stashing only the 12 fixed files + the new `resend-guard.js`) reduced the
suite to `0 passed, 1 failed` (module-not-found on the now-absent guard,
by design — the test's own `if (loadError) return` guard stops it from
running assertions against handler files that no longer have anything to
find). `git stash apply` + `git stash drop` restored the fix; the suite
went back to `40 passed, 0 failed`. This repo's own emulator+curl proof
(the STRIPE-INVOICING-STATUS reference method) wasn't repeated per site —
`functions/node_modules` isn't installed in this worktree, so no
`functions/*.js` file could be `require()`'d for a live invocation without
first running `npm install` in `functions/`, which the repo's own guidance
warns strips `sharp`'s glibc pins ([npm-install-strips-glibc-constraints]
memory) — regex-over-source is this repo's existing fallback for exactly
that situation and is what the other ~15 `tests/smoke/*.test.js` domain
files already do for `functions/*.js`.

## Known gap — not fixed here

The other outbound-provider call in these same files, Twilio SMS
(`client.messages.create`, four call sites: `lead-alert.js`,
`verify-functions.js`, `storm-watch.js`, `sms-functions.js`), is a
structurally identical risk — a provider that resolves an error object
instead of rejecting would have the same blind spot Resend did. Twilio's
Node SDK rejects the promise on an API error (a `RestException`) rather
than resolving with an error field, so a bare try/catch IS sufficient
there and none of the four needed a change here. Not independently
re-verified against Twilio's source the way Resend's behavior was
(STRIPE-INVOICING-STATUS's live emulator test) — flagged for whoever next
touches one of these four, or adds another outbound-notification provider:
check whether it throws or resolves-with-error before assuming try/catch
alone is enough.
