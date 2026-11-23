import mongoose from 'mongoose';

// The dealer's own list of lead sources (gap G-009: "manage source/campaign labels"): what staff pick as the Lead
// Source on a lead they enter by hand (phone-up, walk-in), e.g. "Referral", "Radio", "Drive-by". Internet leads keep
// the source their provider sends. One document per dealer; every change is kept in `history` (who, when, what).
const historySchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  by_name: { type: String, default: null },
  action: { type: String, enum: ['add', 'rename', 'remove', 'campaign_add', 'campaign_update', 'campaign_remove'], required: true },
  from: { type: String, default: null },
  to: { type: String, default: null },
  leads_renamed: { type: Number, default: 0 },
}, { _id: false });

// A campaign / tracking code (SOW B "lead source and campaign taxonomy management"; 13 Nov 2026 meeting 4.4: admin adds
// tracking codes / campaigns per dealer). A new lead whose sub-source or lead source is exactly the code (any case)
// gets the campaign's name in Lead.campaign (app/lib/leadCampaign.js); reports can filter by it.
const campaignSchema = new mongoose.Schema({
  name: { type: String, required: true },
  code: { type: String, required: true },
  lead_source: { type: String, default: null }, // the source it runs on, e.g. "Facebook" (shown only)
  active: { type: Boolean, default: true },     // an inactive campaign no longer tags new leads
}, { _id: true });

const leadSourceListSchema = new mongoose.Schema({
  dealer_id: { type: String, required: true, unique: true },
  sources: { type: [String], default: [] },
  campaigns: { type: [campaignSchema], default: [] },
  history: { type: [historySchema], default: [] },
}, { timestamps: true });

export default mongoose.models.LeadSourceList || mongoose.model('LeadSourceList', leadSourceListSchema);
