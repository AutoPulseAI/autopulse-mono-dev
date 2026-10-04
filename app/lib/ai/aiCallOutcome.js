// What staff record after a call on the Call Tasks page, shaped for the AI service
// (POST /v1/call-tasks/<id>/complete; agentic-upsell agent/call_outcomes.py, PLAN_4 stream H).
// The lead outcome reaches the AI: a specific follow-up becomes its dated next step (Omnichannel PDF §6),
// "spoke, no next step" keeps its cadence going, a wrong number marks the phone invalid, and an opt-out
// writes its consent (every channel, or calls only). An appointment is booked by the page through the
// CRM's own status route, so the AI only records it.

export const CALL_OUTCOMES = ['connected', 'no_answer', 'voicemail', 'wrong_number', 'other'];
export const LEAD_OUTCOMES = ['appointment', 'specific_followup', 'contact_no_action', 'no_contact', 'wrong_number',
  'opted_out'];
const FOLLOW_CHANNELS = ['sms', 'email', 'voice'];

// The follow-up in the AI's shape, or { error }.
export function followUpFor(raw) {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(String(raw.date || ''))) return { error: 'Pick the follow-up date.' };
  if (raw.time && !/^\d{2}:\d{2}$/.test(String(raw.time))) return { error: 'The follow-up time must be HH:MM.' };
  return {
    value: {
      date: raw.date,
      time: raw.time || null,
      channel: FOLLOW_CHANNELS.includes(raw.channel) ? raw.channel : 'sms',
      owner: raw.owner === 'human' ? 'human' : 'ai',
      notes: raw.notes ? String(raw.notes).slice(0, 500) : null,
    },
  };
}

// The AI service body for a finished call task, or { error, status }.
export function callTaskResolution(body, { dealerId, by }) {
  const { action, outcome, note, lead_outcome: leadOutcome, opt_out_scope: scope } = body || {};
  if (!['complete', 'dismiss'].includes(action)) return { error: 'action must be complete or dismiss', status: 400 };
  if (action === 'complete' && !CALL_OUTCOMES.includes(outcome)) return { error: 'Pick how the call went.', status: 422 };
  const out = {
    dealer_id: dealerId,
    outcome: action === 'complete' ? outcome : null,
    note: note ? String(note).slice(0, 2000) : null,
    by,
  };
  if (action !== 'complete' || !leadOutcome) return { action, body: out };
  if (!LEAD_OUTCOMES.includes(leadOutcome)) return { error: 'Unknown lead outcome', status: 422 };
  let followUp = null;
  if (leadOutcome === 'specific_followup') {
    const built = followUpFor(body.follow_up);
    if (built.error) return { error: built.error, status: 422 };
    followUp = built.value;
  }
  return {
    action,
    body: { ...out, lead_outcome: leadOutcome, follow_up: followUp, opt_out_scope: scope === 'voice' ? 'voice' : 'all' },
  };
}
