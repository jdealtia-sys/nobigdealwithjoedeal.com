/**
 * PhotoEngine - Comprehensive Photo Management for NBD Pro Roofing CRM
 * Handles camera capture, tagging, Firebase storage, and photo galleries
 */

(function() {
  'use strict';

  // Ensure Firebase is initialized
  if (!window._storage || !window._db || !window._user || !window._auth) {
    console.warn('PhotoEngine: Firebase not fully initialized. Waiting...');
  }

  // TAG SYSTEM - Categories and definitions
  const TAG_CATEGORIES = {
    damage: {
      label: 'Damage Type',
      color: '#EF4444',
      tags: [
        'hail', 'wind', 'impact', 'wear', 'leak', 'missing_shingles',
        'lifted_shingles', 'cracked', 'granule_loss', 'nail_pop',
        'flashing_damage', 'gutter_damage', 'soffit_damage', 'fascia_damage',
        'skylight_damage', 'vent_damage', 'chimney_damage'
      ]
    },
    location: {
      label: 'Location',
      color: '#3B82F6',
      tags: [
        'front_slope', 'back_slope', 'left_slope', 'right_slope', 'ridge',
        'valley', 'hip', 'eave', 'rake', 'gutter', 'soffit', 'fascia',
        'chimney', 'skylight', 'vent', 'flat_section', 'garage', 'porch',
        'interior_ceiling', 'attic'
      ]
    },
    photo_type: {
      label: 'Photo Type',
      color: '#8B5CF6',
      tags: [
        'before', 'after', 'during', 'damage_close_up', 'overview',
        'measurement', 'material_sample', 'test_square', 'satellite',
        'existing_condition'
      ]
    },
    report_section: {
      label: 'Report Section',
      color: '#06B6D4',
      tags: [
        'cover_photo', 'roof_overview', 'damage_detail', 'interior_damage',
        'repair_needed', 'completed_work', 'material_used', 'comparison'
      ]
    }
  };

  // QUALITY PRESETS
  const QUALITY_PRESETS = {
    quick: {
      label: 'Quick',
      maxDimension: 640,
      jpegQuality: 0.6,
      description: 'Fast upload for D2D canvassing'
    },
    standard: {
      label: 'Standard',
      maxDimension: 1280,
      jpegQuality: 0.8,
      description: 'Balanced everyday use'
    },
    'high-res': {
      label: 'High-Res',
      maxDimension: 2048,
      jpegQuality: 0.92,
      description: 'Insurance documentation'
    }
  };

  // STATE
  let state = {
    currentPreset: localStorage.getItem('photoEnginePreset') || 'standard',
    selectedTags: [],
    stagedPhotos: {}, // { leadId: [photoIds] }
    cameraStream: null,
    currentLeadId: null,
    photoCache: {} // { leadId: [photoData] }
  };

  // ============================================================================
  // STYLES - Injected into DOM
  // ============================================================================

  function injectStyles() {
    if (document.getElementById('photo-engine-styles')) return;

    const styles = `
      #photo-engine-styles {
        display: none;
      }

      .pe-modal {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.95);
        display: flex;
        flex-direction: column;
        z-index: 9999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }

      .pe-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem;
        border-bottom: 1px solid var(--br);
        color: var(--t);
      }

      .pe-modal-title {
        font-size: 1.1rem;
        font-weight: 600;
      }

      .pe-close-btn {
        background: none;
        border: none;
        color: var(--t);
        cursor: pointer;
        font-size: 1.5rem;
        padding: 0.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .pe-close-btn:hover {
        color: var(--orange);
      }

      /* Camera Modal */
      .pe-camera-container {
        flex: 1;
        display: flex;
        flex-direction: column;
        position: relative;
        overflow: hidden;
      }

      .pe-camera-video {
        width: 100%;
        height: 100%;
        object-fit: cover;
        background: #000;
      }

      .pe-camera-controls {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        background: linear-gradient(to top, rgba(0,0,0,0.8), transparent);
        padding: 2rem 1rem 1rem;
        display: flex;
        justify-content: center;
        gap: 1rem;
        flex-wrap: wrap;
      }

      .pe-capture-btn {
        width: 80px;
        height: 80px;
        border-radius: 50%;
        background: var(--orange);
        border: 3px solid white;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 2rem;
        transition: all 0.2s;
        flex-shrink: 0;
      }

      .pe-capture-btn:active {
        transform: scale(0.95);
      }

      .pe-icon-btn {
        width: 50px;
        height: 50px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.2);
        border: 2px solid white;
        color: white;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.2rem;
        transition: all 0.2s;
      }

      .pe-icon-btn:hover {
        background: rgba(255, 255, 255, 0.3);
      }

      .pe-icon-btn.active {
        background: var(--orange);
      }

      .pe-preset-indicator {
        position: absolute;
        top: 1rem;
        left: 1rem;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        padding: 0.5rem 1rem;
        border-radius: 0.5rem;
        font-size: 0.9rem;
        font-weight: 500;
      }

      /* Preview Modal */
      .pe-preview-container {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        padding: 1rem;
      }

      .pe-preview-image {
        width: 100%;
        max-height: 400px;
        object-fit: contain;
        border-radius: 0.5rem;
        background: var(--s2);
        margin-bottom: 1rem;
      }

      .pe-preview-section {
        margin-bottom: 1.5rem;
      }

      .pe-section-label {
        font-size: 0.85rem;
        font-weight: 600;
        color: var(--m);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 0.5rem;
      }

      .pe-input-group {
        margin-bottom: 1rem;
      }

      .pe-input-label {
        display: block;
        font-size: 0.95rem;
        font-weight: 500;
        color: var(--t);
        margin-bottom: 0.5rem;
      }

      .pe-textarea,
      .pe-input {
        width: 100%;
        padding: 0.75rem;
        background: var(--s2);
        border: 1px solid var(--br);
        border-radius: 0.5rem;
        color: var(--t);
        font-family: inherit;
        font-size: 1rem;
        box-sizing: border-box;
      }

      .pe-textarea:focus,
      .pe-input:focus {
        outline: none;
        border-color: var(--orange);
        box-shadow: 0 0 0 2px rgba(200, 84, 26, 0.1);
      }

      .pe-textarea {
        resize: vertical;
        min-height: 80px;
      }

      /* Tag Picker */
      .pe-tag-picker {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-bottom: 1rem;
      }

      .pe-tag-pill {
        padding: 0.5rem 0.75rem;
        border-radius: 999px;
        border: 2px solid;
        background: transparent;
        cursor: pointer;
        font-size: 0.85rem;
        font-weight: 500;
        transition: all 0.2s;
        white-space: nowrap;
      }

      .pe-tag-pill:hover {
        opacity: 0.8;
      }

      .pe-tag-pill.selected {
        background: currentColor;
        color: white;
      }

      /* Action Buttons */
      .pe-button-group {
        display: flex;
        gap: 0.75rem;
        margin-top: 1.5rem;
      }

      .pe-btn {
        flex: 1;
        padding: 0.75rem 1rem;
        border: none;
        border-radius: 0.5rem;
        font-weight: 600;
        cursor: pointer;
        font-size: 0.95rem;
        transition: all 0.2s;
      }

      .pe-btn-primary {
        background: var(--orange);
        color: white;
      }

      .pe-btn-primary:hover {
        opacity: 0.9;
      }

      .pe-btn-secondary {
        background: var(--s2);
        color: var(--t);
        border: 1px solid var(--br);
      }

      .pe-btn-secondary:hover {
        background: var(--s);
      }

      /* Gallery Styles */
      .pe-gallery-container {
        padding: 1rem;
      }

      .pe-gallery-toolbar {
        display: flex;
        gap: 1rem;
        margin-bottom: 1rem;
        flex-wrap: wrap;
        align-items: center;
      }

      .pe-toolbar-select {
        padding: 0.5rem 0.75rem;
        background: var(--s2);
        border: 1px solid var(--br);
        border-radius: 0.5rem;
        color: var(--t);
        cursor: pointer;
        font-size: 0.9rem;
      }

      .pe-toolbar-select:focus {
        outline: none;
        border-color: var(--orange);
      }

      .pe-gallery-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 1rem;
      }

      .pe-gallery-item {
        position: relative;
        background: var(--s2);
        border-radius: 0.5rem;
        overflow: hidden;
        cursor: pointer;
        border: 2px solid transparent;
        transition: all 0.2s;
      }

      .pe-gallery-item:hover {
        border-color: var(--orange);
        transform: translateY(-2px);
      }

      .pe-gallery-item.selected {
        border-color: var(--orange);
        box-shadow: 0 0 0 3px rgba(200, 84, 26, 0.2);
      }

      .pe-gallery-thumbnail {
        width: 100%;
        aspect-ratio: 1;
        object-fit: cover;
      }

      .pe-gallery-checkbox {
        position: absolute;
        top: 0.5rem;
        left: 0.5rem;
        width: 24px;
        height: 24px;
        cursor: pointer;
      }

      .pe-gallery-tags {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        background: linear-gradient(to top, rgba(0,0,0,0.7), transparent);
        padding: 0.5rem;
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
      }

      .pe-mini-tag {
        font-size: 0.65rem;
        padding: 0.2rem 0.4rem;
        border-radius: 0.25rem;
        background: rgba(200, 84, 26, 0.8);
        color: white;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* Lightbox */
      .pe-lightbox {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.95);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
      }

      .pe-lightbox-content {
        width: 90%;
        max-width: 800px;
        max-height: 85vh;
        overflow: auto;
      }

      .pe-lightbox-image {
        width: 100%;
        height: auto;
        display: block;
        margin-bottom: 1rem;
      }

      .pe-lightbox-metadata {
        background: var(--s);
        padding: 1rem;
        border-radius: 0.5rem;
        color: var(--t);
      }

      .pe-metadata-row {
        display: flex;
        margin-bottom: 0.5rem;
        font-size: 0.9rem;
      }

      .pe-metadata-label {
        font-weight: 600;
        margin-right: 1rem;
        color: var(--m);
        min-width: 100px;
      }

      .pe-lightbox-nav {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        width: 100%;
        display: flex;
        justify-content: space-between;
        padding: 0 1rem;
        pointer-events: none;
      }

      .pe-nav-btn {
        pointer-events: all;
        width: 50px;
        height: 50px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.2);
        border: 2px solid white;
        color: white;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.5rem;
        transition: all 0.2s;
      }

      .pe-nav-btn:hover {
        background: rgba(255, 255, 255, 0.3);
      }

      /* Progress Bar */
      .pe-progress-container {
        width: 100%;
        height: 4px;
        background: var(--s2);
        border-radius: 2px;
        overflow: hidden;
        margin-bottom: 1rem;
      }

      .pe-progress-bar {
        height: 100%;
        background: var(--orange);
        width: 0%;
        transition: width 0.3s;
      }

      .pe-progress-text {
        font-size: 0.85rem;
        color: var(--m);
        text-align: center;
        margin-top: 0.5rem;
      }

      /* Category Groups */
      .pe-tag-category {
        margin-bottom: 1.5rem;
      }

      .pe-category-title {
        font-size: 0.8rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--m);
        margin-bottom: 0.75rem;
      }

      .pe-tag-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }

      /* Empty State */
      .pe-empty-state {
        text-align: center;
        padding: 2rem;
        color: var(--m);
      }

      .pe-empty-icon {
        font-size: 3rem;
        margin-bottom: 1rem;
      }

      /* Staging Badge */
      .pe-staged-badge {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        background: var(--orange);
        color: white;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 600;
        font-size: 0.8rem;
      }
    `;

    const styleEl = document.createElement('style');
    styleEl.id = 'photo-engine-styles';
    styleEl.textContent = styles;
    document.head.appendChild(styleEl);
  }

  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================

  function generateId() {
    return Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  function formatDate(date) {
    if (typeof date === 'number') date = new Date(date);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  function resizeImage(canvas, maxDimension, quality) {
    return new Promise((resolve) => {
      const ctx = canvas.getContext('2d');
      const width = canvas.width;
      const height = canvas.height;
      const scale = Math.min(1, maxDimension / Math.max(width, height));

      const newWidth = width * scale;
      const newHeight = height * scale;

      const resized = document.createElement('canvas');
      resized.width = newWidth;
      resized.height = newHeight;
      resized.getContext('2d').drawImage(canvas, 0, 0, newWidth, newHeight);

      resized.toBlob(resolve, 'image/jpeg', quality);
    });
  }

  function generateThumbnail(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const size = 200;
          canvas.width = size;
          canvas.height = size;

          const scale = Math.max(size / img.width, size / img.height);
          const x = (size / 2) - (img.width / 2) * scale;
          const y = (size / 2) - (img.height / 2) * scale;
          ctx.drawImage(img, x, y, img.width * scale, img.height * scale);

          canvas.toBlob(resolve, 'image/jpeg', 0.8);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(blob);
    });
  }

  // ============================================================================
  // CAMERA CAPTURE
  // ============================================================================

  async function openCamera(leadId) {
    state.currentLeadId = leadId;
    injectStyles();

    const modal = document.createElement('div');
    modal.className = 'pe-modal';
    modal.id = 'photo-camera-modal';

    modal.innerHTML = `
      <div class="pe-modal-header">
        <div class="pe-modal-title">Camera Capture</div>
        <button class="pe-close-btn" onclick="this.closest('.pe-modal').remove()">X</button>
      </div>
      <div class="pe-camera-container">
        <div class="pe-preset-indicator" id="preset-indicator"></div>
        <video class="pe-camera-video" id="camera-video" playsinline autoplay></video>
        <div class="pe-camera-controls">
          <button class="pe-icon-btn" id="flash-btn" title="Toggle Flash">Flash</button>
          <button class="pe-icon-btn" id="switch-camera-btn" title="Switch Camera">Switch</button>
          <button class="pe-capture-btn" id="capture-btn" title="Capture Photo">Capture</button>
          <button class="pe-icon-btn" id="preset-btn" title="Quality Preset">Preset</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const video = modal.querySelector('#camera-video');
    const captureBtn = modal.querySelector('#capture-btn');
    const switchCameraBtn = modal.querySelector('#switch-camera-btn');
    const flashBtn = modal.querySelector('#flash-btn');
    const presetBtn = modal.querySelector('#preset-btn');
    const presetIndicator = modal.querySelector('#preset-indicator');

    let facingMode = 'environment';
    let imageCapture = null;
    let torch = false;

    // Update preset indicator
    presetIndicator.textContent = QUALITY_PRESETS[state.currentPreset].label;

    // Start camera
    try {
      const constraints = {
        video: {
          facingMode: facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1440 }
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      state.cameraStream = stream;
      video.srcObject = stream;

      // Initialize ImageCapture API for flash
      const videoTrack = stream.getVideoTracks()[0];
      imageCapture = new ImageCapture(videoTrack);

      // Check for flash capability
      const capabilities = videoTrack.getCapabilities();
      if (!capabilities.torch) {
        flashBtn.style.opacity = '0.5';
        flashBtn.disabled = true;
      }
    } catch (err) {
      showToast('Camera access denied. Please allow camera permissions.', 'error');
      modal.remove();
      return;
    }

    // Switch camera
    switchCameraBtn.onclick = async () => {
      facingMode = facingMode === 'environment' ? 'user' : 'environment';
      if (state.cameraStream) {
        state.cameraStream.getTracks().forEach(t => t.stop());
      }

      try {
        const constraints = {
          video: {
            facingMode: facingMode,
            width: { ideal: 1920 },
            height: { ideal: 1440 }
          },
          audio: false
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        state.cameraStream = stream;
        video.srcObject = stream;

        const videoTrack = stream.getVideoTracks()[0];
        imageCapture = new ImageCapture(videoTrack);
      } catch (err) {
        showToast('Could not switch camera', 'error');
      }
    };

    // Flash toggle
    flashBtn.onclick = async () => {
      if (!imageCapture) return;
      torch = !torch;
      try {
        const track = state.cameraStream.getVideoTracks()[0];
        await track.applyConstraints({ advanced: [{ torch: torch }] });
        flashBtn.classList.toggle('active', torch);
      } catch (err) {
        showToast('Flash not available', 'warning');
      }
    };

    // Preset selector
    presetBtn.onclick = () => {
      const presetKeys = Object.keys(QUALITY_PRESETS);
      const current = presetKeys.indexOf(state.currentPreset);
      const next = (current + 1) % presetKeys.length;
      state.currentPreset = presetKeys[next];
      localStorage.setItem('photoEnginePreset', state.currentPreset);
      presetIndicator.textContent = QUALITY_PRESETS[state.currentPreset].label;
    };

    // Capture photo
    captureBtn.onclick = async () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);

        const preset = QUALITY_PRESETS[state.currentPreset];
        const blob = await resizeImage(canvas, preset.maxDimension, preset.jpegQuality);

        // Stop camera
        state.cameraStream.getTracks().forEach(t => t.stop());
        modal.remove();

        // Show preview
        showPreview(blob, leadId);
      } catch (err) {
        showToast('Failed to capture photo', 'error');
        console.error(err);
      }
    };
  }

  // ============================================================================
  // PREVIEW & TAGGING
  // ============================================================================

  async function showPreview(blob, leadId) {
    const modal = document.createElement('div');
    modal.className = 'pe-modal';
    modal.id = 'photo-preview-modal';

    const reader = new FileReader();
    reader.onload = (e) => {
      const imageData = e.target.result;

      modal.innerHTML = `
        <div class="pe-modal-header">
          <div class="pe-modal-title">Review & Tag</div>
          <button class="pe-close-btn" onclick="document.getElementById('photo-preview-modal')?.remove()">X</button>
        </div>
        <div class="pe-preview-container">
          <img class="pe-preview-image" src="${imageData}" alt="Preview" />

          <div class="pe-preview-section">
            <label class="pe-input-label">Description</label>
            <textarea class="pe-textarea" id="photo-description" placeholder="Add notes about this photo..."></textarea>
          </div>

          <div class="pe-preview-section">
            <label class="pe-input-label">Location</label>
            <input class="pe-input" id="photo-location" type="text" placeholder="e.g., Front slope, Ridge, etc." />
          </div>

          <div class="pe-preview-section">
            <label class="pe-input-label">Tags</label>
            <div id="tag-picker-container"></div>
          </div>

          <div class="pe-preview-section">
            <label class="pe-input-label">Quality Preset</label>
            <div style="padding: 0.75rem; background: var(--s2); border-radius: 0.5rem; color: var(--t); font-size: 0.9rem;">
              ${QUALITY_PRESETS[state.currentPreset].label} - ${QUALITY_PRESETS[state.currentPreset].description}
            </div>
          </div>

          <div class="pe-button-group">
            <button class="pe-btn pe-btn-secondary" onclick="document.getElementById('photo-preview-modal')?.remove()">
              Retake
            </button>
            <button class="pe-btn pe-btn-primary" id="upload-btn">
              Upload
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      // Render tag picker
      const tagContainer = modal.querySelector('#tag-picker-container');
      tagContainer.innerHTML = Object.entries(TAG_CATEGORIES).map(([catKey, catData]) => `
        <div class="pe-tag-category">
          <div class="pe-category-title" style="color: ${catData.color};">${catData.label}</div>
          <div class="pe-tag-grid">
            ${catData.tags.map(tag => `
              <button class="pe-tag-pill"
                      style="border-color: ${catData.color}; color: ${catData.color};"
                      data-tag="${tag}"
                      onclick="this.classList.toggle('selected')">
                ${tag.replace(/_/g, ' ')}
              </button>
            `).join('')}
          </div>
        </div>
      `).join('');

      // Handle upload
      const uploadBtn = modal.querySelector('#upload-btn');
      uploadBtn.onclick = async () => {
        uploadBtn.disabled = true;
        uploadBtn.textContent = 'Uploading...';

        const selectedTags = Array.from(modal.querySelectorAll('.pe-tag-pill.selected'))
          .map(el => el.dataset.tag);
        const description = modal.querySelector('#photo-description').value;
        const location = modal.querySelector('#photo-location').value;

        try {
          await uploadPhotoToFirebase(blob, leadId, selectedTags, description, location);
          modal.remove();
          showToast('Photo uploaded successfully!', 'success');
        } catch (err) {
          showToast('Upload failed: ' + err.message, 'error');
          uploadBtn.disabled = false;
          uploadBtn.textContent = 'Upload';
        }
      };
    };

    reader.readAsDataURL(blob);
  }

  // ============================================================================
  // FIREBASE UPLOAD
  // ============================================================================

  async function uploadPhotoToFirebase(blob, leadId, tags, description, location) {
    if (!window._storage || !window._db || !window._user) {
      throw new Error('Firebase not initialized');
    }

    const { ref, uploadBytes, getDownloadURL } = await import(
      'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js'
    );
    const { doc, setDoc, serverTimestamp } = await import(
      'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
    );

    const uid = window._user.uid;
    const timestamp = Date.now();
    const filename = `${timestamp}_${state.currentPreset}.jpg`;
    const photoPath = `photos/${uid}/${leadId}/${filename}`;

    try {
      // Upload main photo
      const photoRef = ref(window._storage, photoPath);
      await uploadBytes(photoRef, blob);
      const photoUrl = await getDownloadURL(photoRef);

      // Generate and upload thumbnail
      const thumbBlob = await generateThumbnail(blob);
      const thumbPath = `photos/${uid}/${leadId}/thumbs/${timestamp}_thumb.jpg`;
      const thumbRef = ref(window._storage, thumbPath);
      await uploadBytes(thumbRef, thumbBlob);
      const thumbUrl = await getDownloadURL(thumbRef);

      // Store metadata in Firestore
      const photoId = generateId();
      const photoData = {
        id: photoId,
        leadId,
        userId: uid,
        url: photoUrl,
        thumbUrl,
        tags,
        description,
        location,
        quality: state.currentPreset,
        width: blob.size > 0 ? 'auto' : 0,
        height: 'auto',
        fileSize: blob.size,
        capturedAt: timestamp,
        uploadedAt: serverTimestamp(),
        reportSections: [],
        geoLocation: null
      };

      const photoDocRef = doc(window._db, 'photos', photoId);
      await setDoc(photoDocRef, photoData);

      // Clear cache for this lead
      delete state.photoCache[leadId];

      return photoData;
    } catch (err) {
      console.error('Upload error:', err);
      throw err;
    }
  }

  // ============================================================================
  // GALLERY & BROWSER
  // ============================================================================

  async function renderGallery(containerId, leadId) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error('Container not found:', containerId);
      return;
    }

    injectStyles();
    container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--m);">Loading photos...</div>';

    try {
      const photos = await getPhotosForLead(leadId);

      container.innerHTML = `
        <div class="pe-gallery-container">
          <div class="pe-gallery-toolbar">
            <select class="pe-toolbar-select" id="filter-tag" onchange="window.PhotoEngine._filterGallery('${leadId}')">
              <option value="">All Photos</option>
              ${Object.entries(TAG_CATEGORIES).map(([_, cat]) =>
                cat.tags.map(tag => `<option value="${tag}">${cat.label}: ${tag.replace(/_/g, ' ')}</option>`).join('')
              ).join('')}
            </select>
            <select class="pe-toolbar-select" id="sort-by" onchange="window.PhotoEngine._sortGallery('${leadId}')">
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="quality">Quality Preset</option>
            </select>
            <select class="pe-toolbar-select" id="view-mode">
              <option value="grid">Grid View</option>
              <option value="list">List View</option>
            </select>
          </div>
          <div id="gallery-content"></div>
        </div>
      `;

      renderGalleryGrid(container.querySelector('#gallery-content'), photos, leadId);
    } catch (err) {
      container.innerHTML = `<div class="pe-empty-state"><div class="pe-empty-icon">Camera</div><p>No photos yet</p></div>`;
      console.error('Gallery error:', err);
    }
  }

  function renderGalleryGrid(container, photos, leadId) {
    if (photos.length === 0) {
      container.innerHTML = `<div class="pe-empty-state"><div class="pe-empty-icon">Camera</div><p>No photos found</p></div>`;
      return;
    }

    container.innerHTML = `
      <div class="pe-gallery-grid">
        ${photos.map(photo => `
          <div class="pe-gallery-item" data-photo-id="${photo.id}">
            <img class="pe-gallery-thumbnail" src="${photo.thumbUrl || photo.url}" alt="Photo"
                 onclick="window.PhotoEngine._openLightbox('${photo.id}', '${leadId}')" />
            ${state.stagedPhotos[leadId]?.includes(photo.id) ? `<div class="pe-staged-badge">OK</div>` : ''}
            <input type="checkbox" class="pe-gallery-checkbox" data-photo-id="${photo.id}" />
            <div class="pe-gallery-tags">
              ${photo.tags.slice(0, 3).map(tag => `<span class="pe-mini-tag">${tag}</span>`).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // ============================================================================
  // LIGHTBOX
  // ============================================================================

  async function openLightbox(photoId, leadId) {
    if (!window._db) return;

    const { doc, getDoc } = await import(
      'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
    );

    try {
      const photoRef = doc(window._db, 'photos', photoId);
      const photoSnap = await getDoc(photoRef);

      if (!photoSnap.exists()) {
        showToast('Photo not found', 'error');
        return;
      }

      const photo = photoSnap.data();

      const lightbox = document.createElement('div');
      lightbox.className = 'pe-lightbox';
      lightbox.id = 'photo-lightbox';

      lightbox.innerHTML = `
        <div class="pe-lightbox-content">
          <img class="pe-lightbox-image" src="${photo.url}" alt="Full size" />
          <div class="pe-lightbox-metadata">
            <div class="pe-metadata-row">
              <div class="pe-metadata-label">Date</div>
              <div>${formatDate(photo.capturedAt)}</div>
            </div>
            ${photo.description ? `
              <div class="pe-metadata-row">
                <div class="pe-metadata-label">Notes</div>
                <div>${photo.description}</div>
              </div>
            ` : ''}
            ${photo.location ? `
              <div class="pe-metadata-row">
                <div class="pe-metadata-label">Location</div>
                <div>${photo.location}</div>
              </div>
            ` : ''}
            <div class="pe-metadata-row">
              <div class="pe-metadata-label">Quality</div>
              <div>${QUALITY_PRESETS[photo.quality]?.label || photo.quality}</div>
            </div>
            <div class="pe-metadata-row">
              <div class="pe-metadata-label">Size</div>
              <div>${formatFileSize(photo.fileSize)}</div>
            </div>
            ${photo.tags.length > 0 ? `
              <div class="pe-metadata-row">
                <div class="pe-metadata-label">Tags</div>
                <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
                  ${photo.tags.map(tag => `<span style="background: var(--orange); color: white; padding: 0.2rem 0.5rem; border-radius: 0.25rem; font-size: 0.8rem;">${tag}</span>`).join('')}
                </div>
              </div>
            ` : ''}
            <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
              <button class="pe-btn pe-btn-primary" style="flex: 1;" onclick="window.PhotoEngine._stagePhoto('${photoId}', '${leadId}')">
                Stage for Report
              </button>
              <button class="pe-btn pe-btn-secondary" style="flex: 1;" onclick="window.PhotoEngine._deletePhoto('${photoId}')">
                Delete
              </button>
            </div>
          </div>
        </div>
        <div class="pe-lightbox-nav">
          <button class="pe-nav-btn" onclick="document.getElementById('photo-lightbox')?.remove()">X</button>
          <button class="pe-nav-btn" onclick="document.getElementById('photo-lightbox')?.remove()">OK</button>
        </div>
      `;

      document.body.appendChild(lightbox);
      lightbox.onclick = (e) => {
        if (e.target === lightbox) lightbox.remove();
      };
    } catch (err) {
      showToast('Failed to load photo', 'error');
      console.error(err);
    }
  }

  // ============================================================================
  // FIRESTORE QUERIES
  // ============================================================================

  async function getPhotosForLead(leadId) {
    if (!window._db) throw new Error('Firestore not initialized');

    if (state.photoCache[leadId]) {
      return state.photoCache[leadId];
    }

    const { collection, query, where, getDocs, orderBy } = await import(
      'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
    );

    const q = query(
      collection(window._db, 'photos'),
      where('leadId', '==', leadId),
      orderBy('capturedAt', 'desc')
    );

    const querySnapshot = await getDocs(q);
    const photos = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    state.photoCache[leadId] = photos;
    return photos;
  }

  async function deletePhotoFromFirebase(photoId) {
    if (!window._storage || !window._db) throw new Error('Firebase not initialized');

    const { deleteDoc, doc, getDoc } = await import(
      'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
    );
    const { ref, deleteObject } = await import(
      'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js'
    );

    try {
      // Get photo metadata
      const photoRef = doc(window._db, 'photos', photoId);
      const photoSnap = await getDoc(photoRef);

      if (photoSnap.exists()) {
        const photo = photoSnap.data();
        const uid = window._user.uid;
        const photoPath = `photos/${uid}/${photo.leadId}/${photo.url.split('/').pop()}`;
        const thumbPath = `photos/${uid}/${photo.leadId}/thumbs/${photoSnap.id}_thumb.jpg`;

        // Delete from storage
        try {
          await deleteObject(ref(window._storage, photoPath));
        } catch (e) {
          console.warn('Storage deletion failed:', e);
        }

        try {
          await deleteObject(ref(window._storage, thumbPath));
        } catch (e) {
          console.warn('Thumbnail deletion failed:', e);
        }

        // Delete from Firestore
        await deleteDoc(photoRef);

        // Clear cache
        delete state.photoCache[photo.leadId];
      }
    } catch (err) {
      console.error('Delete error:', err);
      throw err;
    }
  }

  // ============================================================================
  // STAGING & REPORT
  // ============================================================================

  function stagePhoto(photoId, leadId) {
    if (!state.stagedPhotos[leadId]) {
      state.stagedPhotos[leadId] = [];
    }
    if (!state.stagedPhotos[leadId].includes(photoId)) {
      state.stagedPhotos[leadId].push(photoId);
    }
    showToast('Photo staged for report', 'success');
  }

  function clearStagedPhotos(leadId) {
    delete state.stagedPhotos[leadId];
    showToast('Staging cleared', 'success');
  }

  async function getStagedPhotos(leadId) {
    const stagedIds = state.stagedPhotos[leadId] || [];
    if (stagedIds.length === 0) return [];

    const allPhotos = await getPhotosForLead(leadId);
    return allPhotos.filter(p => stagedIds.includes(p.id));
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  window.PhotoEngine = {
    openCamera,
    openGallery: renderGallery,
    getPhotosForReport: getPhotosForLead,
    getPhotosByTag: async (leadId, tag) => {
      const photos = await getPhotosForLead(leadId);
      return photos.filter(p => p.tags && p.tags.includes(tag));
    },
    getStagedPhotos,
    clearStagedPhotos,
    deletePhoto: deletePhotoFromFirebase,
    uploadFromFile: async (leadId, file, tags = [], description = '') => {
      if (!(file instanceof Blob)) {
        throw new Error('Invalid file');
      }
      return uploadPhotoToFirebase(file, leadId, tags, description, '');
    },
    updatePhotoTags: async (photoId, tags) => {
      if (!window._db) throw new Error('Firestore not initialized');
      const { doc, updateDoc } = await import(
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
      );
      await updateDoc(doc(window._db, 'photos', photoId), { tags });
    },
    updatePhotoDescription: async (photoId, description) => {
      if (!window._db) throw new Error('Firestore not initialized');
      const { doc, updateDoc } = await import(
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
      );
      await updateDoc(doc(window._db, 'photos', photoId), { description });
    },

    // Internal methods (prefixed with _)
    _filterGallery: async (leadId) => {
      // Placeholder for filter logic
    },
    _sortGallery: async (leadId) => {
      // Placeholder for sort logic
    },
    _openLightbox: openLightbox,
    _stagePhoto: stagePhoto,
    _deletePhoto: (photoId) => {
      if (confirm('Delete this photo? This cannot be undone.')) {
        deletePhotoFromFirebase(photoId).then(() => {
          document.getElementById('photo-lightbox')?.remove();
          showToast('Photo deleted', 'success');
        }).catch(err => showToast('Delete failed: ' + err.message, 'error'));
      }
    }
  };

  // Inject styles on load
  document.addEventListener('DOMContentLoaded', injectStyles);
  if (document.readyState === 'loading') {
    injectStyles();
  }
})();
