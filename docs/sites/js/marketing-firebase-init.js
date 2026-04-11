/**
 * Glue module loaded by every marketing-site host page. Imports the shared
 * `submitMarketingLead` helper from marketing-firebase.js and exposes it on
 * `window._nbdSubmitLead` so legacy non-module scripts (sites/oaks/shared.js,
 * inline form handlers on sites/index.html, etc) can keep using a single
 * global name without each of them becoming a module.
 */
import { submitMarketingLead } from './marketing-firebase.js';

window._nbdSubmitLead = submitMarketingLead;

// Signal to inline form handlers that are waiting for the helper.
window.dispatchEvent(new Event('nbd-marketing-firebase-ready'));
