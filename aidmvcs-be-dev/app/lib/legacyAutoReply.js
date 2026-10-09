// The old n8n auto-reply (client, 8 Oct 2026 meeting: "we need to turn off N8N... we just don't want those old
// workflows"). The workers still ask n8n to read an incoming message (lead details, source, language), but its
// replies are only sent when LEGACY_N8N_AUTOREPLY=true. AI-live dealers never used it (the AI answers them);
// for the others, turning the AI off now means no automatic reply rather than the old one (which also sent raw
// HTML as texts). The appointment messages and the Settings > Follow-ups rules are not affected.
// Relative imports only: used by the BullMQ workers.

export function legacyAutoReplyOn(env = process.env) {
  return ['1', 'true', 'yes'].includes(String(env.LEGACY_N8N_AUTOREPLY || '').toLowerCase());
}

// With the old auto-reply off nothing was sent, so n8n's status for the lead ("Contacted", "Visit Requested", ...)
// isn't true either (client, 9 Oct 2026: leads showed "Contacted" that nobody contacted). Its other readings
// (language, vehicle, ...) are kept.
export function withoutLegacyStatus(result, env = process.env) {
  if (legacyAutoReplyOn(env) || !result || typeof result !== 'object') return result;
  return { ...result, fe_lead_status: undefined, lead_status: undefined };
}
