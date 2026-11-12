// Appointments report (SOW 8 Deliverable F, gap G-037; KPI dictionary A-F 3.4). Every number here counts bookings
// and lists bookings (app/lib/reporting/appointmentAttribution.js decides which bookings count and who made them).
import { BOOKING_COLUMNS, BOOKING_FILTERS, KIND, STATE, localDay, notYet, windowFor } from './common.js';
import { dmsRecordsInRange } from '../dealGross.js';
import {
  NOT_RECORDED_TEXT, NO_SHOW_TEXT, SHOWN_BASIS, SHOWN_TEXT, SHOW_RATE_DENOMINATOR, shared,
} from './executive.js';

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

// Booking history (recorded from 10 Nov 2026, P1 item 3): a move or cancel dated by when it happened.
const CHANGE_COLUMNS = Object.freeze([...BOOKING_COLUMNS, ['changed_by', 'Changed by'], ['changed_at', 'Changed on']]);
const changeKpi = (id, label, kind, numerator) => ({
  id, label, dashboard: D, grain: 'booking', kind: KIND.COUNT, dateBasis: 'the change time (Booking.history[].at)',
  numerator, denominator: null, inclusions: 'Any booking of the dealer, whenever it was set.',
  exclusions: 'Changes before 10 Nov 2026 (not recorded). A booking changed twice in the range counts once.',
  source: ['bookings'], filters: BOOKING_FILTERS, breakdowns: ['actor', 'department', 'lead_source'],
  columns: CHANGE_COLUMNS, evaluate: async (args, ctx) => ({ rows: await shared.apptChangeRows(args, ctx, kind) }),
});

export const APPOINTMENT_KPIS = [
  setKpi('appointments.set', 'Set', 'Every booking set in the range.', () => true, { trend: true }),
  setKpi('appointments.confirmed', 'Confirmed', 'Bookings set in the range whose status is now confirmed.',
    (r) => r.booking_status === 'confirmed', { inclusions: 'Booking.booking_status = confirmed. The AI\'s own '
      + 'per-lead confirmation (ai_lead_state.appointment.confirmed) is not used: it is per lead, not per booking.' }),
  setKpi('appointments.cancelled', 'Cancelled', 'Bookings set in the range whose status is now cancelled.',
    (r) => r.booking_status === 'cancelled', { inclusions: 'Booking.booking_status = cancelled (who cancelled: '
      + 'appointments.cancelled_by).' }),
  schedKpi('appointments.scheduled', 'Scheduled for these dates', 'Bookings on a day in the range, not cancelled.',
    (a, c) => shared.apptScheduledRows(a, c)),
  schedKpi('appointments.shown', 'Shown (recorded)', SHOWN_TEXT, (a, c) => shared.shownRows(a, c),
    { source: ['bookings', 'leads'], basedOn: SHOWN_BASIS }),
  schedKpi('appointments.no_show', 'No-show (marked)', NO_SHOW_TEXT, (a, c) => shared.noShowRows(a, c),
    { source: ['bookings', 'leads'], basedOn: `${SHOWN_BASIS} No-show: Booking.showed = false, written when staff `
      + 'record a no-show (app/lib/bookingService.js markLeadBookingShowed, app/api/booking).' }),
  schedKpi('appointments.not_recorded', 'No outcome recorded', NOT_RECORDED_TEXT,
    (a, c) => shared.notRecordedRows(a, c), { source: ['bookings', 'leads'], basedOn: SHOWN_BASIS }),
  schedKpi('appointments.upcoming', 'Still ahead', 'Appointments scheduled in the range whose date and time have not '
    + 'passed yet (dealer time zone), not cancelled, with no outcome recorded. Not in the show rate.',
  (a, c) => shared.upcomingRows(a, c), { source: ['bookings', 'leads'], basedOn: SHOWN_BASIS }),
  {
    id: 'appointments.show_rate', label: 'Show rate (recorded)', dashboard: D, grain: 'booking', kind: KIND.RATE, unit: '%',
    dateBasis: `${SCHED_BASIS} and Booking.bookingTime, dealer time zone`, numerator: 'Recorded shows (appointments.shown).',
    denominator: SHOW_RATE_DENOMINATOR, denominatorLabel: 'past appointments',
    inclusions: 'Appointments scheduled in the range whose time has passed, or already marked shown / no-show.',
    exclusions: `Cancelled; appointments still ahead (future). ${DUP}`, source: ['bookings', 'leads'],
    basedOn: SHOWN_BASIS, filters: BOOKING_FILTERS, columns: BOOKING_COLUMNS,
    evaluate: async (args, ctx) => ({ rows: await shared.shownRows(args, ctx),
      denominatorRows: await shared.dueRows(args, ctx) }),
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
  changeKpi('appointments.moved', 'Moved / rescheduled', 'rescheduled', 'Bookings whose day or time was changed in '
    + 'the range (one per booking), by who moved it.'),
  changeKpi('appointments.cancelled_by', 'Cancelled, by who', 'cancelled', 'Bookings cancelled in the range (one per '
    + 'booking), by who cancelled them.'),
  {
    id: 'appointments.dms_service', label: 'DMS service appointments', dashboard: D, grain: 'service_appointment',
    kind: KIND.COUNT, dateBasis: 'ServiceAppointment "Appointment Date"',
    numerator: 'Service appointments imported from the DMS, dated in the range.', denominator: null, exclusions: 'n/a',
    source: ['serviceappointments'], filters: [], breakdowns: [],
    columns: [['customer', 'Customer'], ['appointment', 'Appointment'], ['time', 'Time'], ['vehicle', 'Vehicle']],
    evaluate: async (args) => {
      const w = await windowFor(args);
      const appts = await dmsRecordsInRange('serviceappointments', args.dealerId, w, ['Appointment Date'],
        { 'Full Name': 1, 'Appointment Time': 1, Year: 1, Make: 1, Model: 1 });
      return { rows: appts.map((a) => ({ id: String(a._id), customer: a['Full Name'] || '', appointment: localDay(a._at, w.tz),
        time: a['Appointment Time'] || '', vehicle: [a.Year, a.Make, a.Model].filter(Boolean).join(' '),
        _day: localDay(a._at, w.tz), _g: {} })) };
    },
  },
];
