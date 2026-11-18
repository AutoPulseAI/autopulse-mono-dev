import mongoose from 'mongoose';

// A dealer's contact-eligibility policy (SOW Deliverable L, G-071 "rooftop-specific compliance policies").
//   mode 'log_only' (default): every check is recorded, nothing is blocked (the user, 18 Nov 2026: build it log-only;
//        SOW: "Dealer counsel/compliance owner must approve policy assumptions before production activation").
//   mode 'enforce': a 'block' decision stops the text / email. Only a super admin can switch it, after that approval.
// contact window: the dealer's local hours for outreach it starts (default 8:00-21:00); a reply to the customer's own
// message is not held by it. Registry (federal / state DNC) and FCC reassigned-numbers checks need a vendor: 'not_connected'.
const historySchema = new mongoose.Schema({
  at: { type: Date, default: Date.now }, by_name: { type: String, default: null }, change: { type: String },
}, { _id: false });

const contactPolicySchema = new mongoose.Schema({
  dealer_id: { type: String, required: true, unique: true },
  mode: { type: String, enum: ['log_only', 'enforce'], default: 'log_only' },
  window_start: { type: String, default: '08:00' },
  window_end: { type: String, default: '21:00' },
  registry: { type: String, enum: ['not_connected', 'connected'], default: 'not_connected' },
  reassigned_numbers: { type: String, enum: ['not_connected', 'connected'], default: 'not_connected' },
  history: { type: [historySchema], default: [] },
}, { timestamps: true });

export default mongoose.models.ContactPolicy || mongoose.model('ContactPolicy', contactPolicySchema);
