import mongoose from "mongoose";

const customerEmailSchema = new mongoose.Schema(
  {
    value: { type: String, required: true, trim: true, lowercase: true },
    is_primary: { type: Boolean, default: false },
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
  },
  { timestamps: true }
);

customerSchema.index({ dealer_id: 1, "emails.value": 1 });
customerSchema.index({ dealer_id: 1, "phones.value": 1 });

const Customer =
  mongoose.models.Customer || mongoose.model("Customer", customerSchema);

export default Customer;
