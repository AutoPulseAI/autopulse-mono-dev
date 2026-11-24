import mongoose from 'mongoose';

// One bulk change on the Leads page (SOW Deliverable B b5: "bulk operations ... audit trail"), shown in Leads >
// Actions > Bulk history. The browser sends one batch_id for all the calls of one change (it saves at most 100 leads a
// call), so a 312-lead reassignment is one row. items keep each lead's value before the change (or what was added),
// so every change can be undone (app/api/leads/bulk-history/[id]/undo).
const itemSchema = new mongoose.Schema({
  lead_id: { type: mongoose.Schema.Types.ObjectId, required: true },
  name: { type: String, default: null },
  result: { type: String, enum: ['updated', 'unchanged', 'failed'], required: true },
  reason: { type: String, default: null },
  from_id: { type: mongoose.Schema.Types.ObjectId, default: null }, // reassign: the owner before
  from_label: { type: String, default: null }, // owner name / status / department / source / campaign before
  ref_id: { type: mongoose.Schema.Types.ObjectId, default: null }, // note / task: what was added (so Undo removes it)
}, { _id: false });

const bulkChangeSchema = new mongoose.Schema({
  dealer_id: { type: String, required: true },
  batch_id: { type: String, required: true },
  action: { type: String, enum: ['reassign', 'status', 'department', 'lead_source', 'campaign', 'note', 'task'], required: true },
  to_id: { type: mongoose.Schema.Types.ObjectId, default: null }, // reassign: the new owner (null = unassigned)
  to_label: { type: String, default: null }, // new owner's name / new status (shown)
  to_value: { type: String, default: null }, // department / source / campaign: the value stored (Undo puts the old one back)
  by_id: { type: mongoose.Schema.Types.ObjectId, default: null },
  by_name: { type: String, default: null },
  at: { type: Date, default: Date.now },
  updated: { type: Number, default: 0 },
  unchanged: { type: Number, default: 0 },
  failed: { type: Number, default: 0 },
  items: { type: [itemSchema], default: [] },
  undone_at: { type: Date, default: null },
  undone_by_name: { type: String, default: null },
  undo_result: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: false });

bulkChangeSchema.index({ dealer_id: 1, batch_id: 1 }, { unique: true });
bulkChangeSchema.index({ dealer_id: 1, at: -1 });
bulkChangeSchema.index({ 'items.lead_id': 1 });

export default mongoose.models.BulkChange || mongoose.model('BulkChange', bulkChangeSchema);
