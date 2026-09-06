/**
 * functions/esign-stamp.js — burn field values into a PDF, permanently.
 *
 * The pure half of the envelope signing system: source PDF bytes + a field
 * layout + the signer's values in, a flattened PDF out. No Firebase, no
 * network, no I/O — so it can be tested exhaustively without an emulator,
 * which is the whole reason it is a separate file from esign-envelope.js.
 *
 * ─── COORDINATE SPACE, AND WHY IT IS NOT NORMALISED ────────────────────
 * Fields carry PDF USER-SPACE coordinates: points, origin BOTTOM-LEFT, the
 * space pdf-lib draws in natively.
 *
 * The obvious alternative — normalised 0..1 fractions of the rendered page —
 * looks tidier and is a trap. The browser renders through a pdf.js viewport
 * that has already applied the page's /Rotate and /CropBox, so a fraction of
 * the *rendered* page is not a fraction of the *PDF* page whenever a page is
 * rotated (scanned insurance forms and manufacturer warranties very often
 * are) or cropped. Reconstructing that mapping server-side means
 * re-deriving four rotation cases by hand and getting all four right.
 *
 * pdf.js already exposes the exact inverse as `viewport.convertToPdfPoint()`.
 * So the placement UI converts at capture time and stores real PDF points,
 * and this module draws them with no transform at all. Rotation, crop and
 * zoom stop being our problem, and a field placed at 400% zoom on a rotated
 * page lands in the same spot as one placed at 50% on an upright one.
 *
 * "Flattened" here means the values are drawn into the page content stream —
 * not added as AcroForm widgets. There is nothing left to un-fill, re-edit,
 * or render differently in another viewer.
 */

'use strict';

const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');

/** Field types a signer can be asked to complete. */
const FIELD_TYPES = ['signature', 'initials', 'date', 'text', 'checkbox'];

/** Ink colour for typed values and check marks — near-black, never pure. */
const INK = rgb(0.10, 0.10, 0.18);

/**
 * Largest size at which `text` fits inside `w` x `h`, capped at `max`.
 * Returns a size >= 4 so a too-long value shrinks rather than vanishing;
 * callers clip to the box, so an overflowing value is visibly wrong instead
 * of silently absent.
 */
function fitFontSize(font, text, w, h, max) {
  let size = Math.min(max || 14, Math.max(4, h * 0.72));
  while (size > 4 && font.widthOfTextAtSize(text, size) > w) size -= 0.5;
  return size;
}

/**
 * Validate one field. Returns null when valid, else a reason string.
 * Exported (via validateFields) because BOTH the rep-side save and the
 * signer-side submit have to agree on what a legal field is, and a field
 * that passes save but fails submit would strand a signer mid-signing.
 */
function fieldError(f, pageCount) {
  if (!f || typeof f !== 'object') return 'not an object';
  if (typeof f.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(f.id)) return 'bad id';
  if (!FIELD_TYPES.includes(f.type)) return `unknown type ${f.type}`;
  if (!Number.isInteger(f.page) || f.page < 0 || f.page >= pageCount) return 'page out of range';
  for (const k of ['x', 'y', 'w', 'h']) {
    if (typeof f[k] !== 'number' || !Number.isFinite(f[k])) return `bad ${k}`;
  }
  if (f.w <= 0 || f.h <= 0) return 'zero-size box';
  // A field larger than any real page, or wildly off-page, is a placement
  // bug or a crafted payload; either way refuse it rather than draw it.
  if (f.w > 20000 || f.h > 20000) return 'box too large';
  if (f.x < -20000 || f.y < -20000 || f.x > 20000 || f.y > 20000) return 'origin off-page';
  if (f.role != null && (typeof f.role !== 'string' || f.role.length > 64)) return 'bad role';
  if (f.label != null && (typeof f.label !== 'string' || f.label.length > 200)) return 'bad label';
  return null;
}

/**
 * Validate a whole layout. Throws on the first problem, with the field id in
 * the message — a silent drop here would produce a document missing exactly
 * the signature somebody is relying on.
 */
function validateFields(fields, pageCount) {
  if (!Array.isArray(fields)) throw new Error('fields must be an array');
  if (fields.length > 200) throw new Error('too many fields (max 200)');
  const seen = new Set();
  for (const f of fields) {
    const err = fieldError(f, pageCount);
    if (err) throw new Error(`field ${(f && f.id) || '?'}: ${err}`);
    if (seen.has(f.id)) throw new Error(`duplicate field id ${f.id}`);
    seen.add(f.id);
  }
  return true;
}

/** Strip a data: URL prefix and decode. Returns a Buffer, or null. */
function decodePngDataUrl(s) {
  if (typeof s !== 'string') return null;
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(s.trim());
  if (!m) return null;
  try { return Buffer.from(m[1], 'base64'); } catch (_) { return null; }
}

/**
 * Draw `values` onto `pdfBytes` at the positions in `fields`.
 *
 * @param {Buffer|Uint8Array} pdfBytes  the ORIGINAL, unmodified source PDF
 * @param {Array}  fields               validated layout (PDF points)
 * @param {Object} values               fieldId -> { text?: string, png?: dataURL, checked?: bool }
 * @param {Object} [opts]
 * @param {string} [opts.certificateLine] a one-line audit stamp drawn in the
 *        bottom margin of every page. Omitted when falsy.
 * @returns {Promise<Uint8Array>} the flattened PDF
 */
async function stampPdf(pdfBytes, fields, values, opts) {
  const options = opts || {};
  const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: false });
  const pages = pdf.getPages();
  validateFields(fields, pages.length);

  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const missingRequired = [];

  for (const f of fields) {
    const page = pages[f.page];
    const v = (values && values[f.id]) || null;
    const box = { x: f.x, y: f.y, w: f.w, h: f.h };

    // A field the signer left blank. Required-ness is enforced by the
    // caller too, but recording it here keeps the pure module honest when
    // it is used directly (tests, future batch signing).
    const empty =
      !v ||
      (f.type === 'checkbox' ? v.checked !== true
        : f.type === 'signature' || f.type === 'initials' ? !v.png
        : !(typeof v.text === 'string' && v.text.trim()));
    if (empty) {
      if (f.required) missingRequired.push(f.id);
      continue;
    }

    if (f.type === 'signature' || f.type === 'initials') {
      const buf = decodePngDataUrl(v.png);
      if (!buf) { if (f.required) missingRequired.push(f.id); continue; }
      const img = await pdf.embedPng(buf);
      // Preserve aspect ratio inside the box and centre it. A signature
      // stretched to a box's exact proportions looks forged.
      const scale = Math.min(box.w / img.width, box.h / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      page.drawImage(img, {
        x: box.x + (box.w - dw) / 2,
        y: box.y + (box.h - dh) / 2,
        width: dw,
        height: dh,
      });
      continue;
    }

    if (f.type === 'checkbox') {
      // Drawn, not a font glyph: Helvetica has no check mark, and WinAnsi
      // encoding throws on U+2713 rather than substituting.
      const s = Math.min(box.w, box.h);
      const cx = box.x + (box.w - s) / 2;
      const cy = box.y + (box.h - s) / 2;
      const t = Math.max(1, s * 0.12);
      page.drawLine({
        start: { x: cx + s * 0.18, y: cy + s * 0.52 },
        end: { x: cx + s * 0.42, y: cy + s * 0.24 },
        thickness: t, color: INK,
      });
      page.drawLine({
        start: { x: cx + s * 0.42, y: cy + s * 0.24 },
        end: { x: cx + s * 0.84, y: cy + s * 0.78 },
        thickness: t, color: INK,
      });
      continue;
    }

    // date / text — drawn as real text so it stays selectable and searchable.
    const text = String(v.text).trim();
    const font = f.type === 'date' ? helv : helv;
    const size = fitFontSize(font, text, box.w, box.h, f.fontSize);
    // Baseline sits a little above the box bottom so descenders stay inside.
    page.drawText(text, {
      x: box.x + 1,
      y: box.y + Math.max(1, (box.h - size) / 2 + size * 0.18),
      size,
      font,
      color: INK,
      maxWidth: box.w,
    });
  }

  if (options.certificateLine) {
    const line = String(options.certificateLine).slice(0, 300);
    for (const page of pages) {
      const { width } = page.getSize();
      const size = 6;
      const w = helv.widthOfTextAtSize(line, size);
      page.drawText(line, {
        x: Math.max(4, (width - w) / 2),
        y: 6,
        size,
        font: helv,
        color: rgb(0.45, 0.45, 0.5),
      });
    }
  }

  // Deliberately NOT setting a producer/creator that claims more than we
  // know. Retain the source's own metadata.
  const out = await pdf.save({ useObjectStreams: true });
  return { bytes: out, missingRequired, pageCount: pages.length };
}

/** Page geometry the placement UI needs, without shipping the whole PDF twice. */
async function readPdfGeometry(pdfBytes) {
  const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: false });
  return pdf.getPages().map((p) => {
    const { width, height } = p.getSize();
    const rot = p.getRotation ? p.getRotation().angle : 0;
    return { w: width, h: height, rotation: ((rot % 360) + 360) % 360 };
  });
}

module.exports = {
  FIELD_TYPES,
  fieldError,
  validateFields,
  decodePngDataUrl,
  fitFontSize,
  stampPdf,
  readPdfGeometry,
};
