/**
 * NBD Pro — Weather-Triggered Lead Alert System
 * Monitors NWS alerts and cross-references with lead/customer locations.
 * When a storm hits an area with existing leads, auto-creates notifications
 * and offers one-click SMS blast to affected customers.
 *
 * Exposes: window.StormAlerts
 */

(function() {
  'use strict';

  const NWS_API = 'https://api.weather.gov/alerts/active';
  const CHECK_INTERVAL = 10 * 60 * 1000; // 10 minutes
  const ROOFING_EVENTS = ['Hail', 'Tornado', 'Severe Thunderstorm', 'Hurricane', 'High Wind', 'Damaging Wind'];
  let _lastCheck = 0;
  let _activeAlerts = [];

  /**
   * Check for storms affecting our leads
   * Uses NWS API and cross-references with lead addresses
   */
  async function checkStormAlerts() {
    if (Date.now() - _lastCheck < CHECK_INTERVAL) return _activeAlerts;
    _lastCheck = Date.now();

    const leads = window._leads || [];
    if (leads.length === 0) return [];

    try {
      // Get unique coordinates from leads that have lat/lng
      const leadsWithCoords = leads.filter(l => l.lat && l.lng && !l.deleted);
      if (leadsWithCoords.length === 0) return [];

      // Get bounding box of all leads
      const lats = leadsWithCoords.map(l => parseFloat(l.lat));
      const lngs = leadsWithCoords.map(l => parseFloat(l.lng));
      const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
      const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;

      // Fetch NWS alerts for the area
      const resp = await fetch(`${NWS_API}?point=${centerLat.toFixed(4)},${centerLng.toFixed(4)}&limit=20`, {
        headers: { 'User-Agent': 'NBDPro/1.0 (info@nobigdeal.pro)' }
      });

      if (!resp.ok) {
        // Fallback: try area-based query
        const stateResp = await fetch(`${NWS_API}?area=KY,OH,IN&limit=30`, {
          headers: { 'User-Agent': 'NBDPro/1.0 (info@nobigdeal.pro)' }
        });
        if (!stateResp.ok) return [];
        var data = await stateResp.json();
      } else {
        var data = await resp.json();
      }

      const features = data.features || [];
      const roofingAlerts = features.filter(f => {
        const event = f.properties?.event || '';
        return ROOFING_EVENTS.some(e => event.toLowerCase().includes(e.toLowerCase().split(' ')[0]));
      });

      if (roofingAlerts.length === 0) return [];

      // Cross-reference alerts with lead locations
      const affectedLeads = [];

      for (const alert of roofingAlerts) {
        const props = alert.properties;
        const geometry = alert.geometry;

        // Check if any leads are in the alert polygon
        if (geometry?.type === 'Polygon' && geometry.coordinates) {
          const polygon = geometry.coordinates[0].map(c => [c[1], c[0]]); // [lat, lng]

          for (const lead of leadsWithCoords) {
            if (pointInPolygon([parseFloat(lead.lat), parseFloat(lead.lng)], polygon)) {
              affectedLeads.push({
                lead,
                alert: {
                  event: props.event,
                  headline: props.headline,
                  severity: props.severity,
                  hailSize: extractHailSize(props.description),
                  windSpeed: extractWindSpeed(props.description),
                  expires: props.expires
                }
              });
            }
          }
        } else {
          // No polygon — check area description for county/zone matches
          const areaDesc = (props.areaDesc || '').toLowerCase();
          for (const lead of leadsWithCoords) {
            const addr = (lead.address || '').toLowerCase();
            // Simple check: does the alert area mention any part of the lead's address?
            const parts = addr.split(',').map(p => p.trim());
            if (parts.some(p => p.length > 3 && areaDesc.includes(p))) {
              affectedLeads.push({
                lead,
                alert: {
                  event: props.event,
                  headline: props.headline,
                  severity: props.severity,
                  hailSize: extractHailSize(props.description),
                  windSpeed: extractWindSpeed(props.description),
                  expires: props.expires
                }
              });
            }
          }
        }
      }

      _activeAlerts = affectedLeads;

      // Create notifications for affected leads
      if (affectedLeads.length > 0) {
        await createStormNotifications(affectedLeads);
      }

      return affectedLeads;
    } catch(e) {
      console.warn('Storm alert check failed:', e.message);
      return [];
    }
  }

  /**
   * Create notifications for storm-affected leads
   */
  async function createStormNotifications(affectedLeads) {
    if (!window.db || !window._user) return;

    // Group by alert event to avoid spamming
    const grouped = {};
    affectedLeads.forEach(a => {
      const key = a.alert.event;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(a);
    });

    for (const [event, items] of Object.entries(grouped)) {
      const count = items.length;
      const severity = items[0].alert.severity;
      const hail = items[0].alert.hailSize;

      // Check for duplicate notification
      const existing = (window._notifications || []).find(n =>
        n.type === 'storm_alert' && n.title.includes(event) &&
        Date.now() - (n.createdAt?.toDate?.()?.getTime() || 0) < 3600000
      );
      if (existing) continue;

      try {
        await window.addDoc(window.collection(window.db, 'notifications'), {
          userId: window._user.uid,
          type: 'storm_alert',
          title: `🌩️ ${event} — ${count} leads affected`,
          message: `${severity} severity${hail ? ', ' + hail + '" hail' : ''}. ${count} of your leads/customers are in the impact zone. Tap to view and send check-in messages.`,
          read: false,
          dismissed: false,
          createdAt: window.serverTimestamp(),
          meta: {
            affectedLeadIds: items.map(i => i.lead.id),
            event,
            severity,
            hailSize: hail
          }
        });
      } catch(e) { console.warn('Storm notification create failed:', e.message); }
    }
  }

  /**
   * Send storm check-in SMS to a specific lead
   */
  function sendStormCheckInSMS(leadId, eventType) {
    const lead = (window._leads || []).find(l => l.id === leadId);
    if (!lead || !lead.phone) {
      if (typeof showToast === 'function') showToast('No phone for this lead', 'error');
      return;
    }

    const firstName = lead.firstName || '';
    const phone = lead.phone.replace(/\D/g, '');
    const stormType = eventType || 'severe weather';

    const body = encodeURIComponent(
      `Hi${firstName ? ' ' + firstName : ''}, this is Joe from No Big Deal Home Solutions. We noticed ${stormType.toLowerCase()} hit your area recently. We wanted to check in — have you noticed any damage to your roof or exterior? We're offering free storm inspections in your neighborhood this week. Just reply or call ${phone} to schedule. Stay safe!`
    );

    window.open(`sms:${phone}?body=${body}`, '_self');
  }

  /**
   * Blast SMS to all affected leads for a storm event
   */
  function getAffectedLeads() {
    return _activeAlerts;
  }

  // Helpers
  function extractHailSize(desc) {
    if (!desc) return null;
    const m = desc.match(/(\d+\.?\d*)\s*inch\s*hail/i);
    return m ? parseFloat(m[1]) : null;
  }

  function extractWindSpeed(desc) {
    if (!desc) return null;
    const m = desc.match(/(\d+)\s*mph\s*wind/i);
    return m ? parseInt(m[1]) : null;
  }

  function pointInPolygon(point, polygon) {
    let inside = false;
    const [x, y] = point;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i];
      const [xj, yj] = polygon[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  // Auto-check on load (after leads are ready)
  function initStormAlerts() {
    if (window._leads && window._leads.length > 0) {
      setTimeout(checkStormAlerts, 5000); // 5s after init
      setInterval(checkStormAlerts, CHECK_INTERVAL);
    } else {
      setTimeout(initStormAlerts, 3000); // Retry
    }
  }
  setTimeout(initStormAlerts, 8000);

  window.StormAlerts = {
    check: checkStormAlerts,
    sendCheckInSMS: sendStormCheckInSMS,
    getAffected: getAffectedLeads
  };

})();
