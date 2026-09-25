// Builds AI-service events from platform records and sends them
// (MASTER_PLAN_1 Stage 5). Workers call notifyAiOfNewLead / notifyAiOfInbound;
// both are no-ops when the dealer's AI mode is `off` and never throw.
//
// Event payloads follow agentic-upsell/src/upsell_agent/events/models.py.
// Event id rules (MASTER_PLAN_1 Stage 0): lead-created uses the Lead _id,
// inbound-message uses the Email record _id.

import { aiRouting } from './aiMode.js';
import { sendAiEvent } from './aiEvents.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hasPhone(value) {
  return String(value || '').replace(/\D/g, '').length >= 10;
}

function hasEmail(value) {
  return typeof value === 'string' && EMAIL_PATTERN.test(value.trim()) && !/^n\/?a$/i.test(value.trim());
}

// The channel to answer a new lead on: the customer's stated preference when
// we can reach them there, otherwise SMS whenever there's a phone (the ADF
// path's existing rule), otherwise email.
export function leadChannel({ phone, email, followup_preference: preference } = {}) {
  const pref = String(preference || '').toLowerCase();
  if (pref === 'sms' && hasPhone(phone)) return 'sms';
  if (pref === 'email' && hasEmail(email)) return 'email';
  if (hasPhone(phone)) return 'sms';
  if (hasEmail(email)) return 'email';
  return null;
}

export function buildLeadCreatedEvent({ lead, dealerId, channel, shadow = false }) {
  if (!lead?._id || !lead?.customer_id || !channel) return null;
  return {
    event_id: String(lead._id),
    dealer_id: String(dealerId ?? lead.dealer_id),
    lead_id: String(lead._id),
    customer_id: String(lead.customer_id),
    channel,
    shadow: Boolean(shadow),
  };
}

export function buildInboundMessageEvent({ emailRecord, lead, dealerId, channel, text, shadow = false }) {
  if (!emailRecord?._id || !lead?._id || !lead?.customer_id || !channel) return null;
  const at = emailRecord.date || emailRecord.timestamp || new Date();
  return {
    event_id: String(emailRecord._id),
    dealer_id: String(dealerId ?? lead.dealer_id),
    customer_id: String(lead.customer_id),
    lead_id: String(lead._id),
    channel,
    message_id: String(emailRecord._id),
    text: String(text ?? emailRecord.mail_content ?? ''),
    received_at: new Date(at).toISOString(),
    shadow: Boolean(shadow),
  };
}

function skip(reason, context, logger) {
  logger.warn?.(`[ai] event not sent: ${reason}`, context);
  return { status: 'skipped', reason };
}

export async function notifyAiOfNewLead({ lead, dealerId, channel, mode, send = sendAiEvent, logger = console }) {
  const routing = aiRouting(mode);
  if (!routing.sendEvent) return { status: 'off' };
  try {
    const resolvedChannel = channel || leadChannel(lead || {});
    const event = buildLeadCreatedEvent({ lead, dealerId, channel: resolvedChannel, shadow: routing.shadow });
    if (!event) {
      return skip(!lead?.customer_id ? 'lead has no linked customer' : 'no channel to reply on',
        { lead_id: String(lead?._id), dealer_id: String(dealerId) }, logger);
    }
    return await send('lead-created', event, { logger });
  } catch (error) {
    logger.error?.('[ai] notifyAiOfNewLead failed', { lead_id: String(lead?._id), error: error?.message });
    return { status: 'error', error: error?.message };
  }
}

export async function notifyAiOfInbound({ emailRecord, lead, dealerId, channel, text, mode, send = sendAiEvent, logger = console }) {
  const routing = aiRouting(mode);
  if (!routing.sendEvent) return { status: 'off' };
  try {
    const event = buildInboundMessageEvent({ emailRecord, lead, dealerId, channel, text, shadow: routing.shadow });
    if (!event) {
      return skip(!lead ? 'message is not linked to a lead' : 'lead has no linked customer',
        { email_id: String(emailRecord?._id), lead_id: String(lead?._id), dealer_id: String(dealerId) }, logger);
    }
    return await send('inbound-message', event, { logger });
  } catch (error) {
    logger.error?.('[ai] notifyAiOfInbound failed', { email_id: String(emailRecord?._id), error: error?.message });
    return { status: 'error', error: error?.message };
  }
}
