(function () {
  'use strict';

  // Endpoint base — same host that serves the other functions.
  const FUNCTIONS_BASE = 'https://us-central1-nobigdeal-pro.cloudfunctions.net';

  // Escape helper — every interpolated homeowner/rep field goes
  // through this. The function payload is trusted (redacted by
  // getHomeownerPortalView) but defense-in-depth is free.
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function fmtMoney(n) {
    if (n == null || isNaN(Number(n))) return '—';
    return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  function signaturePill(status) {
    if (status === 'signed') return '<span class="pill pill-green">✓ Signed</span>';
    if (status === 'sent' || status === 'viewed') return '<span class="pill pill-orange">✍ Awaiting signature</span>';
    if (status === 'declined') return '<span class="pill pill-red">Declined</span>';
    if (status === 'expired') return '<span class="pill">Expired</span>';
    return '';
  }

  function getToken() {
    try {
      const p = new URLSearchParams(location.search);
      return p.get('token') || '';
    } catch (e) { return ''; }
  }

  // NEW-D26: every interactive card (messages, rating, callback, photo
  // upload, audit events) posts `token: TOKEN` — but TOKEN was never
  // declared anywhere, so each send threw `ReferenceError: TOKEN is not
  // defined` the moment a homeowner used it. The bug predates the js/
  // extraction (the inline original had the same 5 dangling references);
  // it was simply unreachable while the whole script was CSP-dead
  // (NEW-D23). loadView() re-reads getToken() itself, so this constant
  // only serves the card senders.
  const TOKEN = getToken().trim();

  // ─── Live-poll state ────────────────────────────────────────────
  // Step 13: portal becomes "push-feeling" via 30s visibility-aware
  // polling against the same getHomeownerPortalView callable. Diffs the
  // new view against _lastView; on real changes (stage / photos /
  // messages / estimate) surfaces an inline banner before re-rendering.
  // Server changes: none. Cost: 1 callable invocation / tab / 30s while
  // the page is visible. Pauses entirely when document.hidden.
  const POLL_INTERVAL_MS = 30_000;
  let _lastView = null;
  let _pollTimer = null;
  let _pollInflight = false;

  async function _fetchView(token) {
    const res = await fetch(FUNCTIONS_BASE + '/getHomeownerPortalView', {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    return res;
  }

  async function loadView() {
    const token = getToken().trim();
    const main = document.getElementById('mainWrap');
    if (!token) {
      main.innerHTML = '<div class="error-state"><h2>No link found</h2><div>This page needs a valid token. Please open the link your rep sent you.</div></div>';
      return;
    }
    try {
      // F-06: token in POST body, not URL. Keeps the token out of
      // access logs, Referer headers, and browser history. The same
      // page URL still carries ?token= in the browser history (from
      // the emailed link) but the *server-side* log chain no longer
      // receives it.
      const res = await _fetchView(token);
      if (res.status === 410) {
        main.innerHTML = '<div class="error-state"><h2>This link has expired</h2><div>Contact your rep for a new one.</div></div>';
        return;
      }
      if (res.status === 404) {
        main.innerHTML = '<div class="error-state"><h2>We can\'t find this project</h2><div>Check the link with your rep — it may have been mistyped.</div></div>';
        return;
      }
      if (!res.ok) throw new Error('Status ' + res.status);
      const view = await res.json();
      _lastView = view;
      renderView(view);
      _showLivePill();
      _startLivePolling();
      // Audit batch 7: emit a portal_open event so the rep's
      // customer-side activity log captures the visit. Fire-and-forget;
      // never block the page on telemetry.
      _emitAuditEvent('portal_open');
    } catch (e) {
      main.innerHTML = '<div class="error-state"><h2>Couldn\'t load your project</h2><div>Please try again in a moment.</div></div>';
    }
  }

  // ─── Diff helpers ───────────────────────────────────────────────
  // Stage / progress label changes are the most important signal —
  // the rep marking "Inspection Done" → "Estimate Ready" is what the
  // homeowner is waiting on. Photos / messages are next-tier.
  function _diffView(prev, next) {
    if (!prev) return null; // first paint — nothing to announce
    const events = [];
    const pStage = (prev.progress && prev.progress.currentLabel) || '';
    const nStage = (next.progress && next.progress.currentLabel) || '';
    if (pStage && nStage && pStage !== nStage) {
      events.push({ kind: 'stage', from: pStage, to: nStage, msg: `🎉 Status update: now ${nStage}` });
    }
    const pPhotos = (prev.photos && prev.photos.length) || 0;
    const nPhotos = (next.photos && next.photos.length) || 0;
    if (nPhotos > pPhotos) {
      const added = nPhotos - pPhotos;
      events.push({ kind: 'photos', delta: added, msg: `📸 ${added} new photo${added === 1 ? '' : 's'} from your rep` });
    }
    const pMsgs = (prev.messages && prev.messages.length) || 0;
    const nMsgs = (next.messages && next.messages.length) || 0;
    if (nMsgs > pMsgs) {
      events.push({ kind: 'message', msg: `💬 New message from your rep` });
    }
    const pEstId = (prev.estimate && prev.estimate.id) || null;
    const nEstId = (next.estimate && next.estimate.id) || null;
    if (nEstId && pEstId !== nEstId) {
      events.push({ kind: 'estimate', msg: `📋 New estimate ready to review` });
    }
    return events.length ? events : null;
  }

  // ─── Banner UI ──────────────────────────────────────────────────
  // One banner at a time, slides in from the top of the page. Auto-
  // dismisses after 8s; clicking it dismisses immediately.
  function _showUpdateBanner(events) {
    if (!Array.isArray(events) || !events.length) return;
    const existing = document.getElementById('liveBanner');
    if (existing) existing.remove();
    const banner = document.createElement('div');
    banner.id = 'liveBanner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.style.cssText = 'position:fixed;top:14px;left:50%;transform:translate(-50%, -120%);background:var(--green, #2ecc8a);color:#fff;padding:12px 18px;border-radius:10px;font-weight:600;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,.18);z-index:9999;cursor:pointer;max-width:90vw;transition:transform .35s cubic-bezier(.22,.61,.36,1);';
    // Stack the messages — typically 1-2; cap at 3 lines so it can't
    // grow off-screen if a slow homeowner returns to a much-updated page.
    banner.innerHTML = events.slice(0, 3).map(e => `<div>${e.msg}</div>`).join('');
    banner.addEventListener('click', () => banner.remove());
    document.body.appendChild(banner);
    // Trigger the slide-in via rAF so the initial off-screen style applies first.
    requestAnimationFrame(() => { banner.style.transform = 'translate(-50%, 0)'; });
    setTimeout(() => {
      if (banner.parentNode) {
        banner.style.transform = 'translate(-50%, -120%)';
        setTimeout(() => banner.remove(), 400);
      }
    }, 8000);
  }

  // Tiny "🟢 Live" indicator pinned to the page corner so the homeowner
  // sees this is current data, not a snapshot. Gently pulses when a
  // poll fires so they get visual confirmation the page is alive.
  function _showLivePill() {
    if (document.getElementById('livePill')) return;
    const pill = document.createElement('div');
    pill.id = 'livePill';
    pill.style.cssText = 'position:fixed;bottom:14px;right:14px;background:rgba(0,0,0,.55);color:#fff;font-size:11px;padding:6px 10px;border-radius:999px;font-weight:500;letter-spacing:.04em;backdrop-filter:blur(6px);z-index:9998;display:flex;align-items:center;gap:6px;';
    pill.innerHTML = '<span id="livePillDot" style="width:6px;height:6px;border-radius:50%;background:#2ecc8a;display:inline-block;transition:transform .2s;"></span><span>Live</span>';
    document.body.appendChild(pill);
  }
  function _pulseLivePill() {
    const dot = document.getElementById('livePillDot');
    if (!dot) return;
    dot.style.transform = 'scale(1.8)';
    setTimeout(() => { dot.style.transform = 'scale(1)'; }, 220);
  }

  // ─── Poll loop ──────────────────────────────────────────────────
  function _startLivePolling() {
    if (_pollTimer) return; // already running
    _scheduleNextPoll();
    document.addEventListener('visibilitychange', _onVisibility);
  }

  function _scheduleNextPoll() {
    clearTimeout(_pollTimer);
    if (document.hidden) { _pollTimer = null; return; }
    _pollTimer = setTimeout(_pollOnce, POLL_INTERVAL_MS);
  }

  function _onVisibility() {
    // Tab hidden → halt timer to save battery + Cloud Function cost.
    // Tab returning → fire one immediate poll so the homeowner doesn't
    // wait 30s for the catch-up after coming back to the page.
    if (document.hidden) {
      clearTimeout(_pollTimer);
      _pollTimer = null;
    } else {
      _pollOnce();
    }
  }

  async function _pollOnce() {
    if (_pollInflight) { _scheduleNextPoll(); return; }
    _pollInflight = true;
    _pulseLivePill();
    try {
      const token = getToken().trim();
      if (!token) return;
      const res = await _fetchView(token);
      if (res.status === 410 || res.status === 404) {
        // Link revoked/expired mid-session — stop polling and surface
        // a non-destructive notice. Don't wipe the rendered view; the
        // homeowner can still see what they had.
        clearTimeout(_pollTimer);
        _pollTimer = null;
        _showUpdateBanner([{ msg: 'This link is no longer valid. Contact your rep for a fresh link.' }]);
        return;
      }
      if (!res.ok) return; // transient failure — try again on next tick
      const view = await res.json();
      const events = _diffView(_lastView, view);
      _lastView = view;
      if (events) {
        // Re-render first so the banner refers to data the user can see,
        // then show the banner. Avoids the "🎉 Status: Approved" toast
        // landing before the UI has caught up.
        renderView(view);
        _showUpdateBanner(events);
      }
    } catch (e) { /* swallow — transient network errors during polling shouldn't disrupt the page */ }
    finally {
      _pollInflight = false;
      _scheduleNextPoll();
    }
  }

  // ─── Customer-side audit logger (batch 7) ───────────────────────
  // Posts a minimal { token, type, resourceId? } payload to the
  // recordCustomerEvent Cloud Function. Token-validated server-side.
  // Fire-and-forget — telemetry should never break the page.
  function _emitAuditEvent(type, resourceId) {
    try {
      const token = getToken().trim();
      if (!token) return;
      fetch(FUNCTIONS_BASE + '/recordCustomerEvent', {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, type, resourceId: resourceId || null }),
        keepalive: true,
      }).catch(() => {});
    } catch (_) { /* never fail the page */ }
  }

  function renderView(view) {
    const firstName = (view.homeowner && view.homeowner.firstName) || '';
    const lastName  = (view.homeowner && view.homeowner.lastName)  || '';
    const fullName = (firstName + ' ' + lastName).trim();
    const address = (view.homeowner && view.homeowner.address) || '';
    const repName = (view.rep && view.rep.displayName) || 'Your Rep';
    const companyName = (view.company && view.company.name) || 'No Big Deal Home Solutions';

    // Hero
    document.getElementById('heroWrap').style.display = '';
    document.getElementById('heroCompany').textContent = companyName;
    document.getElementById('heroTitle').textContent = fullName
      ? 'Hey ' + firstName + ', here\'s your project'
      : 'Your project';
    document.getElementById('heroSub').textContent = address
      ? address + ' · managed by ' + repName
      : 'Managed by ' + repName;

    const parts = [];

    // ── Project progress timeline ──
    // 5-step homeowner-friendly milestone tracker. The server (portal.js)
    // maps the rep-side stage key (e.g. claim_filed, install_in_progress)
    // to one of: Inspection / Estimate / Contract / Installation / Complete.
    if (view.progress && Array.isArray(view.progress.milestones)) {
      const p = view.progress;
      const idx = p.currentIndex >= 0 ? p.currentIndex : 0;
      const total = p.milestones.length;
      const fillPct = total > 1 ? Math.round((idx / (total - 1)) * 100) : 0;
      const steps = p.milestones.map((m, i) => {
        const cls = i < idx ? 'done' : (i === idx ? 'current' : '');
        const symbol = i < idx ? '✓' : (i + 1);
        return '<div class="progress-step ' + cls + '">' +
                 '<div class="progress-dot">' + symbol + '</div>' +
                 '<div class="progress-step-label">' + esc(m.label) + '</div>' +
               '</div>';
      }).join('');
      const nextHtml = p.nextLabel
        ? '<div class="progress-next">' +
            '<div class="progress-next-label">Next up</div>' +
            '<div><strong>' + esc(p.nextLabel) + '</strong> · ' + esc(p.nextBlurb || '') + '</div>' +
          '</div>'
        : '<div class="progress-next" style="background:rgba(46,204,138,.1);border-color:rgba(46,204,138,.3);">' +
            '<div class="progress-next-label" style="color:var(--green);">Project complete</div>' +
            '<div>Thanks for choosing us. Your rep will reach out for a final walkthrough.</div>' +
          '</div>';
      parts.push(
        '<div class="card progress-card">' +
          '<div class="card-label">Where We Are</div>' +
          '<div class="card-title">' + esc(p.currentLabel) + '</div>' +
          '<div class="progress-track">' +
            '<div class="progress-track-fill" style="width:calc(' + fillPct + '% - 12px);"></div>' +
            steps +
          '</div>' +
          nextHtml +
        '</div>'
      );
    }

    // B6 — Reorder: when the estimate is SIGNED, booking becomes the
    // primary CTA. When it's AWAITING signature, the embedded signer
    // goes first. When neither, only the booking card shows.
    const estStatus = (view.estimate && view.estimate.signatureStatus) || 'none';
    const awaitingSign = estStatus === 'sent' || estStatus === 'viewed';
    const signedNow = estStatus === 'signed';

    // ── Estimate summary ──
    if (view.estimate) {
      const e = view.estimate;
      // Audit batch 7: the homeowner is looking at the estimate.
      // Capture as estimate_view; resourceId = estimate doc id.
      if (e.id) _emitAuditEvent('estimate_view', e.id);
      const sig = signaturePill(e.signatureStatus || 'none');
      const signedPdf = e.signedDocumentUrl
        ? '<a class="btn btn-ghost" style="margin-top:12px;" href="' + esc(e.signedDocumentUrl) + '" target="_blank" rel="noopener">📄 Download Signed Contract</a>'
        : '';
      parts.push(
        '<div class="card">' +
          '<div class="card-label">Your Estimate</div>' +
          '<div class="row">' +
            '<div>' +
              '<div class="kv-key">Total</div>' +
              '<div class="big-num">' + esc(fmtMoney(e.grandTotal)) + '</div>' +
              (e.tierName ? '<div class="kv-val" style="margin-top:6px;color:var(--muted);">' + esc(e.tierName) + '</div>' : '') +
            '</div>' +
            '<div>' +
              '<div class="kv-key">Status</div>' +
              '<div class="kv-val">' + (sig || '<span class="pill">Draft</span>') + '</div>' +
              (e.signedAt ? '<div class="kv-val" style="color:var(--muted);font-size:13px;margin-top:6px;">Signed ' + esc(new Date(e.signedAt).toLocaleDateString()) + '</div>' : '') +
              signedPdf +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }

    // ── B1: BoldSign signing embed ──
    // When the estimate is awaiting signature AND the server was
    // able to mint a signEmbedUrl, render the iframe so the
    // homeowner can sign without leaving the page.
    const signEmbedUrl = view.estimate && view.estimate.signEmbedUrl;
    if (awaitingSign && signEmbedUrl) {
      parts.push(
        '<div class="card" style="border-color:var(--orange);">' +
          '<div class="card-label">Sign Your Contract</div>' +
          '<div class="card-title">Review &amp; sign below</div>' +
          '<p style="color:var(--muted);margin:0 0 14px;">Once signed, your rep gets a confirmation and we\'ll coordinate next steps.</p>' +
          '<iframe class="cal-embed" src="' + esc(signEmbedUrl) + '" title="Sign Contract" referrerpolicy="no-referrer" allow="clipboard-write *"></iframe>' +
        '</div>'
      );
    } else if (awaitingSign && !signEmbedUrl) {
      // Awaiting but no embed — fall back to the emailed link.
      parts.push(
        '<div class="card" style="border-color:var(--orange);">' +
          '<div class="card-label">Sign Your Contract</div>' +
          '<div class="card-title">Check your email</div>' +
          '<p style="color:var(--muted);margin:0 0 14px;">We\'ve sent the signing link. If you can\'t find it, reply to any message from your rep and we\'ll re-send.</p>' +
        '</div>'
      );
    }

    // ── Booking embed ──
    if (view.bookingUrl) {
      const cuser = view.rep && view.rep.calcomUsername;
      const cslug = (view.rep && view.rep.calcomEventSlug) || 'roof-inspection';
      const embedSrc = 'https://cal.com/' + encodeURIComponent(cuser) + '/' + encodeURIComponent(cslug) + '?embed=true&theme=dark';
      const title = signedNow ? 'Book your inspection' : 'Book a Time';
      const subtitle = signedNow
        ? 'Pick a time for our crew to inspect your roof and confirm next steps.'
        : 'Your rep will confirm within the hour. Reschedule anytime from the confirmation email.';
      const borderCss = signedNow ? 'border-color:var(--green);' : '';
      parts.push(
        '<div class="card" style="' + borderCss + '">' +
          '<div class="card-label">' + (signedNow ? 'Next Step' : 'Book a Time') + '</div>' +
          '<div class="card-title">' + esc(title) + '</div>' +
          '<p style="color:var(--muted);margin:0 0 14px;">' + esc(subtitle) + '</p>' +
          '<iframe class="cal-embed" src="' + esc(embedSrc) + '" title="Schedule" loading="lazy" referrerpolicy="no-referrer"></iframe>' +
          '<div style="margin-top:10px;"><a class="btn" href="' + esc(view.bookingUrl) + '" target="_blank" rel="noopener">Open Booking Page →</a></div>' +
        '</div>'
      );
    }

    // ── Project photos gallery ──
    // Phase 5 (Output Engine): Phase tabs + Location filter chips on
    // the portal so a homeowner with 100 shared photos can scan by
    // "what's done" (After) or "where you worked" (Roof slope). Only
    // photos the rep flipped to sharedWithHomeowner reach this view
    // already (server-side filter in getHomeownerPortalView).
    const photos = Array.isArray(view.photos) ? view.photos : [];
    if (photos.length) {
      const phaseOrder = { 'Before': 0, 'During': 1, 'After': 2 };
      const sorted = photos.slice().sort(function (a, b) {
        const pa = phaseOrder[a.phase] != null ? phaseOrder[a.phase] : 1;
        const pb = phaseOrder[b.phase] != null ? phaseOrder[b.phase] : 1;
        return pa - pb;
      });

      // Stash globally so the tab/chip filter handlers can re-render.
      window._portalPhotos = sorted;
      window._portalPhotoFilter = { phase: 'all', location: 'all' };

      // Phase + location counts for tab labels and chip set.
      const phaseCount = { all: sorted.length, Before: 0, During: 0, After: 0 };
      const locCount = {};
      sorted.forEach(function (p) {
        if (p.phase === 'Before' || p.phase === 'During' || p.phase === 'After') {
          phaseCount[p.phase]++;
        }
        const loc = (p.location || (p.inferredLocation && p.inferredLocation.label) || '').trim();
        if (loc) locCount[loc] = (locCount[loc] || 0) + 1;
      });
      const phaseTabs = ['all', 'Before', 'During', 'After']
        .filter(function (k) { return phaseCount[k] > 0; })
        .map(function (k) {
          const label = k === 'all' ? 'All' : k;
          return '<button class="ph-tab" data-phase="' + esc(k) + '"' + (k === 'all' ? ' aria-pressed="true"' : '') + '>' +
                   esc(label) + ' <span class="ph-tab-count">' + phaseCount[k] + '</span>' +
                 '</button>';
        }).join('');
      const locChips = Object.keys(locCount)
        .sort(function (a, b) { return locCount[b] - locCount[a]; })
        .slice(0, 12)
        .map(function (loc) {
          return '<button class="ph-chip" data-loc="' + esc(loc) + '">' + esc(loc) + ' <span class="ph-chip-count">' + locCount[loc] + '</span></button>';
        }).join('');

      parts.push(
        '<div class="card" id="portalPhotoCard">' +
          '<div class="card-label">Project Photos</div>' +
          '<div class="card-title">' + photos.length + ' photo' + (photos.length === 1 ? '' : 's') + ' from your project</div>' +
          (phaseTabs ? '<div class="ph-tabs" role="tablist" id="portalPhaseTabs">' + phaseTabs + '</div>' : '') +
          (locChips ? '<div class="ph-chips" id="portalLocChips"><button class="ph-chip ph-chip-active" data-loc="all">All locations</button>' + locChips + '</div>' : '') +
          '<div class="ph-grid" id="portalPhotoGrid"></div>' +
          '<div class="ph-empty" id="portalPhotoEmpty" style="display:none;">No photos match these filters.</div>' +
        '</div>'
      );
    }

    // ── Wave 118: Customer photo upload card ──
    // The portal's biggest close-the-loop opportunity: let the
    // homeowner upload photos of damage/concerns without waiting
    // for an inspection. Single drag-drop or tap-to-upload, with
    // a caption + immediate confirmation.
    parts.push(
      '<div class="card" id="cuh-card" style="border:1px dashed var(--accent, #c8541a);background:rgba(200,84,26,0.04);">' +
        '<div class="card-label">📸 Show Us What You See</div>' +
        '<div class="card-title">Upload a photo</div>' +
        '<p style="color:var(--muted);margin:0 0 14px;font-size:14px;line-height:1.5;">Spotted storm damage? Mid-job concern? Want to show us the finished work? Snap a photo — your rep gets it in seconds.</p>' +
        '<input id="cuh-file" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" style="display:none;">' +
        '<button id="cuh-pick" type="button" class="btn" style="width:100%;padding:14px;font-size:15px;background:var(--accent, #c8541a);color:#fff;border:none;border-radius:8px;cursor:pointer;-webkit-tap-highlight-color:transparent;">📷 Choose a photo</button>' +
        '<div id="cuh-preview" style="display:none;margin-top:12px;"></div>' +
        '<div id="cuh-status" style="display:none;margin-top:10px;padding:10px;border-radius:6px;font-size:13px;"></div>' +
      '</div>'
    );

    // ── Rep contact card ──
    const phoneHref = view.rep && view.rep.phone ? 'tel:' + view.rep.phone.replace(/\D/g, '') : null;
    parts.push(
      '<div class="card">' +
        '<div class="card-label">Your Rep</div>' +
        '<div class="card-title">' + esc(repName) + '</div>' +
        '<div style="color:var(--muted);font-size:13px;margin-bottom:10px;">' + esc(companyName) + '</div>' +
        (phoneHref
          ? '<a class="btn btn-ghost" href="' + esc(phoneHref) + '">📞 ' + esc(view.rep.phone) + '</a>'
          : '') +
      '</div>'
    );

    // ── Wave 121: Customer rating card (only on completed jobs) ──
    // Two states:
    //   1. Already rated → show a small "You rated this 5★" recap card
    //   2. Can rate (job complete + not yet rated) → show the rater
    // Hidden entirely on jobs that aren't complete yet.
    const ratingInfo = view.rating || {};
    if (ratingInfo.canRate && !ratingInfo.submitted) {
      parts.push(
        '<div class="card" id="cr-card" style="border:1px solid var(--accent, #c8541a);background:rgba(200,84,26,0.05);">' +
          '<div class="card-label">⭐ How did we do?</div>' +
          '<div class="card-title">Rate your experience</div>' +
          '<p style="color:var(--muted);margin:0 0 14px;font-size:14px;line-height:1.5;">Your rep would love to hear how the project went. It only takes a tap.</p>' +
          '<div id="cr-stars" style="display:flex;justify-content:space-between;gap:6px;margin-bottom:14px;">' +
            [1,2,3,4,5].map(n =>
              '<button type="button" class="cr-star" data-stars="' + n + '" aria-label="' + n + ' stars" style="flex:1;padding:14px 0;border-radius:8px;border:1px solid var(--br, #2a3344);background:var(--bg, #0a1424);color:#888;font-size:24px;cursor:pointer;transition:all 120ms ease;-webkit-tap-highlight-color:transparent;">☆</button>'
            ).join('') +
          '</div>' +
          '<textarea id="cr-comment" rows="2" maxlength="500" placeholder="Tell us a bit more (optional)" style="width:100%;padding:10px;border-radius:6px;border:1px solid var(--br, #2a3344);background:var(--bg, #0a1424);color:inherit;font:inherit;font-size:13px;box-sizing:border-box;resize:vertical;margin-bottom:10px;display:none;"></textarea>' +
          '<button id="cr-send" type="button" class="btn" disabled style="width:100%;padding:13px;font-size:14px;background:var(--accent, #c8541a);color:#fff;border:none;border-radius:8px;cursor:pointer;opacity:0.55;display:none;">Send rating</button>' +
          '<div id="cr-status" style="display:none;margin-top:10px;padding:10px;border-radius:6px;font-size:13px;"></div>' +
          '<div id="cr-thanks" style="display:none;margin-top:8px;padding:14px;border-radius:8px;background:rgba(46,204,138,0.08);border:1px solid rgba(46,204,138,0.45);"></div>' +
        '</div>'
      );
    } else if (ratingInfo.submitted) {
      const stars = Number(ratingInfo.stars) || 0;
      parts.push(
        '<div class="card" style="border:1px solid var(--br, #2a3344);">' +
          '<div class="card-label">⭐ Your rating</div>' +
          '<div style="font-size:24px;letter-spacing:4px;color:#fbbf24;">' +
            '★'.repeat(stars) + '<span style="color:#444;">' + '☆'.repeat(5 - stars) + '</span>' +
          '</div>' +
          '<div style="color:var(--muted);font-size:13px;margin-top:8px;">Thanks for rating ' + esc(repName.split(' ')[0]) + '!</div>' +
        '</div>'
      );
    }

    // ── D-2.7: Before & After photo sliders ──
    // Card only renders when the server returned at least one
    // before/after pair (auto-matched by location + phase tag).
    // Each pair becomes a draggable slider — homeowner drags the
    // orange handle left/right to reveal the After over the Before.
    if (Array.isArray(view.photoPairs) && view.photoPairs.length > 0) {
      const slots = view.photoPairs.map((_, i) => '<div class="ba-slot" data-i="' + i + '"></div>').join('');
      parts.push(
        '<div class="card" id="ba-card">' +
          '<div class="card-label">📸 Before &amp; After</div>' +
          '<div class="card-title">See the transformation</div>' +
          '<p style="color:var(--muted);margin:0 0 16px;font-size:13px;line-height:1.5;">Drag the orange handle to slide between the before and after for each location.</p>' +
          '<div style="display:flex;flex-direction:column;gap:24px;">' + slots + '</div>' +
        '</div>'
      );
    }

    // ── Wave 123: Async messaging card (homeowner ↔ rep) ──
    // Always rendered. Thread loads via getPortalMessages on mount,
    // refreshes every 30s while the page is visible.
    parts.push(
      '<div class="card" id="pm-card">' +
        '<div class="card-label">💬 Message Your Rep</div>' +
        '<div class="card-title">Quick questions, anytime</div>' +
        '<p style="color:var(--muted);margin:0 0 14px;font-size:13px;line-height:1.5;">No phone tag. ' + esc(repName.split(' ')[0]) + ' will see this in their CRM.</p>' +
        '<div id="pm-thread" style="max-height:280px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:8px;background:var(--bg, #0a1424);border-radius:8px;border:1px solid var(--br, #2a3344);margin-bottom:12px;">' +
          '<div id="pm-empty" style="color:var(--muted);font-size:13px;text-align:center;padding:18px 8px;line-height:1.5;">' +
            '<div style="font-size:28px;margin-bottom:6px;">💬</div>' +
            '<div style="font-weight:600;color:inherit;margin-bottom:4px;">Start a conversation with ' + esc(repName.split(' ')[0]) + '</div>' +
            'Ask anything — pricing, scheduling, what to expect.' +
          '</div>' +
        '</div>' +
        '<textarea id="pm-text" rows="2" maxlength="2000" placeholder="Type your message… (Enter to send · Shift+Enter for new line)" style="width:100%;padding:10px;border-radius:6px;border:1px solid var(--br, #2a3344);background:var(--bg, #0a1424);color:inherit;font:inherit;font-size:14px;box-sizing:border-box;resize:vertical;margin-bottom:6px;"></textarea>' +
        '<div style="display:flex;align-items:center;justify-content:flex-end;margin-bottom:8px;">' +
          '<div id="pm-counter" style="font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums;">0 / 2000</div>' +
        '</div>' +
        '<button id="pm-send" type="button" class="btn" disabled style="width:100%;padding:12px;font-size:14px;background:var(--accent, #c8541a);color:#fff;border:none;border-radius:8px;cursor:pointer;opacity:0.55;">Send</button>' +
        '<div id="pm-status" style="display:none;margin-top:8px;padding:8px;border-radius:6px;font-size:12px;"></div>' +
      '</div>'
    );

    // ── Wave 119: Request a callback card ──
    // Companion to the call-now button: lets the homeowner pick a
    // time-window that works for them instead of playing phone tag.
    // Lands as a task on the lead so it surfaces in the rep's bell.
    parts.push(
      '<div class="card" id="cb-card">' +
        '<div class="card-label">📞 Or — Request a Callback</div>' +
        '<div class="card-title">Pick a time that works</div>' +
        '<p style="color:var(--muted);margin:0 0 14px;font-size:14px;line-height:1.5;">Busy now? Tell your rep when to call. They\'ll get the request right away.</p>' +
        '<div id="cb-slots" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">' +
          '<button type="button" class="cb-slot" data-slot="today">Today</button>' +
          '<button type="button" class="cb-slot" data-slot="tomorrow-morning">Tomorrow morning</button>' +
          '<button type="button" class="cb-slot" data-slot="tomorrow-afternoon">Tomorrow afternoon</button>' +
          '<button type="button" class="cb-slot" data-slot="tomorrow-evening">Tomorrow evening</button>' +
          '<button type="button" class="cb-slot" data-slot="weekend">This weekend</button>' +
          '<button type="button" class="cb-slot" data-slot="anytime">Anytime this week</button>' +
        '</div>' +
        '<textarea id="cb-note" rows="2" maxlength="280" placeholder="What\'s the best way to reach you? (optional)" style="width:100%;padding:10px;border-radius:6px;border:1px solid var(--br, #2a3344);background:var(--bg, #0a1424);color:inherit;font:inherit;font-size:13px;box-sizing:border-box;resize:vertical;margin-bottom:10px;"></textarea>' +
        '<button id="cb-send" type="button" class="btn" disabled style="width:100%;padding:13px;font-size:14px;background:var(--accent, #c8541a);color:#fff;border:none;border-radius:8px;cursor:pointer;opacity:0.55;">Pick a time first</button>' +
        '<div id="cb-status" style="display:none;margin-top:10px;padding:10px;border-radius:6px;font-size:13px;"></div>' +
      '</div>'
    );

    // ── Step 17: Digital Warranty Card ──
    // Rendered when the rep has generated a warranty certificate from
    // customer.html (which now persists `lead.warranty`). Acts as the
    // homeowner's permanent reference: tier, terms, contact CTA. Hidden
    // until the rep issues a cert.
    if (view.warranty) {
      const w = view.warranty;
      const tierAccent = w.tier === 'elite' ? '#111'
                       : w.tier === 'preferred' ? '#1a3260'
                       : '#c8541a';
      const installLabel = w.installDate
        ? new Date(w.installDate + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
        : '—';
      const claimBody = encodeURIComponent(
        "Hi — I have a warranty question about my roof. Cert " + (w.certNumber || '') + ". Can you call me back?"
      );
      parts.push(
        '<div class="card" id="wc-card" style="background:linear-gradient(135deg, rgba(232,114,12,.04), rgba(232,114,12,.01)); border:1px solid rgba(232,114,12,.35);">' +
          '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px;">' +
            '<div>' +
              '<div class="card-label" style="color:var(--accent,#c8541a);">🛡️ Digital Warranty Card</div>' +
              '<div class="card-title" style="margin-top:2px;">' + esc(w.tierLabel || 'NBD Lifetime Pledge') + '</div>' +
            '</div>' +
            '<div style="background:' + tierAccent + ';color:#fff;font-family:\'Barlow Condensed\',sans-serif;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;padding:5px 12px;border-radius:3px;white-space:nowrap;">' + esc(w.tier || 'standard') + '</div>' +
          '</div>' +

          (w.tierDesc ? '<p style="color:var(--text);margin:0 0 14px;font-size:13px;line-height:1.55;">' + esc(w.tierDesc) + '</p>' : '') +

          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">' +
            '<div style="background:rgba(255,255,255,.04);border:1px solid var(--br,#2a3344);border-radius:7px;padding:10px 12px;">' +
              '<div style="font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:3px;">Installed</div>' +
              '<div style="font-size:13px;font-weight:700;color:var(--text);">' + esc(installLabel) + '</div>' +
            '</div>' +
            '<div style="background:rgba(255,255,255,.04);border:1px solid var(--br,#2a3344);border-radius:7px;padding:10px 12px;">' +
              '<div style="font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:3px;">Cert No.</div>' +
              '<div style="font-size:13px;font-weight:700;color:var(--text);font-family:\'DM Mono\',monospace;">' + esc(w.certNumber || '—') + '</div>' +
            '</div>' +
          '</div>' +

          (w.work ? '<div style="background:rgba(255,255,255,.04);border:1px solid var(--br,#2a3344);border-radius:7px;padding:10px 12px;margin-bottom:14px;">' +
            '<div style="font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:3px;">Work Performed</div>' +
            '<div style="font-size:13px;color:var(--text);">' + esc(w.work) + '</div>' +
          '</div>' : '') +

          '<a href="sms:?&body=' + claimBody + '" style="display:block;text-align:center;padding:12px;background:var(--accent,#c8541a);color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:.04em;text-transform:uppercase;">🛟 Start a warranty claim</a>' +

          '<p style="font-size:11px;color:var(--muted);margin:12px 0 0;line-height:1.5;text-align:center;">Save this page or screenshot it — your permanent warranty reference.</p>' +
        '</div>'
      );
    }

    // ── Step 16: Refer a friend ──
    // Only render the card when we have a stable referral code
    // (customerId — NBD-0001 format). Leads without one are usually
    // unstamped or pre-Wave 0 stragglers; rather than build a
    // half-working link we hide the card entirely.
    const customerId = view.homeowner && view.homeowner.customerId;
    if (customerId) {
      const referLink = 'https://nobigdeal-pro.web.app/pro/refer.html?ref=' + encodeURIComponent(customerId);
      const sent = (view.referralStats && view.referralStats.sent) || 0;
      const statPill = sent > 0
        ? '<span style="background:rgba(46,204,138,.16);color:#a7f3d0;border:1px solid rgba(46,204,138,.4);font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;letter-spacing:.04em;">✓ ' + sent + ' sent your way</span>'
        : '';
      const smsBody = encodeURIComponent(
        "Hey — wanted to share my roofing guys (No Big Deal Home Solutions). They did a great job for me. " + referLink
      );
      const emailSubject = encodeURIComponent('My roofing recommendation');
      const emailBody = encodeURIComponent(
        "Hey,\n\nIf you ever need roof work, the guys who did mine were great — No Big Deal Home Solutions. Sharing my referral link below:\n\n" + referLink + "\n\nNo pressure, just thought I'd pass it along."
      );
      parts.push(
        '<div class="card" id="rf-card">' +
          '<div class="card-label">📨 Refer a friend</div>' +
          '<div class="card-title">Know someone with a beat-up roof?</div>' +
          '<p style="color:var(--muted);margin:0 0 14px;font-size:13px;line-height:1.5;">Send your neighbor our way — they get a no-pressure roof check, you get our thanks.</p>' +
          (statPill ? '<div style="margin-bottom:14px;">' + statPill + '</div>' : '') +
          '<div style="display:flex;gap:8px;margin-bottom:10px;">' +
            '<input id="rf-link" type="text" readonly value="' + esc(referLink) + '" style="flex:1;padding:10px;border-radius:6px;border:1px solid var(--br, #2a3344);background:var(--bg, #0a1424);color:inherit;font:inherit;font-size:12px;">' +
            '<button id="rf-copy" type="button" style="padding:0 14px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;background:var(--surface-2,#13243d);color:var(--text);border:1px solid var(--br, #2a3344);border-radius:6px;cursor:pointer;white-space:nowrap;">Copy</button>' +
          '</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
            '<a href="sms:?&body=' + smsBody + '" style="flex:1;min-width:120px;text-align:center;padding:10px;background:var(--accent, #c8541a);color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:.04em;">💬 Text it</a>' +
            '<a href="mailto:?subject=' + emailSubject + '&body=' + emailBody + '" style="flex:1;min-width:120px;text-align:center;padding:10px;background:var(--surface-2,#13243d);color:var(--text);border:1px solid var(--br, #2a3344);border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:.04em;">✉️ Email it</a>' +
          '</div>' +
          '<div id="rf-status" style="display:none;margin-top:10px;padding:8px 10px;border-radius:6px;font-size:12px;background:rgba(46,204,138,.12);color:#a7f3d0;border:1px solid rgba(46,204,138,.4);text-align:center;"></div>' +
        '</div>'
      );
    }

    // ── Expiry note ──
    if (view.tokenInfo && view.tokenInfo.daysRemaining != null) {
      const d = view.tokenInfo.daysRemaining;
      parts.push(
        '<div style="font-size:11px;color:var(--muted);text-align:center;padding:10px;">' +
        'This link is active for ' + d + ' more day' + (d === 1 ? '' : 's') + '.' +
        '</div>'
      );
    }

    document.getElementById('mainWrap').innerHTML = parts.join('');

    // Wave 118: wire up the customer photo upload card.
    wireUploadCard();
    // Wave 119: wire up the callback request card.
    wireCallbackCard();
    // Wave 121: wire up the rating card (no-op if not rendered).
    wireRatingCard(view);
    // Wave 123: wire up the messaging thread + compose.
    wireMessagingCard();
    // D-2.7: hydrate each before/after slot with the slider widget.
    wireBeforeAfterSliders(view);
    // Step 16: wire the Refer-a-friend Copy button (no-op when card
    // wasn't rendered, e.g. lead missing customerId).
    wireReferralCard();
    // Phase 5 (Output Engine): wire phase tabs + location chips that
    // filter the photo gallery client-side.
    wirePhotoFilters();
  }

  // ─── D-2.7: Before & After ────────────────────────────────────
  function wireBeforeAfterSliders(view) {
    if (!Array.isArray(view.photoPairs) || view.photoPairs.length === 0) return;
    if (!window.NBDBeforeAfter || typeof window.NBDBeforeAfter.render !== 'function') {
      // Script hasn't loaded yet — retry on next tick. The script tag
      // is `defer` so DOMContentLoaded normally runs first, but if the
      // view fetched faster than expected this guard catches the race.
      setTimeout(() => wireBeforeAfterSliders(view), 200);
      return;
    }
    document.querySelectorAll('#ba-card .ba-slot').forEach((slot) => {
      const i = parseInt(slot.dataset.i, 10);
      const pair = view.photoPairs[i];
      if (!pair) return;
      const beforeUrl = (pair.before && (pair.before.urls && (pair.before.urls.lg || pair.before.urls.md)) || (pair.before && pair.before.url)) || null;
      const afterUrl  = (pair.after  && (pair.after.urls  && (pair.after.urls.lg  || pair.after.urls.md))  || (pair.after  && pair.after.url))  || null;
      if (!beforeUrl || !afterUrl) return;
      window.NBDBeforeAfter.render(slot, {
        before:   { url: beforeUrl },
        after:    { url: afterUrl },
        location: pair.location || '',
        idx: i,
      });
    });
  }

  // ─── Step 16: Refer a friend ─────────────────────────────────
  function wireReferralCard() {
    const linkEl = document.getElementById('rf-link');
    const copyBtn = document.getElementById('rf-copy');
    const statusEl = document.getElementById('rf-status');
    if (!linkEl || !copyBtn) return;
    copyBtn.addEventListener('click', async () => {
      const val = linkEl.value;
      let ok = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(val);
          ok = true;
        } else {
          // Fallback for iOS standalone PWAs / older Safari that don't
          // expose navigator.clipboard outside HTTPS contexts.
          linkEl.select();
          document.execCommand('copy');
          ok = true;
        }
      } catch (_) { /* swallow — status path handles failure */ }
      if (statusEl) {
        statusEl.textContent = ok ? '✓ Link copied — paste it anywhere' : 'Copy failed — long-press the link to copy manually.';
        statusEl.style.display = 'block';
        statusEl.style.background = ok ? 'rgba(46,204,138,.12)' : 'rgba(220,38,38,.12)';
        statusEl.style.color = ok ? '#a7f3d0' : '#fca5a5';
        statusEl.style.borderColor = ok ? 'rgba(46,204,138,.4)' : 'rgba(220,38,38,.4)';
        clearTimeout(wireReferralCard._t);
        wireReferralCard._t = setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
      }
    });
  }

  // ─── Phase 5: portal photo gallery filtering ──────────────────
  // Filters the already-rendered photo grid in place. No round-trip;
  // the homeowner sees the new selection within a frame.
  function wirePhotoFilters() {
    const grid = document.getElementById('portalPhotoGrid');
    if (!grid || !Array.isArray(window._portalPhotos)) return;

    // Tile factory mirrors the original sorted-photo render so the
    // grid looks identical after a filter as it did at first paint.
    function tileHtml(p) {
      const u = (p.urls && p.urls.med) ? esc(p.urls.med) : esc(p.url || '');
      const srcset = (p.urls && p.urls.thumb && p.urls.med && p.urls.full)
        ? ' srcset="' + esc(p.urls.thumb) + ' 200w, ' + esc(p.urls.med) + ' 600w, ' + esc(p.urls.full) + ' 1600w" sizes="(max-width:520px) 30vw, 160px"'
        : '';
      const fullHref = (p.urls && p.urls.full) ? esc(p.urls.full) : u;
      // Audit batch 7: data-photo-id powers the photo_view event emission
      // via the delegated grid click handler below. Server validates token
      // → leadId binding, so a tampered photoId can't leak across leads.
      return '<a class="ph-tile" href="' + fullHref + '" target="_blank" rel="noopener" data-photo-id="' + esc(p.id || '') + '" aria-label="' + esc(p.caption || p.phase || 'Project photo') + '">' +
               '<img loading="lazy" decoding="async" src="' + u + '"' + srcset + ' alt="' + esc(p.caption || p.phase || '') + '">' +
             '</a>';
    }

    // Audit batch 7: delegated click handler emits photo_view events.
    // Single listener vs one per tile = cheaper + survives re-renders
    // from phase/location filter changes without re-binding.
    grid.addEventListener('click', function (e) {
      const tile = e.target.closest('.ph-tile');
      if (!tile) return;
      const photoId = tile.dataset.photoId;
      if (photoId) _emitAuditEvent('photo_view', photoId);
    });

    function renderFiltered() {
      const f = window._portalPhotoFilter || { phase: 'all', location: 'all' };
      const filtered = window._portalPhotos.filter(function (p) {
        if (f.phase !== 'all' && p.phase !== f.phase) return false;
        if (f.location !== 'all') {
          const loc = (p.location || (p.inferredLocation && p.inferredLocation.label) || '').trim();
          if (loc !== f.location) return false;
        }
        return true;
      });
      const empty = document.getElementById('portalPhotoEmpty');
      if (filtered.length === 0) {
        grid.innerHTML = '';
        if (empty) empty.style.display = 'block';
      } else {
        grid.innerHTML = filtered.map(tileHtml).join('');
        if (empty) empty.style.display = 'none';
      }
    }
    // Initial render — show all photos before any filter is tapped.
    renderFiltered();

    const tabs = document.getElementById('portalPhaseTabs');
    if (tabs) {
      tabs.addEventListener('click', function (e) {
        const btn = e.target.closest('.ph-tab');
        if (!btn) return;
        Array.from(tabs.querySelectorAll('.ph-tab')).forEach(function (b) {
          b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
        });
        window._portalPhotoFilter.phase = btn.dataset.phase || 'all';
        renderFiltered();
      });
    }
    const chips = document.getElementById('portalLocChips');
    if (chips) {
      chips.addEventListener('click', function (e) {
        const btn = e.target.closest('.ph-chip');
        if (!btn) return;
        Array.from(chips.querySelectorAll('.ph-chip')).forEach(function (b) {
          b.classList.toggle('ph-chip-active', b === btn);
        });
        window._portalPhotoFilter.location = btn.dataset.loc || 'all';
        renderFiltered();
      });
    }
  }

  // ─── Wave 123 + Step 14 polish: Async messaging ────────────────
  // Loads the thread on mount, polls every 30s while visible, and
  // posts new messages via sendPortalMessage. The poll handle is
  // tracked so we can clear it on pagehide / visibilitychange.
  //
  // Step 14 adds:
  //   - Enter-to-send (Shift+Enter for newline)
  //   - Live char counter that warns when near the 2000-char ceiling
  //   - Optimistic local bubble (instant feedback + retry on failure)
  //   - Read receipt (✓ Delivered / ✓✓ Read) on outgoing bubbles
  //   - Timestamp grouping — only show time at the start of a new
  //     "burst" (>5 min gap from previous message)
  let _pmPollHandle = null;
  let _pmLastFetch = 0;
  // Locally-tracked outgoing messages waiting for the server roundtrip
  // to surface them in the next fetched thread. Keyed by client-side
  // pending id; cleared once the server message with matching text
  // shows up in the polled response.
  const _pmPending = new Map();
  function wireMessagingCard() {
    const threadEl = document.getElementById('pm-thread');
    const emptyEl = document.getElementById('pm-empty');
    const textEl = document.getElementById('pm-text');
    const sendBtn = document.getElementById('pm-send');
    const statusEl = document.getElementById('pm-status');
    const counterEl = document.getElementById('pm-counter');
    if (!threadEl || !textEl || !sendBtn) return;

    // ── Char counter — warns at 80% capacity, errors past max ───
    const MAX_CHARS = 2000;
    const WARN_AT = 1700;
    function updateCounter() {
      if (!counterEl) return;
      const n = textEl.value.length;
      counterEl.textContent = n + ' / ' + MAX_CHARS;
      counterEl.style.color = n >= WARN_AT
        ? (n >= MAX_CHARS ? '#fca5a5' : '#fbbf24')
        : 'var(--muted, #888)';
    }

    function escMsg(s) {
      return String(s == null ? '' : s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }
    function fmtTime(ms) {
      if (!ms) return '';
      const d = new Date(ms);
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      const opts = sameDay
        ? { hour: 'numeric', minute: '2-digit' }
        : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
      return d.toLocaleString(undefined, opts);
    }
    function setStatus(msg, kind) {
      if (!statusEl) return;
      if (!msg) { statusEl.style.display = 'none'; return; }
      statusEl.style.display = 'block';
      statusEl.textContent = msg;
      statusEl.style.background = kind === 'error' ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.06)';
      statusEl.style.color = kind === 'error' ? '#fca5a5' : 'var(--muted, #888)';
      statusEl.style.border = kind === 'error' ? '1px solid rgba(239,68,68,0.45)' : '1px solid var(--br, #2a3344)';
    }

    // Toggle the "Sending…" → "Sent" → "Read" indicator on outgoing
    // bubbles. WhatsApp-style: ✓ delivered (server ack), ✓✓ read
    // (rep marked the thread read). Falls back to the original
    // timestamp line when the message hasn't reached either state.
    function bubbleStatusLine(m, isYou) {
      const time = escMsg(fmtTime(m.createdAt || (m._pending ? Date.now() : 0)));
      if (!isYou) return time;
      if (m._pending && !m._failed) return '<span style="opacity:.7;">Sending…</span>';
      if (m._failed)                 return '<span style="color:#fca5a5;">Tap to retry</span>';
      const readMark = m.readByRecipient
        ? '<span style="color:#fff;letter-spacing:-3px;">✓✓</span>'
        : '<span style="opacity:.7;">✓</span>';
      return time + ' · ' + readMark;
    }

    // Step 14: only emit a timestamp / header line at the start of
    // a new "burst" (defined as >5 min from the previous message).
    // Keeps the thread visually quieter for rapid back-and-forth.
    const BURST_GAP_MS = 5 * 60_000;
    function shouldShowTime(prev, cur) {
      if (!prev) return true;
      const pMs = prev.createdAt || (prev._pending ? prev._localMs : 0);
      const cMs = cur.createdAt  || (cur._pending  ? cur._localMs  : 0);
      if (!pMs || !cMs) return true;
      if (prev.source !== cur.source) return true;
      return (cMs - pMs) > BURST_GAP_MS;
    }

    function renderThread(messages) {
      // Merge in any pending optimistic messages. We dedup by text +
      // source: if the server already returned a homeowner message
      // matching the pending text, the pending entry gets dropped.
      const serverMsgs = Array.isArray(messages) ? messages.slice() : [];
      const pendingArr = Array.from(_pmPending.values());
      pendingArr.forEach(p => {
        const matched = serverMsgs.find(s =>
          s.source === 'homeowner' && s.text === p.text);
        if (matched) {
          _pmPending.delete(p._pendingId);
        }
      });
      const merged = serverMsgs.concat(
        Array.from(_pmPending.values())
          // Stable-sort by createdAt; pending entries use _localMs.
          .sort((a, b) => (a._localMs || 0) - (b._localMs || 0))
      );

      if (merged.length === 0) {
        if (emptyEl) emptyEl.style.display = 'block';
        Array.from(threadEl.querySelectorAll('.pm-bubble, .pm-empty-spacer')).forEach(n => n.remove());
        return;
      }
      if (emptyEl) emptyEl.style.display = 'none';
      Array.from(threadEl.querySelectorAll('.pm-bubble, .pm-empty-spacer')).forEach(n => n.remove());
      const accent = 'var(--accent, #c8541a)';
      let prev = null;
      merged.forEach(m => {
        const bubble = document.createElement('div');
        bubble.className = 'pm-bubble';
        const isYou = m.source === 'homeowner';
        const dim = m._pending && !m._failed ? '0.65' : '1';
        bubble.style.cssText =
          'max-width:80%;padding:9px 12px;border-radius:12px;font-size:14px;line-height:1.4;' +
          'word-wrap:break-word;align-self:' + (isYou ? 'flex-end' : 'flex-start') + ';' +
          'background:' + (isYou ? accent : 'rgba(255,255,255,0.08)') + ';' +
          'color:' + (isYou ? '#fff' : 'inherit') + ';' +
          'opacity:' + dim + ';' +
          'border-bottom-' + (isYou ? 'right' : 'left') + '-radius:4px;';

        const showTime = shouldShowTime(prev, m);
        const statusLine = showTime
          ? '<div style="font-size:10px;opacity:0.7;margin-top:4px;text-align:' + (isYou ? 'right' : 'left') + ';">' +
              (isYou ? 'You' : esc(repName.split(' ')[0])) + ' · ' + bubbleStatusLine(m, isYou) +
            '</div>'
          : '';

        bubble.innerHTML = '<div>' + escMsg(m.text) + '</div>' + statusLine;

        // Failed-bubble click handler — retry the send.
        if (m._failed && m._pendingId) {
          bubble.style.cursor = 'pointer';
          bubble.title = 'Tap to retry';
          bubble.addEventListener('click', () => retryPending(m._pendingId));
        }

        threadEl.appendChild(bubble);
        prev = m;
      });
      // Auto-scroll to the latest message.
      threadEl.scrollTop = threadEl.scrollHeight;
    }

    async function fetchMessages() {
      _pmLastFetch = Date.now();
      try {
        const res = await fetch(FUNCTIONS_BASE + '/getPortalMessages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: TOKEN }),
        });
        if (!res.ok) {
          // Silent fail on poll — don't spam status messages.
          if (res.status === 410 || res.status === 404) {
            setStatus('Conversation link no longer valid.', 'error');
          }
          return;
        }
        const json = await res.json().catch(() => ({}));
        renderThread(json.messages || []);
      } catch (_) {
        // Network blip on poll — silent.
      }
    }

    // Initial fetch.
    fetchMessages();
    // Poll every 30s while page is visible. Pause on hide.
    function startPoll() {
      if (_pmPollHandle) return;
      _pmPollHandle = setInterval(() => {
        if (document.hidden) return;
        if (Date.now() - _pmLastFetch < 25_000) return;
        fetchMessages();
      }, 30_000);
    }
    function stopPoll() {
      if (_pmPollHandle) {
        clearInterval(_pmPollHandle);
        _pmPollHandle = null;
      }
    }
    startPoll();
    // Refresh on tab refocus — if poll was paused, do an immediate fetch.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Date.now() - _pmLastFetch > 10_000) {
        fetchMessages();
      }
    });
    // Cleanup on pagehide so the poll doesn't run for a navigated-away tab.
    window.addEventListener('pagehide', stopPoll, { once: true });

    // Compose: enable Send only when there's content.
    // Step 14: also drive the live char counter from the same handler.
    textEl.addEventListener('input', () => {
      const has = textEl.value.trim().length > 0;
      sendBtn.disabled = !has;
      sendBtn.style.opacity = has ? '1' : '0.55';
      updateCounter();
    });

    // Step 14: Enter-to-send (Shift+Enter inserts a newline). Matches
    // the convention every messaging app on the planet uses; the help
    // text is in the textarea placeholder.
    textEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        if (!sendBtn.disabled) sendBtn.click();
      }
    });

    // Core send path — extracted so the retry-failed-bubble flow can
    // reuse it. The optimistic local bubble appears immediately; the
    // server roundtrip either confirms it (next fetch matches by text)
    // or marks it failed so the rep can tap to retry without retyping.
    async function doSend(text, pendingId) {
      try {
        const res = await fetch(FUNCTIONS_BASE + '/sendPortalMessage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: TOKEN, text }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          // Per-token daily quota / expired / 4xx — surface the server
          // message and mark the bubble failed.
          const p = _pmPending.get(pendingId);
          if (p) { p._failed = true; p._pending = false; renderThread(_lastMessages); }
          setStatus(json.error || 'Could not send. Try again.', 'error');
          return false;
        }
        // Success — leave the pending bubble in place until the next
        // poll surfaces the server message and the dedup logic drops it.
        await fetchMessages();
        setStatus('');
        return true;
      } catch (err) {
        const p = _pmPending.get(pendingId);
        if (p) { p._failed = true; p._pending = false; renderThread(_lastMessages); }
        setStatus('Network error — tap your message to retry.', 'error');
        return false;
      }
    }

    function retryPending(pendingId) {
      const p = _pmPending.get(pendingId);
      if (!p) return;
      p._failed = false;
      p._pending = true;
      p._localMs = Date.now();
      renderThread(_lastMessages);
      doSend(p.text, pendingId);
    }

    // Tracks the most recent server-side message list so optimistic
    // renders can re-merge against it on retry / failure-state flips.
    let _lastMessages = [];
    const origRenderThread = renderThread;
    renderThread = function(messages) {
      if (Array.isArray(messages)) _lastMessages = messages;
      else messages = _lastMessages;
      origRenderThread(messages);
    };

    sendBtn.addEventListener('click', async () => {
      const text = textEl.value.trim();
      if (!text) return;
      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending…';
      setStatus('');

      // Optimistic bubble — render immediately so the homeowner sees
      // their message in-thread before the network call resolves.
      const pendingId = 'p-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      _pmPending.set(pendingId, {
        _pendingId: pendingId,
        _pending: true,
        _failed: false,
        _localMs: Date.now(),
        source: 'homeowner',
        text,
        readByRecipient: false
      });
      textEl.value = '';
      updateCounter();
      renderThread(_lastMessages);

      const ok = await doSend(text, pendingId);
      // Reset compose state regardless — failures keep the pending
      // bubble visible (with retry affordance) so the rep doesn't lose
      // their work.
      sendBtn.textContent = 'Send';
      sendBtn.disabled = false;
      sendBtn.style.opacity = '0.55';
    });

    // Drive the counter once on mount so the "0 / 2000" reflects any
    // pre-filled textarea state (e.g., browser autofill restoring a
    // previous draft).
    updateCounter();
  }

  // ─── Wave 121: Customer rating ─────────────────────────────────
  // 1-5 star pick → optional comment → submit → conditional follow-up
  // (Google review nudge for 4-5★, "rep will reach out" for 1-3★).
  function wireRatingCard(view) {
    const starsWrap = document.getElementById('cr-stars');
    const sendBtn = document.getElementById('cr-send');
    const commentEl = document.getElementById('cr-comment');
    const statusEl = document.getElementById('cr-status');
    const thanksEl = document.getElementById('cr-thanks');
    if (!starsWrap || !sendBtn) return; // card wasn't rendered

    let chosenStars = 0;

    function paintStars(filled) {
      Array.from(starsWrap.querySelectorAll('.cr-star')).forEach(b => {
        const n = Number(b.dataset.stars) || 0;
        const isFilled = n <= filled;
        b.textContent = isFilled ? '★' : '☆';
        b.style.color = isFilled ? '#fbbf24' : '#888';
        b.style.borderColor = isFilled ? '#fbbf24' : 'var(--br, #2a3344)';
        b.style.background = isFilled ? 'rgba(251,191,36,0.08)' : 'var(--bg, #0a1424)';
      });
    }

    Array.from(starsWrap.querySelectorAll('.cr-star')).forEach(b => {
      b.addEventListener('click', () => {
        chosenStars = Number(b.dataset.stars) || 0;
        paintStars(chosenStars);
        // Reveal comment + submit on first pick.
        if (commentEl) commentEl.style.display = 'block';
        sendBtn.style.display = 'block';
        sendBtn.disabled = false;
        sendBtn.style.opacity = '1';
        sendBtn.textContent = chosenStars >= 4 ? 'Send my rating' : 'Send feedback';
      });
      // Hover-preview for desktop.
      b.addEventListener('mouseenter', () => {
        if (chosenStars > 0) return;
        paintStars(Number(b.dataset.stars) || 0);
      });
      b.addEventListener('mouseleave', () => {
        if (chosenStars > 0) paintStars(chosenStars);
        else paintStars(0);
      });
    });

    function setStatus(msg, kind) {
      if (!statusEl) return;
      statusEl.style.display = 'block';
      statusEl.textContent = msg;
      if (kind === 'error') {
        statusEl.style.background = 'rgba(239,68,68,0.12)';
        statusEl.style.color = '#fca5a5';
        statusEl.style.border = '1px solid rgba(239,68,68,0.45)';
      } else {
        statusEl.style.background = 'rgba(255,255,255,0.06)';
        statusEl.style.color = 'var(--muted, #888)';
        statusEl.style.border = '1px solid var(--br, #2a3344)';
      }
    }

    sendBtn.addEventListener('click', async () => {
      if (chosenStars < 1 || chosenStars > 5) {
        setStatus('Pick a star rating first.', 'error');
        return;
      }
      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending…';
      try {
        const res = await fetch(FUNCTIONS_BASE + '/submitCustomerRating', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: TOKEN,
            stars: chosenStars,
            comment: commentEl ? commentEl.value : '',
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setStatus(json.error || 'Could not save rating. Try again.', 'error');
          sendBtn.disabled = false;
          sendBtn.textContent = chosenStars >= 4 ? 'Send my rating' : 'Send feedback';
          return;
        }

        // Hide the rater controls; show the thank-you tier copy.
        Array.from(starsWrap.querySelectorAll('.cr-star')).forEach(b => {
          b.disabled = true; b.style.cursor = 'default';
        });
        if (commentEl) commentEl.disabled = true;
        sendBtn.style.display = 'none';
        if (statusEl) statusEl.style.display = 'none';

        if (thanksEl) {
          thanksEl.style.display = 'block';
          if (json.tier === 'high') {
            // 4-5 stars → nudge to Google review.
            // W134 defense-in-depth: validate URL scheme on the client too.
            // Server-side `submitCustomerRating` already enforces https?://,
            // but a defensive check here means any future server bug or
            // direct-invocation can't pivot to a `javascript:` href.
            const _rawUrl = json.googleReviewUrl;
            const reviewUrl = (typeof _rawUrl === 'string'
              && /^https?:\/\//i.test(_rawUrl.trim())) ? _rawUrl.trim() : null;
            thanksEl.innerHTML =
              '<div style="font-size:15px;font-weight:600;color:#5eead4;margin-bottom:8px;">🎉 Thank you!</div>' +
              '<div style="color:var(--muted);font-size:13px;line-height:1.5;margin-bottom:' + (reviewUrl ? '12px' : '0') + ';">' +
              'It means the world that we earned ' + chosenStars + ' stars. ' +
              (reviewUrl ? 'A public Google review helps other homeowners find us — tap below if you have a sec.' : '&mdash; ' + esc(repName.split(' ')[0]) + ' will be in touch.') +
              '</div>' +
              (reviewUrl
                ? '<a href="' + esc(reviewUrl) + '" target="_blank" rel="noopener" class="btn" style="display:block;text-align:center;padding:12px;font-size:14px;background:var(--accent, #c8541a);color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">⭐ Leave a Google review</a>'
                : '');
          } else {
            // 1-3 stars → recovery message.
            thanksEl.style.background = 'rgba(251,191,36,0.08)';
            thanksEl.style.borderColor = 'rgba(251,191,36,0.45)';
            thanksEl.innerHTML =
              '<div style="font-size:15px;font-weight:600;color:#fbbf24;margin-bottom:8px;">Thank you for the honest feedback.</div>' +
              '<div style="color:var(--muted);font-size:13px;line-height:1.5;">' +
              'We take this seriously. ' + esc(repName.split(' ')[0]) + ' will reach out within 24 hours to make this right.' +
              '</div>';
          }
        }
      } catch (err) {
        setStatus('Network error: ' + (err.message || 'try again'), 'error');
        sendBtn.disabled = false;
        sendBtn.textContent = chosenStars >= 4 ? 'Send my rating' : 'Send feedback';
      }
    });
  }

  // ─── Wave 119: Request a callback ─────────────────────────────────
  // Time-slot picker → POST to requestCallback Cloud Function with
  // the portal token. Server creates a task on the lead so the rep
  // sees it in their bell + customer page activity log.
  function wireCallbackCard() {
    const slotsWrap = document.getElementById('cb-slots');
    const sendBtn = document.getElementById('cb-send');
    const noteEl = document.getElementById('cb-note');
    const statusEl = document.getElementById('cb-status');
    if (!slotsWrap || !sendBtn) return;

    let chosenSlot = null;

    // Style the slot chips inline so we don't need a separate CSS bundle.
    Array.from(slotsWrap.querySelectorAll('.cb-slot')).forEach(b => {
      b.style.cssText =
        'padding:9px 14px;border-radius:999px;border:1px solid var(--br, #2a3344);' +
        'background:var(--bg, #0a1424);color:inherit;font:inherit;font-size:13px;' +
        'cursor:pointer;-webkit-tap-highlight-color:transparent;transition:all 120ms ease;';
      b.addEventListener('click', () => selectSlot(b));
    });

    function selectSlot(btn) {
      chosenSlot = btn.dataset.slot || null;
      Array.from(slotsWrap.querySelectorAll('.cb-slot')).forEach(b => {
        const isActive = b === btn;
        b.style.background = isActive ? 'var(--accent, #c8541a)' : 'var(--bg, #0a1424)';
        b.style.borderColor = isActive ? 'var(--accent, #c8541a)' : 'var(--br, #2a3344)';
        b.style.color = isActive ? '#fff' : 'inherit';
      });
      sendBtn.disabled = false;
      sendBtn.style.opacity = '1';
      sendBtn.textContent = 'Send callback request';
    }

    function setStatus(msg, kind) {
      if (!statusEl) return;
      statusEl.style.display = 'block';
      statusEl.textContent = msg;
      if (kind === 'error') {
        statusEl.style.background = 'rgba(239,68,68,0.12)';
        statusEl.style.color = '#fca5a5';
        statusEl.style.border = '1px solid rgba(239,68,68,0.45)';
      } else if (kind === 'success') {
        statusEl.style.background = 'rgba(46,204,138,0.12)';
        statusEl.style.color = '#5eead4';
        statusEl.style.border = '1px solid rgba(46,204,138,0.45)';
      } else {
        statusEl.style.background = 'rgba(255,255,255,0.06)';
        statusEl.style.color = 'var(--muted, #888)';
        statusEl.style.border = '1px solid var(--br, #2a3344)';
      }
    }

    sendBtn.addEventListener('click', async () => {
      if (!chosenSlot) {
        setStatus('Pick a time first.', 'error');
        return;
      }
      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending…';
      try {
        const res = await fetch(FUNCTIONS_BASE + '/requestCallback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: TOKEN,
            slot: chosenSlot,
            note: noteEl ? noteEl.value : '',
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setStatus(json.error || 'Could not send request. Try again.', 'error');
          sendBtn.disabled = false;
          sendBtn.textContent = 'Send callback request';
          return;
        }
        setStatus('✓ Got it! ' + esc(repName) + ' will reach out.', 'success');
        // Lock the form so they don't double-send.
        Array.from(slotsWrap.querySelectorAll('.cb-slot')).forEach(b => {
          b.disabled = true; b.style.cursor = 'default'; b.style.opacity = '0.6';
        });
        if (noteEl) noteEl.disabled = true;
        sendBtn.style.display = 'none';
      } catch (err) {
        setStatus('Network error: ' + (err.message || 'try again'), 'error');
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send callback request';
      }
    });
  }

  // ─── Wave 118: Customer photo upload ─────────────────────────────
  // File pick → resize/compress to 1600px max → base64 → POST to
  // uploadHomeownerPhoto Cloud Function with the portal token.
  // Success: show thumbnail + confirmation. Failure: friendly error.
  function wireUploadCard() {
    const pickBtn = document.getElementById('cuh-pick');
    const fileInput = document.getElementById('cuh-file');
    const preview = document.getElementById('cuh-preview');
    const status = document.getElementById('cuh-status');
    if (!pickBtn || !fileInput) return;

    pickBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      handleUpload(file);
    });

    function setStatus(msg, kind) {
      if (!status) return;
      status.style.display = 'block';
      status.textContent = msg;
      if (kind === 'error') {
        status.style.background = 'rgba(239,68,68,0.12)';
        status.style.color = '#fca5a5';
        status.style.border = '1px solid rgba(239,68,68,0.45)';
      } else if (kind === 'success') {
        status.style.background = 'rgba(46,204,138,0.12)';
        status.style.color = '#5eead4';
        status.style.border = '1px solid rgba(46,204,138,0.45)';
      } else {
        status.style.background = 'rgba(255,255,255,0.06)';
        status.style.color = 'var(--muted, #888)';
        status.style.border = '1px solid var(--br, #2a3344)';
      }
    }

    // Resize the image client-side so we don't waste bandwidth or
    // server CPU on full-resolution iPhone photos. 1600px max edge
    // is plenty for damage assessment + keeps payloads under 1-2MB.
    function resizeImage(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function (e) {
          const img = new Image();
          img.onload = function () {
            const MAX = 1600;
            let w = img.width, h = img.height;
            if (w > MAX || h > MAX) {
              if (w >= h) { h = Math.round(h * (MAX / w)); w = MAX; }
              else        { w = Math.round(w * (MAX / h)); h = MAX; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            // JPEG q=0.85 hits the sweet spot for photos —
            // visibly clean, well under the 8MB server cap.
            const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
            resolve(dataUrl);
          };
          img.onerror = () => reject(new Error('Could not read image'));
          img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('Could not read file'));
        reader.readAsDataURL(file);
      });
    }

    async function handleUpload(file) {
      try {
        if (!/^image\//.test(file.type)) {
          setStatus('Please pick an image file.', 'error');
          return;
        }
        setStatus('Preparing photo…', 'info');
        const dataUrl = await resizeImage(file);

        // Show preview thumbnail.
        preview.style.display = 'block';
        preview.innerHTML =
          '<div style="display:flex;gap:12px;align-items:flex-start;">' +
            '<img src="' + dataUrl + '" alt="Photo preview" style="width:80px;height:80px;object-fit:cover;border-radius:6px;flex-shrink:0;">' +
            '<div style="flex:1;">' +
              '<input id="cuh-caption" type="text" placeholder="Optional note (e.g. \'Spot in the back\')" maxlength="280" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--br, #2a3344);background:var(--bg, #0a1424);color:inherit;font:inherit;font-size:13px;box-sizing:border-box;">' +
              '<button id="cuh-send" type="button" class="btn" style="margin-top:8px;width:100%;padding:11px;font-size:14px;background:var(--accent, #c8541a);color:#fff;border:none;border-radius:6px;cursor:pointer;">Send to your rep</button>' +
            '</div>' +
          '</div>';
        setStatus('Add an optional note, then send.', 'info');

        const sendBtn = document.getElementById('cuh-send');
        sendBtn.addEventListener('click', async () => {
          const captionEl = document.getElementById('cuh-caption');
          const caption = captionEl ? captionEl.value : '';
          sendBtn.disabled = true;
          sendBtn.textContent = 'Sending…';
          try {
            const res = await fetch(FUNCTIONS_BASE + '/uploadHomeownerPhoto', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: TOKEN, dataUrl, caption }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
              setStatus(json.error || 'Upload failed. Try again.', 'error');
              sendBtn.disabled = false;
              sendBtn.textContent = 'Send to your rep';
              return;
            }
            setStatus(
              '✓ Photo sent to your rep.' + (typeof json.remainingToday === 'number'
                ? ' (' + json.remainingToday + ' more allowed today)' : ''),
              'success'
            );
            // Reset for another upload after a beat so the rep
            // can send a few in sequence.
            setTimeout(() => {
              preview.style.display = 'none';
              preview.innerHTML = '';
              fileInput.value = '';
              setStatus('Got more? Upload another.', 'info');
            }, 1500);
          } catch (err) {
            setStatus('Network error: ' + (err.message || 'try again'), 'error');
            sendBtn.disabled = false;
            sendBtn.textContent = 'Send to your rep';
          }
        });
      } catch (err) {
        setStatus(err.message || 'Could not prepare photo.', 'error');
      }
    }
  }

  loadView();
})();
