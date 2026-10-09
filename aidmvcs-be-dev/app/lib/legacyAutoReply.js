// The old n8n auto-reply (client, 8 Oct 2026 meeting: "we need to turn off N8N... we just don't want those old
// workflows"). The workers still ask n8n to read an incoming message (lead details, source, language), but its
// replies are only sent when LEGACY_N8N_AUTOREPLY=true. AI-live dealers never used it (the AI answers them);
// for the others, turning the AI off now means no automatic reply rather than the old one (which also sent raw
// HTML as texts). The appointment messages and the Settings > Follow-ups rules are not affected.
// Relative imports only: used by the BullMQ workers.

export function legacyAutoReplyOn(env = process.env) {
  return ['1', 'true', 'yes'].includes(String(env.LEGACY_N8N_AUTOREPLY || '').toLowerCase());
}

// With the old auto-reply off nothing was sent, so nothing n8n decided about the lead is true either (client, 9 Oct
// 2026: leads showed "Contacted" nobody contacted, and an appointment the customer never asked for). Everything that
// acts is dropped - the status, a booking (date / time / status, which also started reminders), a cancellation, the
// reply text. Only its readings of the message stay (language, name, contact details, vehicle, source, campaign).
export const LEGACY_ACTION_FIELDS = Object.freeze([
  'fe_lead_status', 'lead_status', 'booking_status', 'booking_date', 'booking_time',
  'appointment_cancellation_requested', 'response',
]);

export function withoutLegacyStatus(result, env = process.env) {
  if (legacyAutoReplyOn(env) || !result || typeof result !== 'object') return result;
  const clean = { ...result };
  for (const field of LEGACY_ACTION_FIELDS) delete clean[field];
  return clean;
}
