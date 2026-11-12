import mongoose from "mongoose";

const customerEmailSchema = new mongoose.Schema(
  {
    value: { type: String, required: true, trim: true, lowercase: true },
    is_primary: { type: Boolean, default: false },
    // SOW H (G-061): mobile / home / work / other, set by staff.
    label: { type: String, enum: ["mobile", "home", "work", "other"], default: undefined },
    source: { type: String },
    first_seen_lead_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
    },
    added_at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const customerPhoneSchema = new mongoose.Schema(
  {
    value: { type: String, required: true, trim: true },
    is_primary: { type: Boolean, default: false },
    // SOW H (G-061): mobile / home / work / other, set by staff.
    label: { type: String, enum: ["mobile", "home", "work", "other"], default: undefined },
    source: { type: String },
    sms_opt_in: { type: Boolean },
    first_seen_lead_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
    },
    added_at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const mergeHistorySchema = new mongoose.Schema(
  {
    merged_customer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    merged_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    merged_at: { type: Date, default: Date.now },
    reason: { type: String },
    reversed_at: { type: Date },
    reversed_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { _id: false }
);

const assignmentHistorySchema = new mongoose.Schema(
  {
    assigned_to: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Denormalized name snapshots so the Recent Activity feed can render
    // "Assigned to X by Y" without re-populating/re-resolving Users that may
    // since have been renamed or removed.
    assigned_to_name: { type: String, default: null },
    assigned_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    assigned_by_name: { type: String, default: null },
    assigned_at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const customerSchema = new mongoose.Schema(
  {
    dealer_id: { type: String, required: true },
    name: { type: String },
    emails: { type: [customerEmailSchema], default: [] },
    phones: { type: [customerPhoneSchema], default: [] },
    followup_preference: { type: String },
    preferred_communication_mode: { type: String },
    preferred_communication_mode_selected: { type: Boolean, default: false },
    user_language: { type: String },
    dealervault_upload: { type: Boolean, default: false },
    inbound_lead: { type: Boolean, default: false },
    manual_entry: { type: Boolean, default: false },
    assigned_to: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    assignment_history: { type: [assignmentHistorySchema], default: [] },

    // Set by scripts/backfill-customers-for-orphaned-leads.js only when this
    // Customer was newly created (not matched to an existing one) by that
    // run, so it can be traced back to the run that created it (e.g.
    // `migration_20260829_213045`).
    migration_batch: { type: String, default: null },

    merged_into: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
    },
    merge_history: { type: [mergeHistorySchema], default: [] },

    // SOW Deliverable H (G-061): contact details staff edit. Postal addresses; contacts staff removed (a later lead
    // or import never adds them back - "a stale import cannot undo a confirmed correction"); and the history of every
    // contact change (who, when, what). See app/api/customers/[id]/contacts.
    addresses: {
      type: [new mongoose.Schema({
        label: { type: String, enum: ["home", "work", "billing", "other"], default: "home" },
        line1: { type: String, trim: true }, line2: { type: String, trim: true }, city: { type: String, trim: true },
        state: { type: String, trim: true }, zip: { type: String, trim: true },
        is_primary: { type: Boolean, default: false }, added_at: { type: Date, default: Date.now },
      })],
      default: undefined,
    },
    removed_contacts: {
      type: [new mongoose.Schema({ kind: { type: String, enum: ["email", "phone"] }, value: { type: String },
        at: { type: Date }, by: { type: mongoose.Schema.Types.ObjectId, ref: "User" } }, { _id: false })],
      default: undefined,
    },
    contact_history: {
      type: [new mongoose.Schema({ at: { type: Date }, by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        by_name: { type: String }, field: { type: String }, action: { type: String },
        from: { type: mongoose.Schema.Types.Mixed }, to: { type: mongoose.Schema.Types.Mixed } }, { _id: false })],
      default: undefined,
    },

    // Catch-all for fields from external sources (e.g. DealerTrack DMS
    // imports) that aren't modeled here yet, so unmapped data is preserved
    // instead of silently dropped by strict-mode schema validation.
    extra: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

customerSchema.index({ dealer_id: 1, "emails.value": 1 });
customerSchema.index({ dealer_id: 1, "phones.value": 1 });

export const CUSTOMER_MAPPING_INDEX = {
  key: { dealer_id: 1, "extra.dealervault.customer_numbers": 1 },
  options: {
    name: "dealervault_customer_number_unique",
    unique: true,
    partialFilterExpression: { "extra.dealervault.customer_numbers": { $type: "string" } },
  },
};
// Deploy this new unique index explicitly after checking existing data. The
// existing Customer indexes retain normal application auto-index behavior.
customerSchema.index(CUSTOMER_MAPPING_INDEX.key, {
  ...CUSTOMER_MAPPING_INDEX.options,
  _autoIndex: false,
});

const Customer =
  mongoose.models.Customer || mongoose.model("Customer", customerSchema);

export default Customer;
