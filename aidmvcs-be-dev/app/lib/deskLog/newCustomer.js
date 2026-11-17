// A customer who isn't in the CRM yet, added right at the Desk Log check-in (13 Nov 2026 meeting, Betsy: "we can't -
// that takes too long ... we got to be able to add a person the same way we're checking in a customer, the same way
// we can create a lead at the same time"). One step creates the lead (its lead type - Walk-In / Phone Up / Internet -
// and its source) and links it to the customer: an existing customer with the same phone or email is reused, else a
// new one is made (lib/customerResolver.js, the same matching every other lead goes through).
// Not through the new-lead queue on purpose: that sends a new internet lead its first message ("thanks for your
// inquiry"), and this customer is standing in the showroom. The AI hears about the lead from the check-in itself
// (lib/deskLog/checkIn.js tells it the customer came in), so its follow-ups start from the visit's outcome.
import Lead from '../../models/Lead.js';
import { linkCustomerToLead } from '../customerResolver.js';
import { validContactType } from '../leadContactType.js';

const clean = (v, max = 120) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function formatPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length < 10) return null;
  if (d.length === 10) return `+1${d}`;
  return `+${d}`;
}

/** @returns {{ errors: string[] } | { value: object }} the new customer's fields, checked. */
export function checkNewCustomer(input = {}) {
  const errors = [];
  const name = clean(input.name);
  const email = clean(input.email, 200).toLowerCase();
  const rawPhone = clean(input.phone, 40);
  const phone = rawPhone ? formatPhone(rawPhone) : null;
  const type = validContactType(input.contact_type);
  if (!name) errors.push('Enter the customer\'s name');
  if (!email && !rawPhone) errors.push('Enter a phone number or an email');
  if (rawPhone && !phone) errors.push('The phone number needs 10 digits');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('The email is not valid');
  if (!type) errors.push('Pick the lead type (Walk-In, Phone Up or Internet)');
  const year = input.vehicle_year ? Number(input.vehicle_year) : null;
  if (year != null && (!Number.isInteger(year) || year < 1900 || year > 2100)) errors.push('The vehicle year is not a year');
  if (errors.length) return { errors };
  return { value: { name, email: email || null, phone, contact_type: type, lead_source: clean(input.lead_source, 60) || null,
    vehicle_year: year, vehicle_make: clean(input.vehicle_make, 40) || null, vehicle_model: clean(input.vehicle_model, 60) || null,
    vin: clean(input.vin, 17).toUpperCase() || null } };
}

/** Creates the lead and links its customer. Returns the saved lead (lean-like object). */
export async function createLeadAtCheckIn(dealerId, v, { user } = {}) {
  const lead = await new Lead({
    dealer_id: String(dealerId), name: v.name, email: v.email, phone: v.phone,
    contact_type: v.contact_type, ...(v.lead_source ? { lead_source: v.lead_source } : {}),
    ...(v.department ? { department: v.department } : {}),
    source: 'manual', followup_preference: v.phone ? 'sms' : 'email',
    vehicle_year: v.vehicle_year, vehicle_make: v.vehicle_make, vehicle_model: v.vehicle_model, vin: v.vin,
    lead_status: 'New', fe_lead_status: 'Lead', status: 'New', user_language: 'english',
    created_via: 'desk_log', created_by: user?._id || null,
  }).save();
  await linkCustomerToLead(lead, { source: 'desk_log' });
  return Lead.findById(lead._id).lean();
}
