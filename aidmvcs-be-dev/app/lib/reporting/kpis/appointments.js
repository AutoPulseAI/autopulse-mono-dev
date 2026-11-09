// Appointments report (SOW 8 Deliverable F, gap G-037; KPI dictionary A-F 3.4). Every number here counts bookings
// and lists bookings (app/lib/reporting/appointmentAttribution.js decides which bookings count and who made them).
import { BOOKING_COLUMNS, BOOKING_FILTERS, KIND, STATE, notYet } from './common.js';
import { shared } from './executive.js';

const D = 'appointments';
const SET_BASIS = 'Booking.createdAt (the day it was set)';
const SCHED_BASIS = 'Booking.bookingDate (the appointment day)';
const DUP = 'Duplicate bookings (same lead, day and time, not cancelled: the lowest id counts).';

const setKpi = (id, label, numerator, pred, extra = {}) => ({
  id, label, dashboard: D, grain: 'booking', kind: KIND.COUNT, dateBasis: SET_BASIS, numerator, denominator: null,
  inclusions: 'Bookings of the dealer set in the range, any status unless stated.', exclusions: DUP,
  source: ['bookings', 'emails', 'leads'], filters: BOOKING_FILTERS, breakdowns: ['creator', 'department', 'lead_source'],
  columns: BOOKING_COLUMNS,
  evaluate: async (args, ctx) => ({ rows: (await shared.apptSetRows(args, ctx)).filter(pred) }),
  ...extra,
});

const schedKpi = (id, label, numerator, rowsFn, extra = {}) => ({
  id, label, dashboard: D, grain: 'booking', kind: KIND.COUNT, dateBasis: SCHED_BASIS, numerator, denominator: null,
  inclusions: 'Bookings whose appointment day is in the range.', exclusions: `Cancelled bookings. ${DUP}`,
  source: ['bookings'], filters: BOOKING_FILTERS, breakdowns: ['creator', 'department', 'lead_source'],
  columns: BOOKING_COLUMNS, evaluate: async (args, ctx) => ({ rows: await rowsFn(args, ctx) }), ...extra,
});

export const APPOINTMENT_KPIS = [
  setKpi('appointments.set', 'Set', 'Every booking set in the range.', () => true, { trend: true }),
  setKpi('appointments.confirmed', 'Confirmed', 'Bookings set in the range whose status is now confirmed.',
    (r) => r.booking_status === 'confirmed', { inclusions: 'Booking.booking_status = confirmed. The AI\'s own '
      + 'per-lead confirmation (ai_lead_state.appointment.confirmed) is not used: it is per lead, not per booking.' }),
  setKpi('appointments.cancelled', 'Cancelled', 'Bookings set in the range whose status is now cancelled.',
    (r) => r.booking_status === 'cancelled', { inclusions: 'Booking.booking_status = cancelled (who cancelled is not '
      + 'recorded).' }),
  schedKpi('appointments.scheduled', 'Scheduled for these dates', 'Bookings on a day in the range, not cancelled.',
    (a, c) => shared.apptScheduledRows(a, c)),
  schedKpi('appointments.shown', 'Shown', 'Scheduled bookings marked showed, or completed.',
    (a, c) => shared.shownRows(a, c)),
  schedKpi('appointments.no_show', 'No-show', 'Scheduled bookings marked not showed (Booking.showed = false).',
    (a, c) => shared.noShowRows(a, c)),
  schedKpi('appointments.no_outcome', 'No outcome recorded', 'Scheduled bookings with neither showed nor no-show '
    + 'recorded and not completed (includes appointments still ahead).',
  async (a, c) => (await shared.apptScheduledRows(a, c)).filter((r) => r.showed === ''
      && r.booking_status !== 'completed')),
  {
    id: 'appointments.show_rate', label: 'Show rate', dashboard: D, grain: 'booking', kind: KIND.RATE, unit: '%',
    dateBasis: SCHED_BASIS, numerator: 'Shown (appointments.shown).',
    denominator: 'Shown + no-show among the scheduled bookings (bookings without a recorded outcome are left out).',
    inclusions: 'Outcomes recorded on the booking.', exclusions: `Cancelled. ${DUP}`, source: ['bookings'],
    filters: BOOKING_FILTERS, columns: BOOKING_COLUMNS,
    evaluate: async (args, ctx) => {
      const shown = await shared.shownRows(args, ctx);
      return { rows: shown, denominatorRows: [...shown, ...await shared.noShowRows(args, ctx)] };
    },
  },
  setKpi('appointments.by_ai', 'Made by AI', 'Booking.created_by = ai.', (r) => r.made_by === 'AI'),
  setKpi('appointments.ai_assisted', 'AI-assisted', 'created_by = staff after the AI messaged the same lead '
    + '(an AI sms/email, not a note, sent or delivered, before the booking was created).',
  (r) => r.made_by === 'AI-assisted'),
  setKpi('appointments.human_only', 'Human only', 'created_by = staff with no AI message on the lead before it.',
    (r) => r.made_by === 'Human only'),
  setKpi('appointments.unknown_creator', 'Unknown creator', 'created_by missing (bookings before ~7 Oct 2026) or '
    + 'customer (the public booking page), or the lead is gone.', (r) => r.made_by === 'Unknown'),
  setKpi('appointments.ai_influenced', 'AI-influenced', 'Made by AI + AI-assisted (a subtotal).',
    (r) => r.made_by === 'AI' || r.made_by === 'AI-assisted'),
  setKpi('appointments.sales', 'Sales appointments', 'Bookings set in the range for sales (appointment_type sales, '
    + 'or none: older bookings count as sales).', (r) => r.appointment_type !== 'service'),
  setKpi('appointments.service', 'Service appointments', 'Bookings set in the range for service '
    + '(appointment_type service).', (r) => r.appointment_type === 'service'),
  notYet(STATE.NEEDS_DATA, {
    id: 'appointments.moved', label: 'Moved / rescheduled', dashboard: D, grain: 'booking', dateBasis: 'move time',
    numerator: 'Bookings whose day or time was changed after they were set.', denominator: null,
    exclusions: 'n/a', source: ['bookings'],
    reason: 'A move overwrites Booking.bookingDate in place; there is no booking history yet (P1 item 3 adds it).',
  }),
  notYet(STATE.NEEDS_DATA, {
    id: 'appointments.cancelled_by', label: 'Who cancelled', dashboard: D, grain: 'booking',
    dateBasis: 'cancel time', numerator: 'Cancelled bookings by who cancelled them.', denominator: null,
    exclusions: 'n/a', source: ['bookings'], reason: 'Bookings do not record who cancelled them yet (cancelled_by).',
  }),
  notYet(STATE.NEEDS_DATA, {
    id: 'appointments.dms_service', label: 'DMS service appointments', dashboard: D, grain: 'service_appointment',
    dateBasis: 'ServiceAppointment "Appointment Date"', numerator: 'Service appointments imported from the DMS.',
    denominator: null, exclusions: 'n/a', source: ['serviceappointments'],
    reason: 'DMS appointment dates are stored as text; a parsed date field is needed.',
  }),
];
