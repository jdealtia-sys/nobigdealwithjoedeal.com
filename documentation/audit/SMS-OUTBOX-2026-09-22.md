# Offline SMS outbox — close-out audit (2026-09-22)

**Result: no defects found, and the finding that matters is that its tests are
not vacuous.** Three safety-critical mutations each redden the suite. Recorded
so nobody re-audits 1,650 lines from scratch.

**Why it was picked.** `docs/pro/js/sms-outbox.js` (#1692, merged 2026-09-21)
was the largest recently-landed surface with **no entry in
`documentation/audit/`**. Its own history argued for a look: it adopted 1,259
lines of previously-unreviewed round-3 work, plus the round-2 fix it lacked,
and its own review then found a blocker (`_releaseSendLock` preferring a
Firestore transaction — which cannot run offline — on the path that only runs
offline). A subsystem that needed three rounds to land is worth a fourth read.

## What was checked, and what held

| Claim the module's header makes | Verdict |
|---|---|
| `sw.js` can never replay a queued text | **Holds.** `sw.js` opens only `nbd-offline-db` / `pending-writes`; the outbox lives in its own `nbd-sms-outbox-db`. No reference to it anywhere in the service worker |
| Every read is scoped to the signed-in uid | **Holds**, and for the right reason: `_uid()` reads live auth objects (`window._user`, `window.auth.currentUser`), never `nbd_last_uid` or any other localStorage key. This is exactly the trap in the in-memory-cache rule — another tab's sign-in cannot poison it. The only localStorage use is a cross-tab flush **lease** |
| Sign-out purges every phone number and message | **Holds.** `_isPiiFreeReceipt` is tight and explicit — a record survives only if it is a receipt, `sent`/`acking`, **and** has no `to`, no `toDigits` and no `body`. Anything else is deleted |
| An opt-out that arrives while a text is queued is honoured | **Holds.** The server checks opt-out *first* (403 → the client discards as `opted_out`, records it, and tells the rep). The tray's "Open in Messages" hands off only on a **fresh** server answer, never on an old hold |
| A replayed text cannot double-send | **Holds.** A text queued after a live attempt keeps that attempt's `clientMsgId`, and the server's claim on that id answers `in_flight`/`duplicate` |

## The part that is actually load-bearing: the tests are not vacuous

Inspection alone proves nothing about whether a future change would be caught.
Each mutation below was applied to `docs/pro/js/sms-outbox.js`, run, and
reverted.

| mutation | meaning if it shipped | result |
|---|---|---|
| `_isPiiFreeReceipt` → `return true` | every phone number and message survives sign-out on a shared device | **3 failed** |
| `_uid()` falls back to `'ANY'` | one account reads another's queued texts | **1 failed** |
| `STALE_MS` 15 min → 365 days | an hours-old text auto-sends on reconnect with no rep confirmation | **exit 1** — *"≥15 min old → held 'stale' WITHOUT a server call"* |
| clean tree | — | **201 passed, 0 failed** |

Server side, baseline only (not mutated this pass):
`sms-outbox-server.test.js` 208 passed, `sms-send-optout-order.test.js` 63 passed.

## Open / not covered by this pass

- The **server** guard (`functions/sms-outbox-guard.js`) was read but not
  mutation-tested; `sms-send-optout-order.test.js` already pins the ordering
  that matters most (opt-out before send). A future pass could mutate the
  quiet-hours and competing-activity branches.
- Nothing here re-opens the `_releaseSendLock` blocker — it was fixed in
  #1692 before merge.
