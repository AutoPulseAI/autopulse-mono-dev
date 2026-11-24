import mongoose from 'mongoose';

// What one user cleared from their bell (the user, 24 Nov 2026: "notification is something that can be cleared").
// Only hides the notification for that user: an alert stays in Dealer Action Required and a call task in Call Tasks
// until the work is done. key: alert:<id> | call:<id> | new:<lead id> | moved:<log id> | taken:<log id>, or "all"
// (Clear all: new leads, reassignments and takeovers up to `at` are cleared). Removed after 45 days.
const notificationClearSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  dealer_id: { type: String, required: true },
  key: { type: String, required: true },
  at: { type: Date, default: Date.now },
}, { timestamps: false });

notificationClearSchema.index({ user_id: 1, dealer_id: 1, key: 1 }, { unique: true });
notificationClearSchema.index({ at: 1 }, { expireAfterSeconds: 45 * 24 * 3600 });

export default mongoose.models.NotificationClear || mongoose.model('NotificationClear', notificationClearSchema);
