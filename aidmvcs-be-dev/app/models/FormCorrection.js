import mongoose from 'mongoose';

// A change staff made to one blank of a form in the Forms Library (its label, part of the form, what fills it, left for
// the person, or removed). The change itself is saved on the form's blanks (FormTemplate) and reused whenever the same
// form is uploaded again; this is the record of who changed what.
const formCorrectionSchema = new mongoose.Schema({
  dealer_id: { type: String, required: true, index: true },
  template_id: { type: mongoose.Schema.Types.ObjectId, ref: 'FormTemplate', required: true, index: true },
  version: Number,
  field_id: String,
  action: { type: String, enum: ['changed', 'deleted'], required: true },
  before: { type: Object, default: null },
  after: { type: Object, default: null },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  by_name: { type: String, default: null },
}, { timestamps: true });

export default mongoose.models.FormCorrection || mongoose.model('FormCorrection', formCorrectionSchema);
