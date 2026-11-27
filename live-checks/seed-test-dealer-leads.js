// Test dealership "Rapidsai" (the user, 28 Nov 2026): test leads so every screen has something to show - a live sales
// lead with an AI conversation and a hot flag, a booked appointment, a dead (Closed - Lost) service lead, and copies of
// a few real leads from another store with their conversations.
//
// DRY RUN by default: prints what it would add, changes nothing. With APPLY=1 it inserts customers, leads, messages,
// one note, one appointment and a few "What we know" facts, all for the test dealership only and all marked
// test_seed: "rapidsai" so they can be removed with the undo below.
// Safety:
//   - refuses unless the account is a dealership whose AI is off (ai_mode "off");
//   - every phone / email is a test value (555 numbers, @example.test), also on the copied leads, so a "Send" pressed
//     by a tester can never reach a real person;
//   - inserted straight into the database: no "new lead" alerts, no department emails, no AI first-touch;
//   - other stores' leads are only read (copied), never changed;
//   - running it again adds nothing (it stops when it finds its own seed).
//
// Run on the web server:
//   cd /var/www/html/autopulse-prod-v2/aidmvcs-be-dev
//   export URI="$(grep -hE '^MONGODB_URI=' .env* | head -1 | cut -d= -f2- | tr -d '"')"
//   mongosh "$URI" --quiet --eval 'var EMAIL="rapidsai23@gmail.com"' /tmp/seed-test-dealer-leads.js
//   mongosh "$URI" --quiet --eval 'var EMAIL="rapidsai23@gmail.com", APPLY=1' /tmp/seed-test-dealer-leads.js
// Optional: COPY_FROM="Victory Cars Central" (store name, default the first store whose name has "Central"), COPIES=3.
// Undo: mongosh "$URI" --quiet --eval 'var EMAIL="rapidsai23@gmail.com", UNDO=1' /tmp/seed-test-dealer-leads.js
/* global EMAIL, APPLY, UNDO, COPY_FROM, COPIES */
const MARK = 'rapidsai';
const email = (typeof EMAIL !== 'undefined' ? EMAIL : 'rapidsai23@gmail.com').toLowerCase().trim();
const apply = typeof APPLY !== 'undefined' && String(APPLY) === '1';
const undo = typeof UNDO !== 'undefined' && String(UNDO) === '1';
const copies = typeof COPIES !== 'undefined' ? Math.max(0, Math.min(10, Number(COPIES) || 0)) : 3;

const dealer = db.users.findOne({ email }, { name: 1, type: 1, parent_id: 1, ai_mode: 1, dealer_account_information: 1, package_expiry: 1 });
if (!dealer) { print(`No account with email ${email}.`); quit(1); }
if (dealer.type !== 'dealer' || dealer.parent_id) { print(`${email} is not a dealership account. Stopping.`); quit(1); }
if ((dealer.ai_mode || 'off') !== 'off') { print(`${dealer.name}: AI is "${dealer.ai_mode}" - turn it off first. Stopping.`); quit(1); }
const did = String(dealer._id);
const mine = { dealer_id: did, test_seed: MARK };

if (undo) {
  const leadIds = db.leads.find(mine, { _id: 1 }).toArray().map((l) => l._id);
  print(`Removing test seed from ${dealer.name}:`);
  print(`  messages ${db.emails.deleteMany({ dealer_id: did, lead_id: { $in: leadIds } }).deletedCount}`);
  print(`  appointments ${db.bookings.deleteMany(mine).deletedCount}`);
  print(`  facts ${db.qualification_facts.deleteMany(mine).deletedCount}`);
  print(`  leads ${db.leads.deleteMany(mine).deletedCount}`);
  print(`  customers ${db.customers.deleteMany(mine).deletedCount}`);
  quit(0);
}
// A test subscription so the store can use everything (the user, 28 Nov 2026): a manual, free, one-year subscription
// on the same package a real store uses - the same record the super admin's "Assign package" makes. Kept on UNDO.
{
  const expiry = dealer.package_expiry ? new Date(dealer.package_expiry) : null;
  const active = expiry && expiry > new Date();
  if (active) print(`Subscription: already active until ${expiry.toISOString().slice(0, 10)}.`);
  else {
    const ref = db.users.find({ type: 'dealer', parent_id: null, current_subscription: { $ne: null }, package_expiry: { $gt: new Date() } },
      { current_subscription: 1, name: 1 }).toArray()
      .map((u) => db.subscriptions.findOne({ _id: u.current_subscription, status: 'active' }, { package_id: 1 })).find(Boolean);
    const pkg = ref ? db.packages.findOne({ _id: ref.package_id }) : db.packages.findOne({ for_user_type: 'dealer' });
    if (!pkg) print('Subscription: no dealer package found - assign one by hand.');
    else if (!apply) print(`Subscription: would add a free manual one-year "${pkg.name || pkg.title || pkg._id}" subscription.`);
    else {
      const start = new Date(), end = new Date(); end.setFullYear(end.getFullYear() + 1);
      const sid = db.subscriptions.insertOne({ user_id: dealer._id, package_id: pkg._id, status: 'active', start_date: start, end_date: end,
        is_manual: true, is_auto_renew: false, price: 0, test_seed: MARK, createdAt: start, updatedAt: start }).insertedId;
      db.users.updateOne({ _id: dealer._id }, { $set: { current_subscription: sid, package_expiry: end } });
      print(`Subscription: added "${pkg.name || pkg.title || pkg._id}", active until ${end.toISOString().slice(0, 10)}.`);
    }
  }
}
if (db.leads.countDocuments(mine)) { print(`${dealer.name} already has its test leads (${db.leads.countDocuments(mine)}). Nothing to do; use UNDO=1 first to redo.`); quit(0); }

const bot = dealer.dealer_account_information?.ai_bot_name || 'Nicole';
const store = dealer.dealer_account_information?.store_name || dealer.name;
const storeNumber = '+15550100199';
const day = 864e5, now = Date.now();
const at = (daysAgo, h = 10, m = 0) => { const d = new Date(now - daysAgo * day); d.setUTCHours(h + 5, m, 0, 0); return d; };
const car = db.vehicles.findOne({ dealerId: did, vin: { $exists: true } }, { year: 1, make: 1, model: 1, trim: 1, vin: 1, stock: 1, stocknumber: 1, stockNumber: 1 });
const carName = car ? [car.year, car.make, car.model].filter(Boolean).join(' ') : '2022 Toyota RAV4';
const carStock = car ? String(car.stockNumber || car.stocknumber || car.stock || '') : '';

let n = 0;
const testPhone = () => `+1555010${String(1100 + (n++)).padStart(4, '0')}`;
const testEmail = (name) => `${String(name).toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}@example.test`;

const plan = [];
function customerAndLead(p) {
  const phone = testPhone(), mail = testEmail(p.name);
  const cid = new ObjectId(), lid = new ObjectId();
  const created = p.created;
  const customer = { _id: cid, dealer_id: did, name: p.name, emails: [{ value: mail, is_primary: true, source: 'test seed', added_at: created }],
    phones: [{ value: phone.slice(2), is_primary: true, source: 'test seed', sms_opt_in: true, added_at: created }],
    preferred_communication_mode: 'sms', preferred_communication_mode_selected: false, inbound_lead: true, manual_entry: false,
    assigned_to: null, assignment_history: [], merge_history: [], test_seed: MARK, createdAt: created, updatedAt: created };
  const lead = { _id: lid, name: p.name, email: mail, phone, source: p.source, lead_source: p.source, sub_source: p.sub_source || null,
    contact_type: p.contact_type, department: p.department, department_set_by: 'staff', dealer_id: did, customer_id: cid,
    assigned_to: null, data: { comments: p.comments, channel: 'sms' }, comments: p.comments, followup_preference: 'sms',
    fe_lead_status: p.status, lead_status: p.status, status: p.status, status_source: 'staff', statusChangedAt: p.statusAt || created,
    hot: Boolean(p.hot), test_seed: MARK, createdAt: created, updatedAt: p.statusAt || created,
    ...(p.vehicle ? { vehicles_of_interest: [{ ...p.vehicle, added_by_name: 'Test seed', at: created }] } : {}) };
  const messages = (p.messages || []).map(([who, text, when], i) => {
    const inbound = who === 'customer', ai = who === 'ai';
    return { sender: inbound ? phone : storeNumber, recipient: inbound ? storeNumber : phone, subject: 'SMS Conversation',
      message_id: `test-seed-${lid}-${i}`, date: when, timestamp: when, mail_content: text, dealer_id: did, lead_id: lid,
      communication_type: 'sms', status: inbound ? 'received' : 'sent', ai_generated: ai, ai_fallback: false, is_note: false,
      is_lead_email: false, is_appointment_notification: false, read: true,
      ...(ai || inbound ? {} : { message_by: 'staff' }), test_seed: MARK };
  });
  if (p.note) messages.push({ sender: 'Abdul Manan Shahid', recipient: '', subject: 'Note', message_id: `test-seed-${lid}-note`, date: p.note[1],
    timestamp: p.note[1], mail_content: p.note[0], dealer_id: did, lead_id: lid, communication_type: 'sms', status: 'sent',
    is_note: true, internal_use: true, ai_generated: false, read: true, test_seed: MARK });
  plan.push({ customer, lead, messages, facts: p.facts || [], booking: p.booking || null });
}

// 1. Live sales lead: Internet, AI conversation going, hot, facts the AI learned.
customerAndLead({ name: 'Abdul Manan Shahid', source: 'Cars.com', contact_type: 'internet', department: 'sales', hot: true,
  status: 'Contacted - Specific Follow-up', created: at(3, 9, 15), statusAt: at(1, 16, 5),
  comments: `Interested in the ${carName}. Has a trade-in.`,
  vehicle: car ? { year: String(car.year || ''), make: car.make, model: car.model, trim: car.trim || '', vin: car.vin, stock: carStock } : null,
  messages: [
    ['ai', `Hi Abdul, this is ${bot} at ${store}. Thanks for your interest in the ${carName} - is it the one you'd like to see, or should I send a few similar options?`, at(3, 9, 16)],
    ['customer', 'That one. What would my 2018 Honda Civic be worth? About 62k miles.', at(2, 18, 40)],
    ['ai', 'Thanks! A manager will look at the Civic and come back with a number. Would Saturday morning work to see the car and have the trade looked at?', at(2, 18, 41)],
    ['customer', 'Maybe next week, I will let you know', at(1, 16, 4)],
  ],
  note: ['Test note: customer wants a number on the trade before coming in.', at(1, 16, 30)],
  facts: [['interest.lead_type', 'sales'], ['interest.new_or_used', 'used'], ['interest.model', car?.model || 'RAV4'], ['interest.timeline', 'next_week'],
    ['trade_in.year', '2018'], ['trade_in.make', 'Honda'], ['trade_in.model', 'Civic'], ['trade_in.mileage', 62000], ['contact.preferred_channel', 'text']] });

// 2. Appointment booked: phone-up, tomorrow 11:00 (store time).
const tomorrow = new Date(now + day); tomorrow.setUTCHours(16, 0, 0, 0);
customerAndLead({ name: 'Betsy Vazquez', source: 'Phone Up', contact_type: 'phone', department: 'sales',
  status: 'Appointment Booked', created: at(2, 13, 0), statusAt: at(0, 9, 30), comments: 'Called in about financing options.',
  messages: [
    ['staff', `Hi Betsy, it's ${store}. Great talking to you - see you tomorrow at 11:00 AM.`, at(0, 9, 31)],
    ['customer', 'Perfect, see you then!', at(0, 9, 40)],
  ],
  booking: { date: tomorrow, time: '11:00', type: 'sales' } });

// 3. Dead lead: service, walk-in, two months old, never answered -> Closed - Lost.
customerAndLead({ name: 'Bibi Singh', source: 'Walk-In', contact_type: 'walk_in', department: 'service',
  status: 'Closed - Lost', created: at(62, 11, 0), statusAt: at(30, 10, 0), comments: 'Asked about a 30k service, did not book.',
  messages: [
    ['ai', `Hi Bibi, this is ${bot} at ${store}. Would you like me to set up the 30k service for your car?`, at(62, 11, 5)],
    ['ai', 'Just checking in - happy to find a time that works for the service.', at(55, 11, 0)],
  ] });

// 4. Copies of real leads from another store (conversation included), contact details replaced by test values.
const fromName = typeof COPY_FROM !== 'undefined' ? COPY_FROM : null;
const source = db.users.findOne({ type: 'dealer', parent_id: null, _id: { $ne: dealer._id },
  name: fromName ? fromName : /central/i }, { name: 1 });
const copied = [];
if (source && copies) {
  const realLeads = db.leads.find({ dealer_id: String(source._id), name: { $nin: [null, ''] } }).sort({ updatedAt: -1 }).limit(40).toArray()
    .filter((l) => db.emails.countDocuments({ lead_id: l._id, is_note: { $ne: true } }) >= 2).slice(0, copies);
  for (const l of realLeads) {
    const phone = testPhone(), mail = testEmail(l.name);
    const cid = new ObjectId(), lid = new ObjectId();
    const { _id, customer_id, assigned_to, pending_auto_reply_job_id, ...rest } = l;
    const customer = { _id: cid, dealer_id: did, name: l.name, emails: [{ value: mail, is_primary: true, source: 'test seed', added_at: l.createdAt }],
      phones: [{ value: phone.slice(2), is_primary: true, source: 'test seed', sms_opt_in: true, added_at: l.createdAt }],
      preferred_communication_mode: 'sms', inbound_lead: true, manual_entry: false, assigned_to: null, assignment_history: [],
      merge_history: [], test_seed: MARK, createdAt: l.createdAt, updatedAt: l.updatedAt };
    const data = rest.data && typeof rest.data === 'object' ? { ...rest.data } : rest.data;
    if (data && typeof data === 'object') for (const k of Object.keys(data)) { if (/phone/i.test(k)) data[k] = phone; else if (/e-?mail/i.test(k)) data[k] = mail; }
    const lead = { ...rest, data, _id: lid, dealer_id: did, customer_id: cid, assigned_to: null, email: mail, phone,
      test_seed: MARK, copied_from: { dealer: String(source._id), lead: String(_id) } };
    const oldPhone = l.phone ? String(l.phone) : null, oldEmail = l.email ? String(l.email).toLowerCase() : null;
    const swap = (v) => (v == null ? v : String(v).toLowerCase() === oldEmail ? mail : (oldPhone && String(v).replace(/\D/g, '').endsWith(oldPhone.replace(/\D/g, '').slice(-10)) ? phone : v));
    // Copied messages: only ones already sent / received (never a queued or draft one a sender could pick up), and
    // without the AI's unique send keys (28 Nov 2026: the first live run stopped on ai_idempotency_key).
    const messages = db.emails.find({ lead_id: _id, status: { $nin: ['pending', 'draft'] } }).sort({ timestamp: 1 }).limit(60).toArray().map((m) => {
      const { _id: mid, ai_idempotency_key, ...mr } = m;
      for (const k of Object.keys(mr)) if (/idempotency/i.test(k)) delete mr[k];
      return { ...mr, dealer_id: did, lead_id: lid, sender: swap(m.sender), recipient: swap(m.recipient),
        message_id: `test-seed-copy-${mid}`, test_seed: MARK };
    });
    plan.push({ customer, lead, messages, facts: [], booking: null });
    copied.push(`${l.name} (${l.fe_lead_status || l.status || 'no status'}, ${messages.length} messages)`);
  }
}

print(`Test dealership: ${dealer.name} (${did}), AI off. ${apply ? 'WRITING' : 'Dry run - nothing written'}.`);
for (const p of plan) print(`  ${p.lead.name}: ${p.lead.fe_lead_status || p.lead.status || "no status"} · ${p.lead.department || 'sales'} · ${p.messages.length} messages${p.booking ? ' · appointment tomorrow 11:00' : ''}${p.facts.length ? ` · ${p.facts.length} facts` : ''} · ${p.lead.phone}`);
if (!source && copies) print(`  (no store matching ${fromName || '"Central"'} found to copy leads from)`);
else if (copies) print(`  copied from ${source.name}: ${copied.length}`);
if (!apply) { print('Run again with APPLY=1 to add them.'); quit(0); }

for (const p of plan) {
  db.customers.insertOne(p.customer);
  db.leads.insertOne(p.lead);
  if (p.messages.length) db.emails.insertMany(p.messages);
  if (p.facts.length) db.qualification_facts.insertMany(p.facts.map(([path, value]) => ({ dealer_id: did, customer_id: String(p.customer._id),
    lead_id: String(p.lead._id), path, value, valid_from: p.lead.createdAt, valid_to: null, source: 'test seed', test_seed: MARK })));
  if (p.booking) db.bookings.insertOne({ dealer_id: did, lead_id: String(p.lead._id), customerName: p.lead.name, email: p.lead.email,
    phone: p.lead.phone, bookingDate: p.booking.date, bookingTime: p.booking.time, notes: 'Test appointment', booking_status: 'confirmed',
    appointment_type: p.booking.type, created_by: 'staff', created_by_name: 'Test seed', test_seed: MARK, createdAt: new Date(), updatedAt: new Date() });
  if (p.booking) {
    const ymd = p.booking.date.toISOString().slice(0, 10);
    db.leads.updateOne({ _id: p.lead._id }, { $set: { booking_status: 'confirmed', booking: { booking_date: ymd, booking_time: p.booking.time, booking_at: p.booking.date },
      'data.booking': { booking_date: ymd, booking_time: p.booking.time } } });
  }
}
print(`Done: ${db.leads.countDocuments(mine)} test leads, ${db.customers.countDocuments(mine)} customers in ${dealer.name}.`);
