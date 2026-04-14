/**
 * dom-safe.js — tiny HTML-escape helpers for user-controlled data.
 *
 * Use ANY TIME you build a string with template literals and then assign it
 * to `.innerHTML`. Prefer `.textContent` or DOM builders whenever possible,
 * but if you must use innerHTML, wrap every user value in `esc()`.
 *
 * Usage:
 *   import { esc, safeHTML, setText } from './js/dom-safe.js';
 *   el.innerHTML = safeHTML`<div>${lead.name}</div>`;
 *
 * Or via the global (for non-module scripts):
 *   el.innerHTML = `<div>${window.nbdEsc(lead.name)}</div>`;
 */

export function esc(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;')
    .replace(/=/g, '&#61;');
}

/**
 * Tagged template that escapes every interpolated value.
 *
 *   safeHTML`<p>Hello ${name}</p>`
 */
export function safeHTML(strings, ...values) {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) out += esc(values[i]);
  }
  return out;
}

export function setText(el, value) {
  if (el) el.textContent = value == null ? '' : String(value);
}

// ─── Null-safe getElementById helpers ──────────────────────────
// The dashboard has ~100 call sites that do
//   document.getElementById('foo').someMethod()
// which crashes when the element is missing (standalone compat mode,
// views not yet rendered, feature-flagged modals). These helpers let
// call sites say "do this if the element exists, otherwise skip" in
// one line without bloating the call sites with conditional guards.
export function $id(id) { return document.getElementById(id); }
export function setVal(id, value) {
  const el = typeof id === 'string' ? document.getElementById(id) : id;
  if (el) el.value = value == null ? '' : String(value);
  return el;
}
export function setHtml(id, html) {
  const el = typeof id === 'string' ? document.getElementById(id) : id;
  if (el) el.innerHTML = html == null ? '' : String(html);
  return el;
}
export function setTextById(id, value) {
  const el = typeof id === 'string' ? document.getElementById(id) : id;
  if (el) el.textContent = value == null ? '' : String(value);
  return el;
}
export function addClass(id, cls) {
  const el = typeof id === 'string' ? document.getElementById(id) : id;
  if (el && el.classList) el.classList.add(cls);
  return el;
}
export function removeClass(id, cls) {
  const el = typeof id === 'string' ? document.getElementById(id) : id;
  if (el && el.classList) el.classList.remove(cls);
  return el;
}

// Global shim so legacy inline scripts can use it without modules.
if (typeof window !== 'undefined') {
  window.nbdEsc = esc;
  window.nbdSafeHTML = safeHTML;
  window.nbdSetText = setText;
  window.$id = $id;
  window.$val = setVal;
  window.$html = setHtml;
  window.$text = setTextById;
  window.$addClass = addClass;
  window.$removeClass = removeClass;
}
