/**
 * NBD Pro - Performance Monitoring System
 * Tracks page load times, script load times, view switches, and Firestore query times
 *
 * Exposes: window.PerfMonitor
 * Usage:
 *   PerfMonitor.mark('myMark')                       // Create a performance mark
 *   PerfMonitor.measure('myMeasure', 'myMark')       // Measure between marks
 *   PerfMonitor.getMetrics()                         // Get all metrics
 *   PerfMonitor.renderPerfPanel(containerId)         // Render UI panel
 */

(function() {
  'use strict';

  // Store metrics
  const metrics = {
    marks: {},
    measures: {},
    autoMetrics: {
      pageLoadTime: 0,
      timeToInteractive: 0,
      scriptLoadTimes: {},
      viewSwitchTimes: {},
      firestoreQueryTimes: []
    }
  };

  // Track current view for view switch timing
  let currentView = null;
  let viewSwitchStartTime = null;

  /**
   * Create a performance mark
   */
  function mark(name) {
    const time = performance.now();
    metrics.marks[name] = time;
    
    if (window.performance && window.performance.mark) {
      try {
        performance.mark(name);
      } catch (e) {
        // Mark name already exists or invalid — ignore
      }
    }
  }

  /**
   * Measure between two marks
   */
  function measure(name, startMark, endMark) {
    endMark = endMark || 'now';
    
    if (!metrics.marks[startMark]) {
      console.warn('[PerfMonitor] Start mark not found:', startMark);
      return;
    }

    const startTime = metrics.marks[startMark];
    const endTime = endMark === 'now' ? performance.now() : metrics.marks[endMark];
    
    if (endTime === undefined) {
      console.warn('[PerfMonitor] End mark not found:', endMark);
      return;
    }

    const duration = endTime - startTime;
    metrics.measures[name] = {
      startMark,
      endMark,
      duration,
      startTime,
      endTime
    };

    if (window.performance && window.performance.measure) {
      try {
        performance.measure(name, startMark, endMark);
      } catch (e) {
        // Ignore measurement errors
      }
    }

    return duration;
  }

  /**
   * Record script load time
   */
  function recordScriptLoadTime(bundleName, duration) {
    metrics.autoMetrics.scriptLoadTimes[bundleName] = duration;
  }

  /**
   * Record view switch time
   */
  function recordViewSwitch(viewName, duration) {
    if (!metrics.autoMetrics.viewSwitchTimes[viewName]) {
      metrics.autoMetrics.viewSwitchTimes[viewName] = [];
    }
    metrics.autoMetrics.viewSwitchTimes[viewName].push(duration);
  }

  /**
   * Record Firestore query time
   */
  function recordFirestoreQuery(query, duration, resultCount) {
    metrics.autoMetrics.firestoreQueryTimes.push({
      query,
      duration,
      resultCount,
      timestamp: performance.now()
    });
  }

  /**
   * Get all metrics
   */
  function getMetrics() {
    return JSON.parse(JSON.stringify(metrics));
  }

  /**
   * Calculate page load time
   */
  function getPageLoadTime() {
    if (window.performance && window.performance.timing) {
      const timing = window.performance.timing;
      return timing.loadEventEnd - timing.navigationStart;
    }
    return 0;
  }

  /**
   * Calculate time to interactive
   */
  function getTimeToInteractive() {
    if (window.performance && window.performance.getEntriesByName) {
      const entries = performance.getEntriesByType('navigation');
      if (entries.length > 0) {
        const nav = entries[0];
        return nav.domInteractive - nav.fetchStart;
      }
    }
    return 0;
  }

  /**
   * Get average view switch time
   */
  function getAverageViewSwitchTime(viewName) {
    const times = metrics.autoMetrics.viewSwitchTimes[viewName];
    if (!times || times.length === 0) return 0;
    return times.reduce((a, b) => a + b) / times.length;
  }

  /**
   * Render performance panel in UI
   */
  function renderPerfPanel(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.warn('[PerfMonitor] Container not found:', containerId);
      return;
    }

    const pageLoadTime = getPageLoadTime();
    const tti = getTimeToInteractive();

    let html = `
      <div style="padding: 16px; background: #f9fafb; border-radius: 6px; font-family: Barlow, monospace; font-size: 11px;">
        <div style="margin-bottom: 16px; font-weight: 700; color: #1f2937; font-size: 13px;">Performance Metrics</div>
        
        <div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #e5e7eb;">
          <div style="color: #6b7280; margin-bottom: 4px;">Page Load Time</div>
          <div style="font-weight: 700; color: #e8720c; font-size: 16px;">${pageLoadTime.toFixed(0)}ms</div>
        </div>

        <div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #e5e7eb;">
          <div style="color: #6b7280; margin-bottom: 4px;">Time to Interactive</div>
          <div style="font-weight: 700; color: #1e3a6e; font-size: 16px;">${tti.toFixed(0)}ms</div>
        </div>
    `;

    // Script load times
    const scriptTimes = Object.entries(metrics.autoMetrics.scriptLoadTimes);
    if (scriptTimes.length > 0) {
      html += `
        <div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #e5e7eb;">
          <div style="color: #6b7280; margin-bottom: 6px; font-weight: 600;">Script Load Times</div>
      `;

      scriptTimes.forEach(([bundle, duration]) => {
        html += `
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span>${bundle}</span>
            <span style="font-weight: 600;">${duration.toFixed(0)}ms</span>
          </div>
        `;
      });

      html += '</div>';
    }

    // View switch times
    const viewTimes = Object.entries(metrics.autoMetrics.viewSwitchTimes);
    if (viewTimes.length > 0) {
      html += `
        <div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #e5e7eb;">
          <div style="color: #6b7280; margin-bottom: 6px; font-weight: 600;">View Switch Times (Avg)</div>
      `;

      viewTimes.forEach(([view, times]) => {
        const avg = times.reduce((a, b) => a + b) / times.length;
        html += `
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span>${view}</span>
            <span style="font-weight: 600;">${avg.toFixed(0)}ms</span>
          </div>
        `;
      });

      html += '</div>';
    }

    // Firestore query stats
    if (metrics.autoMetrics.firestoreQueryTimes.length > 0) {
      const queries = metrics.autoMetrics.firestoreQueryTimes;
      const avgDuration = queries.reduce((sum, q) => sum + q.duration, 0) / queries.length;
      const maxDuration = Math.max(...queries.map(q => q.duration));

      html += `
        <div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #e5e7eb;">
          <div style="color: #6b7280; margin-bottom: 6px; font-weight: 600;">Firestore Queries</div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span>Count</span>
            <span style="font-weight: 600;">${queries.length}</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span>Avg Time</span>
            <span style="font-weight: 600;">${avgDuration.toFixed(0)}ms</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span>Max Time</span>
            <span style="font-weight: 600;">${maxDuration.toFixed(0)}ms</span>
          </div>
        </div>
      `;
    }

    html += '<div style="font-size: 10px; color: #9ca3af;">Last updated: ' + new Date().toLocaleTimeString() + '</div>';
    html += '</div>';

    container.innerHTML = html;
  }

  /**
   * Auto-track page load
   */
  function initAutoTracking() {
    // Mark page start
    mark('page-start');

    // Track when page load completes
    window.addEventListener('load', function() {
      mark('page-load-end');
      measure('page-load', 'page-start', 'page-load-end');
      metrics.autoMetrics.pageLoadTime = getPageLoadTime();
    });

    // Track when DOM is interactive
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        mark('dom-interactive');
        measure('dom-ready', 'page-start', 'dom-interactive');
        metrics.autoMetrics.timeToInteractive = getTimeToInteractive();
      });
    } else {
      mark('dom-interactive');
      metrics.autoMetrics.timeToInteractive = getTimeToInteractive();
    }
  }

  /**
   * Integrate with ScriptLoader to auto-track bundle loads
   */
  function integrateWithScriptLoader() {
    if (window.ScriptLoader) {
      const originalLoad = window.ScriptLoader.load;
      const originalLoadBundle = window.ScriptLoader.loadBundle;

      window.ScriptLoader.load = function(src) {
        const startTime = performance.now();
        const result = originalLoad.call(this, src);

        if (result && typeof result.then === 'function') {
          result.then(() => {
            const duration = performance.now() - startTime;
            const bundleName = src.split('/').pop().replace(/\.js.*$/, '');
            recordScriptLoadTime(bundleName, duration);
          });
        }

        return result;
      };

      window.ScriptLoader.loadBundle = function(name) {
        const startTime = performance.now();
        const result = originalLoadBundle.call(this, name);

        if (result && typeof result.then === 'function') {
          result.then(() => {
            const duration = performance.now() - startTime;
            recordScriptLoadTime(name, duration);
          });
        }

        return result;
      };
    }
  }

  // Initialize auto-tracking
  initAutoTracking();
  
  // Try to integrate with ScriptLoader if available
  if (window.ScriptLoader) {
    integrateWithScriptLoader();
  } else {
    // If ScriptLoader loads later, set up integration
    document.addEventListener('DOMContentLoaded', function() {
      if (window.ScriptLoader && !window.ScriptLoader._perfIntegrated) {
        integrateWithScriptLoader();
        window.ScriptLoader._perfIntegrated = true;
      }
    });
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  window.PerfMonitor = {
    mark,
    measure,
    recordScriptLoadTime,
    recordViewSwitch,
    recordFirestoreQuery,
    getMetrics,
    getPageLoadTime,
    getTimeToInteractive,
    getAverageViewSwitchTime,
    renderPerfPanel,
    
    // Expose internals for advanced use
    _metrics: metrics
  };

  console.log('[PerfMonitor] Initialized. Performance tracking active.');
  console.log('  PerfMonitor.mark(name) — Create mark');
  console.log('  PerfMonitor.measure(name, startMark) — Measure duration');
  console.log('  PerfMonitor.getMetrics() — View all metrics');
  console.log('  PerfMonitor.renderPerfPanel(id) — Show UI panel');

})();
