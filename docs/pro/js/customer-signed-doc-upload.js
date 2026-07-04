
// ── Signed Document Upload (Sprint 6) ──
// Camera scan or file upload for signed paper documents.
// Uploads to Firebase Storage under docs/{uid}/{customerId}/
// and saves a record to the lead's document subcollection.

function uploadSignedDoc(mode) {
  if (mode === 'camera') {
    document.getElementById('signedDocFileInput').click();
  } else {
    document.getElementById('signedDocBrowseInput').click();
  }
}

async function handleSignedDocUpload(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  input.value = ''; // reset for re-use

  const uid = window.auth?.currentUser?.uid;
  if (!uid || !window._customerId) {
    if (typeof showToast === 'function') showToast('Not signed in or no customer selected', 'error');
    return;
  }

  // Validate
  const maxSize = 20 * 1024 * 1024; // 20MB
  if (file.size > maxSize) {
    if (typeof showToast === 'function') showToast('File too large (max 20MB)', 'error');
    return;
  }

  if (typeof showToast === 'function') showToast('Uploading ' + file.name + '...', 'info');

  try {
    const timestamp = Date.now();
    const safeName = (file.name || 'document').replace(/[^A-Za-z0-9._-]+/g, '_').substring(0, 100);
    const path = 'docs/' + uid + '/' + window._customerId + '/' + timestamp + '_' + safeName;
    const storageRef = window.ref(window.storage, path);
    await window.uploadBytes(storageRef, file);
    const downloadURL = await window.getDownloadURL(storageRef);

    // Save record to Firestore
    await window.addDoc(window.collection(window.db, 'leads', window._customerId, 'documents'), {
      name: safeName,
      url: downloadURL,
      type: file.type || 'application/octet-stream',
      size: file.size,
      uploadedAt: window.serverTimestamp(),
      uploadedBy: uid,
      source: 'signed_upload'
    });

    if (typeof showToast === 'function') showToast('Document uploaded successfully', 'success');
    loadSignedDocs();
  } catch (e) {
    console.error('Signed doc upload failed:', e);
    if (typeof showToast === 'function') showToast('Upload failed: ' + (e.message || 'unknown'), 'error');
  }
}

async function loadSignedDocs() {
  const list = document.getElementById('signedDocsList');
  if (!list || !window._customerId) return;
  try {
    const snap = await window.getDocs(window.collection(window.db, 'leads', window._customerId, 'documents'));
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!docs.length) { list.innerHTML = ''; return; }

    var esc = function(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
    list.innerHTML = '<div style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--orange);margin-bottom:8px;">Uploaded Documents (' + docs.length + ')</div>'
      + docs.map(function(d) {
        var name = esc(d.name || 'Document');
        var size = d.size ? (d.size / 1024).toFixed(0) + ' KB' : '';
        // Generated docs store their URL under htmlUrl (not url) and signed ones
        // under signedDocumentUrl — the old `d.url || '#'` gave a DEAD "View"
        // link for those. Cover all variants; omit the link when there's none.
        var href = d.url || d.htmlUrl || d.signedDocumentUrl || '';
        // Surface signed status — remote e-sign + the esign webhook stamp these,
        // but the documents tab gave no indication a doc was actually signed.
        // Date only (signer name is homeowner-typed/public — keep it off this surface).
        var when = (d.signedAt && d.signedAt.toDate) ? (' ' + d.signedAt.toDate().toLocaleDateString()) : '';
        var status = (d.signedRemotely || d.signedAt || /signed/i.test(d.source || ''))
          ? ' · ✓ Signed' + when
          : (d.source === 'signed_upload' ? ' · Uploaded' : '');
        return '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--s);border:1px solid var(--br);border-radius:6px;margin-bottom:4px;">'
          + '<span style="font-size:16px;">📄</span>'
          + '<div style="flex:1;min-width:0;"><div style="font-size:12px;font-weight:600;color:var(--t);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + name + '</div>'
          + '<div style="font-size:10px;color:var(--m);">' + size + status + '</div></div>'
          + (href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener" style="color:var(--orange);font-size:11px;font-weight:600;text-decoration:none;">View</a>' : '')
          + '</div>';
      }).join('');
  } catch (e) {
    console.warn('loadSignedDocs failed:', e.message);
  }
}

// Load on page init
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(loadSignedDocs, 2000);
});
