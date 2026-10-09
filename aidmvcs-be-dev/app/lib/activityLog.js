// Records a staff action on the customer timeline (app/models/ActivityLog.js). Never throws: a timeline entry that
// can't be written is logged, the action itself always stands.
import ActivityLog from '@models/ActivityLog';

export async function logActivity(entry, { Model = ActivityLog, logger = console } = {}) {
  try {
    if (!entry?.dealer_id || !entry?.action || !entry?.actor_type) return null;
    return await Model.create({ at: new Date(), ...entry, dealer_id: String(entry.dealer_id) });
  } catch (error) {
    logger.error?.('[activity] could not log', { action: entry?.action, error: error?.message });
    return null;
  }
}
