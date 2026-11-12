// The staff task list's own queues (SOW Deliverable D, gaps G-025 / G-028), read only. The calls to make and the
// leads that need a person come from the AI service (call tasks, alerts) and are read by the page from their
// existing APIs; these are the CRM's own:
//   unconfirmed   today's appointments (dealer-local day) the customer hasn't confirmed (Not confirmed / Tentative)
//   no_shows      leads at "No Show" whose status changed in the last 14 days - to win back
//   no_next_action leads at "Contacted - No Next Action", quietest first (days since the last message either way)
// Staff with "View Assigned Leads" only get their own leads (onlyUserId), like every other list.
import mongoose from 'mongoose';
import moment from 'moment-timezone';
import Lead from '../models/Lead.js';
import User from '../models/User.js';
import Email from '../models/Email.js';
import Booking from '../models/Booking.js';
import { sameDayBookings, dealerTimezone } from './bookingService.js';
import { confirmationForLeads } from './bookingCreator.js';
import { AI_LEAD_STATE_COLLECTION } from './ai/aiStage.js';

const LIMIT = 100;
const NO_SHOW_DAYS = 14;
const LEAD_FIELDS = 'name phone email fe_lead_status assigned_to statusChangedAt updatedAt createdAt vehicle_year vehicle_make vehicle_model';

async function lastMessageAt(ids) {
  if (!ids.length) return new Map();
  const rows = await Email.aggregate([
    { $match: { lead_id: { $in: [...ids, ...ids.map(String)] }, is_note: { $ne: true }, is_lead_email: { $ne: true } } },
    { $group: { _id: { $toString: '$lead_id' }, at: { $max: '$timestamp' } } },
  ]);
  return new Map(rows.map((r) => [r._id, r.at]));
}

export async function staffTaskQueues(dealerId, { onlyUserId = null, now = new Date(),
  states = mongoose.connection.collection(AI_LEAD_STATE_COLLECTION) } = {}) {
  const dealer = await User.findById(dealerId).select('dealer_account_information').lean();
  const tz = dealerTimezone(dealer);
  const today = moment(now).tz(tz).format('YYYY-MM-DD');
  const mine = onlyUserId ? { assigned_to: new mongoose.Types.ObjectId(String(onlyUserId)) } : {};

  // Today's appointments not confirmed yet.
  const todays = await sameDayBookings(Booking, { dealerId, date: today, tz });
  const confirmation = await confirmationForLeads(todays.map((b) => b.lead_id));
  const openIds = todays.filter((b) => confirmation.get(String(b.lead_id)) !== 'confirmed')
    .map((b) => b.lead_id).filter((id) => mongoose.isValidObjectId(id));

  const [apptLeads, noShows, noNext] = await Promise.all([
    Lead.find({ _id: { $in: openIds }, dealer_id: String(dealerId), ...mine }).select(LEAD_FIELDS).lean(),
    Lead.find({ dealer_id: String(dealerId), fe_lead_status: /^no\s*show$/i, ...mine,
      $or: [{ statusChangedAt: { $gte: new Date(now.getTime() - NO_SHOW_DAYS * 864e5) } },
        { statusChangedAt: { $exists: false }, updatedAt: { $gte: new Date(now.getTime() - NO_SHOW_DAYS * 864e5) } }] })
      .select(LEAD_FIELDS).sort({ statusChangedAt: -1 }).limit(LIMIT).lean(),
    Lead.find({ dealer_id: String(dealerId), fe_lead_status: /^contacted\s*-\s*no next action$/i, ...mine })
      .select(LEAD_FIELDS).limit(500).lean(),
  ]);

  const all = [...apptLeads, ...noShows, ...noNext];
  const ids = [...new Set(all.map((l) => String(l._id)))];
  const oids = ids.map((id) => new mongoose.Types.ObjectId(id));
  const [last, owners, aiStates] = await Promise.all([
    lastMessageAt(oids),
    User.find({ _id: { $in: [...new Set(all.map((l) => l.assigned_to && String(l.assigned_to)).filter(Boolean))] } })
      .select('name').lean(),
    states.find({ lead_id: { $in: ids } }).project({ lead_id: 1, status: 1 }).toArray(),
  ]);
  const ownerName = new Map(owners.map((u) => [String(u._id), u.name]));
  const aiStatus = new Map(aiStates.map((s) => [String(s.lead_id), s.status]));
  const row = (l, extra = {}) => {
    const id = String(l._id);
    const lastAt = last.get(id) || null;
    return {
      lead_id: id, name: l.name || null, phone: l.phone || null, status: l.fe_lead_status || null,
      vehicle: [l.vehicle_year, l.vehicle_make, l.vehicle_model].filter(Boolean).join(' ') || null,
      owner_id: l.assigned_to ? String(l.assigned_to) : null, owner: l.assigned_to ? ownerName.get(String(l.assigned_to)) || null : null,
      since: l.statusChangedAt || l.updatedAt || l.createdAt || null, last_message_at: lastAt,
      quiet_days: lastAt ? Math.floor((now - new Date(lastAt)) / 864e5) : null,
      ai: aiStatus.get(id) || null, ...extra,
    };
  };

  const timeOf = new Map(todays.map((b) => [String(b.lead_id), b.bookingTime]));
  const minutes = (t) => { const m = moment(String(t || ''), ['h:mm A', 'HH:mm']); return m.isValid() ? m.hours() * 60 + m.minutes() : null; };
  const nowMin = moment(now).tz(tz).hours() * 60 + moment(now).tz(tz).minutes();
  const unconfirmed = apptLeads.map((l) => {
    const time = timeOf.get(String(l._id)) || null;
    const at = minutes(time);
    return row(l, { appointment_time: time, confirmation: confirmation.get(String(l._id)) || 'not_confirmed',
      overdue: at != null && at < nowMin });
  }).sort((a, b) => (minutes(a.appointment_time) ?? 9999) - (minutes(b.appointment_time) ?? 9999));

  return {
    timezone: tz, today,
    unconfirmed,
    no_shows: noShows.map((l) => row(l)),
    no_next_action: noNext.map((l) => row(l))
      .sort((a, b) => (b.quiet_days ?? 9999) - (a.quiet_days ?? 9999)).slice(0, LIMIT),
    no_next_action_total: noNext.length,
  };
}
