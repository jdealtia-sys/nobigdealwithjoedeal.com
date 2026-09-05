/**
 * tests/swdi-hail.test.js
 *
 * WHY THIS EXISTS
 * ───────────────
 * functions/integrations/swdi-hail.js adds NCEI's radar hail index as a free,
 * keyless hail provider. Two things about the service were learned by
 * probing it on 2026-09-04 and contradict the research note that scoped the
 * work: a request may span at most 744 hours (31 days), and the end date is
 * EXCLUSIVE at midnight UTC (`20260516:20260517` returns a 05-16 cell;
 * `20260516:20260516` returns nothing). Get either wrong and the lookup
 * silently returns fewer storms than happened — the failure mode that looks
 * like "no hail here". These cases pin both, plus the radius filter that
 * turns the service's bbox into the radius the caller asked for.
 *
 * Fixture rows are real responses captured from the live endpoint on
 * 2026-09-04 (Cincinnati bbox, April–June 2026).
 *
 * Pure-Node, no network (fetch is injected). Run: node tests/swdi-hail.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const swdi = require(path.join(ROOT, 'functions', 'integrations', 'swdi-hail.js'));
const {
  swdiWindows, bboxFor, parseSwdiPoint, haversineMiles, normalizeSwdiRows,
  buildSwdiUrl, fetchSwdiHail, WINDOW_DAYS,
} = swdi;

let passed = 0, failed = 0;
const fails = [];
function ok(label, cond, detail) {
  if (cond) { console.log('  ✓ ' + label); passed++; }
  else { console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); failed++; fails.push(label); }
}
function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/mg, '');
}
const DAY = 86_400_000;
const ymdToMs = (s) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));

// Real rows, 2026-09-04 probe.
const ROW_MAY = { PROB: '100', SHAPE: 'POINT (-84.6633139809288 38.9034873472459)', WSR_ID: 'KILN', CELL_ID: 'Z4', ZTIME: '2026-05-16T13:13:23Z', SEVPROB: '40', MAXSIZE: '0.75' };
const ROW_JUN = { PROB: '100', SHAPE: 'POINT (-84.2524803941339 39.161508284387)', WSR_ID: 'KCVG', CELL_ID: 'K3', ZTIME: '2026-06-18T07:00:26Z', SEVPROB: '10', MAXSIZE: '0.5' };
const ROW_APR = { PROB: '100', SHAPE: 'POINT (-84.4317771135133 38.9257386390196)', WSR_ID: 'KIND', CELL_ID: 'M1', ZTIME: '2026-04-01T17:38:24Z', SEVPROB: '40', MAXSIZE: '0.75' };

console.log('\nWINDOWS — the 744-hour cap, honoured without gaps or overlap');
{
  const NOW = Date.UTC(2026, 8, 4, 15, 30); // 2026-09-04T15:30Z
  const w365 = swdiWindows(NOW - 365 * DAY, NOW);
  ok('a 365-day lookup is chunked (not one request the service would reject)', w365.length > 1);
  ok('every window is ≤ 31 days', w365.every((w) => (ymdToMs(w.end) - ymdToMs(w.start)) / DAY <= 31));
  ok('every window is ≥ 1 day (no empty start:start windows, which return nothing)',
     w365.every((w) => ymdToMs(w.end) > ymdToMs(w.start)));
  ok('windows are contiguous — each end is the next start (exclusive end = no double counting)',
     w365.every((w, i) => i === 0 || w365[i - 1].end === w.start));
  ok('the first window starts on the UTC day of (now − 365 d)', w365[0].start === '20250904');
  ok('the last window ends the day AFTER today — otherwise today\'s storms are silently dropped',
     w365[w365.length - 1].end === '20260905');
  ok('windows use the configured step', (ymdToMs(w365[0].end) - ymdToMs(w365[0].start)) / DAY === WINDOW_DAYS);

  const w7 = swdiWindows(NOW - 7 * DAY, NOW);
  ok('a 7-day lookup is one window', w7.length === 1 && w7[0].start === '20260828' && w7[0].end === '20260905');
  const w730 = swdiWindows(NOW - 730 * DAY, NOW);
  ok('a 730-day lookup (the callable\'s max) is ~25 windows', w730.length >= 24 && w730.length <= 26, String(w730.length));
  ok('a windowDays above the service cap is clamped to 31',
     swdiWindows(NOW - 100 * DAY, NOW, 45).every((w) => (ymdToMs(w.end) - ymdToMs(w.start)) / DAY <= 31));
}

console.log('\nPOINTS + DISTANCE');
{
  const p = parseSwdiPoint(ROW_MAY.SHAPE);
  ok('POINT (lng lat) parses in that order', p && p.lat > 38 && p.lat < 39 && p.lng < -84);
  ok('garbage shape → null', parseSwdiPoint('LINESTRING (1 2, 3 4)') === null && parseSwdiPoint(undefined) === null);
  ok('out-of-range coordinates → null', parseSwdiPoint('POINT (200 10)') === null);
  ok('Cincinnati → Lexington is ~78 mi', Math.abs(haversineMiles(39.1031, -84.5120, 38.0406, -84.5037) - 73.4) < 3);
  ok('a point is 0 mi from itself', haversineMiles(39.1, -84.5, 39.1, -84.5) === 0);
  const b = bboxFor(39.1031, -84.5120, 3);
  ok('bbox is minLon,minLat,maxLon,maxLat around the point',
     b.minLon < -84.512 && b.maxLon > -84.512 && b.minLat < 39.1031 && b.maxLat > 39.1031);
}

console.log('\nNORMALIZATION — hail.js\'s hit shape, radius enforced, honest sizes');
{
  const center = { lat: 39.1031, lng: -84.5120 }; // downtown Cincinnati
  const all = normalizeSwdiRows([ROW_APR, ROW_MAY, ROW_JUN], { ...center, radiusMi: 50 });
  ok('all three real rows survive a 50-mile radius', all.length === 3);
  ok('newest first', all[0].at === ROW_JUN.ZTIME && all[2].at === ROW_APR.ZTIME);
  ok('source is swdi', all.every((h) => h.source === 'swdi'));
  ok('sizeInches is MAXSIZE as a number', all.find((h) => h.cellId === 'Z4').sizeInches === 0.75);
  ok('lat/lng come from SHAPE', Math.abs(all.find((h) => h.cellId === 'K3').lat - 39.1615) < 0.001);
  ok('radar + cell + severe probability are carried', all.every((h) => h.radar && h.cellId && typeof h.severeProbability === 'number'));
  ok('remark names the radar, cell, severe % and size',
     /Radar KILN cell Z4 · 40% severe · max 0.75 in/.test(all.find((h) => h.cellId === 'Z4').remark));

  const near = normalizeSwdiRows([ROW_APR, ROW_MAY, ROW_JUN], { ...center, radiusMi: 3 });
  ok('a 3-mile radius drops cells that were only inside the bbox rectangle', near.length === 0);
  const kcvg = normalizeSwdiRows([ROW_JUN], { lat: 39.1615, lng: -84.2525, radiusMi: 1 });
  ok('…and keeps a cell that is actually within it', kcvg.length === 1 && kcvg[0].distanceMi < 0.1);

  const odd = normalizeSwdiRows([
    { ...ROW_MAY, MAXSIZE: '0' }, { ...ROW_MAY, MAXSIZE: 'n/a' }, { ...ROW_MAY, SHAPE: 'nope' }, { ...ROW_MAY, ZTIME: 'yesterday' },
  ], { ...center, radiusMi: 50 });
  // odd[] is newest-first; all four share ZTIME except the 'yesterday' row
  // (at:null → sorts last), and the 'nope' row is dropped — so [0],[1] are
  // the two doctored MAXSIZE rows in some order and [2] is the bad-ZTIME row.
  ok('MAXSIZE "0" and unparsable MAXSIZE → null, not 0 (the scorer reads null as size-unknown)',
     odd[0].sizeInches === null && odd[1].sizeInches === null);
  ok('a row with a good MAXSIZE keeps it even when another field is bad', odd[2].sizeInches === 0.75);
  ok('a row with no parsable point is dropped, not placed at 0,0', odd.length === 3);
  ok('an unparsable ZTIME → at:null rather than a throw', odd.some((h) => h.at === null));
  ok('non-array input → []', normalizeSwdiRows(null, { ...center, radiusMi: 5 }).length === 0);
}

(async () => {
console.log('\nFETCH — URL shape, chunk fan-out, failure propagates (so NOAA fallback engages)');
{
  const NOW = Date.UTC(2026, 8, 4, 15, 30);
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    const m = /nx3hail\/(\d{8}):(\d{8})\?bbox=/.exec(url);
    const rows = [];
    // Put the May row in whichever window covers 2026-05-16 (exclusive end).
    if (m && ymdToMs(m[1]) <= Date.UTC(2026, 4, 16) && Date.UTC(2026, 4, 16) < ymdToMs(m[2])) rows.push(ROW_MAY);
    return { ok: true, status: 200, json: async () => ({ swdiJsonResponse: {}, result: rows, summary: { count: rows.length } }) };
  };
  const hits = await fetchSwdiHail(38.9035, -84.6633, 5, 180, { fetchImpl: fakeFetch, now: NOW });
  ok('180 days → several requests, each ≤31 days',
     calls.length >= 6 && calls.every((u) => { const m = /(\d{8}):(\d{8})/.exec(u); return (ymdToMs(m[2]) - ymdToMs(m[1])) / DAY <= 31; }));
  ok('every URL is the nx3hail JSON endpoint with a bbox', calls.every((u) => u.startsWith(swdi.SWDI_BASE) && /\?bbox=-?\d/.test(u)));
  ok('the May cell is found exactly once (no double counting across window seams)', hits.length === 1 && hits[0].cellId === 'Z4');
  ok('buildSwdiUrl matches the live format', buildSwdiUrl({ start: '20260501', end: '20260531' }, bboxFor(39.1, -84.5, 3))
     .startsWith('https://www.ncei.noaa.gov/swdiws/json/nx3hail/20260501:20260531?bbox='));

  let threw = null;
  try {
    await fetchSwdiHail(39.1, -84.5, 3, 60, { now: NOW, fetchImpl: async () => ({
      ok: false, status: 500, json: async () => ({ error: "ERROR VALIDATING 'dateRange=startDate:endDate'." }),
    }) });
  } catch (e) { threw = e; }
  ok('an HTTP 500 window throws (lookupHail turns that into the NOAA fallback)', threw && /SWDI 500/.test(threw.message));
  ok('…and carries the service\'s error text for the log', threw && /dateRange/.test(threw.message));

  const empty = await fetchSwdiHail(39.1, -84.5, 3, 20, { now: NOW, fetchImpl: async () => ({
    ok: true, status: 200, json: async () => ({ swdiJsonResponse: {}, result: [], summary: { count: 0 } }),
  }) });
  ok('an empty month is [] (HTTP 200 with result: [] is how NCEI says "nothing")', Array.isArray(empty) && empty.length === 0);
}

console.log('\nSOURCE CONTRACT — hail.js actually exposes the provider');
{
  const hail = codeOnly(fs.readFileSync(path.join(ROOT, 'functions', 'integrations', 'hail.js'), 'utf8'));
  ok('hail.js imports fetchSwdiHail from swdi-hail', /require\(\s*['"]\.\/swdi-hail['"]\s*\)/.test(hail));
  ok('swdi is registered in HAIL_FETCHERS', /HAIL_FETCHERS\s*=\s*\{[^}]*\bswdi:\s*fetchSwdiHail/.test(hail));
  ok('preferredHailProvider selects swdi on the env switch alone (no key to gate on)',
     /PROVIDERS\.hail\s*===\s*['"]swdi['"]\s*\)\s*return\s*['"]swdi['"]/.test(hail));
  ok('swdi is chosen BEFORE the noaa default (otherwise the switch is dead)',
     hail.indexOf("=== 'swdi'") < hail.indexOf("return 'noaa';"));
  const cron = codeOnly(fs.readFileSync(path.join(ROOT, 'functions', 'integrations', 'hail-cron.js'), 'utf8'));
  ok('hailMatchCron is untouched — it started scoring real leads on 2026-09-05 and stays on its own fetcher for now',
     !/swdi/i.test(cron));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('FAILED:\n  - ' + fails.join('\n  - ')); process.exit(1); }
})().catch((e) => { console.error('test crashed:', e); process.exit(1); });
