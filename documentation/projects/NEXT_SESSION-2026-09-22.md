# Session handoff — 2026-09-22

## Status: 11 PRs merged and live. Google sign-in is ON. Email unsubscribe exists for the first time.

Jo's ask: "kick off a new power session", then "CRM works for me", then
"keep going". Three lanes ran: dependency hygiene + a site-coverage audit,
the Google sign-in finish, and a CRM residual/compliance batch.

**Every memory pointer was stale at session start.** `power-session-2026-09-18-part5`
still listed the Google COOP branch and outbox #1675 as open; both had closed on
9/21. First action of any session: `ls -t documentation/projects/` and
`gh pr list --state merged`, then trust the newest handoff — not memory.

---

## 0. THE THING THAT MATTERS MOST — Google sign-in works now, except one human click

`admin/v2 defaultSupportedIdpConfigs/google.com` is **`enabled: true`** (Claude
enabled it in Jo's Chrome, 2026-09-22, with Jo's go-ahead). The consent screen
was already External + In production. Public-facing name set to **NBD Pro**
(was `project-717435841570`, which reads as phishing in the account picker).

**Proof the old failure is gone, server-side:** `accounts:createAuthUri` with
`providerId: google.com` — the exact call that returned 400 `OPERATION_NOT_ALLOWED`
on every attempt since the project was created — now returns an
`accounts.google.com` URL, and requesting that URL 302s to Google's sign-in
identifier page (no `redirect_uri_mismatch`, no `invalid_client`). The auth
handler returns 200 and `/pro/register` + `/pro/login` both serve
`Cross-Origin-Opener-Policy: same-origin-allow-popups`.

**What is NOT done: one real human account-pick.** The popup is a separate
browser window the Chrome extension cannot drive, and the redirect fallback
stalls on the extension's own site-permission prompt when Jo is away from the
machine. Jo does this: `/pro/login` → Continue with Google → pick the Google
account for **jd@nobigdealwithjoedeal.com** (that is the account Chrome's CRM
session runs as — NOT `jdeal.tia@gmail.com`, and NOT `jonathandeal459@gmail.com`,
which has no CRM account and would provision an empty tenant from `/pro/register`).

Cosmetic follow-up: OAuth **branding is unverified**, so the picker says
"continue to nobigdeal-pro.firebaseapp.com" instead of NBD Pro. Separate Google
review process; does not block sign-in.

### `/pro/login` now has its own Google button (#1709)

Sign-in only, by design: an unknown Google identity is **signed back out** with
"No NBD Pro account is linked to that Google account yet" + a Create-account
link. It writes no `users/{uid}`, never calls `createCompany`, never provisions —
so a mis-click can't mint an empty tenant, and invited reps can't self-provision
around their invite. The Firebase Auth user record still exists after such a
sign-in; that is accepted and commented in code.

**Side effect worth knowing:** the login page now initializes App Check (it
never did), so email/password sign-in also sends an App Check header now.
Verified safe: `identitytoolkit` AND `firestore` App Check enforcement are both
**UNENFORCED** on this project (checked via the firebaseappcheck API, 9/22), so
a failed token cannot lock anyone out. `/pro/login`'s CSP gained the reCAPTCHA
hosts register already had.

---

## 1. Merged this session (all live)

| PR | What |
|---|---|
| #1697 | dependabot non-major group, 19 server packages (safe-on-green per the triage rule) |
| #1705 | **chromium 149→153 + puppeteer-core 25.1.0→25.11.0 as a matched pair** — superseded dependabot #1698 (chromium-only) |
| #1707 | interior repair covers leak damage; United Restore correction (below) |
| #1706 | **new `/services/commercial-roofing`** + undersold-copy fixes + Hardie = membership, not certification |
| #1708 | Interior Repair Estimate cal.com event, wired into the site + `/book` + the CRM catalog |
| #1709 | Continue with Google on `/pro/login` |
| #1710 | comms opt-out residuals: refusal is final; AI-draft path records Twilio 21610 |
| #1711 | lead restore reports the real outcome; a deleted deal can't be resurrected by a late sync |
| #1712 | `?v=` cache-bust sweep for the deferred 9/18 bumps (254 refs across 19 files) |
| #1713 | 9/18 cleanup: dead dashboard code, the `loadSampleData` twin, tighter re-export smoke pins |
| #1714 | collapsing the sidebar actually resizes the maps |
| #1715 | **email unsubscribe** — per-tenant suppression, one-click List-Unsubscribe, commercial sends gated |

---

## 2. The dependency trap that nearly shipped, and the verification rule that changed

Dependabot #1698 offered `@sparticuz/chromium` 149→**153** alone. `puppeteer-core`
25.1.0 pins Chrome **149**. Static CI cannot see that mismatch; server PDF
rendering would have found it. Closed #1698; shipped #1705 with the matched pair
(both **Chromium 153.0.8010.36**, both exact-pinned so neither floats across a
Chrome major alone).

**The rule that changed.** The cross-session note on this coupled pair claimed the
148→149 bump was "verified". It was not: 149 went ESM-only, `require()` returned
the module namespace, `chromium.executablePath` read undefined, and **100% of
server renders failed for ~11 weeks** before `resolveChromium()` fixed it. The
old Windows verification trick only proved the puppeteer↔Chrome protocol
coupling — it never `require()`d the package. So #1705's verification
additionally ran render-pdf.js's own `resolveChromium` against the real package
(extract the function from source, normalize CRLF first) and asserted
`executablePath` is a function and `args` is an array. Do this every cycle.

**Prod-verified 2026-09-22 16:53Z:** `renderPdf` called from Jo's Chrome
dashboard rendered a warranty (totalMs 6422); `metrics/renderPdf` okCount 4→5.
Recipe for a quick prod proof is in the memory note.

---

## 3. Site truth corrections — Jo's answers are load-bearing

A read-only coverage audit found commercial roofing had **no page at all** and
interior repair was missing from every homepage surface. Jo's answers, 9/22:

| Question | Answer | Consequence |
|---|---|---|
| Commercial scope? | **Full commercial** — EPDM/TPO flat + low-slope, apartment complexes, small-business buildings, his own roofing crew | New `/services/commercial-roofing`; "light commercial" (roof-repair FAQ) and "assessments and coordinate with the appropriate crews" (Blue Ash) were **undersell**, now corrected |
| Interior crew scope? | **Also leak-damaged drywall + ceilings**, not just cosmetic cracks | interior-repair page widened; 39 storm/roof-repair city pages cross-link it |
| United Restore? | **Big mitigation only** — dry-out, mold, fire/smoke cleanup | "United Restore handles the interior. I handle the exterior." was FALSE; rewritten everywhere it appeared |
| James Hardie Alliance? | **A group he belongs to, NOT a certification** | Removed from `hasCredential`; `memberOf` stays; badge now "alliance member"; the certification FAQ names GAF + TAMKO only |

Do not relitigate these. Full record: the PR bodies for #1706 and #1707
and `documentation/audit/EMAIL-UNSUBSCRIBE-2026-09-22.md` for the comms half.

`"It's Just Me, Joe."` on all 25 area pages: Jo said keep doing what we've been
doing. Left as is.

---

## 4. Email unsubscribe (#1715) — the compliance gap nobody had noticed

Before this PR the platform had **no email opt-out of any kind** while sending
automated homeowner email. CAN-SPAM requires a working unsubscribe on commercial
mail.

- Register: `email_suppressions/{companyId}__{sha256(email)}` — per tenant, so one
  contractor's unsubscribe never blocks another's. Opaque 256-bit tokens in
  `email_unsub_tokens` (no secret needed, no raw email in doc ids).
- `/unsubscribe/<token>` (onRequest behind a hosting rewrite): **GET renders a
  confirm page and writes nothing** (link scanners prefetch GET), POST and RFC
  8058 one-click record it, unknown tokens get a neutral page. Live-verified
  after deploy: a made-up token returns the "This link isn't valid" page.
- `sendEmail` → 403 `unsubscribed`, or **503 `suppression_unverified` if the
  register can't be read** (fail closed). Category defaults to **commercial**
  when a caller doesn't say.
- **Which automated senders actually email homeowners: only `funnel-recovery`
  and `lead-followup`** (both now gated). `anniversary-touch`, `dormant-leads`,
  `review-request-nudge` and `storm-watch` email the CONTRACTOR — a brief that
  assumed otherwise was corrected by the agent, correctly.
- A sender REGISTRY test fails if new email-sending code is unclassified or a
  commercial sender skips the gate. Keep that green rather than routing around it.

**Still open on this lane:** the CAN-SPAM **postal address** is not in the footer —
Jo chose "get a PO box first" (his home address stays private; the warehouse is
Goshen, schema-locality only, see the 2026-08-18 schema decision (addressLocality stays Goshen)). When
it arrives, add a per-tenant `companyProfile` mailing-address field — do not
hardcode NBD's. Also open: `kind` is client-asserted (insider misuse only);
unsubscribe tokens are minted before `sendEmail`'s rate limits (small cost leak);
Resend's own bounce/complaint list isn't synced; the storm-report email is
classified transactional but carries an inspection pitch — **Jo's call**.

---

## 5. Smaller, still open

- **GBP/Facebook posting** — 26 photos staged at `C:\Users\jonat\NBD-GBP-photos-2026-09-21\`,
  9 posts written. Unchanged from the 9/21 handoff; nothing posted.
- **`careers.html`** — W2 / 1099 / not-open decision still Jo's; page stays parked.
- **"Meet Joe" video** — one YouTube id away (`docs/index.html` `data-yt=""`).
- **`services/fire-water-smoke-damage.html`** — still the only service page with
  no FAQ; blocked on five truthful Q&As from Jo.
- **Yelp claim** — Jo personally.
- **Interior-repair booking** now points at the new `interior-repair-estimate`
  event (#1708). The cal.com catalog is Claude-managed now: Jo said create/edit
  it and **confirm after, don't ask first** (recorded in session memory).

---

## 6. Lessons worth keeping

- **A memory pointer is a claim about the past, not state.** Three sessions had
  shipped past this one's "current" note. Re-read the repo's newest handoff first.
- **A green dependabot PR on a static-CI repo proves compile-time only.** For a
  coupled pair, verify the coupling you actually depend on — including the
  *module shape* the consumer code reads, not just the wire protocol.
- **Classify before you gate.** The email lane's brief named four automated
  senders as homeowner-facing; two were, and the agent checked rather than
  trusting the brief. The same check turned "block email after an SMS STOP" into
  the narrower, correct rule: a refusal is final for *that action*, and an SMS
  STOP is not an email unsubscribe.
- **Windows EOL discipline is not optional.** A `sed -i` version bump flipped
  `dashboard.html` to LF-only (CLAUDE.md warns about exactly this); caught with
  `git ls-files --eol` and redone with an EOL-aware Node edit.
- **A dead handle is silent.** `window.mainMap` / `window.d2dMap` were never set —
  classic-script top-level `let`s never become window properties — so two
  sidebar-collapse handlers had been calling `invalidateSize` on `undefined`
  since they were written. Bare `typeof`-guarded names, plus one `resize` event
  for maps that live in private state.
