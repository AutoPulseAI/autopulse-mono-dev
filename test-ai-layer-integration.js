// Integration tests for the AI live-mode inbound paths and AI message records,
// against a real MongoDB (the local dev container). Uses its own database,
// pulse_ai_platform_test, and wipes it before each test. Skipped when no
// MongoDB is reachable.
//   Run: node --test test-ai-layer-integration.js
//   (AI_TEST_MONGODB_URI overrides the database.)
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import Customer from './app/models/Customer.js';
import Email from './app/models/Email.js';
import Lead from './app/models/Lead.js';
import { handleInboundEmailLive, handleInboundSmsLive } from './app/lib/ai/aiInbound.js';
import { buildAiEmailDocument } from './app/lib/ai/aiMessageRecord.js';

const URI = process.env.AI_TEST_MONGODB_URI || 'mongodb://localhost:27017/pulse_ai_platform_test';
const DEALER = '66f0000000000000000000a1';
const DEALER_SMS = '+15550000001';
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
    message_id: `SM${Math.random().toString(16).slice(2)}`, sender: '+15557654321', recipient: DEALER_SMS,
    mail_content: 'Hi, is the RAV4 still available?', status: 'received', dealer_id: DEALER,
    communication_type: 'sms', date: new Date(), ...overrides,
  };
}

const maybe = (name, fn) => test(name, async (t) => {
  if (!connected) return t.skip(`MongoDB not reachable at ${URI}`);
  return fn(t);
});

maybe('live SMS from a new number creates a lead + customer and sends lead-created', async () => {
  const r = recorder();
  const result = await handleInboundSmsLive({ currentSMS: sms(), dealer: { _id: DEALER }, ...r, logger: quiet });

  assert.equal(result.created, true);
  const lead = await Lead.findById(result.leadId).lean();
  assert.equal(lead.phone, '+15557654321');
  assert.equal(lead.dealer_id, DEALER);
  assert.equal(lead.data.comments, 'Hi, is the RAV4 still available?');
  assert.ok(lead.customer_id, 'customer linked');
  const customer = await Customer.findById(lead.customer_id).lean();
  // The platform stores customer phones as bare 10 digits (customerResolver normalizePhone).
  assert.equal(customer.phones[0].value, '5557654321');

  const saved = await Email.findById(result.emailRecordId).lean();
  assert.equal(String(saved.lead_id), String(lead._id));
  assert.equal(saved.communication_type, 'sms');

  assert.equal(r.calls.newLead.length, 1);
  assert.equal(r.calls.inbound.length, 0);
  assert.equal(r.calls.newLead[0].channel, 'sms');
  assert.equal(String(r.calls.newLead[0].lead.customer_id), String(lead.customer_id));
});

maybe('live SMS reply on a known thread sends inbound-message for that lead', async () => {
  const first = recorder();
  const { leadId } = await handleInboundSmsLive({ currentSMS: sms(), dealer: { _id: DEALER }, ...first, logger: quiet });

  // The webhook links the reply to the lead (currentSMS.lead_id).
  const r = recorder();
  const result = await handleInboundSmsLive({
    currentSMS: sms({ lead_id: leadId, mail_content: 'It is a 2019 Civic' }), dealer: { _id: DEALER }, ...r, logger: quiet,
  });
  assert.equal(result.created, false);
  assert.equal(String(result.leadId), String(leadId));
  assert.equal(r.calls.inbound.length, 1);
  assert.equal(r.calls.inbound[0].text, 'It is a 2019 Civic');
  assert.equal(String(r.calls.inbound[0].emailRecord._id), String(result.emailRecordId));
  assert.equal(await Lead.countDocuments({}), 1, 'no second lead');
});

maybe('live SMS from a known number without a thread link attaches to that number\'s latest lead', async () => {
  const { leadId } = await handleInboundSmsLive({ currentSMS: sms(), dealer: { _id: DEALER }, ...recorder(), logger: quiet });
  const r = recorder();
  const result = await handleInboundSmsLive({ currentSMS: sms({ mail_content: 'hello again' }), dealer: { _id: DEALER }, ...r, logger: quiet });
  assert.equal(String(result.leadId), String(leadId));
  assert.equal(r.calls.inbound.length, 1);
});

maybe('live SMS never attaches to another dealer\'s lead', async () => {
  await handleInboundSmsLive({ currentSMS: sms({ dealer_id: '66f0000000000000000000b2' }), dealer: {}, ...recorder(), logger: quiet });
  const r = recorder();
  const result = await handleInboundSmsLive({ currentSMS: sms(), dealer: { _id: DEALER }, ...r, logger: quiet });
  assert.equal(result.created, true, 'same phone at another dealer is a different lead');
});

async function savedInboundEmail(overrides = {}) {
  return Email.create({
    message_id: `<${Math.random().toString(16).slice(2)}@mail.test>`, sender: 'Jane Doe <jane@example.test>',
    recipient: 'sales@dealer.test', subject: 'Question', mail_content: 'Do you have trucks?', status: 'incoming',
    dealer_id: DEALER, communication_type: 'email', date: new Date(), ...overrides,
  });
}

maybe('live email from a new sender creates a lead from the From header', async () => {
  const record = await savedInboundEmail();
  const r = recorder();
  const result = await handleInboundEmailLive({
    currentEmail: { email_record_id: String(record._id), message_id: record.message_id, sender: record.sender,
      mail_content: record.mail_content, dealer_id: DEALER },
    dealer: { _id: DEALER }, ...r, logger: quiet,
  });
  assert.equal(result.created, true);
  const lead = await Lead.findById(result.leadId).lean();
  assert.equal(lead.email, 'jane@example.test');
  assert.equal(lead.name, 'Jane Doe');
  assert.ok(lead.customer_id);
  assert.equal(String((await Email.findById(record._id).lean()).lead_id), String(lead._id));
  assert.equal(r.calls.newLead[0].channel, 'email');
});

maybe('live email reply already linked to a lead sends inbound-message', async () => {
  const lead = await Lead.create({ name: 'Jane', email: 'jane@example.test', dealer_id: DEALER, customer_id: new mongoose.Types.ObjectId() });
  const record = await savedInboundEmail({ lead_id: lead._id, mail_content: 'Saturday works' });
  const r = recorder();
  const result = await handleInboundEmailLive({
    currentEmail: { email_record_id: String(record._id), message_id: record.message_id, sender: record.sender,
      mail_content: 'Saturday works', dealer_id: DEALER },
    dealer: { _id: DEALER }, ...r, logger: quiet,
  });
  assert.equal(result.created, false);
  assert.equal(r.calls.inbound.length, 1);
  assert.equal(r.calls.inbound[0].channel, 'email');
});

maybe('live email with no usable sender does not create a lead', async () => {
  const record = await savedInboundEmail({ sender: 'MAILER-DAEMON' });
  const result = await handleInboundEmailLive({
    currentEmail: { email_record_id: String(record._id), message_id: record.message_id, sender: 'MAILER-DAEMON', dealer_id: DEALER },
    dealer: { _id: DEALER }, ...recorder(), logger: quiet,
  });
  assert.equal(result.status, 'no_sender');
  assert.equal(await Lead.countDocuments({}), 0);
});

maybe('a recorded AI SMS shows in the conversation query and threads the next reply to the lead', async () => {
  const lead = await Lead.create({ name: 'Maria', phone: '+15557654321', dealer_id: DEALER });
  const dealer = { _id: DEALER, dealer_account_information: { sms_conversion_phone: DEALER_SMS } };
  await Email.create(buildAiEmailDocument({
    dealer,
    payload: { dealer_id: DEALER, lead_id: String(lead._id), channel: 'sms', to: '+15557654321', text: 'Hi Maria!',
      status: 'sent', provider_id: 'SM1', idempotency_key: 't1:sms', turn_id: 't1', sent_at: new Date().toISOString() },
  }));

  // What app/api/conversations/lead/route.js runs for the conversation screen:
  const thread = await Email.find({ lead_id: new mongoose.Types.ObjectId(String(lead._id)) }).lean();
  assert.equal(thread.length, 1);
  assert.equal(thread[0].ai_generated, true);

  // What app/api/system/sms/route.js runs when the customer replies (From = customer, To = dealer):
  const parent = await Email.findOne({
    dealer_id: DEALER, communication_type: 'sms', lead_id: { $exists: true, $ne: null },
    $or: [{ sender: DEALER_SMS, recipient: '+15557654321' }, { sender: '+15557654321', recipient: DEALER_SMS }],
  }).sort({ timestamp: -1, _id: -1 }).lean();
  assert.equal(String(parent.lead_id), String(lead._id));
});
