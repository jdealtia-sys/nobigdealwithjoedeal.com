# Grokbot brief verification — 2026-09-13

Jo spent an hour with Grokbot (a Grok Build agent) auditing the public site
from the outside and got a 16-section brand/focus brief ("No Big Deal —
Brand, Website & Focus Audit"). This note records what survived checking it
against the tree and the live site, what did not, and two findings the brief
could not have seen from outside. The execution plan that came out of it is
[NEXT_SESSION-2026-09-13](../projects/NEXT_SESSION-2026-09-13.md).

**How this was built, and how far to trust it.** Read on branch
`fix/gbb-tier-followups` @ `4def98a6` (main had not moved). Inline checks by
the orchestrator (grep/read of `docs/`, `firebase.json`, `functions/`,
`site-src/partials`, plus `curl` of the live apex, `www.`, and
`/api/google-reviews`), then a 16-agent read-only workflow: 8 fact-check
agents over the claims not settled inline, 5 skeptic agents told to refute
the decision-driving clusters, 3 planners. **Refuters overturned 0 verdicts
and narrowed 1** (the Cal.com phone-location claim, see §3). Nothing in the
tree was changed. Claims marked ⚠︎ rest on external state and were not
re-checked here.

---

## 1. Verdict in one paragraph

The brief is directionally right and factually wrong in roughly a quarter of
its specific claims, which is what an outside-in crawl produces. Its strategic
calls (local roofing is the company, Pro stays on this domain, cut the
homepage, reviews are the bottleneck, put Joe on camera, one conversion path)
match conclusions this vault had already reached. Seven of its factual claims
are false or stale. Two of the largest problems on the site are ones it could
not see: the Google-reviews widget has never rendered on any of the 17 pages
carrying it, and the Cal.com webhook reads the phone from a field Cal.com's
payload does not carry.

## 2. Claim-by-claim

### Agreed, with evidence

| Brief | Verdict | Evidence |
|---|---|---|
| Local roofing is the company; Pro is a tool; no second domain this quarter (§1, §7) | Agree | [PULSERELATE-RECON-AND-PRO-DOMAIN-2026-09-07](PULSERELATE-RECON-AND-PRO-DOMAIN-2026-09-07.md) §3 answered "don't buy one yet" a week earlier, with a sharper reason: `/pro` holds homeowner-facing surfaces (portal, esign, estimate-view), so a split would route homeowners onto the SaaS domain to sign contracts. |
| Homepage is an encyclopedia (§3, §9) | Agree | `docs/index.html`: 17 `<section>`s, 31 `/areas/*` links + hub, 9 Lexington mentions, two shingle universes (TAMKO band `:1118-1156`, GAF rows in the hero card `:944-961`), a 7-row us-vs-them table `:1301-1362`, a third pass at GAF/TAMKO/Hardie logos `:1863`. |
| Kill "Half the Price. Twice as Close." (§6, §8) | Agree | `docs/index.html:1305`. `docs/about.html:687-712` already carries the same comparison in better voice. |
| "lifetime on every install" walks back the Pledge (§6) | Agree | `docs/index.html:1274`, `docs/privacy.html:633`, and a "5yr" stat at `:1402` labelled "NBD Lifetime Pledge". The Pledge page states the negative case three times (`the-pledge/index.html:453,:529,:40`). |
| Grammar slip (§6) | Agree | `docs/index.html:1264` "I come out personally, gets on the roof"; also `:1411` "Number of people who answers the phone". Service pages use the third person correctly. |
| Solo-vs-crew contradiction (§6) | Agree in substance | "don't subcontract" on ~20 service/city pages; "My crew" on `services/siding-replacement.html`, two city roof-replacement pages, `our-work.html`; H2 "It's Just Me. That's the Point." at `docs/index.html:1395`; "My own crews" at `:1328`. The brief's quoted strings do not exist (see §2.3). |
| `/sites/free-guide` leaks homeowner chrome (§6, §7) | Agree | Hand-inlined, no partial markers: free-roof announcement bar `:845-847`, homeowner nav with a `/pro` link `:849-882`, 26-link drawer (Pledge, Guarantee, Build, LumaNail, Roofivent, Pivot Boot) `:885-917`, homeowner footer `:1078-1086`. The drawer's own CTA mis-targets `/#contact` (`:916`). Extra gap: noindex is meta-only; every sibling `/sites` surface also carries an `X-Robots-Tag` header (`firebase.json:204-236`). |
| "500+ contractors" / "$2M" / "5 years testing" unverifiable (§6, §11) | Agree | `docs/sites/free-guide/index.html:924,:953,:1041,:1072` and `:1019`. |
| Reviews are the bottleneck; GBP is channel #1 (§5) | Agree, and worse | See §3.1. |
| Joe on camera (§5) | Agree; nothing to build | `docs/index.html:1364` `#intro-video data-yt=""` is a hidden YouTube facade; `docs/assets/js/intro-video.js` un-hides it on an 11-character ID. |
| One conversion path (§5, §9) | Agree | Public forms took one submission in 30 days; 13 public leads in all history ([NEXT_SESSION-2026-09-09](../projects/NEXT_SESSION-2026-09-09.md) §1). |
| Freeze Pro features, Lexington, new city pages, blog volume for 90 days (§8) | Agree for the window | — |
| Review SMS on completion (§5, §14) | Agree | Ops, not site. |
| No contractor testimonials on `/pro` (§6) | True, and deliberate | `docs/pro/index.html:1697-1715`: invented testimonials were removed 2026-07-04; the page says so at `:1711`. ~40 lines of dead `.testimonial*` CSS remain at `:736-770`. |
| Published price ranges (§4) | True | $665–$745/sq traces to the estimator's `asphalt.better` band; `docs/blog/how-much-does-roof-cost-cincinnati-2026.html:624` says $650–$750 (drift). |
| ~27 blog posts (§4) | True | 28 on disk; `field-notes-joes-notebook-goes-public.html` is a full 71 KB post that is noindexed and absent from the index, feed and sitemap. Decision, not a silent 28th post. |

### Disagreed

| Brief | My position |
|---|---|
| Zero Pro links on homeowner pages (§7, §11 rule 1) | Keep exactly one low-visibility door per footer. "Same house, two doors" needs a door; [DESIGNER-AUDIT-VERIFICATION-2026-08-15](DESIGNER-AUDIT-VERIFICATION-2026-08-15.md) and the PulseRelate note both ruled it a designed posture; `tests/marketing-polish-contract.test.js:331-338` pins its wording. The second, louder "NBD Pro ↗" item in `site-src/partials/footer-extended.html:43` (18 pages) is the one to remove. **Jo agreed 2026-09-13.** |
| Oaks: "noindex, password, or take down" (§7) | Already done: `X-Robots-Tag` on `/sites/oaks/**` (`firebase.json:211-221`), `robots.txt` Disallow, own 404 via rewrite, sole inbound link from a noindexed page. |
| Canonicalize www → apex (§6, §11 rule 7) | Already true. `curl -L https://www.nobigdealwithjoedeal.com/` follows one 301 to the apex; both bodies have md5 `86bf85b7…`. |
| Don't lead with "5-Star Rated" until the count survives a glance (§9) | Half agree. 28 reviews at 5.0 survives a glance; the site cannot show it. Fix the secrets and hydrate the homepage from the widget's existing hooks. |
| Estimate tool is "a helper" (§5) | `/estimate` measures the roof (Instant Roofer) and prices three tiers from real squares. It stays a primary path beside Book and Call. |
| Fire & water, roof cleaning as "homepage pillars" (§6) | Chrome-only links (nav `:820`, drawer `:866`); zero body content. |
| "7-tool grid" on the homepage (§3, §8) | The body band (`:1285`) is 4 tools; the seven-tool set lives in chrome (dropdown, drawer, footer). |

### False or stale

| Brief | Reality |
|---|---|
| `www.` shows April-era copy | 301 to apex, byte-identical. |
| Homepage does not link to `/pro` | Deliberate footer door at `docs/index.html:1990` ("THE SILENT PRO DOOR"); 218 pages via four footer partials. |
| Pro pricing shows only Free + Enterprise | Five priced tiers as cards on `/pro` (`:1727-1802`) and `/pro/pricing` (`:125-218`), in the meta description and FAQPage JSON-LD. |
| Roadmap items sold as features ("send texts from your own number") | Inverted: `docs/pro/index.html:1400` is a disclaimer that it is NOT available, added by the 09-08 claims audit. Real "coming soon" copy is on `/pro/how-to` (`:1009`, `:1014-1023`). |
| "It's just me" vs "my own crews" quotes | Neither string exists; see the crew row above. |
| "no pressure, no door knockers" | "door knockers" appears nowhere. |
| CRM/SEO posts on the homeowner `/blog` | None. Rule, not fix. |
| `/our-work` "150+ documented projects" | The page says "150+ Projects Completed" as a hand-authored hero stat (`docs/our-work.html:388`, outside the generated regions); 45 projects are documented in `projects.json`. Unbacked, but "documented" was the brief's word. PR #1519 is rebuilding `/our-work`; do not touch there. |
| ⚠︎ Yelp 2 reviews, Instagram captions | Unverifiable from the repo. |

## 3. What the brief could not see

### 3.1 The reviews widget has never rendered

`curl https://nobigdealwithjoedeal.com/api/google-reviews` →
`{"rating":0,"total":0,"reviews":[],"empty":true}`. `GOOGLE_PLACES_API_KEY`
and `NBD_PLACE_ID` are the 2026-04-21 `__unset__` stub; open PR #1518
documents 140 days dead and 4,017 error lines that were all this one
background. 17 pages load `docs/assets/js/google-reviews-widget.js`
(homepage, `/review`, 15 service pages) and all render the "Read our reviews
on Google" fallback. Meanwhile GBP holds **5.0★, 28 reviews** as of
2026-08-31 ([POSTING-LOG](../marketing/POSTING-LOG.md):53,106), and the
homepage asserts 5-star **five times statically** (`:908,:1001,:1520,:1522,
:1818`) with no hydration hooks; the `[data-nbd-gr-rating]` /
`[data-nbd-gr-count]` hooks exist only on `docs/review.html:510,:513`. The
runbook `functions/google-reviews.README.md` points at the legacy Places API;
the code needs "Places API (New)". PR #1518's conflict is two doc hunks only.

### 3.2 The Cal.com webhook cannot capture a phone even when required

`functions/integrations/calcom.js:152,:176` read the phone from
`attendees[0].phoneNumber` only, and the address from `payload.location`
(`:183`). Cal.com's documented `BOOKING_CREATED` payload carries the phone
booking question at `responses.attendeePhoneNumber` and an in-person address
at `responses.location.value.optionValue`. There is no `payload.responses`
access anywhere in `functions/`, no fixture or captured payload in the repo,
and no Cal.com API key (only `CALCOM_WEBHOOK_SECRET`). Six event types are
linked from the site (roof-inspection ×277, gutter-siding-estimate ×61,
roof-inspection-lexington ×19, roof-question-call, adjuster-meeting,
estimate-walkthrough; `/book` links all six). Jo's real case, an organic
gutter+siding lead that arrived email-only, almost certainly came through
gutter-siding-estimate, whose booking form does not require a phone — and
the webhook would have dropped the phone even if it had.
**Refuter correction:** the "phone-call event types put the number in the
location" claim is documented for roof-question-call only
([CALCOM-INTEGRATION-2026-08-25](CALCOM-INTEGRATION-2026-08-25.md):41);
estimate-walkthrough's Cal.com config appears nowhere in the repo.

### 3.3 First-party forms — the audit table

| Surface | Client phone gate | Server kind → required | Turnstile key |
|---|---|---|---|
| `index.html` contact | first name + phone, non-empty (`inline/72f02d79d0.js:142-148`) | contact: firstName, phone | yes |
| `estimate.html` | 10-digit, three gates (`inline/4053149b2f.js:657,:785,:887`) | estimate: address only | yes |
| `storm-alerts.html` | HTML `required` + JS (`< 10`) | storm: name, phone, zip | yes |
| `sites/free-guide` | name + email, **no phone field by design** | guide: name, email | yes |
| `inspect.html` | **none** (`novalidate`, `inspect-form.js` posts blind; server 400 "Invalid submission" drops the lead; no honeypot, no TCPA consent → `no_stored_consent`) | inspect: name, phone, address | no |
| `storm-report` / `storm-check` / `roof-score` | 10-digit via JS only (`< 10`, no HTML fallback) | inspect | no |
| `free-roof` | HTML `required` only | free_roof: nomineeName, phone, address, story | no |
| `sites/t` (tenant template) | truthiness only (`site.js:135`) | contact | no |

Turnstile blast radius is ~178 surfaces, not "6 of 10": `docs/assets/js/quick-lead-form.js:21-30` lazily injects the lead client on all 171 `/areas/*` pages, none keyed. `tests/turnstile-contract.test.js` hardcodes the four keyed pages, and its parity assertion (`:85-100`) is now a no-op because the key ships populated (docblock `:8-10` still says "EMPTY"). `public-lead-submit.js:87` calls `render()` on every submit instead of `reset()`.

### 3.4 Favicons and manifests (Jo's housekeeping ask)

286 HTML pages: 259 use `/favicon.svg` (the homeowner roof mark), including
every `docs/pro/*.html` except `photo-review.html`, which is the only page
using `/pro/favicon.svg` (the "NBD PRO" text mark). 23 pro pages use
`/pro/img/nbd-icon-192.png` as apple-touch-icon (same mark as the pro SVG);
218 pages use `/assets/images/apple-touch-icon.png`. 14 pages carry no icon
at all: `admin/*.html` ×6, `pro/{esign,esign-setup,refer,sign}.html`,
`sites/index.html`, `sites/oaks/404.html`, `tools/index.html`, and the Google
site-verification stub (which must never be edited). No partial carries a
`<head>` fragment, so favicons are hand-inlined per page and
`scripts/apply-partials.js` cannot be the vehicle. No test pins a per-page
favicon href (`tests/marketing-polish-contract.test.js:96-114` only checks
the two SVGs are real markup). `docs/manifest.json` (root) is a Pro-branded
orphan with scope `/` and `start_url /pro/dashboard.html`, linked by no page;
`tests/pwa-manifest.test.js:52` reads it unguarded. `scripts/ensure-icon-css.js`
hardcodes `\n` at `:60` and must not be cloned for a CRLF tree.

### 3.5 Smaller findings worth a line each

- "Sunday available" in visible copy on 20 pages; no Sunday in any `openingHoursSpecification`.
- `docs/index.html:1467` says "View All 25+ Cities" under a list of 31.
- `docs/pro/leaderboard.html:10-11` comment claims the root manifest is the marketing-site manifest; it never was.
- [DESIGN-CONSISTENCY-SWEEP-2026-08-19](DESIGN-CONSISTENCY-SWEEP-2026-08-19.md) row 64 ("portal flies the contractor app icon") described the pre-#1467 favicon and is superseded; rows 74/76 are already fixed.
- [DESIGNER-AUDIT-VERIFICATION-2026-08-15](DESIGNER-AUDIT-VERIFICATION-2026-08-15.md):86-90 says free-guide's only inbound link is the deleted `/pro/landing`; it now has 23 inbound hrefs from 7 `/pro` surfaces, all contractor-side. Correct posture, stale sentence.
- `documentation/architecture/SHARED-PARTIALS-SYSTEM.md:127-128` lists free-guide as a partial cohort to convert while two exemption registries (`check-chrome-governance.js:56`, `migrate-nav-to-partial.js:57`) say the opposite.
- `documentation/audit/WAVE2-IMPLEMENTATION-MAPS-2026-09-05.md:716` cites `CALCOM_WEBHOOK_SECRET` at `_shared.js:57`; it is at `:62`.

## 4. Grok / Grokbot as a working tool — the honest ROI

What is installed: **Grok Build CLI** v0.2.103 (`~/.grok/bin/grok.exe`,
model grok-4.5, 500k context). Headless mode exists (`grok -p "<prompt>"
--output-format json --json-schema … --tools read_file,grep,list_dir
--permission-mode plan --max-turns N --worktree`); `grok inspect` shows it
already reads this repo's `CLAUDE.md` and `.claude/settings.local.json`
permissions; it ships explore/plan subagents and supports MCP. Its session
token expired 2026-07-19 and it has been used three times ever. The Grok Bot
desktop installer (0.47.0) is in Downloads and is not installed anywhere
standard.

- **Moderate ROI in one slot:** an independent, read-only refuter with
  structured output. This vault records single-model blind spots repeatedly
  (77 findings filed as refuted unchecked, 09-04; zero-refutation passes,
  09-08; a brief a third stale in two days, 09-09). Today's brief is the
  demonstration: it caught the free-guide leak, the grammar slip, the
  half-price claim and the sprawl, while asserting seven false facts. That is
  the profile of a good refuter and a bad source of truth.
- **Near-zero ROI** as a second builder in this tree (shared checkout, CRLF
  traps, 21 CI gates, vault rules) or as a computer-use bot (overlaps the
  computer-use and Chrome MCPs; one desktop, no parallelism; the GUI tasks
  that matter are account-settings changes that need Jo's per-action
  approval whichever agent clicks).
- **Recommendation:** a one-hour pilot. `grok login`, then a `refute-grok`
  step in the verify stage of one review workflow, called from a Node
  wrapper with `--prompt-file` (cmd.exe quoting). Keep it if it flips at
  least one verdict Claude's refuters missed in the first two runs; drop it
  otherwise. Never as a builder subagent.

## 5. Decisions Jo made on 2026-09-13

- Six homeowner-facing pages under `/pro` (portal, estimate-view,
  photo-review, sign, esign, refer) wear the **homeowner roof mark**; every
  other `docs/pro/**` page wears NBD PRO.
- **Keep one silent Pro door per footer**; delete the "NBD Pro ↗" item in
  `footer-extended.html:43`.
- **Cal.com flip is done in a live session**: Claude drives Jo's logged-in
  Chrome, Jo approves each Save.
- **Full homepage cut** as specified in the handoff (copy fix → isolation →
  structural cut with reviews rebuild and visual re-bless).
