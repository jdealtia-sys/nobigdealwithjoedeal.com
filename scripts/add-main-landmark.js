#!/usr/bin/env node
/*
 * Follow-up 2026-07 (#3): add the missing <main> landmark to public pages
 * (Lighthouse a11y "landmark-one-main"; screen-reader users jump straight to
 * page content with it).
 *
 * Mechanics: wrap everything between the first </nav> and the first <footer
 * in <main> ... </main>. Safe here because (a) a repo-wide grep found zero
 * `body >` child selectors that a new wrapper could break, (b) <main> is an
 * unstyled block element, and (c) only pages with exactly one nav and one
 * footer are touched. Pages that already carry <main>/role="main" (index,
 * blog/index) are skipped, as are 404/offline/utility pages without the
 * standard nav+footer frame.
 *
 * Idempotent: pages gain the landmark once and are skipped afterwards.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'docs');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['pro', 'admin', 'dev', 'tools', 'assets', 'deploy'].includes(entry.name)) continue;
      if (full.endsWith(path.join('sites', 'oaks'))) continue;
      walk(full, out);
    } else if (entry.name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

let touched = 0;
let skipped = 0;
for (const file of walk(ROOT)) {
  const s = fs.readFileSync(file, 'utf8');
  if (/<main\b|role="main"/.test(s)) { skipped++; continue; }
  const navs = (s.match(/<\/nav>/g) || []).length;
  const footers = (s.match(/<footer\b/g) || []).length;
  if (navs !== 1 || footers !== 1) { skipped++; continue; }
  const navEnd = s.indexOf('</nav>') + '</nav>'.length;
  const footerStart = s.indexOf('<footer');
  if (footerStart < navEnd) { skipped++; continue; }
  const next =
    s.slice(0, navEnd) + '\n<main>' +
    s.slice(navEnd, footerStart) + '</main>\n' +
    s.slice(footerStart);
  fs.writeFileSync(file, next);
  touched++;
}
console.log(JSON.stringify({ touched, skipped }));
