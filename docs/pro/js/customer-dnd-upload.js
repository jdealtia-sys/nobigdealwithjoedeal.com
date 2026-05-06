/**
 * customer-dnd-upload.js — Wave 30 (Drag-drop file upload on customer detail)
 *
 * On the customer detail page, reps add photos and signed documents
 * dozens of times per inspection. Until now each one needed clicking
 * an "Upload" button → native file picker. This wave lets them drop
 * files directly onto the page (or anywhere on the dashboard's
 * customer view).
 *
 * Behavior:
 *   - Listens for dragenter / dragover / drop on document.
 *   - Shows a full-page tinted overlay during a drag containing
 *     files (not just text/HTML — we filter dataTransfer types).
 *   - On drop:
 *       Image (image/*)   → window.PhotoEngine.uploadFromFile(leadId, file, [], '')
 *       Everything else   → existing signed-document upload path
 *                            (uploads to Storage, creates doc in
 *                             leads/{id}/documents subcollection)
 *   - Multi-file: processes each file independently, toast per file.
 *   - Native <input type="file"> elements still work — the drop
 *     listener checks ev.target and bails out if it's inside one.
 *
 * Activates only on /pro/customer.html where window._customerId is
 * set. On the kanban or other pages it's a no-op so we don't
 * intercept legitimate drag/drop in components like the kanban
 * card reordering.
 *
 * Exposes: window.CustomerDnDUpload (debug helpers)
 */
(function () {
  'use strict';

  if (window.CustomerDnDUpload && window.CustomerDnDUpload.__sentinel === 'nbd-customer-dnd-v1') return;

  // Path-gate: customer detail page only.
  const PATH = window.location.pathname || '';
  if (!/\/pro\/customer\.html$/.test(PATH)) return;

  const MAX_PHOTO_BYTES    = 30 * 1024 * 1024; // 30 MB
  const MAX_DOC_BYTES      = 20 * 1024 * 1024; // 20 MB
  let dragDepth = 0;
  let overlay   = null;

  // ─── Helpers ─────────────────────────────────────────────────────
  function _toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
  }

  function isImageFile(file) {
    if (!file || !file.type) return false;
    return file.type.startsWith('image/');
  }

  // True when the dragged data actually contains files (vs pure
  // text/html drag-source from the page itself).
  function dragHasFiles(ev) {
    const dt = ev.dataTransfer;
    if (!dt) return false;
    const types = dt.types;
    if (!types) return false;
    for (let i = 0; i < types.length; i++) {
      if (types[i] === 'Files' || types[i] === 'application/x-moz-file') return true;
    }
    return false;
  }

  // True when the event target is inside a native file input or its
  // visible drop zone (so the existing UIs keep their own behavior).
  function isInsideNativeUploader(target) {
    if (!target || !target.closest) return false;
    return target.closest('input[type="file"]') !== null
        || target.closest('[data-nbd-native-upload]') !== null;
  }

  // ─── Overlay ─────────────────────────────────────────────────────
  function showOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'nbd-dnd-overlay';
    overlay.style.cssText = `
      position:fixed; inset:0;
      background:rgba(200,84,26,0.18);
      backdrop-filter:blur(2px); -webkit-backdrop-filter:blur(2px);
      border:3px dashed rgba(200,84,26,0.65);
      z-index:99988;
      display:flex; align-items:center; justify-content:center;
      pointer-events:none;
      animation:nbd-dnd-fade .12s ease-out;
      font-family:'Barlow',-apple-system,system-ui,sans-serif;`;
    overlay.innerHTML = `
      <div style="
        background:rgba(15,18,25,0.95); color:#fff;
        padding:28px 40px; border-radius:14px;
        text-align:center; box-shadow:0 12px 40px rgba(0,0,0,0.5);">
        <div style="font-size:48px; margin-bottom:8px;">📥</div>
        <div style="font-size:18px; font-weight:700; margin-bottom:4px;">Drop to upload</div>
        <div style="font-size:12px; color:#94a3b8;">Photos go to the gallery · PDFs / docs to documents</div>
      </div>`;
    if (!document.getElementById('nbd-dnd-style')) {
      const style = document.createElement('style');
      style.id = 'nbd-dnd-style';
      style.textContent = `@keyframes nbd-dnd-fade { from { opacity:0; } to { opacity:1; } }`;
      document.head.appendChild(style);
    }
    document.body.appendChild(overlay);
  }

  function hideOverlay() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
  }

  // ─── Per-file routing ────────────────────────────────────────────
  async function uploadImage(file, leadId) {
    if (file.size > MAX_PHOTO_BYTES) {
      _toast(`${file.name}: too large (max 30 MB)`, 'error');
      return false;
    }
    if (!window.PhotoEngine || typeof window.PhotoEngine.uploadFromFile !== 'function') {
      _toast('Photo engine not loaded — refresh and try again', 'error');
      return false;
    }
    try {
      _toast(`Uploading ${file.name}…`, 'info');
      await window.PhotoEngine.uploadFromFile(leadId, file, [], '');
      _toast(`${file.name} uploaded`, 'success');
      return true;
    } catch (e) {
      console.warn('[customer-dnd] photo upload failed', e);
      _toast(`${file.name}: ${e.message || 'upload failed'}`, 'error');
      return false;
    }
  }

  async function uploadDocument(file, leadId) {
    if (file.size > MAX_DOC_BYTES) {
      _toast(`${file.name}: too large (max 20 MB)`, 'error');
      return false;
    }
    if (!window.storage || !window.uploadBytes || !window.getDownloadURL || !window.ref
        || !window.addDoc || !window.collection || !window.serverTimestamp || !window.db
        || !window.auth) {
      _toast('Storage not loaded — refresh and try again', 'error');
      return false;
    }
    const uid = window.auth.currentUser && window.auth.currentUser.uid;
    if (!uid) { _toast('Not signed in', 'error'); return false; }

    try {
      _toast(`Uploading ${file.name}…`, 'info');
      const timestamp = Date.now();
      const safeName = (file.name || 'document').replace(/[^A-Za-z0-9._-]+/g, '_').substring(0, 100);
      const path = 'docs/' + uid + '/' + leadId + '/' + timestamp + '_' + safeName;
      const storageRef = window.ref(window.storage, path);
      await window.uploadBytes(storageRef, file);
      const downloadURL = await window.getDownloadURL(storageRef);

      await window.addDoc(window.collection(window.db, 'leads', leadId, 'documents'), {
        name: safeName,
        url: downloadURL,
        type: file.type || 'application/octet-stream',
        size: file.size,
        uploadedAt: window.serverTimestamp(),
        uploadedBy: uid,
        source: 'dnd_upload',
      });

      _toast(`${file.name} uploaded`, 'success');
      // Refresh the documents list if that loader is exposed.
      if (typeof window.loadSignedDocs === 'function') {
        try { window.loadSignedDocs(); } catch (e) {}
      }
      return true;
    } catch (e) {
      console.warn('[customer-dnd] doc upload failed', e);
      _toast(`${file.name}: ${e.message || 'upload failed'}`, 'error');
      return false;
    }
  }

  async function handleFiles(files, leadId) {
    if (!leadId) {
      _toast('No customer selected', 'error');
      return;
    }
    let imageCount = 0, docCount = 0, failed = 0;
    for (const f of files) {
      if (isImageFile(f)) {
        const ok = await uploadImage(f, leadId);
        if (ok) imageCount++; else failed++;
      } else {
        const ok = await uploadDocument(f, leadId);
        if (ok) docCount++; else failed++;
      }
    }
    // Final summary toast when there's more than one file.
    if (files.length > 1) {
      const parts = [];
      if (imageCount > 0) parts.push(`${imageCount} photo${imageCount === 1 ? '' : 's'}`);
      if (docCount > 0)   parts.push(`${docCount} document${docCount === 1 ? '' : 's'}`);
      const summary = parts.join(' + ') || 'upload';
      const failNote = failed > 0 ? ` (${failed} failed)` : '';
      _toast(`Uploaded ${summary}${failNote}`, failed > 0 ? 'error' : 'success');
    }
  }

  // ─── DnD listeners ───────────────────────────────────────────────
  function onDragEnter(ev) {
    if (!dragHasFiles(ev)) return;
    if (isInsideNativeUploader(ev.target)) return;
    ev.preventDefault();
    dragDepth++;
    if (dragDepth === 1) showOverlay();
  }

  function onDragOver(ev) {
    if (!dragHasFiles(ev)) return;
    if (isInsideNativeUploader(ev.target)) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
  }

  function onDragLeave(ev) {
    if (!dragHasFiles(ev)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) hideOverlay();
  }

  function onDrop(ev) {
    if (!dragHasFiles(ev)) return;
    if (isInsideNativeUploader(ev.target)) return;
    ev.preventDefault();
    dragDepth = 0;
    hideOverlay();
    const dt = ev.dataTransfer;
    const files = dt && dt.files ? Array.from(dt.files) : [];
    if (files.length === 0) return;
    const leadId = window._customerId;
    handleFiles(files, leadId);
  }

  // ─── Init ────────────────────────────────────────────────────────
  function init() {
    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragover',  onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop',      onDrop);
  }

  window.CustomerDnDUpload = {
    __sentinel: 'nbd-customer-dnd-v1',
    handleFiles,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
