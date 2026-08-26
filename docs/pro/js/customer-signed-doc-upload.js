
// ── Signed Document Upload (Sprint 6) ──
// Camera scan or file upload for signed paper documents.
// Uploads to Firebase Storage under docs/{uid}/{customerId}/
// and saves a record to leads/{leadId}/documents — the canonical store.
//
// This module UPLOADS. It does not read, render, or delete: customer-documents.js
// owns the store and every documents surface on the page (see the header there
// for why that consolidation happened). We just hand it a refresh when a new
// file lands.

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
    if (window.NBDCustomerDocs) await window.NBDCustomerDocs.refresh();
  } catch (e) {
    console.error('Signed doc upload failed:', e);
    if (typeof showToast === 'function') showToast('Upload failed: ' + (e.message || 'unknown'), 'error');
  }
}

