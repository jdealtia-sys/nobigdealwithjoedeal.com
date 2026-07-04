#!/usr/bin/env node
/*
 * A11y/UX 2026-07 (T4g): make the announcement-bar phone number tappable.
 *
 * Most pages carry an .ann-slide whose .ann-text reads "Free Roof Inspections
 * — Call or Text Joe: (859) 420-7382" but the number is plain text — on mobile
 * you can't tap it to dial. Wrap that <span class="ann-text"> in
 * <a href="tel:8594207382" style="color:inherit;text-decoration:none">.
 * ann-bar.js swaps textContent on the .ann-text span itself, so wrapping the
 * span does not break the short/long swap.
 *
 * Skips spans already inside a tel: anchor (idempotent) and slides that are
 * already wrapped in an <a> for another destination.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'docs');
const TEL_OPEN = '<a href="tel:8594207382" style="color:inherit;text-decoration:none">';

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // pro/admin = CRM app (out of scope); dev = not deployed; tools = private
      // utilities; sites/oaks = private customer template with its own brand.
      if (['pro', 'admin', 'dev', 'tools', 'assets', 'deploy'].includes(entry.name)) continue;
      if (full.endsWith(path.join('sites', 'oaks'))) continue;
      walk(full, out);
    } else if (entry.name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

// The phone span: <span class="ann-text" data-long="...(859) 420-7382..." ...>...</span>
const RE = /<span class="ann-text"[^>]*data-long="[^"]*\(859\) 420-7382[^"]*"[^>]*>[^<]*<\/span>/g;

let touched = 0;
let total = 0;
for (const file of walk(ROOT)) {
  const orig = fs.readFileSync(file, 'utf8');
  if (!RE.test(orig)) { RE.lastIndex = 0; continue; }
  RE.lastIndex = 0;
  let count = 0;
  const next = orig.replace(RE, (m, offset) => {
    // Already inside an <a>? Between the slide open tag and the span, an
    // unbalanced <a ...> means the whole slide is a link — skip it.
    const before = orig.slice(Math.max(0, offset - 800), offset);
    const slideStart = before.lastIndexOf('ann-slide');
    const sinceSlide = slideStart === -1 ? before : before.slice(slideStart);
    const opens = (sinceSlide.match(/<a[\s>]/g) || []).length;
    const closes = (sinceSlide.match(/<\/a>/g) || []).length;
    if (opens > closes) return m;
    count++;
    return TEL_OPEN + m + '</a>';
  });
  if (count > 0) {
    fs.writeFileSync(file, next);
    touched++;
    total += count;
  }
}
console.log(JSON.stringify({ filesTouched: touched, spansWrapped: total }, null, 2));
