/**
 * NBD — the TCPA opt-out register, with ONE key derivation
 * ═══════════════════════════════════════════════════════════════
 *
 * THE BUG THIS EXISTS TO CLOSE (found 2026-09-04)
 *
 * `sms_opt_outs` was WRITTEN under one key and READ under another, so a
 * homeowner's STOP has never been honoured on any rep- or AI-initiated text:
 *
 *   write (incomingSMS)  String(twilioFrom).replace(/\D/g,'')  → '18595550134'
 *   read  (every sender) String(lead.phone).replace(/\D/g,'')  → '8595550134'
 *
 * Twilio delivers E.164 with the country code; leads store the phone however
 * the rep typed it. The lookup therefore missed on every ordinary send, the
 * register was effectively write-only, and the "You've been unsubscribed"
 * TwiML we send back was not true.
 *
 * phone-utils.js already carries the canonical normaliser for exactly this
 * class of drift, and sms-functions.js already imports it — for lead matching,
 * just not here. Its header says the read side and every write side "MUST
 * share this exact transform — otherwise the stamped key and the looked-up key
 * drift and the match silently fails." That is precisely what happened.
 *
 * WHY THE LEGACY READ EXISTS
 *
 * Every opt-out already in production is stored under the 11-digit key.
 * Normalising the write alone would strand all of them: those homeowners
 * would silently become textable again — the exact harm, inverted, on the
 * exact people who already objected.
 *
 * So the lookup checks the canonical key and, when that misses, the legacy
 * key too. That makes the fix safe in BOTH deploy orderings — code first or
 * backfill first — because no window exists in which an existing opt-out is
 * invisible. `viaLegacyKey` is returned so callers can log it; when that log
 * line stops appearing after the backfill, the legacy read can be deleted.
 *
 * Deliberately NOT a cache. An opt-out is a legal instruction and the read is
 * a single indexed doc get.
 */

'use strict';

const { phoneDigits10 } = require('./phone-utils');

const COLLECTION = 'sms_opt_outs';

/**
 * The canonical document id: last-10 US digits, country code dropped.
 * Byte-identical to the transform lead-write paths stamp as `phoneDigits`.
 * @returns {string} '' when there is no usable phone
 */
function optOutKey(phone) {
  return phoneDigits10(phone);
}

/**
 * The key incomingSMS used to write before 2026-09-04 — a plain digit strip,
 * so an E.164 sender kept its leading country-code 1.
 *
 * Exported for the backfill and the tests, not for new call sites.
 * @returns {string} '' when there is no usable phone
 */
function legacyOptOutKey(phone) {
  return String(phone == null ? '' : phone).replace(/\D/g, '');
}

/**
 * Has this number opted out?
 *
 * THROWS on a Firestore error rather than returning false. Every caller treats
 * a throw as "do not send" — sendSMS and sendD2DSMS let it reach their outer
 * handler (500, no send) and the AI-draft path catches it into fail('optout_
 * check_error'). Returning false on error would turn a transient blip into a
 * message to someone who said STOP.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} phone  any format — E.164, rep-typed, digits
 * @returns {Promise<{optedOut: boolean, key: string, viaLegacyKey: boolean}>}
 */
async function isOptedOut(db, phone) {
  const key = optOutKey(phone);
  if (!key) return { optedOut: false, key: '', viaLegacyKey: false };

  const hit = await db.doc(COLLECTION + '/' + key).get();
  if (hit.exists) return { optedOut: true, key, viaLegacyKey: false };

  // Pre-migration records only.
  //
  // The legacy key is NOT legacyOptOutKey(phone) — that was the first thing
  // tried and it is wrong, because the caller here is a SEND path holding a
  // rep-typed number, whose plain digit-strip is already the 10-digit form.
  // The stranded records were written by incomingSMS from Twilio's E.164, so
  // what is actually sitting in the collection is the canonical key with the
  // US country code still on the front. Derive the candidate from the KEY, not
  // from the input. (Caught by fixture K8.)
  //
  // legacyOptOutKey(phone) is still checked for the case where the caller
  // itself passes an E.164 string, which the AI-draft path does whenever it
  // falls back to `after.incomingPhone`.
  const candidates = ['1' + key, legacyOptOutKey(phone)]
    .filter((k, i, a) => k && k !== key && a.indexOf(k) === i);

  for (const legacy of candidates) {
    const old = await db.doc(COLLECTION + '/' + legacy).get();
    if (old.exists) return { optedOut: true, key: legacy, viaLegacyKey: true };
  }

  return { optedOut: false, key, viaLegacyKey: false };
}

/**
 * Record an opt-out under the canonical key.
 * @returns {Promise<string>} the key written
 */
async function recordOptOut(db, phone, fields) {
  const key = optOutKey(phone);
  if (!key) return '';
  await db.doc(COLLECTION + '/' + key).set(Object.assign({ phone }, fields || {}));
  return key;
}

/**
 * Clear an opt-out (START / UNSTOP).
 *
 * Deletes BOTH keys. Deleting only the canonical one would leave a
 * pre-migration record behind that `isOptedOut`'s legacy branch still finds,
 * so a homeowner who explicitly asked to resume would stay silently
 * suppressed — the same silent-wrong-answer failure in the other direction.
 *
 * @returns {Promise<string[]>} the keys attempted
 */
async function clearOptOut(db, phone) {
  const key = optOutKey(phone);
  // Same candidate set isOptedOut searches — including the country-code form,
  // which is where every pre-migration record actually lives.
  const keys = [key, key && '1' + key, legacyOptOutKey(phone)]
    .filter((k, i, a) => k && a.indexOf(k) === i);
  await Promise.all(keys.map((k) => db.doc(COLLECTION + '/' + k).delete().catch(() => {})));
  return keys;
}

module.exports = {
  COLLECTION,
  optOutKey,
  legacyOptOutKey,
  isOptedOut,
  recordOptOut,
  clearOptOut,
};
