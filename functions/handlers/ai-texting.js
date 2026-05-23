/**
 * functions/handlers/ai-texting.js — T-1: AI Texting foundation
 * ═══════════════════════════════════════════════════════════════
 *
 * KICKOFF STATE: this is the canonical home for the T-1 module
 * (ported from the WIP at `claude/t1-ai-texting-foundation` commit
 * `013f457`, paused during v2.0-final cleanup). It exports
 * `generateAIDraft` but is not yet imported anywhere — the file
 * deploys with zero new triggers. The next PR (T-1 step 2) will
 * require it from `sms-functions.js`'s incomingSMS handler and start
 * writing drafts to `/leads/{leadId}/ai_drafts`. Until then this is a
 * pure helper module gated on ANTHROPIC_API_KEY (already declared by
 * `handlers/ai.js` for the Claude proxy, so no new secret setup is
 * needed when step 2 lands).
 *
 * Drafts SMS replies for the rep to one-tap send. Triggered by the
 * incomingSMS webhook (functions/sms-functions.js) — when a homeowner
 * texts in, this module:
 *
 *   1. Pulls lead context (lead doc + recent SMS history + recent
 *      notes/activity) so Claude has a real conversation memory
 *   2. Calls Claude Haiku 4.5 with the "Joe's assistant" persona +
 *      hard guardrails (no pricing, no scope commitments, no
 *      scheduling promises)
 *   3. Writes a doc to /leads/{leadId}/ai_drafts/{draftId} with the
 *      draft + status:'pending'
 *   4. Sends a rep-bell notification with the draft text
 *
 * The rep sees this in the CRM (T-2 ships the UI), can edit / send
 * with one tap, or skip. No customer-facing autonomous send in v1
 * — every text the customer receives is rep-approved.
 *
 * Persona: "Joe's assistant texting on his behalf" — TCPA-clean
 * identification, sets expectations that the homeowner is talking
 * to an assistant, not Joe directly.
 *
 * Guardrails (encoded in the system prompt):
 *   - NEVER quote a price
 *   - NEVER commit to a scope of work
 *   - NEVER commit to a date without "I'll have Joe confirm"
 *   - ALWAYS identify as Joe's assistant on first message
 *   - When unsure, escalate ("Let me grab Joe on that")
 *
 * Cost: ~$0.01 per draft (Haiku is ~$0.25/M input + $1.25/M output;
 * average draft = 800 input tokens + 80 output tokens = ~$0.0003).
 * At 1000 inbound SMS/month, ~$0.30/mo of AI cost.
 */

'use strict';

const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

// ─── Persona system prompt ─────────────────────────────────────
// Locked in this module so every draft uses the same identity +
// guardrails. If we want a per-rep persona later (Joe's assistant
// vs. another rep's), add a per-user setting and template-merge
// the rep's first name in.
const PERSONA_PROMPT = `You are "Joe's assistant" — an AI texting on behalf of Joe Deal of No Big Deal Home Solutions, a residential roofing company in Greater Cincinnati. Joe is a hands-on field rep; you handle his first-touch SMS replies while he's on a roof.

═══ IDENTITY ═══
- On a FIRST message to a new homeowner: open with "Hi {firstName} — this is Joe's assistant texting on his behalf while he's in the field." Be transparent. Never pretend to be Joe.
- On a CONTINUING thread: drop the intro. Just respond naturally as Joe's assistant would.
- Sign off with "— Joe's assistant" only when it feels natural; not every message needs it.

═══ TONE ═══
- Warm, brief, professional. Match how a small-business owner in Cincinnati would text — friendly but not chatty.
- Texts should usually be 1-3 sentences. Long replies feel robotic over SMS.
- Use the homeowner's first name once if you have it.

═══ HARD RULES — NEVER VIOLATE ═══
1. NEVER quote a price or estimate. If asked "how much?" → "Joe handles all pricing personally — he'll come out, take a look, and put a real number on it for you. Want to set up a free inspection?"
2. NEVER commit to a date or time without checking. If asked "when can you come?" → "Let me check Joe's schedule and I'll text back a couple options."
3. NEVER promise scope ("yes we'll replace your gutters too"). If asked → "That's exactly the kind of thing Joe wants to look at in person."
4. NEVER make up details about a customer or job you don't see in context.
5. If a homeowner sounds angry, frustrated, or mentions a complaint → don't try to fix it via text. Reply: "I want to make sure Joe gets this directly — he'll call you back today. Best number to reach you?"
6. If asked anything legal, insurance, or technical that's outside basic info → escalate: "Joe's the one to answer that — he'll get back to you shortly."

═══ THINGS YOU CAN HELP WITH ═══
- Confirming/rescheduling inspections (offer to check Joe's calendar)
- Sharing the company portal link if the homeowner is already a customer
- Acknowledging messages so the homeowner knows we got them
- Asking for basic info if they're a new lead (address, what's going on with the roof)
- Reminding about upcoming appointments
- Saying thanks after a job + asking how the work is holding up

═══ FORMAT ═══
Return ONLY the SMS text — no preamble, no commentary, no "Here's a draft:". Just the message a human would tap Send on.`;

// ─── Anthropic call ────────────────────────────────────────────
async function callClaudeForDraft({ system, userText, maxTokens, apiKey }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
      'Anthropic-Version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userText }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    logger.warn('[ai-texting] Claude error', { status: res.status, body: body.slice(0, 300) });
    throw new Error('AI draft generation failed');
  }
  const data = await res.json();
  const text = (data?.content?.[0]?.text || '').trim();
  return { text, usage: data?.usage || null };
}

// ─── Context builder ───────────────────────────────────────────
// Pulls the conversation memory Claude needs:
//   - Lead identity (firstName, lastName, address, stage)
//   - Last N inbound/outbound SMS for this lead (so the AI sees the
//     thread, not just the latest message)
//   - The 3 most recent activity entries (notes, voice memos, etc.)
//
// Output is a compact text block ready to splice into the prompt.
async function buildLeadContext(db, leadId, lead, incomingBody) {
  const firstName = lead.firstName || '';
  const lastName  = lead.lastName  || '';
  const stage     = lead.stage     || 'new';
  const address   = lead.address   || '';
  const isCustomer= (lead.stage === 'Complete') || lead.completedAt || lead.installCompletedAt;
  const isProspect= !!lead.isProspect;

  // ── Recent SMS thread (last 12 msgs ordered oldest → newest) ──
  let thread = [];
  try {
    const snap = await db.collection('leads').doc(leadId).collection('notes')
      .where('type', '==', 'sms')
      .orderBy('createdAt', 'desc')
      .limit(12).get();
    thread = snap.docs.map(d => d.data()).reverse(); // chronological
  } catch (_) { /* missing index — first run; skip */ }

  // ── Recent non-SMS activity ──
  let activity = [];
  try {
    const snap = await db.collection('leads').doc(leadId).collection('activity')
      .orderBy('createdAt', 'desc')
      .limit(5).get();
    activity = snap.docs.map(d => d.data());
  } catch (_) { /* no activity yet */ }

  // ── Format ──
  const lines = [];
  lines.push('═══ WHO THIS IS ═══');
  lines.push(`Name: ${firstName} ${lastName}`.trim() || 'Name: (unknown)');
  if (address) lines.push(`Address: ${address}`);
  lines.push(`Relationship: ${isCustomer ? 'Past customer (job complete)' : isProspect ? 'Prospect (not yet qualified)' : 'Active lead — stage ' + stage}`);
  if (lead.jobType) lines.push(`Job type: ${lead.jobType}`);
  if (lead.insCarrier) lines.push(`Insurance carrier: ${lead.insCarrier}`);
  if (lead.claimNumber) lines.push(`Claim no.: ${lead.claimNumber}`);

  if (thread.length > 0) {
    lines.push('');
    lines.push('═══ RECENT TEXT THREAD (oldest → newest) ═══');
    for (const m of thread) {
      const dir = m.direction === 'incoming' ? 'HOMEOWNER' : 'JOE/ASSISTANT';
      const body = String(m.body || '').slice(0, 240);
      lines.push(`[${dir}] ${body}`);
    }
  } else {
    lines.push('');
    lines.push('═══ RECENT TEXT THREAD ═══');
    lines.push('(no prior text history — this is the first inbound SMS from this lead)');
  }

  if (activity.length > 0) {
    lines.push('');
    lines.push('═══ RECENT ACTIVITY ═══');
    for (const a of activity) {
      const label = a.label || a.type || 'activity';
      const msg = a.message || a.transcript || '';
      lines.push(`- ${label}${msg ? ': ' + msg.slice(0, 120) : ''}`);
    }
  }

  lines.push('');
  lines.push('═══ THE NEW INBOUND MESSAGE TO REPLY TO ═══');
  lines.push(incomingBody);

  return lines.join('\n');
}

// ─── Main entry ────────────────────────────────────────────────
// Called by sms-functions.js's incomingSMS webhook. Generates a
// draft + writes to /leads/{leadId}/ai_drafts. Returns the draftId
// (or null on failure — caller logs but doesn't fail the webhook).
//
// Wrapped in a 12s safety timeout so a slow Claude response can't
// blow Twilio's 15s webhook ceiling.
async function generateAIDraft({ db, leadId, lead, incomingBody, incomingNoteId, incomingPhone }) {
  if (!leadId || !lead || !incomingBody) return null;

  let apiKey;
  try { apiKey = ANTHROPIC_API_KEY.value(); } catch (_) {}
  if (!apiKey) {
    logger.info('[ai-texting] ANTHROPIC_API_KEY unset — skipping draft generation');
    return null;
  }

  const t0 = Date.now();
  const contextBlock = await buildLeadContext(db, leadId, lead, incomingBody);

  // Hard 10s timeout on the Claude call so the webhook stays under
  // Twilio's 15s ceiling even if Anthropic is being slow.
  const claudePromise = callClaudeForDraft({
    system: PERSONA_PROMPT,
    userText: contextBlock,
    maxTokens: 280, // SMS = 1-3 sentences; 280 tokens ≈ 200 words ≈ 1300 chars
    apiKey,
  });
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('claude_timeout')), 10_000));

  let result;
  try {
    result = await Promise.race([claudePromise, timeout]);
  } catch (e) {
    logger.warn('[ai-texting] draft generation failed', { leadId, err: e.message });
    return null;
  }

  const draftText = (result.text || '').trim();
  if (!draftText) return null;

  const ownerUid  = lead.userId || null;
  const companyId = lead.companyId || ownerUid || null;
  const customerName = ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim() || null;

  try {
    const ref = await db.collection('leads').doc(leadId).collection('ai_drafts').add({
      leadId,
      userId: ownerUid,
      companyId,
      triggerType:   'inbound_sms',
      incomingMsgId: incomingNoteId || null,
      incomingBody:  String(incomingBody).slice(0, 1600),
      incomingPhone: incomingPhone || null,
      draftText,
      model:        'claude-haiku-4-5-20251001',
      status:       'pending',
      customerName,
      customerPhone: lead.phone || incomingPhone || null,
      generatedAt:  admin.firestore.FieldValue.serverTimestamp(),
      generationMs: Date.now() - t0,
      promptTokens:     result.usage?.input_tokens || null,
      completionTokens: result.usage?.output_tokens || null,
    });
    logger.info('[ai-texting] draft created', { leadId, draftId: ref.id, ms: Date.now() - t0 });
    return ref.id;
  } catch (e) {
    logger.warn('[ai-texting] draft write failed', { leadId, err: e.message });
    return null;
  }
}

module.exports = {
  generateAIDraft,
  buildLeadContext,         // exported for unit tests + T-3..T-5 reuse
  ANTHROPIC_API_KEY,        // re-exported so sms-functions.js can declare the secret dependency
  PERSONA_PROMPT,           // exported for future per-rep customization
};
