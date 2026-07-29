/**
 * tests/portal-ai-reply.test.js — the two halves of a portal AI reply that the
 * 2026-07-29 emulator QA found missing:
 *
 *   1. buildLeadContext (functions/handlers/ai-texting.js) must include the
 *      HOMEOWNER PORTAL thread. It read only notes(type=='sms') + activity
 *      labels, so the prompt for a homeowner's SECOND portal message literally
 *      said "(no prior text history — this is the first inbound SMS from this
 *      lead)" with two content-free "- Message from homeowner" activity lines.
 *      Every portal draft was therefore generated as a cold first contact.
 *
 *   2. applyRepReplyEffects (functions/portal-reply-effects.js) must perform
 *      the mark-read + lead bump + timeline entry that replyToPortalMessage
 *      does, because the AI-approved portal reply did none of them (permanent
 *      unread badge, lead reads as unanswered forever, timeline shows the
 *      question but not the answer — and the missing activity entry is also
 *      what kept the AI blind to its own prior replies).
 *
 * Stubbed Firestore — no emulator, no network, plain node.
 * Run: node tests/portal-ai-reply.test.js
 */
'use strict';

const path = require('path');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

// ── Minimal Firestore stub ────────────────────────────────────────────────
// Supports exactly what the code under test uses: collection().doc()
// .collection().where().orderBy().limit().get(), doc().get()/.set(),
// collection().add(), and batch().update()/.commit().
function makeDb(data) {
  const writes = { adds: [], sets: [], updates: [] };
  const snapOf = (rows) => ({
    empty: rows.length === 0,
    docs: rows.map((r, i) => ({ id: r._id || ('d' + i), data: () => r, ref: { _row: r } })),
    forEach(fn) { this.docs.forEach(fn); },
  });
  function queryFor(key) {
    const rows = () => (data[key] || []).slice();
    const api = {
      _filters: [], _order: null, _limit: null,
      where(f, _op, v) { api._filters.push([f, v]); return api; },
      orderBy(f, dir) { api._order = [f, dir]; return api; },
      limit(n) { api._limit = n; return api; },
      async get() {
        let out = rows().filter(r => api._filters.every(([f, v]) => r[f] === v));
        if (api._order) {
          const [f, dir] = api._order;
          out.sort((a, b) => (a[f] > b[f] ? 1 : a[f] < b[f] ? -1 : 0));
          if (dir === 'desc') out.reverse();
        }
        if (api._limit != null) out = out.slice(0, api._limit);
        return snapOf(out);
      },
      async add(doc) { writes.adds.push({ key, doc }); return { id: 'new-' + (writes.adds.length) }; },
    };
    return api;
  }
  const db = {
    _writes: writes,
    collection(p) {
      return Object.assign(queryFor(p), {
        doc: (id) => ({
          collection: (sub) => queryFor(p + '/' + id + '/' + sub),
          async get() { return { exists: !!data['doc:' + p + '/' + id], data: () => data['doc:' + p + '/' + id] }; },
        }),
      });
    },
    doc(p) {
      return {
        async get() { return { exists: !!data['doc:' + p], data: () => data['doc:' + p] }; },
        async set(doc, opts) { writes.sets.push({ path: p, doc, opts }); },
      };
    },
    batch() {
      const ops = [];
      return {
        update(ref, patch) { ops.push({ ref, patch }); },
        async commit() { ops.forEach(o => writes.updates.push(o)); },
      };
    },
  };
  return db;
}

const FieldValue = { serverTimestamp: () => '<ts>' };

// ══════════════════════════════════════════════════════════════════════════
console.log('PORTAL AI REPLY — context + rep-reply side effects');

// ── 1. buildLeadContext sees the portal thread ────────────────────────────
{
  const { buildLeadContext } = require(path.join('..', 'functions', 'handlers', 'ai-texting.js'));
  const lead = { firstName: 'Dana', lastName: 'Homeowner', stage: 'Inspected', userId: 'u1', companyId: 'c1' };

  (async () => {
    // A homeowner mid-conversation in the portal: two of their messages and the
    // AI's own reply, and NO sms notes at all.
    const db = makeDb({
      'leads/L1/portal_messages': [
        { _id: 'm1', source: 'homeowner', text: 'Is the crew still coming Thursday?', createdAt: 1 },
        { _id: 'm2', source: 'rep', text: 'Yes — Thursday at 8am, weather permitting.', createdAt: 2 },
        { _id: 'm3', source: 'homeowner', text: 'Do I need to move my cars?', createdAt: 3 },
      ],
      'leads/L1/activity': [
        { type: 'portal_message_in', label: 'Message from homeowner', textPreview: 'Do I need to move my cars?', createdAt: 3 },
      ],
    });
    const ctx = await buildLeadContext(db, 'L1', lead, 'Do I need to move my cars?');

    ok('portal thread section is present', /HOMEOWNER PORTAL THREAD/.test(ctx), ctx.slice(0, 200));
    ok('the homeowner\'s EARLIER question is in the prompt',
      /still coming Thursday/.test(ctx));
    ok('the AI\'s OWN prior reply is in the prompt (so it stops repeating itself)',
      /Thursday at 8am/.test(ctx));
    ok('portal messages are attributed by speaker',
      /\[HOMEOWNER\][^\n]*Thursday/.test(ctx) && /\[JOE\/ASSISTANT\][^\n]*8am/.test(ctx));
    ok('it no longer claims this is the first inbound SMS',
      !/first inbound SMS/.test(ctx), ctx);
    ok('activity lines carry textPreview content, not just a bare label',
      /Message from homeowner: Do I need to move my cars\?/.test(ctx));

    // A genuine cold contact — nothing on either channel.
    const ctx2 = await buildLeadContext(makeDb({}), 'L2', lead, 'hello?');
    ok('true first contact says so explicitly',
      /first exchange with this lead on any channel/.test(ctx2));
    ok('no portal section when there is no portal thread',
      !/HOMEOWNER PORTAL THREAD/.test(ctx2));

    // SMS-only lead: the portal addition must not disturb the SMS rendering.
    const ctx3 = await buildLeadContext(makeDb({
      'leads/L3/notes': [
        { type: 'sms', direction: 'incoming', body: 'got your card', createdAt: 1 },
        { type: 'sms', direction: 'outgoing', body: 'thanks! when can we look?', createdAt: 2 },
      ],
    }), 'L3', lead, 'tomorrow works');
    ok('SMS thread still renders for an SMS-only lead',
      /RECENT TEXT THREAD \(oldest → newest\)/.test(ctx3) && /got your card/.test(ctx3));
    ok('SMS-only lead is not labelled a first contact',
      !/first exchange with this lead on any channel/.test(ctx3));

    runEffects();
  })().catch(e => { console.error('context test threw', e); process.exit(1); });
}

// ── 2. applyRepReplyEffects does all three side effects ───────────────────
function runEffects() {
  const { applyRepReplyEffects, STEPS } = require(path.join('..', 'functions', 'portal-reply-effects.js'));

  (async () => {
    const db = makeDb({
      'leads/L1/portal_messages': [
        { _id: 'm1', source: 'homeowner', readByRecipient: false, text: 'q1', createdAt: 1 },
        { _id: 'm2', source: 'homeowner', readByRecipient: true,  text: 'q0', createdAt: 0 },
        { _id: 'm3', source: 'rep',       readByRecipient: false, text: 'a1', createdAt: 2 },
      ],
    });
    const res = await applyRepReplyEffects({
      db, FieldValue, leadId: 'L1', ownerUid: 'u1', companyId: 'c1',
      messageId: 'new-1', textPreview: 'Yes — Thursday at 8am.',
    });

    ok('all three steps report success', res.markRead && res.leadBump && res.activity, JSON.stringify(res));
    ok('STEPS enumerates the contract', Array.isArray(STEPS) && STEPS.length === 3);

    ok('only UNREAD HOMEOWNER messages are marked read (1 of 3)',
      db._writes.updates.length === 1 && db._writes.updates[0].patch.readByRecipient === true,
      JSON.stringify(db._writes.updates));

    const bump = db._writes.sets.find(s => s.path === 'leads/L1');
    ok('lead bump clears the unread counter', bump && bump.doc.unreadHomeownerMessages === 0);
    ok('lead bump stamps lastRepMessageAt + updatedAt (kills "homeowner waiting" forever)',
      bump && bump.doc.lastRepMessageAt === '<ts>' && bump.doc.updatedAt === '<ts>');
    ok('lead bump MERGES (never clobbers the lead)', bump && bump.opts && bump.opts.merge === true);

    const act = db._writes.adds.find(a => /activity$/.test(a.key));
    ok('timeline gets a portal_message_out entry', act && act.doc.type === 'portal_message_out');
    ok('timeline entry carries the reply text + tenancy',
      act && /Thursday at 8am/.test(act.doc.textPreview) && act.doc.companyId === 'c1' && act.doc.userId === 'u1');

    // Best-effort contract: a failing step must not throw or block the others.
    const brokenDb = makeDb({});
    brokenDb.collection = (p) => {
      if (/portal_messages$/.test(p)) throw new Error('index missing');
      return makeDb({}).collection(p);
    };
    let threw = false;
    let res2;
    try { res2 = await applyRepReplyEffects({ db: brokenDb, FieldValue, leadId: 'L9' }); }
    catch (_) { threw = true; }
    ok('a failing step never throws (the reply is already delivered)', !threw);
    ok('the failure is reported per-step, not swallowed silently',
      res2 && res2.markRead === false && !!res2.errors.markRead);

    ok('missing db/leadId is a no-op, not a crash',
      JSON.stringify((await applyRepReplyEffects({})).errors) === '{}');

    finish();
  })().catch(e => { console.error('effects test threw', e); process.exit(1); });
}

function finish() {
  console.log('\n──────────────────────────────');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('\nFailures:');
    fails.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
}
