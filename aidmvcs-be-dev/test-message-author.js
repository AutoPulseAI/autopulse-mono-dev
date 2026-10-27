// Who sent each message (Betsy, 27 Oct 2026): every message says customer / AI / staff / automatic, never the AI's
// name on a message the AI didn't write.
import test from 'node:test';
import assert from 'node:assert/strict';
import { messageAuthor, noteAuthor } from './app/lib/messageAuthor.js';

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
