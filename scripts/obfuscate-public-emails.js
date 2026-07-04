#!/usr/bin/env node
/*
 * SEO-hardening 2026-07 (F6): entity-encode business email addresses on the
 * public marketing pages so naive scraper regexes (\S+@\S+\.\S+ over raw HTML)
 * stop matching them.
 *
 * What it does: for every *@nobigdealwithjoedeal.com address OUTSIDE <script>
 * blocks, the "@" becomes &#64; and the domain dots become &#46;. Browsers
 * decode character references in both attribute values and text nodes, so
 * mailto: links and the visible address render and work exactly as before —
 * zero JS, zero CSP surface, no visual change.
 *
 * What it deliberately does NOT touch:
 *  - <script type="application/ld+json"> blocks: character references are not
 *    decoded inside raw JSON, and the LocalBusiness "email" field is
 *    intentional structured data. (All <script> bodies are skipped; a prior
 *    audit found zero email addresses in non-JSON-LD scripts.)
 *  - pro/, admin/, dev/, tools/, sites/oaks (out of scope surfaces).
 *
 * Idempotent: already-encoded addresses no longer match the pattern.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'docs');

const EMAIL_RE = /([A-Za-z0-9._%+-]+)@nobigdealwithjoedeal\.com/g;

function encode(local) {
  return local + '&#64;nobigdealwithjoedeal&#46;com';
}

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
let total = 0;
for (const file of walk(ROOT)) {
  const orig = fs.readFileSync(file, 'utf8');
  // Split into script and non-script segments; only rewrite outside <script>.
  const parts = orig.split(/(<script\b[^>]*>[\s\S]*?<\/script>)/i);
  let count = 0;
  const next = parts
    .map((seg) => {
      if (/^<script\b/i.test(seg)) return seg;
      return seg.replace(EMAIL_RE, (m, local) => {
        count++;
        return encode(local);
      });
    })
    .join('');
  if (count > 0) {
    fs.writeFileSync(file, next);
    touched++;
    total += count;
  }
}
console.log(JSON.stringify({ filesTouched: touched, addressesEncoded: total }, null, 2));
