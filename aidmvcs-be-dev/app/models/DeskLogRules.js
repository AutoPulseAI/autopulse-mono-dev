import mongoose from 'mongoose';

// A dealership's Desk Log settings (lib/deskLog/rules.js): which outcomes alert the managers, and the Sold Pending
// delivery checklist. One per dealer; every save is a new version in `history`. Follow-ups are the AI's (AI Studio).
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
