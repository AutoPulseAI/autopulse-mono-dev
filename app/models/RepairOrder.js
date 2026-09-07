// models/RepairOrder.js
import mongoose from 'mongoose';

/**
 * Parsed rows from DealerTrack DMS "SV" (Service / Repair Order) export
 * files. Only dealer_id, the file's primary key (RO Number), and the two
 * highest-value cross-reference fields (VIN, Customer Number) are declared
 * explicitly, for indexing. Every other column from the source TSV (Service
 * Advisor, RO Department/Store, Open/Close Date, cost/sale totals by pay
 * type, the pipe/caret-packed Operation Codes / Tech Number / Part Number /
 * Parts Sale repeating-line fields, CASS_STD_* columns, etc.) is left
 * undeclared and stored as-is because of `strict: false`.
 */
const repairOrderSchema = new mongoose.Schema(
  {
    dealer_id: { type: String, required: true },
    ro_number: { type: String, required: true },
    vin: { type: String },
    customer_number: { type: String },
  },
  { strict: false, timestamps: true }
);

// One RO per dealer.
repairOrderSchema.index({ dealer_id: 1, ro_number: 1 }, { unique: true });

// Cross-file lookups: join to Deal/ServiceAppointment/PartInventory context
// by vehicle or customer.
repairOrderSchema.index({ dealer_id: 1, vin: 1 });
repairOrderSchema.index({ dealer_id: 1, customer_number: 1 });

const RepairOrder =
  mongoose.models.RepairOrder || mongoose.model('RepairOrder', repairOrderSchema);

export default RepairOrder;
