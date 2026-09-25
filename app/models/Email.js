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

// One Email per AI send. Partial, so every non-AI record (no key) is unaffected.
export const EMAIL_AI_IDEMPOTENCY_INDEX = {
  key: { ai_idempotency_key: 1 },
  options: {
    name: 'ai_idempotency_key_unique',
    unique: true,
    partialFilterExpression: { ai_idempotency_key: { $type: 'string' } },
  },
};

emailSchema.index(EMAIL_CONVERSATION_INDEX.key, EMAIL_CONVERSATION_INDEX.options);
// Deploy explicitly with scripts/ensure-email-indexes.js, like EMAIL_SMS_PAIR_INDEX.
emailSchema.index(EMAIL_AI_IDEMPOTENCY_INDEX.key, { ...EMAIL_AI_IDEMPOTENCY_INDEX.options, _autoIndex: false });
// Deploy explicitly with scripts/ensure-email-indexes.js before releasing the
// synchronous webhook query that depends on it.
emailSchema.index(EMAIL_SMS_PAIR_INDEX.key, { ...EMAIL_SMS_PAIR_INDEX.options, _autoIndex: false });

const Email = mongoose.models.Email || mongoose.model('Email', emailSchema);

export default Email;
