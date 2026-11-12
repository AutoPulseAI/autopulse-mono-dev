import mongoose from 'mongoose';

// A form filled in for one customer and one opportunity (SOW v6 Deliverable K, gap G-066): an immutable snapshot - the
// PDF as generated, the template version it came from, the values that went in, what was missing, who made it and
// when. A later change to the customer never rewrites it; every download / print is logged.
const formDocumentSchema = new mongoose.Schema({
  dealer_id: { type: String, required: true },
  template_id: { type: mongoose.Schema.Types.ObjectId, ref: 'FormTemplate', required: true },
  template_name: { type: String, default: null },
  template_version: { type: Number, required: true },
  customer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  lead_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
  trade_in_ids: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  values: { type: Object, default: {} }, // source key -> the value printed (sensitive values are not kept here)
  missing: { type: [String], default: [] },
  file_id: { type: mongoose.Schema.Types.ObjectId, default: null }, // null once removed at the end of retention
  size: { type: Number, default: 0 },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  created_by_name: { type: String, default: null },
  retain_until: { type: Date, default: null },
  removed_at: { type: Date, default: null },
  audit: {
    type: [new mongoose.Schema({ at: Date, by: mongoose.Schema.Types.ObjectId, by_name: String, action: String },
      { _id: false })],
    default: [],
  },
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

formDocumentSchema.index({ dealer_id: 1, customer_id: 1, created_at: -1 });

export default mongoose.models.FormDocument || mongoose.model('FormDocument', formDocumentSchema);
