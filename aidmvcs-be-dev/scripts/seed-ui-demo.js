#!/usr/bin/env node
// Bulk demo data for checking the dealer portal's screens (long names, missing fields, every status, Desk Log rows).
// Run after seed-local-crm.js (which also removes it: everything belongs to the demo dealer). LOCAL databases only.
//   node scripts/seed-ui-demo.js
import moment from 'moment-timezone';
import mongoose from 'mongoose';
import { assertLocal, DEMO_DEALER_ID, DEMO_DEALER_SMS, DEMO_MAILBOX, DEMO_TIMEZONE } from './seed-local-crm.js';
import Booking from '../app/models/Booking.js';
import Customer from '../app/models/Customer.js';
import DeskLogEntry from '../app/models/DeskLogEntry.js';
import Email from '../app/models/Email.js';
import Lead from '../app/models/Lead.js';
import { STAGES, UNSOLD_REASONS } from '../app/lib/deskLog/constants.js';

const URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/emailai';
const TAG = { ui_demo_seed: true, crm_local_seed: true };
const STAFF = ['66f00000000000000000d0b1', '66f00000000000000000d0b2'].map((id) => new mongoose.Types.ObjectId(id));
const NAMES = ['Al Wu', 'Maria Fernandez', 'Christopher Montgomery-Featherstonehaugh', 'Siobhan O\'Callaghan', 'Jose Nunez',
  'Alexandria Papadopoulos-Constantinou', 'Bo Li', 'Wei Zhang', 'Fatima Al-Rashid', 'Venkatanarasimharajuvaripeta Rao', 'Emma Johnson', 'Liam Brown'];
const SOURCES = ['Capital One Auto Navigator', 'KBB Instant Cash Offer', 'CarGurus', 'Autotrader', 'Dealer Website', 'Cars.com',
  'Facebook Marketplace', 'Google', 'TrueCar', 'Edmunds', 'Phone Call', 'Walk-In', 'Manufacturer Certified Pre-Owned Referral Program'];
const STATUSES = ['Lead', 'Lead Not Contacted', 'Contacted - No Next Action', 'Contacted - Specific Follow-up', 'Appointment Booked', 'No Show',
  'Visited', 'Managerial Review', 'Sold Pending', 'Sold Delivered', 'Unsold', 'Closed - Lost', 'DND'];
const CARS = [['Toyota', 'RAV4', 'XLE Hybrid'], ['Ford', 'F-150', 'Lariat SuperCrew'], ['Honda', 'Civic', 'LX'], ['Mercedes-Benz', 'Sprinter 2500', 'High Roof']];
const COUNT = 150;

async function main() {
  assertLocal(URI);
  await mongoose.connect(URI, { serverSelectionTimeoutMS: 3000 });
  for (const c of ['leads', 'customers', 'emails', 'bookings', 'desklogentries']) {
    await mongoose.connection.db.collection(c).deleteMany({ ui_demo_seed: true });
  }
  const now = Date.now();
  let bookings = 0, desk = 0;
  for (let i = 0; i < COUNT; i += 1) {
    const name = `${NAMES[i % NAMES.length]}${i >= NAMES.length ? ` ${i}` : ''}`;
    const status = STATUSES[i % STATUSES.length];
    const source = SOURCES[(i * 7) % SOURCES.length];
    const contact_type = source === 'Phone Call' ? 'phone' : source === 'Walk-In' ? 'walk_in' : 'internet';
    const department = i % 4 === 0 ? 'service' : i % 11 === 0 ? 'parts' : 'sales';
    // A third today, the rest over the last 90 days.
    const created = new Date(i % 3 === 0 ? now - (i % 8) * 1800000 : now - (1 + (i * 13) % 90) * 86400000);
    const email = i % 9 === 0 ? undefined : `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@${i % 5 ? '' : 'a-very-long-subdomain.'}example.test`;
    const phone = i % 10 === 5 ? undefined : `+1217555${String(1000 + i)}`;
    const customer = await Customer.create({ dealer_id: DEMO_DEALER_ID, name, inbound_lead: true, ...TAG,
      emails: email ? [{ value: email, is_primary: true, source: 'seed' }] : [],
      phones: phone ? [{ value: phone.slice(2), is_primary: true, source: 'seed', sms_opt_in: true }] : [] });
    const lead = await Lead.create({ name, email, phone, source, lead_source: source, contact_type, department, dealer_id: DEMO_DEALER_ID,
      customer_id: customer._id, fe_lead_status: status, status, statusChangedAt: created, followup_preference: i % 2 ? 'sms' : 'email',
      ...(i % 3 ? { assigned_to: STAFF[i % 2] } : {}) });
    await Lead.collection.updateOne({ _id: lead._id }, { $set: { ...TAG, createdAt: created } });
    await Customer.collection.updateOne({ _id: customer._id }, { $set: TAG });
    const channel = phone && (i % 2 || !email) ? 'sms' : 'email';
    for (const [k, incoming] of [[0, true], [1, false], [2, true]].slice(0, 1 + (i % 3))) {
      const at = new Date(Math.min(now, created.getTime() + k * 600000));
      const us = channel === 'sms' ? DEMO_DEALER_SMS : DEMO_MAILBOX, them = (channel === 'sms' ? phone : email) || 'unknown@example.test';
      const m = await Email.create({ sender: incoming ? them : us, recipient: incoming ? us : them, subject: 'Demo conversation',
        mail_content: incoming ? 'Is this still available? I can come by this weekend.' : 'Yes, it is. When would you like to visit?',
        message_id: `ui-demo-${lead._id}-${k}`, communication_type: channel, status: incoming ? 'incoming' : 'sent',
        dealer_id: DEMO_DEALER_ID, lead_id: lead._id, date: at, timestamp: at, read: !incoming });
      await Email.collection.updateOne({ _id: m._id }, { $set: TAG });
    }
    if (['Appointment Booked', 'No Show', 'Visited', 'Sold Pending', 'Sold Delivered'].includes(status)) {
      const upcoming = status === 'Appointment Booked';
      const day = moment.tz(DEMO_TIMEZONE).add(upcoming ? i % 5 : -(i % 4), 'days').startOf('day');
      const time = `${String(9 + (i % 9)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`;
      const at = moment.tz(`${day.format('YYYY-MM-DD')} ${time}`, 'YYYY-MM-DD HH:mm', DEMO_TIMEZONE).toDate();
      const showed = upcoming ? null : status !== 'No Show';
      const b = await Booking.create({ dealer_id: DEMO_DEALER_ID, lead_id: String(lead._id), customerName: name, email, phone,
        bookingDate: day.toDate(), bookingTime: time, booking_status: upcoming ? 'confirmed' : 'completed', showed,
        ...(showed ? { showed_at: at } : {}), created_by: i % 2 ? 'ai' : 'staff', created_by_name: i % 2 ? undefined : 'Sam Sales',
        appointment_type: department === 'service' ? 'service' : 'sales' });
      await Booking.collection.updateOne({ _id: b._id }, { $set: TAG });
      await Lead.collection.updateOne({ _id: lead._id }, { $set: { booking_status: true, booking: { booking_date: day.toDate(), booking_time: time, booking_at: at } } });
      bookings += 1;
    }
    if (['Visited', 'Sold Pending', 'Sold Delivered', 'Unsold'].includes(status)) {
      const reasons = Object.values(UNSOLD_REASONS);
      const outcome = { 'Sold Pending': 'SOLD PENDING', 'Sold Delivered': 'SOLD DELIVERED', Unsold: 'UNSOLD' }[status] || null;
      const [make, model, trim] = CARS[desk % CARS.length];
      const at = new Date(desk % 2 ? now - (desk % 14) * 86400000 : now - (desk % 6) * 1500000);
      const e = await DeskLogEntry.create({ dealer_id: DEMO_DEALER_ID, lead_id: lead._id, customer_id: customer._id, checked_in_at: at,
        department: department === 'service' ? 'service' : 'sales', stock_number: `D${1000 + desk}`, vehicle: { year: 2024, make, model, trim },
        trade: desk % 2 ? { year: 2017, make: 'Honda', model: 'Accord', trim: 'EX-L' } : {}, salesperson_id: STAFF[0],
        sales_manager_id: desk % 3 ? STAFF[1] : null, stage: desk % 7 === 6 ? null : STAGES[desk % STAGES.length], stage_at: at, outcome,
        unsold_reason: outcome === 'UNSOLD' ? reasons[desk % reasons.length] : null, outcome_at: outcome ? at : null,
        next_step_at: outcome === 'UNSOLD' ? new Date(now + 3 * 86400000) : null,
        notes: desk % 2 ? [{ text: 'Customer wants a lower payment and will bring a co-signer tomorrow after work.', at, by_name: 'Sam Sales' }] : [] });
      await DeskLogEntry.collection.updateOne({ _id: e._id }, { $set: TAG });
      desk += 1;
    }
  }
  console.log({ leads: COUNT, bookings, deskLogVisits: desk });
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
