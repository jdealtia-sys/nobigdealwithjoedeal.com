# Session 2026-09-08 — the portal preview, and what fixing it uncovered

Jo: *"the preview doesn't load right now it's broken"* — plus *"I really do want
to keep growing out the full customer portal features, abilities, and improve
the page overall."*

Four PRs, all opened from separate branches so they merge independently:

| PR | Branch | What |
|---|---|---|
| [#1491](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1491) | `fix/portal-preview-framing` | the preview, its telemetry sibling, and two dead-end error states |
| [#1493](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1493) | `fix/portal-share-recording` | the customer page's own share buttons never recorded the share |
| [#1495](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1495) | `feat/portal-scope-link` | the homeowner can finally see what they are paying for |
| this note | `docs/session-2026-09-08-portal-preview` | the write-up |

---

## 1. The preview had never worked, and the code blamed the visitor

Two independent faults. **Fixing either one alone still leaves it broken**,
which is why a header-only or client-only fix would have looked like a fix and
not been one.

**a. Our own headers refused the embed.** `/pro/portal` inherited the global
`**` rule's `X-Frame-Options: DENY` and `frame-ancestors 'none'`. Only
`/pro/ai-tree`, `/pro/understand`, `/pro/project-codex` and `/pro/analytics`
carry a framing override. Confirmed by fetching **production's real headers**,
not by reading `firebase.json` — the standing rule from the 08-20 handoff.

**b. The block-detector was inverted in both directions.** It was written when
`resolveUrl` returned a cross-origin Firebase Storage `getDownloadURL`, and
reasoned: *a readable `contentWindow` means a privacy shield injected a block
page*. `resolveUrl` now mints a **same-origin** `/pro/portal.html?token=…` and
returns nothing else.

The second direction is the one that matters and it corrected my own first
account to Jo. Measured against production: **a refused frame is opaque in
Chrome**, so `contentWindow` access threw, the throw scored as a healthy
cross-origin load, and the overlay was **hidden over an empty frame**. The
symptom was therefore a blank white panel — *not* the shield warning the modal
ships. The detector dismissed its own explanation. The footer copy
("Preview blank? Privacy shields may block the embed") existed because
somebody had seen the blank panel and guessed wrong about why.

Detection is positive now: `portal.html` ships `<main id="mainWrap">` in static
markup, which separates the real portal from `about:blank`, a shield's injected
page, and a redirect. An expired token still renders `#mainWrap` and the
portal's own error state — **counted as success on purpose**, because a rep
previewing a dead link needs to see what the homeowner would see.

### Things that were checked rather than assumed

- **The CSP was derived, not copied.** `/pro/portal`'s policy is the *global*
  policy with only `frame-ancestors` flipped. Copying the AI TOOLS policy — the
  obvious move — would have silently narrowed `img-src`/`connect-src` and
  dropped the portal's imagery hosts (`wayback.maptiles.arcgis.com`,
  `kygisserver.ky.gov`, `spc.noaa.gov`). A suite asserts the two stay equal
  modulo framing, so tightening the global policy later reddens instead of
  leaving the portal on a stale copy.
- **Report-Only was overridden too.** `/pro/ai-tree` still ships an enforced
  `frame-ancestors 'self'` beside a Report-Only `'none'` — they contradict each
  other on every dashboard embed. Worth cleaning separately.
- **The `.html` → canonical 301 does not block framing**, and the token
  survives it. Verified in a real browser on a preview channel by framing both
  URL forms, rather than reasoning about whether browsers apply framing policy
  to redirect hops.
- **The whole modal was driven end-to-end** on the channel with only the token
  minter stubbed: overlay hidden, `#mainWrap` present, no error toast.
- **Swept for the same gap elsewhere** — only the four AI TOOLS embeds, all
  already covered.

### ⚠️ The portal cannot be verified on a preview channel

`getHomeownerPortalView` allowlists the **production origin only**. The channel
origin gets a 204 preflight with no `access-control-allow-origin`, so the
browser blocks it and the portal renders its error state. Framing and rendering
*can* be proved on a channel; **anything portal-data-related cannot**. That is
a real hole in this repo's own "prove it on a preview channel" rule and nobody
had hit it before.

---

## 2. The sibling that fixing #1 would have activated

With the embed refused, `portal.js` never ran inside the modal, so it never
emitted the homeowner's audit events. **Fix the framing and every preview click
starts emitting them.**

The cost is not a wrong count. `estimate_view` fires a Firestore trigger
(`functions/fresh-view-logic.js`) that pushes the rep an `estimate_viewed`
notification — the real-time buying-intent signal — and it de-dupes per lead
over a window. So a rep previewing their own link would be told their customer
was reading the estimate **right now**, and the genuine open minutes later would
be swallowed as a duplicate. *A false positive that suppresses the true signal
is worse than no signal.*

Framing is the discriminator: `frame-ancestors 'self'` means only our own CRM
can embed the page, and a homeowner opening a texted link is never framed. A
throw on `window.top` can only mean framed, so it counts as framed rather than
falling through to emitting.

**The unframed rep paths were already broken and are not a regression from this
PR**: "Open ↗" and `customer.html`'s 👁 button have opened the real portal *as
if the homeowner had* since they shipped. Both now carry `?preview=1`. The
modal tags one binding once, before building any markup, so the iframe and both
Open anchors cannot drift apart — the same shape whose absence caused the
[#1458 regression](SESSION-2026-09-07-customer-portal-defects.md).

Sharing paths are deliberately untagged. Tagging copy/SMS/email would stop
recording every genuine homeowner visit — the opposite failure, and worse.

---

## 3. Two dead ends that told the homeowner to wait for something that never comes

`getHomeownerPortalView` has five terminal outcomes. The page rendered specific
copy for two and sent the rest to *"Please try again in a moment."*

| Status | Means | Was |
|---|---|---|
| 410 | expired | ✅ specific |
| 404 | revoked / wrong | ✅ specific |
| **400** | **link arrived truncated** | ❌ "try again in a moment" |
| **429** | **replay cap exhausted** | ❌ "try again in a moment" |

Both wrong cases are dead ends, and both are reachable in ordinary use. SMS and
email clients wrap and clip long URLs, and the token guard
(`/^[A-Za-z0-9]{10,64}$/`) rejects the remainder. Tokens are minted with
**`maxUses: 100`** against a 30-day TTL and only genuine opens count (polls are
exempt), so a homeowner checking progress a few times a day during an active job
reaches the cap inside a month — and is then told to wait, forever, with no hint
to call their rep. The rep is never told either.

Status codes were **verified against the live endpoint**: a 19-character token
returns 400, a 64-character unknown one returns 404.

The two 429s need **opposite advice** — the per-IP limiter (30/min) really does
clear, the replay cap never does — and status alone cannot separate them.
`Retry-After` would, but it is not CORS-exposed to the portal's origin. So the
endpoint now returns a stable `code` and the page keys off that, falling back to
the status so it stays correct against a backend that has not been redeployed.
A code-less 429 stays transient, because it may be the limiter.

Scoped deliberately: **the other six portal endpoints still carry the bare
guard.** Uniform codes there are a follow-up.

---

## 4. The customer page's own share buttons never recorded the share

`portal-link-helpers.js` states the rule in its export block: *"Every share
entry point must reach this function or downstream features … silently see zero
signal."* **Three of the four controls in `customer-gallery-share.js` did not**
— including the two primary buttons, Copy Portal Link and Text Portal Link.

They resolve through `PortalLinkHelpers.resolveUrl`, which deliberately does not
record (only `copyForLead`/`smsForLead` do), and these handlers reimplement
those flows rather than calling them so they can drive their own button-label
states. Every other surface records: `dashboard-api.js:517`,
`dashboard-actions.js:1518`, `job-templates-ui.js:1983`.

So a rep works the deal from the customer page, texts the homeowner a working
link, and the CRM goes on insisting it was never sent — smart-followup keeps
saying "send portal link", the lead never leaves the stale-shares views, and the
"last shared" chip *on that same page* stays empty.

**The recon named two paths. The third — `copyPortalUrl`, the share panel's own
copy button — came from enumerating every link-producing control in the file
rather than fixing the two that were pointed at.** `quickEmailPortalLink` was
already correct (it delegates wholly to `emailForLead`, which records) and
`quickPreviewPortalLink` correctly records nothing, because a rep looking is not
a share. Both are now pinned by assertions.

**Also removed a legacy-link resurrection in the same function.** The
`PortalLinkHelpers`-absent fallback preferred a persisted `lead.portalUrl` over
minting — the permanent, **unrevocable** Firebase Storage URLs the token
migration retired, which `revokePortalToken` has never been able to touch. That
path could still put one in front of a homeowner, and revoking the lead's access
would silently do nothing.

---

## 5. Growth: the homeowner can now see what they are paying for

The portal's answer to *"what am I paying for?"* was one 36px orange number and
a status pill, with the signature iframe as the very next card.

`/pro/estimate-view.html` is a complete, deployed, cost-redacted line-item
viewer — every line with quantity and retail total, the measurements, the tier
cards — and the portal referenced it **exactly zero times**. Rep-side surfaces
link to it; the customer never could. The
"features exist but are unmounted" pattern again.

No new credential: `getEstimateForView` takes the same portal token and refuses
an `estimateId` whose `leadId` does not match the token's.

**The half that makes the link worth having:** `getEstimateForView` returned an
*empty scope* for any estimate whose lines live in `est.lineItems` rather than
`est.rows` — `buildDisplayRows` reads only `est.rows`, so estimate-view fell
through to "Detailed line items will be reviewed in person." The CRM's own PDF
export already had this fallback, so **a rep could export a full scope and share
a link showing none, for the same document.** Reachable with no legacy data: Log
Estimate writes no rows, and saving the scope back from doc pre-flight writes
`lineItems`.

The fallback routes through `buildDocLineItems`, the shared three-shape reader
whose docstring records that *a fourth private copy of that math is what leaked
the cost basis to homeowners in the first place*. Gated on an empty ladder AND a
present `lineItems`: used unconditionally, a per-SQ doc would gain a synthetic
summary line duplicating the tier card. `catalog-cost-privacy` re-run green
(126/126), and the new path is asserted to emit exactly
name/quantity/unit/lineTotal.

---

## The recon, and why its clean sweep is not trustworthy

A 120-agent workflow (9 defect lanes + 4 opportunity lanes, tiered adversarial
refuters) **hit the session rate limit partway through**: 40 agents died,
including *all three* verify passes for the preview, portal-defects and
portal-ux lanes, and the `security` recon entirely.

**27 survivors, 13 unverified, 0 refuted.** Zero refutations here is a warning
sign, not a strength — the 2026-09-04 workflow lesson (dead verifiers are not refutations) and the
verify-cap lesson are both about exactly this. The script did
file dead-verifier findings as `unverified` rather than scoring them as
refutations, which is the one thing the 09-04 run got wrong. But three survivors
were adjudicated on a **single** live vote.

**So the top cluster was spot-checked by hand**, and that is what §4 above rests
on — not the agents' say-so.

### Unverified — leads, not refutations

Every verifier for these died. Four of the five preview ones were independently
confirmed by hand during the fix; the rest are still open:

- rep preview fires the homeowner's telemetry → **confirmed and fixed** (§2)
- probe inverted in both directions → **confirmed and fixed** (§1)
- header rule must be canonical and must override Report-Only → **confirmed;
  both done** (§1)
- **every preview click mints a real 30-day / 100-use homeowner credential, and
  nothing bounds, distinguishes or reaps them** — still open
- the preview iframe's sandbox strips capabilities the portal's nested
  third-party frames (BoldSign, Cal.com) need — still open
- a revoked link never stops the 30s poll; the `finally` re-arms the timer the
  410/404 branch just cleared
- "Next up" describes the milestone that has **not** happened in the completed
  past tense
- the photo-upload input is camera-only (`capture="environment"`), so a
  homeowner cannot send a photo they already took
- a failed message whose text repeats an earlier one is silently deleted by the
  optimistic-send dedup
- **every portal card is clipped 39–149px off the right edge of every phone**,
  and the overflow cannot be scrolled to
- the 09-07 `--accent → --nbd-orange-cta` contrast fix **was a no-op because the
  two tokens are the same colour**
- printing the portal for an insurance adjuster yields 6 pages, two of them
  blank iframe boxes

### Survivors worth the next session (3 votes each unless noted)

- homeowner photo uploads become **broken image tiles after ~7 days**
- **portal views are never recorded**, so the CRM permanently says "waiting for
  the customer to open it"
- a tenant **custom stage with role Won** makes the portal claim the roof is
  done, and the rating card renders but its submission errors
- the **warranty certificate names NBD on other tenants' certificates**, and is
  dated one day early off `lead.scheduledDate` (the *scheduled*, not actual, date)
- the homeowner's own upload is announced back to them as *"new photo from your
  rep"*
- the 30s poll destroys an **in-flight photo upload** — the same shape as the
  signature guard added on 09-07, one branch over
- a before/after slider script that fails to load burns a **200ms timer for the
  life of the tab**, re-armed on every repaint

### Growth shortlist — all four lanes converged

Three of the top five are **mounting code that already exists**:

1. ~~link the estimate card to the itemized scope~~ — **done, PR #1495**
2. **ship `lead.scheduledDate` to the portal** — CI-required to reach Crew
   Scheduled, and the portal never sees it. "Crew arrives Tuesday, September 16"
   instead of a bar. (S)
3. documents shelf — contract, completion cert, warranty, permits (L)
4. balance due / pay (M)
5. **`/share/<token>`** — `shareSSR` is deployed with **zero producers**, so
   texted links unfurl as bare URLs that read like spam (S)

---

## Lessons this session paid for

- **An absence assertion matched my own explanatory comment — three times.**
  Once in each new suite. The 09-07 note already warned about this; it is
  sharper than it reads, because the comment explaining *why a string was
  removed* necessarily contains that string. All suites now strip comments
  **line-wise**, each with a guard that the stripper did not eat the code (a
  block-comment stripper destroys 10–48% of these files — regex literals).
- **A crashed suite is not a vacuous guard.** One break-test deleted 1,683
  characters instead of two lines; the harness saw no `✗` and reported "the
  guard did nothing". Break-test harnesses must check for the summary line, not
  just the absence of failures.
- **`[a-z_]+` could not see a code containing a digit**, so a cross-file
  contract check passed vacuously. Found only by asking *which* assertion
  reddened, not whether one did.
- **`sed -i` on a single file still flips its EOLs.** CLAUDE.md warns about
  globs; one file is enough. Caught by `git ls-files --eol` showing `w/lf`,
  reverted, redone with the Edit tool.
- **Backslashes still do not survive the Bash tool** — a heredoc-inlined Node
  patch mangled a regex into literal newlines. Scratchpad scripts must be
  written with the Write tool.
- **Manifest floors: SET, never increment.** Three branches each raised them;
  whichever merges last must re-measure rather than add its delta to another
  branch's number.

## Still open, deliberately

- the other six portal endpoints have no error `code`
- rep-initiated `estimate_view` still writes a server-side activity record; the
  client `?preview=1` tag cannot suppress that, and pretending otherwise would
  be worse than the gap
- `/pro/ai-tree`'s enforced-vs-Report-Only `frame-ancestors` contradiction
- the preview-channel CORS hole above
