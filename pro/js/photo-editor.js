/**
 * ROOFING CRM - PHOTO EDITOR MODULE
 * Damage Annotation Tool for Insurance Claims
 *
 * Public API:
 * - window.NBDPhotoEditor.open(photoUrl, photoId, leadId)
 * - window.NBDPhotoEditor.close()
 */

(function() {
  'use strict';

  // ============================================
  // STATE & CONFIG
  // ============================================

  const CONFIG = {
    // Canvas defaults
    MAX_CANVAS_WIDTH: 1200,
    MAX_CANVAS_HEIGHT: 800,
    DEFAULT_LINE_WIDTH: 2,
    DEFAULT_OPACITY: 100,
    DEFAULT_COLOR: '#ff0000',

    // Tool types
    TOOLS: {
      SELECT: 'select',
      PEN: 'pen',
      LINE: 'line',
      ARROW: 'arrow',
      RECT: 'rect',
      CIRCLE: 'circle',
      TEXT: 'text',
      ERASER: 'eraser',
      HAIL: 'hail',
      WIND: 'wind',
      LEAK: 'leak',
      SHINGLE: 'shingle',
      CALLOUT: 'callout',
      MEASURE: 'measure',
      AREA: 'area',
      CROP: 'crop',
    },

    // Annotation types
    ANNOTATION_TYPES: {
      PEN: 'pen',
      LINE: 'line',
      ARROW: 'arrow',
      RECT: 'rect',
      CIRCLE: 'circle',
      TEXT: 'text',
      HAIL: 'hail',
      WIND: 'wind',
      LEAK: 'leak',
      SHINGLE: 'shingle',
      CALLOUT: 'callout',
      MEASURE: 'measure',
      AREA: 'area',
    },

    // Color palette
    COLOR_PALETTE: ['#ff0000', '#ff6600', '#ffcc00', '#00cc00', '#0088ff', '#cc00ff', '#ffffff', '#000000'],

    // Image adjustments limits
    ADJUST_LIMITS: {
      brightness: { min: -100, max: 100, step: 1 },
      contrast: { min: -100, max: 100, step: 1 },
      rotation: { min: 0, max: 360, step: 1 },
    },

    // Severity colors
    SEVERITY_COLORS: {
      'minor': '#ffcc00',
      'moderate': '#ff6600',
      'severe': '#ff0000',
    },
  };

  const STATE = {
    // Current state
    currentTool: CONFIG.TOOLS.PEN,
    currentColor: CONFIG.DEFAULT_COLOR,
    currentLineWidth: CONFIG.DEFAULT_LINE_WIDTH,
    currentOpacity: CONFIG.DEFAULT_OPACITY,
    fillShapes: false,
    calloutNumber: 1,

    // Selection state
    selectedAnnotationId: null,

    // Image adjustments
    brightness: 0,
    contrast: 0,
    rotation: 0,
    zoom: 1,
    zoomFit: true,

    // Crop state
    cropActive: false,
    cropRect: null,

    // File info
    photoUrl: null,
    photoId: null,
    leadId: null,
    originalImage: null,
    image: null,

    // Unsaved changes
    hasUnsavedChanges: false,

    // Drawing state
    isDrawing: false,
    drawStartX: 0,
    drawStartY: 0,

    // Text input dialog
    textInputActive: false,
  };

  // Undo/Redo stacks
  let undoStack = [];
  let redoStack = [];
  let annotations = [];

  // Canvas elements
  let modal;
  let canvas;
  let ctx;
  let overlayCanvas;
  let overlayCtx;
  let canvasContainer;

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================

  function generateId() {
    return Math.random().toString(36).substr(2, 9);
  }

  function showToast(message, type = 'success') {
    const container = document.querySelector('.nbd-toast-container') || createToastContainer();
    const toast = document.createElement('div');
    toast.className = `nbd-toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'slideIn 0.3s ease reverse';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function createToastContainer() {
    const container = document.createElement('div');
    container.className = 'nbd-toast-container';
    document.body.appendChild(container);
    return container;
  }

  function showDialog(title, content, buttons = []) {
    const overlay = document.createElement('div');
    overlay.className = 'nbd-dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'nbd-dialog';

    dialog.innerHTML = `
      <div class="nbd-dialog-title">${title}</div>
      <div class="nbd-dialog-content">${content}</div>
      <div class="nbd-dialog-buttons"></div>
    `;

    const buttonsContainer = dialog.querySelector('.nbd-dialog-buttons');
    buttons.forEach(btn => {
      const button = document.createElement('button');
      button.className = `nbd-dialog-btn ${btn.class || ''}`;
      button.textContent = btn.text;
      button.onclick = () => {
        btn.onClick();
        overlay.remove();
      };
      buttonsContainer.appendChild(button);
    });

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    overlay.onclick = (e) => {
      if (e.target === overlay) {
        overlay.remove();
      }
    };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function distance(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function drawArrowHead(ctx, fromX, fromY, toX, toY, size = 15) {
    const angle = Math.atan2(toY - fromY, toX - fromX);

    // Left arrow point
    ctx.lineTo(toX - size * Math.cos(angle - Math.PI / 6), toY - size * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(toX, toY);

    // Right arrow point
    ctx.lineTo(toX - size * Math.cos(angle + Math.PI / 6), toY - size * Math.sin(angle + Math.PI / 6));
  }

  // ============================================
  // CANVAS MANAGEMENT
  // ============================================

  function initializeCanvases(containerElement, imageWidth, imageHeight) {
    canvasContainer = containerElement;
    canvasContainer.innerHTML = '';

    // Main canvas for image
    canvas = document.createElement('canvas');
    canvas.width = imageWidth;
    canvas.height = imageHeight;
    canvas.className = 'nbd-canvas';
    ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Overlay canvas for annotations
    overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = imageWidth;
    overlayCanvas.height = imageHeight;
    overlayCanvas.className = 'nbd-canvas';
    overlayCtx = overlayCanvas.getContext('2d', { willReadFrequently: true });

    // Container for layering
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.display = 'inline-block';

    wrapper.appendChild(canvas);
    wrapper.appendChild(overlayCanvas);

    // Overlay on top for interaction
    overlayCanvas.style.position = 'absolute';
    overlayCanvas.style.top = '0';
    overlayCanvas.style.left = '0';
    overlayCanvas.style.cursor = 'crosshair';

    canvasContainer.appendChild(wrapper);
    setupCanvasEventListeners();
    redrawAll();
  }

  function redrawAll() {
    if (!ctx || !overlayCtx) return;

    // Clear overlay
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    // Redraw all annotations
    annotations.forEach(annotation => {
      drawAnnotation(overlayCtx, annotation);
    });

    // Highlight selected annotation
    if (STATE.selectedAnnotationId) {
      const selected = annotations.find(a => a.id === STATE.selectedAnnotationId);
      if (selected) {
        drawSelectionBox(overlayCtx, selected);
      }
    }

    // Draw crop overlay if active
    if (STATE.cropActive && STATE.cropRect) {
      drawCropOverlay();
    }
  }

  function drawAnnotation(context, annotation) {
    if (!annotation) return;

    context.globalAlpha = annotation.opacity !== undefined ? annotation.opacity / 100 : 1;
    context.strokeStyle = annotation.color || STATE.currentColor;
    context.fillStyle = annotation.color || STATE.currentColor;
    context.lineWidth = annotation.width || STATE.currentLineWidth;
    context.lineCap = 'round';
    context.lineJoin = 'round';

    switch (annotation.type) {
      case CONFIG.ANNOTATION_TYPES.PEN:
        drawPenAnnotation(context, annotation);
        break;
      case CONFIG.ANNOTATION_TYPES.LINE:
        drawLineAnnotation(context, annotation);
        break;
      case CONFIG.ANNOTATION_TYPES.ARROW:
        drawArrowAnnotation(context, annotation);
        break;
      case CONFIG.ANNOTATION_TYPES.RECT:
        drawRectAnnotation(context, annotation);
        break;
      case CONFIG.ANNOTATION_TYPES.CIRCLE:
        drawCircleAnnotation(context, annotation);
        break;
      case CONFIG.ANNOTATION_TYPES.TEXT:
        drawTextAnnotation(context, annotation);
        break;
      case CONFIG.ANNOTATION_TYPES.HAIL:
        drawHailAnnotation(context, annotation);
        break;
      case CONFIG.ANNOTATION_TYPES.WIND:
        drawWindAnnotation(context, annotation);
        break;
      case CONFIG.ANNOTATION_TYPES.LEAK:
        drawLeakAnnotation(context, annotation);
        break;
      case CONFIG.ANNOTATION_TYPES.SHINGLE:
        drawShingleAnnotation(context, annotation);
        break;
      case CONFIG.ANNOTATION_TYPES.CALLOUT:
        drawCalloutAnnotation(context, annotation);
        break;
      case CONFIG.ANNOTATION_TYPES.MEASURE:
        drawMeasureAnnotation(context, annotation);
        break;
      case CONFIG.ANNOTATION_TYPES.AREA:
        drawAreaAnnotation(context, annotation);
        break;
    }

    context.globalAlpha = 1;
  }

  function drawPenAnnotation(context, annotation) {
    if (!annotation.points || annotation.points.length < 2) return;
    context.beginPath();
    context.moveTo(annotation.points[0].x, annotation.points[0].y);
    annotation.points.forEach(point => {
      context.lineTo(point.x, point.y);
    });
    context.stroke();
  }

  function drawLineAnnotation(context, annotation) {
    context.beginPath();
    context.moveTo(annotation.x1, annotation.y1);
    context.lineTo(annotation.x2, annotation.y2);
    context.stroke();
  }

  function drawArrowAnnotation(context, annotation) {
    const headlen = 15;
    const angle = Math.atan2(annotation.y2 - annotation.y1, annotation.x2 - annotation.x1);

    // Draw line
    context.beginPath();
    context.moveTo(annotation.x1, annotation.y1);
    context.lineTo(annotation.x2, annotation.y2);
    context.stroke();

    // Draw arrowhead
    context.beginPath();
    context.moveTo(annotation.x2, annotation.y2);
    context.lineTo(annotation.x2 - headlen * Math.cos(angle - Math.PI / 6), annotation.y2 - headlen * Math.sin(angle - Math.PI / 6));
    context.moveTo(annotation.x2, annotation.y2);
    context.lineTo(annotation.x2 - headlen * Math.cos(angle + Math.PI / 6), annotation.y2 - headlen * Math.sin(angle + Math.PI / 6));
    context.stroke();
  }

  function drawRectAnnotation(context, annotation) {
    const w = annotation.x2 - annotation.x1;
    const h = annotation.y2 - annotation.y1;

    if (annotation.filled) {
      context.fillRect(annotation.x1, annotation.y1, w, h);
    } else {
      context.strokeRect(annotation.x1, annotation.y1, w, h);
    }
  }

  function drawCircleAnnotation(context, annotation) {
    const radius = distance(annotation.cx, annotation.cy, annotation.x2, annotation.y2);
    context.beginPath();
    context.arc(annotation.cx, annotation.cy, radius, 0, Math.PI * 2);

    if (annotation.filled) {
      context.fill();
    } else {
      context.stroke();
    }
  }

  function drawTextAnnotation(context, annotation) {
    context.fillStyle = annotation.color || '#ffffff';
    context.font = `${annotation.fontSize || 16}px Arial`;
    context.fillText(annotation.text, annotation.x, annotation.y);
  }

  function drawHailAnnotation(context, annotation) {
    const size = 20;
    context.beginPath();
    context.arc(annotation.x, annotation.y, size, 0, Math.PI * 2);
    context.stroke();

    context.fillStyle = annotation.color;
    context.font = 'bold 14px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('H', annotation.x, annotation.y);
  }

  function drawWindAnnotation(context, annotation) {
    const size = 40;
    const angle = annotation.angle || 0;

    context.save();
    context.translate(annotation.x, annotation.y);
    context.rotate(angle);

    // Arrow
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(size, 0);
    context.stroke();

    // Arrowhead
    context.beginPath();
    context.moveTo(size, 0);
    context.lineTo(size - 10, -8);
    context.moveTo(size, 0);
    context.lineTo(size - 10, 8);
    context.stroke();

    // Label
    context.fillStyle = annotation.color;
    context.font = 'bold 11px Arial';
    context.textAlign = 'center';
    context.fillText('WIND', 0, -15);

    context.restore();
  }

  function drawLeakAnnotation(context, annotation) {
    const size = 15;
    // Droplet shape
    context.beginPath();
    context.arc(annotation.x, annotation.y - size / 2, size / 2, 0, Math.PI, true);
    context.lineTo(annotation.x, annotation.y + size);
    context.closePath();
    context.fill();
  }

  function drawShingleAnnotation(context, annotation) {
    const size = 20;
    // Square
    context.strokeRect(annotation.x - size / 2, annotation.y - size / 2, size, size);

    // X
    context.beginPath();
    context.moveTo(annotation.x - size / 2, annotation.y - size / 2);
    context.lineTo(annotation.x + size / 2, annotation.y + size / 2);
    context.moveTo(annotation.x + size / 2, annotation.y - size / 2);
    context.lineTo(annotation.x - size / 2, annotation.y + size / 2);
    context.stroke();
  }

  function drawCalloutAnnotation(context, annotation) {
    const size = 24;
    // Circle
    context.beginPath();
    context.arc(annotation.x, annotation.y, size / 2, 0, Math.PI * 2);
    context.fill();

    // Number
    context.fillStyle = '#000000';
    context.font = 'bold 16px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(annotation.number, annotation.x, annotation.y);
  }

  function drawMeasureAnnotation(context, annotation) {
    context.beginPath();
    context.moveTo(annotation.x1, annotation.y1);
    context.lineTo(annotation.x2, annotation.y2);
    context.stroke();

    // Dimension text
    const midX = (annotation.x1 + annotation.x2) / 2;
    const midY = (annotation.y1 + annotation.y2) / 2;
    context.fillStyle = annotation.color;
    context.font = 'bold 12px Arial';
    context.textAlign = 'center';
    context.fillText(annotation.dimension, midX, midY - 10);
  }

  function drawAreaAnnotation(context, annotation) {
    const w = annotation.x2 - annotation.x1;
    const h = annotation.y2 - annotation.y1;
    context.strokeRect(annotation.x1, annotation.y1, w, h);

    // Area text
    const cx = annotation.x1 + w / 2;
    const cy = annotation.y1 + h / 2;
    context.fillStyle = annotation.color;
    context.font = 'bold 12px Arial';
    context.textAlign = 'center';
    context.fillText(annotation.area, cx, cy);
  }

  function drawSelectionBox(context, annotation) {
    context.strokeStyle = '#00ff00';
    context.lineWidth = 2;
    context.setLineDash([4, 4]);

    if (annotation.type === CONFIG.ANNOTATION_TYPES.CIRCLE) {
      const radius = distance(annotation.cx, annotation.cy, annotation.x2, annotation.y2);
      context.beginPath();
      context.arc(annotation.cx, annotation.cy, radius, 0, Math.PI * 2);
      context.stroke();
    } else if (annotation.type === CONFIG.ANNOTATION_TYPES.TEXT) {
      context.strokeRect(annotation.x - 5, annotation.y - 20, 50, 30);
    } else {
      const bounds = getAnnotationBounds(annotation);
      context.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
    }

    context.setLineDash([]);
  }

  function getAnnotationBounds(annotation) {
    let minX, minY, maxX, maxY;

    if (annotation.type === CONFIG.ANNOTATION_TYPES.PEN && annotation.points) {
      minX = Math.min(...annotation.points.map(p => p.x));
      maxX = Math.max(...annotation.points.map(p => p.x));
      minY = Math.min(...annotation.points.map(p => p.y));
      maxY = Math.max(...annotation.points.map(p => p.y));
    } else if (annotation.type === CONFIG.ANNOTATION_TYPES.CIRCLE) {
      const radius = distance(annotation.cx, annotation.cy, annotation.x2, annotation.y2);
      minX = annotation.cx - radius;
      minY = annotation.cy - radius;
      maxX = annotation.cx + radius;
      maxY = annotation.cy + radius;
    } else {
      minX = Math.min(annotation.x1 || annotation.x || annotation.cx || 0, annotation.x2 || annotation.x || annotation.cx || 0);
      maxX = Math.max(annotation.x1 || annotation.x || annotation.cx || 0, annotation.x2 || annotation.x || annotation.cx || 0);
      minY = Math.min(annotation.y1 || annotation.y || annotation.cy || 0, annotation.y2 || annotation.y || annotation.cy || 0);
      maxY = Math.max(annotation.y1 || annotation.y || annotation.cy || 0, annotation.y2 || annotation.y || annotation.cy || 0);
    }

    return { x: minX, y: minY, w: maxX - minX + 10, h: maxY - minY + 10 };
  }

  function drawCropOverlay() {
    if (!STATE.cropRect) return;

    const rect = STATE.cropRect;
    overlayCtx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    overlayCtx.fillRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    overlayCtx.clearRect(rect.x, rect.y, rect.w, rect.h);
    overlayCtx.strokeStyle = '#00ff00';
    overlayCtx.lineWidth = 2;
    overlayCtx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  }

  // ============================================
  // UNDO / REDO
  // ============================================

  function saveState() {
    undoStack.push(JSON.stringify(annotations));
    redoStack = [];
    STATE.hasUnsavedChanges = true;
    updateUndoRedoButtons();
  }

  function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(JSON.stringify(annotations));
    annotations = JSON.parse(undoStack.pop());
    STATE.selectedAnnotationId = null;
    redrawAll();
    updateUndoRedoButtons();
  }

  function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(JSON.stringify(annotations));
    annotations = JSON.parse(redoStack.pop());
    STATE.selectedAnnotationId = null;
    redrawAll();
    updateUndoRedoButtons();
  }

  function updateUndoRedoButtons() {
    const undoBtn = document.querySelector('[data-action="undo"]');
    const redoBtn = document.querySelector('[data-action="redo"]');
    if (undoBtn) undoBtn.classList.toggle('disabled', undoStack.length === 0);
    if (redoBtn) redoBtn.classList.toggle('disabled', redoStack.length === 0);
  }

  // ============================================
  // CANVAS EVENT LISTENERS
  // ============================================

  function setupCanvasEventListeners() {
    overlayCanvas.addEventListener('mousedown', handleCanvasMouseDown);
    overlayCanvas.addEventListener('mousemove', handleCanvasMouseMove);
    overlayCanvas.addEventListener('mouseup', handleCanvasMouseUp);
    overlayCanvas.addEventListener('mouseleave', handleCanvasMouseLeave);
    overlayCanvas.addEventListener('wheel', handleCanvasWheel, { passive: false });
    overlayCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Touch support for tablets
    overlayCanvas.addEventListener('touchstart', handleCanvasTouchStart);
    overlayCanvas.addEventListener('touchmove', handleCanvasTouchMove);
    overlayCanvas.addEventListener('touchend', handleCanvasTouchEnd);
  }

  function getCanvasCoords(e) {
    const rect = overlayCanvas.getBoundingClientRect();
    const scaleX = overlayCanvas.width / rect.width;
    const scaleY = overlayCanvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function getTouchCoords(touch) {
    const rect = overlayCanvas.getBoundingClientRect();
    const scaleX = overlayCanvas.width / rect.width;
    const scaleY = overlayCanvas.height / rect.height;
    return {
      x: (touch.clientX - rect.left) * scaleX,
      y: (touch.clientY - rect.top) * scaleY,
    };
  }

  function handleCanvasMouseDown(e) {
    if (STATE.textInputActive) return;

    const coords = getCanvasCoords(e);
    STATE.drawStartX = coords.x;
    STATE.drawStartY = coords.y;
    STATE.isDrawing = true;

    switch (STATE.currentTool) {
      case CONFIG.TOOLS.SELECT:
        handleSelectMouseDown(coords);
        break;
      case CONFIG.TOOLS.PEN:
        handlePenMouseDown(coords);
        break;
      case CONFIG.TOOLS.LINE:
        handleLineMouseDown(coords);
        break;
      case CONFIG.TOOLS.ARROW:
        handleArrowMouseDown(coords);
        break;
      case CONFIG.TOOLS.RECT:
        handleRectMouseDown(coords);
        break;
      case CONFIG.TOOLS.CIRCLE:
        handleCircleMouseDown(coords);
        break;
      case CONFIG.TOOLS.TEXT:
        handleTextMouseDown(coords);
        break;
      case CONFIG.TOOLS.ERASER:
        handleEraserMouseDown(coords);
        break;
      case CONFIG.TOOLS.HAIL:
        handleHailMouseDown(coords);
        break;
      case CONFIG.TOOLS.WIND:
        handleWindMouseDown(coords);
        break;
      case CONFIG.TOOLS.LEAK:
        handleLeakMouseDown(coords);
        break;
      case CONFIG.TOOLS.SHINGLE:
        handleShingleMouseDown(coords);
        break;
      case CONFIG.TOOLS.CALLOUT:
        handleCalloutMouseDown(coords);
        break;
      case CONFIG.TOOLS.MEASURE:
        handleMeasureMouseDown(coords);
        break;
      case CONFIG.TOOLS.AREA:
        handleAreaMouseDown(coords);
        break;
      case CONFIG.TOOLS.CROP:
        handleCropMouseDown(coords);
        break;
    }
  }

  function handleCanvasMouseMove(e) {
    if (!STATE.isDrawing) return;

    const coords = getCanvasCoords(e);

    switch (STATE.currentTool) {
      case CONFIG.TOOLS.PEN:
        handlePenMouseMove(coords);
        break;
      case CONFIG.TOOLS.LINE:
        handleLineMouseMove(coords);
        break;
      case CONFIG.TOOLS.ARROW:
        handleArrowMouseMove(coords);
        break;
      case CONFIG.TOOLS.RECT:
        handleRectMouseMove(coords);
        break;
      case CONFIG.TOOLS.CIRCLE:
        handleCircleMouseMove(coords);
        break;
      case CONFIG.TOOLS.ERASER:
        handleEraserMouseMove(coords);
        break;
      case CONFIG.TOOLS.MEASURE:
        handleMeasureMouseMove(coords);
        break;
      case CONFIG.TOOLS.AREA:
        handleAreaMouseMove(coords);
        break;
      case CONFIG.TOOLS.CROP:
        handleCropMouseMove(coords);
        break;
    }
  }

  function handleCanvasMouseUp(e) {
    const coords = getCanvasCoords(e);

    switch (STATE.currentTool) {
      case CONFIG.TOOLS.LINE:
      case CONFIG.TOOLS.ARROW:
      case CONFIG.TOOLS.RECT:
      case CONFIG.TOOLS.CIRCLE:
      case CONFIG.TOOLS.MEASURE:
      case CONFIG.TOOLS.AREA:
        STATE.isDrawing = false;
        saveState();
        break;
      case CONFIG.TOOLS.CROP:
        STATE.isDrawing = false;
        break;
    }
  }

  function handleCanvasMouseLeave(e) {
    STATE.isDrawing = false;
  }

  function handleCanvasWheel(e) {
    e.preventDefault();
    if (STATE.currentTool === CONFIG.TOOLS.CROP) return;

    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    STATE.zoom = clamp(STATE.zoom * delta, 0.1, 5);
    STATE.zoomFit = false;

    applyZoom();
  }

  function handleCanvasTouchStart(e) {
    const touch = e.touches[0];
    const coords = getTouchCoords(touch);
    STATE.drawStartX = coords.x;
    STATE.drawStartY = coords.y;
    STATE.isDrawing = true;

    if (STATE.currentTool === CONFIG.TOOLS.PEN) {
      handlePenMouseDown(coords);
    }
  }

  function handleCanvasTouchMove(e) {
    if (!STATE.isDrawing) return;
    const touch = e.touches[0];
    const coords = getTouchCoords(touch);

    if (STATE.currentTool === CONFIG.TOOLS.PEN) {
      handlePenMouseMove(coords);
    }
  }

  function handleCanvasTouchEnd(e) {
    STATE.isDrawing = false;
    if (STATE.currentTool === CONFIG.TOOLS.PEN) {
      saveState();
    }
  }

  // Tool handlers
  function handleSelectMouseDown(coords) {
    STATE.selectedAnnotationId = null;
    for (let i = annotations.length - 1; i >= 0; i--) {
      const ann = annotations[i];
      if (annotationContainsPoint(ann, coords)) {
        STATE.selectedAnnotationId = ann.id;
        break;
      }
    }
    redrawAll();
  }

  function annotationContainsPoint(ann, point) {
    const bounds = getAnnotationBounds(ann);
    return point.x >= bounds.x && point.x <= bounds.x + bounds.w &&
           point.y >= bounds.y && point.y <= bounds.y + bounds.h;
  }

  function handlePenMouseDown(coords) {
    saveState();
    annotations.push({
      id: generateId(),
      type: CONFIG.ANNOTATION_TYPES.PEN,
      points: [{ x: coords.x, y: coords.y }],
      color: STATE.currentColor,
      width: STATE.currentLineWidth,
      opacity: STATE.currentOpacity,
    });
  }

  function handlePenMouseMove(coords) {
    if (annotations.length === 0) return;
    const last = annotations[annotations.length - 1];
    if (last.type === CONFIG.ANNOTATION_TYPES.PEN) {
      last.points.push({ x: coords.x, y: coords.y });
      redrawAll();
    }
  }

  function handleLineMouseDown(coords) {
    saveState();
    annotations.push({
      id: generateId(),
      type: CONFIG.ANNOTATION_TYPES.LINE,
      x1: coords.x,
      y1: coords.y,
      x2: coords.x,
      y2: coords.y,
      color: STATE.currentColor,
      width: STATE.currentLineWidth,
      opacity: STATE.currentOpacity,
    });
  }

  function handleLineMouseMove(coords) {
    if (annotations.length === 0) return;
    const last = annotations[annotations.length - 1];
    if (last.type === CONFIG.ANNOTATION_TYPES.LINE) {
      last.x2 = coords.x;
      last.y2 = coords.y;
      redrawAll();
    }
  }

  function handleArrowMouseDown(coords) {
    saveState();
    annotations.push({
      id: generateId(),
      type: CONFIG.ANNOTATION_TYPES.ARROW,
      x1: coords.x,
      y1: coords.y,
      x2: coords.x,
      y2: coords.y,
      color: STATE.currentColor,
      width: STATE.currentLineWidth,
      opacity: STATE.currentOpacity,
    });
  }

  function handleArrowMouseMove(coords) {
    if (annotations.length === 0) return;
    const last = annotations[annotations.length - 1];
    if (last.type === CONFIG.ANNOTATION_TYPES.ARROW) {
      last.x2 = coords.x;
      last.y2 = coords.y;
      redrawAll();
    }
  }

  function handleRectMouseDown(coords) {
    saveState();
    annotations.push({
      id: generateId(),
      type: CONFIG.ANNOTATION_TYPES.RECT,
      x1: coords.x,
      y1: coords.y,
      x2: coords.x,
      y2: coords.y,
      color: STATE.currentColor,
      width: STATE.currentLineWidth,
      opacity: STATE.currentOpacity,
      filled: STATE.fillShapes,
    });
  }

  function handleRectMouseMove(coords) {
    if (annotations.length === 0) return;
    const last = annotations[annotations.length - 1];
    if (last.type === CONFIG.ANNOTATION_TYPES.RECT) {
      last.x2 = coords.x;
      last.y2 = coords.y;
      redrawAll();
    }
  }

  function handleCircleMouseDown(coords) {
    saveState();
    annotations.push({
      id: generateId(),
      type: CONFIG.ANNOTATION_TYPES.CIRCLE,
      cx: coords.x,
      cy: coords.y,
      x2: coords.x,
      y2: coords.y,
      color: STATE.currentColor,
      width: STATE.currentLineWidth,
      opacity: STATE.currentOpacity,
      filled: STATE.fillShapes,
    });
  }

  function handleCircleMouseMove(coords) {
    if (annotations.length === 0) return;
    const last = annotations[annotations.length - 1];
    if (last.type === CONFIG.ANNOTATION_TYPES.CIRCLE) {
      last.x2 = coords.x;
      last.y2 = coords.y;
      redrawAll();
    }
  }

  function handleTextMouseDown(coords) {
    STATE.textInputActive = true;
    showTextInputDialog((text, fontSize) => {
      annotations.push({
        id: generateId(),
        type: CONFIG.ANNOTATION_TYPES.TEXT,
        x: coords.x,
        y: coords.y,
        text: text,
        fontSize: fontSize || 16,
        color: STATE.currentColor,
        opacity: STATE.currentOpacity,
      });
      STATE.textInputActive = false;
      saveState();
      redrawAll();
    });
  }

  function handleEraserMouseDown(coords) {
    saveState();
    // Find annotation at this point and remove it
    for (let i = annotations.length - 1; i >= 0; i--) {
      if (annotationContainsPoint(annotations[i], coords)) {
        annotations.splice(i, 1);
        break;
      }
    }
    redrawAll();
  }

  function handleEraserMouseMove(coords) {
    for (let i = annotations.length - 1; i >= 0; i--) {
      if (annotationContainsPoint(annotations[i], coords)) {
        annotations.splice(i, 1);
        redrawAll();
        break;
      }
    }
  }

  function handleHailMouseDown(coords) {
    saveState();
    annotations.push({
      id: generateId(),
      type: CONFIG.ANNOTATION_TYPES.HAIL,
      x: coords.x,
      y: coords.y,
      color: STATE.currentColor,
      width: STATE.currentLineWidth,
      opacity: STATE.currentOpacity,
    });
    redrawAll();
  }

  function handleWindMouseDown(coords) {
    saveState();
    annotations.push({
      id: generateId(),
      type: CONFIG.ANNOTATION_TYPES.WIND,
      x: coords.x,
      y: coords.y,
      angle: 0,
      color: STATE.currentColor,
      width: STATE.currentLineWidth,
      opacity: STATE.currentOpacity,
    });
    redrawAll();
  }

  function handleLeakMouseDown(coords) {
    saveState();
    annotations.push({
      id: generateId(),
      type: CONFIG.ANNOTATION_TYPES.LEAK,
      x: coords.x,
      y: coords.y,
      color: STATE.currentColor,
      opacity: STATE.currentOpacity,
    });
    redrawAll();
  }

  function handleShingleMouseDown(coords) {
    saveState();
    annotations.push({
      id: generateId(),
      type: CONFIG.ANNOTATION_TYPES.SHINGLE,
      x: coords.x,
      y: coords.y,
      color: STATE.currentColor,
      width: STATE.currentLineWidth,
      opacity: STATE.currentOpacity,
    });
    redrawAll();
  }

  function handleCalloutMouseDown(coords) {
    saveState();
    annotations.push({
      id: generateId(),
      type: CONFIG.ANNOTATION_TYPES.CALLOUT,
      x: coords.x,
      y: coords.y,
      number: STATE.calloutNumber,
      color: STATE.currentColor,
      opacity: STATE.currentOpacity,
    });
    STATE.calloutNumber++;
    redrawAll();
  }

  function handleMeasureMouseDown(coords) {
    saveState();
    annotations.push({
      id: generateId(),
      type: CONFIG.ANNOTATION_TYPES.MEASURE,
      x1: coords.x,
      y1: coords.y,
      x2: coords.x,
      y2: coords.y,
      dimension: '0 ft',
      color: STATE.currentColor,
      width: STATE.currentLineWidth,
      opacity: STATE.currentOpacity,
    });
  }

  function handleMeasureMouseMove(coords) {
    if (annotations.length === 0) return;
    const last = annotations[annotations.length - 1];
    if (last.type === CONFIG.ANNOTATION_TYPES.MEASURE) {
      last.x2 = coords.x;
      last.y2 = coords.y;
      redrawAll();
    }
  }

  function handleAreaMouseDown(coords) {
    saveState();
    annotations.push({
      id: generateId(),
      type: CONFIG.ANNOTATION_TYPES.AREA,
      x1: coords.x,
      y1: coords.y,
      x2: coords.x,
      y2: coords.y,
      area: '0 sq ft',
      color: STATE.currentColor,
      width: STATE.currentLineWidth,
      opacity: STATE.currentOpacity,
    });
  }

  function handleAreaMouseMove(coords) {
    if (annotations.length === 0) return;
    const last = annotations[annotations.length - 1];
    if (last.type === CONFIG.ANNOTATION_TYPES.AREA) {
      last.x2 = coords.x;
      last.y2 = coords.y;
      redrawAll();
    }
  }

  function handleCropMouseDown(coords) {
    STATE.cropRect = {
      x: coords.x,
      y: coords.y,
      w: 0,
      h: 0,
    };
    redrawAll();
  }

  function handleCropMouseMove(coords) {
    if (!STATE.cropRect) return;
    STATE.cropRect.w = coords.x - STATE.cropRect.x;
    STATE.cropRect.h = coords.y - STATE.cropRect.y;
    redrawAll();
  }

  // ============================================
  // TEXT INPUT DIALOG
  // ============================================

  function showTextInputDialog(callback) {
    const dialog = document.createElement('div');
    dialog.className = 'nbd-text-input-dialog active';
    dialog.innerHTML = `
      <div class="nbd-text-input-box">
        <div class="nbd-text-input-box-title">Add Text</div>
        <input type="text" class="nbd-text-input-field" placeholder="Enter text">
        <label style="font-size: 11px; color: #b0b0b0; margin-top: 8px;">Font Size:</label>
        <input type="number" class="nbd-text-input-field" min="8" max="48" value="16">
        <div class="nbd-text-input-buttons">
          <button class="cancel">Cancel</button>
          <button class="confirm">Add Text</button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    const textInput = dialog.querySelector('input[type="text"]');
    const sizeInput = dialog.querySelector('input[type="number"]');
    const cancelBtn = dialog.querySelector('.cancel');
    const confirmBtn = dialog.querySelector('.confirm');

    textInput.focus();

    const close = () => {
      dialog.remove();
      STATE.textInputActive = false;
    };

    cancelBtn.onclick = close;
    confirmBtn.onclick = () => {
      if (textInput.value.trim()) {
        callback(textInput.value, parseInt(sizeInput.value) || 16);
      }
      close();
    };

    textInput.onkeypress = (e) => {
      if (e.key === 'Enter') {
        confirmBtn.click();
      } else if (e.key === 'Escape') {
        close();
      }
    };

    dialog.onclick = (e) => {
      if (e.target === dialog) close();
    };
  }

  // ============================================
  // IMAGE ADJUSTMENTS
  // ============================================

  function applyBrightness(value) {
    STATE.brightness = value;
    applyImageAdjustments();
  }

  function applyContrast(value) {
    STATE.contrast = value;
    applyImageAdjustments();
  }

  function applyRotation(value) {
    STATE.rotation = value % 360;
    applyImageAdjustments();
  }

  function applyZoom() {
    if (!canvasContainer) return;
    canvasContainer.style.transform = `scale(${STATE.zoom})`;
    canvasContainer.style.transformOrigin = 'center center';
  }

  function applyImageAdjustments() {
    if (!ctx || !STATE.originalImage) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();

    // Apply brightness and contrast
    ctx.filter = `brightness(${100 + STATE.brightness}%) contrast(${100 + STATE.contrast}%)`;

    // Apply rotation
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    ctx.translate(centerX, centerY);
    ctx.rotate((STATE.rotation * Math.PI) / 180);
    ctx.translate(-centerX, -centerY);

    ctx.drawImage(STATE.originalImage, 0, 0);
    ctx.restore();

    redrawAll();
  }

  function resetImage() {
    STATE.brightness = 0;
    STATE.contrast = 0;
    STATE.rotation = 0;
    STATE.zoom = 1;
    STATE.zoomFit = true;
    applyImageAdjustments();
    applyZoom();
    updateImageAdjustmentSliders();
  }

  function fitZoom() {
    STATE.zoomFit = true;
    STATE.zoom = 1;
    applyZoom();
  }

  function setZoom(level) {
    STATE.zoom = level / 100;
    STATE.zoomFit = false;
    applyZoom();
  }

  function updateImageAdjustmentSliders() {
    const brightnessSlider = document.querySelector('input[data-adjustment="brightness"]');
    const contrastSlider = document.querySelector('input[data-adjustment="contrast"]');
    const rotationSlider = document.querySelector('input[data-adjustment="rotation"]');

    if (brightnessSlider) brightnessSlider.value = STATE.brightness;
    if (contrastSlider) contrastSlider.value = STATE.contrast;
    if (rotationSlider) rotationSlider.value = STATE.rotation;
  }

  // ============================================
  // SAVE & EXPORT
  // ============================================

  async function flattenAndSaveAs() {
    if (!canvas || !overlayCanvas) {
      showToast('Canvas not ready', 'error');
      return;
    }

    try {
      // Flatten: create final canvas with image + annotations
      const finalCanvas = document.createElement('canvas');
      finalCanvas.width = canvas.width;
      finalCanvas.height = canvas.height;
      const finalCtx = finalCanvas.getContext('2d');

      // Draw base image
      finalCtx.drawImage(canvas, 0, 0);

      // Draw all annotations
      finalCtx.drawImage(overlayCanvas, 0, 0);

      // Convert to JPEG
      finalCanvas.toBlob(async (blob) => {
        if (!blob) {
          showToast('Failed to create image', 'error');
          return;
        }

        await uploadAndSaveAnnotated(blob, false);
      }, 'image/jpeg', 0.95);
    } catch (error) {
      console.error('Flatten error:', error);
      showToast('Save failed: ' + error.message, 'error');
    }
  }

  async function flattenAndSaveOver() {
    if (!canvas || !overlayCanvas) {
      showToast('Canvas not ready', 'error');
      return;
    }

    if (!STATE.photoId) {
      showToast('Photo ID missing', 'error');
      return;
    }

    try {
      const finalCanvas = document.createElement('canvas');
      finalCanvas.width = canvas.width;
      finalCanvas.height = canvas.height;
      const finalCtx = finalCanvas.getContext('2d');

      finalCtx.drawImage(canvas, 0, 0);
      finalCtx.drawImage(overlayCanvas, 0, 0);

      finalCanvas.toBlob(async (blob) => {
        if (!blob) {
          showToast('Failed to create image', 'error');
          return;
        }

        await uploadAndSaveAnnotated(blob, true);
      }, 'image/jpeg', 0.95);
    } catch (error) {
      console.error('Save over error:', error);
      showToast('Save failed: ' + error.message, 'error');
    }
  }

  async function uploadAndSaveAnnotated(blob, saveOver = false) {
    try {
      const fileName = saveOver ? `photo_${STATE.photoId}.jpg` : `photo_${generateId()}.jpg`;
      const filePath = `leads/${STATE.leadId}/photos/${fileName}`;

      // Upload to Firebase Storage
      const storageRef = window.ref(window.storage, filePath);
      await window.uploadBytes(storageRef, blob);
      const downloadUrl = await window.getDownloadURL(storageRef);

      // Update/Create Firestore document
      if (saveOver && STATE.photoId) {
        // Update existing
        const docRef = window.doc(window.db, 'leads', STATE.leadId, 'photos', STATE.photoId);
        await window.updateDoc(docRef, {
          url: downloadUrl,
          isAnnotated: true,
          annotatedAt: window.serverTimestamp(),
          annotations: annotations.map(a => ({
            ...a,
            points: undefined, // Don't store point arrays to save space
          })),
          metadata: {
            damageType: document.querySelector('select[name="damageType"]')?.value || '',
            severity: document.querySelector('input[name="severity"]:checked')?.value || '',
            location: document.querySelector('select[name="location"]')?.value || '',
            notes: document.querySelector('textarea[name="notes"]')?.value || '',
          },
        });
      } else {
        // Create new annotated copy
        const photoRef = window.collection(window.db, 'leads', STATE.leadId, 'photos');
        await window.addDoc(photoRef, {
          url: downloadUrl,
          isAnnotated: true,
          annotatedAt: window.serverTimestamp(),
          originalPhotoId: STATE.photoId,
          annotations: annotations.map(a => ({
            ...a,
            points: undefined,
          })),
          metadata: {
            damageType: document.querySelector('select[name="damageType"]')?.value || '',
            severity: document.querySelector('input[name="severity"]:checked')?.value || '',
            location: document.querySelector('select[name="location"]')?.value || '',
            notes: document.querySelector('textarea[name="notes"]')?.value || '',
          },
        });
      }

      STATE.hasUnsavedChanges = false;
      showToast(`Photo saved successfully`, 'success');

      // Auto-close after success
      setTimeout(() => {
        closeEditor();
      }, 1500);
    } catch (error) {
      console.error('Upload error:', error);
      showToast('Upload failed: ' + error.message, 'error');
    }
  }

  // ============================================
  // TOOLBAR SETUP
  // ============================================

  function createTopToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'nbd-top-toolbar';
    toolbar.innerHTML = `
      <div class="nbd-toolbar-left">
        <button class="nbd-btn nbd-back-btn" data-action="back">
          <svg class="nbd-back-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Back
        </button>
      </div>
      <div class="nbd-toolbar-center">Photo Editor</div>
      <div class="nbd-toolbar-right">
        <button class="nbd-btn" data-action="undo" title="Ctrl+Z">Undo</button>
        <button class="nbd-btn" data-action="redo" title="Ctrl+Shift+Z">Redo</button>
        <button class="nbd-btn" data-action="save-new">Save as New Copy</button>
        <button class="nbd-btn" data-action="save-over">Save Over Original</button>
      </div>
    `;

    toolbar.querySelector('[data-action="back"]').onclick = () => closeEditorWithPrompt();
    toolbar.querySelector('[data-action="undo"]').onclick = () => undo();
    toolbar.querySelector('[data-action="redo"]').onclick = () => redo();
    toolbar.querySelector('[data-action="save-new"]').onclick = () => flattenAndSaveAs();
    toolbar.querySelector('[data-action="save-over"]').onclick = () => flattenAndSaveOver();

    return toolbar;
  }

  function createLeftToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'nbd-left-toolbar';

    // Selection & Drawing Tools
    const drawingTools = document.createElement('div');
    drawingTools.className = 'nbd-tool-group';
    drawingTools.innerHTML = `
      <button class="nbd-tool-btn ${STATE.currentTool === CONFIG.TOOLS.SELECT ? 'active' : ''}" data-tool="select" title="V">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/></svg>
        <div class="nbd-tool-tooltip">Select (V)</div>
      </button>
      <button class="nbd-tool-btn ${STATE.currentTool === CONFIG.TOOLS.PEN ? 'active' : ''}" data-tool="pen" title="P">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17.25V21h3.75L17.81 9.94M9.06 9.06l7.07-7.07a2.828 2.828 0 014 4l-7.07 7.07"/></svg>
        <div class="nbd-tool-tooltip">Pen (P)</div>
      </button>
      <button class="nbd-tool-btn ${STATE.currentTool === CONFIG.TOOLS.LINE ? 'active' : ''}" data-tool="line" title="L">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>
        <div class="nbd-tool-tooltip">Line (L)</div>
      </button>
      <button class="nbd-tool-btn ${STATE.currentTool === CONFIG.TOOLS.ARROW ? 'active' : ''}" data-tool="arrow" title="A">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h12M17 9l3 3-3 3"/></svg>
        <div class="nbd-tool-tooltip">Arrow (A)</div>
      </button>
      <button class="nbd-tool-btn ${STATE.currentTool === CONFIG.TOOLS.RECT ? 'active' : ''}" data-tool="rect" title="R">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16"/></svg>
        <div class="nbd-tool-tooltip">Rectangle (R)</div>
      </button>
      <button class="nbd-tool-btn ${STATE.currentTool === CONFIG.TOOLS.CIRCLE ? 'active' : ''}" data-tool="circle" title="C">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/></svg>
        <div class="nbd-tool-tooltip">Circle (C)</div>
      </button>
      <button class="nbd-tool-btn ${STATE.currentTool === CONFIG.TOOLS.TEXT ? 'active' : ''}" data-tool="text" title="T">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M6 15h12"/></svg>
        <div class="nbd-tool-tooltip">Text (T)</div>
      </button>
      <button class="nbd-tool-btn ${STATE.currentTool === CONFIG.TOOLS.ERASER ? 'active' : ''}" data-tool="eraser" title="E">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 19h18L12 4 3 19z"/></svg>
        <div class="nbd-tool-tooltip">Eraser (E)</div>
      </button>
    `;

    // Roofing Tools
    const roofingTools = document.createElement('div');
    roofingTools.className = 'nbd-tool-group';
    roofingTools.innerHTML = `
      <button class="nbd-tool-btn ${STATE.currentTool === CONFIG.TOOLS.HAIL ? 'active' : ''}" data-tool="hail">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><text x="12" y="14" text-anchor="middle" font-size="10">H</text></svg>
        <div class="nbd-tool-tooltip">Hail</div>
      </button>
      <button class="nbd-tool-btn ${STATE.currentTool === CONFIG.TOOLS.WIND ? 'active' : ''}" data-tool="wind">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h12M17 9l3 3-3 3"/></svg>
        <div class="nbd-tool-tooltip">Wind</div>
      </button>
      <button class="nbd-tool-btn ${STATE.currentTool === CONFIG.TOOLS.LEAK ? 'active' : ''}" data-tool="leak">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c-1 0-2 1-2 2v4c0 1 1 2 2 2s2-1 2-2V4c0-1-1-2-2-2z"/></svg>
        <div class="nbd-tool-tooltip">Leak</div>
      </button>
      <button class="nbd-tool-btn ${STATE.currentTool === CONFIG.TOOLS.SHINGLE ? 'active' : ''}" data-tool="shingle">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12"/><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
        <div class="nbd-tool-tooltip">Missing Shingle</div>
      </button>
      <button class="nbd-tool-btn ${STATE.currentTool === CONFIG.TOOLS.CALLOUT ? 'active' : ''}" data-tool="callout">
        <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg>
        <div class="nbd-tool-tooltip">Callout Number</div>
      </button>
      <button class="nbd-tool-btn ${STATE.currentTool === CONFIG.TOOLS.MEASURE ? 'active' : ''}" data-tool="measure">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><line x1="5" y1="9" x2="5" y2="15"/><line x1="19" y1="9" x2="19" y2="15"/></svg>
        <div class="nbd-tool-tooltip">Measurement</div>
      </button>
      <button class="nbd-tool-btn ${STATE.currentTool === CONFIG.TOOLS.AREA ? 'active' : ''}" data-tool="area">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16"/></svg>
        <div class="nbd-tool-tooltip">Area</div>
      </button>
      <button class="nbd-tool-btn ${STATE.currentTool === CONFIG.TOOLS.CROP ? 'active' : ''}" data-tool="crop">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 4h5v2H6zM13 4h5v2h-5zM4 6v5H2V6zM22 6v5h-2V6zM6 18h5v2H6zM13 18h5v2h-5zM4 13v5H2v-5zM22 13v5h-2v-5z"/></svg>
        <div class="nbd-tool-tooltip">Crop</div>
      </button>
    `;

    toolbar.appendChild(drawingTools);
    toolbar.appendChild(roofingTools);

    // Tool click handlers
    toolbar.querySelectorAll('[data-tool]').forEach(btn => {
      btn.onclick = (e) => {
        selectTool(btn.dataset.tool);
        toolbar.querySelectorAll('.nbd-tool-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      };
    });

    return toolbar;
  }

  function selectTool(toolName) {
    STATE.currentTool = toolName;
    STATE.selectedAnnotationId = null;

    const toolMap = {
      'select': CONFIG.TOOLS.SELECT,
      'pen': CONFIG.TOOLS.PEN,
      'line': CONFIG.TOOLS.LINE,
      'arrow': CONFIG.TOOLS.ARROW,
      'rect': CONFIG.TOOLS.RECT,
      'circle': CONFIG.TOOLS.CIRCLE,
      'text': CONFIG.TOOLS.TEXT,
      'eraser': CONFIG.TOOLS.ERASER,
      'hail': CONFIG.TOOLS.HAIL,
      'wind': CONFIG.TOOLS.WIND,
      'leak': CONFIG.TOOLS.LEAK,
      'shingle': CONFIG.TOOLS.SHINGLE,
      'callout': CONFIG.TOOLS.CALLOUT,
      'measure': CONFIG.TOOLS.MEASURE,
      'area': CONFIG.TOOLS.AREA,
      'crop': CONFIG.TOOLS.CROP,
    };

    STATE.currentTool = toolMap[toolName] || CONFIG.TOOLS.PEN;
    if (STATE.currentTool === CONFIG.TOOLS.CROP) {
      STATE.cropActive = true;
    } else {
      STATE.cropActive = false;
    }
    redrawAll();
  }

  function createRightSidebar() {
    const sidebar = document.createElement('div');
    sidebar.className = 'nbd-right-sidebar';
    sidebar.innerHTML = `
      <div class="nbd-sidebar-section">
        <div class="nbd-sidebar-label">Damage Type</div>
        <select class="nbd-select" name="damageType">
          <option value="">Select type</option>
          <option value="hail">Hail</option>
          <option value="wind">Wind</option>
          <option value="leak">Leak</option>
          <option value="shingle">Missing Shingle</option>
          <option value="cracked">Cracked Tile</option>
          <option value="flashing">Flashing Damage</option>
          <option value="gutter">Gutter Damage</option>
          <option value="soffit">Soffit/Fascia</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div class="nbd-sidebar-section">
        <div class="nbd-sidebar-label">Severity</div>
        <div class="nbd-radio-group">
          <label class="nbd-radio-option">
            <input type="radio" name="severity" value="minor">
            <span class="nbd-radio-label">Minor</span>
          </label>
          <label class="nbd-radio-option">
            <input type="radio" name="severity" value="moderate">
            <span class="nbd-radio-label">Moderate</span>
          </label>
          <label class="nbd-radio-option">
            <input type="radio" name="severity" value="severe">
            <span class="nbd-radio-label">Severe</span>
          </label>
        </div>
      </div>

      <div class="nbd-sidebar-section">
        <div class="nbd-sidebar-label">Location</div>
        <select class="nbd-select" name="location">
          <option value="">Select location</option>
          <option value="ridge">Ridge</option>
          <option value="hip">Hip</option>
          <option value="valley">Valley</option>
          <option value="field">Field</option>
          <option value="edge">Edge</option>
          <option value="flashing">Flashing</option>
          <option value="vent">Vent</option>
          <option value="chimney">Chimney</option>
          <option value="skylight">Skylight</option>
          <option value="gutter">Gutter</option>
        </select>
      </div>

      <div class="nbd-sidebar-section">
        <div class="nbd-sidebar-label">Notes</div>
        <textarea class="nbd-textarea" name="notes" placeholder="Additional details..."></textarea>
      </div>
    `;

    return sidebar;
  }

  function createBottomToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'nbd-bottom-toolbar';
    toolbar.innerHTML = `
      <div class="nbd-control-group">
        <span class="nbd-control-label">Color</span>
        <div class="nbd-color-palette">
          ${CONFIG.COLOR_PALETTE.map((color, i) => `
            <div class="nbd-color-swatch ${color === STATE.currentColor ? 'active' : ''}"
                 data-color="${color}" style="background-color: ${color}"></div>
          `).join('')}
          <div class="nbd-color-input-wrapper">
            <input type="color" class="nbd-color-input" value="${STATE.currentColor}">
          </div>
        </div>
      </div>

      <div class="nbd-control-group">
        <span class="nbd-control-label">Width</span>
        <div class="nbd-slider-wrapper">
          <input type="range" class="nbd-slider" min="1" max="10" value="${STATE.currentLineWidth}" data-control="lineWidth">
          <span class="nbd-slider-value">${STATE.currentLineWidth}px</span>
        </div>
      </div>

      <div class="nbd-control-group">
        <span class="nbd-control-label">Opacity</span>
        <div class="nbd-slider-wrapper">
          <input type="range" class="nbd-slider" min="0" max="100" value="${STATE.currentOpacity}" data-control="opacity">
          <span class="nbd-slider-value">${STATE.currentOpacity}%</span>
        </div>
      </div>

      <div class="nbd-control-group">
        <label class="nbd-checkbox-wrapper">
          <input type="checkbox" ${STATE.fillShapes ? 'checked' : ''} data-control="fill">
          <span class="nbd-checkbox-label">Fill</span>
        </label>
      </div>

      <div class="nbd-control-group">
        <span class="nbd-control-label">Brightness</span>
        <div class="nbd-slider-wrapper">
          <input type="range" class="nbd-slider" min="-100" max="100" value="0" data-adjustment="brightness">
          <span class="nbd-slider-value">0</span>
        </div>
      </div>

      <div class="nbd-control-group">
        <span class="nbd-control-label">Contrast</span>
        <div class="nbd-slider-wrapper">
          <input type="range" class="nbd-slider" min="-100" max="100" value="0" data-adjustment="contrast">
          <span class="nbd-slider-value">0</span>
        </div>
      </div>

      <div class="nbd-control-group">
        <span class="nbd-control-label">Zoom</span>
        <button class="nbd-btn" data-action="zoom-fit" style="padding: 6px 10px;">Fit</button>
        <button class="nbd-btn" data-action="zoom-50" style="padding: 6px 10px;">50%</button>
        <button class="nbd-btn" data-action="zoom-100" style="padding: 6px 10px;">100%</button>
        <button class="nbd-btn" data-action="zoom-200" style="padding: 6px 10px;">200%</button>
      </div>
    `;

    // Color palette handlers
    toolbar.querySelectorAll('.nbd-color-swatch').forEach(swatch => {
      swatch.onclick = () => {
        STATE.currentColor = swatch.dataset.color;
        toolbar.querySelectorAll('.nbd-color-swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
      };
    });

    // Color input handler
    const colorInput = toolbar.querySelector('.nbd-color-input');
    colorInput.onchange = () => {
      STATE.currentColor = colorInput.value;
      toolbar.querySelectorAll('.nbd-color-swatch').forEach(s => s.classList.remove('active'));
    };

    // Line width handler
    toolbar.querySelector('[data-control="lineWidth"]').oninput = (e) => {
      STATE.currentLineWidth = parseInt(e.target.value);
      e.target.nextElementSibling.textContent = STATE.currentLineWidth + 'px';
    };

    // Opacity handler
    toolbar.querySelector('[data-control="opacity"]').oninput = (e) => {
      STATE.currentOpacity = parseInt(e.target.value);
      e.target.nextElementSibling.textContent = STATE.currentOpacity + '%';
    };

    // Fill handler
    toolbar.querySelector('[data-control="fill"]').onchange = (e) => {
      STATE.fillShapes = e.target.checked;
    };

    // Image adjustment handlers
    toolbar.querySelector('[data-adjustment="brightness"]').oninput = (e) => {
      applyBrightness(parseInt(e.target.value));
      e.target.nextElementSibling.textContent = parseInt(e.target.value);
    };

    toolbar.querySelector('[data-adjustment="contrast"]').oninput = (e) => {
      applyContrast(parseInt(e.target.value));
      e.target.nextElementSibling.textContent = parseInt(e.target.value);
    };

    // Zoom handlers
    toolbar.querySelector('[data-action="zoom-fit"]').onclick = fitZoom;
    toolbar.querySelector('[data-action="zoom-50"]').onclick = () => setZoom(50);
    toolbar.querySelector('[data-action="zoom-100"]').onclick = () => setZoom(100);
    toolbar.querySelector('[data-action="zoom-200"]').onclick = () => setZoom(200);

    return toolbar;
  }

  // ============================================
  // KEYBOARD SHORTCUTS
  // ============================================

  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (!modal || modal.classList.contains('hidden')) return;

      if (e.ctrlKey && e.shiftKey && e.key === 'Z') {
        e.preventDefault();
        redo();
      } else if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        undo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (STATE.selectedAnnotationId) {
          e.preventDefault();
          annotations = annotations.filter(a => a.id !== STATE.selectedAnnotationId);
          STATE.selectedAnnotationId = null;
          saveState();
          redrawAll();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (STATE.textInputActive) {
          STATE.textInputActive = false;
          document.querySelector('.nbd-text-input-dialog')?.remove();
        } else {
          closeEditorWithPrompt();
        }
      } else {
        const toolMap = {
          'v': 'select',
          'p': 'pen',
          'l': 'line',
          'a': 'arrow',
          'r': 'rect',
          'c': 'circle',
          't': 'text',
          'e': 'eraser',
        };

        if (toolMap[e.key.toLowerCase()]) {
          selectTool(toolMap[e.key.toLowerCase()]);
          const btns = document.querySelectorAll('.nbd-tool-btn');
          btns.forEach(b => b.classList.remove('active'));
          const tool = CONFIG.TOOLS[toolMap[e.key.toLowerCase()].toUpperCase()];
          btns.forEach(b => {
            if (b.dataset.tool === toolMap[e.key.toLowerCase()]) {
              b.classList.add('active');
            }
          });
        }
      }
    });
  }

  // ============================================
  // MAIN EDITOR FUNCTIONS
  // ============================================

  function closeEditorWithPrompt() {
    if (STATE.hasUnsavedChanges) {
      showDialog(
        'Discard Changes?',
        'You have unsaved annotations. Are you sure you want to close?',
        [
          {
            text: 'Keep Editing',
            onClick: () => {},
          },
          {
            text: 'Discard',
            class: 'primary',
            onClick: closeEditor,
          },
        ]
      );
    } else {
      closeEditor();
    }
  }

  function closeEditor() {
    if (modal) {
      modal.classList.add('hidden');
    }
    undoStack = [];
    redoStack = [];
    annotations = [];
    STATE.hasUnsavedChanges = false;
  }

  async function openEditor(photoUrl, photoId, leadId) {
    STATE.photoUrl = photoUrl;
    STATE.photoId = photoId;
    STATE.leadId = leadId;
    STATE.calloutNumber = 1;

    // Create modal structure
    modal = document.createElement('div');
    modal.className = 'nbd-editor-modal';
    modal.innerHTML = `
      <div class="nbd-top-toolbar-placeholder"></div>
      <div class="nbd-editor-container">
        <div class="nbd-left-toolbar-placeholder"></div>
        <div class="nbd-canvas-wrapper">
          <div class="nbd-spinner"></div>
        </div>
        <div class="nbd-right-sidebar-placeholder"></div>
      </div>
      <div class="nbd-bottom-toolbar-placeholder"></div>
    `;

    document.body.appendChild(modal);

    // Load image
    try {
      STATE.originalImage = new Image();
      STATE.originalImage.crossOrigin = 'anonymous';
      STATE.originalImage.onload = () => {
        // Size canvas appropriately
        let width = STATE.originalImage.width;
        let height = STATE.originalImage.height;

        const aspectRatio = width / height;
        if (width > CONFIG.MAX_CANVAS_WIDTH) {
          width = CONFIG.MAX_CANVAS_WIDTH;
          height = width / aspectRatio;
        }
        if (height > CONFIG.MAX_CANVAS_HEIGHT) {
          height = CONFIG.MAX_CANVAS_HEIGHT;
          width = height * aspectRatio;
        }

        const canvasWrapper = modal.querySelector('.nbd-canvas-wrapper');
        canvasWrapper.innerHTML = '';

        initializeCanvases(canvasWrapper, width, height);
        ctx.drawImage(STATE.originalImage, 0, 0, width, height);

        // Setup toolbars
        const topPlaceholder = modal.querySelector('.nbd-top-toolbar-placeholder');
        topPlaceholder.parentNode.replaceChild(createTopToolbar(), topPlaceholder);

        const leftPlaceholder = modal.querySelector('.nbd-left-toolbar-placeholder');
        leftPlaceholder.parentNode.replaceChild(createLeftToolbar(), leftPlaceholder);

        const rightPlaceholder = modal.querySelector('.nbd-right-sidebar-placeholder');
        rightPlaceholder.parentNode.replaceChild(createRightSidebar(), rightPlaceholder);

        const bottomPlaceholder = modal.querySelector('.nbd-bottom-toolbar-placeholder');
        bottomPlaceholder.parentNode.replaceChild(createBottomToolbar(), bottomPlaceholder);

        updateUndoRedoButtons();
        setupKeyboardShortcuts();

        // Focus canvas
        overlayCanvas.focus();
      };

      STATE.originalImage.onerror = () => {
        showToast('Failed to load image', 'error');
        closeEditor();
      };

      STATE.originalImage.src = photoUrl;
    } catch (error) {
      console.error('Editor open error:', error);
      showToast('Error opening editor: ' + error.message, 'error');
      closeEditor();
    }
  }

  // ============================================
  // PUBLIC API
  // ============================================

  window.NBDPhotoEditor = {
    open: openEditor,
    close: closeEditor,
  };

  console.log('Photo Editor module loaded. Use: window.NBDPhotoEditor.open(photoUrl, photoId, leadId)');
})();
