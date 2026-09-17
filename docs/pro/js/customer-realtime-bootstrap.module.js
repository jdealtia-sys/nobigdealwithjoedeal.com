/**
 * customer-realtime-bootstrap.module.js — customer.html's auto-mount for
 * the portal Messages thread.
 *
 * 2026-09-17: split out of customer-realtime.module.js so that file could
 * become pure export (mountMessages()) with no top-level side effect —
 * mirrors the existing voice-intelligence.js / customer-voice-intelligence
 * .module.js split. customer.html loads THIS file (not
 * customer-realtime.module.js directly) so behavior here is unchanged from
 * before that refactor: same whenReady probe, same one-time auto-mount,
 * same beforeunload cleanup.
 */
import { mountMessages } from './customer-realtime.module.js';

function whenReady(maxWaitMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const probe = () => {
      if (window._customerId && window.auth && window.db && window.auth.currentUser) {
        return resolve({
          leadId: window._customerId,
          db: window.db,
          uid: window.auth.currentUser.uid,
        });
      }
      if (Date.now() - start > maxWaitMs) return reject(new Error('messages: bootstrap timeout'));
      setTimeout(probe, 100);
    };
    probe();
  });
}

let _autoInstance = null;
whenReady(10000).then(({ leadId, db }) => {
  _autoInstance = mountMessages({ leadId, db });
}).catch((e) => {
  console.warn('[rep-msg] init failed:', e.message);
});

window.addEventListener('beforeunload', () => {
  try { _autoInstance && _autoInstance.cleanup(); } catch (_) {}
});
