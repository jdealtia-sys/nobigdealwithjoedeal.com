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

// Global shim so legacy inline scripts can use it without modules.
if (typeof window !== 'undefined') {
  window.nbdEsc = esc;
  window.nbdSafeHTML = safeHTML;
  window.nbdSetText = setText;
}
