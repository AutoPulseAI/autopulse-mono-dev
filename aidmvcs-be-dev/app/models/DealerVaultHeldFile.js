import mongoose from 'mongoose';

// A DMS feed file held back instead of imported (SOW G-087, 17 Nov 2026: "quarantine malformed / incomplete /
// unexpectedly small feed; never mass blank / delete / downgrade"; worker/dealervault/feedCheck.js). Nothing from it is
// written until a super admin releases it (or discards it) on Admin > DMS feed.
const schema = new mongoose.Schema({
  dvDealerId: { type: String, required: true },
  dealer_id: { type: String, default: null },
  fileName: { type: String, required: true, unique: true },
  fileType: { type: String, required: true },
  bucket: { type: String, required: true },
  key: { type: String, required: true },
  records: { type: Number, default: 0 },
  expected: { type: Number, default: null }, // typical size of this store's recent files of this type
  reasons: { type: [String], default: [] },
  status: { type: String, enum: ['held', 'release_requested', 'releasing', 'released', 'discarded'], default: 'held' },
  decided_by_name: { type: String, default: null },
  decided_at: { type: Date, default: null },
}, { timestamps: true });

export default mongoose.models.DealerVaultHeldFile || mongoose.model('DealerVaultHeldFile', schema);
