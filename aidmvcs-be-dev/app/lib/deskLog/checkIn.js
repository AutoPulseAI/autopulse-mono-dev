// A Desk Log check-in is connected to the rest of the CRM (13 Nov 2026 meeting: Abdul's appointment for today was
// checked in on the Desk Log and the lead still said "Appointment booked" - Betsy: "it would need to show as shown").
// When a customer is checked in:
//   - their appointment for that day is marked showed (Booking: showed, completed, with its history line), so the
//     Appointments page, the "Appointments Showed" card and the show numbers count it;
//   - the lead remembers it (appointment_showed_at), and every screen shows its status as "Appointment Showed" until a
//     manager outcome (Sold / Unsold) replaces it (app/lib/statusLabels.js leadStatusLabel);
//   - the customer timeline gets the visit;
//   - the AI is told the customer is in the showroom (the same "Visited" event the status screen sends), so it stops
//     the lead's appointment and follow-up messages until a manager outcome - no "I am looking for you in the
//     showroom" text to a customer who is standing in it.
// Never throws: the check-in itself always stands; a step that fails is logged.
import moment from 'moment-timezone';
import Booking from '../../models/Booking.js';
import Lead from '../../models/Lead.js';
import User from '../../models/User.js';
import { ACTIVE_BOOKING_STATUSES, dealerTimezone, historyEntry, historyPush, writeWithHistory } from '../bookingService.js';
import { notifyAiOfStaffStatus } from '../ai/aiStaff.js';
import { logActivity } from '../activityLog.js';

/** The lead's appointment on the dealer-local day of `at` that is not cancelled, or null. */
export async function appointmentOnDay(leadId, tz, at) {
  const start = moment(at).tz(tz).startOf('day');
  return Booking.findOne({ lead_id: String(leadId), booking_status: { $in: ACTIVE_BOOKING_STATUSES },
    bookingDate: { $gte: start.clone().utc().toDate(), $lt: start.clone().add(1, 'day').utc().toDate() } })
    .sort({ bookingDate: 1, _id: 1 }).lean();
}

/** Marks a booking showed (completed), with who did it in its history. Returns true when it changed. */
export async function markShowed(booking, { actor, at = new Date(), via = 'desk_log' }) {
  if (!booking || (booking.showed === true && booking.booking_status === 'completed')) return false;
  const statusChanged = booking.booking_status !== 'completed';
  const base = { $set: { showed: true, showed_at: at, booking_status: 'completed', ...(statusChanged ? { statusChangedAt: at } : {}) } };
  const extra = { $push: historyPush(historyEntry({ action: 'showed', at, actor, via,
    ...(statusChanged ? { from: { booking_status: booking.booking_status }, to: { booking_status: 'completed' } } : {}) })) };
  await writeWithHistory((u) => Booking.updateOne({ _id: booking._id }, u), base, extra, { label: 'showed' });
  return true;
}

/**
 * Everything a check-in changes outside the Desk Log. `lead` needs _id, customer_id, fe_lead_status.
 * @returns {Promise<{ appointment: null | { id, showed: boolean } }>}
 */
// A visit the AI is not told about: a service visit, or a lead already sold / closed / opted out (its own lifecycle
// - the owner follow-ups - must not be stopped by a showroom visit).
const NO_AI_VISIT = Object.freeze(['Sold', 'Sold Pending', 'Sold Delivered', 'Closed - No Longer Owns', 'DND']);

export async function recordShowroomVisit({ lead, dealerId, user, checkedIn, department = 'sales', logger = console }) {
  const out = { appointment: null };
  const actor = { type: 'staff', id: user?._id ? String(user._id) : null, name: user?.name || user?.email || null };
  try {
    const dealer = await User.findById(dealerId).select('dealer_account_information').lean();
    const tz = dealerTimezone(dealer);
    const booking = await appointmentOnDay(lead._id, tz, checkedIn);
    if (booking) {
      const changed = await markShowed(booking, { actor, at: checkedIn });
      out.appointment = { id: String(booking._id), showed: true, changed };
      await Lead.updateOne({ _id: lead._id }, { $set: { appointment_showed_at: checkedIn, appointment_showed_booking: booking._id } });
    }
  } catch (error) {
    logger.error?.('[desk-log] could not mark the appointment showed', { lead: String(lead._id), error: error?.message });
  }
  await logActivity({ dealer_id: dealerId, customer_id: lead.customer_id || null, lead_id: lead._id,
    action: 'showroom_check_in', actor_type: 'staff', actor_id: user?._id || null, actor_name: actor.name,
    detail: out.appointment ? 'Checked in on the Desk Log - appointment showed' : 'Checked in on the Desk Log (walk-in)' });
  if (department === 'service' || NO_AI_VISIT.includes(lead.fe_lead_status)) return out;
  try {
    await notifyAiOfStaffStatus({ leadId: String(lead._id), dealerId: String(dealerId), status: 'Visited' });
  } catch (error) {
    logger.error?.('[desk-log] could not tell the AI about the visit', { lead: String(lead._id), error: error?.message });
  }
  return out;
}
