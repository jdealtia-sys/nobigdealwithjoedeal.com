/**
 * d2d-tracker-ui-2026b.js — D2D UI (render + modals + capture)
 *
 * Step 4f (2026-05-17): UI half of the split. Reads/writes the
 * window._D2DState object published by d2d-tracker-core-2026b.js.
 * Must load AFTER core so the state object is hydrated.
 *
 * UI owns:
 *   - renderD2D (all four tabs: feed / routes / gamify / analytics)
 *   - setTab / setDateFilter / setDispoFilter (filter mutators)
 *   - openQuickKnock / selectDispo / closeQuickKnock /
 *     handleSubmitKnock (the Knock modal flow)
 *   - openKnockDetail / closeKnockDetail (the Detail modal)
 *   - showConversionPrompt (hot-lead post-save dialog)
 *   - openSMSTemplateChooser (SMS chooser modal)
 *   - capturePhoto, startVoiceRecording, stopVoiceRecording
 *     (camera + microphone UI that touches DOM + state.photoFiles /
 *      state.voiceRecorder)
 *   - exportKnocksCSV (Blob download)
 *
 * Exports onto window._D2DState so the shim (d2d-tracker-2026b.js)
 * can compose the public window.D2D surface from both halves.
 */
(function() {
  'use strict';

  const state = window._D2DState || (window._D2DState = {});

  // Defensive: if core didn't load first, leave loud breadcrumbs but
  // still publish empty stubs so other modules don't crash on import.
  if (typeof state.getMetrics !== 'function') {
    console.error('[d2d-ui] core module missing — load d2d-tracker-core-2026b.js first');
  }

  // ============================================================================
  // PHOTO CAPTURE (UI)
  // ============================================================================
  function capturePhoto() {
    const input = document.createElement('input');
    input.type = 'file';
    // Accept iPhone HEIC + modern formats. 'image/*' alone drops HEIC
    // on desktop Chrome; explicit extensions fix that.
    input.accept = 'image/*,.heic,.heif,.avif';
    input.capture = 'environment';
    input.multiple = true;
    input.onchange = async (e) => {
      const files = Array.from(e.target.files);
      if (!files.length) return;

      if (!state.currentKnockEntry.photoFiles) state.currentKnockEntry.photoFiles = [];
      state.currentKnockEntry.photoFiles.push(...files);

      const preview = document.getElementById('d2d-photo-preview');
      if (preview) {
        preview.innerHTML = '';
        state.currentKnockEntry.photoFiles.forEach((f, i) => {
          const reader = new FileReader();
          reader.onload = (ev) => {
            preview.innerHTML += `<img src="${ev.target.result}" style="width:50px;height:50px;object-fit:cover;border-radius:6px;border:2px solid var(--green);margin:2px;">`;
          };
          reader.readAsDataURL(f);
        });
      }
      window.showToast?.(`${files.length} photo${files.length > 1 ? 's' : ''} attached`, 'success');
    };
    input.click();
  }

  // ============================================================================
  // VOICE MEMO RECORDING (UI)
  // ============================================================================
  async function startVoiceRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.voiceRecorder = new MediaRecorder(stream);
      state.voiceChunks = [];
      state.voiceRecorder.ondataavailable = (e) => { if (e.data.size > 0) state.voiceChunks.push(e.data); };
      state.voiceRecorder.onstop = () => {
        state.voiceBlob = new Blob(state.voiceChunks, { type: 'audio/webm' });
        stream.getTracks().forEach(t => t.stop());
        const btn = document.getElementById('d2d-voice-btn');
        if (btn) {
          btn.innerHTML = '🎙️ Recorded';
          btn.style.background = 'var(--green, #2ECC8A)';
        }
        const playback = document.getElementById('d2d-voice-playback');
        if (playback) {
          playback.innerHTML = `<audio controls src="${URL.createObjectURL(state.voiceBlob)}" style="height:32px;width:100%;margin-top:4px;"></audio>`;
        }
        window.showToast?.('Voice memo recorded', 'success');
      };
      state.voiceRecorder.start();
      setTimeout(() => { if (state.voiceRecorder?.state === 'recording') stopVoiceRecording(); }, 30000);

      const btn = document.getElementById('d2d-voice-btn');
      if (btn) {
        btn.innerHTML = '⏹️ Recording...';
        btn.style.background = 'var(--red, #E05252)';
        btn.onclick = stopVoiceRecording;
      }
    } catch(e) {
      console.error('Voice recording failed:', e);
      window.showToast?.('Microphone access denied', 'error');
    }
  }

  function stopVoiceRecording() {
    if (state.voiceRecorder?.state === 'recording') state.voiceRecorder.stop();
  }

  // ============================================================================
  // SMS TEMPLATE CHOOSER MODAL
  // ============================================================================
  function openSMSTemplateChooser(knock) {
    // Audit finding #13: single-overlay guard. Without this, fast
    // double-taps stacked multiple overlays in the DOM; only the
    // top one was clickable and the others were leaked.
    const existing = document.getElementById('d2d-sms-overlay');
    if (existing) { existing.remove(); }

    const overlay = document.createElement('div');
    overlay.className = 'd2d-modal-overlay open';
    overlay.id = 'd2d-sms-overlay';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    const modal = document.createElement('div');
    modal.className = 'd2d-modal';
    modal.style.maxWidth = '400px';

    // Header (no inline onclick — CSP-safe + future inline-script removal).
    const hdr = document.createElement('div');
    hdr.className = 'd2d-modal-hdr';
    hdr.innerHTML = '<div class="d2d-modal-title">Send Follow-up</div>'
      + '<button class="d2d-modal-close" type="button" aria-label="Close">×</button>';
    hdr.querySelector('.d2d-modal-close').addEventListener('click', () => overlay.remove());
    modal.appendChild(hdr);

    const body = document.createElement('div');
    body.style.padding = 'var(--s2)';
    body.innerHTML = '<p style="color:var(--m);font-size:12px;margin-bottom:12px;">Choose a template:</p>';

    // Per-template option button. Click handler is attached
    // programmatically so closure captures `knock` + `key` directly
    // — no JSON-stringify dance, no inline onclick attribute.
    const smsArgs = {
      phone: knock.phone, homeowner: knock.homeowner, address: knock.address,
      disposition: knock.disposition, followUpDate: knock.followUpDate
    };
    Object.entries(state.SMS_TEMPLATES).forEach(([key, tmpl]) => {
      const opt = document.createElement('div');
      opt.style.cssText = 'padding:10px;background:var(--s2);border:1px solid var(--br);border-radius:6px;margin-bottom:8px;cursor:pointer;transition:border-color .15s;';
      opt.innerHTML = '<div style="font-weight:600;font-size:13px;color:var(--t);">' + tmpl.label + '</div>'
        + '<div style="font-size:11px;color:var(--m);margin-top:4px;">' + tmpl.body.substring(0, 80) + '...</div>';
      opt.addEventListener('mouseenter', () => { opt.style.borderColor = 'var(--blue)'; });
      opt.addEventListener('mouseleave', () => { opt.style.borderColor = 'var(--br)'; });
      opt.addEventListener('click', () => {
        window.D2D.sendFollowUpSMS(smsArgs, key);
        overlay.remove();
      });
      body.appendChild(opt);
    });

    if (knock.email) {
      const sep = document.createElement('div');
      sep.style.cssText = 'margin-top:12px;padding-top:12px;border-top:1px solid var(--br);';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = 'width:100%;padding:10px;background:var(--blue, #4A9EFF);color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;';
      btn.textContent = '📧 Send Email Instead';
      const emailArgs = {
        email: knock.email, homeowner: knock.homeowner,
        address: knock.address, disposition: knock.disposition
      };
      btn.addEventListener('click', () => {
        window.D2D.sendFollowUpEmail(emailArgs);
        overlay.remove();
      });
      sep.appendChild(btn);
      body.appendChild(sep);
    }

    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  // ============================================================================
  // CSV EXPORT
  // ============================================================================
  function exportKnocksCSV() {
    const data = state.applyFilters();
    if (!data.length) { window.showToast?.('No knocks to export', 'error'); return; }

    const DISPOSITIONS = state.DISPOSITIONS;
    const headers = ['Address','Homeowner','Phone','Email','Disposition','Notes','Attempt #','Insurance Carrier','Claim #','Stage','Follow-up','Created','Lat','Lng'];
    const rows = data.map(k => [
      k.address || '', k.homeowner || '', k.phone || '', k.email || '',
      DISPOSITIONS[k.disposition]?.label || k.disposition || '',
      (k.notes || '').replace(/,/g, ';').replace(/\n/g, ' '),
      k.attemptNumber || '', k.insCarrier || '', k.claimNumber || '', k.stage || '',
      k.followUpDate ? state.formatDate(k.followUpDate) : '',
      k.createdAt ? state.formatDate(k.createdAt) + ' ' + state.formatTime(k.createdAt) : '',
      k.lat || '', k.lng || ''
    ].map(v => `"${String(v).replace(/"/g, '""')}"`));

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `NBD-D2D-Knocks-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    window.showToast?.(`Exported ${data.length} knocks to CSV`, 'success');
  }

  // ============================================================================
  // QUICK KNOCK MODAL
  // ============================================================================
  function openQuickKnock(opts) {
    opts = opts || {};
    const address = opts.address || '';
    const esc = state.esc;
    const DISPOSITIONS = state.DISPOSITIONS;
    const DISPO_ORDER = state.DISPO_ORDER;
    const CARRIERS = state.CARRIERS;
    const MAX_ATTEMPTS = state.MAX_ATTEMPTS;

    state.currentKnockEntry = {
      address: address,
      lat: opts.lat || null,
      lng: opts.lng || null,
      homeowner: '', phone: '', email: '', notes: '',
      disposition: null, photoFiles: [],
      insCarrier: '', claimNumber: '',
      followUpDate: '', followUpTime: ''
    };

    // Pre-populate from history
    if (address) {
      const history = state.getAddressHistory(address);
      if (history.length > 0) {
        const last = history[0];
        if (last.homeowner) state.currentKnockEntry.homeowner = last.homeowner;
        if (last.phone) state.currentKnockEntry.phone = last.phone;
        if (last.email) state.currentKnockEntry.email = last.email;
      }
    }

    // Reverse geocode if no address
    if (!address && opts.lat && opts.lng) {
      // W159 HIGH #8: same .catch() fix as d2d-tracker.js — see
      // sister comment there for rationale.
      state.reverseGeocode(opts.lat, opts.lng).then(addr => {
        if (addr) {
          state.currentKnockEntry.address = addr;
          const addrInput = document.getElementById('d2d-qk-address');
          if (addrInput) addrInput.value = addr;
        }
      }).catch(err => {
        console.warn('[D2D] reverseGeocode failed:', err && err.message || err);
      });
    }

    const attemptNum = address ? state.getAttemptCount(address) + 1 : 1;
    state.voiceBlob = null;

    const overlay = document.createElement('div');
    overlay.className = 'd2d-modal-overlay open';
    overlay.id = 'd2d-quick-knock-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) closeQuickKnock(); };

    const modal = document.createElement('div');
    modal.className = 'd2d-modal';
    modal.innerHTML = `
      <div class="d2d-modal-hdr">
        <div class="d2d-modal-title">Knock #${attemptNum}/${MAX_ATTEMPTS}${!state.isOnline ? ' <span style="color:var(--gold)">⚡ Offline</span>' : ''}</div>
        <button class="d2d-modal-close" onclick="window.D2D.closeQuickKnock()">×</button>
      </div>
      <div class="d2d-modal-body">
        <div class="d2d-field">
          <label class="d2d-field-label">Address *</label>
          <input type="text" id="d2d-qk-address" class="d2d-input" value="${esc(address)}" placeholder="123 Main St, Cincinnati, OH">
        </div>

        <div class="d2d-field-label" style="margin-top:12px;">Select Disposition:</div>
        <div class="d2d-dispo-grid">
          ${DISPO_ORDER.map(key => {
            const d = DISPOSITIONS[key];
            return `<button class="d2d-dispo-btn" data-dispo="${key}" onclick="window.D2D.selectDispo('${key}',this)" style="--dc:${d.color};">
              <span class="d2d-dispo-icon">${d.icon}</span>
              <span class="d2d-dispo-label">${d.label}</span>
            </button>`;
          }).join('')}
        </div>

        <!-- Insurance carrier -->
        <div id="d2d-ins-section" class="d2d-ins-section">
          <label class="d2d-field-label" style="font-weight:600;">Insurance Details</label>
          <select id="d2d-qk-carrier" class="d2d-input d2d-select">
            <option value="">Select Carrier...</option>
            ${CARRIERS.map(c => `<option value="${c}">${c}</option>`).join('')}
          </select>
          <input type="text" id="d2d-qk-claim" class="d2d-input" placeholder="Claim # (optional)" style="margin-top:8px;">
        </div>

        <details class="d2d-details">
          <summary class="d2d-details-summary">📋 Contact & Notes</summary>
          <div class="d2d-extras-body">
            <div class="d2d-field">
              <label class="d2d-field-label">Homeowner Name</label>
              <input type="text" id="d2d-qk-homeowner" class="d2d-input" value="${esc(state.currentKnockEntry.homeowner)}" placeholder="John Doe">
            </div>
            <div class="d2d-field">
              <label class="d2d-field-label">Phone</label>
              <input type="tel" id="d2d-qk-phone" class="d2d-input" value="${esc(state.currentKnockEntry.phone)}" placeholder="555-123-4567">
            </div>
            <div class="d2d-field">
              <label class="d2d-field-label">Email</label>
              <input type="email" id="d2d-qk-email" class="d2d-input" value="${esc(state.currentKnockEntry.email)}" placeholder="john@example.com">
            </div>
            <div class="d2d-field-row">
              <div class="d2d-field" style="flex:1;">
                <label class="d2d-field-label">Follow-up Date</label>
                <input type="date" id="d2d-qk-followup" class="d2d-input">
              </div>
              <div class="d2d-field" style="flex:1;">
                <label class="d2d-field-label">Follow-up Time</label>
                <input type="time" id="d2d-qk-followup-time" class="d2d-input">
              </div>
            </div>
            <div class="d2d-field">
              <label class="d2d-field-label">Notes</label>
              <textarea id="d2d-qk-notes" class="d2d-textarea" placeholder="Add any notes..."></textarea>
            </div>
            <div class="d2d-media-btns">
              <button class="d2d-action-btn" style="flex:1;background:var(--orange);" onclick="window.D2D.capturePhoto()">📷 Photo</button>
              <button class="d2d-action-btn" style="flex:1;background:var(--blue);" id="d2d-voice-btn" onclick="window.D2D.startVoice()">🎙️ Voice Memo</button>
            </div>
            <div id="d2d-photo-preview" class="d2d-photo-grid"></div>
            <div id="d2d-voice-playback"></div>
          </div>
        </details>

        <button id="d2d-qk-save" class="d2d-save-btn" onclick="window.D2D.submitKnock()" disabled>
          Select Disposition
        </button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Setup autocomplete after DOM insertion
    setTimeout(() => state.setupAddressAutocomplete('d2d-qk-address'), 100);
  }

  function selectDispo(key, btn) {
    state.currentKnockEntry.disposition = key;
    const dispo = state.DISPOSITIONS[key];

    document.querySelectorAll('.d2d-dispo-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');

    const saveBtn = document.getElementById('d2d-qk-save');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.style.background = dispo.color;
      saveBtn.style.color = 'white';
      saveBtn.style.cursor = 'pointer';
      saveBtn.textContent = `${dispo.icon} ${dispo.label}`;
    }

    // Show/hide insurance section
    const insSection = document.getElementById('d2d-ins-section');
    if (insSection) insSection.style.display = state.INS_DISPOSITIONS.includes(key) ? 'block' : 'none';

    // Auto-set follow-up
    if (dispo.autoFollowUp) {
      const fupInput = document.getElementById('d2d-qk-followup');
      if (fupInput) {
        const d = new Date();
        d.setDate(d.getDate() + dispo.autoFollowUp);
        fupInput.valueAsDate = d;
      }
      document.querySelector('.d2d-details')?.setAttribute('open', '');
    }
  }

  function closeQuickKnock() {
    const overlay = document.getElementById('d2d-quick-knock-overlay');
    if (overlay) { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 300); }
    state.currentKnockEntry = null;
    state.voiceBlob = null;
  }

  let _knockSubmitInFlight = false;
  async function handleSubmitKnock() {
    // Guard against double-submit: photo+voice uploads can take several
    // seconds, during which the user can tap Save again and create
    // duplicate knock records (plus duplicate uploads that eat storage
    // quota). Single flag, cleared in a finally block below.
    if (_knockSubmitInFlight) return;
    _knockSubmitInFlight = true;
    // Capture the button + its original label up here so the finally
    // block below ALWAYS restores it, even if submitKnock throws or
    // times out. Previously the button was only re-enabled implicitly
    // by closeQuickKnock(); on a hung addDoc that never ran, leaving
    // the button stuck on "Saving..." with no recovery path.
    const saveBtn = document.getElementById('d2d-qk-save');
    const originalLabel = saveBtn ? saveBtn.textContent : '';
    let knockSaved = false;
    try {
    const address = (document.getElementById('d2d-qk-address')?.value || '').trim();
    if (!address) { window.showToast?.('Address required', 'error'); return; }
    if (!state.currentKnockEntry?.disposition) { window.showToast?.('Disposition required', 'error'); return; }

    state.currentKnockEntry.address = address;
    state.currentKnockEntry.homeowner = document.getElementById('d2d-qk-homeowner')?.value || '';
    state.currentKnockEntry.phone = document.getElementById('d2d-qk-phone')?.value || '';
    state.currentKnockEntry.email = document.getElementById('d2d-qk-email')?.value || '';
    state.currentKnockEntry.notes = document.getElementById('d2d-qk-notes')?.value || '';
    state.currentKnockEntry.followUpDate = document.getElementById('d2d-qk-followup')?.value || '';
    state.currentKnockEntry.followUpTime = document.getElementById('d2d-qk-followup-time')?.value || '';
    state.currentKnockEntry.insCarrier = document.getElementById('d2d-qk-carrier')?.value || '';
    state.currentKnockEntry.claimNumber = document.getElementById('d2d-qk-claim')?.value || '';

    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

    // Upload photos and voice before saving
    let photoUrls = [];
    let voiceUrl = '';
    const tempId = Date.now().toString();

    if (state.currentKnockEntry.photoFiles?.length > 0 && state.isOnline) {
      photoUrls = await state.uploadPhotos(state.currentKnockEntry.photoFiles, tempId);
    }
    if (state.voiceBlob && state.isOnline) {
      voiceUrl = await state.uploadVoiceMemo(state.voiceBlob, tempId);
    }

    state.currentKnockEntry.photoUrls = photoUrls;
    state.currentKnockEntry.voiceUrl = voiceUrl;

    const savedDispo = state.currentKnockEntry.disposition;
    const savedPhone = state.currentKnockEntry.phone;
    const knockId = await state.submitKnock(state.currentKnockEntry);

    if (!knockId) {
      // submitKnock returned null = error toast already shown.
      // Leave the modal open so the user can retry without re-typing.
      return;
    }

    knockSaved = true;
    closeQuickKnock();

    // Auto-offer lead conversion for hot dispositions
    if (state.HOT_DISPOSITIONS.includes(savedDispo)) {
      setTimeout(() => {
        const dispoLabel = state.DISPOSITIONS[savedDispo]?.label || savedDispo;
        showConversionPrompt(knockId, dispoLabel);
      }, 400);
    }
    // Offer SMS follow-up for relevant dispositions (if not already converting)
    else if (savedPhone && ['interested', 'appointment', 'storm_damage', 'ins_has_claim'].includes(savedDispo)) {
      setTimeout(async () => {
        if (await state.uiConfirm('Send follow-up text?', { okLabel: 'Yes, text them' })) {
          const knock = state.knocks.find(k => k.id === knockId);
          if (knock) openSMSTemplateChooser(knock);
        }
      }, 500);
    }
    } catch (err) {
      // submitKnock catches its own errors, so reaching here means a
      // throw from uploadPhotos / uploadVoiceMemo / addDoc timeout.
      console.error('handleSubmitKnock failed:', err);
      window.showToast?.(
        err && /timeout/i.test(err.message || '')
          ? 'Save timed out — check connection and try again'
          : 'Save failed — please try again',
        'error'
      );
    } finally {
      // Restore button state even on hang/throw. closeQuickKnock removes
      // the overlay (and the button with it) on success, so this only
      // matters when the modal is still open — exactly the failure path
      // where the user needs to retry.
      if (!knockSaved && saveBtn && document.body.contains(saveBtn)) {
        saveBtn.disabled = false;
        saveBtn.textContent = originalLabel || 'Save Knock';
      }
      _knockSubmitInFlight = false;
    }
  }

  // Show a branded prompt to convert knock → CRM lead
  function showConversionPrompt(knockId, dispoLabel) {
    const esc = state.esc;
    const overlay = document.createElement('div');
    overlay.className = 'd2d-modal-overlay open';
    overlay.id = 'd2d-convert-prompt';
    overlay.style.zIndex = '10002';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const modal = document.createElement('div');
    modal.className = 'd2d-modal';
    modal.style.maxWidth = '360px';
    modal.innerHTML = `
      <div class="d2d-modal-body" style="text-align:center;padding:28px 20px;">
        <div style="font-size:36px;margin-bottom:10px;">🔥</div>
        <div style="font-size:15px;font-weight:700;color:var(--t);margin-bottom:6px;">Hot Lead Detected</div>
        <div style="font-size:13px;color:var(--m);margin-bottom:20px;">"${esc(dispoLabel)}" — convert this knock into a CRM lead so it shows up in your pipeline?</div>
        <div style="display:flex;gap:10px;">
          <button style="flex:1;padding:12px;border:none;border-radius:8px;background:#2ECC8A;color:white;font-weight:700;font-size:14px;cursor:pointer;" onclick="window.D2D.convertToLead('${knockId}');document.getElementById('d2d-convert-prompt')?.remove();">
            ✅ Convert Now
          </button>
          <button style="flex:1;padding:12px;border:none;border-radius:8px;background:var(--s2);color:var(--t);font-weight:600;font-size:14px;cursor:pointer;border:1px solid var(--br);" onclick="window.D2D.convertToLeadWithEdit('${knockId}');document.getElementById('d2d-convert-prompt')?.remove();">
            ✏️ Edit First
          </button>
        </div>
        <button style="margin-top:12px;background:none;border:none;color:var(--m);font-size:12px;cursor:pointer;text-decoration:underline;" onclick="document.getElementById('d2d-convert-prompt')?.remove();">Skip for now</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  // ============================================================================
  // KNOCK DETAIL MODAL
  // ============================================================================
  function openKnockDetail(knockId) {
    const knock = state.knocks.find(k => k.id === knockId);
    if (!knock) {
      if (typeof window.showToast === 'function') window.showToast('Knock not found — it may have been deleted', 'error');
      return;
    }

    const esc = state.esc;
    const DISPOSITIONS = state.DISPOSITIONS;
    const MAX_ATTEMPTS = state.MAX_ATTEMPTS;
    const dispo = DISPOSITIONS[knock.disposition];
    const attempts = state.getAttemptCount(knock.address);
    const history = state.getAddressHistory(knock.address);
    // Escape the knock id for interpolation into inline onclick
    // handlers below. Firestore doc IDs are alphanumeric today but
    // this guards against any future ID scheme that includes quotes.
    const safeId = esc(knock.id);

    const overlay = document.createElement('div');
    overlay.className = 'd2d-modal-overlay open';
    overlay.id = 'd2d-detail-overlay';
    // Esc to close — user said everything has to be accessible.
    overlay.onclick = (e) => { if (e.target === overlay) closeKnockDetail(); };
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        closeKnockDetail();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    const modal = document.createElement('div');
    modal.className = 'd2d-modal';
    modal.innerHTML = `
      <div class="d2d-modal-hdr">
        <div class="d2d-modal-title">${esc(knock.address)}</div>
        <button class="d2d-modal-close" onclick="window.D2D.closeKnockDetail()">×</button>
      </div>
      <div class="d2d-modal-body">
        <div class="d2d-detail-badge" style="background:${dispo?.color};">
          ${dispo?.icon} ${dispo?.label} · Knock #${attempts}/${MAX_ATTEMPTS}
        </div>

        <div class="d2d-detail-grid">
          <div class="d2d-detail-field">
            <label class="d2d-detail-label">Homeowner</label>
            <div class="d2d-detail-value">${esc(knock.homeowner || '—')}</div>
          </div>
          <div class="d2d-detail-field">
            <label class="d2d-detail-label">Phone</label>
            <div class="d2d-detail-value">${knock.phone ? `<a href="tel:${esc(knock.phone)}" class="d2d-detail-link">${esc(knock.phone)}</a>` : '—'}</div>
          </div>
          <div class="d2d-detail-field">
            <label class="d2d-detail-label">Email</label>
            <div class="d2d-detail-value">${knock.email ? `<a href="mailto:${esc(knock.email)}" class="d2d-detail-link">${esc(knock.email)}</a>` : '—'}</div>
          </div>
          ${knock.insCarrier ? `<div class="d2d-detail-field">
            <label class="d2d-detail-label">Insurance</label>
            <div class="d2d-detail-value">${esc(knock.insCarrier)}${knock.claimNumber ? ` · #${esc(knock.claimNumber)}` : ''}</div>
          </div>` : ''}
        </div>

        ${knock.notes ? `<div class="d2d-detail-section"><label class="d2d-detail-label">Notes</label><div class="d2d-detail-notes">${esc(knock.notes)}</div></div>` : ''}

        ${knock.followUpDate ? `<div class="d2d-detail-section"><label class="d2d-detail-label">Follow-up</label><div class="d2d-detail-value">${state.formatDate(knock.followUpDate)}</div></div>` : ''}

        ${knock.photoUrls?.length ? `<div class="d2d-detail-section"><label class="d2d-detail-label">Photos (${knock.photoUrls.length})</label><div class="d2d-photo-grid">${knock.photoUrls.map(url => `<img src="${esc(url)}" class="d2d-photo-thumb" loading="lazy" onclick="window.open('${esc(url)}','_blank')" onerror="this.parentNode.replaceChild(Object.assign(document.createElement('div'),{className:'d2d-photo-broken',textContent:'📷 Photo unavailable',style:'background:var(--s2);border:1px dashed var(--br);color:var(--m);padding:16px 12px;border-radius:6px;font-size:11px;text-align:center;'}),this);">`).join('')}</div></div>` : ''}

        ${knock.voiceUrl ? `<div class="d2d-detail-section"><label class="d2d-detail-label">Voice Memo</label><audio controls src="${esc(knock.voiceUrl)}" class="d2d-audio-player"></audio></div>` : ''}

        <div class="d2d-detail-section">
          <label class="d2d-detail-label">📍 Address History (${history.length})</label>
          <div class="d2d-history-list">
            ${history.slice(0, 5).map(h => `
              <div class="d2d-history-item">
                <div class="d2d-history-dispo">${DISPOSITIONS[h.disposition]?.icon} ${DISPOSITIONS[h.disposition]?.label}</div>
                <div class="d2d-history-time">${state.formatDate(h.createdAt)} at ${state.formatTime(h.createdAt)}</div>
                ${h.notes ? `<div class="d2d-history-notes">${esc(h.notes.substring(0, 100))}</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>

        <div class="d2d-detail-actions">
          ${!knock.convertedToLead ? `
            <button class="d2d-action-btn" style="background:#2ECC8A;" onclick="window.D2D.convertToLead('${safeId}')" aria-label="Convert knock to lead">✓ Convert to Lead</button>
          ` : `
            <button class="d2d-action-btn" disabled style="background:var(--br);color:var(--m);" aria-label="Already converted to lead">✓ Lead Created</button>
          `}
          <button class="d2d-action-btn" style="background:var(--orange);" onclick="window.D2D.openQuickKnock({address:'${esc(knock.address)}',lat:${Number(knock.lat) || 'null'},lng:${Number(knock.lng) || 'null'}})" aria-label="Re-knock this address">↻ Re-Knock</button>
          ${knock.phone ? `<button class="d2d-action-btn" style="background:var(--blue);" onclick="window.D2D.openSMSChooser('${safeId}')" aria-label="Send SMS follow-up">📱 Follow Up</button>` : ''}
          <button class="d2d-action-btn" style="background:#E05252;" onclick="window.D2D.deleteKnock('${safeId}')" aria-label="Delete this knock">🗑️ Delete</button>
        </div>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  function closeKnockDetail() {
    const overlay = document.getElementById('d2d-detail-overlay');
    if (overlay) { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 300); }
  }

  // ============================================================================
  // TAB SWITCHING + FILTER MUTATORS
  // ============================================================================
  function setTab(tab) {
    state.currentTab = tab;
    renderD2D();
  }
  function setDateFilter(range) { state.filterDateRange = range; renderD2D(); }
  function setDispoFilter(val) { state.filterDispo = val || null; renderD2D(); }

  // ============================================================================
  // MAIN RENDER
  // ============================================================================
  function renderD2D() {
    const container = document.getElementById('d2dContent');
    if (!container) return;

    const esc = state.esc;
    const DISPOSITIONS = state.DISPOSITIONS;
    const DISPO_ORDER = state.DISPO_ORDER;
    const HOT_DISPOSITIONS = state.HOT_DISPOSITIONS;
    const MAX_ATTEMPTS = state.MAX_ATTEMPTS;
    const PAGE_SIZE = state.PAGE_SIZE;
    const currentTab = state.currentTab;
    const filterDateRange = state.filterDateRange;
    const filterDispo = state.filterDispo;
    const formatTime = state.formatTime;
    const timeAgo = state.timeAgo;

    const metrics = state.getMetrics();
    const revenue = state.getRevenueMetrics();
    const timeOfDay = state.getTimeOfDayStats();
    const breakdown = state.getDispositionBreakdown();
    const filtered = state.applyFilters();
    const gamify = state.getGamificationData();
    const insMetrics = state.getInsuranceMetrics();
    const weatherAlerts = state.getWeatherAlerts();

    const funnel = revenue.conversionFunnel;
    const maxFunnelVal = Math.max(funnel.doors, funnel.conversations, funnel.appointments, funnel.estimates, funnel.closed, 1);

    let revenuePerDoorText = '$' + revenue.revenuePerDoor;
    if (revenue.totalClosed === 0) revenuePerDoorText = '~$12.50 (industry avg)';

    const tabBtn = (id, label, icon) => `<button onclick="window.D2D.setTab('${id}')" style="flex:1;padding:12px 8px;border:none;border-bottom:3px solid ${currentTab === id ? 'var(--orange)' : 'transparent'};background:none;color:${currentTab === id ? 'var(--t)' : 'var(--m)'};cursor:pointer;font-size:13px;font-weight:700;font-family:'Barlow Condensed',sans-serif;letter-spacing:.03em;min-height:44px;-webkit-tap-highlight-color:transparent;">${icon} ${label}</button>`;

    let html = `
      <div style="padding:12px 14px;">

        ${!state.isOnline ? `<div style="background:color-mix(in srgb, var(--gold, #EAB308) 20%, var(--s));padding:12px 14px;border-radius:8px;margin-bottom:12px;font-size:13px;font-weight:600;color:var(--t);border-left:4px solid var(--gold);">⚡ Offline — ${state.offlineQueue.length} queued</div>` : ''}

        ${weatherAlerts.length > 0 ? `<div style="background:color-mix(in srgb, var(--red, #E05252) 15%, var(--s));padding:12px 14px;border-radius:8px;margin-bottom:12px;font-size:13px;border-left:4px solid var(--red);"><strong style="color:var(--t);">⛈️ Storm Alert:</strong> <span style="color:var(--m);">${esc(weatherAlerts[0].event)} — knock now!</span></div>` : ''}

        <!-- Revenue Banner -->
        <div class="d2d-revenue-banner">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div class="d2d-revenue-label">Value Per Door</div>
              <div class="d2d-revenue-amount">${revenuePerDoorText}</div>
            </div>
            <div class="d2d-streak">
              <div class="d2d-streak-num">${gamify.streak}</div>
              <div class="d2d-streak-lbl">Day Streak ${gamify.currentMilestone ? gamify.currentMilestone.badge : ''}</div>
            </div>
          </div>
          <div style="font-size:10px;opacity:0.7;margin-top:4px;color:var(--m,#9ca3af);">
            ${revenue.totalClosed > 0 ? `${revenue.totalClosed} closed · $${revenue.avgDealSize} avg` : 'Track deals to see projections'}
            ${gamify.projectedRevenue > 0 ? ` · $${gamify.projectedRevenue.toLocaleString()}/mo` : ''}
          </div>
        </div>

        <!-- Action Bar -->
        <div class="d2d-action-bar">
          <button onclick="window.D2D.openQuickKnock()" class="d2d-big-btn">🚪 Knock</button>
          <button onclick="window.D2D.toggleHeatMap()" class="d2d-big-btn d2d-big-btn-sec">${state.showHeat ? '🔥' : '❄️'} Heat</button>
          <button onclick="window._d2dHailLayer ? window.D2D.hideHail() : window.D2D.showHail({ radiusMi: 5, daysBack: 365 })" class="d2d-big-btn d2d-big-btn-sec" title="Recent hail reports">⛈ Hail</button>
          <button onclick="window.D2D.centerOnMe()" class="d2d-big-btn d2d-big-btn-sec">📍 Me</button>
          <button onclick="window.D2D.exportCSV()" class="d2d-big-btn d2d-big-btn-sec">📥 CSV</button>
        </div>

        <!-- Tab Bar -->
        <div style="display:flex;margin-bottom:12px;border-bottom:2px solid var(--br);">
          ${tabBtn('feed', 'Feed', '📋')}
          ${tabBtn('routes', 'Routes', '🗺️')}
          ${tabBtn('gamify', 'Challenges', '🏆')}
          ${tabBtn('analytics', 'Stats', '📊')}
        </div>
    `;

    // ─── FEED TAB ───
    if (currentTab === 'feed') {
      html += `
        <!-- Follow-ups Due — Full Interactive List -->
        ${metrics.followUpsDue.length > 0 ? `
          <div class="d2d-followups-banner">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <div class="d2d-followups-title">📋 ${metrics.followUpsDue.length} Follow-up${metrics.followUpsDue.length !== 1 ? 's' : ''} Due</div>
              <button style="background:none;border:1px solid var(--br);color:var(--m);padding:4px 10px;border-radius:4px;font-size:10px;cursor:pointer;" onclick="this.closest('.d2d-followups-banner').style.display='none'">Dismiss</button>
            </div>
            <div class="d2d-followups-list" style="max-height:300px;overflow-y:auto;">
              ${metrics.followUpsDue.map(k => {
                const dispo = DISPOSITIONS[k.disposition];
                const fDate = k.followUpDate ? new Date(k.followUpDate instanceof Date ? k.followUpDate : (k.followUpDate.seconds ? k.followUpDate.seconds * 1000 : k.followUpDate)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
                return `
                <div class="d2d-followup-item" style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--s);border:1px solid var(--br);border-radius:6px;margin-bottom:4px;cursor:pointer;" onclick="window.D2D.openKnockDetail('${esc(k.id)}')">
                  <div style="font-size:18px;flex-shrink:0;">${dispo?.icon || '📋'}</div>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:12px;font-weight:600;color:var(--t);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(k.address?.substring(0, 50) || 'No address')}</div>
                    <div style="font-size:10px;color:var(--m);margin-top:2px;">${dispo?.label || ''} ${fDate ? '· Due ' + fDate : ''} ${k.homeowner ? '· ' + esc(k.homeowner) : ''}</div>
                  </div>
                  <div style="display:flex;gap:4px;flex-shrink:0;">
                    ${k.phone ? `<button style="background:var(--blue);color:#fff;border:none;border-radius:4px;padding:4px 8px;font-size:10px;cursor:pointer;" onclick="event.stopPropagation();window.open('tel:'+encodeURIComponent('${esc(k.phone)}'))">📞</button>` : ''}
                    <button style="background:var(--orange);color:#fff;border:none;border-radius:4px;padding:4px 8px;font-size:10px;cursor:pointer;" onclick="event.stopPropagation();window.D2D.openQuickKnock({address:'${esc(k.address || '')}',lat:${Number(k.lat) || 'null'},lng:${Number(k.lng) || 'null'}})">↻</button>
                  </div>
                </div>`;
              }).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Metrics Grid -->
        <div class="d2d-metrics-grid">
          <div class="d2d-metric-card">
            <div class="d2d-metric-val" style="color:var(--blue, #4A9EFF);">${metrics.today}</div>
            <div class="d2d-metric-lbl">Today</div>
          </div>
          <div class="d2d-metric-card">
            <div class="d2d-metric-val" style="color:var(--blue, #4A9EFF);">${metrics.week}</div>
            <div class="d2d-metric-lbl">Week</div>
          </div>
          <div class="d2d-metric-card">
            <div class="d2d-metric-val" style="color:var(--green, #2ECC8A);">${metrics.appointments}</div>
            <div class="d2d-metric-lbl">Appts</div>
          </div>
          <div class="d2d-metric-card">
            <div class="d2d-metric-val" style="color:var(--gold, #EAB308);">${metrics.conversionRate}%</div>
            <div class="d2d-metric-lbl">Conv</div>
          </div>
          <div class="d2d-metric-card">
            <div class="d2d-metric-val" style="color:var(--orange, #e8720c);">${revenue.revenuePerDoor > 0 ? '$' + revenue.revenuePerDoor : '—'}</div>
            <div class="d2d-metric-lbl">Rev/Door</div>
          </div>
          <div class="d2d-metric-card">
            <div class="d2d-metric-val" style="color:#9B6DFF;">$${revenue.avgDealSize || 0}</div>
            <div class="d2d-metric-lbl">Avg Deal</div>
          </div>
        </div>

        <!-- Conversion Funnel -->
        <div class="d2d-funnel">
          <div class="d2d-funnel-step" style="flex:${funnel.doors / maxFunnelVal};background:#6B7280;">
            <div class="d2d-funnel-count">${funnel.doors}</div>
            <div class="d2d-funnel-label">Doors</div>
          </div>
          <div class="d2d-funnel-step" style="flex:${funnel.conversations / maxFunnelVal};background:#EAB308;color:#1a1a1a;">
            <div class="d2d-funnel-count">${funnel.conversations}</div>
            <div class="d2d-funnel-label">Convos</div>
          </div>
          <div class="d2d-funnel-step" style="flex:${funnel.appointments / maxFunnelVal};background:#4A9EFF;">
            <div class="d2d-funnel-count">${funnel.appointments}</div>
            <div class="d2d-funnel-label">Apts</div>
          </div>
          <div class="d2d-funnel-step" style="flex:${funnel.estimates / maxFunnelVal};background:#2ECC8A;">
            <div class="d2d-funnel-count">${funnel.estimates}</div>
            <div class="d2d-funnel-label">Ests</div>
          </div>
          <div class="d2d-funnel-step" style="flex:${funnel.closed / maxFunnelVal};background:#e8720c;">
            <div class="d2d-funnel-count">${funnel.closed}</div>
            <div class="d2d-funnel-label">Closed</div>
          </div>
        </div>

        <!-- Disposition Bar -->
        <div class="d2d-dispo-bar-wrap">
          <div class="d2d-dispo-bar-header">Disposition Breakdown</div>
          <div class="d2d-dispo-bar">
            ${DISPO_ORDER.filter(k => breakdown[k] > 0).map(key => {
              const d = DISPOSITIONS[key];
              const pct = filtered.length > 0 ? (breakdown[key] / filtered.length * 100) : 0;
              return `<div style="flex:${pct};background:${d.color};" class="d2d-dispo-bar-segment" onclick="window.D2D.setDispoFilter('${key}')" title="${d.label}: ${breakdown[key]}">${breakdown[key]}</div>`;
            }).join('')}
          </div>
          <div class="d2d-dispo-legend">
            ${DISPO_ORDER.filter(k => breakdown[k] > 0).slice(0, 6).map(key => {
              const d = DISPOSITIONS[key];
              return `<span class="d2d-legend-item" onclick="window.D2D.setDispoFilter('${key}')"><span class="d2d-knock-dot" style="background:${d.color};"></span>${d.short}</span>`;
            }).join('')}
          </div>
        </div>

        <!-- Filters -->
        <div class="d2d-feed-header">
          <div class="d2d-date-pills">
            ${['today', 'week', 'month', 'all'].map(range => `
              <button class="d2d-pill ${filterDateRange === range ? 'active' : ''}" onclick="window.D2D.setDateFilter('${range}')">
                ${range === 'today' ? 'Today' : range === 'week' ? 'Week' : range === 'month' ? 'Month' : 'All'}
              </button>
            `).join('')}
          </div>
          <select class="d2d-select" onchange="window.D2D.setDispoFilter(this.value)">
            <option value="">All Dispositions</option>
            ${DISPO_ORDER.map(key => `<option value="${key}" ${filterDispo === key ? 'selected' : ''}>${DISPOSITIONS[key].label}</option>`).join('')}
          </select>
        </div>

        <!-- Knock Feed -->
        <div class="d2d-knock-feed">
          ${filtered.length === 0 ? `
            <div class="d2d-empty">
              <div style="font-size:32px;margin-bottom:8px;">📍</div>
              <div>No knocks yet for this filter</div>
              <div style="font-size:12px;margin-top:4px;">Tap the map or press "Knock" to start</div>
            </div>
          ` : filtered.slice(0, PAGE_SIZE).map(knock => {
            const dispo = DISPOSITIONS[knock.disposition];
            const attempts = state.getAttemptCount(knock.address);
            return `
              <div class="d2d-knock-card" onclick="window.D2D.openKnockDetail('${knock.id}')">
                <div class="d2d-knock-body">
                  <div>
                    <div class="d2d-knock-addr">${esc(knock.address)}</div>
                    <div class="d2d-knock-meta">
                      <span>${formatTime(knock.createdAt)}</span>
                      <span class="d2d-knock-attempt ${dispo?.color === '#e8720c' ? 'warning' : ''}" style="background:${dispo?.color || '#ccc'};">Knock #${attempts}/${MAX_ATTEMPTS}</span>
                      ${knock.insCarrier ? `<span>🏢 ${esc(knock.insCarrier)}</span>` : ''}
                    </div>
                  </div>
                  <div style="display:flex;gap:6px;align-items:center;">
                    ${knock.photoUrls?.length ? '<span style="font-size:12px;">📷</span>' : ''}
                    ${knock.voiceUrl ? '<span style="font-size:12px;">🎙️</span>' : ''}
                    <span style="font-size:20px;">${dispo?.icon || ''}</span>
                    <div style="text-align:right;">
                      <div style="font-size:11px;font-weight:600;color:var(--t);">${dispo?.label || ''}</div>
                      <div class="d2d-knock-time">${timeAgo(knock.createdAt)}</div>
                    </div>
                  </div>
                </div>
                ${knock.notes ? `<div style="font-size:12px;color:var(--m);margin-top:6px;padding-top:6px;border-top:1px solid var(--br);">${esc(knock.notes.substring(0, 80))}</div>` : ''}
                ${!knock.convertedToLead && HOT_DISPOSITIONS.includes(knock.disposition) ? `
                  <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--br);display:flex;gap:6px;" onclick="event.stopPropagation();">
                    <button style="flex:1;padding:8px;border:none;border-radius:6px;background:#2ECC8A;color:white;font-size:12px;font-weight:700;cursor:pointer;" onclick="event.stopPropagation();window.D2D.convertToLead('${knock.id}')">✅ Convert to Lead</button>
                    <button style="padding:8px 12px;border:none;border-radius:6px;background:var(--s2);color:var(--t);font-size:12px;font-weight:600;cursor:pointer;border:1px solid var(--br);" onclick="event.stopPropagation();window.D2D.convertToLeadWithEdit('${knock.id}')">✏️</button>
                  </div>
                ` : ''}
                ${knock.convertedToLead ? `<div style="margin-top:6px;font-size:11px;color:#2ECC8A;font-weight:600;">✓ In CRM Pipeline</div>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    // ─── ROUTES TAB ───
    if (currentTab === 'routes') {
      const route = state.walkingRoute || [];
      const streets = Object.entries(state.streetSequences).filter(([st, doors]) => doors.length >= 2).sort((a, b) => b[1].length - a[1].length).slice(0, 10);

      html += `
        <div class="d2d-routes-section">
          <div class="d2d-route-actions">
            <button class="d2d-action-btn" style="flex:1;background:var(--blue);" onclick="window.D2D.calcRoute()">🗺️ Calculate Walking Route</button>
            ${route.length > 0 ? `<button class="d2d-action-btn" style="background:var(--s2);color:var(--t);border:1px solid var(--br);" onclick="window.D2D.clearRoute()">Clear</button>` : ''}
          </div>
          ${route.length > 0 ? `
            <div class="d2d-section-title">Optimized Route (${route.length} stops)</div>
            ${route._stats && route._stats.totalMiles > 0 ? `
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px;">
                <div style="background:var(--s2);border:1px solid var(--br);border-radius:7px;padding:8px 10px;">
                  <div style="font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--m);">Stops</div>
                  <div style="font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;color:var(--t);">${route._stats.stopCount}</div>
                </div>
                <div style="background:var(--s2);border:1px solid var(--br);border-radius:7px;padding:8px 10px;">
                  <div style="font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--m);">Distance</div>
                  <div style="font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;color:var(--t);">${route._stats.totalMiles.toFixed(2)} mi</div>
                </div>
                <div style="background:var(--s2);border:1px solid var(--br);border-radius:7px;padding:8px 10px;">
                  <div style="font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--m);">Walk Time</div>
                  <div style="font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;color:var(--t);">${Math.round(route._stats.walkMinutes)} min</div>
                </div>
              </div>
            ` : ''}
            <div class="d2d-route-list">
              ${route.map((p, i) => `
                <div class="d2d-route-stop" onclick="window.D2D.openQuickKnock({address:'${esc(p.address)}',lat:${p.lat},lng:${p.lng}})">
                  <div class="d2d-route-num">${i + 1}</div>
                  <div class="d2d-route-addr">${esc(p.address)}</div>
                  <span class="d2d-route-icon" style="color:${DISPOSITIONS[p.disposition]?.color || 'var(--m)'};">${DISPOSITIONS[p.disposition]?.icon || ''}</span>
                </div>
              `).join('')}
            </div>
          ` : `<div class="d2d-empty" style="padding:20px;">Hit "Calculate" to find the best route through your unvisited doors (Not Home / Come Back)</div>`}
        </div>

        <div class="d2d-streets-section">
          <div class="d2d-section-title">🏘️ Street Sequences</div>
          ${streets.length === 0 ? '<div class="d2d-empty">No streets with enough data yet</div>' : streets.map(([street, doors]) => {
            const knocked = doors.filter(d => d.knocked).length;
            const total = doors.length;
            const pct = Math.round(knocked / total * 100);
            return `
              <div class="d2d-street-card">
                <div class="d2d-street-header">
                  <div class="d2d-street-name">${esc(street)}</div>
                  <div class="d2d-street-stat">${knocked}/${total} (${pct}%)</div>
                </div>
                <div class="d2d-street-doors">
                  ${doors.slice(0, 30).map(d => {
                    const col = d.knocked ? (DISPOSITIONS[d.disposition]?.color || '#6B7280') : 'var(--br)';
                    return `<div class="d2d-door-chip" style="background:${col};" title="${d.address}" ${d.knockId ? `onclick="window.D2D.openKnockDetail('${d.knockId}')"` : `onclick="window.D2D.openQuickKnock({address:'${esc(d.address)}'})"` }>${d.houseNum || ''}</div>`;
                  }).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    // ─── GAMIFY TAB ───
    if (currentTab === 'gamify') {
      html += `
        <!-- Streak -->
        <div class="d2d-streak-hero">
          <div class="d2d-streak-badge">${gamify.currentMilestone?.badge || '🔥'}</div>
          <div class="d2d-streak-days">${gamify.streak} Day Streak</div>
          <div class="d2d-streak-sub">${gamify.currentMilestone?.label || 'Start your streak!'}</div>
          ${gamify.nextMilestone ? `<div class="d2d-streak-next">Next: ${gamify.nextMilestone.badge} ${gamify.nextMilestone.label} (${gamify.nextMilestone.days - gamify.streak} days)</div>` : ''}
        </div>

        <!-- Daily Challenges -->
        <div class="d2d-section-title">Daily Challenges (${gamify.completedChallenges}/${gamify.totalChallenges})</div>
        <div class="d2d-challenges">
          ${gamify.challenges.map(ch => `
            <div class="d2d-challenge-card ${ch.complete ? 'd2d-challenge-done' : ''}">
              <div class="d2d-challenge-header">
                <div class="d2d-challenge-label">${ch.icon} ${ch.label}</div>
                <div class="d2d-challenge-progress" style="color:${ch.complete ? 'var(--green)' : 'var(--m)'};">${ch.current}/${ch.target} ${ch.complete ? '✓' : ''}</div>
              </div>
              <div class="d2d-progress-track">
                <div class="d2d-progress-fill" style="width:${ch.pct}%;background:${ch.complete ? 'var(--green, #2ECC8A)' : 'var(--blue, #4A9EFF)'};"></div>
              </div>
            </div>
          `).join('')}
        </div>

        <!-- Commission Projection -->
        <div class="d2d-projection-card">
          <div class="d2d-section-title">💰 Monthly Projection</div>
          <div class="d2d-projection-grid">
            <div class="d2d-metric-card">
              <div class="d2d-metric-val" style="color:var(--blue);">${gamify.projectedKnocks}</div>
              <div class="d2d-metric-lbl">Proj. Knocks</div>
            </div>
            <div class="d2d-metric-card">
              <div class="d2d-metric-val" style="color:var(--green);">${gamify.projectedAppts}</div>
              <div class="d2d-metric-lbl">Proj. Appts</div>
            </div>
            <div class="d2d-metric-card">
              <div class="d2d-metric-val" style="color:var(--orange);">$${gamify.projectedRevenue.toLocaleString()}</div>
              <div class="d2d-metric-lbl">Proj. Revenue</div>
            </div>
          </div>
        </div>
      `;
    }

    // ─── ANALYTICS TAB ───
    if (currentTab === 'analytics') {
      const tod = timeOfDay;
      const maxHour = Math.max(...tod.hourCounts, 1);

      html += `
        <!-- Golden Hours -->
        <div class="d2d-golden-hours">
          🕐 Golden Hours: <strong>${tod.bestWindow.start}:00 - ${tod.bestWindow.end}:00</strong> (${tod.bestWindow.conversions} conversions)
        </div>

        <!-- Time of Day Heatmap -->
        <div class="d2d-section-title">Hourly Activity (8am-9pm)</div>
        <div class="d2d-hourly-chart">
          ${Array.from({length: 14}, (_, i) => i + 8).map(hr => {
            const h = tod.hourCounts[hr] || 0;
            const c = tod.hourConversions[hr] || 0;
            const pct = h / maxHour * 100;
            return `<div class="d2d-hour-col" title="${hr}:00 — ${h} knocks, ${c} conversions">
              <div class="d2d-hour-bar" style="height:${pct}%;min-height:${h > 0 ? 2 : 0}px;">
                ${c > 0 ? `<div class="d2d-hour-conv" style="height:${h > 0 ? c/h*100 : 0}%;"></div>` : ''}
              </div>
            </div>`;
          }).join('')}
        </div>
        <div class="d2d-hour-labels">
          ${Array.from({length: 14}, (_, i) => `<div class="d2d-hour-lbl">${(i + 8) % 12 || 12}${i + 8 < 12 ? 'a' : 'p'}</div>`).join('')}
        </div>

        <!-- Insurance Metrics -->
        ${insMetrics.total > 0 ? `
          <div class="d2d-section-title">🏢 Insurance Breakdown (${insMetrics.total} total)</div>
          <div class="d2d-ins-list">
            ${Object.entries(insMetrics.carriers).sort((a, b) => b[1].total - a[1].total).slice(0, 8).map(([carrier, data]) => `
              <div class="d2d-ins-row">
                <span class="d2d-ins-name">${esc(carrier)}</span>
                <span class="d2d-ins-stats">${data.total} leads · ${data.hasClaim} claims · ${data.denied} denied</span>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <!-- Neighborhood Scores -->
        ${Object.keys(state.neighborhoodScores).length > 0 ? `
          <div class="d2d-section-title" style="margin-top:14px;">🏘️ Top Neighborhoods</div>
          <div class="d2d-hood-list">
            ${Object.values(state.neighborhoodScores).sort((a, b) => b.score - a.score).slice(0, 5).map(n => {
              const col = n.score >= 70 ? 'var(--green)' : n.score >= 40 ? 'var(--gold)' : 'var(--red)';
              return `<div class="d2d-hood-row">
                <div class="d2d-hood-score" style="background:${col};">${n.score}</div>
                <div class="d2d-hood-info">
                  <div class="d2d-hood-primary">${n.knocks.length} knocks · ${n.appointments} apts</div>
                  <div class="d2d-hood-secondary">${n.conversations} conversations · ${n.stormDmg} storm dmg</div>
                </div>
              </div>`;
            }).join('')}
          </div>
        ` : ''}
      `;
    }

    html += '</div>';
    html += `<button class="d2d-fab" onclick="window.D2D.openQuickKnock()" aria-label="Quick Knock">🚪</button>`;
    container.innerHTML = html;
  }

  // ============================================================================
  // EXPORT TO STATE OBJECT (shim composes these into window.D2D)
  // ============================================================================
  state.renderD2D = renderD2D;
  state.setTab = setTab;
  state.setDateFilter = setDateFilter;
  state.setDispoFilter = setDispoFilter;
  state.openQuickKnock = openQuickKnock;
  state.selectDispo = selectDispo;
  state.closeQuickKnock = closeQuickKnock;
  state.handleSubmitKnock = handleSubmitKnock;
  state.showConversionPrompt = showConversionPrompt;
  state.openKnockDetail = openKnockDetail;
  state.closeKnockDetail = closeKnockDetail;
  state.openSMSTemplateChooser = openSMSTemplateChooser;
  state.exportKnocksCSV = exportKnocksCSV;
  state.capturePhoto = capturePhoto;
  state.startVoiceRecording = startVoiceRecording;
  state.stopVoiceRecording = stopVoiceRecording;

})();
