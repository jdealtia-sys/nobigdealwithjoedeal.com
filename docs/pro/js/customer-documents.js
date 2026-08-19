// ── Customer Documents — the single source of truth ─────────────────
//
// WHY THIS MODULE EXISTS (2026-08-18)
//
// The customer page had FOUR "documents" surfaces reading THREE different
// Firestore locations, and the one location documents actually land in was
// read by only one of them:
//
//   Overview → Documents (#docList)      read top-level `documents`
//   Documents tab → Shared (#sharedDocList)  read `lead_documents`
//   Documents tab → Generated (#generatedDocList)  read nothing (DOM-only)
//   Documents tab → #signedDocsList      read leads/{id}/documents  ← the real one
//
// Every real writer — the document generator, the signed-doc upload, and
// drag-and-drop — writes to `leads/{leadId}/documents`. So a customer with
// a stack of generated contracts and invoices showed "No documents yet" on
// the Overview, an empty "Shared Documents" panel (nothing in the client or
// in functions/ has EVER written `lead_documents`), and a "Generated
// Documents" list that was pure DOM and vanished on reload. The only honest
// panel was buried under the upload buttons — and it ran off a
// `setTimeout(…, 2000)` at DOMContentLoaded, so on a cold load it fired
// before window._customerId existed and silently gave up forever.
//
// This module owns the store: one read, one normalized shape, one cache,
// every surface painted from it. Loaders elsewhere delegate here. It is
// called from loadCustomerData() with the real lead id — no timers, no race.
//
// Legacy rows in the top-level `documents` collection (written by the old
// Overview upload modal before the subcollection existed) are merged in on a
// best-effort second read so nothing that predates the consolidation is
// orphaned. They carry `legacy: true` so deletes target the right path.
(function () {
  'use strict';

  var LEAD_SUB = 'documents';          // leads/{leadId}/documents  (canonical)
  var LEGACY_TOP = 'documents';        // top-level, {leadId, userId}  (historical)

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Firestore Timestamp | ISO string | Date | null → Date | null
  function toDate(v) {
    if (!v) return null;
    if (typeof v.toDate === 'function') { try { return v.toDate(); } catch (e) { return null; } }
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  // The three writers stamp three different field names for the same thing.
  // Generated docs: {filename, typeName, htmlUrl, createdAt}. Signed/DnD
  // uploads: {name, url, uploadedAt}. Legacy top-level: {filename, url,
  // uploadedAt}. Normalize once here so no renderer has to know that.
  function normalize(id, d, legacy) {
    var url = d.url || d.htmlUrl || d.signedDocumentUrl || '';
    var signedAt = toDate(d.signedAt);
    return {
      id: id,
      legacy: !!legacy,
      name: d.name || d.filename || d.typeName || 'Document',
      // `type` is only present on generator output — it is what separates a
      // generated contract from an uploaded scan.
      docType: d.type && !/\//.test(String(d.type)) ? d.type : null,
      typeName: d.typeName || null,
      generated: !!(d.typeName || (d.type && !/\//.test(String(d.type)))),
      url: /^https?:/i.test(url) ? url : '',
      size: Number.isFinite(+d.size) ? +d.size : null,
      date: toDate(d.uploadedAt) || toDate(d.createdAt) || toDate(d.date) || signedAt,
      signed: !!(d.signedRemotely || d.signedAt || /signed/i.test(String(d.source || ''))),
      signedAt: signedAt,
      source: d.source || null,
      deleted: d.deleted === true
    };
  }

  // ── Read ──────────────────────────────────────────────────────────
  //
  // The canonical subcollection read is UNFILTERED and unordered on
  // purpose: it needs no composite index (so it cannot fail closed the way
  // an index-less query does) and the collection is per-lead and small.
  // Sorting and the soft-delete filter happen in memory below.
  async function fetchAll(leadId) {
    if (!leadId || !window.db || !window.getDocs || !window.collection) return [];
    var rows = [];

    try {
      var snap = await window.getDocs(
        window.collection(window.db, 'leads', leadId, LEAD_SUB)
      );
      snap.docs.forEach(function (d) { rows.push(normalize(d.id, d.data(), false)); });
    } catch (e) {
      // A failure here is a REAL failure — surface it rather than letting the
      // caller paint an empty state that looks like "this customer has none".
      console.error('[customer-documents] subcollection read failed:', e && e.message);
      throw e;
    }

    // Legacy top-level rows. Best-effort: a missing index or a tightened
    // rule must not take down the canonical list.
    try {
      var uid = window.auth && window.auth.currentUser && window.auth.currentUser.uid;
      if (uid && window.query && window.where) {
        var legacySnap = await window.getDocs(window.query(
          window.collection(window.db, LEGACY_TOP),
          window.where('leadId', '==', leadId),
          window.where('userId', '==', uid)
        ));
        legacySnap.docs.forEach(function (d) { rows.push(normalize(d.id, d.data(), true)); });
      }
    } catch (e) {
      console.warn('[customer-documents] legacy read skipped:', e && e.message);
    }

    return rows
      .filter(function (r) { return !r.deleted; })
      .sort(function (a, b) {
        return (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0);
      })
      .filter(dedupe());
  }

  // A document migrated from the top-level collection into the subcollection
  // exists in BOTH reads, and without this it renders twice on the record.
  //
  // The key is the Storage URL, NOT the name. Two rows pointing at the same
  // object are the same document by any reading; two rows sharing a filename
  // are NOT necessarily the same file, and collapsing those would HIDE a real
  // document. Hiding one is far worse than showing one twice — that asymmetry
  // is why this errs toward keeping rows. Rows with no URL are never deduped,
  // because there is nothing to prove sameness with.
  //
  // Applied after the sort, so the survivor is the newest of the pair; and
  // canonical rows win ties over legacy ones, since deletes and every future
  // write target the subcollection.
  function dedupe() {
    var seen = Object.create(null);
    return function (r) {
      if (!r.url) return true;
      var prior = seen[r.url];
      if (!prior) { seen[r.url] = r; return true; }
      // Already kept one. If we kept the legacy copy and this is canonical,
      // swap in place so the retained row is the one deletes can reach.
      if (prior.legacy && !r.legacy) {
        prior.id = r.id;
        prior.legacy = false;
      }
      return false;
    };
  }

  // ── Render ────────────────────────────────────────────────────────
  var ICONS = {
    proposal: '📄', contract: '📝', work_authorization: '✅', scope_of_work: '📋',
    invoice: '💰', estimate: '💰', warranty: '✅', insurance: '📋',
    inspectionHomeowner: '🔍', inspectionInsurance: '🔍'
  };

  function iconFor(doc) {
    return ICONS[doc.docType] || (doc.generated ? '📝' : '📄');
  }

  function metaLine(doc) {
    var bits = [];
    if (doc.date) bits.push(doc.date.toLocaleDateString());
    if (doc.size != null) bits.push((doc.size / 1024).toFixed(0) + ' KB');
    if (doc.signed) {
      bits.push('✓ Signed' + (doc.signedAt ? ' ' + doc.signedAt.toLocaleDateString() : ''));
    } else if (doc.source === 'signed_upload' || doc.source === 'dnd_upload') {
      bits.push('Uploaded');
    }
    return bits.join(' · ');
  }

  // One row shape everywhere. CSP: no inline handlers — the View link is a
  // plain anchor (scheme-validated in normalize) and delete routes through
  // the page's data-action delegate.
  function rowHtml(doc) {
    var label = esc(doc.name);
    return '<div class="doc-item" data-doc-id="' + esc(doc.id) + '">'
      + '<div class="doc-icon">' + iconFor(doc) + '</div>'
      + '<div class="doc-content" style="min-width:0;">'
      + (doc.typeName || doc.docType
          ? '<div class="doc-type">' + esc(doc.typeName || doc.docType) + '</div>' : '')
      + '<div class="doc-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + label + '</div>'
      + '<div class="doc-date">' + esc(metaLine(doc)) + '</div>'
      + '</div>'
      + '<div class="doc-actions">'
      + (doc.url
          ? '<a href="' + esc(doc.url) + '" target="_blank" rel="noopener noreferrer" class="doc-btn">View</a>'
          : '')
      + '<button type="button" class="btn" data-action="deleteCustomerDoc"'
      + ' data-arg="' + esc(doc.id) + '" data-arg2="' + label + '"'
      + ' title="Remove this document from the customer record"'
      + ' style="background:none;border:none;cursor:pointer;color:var(--m);font-size:13px;line-height:1;padding:4px 6px;">&#10005;</button>'
      + '</div>'
      + '</div>';
  }

  function emptyHtml(message, withCreate) {
    return '<div class="empty">'
      + '<div class="empty-icon">📄</div>' + esc(message)
      + (withCreate
          ? '<div style="margin-top:14px;"><button class="btn btn-orange" data-action="openDocCreateModal"'
            + ' style="font-size:11px;padding:8px 16px;">📝 Create your first document</button></div>'
          : '')
      + '</div>';
  }

  function paint(elId, docs, emptyMsg, withCreate) {
    var el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = docs.length
      ? docs.map(rowHtml).join('')
      : emptyHtml(emptyMsg, withCreate);
  }

  // Every surface, painted from the one cache.
  function render() {
    var docs = window._customerDocs || [];

    // Overview — everything this customer has.
    paint('docList', docs, 'No documents yet', true);

    // Documents tab — split by origin so each panel means something.
    paint('generatedDocList', docs.filter(function (d) { return d.generated; }),
      'Generate a document above to see it here', false);
    paint('signedDocsList', docs.filter(function (d) { return !d.generated; }),
      'No uploaded documents yet', false);

    if (typeof window.nbdNavCount === 'function') window.nbdNavCount('navCountDocs', docs.length);
    if (typeof window.nbdTitleCount === 'function') window.nbdTitleCount('docsPanelTitle', 'Documents', docs.length);
  }

  function paintError() {
    ['docList', 'generatedDocList', 'signedDocsList'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      // Never render "No documents yet" on a failed read — that is the lie
      // that hid this bug for so long. Say the load failed.
      el.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div>'
        + 'Could not load documents — refresh to try again</div>';
    });
  }

  // ── Public API ────────────────────────────────────────────────────
  var _inflight = null;

  async function load(leadId) {
    var id = leadId || window._customerId;
    if (!id) return [];
    try {
      _inflight = fetchAll(id);
      window._customerDocs = await _inflight;
      render();
      return window._customerDocs;
    } catch (e) {
      window._customerDocs = [];
      paintError();
      return [];
    } finally {
      _inflight = null;
    }
  }

  function refresh() { return load(window._customerId); }

  // SOFT delete, deliberately: the Firestore row survives with
  // `deleted: true`, so a misclick is recoverable and the record of what was
  // generated is not rewritten. fetchAll filters it out. The Storage object
  // is left alone — anyone holding a link you already sent still resolves
  // it, which is the honest behaviour for a document that may already be in
  // a homeowner's inbox.
  window.deleteCustomerDoc = async function (docId, label) {
    if (!docId || !window._customerId) return;
    var name = label || 'this document';
    var ask = window.nbdConfirm || function (m) { return Promise.resolve(window.confirm(m)); };
    var okToDelete = await ask('Remove "' + name + '" from this customer record?\n\n'
      + 'It stops showing on the record. Anyone you already sent the link to can still open it.');
    if (!okToDelete) return;

    // Legacy rows live in the top-level collection; canonical ones in the
    // lead subcollection. Target whichever this id came from.
    var entry = (window._customerDocs || []).filter(function (d) { return d.id === docId; })[0];
    var ref = entry && entry.legacy
      ? window.doc(window.db, LEGACY_TOP, docId)
      : window.doc(window.db, 'leads', window._customerId, LEAD_SUB, docId);

    try {
      await window.updateDoc(ref, { deleted: true, deletedAt: new Date().toISOString() });
      if (typeof showToast === 'function') showToast('Document removed', 'success');
      await refresh();
    } catch (e) {
      console.error('deleteCustomerDoc failed:', e);
      if (typeof showToast === 'function') showToast('Could not remove: ' + (e.message || 'unknown'), 'error');
    }
  };

  window.NBDCustomerDocs = {
    load: load,
    refresh: refresh,
    render: render,
    fetchAll: fetchAll,
    normalize: normalize
  };

  // The bootstrap calls window.loadDocuments(id) from loadCustomerData once
  // the lead is resolved. That is the ONLY entry point — no DOMContentLoaded
  // timer, so there is nothing to race.
  window.loadDocuments = load;
})();
