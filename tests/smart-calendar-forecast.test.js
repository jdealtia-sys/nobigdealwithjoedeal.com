/**
 * tests/smart-calendar-forecast.test.js
 *
 * WHY THIS EXISTS
 * ───────────────
 * smart-calendar.js paints a rain-day chip on every scheduled job from the
 * NWS forecast (api.weather.gov — free, keyless). The failure modes that
 * matter are quiet ones: picking the wrong 12-hour period (a 4 pm inspection
 * shown with the overnight forecast), a probability of null rendered as
 * "0% rain", a forecast-URL hop followed to a host the CSP would block, and
 * a cache that never expires. This loads the real client file in a vm with a
 * stub window and drives the exposed pure helpers with a forecast captured
 * from the live endpoint on 2026-09-04 (Cincinnati, gridpoint ILN/36,38).
 *
 * Pure-Node, no network. Run: node tests/smart-calendar-forecast.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/mg, '');

let passed = 0, failed = 0;
const fails = [];
function ok(label, cond, detail) {
  if (cond) { console.log('  ✓ ' + label); passed++; }
  else { console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); failed++; fails.push(label); }
}

// ── load the client file with a minimal window/document ────────────────
const noop = () => {};
const win = {
  addEventListener: noop, fetch: async () => { throw new Error('network disabled in test'); },
  sessionStorage: null, CSS: { escape: (s) => s },
};
const doc = { addEventListener: noop, getElementById: () => null };
const ctx = { window: win, document: doc, console, setTimeout, Date, Number, Math, JSON, Array, String, Set, Promise, isFinite, Error };
ctx.getComputedStyle = () => ({ display: 'none' });
vm.createContext(ctx);
vm.runInContext(read('docs/pro/js/smart-calendar.js'), ctx, { filename: 'smart-calendar.js' });
const F = win.NBDForecast;

// Captured 2026-09-04 from https://api.weather.gov/gridpoints/ILN/36,38/forecast
const PERIODS_RAW = [
  { number: 1, name: 'Tonight', startTime: '2026-09-04T20:00:00-04:00', endTime: '2026-09-05T06:00:00-04:00', isDaytime: false, temperature: 74, temperatureUnit: 'F', probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: 24 }, shortForecast: 'Slight Chance Rain Showers then Slight Chance Showers And Thunderstorms' },
  { number: 2, name: 'Saturday', startTime: '2026-09-05T06:00:00-04:00', endTime: '2026-09-05T18:00:00-04:00', isDaytime: true, temperature: 94, temperatureUnit: 'F', probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: 27 }, shortForecast: 'Slight Chance Showers And Thunderstorms' },
  { number: 3, name: 'Saturday Night', startTime: '2026-09-05T18:00:00-04:00', endTime: '2026-09-06T06:00:00-04:00', isDaytime: false, temperature: 67, temperatureUnit: 'F', probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: 28 }, shortForecast: 'Chance Showers And Thunderstorms then Partly Cloudy' },
  { number: 4, name: 'Sunday', startTime: '2026-09-06T06:00:00-04:00', endTime: '2026-09-06T18:00:00-04:00', isDaytime: true, temperature: 88, temperatureUnit: 'F', probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: null }, shortForecast: 'Sunny' },
];
const PERIODS = PERIODS_RAW.map(F.normalizePeriod);

console.log('\nLOAD');
ok('smart-calendar.js evaluates and exposes window.NBDForecast', !!F && typeof F.pickPeriod === 'function');
ok('window.loadSmartCalendar is still exposed (the existing contract)', typeof win.loadSmartCalendar === 'function');

console.log('\nPOINT KEYS — one forecast per ~1 km, never per appointment');
{
  ok('two decimals', F.forecastKey(39.10312, -84.51203) === '39.10,-84.51');
  ok('two houses 300 m apart share a key', F.forecastKey(39.1031, -84.5120) === F.forecastKey(39.1049, -84.5131));
  ok('missing / non-numeric coords → null (no request)', F.forecastKey(null, -84.5) === null && F.forecastKey('x', 1) === null);
  ok('out-of-range coords → null', F.forecastKey(120, 0) === null);
  ok('a lookup cap exists and is small', Number.isInteger(F.NWS_MAX_POINTS) && F.NWS_MAX_POINTS <= 8);
}

console.log('\nPERIOD CHOICE — the 12-hour block the job actually falls in');
{
  const sat10am = Date.parse('2026-09-05T10:00:00-04:00');
  const sat9pm = Date.parse('2026-09-05T21:00:00-04:00');
  ok('a 10 am Saturday appointment gets the Saturday daytime period', F.pickPeriod(PERIODS, sat10am).name === 'Saturday');
  ok('a 9 pm Saturday appointment gets Saturday Night, not the day', F.pickPeriod(PERIODS, sat9pm).name === 'Saturday Night');
  ok('boundary: exactly 18:00 belongs to the night period (end is exclusive)',
     F.pickPeriod(PERIODS, Date.parse('2026-09-05T18:00:00-04:00')).name === 'Saturday Night');
  ok('a date-only job (atMs 0) gets the first DAYTIME period, not "Tonight"', F.pickPeriod(PERIODS, 0).name === 'Saturday');
  ok('a time outside every period falls back to the first daytime period', F.pickPeriod(PERIODS, Date.parse('2026-09-20T12:00:00-04:00')).name === 'Saturday');
  ok('empty periods → null', F.pickPeriod([], 0) === null && F.pickPeriod(null, 0) === null);
}

console.log('\nNORMALIZATION — honest nulls');
{
  const sun = PERIODS[3];
  ok('a null probabilityOfPrecipitation.value stays null (NWS omits it for dry periods)', sun.pop === null);
  ok('…and is NOT rendered as 0% — the chip shows a dash', /—<\/span>|— rain/.test(F.renderForecastChip(sun)) || /— rain/.test(F.renderForecastChip(sun)));
  ok('temperature carried as a number', PERIODS[1].temp === 94);
  ok('garbage → null', F.normalizePeriod(null) === null && F.normalizePeriod('x') === null);
}

console.log('\nTHRESHOLDS — ≥60 high, 30–59 medium, <30 low, null unknown');
{
  ok('59 → medium, 60 → high', F.popLevel(59) === 'medium' && F.popLevel(60) === 'high');
  ok('29 → low, 30 → medium', F.popLevel(29) === 'low' && F.popLevel(30) === 'medium');
  ok('null / NaN → unknown', F.popLevel(null) === 'unknown' && F.popLevel('x') === 'unknown');
}

console.log('\nCOPY — fits a chip');
{
  ok('"then …" tail dropped', F.shortenForecast(PERIODS_RAW[0].shortForecast) === 'Slight chance Showers');
  ok('"Showers And Thunderstorms" → "T-storms"', F.shortenForecast('Chance Showers And Thunderstorms') === 'Chance T-storms');
  ok('plain text untouched', F.shortenForecast('Sunny') === 'Sunny');
}

console.log('\nRENDER — escaped, classed, no inline handlers');
{
  const chip = F.renderForecastChip({ ...PERIODS[1], shortForecast: '<img src=x onerror=alert(1)> Showers' });
  ok('forecast text is HTML-escaped in the chip', !/<img/.test(chip) && /&lt;img/.test(chip));
  ok('chip carries the level class', /sc-fc-low/.test(F.renderForecastChip(PERIODS[1])));
  ok('chip shows the rounded percentage and temperature', /27% rain/.test(F.renderForecastChip(PERIODS[1])) && /94°/.test(F.renderForecastChip(PERIODS[1])));
  ok('no on*= attributes anywhere (strict CSP: script-src-attr none)', !/\son\w+=/.test(F.renderForecastChip(PERIODS[1]) + F.renderRainSummary(PERIODS[1])));
  ok('summary line names the wettest stop\'s chance', /up to 27% chance/.test(F.renderRainSummary(PERIODS[1])));
  ok('summary is empty when the probability is unknown', F.renderRainSummary(PERIODS[3]) === '');
  ok('null chip input → empty string', F.renderForecastChip(null) === '');
}

(async () => {
console.log('\nFETCH — two hops, host-validated, cached for an hour');
{
  const calls = [];
  const pointsBody = { properties: { forecast: 'https://api.weather.gov/gridpoints/ILN/36,38/forecast' } };
  const forecastBody = { properties: { periods: PERIODS_RAW } };
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (/\/points\//.test(url)) return { ok: true, status: 200, json: async () => pointsBody };
    if (/\/gridpoints\//.test(url)) return { ok: true, status: 200, json: async () => forecastBody };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const mem = {}; const store = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
  const T0 = Date.parse('2026-09-05T12:00:00Z');

  const periods = await F.fetchForecast('39.10,-84.51', { fetchImpl, store, now: T0 });
  ok('first call: /points then the forecast URL it names', calls.length === 2 && /\/points\/39\.10,-84\.51$/.test(calls[0].url) && /\/gridpoints\/ILN\/36,38\/forecast$/.test(calls[1].url));
  ok('requests carry Accept geo+json and a User-Agent', calls.every((c) => c.opts.headers.Accept === 'application/geo+json' && /NBDProCRM/.test(c.opts.headers['User-Agent'])));
  ok('returns normalized periods', Array.isArray(periods) && periods.length === 4 && periods[1].pop === 27);
  ok('result cached under the prefixed key', Object.keys(mem).length === 1 && Object.keys(mem)[0] === F.NWS_CACHE_PREFIX + '39.10,-84.51');

  const again = await F.fetchForecast('39.10,-84.51', { fetchImpl, store, now: T0 + 30 * 60 * 1000 });
  ok('30 min later: served from cache, no new requests', calls.length === 2 && again.length === 4);

  await F.fetchForecast('39.10,-84.51', { fetchImpl, store, now: T0 + F.NWS_CACHE_TTL_MS + 1 });
  ok('after the TTL: refetched (2 more requests)', calls.length === 4);

  let threw = null;
  try {
    await F.fetchForecast('1.00,2.00', { store, now: T0, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ properties: { forecast: 'https://evil.example/forecast' } }) }) });
  } catch (e) { threw = e; }
  ok('a forecast URL on any host but api.weather.gov is refused, not followed', threw && /no forecast url/.test(threw.message));

  threw = null;
  try { await F.fetchForecast('3.00,4.00', { store, now: T0, fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) }); }
  catch (e) { threw = e; }
  ok('an HTTP failure throws (the caller logs and leaves the chip empty)', threw && /NWS points 503/.test(threw.message));

  const corrupt = { getItem: () => '{not json', setItem: noop };
  const viaCorrupt = await F.fetchForecast('39.10,-84.51', { fetchImpl, store: corrupt, now: T0 });
  ok('a corrupt cache entry is ignored, not fatal', Array.isArray(viaCorrupt) && viaCorrupt.length === 4);
}

console.log('\nSOURCE CONTRACT — wired into the render and allowed by CSP');
{
  const src = codeOnly(read('docs/pro/js/smart-calendar.js'));
  ok('appointment rows carry a forecast slot keyed by appointment id', /data-sc-forecast="\$\{_esc\(a\.id/.test(src));
  ok('date-only jobs carry a forecast slot keyed by lead id', /data-sc-forecast="\$\{_esc\(l\.id/.test(src));
  ok('the summary header carries the rain-summary slot', /data-sc-rain-summary/.test(src));
  ok('forecasts attach AFTER the first paint and never block it', /host\.innerHTML = html;[\s\S]{0,400}_attachForecasts\(host, appts, manualToday\)\.catch/.test(src));
  ok('no new inline <script> or on*= (external file, strict CSP)', !/\son\w+=["']/.test(src));

  const fb = JSON.parse(read('firebase.json'));
  const rule = fb.hosting.headers.find((h) => h.source === '**');
  const csps = rule.headers.filter((h) => /^Content-Security-Policy(-Report-Only)?$/.test(h.key));
  ok('both dashboard CSP headers already allow api.weather.gov in connect-src',
     csps.length === 2 && csps.every((h) => /connect-src [^;]*https:\/\/api\.weather\.gov/.test(h.value)));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('FAILED:\n  - ' + fails.join('\n  - ')); process.exit(1); }
})().catch((e) => { console.error('test crashed:', e); process.exit(1); });
