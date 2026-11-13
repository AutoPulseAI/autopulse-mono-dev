// models/Email.js
import mongoose from 'mongoose';

const emailSchema = new mongoose.Schema({
  sender: { type: String, required: true },
  recipient: { type: String },
  subject: { type: String},
  message_id: { type: String},
  parent_conversation: { type: String },
  date: { type: Date },
 
  body: { type: mongoose.Schema.Types.Mixed }, 

  mail_content: { type: String },
  dealer_id:{ type: String,required:true },
  headers: { type: mongoose.Schema.Types.Mixed }, 
 
  timestamp: { type: Date, default: Date.now },
  
  // Appointment notification fields
  is_appointment_notification: { type: Boolean, default: false },
  appointment_notification_type: { 
    type: String, 
    enum: ['booking', 'update', 'no-show'], 
    default: null 
  },
  
  // Additional fields for conversation threading
  parent_message_id: { type: String },
  communication_type: { 
    type: String, 
    enum: ['email', 'sms','note'], 
    default: 'email' 
  },
  message_by: { 
    type: mongoose.Schema.Types.ObjectId, ref: 'User' 
  },
  status: { 
    type: String, 
    enum: ['sent', 'received', 'failed', 'pending', 'incoming', 'draft'], 
    default: 'sent' 
  },
  lead_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
  is_note: { type: Boolean, default: false },
  // The portal's / ADF lead notification itself (client, 12 Oct 2026): shown as the lead card, never as the customer
  // writing to us, and never counted as contact (app/lib/contactedLeads.js).
  is_lead_email: { type: Boolean, default: false },
  
  // Read/Unread tracking
  read: { type: Boolean, default: false },
  read_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  read_at: { type: Date },

  // Written by the AI service through POST /api/internal/ai/messages
  // (app/lib/ai/aiMessageRecord.js). ai_fallback marks the 24h re-send on
  // the other channel; ai_idempotency_key makes recording a send idempotent.
  ai_generated: { type: Boolean, default: false },
  ai_fallback: { type: Boolean, default: false },
  ai_turn_id: { type: String },
  ai_idempotency_key: { type: String },
  ai_delivery_status: { type: String }

},
{ strict: false });

export const EMAIL_CONVERSATION_INDEX = {
  key: { lead_id: 1, timestamp: -1, _id: -1 },
  options: { name: 'lead_conversation_cursor' }
};

export const EMAIL_SMS_PAIR_INDEX = {
  key: { dealer_id: 1, communication_type: 1, sender: 1, recipient: 1, timestamp: -1, _id: -1 },
  options: {
    name: 'dealer_sms_pair_latest',
    partialFilterExpression: { communication_type: 'sms' },
  },
};

// One Email per AI send. Partial so every non-AI record (no key) is unaffected.
// Uses $exists:true, NOT $type:'string': a bare findOne({ai_idempotency_key:X}) equality lookup does
// NOT use a $type partial index (→ 767k-doc COLLSCAN, ~1.2s on the clone), but DOES use an $exists:true
// partial index (→ 1 doc, ~0ms). Verified on the clone 2026-11-13; explicitNulls=0, so unique stays safe.
// MIGRATION: changing partialFilterExpression on the existing index needs drop+recreate (same name, new
// options) — dropIndex('ai_idempotency_key_unique') then run scripts/ensure-email-indexes.js --apply.
export const EMAIL_AI_IDEMPOTENCY_INDEX = {
  key: { ai_idempotency_key: 1 },
  options: {
    name: 'ai_idempotency_key_unique',
    unique: true,
    partialFilterExpression: { ai_idempotency_key: { $exists: true } },
  },
};

// Twilio delivery webhook (api/webhooks/twilio) + SMS threading (worker/processSms) look up by message_id.
// Without it the query falls back to communication_type_1 and scans ~575k docs (~2.6s on the clone); with it: 1 doc, ~1ms.
// Non-unique: some message_ids are generated/reused (leadworker `lead-<id>` / `msg-<ts>`). DB-scaling indexing pass, 2026-11-13.
export const EMAIL_MESSAGE_ID_INDEX = {
  key: { message_id: 1 },
  options: { name: 'message_id_1' },
};

// Dashboard metrics aggregate emails by { dealer_id, createdAt:{range} }. Indexes were on `date`, not
// `createdAt`, so it scanned all the dealer's emails (~300k, ~3.1s). With this: seeks the range, ~2ms.
// DB-scaling indexing pass, 2026-11-13.
export const EMAIL_DEALER_CREATEDAT_INDEX = {
  key: { dealer_id: 1, createdAt: -1 },
  options: { name: 'dealer_id_1_createdAt_-1' },
};

emailSchema.index(EMAIL_CONVERSATION_INDEX.key, EMAIL_CONVERSATION_INDEX.options);
// Deploy explicitly with scripts/ensure-email-indexes.js, like EMAIL_SMS_PAIR_INDEX.
emailSchema.index(EMAIL_AI_IDEMPOTENCY_INDEX.key, { ...EMAIL_AI_IDEMPOTENCY_INDEX.options, _autoIndex: false });
// Deploy explicitly with scripts/ensure-email-indexes.js before releasing the
// synchronous webhook query that depends on it.
emailSchema.index(EMAIL_SMS_PAIR_INDEX.key, { ...EMAIL_SMS_PAIR_INDEX.options, _autoIndex: false });
// Deploy explicitly with scripts/ensure-email-indexes.js.
emailSchema.index(EMAIL_MESSAGE_ID_INDEX.key, { ...EMAIL_MESSAGE_ID_INDEX.options, _autoIndex: false });
emailSchema.index(EMAIL_DEALER_CREATEDAT_INDEX.key, { ...EMAIL_DEALER_CREATEDAT_INDEX.options, _autoIndex: false });

const Email = mongoose.models.Email || mongoose.model('Email', emailSchema);

export default Email;
