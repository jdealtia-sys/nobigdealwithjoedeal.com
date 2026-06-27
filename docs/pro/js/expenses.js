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

  async function uploadReceipt(file, u) {
    if (!window.storage || !window.ref || !window.uploadBytes) throw new Error('storage unavailable');
    var ts = Date.now();
    var safe = (file.name || 'receipt').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    var path = 'receipts/' + u + '/' + ts + '_' + safe;
    await window.uploadBytes(window.ref(window.storage, path), file, { contentType: file.type || 'application/octet-stream' });
    return path;
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
    if (form.file) {
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
      source: 'manual',
      needsReview: false,
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
      '<button data-exp-action="open-form" style="padding:10px 18px;background:' + accent + ';color:#fff;border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;">+ Log Expense</button>' +
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
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-top:1px solid var(--br,rgba(255,255,255,.06));">' +
          '<div style="min-width:0;"><div style="font-size:13px;color:var(--h,#fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(leadName(row.lead)) + '</div>' +
          '<div style="font-size:11px;color:var(--m,#9ca3af);">' + row.jb.count + ' expenses · ' + money(row.jb.directCents) + ' direct</div></div>' +
          '<div style="text-align:right;white-space:nowrap;"><div style="font-size:14px;font-weight:700;color:var(--h,#fff);">' + money(row.jb.cents) + '</div>' +
          '<div style="font-size:11px;font-weight:700;color:' + mColor + ';">' + marginTxt + '</div></div></div>';
      });
      html += '<div style="font-size:10px;color:var(--m,#9ca3af);margin-top:10px;">Gross margin = Job Value − direct job costs (before overhead &amp; commission).</div>';
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
        '<div style="font-size:11px;color:var(--m,#9ca3af);">' + esc(fmtDate(e.date)) + (lead ? ' · ' + esc(leadName(lead)) : '') + (e.note ? ' · ' + esc(e.note) : '') + '</div></div>' +
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
        '</div>' +
        '<div style="margin-top:12px;"><label style="' + lbl + '">Supplier / Vendor</label><input id="expSupplier" type="text" maxlength="120" placeholder="e.g. ABC Supply" style="' + fld + '"></div>' +
        '<div style="margin-top:12px;"><label style="' + lbl + '">Category</label><select id="expCategory" style="' + fld + '">' + cats + '</select></div>' +
        '<div style="margin-top:12px;"><label style="' + lbl + '">Job (optional)</label><select id="expLead" style="' + fld + '">' + leadOpts + '</select></div>' +
        '<div style="margin-top:12px;"><label style="' + lbl + '">Note (optional)</label><input id="expNote" type="text" maxlength="500" style="' + fld + '"></div>' +
        '<div style="margin-top:12px;"><label style="' + lbl + '">Receipt (image / PDF, optional)</label><input id="expFile" type="file" accept="image/*,application/pdf" style="' + fld + '"></div>' +
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
  }
  async function saveFromForm(btn) {
    var v = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
    var fileEl = document.getElementById('expFile');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    var ok = await createExpense({
      amount: v('expAmount'),
      date: v('expDate'),
      supplier: v('expSupplier'),
      category: v('expCategory'),
      leadId: v('expLead'),
      note: v('expNote'),
      file: fileEl && fileEl.files && fileEl.files[0]
    });
    if (ok) { closeForm(); await refresh(); }
    else if (btn) { btn.disabled = false; btn.textContent = 'Save Expense'; }
  }

  // ── lifecycle ───────────────────────────────────────────────────────
  async function refresh() {
    _expenses = await fetchExpenses();
    _loaded = true;
    render();
  }
  function init() {
    var scroll = document.querySelector('#view-expenses .view-scroll');
    if (scroll && !_loaded) scroll.innerHTML = '<div style="padding:40px;text-align:center;color:var(--m,#9ca3af);">Loading expenses…</div>';
    refresh();
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
    // pure functions (exported for unit tests)
    aggregate: aggregate,
    jobMargin: jobMargin,
    _setData: function (list) { _expenses = list || []; _loaded = true; } // test/seed hook
  };
})();
