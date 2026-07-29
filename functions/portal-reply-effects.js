/**
 * portal-reply-effects.js — everything that must happen when a REP reply lands
 * in a homeowner's portal thread, beyond writing the message itself.
 *
 * Why this module exists: replyToPortalMessage (portal.js) did five things —
 * write the message, mark the homeowner's messages read, clear the lead's
 * unread counter, stamp lastRepMessageAt/updatedAt, and log a
 * 'portal_message_out' activity entry. The AI-approved portal reply
 * (onAiDraftApproved's portal branch, sms-functions.js) did only the first, so
 * an AI-answered thread kept nagging the rep as unread, looked permanently
 * unanswered, showed the homeowner's question but not the answer on the
 * timeline — and, because buildLeadContext reads the activity feed, the AI
 * could never see its own prior replies.
 *
 * Both callers now share this, so the two paths cannot drift again (same
 * reasoning as ai-draft-routing.js). Firestore is passed in rather than
 * imported so the module stays trivially stubbable in tests.
 *
 * Every step is independently best-effort: the reply itself is already
 * committed by the caller, so a failure here must never surface as a send
 * failure. Returns a per-step result so callers/tests can assert coverage.
 */
'use strict';

const STEPS = ['markRead', 'leadBump', 'activity'];

async function applyRepReplyEffects(opts) {
  const {
    db, FieldValue, leadId,
    ownerUid = null,
    companyId = null,
    messageId = null,
    textPreview = '',
    logger = null,
  } = opts || {};

  const result = { markRead: false, leadBump: false, activity: false, errors: {} };
  if (!db || !FieldValue || !leadId) return result;

  const warn = (step, e) => {
    result.errors[step] = (e && e.message) || String(e);
    if (logger && typeof logger.warn === 'function') {
      logger.warn('[portal-reply-effects] ' + step + ' failed', { leadId, msg: result.errors[step] });
    }
  };

  // 1. The rep answering IS an implicit acknowledgement — clear the homeowner's
  //    unread flags so the rep's badge stops nagging about an answered thread.
  try {
    const unreadSnap = await db.collection(`leads/${leadId}/portal_messages`)
      .where('source', '==', 'homeowner')
      .where('readByRecipient', '==', false)
      .limit(100)
      .get();
    if (!unreadSnap.empty) {
      const batch = db.batch();
      unreadSnap.forEach(d => batch.update(d.ref, { readByRecipient: true }));
      await batch.commit();
    }
    result.markRead = true;
  } catch (e) { warn('markRead', e); }

  // 2. lastRepMessageAt is what "the homeowner is still waiting" is measured
  //    against (sendPortalMessage sets lastHomeownerMessageAt); without it an
  //    answered lead reads as unanswered forever.
  try {
    await db.doc(`leads/${leadId}`).set({
      updatedAt: FieldValue.serverTimestamp(),
      lastRepMessageAt: FieldValue.serverTimestamp(),
      unreadHomeownerMessages: 0,
    }, { merge: true });
    result.leadBump = true;
  } catch (e) { warn('leadBump', e); }

  // 3. Timeline entry. Also feeds the AI: buildLeadContext reads the activity
  //    feed, so this is how a later draft learns what was already answered.
  try {
    await db.collection(`leads/${leadId}/activity`).add({
      userId: ownerUid,
      companyId,
      type: 'portal_message_out',
      label: 'Reply to homeowner',
      messageId,
      textPreview: String(textPreview || '').slice(0, 120),
      createdAt: FieldValue.serverTimestamp(),
    });
    result.activity = true;
  } catch (e) { warn('activity', e); }

  return result;
}

module.exports = { applyRepReplyEffects, STEPS };
