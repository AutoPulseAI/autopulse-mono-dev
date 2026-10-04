// PLAN_4 stream X3 items 7 and 8, against a real MongoDB (the local dev container), like
// test-ai-layer-integration.js: production-shaped intake in AI `live` mode. Uses its own database,
// pulse_ai_x3_test, wiped before each test; skipped when no MongoDB is reachable.
//   Run: node --test test-ai-x3-integration.js
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import Email from './app/models/Email.js';
import Lead from './app/models/Lead.js';
import { handleInboundEmailLive, handleInboundSmsLive } from './app/lib/ai/aiInbound.js';

const URI = process.env.AI_X3_TEST_MONGODB_URI || 'mongodb://localhost:27018/pulse_ai_x3_test';
const DEALER = '66f0000000000000000000c1';
const quiet = { info() {}, warn() {}, error() {} };

let connected = false;
before(async () => {
  try {
    await mongoose.connect(URI, { serverSelectionTimeoutMS: 2_000 });
    connected = true;
  } catch {
    connected = false;
  }
});
after(async () => {
  if (connected) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
beforeEach(async () => {
  if (connected) await mongoose.connection.dropDatabase();
});

const maybe = (name, fn) => test(name, async (t) => {
  if (!connected) return t.skip(`MongoDB not reachable at ${URI}`);
  return fn(t);
});

function recorder() {
  const calls = { newLead: [], inbound: [] };
  return {
    calls,
    notifyNewLead: async (args) => { calls.newLead.push(args); return { status: 'delivered' }; },
    notifyInbound: async (args) => { calls.inbound.push(args); return { status: 'delivered' }; },
  };
}

function sms(overrides = {}) {
  return {
    message_id: `SM${Math.random().toString(16).slice(2)}`, sender: '+15557654321', recipient: '+15550000001',
    mail_content: 'yes saturday works', status: 'received', dealer_id: DEALER, communication_type: 'sms',
    date: new Date(), ...overrides,
  };
}

async function inboundEmail({ sender, body, subject = 'New lead' }) {
  const record = await Email.create({
    message_id: `<${Math.random().toString(16).slice(2)}@mail.test>`, sender, recipient: 'sales@dealer.test', subject,
    mail_content: body, status: 'incoming', dealer_id: DEALER, communication_type: 'email', date: new Date(),
  });
  return { email_record_id: String(record._id), message_id: record.message_id, sender, mail_content: body,
    dealer_id: DEALER };
}

// --- Item 7: SMS replies on production data ----------------------------------------

maybe('an SMS reply links to the open lead whatever format its phone was stored in (no new lead, no greeting)', async () => {
  // Production's SMS webhook sets no lead_id, and leads keep the phone as the form typed it.
  const lead = await Lead.create({ dealer_id: DEALER, name: 'Denise', phone: '(555) 765-4321', fe_lead_status: 'Lead' });
  const r = recorder();
  const result = await handleInboundSmsLive({ currentSMS: sms(), dealer: { _id: DEALER }, ...r, logger: quiet });
  assert.equal(result.created, false);
  assert.equal(String(result.leadId), String(lead._id));
  assert.equal(r.calls.newLead.length, 0);
  assert.equal(r.calls.inbound.length, 1);
  assert.equal(await Lead.countDocuments({}), 1);
});

// --- Item 7: plain portal emails and ADF without production's parser ----------------

maybe('a plain portal lead email creates the lead for the customer in the body, not the portal address', async () => {
  const body = 'You have a new lead from Cars.com\nName: Jane Doe\nEmail: jane.doe@example.test\n'
    + 'Phone: (555) 222-3333\nVehicle: 2022 Toyota RAV4 XLE\nComments: Is it still available?';
  const r = recorder();
  const result = await handleInboundEmailLive({ currentEmail: await inboundEmail({ sender: 'Cars.com <leads@cars.com>', body }),
    dealer: { _id: DEALER }, ...r, logger: quiet });
  assert.equal(result.created, true);
  const lead = await Lead.findById(result.leadId).lean();
  assert.equal(lead.email, 'jane.doe@example.test');
  assert.equal(lead.phone, '5552223333');
  assert.equal(lead.name, 'Jane Doe');
  assert.equal(lead.source, 'cars.com');
  assert.equal(r.calls.newLead[0].channel, 'sms', 'answered on the phone the customer gave');
});

maybe('a portal email naming no customer creates no lead addressed to the portal', async () => {
  const r = recorder();
  const result = await handleInboundEmailLive({
    currentEmail: await inboundEmail({ sender: 'CarGurus <noreply@cargurus.com>', body: 'Your weekly listing report' }),
    dealer: { _id: DEALER }, ...r, logger: quiet });
  assert.equal(result.status, 'portal_without_customer');
  assert.equal(await Lead.countDocuments({}), 0);
});

maybe('an ADF lead email in the plain-email path is read with our ADF parser', async () => {
  const adf = `<?xml version="1.0"?><adf><prospect><id source="TrueCar">1</id><customer><contact>
    <name part="first">Tyler</name><name part="last">Davis</name><email>Tyler.Davis@example.test</email>
    <phone type="voice">555-444-1234</phone></contact><comments>Best price?</comments></customer></prospect></adf>`;
  const r = recorder();
  const result = await handleInboundEmailLive({ currentEmail: await inboundEmail({ sender: 'leads@truecar.com', body: adf }),
    dealer: { _id: DEALER }, ...r, logger: quiet });
  const lead = await Lead.findById(result.leadId).lean();
  assert.equal(lead.email, 'tyler.davis@example.test');
  assert.equal(lead.name, 'Tyler Davis');
  assert.equal(lead.source, 'TrueCar');
});

// --- Item 8: a returning customer after the lead closed ------------------------------

maybe('a text from a customer whose only lead is Closed - Lost starts a new lead', async () => {
  const closed = await Lead.create({ dealer_id: DEALER, name: 'Marcus', email: 'm@example.test', phone: '+15557654321',
    fe_lead_status: 'Closed - Lost' });
  const r = recorder();
  const result = await handleInboundSmsLive({ currentSMS: sms({ mail_content: 'hey, are you still selling the Civic?' }),
    dealer: { _id: DEALER }, ...r, logger: quiet });
  assert.equal(result.created, true);
  const lead = await Lead.findById(result.leadId).lean();
  assert.notEqual(String(lead._id), String(closed._id));
  assert.equal(String(lead.previous_lead_id), String(closed._id));
  assert.equal(lead.name, 'Marcus', 'the returning customer keeps their name');
  assert.equal(r.calls.newLead.length, 1);
});

maybe('a reply threaded to a closed lead also starts a new lead', async () => {
  const closed = await Lead.create({ dealer_id: DEALER, name: 'Marcus', phone: '+15557654321',
    fe_lead_status: 'Closed - Lost' });
  const r = recorder();
  const result = await handleInboundSmsLive({ currentSMS: sms({ lead_id: closed._id }), dealer: { _id: DEALER }, ...r,
    logger: quiet });
  assert.equal(result.created, true);
});
