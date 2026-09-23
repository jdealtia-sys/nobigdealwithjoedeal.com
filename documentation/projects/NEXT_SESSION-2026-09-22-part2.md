# Session handoff — 2026-09-22 (part 2)

## Status: 6 PRs, ALL MERGED AND LIVE. Three lanes, then three more.

> **Corrected at close-out.** Everything below §6 was written MID-SESSION, when
> #1717-#1720 were still open and the session looked finished. It then ran three
> more lanes. §7 is what actually happened after that point — read it before
> trusting any "open" claim above it.

Jo's ask: "kick off a new power session", then — mid-turn — *"We don't necessarily
have to continue where we left off. Especially if the work is heavily reliant on me.
I'm in the field right now using my phone NOT my PC."* Then "Word. Keep going."

So the whole session was chosen for **zero dependency on Jo**: a close-out audit of the
eleven PRs that merged earlier the same day, and finishing the email-unsubscribe lane.
GBP/Facebook posting was explicitly dropped — it needs his PC.

**Merge order (each retargets automatically):** #1717 → #1718 → #1719.

---

## 0. THE FINDING — a CI guard that an ungated commercial email sender walked straight past

`tests/email-unsubscribe.test.js` section G is the backstop that stops a new **commercial**
email sender shipping without the suppression gate. It read each file with a raw
`readFileSync` and grepped for `gateCommercialEmail(`, so the identifier only had to
appear *somewhere* in the file. **A comment counted.**

Mutation-verified before the fix: a new `functions/promo-blast.js` looping over
`resend.emails.send()`, classified `'commercial'` in `SEND_PATHS`, with no gate anywhere
and only `// TODO: call ... gateCommercialEmail( db, ... ) here one day` above it, ran
**87 passed / 0 failed**.

Fixed in **#1717**: comments stripped before either scan, plus a new assertion that the
gate must run **before** the send it guards (a gate bolted on afterwards reads as "gated"
to any grep and stops nothing). Three shapes now redden; clean tree 93 green.

Two things worth carrying forward:

- **The behavioural tests were NOT vacuous.** Disabling the real gate inside
  `funnel-recovery.js` reddened 6 assertions. The hole was specific to the grep backstop —
  which is exactly the guard that covers senders with no behavioural test yet, i.e. the
  newly added ones most likely to be wrong.
- **The first stripper over-stripped and that is how it got caught.** A character-level
  stripper that also removes string literals has to tell a regex literal from a division,
  and `/['"]/` in `functions/` opened a phantom string that swallowed **ten real send
  sites**. The companion `stale` check fired immediately. The shipped stripper is
  line-oriented and only cuts comments, so over-stripping always fails LOUDLY and can
  never produce a silent pass. Rule recorded in memory as
  `rule-grep-guards-must-strip-comments`.

---

## 1. What else the audit checked — and found clean

Stated explicitly because "audited and clean" is a result, and re-auditing it next week is
waste. Three of these were live hypotheses that checking disproved.

| Area | Verdict |
|---|---|
| Google sign-in (#1709) | Sound. Persistence-after-signin matches the established NEW-D25 pattern; `users/{uid}` rule is `allow read: if isOwner(uid)`, so a brand-new Google identity reads its own *missing* doc and reaches the friendly "no account" branch rather than permission-denied |
| `email_suppressions` rules (#1715) | Sound. `request.auth.token.get('companyId','')` (the absent-claim rule, correctly applied); the id-prefix check means a foreign tenant's `get` is denied whether or not the doc exists, so existence can't be probed |
| Close Board delete/sync race (#1711) | Sound. I chased a cross-user `setDoc(merge)` resurrection — not reachable: the hydrate query is `where('userId','==',uid)`, strictly per-rep, so a hydrated deal always carries the current uid and takes the `updateDoc` path |
| Map resize (#1714) | Sound. Every dashboard `resize` listener (fab-stack re-measure, `--vh` recalc, tour reposition) is something you'd *want* after a rail-width change |
| `?v=` cache-bust sweep (#1712) | Consistent — **0 of 199** versioned JS files referenced at two different `?v=` values |
| Chromium/puppeteer pair (#1705) | Properly gated. I suspected the real-package check was manual or CI-skipped; **both wrong** — `render-pdf-chromium-interop.test.js` is in the manifest's `smoke` bucket, CI installs functions deps, and section D asserts the real installed package's shape. It runs |
| Dead-code cleanup (#1713) | Sound. `loadSampleData` has exactly one surviving definition and it is in the call-registry allowlist, so the `data-fn` buttons still resolve |
| Credential claims (#1706/#1707) | Clean and matches `user-certifications` exactly. GAF Certified + TAMKO Pro Gold are the only `hasCredential` entries; James Hardie sits in `memberOf`; all three "Master Elite" mentions are correct (the guarantee page *explicitly* disclaims it — "it's ours, not a manufacturer program"); Owens Corning is honestly disclaimed in the comparison blog |

One cosmetic fix rode along in #1717: #1715 edited `script-loader.js` without bumping its
`?v=`. **No live impact** — `/pro/js/*` is `max-age=0, must-revalidate` and `pro/sw.js`
fetches JS with `cache: 'reload'`, so both layers force fresh — but the convention
shouldn't drift.

---

## 2. #1718 — the CAN-SPAM postal address, per tenant

The other half of CAN-SPAM. §7704(a)(5) requires a valid physical postal address in every
commercial email; #1715 shipped without one.

`tenantPostalAddress(db, companyId)` reads `companyProfile/{companyId}` →
`brand.contact.mailingAddress` and prints it under the unsubscribe link in both footers.
Set at **CRM → Settings → Company Profile → Mailing address**.

- **Per tenant, NO platform default.** A fallback would print one contractor's postal
  address in another's marketing mail. Unset → the footer renders byte-identically to
  before.
- **Separate from the existing "Address (one line)"** and deliberately not mirrored into
  it: that one is the public microsite + document letterhead, and a PO box on marketing
  mail with nothing on the letterhead is a legitimate combination.
- **Fails SOFT** while the suppression read beside it fails closed. An unreadable register
  throws (sending after "stop" is a legal violation); an unreadable `companyProfile`
  returns `''` and the mail still goes (failing closed = one bad read silently stops all
  commercial email).

**The leak shape survived my first mutation pass.** The existing "no address" test used a
*missing* profile doc, which returns early and never reaches the field read — so a
hardcoded `|| "PO Box 1, Goshen, OH"` passed 102/0. Two assertions added for a profile
that exists with a missing or blank address. A fifth mutation silently no-opped on an
`\n` needle against a CRLF file (the `String.replace` trap in CLAUDE.md); **every mutation
in this session now asserts it applied before running.**

---

## 3. #1719 — Resend bounce + spam complaints, DARK

`SOURCES` reserved `bounce` and `complaint` and nothing ever wrote them. Now
`functions/resend-webhook.js` does.

**How a bounce finds its tenant — this needed a design decision.** Resend's payload names
the **address**, never our **tenant**, and suppression is per tenant. `email_log` does not
store the Resend message id, so there is nothing to join on. So the send carries the
answer: every commercial send already mints an unsubscribe token, and
`gateCommercialEmail` now also returns it as a Resend **tag** (`nbd_unsub`). A 43-char
base64url token is exactly Resend's tag charset, so nothing needs encoding. The webhook
reads the tag → token doc → companyId + email + leadId.

Consequence, stated plainly: only commercial mail is tagged, so only commercial mail can
be bounce-suppressed. That is the right scope. An unattributable event is logged and
dropped, **never guessed at**.

**A transient bounce does not suppress.** Only `bounce.type === Permanent`, and a
*missing* type is not assumed permanent. Suppressing a full mailbox permanently cuts off
a real customer who did nothing.

Security posture mirrors `stripeWebhook`: unconfigured → 503 before parsing (the
`__unset__` stub refused too), `rawBody` mandatory, Svix HMAC hand-rolled in ~20 lines
rather than pulling the dependency, explicit 5-min tolerance, `timingSafeEqual`,
`create()` idempotency on `resend_events/{id}`, and a transient failure answers 503 **and
releases the claim** so the redelivery can proceed.

Six mutations, all caught. Smoke caught a real omission too: the export was undocumented
in `FUNCTIONS_INDEX.md`.

---

## 4. What needs Jo

- **Merge #1717 → #1718 → #1719.** All green, 22/22 checks each at time of writing.
- **The PO box.** Until the Mailing Address field is filled, commercial email ships with
  no postal address — exactly as before. #1718 removes the blocker; it does not close the
  gap.
- **Arm the Resend webhook** (only when he wants it): add
  `https://nobigdealwithjoedeal.com/hooks/resend` in the Resend dashboard for
  `email.bounced` + `email.complained`, and set `RESEND_WEBHOOK_SECRET`. The deploy
  auto-creates an `__unset__` stub, so **nothing breaks if he never does this.**
- **Eyeball the Mailing Address field** next time he's at his PC — it's in the auth-gated
  dashboard monolith, so it's test-verified, not browser-verified.
- Unchanged from the 9/22 handoff: the one human Google account-pick, GBP/Facebook
  posting (26 photos staged), `careers.html` W2/1099, the Meet-Joe video id, the
  fire-water-smoke FAQ, the Yelp claim, and the storm-report-email classification call.

---

## 5. Deliberately NOT done

**Moving the unsubscribe-token mint after `sendEmail`'s rate limiters.** The 9/22 handoff
listed it as a cost leak. It is — but the suppression gate has to stay **ahead** of the
limiters (#1667: the browser client answers a 429 by opening the rep's mail app with the
message filled in, so a 429 before the check hands an unsubscribed address to a
device-side send). Splitting check from mint is possible; the leak is one tiny doc on a
send that 429s, rare at 60/hr/IP and 200/day/uid. Not worth destabilising that ordering.
Reasoning is in the audit doc so it doesn't get "fixed" later.

---

## 6. Lessons worth keeping

- **A grep-based CI guard is vacuous until it strips comments and asserts order.** Both
  defeats were demonstrated, not theorised.
- **Assert that a mutation applied before trusting its result.** Two mutations this
  session silently no-opped — one on an `\n` needle against a CRLF file, one on shell
  backslash-eating. Both would have read as "the test caught nothing to fix."
- **Check the hypothesis before reporting it.** Three audit concerns (chromium test not in
  CI; chromium test skips in CI; cross-user deal resurrection) were all plausible and all
  wrong. Each took one command to disprove.
- **An over-strict guard that fails loudly beats a lenient one that passes silently** —
  pick the failure direction deliberately and say so in the comment.


---

## 7. What happened AFTER the brief above was written

Jo: *"Word. Keep going."* → finished the audit → built the Resend webhook →
*"You can do both the first and third thing"* (merge + arm the webhook) →
*"Let’s switch lanes"* → three more lanes, all chosen for zero dependency on him.

### Merged and live

| PR | What |
|---|---|
| #1717 | the vacuous sender-registry guard |
| #1718 | CAN-SPAM postal address, per tenant |
| #1719 | Resend bounce/complaint sync (DARK) |
| #1720 | the brief above |
| #1721 | `nav-responsive-fix v3` extracted — 173 pages, ~151 KB of HTML |
| #1722 | #12-guard rules coverage + the SMS-outbox close-out audit |

#1717-#1720 landed as ONE merge commit (`00bfe2a4`) and #1721+#1722 as another,
deliberately: `firebase-deploy` has `cancel-in-progress: false`, so merging them
separately queues serialized ~9-minute deploys AND risks an older tree’s deploy
running last and reverting the newer one’s hosting content. #1721 touches 172
HTML files, so that hazard was live. **#1718/#1719 and #1721/#1722 show as
CLOSED, not merged** — GitHub only relabels the PR the merge event names. Each
carries a comment saying so; their commits are all on `main`.

### The Resend webhook is LIVE and inert — prod-verified

`POST /hooks/resend` unsigned → **503** `{"error":"Webhook not configured"}`. A
FORGED signature → 503 too (the secret check runs before signature verification,
so unconfigured it never even parses). Uncached `GET` → 405.
`RESEND_WEBHOOK_SECRET` exists with 1 enabled version — the `__unset__` stub the
deploy’s `defineSecret` discovery creates automatically.

**Arming it is two Jo steps and nothing breaks if he never does them:** add the
endpoint in the Resend dashboard (`email.bounced` + `email.complained`), then
replace that stub secret. Claude deliberately did NOT move the signing secret —
copying a live `whsec_…` into Secret Manager is credential handling.

**A 404 on that endpoint is probably YOUR OWN cached request.** Curling it during
the hosting-first window (before the functions half deploys) caches a 404 at the
edge for 600s. POST is never cached, so the tell is **POST works, GET 404s**. Add
`?cb=$RANDOM` before hunting for a shadowing rewrite — that cost a detour.

### Lane: CSS dedup slice 4 (#1721)

173 pages carried `nav-responsive-fix v3` byte-identically; 172 migrated to a
linked sheet, **−3440/+376 lines**. Re-measured first, because this lane’s own
history has an estimate that was wrong by 16×. Verified by **315 real
computed-style comparisons, zero differences**. Full detail in WEEKLY_CADENCE
item 10, slice 4.

### Lane: rules coverage (#1722)

The **#12 guard** (member stamps `companyId = own-uid` to hide a doc from their
boss’s rollups) shipped on 12 collections in August with assertions on only one.
All 12 + `/reps` now covered. **Two corrections worth not re-deriving:**
`myCompanyId()` reading the claim BARE is *not* a live bug (Firestore absorbs an
erroring `||` operand — probed directly, solo creates are allowed), and `/reps`
needs an unseeded uid because the setup already seeds `reps/alice`.

### Lane: SMS outbox audit (#1722) — CLEAN

1,650 lines, never audited, three-round landing history. **No defects**, and its
tests are non-vacuous (3 safety mutations each redden the suite). Written up at
`documentation/audit/SMS-OUTBOX-2026-09-22.md` so nobody pays for it twice.

### The thread across the whole day

**Four separate checks passed vacuously** — a grep guard satisfied by a comment,
a before/after harness comparing pages that had never changed, and two mutations
that silently no-opped (one on a CRLF needle, one on shell escaping). Every one
read as success. Before reporting "verified", make the check go red on purpose.

### Still open for Jo (unchanged)

The PO box • arming the Resend webhook • one human Google account-pick •
GBP/Facebook posting (26 photos staged) • `careers.html` W2/1099 • the Meet-Joe
video id • the fire-water-smoke FAQ • the Yelp claim • the storm-report-email
classification call.
