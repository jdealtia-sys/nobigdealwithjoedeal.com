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
    photoCache: {}, // { leadId: [photoData] }
    sessionPhotoCount: 0,
    lastThumbUrl: null,
    uploadQueue: [] // offline-safe queue
  };

  // ============================================================================
  // STYLES - Injected into DOM
  // ============================================================================

  function injectStyles() {
    if (document.getElementById('photo-engine-styles')) return;

    const styles = `
      /* ═══════════════════════════════════════════
         NBD PRO CAMERA — Professional Inspection Tool
         Phone-first, one-handed, tag-as-you-go
         ═══════════════════════════════════════════ */

      .pe-modal {
        position: fixed;
        top:0;right:0;bottom:0;left:0;
        background: #000;
        display: flex;
        flex-direction: column;
        z-index: 9999;
        font-family: 'Barlow Condensed', 'Barlow', -apple-system, sans-serif;
        color: #fff;
        -webkit-user-select: none;
        user-select: none;
      }

      /* ── CAMERA TOP BAR ── */
      .pe-cam-topbar {
        position: absolute;
        top: 0; left: 0; right: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        padding-top: max(12px, env(safe-area-inset-top));
        background: linear-gradient(to bottom, rgba(0,0,0,.7) 0%, transparent 100%);
        z-index: 10;
      }
      .pe-cam-back {
        width: 44px; height: 44px;
        background: rgba(255,255,255,.12);
        -webkit-backdrop-filter:blur(20px);backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
        border: none; border-radius: 50%;
        color: #fff; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
      }
      .pe-cam-back:active { transform: scale(.9); }
      .pe-cam-back svg { width: 22px; height: 22px; }
      .pe-cam-title {
        font-size: 15px; font-weight: 700;
        letter-spacing: .08em; text-transform: uppercase;
        text-shadow: 0 1px 4px rgba(0,0,0,.5);
      }
      .pe-cam-tools {
        display: flex; gap: 8px; align-items: center;
      }
      .pe-cam-tool {
        width: 44px; height: 44px;
        background: rgba(255,255,255,.12);
        -webkit-backdrop-filter:blur(20px);backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
        border: none; border-radius: 50%;
        color: #fff; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: all .2s;
      }
      .pe-cam-tool:active { transform: scale(.9); }
      .pe-cam-tool.active { background: var(--orange, #e8720c); }
      .pe-cam-tool svg { width: 20px; height: 20px; }
      .pe-preset-badge {
        padding: 4px 10px;
        background: rgba(255,255,255,.15);
        -webkit-backdrop-filter:blur(20px);backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(255,255,255,.2);
        border-radius: 6px;
        font-size: 11px; font-weight: 700;
        letter-spacing: .1em; text-transform: uppercase;
        color: #fff; cursor: pointer;
      }
      .pe-preset-badge:active { opacity: .7; }

      /* ── VIEWFINDER ── */
      .pe-cam-viewfinder {
        flex: 1;
        position: relative;
        overflow: hidden;
        background: #000;
      }
      .pe-cam-video {
        width: 100%; height: 100%;
        object-fit: cover;
      }

      /* ── BOTTOM CONTROLS ── */
      .pe-cam-bottom {
        position: absolute;
        bottom: 0; left: 0; right: 0;
        padding: 20px 24px;
        padding-bottom: max(24px, env(safe-area-inset-bottom));
        background: linear-gradient(to top, rgba(0,0,0,.75) 0%, transparent 100%);
        display: flex;
        align-items: center;
        justify-content: space-between;
        z-index: 10;
      }
      .pe-cam-counter {
        width: 48px; height: 48px;
        background: rgba(255,255,255,.12);
        -webkit-backdrop-filter:blur(20px);backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
        border-radius: 12px;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        font-size: 18px; font-weight: 800;
        line-height: 1;
      }
      .pe-cam-counter-label {
        font-size: 8px; font-weight: 600;
        letter-spacing: .1em; text-transform: uppercase;
        opacity: .6; margin-top: 2px;
      }
      .pe-cam-capture {
        width: 72px; height: 72px;
        border-radius: 50%;
        background: transparent;
        border: 4px solid rgba(255,255,255,.8);
        cursor: pointer;
        position: relative;
        transition: all .15s;
      }
      .pe-cam-capture::after {
        content: '';
        position: absolute;
        inset: 4px;
        border-radius: 50%;
        background: var(--orange, #e8720c);
        transition: all .15s;
      }
      .pe-cam-capture:active { transform: scale(.92); }
      .pe-cam-capture:active::after { background: #fff; }
      @keyframes pe-flash { 0%{opacity:1} 100%{opacity:0} }
      .pe-cam-flash-overlay {
        position: absolute; top:0;right:0;bottom:0;left:0;
        background: #fff; opacity: 0;
        pointer-events: none; z-index: 5;
      }
      .pe-cam-flash-overlay.flash {
        animation: pe-flash .15s ease-out;
      }
      .pe-cam-thumb {
        width: 48px; height: 48px;
        border-radius: 12px;
        border: 2px solid rgba(255,255,255,.4);
        background: rgba(255,255,255,.08);
        object-fit: cover;
        cursor: pointer;
      }
      .pe-cam-thumb-empty {
        width: 48px; height: 48px;
        border-radius: 12px;
        background: rgba(255,255,255,.06);
        border: 2px dashed rgba(255,255,255,.15);
      }

      /* ── UPLOAD QUEUE INDICATOR ── */
      .pe-queue-bar {
        position: absolute;
        top: 0; left: 0; right: 0;
        height: 3px;
        background: rgba(255,255,255,.1);
        z-index: 15;
      }
      .pe-queue-progress {
        height: 100%;
        background: var(--orange, #e8720c);
        transition: width .3s;
        border-radius: 0 2px 2px 0;
      }
      .pe-queue-label {
        position: absolute;
        top: 6px; right: 16px;
        font-size: 10px; font-weight: 600;
        color: var(--orange, #e8720c);
        letter-spacing: .06em;
        z-index: 15;
      }

      /* ── REVIEW / TAG SCREEN ── */
      .pe-modal-header {
        display: flex; align-items: center;
        padding: 14px 16px;
        padding-top: max(14px, env(safe-area-inset-top));
        background: var(--s, #111418);
        border-bottom: 1px solid var(--br, rgba(255,255,255,.07));
        gap: 12px;
      }
      .pe-modal-back {
        width: 36px; height: 36px;
        background: none; border: none;
        color: var(--t, #E8EAF0); cursor: pointer;
        display: flex; align-items: center; justify-content: center;
      }
      .pe-modal-back svg { width: 20px; height: 20px; }
      .pe-modal-title {
        font-size: 16px; font-weight: 700;
        letter-spacing: .04em; text-transform: uppercase;
        color: var(--t, #E8EAF0);
      }

      .pe-preview-container {
        flex: 1; overflow-y: auto;
        padding: 16px;
        padding-bottom: max(16px, env(safe-area-inset-bottom));
        background: var(--bg, #0A0C0F);
      }
      .pe-preview-image {
        width: 100%; max-height: 320px;
        object-fit: contain;
        border-radius: 12px;
        background: var(--s, #111418);
        margin-bottom: 20px;
      }
      .pe-section {
        margin-bottom: 20px;
      }
      .pe-section-title {
        display: flex; align-items: center; gap: 8px;
        font-size: 11px; font-weight: 700;
        letter-spacing: .12em; text-transform: uppercase;
        color: var(--m, #6B7280);
        margin-bottom: 10px;
      }
      .pe-section-title svg { width: 14px; height: 14px; opacity: .6; }
      .pe-pill-scroll {
        display: flex; gap: 8px;
        overflow-x: auto; -webkit-overflow-scrolling: touch;
        scrollbar-width: none; padding-bottom: 4px;
      }
      .pe-pill-scroll::-webkit-scrollbar { display: none; }

      .pe-tag-pill {
        padding: 8px 16px;
        border-radius: 999px;
        border: 1.5px solid rgba(255,255,255,.15);
        background: var(--s2, #181C22);
        color: var(--t, #E8EAF0);
        cursor: pointer;
        font-size: 13px; font-weight: 500;
        white-space: nowrap;
        transition: all .15s;
        flex-shrink: 0;
      }
      .pe-tag-pill:active { transform: scale(.95); }
      .pe-tag-pill.selected {
        background: var(--orange, #e8720c);
        border-color: var(--orange, #e8720c);
        color: #fff; font-weight: 600;
      }
      .pe-tag-pill.cat-damage.selected { background: #EF4444; border-color: #EF4444; }
      .pe-tag-pill.cat-location.selected { background: #3B82F6; border-color: #3B82F6; }
      .pe-tag-pill.cat-type.selected { background: #8B5CF6; border-color: #8B5CF6; }

      .pe-textarea, .pe-input {
        width: 100%; padding: 12px 14px;
        background: var(--s2, #181C22);
        border: 1px solid var(--br, rgba(255,255,255,.07));
        border-radius: 10px;
        color: var(--t, #E8EAF0);
        font-family: 'Barlow', sans-serif;
        font-size: 14px;
        box-sizing: border-box;
      }
      .pe-textarea:focus, .pe-input:focus {
        outline: none;
        border-color: var(--orange, #e8720c);
        box-shadow: 0 0 0 3px rgba(232,114,12,.12);
      }
      .pe-textarea { resize: none; min-height: 64px; }

      .pe-button-group {
        display: flex; gap: 10px;
        margin-top: 24px;
        padding-bottom: max(8px, env(safe-area-inset-bottom));
      }
      .pe-btn {
        flex: 1;
        padding: 14px 16px;
        border: none; border-radius: 12px;
        font-weight: 700; font-size: 14px;
        letter-spacing: .04em; text-transform: uppercase;
        cursor: pointer; transition: all .15s;
        font-family: 'Barlow Condensed', sans-serif;
      }
      .pe-btn:active { transform: scale(.97); }
      .pe-btn-primary {
        background: var(--orange, #e8720c);
        color: #fff;
      }
      .pe-btn-secondary {
        background: var(--s2, #181C22);
        color: var(--t, #E8EAF0);
        border: 1px solid var(--br, rgba(255,255,255,.07));
      }

      .pe-close-btn {
        background: none; border: none;
        color: var(--t, #E8EAF0); cursor: pointer;
        font-size: 1.5rem; padding: .5rem;
        display: flex; align-items: center; justify-content: center;
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
        box-shadow: 0 0 0 3px rgba(232, 114, 12, 0.2);
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
        background: rgba(232, 114, 12, 0.8);
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
      <div class="pe-cam-viewfinder">
        <video class="pe-cam-video" id="camera-video" playsinline autoplay muted></video>
        <div class="pe-cam-flash-overlay" id="cam-flash"></div>

        <!-- Top Bar -->
        <div class="pe-cam-topbar">
          <button class="pe-cam-back" id="cam-back-btn" title="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <span class="pe-cam-title">NBD Camera</span>
          <div class="pe-cam-tools">
            <button class="pe-preset-badge" id="preset-btn">${QUALITY_PRESETS[state.currentPreset].label.toUpperCase()}</button>
            <button class="pe-cam-tool" id="flash-btn" title="Flash">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            </button>
            <button class="pe-cam-tool" id="switch-camera-btn" title="Switch Camera">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7v4h-4"/><path d="M4 17v-4h4"/><path d="M7.5 7a9 9 0 0112.6 2.5"/><path d="M16.5 17A9 9 0 013.9 14.5"/></svg>
            </button>
          </div>
        </div>

        <!-- Bottom Controls -->
        <div class="pe-cam-bottom">
          <div class="pe-cam-counter" id="cam-counter">
            <span id="cam-count">${state.sessionPhotoCount}</span>
            <span class="pe-cam-counter-label">photos</span>
          </div>
          <button class="pe-cam-capture" id="capture-btn" title="Capture"></button>
          <div id="cam-thumb-slot">${state.lastThumbUrl ? `<img class="pe-cam-thumb" src="${state.lastThumbUrl}" alt="Last">` : '<div class="pe-cam-thumb-empty"></div>'}</div>
        </div>
      </div>

      <!-- Upload Queue Indicator -->
      <div class="pe-queue-bar" id="queue-bar" style="display:none">
        <div class="pe-queue-progress" id="queue-progress" style="width:0%"></div>
      </div>
      <div class="pe-queue-label" id="queue-label" style="display:none"></div>
    `;

    document.body.appendChild(modal);

    const video = modal.querySelector('#camera-video');
    const captureBtn = modal.querySelector('#capture-btn');
    const switchCameraBtn = modal.querySelector('#switch-camera-btn');
    const flashBtn = modal.querySelector('#flash-btn');
    const presetBtn = modal.querySelector('#preset-btn');
    const backBtn = modal.querySelector('#cam-back-btn');

    let facingMode = 'environment';
    let imageCapture = null;
    let torch = false;

    // Back button closes camera
    backBtn.onclick = () => {
      if (state.cameraStream) state.cameraStream.getTracks().forEach(t => t.stop());
      modal.remove();
    };

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

      // Check for flash capability (Safari doesn't support ImageCapture API)
      const videoTrack = stream.getVideoTracks()[0];
      try {
        const capabilities = videoTrack.getCapabilities ? videoTrack.getCapabilities() : {};
        if (!capabilities.torch) {
          flashBtn.style.opacity = '0.3';
          flashBtn.disabled = true;
        }
      } catch(e) {
        flashBtn.style.opacity = '0.3';
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
      } catch (err) {
        showToast('Could not switch camera', 'error');
      }
    };

    // Flash toggle (works without ImageCapture API)
    flashBtn.onclick = async () => {
      if (flashBtn.disabled) return;
      torch = !torch;
      try {
        const track = state.cameraStream.getVideoTracks()[0];
        await track.applyConstraints({ advanced: [{ torch: torch }] });
        flashBtn.classList.toggle('active', torch);
      } catch (err) {
        flashBtn.disabled = true;
        flashBtn.style.opacity = '0.3';
        showToast('Flash not available on this device', 'warning');
      }
    };

    // Preset selector
    presetBtn.onclick = () => {
      const presetKeys = Object.keys(QUALITY_PRESETS);
      const current = presetKeys.indexOf(state.currentPreset);
      const next = (current + 1) % presetKeys.length;
      state.currentPreset = presetKeys[next];
      localStorage.setItem('photoEnginePreset', state.currentPreset);
      presetBtn.textContent = QUALITY_PRESETS[state.currentPreset].label.toUpperCase();
    };

    // Capture photo
    captureBtn.onclick = async () => {
      try {
        // Flash effect
        const flashEl = modal.querySelector('#cam-flash');
        flashEl.classList.remove('flash');
        void flashEl.offsetWidth; // force reflow
        flashEl.classList.add('flash');

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);

        const preset = QUALITY_PRESETS[state.currentPreset];
        const blob = await resizeImage(canvas, preset.maxDimension, preset.jpegQuality);

        // Update thumbnail
        const thumbUrl = URL.createObjectURL(blob);
        state.lastThumbUrl = thumbUrl;
        const thumbSlot = modal.querySelector('#cam-thumb-slot');
        if (thumbSlot) thumbSlot.innerHTML = `<img class="pe-cam-thumb" src="${thumbUrl}" alt="Last">`;

        // Stop camera
        state.cameraStream.getTracks().forEach(t => t.stop());
        modal.remove();

        // Show preview with "Save & Next" flow
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

    const QUICK_LOCATIONS = ['Front Slope', 'Back Slope', 'Left Slope', 'Right Slope', 'Ridge', 'Valley', 'Eave', 'Gutter', 'Chimney', 'Interior'];
    const QUICK_DAMAGE = ['Hail', 'Wind', 'Impact', 'Wear', 'Leak', 'Missing Shingles', 'Lifted', 'Cracked', 'Granule Loss', 'Flashing'];
    const QUICK_TYPE = ['Before', 'During', 'After', 'Close-Up', 'Overview', 'Measurement'];

    const reader = new FileReader();
    reader.onload = (e) => {
      const imageData = e.target.result;

      modal.innerHTML = `
        <div class="pe-modal-header">
          <button class="pe-modal-back" onclick="document.getElementById('photo-preview-modal')?.remove()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <div class="pe-modal-title">Review & Tag</div>
        </div>
        <div class="pe-preview-container">
          <img class="pe-preview-image" src="${imageData}" alt="Preview" />

          <div class="pe-section">
            <div class="pe-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="10" r="3"/><path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 10-16 0c0 3 2.7 7 8 11.7z"/></svg>
              Location
            </div>
            <div class="pe-pill-scroll" id="location-pills">
              ${QUICK_LOCATIONS.map(loc => `<button class="pe-tag-pill cat-location" data-tag="${loc.toLowerCase().replace(/ /g,'_')}" onclick="this.classList.toggle('selected')">${loc}</button>`).join('')}
            </div>
          </div>

          <div class="pe-section">
            <div class="pe-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              Damage Type
            </div>
            <div class="pe-pill-scroll" id="damage-pills">
              ${QUICK_DAMAGE.map(d => `<button class="pe-tag-pill cat-damage" data-tag="${d.toLowerCase().replace(/ /g,'_')}" onclick="this.classList.toggle('selected')">${d}</button>`).join('')}
            </div>
          </div>

          <div class="pe-section">
            <div class="pe-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
              Photo Type
            </div>
            <div class="pe-pill-scroll" id="type-pills">
              ${QUICK_TYPE.map(t => `<button class="pe-tag-pill cat-type" data-tag="${t.toLowerCase().replace(/ /g,'_').replace(/-/g,'_')}" onclick="this.classList.toggle('selected')">${t}</button>`).join('')}
            </div>
          </div>

          <div class="pe-section">
            <div class="pe-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Notes
            </div>
            <textarea class="pe-textarea" id="photo-description" placeholder="Optional — add notes about this photo..."></textarea>
          </div>

          <div class="pe-button-group">
            <button class="pe-btn pe-btn-secondary" onclick="document.getElementById('photo-preview-modal')?.remove()">Retake</button>
            <button class="pe-btn pe-btn-primary" id="save-next-btn">Save & Next</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      // Handle Save & Next
      const saveBtn = modal.querySelector('#save-next-btn');
      saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        saveBtn.textContent = 'SAVING...';

        const selectedTags = Array.from(modal.querySelectorAll('.pe-tag-pill.selected'))
          .map(el => el.dataset.tag);
        const description = modal.querySelector('#photo-description').value;

        // Extract location from selected location pills
        const locationTags = Array.from(modal.querySelectorAll('#location-pills .pe-tag-pill.selected'))
          .map(el => el.textContent.trim());
        const location = locationTags.join(', ');

        try {
          await uploadPhotoToFirebase(blob, leadId, selectedTags, description, location);
          state.sessionPhotoCount++;
          modal.remove();
          showToast(`Photo ${state.sessionPhotoCount} saved`, 'success');

          // Reopen camera for next photo
          setTimeout(() => openCamera(leadId), 300);
        } catch (err) {
          // Queue for offline upload
          try {
            const dataUrl = imageData;
            state.uploadQueue.push({ dataUrl, leadId, tags: selectedTags, description, location, timestamp: Date.now() });
            state.sessionPhotoCount++;
            modal.remove();
            showToast(`Photo queued (offline) — will upload when connected`, 'warning');
            setTimeout(() => openCamera(leadId), 300);
          } catch (queueErr) {
            showToast('Save failed: ' + err.message, 'error');
            saveBtn.disabled = false;
            saveBtn.textContent = 'SAVE & NEXT';
          }
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
      where('userId', '==', window._auth?.currentUser?.uid),
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
      const filterTag = document.getElementById('filter-tag')?.value || '';
      const photos = await getPhotosForLead(leadId);
      const filtered = filterTag ? photos.filter(p => p.tags && p.tags.includes(filterTag)) : photos;
      const sortBy = document.getElementById('sort-by')?.value || 'newest';
      const sorted = [...filtered].sort((a, b) => {
        if (sortBy === 'oldest') return (a.capturedAt?.seconds || 0) - (b.capturedAt?.seconds || 0);
        if (sortBy === 'quality') return (b.quality || '').localeCompare(a.quality || '');
        return (b.capturedAt?.seconds || 0) - (a.capturedAt?.seconds || 0);
      });
      const container = document.getElementById('gallery-content');
      if (container) renderGalleryGrid(container, sorted, leadId);
    },
    _sortGallery: async (leadId) => {
      const filterTag = document.getElementById('filter-tag')?.value || '';
      const photos = await getPhotosForLead(leadId);
      const filtered = filterTag ? photos.filter(p => p.tags && p.tags.includes(filterTag)) : photos;
      const sortBy = document.getElementById('sort-by')?.value || 'newest';
      const sorted = [...filtered].sort((a, b) => {
        if (sortBy === 'oldest') return (a.capturedAt?.seconds || 0) - (b.capturedAt?.seconds || 0);
        if (sortBy === 'quality') return (b.quality || '').localeCompare(a.quality || '');
        return (b.capturedAt?.seconds || 0) - (a.capturedAt?.seconds || 0);
      });
      const container = document.getElementById('gallery-content');
      if (container) renderGalleryGrid(container, sorted, leadId);
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
