#!/usr/bin/env node
// Demo data for the local CRM (`make crm-seed`, and `make crm-local` the first
// time), in the CRM's own shapes (agentic-upsell MASTER_PLAN_4 stream C1):
//
//   - Autopulse Demo Motors: a dealer with account info, opening hours
//     (weekly_availability), timezone, address, a Twilio number placeholder,
//     a mailbox (EmailAccount), slot capacity, AI mode `live`, and a known login
//   - staff users of that dealer, and an admin
//   - 14 stock vehicles with photos (imagesSecure), shaped like the vAuto feed
//   - leads from each source bucket: credit (Capital One), trade-in (KBB),
//     marketplace (CarGurus, Autotrader), website, service
//   - customers with deals (DealerVault columns, "Birth Date" included),
//     owned vehicles, a past appointment and two upcoming bookings
//
// Only ever writes to a LOCAL database (refuses any other host). Re-running
// deletes what it created before (everything tagged crm_local_seed, plus the
// demo dealer's leads, conversations, bookings and AI data) and starts over.
//
//   node scripts/seed-local-crm.js [--if-missing]
//   MONGODB_URI defaults to mongodb://localhost:27018/autopulse_local
//
// Logins (http://localhost:3100/dealer, admin: /admin):
//   dealer owner  demo-dealer@autopulse.local / AutopulseDemo#1   (OTP is shown in the
//                 login response and printed in the web log: provider sends are stubbed)
//   staff         sam.sales@autopulse.local, maya.manager@autopulse.local / AutopulseDemo#1
//   admin         admin@autopulse.local / AutopulseDemo#1        (no OTP for admins)
import bcrypt from 'bcryptjs';
import moment from 'moment-timezone';
import mongoose from 'mongoose';

import Booking from '../app/models/Booking.js';
import Customer from '../app/models/Customer.js';
import Deal from '../app/models/Deal.js';
import Email from '../app/models/Email.js';
import EmailAccount from '../app/models/EmailAccount.js';
import Lead from '../app/models/Lead.js';
import User from '../app/models/User.js';
import Vehicle from '../app/models/Vehicle.js';

export const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27018/autopulse_local';
export const DEMO_DEALER_ID = '66f00000000000000000d0a1';
export const DEMO_DEALER_SMS = '+15550100100';
export const DEMO_MAILBOX = 'sales@demo-motors.autopulse.local';
export const DEMO_PASSWORD = 'AutopulseDemo#1';
export const DEMO_TIMEZONE = 'America/Chicago';
const SEED_TAG = { crm_local_seed: true };
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', 'mongodb', 'autopulse-mongo']);
const ids = {
  owner: DEMO_DEALER_ID,
  sam: '66f00000000000000000d0b1',
  maya: '66f00000000000000000d0b2',
  admin: '66f00000000000000000d0c1',
};

export const WEEKLY_AVAILABILITY = {
  monday: { active: true, start: '9:00 AM', end: '7:00 PM' },
  tuesday: { active: true, start: '9:00 AM', end: '7:00 PM' },
  wednesday: { active: true, start: '9:00 AM', end: '7:00 PM' },
  thursday: { active: true, start: '9:00 AM', end: '7:00 PM' },
  friday: { active: true, start: '9:00 AM', end: '7:00 PM' },
  saturday: { active: true, start: '9:00 AM', end: '5:00 PM' },
  sunday: { active: false, start: '', end: '' },
};

// (year, make, model, trim, body, condition, colour, miles, price)
const STOCK = [
  [2025, 'Toyota', 'RAV4', 'XLE Hybrid', 'SUV', 'new', 'White', 12, 36900],
  [2022, 'Toyota', 'RAV4', 'XLE', 'SUV', 'used', 'Blue', 31200, 27995],
  [2023, 'Honda', 'CR-V', 'EX', 'SUV', 'used', 'Gray', 21000, 29500],
  [2025, 'Toyota', 'Camry', 'SE', 'Sedan', 'new', 'Black', 10, 30200],
  [2021, 'Toyota', 'Camry', 'LE', 'Sedan', 'used', 'White', 38000, 21900],
  [2022, 'Ford', 'F-150', 'XLT', 'Truck', 'used', 'Red', 36500, 34900],
  [2024, 'Ford', 'F-150', 'Lariat', 'Truck', 'new', 'Blue', 6, 48900],
  [2023, 'Toyota', 'Tacoma', 'SR5', 'Truck', 'used', 'Gray', 18900, 33500],
  [2023, 'Chrysler', 'Pacifica', 'Touring', 'Minivan', 'used', 'White', 27000, 29900],
  [2022, 'Ford', 'Mustang', 'GT', 'Coupe', 'used', 'Yellow', 19500, 32900],
  [2021, 'Honda', 'Civic', 'LX', 'Hatchback', 'used', 'Blue', 33500, 19900],
  [2024, 'Toyota', 'Highlander', 'Limited', 'SUV', 'new', 'Pearl', 7, 44900],
  [2023, 'Tesla', 'Model Y', 'Long Range', 'SUV', 'used', 'Black', 22000, 36900],
  [2020, 'Chevrolet', 'Silverado', 'LT', 'Truck', 'used', 'White', 58000, 31800],
];

// One lead per source bucket (agentic-upsell slots/requirements.py LEAD_SOURCE_TO_TYPE).
export const DEMO_LEADS = [
  { key: 'capital-one', name: 'Carla Reyes', source: 'Capital One Auto Navigator', channel: 'sms',
    comments: 'Pre-qualified with Capital One, looking at the 2022 RAV4 XLE.' },
  { key: 'kbb', name: 'Ken Baker', source: 'KBB Instant Cash Offer', channel: 'email',
    comments: 'Got a KBB instant offer for my 2018 Honda Accord, want to trade it in.' },
  { key: 'cargurus', name: 'Grace Kim', source: 'CarGurus', channel: 'sms',
    comments: 'Is the 2023 Tacoma SR5 still available?' },
  { key: 'autotrader', name: 'Omar Haddad', source: 'Autotrader', channel: 'email',
    comments: 'What is the best price on the F-150 Lariat?' },
  { key: 'website', name: 'Lily Chen', source: 'Dealer Website', channel: 'sms',
    comments: 'Looking for a family minivan under $32k.' },
  { key: 'service', name: 'Victor Stone', source: 'Service Department', channel: 'sms',
    comments: 'My Camry needs its 30k service, can I book it?' },
];

// Customers with history: owned car (a deal), birth date, a service visit.
const HISTORY = [
  { name: 'Hannah Weber', vin: 'DEMOHANNAH0CIVIC1', car: [2016, 'Honda', 'Civic', 'EX'], soldYearsAgo: 8,
    price: 18200, birth: '04/12/1985', salesperson: 'Sam Sales' },
  { name: 'Marcus Lee', vin: 'DEMOMARCUS0F150X1', car: [2019, 'Ford', 'F-150', 'XLT'], soldYearsAgo: 5,
    price: 38400, birth: '11/02/1979', salesperson: 'Maya Manager' },
  { name: 'Priya Nair', vin: 'DEMOPRIYA00RAV4X1', car: [2021, 'Toyota', 'RAV4', 'LE'], soldYearsAgo: 3,
    price: 27100, birth: '07/30/1990', salesperson: 'Sam Sales' },
];

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
}

// Stable 555 numbers per name (E.164 on leads, 10 digits on customers, like the platform).
function phoneFor(name) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 10_000_000;
  return `555${String(hash).padStart(7, '0')}`;
}

function photo(vin, n) {
  // Placeholder photos (never fetched by the CRM itself; shown in the browser).
  return `https://placehold.co/1024x683/jpg?text=${encodeURIComponent(`${vin.slice(-6)} photo ${n}`)}`;
}

function stockVin(index) {
  return `DEMOSTOCK${String(index).padStart(8, '0')}`;
}

function mdy(date) {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

// The next open weekday at `hour` in the dealer's timezone, `daysAhead` from now.
function nextOpenDay(daysAhead) {
  const day = moment.tz(DEMO_TIMEZONE).add(daysAhead, 'days');
  while (day.isoWeekday() === 7) day.add(1, 'day');
  return day.format('YYYY-MM-DD');
}

export function assertLocal(uri) {
  const host = new URL(uri.replace(/^mongodb(\+srv)?:/, 'http:')).hostname;
  if (!LOCAL_HOSTS.has(host)) throw new Error(`Refusing to seed: ${uri} is not a local database`);
}

async function reset(db) {
  const dealerFilter = { $in: [DEMO_DEALER_ID, new mongoose.Types.ObjectId(DEMO_DEALER_ID)] };
  for (const name of ['users', 'emailaccounts', 'vehicles', 'customers', 'deals', 'leads', 'bookings', 'roles', 'permissions']) {
    await db.collection(name).deleteMany(SEED_TAG);
  }
  await db.collection('leads').deleteMany({ dealer_id: DEMO_DEALER_ID });
  await db.collection('customers').deleteMany({ dealer_id: DEMO_DEALER_ID });
  await db.collection('emails').deleteMany({ dealer_id: DEMO_DEALER_ID });
  await db.collection('bookings').deleteMany({ dealer_id: DEMO_DEALER_ID });
  await db.collection('followupjobs').deleteMany({ dealer_id: DEMO_DEALER_ID });
  await db.collection('appointmentreminders').deleteMany({ dealer_id: dealerFilter });
  for (const name of ['ai_lead_state', 'ai_messages', 'ai_turn_log', 'ai_events', 'ai_consent', 'scheduled_followups',
    'qualification_facts', 'dev_outbox', 'dev_platform_messages', 'ai_compliance_log']) {
    await db.collection(name).deleteMany({ dealer_id: DEMO_DEALER_ID });
  }
}

export async function seed() {
  const db = mongoose.connection.db;
  await reset(db);
  const password = await bcrypt.hash(DEMO_PASSWORD, 10);
  const now = new Date();
  const oid = (id) => new mongoose.Types.ObjectId(id);

  // Dealer (the owner login), staff, admin.
  await User.collection.insertOne({
    _id: oid(ids.owner), email: 'demo-dealer@autopulse.local', name: 'Autopulse Demo Motors', password, type: 'dealer',
    phone: '+1 555 010 0199', website: 'https://demo-motors.autopulse.local',
    dealer_account_information: {
      store_name: 'Autopulse Demo Motors', name: 'Autopulse Demo Motors',
      store_address: '500 Lakeshore Blvd', store_city: 'Springfield', store_state: 'IL', store_postal: '62701',
      dealer_street_address: '500 Lakeshore Blvd, Springfield, IL 62701',
      store_contact_number: '+15550100199', dealer_phone: '+15550100199', store_website: 'https://demo-motors.autopulse.local',
      time_zone: DEMO_TIMEZONE, weekly_availability: WEEKLY_AVAILABILITY,
      // Twilio number placeholder: sends are stubbed locally (PROVIDER_SEND_STUB).
      sms_conversion_phone: DEMO_DEALER_SMS,
      booking_max_per_slot: 1, booking_slot_minutes: 30,
      ai_agent_name: 'Ava', ai_bot_name: 'Ava',
      // The rest of the CRM's Dealer Setup form: without `sanitized_domain` the dealer portal forces the
      // setup modal open on every page.
      organization_name: 'Autopulse Demo Motors LLC', domain_name: 'demo-motors', sanitized_domain: 'demo-motors',
      contact_person: 'Dana Demo', contact_person_role: 'Owner', store_contact_mail: 'sales@demo-motors.autopulse.local',
      store_country: 'US', general_manager: 'Maya Manager', general_manager_email: 'maya.manager@autopulse.local',
      general_manager_phone: '+15550100198', fi_manager: 'Frank Finance', alternative_contact_number: '+15550100197',
    },
    setting: { autoReplyEnabled: true },
    branding_information: { primaryColor: '#0272b4' },
    appointment_reminder_settings: { enabled: true },
    package_expiry: moment().add(1, 'year').toDate(),
    ai_mode: 'live', ai_mms_enabled: true, ...SEED_TAG, createdAt: now, updatedAt: now,
  });
  const staff = [
    [ids.sam, 'sam.sales@autopulse.local', 'Sam Sales'],
    [ids.maya, 'maya.manager@autopulse.local', 'Maya Manager'],
  ];
  for (const [id, email, name] of staff) {
    await User.collection.insertOne({ _id: oid(id), email, name, password, type: 'dealer', parent_id: oid(ids.owner),
      ...SEED_TAG, createdAt: now, updatedAt: now });
  }
  await User.collection.insertOne({ _id: oid(ids.admin), email: 'admin@autopulse.local', name: 'Local Admin', password,
    type: 'admin', ...SEED_TAG, createdAt: now, updatedAt: now });
  await EmailAccount.collection.insertOne({ dealer_id: oid(ids.owner), account_name: 'Demo Motors Sales',
    event_type: 'Sales', account_type: 'IMAP', email_address: DEMO_MAILBOX, email_password: 'local-dev-not-a-password',
    active: true, ...SEED_TAG, createdAt: now, updatedAt: now });

  // Stock with photos (vAuto feed shape).
  await Vehicle.collection.insertMany(STOCK.map(([year, make, model, trim, body, condition, colour, miles, price], i) => {
    const vin = stockVin(i);
    return { dealerId: DEMO_DEALER_ID, vin, stock_number: `D${1000 + i}`, year, make, model, trim, body, condition,
      exteriorcolor: colour, mileage: miles, internetreduced: price, instoreprice: price + 1500,
      inventoryUrl: `https://demo-motors.autopulse.local/inventory/${vin}`,
      imagesSecure: [photo(vin, 1), photo(vin, 2), photo(vin, 3)], ...SEED_TAG,
      createdAt: new Date(now.getTime() - i * 60_000), updatedAt: now };
  }));

  async function customer(name, extra = {}) {
    const doc = await Customer.create({ dealer_id: DEMO_DEALER_ID, name,
      emails: [{ value: `${slug(name)}@example.test`, is_primary: true, source: 'seed' }],
      phones: [{ value: phoneFor(name), is_primary: true, source: 'seed', sms_opt_in: true }],
      preferred_communication_mode: 'sms', inbound_lead: true, extra, ...SEED_TAG });
    return doc;
  }

  // Leads, one per source bucket, each with its first message in the conversation.
  const leads = {};
  for (const [i, spec] of DEMO_LEADS.entries()) {
    const c = await customer(spec.name);
    const created = new Date(now.getTime() - (DEMO_LEADS.length - i) * 3_600_000);
    const lead = await Lead.create({ name: spec.name, email: `${slug(spec.name)}@example.test`,
      phone: `+1${phoneFor(spec.name)}`, source: spec.source, lead_source: spec.source, dealer_id: DEMO_DEALER_ID,
      customer_id: c._id, followup_preference: spec.channel, comments: spec.comments, fe_lead_status: 'Lead',
      data: { comments: spec.comments, channel: spec.channel }, statusChangedAt: created, ...SEED_TAG });
    await Lead.collection.updateOne({ _id: lead._id }, { $set: { createdAt: created } });
    await Email.create({ sender: spec.channel === 'sms' ? lead.phone : lead.email,
      recipient: spec.channel === 'sms' ? DEMO_DEALER_SMS : DEMO_MAILBOX, subject: spec.channel === 'sms'
        ? 'SMS Conversation' : `New inquiry from ${spec.source}`, mail_content: spec.comments,
      message_id: `seed-${spec.key}-${lead._id}`, communication_type: spec.channel, status: 'incoming',
      dealer_id: DEMO_DEALER_ID, lead_id: lead._id, date: created, timestamp: created, read: false });
    leads[spec.key] = lead;
  }

  // Customers with deals, owned vehicles and birth dates (DealerVault columns).
  for (const [i, h] of HISTORY.entries()) {
    const c = await customer(h.name, { birth_date: h.birth });
    const sold = moment().subtract(h.soldYearsAgo, 'years').toDate();
    // Their car is not stock: only the vAuto feed writes `vehicles`; the 360 takes it from the deal row.
    await Deal.collection.insertOne({ dealer_id: DEMO_DEALER_ID, deal_number: `DEMO-D${100 + i}`, vin: h.vin,
      customer_number: `DEMO-C${100 + i}`, customer_id: c._id, 'Contract Date': mdy(sold),
      'Sales Price': `${h.price.toLocaleString('en-US')}.00`, 'Salesman 1 Name': h.salesperson,
      'Birth Date': h.birth, Year: String(h.car[0]), Make: h.car[1], Model: h.car[2], ...SEED_TAG, createdAt: sold });
    await db.collection('serviceappointments').insertOne({ dealer_id: DEMO_DEALER_ID, appointment_number: `DEMO-A${i}`,
      vin: h.vin, customer_id: c._id, 'Appointment Date': mdy(moment().subtract(4 + i, 'months').toDate()),
      'Appointment Time': '9:00 AM', ...SEED_TAG, createdAt: now });
  }

  // Two upcoming bookings (so a slot is already taken), the second as staff
  // would make it from the lead screen.
  const tz = DEMO_TIMEZONE;
  const bookingsSpec = [[leads.website, nextOpenDay(2), '10:00', 'ai'], [leads.service, nextOpenDay(3), '14:30', 'staff']];
  for (const [lead, date, time, by] of bookingsSpec) {
    const day = moment.tz(date, 'YYYY-MM-DD', tz).startOf('day').utc().toDate();
    const at = moment.tz(`${date} ${time}`, 'YYYY-MM-DD HH:mm', tz).utc().toDate();
    const booking = await Booking.create({ dealer_id: DEMO_DEALER_ID, lead_id: String(lead._id), customerName: lead.name,
      email: lead.email, phone: lead.phone, bookingDate: day, bookingTime: time, booking_status: 'confirmed',
      created_by: by, ...SEED_TAG });
    await Lead.updateOne({ _id: lead._id }, { $set: { fe_lead_status: 'Appointment Booked', status: 'Appointment Booked',
      booking_status: true, booking: { booking_date: day, booking_time: time, booking_at: at },
      'data.bookingId': booking._id, 'data.booking': { booking_date: day, booking_time: time } } });
  }

  await seedRoles();

  return { dealer: DEMO_DEALER_ID, staff: staff.length, vehicles: STOCK.length,
    leads: DEMO_LEADS.length, customers: DEMO_LEADS.length + HISTORY.length, bookings: bookingsSpec.length };
}

// The CRM hides every menu item behind a permission (app/hooks/AdminPermissionsContext.js `useCan`, read from
// the user's Role by /api/auth/me). Without roles the dealer portal shows no Leads, Conversations, Booking,
// Settings or AI Assistant. The names are the ones the CRM's own code checks.
const DEALER_PERMISSIONS = [
  'Manage Leads', 'View Assigned Leads', 'Assign Leads', 'Manage Customer Conversation', 'Manage Follow-up setting',
  'Manage Message Template', 'Manage Subscription', 'Manage Support Ticket', 'Manage Email Accounts',
  'Manage Employee', "Manage Employee's  Role", 'Manage Account Information', 'manage_account_info',
];
const ADMIN_PERMISSIONS = ['Manage Agency', 'Manage Dealer', 'manage_dealer', 'Manage Contact Us', 'Manage Pages',
  'Manage Subscription', 'Manage Support Ticket', 'Manage Employee', "Manage Employee's  Role"];
const ROLES = [
  // [name, entity, permissions (null = all of that entity), users]
  ['Dealer Owner', 'dealer', null, ['owner']],
  ['Sales Manager', 'dealer', ['Manage Leads', 'Assign Leads', 'Manage Customer Conversation',
    'Manage Follow-up setting', 'Manage Message Template', 'Manage Support Ticket'], ['maya']],
  ['Sales Agent', 'dealer', ['View Assigned Leads', 'Manage Customer Conversation'], ['sam']],
  ['Platform Admin', 'admin', null, ['admin']],
];

export async function seedRoles() {
  const db = mongoose.connection.db;
  const now = new Date();
  const oid = (id) => new mongoose.Types.ObjectId(id);
  await db.collection('roles').deleteMany(SEED_TAG);
  await db.collection('permissions').deleteMany(SEED_TAG);
  const byEntity = { dealer: DEALER_PERMISSIONS, admin: ADMIN_PERMISSIONS };
  const permissionIds = { dealer: {}, admin: {} };
  for (const [entity, names] of Object.entries(byEntity)) {
    for (const permission_name of names) {
      const { insertedId } = await db.collection('permissions').insertOne({
        permission_name, entity, group: 'Local seed', ...SEED_TAG, createdAt: now, updatedAt: now });
      permissionIds[entity][permission_name] = insertedId;
    }
  }
  for (const [name, entity, names, users] of ROLES) {
    const permissions = (names || byEntity[entity]).map((n) => permissionIds[entity][n]);
    const { insertedId } = await db.collection('roles').insertOne({
      name, entity, permissions, entity_id: oid(ids.owner), ...SEED_TAG, createdAt: now, updatedAt: now });
    await db.collection('users').updateMany({ _id: { $in: users.map((u) => oid(ids[u])) } }, { $set: { role: insertedId } });
  }
  return { roles: ROLES.length, permissions: DEALER_PERMISSIONS.length + ADMIN_PERMISSIONS.length };
}

async function main() {
  assertLocal(MONGODB_URI);
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 3_000 });
  try {
    if (process.argv.includes('--roles-only')) {
      console.log('Roles and permissions seeded:', await seedRoles());
      return;
    }
    if (process.argv.includes('--if-missing') && await User.exists({ _id: DEMO_DEALER_ID })) {
      console.log(`Demo dealer already seeded in ${MONGODB_URI} (make crm-seed to start over).`);
      return;
    }
    const counts = await seed();
    console.log(`Seeded ${MONGODB_URI}:`, counts);
    console.log(`Login: demo-dealer@autopulse.local / ${DEMO_PASSWORD} (staff: sam.sales@ / maya.manager@autopulse.local,`
      + ` admin: admin@autopulse.local)`);
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
