// A reassignment shows in the lead's conversation as an ordinary "Note for Internal Use Only" (the user, 24 Nov 2026:
// "add a note to the conversation that the other agent has taken over"). internal_use: true, so the AI never reads it
// (agentic-upsell history_sync.py) and the customer never sees it. Written for every lead_reassigned entry
// (app/lib/activityLog.js): single, bulk and undo. Never throws.
import Email from '@models/Email';

export function reassignmentNoteText({ from, to, actor_name: by, detail }) {
  const was = from || 'Unassigned';
  const now = to || 'Unassigned';
  const who = by ? ` by ${by}` : '';
  if (detail === 'undo') return `Reassignment undone${who}: back to ${now} (was ${was}).`;
  return `Reassigned from ${was} to ${now}${who}${detail === 'bulk' ? ' (bulk change)' : ''}.`;
}

export async function writeReassignmentNote(entry, { Model = Email, logger = console } = {}) {
  try {
    if (!entry?.lead_id || !entry?.dealer_id) return null;
    const at = entry.at ? new Date(entry.at) : new Date();
    return await Model.create({
      sender: entry.actor_name || 'Staff', recipient: 'staff', subject: 'Lead Note',
      mail_content: reassignmentNoteText(entry),
      dealer_id: String(entry.dealer_id), lead_id: entry.lead_id, status: 'sent', communication_type: 'note',
      is_note: true, internal_use: true, message_id: `note_reassigned_${entry.lead_id}_${at.getTime()}`,
      timestamp: at, date: at, ai_generated: false,
    });
  } catch (error) {
    logger.error?.('[reassignment-note] could not write', { lead_id: String(entry?.lead_id || ''), error: error?.message });
    return null;
  }
}
