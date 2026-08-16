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
  const type = String(pick(body, ['event.eventType', 'eventType', 'event', 'type', 'topic'])).toLowerCase();
  if (type.includes('test')) return true;

  // VERIFIED 2026-08-16 against a real "Test your webhooks" delivery: Thumbtack
  // sends NO test flag and NO test-y eventType. The ONLY tell is that the
  // business block is swapped for a fixture — data.business.name comes through
  // as "Test Business for Webhooks" instead of the real profile name, while
  // businessID stays the pro's real id. Without this check a test delivery
  // classifies as a genuine lead and lands a fake card in the kanban.
  const biz = String(pick(body, ['data.business.name', 'business.name'])).toLowerCase();
  if (biz.includes('test business')) return true;

  return false;
}

// Classify the delivery. Prefer an explicit type field; fall back to shape
// sniffing so an undocumented-but-obvious payload still routes correctly.
// Anything genuinely unrecognisable returns UNKNOWN and is stored verbatim
// rather than guessed at.
function classifyEvent(body) {
  body = body || {};

  // VERIFIED 2026-08-16: the real envelope is { event: {eventType, triggeredAt,
  // webhookID, description}, data: {...} } and eventType is a VERSIONED
  // PascalCase name — the observed lead event is "NegotiationCreatedV4".
  // Thumbtack's domain word for a lead is NEGOTIATION, not "lead": the pro is
  // negotiating a job with a customer. Matching only on lead/request/job (as
  // this did originally) sent every real lead to the unknown bucket.
  const declared = String(pick(body, [
    'event.eventType', 'eventType', 'event', 'type', 'topic', 'webhookType',
  ])).toLowerCase();
  if (declared) {
    if (declared.includes('review'))  return EVENT.REVIEW;
    if (declared.includes('message')) return EVENT.MESSAGE;
    if (declared.includes('negotiation') || declared.includes('lead')
        || declared.includes('request') || declared.includes('job')) return EVENT.LEAD;
  }

  // Shape sniffing, most-specific first. Review before message: a review
  // payload may carry review text that also looks message-ish.
  if (at(body, 'review') || at(body, 'rating') || at(body, 'reviewId') || at(body, 'reviewID')
      || at(body, 'data.review') || at(body, 'data.rating')) return EVENT.REVIEW;
  if (at(body, 'message') || at(body, 'messageId') || at(body, 'messageID') || at(body, 'messageBody')
      || at(body, 'data.message')) return EVENT.MESSAGE;
  if (at(body, 'lead') || at(body, 'leadId') || at(body, 'leadID') || at(body, 'customer') || at(body, 'request')
      || at(body, 'data.negotiationID') || at(body, 'data.customer') || at(body, 'data.request')) return EVENT.LEAD;

  return EVENT.UNKNOWN;
}

// Stable id for idempotency. Webhooks retry — Thumbtack's delivery log has a
// Failure status and a resend path — so a re-delivery MUST land on the same
// doc id or Joe gets duplicate pipeline cards. Returns '' when no id can be
// found, in which case the caller falls back to a content hash.
function extractEventId(body) {
  return pick(body || {}, [
    // VERIFIED 2026-08-16 — the real lead identity. negotiationID is the
    // per-lead key (one negotiation = one customer conversation); requestID is
    // the customer's job post, which can fan out to several pros, so it is NOT
    // unique to us and must rank below negotiationID.
    'data.negotiationID', 'data.negotiationId',
    'data.messageID', 'data.messageId',
    'data.reviewID', 'data.reviewId',
    'data.request.requestID', 'data.request.requestId',
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
// Assemble a single-line street address from Thumbtack's structured location
// block (data.request.location = {address1, address2, city, state, zipCode}).
// Returns '' when no part is present so the caller can fall back.
function joinLocation(loc) {
  if (!loc || typeof loc !== 'object') return '';
  const street = [loc.address1, loc.address2].filter(Boolean).join(' ').trim();
  const cityState = [loc.city, loc.state].filter(Boolean).join(', ').trim();
  const tail = [cityState, loc.zipCode].filter(Boolean).join(' ').trim();
  return [street, tail].filter(Boolean).join(', ').trim();
}

function normalizeLead(body) {
  body = body || {};

  // Real paths first (VERIFIED 2026-08-16 against a live delivery), then the
  // speculative ones as fallback in case Thumbtack varies the shape by event.
  const full  = pick(body, ['customerName', 'customer_name', 'name', 'customer.name', 'lead.customerName', 'lead.name']);
  const first = pick(body, ['data.customer.firstName', 'firstName', 'first_name', 'customer.firstName', 'customer.first_name', 'lead.firstName']);
  const last  = pick(body, ['data.customer.lastName', 'lastName', 'last_name', 'customer.lastName', 'customer.last_name', 'lead.lastName']);
  const { firstName, lastName } = splitName(full, first, last);

  const phone = pick(body, [
    'data.customer.phone', 'data.customer.phoneNumber',
    'phone', 'phoneNumber', 'phone_number', 'customerPhone',
    'customer.phone', 'customer.phoneNumber', 'lead.phone', 'lead.phoneNumber',
  ]);

  // Structured location wins; the flat paths remain for other event shapes.
  const address = joinLocation(at(body, 'data.request.location'))
    || joinLocation(at(body, 'request.location'))
    || pick(body, [
      'address', 'customerAddress', 'serviceAddress',
      'customer.address', 'lead.address', 'location.address',
      'zipCode', 'zip', 'postalCode', 'location.zipCode',
    ]);

  // category arrives as {categoryID, name}; pick() skips objects, so the bare
  // 'category' paths below are harmless against the real shape and still catch
  // a variant that sends it as a plain string.
  const service = pick(body, [
    'data.request.category.name', 'request.category.name',
    'service', 'serviceName', 'categoryName', 'jobType',
    'data.request.category', 'request.category',
    'lead.service', 'lead.category', 'title',
  ]);

  const details = pick(body, [
    'data.request.description',
    'details', 'description', 'jobDescription', 'notes', 'message',
    'request.description', 'lead.details',
  ]);

  // What Thumbtack CHARGED for this lead. The Aug 2026 audit had to rebuild
  // this by hand from the app for 38 leads (17 were sitting at "price unknown",
  // and the corrected total moved from $718.82 to $2,056.03). Captured here so
  // cost-per-lead is recorded automatically from now on.
  const leadPrice = pick(body, ['data.leadPrice', 'leadPrice']);

  // The customer's answers to the category questionnaire — genuinely the most
  // useful part of the payload for the first call.
  const qa = (at(body, 'data.request.details') || at(body, 'request.details') || [])
    .filter(d => d && (d.question || d.answer))
    .map(d => ({ question: String(d.question || ''), answer: String(d.answer || '') }));

  return {
    firstName,
    lastName,
    phone,
    // Normalized match key so an inbound SMS from this homeowner ties back to
    // this lead (incomingSMS queries leads by phoneDigits). Same transform as
    // every other write path — see functions/phone-utils.js.
    phoneDigits: phoneDigits10(phone),
    email: pick(body, ['data.customer.email', 'email', 'customerEmail', 'customer.email', 'lead.email']),
    address,
    service,
    details,
    leadPrice,
    thumbtackStatus: pick(body, ['data.status', 'status']),
    qa,
  };
}

// Notes line for the CRM card, so the pipeline shows WHY this lead exists
// rather than just a name and a phone number.
function leadNotes(norm) {
  norm = norm || {};
  const parts = [];
  if (norm.service) parts.push('Thumbtack — ' + norm.service);
  if (norm.details) parts.push(norm.details);
  // Lead cost on the card: the per-lead number the channel scorecard needs.
  if (norm.leadPrice) parts.push('Lead cost: ' + norm.leadPrice);
  // The questionnaire answers — what the homeowner actually told Thumbtack.
  if (Array.isArray(norm.qa) && norm.qa.length) {
    parts.push(norm.qa.map(d => '· ' + d.question + ': ' + d.answer).join('\n'));
  }
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
  joinLocation,
  normalizeLead,
  leadNotes,
};
