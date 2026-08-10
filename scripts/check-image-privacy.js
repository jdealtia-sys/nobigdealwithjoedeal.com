#!/usr/bin/env node
/**
 * check-image-privacy.js — CI gate for the EXIF/GPS-strip invariant.
 *
 * The rule (CLAUDE.md + runbooks/PUBLISH-PROJECT.md): photos ship to the
 * public site as EXIF-stripped copies. Originals are phone/CRM shots whose
 * EXIF pinpoints a CUSTOMER'S PROPERTY via GPS. prepare-project-images.mjs
 * strips on re-encode — but nothing verified the committed bytes, and on
 * 2026-08-10 three published gallery JPEGs were found carrying GPS IFDs
 * (two with full lat/lon values). This gate makes that class un-shippable.
 *
 * Policy:
 *   FAIL — any JPEG under docs/ whose EXIF contains a GPS IFD (tag 0x8825)
 *   FAIL — any JPEG under docs/assets/images/projects/ with ANY APP1
 *          metadata (EXIF or XMP): that dir is pipeline-owned, and the
 *          pipeline emits none
 *   FAIL — any WebP under docs/ with an EXIF or XMP chunk
 *   PASS — camera EXIF without GPS outside the projects dir (e.g. the
 *          lumanail product-pack shots) — benign, deliberate, listed only
 *          with --verbose
 *
 * --fix  losslessly strips APP1 segments from offending JPEGs (and EXIF/XMP
 *        chunks from offending WebPs) IN PLACE — pure byte surgery, pixel
 *        data untouched, no re-encode, no quality loss. Safe only when the
 *        EXIF orientation tag is absent or 1 (normal); --fix refuses
 *        otherwise so a rotated photo can't silently flip on the site
 *        (run those through prepare-project-images.mjs instead).
 *
 * Zero dependencies. Usage:
 *   node scripts/check-image-privacy.js [--fix] [--verbose]
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(REPO_ROOT, 'docs');
const PROJECTS_DIR = path.join(DOCS, 'assets', 'images', 'projects');

const FIX = process.argv.includes('--fix');
const VERBOSE = process.argv.includes('--verbose');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// ── JPEG: iterate markers; report APP1 segments + GPS IFD + orientation. ──
function inspectJpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const app1 = []; // {start, len (incl marker+size bytes), isExif, hasGps, orientation}
  let i = 2;
  while (i < buf.length - 4) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xda) break; // start of scan — metadata lives before it
    const segLen = buf.readUInt16BE(i + 2);
    if (marker === 0xe1) {
      const seg = buf.subarray(i + 4, i + 2 + segLen);
      const isExif = seg.subarray(0, 6).equals(Buffer.from('Exif\0\0'));
      let hasGps = false, orientation = null;
      if (isExif && seg.length > 14) {
        const tiff = seg.subarray(6);
        const le = tiff[0] === 0x49; // 'II' little-endian
        const rd16 = (o) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
        const rd32 = (o) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
        try {
          const ifd = rd32(4);
          const n = rd16(ifd);
          for (let k = 0; k < n; k++) {
            const e = ifd + 2 + k * 12;
            const tag = rd16(e);
            if (tag === 0x8825) hasGps = true;
            if (tag === 0x0112) orientation = rd16(e + 8);
          }
        } catch (_) { /* truncated TIFF — treat as metadata present, no GPS proof */ }
      }
      app1.push({ start: i, len: 2 + segLen, isExif, hasGps, orientation });
    }
    i += 2 + segLen;
  }
  return app1;
}

function stripJpegApp1(buf, app1) {
  const parts = [];
  let pos = 0;
  for (const seg of app1) {
    parts.push(buf.subarray(pos, seg.start));
    pos = seg.start + seg.len;
  }
  parts.push(buf.subarray(pos));
  return Buffer.concat(parts);
}

// ── WebP: RIFF chunk walk; EXIF/XMP chunks are metadata. ──
function inspectWebp(buf) {
  if (buf.length < 16 || buf.subarray(0, 4).toString() !== 'RIFF' || buf.subarray(8, 12).toString() !== 'WEBP') return null;
  const meta = []; // {start, len (incl header+pad)}
  let i = 12;
  while (i < buf.length - 8) {
    const id = buf.subarray(i, i + 4).toString('latin1');
    const sz = buf.readUInt32LE(i + 4);
    const total = 8 + sz + (sz & 1);
    if (id === 'EXIF' || id === 'XMP ') meta.push({ start: i, len: total, id: id.trim() });
    i += total;
  }
  return meta;
}

function stripWebpChunks(buf, meta) {
  const parts = [];
  let pos = 0;
  for (const c of meta) {
    parts.push(buf.subarray(pos, c.start));
    pos = c.start + c.len;
  }
  parts.push(buf.subarray(pos));
  const out = Buffer.concat(parts);
  out.writeUInt32LE(out.length - 8, 4); // RIFF size = file minus 8-byte header
  return out;
}

const failures = [];
const benign = [];
let fixed = 0, scanned = 0;

for (const file of walk(DOCS)) {
  const ext = path.extname(file).toLowerCase();
  const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
  const inProjects = file.startsWith(PROJECTS_DIR + path.sep);

  if (ext === '.jpg' || ext === '.jpeg') {
    scanned++;
    const buf = fs.readFileSync(file);
    const app1 = inspectJpeg(buf);
    if (!app1 || !app1.length) continue;
    const hasGps = app1.some((s) => s.hasGps);
    const bad = hasGps || inProjects;
    if (!bad) { benign.push(rel); continue; }
    const why = hasGps ? 'EXIF GPS IFD (customer-property location!)' : 'APP1 metadata in the pipeline-owned projects dir';
    if (FIX) {
      const rotated = app1.some((s) => s.orientation != null && s.orientation !== 1);
      if (rotated) {
        failures.push(`${rel}: ${why} — NOT auto-fixed: EXIF orientation != 1; re-run through prepare-project-images.mjs`);
        continue;
      }
      fs.writeFileSync(file, stripJpegApp1(buf, app1));
      fixed++;
      console.log(`fixed: ${rel} — stripped ${app1.length} APP1 segment(s) (${why})`);
    } else {
      failures.push(`${rel}: ${why}`);
    }
  } else if (ext === '.webp') {
    scanned++;
    const buf = fs.readFileSync(file);
    const meta = inspectWebp(buf);
    if (!meta || !meta.length) continue;
    const why = 'WebP ' + meta.map((c) => c.id).join('+') + ' metadata chunk(s)';
    if (FIX) {
      fs.writeFileSync(file, stripWebpChunks(buf, meta));
      fixed++;
      console.log(`fixed: ${rel} — stripped ${why}`);
    } else {
      failures.push(`${rel}: ${why}`);
    }
  }
}

if (VERBOSE && benign.length) {
  console.log(`benign camera EXIF (no GPS, outside projects dir) — accepted:\n  ${benign.join('\n  ')}`);
}

if (failures.length) {
  for (const f of failures) console.error(`✗ ${f}`);
  console.error(`
Published images must carry no location metadata (CLAUDE.md invariant;
runbooks/PUBLISH-PROJECT.md). Fix with:
  node scripts/check-image-privacy.js --fix        (lossless strip in place)
or re-encode originals via scripts/prepare-project-images.mjs.`);
  process.exit(1);
}
console.log(`check-image-privacy: ${scanned} image(s) scanned — ${FIX ? `${fixed} fixed, ` : ''}0 privacy failures${benign.length ? ` (${benign.length} benign camera-EXIF accepted)` : ''}.`);
