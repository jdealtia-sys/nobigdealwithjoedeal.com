#!/usr/bin/env node
/*
 * Three blog posts have a bare `:root { ... }` immediately after `</script>`
 * with no `<style>` opening tag. All their native CSS is unparseable. Add the
 * opening tag.
 */
const fs = require('fs');
const path = require('path');

const TARGETS = [
  'docs/blog/does-homeowner-insurance-cover-hail-damage-ohio.html',
  'docs/blog/how-to-file-storm-damage-insurance-claim-ohio.html',
  'docs/blog/what-to-expect-roof-insurance-adjuster-visit.html',
];

const ROOT = path.resolve(__dirname, '..');
let touched = 0;
for (const rel of TARGETS) {
  const file = path.join(ROOT, rel);
  const orig = fs.readFileSync(file, 'utf8');
  // Add <style> right before the bare `:root {` that follows `</script>`.
  const re = /(<\/script>\s*\n)(:root\s*\{)/;
  if (!re.test(orig)) continue;
  const next = orig.replace(re, '$1<style>\n$2');
  if (next !== orig) { fs.writeFileSync(file, next); touched++; }
}
console.log(JSON.stringify({ touched }, null, 2));
