#!/usr/bin/env node
/*
 * Tier 2 (2026-07): normalize the machine-generated location-page templates.
 * The service/location variants were emitted in several batches and drifted:
 * 6+ title suffix/format variants, 5 different Service.serviceType strings for
 * the same service, 3 breadcrumb spellings for the same parent URL. Google
 * reads that as churned templates; normalizing tightens keyword consistency.
 *
 * Scope (deliberately conservative — no H1/body copy changes):
 *  1. <title> + og:title brand suffix: "| No Big Deal Home Solutions" and
 *     "| Joe Deal" -> "| NBD" (majority form, and shortest for the 60-char
 *     SERP budget). Only on services/*-{city}-{oh,ky}.html pages.
 *  2. Service.serviceType: one canonical string per service family.
 *  3. Breadcrumb label for /services/hail-damage-insurance-claim: visible
 *     anchors + BreadcrumbList names unify on "Hail Damage Claims"
 *     (the 62-page majority; "Services"-labeled crumbs are a different
 *     template style and are left alone).
 *
 * Idempotent.
 */
const fs = require('fs');
const path = require('path');

const DOCS = path.resolve(__dirname, '..', 'docs');
const SVC = path.join(DOCS, 'services');

// filename-prefix -> canonical serviceType (order matters: first match wins)
const SERVICE_TYPES = [
  ['hail-damage-insurance-claim-', 'Hail Damage Insurance Claims'],
  ['hail-damage-', 'Hail Damage Repair'],
  ['storm-damage-', 'Storm Damage Repair'],
  ['roof-replacement-', 'Roof Replacement'],
  ['roof-repair-', 'Roof Repair'],
  ['siding-replacement-', 'Siding Replacement'],
  ['siding-repair-', 'Siding Repair'],
  ['gutter-replacement-', 'Gutter Replacement'],
];

const CITY_PAGE = /^[a-z-]+-(oh|ky)\.html$/;

let stats = { titles: 0, serviceTypes: 0, crumbs: 0, files: 0 };

for (const name of fs.readdirSync(SVC)) {
  if (!CITY_PAGE.test(name)) continue;
  const file = path.join(SVC, name);
  const orig = fs.readFileSync(file, 'utf8');
  let s = orig;

  // 1. brand suffix in <title> and og:title
  s = s.replace(/(<title>[^<]*?) \| (?:No Big Deal Home Solutions|Joe Deal)<\/title>/, (m, head) => {
    stats.titles++;
    return head + ' | NBD</title>';
  });
  s = s.replace(/(<meta property="og:title" content="[^"]*?) \| (?:No Big Deal Home Solutions|Joe Deal)"/, '$1 | NBD"');

  // 2. canonical serviceType
  const fam = SERVICE_TYPES.find(([prefix]) => name.startsWith(prefix));
  if (fam) {
    s = s.replace(/("serviceType":\s*")([^"]+)(")/g, (m, a, val, z) => {
      if (val === fam[1]) return m;
      stats.serviceTypes++;
      return a + fam[1] + z;
    });
  }

  // 3. breadcrumb label for the hail-damage-insurance-claim parent
  s = s.replace(/(<a href="\/services\/hail-damage-insurance-claim">)(Hail Damage|Hail Damage Insurance Claims?)(<\/a>)/g, (m, a, label, z) => {
    if (label === 'Hail Damage Claims') return m;
    stats.crumbs++;
    return a + 'Hail Damage Claims' + z;
  });
  s = s.replace(/("name":\s*")(Hail Damage|Hail Damage Insurance Claims?)(",\s*"item":\s*"https:\/\/nobigdealwithjoedeal\.com\/services\/hail-damage-insurance-claim")/g, (m, a, label, z) => {
    stats.crumbs++;
    return a + 'Hail Damage Claims' + z;
  });

  if (s !== orig) {
    fs.writeFileSync(file, s);
    stats.files++;
  }
}
console.log(JSON.stringify(stats));
