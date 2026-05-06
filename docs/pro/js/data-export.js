/**
 * data-export.js — Wave 21 (CSV Data Export)
 *
 * Reps coming from spreadsheets routinely ask "can I get my leads
 * out as a CSV?" and the answer until now was "no, you'd have to
 * use the Firestore CLI." Bad answer. Real escape hatch / backup
 * utility, ships against already-loaded in-memory caches so it's
 * one click + zero server round-trips.
 *
 * Exports:
 *   - Leads:     window._leads → CSV with one row per lead
 *   - Estimates: window._estimates → CSV with one row per estimate,
 *                joined to leads for friendly leadName column
 *
 * Properly RFC-4180 quoted: fields containing comma, quote, or
 * newline get wrapped in double quotes with internal quotes
 * doubled. Excel-safe BOM prepended so non-ASCII names don't get
 * mojibake'd in Excel for Windows.
 *
 * Filename pattern: nbd-{type}-YYYY-MM-DD.csv (date in local TZ
 * so the rep recognizes it).
 *
 * Exposes: window.DataExport.{exportLeads, exportEstimates,
 *                              csvEscape, toCsv}
 *          window.exportLeadsCsv / window.exportEstimatesCsv
 *          (legacy onclick names mirroring the bell + cmd-palette
 *          pattern from prior waves)
 */
(function () {
  'use strict';

  if (window.DataExport && window.DataExport.__sentinel === 'nbd-data-export-v1') return;

  // ─── CSV serialization ───────────────────────────────────────────
  function csvEscape(v) {
    if (v == null) return '';
    let s;
    if (v instanceof Date) {
      s = v.toISOString();
    } else if (typeof v === 'object') {
      // Firestore Timestamps + plain objects — try to extract ISO
      // string; otherwise stringify.
      if (typeof v.toDate === 'function') s = v.toDate().toISOString();
      else if (typeof v.toMillis === 'function') s = new Date(v.toMillis()).toISOString();
      else s = JSON.stringify(v);
    } else {
      s = String(v);
    }
    // Quote if contains separator, quote, or newline.
    if (/[",\n\r]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function toCsv(rows, headers) {
    const headerLine = headers.map(h => csvEscape(h.label || h.key)).join(',');
    const lines = [headerLine];
    for (const row of rows) {
      lines.push(headers.map(h => csvEscape(h.value ? h.value(row) : row[h.key])).join(','));
    }
    // Excel-safe BOM so UTF-8 displays correctly in Excel for Windows.
    return '﻿' + lines.join('\r\n');
  }

  // ─── File download helper ───────────────────────────────────────
  function downloadCsv(filename, csvText) {
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }

  function todayStamp() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // ─── Header definitions ─────────────────────────────────────────
  // Order matters — this is the column order in the CSV. Each header
  // is { key, label, value? }. value() is optional; falls back to
  // row[key].
  const LEAD_HEADERS = [
    { key: 'customerId',     label: 'Customer ID' },
    { key: 'firstName',      label: 'First Name' },
    { key: 'lastName',       label: 'Last Name' },
    { key: 'address',        label: 'Address' },
    { key: 'phone',          label: 'Phone' },
    { key: 'email',          label: 'Email' },
    { key: 'stage',          label: 'Stage' },
    { key: 'jobType',        label: 'Job Type' },
    { key: 'source',         label: 'Source' },
    { key: 'damageType',     label: 'Damage Type' },
    { key: 'jobValue',       label: 'Job Value' },
    { key: 'claimNumber',    label: 'Claim #' },
    { key: 'insCarrier',     label: 'Carrier',
      value: r => r.insCarrier || r.insuranceCarrier || '' },
    { key: 'claimStatus',    label: 'Claim Status' },
    { key: 'createdAt',      label: 'Created' },
    { key: 'updatedAt',      label: 'Updated' },
    { key: 'stageStartedAt', label: 'Current Stage Since' },
    { key: 'notes',          label: 'Notes' },
  ];

  // ─── Lead export ────────────────────────────────────────────────
  function exportLeads() {
    const leads = Array.isArray(window._leads) ? window._leads : [];
    if (leads.length === 0) {
      _toast('No leads to export', 'error');
      return;
    }
    // Skip soft-deleted; respect prospect filter for the export
    // (matches what the rep sees in the kanban). If they want
    // prospects included, they'll toggle "Show prospects" first.
    const showProspects = (() => {
      try { return localStorage.getItem('nbd_crm_show_prospects') === '1'; }
      catch (e) { return false; }
    })();
    const rows = leads
      .filter(l => l && !l.deleted)
      .filter(l => showProspects || !l.isProspect);

    if (rows.length === 0) {
      _toast('No leads match your current filters', 'error');
      return;
    }

    const csv = toCsv(rows, LEAD_HEADERS);
    const fname = `nbd-leads-${todayStamp()}.csv`;
    downloadCsv(fname, csv);
    _toast(`Exported ${rows.length} lead${rows.length === 1 ? '' : 's'} → ${fname}`, 'success');
  }

  // ─── Estimate export ────────────────────────────────────────────
  function exportEstimates() {
    const estimates = Array.isArray(window._estimates) ? window._estimates : [];
    if (estimates.length === 0) {
      _toast('No estimates to export', 'error');
      return;
    }
    const leads = Array.isArray(window._leads) ? window._leads : [];
    const leadById = {};
    for (const l of leads) leadById[l.id] = l;

    const headers = [
      { key: 'id',              label: 'Estimate ID' },
      { key: 'estimateNumber',  label: 'Estimate #',
        value: r => r.estimateNumber || r.number || '' },
      { key: 'leadId',          label: 'Lead ID' },
      { key: 'leadName',        label: 'Lead Name', value: r => {
          const l = leadById[r.leadId];
          if (!l) return '';
          return `${l.firstName || ''} ${l.lastName || ''}`.trim() || l.address || '';
        } },
      { key: 'leadAddress',     label: 'Lead Address', value: r => leadById[r.leadId]?.address || '' },
      { key: 'status',          label: 'Status' },
      { key: 'total',           label: 'Total', value: r => Number(r.total || r.amount || 0) },
      { key: 'lineItemsCount',  label: 'Line Items', value: r => Array.isArray(r.lineItems) ? r.lineItems.length : 0 },
      { key: 'createdAt',       label: 'Created' },
      { key: 'sentAt',          label: 'Sent' },
      { key: 'viewedAt',        label: 'Viewed' },
      { key: 'respondedAt',     label: 'Responded' },
    ];

    const csv = toCsv(estimates, headers);
    const fname = `nbd-estimates-${todayStamp()}.csv`;
    downloadCsv(fname, csv);
    _toast(`Exported ${estimates.length} estimate${estimates.length === 1 ? '' : 's'} → ${fname}`, 'success');
  }

  // ─── Toast helper (uses dashboard's showToast if present) ───────
  function _toast(msg, type) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type || 'info');
    } else {
      console.log('[DataExport]', msg);
    }
  }

  // ─── Public API ─────────────────────────────────────────────────
  window.DataExport = {
    __sentinel: 'nbd-data-export-v1',
    exportLeads,
    exportEstimates,
    csvEscape,
    toCsv,
  };
  // Friendly globals for inline onclick handlers — same convention
  // we used for openCmdPalette / toggleNotificationDropdown so the
  // settings buttons can stay declarative.
  window.exportLeadsCsv     = exportLeads;
  window.exportEstimatesCsv = exportEstimates;
})();
