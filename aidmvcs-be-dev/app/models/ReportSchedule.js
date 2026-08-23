import mongoose from "mongoose";

const ReportScheduleSchema = new mongoose.Schema({
  dealer_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  schedule_id: {
    type: String,
    required: true
  },
  frequency: {
    type: String,
    enum: ["daily", "weekly", "monthly", "yearly"],
    required: true
  },
  scheduledAt: {
    type: Date,
    required: true
  },
  sentAt: {
    type: Date,
    default: null
  },
  status: {
    type: String,
    enum: ["pending", "sent", "failed"],
    default: "pending"
  },
  attemptCount: {
    type: Number,
    default: 0
  },
  lastError: {
    type: String,
    default: null
  },
  report_data: {
    email: { type: String, required: true },
    timezone: { type: String, default: "America/New_York" },
    include_metrics: {
      leads: { type: Boolean, default: true },
      conversations: { type: Boolean, default: true },
      vehicles: { type: Boolean, default: true },
      revenue: { type: Boolean, default: true }
    },
    custom_message: { type: String, default: "" }
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Index for efficient querying
ReportScheduleSchema.index({ dealer_id: 1, scheduledAt: 1 });
ReportScheduleSchema.index({ status: 1 });
ReportScheduleSchema.index({ scheduledAt: 1 });

// Virtual for next scheduled report
ReportScheduleSchema.virtual('isOverdue').get(function() {
  if (this.status === 'sent') return false;
  return this.scheduledAt < new Date();
});

export default mongoose.models.ReportSchedule || mongoose.model("ReportSchedule", ReportScheduleSchema);
