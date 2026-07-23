/**
 * fresh-view-logic.js — pure helpers behind the onEstimateViewedStrike trigger
 * (idea #3 Phase 2). Dependency-free (no firebase) so tests can require() it
 * and the trigger (customer-audit.js) shares the exact same code path.
 *
 * Phase 1 (#1047) surfaced "they're viewing your estimate now" from the
 * client's own refresh cadence. Phase 2 makes it real-time: a customerAuditEvent
 * of type 'estimate_view' fires a Firestore trigger that writes a notification
 * onto the owner's live feed (the same `notifications` collection the dashboard
 * already onSnapshot-subscribes to), so the top-center strike card fires the
 * moment the homeowner opens the page. This module builds that notification doc
 * + the cooldown decision.
 */
'use strict';

// Compact money label for the notification message ("$18K", "$950"). Empty
// string when there's no positive amount (message degrades gracefully).
function money(n) {
  const v = Number(n);
  if (!isFinite(v) || v <= 0) return '';
  return v >= 1000 ? ('$' + Math.round(v / 1000) + 'K') : ('$' + Math.round(v));
}

// Deterministic notification doc id: one rolling strike per owner+lead, so a
// homeowner re-opening the estimate UPDATES the same feed entry (bumps it back
// to the top, re-marks unread) instead of piling up N duplicate cards.
function freshViewNotifId(ownerUid, leadId) {
  return 'fv_' + String(ownerUid || '') + '_' + String(leadId || 'x');
}

// Cooldown: suppress a re-fire within cooldownMs of the last strike for this
// lead (a page refresh / re-open bursts several estimate_view events), but let
// a genuine later return re-fire. No previous strike → always notify.
function shouldNotify(prevCreatedAtMs, nowMs, cooldownMs) {
  if (!prevCreatedAtMs) return true;
  return (nowMs - prevCreatedAtMs) >= cooldownMs;
}

// Build the notification doc fields (caller stamps createdAt serverTimestamp).
// Uses the bell's recognized `estimate_viewed` type (👀 icon). Never throws;
// degrades to a generic message when name/amount are missing.
function buildFreshViewNotif({ ownerUid, leadId, estimateId, customerName, customerPhone, amount }) {
  const name = (customerName && String(customerName).trim()) || '';
  const amt = money(amount);
  const who = name || 'A customer';
  const message = amt
    ? (who + ' is viewing their ' + amt + ' estimate right now.')
    : (who + ' is viewing their estimate right now.');
  const numAmount = Number(amount);
  return {
    userId: ownerUid || null,
    type: 'estimate_viewed',
    leadId: leadId || null,
    estimateId: estimateId || null,
    customerName: name || null,
    customerPhone: customerPhone || null,
    estimateAmount: (isFinite(numAmount) && numAmount > 0) ? numAmount : null,
    title: '👀 Viewing your estimate',
    message,
    priority: 'high',
    read: false,
  };
}

module.exports = { money, freshViewNotifId, shouldNotify, buildFreshViewNotif };
