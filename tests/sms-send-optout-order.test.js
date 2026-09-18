/**
 * tests/sms-send-optout-order.test.js
 *
 * WHY THIS EXISTS
 * ───────────────
 * docs/pro/js/nbd-comms.js answers some sendSMS failures by opening the rep's
 * own Messages app with the text filled in — a "handoff". A handoff is a text
 * to that person, so it is only safe after the server has read the TCPA
 * opt-out register and found the number clean. Three ways that was not true
 * (fail-open audit, 2026-09-18):
 *
 *   1. ORDER. sendSMS ran the paid gate (402) and three limiters (429) BEFORE
 *      the opt-out check, and the client hands off on 402/429. The
 *      per-recipient counter also counted attempts to opted-out numbers, so
 *      the 6th attempt of the day to a STOP'd number came back 429 and the
 *      client staged the text in Messages.
 *   2. READ ERRORS. OptOut.isOptedOut throws on a Firestore error (on
 *      purpose), sendSMS let it escape, and the framework answered with a
 *      plain-text 500 — indistinguishable, client-side, from a Twilio outage,
 *      which the client hands off.
 *   3. TWILIO'S OWN STOP LIST. Twilio refuses an unsubscribed recipient with
 *      error 21610. That came back as the generic 500 too, so a homeowner
 *      Twilio knew had opted out (and our register had missed) got a handoff.
 *
 * This file drives the REAL exported handlers in functions/sms-functions.js —
 * with the REAL functions/sms-optout.js underneath — against stubbed firebase
 * modules at the module loader (the google-reviews-not-configured.test.js
 * idiom). Every gate appends to one event log, so ordering is asserted from
 * what the handler DID, not from where a string sits in the source.
 *
 * Pure Node, no functions/ install needed. Run:
 *   node tests/sms-send-optout-order.test.js
 */
'use strict';

const path = require('path');
const Module = require('module');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

const FUNCTIONS = path.join(__dirname, '..', 'functions');
const MOD = path.join(FUNCTIONS, 'sms-functions.js');

const PHONE_TYPED = '(859) 555-0134';
const KEY = '8595550134';                 // OptOut.optOutKey(PHONE_TYPED)
const OPT_DOC = 'sms_opt_outs/' + KEY;

// ── One loader hook for the whole run ──────────────────────────────────
// sms-functions.js requires `twilio` LAZILY, inside the handler, so the stub
// has to stay reachable while handlers run — not only while the module loads.
// `world` is swapped per scenario.
let world = null;
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (world) {
    const stub = world.stubs[request];
    if (stub !== undefined) return stub;
  }
  return realLoad.apply(this, arguments);
};

function makeWorld(opts) {
  opts = opts || {};
  const events = [];
  const writes = [];
  const smsLog = [];
  const logs = { error: [], warn: [], info: [] };
  const docs = Object.assign({}, opts.docs || {});
  const limited = new Set(opts.limited || []);
  const twilioCalls = [];

  const docRef = (p) => ({
    get: async () => {
      if (p.startsWith('sms_opt_outs/')) {
        events.push('optout-read');
        if (opts.optOutReadThrows) throw new Error('simulated Firestore UNAVAILABLE');
      }
      return { exists: docs[p] != null, data: () => docs[p] };
    },
    set: async (data) => {
      if (p.startsWith('sms_opt_outs/') && opts.optOutWriteThrows) throw new Error('simulated write failure');
      events.push('write:' + p);
      writes.push({ path: p, data });
      docs[p] = data;
    },
    update: async (data) => { events.push('update:' + p); writes.push({ path: p, data, update: true }); },
    delete: async () => { delete docs[p]; },
  });
  const db = {
    doc: docRef,
    collection: (name) => ({
      add: async (row) => { if (name === 'sms_log') smsLog.push(row); return { id: 'x' }; },
      doc: (id) => docRef(name + '/' + id),
    }),
  };

  const rateLimitErr = () => { const e = new Error('Rate limit exceeded'); e.rateLimited = true; return e; };

  const stubs = {
    'firebase-functions/v2/https': { onRequest: (o, h) => ({ __opts: o, __handler: h }) },
    'firebase-functions/v2/firestore': {
      onDocumentUpdated: (o, h) => ({ __handler: h }),
      onDocumentCreated: (o, h) => ({ __handler: h }),
    },
    'firebase-functions/params': { defineSecret: (n) => ({ name: n, value: () => 'secret-' + n }) },
    'firebase-functions/v2': {
      logger: {
        error: (...a) => logs.error.push(a),
        warn: (...a) => logs.warn.push(a),
        info: (...a) => logs.info.push(a),
      },
    },
    'firebase-admin/firestore': {
      getFirestore: () => db,
      FieldValue: { serverTimestamp: () => '__server_ts__' },
    },
    'firebase-admin/auth': {
      getAuth: () => ({
        verifyIdToken: async () => {
          events.push('auth');
          if (opts.unauthenticated) throw new Error('bad token');
          return { uid: 'rep-1', companyId: 'co-1', email_verified: true };
        },
      }),
    },
    'firebase-admin/messaging': { getMessaging: () => ({}) },
    './integrations/upstash-ratelimit': {
      httpRateLimit: async (req, res, ns) => {
        events.push('limit:' + ns);
        if (limited.has(ns)) { res.status(429).json({ error: 'Too many requests' }); return false; }
        return true;
      },
      enforceRateLimit: async (ns) => {
        events.push('limit:' + ns);
        if (limited.has(ns)) throw rateLimitErr();
        return { count: 1 };
      },
      clientIp: () => '203.0.113.9',
    },
    './shared': {
      requirePaidSubscription: async () => {
        events.push('paid-gate');
        return opts.unpaid
          ? { ok: false, status: 402, error: 'An active paid subscription is required.' }
          : { ok: true, plan: 'growth' };
      },
    },
    './handlers/ai-texting': { generateAIDraft: async () => null, ANTHROPIC_API_KEY: { value: () => '' } },
    './ai-draft-routing': { isPortalDraft: () => false, clampPortalText: (s) => s },
    './portal-reply-effects': { applyRepReplyEffects: async () => {} },
    './integrations/heartbeat': { onSchedule: (o, h) => ({ __handler: h }) },
    twilio: () => ({
      messages: {
        create: async (msg) => {
          events.push('twilio-create');
          twilioCalls.push(msg);
          if (opts.twilioError) throw opts.twilioError;
          return { sid: 'SM-test-1' };
        },
      },
    }),
  };

  return { stubs, events, writes, smsLog, logs, docs, twilioCalls };
}

function load(opts) {
  world = makeWorld(opts);
  // Fresh copies each time: sms-functions.js caches the twilio SDK in a
  // module-level variable, and sms-optout.js must bind to this world's stubs.
  for (const f of ['sms-functions.js', 'sms-optout.js', 'phone-utils.js', 'inbound-sms-route-logic.js']) {
    delete require.cache[path.join(FUNCTIONS, f)];
  }
  const exported = require(MOD);
  return { exported, world };
}

// firebase-functions v2 onRequest wraps the handler (withErrorHandler) and
// answers an uncaught throw with a plain-text 500. Mirror that, so a handler
// that lets an error escape fails an assertion instead of crashing the suite.
async function invoke(handler, req, res) {
  try {
    await handler(req, res);
  } catch (e) {
    res.statusCode = 500;
    res.body = 'Internal Server Error';
    res.threw = e;
  }
}

function mkRes() {
  const r = { statusCode: 200, body: undefined, headers: {} };
  r.set = (k, v) => { r.headers[k] = v; return r; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.send = (b) => { r.body = b; return r; };
  return r;
}

async function callSendSMS(opts, bodyOverride) {
  const { exported, world: w } = load(opts);
  const res = mkRes();
  await invoke(exported.sendSMS.__handler, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
    body: bodyOverride || { to: PHONE_TYPED, body: 'Hi Sam — checking in on your roof.', leadId: 'lead-1' },
  }, res);
  return { res, w, exported };
}

async function callSendD2DSMS(opts) {
  const knock = { userId: 'rep-1', companyId: 'co-1', phone: PHONE_TYPED, firstName: 'Sam', repName: 'Joe' };
  const docs = Object.assign({ 'knocks/knock-1': knock }, (opts && opts.docs) || {});
  const { exported, world: w } = load(Object.assign({}, opts, { docs }));
  const res = mkRes();
  await invoke(exported.sendD2DSMS.__handler, {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
    body: { knockId: 'knock-1', templateKey: 'follow_up' },
  }, res);
  return { res, w };
}

const idx = (events, name) => events.indexOf(name);
const GATES = ['limit:sendSMS:ip', 'paid-gate', 'limit:sendSMS:uid', 'limit:sendSMS:to'];
const OPTED_OUT = { [OPT_DOC]: { phone: '+18595550134', keyword: 'STOP' } };

(async () => {
  // ═══ sendSMS ═══════════════════════════════════════════════════════════
  console.log('sendSMS — opt-out precedes the paid gate and every limiter');
  {
    // Every other gate is primed to refuse. The old order answered 429 (the
    // per-IP limiter ran first) and the client handed that off to Messages.
    const { res, w } = await callSendSMS({
      docs: OPTED_OUT,
      unpaid: true,
      limited: ['sendSMS:ip', 'sendSMS:uid', 'sendSMS:to'],
    });
    ok('opted-out number answers 403 even with the paid gate and all limiters refusing',
      res.statusCode === 403, 'got ' + res.statusCode + ' ' + JSON.stringify(res.body));
    ok('403 carries code "opted_out" AND the human error text (older clients read error)',
      res.body && res.body.code === 'opted_out' && /opted out/i.test(res.body.error || ''));
    ok('no paid gate, no limiter touched: an opted-out attempt burns no bucket',
      GATES.every((g) => idx(w.events, g) === -1), w.events.join(' > '));
    ok('Twilio never called', w.twilioCalls.length === 0);
    ok('the opt-out read ran after auth', idx(w.events, 'auth') > -1 && idx(w.events, 'optout-read') > idx(w.events, 'auth'));
  }
  {
    const { res, w } = await callSendSMS({ limited: ['sendSMS:to'] });
    ok('a per-recipient 429 now comes only after a clean opt-out read',
      res.statusCode === 429 && idx(w.events, 'optout-read') > -1
      && idx(w.events, 'optout-read') < idx(w.events, 'limit:sendSMS:to'), w.events.join(' > '));
  }
  {
    const { res, w } = await callSendSMS({ limited: ['sendSMS:uid'] });
    ok('a per-uid 429 now comes only after a clean opt-out read',
      res.statusCode === 429 && idx(w.events, 'optout-read') > -1
      && idx(w.events, 'optout-read') < idx(w.events, 'limit:sendSMS:uid'), w.events.join(' > '));
  }
  {
    const { res, w } = await callSendSMS({ limited: ['sendSMS:ip'] });
    ok('the per-IP 429 now comes only after a clean opt-out read',
      res.statusCode === 429 && idx(w.events, 'optout-read') > -1
      && idx(w.events, 'optout-read') < idx(w.events, 'limit:sendSMS:ip'), w.events.join(' > '));
  }
  {
    const { res, w } = await callSendSMS({ unpaid: true });
    ok('a 402 now comes only after a clean opt-out read',
      res.statusCode === 402 && idx(w.events, 'optout-read') > -1
      && idx(w.events, 'optout-read') < idx(w.events, 'paid-gate'), w.events.join(' > '));
  }
  {
    const { res, w } = await callSendSMS({ unauthenticated: true });
    ok('unauthenticated: 401 before the register is read (no anonymous opt-out oracle)',
      res.statusCode === 401 && idx(w.events, 'optout-read') === -1);
  }
  {
    const { res, w } = await callSendSMS({}, { to: '555-0134', body: 'x' });
    ok('invalid "to": 400 before the register is read',
      res.statusCode === 400 && idx(w.events, 'optout-read') === -1);
  }

  console.log('sendSMS — register read error fails CLOSED with a distinguishable 503');
  {
    const { res, w } = await callSendSMS({ optOutReadThrows: true });
    ok('isOptedOut throwing answers 503', res.statusCode === 503, 'got ' + res.statusCode);
    ok('503 carries code "optout_unverified" and an error message',
      res.body && res.body.code === 'optout_unverified' && typeof res.body.error === 'string' && res.body.error.length > 0);
    ok('Twilio never called when opt-out status is unknown', w.twilioCalls.length === 0);
    ok('no limiter or paid gate reached on an unverified number', GATES.every((g) => idx(w.events, g) === -1));
    ok('the read error is logged', w.logs.error.some((a) => a[0] === 'optout_check_error'));
  }

  console.log('sendSMS — Twilio 21610 (recipient on Twilio\'s STOP list)');
  {
    const err = Object.assign(new Error('Attempt to send to unsubscribed recipient'), { code: 21610, status: 400 });
    const { res, w, exported } = await callSendSMS({ twilioError: err });
    ok('21610 answers 403, not a provider error the client would hand off',
      res.statusCode === 403 && res.body && res.body.code === 'opted_out', res.statusCode + ' ' + JSON.stringify(res.body));
    const rec = w.writes.find((x) => x.path === OPT_DOC);
    ok('21610 records the opt-out under the canonical register key', !!rec, w.writes.map((x) => x.path).join(','));
    ok('the recorded opt-out is tagged source "twilio_21610"', rec && rec.data && rec.data.source === 'twilio_21610');
    ok('the attempt is logged as failed in sms_log', w.smsLog.some((r) => r.status === 'failed'));

    // End to end: the NEXT send to the same person (same loaded module and
    // world, so the register now holds the record) must stop at our check.
    const res2 = mkRes();
    const before = w.twilioCalls.length;
    await invoke(exported.sendSMS.__handler, {
      method: 'POST', headers: { authorization: 'Bearer t' },
      body: { to: '+1 859-555-0134', body: 'second try' },
    }, res2);
    ok('a follow-up send (different formatting) is refused by the register, Twilio untouched',
      res2.statusCode === 403 && res2.body.code === 'opted_out' && w.twilioCalls.length === before);
  }
  {
    const err = Object.assign(new Error('unsubscribed'), { code: '21610' });
    const { res } = await callSendSMS({ twilioError: err, optOutWriteThrows: true });
    ok('21610 still answers 403 when recording the opt-out fails (best-effort record)',
      res.statusCode === 403 && res.body && res.body.code === 'opted_out', res.statusCode);
  }

  console.log('sendSMS — other Twilio failures are a distinguishable provider_error');
  {
    const err = Object.assign(new Error("The 'To' number is not a valid phone number"), { code: 21608 });
    const { res, w } = await callSendSMS({ twilioError: err });
    ok('non-21610 Twilio error answers 502', res.statusCode === 502, 'got ' + res.statusCode);
    ok('502 carries code "provider_error" and the legacy error text',
      res.body && res.body.code === 'provider_error' && res.body.error === 'Failed to send SMS');
    ok('a non-21610 error writes nothing to the register', !w.writes.some((x) => x.path.startsWith('sms_opt_outs/')));
  }
  {
    const { res, w } = await callSendSMS({});
    ok('clean number, all gates open: 200 with the Twilio sid',
      res.statusCode === 200 && res.body && res.body.success === true && res.body.sid === 'SM-test-1');
    ok('sent row logged', w.smsLog.some((r) => r.status === 'sent' && r.twilioSid === 'SM-test-1'));
    ok('happy path runs opt-out read before every gate and Twilio last',
      GATES.every((g) => idx(w.events, 'optout-read') < idx(w.events, g))
      && idx(w.events, 'twilio-create') > idx(w.events, 'limit:sendSMS:to'), w.events.join(' > '));
  }

  // ═══ sendD2DSMS ════════════════════════════════════════════════════════
  console.log('sendD2DSMS — same fail-closed contract once the recipient is known');
  {
    const { res, w } = await callSendD2DSMS({ docs: OPTED_OUT, limited: ['sendSMS:to'] });
    ok('opted-out knock answers 403 opted_out, not the per-recipient 429',
      res.statusCode === 403 && res.body && res.body.code === 'opted_out', res.statusCode + ' ' + JSON.stringify(res.body));
    ok('the per-recipient bucket is not touched for an opted-out knock', idx(w.events, 'limit:sendSMS:to') === -1);
    ok('Twilio never called (D2D opted out)', w.twilioCalls.length === 0);
  }
  {
    const { res, w } = await callSendD2DSMS({ optOutReadThrows: true });
    ok('D2D: isOptedOut throwing answers 503 optout_unverified',
      res.statusCode === 503 && res.body && res.body.code === 'optout_unverified', res.statusCode);
    ok('D2D: Twilio never called when opt-out status is unknown', w.twilioCalls.length === 0);
  }
  {
    const err = Object.assign(new Error('unsubscribed'), { code: 21610 });
    const { res, w } = await callSendD2DSMS({ twilioError: err });
    ok('D2D: 21610 answers 403 opted_out', res.statusCode === 403 && res.body && res.body.code === 'opted_out');
    ok('D2D: 21610 records the opt-out', w.writes.some((x) => x.path === OPT_DOC && x.data.source === 'twilio_21610'));
    ok('D2D: knock not stamped lastSmsSent on a refused send', !w.events.includes('update:knocks/knock-1'));
  }
  {
    const err = Object.assign(new Error('Twilio down'), { code: 20500 });
    const { res } = await callSendD2DSMS({ twilioError: err });
    ok('D2D: other Twilio error answers 502 provider_error',
      res.statusCode === 502 && res.body && res.body.code === 'provider_error');
  }
  {
    const { res, w } = await callSendD2DSMS({});
    ok('D2D happy path: 200 and knock stamped',
      res.statusCode === 200 && res.body && res.body.success === true && w.events.includes('update:knocks/knock-1'));
    ok('D2D: opt-out read precedes the per-recipient limiter',
      idx(w.events, 'optout-read') > -1 && idx(w.events, 'optout-read') < idx(w.events, 'limit:sendSMS:to'), w.events.join(' > '));
  }

  world = null;
  Module._load = realLoad;

  console.log('\n──────────────────────────────────────────────────');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('\nFailures:');
    fails.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
})().catch((e) => {
  console.error('suite crashed:', e && e.stack || e);
  process.exit(1);
});
