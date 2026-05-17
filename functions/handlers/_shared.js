/**
 * functions/handlers/_shared.js — constants + helpers shared by the
 * inline-handler files extracted from index.js (Step 4c).
 *
 * Re-exports the constants every handler used to read from the top of
 * index.js (CORS_ORIGINS, Claude budget caps, Anthropic model allow-
 * list) plus the helper functions that were too small to deserve their
 * own module but get consumed by multiple handler files
 * (estimateInputTokens, reserveClaudeBudget, adjustClaudeBudget,
 * reverseGeocode, parseAddress, _generateE2EPassword,
 * requireTeamAdmin, normalizeRole, normalizeEmail, INVITE_ALLOWED_ROLES,
 * TEAM_ROLES, PROVISION_OWNER_EMAILS, E2E_TEST_USER_EMAIL,
 * LEGACY_ACCESS_CODES).
 *
 * Imports nothing from ../index.js (no circular dep).
 */

'use strict';

const admin = require('firebase-admin');
const { HttpsError } = require('firebase-functions/v2/https');

// ── CORS origins — exact match, no startsWith, no wildcards. ─────────
const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://www.nobigdealwithjoedeal.com',
  'https://nobigdeal-pro.web.app',
];

// ── Anthropic model allowlist — Opus removed; too expensive. ─────────
const ALLOWED_CLAUDE_MODELS = new Set([
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-20250514',
]);
const CLAUDE_MAX_TOKENS_CAP = 1024;
const CLAUDE_DAILY_TOKEN_BUDGET = 200000; // per uid per calendar day
const CLAUDE_PER_MIN_LIMIT = 20;
// M-03 / blueprint placeholder — see header in original index.js.
const CLAUDE_COMPANY_BUDGET = {
  lite:          10_000,
  foundation:    50_000,
  starter:       50_000,
  blueprint:    120_000,
  growth:       250_000,
  professional: 1_000_000
};
const CLAUDE_COMPANY_BUDGET_DEFAULT = 10_000;
const CLAUDE_RESERVATION_MAX = 4 * CLAUDE_MAX_TOKENS_CAP;
const CLAUDE_MAX_MESSAGES      = 40;
const CLAUDE_MAX_PAYLOAD_BYTES = 200_000;

// ── Claude budget helpers (used by handlers/ai.js → claudeProxy) ─────
function estimateInputTokens(messages, system) {
  let chars = 0;
  try { chars += JSON.stringify(messages || []).length; } catch (_) {}
  if (typeof system === 'string') chars += system.length;
  return Math.ceil(chars / 4);
}

async function reserveClaudeBudget(db, uidRef, coRef, reservation, caps) {
  return db.runTransaction(async (tx) => {
    const [u, c] = await Promise.all([tx.get(uidRef), tx.get(coRef)]);
    const uConsumed = (u.exists && u.data().tokens) || 0;
    const cConsumed = (c.exists && c.data().tokens) || 0;
    if (!caps.isAdmin && uConsumed + reservation > caps.uidCap) {
      return { ok: false, scope: 'uid', consumed: uConsumed, cap: caps.uidCap };
    }
    if (!caps.isAdmin && cConsumed + reservation > caps.coCap) {
      return { ok: false, scope: 'company', consumed: cConsumed, cap: caps.coCap };
    }
    const srv = admin.firestore.FieldValue.serverTimestamp();
    const inc = admin.firestore.FieldValue.increment(reservation);
    tx.set(uidRef, {
      tokens: inc, updatedAt: srv,
      uid: caps.uid, dayKey: caps.dayKey, scope: 'uid'
    }, { merge: true });
    tx.set(coRef, {
      tokens: inc, updatedAt: srv,
      companyId: caps.companyId, dayKey: caps.dayKey, scope: 'company'
    }, { merge: true });
    return { ok: true };
  });
}

async function adjustClaudeBudget(uidRef, coRef, delta) {
  if (!delta) return;
  const inc = admin.firestore.FieldValue.increment(delta);
  await Promise.all([
    uidRef.set({ tokens: inc }, { merge: true }),
    coRef.set({ tokens: inc }, { merge: true })
  ]);
}

// ── Geocoding helpers (used by handlers/migrations.js → backfillAnalytics) ─
async function reverseGeocode(lat, lng, apiKey) {
  const url = 'https://maps.googleapis.com/maps/api/geocode/json?latlng=' + lat + ',' + lng + '&key=' + apiKey;
  const response = await fetch(url);
  if (!response.ok) return null;
  const data = await response.json();
  if (data.status !== 'OK' || !data.results || !data.results.length) return null;
  const components = data.results[0].address_components || [];
  const result = {};
  for (const c of components) {
    if (c.types.includes('locality')) result.city = c.long_name;
    else if (c.types.includes('administrative_area_level_1')) result.state = c.short_name;
    else if (c.types.includes('postal_code')) result.zip = c.long_name;
  }
  return result;
}

function parseAddress(addr) {
  if (!addr || typeof addr !== 'string') return {};
  const parts = addr.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return {};
  const result = {};
  // Last part: "OH 45202" or "45202"
  const last = parts[parts.length - 1];
  const zipMatch = last.match(/\b(\d{5}(?:-\d{4})?)\b/);
  if (zipMatch) result.zip = zipMatch[1];
  const stateMatch = last.match(/\b([A-Z]{2})\b/);
  if (stateMatch) result.state = stateMatch[1];
  if (parts.length >= 2) {
    result.city = parts[parts.length - 2];
  }
  return result;
}

// ── E2E test helpers (used by handlers/auth.js → provisionE2ETestUser) ─
const E2E_TEST_USER_EMAIL = 'playwright-e2e@nobigdealwithjoedeal.com';
const PROVISION_OWNER_EMAILS = new Set([
  'jd@nobigdealwithjoedeal.com',
  'jonathandeal459@gmail.com'
]);

function _generateE2EPassword() {
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@$%';
  const crypto = require('crypto');
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

// ── Invite/Team role constants ───────────────────────────────────────
// Role taxonomy — platform-wide allowlist. The `admin` role is PLATFORM
// admin and is reserved for support/ops — it grants cross-tenant reads via
// Firestore rules. Tenant-scoped admins use `company_admin`, which is
// bounded to their own `companyId` claim. Nothing below platform admin
// should ever be settable through the invite flow.
const INVITE_ALLOWED_ROLES = new Set(['company_admin', 'manager', 'sales_rep', 'viewer']);

// Tenant-scoped roles. `admin` (platform-global) is deliberately NOT in
// this list — granting it requires manual admin SDK script, never a UI
// path. Tenant admins use `company_admin`, which owns the company but
// cannot read other tenants' data.
const TEAM_ROLES = ['company_admin', 'manager', 'sales_rep', 'viewer'];

// Legacy access codes (handlers/admin.js → rotateAccessCodes)
const LEGACY_ACCESS_CODES = [
  'NBD-2026', 'NBD-DEMO', 'DEMO', 'TRYIT',
  'DEAL-2026', 'ROOFCON26', 'NBD-STORM'
];

// ── Team-admin helpers (used by handlers/admin.js callables) ─────────
// Resolve the caller's company and confirm they can manage it.
// Returns { uid, companyId, isOwner, isGlobalAdmin } or throws HttpsError.
async function requireTeamAdmin(request, targetCompanyId = null) {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');

  const claims = request.auth.token || {};
  const isGlobalAdmin = claims.role === 'admin';
  // Solo operators own a company keyed by their uid. Team members carry a
  // companyId claim set by onRepSignup. Fall back to uid for solo owners.
  const callerCompanyId = claims.companyId || uid;
  const companyId = targetCompanyId || callerCompanyId;

  // Cross-company ops are admin-only.
  if (!isGlobalAdmin && companyId !== callerCompanyId) {
    throw new HttpsError('permission-denied', 'Cannot manage another company');
  }

  // Verify ownership against the company doc if one exists.
  const db = admin.firestore();
  const companyRef = db.doc(`companies/${companyId}`);
  const companySnap = await companyRef.get();
  const ownerId = companySnap.exists ? (companySnap.data().ownerId || null) : null;
  const isOwner = ownerId === uid || (!companySnap.exists && companyId === uid);

  if (!isGlobalAdmin && !isOwner) {
    // Managers can list their team but not mutate — the caller gates mutations.
    throw new HttpsError('permission-denied', 'Owner or admin access required');
  }

  return { uid, companyId, isOwner, isGlobalAdmin, companyRef };
}

// Platform admin role is NEVER grantable through this function — not
// even by another platform admin. It is a manual admin-SDK script
// operation so it leaves a clear paper trail and cannot be triggered
// through a compromised browser session. The UI picker only offers
// the four tenant-scoped roles.
function normalizeRole(role) {
  if (typeof role !== 'string') return null;
  const r = role.trim().toLowerCase();
  if (r === 'admin') return null;  // platform admin — blocked here
  if (!TEAM_ROLES.includes(r)) return null;
  return r;
}

function normalizeEmail(email) {
  if (typeof email !== 'string') return null;
  const e = email.trim().toLowerCase();
  if (!e.includes('@') || e.length < 5 || e.length > 200) return null;
  return e;
}

module.exports = {
  // CORS
  CORS_ORIGINS,
  // Anthropic / Claude
  ALLOWED_CLAUDE_MODELS,
  CLAUDE_MAX_TOKENS_CAP,
  CLAUDE_DAILY_TOKEN_BUDGET,
  CLAUDE_PER_MIN_LIMIT,
  CLAUDE_COMPANY_BUDGET,
  CLAUDE_COMPANY_BUDGET_DEFAULT,
  CLAUDE_RESERVATION_MAX,
  CLAUDE_MAX_MESSAGES,
  CLAUDE_MAX_PAYLOAD_BYTES,
  estimateInputTokens,
  reserveClaudeBudget,
  adjustClaudeBudget,
  // Geocoding
  reverseGeocode,
  parseAddress,
  // E2E test
  E2E_TEST_USER_EMAIL,
  PROVISION_OWNER_EMAILS,
  _generateE2EPassword,
  // Invite/Team
  INVITE_ALLOWED_ROLES,
  TEAM_ROLES,
  LEGACY_ACCESS_CODES,
  requireTeamAdmin,
  normalizeRole,
  normalizeEmail,
};
