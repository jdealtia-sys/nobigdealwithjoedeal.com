/**
 * tests/storm-watch-active-subscriber-2026-09-16.test.js
 *
 * functions/storm-watch.js's stormWatch cron and functions/sms-functions.js's
 * checkStormAlerts cron both query storm_alert_subscribers and text everyone
 * they find in range of a qualifying event. active:true is server-stamped on
 * every subscriber (functions/handlers/integrations.js's serverDefaults,
 * never client-trusted) specifically so an opted-out subscriber stops
 * matching every alert query — checkStormAlerts already filters on it
 * (.where('active', '==', true), sms-functions.js:958), but stormWatch's
 * query had no such filter, so an unsubscribed homeowner kept receiving
 * stormWatch's texts (though not checkStormAlerts's) after opting out.
 *
 * Fix: stormWatch's subscriber query now carries the same
 * .where('active', '==', true) filter as its sibling.
 *
 * Zero deps. Run: node tests/storm-watch-active-subscriber-2026-09-16.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}
function group(name, fn) { console.log('\n' + name); fn(); }

const STORM_WATCH = read('functions/storm-watch.js');
const SMS_FUNCTIONS = read('functions/sms-functions.js');
const INTEGRATIONS = read('functions/handlers/integrations.js');

console.log('storm-watch.js — subscriber query filters on active:true\n');

group('storm-watch.js\'s subscriber query now filters on active', () => {
  const idx = STORM_WATCH.indexOf("db.collection('storm_alert_subscribers')");
  ok('found the subscriber query', idx >= 0);
  const line = STORM_WATCH.slice(idx, STORM_WATCH.indexOf('\n', idx) + 1);
  ok('the query chains .where(\'active\', \'==\', true) before .get()',
    /\.where\('active', '==', true\)/.test(line), line);
});

group('the sibling checkStormAlerts cron already has this filter (confirms the pattern this fix matches)', () => {
  const idx = SMS_FUNCTIONS.indexOf("db.collection('storm_alert_subscribers')");
  ok('found the sibling subscriber query', idx >= 0);
  const block = idx >= 0 ? SMS_FUNCTIONS.slice(idx, idx + 200) : '';
  ok('it filters on active too', /\.where\('active', '==', true\)/.test(block), block);
});

group('active:true is server-stamped, never client-trusted (confirms the field is meaningful to filter on)', () => {
  ok('integrations.js documents storm signups getting active:true server-side',
    /active:\s*true/.test(INTEGRATIONS) && /serverDefaults/.test(INTEGRATIONS));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILED:\n  - ' + fails.join('\n  - ')); process.exit(1); }
