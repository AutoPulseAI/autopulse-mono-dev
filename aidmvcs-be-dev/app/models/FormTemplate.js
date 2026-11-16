import mongoose from 'mongoose';

// A dealership's form in its Forms Library (SOW v6 Deliverable K; the user, 16 Nov 2026 after the client meeting:
// "the dealership uploads its forms; from the customer profile they export the customer into any form and the data is
// mapped automatically"). The dealer's own PDF is kept as uploaded; `fields` are its blanks and the customer data each
// one gets (lib/forms/detect.js). A new upload of the same form is a new version; older ones are kept.
const fieldSchema = new mongoose.Schema({
  id: String, kind: String, pdf_field: String, label: String, source: { type: String, default: null },
  page: Number, x: Number, y: Number, w: Number, h: Number, size: Number,
  field_type: { type: String, default: 'text' }, // text / date / checkbox / signature / initials
  context: { type: String, default: 'buyer' }, // buyer / co_buyer / dealer / trade_in / vehicle_being_bought
  fill_policy: { type: String, default: null }, // 'automatic' (source filled on export) / 'person' (left blank)
  confidence: { type: Number, default: null }, // how sure the reading is, 0-1
  bbox: { type: [Number], default: undefined }, // [x0, y0, x1, y1] in the PDF's own points
  corrected: { type: Boolean, default: false }, // changed by staff in the form's panel
  rot: { type: Number, default: 0 }, // the page is turned (/Rotate): the text is written turned with it, so it reads upright
  found_by: { type: String, default: null }, // 'ai': placed by the AI (a scanned form, lib/forms/aiLocate.js)
}, { _id: false });

const versionSchema = new mongoose.Schema({
  version: { type: Number, required: true },
  source_file_id: { type: mongoose.Schema.Types.ObjectId, default: null }, // the PDF (GridFS, lib/forms/storage.js)
  source_filename: { type: String, default: null },
  fillable: { type: Boolean, default: false },
  pages: { type: Number, default: 0 },
  fields: { type: [fieldSchema], default: [] },
  // The form's fingerprint (lib/forms/detect.js): the same form uploaded again reuses these blanks, corrections included.
  fingerprint: { sha256: String, text_hash: String, page_sizes: String, field_names: String },
  reused_from: { template_id: mongoose.Schema.Types.ObjectId, version: Number, dealer_id: String },
  corrected_at: { type: Date, default: null },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  created_by_name: { type: String, default: null },
  created_at: { type: Date, default: Date.now },
}, { _id: false, strict: false });

const historySchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  by_name: { type: String, default: null },
  action: { type: String, required: true },
  detail: { type: String, default: null },
}, { _id: false });

const formTemplateSchema = new mongoose.Schema({
  dealer_id: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true },
  category: { type: String, default: 'Other' },
  active: { type: Boolean, default: true },
  current_version: { type: Number, default: 1 },
  versions: { type: [versionSchema], default: [] },
  history: { type: [historySchema], default: [] },
  deleted_at: { type: Date, default: null },
  deleted_by_name: { type: String, default: null },
}, { timestamps: true, strict: false });
formTemplateSchema.index({ 'versions.fingerprint.sha256': 1 });
formTemplateSchema.index({ 'versions.fingerprint.text_hash': 1 });

export default mongoose.models.FormTemplate || mongoose.model('FormTemplate', formTemplateSchema);
