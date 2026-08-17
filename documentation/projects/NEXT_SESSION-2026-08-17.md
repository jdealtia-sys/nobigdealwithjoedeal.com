# NEXT SESSION — handoff (written 2026-08-17)

Cold-start brief. Previous handoff: [NEXT_SESSION-2026-08-11](NEXT_SESSION-2026-08-11.md)
(its engineering lanes — tenant cost book, dead-functions wire-or-retire, rules-test
coverage, admin AI-usage endpoint, advisory-CI flip — are all still open and
unchanged; this handoff adds the marketing/AEO lane on top).

## ⚡ Close-out update — 2026-08-17 evening (session archived)

The backlinks/AEO session that wrote this handoff is **archived**; all its PRs
are merged and live: #1205 (main wave), #1209 (GAF sameAs + account guide),
#1214 (Bing baseline log), #1217 (www-redirect workflow), #1220 (301 fixed),
#1224 (financing post published), #1226 (drafts status + Bing Places tick).
Items 1–3 of the Jo list below are DONE except: TAMKO locator (rep email
drafted, in the archived session's transcript and re-creatable from
rush-week doc facts), Apple Business Connect, GSC Request Indexing on the 3
new post URLs. Jo follow-ups (hail photos ×3, inspection screenshots ×3,
new listing URLs → `sameAs`) go to a **fresh session pointed at this doc**.

**FIRST PICKUP for the next session — create the weekly measurement Routine**
(could not be created 2026-08-17: the claude-code-remote scheduler tools were
down all evening). Spec: `create_trigger` with cron `0 13 * * 1` (Mon 13:00
UTC), **`create_new_session_on_fire: true`** (must not depend on any one
session), standalone prompt covering: (a) health probes — `feed.xml`,
`sitemap.xml`, `https://www.nobigdealwithjoedeal.com/` must 301 to apex, and
the three 2026-08-17 post URLs must 200; (b) Bing indexation probe via public
search vs the baseline in
[rush-week-2026-08 §Baseline](../marketing/rush-week-2026-08.md) (201
discovered / 0 indexed) — bot-degraded results are "inconclusive", never "not
indexed"; (c) one AI-answer spot check on a shingle-comparison query, noting
any nobigdealwithjoedeal.com citation; (d) on change or failure only: append a
dated delta to the rush-week doc's Measuring section via branch/PR/merge-on-
green; (e) message Jo only on failures or wins (first indexed pages, first AI
citation).

## State as of this handoff

PR **#1205** (branch `claude/backlinks-internet-presence-02qlij`) carries the whole
backlinks/AEO wave — see
[SESSION-2026-08-17-backlinks-aeo-rush](SESSION-2026-08-17-backlinks-aeo-rush.md).
Merging it publishes two Reader Questions posts (Jo's claims-verification table is
in the PR description), the FAQ schema wave, the RSS feed + IndexNow key, and the
rush-week marketing kit. Hosting deploys ~minutes after merge (path-filtered).

## Jo — in order

1. **Verify the claims table in PR #1205, then merge.** Merge = approving both posts.
2. **Screenshot the GSC baseline** per
   [rush-week-2026-08 §Baseline](../marketing/rush-week-2026-08.md) → save as
   `documentation/marketing/gsc-baseline-2026-08.png`.
3. **Run rush-week Day 1–2** (~2h): GAF locator, TAMKO Pro Gold locator, James
   Hardie Alliance, Bing Places import, **Bing Webmaster Tools import + sitemap
   submit**, Apple Business Connect, www→apex check, IndexNow curl, GSC Request
   Indexing. All steps + paste-ready commands are in the rush-week doc.
4. **Day 3–4**: Nextdoor, BBB, Yelp claim.
5. **AirOps unblock (5 min, one-time)**: the account connected to Claude has no
   workspace yet and the integration can't create one. Log into airops.com once,
   create a workspace + Brand Kit for "No Big Deal Home Solutions"
   (URL `https://nobigdealwithjoedeal.com`), then tell a session "set up AirOps
   AEO tracking" — everything else is automated from there.

## Next session — first pickups

1. ✅ **Post-merge verification sweep — done 2026-08-17**: feed 200 + valid
   RSS 2.0; all 5 pages carry parsing FAQPage (+BlogPosting/Service +
   BreadcrumbList) JSON-LD; /areas og:url canonical, no hop. Results logged in
   [SESSION-2026-08-17-backlinks-aeo-rush](SESSION-2026-08-17-backlinks-aeo-rush.md)
   §Post-merge verification sweep. (W3C + Rich Results web UIs couldn't be
   driven headless — structural validation done instead; optional to re-run
   from a normal browser.)
2. **sameAs append queue**: as Jo's claims from rush-week go live, append each
   profile URL to `docs/index.html` (~line 482) + `docs/review.html` (~line 27)
   `sameAs` arrays (procedure in citation-kit addendum). Bing/Apple/Nextdoor/BBB
   listings each add one line; restamp nothing (plain schema edit), run
   marketing-polish + integrity, ship.
   - ✅ **GAF — claimed + appended 2026-08-17**
     (`gaf.com/en-us/roofing-contractors/residential/usa/oh/goshen/no-big-deal-home-solutions-1162011`).
     **Two profile gaps for Jo in the GAF portal:** (a) the profile shows **no
     website link** — add `https://nobigdealwithjoedeal.com` (the link IS the
     backlink); (b) the profile displays the street address — NAP policy is
     service-area/hidden address; hide it if GAF's settings allow.
3. **AirOps AEO setup** (once Jo creates the workspace — decision #3, approved):
   build the Brand Kit from [VOICE_BIBLE](../brand/VOICE_BIBLE.md) + llms.txt facts,
   then add tracked AEO prompts: "gaf timberline hdz vs tamko stormfighter flex",
   "oc duration vs hailguard", "is a $9,000 class 4 shingle upsell reasonable",
   "best class 4 shingle", "class 4 shingle insurance discount", "best shingle for
   hail", "gaf vs tamko", "tamko hailguard review", "hail warranty shingle",
   personas: Cincinnati homeowner + national researcher.
4. **Reader Questions pipeline is live** — any new out-of-area question from Jo
   becomes a post within the week (spec = the two 2026-08-17 posts; pipeline steps
   in rush-week §pipeline).
5. **Drafts pipeline — 1 of 3 unstalled 2026-08-17**: the financing post is
   published (PR #1224; its markers were self-resolvable). The 2 remaining
   drafts in [drafts/README](../drafts/README.md) are genuinely blocked on
   Jo-only inputs, now itemized precisely there: 3 hail photos (+ optional
   anecdote) for the hail post, 3 redacted report screenshots + 3 confirms
   for the inspection post. Gallery reuse was checked — it covers only the
   chalk-square figure.

## Watch-outs

- `rebuild-blog-index.js --reschedule` restamps every post date — never run it.
- `build-feed.mjs` output is deterministic by design; if the CI feed gate ever
  flaps, someone introduced a now()-dependent field — fix the generator, don't
  hand-edit feed.xml.
- The IndexNow key file (`docs/b947f682ee5aa172a0005d5440a7bfcf.txt`) must stay
  served at the root — deleting/renaming it invalidates future pings.
- OC-adjacent prose: keep negations in the same sentence as any
  "Owens Corning …certified/contractor" construction (cert-claim guard,
  `tests/marketing-polish-contract.test.js:258`), and never claim Master Elite.
