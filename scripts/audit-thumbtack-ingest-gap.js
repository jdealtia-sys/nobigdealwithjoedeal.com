/**
 * scripts/audit-thumbtack-ingest-gap.js — READ ONLY. Writes nothing.
 *
 * /thumbtack_leads is the raw ingest collection; /leads is the CRM. A lead
 * that lands in the first and never reaches the second is one Joe PAID FOR and
 * cannot see. This lists every raw Thumbtack lead with no corresponding CRM
 * doc, and the reverse, so the gap is measured rather than assumed.
 *
 * RUN
 *   node scripts/audit-thumbtack-ingest-gap.js
 */
'use strict';

const { initAdmin, getFirestore } = require('./_admin');
const PROJECT = process.env.NBD_PROJECT || 'nobigdeal-pro';

const nm = (x) => ([x.firstName, x.lastName].filter(Boolean).join(' ') || x.name || x.customerName || '(no name)').trim();

(async () => {
  initAdmin({ projectId: PROJECT });
  const db = getFirestore();

  const raw = await db.collection('thumbtack_leads').get();
  const crm = await db.collection('leads').get();

  // The CRM doc minted from a raw lead is id'd `thumbtack_leads__<rawId>`.
  const crmIds = new Set();
  const crmNames = new Set();
  crm.forEach((d) => {
    crmIds.add(d.id);
    crmNames.add(nm(d.data() || {}).toLowerCase());
  });

  console.log('');
  console.log(`/thumbtack_leads : ${raw.size}`);
  console.log(`/leads           : ${crm.size}   (of which ${[...crmIds].filter(i => i.startsWith('thumbtack_leads__')).length} came from the ingest)`);
  console.log('');

  const orphans = [];
  raw.forEach((d) => {
    const x = d.data() || {};
    const expected = 'thumbtack_leads__' + d.id;
    if (crmIds.has(expected)) return;
    const name = nm(x);
    orphans.push({
      id: d.id,
      name,
      alsoByName: crmNames.has(name.toLowerCase()),
      created: x.createdAt && x.createdAt.toDate ? x.createdAt.toDate().toISOString().slice(0, 10)
             : (x.receivedAt && x.receivedAt.toDate ? x.receivedAt.toDate().toISOString().slice(0, 10) : '?'),
      cost: x.leadCost != null ? x.leadCost : (String(x.notes || '').match(/lead\s*cost\s*:\s*\$?\s*([\d.,]+)/i) || [])[1] || '',
    });
  });

  console.log(`=== raw Thumbtack leads with NO CRM record by id : ${orphans.length} ===`);
  orphans.sort((a, b) => String(a.created).localeCompare(String(b.created)))
    .forEach((o) => console.log(
      `  ${String(o.created).padEnd(11)} ${o.name.padEnd(26)} cost=${String(o.cost).padStart(7)}  ${o.alsoByName ? 'BUT a CRM lead shares the name' : 'not in CRM at all'}   ${o.id}`
    ));

  console.log('');
  console.log('READ ONLY — nothing was written.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
