import mongoose from 'mongoose';

const appointmentReminderSchema = new mongoose.Schema({
  dealer_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  booking_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    required: false
  },
  lead_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    required: false
  },
  customer_name: {
    type: String,
    required: true
  },
  customer_email: {
    type: String,
    required: false
  },
  customer_phone: {
    type: String,
    required: false
  },
  appointment_date: {
    type: Date,
    required: true
  },
  appointment_time: {
    type: String,
    required: true
  },
  reminder_type: {
    type: String,
    enum: ['email', 'sms', 'both'],
    default: 'both'
  },
  message_type: {
    type: String,
    enum: ['appointment_reminder', 'post_appointment', 'managerial_review'],
    default: 'appointment_reminder'
  },
  scheduled_for: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'failed', 'cancelled'],
    default: 'pending'
  },
  sent_at: {
    type: Date,
    default: null
  },
  error_message: {
    type: String,
    default: null
  },
  attempt_count: {
    type: Number,
    default: 0
  },
  max_attempts: {
    type: Number,
    default: 3
  },
  reminder_data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Index for efficient querying
appointmentReminderSchema.index({ scheduled_for: 1, status: 1 });
appointmentReminderSchema.index({ dealer_id: 1, status: 1 });
appointmentReminderSchema.index({ booking_id: 1 });
appointmentReminderSchema.index({ lead_id: 1 });
appointmentReminderSchema.index({ message_type: 1 });

// Add validation to ensure either booking_id or lead_id is provided
// Also ensure either customer_email or customer_phone is provided
appointmentReminderSchema.pre('validate', function(next) {
  if (!this.booking_id && !this.lead_id) {
    return next(new Error('Either booking_id or lead_id must be provided'));
  }
  
  // Ensure at least one contact method is provided
  if (!this.customer_email && !this.customer_phone) {
    return next(new Error('Either customer_email or customer_phone must be provided'));
  }
  
  next();
});

export default mongoose.models.AppointmentReminder || mongoose.model('AppointmentReminder', appointmentReminderSchema);
