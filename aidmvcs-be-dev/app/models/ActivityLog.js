import mongoose from 'mongoose';

// Who did what to a lead / customer, for the customer timeline (client, 10 Oct 2026: "if a user manually does
// something it needs to be logged on the timeline"). Written by app/lib/activityLog.js. The AI's own actions are not
// copied here: the timeline reads them where the AI already records them (ai_lead_state.stage_history, the
// conversation, ai_consent) - app/api/customers/[id]/360/activity.js.
const activityLogSchema = new mongoose.Schema({
  dealer_id: { type: String, required: true },
  customer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
  lead_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
  actor_type: { type: String, enum: ['staff', 'ai', 'system', 'customer'], required: true },
  actor_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  actor_name: { type: String, default: null },
  action: { type: String, required: true }, // e.g. status_changed
  from: { type: String, default: null },
  to: { type: String, default: null },
  detail: { type: String, default: null },
  at: { type: Date, default: Date.now },
}, { timestamps: false });

activityLogSchema.index({ dealer_id: 1, customer_id: 1, at: -1 });
activityLogSchema.index({ lead_id: 1, at: -1 });

export default mongoose.models.ActivityLog || mongoose.model('ActivityLog', activityLogSchema);
