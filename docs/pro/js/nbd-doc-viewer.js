// ═══════════════════════════════════════════════════════════════
// NBD Pro — Universal Document Viewer (NBDDocViewer)
//
// One in-app modal that renders every generator's final document.
// Replaces the legacy `window.open('', '_blank') + document.write`
// popup pattern that lost the user into a dead-end blank window
// with no way to save, connect, or come back.
//
// Public API:
//   window.NBDDocViewer.open({
//     html:     string (required)  — full HTML document to display
//     title:    string              — header title (e.g. "Insurance Scope")
//     filename: string              — PDF filename (default: "NBD-Document.pdf")
//     leadId:   string              — optional — pre-link to a customer
//     onSave:   async (ctx) => ...  — custom save callback
//     allowClose: boolean           — whether to show the X close button
//   });
//
// Action buttons (always visible in the footer):
//   - Save to Customer — pick a lead + persist via onSave or default
//   - Email — opens mailto: with the doc link
//   - Print — iframe.contentWindow.print()
//   - Download PDF — html2pdf.js → file download (client-side)
//   - Close — warn-then-allow (confirm dialog if onSave hasn't fired)
//
// Security: the HTML is rendered inside an <iframe srcdoc> so any
// scripts inside the document run in a separate origin-less context
// that can't touch the parent app's state. We also escape the title
// and filename before display.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  // Guard: don't double-register if the script loads twice.
  if (window.NBDDocViewer && window.NBDDocViewer.__sentinel === 'nbd-doc-viewer-v1') return;

  // ─── State ───────────────────────────────────────────────
  let currentOverlay = null;
  let currentContext = null;
  let dirty = true;   // true if the user hasn't saved yet — triggers close warning
  let escHandler = null;

  // ─── HTML escape helper ──────────────────────────────────
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  // ─── CSS (injected once on first open) ───────────────────
  function ensureStyles() {
    if (document.getElementById('nbd-doc-viewer-styles')) return;
    const style = document.createElement('style');
    style.id = 'nbd-doc-viewer-styles';
    style.textContent = `
      #nbd-doc-viewer-overlay {
        position: fixed; inset: 0; z-index: 10000;
        background: rgba(8, 10, 14, 0.92);
        display: none;
        flex-direction: column;
        font-family: 'Barlow', 'Helvetica Neue', sans-serif;
        /* Safe-area insets so the header clears the iPhone notch
           and the footer clears the home indicator. */
        padding-top: env(safe-area-inset-top, 0);
        padding-bottom: env(safe-area-inset-bottom, 0);
        padding-left: env(safe-area-inset-left, 0);
        padding-right: env(safe-area-inset-right, 0);
      }
      #nbd-doc-viewer-overlay.open { display: flex; }
      .nbdv-header {
        background: #111418;
        border-bottom: 2px solid #e8720c;
        padding: 14px 20px;
        display: flex;
        align-items: center;
        gap: 14px;
        flex-shrink: 0;
      }
      .nbdv-title {
        font-family: 'Barlow Condensed', sans-serif;
        font-size: 18px;
        font-weight: 800;
        color: #fff;
        text-transform: uppercase;
        letter-spacing: .04em;
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .nbdv-filename {
        font-size: 10px;
        color: #8b8e96;
        font-family: 'Barlow', sans-serif;
        text-transform: none;
        letter-spacing: 0;
        margin-top: 2px;
      }
      .nbdv-close {
        background: #e8720c;
        border: 1px solid #e8720c;
        color: #fff;
        font-weight: 700;
        padding: 10px 18px;
        border-radius: 6px;
        font-size: 13px;
        cursor: pointer;
        min-height: 44px;
        min-width: 44px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        font-family: inherit;
        letter-spacing: .04em;
        transition: background .15s, transform .12s;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
      }
      .nbdv-close:hover { background: #ff8420; border-color: #ff8420; }
      .nbdv-close:active { transform: scale(.95); }
      .nbdv-body {
        flex: 1;
        display: flex;
        flex-direction: column;
        background: #0a0c0f;
        overflow: hidden;
        min-height: 0;
      }
      .nbdv-iframe {
        flex: 1;
        width: 100%;
        border: none;
        background: #fff;
        min-height: 0;
      }
      .nbdv-footer {
        background: #111418;
        border-top: 1px solid #2a2f35;
        padding: 12px 20px;
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        justify-content: center;
        flex-shrink: 0;
      }
      .nbdv-action-btn {
        background: #181c22;
        border: 1px solid #2a2f35;
        color: #e8eaf0;
        padding: 12px 18px;
        border-radius: 6px;
        font-family: 'Barlow Condensed', sans-serif;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: .08em;
        text-transform: uppercase;
        cursor: pointer;
        min-height: 44px;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        transition: all .15s;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
      }
      .nbdv-action-btn:hover {
        border-color: #e8720c;
        color: #e8720c;
        background: rgba(232, 114, 12, .06);
      }
      .nbdv-action-btn.primary {
        background: #e8720c;
        color: #fff;
        border-color: #e8720c;
      }
      .nbdv-action-btn.primary:hover {
        background: #ff8420;
        border-color: #ff8420;
        color: #fff;
      }
      .nbdv-action-btn:disabled {
        opacity: .4;
        cursor: not-allowed;
      }
      .nbdv-status {
        position: absolute;
        bottom: 70px;
        left: 50%;
        transform: translateX(-50%);
        background: #181c22;
        border: 1px solid #e8720c;
        color: #e8720c;
        padding: 8px 16px;
        border-radius: 20px;
        font-size: 12px;
        font-family: 'Barlow Condensed', sans-serif;
        letter-spacing: .06em;
        text-transform: uppercase;
        z-index: 10;
        display: none;
      }
      .nbdv-status.show { display: block; }
      @media (max-width: 600px) {
        .nbdv-header { padding: 10px 14px; }
        .nbdv-title { font-size: 15px; }
        .nbdv-footer { padding: 10px 12px; gap: 6px; }
        .nbdv-action-btn { padding: 10px 12px; font-size: 11px; flex: 1; min-width: 70px; }
      }
    `;
    document.head.appendChild(style);
  }

  // ─── Build the overlay DOM (DOM builders, never innerHTML) ──
  function buildOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'nbd-doc-viewer-overlay';

    const header = document.createElement('div');
    header.className = 'nbdv-header';

    const titleWrap = document.createElement('div');
    titleWrap.style.cssText = 'flex:1;min-width:0;';
    const titleEl = document.createElement('div');
    titleEl.className = 'nbdv-title';
    titleEl.id = 'nbdv-title';
    const filenameEl = document.createElement('div');
    filenameEl.className = 'nbdv-filename';
    filenameEl.id = 'nbdv-filename';
    titleWrap.appendChild(titleEl);
    titleWrap.appendChild(filenameEl);
    header.appendChild(titleWrap);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'nbdv-close';
    closeBtn.id = 'nbdv-close';
    closeBtn.type = 'button';
    closeBtn.textContent = '✕ Close';
    closeBtn.addEventListener('click', handleClose);
    header.appendChild(closeBtn);
    overlay.appendChild(header);

    const body = document.createElement('div');
    body.className = 'nbdv-body';
    const iframe = document.createElement('iframe');
    iframe.className = 'nbdv-iframe';
    iframe.id = 'nbdv-iframe';
    // srcdoc isolates the document in its own browsing context.
    //
    // Sandbox tokens:
    //   allow-same-origin — iframe's scripts can read its own DOM
    //     (required for the PDF button to grab body.cloneNode())
    //   allow-popups      — so mailto: and target=_blank work
    //   allow-forms       — so any report form submits work
    //   allow-scripts     — so generated reports can run their own
    //     inline charting scripts (ApexCharts in the Rep Report
    //     Generator, window.print() in classic estimate export,
    //     etc.). Note: the combination 'allow-scripts' +
    //     'allow-same-origin' means the scripts CAN reach the
    //     parent origin. That's acceptable here because the
    //     iframe HTML is ALWAYS generated by our own code — we
    //     escape every user-controlled value before interpolation,
    //     so there's no path for attacker-controlled script to
    //     land inside the srcdoc.
    //   allow-modals      — permits alert/confirm/prompt inside
    //     the report (used by window.print() dialogs on some browsers)
    iframe.setAttribute('sandbox', 'allow-same-origin allow-popups allow-forms allow-scripts allow-modals');
    body.appendChild(iframe);

    const status = document.createElement('div');
    status.className = 'nbdv-status';
    status.id = 'nbdv-status';
    body.appendChild(status);

    overlay.appendChild(body);

    const footer = document.createElement('div');
    footer.className = 'nbdv-footer';

    const addBtn = (label, className, handler) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nbdv-action-btn' + (className ? ' ' + className : '');
      btn.textContent = label;
      btn.addEventListener('click', handler);
      footer.appendChild(btn);
      return btn;
    };

    addBtn('💾 Save to Customer', 'primary', handleSave);
    addBtn('✉ Email', '', handleEmail);
    addBtn('🖨 Print', '', handlePrint);
    addBtn('📄 Download PDF', '', handlePdf);

    overlay.appendChild(footer);
    document.body.appendChild(overlay);
    return overlay;
  }

  // ─── Show a transient status pill (auto-hides in 2.5s) ───
  function flashStatus(msg) {
    const el = document.getElementById('nbdv-status');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2500);
  }

  // ─── Action handlers ─────────────────────────────────────

  async function handleSave() {
    if (!currentContext) return;
    flashStatus('Saving...');
    try {
      if (typeof currentContext.onSave === 'function') {
        // Custom save callback (e.g. V2 Builder wires this to Firestore)
        const result = await currentContext.onSave(currentContext);
        if (result === false) {
          flashStatus('Save cancelled');
          return;
        }
      } else if (typeof window.showToast === 'function') {
        window.showToast('No save handler wired for this document', 'error');
        return;
      }
      dirty = false;
      flashStatus('✓ Saved');
      if (typeof window.showToast === 'function') {
        window.showToast('✓ Document saved', 'success');
      }
    } catch (e) {
      console.error('[NBDDocViewer] save failed:', e);
      flashStatus('Save failed');
      if (typeof window.showToast === 'function') {
        window.showToast('Save failed: ' + (e.message || 'unknown'), 'error');
      }
    }
  }

  function handleEmail() {
    if (!currentContext) return;
    const subject = encodeURIComponent(currentContext.title || 'NBD Document');
    const body = encodeURIComponent(
      'See attached ' + (currentContext.title || 'document') + '.\n\n'
      + 'Generated by NBD Pro.\n'
    );
    window.location.href = 'mailto:?subject=' + subject + '&body=' + body;
  }

  function handlePrint() {
    const iframe = document.getElementById('nbdv-iframe');
    if (!iframe) return;
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) {
      console.warn('[NBDDocViewer] print failed, falling back to window.print:', e);
      window.print();
    }
  }

  async function handlePdf() {
    if (!currentContext) return;
    if (typeof window.html2pdf !== 'function') {
      flashStatus('PDF engine loading...');
      if (typeof window.showToast === 'function') {
        window.showToast('PDF engine not loaded yet. Try again in a second.', 'error');
      }
      return;
    }
    flashStatus('Generating PDF...');
    const iframe = document.getElementById('nbdv-iframe');
    if (!iframe || !iframe.contentDocument) {
      flashStatus('PDF failed');
      return;
    }
    // Grab the rendered HTML from inside the iframe — this
    // preserves any live styling the document used.
    const body = iframe.contentDocument.body;
    if (!body) {
      flashStatus('PDF failed: empty document');
      return;
    }
    const filename = currentContext.filename || 'NBD-Document.pdf';
    const opt = {
      margin: [10, 10, 10, 10],
      filename: filename,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#fff' },
      jsPDF: { unit: 'mm', format: 'letter', orientation: 'portrait' }
    };
    try {
      // Clone the body so we don't mutate what the user is viewing
      const clone = body.cloneNode(true);
      await window.html2pdf().set(opt).from(clone).save();
      flashStatus('✓ PDF downloaded');
      if (typeof window.showToast === 'function') {
        window.showToast('✓ PDF saved to downloads', 'success');
      }
    } catch (e) {
      console.error('[NBDDocViewer] PDF generation failed:', e);
      flashStatus('PDF failed');
      if (typeof window.showToast === 'function') {
        window.showToast('PDF failed: ' + (e.message || 'unknown'), 'error');
      }
    }
  }

  function handleClose() {
    if (dirty) {
      // eslint-disable-next-line no-alert
      const ok = window.confirm('Close without saving?\n\n'
        + 'Click OK to close this document and lose any unsaved state. '
        + 'Click Cancel to keep reviewing, then press Save to Customer.');
      if (!ok) return;
    }
    close();
  }

  function close() {
    if (!currentOverlay) return;
    currentOverlay.classList.remove('open');
    // Clear iframe so the next open starts clean
    const iframe = document.getElementById('nbdv-iframe');
    if (iframe) iframe.removeAttribute('srcdoc');
    if (escHandler) {
      document.removeEventListener('keydown', escHandler);
      escHandler = null;
    }
    currentContext = null;
  }

  // ─── Public open() ───────────────────────────────────────
  function open(opts) {
    opts = opts || {};
    if (!opts.html || typeof opts.html !== 'string') {
      console.error('[NBDDocViewer] open() requires an html string');
      return;
    }
    ensureStyles();
    if (!currentOverlay) currentOverlay = buildOverlay();

    currentContext = {
      html: opts.html,
      title: opts.title || 'Document',
      filename: opts.filename || 'NBD-Document.pdf',
      leadId: opts.leadId || null,
      onSave: opts.onSave || null,
      meta: opts.meta || {}
    };
    dirty = true;

    // Escape title + filename before display
    const titleEl = document.getElementById('nbdv-title');
    const filenameEl = document.getElementById('nbdv-filename');
    if (titleEl) titleEl.textContent = currentContext.title;
    if (filenameEl) filenameEl.textContent = currentContext.filename;

    // Load HTML into iframe via srcdoc
    const iframe = document.getElementById('nbdv-iframe');
    if (iframe) iframe.srcdoc = opts.html;

    currentOverlay.classList.add('open');

    // Esc closes (with same warn-then-allow flow)
    escHandler = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', escHandler);
  }

  // ─── Public API ──────────────────────────────────────────
  window.NBDDocViewer = {
    __sentinel: 'nbd-doc-viewer-v1',
    open: open,
    close: close,
    // Expose the flash helper so generators can push their own status
    flashStatus: flashStatus
  };

  console.log('[NBDDocViewer] Ready. Trigger via NBDDocViewer.open({ html, title, filename, onSave })');
})();
