import mongoose from 'mongoose';

// A manager's decision on two customers the duplicate check flagged (SOW Deliverable B b3, gap G-008: "duplicates
// flagged, not auto-merged"). 'not_duplicate' = two different people who share a phone or email (e.g. a couple);
// the pair is not flagged again. One row per dealer + pair (customer ids sorted, joined by ':').
const duplicateReviewSchema = new mongoose.Schema({
  dealer_id: { type: String, required: true },
  pair: { type: String, required: true },
  customer_ids: { type: [mongoose.Schema.Types.ObjectId], required: true },
  decision: { type: String, enum: ['not_duplicate'], required: true },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  by_name: { type: String, default: null },
  at: { type: Date, default: Date.now },
}, { timestamps: false });

duplicateReviewSchema.index({ dealer_id: 1, pair: 1 }, { unique: true });

export default mongoose.models.DuplicateReview || mongoose.model('DuplicateReview', duplicateReviewSchema);
