/**
 * NBD Pro — Inbound-SMS Triage (pure helper)
 *
 * incomingSMS logs every text from a number that matches no lead into
 * unmatched_sms ({from, body, twilioSid, receivedAt}) "for admin review" —
 * and nothing ever surfaced it. Those are frequently HOT inbound interest
 * from yard-sign / storm / D2D numbers quietly rotting in a write-only
 * collection. admin-manager.js renders them as a triage inbox; this module is
 * the pure classify/sort layer behind it.
 *
 * Design bias: UNDER-filter. Hiding a real lead is far worse than showing a
 * carrier keyword, so only unambiguous noise (empty / opt-out / carrier
 * keyword / single char) is set aside — everything else is treated as a
 * possible lead. (STOP is already handled server-side BEFORE the unmatched
 * write, so true opt-outs rarely reach here; HELP/START/YES etc. can.)
 *
 * Pure + dual browser/node export so the classification is unit-tested.
 */
(function (root) {
  'use strict';

  var OPTOUT = /^(stop|stopall|unsubscribe|cancel|end|quit|revoke|optout)$/i;
  var CARRIER = /^(help|info|start|unstop|yes|no|y|n)$/i;

  function toMs(v) {
    if (v == null) return NaN;
    if (typeof v === 'object' && typeof v.toDate === 'function') { try { return v.toDate().getTime(); } catch (_) { return NaN; } }
    if (typeof v === 'object' && typeof v.seconds === 'number') return v.seconds * 1000;
    var t = Date.parse(v);
    return Number.isFinite(t) ? t : NaN;
  }
  function digits(p) { return String(p || '').replace(/\D/g, ''); }
  function displayPhone(p) {
    var d = digits(p);
    if (d.length === 11 && d[0] === '1') d = d.slice(1);
    if (d.length === 10) return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
    return String(p || '');
  }

  // Classify a single inbound body. kind: 'lead' | 'optout' | 'noise'.
  function classifyInbound(body) {
    var b = String(body == null ? '' : body).trim();
    if (!b) return { kind: 'noise', label: 'empty' };
    var oneWord = b.replace(/[^a-z]/gi, '');
    if (OPTOUT.test(oneWord) && b.length <= 12) return { kind: 'optout', label: 'opt-out keyword' };
    if (CARRIER.test(oneWord) && b.length <= 8) return { kind: 'noise', label: 'carrier keyword' };
    if (b.length < 2) return { kind: 'noise', label: 'too short' };
    return { kind: 'lead', label: 'possible lead' };
  }

  /**
   * Triage a batch of unmatched_sms docs into an actionable inbox + a filtered
   * pile, each newest-first. Every row is annotated with _cls / _ms / _display.
   */
  function triageInbound(docs) {
    var rows = (Array.isArray(docs) ? docs : []).filter(Boolean).map(function (d) {
      return {
        id: d.id,
        from: d.from || '',
        body: d.body || '',
        twilioSid: d.twilioSid || '',
        receivedAt: d.receivedAt,
        _ms: toMs(d.receivedAt),
        _cls: classifyInbound(d.body),
        _display: displayPhone(d.from),
        _digits: digits(d.from),
      };
    });
    rows.sort(function (a, b) { return (b._ms || 0) - (a._ms || 0); });
    return {
      actionable: rows.filter(function (r) { return r._cls.kind === 'lead'; }),
      filtered: rows.filter(function (r) { return r._cls.kind !== 'lead'; }),
    };
  }

  var api = { classifyInbound: classifyInbound, triageInbound: triageInbound, displayPhone: displayPhone, digits: digits };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.InboundSmsTriage = api;
})(typeof window !== 'undefined' ? window : this);
