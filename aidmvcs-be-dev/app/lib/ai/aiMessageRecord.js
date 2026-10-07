// Turns a message the AI service sent into a platform Email record, so it
// shows in the dealer's existing conversation screen (BPLAN Phase 3).
//
// Pure functions (no DB) so they're unit-tested directly; the route
// app/api/internal/ai/messages/route.js does the lookups and the write.
//
// Threading rules this must respect:
// - The conversation view lists every Email with the lead's lead_id, sorted
//   by `timestamp` (app/api/conversations/lead/route.js).
// - A customer's SMS reply is linked to its lead by the exact
//   (sender, recipient) phone pair on earlier SMS records
//   (app/api/system/sms/route.js), so an AI SMS must be stored with the
//   dealer's own SMS number as `sender`, exactly as the platform's own
//   outbound SMS records are.
// - An email reply is linked through In-Reply-To -> Email.message_id, so the
//   provider's message id is stored as `message_id`.

import mongoose from 'mongoose';

export const AI_MESSAGE_CHANNELS = Object.freeze(['sms', 'email']);
export const AI_MESSAGE_STATUSES = Object.freeze(['sent', 'failed']);
// Twilio / SendGrid delivery words -> the Email model's status enum
// ('sent', 'received', 'failed', 'pending', 'incoming', 'draft').
export const DELIVERY_STATUS_TO_EMAIL_STATUS = Object.freeze({
  queued: 'sent',
  accepted: 'sent',
  sent: 'sent',
  delivered: 'sent',
  opened: 'sent',
  failed: 'failed',
  undelivered: 'failed',
  bounced: 'failed',
  dropped: 'failed',
});

const isObjectId = (value) => typeof value === 'string' && mongoose.isValidObjectId(value) && /^[a-f\d]{24}$/i.test(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;

export function validateAiMessagePayload(body) {
  const errors = [];
  if (!body || typeof body !== 'object') return { errors: ['body must be a JSON object'] };
  if (!isObjectId(body.dealer_id)) errors.push('dealer_id must be an ObjectId string');
  if (!isObjectId(body.lead_id)) errors.push('lead_id must be an ObjectId string');
  if (!AI_MESSAGE_CHANNELS.includes(body.channel)) errors.push('channel must be "sms" or "email"');
  if (!isText(body.to)) errors.push('to is required');
  if (!isText(body.text)) errors.push('text is required');
  if (!isText(body.idempotency_key)) errors.push('idempotency_key is required');
  if (!AI_MESSAGE_STATUSES.includes(body.status)) errors.push('status must be "sent" or "failed"');
  if (body.subject != null && typeof body.subject !== 'string') errors.push('subject must be a string');
  if (body.provider_id != null && typeof body.provider_id !== 'string') errors.push('provider_id must be a string');
  if (body.is_fallback != null && typeof body.is_fallback !== 'boolean') errors.push('is_fallback must be a boolean');
  if (body.sent_at != null && Number.isNaN(new Date(body.sent_at).getTime())) errors.push('sent_at must be a date');
  errors.push(...mediaUrlErrors(body.media_urls));
  return { errors };
}

// At most 10 http(s) URLs: Twilio's MMS limit (app/lib/sms.js).
export const MAX_MEDIA_URLS = 10;
function mediaUrlErrors(mediaUrls) {
  if (mediaUrls == null) return [];
  if (!Array.isArray(mediaUrls)) return ['media_urls must be an array of URLs'];
  if (mediaUrls.length > MAX_MEDIA_URLS) return [`media_urls takes at most ${MAX_MEDIA_URLS} URLs`];
  return mediaUrls.every((url) => typeof url === 'string' && /^https?:\/\/\S+$/i.test(url))
    ? [] : ['media_urls must be http(s) URLs'];
}

// POST /api/internal/ai/messages/send: the AI service asks the platform to
// send (CHANNEL_DRIVER=platform). Same fields as a record, minus the outcome
// (status / provider_id / sent_at), which the platform itself produces.
export function validateAiSendPayload(body) {
  if (!body || typeof body !== 'object') return { errors: ['body must be a JSON object'] };
  return validateAiMessagePayload({ ...body, status: 'sent', provider_id: null, sent_at: null });
}

// Email text -> the HTML the platform's sendEmail wraps in the dealer's
// branded template; each media URL becomes an inline image under the text.
export function aiEmailHtml(text, mediaUrls = []) {
  const escape = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const paragraphs = String(text || '').split(/\n{2,}/).map((p) => `<p>${escape(p).replace(/\n/g, '<br/>')}</p>`);
  const images = (mediaUrls || []).map(
    (url) => `<p><img src="${escape(url)}" alt="Vehicle photo" style="max-width:100%;height:auto"/></p>`);
  return [...paragraphs, ...images].join('\n');
}

// The shape the conversation screen renders (viewConversations.js reads
// publicUrl/url, contentType, fileName), like an inbound MMS's attachments.
export function mediaAttachments(mediaUrls = []) {
  return (mediaUrls || []).map((url) => {
    const fileName = String(url).split('?')[0].split('/').pop() || 'image';
    const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
    const contentType = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
      webp: 'image/webp' }[ext] || 'image/jpeg';
    return { url, publicUrl: url, contentType, fileName };
  });
}

export function validateStatusPayload(body) {
  const errors = [];
  if (!body || typeof body !== 'object') return { errors: ['body must be a JSON object'] };
  if (!isObjectId(body.dealer_id)) errors.push('dealer_id must be an ObjectId string');
  if (!isText(body.provider_id)) errors.push('provider_id is required');
  if (!Object.hasOwn(DELIVERY_STATUS_TO_EMAIL_STATUS, body.status)) {
    errors.push(`status must be one of ${Object.keys(DELIVERY_STATUS_TO_EMAIL_STATUS).join(', ')}`);
  }
  return { errors };
}

export function aiMessageSender({ channel, dealer, emailAccount }) {
  const sender = channel === 'sms'
    ? dealer?.dealer_account_information?.sms_conversion_phone
    : emailAccount?.email_address;
  // Email.sender is required; a dealer without an SMS number / mailbox
  // can't really have sent this, but the record must still be visible.
  return sender || 'AutoPulse AI';
}

export function buildAiEmailDocument({ payload, dealer, emailAccount }) {
  const sentAt = payload.sent_at ? new Date(payload.sent_at) : new Date();
  const sms = payload.channel === 'sms';
  return {
    message_id: payload.provider_id || `ai-${payload.idempotency_key}`,
    sender: aiMessageSender({ channel: payload.channel, dealer, emailAccount }),
    recipient: payload.to,
    subject: sms ? 'SMS Conversation' : (payload.subject || 'Thank you for your inquiry'),
    mail_content: payload.text,
    communication_type: payload.channel,
    status: payload.status === 'sent' ? 'sent' : 'failed',
    dealer_id: String(dealer._id),
    lead_id: new mongoose.Types.ObjectId(payload.lead_id),
    date: sentAt,
    timestamp: sentAt,
    user_language: 'english',
    ai_generated: true,
    ai_fallback: Boolean(payload.is_fallback),
    ai_turn_id: payload.turn_id || null,
    ai_idempotency_key: payload.idempotency_key,
    ai_customer_id: payload.customer_id || null,
    ai_delivery_status: payload.status,
    ...(payload.media_urls?.length
      ? { has_attachments: true, attachments: mediaAttachments(payload.media_urls), ai_media_urls: payload.media_urls }
      : {}),
    // Sent by the platform itself on the AI's behalf (CHANNEL_DRIVER=platform).
    ...(payload.sent_via_platform ? { ai_sent_via_platform: true } : {}),
  };
}
