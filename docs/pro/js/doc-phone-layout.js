/**
 * doc-phone-layout.js — the phone reading layout for a generated document
 * shown inside a sandboxed <iframe srcdoc>.
 *
 * 2026-09-25, phone audit homeowner#2. A document-generator letter document
 * (contract, proposal, inspection reports — the templates built on
 * .document-container) arrives exactly as the rep generated it: a US-letter
 * page laid out in inches — 0.5in page padding, 0.18in section padding plus
 * a 4px rule, 10px body and 9px clause text — under a 66px blank band that
 * only exists to clear the legacy popup's fixed action bar (a stored
 * document never carries that bar). On a 412px phone that measured as a
 * 277px column (225px at 360) of 9px Georgia, the 3-day cancellation notice
 * included. Pinch-zoom works, but at 2x every line needs a pan.
 *
 * PR #1746 fixed that on sign.html only. The same document reaches a phone
 * two more ways, both still at print size until this file:
 *   - the homeowner portal's "Your Documents → View" (portal.js), and
 *   - the rep's own doc viewer (nbd-doc-viewer.js), where the contract is
 *     signed IN PERSON — the homeowner reading it on the rep's phone.
 * One copy of the layout now serves all three, so a fix to it can never
 * again land on one surface and miss the other two.
 *
 * WHY NOT in document-generator.js's shared CSS: the generated HTML is the
 * legal record. It is stored, printed by Chromium, and turned into a PDF by
 * the doc viewer's html2pdf path — which renders the document's own <style>
 * blocks inside the PARENT page, so a max-width rule living in the document
 * would match the rep's phone and reflow the downloaded PDF. The phone
 * layout therefore never enters the document: a surface adds it to the copy
 * it SHOWS (withPhoneLayout), and a surface that gets the document back from
 * the signature widget takes it out again (stripPhoneLayout) before the HTML
 * is stored, printed or PDF'd — so the record is the document the rep made
 * plus the signature, the same bytes a desktop signer produces. @media
 * screen also keeps it out of any print of the live page.
 *
 * ONLY letter documents get it. The sheet was measured against the
 * .document-container template, and several of its selectors (.section,
 * .section-title, html/body background) are generic names other documents
 * use with their own design — the rep's doc viewer also shows the Close
 * Board's dark report (light text on #0d0f14), which a white body would make
 * unreadable. Anything else is shown exactly as served.
 *
 * Exposed as window.NBDDocPhoneLayout. Consumers read it at call time and
 * fall back to the unchanged HTML when it is absent, so a failed load of
 * this file costs the phone layout, never the record.
 */
(function () {
  'use strict';
  if (window.NBDDocPhoneLayout) return;

  var STYLE_ID = 'nbd-doc-phone';
  var CSS = [
    '@media screen and (max-width:600px){',
    'html,body{background:#fff;}',
    '.document-container{margin:0!important;padding:16px 16px 0!important;max-width:none;min-height:0;box-shadow:none;}',
    '.document-header{margin:-16px -16px 20px!important;padding:20px 16px 16px!important;}',
    '.header-top{flex-wrap:wrap;gap:10px;}',
    '.header-info{font-size:13px!important;text-align:left!important;}',
    '.header-company-name{font-size:20px!important;}',
    '.header-tagline{font-size:14px!important;}',
    '.header-contact-row{font-size:13px!important;}',
    '.document-title{font-size:24px!important;letter-spacing:1px!important;}',
    '.document-subtitle{font-size:14px!important;}',
    '.document-content{font-size:16px!important;line-height:1.6!important;}',
    // The templates hard-code their small print as inline styles (the
    // contract's clause blocks are style="…font-size: 9px;"), which only an
    // !important rule can outrank. Matched by value so a deliberately LARGER
    // inline size is left alone.
    '.document-container [style*="font-size: 8px"],.document-container [style*="font-size:8px"],',
    '.document-container [style*="font-size: 9px"],.document-container [style*="font-size:9px"],',
    '.document-container [style*="font-size: 10px"],.document-container [style*="font-size:10px"],',
    '.document-container [style*="font-size: 10.5px"],.document-container [style*="font-size:10.5px"],',
    '.document-container [style*="font-size: 11px"],.document-container [style*="font-size:11px"]{font-size:inherit!important;}',
    // Line-item tables: 13px keeps a five-column scope table (with money
    // like $15,520.00, which must never break mid-figure) inside a 360px
    // column. The DESCRIPTION column absorbs the squeeze: a long word in it
    // ("counterflashing") otherwise sets the column's minimum width, and at
    // 360 that pushed the Total column 13px past the table's edge, clipped
    // mid-figure. overflow-wrap:anywhere lowers that minimum, so the table
    // fits and only the description cells wrap harder (hyphens:auto makes
    // that "counter-flashing" where the phone has a dictionary; documents are
    // lang="en"). Only body cells: the "Description" header stays whole, and
    // the 3px side padding is what leaves room for it at 360 (4px was 2px
    // short). It is NOT applied to the other columns: that would let the layout
    // squeeze a figure until it broke. display:block + overflow-x stays as
    // the net for a table that still cannot fit, so it scrolls inside its
    // section instead of past the page edge.
    '.document-container table,.document-container table[style]{font-size:13px!important;display:block;max-width:100%;overflow-x:auto;}',
    '.document-container th,.document-container td{padding:5px 3px!important;}',
    '.document-container td:first-child{overflow-wrap:anywhere;hyphens:auto;}',
    '.section{padding:12px 12px 12px 14px;margin-bottom:18px;border-left-width:3px;}',
    '.section-title{font-size:15px!important;letter-spacing:.06em!important;}',
    '.summary-text,.scope-list,.warranty-details{font-size:16px!important;}',
    '.warranty-badge{font-size:15px!important;padding:10px 14px!important;}',
    '.signature-block,.sig-label,.nbd-sig-label,.nbd-sig-print-name,.nbd-sig-date{font-size:14px!important;}',
    '.photo-grid.three-col{grid-template-columns:repeat(2,1fr);}',
    '.affiliate-name{font-size:13px!important;}',
    '.affiliate-num,.affiliate-badge-num{font-size:12px!important;}',
    '.document-footer{margin:24px -16px 0!important;padding:18px 16px!important;font-size:13px!important;}',
    '.document-footer .footer-brand{font-size:13px!important;}',
    '.footer-credit{font-size:12px!important;}',
    '}',
  ].join('');
  var STYLE = '<style id="' + STYLE_ID + '">' + CSS + '</style>';

  // The generator's letter template. Matched on the markup, not the CSS, so
  // a document that merely mentions the class in a stylesheet is not taken
  // for one.
  var LETTER_DOC = /<[a-z][^>]*\sclass\s*=\s*["'][^"']*\bdocument-container\b/i;

  // Last thing in <head>, so it wins the cascade against the document's own
  // rules. A document with no </head> is shown exactly as served: prepending
  // a <style> before its doctype would drop it into quirks mode.
  function withPhoneLayout(html) {
    if (typeof html !== 'string' || !LETTER_DOC.test(html)) return html;
    var at = html.search(/<\/head>/i);
    if (at < 0) return html;
    return html.slice(0, at) + STYLE + html.slice(at);
  }

  // The signature widget serialises documentElement.outerHTML, which writes
  // this <style> back out verbatim (a style element's text is never
  // escaped); remove exactly that element so the stored, printed and PDF'd
  // record carries no trace of the phone layout.
  function stripPhoneLayout(html) {
    if (typeof html !== 'string') return html;
    return html.split(STYLE).join('');
  }

  window.NBDDocPhoneLayout = Object.freeze({
    STYLE_ID: STYLE_ID,
    withPhoneLayout: withPhoneLayout,
    stripPhoneLayout: stripPhoneLayout,
  });
})();
