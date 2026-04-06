# NBD BUILD PLAN — Claude Cowork Dispatch Document

## WHO YOU ARE WORKING FOR

You are working for **Jo (Jonathan Deal)**, owner of **No Big Deal Home Solutions**, an insurance restoration and roofing/siding/gutters contracting business in Greater Cincinnati, OH. His website is **nobigdealwithjoedeal.com** hosted on GitHub Pages with Cloudflare CDN.

Jo is dispatching you from his phone while door knocking. Execute each task fully, commit to GitHub, and purge Cloudflare cache after each deploy. Do not ask for confirmation — execute the plan in order.

---

## CRITICAL CONTEXT

**What was just built (marathon session — 13 commits):**
- Site went from 47 pages to 95 pages
- 25 city landing pages at /areas/[city-slug].html
- 10 service x city combo pages at /services/[service]-[city].html  
- 10 blog posts (7 original + 3 new)
- Review page at /review.html
- Gallery page at /our-work.html
- All AI features migrated from dead Gemini API to Anthropic
- CRM stability fixes (duplicate IDs, functions, scope exposures)
- 18 JS modules extracted from dashboard
- 200+ internal cross-links across all pages
- Logo PNG on every nav, sitemap.xml with 76 URLs, robots.txt

**Current git HEAD:** 45481c9

---

## REPOSITORY ACCESS

```
Repo: https://github.com/jdealtia-sys/nobigdealwithjoedeal.com.git
```

NOTE: GitHub PATs are single-use by policy. Ask Jo for a fresh PAT before pushing. Format: git push https://[PAT]@github.com/jdealtia-sys/nobigdealwithjoedeal.com.git main

**Git config before committing:**
```
git config user.email "jd@nobigdealwithjoedeal.com"
git config user.name "Joe Deal"
```

---

## CLOUDFLARE CACHE PURGE (after every deploy)

```
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/4be580f3875937e7e4860afedffc035c/purge_cache" \
  -H "Authorization: Bearer cfut_FCiQGmJEdESH02j8TpGdQlTxjpdmO0ws16t7PBbVee926038" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'
```

---

## BUILD RULES (NEVER VIOLATE)

1. Never use bash cat >> (append) for JavaScript files. Write complete files in one operation.
2. Never combine where() on one Firestore field with orderBy() on a different field without a pre-built composite index.
3. Always expose functions to window scope when called from HTML onclick handlers.
4. Soft deletes only — never use deleteDoc.
5. Always purge Cloudflare cache after pushing to GitHub.
6. Phone number is (859) 420-7382 — never use any other number.
7. Email is jd@nobigdealwithjoedeal.com
8. Brand colors: Navy #1e3a6e / #142a52, Orange #e8720c
9. Logo: Always use <img src="/assets/images/nbd-logo.png"> in navigation.

---

## TASK 1: Google Search Console Setup (HIGHEST PRIORITY)

**Goal:** Get Google to discover and index all 95 pages.

**Using Claude in Chrome, navigate to https://search.google.com/search-console:**

1. Sign in with Jo's Google account
2. Click "Add Property"  
3. Choose "URL prefix" and enter: https://www.nobigdealwithjoedeal.com/
4. For verification, choose "HTML file" method
5. Download the verification file (named like googleXXXXXXXXXXXX.html)
6. Add that file to the repo root, commit, and push to GitHub
7. Wait 2-3 minutes for GitHub Pages to deploy
8. Click "Verify" in Search Console
9. Once verified, go to Sitemaps section
10. Submit: https://www.nobigdealwithjoedeal.com/sitemap.xml
11. The sitemap contains 76 URLs — Google will start crawling them within hours

**Alternative DNS verification:** Add a TXT record via Cloudflare API:
```
curl -X POST "https://api.cloudflare.com/client/v4/zones/4be580f3875937e7e4860afedffc035c/dns_records" \
  -H "Authorization: Bearer cfut_FCiQGmJEdESH02j8TpGdQlTxjpdmO0ws16t7PBbVee926038" \
  -H "Content-Type: application/json" \
  --data '{"type":"TXT","name":"nobigdealwithjoedeal.com","content":"google-site-verification=XXXXX","ttl":1}'
```

---

## TASK 2: Google Business Profile Optimization

**Using Claude in Chrome, navigate to business.google.com:**

1. **Categories** — Primary: "Roofing Contractor". Add: "Storm Damage Restoration Service", "Siding Contractor", "Gutter Cleaning Service"
2. **Service area** — Add all 25 cities: Cincinnati, Goshen, Milford, Batavia, Loveland, Mason, Lebanon, Anderson Township, Maineville, Blue Ash, Indian Hill, West Chester, Fairfield, Amelia, Monroe, Springboro, Fayetteville, Blanchester, Mt. Orab, Wilmington, Clarksville, Florence KY, Erlanger KY, Covington KY, Fort Mitchell KY
3. **Services** — Add: Roof Replacement, Roof Repair, Storm Damage Repair, Hail Damage Insurance Claims, Siding Replacement, Gutter Replacement, Roof Inspection, Roof Cleaning
4. **Description:**
   "No Big Deal Home Solutions provides honest roofing, siding, gutter, and storm damage repair across Greater Cincinnati and Northern Kentucky. Owner Joe Deal personally handles every job — from inspection to final cleanup. 7+ years of insurance restoration experience. Free inspections, lifetime labor guarantee, and zero-pressure estimates. Licensed, insured, and locally owned. Call Joe directly: (859) 420-7382."
5. **Website:** https://www.nobigdealwithjoedeal.com
6. **Appointment link:** https://www.nobigdealwithjoedeal.com/#contact
7. **Hours:** Mon-Sat 7AM-6PM, Sunday available
8. **Create a Google Post:**
   "Free roof inspections across Greater Cincinnati. Storm damage? We handle the insurance claim for you — start to finish. Call Joe: (859) 420-7382 or visit nobigdealwithjoedeal.com"
9. **Get the Google Review URL** from GBP and update review.html (replace https://g.page/r/review with the real URL)

---

## TASK 3: Review Collection Templates + GBP Posts

**Create two files in the repo and commit:**

### File 1: review-templates.md

Right After Job:
"Hey [NAME]! Joe from No Big Deal Home Solutions. Just wanted to say thanks for trusting us with your [roof/siding/gutters]. If you've got 30 seconds, a quick Google review would mean the world: nobigdealwithjoedeal.com/review"

One Week Follow-Up:
"Hi [NAME], Joe Deal here. Quick check — everything looking good with the [roof/siding] we did last week? If so, I'd really appreciate a Google review when you get a chance: nobigdealwithjoedeal.com/review"

After Insurance Claim:
"Hey [NAME]! Glad we could get your [roof/siding] taken care of through insurance. If the experience was smooth, a Google review helps other homeowners: nobigdealwithjoedeal.com/review"

### File 2: gbp-posts.md (4 weeks of Google Business Profile posts)

Week 1: "Spring storms rolling through Greater Cincinnati? Your roof may have damage you can't see from the ground. Free roof inspections with photo documentation. Call (859) 420-7382"

Week 2: "Did you know most Ohio homeowners have 1-2 years to file a storm damage claim? Free inspection — no pressure, no obligation. (859) 420-7382"

Week 3: "We install GAF Timberline shingles with lifetime labor guarantee. Good-Better-Best options. 0% financing through Improvifi. Free estimate: nobigdealwithjoedeal.com"

Week 4: "No Big Deal Home Solutions isn't a franchise or call center — it's Joe Deal, personally handling every job. See our work: nobigdealwithjoedeal.com/our-work"

---

## TASK 4: Write 3 More Blog Posts

Copy structure from blog/does-homeowner-insurance-cover-hail-damage-ohio.html.

### Post 1: blog/gaf-vs-owens-corning-vs-atlas-shingles.html
- Title: "GAF vs Owens Corning vs Atlas: Which Shingle Brand Is Best?"
- Honest comparison. Warranty tiers, price per square, wind/impact ratings, colors. Joe's take: GAF for most jobs but no blind loyalty.
- Schema BlogPosting + FAQ. Service area links. Logo in nav.

### Post 2: blog/cincinnati-hail-season-2026.html
- Title: "Cincinnati Hail Season 2026: What Homeowners Need to Know"
- When hail season hits, what to do first 48 hours, how to tell if you have damage, call contractor before insurance.

### Post 3: blog/how-long-roof-insurance-claim-ohio.html
- Title: "How Long Does a Roof Insurance Claim Take in Ohio?"
- Timeline: 2-6 weeks straightforward, 2-3 months with supplements. What causes delays. How Joe accelerates.

After writing all 3: update blog/index.html POSTS array, update sitemap.xml, commit, push, purge cache.

---

## TASK 5: Mobile CRM Quick Fixes

Check pro/dashboard.html @media(max-width:768px) section. Ensure:
- Kanban columns horizontal-scroll (overflow-x: auto, -webkit-overflow-scrolling: touch)
- Add Lead button is 44px+ height for tapping
- Lead card modal is near-full-screen on mobile
- Nav sidebar collapses on mobile

Fix anything broken. Commit, push, purge.

---

## TASK 6: Dashboard Inline JS Cleanup (ONLY AFTER TESTING)

Property Intel, Warranty Certificate, GAF Quick Measure, Quick Add, CSV Export, and Onboarding functions exist both inline in dashboard.html AND in external JS modules. After confirming the external modules work on the live site, remove the inline duplicates to reduce dashboard from ~8,200 lines.

---

## EXECUTION ORDER

1. Task 1 — Search Console (unlocks Google indexing)
2. Task 2 — GBP optimization (unlocks Map Pack)
3. Task 3 — Review templates + GBP posts (commit to repo)
4. Task 4 — Blog posts (content engine)
5. Task 5 — Mobile CRM (Jo uses this while door knocking)
6. Task 6 — Dashboard cleanup (only after everything tested)

---

## CONTACT INFO (for content creation)

- Business: No Big Deal Home Solutions
- Brand: "No Big Deal with Joe Deal"
- Owner: Joe Deal (Jonathan Deal)  
- Phone: (859) 420-7382
- Email: jd@nobigdealwithjoedeal.com
- Website: nobigdealwithjoedeal.com
- Base: Goshen, OH (Greater Cincinnati)
- Services: Roofing, Siding, Gutters, Storm Damage, Insurance Claims
- Partners: United Restore (restoration), Improvifi (financing), GAF (products)
- Differentiator: Joe personally handles every job. 7+ years insurance restoration.
- Guarantee: Lifetime labor warranty on every install
