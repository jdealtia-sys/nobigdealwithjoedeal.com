/**
 * expenses.js — Expenses & Supplier-Spend view (#/expenses).
 *
 * Phase 1 of the expense subsystem: manual expense logging (with optional
 * receipt upload), supplier-spend metrics, category + per-job breakdowns, and
 * per-job gross margin fed from the expense ledger via ProfitTracker.
 *
 * Exposes: window.Expenses
 *
 * Depends on window.ExpenseConfig (loaded first in the same lazy bundle) for
 * the category->costType map, revenue basis, and cents<->dollars helpers — the
 * single source of truth. Pure functions (aggregate / jobMargin) are exported
 * for unit testing in the vm sandbox.
 *
 * Data: expenses/{id} (company-shared; see firestore.rules). Reads are scoped
 * by the rule — a company_admin/manager queries by companyId (whole team), a
 * rep/solo operator queries by userId (own). Querying by companyId as a non-
 * staff user is permission-denied, so the scope is chosen from the role claim.
 * Receipts: receipts/{uid}/ in Storage (image/PDF, see storage.rules).
 */
(function () {
  'use strict';

  var EC = function () { return window.ExpenseConfig; };

  // ── identity / scope ────────────────────────────────────────────────
  function uid() { return (window._user && window._user.uid) || null; }
  function claims() { return window._userClaims || {}; }
  function companyId() { return claims().companyId || uid(); }
  function isStaff() {
    var r = claims().role;
    return r === 'company_admin' || r === 'manager' || r === 'admin';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg, type) {
    if (typeof window.showToast === 'function') return window.showToast(msg, type);
    if (typeof window.toast === 'function') return window.toast(msg, type);
    console.log('[expenses]', type || 'info', msg);
  }
  function money(cents) {
    var c = EC();
    return c ? c.formatCents(cents) : ('$' + ((parseInt(cents, 10) || 0) / 100).toFixed(2));
  }
  function toDate(v) {
    if (!v) return null;
    if (typeof v.toDate === 'function') return v.toDate(); // Firestore Timestamp
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  function fmtDate(v) {
    var d = toDate(v);
    return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  }

  var _expenses = [];
  var _loaded = false;
  var _scannedPath = null;       // receipt uploaded during an AI scan (reused on save)
  var _scanExtraction = null;    // last extraction (carries source/needsReview to save)
  var _receiptCallable = null;
  var _estCostByLead = {};       // leadId -> budgeted direct cost in CENTS (from V2 estimates)

  // ── data layer ──────────────────────────────────────────────────────
  async function fetchExpenses() {
    if (!window.db || !uid() || !window.getDocs) return [];
    var col = window.collection(window.db, 'expenses');
    var q;
    // Rule-safe scope: staff read the whole tenant (companyId); everyone else
    // reads only their own (userId). A companyId query by a non-staff user is
    // permission-denied (isCompanyStaff() is false).
    if (isStaff() && claims().companyId) {
      q = window.query(col, window.where('companyId', '==', companyId()), window.orderBy('date', 'desc'), window.limit(1000));
    } else {
      q = window.query(col, window.where('userId', '==', uid()), window.orderBy('date', 'desc'), window.limit(1000));
    }
    try {
      var snap = await window.getDocs(q);
      return snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
    } catch (e) {
      console.warn('[expenses] fetch failed', e);
      toast('Could not load expenses', 'error');
      return [];
    }
  }

  // Budgeted direct cost per job for estimated-vs-actual variance. Only the V2
  // estimate builder persists a cost basis (materialCost + laborCost); the
  // classic builder stores only grandTotal (customer PRICE, not cost), so those
  // jobs get no variance. Rule-safe: estimates are owner-read, so query by
  // userId (a company_admin viewing a teammate's job won't get their estimate —
  // variance just shows "—" there). where(userId==) needs only the auto
  // single-field index.
  async function fetchEstimateCosts() {
    _estCostByLead = {};
    if (!window.db || !uid() || !window.getDocs) return;
    try {
      var snap = await window.getDocs(window.query(
        window.collection(window.db, 'estimates'),
        window.where('userId', '==', uid()), window.limit(1000)));
      snap.docs.forEach(function (d) {
        var e = d.data();
        if (!e || !e.leadId) return;
        var mat = parseFloat(e.materialCost), lab = parseFloat(e.laborCost);
        if (!isFinite(mat) && !isFinite(lab)) return; // classic / no cost basis
        var cents = Math.round(((isFinite(mat) ? mat : 0) + (isFinite(lab) ? lab : 0)) * 100);
        // Keep the largest cost-basis estimate per lead (latest revision tends
        // to be the most complete; ties resolve to the bigger number).
        if (cents > 0 && cents >= (_estCostByLead[e.leadId] || 0)) _estCostByLead[e.leadId] = cents;
      });
    } catch (err) { console.warn('[expenses] estimate-cost fetch failed', err); }
  }

  // Estimated-vs-actual for one job. Returns null if no V2 cost basis exists.
  function estVsActual(leadId, actualDirectCents) {
    var est = _estCostByLead[leadId];
    if (!est || est <= 0) return null;
    return { estCents: est, actualCents: actualDirectCents, varianceCents: actualDirectCents - est };
  }

  async function uploadReceipt(file, u) {
    if (!window.storage || !window.ref || !window.uploadBytes) throw new Error('storage unavailable');
    var ts = Date.now();
    var safe = (file.name || 'receipt').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    var body = await downscaleImage(file); // shrink huge phone photos; no-op for PDF/HEIC
    var path = 'receipts/' + u + '/' + ts + '_' + safe;
    await window.uploadBytes(window.ref(window.storage, path), body, { contentType: (body && body.type) || file.type || 'application/octet-stream' });
    return path;
  }

  // Downscale a large JPEG/PNG/WebP via canvas before upload (cuts upload size +
  // OCR cost/latency). Returns a Blob, or the ORIGINAL file unchanged for PDFs,
  // HEIC/other formats the browser can't decode, small images, or any failure.
  function downscaleImage(file) {
    return new Promise(function (resolve) {
      try {
        var t = file && file.type || '';
        if (!/^image\/(jpeg|png|webp)$/.test(t) || file.size < 1200 * 1024) return resolve(file);
        var url = URL.createObjectURL(file);
        var img = new Image();
        var done = false;
        var finish = function (out) { if (done) return; done = true; try { URL.revokeObjectURL(url); } catch (e) {} resolve(out); };
        var timer = setTimeout(function () { finish(file); }, 8000);
        img.onload = function () {
          try {
            var max = 1600, scale = Math.min(1, max / Math.max(img.width, img.height));
            if (scale >= 1) { clearTimeout(timer); return finish(file); }
            var cv = document.createElement('canvas');
            cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
            cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
            cv.toBlob(function (blob) { clearTimeout(timer); finish(blob && blob.size < file.size ? blob : file); }, 'image/jpeg', 0.85);
          } catch (e) { clearTimeout(timer); finish(file); }
        };
        img.onerror = function () { clearTimeout(timer); finish(file); }; // HEIC etc. → keep original
        img.src = url;
      } catch (e) { resolve(file); }
    });
  }

  // Client-side duplicate guard: same supplier + amount + calendar day already
  // logged. Returns the matching expense or null.
  function findDuplicate(supplier, amountCents, dateStr) {
    var sup = (supplier || '').trim().toLowerCase();
    return _expenses.find(function (e) {
      if ((parseInt(e.amountCents, 10) || 0) !== amountCents) return false;
      if (((e.supplier || '').trim().toLowerCase()) !== sup) return false;
      var ed = toDate(e.date);
      return ed && ed.toISOString().slice(0, 10) === dateStr;
    }) || null;
  }

  // file must be an image or PDF (storage rule: isDocType allows image/* + pdf)
  function receiptTypeOk(file) {
    if (!file) return true;
    var t = file.type || '';
    return /^image\//.test(t) || t === 'application/pdf';
  }

  async function createExpense(form) {
    var u = uid();
    var c = EC();
    if (!u || !window.db || !window.addDoc) { toast('Not signed in', 'error'); return false; }
    if (!c) { toast('Expense config not loaded', 'error'); return false; }

    var amountCents = c.dollarsToCents(form.amount);
    if (amountCents <= 0) { toast('Enter an amount greater than $0', 'error'); return false; }

    var category = (form.category && c.byKey[form.category]) ? form.category : 'materials';
    var costType = c.costTypeFor(category);

    var receiptStoragePath = null;
    if (form.uploadedPath) {
      // Already uploaded during an AI scan — reuse it, don't upload twice.
      receiptStoragePath = form.uploadedPath;
    } else if (form.file) {
      if (!receiptTypeOk(form.file)) { toast('Receipt must be an image or PDF', 'error'); return false; }
      if (form.file.size > 25 * 1024 * 1024) { toast('Receipt is over the 25MB limit', 'error'); return false; }
      try { receiptStoragePath = await uploadReceipt(form.file, u); }
      catch (e) { console.warn('[expenses] receipt upload failed', e); toast('Receipt upload failed; saved without it', 'warn'); }
    }

    var dateObj = form.date ? new Date(form.date + 'T00:00:00') : new Date();
    if (isNaN(dateObj.getTime())) dateObj = new Date();

    var docData = {
      userId: u,
      companyId: claims().companyId || u,
      leadId: form.leadId || null,
      category: category,
      costType: costType,
      supplier: (form.supplier || '').trim().slice(0, 120),
      amountCents: amountCents,
      taxCents: c.dollarsToCents(form.tax) || 0,
      currency: c.DEFAULT_CURRENCY,
      date: dateObj,
      note: (form.note || '').trim().slice(0, 500),
      receiptStoragePath: receiptStoragePath,
      receiptDocRef: null,
      source: form.source === 'ocr' ? 'ocr' : 'manual',
      ocrConfidence: typeof form.ocrConfidence === 'number' ? form.ocrConfidence : null,
      needsReview: !!form.needsReview,
      createdAt: window.serverTimestamp(),
      createdBy: u,
      updatedAt: window.serverTimestamp()
    };
    try {
      await window.addDoc(window.collection(window.db, 'expenses'), docData);
      toast('Expense logged', 'ok');
      return true;
    } catch (e) {
      console.error('[expenses] create failed', e);
      toast('Failed to save expense', 'error');
      return false;
    }
  }

  async function removeExpense(id) {
    if (!id || !window.db || !window.deleteDoc) return false;
    try {
      await window.deleteDoc(window.doc(window.db, 'expenses', id));
      toast('Expense deleted', 'ok');
      return true;
    } catch (e) {
      console.error('[expenses] delete failed', e);
      toast('Failed to delete (only the owner can)', 'error');
      return false;
    }
  }

  // ── AI receipt scan (Phase 2) ───────────────────────────────────────
  async function ensureReceiptCallable() {
    if (_receiptCallable) return _receiptCallable;
    if (window._httpsCallable && window._functions) {
      _receiptCallable = window._httpsCallable(window._functions, 'extractReceiptData');
      return _receiptCallable;
    }
    var mod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
    window._functions = window._functions || mod.getFunctions();
    window._httpsCallable = mod.httpsCallable;
    _receiptCallable = mod.httpsCallable(window._functions, 'extractReceiptData');
    return _receiptCallable;
  }

  function setScanStatus(msg, kind) {
    var el = document.getElementById('expScanStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = kind === 'warn' ? '#eab308' : kind === 'error' ? '#dc2626' : kind === 'ok' ? '#16a34a' : 'var(--m,#9ca3af)';
  }

  function applyExtraction(d) {
    var ex = (d && d.extracted) || {};
    _scanExtraction = d || null;
    var setVal = function (id, v) { var el = document.getElementById(id); if (el && v != null && v !== '') el.value = v; };
    if (ex.totalCents != null) setVal('expAmount', (ex.totalCents / 100).toFixed(2));
    if (ex.taxCents) setVal('expTax', (ex.taxCents / 100).toFixed(2));
    if (ex.vendor) setVal('expSupplier', ex.vendor);
    if (ex.date) setVal('expDate', ex.date);
    if (ex.suggestedCategory) { var sel = document.getElementById('expCategory'); if (sel) sel.value = ex.suggestedCategory; }
    var conf = Math.round((ex.confidence || 0) * 100);
    if (d && d.needsReview) {
      var why = (d.reconcile && !d.reconcile.matched) ? ' — line items don’t sum to the total' : '';
      setScanStatus('⚠ Review the fields' + why + ' (confidence ' + conf + '%). Correct anything off, then Save.', 'warn');
    } else {
      setScanStatus('✓ Scanned (confidence ' + conf + '%). Double-check, then Save.', 'ok');
    }
  }

  async function scanReceipt(btn) {
    var fileEl = document.getElementById('expFile');
    var file = fileEl && fileEl.files && fileEl.files[0];
    if (!file) { setScanStatus('Choose a receipt image or PDF first.', 'warn'); return; }
    if (!receiptTypeOk(file)) { setScanStatus('Receipt must be an image or PDF.', 'error'); return; }
    if (file.size > 25 * 1024 * 1024) { setScanStatus('Receipt is over the 25MB limit.', 'error'); return; }
    var u = uid();
    if (!u) { setScanStatus('Sign in required.', 'error'); return; }
    if (btn) btn.disabled = true;
    try {
      if (!_scannedPath) {
        setScanStatus('Uploading…');
        _scannedPath = await uploadReceipt(file, u);
      }
      setScanStatus('Reading the receipt with AI…');
      var call = await ensureReceiptCallable();
      var res = await call({ storagePath: _scannedPath });
      var d = res && res.data;
      if (!d || d.skipped) {
        var reason = d && d.reason;
        setScanStatus(
          reason === 'unsupported-format' ? 'That image format can’t be auto-read — enter the details manually.'
          : reason === 'user-cap' ? 'Monthly AI limit reached — enter the details manually.'
          : 'Couldn’t scan this one — enter the details manually.', 'warn');
        return;
      }
      applyExtraction(d);
    } catch (e) {
      console.warn('[expenses] scan failed', e);
      setScanStatus('Scan failed — enter the details manually (the receipt is still attached).', 'error');
    } finally { if (btn) btn.disabled = false; }
  }

  async function openReceipt(path) {
    if (!path || !window.getDownloadURL || !window.ref) return;
    try {
      var url = await window.getDownloadURL(window.ref(window.storage, path));
      window.open(url, '_blank', 'noopener');
    } catch (e) { toast('Could not open receipt', 'error'); }
  }

  // ── pure aggregation (exported for tests) ───────────────────────────
  function aggregate(list) {
    list = list || [];
    var c = EC();
    var totalCents = 0, directCents = 0, overheadCents = 0;
    var bySupplier = {}, byCategory = {}, byJob = {};
    list.forEach(function (e) {
      var cents = parseInt(e.amountCents, 10) || 0;
      var ct = e.costType || (c ? c.costTypeFor(e.category) : 'overhead');
      totalCents += cents;
      if (ct === 'direct') directCents += cents; else overheadCents += cents;

      var sup = (e.supplier || '').trim() || 'Unknown';
      bySupplier[sup] = (bySupplier[sup] || 0) + cents;

      var cat = e.category || 'uncategorized';
      byCategory[cat] = (byCategory[cat] || 0) + cents;

      var job = e.leadId || '__unassigned__';
      if (!byJob[job]) byJob[job] = { cents: 0, directCents: 0, count: 0 };
      byJob[job].cents += cents;
      if (ct === 'direct') byJob[job].directCents += cents;
      byJob[job].count += 1;
    });
    var suppliers = Object.keys(bySupplier).map(function (k) {
      return { supplier: k, cents: bySupplier[k], pct: totalCents ? (bySupplier[k] / totalCents * 100) : 0 };
    }).sort(function (a, b) { return b.cents - a.cents; });
    var categories = Object.keys(byCategory).map(function (k) {
      return { category: k, label: c ? c.labelFor(k) : k, cents: byCategory[k], pct: totalCents ? (byCategory[k] / totalCents * 100) : 0 };
    }).sort(function (a, b) { return b.cents - a.cents; });
    return {
      totalCents: totalCents, directCents: directCents, overheadCents: overheadCents,
      supplierCount: suppliers.length, suppliers: suppliers, categories: categories, byJob: byJob
    };
  }

  // Per-job gross margin from the expense ledger, via the existing margin
  // engine. Returns null when revenue or ProfitTracker is unavailable.
  function jobMargin(lead, jobExpenses) {
    if (!lead || !window.ProfitTracker || !window.ProfitTracker.computeJobPLWithExpenses) return null;
    var c = EC();
    var rev = c ? c.getJobRevenue(lead) : (parseFloat(lead.jobValue) || 0);
    if (!(rev > 0)) return null;
    return window.ProfitTracker.computeJobPLWithExpenses(lead, jobExpenses || []);
  }

  function leadById(id) { return (window._leads || []).find(function (l) { return l.id === id; }) || null; }
  function leadName(l) {
    if (!l) return 'Unknown job';
    var n = (l.name || ((l.firstName || '') + ' ' + (l.lastName || '')).trim());
    return n || l.address || 'Unnamed job';
  }

  // ── render ──────────────────────────────────────────────────────────
  function bar(pct, color) {
    return '<div style="height:6px;background:var(--s2,rgba(255,255,255,.06));border-radius:4px;overflow:hidden;margin-top:4px;">' +
      '<div style="height:100%;width:' + Math.max(2, Math.min(100, pct)).toFixed(1) + '%;background:' + color + ';"></div></div>';
  }

  function render() {
    var scroll = document.querySelector('#view-expenses .view-scroll');
    if (!scroll) return;
    var agg = aggregate(_expenses);
    var accent = '#e8720c';

    var html = '';
    // Header
    html += '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:18px;">' +
      '<div><h2 style="margin:0;font-family:\'Barlow Condensed\',sans-serif;font-size:26px;font-weight:800;color:var(--h,#fff);">🧾 Expenses &amp; Supplier Spend</h2>' +
      '<div style="font-size:12px;color:var(--m,#9ca3af);margin-top:2px;">' + (isStaff() && claims().companyId ? 'Team-wide (all reps)' : 'Your expenses') + ' · ' + _expenses.length + ' logged</div></div>' +
      '<div style="display:flex;gap:8px;">' +
        (_expenses.length ? '<button data-exp-action="export-csv" title="Download CSV for your accountant" style="padding:10px 14px;background:var(--s2,rgba(255,255,255,.06));color:var(--h,#fff);border:1px solid var(--br,rgba(255,255,255,.15));border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;">⬇ Export CSV</button>' : '') +
        '<button data-exp-action="open-form" style="padding:10px 18px;background:' + accent + ';color:#fff;border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;">+ Log Expense</button>' +
      '</div>' +
      '</div>';

    // Summary cards
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px;">';
    html += card('Total Spend', money(agg.totalCents), agg.supplierCount + ' suppliers', accent);
    html += card('Direct / Job Costs', money(agg.directCents), 'COGS — feeds margin', '#16a34a');
    html += card('Overhead', money(agg.overheadCents), 'Operating costs', '#3b82f6');
    html += '</div>';

    if (_expenses.length === 0) {
      html += '<div style="text-align:center;padding:48px 20px;color:var(--m,#9ca3af);border:1px dashed var(--br,rgba(255,255,255,.12));border-radius:12px;">' +
        '<div style="font-size:40px;margin-bottom:10px;">🧾</div>' +
        '<div style="font-size:15px;color:var(--h,#fff);font-weight:700;margin-bottom:4px;">No expenses yet</div>' +
        '<div style="font-size:13px;">Log your first material or supplier cost to start tracking spend and job margin.</div></div>';
      scroll.innerHTML = html;
      return;
    }

    // Two-column: supplier spend + category breakdown
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:20px;">';
    // Supplier spend (the explicit ask)
    html += '<div style="background:var(--s,#1a1a2e);border:1px solid var(--br,rgba(255,255,255,.08));border-radius:12px;padding:16px;">' +
      '<h3 style="margin:0 0 12px;font-size:14px;color:var(--h,#fff);">Spend by Supplier</h3>';
    agg.suppliers.slice(0, 8).forEach(function (s) {
      html += '<div style="margin-bottom:10px;">' +
        '<div style="display:flex;justify-content:space-between;font-size:13px;color:var(--h,#fff);">' +
        '<span>' + esc(s.supplier) + '</span><span style="font-weight:700;">' + money(s.cents) + '</span></div>' +
        '<div style="font-size:11px;color:var(--m,#9ca3af);">' + s.pct.toFixed(0) + '% of total</div>' +
        bar(s.pct, accent) + '</div>';
    });
    html += '</div>';
    // Category breakdown
    html += '<div style="background:var(--s,#1a1a2e);border:1px solid var(--br,rgba(255,255,255,.08));border-radius:12px;padding:16px;">' +
      '<h3 style="margin:0 0 12px;font-size:14px;color:var(--h,#fff);">Spend by Category</h3>';
    agg.categories.forEach(function (cat) {
      html += '<div style="margin-bottom:10px;">' +
        '<div style="display:flex;justify-content:space-between;font-size:13px;color:var(--h,#fff);">' +
        '<span>' + esc(cat.label) + '</span><span style="font-weight:700;">' + money(cat.cents) + '</span></div>' +
        bar(cat.pct, '#3b82f6') + '</div>';
    });
    html += '</div>';
    html += '</div>';

    // Per-job rollup with margin
    var jobIds = Object.keys(agg.byJob).filter(function (k) { return k !== '__unassigned__'; });
    if (jobIds.length) {
      html += '<div style="background:var(--s,#1a1a2e);border:1px solid var(--br,rgba(255,255,255,.08));border-radius:12px;padding:16px;margin-bottom:20px;">' +
        '<h3 style="margin:0 0 12px;font-size:14px;color:var(--h,#fff);">Cost &amp; Margin by Job</h3>';
      jobIds.map(function (jid) {
        var jb = agg.byJob[jid];
        var lead = leadById(jid);
        var jobExp = _expenses.filter(function (e) { return e.leadId === jid; });
        var pl = jobMargin(lead, jobExp);
        return { jid: jid, jb: jb, lead: lead, pl: pl };
      }).sort(function (a, b) { return b.jb.cents - a.jb.cents; }).forEach(function (row) {
        var mColor = !row.pl ? 'var(--m,#9ca3af)' : row.pl.grossMargin >= 40 ? '#16a34a' : row.pl.grossMargin >= 25 ? '#eab308' : '#dc2626';
        var marginTxt = row.pl ? (row.pl.grossMargin + '% margin') : (row.lead ? 'set Job Value' : 'job not found');
        // Estimated-vs-actual (V2 estimates only)
        var va = estVsActual(row.jid, row.jb.directCents);
        var vaTxt = '';
        if (va) {
          var over = va.varianceCents > 0;
          var vColor = over ? '#dc2626' : '#16a34a';
          vaTxt = '<div style="font-size:11px;color:var(--m,#9ca3af);">est ' + money(va.estCents) + ' · ' +
            '<span style="color:' + vColor + ';font-weight:700;">' + (over ? '+' : '') + money(va.varianceCents) + (over ? ' over' : ' under') + '</span></div>';
        }
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-top:1px solid var(--br,rgba(255,255,255,.06));">' +
          '<div style="min-width:0;"><div style="font-size:13px;color:var(--h,#fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(leadName(row.lead)) + '</div>' +
          '<div style="font-size:11px;color:var(--m,#9ca3af);">' + row.jb.count + ' expenses · ' + money(row.jb.directCents) + ' direct</div>' + vaTxt + '</div>' +
          '<div style="text-align:right;white-space:nowrap;"><div style="font-size:14px;font-weight:700;color:var(--h,#fff);">' + money(row.jb.cents) + '</div>' +
          '<div style="font-size:11px;font-weight:700;color:' + mColor + ';">' + marginTxt + '</div></div></div>';
      });
      html += '<div style="font-size:10px;color:var(--m,#9ca3af);margin-top:10px;">Gross margin = Job Value − direct job costs (before overhead &amp; commission). "est" = budgeted cost from the job\'s estimate (V2 builder only).</div>';
      html += '</div>';
    }

    // Recent expense list
    html += '<div style="background:var(--s,#1a1a2e);border:1px solid var(--br,rgba(255,255,255,.08));border-radius:12px;padding:16px;">' +
      '<h3 style="margin:0 0 12px;font-size:14px;color:var(--h,#fff);">Recent Expenses</h3>';
    _expenses.slice(0, 60).forEach(function (e) {
      var lead = e.leadId ? leadById(e.leadId) : null;
      html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--br,rgba(255,255,255,.06));">' +
        '<div style="min-width:0;flex:1;">' +
        '<div style="font-size:13px;color:var(--h,#fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(e.supplier || 'Unknown') +
        ' <span style="font-size:10px;color:var(--m,#9ca3af);">· ' + esc(EC() ? EC().labelFor(e.category) : e.category) + '</span></div>' +
        '<div style="font-size:11px;color:var(--m,#9ca3af);">' + esc(fmtDate(e.date)) + (lead ? ' · ' + esc(leadName(lead)) : '') + (e.note ? ' · ' + esc(e.note) : '') + (e.source === 'ocr' ? ' · scanned' : '') + '</div></div>' +
        (e.needsReview ? '<span title="AI scan — review the amount/vendor" style="color:#eab308;font-size:13px;">⚠</span>' : '') +
        (e.receiptStoragePath ? '<button data-exp-action="receipt" data-exp-path="' + esc(e.receiptStoragePath) + '" title="View receipt" style="background:none;border:none;cursor:pointer;font-size:15px;">📎</button>' : '') +
        '<div style="font-size:14px;font-weight:700;color:var(--h,#fff);white-space:nowrap;">' + money(e.amountCents) + '</div>' +
        '<button data-exp-action="delete" data-exp-id="' + esc(e.id) + '" title="Delete" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:14px;">✕</button>' +
        '</div>';
    });
    html += '</div>';

    scroll.innerHTML = html;
  }

  function card(label, value, sub, color) {
    return '<div style="background:var(--s,#1a1a2e);border:1px solid var(--br,rgba(255,255,255,.08));border-radius:12px;padding:16px;border-top:2px solid ' + color + ';">' +
      '<div style="font-size:11px;color:var(--m,#9ca3af);text-transform:uppercase;letter-spacing:.05em;">' + esc(label) + '</div>' +
      '<div style="font-family:\'Barlow Condensed\',sans-serif;font-size:26px;font-weight:800;color:' + color + ';margin:2px 0;">' + value + '</div>' +
      '<div style="font-size:10px;color:var(--m,#9ca3af);">' + esc(sub) + '</div></div>';
  }

  // ── entry form (modal) ──────────────────────────────────────────────
  function openForm() {
    var c = EC();
    if (document.getElementById('expFormOverlay')) return;
    var cats = (c ? c.CATEGORIES : []).map(function (x) {
      return '<option value="' + esc(x.key) + '">' + esc(x.label) + (x.costType === 'direct' ? ' (job cost)' : ' (overhead)') + '</option>';
    }).join('');
    var leadOpts = '<option value="">— No job (overhead) —</option>' + (window._leads || []).slice(0, 500).map(function (l) {
      return '<option value="' + esc(l.id) + '">' + esc(leadName(l)) + '</option>';
    }).join('');
    var today = new Date().toISOString().slice(0, 10);
    var fld = 'width:100%;padding:10px;background:var(--s2,rgba(255,255,255,.04));border:1px solid var(--br,rgba(255,255,255,.1));border-radius:8px;color:var(--h,#fff);font-size:14px;box-sizing:border-box;';
    var lbl = 'font-size:11px;color:var(--m,#9ca3af);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:4px;';

    var ov = document.createElement('div');
    ov.id = 'expFormOverlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
    ov.innerHTML =
      '<div style="background:var(--s,#1a1a2e);border:1px solid var(--br,rgba(255,255,255,.12));border-radius:14px;padding:22px;max-width:440px;width:100%;max-height:90vh;overflow:auto;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;"><h3 style="margin:0;color:var(--h,#fff);font-size:18px;">Log Expense</h3>' +
        '<button data-exp-action="close-form" style="background:none;border:none;color:var(--m,#9ca3af);font-size:20px;cursor:pointer;">✕</button></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
          '<div><label style="' + lbl + '">Amount ($)</label><input id="expAmount" type="number" step="0.01" min="0" inputmode="decimal" style="' + fld + '"></div>' +
          '<div><label style="' + lbl + '">Date</label><input id="expDate" type="date" value="' + today + '" style="' + fld + '"></div>' +
          '<div><label style="' + lbl + '">Sales Tax ($)</label><input id="expTax" type="number" step="0.01" min="0" inputmode="decimal" style="' + fld + '"></div>' +
          '<div><label style="' + lbl + '">Category</label><select id="expCategory" style="' + fld + '">' + cats + '</select></div>' +
        '</div>' +
        '<div style="margin-top:12px;"><label style="' + lbl + '">Supplier / Vendor</label><input id="expSupplier" type="text" maxlength="120" placeholder="e.g. ABC Supply" style="' + fld + '"></div>' +
        '<div style="margin-top:12px;"><label style="' + lbl + '">Job (optional)</label><select id="expLead" style="' + fld + '">' + leadOpts + '</select></div>' +
        '<div style="margin-top:12px;"><label style="' + lbl + '">Note (optional)</label><input id="expNote" type="text" maxlength="500" style="' + fld + '"></div>' +
        '<div style="margin-top:12px;"><label style="' + lbl + '">Receipt (image / PDF, optional)</label>' +
          '<div style="display:flex;gap:8px;align-items:center;">' +
            '<input id="expFile" type="file" accept="image/*,application/pdf" style="' + fld + 'flex:1;">' +
            '<button data-exp-action="scan" type="button" style="white-space:nowrap;padding:10px 12px;background:var(--s2,rgba(255,255,255,.06));color:var(--h,#fff);border:1px solid var(--br,rgba(255,255,255,.15));border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;">📷 Scan with AI</button>' +
          '</div>' +
          '<div id="expScanStatus" style="font-size:11px;color:var(--m,#9ca3af);margin-top:6px;min-height:14px;"></div>' +
        '</div>' +
        '<button data-exp-action="save" style="width:100%;margin-top:18px;padding:12px;background:#e8720c;color:#fff;border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;">Save Expense</button>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (ev) { if (ev.target === ov) closeForm(); });
    var amt = document.getElementById('expAmount');
    if (amt) amt.focus();
  }
  function closeForm() {
    var ov = document.getElementById('expFormOverlay');
    if (ov) ov.remove();
    _scannedPath = null;
    _scanExtraction = null;
  }
  async function saveFromForm(btn) {
    var v = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
    var fileEl = document.getElementById('expFile');
    var c = EC();
    // Duplicate guard: same supplier + amount + day already logged → confirm.
    var dupCents = c ? c.dollarsToCents(v('expAmount')) : 0;
    var dup = findDuplicate(v('expSupplier'), dupCents, v('expDate'));
    if (dup && !window.confirm('Looks like a possible duplicate — ' + (v('expSupplier') || 'this vendor') + ' for ' + money(dupCents) + ' on ' + v('expDate') + ' is already logged. Save it anyway?')) {
      return;
    }
    // If the receipt was scanned, the doc carries the OCR provenance + the
    // already-uploaded path (no double upload), and the user's edits to the
    // pre-filled fields win.
    var scanned = _scanExtraction && _scannedPath;
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    var ok = await createExpense({
      amount: v('expAmount'),
      tax: v('expTax'),
      date: v('expDate'),
      supplier: v('expSupplier'),
      category: v('expCategory'),
      leadId: v('expLead'),
      note: v('expNote'),
      file: fileEl && fileEl.files && fileEl.files[0],
      uploadedPath: _scannedPath || null,
      source: scanned ? 'ocr' : 'manual',
      ocrConfidence: scanned && _scanExtraction.extracted ? _scanExtraction.extracted.confidence : null,
      needsReview: scanned ? !!_scanExtraction.needsReview : false
    });
    if (ok) { closeForm(); await refresh(); }
    else if (btn) { btn.disabled = false; btn.textContent = 'Save Expense'; }
  }

  // ── lifecycle ───────────────────────────────────────────────────────
  async function refresh() {
    var results = await Promise.all([fetchExpenses(), fetchEstimateCosts()]);
    _expenses = results[0];
    _loaded = true;
    render();
  }
  function init() {
    var scroll = document.querySelector('#view-expenses .view-scroll');
    if (scroll && !_loaded) scroll.innerHTML = '<div style="padding:40px;text-align:center;color:var(--m,#9ca3af);">Loading expenses…</div>';
    refresh();
  }

  // ── CSV export (accountant-ready; do this BEFORE any QuickBooks/Xero API) ──
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCSV() {
    var c = EC();
    if (!_expenses.length) { toast('No expenses to export', 'warn'); return; }
    var cols = ['Date', 'Supplier', 'Category', 'Cost Type', 'Amount', 'Sales Tax', 'Job', 'Note', 'Source', 'Schedule C (suggested)'];
    var rows = _expenses.map(function (e) {
      var d = toDate(e.date);
      var lead = e.leadId ? leadById(e.leadId) : null;
      var hint = (c && c.byKey[e.category] && c.byKey[e.category].scheduleCHint) || '';
      return [
        d ? d.toISOString().slice(0, 10) : '',
        e.supplier || '',
        (c ? c.labelFor(e.category) : e.category) || '',
        e.costType || '',
        ((parseInt(e.amountCents, 10) || 0) / 100).toFixed(2),
        ((parseInt(e.taxCents, 10) || 0) / 100).toFixed(2),
        lead ? leadName(lead) : '',
        e.note || '',
        e.source || 'manual',
        hint
      ].map(csvCell).join(',');
    });
    var csv = cols.join(',') + '\n' + rows.join('\n');
    try {
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'nbd-expenses-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 1000);
      toast('Exported ' + _expenses.length + ' expenses', 'ok');
    } catch (e) { console.warn('[expenses] csv export failed', e); toast('Export failed', 'error'); }
  }

  // ── CSP-safe delegated events ───────────────────────────────────────
  if (!window._NBD_EXP_DELEGATE) {
    window._NBD_EXP_DELEGATE = true;
    document.addEventListener('click', function (ev) {
      var t = ev.target.closest && ev.target.closest('[data-exp-action]');
      if (!t) return;
      var a = t.dataset.expAction;
      if (a === 'open-form') openForm();
      else if (a === 'close-form') closeForm();
      else if (a === 'export-csv') exportCSV();
      else if (a === 'scan') scanReceipt(t);
      else if (a === 'save') saveFromForm(t);
      else if (a === 'receipt') openReceipt(t.dataset.expPath);
      else if (a === 'delete') {
        var id = t.dataset.expId;
        if (id && window.confirm('Delete this expense? This cannot be undone.')) {
          removeExpense(id).then(function (done) { if (done) refresh(); });
        }
      }
    });
  }

  window.Expenses = {
    init: init,
    render: render,
    refresh: refresh,
    // data-layer (used by Phase 2 OCR + future surfaces)
    createExpense: createExpense,
    removeExpense: removeExpense,
    exportCSV: exportCSV,
    // pure functions (exported for unit tests)
    aggregate: aggregate,
    jobMargin: jobMargin,
    estVsActual: estVsActual,
    findDuplicate: findDuplicate,
    csvCell: csvCell,
    _setData: function (list) { _expenses = list || []; _loaded = true; }, // test/seed hook
    _setEstCosts: function (map) { _estCostByLead = map || {}; }            // test/seed hook
  };
})();
