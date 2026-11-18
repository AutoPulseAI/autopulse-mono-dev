import mongoose from 'mongoose';

// One eligibility check before a text or email to a customer (SOW Deliverable L: "Log all decisions and reasons").
// Kept as evidence; customer contact data stays inside the dealer's admin screen.
const contactEligibilityDecisionSchema = new mongoose.Schema({
  dealer_id: { type: String, required: true },
  channel: { type: String, enum: ['sms', 'email', 'call'], required: true },
  to: { type: String, required: true },       // 10-digit phone or lower-case email
  origin: { type: String, default: 'unknown' }, // 'ai' | 'staff' | 'automation' | 'unknown'
  reply: { type: Boolean, default: false },     // answering the customer's own message
  lead_id: { type: String, default: null },
  decision: { type: String, enum: ['allow', 'block', 'review'], required: true },
  reasons: { type: [String], default: [] },
  checks: { type: Object, default: {} },        // each check: 'pass' | 'fail' | 'not_connected' | 'error'
  mode: { type: String, enum: ['log_only', 'enforce'], default: 'log_only' },
  enforced: { type: Boolean, default: false },  // true = the send was stopped
  at: { type: Date, default: Date.now },
});

contactEligibilityDecisionSchema.index({ dealer_id: 1, at: -1 });
contactEligibilityDecisionSchema.index({ dealer_id: 1, decision: 1, at: -1 });

export default mongoose.models.ContactEligibilityDecision
  || mongoose.model('ContactEligibilityDecision', contactEligibilityDecisionSchema);
