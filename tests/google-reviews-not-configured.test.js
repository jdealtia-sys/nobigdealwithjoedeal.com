/**
 * tests/google-reviews-not-configured.test.js
 *
 * WHY THIS EXISTS
 * ───────────────
 * getGoogleReviews shipped with GOOGLE_PLACES_API_KEY and NBD_PLACE_ID
 * holding the deploy's `__unset__` stub — verified in Secret Manager on
 * 2026-09-08, and there has never been a successful Places fetch. The
 * missing-secret check threw into the same catch that handles a Google
 * outage, so EVERY request logged `logger.error('refresh failed')`:
 * 1,000+ ERROR lines in 48 hours on a function whose real fault rate was
 * zero. 976 of 999 of those requests came from CI's hosting emulator
 * (referer http://127.0.0.1:5000), not from customers.
 *
 * Two failure modes this pins, in both directions:
 *
 *   1. The unconfigured state going LOUD again — one ERROR per request,
 *      which buries a genuine Places outage in an identical line.
 *   2. The unconfigured state going SILENT. Downgrading severity is only
 *      safe while the condition is still reported. A fallback that hides
 *      total failure is how renderPdf stayed 100% down for 11 weeks, so
 *      this asserts the warn IS emitted and carries the machine-matchable
 *      `event` field, not merely that the error stopped.
 *
 * It drives the REAL exported handler against stubbed firebase modules at
 * the module loader (the address-audit-script.test.js idiom) — no
 * functions/ install, no credentials, no network — and counts observed
 * log calls and fetches rather than matching source strings. A shape regex
 * would have passed against the throwing version too.
 *
 * Pure-Node. Run: node tests/google-reviews-not-configured.test.js
 */
'use strict';

const path = require('path');
const Module = require('module');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

/**
 * Structured payload of the Nth warn call, or {} when it was never made.
 *
 * Not a convenience: reverting the fix to prove this suite can fail made an
 * assertion that indexed logs.warn[0][1] directly throw a TypeError, which
 * aborted the run and swallowed every remaining case. A regression suite
 * whose failure mode is a stack trace reports less than one that fails
 * cleanly, so every warn read goes through here.
 */
function warnMeta(logs, n = 0) {
  const call = logs.warn[n];
  return (call && call[1]) || {};
}

const MOD = path.join(__dirname, '..', 'functions', 'google-reviews.js');
const STUB = '__unset__';

/**
 * Load functions/google-reviews.js with every firebase dependency stubbed
 * and return a driver.
 *
 * opts.secrets  — { GOOGLE_PLACES_API_KEY, NBD_PLACE_ID } raw secret values
 * opts.docs     — { '<path>': <data|null> } Firestore doc contents
 * opts.fetch    — async () => Response-ish, or null to fail the call
 */
function load(opts) {
  const secrets = opts.secrets || {};
  const docs = opts.docs || {};
  const logs = { error: [], warn: [], info: [] };
  const fetches = [];
  const writes = [];

  const db = {
    doc: (p) => ({
      get: async () => ({ exists: docs[p] != null, data: () => docs[p] }),
      set: async (data) => { writes.push({ path: p, data }); },
    }),
  };

  const stubs = {
    'firebase-functions/v2/https': { onRequest: (o, h) => ({ __opts: o, __handler: h }) },
    'firebase-functions/params': { defineSecret: (n) => ({ name: n, value: () => secrets[n] }) },
    'firebase-functions/v2': {
      logger: {
        error: (...a) => logs.error.push(a),
        warn: (...a) => logs.warn.push(a),
        info: (...a) => logs.info.push(a),
      },
    },
    'firebase-admin/firestore': { getFirestore: () => db },
  };

  const realLoad = Module._load;
  Module._load = function (request, parent) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    // guardHttp is exercised by its own suite; pass the handler through so
    // this suite tests the handler body rather than the limiter.
    if (request === './rate-limit-policy') return { guardHttp: (n, h) => h };
    return realLoad.apply(this, arguments);
  };

  // Global fetch is what fetchFromGoogle() calls. Counting invocations is
  // the assertion that matters for the unconfigured path: the point of the
  // fix is that no Google call is even ATTEMPTED.
  const realFetch = global.fetch;
  global.fetch = async (url, init) => {
    fetches.push({ url, init });
    if (!opts.fetch) throw new Error('simulated network failure');
    return opts.fetch();
  };

  let exported;
  try {
    delete require.cache[require.resolve(MOD)];
    delete require.cache[require.resolve(path.join(__dirname, '..', 'functions', 'integrations', '_shared.js'))];
    exported = require(MOD);
  } finally {
    Module._load = realLoad;
  }

  const handler = exported.getGoogleReviews.__handler;

  /** Drive one request; returns { status, body, headers }. */
  async function request() {
    const headers = {};
    const res = {
      set: (k, v) => { headers[k] = v; },
      status: (code) => ({ json: (body) => ({ status: code, body, headers }) }),
    };
    const realFetchInner = global.fetch;
    global.fetch = async (url, init) => {
      fetches.push({ url, init });
      if (!opts.fetch) throw new Error('simulated network failure');
      return opts.fetch();
    };
    try {
      return await handler({ headers: {} }, res);
    } finally {
      global.fetch = realFetchInner;
    }
  }

  global.fetch = realFetch;
  return { request, logs, fetches, writes };
}

const okResponse = (payload) => () => ({
  ok: true,
  status: 200,
  json: async () => payload,
  text: async () => JSON.stringify(payload),
});

const REAL_PLACES = {
  displayName: { text: 'No Big Deal Home Solutions' },
  rating: 5,
  userRatingCount: 42,
  googleMapsUri: 'https://maps.google.com/x',
  reviews: [{
    authorAttribution: { displayName: 'A Customer' },
    rating: 5,
    text: { text: 'Great work' },
    relativePublishTimeDescription: 'a week ago',
    publishTime: '2026-09-01T00:00:00Z',
  }],
};

(async () => {
  // ── 1. The regression itself: production's exact state. ──────────────
  console.log('\nUNCONFIGURED (both secrets are the __unset__ stub), cold cache');
  {
    const t = load({ secrets: { GOOGLE_PLACES_API_KEY: STUB, NBD_PLACE_ID: STUB }, docs: {} });
    const results = [];
    for (let i = 0; i < 20; i++) results.push(await t.request());

    ok('20 requests log ZERO errors (was 20 — one per request)',
      t.logs.error.length === 0, 'saw ' + t.logs.error.length);
    ok('the condition is still reported — exactly one warn, not silence',
      t.logs.warn.length === 1, 'saw ' + t.logs.warn.length);
    ok('the warn carries the machine-matchable event field an alert can select on',
      t.logs.warn.length === 1 &&
      t.logs.warn.length === 1 && warnMeta(t.logs).event === 'google_reviews_not_configured');
    ok('the warn names BOTH secrets and the runbook, so it is actionable alone',
      t.logs.warn.length === 1 &&
      warnMeta(t.logs).GOOGLE_PLACES_API_KEY === 'unset-or-stub' &&
      warnMeta(t.logs).NBD_PLACE_ID === 'unset-or-stub' &&
      /google-reviews\.README/.test(warnMeta(t.logs).runbook || ''));
    ok('no Google call is attempted — the stub can never succeed',
      t.fetches.length === 0, t.fetches.length + ' fetches');
    ok('never overwrites the cache doc with an empty payload',
      t.writes.length === 0);

    // Customer-visible contract: degraded, never broken.
    ok('every response is still 200 (widget renders its Google card, page intact)',
      results.every((r) => r.status === 200));
    ok('body says WHY it is empty — reason:not_configured, diagnosable by curl',
      results[0].body.reason === 'not_configured' && results[0].body.empty === true);
    ok('cold unconfigured payload gets the longer 300s edge TTL',
      results[0].headers['Cache-Control'] === 'public, max-age=300');
  }

  // ── 2. The opposite direction: real faults must stay loud. ───────────
  console.log('\nCONFIGURED but Google fails — the genuine-outage path stays at ERROR');
  {
    const t = load({
      secrets: { GOOGLE_PLACES_API_KEY: 'AIza-real', NBD_PLACE_ID: 'ChIJ-real' },
      docs: {}, fetch: null,
    });
    const r = await t.request();
    ok('a real refresh failure still logs an error (not downgraded with it)',
      t.logs.error.length === 1, 'saw ' + t.logs.error.length);
    ok('a real failure emits no not-configured warn',
      t.logs.warn.length === 0);
    ok('Google WAS called when the secrets are real',
      t.fetches.length === 1);
    ok('body reason distinguishes an outage from a missing secret',
      r.body.reason === 'refresh_failed');
    ok('a transient failure keeps the SHORT 60s TTL so recovery is quick',
      r.headers['Cache-Control'] === 'public, max-age=60');
  }

  // ── 3. The happy path still works. ───────────────────────────────────
  console.log('\nCONFIGURED and Google answers — the fix did not break the working path');
  {
    const t = load({
      secrets: { GOOGLE_PLACES_API_KEY: 'AIza-real', NBD_PLACE_ID: 'ChIJ-real' },
      docs: {}, fetch: okResponse(REAL_PLACES),
    });
    const r = await t.request();
    ok('serves live reviews', r.status === 200 && r.body.reviews.length === 1 && r.body.rating === 5);
    ok('writes the fresh snapshot to the cache doc', t.writes.length === 1);
    ok('logs nothing at all on the happy path',
      t.logs.error.length === 0 && t.logs.warn.length === 0);
  }

  // ── 4. Fallbacks the refactor moved into serveFallback(). ────────────
  console.log('\nFALLBACK CHAIN — unconfigured must still serve real reviews when we have them');
  {
    const stale = { data: { name: 'NBD', rating: 5, total: 9, profileUrl: '', reviews: [{ author: 'Old' }] }, fetchedAt: 1 };
    const t = load({
      secrets: { GOOGLE_PLACES_API_KEY: STUB, NBD_PLACE_ID: STUB },
      docs: { 'public_cache/google_reviews': stale },
    });
    const r = await t.request();
    ok('stale Places cache is served rather than an empty payload',
      r.body.reviews.length === 1 && r.body.stale === true);
    ok('and it is still flagged not_configured for diagnosis',
      r.body.reason === 'not_configured');
  }
  {
    const gbp = { data: { name: 'NBD', rating: 5, total: 30, profileUrl: '', reviews: [{ author: 'G' }] }, fetchedAt: 1 };
    const t = load({
      secrets: { GOOGLE_PLACES_API_KEY: STUB, NBD_PLACE_ID: STUB },
      docs: { 'siteContent/googleReviews': gbp },
    });
    const r = await t.request();
    ok('a STALE GBP full set still beats an empty payload (source flag intact)',
      r.body.reviews.length === 1 && r.body.source === 'gbp' && r.body.stale === true);
  }
  {
    const fresh = { data: { name: 'NBD', rating: 5, total: 30, profileUrl: '', reviews: [{ author: 'G' }] }, fetchedAt: Date.now() };
    const t = load({
      secrets: { GOOGLE_PLACES_API_KEY: STUB, NBD_PLACE_ID: STUB },
      docs: { 'siteContent/googleReviews': fresh },
    });
    const r = await t.request();
    ok('a FRESH GBP doc short-circuits before the config check — no warn at all',
      r.body.source === 'gbp' && r.body.stale === false && t.logs.warn.length === 0);
  }
  {
    const fresh = { data: { name: 'NBD', rating: 5, total: 9, profileUrl: '', reviews: [{ author: 'C' }] }, fetchedAt: Date.now() };
    const t = load({
      secrets: { GOOGLE_PLACES_API_KEY: STUB, NBD_PLACE_ID: STUB },
      docs: { 'public_cache/google_reviews': fresh },
    });
    const r = await t.request();
    ok('a FRESH Places cache is served without reaching the config check',
      r.body.cached === true && r.body.stale === false && t.logs.warn.length === 0);
  }

  // ── 5. Only one secret set is still unconfigured. ────────────────────
  console.log('\nPARTIAL CONFIGURATION — one real value is not configuration');
  {
    const t = load({
      secrets: { GOOGLE_PLACES_API_KEY: 'AIza-real', NBD_PLACE_ID: STUB },
      docs: {},
    });
    const r = await t.request();
    ok('key set + place id stubbed → not_configured, no Google call',
      r.body.reason === 'not_configured' && t.fetches.length === 0 && t.logs.error.length === 0);
    ok('the warn distinguishes WHICH secret is missing',
      warnMeta(t.logs).GOOGLE_PLACES_API_KEY === 'set' &&
      warnMeta(t.logs).NBD_PLACE_ID === 'unset-or-stub');
  }

  console.log('\n' + '─'.repeat(50));
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('\nFAILED:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
})();
