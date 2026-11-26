// The Desk Log's appointments for one day (18 Nov 2026: "if there are appointments set ... check in that customer
// really quick - either it was no show, either it was sold, either anything else, and our next workflow triggers").
//   GET ?dealer_id &day=YYYY-MM-DD (dealer-local, default today) [&department=sales|service]
//     -> { day, appointments: [{ booking_id, lead_id, name, phone, time, type, booked_by, status, lead_status,
//          lead_status_label, checked_in_at, visit_id }] }
// The same bookings as the Dashboard's "Appointments for Today" (scheduled that day, not cancelled). Checking one in
// is the Desk Log check-in; any other status (No Show, Appointment Booked to move it, ...) goes through the lead's
// status route, so its workflows run as from the Leads page.
import moment from 'moment-timezone';
import mongoose from 'mongoose';
import Booking from '@models/Booking';
import Lead from '@models/Lead';
import DeskLogEntry from '@models/DeskLogEntry';
import { deskLogAccess, json } from '@lib/deskLog/access';
import { dealerForms } from '@lib/reporting/kpis/common';
import { getDealerTimezone, isValidLocalDate } from '@lib/reporting/time';
import { departmentMatch } from '@lib/departmentNames';
import { leadStatusLabel } from '@lib/statusLabels';

const BOOKED_BY = { ai: 'AI', staff: 'Staff', customer: 'Customer' };

export async function GET(req) {
  const params = new URL(req.url).searchParams;
  const dealerId = params.get('dealer_id');
  const access = await deskLogAccess(req, dealerId);
  if (access.response) return access.response;
  try {
    const tz = await getDealerTimezone(dealerId);
    const day = params.get('day') || moment.tz(tz).format('YYYY-MM-DD');
    if (!isValidLocalDate(day)) return json({ message: 'day must be YYYY-MM-DD' }, 400);
    const start = moment.tz(day, 'YYYY-MM-DD', tz).startOf('day');
    const bookings = await Booking.find({ dealer_id: { $in: dealerForms(dealerId) }, booking_status: { $ne: 'cancelled' },
      bookingDate: { $gte: start.clone().utc().toDate(), $lt: start.clone().add(1, 'day').utc().toDate() } })
      .select('lead_id bookingTime booking_status showed appointment_type created_by created_by_name').lean();
    const ids = [...new Set(bookings.map((b) => String(b.lead_id)))].filter((id) => mongoose.isValidObjectId(id));
    // The Department filter is the lead's department, as on the Dashboard and the cards.
    const dept = departmentMatch(params.get('department'));
    const leads = new Map((ids.length ? await Lead.find({ _id: { $in: ids }, dealer_id: { $in: dealerForms(dealerId) },
      ...(dept || {}) }).select('name phone email fe_lead_status appointment_showed_at department manager_outcome customer_id').lean() : [])
      .map((l) => [String(l._id), l]));
    const visits = new Map((ids.length ? await DeskLogEntry.find({ lead_id: { $in: ids },
      checked_in_at: { $gte: start.clone().utc().toDate(), $lt: start.clone().add(1, 'day').utc().toDate() } })
      .sort({ checked_in_at: 1 }).select('lead_id checked_in_at').lean() : []).map((v) => [String(v.lead_id), v]));
    const appointments = bookings.filter((b) => leads.has(String(b.lead_id))).map((b) => {
      const lead = leads.get(String(b.lead_id));
      const visit = visits.get(String(b.lead_id));
      const status = visit ? 'checked_in' : b.showed === true || b.booking_status === 'completed' ? 'showed'
        : b.showed === false || lead.fe_lead_status === 'No Show' ? 'no_show' : 'waiting';
      return { booking_id: String(b._id), lead_id: String(b.lead_id), customer_id: lead.customer_id ? String(lead.customer_id) : null, name: lead.name || '', phone: lead.phone || '',
        email: lead.email || '', time: b.bookingTime, type: b.appointment_type === 'service' ? 'Service' : 'Sales',
        booked_by: b.created_by_name || BOOKED_BY[b.created_by] || null, status, lead_status: lead.fe_lead_status || null,
        lead_status_label: leadStatusLabel(lead) || null, checked_in_at: visit?.checked_in_at || null,
        visit_id: visit ? String(visit._id) : null };
    }).sort((a, b) => String(a.time).localeCompare(String(b.time)));
    return json({ day, appointments });
  } catch (error) {
    console.error('desk-log appointments failed:', error?.message);
    return json({ message: 'Could not load the appointments' }, 500);
  }
}
