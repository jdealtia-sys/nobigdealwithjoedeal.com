/**
 * Migration 005 — relink orphaned estimates (leadId: null) to their leads.
 *
 * CRM-audit follow-up (2026-07-26). Two client bugs saved estimates
 * CREATED but never LINKED to their customer:
 *   - estimate-v2-ui.js _buildSavePayload read state.leadId only, which is
 *     set on the REOPEN path — a fresh estimate opened from a customer card
 *     saved leadId:null (fixed: falls back to state.customer.leadId);
 *   - job-templates-ui.js lead picker never synced its pick into
 *     state.leadId, so a modal repaint dropped the chosen customer (fixed:
 *     onSelect mirrors into state).
 * Both fixes stop NEW orphans. This migration heals the backlog: an
 * orphaned estimate is invisible on its customer page and mobile Activity
 * tab (both query estimates by leadId) and never stamped the lead's
 * jobValue/primaryEstimateId, so the pipeline under-reports.
 *
 * Matching rule — deliberately conservative, mirroring the classic
 * builder's save-time resolver (estimates.js: normalized equality, else
 * UNIQUE normalized prefix, else give up):
 *   norm(s) = lowercase, strip every non-alphanumeric.
 *   Candidate pool = leads in the SAME TENANT as the estimate only:
 *   leads keyed by the estimate's companyId, plus leads owned by the
 *   estimate's userId (covers pre-team-visibility estimates that carry
 *   no companyId). Cross-tenant links are structurally impossible.
 *     1. exact addr match, exactly 1 lead        → link (via 'addr')
 *     2. exact addr match, >1 lead → narrow by exact owner-name match;
 *        exactly 1                               → link (via 'addr+name')
 *     3. no exact match → lead addr startsWith estimate addr, exactly 1
 *                                                → link (via 'addr-prefix')
 *     4. estimate has NO addr → exact owner-name match, exactly 1
 *                                                → link (via 'name')
 *   Anything else is SKIPPED and reported, never guessed: ambiguous
 *   matches, no-match, unmatchable (no addr AND no owner), no-tenant.
 *   Name-matching is NOT used as a fallback when the estimate HAS an
 *   address that failed to match — same owner name on a different
 *   address is likely a different property, and a wrong link is worse
 *   than a reported skip.
 *
 * Stamp-back — mirrors _saveEstimate's first-estimate behavior, minus
 * the funnel side-effects: for each lead that gains links here and has
 * NO primaryEstimateId, stamp primaryEstimateId (+ jobValue when the
 * estimate carries a positive grandTotal, lastEstimateAt from its
 * createdAt) using the MOST RECENT linked estimate. Leads that already
 * have a primaryEstimateId are left untouched — a rep-confirmed number
 * is never clobbered by a migration. We deliberately do NOT touch the
 * lead's funnel position — a migration must not shuffle pipeline cards.
 *
 * Audit trail — every decision (linked + skipped, capped at 300 rows
 * each) is written to /system/migrations/reports/005-relink-orphan-estimates
 * so the operator can review exactly what was relinked and hand-fix the
 * reported skips. Relinking is reversible per-estimate (null the leadId).
 *
 * Idempotent: estimates already carrying a leadId are skipped, and the
 * stamp-back is gated on the lead still lacking primaryEstimateId, so a
 * re-run (or an interrupted run resumed by the next tick) converges to
 * the same state. The report doc is overwritten with the latest run.
 */

'use strict';

const { Timestamp } = require('firebase-admin/firestore');

exports.version = 5;
exports.name    = 'relink-orphan-estimates';
exports.up = async (ctx) => {
  const db = ctx.db;
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  let docsRead = 0;
  let docsWritten = 0;

  // ── Pass 1: index the leads book by tenant ────────────────────────
  // tenantPools: 'c:<companyId>' and 'u:<userId>' → [{id, addrNorm, nameNorm}]
  // A lead registers under both keys; per-estimate pools dedup by id.
  const tenantPools = new Map();
  const leadInfo = new Map(); // id → { primaryEstimateId }
  function register(key, entry) {
    if (!tenantPools.has(key)) tenantPools.set(key, []);
    tenantPools.get(key).push(entry);
  }
  for await (const snap of ctx.pages('leads')) {
    for (const doc of snap.docs) {
      docsRead++;
      const l = doc.data() || {};
      // Field fallbacks mirror job-templates-ui.js's lead → owner/addr stamp.
      const name = l.name || l.customerName
        || ((l.firstName || '') + ' ' + (l.lastName || '')).trim();
      const entry = {
        id: doc.id,
        addrNorm: norm(l.address || l.addr),
        nameNorm: norm(name),
      };
      leadInfo.set(doc.id, { primaryEstimateId: l.primaryEstimateId || null });
      if (l.companyId) register('c:' + l.companyId, entry);
      if (l.userId)    register('u:' + l.userId, entry);
    }
  }

  // ── Pass 2: match orphans ─────────────────────────────────────────
  const counts = {
    orphans: 0, linked: 0,
    ambiguous: 0, noMatch: 0, unmatchable: 0, noTenant: 0,
  };
  const linkedRows = [];  // {estimateId, leadId, via, addr, owner}
  const skippedRows = []; // {estimateId, reason, addr, owner}
  const CAP = 300;
  // leadId → [{estimateId, grandTotal, createdAt}] for the stamp-back pass.
  const linksByLead = new Map();

  let batch = db.batch();
  let pending = 0;
  async function flush() {
    if (pending === 0) return;
    await batch.commit();
    ctx.log('  committed ' + pending + ' writes');
    batch = db.batch();
    pending = 0;
  }

  for await (const snap of ctx.pages('estimates')) {
    for (const doc of snap.docs) {
      docsRead++;
      const e = doc.data() || {};
      if (e.leadId) continue; // already linked — idempotent skip
      counts.orphans++;
      const addr = e.addr || e.address || '';
      const owner = e.owner || e.customerName || '';

      function skip(reason) {
        counts[reason === 'ambiguous-addr' || reason === 'ambiguous-prefix' || reason === 'ambiguous-name'
          ? 'ambiguous'
          : reason === 'no-match' ? 'noMatch'
          : reason === 'no-tenant' ? 'noTenant' : 'unmatchable']++;
        if (skippedRows.length < CAP) {
          skippedRows.push({ estimateId: doc.id, reason, addr, owner });
        }
      }

      // Same-tenant candidate pool only (dedup a lead seen via both keys).
      const seen = new Set();
      const pool = [];
      const keys = [];
      if (e.companyId) keys.push('c:' + e.companyId);
      if (e.userId)    keys.push('u:' + e.userId);
      if (keys.length === 0) { skip('no-tenant'); continue; }
      for (const k of keys) {
        for (const entry of (tenantPools.get(k) || [])) {
          if (!seen.has(entry.id)) { seen.add(entry.id); pool.push(entry); }
        }
      }

      const addrNorm = norm(addr);
      const nameNorm = norm(owner);
      if (!addrNorm && !nameNorm) { skip('unmatchable'); continue; }

      let leadId = null, via = null;
      if (addrNorm) {
        const exact = pool.filter(p => p.addrNorm && p.addrNorm === addrNorm);
        if (exact.length === 1) {
          leadId = exact[0].id; via = 'addr';
        } else if (exact.length > 1) {
          const narrowed = nameNorm ? exact.filter(p => p.nameNorm === nameNorm) : [];
          if (narrowed.length === 1) { leadId = narrowed[0].id; via = 'addr+name'; }
          else { skip('ambiguous-addr'); continue; }
        } else {
          // No exact — unique-prefix, the classic builder's second tier.
          const prefix = pool.filter(p =>
            p.addrNorm && p.addrNorm.length >= addrNorm.length && p.addrNorm.startsWith(addrNorm));
          if (prefix.length === 1) { leadId = prefix[0].id; via = 'addr-prefix'; }
          else if (prefix.length > 1) { skip('ambiguous-prefix'); continue; }
          else { skip('no-match'); continue; } // has an addr, nothing matched — never fall through to name
        }
      } else {
        // Address-less estimate — owner name is all we have; unique or nothing.
        const byName = pool.filter(p => p.nameNorm && p.nameNorm === nameNorm);
        if (byName.length === 1) { leadId = byName[0].id; via = 'name'; }
        else if (byName.length > 1) { skip('ambiguous-name'); continue; }
        else { skip('no-match'); continue; }
      }

      counts.linked++;
      if (linkedRows.length < CAP) {
        linkedRows.push({ estimateId: doc.id, leadId, via, addr, owner });
      }
      if (!linksByLead.has(leadId)) linksByLead.set(leadId, []);
      linksByLead.get(leadId).push({
        estimateId: doc.id,
        grandTotal: Number(e.grandTotal) || 0,
        createdAt: e.createdAt || null,
      });
      batch.update(doc.ref, { leadId });
      pending++; docsWritten++;
      if (pending >= 250) await flush();
    }
  }
  await flush();

  // ── Pass 3: stamp-back for leads that never had a primary estimate ──
  // Most-recent linked estimate wins (createdAt; missing sorts oldest).
  // Rep-confirmed numbers are sacred: if the lead already has a
  // primaryEstimateId we change NOTHING on it.
  let stamped = 0;
  const ms = (t) => (t && typeof t.toMillis === 'function') ? t.toMillis() : 0;
  for (const [leadId, ests] of linksByLead) {
    const info = leadInfo.get(leadId);
    if (!info || info.primaryEstimateId) continue;
    ests.sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
    const primary = ests[0];
    const update = {
      primaryEstimateId: primary.estimateId,
      lastEstimateAt: primary.createdAt || Timestamp.now(),
    };
    // Only stamp a jobValue the pipeline can trust; never zero out a KPI.
    if (primary.grandTotal > 0) update.jobValue = primary.grandTotal;
    batch.update(db.doc('leads/' + leadId), update);
    pending++; docsWritten++; stamped++;
    if (pending >= 250) await flush();
  }
  await flush();

  // ── Audit report — reviewable from the console, reversible per-row ──
  await db.doc('system/migrations/reports/005-relink-orphan-estimates').set({
    version: 5,
    ranAt: Timestamp.now(),
    counts: { ...counts, leadsStamped: stamped },
    linked: linkedRows,
    linkedTruncated: Math.max(0, counts.linked - linkedRows.length),
    skipped: skippedRows,
    skippedTruncated: Math.max(0,
      (counts.ambiguous + counts.noMatch + counts.unmatchable + counts.noTenant) - skippedRows.length),
  });
  docsWritten++;

  ctx.log('orphans=' + counts.orphans + ' linked=' + counts.linked
    + ' ambiguous=' + counts.ambiguous + ' noMatch=' + counts.noMatch
    + ' unmatchable=' + counts.unmatchable + ' noTenant=' + counts.noTenant
    + ' leadsStamped=' + stamped);
  return {
    docsRead,
    docsWritten,
    note: 'linked ' + counts.linked + '/' + counts.orphans + ' orphans; stamped '
      + stamped + ' leads; skipped ' + (counts.ambiguous + counts.noMatch
      + counts.unmatchable + counts.noTenant) + ' (see /system/migrations/reports)',
  };
};
