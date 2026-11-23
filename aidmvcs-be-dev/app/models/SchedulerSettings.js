import mongoose from 'mongoose';

// A rooftop's service scheduler settings (SOW v6 Appendix A 1A / G-072: "per-rooftop scheduler settings: provider
// (Dealer-FX / Xtime via DealerVault), location, department, time zone, services, service advisors, appointment
// durations and booking restrictions"). The user, 18 Nov 2026: settings screen only - no vendor API access yet, so
// nothing reads or books slots and the status stays PENDING VENDOR VERIFICATION. Credentials are never stored here
// (SOW: "secure credentials in a secret manager"); they go into the server's secret store when the vendor issues them.
const serviceSchema = new mongoose.Schema({ name: String, duration_min: Number }, { _id: false });
const historySchema = new mongoose.Schema({ at: Date, by_name: String, change: String }, { _id: false });

const schedulerSettingsSchema = new mongoose.Schema({
  dealer_id: { type: String, required: true, unique: true },
  provider: { type: String, enum: ['none', 'dealer_fx', 'xtime_dealervault'], default: 'none' },
  status: { type: String, enum: ['pending_vendor_verification', 'blocked'], default: 'pending_vendor_verification' },
  location: { type: String, default: null },        // the vendor's store / location name or id
  department: { type: String, default: 'service' },
  timezone: { type: String, default: null },        // empty = the dealer's own time zone
  services: { type: [serviceSchema], default: [] }, // bookable services and their length
  advisors: { type: [String], default: [] },
  booking_restrictions: { type: String, default: null },
  vendor_contact: { type: String, default: null },
  access_requested_on: { type: Date, default: null },
  notes: { type: String, default: null },
  updated_by_name: { type: String, default: null },
  history: { type: [historySchema], default: [] },
}, { timestamps: true });

export default mongoose.models.SchedulerSettings || mongoose.model('SchedulerSettings', schedulerSettingsSchema);
