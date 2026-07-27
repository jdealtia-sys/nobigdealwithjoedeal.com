/**
 * Migration 006 — unify the two task stores.
 *
 * RoofLink-parity feature 6 follow-up (2026-07-27). Two parallel task
 * systems never shared data:
 *   - the dashboard (tasks.js), notification bell (_taskCache), and voice
 *     quick-capture used the leads/{leadId}/tasks SUBCOLLECTION
 *     ({text, done, dueDate});
 *   - the customer page used a TOP-LEVEL 'tasks' collection
 *     ({leadId, userId, title, dueDate, priority, notes, done}).
 * A task created on one surface was invisible on the other. The client
 * fix makes the subcollection canonical (its rules already grant company
 * staff team visibility; writers now mirror title<->text). This migration
 * heals the backlog: every top-level task doc that carries a leadId is
 * copied into leads/{leadId}/tasks/{SAME id} — same id makes the copy
 * idempotent and re-runnable.
 *
 * The original top-level docs are LEFT IN PLACE (reversibility + any
 * stragglers still reading the old store); they are stamped
 * {migratedToSubcollection: true} so a later cleanup can find them.
 * Skips: no leadId (unlinkable), lead doc missing (orphan), copy already
 * present (idempotent re-run).
 */

'use strict';

exports.version = 6;
exports.name    = 'unify-tasks';
exports.up = async (ctx) => {
  const { db, log } = ctx;
  let docsRead = 0, docsWritten = 0;
  const counts = { total: 0, copied: 0, alreadyThere: 0, noLeadId: 0, leadMissing: 0 };

  // Cache lead existence — many tasks share a lead.
  const leadExists = new Map();
  async function checkLead(leadId) {
    if (leadExists.has(leadId)) return leadExists.get(leadId);
    const snap = await db.doc('leads/' + leadId).get();
    docsRead++;
    leadExists.set(leadId, snap.exists);
    return snap.exists;
  }

  let batch = db.batch();
  let pending = 0;
  async function flush() {
    if (pending === 0) return;
    await batch.commit();
    batch = db.batch();
    pending = 0;
  }

  for await (const snap of ctx.pages('tasks')) {
    for (const d of snap.docs) {
      docsRead++;
      counts.total++;
      const t = d.data() || {};
      const leadId = t.leadId;
      if (!leadId || typeof leadId !== 'string') { counts.noLeadId++; continue; }
      if (!(await checkLead(leadId))) { counts.leadMissing++; continue; }

      const destRef = db.doc('leads/' + leadId + '/tasks/' + d.id);
      const dest = await destRef.get();
      docsRead++;
      if (dest.exists) { counts.alreadyThere++; continue; }

      // Normalize: subcollection readers render t.text; customer page
      // renders t.title — mirror whichever the doc has into both.
      const label = t.title || t.text || 'Task';
      batch.set(destRef, {
        ...t,
        title: label,
        text: label,
        migratedFrom: 'tasks/' + d.id,
      });
      batch.update(d.ref, { migratedToSubcollection: true });
      pending += 2;
      docsWritten += 2;
      counts.copied++;
      if (pending >= 400) await flush();
    }
  }
  await flush();

  await db.doc('system/migrations/reports/006-unify-tasks').set({
    version: 6,
    ranAt: new Date().toISOString(),
    counts,
  });
  docsWritten++;

  ctx.log('tasks=' + counts.total + ' copied=' + counts.copied
    + ' alreadyThere=' + counts.alreadyThere + ' noLeadId=' + counts.noLeadId
    + ' leadMissing=' + counts.leadMissing);
  return {
    docsRead,
    docsWritten,
    note: 'copied ' + counts.copied + '/' + counts.total + ' top-level tasks into leads/{id}/tasks; '
      + counts.alreadyThere + ' already there, ' + (counts.noLeadId + counts.leadMissing) + ' unlinkable',
  };
};
