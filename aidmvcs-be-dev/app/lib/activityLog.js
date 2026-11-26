// Records a staff action on the customer timeline (app/models/ActivityLog.js). Never throws: a timeline entry that
// can't be written is logged, the action itself always stands.
import ActivityLog from '@models/ActivityLog';

export async function logActivity(entry, { Model = ActivityLog, logger = console } = {}) {
  try {
    if (!entry?.dealer_id || !entry?.action || !entry?.actor_type) return null;
    const saved = await Model.create({ at: new Date(), ...entry, dealer_id: String(entry.dealer_id) });
    // A reassignment also goes into the lead's conversation as an internal note (app/lib/reassignmentNote.js).
    if (entry.action === 'lead_reassigned' && entry.lead_id && Model === ActivityLog) {
      const { writeReassignmentNote } = await import('./reassignmentNote.js');
      await writeReassignmentNote({ ...entry, at: saved?.at });
    }
    return saved;
  } catch (error) {
    logger.error?.('[activity] could not log', { action: entry?.action, error: error?.message });
    return null;
  }
}
