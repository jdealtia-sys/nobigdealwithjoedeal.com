let removeDocFromQueue; // module-local (globals Tranche 1 — was window.*)


// ============================================
// PHOTO REPORT GENERATOR
// ============================================

window.generatePhotoReport = async function() {
  if (!window._customerPhotos || window._customerPhotos.length === 0) {
    alert('No photos to generate report from');
    return;
  }
  
  if (!window._customerId) {
    alert('Customer ID not found');
    return;
  }
  
  try {
    // Get customer data
    const leadSnap = await getDoc(doc(db, 'leads', window._customerId));
    if (!leadSnap.exists()) {
      alert('Customer not found');
      return;
    }
    const lead = leadSnap.data();
    
    // Show loading state
    const btn = event.target;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Generating...';
    
    // PR 2b3: jsPDF is lazy (pdfexport bundle, ~1.1 MB off boot). Load on demand.
    if (typeof window.jspdf === 'undefined' && window.ScriptLoader) {
      await window.ScriptLoader.loadBundle('pdfexport');
    }
    if (typeof window.jspdf === 'undefined') {
      if (typeof showToast === 'function') showToast('PDF tools failed to load — check your connection and retry.', 'error');
      btn.disabled = false; btn.textContent = originalText;
      return;
    }
    // Initialize jsPDF
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    // Branding Header — tenant-aware (Phase B-3b). NBD renders byte-identical.
    const _b = (window._brand && window._brand()) || {};
    const _isNbd = !_b.legalName || _b.legalName === 'No Big Deal Home Solutions';
    const _hx = (h) => { const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(h || '')); return m ? [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16)] : [232,114,12]; };
    const _acc = _isNbd ? [232,114,12] : _hx((_b.colors && _b.colors.accent) || '#e8720c');
    doc.setFillColor(_acc[0], _acc[1], _acc[2]);
    doc.rect(0, 0, 210, 35, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text(_isNbd ? 'NO BIG DEAL' : String(_b.displayName || _b.legalName || '').toUpperCase(), 15, 15);

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text(_isNbd ? 'HOME SOLUTIONS' : '', 15, 22);
    doc.text(_isNbd ? 'Insurance Restoration Specialists' : String(_b.tagline || ''), 15, 28);
    
    // Report title
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('PROPERTY PHOTO REPORT', 105, 20, { align: 'center' });
    
    // Property details box
    doc.setFillColor(248, 249, 250);
    doc.rect(10, 40, 190, 25, 'F');
    
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    
    const customerName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'Customer';
    const address = lead.address || 'Address not provided';
    const reportDate = new Date().toLocaleDateString('en-US', { 
      year: 'numeric', month: 'long', day: 'numeric' 
    });
    
    doc.text(`Customer: ${customerName}`, 15, 48);
    doc.text(`Property: ${address}`, 15, 54);
    doc.text(`Report Date: ${reportDate}`, 15, 60);
    doc.text(`Total Photos: ${window._customerPhotos.length}`, 150, 48);
    
    if (lead.damageType) {
      doc.text(`Damage Type: ${lead.damageType}`, 150, 54);
    }
    
    // Photos section
    let yPos = 75;
    let pageCount = 1;
    let photoCount = 0;

    // Report iterates photos in the user's drag-rearranged order. The
    // _customerPhotos array is already sorted by nbdComparePhotos in
    // loadPhotos(), but re-sort here as a defensive belt-and-braces in
    // case the report is generated from a stale array.
    var __reportPhotos = (window._customerPhotos || []).slice().sort(
      typeof nbdComparePhotos === 'function' ? nbdComparePhotos : (function(){ return 0; })
    );
    for (let photo of __reportPhotos) {
      photoCount++;
      
      // Check if we need a new page (leave room for photo + caption)
      if (yPos > 240) {
        doc.addPage();
        yPos = 20;
        pageCount++;
      }
      
      // Photo title
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(232, 114, 12);
      doc.text(`Photo ${photoCount}`, 15, yPos);
      yPos += 6;
      
      // Photo metadata
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 100, 100);
      
      const uploadDate = photo.uploadedAt?.toDate ? 
        photo.uploadedAt.toDate().toLocaleDateString() : 'Unknown date';
      const category = photo.category || 'Property';
      
      doc.text(`${category} • ${uploadDate} • ${photo.filename}`, 15, yPos);
      yPos += 8;
      
      // Fetch and embed the image
      try {
        const imgData = await fetchImageAsBase64(photo.url);
        
        // Add image (fit to width 180mm, max height 100mm)
        const maxWidth = 180;
        const maxHeight = 100;
        
        // Add the image
        doc.addImage(imgData, 'JPEG', 15, yPos, maxWidth, maxHeight);
        yPos += maxHeight + 10;
        
        // Optional: Add notes if they exist
        if (photo.notes) {
          doc.setFontSize(9);
          doc.setTextColor(50, 50, 50);
          doc.text(`Notes: ${photo.notes}`, 15, yPos);
          yPos += 6;
        }
        
        yPos += 5; // Spacing between photos
        
      } catch (imgError) {
        console.error('Error loading image:', imgError);
        doc.setTextColor(200, 0, 0);
        doc.text('[Image could not be loaded]', 15, yPos);
        yPos += 15;
      }
    }
    
    // Footer on last page
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text(_isNbd ? 'No Big Deal Home Solutions | Greater Cincinnati Area' : (String(_b.legalName || '') + ((_b.contact && _b.contact.address) ? (' | ' + _b.contact.address) : '')), 105, 285, { align: 'center' });
    doc.text(_isNbd ? 'nobigdealwithjoedeal.com' : String((_b.contact && _b.contact.website) || ''), 105, 290, { align: 'center' });
    
    // Generate filename
    const safeCustomerName = customerName.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${(_b.docPrefix) || 'NBD'}_Photo_Report_${safeCustomerName}_${Date.now()}.pdf`;
    
    // Get PDF as blob for potential email attachment
    const pdfBlob = doc.output('blob');
    
    // Reset button
    btn.disabled = false;
    btn.textContent = originalText;
    
    // Ask user: Download or Email?
    const action = confirm(`✅ Photo report generated!\n\n${window._customerPhotos.length} photos included | ${pageCount} pages\n\nClick OK to EMAIL the report\nClick Cancel to DOWNLOAD only`);
    
    if (action) {
      // Email the report
      if (typeof emailPhotoReport === 'function') {
        emailPhotoReport(pdfBlob, window._customerId);
      } else {
        alert('Email system not loaded. Downloading instead.');
        doc.save(filename);
      }
    } else {
      // Download the PDF
      doc.save(filename);
    }
    
  } catch (error) {
    console.error('Report generation error:', error);
    alert('Failed to generate report. Please try again.');
    
    // Reset button
    if (event.target) {
      event.target.disabled = false;
      event.target.textContent = 'Generate Report';
    }
  }
};

// Helper: Fetch image as base64 (handles CORS)
async function fetchImageAsBase64(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    
    img.onload = function() {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      
      const dataURL = canvas.toDataURL('image/jpeg', 0.85);
      resolve(dataURL);
    };
    
    img.onerror = function() {
      reject(new Error('Failed to load image'));
    };
    
    // Firebase Storage URLs need proper CORS handling
    // Add timestamp to bypass cache if needed
    img.src = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
  });
}



// ============================================
// DOCUMENT UPLOAD SYSTEM
// ============================================

window._docUploadQueue = [];

window.openDocUploadModal = function() {
  document.getElementById('docUploadModal').style.display = 'flex';
  window._docUploadQueue = [];
  updateDocUploadPreview();
};

window.closeDocUploadModal = function() {
  document.getElementById('docUploadModal').style.display = 'none';
  window._docUploadQueue = [];
  updateDocUploadPreview();
};

// Document drop zone
document.addEventListener('DOMContentLoaded', () => {
  const dropZone = document.getElementById('docDropZone');
  const fileInput = document.getElementById('docFileInput');
  
  if (dropZone && fileInput) {
    dropZone.addEventListener('click', () => fileInput.click());
    
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-over');
    });
    
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer.files);
      addDocumentsToQueue(files);
    });
    
    fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      addDocumentsToQueue(files);
    });
  }
});

function addDocumentsToQueue(files) {
  files.forEach(file => {
    window._docUploadQueue.push({
      file: file,
      uploading: false,
      progress: 0
    });
  });
  updateDocUploadPreview();
}

function updateDocUploadPreview() {
  const preview = document.getElementById('docUploadPreview');
  const uploadBtn = document.getElementById('uploadDocBtn');
  const countSpan = document.getElementById('uploadDocCount');
  
  if (window._docUploadQueue.length === 0) {
    preview.innerHTML = '';
    uploadBtn.style.display = 'none';
    return;
  }
  
  uploadBtn.style.display = 'inline-flex';
  countSpan.textContent = window._docUploadQueue.length;
  
  const esc = window.nbdEsc || (s => String(s == null ? '' : s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
  preview.innerHTML = window._docUploadQueue.map((item, idx) => {
    const fileName = String(item.file.name || '');
    const fileType = (fileName.split('.').pop() || '').toUpperCase();
    const sizeKb = Number.isFinite(+item.file.size) ? (+item.file.size / 1024).toFixed(1) : '0.0';
    return `
      <div class="preview-item" style="aspect-ratio:auto;padding:12px;display:flex;align-items:center;gap:8px;">
        <div style="opacity:.6;"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:32px;height:32px;"><path d="M5 2h7l4 4v11a1 1 0 01-1 1H5a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M12 2v4h4"/></svg></div>
        <div style="flex:1;overflow:hidden;">
          <div style="font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${esc(fileName)}
          </div>
          <div style="font-size:10px;color:var(--m);">
            ${esc(fileType)} • ${esc(sizeKb)}KB
          </div>
        </div>
        ${item.uploading
          ? `<div style="font-size:10px;color:var(--blue);">${Math.round(Number(item.progress) || 0)}%</div>`
          : `<button type="button" class="preview-remove nbd-remove-doc" data-queue-idx="${idx}">×</button>`
        }
      </div>
    `;
  }).join('');
  preview.querySelectorAll('.nbd-remove-doc').forEach(btn => {
    btn.addEventListener('click', () => removeDocFromQueue(Number(btn.dataset.queueIdx)));
  });
}

removeDocFromQueue = function(index) {
  window._docUploadQueue.splice(index, 1);
  updateDocUploadPreview();
};

window.uploadDocuments = async function() {
  if (window._docUploadQueue.length === 0) return;
  if (!window._customerId) {
    alert('Customer ID not found');
    return;
  }
  
  const uploadBtn = document.getElementById('uploadDocBtn');
  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Uploading...';
  
  try {
    for (let i = 0; i < window._docUploadQueue.length; i++) {
      const item = window._docUploadQueue[i];
      item.uploading = true;
      updateDocUploadPreview();
      
      await uploadSingleDocument(item, i);
    }
    
    alert(`Successfully uploaded ${window._docUploadQueue.length} document(s)!`);
    closeDocUploadModal();
    await loadDocuments(window._customerId);
    
  } catch (error) {
    console.error('Document upload error:', error);
    alert('Upload failed. Please try again.');
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Upload Documents';
  }
};

async function uploadSingleDocument(item, index) {
  const file = item.file;
  const timestamp = Date.now();
  // Storage rules require path `docs/{uid}/{file}` — the old
  // `documents/{file}` path is blocked by default-deny. Same
  // root-cause as the photo upload failure.
  const uid = window.auth?.currentUser?.uid;
  if (!uid) throw new Error('Not signed in — cannot upload');
  const safeName = (file.name || 'upload').replace(/[^A-Za-z0-9._-]+/g, '_').substring(0, 120);
  const filename = `${window._customerId}_${timestamp}_${safeName}`;
  const storageRef = window.ref(window.storage, `docs/${uid}/${filename}`);
  
  const uploadTask = window.uploadBytesResumable(storageRef, file);
  
  return new Promise((resolve, reject) => {
    uploadTask.on('state_changed',
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        window._docUploadQueue[index].progress = progress;
        updateDocUploadPreview();
      },
      (error) => {
        console.error('Upload error:', error);
        reject(error);
      },
      async () => {
        try {
          const downloadURL = await window.getDownloadURL(uploadTask.snapshot.ref);
          
          await window.addDoc(window.collection(window.db, 'documents'), {
            leadId: window._customerId,
            userId: window.auth.currentUser.uid,
            url: downloadURL,
            filename: file.name,
            size: file.size,
            type: file.type,
            uploadedAt: window.serverTimestamp(),
            category: 'General'
          });
          
          resolve();
        } catch (error) {
          reject(error);
        }
      }
    );
  });
}

async function loadDocuments(leadId) {
  try {
    const docSnap = await getDocs(
      query(collection(db, 'documents'), where('leadId', '==', leadId), where('userId', '==', auth.currentUser?.uid), orderBy('uploadedAt', 'desc'))
    );
    
    if (docSnap.empty) {
      document.getElementById('docList').innerHTML = `
        <div class="empty">
          <div class="empty-icon"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:middle;"><path d="M5 2h7l4 4v11a1 1 0 01-1 1H5a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M12 2v4h4"/></svg></div>
          No documents yet
          <div style="margin-top:14px;">
            <button class="btn btn-orange" data-action="openDocCreateModal" style="font-size:11px;padding:8px 16px;">
              📝 Create your first document
            </button>
          </div>
        </div>`;
      return;
    }

    window._customerDocs = docSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const esc = window.nbdEsc || (s => String(s == null ? '' : s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
    const html = window._customerDocs.map((doc, idx) => {
      const uploadDate = doc.uploadedAt?.toDate ? doc.uploadedAt.toDate().toLocaleDateString() : '—';
      const filename = String(doc.filename || '');
      const fileType = (filename.split('.').pop() || '').toUpperCase();
      const sizeKb = Number.isFinite(+doc.size) ? (+doc.size / 1024).toFixed(1) : '0.0';

      return `
        <div class="document-item nbd-doc-row" data-doc-idx="${idx}" style="
          display:flex;
          align-items:center;
          gap:12px;
          padding:12px;
          background:var(--s2);
          border:1px solid var(--br);
          border-radius:6px;
          margin-bottom:8px;
          cursor:pointer;
          transition:all .2s;
        ">
          <div style="opacity:.6;"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:32px;height:32px;"><path d="M5 2h7l4 4v11a1 1 0 01-1 1H5a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M12 2v4h4"/></svg></div>
          <div style="flex:1;overflow:hidden;">
            <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${esc(filename)}
            </div>
            <div style="font-size:11px;color:var(--m);">
              ${esc(fileType)} • ${esc(uploadDate)} • ${esc(sizeKb)}KB
            </div>
          </div>
          <div style="opacity:.5;"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;vertical-align:middle;"><path d="M4 10h12M12 6l4 4-4 4"/></svg></div>
        </div>
      `;
    }).join('');

    document.getElementById('docList').innerHTML = html;
    
    // Add hover effect
    document.querySelectorAll('.document-item').forEach(item => {
      item.addEventListener('mouseenter', () => {
        item.style.background = 'var(--s3)';
        item.style.borderColor = 'var(--orange)';
      });
      item.addEventListener('mouseleave', () => {
        item.style.background = 'var(--s2)';
        item.style.borderColor = 'var(--br)';
      });
    });
    // Click to open — validate URL scheme first, no inline onclick.
    document.querySelectorAll('.nbd-doc-row').forEach(row => {
      row.addEventListener('click', () => {
        const idx = Number(row.dataset.docIdx);
        const d = (window._customerDocs || [])[idx];
        const url = d && d.url;
        if (/^https?:/i.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
      });
    });
  } catch (e) {
    console.error('Error loading documents:', e);
    document.getElementById('docList').innerHTML = `
      <div class="empty">
        <div class="empty-icon"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:middle;"><path d="M5 2h7l4 4v11a1 1 0 01-1 1H5a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M12 2v4h4"/></svg></div>
        No documents yet
      </div>`;
  }
}

// ============================================
// NOTES SYSTEM
// ============================================

window.openNotesModal = function() {
  document.getElementById('notesModal').style.display = 'flex';
  document.getElementById('noteText').value = '';
  document.getElementById('noteText').focus();
};

window.closeNotesModal = function() {
  document.getElementById('notesModal').style.display = 'none';
};

window.saveNote = async function() {
  const noteText = document.getElementById('noteText').value.trim();

  if (!noteText) {
    alert('Please enter a note');
    return;
  }

  if (!window._customerId) {
    alert('Customer ID not found');
    return;
  }

  try {
    await window.addDoc(window.collection(window.db, 'notes'), {
      leadId: window._customerId,
      userId: window.auth.currentUser.uid,
      text: noteText,
      createdAt: window.serverTimestamp(),
      createdBy: auth.currentUser?.email || 'Unknown'
    });

    closeNotesModal();
    await loadNotes(window._customerId);

    // Reload timeline to show new note
    const leadSnap = await getDoc(doc(db, 'leads', window._customerId));
    if (leadSnap.exists()) {
      await loadTimeline(window._customerId, leadSnap.data());
    }

  } catch (error) {
    console.error('Error saving note:', error);
    alert('Failed to save note. Please try again.');
  }
};

// Wave 33: inline quick-add note. Optimistic prepend to the visible
// notesList so the rep sees the note land immediately, then writes
// to Firestore in the background. On success, reload notes from
// source. On failure, remove the optimistic card + restore the
// textarea content + toast.
window.quickAddNote = async function () {
  const input  = document.getElementById('quickNoteInput');
  const send   = document.getElementById('quickNoteSend');
  const status = document.getElementById('quickNoteStatus');
  if (!input) return;
  const text = input.value.trim();
  if (!text) {
    input.focus();
    return;
  }
  if (!window._customerId) {
    if (typeof window.showToast === 'function') window.showToast('No customer selected', 'error');
    return;
  }

  // Lock the form while we save.
  input.disabled = true;
  if (send) { send.disabled = true; send.style.opacity = '0.6'; send.style.cursor = 'wait'; }
  if (status) { status.textContent = 'Saving…'; status.style.color = 'var(--m)'; }

  // Optimistic prepend — temporary card with a pending marker.
  const list = document.getElementById('notesList');
  const tmpId = 'tmp-note-' + Date.now();
  const wasEmpty = list && /class="empty"/.test(list.innerHTML);
  const esc = window.nbdEsc || (s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
  const bodyHtml = esc(text).replace(/\n/g, '<br>');
  const tmpCard = `
    <div id="${tmpId}" data-tmp="1"
      style="padding:12px;background:var(--s2);border-left:3px solid var(--orange);border-radius:4px;opacity:0.7;">
      <div style="font-size:13px;line-height:1.6;margin-bottom:6px;">${bodyHtml}</div>
      <div style="font-size:10px;color:var(--m);font-style:italic;">Saving…</div>
    </div>`;
  if (list) {
    if (wasEmpty) list.innerHTML = tmpCard;
    else list.insertAdjacentHTML('afterbegin', tmpCard);
  }

  try {
    await window.addDoc(window.collection(window.db, 'notes'), {
      leadId: window._customerId,
      userId: window.auth.currentUser.uid,
      text,
      createdAt: window.serverTimestamp(),
      createdBy: window.auth.currentUser?.email || 'Unknown'
    });

    // Success: clear the input, flash "Saved", reload from source.
    input.value = '';
    if (status) {
      status.textContent = 'Saved ✓';
      status.style.color = '#10b981';
      setTimeout(() => { if (status.textContent === 'Saved ✓') status.textContent = ''; }, 1800);
    }

    if (typeof loadNotes === 'function') {
      try { await loadNotes(window._customerId); } catch (_) {}
    }
    // Refresh the timeline panel so the new note shows up there too,
    // matching the modal's existing behavior.
    try {
      if (typeof getDoc === 'function' && typeof doc === 'function' && typeof db !== 'undefined') {
        const leadSnap = await getDoc(doc(db, 'leads', window._customerId));
        if (leadSnap.exists() && typeof loadTimeline === 'function') {
          await loadTimeline(window._customerId, leadSnap.data());
        }
      }
    } catch (_) {}
  } catch (e) {
    console.error('[quickAddNote] save failed', e);
    // Roll back: remove the optimistic card, put the text back so
    // the rep doesn't lose what they typed.
    const tmp = document.getElementById(tmpId);
    if (tmp) tmp.remove();
    input.value = text;
    if (status) {
      status.textContent = 'Save failed — try again';
      status.style.color = '#ef4444';
    }
    if (typeof window.showToast === 'function') {
      window.showToast('Note save failed: ' + (e.message || 'unknown'), 'error');
    }
  } finally {
    input.disabled = false;
    if (send) { send.disabled = false; send.style.opacity = ''; send.style.cursor = ''; }
    input.focus();
  }
};

// Wire Cmd/Ctrl+Enter on the quick-note input. Listens lazily so it
// works even if the textarea wasn't in the DOM at parse time.
document.addEventListener('keydown', function (ev) {
  if (ev.target && ev.target.id === 'quickNoteInput'
      && ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
    ev.preventDefault();
    if (typeof window.quickAddNote === 'function') window.quickAddNote();
  }
});

async function loadNotes(leadId) {
  try {
    const noteSnap = await getDocs(
      query(collection(db, 'notes'), where('leadId', '==', leadId), where('userId', '==', auth.currentUser?.uid), orderBy('createdAt', 'desc'))
    );
    
    if (noteSnap.empty) {
      document.getElementById('notesList').innerHTML = `
      <div class="empty">
        <div class="empty-icon"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:middle;"><path d="M4 3h12a1 1 0 011 1v10l-4 4H4a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M13 14v4"/><path d="M7 7h6M7 10h3"/></svg></div>
        <div>No notes yet — type one in the box above and hit Send.</div>
      </div>
    `;
      return;
    }

    const esc = window.nbdEsc || (s => String(s == null ? '' : s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
    const html = noteSnap.docs.map(d => {
      const note = d.data();
      const createdDate = note.createdAt?.toDate ? note.createdAt.toDate() : new Date();
      const timeAgo = getTimeAgo(createdDate);

      // Escape every user-controlled field. Preserve newlines in the note body
      // by escaping first then converting \n → <br>.
      const bodyHtml = esc(note.text).replace(/\n/g, '<br>');
      return `
        <div style="
          padding:12px;
          background:var(--s2);
          border-left:3px solid var(--orange);
          border-radius:4px;
        ">
          <div style="font-size:13px;line-height:1.6;margin-bottom:6px;">
            ${bodyHtml}
          </div>
          <div style="font-size:10px;color:var(--m);">
            ${esc(note.createdBy)} • ${esc(timeAgo)}
          </div>
        </div>
      `;
    }).join('');

    document.getElementById('notesList').innerHTML = html;
  } catch (e) {
    console.error('Error loading notes:', e);
  }
}

function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  
  return date.toLocaleDateString();
}

// ============================================
// ESTIMATE SYSTEM
// ============================================

window.openEstimateModal = function() {
  document.getElementById('estimateModal').style.display = 'flex';
  document.getElementById('estimateAmount').value = '';
  document.getElementById('estimateNotes').value = '';
};

window.closeEstimateModal = function() {
  document.getElementById('estimateModal').style.display = 'none';
};

window.saveEstimate = async function() {
  const type = document.getElementById('estimateType').value;
  const amount = parseFloat(document.getElementById('estimateAmount').value);
  const notes = document.getElementById('estimateNotes').value.trim();
  
  if (!amount || amount <= 0) {
    alert('Please enter a valid estimate amount');
    return;
  }
  
  if (!window._customerId) {
    alert('Customer ID not found');
    return;
  }
  
  try {
    await window.addDoc(window.collection(window.db, 'estimates'), {
      leadId: window._customerId,
      // The estimates create rule requires userId == auth.uid; omitting it
      // made every Log Estimate from this page PERMISSION_DENIED.
      userId: window.auth?.currentUser?.uid || auth.currentUser?.uid || null,
      type: type,
      amount: amount,
      notes: notes,
      status: 'Draft',
      createdAt: window.serverTimestamp(),
      createdBy: auth.currentUser?.email || 'Unknown'
    });
    
    alert('Estimate created successfully!');
    closeEstimateModal();
    if (window.loadEstimates) await window.loadEstimates(window._customerId);

    // Reload timeline
    const leadSnap2 = await window.getDoc(window.doc(window.db, 'leads', window._customerId));
    if (leadSnap2.exists()) {
      if (window.loadTimeline) await window.loadTimeline(window._customerId, leadSnap2.data());
    }
    
  } catch (error) {
    console.error('Error saving estimate:', error);
    alert('Failed to save estimate. Please try again.');
  }
};



// Expose loader functions defined in THIS script block to window scope
// NOTE: loadEstimates and loadTimeline are in the module script — exposed there
window.loadDocuments = loadDocuments;
window.loadNotes = loadNotes;
window.fetchImageAsBase64 = fetchImageAsBase64;

