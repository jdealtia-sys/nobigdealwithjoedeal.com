/**
 * tests/smoke/swath-signature.test.js — Swath webhook HMAC verifier
 *
 * Behavioral unit tests (real fn calls, same pattern as
 * photo-vision-sanitizer.test.js) for verifySwathSignature in
 * functions/integrations/swath.js. The scheme is Stripe-style:
 *   X-Swath-Signature: t=<unix>,v1=hex(hmac_sha256(secret, t + "." + body))
 * with a ±300s replay window. These tests pin the accept/reject
 * behavior so a refactor can't silently widen it.
 */
'use strict';

const path = require('path');
const crypto = require('crypto');
const { FUNCTIONS } = require('./_shared');

function run(ctx) {
  const { assert, section } = ctx;

  section('Swath webhook signature — verifySwathSignature behavior');

  const { verifySwathSignature } = require(path.join(FUNCTIONS, 'integrations/swath.js'));

  const secret = 'whsec_smoke_test_secret';
  const body = JSON.stringify({ event: 'storm.verified', storm: { id: 'st_smoke_1' } });
  const nowMs = 1754400000000; // fixed clock — verifier takes nowMs explicitly
  const t = Math.floor(nowMs / 1000);
  const sign = (ts, sec, b) => 't=' + ts + ',v1='
    + crypto.createHmac('sha256', sec).update(ts + '.' + b).digest('hex');

  assert('valid signature verifies',
    verifySwathSignature(Buffer.from(body), sign(t, secret, body), secret, nowMs).ok === true);
  assert('valid signature verifies from a string body too',
    verifySwathSignature(body, sign(t, secret, body), secret, nowMs).ok === true);
  assert('uppercase hex digest still verifies',
    verifySwathSignature(Buffer.from(body),
      sign(t, secret, body).replace(/v1=.*$/, (m) => m.toUpperCase().replace('V1=', 'v1=')),
      secret, nowMs).ok === true);

  assert('wrong secret is rejected',
    verifySwathSignature(Buffer.from(body), sign(t, 'not-the-secret', body), secret, nowMs).ok === false);
  assert('tampered body is rejected',
    verifySwathSignature(Buffer.from(body + ' '), sign(t, secret, body), secret, nowMs).ok === false);
  assert('signature timestamp swapped after signing is rejected',
    // header claims t+10 but the HMAC was computed over t — the timestamp
    // is inside the signed material, so editing it must break the match.
    verifySwathSignature(Buffer.from(body),
      sign(t, secret, body).replace('t=' + t, 't=' + (t + 10)), secret, nowMs).ok === false);

  assert('stale timestamp (>300s past) is rejected as stale',
    verifySwathSignature(Buffer.from(body), sign(t - 301, secret, body), secret, nowMs).reason === 'stale');
  assert('future timestamp (>300s ahead) is rejected as stale',
    verifySwathSignature(Buffer.from(body), sign(t + 301, secret, body), secret, nowMs).reason === 'stale');
  assert('timestamp just inside the window verifies',
    verifySwathSignature(Buffer.from(body), sign(t - 299, secret, body), secret, nowMs).ok === true);

  assert('malformed header is rejected as malformed',
    verifySwathSignature(Buffer.from(body), 'v1=deadbeef', secret, nowMs).reason === 'malformed');
  assert('short digest is rejected as malformed',
    verifySwathSignature(Buffer.from(body), 't=' + t + ',v1=abc123', secret, nowMs).reason === 'malformed');
  assert('missing header is rejected',
    verifySwathSignature(Buffer.from(body), '', secret, nowMs).ok === false);
  assert('missing secret is rejected (fail closed)',
    verifySwathSignature(Buffer.from(body), sign(t, secret, body), '', nowMs).reason === 'no-secret');

  section('Swath normalizers — absent fields stay null (no fabricated zeros)');

  // Adversarial review 2026-08-06 finding #1: Number(null)===0, so a naive
  // num() turned ABSENT fields into 0 — (0,0) storm coordinates poisoning
  // the D2D territory hull, $0 assessed values, year-built 0. These pin
  // the root fix (num(null) → null) and its two blast radii.
  const { _test } = require(path.join(FUNCTIONS, 'integrations/swath.js'));

  assert('num(null) is null, not 0', _test.num(null) === null);
  assert('num(undefined) is null', _test.num(undefined) === null);
  assert('num(0) is still 0', _test.num(0) === 0);
  assert('num("1.75") parses', _test.num('1.75') === 1.75);

  const bare = _test.normalizeStormEvent({ id: 'st_9', lat: 38.1, lng: -84.5, max_size: 1.5 });
  assert('storm with top-level lat/lng (no centroid) keeps its coordinates',
    bare.lat === 38.1 && bare.lng === -84.5 && bare.stormId === 'st_9');
  const coordless = _test.normalizeStormEvent({ id: 'st_10', max_size: 2 });
  assert('storm with no coordinates normalizes to null lat/lng, not (0,0)',
    coordless.lat === null && coordless.lng === null);
  const nested = _test.normalizeStormEvent({ storm_id: 'st_11', centroid: { lat: 37.9, lon: -84.2 }, hail_max_in: '1.25' });
  assert('storm with nested centroid + string size normalizes',
    nested.lat === 37.9 && nested.lng === -84.2 && nested.sizeInches === 1.25);

  const sparse = _test.normalizeSwathParcel({ address: '123 Main St', owner: 'Jane Doe' });
  assert('sparse parcel record keeps absent numerics null (no $0 assessed / year 0)',
    sparse.yearBuilt === null && sparse.assessedValue === null && sparse.acres === null
    && sparse.sqft === null && sparse.lat === null && sparse.lng === null
    && sparse.roofAge === null && sparse.exposureHailIn === null);
  assert('sparse parcel record keeps real fields',
    sparse.owner === 'Jane Doe' && sparse.address === '123 Main St' && sparse.source === 'swath');
}

module.exports = { run };
