import mongoose from 'mongoose';

// A dealer's internal Do-Not-Contact list (SOW Deliverable L, G-068 / G-071: "dealership-specific internal DNC lists",
// "internal dealer and platform suppression entries"). One entry = one phone or email this dealer must not contact on
// that channel ('call_sms' covers calls and texts to a phone, 'email' an address). dealer_id 'platform' = every dealer.
// Removing an entry keeps it (removed_at / removed_by) so the history stays (SOW: retain screening audit evidence).
const contactSuppressionSchema = new mongoose.Schema({
  dealer_id: { type: String, required: true },
  kind: { type: String, enum: ['phone', 'email'], required: true },
  value: { type: String, required: true }, // phone: 10 digits; email: lower case
  channel: { type: String, enum: ['call_sms', 'email'], required: true },
  reason: { type: String, default: null },
  source: { type: String, default: 'staff' }, // 'staff' | 'import'
  added_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  added_by_name: { type: String, default: null },
  removed_at: { type: Date, default: null },
  removed_by_name: { type: String, default: null },
}, { timestamps: true });

contactSuppressionSchema.index({ dealer_id: 1, kind: 1, value: 1, removed_at: 1 });

export default mongoose.models.ContactSuppression || mongoose.model('ContactSuppression', contactSuppressionSchema);
