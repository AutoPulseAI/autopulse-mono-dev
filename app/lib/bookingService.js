// Appointment slots: opening hours + how many bookings a time slot takes
// (agentic-upsell MASTER_PLAN_4 stream C1). One check used by every path that
// books: staff (lead status "Appointment Booked", app/api/conversations/lead/
// status), the AI service and the customer booking page (app/api/booking).
//
// Per dealer, in `dealer_account_information` (the admin dealer form's object):
//   booking_max_per_slot   bookings one slot takes        (default 1)
//   booking_slot_minutes   slot length in minutes         (default 30)
//   weekly_availability    opening hours, as the form saves them
//                          ({monday: {active, start: "9:00 AM", end: "7:00 PM"}, ...})
// A dealer with no usable hours gets Monday-Saturday 9:00-18:00, the same
// default the AI service uses (agentic-upsell integrations/dealer_profile.py).
//
// Bookings are `Booking` documents: `bookingDate` is the dealer-local day at
// midnight, in UTC (moment.tz(date, dealerTz).startOf('day')), `bookingTime`
// "HH:MM" dealer-local. Cancelled bookings never count.
//
// Imports are relative so the BullMQ workers can use this module too.

import moment from 'moment-timezone';

export const DEFAULT_MAX_PER_SLOT = 1;
export const DEFAULT_SLOT_MINUTES = 30;
export const DEFAULT_TIMEZONE = 'America/New_York';
export const WEEKDAYS = Object.freeze(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);
export const ACTIVE_BOOKING_STATUSES = Object.freeze(['pending', 'confirmed', 'completed']);
const DEFAULT_OPEN = 9 * 60;
const DEFAULT_CLOSE = 18 * 60;

export function dealerTimezone(dealer) {
  const tz = dealer?.dealer_account_information?.time_zone;
  return tz && moment.tz.zone(tz) ? tz : DEFAULT_TIMEZONE;
}

export function capacitySettings(dealer) {
  const info = dealer?.dealer_account_information || {};
  const max = Number.parseInt(info.booking_max_per_slot, 10);
  const minutes = Number.parseInt(info.booking_slot_minutes, 10);
  return {
    maxPerSlot: Number.isFinite(max) && max > 0 ? max : DEFAULT_MAX_PER_SLOT,
    slotMinutes: Number.isFinite(minutes) && minutes >= 5 && minutes <= 240 ? minutes : DEFAULT_SLOT_MINUTES,
  };
}

// "9:00 AM", "9 am", "09:00", "18:30" -> minutes after midnight; else null.
export function parseTimeOfDay(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?\s*m?\.?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = (match[3] || '').toLowerCase();
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === 'p' ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }
  return hour * 60 + minute;
}

export function formatHHMM(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

// The booking time as the platform stores it ("HH:MM"), or null.
export function normalizeBookingTime(value) {
  const minutes = parseTimeOfDay(value);
  return minutes == null ? null : formatHHMM(minutes);
}

// Weekday (0 = Monday) -> {open, close} in minutes, or null when closed.
export function openingHours(dealer) {
  const weekly = dealer?.dealer_account_information?.weekly_availability;
  const fallback = WEEKDAYS.map((_, day) => (day < 6 ? { open: DEFAULT_OPEN, close: DEFAULT_CLOSE } : null));
  if (!weekly || typeof weekly !== 'object') return { hours: fallback, fromRecord: false };
  const hours = WEEKDAYS.map((name) => {
    const info = weekly[name];
    if (!info || typeof info !== 'object' || !info.active) return null;
    const open = parseTimeOfDay(info.start);
    const close = parseTimeOfDay(info.end);
    return open != null && close != null && open < close ? { open, close } : { open: DEFAULT_OPEN, close: DEFAULT_CLOSE };
  });
  if (!hours.some(Boolean)) return { hours: fallback, fromRecord: false };
  return { hours, fromRecord: true };
}

// The dealer-local day at midnight, in UTC: what Booking.bookingDate holds.
export function bookingDayUtc(date, tz) {
  const local = moment.tz(String(date), 'YYYY-MM-DD', true, tz);
  return local.isValid() ? local.startOf('day').utc().toDate() : null;
}

export function slotOf(minutes, slotMinutes) {
  return Math.floor(minutes / slotMinutes) * slotMinutes;
}

// Pure: is `time` on `date` bookable, given the other active bookings that day?
// Returns {ok, reason?, message?, slot, taken, max}. reason: invalid_date,
// invalid_time, in_past, closed_day, outside_hours, slot_full.
export function checkSlot({ dealer, date, time, sameDayBookings = [], now = new Date(), allowPast = false }) {
  const tz = dealerTimezone(dealer);
  const { maxPerSlot, slotMinutes } = capacitySettings(dealer);
  const day = moment.tz(String(date || ''), 'YYYY-MM-DD', true, tz);
  if (!day.isValid()) return { ok: false, reason: 'invalid_date', message: 'bookingDate must be YYYY-MM-DD' };
  const minutes = parseTimeOfDay(time);
  if (minutes == null) return { ok: false, reason: 'invalid_time', message: 'bookingTime must be a time like 14:30 or 2:30 PM' };
  const slot = slotOf(minutes, slotMinutes);
  const base = { slot: formatHHMM(slot), slot_minutes: slotMinutes, max: maxPerSlot, timezone: tz };
  const startsAt = day.clone().startOf('day').add(minutes, 'minutes');
  if (!allowPast && startsAt.isBefore(moment(now))) {
    return { ...base, ok: false, reason: 'in_past', message: `${date} ${formatHHMM(minutes)} (${tz}) has already passed` };
  }
  const weekday = (day.isoWeekday() + 6) % 7;
  const hours = openingHours(dealer).hours[weekday];
  if (!hours) {
    return { ...base, ok: false, reason: 'closed_day', message: `The dealership is closed on ${WEEKDAYS[weekday]}s` };
  }
  if (minutes < hours.open || minutes >= hours.close) {
    return { ...base, ok: false, reason: 'outside_hours',
      message: `Outside opening hours (${formatHHMM(hours.open)}-${formatHHMM(hours.close)} on ${WEEKDAYS[weekday]})` };
  }
  const taken = sameDayBookings.filter((b) => {
    const m = parseTimeOfDay(b.bookingTime);
    return m != null && slotOf(m, slotMinutes) === slot;
  }).length;
  if (taken >= maxPerSlot) {
    return { ...base, ok: false, taken, reason: 'slot_full',
      message: `The ${formatHHMM(slot)} slot on ${date} is already taken (${taken}/${maxPerSlot})` };
  }
  return { ...base, ok: true, taken };
}

// Pure: every slot of `date` with how many bookings it has (for GET availability).
export function slotsForDay({ dealer, date, sameDayBookings = [], now = new Date() }) {
  const tz = dealerTimezone(dealer);
  const { maxPerSlot, slotMinutes } = capacitySettings(dealer);
  const day = moment.tz(String(date || ''), 'YYYY-MM-DD', true, tz);
  if (!day.isValid()) return [];
  const hours = openingHours(dealer).hours[(day.isoWeekday() + 6) % 7];
  if (!hours) return [];
  const slots = [];
  for (let start = slotOf(hours.open, slotMinutes); start < hours.close; start += slotMinutes) {
    if (start < hours.open) continue;
    const taken = sameDayBookings.filter((b) => {
      const m = parseTimeOfDay(b.bookingTime);
      return m != null && slotOf(m, slotMinutes) === start;
    }).length;
    const past = day.clone().startOf('day').add(start, 'minutes').isBefore(moment(now));
    slots.push({ time: formatHHMM(start), taken, max: maxPerSlot, available: !past && taken < maxPerSlot });
  }
  return slots;
}

// The dealer's other active bookings on that day.
export async function sameDayBookings(Booking, { dealerId, date, tz, excludeBookingId = null }) {
  const day = bookingDayUtc(date, tz);
  if (!day) return [];
  const filter = { dealer_id: String(dealerId), bookingDate: day, booking_status: { $in: ACTIVE_BOOKING_STATUSES } };
  if (excludeBookingId) filter._id = { $ne: excludeBookingId };
  return Booking.find(filter).select('_id lead_id bookingTime booking_status').sort({ _id: 1 }).lean();
}

// The DB check every booking path calls before writing.
export async function checkBookingSlot(Booking, {
  dealer, date, time, excludeBookingId = null, now = new Date(), allowPast = false,
}) {
  const bookings = await sameDayBookings(Booking, {
    dealerId: dealer._id, date, tz: dealerTimezone(dealer), excludeBookingId });
  return checkSlot({ dealer, date, time, sameDayBookings: bookings, now, allowPast });
}

// Two requests for the last place in a slot can both pass the check above.
// After writing, the slot's bookings are read back in creation order (ObjectId
// order); a booking beyond the slot's capacity lost the race and the caller
// removes it and answers 409. Returns true when `bookingId` keeps its place.
export async function keepsPlaceInSlot(Booking, { dealer, date, time, bookingId }) {
  const { maxPerSlot, slotMinutes } = capacitySettings(dealer);
  const minutes = parseTimeOfDay(time);
  if (minutes == null) return true;
  const slot = slotOf(minutes, slotMinutes);
  const bookings = await sameDayBookings(Booking, { dealerId: dealer._id, date, tz: dealerTimezone(dealer) });
  const inSlot = bookings.filter((b) => {
    const m = parseTimeOfDay(b.bookingTime);
    return m != null && slotOf(m, slotMinutes) === slot;
  });
  const rank = inSlot.findIndex((b) => String(b._id) === String(bookingId));
  return rank === -1 || rank < maxPerSlot;
}

// The HTTP answer for a failed check: 409 for a taken slot, 422 otherwise.
export function slotErrorResponseBody(check) {
  return {
    success: false,
    error: check.reason === 'slot_full' ? 'slot_taken' : check.reason,
    message: check.message,
    slot: check.slot ?? null,
    max_per_slot: check.max ?? null,
    timezone: check.timezone ?? null,
  };
}

export function slotErrorStatus(check) {
  return check.reason === 'slot_full' ? 409 : 422;
}

// Staff set the lead to Visited (showed = true) or No Show (false): recorded on
// the lead's latest active booking that isn't in the future (dealer-local day).
// Visited also completes it. Returns the updated fields, or null.
export async function markLeadBookingShowed(Booking, { leadId, dealer, showed, now = new Date() }) {
  const today = moment(now).tz(dealerTimezone(dealer)).startOf('day').utc().toDate();
  const booking = await Booking.findOne({
    lead_id: String(leadId), booking_status: { $in: ACTIVE_BOOKING_STATUSES }, bookingDate: { $lte: today },
  }).sort({ bookingDate: -1, _id: -1 }).lean();
  if (!booking) return null;
  const set = { showed: Boolean(showed), showed_at: now, ...(showed ? { booking_status: 'completed' } : {}) };
  await Booking.updateOne({ _id: booking._id }, { $set: set });
  return { _id: booking._id, ...set };
}

// Staff booked from the lead screen (status "Appointment Booked"): the lead's
// active Booking is moved to the new time, or one is created, so staff and AI
// bookings share one calendar (and one capacity check).
export async function upsertLeadBooking(Booking, { lead, dealer, date, time, createdBy = 'staff' }) {
  const day = bookingDayUtc(date, dealerTimezone(dealer));
  const bookingTime = normalizeBookingTime(time);
  if (!day || !bookingTime) return null;
  const existing = await Booking.findOne({ lead_id: String(lead._id), booking_status: { $in: ['pending', 'confirmed'] } })
    .sort({ _id: -1 });
  if (existing) {
    await Booking.updateOne({ _id: existing._id }, { $set: { bookingDate: day, bookingTime } });
    return { _id: existing._id, bookingDate: day, bookingTime, created: false };
  }
  const created = await Booking.create({
    dealer_id: String(lead.dealer_id), lead_id: String(lead._id), customerName: lead.name || 'Customer',
    email: lead.email || undefined, phone: lead.phone || undefined, bookingDate: day, bookingTime,
    created_by: createdBy,
  });
  return { _id: created._id, bookingDate: day, bookingTime, created: true };
}
