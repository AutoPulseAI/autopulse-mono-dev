// Pure assembly logic for the Dealer 360 customer view
// (docs/dealer-360-customer-view-spec.md). Kept free of Mongoose/Next.js so
// it can be unit tested with plain objects; route.js does the DB queries and
// hands their results to these functions.
//
// Deal/RepairOrder/ServiceAppointment are strict:false mirrors of DealerTrack
// TSV columns, so every source field below is a literal, space-containing
// string key. Field choices follow docs/dealer-360-customer-view-spec.md
// §3.4, except the Deal date field: that section named "Delivery Date", but
// the already-shipped app/dealer/sales/[id]/components/DealDetail.js
// displays "Contract Date" as a deal's date, and no other page in the app
// treats "Delivery Date" as deal-representative. Following the shipped UI's
// precedent here.
export const DEAL_DATE_FIELD = 'Contract Date';
const DEAL_PRICE_FIELD = 'Sales Price';
const SALESMAN_NAME_FIELDS = ['Salesman 1 Name', 'Salesman 2 Name', 'Salesman 3 Name'];

const RO_DATE_FIELDS = ['Close Date', 'Open Date'];
const RO_TOTAL_FIELDS = { total_sale: 'Total Sale', customer_total_sale: 'Customer Total Sale' };

const APPOINTMENT_DATE_FIELD = 'Appointment Date';
const APPOINTMENT_TIME_FIELD = 'Appointment Time';

// DealerVault dates are "M/D/YYYY" strings (see test-dealervault-*.js fixtures,
// e.g. "9/8/2026"). Ingestion stores whatever string arrives, including
// calendar-invalid values (a fixture deliberately uses "2/30/2026" to prove
// ingestion doesn't crash on bad input) - callers here must tolerate that too.
export function parseLooseDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Matches both observed appointment-time shapes: "8:30 AM" and "08:30".
function parseTimeOfDay(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

function parseAmount(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const amount = Number(value.replace(/,/g, ''));
  return Number.isFinite(amount) ? amount : null;
}

export function getDealDate(deal) {
  return parseLooseDate(deal?.[DEAL_DATE_FIELD]);
}

export function getDealPrice(deal) {
  return parseAmount(deal?.[DEAL_PRICE_FIELD]);
}

// A split deal can have up to three salesmen; show every distinct name on
// file rather than picking just "Salesman 1 Name".
export function getDealSalesperson(deal) {
  const names = SALESMAN_NAME_FIELDS.map((field) => deal?.[field]).filter(Boolean);
  const unique = [...new Set(names)];
  return unique.length ? unique.join(' / ') : null;
}

// RO date is "Close Date", falling back to "Open Date" for ROs still open
// (no close date yet).
export function getRepairOrderDate(ro) {
  for (const field of RO_DATE_FIELDS) {
    const parsed = parseLooseDate(ro?.[field]);
    if (parsed) return parsed;
  }
  return null;
}

// Both totals are shown, labeled, per spec §3.4 - "Total Sale" (all-pay) and
// "Customer Total Sale" (customer-pay) answer different questions and
// collapsing to one would silently pick a side.
export function getRepairOrderTotals(ro) {
  return {
    total_sale: parseAmount(ro?.[RO_TOTAL_FIELDS.total_sale]),
    customer_total_sale: parseAmount(ro?.[RO_TOTAL_FIELDS.customer_total_sale]),
  };
}

// "Appointment Date" and "Appointment Time" are separate source strings;
// combine them into one sortable Date. An unparseable time still yields a
// midnight-anchored date rather than discarding the appointment.
export function getAppointmentDate(appointment) {
  const date = parseLooseDate(appointment?.[APPOINTMENT_DATE_FIELD]);
  if (!date) return null;
  const time = parseTimeOfDay(appointment?.[APPOINTMENT_TIME_FIELD]);
  if (time) date.setHours(time.hours, time.minutes, 0, 0);
  return date;
}

// An appointment forward-links to its RepairOrder via ro_number once it
// converts (see ServiceAppointment.js). Once converted, showing both in the
// Service timeline would double up the same visit - suppress the appointment
// row when its ro_number matches an RO already in this customer's results.
export function dedupeServiceTimeline(repairOrders, appointments) {
  const convertedRoNumbers = new Set(
    repairOrders.map((ro) => ro.ro_number).filter(Boolean)
  );
  const visibleAppointments = appointments.filter(
    (appointment) => !appointment.ro_number || !convertedRoNumbers.has(appointment.ro_number)
  );
  return { repairOrders, appointments: visibleAppointments };
}

// Current owner of a VIN = customer_id on the most recent record across
// Deal / RepairOrder / ServiceAppointment for that VIN, dealer-wide (not
// scoped to one customer) - a vehicle bought elsewhere and only ever
// serviced here still resolves an owner, and a VIN that has changed hands
// resolves to whoever holds it now rather than this customer.
export function deriveVehicleOwners({ deals = [], repairOrders = [], appointments = [] }) {
  const latestByVin = new Map();
  const consider = (records, getDate) => {
    for (const record of records) {
      const vin = record.vin;
      const customerId = record.customer_id;
      if (!vin || !customerId) continue;
      // An undated record still resolves an owner; it just can't outrank a
      // dated one for the same VIN.
      const at = getDate(record);
      const current = latestByVin.get(vin);
      if (!current || (at && (!current.at || at > current.at))) {
        latestByVin.set(vin, { customer_id: customerId, at: at || current?.at || null });
      }
    }
  };
  consider(deals, getDealDate);
  consider(repairOrders, getRepairOrderDate);
  consider(appointments, getAppointmentDate);
  return latestByVin;
}

// Overview tab: one feed across leads/deals/ROs/appointments, most-recent-first.
// Undated records sort last rather than being dropped.
export function buildOverviewFeed({ leads = [], deals = [], repairOrders = [], appointments = [] }) {
  const entries = [
    ...leads.map((lead) => ({ type: 'lead', at: lead.createdAt ? new Date(lead.createdAt) : null, record: lead })),
    ...deals.map((deal) => ({ type: 'deal', at: getDealDate(deal), record: deal })),
    ...repairOrders.map((ro) => ({ type: 'repair_order', at: getRepairOrderDate(ro), record: ro })),
    ...appointments.map((appointment) => ({ type: 'appointment', at: getAppointmentDate(appointment), record: appointment })),
  ];
  return entries.sort((a, b) => {
    if (a.at && b.at) return b.at - a.at;
    if (a.at) return -1;
    if (b.at) return 1;
    return 0;
  });
}

// Header value snapshot: total deal $ and total RO $ (both RO totals,
// labeled - see getRepairOrderTotals), plus the most recent activity date
// across every collection.
export function buildValueSnapshot({ leads = [], deals = [], repairOrders = [], appointments = [] }) {
  const totalDealPrice = deals.reduce((sum, deal) => sum + (getDealPrice(deal) || 0), 0);
  const totalSale = repairOrders.reduce((sum, ro) => sum + (getRepairOrderTotals(ro).total_sale || 0), 0);
  const totalCustomerSale = repairOrders.reduce((sum, ro) => sum + (getRepairOrderTotals(ro).customer_total_sale || 0), 0);

  const allDates = [
    ...leads.map((lead) => (lead.createdAt ? new Date(lead.createdAt) : null)),
    ...deals.map(getDealDate),
    ...repairOrders.map(getRepairOrderDate),
    ...appointments.map(getAppointmentDate),
  ].filter(Boolean);
  const lastActivityAt = allDates.length ? new Date(Math.max(...allDates)) : null;

  return {
    total_deal_price: totalDealPrice,
    total_repair_order_sale: totalSale,
    total_repair_order_customer_sale: totalCustomerSale,
    last_activity_at: lastActivityAt,
  };
}

// dealervault_upload was only added in commit a26bbfa ("adding new customer
// through dealervault"). Any Customer that DealerVault matched/created
// before that commit deployed has extra.dealervault.customer_numbers set
// (the older mapping mechanism - see CUSTOMER_MAPPING_INDEX in Customer.js)
// but never got dealervault_upload backfilled, so it would otherwise read as
// false. Mirrors hasDealerVaultOrigin() in app/lib/customerResolver.js and
// app/worker/dealervault/common/customerResolver.js - keep this in sync with
// those if the check changes there.
function hasDealerVaultOrigin(customer) {
  const customerNumbers = customer?.extra?.dealervault?.customer_numbers;
  return customer?.dealervault_upload === true
    || (Array.isArray(customerNumbers) ? customerNumbers.length > 0 : typeof customerNumbers === 'string');
}

// inbound_lead has the same rollout gap as dealervault_upload (added in the
// same commit): a customer created via the inbound path before that commit
// deployed never got it set. Unlike DealerVault there's no pre-existing field
// on Customer itself to fall back on - but Lead.customer_id is written in
// exactly one place in the whole codebase (app/lib/customerResolver.js:356)
// and never by the DealerVault workers, so "this customer has at least one
// linked Lead" is an equally reliable, flag-independent inbound-origin signal.
function hasInboundOrigin(customer, { hasLinkedLeads = false } = {}) {
  return customer?.inbound_lead === true || hasLinkedLeads;
}

// Customer-level origin badge (spec §3.3), driven by the two booleans on
// Customer - independent of any per-record provenance. Pass hasLinkedLeads
// (e.g. leads.length > 0 from the leads already fetched for this customer)
// so legacy customers predating either flag still classify correctly.
export function getOriginBadge(customer, { hasLinkedLeads = false } = {}) {
  const dealervault = hasDealerVaultOrigin(customer);
  const inbound = hasInboundOrigin(customer, { hasLinkedLeads });
  if (dealervault && inbound) return 'Inbound & DealerVault';
  if (dealervault) return 'DealerVault';
  if (inbound) return 'Inbound Lead';
  return 'Unknown';
}
