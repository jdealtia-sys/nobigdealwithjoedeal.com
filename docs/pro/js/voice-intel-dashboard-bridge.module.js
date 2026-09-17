/**
 * voice-intel-dashboard-bridge.module.js — the bridge dashboard.html needs
 * to reuse two customer.html ES-module features from a classic
 * (non-module) script: Voice Intel and the portal Messages thread.
 *
 * Both voice-intelligence.js's initVoiceIntel() and
 * customer-realtime.module.js's mountMessages() are genuinely portable
 * mount({leadId,...}) -> {cleanup()} functions with no customer.html-only
 * globals baked in (auth/db/storage/leadId are all passed in explicitly).
 * The only customer.html-specific piece of either feature was its own
 * bootstrap file, which polls for window._customerId and auto-mounts once
 * at page load — the wrong shape for the mobile job-detail overlay, which
 * opens and closes for a DIFFERENT lead repeatedly on one page load. That
 * mount/unmount lifecycle lives in dashboard-actions.js's _mountVoiceIntel()/
 * _mountMessagesHub() instead; this file's only job is exposing the two ES
 * exports as window globals so that classic script can call them.
 */
import { initVoiceIntel } from './voice-intelligence.js';
import { mountMessages } from './customer-realtime.module.js';
window.VoiceIntel = { mount: initVoiceIntel };
window.CustomerMessages = { mount: mountMessages };
