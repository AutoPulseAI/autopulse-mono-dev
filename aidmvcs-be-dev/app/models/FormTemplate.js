import mongoose from 'mongoose';

// A dealership form in its Forms Library (SOW v6 Deliverable K, gaps G-064 - G-067; the user, 13 Nov 2026). The form
// is an on-screen form (`schema`, app/lib/forms/schema.js) built from the dealer's PDF and edited in the builder; the
// PDF it was read from is kept for reference only. Every saved change to a form already used for a customer is a new
// version, so a filled copy always keeps the exact form it was made with.
const versionSchema = new mongoose.Schema({
  version: { type: Number, required: true },
  schema: { type: Object, required: true },
  source_file_id: { type: mongoose.Schema.Types.ObjectId, default: null }, // the uploaded PDF (GridFS), if any
  source_filename: { type: String, default: null },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  created_by_name: { type: String, default: null },
  created_at: { type: Date, default: Date.now },
}, { _id: false });

const historySchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  by_name: { type: String, default: null },
  action: { type: String, required: true }, // created | edited | new_version | settings | activated | deactivated
  detail: { type: String, default: null },
}, { _id: false });

export const FORM_CATEGORIES = Object.freeze(['Customer information', 'Trade-in appraisal', 'Test drive',
  "Buyer's order", 'Credit application', 'We Owe / Due Bill', 'Delivery checklist', 'Privacy / consent', 'Other']);

const formTemplateSchema = new mongoose.Schema({
  dealer_id: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true },
  category: { type: String, enum: FORM_CATEGORIES, default: 'Other' },
  active: { type: Boolean, default: false }, // switched on by the dealer once the form is checked
  departments: { type: [String], default: [] }, // sales | service; empty = both
  role_ids: { type: [mongoose.Schema.Types.ObjectId], default: [] }, // empty = every staff role
  statuses: { type: [String], default: [] }, // lead statuses that make it available; empty = any
  retention_days: { type: Number, default: null }, // filled copies kept this long; null = kept
  current_version: { type: Number, default: 1 },
  versions: { type: [versionSchema], default: [] },
  history: { type: [historySchema], default: [] },
  // Deleted from the library: gone from every list; the customers' forms made with it keep their own copy of it.
  deleted_at: { type: Date, default: null },
  deleted_by_name: { type: String, default: null },
}, { timestamps: true });

export default mongoose.models.FormTemplate || mongoose.model('FormTemplate', formTemplateSchema);
