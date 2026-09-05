/**
 * functions/calendar-feed-logic.js — VCALENDAR serialization, pure.
 *
 * No firebase, no network, no clock of its own — every input is plain data and
 * `nowMs` is passed in. That is what lets tests/calendar-feed.test.js assert on
 * the exact bytes, which matters more here than in most places: iOS Calendar
 * does not report a parse error. A feed with one malformed line is a feed that
 * silently shows nothing, or silently drops every event it had already saved.
 *
 * The rules that actually bite (RFC 5545):
 *   §3.1  content lines are CRLF-terminated and at most 75 OCTETS; longer ones
 *         are folded with CRLF + a single leading space. Octets, not
 *         characters — a name with an em dash or an é must not be split
 *         mid-codepoint or the whole calendar fails to parse.
 *   §3.3.5 DATE-TIME in UTC is YYYYMMDDTHHMMSSZ. Using UTC throughout means no
 *         VTIMEZONE block is needed at all.
 *   §3.6.1 an all-day event's DTEND is EXCLUSIVE — a job on the 5th ends on
 *         the 6th. Get this wrong and every scheduled job renders as two days.
 *   §3.3.11 TEXT values escape backslash, semicolon, comma and newline.
 *
 * America/New_York enters in exactly one place: deciding which local calendar
 * DAY an appointment falls on, for the lead/appointment dedup. Everything a
 * calendar client renders is UTC or a bare date.
 */

'use strict';

const PRODID = '-//NBD Pro//Calendar Feed//EN';
const UID_DOMAIN = 'nobigdealwithjoedeal.com';
// A rep with more than this in the window has a data problem, not a schedule.
const MAX_EVENTS = 1000;
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

// ─── primitives ──────────────────────────────────────────────────

function escapeText(s) {
  return String(s == null ? '' : s)
    // Backslash first, or every escape below gets double-escaped.
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
    // Remaining C0 controls are illegal in a value and make iOS reject the
    // whole calendar rather than the one property.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Fold one logical line to physical lines of at most 75 octets.
 * Continuation lines carry a single leading space, which counts toward the 75,
 * so they may hold 74 octets of payload. Iterating the string with for..of
 * walks CODE POINTS, so a multibyte character is never cut in half.
 */
function foldLine(line) {
  const s = String(line == null ? '' : line);
  if (Buffer.byteLength(s, 'utf8') <= 75) return s;
  const parts = [];
  let cur = '';
  let curBytes = 0;
  for (const ch of s) {
    const chBytes = Buffer.byteLength(ch, 'utf8');
    const limit = parts.length === 0 ? 75 : 74;
    if (curBytes + chBytes > limit) {
      parts.push(cur);
      cur = ch;
      curBytes = chBytes;
    } else {
      cur += ch;
      curBytes += chBytes;
    }
  }
  parts.push(cur);
  return parts[0] + parts.slice(1).map((p) => '\r\n ' + p).join('');
}

function pad2(n) { return String(n).padStart(2, '0'); }

/** ms → 'YYYYMMDDTHHMMSSZ' */
function fmtUtc(ms) {
  const d = new Date(ms);
  return String(d.getUTCFullYear()) + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate())
    + 'T' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' → 'YYYYMMDD' (null when the input is not a bare date) */
function fmtDate(ymd) {
  return YMD_RE.test(String(ymd || '')) ? String(ymd).replace(/-/g, '') : null;
}

/** 'YYYY-MM-DD' → the next calendar day, for the exclusive DTEND. */
function nextDate(ymd) {
  if (!YMD_RE.test(String(ymd || ''))) return null;
  const [y, m, d] = String(ymd).split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + 86_400_000;
  const n = new Date(t);
  return String(n.getUTCFullYear()) + '-' + pad2(n.getUTCMonth() + 1) + '-' + pad2(n.getUTCDate());
}

// House convention for New-York-local formatting (portal.js, lead-digest.js):
// Intl with an explicit timeZone. 'en-CA' yields YYYY-MM-DD directly.
const NY_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});
/** ms → the America/New_York calendar date, 'YYYY-MM-DD'. Dedup key only. */
function nyDateOf(ms) {
  return NY_FMT.format(new Date(ms));
}

// ─── normalization ───────────────────────────────────────────────

/** Firestore Timestamp | Date | number | ISO string → ms, or null. */
function toMs(t) {
  if (t == null) return null;
  if (typeof t === 'number') return Number.isFinite(t) ? t : null;
  if (t instanceof Date) return Number.isFinite(t.getTime()) ? t.getTime() : null;
  if (typeof t.toMillis === 'function') { const v = t.toMillis(); return Number.isFinite(v) ? v : null; }
  if (typeof t.toDate === 'function') { const d = t.toDate(); return d && Number.isFinite(d.getTime()) ? d.getTime() : null; }
  if (typeof t.seconds === 'number') return t.seconds * 1000;
  if (typeof t === 'string') { const v = Date.parse(t); return Number.isFinite(v) ? v : null; }
  return null;
}

/**
 * appointments/{bookingId} → the fields the feed needs, or null when the doc
 * cannot become an event. Cancelled appointments are dropped (the same choice
 * smart-calendar.js makes) so a cancelled slot disappears from the phone.
 */
function normalizeAppointment(doc) {
  if (!doc || typeof doc !== 'object') return null;
  if (doc.status === 'cancelled') return null;
  const startMs = toMs(doc.startTime);
  if (startMs == null) return null;              // nothing to place on a calendar
  let endMs = toMs(doc.endTime);
  if (endMs == null || endMs <= startMs) endMs = startMs + DEFAULT_DURATION_MS;
  return {
    kind: 'appointment',
    id: String(doc.bookingId || doc.id || ''),
    startMs,
    endMs,
    title: String(doc.title || doc.attendeeName || 'Appointment'),
    location: String(doc.location || ''),
    description: String(doc.description || ''),
    attendeeName: String(doc.attendeeName || ''),
    attendeeEmail: String(doc.attendeeEmail || ''),
    attendeePhone: String(doc.attendeePhone || ''),
    leadId: doc.leadId || null,
    updatedMs: toMs(doc.updatedAt),
  };
}

/**
 * leads/{id} → an all-day event, or null. A rep-typed Scheduled Date is a
 * date-only string; anything that is not exactly YYYY-MM-DD is skipped rather
 * than guessed at, because a malformed DTSTART makes iOS drop the whole feed.
 */
function normalizeLead(doc) {
  if (!doc || typeof doc !== 'object') return null;
  if (doc.deleted === true) return null;
  const ymd = String(doc.scheduledDate || '');
  if (!YMD_RE.test(ymd)) return null;
  const name = `${doc.firstName || ''} ${doc.lastName || ''}`.trim();
  return {
    kind: 'lead',
    id: String(doc.id || ''),
    date: ymd,
    title: name || String(doc.address || '') || 'Scheduled job',
    location: String(doc.address || ''),
    stage: String(doc.stage || ''),
    phone: String(doc.phone || ''),
    updatedMs: toMs(doc.updatedAt),
  };
}

/**
 * Drop a lead's all-day event when one of its own appointments already sits on
 * the same New York day — otherwise the rep sees the job twice, once timed and
 * once all-day. smart-calendar.js does this for today only; the feed spans a
 * window, so it compares per lead per DAY.
 */
function dedupLeads(leads, appts) {
  const taken = new Set();
  for (const a of appts) {
    if (a && a.leadId) taken.add(a.leadId + '@' + nyDateOf(a.startMs));
  }
  return leads.filter((l) => !taken.has(l.id + '@' + l.date));
}

// ─── serialization ───────────────────────────────────────────────

function eventLines(ev, nowStamp) {
  const out = [];
  out.push('BEGIN:VEVENT');
  if (ev.kind === 'appointment') {
    out.push('UID:' + ev.id + '@' + UID_DOMAIN);
    out.push('DTSTAMP:' + nowStamp);
    out.push('DTSTART:' + fmtUtc(ev.startMs));
    out.push('DTEND:' + fmtUtc(ev.endMs));
    out.push('SUMMARY:' + escapeText(ev.title));
    if (ev.location) out.push('LOCATION:' + escapeText(ev.location));
    const desc = [
      ev.attendeeName ? 'With: ' + ev.attendeeName : '',
      ev.attendeePhone ? 'Phone: ' + ev.attendeePhone : '',
      ev.attendeeEmail ? 'Email: ' + ev.attendeeEmail : '',
      ev.description || '',
    ].filter(Boolean).join('\n');
    if (desc) out.push('DESCRIPTION:' + escapeText(desc));
    out.push('STATUS:CONFIRMED');
  } else {
    out.push('UID:lead-' + ev.id + '@' + UID_DOMAIN);
    out.push('DTSTAMP:' + nowStamp);
    // All-day: a bare DATE, and an EXCLUSIVE end on the following day.
    out.push('DTSTART;VALUE=DATE:' + fmtDate(ev.date));
    out.push('DTEND;VALUE=DATE:' + fmtDate(nextDate(ev.date)));
    out.push('SUMMARY:' + escapeText(ev.title + (ev.stage ? ' · ' + ev.stage : '')));
    if (ev.location) out.push('LOCATION:' + escapeText(ev.location));
    if (ev.phone) out.push('DESCRIPTION:' + escapeText('Phone: ' + ev.phone));
    // A date-only job is a plan, not a commitment to be busy all day.
    out.push('TRANSP:TRANSPARENT');
  }
  if (ev.updatedMs) out.push('LAST-MODIFIED:' + fmtUtc(ev.updatedMs));
  out.push('END:VEVENT');
  return out;
}

/**
 * Build the whole calendar. Deterministic: events sort by start then UID, so
 * two fetches a second apart differ only in DTSTAMP.
 *
 * @param {object} o
 * @param {object[]} o.appointments raw appointment docs
 * @param {object[]} o.leads        raw lead docs
 * @param {number}   o.nowMs        clock, injected
 * @param {string}   [o.calName]    X-WR-CALNAME shown as the subscription title
 * @returns {string} the VCALENDAR, CRLF-terminated
 */
function buildCalendar(o) {
  const opts = o || {};
  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : 0;
  const nowStamp = fmtUtc(nowMs);
  const calName = String(opts.calName || 'NBD Schedule');

  const appts = (Array.isArray(opts.appointments) ? opts.appointments : [])
    .map(normalizeAppointment).filter(Boolean);
  const leads = dedupLeads(
    (Array.isArray(opts.leads) ? opts.leads : []).map(normalizeLead).filter(Boolean),
    appts,
  );

  const events = appts.concat(leads).sort((a, b) => {
    const as = a.kind === 'appointment' ? a.startMs : Date.parse(a.date + 'T00:00:00Z');
    const bs = b.kind === 'appointment' ? b.startMs : Date.parse(b.date + 'T00:00:00Z');
    if (as !== bs) return as - bs;
    return String(a.id).localeCompare(String(b.id));
  }).slice(0, MAX_EVENTS);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:' + PRODID,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + escapeText(calName),
    // Advisory only — iOS polls on its own schedule regardless.
    'X-PUBLISHED-TTL:PT15M',
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
  ];
  for (const ev of events) lines.push(...eventLines(ev, nowStamp));
  lines.push('END:VCALENDAR');

  // Fold every line, join with CRLF, and terminate the last line too.
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

module.exports = {
  escapeText,
  foldLine,
  fmtUtc,
  fmtDate,
  nextDate,
  nyDateOf,
  toMs,
  normalizeAppointment,
  normalizeLead,
  dedupLeads,
  buildCalendar,
  PRODID,
  UID_DOMAIN,
  MAX_EVENTS,
  DEFAULT_DURATION_MS,
};
