/**
 * NBD Pro — Analytics KPI Engine
 * Computes real-time business metrics from Firestore data.
 *
 * 1. renderKPIRow()  — compact KPI row on the Home dashboard view
 * 2. AnalyticsKPI.init() / .render(containerId) — full Analytics dashboard
 *
 * Data sources (all user-scoped):
 *   leads, estimates, photos, invoices, knocks, tasks
 *
 * Exposes: window.renderKPIRow(), window.computeKPIs(), window.AnalyticsKPI
 */

(function () {
  'use strict';

  // ── Stage classifications ──
  const WON_STAGES = [
    'closed', 'install_complete', 'final_photos',
    'final_payment', 'deductible_collected', 'Complete'
  ];
  const LOST_STAGES = ['lost', 'Lost'];
  const ACTIVE_STAGES_EXCLUDE = [...WON_STAGES, ...LOST_STAGES];

  // ── Date helpers ──
  function toJSDate(v) {
    if (!v) return null;
    if (v.toDate) return v.toDate();
    if (v.seconds) return new Date(v.seconds * 1000);
    if (typeof v === 'string' || typeof v === 'number') return new Date(v);
    if (v instanceof Date) return v;
    return null;
  }

  function monthKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function monthLabel(key) {
    const [y, m] = key.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[parseInt(m, 10) - 1] + ' ' + y;
  }

  function formatCurrency(n) {
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return '$' + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K';
    return '$' + Math.round(n).toLocaleString();
  }

  function formatNum(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K';
    return Math.round(n).toLocaleString();
  }

  function pct(num, den) {
    return den > 0 ? Math.round((num / den) * 100) : 0;
  }

  // ════════════════════════════════════════════
  // HOME KPI ROW (existing functionality)
  // ════════════════════════════════════════════

  function computeKPIs() {
    var leads = window._leads || [];
    var estimates = window._estimates || [];
    var now = new Date();
    var thisMonth = now.getMonth();
    var thisYear = now.getFullYear();
    var today = new Date(); today.setHours(0, 0, 0, 0);

    var activeLeads = leads.filter(function (l) {
      var sk = l._stageKey || l.stage || 'new';
      return !ACTIVE_STAGES_EXCLUDE.includes(sk) && !l.deleted;
    });
    var pipelineValue = activeLeads.reduce(function (sum, l) {
      return sum + (parseFloat(l.jobValue) || 0);
    }, 0);

    var closedThisMonth = leads.filter(function (l) {
      var sk = l._stageKey || l.stage || '';
      if (!WON_STAGES.includes(sk)) return false;
      var d = toJSDate(l.updatedAt);
      return d && d.getMonth() === thisMonth && d.getFullYear() === thisYear;
    });
    var monthlyRevenue = closedThisMonth.reduce(function (sum, l) {
      return sum + (parseFloat(l.jobValue) || 0);
    }, 0);

    var totalClosed = leads.filter(function (l) {
      return WON_STAGES.includes(l._stageKey || l.stage || '');
    }).length;
    var totalLost = leads.filter(function (l) {
      return LOST_STAGES.includes(l._stageKey || l.stage || '');
    }).length;
    var totalDecided = totalClosed + totalLost;
    var closeRate = totalDecided > 0 ? Math.round((totalClosed / totalDecided) * 100) : 0;

    var leadsThisMonth = leads.filter(function (l) {
      var d = toJSDate(l.createdAt);
      return d && d.getMonth() === thisMonth && d.getFullYear() === thisYear;
    }).length;

    var overdueFollowUps = leads.filter(function (l) {
      var sk = l._stageKey || l.stage || '';
      if (ACTIVE_STAGES_EXCLUDE.includes(sk) || !l.followUp) return false;
      var d = new Date(l.followUp); d.setHours(0, 0, 0, 0);
      return d < today;
    }).length;

    var closedWithValue = leads.filter(function (l) {
      return WON_STAGES.includes(l._stageKey || l.stage || '') && parseFloat(l.jobValue) > 0;
    });
    var avgDealSize = closedWithValue.length > 0
      ? closedWithValue.reduce(function (s, l) { return s + parseFloat(l.jobValue); }, 0) / closedWithValue.length
      : 0;

    var sourceMap = {};
    leads.filter(function (l) { return !l.deleted; }).forEach(function (l) {
      var src = l.source || 'Unknown';
      sourceMap[src] = (sourceMap[src] || 0) + 1;
    });
    var topSource = Object.entries(sourceMap).sort(function (a, b) { return b[1] - a[1]; })[0];

    return {
      pipelineValue: pipelineValue,
      monthlyRevenue: monthlyRevenue,
      closeRate: closeRate,
      leadsThisMonth: leadsThisMonth,
      overdueFollowUps: overdueFollowUps,
      avgDealSize: avgDealSize,
      activeLeadCount: activeLeads.length,
      closedThisMonthCount: closedThisMonth.length,
      topSource: topSource ? topSource[0] : 'N/A',
      topSourceCount: topSource ? topSource[1] : 0
    };
  }

  function renderKPIRow() {
    var container = document.getElementById('kpiRow');
    if (!container) return;

    var k = computeKPIs();

    container.innerHTML =
      '<div class="kpi-grid">' +
        '<div class="kpi-card kpi-primary">' +
          '<div class="kpi-icon">💰</div>' +
          '<div class="kpi-data">' +
            '<div class="kpi-value">$' + formatNum(k.pipelineValue) + '</div>' +
            '<div class="kpi-label">Active Pipeline</div>' +
            '<div class="kpi-sub">' + k.activeLeadCount + ' active leads</div>' +
          '</div>' +
        '</div>' +
        '<div class="kpi-card kpi-green">' +
          '<div class="kpi-icon">📈</div>' +
          '<div class="kpi-data">' +
            '<div class="kpi-value">$' + formatNum(k.monthlyRevenue) + '</div>' +
            '<div class="kpi-label">Revenue This Month</div>' +
            '<div class="kpi-sub">' + k.closedThisMonthCount + ' closed</div>' +
          '</div>' +
        '</div>' +
        '<div class="kpi-card">' +
          '<div class="kpi-icon">🎯</div>' +
          '<div class="kpi-data">' +
            '<div class="kpi-value">' + k.closeRate + '%</div>' +
            '<div class="kpi-label">Close Rate</div>' +
            '<div class="kpi-sub">Avg deal $' + formatNum(k.avgDealSize) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="kpi-card">' +
          '<div class="kpi-icon">🆕</div>' +
          '<div class="kpi-data">' +
            '<div class="kpi-value">' + k.leadsThisMonth + '</div>' +
            '<div class="kpi-label">New Leads</div>' +
            '<div class="kpi-sub">Top: ' + k.topSource + '</div>' +
          '</div>' +
        '</div>' +
        (k.overdueFollowUps > 0
          ? '<div class="kpi-card kpi-warning" onclick="scrollToFollowUps();" style="cursor:pointer;">' +
              '<div class="kpi-icon">⚠️</div>' +
              '<div class="kpi-data">' +
                '<div class="kpi-value">' + k.overdueFollowUps + '</div>' +
                '<div class="kpi-label">Overdue Follow-Ups</div>' +
                '<div class="kpi-sub">Click to view</div>' +
              '</div>' +
            '</div>'
          : '') +
      '</div>';
  }

  // ════════════════════════════════════════════
  // FULL ANALYTICS DASHBOARD (new)
  // ════════════════════════════════════════════

  var _analyticsCache = {
    leads: [], estimates: [], invoices: [],
    knocks: [], photos: [], tasks: [],
    loaded: false
  };

  /**
   * Fetch all user-scoped collections from Firestore.
   * Uses window._leads / window._estimates if already loaded,
   * otherwise queries Firestore directly.
   */
  async function fetchAllData() {
    var db = window._db || window.db;
    var uid = window._user?.uid;
    if (!db || !uid) return _analyticsCache;

    // Use cached in-memory data for leads/estimates (already loaded by dashboard)
    _analyticsCache.leads = window._leads || [];
    _analyticsCache.estimates = window._estimates || [];

    var qFn = window.query;
    var colFn = window.collection;
    var whereFn = window.where;
    var getDocsFn = window.getDocs;

    if (!qFn || !colFn || !whereFn || !getDocsFn) return _analyticsCache;

    // Fetch invoices, knocks, photos, tasks in parallel
    var fetchers = [
      // invoices (createdBy field)
      getDocsFn(qFn(colFn(db, 'invoices'), whereFn('createdBy', '==', uid)))
        .then(function (snap) {
          _analyticsCache.invoices = snap.docs.map(function (d) {
            return Object.assign({ id: d.id }, d.data());
          });
        })
        .catch(function () { _analyticsCache.invoices = []; }),

      // knocks (userId field)
      getDocsFn(qFn(colFn(db, 'knocks'), whereFn('userId', '==', uid)))
        .then(function (snap) {
          _analyticsCache.knocks = snap.docs.map(function (d) {
            return Object.assign({ id: d.id }, d.data());
          });
        })
        .catch(function () { _analyticsCache.knocks = []; }),

      // photos (userId field)
      getDocsFn(qFn(colFn(db, 'photos'), whereFn('userId', '==', uid)))
        .then(function (snap) {
          _analyticsCache.photos = snap.docs.map(function (d) {
            return Object.assign({ id: d.id }, d.data());
          });
        })
        .catch(function () { _analyticsCache.photos = []; })
    ];

    await Promise.all(fetchers);
    _analyticsCache.loaded = true;
    return _analyticsCache;
  }

  /**
   * Compute the full set of analytics metrics.
   */
  function computeFullAnalytics(data) {
    var leads = data.leads || [];
    var invoices = data.invoices || [];
    var knocks = data.knocks || [];
    var photos = data.photos || [];
    var estimates = data.estimates || [];

    var now = new Date();
    var thisMonth = now.getMonth();
    var thisYear = now.getFullYear();

    // ── Revenue from paid invoices ──
    var paidInvoices = invoices.filter(function (inv) {
      return inv.status === 'paid' && inv.paidAt;
    });
    var totalRevenue = paidInvoices.reduce(function (sum, inv) {
      return sum + (parseFloat(inv.total) || 0);
    }, 0);

    var unpaidInvoices = invoices.filter(function (inv) {
      return inv.status !== 'paid';
    });
    var unpaidAmount = unpaidInvoices.reduce(function (sum, inv) {
      return sum + (parseFloat(inv.balanceDue) || parseFloat(inv.total) || 0);
    }, 0);

    // ── Pipeline value from active leads ──
    var activeLeads = leads.filter(function (l) {
      var sk = l._stageKey || l.stage || 'new';
      return !ACTIVE_STAGES_EXCLUDE.includes(sk) && !l.deleted;
    });
    var pipelineValue = activeLeads.reduce(function (sum, l) {
      return sum + (parseFloat(l.jobValue) || 0);
    }, 0);

    // ── Conversion rate ──
    var wonLeads = leads.filter(function (l) {
      return WON_STAGES.includes(l._stageKey || l.stage || '');
    });
    var lostLeads = leads.filter(function (l) {
      return LOST_STAGES.includes(l._stageKey || l.stage || '');
    });
    var totalDecided = wonLeads.length + lostLeads.length;
    var nonDeleted = leads.filter(function (l) { return !l.deleted; });
    var conversionRate = pct(wonLeads.length, totalDecided);

    // ── Average deal size ──
    var wonWithValue = wonLeads.filter(function (l) { return parseFloat(l.jobValue) > 0; });
    var avgDealSize = wonWithValue.length > 0
      ? wonWithValue.reduce(function (s, l) { return s + parseFloat(l.jobValue); }, 0) / wonWithValue.length
      : 0;

    // ── Estimates ──
    var totalEstimates = estimates.length;
    var estTotalValue = estimates.reduce(function (sum, e) {
      return sum + (parseFloat(e.total) || parseFloat(e.grandTotal) || 0);
    }, 0);
    var avgEstimateValue = totalEstimates > 0 ? estTotalValue / totalEstimates : 0;

    // ── Leads by stage ──
    var stageMap = {};
    nonDeleted.forEach(function (l) {
      var st = l._stageKey || l.stage || 'new';
      stageMap[st] = (stageMap[st] || 0) + 1;
    });

    // ── Leads by source ──
    var sourceMap = {};
    nonDeleted.forEach(function (l) {
      var src = l.source || 'Unknown';
      sourceMap[src] = (sourceMap[src] || 0) + 1;
    });

    // ── Monthly trend (last 6 months) ──
    var monthlyTrend = {};
    for (var i = 5; i >= 0; i--) {
      var d = new Date(thisYear, thisMonth - i, 1);
      monthlyTrend[monthKey(d)] = { leads: 0, closed: 0, revenue: 0 };
    }
    nonDeleted.forEach(function (l) {
      var cd = toJSDate(l.createdAt);
      if (cd) {
        var mk = monthKey(cd);
        if (monthlyTrend[mk]) monthlyTrend[mk].leads++;
      }
    });
    wonLeads.forEach(function (l) {
      var ud = toJSDate(l.updatedAt);
      if (ud) {
        var mk = monthKey(ud);
        if (monthlyTrend[mk]) {
          monthlyTrend[mk].closed++;
          monthlyTrend[mk].revenue += parseFloat(l.jobValue) || 0;
        }
      }
    });

    // ── D2D efficiency ──
    var totalKnocks = knocks.length;
    var appointments = knocks.filter(function (k) {
      return k.disposition === 'appointment' || k.stage === 'appointment';
    }).length;
    var knockToAppt = pct(appointments, totalKnocks);

    // ── Photo documentation ──
    var totalPhotos = photos.length;
    var leadsWithPhotos = new Set(photos.map(function (p) { return p.leadId; }).filter(Boolean));
    var photoPerLead = nonDeleted.length > 0
      ? (totalPhotos / nonDeleted.length).toFixed(1)
      : '0';

    // ── This month revenue ──
    var monthRevenue = paidInvoices.filter(function (inv) {
      var pd = toJSDate(inv.paidAt);
      return pd && pd.getMonth() === thisMonth && pd.getFullYear() === thisYear;
    }).reduce(function (sum, inv) { return sum + (parseFloat(inv.total) || 0); }, 0);

    return {
      totalRevenue: totalRevenue,
      monthRevenue: monthRevenue,
      unpaidAmount: unpaidAmount,
      pipelineValue: pipelineValue,
      conversionRate: conversionRate,
      avgDealSize: avgDealSize,
      totalLeads: nonDeleted.length,
      activeLeadCount: activeLeads.length,
      wonCount: wonLeads.length,
      lostCount: lostLeads.length,
      totalEstimates: totalEstimates,
      avgEstimateValue: avgEstimateValue,
      stageMap: stageMap,
      sourceMap: sourceMap,
      monthlyTrend: monthlyTrend,
      totalKnocks: totalKnocks,
      appointments: appointments,
      knockToAppt: knockToAppt,
      totalPhotos: totalPhotos,
      leadsWithPhotos: leadsWithPhotos.size,
      photoPerLead: photoPerLead,
      invoiceCount: invoices.length,
      paidCount: paidInvoices.length,
      unpaidCount: unpaidInvoices.length
    };
  }

  // ── CSS for the full analytics dashboard ──
  var ANALYTICS_CSS = `
    .ak-wrap { max-width: 960px; margin: 0 auto; }
    .ak-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin-bottom: 20px; }
    .ak-card { background: var(--s2, #1a1d23); border: 1px solid var(--br, #2a2d35); border-radius: 10px; padding: 18px 16px; position: relative; overflow: hidden; transition: border-color .15s; }
    .ak-card:hover { border-color: var(--orange, #e8720c); }
    .ak-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; }
    .ak-card.blue::before { background: var(--blue, #4E9BF5); }
    .ak-card.orange::before { background: var(--orange, #e8720c); }
    .ak-card.green::before { background: var(--green, #2ECC8A); }
    .ak-card.red::before { background: #E05252; }
    .ak-card.cyan::before { background: #00d4ff; }
    .ak-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--m, #8892A4); margin-bottom: 6px; font-weight: 600; }
    .ak-val { font-family: 'Barlow Condensed', sans-serif; font-size: 28px; font-weight: 900; line-height: 1.1; }
    .ak-val.blue { color: var(--blue, #4E9BF5); }
    .ak-val.orange { color: var(--orange, #e8720c); }
    .ak-val.green { color: var(--green, #2ECC8A); }
    .ak-val.red { color: #E05252; }
    .ak-val.cyan { color: #00d4ff; }
    .ak-sub { font-size: 10px; color: var(--m, #8892A4); margin-top: 4px; opacity: .7; }
    .ak-panel { background: var(--s2, #1a1d23); border: 1px solid var(--br, #2a2d35); border-radius: 10px; margin-bottom: 16px; overflow: hidden; }
    .ak-panel-hdr { padding: 14px 16px; border-bottom: 1px solid var(--br, #2a2d35); font-family: 'Barlow Condensed', sans-serif; font-size: 13px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--t, #fff); display: flex; align-items: center; gap: 8px; }
    .ak-panel-body { padding: 16px; }
    .ak-bar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .ak-bar-label { font-size: 11px; color: var(--m, #8892A4); min-width: 100px; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ak-bar-track { flex: 1; height: 20px; background: var(--s3, #222); border-radius: 4px; overflow: hidden; position: relative; }
    .ak-bar-fill { height: 100%; border-radius: 4px; transition: width .6s cubic-bezier(.22,1,.36,1); display: flex; align-items: center; padding-left: 8px; font-size: 10px; font-weight: 700; color: #fff; min-width: 24px; }
    .ak-bar-count { font-size: 11px; color: var(--m, #8892A4); min-width: 36px; text-align: right; font-weight: 600; }
    .ak-chart { display: flex; align-items: flex-end; gap: 6px; height: 160px; padding: 8px 0; }
    .ak-chart-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; }
    .ak-chart-val { font-size: 9px; color: var(--m, #8892A4); font-weight: 600; }
    .ak-chart-bar-wrap { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; width: 100%; gap: 1px; }
    .ak-chart-bar { width: 100%; border-radius: 3px 3px 0 0; transition: height .5s cubic-bezier(.22,1,.36,1); min-height: 2px; }
    .ak-chart-lbl { font-size: 9px; color: var(--m, #8892A4); white-space: nowrap; }
    .ak-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 640px) { .ak-cols { grid-template-columns: 1fr; } .ak-grid { grid-template-columns: repeat(2, 1fr); gap: 8px; } .ak-card { padding: 12px; } .ak-val { font-size: 22px; } .ak-bar-label { min-width: 70px; font-size: 10px; } }
    .ak-empty { text-align: center; padding: 40px 16px; color: var(--m, #8892A4); font-size: 13px; }
    .ak-empty-icon { font-size: 32px; margin-bottom: 8px; }
    .ak-loading { text-align: center; padding: 60px 16px; color: var(--m, #8892A4); }
    .ak-loading-spinner { display: inline-block; width: 28px; height: 28px; border: 3px solid var(--br, #2a2d35); border-top-color: var(--orange, #e8720c); border-radius: 50%; animation: ak-spin .8s linear infinite; margin-bottom: 12px; }
    @keyframes ak-spin { to { transform: rotate(360deg); } }
  `;

  /**
   * Render the full analytics dashboard into a container.
   */
  function renderAnalyticsDashboard(containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;

    // Inject stylesheet once
    if (!document.getElementById('ak-style')) {
      var style = document.createElement('style');
      style.id = 'ak-style';
      style.textContent = ANALYTICS_CSS;
      document.head.appendChild(style);
    }

    // Show loading
    el.innerHTML =
      '<div class="ak-loading">' +
        '<div class="ak-loading-spinner"></div>' +
        '<div>Loading analytics data...</div>' +
      '</div>';

    fetchAllData().then(function (data) {
      var m = computeFullAnalytics(data);
      renderDashboardHTML(el, m);
    }).catch(function (err) {
      console.error('Analytics fetch error:', err);
      el.innerHTML =
        '<div class="ak-empty">' +
          '<div class="ak-empty-icon">⚠️</div>' +
          '<div>Could not load analytics. Please try again.</div>' +
        '</div>';
    });
  }

  function renderDashboardHTML(el, m) {
    var stageEntries = Object.entries(m.stageMap).sort(function (a, b) { return b[1] - a[1]; });
    var sourceEntries = Object.entries(m.sourceMap).sort(function (a, b) { return b[1] - a[1]; });
    var trendEntries = Object.entries(m.monthlyTrend);

    var maxStage = stageEntries.length > 0 ? stageEntries[0][1] : 1;
    var maxSource = sourceEntries.length > 0 ? sourceEntries[0][1] : 1;
    var maxTrendLeads = Math.max.apply(null, trendEntries.map(function (e) { return e[1].leads; }).concat([1]));
    var maxTrendRev = Math.max.apply(null, trendEntries.map(function (e) { return e[1].revenue; }).concat([1]));

    // Stage colors
    var stageColors = {
      new: '#4E9BF5', contacted: '#00d4ff', inspection_scheduled: '#8B5CF6',
      inspection_complete: '#A855F7', estimate_sent: '#EC4899', negotiation: '#F97316',
      signed: '#2ECC8A', install_scheduled: '#10B981', install_complete: '#059669',
      closed: '#2ECC8A', Complete: '#2ECC8A', lost: '#E05252', Lost: '#E05252'
    };

    function stageColor(s) { return stageColors[s] || 'var(--orange, #e8720c)'; }

    // Friendly stage names
    var stageLabels = {
      new: 'New', contacted: 'Contacted', inspection_scheduled: 'Insp. Scheduled',
      inspection_complete: 'Insp. Complete', estimate_sent: 'Estimate Sent',
      negotiation: 'Negotiation', signed: 'Signed', install_scheduled: 'Install Sched.',
      install_complete: 'Install Complete', closed: 'Closed Won', Complete: 'Complete',
      lost: 'Lost', Lost: 'Lost', final_photos: 'Final Photos',
      final_payment: 'Final Payment', deductible_collected: 'Deductible Collected'
    };

    // Build stage bars
    var stageBarsHTML = '';
    if (stageEntries.length === 0) {
      stageBarsHTML = '<div class="ak-empty"><div class="ak-empty-icon">📊</div>No lead data yet</div>';
    } else {
      stageEntries.forEach(function (entry) {
        var label = stageLabels[entry[0]] || entry[0].replace(/_/g, ' ');
        var count = entry[1];
        var widthPct = Math.max(Math.round((count / maxStage) * 100), 4);
        var color = stageColor(entry[0]);
        stageBarsHTML +=
          '<div class="ak-bar-row">' +
            '<div class="ak-bar-label" title="' + label + '">' + label + '</div>' +
            '<div class="ak-bar-track">' +
              '<div class="ak-bar-fill" style="width:' + widthPct + '%;background:' + color + ';">' + count + '</div>' +
            '</div>' +
            '<div class="ak-bar-count">' + pct(count, m.totalLeads) + '%</div>' +
          '</div>';
      });
    }

    // Build source bars
    var sourceBarsHTML = '';
    if (sourceEntries.length === 0) {
      sourceBarsHTML = '<div class="ak-empty"><div class="ak-empty-icon">📊</div>No source data yet</div>';
    } else {
      sourceEntries.slice(0, 8).forEach(function (entry) {
        var label = entry[0];
        var count = entry[1];
        var widthPct = Math.max(Math.round((count / maxSource) * 100), 4);
        sourceBarsHTML +=
          '<div class="ak-bar-row">' +
            '<div class="ak-bar-label" title="' + label + '">' + label + '</div>' +
            '<div class="ak-bar-track">' +
              '<div class="ak-bar-fill" style="width:' + widthPct + '%;background:var(--orange,#e8720c);">' + count + '</div>' +
            '</div>' +
            '<div class="ak-bar-count">' + pct(count, m.totalLeads) + '%</div>' +
          '</div>';
      });
    }

    // Build monthly trend chart
    var trendChartHTML = '';
    if (trendEntries.length === 0) {
      trendChartHTML = '<div class="ak-empty">No trend data yet</div>';
    } else {
      trendEntries.forEach(function (entry) {
        var mk = entry[0];
        var d = entry[1];
        var leadH = Math.max(Math.round((d.leads / maxTrendLeads) * 100), 2);
        var revH = maxTrendRev > 0 ? Math.max(Math.round((d.revenue / maxTrendRev) * 100), 2) : 2;
        trendChartHTML +=
          '<div class="ak-chart-col">' +
            '<div class="ak-chart-val">' + d.leads + '</div>' +
            '<div class="ak-chart-bar-wrap">' +
              '<div class="ak-chart-bar" style="height:' + leadH + '%;background:var(--blue,#4E9BF5);opacity:.8;" title="' + d.leads + ' leads"></div>' +
              '<div class="ak-chart-bar" style="height:' + revH + '%;background:var(--green,#2ECC8A);opacity:.7;" title="' + formatCurrency(d.revenue) + ' revenue"></div>' +
            '</div>' +
            '<div class="ak-chart-lbl">' + monthLabel(mk) + '</div>' +
          '</div>';
      });
    }

    el.innerHTML =
      '<div class="ak-wrap">' +

        // ── Top KPI cards ──
        '<div class="ak-grid">' +
          '<div class="ak-card green">' +
            '<div class="ak-lbl">Total Revenue</div>' +
            '<div class="ak-val green">' + formatCurrency(m.totalRevenue) + '</div>' +
            '<div class="ak-sub">' + m.paidCount + ' paid invoices' + (m.monthRevenue > 0 ? ' · ' + formatCurrency(m.monthRevenue) + ' this month' : '') + '</div>' +
          '</div>' +
          '<div class="ak-card blue">' +
            '<div class="ak-lbl">Pipeline Value</div>' +
            '<div class="ak-val blue">' + formatCurrency(m.pipelineValue) + '</div>' +
            '<div class="ak-sub">' + m.activeLeadCount + ' active leads</div>' +
          '</div>' +
          '<div class="ak-card orange">' +
            '<div class="ak-lbl">Conversion Rate</div>' +
            '<div class="ak-val orange">' + m.conversionRate + '%</div>' +
            '<div class="ak-sub">' + m.wonCount + ' won / ' + (m.wonCount + m.lostCount) + ' decided</div>' +
          '</div>' +
          '<div class="ak-card cyan">' +
            '<div class="ak-lbl">Avg Deal Size</div>' +
            '<div class="ak-val cyan">' + formatCurrency(m.avgDealSize) + '</div>' +
            '<div class="ak-sub">' + m.wonCount + ' closed deals</div>' +
          '</div>' +
        '</div>' +

        // ── Secondary KPIs ──
        '<div class="ak-grid">' +
          '<div class="ak-card">' +
            '<div class="ak-lbl">Estimates</div>' +
            '<div class="ak-val" style="color:var(--t,#fff)">' + m.totalEstimates + '</div>' +
            '<div class="ak-sub">Avg value ' + formatCurrency(m.avgEstimateValue) + '</div>' +
          '</div>' +
          '<div class="ak-card">' +
            '<div class="ak-lbl">D2D Knocks</div>' +
            '<div class="ak-val" style="color:var(--t,#fff)">' + formatNum(m.totalKnocks) + '</div>' +
            '<div class="ak-sub">' + m.appointments + ' appointments · ' + m.knockToAppt + '% set rate</div>' +
          '</div>' +
          '<div class="ak-card">' +
            '<div class="ak-lbl">Photos</div>' +
            '<div class="ak-val" style="color:var(--t,#fff)">' + formatNum(m.totalPhotos) + '</div>' +
            '<div class="ak-sub">' + m.photoPerLead + ' per lead · ' + m.leadsWithPhotos + ' leads documented</div>' +
          '</div>' +
          '<div class="ak-card red">' +
            '<div class="ak-lbl">Unpaid Invoices</div>' +
            '<div class="ak-val red">' + formatCurrency(m.unpaidAmount) + '</div>' +
            '<div class="ak-sub">' + m.unpaidCount + ' outstanding</div>' +
          '</div>' +
        '</div>' +

        // ── Monthly Trend ──
        '<div class="ak-panel">' +
          '<div class="ak-panel-hdr">📈 Monthly Trend (6 Months)</div>' +
          '<div class="ak-panel-body">' +
            '<div style="display:flex;gap:16px;margin-bottom:8px;font-size:10px;color:var(--m,#8892A4)">' +
              '<span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--blue,#4E9BF5);vertical-align:middle;margin-right:4px"></span>New Leads</span>' +
              '<span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--green,#2ECC8A);vertical-align:middle;margin-right:4px"></span>Revenue</span>' +
            '</div>' +
            '<div class="ak-chart">' + trendChartHTML + '</div>' +
          '</div>' +
        '</div>' +

        // ── Two column: Stage + Source ──
        '<div class="ak-cols">' +
          '<div class="ak-panel">' +
            '<div class="ak-panel-hdr">📊 Leads by Stage</div>' +
            '<div class="ak-panel-body">' + stageBarsHTML + '</div>' +
          '</div>' +
          '<div class="ak-panel">' +
            '<div class="ak-panel-hdr">🎯 Leads by Source</div>' +
            '<div class="ak-panel-body">' + sourceBarsHTML + '</div>' +
          '</div>' +
        '</div>' +

      '</div>';
  }

  // ── Public API ──
  window.renderKPIRow = renderKPIRow;
  window.computeKPIs = computeKPIs;

  window.AnalyticsKPI = {
    init: function () {
      // no-op — data is fetched on render
    },
    render: function (containerId) {
      renderAnalyticsDashboard(containerId || 'analyticsContainer');
    },
    refresh: function (containerId) {
      _analyticsCache.loaded = false;
      renderAnalyticsDashboard(containerId || 'analyticsContainer');
    }
  };

})();
