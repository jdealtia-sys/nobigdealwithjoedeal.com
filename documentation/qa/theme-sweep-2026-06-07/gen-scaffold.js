#!/usr/bin/env node
// Phase-0 helper: generate THEME-MATRIX.md skeleton + per-category screenshot folders
// + empty BUG-LOG / PATTERNS / RESTORE from THEME-REGISTRY.json. Idempotent for the matrix
// only if it does not yet exist (won't clobber scored data).
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const reg = JSON.parse(fs.readFileSync(path.join(DIR, 'THEME-REGISTRY.json'), 'utf8'));

// sweep order: simplest/lowest-chroma palettes first, richest identity last
const ORDER = ['professional','construction','nature','seasonal','luxury','mood','scifi','sports','popculture','anime','cartoon','achievement'];
const LABEL = {professional:'Professional',construction:'Construction & Trade',nature:'Nature & Elements',seasonal:'Seasonal',luxury:'Luxury & Premium',mood:'Mood & Aesthetic',scifi:'Sci-Fi & Cyber',sports:'Sports & Energy',popculture:'Pop Culture',anime:'Anime',cartoon:'Cartoon',achievement:'Achievements'};

// folders
const shotsRoot = path.join(DIR, 'screenshots');
if (!fs.existsSync(shotsRoot)) fs.mkdirSync(shotsRoot);
ORDER.forEach(c => { const p = path.join(shotsRoot, c); if (!fs.existsSync(p)) fs.mkdirSync(p); });

// matrix
const matrixPath = path.join(DIR, 'THEME-MATRIX.md');
if (fs.existsSync(matrixPath)) { console.log('THEME-MATRIX.md exists — leaving as-is (no clobber).'); }
else {
  let md = `# Theme Status Matrix — 2026-06-07 (full live sweep, 186 themes × light+dark)\n\n`;
  md += `Status legend: **PASS** · **LEGIBILITY-FAIL** (on-identity but unreadable) · **IDENTITY-FAIL** (readable but generic/overridden/partial) · **PARTIAL** · **DEAD** · **LOCKED**.\n`;
  md += `Axis A = usability/legibility. Axis B = identity fidelity. Scored per mode. Evidence = screenshot path under \`screenshots/<category>/\`.\n\n`;
  let n = 0;
  ORDER.forEach(cat => {
    const rows = reg.filter(t => t.category === cat);
    if (!rows.length) return;
    md += `## ${LABEL[cat]||cat} (${rows.length})\n\n`;
    md += `| # | id | name | ref bg | ref accent | Light A | Light B | Dark A | Dark B | Status | Notes |\n`;
    md += `|---|---|---|---|---|---|---|---|---|---|---|\n`;
    rows.forEach(t => {
      n++;
      const lk = t.locked ? ' 🔒' : '';
      md += `| ${n} | \`${t.id}\`${lk} | ${t.name} | \`${t.bg}\` | \`${t.accent}\` | | | | | | |\n`;
    });
    md += `\n`;
  });
  fs.writeFileSync(matrixPath, md);
  console.log('wrote THEME-MATRIX.md with', n, 'rows');
}

// empty logs (don't clobber)
const stub = (p, body) => { if (!fs.existsSync(p)) { fs.writeFileSync(p, body); console.log('wrote', path.basename(p)); } else console.log(path.basename(p),'exists — kept'); };
stub(path.join(DIR,'BUG-LOG.md'), `# Theme Sweep — Bug Log (2026-06-07)\n\nRanked. Each: theme/mode, axis, exact illegible combo OR identity drift, CSS variable responsible, overriding dialect (if any), screenshot.\n\n_(empty until Phase 1)_\n`);
stub(path.join(DIR,'PATTERNS.md'), `# Theme Sweep — Systemic Patterns (2026-06-07)\n\nCross-theme findings (not per-theme). Verdict: per-theme fix vs one structural change.\n\n_(empty until Phase 2)_\n`);
stub(path.join(DIR,'RESTORE.md'), `# Theme Sweep — Restore Record (2026-06-07)\n\n## Pre-sweep baseline (from live localStorage, unauthenticated read)\n- nbd_pro_theme = nbd-original\n- nbd-theme = nbd-original\n- nbd_pro_mode_pref = dark\n- nbd_font = null (engine default)\n- ds-theme = nbd-original\n\n## Authoritative baseline (Firestore userSettings/{uid}) — PENDING login handoff\n_(to be recorded once Jo logs in)_\n\n## Post-sweep restore — PENDING\n_(to be confirmed at end of run)_\n`);
console.log('scaffold done.');
