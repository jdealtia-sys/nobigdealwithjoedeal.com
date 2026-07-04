
  import { initVoiceIntel } from '/pro/js/voice-intelligence.js';

  // Wait until the classic customer.html bootstrap has resolved
  // window._customerId + Firebase globals. Poll briefly — 100ms
  // intervals for up to 10s is plenty; if it never lands, we bail
  // silently and the tab just shows the empty shell.
  function whenReady(maxWaitMs) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const probe = () => {
        if (window._customerId && window.auth && window.db && window.storage
            && window.auth.currentUser) {
          return resolve({
            leadId:    window._customerId,
            auth:      window.auth,
            db:        window.db,
            storage:   window.storage
          });
        }
        if (Date.now() - start > maxWaitMs) return reject(new Error('voice-intel: bootstrap timeout'));
        setTimeout(probe, 100);
      };
      probe();
    });
  }

  let cleanup = null;
  whenReady(10000).then(({ leadId, auth, db, storage }) => {
    const host = document.getElementById('voiceIntelRoot');
    if (!host) return;
    host.setAttribute('data-lead-id', leadId);
    const instance = initVoiceIntel({ leadId, containerEl: host, auth, db, storage });
    cleanup = instance && instance.cleanup ? instance.cleanup : null;
  }).catch(() => {
    const host = document.getElementById('voiceIntelRoot');
    if (host) host.innerHTML =
      '<div style="color:var(--m);font-size:12px;">' +
      'Voice Intel did not initialize — reload the page or make sure you\'re signed in.' +
      '</div>';
  });

  // Best-effort teardown on page navigation so the Firestore
  // listener unsubscribes cleanly.
  window.addEventListener('beforeunload', () => {
    try { cleanup && cleanup(); } catch (_) {}
  });
