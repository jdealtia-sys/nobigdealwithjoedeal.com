/**
 * Migration 001 — no-op initializer.
 *
 * The first migration ever to run on a project. Establishes the
 * /system/migrations doc + /system/migrations/history collection so
 * the runner has somewhere to write its state. Touches no domain
 * data.
 *
 * Future migrations should follow this template:
 *
 *   exports.version = 002;
 *   exports.name    = 'short-kebab-case-handle';
 *   exports.up = async (ctx) => {
 *     // Idempotent. Resumable. Use ctx.backfillField for the common
 *     // "for every doc, set field if missing" shape.
 *     const r = await ctx.backfillField('leads', 'companyId',
 *       async (doc) => deriveCompanyIdFor(doc.data().userId));
 *     return { docsRead: r.docsRead, docsWritten: r.docsWritten };
 *   };
 */

'use strict';

exports.version = 1;
exports.name    = 'noop-init';
exports.up = async (ctx) => {
  ctx.log('migration framework initialized');
  return { docsRead: 0, docsWritten: 0, note: 'first run — establishes /system/migrations state doc' };
};
