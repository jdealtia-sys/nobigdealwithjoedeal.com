/* portal-preview-telemetry.test.js
 *
 * A rep looking at the portal is not a customer visit.
 *
 * This was dormant, not absent. The CRM's "Portal preview" modal embeds the
 * homeowner portal in a same-origin iframe, and until 2026-09-08 that embed was
 * refused outright by X-Frame-Options, so portal.js never ran inside it. Fixing
 * the framing makes the question live: without a guard, every preview click
 * emits the homeowner's own audit events.
 *
 * The cost is not a wrong count. `estimate_view` fires a Firestore trigger
 * (functions/fresh-view-logic.js) that pushes the rep an `estimate_viewed`
 * notification — the real-time buying-intent signal — and that trigger de-dupes
 * per lead over a window. So a rep previewing their own link would be told
 * their customer was reading the estimate right now, and the genuine open
 * minutes later would be swallowed as a duplicate. A false positive that
 * suppresses the true signal is worse than no signal at all.
 *
 * Two rep-initiated paths exist and BOTH must be covered — the framed modal,
 * and the unframed new-tab opens ("Open ↗" in the modal, and customer.html's 👁
 * button). The second has been emitting as the homeowner since it shipped; it
 * is not a regression from the framing fix, and fixing only the framed one
 * would be the "handled its author's case, missed the branch one line over"
 * pattern this repo keeps paying for.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const PORTAL = read('docs/pro/js/portal.js');
const HELPERS = read('docs/pro/js/portal-link-helpers.js');
const CUSTPORTAL = read('docs/pro/js/customer-portal.js');

let passed = 0, failed = 0;
function assert(label, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
}
function group(name, fn) { console.log('\n' + name); fn(); }

/* ══════════════════════════════════════════════════════════════════
   1. The framing discriminator — run the REAL expression
   ══════════════════════════════════════════════════════════════════ */
const isPreviewBlock = PORTAL.match(/const IS_PREVIEW = \(function \(\) \{[\s\S]*?\n {2}\}\)\(\);/);

group('The IS_PREVIEW expression is present and liftable', () => {
  assert('found IS_PREVIEW in docs/pro/js/portal.js', !!isPreviewBlock,
    'if this moved, update the extractor — do NOT delete the suite');
});
if (!isPreviewBlock) {
  console.log('\ncannot continue without IS_PREVIEW');
  console.log(passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
}

// Evaluate the real expression against fabricated window/location pairs.
function evalIsPreview({ framed, throws, search }) {
  const win = {};
  const ctx = {
    URLSearchParams,
    window: win,
    location: { search: search || '' },
  };
  win.self = win;
  Object.defineProperty(win, 'top', {
    get() {
      if (throws) throw new Error('SecurityError: Blocked a frame');
      return framed ? {} : win;
    },
  });
  vm.createContext(ctx);
  vm.runInContext(isPreviewBlock[0] + '\nthis.__v = IS_PREVIEW;', ctx);
  return ctx.__v;
}

group('It recognises a rep preview', () => {
  assert('framed same-origin (the modal) → preview',
    evalIsPreview({ framed: true }) === true);
  assert('framed cross-origin, window.top throws → preview',
    evalIsPreview({ throws: true }) === true,
    'a throw here can only mean framed, so it must not fall through to emitting');
  assert('unframed but tagged ?preview=1 (the 👁 button / Open ↗) → preview',
    evalIsPreview({ framed: false, search: '?token=abc&preview=1' }) === true);
  assert('tag order does not matter',
    evalIsPreview({ framed: false, search: '?preview=1&token=abc' }) === true);
});

group('It does NOT misclassify a real homeowner', () => {
  assert('unframed, plain token link → NOT preview',
    evalIsPreview({ framed: false, search: '?token=abc' }) === false,
    'this is the homeowner opening the texted link — their visit MUST be recorded');
  assert('no query string at all → NOT preview',
    evalIsPreview({ framed: false, search: '' }) === false);
  assert('preview=0 is not preview',
    evalIsPreview({ framed: false, search: '?token=abc&preview=0' }) === false);
  assert('a token that merely contains the word preview is not preview',
    evalIsPreview({ framed: false, search: '?token=previewABC123' }) === false,
    'the check must be on the parameter, not a substring of the URL');
});

/* ══════════════════════════════════════════════════════════════════
   2. The guard is actually wired into the emitter
   ══════════════════════════════════════════════════════════════════ */
group('Every audit event goes through the guard', () => {
  assert('_emitAuditEvent returns early when IS_PREVIEW',
    /function _emitAuditEvent\([\s\S]{0,400}?if \(IS_PREVIEW\) return;/.test(PORTAL),
    'the guard must sit in the single emitter, not at each call site');

  // One emitter, so one guard covers every event type. If a future call site
  // posts to recordCustomerEvent directly, this catches it.
  //
  // Strip comments LINE-WISE first. Written against the raw source this
  // counted the comment that documents the emitter and reported a
  // guard-bypassing second caller that does not exist — the same
  // match-your-own-prose trap logged on 2026-09-07, hit twice more in this
  // session. A block-comment stripper is not an option on this file: it
  // contains comment-looking sequences inside regex literals and strings.
  const strippedPortal = PORTAL.split('\n').filter((l) => {
    const t = l.trim();
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
  }).join('\n');
  assert('the stripper did not eat the emitter it guards',
    strippedPortal.indexOf('function _emitAuditEvent') > -1
      && strippedPortal.length > PORTAL.length * 0.6,
    'kept ' + Math.round((strippedPortal.length / PORTAL.length) * 100) + '%');

  const posts = [...strippedPortal.matchAll(/recordCustomerEvent/g)].length;
  assert('recordCustomerEvent is called from exactly one place (the guarded emitter)',
    posts === 1, 'found ' + posts + ' call sites — a second one bypasses the guard');

  // The events that reach the rep. portal_open feeds engagement; estimate_view
  // fires the push. Both must be behind the one guard.
  ['portal_open', 'estimate_view', 'photo_view'].forEach((t) => {
    assert('"' + t + '" is emitted only via _emitAuditEvent',
      new RegExp("_emitAuditEvent\\('" + t + "'").test(PORTAL));
  });
});

/* ══════════════════════════════════════════════════════════════════
   3. _asPreviewUrl — the tag for unframed rep opens
   ══════════════════════════════════════════════════════════════════ */
const tagBlock = HELPERS.match(/function _asPreviewUrl\(url\) \{[\s\S]*?\n {2}\}\n/);
group('The URL tagger is present and liftable', () => {
  assert('found _asPreviewUrl in portal-link-helpers.js', !!tagBlock);
});
if (!tagBlock) {
  console.log('\ncannot continue without _asPreviewUrl');
  console.log(passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
}
const sb = {};
vm.createContext(sb);
vm.runInContext(tagBlock[0] + '\nthis.__t = _asPreviewUrl;', sb);
const tag = sb.__t;

group('It tags every shape of portal URL exactly once', () => {
  assert('appends with & when a query already exists',
    tag('/pro/portal?token=abc') === '/pro/portal?token=abc&preview=1');
  assert('appends with ? when there is no query',
    tag('/pro/portal') === '/pro/portal?preview=1');
  assert('an already-tagged URL is unchanged (no double tag)',
    tag('/pro/portal?token=abc&preview=1') === '/pro/portal?token=abc&preview=1');
  assert('a tag in the middle of the query is still detected',
    tag('/pro/portal?preview=1&token=abc') === '/pro/portal?preview=1&token=abc');
  assert('the tag lands before the fragment, not after it',
    tag('/pro/portal?token=abc#photos') === '/pro/portal?token=abc&preview=1#photos',
    'appending after a #fragment puts the parameter somewhere the page never reads');
  assert('a fragment with no query still gets a valid query',
    tag('/pro/portal#photos') === '/pro/portal?preview=1#photos');
  assert('an absolute URL is handled', tag('https://x.test/pro/portal?token=abc')
    === 'https://x.test/pro/portal?token=abc&preview=1');
  assert('empty input stays empty', tag('') === '');
  assert('null does not throw', tag(null) === '');
});

/* ══════════════════════════════════════════════════════════════════
   4. Both rep-initiated open paths are tagged
   ══════════════════════════════════════════════════════════════════ */
group('Every rep-initiated open is tagged', () => {
  // The modal reassigns the single `url` binding once, so the iframe AND both
  // "Open ↗" anchors inherit the tag. Asserting the reassignment rather than
  // three separate call sites is deliberate: it is the shape that cannot drift
  // apart. (A helper that mutates one binding once is also the fix for the
  // #1458 substitution regression.)
  assert('the modal tags the URL once, before building any markup',
    /function _openPreviewModal\(url, lead\) \{\n\s*_closePreviewModal\(\);[^\n]*\n\s*url = _asPreviewUrl\(url\);/.test(HELPERS),
    'if the iframe and the Open links tag separately they can drift');

  const modal = HELPERS.slice(HELPERS.indexOf('function _openPreviewModal'));
  const openLinks = [...modal.matchAll(/href="\$\{escapeAttr\(url\)\}"/g)].length;
  assert('both "Open ↗" anchors render the same tagged url binding',
    openLinks === 2, 'found ' + openLinks + ' — expected the header link and the footer CTA');
  assert('the iframe renders that same binding',
    /id="nbd-portal-preview-iframe"[\s\S]{0,120}src="\$\{escapeAttr\(url\)\}"/.test(modal));

  // The 👁 button on customer.html is a separate module and a separate path.
  assert('CustomerPortal.preview tags its new-tab open too',
    /previewPortal\(leadId\) \{[\s\S]{0,900}?preview=1[\s\S]{0,200}?window\.open\(previewUrl/.test(CUSTPORTAL),
    'this path is unframed, so the framing discriminator does not cover it');
  assert('...and opens the tagged url, not the raw one',
    /window\.open\(previewUrl, '_blank', 'noopener'\)/.test(CUSTPORTAL));
});

/* ══════════════════════════════════════════════════════════════════
   5. The sharing paths are NOT tagged — the homeowner must be counted
   ══════════════════════════════════════════════════════════════════ */
group('Shared links stay untagged', () => {
  // resolveUrl feeds copy / SMS / email. Tagging those would silently stop
  // recording every genuine homeowner visit — the opposite failure, and a
  // worse one.
  const share = HELPERS.slice(HELPERS.indexOf('async function copyForLead'),
    HELPERS.indexOf('// ─── Preview'));
  assert('copy / SMS / email never call the tagger', share.indexOf('_asPreviewUrl') === -1,
    'a shared link tagged as a preview would stop counting real customer visits');
  assert('resolveUrl itself does not tag',
    HELPERS.slice(HELPERS.indexOf('async function resolveUrl'),
      HELPERS.indexOf('// ─── Copy')).indexOf('_asPreviewUrl') === -1);
});

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
