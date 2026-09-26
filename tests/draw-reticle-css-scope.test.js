/**
 * tests/draw-reticle-css-scope.test.js — every rule in
 * docs/pro/css/draw-reticle.css is scoped to the phone crosshair screen or
 * to its beta switch (draw lane L4 release gate, 2026-09-25).
 *
 * Why: the crosshair screen ships OFF behind "Crosshair drawing (beta)" until
 * Jo's daylight test on his iPhone. Off, a phone's Draw view must be main's.
 * draw-reticle.css rides the drawtool bundle and is loaded on EVERY phone,
 * switch on or off, so what keeps it inert is only that each selector starts
 * with a scope draw-reticle.js adds while the screen is up:
 *   #view-draw.dr-on   the Draw view, while the screen is built
 *   body.dr-bar-on     the toast move, while the screen is on screen
 * or targets the switch's own elements:
 *   #map-sidebar-draw .dr-switch…
 * The gate review (2026-09-25) un-scoped the toast rule and the ☰ Tools sheet
 * rules in a served copy: every phone's toasts jumped to y 92 and Tools
 * became an overlay, and the E2E suites stayed green (both "default (no
 * preference)" tests included). This suite is the guard for that. The E2E
 * default tests pin the other half: with no preference neither class is set.
 *
 * Parses the stylesheet (comments stripped first, so a scope named in a
 * comment cannot satisfy it), walks @media / @supports blocks, and checks
 * every comma-separated selector. Any other at-rule (@import, @font-face,
 * @keyframes …) is refused: each would reach pages with the switch off.
 * A self-test runs known-bad sheets through the same checker first, so the
 * suite is proven able to fail.
 *
 * Zero deps. Run: node tests/draw-reticle-css-scope.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CSS_PATH = path.join(ROOT, 'docs', 'pro', 'css', 'draw-reticle.css');

let passed = 0;
let failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

const SCOPES = [
  /^#view-draw\.dr-on(?![\w-])/,
  /^body\.dr-bar-on(?![\w-])/,
  /^#map-sidebar-draw \.dr-switch(?:-[\w-]+)?(?![\w-])/,
];
const NESTING_AT_RULES = ['media', 'supports'];

// Split a selector list on top-level commas (not inside :is(…) / [a="x,y"]).
function splitSelectors(list) {
  const out = [];
  let depth = 0, quote = null, cur = '';
  for (const ch of list) {
    if (quote) { if (ch === quote) quote = null; cur += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// → { selectors: [{sel, ctx}], atRules: [{name, prelude}], problems: [] }
function parse(cssText) {
  const css = cssText.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const selectors = [], atRules = [], problems = [];
  let i = 0;
  function skipBlock() { // i is just past '{'
    let depth = 1, quote = null;
    while (i < css.length && depth > 0) {
      const ch = css[i++];
      if (quote) { if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth) problems.push('unterminated block');
  }
  function block(ctx) {
    while (i < css.length) {
      while (i < css.length && /\s/.test(css[i])) i++;
      if (i >= css.length) return;
      if (css[i] === '}') { i++; return; }
      const start = i;
      while (i < css.length && css[i] !== '{' && css[i] !== ';' && css[i] !== '}') i++;
      const prelude = css.slice(start, i).trim();
      if (i >= css.length) { if (prelude) problems.push('dangling text: ' + prelude.slice(0, 60)); return; }
      if (css[i] === ';') { i++; atRules.push({ name: (/^@([\w-]+)/.exec(prelude) || [, prelude])[1], prelude }); continue; }
      if (css[i] === '}') { problems.push('stray text before }: ' + prelude.slice(0, 60)); i++; return; }
      i++; // past '{'
      if (prelude.startsWith('@')) {
        const name = (/^@([\w-]+)/.exec(prelude) || [, ''])[1].toLowerCase();
        atRules.push({ name, prelude });
        if (NESTING_AT_RULES.includes(name)) block(ctx.concat(prelude));
        else skipBlock();
      } else {
        for (const sel of splitSelectors(prelude)) selectors.push({ sel, ctx: ctx.join(' / ') });
        skipBlock();
      }
    }
  }
  block([]);
  return { selectors, atRules, problems };
}

// → list of human-readable violations
function violations(cssText) {
  const p = parse(cssText);
  const out = p.problems.map((x) => 'parse: ' + x);
  for (const a of p.atRules) if (!NESTING_AT_RULES.includes(a.name)) out.push('at-rule @' + a.name + ' reaches every page: ' + a.prelude.slice(0, 80));
  for (const s of p.selectors) {
    if (!SCOPES.some((re) => re.test(s.sel))) out.push('unscoped selector "' + s.sel + '"' + (s.ctx ? ' in ' + s.ctx : ''));
  }
  return { list: out, selectors: p.selectors.length };
}

// ── 1. The checker can fail ─────────────────────────────────────────
console.log('\n[self-test: known-bad sheets are caught]');
{
  const cases = [
    ['a bare toast rule (the gate review\'s mutant)', 'body .toast-container{top:0}', 1],
    ['an unscoped rule inside @media', '@media (max-width:768px){#view-draw.dr-on .x{top:0} #map-sidebar-draw{position:absolute}}', 1],
    ['a scope named only in a comment', '/* #view-draw.dr-on */ .toast{top:0}', 1],
    ['one bad selector in a list', '#view-draw.dr-on .a, .toast-container{top:0}', 1],
    ['a look-alike scope class', '#view-draw.dr-online .a{top:0} body.dr-bar-onx{top:0}', 2],
    ['an @import', '@import url("x.css");', 1],
    ['a @font-face', '@font-face{font-family:x;src:url(x.woff2)}', 1],
    ['the switch class somewhere else', '.dr-switch{width:1px} #map-sidebar-draw .draw-btn{top:0}', 2],
  ];
  for (const [name, css, n] of cases) {
    const v = violations(css).list;
    ok(name + ': ' + n + ' caught', v.length === n, JSON.stringify(v));
  }
  const good = violations('#view-draw.dr-on .a,#view-draw.dr-on.active{top:0} body.dr-bar-on .toast{top:0} #map-sidebar-draw .dr-switch-knob{left:0} @media (x){#view-draw.dr-on .b{top:0}}');
  ok('a fully scoped sheet passes', good.list.length === 0 && good.selectors === 5, JSON.stringify(good));
}

// ── 2. draw-reticle.css itself ──────────────────────────────────────
console.log('\n[docs/pro/css/draw-reticle.css]');
{
  const css = fs.readFileSync(CSS_PATH, 'utf8');
  const v = violations(css);
  ok('the stylesheet parses into rules (' + v.selectors + ' selectors)', v.selectors > 60, 'only ' + v.selectors + ' selectors found — did the parser break?');
  ok('every selector starts with #view-draw.dr-on, body.dr-bar-on or #map-sidebar-draw .dr-switch*', v.list.length === 0, v.list.join('; '));
}

// ── 3. Only draw-reticle.js sets the scopes ─────────────────────────
// The markup never carries them, and no other script adds them, so the
// E2E "default (no preference)" checks (no .dr-on, no .dr-bar-on) are the
// whole story for a phone with the switch off.
console.log('\n[the scope classes come from draw-reticle.js only]');
{
  const re = /\bdr-(?:on|bar-on)\b/;
  const html = fs.readFileSync(path.join(ROOT, 'docs', 'pro', 'dashboard.html'), 'utf8');
  ok('dashboard.html carries neither dr-on nor dr-bar-on', !re.test(html));
  const jsDir = path.join(ROOT, 'docs', 'pro', 'js');
  const others = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js') && f !== 'draw-reticle.js')
    .filter((f) => re.test(fs.readFileSync(path.join(jsDir, f), 'utf8')));
  ok('no other docs/pro/js file names them', others.length === 0, others.join(', '));
  ok('draw-reticle.js does', re.test(fs.readFileSync(path.join(jsDir, 'draw-reticle.js'), 'utf8')));
}

console.log('\n──────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
