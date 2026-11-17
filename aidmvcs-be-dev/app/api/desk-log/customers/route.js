// Customer search for checking someone in on the Desk Log: ?dealer_id &q (name, phone, email, lead id).
// -> { customers: [{ customer_id, name, phone, email, default_lead_id, leads: [...] }], leads: [...] }
// One customer can have several leads (17 Nov 2026: "which lead is going to be checked in?"), so the matches are
// grouped by customer, each with ALL its leads (also the ones the search text didn't match), and the lead the
// check-in goes on by default:
//   1. the lead with an appointment today (dealer time) - the check-in then marks that appointment Showed;
//   2. else the newest open lead (not sold / closed / opted out);
//   3. else the newest lead.
// Staff can pick another of the customer's leads in the check-in. `leads` (flat) is kept for older callers.
import moment from 'moment-timezone';
import Lead from '@models/Lead';
import Booking from '@models/Booking';
import User from '@models/User';
import { deskLogAccess, json } from '@lib/deskLog/access';
import { dealerForms } from '@lib/reporting/kpis/common';
import { normalizeProvider } from '@lib/reporting/normalize';
import { upType } from '@lib/reporting/sourcePerformance';
import { ACTIVE_BOOKING_STATUSES, dealerTimezone } from '@lib/bookingService';
import { leadStatusLabel } from '@lib/statusLabels';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CLOSED = Object.freeze(['Closed - Lost', 'Closed - No Longer Owns', 'Sold', 'Sold Delivered', 'DND']);
const FIELDS = 'name phone email createdAt lead_source source contact_type fe_lead_status lead_status status customer_id department '
  + 'vehicle_year vehicle_make vehicle_model appointment_showed_at booking.booking_at';

export async function GET(req) {
  const params = new URL(req.url).searchParams;
  const dealerId = params.get('dealer_id');
  const access = await deskLogAccess(req, dealerId);
  if (access.response) return access.response;
  const q = (params.get('q') || '').trim().slice(0, 80);
  if (q.length < 2) return json({ customers: [], leads: [] });
  const digits = q.replace(/\D/g, '');
  const or = [...(/^[0-9a-f]{24}$/i.test(q) ? [{ _id: q }] : []), { name: new RegExp(escape(q), 'i') }, { email: new RegExp(escape(q), 'i') }];
  if (digits.length >= 4) or.push({ phone: new RegExp(digits.split('').map(escape).join('\\D*')) });
  const dealer = { dealer_id: { $in: dealerForms(dealerId) } };
  const hits = await Lead.find({ ...dealer, $or: or }).select(FIELDS).sort({ createdAt: -1 }).limit(10).lean();

  // Every lead of the customers found, not only the ones the text matched.
  const customerIds = [...new Set(hits.map((l) => l.customer_id).filter(Boolean).map(String))];
  const siblings = customerIds.length ? await Lead.find({ ...dealer, customer_id: { $in: customerIds } })
    .select(FIELDS).sort({ createdAt: -1 }).limit(100).lean() : [];
  const byId = new Map([...hits, ...siblings].map((l) => [String(l._id), l]));
  const all = [...byId.values()];

  // Which of them have an appointment today (dealer time).
  const dealerDoc = await User.findById(dealerId).select('dealer_account_information').lean().catch(() => null);
  const start = moment().tz(dealerTimezone(dealerDoc)).startOf('day');
  const booked = await Booking.find({ lead_id: { $in: all.map((l) => String(l._id)) }, booking_status: { $in: ACTIVE_BOOKING_STATUSES },
    bookingDate: { $gte: start.clone().utc().toDate(), $lt: start.clone().add(1, 'day').utc().toDate() } })
    .select('lead_id bookingTime bookingDate').lean();
  const apptToday = new Map(booked.map((b) => [String(b.lead_id), b.bookingTime || 'today']));

  const row = (l) => {
    const status = l.fe_lead_status || l.lead_status || l.status || null;
    return { id: String(l._id), customer_id: l.customer_id ? String(l.customer_id) : null, name: l.name || '',
      phone: l.phone || '', email: l.email || '', created_at: l.createdAt, source: normalizeProvider(l.lead_source, l.source),
      lead_type: upType(l), status, status_label: leadStatusLabel(l), open: !CLOSED.includes(status),
      appointment_today: apptToday.has(String(l._id)) ? apptToday.get(String(l._id)) : null,
      vehicle: [l.vehicle_year, l.vehicle_make, l.vehicle_model].filter(Boolean).join(' '),
      department: ['service', 'parts'].includes(l.department) ? l.department : 'sales' };
  };

  // Grouped by customer, in the order the search found them (a lead with no customer is its own group).
  const groups = new Map();
  for (const hit of hits) {
    const key = hit.customer_id ? String(hit.customer_id) : `lead:${hit._id}`;
    if (groups.has(key)) continue;
    const leads = (hit.customer_id ? all.filter((l) => String(l.customer_id) === String(hit.customer_id)) : [hit])
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(row);
    const pick = leads.find((l) => l.appointment_today) || leads.find((l) => l.open) || leads[0];
    const top = leads[0];
    groups.set(key, { customer_id: hit.customer_id ? String(hit.customer_id) : null, name: pick.name || top.name,
      phone: pick.phone || top.phone, email: pick.email || top.email, default_lead_id: pick.id, leads });
  }
  return json({ customers: [...groups.values()], leads: hits.map(row) });
}
