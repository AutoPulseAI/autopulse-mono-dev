// Staff take over a lead from the AI, or hand it back (MASTER_PLAN_1
// Stage 11, BPLAN Phase 4).
//
// When staff act on a lead the AI is working (a manual reply, moving it to a
// closing status, the admin "take over" button) the platform sends
// `lead-paused`: the AI service stops replying to that lead and cancels its
// pending channel switch. `lead-resumed` (admin "hand back") lets it reply
// again. Both are no-ops for dealers in `off` mode and never throw.
//
// Event ids must be unique per action (the AI service drops a repeated id)
// and contain no ':' (BullMQ retry job ids, aiEvents.retryJobId).
//
// Imports are relative so the BullMQ workers can use this module too.

import { aiRouting, getDealerAiMode } from './aiMode.js';
import { sendAiEvent } from './aiEvents.js';

// Moving a lead to one of these means staff own the conversation now. Same
// set the platform's own follow-up route already treats as "stop"
// (app/api/conversations/followup/route.js), plus the end states.
export const STAFF_OWNED_STATUSES = Object.freeze([
  'Appointment Booked', 'Visited', 'Sold', 'DND', 'Managerial Review',
  // The manager outcomes after a visit (MASTER_PLAN_3 C5; Omnichannel PDF: "Sales Visit -> manager
  // outcome required").
  'Sold Pending', 'Sold Delivered', 'Unsold',
  // MASTER_PLAN_4 D2 (SOLD PENDING PDF §2, §9): staff close a pending deal (or any lead) as lost.
  'Closed Lost',
  // Staff marked a missed appointment: the AI runs the client's no-show messages (MASTER_PLAN_3 C5).
  'No Show',
]);

// The outcome a manager must pick when a lead is set to "Visited" (MASTER_PLAN_3 C5).
export const MANAGER_OUTCOMES = Object.freeze(['Sold Pending', 'Sold Delivered', 'Unsold']);

// "Visited" needs an outcome; the outcomes can also be set later on their own.
export function validateManagerOutcome(status, managerOutcome) {
  if (managerOutcome && !MANAGER_OUTCOMES.includes(managerOutcome)) {
    return `Unknown manager outcome "${managerOutcome}" (expected ${MANAGER_OUTCOMES.join(', ')})`;
  }
  if (managerOutcome && status !== 'Visited') return 'A manager outcome is only given with "Visited"';
  if (status === 'Visited' && !managerOutcome) {
    return `Pick the visit's outcome: ${MANAGER_OUTCOMES.join(', ')}`;
  }
  return null;
}

const safeId = (value) => String(value ?? '').replace(/[^A-Za-z0-9_-]/g, '');

export function buildLeadPausedEvent({ leadId, dealerId, eventId, reason }) {
  if (!leadId || !dealerId || !eventId) return null;
  return {
    event_id: safeId(eventId),
    dealer_id: String(dealerId),
    lead_id: String(leadId),
    reason: reason ? String(reason).slice(0, 300) : null,
  };
}

export function buildLeadResumedEvent({ leadId, dealerId, eventId }) {
  if (!leadId || !dealerId || !eventId) return null;
  return { event_id: safeId(eventId), dealer_id: String(dealerId), lead_id: String(leadId) };
}

async function sendIfAiActive(type, event, { dealerId, mode, send, logger }) {
  const resolvedMode = mode ?? await getDealerAiMode(dealerId);
  if (!aiRouting(resolvedMode).sendEvent) return { status: 'off' };
  if (!event) return { status: 'skipped', reason: 'missing lead or dealer' };
  try {
    return await send(type, event, { logger });
  } catch (error) {
    logger.error?.(`[ai] ${type} failed`, { lead_id: event.lead_id, error: error?.message });
    return { status: 'error', error: error?.message };
  }
}

// A staff member replied to the customer by hand (conversations/reply).
export async function notifyAiOfStaffReply({
  leadId, dealerId, emailRecordId, staffName, mode, send = sendAiEvent, logger = console,
}) {
  const event = buildLeadPausedEvent({
    leadId, dealerId,
    eventId: `staff-reply-${emailRecordId ?? Date.now()}`,
    reason: `Staff replied by hand${staffName ? ` (${staffName})` : ''}`,
  });
  return sendIfAiActive('lead-paused', event, { dealerId, mode, send, logger });
}

// Staff moved the lead to a status where they own it (booked, sold, DND, ...).
// "Visited" carries the manager's outcome in the same event, so the AI applies
// the visit and its outcome in order (agentic-upsell lifecycle.manager_outcome_from_reason).
export async function notifyAiOfStaffStatus({
  leadId, dealerId, status, managerOutcome, mode, send = sendAiEvent, logger = console, now = Date.now,
}) {
  if (!STAFF_OWNED_STATUSES.includes(status)) return { status: 'not_needed' };
  const outcome = status === 'Visited' && MANAGER_OUTCOMES.includes(managerOutcome) ? managerOutcome : null;
  const event = buildLeadPausedEvent({
    leadId, dealerId,
    eventId: `status-${leadId}-${safeId(status)}${outcome ? `-${safeId(outcome)}` : ''}-${now()}`,
    reason: `Staff moved the lead to "${status}"${outcome ? ` (manager outcome: "${outcome}")` : ''}`,
  });
  return sendIfAiActive('lead-paused', event, { dealerId, mode, send, logger });
}

// Admin "take over" / "hand back to AI" (app/api/admin/ai/leads/[id]/...).
export async function pauseAiForLead({
  leadId, dealerId, reason, by, mode, send = sendAiEvent, logger = console, now = Date.now,
}) {
  const event = buildLeadPausedEvent({
    leadId, dealerId, eventId: `admin-pause-${leadId}-${now()}`,
    reason: reason || `Taken over by staff${by ? ` (${by})` : ''}`,
  });
  return sendIfAiActive('lead-paused', event, { dealerId, mode, send, logger });
}

export async function resumeAiForLead({
  leadId, dealerId, mode, send = sendAiEvent, logger = console, now = Date.now,
}) {
  const event = buildLeadResumedEvent({ leadId, dealerId, eventId: `admin-resume-${leadId}-${now()}` });
  return sendIfAiActive('lead-resumed', event, { dealerId, mode, send, logger });
}
