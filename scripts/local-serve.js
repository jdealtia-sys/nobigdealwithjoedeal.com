#!/usr/bin/env node
/**
 * scripts/local-serve.js — DEV static server for the NBD Pro QA sweep.
 * ====================================================================
 * Serves docs/ on :5000 with Firebase-Hosting-like cleanUrls, but WITHOUT the
 * production Content-Security-Policy. That omission is deliberate and required:
 * the prod CSP `connect-src` does not list the emulator's cross-port localhost
 * origins (127.0.0.1:8080/9099/5001/9199), so under the real CSP the browser
 * would block every emulator request and the app couldn't reach its backend.
 * Functional QA runs against the emulator; CSP itself is covered by the smoke
 * suite + the marketing/security audits.
 *
 * Also: no-cache headers (fresh JS/CSS every reload) and a proxy for the
 * firebase.json function-rewrite paths to the Functions emulator.
 *
 * RUN:  node scripts/local-serve.js          (PORT / NBD_FN_BASE env override)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'docs');
const PORT = Number(process.env.PORT || 5000);
const FN_BASE = process.env.NBD_FN_BASE || 'http://127.0.0.1:5001/nobigdeal-pro/us-central1';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm',
};

// firebase.json rewrites → Functions emulator (functionId).
const FN_ROUTES = [
  { test: (p) => p === '/api/google-reviews', fn: 'getGoogleReviews' },
  { test: (p) => p === '/api/storm-report', fn: 'stormReport' },
  { test: (p) => p === '/cspReport', fn: 'cspReport' },
  { test: (p) => p === '/pro/account-erasure', fn: 'confirmAccountErasure' },
  { test: (p) => p.startsWith('/share/'), fn: 'shareSSR', keepPath: true },
];

function proxyToFunction(route, req, res, fullUrl) {
  const target = FN_BASE + '/' + route.fn + (route.keepPath ? fullUrl : '');
  let u;
  try { u = new URL(target); } catch (e) { res.writeHead(500); return res.end('bad fn target'); }
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const preq = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + (u.search || ''),
      method: req.method, headers: { ...req.headers, host: u.host },
    }, (pres) => { res.writeHead(pres.statusCode || 502, pres.headers); pres.pipe(res); });
    preq.on('error', (e) => { res.writeHead(502, { 'content-type': 'text/plain' }); res.end('fn proxy error: ' + e.message); });
    if (body.length) preq.write(body);
    preq.end();
  });
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store, max-age=0',
    'Access-Control-Allow-Origin': '*',
  });
  fs.createReadStream(filePath).pipe(res);
}

function resolveStatic(urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel.endsWith('/') && rel.length > 1) rel = rel.slice(0, -1);
  if (rel === '' || rel === '/') rel = '/index.html';
  if (rel === '/favicon.ico') rel = '/favicon.svg'; // firebase.json rewrite
  const base = path.normalize(path.join(ROOT, rel));
  if (!base.startsWith(ROOT)) return null; // path-traversal guard
  const candidates = path.extname(base)
    ? [base]
    : [base + '.html', path.join(base, 'index.html'), base];
  for (const c of candidates) {
    try { if (fs.statSync(c).isFile()) return c; } catch (_) {}
  }
  return null;
}

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const route = FN_ROUTES.find((r) => r.test(urlPath));
  if (route) return proxyToFunction(route, req, res, req.url);
  const file = resolveStatic(req.url);
  if (file) return sendFile(res, file);
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>404 Not Found</h1><p>' + urlPath.replace(/[<>&]/g, '') + '</p>');
});

server.listen(PORT, () => {
  console.log('NBD local serve → http://localhost:' + PORT);
  console.log('  root      : ' + ROOT);
  console.log('  cleanUrls : on   |  CSP: OFF (emulator-friendly)  |  cache: no-store');
  console.log('  fn proxy  : ' + FN_BASE);
});
