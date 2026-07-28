/**
 * tests/estimate-hub-controls.test.js — the per-customer Estimates hub must not
 * hide a destructive action behind a benign label, and must not report success
 * for an action whose result the rep will never see.
 *
 * 1. "🗄 Archive" dispatched deleteEstimateAction -> window._deleteEstimate ->
 *    deleteDoc(). An archive box is the universal "filed away, still there"
 *    affordance; this permanently destroyed the document. The confirm did say
 *    "This cannot be undone", so the control contradicted itself — and the
 *    reassuring half is the part a rep reads first. The dashboard's own
 *    estimates list already calls this exact action "delete"; the hub was the
 *    outlier.
 *
 *    Relabelled rather than converted to a soft delete on purpose: the tenant
 *    estimates snapshots that populate window._estimates apply no `deleted`
 *    filter, so a soft-deleted estimate would stay visible on the dashboard and
 *    Archive would merely look broken instead. A real archive means updating
 *    those readers first — a feature, not a bug fix. This test pins the reason,
 *    so if someone adds the filter later they can see the constraint has lifted.
 *
 * 2. "⎘ Copy" routed to duplicateEstimateAction, whose underlying
 *    _duplicateEstimate deliberately sets `leadId = null` so the copy can be
 *    assigned from the dashboard list — the right default THERE. In a hub that
 *    lists by leadId, the copy was filtered straight out: the rep got
 *    "✓ Estimate duplicated", an unchanged list and an unchanged count.
 *
 * Zero deps.  Run: node tests/estimate-hub-controls.test.js
 */
'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PRO_JS = path.join(ROOT, 'docs/pro/js');
const read = (p) => fs.readFileSync(path.join(PRO_JS, p), 'utf8');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
const decomment = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

console.log('ESTIMATE HUB — destructive label honesty + copy attachment');

const HUB = read('customer-estimate-hub.js');
const HUB_CODE = decomment(HUB);

// ── 1. The destructive control says what it does ──────────────────────
{
  ok('the destructive button is not labelled "Archive"',
    !/>🗄 Archive</.test(HUB_CODE),
    'an archive-box label on a deleteDoc() is a data-loss trap');
  ok('it is labelled as a delete',
    /🗑 Delete</.test(HUB_CODE));

  // The action it dispatches must still be the real delete — relabelling would
  // be worse than useless if the wiring silently changed too.
  ok('it still dispatches deleteEstimateAction',
    /case 'archive':\s*withEstimates\('deleteEstimateAction'/.test(HUB_CODE));

  // The underlying call really is destructive — pin that, so this test explains
  // itself if anyone wonders why the label matters.
  const boot = read('dashboard-bootstrap.module.js');
  ok('_deleteEstimate is genuinely a hard delete (deleteDoc)',
    /window\._deleteEstimate = async \(id\) => \{[\s\S]{0,300}deleteDoc\(doc\(db, 'estimates', id\)\)/.test(boot),
    'if this became a soft delete, the label could honestly go back to Archive');

  // The constraint that made relabel (not soft-delete) the right call. Scope
  // this to the ESTIMATES listeners specifically — dashboard-bootstrap also
  // queries where('deleted','==',true) against /leads for the trash view, and a
  // whole-file grep matches that and reports the opposite of the truth.
  const estQueryLines = boot.split('\n').filter((l) => /collection\(db, ?'estimates'\)/.test(l));
  ok('the tenant estimates snapshots still apply no `deleted` filter',
    estQueryLines.length > 0 && !estQueryLines.some((l) => /where\('deleted'/.test(l)),
    'if a deleted filter is added, a real Archive becomes viable — revisit the label');
}

// ── 2. A duplicate made from a customer stays with that customer ──────
{
  ok('the hub no longer routes Copy through the unassigning generic action',
    !/case 'duplicate':\s*withEstimates\('duplicateEstimateAction'/.test(HUB_CODE),
    'that path nulls leadId, so the copy is filtered out of this leadId-listed hub');
  ok('the hub has its own duplicate handler', /function doDuplicate\(id\)/.test(HUB_CODE));
  ok('the copy is attached to the hub\'s lead',
    /updateDoc\(window\.doc\(window\.db, 'estimates', newId\), \{ leadId: lead \}\)/.test(HUB_CODE));
  ok('the lead is pinned before the async duplicate (not read back later)',
    /var lead = _leadId;/.test(HUB_CODE));
  ok('the in-memory copy is patched so the repaint shows it',
    /arr\[i\]\.leadId = lead;/.test(HUB_CODE),
    'the hub renders from window._estimates and the reload races the attach');
  ok('success is only claimed once the copy is actually attached',
    /Estimate duplicated, but not attached to this customer/.test(HUB_CODE),
    'a failed attach must not toast plain success — the rep would go looking for it');

  // The generic action must KEEP its unassigning behaviour: it is correct on
  // the dashboard list, which is a different surface with a different meaning.
  const boot = read('dashboard-bootstrap.module.js');
  ok('the dashboard duplicate still intentionally leaves the copy unassigned',
    /copy\.leadId = null;/.test(boot),
    'this fix must not change the dashboard-list default');
}

console.log('\n──────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
