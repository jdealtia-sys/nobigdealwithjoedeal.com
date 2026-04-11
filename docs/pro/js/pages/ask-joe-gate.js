/**
 * NBD Pro — /pro/ask-joe.html auth gate.
 * Extracted from an inline <script type="module"> so strict CSP can drop
 * 'unsafe-inline'.
 */
import { NBDAuth } from '/pro/js/nbd-auth.js';

window._nbdAuth = NBDAuth.init({
  requiredPlan: 'professional',
});
