// What a form can be filled with (SOW v6 Deliverable K, gap G-065): the customer, the opportunity picked (lead), its
// vehicle, up to MAX_TRADES trade-ins (more go on an added "Trade-in schedule" page), dates, staff and the dealership.
// Only values the CRM already has: an empty value stays empty and is flagged missing - nothing is ever made up.
// Sensitive values (trade payoff, lienholder) only for staff with "Manage Leads", as on the Trade In tab; the CRM
// collects no SSN, date of birth, credit or bank data, so no form can be filled with them.
import mongoose from 'mongoose';
import moment from 'moment-timezone';
import Customer from '../../models/Customer.js';
import Lead from '../../models/Lead.js';
import TradeIn from '../../models/TradeIn.js';
import User from '../../models/User.js';
import DeskLogEntry from '../../models/DeskLogEntry.js';

export const MAX_TRADES = 3;
const TRADE_FIELDS = [['year', 'Year'], ['make', 'Make'], ['model', 'Model'], ['trim', 'Trim'], ['vin', 'VIN'],
  ['miles', 'Mileage'], ['color', 'Color'], ['description', 'Year make model'], ['offer', 'Trade offer'],
  ['acv', 'ACV'], ['payoff', 'Payoff', true], ['lienholder', 'Lienholder', true]];

export const SOURCES = Object.freeze([
  ['customer.full_name', 'Customer', 'Full name'], ['customer.first_name', 'Customer', 'First name'],
  ['customer.last_name', 'Customer', 'Last name'], ['customer.phone', 'Customer', 'Phone'],
  ['customer.email', 'Customer', 'Email'], ['customer.address_line', 'Customer', 'Street address'],
  ['customer.city', 'Customer', 'City'], ['customer.state', 'Customer', 'State'], ['customer.zip', 'Customer', 'ZIP'],
  ['customer.address_full', 'Customer', 'Full address (one line)'],
  ['vehicle.year', 'Vehicle', 'Year'], ['vehicle.make', 'Vehicle', 'Make'], ['vehicle.model', 'Vehicle', 'Model'],
  ['vehicle.trim', 'Vehicle', 'Trim'], ['vehicle.vin', 'Vehicle', 'VIN'], ['vehicle.stock_number', 'Vehicle', 'Stock #'],
  ['vehicle.description', 'Vehicle', 'Year make model trim'],
  ...Array.from({ length: MAX_TRADES }, (_, i) => TRADE_FIELDS.map(([k, label, sensitive]) => [
    `trade${i + 1}.${k}`, `Trade-in ${i + 1}`, label, sensitive])).flat(),
  ['date.today', 'Dates', "Today's date"], ['date.appointment', 'Dates', 'Appointment date'],
  ['date.visit', 'Dates', 'Showroom visit date'], ['date.lead', 'Dates', 'Lead received'],
  ['staff.salesperson', 'Staff', 'Salesperson'], ['staff.sales_manager', 'Staff', 'Sales manager'],
  ['staff.prepared_by', 'Staff', 'Prepared by (you)'],
  ['dealer.name', 'Dealership', 'Name'], ['dealer.address', 'Dealership', 'Address'], ['dealer.city', 'Dealership', 'City'],
  ['dealer.state', 'Dealership', 'State'], ['dealer.zip', 'Dealership', 'ZIP'], ['dealer.phone', 'Dealership', 'Phone'],
  ['dealer.email', 'Dealership', 'Email'], ['dealer.website', 'Dealership', 'Website'],
].map(([key, group, label, sensitive]) => ({ key, group, label, sensitive: Boolean(sensitive) })));

const BY_KEY = new Map(SOURCES.map((s) => [s.key, s]));
export const isSource = (key) => BY_KEY.has(key);
export const sourceLabel = (key) => (BY_KEY.has(key) ? `${BY_KEY.get(key).group}: ${BY_KEY.get(key).label}` : key);
export const isSensitive = (key) => Boolean(BY_KEY.get(key)?.sensitive);

const text = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());
const money = (n) => (n == null || n === '' || !Number.isFinite(Number(n)) ? ''
  : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const oidOrNull = (v) => (v && mongoose.isValidObjectId(String(v)) ? new mongoose.Types.ObjectId(String(v)) : null);

function primary(list) {
  const items = (list || []).filter((x) => text(x?.value));
  return text((items.find((x) => x.is_primary) || items[0])?.value);
}

function splitName(full) {
  const parts = text(full).split(' ').filter(Boolean);
  if (parts.length < 2) return { first: parts[0] || '', last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

/**
 * Every source's value for one customer + opportunity + trade-ins, as it would print.
 * @returns {Promise<{values: Record<string,string>, trades: object[], extraTrades: object[], lead: object|null}>}
 */
export async function collectValues({ dealerId, customerId, leadId, tradeInIds = [], user, canSeeFinance, tz }) {
  const customer = await Customer.findOne({ _id: customerId, dealer_id: dealerId }).lean();
  if (!customer) throw Object.assign(new Error('Customer not found'), { status: 404 });
  const lead = leadId ? await Lead.findOne({ _id: oidOrNull(leadId), dealer_id: dealerId }).lean() : null;
  if (leadId && !lead) throw Object.assign(new Error('That lead is not one of this dealership\'s'), { status: 404 });
  const ids = tradeInIds.map(oidOrNull).filter(Boolean);
  const tradeDocs = ids.length ? await TradeIn.find({ _id: { $in: ids }, dealer_id: dealerId }).lean() : [];
  if (tradeDocs.length !== ids.length) throw Object.assign(new Error('A trade-in picked is not this dealership\'s'), { status: 404 });
  const trades = ids.map((id) => tradeDocs.find((t) => String(t._id) === String(id)));
  const desk = lead ? await DeskLogEntry.findOne({ lead_id: lead._id }).sort({ checked_in_at: -1 }).lean() : null;
  const dealer = await User.findById(dealerId).select('name email dealer_account_information').lean();
  const info = dealer?.dealer_account_information || {};
  const staffIds = [desk?.salesperson_id || lead?.assigned_to, desk?.sales_manager_id].map(oidOrNull).filter(Boolean);
  const staff = new Map((await User.find({ _id: { $in: staffIds } }).select('name').lean()).map((u) => [String(u._id), u.name]));
  const day = (d) => (d ? moment(d).tz(tz).format('MM/DD/YYYY') : '');

  const name = text(customer.name) || text(lead?.name);
  const { first, last } = splitName(name);
  const address = (customer.addresses || []).find((a) => a.is_primary) || (customer.addresses || [])[0] || {};
  const street = [text(address.line1), text(address.line2)].filter(Boolean).join(', ');
  const v = { ...(desk?.vehicle || {}) };
  const vehicle = { year: text(v.year || lead?.vehicle_year), make: text(v.make || lead?.vehicle_make),
    model: text(v.model || lead?.vehicle_model), trim: text(v.trim), vin: text(v.vin || lead?.vin).toUpperCase(),
    stock_number: text(desk?.stock_number) };

  const values = {
    'customer.full_name': name, 'customer.first_name': first, 'customer.last_name': last,
    'customer.phone': primary(customer.phones) || text(lead?.phone), 'customer.email': primary(customer.emails) || text(lead?.email),
    'customer.address_line': street, 'customer.city': text(address.city), 'customer.state': text(address.state),
    'customer.zip': text(address.zip),
    'customer.address_full': [street, text(address.city), [text(address.state), text(address.zip)].filter(Boolean).join(' ')]
      .filter(Boolean).join(', '),
    'vehicle.year': vehicle.year, 'vehicle.make': vehicle.make, 'vehicle.model': vehicle.model, 'vehicle.trim': vehicle.trim,
    'vehicle.vin': vehicle.vin, 'vehicle.stock_number': vehicle.stock_number,
    'vehicle.description': [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' '),
    'date.today': day(new Date()),
    'date.appointment': day(lead?.booking?.booking_at || lead?.booking?.booking_date),
    'date.visit': day(desk?.checked_in_at), 'date.lead': day(lead?.createdAt),
    'staff.salesperson': text(staff.get(String(desk?.salesperson_id || lead?.assigned_to || ''))),
    'staff.sales_manager': text(staff.get(String(desk?.sales_manager_id || ''))),
    'staff.prepared_by': text(user?.name),
    'dealer.name': text(info.store_name) || text(dealer?.name), 'dealer.address': text(info.store_address),
    'dealer.city': text(info.store_city), 'dealer.state': text(info.store_state), 'dealer.zip': text(info.store_postal),
    'dealer.phone': text(info.store_contact_number || info.dealer_phone), 'dealer.email': text(info.store_contact_mail),
    'dealer.website': text(info.store_website),
  };
  const tradeValues = (t) => ({
    year: text(t.year), make: text(t.make), model: text(t.model), trim: text(t.trim), vin: text(t.vin).toUpperCase(),
    miles: t.miles == null ? '' : Number(t.miles).toLocaleString('en-US'), color: text(t.exterior_color),
    description: [t.year, t.make, t.model, t.trim].map(text).filter(Boolean).join(' '),
    offer: money(t.trade_offer_amount), acv: money(t.trade_acv_amount),
    payoff: canSeeFinance ? money(t.payoff_amount) : '', lienholder: canSeeFinance ? text(t.lienholder) : '',
  });
  trades.slice(0, MAX_TRADES).forEach((t, i) => {
    for (const [k, val] of Object.entries(tradeValues(t))) values[`trade${i + 1}.${k}`] = val;
  });
  for (let i = trades.length; i < MAX_TRADES; i += 1) for (const [k] of TRADE_FIELDS) values[`trade${i + 1}.${k}`] = '';
  return { values, lead, extraTrades: trades.slice(MAX_TRADES).map(tradeValues), allTrades: trades.map(tradeValues) };
}
