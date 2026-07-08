/**
 * tests/monthly-overhead-logic.test.js — pure logic for the monthly
 * overhead alert cron (functions/monthly-overhead-logic.js). No firebase
 * imports, runs in bare node. Run: node tests/monthly-overhead-logic.test.js
 */
'use strict';

const L = require('../functions/monthly-overhead-logic');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }
function eq(name, a, b) { ok(name + ' (' + JSON.stringify(a) + ' === ' + JSON.stringify(b) + ')', a === b); }

// A Firestore-Timestamp-like wrapper (has toDate()).
function ts(iso) { const d = new Date(iso); return { toDate: () => d }; }

console.log('MONTHLY OVERHEAD LOGIC — date helpers');
// A UTC instant just after ET midnight resolves to the ET calendar day.
eq('etYmd on a Timestamp (ET day)', L.etYmd(ts('2026-06-15T12:00:00Z')), '2026-06-15');
eq('etYmd on a Date', L.etYmd(new Date('2026-06-15T12:00:00Z')), '2026-06-15');
eq('etYmd on a string', L.etYmd('2026-06-15T12:00:00Z'), '2026-06-15');
ok('etYmd null on nullish', L.etYmd(null) === null && L.etYmd(undefined) === null);
ok('etYmd null on garbage', L.etYmd('not-a-date') === null);
// TZ edge: 2026-07-01T02:00Z is still 2026-06-30 22:00 in ET.
eq('etYmd respects ET offset at UTC midnight boundary', L.etYmd(ts('2026-07-01T02:00:00Z')), '2026-06-30');
eq('monthKeyOf slices YYYY-MM', L.monthKeyOf('2026-06-15'), '2026-06');
ok('monthKeyOf null-safe', L.monthKeyOf(null) === null);

console.log('MONTHLY OVERHEAD LOGIC — monthKeysAt');
// Cron fires 2026-07-01 → last month June, prior May.
const mk = L.monthKeysAt(new Date('2026-07-01T13:00:00Z'));
eq('lastKey is the month that just ended', mk.lastKey, '2026-06');
eq('priorKey is the month before that', mk.priorKey, '2026-05');
eq('lastLabel human month', mk.lastLabel, 'June 2026');
ok('queryStart is before May 1 (2-day buffer)', mk.queryStart.getTime() < Date.UTC(2026, 4, 1));
ok('queryStart is within 3 days before May 1', Date.UTC(2026, 4, 1) - mk.queryStart.getTime() <= 3 * 86400000);
// January rollover: fires 2026-01-01 → last Dec 2025, prior Nov 2025.
const mkJan = L.monthKeysAt(new Date('2026-01-01T13:00:00Z'));
eq('Jan rollover lastKey', mkJan.lastKey, '2025-12');
eq('Jan rollover priorKey', mkJan.priorKey, '2025-11');
eq('Jan rollover label', mkJan.lastLabel, 'December 2025');

console.log('MONTHLY OVERHEAD LOGIC — fmtCents / prettyCategory / escapeHtml');
eq('fmtCents 123456', L.fmtCents(123456), '$1,234.56');
eq('fmtCents 0', L.fmtCents(0), '$0.00');
eq('fmtCents rounds half-cent', L.fmtCents(1234.6), '$12.35');
eq('fmtCents junk -> $0.00', L.fmtCents('abc'), '$0.00');
eq('prettyCategory phone_internet', L.prettyCategory('phone_internet'), 'Phone Internet');
eq('prettyCategory single', L.prettyCategory('insurance'), 'Insurance');
eq('prettyCategory empty -> Uncategorized', L.prettyCategory(''), 'Uncategorized');
eq('escapeHtml angle+amp', L.escapeHtml('<b>&"\''), '&lt;b&gt;&amp;&quot;&#39;');

console.log('MONTHLY OVERHEAD LOGIC — summarizeOverhead bucketing');
const docs = [
  // co1 — June (last month) overhead
  { companyId: 'co1', costType: 'overhead', category: 'insurance', amountCents: 50000, date: ts('2026-06-05T12:00:00Z') },
  { companyId: 'co1', costType: 'overhead', category: 'vehicle_fuel', amountCents: 20000, date: ts('2026-06-20T12:00:00Z') },
  { companyId: 'co1', costType: 'overhead', category: 'insurance', amountCents: 10000, date: ts('2026-06-25T12:00:00Z') },
  // co1 — a DIRECT cost in June must be ignored
  { companyId: 'co1', costType: 'direct', category: 'materials', amountCents: 999900, date: ts('2026-06-10T12:00:00Z') },
  // co1 — May (prior month) overhead → priorTotal only
  { companyId: 'co1', costType: 'overhead', category: 'software', amountCents: 30000, date: ts('2026-05-15T12:00:00Z') },
  // co1 — April is out of both windows → ignored
  { companyId: 'co1', costType: 'overhead', category: 'software', amountCents: 77700, date: ts('2026-04-15T12:00:00Z') },
  // co2 — only prior-month spend, nothing last month
  { companyId: 'co2', costType: 'overhead', category: 'marketing', amountCents: 40000, date: ts('2026-05-03T12:00:00Z') },
  // missing companyId → skipped; zero/negative cents → skipped
  { companyId: null, costType: 'overhead', category: 'insurance', amountCents: 10000, date: ts('2026-06-05T12:00:00Z') },
  { companyId: 'co1', costType: 'overhead', category: 'office_supplies', amountCents: 0, date: ts('2026-06-05T12:00:00Z') },
];
const map = L.summarizeOverhead(docs, '2026-06', '2026-05');
const co1 = map.get('co1');
eq('co1 last-month total (50000+20000+10000, direct excluded)', co1.totalCents, 80000);
eq('co1 last-month count', co1.count, 3);
eq('co1 prior-month total (May only, April excluded)', co1.priorTotalCents, 30000);
eq('co1 insurance category merged (50000+10000)', co1.byCategory.insurance, 60000);
ok('co1 did NOT bucket the direct materials cost', co1.byCategory.materials === undefined);
const co2 = map.get('co2');
eq('co2 has zero last-month total (prior only)', co2.totalCents, 0);
eq('co2 prior total', co2.priorTotalCents, 40000);
ok('null-company doc was skipped', !map.has(null));

console.log('MONTHLY OVERHEAD LOGIC — buildEmail');
const email = L.buildEmail(co1, 'June 2026');
ok('subject has total + month', /Overhead spend — \$800\.00 in June 2026/.test(email.subject));
ok('plain lists categories sorted desc (insurance before vehicle)',
  email.bodyPlain.indexOf('Insurance') < email.bodyPlain.indexOf('Vehicle Fuel'));
ok('plain shows delta vs prior ($800 vs $300 = +$500)', /\+\$500\.00 vs the month before/.test(email.bodyPlain));
ok('html escapes + includes total', email.bodyHtml.indexOf('$800.00') !== -1);
// A company with no prior spend gets the "no overhead recorded" phrasing.
const freshEmail = L.buildEmail({ totalCents: 12345, count: 1, byCategory: { marketing: 12345 }, priorTotalCents: 0 }, 'June 2026');
ok('no-prior phrasing', /no overhead recorded the month before/.test(freshEmail.bodyPlain));
ok('singular "expense" when count is 1', /1 expense\b/.test(freshEmail.bodyPlain) && !/1 expenses/.test(freshEmail.bodyPlain));

console.log('MONTHLY OVERHEAD LOGIC — alertMarkerId (idempotency, #7)');
eq('marker id is company_month', L.alertMarkerId('co-a', '2026-06'), 'co-a_2026-06');
ok('marker id stable for same (company, month)', L.alertMarkerId('co-a', '2026-06') === L.alertMarkerId('co-a', '2026-06'));
ok('marker id differs by month', L.alertMarkerId('co-a', '2026-06') !== L.alertMarkerId('co-a', '2026-07'));
ok('marker id differs by company', L.alertMarkerId('co-a', '2026-06') !== L.alertMarkerId('co-b', '2026-06'));

console.log('\n' + (failed === 0 ? '✓' : '✗') + ' monthly overhead logic: ' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILURES:\n  ' + fails.join('\n  ')); process.exit(1); }
