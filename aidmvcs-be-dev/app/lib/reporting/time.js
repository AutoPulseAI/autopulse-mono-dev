// Dealer-local days for reports (P1 plan items 1-3). Every report window is a range of the DEALER's calendar days
// (User.dealer_account_information.time_zone, default America/New_York - the same rule as
// app/lib/bookingService.js dealerTimezone() and app/api/leads/stats/route.js), turned into UTC instants for MongoDB.
//
// Imports are relative so BullMQ workers (the daily email) can load this module too.
import moment from 'moment-timezone';
import User from '../../models/User.js';
import { DEFAULT_TIMEZONE, dealerTimezone } from '../bookingService.js';

export { DEFAULT_TIMEZONE, dealerTimezone };

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

// The dealer's IANA time zone, read from the dealer account. Unknown dealer or bad zone -> the default.
export async function getDealerTimezone(dealerId, { UserModel = User } = {}) {
  if (!dealerId) return DEFAULT_TIMEZONE;
  let dealer = null;
  try {
    dealer = await UserModel.findById(String(dealerId)).select('dealer_account_information.time_zone').lean();
  } catch {
    dealer = null; // invalid id
  }
  return dealerTimezone(dealer);
}

export function isValidLocalDate(value) {
  return typeof value === 'string' && LOCAL_DATE.test(value) && moment.utc(value, 'YYYY-MM-DD', true).isValid();
}

// "YYYY-MM-DD" of an instant in `tz`.
export function localDate(at, tz = DEFAULT_TIMEZONE) {
  return moment(at).tz(tz).format('YYYY-MM-DD');
}

// A dealer-local date from a "YYYY-MM-DD" string (kept as is) or an instant (Date / ISO string with a time), read in
// `tz`. Returns null when the input can't be read.
export function toLocalDate(value, tz = DEFAULT_TIMEZONE) {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && LOCAL_DATE.test(value)) return isValidLocalDate(value) ? value : null;
  const m = moment(value instanceof Date ? value : new Date(value));
  return m.isValid() ? m.tz(tz).format('YYYY-MM-DD') : null;
}

// Local calendar days [from, to] (inclusive) -> { start, end } UTC Dates: start = `from` 00:00:00.000 local,
// end = `to` 23:59:59.999 local. DST days are 23 or 25 hours long and still one day.
export function localDayRange(from, to = from, tz = DEFAULT_TIMEZONE) {
  if (!isValidLocalDate(from) || !isValidLocalDate(to)) throw new RangeError('from/to must be YYYY-MM-DD');
  if (to < from) throw new RangeError('to is before from');
  return {
    start: moment.tz(from, 'YYYY-MM-DD', tz).startOf('day').toDate(),
    end: moment.tz(to, 'YYYY-MM-DD', tz).endOf('day').toDate(),
  };
}

// Whole calendar days from `earlier` to `later`, both read as local dates in `tz` (not 24-hour periods): a lead at
// 23:50 and a reply ten minutes later, after local midnight, is 1 day. Negative when `later` is on an earlier day.
export function calendarDayDiff(earlier, later, tz = DEFAULT_TIMEZONE) {
  const a = moment.utc(localDate(earlier, tz), 'YYYY-MM-DD');
  const b = moment.utc(localDate(later, tz), 'YYYY-MM-DD');
  return b.diff(a, 'days');
}

// The instant 24 hours after the end of the local day that contains `at`.
export function endOfLocalDayPlus(at, hours, tz = DEFAULT_TIMEZONE) {
  return moment(at).tz(tz).endOf('day').add(hours, 'hours').toDate();
}
