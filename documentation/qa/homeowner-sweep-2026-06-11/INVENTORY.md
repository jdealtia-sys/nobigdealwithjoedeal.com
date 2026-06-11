# Homeowner Site QC Sweep — Page Inventory Ledger
> Session 2026-06-11 · branch `claude/nbd-homeowner-qc-sweep-tlcnrz` · rollback point `6e98523`
> Source of truth: `docs/` filesystem (excluding `docs/pro/`) reconciled against `docs/sitemap.xml`.
> Hosting: Firebase Hosting (verified from `firebase.json`: public=docs, cleanUrls=true, trailingSlash=false,
> 6 redirects, function rewrites for /api/*, /share/**, /cspReport). Live-header check blocked by
> session network policy (403 host_not_allowed) — header posture to be verified from config + any future live access.

| URL | Family | Test tier | In sitemap |
|-----|--------|-----------|------------|
| `/` | unique high-value | EXHAUSTIVE | yes |
| `/404` | unique high-value | EXHAUSTIVE | NO |
| `/about` | unique high-value | EXHAUSTIVE | yes |
| `/admin` | admin (internal) | OUT-OF-SCOPE (internal, not homeowner) | NO |
| `/admin/analytics` | admin (internal) | OUT-OF-SCOPE (internal, not homeowner) | NO |
| `/admin/login` | admin (internal) | OUT-OF-SCOPE (internal, not homeowner) | NO |
| `/admin/mfa-enroll` | admin (internal) | OUT-OF-SCOPE (internal, not homeowner) | NO |
| `/admin/project-codex` | admin (internal) | OUT-OF-SCOPE (internal, not homeowner) | NO |
| `/admin/vault` | admin (internal) | OUT-OF-SCOPE (internal, not homeowner) | NO |
| `/areas` | unique high-value | EXHAUSTIVE | yes |
| `/areas/amelia-oh` | area page | TEMPLATE+SAMPLE | yes |
| `/areas/anderson-township-oh` | area page | TEMPLATE+SAMPLE | yes |
| `/areas/batavia-oh` | area page | TEMPLATE+SAMPLE | yes |
| `/areas/blanchester-oh` | area page | TEMPLATE+SAMPLE | yes |
| `/areas/blue-ash-oh` | area page | TEMPLATE+SAMPLE | yes |
| `/areas/cincinnati-oh` | area page | TEMPLATE+SAMPLE | yes |
| `/areas/clarksville-oh` | area page | TEMPLATE+SAMPLE | yes |
| `/areas/covington-ky` | area page | TEMPLATE+SAMPLE | yes |
| `/areas/erlanger-ky` | area page | TEMPLATE+SAMPLE | yes |
| `/areas/fairfield-oh` | area page | TEMPLATE+SAMPLE | yes |
| `/areas/fayetteville-oh` | area page | TEMPLATE+SAMPLE | yes |
| `/areas/florence-ky` | area page | TEMPLATE+SAMPLE | yes |
| `/areas/fort-mitchell-ky` | area page | TEMPLATE+SAMPLE | yes |
| `/areas/goshen-oh` | area page | TEMPLATE+SAMPLE | yes |
| `/areas/indian-hill-oh` | area page | TEMPLATE+SAMPLE | yes |
| `/areas/lebanon-oh` | area page | TEMPLATE+SAMPLE | yes |
| `/areas/loveland-oh` | area page | TEMPLATE+SAMPLE | yes |
| `/areas/maineville-oh` | area page | TEMPLATE+SAMPLE | yes |
| `/areas/mason-oh` | area page | TEMPLATE+SAMPLE | yes |
| `/areas/milford-oh` | area page | TEMPLATE+SAMPLE | yes |
| `/areas/monroe-oh` | area page | TEMPLATE+SAMPLE | yes |
| `/areas/mt-orab-oh` | area page | TEMPLATE+SAMPLE | yes |
| `/areas/springboro-oh` | area page | TEMPLATE+SAMPLE | yes |
| `/areas/west-chester-oh` | area page | TEMPLATE+SAMPLE | yes |
| `/areas/wilmington-oh` | area page | TEMPLATE+SAMPLE | yes |
| `/blog` | unique high-value | EXHAUSTIVE | yes |
| `/blog/architectural-shingles-vs-3-tab` | blog post | TEMPLATE+SAMPLE | yes |
| `/blog/can-i-keep-insurance-check-not-fix-roof` | blog post | TEMPLATE+SAMPLE | yes |
| `/blog/cincinnati-hail-season-2026` | blog post | TEMPLATE+SAMPLE | yes |
| `/blog/does-homeowner-insurance-cover-hail-damage-ohio` | blog post | TEMPLATE+SAMPLE | yes |
| `/blog/field-notes-joes-notebook-goes-public` | blog post | TEMPLATE+SAMPLE | yes |
| `/blog/gaf-vs-owens-corning-vs-atlas-shingles` | blog post | TEMPLATE+SAMPLE | yes |
| `/blog/how-long-does-roof-replacement-take-cincinnati` | blog post | TEMPLATE+SAMPLE | yes |
| `/blog/how-long-roof-insurance-claim-ohio` | blog post | TEMPLATE+SAMPLE | yes |
| `/blog/how-much-does-roof-cost-cincinnati-2026` | blog post | TEMPLATE+SAMPLE | yes |
| `/blog/how-to-file-storm-damage-insurance-claim-ohio` | blog post | TEMPLATE+SAMPLE | yes |
| `/blog/my-roof-is-too-old-will-insurance-still-pay` | blog post | TEMPLATE+SAMPLE | yes |
| `/blog/signs-your-roof-needs-replacement-vs-repair` | blog post | TEMPLATE+SAMPLE | yes |
| `/blog/state-farm-allstate-roof-claims-ohio` | blog post | TEMPLATE+SAMPLE | yes |
| `/blog/the-pipe-boot-fork` | blog post | TEMPLATE+SAMPLE | yes |
| `/blog/what-to-expect-roof-insurance-adjuster-visit` | blog post | TEMPLATE+SAMPLE | yes |
| `/blog/why-class-4-impact-shingles` | blog post | TEMPLATE+SAMPLE | yes |
| `/blog/why-i-install-lumanail-on-every-elite-roof` | blog post | TEMPLATE+SAMPLE | yes |
| `/blog/why-roofivent-is-on-my-roofs` | blog post | TEMPLATE+SAMPLE | yes |
| `/estimate` | unique high-value | EXHAUSTIVE | yes |
| `/free-roof` | unique high-value | EXHAUSTIVE | yes |
| `/googlee5b8f461f0f8e74b` | verification stub | SKIP | NO |
| `/inspect` | unique high-value | EXHAUSTIVE | yes |
| `/offline` | unique high-value | EXHAUSTIVE | NO |
| `/our-work` | unique high-value | EXHAUSTIVE | yes |
| `/our-work/_TEMPLATE-last-job` | template file (shipped!) | FINDING (template on prod) | NO |
| `/privacy` | unique high-value | EXHAUSTIVE | yes |
| `/review` | unique high-value | EXHAUSTIVE | yes |
| `/services/financing` | unique high-value | EXHAUSTIVE | yes |
| `/services/fire-water-smoke-damage` | service page (unique) | EXHAUSTIVE | yes |
| `/services/gaf-pivot-boot` | service page (unique) | EXHAUSTIVE | yes |
| `/services/gaf-timberline` | service page (unique) | EXHAUSTIVE | yes |
| `/services/gutter-replacement` | service page (unique) | EXHAUSTIVE | yes |
| `/services/gutter-replacement-anderson-township-oh` | service location-variant (gutter-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/gutter-replacement-batavia-oh` | service location-variant (gutter-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/gutter-replacement-blue-ash-oh` | service location-variant (gutter-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/gutter-replacement-cincinnati-oh` | service location-variant (gutter-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/gutter-replacement-covington-ky` | service location-variant (gutter-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/gutter-replacement-erlanger-ky` | service location-variant (gutter-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/gutter-replacement-fairfield-oh` | service location-variant (gutter-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/gutter-replacement-florence-ky` | service location-variant (gutter-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/gutter-replacement-fort-mitchell-ky` | service location-variant (gutter-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/gutter-replacement-lebanon-oh` | service location-variant (gutter-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/gutter-replacement-loveland-oh` | service location-variant (gutter-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/gutter-replacement-mason-oh` | service location-variant (gutter-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/gutter-replacement-west-chester-oh` | service location-variant (gutter-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-amelia-oh` | service location-variant (hail-damage) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-anderson-township-oh` | service location-variant (hail-damage) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-batavia-oh` | service location-variant (hail-damage) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-blanchester-oh` | service location-variant (hail-damage) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-blue-ash-oh` | service location-variant (hail-damage) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-cincinnati-oh` | service location-variant (hail-damage) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-clarksville-oh` | service location-variant (hail-damage) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-covington-ky` | service location-variant (hail-damage) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-erlanger-ky` | service location-variant (hail-damage) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-fairfield-oh` | service location-variant (hail-damage) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-fayetteville-oh` | service location-variant (hail-damage) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-florence-ky` | service location-variant (hail-damage) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-fort-mitchell-ky` | service location-variant (hail-damage) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-goshen-oh` | service location-variant (hail-damage) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-indian-hill-oh` | service location-variant (hail-damage) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-insurance-claim` | service page (unique) | EXHAUSTIVE | yes |
| `/services/hail-damage-insurance-claim-batavia-oh` | service location-variant (hail-damage-insurance-claim) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-insurance-claim-cincinnati-oh` | service location-variant (hail-damage-insurance-claim) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-insurance-claim-loveland-oh` | service location-variant (hail-damage-insurance-claim) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-insurance-claim-mason-oh` | service location-variant (hail-damage-insurance-claim) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-insurance-claim-west-chester-oh` | service location-variant (hail-damage-insurance-claim) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-lebanon-oh` | service location-variant (hail-damage) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-loveland-oh` | service location-variant (hail-damage) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-maineville-oh` | service location-variant (hail-damage) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-mason-oh` | service location-variant (hail-damage) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-milford-oh` | service location-variant (hail-damage) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-monroe-oh` | service location-variant (hail-damage) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-mt-orab-oh` | service location-variant (hail-damage) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-springboro-oh` | service location-variant (hail-damage) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-west-chester-oh` | service location-variant (hail-damage) | TEMPLATE+SAMPLE | yes |
| `/services/hail-damage-wilmington-oh` | service location-variant (hail-damage) | TEMPLATE+SAMPLE | yes |
| `/services/lumanail` | service page (unique) | EXHAUSTIVE | yes |
| `/services/roof-cleaning-soft-wash` | service page (unique) | EXHAUSTIVE | yes |
| `/services/roof-inspection` | service page (unique) | EXHAUSTIVE | yes |
| `/services/roof-inspection-batavia-oh` | service location-variant (roof-inspection) | TEMPLATE+SAMPLE | yes |
| `/services/roof-inspection-cincinnati-oh` | service location-variant (roof-inspection) | TEMPLATE+SAMPLE | yes |
| `/services/roof-inspection-loveland-oh` | service location-variant (roof-inspection) | TEMPLATE+SAMPLE | yes |
| `/services/roof-inspection-mason-oh` | service location-variant (roof-inspection) | TEMPLATE+SAMPLE | yes |
| `/services/roof-inspection-west-chester-oh` | service location-variant (roof-inspection) | TEMPLATE+SAMPLE | yes |
| `/services/roof-repair` | service page (unique) | EXHAUSTIVE | yes |
| `/services/roof-repair-anderson-township-oh` | service location-variant (roof-repair) | TEMPLATE+SAMPLE | yes |
| `/services/roof-repair-batavia-oh` | service location-variant (roof-repair) | TEMPLATE+SAMPLE | yes |
| `/services/roof-repair-blue-ash-oh` | service location-variant (roof-repair) | TEMPLATE+SAMPLE | yes |
| `/services/roof-repair-cincinnati-oh` | service location-variant (roof-repair) | TEMPLATE+SAMPLE | yes |
| `/services/roof-repair-covington-ky` | service location-variant (roof-repair) | TEMPLATE+SAMPLE | yes |
| `/services/roof-repair-erlanger-ky` | service location-variant (roof-repair) | TEMPLATE+SAMPLE | yes |
| `/services/roof-repair-fairfield-oh` | service location-variant (roof-repair) | TEMPLATE+SAMPLE | yes |
| `/services/roof-repair-florence-ky` | service location-variant (roof-repair) | TEMPLATE+SAMPLE | yes |
| `/services/roof-repair-fort-mitchell-ky` | service location-variant (roof-repair) | TEMPLATE+SAMPLE | yes |
| `/services/roof-repair-lebanon-oh` | service location-variant (roof-repair) | TEMPLATE+SAMPLE | yes |
| `/services/roof-repair-loveland-oh` | service location-variant (roof-repair) | TEMPLATE+SAMPLE | yes |
| `/services/roof-repair-mason-oh` | service location-variant (roof-repair) | TEMPLATE+SAMPLE | yes |
| `/services/roof-repair-west-chester-oh` | service location-variant (roof-repair) | TEMPLATE+SAMPLE | yes |
| `/services/roof-replacement` | service page (unique) | EXHAUSTIVE | yes |
| `/services/roof-replacement-amelia-oh` | service location-variant (roof-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/roof-replacement-anderson-township-oh` | service location-variant (roof-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/roof-replacement-batavia-oh` | service location-variant (roof-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/roof-replacement-blanchester-oh` | service location-variant (roof-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/roof-replacement-blue-ash-oh` | service location-variant (roof-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/roof-replacement-cincinnati-oh` | service location-variant (roof-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/roof-replacement-clarksville-oh` | service location-variant (roof-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/roof-replacement-covington-ky` | service location-variant (roof-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/roof-replacement-erlanger-ky` | service location-variant (roof-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/roof-replacement-fairfield-oh` | service location-variant (roof-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/roof-replacement-fayetteville-oh` | service location-variant (roof-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/roof-replacement-florence-ky` | service location-variant (roof-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/roof-replacement-fort-mitchell-ky` | service location-variant (roof-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/roof-replacement-goshen-oh` | service location-variant (roof-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/roof-replacement-indian-hill-oh` | service location-variant (roof-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/roof-replacement-lebanon-oh` | service location-variant (roof-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/roof-replacement-loveland-oh` | service location-variant (roof-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/roof-replacement-maineville-oh` | service location-variant (roof-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/roof-replacement-mason-oh` | service location-variant (roof-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/roof-replacement-milford-oh` | service location-variant (roof-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/roof-replacement-monroe-oh` | service location-variant (roof-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/roof-replacement-mt-orab-oh` | service location-variant (roof-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/roof-replacement-springboro-oh` | service location-variant (roof-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/roof-replacement-west-chester-oh` | service location-variant (roof-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/roof-replacement-wilmington-oh` | service location-variant (roof-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/roofivent` | service page (unique) | EXHAUSTIVE | yes |
| `/services/siding-repair` | service page (unique) | EXHAUSTIVE | yes |
| `/services/siding-repair-batavia-oh` | service location-variant (siding-repair) | TEMPLATE+SAMPLE | yes |
| `/services/siding-repair-cincinnati-oh` | service location-variant (siding-repair) | TEMPLATE+SAMPLE | yes |
| `/services/siding-repair-loveland-oh` | service location-variant (siding-repair) | TEMPLATE+SAMPLE | yes |
| `/services/siding-repair-mason-oh` | service location-variant (siding-repair) | TEMPLATE+SAMPLE | yes |
| `/services/siding-repair-west-chester-oh` | service location-variant (siding-repair) | TEMPLATE+SAMPLE | yes |
| `/services/siding-replacement` | service page (unique) | EXHAUSTIVE | yes |
| `/services/siding-replacement-batavia-oh` | service location-variant (siding-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/siding-replacement-cincinnati-oh` | service location-variant (siding-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/siding-replacement-loveland-oh` | service location-variant (siding-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/siding-replacement-mason-oh` | service location-variant (siding-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/siding-replacement-west-chester-oh` | service location-variant (siding-replacement) | TEMPLATE+SAMPLE | yes |
| `/services/storm-damage` | service page (unique) | EXHAUSTIVE | yes |
| `/services/storm-damage-amelia-oh` | service location-variant (storm-damage) | TEMPLATE+SAMPLE | yes |
| `/services/storm-damage-anderson-township-oh` | service location-variant (storm-damage) | TEMPLATE+SAMPLE | yes |
| `/services/storm-damage-batavia-oh` | service location-variant (storm-damage) | TEMPLATE+SAMPLE | yes |
| `/services/storm-damage-blanchester-oh` | service location-variant (storm-damage) | TEMPLATE+SAMPLE | yes |
| `/services/storm-damage-blue-ash-oh` | service location-variant (storm-damage) | TEMPLATE+SAMPLE | yes |
| `/services/storm-damage-cincinnati-oh` | service location-variant (storm-damage) | TEMPLATE+SAMPLE | yes |
| `/services/storm-damage-clarksville-oh` | service location-variant (storm-damage) | TEMPLATE+SAMPLE | yes |
| `/services/storm-damage-covington-ky` | service location-variant (storm-damage) | TEMPLATE+SAMPLE | yes |
| `/services/storm-damage-erlanger-ky` | service location-variant (storm-damage) | TEMPLATE+SAMPLE | yes |
| `/services/storm-damage-fairfield-oh` | service location-variant (storm-damage) | TEMPLATE+SAMPLE | yes |
| `/services/storm-damage-fayetteville-oh` | service location-variant (storm-damage) | TEMPLATE+SAMPLE | yes |
| `/services/storm-damage-florence-ky` | service location-variant (storm-damage) | TEMPLATE+SAMPLE | yes |
| `/services/storm-damage-fort-mitchell-ky` | service location-variant (storm-damage) | TEMPLATE+SAMPLE | yes |
| `/services/storm-damage-goshen-oh` | service location-variant (storm-damage) | TEMPLATE+SAMPLE | yes |
| `/services/storm-damage-indian-hill-oh` | service location-variant (storm-damage) | TEMPLATE+SAMPLE | yes |
| `/services/storm-damage-lebanon-oh` | service location-variant (storm-damage) | TEMPLATE+SAMPLE | yes |
| `/services/storm-damage-loveland-oh` | service location-variant (storm-damage) | TEMPLATE+SAMPLE | yes |
| `/services/storm-damage-maineville-oh` | service location-variant (storm-damage) | TEMPLATE+SAMPLE | yes |
| `/services/storm-damage-mason-oh` | service location-variant (storm-damage) | TEMPLATE+SAMPLE | yes |
| `/services/storm-damage-milford-oh` | service location-variant (storm-damage) | TEMPLATE+SAMPLE | yes |
| `/services/storm-damage-monroe-oh` | service location-variant (storm-damage) | TEMPLATE+SAMPLE | yes |
| `/services/storm-damage-mt-orab-oh` | service location-variant (storm-damage) | TEMPLATE+SAMPLE | yes |
| `/services/storm-damage-springboro-oh` | service location-variant (storm-damage) | TEMPLATE+SAMPLE | yes |
| `/services/storm-damage-west-chester-oh` | service location-variant (storm-damage) | TEMPLATE+SAMPLE | yes |
| `/services/storm-damage-wilmington-oh` | service location-variant (storm-damage) | TEMPLATE+SAMPLE | yes |
| `/services/the-nbd-build` | service page (unique) | EXHAUSTIVE | yes |
| `/services/the-nbd-guarantee` | service page (unique) | EXHAUSTIVE | yes |
| `/sites` | sites (contractor/oaks surface) | LIGHT (link+asset only; separate brand) | NO |
| `/sites/free-guide` | sites (contractor/oaks surface) | LIGHT (link+asset only; separate brand) | NO |
| `/sites/oaks` | sites (contractor/oaks surface) | LIGHT (link+asset only; separate brand) | NO |
| `/sites/oaks/about` | sites (contractor/oaks surface) | LIGHT (link+asset only; separate brand) | NO |
| `/sites/oaks/contact` | sites (contractor/oaks surface) | LIGHT (link+asset only; separate brand) | NO |
| `/sites/oaks/gallery` | sites (contractor/oaks surface) | LIGHT (link+asset only; separate brand) | NO |
| `/sites/oaks/service-areas` | sites (contractor/oaks surface) | LIGHT (link+asset only; separate brand) | NO |
| `/sites/oaks/services/gutter-replacement` | sites (contractor/oaks surface) | LIGHT (link+asset only; separate brand) | NO |
| `/sites/oaks/services/roof-repair` | sites (contractor/oaks surface) | LIGHT (link+asset only; separate brand) | NO |
| `/sites/oaks/services/roof-replacement` | sites (contractor/oaks surface) | LIGHT (link+asset only; separate brand) | NO |
| `/sites/oaks/services/siding-repair` | sites (contractor/oaks surface) | LIGHT (link+asset only; separate brand) | NO |
| `/sites/oaks/services/siding-replacement` | sites (contractor/oaks surface) | LIGHT (link+asset only; separate brand) | NO |
| `/sites/template` | sites (contractor/oaks surface) | LIGHT (link+asset only; separate brand) | NO |
| `/storm-alerts` | unique high-value | EXHAUSTIVE | yes |
| `/storm-check` | unique high-value | EXHAUSTIVE | yes |
| `/storm-report` | unique high-value | EXHAUSTIVE | NO |
| `/the-pledge` | unique high-value | EXHAUSTIVE | yes |
| `/tools` | internal ops hub | LIGHT (verify not homeowner-exposed) | NO |
| `/visualizer` | unique high-value | EXHAUSTIVE | yes |

## Tier counts

- TEMPLATE+SAMPLE: 164
- EXHAUSTIVE: 34
- LIGHT: 14
- OUT-OF-SCOPE: 6
- SKIP: 1
- FINDING: 1

Total pages on disk (excl. docs/pro): 220
Sitemap entries: 195 — all resolve to disk files (0 sitemap 404s)
