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
    const leads = window._leads || [];
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

    const firstName = (lead.firstName || 'NBD').toUpperCase().slice(0, 4);
    const code = firstName + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    return code;
  }

  /**
   * Create and assign a referral code to a lead
   */
  async function assignReferralCode(leadId) {
    const code = generateReferralCode(leadId);
    if (!code || !window.db || !window._user) return null;

    try {
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
        createdAt: window.serverTimestamp(),
        referredLeads: [],
        rewardsPaid: 0,
        status: 'active'
      });

      // Update local
      const lead = (window._leads || []).find(l => l.id === leadId);
      if (lead) lead.referralCode = code;

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

  /**
   * Track a referral — called when a new lead mentions a referral code
   */
  async function trackReferral(newLeadId, referralCode) {
    if (!window.db || !window._user || !referralCode) return;

    try {
      // Look up the referral record
      const snap = await window.getDocs(window.query(
        window.collection(window.db, 'referrals'),
        window.where('code', '==', referralCode.toUpperCase()),
        window.where('userId', '==', window._user.uid)
      ));

      if (snap.empty) {
        if (typeof showToast === 'function') showToast('Referral code not found', 'error');
        return false;
      }

      const refDoc = snap.docs[0];
      await window.updateDoc(window.doc(window.db, 'referrals', refDoc.id), {
        referredLeads: window.arrayUnion(newLeadId)
      });

      // Update new lead with referral info
      await window.updateDoc(window.doc(window.db, 'leads', newLeadId), {
        referredBy: referralCode,
        referrerLeadId: refDoc.data().referrerLeadId
      });

      // Create notification for the referral
      const referrerLead = (window._leads || []).find(l => l.id === refDoc.data().referrerLeadId);
      const referrerName = referrerLead ? ((referrerLead.firstName || '') + ' ' + (referrerLead.lastName || '')).trim() : 'A customer';

      await window.addDoc(window.collection(window.db, 'notifications'), {
        userId: window._user.uid,
        leadId: newLeadId,
        type: 'referral',
        title: '🎁 New Referral!',
        message: `${referrerName} referred a new lead (code: ${referralCode})`,
        read: false,
        dismissed: false,
        createdAt: window.serverTimestamp()
      });

      if (typeof showToast === 'function') showToast(`Referral tracked — referred by ${referrerName}`, 'ok');
      return true;
    } catch(e) {
      console.error('Referral tracking failed:', e);
      return false;
    }
  }

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
    trackReferral,
    getReferralStats
  };

})();
