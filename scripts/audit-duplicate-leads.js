/**
 * scripts/audit-duplicate-leads.js — READ ONLY. Writes nothing.
 *
 * Finds leads that share a name within one company, and prints enough of each
 * side to decide which is the keeper on evidence rather than on whichever came
 * back first. Counts the subcollections too — a lead with documents, photos
 * and notes is the live record; an empty twin is a double-save.
 *
 * RUN
 *   node scripts/audit-duplicate-leads.js --company=<id>
 */
'use strict';

const { initAdmin, getFirestore } = require('./_admin');
const PROJECT = process.env.NBD_PROJECT || 'nobigdeal-pro';
const args = process.argv.slice(2);
const COMPANY = (args.find(a => a.startsWith('--company=')) || '').split('=')[1] || '';
if (!COMPANY) { console.error('--company=<id> required'); process.exit(2); }

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const dt = (v) => (v && v.toDate ? v.toDate().toISOString().slice(0, 16).replace('T', ' ') : '—');

(async () => {
  initAdmin({ projectId: PROJECT });
  const db = getFirestore();
  const snap = await db.collection('leads').where('companyId', '==', COMPANY).get();

  const byName = new Map();
  snap.forEach((d) => {
    const x = d.data() || {};
    const n = norm([x.firstName, x.lastName].filter(Boolean).join(' ') || x.name);
    if (!n) return;
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push({ ref: d.ref, id: d.id, x });
  });

  const dupes = [...byName.entries()].filter(([, v]) => v.length > 1);
  console.log('');
  console.log(`/leads for ${COMPANY}: ${snap.size}   names with more than one record: ${dupes.length}`);

  for (const [name, rows] of dupes) {
    console.log('');
    console.log(`══ ${name}  (${rows.length} records)`);
    for (const r of rows) {
      const counts = {};
      for (const sub of ['documents', 'photos', 'notes', 'tasks', 'estimates', 'communications']) {
        try { counts[sub] = (await r.ref.collection(sub).get()).size; } catch (_) { counts[sub] = '?'; }
      }
      const filled = Object.entries(r.x).filter(([, v]) => v !== null && v !== '' && v !== undefined).length;
      console.log(`   ── ${r.id}`);
      console.log(`      stage=${r.x.stage || '—'}  jobValue=${r.x.jobValue != null ? r.x.jobValue : '—'}  source=${r.x.source || '—'}  deleted=${r.x.deleted === true}  prospect=${r.x.isProspect === true}`);
      console.log(`      address=${JSON.stringify(r.x.address || null)}`);
      console.log(`      phone=${JSON.stringify(r.x.phone || null)}  email=${JSON.stringify(r.x.email || null)}`);
      console.log(`      created=${dt(r.x.createdAt)}  updated=${dt(r.x.updatedAt || r.x.lastModified)}  fieldsSet=${filled}`);
      console.log(`      subcollections: ${Object.entries(counts).map(([k, v]) => k + '=' + v).join('  ')}`);
      const notes = String(r.x.notes || '').replace(/\s+/g, ' ').trim();
      if (notes) console.log(`      notes: ${notes.slice(0, 160)}${notes.length > 160 ? '…' : ''}`);
    }
  }

  console.log('');
  console.log('READ ONLY — nothing was written.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
