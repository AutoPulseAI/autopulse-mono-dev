// models/Vehicle.js
import mongoose from 'mongoose';

/**
 * A flexible Vehicle schema that accepts any fields without explicit definitions.
 * - `strict: false` allows storing arbitrary properties.
 * - `timestamps: true` auto-manages createdAt and updatedAt.
 */
const vehicleSchema = new mongoose.Schema(
  { dealerId: { type: String , required: true } },
  { strict: false, timestamps: true }
);

// Compound unique index on dealer and VIN (even if VIN isn't explicitly defined, it will be honored)
vehicleSchema.index({ dealerId: 1, vin: 1 }, { unique: true });

const Vehicle = mongoose.models.Vehicle || mongoose.model('Vehicle', vehicleSchema);
export default Vehicle;
