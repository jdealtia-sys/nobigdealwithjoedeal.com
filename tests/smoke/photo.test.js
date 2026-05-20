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
  // Adjuster tile is denser (1/1 aspect, 4-up grid → 200px hint).
  // Homeowner tile is roomier (4/3 aspect, 3-up grid → 260px hint).
  // Either size is fine; the assertion just locks that _imgAttrs is
  // being called from both renderers (regression guard from §1.1).
  assert('adjuster tile uses _imgAttrs with sized hint',
    /<img ' \+ _imgAttrs\(p,\s*'\d+px'\)\s*\+\s*' alt="Photo/.test(pr));
  assert('homeowner tile uses _imgAttrs with sized hint',
    /<img ' \+ _imgAttrs\(p,\s*'\d+px'\)\s*\+\s*' alt=""/.test(pr));
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

section('photo-review.html has zero inline scripts (CSP-safe)');
{
  const review = read(path.join(ROOT, 'docs/pro/photo-review.html'));
  // The strict ** CSP at firebase.json:44 applies to /pro/photo-review
  // (no route-specific override). An inline <script type="module">
  // gets silently blocked → Firebase init never runs → page hangs on
  // "Loading..." forever. The page's JS now lives in
  // docs/pro/js/pages/photo-review.js loaded via <script type="module"
  // src="...">. If anyone reintroduces an inline <script> the page
  // breaks again, so guard it.
  const inlineScripts = (review.match(/<script(?:\s+type="module")?\s*>/g) || []).length;
  assert('zero inline <script> blocks in photo-review.html',
    inlineScripts === 0,
    'expected 0 inline script tags, got ' + inlineScripts);
  assert('photo-review.html loads its module via external src',
    /<script\s+type="module"\s+src="js\/pages\/photo-review\.js/.test(review));
  // The extracted file exists and is non-empty.
  const reviewJs = read(path.join(ROOT, 'docs/pro/js/pages/photo-review.js'));
  assert('docs/pro/js/pages/photo-review.js exists with imports',
    /import\s*\{[^}]*\}\s*from\s+["']https:\/\/www\.gstatic\.com\/firebasejs/.test(reviewJs));
}

section('Photos §2.3: review UI handles daily-cap reason explicitly');
{
  // Code moved from inline <script> in photo-review.html to
  // docs/pro/js/pages/photo-review.js after the inline-module
  // CSP-block bug. Pattern unchanged.
  const reviewJs = read(path.join(ROOT, 'docs/pro/js/pages/photo-review.js'));
  assert('photo-review listener has a daily-cap branch',
    /reason\s*===\s*['"]daily-cap['"][\s\S]{0,200}Daily AI cap reached/.test(reviewJs),
    'expected photo-review.js listener to branch on daily-cap reason');
}

section('Photos §3.3 phase 1: photo-engine TOC + section markers');
{
  const pe = read(path.join(ROOT, 'docs/pro/js/photo-engine.js'));

  // Top-of-file TOC: maintainers should find the section map and
  // public API listed at the top without scrolling.
  assert('header TOC lists section ranges',
    /Sections \(rough line ranges/.test(pe),
    'expected "Sections (rough line ranges" header in the file doc-block');
  assert('header documents Public API (window.PhotoEngine surface)',
    /Public API \(window\.PhotoEngine\)/.test(pe));
  assert('header documents State shape',
    /State shape[\s\S]{0,400}currentPreset[\s\S]{0,200}cameraStream/.test(pe));
  assert('header documents load-order requirement (Firebase init)',
    /Load order requirement/.test(pe) && /Firebase SDK/.test(pe));
  assert('header lists each major related photo module',
    /photo-ai-classifier\.js/.test(pe)
    && /photo-ai\.js/.test(pe)
    && /photo-report\.js/.test(pe)
    && /photo-editor\.js/.test(pe)
    && /photo-smart-ingest\.js/.test(pe));

  // ── Section markers: every concern called out in the TOC should
  // also be findable via a `// ════` divider in the body.
  // Existing markers covered: STYLES, UTILITY FUNCTIONS, CAMERA CAPTURE,
  // PREVIEW & TAGGING, FIREBASE UPLOAD, GALLERY & BROWSER, LIGHTBOX,
  // FIRESTORE QUERIES, STAGING & REPORT, PUBLIC API.
  // §3.3 phase 1 adds dividers for TAG SYSTEM, QUALITY PRESETS, STATE.
  const expectedSections = [
    'TAG SYSTEM',
    'QUALITY PRESETS',
    'STATE',
    'STYLES',
    'UTILITY FUNCTIONS',
    'CAMERA CAPTURE',
    'PREVIEW & TAGGING',
    'FIREBASE UPLOAD',
    'GALLERY & BROWSER',
    'LIGHTBOX',
    'FIRESTORE QUERIES',
    'STAGING & REPORT',
    'PUBLIC API',
  ];
  for (const label of expectedSections) {
    // Each label should appear immediately after a `// ════` line.
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('//\\s*={5,}[\\s\\S]{0,5}\\s*//\\s*' + escaped + '\\b');
    assert("section '" + label + "' has a `// ════` divider",
      re.test(pe),
      'expected ' + label + ' to be preceded by a // ============ divider');
  }

  // Sub-marker for the AI auto-tag helper inside FIREBASE UPLOAD —
  // the helper that bridges per-upload writes to the Haiku classifier.
  // Easy to lose in a 1700-line file; the MARK comment makes it
  // jump-to-able.
  assert('AI auto-tag has a MARK: sub-marker',
    /MARK:\s*AI auto-tag/.test(pe),
    'expected a "MARK: AI auto-tag" sub-section header');
}
section('Photos §2.1: two AI paths documented + analyzeRoofPhoto baseline coverage');
{
  const handlerPhoto = read(path.join(FUNCTIONS, 'handlers/photo.js'));
  const vision       = read(path.join(FUNCTIONS, 'photo-vision.js'));
  const ai           = read(path.join(ROOT, 'docs/pro/js/photo-ai.js'));
  const classifier   = read(path.join(ROOT, 'docs/pro/js/photo-ai-classifier.js'));
  const idx          = read(FUNCTIONS + '/index.js');

  // ── Design-intent docstrings: every entry point cross-refs the other ──
  // Future maintainers (or future-me) hitting any one of these files
  // should immediately see why both paths exist and where the sister
  // function/wrapper lives.
  assert('handlers/photo.js documents the DEEP-analysis path',
    /DEEP-analysis path/.test(handlerPhoto) || /on-demand, deep, rich output/.test(handlerPhoto),
    'expected analyzeRoofPhoto header to call out its on-demand/deep purpose');
  assert('handlers/photo.js cross-references analyzePhotoVision',
    /analyzePhotoVision/.test(handlerPhoto) && /photo-vision\.js/.test(handlerPhoto));

  assert('photo-vision.js documents the AUTO-TAG path',
    /AUTO-TAG path/.test(vision) || /per-upload, fast, light/.test(vision));
  assert('photo-vision.js cross-references analyzeRoofPhoto',
    /analyzeRoofPhoto/.test(vision) && /handlers\/photo\.js/.test(vision));

  assert('photo-ai.js client wrapper cross-references PhotoAIClassifier',
    /photo-ai-classifier\.js/.test(ai) && /PhotoAIClassifier/.test(ai));
  assert('photo-ai-classifier.js cross-references PhotoAI',
    /photo-ai\.js/.test(classifier) && /\bPhotoAI\b/.test(classifier));

  // ── Baseline coverage for analyzeRoofPhoto (audit gap §2.1) ──
  // analyzePhotoVision had extensive coverage from earlier sections;
  // analyzeRoofPhoto had none. Bring the older path up to par.
  assert('analyzeRoofPhoto is exported from handlers/photo.js',
    /exports\.analyzeRoofPhoto\s*=\s*onRequest/.test(handlerPhoto));
  assert('functions/index.js re-exports analyzeRoofPhoto',
    /analyzeRoofPhoto/.test(idx));
  assert('analyzeRoofPhoto enforces App Check',
    /exports\.analyzeRoofPhoto[\s\S]{0,1500}enforceAppCheck:\s*true/.test(handlerPhoto));
  assert('analyzeRoofPhoto declares a 100/uid/day cap constant',
    /const PHOTO_AI_DAILY_CAP\s*=\s*100/.test(handlerPhoto));
  assert('analyzeRoofPhoto uses the daily cap in enforceRateLimit',
    /enforceRateLimit\(\s*['"]analyzeRoofPhoto:uid['"][\s\S]{0,80}PHOTO_AI_DAILY_CAP/.test(handlerPhoto));
  assert('analyzeRoofPhoto requires owner uid match (no cross-tenant)',
    /photo\.userId\s*!==\s*decoded\.uid[\s\S]{0,300}status\(403\)/.test(handlerPhoto));
  // Source contains a regex literal `/^https:\/\/firebasestorage\.googleapis\.com\//`,
  // so the file text has literal backslashes — match the raw text shape.
  assert('analyzeRoofPhoto SSRF-guards the photo URL (Firebase Storage only)',
    /firebasestorage\\\.googleapis\\\.com[\s\S]{0,200}storage\\\.googleapis\\\.com/.test(handlerPhoto));
  assert('analyzeRoofPhoto rejects images >4MB',
    /4\s*\*\s*1024\s*\*\s*1024[\s\S]{0,200}status\(413\)/.test(handlerPhoto));
  // Server-side enum clamps so a drifting model can't poison the doc.
  assert('analyzeRoofPhoto clamps severity to the allowed enum',
    /validSeverity\s*=\s*\[\s*['"]none['"],\s*['"]minor['"],\s*['"]moderate['"],\s*['"]severe['"]\s*\]/.test(handlerPhoto));
  assert('analyzeRoofPhoto clamps confidence to low/medium/high',
    /validConfidence\s*=\s*\[\s*['"]low['"],\s*['"]medium['"],\s*['"]high['"]\s*\]/.test(handlerPhoto));
  assert('analyzeRoofPhoto stamps aiAnalysis on the photo doc',
    /photoRef\.update\(\s*\{\s*aiAnalysis:\s*result\s*\}\s*\)/.test(handlerPhoto));
}
section('Photos §2.2: image-pipeline no_doc_matched bumps a metrics counter');
{
  const pipeline = read(path.join(ROOT, 'functions/image-pipeline.js'));

  // The original branch only logged; we need a Firestore counter so we
  // know whether to invest in a real backfill function or leave the
  // current "orphan blobs in Storage" state alone.
  assert('no_doc_matched branch still emits the structured log',
    /image_pipeline_no_doc_matched/.test(pipeline));

  // Counter doc must be `metrics/imagePipeline` with merge:true (so
  // multiple invocations don't clobber each other) and use
  // FieldValue.increment for the count (atomic across concurrent
  // triggers).
  assert('no_doc_matched bumps metrics/imagePipeline counter',
    /db\.doc\(\s*['"]metrics\/imagePipeline['"]\s*\)\.set\(/.test(pipeline),
    'expected db.doc("metrics/imagePipeline").set(...) write');
  assert('counter uses FieldValue.increment(1) on noDocMatched',
    /noDocMatched:\s*admin\.firestore\.FieldValue\.increment\(1\)/.test(pipeline));
  assert('counter write uses merge:true (no clobber)',
    /metrics\/imagePipeline[\s\S]{0,400}\{\s*merge:\s*true\s*\}/.test(pipeline));
  // Diagnostic context for triage when the counter does climb.
  assert('counter captures lastNoMatchPath + lastNoMatchUid',
    /lastNoMatchPath:\s*objectName/.test(pipeline)
    && /lastNoMatchUid:\s*uid/.test(pipeline));
  // Metric write must never break the trigger — it's swallowed.
  assert('metrics write failure is swallowed (best-effort)',
    /metrics\/imagePipeline[\s\S]{0,500}catch\s*\(\s*_\s*\)\s*\{\s*\/\*\s*metrics write is best-effort/.test(pipeline),
    'expected the metrics write to be wrapped in a swallow-catch so it never breaks the trigger');
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
  assert('Tier 3 only fires when tiers 1+2 produced nothing (out.length === 0)',
    /out\.length\s*===\s*0/.test(pr));
}

section('customer.html: blank-preview escape hatch on prereq warning');
{
  const customer = read(path.join(ROOT, 'docs/pro/customer.html'));

  // The Can't-Generate modal now has a second CTA — "Preview blank
  // template" — so a rep can render any template even when prereqs
  // aren't met. Useful for showing customers what a doc looks like
  // before all data is gathered, or QA-ing the template itself.
  assert('window._previewBlankDoc exposed',
    /window\._previewBlankDoc\s*=\s*function/.test(customer));
  assert('_blankifyDocData fills placeholder values for missing fields',
    /function _blankifyDocData\([^)]*\)[\s\S]{0,1500}placeholders\s*=\s*\{[\s\S]{0,1500}\[Customer Name\]/.test(customer));
  assert('blank-preview data flags _isBlankPreview = true',
    /out\._isBlankPreview\s*=\s*true/.test(customer));
  assert('prereq modal renders "Preview blank template" button',
    /class="nbd-preq-preview"[\s\S]{0,300}Preview blank template/.test(customer));
  assert('preview button wires to _previewBlankDoc(type)',
    /nbd-preq-preview['"]\s*\)\.addEventListener\(\s*['"]click['"][\s\S]{0,200}window\._previewBlankDoc\(\s*type\s*\)/.test(customer));
  assert('_previewBlankDoc bypasses prereq check (no checkPrerequisites call inside)',
    !/_previewBlankDoc[\s\S]{0,500}checkPrerequisites/.test(customer));
  assert('_previewBlankDoc calls NBDDocGen.generate directly',
    /window\._previewBlankDoc[\s\S]{0,600}window\.NBDDocGen\.generate\(\s*type\s*,\s*blank\s*\)/.test(customer));
}

section('doc-template cards: per-card ⓘ blank-preview button');
{
  const customer = read(path.join(ROOT, 'docs/pro/customer.html'));
  const docGen = read(path.join(ROOT, 'docs/pro/js/document-generator.js'));

  // Every doc-template-card (currently 15) has a nested ⓘ button
  // routing to _previewBlankDoc. The CSS guarantees position:relative
  // on the card and absolute on the button so the icon stays in the
  // top-right without disturbing existing card layout.
  const cardCount = (customer.match(/class="doc-template-card"/g) || []).length;
  const btnCount  = (customer.match(/class="dt-preview-btn"/g) || []).length;
  assert('one dt-preview-btn per doc-template-card (currently 15)',
    cardCount > 0 && btnCount === cardCount);
  assert('dt-preview-btn dispatches data-action="_previewBlankDoc"',
    /class="dt-preview-btn"[^>]*data-action="_previewBlankDoc"/.test(customer));
  assert('dt-preview-btn carries its own data-doc-type for the delegate',
    /class="dt-preview-btn"[^>]*data-doc-type="[a-z_]+"/i.test(customer));
  assert('doc-template-card is position:relative so the icon anchors',
    /\.doc-template-card\s*\{[\s\S]{0,200}position:\s*relative/.test(customer));
  assert('.dt-preview-btn is position:absolute (top-right corner)',
    /\.dt-preview-btn\s*\{[\s\S]{0,400}position:\s*absolute/.test(customer));

  // NBDDocGen.generate stamps a "Blank Preview" watermark whenever
  // data._isBlankPreview is true. One source of truth so every
  // template picks it up (15 doc types share this code path).
  assert('NBDDocGen.generate reads data._isBlankPreview',
    /data\._isBlankPreview/.test(docGen));
  assert('watermark element carries data-nbd-watermark="blank-preview"',
    /data-nbd-watermark="blank-preview"/.test(docGen));
  assert('watermark text reads "Blank Preview"',
    /Blank Preview/.test(docGen));
  assert('watermark injected before </body> via regex replace',
    /html\.replace\(\s*\/<\\\/body>\/i\s*,\s*wm\s*\+\s*['"]<\/body>['"]\s*\)/.test(docGen));
  assert('html declared with let (mutation required for watermark injection)',
    /let\s+html\s*=\s*this\.getHTML\(type,\s*data\)/.test(docGen));
}

section('NBDDocGen branding: logo resolves in viewer context, orange/navy theme');
{
  const docGen     = read(path.join(ROOT, 'docs/pro/js/document-generator.js'));
  const templates  = read(path.join(ROOT, 'docs/pro/js/document-generator-templates.js'));

  // The logo path was the #1 cause of the "broken-image alt text" look
  // in generated docs — root-relative URLs don't resolve inside the
  // doc viewer's about:blank/srcdoc context. Both generator files now
  // compute the asset origin at render time via window.location.origin
  // and fall back to the production host for headless renders.
  assert('document-generator: _assetOrigin helper present',
    /_assetOrigin\s*\(\)\s*\{[\s\S]{0,400}window\.location\.origin/.test(docGen));
  assert('document-generator: fallback host is production',
    /['"]https:\/\/nobigdealwithjoedeal\.com['"]/.test(docGen));
  // 2026-05-18: switched away from <object> because the doc viewer's
  // iframe srcdoc CSP has `object-src 'none'` — the data URI never
  // loaded and every render fell back to a placeholder. Logo is now
  // inline <img> backed by NBD_LOGO_DATA_URI (the actual brand image
  // bytes from docs/assets/images/nbd-logo.png). img-src allows data:,
  // so this path works inside the iframe srcdoc.
  assert('document-generator: renderNBDLogo returns inline <img> (no <object>)',
    /renderNBDLogo\s*\(\s*\)\s*\{[\s\S]{0,1500}return\s*`<img class="nbd-logo-img"/.test(docGen));
  assert('document-generator: renderNBDLogo sources NBD_LOGO_DATA_URI',
    /renderNBDLogo[\s\S]{0,1500}window\.NBD_LOGO_DATA_URI/.test(docGen));
  assert('document-generator: .nbd-logo-img CSS sized for header strip',
    /\.nbd-logo-img\s*\{[\s\S]{0,400}width:\s*\d+px/.test(docGen));
  assert('document-generator: legacy onerror handler removed (CSP-blocked)',
    !/onerror=["'][^"']*nbd-logo/.test(docGen));

  // templates.js (20 of 24 templates) gets the same fix.
  assert('templates.js: ORIGIN constant computed at IIFE load',
    /const ORIGIN\s*=\s*\(function\s*\(\)\s*\{[\s\S]{0,400}window\.location\.origin/.test(templates));
  assert('templates.js: LOGO_URL prefers NBD_LOGO_DATA_URI, falls back to ORIGIN + /assets/images/nbd-logo.png',
    /const LOGO_URL\s*=[\s\S]{0,200}window\.NBD_LOGO_DATA_URI[\s\S]{0,200}ORIGIN\s*\+\s*['"]\/assets\/images\/nbd-logo\.png['"]/.test(templates));
  // 2026-05-18: letterhead and intro-hero now render <img> tags backed
  // by NBD_LOGO_DATA_URI (the real brand image), replacing the earlier
  // hand-drawn SVG recreations. img-src + data: passes CSP cleanly.
  assert('templates.js: letterhead uses <img class="letterhead-logo-img">',
    /<img class="letterhead-logo-img"/.test(templates)
      && !/<object[^>]*class="letterhead-logo-obj"/.test(templates));
  assert('templates.js: letterhead-logo-img CSS sized as banner',
    /\.letterhead-logo-img\s*\{[\s\S]{0,300}width:\s*\d+px/.test(templates));
  assert('templates.js: intro-hero-logo uses <img>',
    /<img class="intro-hero-logo"/.test(templates)
      && !/<svg class="intro-hero-logo"/.test(templates));

  // Branded header — strong navy gradient + orange accent stripe.
  assert('document-generator: header uses navy gradient',
    /\.document-header\s*\{[\s\S]{0,400}linear-gradient\([^)]*\$\{this\.COMPANY\.colors\.primary\}/.test(docGen));
  assert('document-generator: header has orange accent stripe (border-bottom)',
    /\.document-header\s*\{[\s\S]{0,500}border-bottom:\s*6px solid\s*\$\{this\.COMPANY\.colors\.accent\}/.test(docGen));
  assert('document-generator: section-title carries orange underline accent',
    /\.section-title:after\s*\{[\s\S]{0,300}background:\s*\$\{this\.COMPANY\.colors\.accent\}/.test(docGen));
  assert('document-generator: document-title has orange underline accent',
    /\.document-title:after\s*\{[\s\S]{0,300}background:\s*\$\{this\.COMPANY\.colors\.accent\}/.test(docGen));
  assert('document-generator: branded footer (navy bg + orange border-top)',
    /\.document-footer\s*\{[\s\S]{0,500}border-top:\s*4px solid\s*\$\{this\.COMPANY\.colors\.accent\}/.test(docGen));

  // templates.js: matching branded letterhead/footer.
  assert('templates.js: letterhead has navy gradient bg',
    /\.letterhead\s*\{[\s\S]{0,200}linear-gradient\([^)]*\$\{P\}/.test(templates));
  assert('templates.js: letterhead has orange accent stripe',
    /\.letterhead\s*\{[\s\S]{0,300}border-bottom:6px solid \$\{A\}/.test(templates));
  assert('templates.js: footer carries orange border + navy gradient',
    /\.footer\s*\{[\s\S]{0,300}border-top:4px solid \$\{A\}/.test(templates));
  assert('templates.js: section-title carries orange underline accent',
    /\.section-title:after[\s\S]{0,200}background:\$\{A\}/.test(templates));

  // firebase.json must serve /assets/images/** with CORP cross-origin
  // so the Universal Doc Viewer's null-origin iframe srcdoc can embed
  // the brand logo. Without this override the global same-origin CORP
  // blocks the load and every doc shows a broken-image placeholder.
  const firebaseJson = read(path.join(ROOT, 'firebase.json'));
  const fbCfg = JSON.parse(firebaseJson);
  const imgRule = (fbCfg.hosting.headers || []).find(h => h.source === '/assets/images/**');
  assert('firebase.json: /assets/images/** header override exists',
    !!imgRule);
  assert('firebase.json: image assets serve CORP cross-origin',
    !!(imgRule && (imgRule.headers || []).find(h => h.key === 'Cross-Origin-Resource-Policy' && h.value === 'cross-origin')));
}

section('NBDUrl helper: canonical customer URL builder');
{
  const helper = read(path.join(ROOT, 'docs/pro/js/nbd-url.js'));
  const customer = read(path.join(ROOT, 'docs/pro/customer.html'));
  const dashboard = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const dashActions = read(path.join(ROOT, 'docs/pro/js/dashboard-actions.js'));
  const photoReview = read(path.join(ROOT, 'docs/pro/photo-review.html'));

  // ── Helper file exists and exposes the right surface ──
  assert('nbd-url.js defines window.NBDUrl',
    /window\.NBDUrl\s*=\s*\{/.test(helper));
  assert('NBDUrl.customer(id) builds /pro/customer.html?id=<encoded>',
    /function customer\(id\)[\s\S]{0,300}\/pro\/customer\.html\?id='\s*\+\s*encodeURIComponent\(id\)/.test(helper));
  assert('NBDUrl.photoReview(id) builds /pro/photo-review.html?id=<encoded>',
    /function photoReview\(id\)[\s\S]{0,300}\/pro\/photo-review\.html\?id='\s*\+\s*encodeURIComponent\(id\)/.test(helper));
  assert('NBDUrl validates id (rejects empty/non-string)',
    /function _valid\(id\)[\s\S]{0,200}typeof id\s*===\s*['"]string['"][\s\S]{0,80}id\.length\s*>\s*0/.test(helper));

  // ── Both consuming pages load the helper ──
  assert('customer.html loads nbd-url.js',
    /<script\s+defer\s+src="js\/nbd-url\.js/.test(customer));
  assert('dashboard.html loads nbd-url.js',
    /<script\s+defer\s+src="js\/nbd-url\.js/.test(dashboard));
  // dashboard.html must load nbd-url.js BEFORE dashboard-actions.js
  // (actions.js calls NBDUrl.customer). Both are defer, defer order
  // is document order, so nbd-url.js needs to come first in source.
  assert('dashboard.html loads nbd-url.js BEFORE dashboard-actions.js',
    /nbd-url\.js[\s\S]{0,500}dashboard-actions\.js/.test(dashboard),
    'expected the nbd-url.js script tag to appear before dashboard-actions.js');

  // ── Zero raw bad-pattern literals in source ──
  // customer.html?lead= was always broken (customer.html reads ?id=).
  // It must not appear anywhere except in comments/docstrings.
  const badCustomerLead = (customer.match(/customer\.html\?lead=/g) || [])
    .concat(dashActions.match(/customer\.html\?lead=/g) || []);
  assert('zero raw "customer.html?lead=" literals in source',
    badCustomerLead.length === 0,
    'expected 0 occurrences, got ' + badCustomerLead.length);

  // photo-review.html?lead= still works as a URL (page accepts it),
  // but new code shouldn't emit it. Allow the page itself to keep
  // its fallback parsing logic; just check no caller emits it.
  const inlinePhotoReviewLead = (customer.match(/photo-review\.html\?lead=/g) || [])
    .concat(dashActions.match(/photo-review\.html\?lead=/g) || []);
  assert('zero raw "photo-review.html?lead=" literals in caller code',
    inlinePhotoReviewLead.length === 0,
    'expected callers to use NBDUrl.photoReview() or `?id=`, got ' + inlinePhotoReviewLead.length);

  // ── photo-review keeps accepting BOTH ?lead= and ?id= ──
  // Old Slack links / bookmarks must keep working. Page-level parsing
  // stays back-compat even after we standardize callers on ?id=.
  // Code lives in docs/pro/js/pages/photo-review.js after extraction.
  const photoReviewJs = read(path.join(ROOT, 'docs/pro/js/pages/photo-review.js'));
  assert('photo-review.js still accepts ?lead= (back-compat)',
    /params\.get\(\s*['"]lead['"]\s*\)\s*\|\|\s*params\.get\(\s*['"]id['"]\s*\)/.test(photoReviewJs)
    || /params\.get\(\s*['"]id['"]\s*\)\s*\|\|\s*params\.get\(\s*['"]lead['"]\s*\)/.test(photoReviewJs),
    'expected photo-review.js to read both lead and id (with ||)');

  // ── Callers use the helper (with a string fallback for safety) ──
  assert('customer.html click handler uses NBDUrl.photoReview',
    /window\.NBDUrl\s*&&\s*window\.NBDUrl\.photoReview\(id\)/.test(customer));
  assert('dashboard-actions.js uses NBDUrl.customer',
    /window\.NBDUrl\s*&&\s*window\.NBDUrl\.customer\(id\)/.test(dashActions));
}

section('customer.html: prReviewBtn reads window._customerId at click time (no defer-race)');
{
  const customer = read(path.join(ROOT, 'docs/pro/customer.html'));

  // Old render-time wire() raced against the auth → loadCustomerData
  // chain. After the §perf defer pass, the customer ID often wasn't
  // set when wire() ran, leaving the button at the placeholder ?lead=
  // and dumping the user on photo-review's empty-state page.
  //
  // The fix attaches a click handler that reads window._customerId
  // at click time and navigates manually. The href stays a no-op
  // placeholder; the listener does the navigation.
  assert('prReviewBtn has a click listener that reads window._customerId',
    /document\.getElementById\(\s*['"]prReviewBtn['"]\s*\)[\s\S]{0,500}addEventListener\(\s*['"]click['"]/.test(customer)
    && /prReviewBtn[\s\S]{0,1000}window\._customerId/.test(customer),
    'expected an addEventListener("click", ...) on prReviewBtn that reads window._customerId');
  assert('click handler prevents default when customer ID missing',
    /prReviewBtn[\s\S]{0,1500}e\.preventDefault\(\)[\s\S]{0,300}if\s*\(\s*!id\s*\)/.test(customer));
  assert('click handler navigates via window.location.href when ID present',
    /prReviewBtn[\s\S]{0,2500}window\.location\.href\s*=\s*\(?\s*(?:window\.NBDUrl|['"]photo-review\.html\?id=)/.test(customer),
    'expected click handler to navigate via NBDUrl.photoReview(id) (or literal photo-review.html?id= fallback)');
  // The old render-time wire() pattern with setTimeout fallbacks
  // shouldn't return. The hook on prReviewBtn should be the click
  // handler, not href mutation.
  assert('no setTimeout(wire,...) pattern wiring prReviewBtn href',
    !/setTimeout\(\s*wire\s*,/.test(customer),
    'expected the render-time setTimeout wire pattern to be gone');
}

section('customer.html: perf — all <script src> defers, preconnect hints present, images lazy/async');
{
  const customer = read(path.join(ROOT, 'docs/pro/customer.html'));

  // Every external <script src="..."> must be deferred (or async, or
  // type="module" which is deferred-by-default). Anything else blocks
  // HTML parsing until the script downloads + executes — that's the
  // 53-script TTI tax we just paid down.
  const scriptLines = customer.split('\n').filter(l => /<script[^>]*\ssrc=/.test(l));
  const blocking = scriptLines.filter(l =>
    !/ defer[ >]/.test(l) && !/type="module"/.test(l) && !/ async[ >]/.test(l)
  );
  assert('zero blocking <script src> tags remain in customer.html',
    blocking.length === 0,
    'expected 0 blocking script tags, got ' + blocking.length + ': ' + blocking.slice(0,3).join(' | '));

  // Preconnect hints in <head> warm TCP+TLS for the origins this page
  // hits hardest. Without them the browser serializes connect setup
  // with HTML parse — adds 100-300ms per origin on first paint.
  const expectedPreconnects = [
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'www.gstatic.com',
    'firebasestorage.googleapis.com',
    'cdnjs.cloudflare.com',
  ];
  for (const host of expectedPreconnects) {
    const escaped = host.replace(/\./g, '\\.');
    const re = new RegExp('<link\\s+rel="preconnect"\\s+href="https://' + escaped + '"');
    assert("preconnect to " + host,
      re.test(customer),
      'expected <link rel="preconnect" href="https://' + host + '">');
  }

  // Every static <img> must have either loading="lazy" OR
  // fetchpriority="high" (the above-fold logo). Plain unannotated
  // <img> tags fetch eagerly + block on decode.
  const imgs = (customer.match(/<img\s[^>]*>/g) || []).filter(t => /\ssrc="/.test(t));
  const annotated = imgs.filter(t =>
    /loading="lazy"/.test(t) || /fetchpriority="high"/.test(t)
  );
  assert('every static <img> has loading=lazy or fetchpriority=high',
    annotated.length === imgs.length,
    'expected ' + imgs.length + ' annotated, got ' + annotated.length);
  // Plus decoding="async" so the decode doesn't block paint.
  const asyncDecoded = imgs.filter(t => /decoding="async"/.test(t));
  assert('every static <img> has decoding="async"',
    asyncDecoded.length === imgs.length,
    'expected ' + imgs.length + ' with decoding=async, got ' + asyncDecoded.length);
}

section('nbd-doc-viewer: PDF download preserves <head> <style>/<link> in body clone');
{
  const dv = read(path.join(ROOT, 'docs/pro/js/nbd-doc-viewer.js'));
  // html2pdf operates on the body subtree only. Generators that put CSS
  // in <head> (photo-report, contracts, estimates) used to render as
  // unstyled text dumps in Download-PDF. The fix prepends head's
  // <style>/<link rel="stylesheet"> nodes into body before processing.
  assert('docviewer extracts head style nodes',
    /parsed\.head[\s\S]{0,200}querySelectorAll\(\s*['"]style,\s*link\[rel="stylesheet"\]['"]\s*\)/.test(dv),
    'expected parsed.head.querySelectorAll(\'style, link[rel="stylesheet"]\') in the PDF-save path');
  assert('docviewer prepends head style nodes into body before html2pdf',
    /body\.insertBefore\(\s*headStyleNodes\[[^\]]+\]\.cloneNode\(true\),\s*body\.firstChild\s*\)/.test(dv),
    'expected body.insertBefore(headStyleNodes[i].cloneNode(true), body.firstChild) so the cloned subtree carries its own styles');
}

section('photo-report: <style> lives in <body> (survives docviewer body-only clone)');
{
  const pr = read(path.join(ROOT, 'docs/pro/js/photo-report.js'));
  // Belt-and-suspenders with the docviewer fix: even if a future
  // docviewer refactor regresses, photo-report's styles still travel
  // with its body. The </head><body...> tag must appear BEFORE <style>.
  assert('photo-report.js puts the <style> block inside <body>',
    /<\/head>[\s\S]{0,300}<body[^>]*>[\s\S]{0,200}<style>/.test(pr),
    'expected </head><body...><style> ordering in the emitted HTML — style must live in body');
}

section('customer.html: every inline event handler migrated to data-action delegation (CSP-safe)');
{
  // The /pro/customer CSP at firebase.json:80 has `script-src-attr 'none'`,
  // which blocks every inline event handler (onclick, onmouseover, onchange,
  // etc.). The first migration (#430) covered just the doc-template card
  // grid; the full sweep migrates ALL inline handlers (88 onclicks +
  // 1 onmouseover + 1 onmouseout + 9 onchanges = 99 total) to data-action /
  // data-change-action delegation via a single generic dispatcher.
  const customer = read(path.join(ROOT, 'docs/pro/customer.html'));

  // ── Zero inline event handlers remain on real markup ──
  // (Comment lines that mention "onclick" in plain text are excluded
  // by requiring the attribute to be inside an open tag.)
  const realOnclicks = (customer.match(/<[^>]*\sonclick="/g) || []).length;
  assert('zero inline onclick= attributes remain on real elements',
    realOnclicks === 0,
    'expected 0 inline onclick attributes, got ' + realOnclicks);

  const realOnchanges = (customer.match(/<[^>]*\sonchange="/g) || []).length;
  assert('zero inline onchange= attributes remain',
    realOnchanges === 0,
    'expected 0 inline onchange attributes, got ' + realOnchanges);

  const realOnmouseover = (customer.match(/<[^>]*\sonmouseover="/g) || []).length;
  const realOnmouseout  = (customer.match(/<[^>]*\sonmouseout="/g)  || []).length;
  assert('zero inline onmouseover/onmouseout remain',
    realOnmouseover === 0 && realOnmouseout === 0,
    'expected 0 inline hover handlers, got ' + realOnmouseover + ' / ' + realOnmouseout);

  // ── data-action coverage proves the migration landed ──
  // 15 doc-template cards + dozens of buttons/links = many data-actions.
  // Loose check: must have at least 60 data-action attributes.
  const dataActionCount = (customer.match(/\sdata-action="/g) || []).length;
  assert('customer.html has ≥60 data-action attributes (migration landed)',
    dataActionCount >= 60,
    'expected ≥60 data-action attrs, got ' + dataActionCount);

  // 9 onchanges migrated → 9 data-change-action attributes.
  const dataChangeActionCount = (customer.match(/\sdata-change-action="/g) || []).length;
  assert('customer.html has ≥9 data-change-action attributes',
    dataChangeActionCount >= 9,
    'expected ≥9 data-change-action attrs, got ' + dataChangeActionCount);

  // ── Dispatch helper + click + change delegates all wired ──
  assert('shared _nbdCustomerActionDispatch helper exists',
    /function _nbdCustomerActionDispatch\(action,\s*el\)/.test(customer));
  assert('dispatch walks dotted action names (Namespace.method support)',
    /action\.split\(['"]\.['"]\)\.reduce/.test(customer));
  assert('click delegate registered on document',
    /addEventListener\(\s*['"]click['"][\s\S]{0,300}closest\(\s*['"]\[data-action\]['"]/.test(customer));
  assert('change delegate registered on document',
    /addEventListener\(\s*['"]change['"][\s\S]{0,300}closest\(\s*['"]\[data-change-action\]['"]/.test(customer));
  assert('dispatch supports data-pass-customer-id flag',
    /el\.dataset\.passCustomerId\s*===\s*['"]true['"][\s\S]{0,80}window\._customerId/.test(customer));
  assert('dispatch supports data-pass-el flag',
    /el\.dataset\.passEl\s*===\s*['"]true['"][\s\S]{0,80}args\.push\(el\)/.test(customer));
  assert('dispatch console.errors unknown actions (visible failure mode)',
    /console\.error\(['"]\[customer-action\] unknown action/.test(customer));

  // ── Wrapper functions for multi-statement / shape-adapting handlers ──
  // These replace inline JS like `funcA();funcB()` or `func(this.value)`.
  const expectedWrappers = [
    '_closeGallerySharePanel',
    '_closePhotoActionPopup',
    '_triggerFileInput',
    '_openInDashboardEstimate',
    '_openPhotoInEditorAndClose',
    '_previewPhotoFromPopup',
    '_sendReferralCodeAndSms',
    '_applyBulkPhotoUpdateAndReset',
    '_handleFileSelectFromEl',
  ];
  for (const fn of expectedWrappers) {
    assert("wrapper function '" + fn + "' defined and exposed on window",
      new RegExp('function ' + fn + '\\b').test(customer)
      && new RegExp('window\\.' + fn + '\\s*=').test(customer),
      'expected ' + fn + ' to be defined and assigned to window');
  }

  // ── CSS replaces JS-driven hover effects ──
  assert('CSS .doc-template-card:hover rule present',
    /\.doc-template-card:hover\s*\{[\s\S]{0,200}border-color:\s*var\(--orange\)/.test(customer));
  assert('CSS upload-zone hover rule present',
    /\[data-action="openUploadModal"\]:hover\s*\{[\s\S]{0,100}border-color:\s*var\(--orange\)/.test(customer));

  // ── Doc-template card grid still has its 15 wirings ──
  const cardCount = (customer.match(/class="doc-template-card"[^>]*data-action="generateCustomerDoc"/g) || []).length;
  assert('all 15 doc-template cards still wired (regression guard)',
    cardCount === 15,
    'expected 15 doc-template-card data-action wirings, got ' + cardCount);

  // ── Photo action popup now has a Preview button (3-button row) ──
  // Originally the popup only offered Open Editor + Delete — clicking
  // a photo had no plain "view it bigger" affordance. Preview wraps
  // the existing openPhotoLightbox() + closes the popup.
  assert('photo action popup template emits a Preview button',
    /data-action="_previewPhotoFromPopup"[\s\S]{0,500}Preview/.test(customer));
  assert('Preview button order: Preview before Open Editor before Delete',
    /_previewPhotoFromPopup[\s\S]{0,600}_openPhotoInEditorAndClose[\s\S]{0,600}deletePhoto/.test(customer));
  assert('_previewPhotoFromPopup calls openPhotoLightbox with url + description',
    /function _previewPhotoFromPopup[\s\S]{0,1200}openPhotoLightbox\(photo\.url,\s*photo\.description/.test(customer));
}

};
