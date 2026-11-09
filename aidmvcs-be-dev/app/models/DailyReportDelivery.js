// One row per (dealer, report day, recipient, send request) of the daily performance email - the delivery log.
// The row is claimed before the send, so a retried job can never send the same day to the same address twice:
//   resend_of = null       the scheduled send (at most one per dealer + day + recipient, by the unique index)
//   resend_of = "<id>"     an admin resend; <id> is that resend request's id, so each request is its own audited row
//                          set (requested_by = the admin) and a retry of the same request still sends once.
// Status: queued -> sending -> sent | failed (failed rows are retried by the job); bounced is set from SES events.
// A row left in "sending" (process died mid-send) is never retried automatically - "never twice" wins over "always
// delivered"; an admin can resend.
import mongoose from 'mongoose';

export const DELIVERY_STATUSES = Object.freeze(['queued', 'sending', 'sent', 'failed', 'bounced']);

const DailyReportDeliverySchema = new mongoose.Schema({
  snapshot_id: { type: mongoose.Schema.Types.ObjectId, ref: 'DailyReportSnapshot', required: true },
  dealer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  report_date: { type: String, required: true },
  recipient: { type: String, required: true, lowercase: true, trim: true },
  mode: { type: String, enum: ['internal', 'live'], required: true },
  status: { type: String, enum: DELIVERY_STATUSES, default: 'queued' },
  provider_message_id: { type: String, default: null },
  attempts: { type: Number, default: 0 },
  last_error: { type: String, default: null },
  sent_at: { type: Date, default: null },
  resend_of: { type: String, default: null },
  original_delivery_id: { type: mongoose.Schema.Types.ObjectId, default: null }, // resend: the scheduled row, if any
  requested_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  subject: { type: String, default: null },
}, { timestamps: true });

DailyReportDeliverySchema.index({ dealer_id: 1, report_date: 1, recipient: 1, resend_of: 1 }, { unique: true });
DailyReportDeliverySchema.index({ dealer_id: 1, createdAt: -1 });
DailyReportDeliverySchema.index({ provider_message_id: 1 }, { sparse: true });

export default mongoose.models.DailyReportDelivery
  || mongoose.model('DailyReportDelivery', DailyReportDeliverySchema, 'daily_report_deliveries');
