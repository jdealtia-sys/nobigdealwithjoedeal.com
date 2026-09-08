/**
 * tests/photo-report-builder.test.js — the D-6 report builder.
 *
 * D-4 shipped the photo report as a fixed document: one cover, three stat
 * cards, three phase galleries in a fixed order, every heading and every line
 * of cover prose a hardcoded literal. The rep's only choice was homeowner vs
 * adjuster. D-6 makes the document a function of `opts` + `sections`, which
 * means there is now an option contract that can drift from what the template
 * actually honours — so this asserts BOTH halves against real behaviour:
 *
 *   1. The client option contract, vm-sandboxed out of photo-report.js and
 *      executed. Enum coercion matters more than it looks: an unrecognised
 *      density reaches the <body> as an unmatched class and silently styles
 *      nothing, and an unrecognised numbering silently drops every photo
 *      number. Both fail open and look fine in review.
 *
 *   2. The real Handlebars template, compiled with the real helpers out of
 *      render-pdf.js and rendered. Asserting the OUTPUT is the point — a test
 *      that grepped photoReport.hbs for `{{#if opts.showToc}}` would pass
 *      against a template that renders the contents block unconditionally.
 *
 * Handlebars is required, not optional: .github/workflows/ci.yml installs
 * functions deps before the manifest runner precisely so a test may require()
 * out of functions/. If it cannot load, this file FAILS rather than skipping —
 * a suite that quietly renders zero assertions is how a gate goes green
 * without testing anything.
 *
 * Run: node tests/photo-report-builder.test.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PHOTO_REPORT = read('docs/pro/js/photo-report.js');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function endOfFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('function ' + name + ' not found');
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return i + 1; }
  }
  throw new Error('unbalanced braces reading ' + name);
}

console.log('PHOTO REPORT BUILDER — options, numbering, and what the template does with them');

// ══ 1. The option contract, executed ══════════════════════════════
console.log('\n1. Option contract');
const sandbox = {};
{
  // One contiguous slice: the defaults, the enum lists, and the three pure
  // functions that read them.
  const from = PHOTO_REPORT.indexOf('const REPORT_DEFAULTS');
  const to = endOfFn(PHOTO_REPORT, '_numberSections');
  vm.createContext(sandbox);
  vm.runInContext(PHOTO_REPORT.slice(from, to), sandbox);
}
const optionsFor = sandbox._reportOptions;
const numberSections = sandbox._numberSections;
const dateLabel = sandbox._dateLabel;

{
  const h = optionsFor('homeowner');
  const a = optionsFor('adjuster');

  // The two modes are different documents. If these ever converge, someone has
  // flattened a deliberate distinction.
  ok('homeowner defaults to the story look', h.density === 'comfortable' && h.showPairs === true);
  ok('adjuster defaults to the evidence look', a.density === 'evidence' && a.columns === 3);
  ok('adjuster numbers and dates every frame', a.numbering === 'continuous' && a.showDate === true);
  ok('homeowner does NOT date every frame', h.showDate === false);
  ok('homeowner report carries no signature line by default', h.signature === 'none');
  ok('adjuster report is signed', a.signature === 'adjuster');
  ok('an unknown mode falls back to homeowner',
    optionsFor('nonsense').density === h.density);

  // Enum coercion — the failure mode is silent, so this is the load-bearing part.
  ok('an unknown density falls back rather than reaching the body class',
    optionsFor('homeowner', { density: 'sparkly' }).density === 'comfortable');
  ok('an unknown numbering falls back rather than dropping every number',
    optionsFor('homeowner', { numbering: 'roman' }).numbering === 'continuous');
  ok('an unknown cover style falls back', optionsFor('homeowner', { cover: 'splash' }).cover === 'hero');
  ok('an unknown signature value falls back',
    optionsFor('adjuster', { signature: 'notary' }).signature === 'adjuster');
  ok('columns is clamped to 1..4, 0 meaning auto',
    optionsFor('homeowner', { columns: 9 }).columns === 0
    && optionsFor('homeowner', { columns: 3 }).columns === 3
    && optionsFor('homeowner', { columns: -2 }).columns === 0);
  ok('fit is cover unless explicitly contain',
    optionsFor('homeowner', { fit: 'squish' }).fit === 'cover'
    && optionsFor('homeowner', { fit: 'contain' }).fit === 'contain');

  // A default of `false` must survive the boolean normalisation pass.
  ok('an unset boolean keeps its mode default, not true',
    optionsFor('homeowner').showToc === false && optionsFor('adjuster').showToc === true);
  ok('an explicit false is honoured', optionsFor('adjuster', { showDate: false }).showDate === false);
  ok('an explicit true is honoured', optionsFor('homeowner', { showToc: true }).showToc === true);
  ok('overrides do not mutate the shared defaults',
    optionsFor('homeowner', { columns: 4 }).columns === 4 && optionsFor('homeowner').columns === 0);
}

// ══ 2. Numbering ══════════════════════════════════════════════════
console.log('\n2. Photo numbering');
{
  const mk = () => ([
    { id: 'before', photos: [{}, {}, {}] },
    { id: 'during', photos: [{}, {}] },
    { id: 'after', photos: [{}] },
  ]);

  const cont = numberSections(mk(), 'continuous');
  ok('continuous runs 1..N across the whole document',
    cont.flatMap((s) => s.photos.map((p) => p.n)).join(',') === '1,2,3,4,5,6');

  // The client fallback numbered per section, restarting at #01 three times,
  // which makes "see photo 3" ambiguous in an adjuster's narrative. Per-section
  // is still offered, but it must be the explicit choice.
  const per = numberSections(mk(), 'section');
  ok('per-section restarts at 1 in each section',
    per.flatMap((s) => s.photos.map((p) => p.n)).join(',') === '1,2,3,1,2,1');

  const none = numberSections(mk(), 'none');
  ok('none leaves no n at all — not 0, which the template would print',
    none.every((s) => s.photos.every((p) => !('n' in p))));

  ok('an empty section list does not throw', numberSections([], 'continuous').length === 0);
  ok('a section with no photos is skipped without disturbing the run',
    numberSections([{ photos: [] }, { photos: [{}, {}] }], 'continuous')[1].photos.map((p) => p.n).join(',') === '1,2');
}

// ══ 3. Capture dates ══════════════════════════════════════════════
console.log('\n3. Capture date fallback chain');
{
  // Five independent writers stamp /photos and none agree on the field or the
  // shape, so this chain is the only thing standing between a dated exhibit
  // and a blank.
  ok('reads a Firestore Timestamp (toMillis)',
    dateLabel({ createdAt: { toMillis: () => Date.UTC(2026, 7, 14, 15) } }).includes('2026'));
  ok('reads a {seconds} timestamp',
    dateLabel({ createdAt: { seconds: Math.floor(Date.UTC(2026, 7, 14, 15) / 1000) } }).includes('2026'));
  ok('reads an ISO string', dateLabel({ date: '2026-08-14T15:00:00Z' }).includes('2026'));
  ok('reads epoch millis', dateLabel({ uploadedAt: Date.UTC(2026, 7, 14, 15) }).includes('2026'));
  ok('reads a Date', dateLabel({ capturedAt: new Date(Date.UTC(2026, 7, 14, 15)) }).includes('2026'));
  ok('EXIF takenAt outranks the upload time',
    dateLabel({ exif: { takenAt: '2026-08-14T15:00:00Z' }, uploadedAt: '2026-09-02T15:00:00Z' }).includes('Aug'));
  ok('an unparseable value yields empty, not "Invalid Date"',
    dateLabel({ createdAt: 'not a date' }) === '');
  ok('a photo with no timestamp at all yields empty', dateLabel({}) === '');
}

// ══ 4. The template, rendered ═════════════════════════════════════
console.log('\n4. Template output');
{
  const Handlebars = require(path.join(ROOT, 'functions/node_modules/handlebars'));
  const R = require(path.join(ROOT, 'functions/render-pdf.js'));
  R._registerPartialsOnce();
  R._registerHelpersOnce();
  const tpl = Handlebars.compile(read('functions/print/templates/photoReport.hbs'));

  const photos = (n, from) => Array.from({ length: n }, (_, i) => ({
    url: 'x.png', caption: 'cap ' + (i + 1), location: 'North slope',
    damageType: 'Hail', severity: 'Poor', dateLabel: 'Aug 14, 2026', n: (from || 1) + i,
  }));
  const base = (opts, extra) => Object.assign({
    opts, mode: 'homeowner',
    company: { footerName: 'NBD Co', seal: 'NBD' },
    preparedFor: { name: 'A Homeowner' }, preparedBy: { name: 'Joe Deal' },
    summary: { headline: 'Head', body: 'Body' },
    sections: [{ id: 'before', title: 'Before', blurb: 'b', note: '', photos: photos(3) }],
    toc: [{ title: 'Before', count: 3 }],
    notes: { coverLetter: '', summaryBody: '', closing: '' },
    meta: [], pairs: [], stats: [],
  }, extra || {});
  const O = (o) => Object.assign({
    cover: 'hero', density: 'comfortable', columns: 0, fit: 'cover',
    numbering: 'continuous', numberLabel: '', showToc: false, showStats: true,
    showPairs: true, showDate: false, showLocation: true, showDamage: false,
    showSeverity: false, signature: 'none',
  }, o || {});

  const numbered = tpl(base(O({ numberLabel: 'Photo' })));
  ok('numbers render on the tiles', (numbered.match(/pr-num/g) || []).length === 3);
  ok('the number label prefixes the digit', /Photo\s*1/.test(numbered));

  ok('numbering:none renders no number chips',
    !/pr-num/.test(tpl(base(O({ numbering: 'none' })))));

  ok('showToc:false renders no contents block', !/pr-toc-row/.test(tpl(base(O()))));
  ok('showToc:true renders one row per section',
    (tpl(base(O({ showToc: true }))).match(/pr-toc-row/g) || []).length === 1);

  ok('showDate:false hides capture dates', !/pr-date/.test(tpl(base(O()))));
  ok('showDate:true prints them', /Aug 14, 2026/.test(tpl(base(O({ showDate: true })))));
  ok('showSeverity:false hides the badge', !/class="sev /.test(tpl(base(O()))));
  ok('showLocation:false hides the tag', !/photo-tag/.test(tpl(base(O({ showLocation: false })))));

  ok('cover:none omits the cover page',
    !/cover-v2/.test(tpl(base(O({ cover: 'none' })))));
  ok('cover:hero renders it', /cover-v2/.test(tpl(base(O()))));

  // Sections are ordered and arbitrary — the whole point of D-6.
  const reordered = tpl(base(O(), {
    sections: [
      { id: 'after', title: 'After', blurb: '', note: '', photos: photos(1) },
      { id: 'before', title: 'Before', blurb: '', note: '', photos: photos(1) },
    ],
  }));
  ok('sections render in the order given, not a fixed phase order',
    reordered.indexOf('>After<') < reordered.indexOf('>Before<'));

  // Rep-authored prose.
  const noted = tpl(base(O(), {
    notes: { coverLetter: 'Line one\n\nLine two', summaryBody: '', closing: 'Bye' },
    sections: [{ id: 'before', title: 'Before', blurb: 'b', note: 'Section note here', photos: photos(1) }],
  }));
  ok('a cover letter renders', /pr-letter/.test(noted) && /Line one/.test(noted));
  ok('a blank line becomes a paragraph break, not a lost line',
    /Line one<\/p><p>Line two/.test(noted));
  ok('a section note renders', /pr-note/.test(noted) && /Section note here/.test(noted));
  ok('a closing note renders', /Bye/.test(noted));

  // nl2br uses a triple-stache, so it owns its own escaping. Rep prose is user
  // input landing in a customer-facing PDF.
  const nasty = tpl(base(O(), {
    notes: { coverLetter: '<img src=x onerror=alert(1)>', summaryBody: '', closing: '' },
  }));
  ok('rep prose is escaped, not injected',
    !/<img src=x/.test(nasty) && /&lt;img src=x/.test(nasty));

  // Signature blocks.
  ok('signature:none renders no signature block', !/sig-line/.test(tpl(base(O()))));
  ok('signature:homeowner names the homeowner',
    /A Homeowner/.test(tpl(base(O({ signature: 'homeowner' })))));
  ok('signature:adjuster renders the attestation and adjuster line',
    /Adjuster Acknowledgment/.test(tpl(base(O({ signature: 'adjuster' })))));
  ok('signature:both renders two blocks',
    (tpl(base(O({ signature: 'both' }))).match(/sig-block/g) || []).length === 2);

  // The D-4 attestation claimed every image was unmodified. photo-editor.js
  // bakes markup into the saved file, so that was a false statement in a
  // document a carrier may rely on.
  const att = tpl(base(O({ signature: 'adjuster' }), { hasAnnotated: true }));
  ok('the attestation no longer claims images are unmodified',
    !/unmodified except/i.test(att));
  ok('the attestation declares annotated frames when there are any',
    /Annotated/.test(att));
  ok('and stays silent about annotation when there are none',
    !/Annotated/.test(tpl(base(O({ signature: 'adjuster' }), { hasAnnotated: false }))));

  // Grid columns come from the helper, not from the template counting.
  ok('columns:1 asks for the one-up grid', / one"/.test(tpl(base(O({ columns: 1 })))));
  ok('columns:4 asks for the four-up grid', / four"/.test(tpl(base(O({ columns: 4 })))));
  ok('columns:0 falls back to D-4 behaviour — three-up past six photos',
    / three"/.test(tpl(base(O({ columns: 0 }), {
      sections: [{ id: 'b', title: 'B', blurb: '', note: '', photos: photos(7) }],
    }))));
  ok('columns:0 with a short section stays two-up',
    !/photo-grid three/.test(tpl(base(O({ columns: 0 })))));

  // Density is a body class assembled by the renderer, and it is a closed set.
  ok('a known density passes through', R._normalizeDensity('evidence') === 'evidence');
  ok('an unknown density normalises to comfortable',
    R._normalizeDensity('sparkly') === 'comfortable' && R._normalizeDensity(undefined) === 'comfortable');
  ok('the per-template stylesheet is actually found',
    R._loadTemplateCss('photoReport').includes('.pr-num'));
  ok('a template with no stylesheet returns empty, not a throw',
    R._loadTemplateCss('warranty') === '');
}

console.log('\n' + (failed === 0
  ? 'PASS — ' + passed + ' assertions'
  : 'FAIL — ' + failed + ' of ' + (passed + failed) + ': ' + fails.join('; ')));
process.exit(failed === 0 ? 0 : 1);
