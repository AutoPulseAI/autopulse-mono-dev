import mongoose from 'mongoose';

// One showroom visit on the Desk Log (SOW v6 Deliverable C / J, Betsy's Priority 3): a customer checked in, who works
// the deal, how far it got (stage) and how it ended (outcome, and for UNSOLD the reason). Stage, the lead's status,
// the outcome and its follow-up are kept apart (SOW 9C). Every change is kept in `history` (who, when, from, to).
// The lead's own status still moves through the existing status route (app/api/conversations/lead/status), so the
// existing follow-ups and AI rules run as before - the Desk Log adds no workflow engine of its own.
const historySchema = new mongoose.Schema(
  {
    field: { type: String, required: true }, // stage | outcome | unsold_reason | salesperson_id | ...
    from: { type: mongoose.Schema.Types.Mixed, default: null },
    to: { type: mongoose.Schema.Types.Mixed, default: null },
    at: { type: Date, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    by_name: { type: String, default: null },
  },
  { _id: false },
);

const noteSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 2000 },
    at: { type: Date, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    by_name: { type: String, default: null },
  },
  { _id: false },
);

const vehicleSchema = new mongoose.Schema(
  {
    year: { type: Number, default: null },
    make: { type: String, default: null, trim: true },
    model: { type: String, default: null, trim: true },
    trim: { type: String, default: null, trim: true },
    vin: { type: String, default: null, trim: true, uppercase: true },
  },
  { _id: false },
);

const deskLogEntrySchema = new mongoose.Schema(
  {
    dealer_id: { type: String, required: true },
    lead_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    customer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    department: { type: String, enum: ['sales', 'service'], default: 'sales' },
    checked_in_at: { type: Date, required: true }, // the showroom visit
    stock_number: { type: String, default: null, trim: true },
    vehicle: { type: vehicleSchema, default: () => ({}) },
    trade: { type: vehicleSchema, default: () => ({}) },
    salesperson_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    sales_manager_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    bdc_agent_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    stage: { type: String, default: null }, // app/lib/deskLog/deskLog.js STAGES
    stage_at: { type: Date, default: null }, // when the current stage started
    outcome: { type: String, default: null }, // OUTCOMES
    unsold_reason: { type: String, default: null }, // UNSOLD_REASONS, only with UNSOLD
    outcome_at: { type: Date, default: null },
    next_step_at: { type: Date, default: null }, // required for Future Follow-Up
    // The Sold Pending delivery checklist (lib/deskLog/rules.js) and Car Finder matches found in new inventory
    // (lib/deskLog/carFinder.js).
    checklist: { type: [new mongoose.Schema({ item: String, done: { type: Boolean, default: false }, at: Date,
      by_name: String }, { _id: false })], default: [] },
    car_finder_matches: { type: [new mongoose.Schema({ vin: String, stock_number: String, vehicle: String, price: Number,
      found_at: Date }, { _id: false })], default: [] },
    notes: { type: [noteSchema], default: [] },
    history: { type: [historySchema], default: [] },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

deskLogEntrySchema.index({ dealer_id: 1, checked_in_at: -1 });
deskLogEntrySchema.index({ dealer_id: 1, lead_id: 1 });
deskLogEntrySchema.index({ dealer_id: 1, outcome: 1, checked_in_at: -1 });

const DeskLogEntry = mongoose.models.DeskLogEntry || mongoose.model('DeskLogEntry', deskLogEntrySchema);

export default DeskLogEntry;
