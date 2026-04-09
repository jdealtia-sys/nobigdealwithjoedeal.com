/**
 * ROOFING CRM - PHOTO EDITOR MODULE
 * Enhanced Damage Annotation Tool for Insurance Claims
 *
 * Public API:
 * - window.NBDPhotoEditor.open(photoUrl, photoId, leadId, photoData)
 * - window.NBDPhotoEditor.close()
 */

(function() {
  'use strict';

  const CONFIG = {
    MAX_CANVAS_WIDTH: 1200,
    MAX_CANVAS_HEIGHT: 800,
    DEFAULT_LINE_WIDTH: 2,
    DEFAULT_OPACITY: 100,
    DEFAULT_COLOR: '#ff0000',

    TOOLS: {
      SELECT: 'select', PEN: 'pen', LINE: 'line', ARROW: 'arrow', RECT: 'rect', CIRCLE: 'circle',
      TEXT: 'text', ERASER: 'eraser', HAIL: 'hail', WIND: 'wind', LEAK: 'leak', SHINGLE: 'shingle',
      CALLOUT: 'callout', MEASURE: 'measure', AREA: 'area', CROP: 'crop',
    },

    ANNOTATION_TYPES: {
      PEN: 'pen', LINE: 'line', ARROW: 'arrow', RECT: 'rect', CIRCLE: 'circle', TEXT: 'text',
      HAIL: 'hail', WIND: 'wind', LEAK: 'leak', SHINGLE: 'shingle', CALLOUT: 'callout',
      MEASURE: 'measure', AREA: 'area',
    },

    COLOR_PALETTE: ['#ff0000', '#ff6600', '#ffcc00', '#00cc00', '#0088ff', '#cc00ff', '#ffffff', '#000000'],

    DAMAGE_TYPES: [
      'Hail', 'Wind', 'Leak', 'Missing Shingle', 'Cracked Tile',
      'Flashing Damage', 'Gutter Damage', 'Soffit/Fascia', 'Tree Damage',
      'Algae/Moss', 'Ice Dam', 'Ponding Water', 'Other'
    ],

    SEVERITY_LEVELS: {
      'minor': { label: 'Minor', color: '#ffcc00' },
      'moderate': { label: 'Moderate', color: '#ff6600' },
      'severe': { label: 'Severe', color: '#ff0000' },
    },

    ROOF_LOCATIONS: [
      'Ridge', 'Hip', 'Valley', 'Field/Slope', 'Edge/Drip', 'Flashing',
      'Vent/Pipe Boot', 'Chimney', 'Skylight', 'Gutter', 'Downspout',
      'Soffit', 'Fascia', 'Dormer', 'Flat Section'
    ],

    PHASES: ['Before', 'During', 'After'],
  };

  const STATE = {
    currentTool: CONFIG.TOOLS.PEN,
    currentColor: CONFIG.DEFAULT_COLOR,
    currentLineWidth: CONFIG.DEFAULT_LINE_WIDTH,
    currentOpacity: CONFIG.DEFAULT_OPACITY,
    fillShapes: false,
    calloutNumber: 1,

    photoUrl: null,
    photoId: null,
    leadId: null,
    userId: null,
    photoData: null,

    damageType: '',
    severity: '',
    location: '',
    phase: 'Before',
    notes: '',
    customTags: [],

    selectedAnnotationId: null,

    brightness: 0,
    contrast: 0,
    rotation: 0,
    zoom: 1,
    zoomFit: true,

    cropActive: false,
    cropRect: null,

    originalImage: null,

    hasUnsavedChanges: false,
  };

  let modal = null;
  let canvas = null;
  let overlayCanvas = null;
  let ctx = null;
  let overlayCtx = null;
  let annotations = [];
  let undoStack = [];
  let redoStack = [];
  let isDrawing = false;
  let startX = 0;
  let startY = 0;
  let currentPoints = [];

  function generateId() {
    return 'photo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.position = 'fixed';
    toast.style.top = '20px';
    toast.style.right = '20px';
    toast.style.padding = '12px 20px';
    toast.style.borderRadius = '4px';
    toast.style.fontSize = '14px';
    toast.style.zIndex = '10000';
    toast.style.maxWidth = '400px';
    toast.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';

    if (type === 'error') {
      toast.style.backgroundColor = '#ff4444';
      toast.style.color = 'white';
    } else if (type === 'success') {
      toast.style.backgroundColor = '#44ff44';
      toast.style.color = '#000';
    } else {
      toast.style.backgroundColor = '#444';
      toast.style.color = '#fff';
    }

    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }

  function saveState() {
    undoStack.push({
      annotations: JSON.parse(JSON.stringify(annotations)),
      brightness: STATE.brightness,
      contrast: STATE.contrast,
    });
    redoStack = [];
    STATE.hasUnsavedChanges = true;
    updateUndoRedoButtons();
  }

  function undo() {
    if (undoStack.length === 0) return;
    redoStack.push({
      annotations: JSON.parse(JSON.stringify(annotations)),
      brightness: STATE.brightness,
      contrast: STATE.contrast,
    });
    const previousState = undoStack.pop();
    annotations = previousState.annotations;
    STATE.brightness = previousState.brightness;
    STATE.contrast = previousState.contrast;
    redraw();
    updateUndoRedoButtons();
  }

  function redo() {
    if (redoStack.length === 0) return;
    undoStack.push({
      annotations: JSON.parse(JSON.stringify(annotations)),
      brightness: STATE.brightness,
      contrast: STATE.contrast,
    });
    const nextState = redoStack.pop();
    annotations = nextState.annotations;
    STATE.brightness = nextState.brightness;
    STATE.contrast = nextState.contrast;
    redraw();
    updateUndoRedoButtons();
  }

  function updateUndoRedoButtons() {
    const undoBtn = modal?.querySelector('[data-action="undo"]');
    const redoBtn = modal?.querySelector('[data-action="redo"]');
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
  }

  function initializeCanvases(wrapper, width, height) {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.display = 'block';
    canvas.style.cursor = 'crosshair';

    overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = width;
    overlayCanvas.height = height;
    overlayCanvas.style.position = 'absolute';
    overlayCanvas.style.top = '0';
    overlayCanvas.style.left = '0';
    overlayCanvas.style.display = 'block';
    overlayCanvas.style.cursor = 'crosshair';
    overlayCanvas.tabIndex = 0;

    const container = document.createElement('div');
    container.style.position = 'relative';
    container.style.display = 'inline-block';
    container.style.margin = '0 auto';
    container.style.border = '1px solid #ddd';

    container.appendChild(canvas);
    container.appendChild(overlayCanvas);
    wrapper.appendChild(container);

    ctx = canvas.getContext('2d', { willReadFrequently: true });
    overlayCtx = overlayCanvas.getContext('2d');

    setupCanvasEventHandlers();
  }

  function setupCanvasEventHandlers() {
    overlayCanvas.addEventListener('mousedown', handleCanvasMouseDown);
    overlayCanvas.addEventListener('mousemove', handleCanvasMouseMove);
    overlayCanvas.addEventListener('mouseup', handleCanvasMouseUp);
    overlayCanvas.addEventListener('mouseleave', handleCanvasMouseLeave);
    overlayCanvas.addEventListener('wheel', handleCanvasWheel, false);

    overlayCanvas.addEventListener('touchstart', handleCanvasTouchStart);
    overlayCanvas.addEventListener('touchmove', handleCanvasTouchMove);
    overlayCanvas.addEventListener('touchend', handleCanvasTouchEnd);
  }

  function getCanvasCoords(e) {
    const rect = overlayCanvas.getBoundingClientRect();
    const scaleX = overlayCanvas.width / rect.width;
    const scaleY = overlayCanvas.height / rect.height;

    let x, y;
    if (e.touches) {
      x = (e.touches[0].clientX - rect.left) * scaleX;
      y = (e.touches[0].clientY - rect.top) * scaleY;
    } else {
      x = (e.clientX - rect.left) * scaleX;
      y = (e.clientY - rect.top) * scaleY;
    }
    return { x, y };
  }

  function handleCanvasMouseDown(e) {
    if (STATE.currentTool === CONFIG.TOOLS.SELECT) return;
    const coords = getCanvasCoords(e);
    startX = coords.x;
    startY = coords.y;
    currentPoints = [{ x: startX, y: startY }];
    isDrawing = true;
    if (STATE.currentTool === CONFIG.TOOLS.PEN || STATE.currentTool === CONFIG.TOOLS.ERASER) {
      saveState();
    }
  }

  function handleCanvasMouseMove(e) {
    if (!isDrawing) return;
    const coords = getCanvasCoords(e);

    if (STATE.currentTool === CONFIG.TOOLS.PEN) {
      currentPoints.push({ x: coords.x, y: coords.y });
      redraw();
      drawPenStroke(currentPoints);
    } else if (STATE.currentTool === CONFIG.TOOLS.ERASER) {
      currentPoints.push({ x: coords.x, y: coords.y });
      redraw();
      drawEraser(currentPoints);
    } else if (STATE.currentTool === CONFIG.TOOLS.LINE) {
      redraw();
      drawLine(startX, startY, coords.x, coords.y);
    } else if (STATE.currentTool === CONFIG.TOOLS.ARROW) {
      redraw();
      drawArrow(startX, startY, coords.x, coords.y);
    } else if (STATE.currentTool === CONFIG.TOOLS.RECT) {
      redraw();
      drawRect(startX, startY, coords.x, coords.y);
    } else if (STATE.currentTool === CONFIG.TOOLS.CIRCLE) {
      redraw();
      drawCircle(startX, startY, coords.x, coords.y);
    } else if (STATE.currentTool === CONFIG.TOOLS.MEASURE) {
      redraw();
      drawMeasureLine(startX, startY, coords.x, coords.y);
    } else if (STATE.currentTool === CONFIG.TOOLS.AREA) {
      redraw();
      drawAreaOutline(startX, startY, coords.x, coords.y);
    }
  }

  function handleCanvasMouseUp(e) {
    if (!isDrawing) return;
    const coords = getCanvasCoords(e);
    isDrawing = false;

    if (STATE.currentTool === CONFIG.TOOLS.PEN) {
      annotations.push({
        id: generateId(),
        type: CONFIG.ANNOTATION_TYPES.PEN,
        points: currentPoints,
        color: STATE.currentColor,
        lineWidth: STATE.currentLineWidth,
        opacity: STATE.currentOpacity,
      });
      saveState();
    } else if (STATE.currentTool === CONFIG.TOOLS.ERASER) {
      annotations.push({
        id: generateId(),
        type: CONFIG.ANNOTATION_TYPES.TEXT,
        isEraser: true,
        points: currentPoints,
        lineWidth: STATE.currentLineWidth,
      });
      saveState();
    } else if (STATE.currentTool === CONFIG.TOOLS.LINE) {
      annotations.push({
        id: generateId(),
        type: CONFIG.ANNOTATION_TYPES.LINE,
        x1: startX, y1: startY, x2: coords.x, y2: coords.y,
        color: STATE.currentColor,
        lineWidth: STATE.currentLineWidth,
        opacity: STATE.currentOpacity,
      });
      saveState();
    } else if (STATE.currentTool === CONFIG.TOOLS.ARROW) {
      annotations.push({
        id: generateId(),
        type: CONFIG.ANNOTATION_TYPES.ARROW,
        x1: startX, y1: startY, x2: coords.x, y2: coords.y,
        color: STATE.currentColor,
        lineWidth: STATE.currentLineWidth,
        opacity: STATE.currentOpacity,
      });
      saveState();
    } else if (STATE.currentTool === CONFIG.TOOLS.RECT) {
      annotations.push({
        id: generateId(),
        type: CONFIG.ANNOTATION_TYPES.RECT,
        x1: startX, y1: startY, x2: coords.x, y2: coords.y,
        color: STATE.currentColor,
        lineWidth: STATE.currentLineWidth,
        opacity: STATE.currentOpacity,
        fill: STATE.fillShapes,
      });
      saveState();
    } else if (STATE.currentTool === CONFIG.TOOLS.CIRCLE) {
      annotations.push({
        id: generateId(),
        type: CONFIG.ANNOTATION_TYPES.CIRCLE,
        x1: startX, y1: startY, x2: coords.x, y2: coords.y,
        color: STATE.currentColor,
        lineWidth: STATE.currentLineWidth,
        opacity: STATE.currentOpacity,
        fill: STATE.fillShapes,
      });
      saveState();
    } else if (STATE.currentTool === CONFIG.TOOLS.HAIL) {
      annotations.push({
        id: generateId(),
        type: CONFIG.ANNOTATION_TYPES.HAIL,
        x: coords.x, y: coords.y,
        color: STATE.currentColor,
        opacity: STATE.currentOpacity,
      });
      saveState();
    } else if (STATE.currentTool === CONFIG.TOOLS.WIND) {
      annotations.push({
        id: generateId(),
        type: CONFIG.ANNOTATION_TYPES.WIND,
        x: coords.x, y: coords.y,
        color: STATE.currentColor,
        opacity: STATE.currentOpacity,
      });
      saveState();
    } else if (STATE.currentTool === CONFIG.TOOLS.LEAK) {
      annotations.push({
        id: generateId(),
        type: CONFIG.ANNOTATION_TYPES.LEAK,
        x: coords.x, y: coords.y,
        color: STATE.currentColor,
        opacity: STATE.currentOpacity,
      });
      saveState();
    } else if (STATE.currentTool === CONFIG.TOOLS.SHINGLE) {
      annotations.push({
        id: generateId(),
        type: CONFIG.ANNOTATION_TYPES.SHINGLE,
        x: coords.x, y: coords.y,
        color: STATE.currentColor,
        opacity: STATE.currentOpacity,
      });
      saveState();
    } else if (STATE.currentTool === CONFIG.TOOLS.CALLOUT) {
      annotations.push({
        id: generateId(),
        type: CONFIG.ANNOTATION_TYPES.CALLOUT,
        x: coords.x, y: coords.y,
        number: STATE.calloutNumber,
        color: STATE.currentColor,
        opacity: STATE.currentOpacity,
      });
      STATE.calloutNumber++;
      saveState();
    } else if (STATE.currentTool === CONFIG.TOOLS.MEASURE) {
      const distance = Math.sqrt(Math.pow(coords.x - startX, 2) + Math.pow(coords.y - startY, 2));
      annotations.push({
        id: generateId(),
        type: CONFIG.ANNOTATION_TYPES.MEASURE,
        x1: startX, y1: startY, x2: coords.x, y2: coords.y,
        distance: distance.toFixed(0),
        color: STATE.currentColor,
        lineWidth: STATE.currentLineWidth,
        opacity: STATE.currentOpacity,
      });
      saveState();
    } else if (STATE.currentTool === CONFIG.TOOLS.AREA) {
      const width = Math.abs(coords.x - startX);
      const height = Math.abs(coords.y - startY);
      const area = width * height;
      annotations.push({
        id: generateId(),
        type: CONFIG.ANNOTATION_TYPES.AREA,
        x1: startX, y1: startY, x2: coords.x, y2: coords.y,
        width: width.toFixed(0),
        height: height.toFixed(0),
        area: area.toFixed(0),
        color: STATE.currentColor,
        lineWidth: STATE.currentLineWidth,
        opacity: STATE.currentOpacity,
      });
      saveState();
    } else if (STATE.currentTool === CONFIG.TOOLS.TEXT) {
      const text = prompt('Enter text:');
      if (text) {
        annotations.push({
          id: generateId(),
          type: CONFIG.ANNOTATION_TYPES.TEXT,
          x: coords.x, y: coords.y,
          text: text,
          color: STATE.currentColor,
          fontSize: 16,
          opacity: STATE.currentOpacity,
        });
        saveState();
        redraw();
      }
    }

    currentPoints = [];
    redraw();
    updateAnnotationsList();
  }

  function handleCanvasMouseLeave() {
    isDrawing = false;
    currentPoints = [];
  }

  function handleCanvasTouchStart(e) {
    e.preventDefault();
    handleCanvasMouseDown(e);
  }

  function handleCanvasTouchMove(e) {
    e.preventDefault();
    handleCanvasMouseMove(e);
  }

  function handleCanvasTouchEnd(e) {
    e.preventDefault();
    handleCanvasMouseUp(e);
  }

  function handleCanvasWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    STATE.zoom *= delta;
    STATE.zoom = Math.max(0.1, Math.min(STATE.zoom, 3));
    STATE.zoomFit = false;
    applyZoom();
  }

  function redraw() {
    if (!canvas || !overlayCanvas || !ctx || !overlayCtx) return;
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    annotations.forEach(ann => drawAnnotation(ann));
  }

  function drawAnnotation(ann) {
    if (!overlayCtx) return;
    overlayCtx.globalAlpha = (ann.opacity || 100) / 100;

    switch (ann.type) {
      case CONFIG.ANNOTATION_TYPES.PEN:
        drawPenStroke(ann.points || [], ann.color, ann.lineWidth, ann.opacity);
        break;
      case CONFIG.ANNOTATION_TYPES.LINE:
        drawLine(ann.x1, ann.y1, ann.x2, ann.y2, ann.color, ann.lineWidth);
        break;
      case CONFIG.ANNOTATION_TYPES.ARROW:
        drawArrow(ann.x1, ann.y1, ann.x2, ann.y2, ann.color, ann.lineWidth);
        break;
      case CONFIG.ANNOTATION_TYPES.RECT:
        drawRect(ann.x1, ann.y1, ann.x2, ann.y2, ann.color, ann.lineWidth, ann.fill);
        break;
      case CONFIG.ANNOTATION_TYPES.CIRCLE:
        drawCircle(ann.x1, ann.y1, ann.x2, ann.y2, ann.color, ann.lineWidth, ann.fill);
        break;
      case CONFIG.ANNOTATION_TYPES.TEXT:
        if (!ann.isEraser) {
          drawText(ann.x, ann.y, ann.text, ann.color, ann.fontSize);
        }
        break;
      case CONFIG.ANNOTATION_TYPES.HAIL:
        drawHailIcon(ann.x, ann.y, ann.color);
        break;
      case CONFIG.ANNOTATION_TYPES.WIND:
        drawWindIcon(ann.x, ann.y, ann.color);
        break;
      case CONFIG.ANNOTATION_TYPES.LEAK:
        drawLeakIcon(ann.x, ann.y, ann.color);
        break;
      case CONFIG.ANNOTATION_TYPES.SHINGLE:
        drawShingleIcon(ann.x, ann.y, ann.color);
        break;
      case CONFIG.ANNOTATION_TYPES.CALLOUT:
        drawCallout(ann.x, ann.y, ann.number, ann.color);
        break;
      case CONFIG.ANNOTATION_TYPES.MEASURE:
        drawMeasureLine(ann.x1, ann.y1, ann.x2, ann.y2, ann.distance);
        break;
      case CONFIG.ANNOTATION_TYPES.AREA:
        drawAreaOutline(ann.x1, ann.y1, ann.x2, ann.y2, ann.width, ann.height, ann.area);
        break;
    }
    overlayCtx.globalAlpha = 1;
  }

  function drawPenStroke(points, color = STATE.currentColor, lineWidth = STATE.currentLineWidth, opacity = STATE.currentOpacity) {
    if (points.length < 2) return;
    overlayCtx.strokeStyle = color;
    overlayCtx.lineWidth = lineWidth;
    overlayCtx.lineCap = 'round';
    overlayCtx.lineJoin = 'round';
    overlayCtx.globalAlpha = (opacity || 100) / 100;
    overlayCtx.beginPath();
    overlayCtx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      overlayCtx.lineTo(points[i].x, points[i].y);
    }
    overlayCtx.stroke();
    overlayCtx.globalAlpha = 1;
  }

  function drawEraser(points, lineWidth = 15) {
    overlayCtx.clearRect(points[0].x - lineWidth / 2, points[0].y - lineWidth / 2, lineWidth, lineWidth);
    for (let i = 1; i < points.length; i++) {
      overlayCtx.clearRect(points[i].x - lineWidth / 2, points[i].y - lineWidth / 2, lineWidth, lineWidth);
    }
  }

  function drawLine(x1, y1, x2, y2, color = STATE.currentColor, lineWidth = STATE.currentLineWidth) {
    overlayCtx.strokeStyle = color;
    overlayCtx.lineWidth = lineWidth;
    overlayCtx.lineCap = 'round';
    overlayCtx.beginPath();
    overlayCtx.moveTo(x1, y1);
    overlayCtx.lineTo(x2, y2);
    overlayCtx.stroke();
  }

  function drawArrow(x1, y1, x2, y2, color = STATE.currentColor, lineWidth = STATE.currentLineWidth) {
    const headlen = 15;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    overlayCtx.strokeStyle = color;
    overlayCtx.fillStyle = color;
    overlayCtx.lineWidth = lineWidth;
    overlayCtx.lineCap = 'round';
    overlayCtx.beginPath();
    overlayCtx.moveTo(x1, y1);
    overlayCtx.lineTo(x2, y2);
    overlayCtx.stroke();
    overlayCtx.beginPath();
    overlayCtx.moveTo(x2, y2);
    overlayCtx.lineTo(x2 - headlen * Math.cos(angle - Math.PI / 6), y2 - headlen * Math.sin(angle - Math.PI / 6));
    overlayCtx.lineTo(x2 - headlen * Math.cos(angle + Math.PI / 6), y2 - headlen * Math.sin(angle + Math.PI / 6));
    overlayCtx.closePath();
    overlayCtx.fill();
  }

  function drawRect(x1, y1, x2, y2, color = STATE.currentColor, lineWidth = STATE.currentLineWidth, fill = false) {
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    overlayCtx.strokeStyle = color;
    overlayCtx.lineWidth = lineWidth;
    if (fill) {
      overlayCtx.fillStyle = color;
      overlayCtx.fillRect(x, y, width, height);
    }
    overlayCtx.strokeRect(x, y, width, height);
  }

  function drawCircle(x1, y1, x2, y2, color = STATE.currentColor, lineWidth = STATE.currentLineWidth, fill = false) {
    const radius = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    overlayCtx.strokeStyle = color;
    overlayCtx.lineWidth = lineWidth;
    overlayCtx.beginPath();
    overlayCtx.arc(x1, y1, radius, 0, 2 * Math.PI);
    if (fill) {
      overlayCtx.fillStyle = color;
      overlayCtx.fill();
    }
    overlayCtx.stroke();
  }

  function drawText(x, y, text, color = STATE.currentColor, fontSize = 16) {
    overlayCtx.fillStyle = color;
    overlayCtx.font = `${fontSize}px Arial`;
    overlayCtx.fillText(text, x, y);
  }

  function drawHailIcon(x, y, color = '#ff0000') {
    overlayCtx.fillStyle = color;
    overlayCtx.beginPath();
    overlayCtx.arc(x, y, 8, 0, 2 * Math.PI);
    overlayCtx.fill();
    overlayCtx.strokeStyle = '#fff';
    overlayCtx.lineWidth = 2;
    overlayCtx.stroke();
  }

  function drawWindIcon(x, y, color = '#ff6600') {
    overlayCtx.strokeStyle = color;
    overlayCtx.lineWidth = 2;
    overlayCtx.beginPath();
    overlayCtx.arc(x, y, 8, 0.5 * Math.PI, 1.5 * Math.PI);
    overlayCtx.stroke();
    overlayCtx.beginPath();
    overlayCtx.moveTo(x + 8, y);
    overlayCtx.lineTo(x + 4, y - 4);
    overlayCtx.lineTo(x + 4, y + 4);
    overlayCtx.closePath();
    overlayCtx.fill();
  }

  function drawLeakIcon(x, y, color = '#0088ff') {
    overlayCtx.fillStyle = color;
    overlayCtx.beginPath();
    overlayCtx.moveTo(x, y - 8);
    overlayCtx.bezierCurveTo(x - 4, y - 4, x - 4, y + 4, x, y + 8);
    overlayCtx.bezierCurveTo(x + 4, y + 4, x + 4, y - 4, x, y - 8);
    overlayCtx.closePath();
    overlayCtx.fill();
  }

  function drawShingleIcon(x, y, color = '#ffcc00') {
    overlayCtx.fillStyle = color;
    overlayCtx.beginPath();
    overlayCtx.moveTo(x - 6, y - 6);
    overlayCtx.lineTo(x + 6, y - 6);
    overlayCtx.lineTo(x + 2, y + 6);
    overlayCtx.lineTo(x - 2, y + 6);
    overlayCtx.closePath();
    overlayCtx.fill();
    overlayCtx.strokeStyle = '#000';
    overlayCtx.lineWidth = 1;
    overlayCtx.stroke();
  }

  function drawCallout(x, y, number, color = '#ff0000') {
    const size = 20;
    overlayCtx.fillStyle = color;
    overlayCtx.beginPath();
    overlayCtx.arc(x, y, size, 0, 2 * Math.PI);
    overlayCtx.fill();
    overlayCtx.fillStyle = '#fff';
    overlayCtx.font = 'bold 14px Arial';
    overlayCtx.textAlign = 'center';
    overlayCtx.textBaseline = 'middle';
    overlayCtx.fillText(number.toString(), x, y);
  }

  function drawMeasureLine(x1, y1, x2, y2, distance) {
    overlayCtx.strokeStyle = '#ff0000';
    overlayCtx.lineWidth = 2;
    overlayCtx.beginPath();
    overlayCtx.moveTo(x1, y1);
    overlayCtx.lineTo(x2, y2);
    overlayCtx.stroke();
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    overlayCtx.fillStyle = '#ff0000';
    overlayCtx.font = 'bold 12px Arial';
    overlayCtx.fillText(distance ? distance + 'px' : Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2)).toFixed(0) + 'px', midX, midY - 10);
  }

  function drawAreaOutline(x1, y1, x2, y2, width, height, area) {
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);
    overlayCtx.strokeStyle = '#ff0000';
    overlayCtx.lineWidth = 2;
    overlayCtx.setLineDash([5, 5]);
    overlayCtx.strokeRect(x, y, w, h);
    overlayCtx.setLineDash([]);
    if (area) {
      overlayCtx.fillStyle = '#ff0000';
      overlayCtx.font = 'bold 12px Arial';
      overlayCtx.fillText(area + 'px²', x + 5, y + 15);
    }
  }

  function applyBrightness(value) {
    STATE.brightness = value;
    redrawCanvasWithAdjustments();
  }

  function applyContrast(value) {
    STATE.contrast = value;
    redrawCanvasWithAdjustments();
  }

  function redrawCanvasWithAdjustments() {
    if (!STATE.originalImage || !ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(STATE.originalImage, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const brightness = STATE.brightness;
      const contrast = STATE.contrast / 100 + 1;
      data[i] = Math.max(0, Math.min(255, (data[i] - 128) * contrast + 128 + brightness));
      data[i + 1] = Math.max(0, Math.min(255, (data[i + 1] - 128) * contrast + 128 + brightness));
      data[i + 2] = Math.max(0, Math.min(255, (data[i + 2] - 128) * contrast + 128 + brightness));
    }
    ctx.putImageData(imageData, 0, 0);
  }

  function applyZoom() {
    if (!overlayCanvas) return;
    const wrapper = overlayCanvas.parentNode;
    if (STATE.zoomFit) {
      wrapper.style.transform = 'scale(1)';
    } else {
      wrapper.style.transform = `scale(${STATE.zoom})`;
    }
  }

  function fitZoom() {
    STATE.zoom = 1;
    STATE.zoomFit = true;
    applyZoom();
  }

  function setZoom(level) {
    STATE.zoom = level / 100;
    STATE.zoomFit = false;
    applyZoom();
  }

  function addCustomTag(tag) {
    if (tag && !STATE.customTags.includes(tag)) {
      STATE.customTags.push(tag);
      updateCustomTagsDisplay();
    }
  }

  function removeCustomTag(tag) {
    STATE.customTags = STATE.customTags.filter(t => t !== tag);
    updateCustomTagsDisplay();
  }

  function updateCustomTagsDisplay() {
    const container = modal?.querySelector('.nbd-custom-tags');
    if (!container) return;
    container.innerHTML = STATE.customTags.map(tag => `
      <div style="display: inline-flex; align-items: center; gap: 5px; background: #007bff; color: white; padding: 4px 8px; border-radius: 12px; font-size: 12px;">
        <span>${tag}</span>
        <button class="nbd-tag-remove" data-tag="${tag}" style="background: none; border: none; color: white; cursor: pointer; font-weight: bold; padding: 0 2px;">×</button>
      </div>
    `).join('');
    container.querySelectorAll('.nbd-tag-remove').forEach(btn => {
      btn.onclick = () => removeCustomTag(btn.dataset.tag);
    });
  }

  function updateAnnotationsList() {
    const container = modal?.querySelector('.nbd-annotations-list');
    if (!container) return;
    if (annotations.length === 0) {
      container.innerHTML = '<div style="padding: 10px; text-align: center; color: #999; font-size: 12px;">No annotations</div>';
      return;
    }
    container.innerHTML = annotations.map(ann => {
      const icon = getAnnotationIcon(ann.type);
      return `
        <div class="nbd-annotation-item" data-id="${ann.id}" style="padding: 8px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-size: 12px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 16px;">${icon}</span>
            <span>${ann.type}</span>
          </div>
          <button class="nbd-ann-delete" data-id="${ann.id}" style="background: none; border: none; color: red; cursor: pointer; font-weight: bold;">×</button>
        </div>
      `;
    }).join('');
    container.querySelectorAll('.nbd-annotation-item').forEach(item => {
      item.onclick = () => {
        STATE.selectedAnnotationId = item.dataset.id;
        container.querySelectorAll('.nbd-annotation-item').forEach(i => i.style.background = 'transparent');
        item.style.background = '#f0f0f0';
      };
    });
    container.querySelectorAll('.nbd-ann-delete').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        annotations = annotations.filter(a => a.id !== btn.dataset.id);
        saveState();
        redraw();
        updateAnnotationsList();
      };
    });
  }

  function getAnnotationIcon(type) {
    const icons = {
      'pen': '✏️', 'line': '−', 'arrow': '→', 'rect': '▭', 'circle': '●', 'text': 'A',
      'hail': '●', 'wind': '〰', 'leak': '💧', 'shingle': '◼', 'callout': '①',
      'measure': '📏', 'area': '▢',
    };
    return icons[type] || '·';
  }

  async function saveTagsOnly() {
    if (!STATE.photoId) {
      showToast('No photo ID — save as copy first', 'error');
      return;
    }
    try {
      const metadata = {
        damageType: STATE.damageType,
        severity: STATE.severity,
        location: STATE.location,
        phase: STATE.phase,
        notes: STATE.notes,
        tags: STATE.customTags,
      };
      const docRef = window.doc(window.db, 'photos', STATE.photoId);
      await window.updateDoc(docRef, metadata);
      showToast('Tags saved successfully!', 'success');
      STATE.hasUnsavedChanges = false;
      setTimeout(() => closeEditor(), 1000);
    } catch (error) {
      console.error('Save tags error:', error);
      showToast('Failed to save tags: ' + error.message, 'error');
    }
  }

  async function flattenAndSaveAs() {
    if (!canvas || !overlayCanvas) {
      showToast('Canvas not ready', 'error');
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

  async function downloadImage() {
    if (!canvas || !overlayCanvas) {
      showToast('Canvas not ready', 'error');
      return;
    }
    try {
      const finalCanvas = document.createElement('canvas');
      finalCanvas.width = canvas.width;
      finalCanvas.height = canvas.height;
      const finalCtx = finalCanvas.getContext('2d');
      finalCtx.drawImage(canvas, 0, 0);
      finalCtx.drawImage(overlayCanvas, 0, 0);
      finalCanvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `annotated_${STATE.photoId || 'photo'}_${Date.now()}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 'image/jpeg', 0.95);
    } catch (error) {
      console.error('Download error:', error);
      showToast('Download failed: ' + error.message, 'error');
    }
  }

  async function uploadAndSaveAnnotated(blob, saveOver = false) {
    try {
      const fileName = saveOver ? `photo_${STATE.photoId}.jpg` : `photo_${generateId()}.jpg`;
      const filePath = `photos/${fileName}`;

      const storageRef = window.ref(window.storage, filePath);
      await window.uploadBytes(storageRef, blob);
      const downloadUrl = await window.getDownloadURL(storageRef);

      const metadata = {
        damageType: STATE.damageType,
        severity: STATE.severity,
        location: STATE.location,
        phase: STATE.phase,
        notes: STATE.notes,
        tags: STATE.customTags,
        isAnnotated: true,
        annotatedAt: window.serverTimestamp(),
      };

      if (saveOver && STATE.photoId) {
        const docRef = window.doc(window.db, 'photos', STATE.photoId);
        await window.updateDoc(docRef, {
          url: downloadUrl,
          ...metadata,
        });
      } else {
        const photoRef = window.collection(window.db, 'photos');
        await window.addDoc(photoRef, {
          url: downloadUrl,
          originalPhotoId: STATE.photoId,
          leadId: STATE.leadId,
          userId: STATE.userId,
          ...metadata,
        });
      }

      STATE.hasUnsavedChanges = false;
      showToast('Photo saved successfully', 'success');
      setTimeout(() => {
        closeEditor();
      }, 1500);
    } catch (error) {
      console.error('Upload error:', error);
      showToast('Upload failed: ' + error.message, 'error');
    }
  }

  function createTopToolbar() {
    const toolbar = document.createElement('div');
    toolbar.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 15px;
      background: #f5f5f5;
      border-bottom: 1px solid #ddd;
      gap: 10px;
    `;

    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.gap = '5px';

    const backBtn = document.createElement('button');
    backBtn.textContent = '← Back';
    backBtn.style.cssText = 'padding: 8px 12px; background: #fff; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;';
    backBtn.onclick = () => closeEditorWithPrompt();
    left.appendChild(backBtn);

    const center = document.createElement('div');
    center.textContent = 'Photo Editor';
    center.style.cssText = 'flex: 1; text-align: center; font-weight: bold; font-size: 16px;';

    const right = document.createElement('div');
    right.style.cssText = 'display: flex; gap: 5px;';

    const btnConfig = [
      { action: 'undo', text: 'Undo' },
      { action: 'redo', text: 'Redo' },
      { action: 'download', text: 'Download' },
      { action: 'save-tags', text: 'Save Tags Only' },
      { action: 'save-new', text: 'Save as Copy' },
      { action: 'save-over', text: 'Save Over' },
    ];

    btnConfig.forEach(cfg => {
      const btn = document.createElement('button');
      btn.dataset.action = cfg.action;
      btn.textContent = cfg.text;
      btn.style.cssText = 'padding: 8px 12px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 13px;';
      btn.onmouseover = () => btn.style.background = '#0056b3';
      btn.onmouseout = () => btn.style.background = '#007bff';

      if (cfg.action === 'undo') {
        btn.onclick = undo;
      } else if (cfg.action === 'redo') {
        btn.onclick = redo;
      } else if (cfg.action === 'download') {
        btn.onclick = downloadImage;
      } else if (cfg.action === 'save-tags') {
        btn.onclick = saveTagsOnly;
        btn.style.background = '#22c55e';
        btn.onmouseover = () => btn.style.background = '#16a34a';
        btn.onmouseout = () => btn.style.background = '#22c55e';
      } else if (cfg.action === 'save-new') {
        btn.onclick = flattenAndSaveAs;
      } else if (cfg.action === 'save-over') {
        btn.onclick = flattenAndSaveOver;
      }

      right.appendChild(btn);
    });

    toolbar.appendChild(left);
    toolbar.appendChild(center);
    toolbar.appendChild(right);

    return toolbar;
  }

  function createLeftToolbar() {
    const toolbar = document.createElement('div');
    toolbar.style.cssText = `
      width: 70px;
      background: #f5f5f5;
      border-right: 1px solid #ddd;
      display: flex;
      flex-direction: column;
      padding: 10px 5px;
      gap: 5px;
      overflow-y: auto;
    `;

    const tools = [
      { name: 'pen', label: 'Pen', key: 'P' },
      { name: 'line', label: 'Line', key: 'L' },
      { name: 'arrow', label: 'Arrow', key: 'A' },
      { name: 'rect', label: 'Rectangle', key: 'R' },
      { name: 'circle', label: 'Circle', key: 'C' },
      { name: 'text', label: 'Text', key: 'T' },
      { name: 'eraser', label: 'Eraser', key: 'E' },
      { name: 'hail', label: 'Hail', key: 'H' },
      { name: 'wind', label: 'Wind', key: 'W' },
      { name: 'leak', label: 'Leak', key: '1' },
      { name: 'shingle', label: 'Shingle', key: '2' },
      { name: 'callout', label: 'Callout', key: 'Q' },
      { name: 'measure', label: 'Measure', key: 'M' },
      { name: 'area', label: 'Area', key: '3' },
    ];

    tools.forEach(tool => {
      const btn = document.createElement('button');
      btn.dataset.tool = tool.name;
      btn.textContent = tool.label.charAt(0);
      btn.title = `${tool.label} (${tool.key})`;
      btn.style.cssText = `
        padding: 8px;
        background: ${STATE.currentTool === tool.name ? '#007bff' : '#fff'};
        color: ${STATE.currentTool === tool.name ? '#fff' : '#000'};
        border: 1px solid #ddd;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        font-weight: bold;
      `;

      btn.onclick = () => {
        STATE.currentTool = tool.name;
        toolbar.querySelectorAll('button').forEach(b => {
          b.style.background = '#fff';
          b.style.color = '#000';
        });
        btn.style.background = '#007bff';
        btn.style.color = '#fff';
      };

      toolbar.appendChild(btn);
    });

    return toolbar;
  }

  function createRightSidebar() {
    const sidebar = document.createElement('div');
    sidebar.style.cssText = `
      width: 280px;
      background: #f5f5f5;
      border-left: 1px solid #ddd;
      overflow-y: auto;
      padding: 15px;
      display: flex;
      flex-direction: column;
      gap: 15px;
      font-size: 13px;
    `;

    const addSection = (title, content) => {
      const section = document.createElement('div');
      section.innerHTML = `<div style="font-weight: bold; margin-bottom: 8px;">${title}</div>`;
      section.appendChild(content);
      sidebar.appendChild(section);
    };

    const damageSelect = document.createElement('select');
    damageSelect.style.cssText = 'width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;';
    damageSelect.innerHTML = `<option value="">Select type</option>` + CONFIG.DAMAGE_TYPES.map(t => `<option value="${t}">${t}</option>`).join('');
    damageSelect.value = STATE.damageType;
    damageSelect.onchange = () => { STATE.damageType = damageSelect.value; };
    addSection('Damage Type', damageSelect);

    const severityDiv = document.createElement('div');
    Object.entries(CONFIG.SEVERITY_LEVELS).forEach(([key, val]) => {
      const label = document.createElement('label');
      label.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 6px; cursor: pointer;';
      label.innerHTML = `
        <input type="radio" name="severity" value="${key}" ${STATE.severity === key ? 'checked' : ''}>
        <span style="display: inline-block; width: 12px; height: 12px; border-radius: 2px; background: ${val.color};"></span>
        ${val.label}
      `;
      label.querySelector('input').onchange = () => { STATE.severity = key; };
      severityDiv.appendChild(label);
    });
    addSection('Severity', severityDiv);

    const locationSelect = document.createElement('select');
    locationSelect.style.cssText = 'width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;';
    locationSelect.innerHTML = `<option value="">Select location</option>` + CONFIG.ROOF_LOCATIONS.map(l => `<option value="${l}">${l}</option>`).join('');
    locationSelect.value = STATE.location;
    locationSelect.onchange = () => { STATE.location = locationSelect.value; };
    addSection('Location', locationSelect);

    const phaseDiv = document.createElement('div');
    phaseDiv.style.cssText = 'display: flex; gap: 5px;';
    CONFIG.PHASES.forEach(p => {
      const btn = document.createElement('button');
      btn.textContent = p;
      btn.style.cssText = `
        flex: 1;
        padding: 6px;
        background: ${STATE.phase === p ? '#007bff' : '#fff'};
        color: ${STATE.phase === p ? '#fff' : '#000'};
        border: 1px solid #ddd;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
      `;
      btn.onclick = () => {
        STATE.phase = p;
        phaseDiv.querySelectorAll('button').forEach(b => {
          b.style.background = '#fff';
          b.style.color = '#000';
        });
        btn.style.background = '#007bff';
        btn.style.color = '#fff';
      };
      phaseDiv.appendChild(btn);
    });
    addSection('Phase', phaseDiv);

    const tagsInputDiv = document.createElement('div');
    const tagInput = document.createElement('input');
    tagInput.type = 'text';
    tagInput.placeholder = 'Add tag (Enter)';
    tagInput.style.cssText = 'width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 8px; box-sizing: border-box;';
    tagInput.onkeypress = (e) => {
      if (e.key === 'Enter' && tagInput.value.trim()) {
        addCustomTag(tagInput.value.trim());
        tagInput.value = '';
      }
    };
    tagsInputDiv.appendChild(tagInput);
    const tagsContainer = document.createElement('div');
    tagsContainer.className = 'nbd-custom-tags';
    tagsContainer.style.cssText = 'display: flex; flex-wrap: wrap; gap: 5px;';
    tagsInputDiv.appendChild(tagsContainer);
    addSection('Custom Tags', tagsInputDiv);

    const notesTA = document.createElement('textarea');
    notesTA.placeholder = 'Additional details...';
    notesTA.value = STATE.notes;
    notesTA.style.cssText = 'width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; min-height: 80px; box-sizing: border-box;';
    notesTA.oninput = () => { STATE.notes = notesTA.value; };
    addSection('Notes', notesTA);

    const annList = document.createElement('div');
    annList.className = 'nbd-annotations-list';
    annList.style.cssText = 'border: 1px solid #ddd; border-radius: 4px; max-height: 200px; overflow-y: auto;';
    addSection('Annotations', annList);

    return sidebar;
  }

  function createBottomToolbar() {
    const toolbar = document.createElement('div');
    toolbar.style.cssText = `
      display: flex;
      flex-wrap: wrap;
      padding: 12px 15px;
      background: #f5f5f5;
      border-top: 1px solid #ddd;
      gap: 15px;
      align-items: center;
      font-size: 12px;
    `;

    const colorGroup = document.createElement('div');
    colorGroup.style.cssText = 'display: flex; gap: 8px; align-items: center;';
    colorGroup.innerHTML = '<span style="font-weight: bold;">Color:</span>';
    CONFIG.COLOR_PALETTE.forEach(color => {
      const swatch = document.createElement('div');
      swatch.style.cssText = `
        width: 24px;
        height: 24px;
        background: ${color};
        border: ${STATE.currentColor === color ? '3px solid #000' : '1px solid #ddd'};
        border-radius: 3px;
        cursor: pointer;
      `;
      swatch.onclick = () => {
        STATE.currentColor = color;
        toolbar.querySelectorAll('[data-color-swatch]').forEach(s => s.style.border = '1px solid #ddd');
        swatch.style.border = '3px solid #000';
      };
      swatch.dataset.colorSwatch = color;
      colorGroup.appendChild(swatch);
    });
    toolbar.appendChild(colorGroup);

    const widthGroup = document.createElement('div');
    widthGroup.style.cssText = 'display: flex; gap: 8px; align-items: center;';
    widthGroup.innerHTML = '<span style="font-weight: bold;">Width:</span>';
    const widthSlider = document.createElement('input');
    widthSlider.type = 'range';
    widthSlider.min = '1';
    widthSlider.max = '10';
    widthSlider.value = STATE.currentLineWidth;
    widthSlider.style.cssText = 'width: 60px;';
    const widthValue = document.createElement('span');
    widthValue.textContent = STATE.currentLineWidth + 'px';
    widthSlider.oninput = () => {
      STATE.currentLineWidth = parseInt(widthSlider.value);
      widthValue.textContent = widthSlider.value + 'px';
    };
    widthGroup.appendChild(widthSlider);
    widthGroup.appendChild(widthValue);
    toolbar.appendChild(widthGroup);

    const opacityGroup = document.createElement('div');
    opacityGroup.style.cssText = 'display: flex; gap: 8px; align-items: center;';
    opacityGroup.innerHTML = '<span style="font-weight: bold;">Opacity:</span>';
    const opacitySlider = document.createElement('input');
    opacitySlider.type = 'range';
    opacitySlider.min = '0';
    opacitySlider.max = '100';
    opacitySlider.value = STATE.currentOpacity;
    opacitySlider.style.cssText = 'width: 60px;';
    const opacityValue = document.createElement('span');
    opacityValue.textContent = STATE.currentOpacity + '%';
    opacitySlider.oninput = () => {
      STATE.currentOpacity = parseInt(opacitySlider.value);
      opacityValue.textContent = opacitySlider.value + '%';
    };
    opacityGroup.appendChild(opacitySlider);
    opacityGroup.appendChild(opacityValue);
    toolbar.appendChild(opacityGroup);

    const fillGroup = document.createElement('div');
    fillGroup.style.cssText = 'display: flex; gap: 5px; align-items: center;';
    const fillCheckbox = document.createElement('input');
    fillCheckbox.type = 'checkbox';
    fillCheckbox.checked = STATE.fillShapes;
    fillCheckbox.onchange = () => { STATE.fillShapes = fillCheckbox.checked; };
    fillGroup.appendChild(fillCheckbox);
    fillGroup.innerHTML += '<span>Fill</span>';
    toolbar.appendChild(fillGroup);

    const brightGroup = document.createElement('div');
    brightGroup.style.cssText = 'display: flex; gap: 8px; align-items: center;';
    brightGroup.innerHTML = '<span style="font-weight: bold;">Brightness:</span>';
    const brightSlider = document.createElement('input');
    brightSlider.type = 'range';
    brightSlider.min = '-100';
    brightSlider.max = '100';
    brightSlider.value = '0';
    brightSlider.style.cssText = 'width: 60px;';
    const brightValue = document.createElement('span');
    brightValue.textContent = '0';
    brightSlider.oninput = () => {
      applyBrightness(parseInt(brightSlider.value));
      brightValue.textContent = brightSlider.value;
    };
    brightGroup.appendChild(brightSlider);
    brightGroup.appendChild(brightValue);
    toolbar.appendChild(brightGroup);

    const contrastGroup = document.createElement('div');
    contrastGroup.style.cssText = 'display: flex; gap: 8px; align-items: center;';
    contrastGroup.innerHTML = '<span style="font-weight: bold;">Contrast:</span>';
    const contrastSlider = document.createElement('input');
    contrastSlider.type = 'range';
    contrastSlider.min = '-100';
    contrastSlider.max = '100';
    contrastSlider.value = '0';
    contrastSlider.style.cssText = 'width: 60px;';
    const contrastValue = document.createElement('span');
    contrastValue.textContent = '0';
    contrastSlider.oninput = () => {
      applyContrast(parseInt(contrastSlider.value));
      contrastValue.textContent = contrastSlider.value;
    };
    contrastGroup.appendChild(contrastSlider);
    contrastGroup.appendChild(contrastValue);
    toolbar.appendChild(contrastGroup);

    const zoomGroup = document.createElement('div');
    zoomGroup.style.cssText = 'display: flex; gap: 5px; align-items: center;';
    zoomGroup.innerHTML = '<span style="font-weight: bold;">Zoom:</span>';
    ['Fit', '50%', '100%', '200%'].forEach((label, idx) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = 'padding: 4px 8px; background: #fff; border: 1px solid #ddd; border-radius: 3px; cursor: pointer; font-size: 11px;';
      btn.onclick = () => {
        if (idx === 0) fitZoom();
        else setZoom(parseInt(label));
      };
      zoomGroup.appendChild(btn);
    });
    toolbar.appendChild(zoomGroup);

    return toolbar;
  }

  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (!modal) return;

      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          undo();
        } else if ((e.key === 'z' && e.shiftKey) || (e.key === 'y')) {
          e.preventDefault();
          redo();
        }
      }

      const toolMap = {
        'p': CONFIG.TOOLS.PEN,
        'l': CONFIG.TOOLS.LINE,
        'a': CONFIG.TOOLS.ARROW,
        'r': CONFIG.TOOLS.RECT,
        'c': CONFIG.TOOLS.CIRCLE,
        't': CONFIG.TOOLS.TEXT,
        'e': CONFIG.TOOLS.ERASER,
        'h': CONFIG.TOOLS.HAIL,
        'w': CONFIG.TOOLS.WIND,
        '1': CONFIG.TOOLS.LEAK,
        '2': CONFIG.TOOLS.SHINGLE,
        'q': CONFIG.TOOLS.CALLOUT,
        'm': CONFIG.TOOLS.MEASURE,
        '3': CONFIG.TOOLS.AREA,
      };

      if (toolMap[e.key.toLowerCase()]) {
        e.preventDefault();
        STATE.currentTool = toolMap[e.key.toLowerCase()];
        updateToolButtons();
      }
    });
  }

  function updateToolButtons() {
    const buttons = modal?.querySelectorAll('[data-tool]');
    if (!buttons) return;
    buttons.forEach(btn => {
      if (btn.dataset.tool === STATE.currentTool) {
        btn.style.background = '#007bff';
        btn.style.color = '#fff';
      } else {
        btn.style.background = '#fff';
        btn.style.color = '#000';
      }
    });
  }

  function closeEditorWithPrompt() {
    if (STATE.hasUnsavedChanges) {
      if (confirm('You have unsaved changes. Are you sure you want to close?')) {
        closeEditor();
      }
    } else {
      closeEditor();
    }
  }

  function closeEditor() {
    if (modal) {
      modal.remove();
      modal = null;
    }
    canvas = null;
    overlayCanvas = null;
    ctx = null;
    overlayCtx = null;
    annotations = [];
    undoStack = [];
    redoStack = [];
    STATE.selectedAnnotationId = null;
  }

  async function loadPhotoData(photoId) {
    if (!photoId) return;
    try {
      const docRef = window.doc(window.db, 'photos', photoId);
      const docSnap = await window.getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        STATE.damageType = data.damageType || '';
        STATE.severity = data.severity || '';
        STATE.location = data.location || '';
        STATE.phase = data.phase || 'Before';
        STATE.notes = data.notes || '';
        STATE.customTags = data.tags || [];
        updateRightSidebar();
      }
    } catch (error) {
      console.error('Error loading photo data:', error);
    }
  }

  function updateRightSidebar() {
    if (!modal) return;
    const sidebar = modal.querySelector('[style*="border-left"]');
    if (!sidebar) return;
    const selects = sidebar.querySelectorAll('select');
    if (selects[0]) selects[0].value = STATE.damageType;
    if (selects[1]) selects[1].value = STATE.location;
    const severityRadios = sidebar.querySelectorAll('input[name="severity"]');
    severityRadios.forEach(radio => radio.checked = radio.value === STATE.severity);
    const notesTA = sidebar.querySelector('textarea');
    if (notesTA) notesTA.value = STATE.notes;
    updateCustomTagsDisplay();
  }

  async function openEditor(photoUrl, photoId, leadId, photoData) {
    STATE.photoUrl = photoUrl;
    STATE.photoId = photoId;
    STATE.leadId = leadId;
    STATE.photoData = photoData;
    STATE.userId = window.auth?.currentUser?.uid || '';
    STATE.calloutNumber = 1;
    STATE.hasUnsavedChanges = false;
    annotations = [];
    undoStack = [];
    redoStack = [];

    if (photoData) {
      STATE.damageType = photoData.damageType || '';
      STATE.severity = photoData.severity || '';
      STATE.location = photoData.location || '';
      STATE.phase = photoData.phase || 'Before';
      STATE.notes = photoData.notes || '';
      STATE.customTags = photoData.tags || [];
    } else if (photoId) {
      await loadPhotoData(photoId);
    }

    modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: white;
      z-index: 9999;
      display: flex;
      flex-direction: column;
    `;

    document.body.appendChild(modal);

    const topPlaceholder = document.createElement('div');
    const containerPlaceholder = document.createElement('div');
    containerPlaceholder.style.cssText = 'flex: 1; display: flex; overflow: hidden;';
    const canvasPlaceholder = document.createElement('div');
    canvasPlaceholder.style.cssText = 'flex: 1; display: flex; justify-content: center; align-items: center; background: #e0e0e0; position: relative; overflow: auto;';
    const bottomPlaceholder = document.createElement('div');

    modal.appendChild(topPlaceholder);
    modal.appendChild(containerPlaceholder);
    modal.appendChild(bottomPlaceholder);

    try {
      STATE.originalImage = new Image();

      const onImageReady = () => {
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

        canvasPlaceholder.innerHTML = '';
        initializeCanvases(canvasPlaceholder, width, height);
        ctx.drawImage(STATE.originalImage, 0, 0, width, height);

        topPlaceholder.parentNode.replaceChild(createTopToolbar(), topPlaceholder);
        const leftSidebar = createLeftToolbar();
        const rightSidebar = createRightSidebar();
        containerPlaceholder.appendChild(leftSidebar);
        containerPlaceholder.appendChild(canvasPlaceholder);
        containerPlaceholder.appendChild(rightSidebar);
        bottomPlaceholder.parentNode.replaceChild(createBottomToolbar(), bottomPlaceholder);

        updateUndoRedoButtons();
        updateAnnotationsList();
        setupKeyboardShortcuts();

        if (overlayCanvas) {
          overlayCanvas.focus();
        }
      };

      // Extract storage path from Firebase Storage URL for proxy fallback
      const getStoragePath = (url) => {
        try {
          const match = url.match(/\/o\/([^?]+)/);
          if (match) return decodeURIComponent(match[1]);
        } catch (e) {}
        return null;
      };

      // Strategy 1: Try Cloud Function image proxy (bypasses CORS entirely)
      const loadViaProxy = async (url) => {
        const storagePath = getStoragePath(url);
        if (!storagePath) { loadDirect(url); return; }

        const proxyUrl = 'https://us-central1-nobigdeal-pro.cloudfunctions.net/imageProxy?path=' + encodeURIComponent(storagePath);
        try {
          const response = await fetch(proxyUrl);
          if (!response.ok) throw new Error('Proxy returned ' + response.status);
          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);
          STATE.originalImage.onload = () => {
            URL.revokeObjectURL(blobUrl);
            onImageReady();
          };
          STATE.originalImage.onerror = () => {
            URL.revokeObjectURL(blobUrl);
            loadDirect(url);
          };
          STATE.originalImage.src = blobUrl;
        } catch (e) {
          console.warn('Proxy load failed, trying direct:', e.message);
          loadDirect(url);
        }
      };

      // Strategy 2: Direct load with crossOrigin (works if CORS is configured)
      const loadDirect = (url) => {
        STATE.originalImage = new Image();
        STATE.originalImage.crossOrigin = 'anonymous';
        STATE.originalImage.onload = onImageReady;
        STATE.originalImage.onerror = () => {
          // Strategy 3: Load without crossOrigin (canvas tainted but image displays)
          console.warn('CORS load failed, loading without crossOrigin (canvas will be tainted)');
          STATE.originalImage = new Image();
          STATE.originalImage.onload = onImageReady;
          STATE.originalImage.onerror = () => {
            showToast('Failed to load image', 'error');
            closeEditor();
          };
          STATE.originalImage.src = url;
        };
        STATE.originalImage.src = url;
      };

      loadViaProxy(photoUrl);
    } catch (error) {
      console.error('Editor open error:', error);
      showToast('Error opening editor: ' + error.message, 'error');
      closeEditor();
    }
  }

  window.NBDPhotoEditor = {
    open: openEditor,
    close: closeEditor,
  };

  console.log('Photo Editor module loaded. Use: window.NBDPhotoEditor.open(photoUrl, photoId, leadId, photoData)');
})();
