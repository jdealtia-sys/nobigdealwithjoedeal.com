/**
 * scripts/backfill-calcom-dropped-leads.js
 *
 * REPAIR TOOL — mints the CRM records for Cal.com bookings that the webhook
 * accepted but never turned into a lead.
 *
 * Background
 * ──────────
 * Until PR #1288 (2026-08-28), `functions/integrations/calcom.js` had no code
 * path that CREATED a lead. It wrote `appointments/{bookingId}` and stamped
 * `leadId` only when the attendee already matched a lead in the rep's
 * pipeline (the M-1 block). A first-time/organic booker matched nothing, so
 * `leadId` stayed null and nothing promoted the orphaned appointment — the
 * Pipeline never queries `appointments`, so the booking was invisible in the
 * CRM. The webhook returned `200 {ok:true}` throughout; nothing errored.
 *
 * There were TWO distinct drop points, and this script repairs both:
 *
 *   A. rep-lookup drop — `users/{uid}.calcomUsername` was unset, so the
 *      organizer→rep map failed. The handler logged
 *      `calcomWebhook: no matching rep — booking dropped`, returned 200, and
 *      returned BEFORE the appointment write. Neither a lead NOR an
 *      appointment doc exists. This is the likely state for any booking made
 *      before Jo set `calcomUsername` on 2026-08-28.
 *   B. lead-creation drop — the rep matched, so `appointments/{uid}` WAS
 *      written correctly, but `leadId` is null and no lead exists.
 *
 * The fix is forward-only, so bookings taken before it deployed still need
 * this. See documentation/projects/SESSION-2026-08-28-calcom-lead-drop.md.
 *
 * WHY THE BOOKING UID MATTERS
 * ───────────────────────────
 * The lead doc id is `L.bridgeDocId('calcom', <uid>)` — the SAME derivation
 * the live webhook uses. That is what makes a later RESCHEDULE of the same
 * booking a no-op instead of a second pipeline card. Minting a lead under an
 * invented id would silently defeat that, so this script refuses to guess:
 * it either reads bookings from the Cal.com API or takes an explicit
 * `--booking-uid`. Nothing about the doc shape is re-derived here — it is
 * built from `functions/lead-bridge-logic.js` and `functions/phone-utils.js`,
 * the same modules the webhook imports, so the two cannot drift.
 *
 * NO PII IS HARDCODED. Attendee details come from the Cal.com API at run
 * time, or from explicit flags. Nothing about a customer is committed here.
 *
 * NOT a one-shot migration, so deliberately NOT wired to
 * scripts/_migration-guard.js: more bookings can land in a dropped state
 * (e.g. a rep who never sets their Cal.com username), and re-running is
 * safe by construction — every write is existence-checked, and the lead is
 * written with .create() so a concurrent webhook delivery cannot be
 * clobbered.
 *
 * SETUP (admin-script-runner pattern — prod nobigdeal-pro via ADC, with
 * NODE_PATH pointed at a firebase-admin v12 install; v14 breaks Timestamp):
 *   export GOOGLE_APPLICATION_CREDENTIALS=~/.nbd/nobigdeal-pro-sa.json
 *   export NODE_PATH=/path/to/fa12/node_modules    # firebase-admin@12
 *   export NBD_PROJECT=nobigdeal-pro               # optional override
 *   export CALCOM_API_KEY=cal_live_...             # only for API mode
 *
 * RUN
 *   # API mode — list bookings in a window and report what is missing
 *   node scripts/backfill-calcom-dropped-leads.js --from=2026-08-01 --to=2026-09-30
 *   node scripts/backfill-calcom-dropped-leads.js --from=2026-08-01 --to=2026-09-30 --apply --yes
 *
 *   # Manual mode — no API key needed; uid is the last path segment of the
 *   # booking's Cal.com link (also in the confirmation email's reschedule URL)
 *   node scripts/backfill-calcom-dropped-leads.js \
 *     --booking-uid=abc123 --name="Jane Doe" --email=jane@example.com \
 *     --phone=+15551234567 --start=2026-08-29T14:00:00Z --duration=30 \
 *     --title="Free Roof Inspection" --location="123 Main St, Town, ST" \
 *     --notes="what the homeowner typed" --organizer-username=nobigdeal
 *
 * SAFETY
 *   • Dry-run by default — prints the exact docs it WOULD write.
 *   • --apply requires --yes.
 *   • Idempotent: skips a booking that already has its lead, and never
 *     creates a second lead when the attendee already matches an existing
 *     one (same email / last-10-phone rule the webhook uses) — it links the
 *     appointment to that lead instead.
 *   • Never overwrites an existing lead or an appointment's non-null leadId.
 */

'use strict';

const { initAdmin, getFirestore, FieldValue, Timestamp, getAuth } = require('./_admin');

// The SAME modules the live webhook imports — doc shape cannot drift.
const { phoneDigits10 } = require('../functions/phone-utils');
const L = require('../functions/lead-bridge-logic');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const YES = args.includes('--yes');

function flag(name, dflt) {
  const hit = args.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : dflt;
}

const PROJECT = process.env.NBD_PROJECT || 'nobigdeal-pro';
const CAL_API_KEY = process.env.CALCOM_API_KEY || '';
// Cal.com API v2. v1 is retired (410). The bookings resource is versioned
// separately from event-types/schedules — override if Cal.com moves it.
const CAL_API_VERSION = flag('cal-api-version', '2024-08-13');
const CAL_BASE = flag('cal-base', 'https://api.cal.com/v2');

const SOURCE_LABEL = 'Website — Cal.com booking';

// ── booking sources ─────────────────────────────────────────────────

// Manual mode: one booking described entirely by flags.
function bookingFromFlags() {
  const uid = flag('booking-uid');
  if (!uid) return null;
  const start = flag('start');
  const durationMin = Number(flag('duration', '30'));
  const startDate = start ? new Date(start) : null;
  if (start && isNaN(startDate.getTime())) {
    throw new Error('--start is not a parseable date: ' + start);
  }
  return {
    uid,
    title: flag('title', 'Free Roof Inspection'),
    startTime: startDate,
    endTime: startDate ? new Date(startDate.getTime() + durationMin * 60000) : null,
    location: flag('location', ''),
    notes: flag('notes', ''),
    organizerUsername: flag('organizer-username', 'nobigdeal'),
    organizerEmail: flag('organizer-email', ''),
    attendee: {
      name: flag('name', ''),
      email: flag('email', ''),
      phoneNumber: flag('phone', ''),
    },
  };
}

// API mode: pull bookings in a window.
async function bookingsFromApi(from, to) {
  if (!CAL_API_KEY) {
    throw new Error(
      'CALCOM_API_KEY is not set. Either export it, or describe one booking ' +
      'with --booking-uid=... (see the header for the full flag list).'
    );
  }
  const url = new URL(CAL_BASE + '/bookings');
  if (from) url.searchParams.set('afterStart', new Date(from).toISOString());
  if (to) url.searchParams.set('beforeEnd', new Date(to).toISOString());
  url.searchParams.set('take', '250');

  const res = await fetch(url, {
    headers: {
      Authorization: 'Bearer ' + CAL_API_KEY,
      'cal-api-version': CAL_API_VERSION,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      'Cal.com API ' + res.status + ' — ' + text.slice(0, 400) +
      (res.status === 410
        ? '\nHINT: 410 means a retired API version. v1 is gone; try a different --cal-api-version.'
        : '')
    );
  }
  let body;
  try { body = JSON.parse(text); }
  catch (_) { throw new Error('Cal.com returned non-JSON: ' + text.slice(0, 200)); }

  const rows = body.data || body.bookings || [];
  if (!Array.isArray(rows)) {
    throw new Error('Unexpected Cal.com payload shape — no data array. Keys: ' + Object.keys(body).join(','));
  }

  return rows.map(b => {
    const att = (Array.isArray(b.attendees) ? b.attendees[0] : null) || {};
    return {
      uid: b.uid || b.id,
      title: b.title,
      startTime: b.start || b.startTime ? new Date(b.start || b.startTime) : null,
      endTime: b.end || b.endTime ? new Date(b.end || b.endTime) : null,
      location: b.location || '',
      notes: b.additionalNotes || b.description || '',
      status: String(b.status || '').toLowerCase(),
      organizerUsername: (b.organizer && b.organizer.username) || flag('organizer-username', 'nobigdeal'),
      organizerEmail: (b.organizer && b.organizer.email) || '',
      attendee: {
        name: att.name || '',
        email: att.email || '',
        phoneNumber: att.phoneNumber || att.phone || '',
      },
    };
  });
}

// ── rep resolution (mirrors calcom.js) ──────────────────────────────

async function resolveRep(db, organizerUsername, organizerEmail) {
  let repUid = null;
  let repCompanyId = null;

  if (organizerUsername) {
    const q = await db.collection('users')
      .where('calcomUsername', '==', organizerUsername).limit(1).get();
    if (!q.empty) {
      repUid = q.docs[0].id;
      repCompanyId = q.docs[0].data().companyId || null;
    }
  }
  if (!repUid && organizerEmail) {
    try {
      const u = await getAuth().getUserByEmail(organizerEmail);
      repUid = u.uid;
    } catch (_) { /* no matching auth user */ }
  }
  if (repUid && !repCompanyId) {
    try {
      const snap = await db.doc('users/' + repUid).get();
      repCompanyId = (snap.exists && snap.data().companyId) || repUid;
    } catch (_) { repCompanyId = repUid; }
  }
  return { repUid, repCompanyId };
}

// Same match rule as the webhook's M-1 block: email, else last-10 phone.
async function findExistingLead(db, repUid, attendee) {
  const email = String((attendee && attendee.email) || '').toLowerCase().trim();
  const phone = String((attendee && attendee.phoneNumber) || '').replace(/\D/g, '');
  if (!email && phone.length < 10) return null;

  const mine = await db.collection('leads').where('userId', '==', repUid).get();
  const hit = mine.docs.find(d => {
    const lead = d.data() || {};
    if (email && String(lead.email || '').toLowerCase().trim() === email) return true;
    if (phone.length >= 10 &&
        String(lead.phone || '').replace(/\D/g, '').endsWith(phone.slice(-10))) return true;
    return false;
  });
  return hit ? hit.id : null;
}

// ── main ────────────────────────────────────────────────────────────

async function main() {
  if (APPLY && !YES) {
    console.error('Refusing to --apply without --yes. Re-run with: --apply --yes');
    process.exit(2);
  }

  const manual = bookingFromFlags();
  const from = flag('from');
  const to = flag('to');
  if (!manual && !from && !to) {
    console.error(
      'Nothing to do. Give a window (--from=YYYY-MM-DD --to=YYYY-MM-DD, needs\n' +
      'CALCOM_API_KEY) or one booking (--booking-uid=... plus its details).\n' +
      'See the header of this file for the full flag list.'
    );
    process.exit(2);
  }

  // Against the emulator, credentials must be OMITTED entirely (real ADC
  // must never be presented to it) — the seed-emulator.js contract in
  // scripts/_admin.js. Prod keeps the default applicationDefault().
  const EMULATED = !!process.env.FIRESTORE_EMULATOR_HOST;
  initAdmin(EMULATED ? { projectId: PROJECT, credential: null } : { projectId: PROJECT });
  const db = getFirestore();

  console.log('═══════════════════════════════════════════════════════════');
  console.log('Backfill dropped Cal.com bookings → CRM');
  console.log('  project : ' + PROJECT);
  console.log('  source  : ' + (manual ? 'manual flags (1 booking)' : 'Cal.com API ' + from + ' → ' + to));
  console.log('  mode    : ' + (APPLY ? 'APPLY (writing)' : 'DRY-RUN (no changes)'));
  console.log('═══════════════════════════════════════════════════════════\n');

  const bookings = manual ? [manual] : await bookingsFromApi(from, to);
  console.log('Bookings to inspect: ' + bookings.length + '\n');

  let leadsCreated = 0, apptsCreated = 0, apptsLinked = 0;
  let alreadyOk = 0, linkedToExisting = 0, skipped = 0, failures = 0;

  for (const b of bookings) {
    if (!b.uid) { console.warn('! booking with no uid — skipped'); skipped++; continue; }
    if (b.status === 'cancelled' || b.status === 'rejected') {
      console.log('· ' + b.uid + ' — ' + b.status + ', skipped');
      skipped++;
      continue;
    }

    const { repUid, repCompanyId } = await resolveRep(db, b.organizerUsername, b.organizerEmail);
    if (!repUid) {
      console.warn(
        '! ' + b.uid + ' — no rep for organizer ' +
        JSON.stringify(b.organizerUsername || b.organizerEmail || '(none)') +
        '. Set NBD Pro → Settings → Profile → Cal.com username first, or pass' +
        ' --organizer-username. Skipped.'
      );
      skipped++;
      continue;
    }

    const leadDocId = L.bridgeDocId('calcom', b.uid);
    const leadRef = db.doc('leads/' + leadDocId);
    const apptRef = db.doc('appointments/' + b.uid);
    const [leadSnap, apptSnap] = await Promise.all([leadRef.get(), apptRef.get()]);

    // Already repaired (or the live webhook handled it) — nothing to do.
    if (leadSnap.exists && apptSnap.exists && (apptSnap.data() || {}).leadId) {
      alreadyOk++;
      continue;
    }

    // Never create a duplicate: if this attendee is already in the pipeline,
    // link to THAT lead rather than minting a second card.
    let targetLeadId = leadSnap.exists ? leadDocId : await findExistingLead(db, repUid, b.attendee);
    const willCreateLead = !leadSnap.exists && !targetLeadId;

    const { firstName, lastName } = L.splitName({ name: b.attendee && b.attendee.name });
    const phone = String((b.attendee && b.attendee.phoneNumber) || '');

    console.log('▸ ' + b.uid + '  ' + (b.startTime ? b.startTime.toISOString() : '(no start)'));
    console.log('    attendee : ' + (firstName + ' ' + lastName).trim() +
                '  <' + ((b.attendee && b.attendee.email) || '—') + '>  ' + (phone || '—'));
    console.log('    rep      : ' + repUid + '  (company ' + repCompanyId + ')');

    if (willCreateLead) {
      console.log('    lead     : CREATE leads/' + leadDocId + "  source='" + SOURCE_LABEL + "'");
    } else if (leadSnap.exists) {
      console.log('    lead     : exists (' + leadDocId + ')');
    } else {
      console.log('    lead     : attendee already in pipeline → linking to ' + targetLeadId +
                  ' (no duplicate created)');
      linkedToExisting++;
    }
    if (!apptSnap.exists) {
      console.log('    appt     : CREATE appointments/' + b.uid + '  (rep-lookup drop — never written)');
    } else if (!(apptSnap.data() || {}).leadId) {
      console.log('    appt     : exists, leadId null → PATCH leadId');
    } else {
      console.log('    appt     : exists and already linked');
    }

    if (!APPLY) { console.log(''); continue; }

    try {
      if (willCreateLead) {
        // .create() — a concurrent webhook delivery for this same booking
        // must win rather than be clobbered.
        try {
          await leadRef.create({
            userId: repUid,
            companyId: repCompanyId || repUid,
            firstName,
            lastName,
            address: String(b.location || ''),
            phone,
            phoneDigits: phoneDigits10(phone),
            email: String((b.attendee && b.attendee.email) || ''),
            stage: 'New',
            status: 'new',
            source: SOURCE_LABEL,
            notes: String(b.notes || ''),
            webLead: true,
            publicLeadKind: 'calcom_booking',
            calcomBookingId: b.uid,
            calcomEventTitle: b.title || null,
            // Provenance: this row was repaired after the fact, not written
            // by the live webhook. Useful when auditing lead-source counts.
            backfilledBy: 'backfill-calcom-dropped-leads',
            createdAt: FieldValue.serverTimestamp(),
            stageStartedAt: FieldValue.serverTimestamp(),
          });
          targetLeadId = leadDocId;
          leadsCreated++;
        } catch (e) {
          if (e && (e.code === 6 || /already exists/i.test(e.message || ''))) {
            targetLeadId = leadDocId;   // webhook beat us to it — fine
          } else { throw e; }
        }
      }

      if (!apptSnap.exists) {
        await apptRef.set({
          bookingId: b.uid,
          userId: repUid,
          repUid,
          leadId: targetLeadId || null,
          calcomUsername: b.organizerUsername || null,
          attendeeName: (b.attendee && b.attendee.name) || null,
          attendeeEmail: (b.attendee && b.attendee.email) || null,
          attendeePhone: phone || null,
          title: b.title || null,
          location: b.location || null,
          description: b.notes || null,
          startTime: b.startTime ? Timestamp.fromDate(b.startTime) : null,
          endTime: b.endTime ? Timestamp.fromDate(b.endTime) : null,
          status: 'booked',
          source: 'calcom',
          backfilledBy: 'backfill-calcom-dropped-leads',
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        apptsCreated++;
      } else if (!(apptSnap.data() || {}).leadId && targetLeadId) {
        await apptRef.set({
          leadId: targetLeadId,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        apptsLinked++;
      }
      console.log('    ✔ written\n');
    } catch (e) {
      failures++;
      console.warn('    ! FAILED — ' + (e && e.message) + '\n');
    }
  }

  console.log('───────────────────────────────────────────────────────────');
  console.log('  inspected           : ' + bookings.length);
  console.log('  already complete    : ' + alreadyOk);
  console.log('  skipped             : ' + skipped);
  console.log('  linked to existing  : ' + linkedToExisting);
  if (APPLY) {
    console.log('  leads created       : ' + leadsCreated);
    console.log('  appointments created: ' + apptsCreated);
    console.log('  appointments linked : ' + apptsLinked);
    console.log('  failures            : ' + failures);
  } else {
    console.log('  (dry-run — re-run with --apply --yes to write)');
  }
  console.log('───────────────────────────────────────────────────────────');

  process.exit(failures > 0 ? 1 : 0);
}

main().catch(e => { console.error(e && e.stack || e); process.exit(1); });
