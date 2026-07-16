#!/usr/bin/env node
// Phase-0 helper: parse the THEMES object out of theme-engine.js into a flat registry.
// Read-only; emits THEME-REGISTRY.json + prints a category summary.
const fs = require('fs');
const path = require('path');
const SRC = path.resolve(__dirname, '../../../docs/pro/js/theme-engine.js');
const txt = fs.readFileSync(SRC, 'utf8');
const lines = txt.split('\n');

const themes = [];
let cur = null, inColors = false;
const keyRe = /^    '([^']+)':\s*\{\s*$/;           // top-level theme key (4-space indent)
const nameRe = /^\s*name:\s*'([^']*)'/;
const catRe  = /^\s*category:\s*'([^']*)'/;
const lockRe = /^\s*locked:\s*(true|false)/;
const colorsOpen = /^\s*colors:\s*\{/;
const bgRe = /^\s*bg:\s*'([^']*)'/;
const accentRe = /^\s*accent:\s*'([^']*)'/;

for (const line of lines) {
  const k = line.match(keyRe);
  if (k) {
    if (cur) themes.push(cur);
    cur = { id: k[1], name: '', category: '', locked: false, bg: '', accent: '' };
    inColors = false;
    continue;
  }
  if (!cur) continue;
  if (colorsOpen.test(line)) { inColors = true; }
  let m;
  if ((m = line.match(nameRe)) && !cur.name) cur.name = m[1];
  if ((m = line.match(catRe)) && !cur.category) cur.category = m[1];
  if ((m = line.match(lockRe))) cur.locked = m[1] === 'true';
  if (inColors) {
    if ((m = line.match(bgRe)) && !cur.bg) cur.bg = m[1];
    if ((m = line.match(accentRe)) && !cur.accent) cur.accent = m[1];
  }
}
if (cur) themes.push(cur);

// de-dup safety (only top-level keys captured anyway)
const byCat = {};
themes.forEach(t => { byCat[t.category] = (byCat[t.category]||0)+1; });

fs.writeFileSync(path.resolve(__dirname, 'THEME-REGISTRY.json'), JSON.stringify(themes, null, 2));
console.log('total themes parsed:', themes.length);
console.log('locked:', themes.filter(t=>t.locked).map(t=>t.id).join(', '));
console.log('by category:', JSON.stringify(byCat));
console.log('first:', JSON.stringify(themes[0]));
console.log('any missing bg/accent:', themes.filter(t=>!t.bg||!t.accent).map(t=>t.id).join(', ') || 'none');
