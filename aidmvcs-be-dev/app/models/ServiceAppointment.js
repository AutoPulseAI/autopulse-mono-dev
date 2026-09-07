// models/ServiceAppointment.js
import mongoose from 'mongoose';

/**
 * Parsed rows from DealerTrack DMS "SV_APPT" (Service Appointments) export
 * files. Only dealer_id, the file's primary key (Appointment Number), and
 * the two highest-value cross-reference fields (RO Number, VIN) are
 * declared explicitly, for indexing. RO Number is a forward link: it's
 * empty until the appointment converts into a RepairOrder (SV) record.
 * Every other column from the source TSV (Appointment Date/Time/Create
 * Date, Last RO Miles/Date, Promise Date/Time, Cause/Complaint/Comment,
 * Operation Code fields, Service Advisor, Waiting/Loaner/Alternate-
 * Transportation flags, Estimate Time/Amount, vehicle description block,
 * customer contact block, CASS_STD_* columns, etc.) is left undeclared and
 * stored as-is because of `strict: false`.
 */
const serviceAppointmentSchema = new mongoose.Schema(
  {
    dealer_id: { type: String, required: true },
    appointment_number: { type: String, required: true },
    ro_number: { type: String },
    vin: { type: String },
  },
  { strict: false, timestamps: true }
);

// One appointment per dealer.
serviceAppointmentSchema.index({ dealer_id: 1, appointment_number: 1 }, { unique: true });

// Cross-file lookups: forward-link to RepairOrder once converted, and join
// to Deal/RepairOrder/PartInventory context by vehicle.
serviceAppointmentSchema.index({ dealer_id: 1, ro_number: 1 });
serviceAppointmentSchema.index({ dealer_id: 1, vin: 1 });

const ServiceAppointment =
  mongoose.models.ServiceAppointment ||
  mongoose.model('ServiceAppointment', serviceAppointmentSchema);

export default ServiceAppointment;
