/**
 * quick-capture.js — NBD Whisper full-screen voice scratchpad (W130)
 *
 * Different surface from the W128 dictate-into-input FAB. This is
 * the "talk for 5 minutes between knocks, get back a structured
 * summary + extracted action items + smart routing" flow.
 *
 * UX:
 *   1. Tap the floating "🎙" capture button (sits above the W128
 *      dictate mic in the bottom-right corner stack)
 *   2. Full-screen modal opens
 *   3. Tap big record button → recording starts (5 min cap)
 *   4. Tap stop → AI summary lands:
 *      - Overview (1-2 sentence plain recap)
 *      - Action items list
 *      - Extracted entities (people, addresses, amounts, dates)
 *      - Category badge
 *   5. Routing buttons at the bottom:
 *      - "Save to lead [picker]" — links the capture to a lead, drops
 *        a note in lead.activity, optionally commits action items as
 *        tasks on that lead.
 *      - "Make these N tasks" — for use after Save-to-lead picks a lead.
 *      - "Just save" — capture lands in users/{uid}/captures/{id}
 *      - "Discard" — dismiss without saving
 *
 * Schema:
 *   users/{uid}/captures/{captureId}:
 *     transcript, summary, linkedLeadId|null, createdAt, archived,
 *     mode: 'quick-capture'
 *
 * Public API:
 *   window.NBDQuickCapture.open()
 *   window.NBDQuickCapture.attachFloatingButton()
 *
 * Reuses the W129 `dictate` Cloud Function with mode='summarize'.
 */

(function () {
  'use strict';
  if (window.NBDQuickCapture && window.NBDQuickCapture.__sentinel === 'nbd-qc-v1') return;

  const FLOAT_BTN_ID = 'nbd-qc-fab';
  const MODAL_ID = 'nbd-qc-modal';
  const MAX_RECORD_MS = 5 * 60_000; // 5 minutes — long-form scratchpad

  let _stream = null;
  let _recorder = null;
  let _chunks = [];
  let _audioCtx = null;
  let _analyser = null;
  let _animFrame = 0;
  let _maxTimer = 0;
  let _recordingStartMs = 0;
  let _isRecording = false;
  let _isProcessing = false;
  let _currentResult = null; // { transcript, summary }

  function isSupported() {
    return typeof window.MediaRecorder === 'function'
      && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function toast(msg, kind) {
    if (typeof window.showToast === 'function') window.showToast(msg, kind || 'info');
  }

  // ─── Floating "Capture" button (sits above the W128 dictate FAB) ─
  function attachFloatingButton() {
    if (!isSupported()) return;
    if (document.getElementById(FLOAT_BTN_ID)) return;
    const btn = document.createElement('button');
    btn.id = FLOAT_BTN_ID;
    btn.type = 'button';
    btn.title = 'Quick Capture (W130) — talk for up to 5 min, get a structured summary';
    btn.setAttribute('aria-label', 'Open Quick Capture');
    btn.style.cssText =
      'position:fixed;bottom:84px;right:20px;z-index:9999;' +
      'width:44px;height:44px;border-radius:50%;border:none;' +
      'background:#1a1f2e;color:var(--orange, #c8541a);font-size:18px;' +
      'box-shadow:0 4px 16px rgba(0,0,0,0.4);cursor:pointer;' +
      'border:1.5px solid var(--orange, #c8541a);' +
      'display:flex;align-items:center;justify-content:center;' +
      '-webkit-tap-highlight-color:transparent;';
    btn.innerHTML = '🎙';
    btn.addEventListener('click', open);
    document.body.appendChild(btn);
  }

  // ─── Modal lifecycle ────────────────────────────────────────────
  function open() {
    if (document.getElementById(MODAL_ID)) return;
    const modal = _buildModal();
    document.body.appendChild(modal);
    // ESC closes (when not recording — guard against accidental loss)
    document.addEventListener('keydown', _escHandler);
  }

  function close() {
    if (_isRecording) _stopRecorder();
    _releaseStream();
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.remove();
    document.removeEventListener('keydown', _escHandler);
    _currentResult = null;
    _isProcessing = false;
  }

  function _escHandler(e) {
    if (e.key === 'Escape' && !_isRecording) close();
  }

  function _buildModal() {
    const wrap = document.createElement('div');
    wrap.id = MODAL_ID;
    wrap.style.cssText =
      'position:fixed;inset:0;z-index:10010;background:rgba(10,20,36,0.92);' +
      'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);' +
      'display:flex;align-items:center;justify-content:center;padding:20px;' +
      'overflow-y:auto;';

    wrap.innerHTML =
      '<div style="background:#0f1729;border:1px solid #2a3344;border-radius:14px;' +
        'width:100%;max-width:640px;padding:24px;color:#e2e8f0;' +
        'box-shadow:0 20px 60px rgba(0,0,0,0.6);font:inherit;">' +

        // Header
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;">' +
          '<div>' +
            '<div style="font-size:11px;color:#94a3b8;letter-spacing:0.08em;font-weight:600;margin-bottom:2px;">QUICK CAPTURE</div>' +
            '<div style="font-size:20px;font-weight:700;">Talk it out</div>' +
          '</div>' +
          '<button type="button" id="nbd-qc-close" style="background:transparent;border:none;color:#94a3b8;font-size:24px;cursor:pointer;padding:4px 10px;line-height:1;">×</button>' +
        '</div>' +

        // Recording panel
        '<div id="nbd-qc-record-panel" style="text-align:center;padding:28px 18px;background:#0a1424;border-radius:10px;margin-bottom:14px;">' +
          '<button type="button" id="nbd-qc-record-btn" style="width:88px;height:88px;border-radius:50%;border:none;background:var(--orange, #c8541a);color:#fff;font-size:36px;cursor:pointer;box-shadow:0 8px 24px rgba(200,84,26,0.45);transition:transform 120ms ease;">🎤</button>' +
          '<div id="nbd-qc-status" style="margin-top:14px;font-size:14px;color:#94a3b8;">Tap to start recording (up to 5 minutes)</div>' +
          '<canvas id="nbd-qc-canvas" width="360" height="36" style="display:none;margin:14px auto 0;"></canvas>' +
          '<div id="nbd-qc-timer" style="display:none;margin-top:8px;font-variant-numeric:tabular-nums;font-size:13px;color:#fbbf24;">0:00 / 5:00</div>' +
        '</div>' +

        // Result panel (hidden until processed)
        '<div id="nbd-qc-result" style="display:none;"></div>' +

      '</div>';

    // Wire up
    wrap.querySelector('#nbd-qc-close').addEventListener('click', close);
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap && !_isRecording) close();
    });
    wrap.querySelector('#nbd-qc-record-btn').addEventListener('click', () => {
      if (_isRecording) _stopRecorder();
      else _startRecorder();
    });
    return wrap;
  }

  // ─── Recorder lifecycle ─────────────────────────────────────────
  async function _startRecorder() {
    if (_isRecording) return;
    if (!isSupported()) { toast('Voice not supported on this browser', 'error'); return; }
    try {
      _stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      toast(e && e.name === 'NotAllowedError'
        ? 'Mic access denied — enable in browser settings.'
        : 'Could not access microphone.', 'error');
      return;
    }
    const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    let mimeType = '';
    for (const t of preferred) {
      if (MediaRecorder.isTypeSupported(t)) { mimeType = t; break; }
    }
    try {
      _recorder = mimeType
        ? new MediaRecorder(_stream, { mimeType })
        : new MediaRecorder(_stream);
    } catch (e) {
      _releaseStream();
      toast('Recorder failed to initialize.', 'error');
      return;
    }
    _chunks = [];
    _recorder.addEventListener('dataavailable', (ev) => {
      if (ev.data && ev.data.size > 0) _chunks.push(ev.data);
    });
    _recorder.addEventListener('error', () => {
      toast('Recording error.', 'error');
      _stopRecorder();
    });
    _recorder.addEventListener('stop', _onStop);

    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        _audioCtx = new Ctx();
        const src = _audioCtx.createMediaStreamSource(_stream);
        _analyser = _audioCtx.createAnalyser();
        _analyser.fftSize = 128;
        src.connect(_analyser);
      }
    } catch (_) {}

    _recorder.start(1000);
    _isRecording = true;
    _recordingStartMs = Date.now();
    _showRecordingUI();
    _maxTimer = setTimeout(_stopRecorder, MAX_RECORD_MS);
  }

  function _stopRecorder() {
    if (!_isRecording) return;
    if (_maxTimer) { clearTimeout(_maxTimer); _maxTimer = 0; }
    if (_recorder && _recorder.state !== 'inactive') {
      try { _recorder.stop(); } catch (_) {}
    }
  }

  async function _onStop() {
    _isRecording = false;
    _hideRecordingUI();
    const blob = new Blob(_chunks, { type: (_recorder && _recorder.mimeType) || 'audio/webm' });
    _releaseStream();
    if (!blob || blob.size < 1500) {
      _setStatus('Clip too short — tap to try again.');
      _resetRecordButton();
      return;
    }
    _setStatus('Processing your capture…');
    _isProcessing = true;
    try {
      const result = await _summarize(blob);
      if (!result || !result.transcript) {
        _setStatus('No speech detected — tap to try again.');
        _resetRecordButton();
        return;
      }
      _currentResult = result;
      _renderResult(result);
    } catch (e) {
      console.warn('[NBDQuickCapture] processing failed:', e);
      _setStatus('Capture failed: ' + (e.message || 'try again'));
      _resetRecordButton();
    } finally {
      _isProcessing = false;
    }
  }

  function _releaseStream() {
    if (_stream) {
      try { _stream.getTracks().forEach(t => t.stop()); } catch (_) {}
      _stream = null;
    }
    if (_audioCtx) {
      try { _audioCtx.close(); } catch (_) {}
      _audioCtx = null;
    }
    _analyser = null;
    if (_animFrame) {
      cancelAnimationFrame(_animFrame);
      _animFrame = 0;
    }
  }

  // ─── Recording UI ──────────────────────────────────────────────
  function _showRecordingUI() {
    const recordBtn = document.getElementById('nbd-qc-record-btn');
    const canvas = document.getElementById('nbd-qc-canvas');
    const timer = document.getElementById('nbd-qc-timer');
    const closeBtn = document.getElementById('nbd-qc-close');
    if (recordBtn) {
      recordBtn.innerHTML = '⏹';
      recordBtn.style.background = '#ef4444';
      recordBtn.style.boxShadow = '0 8px 24px rgba(239,68,68,0.45)';
    }
    if (canvas) canvas.style.display = 'block';
    if (timer) timer.style.display = 'inline-block';
    // Disable close button mid-record so accidental tap doesn't lose audio.
    if (closeBtn) {
      closeBtn.style.opacity = '0.3';
      closeBtn.style.pointerEvents = 'none';
    }
    _setStatus('Recording — tap stop when done');

    // Draw loop
    const ctx = canvas && canvas.getContext('2d');
    if (!ctx) return;
    const draw = () => {
      if (!_isRecording) return;
      const data = new Uint8Array(_analyser ? _analyser.frequencyBinCount : 0);
      if (_analyser) _analyser.getByteFrequencyData(data);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const bars = 40;
      const barW = canvas.width / bars - 1;
      for (let i = 0; i < bars; i++) {
        const sample = _analyser
          ? data[Math.floor((i / bars) * data.length)] / 255
          : 0.1 + 0.1 * Math.sin(Date.now() / 220 + i / 3);
        const h = Math.max(2, sample * canvas.height);
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(i * (barW + 1), (canvas.height - h) / 2, barW, h);
      }
      const elapsedSec = Math.floor((Date.now() - _recordingStartMs) / 1000);
      const m = Math.floor(elapsedSec / 60);
      const s = elapsedSec % 60;
      if (timer) timer.textContent = m + ':' + String(s).padStart(2, '0') + ' / 5:00';
      _animFrame = requestAnimationFrame(draw);
    };
    draw();
  }

  function _hideRecordingUI() {
    const canvas = document.getElementById('nbd-qc-canvas');
    const timer = document.getElementById('nbd-qc-timer');
    const closeBtn = document.getElementById('nbd-qc-close');
    if (canvas) canvas.style.display = 'none';
    if (timer) timer.style.display = 'none';
    if (closeBtn) { closeBtn.style.opacity = '1'; closeBtn.style.pointerEvents = ''; }
    if (_animFrame) { cancelAnimationFrame(_animFrame); _animFrame = 0; }
  }

  function _resetRecordButton() {
    const recordBtn = document.getElementById('nbd-qc-record-btn');
    if (!recordBtn) return;
    recordBtn.innerHTML = '🎤';
    recordBtn.style.background = 'var(--orange, #c8541a)';
    recordBtn.style.boxShadow = '0 8px 24px rgba(200,84,26,0.45)';
  }

  function _setStatus(msg) {
    const el = document.getElementById('nbd-qc-status');
    if (el) el.textContent = msg;
  }

  // ─── Server pipeline ────────────────────────────────────────────
  async function _blobToBase64(blob) {
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  async function _summarize(blob) {
    if (!window._functions || !window._httpsCallable) {
      const mod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
      window._functions = mod.getFunctions();
      window._httpsCallable = mod.httpsCallable;
    }
    const fn = window._httpsCallable(window._functions, 'dictate');
    const audioBase64 = await _blobToBase64(blob);
    const todayLocal = new Date().toLocaleDateString('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const res = await fn({
      audioBase64,
      mimeType: blob.type || 'audio/webm',
      mode: 'summarize',
      todayLocal,
    });
    return res.data || {};
  }

  // ─── Result rendering ───────────────────────────────────────────
  function _renderResult(result) {
    const panel = document.getElementById('nbd-qc-record-panel');
    const resultEl = document.getElementById('nbd-qc-result');
    if (!panel || !resultEl) return;
    panel.style.display = 'none';

    const summary = result.summary || {};
    const overview = summary.overview || result.transcript || '';
    const actionItems = Array.isArray(summary.actionItems) ? summary.actionItems : [];
    const people = Array.isArray(summary.people) ? summary.people : [];
    const addresses = Array.isArray(summary.addresses) ? summary.addresses : [];
    const amounts = Array.isArray(summary.amounts) ? summary.amounts : [];
    const dates = Array.isArray(summary.dates) ? summary.dates : [];
    const category = summary.category || 'other';

    function listChip(label, items) {
      if (!items.length) return '';
      return '<div style="margin-bottom:10px;">' +
        '<div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;">' + escHtml(label) + '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:5px;">' +
        items.map(x => '<span style="display:inline-block;padding:3px 9px;background:#1a2540;border:1px solid #2a3344;border-radius:999px;font-size:12px;">' + escHtml(x) + '</span>').join('') +
        '</div></div>';
    }

    resultEl.innerHTML =
      '<div style="background:#0a1424;border-radius:10px;padding:16px;margin-bottom:14px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">' +
          '<div style="font-size:11px;color:#94a3b8;letter-spacing:0.06em;font-weight:600;">SUMMARY</div>' +
          '<div style="display:inline-block;padding:3px 9px;background:rgba(200,84,26,0.15);border:1px solid var(--orange, #c8541a);border-radius:999px;font-size:11px;color:var(--orange, #c8541a);">' + escHtml(category) + '</div>' +
        '</div>' +
        '<div style="font-size:14px;line-height:1.5;margin-bottom:14px;">' + escHtml(overview) + '</div>' +

        (actionItems.length
          ? '<div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">ACTION ITEMS</div>' +
            '<ul style="margin:0 0 14px;padding-left:20px;font-size:13px;line-height:1.6;">' +
              actionItems.map(t => '<li>' + escHtml(t) + '</li>').join('') +
            '</ul>'
          : '') +

        listChip('People', people) +
        listChip('Addresses', addresses) +
        listChip('Amounts', amounts) +
        listChip('Dates', dates) +

      '</div>' +

      // Routing actions
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">' +
        '<button type="button" id="nbd-qc-act-save" style="padding:11px;background:var(--orange, #c8541a);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">Save capture</button>' +
        '<button type="button" id="nbd-qc-act-link" style="padding:11px;background:#1a2540;color:inherit;border:1px solid #2a3344;border-radius:8px;cursor:pointer;font-size:13px;">Save & link to lead</button>' +
      '</div>' +
      (actionItems.length
        ? '<button type="button" id="nbd-qc-act-tasks" style="width:100%;padding:11px;background:#1a2540;color:inherit;border:1px solid #2a3344;border-radius:8px;cursor:pointer;font-size:13px;margin-bottom:8px;">' +
          '+ Make ' + actionItems.length + ' task' + (actionItems.length === 1 ? '' : 's') + ' on a lead</button>'
        : '') +
      '<button type="button" id="nbd-qc-act-discard" style="width:100%;padding:9px;background:transparent;color:#94a3b8;border:none;border-radius:8px;cursor:pointer;font-size:12px;">Discard</button>' +

      // Transcript reveal
      '<details style="margin-top:14px;">' +
        '<summary style="font-size:11px;color:#94a3b8;cursor:pointer;text-transform:uppercase;letter-spacing:0.06em;">Show full transcript</summary>' +
        '<div style="margin-top:8px;padding:12px;background:#0a1424;border-radius:8px;font-size:13px;line-height:1.5;color:#cbd5e1;white-space:pre-wrap;">' + escHtml(result.transcript || '') + '</div>' +
      '</details>';

    resultEl.style.display = 'block';

    document.getElementById('nbd-qc-act-save').addEventListener('click', () => _saveCapture(null));
    document.getElementById('nbd-qc-act-link').addEventListener('click', () => _showLeadPicker('save'));
    const tasksBtn = document.getElementById('nbd-qc-act-tasks');
    if (tasksBtn) tasksBtn.addEventListener('click', () => _showLeadPicker('tasks'));
    document.getElementById('nbd-qc-act-discard').addEventListener('click', close);
  }

  // ─── Lead picker (for save-to-lead and make-tasks) ──────────────
  function _showLeadPicker(action) {
    // Use the existing in-memory window._leads cache populated by
    // dashboard.html / customer.html. If it's not loaded yet, show
    // a search-by-name fallback instead.
    const leads = Array.isArray(window._leads) ? window._leads : [];
    const resultEl = document.getElementById('nbd-qc-result');
    if (!resultEl) return;

    const overlay = document.createElement('div');
    overlay.id = 'nbd-qc-picker-overlay';
    overlay.style.cssText =
      'position:absolute;inset:0;background:rgba(10,20,36,0.96);z-index:10;' +
      'border-radius:14px;padding:24px;overflow-y:auto;display:flex;flex-direction:column;';
    overlay.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">' +
        '<div style="font-size:14px;font-weight:700;">' +
          (action === 'tasks' ? 'Pick a lead to add tasks to' : 'Pick a lead to link this capture to') +
        '</div>' +
        '<button type="button" id="nbd-qc-picker-cancel" style="background:transparent;border:none;color:#94a3b8;font-size:20px;cursor:pointer;line-height:1;">×</button>' +
      '</div>' +
      '<input type="text" id="nbd-qc-picker-search" placeholder="Search by name or address…" style="width:100%;padding:10px;border-radius:6px;border:1px solid #2a3344;background:#0a1424;color:inherit;font:inherit;font-size:14px;margin-bottom:12px;box-sizing:border-box;">' +
      '<div id="nbd-qc-picker-list" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:6px;"></div>';

    // Position relative on the panel parent so the overlay can
    // absolutely position over the result.
    const modalContent = document.querySelector('#' + MODAL_ID + ' > div');
    if (modalContent) {
      modalContent.style.position = 'relative';
      modalContent.appendChild(overlay);
    }

    const listEl = overlay.querySelector('#nbd-qc-picker-list');
    const searchEl = overlay.querySelector('#nbd-qc-picker-search');
    overlay.querySelector('#nbd-qc-picker-cancel').addEventListener('click', () => overlay.remove());
    searchEl.focus();

    function render(filterText) {
      const q = String(filterText || '').toLowerCase().trim();
      const matched = q
        ? leads.filter(l => {
            const n = ((l.firstName || '') + ' ' + (l.lastName || '')).trim().toLowerCase();
            const addr = (l.address || '').toLowerCase();
            return n.includes(q) || addr.includes(q);
          }).slice(0, 30)
        : leads.slice(0, 30);
      if (matched.length === 0) {
        listEl.innerHTML = '<div style="color:#94a3b8;font-size:13px;padding:14px;text-align:center;">No leads match. Try a different search.</div>';
        return;
      }
      listEl.innerHTML = matched.map(l => {
        const name = ((l.firstName || '') + ' ' + (l.lastName || '')).trim() || '(no name)';
        const addr = l.address || '';
        return '<button type="button" class="nbd-qc-lead-btn" data-lead-id="' + escHtml(l.id) + '" ' +
          'style="padding:10px 12px;text-align:left;background:#0f1729;border:1px solid #2a3344;border-radius:6px;color:inherit;cursor:pointer;font-size:13px;">' +
          '<div style="font-weight:600;">' + escHtml(name) + '</div>' +
          '<div style="color:#94a3b8;font-size:12px;margin-top:2px;">' + escHtml(addr) + '</div>' +
          '</button>';
      }).join('');
      Array.from(listEl.querySelectorAll('.nbd-qc-lead-btn')).forEach(b => {
        b.addEventListener('click', () => {
          const leadId = b.dataset.leadId;
          overlay.remove();
          if (action === 'tasks') _saveTasksToLead(leadId);
          else _saveCapture(leadId);
        });
      });
    }
    render('');
    searchEl.addEventListener('input', () => render(searchEl.value));
  }

  // ─── Save flows ─────────────────────────────────────────────────
  async function _ensureFirestore() {
    if (window.db && window.collection && window.addDoc && window.serverTimestamp) {
      return {
        db: window.db,
        collection: window.collection,
        addDoc: window.addDoc,
        serverTimestamp: window.serverTimestamp,
        doc: window.doc,
        updateDoc: window.updateDoc,
      };
    }
    const mod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    return {
      db: window.db || mod.getFirestore(),
      collection: mod.collection,
      addDoc: mod.addDoc,
      serverTimestamp: mod.serverTimestamp,
      doc: mod.doc,
      updateDoc: mod.updateDoc,
    };
  }

  async function _saveCapture(linkedLeadId) {
    if (!_currentResult) return;
    const uid = window._user?.uid || (window.auth && window.auth.currentUser && window.auth.currentUser.uid);
    if (!uid) {
      toast('Sign in to save captures.', 'error');
      return;
    }
    try {
      const fb = await _ensureFirestore();
      const captureRef = await fb.addDoc(
        fb.collection(fb.db, 'users', uid, 'captures'),
        {
          transcript: _currentResult.transcript || '',
          summary: _currentResult.summary || null,
          linkedLeadId: linkedLeadId || null,
          mode: 'quick-capture',
          archived: false,
          createdAt: fb.serverTimestamp(),
        }
      );

      // If linked to a lead, drop a note in the lead's activity log
      // so the rep + (in the future) team managers see it on the
      // customer-page timeline.
      if (linkedLeadId) {
        try {
          await fb.addDoc(
            fb.collection(fb.db, 'leads', linkedLeadId, 'activity'),
            {
              userId: uid,
              type: 'note',
              source: 'rep',
              label: 'Voice capture',
              text: _currentResult.summary?.overview || _currentResult.transcript?.slice(0, 200) || '',
              captureId: captureRef.id,
              createdAt: fb.serverTimestamp(),
            }
          );
        } catch (actErr) {
          console.warn('[NBDQuickCapture] activity write failed:', actErr.message);
        }
      }

      toast(linkedLeadId ? 'Saved & linked ✓' : 'Capture saved ✓', 'success');
      close();
    } catch (e) {
      console.warn('[NBDQuickCapture] save failed:', e);
      toast('Save failed: ' + (e.message || 'try again'), 'error');
    }
  }

  async function _saveTasksToLead(leadId) {
    if (!_currentResult) return;
    const items = (_currentResult.summary && _currentResult.summary.actionItems) || [];
    if (items.length === 0) return;
    const uid = window._user?.uid || (window.auth && window.auth.currentUser && window.auth.currentUser.uid);
    if (!uid || !leadId) {
      toast('Sign in or pick a lead first.', 'error');
      return;
    }
    try {
      const fb = await _ensureFirestore();
      // Save the capture too (so the user's history retains it).
      const captureRef = await fb.addDoc(
        fb.collection(fb.db, 'users', uid, 'captures'),
        {
          transcript: _currentResult.transcript || '',
          summary: _currentResult.summary || null,
          linkedLeadId: leadId,
          tasksCommitted: items.length,
          mode: 'quick-capture',
          archived: false,
          createdAt: fb.serverTimestamp(),
        }
      );
      // Then add each action item as a task on the lead.
      let added = 0;
      for (const text of items) {
        if (typeof text !== 'string' || !text.trim()) continue;
        try {
          await fb.addDoc(
            fb.collection(fb.db, 'leads', leadId, 'tasks'),
            {
              text: text.trim().slice(0, 200),
              done: false,
              dueDate: '',
              source: 'voice-capture',
              captureId: captureRef.id,
              createdAt: fb.serverTimestamp(),
            }
          );
          added++;
        } catch (taskErr) {
          console.warn('[NBDQuickCapture] task write failed:', taskErr.message);
        }
      }
      // Activity log entry summarizing the capture.
      try {
        await fb.addDoc(
          fb.collection(fb.db, 'leads', leadId, 'activity'),
          {
            userId: uid,
            type: 'note',
            source: 'rep',
            label: 'Voice capture → ' + added + ' task' + (added === 1 ? '' : 's'),
            text: _currentResult.summary?.overview || '',
            captureId: captureRef.id,
            createdAt: fb.serverTimestamp(),
          }
        );
      } catch (_) {}

      // Bump lead.updatedAt so stale signals don't trip on a fresh action.
      try {
        const ref = fb.doc(fb.db, 'leads', leadId);
        await fb.updateDoc(ref, { updatedAt: fb.serverTimestamp() });
      } catch (_) {}

      toast('Added ' + added + ' task' + (added === 1 ? '' : 's') + ' ✓', 'success');
      // Tell the kanban + bell to refresh.
      try { window.dispatchEvent(new CustomEvent('nbd:data-refreshed', { detail: { source: 'voice-capture' } })); } catch (_) {}
      close();
    } catch (e) {
      console.warn('[NBDQuickCapture] save-tasks failed:', e);
      toast('Failed to save tasks: ' + (e.message || 'try again'), 'error');
    }
  }

  // ─── Public exports ─────────────────────────────────────────────
  window.NBDQuickCapture = {
    __sentinel: 'nbd-qc-v1',
    isSupported,
    open,
    close,
    attachFloatingButton,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachFloatingButton, { once: true });
  } else {
    setTimeout(attachFloatingButton, 0);
  }
})();
