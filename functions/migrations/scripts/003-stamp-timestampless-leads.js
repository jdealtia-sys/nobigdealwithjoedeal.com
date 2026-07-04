/**
 * Migration 003 — stamp stageStartedAt on leads that have NO timestamps.
 *
 * Security-review LOW (2026-07-04, batch-5 diff review): migration 002
 * seeded stageStartedAt from `updatedAt || createdAt`, but returned null
 * for leads missing BOTH — and backfillField skips null values. Firestore
 * range queries exclude documents missing the ordered field entirely, so
 * those leads are permanently invisible to the date-windowed dormant
 * query (dormant-leads.js) — they can NEVER surface in a re-engagement
 * nudge, silently and forever.
 *
 * Fix: stamp the stragglers with the migration-run time. Trade-off,
 * considered deliberately:
 *   - now()  → the lead becomes window-visible and, if untouched, shows
 *              up as dormant after the standard 30 days. No sudden noise
 *              in the next Wednesday nudge.
 *   - epoch  → immediately dormant, but a doc with zero timestamps is
 *              usually malformed/ancient; blasting "Unnamed lead, 20000
 *              days dormant" rows into digest emails helps nobody.
 * We take now(). Any real stage move overwrites it with the truth.
 *
 * Related accepted approximation (the OTHER review LOW, documented here
 * rather than "fixed"): 002's updatedAt fallback means a legacy lead
 * edited recently but stage-stuck for months under-reports its dormancy
 * until its next stage transition. That matched the in-memory fallback
 * chain the digest already used (stageStartedAt || updatedAt || createdAt),
 * affects only that owner's nudge timing, and self-heals on every stage
 * move — a truer value simply doesn't exist in the data.
 *
 * We deliberately do NOT fabricate createdAt for these docs: the weekly
 * digest counts createdAt-windowed leads as "new this week", and a
 * backfilled createdAt = now() would report ancient malformed leads as
 * brand-new — worse than the blind spot it closes.
 *
 * Idempotent: backfillField skips docs where the field is already set,
 * so this only touches 002's leftovers (and nothing on re-run).
 */

'use strict';

const { Timestamp } = require('firebase-admin/firestore');

exports.version = 3;
exports.name    = 'stamp-timestampless-leads';
exports.up = async (ctx) => {
  const r = await ctx.backfillField('leads', 'stageStartedAt', async (doc) => {
    const d = doc.data();
    // 002 already handled docs with either timestamp; keep its chain as
    // first preference so an interrupted 002 run is also completed here.
    return d.updatedAt || d.createdAt || Timestamp.now();
  });
  return { docsRead: r.docsRead, docsWritten: r.docsWritten };
};
