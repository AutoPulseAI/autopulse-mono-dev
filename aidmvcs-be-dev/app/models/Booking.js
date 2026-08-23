import mongoose from 'mongoose';

const bookingSchema = new mongoose.Schema(
  {
    dealer_id: { type: String, required: true },
    lead_id: { type: String, required: true },
    customerName: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    bookingDate: { type: Date, required: true },
    bookingTime: { type: String, required: true },
    notes: { type: String },
    booking_status: {
      type: String,
      enum: ['pending', 'confirmed', 'cancelled', 'completed'],
      default: 'pending'
    },
    statusChangedAt: { type: Date }
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