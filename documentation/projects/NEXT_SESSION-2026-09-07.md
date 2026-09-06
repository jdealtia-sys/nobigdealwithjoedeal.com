# NEXT SESSION — 2026-09-07

Prior session: [SESSION-2026-09-06-esign-rebuild](SESSION-2026-09-06-esign-rebuild.md) ·
evidence: [ESIGN-CRM-RECON-2026-09-06](../audit/ESIGN-CRM-RECON-2026-09-06.md)

Branch `esign-rebuild`, five commits, **not yet merged**. Rebased on
`origin/main` (`b3b92711`).

---

> **UPDATE 2026-09-06 — Instant Roofer lane opened** (after this brief was
> written): [SESSION-2026-09-06-instantroofer-adapter](SESSION-2026-09-06-instantroofer-adapter.md),
> runbook [INSTANTROOFER-SETUP](../runbooks/INSTANTROOFER-SETUP.md). Adds two
> items to Jo's queue below: set `INSTANTROOFER_API_KEY` (regenerate first)
> **before** merging the adapter PR so the merge deploy binds it, and
> configure the PDF webhook + `INSTANTROOFER_WEBHOOK_SECRET` before the first
> human-certified order. Found in passing and NOT fixed: `TURNSTILE_SECRET`
> is also the April stub, so public forms are IP-rate-limit-only.

## §0 — Jo's queue (nothing here is engineering)

1. **Try the new signing flow end to end.** Open any customer → Documents tab →
   **"Prepare for signature"** → upload a PDF → **Auto-detect fields** → adjust
   → Send. Then open the link on your phone as the homeowner would.
2. **Three switches that are worth more than the next three builds** — all
   merged code delivering nothing until you act:
   - `HEALTHCHECKS_PING_KEY` — holds no value, so all 25 cron heartbeats are
     no-ops. This is the difference between 25 monitored jobs and 25
     unmonitored ones.
   - `NBD_HAIL_PROVIDER=swdi` — keyless hail history, merged and dark.
   - The Google **Places** credentials — both are the `__unset__` stub, which
     is why the Google reviews are blank on every marketing page.
3. **A decision:** the old HTML signing path (`remote-signing.js`) still exists
   alongside the new one. Retiring it is a call, not a cleanup — see §3.

---

## §1 — What shipped, and the one thing to know

**Remote signing had never worked for anyone, and the documents it marked
signed contained no signature.** Three confirmed defects compounded:

- the signature canvas was **clipped out of the document** by a fixed-height
  container with `overflow:hidden` (print CSS restored it, which is why every
  artifact a rep looked at was fine);
- only **1 of 27** document types emitted a signable canvas;
- a document with **no** signature field submitted successfully — burning the
  token, stamping `signedRemotely: true`, and notifying the rep.

All three are fixed. On top of that, a **PDF-native envelope system** now
exists: upload any PDF → fields auto-proposed from the form's own text layer →
one single-use link → the signer pans/zooms a real PDF, signs (drawn or typed),
initials, dates, checks boxes → **a flattened signed PDF** comes back, with
consent, signer IP, user agent and both SHA-256 digests recorded.

### Files worth knowing

| file | role |
|---|---|
| `functions/esign-stamp.js` | pure stamping engine — PDF + fields + values → flattened PDF |
| `functions/esign-envelope.js` | 7 callables/endpoints, token model, audit trail |
| `docs/pro/esign.html` + `js/esign-sign.js` | the homeowner's signing surface |
| `docs/pro/esign-setup.html` + `js/esign-setup.js` | the rep's placement UI |
| `docs/pro/js/esign-autodetect.js` | proposes fields from the text layer (pure, unit-tested) |

### The one invariant not to break

**Fields are stored in PDF user-space points, not normalised fractions.** A
fraction of the *rendered* page is not a fraction of the *PDF* page once
`/Rotate` or `/CropBox` is involved — and scanned insurance forms routinely are
rotated. The client converts with `viewport.convertToPdfPoint`; the server
draws with **no transform**. `tests/esign-stamp.test.js` pins this on a
`/Rotate 90` page by rendering with the vendored pdf.js and checking where the
ink actually lands. If it ever goes red on the rotated page, the contract is
broken — do **not** widen the tolerance.

---

## §2 — Before merging

- **Deploy the rules.** `firestore.rules` (two new collections) and
  `storage.rules` (new PDF-only `esign/` prefix) both changed. The signer path
  reads Storage through the admin SDK, but `createEsignEnvelope` reads an
  object the **client** uploaded under the new prefix — so the Storage rule has
  to be live before the first real upload.
- **Deploy functions** — 7 new exports, verified to load as functions with no
  phantom function group.
- **`pdf-lib` is a new functions dependency.** The lockfile carries it and its
  four transitive deps **only**: 43 insertions, 0 deletions. A plain
  `npm install` on Windows/npm-11 additionally **strips every
  `"libc": ["glibc"]` constraint** from sharp's optional native packages —
  which is what stops npm resolving a musl binary onto the glibc runtime. If
  you ever re-run `npm install` in `functions/`, check `git diff` for
  disappearing `libc` blocks before committing.
- **Not verified against a real deploy.** Everything is proven locally
  (Chromium + the real stamping engine); no emulator or preview-channel run was
  done. First live envelope is the real test.

---

## §3 — Open decisions

**Retire `remote-signing.js`, or keep both?** It still signs generated HTML and
is what the doc generator is wired to; the envelope system accepts arbitrary
PDFs and is where the field model, audit trail and signer UX live. Keeping both
means two "Send for Signature" buttons with different capabilities. The clean
end state is generated docs → `renderPdf` → the envelope pipeline, one signing
surface. That is a real slice, not a rename.

**BoldSign is dead — delete it?** Deployed and called from `estimate-v2-ui.js`,
but both secrets are `__unset__` and the button is unreachable behind two gates.
No subscription, so no lock-in and nothing to save. Its tests are static source
regexes that pass whether or not it works.

**Old documents stay broken.** Docs generated before this branch carry the old
clipped CSS in their stored HTML, so anything already sent and unsigned is
still unsignable and must be regenerated. There is no migration.

---

## §4a — UPDATE 2026-09-06 (later the same day): the CRM lane is now half done

Jo asked for the CRM friction work immediately after the e-sign merge, so §4
below is **partly superseded**. Record:
[SESSION-2026-09-06-crm-friction](SESSION-2026-09-06-crm-friction.md), branch
`crm-friction`.

**Shipped** — all seven were silent failures that reported success:
every V2 estimate produced an **empty contract scope** and, from the same root
cause, warranty certificates **named GAF on TAMKO jobs** · a rep **could not
record a check** anywhere once the post-creation modal closed (and
`renderInvoicePanel` / `renderInvoiceList`, which carry the right buttons, are
mounted NOWHERE) · the customer page advanced stages with **no `stageRole`, no
activity note and no drip** · `crew_scheduled` needed **no date**, so the job
never reached the schedule · mobile `"+"` → Photo **captured a photo and threw
it away** · "Photo queued (offline)" was **read by nothing, ever** · the
notification poll **tore down its own live listener every two minutes**.

**Still open from §4** — and the reasons are in the session note's
§Deliberately NOT done, which is worth reading before picking one up:
`"＋ New Estimate"` (needs a customer-picker step, not a fallback global) ·
a **persistent** photo queue (`offline-manager.js` already contains a complete
IndexedDB one, never assigned to `window`, zero callers, not loaded on the
dashboard) · promoting the customer-page required-field warning to a real block
(needs the edit modal to gain the fields first) · the four hardcoded pipeline
ladders. *(`customer.html`'s eager loading and the three Cmd+K handlers were
closed the same evening — §4b.)*

The **integrations** half of §4 is untouched and its verdict stands.

## §4b — UPDATE 2026-09-06 (evening): the Weight items are closed and MERGED

Record: [BOOT-WEIGHT-2026-09-06](../audit/BOOT-WEIGHT-2026-09-06.md), with
corrections appended in place to the recon's §Weight. **Merged as `7251096f`
(#1419).** Branch, worktree and junctions all cleaned up.

**Shipped** — `customer.html` boot JS **1888.5 → 1395.0 KiB (−26%)**, −148 KiB
gzip, −4 requests, by moving the docgen cluster to the dashboard's existing
on-demand path · dashboard sheds **21.8 KiB / 4 sheets** of render-blocking
Leaflet CSS · ScriptLoader dedupes on the **resolved path**, ending the live
double-execution of `supplement-ui.js` (two tags in the DOM, proven in
Chromium) · `ui.js` stands down for the canonical Cmd+K palette · dead
`markLoaded` removed · 7 files' `?v=` cache-key drift unified.

**The one thing to know before touching this again**: of the recon's 656 KiB,
**only 498.7 was safe to move**. `profit-tracker`, the `supplement-ui` pair
and `photo-report` all render at load or win a name collision — lazy-loading
any of them blanks a live surface with **no error**. They stay eager on
purpose; the reasons are in the note. #1418's two photo-queue tags are eager
for the same class of reason (boot-time recovery has no user-intent trigger)
and are recorded as intended cost. The Leaflet CSS win is **first-paint, not
boot bytes**, on a default home view — `weather-radar` pulls the bundle
anyway.

**Still open from this lane**: the `generatePhotoReport` double assignment
(`customer-photo-report-generator.js` vs `photo-report.js` — the former is
dead on the customer page, 32.5 KiB fetched for nothing; untangling it is what
lets `photo-report` go lazy) · a re-entry sentinel for `supplement-ui.js` ·
the Sentry tracing → error-only bundle swap (needs an SRI hash made online).

### The mistake worth reading before you diagnose anything

I reported — in this brief, a vault note, a PR and a memory — that *"a stale
worktree copy silently reverted #1416."* **It was false, and it is retracted**
in the audit note. #1416 itself added the `setTimeout(600)` markPaid repaint;
**#1417 replaced it after this branch was cut**. My branch legitimately held
the older shape and my commit left that hunk byte-identical to its own parent.
I had diffed against an `origin/main` that had **moved**, and read "main went
forwards" as "my file went backwards."

A second session made the same error the same day, one PR number off. Root
cause is identical and worth internalising: **`main` moved four times on the
evening of 09-06** (#1418, #1419, #1420, #1421). A diff against a moving
target tells you nothing about your own tree until you know where the target
is:

```bash
git rev-list --left-right --count origin/main...HEAD   # left>0 = main moved
git log --oneline <your-base>..origin/main             # what landed
```
To ask *"did I revert something?"*, diff against **your own parent**, never a
remote: `git diff <commit>^ <commit> -- <file>`. Unchanged hunk = no revert.

**The hazard is real, though — it just arrives differently.** Any `git reset`
onto a moved `origin/main` (`--soft`, `--mixed`, or a rebase) leaves the
working tree holding your OLD copies of files your change never authored;
`git add -A` then stages them as deletions of someone else's merged work. It
caught both sessions for real. Screen every commit:

```bash
for f in $(git diff --name-only origin/main); do
  echo "-$(git diff origin/main -- "$f" | grep -cE '^-[^-]')  $f"; done
```
Every removed line must be one you wrote; `git checkout origin/main -- <file>`
anything else. This caught three files that would have reverted #1417.

### Two process notes

- **Jo, 2026-09-06: batch doc-only fixes.** Do not amend a green PR head to fix
  prose or a comment — it re-runs all 21 checks including the slow authed-E2E
  shards and destroys a green signal someone may be waiting on. Bundle doc
  fixes with the next code push. `gh pr edit --body-file` does **not** re-run
  CI and is the right tool when the correction only needs to reach a reviewer.
- **A pre-existing red to not chase**: `tests/e2e/stranger.spec.js:346` (the
  `waitForFunction` on `window._user.uid` after login) **fails on clean
  `main`** on this machine with the functions emulator on — proven by
  reverting the served files byte-for-byte and re-running (same timeout, same
  3 passed / 1 failed / 1 did not run; `:529` is its dependent). The dashboard
  *does* boot (header shows "Connected · N leads"), so it is `_user` plumbing
  timing, not a load failure. Separately, `stranger:194` and `gauntlet:284`
  need `,functions` in the emulator set or they fail behind the onboarding
  wizard's misleading "check your connection" alert.

## §4 — The two lanes I did not build

Both are mapped with cited, adversarially-verified findings in
[ESIGN-CRM-RECON-2026-09-06](../audit/ESIGN-CRM-RECON-2026-09-06.md). Start
there rather than re-deriving.

**CRM friction** — worst first, and none are cosmetic:
Invoice **Send / Mark Paid exist only in the modal shown right after
creation**, so payment cannot be recorded from anywhere else in the UI · the
doc pre-flight reads `est.lineItems` while V2 saves `rows`, so every contract
starts with an empty required scope (and warranty certs always claim GAF even
on a TAMKO job) · the **mobile photo offline queue is write-only** — every
"Photo queued (offline)" is a lie · mobile **"+ → Photo" throws the photo
away** · `crm-snooze.js` rebuilds a 50-doc Firestore listener every 120s ·
`customer.html` eagerly loads 653 KiB the dashboard proves is lazy-loadable.

Do **not** touch the kanban card face, `moveCard`, the field gate or the
context-menu triad — all singled out as working.

**Integrations** — the honest recommendation is mostly *don't*:
**no two-way Google Calendar** (the shipped `.ics` feed is ~90% of the value;
the gap it would close is the CRM-blind booking-conflict detector) and **no
Drive** (Drive is the human archive, Storage is the datastore). A live `gcloud`
check shows calendar, drive, sheets, gmail, vision, analyticsdata,
searchconsole and mybusiness are **all disabled** on the project, so every
Google integration starts from enable-and-verify.

The keyless calendar item actually worth doing is an **`.ics` reader** for busy
blocks — the repo has a serializer and no parser.

---

## §5 — Corrections to carry

- **The 2026-09-05 EOL fix (#1405) is real.** If `build-sitemap`,
  `build-feed` or `build-projects --check` look red, **check your base first** —
  this branch was cut from a stale `session-end` and all three went green on
  rebase. That memory note was right; the doubt was wrong.
- `crm-audit`'s `DUPLICATE_ID id="true"` WARN on `customer.html` is a **false
  positive** — it is matching `data-pass-customer-id="true"`.
- `syncGbpReviews` runs daily against a disabled API but is **not** "firing into
  a wall": it checks its secrets and returns early, so each run is a zero-cost
  no-op.
