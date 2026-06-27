// FCM Web Push config (appointment reminders + lead/follow-up pushes).
//
// The VAPID public key (the "Web Push certificate" key pair) is the
// applicationServerKey — it is MEANT to live in client code and is validated
// by the push service, not a secret. Set window.__NBD_VAPID_KEY here BEFORE
// push-registration.js reads it.
//
// HOW TO GET IT (one-time, ~2 min):
//   Firebase Console → Project Settings → Cloud Messaging →
//   Web configuration → "Web Push certificates" → Generate key pair →
//   copy the long "Key pair" string and paste it between the quotes below.
//
// Until this is set, push is gracefully DISABLED: push-registration.js logs a
// single console hint and skips registration — nothing else breaks.
//
// Loaded as a classic (non-deferred) external script, exactly like
// dashboard-appcheck-config.js, so the global is set before the deferred
// push-registration.js runs. Production CSP `script-src-elem 'self'` blocks
// inline <script>, so this MUST stay an external file.
window.__NBD_VAPID_KEY = "";
