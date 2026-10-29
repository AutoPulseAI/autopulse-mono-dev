// The dashboard's appointment funnel (Betsy, 23 Oct 2026: "APPT SET BY AUTOPULSE, APPT SHOWED, APPT SOLD!!! NOT
// SHOWING IN DASHBOARD AT ALL"): counted from the bookings themselves, so an appointment stays counted whatever the
// lead's status becomes afterwards. Each step split by who made the appointment (Booking.created_by: the AI - or the
// customer on the booking page the AI sent - vs staff).
//   made       appointments created in the range
//   scheduled  appointments set for a day in the range (not cancelled)
//   showed     those of them the customer came to (marked shown, or the lead is now Visited / Sold / Unsold)
//   sold       leads with an appointment that staff moved to a Sold status in the range
import Booking from '../models/Booking.js';
import Lead from '../models/Lead.js';
import ActivityLog from '../models/ActivityLog.js';

const SOLD = ['Sold', 'Sold Pending', 'Sold Delivered'];
const CAME = ['Visited', 'Unsold', ...SOLD];

const byAi = (b) => b.created_by === 'ai' || b.created_by === 'customer';

function split(bookings) {
  const ai = bookings.filter(byAi).length;
  return { total: bookings.length, ai, staff: bookings.length - ai };
}

function latestPerLead(bookings) {
  const out = new Map();
  for (const b of bookings) {
    const prev = out.get(b.lead_id);
    if (!prev || String(b._id) > String(prev._id)) out.set(b.lead_id, b);
  }
  return [...out.values()];
}

// The leads behind the "showed" and "sold" steps, for the cards' lists (Betsy, 28 Oct 2026 meeting: a card's number
// and the list it opens must be the same appointments - "they shouldn't just disappear").
export async function funnelLeadIds({ dealerId, start, end, step }) {
  const dealer_id = String(dealerId);
  const range = start && end ? { $gte: start, $lte: end } : null;
  if (step === 'sold') {
    const logs = await ActivityLog.find({ dealer_id, action: 'status_changed', to: { $in: SOLD },
      ...(range ? { at: range } : {}) }).select('lead_id').lean();
    const ids = [...new Set(logs.map((r) => String(r.lead_id)))];
    const booked = ids.length ? await Booking.distinct('lead_id', { dealer_id, lead_id: { $in: ids } }) : [];
    return booked.map(String);
  }
  const scheduled = await Booking.find({ dealer_id, booking_status: { $ne: 'cancelled' },
    ...(range ? { bookingDate: range } : {}) }).select('lead_id showed booking_status').lean();
  const leadIds = [...new Set(scheduled.map((b) => b.lead_id))];
  const leads = leadIds.length ? await Lead.find({ _id: { $in: leadIds } }).select('fe_lead_status').lean() : [];
  const status = new Map(leads.map((l) => [String(l._id), l.fe_lead_status]));
  return [...new Set(scheduled.filter((b) => b.showed === true || b.booking_status === 'completed'
    || CAME.includes(status.get(b.lead_id))).map((b) => String(b.lead_id)))];
}

export async function appointmentFunnel({ dealerId, start, end }) {
  const dealer_id = String(dealerId);
  const range = start && end ? { $gte: start, $lte: end } : null;
  const made = await Booking.find({ dealer_id, ...(range ? { createdAt: range } : {}) })
    .select('lead_id created_by').lean();
  const scheduled = await Booking.find({ dealer_id, booking_status: { $ne: 'cancelled' },
    ...(range ? { bookingDate: range } : {}) }).select('lead_id created_by showed booking_status').lean();
  const scheduledLeads = [...new Set(scheduled.map((b) => b.lead_id))];
  const leads = scheduledLeads.length
    ? await Lead.find({ _id: { $in: scheduledLeads } }).select('fe_lead_status').lean() : [];
  const status = new Map(leads.map((l) => [String(l._id), l.fe_lead_status]));
  const showed = scheduled.filter((b) => b.showed === true || b.booking_status === 'completed'
    || CAME.includes(status.get(b.lead_id)));

  const soldLogs = await ActivityLog.find({ dealer_id, action: 'status_changed', to: { $in: SOLD },
    ...(range ? { at: range } : {}) }).select('lead_id').lean();
  const soldLeadIds = [...new Set(soldLogs.map((r) => String(r.lead_id)))];
  const soldBookings = soldLeadIds.length
    ? latestPerLead(await Booking.find({ dealer_id, lead_id: { $in: soldLeadIds } })
      .select('lead_id created_by').lean())
    : [];

  return {
    made: split(made),
    scheduled: split(scheduled),
    showed: split(showed),
    sold: split(soldBookings),
  };
}
