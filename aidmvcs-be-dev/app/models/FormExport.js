import mongoose from 'mongoose';

// Who exported which form for which customer, and when (SOW v6 Deliverable K audit). The PDF itself is not kept: it is
// made again from the form and the customer's data whenever it is exported.
const formExportSchema = new mongoose.Schema({
  dealer_id: { type: String, required: true },
  template_id: { type: mongoose.Schema.Types.ObjectId, ref: 'FormTemplate', required: true },
  template_name: String,
  template_version: Number,
  customer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  lead_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
  filled: Number,
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  by_name: String,
  at: { type: Date, default: Date.now },
});
formExportSchema.index({ dealer_id: 1, customer_id: 1, at: -1 });

export default mongoose.models.FormExport || mongoose.model('FormExport', formExportSchema);
