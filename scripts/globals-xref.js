#!/usr/bin/env node
// Tranche 3 scoping: cross-reference every window.* global in docs/pro.
// For each name: assigning file(s), consuming file(s), whether it appears
// in HTML/inline-attribute strings, registry/allowlist membership.
'use strict';
const fs = require('fs');
const path = require('path');

const proDir = process.argv[2] || 'docs/pro';

function walk(dir, exts, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue;
      walk(p, exts, out);
    } else if (exts.includes(path.extname(e.name))) out.push(p);
  }
  return out;
}

const jsFiles = walk(proDir, ['.js']);
const htmlFiles = walk(proDir, ['.html']);

const ASSIGN_RE = /window\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=(?!=)/g;
const REF_RE = /window\.([A-Za-z_$][A-Za-z0-9_$]*)/g;
const BRACKET_RE = /window\[\s*['"`]([A-Za-z_$][A-Za-z0-9_$]*)['"`]\s*\]/g;

const globals = new Map(); // name -> {assigners:Set, consumers:Set, htmlHits:Set, bracket:Set}
function entry(name) {
  if (!globals.has(name)) globals.set(name, {
    assigners: new Set(), consumers: new Set(), htmlHits: new Set(), bracket: new Set()
  });
  return globals.get(name);
}

for (const f of jsFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(proDir, f).replace(/\\/g, '/');
  let m;
  ASSIGN_RE.lastIndex = 0;
  while ((m = ASSIGN_RE.exec(src))) entry(m[1]).assigners.add(rel);
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(src))) entry(m[1]).consumers.add(rel);
  BRACKET_RE.lastIndex = 0;
  while ((m = BRACKET_RE.exec(src))) entry(m[1]).bracket.add(rel);
}

// HTML + inline-attribute references (bare name calls in attribute strings
// and <script> blocks; conservative: substring word-match of the name)
const htmlSrc = htmlFiles.map(f => ({
  rel: path.relative(proDir, f).replace(/\\/g, '/'),
  src: fs.readFileSync(f, 'utf8')
}));
for (const [name, e] of globals) {
  if (name.length < 4) continue; // skip noise like $, _db handled below anyway
  const re = new RegExp('\\b' + name.replace(/\$/g, '\\$') + '\\b');
  for (const h of htmlSrc) if (re.test(h.src)) e.htmlHits.add(h.rel);
}

// Registry / allowlist membership
let registryNames = new Set(), allowlistNames = new Set();
for (const f of jsFiles) {
  const src = fs.readFileSync(f, 'utf8');
  if (src.includes('__NBD_CALL_REGISTRY')) {
    const re = /__NBD_CALL_REGISTRY\.register\(\s*['"`]([A-Za-z0-9_$]+)['"`]/g;
    let m; while ((m = re.exec(src))) registryNames.add(m[1]);
  }
}
// allowlist file if present
for (const cand of walk(proDir, ['.js']).filter(f => /allowlist/i.test(f))) {
  const src = fs.readFileSync(cand, 'utf8');
  const re = /['"`]([A-Za-z_$][A-Za-z0-9_$]*)['"`]/g;
  let m; while ((m = re.exec(src))) allowlistNames.add(m[1]);
}

// Band classification. consumers includes the assigner file itself.
const rows = [];
for (const [name, e] of globals) {
  const consumerFiles = new Set(e.consumers);
  for (const a of e.assigners) consumerFiles.delete(a);
  const externalConsumers = consumerFiles.size;
  rows.push({
    name,
    assigners: [...e.assigners].sort(),
    externalConsumers,
    consumerFiles: [...consumerFiles].sort(),
    htmlHits: [...e.htmlHits].sort(),
    bracketDispatch: [...e.bracket].sort(),
    inRegistry: registryNames.has(name),
    inAllowlist: allowlistNames.has(name),
  });
}

rows.sort((a, b) => a.externalConsumers - b.externalConsumers || a.name.localeCompare(b.name));

const summary = {
  totalGlobals: rows.filter(r => r.assigners.length > 0).length,
  totalNamesSeen: rows.length,
  bands: {
    zeroExternal: rows.filter(r => r.assigners.length && r.externalConsumers === 0).length,
    one: rows.filter(r => r.assigners.length && r.externalConsumers === 1).length,
    twoToFive: rows.filter(r => r.assigners.length && r.externalConsumers >= 2 && r.externalConsumers <= 5).length,
    sixPlus: rows.filter(r => r.assigners.length && r.externalConsumers >= 6).length,
  },
  withHtmlHits: rows.filter(r => r.assigners.length && r.htmlHits.length).length,
  withBracketDispatch: rows.filter(r => r.assigners.length && r.bracketDispatch.length).length,
};
console.log(JSON.stringify(summary, null, 2));
fs.writeFileSync(process.argv[3] || 'globals-xref.json', JSON.stringify(rows.filter(r => r.assigners.length > 0), null, 1));
console.error('rows written: ' + rows.filter(r => r.assigners.length > 0).length);
