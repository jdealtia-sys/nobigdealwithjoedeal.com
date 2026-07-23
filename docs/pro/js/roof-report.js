/**
 * NBD Pro — Rep-side Roof Report generator
 *
 * property-intel already computes a 0-100 Roof Score + recommended action
 * from public records (roof age, material, year built). This turns that into
 * a branded, homeowner-facing "Your Roof Health Report" that a rep shares via
 * the SAME reports/{id} + createReportShareToken / getSharedReport pipeline
 * inspection-report-engine uses — no new Cloud Function. (Distinct from the
 * already-live PUBLIC roof-score.html lead magnet: this is the rep's
 * credibility artifact for a specific address.)
 *
 * buildRoofReportHtml() is a PURE function (dual browser/node export) so the
 * copy, the score→advisory mapping, the homeowner-safe framing, and — most
 * importantly — the escaping of attacker/record-sourced fields are unit-tested.
 *
 * HOMEOWNER-SAFE by design: shows score / age / an ADVISORY action + an
 * inspection CTA. NEVER the rep's internal project-value estimate, the owner's
 * market value, cost/margin, or a damage "guarantee" — it's an inspection
 * prompt, not a condition verdict.
 */
(function (root) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Only allow http(s) urls through to href/src — never javascript:/data:.
  function safeUrl(u) {
    var s = String(u == null ? '' : u).trim();
    return /^https?:\/\//i.test(s) ? s : '';
  }

  // Score → homeowner-safe narrative. Advisory only — no "damaged"/"failing"
  // verdicts, since this is derived from public records, not an inspection.
  function scoreNarrative(score, roofAge) {
    var s = Number(score);
    var age = (roofAge != null && Number.isFinite(Number(roofAge))) ? Number(roofAge) : null;
    var band, headline, body, color;
    if (s <= 30) {
      band = 'Inspection strongly recommended'; color = '#e05a4d';
      headline = 'Your roof may be near the end of its service life';
      body = 'Public records suggest your roof is older and could be showing wear. A free professional inspection is the best way to know for sure — and to document any storm damage before it worsens.';
    } else if (s <= 60) {
      band = 'Worth a closer look'; color = '#e08a3c';
      headline = 'Your roof is at an age where issues commonly appear';
      body = 'Roofs in this range often have wear that isn\'t visible from the ground. A quick inspection can catch small problems early — and confirm whether recent storms left any damage.';
    } else if (s <= 80) {
      band = 'Good shape — keep an eye on it'; color = '#c8a000';
      headline = 'Your roof looks to be in reasonable condition';
      body = 'No obvious age concerns from the records we reviewed. A periodic inspection after major storms is still smart to protect your investment.';
    } else {
      band = 'Looking healthy'; color = '#2ecc8a';
      headline = 'Your roof appears to be in good shape';
      body = 'Nothing in the public records raises a concern. It\'s still worth a post-storm check now and then.';
    }
    if (age != null) body += ' Estimated roof age: about ' + esc(String(age)) + ' year' + (age === 1 ? '' : 's') + '.';
    return { band: band, headline: headline, body: body, color: color };
  }

  /**
   * Build a self-contained, inline-styled HTML report page.
   * @param intel  property-intel object (roofScore, roofAge, address, yearBuilt, roofMaterial…).
   * @param brand  { name, logoUrl, accent, repName, repPhone } — tenant white-label.
   * @param opts   { dateStr } (pass in; Date.now is avoided so callers control it).
   */
  function buildRoofReportHtml(intel, brand, opts) {
    intel = intel || {}; brand = brand || {}; opts = opts || {};
    var score = Math.max(0, Math.min(100, Number(intel.roofScore) || 0));
    var n = scoreNarrative(score, intel.roofAge);
    var brandName = esc(brand.name || 'Your Roofing Team');
    var accent = /^#[0-9a-fA-F]{3,8}$/.test(String(brand.accent || '')) ? brand.accent : '#e8720c';
    var logo = safeUrl(brand.logoUrl);
    var address = esc(intel.address || intel.propertyAddress || 'Your Home');
    var dateStr = esc(opts.dateStr || '');
    var repName = esc(brand.repName || '');
    var repPhone = esc(brand.repPhone || '');
    var phoneDigits = String(brand.repPhone || '').replace(/\D/g, '');

    var facts = [];
    if (intel.yearBuilt) facts.push(['Year Built', esc(intel.yearBuilt)]);
    if (intel.roofMaterial) facts.push(['Roof Material', esc(intel.roofMaterial)]);
    if (intel.roofAge != null) facts.push(['Est. Roof Age', esc(String(intel.roofAge)) + ' yrs']);
    var factsHtml = facts.length
      ? '<div style="display:flex;gap:10px;flex-wrap:wrap;margin:18px 0;">' + facts.map(function (f) {
          return '<div style="flex:1;min-width:120px;background:#f4f5f7;border-radius:10px;padding:12px 14px;">' +
            '<div style="font-size:20px;font-weight:800;color:#1a1a1a;">' + f[1] + '</div>' +
            '<div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin-top:2px;">' + f[0] + '</div></div>';
        }).join('') + '</div>'
      : '';

    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Roof Health Report — ' + address + '</title></head>' +
      '<body style="margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#eef0f3;color:#1a1a1a;">' +
      '<div style="max-width:640px;margin:0 auto;background:#fff;">' +
        '<div style="background:' + esc(accent) + ';padding:22px 24px;color:#fff;display:flex;align-items:center;gap:12px;">' +
          (logo ? '<img src="' + esc(logo) + '" alt="' + brandName + '" style="height:38px;width:auto;border-radius:6px;background:#fff;padding:3px;">' : '') +
          '<div><div style="font-size:12px;opacity:.85;letter-spacing:.08em;text-transform:uppercase;">Roof Health Report</div>' +
          '<div style="font-size:19px;font-weight:800;">' + brandName + '</div></div></div>' +
        '<div style="padding:24px;">' +
          '<div style="font-size:13px;color:#6b7280;">Prepared for</div>' +
          '<div style="font-size:20px;font-weight:800;margin-bottom:2px;">' + address + '</div>' +
          (dateStr ? '<div style="font-size:12px;color:#9ca3af;">' + dateStr + '</div>' : '') +
          '<div style="display:flex;align-items:center;gap:18px;margin:22px 0;padding:18px;background:#f9fafb;border-radius:14px;">' +
            '<div style="text-align:center;flex-shrink:0;">' +
              '<div style="font-size:46px;font-weight:900;line-height:1;color:' + n.color + ';">' + score + '</div>' +
              '<div style="font-size:11px;color:#9ca3af;">out of 100</div></div>' +
            '<div><div style="display:inline-block;background:' + n.color + ';color:#fff;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;text-transform:uppercase;letter-spacing:.04em;">' + esc(n.band) + '</div>' +
              '<div style="font-size:16px;font-weight:700;margin-top:8px;">' + esc(n.headline) + '</div></div></div>' +
          '<p style="font-size:14px;line-height:1.6;color:#374151;">' + esc(n.body) + '</p>' +
          factsHtml +
          '<a href="' + (phoneDigits ? 'tel:' + phoneDigits : '#') + '" style="display:block;text-align:center;background:' + esc(accent) + ';color:#fff;text-decoration:none;font-weight:800;padding:15px;border-radius:12px;font-size:16px;margin-top:8px;">📅 Schedule a Free Roof Inspection</a>' +
          (repName || repPhone ? '<div style="text-align:center;font-size:13px;color:#6b7280;margin-top:12px;">' + repName + (repName && repPhone ? ' · ' : '') + repPhone + '</div>' : '') +
          '<p style="font-size:11px;color:#9ca3af;line-height:1.5;margin-top:22px;border-top:1px solid #e5e7eb;padding-top:14px;">This report is an estimate generated from publicly available property records and is not a substitute for a professional on-site inspection. Roof condition can only be confirmed by a qualified inspector.</p>' +
        '</div></div></body></html>';
  }

  var api = { buildRoofReportHtml: buildRoofReportHtml, scoreNarrative: scoreNarrative };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.RoofReport = api;
})(typeof window !== 'undefined' ? window : this);
