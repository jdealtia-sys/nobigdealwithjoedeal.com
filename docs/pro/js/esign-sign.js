/**
 * esign-sign.js — the homeowner's signing surface for /pro/esign.html.
 *
 * No Firebase auth: the only credential is ?t=<token>, validated server-side
 * by getEsignEnvelope / submitEsignEnvelope (functions/esign-envelope.js).
 *
 * WHAT THIS DOES THAT THE OLD sign.html COULD NOT
 *  - Renders a real PDF with pdf.js and lets the signer PAN and ZOOM. The old
 *    page set user-scalable=no and dropped a whole contract into a fixed
 *    iframe, so a dense document on a phone was unreadable and un-zoomable.
 *    Zoom re-renders the canvas at the new scale rather than scaling a
 *    bitmap, so text stays sharp at 300%.
 *  - Supports five field types, placed by the rep, instead of one hardcoded
 *    signature box: signature, initials, date, text, checkbox.
 *  - Walks the signer through the fields ("Next") instead of leaving them to
 *    hunt for what is still blank on page 7.
 *  - Records consent to sign electronically. Nothing in the old flow did.
 *
 * COORDINATES: fields arrive in PDF user space (points, origin bottom-left).
 * Overlay positions come from viewport.convertToViewportPoint, the exact
 * inverse of what the placement UI used. See functions/esign-stamp.js for why
 * that, and not normalised fractions, is the contract.
 *
 * SIGNATURE PNGs ARE TRANSPARENT. The older widget baked a white background
 * into every signature, which is invisible on white HTML but lands as an
 * opaque white sticker when stamped onto a PDF form.
 */

import * as pdfjsLib from '/assets/vendor/pdfjs/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/vendor/pdfjs/pdf.worker.min.mjs';

const FN_BASE = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
  ? 'http://127.0.0.1:5001/nobigdeal-pro/us-central1'
  : 'https://us-central1-nobigdeal-pro.cloudfunctions.net';

const $ = (id) => document.getElementById(id);
const token = new URLSearchParams(location.search).get('t') || '';

const el = {
  brand: $('esBrand'), title: $('esTitle'), zoomCtl: $('esZoomCtl'),
  zoomIn: $('esZoomIn'), zoomOut: $('esZoomOut'), zoomFit: $('esZoomFit'), zoomPct: $('esZoomPct'),
  scroll: $('esScroll'), doc: $('esDoc'),
  msg: $('esMsg'), msgIcon: $('esMsgIcon'), msgTitle: $('esMsgTitle'), msgBody: $('esMsgBody'),
  foot: $('esFoot'), next: $('esNext'), progress: $('esProgress'), finish: $('esFinish'),
  sheet: $('esSheet'), sheetTitle: $('esSheetTitle'), sheetClose: $('esSheetClose'),
  tabs: $('esTabs'), padWrap: $('esPadWrap'), pad: $('esPad'), padHint: $('esPadHint'),
  typeWrap: $('esTypeWrap'), typeInput: $('esTypeInput'), typePreview: $('esTypePreview'),
  textWrap: $('esTextWrap'), textInput: $('esTextInput'),
  undo: $('esUndo'), clear: $('esClear'), apply: $('esApply'),
  done: $('esDone'), doneClose: $('esDoneClose'), doneBack: $('esDoneBack'),
  consent: $('esConsent'), consentText: $('esConsentText'), signerName: $('esSignerName'),
  submit: $('esSubmit'), doneErr: $('esDoneErr'),
};

let pdfDoc = null;
let envelope = null;      // { title, fields, pages, signerName, companyName }
let scale = 1;
let fitScale = 1;
const values = Object.create(null);   // fieldId -> { png } | { text } | { checked }
const pageViews = [];                 // [{ pageNum, canvas, layer, viewport }]
let activeField = null;
let submitting = false;

/* ── messaging ─────────────────────────────────────────────────────────── */
function showMsg(icon, title, body) {
  el.msgIcon.textContent = icon;
  el.msgTitle.textContent = title;
  el.msgBody.textContent = body;
  el.msg.hidden = false;
  el.msg.style.display = 'flex';
}
function hideMsg() { el.msg.style.display = 'none'; }

async function post(path, body) {
  const res = await fetch(`${FN_BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* non-JSON error body */ }
  return { ok: res.ok, status: res.status, data: data || {} };
}

/* ── geometry ──────────────────────────────────────────────────────────── */
/** PDF-space box -> viewport rect, correct under any page rotation. */
function boxToViewRect(viewport, f) {
  const a = viewport.convertToViewportPoint(f.x, f.y);
  const b = viewport.convertToViewportPoint(f.x + f.w, f.y + f.h);
  const x0 = Math.min(a[0], b[0]);
  const x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const y1 = Math.max(a[1], b[1]);
  return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
}

const isInk = (f) => f.type === 'signature' || f.type === 'initials';
const isDone = (f) => {
  const v = values[f.id];
  if (!v) return false;
  if (f.type === 'checkbox') return v.checked === true;
  if (isInk(f)) return !!v.png;
  return typeof v.text === 'string' && v.text.trim() !== '';
};
const requiredFields = () => (envelope.fields || []).filter((f) => f.required !== false);
const remaining = () => requiredFields().filter((f) => !isDone(f));

function updateProgress() {
  const req = requiredFields();
  const done = req.filter(isDone).length;
  el.progress.textContent = `${done} of ${req.length}`;
  el.finish.disabled = done < req.length;
  el.next.textContent = remaining().length ? 'Next field' : 'All set';
  el.next.disabled = remaining().length === 0;
}

/* ── rendering ─────────────────────────────────────────────────────────── */
async function renderAll() {
  el.doc.textContent = '';
  pageViews.length = 0;

  for (let n = 1; n <= pdfDoc.numPages; n++) {
    const page = await pdfDoc.getPage(n);
    const viewport = page.getViewport({ scale });

    const wrap = document.createElement('div');
    wrap.className = 'es-page';
    wrap.style.width = `${Math.floor(viewport.width)}px`;
    wrap.style.height = `${Math.floor(viewport.height)}px`;

    const canvas = document.createElement('canvas');
    // Render at device pixel ratio so the page is sharp on a phone, but lay
    // it out at CSS size so field overlays share one coordinate space.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const ctx = canvas.getContext('2d');
    wrap.appendChild(canvas);

    const layer = document.createElement('div');
    layer.className = 'es-layer';
    wrap.appendChild(layer);
    el.doc.appendChild(wrap);

    await page.render({
      canvasContext: ctx,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
    }).promise;

    pageViews.push({ pageNum: n, canvas, layer, viewport });
  }
  placeFields();
  el.zoomPct.textContent = `${Math.round((scale / fitScale) * 100)}%`;
}

function placeFields() {
  for (const pv of pageViews) pv.layer.textContent = '';
  for (const f of envelope.fields || []) {
    const pv = pageViews[f.page];
    if (!pv) continue;
    const r = boxToViewRect(pv.viewport, f);

    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'es-field' + (f.required === false ? ' is-optional' : '');
    b.style.left = `${r.left}px`;
    b.style.top = `${r.top}px`;
    b.style.width = `${r.width}px`;
    b.style.height = `${r.height}px`;
    b.dataset.fieldId = f.id;
    b.setAttribute('aria-label', `${f.label || f.type} — ${f.required === false ? 'optional' : 'required'}`);
    // Scale the hint text with the box so it stays legible when zoomed out.
    b.style.fontSize = `${Math.max(8, Math.min(13, r.height * 0.42))}px`;
    paintField(b, f);
    b.addEventListener('click', () => openField(f));
    pv.layer.appendChild(b);
  }
  updateProgress();
}

function paintField(node, f) {
  const v = values[f.id];
  node.textContent = '';
  node.classList.toggle('is-done', isDone(f));

  if (isInk(f) && v && v.png) {
    const img = document.createElement('img');
    img.src = v.png;
    img.alt = f.label || 'signature';
    node.appendChild(img);
    return;
  }
  if (f.type === 'checkbox') {
    // A checkbox box is often ~18pt. Any word crammed into it renders as an
    // illegible smudge, so an unchecked box stays EMPTY — the dashed outline
    // is the affordance — and only the tick is ever drawn.
    if (v && v.checked) {
      const s = document.createElement('span');
      s.className = 'es-tick';
      s.textContent = '✓';
      node.appendChild(s);
    }
    return;
  }
  if (!isInk(f) && v && typeof v.text === 'string' && v.text.trim()) {
    const s = document.createElement('span');
    s.className = 'es-val';
    s.textContent = v.text;
    node.appendChild(s);
    return;
  }
  node.textContent = f.label || (
    f.type === 'signature' ? 'Sign' :
    f.type === 'initials' ? 'Initials' :
    f.type === 'date' ? 'Date' : 'Tap'
  );
}

function repaint(f) {
  const node = document.querySelector(`.es-field[data-field-id="${CSS.escape(f.id)}"]`);
  if (node) paintField(node, f);
  updateProgress();
}

/* ── zoom ──────────────────────────────────────────────────────────────── */
let rerenderTimer = null;
function setScale(next) {
  const clamped = Math.max(fitScale * 0.5, Math.min(fitScale * 4, next));
  if (Math.abs(clamped - scale) < 0.001) return;
  scale = clamped;
  el.zoomPct.textContent = `${Math.round((scale / fitScale) * 100)}%`;
  clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(() => { renderAll().catch(reportRenderError); }, 90);
}

function computeFitScale(firstPage) {
  const avail = el.scroll.clientWidth - 24;
  const base = firstPage.getViewport({ scale: 1 });
  return Math.max(0.2, Math.min(3, avail / base.width));
}

/* Two-finger pinch. The scroll container keeps native one-finger panning. */
const pointers = new Map();
let pinchStart = 0;
let pinchScale0 = 1;
el.scroll.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  pointers.set(e.pointerId, e);
  if (pointers.size === 2) {
    const [p, q] = [...pointers.values()];
    pinchStart = Math.hypot(p.clientX - q.clientX, p.clientY - q.clientY);
    pinchScale0 = scale;
  }
});
el.scroll.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, e);
  if (pointers.size !== 2 || !pinchStart) return;
  e.preventDefault();
  const [p, q] = [...pointers.values()];
  const d = Math.hypot(p.clientX - q.clientX, p.clientY - q.clientY);
  setScale(pinchScale0 * (d / pinchStart));
}, { passive: false });
const dropPointer = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinchStart = 0; };
el.scroll.addEventListener('pointerup', dropPointer);
el.scroll.addEventListener('pointercancel', dropPointer);

el.zoomIn.addEventListener('click', () => setScale(scale * 1.25));
el.zoomOut.addEventListener('click', () => setScale(scale / 1.25));
el.zoomFit.addEventListener('click', () => setScale(fitScale));

/* ── signature pad (transparent output) ────────────────────────────────── */
const pad = {
  ctx: null, strokes: [], current: null, w: 0, h: 0, dpr: 1,
  init() {
    const c = el.pad;
    const rect = c.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(rect.width, 1);
    this.h = Math.max(rect.height, 1);
    c.width = Math.round(this.w * this.dpr);
    c.height = Math.round(this.h * this.dpr);
    this.ctx = c.getContext('2d');
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.lineWidth = 2.4;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.strokeStyle = '#12121e';
    this.strokes = [];
    this.current = null;
    el.padHint.classList.remove('hide');
  },
  pos(e) {
    const r = el.pad.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  },
  down(e) {
    e.preventDefault();
    try { el.pad.setPointerCapture(e.pointerId); } catch (_) {}
    this.current = [this.pos(e)];
    el.padHint.classList.add('hide');
  },
  move(e) {
    if (!this.current) return;
    e.preventDefault();
    const p = this.pos(e);
    const last = this.current[this.current.length - 1];
    this.current.push(p);
    this.ctx.beginPath();
    this.ctx.moveTo(last.x, last.y);
    this.ctx.lineTo(p.x, p.y);
    this.ctx.stroke();
  },
  up() {
    if (!this.current) return;
    if (this.current.length > 1) this.strokes.push(this.current);
    this.current = null;
    syncApply();
  },
  redraw() {
    this.ctx.clearRect(0, 0, this.w, this.h);
    for (const s of this.strokes) {
      if (s.length < 2) continue;
      this.ctx.beginPath();
      this.ctx.moveTo(s[0].x, s[0].y);
      for (let i = 1; i < s.length; i++) this.ctx.lineTo(s[i].x, s[i].y);
      this.ctx.stroke();
    }
    el.padHint.classList.toggle('hide', this.strokes.length > 0);
  },
  isEmpty() { return this.strokes.length === 0; },
  /**
   * Trim to the drawn ink and export a TRANSPARENT PNG. Trimming matters:
   * an untrimmed pad is mostly empty space, and the stamper fits the image
   * to its box — so an untrimmed signature renders tiny and floating.
   */
  toPNG() {
    if (this.isEmpty()) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of this.strokes) for (const p of s) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    const m = 6;
    minX = Math.max(0, minX - m); minY = Math.max(0, minY - m);
    maxX = Math.min(this.w, maxX + m); maxY = Math.min(this.h, maxY + m);
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    const out = document.createElement('canvas');
    out.width = Math.round(w * this.dpr);
    out.height = Math.round(h * this.dpr);
    const o = out.getContext('2d');
    o.drawImage(el.pad,
      Math.round(minX * this.dpr), Math.round(minY * this.dpr),
      Math.round(w * this.dpr), Math.round(h * this.dpr),
      0, 0, Math.round(w * this.dpr), Math.round(h * this.dpr));
    return out.toDataURL('image/png');
  },
};
el.pad.addEventListener('pointerdown', (e) => pad.down(e));
el.pad.addEventListener('pointermove', (e) => pad.move(e));
el.pad.addEventListener('pointerup', () => pad.up());
el.pad.addEventListener('pointercancel', () => pad.up());
el.pad.addEventListener('pointerleave', () => pad.up());

/** Render typed text to a transparent PNG so typed and drawn take one path. */
function typedToPNG(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const dpr = 2;
  const font = '44px "Segoe Script", "Brush Script MT", cursive';
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const w = Math.max(20, Math.ceil(probe.measureText(t).width) + 16);
  const h = 68;
  const c = document.createElement('canvas');
  c.width = w * dpr; c.height = h * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.font = font;
  ctx.fillStyle = '#12121e';
  ctx.textBaseline = 'middle';
  ctx.fillText(t, 8, h / 2);
  return c.toDataURL('image/png');
}

/* ── field entry sheet ─────────────────────────────────────────────────── */
let sheetMode = 'draw';

function setSheetMode(mode) {
  sheetMode = mode;
  for (const b of el.tabs.querySelectorAll('button')) b.classList.toggle('on', b.dataset.mode === mode);
  el.padWrap.hidden = mode !== 'draw';
  el.typeWrap.hidden = mode !== 'type';
  if (mode === 'draw') requestAnimationFrame(() => { pad.init(); pad.redraw(); });
  syncApply();
}

function syncApply() {
  if (!activeField) return;
  let ready;
  if (isInk(activeField)) {
    ready = sheetMode === 'draw' ? !pad.isEmpty() : !!el.typeInput.value.trim();
  } else {
    ready = !!el.textInput.value.trim();
  }
  el.apply.disabled = !ready;
}

function openField(f) {
  activeField = f;
  document.querySelectorAll('.es-field.is-target').forEach((n) => n.classList.remove('is-target'));
  const node = document.querySelector(`.es-field[data-field-id="${CSS.escape(f.id)}"]`);
  if (node) node.classList.add('is-target');

  // A checkbox needs no sheet — toggling in place is one tap instead of three.
  if (f.type === 'checkbox') {
    values[f.id] = { checked: !(values[f.id] && values[f.id].checked) };
    repaint(f);
    activeField = null;
    return;
  }

  const ink = isInk(f);
  el.sheetTitle.textContent = f.label || (
    f.type === 'signature' ? 'Sign here' :
    f.type === 'initials' ? 'Your initials' :
    f.type === 'date' ? 'Date' : 'Enter text'
  );
  el.tabs.hidden = !ink;
  el.padWrap.hidden = !ink;
  el.typeWrap.hidden = true;
  el.textWrap.hidden = ink;
  el.undo.hidden = !ink;
  el.clear.hidden = !ink;

  const existing = values[f.id];
  if (ink) {
    el.typeInput.value = '';
    el.typePreview.textContent = '';
    setSheetMode('draw');
  } else {
    el.textInput.placeholder = f.type === 'date' ? 'MM/DD/YYYY' : (f.label || 'Type here');
    // Dates default to today — the overwhelmingly common answer.
    el.textInput.value = (existing && existing.text)
      || (f.type === 'date' ? new Date().toLocaleDateString('en-US') : '');
  }

  el.sheet.hidden = false;
  el.apply.disabled = true;
  syncApply();
  if (!ink) setTimeout(() => el.textInput.focus(), 60);
}

function closeSheet() {
  el.sheet.hidden = true;
  activeField = null;
  document.querySelectorAll('.es-field.is-target').forEach((n) => n.classList.remove('is-target'));
}

el.sheetClose.addEventListener('click', closeSheet);
el.sheet.addEventListener('click', (e) => { if (e.target === el.sheet) closeSheet(); });
el.tabs.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mode]');
  if (b) setSheetMode(b.dataset.mode);
});
el.undo.addEventListener('click', () => { pad.strokes.pop(); pad.redraw(); syncApply(); });
el.clear.addEventListener('click', () => { pad.strokes = []; pad.redraw(); syncApply(); });
el.typeInput.addEventListener('input', () => { el.typePreview.textContent = el.typeInput.value; syncApply(); });
el.textInput.addEventListener('input', syncApply);
el.textInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !el.apply.disabled) el.apply.click(); });

el.apply.addEventListener('click', () => {
  const f = activeField;
  if (!f) return;
  if (isInk(f)) {
    const png = sheetMode === 'draw' ? pad.toPNG() : typedToPNG(el.typeInput.value);
    if (!png) return;
    values[f.id] = { png };
  } else {
    const text = el.textInput.value.trim();
    if (!text) return;
    values[f.id] = { text };
  }
  repaint(f);
  closeSheet();
  // Walk them straight to whatever is still blank.
  const nxt = remaining()[0];
  if (nxt) scrollToField(nxt);
});

/* ── navigation ────────────────────────────────────────────────────────── */
function scrollToField(f) {
  const node = document.querySelector(`.es-field[data-field-id="${CSS.escape(f.id)}"]`);
  if (!node) return;
  node.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  document.querySelectorAll('.es-field.is-target').forEach((n) => n.classList.remove('is-target'));
  node.classList.add('is-target');
}
el.next.addEventListener('click', () => {
  const nxt = remaining()[0];
  if (nxt) { scrollToField(nxt); setTimeout(() => openField(nxt), 320); }
});

/* ── finish ────────────────────────────────────────────────────────────── */
el.finish.addEventListener('click', () => {
  el.doneErr.hidden = true;
  el.signerName.value = el.signerName.value || envelope.signerName || '';
  el.done.hidden = false;
  syncSubmit();
});
el.doneClose.addEventListener('click', () => { el.done.hidden = true; });
el.doneBack.addEventListener('click', () => { el.done.hidden = true; });
el.done.addEventListener('click', (e) => { if (e.target === el.done) el.done.hidden = true; });

function syncSubmit() {
  el.submit.disabled = !(el.consent.checked && el.signerName.value.trim().length >= 2);
}
el.consent.addEventListener('change', syncSubmit);
el.signerName.addEventListener('input', syncSubmit);

el.submit.addEventListener('click', async () => {
  if (submitting) return;
  submitting = true;
  el.submit.disabled = true;
  const original = el.submit.textContent;
  el.submit.textContent = 'Submitting…';
  el.doneErr.hidden = true;

  const r = await post('submitEsignEnvelope', {
    token,
    values,
    consent: el.consent.checked === true,
    signerName: el.signerName.value.trim(),
  }).catch(() => ({ ok: false, status: 0, data: {} }));

  if (r.ok && r.data.ok) {
    el.done.hidden = true;
    el.foot.hidden = true;
    el.zoomCtl.hidden = true;
    showMsg('🎉', 'All done — thank you!',
      'Your signature has been recorded and sent to your rep. You can close this page.');
    return;
  }

  submitting = false;
  el.submit.disabled = false;
  el.submit.textContent = original;

  if (r.status === 409 || r.status === 410) {
    el.done.hidden = true;
    el.foot.hidden = true;
    showMsg('✅', 'Already signed', r.data.error || 'This document has already been signed.');
    return;
  }
  if (Array.isArray(r.data.missing) && r.data.missing.length) {
    el.doneErr.textContent = 'Some required fields are still blank. Close this and tap “Next field”.';
    el.doneErr.hidden = false;
    // Trust the server over our own bookkeeping about what is missing.
    for (const id of r.data.missing) delete values[id];
    placeFields();
    return;
  }
  el.doneErr.textContent = r.data.error || (r.status === 0
    ? 'Connection problem — check your signal and try again.'
    : 'Could not submit. Please try again.');
  el.doneErr.hidden = false;
});

function reportRenderError(e) {
  console.error('[esign] render failed', e);
  showMsg('⚠️', 'Could not display the document',
    'Something went wrong while drawing the pages. Please reload, or ask your rep to resend.');
}

/* ── boot ──────────────────────────────────────────────────────────────── */
async function boot() {
  if (!token || token.length < 10) {
    showMsg('⚠️', 'Invalid link', 'This signing link looks incomplete. Please use the button in your email.');
    return;
  }

  let r;
  try { r = await post('getEsignEnvelope', { token }); }
  catch (_) {
    showMsg('📡', 'Connection problem', 'Could not reach the server. Check your connection and reload.');
    return;
  }

  if (!r.ok) {
    // Expired, revoked and already-signed are DISTINCT here. The old page
    // told an expired link "already signed", which is false and leaves the
    // homeowner with nothing to do about it.
    const reason = r.data.reason || '';
    if (r.status === 410 && reason === 'signed') showMsg('✅', 'Already signed', r.data.error);
    else if (r.status === 410 && reason === 'expired') showMsg('⏳', 'This link expired', r.data.error);
    else if (r.status === 410 && reason === 'revoked') showMsg('🚫', 'Link cancelled', r.data.error);
    else if (r.status === 404) showMsg('🔗', 'Invalid link', r.data.error || 'This signing link is not valid.');
    else if (r.status === 429) showMsg('⏳', 'Too many tries', 'Please wait a minute and reload the page.');
    else showMsg('⚠️', 'Could not load', r.data.error || 'Something went wrong. Please try again shortly.');
    return;
  }

  envelope = r.data;
  if (envelope.companyName) {
    el.brand.textContent = envelope.companyName;
    try { document.title = `Review & Sign · ${envelope.companyName}`; } catch (_) {}
  }
  el.title.textContent = envelope.title ? `· ${envelope.title}` : '';
  el.consentText.textContent = envelope.consentText || 'I agree to sign electronically.';
  el.signerName.value = envelope.signerName || '';

  if (!Array.isArray(envelope.fields) || envelope.fields.length === 0) {
    // Refused server-side at send time too; this is the belt to that braces.
    showMsg('⚠️', 'This document can’t be signed',
      'It was sent without any fields to fill in. Please contact your rep for a corrected copy.');
    return;
  }

  let bytes;
  try {
    bytes = Uint8Array.from(atob(envelope.pdf), (c) => c.charCodeAt(0));
  } catch (_) {
    showMsg('⚠️', 'Could not read the document', 'Please reload, or ask your rep to resend it.');
    return;
  }

  try {
    pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
    const first = await pdfDoc.getPage(1);
    fitScale = computeFitScale(first);
    scale = fitScale;
    await renderAll();
  } catch (e) { reportRenderError(e); return; }

  hideMsg();
  el.foot.hidden = false;
  el.zoomCtl.hidden = false;
  updateProgress();

  const firstField = remaining()[0] || (envelope.fields || [])[0];
  if (firstField) setTimeout(() => scrollToField(firstField), 220);
}

// Re-fit on rotation. The old widget never handled resize, so rotating the
// phone left strokes landing away from the finger.
let resizeTimer = null;
window.addEventListener('resize', () => {
  if (!pdfDoc) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(async () => {
    const first = await pdfDoc.getPage(1);
    const wasFit = Math.abs(scale - fitScale) < 0.01;
    fitScale = computeFitScale(first);
    if (wasFit) { scale = fitScale; await renderAll().catch(reportRenderError); }
    else placeFields();
  }, 200);
});

boot();
