import mongoose from 'mongoose';
// A request from outside a dealership's IP list (lib/ipRestriction.js): "would block" in test mode, "blocked" when
// enforced. One row per person, IP and hour at most; kept 30 days. Shown on Admin > IP restriction.
const ipRestrictionLogSchema = new mongoose.Schema({
  dealer_id: { type: String, required: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  user_name: { type: String, default: null },
  ip: { type: String, required: true },
  where: { type: String, default: null }, // sign-in | page | api
  blocked: { type: Boolean, default: false }, // false = test mode, only recorded
  at: { type: Date, default: Date.now },
});
ipRestrictionLogSchema.index({ dealer_id: 1, at: -1 });
ipRestrictionLogSchema.index({ at: 1 }, { expireAfterSeconds: 30 * 86400 });
export default mongoose.models.IpRestrictionLog || mongoose.model('IpRestrictionLog', ipRestrictionLogSchema);
