import mongoose from 'mongoose';

// Field-by-field history of the customer profile (SOW Appendix B, DealerVault reconciliation, section 5 "History,
// provenance & audit trail"; 23 Nov 2026). One row per observation of one field from one source, with the decision
// the reconciliation took (app/lib/reconcile): the incoming value, the value it was compared with, the decision, the
// reason, the source and its event date. Append-only: a later observation adds a row, it never edits one, so why the
// current value was chosen can always be rebuilt. Staff contact edits keep their own audit in
// Customer.contact_history; the history screen shows both.
//
// field     name | phone | email | mileage:<VIN>   (a vehicle reading is per VIN)
// decision  ACCEPT  the incoming value is the current value
//           RETAIN  the value already on file stays current
//           APPEND  kept as history without changing the profile (e.g. a DMS phone the profile doesn't have)
//           REVIEW  a conflict or an impossible value: a person decides
//           REJECT  not usable (not a number, not valid)
// status    CUSTOMER_CONFIRMED / DEALER_USER_CONFIRMED / CUSTOMER_DISPUTED (a mark staff record on the customer's
//           word), else null
const customerFieldHistorySchema = new mongoose.Schema({
  dealer_id: { type: String, required: true },
  customer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  field: { type: String, required: true },
  value: { type: mongoose.Schema.Types.Mixed, default: null },
  prior_value: { type: mongoose.Schema.Types.Mixed, default: null },
  decision: { type: String, enum: ['ACCEPT', 'RETAIN', 'APPEND', 'REVIEW', 'REJECT'], required: true },
  reason: { type: String, default: null },
  source: { type: String, enum: ['DMS', 'CUSTOMER', 'DEALER_USER', 'LEAD', 'AI'], required: true },
  source_event_type: { type: String, default: null }, // repair_order | sale | profile | mark
  source_event_date: { type: Date, default: null },   // the RO / sale date; null = undated (profile data)
  source_record_id: { type: String, default: null },  // RO number, deal number, DMS customer number
  source_file: { type: String, default: null },
  precision: { type: String, enum: ['EXACT', 'APPROXIMATE', null], default: null },
  status: { type: String, enum: ['CUSTOMER_CONFIRMED', 'DEALER_USER_CONFIRMED', 'CUSTOMER_DISPUTED', null], default: null },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  by_name: { type: String, default: null },
  // The same observation arriving again (a DMS file repeats its ROs several times a day) is stored once.
  dedupe_key: { type: String, required: true },
  review_resolved_at: { type: Date, default: undefined },
  review_resolved_by_name: { type: String, default: undefined },
  imported_at: { type: Date, default: Date.now },
}, { timestamps: false, collection: 'customer_field_history' });

customerFieldHistorySchema.index({ dedupe_key: 1 }, { unique: true });
customerFieldHistorySchema.index({ customer_id: 1, field: 1, source_event_date: -1 });
customerFieldHistorySchema.index({ dealer_id: 1, decision: 1, imported_at: -1 });

export default mongoose.models.CustomerFieldHistory
  || mongoose.model('CustomerFieldHistory', customerFieldHistorySchema);
