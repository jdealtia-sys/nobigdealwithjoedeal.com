/* tests/lib/hosting-headers.js
 *
 * Compute the headers Firebase Hosting actually sends for a URL path, from
 * firebase.json — the EFFECTIVE value per header key, not "does some block
 * mention it". Shared by tests/google-signin-popup.test.js (static
 * contract) and tests/e2e/google-signin-popup.spec.js (which injects the
 * result, because the Hosting emulator serves none of firebase.json's
 * headers — measured 2026-09-18 on firebase-tools 15: no CSP, no COOP, not
 * even Cache-Control).
 *
 * Semantics mirrored (superstatic 10 lib/middleware/headers.js +
 * lib/utils/patterns.js, the engine the Hosting emulator is built on, and
 * the behaviour this repo has verified live):
 *   - EVERY block whose source matches contributes; blocks apply in array
 *     order via res.setHeader, so for each header key the LAST matching
 *     block wins (live-verified 2026-09-18: /pro/register serves the
 *     per-path CSP from the later block, not the '**' one; firebase.json's
 *     own comments record the same for /admin/login Cache-Control).
 *   - The request pathname is matched after cleanUrls has already
 *     redirected /x.html to /x, so a page's canonical URL is extensionless
 *     (see canonicalPagePath) and a '/x.html' source never matches.
 *   - A source is glob-slashed (a leading '/' is added, so '**' is '/**')
 *     and matched with minimatch 6 defaults: '**' swallows whole path
 *     segments but never dot-segments, '*' / '?' stay inside one segment and
 *     never match a leading '.', '/a/**' does NOT match '/a', a trailing
 *     slash on the path still matches, and '@(x|y)' is an extglob.
 *     Cross-checked against superstatic's own minimatch for every
 *     (source, page) pair in this repo when this file was written.
 *
 * Anything outside that subset — character classes, braces, negation, the
 * other extglob forms, backslash escapes, or a `regex` block — THROWS rather
 * than guessing. A header test that silently mis-evaluates a pattern is the
 * exact failure mode it exists to catch, so a new pattern shape has to be
 * taught here on purpose.
 *
 * Zero dependencies (the unit-suite CI job installs only functions/ deps).
 */
'use strict';

const UNSUPPORTED = [
  [/\[/, 'character class [...]'],
  [/\{/, 'brace expansion {a,b}'],
  [/\\/, 'backslash escape'],
  [/[!+*?]\(/, 'extglob other than @(...)'],
];

function assertSupported(glob) {
  if (glob.startsWith('!')) throw new Error(`hosting-headers: negated source "${glob}" is not supported — teach tests/lib/hosting-headers.js before relying on it`);
  for (const [re, what] of UNSUPPORTED) {
    if (re.test(glob)) throw new Error(`hosting-headers: ${what} in source "${glob}" is not supported — teach tests/lib/hosting-headers.js before relying on it`);
  }
}

// glob-slash: path.posix.normalize(path.posix.join('/', value)).
function slash(value) {
  const parts = [];
  for (const p of ('/' + value).split('/')) {
    if (p === '..') parts.pop();
    else if (p !== '.') parts.push(p);
  }
  let out = parts.join('/').replace(/\/{2,}/g, '/');
  if (!out.startsWith('/')) out = '/' + out;
  return out;
}

const escapeRe = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');

// One path segment's pattern → RegExp source. Supports literals, '*', '?',
// and non-nested @(a|b|...) whose alternatives may themselves use * and ?.
function segmentSource(seg) {
  let out = '';
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (c === '@' && seg[i + 1] === '(') {
      const close = seg.indexOf(')', i + 2);
      const inner = close === -1 ? null : seg.slice(i + 2, close);
      if (inner === null || inner.includes('(')) {
        throw new Error(`hosting-headers: unbalanced or nested @(...) in "${seg}"`);
      }
      out += '(?:' + inner.split('|').map(segmentSource).join('|') + ')';
      i = close;
    } else if (c === '*') {
      out += '[^/]*';
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += escapeRe(c);
    }
  }
  return out;
}

function segmentMatches(patternSeg, pathSeg) {
  const magic = /[*?]|@\(/.test(patternSeg);
  if (!magic) return patternSeg === pathSeg;
  // minimatch: a magic segment never matches an empty one ('/a/*' vs '/a/'),
  // and (dot:false) a leading '.' in the path segment is only matched by a
  // pattern segment that itself starts with a literal '.'.
  if (pathSeg === '') return false;
  if (pathSeg.startsWith('.') && !patternSeg.startsWith('.')) return false;
  return new RegExp('^' + segmentSource(patternSeg) + '$').test(pathSeg);
}

function matchParts(file, fi, pat, pi) {
  for (; fi < file.length && pi < pat.length; fi++, pi++) {
    if (pat[pi] === '**') {
      if (pi === pat.length - 1) {
        // Trailing globstar swallows the rest — unless a dot-segment is in it.
        for (let k = fi; k < file.length; k++) {
          if (file[k] === '.' || file[k] === '..' || (file[k] && file[k].startsWith('.'))) return false;
        }
        return true;
      }
      // Mid-pattern globstar: consume zero or more segments, never a dot one.
      for (let k = fi; k < file.length; k++) {
        if (matchParts(file, k, pat, pi + 1)) return true;
        if (file[k] === '.' || file[k] === '..' || (file[k] && file[k].startsWith('.'))) return false;
      }
      return false;
    }
    if (!segmentMatches(pat[pi], file[fi])) return false;
  }
  if (fi === file.length && pi === pat.length) return true;
  if (fi === file.length) return false; // pattern left over: '/a/**' vs '/a'
  // Path left over: only a single trailing '' (a trailing slash) is allowed.
  return fi === file.length - 1 && file[fi] === '';
}

/** Does a firebase.json glob `source` match this request pathname? */
function globMatches(source, pathname) {
  const glob = slash(source);
  assertSupported(glob);
  return matchParts(pathname.split('/'), 0, glob.split('/'), 0);
}

function ruleMatches(rule, pathname) {
  if (rule.regex !== undefined) {
    throw new Error(`hosting-headers: regex header block "${rule.regex}" is not supported — teach tests/lib/hosting-headers.js before relying on it`);
  }
  const source = rule.source !== undefined ? rule.source : rule.glob;
  if (typeof source !== 'string') throw new Error('hosting-headers: header block with no source/glob: ' + JSON.stringify(rule).slice(0, 120));
  return globMatches(source, pathname);
}

/**
 * Effective headers for one request pathname.
 * @param {object} hosting  firebase.json's `hosting` object
 * @param {string} pathname e.g. '/pro/register'
 * @returns {Map<string, {key: string, value: string, ruleIndex: number, source: string}>}
 *          keyed by lower-cased header name; the entry is the winning block's.
 */
function effectiveHeaders(hosting, pathname) {
  const out = new Map();
  (hosting.headers || []).forEach((rule, ruleIndex) => {
    if (!ruleMatches(rule, pathname)) return;
    for (const h of rule.headers || []) {
      out.set(String(h.key).toLowerCase(), { key: h.key, value: h.value, ruleIndex, source: rule.source });
    }
  });
  return out;
}

/** Convenience: the effective value of one header, or undefined. */
function effectiveHeader(hosting, pathname, key) {
  const hit = effectiveHeaders(hosting, pathname).get(String(key).toLowerCase());
  return hit && hit.value;
}

/**
 * The URL path a docs/ HTML file is served at, the way this site is
 * configured (cleanUrls: true, trailingSlash: false): 'pro/register.html'
 * → '/pro/register', 'pro/index.html' → '/pro', 'index.html' → '/'.
 * @param {string} relFromDocs forward-slash path relative to the hosting root
 */
function canonicalPagePath(relFromDocs, hosting) {
  if (hosting && hosting.cleanUrls !== true) throw new Error('hosting-headers: canonicalPagePath assumes cleanUrls:true');
  if (hosting && hosting.trailingSlash !== false) throw new Error('hosting-headers: canonicalPagePath assumes trailingSlash:false');
  let p = '/' + relFromDocs.replace(/\\/g, '/').replace(/^\/+/, '');
  if (/\/index\.html$/.test(p)) p = p.replace(/\/index\.html$/, '') || '/';
  else p = p.replace(/\.html$/, '');
  return p;
}

module.exports = { globMatches, effectiveHeaders, effectiveHeader, canonicalPagePath };
