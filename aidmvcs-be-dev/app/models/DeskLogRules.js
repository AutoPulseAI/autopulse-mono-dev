import mongoose from 'mongoose';

// A dealership's Desk Log follow-up rules (SOW v6 Deliverable J: "the dealer-admin-configurable disposition-to-workflow
// matrix ... versioned and audited"): for each outcome / unsold reason, who follows up, who owns it, when the next step
// is due, whether managers are alerted, the report group; and the Sold Pending delivery checklist. One per dealer;
// every save is a new version in `history`. The AI's wording for each reason stays in AI Studio (Cadences > Unsold).
const deskLogRulesSchema = new mongoose.Schema({
  dealer_id: { type: String, required: true, unique: true },
  version: { type: Number, default: 1 },
  rules: { type: Object, default: {} },
  checklist: { type: [String], default: [] },
  history: {
    type: [new mongoose.Schema({ version: Number, at: Date, by: mongoose.Schema.Types.ObjectId, by_name: String,
      rules: Object, checklist: [String] }, { _id: false })],
    default: [],
  },
}, { timestamps: true });

export default mongoose.models.DeskLogRules || mongoose.model('DeskLogRules', deskLogRulesSchema);
