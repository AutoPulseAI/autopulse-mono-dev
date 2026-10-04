// Builds AI-service events from platform records and sends them
// (MASTER_PLAN_1 Stage 5). Workers call notifyAiOfNewLead / notifyAiOfInbound;
// both are no-ops when the dealer's AI mode is `off` and never throw.
//
// Event payloads follow agentic-upsell/src/upsell_agent/events/models.py.
// Event id rules (MASTER_PLAN_1 Stage 0): lead-created uses the Lead _id,
// inbound-message uses the Email record _id.

import crypto from 'node:crypto';

import { aiRouting } from './aiMode.js';
import { sendAiEvent } from './aiEvents.js';
import { noteForStaff } from './aiOutbox.js';

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

// PLAN_4 stream X3 item 1: production's Lead has no `customer_id` (only the
// newer customerResolver.js links one). Without it the AI still needs one
// stable id per customer and dealer, so it keeps its own customer identity,
// facts, consent and duplicate links under a key derived from the lead's
// normalised phone (else email). The same rule is in agentic-upsell
// (agent/customer_key.py): both sides must produce the same key.
export const DERIVED_CUSTOMER_PREFIX = 'ck_';

export function normalisePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

export function normaliseEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return hasEmail(email) ? email : null;
}

export function derivedCustomerKey({ dealerId, phone, email }) {
  const p = normalisePhone(phone);
  const e = p ? null : normaliseEmail(email);
  const basis = p ? `p:${p}` : e ? `e:${e}` : null;
  if (!dealerId || !basis) return null;
  const digest = crypto.createHash('sha256').update(`${String(dealerId)}|${basis}`).digest('hex');
  return `${DERIVED_CUSTOMER_PREFIX}${digest.slice(0, 24)}`;
}

// The customer id the AI gets for a lead: the CRM's own Customer link when
// there is one, else the derived key (also stored on the Lead as
// `ai_customer_key` by the callers, so the AI can find a customer's leads).
export function customerIdForLead(lead, dealerId) {
  if (!lead) return null;
  if (lead.customer_id) return String(lead.customer_id);
  if (lead.ai_customer_key) return String(lead.ai_customer_key);
  return derivedCustomerKey({ dealerId: dealerId ?? lead.dealer_id, phone: lead.phone, email: lead.email });
}

// Best-effort: records the derived key on the Lead (production's Lead schema
// is strict:false, so the field is kept). Never throws.
export async function rememberCustomerKey(lead, dealerId, { LeadModel = null, logger = console } = {}) {
  if (!lead?._id || lead.customer_id || lead.ai_customer_key) return null;
  const key = customerIdForLead(lead, dealerId);
  if (!key) return null;
  try {
    const Model = LeadModel || (await import('../../models/Lead.js')).default;
    await Model.updateOne({ _id: lead._id }, { $set: { ai_customer_key: key } });
  } catch (error) {
    logger.warn?.('[ai] could not store ai_customer_key on the lead', { lead_id: String(lead._id), error: error?.message });
  }
  return key;
}

export function buildLeadCreatedEvent({ lead, dealerId, channel, shadow = false }) {
  const customerId = customerIdForLead(lead, dealerId);
  if (!lead?._id || !customerId || !channel) return null;
  return {
    event_id: String(lead._id),
    dealer_id: String(dealerId ?? lead.dealer_id),
    lead_id: String(lead._id),
    customer_id: customerId,
    channel,
    shadow: Boolean(shadow),
  };
}

export function buildInboundMessageEvent({ emailRecord, lead, dealerId, channel, text, shadow = false }) {
  const customerId = customerIdForLead(lead, dealerId);
  if (!emailRecord?._id || !lead?._id || !customerId || !channel) return null;
  const at = emailRecord.date || emailRecord.timestamp || new Date();
  return {
    event_id: String(emailRecord._id),
    dealer_id: String(dealerId ?? lead.dealer_id),
    customer_id: customerId,
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

// PLAN_4 stream X3 item 1: statuses after which the AI will never answer (a queued or stored event is still
// delivered later). In `live` mode n8n is off, so the lead gets a note for staff instead of silence.
export const AI_NOT_TAKEN = Object.freeze(['skipped', 'rejected', 'lost', 'error']);

async function fallbackIfLive(result, { routing, type, lead, dealerId, fallback, logger }) {
  if (routing.aiReplies && AI_NOT_TAKEN.includes(result?.status)) {
    const noted = await fallback({ type, leadId: lead?._id, dealerId: dealerId ?? lead?.dealer_id,
      reason: result.reason || result.error, logger });
    return { ...result, fallback: noted ? 'staff_note' : 'none' };
  }
  return result;
}

export async function notifyAiOfNewLead({ lead, dealerId, channel, mode, send = sendAiEvent, logger = console,
  fallback = noteForStaff, remember = rememberCustomerKey }) {
  const routing = aiRouting(mode);
  if (!routing.sendEvent) return { status: 'off' };
  let result;
  try {
    const resolvedChannel = channel || leadChannel(lead || {});
    const event = buildLeadCreatedEvent({ lead, dealerId, channel: resolvedChannel, shadow: routing.shadow });
    if (!event) {
      result = skip(!customerIdForLead(lead, dealerId) ? 'lead has no phone or email to identify the customer'
        : 'no channel to reply on', { lead_id: String(lead?._id), dealer_id: String(dealerId) }, logger);
    } else {
      await remember(lead, dealerId, { logger });
      result = await send('lead-created', event, { logger });
    }
  } catch (error) {
    logger.error?.('[ai] notifyAiOfNewLead failed', { lead_id: String(lead?._id), error: error?.message });
    result = { status: 'error', error: error?.message };
  }
  return fallbackIfLive(result, { routing, type: 'lead-created', lead, dealerId, fallback, logger });
}

export async function notifyAiOfInbound({ emailRecord, lead, dealerId, channel, text, mode, send = sendAiEvent,
  logger = console, fallback = noteForStaff, remember = rememberCustomerKey }) {
  const routing = aiRouting(mode);
  if (!routing.sendEvent) return { status: 'off' };
  let result;
  try {
    const event = buildInboundMessageEvent({ emailRecord, lead, dealerId, channel, text, shadow: routing.shadow });
    if (!event) {
      result = skip(!lead ? 'message is not linked to a lead' : 'lead has no phone or email to identify the customer',
        { email_id: String(emailRecord?._id), lead_id: String(lead?._id), dealer_id: String(dealerId) }, logger);
    } else {
      await remember(lead, dealerId, { logger });
      result = await send('inbound-message', event, { logger });
    }
  } catch (error) {
    logger.error?.('[ai] notifyAiOfInbound failed', { email_id: String(emailRecord?._id), error: error?.message });
    result = { status: 'error', error: error?.message };
  }
  return fallbackIfLive(result, { routing, type: 'inbound-message', lead, dealerId, fallback, logger });
}
