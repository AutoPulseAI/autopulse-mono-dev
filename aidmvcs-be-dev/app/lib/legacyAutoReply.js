// The old n8n auto-reply (client, 8 Oct 2026 meeting: "we need to turn off N8N... we just don't want those old
// workflows"). The workers still ask n8n to read an incoming message (lead details, source, language), but its
// replies are only sent when LEGACY_N8N_AUTOREPLY=true. AI-live dealers never used it (the AI answers them);
// for the others, turning the AI off now means no automatic reply rather than the old one (which also sent raw
// HTML as texts). The appointment messages and the Settings > Follow-ups rules are not affected.
// Relative imports only: used by the BullMQ workers.

export function legacyAutoReplyOn(env = process.env) {
  return ['1', 'true', 'yes'].includes(String(env.LEGACY_N8N_AUTOREPLY || '').toLowerCase());
}
