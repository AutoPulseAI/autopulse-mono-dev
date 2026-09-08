import mongoose from 'mongoose';

const outcomeSchema = new mongoose.Schema({
  row_index: { type: Number, required: true },
  status: { type: String, enum: ['processed', 'failed'], required: true },
  code: { type: String, required: true },
  warnings: { type: [String], default: undefined },
}, { _id: false });

const schema = new mongoose.Schema({
  dealer_id: { type: String, required: true },
  fileName: { type: String, required: true },
  fileType: { type: String, required: true },
  dvDealerId: { type: String, required: true },
  batchId: { type: Number, required: true },
  digest: { type: String, required: true },
  source_file_timestamp: { type: String },
  // JSON text preserves arbitrary untrusted keys, nulls and empty objects exactly
  // without Mongoose casting or Mongo field-name restrictions on raw records.
  raw_records_json: { type: String, required: true },
  total_records: { type: Number, required: true },
  processed_count: { type: Number, default: 0 },
  failed_count: { type: Number, default: 0 },
  unchanged_count: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'completed_with_errors', 'failed'],
    default: 'pending',
  },
  row_outcomes: { type: [outcomeSchema], default: [] },
  error_code: { type: String, default: null },
  startedAt: Date,
  completedAt: Date,
}, { timestamps: true, autoIndex: false });

schema.index({ dealer_id: 1, fileName: 1, fileType: 1, batchId: 1 }, { unique: true });

export default mongoose.models.DealerVaultImportBatch
  || mongoose.model('DealerVaultImportBatch', schema);
