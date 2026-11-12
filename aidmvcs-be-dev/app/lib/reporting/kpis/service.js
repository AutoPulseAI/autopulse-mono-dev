// Service retention report (SOW 8 Deliverable F, gap G-038; KPI dictionary A-F 3.5). The customer and vehicle
// segments are written by the AI service (agentic-upsell agent/ownership.py, agent/service_events.py) into the same
// database; the CRM only reads them. They are current states, not events, so the date range doesn't apply to them.
import Customer from '../../../models/Customer.js';
import {
  BOOKING_COLUMNS, BOOKING_FILTERS, KIND, STATE, collection, dealerForms, isOid, localDateTime, localDay, memo,
  notYet, oid, windowFor,
} from './common.js';
import { shared } from './executive.js';
import { dealDate } from '../dealGross.js';

const D = 'service';
const CURRENT = 'Current state (the date range does not apply)';

async function customerNames(ids) {
  const want = [...new Set(ids.filter(isOid).map(String))];
  if (!want.length) return new Map();
  const docs = await Customer.collection.find({ _id: { $in: want.map(oid) } }, { projection: { name: 1 } }).toArray();
  return new Map(docs.map((c) => [String(c._id), c.name || '']));
}

async function customerStatusRows(args, ctx, status) {
  return memo(ctx, `customer_status:${status}`, async () => {
    const w = await windowFor(args);
    const docs = await collection('ai_customer_status').find({ dealer_id: { $in: dealerForms(args.dealerId) },
      customer_status: status }).sort({ customer_id: 1 }).toArray();
    const names = await customerNames(docs.map((d) => d.customer_id));
    const seen = new Set();
    return docs.filter((d) => d.customer_id && !seen.has(String(d.customer_id)) && seen.add(String(d.customer_id)))
      .map((d) => ({
        id: String(d.customer_id), customer_id: String(d.customer_id), customer: names.get(String(d.customer_id)) || '',
        status: d.customer_status, why: d.customer_status_reason || '',
        open_leads: d.open_opportunity_count ?? '', owned_vehicles: d.active_owned_vehicle_count ?? '',
        changed_at: localDateTime(d.customer_status_changed_at, w.tz), _g: {},
      }));
  });
}

const STATUS_COLUMNS = [['customer_id', 'Customer ID'], ['customer', 'Customer'], ['status', 'Status'], ['why', 'Why'],
  ['open_leads', 'Open leads'], ['owned_vehicles', 'Owned vehicles'], ['changed_at', 'Status changed']];

export const SERVICE_KPIS = [
  {
    id: 'service.active_customers', label: 'Active customers', dashboard: D, grain: 'customer', kind: KIND.COUNT,
    dateBasis: CURRENT, numerator: 'Customers whose AI ownership status is ACTIVE (ai_customer_status).',
    denominator: null, inclusions: 'ACTIVE: an open lead or a confirmed owned vehicle (agentic-upsell '
      + 'agent/ownership.py).', exclusions: 'Customers the AI has not assessed yet.',
    source: ['ai_customer_status', 'customers'], filters: [], columns: STATUS_COLUMNS,
    evaluate: async (args, ctx) => ({ rows: await customerStatusRows(args, ctx, 'ACTIVE') }),
  },
  {
    id: 'service.inactive_customers', label: 'Inactive customers', dashboard: D, grain: 'customer', kind: KIND.COUNT,
    dateBasis: CURRENT, numerator: 'Customers whose AI ownership status is INACTIVE.', denominator: null,
    inclusions: 'INACTIVE: no open lead and no owned vehicle.', exclusions: 'Customers not assessed yet.',
    source: ['ai_customer_status', 'customers'], filters: [], columns: STATUS_COLUMNS,
    evaluate: async (args, ctx) => ({ rows: await customerStatusRows(args, ctx, 'INACTIVE') }),
  },
  {
    id: 'service.vehicles_on_file', label: 'Customers with a vehicle on file', dashboard: D, grain: 'customer',
    kind: KIND.COUNT, dateBasis: CURRENT,
    numerator: 'Distinct customers with at least one ACTIVE vehicle ownership record (ai_vehicle_ownership).',
    denominator: null, inclusions: 'ownership_status ACTIVE.', exclusions: 'NO_LONGER_OWNED vehicles.',
    source: ['ai_vehicle_ownership', 'customers'], filters: [],
    columns: [['customer_id', 'Customer ID'], ['customer', 'Customer'], ['vehicles', 'Active vehicles'],
      ['vins', 'VINs']],
    evaluate: async (args) => {
      const docs = await collection('ai_vehicle_ownership').find({ dealer_id: { $in: dealerForms(args.dealerId) },
        ownership_status: 'ACTIVE', customer_id: { $nin: [null, ''] } },
      { projection: { customer_id: 1, vin: 1 } }).toArray();
      const by = new Map();
      for (const d of docs) {
        const k = String(d.customer_id);
        if (!by.has(k)) by.set(k, []);
        by.get(k).push(d.vin || '');
      }
      const names = await customerNames([...by.keys()]);
      return { rows: [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, vins]) => ({
        id, customer_id: id, customer: names.get(id) || '', vehicles: vins.length, vins: vins.filter(Boolean).join(' '),
        _g: {} })) };
    },
  },
  {
    id: 'service.reminders_sent', label: 'Service outreach raised', dashboard: D, grain: 'service_event',
    kind: KIND.COUNT, dateBasis: 'ai_service_events.created_at',
    numerator: 'Customer-facing service events (recall / maintenance outreach) the AI raised in the range.',
    denominator: null, inclusions: 'customer_facing = true, any status (queued / skipped / error shown in the list).',
    exclusions: 'Staff-only notices.', source: ['ai_service_events'], filters: [], breakdowns: ['event_type', 'status'],
    columns: [['event_id', 'Event ID'], ['type', 'Type'], ['vin', 'VIN'], ['vehicle', 'Vehicle'],
      ['customer_id', 'Customer ID'], ['lead_id', 'Lead ID'], ['status', 'Status'], ['created_at', 'Raised']],
    evaluate: async (args) => {
      const w = await windowFor(args);
      const docs = await collection('ai_service_events').find({ dealer_id: { $in: dealerForms(args.dealerId) },
        customer_facing: true, created_at: { $gte: w.start, $lte: w.end } }).sort({ created_at: 1, _id: 1 }).toArray();
      return { rows: docs.map((d) => ({
        id: String(d._id), event_id: String(d._id), type: d.type || '', vin: d.vin || '',
        vehicle: [d.vehicle?.year, d.vehicle?.make, d.vehicle?.model].filter(Boolean).join(' '),
        customer_id: d.customer_id ? String(d.customer_id) : '', lead_id: d.lead_id ? String(d.lead_id) : '',
        status: d.status || '', created_at: localDateTime(d.created_at, w.tz), _day: localDay(d.created_at, w.tz),
        _g: { event_type: d.type || 'unknown', status: d.status || 'unknown' },
      })) };
    },
  },
  {
    id: 'service.appointments_set', label: 'Service appointments set', dashboard: D, grain: 'booking',
    kind: KIND.COUNT, dateBasis: 'Booking.createdAt',
    numerator: 'Bookings set in the range with appointment_type service.', denominator: null,
    inclusions: 'Any status.', exclusions: 'Duplicate bookings; DMS service appointments (separate, not yet dated).',
    source: ['bookings'], filters: BOOKING_FILTERS.filter((f) => f !== 'appointment_type'), breakdowns: ['creator'],
    columns: BOOKING_COLUMNS,
    evaluate: async (args, ctx) => ({ rows: (await shared.apptSetRows(args, ctx))
      .filter((r) => r.appointment_type === 'service') }),
  },
  notYet(STATE.NEEDS_DATA, {
    id: 'service.booked_after_reminder', label: 'Booked after a reminder', dashboard: D, grain: 'service_event',
    dateBasis: 'ai_service_events.created_at', numerator: 'Reminders followed by a service booking for the same '
      + 'customer / VIN within N days.', denominator: 'Reminders raised.', exclusions: 'n/a',
    source: ['ai_service_events', 'bookings'], reason: 'No service reminder has been sent yet (13 Nov 2026: 0 service '
      + 'events, 0 owner-lifecycle touches on live). Counted against the AI Studio cadence once reminders go out.',
  }),
  notYet(STATE.NEEDS_DATA, {
    id: 'service.visited_after_reminder', label: 'Visited after a reminder', dashboard: D, grain: 'repair_order',
    dateBasis: 'RepairOrder "Open Date"', numerator: 'Repair orders for a reminded VIN within N days.',
    denominator: 'Reminders raised.', exclusions: 'n/a', source: ['repairorders'],
    reason: 'No service reminder has been sent yet (13 Nov 2026: 0 service '
      + 'events, 0 owner-lifecycle touches on live). RO dates are read; counted once reminders go out.',
  }),
  notYet(STATE.NEEDS_DATA, {
    id: 'service.due', label: 'Vehicles due for service', dashboard: D, grain: 'vehicle', dateBasis: 'next due date',
    numerator: 'Vehicles whose next service is due in the range.', denominator: null, exclusions: 'n/a',
    source: ['ai_service_vehicles'], reason: 'Needs the Vehicle Databases maintenance schedule (G-088-092); '
      + 'no next-due date per vehicle is stored today.',
  }),
  {
    // "No service visit in 12 months" (user, 13 Nov 2026), from the DealerVault files the dealer already sends: every
    // VIN the dealer sold (deals) or serviced (repair orders), with its last visit. A VIN is at risk when its last
    // purchase or repair order is more than 12 months before the range's last day. The AI's ownership records
    // (ai_vehicle_ownership) are not filled yet, so a car the customer has since sold still shows.
    id: 'service.at_risk', label: 'No service visit in 12 months', dashboard: D, grain: 'vehicle', kind: KIND.COUNT,
    dateBasis: 'As of the range\'s last day: latest RO "Close Date" / "Open Date" or deal "Delivery Date" / '
      + '"Contract Date" per VIN', numerator: 'VINs sold or serviced by the dealer whose last purchase or repair '
      + 'order is more than 12 months old.', denominator: null,
    inclusions: 'DealerVault deals and repair orders with a VIN.',
    exclusions: 'VINs with no readable date. Not yet excluded: cars the customer no longer owns (no ownership data '
      + 'yet).', source: ['deals', 'repairorders'], filters: [], breakdowns: ['last_visit_kind'],
    columns: [['vin', 'VIN'], ['customer', 'Customer'], ['phone', 'Phone'], ['email', 'Email'], ['vehicle', 'Vehicle'],
      ['last_visit', 'Last visit'], ['last_visit_kind', 'Last visit was']],
    evaluate: async (args) => {
      const w = await windowFor(args);
      const cutoff = new Date(w.end.getTime() - 365 * 864e5);
      const forms = dealerForms(args.dealerId);
      const fields = { VIN: 1, vin: 1, 'Full Name': 1, 'Cell Phone': 1, 'Home Phone': 1, 'Email 1': 1, Year: 1, Make: 1,
        Model: 1 };
      const last = new Map();
      const take = (r, at, kind) => {
        const vin = String(r.VIN || r.vin || '').trim().toUpperCase();
        if (vin.length < 11 || !at || at > w.end) return;
        const prev = last.get(vin);
        if (!prev || at > prev.at) last.set(vin, { r, at, kind });
      };
      const deals = await collection('deals').find({ dealer_id: { $in: forms } },
        { projection: { ...fields, 'Delivery Date': 1, 'Contract Date': 1 } }).toArray();
      for (const d of deals) take(d, dealDate(d['Delivery Date'], w.tz) || dealDate(d['Contract Date'], w.tz), 'Purchase');
      const ros = await collection('repairorders').find({ dealer_id: { $in: forms } },
        { projection: { ...fields, 'Close Date': 1, 'Open Date': 1 } }).toArray();
      for (const r of ros) take(r, dealDate(r['Close Date'], w.tz) || dealDate(r['Open Date'], w.tz), 'Service');
      const rows = [...last.entries()].filter(([, v]) => v.at < cutoff).sort((a, b) => b[1].at - a[1].at)
        .map(([vin, { r, at, kind }]) => ({
          id: vin, vin, customer: r['Full Name'] || '', phone: r['Cell Phone'] || r['Home Phone'] || '',
          email: r['Email 1'] || '', vehicle: [r.Year, r.Make, r.Model].filter(Boolean).join(' '),
          last_visit: localDay(at, w.tz), last_visit_kind: kind, _g: { last_visit_kind: kind },
        }));
      return { rows };
    },
  },
];
