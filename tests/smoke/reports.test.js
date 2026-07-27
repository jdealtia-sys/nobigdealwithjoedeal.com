/**
 * tests/smoke/reports.test.js — admin analytics gating, Push-1 public
 * lead form helper wire-in.
 */

'use strict';

const path = require('path');
const { ROOT, PRO_JS, FUNCTIONS, read, readFunctionsIndex } = require('./_shared');

module.exports.run = function run(ctx) {
  const { assert, section } = ctx;

section('Push-1: public lead forms use submitPublicLead');
{
  const helper = read(path.join(ROOT, 'docs/assets/js/public-lead-submit.js'));
  assert('public-lead-submit helper exposes window.submitPublicLead',
    /window\.submitPublicLead\s*=\s*submitPublicLead/.test(helper));
  // Verify no page still calls addDoc on the four public collections.
  const pages = [
    'docs/index.html',
    'docs/estimate.html',
    'docs/storm-alerts.html',
    'docs/sites/free-guide/index.html'
  ];
  for (const p of pages) {
    const src = read(path.join(ROOT, p));
    assert(p + ' loads public-lead-submit.js',
      /public-lead-submit\.js/.test(src));
    assert(p + ' no longer calls addDoc on public collections',
      !/addDoc\s*\(\s*collection\s*\([^)]*(guide_leads|contact_leads|estimate_leads|storm_alert_subscribers)/.test(src));
  }
}

section('Wave C3: admin analytics');
{
  const idx = readFunctionsIndex();
  assert('getAdminAnalytics exported', /exports\.getAdminAnalytics\s*=/.test(idx));
  assert('returns signatures + measurements + portal + claude + leads',
    /signatures:[\s\S]{0,500}measurements:[\s\S]{0,500}portal:[\s\S]{0,500}claude:[\s\S]{0,500}leads:/.test(idx));
  const adm = read(path.join(PRO_JS, 'admin-manager.js'));
  assert('loadAnalytics renders KPI tiles', /function loadAnalytics/.test(adm));
}

section('Admin: one-tap Run Migrations (client surface for the runMigrations callable)');
{
  const adm = read(path.join(PRO_JS, 'admin-manager.js'));
  // The callable existed with no UI — a deployed migration sat unapplied
  // until the daily tick. The button closes that gap; the server keeps the
  // platform-admin + App Check gate, so exposure adds no new access.
  assert('runMigrationsNow invokes the runMigrations callable',
    /async function runMigrationsNow\(\)[\s\S]{0,700}callable\('runMigrations'\)/.test(adm));
  assert('runMigrationsNow confirms via nbdConfirm first (iOS-PWA-safe)',
    /runMigrationsNow\(\)[\s\S]{0,300}window\.nbdConfirm \|\| \(\(m\) => Promise\.resolve\(window\.confirm\(m\)\)\)/.test(adm));
  assert('runMigrationsNow surfaces lock, error, no-op and success outcomes',
    /skipped === 'locked'/.test(adm) && /d\.lastError/.test(adm)
    && /Nothing pending/.test(adm) && /Ran ' \+ d\.ranCount/.test(adm));
  assert('AdminManager exports runMigrationsNow', /runMigrationsNow,/.test(adm));
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  assert('admin view has the Run Migrations button (CSP-safe module action)',
    /data-action="module" data-target="AdminManager\.runMigrationsNow"/.test(dash));
}

section('H-04: getAdminAnalytics admin/company_admin gate + rate limit');
{
  const src = readFunctionsIndex();
  assert('H-04: isSoloOwner reference removed',
    !/isSoloOwner/.test(src));
  // The new gate throws permission-denied unless isPlatformAdmin||isCompanyAdmin.
  assert('H-04: solo-owner escape hatch no longer exists on getAdminAnalytics',
    /if\s*\(!isPlatformAdmin\s*&&\s*!isCompanyAdmin\)\s*\{\s*throw new HttpsError\('permission-denied'/.test(src));
  assert('H-04: getAdminAnalytics now rate-limits per-uid',
    /callableRateLimit\(request,\s*'getAdminAnalytics'/.test(src));
}

section('Rep report: "Revenue per Door" is a true per-UNIQUE-door figure');
{
  const rep = read(path.join(PRO_JS, 'rep-report-generator.js'));
  const fn = rep.slice(rep.indexOf('function computeRevenuePerKnock'),
                       rep.indexOf('function computeRevenuePerKnock') + 1600);
  // Denominator is UNIQUE doors (deduped by address→coords→id), not knock count.
  assert('computeRevenuePerKnock dedupes to unique doors',
    /doorsCount = new Set\(inRangeKnocks\.map\(doorKey\)\)\.size/.test(fn) &&
    /revenuePerDoor: doorsCount > 0 \? \(revenue \/ doorsCount\)/.test(fn));
  assert('doorKey falls back address → coords → id',
    /const a = normAddr\(k\.address\)[\s\S]{0,200}geo:['"] \+ Number\(k\.lat\)\.toFixed\(5\)[\s\S]{0,80}k:['"] \+ \(k\.id/.test(fn));
  // The "Revenue per Door" hero must render the per-DOOR value + door count,
  // not the per-knock number (the old mislabel).
  assert('Revenue per Door hero uses revenuePerDoor + doors (not per-knock)',
    /Revenue per Door<\/div>\s*<div class="hero-value">\$\{fmtMoney\(revenuePerKnock\.revenuePerDoor\)/.test(rep) &&
    /fmtNumber\(revenuePerKnock\.doors\)\} doors/.test(rep));
}

};
