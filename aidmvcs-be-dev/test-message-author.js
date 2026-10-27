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
