/**
 * voice-consumer.js — turn a completed call recording's structured summary
 * into CRM actions (idea #2 from the 2026-07-22 ideation pass).
 *
 * voice-intelligence writes leads/{leadId}/recordings/{recId}.summary as strict
 * JSON (voice-prompts.js ANALYZE_OUTPUT_SCHEMA): nextActions, commitments
 * {who,what,when}, insuranceDetails, objections, redFlags. Nothing consumed it —
 * the richest per-lead intelligence in the app was a read-only island. This
 * trigger fires when a recording completes and:
 *   1. creates tasks (leads/{leadId}/tasks) from nextActions + commitments;
 *   2. backfills the lead's insurance fields — ONLY where empty, never
 *      overwriting a value the rep already typed;
 *   3. denormalizes redFlags / objections onto the lead so the (client-side)
 *      lead-score / smart-followup engines can read them.
 *
 * Idempotent via the recording's `consumedAt` marker: the trigger re-fires on
 * its own consumedAt write, sees the marker, and no-ops — no double tasks.
 *
 * The transformation logic (tasksFromSummary / insuranceBackfill /
 * denormalizeSignals / parseWhen) is exported under `_test` as pure functions
 * so tests/voice-consumer.test.js can exercise the money/data-shaping paths
 * without the emulator.
 */
'use strict';

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { logger } = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { tasksFromSummary, insuranceBackfill, denormalizeSignals, parseWhen } = require('./voice-consumer-logic');

// ── Trigger ────────────────────────────────────────────────────────────────
exports.voiceConsumer = onDocumentWritten(
  { region: 'us-central1', document: 'leads/{leadId}/recordings/{recordingId}', memory: '256MiB' },
  async (event) => {
    const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
    // Fire once, only for a completed recording that carries a summary and
    // hasn't been consumed. The consumedAt write below re-fires this trigger;
    // that second pass sees consumedAt set and returns here (no double-apply).
    if (!after || after.status !== 'complete' || !after.summary || after.consumedAt) return;

    const leadId = event.params.leadId;
    const recordingId = event.params.recordingId;
    const summary = after.summary;
    const db = getFirestore();
    const leadRef = db.doc('leads/' + leadId);

    try {
      const leadSnap = await leadRef.get();
      if (!leadSnap.exists) { logger.warn('voiceConsumer: lead missing', { leadId, recordingId }); return; }
      const lead = leadSnap.data() || {};

      const tasks = tasksFromSummary(summary);
      const insPatch = insuranceBackfill(lead, summary);
      const signals = denormalizeSignals(summary);

      const batch = db.batch();
      const tasksCol = db.collection('leads/' + leadId + '/tasks');
      tasks.forEach((t) => {
        batch.set(tasksCol.doc(), {
          text: t.text, done: false, dueDate: t.dueDate,
          source: 'call', recordingId,
          createdAt: FieldValue.serverTimestamp(),
        });
      });

      const leadUpdate = Object.assign({}, insPatch, {
        callRedFlags: signals.callRedFlags,
        callObjections: signals.callObjections,
        lastCallSummaryAt: FieldValue.serverTimestamp(),
      });
      if (Object.keys(insPatch).length) leadUpdate.insBackfilledFromCall = true;
      batch.set(leadRef, leadUpdate, { merge: true });

      // Idempotency marker on the recording — set LAST so a mid-batch failure
      // leaves it unset and Firestore's retry re-applies from scratch.
      batch.set(event.data.after.ref, { consumedAt: FieldValue.serverTimestamp() }, { merge: true });

      await batch.commit();
      logger.info('voiceConsumer applied', {
        leadId, recordingId, tasks: tasks.length,
        insFilled: Object.keys(insPatch), redFlags: signals.callRedFlags.length,
      });
    } catch (e) {
      logger.error('voiceConsumer failed', { leadId, recordingId, err: e && e.message });
      throw e; // let Firestore retry (consumedAt unset → safe re-apply)
    }
  }
);

exports._test = { tasksFromSummary, insuranceBackfill, denormalizeSignals, parseWhen };

