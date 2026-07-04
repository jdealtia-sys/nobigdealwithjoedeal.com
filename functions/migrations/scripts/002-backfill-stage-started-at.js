/**
 * Migration 002 — backfill leads.stageStartedAt where missing.
 *
 * Ops Audit #4 P1 item 5: the dormant-lead and weekly-digest jobs
 * over-read (whole-book scans with a 2000-doc truncation cap) because
 * their queries couldn't be date-windowed without a reliably-present
 * timestamp. `stageStartedAt` is written on every lead creation and
 * stage transition TODAY (8 write sites), but leads created before
 * that convention landed may lack it — and Firestore range queries
 * exclude documents missing the ordered field entirely, so a
 * `stageStartedAt <= cutoff` window would silently drop exactly the
 * oldest (most dormant) legacy leads.
 *
 * Fix: for every lead missing stageStartedAt, seed it from the same
 * fallback chain the in-memory filters used (updatedAt || createdAt).
 * After this runs, `where('stageStartedAt', ...)` windows are complete
 * and the digest queries can drop their whole-book scans.
 *
 * Idempotent: backfillField skips docs where the field is already set.
 */

'use strict';

exports.version = 2;
exports.name    = 'backfill-stage-started-at';
exports.up = async (ctx) => {
  const r = await ctx.backfillField('leads', 'stageStartedAt', async (doc) => {
    const d = doc.data();
    return d.updatedAt || d.createdAt || null;
  });
  return { docsRead: r.docsRead, docsWritten: r.docsWritten };
};
