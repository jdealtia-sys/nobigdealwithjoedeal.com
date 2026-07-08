/**
 * NBD Pro — Google Review Request Engine
 * Auto-triggers review requests when jobs hit "Complete" or "Closed".
 * Generates a clean review landing page, sends SMS/email with direct link.
 *
 * Also includes Referral Tracking Engine — unique codes, tracking, rewards.
 *
 * Exposes: window.ReviewEngine
 */

(function() {
  'use strict';

  const BRAND = {
    name: 'No Big Deal Home Solutions',
    phone: '(859) 420-7382',
    website: 'nobigdealwithjoedeal.com',
    navy: '#1e3a6e',
    orange: '#e8720c'
  };

  // ═══════════════════════════════════════════════════════════════
  // GOOGLE REVIEW REQUEST
  // ═══════════════════════════════════════════════════════════════

  /**
   * Send a review request SMS to a customer
   * @param {string} leadId
   */
  function sendReviewRequestSMS(leadId) {
    const lead = (window._leads || []).find(l => l.id === leadId);
    if (!lead || !lead.phone) {
      if (typeof showToast === 'function') showToast('No phone number for this lead', 'error');
      return;
    }

    // Google review link — user sets this in settings, fallback to search
    const reviewLink = localStorage.getItem('nbd_google_review_link') || `https://search.google.com/local/writereview?placeid=${localStorage.getItem('nbd_google_place_id') || ''}`;
    const firstName = lead.firstName || lead.fname || '';
    const phone = lead.phone.replace(/\D/g, '');

    const body = encodeURIComponent(
      `Hi${firstName ? ' ' + firstName : ''}, thank you so much for trusting ${BRAND.name} with your project! We'd love to hear how we did. If you have 30 seconds, a Google review means the world to us: ${reviewLink}\n\nThank you! — Joe & the NBD team`
    );

    window.open(`sms:${phone}?body=${body}`, '_self');

    // Log the review request
    logReviewRequest(leadId, 'sms');
    if (typeof showToast === 'function') showToast('Review request SMS opened', 'ok');
  }

  /**
   * Send a review request email
   */
  function sendReviewRequestEmail(leadId) {
    const lead = (window._leads || []).find(l => l.id === leadId);
    if (!lead) return;

    const reviewLink = localStorage.getItem('nbd_google_review_link') || `https://search.google.com/local/writereview?placeid=${localStorage.getItem('nbd_google_place_id') || ''}`;
    const firstName = lead.firstName || '';
    const name = ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim();

    const subject = encodeURIComponent('How did we do? — No Big Deal Home Solutions');
    const body = encodeURIComponent(
      `Hi ${name || 'there'},\n\nThank you for choosing ${BRAND.name} for your project! We truly enjoyed working with you.\n\nIf you have a moment, we'd be incredibly grateful for a Google review. It helps other homeowners find trustworthy contractors:\n\n${reviewLink}\n\nIf there's anything we could have done better, please let us know directly — we're always improving.\n\nThank you!\nJoe & the No Big Deal team\n${BRAND.phone}`
    );

    window.location.href = `mailto:${lead.email || ''}?subject=${subject}&body=${body}`;
    logReviewRequest(leadId, 'email');
  }

  /**
   * Log review request to Firestore for tracking
   */
  async function logReviewRequest(leadId, method) {
    if (!window.db || !window._user) return;
    try {
      await window.addDoc(window.collection(window.db, 'review_requests'), {
        leadId,
        userId: window._user.uid,
        method,
        sentAt: window.serverTimestamp(),
        status: 'sent'
      });
      // Update lead record
      await window.updateDoc(window.doc(window.db, 'leads', leadId), {
        reviewRequested: true,
        reviewRequestedAt: window.serverTimestamp()
      });
    } catch(e) { console.warn('Review request log failed:', e.message); }
  }

  /**
   * Auto-check for leads that should get review requests
   * Called after leads load — finds recently closed jobs without review requests
   */
  function checkAutoReviewRequests() {
    // OWN leads only (team visibility, 2026-07): staff caches now hold the
    // whole tenant book, but review requests act on the lead (updateDoc
    // reviewRequested) which is owner-only at the rules layer — running
    // this over teammates' leads created un-actionable notifications and a
    // denied-write re-fire loop.
    const _me = window._user && window._user.uid;
    const leads = (window._leads || []).filter(l => !l.userId || l.userId === _me);
    const closedStages = ['closed', 'install_complete', 'Complete'];
    const recently = Date.now() - (7 * 24 * 60 * 60 * 1000); // Last 7 days

    const candidates = leads.filter(l => {
      const sk = l._stageKey || l.stage || '';
      if (!closedStages.includes(sk)) return false;
      if (l.reviewRequested) return false;
      const updated = l.updatedAt?.toDate ? l.updatedAt.toDate() : (l.updatedAt?.seconds ? new Date(l.updatedAt.seconds * 1000) : null);
      return updated && updated.getTime() > recently;
    });

    if (candidates.length > 0) {
      // Create notifications for review requests
      candidates.forEach(lead => {
        const name = ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim() || 'Customer';
        createReviewNotification(lead.id, name);
      });
    }
  }

  async function createReviewNotification(leadId, customerName) {
    if (!window.db || !window._user) return;
    // Review requests fall under the "Estimate Approvals" trigger
    // semantically (post-close customer outreach). Suppress if the
    // user disabled that trigger or set mode=critical (these are
    // normal-priority — useful but not urgent).
    if (typeof window.shouldFireNotif === 'function' &&
        !window.shouldFireNotif('estimate_approved', null, 'normal')) {
      return;
    }
    try {
      // Check if we already created one
      const existing = (window._notifications || []).find(n =>
        n.leadId === leadId && n.type === 'review_request'
      );
      if (existing) return;

      await window.addDoc(window.collection(window.db, 'notifications'), {
        userId: window._user.uid,
        leadId,
        type: 'review_request',
        title: '⭐ Request a Review',
        message: `${customerName}'s project is complete — send a review request?`,
        read: false,
        dismissed: false,
        createdAt: window.serverTimestamp()
      });
    } catch(e) { console.warn('Review notification failed:', e.message); }
  }

  // ═══════════════════════════════════════════════════════════════
  // REFERRAL TRACKING ENGINE
  // ═══════════════════════════════════════════════════════════════

  /**
   * Generate a unique referral code for a customer
   */
  function generateReferralCode(leadId) {
    const lead = (window._leads || []).find(l => l.id === leadId);
    if (!lead) return null;

    // Sanitize the name prefix to A-Z0-9 so the code never carries a space or
    // punctuation (e.g. 'Jo Ann' or a '(Web lead)' default) that would break the
    // exact-match redemption lookup and silently lose the $200. Pad the random
    // suffix to a full 4 chars (toString(36) can drop trailing zeros → 'JOHN-').
    const prefix = (lead.firstName || 'NBD').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'NBD';
    const suffix = (Math.random().toString(36).substring(2, 6) + '0000').slice(0, 4).toUpperCase();
    return prefix + '-' + suffix;
  }

  /**
   * Create and assign a referral code to a lead
   */
  async function assignReferralCode(leadId) {
    if (!window.db || !window._user) return null;
    const lead = (window._leads || []).find(l => l.id === leadId);
    if (!lead) return null;

    try {
      // Idempotent: if this referrer already has a code (locally or already
      // minted in the referrals collection), reuse it. A double-tap must not
      // mint a second doc and text the customer a different code. (Both queries
      // are userId-scoped so they satisfy the owner-only referrals read rule.)
      if (lead.referralCode) return lead.referralCode;
      const existing = await window.getDocs(window.query(
        window.collection(window.db, 'referrals'),
        window.where('referrerLeadId', '==', leadId),
        window.where('userId', '==', window._user.uid)
      ));
      if (!existing.empty) {
        const priorCode = existing.docs[0].data().code;
        lead.referralCode = priorCode;
        return priorCode;
      }

      // Mint a code, regenerating on the (rare) same-tenant collision so the
      // redemption lookup resolves to exactly one referrer.
      let code = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = generateReferralCode(leadId);
        if (!candidate) return null;
        const clash = await window.getDocs(window.query(
          window.collection(window.db, 'referrals'),
          window.where('code', '==', candidate),
          window.where('userId', '==', window._user.uid)
        ));
        if (clash.empty) { code = candidate; break; }
      }
      if (!code) {
        if (typeof showToast === 'function') showToast('Could not generate a unique code — try again', 'error');
        return null;
      }

      // Save code to lead
      await window.updateDoc(window.doc(window.db, 'leads', leadId), {
        referralCode: code,
        referralCodeCreatedAt: window.serverTimestamp()
      });

      // Save to referrals collection for lookup
      await window.addDoc(window.collection(window.db, 'referrals'), {
        code,
        referrerLeadId: leadId,
        userId: window._user.uid,
        // Tenant key so the server trigger scopes redemption by company: a code
        // minted by any teammate credits when the referred lead closes on any
        // teammate's / the owner's book. Falls back to uid for a solo tenant.
        companyId: lead.companyId || window._user.uid,
        createdAt: window.serverTimestamp(),
        referredLeads: [],
        rewardsPaid: 0,
        status: 'active'
      });

      lead.referralCode = code;
      if (typeof showToast === 'function') showToast(`Referral code: ${code}`, 'ok');
      return code;
    } catch(e) {
      console.error('Referral code creation failed:', e);
      return null;
    }
  }

  /**
   * Send referral code to customer via SMS
   */
  async function sendReferralSMS(leadId) {
    const lead = (window._leads || []).find(l => l.id === leadId);
    if (!lead || !lead.phone) return;

    let code = lead.referralCode;
    if (!code) code = await assignReferralCode(leadId);
    if (!code) return;

    const firstName = lead.firstName || '';
    const phone = lead.phone.replace(/\D/g, '');
    const body = encodeURIComponent(
      `Hey${firstName ? ' ' + firstName : ''}, thanks again for choosing ${BRAND.name}! Here's your personal referral code: ${code}\n\nShare it with friends & neighbors — they get a free inspection, and you get a $200 bonus when their project closes. Win-win!`
    );
    window.open(`sms:${phone}?body=${body}`, '_self');
  }

  // Referral attribution + the $200-bonus crediting-on-close moved SERVER-SIDE
  // to functions/referral-rewards.js (onReferralLeadWrite). Intake now just
  // stamps `redeemReferralCode` on the lead (rep Add/Edit Lead modal or the
  // public /inspect form) and the trigger resolves the code to its referrer
  // and records the bonus as owed when the project closes. The old client-side
  // trackReferral() that lived here had ZERO callers and no crediting path, so
  // the $200 promised in sendReferralSMS was unbacked — removed to avoid a
  // second, drifting attribution lane.

  /**
   * Get referral stats for dashboard
   */
  async function getReferralStats() {
    if (!window.db || !window._user) return { total: 0, active: 0, revenue: 0 };
    try {
      const snap = await window.getDocs(window.query(
        window.collection(window.db, 'referrals'),
        window.where('userId', '==', window._user.uid)
      ));
      const refs = snap.docs.map(d => d.data());
      const totalReferred = refs.reduce((s, r) => s + (r.referredLeads?.length || 0), 0);
      return {
        totalCodes: refs.length,
        totalReferred,
        active: refs.filter(r => r.status === 'active').length
      };
    } catch(e) { return { totalCodes: 0, totalReferred: 0, active: 0 }; }
  }

  // Expose to window
  window.ReviewEngine = {
    sendReviewSMS: sendReviewRequestSMS,
    sendReviewEmail: sendReviewRequestEmail,
    checkAutoReviews: checkAutoReviewRequests,
    assignReferralCode,
    sendReferralSMS,
    getReferralStats
  };

})();
