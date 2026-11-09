import mongoose from 'mongoose';

export const BOOKING_VIA = Object.freeze(['booking_api', 'lead_status', 'ai_service', 'booking_page', 'unknown']);

// Reporting indexes (bookings had none). Like Email.js's, they are not built by Mongoose on first use
// (_autoIndex: false): deploy them explicitly with scripts/ensure-report-indexes.js.
export const BOOKING_REPORT_INDEXES = Object.freeze([
  { key: { dealer_id: 1, createdAt: -1 }, options: { name: 'dealer_id_1_createdAt_-1' } },
  { key: { dealer_id: 1, bookingDate: 1 }, options: { name: 'dealer_id_1_bookingDate_1' } },
  { key: { lead_id: 1 }, options: { name: 'lead_id_1' } },
]);

const bookingSchema = new mongoose.Schema(
  {
    dealer_id: { type: String, required: true },
    lead_id: { type: String, required: true },
    customerName: { type: String, required: true },
    // Not required: an SMS-only lead has no email (and an email lead no phone);
    // the AI books both kinds.
    email: { type: String },
    phone: { type: String },
    bookingDate: { type: Date, required: true },
    bookingTime: { type: String, required: true },
    notes: { type: String },
    booking_status: {
      type: String,
      enum: ['pending', 'confirmed', 'cancelled', 'completed'],
      default: 'pending'
    },
    statusChangedAt: { type: Date },
    // Did the customer come? null = not known yet; true when staff set the
    // lead to Visited on the appointment's day (or the AI marks it), false
    // on No Show (agentic-upsell MASTER_PLAN_3 C5: appointment.showed).
    showed: { type: Boolean, default: null },
    showed_at: { type: Date, default: null },
    // Who booked it: 'ai' (the AI service, shared secret), 'staff' (a signed-in
    // user) or 'customer' (the public booking page).
    created_by: { type: String, enum: ['ai', 'staff', 'customer'], default: undefined },
    // Sales and service slots have their own capacity (app/lib/bookingService.js). Older bookings without
    // a type count as sales.
    appointment_type: { type: String, enum: ['sales', 'service'], default: 'sales' },

    // Booking history (P1 item 3, appointment attribution). All optional with no default: older bookings stay as
    // they are, and every writer adds these in the same update as the booking change, dropped (never failing the
    // booking) if they can't be written (app/lib/bookingService.js writeWithHistory).
    // The signed-in user who created it (staff only) and how it was created.
    created_by_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    created_by_name: { type: String },
    created_via: { type: String, enum: BOOKING_VIA },
    cancelled_at: { type: Date },
    cancelled_by: { type: String }, // 'ai' | 'staff' | 'customer' | 'system'
    reschedule_count: { type: Number },
    last_rescheduled_at: { type: Date },
    // created | rescheduled | status_changed | cancelled | showed | no_show | reverted | deduplicated, kept to the
    // last 100 entries ($slice, bookingService.js BOOKING_HISTORY_LIMIT). from / to: {date: 'YYYY-MM-DD'
    // dealer-local, time: 'HH:MM'} for a move, {booking_status} for a status change.
    history: {
      type: [new mongoose.Schema({
        at: { type: Date },
        action: { type: String },
        actor_type: { type: String }, // 'ai' | 'staff' | 'customer' | 'system' | 'unknown'
        actor_id: { type: mongoose.Schema.Types.ObjectId },
        actor_name: { type: String },
        via: { type: String },
        from: { type: mongoose.Schema.Types.Mixed },
        to: { type: mongoose.Schema.Types.Mixed },
      }, { _id: false })],
      default: undefined,
    },
  },
  { timestamps: true }
);

// Update statusChangedAt when booking_status changes
bookingSchema.pre('save', function(next) {
  if (this.isModified('booking_status')) {
    this.statusChangedAt = new Date();
  }
  next();
});

for (const index of BOOKING_REPORT_INDEXES) {
  bookingSchema.index(index.key, { ...index.options, _autoIndex: false });
}

export default mongoose.models.Booking || mongoose.model('Booking', bookingSchema);