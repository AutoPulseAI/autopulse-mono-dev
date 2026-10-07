import mongoose from 'mongoose';

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
    appointment_type: { type: String, enum: ['sales', 'service'], default: 'sales' }
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

export default mongoose.models.Booking || mongoose.model('Booking', bookingSchema);