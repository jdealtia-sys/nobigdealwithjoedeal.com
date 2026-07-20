/**
 * scripts/add-hub-quick-lead-form.js — hub-capture sweep (2026-07-20, batch 3).
 *
 * All 121 city service pages + 25 areas pages embed the self-configuring
 * quick-lead form, but the 12 service HUBS had zero <form> elements — hub
 * traffic could only convert by phone or by bouncing to /#contact (the exact
 * intent-leak the quick form was built to close, see
 * docs/assets/js/quick-lead-form.js header).
 *
 * This injects the SAME embed the city variants use (no new submit path —
 * posts through the hardened submitPublicLead gateway: App Check fail-open,
 * server-side rate limit + honeypot) at the natural pre-footer position:
 * immediately before the .final-cta closer, mirroring the city-page order
 * (content → qlf-section#quote → closing CTA).
 *
 * Hubs are service-scoped, not city-scoped, so data-service is set and
 * data-city is omitted (the form's heading/copy self-adjusts).
 *
 * Idempotent: pages already carrying data-nbd-quick-form are skipped.
 * Run: node scripts/add-hub-quick-lead-form.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SERVICES = path.join(__dirname, '..', 'docs', 'services');

// hub file → human service label (flows into the lead payload service field)
const HUBS = {
  'financing': 'Financing',
  'fire-water-smoke-damage': 'Fire, Water &amp; Smoke Damage',
  'gutter-replacement': 'Gutter Replacement',
  'hail-damage-insurance-claim': 'Hail Damage Insurance Claim',
  'roof-care-plan': 'Roof Care Plan',
  'roof-cleaning-soft-wash': 'Roof Cleaning &amp; Soft Wash',
  'roof-inspection': 'Roof Inspection',
  'roof-repair': 'Roof Repair',
  'roof-replacement': 'Roof Replacement',
  'siding-repair': 'Siding Repair',
  'siding-replacement': 'Siding Replacement',
  'storm-damage': 'Storm Damage',
};

const CSS_LINK = '<link rel="stylesheet" href="/assets/css/mobile-cta.css">';
const QLF_CSS = '<link rel="stylesheet" href="/assets/css/quick-lead-form.css">';
const QLF_JS = '<script defer src="/assets/js/quick-lead-form.js"></script>';
const FINAL_CTA = '<section class="final-cta">';

let changed = 0, skipped = 0, failed = 0;

for (const [hub, service] of Object.entries(HUBS)) {
  const file = path.join(SERVICES, hub + '.html');
  let s = fs.readFileSync(file, 'utf8');

  if (s.includes('data-nbd-quick-form')) {
    console.log('  = ' + hub + '.html already has the quick-lead form, skipping');
    skipped++;
    continue;
  }

  const missing = [CSS_LINK, FINAL_CTA, '</body>'].filter((a) => !s.includes(a));
  if (missing.length) {
    console.error('  ✗ ' + hub + '.html missing anchor(s): ' + missing.join(' | '));
    failed++;
    continue;
  }

  // 1. Stylesheet — right after mobile-cta.css, matching city-page head order.
  if (!s.includes('quick-lead-form.css')) {
    s = s.replace(CSS_LINK, CSS_LINK + '\n' + QLF_CSS);
  }

  // 2. Embed — pre-footer, immediately before the .final-cta closer.
  const section =
    '<!-- QUICK LEAD FORM (injected, hub-capture sweep 2026-07-20) — same embed as the city/areas pages; posts through the hardened submitPublicLead gateway -->\n' +
    '<section class="qlf-section" id="quote"><div class="qlf-wrap"><div data-nbd-quick-form data-service="' + service + '"></div></div></section>\n';
  s = s.replace(FINAL_CTA, section + FINAL_CTA);

  // 3. Renderer — before </body>, matching city-page placement.
  s = s.replace('</body>', QLF_JS + '\n</body>');

  fs.writeFileSync(file, s);
  console.log('  ✓ ' + hub + '.html — data-service="' + service + '"');
  changed++;
}

console.log('\n' + changed + ' injected, ' + skipped + ' skipped, ' + failed + ' failed');
if (failed) process.exit(1);
