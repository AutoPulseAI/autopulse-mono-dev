import mongoose from 'mongoose';

// The dealer's own list of lead sources (gap G-009: "manage source/campaign labels"): what staff pick as the Lead
// Source on a lead they enter by hand (phone-up, walk-in), e.g. "Referral", "Radio", "Drive-by". Internet leads keep
// the source their provider sends. One document per dealer; every change is kept in `history` (who, when, what).
const historySchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  by_name: { type: String, default: null },
  action: { type: String, enum: ['add', 'rename', 'remove'], required: true },
  from: { type: String, default: null },
  to: { type: String, default: null },
  leads_renamed: { type: Number, default: 0 },
}, { _id: false });

const leadSourceListSchema = new mongoose.Schema({
  dealer_id: { type: String, required: true, unique: true },
  sources: { type: [String], default: [] },
  history: { type: [historySchema], default: [] },
}, { timestamps: true });

export default mongoose.models.LeadSourceList || mongoose.model('LeadSourceList', leadSourceListSchema);
