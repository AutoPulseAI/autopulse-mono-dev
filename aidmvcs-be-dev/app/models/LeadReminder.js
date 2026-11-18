import mongoose from 'mongoose';

// A reminder staff set on one opportunity (lead) - SOW Deliverable D "create, complete, reschedule ... tasks with audit
// history"; the reference CRM's Schedule > Reminder (SOW B3). Shown in Open tasks at the top of the customer's profile
// (app/lib/customerTasks.js) until someone marks it done. It never messages the customer: it is a note to staff.
const leadReminderSchema = new mongoose.Schema({
  dealer_id: { type: String, required: true },
  lead_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
  customer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
  due_at: { type: Date, required: true },
  note: { type: String, required: true },
  assigned_to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  assigned_name: { type: String, default: null },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  created_by_name: { type: String, default: null },
  done_at: { type: Date, default: null },
  done_by_name: { type: String, default: null },
}, { timestamps: true });

leadReminderSchema.index({ lead_id: 1, done_at: 1, due_at: 1 });

export default mongoose.models.LeadReminder || mongoose.model('LeadReminder', leadReminderSchema);
