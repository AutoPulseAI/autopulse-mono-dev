// What is open for a customer right now, for the top of their profile (17 Nov 2026, BB's DealerSocket video: "Virtual
// Delivery Appointment tomorrow - manager call to confirm", "follow up", each with who it is assigned to). Read from
// where each is already kept, nothing stored twice:
//   call      an open AI call task (ai_call_tasks, written by the AI service), with who should call
//   appt      an upcoming sales / service appointment (Booking) that is not cancelled
//   followup  the AI's next planned message to the customer (scheduled_followups, pending)
import mongoose from 'mongoose';
import Booking from '../models/Booking.js';
import User from '../models/User.js';

const FOLLOWUP_KINDS = ['cadence_touch', 'next_action', 'visit_followup', 'owner_touch', 'channel_switch'];

/** @returns {Promise<{kind, at, text, lead_id, who}[]>} soonest first, at most 8 */
export async function openTasks({ leadIds = [], now = new Date(), db = mongoose.connection.db } = {}) {
  const ids = leadIds.map(String);
  if (!ids.length) return [];
  const [calls, bookings, followups] = await Promise.all([
    db.collection('ai_call_tasks').find({ lead_id: { $in: ids }, status: 'open' })
      .project({ lead_id: 1, reason: 1, due_by: 1, opened_at: 1, assigned_to: 1, phone: 1 }).limit(10).toArray().catch(() => []),
    Booking.find({ lead_id: { $in: ids }, bookingDate: { $gte: new Date(now.getTime() - 12 * 3600000) },
      booking_status: { $ne: 'cancelled' }, showed: { $ne: false } })
      .select('lead_id bookingDate bookingTime appointment_type booking_status').sort({ bookingDate: 1 }).limit(5).lean(),
    db.collection('scheduled_followups').find({ lead_id: { $in: ids }, status: 'pending', kind: { $in: FOLLOWUP_KINDS } })
      .project({ lead_id: 1, due_at: 1, to_channel: 1, kind: 1 }).sort({ due_at: 1 }).limit(1).toArray().catch(() => []),
  ]);
  const staffIds = calls.map((c) => c.assigned_to).filter((x) => x && mongoose.isValidObjectId(String(x)));
  const names = new Map((staffIds.length ? await User.find({ _id: { $in: staffIds } }).select('name').lean() : [])
    .map((u) => [String(u._id), u.name]));
  const day = (d) => new Date(d).toISOString();
  const out = [
    ...calls.map((c) => ({ kind: 'call', at: c.due_by ? day(c.due_by) : c.opened_at ? day(c.opened_at) : null, lead_id: String(c.lead_id),
      text: `Call the customer${c.phone ? ` at ${c.phone}` : ''}${c.reason ? ` - ${String(c.reason).replace(/_/g, ' ')}` : ''}`,
      who: names.get(String(c.assigned_to)) || null })),
    ...bookings.map((b) => ({ kind: 'appt', at: day(b.bookingDate), lead_id: String(b.lead_id),
      text: `${b.appointment_type === 'service' ? 'Service' : 'Sales'} appointment${b.bookingTime ? ` at ${b.bookingTime}` : ''}`
        + `${b.booking_status === 'confirmed' ? ' (confirmed)' : ''}`, who: null })),
    ...followups.map((f) => ({ kind: 'followup', at: f.due_at ? day(f.due_at) : null, lead_id: String(f.lead_id),
      text: `AI follow-up by ${f.to_channel === 'email' ? 'email' : 'text'}`, who: 'AI' })),
  ];
  return out.sort((a, b) => String(a.at || '9').localeCompare(String(b.at || '9'))).slice(0, 8);
}
