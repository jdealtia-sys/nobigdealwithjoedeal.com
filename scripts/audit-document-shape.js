/**
 * scripts/audit-document-shape.js — READ ONLY. Writes nothing.
 *
 * Prints the exact shape of the documents the REAL upload path produces, so a
 * bulk importer can replicate it rather than invent it. Guessing the schema is
 * how you end up with rows the UI cannot render.
 *
 * RUN
 *   node scripts/audit-document-shape.js [--lead=<id>]
 */
'use strict';

const { initAdmin, getFirestore } = require('./_admin');
const PROJECT = process.env.NBD_PROJECT || 'nobigdeal-pro';
const args = process.argv.slice(2);
const ONE = (args.find(a => a.startsWith('--lead=')) || '').split('=')[1] || '';

(async () => {
  initAdmin({ projectId: PROJECT });
  const db = getFirestore();

  const leads = ONE
    ? [await db.collection('leads').doc(ONE).get()]
    : (await db.collection('leads').get()).docs;

  let total = 0;
  const shapes = new Map();
  for (const l of leads) {
    if (!l.exists) continue;
    const docs = await l.ref.collection('documents').get();
    if (docs.empty) continue;
    docs.forEach((d) => {
      total++;
      const x = d.data() || {};
      const keys = Object.keys(x).sort().join(',');
      if (!shapes.has(keys)) shapes.set(keys, { n: 0, sample: { leadId: l.id, docId: d.id, data: x } });
      shapes.get(keys).n++;
    });
  }

  console.log('');
  console.log(`documents found across all leads: ${total}`);
  console.log(`distinct field shapes: ${shapes.size}`);
  for (const [keys, v] of shapes) {
    console.log('');
    console.log(`── ${v.n} doc(s) with fields: ${keys}`);
    console.log(`   lead ${v.sample.leadId} / doc ${v.sample.docId}`);
    Object.entries(v.sample.data).forEach(([k, val]) => {
      let s;
      if (val && val.toDate) s = 'Timestamp(' + val.toDate().toISOString() + ')';
      else if (typeof val === 'string' && val.length > 150) s = JSON.stringify(val.slice(0, 150)) + '…(' + val.length + ' chars)';
      else s = JSON.stringify(val);
      console.log(`     ${k}: ${s}`);
    });
  }
  console.log('');
  console.log('READ ONLY — nothing was written.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
