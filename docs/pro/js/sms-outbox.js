/**
 * sms-outbox.js — window.NBDSmsOutbox: texts written offline, sent when the
 * app is back online, and only if nothing changed in the meantime.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * NBDComms.sendSMS used to answer "no network" by opening the rep's own
 * Messages app with the text filled in. Over plain cellular SMS that sends
 * immediately — with no opt-out check and nothing in sms_log. The approved
 * replacement (Jo, 2026-09-18): keep the text, and on reconnect check the
 * number's status first, check for competing messages, and send in order.
 *
 * ── The approved defaults ────────────────────────────────────────────────
 *   - Auto-send on reconnect only if the text is less than 15 minutes old.
 *   - Queued texts only ever auto-send between 08:00 and 21:00
 *     America/New_York (the SERVER decides this; see
 *     functions/sms-outbox-guard.js).
 *   - Anything else waits in the "Pending texts" tray for an explicit tap.
 *
 * ── What happens where ───────────────────────────────────────────────────
 *   nbd-comms.js   sendSMS cannot reach the server (navigator.onLine false,
 *                  fetch rejects, or the 25s abort) → enqueue() here, toast
 *                  "Queued …", return { success: true, mode: 'queued' }.
 *   this file      flush() on 'online', on page load once auth is ready, and
 *                  on visibilitychange → visible. Oldest first, one recipient
 *                  at a time, in order per recipient. Stale (≥15 min) → held.
 *                  Identical text to the same number already pending →
 *                  the newer copy is discarded as 'duplicate' (recorded, not
 *                  silently deleted). Each text goes through the SAME sendSMS
 *                  endpoint via NBDComms.sendQueued with { queued: true,
 *                  clientMsgId, queuedAt, leadStageAtQueue }.
 *   sendSMS        opt-out first (403), then idempotency, quiet hours,
 *                  staleness, competing activity (409 held), then the paid
 *                  gate / limiters / Twilio.
 *   the tray       a "Pending texts (N)" pill → modal listing each held or
 *                  queued text with Send now / Send anyway / Edit / Discard.
 *
 * NOTHING in the flush path opens an sms: handoff. The one handoff this file
 * can open is the tray's explicit "Open in Messages" on a text the server
 * answered 402 / 429 / provider_error — answers that, for a queued text, come
 * only after the opt-out register, quiet hours and the activity checks passed
 * (the same contract nbd-comms.js applies to a live 402/429).
 *
 * ── Storage: its own IndexedDB, not offline-manager's ────────────────────
 * Same reasoning as photo-queue-store.js's header: offline-manager.js's
 * `nbd-offline-db` / `pending-writes` store is the one sw.js's
 * flushOfflineQueue() replays as raw fetch(item.url, …) and deletes. A text
 * written there is one revived code path away from being sent by a service
 * worker with no opt-out check, no idempotency and no hold logic. So: DB
 * `nbd-sms-outbox-db`, store `outbox`, keyed by the client message id.
 *
 * ── PII on the device ────────────────────────────────────────────────────
 * A record holds the recipient's phone number and the message until it is
 * sent (then removed) or discarded. Every record carries the uid that wrote
 * it and every read filters on the signed-in uid. The WHOLE store is purged
 * on sign-out (nbd-auth.js purgeAccountStorage/logout, the dashboard's
 * _signOut) and on account switch (purgeAccountStorage's uid-change path,
 * plus this module's own boot check). Same class of data as the photo queue.
 *
 * ── No IndexedDB (private mode, storage disabled) ────────────────────────
 * enqueue() rejects with reason 'unavailable' and nbd-comms.js falls back to
 * the pre-outbox behaviour — the device-Messages handoff. Deliberately NOT a
 * localStorage queue: that would be phone numbers and message text in plain
 * synchronous storage that every script on the origin reads, with no
 * transaction to make the queued→sending step atomic across tabs.
 *
 * ── Deliberately not built ───────────────────────────────────────────────
 * No background send while the app is closed (no Background Sync — a text
 * must be re-checked by a live page with a signed-in rep). Email is unchanged.
 *
 * CSP: no inline handlers — one delegated click listener below, keyed on
 * [data-sms-outbox-action].
 */
(function () {
  'use strict';
  if (window.NBDSmsOutbox) return;

  const DB_NAME = 'nbd-sms-outbox-db';
  const DB_STORE = 'outbox';
  const DB_VERSION = 1;

  // Per signed-in user. Past this, enqueue() refuses out loud — the caller
  // tells the rep, nothing is dropped and nothing is handed off.
  const MAX_PER_USER = 50;
  // Mirrors functions/sms-outbox-guard.js STALE_MS (the server enforces it
  // too; tests/sms-outbox-server.test.js pins that the two agree).
  const STALE_MS = 15 * 60 * 1000;
  // A 'sending' record older than this was orphaned by a page that died
  // mid-request (well past nbd-comms.js's 25s abort). Replaying it is safe:
  // same clientMsgId, so the server answers "duplicate" if it already went.
  const SENDING_ORPHAN_MS = 2 * 60 * 1000;
  // A discarded record (duplicate / opted out) stays visible in the tray for
  // a day so the rep can see what happened, then is pruned.
  const DISCARDED_KEEP_MS = 24 * 60 * 60 * 1000;
  // Retry cadence while the page believes it is online but the server was
  // unreachable (captive portal, DNS, a 503 from a check that could not run).
  const RETRY_MS = 60 * 1000;

  const LOCK_NAME = 'nbd-sms-outbox-flush';
  const LEASE_KEY = 'nbd_sms_outbox_lease';
  const LEASE_MS = 45 * 1000;

  const ACTIVE = { queued: 1, sending: 1, held: 1 };

  // Server answers the tray may turn into a device handoff on an explicit tap
  // (see the header): each comes only after the opt-out + hold checks passed.
  const HANDOFF_OK = { plan_required: 1, rate_limited: 1, provider_error: 1 };
  // Holds the rep may override with "Send anyway" (overrideActivity). The
  // server enforces the same list; this only decides which button to show.
  const ACTIVITY_HOLDS = { recent_outbound: 1, recent_inbound: 1, lead_changed: 1 };

  const REASON_TEXT = {
    queued: 'Waiting for a connection',
    queued_behind: 'Waiting behind an earlier text to this number',
    sending: 'Sending…',
    stale: 'Waiting — sent more than 15 min ago',
    quiet_hours: 'Quiet hours — can send after 8am',
    recent_inbound: 'Homeowner texted you since',
    recent_outbound: 'Someone already texted this number',
    lead_changed: 'Lead changed',
    lead_gone: 'Lead was deleted',
    in_flight: 'Already being sent — check the conversation first',
    plan_required: 'Texting from the app needs a paid plan',
    rate_limited: 'Text limit reached — try later',
    provider_error: 'Text provider error — try again',
    invalid: 'Couldn\'t send — check the number or message',
    refused: 'Couldn\'t send to this number',
    error: 'Couldn\'t send',
    opted_out: 'Opted out',
    duplicate: 'Duplicate — the same text was already waiting',
  };

  function _now() { return Date.now(); }

  function _fail(reason, message) {
    const e = new Error(message);
    e.reason = reason;
    return e;
  }

  function _toast(msg, type) {
    try { if (typeof window.showToast === 'function') window.showToast(msg, type); } catch (_) {}
  }

  // Byte-identical to functions/phone-utils.js phoneDigits10 (the browser
  // lead-write paths inline the same one-liner).
  function _digits10(phone) {
    return String(phone == null ? '' : phone).replace(/\D/g, '').replace(/^1/, '').slice(-10);
  }

  function _newId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    } catch (_) {}
    try {
      if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
        const b = new Uint8Array(16);
        window.crypto.getRandomValues(b);
        return Array.prototype.map.call(b, (x) => ('0' + x.toString(16)).slice(-2)).join('');
      }
    } catch (_) {}
    // Last resort. Uniqueness matters (it is the idempotency key), secrecy
    // does not: the server scopes it per uid.
    return 'm' + _now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }

  function _uid() {
    const u = window._user
      || (window.auth && window.auth.currentUser)
      || (window._auth && window._auth.currentUser)
      || null;
    return (u && typeof u.uid === 'string' && u.uid) || null;
  }

  // ── IndexedDB ─────────────────────────────────────────────────────────
  let _db = null;
  let _openPromise = null;

  function _forget() { _db = null; _openPromise = null; }

  function _open() {
    if (_db) return Promise.resolve(_db);
    if (_openPromise) return _openPromise;
    const attempt = new Promise((resolve) => {
      let req;
      try {
        if (!window.indexedDB) { resolve(null); return; }
        req = window.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        // Private-mode Safari throws from open() itself.
        resolve(null);
        return;
      }
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(DB_STORE)) d.createObjectStore(DB_STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => {
        const d = req.result;
        try {
          d.onclose = () => { if (_db === d) _forget(); };
          // purgeAll() fallbacks and nbd-auth.js delete the whole database;
          // an open connection that ignored versionchange would block that.
          d.onversionchange = () => { try { d.close(); } catch (_) {} if (_db === d) _forget(); };
        } catch (_) {}
        _db = d;
        resolve(d);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    _openPromise = attempt;
    // A failed open must not be cached (see photo-queue-store.js _open):
    // drop the memo after the assignment above, in a microtask.
    attempt.then((d) => { if (!d && _openPromise === attempt) _openPromise = null; });
    return attempt;
  }

  /**
   * One transaction. `body(store, done, refuse)` issues requests; `done(v)`
   * sets the resolved value, `refuse(err)` aborts and rejects with err.
   * Resolves only once the transaction COMMITS.
   */
  function _run(mode, body) {
    return _open().then((db) => {
      if (!db) throw _fail('unavailable', 'SMS outbox storage unavailable');
      let tx;
      try {
        tx = db.transaction(DB_STORE, mode);
      } catch (e) {
        _forget();
        throw _fail('unavailable', 'SMS outbox transaction failed: ' + (e && e.name));
      }
      return new Promise((resolve, reject) => {
        let value;
        let refusal = null;
        tx.oncomplete = () => { if (refusal) reject(refusal); else resolve(value); };
        tx.onabort = () => {
          if (refusal) { reject(refusal); return; }
          const name = tx.error && tx.error.name;
          reject(_fail(name === 'QuotaExceededError' ? 'quota' : 'write-failed',
            'SMS outbox transaction aborted: ' + (name || 'unknown')));
        };
        const done = (v) => { value = v; };
        const refuse = (err) => { refusal = err; try { tx.abort(); } catch (_) {} };
        try {
          body(tx.objectStore(DB_STORE), done, refuse);
        } catch (e) {
          refuse(_fail('write-failed', 'SMS outbox request failed: ' + (e && (e.name || e.message))));
        }
      });
    });
  }

  function _all() {
    return _run('readonly', (store, done) => {
      const r = store.getAll();
      r.onsuccess = () => done(Array.isArray(r.result) ? r.result : []);
    });
  }

  /**
   * Read-modify-write ONE record in ONE transaction. `mutate(copy)` returns
   * the new record, or null to leave it alone — e.g. because another tab
   * already moved it. Resolves to the stored record, or null.
   */
  function _mutate(id, uid, mutate) {
    return _run('readwrite', (store, done) => {
      const r = store.get(id);
      r.onsuccess = () => {
        const cur = r.result;
        if (!cur || cur.uid !== uid) { done(null); return; }
        const next = mutate(Object.assign({}, cur));
        if (!next) { done(null); return; }
        next.updatedAt = _now();
        store.put(next);
        done(next);
      };
    });
  }

  function _remove(id, uid) {
    return _run('readwrite', (store, done) => {
      const r = store.get(id);
      r.onsuccess = () => {
        const cur = r.result;
        if (!cur || cur.uid !== uid) { done(false); return; }
        store.delete(id);
        done(true);
      };
    });
  }

  function _byAge(a, b) {
    return (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }

  let _persistAsked = false;
  function _requestPersistence() {
    if (_persistAsked) return;
    _persistAsked = true;
    try {
      if (navigator.storage && typeof navigator.storage.persist === 'function') {
        navigator.storage.persisted()
          .then((already) => (already ? true : navigator.storage.persist()))
          .catch(() => false);
      }
    } catch (_) {}
  }

  // ── Public store API ──────────────────────────────────────────────────

  /**
   * Store one text. Resolves to the record once COMMITTED; rejects with
   * e.reason: 'bad-item' | 'unavailable' | 'queue-full' | 'quota' | 'write-failed'.
   */
  async function enqueue(input) {
    const i = input || {};
    const uid = typeof i.uid === 'string' ? i.uid : '';
    const to = typeof i.to === 'string' ? i.to.trim() : '';
    const body = typeof i.body === 'string' ? i.body : '';
    if (!uid) throw _fail('bad-item', 'SMS outbox needs the signed-in user');
    if (!to || !_digits10(to)) throw _fail('bad-item', 'SMS outbox needs a phone number');
    if (!body.trim()) throw _fail('bad-item', 'SMS outbox needs a message');
    const createdAt = (typeof i.createdAt === 'number' && isFinite(i.createdAt)) ? i.createdAt : _now();
    const rec = {
      id: _newId(),
      uid: uid,
      to: to,
      toDigits: _digits10(to),
      body: body,
      leadId: (typeof i.leadId === 'string' && i.leadId) || null,
      knockId: (typeof i.knockId === 'string' && i.knockId) || null,
      source: (typeof i.source === 'string' && i.source) || null,
      sourceRef: (typeof i.sourceRef === 'string' && i.sourceRef) || null,
      leadStageAtQueue: (typeof i.leadStageAtQueue === 'string' && i.leadStageAtQueue) || null,
      createdAt: createdAt,
      status: 'queued',
      heldReason: null,
      heldMessage: null,
      attempts: 0,
      overrides: {},
      updatedAt: _now(),
    };
    _requestPersistence();
    const stored = await _run('readwrite', (store, done, refuse) => {
      const r = store.getAll();
      r.onsuccess = () => {
        const rows = Array.isArray(r.result) ? r.result : [];
        // Counted INSIDE the write transaction, so two tabs enqueueing at
        // once cannot both squeeze past the cap.
        const active = rows.filter((x) => x && x.uid === uid && ACTIVE[x.status]).length;
        if (active >= MAX_PER_USER) {
          refuse(_fail('queue-full', 'SMS outbox is full (' + MAX_PER_USER + ')'));
          return;
        }
        store.add(rec);
        done(rec);
      };
    });
    _changed();
    // Queued while the browser still says "online" means the server was
    // unreachable for some other reason; no 'online' event will come.
    if (typeof navigator === 'undefined' || navigator.onLine !== false) _scheduleRetry();
    return stored;
  }

  /** The signed-in user's records, oldest first. Rejects when storage is unusable. */
  async function list(uid) {
    const u = uid || _uid();
    if (!u) return [];
    const rows = await _all();
    return rows.filter((r) => r && r.uid === u && r.status !== 'sent').sort(_byAge);
  }

  /** How many texts are waiting (queued / sending / held) for the signed-in user; null when unknown. */
  async function pendingCount(uid) {
    try {
      const rows = await list(uid);
      return rows.filter((r) => ACTIVE[r.status]).length;
    } catch (_) {
      return null;
    }
  }

  /** Delete EVERY record for EVERY user. Sign-out / account switch. */
  async function purgeAll() {
    let ok = false;
    try {
      ok = await _run('readwrite', (store, done) => { store.clear(); done(true); });
    } catch (_) {
      ok = false;
    }
    _hidePill();
    _closeTray();
    return !!ok;
  }

  /** Account switch on this device: drop every record that is not `uid`'s. */
  async function _purgeOtherUsers(uid) {
    if (!uid) return 0;
    return _run('readwrite', (store, done) => {
      const r = store.getAll();
      r.onsuccess = () => {
        let n = 0;
        (Array.isArray(r.result) ? r.result : []).forEach((x) => {
          if (x && x.uid !== uid) { store.delete(x.id); n++; }
        });
        done(n);
      };
    });
  }

  // ── Flush ─────────────────────────────────────────────────────────────
  const TAB_ID = _newId();
  let _flushing = null;
  let _flushAgain = false;
  let _retryTimer = null;
  let _lastUid = null;

  function _acquireLease() {
    try {
      const now = _now();
      const raw = localStorage.getItem(LEASE_KEY);
      const cur = raw ? JSON.parse(raw) : null;
      if (cur && cur.owner !== TAB_ID && cur.until > now) return false;
      localStorage.setItem(LEASE_KEY, JSON.stringify({ owner: TAB_ID, until: now + LEASE_MS }));
      const back = JSON.parse(localStorage.getItem(LEASE_KEY) || 'null');
      return !!back && back.owner === TAB_ID;
    } catch (_) {
      // No usable localStorage: tabs cannot coordinate here. Going on is still
      // safe — every text moves queued → sending inside an IndexedDB
      // transaction first (two tabs cannot both take it), and the server's
      // clientMsgId claim stops a double send even if they somehow did.
      return true;
    }
  }

  function _releaseLease() {
    try {
      const cur = JSON.parse(localStorage.getItem(LEASE_KEY) || 'null');
      if (cur && cur.owner === TAB_ID) localStorage.removeItem(LEASE_KEY);
    } catch (_) {}
  }

  function _scheduleRetry() {
    if (_retryTimer) return;
    _retryTimer = setTimeout(() => { _retryTimer = null; flush('retry'); }, RETRY_MS);
  }

  /**
   * Send what can be sent. Single-flight: one flush per tab (concurrent calls
   * share it) and one per origin (navigator.locks, else a localStorage lease).
   * Resolves to a summary; never rejects.
   */
  function flush(reason) {
    if (_flushing) {
      // A run is already going, but it may have read the queue before the
      // text that prompted this call was stored. Join it, and run once more
      // after it (one trailing run, however many calls pile up).
      _flushAgain = true;
      return _flushing;
    }
    _flushing = (async () => {
      try {
        return await _flushLocked(reason || 'manual');
      } catch (e) {
        console.warn('[NBDSmsOutbox] flush failed:', e && e.message);
        return { skipped: 'error' };
      } finally {
        _flushing = null;
        if (_flushAgain) {
          _flushAgain = false;
          setTimeout(() => { flush('trailing'); }, 0);
        }
      }
    })();
    return _flushing;
  }

  async function _flushLocked(reason) {
    const uid = _uid();
    if (!uid) return { skipped: 'no-user' };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { skipped: 'offline' };
    if (!window.NBDComms || typeof window.NBDComms.sendQueued !== 'function') return { skipped: 'no-comms' };
    if (_lastUid !== uid) {
      // First flush for this user in this page, or the account changed under
      // us: whatever another account left here is not ours to send or show.
      try { await _purgeOtherUsers(uid); } catch (_) {}
      _lastUid = uid;
    }
    const locks = (typeof navigator !== 'undefined' && navigator.locks
      && typeof navigator.locks.request === 'function') ? navigator.locks : null;
    if (locks) {
      return locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
        if (!lock) return { skipped: 'busy' };
        return _flushInner(uid, reason);
      });
    }
    if (!_acquireLease()) return { skipped: 'busy' };
    try {
      return await _flushInner(uid, reason);
    } finally {
      _releaseLease();
    }
  }

  async function _flushInner(uid, reason) {
    const summary = { reason: reason, sent: 0, held: 0, duplicates: 0, optedOut: 0, stoppedBy: null };
    let rows;
    try {
      rows = (await _all()).filter((r) => r && r.uid === uid).sort(_byAge);
    } catch (_) {
      summary.stoppedBy = 'storage';
      return summary;
    }

    const start = _now();

    // Housekeeping: a 'sent' row whose removal did not commit is removed now;
    // orphaned 'sending' rows go back to 'queued'; old discarded rows are
    // pruned.
    for (const r of rows) {
      if (r.status === 'sent') {
        await _remove(r.id, uid).catch(() => false);
        r.status = 'pruned';
      } else if (r.status === 'sending' && start - (r.sendingAt || r.updatedAt || 0) > SENDING_ORPHAN_MS) {
        const back = await _mutate(r.id, uid, (cur) => (cur.status === 'sending'
          ? Object.assign(cur, { status: 'queued' }) : null)).catch(() => null);
        if (back) Object.assign(r, back);
      } else if (r.status === 'discarded' && start - (r.discardedAt || r.updatedAt || 0) > DISCARDED_KEEP_MS) {
        await _remove(r.id, uid).catch(() => false);
        r.status = 'pruned';
      }
    }

    // Duplicate collapse: the same text to the same number is already
    // pending → the NEWER queued copy is discarded and recorded as such.
    // A held copy is left for the rep; only queued copies collapse.
    const firstByText = {};
    for (const r of rows) {
      if (!ACTIVE[r.status]) continue;
      const key = r.toDigits + '\u0000' + r.body;
      if (!firstByText[key]) { firstByText[key] = r.id; continue; }
      if (r.status !== 'queued') continue;
      const keep = firstByText[key];
      const dup = await _mutate(r.id, uid, (cur) => (cur.status === 'queued'
        ? Object.assign(cur, { status: 'discarded', heldReason: 'duplicate', duplicateOf: keep, discardedAt: _now() })
        : null)).catch(() => null);
      if (dup) { Object.assign(r, dup); summary.duplicates++; }
    }

    // Per-recipient FIFO. Recipients in order of their oldest pending text;
    // within a recipient, strictly in order — a text that does not go (held,
    // or still in flight elsewhere) holds back every later one to that number.
    const order = [];
    const byRecipient = {};
    for (const r of rows) {
      if (!ACTIVE[r.status]) continue;
      if (!byRecipient[r.toDigits]) { byRecipient[r.toDigits] = []; order.push(r.toDigits); }
      byRecipient[r.toDigits].push(r);
    }

    outer:
    for (const key of order) {
      for (const r of byRecipient[key]) {
        if (r.status !== 'queued') break;           // held / sending ahead of it
        if (_now() - r.createdAt >= STALE_MS) {
          // Too old to send without the rep looking at it. No server call.
          const held = await _mutate(r.id, uid, (cur) => (cur.status === 'queued'
            ? Object.assign(cur, { status: 'held', heldReason: 'stale', heldMessage: null, heldAt: _now() })
            : null)).catch(() => null);
          if (held) summary.held++;
          break;
        }
        const step = await _sendOne(r, uid, cur => cur.status === 'queued', {}, summary, false);
        if (step === 'stop-all') break outer;
        if (step !== 'continue') break;
      }
    }

    if (summary.stoppedBy === 'network' || summary.stoppedBy === 'retry') {
      if (typeof navigator === 'undefined' || navigator.onLine !== false) _scheduleRetry();
    }
    _announce(summary);
    _changed();
    return summary;
  }

  /**
   * Move one record to 'sending' (only if `canTake(cur)` — the cross-tab
   * compare-and-set), replay it, and record the outcome. Returns
   * 'continue' | 'stop-recipient' | 'stop-all' | 'skipped'.
   */
  async function _sendOne(r, uid, canTake, overrides, summary, explicit) {
    const prev = { status: r.status, heldReason: r.heldReason || null, heldMessage: r.heldMessage || null };
    let claimed;
    try {
      claimed = await _mutate(r.id, uid, (cur) => (canTake(cur)
        ? Object.assign(cur, {
          status: 'sending',
          sendingAt: _now(),
          attempts: (cur.attempts || 0) + 1,
          // What THIS attempt was allowed to skip — never carried over from
          // an earlier tap, which answered a different, older hold.
          overrides: Object.assign({}, overrides || {}),
        })
        : null));
    } catch (_) {
      summary.stoppedBy = 'storage';
      return 'stop-all';
    }
    if (!claimed) return 'skipped';                 // another tab moved it first

    // Consent is per tap: an automatic flush never carries an override, even
    // for a record the rep once tapped (and whose send then failed offline).
    const ov = explicit ? (claimed.overrides || {}) : {};
    let res;
    try {
      res = await window.NBDComms.sendQueued(claimed, {
        overrideStale: ov.stale === true,
        overrideActivity: ov.activity === true,
      });
    } catch (e) {
      res = { outcome: 'network', message: e && e.message };
    }
    res = res || { outcome: 'retry' };
    const setStatus = (patch) => _mutate(claimed.id, uid, (cur) => (cur.status === 'sending'
      ? Object.assign(cur, patch) : null)).catch(() => null);

    switch (res.outcome) {
      case 'sent':
      case 'duplicate': {
        await setStatus({ status: 'sent', sentAt: _now(), sid: res.sid || null });
        await _remove(claimed.id, uid).catch(() => false);
        summary.sent++;
        try {
          window.dispatchEvent(new CustomEvent('nbd:sms-outbox-sent', {
            detail: {
              id: claimed.id, leadId: claimed.leadId, knockId: claimed.knockId,
              source: claimed.source, sourceRef: claimed.sourceRef,
              sid: res.sid || null, duplicate: res.outcome === 'duplicate',
            },
          }));
        } catch (_) {}
        return 'continue';
      }
      case 'opted_out': {
        await setStatus({ status: 'discarded', heldReason: 'opted_out', heldMessage: res.message || null, discardedAt: _now() });
        summary.optedOut++;
        _toast('Queued text to ' + _mask(claimed.toDigits) + ' was NOT sent — they opted out of texts (replied STOP).', 'error');
        return 'continue';
      }
      case 'held':
      case 'refused': {
        await setStatus({
          status: 'held',
          heldReason: res.reason || (res.outcome === 'refused' ? 'refused' : 'error'),
          heldMessage: res.message || null,
          heldAt: _now(),
        });
        summary.held++;
        return 'stop-recipient';
      }
      default: {
        // network / retry / auth: it never got a verdict. Put it back exactly
        // as it was — a flush's text stays queued, an explicit tap's stays held.
        await setStatus(prev);
        summary.stoppedBy = res.outcome === 'auth' ? 'auth' : (res.outcome === 'retry' ? 'retry' : 'network');
        if (explicit) summary.lastMessage = res.message || null;
        return 'stop-all';
      }
    }
  }

  function _announce(summary) {
    if (summary.sent > 0) {
      _toast(summary.sent === 1 ? 'Queued text sent' : ('Sent ' + summary.sent + ' queued texts'), 'success');
    }
    if (summary.held > 0) {
      _toast(summary.held === 1
        ? '1 queued text needs your OK — open Pending texts'
        : (summary.held + ' queued texts need your OK — open Pending texts'), 'warning');
    }
    if (summary.duplicates > 0) {
      _toast(summary.duplicates === 1
        ? 'Dropped 1 duplicate queued text'
        : ('Dropped ' + summary.duplicates + ' duplicate queued texts'), 'info');
    }
  }

  // ── Explicit actions (the tray) ───────────────────────────────────────

  async function _find(id) {
    const uid = _uid();
    if (!uid) return { uid: null, rec: null };
    const rows = await list(uid);
    return { uid: uid, rec: rows.find((r) => r.id === id) || null };
  }

  /**
   * The rep tapped "Send now" (or "Send anyway" with { activity: true }).
   * An explicit tap is the review the 15-minute rule asks for, so it always
   * carries overrideStale; "Send anyway" adds overrideActivity, which the
   * server honours only for recent_outbound / recent_inbound / lead_changed.
   * Opt-out, quiet hours and idempotency still apply.
   */
  async function sendNow(id, opts) {
    const found = await _find(id).catch(() => ({ rec: null }));
    const rec = found.rec;
    if (!rec || !(rec.status === 'held' || rec.status === 'queued')) return { outcome: 'noop' };
    if (!window.NBDComms || typeof window.NBDComms.sendQueued !== 'function') return { outcome: 'noop' };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      _toast('Still offline — the text stays in Pending texts.', 'warning');
      return { outcome: 'network' };
    }
    const overrides = { stale: true };
    if (opts && opts.activity === true) overrides.activity = true;
    const summary = { sent: 0, held: 0, duplicates: 0, optedOut: 0, stoppedBy: null };
    const step = await _sendOne(rec, found.uid,
      (cur) => cur.status === 'held' || cur.status === 'queued', overrides, summary, true);
    if (summary.sent) _toast('Text sent', 'success');
    else if (summary.held) {
      const after = await _find(id).catch(() => ({ rec: null }));
      const why = after.rec ? _reasonText(after.rec) : 'held';
      _toast('Not sent — ' + why + '.', 'warning');
    } else if (summary.stoppedBy) {
      _toast(summary.stoppedBy === 'auth'
        ? 'Sign in again to send texts — it stays in Pending texts.'
        : 'Could not reach the server — the text stays in Pending texts.', 'warning');
    } else if (step === 'skipped') {
      _toast('That text is already being sent.', 'info');
    }
    _changed();
    return { outcome: step, summary: summary };
  }

  /** The rep discards a pending text: it is removed, not sent. */
  async function discard(id) {
    const uid = _uid();
    if (!uid) return false;
    let ok = false;
    try { ok = await _remove(id, uid); } catch (_) { ok = false; }
    _changed();
    return ok;
  }

  /**
   * Edit the message and send it. A NEW client message id — the edited text
   * is a different text — but the ORIGINAL queue time, so activity since the
   * rep first wrote it is still checked.
   */
  async function editAndSend(id, newBody) {
    const body = typeof newBody === 'string' ? newBody : '';
    if (!body.trim()) { _toast('Message is empty.', 'error'); return { outcome: 'noop' }; }
    const uid = _uid();
    if (!uid) return { outcome: 'noop' };
    const newId = _newId();
    let edited = null;
    try {
      edited = await _run('readwrite', (store, done) => {
        const r = store.get(id);
        r.onsuccess = () => {
          const cur = r.result;
          if (!cur || cur.uid !== uid || !(cur.status === 'held' || cur.status === 'queued')) { done(null); return; }
          const next = Object.assign({}, cur, {
            id: newId, body: body, status: 'held', editedAt: _now(), updatedAt: _now(),
          });
          store.delete(id);
          store.add(next);
          done(next);
        };
      });
    } catch (_) { edited = null; }
    if (!edited) { _changed(); return { outcome: 'noop' }; }
    return sendNow(newId);
  }

  /**
   * Hand a text the server answered 402 / 429 / provider_error to the device
   * Messages app — an explicit tap only, never from flush(). Removes it from
   * the outbox: it now lives in Messages.
   */
  async function openInMessages(id) {
    const found = await _find(id).catch(() => ({ rec: null }));
    const rec = found.rec;
    if (!rec || rec.status !== 'held' || !HANDOFF_OK[rec.heldReason]) return false;
    const href = 'sms:' + encodeURIComponent(rec.to) + '?body=' + encodeURIComponent(rec.body || '');
    try {
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { try { a.remove(); } catch (_) {} }, 0);
    } catch (_) {
      try { window.location.href = href; } catch (__) {}
    }
    await _remove(rec.id, found.uid).catch(() => false);
    _toast('Opened in Messages — send it from there.', 'info');
    _changed();
    return true;
  }

  // ── Tray UI ───────────────────────────────────────────────────────────
  const PILL_ID = 'nbd-sms-outbox-pill';
  const MODAL_ID = 'nbd-sms-outbox-modal';
  let _renderQueued = false;
  let _bc = null;

  function _mask(toDigits) {
    const d = String(toDigits || '');
    return d.length >= 4 ? '(•••) •••-' + d.slice(-4) : '•••';
  }

  function _age(ms) {
    const s = Math.max(0, Math.round((_now() - ms) / 1000));
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    if (h < 24) return h + ' h ago';
    return Math.round(h / 24) + ' d ago';
  }

  function _reasonText(r, behind) {
    if (r.status === 'discarded') return REASON_TEXT[r.heldReason] || 'Not sent';
    if (r.status === 'sending') return REASON_TEXT.sending;
    if (r.status === 'queued') return behind ? REASON_TEXT.queued_behind : REASON_TEXT.queued;
    return REASON_TEXT[r.heldReason] || REASON_TEXT.error;
  }

  function _ensureCss() {
    if (document.getElementById('nbd-sms-outbox-css')) return;
    const css = document.createElement('style');
    css.id = 'nbd-sms-outbox-css';
    // z: --z-fab — a floating control, UNDER overlays, toasts and the status
    // strips (dashboard-app.css z-scale). Bottom-LEFT, clear of the FAB rail
    // and the bottom-right toasts; rides above bottom strips via
    // --nbd-bottom-chrome and above #mobile-nav via --nbd-sms-pill-lift.
    css.textContent =
      '.nbd-sms-outbox-pill{position:fixed;left:calc(16px + env(safe-area-inset-left,0px));' +
      'bottom:calc(16px + var(--nbd-bottom-chrome,0px) + var(--nbd-sms-pill-lift,0px) + env(safe-area-inset-bottom,0px));' +
      'z-index:var(--z-fab,9900);display:none;align-items:center;gap:6px;min-height:36px;padding:8px 14px;' +
      'border-radius:999px;border:1px solid var(--gold,#D4A017);background:var(--s2,#1a1d23);color:var(--t,#e8eaf0);' +
      'font:inherit;font-size:13px;font-weight:600;box-shadow:0 6px 18px rgba(0,0,0,.35);cursor:pointer;}' +
      '.nbd-sms-outbox-pill.is-visible{display:inline-flex;}' +
      '.nbd-sms-outbox-pill:focus-visible{outline:2px solid var(--gold,#D4A017);outline-offset:2px;}' +
      '#' + MODAL_ID + ' .modal{max-width:520px;width:100%;max-height:80vh;overflow:auto;}' +
      '.nbd-sms-ob-sub{font-size:12px;color:var(--m,#9aa3b2);margin:0 0 12px;line-height:1.45;}' +
      '.nbd-sms-ob-row{border:1px solid var(--br,rgba(255,255,255,.08));border-radius:8px;padding:10px 12px;margin-bottom:8px;}' +
      '.nbd-sms-ob-top{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--m,#9aa3b2);}' +
      '.nbd-sms-ob-to{font-weight:700;color:var(--t,#e8eaf0);}' +
      '.nbd-sms-ob-body{font-size:13px;color:var(--t,#e8eaf0);margin:6px 0;white-space:pre-wrap;word-break:break-word;}' +
      '.nbd-sms-ob-reason{font-size:12px;font-weight:600;color:var(--gold,#D4A017);margin-bottom:8px;}' +
      '.nbd-sms-ob-row.is-discarded .nbd-sms-ob-reason{color:var(--red,#E05252);}' +
      '.nbd-sms-ob-actions{display:flex;flex-wrap:wrap;gap:6px;}' +
      '.nbd-sms-ob-edit{width:100%;min-height:72px;margin:6px 0;box-sizing:border-box;font:inherit;font-size:13px;' +
      'background:var(--s,#111);color:var(--t,#e8eaf0);border:1px solid var(--br,rgba(255,255,255,.12));border-radius:6px;padding:8px;}' +
      '.nbd-sms-ob-empty{font-size:13px;color:var(--m,#9aa3b2);padding:12px 0;}' +
      '.nbd-sms-ob-foot{display:flex;justify-content:flex-end;margin-top:12px;}';
    (document.head || document.body).appendChild(css);
  }

  function _pill() {
    let el = document.getElementById(PILL_ID);
    if (el) return el;
    if (!document.body) return null;
    _ensureCss();
    el = document.createElement('button');
    el.type = 'button';
    el.id = PILL_ID;
    el.className = 'nbd-sms-outbox-pill';
    el.setAttribute('data-sms-outbox-action', 'open');
    el.setAttribute('aria-haspopup', 'dialog');
    document.body.appendChild(el);
    return el;
  }

  function _hidePill() {
    const el = document.getElementById(PILL_ID);
    if (el) el.classList.remove('is-visible');
  }

  function _liftForMobileNav(pill) {
    // #mobile-nav is fixed at bottom:0 on the dashboard's phone layout. Its
    // own module owns it; read its box, never write to it.
    let lift = 0;
    try {
      const nav = document.getElementById('mobile-nav');
      if (nav && nav.getClientRects().length) {
        const r = nav.getBoundingClientRect();
        const vh = window.innerHeight || 0;
        if (r.height > 0 && r.height < 200 && (!vh || r.bottom >= vh - 2)) lift = Math.ceil(r.height);
      }
    } catch (_) {}
    pill.style.setProperty('--nbd-sms-pill-lift', lift + 'px');
  }

  async function _renderPill() {
    const uid = _uid();
    if (!uid) { _hidePill(); return; }
    const n = await pendingCount(uid);
    if (!n) { _hidePill(); return; }
    const pill = _pill();
    if (!pill) return;
    pill.textContent = 'Pending texts (' + n + ')';
    pill.setAttribute('aria-label', n + ' text' + (n === 1 ? '' : 's') + ' waiting to send — review');
    _liftForMobileNav(pill);
    pill.classList.add('is-visible');
  }

  function _changed() {
    if (_bc) { try { _bc.postMessage('changed'); } catch (_) {} }
    _scheduleRender();
  }

  function _scheduleRender() {
    if (_renderQueued) return;
    _renderQueued = true;
    setTimeout(() => {
      _renderQueued = false;
      _renderPill().catch(() => {});
      const m = document.getElementById(MODAL_ID);
      if (m && m.classList.contains('open')) _renderTray().catch(() => {});
    }, 0);
  }

  function _modal() {
    let bg = document.getElementById(MODAL_ID);
    if (bg) return bg;
    _ensureCss();
    bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.id = MODAL_ID;
    const card = document.createElement('div');
    card.className = 'modal';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', MODAL_ID + '-title');
    const h = document.createElement('h3');
    h.id = MODAL_ID + '-title';
    h.textContent = 'Pending texts';
    h.style.cssText = 'font-family:\'Barlow Condensed\',sans-serif;font-size:18px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin:0 0 6px;';
    const sub = document.createElement('p');
    sub.className = 'nbd-sms-ob-sub';
    sub.textContent = 'Texts you wrote while offline. They send on their own only if they are under 15 minutes old, it is 8am–9pm Eastern, and nothing changed since. Everything else waits for you here.';
    const listEl = document.createElement('div');
    listEl.className = 'nbd-sms-ob-list';
    const foot = document.createElement('div');
    foot.className = 'nbd-sms-ob-foot';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn btn-ghost';
    close.textContent = 'Close';
    close.setAttribute('data-sms-outbox-action', 'close');
    foot.appendChild(close);
    card.appendChild(h);
    card.appendChild(sub);
    card.appendChild(listEl);
    card.appendChild(foot);
    bg.appendChild(card);
    document.body.appendChild(bg);
    return bg;
  }

  function _btn(label, action, id, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm ' + (cls || 'btn-ghost');
    b.textContent = label;
    b.setAttribute('data-sms-outbox-action', action);
    b.setAttribute('data-sms-outbox-id', id);
    return b;
  }

  function _actionsFor(r) {
    if (r.status === 'sending') return [];
    if (r.status === 'discarded') return [['Dismiss', 'discard', 'btn-ghost']];
    if (r.status === 'queued') return [['Send now', 'send', 'btn-orange'], ['Discard', 'discard', 'btn-ghost']];
    const reason = r.heldReason;
    if (reason === 'lead_gone') return [['Discard', 'discard', 'btn-ghost']];
    if (ACTIVITY_HOLDS[reason]) {
      return [['Send anyway', 'send-anyway', 'btn-orange'], ['Edit', 'edit', 'btn-ghost'], ['Discard', 'discard', 'btn-ghost']];
    }
    if (HANDOFF_OK[reason]) {
      return [['Send now', 'send', 'btn-orange'], ['Open in Messages', 'handoff', 'btn-ghost'], ['Discard', 'discard', 'btn-ghost']];
    }
    return [['Send now', 'send', 'btn-orange'], ['Edit', 'edit', 'btn-ghost'], ['Discard', 'discard', 'btn-ghost']];
  }

  async function _renderTray() {
    const bg = _modal();
    const listEl = bg.querySelector('.nbd-sms-ob-list');
    let rows;
    try { rows = await list(); }
    catch (_) {
      listEl.textContent = '';
      const p = document.createElement('div');
      p.className = 'nbd-sms-ob-empty';
      p.textContent = 'Could not read pending texts on this device.';
      listEl.appendChild(p);
      return;
    }
    listEl.textContent = '';
    if (!rows.length) {
      const p = document.createElement('div');
      p.className = 'nbd-sms-ob-empty';
      p.textContent = 'Nothing waiting to send.';
      listEl.appendChild(p);
      return;
    }
    const pendingAhead = {};
    rows.forEach((r) => {
      const behind = r.status === 'queued' && !!pendingAhead[r.toDigits];
      if (ACTIVE[r.status]) pendingAhead[r.toDigits] = true;
      const row = document.createElement('div');
      row.className = 'nbd-sms-ob-row' + (r.status === 'discarded' ? ' is-discarded' : '');
      row.setAttribute('data-sms-outbox-row', r.id);
      const top = document.createElement('div');
      top.className = 'nbd-sms-ob-top';
      const to = document.createElement('span');
      to.className = 'nbd-sms-ob-to';
      to.textContent = _mask(r.toDigits);
      const age = document.createElement('span');
      age.textContent = _age(r.createdAt);
      top.appendChild(to);
      top.appendChild(age);
      const body = document.createElement('div');
      body.className = 'nbd-sms-ob-body';
      const text = String(r.body || '');
      body.textContent = text.length > 80 ? text.slice(0, 80) + '…' : text;
      const reason = document.createElement('div');
      reason.className = 'nbd-sms-ob-reason';
      reason.textContent = _reasonText(r, behind);
      const actions = document.createElement('div');
      actions.className = 'nbd-sms-ob-actions';
      _actionsFor(r).forEach((a) => actions.appendChild(_btn(a[0], a[1], r.id, a[2])));
      row.appendChild(top);
      row.appendChild(body);
      row.appendChild(reason);
      row.appendChild(actions);
      listEl.appendChild(row);
    });
  }

  function _openEditor(id) {
    const bg = document.getElementById(MODAL_ID);
    if (!bg) return;
    const row = bg.querySelector('[data-sms-outbox-row="' + String(id).replace(/["\\]/g, '') + '"]');
    if (!row || row.querySelector('.nbd-sms-ob-edit')) return;
    list().then((rows) => {
      const rec = rows.find((r) => r.id === id);
      if (!rec) return;
      const ta = document.createElement('textarea');
      ta.className = 'nbd-sms-ob-edit';
      ta.value = rec.body || '';
      ta.maxLength = 1600;
      ta.setAttribute('aria-label', 'Edit message');
      const actions = row.querySelector('.nbd-sms-ob-actions');
      row.insertBefore(ta, actions);
      actions.textContent = '';
      actions.appendChild(_btn('Save & send', 'edit-send', id, 'btn-orange'));
      actions.appendChild(_btn('Cancel', 'edit-cancel', id, 'btn-ghost'));
      try { ta.focus(); } catch (_) {}
    }).catch(() => {});
  }

  function openTray() {
    const bg = _modal();
    _renderTray().catch(() => {});
    if (window.nbdModal && typeof window.nbdModal.open === 'function') window.nbdModal.open(bg);
    else bg.classList.add('open');
  }

  function _closeTray() {
    const bg = document.getElementById(MODAL_ID);
    if (!bg) return;
    if (window.nbdModal && typeof window.nbdModal.close === 'function') window.nbdModal.close(bg);
    else bg.classList.remove('open');
  }

  // One delegated listener for the pill and every tray control (CSP).
  document.addEventListener('click', (ev) => {
    const t = ev.target && ev.target.closest && ev.target.closest('[data-sms-outbox-action]');
    if (!t) return;
    const action = t.getAttribute('data-sms-outbox-action');
    const id = t.getAttribute('data-sms-outbox-id');
    if (action === 'open') { openTray(); return; }
    if (action === 'close') { _closeTray(); return; }
    if (!id) return;
    const busy = (p) => {
      t.disabled = true;
      Promise.resolve(p).catch(() => {}).then(() => { try { t.disabled = false; } catch (_) {} _scheduleRender(); });
    };
    if (action === 'send') busy(sendNow(id));
    else if (action === 'send-anyway') busy(sendNow(id, { activity: true }));
    else if (action === 'discard') busy(discard(id));
    else if (action === 'handoff') busy(openInMessages(id));
    else if (action === 'edit') _openEditor(id);
    else if (action === 'edit-cancel') _scheduleRender();
    else if (action === 'edit-send') {
      const row = t.closest('[data-sms-outbox-row]');
      const ta = row && row.querySelector('.nbd-sms-ob-edit');
      busy(editAndSend(id, ta ? ta.value : ''));
    }
  });

  // ── Boot ──────────────────────────────────────────────────────────────
  // Auth resolves after boot; poll for a real user like photo-queue-recovery.js
  // does, and give up quietly (a signed-out page never flushes).
  function _waitForUser() {
    if (_uid()) return Promise.resolve(_uid());
    return new Promise((resolve) => {
      const started = _now();
      const timer = setInterval(() => {
        const u = _uid();
        if (u) { clearInterval(timer); resolve(u); return; }
        if (_now() - started > 60000) { clearInterval(timer); resolve(null); }
      }, 500);
    });
  }

  function _boot() {
    try {
      if (typeof BroadcastChannel === 'function') {
        _bc = new BroadcastChannel('nbd-sms-outbox');
        _bc.onmessage = () => _scheduleRender();
      }
    } catch (_) { _bc = null; }
    window.addEventListener('online', () => { flush('online'); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') flush('visible');
    });
    _waitForUser().then(async (uid) => {
      if (!uid) return;
      // Account switch on a shared device: another account's texts are
      // deleted before anything is shown or sent — even while offline, when
      // flush() below returns early.
      try { await _purgeOtherUsers(uid); _lastUid = uid; } catch (_) {}
      _scheduleRender();
      flush('load');
    });
  }

  window.NBDSmsOutbox = {
    enqueue: enqueue,
    list: list,
    pendingCount: pendingCount,
    flush: flush,
    sendNow: sendNow,
    discard: discard,
    editAndSend: editAndSend,
    openInMessages: openInMessages,
    openTray: openTray,
    purgeAll: purgeAll,
    // Pure helpers the tray renders with; exposed for tests/sms-outbox-client.test.js.
    _internals: { actionsFor: _actionsFor, mask: _mask, reasonText: _reasonText },
    MAX_PER_USER: MAX_PER_USER,
    STALE_MS: STALE_MS,
    DB_NAME: DB_NAME,
    DB_STORE: DB_STORE,
  };

  _boot();
})();
