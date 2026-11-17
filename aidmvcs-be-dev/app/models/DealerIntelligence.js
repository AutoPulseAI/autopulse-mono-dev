import mongoose from 'mongoose';

// A rooftop's Dealer Intelligence settings (lib/dealerIntelligence/fields.js). Every change to a value is kept in
// `history` (who, when, from, to); `verified` per field records when someone last confirmed it.
const dealerIntelligenceSchema = new mongoose.Schema({
  dealer_id: { type: String, required: true, unique: true },
  values: { type: Object, default: {} },
  updated_by_name: { type: String, default: null },
  history: {
    type: [new mongoose.Schema({ at: Date, by: mongoose.Schema.Types.ObjectId, by_name: String, key: String,
      from: mongoose.Schema.Types.Mixed, to: mongoose.Schema.Types.Mixed }, { _id: false })],
    default: [],
  },
}, { timestamps: true });

export default mongoose.models.DealerIntelligence || mongoose.model('DealerIntelligence', dealerIntelligenceSchema);
