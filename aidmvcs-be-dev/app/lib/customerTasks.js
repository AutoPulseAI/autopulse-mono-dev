// What is open for a customer right now, for the top of their profile (17 Nov 2026, BB's DealerSocket video: "Virtual
// Delivery Appointment tomorrow - manager call to confirm", "follow up", each with who it is assigned to). Read from
// where each is already kept, nothing stored twice:
//   call      an open or missed AI call task (ai_call_tasks, written by the AI service), with who should call
//   appt      an upcoming sales / service appointment (Booking) that is not cancelled
//   followup  the AI's next planned message to the customer (scheduled_followups, pending)
//   reminder  a reminder staff set on the opportunity (LeadReminder, not done yet; 19 Nov 2026, SOW B3)
import mongoose from 'mongoose';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import LeadReminder from '../models/LeadReminder.js';

const FOLLOWUP_KINDS = ['cadence_touch', 'next_action', 'visit_followup', 'owner_touch', 'channel_switch'];

/** @returns {Promise<{kind, at, text, lead_id, who}[]>} soonest first, at most 8 */
// dealerId keeps the AI collections on their dealer_id indexes (24 Nov 2026: without it each call read the whole collection).
export async function openTasks({ leadIds = [], dealerId = null, now = new Date(), db = mongoose.connection.db } = {}) {
  const dealer = dealerId ? { dealer_id: String(dealerId) } : {};
  const ids = leadIds.map(String);
  if (!ids.length) return [];
  const [rawCalls, bookings, followups, reminders] = await Promise.all([
    // A call nobody made by the end of the day becomes "missed" in the AI service but is still not done (25 Nov 2026:
    // the profile showed open ones only, so most call tasks never appeared). Newest first; one per lead below.
    db.collection('ai_call_tasks').find({ ...dealer, lead_id: { $in: ids }, status: { $in: ['open', 'missed'] } })
      .project({ lead_id: 1, reason: 1, due_by: 1, opened_at: 1, assigned_to: 1, phone: 1, status: 1 })
      .sort({ opened_at: -1 }).limit(30).toArray().catch(() => []),
    Booking.find({ lead_id: { $in: ids }, bookingDate: { $gte: new Date(now.getTime() - 12 * 3600000) },
      booking_status: { $ne: 'cancelled' }, showed: { $ne: false } })
      .select('lead_id bookingDate bookingTime appointment_type booking_status').sort({ bookingDate: 1 }).limit(5).lean(),
    db.collection('scheduled_followups').find({ ...dealer, lead_id: { $in: ids }, status: 'pending', kind: { $in: FOLLOWUP_KINDS } })
      .project({ lead_id: 1, due_at: 1, to_channel: 1, kind: 1 }).sort({ due_at: 1 }).limit(1).toArray().catch(() => []),
    LeadReminder.find({ lead_id: { $in: ids.filter((i) => mongoose.isValidObjectId(i)) }, done_at: null })
      .select('lead_id due_at note assigned_name').sort({ due_at: 1 }).limit(10).lean().catch(() => []),
  ]);
  // One call per lead: its open task, else its latest missed one.
  const byLead = new Map();
  for (const c of rawCalls) {
    const k = String(c.lead_id); const had = byLead.get(k);
    if (!had || (had.status !== 'open' && c.status === 'open')) byLead.set(k, c);
  }
  const calls = [...byLead.values()];
  const staffIds = calls.map((c) => c.assigned_to).filter((x) => x && mongoose.isValidObjectId(String(x)));
  const names = new Map((staffIds.length ? await User.find({ _id: { $in: staffIds } }).select('name').lean() : [])
    .map((u) => [String(u._id), u.name]));
  const day = (d) => new Date(d).toISOString();
  const out = [
    ...calls.map((c) => ({ kind: 'call', id: String(c._id), missed: c.status === 'missed',
      at: c.due_by ? day(c.due_by) : c.opened_at ? day(c.opened_at) : null, lead_id: String(c.lead_id),
      text: `Call the customer${c.phone ? ` at ${c.phone}` : ''}${c.reason ? ` - ${String(c.reason).replace(/_/g, ' ')}` : ''}`,
      who: names.get(String(c.assigned_to)) || null })),
    ...bookings.map((b) => ({ kind: 'appt', at: day(b.bookingDate), lead_id: String(b.lead_id),
      text: `${b.appointment_type === 'service' ? 'Service' : 'Sales'} appointment${b.bookingTime ? ` at ${b.bookingTime}` : ''}`
        + `${b.booking_status === 'confirmed' ? ' (confirmed)' : ''}`, who: null })),
    ...reminders.map((r) => ({ kind: 'reminder', id: String(r._id), at: day(r.due_at), lead_id: String(r.lead_id), text: `Reminder: ${r.note}`,
      who: r.assigned_name || null })),
    ...followups.map((f) => ({ kind: 'followup', at: f.due_at ? day(f.due_at) : null, lead_id: String(f.lead_id),
      text: `AI follow-up by ${f.to_channel === 'email' ? 'email' : 'text'}`, who: 'AI' })),
  ];
  return out.sort((a, b) => String(a.at || '9').localeCompare(String(b.at || '9'))).slice(0, 8);
}
