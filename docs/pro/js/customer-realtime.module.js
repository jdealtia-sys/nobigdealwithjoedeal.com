
  import {
    collection, query, where, orderBy, onSnapshot, limit
  } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
  import {
    getFunctions, httpsCallable
  } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';

  // Wait for the customer.html bootstrap (same probe pattern as voice-intel).
  function whenReady(maxWaitMs) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const probe = () => {
        if (window._customerId && window.auth && window.db && window.auth.currentUser) {
          return resolve({
            leadId: window._customerId,
            db: window.db,
            uid: window.auth.currentUser.uid,
          });
        }
        if (Date.now() - start > maxWaitMs) return reject(new Error('messages: bootstrap timeout'));
        setTimeout(probe, 100);
      };
      probe();
    });
  }

  function escMsg(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function fmtTime(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const opts = sameDay
      ? { hour: 'numeric', minute: '2-digit' }
      : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
    return d.toLocaleString(undefined, opts);
  }

  let unsubscribeMessages = null;
  let allMessages = [];

  function renderThread() {
    const threadEl = document.getElementById('repMsgThread');
    const emptyEl = document.getElementById('repMsgEmpty');
    if (!threadEl) return;
    if (allMessages.length === 0) {
      Array.from(threadEl.querySelectorAll('.rep-bubble')).forEach(n => n.remove());
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    Array.from(threadEl.querySelectorAll('.rep-bubble')).forEach(n => n.remove());

    // Sort oldest-first for natural conversation flow.
    const sorted = [...allMessages].sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() || 0;
      const tb = b.createdAt?.toMillis?.() || 0;
      return ta - tb;
    });
    sorted.forEach(m => {
      const bubble = document.createElement('div');
      bubble.className = 'rep-bubble';
      const isRep = m.source === 'rep';
      // Rep messages on the right (you, the rep, viewing this page).
      bubble.style.cssText =
        'max-width:80%;padding:10px 14px;border-radius:14px;font-size:14px;line-height:1.45;' +
        'word-wrap:break-word;align-self:' + (isRep ? 'flex-end' : 'flex-start') + ';' +
        'background:' + (isRep ? 'var(--orange, #c8541a)' : 'rgba(255,255,255,0.08)') + ';' +
        'color:' + (isRep ? 'var(--accent-fg)' : 'inherit') + ';' +
        'border-bottom-' + (isRep ? 'right' : 'left') + '-radius:4px;';
      const senderLabel = isRep ? 'You' : 'Homeowner';
      bubble.innerHTML =
        '<div>' + escMsg(m.text) + '</div>' +
        '<div style="font-size:10px;opacity:0.75;margin-top:4px;text-align:' +
          (isRep ? 'right' : 'left') + ';">' +
          escMsg(senderLabel) + ' · ' + escMsg(fmtTime(m.createdAt)) +
        '</div>';
      threadEl.appendChild(bubble);
    });
    // Auto-scroll to latest
    threadEl.scrollTop = threadEl.scrollHeight;
  }

  function updateUnreadBadge() {
    const badge = document.getElementById('msgUnreadBadge');
    if (!badge) return;
    const unread = allMessages.filter(m => m.source === 'homeowner' && !m.readByRecipient).length;
    if (unread > 0) {
      badge.textContent = String(unread);
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  whenReady(10000).then(({ leadId, db, uid }) => {
    // Subscribe to the thread. firestore.rules allows lead-owner read,
    // and the W122 lesson (where filter required for list queries with
    // per-doc rules) doesn't apply here because the rule is parent-
    // lookup based, not per-doc — but we still pass orderBy for
    // consistent ordering.
    const q = query(
      collection(db, 'leads', leadId, 'portal_messages'),
      orderBy('createdAt', 'asc'),
      limit(200)
    );
    unsubscribeMessages = onSnapshot(q,
      (snap) => {
        allMessages = [];
        snap.forEach(d => allMessages.push({ id: d.id, ...d.data() }));
        renderThread();
        updateUnreadBadge();
      },
      (err) => {
        console.warn('[rep-msg] snapshot error:', err.message);
        const threadEl = document.getElementById('repMsgThread');
        if (threadEl) {
          threadEl.innerHTML =
            '<div style="color:#fca5a5;font-size:13px;text-align:center;padding:24px 12px;">' +
            'Could not load messages: ' + escMsg(err.message || err) + '</div>';
        }
      }
    );

    // Wire up compose + send.
    const textEl = document.getElementById('repMsgText');
    const sendBtn = document.getElementById('repMsgSend');
    const statusEl = document.getElementById('repMsgStatus');
    if (!textEl || !sendBtn) return;

    textEl.addEventListener('input', () => {
      const has = textEl.value.trim().length > 0;
      sendBtn.disabled = !has;
      sendBtn.style.opacity = has ? '1' : '0.55';
    });

    sendBtn.addEventListener('click', async () => {
      const text = textEl.value.trim();
      if (!text) return;
      sendBtn.disabled = true;
      const origLabel = sendBtn.textContent;
      sendBtn.textContent = 'Sending…';
      if (statusEl) statusEl.textContent = '';
      try {
        const fn = httpsCallable(getFunctions(), 'replyToPortalMessage');
        const res = await fn({ leadId, text });
        if (res.data && res.data.success) {
          textEl.value = '';
          sendBtn.textContent = origLabel;
          sendBtn.style.opacity = '0.55';
          if (statusEl) statusEl.textContent = 'Sent ✓';
          setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
        } else {
          if (statusEl) statusEl.textContent = 'Send failed.';
          sendBtn.disabled = false;
          sendBtn.textContent = origLabel;
        }
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = 'Error: ' + (err.message || 'try again');
          statusEl.style.color = '#fca5a5';
        }
        sendBtn.disabled = false;
        sendBtn.textContent = origLabel;
      }
    });
  }).catch((e) => {
    console.warn('[rep-msg] init failed:', e.message);
  });

  window.addEventListener('beforeunload', () => {
    try { unsubscribeMessages && unsubscribeMessages(); } catch (_) {}
  });
