/**
 * tests/smoke/photo.test.js — image pipeline (Storage trigger → WebP
 * variants → srcset), AI Vision auto-tag, imageProxy retirement stubs,
 * photo-editor signed-URL migration, photo-engine inline-action
 * delegation in rendered templates.
 */

'use strict';

const path = require('path');
const { ROOT, PRO_JS, FUNCTIONS, read, readDashboardMain, readFunctionsIndex } = require('./_shared');

module.exports.run = function run(ctx) {
  const { assert, section } = ctx;

section('D8 / R-03: imageProxy stub still emits RFC 8594/9745 deprecation signals');
{
  const src = readFunctionsIndex();
  assert('imageProxy stub sets Deprecation header',
    /imageProxy[\s\S]*?res\.set\('Deprecation', 'true'\)/.test(src));
  assert('imageProxy stub sets Sunset header',
    /imageProxy[\s\S]*?res\.set\('Sunset',/.test(src));
  assert('imageProxy stub sets Link rel=successor-version to /signImageUrl',
    /imageProxy[\s\S]*?rel="successor-version"/.test(src));
  // The old "imageProxy DEPRECATED call" WARN log is obsolete — the
  // stub holds no auth and does no work, so there's no per-call log.
  // Ops visibility comes from the existing cloud_run_revision error-
  // rate alert (monitoring/alert-functions-error-rate.json) filtering
  // on imageProxy.
}

section('R-03: imageProxy retired — 410 Gone stub');
{
  const src = readFunctionsIndex();
  // The old streaming implementation MUST be gone. Its signature
  // tokens were createReadStream, imageProxy:ip rate limit, and the
  // DEPRECATED log warning — none should remain.
  assert('R-03: imageProxy no longer streams via createReadStream',
    !/imageProxy[\s\S]{0,5000}createReadStream\(\)/.test(src));
  assert('R-03: imageProxy no longer consumes the imageProxy:ip rate-limit bucket',
    !/imageProxy:ip/.test(src));
  assert('R-03: imageProxy stub returns 410 Gone',
    /exports\.imageProxy[\s\S]{0,2000}status\(410\)/.test(src));
  assert('R-03: 410 response cites the successor endpoint',
    /successor:\s*['"]\/signImageUrl['"]/.test(src));
  // The stub should be cheap — no auth, no Firestore, low concurrency.
  assert('R-03: stub is cheap (no requireAuth call in the handler body)',
    !/exports\.imageProxy[\s\S]{0,2000}requireAuth\(/.test(src));
}

section('R-03: photo-editor migrated off imageProxy');
{
  const src = read(path.join(PRO_JS, 'photo-editor.js'));
  assert('R-03: photo-editor no longer references the imageProxy URL',
    !/cloudfunctions\.net\/imageProxy/.test(src)
    && !/const PROXY_URL\s*=\s*['"]https?:\/\/[^'"]*imageProxy/.test(src));
  assert('R-03: photo-editor uses window.NBDSignedUrl.get for image loads',
    /window\.NBDSignedUrl\s*\.\s*get\(\s*path\s*\)/.test(src));
  const customer = read(path.join(ROOT, 'docs/pro/customer.html'));
  assert('R-03: customer.html loads signed-image-url.js BEFORE photo-editor.js',
    (() => {
      const helper = customer.indexOf('signed-image-url.js');
      const editor = customer.indexOf('photo-editor.js');
      return helper > 0 && editor > 0 && helper < editor;
    })());
}

section('Image pipeline (Storage trigger → WebP variants → srcset)');
{
  const pipeline = read(path.join(ROOT, 'functions/image-pipeline.js'));
  const idx      = read(FUNCTIONS + '/index.js');
  const pkg      = JSON.parse(read(FUNCTIONS + '/package.json'));
  const customer = read(path.join(ROOT, 'docs/pro/customer.html'));
  const types    = read(path.join(ROOT, 'docs/pro/js/types.js'));

  // Public surface: onObjectFinalized export wired into index.js.
  assert('image-pipeline.js exports onPhotoUploaded onObjectFinalized',
    /exports\.onPhotoUploaded\s*=\s*onObjectFinalized/.test(pipeline));
  assert('functions/index.js wires exports.onPhotoUploaded',
    /exports\.onPhotoUploaded\s*=\s*_imagePipeline\.onPhotoUploaded/.test(idx));

  // sharp is the heavy dep — must be declared so deploys install it.
  assert('functions/package.json declares sharp dependency',
    !!(pkg.dependencies && pkg.dependencies.sharp));

  // Recursion guard: variants are written back into Storage at
  // photos/{uid}/_variants/... and would re-fire the trigger
  // forever without an early-exit.
  assert('pipeline skips variant paths to prevent recursion',
    /_variants\//.test(pipeline)
    && /includes\(['"]\/?_variants\//.test(pipeline));

  // Three variants — width + quality tuned per use site.
  // 200px = grid thumb, 600px = inline, 1600px = lightbox/print.
  assert('three variants generated (200 / 600 / 1600 px)',
    /name:\s*['"]thumb['"][^}]*width:\s*200/.test(pipeline)
    && /name:\s*['"]med['"][^}]*width:\s*600/.test(pipeline)
    && /name:\s*['"]full['"][^}]*width:\s*1600/.test(pipeline));

  // EXIF auto-orient must run BEFORE resize, otherwise sideways
  // iPhone portraits land cropped wrong in the variant.
  assert('sharp pipeline calls .rotate() before .resize()',
    /\.rotate\(\)[\s\S]{0,80}\.resize\(/.test(pipeline));

  // WebP encode is the whole point — JPEG output would defeat
  // the bandwidth savings.
  assert('variants are encoded as image/webp',
    /\.webp\(/.test(pipeline)
    && /['"]image\/webp['"]/.test(pipeline));

  // Long-lived URL via firebaseStorageDownloadTokens, NOT signed
  // URLs (which would expire). Cache-Control must mark variants
  // immutable so CDN keeps them indefinitely.
  assert('variants get firebaseStorageDownloadTokens + immutable cache',
    /firebaseStorageDownloadTokens/.test(pipeline)
    && /immutable/.test(pipeline));

  // Doc lookup uses storagePath — set by the upload code below.
  // If the trigger didn't query by storagePath, legacy/fresh docs
  // would never get stamped with `urls`.
  assert('pipeline finds photo doc via storagePath equality query',
    /\.where\(['"]storagePath['"],\s*['"]==['"]/.test(pipeline));

  // Doc gets stamped with urls + variantsGeneratedAt.
  assert('pipeline stamps urls + variantsGeneratedAt on photo doc',
    /\burls:\s*generated\b/.test(pipeline)
    && /variantsGeneratedAt:[\s\S]{0,80}serverTimestamp\(\)/.test(pipeline));

  // Upload write path: customer.html must persist storagePath so
  // the trigger has something to query against.
  assert('customer.html upload stores storagePath alongside url',
    /storagePath:\s*storagePath/.test(customer)
    && /const storagePath\s*=\s*`photos\/\$\{uid\}\/\$\{filename\}`/.test(customer));

  // Render path: <img srcset> helper present + used by both the
  // overview strip and the phase grid tiles.
  assert('buildPhotoImgAttrs exposed on window for shared use',
    /window\.buildPhotoImgAttrs\s*=\s*buildPhotoImgAttrs/.test(customer));
  assert('buildPhotoImgAttrs emits srcset 200w/600w/1600w',
    /200w[\s\S]{0,60}600w[\s\S]{0,60}1600w/.test(customer));
  assert('phase grid tile uses buildPhotoImgAttrs (no raw photo.url src)',
    /var imgAttrs = buildPhotoImgAttrs\(photo, esc, \{ sizes: '180px' \}\)/.test(customer)
    && /tile \+= '<img ' \+ imgAttrs/.test(customer));
  assert('overview strip uses buildPhotoImgAttrs with 160px hint',
    /window\.buildPhotoImgAttrs[\s\S]{0,200}sizes:\s*'160px'/.test(customer));

  // Backward compat: when photo.urls is missing, helper falls
  // back to plain photo.url so legacy docs (pre-pipeline) still
  // render correctly.
  assert('buildPhotoImgAttrs falls back to photo.url when urls missing',
    /if \(!hasVariants\)[\s\S]{0,200}src="' \+ esc\(primary\)/.test(customer));

  // Type doc updated — the Photo typedef must mention the new
  // urls + storagePath fields so JSDoc autocomplete works.
  assert('types.js Photo typedef documents urls + storagePath',
    /@property \{string=\} storagePath/.test(types)
    && /@property \{\{ thumb: string, med: string, full: string \}=\} urls/.test(types));
}

section('Phase C.4 photo-engine — inline actions in rendered templates');
{
  const pe = read(path.join(ROOT, 'docs/pro/js/photo-engine.js'));
  const mainJs = readDashboardMain();

  // Every delegate branch we registered must appear in _nbdActionDelegate.
  for (const action of ['peRemove','peTagToggle','peBulkAnalyze','peOpenLightbox','peStagePhoto','peDeletePhoto']) {
    assert("delegate handles action='" + action + "'",
      new RegExp("if \\(action === '" + action + "'\\)").test(mainJs),
      'expected ' + action + ' branch in _nbdActionDelegate');
  }

  // photo-engine.js must have zero inline onclicks left — all rendered
  // buttons/imgs now carry data-action attributes the delegate handles.
  const peOnclick = (pe.match(/onclick=/g) || []).length;
  assert('photo-engine.js has zero inline onclick handlers',
    peOnclick === 0,
    'expected 0 onclick attrs in photo-engine.js; got ' + peOnclick);

  // Spot-check key conversions in the rendered template strings.
  assert('photo-preview-modal back button uses peRemove',
    /data-action="peRemove"\s+data-target="photo-preview-modal"/.test(pe),
    'expected back button to use peRemove action');
  assert('tag pills use peTagToggle (location/damage/type pills)',
    (pe.match(/data-action="peTagToggle"/g) || []).length >= 3,
    'expected at least 3 peTagToggle pills (location/damage/type)');
  assert('bulk-analyze button uses peBulkAnalyze with data-lead-id',
    /data-action="peBulkAnalyze"\s+data-lead-id="\$\{leadId\}"/.test(pe),
    'expected pe-bulk-ai-btn to use peBulkAnalyze');
  assert('gallery thumbnail uses peOpenLightbox with photo+lead ids',
    /data-action="peOpenLightbox"\s+data-photo-id="\$\{photo\.id\}"\s+data-lead-id="\$\{leadId\}"/.test(pe),
    'expected thumbnail to use peOpenLightbox');
  assert('lightbox stage button uses peStagePhoto',
    /data-action="peStagePhoto"\s+data-photo-id="\$\{photoId\}"\s+data-lead-id="\$\{leadId\}"/.test(pe),
    'expected lightbox stage button to use peStagePhoto');
  assert('lightbox delete button uses peDeletePhoto',
    /data-action="peDeletePhoto"\s+data-photo-id="\$\{photoId\}"/.test(pe),
    'expected lightbox delete button to use peDeletePhoto');
  assert('lightbox nav buttons (X / OK) use peRemove on photo-lightbox',
    (pe.match(/data-action="peRemove"\s+data-target="photo-lightbox"/g) || []).length === 2,
    'expected 2 peRemove buttons targeting photo-lightbox');
}

section('Phase B.1 — AI Vision auto-tag on photo upload');
{
  const pe = read(path.join(ROOT, 'docs/pro/js/photo-engine.js'));
  // 1. Background auto-tag is invoked after the photo doc lands.
  assert('photo-engine.js fires _autoTagPhotoBackground(photoId) after setDoc',
    /await setDoc\(photoDocRef[^)]*\)[\s\S]{0,1500}_autoTagPhotoBackground\(photoId\)/.test(pe),
    'expected uploadPhotoToFirebase to call _autoTagPhotoBackground(photoId) after setDoc');
  // 2. Helper lazy-loads the Functions SDK + calls analyzePhotoVision.
  assert('_autoTagPhotoBackground helper defined',
    /function _autoTagPhotoBackground\(photoId\)/.test(pe),
    'expected _autoTagPhotoBackground helper');
  assert('helper resolves the analyzePhotoVision callable',
    /window\._httpsCallable\(window\._functions,\s*['"]analyzePhotoVision['"]\)/.test(pe),
    'expected the helper to wire analyzePhotoVision via _httpsCallable');
  // 3. Gallery renders the .pe-ai-chip when photo.aiSuggestion is set.
  assert('gallery renders .pe-ai-chip for photos with aiSuggestion',
    /photo\.aiSuggestion[\s\S]{0,200}<span class="pe-ai-chip"/.test(pe),
    'expected gallery to render .pe-ai-chip when aiSuggestion is present');
  // 4. .pe-ai-chip CSS is theme-aware (uses --accent-fg + --accent-ring).
  assert('.pe-ai-chip CSS consumes var(--accent-fg) + var(--accent-ring)',
    /\.pe-ai-chip\s*\{[\s\S]{0,600}color:\s*var\(--accent-fg\)[\s\S]{0,400}var\(--accent-ring\)/.test(pe),
    'expected .pe-ai-chip to use --accent-fg + --accent-ring tokens');
  // 5. Pulsing-dot keyframe present.
  assert('AI chip dot has the pulsing keyframe',
    /@keyframes pe-ai-chip-pulse/.test(pe),
    'expected @keyframes pe-ai-chip-pulse');
}

section('Photos Tier-1: photo-report uses variants + escapes scope-of-work');
{
  const pr = read(path.join(ROOT, 'docs/pro/js/photo-report.js'));

  // §1.1 — _imgAttrs helper replicates buildPhotoImgAttrs locally since
  // the report renders in a popped-out doc without access to window.*.
  assert('photo-report defines a local _imgAttrs(p, sizes) helper',
    /function _imgAttrs\(p,\s*sizes\)/.test(pr),
    'expected _imgAttrs(p, sizes) helper in photo-report.js');
  assert('_imgAttrs emits srcset 200w/600w/1600w when variants present',
    /200w[\s\S]{0,80}600w[\s\S]{0,80}1600w/.test(pr));
  assert('_imgAttrs falls back to primary url when variants missing',
    /if \(!hasVariants\)[\s\S]{0,200}src="' \+ _esc\(primary\)/.test(pr));

  // Both tile renderers route through _imgAttrs — no raw _esc(p.url)
  // single-source images left in either grid.
  assert('adjuster tile uses _imgAttrs with 180px hint',
    /<img ' \+ _imgAttrs\(p,\s*'180px'\)/.test(pr));
  assert('homeowner tile uses _imgAttrs with 220px hint',
    /<img ' \+ _imgAttrs\(p,\s*'220px'\)/.test(pr));
  assert('photo-report no longer emits raw <img src=_esc(p.url) in tiles',
    !/'<img src="'\s*\+\s*_esc\(p\.url\)/.test(pr),
    'expected zero raw single-resolution <img src=_esc(p.url) tile renderers');

  // §1.2 — XSS plug: scopeOfWork must flow through _esc().
  assert('scopeOfWork is escaped before injection',
    /_esc\(lead\.scopeOfWork\)/.test(pr),
    'expected ${_esc(lead.scopeOfWork)} in Work Performed section');
  assert('scopeOfWork is not injected raw',
    !/\$\{lead\.scopeOfWork\}/.test(pr),
    'expected zero unescaped ${lead.scopeOfWork} interpolations');
}

section('Photos Tier-1: analyzeRoofPhoto pins current Sonnet build');
{
  const src = read(path.join(FUNCTIONS, 'handlers/photo.js'));
  // §1.4 — bump off the May 2025 dated Sonnet. The handler builds the
  // Anthropic body inline (no allowlist gate), so this is isolated.
  assert('analyzeRoofPhoto uses claude-sonnet-4-6',
    /model:\s*'claude-sonnet-4-6'/.test(src),
    'expected analyzeRoofPhoto to pin model: claude-sonnet-4-6');
  assert('analyzeRoofPhoto no longer pins claude-sonnet-4-20250514',
    !/'claude-sonnet-4-20250514'/.test(src),
    'expected the stale Sonnet pin to be gone from photo.js');
}

section('Photos §2.3: cap-skip event fires from BOTH AI wrappers');
{
  const classifier = read(path.join(ROOT, 'docs/pro/js/photo-ai-classifier.js'));
  const ai         = read(path.join(ROOT, 'docs/pro/js/photo-ai.js'));

  // Haiku path (analyzePhotoVision callable) — server returns
  // { skipped: true, reason }, classifier bubbles via CustomEvent.
  assert('photo-ai-classifier dispatches nbd:ai-classify-skipped on data.skipped',
    /data\.skipped[\s\S]{0,300}dispatchEvent\(new CustomEvent\(\s*['"]nbd:ai-classify-skipped['"]/.test(classifier),
    'expected classifier to dispatch nbd:ai-classify-skipped on cap-skip');

  // Sonnet path (analyzeRoofPhoto HTTP) — daily cap returns 429.
  // photo-ai.js must dispatch the same event so UI surfaces see
  // both paths consistently.
  assert('photo-ai dispatches nbd:ai-classify-skipped on 429',
    /res\.status\s*===\s*429[\s\S]{0,400}dispatchEvent\(new CustomEvent\(\s*['"]nbd:ai-classify-skipped['"]/.test(ai),
    'expected photo-ai.js to dispatch nbd:ai-classify-skipped when analyzeRoofPhoto returns 429');
  assert("photo-ai uses reason='daily-cap' for the Sonnet path",
    /reason:\s*['"]daily-cap['"]/.test(ai),
    "expected photo-ai.js skip event to carry reason: 'daily-cap'");
}

section('Photos §2.3: bulk-analyze surfaces a cap-aware finishing toast');
{
  const pe = read(path.join(ROOT, 'docs/pro/js/photo-engine.js'));

  // _bulkAnalyze must attach + detach a listener for the cap event so
  // the post-batch toast can swap to a friendlier "hit your cap" copy.
  assert('_bulkAnalyze attaches a nbd:ai-classify-skipped listener',
    /_bulkAnalyze[\s\S]{0,2000}addEventListener\(\s*['"]nbd:ai-classify-skipped['"]/.test(pe),
    'expected _bulkAnalyze to addEventListener on nbd:ai-classify-skipped');
  assert('_bulkAnalyze detaches its listener in finally',
    /_bulkAnalyze[\s\S]{0,3500}finally\s*\{[\s\S]{0,200}removeEventListener\(\s*['"]nbd:ai-classify-skipped['"]/.test(pe),
    'expected _bulkAnalyze finally{} block to removeEventListener');
  assert('_bulkAnalyze toast distinguishes daily / lead / user caps',
    /daily-cap[\s\S]{0,200}lead-cap[\s\S]{0,200}user-cap/.test(pe),
    'expected _bulkAnalyze finishing toast to branch on the three cap reasons');
}

section('Photos §2.3: review UI handles daily-cap reason explicitly');
{
  const review = read(path.join(ROOT, 'docs/pro/photo-review.html'));
  // Pre-existing listener was lead-cap vs else ("Monthly cap"). The
  // new Sonnet daily-cap path would have landed in the misleading
  // "Monthly" branch — daily ≠ monthly.
  assert('photo-review listener has a daily-cap branch',
    /reason\s*===\s*['"]daily-cap['"][\s\S]{0,200}Daily AI cap reached/.test(review),
    'expected photo-review.html listener to branch on daily-cap reason');
}

section('Photos §3.1: three-tier before/after pairing heuristic');
{
  const pr = read(path.join(ROOT, 'docs/pro/js/photo-report.js'));

  // _buildPairs replaces the inline IIFE. Exposing it on window keeps
  // it unit-testable (no DOM, no Firebase deps).
  assert('photo-report defines a module-scoped _buildPairs(allPhotos)',
    /function _buildPairs\(allPhotos\)/.test(pr));
  assert('_buildPairs is exposed on window for testing',
    /window\._buildPhotoReportPairs\s*=\s*_buildPairs/.test(pr));
  assert('_tryServerRenderPhotoReport now calls _buildPairs (no inline IIFE)',
    /const pairs\s*=\s*_buildPairs\(allPhotos\)/.test(pr));
  // The old inline byLoc map is gone — make sure we didn't leave both
  // implementations in the file.
  assert('inline IIFE pairing block was removed',
    !/const pairs\s*=\s*\(function\s*\(\)\s*\{[\s\S]{0,500}byLoc/.test(pr));

  // ── Heuristic structure ──
  // Normalization: lowercase + first comma-segment, so "North slope,
  // ridge" and "north slope" hit the same bucket.
  assert('normKey lowercases and takes first comma-segment',
    /toLowerCase\(\)\s*\.\s*split\(\s*['"],['"]\s*\)\s*\[\s*0\s*\]\s*\.\s*trim\(\)/.test(pr));

  // BEFORE picks earliest createdAt (worst pre-state), AFTER picks
  // latest (final completed state). Encoded as `pickEarliest` arg.
  assert('bestByKey takes a pickEarliest boolean',
    /function bestByKey\(photos,\s*keyFn,\s*pickEarliest/.test(pr));
  assert('beforePhotos call passes pickEarliest=true',
    /bestByKey\(beforePhotos[\s\S]{0,200}true/.test(pr));
  assert('afterPhotos call passes pickEarliest=false',
    /bestByKey\(afterPhotos[\s\S]{0,200}false/.test(pr));

  // Three tiers labeled in source so a future reader can find them.
  assert('Tier 1 (location) present',
    /Tier 1:\s*location/i.test(pr));
  assert('Tier 2 (damage type) present',
    /Tier 2:\s*damage type/i.test(pr));
  assert('Tier 3 (chronological / Project overview) present',
    /Tier 3[\s\S]{0,300}Project overview/.test(pr));

  // Pairs cap at 8 (template hard limit) and dedupe via a `used` set
  // so photos consumed in tier 1 don't get re-paired in tier 2.
  assert('pairs cap at 8',
    /return out\.slice\(0,\s*8\)/.test(pr));
  assert('used set excludes already-paired photos across tiers',
    /const used\s*=\s*new Set\(\)/.test(pr)
    && /used\.has\([a-zA-Z]+\)/.test(pr));
  assert('Tier 3 only fires when fewer than 2 pairs found',
    /out\.length\s*<\s*2/.test(pr));
}

};
