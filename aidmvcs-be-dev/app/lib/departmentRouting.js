// How a lead gets its department, everywhere in the app (the user, 17 Nov 2026: "the AI judgement plus all of the
// department assignment ... are responsible for a lead to become a specific tag"; "it can switch a lead to service
// automatically, and add a note that this lead has been moved to service"). The lead's department is the one source
// of truth; messages, the Dashboard, reports and the Desk Log follow it.
//   1. A new lead: from its source / sub-source (the same words the AI reads a service lead by: service, repair,
//      maintenance, oil, recall; "parts" -> Parts). Anything else is Sales. (Lead model, pre-save.)
//   2. The AI's judgement: the AI passes a service request to the team (note kind 'service_request') -> Service.
//   3. A service appointment booked on the lead -> Service.
//   4. A check-in at the Service desk, when staff tick "move this lead to Service".
//   5. Staff change it on the lead card (api/leads/[id]/details) - always wins, and is never undone by 2-4 afterwards.
// A move writes a note on the lead's conversation ("Moved to Service: ..."), a timeline entry, and emails the new
// department's staff. A sold lead stays where it was sold (its sale is counted for that department); a lead staff
// placed by hand is left alone. Imports are relative so the workers can use it.
import mongoose from 'mongoose';
import Lead from '../models/Lead.js';
import Email from '../models/Email.js';
import ActivityLog from '../models/ActivityLog.js';
import { DEPARTMENT_NAMES, leadDepartment, validDepartment } from './departmentNames.js';

const SERVICE_WORDS = /\b(service|repair|maintenance|oil change|oil|recall)\b/i;
const PARTS_WORDS = /\bparts?\b/i;
const SOLD = /sold/i;

/** The department a lead's source says, or null (= Sales by default). */
export function departmentFromSource(lead = {}) {
  const text = [lead.source, lead.lead_source, lead.sub_source].filter(Boolean).join(' ');
  if (!text) return null;
  if (PARTS_WORDS.test(text)) return 'parts';
  if (SERVICE_WORDS.test(text)) return 'service';
  return null;
}

/**
 * Move a lead to a department automatically. Returns { moved, reason? }. Never throws.
 * @param {{ leadId, to, why, by?: 'ai'|'system', byName?: string, notify?: boolean }} args
 */
export async function moveLeadToDepartment({ leadId, to, why, by = 'system', byName = null, notify = true }, {
  LeadModel = Lead, EmailModel = Email, Log = ActivityLog, logger = console, now = () => new Date(),
} = {}) {
  try {
    const dept = validDepartment(to);
    if (!dept || !leadId || !mongoose.isValidObjectId(String(leadId))) return { moved: false, reason: 'bad request' };
    const lead = await LeadModel.findById(leadId).select('department department_set_by dealer_id customer_id fe_lead_status name phone email').lean();
    if (!lead) return { moved: false, reason: 'lead not found' };
    const from = leadDepartment(lead);
    if (from === dept) return { moved: false, reason: 'already there' };
    if (lead.department_set_by === 'staff') return { moved: false, reason: 'staff placed this lead' };
    if (SOLD.test(String(lead.fe_lead_status || ''))) return { moved: false, reason: 'sold lead stays where it was sold' };
    const at = now();
    // Only if nobody changed it meanwhile.
    const res = await LeadModel.updateOne({ _id: lead._id, department: lead.department ?? null },
      { $set: { department: dept, department_set_by: by, department_at: at, updatedAt: at } });
    if (!res.modifiedCount) return { moved: false, reason: 'changed meanwhile' };
    const who = by === 'ai' ? 'AutoPulse AI' : byName || 'AutoPulse';
    await EmailModel.create({
      sender: who, recipient: 'staff', subject: 'Lead Note',
      mail_content: `Moved to ${DEPARTMENT_NAMES[dept]} (was ${DEPARTMENT_NAMES[from]}): ${why}`,
      dealer_id: String(lead.dealer_id), lead_id: lead._id, status: 'sent', communication_type: 'note', is_note: true,
      internal_use: true, message_id: `note_department_${lead._id}_${at.getTime()}`, timestamp: at, date: at,
      ai_generated: by === 'ai', department: dept,
    }).catch((e) => logger.error('[departments] note failed', { error: e?.message }));
    await Log.create({ dealer_id: String(lead.dealer_id), lead_id: lead._id, customer_id: lead.customer_id || null,
      actor_type: by === 'ai' ? 'ai' : 'system', actor_name: who, action: 'lead_edited', from: DEPARTMENT_NAMES[from],
      to: DEPARTMENT_NAMES[dept], detail: 'department', at }).catch(() => null);
    if (notify) {
      const { notifyDepartment } = await import('./departments.js');
      await notifyDepartment({ dealerId: lead.dealer_id, lead: { ...lead, department: dept }, department: dept,
        fromDepartment: from, byName: `${who} (${why})` });
    }
    return { moved: true, from, to: dept };
  } catch (error) {
    logger.error('[departments] move failed', { lead_id: String(leadId), error: error?.message });
    return { moved: false, reason: error?.message };
  }
}
