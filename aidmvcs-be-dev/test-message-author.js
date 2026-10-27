// Who sent each message (Betsy, 27 Oct 2026): every message says customer / AI / staff / automatic, never the AI's
// name on a message the AI didn't write.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isStatusNote, messageAuthor, noteAuthor, staffBookedTexts } from './app/lib/messageAuthor.js';

const lead = { name: 'Gabriel Jasmin', dealer_id: '68e6f270ac63d8a8eba32096' };

test('each message names who sent it', () => {
  assert.equal(messageAuthor({ status: 'received' }, lead, 'Nicole').label, 'Customer: Gabriel Jasmin');
  assert.equal(messageAuthor({ status: 'sent', ai_generated: true }, lead, 'Nicole').label, 'Sent by AI (Nicole)');
  assert.equal(messageAuthor({ status: 'sent', message_by: { _id: 'u1', name: 'Mercy Carill' } }, lead, 'Nicole').label,
    'Sent by staff: Mercy Carill');
  assert.equal(messageAuthor({ status: 'delivered', message_by: { _id: lead.dealer_id, name: 'Victory Cars Central' } }, lead).kind,
    'staff');
  // The old system's automatic check-ins have no sender: never shown as the AI.
  const auto = messageAuthor({ status: 'undelivered', subject: 'Follow-up' }, lead, 'Nicole');
  assert.equal(auto.kind, 'system');
  assert.ok(!auto.label.includes('Nicole'));
});

test('notes say whether the AI or a staff member wrote them', () => {
  assert.equal(noteAuthor({ ai_generated: true }), 'Note by the AI');
  assert.equal(noteAuthor({ message_by: { name: 'Mercy Carill' } }), 'Note by staff: Mercy Carill');
  assert.equal(noteAuthor({ sender: 'Staff' }), 'Note by staff');
});

// Betsy, 27 Oct 2026: the staff booking and the confirmation it caused must both show in the conversation.
test('a staff booking shows as a status change and labels the AI text it caused', () => {
  const note = { _id: 'n1', is_note: true, internal_use: true, timestamp: '2026-10-26T14:23:00Z',
    mail_content: 'Status changed from No Contact Made to Appointment Set by Mercy Carill' };
  const text = { _id: 'm1', ai_generated: true, status: 'sent', timestamp: '2026-10-26T14:39:00Z',
    mail_content: 'Christine, we are all set to meet on Monday, October 26 at 3:22 PM at Victory Cars Central' };
  const later = { _id: 'm2', ai_generated: true, status: 'sent', timestamp: '2026-10-28T14:39:00Z',
    mail_content: 'Christine, we are all set to meet on Friday' };
  const aiOwn = { _id: 'm3', ai_generated: true, status: 'sent', timestamp: '2026-10-26T14:40:00Z', mail_content: 'Any questions?' };
  assert.ok(isStatusNote(note));
  assert.ok(!isStatusNote({ is_note: true, mail_content: 'Customer prefers mornings' }));
  assert.deepEqual(staffBookedTexts([text, later, aiOwn, note]), { m1: 'Mercy Carill' });
  // The AI's own booking ("Set to Appointment Booked by the AI") is not a staff booking.
  assert.deepEqual(staffBookedTexts([{ ...note, mail_content: 'Set to Appointment Booked by the AI: visit on Monday' }, text]), {});
});

// Betsy, 27 Oct 2026 meeting: each lead says how it came in - Internet, Phone-up or Walk-in.
test('lead type: staff choice first, a portal lead is Internet, a manual lead nobody typed is Not set', async () => {
  const { contactTypeLabel, validContactType } = await import('./app/lib/leadContactType.js');
  assert.equal(contactTypeLabel({ source: 'CarGurus' }), 'Internet');
  assert.equal(contactTypeLabel({ source: 'email', contact_type: 'walk_in' }), 'Walk-in');
  assert.equal(contactTypeLabel({ source: 'sms', contact_type: 'phone' }), 'Phone-up');
  assert.equal(contactTypeLabel({ source: 'email' }), 'Not set');
  assert.equal(validContactType('fax'), null);
});

// Betsy, 27 Oct 2026 meeting: "I get kicked out all the time" - a sign-in in use is renewed, never one from Login as.
test('a sign-in older than a day is renewed for seven days; login-as and remembered ones are not', async () => {
  const jwt = (await import('jsonwebtoken')).default;
  const { renewedToken, SESSION_DAYS } = await import('./app/lib/session.js');
  const now = Math.floor(Date.now() / 1000);
  const old = { userId: 'u1', type: 'dealer', iat: now - 2 * 86400, exp: now + 5 * 86400 };
  const fresh = renewedToken(old, 's', now);
  const claims = jwt.verify(fresh, 's');
  assert.equal(claims.userId, 'u1');
  assert.ok(claims.exp - now >= SESSION_DAYS * 86400 - 5);
  assert.equal(renewedToken({ ...old, exp: now + 6.9 * 86400 }, 's', now), null); // signed in today
  assert.equal(renewedToken({ ...old, impersonated_by: 'admin' }, 's', now), null);
  assert.equal(renewedToken({ ...old, rememberDevice: true }, 's', now), null);
});

// The user, 28 Oct 2026: after a booking the AI moves the status on - No Show, then back into follow-up - but never
// over a status staff chose for a later step, and never while the appointment is still ahead.
test('the AI moves a booked lead to No Show, and back to follow-up only once no booking is ahead', async () => {
  const { closedStatusConflict } = await import('./app/lib/ai/aiDnd.js');
  assert.equal(closedStatusConflict({ status: 'No Show', current: 'Appointment Booked' }), null);
  assert.equal(closedStatusConflict({ status: 'No Show', current: 'Visited' }), 'staff_status_kept');
  assert.equal(closedStatusConflict({ status: 'Contacted - No Next Action', current: 'No Show', bookingAhead: false }), null);
  assert.equal(closedStatusConflict({ status: 'Contacted - No Next Action', current: 'Appointment Booked',
    bookingAhead: true }), 'appointment_still_ahead');
  assert.equal(closedStatusConflict({ status: 'Contacted - No Next Action', current: 'Appointment Booked',
    bookingAhead: false }), null);
  assert.equal(closedStatusConflict({ status: 'Contacted - No Next Action', current: 'Sold' }), 'staff_status_kept');
});
