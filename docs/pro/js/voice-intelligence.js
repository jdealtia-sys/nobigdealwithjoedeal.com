/**
 * docs/pro/js/voice-intelligence.js — client module for Voice Intel.
 *
 * ES module. No window.* pollution, no inline handlers. Loaded into
 * lead-detail.html via <script type="module"> so the per-page CSP
 * can drop 'unsafe-inline' (M1 direction).
 *
 * Public surface (for C4 UI integration):
 *   initVoiceIntel({ leadId, containerEl, auth, db, storage })
 *     → cleanup()
 *
 * Data flow:
 *   - resolves the caller's companyId + consent mode from Firestore
 *   - subscribes to leads/{leadId}/recordings via onSnapshot
 *   - exposes recordBlob() + uploadFromFile() helpers
 *   - pushes UI state updates through a small reducer
 *
 * Shipped in 2 chunks:
 *   C3a (this commit) — data layer + uploader + consent resolver.
 *                       Everything that can be smoke-tested without
 *                       DOM. No rendering.
 *   C3b (next)        — recording controls, consent modal,
 *                       recording-list UI.
 */

import {
  collection, query, orderBy, onSnapshot, doc, getDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  ref as storageRef, uploadBytesResumable, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

// ─── Consent modes (must match companies/{id}.recordingConsentMode) ─
export const CONSENT_MODES = Object.freeze({
  ONE_PARTY:           'one_party',
  TWO_PARTY_ATTESTED:  'two_party_attested',
  TWO_PARTY_VERBAL:    'two_party_verbal'
});

// Max upload size mirrors storage.rules + voice-intelligence.js
// server-side cap so the client fails fast rather than sending a
// 200MB request only to get a 403.
export const MAX_AUDIO_BYTES = 200 * 1024 * 1024;

// Allowed content types. Mirror the isAudioType() rule in
// storage.rules. MediaRecorder on Chrome/Firefox emits audio/webm;
// Safari emits audio/mp4. User-uploaded files can be any of the rest.
export const ALLOWED_AUDIO_MIME = Object.freeze([
  'audio/webm', 'audio/mpeg', 'audio/mp3', 'audio/mp4',
  'audio/m4a', 'audio/x-m4a', 'audio/ogg', 'audio/wav', 'audio/aac'
]);

// ─── ID generator — 12 char crockford-style, crypto-random ──────
// Used for recordingId in the Storage path + Firestore doc. Opaque,
// URL-safe, no collisions within a user's lifetime at any sane rate.
export function newRecordingId() {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] & 31];
  return out;
}

// ─── Company / consent-mode resolver ────────────────────────────
// The server-side pipeline (voice-intelligence.js::getCompanyContext)
// reads the same doc. We keep the client-side read as a UX nicety —
// knowing the mode BEFORE recording starts lets us show the right
// modal. The SERVER is still authoritative: if someone tampers with
// this and sends a recording without consent, the pipeline's
// checkVerbalConsent still runs and quarantines.
export async function resolveCompanyConsentMode({ db, uid }) {
  let companyId = uid;
  let consentMode = CONSENT_MODES.TWO_PARTY_ATTESTED; // safest default
  try {
    const userSnap = await getDoc(doc(db, 'users', uid));
    if (userSnap.exists()) {
      const u = userSnap.data();
      if (u.companyId) companyId = u.companyId;
    }
  } catch (_) { /* fall through */ }
  try {
    const coSnap = await getDoc(doc(db, 'companies', companyId));
    if (coSnap.exists()) {
      const c = coSnap.data();
      if (typeof c.recordingConsentMode === 'string') {
        // Accept only known values; unknown string → fall back to
        // safe default rather than trusting a misconfigured doc.
        const m = c.recordingConsentMode;
        if (m === CONSENT_MODES.ONE_PARTY
         || m === CONSENT_MODES.TWO_PARTY_ATTESTED
         || m === CONSENT_MODES.TWO_PARTY_VERBAL) {
          consentMode = m;
        }
      }
    }
  } catch (_) { /* fall through */ }
  return { companyId, consentMode };
}

// ─── Uploader ──────────────────────────────────────────────────
// Uploads a Blob to audio/{uid}/{leadId}/{recordingId}.{ext} using
// uploadBytesResumable so flaky mobile connections resume cleanly.
//
// onProgress({ bytesUploaded, totalBytes, percent }) fires
// repeatedly. Returns a Promise that resolves to { path, downloadURL }
// on success and rejects with a typed error on failure.
export function uploadAudioBlob({
  storage, uid, leadId, recordingId, blob, onProgress, onStateChange
}) {
  if (!(blob instanceof Blob)) {
    return Promise.reject(new VoiceClientError('client-bad-blob',
      'uploadAudioBlob requires a Blob'));
  }
  if (blob.size > MAX_AUDIO_BYTES) {
    return Promise.reject(new VoiceClientError('client-too-large',
      'Audio is ' + Math.round(blob.size / 1024 / 1024) + 'MB; cap is ' +
      Math.round(MAX_AUDIO_BYTES / 1024 / 1024) + 'MB'));
  }
  const contentType = blob.type || 'audio/webm';
  if (!ALLOWED_AUDIO_MIME.some(m => contentType.startsWith(m))) {
    return Promise.reject(new VoiceClientError('client-bad-mime',
      'Unsupported content type: ' + contentType));
  }

  const ext = mimeToExt(contentType);
  const path = 'audio/' + uid + '/' + leadId + '/' + recordingId + '.' + ext;
  const r = storageRef(storage, path);
  const task = uploadBytesResumable(r, blob, {
    contentType,
    // Custom metadata stamped onto the Storage object. The server
    // trigger reads name + contentType + size from the event; this
    // is belt-and-suspenders context for any future ops script.
    customMetadata: {
      uid, leadId, recordingId, clientVersion: '1'
    }
  });

  return new Promise((resolve, reject) => {
    task.on('state_changed',
      (snap) => {
        const total = snap.totalBytes || 0;
        const done  = snap.bytesTransferred || 0;
        const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
        try {
          onProgress && onProgress({
            bytesUploaded: done, totalBytes: total, percent: pct
          });
          onStateChange && onStateChange(snap.state); // 'running','paused','success'
        } catch (_) { /* listener errors never break the upload */ }
      },
      (err) => {
        reject(new VoiceClientError('client-upload-failed',
          (err && err.code) ? err.code : String(err && err.message || err)));
      },
      async () => {
        let downloadURL = null;
        try { downloadURL = await getDownloadURL(task.snapshot.ref); } catch (_) {}
        resolve({ path, downloadURL, bytes: blob.size, contentType });
      }
    );
  });
}

// ─── Recording-list subscription ────────────────────────────────
// Returns an unsubscribe function. `onChange` fires with the full
// array of recording docs (newest first) every time Firestore pushes
// an update, including transitions between
// transcribing → analyzing → complete. UI just re-renders.
export function subscribeToRecordings({ db, leadId, onChange, onError }) {
  const q = query(
    collection(db, 'leads', leadId, 'recordings'),
    orderBy('recordedAt', 'desc')
  );
  return onSnapshot(q,
    (snap) => {
      const docs = [];
      snap.forEach(d => docs.push({ id: d.id, ...d.data() }));
      try { onChange && onChange(docs); } catch (_) {}
    },
    (err) => {
      try { onError && onError(err); } catch (_) {}
    }
  );
}

// ─── Helpers ────────────────────────────────────────────────────
export class VoiceClientError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.isVoiceClientError = true;
  }
}

export function mimeToExt(contentType) {
  const t = String(contentType || '').split(';')[0].trim().toLowerCase();
  switch (t) {
    case 'audio/webm':               return 'webm';
    case 'audio/mp4': case 'audio/m4a': case 'audio/x-m4a': return 'm4a';
    case 'audio/mpeg': case 'audio/mp3': return 'mp3';
    case 'audio/ogg':                return 'ogg';
    case 'audio/wav':                return 'wav';
    case 'audio/aac':                return 'aac';
    default:                         return 'webm';
  }
}

// ─── Placeholder main entry point ───────────────────────────────
// C3b will flesh this out with the recorder UI, consent modal, and
// list rendering. Shipped here as a no-op so the import in C4's
// lead-detail.html works without errors.
export function initVoiceIntel(_opts) {
  return {
    cleanup() { /* C3b */ }
  };
}
