/**
 * upgrade-price-settings.js — Settings → Estimates → "Upgrade prices"
 * (window.NBDUpgradePriceSettings).
 *
 * WHY THIS EXISTS (2026-09-25, Upgrades & Add-ons stage 2, lane "prices").
 * The design rule is that no research-guess price ever reaches a homeowner:
 * six of the ten gutter upgrades in upgrade-library.js ship with
 * priceStatus 'needs_price' and NO figure, and upgrade-pricing.js refuses to
 * quote them until the company saves its own. This panel is where an owner
 * or company admin does that, per upgrade:
 *   - a retail price typed in DOLLARS and stored as whole CENTS. The pricing
 *     core cannot tell 18 cents from $18 (both are whole numbers), so the
 *     dollars→cents step lives here, done on the digits — never
 *     parseFloat × 100, which turns 0.29 into 28.999… cents;
 *   - On/Off, which keeps the price when an item is switched off;
 *   - for an item a certified sub installs, that installer's business name
 *     (tenant data; blank prints "an independent certified installer").
 * Design: documentation/projects/UPGRADES-ADDONS-DESIGN-2026-09-25.md.
 *
 * STORAGE. companyProfile/{companyId}.pricing.upgradePrices, the same doc and
 * merge-save path the Add-on Rates editor writes (window._saveCompanyProfile)
 * and the same firestore.rules gate: owner / company_admin write, the tenant
 * reads. One entry per library item:
 *   { <upgradeId>: { cents: <whole cents>|null, enabled: <bool>,
 *                    installerName: <text> (certified-sub items only) } }
 * A save writes ONLY the entries this device changed since it painted the
 * panel (changedEntries), each entry whole, through the merge write. Every
 * key is a fixed library id, so there is nothing to delete and no dot-path
 * replace is needed (unlike My Jurisdictions' free-form slugs).
 *
 * WHY ONLY THE CHANGED ENTRIES (2026-09-25 review of PR #1762). The panel is
 * painted from window._companyProfile, which loads once at boot and has no
 * live listener. Writing the whole map from a device that loaded at 9:00
 * put back, at 11:00, a price another device saved at 10:00 — Jo prices
 * from the installed iPhone app AND a desktop, and Save All carried the map
 * on every press even when nobody touched this panel. An entry nobody
 * changed here is now never sent, so it can't revert anyone's save.
 *
 * HOW THE BUILDER SEES IT. NBDUpgrades.offeredFor / price read this map
 * through their existing tenantOverrides argument: absent (undefined or
 * null), it defaults to window._companyProfile.pricing.upgradePrices at call
 * time (pass {} for the library alone), and
 * NBDUpgrades.sanitizeOverrides is the ONE reader of the stored shape — this
 * panel reads saved values back through it too, so the panel can never show
 * a price the builder would drop.
 *
 * HYDRATION GUARD (same rule as My Jurisdictions and the county inputs):
 * until _loadCompanyProfile's read has landed the panel shows a loading
 * line, its Save refuses, and Save All leaves upgrade prices out, so a
 * pre-hydration blank form can never be published as "no prices" for the
 * whole company.
 *
 * Loaded in the lazy 'estimates' bundle (script-loader.js) after
 * upgrade-library.js and upgrade-pricing.js; rendered by
 * _loadEstimateDefaultsV2 (dashboard-bootstrap.module.js) whenever the
 * Estimates tab paints. No inline handlers: the Save button dispatches
 * through the delegated data-action="module" path, and the rows use one
 * delegated input/change listener on the panel.
 */
(function (root) {
  'use strict';

  var HOST_ID = 'upgPriceRows';
  var MSG_ID = 'upgPriceMsg';
  var SAVE_ID = 'upgPriceSave';
  var TRADE_LABELS = { gutters: { title: 'Gutters', noun: 'gutter' } };

  function U() { return root.NBDUpgrades; }
  function LIB() { return root.NBD_UPGRADE_LIBRARY; }
  function hasOwn(o, k) { return o != null && Object.prototype.hasOwnProperty.call(o, k); }
  function maxCents() {
    var m = U() && U().MAX_UNIT_CENTS;
    return (typeof m === 'number' && m > 0) ? m : 100000;
  }

  // ── Pure helpers (tests/upgrade-price-settings.test.js) ────────────────

  function unitWords(unit) {
    return unit === 'EA'
      ? { per: 'each', label: 'Price each', suffix: 'each' }
      : { per: 'per foot', label: 'Price per foot', suffix: '/ ft' };
  }

  // Whole cents → "$1,234.50".
  function money(cents) {
    var c = Math.round(Number(cents));
    if (!Number.isFinite(c)) return '';
    var neg = c < 0; c = Math.abs(c);
    var d = String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + '$' + d + '.' + String(c % 100).padStart(2, '0');
  }

  // Whole cents → the text a price field shows ("12.50"), '' for none.
  function centsToInput(cents) {
    if (!Number.isInteger(cents) || cents <= 0) return '';
    return Math.floor(cents / 100) + '.' + String(cents % 100).padStart(2, '0');
  }

  /**
   * parseDollars(text, unit) → { cents, error }
   * Blank is { cents: null, error: null }: the library price stands, or the
   * item stays unpriced. Everything else is exact whole cents or an error the
   * field shows — never a silent fix. Refused on purpose:
   *   - more than two decimal places (12.345 is not a price);
   *   - a comma that is not a thousands separator ("6,50" is how half the
   *     world writes $6.50; dropping the comma would save $650);
   *   - a space inside the number ("6 50" or "1 000"). Dropping the space
   *     saved "6 50" as $650.00 a foot — the same trap as the comma. Only
   *     the ends, and a gap after a leading "$", are trimmed (2026-09-25
   *     review of PR #1762);
   *   - $0 (it would print as a no-charge item on a homeowner's paper — switch
   *     the item Off instead) and anything over NBDUpgrades.MAX_UNIT_CENTS,
   *     which sanitizeOverrides would otherwise drop without a word.
   */
  function parseDollars(text, unit) {
    var s = String(text == null ? '' : text).trim();
    if (!s) return { cents: null, error: null };
    s = s.replace(/^\$\s*/, '');
    if (/[\d.,]\s+[\d.,]/.test(s)) {
      return { cents: null, error: 'Take out the space. Use a dot for cents, like 12.50.' };
    }
    if (/^-/.test(s)) return { cents: null, error: 'A price can\'t be negative.' };
    if (s.indexOf(',') !== -1) {
      if (!/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) {
        return { cents: null, error: 'Use a dot for cents, like 12.50.' };
      }
      s = s.replace(/,/g, '');
    }
    var m = /^(\d*)(?:\.(\d*))?$/.exec(s);
    if (!m || (!m[1] && !m[2])) return { cents: null, error: 'Enter dollars and cents, like 12.50.' };
    if (m[2] && m[2].length > 2) return { cents: null, error: 'Use at most two decimals, like 12.50.' };
    var whole = m[1].replace(/^0+(?=\d)/, '');
    var max = maxCents();
    // Past the ceiling on digit count alone, before any arithmetic can round.
    if (whole.length > String(Math.floor(max / 100)).length) {
      return { cents: null, error: 'Over ' + money(max) + ' ' + unitWords(unit).per + '. Check the price.' };
    }
    var cents = (whole ? parseInt(whole, 10) : 0) * 100 + parseInt(((m[2] || '') + '00').slice(0, 2), 10);
    if (cents <= 0) return { cents: null, error: 'Enter a price above $0.00, or switch this upgrade Off.' };
    if (cents > max) return { cents: null, error: 'Over ' + money(max) + ' ' + unitWords(unit).per + '. Check the price.' };
    return { cents: cents, error: null };
  }

  function libraryCents(item) {
    return (item && item.priceStatus === 'approved' && Number.isInteger(item.retailCents) && item.retailCents > 0)
      ? item.retailCents : null;
  }

  function cleanInstaller(s) {
    // The pricing core's own cleaner is not exported; this is the same rule
    // (control characters out, whitespace collapsed, 80 characters).
    // eslint-disable-next-line no-control-regex
    return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  /**
   * savedEntries(profile) → { <upgradeId>: { cents, enabled, installerName } }
   * for EVERY library item, read through NBDUpgrades.sanitizeOverrides — the
   * same reader the builder uses — so a stored value the builder would drop
   * shows here as blank, not as a price that never reaches a quote.
   */
  function savedEntries(profile) {
    var L = LIB();
    var raw = profile && profile.pricing && profile.pricing.upgradePrices;
    var ov = U().sanitizeOverrides((raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : null);
    var out = {};
    L.items.forEach(function (it) {
      out[it.id] = {
        cents: hasOwn(ov.prices, it.id) ? ov.prices[it.id] : null,
        enabled: !ov.disabled[it.id],
        installerName: ov.installers && ov.installers[it.id] ? ov.installers[it.id] : ''
      };
    });
    return out;
  }

  /**
   * describe(item, form) → { state, unitCents, source, text }
   *   form: { priceText, enabled }
   *   state: 'invalid' | 'off' | 'needs_price' | 'offered'
   * The one place the row's status sentence is decided, so the words can
   * never disagree with what the builder will do.
   */
  function describe(item, form) {
    var w = unitWords(item.unit);
    var parsed = parseDollars(form && form.priceText, item.unit);
    var lib = libraryCents(item);
    var unitCents = parsed.cents != null ? parsed.cents : lib;
    var source = parsed.cents != null ? 'company' : (lib != null ? 'default' : null);
    var enabled = !(form && form.enabled === false);
    if (parsed.error) {
      return { state: 'invalid', unitCents: null, source: null, text: parsed.error };
    }
    if (!enabled) {
      return {
        state: 'off', unitCents: unitCents, source: source,
        text: 'Off. Reps never see it' + (unitCents != null ? ' (the price is kept: ' + money(unitCents) + ' ' + w.per + ').' : '.')
      };
    }
    if (unitCents == null) {
      // The row's "Set a price" badge says what to do; this says why.
      return { state: 'needs_price', unitCents: null, source: null, text: 'Not offered: reps can\'t add it until it has a price.' };
    }
    return {
      state: 'offered', unitCents: unitCents, source: source,
      text: 'Offered at ' + money(unitCents) + ' ' + w.per + (source === 'default' ? ' (the default price).' : ' (your price).')
    };
  }

  /**
   * buildSaveMap(forms) → { map, errors }
   *   forms: { <upgradeId>: { priceText, enabled, installerName } }
   * One entry for EVERY library item (an item missing from `forms` keeps
   * "no price, On"). Any bad price → map is null and nothing may be saved.
   */
  function buildSaveMap(forms) {
    var L = LIB();
    var map = {};
    var errors = [];
    L.items.forEach(function (it) {
      var f = (forms && forms[it.id]) || {};
      var parsed = parseDollars(f.priceText, it.unit);
      if (parsed.error) { errors.push({ id: it.id, message: parsed.error }); return; }
      var entry = { cents: parsed.cents, enabled: f.enabled !== false };
      if (it.installer === 'certified_sub') entry.installerName = cleanInstaller(f.installerName);
      map[it.id] = entry;
    });
    return { map: errors.length ? null : map, errors: errors };
  }

  /**
   * changedEntries(map, painted) → { <upgradeId>: entry } — the entries of a
   * buildSaveMap map whose value differs from `painted` (savedEntries of the
   * profile the panel was painted from, or last saved). Only these are ever
   * written: an entry this device did not change can't overwrite a newer
   * save from another device. An item missing from `painted` counts as
   * changed (nothing to compare against, so never silently skipped).
   */
  function changedEntries(map, painted) {
    var out = {};
    if (!map) return out;
    LIB().items.forEach(function (it) {
      var m = map[it.id];
      if (!m) return;
      var p = painted && painted[it.id];
      var same = !!p
        && m.cents === (p.cents == null ? null : p.cents)
        && m.enabled === (p.enabled !== false)
        && (it.installer !== 'certified_sub' || (m.installerName || '') === (p.installerName || ''));
      if (!same) out[it.id] = m;
    });
    return out;
  }

  // The homeowner sentence for a certified-sub item, via the pricing core so
  // the preview is byte-identical to what prints.
  function installerPreview(item, name) {
    var line = U().installerLine(item, { certifiedInstallerName: name });
    return line ? 'Homeowner paper reads: “' + line + '”' : '';
  }

  /**
   * canEdit(claims, uid) — the firestore.rules companyProfile write gate,
   * mirrored: platform admin, company_admin, or the solo owner whose doc key
   * (companyId claim, else uid) IS their uid. Anyone else sees the prices
   * read-only instead of typing into a Save that rules will deny.
   */
  function canEdit(claims, uid) {
    if (!uid) return false;
    var c = claims || {};
    if (c.role === 'admin' || c.role === 'company_admin') return true;
    // 2026-09-25: cpCanWrite's solo branch now also requires notViewer()
    // (Jo's decision B, viewer is read-only). A viewer always carries a
    // tenant companyId, so this was already false in practice; stated so the
    // mirror stays exact.
    if (c.role === 'viewer') return false;
    return String(c.companyId || uid) === String(uid);
  }

  // ── DOM ────────────────────────────────────────────────────────────────

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'className') n.className = v;
      else n.setAttribute(k, v === true ? '' : String(v));
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function itemById(id) {
    var items = LIB().items;
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  }

  function rowOf(node) { return node && node.closest ? node.closest('[data-upg-id]') : null; }

  function formOfRow(row) {
    var p = row.querySelector('[data-upg-price]');
    var on = row.querySelector('[data-upg-enabled]');
    var inst = row.querySelector('[data-upg-installer]');
    return {
      priceText: p ? p.value : '',
      enabled: on ? on.checked : true,
      installerName: inst ? inst.value : ''
    };
  }

  // Repaint one row's status, badge, error and preview from its own inputs.
  function refreshRow(row) {
    var item = itemById(row.getAttribute('data-upg-id'));
    if (!item) return;
    var f = formOfRow(row);
    var d = describe(item, f);
    row.setAttribute('data-upg-state', d.state);
    var st = row.querySelector('[data-upg-status]');
    var er = row.querySelector('[data-upg-error]');
    var price = row.querySelector('[data-upg-price]');
    if (d.state === 'invalid') {
      if (st) st.textContent = 'Not saved until this price is fixed.';
      if (er) { er.textContent = d.text; er.hidden = false; }
      if (price) price.setAttribute('aria-invalid', 'true');
    } else {
      if (st) st.textContent = d.text;
      if (er) { er.textContent = ''; er.hidden = true; }
      if (price) price.removeAttribute('aria-invalid');
    }
    var badge = row.querySelector('[data-upg-badge]');
    if (badge) badge.hidden = !(d.state === 'needs_price' || (d.state === 'off' && d.unitCents == null));
    var onoff = row.querySelector('[data-upg-onoff]');
    if (onoff) onoff.textContent = f.enabled ? 'On' : 'Off';
    var pv = row.querySelector('[data-upg-preview]');
    if (pv) pv.textContent = installerPreview(item, cleanInstaller(f.installerName));
  }

  function buildRow(item, entry, editable) {
    var w = unitWords(item.unit);
    var lib = libraryCents(item);
    var id = item.id;
    var priceIn = el('input', {
      id: 'upg-price-' + id, type: 'text', inputmode: 'decimal', autocomplete: 'off',
      enterkeyhint: 'done', spellcheck: 'false', 'data-upg-price': true,
      placeholder: lib != null ? centsToInput(lib) : 'Set a price',
      'aria-describedby': 'upg-status-' + id + ' upg-err-' + id,
      disabled: !editable
    });
    priceIn.value = centsToInput(entry.cents);
    var toggle = el('input', {
      id: 'upg-on-' + id, type: 'checkbox', role: 'switch', 'data-upg-enabled': true,
      'aria-label': 'Offer ' + item.name, disabled: !editable
    });
    toggle.checked = entry.enabled !== false;

    var fields = [
      el('div', { className: 'upg-field' }, [
        el('label', { for: 'upg-price-' + id, text: w.label }),
        // A second <label> for the same input, so a thumb on the "$" or the
        // unit still lands in the field.
        el('label', { className: 'upg-money', for: 'upg-price-' + id }, [
          el('span', { className: 'upg-cur', 'aria-hidden': 'true', text: '$' }),
          priceIn,
          el('span', { className: 'upg-unit', 'aria-hidden': 'true', text: w.suffix })
        ])
      ])
    ];
    var preview = null;
    if (item.installer === 'certified_sub') {
      var inst = el('input', {
        id: 'upg-inst-' + id, type: 'text', maxlength: '80', autocomplete: 'organization',
        // The preview line under the row spells out what a blank prints; a
        // placeholder that long is cut off on a phone.
        'data-upg-installer': true, placeholder: 'Optional',
        'aria-describedby': 'upg-prev-' + id, disabled: !editable
      });
      inst.value = entry.installerName || '';
      fields.push(el('div', { className: 'upg-field' }, [
        el('label', { for: 'upg-inst-' + id, text: 'Installer business name' + (item.certification ? ' (' + item.certification + '-certified)' : '') }),
        inst
      ]));
      preview = el('p', { className: 'upg-preview', id: 'upg-prev-' + id, 'data-upg-preview': true });
    }

    var row = el('div', { className: 'upg-row', 'data-upg-id': id }, [
      el('div', { className: 'upg-row-head' }, [
        el('div', { className: 'upg-name' }, [
          el('span', { className: 'upg-name-text', text: item.name }),
          el('span', { className: 'upg-badge', 'data-upg-badge': true, text: 'Set a price', hidden: true })
        ]),
        el('label', { className: 'upg-toggle', for: 'upg-on-' + id }, [
          toggle,
          el('span', { className: 'upg-toggle-text', 'data-upg-onoff': true, text: 'On' })
        ])
      ]),
      el('div', { className: 'upg-fields' }, fields),
      el('p', { className: 'upg-status', id: 'upg-status-' + id, 'data-upg-status': true }),
      preview,
      el('p', { className: 'upg-err', id: 'upg-err-' + id, 'data-upg-error': true, role: 'alert', hidden: true })
    ]);
    refreshRow(row);
    return row;
  }

  function wire(host) {
    if (host.__upgWired) return;
    host.__upgWired = true;
    var onEdit = function (e) {
      var row = rowOf(e.target);
      if (row) refreshRow(row);
      clearMessage();
    };
    host.addEventListener('input', onEdit);
    host.addEventListener('change', onEdit);
  }

  // Paint once the profile lands, whichever read it was (2026-09-25, lane
  // profretry: company-profile.js announces every first landing). Only the
  // loading line is ever replaced — it stays data-state="loading" under the
  // "did not load" text too, so a later landing still paints the rows. A
  // panel already painted from the hydrated profile may hold typing; never
  // repaint over it from here — unless it was painted for ANOTHER tenant
  // (2026-09-25, second review of #1774): the account's company changed
  // under this tab and this landing is the new company's. Those rows are not
  // its prices and can't be saved to it (see _paintedKey), so they are
  // repainted, and the rep is told if that drops a change they had made.
  function onProfileLanded() {
    var host = document.getElementById(HOST_ID);
    if (!host || root._companyProfileLoaded !== true) return;
    var state = host.getAttribute('data-state');
    if (state === 'loading') { render(); return; }
    if (paintedForAnotherTenant(host)) render();
  }

  // Rows showing another tenant's prices than the profile now loaded. render()
  // checks this too, so the notice below shows whichever repaint comes first:
  // this listener's, or the Estimates panel's own landing repaint (which
  // calls render() and usually runs first).
  function paintedForAnotherTenant(host) {
    return host.getAttribute('data-state') === 'ready' && _paintedKey != null
      && root._companyProfileLoaded === true && !paintedForLoadedProfile();
  }

  // Any row changed since the paint (a bad price counts: it was typed).
  function editedSincePaint(host) {
    var forms = {};
    host.querySelectorAll('[data-upg-id]').forEach(function (row) {
      forms[row.getAttribute('data-upg-id')] = formOfRow(row);
    });
    var out = buildSaveMap(forms);
    if (out.errors.length) return true;
    return Object.keys(changedEntries(out.map, _painted)).length > 0;
  }
  try { root.addEventListener('nbd:company-profile-loaded', onProfileLanded); } catch (_) { /* no event target */ }

  var _waiting = false;
  function waitForProfile() {
    // Ask for the read, don't only wait for it (2026-09-25, found probing
    // desktop 1280 for the PR #1762 review). The boot read can give up on a
    // cold Firestore channel ("client is offline" after nbdRetryOffline's
    // three tries), so a desktop that opened this tab showed "Loading…" and
    // then "did not load" for good, while a manual _loadCompanyProfile()
    // landed in ~15ms.
    // Through _ensureCompanyProfile (2026-09-25, lane profretry): one read
    // here, then a 500ms watch that quit after 30s, could still give up
    // while a retry a few seconds later would have landed. The ensure run
    // retries with backoff, is shared with the boot and My Jurisdictions,
    // and every call makes its next read happen now. It sets nothing itself
    // — _companyProfileLoaded is still set only by a successful doc read —
    // so the guard in render() is unchanged, and "open this tab again"
    // really asks again.
    var ensure = typeof root._ensureCompanyProfile === 'function'
      ? root._ensureCompanyProfile
      : function () {
        return Promise.resolve(typeof root._loadCompanyProfile === 'function' ? root._loadCompanyProfile() : null)
          .then(function () { return root._companyProfileLoaded === true; });
      };
    var p;
    try { p = ensure(); } catch (_) { p = null; }
    if (_waiting) return;
    _waiting = true;
    var settle = function () {
      _waiting = false;
      var host = document.getElementById(HOST_ID);
      if (!host || host.getAttribute('data-state') !== 'loading') return;
      if (root._companyProfileLoaded === true) { onProfileLanded(); return; }
      // The profile read failed or never came back (offline, a denied
      // read). Say so rather than leave "Loading…" up forever; Save stays
      // off, because an unhydrated form must never be published.
      host.textContent = '';
      host.appendChild(el('p', { className: 'upg-loading', text: 'Your saved upgrade prices did not load. Check your connection, then open this tab again.' }));
    };
    Promise.resolve(p).then(settle, settle);
  }

  function setSaveEnabled(on) {
    var b = document.getElementById(SAVE_ID);
    if (b) { b.disabled = !on; b.hidden = false; }
  }

  function setMessage(text, kind) {
    var m = document.getElementById(MSG_ID);
    if (!m) return;
    m.textContent = text || '';
    m.setAttribute('data-kind', kind || '');
    m.hidden = !text;
  }
  function clearMessage() {
    var m = document.getElementById(MSG_ID);
    if (m && m.getAttribute('data-kind') !== 'busy') setMessage('', '');
  }

  /**
   * render() — paint the panel from the hydrated company profile. Called by
   * _loadEstimateDefaultsV2 on every Estimates-tab paint (so it repaints from
   * saved values like every other input on that tab), and by its own
   * hydration poll while the loading line is showing.
   */
  function render() {
    var host = document.getElementById(HOST_ID);
    if (!host) return;
    if (!LIB() || !U() || typeof U().sanitizeOverrides !== 'function') {
      host.setAttribute('data-state', 'unavailable');
      host.textContent = '';
      host.appendChild(el('p', { className: 'upg-loading', text: 'Upgrade prices could not load. Reload the page to try again.' }));
      setSaveEnabled(false);
      return;
    }
    if (root._companyProfileLoaded !== true) {
      host.setAttribute('data-state', 'loading');
      host.textContent = '';
      host.appendChild(el('p', { className: 'upg-loading', text: 'Loading your saved upgrade prices…' }));
      setSaveEnabled(false);
      waitForProfile();
      return;
    }
    // Repainting over another tenant's rows (see onProfileLanded): say so
    // below if that drops a change the rep had made to them.
    var dropped = paintedForAnotherTenant(host) && editedSincePaint(host);
    var entries = savedEntries(root._companyProfile);
    // What this device is showing as saved: the baseline changedEntries
    // compares against, so a save sends only what was edited here.
    _painted = entries;
    _paintedKey = loadedKey();
    var editable = canEdit(root._userClaims, root._user && root._user.uid);
    var L = LIB();

    host.textContent = '';
    if (!editable) {
      host.appendChild(el('p', { className: 'upg-readonly', text: 'Upgrade prices are company-wide. Only an owner or company admin can change them.' }));
    }
    var tl = TRADE_LABELS[L.trade] || { title: L.trade, noun: L.trade };
    // A div, not a <section>: a sitewide section rule pads it 16px a side,
    // which cost every row 32px at phone width.
    var trade = el('div', { className: 'upg-trade', role: 'group', 'aria-labelledby': 'upg-trade-' + L.trade }, [
      el('h4', { className: 'upg-trade-hdr', id: 'upg-trade-' + L.trade, text: tl.title })
    ]);
    // Pick-one groups first, in library order, then everything ungrouped.
    var groups = [];
    var seen = {};
    L.items.forEach(function (it) {
      var g = it.group || '';
      if (!seen[g]) { seen[g] = { key: g, items: [] }; groups.push(seen[g]); }
      seen[g].items.push(it);
    });
    groups.sort(function (a, b) { return (a.key ? 0 : 1) - (b.key ? 0 : 1); });
    groups.forEach(function (g) {
      var meta = g.key && L.groups[g.key];
      var hdrId = 'upg-grp-' + (g.key || 'other');
      var hdr = el('div', { className: 'upg-group-hdr', id: hdrId }, [
        el('span', { text: meta ? meta.label : 'Other ' + tl.noun + ' upgrades' }),
        meta && meta.pick === 'one' ? el('span', { className: 'upg-group-note', text: 'A rep can add one per estimate' }) : null
      ]);
      var box = el('div', { className: 'upg-group', role: 'group', 'aria-labelledby': hdrId }, [hdr]);
      g.items.forEach(function (it) { box.appendChild(buildRow(it, entries[it.id], editable)); });
      trade.appendChild(box);
    });
    host.appendChild(trade);
    host.setAttribute('data-state', 'ready');
    host.setAttribute('data-editable', editable ? '1' : '0');
    wire(host);
    setSaveEnabled(editable);
    var b = document.getElementById(SAVE_ID);
    if (b && !editable) b.hidden = true;
    if (dropped) setMessage('Your company’s saved upgrade prices just loaded and replaced the changes you had made here. Make them again, then press Save.', 'error');
  }

  // savedEntries of the profile the rows were last painted from, updated by
  // markSaved after a write lands. null until the first render.
  var _painted = null;

  // WHICH tenant's server copy the rows were painted from (2026-09-25, PR
  // #1774 review). After an account switch in the same tab the panel still
  // reads "ready" with the previous account's rows and edits, while the
  // company profile has been reset under it — its own Save, or Save All,
  // would then write those edits to the new account's company. A panel
  // painted for any other tenant than the one now loaded is not saveable.
  // (Without company-profile.js's _companyProfileLoadedKey there is nothing
  // to compare, and the panel's own state decides, as before.)
  var _paintedKey = null;
  function loadedKey() {
    return typeof root._companyProfileLoadedKey === 'function' ? root._companyProfileLoadedKey() : null;
  }
  function paintedForLoadedProfile() {
    if (typeof root._companyProfileLoadedKey !== 'function') return true;
    var k = root._companyProfileLoadedKey();
    return k != null && k === _paintedKey;
  }

  /**
   * collect() → null when the panel must not be saved (not painted from a
   * hydrated profile, or read-only for this user); otherwise
   * { map, changes, errors }: map from buildSaveMap (every row), changes =
   * only the entries edited on this device since the paint (changedEntries)
   * — the ONLY part either save writes. Save All (_saveEstimateDefaultsV2)
   * uses this too, so an edit here is never silently discarded by it, and an
   * untouched panel adds nothing to its write.
   */
  function collect() {
    var host = document.getElementById(HOST_ID);
    if (!host || host.getAttribute('data-state') !== 'ready' || host.getAttribute('data-editable') !== '1') return null;
    if (!paintedForLoadedProfile()) return null;
    var forms = {};
    host.querySelectorAll('[data-upg-id]').forEach(function (row) {
      forms[row.getAttribute('data-upg-id')] = formOfRow(row);
    });
    var out = buildSaveMap(forms);
    out.changes = out.map ? changedEntries(out.map, _painted) : null;
    host.querySelectorAll('[data-upg-id]').forEach(refreshRow);
    return out;
  }

  /**
   * markSaved(changes) — a write of `changes` landed: they are now what this
   * device shows as saved, so pressing Save (or Save All) again does not
   * resend them over a newer save from another device.
   */
  function markSaved(changes) {
    if (!changes || typeof changes !== 'object') return;
    if (!_painted) _painted = {};
    Object.keys(changes).forEach(function (id) {
      var e = changes[id] || {};
      _painted[id] = {
        cents: Number.isInteger(e.cents) ? e.cents : null,
        enabled: e.enabled !== false,
        installerName: typeof e.installerName === 'string' ? e.installerName : ''
      };
    });
  }

  function isDenied(e) {
    var code = (e && (e.code || e.message)) || '';
    return /permission[-_ ]denied|insufficient permissions|PERMISSION_DENIED/i.test(String(code));
  }

  var _saving = false;
  /** save() — the panel's own Save button (delegated data-action="module"). */
  async function save() {
    if (_saving) return { ok: false, reason: 'busy' };
    var host = document.getElementById(HOST_ID);
    if (!host || host.getAttribute('data-state') !== 'ready') {
      setMessage('Your saved upgrade prices are still loading. Try again in a moment.', 'error');
      return { ok: false, reason: 'loading' };
    }
    if (host.getAttribute('data-editable') !== '1') {
      setMessage('Only an owner or company admin can change upgrade prices.', 'error');
      return { ok: false, reason: 'readonly' };
    }
    // Painted for another account's company (see _paintedKey): repaint for
    // this one — the loading line until its profile lands — and send nothing.
    if (!paintedForLoadedProfile()) {
      render();
      setMessage('Your saved upgrade prices are still loading. Nothing was saved — make your change again once they appear.', 'error');
      return { ok: false, reason: 'loading' };
    }
    var c = collect();
    if (!c || c.errors.length) {
      var first = c && c.errors[0] && document.getElementById('upg-price-' + c.errors[0].id);
      if (first) { try { first.focus({ preventScroll: false }); } catch (_) { first.focus(); } }
      setMessage('Fix the highlighted price first. Nothing was saved.', 'error');
      return { ok: false, reason: 'invalid', errors: c ? c.errors : [] };
    }
    var changes = c.changes || {};
    if (!Object.keys(changes).length) {
      // Nothing edited here since the paint: writing the whole map anyway is
      // exactly what reverted other devices' saves (see STORAGE above).
      setMessage('No changes to save.', 'ok');
      return { ok: true, changes: {}, unchanged: true };
    }
    if (typeof root._saveCompanyProfile !== 'function') {
      setMessage('Saving is unavailable right now. Reload the page and try again.', 'error');
      return { ok: false, reason: 'unavailable' };
    }
    // The tenant this write lands on must be the one the rows were painted
    // for (2026-09-25, second review of #1774). The check above compares the
    // paint with the profile in memory; the account's company can change
    // under this tab before anything re-reads it, and _saveCompanyProfile
    // resolves its own key — so these edits, made over one company's prices,
    // went to the other. Ask for the key it will use.
    _saving = true;
    var key = null;
    try { key = typeof root._resolveCompanyKey === 'function' ? await root._resolveCompanyKey() : null; } catch (_) { key = null; } finally { _saving = false; }
    if (key != null && _paintedKey != null && String(key) !== String(_paintedKey)) {
      // The profile in memory is not this company's either: forget it, and
      // repaint for this one — the loading line until its profile lands.
      if (typeof root._resetCompanyProfile === 'function') root._resetCompanyProfile();
      render();
      setMessage('Your saved upgrade prices are still loading. Nothing was saved — make your change again once they appear.', 'error');
      return { ok: false, reason: 'loading' };
    }
    _saving = true;
    var btn = document.getElementById(SAVE_ID);
    if (btn) btn.disabled = true;
    setMessage('Saving…', 'busy');
    try {
      await root._saveCompanyProfile({ pricing: { upgradePrices: changes } });
      markSaved(changes);
      setMessage('✓ Upgrade prices saved for your whole company.', 'ok');
      if (typeof root.showToast === 'function') root.showToast('✓ Upgrade prices saved', 'success');
      return { ok: true, changes: changes };
    } catch (e) {
      // _saveCompanyProfile updates the in-memory profile BEFORE the write,
      // so a refused write would leave this device quoting prices the
      // company never saved. Re-read the server copy (the form keeps what
      // was typed, so nothing is lost on screen).
      try { if (typeof root._loadCompanyProfile === 'function') await root._loadCompanyProfile(); } catch (_) { /* keep the message */ }
      setMessage(isDenied(e)
        ? 'Not saved. Upgrade prices are company-wide: ask an owner or company admin to change them.'
        : 'Not saved. Check your connection and press Save again.', 'error');
      return { ok: false, reason: isDenied(e) ? 'denied' : 'failed' };
    } finally {
      _saving = false;
      if (btn) btn.disabled = false;
    }
  }

  root.NBDUpgradePriceSettings = Object.freeze({
    // pure
    parseDollars: parseDollars,
    centsToInput: centsToInput,
    money: money,
    savedEntries: savedEntries,
    describe: describe,
    buildSaveMap: buildSaveMap,
    changedEntries: changedEntries,
    canEdit: canEdit,
    // DOM
    render: render,
    collect: collect,
    markSaved: markSaved,
    save: save
  });
})(typeof window !== 'undefined' ? window : this);
