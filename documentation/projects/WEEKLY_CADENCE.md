# Weekly Cadence — the Monday-morning note

> **Standing note — open this every week** (created 2026-08-10, consolidated
> from the local-SEO playbook, MANUAL-FOR-JO, and the session handoffs; those
> stay the source docs, this is the working checklist). Sessions: keep this
> note current — when a one-off below gets done, check it off here AND note it
> in the next session handoff; when a new recurring task appears, add it here.
>
> How to use in Obsidian: duplicate the "This week" block into your daily
> note, or just check boxes here and un-check them Monday.

---

## This week — Jo (≈45 min total, phone is fine)

### Content & marketing (the highest-leverage 30 minutes — [playbook](../marketing/local-seo-playbook-2026-07.md))

- [ ] **1 GBP post** (Tue/Wed morning). Rotate: seasonal/storm tip → finished-job
      photo → offer/proof. Four ready-to-paste drafts live in the
      [citation kit](../marketing/citation-kit-2026-07.md). Attach 1–3 real job
      photos; button = "Call now" or link `/inspect`.
- [ ] **2–3 job photos → GBP** with the town in the caption ("Roof replacement
      in Mason, OH") — same shots the /our-work pipeline uses.
- [ ] **Post completed jobs to the site** — paste the phone template from
      [PUBLISH-PROJECT](../runbooks/PUBLISH-PROJECT.md) into a Claude session,
      one per job. It lands on /our-work AND the matching service page strip
      (labeled by service — roof repair vs replacement, siding, gutters,
      storm). Siding/gutter/repair strips are running on empty-state CTAs
      until you feed them — the first siding job you post lights that page up.
- [ ] **Review asks**: at every completed job ask in person, then text the `/r`
      QR link same-day (CRM texting panel). Steady 2–4/month beats bursts.
- [ ] **Reply to every new review within 48h** — including old ones and bad
      ones; response rate is a ranking input and sales copy.
- [ ] **One citation claim** (until the list is done): follow the sequenced
      sprint in [rush-week-2026-08](../marketing/rush-week-2026-08.md) with the
      exact NAP block from [citation-kit](../marketing/citation-kit-2026-07.md).
      Day 1–2 first: GAF locator, TAMKO Pro Gold locator, James Hardie, Bing
      Places + Bing Webmaster Tools, Apple. Then append each live profile URL
      to the site's `sameAs` (procedure in the rush-week doc).
- [ ] **Search Console glance**: impressions/clicks on "roof repair covington",
      "roofing companies mason oh", the shingle-comparison cluster.

### Site & prod watch (5 min, until each gate clears)

- [ ] **Prod deprecation log**: zero `[estimates.js DEPRECATED]
      startNewEstimateOriginal` warns = classic-wizard deletion gate
      ([BIG_ROCKS](BIG_ROCKS.md) Rock 2). A `calcTierPrices` hit only means a
      rep reopened a pre-V2 doc.
- [ ] **`/cspReport` sink skim** (Cloud Logging) — STEP 0 of the
      [CSP generated-docs audit](../../docs/dev/csp-generated-docs-audit.md).

## This week — agent session (kick one off and paste this list)

- [x] Run the cheap drift gates and report:
      `apply-partials --check --diff` · `build-projects.mjs --check` ·
      `build-sitemap.js` (dry-run) · `check-site-integrity --quiet` ·
      `check-inline-html-scripts` · `marketing-polish-contract.test.js`
      *(2026-08-10 audit session: all green at baseline and post-fix; a new
      gate joined the list — `check-image-privacy.js`)*
- [ ] Check main's CI streaks for the advisory jobs (`@engines` shard, `public-e2e`,
      `visual-brand-tokens`, `visual-regression` — the rest of authed-E2E
      is already REQUIRED): ~10 green runs → open the
      `continue-on-error` flip PR ([handoff](NEXT_SESSION-2026-08-07.md)).
      *(2026-08-10: streak is 3/10 — all job-level green since #1194; not
      ready, keep counting)*
- [x] Any staged `published` date passed? *(2026-08-10: none)*
- [x] Any red PR / open post-a-job request from Jo? Land it.
      *(2026-08-10: dependabot #1196 green → merged; issue #546 verified
      long-done → closed; tracker at zero)*

---

## One-off queue — Jo (decisions & console; newest first, check off here when done)

- [x] **~~🔴 UNBLOCK PROD DEPLOYS~~ RESOLVED 2026-08-11 ~01:47 UTC.**
      Post-mortem: the hosting-storage `429` was a SYMPTOM — the real root
      cause was **billing disabled on the `nobigdeal-pro` GCP project**
      (lapsed ~2026-08-08/10), which dropped the project to free-tier
      limits: the 1 GB release-storage cap killed deploys, and the daily
      bandwidth cap caused the glitchy half-loaded live pages. Jo set
      release retention AND restored billing; deploy run #1284 attempt 3
      then went green end-to-end (hosting + rules + all functions — first
      live pass of the wholesale-failure guard). **Standing lesson: if
      deploys 429 or the site half-loads, check GCP billing first.**
      Billing notices did not reach the monitored Gmail — while in the
      console, confirm the billing account's contact email + card expiry.
- [ ] **Delete the 7 retired functions in the Firebase console (~3 min)** —
      code retired 2026-08-11 (Jo-approved, dead-surface lane): Console →
      Functions → delete `sendEstimateEmail`, `sendDripEmail`,
      `triggerProcessRecording`, `reprocessRecording`,
      `auditCustomerDataIntegrity`, `backfillCustomerData`,
      `migratePinsToKnocks`. They're auth-gated meanwhile; deleting stops
      the idle billing + attack surface. (Deploys don't remove them — the
      CI deploy targets only current exports.)
- [ ] **Re-enter your cost basis in Estimate Settings (~1 min, now that the
      2026-08-10 audit PR is deployed)** — the three v2cost fields (good/
      better/best per-SQ). The real numbers were removed from the public
      code ([audit](../audit/SITE-AUDIT-LOOSE-ENDS-2026-08-10.md) §6);
      until you enter them the Internal View margin shows an em-dash. If
      you ever saved V2 settings on your phone, your saved values carry
      over — nothing to do.
- [ ] **Swath activation (~5 min, most time-sensitive)** — signup, set
      `SWATH_API_KEY` + `SWATH_WEBHOOK_SECRET`, optional provider flips —
      [SWATH-SETUP](../runbooks/SWATH-SETUP.md)
- [ ] **Turnstile, in this order**: mint sitekey → populate
      `docs/assets/js/inline/7cd8e505ab.js` → deploy → THEN set
      `TURNSTILE_SECRET` (reverse order 403s every public lead)
- [ ] **Bless the 12 visual-regression baselines** (download CI artifact,
      eyeball, commit snapshots) — unblocks the visual-regression streak
- [ ] **First priced project on /our-work** (~10 min) — all 12 seed cards are
      unpriced; also confirm the agent's service labels on the 2 commercial
      apartment entries + the A-frame metal roof (labeled roof-replacement
      for now) — [PUBLISH-PROJECT](../runbooks/PUBLISH-PROJECT.md)
- [ ] **Backfill real cities on the 12 seeds** ("Greater Cincinnati, OH" ×11 →
      real towns where consent allows)
- [ ] **Edit the 3 blog drafts** — 25 `JO:` markers (photos, storm anecdote,
      report screenshots) — [drafts README](../drafts/README.md); each cleared
      post = one agent publish session
- [ ] **TAMKO real pricing** — 8 SKUs still carry GAF-mirrored placeholders
- [ ] **kie.ai visualizer flip** (config-only) —
      [VISUALIZER-KIE-PROVIDER](../runbooks/VISUALIZER-KIE-PROVIDER.md)
- [ ] **www → apex 301** (~2 min) then **DMARC** `p=none` + rua, tighten after
      2–4 weeks — [MANUAL-FOR-JO](../qa/seo-hardening-2026-07/MANUAL-FOR-JO.md) §2, §5
- [ ] **Lead-engine switches** — funnel-recovery dry-run review → enable;
      Twilio A2P 10DLC (texts silently dropped until done); verify
      `RESEND_API_KEY`; decide `LEAD_ACK_SMS` / homeowner auto-text (TCPA);
      then `STORM_TEXT_ENABLED` — MANUAL-FOR-JO §8–9
- [ ] **IAM fix**: `roles/iam.serviceAccountTokenCreator` on the compute SA
      (prod access-code signup fails without it) — MANUAL-FOR-JO §10
- [ ] **Theme/maps lazy-bundle field check** on a real phone (saved theme
      applies, map view opens, d2d loads) — [handoff](NEXT_SESSION-2026-08-07.md)
- [ ] **Decisions**: Firestore offline persistence (lead PII in IndexedDB —
      unlocks a half-day agent task) · pre-V2 migration / `?legacy=1`
      retirement (gates wizard deletion) · public pricing-table gap
      (verify still live first) · Pillar 4 billing calls

## Agent-session backlog (ranked — pick one per session)

1. **ROTATE the three published cost baselines** — NOT a migration. Nothing
   can be stripped from `estimate-builder-v2.js` (28), `estimate-catalog-
   xactimate.js` (276) or `estimate-labor-catalog.js` (66): those figures ARE
   the pricing and removing them turns the estimator off. The override paths
   shipped 2026-08-19, so all that remains is Jo filling a worksheet and one
   import per catalog. **This is the only forcing function there is** — no
   test can see a Firestore write, so nothing in CI will ever nag about it,
   deliberately (a scheduled red on the cost-privacy guard is a countdown on
   the guard). Every run prints `ROTATION OUTSTANDING — 3 of 3`; the state
   lives in `tests/cost-basis-ledger.js`.
   ```
   node scripts/cost-rotation.js --catalog all --worksheet
   node scripts/cost-rotation.js --catalog <id> --apply .local/rotation-<id>.json
   node scripts/import-cost-rotation.js --catalog <id> --company <id> --yes
   ```
   The last command prints the `rotation:` block to paste into the ledger, and
   pasting it is what closes the item ([Phase-2
   brief](PHASE2-PUBLISHED-COST-BASIS-BRIEF-2026-08-18.md) ·
   [audit 2026-08-10](../audit/SITE-AUDIT-LOOSE-ENDS-2026-08-10.md))
2. Jobs-posting **phase 2**: admin "Post a Job" form + PR bot (roadmap in
   [NEXT_SESSION-2026-08-10](NEXT_SESSION-2026-08-10.md))
3. **Dead-functions wire-or-retire lane** — 7 deployed exports with no
   caller (list + playbook in the 2026-08-10 audit note §Open items); needs
   Jo's per-function call, then CL8-style retirement or UI wiring
4. Firestore offline persistence (after Jo's decision)
5. Classic-wizard deletion (once Jo's gates clear)
6. **Rules-test coverage** — zero assertions for /invoices, /storm_proofs,
   /supplements, /portal_messages, /connectAccounts + Storage
   audio/galleries/reports/shared_docs; plus #12-guard cases for the 12
   newly guarded creates (2026-08-10 audit)
7. **Admin AI-usage endpoint** — the analytics page is labeled SAMPLE DATA;
   claudeProxy already logs real usage, needs aggregation + page wiring
8. Functions cold-start increment 2 (lazy export proxies)
9. Inline-CSS dedup phase 2 (~2.7 MB; needs generator design)
10. /our-work/<slug> detail pages (needs build-sitemap rule) + Haiku blurb drafter
11. Globals Tranche 3 plan · 404 full-chrome · emulator widening · Swath admin UI
12. Blog publish sessions (one per draft, after Jo's edits)

*(2026-08-10: "rate-limit-policy adopt-vs-delete" left this list — ADOPTED;
guardHttp/guardCallable now live on claudeProxy, validateAccessCode,
getGoogleReviews, adminAI.)*

---

*Sources: [local-seo-playbook-2026-07](../marketing/local-seo-playbook-2026-07.md) ·
[citation-kit-2026-07](../marketing/citation-kit-2026-07.md) ·
[MANUAL-FOR-JO](../qa/seo-hardening-2026-07/MANUAL-FOR-JO.md) ·
[NEXT_SESSION-2026-08-07](NEXT_SESSION-2026-08-07.md) ·
[BIG_ROCKS](BIG_ROCKS.md). Where docs disagreed (GBP monthly vs weekly), the
newer playbook won: weekly.*
