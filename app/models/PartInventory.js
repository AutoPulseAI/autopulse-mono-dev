// models/PartInventory.js
import mongoose from 'mongoose';

/**
 * Parsed rows from DealerTrack DMS "PTINV" (Parts Inventory) export files.
 * Only dealer_id and the file's primary key (Part Number) are declared
 * explicitly, for indexing. Every other column from the source TSV (Part
 * Description, Part Cost/Price, Quantity On Hand/On Order, stock levels,
 * Stocking Status, BIN#, Source, Manufacturer Status, Make, Entry/Last
 * Sale/Last Received Date, YTD totals, Old/New Part Number, Part Group,
 * etc.) is left undeclared and stored as-is because of `strict: false`.
 */
const partInventorySchema = new mongoose.Schema(
  {
    dealer_id: { type: String, required: true },
    part_number: { type: String, required: true },
  },
  { strict: false, timestamps: true }
);

// One part record per dealer.
partInventorySchema.index({ dealer_id: 1, part_number: 1 }, { unique: true });

const PartInventory =
  mongoose.models.PartInventory || mongoose.model('PartInventory', partInventorySchema);

export default PartInventory;
