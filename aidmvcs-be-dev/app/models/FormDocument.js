import mongoose from 'mongoose';

// A form filled for one customer and one opportunity (SOW v6 Deliverable K, gap G-066): the form exactly as it was
// (schema of the template version) with what was entered (`data`). A draft can still be changed; a completed one never
// changes again - later changes to the customer or to the form don't touch it. The PDF is made from it on request.
const formDocumentSchema = new mongoose.Schema({
  dealer_id: { type: String, required: true },
  template_id: { type: mongoose.Schema.Types.ObjectId, ref: 'FormTemplate', required: true },
  template_name: { type: String, default: null },
  template_version: { type: Number, required: true },
  schema: { type: Object, required: true },
  data: { type: Object, default: {} }, // field id (or id#n in a section repeated per trade-in) -> value
  prefilled: { type: [String], default: [] }, // data keys that came from the CRM
  customer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  lead_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
  trade_in_ids: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  status: { type: String, enum: ['draft', 'completed'], default: 'draft' },
  completed_at: { type: Date, default: null },
  completed_by_name: { type: String, default: null },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  created_by_name: { type: String, default: null },
  retain_until: { type: Date, default: null },
  removed_at: { type: Date, default: null },
  audit: {
    type: [new mongoose.Schema({ at: Date, by: mongoose.Schema.Types.ObjectId, by_name: String, action: String },
      { _id: false })],
    default: [],
  },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

formDocumentSchema.index({ dealer_id: 1, customer_id: 1, created_at: -1 });

export default mongoose.models.FormDocument || mongoose.model('FormDocument', formDocumentSchema);
