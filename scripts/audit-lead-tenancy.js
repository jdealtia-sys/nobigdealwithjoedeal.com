/**
 * scripts/audit-lead-tenancy.js — READ ONLY. Writes nothing.
 *
 * /leads is a multi-tenant collection. Before any bulk write, this answers the
 * only question that matters: whose docs am I about to touch?
 *
 * RUN
 *   node scripts/audit-lead-tenancy.js
 */
'use strict';

const { initAdmin, getFirestore } = require('./_admin');
const PROJECT = process.env.NBD_PROJECT || 'nobigdeal-pro';

(async () => {
  initAdmin({ projectId: PROJECT });
  const db = getFirestore();
  const snap = await db.collection('leads').get();

  const byCompany = new Map();
  const sourceByCompany = new Map();

  snap.forEach((d) => {
    const x = d.data() || {};
    const co = x.companyId || x.tenantId || '(none)';
    byCompany.set(co, (byCompany.get(co) || 0) + 1);

    const src = String(x.source == null ? '' : x.source).trim() || '(empty)';
    if (!sourceByCompany.has(co)) sourceByCompany.set(co, new Map());
    const m = sourceByCompany.get(co);
    m.set(src, (m.get(src) || 0) + 1);
  });

  console.log('');
  console.log(`/leads total: ${snap.size}`);
  console.log('');
  console.log('=== docs per companyId ===');
  [...byCompany.entries()].sort((a, b) => b[1] - a[1])
    .forEach(([co, n]) => console.log(`  ${String(n).padStart(4)}  ${co}`));

  console.log('');
  console.log('=== source values, per company ===');
  [...sourceByCompany.entries()]
    .sort((a, b) => byCompany.get(b[0]) - byCompany.get(a[0]))
    .forEach(([co, m]) => {
      console.log(`  ${co}  (${byCompany.get(co)} leads)`);
      [...m.entries()].sort((a, b) => b[1] - a[1])
        .forEach(([s, n]) => console.log(`      ${String(n).padStart(3)}  ${s}`));
    });

  // Spot-check the docs whose names looked seeded.
  console.log('');
  console.log('=== docs with a non-canonical source: who owns them ===');
  const odd = ['door_knock', 'referral', 'google', 'storm_alert', 'website',
               'Website — Contact form', 'Website — Inspection / Storm tool'];
  snap.forEach((d) => {
    const x = d.data() || {};
    const src = String(x.source == null ? '' : x.source).trim();
    if (!odd.includes(src)) return;
    const name = [x.firstName, x.lastName].filter(Boolean).join(' ') || x.name || '(no name)';
    const created = x.createdAt && x.createdAt.toDate ? x.createdAt.toDate().toISOString().slice(0, 10) : '?';
    console.log(`  ${src.padEnd(36)} ${name.padEnd(22)} co=${String(x.companyId || '(none)').padEnd(24)} ${created}  ${d.id}`);
  });

  console.log('');
  console.log('READ ONLY — nothing was written.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
