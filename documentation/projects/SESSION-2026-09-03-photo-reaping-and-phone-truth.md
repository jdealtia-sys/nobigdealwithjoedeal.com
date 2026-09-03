# Session 2026-09-03 — photo reaping, the PWA's phantom "yes", and a phone that lied

Session brief: [NEXT_SESSION-2026-09-03](NEXT_SESSION-2026-09-03.md).
Next brief: [NEXT_SESSION-2026-09-04](NEXT_SESSION-2026-09-04.md).

Jo's ask, verbatim: *"lets get to work on the CRM. i want to keep working and
improving it but also dont let any current work or tasks drop off."*

So: three PRs shipped, and a verified inventory of everything still open —
including **fourteen briefed claims that turned out to be false**, which is the
part that keeps work from dropping off in the way that actually costs sessions.

---

## What shipped

| PR | What | Deploy |
|---|---|---|
| [#1353](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1353) | Reap a deleted lead's photos from Storage | functions redeploy |
| [#1354](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1354) | Finish the iOS-PWA `confirm()` sweep | client only |
| [#1355](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1355) | Bottom nav / Back / billing CTA | client only |

All three merged green on 19 CI checks each.

### #1353 — the photos carve-out rested on two false premises

`onLeadDeleted` reaped portals, documents, galleries and audio, and skipped
`photos/` deliberately. Its docblock gave two reasons. Both were wrong:

1. **"flat per-uid, not leadId-keyed, so it cannot be reaped by prefix."**
   The dominant modern shape *is* `photos/{uid}/{leadId}/...`
   (`photo-engine.js:1280`, `dashboard-bootstrap.module.js:4027`,
   `photo-editor.js:973`), with `thumbs/` and `_variants/` under the same
   leadId segment. One prefix reaps all three.
2. **"reachable only through signImageUrl (15-min v4 signed URL, no permanent
   token), so an orphan there is not publicly fetchable."**
   `image-pipeline.js` stamps a fresh `firebaseStorageDownloadTokens` on
   **every variant it writes**. Permanent, unrevokable, rules-bypassing. A prod
   check had already found 446 `photos/` objects carrying one.

Net: hard-deleting a lead left its whole photo set publicly fetchable forever,
with the only record of it gone.

Both shapes now reap. The flat legacy shape goes through a paginated
`/photos`-by-`leadId` sweep, because its variants live in the **uid-wide shared**
`photos/{uid}/_variants/` and can never be prefix-deleted — each name has to be
derived from the source filename.

**A second bug found on the way.** `docs/` was in
`scripts/sweep-orphan-lead-artifacts.js`'s prefix map but **never in the
trigger's**, so every hard delete since it was added handed that sweep a fresh
backlog instead of cleaning up after itself. The lockstep test missed it because
it only asserted *trigger ⊆ sweep*. It now asserts **both directions** — the
one-directional version was half a gate.

**Security shape.** Photo paths come off `/photos` docs, which are
client-written. The confinement check resolves owner uids from the **lead**,
never from the photo doc — otherwise anyone could plant a photos doc naming a
victim's object, hard-delete their own lead, and have the trigger delete
someone else's file with admin credentials. It lives in a new firebase-free
module (`functions/lead-artifact-paths.js`) so it is unit-testable with zero
mocking, **and** so it stays off the deployed function surface: `index.js` does
`Object.assign(exports, mod)`, and the `FUNCTIONS_INDEX` smoke assertion caught
the first cut putting test helpers in the deploy index.

### #1354 — every "are you sure?" was answering itself

`standalone-compat.js` runs **only** when the site is open from the home screen
(`if (!isStandalone) return;`) and replaces `window.confirm` with a stub that
toasts the message and unconditionally `return true;`. It fires on exactly one
platform: the phone the business is run from.

The worst of it was not a delete. `customer-photo-report-generator.js:191` used
`confirm` as a **two-way choice** — *"OK to EMAIL the report, Cancel to DOWNLOAD
only"* — so on the installed app, generating a photo report **silently emailed
it to the homeowner** every time, with no way to pick download.

The rest destroy data on a mis-tap: reset all products (the library is
localStorage-only — unrecoverable), reset company profile and estimate settings
(both company-wide), delete expense / supplier / template / pipeline stage /
deal room, rotate access codes, revoke portal links, the whole team tab, close
without saving, and the estimate builder's "resume your unsaved draft?" — which
auto-resumed a days-old draft into an estimate opened for a *different customer*.

**This was a half-finished fix, not a new one.** ~20 files already used the
idiom from `maps-routing.js:1016`, commented "Batch 2 (iOS PWA)". The sweep
stopped there and nobody recorded what was left. 31 sites across 19 files
finished it.

The adversarial pass caught one real defect in the work itself: making
`nbd-doc-viewer`'s `handleClose` async introduced **Escape re-entrancy**. Native
`confirm` froze the event loop so a second Escape could not arrive; `nbdConfirm`
does not, and `escHandler` stays attached until `close()` runs — now *after* the
await. Every Escape cancelled the guard and spawned a replacement behind it, so
Escape could never close a dirty document. Fixed with a `closing` latch.

**UPDATE, same session — the root cause is gone too (#1357).** The paragraph
that stood here said the patch had to stay, because it "cannot be fixed
synchronously" and flipping it to `return false` would turn every benign
confirm into a silent cancel. That framing accepted the patch's own premise.
The premise is false, and a 8-agent research pass established it:

- WebKit gates `alert`/`confirm`/`prompt` on exactly four things
  (`Source/WebCore/page/LocalDOMWindow.cpp`): no frame, an iframe sandboxed
  without `allow-modals`, no page, page dismissal. **None** is display-mode,
  `navigator.standalone`, or "web clip". There is no standalone rule to
  compensate for, and there is no sign there ever was one — `bugs.webkit.org`
  has ~28 open "Home Screen" bugs filed through 2026 and not one is about
  dialogs, and Apple's dedicated "Home Screen Web Apps" release-note section
  (live since Safari 16.4, and used for exactly this class of standalone-only
  defect) has never carried a dialog entry in either direction.
- **Every** suppression path resolves confirm to `false` — sandbox, unload,
  WKWebView's `APIUIClient` defaults, a backgrounded tab, the
  suppress-further-dialogs UI, and the still-unfixed `pushState`+back bug.
  `true` is the one value the platform cannot produce. The stub was not
  defending against the destructive-action problem; it *was* it.
- The stub's own comment gave the real motive away — "it's used synchronously
  in if-statements. We CANNOT make it async without rewriting call sites" —
  an async/sync mismatch with this file's own modal, not a platform limit.
  `_origConfirm` was captured and never called, which nobody does to a
  function they believe is dead.

So the `confirm` and `prompt` overrides are deleted. `alert` stays: it has no
return value, so it cannot answer for the user, and a toast beats a blocking
dialog on a phone. `prompt` went with `confirm` because it was the same defect,
live — it returned `defaultVal`, so `prompt('Rename estimate:', current)`
silently did nothing (`estimate-crm-ops.js:47`) and three "copy this link"
boxes never appeared.

Two corrections worth carrying, because both were mine:

1. **"Just delete the file" was wrong.** `createModal` and
   `nbdAlert`/`nbdConfirm`/`nbdPrompt` are defined INSIDE that file's
   standalone guard, so deleting it would have silently reverted all 61
   migrated call sites to raw native confirm. The adversarial pass caught it.
2. **The "~45 unmigrated sites" figure some agents reported is wrong.** Of 62
   `window.confirm(` occurrences, 61 are the `nbdConfirm || (...)` desktop
   fallback. Exactly **5** raw sites decide control flow, all benign.

Also: the gate is `navigator.standalone || matchMedia('(display-mode:
standalone)')`, so both stubs had been firing on installed **Android and
desktop** PWAs too, where no dialog bug was ever claimed.

The tripwire earned its keep. `pwa-confirm-guard.test.js` asserted the stub
still returned `true` specifically so that making it honest would go red and
force a revisit. It fired the same day it was written, and its assertions are
now flipped to keep the overrides dead.

### #1355 — the phone stops lying about where it is

`goTo()` writes `#/crm` **with a leading slash**, and two places parsed it as if
it did not.

- The bottom bar stripped only the `#`, compared `'/crm'` to the tab id `'crm'`,
  and so **lit nothing after any navigation**. Its `hash === ''` fallback was
  dead code (the `|| 'dash'` default meant hash was never `''`), so a cold load
  lit `dash` while the Home/Widgets view was on screen. Wrong in both
  directions. It also only ran from `renderBottomNav()`, so nothing re-synced it
  on a deep link, refresh, Back, or a tap through the More sheet.
- The `hashchange` handler sent an empty hash to `'dash'` while the boot sent the
  identical empty hash to `'home'`, so **Back landed on a screen the user never
  opened**.
- `billing-gate.js` called `goTo('billing')`, which is not a route, so the
  upgrade modal's CTA **dropped the user on the pipeline**.

One parser now: `routeFromHash()` in `dashboard-state.js`, used by both
`dashboard-main` entry points and the bar, which subscribes to `hashchange`.

A route with no tab of its own now lights **no** tab. Deliberate — highlighting
a tab the user is not on is what made the bar untrustworthy.

---

## Gate work — and proving each one can fail

The standing lesson from 2026-09-02 ("prove a gate can fail before trusting its
streak") was applied to every new assertion. **Nothing was trusted on a green
streak alone.**

| new gate | proven to fail by | result |
|---|---|---|
| reverse lockstep (sweep ⊆ trigger) | re-introducing the `docs` drift | red: `unreaped: docs` |
| forward lockstep (trigger ⊆ sweep) | removing `photos` from the sweep | red: `missing: photos` |
| variant drift guard | adding a 4th `xl` variant to `image-pipeline.js` | red |
| no-new-raw-`confirm()` | planting one in `tasks.js` | red |
| allowlist-not-stale | removing `maps-routing`'s allowed site | red |
| dead-route check | restoring `goTo('billing')` | red: *names a route that does not exist* |
| nav re-sync | removing the `hashchange` listener | red |

Every mutated file was restored byte-exactly (`git diff` empty) afterwards.

Three new suites, all registered in `tests/ci-manifest.json` (its completeness
check means an unregistered suite fails CI — a good gate):
`lead-photo-reaping.test.js` (41), `pwa-confirm-guard.test.js` (76),
`route-truth.test.js` (36). Node bucket 45 → 47 suites.

**A false positive worth recording.** The first cut of `pwa-confirm-guard`
read one line at a time and reported `referral-rewards-ui.js` as missing its
native fallback — the fallback was simply wrapped onto the next line. A
line-oriented check on a statement-oriented invariant will do that; it now reads
a 3-line window. It caught this on its own first run, which is the argument for
running a new gate before believing it.

---

## Method note — the recon paid for itself

Before touching anything, 8 candidate lanes were reconned by parallel read-only
agents, each report then handed to an adversarial verifier told to refute it
(17 agents, ~2.4M tokens). **Fourteen briefed or reconned claims were proven
false.** The full list is in [NEXT_SESSION-2026-09-04](NEXT_SESSION-2026-09-04.md)
§Corrections; the ones that would have cost the most time:

- The invoice pipeline **is not under `functions/`** and does **not** honour a
  cents invariant — it is `docs/pro/js/invoice-pipeline.js`, 1643 lines of float
  dollars. The briefed lane was aimed at a file that does not exist.
- `adjuster-board.js:55` and `ai-texting-stats.js:52` are **not** unbounded
  reads; both carry tenant equality plus a clamped date range.
- The dictation lane's premise that a provider seam already exists is **false** —
  `dictate.js` hardcodes one Deepgram helper. It is "build the seam", not "flip
  a switch".
- `openSettingsTab('billing')` would **not** have fixed the billing CTA: its
  first line calls `nbdPickerOpen`, so it always opens the theme picker.
- Opening the lead modal with `{static: true}` does **not** fix the backdrop
  wipe — a second direct listener at `crm-leads.js:165` bypasses nbd-modal's
  static guard entirely.

The first recon run was destroyed by an API capacity outage (all 10 agents died
on their final structured-output call after doing the reading). Retry-hardening
each agent with a 4-attempt loop was enough; the second run lost nothing.

---

## Worth knowing next time

- **`git status` lies about your cwd.** `cd tests && node smoke.test.js` persists
  the directory for every later Bash call in the session; two greps returned
  "no such file" for `functions/` before it was noticed. Use absolute paths, or
  `cd` at the top of each call.
- **`perl -0pi -e "s/…\n//"` silently no-ops on this checkout** — the files are
  CRLF, so `\n` never matches at a line end. It reported success and changed
  nothing, which briefly looked like a gate that could not fail. Match `\r?\n`.
- **Merging with `gh pr merge --delete-branch` errors on the local checkout step**
  (`fatal: 'main' is already used by worktree at nbd-wt-ledger-recon`). The
  merge itself succeeds — check `gh pr view --json state` before believing the
  error.
- **`gh pr checks <n>` returns empty for the first few seconds** after a push,
  so an `until [ "$(… | grep -c pending)" = "0" ]` loop exits immediately on a
  false green. Guard on non-empty output too.
