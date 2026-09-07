// models/Deal.js
import mongoose from 'mongoose';

/**
 * Parsed rows from DealerTrack DMS "SL" (Sales) export files. Only
 * dealer_id, the file's primary key (Deal Number), and the two highest-
 * value cross-reference fields (VIN, Customer Number) are declared
 * explicitly, for indexing. Every other column from the source TSV (buyer
 * and co-buyer contact/address blocks, vehicle description and VIN
 * Explosion fields, two Trade-In blocks, Salesman/Manager names and
 * numbers, pricing/cost/profit fields, the repeating Fee/Aftermarket (x20),
 * Warranty (x5), and Insurance (x3) column groups, deal dates, financing/
 * lease terms, CASS_STD_* columns, etc.) is left undeclared and stored
 * as-is because of `strict: false`.
 */
const dealSchema = new mongoose.Schema(
  {
    dealer_id: { type: String, required: true },
    deal_number: { type: String, required: true },
    vin: { type: String },
    customer_number: { type: String },
  },
  { strict: false, timestamps: true }
);

// One deal per dealer.
dealSchema.index({ dealer_id: 1, deal_number: 1 }, { unique: true });

// Cross-file lookups: join to RepairOrder/ServiceAppointment/PartInventory
// context by vehicle or customer.
dealSchema.index({ dealer_id: 1, vin: 1 });
dealSchema.index({ dealer_id: 1, customer_number: 1 });

const Deal = mongoose.models.Deal || mongoose.model('Deal', dealSchema);

export default Deal;
