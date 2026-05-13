#!/usr/bin/env node
/**
 * crm-audit.js — comprehensive static audit of the NBD Pro CRM surface.
 *
 * Read-only checks on every HTML page under docs/pro/ to catch regressions
 * in visibility, clickability, and wiring without needing a browser or
 * Firebase emulator. Zero deps.
 *
 * Checks:
 *   1. SCRIPTS:    every <script src="..."> resolves to a real file
 *   2. STYLES:     every <link rel="stylesheet|preload|icon|manifest" href="...">
 *                  resolves to a real file
 *   3. HANDLERS:   every onclick="someFn(...)" resolves to a function
 *                  defined in inline scripts on this page or in pro/js/*
 *   4. ANCHORS:    <a href="#someId"> targets exist on the page
 *   5. EMPTY-CTAS: <button>/<a> with no text and no aria-label/title
 *   6. DUPES:      duplicate id="..." outside <script> blocks
 *   7. INTEGRITY:  inline JS <script> blocks parse cleanly under node --check
 *                  (skips type="application/ld+json", "application/json", etc.)
 *   8. BROKEN_ANCHOR for <a href="#x"> when #x doesn't exist
 *   9. UNWIRED_FORM for <form id> with no action/onsubmit/JS reference
 *
 * Usage:
 *   node scripts/crm-audit.js
 *   node scripts/crm-audit.js --json
 *   node scripts/crm-audit.js --page=dashboard.html
 *   node scripts/crm-audit.js --severity=error
 *   node scripts/crm-audit.js --quiet            (errors + warns only)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PRO_DIR = path.join(ROOT, 'docs', 'pro');
const PRO_JS_DIR = path.join(PRO_DIR, 'js');
const DOCS_DIR = path.join(ROOT, 'docs');

const args = process.argv.slice(2);
const flag = (k) => args.find(a => a.startsWith('--' + k + '='))?.split('=')[1] || (args.includes('--' + k) ? true : null);
const ONLY_PAGE = flag('page');
const AS_JSON = !!flag('json');
const SEVERITY = flag('severity') || null;
const QUIET = !!flag('quiet');

// ── helpers ──────────────────────────────────────────────────
const findings = []; // { page, severity, code, message, detail? }
function record(page, severity, code, message, detail) {
  findings.push({ page, severity, code, message, detail });
}

function read(file) { return fs.readFileSync(file, 'utf8'); }
function exists(file) { try { fs.accessSync(file); return true; } catch { return false; } }

function listHtmlPages() {
  return fs.readdirSync(PRO_DIR)
    .filter(f => f.endsWith('.html'))
    .filter(f => !ONLY_PAGE || f === ONLY_PAGE)
    .sort();
}

// Strip HTML comments so we don't audit dead/example markup.
function stripHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

// Build the no-script html: every <script>...</script> AND <style>...</style>
// replaced by a placeholder of the same length. Used for attribute scans
// where we must NOT match id= / onclick= / `<img` / etc. that live inside
// JS strings or CSS comments.
function stripScriptBodies(html) {
  let out = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (m) => {
    const open = m.match(/<script\b[^>]*>/i);
    const openLen = open ? open[0].length : 0;
    return m.slice(0, openLen) + ' '.repeat(Math.max(0, m.length - openLen - 9)) + '</script>';
  });
  out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (m) => {
    const open = m.match(/<style\b[^>]*>/i);
    const openLen = open ? open[0].length : 0;
    return m.slice(0, openLen) + ' '.repeat(Math.max(0, m.length - openLen - 8)) + '</style>';
  });
  return out;
}

function resolveAsset(href, fromHtmlPath) {
  if (!href) return { skip: true };
  const trimmed = href.trim();
  if (!trimmed) return { skip: true };
  if (/^(https?:|data:|mailto:|tel:|javascript:|#)/i.test(trimmed)) return { skip: true };
  const clean = trimmed.split('?')[0].split('#')[0];
  if (!clean) return { skip: true };
  let abs;
  if (clean.startsWith('/')) abs = path.join(DOCS_DIR, clean);
  else abs = path.join(path.dirname(fromHtmlPath), clean);
  return { skip: false, abs, href: trimmed };
}

// Index of identifiers defined across pro/js/*.js — used to resolve
// onclick="foo(...)" handlers.
function buildJsFunctionIndex() {
  const idx = new Set();
  function scan(content) {
    for (const m of content.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)) idx.add(m[1]);
    for (const m of content.matchAll(/(?:^|\n|;|\}|,)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) idx.add(m[1]);
    for (const m of content.matchAll(/(?:^|\n|;)\s*(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\(|new\s+\w+)/g)) idx.add(m[1]);
    // Object.assign(window, { foo, bar })
    for (const m of content.matchAll(/Object\.assign\s*\(\s*window\s*,\s*\{([^}]+)\}/g)) {
      for (const k of m[1].matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*[:,}]/g)) idx.add(k[1]);
    }
  }
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fp);
      else if (entry.name.endsWith('.js')) {
        try { scan(read(fp)); } catch { /* ignore */ }
      }
    }
  }
  walk(PRO_JS_DIR);
  return idx;
}

function scanAttributes(haystack, attrName) {
  const out = [];
  const re = new RegExp(`${attrName}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'gi');
  let m; while ((m = re.exec(haystack))) out.push((m[2] ?? m[3] ?? m[4] ?? '').trim());
  return out;
}

function scanTags(haystack, tagName) {
  const out = [];
  const re = new RegExp(`<${tagName}\\b([^>]*?)>`, 'gis');
  let m; while ((m = re.exec(haystack))) out.push({ raw: m[0], attrs: m[1], idx: m.index });
  return out;
}

// Pull inline executable scripts (skip JSON / JSON-LD / template /
// importmap blocks).
function extractInlineScripts(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/.test(attrs)) continue;
    const typeMatch = attrs.match(/\btype\s*=\s*"([^"]*)"|\btype\s*=\s*'([^']*)'/i);
    const type = (typeMatch && (typeMatch[1] || typeMatch[2]) || '').toLowerCase();
    if (type && !/^(text\/javascript|module|application\/javascript|)$/i.test(type)) continue;
    out.push(m[2]);
  }
  return out;
}

function stripCommentsAndStrings(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^\\:])\/\/[^\n]*/g, '$1')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

// "globals" never trigger UNRESOLVED_HANDLER even if not in the index.
const KNOWN_GLOBALS = new Set([
  // js reserved words that may appear in inline handlers
  'return','if','else','typeof','void','this','new','delete','in','of','instanceof','for','while',
  'function','async','await','yield','throw','try','catch','finally','switch','case','default','break',
  'continue','do','var','let','const','class','extends','import','export','from','true','false','null','undefined',
  // dom + browser
  'window','document','console','event','alert','confirm','prompt','history','location','navigator',
  'screen','setTimeout','setInterval','clearTimeout','clearInterval','requestAnimationFrame',
  'localStorage','sessionStorage','firebase','fetch','URL','URLSearchParams','Promise','JSON','Math',
  'Number','String','Array','Object','Date','Boolean','Map','Set','WeakMap','WeakSet','Symbol','Error',
  'RegExp','addEventListener','removeEventListener','dispatchEvent','open','close','focus','blur',
  'print','CSS','crypto','indexedDB','caches','performance','Intl','encodeURIComponent','decodeURIComponent',
  'parseInt','parseFloat','isNaN','isFinite','queueMicrotask','reportError','structuredClone',
  // framework hooks (common namespaces wired by other modules)
  'NBDAuth','CompanyAdmin','NBD','NBDComms','NBDRepos','NBDLogger','NBDVoice','NBDStore','NBDIcons',
  'ScriptLoader','AdminManager','AskJoeProactive','PWAInstall','OfflineManager','ThemeGX','ThemeOverlays',
  'ThemeSounds','ThemeEngine','PhotoEngine','InspectionReportEngine','InvoicePipeline','NBDReports',
  'NBDDocGen','LeadScore','LeadScorePanel','LeadDedup','SmartFollowup','HotLeadsWidget','BottleneckWidget',
  'StaleSharesWidget','EngagementCohort','AlmostThereWidget','QuickCapture','QuickCaptureInbox',
  'CommandPalette','GlobalSearch','NotifBell','NBDDocViewer','OnboardingTour','PhotoReport',
  'PhotoEditor','ProductLibrary','PropertyIntel','CrmStages','KanbanContextMenu','NeedsAttentionFilter',
  'StaleSharesFilter','TemplateSuite','TemplatesLibrary','RoofiventCatalog','RealDealAcademy',
  'RealDealAcademyLab','RepOS','RepReportGenerator','ReportsDashboard','ReportsTrends','ReviewEngine',
  'SalesTraining','ShareGallery','SignedImageUrl','SmartFollowupBriefing','StandaloneCompat',
  'StateStore','StormCenter','StormIntegration','SupplementUI','Tasks','UI','VoiceIntelligence',
  'VoiceMemo','WarrantyCert','WhatsNew','Widgets','Tools','ShortcutsHelp','PrefsSync','PortalLinkHelpers',
  'IDBCache','Icons','InsuranceClaim','IntegrationsClient','EstimateAnalytics','EstimateBuilderV2',
  'EstimateCatalogXactimate','EstimateConfig','EstimateFinalization','EstimateLaborCatalog',
  'EstimateLogicEngine','EstimateSupplement','EstimateV2UI','Estimates','FabStackCoordinator',
  'FeatureFlags','Forecasting','Forecast','DataExport','DataImport','DecisionEngine','Demo',
  'DocPreflight','DocumentGenerator','DocumentGeneratorTemplates','DomSafe','EmailSystem','D2DTracker',
  'CustomerSnoozeBanner','CustomerEngagementScore','CustomerLastSharedChip','CustomerPortal',
  'CustomerQuickActionBar','CustomerSiblingSnooze','CustomerSmartFollowupPanel','CustomerViewedChip',
  'CustomerDndUpload','ConnectionStatusBtn','ConsoleQuiet','BillingGate','AskJoeMain','AskJoeAuth',
  'AskJoeGate','AcademyAdmin','AcademyCourses','AcademyInsuranceTree','AcademyRetailTree','ActivityFeed',
  'AI','AIAuthGate','AITree','AnalyticsKPI','ProAnalytics','ClipboardFix','CloseBoard','ClaudeProxy',
  'CrmStages','MobileNavCustomizer','LeadScoreAlert','LeadScoring','LeadSnooze','LeadSourceROI',
  'NbdInputGuards','NbdWhisper','NbdComms','NotifBell','PhotoAI','PhotoEngine','PhotoReport',
  'PortalLinkHelpers','Prospects','PWAInstallNudge','PWAInstall','SentryConfig','SentryInit',
  'ThemeAchievements','VoicePrompts','PortalSession','Sentry','MobileNav'
]);

// ── per-page audit ──────────────────────────────────────────
function auditPage(file, jsFnIndex) {
  const abs = path.join(PRO_DIR, file);
  const rawHtml = read(abs);
  const html = stripHtmlComments(rawHtml);
  const noScriptHtml = stripScriptBodies(html);
  const inlineScripts = extractInlineScripts(html);
  const inlineCombined = inlineScripts.join('\n;\n');
  // Strip each block INDEPENDENTLY — joining first lets unbalanced
  // quotes/backticks in one block eat through the next, which would
  // erase real function definitions and produce phantom UNRESOLVED_HANDLER
  // findings. (We learned this the hard way.)
  const inlineStripped = inlineScripts.map(stripCommentsAndStrings).join('\n;\n');

  // 1. SCRIPT srcs resolve  (operate on noScriptHtml so we read only the opening <script ...> attrs)
  const scriptOpeners = scanTags(html, 'script');
  for (const tag of scriptOpeners) {
    const srcMatch = tag.attrs.match(/\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!srcMatch) continue;
    const src = srcMatch[2] || srcMatch[3] || srcMatch[4];
    const r = resolveAsset(src, abs);
    if (r.skip) continue;
    if (!exists(r.abs)) record(file, 'error', 'BROKEN_SCRIPT', `script src not found: ${src}`, r.abs);
  }

  // 2. <link rel="..." href="...">
  const links = scanTags(html, 'link');
  for (const tag of links) {
    const rel = (tag.attrs.match(/\brel\s*=\s*"([^"]*)"|\brel\s*=\s*'([^']*)'/i) || [])[1] || '';
    const href = (tag.attrs.match(/\bhref\s*=\s*"([^"]*)"|\bhref\s*=\s*'([^']*)'/i) || [])[1] || '';
    if (!href) continue;
    const r = resolveAsset(href, abs);
    if (r.skip) continue;
    if (/stylesheet|preload|modulepreload|^icon$|manifest|apple-touch-icon|mask-icon|shortcut/i.test(rel)) {
      if (!exists(r.abs)) record(file, 'error', 'BROKEN_LINK', `${rel || 'link'} href not found: ${href}`, r.abs);
    }
  }

  // 3. duplicate id="..." — scan ONLY outside <script> blocks
  const ids = scanAttributes(noScriptHtml, 'id');
  const idCounts = new Map();
  for (const id of ids) {
    if (!id) continue;
    // skip obviously-templated ids
    if (id.includes('${') || id.includes('{{')) continue;
    idCounts.set(id, (idCounts.get(id) || 0) + 1);
  }
  for (const [id, n] of idCounts) {
    if (n > 1) record(file, 'warn', 'DUPLICATE_ID', `id="${id}" appears ${n} times`);
  }

  // 4. Inline JS syntax (skip JSON-LD, JSON, importmap, template)
  for (let i = 0; i < inlineScripts.length; i++) {
    const tmp = path.join(require('os').tmpdir(), `nbd-inline-${path.basename(file, '.html')}-${i}.js`);
    fs.writeFileSync(tmp, inlineScripts[i]);
    try { execSync(`node --check "${tmp}"`, { stdio: 'pipe' }); }
    catch (e) {
      const err = (e.stderr ? e.stderr.toString() : e.message).split('\n').slice(0,2).join(' | ');
      record(file, 'error', 'INLINE_SYNTAX', `inline <script> #${i+1} fails parse: ${err.slice(0, 200)}`);
    } finally {
      try { fs.unlinkSync(tmp); } catch {}
    }
  }

  // 5. Handler resolution: scan ONLY outside <script> blocks
  const handlerEvents = ['onclick','onsubmit','onchange','oninput','onkeyup','onkeydown','onfocus','onblur','onload','onerror','ondblclick'];
  for (const ev of handlerEvents) {
    const calls = scanAttributes(noScriptHtml, ev);
    for (const expr of calls) {
      // collect candidate identifiers being CALLED in the expression
      // Strip strings out of the expression first — `selectZoneColor('var(--blue)')`
      // shouldn't yield `var` as an identifier.
      const exprNoStrings = expr
        .replace(/'(?:\\.|[^'\\])*'/g, "''")
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/`(?:\\.|[^`\\])*`/g, '``');
      // Pull identifiers that look like callable references: word+(, word+.,
      // or word+[. Use a leading non-word boundary to avoid sliding matches
      // (e.g. `showLoading(` would otherwise yield howLoading, owLoading…)
      const ids = new Set();
      for (const m of exprNoStrings.matchAll(/(?:^|[^\w$])([A-Za-z_$][\w$]*)\s*[(.\[]/g)) ids.add(m[1]);
      for (const id of ids) {
        if (KNOWN_GLOBALS.has(id)) continue;
        // Skip identifiers used as a method name only (preceded by `.`)
        const methodOnly = new RegExp(`\\.${id}\\b`).test(exprNoStrings) &&
                           !new RegExp(`(?:^|[^\\w$.])${id}\\s*[(\\[]`).test(exprNoStrings);
        if (methodOnly) continue;
        const defined =
          jsFnIndex.has(id) ||
          new RegExp(`function\\s+${id}\\b`).test(inlineCombined) ||
          new RegExp(`window\\.${id}\\s*=`).test(inlineCombined) ||
          new RegExp(`(?:^|[\\s;{])(?:var|let|const)\\s+${id}\\s*=`).test(inlineCombined) ||
          new RegExp(`${id}\\s*=\\s*(?:async\\s*)?(?:function|\\(|new )`).test(inlineStripped);
        if (!defined) {
          record(file, 'warn', 'UNRESOLVED_HANDLER', `${ev}="${expr.slice(0,60)}…" → ${id} not defined`);
          break;
        }
      }
    }
  }

  // 6. anchor fragment targets
  const anchors = scanTags(noScriptHtml, 'a');
  for (const tag of anchors) {
    const href = (tag.attrs.match(/\bhref\s*=\s*"([^"]*)"|\bhref\s*=\s*'([^']*)'/i) || [])[1] || '';
    if (!href.startsWith('#') || href === '#' || href === '#!' || href.startsWith('#/')) continue;
    const id = href.slice(1);
    if (!idCounts.has(id)) record(file, 'info', 'BROKEN_ANCHOR', `<a href="${href}"> has no matching id on the page`);
  }

  // 7. <a> tags with href="" and no listener
  for (const tag of anchors) {
    const href = (tag.attrs.match(/\bhref\s*=\s*"([^"]*)"|\bhref\s*=\s*'([^']*)'/i) || [])[1];
    if (href === '' || href === '#') {
      if (!/onclick|data-action|role\s*=\s*"button"/i.test(tag.attrs)) {
        record(file, 'info', 'EMPTY_ANCHOR', `<a href="${href ?? ''}"> with no onclick/data-action`);
      }
    }
  }

  // 8. <input type="password"> needs name or id
  const inputs = scanTags(noScriptHtml, 'input');
  for (const tag of inputs) {
    const type = (tag.attrs.match(/\btype\s*=\s*"([^"]*)"|\btype\s*=\s*'([^']*)'/i) || [])[1];
    const name = (tag.attrs.match(/\bname\s*=\s*"([^"]*)"|\bname\s*=\s*'([^']*)'/i) || [])[1];
    const id = (tag.attrs.match(/\bid\s*=\s*"([^"]*)"|\bid\s*=\s*'([^']*)'/i) || [])[1];
    if (type === 'password' && !name && !id) {
      record(file, 'warn', 'PASSWORD_NO_NAME', `<input type="password"> with no name and no id`);
    }
  }

  // 9. button / link with no text/aria-label/title
  const buttons = scanTags(noScriptHtml, 'button');
  for (const tag of buttons) {
    const closeIdx = noScriptHtml.indexOf('</button>', tag.idx + tag.raw.length);
    if (closeIdx === -1) continue;
    const inner = noScriptHtml.slice(tag.idx + tag.raw.length, closeIdx);
    const text = inner.replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/gi, '').trim();
    const ariaLabel = (tag.attrs.match(/\baria-label\s*=\s*"([^"]*)"|\baria-label\s*=\s*'([^']*)'/i) || [])[1];
    const title = (tag.attrs.match(/\btitle\s*=\s*"([^"]*)"|\btitle\s*=\s*'([^']*)'/i) || [])[1];
    if (!text && !ariaLabel && !title) {
      record(file, 'info', 'EMPTY_BUTTON', `<button> with no visible text, aria-label, or title`);
    }
  }

  // 10. <form id> with no action/onsubmit and id not referenced anywhere
  // (we check inline scripts AND every external script src on the page)
  const externalScriptSrcs = [];
  for (const tag of scriptOpeners) {
    const m = tag.attrs.match(/\bsrc\s*=\s*"([^"]*)"|\bsrc\s*=\s*'([^']*)'/i);
    if (!m) continue;
    const r = resolveAsset(m[1] || m[2], abs);
    if (!r.skip && exists(r.abs)) externalScriptSrcs.push(r.abs);
  }
  const externalJs = externalScriptSrcs.map(p => { try { return read(p); } catch { return ''; } }).join('\n');
  const forms = scanTags(noScriptHtml, 'form');
  for (const tag of forms) {
    const action = (tag.attrs.match(/\baction\s*=\s*"([^"]*)"|\baction\s*=\s*'([^']*)'/i) || [])[1];
    const onSubmit = /\bonsubmit\s*=/i.test(tag.attrs);
    const dataAction = /\bdata-(action|form)\s*=/i.test(tag.attrs);
    const id = (tag.attrs.match(/\bid\s*=\s*"([^"]*)"|\bid\s*=\s*'([^']*)'/i) || [])[1];
    if (!action && !onSubmit && !dataAction && id) {
      const re = new RegExp(`['"\`#]${id}['"\`]`);
      if (!re.test(inlineCombined) && !re.test(externalJs)) {
        record(file, 'info', 'UNWIRED_FORM', `<form id="${id}"> has no action, no onsubmit, and id not referenced in any loaded JS`);
      }
    }
  }

  // 11. <img> without alt attribute (accessibility)
  const imgs = scanTags(noScriptHtml, 'img');
  for (const tag of imgs) {
    if (!/\balt\s*=/.test(tag.attrs)) {
      const src = (tag.attrs.match(/\bsrc\s*=\s*"([^"]*)"|\bsrc\s*=\s*'([^']*)'/i) || [])[1] || '(unknown)';
      record(file, 'info', 'IMG_NO_ALT', `<img src="${src.slice(0,50)}…"> missing alt attribute`);
    }
  }

  // 12. Visibility: elements with display:none AND no id/class/data-*
  // referenced by any loaded JS — these are "dead hidden" panels.
  // We only flag elements with an id since classless display:none divs
  // are usually intentional placeholders.
  // Search inline JS, external JS, and the HTML itself (since handlers
  // bound via onclick="document.getElementById('...')" live in attrs).
  const allHtmlSearch = inlineCombined + '\n' + externalJs + '\n' + noScriptHtml;
  const hiddenById = [];
  const hiddenRe = /id\s*=\s*"([^"]+)"[^>]*style\s*=\s*"[^"]*display\s*:\s*none/gi;
  let hm; while ((hm = hiddenRe.exec(noScriptHtml))) hiddenById.push(hm[1]);
  for (const id of hiddenById) {
    // Direct reference: '#foo', "foo", `foo`, etc. — but NOT the
    // id="foo" attribute on the element itself (lookbehind excludes
    // `=` before the quote so attribute values don't self-match).
    const direct = new RegExp(`(?<![=])['"\`#]${id}['"\`]`).test(allHtmlSearch);
    if (direct) continue;
    // Dynamic reference: ids constructed by string concat. We accept any
    // numeric-trailing or hyphen/underscore-trailing PREFIX showing up as
    // a string literal anywhere in the loaded JS. Catches:
    //   'stab-panel-' + tab        → id="stab-panel-estimates"
    //   'estStep' + i              → id="estStep2"
    //   `${prefix}_${suffix}`      → id-prefix shape
    let dynamic = false;
    // Try shrinking the id from the end on hyphen/underscore boundaries.
    const parts = id.split(/([-_])/); // keeps separators
    for (let i = parts.length - 2; i >= 1; i -= 2) {
      const prefix = parts.slice(0, i + 1).join('');
      if (prefix.length < 3) break;
      if (new RegExp(`['"\`]${prefix}['"\`+}]`).test(allHtmlSearch)) { dynamic = true; break; }
    }
    // Numeric-trailing pattern (estStep2 → estStep)
    if (!dynamic) {
      const numStrip = id.replace(/\d+$/, '');
      if (numStrip !== id && numStrip.length >= 3 &&
          new RegExp(`['"\`]${numStrip}['"\`+}]`).test(allHtmlSearch)) dynamic = true;
    }
    if (!dynamic) {
      record(file, 'info', 'DEAD_HIDDEN', `id="${id}" is display:none and never referenced by JS (cannot be shown)`);
    }
  }
}

// ── main ────────────────────────────────────────────────────
function main() {
  const pages = listHtmlPages();
  console.error(`Auditing ${pages.length} CRM page(s) under docs/pro/...`);
  const jsFnIndex = buildJsFunctionIndex();
  console.error(`Indexed ${jsFnIndex.size} JS function/global symbols across pro/js/`);

  for (const p of pages) {
    process.stderr.write(`  · ${p}\n`);
    try { auditPage(p, jsFnIndex); }
    catch (e) {
      record(p, 'error', 'AUDIT_CRASH', 'auditor threw: ' + (e.stack || e.message));
    }
  }

  let filtered = findings;
  if (SEVERITY) filtered = filtered.filter(f => f.severity === SEVERITY);
  if (QUIET) filtered = filtered.filter(f => f.severity !== 'info');

  if (AS_JSON) {
    process.stdout.write(JSON.stringify({ pages, findings: filtered }, null, 2) + '\n');
    return;
  }

  const byPage = new Map();
  for (const f of filtered) {
    if (!byPage.has(f.page)) byPage.set(f.page, []);
    byPage.get(f.page).push(f);
  }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  NBD PRO CRM — STATIC AUDIT REPORT');
  console.log('══════════════════════════════════════════════════════════\n');

  let totErr = 0, totWarn = 0, totInfo = 0;
  for (const f of findings) {
    if (f.severity === 'error') totErr++;
    else if (f.severity === 'warn') totWarn++;
    else totInfo++;
  }

  for (const p of pages) {
    const list = byPage.get(p) || [];
    const tag = list.length === 0 ? 'CLEAN' : `${list.length} finding(s)`;
    console.log(`──  ${p}  ──  ${tag}`);
    if (!list.length) { console.log(); continue; }
    const errs = list.filter(x => x.severity === 'error');
    const warns = list.filter(x => x.severity === 'warn');
    const infos = list.filter(x => x.severity === 'info');
    for (const f of errs) console.log(`    [ERROR] ${f.code}  ${f.message}` + (f.detail ? `\n             ${f.detail}` : ''));
    for (const f of warns) console.log(`    [WARN ] ${f.code}  ${f.message}`);
    if (infos.length <= 8) {
      for (const f of infos) console.log(`    [INFO ] ${f.code}  ${f.message}`);
    } else {
      const byCode = new Map();
      for (const f of infos) byCode.set(f.code, (byCode.get(f.code) || 0) + 1);
      for (const [c, n] of byCode) console.log(`    [INFO ] ${c} × ${n}`);
    }
    console.log();
  }

  console.log('──────────────────────────────────────────────────────────');
  console.log(`  TOTAL: ${totErr} error · ${totWarn} warn · ${totInfo} info`);
  console.log('──────────────────────────────────────────────────────────');
  process.exit(totErr > 0 ? 1 : 0);
}

main();
