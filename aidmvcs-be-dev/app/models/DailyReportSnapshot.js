// One dealer's numbers for one completed dealer-local day (P1 plan item 6, daily performance email). Built once by
// app/lib/reports/dailySnapshot.js and then read as is: a retry or a resend of the same day sends the same numbers.
// Counts only - no customer names, phones or emails.
import mongoose from 'mongoose';

const DailyReportSnapshotSchema = new mongoose.Schema({
  dealer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  report_date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }, // dealer-local YYYY-MM-DD
  tz: { type: String, required: true },
  version: { type: Number, required: true, default: 1 },
  window: { start: Date, end: Date }, // UTC instants of local 00:00 .. 23:59:59.999
  generated_at: { type: Date, required: true },
  data_as_of: { type: Date, required: true },
  definitions: { type: Object, default: {} }, // definition versions of the functions the numbers came from
  // {appointments, appointments_due, replies, leads, ai_activity}; a section that could not be computed is null and
  // listed in stale_sources, so the email shows "—" for it instead of 0.
  metrics: { type: Object, default: {} },
  unavailable: { type: [String], default: [] }, // metric paths the CRM does not record (e.g. rescheduled)
  stale_sources: {
    type: [{ _id: false, source: String, reason: String, affects: [String] }],
    default: [],
  },
}, { timestamps: true, minimize: false });

DailyReportSnapshotSchema.index({ dealer_id: 1, report_date: 1, version: 1 }, { unique: true });

export default mongoose.models.DailyReportSnapshot
  || mongoose.model('DailyReportSnapshot', DailyReportSnapshotSchema, 'daily_report_snapshots');
