/* booking-events-tenancy.test.js — the multi-event booking catalog must
 * never hand a non-NBD tenant an NBD calendar link.
 *
 * Background: crm-portal-bridge.js's _repBookingUrl() was fixed once for
 * exactly this ("a contractor who never configured Cal.com texted his
 * homeowner a link to the platform owner's calendar, and every booking
 * landed there"). The fix landed in one file; customer-bootstrap.module.js
 * still did `calSettings.username || 'nobigdeal'` with no tenant check.
 * docs/pro/js/booking-events.js is now the single resolver for both, so
 * this suite pins the resolution table.
 *
 * The module is loaded into a vm sandbox with a fake window/localStorage
 * rather than regex-matched, so these assertions run the real branching.
 *
 * Break-test note (2026-09-07): the obvious "non-NBD tenant with nothing
 * configured" case does NOT cover the house-USERNAME guard — slugFor()
 * already returns '' there, so urlFor() is empty either way and deleting
 * the guard keeps the suite green. The case that actually covers it is a
 * tenant with a per-kind slug and no username; with the guard removed that
 * yields https://cal.com/nobigdeal/<their-slug>. Keep it.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MODULE = path.join(__dirname, '..', 'docs', 'pro', 'js', 'booking-events.js');
const CODE = fs.readFileSync(MODULE, 'utf8');

function load({ rep = {}, brand = null, storage = {} } = {}) {
  const window = {};
  window._currentRep = rep;
  window._brand = () => brand;
  const localStorage = { getItem: (k) => (k in storage ? storage[k] : null) };
  const sandbox = { window, localStorage, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(CODE, sandbox);
  return window.NBDBooking;
}

let passed = 0, failed = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label + '\n      got:  ' + g + '\n      want: ' + w); }
}
function group(name, fn) { console.log('\n' + name); fn(); }

group('NBD tenant — all six house events resolve', () => {
  const B = load({ rep: { calcomUsername: 'nobigdeal', calcomEventSlug: 'roof-inspection' }, brand: null });
  eq('six distinct options', B.options().length, 6);
  eq('inspection', B.urlFor('inspection'), 'https://cal.com/nobigdeal/roof-inspection');
  eq('question', B.urlFor('question'), 'https://cal.com/nobigdeal/roof-question-call');
  eq('adjuster', B.urlFor('adjuster'), 'https://cal.com/nobigdeal/adjuster-meeting');
  eq('estimate', B.urlFor('estimate'), 'https://cal.com/nobigdeal/estimate-walkthrough');
  eq('gutters', B.urlFor('gutters'), 'https://cal.com/nobigdeal/gutter-siding-estimate');
  eq('lexington', B.urlFor('lexington'), 'https://cal.com/nobigdeal/roof-inspection-lexington');
});

group('Non-NBD tenant with their own single slug — no NBD slug leaks', () => {
  const B = load({
    rep: { calcomUsername: 'acme-roofing', calcomEventSlug: 'free-estimate' },
    brand: { legalName: 'Acme Roofing LLC' }
  });
  const opts = B.options();
  eq('exactly one option', opts.length, 1);
  eq('and it is theirs', opts[0].url, 'https://cal.com/acme-roofing/free-estimate');
  eq('adjuster unavailable', B.urlFor('adjuster'), '');
  eq('gutters unavailable', B.urlFor('gutters'), '');
  eq('no NBD slug in any option', opts.filter((o) => /nobigdeal|adjuster-meeting|roof-question-call/.test(o.url)).length, 0);
});

group('Non-NBD tenant with nothing configured — declines rather than inventing', () => {
  const B = load({ rep: {}, brand: { legalName: 'Acme Roofing LLC' } });
  eq('zero options', B.options().length, 0);
  eq('inspection empty', B.urlFor('inspection'), '');
});

group('Non-NBD tenant, per-kind slugs but NO username — covers the house-username guard', () => {
  const B = load({
    rep: { calcomEventSlugs: { adjuster: 'acme-adjuster' } },
    brand: { legalName: 'Acme Roofing LLC' }
  });
  eq('no username => no url', B.urlFor('adjuster'), '');
  eq('never borrows the house username', B.urlFor('adjuster').indexOf('nobigdeal'), -1);
  eq('zero options', B.options().length, 0);
});

group('Non-NBD tenant with an explicit per-kind map', () => {
  const B = load({
    rep: {
      calcomUsername: 'acme-roofing',
      calcomEventSlug: 'free-estimate',
      calcomEventSlugs: { adjuster: 'acme-adjuster', gutters: 'acme-gutters' }
    },
    brand: { legalName: 'Acme Roofing LLC' }
  });
  eq('three options', B.options().length, 3);
  eq('adjuster is theirs', B.urlFor('adjuster'), 'https://cal.com/acme-roofing/acme-adjuster');
  eq('unmapped kind stays unavailable', B.urlFor('question'), '');
});

group('Legacy localStorage cache still resolves (reps who never re-saved)', () => {
  const B = load({
    rep: {},
    brand: null,
    storage: { nbd_cal_settings: JSON.stringify({ username: 'nobigdeal', eventSlug: 'roof-inspection' }) }
  });
  eq('inspection from cache', B.urlFor('inspection'), 'https://cal.com/nobigdeal/roof-inspection');
});

group('Dedupe — one slug answering several kinds renders once', () => {
  const B = load({
    rep: { calcomUsername: 'solo', calcomEventSlug: 'visit', calcomEventSlugs: { adjuster: 'visit' } },
    brand: { legalName: 'Solo Roofing' }
  });
  eq('deduped to one', B.options().length, 1);
});

group('suggest() picks the visit that matches where the job is', () => {
  const B = load({ rep: {}, brand: null });
  eq('cold lead -> inspection', B.suggest({ stage: 'New' }), 'inspection');
  eq('estimate sent -> estimate', B.suggest({ stage: 'Estimate Sent' }), 'estimate');
  eq('awaiting signature -> estimate', B.suggest({ stage: 'New', signatureStatus: 'sent' }), 'estimate');
  eq('open claim -> adjuster', B.suggest({ stage: 'Inspected', insCarrier: 'State Farm' }), 'adjuster');
  eq('gutter job -> gutters', B.suggest({ stage: 'New', damageType: 'Gutter - Wind' }), 'gutters');
  eq('siding job -> gutters', B.suggest({ stage: 'New', damageType: 'Siding damage' }), 'gutters');
  eq('finished job -> inspection', B.suggest({ stage: 'Complete', signatureStatus: 'signed' }), 'inspection');
  eq('no lead at all -> inspection', B.suggest(null), 'inspection');
});

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
