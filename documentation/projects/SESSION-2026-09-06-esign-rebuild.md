# Session 2026-09-06 — e-sign: it never worked, and now it does something better

Jo's ask had three lanes: make the CRM sleeker and lower-friction, link
calendar / Drive / email "within reason", and **make e-sign work and feel
frictionless** — explicitly modelled on a friend's system (upload a file → get
a URL key → the signer zooms and pans the doc, taps a signature button and an
initials button), but "nicer": *we* choose the boxes and what type goes where,
and it fits the space automatically or with the rep setting it up.

E-sign turned out not to be a polish job. **Remote signing had never worked for
anyone, and the documents it marked signed contained no signature.** That
became the session.

Related: [audit note on the recon](../audit/ESIGN-CRM-RECON-2026-09-06.md) ·
[handoff](NEXT_SESSION-2026-09-07.md)

---

## 1. What the recon found

A 20-agent recon (10 lenses, each with an adversarial verifier that re-opened
the cited files to refute it) produced **171 findings — 112 confirmed, 57
partly, 2 refuted**. The e-sign ones compound into a single failure.

### The three that matter

**a. The signature canvas was clipped out of every document.**
`.document-container` was `height: 11in` + `overflow: hidden`, with
`.document-content` `overflow: hidden` inside it, and `renderContract` emits
the signature block LAST. Measured in Chromium on the real generated contract:
at 375px the block sits at y=1733 in a container ending at y=1122, with
`document.scrollHeight` 1142 — clipped, with nothing to scroll to. Same at
1280px. `@media print` overrode the height with `auto`, so **print and PDF
output were complete** — which is exactly why this survived: every artifact a
rep ever looked at was fine.

**b. Only 1 of 27 document types could be signed at all.**
`renderSignatureBlock` only emits the interactive canvas when a signer entry is
an OBJECT. `renderContract` passed `data.signers` through; `proposal` and
`inspectionHomeowner` seeded `defaultSigners` — so the "Send for Signature"
button appeared — but passed hardcoded STRING arrays. Both produced a document
with nothing to sign. The other 24 templates use a local `sigBlock()` helper
that never emits a canvas.

**c. A document with no signature field "signed" successfully.**
The widget's `finalize()` reported `ok:true` over an empty pad list, and
`submitSignature` never checked a signature existed. So the single-use token
burned, the document was stamped `signedRemotely: true`, and the rep was
notified "Document signed" — **an executed-contract record containing zero
signatures**. Given (b), every non-contract type sent for signature did exactly
that.

### Other confirmed e-sign findings

- The `visibleText` tamper gate accepts CSS-only tampering (hiding a clause,
  `::after` injected text), an injected `<script>`, arbitrary payloads inside
  signature blocks, and outright deletion of the signature block.
- Docs generated on `nobigdeal-pro.web.app` or localhost bake that origin into
  the widget's script URL and are **permanently unsignable** — CSP blocks it
  and the page says "still loading" forever.
- Expired and revoked links both told the homeowner "✅ Already signed".
- No resend path at all: the link could only be sent from the doc-viewer
  overlay immediately after generation.
- The rep could never see whether a link was delivered, opened, expired or
  revoked.
- No ESIGN/UETA evidence: no signer IP, no user agent, no consent record, and
  no copy delivered to the signer.
- Saved-signature reuse lets a rep stamp a real homeowner's signature onto a
  document the homeowner never saw.
- `htmlPath` is never confined to the lead's own prefix in `remote-signing.js`,
  though `document-view.js` guards exactly this.
- Hard-deleting a lead destroys the entire executed-contract record.
- **A rep could not upload an arbitrary file and send it for signature.** No
  path existed. There is no field-coordinate model anywhere.

### The second e-sign system

BoldSign (`functions/integrations/esign.js`) **is** exported and deployed, and
`estimate-v2-ui.js` really does call it — but both its secrets are the literal
`__unset__` deploy stub, and the button is unreachable for every user behind
two independent gates. There is no subscription, so there is nothing to save
and no lock-in. Its own header documents an HTML→PDF step that does not exist
in the file, and its signature fields are hardcoded to page 1 at fixed
coordinates. Every test guarding it is a static source regex, so the suite
stays green whether or not the integration works.

---

## 2. What shipped

Five commits on `esign-rebuild`.

### PR-a — stop the bleeding (`fix(esign)`)

- `min-height` + `overflow: visible` on the container and its content child.
  The paper look is unchanged; the box grows instead of amputating.
- `proposal` and `inspectionHomeowner` now pass `data.signers` through exactly
  as `renderContract` does. The legacy string branch is untouched, so the other
  24 types keep their static ink lines.
- Zero-signature submissions refused in the widget AND in `submitSignature`,
  because the browser doing the finalizing is the counterparty's. The server
  refuses **before the burn**, and reports `noFields` (our bug — do not tell
  the signer to retry something that cannot succeed) separately from
  `unsigned`.

### PR-b — the stamping engine (`functions/esign-stamp.js`)

Pure: source PDF + field layout + values in, flattened PDF out. No Firebase, no
I/O.

**Coordinates are PDF user-space points, not normalised fractions.** A fraction
of the *rendered* page is not a fraction of the *PDF* page once `/Rotate` or
`/CropBox` is involved — and scanned insurance forms and manufacturer
warranties routinely are rotated. pdf.js exposes the exact inverse
(`viewport.convertToPdfPoint`), so the placement UI converts at capture time
and the server draws with no transform.

Values are burned into the page content stream, not added as AcroForm widgets —
nothing left to un-fill or re-render differently in another viewer.

### PR-c — the signing surface (`/pro/esign.html`, 6 functions)

`createEsignEnvelope` · `saveEsignFields` · `getEsignEnvelopeForOwner` ·
`sendEsignEnvelope` · `voidEsignEnvelope` · `getEsignEnvelope` ·
`submitEsignEnvelope`.

Sits **alongside** `remote-signing.js`, which still signs generated HTML and is
what the doc generator is wired to. Retiring that is a separate decision.

Signer experience: pdf.js renders real pages with pan and pinch-zoom,
**re-rendering at scale** so text stays sharp at 300% instead of scaling a
bitmap. Signatures drawn or typed. "Next field" walks the signer through what
is blank. Dates prefill to today. Errors inline, not `alert()`. Consent is a
gate, not a logged checkbox.

Signature PNGs are **transparent and trimmed to the ink**. The old widget baked
a white background in — invisible on white HTML, an opaque white sticker when
stamped onto a form — and an untrimmed pad renders tiny inside its box.

### PR-d — placement + auto-detect (`/pro/esign-setup.html`)

`docs/pro/js/esign-autodetect.js` reads the text layer and proposes fields: a
run of underscores (or a vector rule) is an explicit "write here" AND gives the
width the author intended; a nearby caption — Signature / Initials / Date /
Print Name / a lone X — **types** that line rather than adding a second
overlapping box.

Tuned to **under-propose**: a missed field costs one drag; a spurious field on
a live contract asks a homeowner to fill in something that does not exist.

### PR-e — the entry point

"Prepare for signature" on the customer Documents tab. A feature nothing links
to does not exist.

---

## 3. Two real bugs the tests caught

Both found by driving the pages, not by reasoning about them.

**`align-items: center` made the left of a zoomed page unreachable.** A page
wider than its scroll container overflows on both sides and `scrollLeft` cannot
go below 0. Measured at 156% zoom: canvas at `x=-318` with `scrollLeft` already
0 — the left edge could be neither seen nor tapped. Now `safe center`. This was
in the **shared** stylesheet, so it was breaking the homeowner's page too, on
the exact gesture the rebuild exists to provide.

**A tap placed a field with null coordinates.** `defaultSize(tool) * scale`
multiplies an OBJECT → `NaN`; `NaN < 4` is false so the size floor let it
through. The guard now checks `Number.isFinite`, not just a floor.

A third was caught on the signer page's first run: a class setting `display`
outranks the `[hidden]` attribute, so both bottom sheets sat invisible over the
document swallowing every tap.

---

## 4. Gates

Five suites, every one **proven able to fail before being trusted**:

| suite | assertions | proof it can fail |
|---|---|---|
| `esign-signature-reachable` | 14 | restoring the old CSS → 6 red, exact geometry reproduced |
| `esign-stamp` | 13 | offsetting the stamp 200pt → 6 red, incl. the blank-region control |
| `esign-signer-flow` | 27 | caught the `[hidden]` bug on first run |
| `esign-setup-placement` | 13 | caught both bugs in §3 |
| `esign-autodetect` | 25 | negative cases are the important half |
| `signature-document-integrity` | 27 (+6 new) | new section covers the server gate |

`esign-stamp` renders with **the vendored pdf.js build we actually ship** and
asserts ink lands inside the rectangle `convertToViewportPoint` predicts, with
a control region asserting an unstamped area stays blank — so a uniformly dark
render cannot pass. The rotated page is the case that matters.

`esign-signer-flow` feeds what the page POSTs through the REAL stamping engine.
Testing the UI and the stamper separately would leave exactly the contract
between them untested — and that contract is where a signing system silently
produces a blank contract.

---

## 5. Lockfile note worth carrying

Adding `pdf-lib` with a plain `npm install` on Windows/npm-11 **also strips
every `"libc": ["glibc"]` constraint** from sharp's optional native packages.
Those constraints are what stop npm resolving a musl binary onto the glibc
Cloud Functions runtime, so that drift is not cosmetic. Reverted and spliced
the five pdf-lib entries in by hand: **43 insertions, 0 deletions**, all 12
glibc constraints verified intact.

Also: the branch was initially cut from a stale `session-end`, which made the
sitemap/feed/projects gates look red. They are green on `origin/main` — the
2026-09-05 EOL fix (#1405) is real. **Rebase before believing those three
gates.**

---

## 6. Not done — carried to the handoff

The other two lanes. The recon produced ranked, cited lists for both; nothing
was built.

**CRM friction** — the confirmed high-severity items are in the
[audit note](../audit/ESIGN-CRM-RECON-2026-09-06.md). The worst are not
cosmetic: Invoice Send / Mark Paid exist **only** in the modal shown right
after creation, so payment cannot be recorded from anywhere else in the UI; the
doc pre-flight reads `est.lineItems` while V2 estimates save `rows`, so every
contract starts with an empty required scope; and the mobile photo queue is
write-only — every "Photo queued (offline)" is a lie.

**Integrations** — the honest recommendation is **do not build two-way Google
Calendar or Drive**, and it is argued in the handoff. Live `gcloud` check:
calendar, drive, sheets, gmail, vision, analyticsdata, searchconsole and
mybusiness APIs are **all disabled** on `nobigdeal-pro`. `syncGbpReviews` has
been running daily against a disabled API since 2026-07-13.
