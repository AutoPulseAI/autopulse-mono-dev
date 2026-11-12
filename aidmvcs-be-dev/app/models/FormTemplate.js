import mongoose from 'mongoose';

// A dealership's form in its Forms & Documents Library (SOW v6 Deliverable K, gaps G-064 - G-067). The dealer uploads
// its own approved PDF (fillable, or flat with text placed at set positions); AutoPulse only fills it in. Every upload
// is a new version (the older ones are kept, so a stored document always knows the exact version it was made from).
// The field mapping belongs to a version: field (PDF form field name, or a placed box on a flat PDF) -> data source.
const mappingSchema = new mongoose.Schema({
  // Fillable PDF: the PDF field's name. Flat PDF: a box placed on a page (points from the bottom-left corner).
  field: { type: String, default: null },
  page: { type: Number, default: null }, x: { type: Number, default: null }, y: { type: Number, default: null },
  size: { type: Number, default: 10 },
  label: { type: String, default: null }, // what the box is, for a flat PDF ("Buyer name")
  source: { type: String, required: true }, // app/lib/forms/sources.js key
  required: { type: Boolean, default: false },
}, { _id: false });

const versionSchema = new mongoose.Schema({
  version: { type: Number, required: true },
  file_id: { type: mongoose.Schema.Types.ObjectId, required: true }, // GridFS (app/lib/forms/storage.js)
  filename: { type: String, default: null },
  size: { type: Number, default: 0 },
  fillable: { type: Boolean, default: false },
  fields: { type: [new mongoose.Schema({ name: String, type: String }, { _id: false })], default: [] },
  pages: { type: [new mongoose.Schema({ width: Number, height: Number }, { _id: false })], default: [] },
  mapping: { type: [mappingSchema], default: [] },
  uploaded_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  uploaded_by_name: { type: String, default: null },
  uploaded_at: { type: Date, default: Date.now },
}, { _id: false });

const historySchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  by_name: { type: String, default: null },
  action: { type: String, required: true }, // uploaded | new_version | settings | mapping | activated | deactivated
  detail: { type: String, default: null },
}, { _id: false });

export const FORM_CATEGORIES = Object.freeze(['Customer information', 'Trade-in appraisal', 'Test drive',
  "Buyer's order", 'Credit application', 'We Owe / Due Bill', 'Delivery checklist', 'Privacy / consent', 'Other']);

const formTemplateSchema = new mongoose.Schema({
  dealer_id: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true },
  category: { type: String, enum: FORM_CATEGORIES, default: 'Other' },
  active: { type: Boolean, default: true },
  departments: { type: [String], default: [] }, // sales | service; empty = both
  role_ids: { type: [mongoose.Schema.Types.ObjectId], default: [] }, // empty = every staff role
  statuses: { type: [String], default: [] }, // lead statuses that make it available; empty = any
  retention_days: { type: Number, default: null }, // generated copies kept this long; null = kept
  current_version: { type: Number, default: 1 },
  versions: { type: [versionSchema], default: [] },
  history: { type: [historySchema], default: [] },
}, { timestamps: true });

export default mongoose.models.FormTemplate || mongoose.model('FormTemplate', formTemplateSchema);
