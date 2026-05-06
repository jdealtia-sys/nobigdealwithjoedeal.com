/**
 * customer-sibling-snooze.js — Wave 72 (Bulk-snooze a customer's other open leads)
 *
 * Customers in this CRM often have multiple lead records over the
 * years (claim incidents, repeat work, etc.) — all sharing the
 * same customerId. When the rep opens one of those leads to work
 * on it, the OTHER open leads on the same customer are usually
 * just noise: they're not what the rep is acting on right now.
 *
 * This module surfaces a "💤 Snooze N siblings" chip next to the
 * customerId badge in the customer-page header. Clicking it opens
 * the W35 bulkPrompt modal pre-populated with the sibling lead
 * IDs. After the rep picks a preset, all siblings get snoozed in
 * one round-trip.
 *
 * Sibling criteria:
 *   - Same customerId as the current lead
 *   - Different leadId (don't include self)
 *   - Not deleted
 *   - Not already snoozed (skipping these keeps the count honest)
 *   - Not in a terminal stage (closed/lost/Complete) — already
 *     done, snoozing them is meaningless
 *
 * Hides itself when:
 *   - Current lead has no customerId
 *   - No siblings match the criteria
 *   - LeadSnooze API isn't available
 *
 * Path-gated to /pro/customer.html. Updates on:
 *   - DOMContentLoaded + 1.5s defer
 *   - 'nbd:data-refreshed' event
 *
 * Compounds W35 (LeadSnooze.bulkPrompt API) + W52/W59 customer-
 * detail header chip pattern.
 */
(function () {
  'use strict';

  if (window.CustomerSiblingSnooze
      && window.CustomerSiblingSnooze.__sentinel === 'nbd-customer-sibling-snooze-v1') return;

  const PATH = window.location.pathname || '';
  if (!/\/pro\/customer\.html$/.test(PATH)) return;

  const TERMINAL = new Set(['closed', 'lost', 'Lost', 'Complete']);

  // ─── Compute ─────────────────────────────────────────────────────
  function computeSiblings() {
    const lead = window._currentLead;
    if (!lead || !lead.customerId) return [];
    const allLeads = Array.isArray(window._leads) ? window._leads : [];
    const siblings = [];
    for (const l of allLeads) {
      if (!l || l.id === lead.id) continue;
      if (l.deleted) continue;
      if (l.customerId !== lead.customerId) continue;
      const sk = (l._stageKey || l.stage || 'new').toString();
      if (TERMINAL.has(sk)) continue;
      if (window.LeadSnooze && window.LeadSnooze.isSnoozed(l)) continue;
      siblings.push(l);
    }
    return siblings;
  }

  // ─── Render ──────────────────────────────────────────────────────
  function update() {
    const badge = document.getElementById('customerIdBadge');
    if (!badge) return;
    let chip = document.getElementById('siblingSnoozeChip');
    const siblings = computeSiblings();

    if (!siblings.length || !window.LeadSnooze) {
      if (chip) chip.style.display = 'none';
      return;
    }

    if (!chip) {
      chip = document.createElement('button');
      chip.id = 'siblingSnoozeChip';
      chip.type = 'button';
      // Match the meta-item visual register; lean toward the W26/W61
      // snooze purple accent so it reads as part of the snooze
      // vocabulary, not the share trio.
      chip.style.cssText = [
        'display:inline-flex',
        'align-items:center',
        'gap:6px',
        'background:rgba(155,109,255,0.10)',
        'color:#a890e8',
        'border:1px solid rgba(155,109,255,0.35)',
        'border-radius:12px',
        'padding:2px 10px',
        'margin-left:6px',
        'font-size:11px',
        'font-weight:600',
        'letter-spacing:.02em',
        'cursor:pointer',
        '-webkit-tap-highlight-color:transparent',
        'transition:background .12s, transform .12s',
      ].join(';');
      chip.addEventListener('mouseover', () => {
        chip.style.background = 'rgba(155,109,255,0.18)';
      });
      chip.addEventListener('mouseout', () => {
        chip.style.background = 'rgba(155,109,255,0.10)';
      });
      chip.addEventListener('click', onClick);
      // Append inside the customer-id badge meta-item so it sits
      // right next to the customerId pill.
      badge.appendChild(chip);
    }

    const n = siblings.length;
    chip.textContent = `💤 Snooze ${n} other lead${n === 1 ? '' : 's'}`;
    chip.title = `This customer has ${n} other open lead${n === 1 ? '' : 's'} — snooze them in one click to focus on the current one.`;
    chip.style.display = 'inline-flex';
  }

  function onClick(ev) {
    ev.stopPropagation();
    const siblings = computeSiblings();
    if (!siblings.length || !window.LeadSnooze
        || typeof window.LeadSnooze.bulkPrompt !== 'function') return;
    const ids = siblings.map(l => l.id);
    window.LeadSnooze.bulkPrompt(ids);
  }

  // ─── Init ────────────────────────────────────────────────────────
  function init() {
    setTimeout(update, 1500);
    window.addEventListener('nbd:data-refreshed', update);
  }

  window.CustomerSiblingSnooze = {
    __sentinel: 'nbd-customer-sibling-snooze-v1',
    update,
    computeSiblings,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
