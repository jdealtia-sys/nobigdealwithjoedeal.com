/**
 * functions/integrations/thumbtack-logic.js — pure (firebase-free) logic for
 * the Thumbtack webhook receiver.
 *
 * Split out from thumbtack.js the same way lead-bridge-logic.js is split from
 * lead-bridge.js: the trigger file owns the Firestore/HTTP I/O, everything
 * here is a pure function of its inputs so it unit-tests with zero deps.
 *
 * ── WHY THIS IS DEFENSIVE ──────────────────────────────────────
 * Thumbtack documents WHAT it sends (leads, messages, reviews — see
 * help.thumbtack.com/article/how-to-create-a-webhook) but does NOT publish the
 * JSON schema. Their own guidance is to point the webhook at Zapier, which is
 * schema-agnostic. So this module:
 *
 *   1. Accepts several plausible field spellings per value (camelCase, snake_
 *      case, nested under `lead`/`customer`/`data`), because we cannot know
 *      which one arrives until a real delivery lands.
 *   2. NEVER throws on an unexpected shape — an unrecognised payload still
 *      classifies as `unknown` and gets stored verbatim.
 *   3. Preserves the complete raw payload on every doc, so the day a real
 *      delivery arrives we can read it back and tighten the mapping without
 *      having lost anything.
 *
 * Tighten `pick()` path lists once a real payload is in `thumbtack_events`.
 *
 * ── ONE-WAY ────────────────────────────────────────────────────
 * Thumbtack webhooks are explicitly one-way: they push to us, we cannot push
 * back. Nothing here should ever imply we can reply to a customer — replies
 * still happen inside Thumbtack. This module's job is capture + speed of
 * notification, not automation of the response.
 */

'use strict';

const { phoneDigits10 } = require('../phone-utils');

// Event kinds, mirroring the three checkboxes on the Thumbtack webhook form
// ("Lead details" / "Messages" / "Reviews").
const EVENT = {
  LEAD:    'lead',
  MESSAGE: 'message',
  REVIEW:  'review',
  UNKNOWN: 'unknown',
};

// Landing collection per event kind. Leads get their own collection so the
// existing lead-bridge pattern can mirror them into the CRM pipeline exactly
// the way contact_leads / estimate_leads already do. Messages and reviews are
// NOT leads — they're activity on an existing relationship — so they land in
// their own collections and never bridge.
const COLLECTION_BY_EVENT = {
  [EVENT.LEAD]:    'thumbtack_leads',
  [EVENT.MESSAGE]: 'thumbtack_messages',
  [EVENT.REVIEW]:  'thumbtack_reviews',
  [EVENT.UNKNOWN]: 'thumbtack_events',
};

// Walk a dotted path ('customer.name') without throwing on a missing branch.
function at(obj, path) {
  let cur = obj;
  for (const part of String(path).split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

// First path that yields a non-empty scalar, trimmed and stringified.
// Objects/arrays are skipped — a `name` that arrives as {first,last} must be
// addressed by its leaf paths, not swallowed as "[object Object]".
function pick(obj, paths) {
  for (const p of paths) {
    const v = at(obj, p);
    if (v == null) continue;
    if (typeof v === 'object') continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return '';
}

// Thumbtack's "Test this webhook" button sends a payload tagged as test data.
// We store those (so the delivery is auditable) but never bridge them into the
// CRM pipeline — a test lead in the kanban is indistinguishable from a real one
// once the tag scrolls out of view, and Joe would chase it.
function isTestPayload(body) {
  body = body || {};
  for (const p of ['isTest', 'is_test', 'test', 'testLead', 'test_lead', 'isTestLead']) {
    const v = at(body, p);
    if (v === true || String(v).toLowerCase() === 'true') return true;
  }
  const type = String(pick(body, ['eventType', 'event', 'type', 'topic'])).toLowerCase();
  if (type.includes('test')) return true;
  return false;
}

// Classify the delivery. Prefer an explicit type field; fall back to shape
// sniffing so an undocumented-but-obvious payload still routes correctly.
// Anything genuinely unrecognisable returns UNKNOWN and is stored verbatim
// rather than guessed at.
function classifyEvent(body) {
  body = body || {};

  const declared = String(pick(body, ['eventType', 'event', 'type', 'topic', 'webhookType'])).toLowerCase();
  if (declared) {
    if (declared.includes('review'))  return EVENT.REVIEW;
    if (declared.includes('message')) return EVENT.MESSAGE;
    if (declared.includes('lead') || declared.includes('request') || declared.includes('job')) return EVENT.LEAD;
  }

  // Shape sniffing, most-specific first. Review before message: a review
  // payload may carry review text that also looks message-ish.
  if (at(body, 'review') || at(body, 'rating') || at(body, 'reviewId') || at(body, 'reviewID')) return EVENT.REVIEW;
  if (at(body, 'message') || at(body, 'messageId') || at(body, 'messageID') || at(body, 'messageBody')) return EVENT.MESSAGE;
  if (at(body, 'lead') || at(body, 'leadId') || at(body, 'leadID') || at(body, 'customer') || at(body, 'request')) return EVENT.LEAD;

  return EVENT.UNKNOWN;
}

// Stable id for idempotency. Webhooks retry — Thumbtack's delivery log has a
// Failure status and a resend path — so a re-delivery MUST land on the same
// doc id or Joe gets duplicate pipeline cards. Returns '' when no id can be
// found, in which case the caller falls back to a content hash.
function extractEventId(body) {
  return pick(body || {}, [
    'leadId', 'leadID', 'lead.id', 'lead.leadId', 'lead.leadID',
    'messageId', 'messageID', 'message.id',
    'reviewId', 'reviewID', 'review.id',
    'requestId', 'requestID', 'request.id',
    'id', 'eventId', 'eventID', 'uuid',
  ]);
}

// Best-effort split of a single display name into first/last. Mirrors
// lead-bridge-logic.splitName's behaviour so a Thumbtack lead and a website
// lead render identically in the pipeline.
function splitName(full, firstHint, lastHint) {
  if (firstHint) return { firstName: String(firstHint), lastName: String(lastHint || '') };
  const raw = String(full || '').trim();
  if (!raw) return { firstName: '(Thumbtack lead)', lastName: '' };
  const parts = raw.split(/\s+/);
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

// Normalize a lead payload into the field names submitPublicLead's downstream
// consumers already expect (firstName/lastName/phone/address/service), so the
// bridge can reuse mapPublicLeadToLead's conventions.
//
// NOTE ON EMAIL: Thumbtack states outright that it provides customer name and
// phone number on all leads and does NOT provide email addresses. We still read
// an email path defensively in case that ever changes, but expect '' — and the
// CRM lead is legitimately email-less, not broken.
function normalizeLead(body) {
  body = body || {};

  const full  = pick(body, ['customerName', 'customer_name', 'name', 'customer.name', 'lead.customerName', 'lead.name']);
  const first = pick(body, ['firstName', 'first_name', 'customer.firstName', 'customer.first_name', 'lead.firstName']);
  const last  = pick(body, ['lastName', 'last_name', 'customer.lastName', 'customer.last_name', 'lead.lastName']);
  const { firstName, lastName } = splitName(full, first, last);

  const phone = pick(body, [
    'phone', 'phoneNumber', 'phone_number', 'customerPhone',
    'customer.phone', 'customer.phoneNumber', 'lead.phone', 'lead.phoneNumber',
  ]);

  const address = pick(body, [
    'address', 'customerAddress', 'location', 'serviceAddress',
    'customer.address', 'lead.address', 'location.address',
    'zipCode', 'zip', 'postalCode', 'location.zipCode',
  ]);

  const service = pick(body, [
    'service', 'serviceName', 'category', 'categoryName', 'jobType',
    'request.category', 'lead.service', 'lead.category', 'title',
  ]);

  const details = pick(body, [
    'details', 'description', 'jobDescription', 'notes', 'message',
    'request.details', 'lead.details',
  ]);

  return {
    firstName,
    lastName,
    phone,
    // Normalized match key so an inbound SMS from this homeowner ties back to
    // this lead (incomingSMS queries leads by phoneDigits). Same transform as
    // every other write path — see functions/phone-utils.js.
    phoneDigits: phoneDigits10(phone),
    email: pick(body, ['email', 'customerEmail', 'customer.email', 'lead.email']),
    address,
    service,
    details,
  };
}

// Notes line for the CRM card, so the pipeline shows WHY this lead exists
// rather than just a name and a phone number.
function leadNotes(norm) {
  norm = norm || {};
  const parts = [];
  if (norm.service) parts.push('Thumbtack — ' + norm.service);
  if (norm.details) parts.push(norm.details);
  // Thumbtack never sends an email address. Say so on the card so nobody
  // records it as missing data or goes hunting for it.
  if (!norm.email) parts.push('No email — Thumbtack does not provide customer email addresses. Ask on first contact.');
  return parts.join('\n');
}

module.exports = {
  EVENT,
  COLLECTION_BY_EVENT,
  at,
  pick,
  isTestPayload,
  classifyEvent,
  extractEventId,
  splitName,
  normalizeLead,
  leadNotes,
};
